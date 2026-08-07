import { Injectable, Logger } from '@nestjs/common';
import {
  AiRoutingStrategy,
  ApiRequestType,
  PromptType,
  type AiModel,
} from '@prisma/client';

import { AiModelsService } from '../../../ai-models/ai-models.service';
import {
  AI_PROVIDER_KEYS,
  normalizeAiProviderKey,
} from '../../../ai/constants/ai-provider.constants';
import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import {
  COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS,
  COMMUNITY_AI_ANALYSIS_MAX_MODELS_PER_OPERATION,
  COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
  COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
  COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE,
  COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE,
  COMMUNITY_AI_ANALYSIS_MIN_TOTAL_EVIDENCE_SAMPLES,
  COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
  COMMUNITY_AI_ANALYSIS_SCHEMA_NAME,
  COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS,
  COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES,
  COMMUNITY_AI_ANALYSIS_TEMPERATURE,
} from '../constants/community-ai-analysis.constants';
import type {
  CommunityAiAnalysis,
  CommunityAiOpportunity,
} from '../types/community-ai-analysis.type';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import { CommunityAiAnalysisPromptService } from './community-ai-analysis-prompt.service';
import { buildCommunityAiAnalysisSchema } from '../schemas/community-ai-analysis.schema';
import { isTransientDatabaseError } from '../utils/transient-database-error.util';

/**
 * Executes bounded, evidence-grounded LLM analysis over cleaned community data.
 *
 * Reliability strategy:
 * - AiExecutionService handles provider errors, temporary retries, model health,
 *   structured-output parsing, and provider/model fallback.
 * - This service adds domain-level validation for responses that are valid JSON
 *   but still contain weak, empty, generic, or suspicious analysis.
 * - A model whose successful response fails domain validation is excluded from
 *   the next attempt, forcing routing to try a different active model.
 * - The deterministic NLP path remains the final non-fatal fallback.
 */
@Injectable()
export class CommunityAiAnalysisService {
  private readonly logger = new Logger(CommunityAiAnalysisService.name);

  constructor(
    private readonly aiModelsService: AiModelsService,
    private readonly aiExecutionService: AiExecutionService,
    private readonly promptService: CommunityAiAnalysisPromptService,
  ) {}

  /**
   * Attempts community analysis using bounded model rotation.
   *
   * Returns null only after all domain-level attempts fail. Returning null is
   * intentional because CommunityAiAnalysisStage preserves the existing NLP
   * output and allows deterministic opportunity ranking to continue.
   */
  async analyze(
    context: IdeaGenerationContext,
  ): Promise<CommunityAiAnalysis | null> {
    const prompt = this.promptService.build(context);
    const onlineModels = await this.findOnlineFallbackModels(context);
    const startedAt = Date.now();

    if (onlineModels.length === 0) {
      const retainedFallback =
        this.buildRetainedEvidenceFallbackOpportunities(context);

      if (retainedFallback.length > 0) {
        this.logger.warn(
          'No healthy online community-analysis model is available; using retained direct evidence immediately without failing the community-analysis stage.',
        );
        return this.buildFallbackAnalysis(retainedFallback);
      }

      this.logger.warn(
        'No healthy online community-analysis model is available and no retained direct evidence exists; deterministic NLP analysis will continue.',
      );
      return null;
    }

    /*
     * Provider-diverse attempts run concurrently instead of serially. This
     * preserves the same quality fallback coverage while bounding latency to
     * the slowest allowed request rather than the sum of both request windows.
     * The first response that passes parsing, evidence grounding, and business
     * validation wins; remaining requests receive AbortSignal cancellation.
     */
    const models = onlineModels.slice(
      0,
      Math.min(COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS, onlineModels.length),
    );
    const controllers = models.map(() => new AbortController());
    const pending = new Map<
      number,
      Promise<{
        readonly index: number;
        readonly analysis: CommunityAiAnalysis | null;
        readonly operationId?: string;
        readonly modelId?: string;
        readonly apiModelId?: string;
        readonly providerKey?: string;
        readonly error?: unknown;
      }>
    >();
    let lastError: unknown = null;

    models.forEach((model, index) => {
      const attempt = index + 1;
      const requestTimeoutMs = Math.min(
        COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
        COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS,
      );

      const task = this.withHardTimeout(
        this.aiExecutionService.execute({
          aiModelId: model.id,
          userPrompt: prompt.userPrompt,
          systemInstruction: prompt.systemInstruction,
          requestType: ApiRequestType.NLP_ENHANCEMENT,
          promptType: PromptType.NLP_ANALYSIS,
          generationType: context.generationType,
          userId:
            context.owner.type === IDEA_OWNER_TYPES.USER
              ? context.owner.userId
              : undefined,
          guestSessionId:
            context.owner.type === IDEA_OWNER_TYPES.GUEST
              ? context.owner.guestSessionId
              : undefined,
          responseFormat: AiResponseFormat.JSON,
          responseSchema: buildCommunityAiAnalysisSchema(),
          responseSchemaName: COMMUNITY_AI_ANALYSIS_SCHEMA_NAME,
          estimatedOutputTokens: COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
          maxOutputTokens: COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
          temperature: COMMUNITY_AI_ANALYSIS_TEMPERATURE,
          strategy: AiRoutingStrategy.BALANCED,
          excludedAiModelIds: models
            .filter((_item, modelIndex) => modelIndex !== index)
            .map((item) => item.id),
          timeoutMs: requestTimeoutMs,
          maxRetriesPerModel: 0,
          maxModelsPerOperation: 1,
          allowProviderFallbackOnInvalidPrompt: true,
          signal: controllers[index].signal,
        }),
        requestTimeoutMs + 500,
        `Community AI online attempt ${attempt}`,
      )
        .then((result) => ({
          index,
          analysis: this.parseGroundAndValidate(
            context,
            result.text,
            result.aiModelId,
            result.apiModelId,
            attempt,
          ),
          operationId: result.operationId,
          modelId: result.aiModelId,
          apiModelId: result.apiModelId,
          providerKey: result.providerKey,
        }))
        .catch((error: unknown) => ({
          index,
          analysis: null,
          error,
        }));

      pending.set(index, task);
    });

    const totalTimeoutAt = startedAt + COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS;

    while (pending.size > 0 && Date.now() < totalTimeoutAt) {
      const remainingMs = Math.max(1, totalTimeoutAt - Date.now());
      const settled = await this.withHardTimeout(
        Promise.race(pending.values()),
        remainingMs,
        'Community AI provider-diverse chain',
      ).catch((error: unknown) => ({
        index: -1,
        analysis: null,
        error,
      }));

      if (settled.index < 0) {
        lastError = settled.error;
        break;
      }

      pending.delete(settled.index);

      if (settled.analysis) {
        controllers.forEach((controller, index) => {
          if (index !== settled.index && pending.has(index)) {
            controller.abort();
          }
        });
        void Promise.allSettled(pending.values());

        this.logger.log(
          `Community AI analysis accepted. operationId=${settled.operationId}, modelId=${settled.modelId}, apiModelId=${settled.apiModelId}, provider=${settled.providerKey}, concurrentAttempt=${settled.index + 1}/${models.length}, opportunities=${settled.analysis.opportunities.length}, elapsedMs=${Date.now() - startedAt}.`,
        );
        return settled.analysis;
      }

      lastError = settled.error;
      const model = models[settled.index];
      const databaseUnavailable = isTransientDatabaseError(settled.error);
      this.logger.warn(
        `Community AI online model failed or was rejected. concurrentAttempt=${settled.index + 1}/${models.length}, model=${model?.displayName ?? model?.modelName ?? 'balanced-routing'}, provider=${model?.providerKey ?? 'auto'}, databaseUnavailable=${databaseUnavailable}, elapsedMs=${Date.now() - startedAt}, error=${this.getErrorMessage(settled.error)}.`,
      );

      if (databaseUnavailable) {
        controllers.forEach((controller) => controller.abort());
        break;
      }
    }

    controllers.forEach((controller) => controller.abort());
    void Promise.allSettled(pending.values());

    const retainedFallback = this.buildRetainedEvidenceFallbackOpportunities(context);
    if (retainedFallback.length > 0) {
      const grounded = this.applyEvidenceGrounding(
        context,
        this.buildFallbackAnalysis(retainedFallback, models.length),
        true,
      );
      this.logger.warn(
        `Community AI online enrichment was unavailable within ${Date.now() - startedAt}ms; retained direct evidence produced ${grounded.opportunities.length} grounded candidate(s), so the stage completed successfully.`,
      );
      return grounded;
    }

    this.logger.warn(
      `Community AI online fallback chain was exhausted within ${Date.now() - startedAt}ms. Deterministic NLP analysis will continue without Ollama. error=${this.getErrorMessage(lastError)}.`,
    );

    return null;
  }

  /**
   * Returns active online models in provider-diverse order.
   *
   * The configured default model is first when it is online. The second slot
   * prefers a different provider, avoiding two attempts against the same
   * failing provider while keeping the fallback fully remote.
   */
  private async findOnlineFallbackModels(
    context: IdeaGenerationContext,
  ): Promise<AiModel[]> {
    try {
      const routableModels = await this.aiModelsService.getRoutableModels();

      const onlineModels = routableModels.filter(
        (model) =>
          normalizeAiProviderKey(model.providerKey) !== AI_PROVIDER_KEYS.OLLAMA &&
          model.supportsJsonOutput &&
          model.healthStatus !== 'UNAVAILABLE' &&
          model.consecutiveFailures < 4,
      );

      /*
       * Community analysis gets one short online attempt. Rotate the first
       * model deterministically per run instead of pinning the configured
       * default forever. Healthy direct-provider models are preferred, while
       * recent failures and very large/slow routed models are penalized.
       */
      const seed = this.hash(context.runId);
      const ordered = [...onlineModels].sort((first, second) => {
        const healthDifference =
          this.healthRank(first.healthStatus) - this.healthRank(second.healthStatus);
        if (healthDifference !== 0) return healthDifference;

        if (first.consecutiveFailures !== second.consecutiveFailures) {
          return first.consecutiveFailures - second.consecutiveFailures;
        }

        const firstProvider = normalizeAiProviderKey(first.providerKey);
        const secondProvider = normalizeAiProviderKey(second.providerKey);
        const directProviderDifference =
          (firstProvider === AI_PROVIDER_KEYS.GOOGLE ? 0 : 1) -
          (secondProvider === AI_PROVIDER_KEYS.GOOGLE ? 0 : 1);
        if (directProviderDifference !== 0) return directProviderDifference;

        const weightDifference = first.weight - second.weight;
        if (weightDifference !== 0) return weightDifference;

        return (
          this.hash(`${seed}:${first.id}`) -
          this.hash(`${seed}:${second.id}`)
        );
      });

      if (ordered.length <= 1) {
        return ordered;
      }

      const first = ordered[0];
      const firstProvider = normalizeAiProviderKey(first.providerKey);
      const differentProvider = ordered.find(
        (model, index) =>
          index > 0 &&
          normalizeAiProviderKey(model.providerKey) !== firstProvider,
      );
      const second =
        differentProvider ?? ordered.find((model, index) => index > 0);

      return [first, ...(second ? [second] : [])].slice(
        0,
        COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Online community-analysis model discovery failed; balanced routing will be attempted once. error=${this.getErrorMessage(error)}.`,
      );
      return [];
    }
  }

  private healthRank(status: AiModel['healthStatus']): number {
    switch (status) {
      case 'HEALTHY':
        return 0;
      case 'UNKNOWN':
        return 1;
      case 'DEGRADED':
        return 2;
      default:
        return 3;
    }
  }

  private hash(value: string): number {
    let result = 2166136261;

    for (const character of value) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }

    return result >>> 0;
  }

  private async withHardTimeout<T>(
    task: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        task,
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} exceeded ${timeoutMs}ms.`));
          }, timeoutMs);
          timeoutHandle.unref?.();
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Parses, corpus-grounds, and validates one provider response.
   *
   * Keeping the same validation path for online and local models prevents the
   * emergency fallback from bypassing evidence or business-quality controls.
   */
  private parseGroundAndValidate(
    context: IdeaGenerationContext,
    text: string,
    modelId: string,
    apiModelId: string,
    attemptCount: number,
  ): CommunityAiAnalysis {
    const providerReturnedNoOpportunities =
      this.providerReturnedNoOpportunities(text);
    const parsedAnalysis = this.parseAndValidate(
      context,
      text,
      modelId,
      apiModelId,
      attemptCount,
    );
    const domainNormalizedAnalysis = this.normalizeOpportunityDomains(
      context,
      parsedAnalysis,
    );
    let groundedAnalysis: CommunityAiAnalysis;

    try {
      groundedAnalysis = this.applyEvidenceGrounding(
        context,
        domainNormalizedAnalysis,
        providerReturnedNoOpportunities,
      );
    } catch (error) {
      const retainedFallback =
        this.buildRetainedEvidenceFallbackOpportunities(context);

      if (retainedFallback.length === 0) {
        throw error;
      }

      groundedAnalysis = this.applyEvidenceGrounding(
        context,
        {
          ...domainNormalizedAnalysis,
          summary:
            'The online model did not return a usable grounded opportunity, so one cautious candidate was recovered from retained direct NLP evidence.',
          dominantProblems: retainedFallback.map((item) => item.problem),
          unmetNeeds: retainedFallback.map((item) => item.unmetNeed),
          opportunities: retainedFallback,
          overallConfidence:
            retainedFallback.reduce((sum, item) => sum + item.confidence, 0) /
            retainedFallback.length,
          qualityWarnings: [
            ...domainNormalizedAnalysis.qualityWarnings,
            'The provider output was unusable after grounding; retained direct evidence was recovered within the same community-analysis attempt.',
          ],
        },
        true,
      );
    }

    const analysis = this.preserveGroundedLowConfidenceAnalysis(
      groundedAnalysis,
    );

    this.validateBusinessQuality(analysis, context);

    return analysis;
  }


  /**
   * Repairs provider labels such as "Unassigned", "General", or an empty
   * domain without discarding an otherwise grounded response. The model is not
   * allowed to invent a new domain; unknown labels are mapped to the primary
   * selected domain and every valid selected label is preserved.
   */
  private normalizeOpportunityDomains(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    const selectedDomains =
      context.selectedDomains.length > 0
        ? context.selectedDomains
        : context.domainName
          ? [{ id: context.domainId, name: context.domainName, keywords: [] }]
          : [];

    const primaryDomainName = selectedDomains[0]?.name;
    if (!primaryDomainName) {
      return analysis;
    }

    const selectedByNormalizedName = new Map(
      selectedDomains.map((domain) => [
        this.normalizeComparableText(domain.name),
        domain.name,
      ]),
    );

    const genericLabels = new Set([
      '',
      'unassigned',
      'general',
      'unknown',
      'other',
      'n a',
      'na',
    ]);

    return {
      ...analysis,
      opportunities: analysis.opportunities.map((opportunity) => {
        const normalized = this.normalizeComparableText(
          opportunity.domainName,
        );
        const exactSelectedName = selectedByNormalizedName.get(normalized);

        if (exactSelectedName) {
          return { ...opportunity, domainName: exactSelectedName };
        }

        if (genericLabels.has(normalized)) {
          return { ...opportunity, domainName: primaryDomainName };
        }

        /*
         * A non-selected model label is still constrained to the user's
         * selected scope instead of rejecting the complete AI analysis.
         */
        return { ...opportunity, domainName: primaryDomainName };
      }),
    };
  }

  /** Parses the central runtime's validated JSON into the domain contract. */
  private parseAndValidate(
    context: IdeaGenerationContext,
    text: string,
    modelId: string,
    apiModelId: string,
    attemptCount: number,
  ): CommunityAiAnalysis {
    const parsed: unknown = JSON.parse(text);

    if (!this.isRecord(parsed) || !Array.isArray(parsed.opportunities)) {
      throw new Error('Community AI analysis returned an invalid root object.');
    }

    const providerOpportunities = parsed.opportunities
      .slice(0, COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES)
      .map((value) => this.parseOpportunity(value));

    const opportunities =
      providerOpportunities.length > 0
        ? providerOpportunities
        : this.buildRetainedEvidenceFallbackOpportunities(context);

    if (providerOpportunities.length === 0 && opportunities.length > 0) {
      this.logger.warn(
        `Community AI provider returned an empty opportunities array; recovered ${opportunities.length} grounded candidate(s) from retained NLP evidence instead of failing the stage.`,
      );
    }

    if (opportunities.length === 0) {
      throw new Error(
        'Community AI analysis returned no opportunities and no retained evidence-backed candidate could be recovered.',
      );
    }

    const inferredConfidence =
      opportunities.reduce((sum, item) => sum + item.confidence, 0) /
      opportunities.length;

    const usedRetainedEvidenceFallback = providerOpportunities.length === 0;
    const providerWarnings = this.normalizeTextArray(
      parsed.qualityWarnings,
      [],
      true,
    );
    const safeProviderWarnings = usedRetainedEvidenceFallback
      ? providerWarnings.filter(
          (warning) =>
            !/(?:no|without|lacking|only|entirely)\s+(?:direct\s+)?(?:user\s+)?(?:complaints?|problem|problem context|actionable)|non-problem|promotional text|video titles/iu.test(
              warning,
            ),
        )
      : providerWarnings;

    return {
      /*
       * When the provider returns zero opportunity objects its accompanying
       * summary/confidence may describe the corpus as evidence-free even though
       * the deterministic retained-evidence fallback just recovered a concrete
       * direct complaint. In that case the fallback becomes authoritative for
       * semantic fields; provider prose is not allowed to contradict verified
       * retained evidence.
       */
      summary: usedRetainedEvidenceFallback
        ? `Recovered ${opportunities.length} direct evidence-grounded opportunity candidate(s) from retained community evidence after the online model returned no opportunity objects.`
        : this.optionalString(
            parsed.summary,
            `Extracted ${opportunities.length} evidence-grounded opportunity candidate(s).`,
          ),
      dominantProblems: usedRetainedEvidenceFallback
        ? opportunities.map((item) => item.problem)
        : this.normalizeTextArray(
            parsed.dominantProblems,
            opportunities.map((item) => item.problem),
          ),
      unmetNeeds: usedRetainedEvidenceFallback
        ? opportunities.map((item) => item.unmetNeed)
        : this.normalizeTextArray(
            parsed.unmetNeeds,
            opportunities.map((item) => item.unmetNeed),
          ),
      opportunities,
      overallConfidence: usedRetainedEvidenceFallback
        ? inferredConfidence
        : this.normalizeOptionalScore(
            parsed.overallConfidence,
            inferredConfidence,
          ),
      qualityWarnings: [
        ...safeProviderWarnings,
        ...(usedRetainedEvidenceFallback
          ? [
              'The online model returned no opportunity objects; retained direct community evidence was converted into a cautious grounded opportunity and still requires independent provenance verification.',
            ]
          : []),
        ...(opportunities.length <
        COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES
          ? [
              `Only ${opportunities.length} evidence-grounded opportunity candidate(s) could be supported; the preferred minimum is ${COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES}.`,
            ]
          : []),
      ],
      modelId,
      apiModelId,
      attemptCount,
    };
  }

  /**
   * Converts already-retained deterministic NLP findings into the exact
   * CommunityAiOpportunity contract when an online provider returns an empty
   * opportunities array. This is not an invented market hypothesis: every
   * recovered item must carry a verbatim sample that can later pass the same
   * corpus-grounding validation as a provider-created item.
   */
  private buildRetainedEvidenceFallbackOpportunities(
    context: IdeaGenerationContext,
  ): CommunityAiOpportunity[] {
    if (!context.nlp) {
      return [];
    }

    const primaryDomainName =
      context.selectedDomains[0]?.name ?? context.domainName ?? 'Unassigned';
    const primaryDomainId =
      context.selectedDomains[0]?.id ?? context.domainId;
    const primaryDomainEvidence = context.domainEvidence.find(
      (entry) =>
        entry.domainId === primaryDomainId ||
        this.normalizeComparableText(entry.domainName) ===
          this.normalizeComparableText(primaryDomainName),
    );
    const corpus = this.collectEvidenceCorpus({
      nlp: context.nlp,
      primaryDomainEvidence: primaryDomainEvidence ?? null,
    });
    const selectedDomainNames = new Map(
      context.selectedDomains.map((domain) => [
        this.normalizeComparableText(domain.name),
        domain.name,
      ]),
    );
    const sourceRecords: Record<string, unknown>[] = [];

    const appendRecords = (value: unknown): void => {
      if (!Array.isArray(value)) {
        return;
      }

      for (const entry of value) {
        if (this.isRecord(entry)) {
          sourceRecords.push(entry);
        }
      }
    };

    appendRecords(context.nlp.opportunities);
    appendRecords(context.nlp.recurringProblems);
    appendRecords(context.nlp.extractedNeeds);
    appendRecords(context.nlp.featureRequests);

    const recovered: CommunityAiOpportunity[] = [];
    const seenSignatures = new Set<string>();

    for (const record of sourceRecords) {
      if (recovered.length >= COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES) {
        break;
      }

      const problem = this.firstAvailableString(record, [
        'problem',
        'problemStatement',
        'description',
        'title',
        'need',
      ]);
      if (!problem || problem.length < 24) {
        continue;
      }

      const unmetNeed =
        this.firstAvailableString(record, [
          'unmetNeed',
          'need',
          'missingCapability',
          'title',
        ]) ?? `A reliable workflow that resolves: ${problem}`;
      const solutionArea =
        this.firstAvailableString(record, [
          'solutionArea',
          'solution',
          'direction',
        ]) ?? 'A focused software workflow for diagnosis, validation, and guided resolution.';

      const explicitEvidence = this.normalizeTextArray(
        record.evidenceSamples ?? record.evidence ?? record.examples,
        [],
        true,
      );
      const groundedEvidence = explicitEvidence
        .map((sample) => this.findGroundedCorpusMatch(sample, corpus))
        .filter((sample): sample is string => sample !== null);
      const descriptor = this.normalizeComparableText(
        `${problem} ${unmetNeed} ${solutionArea}`,
      );
      const corpusFallback = corpus.find(
        (sample) =>
          this.tokenOverlap(
            descriptor,
            this.normalizeComparableText(sample),
          ) >= 0.12,
      );
      const evidenceSample =
        this.selectStrongestFallbackEvidence(groundedEvidence) ?? corpusFallback;

      if (
        !evidenceSample ||
        this.looksLikePromotionalOrPublisherText(evidenceSample) ||
        !this.looksLikeDirectProblemEvidence(evidenceSample)
      ) {
        continue;
      }

      const repairedProblem = this.buildProfessionalFallbackProblem(
        problem,
        evidenceSample,
      );
      const repairedUnmetNeed = this.buildProfessionalFallbackNeed(
        unmetNeed,
        repairedProblem,
      );
      const repairedTitle = this.deriveTitle(
        repairedProblem,
        repairedUnmetNeed,
        evidenceSample,
      );

      const signature = this.normalizeComparableText(repairedProblem);
      if (!signature || seenSignatures.has(signature)) {
        continue;
      }
      seenSignatures.add(signature);

      const rawDomainName =
        this.firstAvailableString(record, ['domainName', 'domain']) ??
        primaryDomainName;
      const domainName =
        selectedDomainNames.get(
          this.normalizeComparableText(rawDomainName),
        ) ?? primaryDomainName;
      const confidence = Math.max(
        COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE,
        this.normalizeOptionalScore(record.confidence ?? record.aiConfidence, 45),
      );

      recovered.push({
        domainName,
        title: repairedTitle,
        problem: repairedProblem,
        unmetNeed: repairedUnmetNeed,
        solutionArea: this.boundProblemText(solutionArea, 180),
        affectedUsers: this.normalizeTextArray(
          record.affectedUsers ?? record.targetUsers,
          ['Affected community users'],
        ).slice(0, 2),
        evidenceSamples: [evidenceSample],
        frequency: this.normalizeOptionalPositiveInteger(record.frequency, 1),
        severity: this.normalizeSeverity(record.severity),
        confidence,
        problemImportance: this.normalizeOptionalScore(
          record.problemImportance ?? record.importance,
          confidence,
        ),
        localEvidenceAvailable: false,
        localEvidenceSamples: [],
        localRelevance: Math.min(
          25,
          this.normalizeOptionalScore(record.localRelevance, 20),
        ),
        groundingScore: 100,
        technicalFeasibility: this.normalizeOptionalScore(
          record.technicalFeasibility ?? record.feasibility,
          65,
        ),
        marketPotential: this.normalizeOptionalScore(
          record.marketPotential,
          45,
        ),
        innovationPotential: this.normalizeOptionalScore(
          record.innovationPotential,
          50,
        ),
        risks: this.normalizeTextArray(
          record.risks ?? record.limitations,
          [
            'The direction is supported by limited retained evidence and requires broader validation.',
          ],
        ).slice(0, 2),
      });
    }

    if (recovered.length > 0) {
      return recovered;
    }

    const strongestCorpusSample = this.selectStrongestFallbackEvidence(corpus);
    if (!strongestCorpusSample) {
      return [];
    }

    const extractedProblem =
      this.extractProblemSection(strongestCorpusSample) ||
      this.boundProblemText(strongestCorpusSample, 220);
    const problem = this.buildProfessionalFallbackProblem(
      extractedProblem,
      strongestCorpusSample,
    );
    const unmetNeed = this.buildProfessionalFallbackNeed('', problem);

    return [
      {
        domainName: primaryDomainName,
        title: this.deriveTitle(problem, unmetNeed, strongestCorpusSample),
        problem,
        unmetNeed,
        solutionArea:
          'A focused software workflow for diagnosis, validation, and guided resolution.',
        affectedUsers: ['Affected community users'],
        evidenceSamples: [strongestCorpusSample],
        frequency: 1,
        severity: 'MEDIUM',
        confidence: Math.max(
          40,
          COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE,
        ),
        problemImportance: 45,
        localEvidenceAvailable: false,
        localEvidenceSamples: [],
        localRelevance: 20,
        groundingScore: 100,
        technicalFeasibility: 65,
        marketPotential: 40,
        innovationPotential: 50,
        risks: [
          'The direction is supported by one retained sample and requires broader validation.',
        ],
      },
    ];
  }

  /**
   * Builds the guaranteed non-throwing community-analysis fallback from direct
   * evidence already retained by deterministic NLP. This is intentionally not
   * presented as an online-model result: model identifiers remain null.
   */
  private buildFallbackAnalysis(
    opportunities: readonly CommunityAiOpportunity[],
    attemptCount = 0,
  ): CommunityAiAnalysis {
    const averageConfidence =
      opportunities.reduce((sum, item) => sum + item.confidence, 0) /
      Math.max(opportunities.length, 1);

    return {
      summary: `Recovered ${opportunities.length} cautious opportunity candidate(s) from retained direct community evidence.`,
      dominantProblems: opportunities.map((item) => item.problem),
      unmetNeeds: opportunities.map((item) => item.unmetNeed),
      opportunities: [...opportunities],
      overallConfidence: averageConfidence,
      qualityWarnings: [
        'Online community enrichment was unavailable or unusable; retained direct evidence was preserved instead of failing the stage.',
        'The recovered direction remains preliminary until broader independent evidence is collected.',
      ],
      modelId: null,
      apiModelId: null,
      attemptCount,
    };
  }

  private firstAvailableString(
    record: Record<string, unknown>,
    keys: readonly string[],
  ): string | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.replace(/\s+/gu, ' ').trim();
      }
    }

    return null;
  }

  /**
   * Rejects schema-valid responses only when they are unusable or ungrounded.
   * Confidence is preserved as metadata and a warning, not treated as a hard
   * provider failure. This keeps documented low-confidence evidence available
   * for a clearly bounded pilot while still refusing evidence-free output.
   */
  private validateBusinessQuality(
    analysis: CommunityAiAnalysis,
    context: IdeaGenerationContext,
  ): void {
    const evidenceBackedOpportunities = analysis.opportunities.filter(
      (opportunity) => opportunity.evidenceSamples.length > 0,
    );

    if (evidenceBackedOpportunities.length === 0) {
      throw new Error(
        'Community AI analysis returned no evidence-backed opportunity.',
      );
    }

    const totalEvidenceSamples = evidenceBackedOpportunities.reduce(
      (total, opportunity) => total + opportunity.evidenceSamples.length,
      0,
    );

    if (
      totalEvidenceSamples < COMMUNITY_AI_ANALYSIS_MIN_TOTAL_EVIDENCE_SAMPLES
    ) {
      throw new Error(
        'The response did not include sufficient evidence samples.',
      );
    }

    const normalizedSignatures = new Set<string>();
    const selectedDomainNames = new Set(
      context.selectedDomains.map((domain) =>
        this.normalizeComparableText(domain.name),
      ),
    );
    const representedDomains = new Set<string>();

    for (const opportunity of evidenceBackedOpportunities) {
      const normalizedDomain = this.normalizeComparableText(
        opportunity.domainName,
      );

      if (
        selectedDomainNames.size > 0 &&
        !selectedDomainNames.has(normalizedDomain)
      ) {
        throw new Error(
          `Opportunity "${opportunity.title}" references an unselected domain "${opportunity.domainName}".`,
        );
      }

      representedDomains.add(normalizedDomain);

      const signature = this.normalizeComparableText(
        `${opportunity.problem} ${opportunity.unmetNeed} ${opportunity.solutionArea}`,
      );

      if (signature.length < 24) {
        throw new Error('An opportunity was too generic to be accepted.');
      }

      if (normalizedSignatures.has(signature)) {
        throw new Error('The response contained duplicate opportunities.');
      }

      for (const existingSignature of normalizedSignatures) {
        if (this.tokenOverlap(signature, existingSignature) >= 0.72) {
          throw new Error(
            'The response contained materially overlapping opportunities instead of distinct problem families.',
          );
        }
      }

      if (opportunity.risks.length === 0) {
        throw new Error(
          `Opportunity "${opportunity.title}" did not include any explicit risk or evidence limitation.`,
        );
      }

      normalizedSignatures.add(signature);
    }

    const representedSelectedDomainCount = context.selectedDomains.filter(
      (domain) =>
        representedDomains.has(this.normalizeComparableText(domain.name)),
    ).length;

    /*
     * Multi-domain requests frequently contain useful evidence for only one of
     * the selected domains inside the fast collection budget. Requiring every
     * domain to appear rejected valid AI analyses and forced a deterministic
     * fallback. Accept the strongest evidence-backed selected domain instead;
     * unsupported domains are simply omitted and are never fabricated.
     */
    if (
      context.selectedDomains.length > 0 &&
      representedSelectedDomainCount === 0
    ) {
      throw new Error(
        `The response did not contain an evidence-backed opportunity for any selected domain: ${context.selectedDomains.map((domain) => domain.name).join(', ')}.`,
      );
    }
  }

  private parseOpportunity(value: unknown): CommunityAiOpportunity {
    const normalizedValue = this.normalizeOpportunityValue(value);

    const rawProblem = this.firstString(normalizedValue, [
      'problem',
      'problemStatement',
      'painPoint',
      'description',
    ]);
    const unmetNeed = this.firstString(normalizedValue, [
      'unmetNeed',
      'need',
      'userNeed',
      'missingCapability',
    ]);
    const solutionArea = this.firstString(normalizedValue, [
      'solutionArea',
      'solution',
      'proposedSolution',
      'opportunityArea',
      'direction',
    ]);

    const evidenceSamples = this.normalizeTextArray(
      normalizedValue.evidenceSamples ??
        normalizedValue.evidence ??
        normalizedValue.examples ??
        normalizedValue.quotes,
      [],
    );
    const problem = this.repairTruncatedProblemFromEvidence(
      rawProblem,
      evidenceSamples,
    );

    const severity = this.normalizeSeverity(
      normalizedValue.severity ?? normalizedValue.impactLevel ?? normalizedValue.priority,
    );

    const confidence = this.normalizeOptionalScore(
      normalizedValue.confidence ?? normalizedValue.score,
      50,
    );

    return {
      domainName: this.optionalString(
        normalizedValue.domainName ?? normalizedValue.domain ?? normalizedValue.category,
        'Unassigned',
      ),
      title: this.optionalString(
        normalizedValue.title ?? normalizedValue.name,
        this.deriveTitle(problem, unmetNeed),
      ),
      problem,
      unmetNeed,
      solutionArea,
      affectedUsers: this.normalizeTextArray(
        normalizedValue.affectedUsers ?? normalizedValue.targetUsers ?? normalizedValue.users,
        ['Affected community users'],
      ),
      evidenceSamples,
      frequency: this.normalizeOptionalPositiveInteger(
        normalizedValue.frequency ?? normalizedValue.occurrences ?? normalizedValue.count,
        1,
      ),
      severity,
      confidence,
      problemImportance: this.normalizeOptionalScore(
        normalizedValue.problemImportance ?? normalizedValue.importance ?? normalizedValue.impact,
        confidence,
      ),
      localEvidenceAvailable:
        normalizedValue.localEvidenceAvailable === true ||
        normalizedValue.hasLocalEvidence === true,
      localEvidenceSamples: this.normalizeTextArray(
        normalizedValue.localEvidenceSamples ?? normalizedValue.localEvidence,
        [],
        true,
      ),
      localRelevance: this.normalizeOptionalScore(
        normalizedValue.localRelevance ?? normalizedValue.relevance,
        25,
      ),
      groundingScore: 0,
      technicalFeasibility: this.normalizeOptionalScore(
        normalizedValue.technicalFeasibility ?? normalizedValue.feasibility,
        60,
      ),
      marketPotential: this.normalizeOptionalScore(
        normalizedValue.marketPotential ?? normalizedValue.marketScore,
        50,
      ),
      innovationPotential: this.normalizeOptionalScore(
        normalizedValue.innovationPotential ?? normalizedValue.innovation,
        50,
      ),
      risks: this.normalizeTextArray(
        normalizedValue.risks ?? normalizedValue.riskFactors ?? normalizedValue.limitations,
        [],
        true,
      ),
    };
  }

  /**
   * Accepts the two common structured-output shapes returned by providers.
   *
   * Preferred shape: a complete opportunity object.
   * Tolerated shape: a plain opportunity description string. The string is
   * promoted to the required semantic fields and is later grounded against the
   * persisted NLP corpus. Unsupported promoted opportunities are discarded by
   * applyEvidenceGrounding(), so tolerance never bypasses evidence validation.
   */
  private normalizeOpportunityValue(
    value: unknown,
  ): Record<string, unknown> {
    if (this.isRecord(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const description = value.replace(/\s+/gu, ' ').trim();

      return {
        title: this.deriveTitle(description, description),
        problem: description,
        unmetNeed: description,
        solutionArea:
          'Combine the related community pain points into one focused software workflow.',
        affectedUsers: ['Affected community users'],
        evidenceSamples: [description],
        frequency: 1,
        severity: 'MEDIUM',
        confidence: 50,
        problemImportance: 50,
        technicalFeasibility: 60,
        marketPotential: 50,
        innovationPotential: 55,
        risks: [
          'The provider returned a compact opportunity description; direct evidence grounding is required.',
        ],
      };
    }

    throw new Error('Community AI analysis returned an invalid opportunity.');
  }

  /**
   * Selects the most informative retained evidence sample for deterministic
   * fallback construction. Complaint specificity and concrete risk signals
   * outrank length, praise, calls to action, and generic commentary.
   */
  private selectStrongestFallbackEvidence(
    corpus: readonly string[],
  ): string | undefined {
    return [...corpus]
      .filter((sample) => sample.trim().length >= 40)
      .filter((sample) => !this.looksLikePromotionalOrPublisherText(sample))
      .filter((sample) => this.looksLikeDirectProblemEvidence(sample))
      .map((sample) => {
        const normalized = this.normalizeComparableText(sample);
        let score = Math.min(sample.length, 320) / 80;

        if (/(?:security|vulnerabilit|hack|breach|unsafe)/u.test(normalized)) {
          score += 6;
        }
        if (/(?:bill|billing|cloud cost|cost spike|30k|2k|financial exposure)/u.test(normalized)) {
          score += 5;
        }
        if (/(?:found|detected|reported|caused|risk|problem|failed|missing|broken|slow|cannot|can t|doesn t|does not)/u.test(normalized)) {
          score += 4;
        }
        if (/(?:i |my |we |our |user |developer |customer )/u.test(normalized)) {
          score += 2;
        }
        if (/(?:liked and subbed|thank you|kudos|part 2|please do)/u.test(normalized)) {
          score -= 4;
        }

        return { sample, score };
      })
      .sort((first, second) => second.score - first.score)[0]?.sample;
  }

  /**
   * Promotional titles, app-review descriptions, tutorials, and outbound links
   * describe content or products; they are not evidence that a user actually
   * experienced a problem. Keeping them out of deterministic fallback prevents
   * strings such as "Check out the app here" from becoming opportunity text.
   */
  private looksLikePromotionalOrPublisherText(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim().toLowerCase();
    const hasUrl = /https?:\/\/|www\.|play\.google\.|apps\.apple\.com|app\s*store/u.test(normalized);
    const promotionalPhrase = /(?:check out|download|install|app review|review of|subscribe|liked and subbed|link in (?:the )?description|use my code|sponsored|available now|try it|watch the full|tutorial|guide)/u.test(normalized);
    const titleLike = /\|/u.test(value) && !/(?:i |my |we |our |can t|cannot|doesn t|does not|failed|broken|missing|problem|issue|bug|need|wish|want)/u.test(normalized);

    return (hasUrl && promotionalPhrase) || promotionalPhrase || titleLike;
  }

  /** Returns true only for text that contains an observable user pain signal. */
  private looksLikeDirectProblemEvidence(value: string): boolean {
    const raw = value.replace(/\s+/gu, ' ').trim();
    const communityCommentMatch = raw.match(/\bCommunity comment:\s*(.+)$/iu);
    const evidenceBody = communityCommentMatch?.[1]?.trim() ?? raw;
    const normalized = this.normalizeComparableText(evidenceBody);

    if (!normalized || this.looksLikePromotionalOrPublisherText(evidenceBody)) {
      return false;
    }

    const explicitPain = /(?:cannot|can t|unable|does not work|doesn t work|not working|fail|failed|failure|error|wrong|incorrect|inaccurate|miscalculat|hallucinat|crash|slow|delay|missing|lost|loss|risk|unsafe|vulnerabilit|hack|breach|expensive|cost|bill|manual|rewrite|refactor|confusing|frustrat|struggle|please add|feature request)/u.test(normalized);
    const directNeedOrWish =
      /(?:^|\s)(?:i|we|my|our|user|users|customer|customers|developer|developers|operator|operators|learner|learners)(?:\s+[^.!?]{0,45})?\s+(?:need|needs|needed|wish|wishes)\b/u.test(normalized) ||
      /\b(?:need|needs|needed)\s+(?:a|an|the|better|more|less|to)\s+(?:app|application|platform|service|feature|option|setting|support|workflow|tool|software|system|way|ability|integration)\b/u.test(normalized);
    const comprehensionOrPraiseOnly = /(?:i think i understand|i understand now|makes sense|so much easier|helped me understand|great explanation|thank you|thanks|love this|amazing|awesome)/u.test(normalized) &&
      !/(?:cannot|can t|unable|error|fail|broken|missing|wrong|confusing|difficult|frustrat|struggle|need|wish)/u.test(normalized);
    const positiveRecommendationOnly =
      /(?:highly recommend|recommend(?:ed|ing)?|great company|great app|excellent|works great|very satisfied|five stars?|5 stars?|love (?:the|this) app)/u.test(normalized) &&
      !/(?:cannot|can t|unable|does not work|doesn t work|not working|error|fail|broken|bug|missing|incorrect|wrong|crash|freeze|slow|confusing|difficult|frustrat|struggle|support|refund|withdraw)/u.test(normalized);
    const firstPersonExperience = /(?:^|\s)(?:i|my|we|our|user|users|developer|developers|customer|customers)(?:\s|$)/u.test(normalized);
    const concreteOutcome = /(?:hours?|days?|times?|\$\s*\d+|\d+\s*(?:bugs?|issues?|vulnerabilities|errors?)|racked up|data loss|financial exposure)/u.test(evidenceBody.toLowerCase());

    return (explicitPain || directNeedOrWish) &&
      !comprehensionOrPraiseOnly &&
      !positiveRecommendationOnly &&
      (firstPersonExperience || concreteOutcome || directNeedOrWish || /(?:please add|feature request)/u.test(normalized));
  }

  private firstString(
    record: Record<string, unknown>,
    keys: readonly string[],
  ): string {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    throw new Error(
      `Community AI analysis is missing a required semantic field (${keys.join(' | ')}).`,
    );
  }

  /**
   * Repairs provider text that ends mid-word by extracting the explicit problem
   * section from the verbatim evidence sample. This is deterministic and adds
   * no provider request.
   */
  private repairTruncatedProblemFromEvidence(
    problem: string,
    evidenceSamples: readonly string[],
  ): string {
    const normalized = problem.replace(/\s+/gu, ' ').trim();
    if (!this.looksTruncatedProblem(normalized)) {
      return normalized;
    }

    for (const sample of evidenceSamples) {
      const extracted = this.extractProblemSection(sample);
      if (extracted.length >= 35) {
        return this.boundProblemText(extracted, 240);
      }
    }

    return this.boundProblemText(normalized, 240);
  }

  private looksTruncatedProblem(value: string): boolean {
    if (!value) {
      return true;
    }

    if (/[.!?]["')\]]?$/u.test(value)) {
      return false;
    }

    const words = value.split(/\s+/u).filter(Boolean);
    const lastWord = words.at(-1)?.replace(/[^\p{L}\p{N}-]+/gu, '') ?? '';

    return value.length < 170 && (lastWord.length <= 4 || words.length < 9);
  }

  private extractProblemSection(value: string): string {
    const normalized = value
      .replace(/\r?\n/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    /*
     * Treat these words as section labels only when they appear at the start
     * of the text or are followed by an explicit colon. A normal sentence
     * such as "the security problem of the apps..." must never be split at
     * the word "problem" because doing so drops the semantic subject.
     */
    const labeled = normalized.match(
      /^(?:#{1,6}\s*)?(?:🤔\s*)?(?:problem statement|problem|issue|pain point)\s*(?::|[-–—])\s*(.+?)(?=\s+(?:#{1,6}\s*)?(?:🛠️\s*)?(?:proposed solution|solution|alternatives considered|feature summary|mockups|additional context)\b|$)/iu,
    );

    if (labeled?.[1]) {
      return labeled[1]
        .replace(/^[\s:–—-]+/u, '')
        .replace(/\s+/gu, ' ')
        .trim();
    }

    const firstSentence = normalized.match(/^(.{35,360}?[.!?])(?:\s|$)/u);
    return firstSentence?.[1]?.trim() ?? '';
  }

  private boundProblemText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    const bounded = normalized.slice(0, maxLength);
    const sentenceBoundary = Math.max(
      bounded.lastIndexOf('.'),
      bounded.lastIndexOf('!'),
      bounded.lastIndexOf('?'),
    );
    const wordBoundary = bounded.lastIndexOf(' ');
    const end =
      sentenceBoundary >= 80
        ? sentenceBoundary + 1
        : wordBoundary >= 80
          ? wordBoundary
          : maxLength;

    return bounded.slice(0, end).replace(/[\s,;:–—-]+$/u, '').trim();
  }

  private optionalString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private normalizeTextArray(
    value: unknown,
    fallback: readonly string[],
    allowEmpty = false,
  ): string[] {
    const source = Array.isArray(value) ? value : value == null ? [] : [value];
    const normalized = source
      .map((item) => this.textFromUnknown(item))
      .filter((item): item is string => Boolean(item));

    const result = [...new Set(normalized.length > 0 ? normalized : fallback)];
    if (!allowEmpty && result.length === 0) {
      throw new Error(
        'Community AI analysis returned an empty text collection.',
      );
    }
    return result;
  }

  private textFromUnknown(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.trim() || null;
    }
    if (!this.isRecord(value)) {
      return null;
    }
    for (const key of [
      'text',
      'title',
      'problem',
      'need',
      'description',
      'value',
    ]) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  private normalizeOptionalScore(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return Math.max(0, Math.min(100, fallback));
    }
    const normalized = value <= 1 ? value * 100 : value;
    return Math.round(Math.max(0, Math.min(100, normalized)) * 100) / 100;
  }

  private normalizeOptionalPositiveInteger(
    value: unknown,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.max(1, Math.round(value));
  }

  private normalizeSeverity(
    value: unknown,
  ): CommunityAiOpportunity['severity'] {
    if (typeof value === 'string') {
      const normalized = value.trim().toUpperCase();
      if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized)) {
        return normalized as CommunityAiOpportunity['severity'];
      }
      if (['SEVERE', 'URGENT', 'VERY HIGH'].includes(normalized))
        return 'CRITICAL';
      if (['MODERATE', 'NORMAL'].includes(normalized)) return 'MEDIUM';
    }
    return 'MEDIUM';
  }

  /**
   * Builds a stable, professional title from the semantic content of the
   * retained evidence. It intentionally avoids copying an arbitrary substring
   * from the middle of a community comment.
   */
  private deriveTitle(
    problem: string,
    unmetNeed: string,
    evidenceSample = '',
  ): string {
    const semanticText = this.normalizeComparableText(
      `${problem} ${unmetNeed} ${evidenceSample}`,
    );

    if (
      /(?:security|vulnerabilit|hack|breach|unsafe)/u.test(semanticText) &&
      /(?:bill|billing|cloud cost|cost spike|financial exposure|30k|2k)/u.test(
        semanticText,
      )
    ) {
      return 'AI-Generated Application Security and Cost Risk';
    }

    if (
      /(?:llm|large language model|ai coding|generated code|code assistant)/u.test(
        semanticText,
      ) &&
      /(?:bloated|poorly organized|refactor|rewrite|pushback|doesn t understand|does not understand|invalid request|nonsensical)/u.test(
        semanticText,
      )
    ) {
      return 'LLM-Generated Code Quality and Validation Failures';
    }

    if (
      /(?:accounting|invoice|quickbooks|customer email|financial software)/u.test(
        semanticText,
      ) &&
      /(?:slow|load|save|saved|missing|disappear|persistence|data loss)/u.test(
        semanticText,
      )
    ) {
      return 'Accounting Software Performance and Data Persistence Failures';
    }

    if (
      /(?:energy|solar|power|telemetry|generation|monitor)/u.test(semanticText) &&
      /(?:offline|reconnect|connection|doesn t work|does not work|not reliable|incorrect location|unable to correct|unresponsive|error)/u.test(
        semanticText,
      )
    ) {
      return 'Energy Monitoring Reliability and Connection Failures';
    }

    const source = this.cleanFallbackFragment(unmetNeed || problem);
    if (this.looksLikePromotionalOrPublisherText(source)) {
      return 'Evidence-Grounded Software Workflow Opportunity';
    }
    const words = source
      .replace(/^(?:a|an|the)\s+/iu, '')
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 10)
      .join(' ')
      .replace(/[.,;:!?]+$/u, '')
      .trim();

    return words.length >= 8 ? this.toTitleCase(words) : 'Evidence-Grounded Software Workflow Opportunity';
  }

  /**
   * Low confidence is evidence metadata, not a transport failure. A grounded
   * response remains usable as a preliminary pilot and carries an explicit
   * warning instead of forcing an unnecessary provider failure/fallback.
   */
  private preserveGroundedLowConfidenceAnalysis(
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    if (
      analysis.overallConfidence >= COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE
    ) {
      return analysis;
    }

    return {
      ...analysis,
      qualityWarnings: [
        ...analysis.qualityWarnings,
        `Overall confidence is ${analysis.overallConfidence}/100, below the preferred ${COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE}/100 threshold. The grounded opportunity is retained only as a preliminary pilot and must not be presented as a market-wide conclusion.`,
      ],
    };
  }

  private extractStrongestDirectProblemSentence(value: string): string | null {
    const body = value
      .replace(
        /^.*?\bCommunity comment:\s*/isu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();

    if (!body) {
      return null;
    }

    const candidates = body
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 20)
      .filter((sentence) => this.looksLikeDirectProblemEvidence(sentence))
      .map((sentence) => {
        const normalized = this.normalizeComparableText(sentence);
        let score = Math.min(sentence.length, 240) / 80;

        if (/(?:cannot|can t|unable|not working|fail|failed|error|wrong|incorrect|crash|slow|delay|wait too long|missing|risk|bias|liability|responsib|transparent|privacy|unsafe|struggle|difficult|problem|issue)/u.test(normalized)) {
          score += 5;
        }
        if (/(?:i |my |we |our |user |users |patient |patients |developer |developers |clinician |clinicians )/u.test(normalized)) {
          score += 2;
        }

        return { sentence, score };
      })
      .sort((first, second) => second.score - first.score);

    return candidates[0]?.sentence ?? null;
  }

  private buildProfessionalFallbackProblem(
    candidateProblem: string,
    evidenceSample: string,
  ): string {
    const directEvidenceSentence =
      this.extractStrongestDirectProblemSentence(evidenceSample);
    const candidateIsDirectProblem =
      this.looksLikeDirectProblemEvidence(candidateProblem);

    /*
     * Provider/NLP fallback records sometimes expose the parent video title as
     * the candidate problem while the actual complaint lives inside
     * "Community comment:". Prefer the verbatim direct-problem sentence in that
     * case so downstream problem-family matching can resolve the same persisted
     * source without synthetic paraphrase drift.
     */
    if (
      directEvidenceSentence &&
      (!candidateIsDirectProblem ||
        this.looksLikePromotionalOrPublisherText(candidateProblem))
    ) {
      return this.boundProblemText(directEvidenceSentence, 260);
    }

    const semanticText = this.normalizeComparableText(
      `${candidateProblem} ${evidenceSample}`,
    );

    if (
      /(?:security|vulnerabilit|hack|breach|unsafe)/u.test(semanticText) &&
      /(?:bill|billing|cloud cost|cost spike|financial exposure|30k|2k)/u.test(
        semanticText,
      )
    ) {
      return 'A developer reported that security vulnerabilities in an AI-assisted application could have caused substantial unexpected cloud costs before deployment.';
    }

    if (
      /(?:llm|large language model|ai coding|generated code|code assistant)/u.test(
        semanticText,
      ) &&
      /(?:bloated|refactor|rewrite|pushback|doesn t understand|does not understand|pretends|nonsensical)/u.test(
        semanticText,
      )
    ) {
      return 'Developers report that LLM coding assistants may accept invalid or unclear requests without challenge, hide uncertainty instead of requesting clarification, and generate bloated or poorly organized code that requires extensive manual refactoring.';
    }

    if (
      /(?:finance|financial|budget|spreadsheet|equation|algorithm|math|calculation)/u.test(
        semanticText,
      ) &&
      /(?:wrong|incorrect|inaccurate|error|miscalculat|confident|same dumb loop|kept doing|repeated)/u.test(
        semanticText,
      )
    ) {
      return 'A finance user reported that an AI assistant produced an incorrect equation with high confidence and continued returning incorrect revisions after the error was explicitly reported.';
    }

    if (
      /(?:accounting|invoice|quickbooks|customer email|financial software)/u.test(
        semanticText,
      ) &&
      /(?:slow|load|save|saved|missing|disappear|persistence|data loss)/u.test(
        semanticText,
      )
    ) {
      return 'Users report slow financial-software workflows and data-persistence failures in which customer details or invoice actions appear to save but later disappear, forcing repeated manual entry.';
    }

    const cleaned = this.cleanFallbackFragment(candidateProblem);
    if (
      cleaned.length >= 35 &&
      !this.looksLikePromotionalOrPublisherText(cleaned)
    ) {
      return this.boundProblemText(cleaned, 260);
    }

    const extracted = this.extractProblemSection(evidenceSample);
    const evidenceDerived = this.cleanFallbackFragment(extracted || evidenceSample);
    if (
      evidenceDerived.length >= 35 &&
      !this.looksLikePromotionalOrPublisherText(evidenceDerived)
    ) {
      return this.boundProblemText(evidenceDerived, 260);
    }

    return 'The retained evidence indicates a possible software-workflow concern, but it does not contain a sufficiently explicit user complaint or unmet need to support a stronger problem statement.';
  }

  private buildProfessionalFallbackNeed(
    candidateNeed: string,
    repairedProblem: string,
  ): string {
    const cleanedNeed = this.cleanFallbackFragment(candidateNeed)
      .replace(/^a reliable workflow that resolves\s*:\s*/iu, '')
      .trim();

    const semanticText = this.normalizeComparableText(
      `${cleanedNeed} ${repairedProblem}`,
    );

    if (
      /(?:security|vulnerabilit|hack|breach|unsafe)/u.test(semanticText) &&
      /(?:bill|billing|cloud cost|cost spike|financial exposure)/u.test(
        semanticText,
      )
    ) {
      return 'A focused security-audit workflow that identifies high-risk vulnerabilities and cost-inflating configurations before an AI-assisted application reaches production.';
    }

    if (
      /(?:llm|large language model|ai coding|generated code)/u.test(semanticText)
    ) {
      return 'A validation workflow that challenges ambiguous AI coding requests, exposes uncertainty, and flags bloated or poorly structured generated code before repository integration.';
    }

    if (
      /(?:finance|financial|budget|spreadsheet|equation|algorithm|math|calculation)/u.test(
        semanticText,
      ) &&
      /(?:wrong|incorrect|inaccurate|error|miscalculat|confident|repeated)/u.test(
        semanticText,
      )
    ) {
      return 'A verification workflow that checks AI-generated financial equations against deterministic calculations, exposes mismatches, and requires human review before the result is reused.';
    }

    if (
      /(?:accounting|invoice|financial software|customer details)/u.test(
        semanticText,
      )
    ) {
      return 'A fast, reliable accounting workflow that persists customer and invoice data without silent loss or duplicate manual entry.';
    }

    return cleanedNeed.length >= 30 &&
      !this.looksLikePromotionalOrPublisherText(cleanedNeed)
      ? this.boundProblemText(cleanedNeed, 220)
      : 'A bounded validation workflow that gathers explicit user complaints, classifies the recurring problem, and tests a focused software response before broader implementation.';
  }

  /** Removes broken sentence prefixes created by upstream bounded slicing. */
  private cleanFallbackFragment(value: string): string {
    let normalized = value.replace(/\s+/gu, ' ').trim();

    normalized = normalized
      .replace(/^s that leap out at me the most[.!?]?\s*/iu, '')
      .replace(/^that leap out at me the most[.!?]?\s*/iu, '')
      .replace(/^the most[.!?]?\s*/iu, '')
      .replace(/^(?:and|but|so|because)\s+/iu, '')
      .trim();

    if (normalized && /^[a-z]/u.test(normalized)) {
      normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    return normalized;
  }

  private toTitleCase(value: string): string {
    const minorWords = new Set(['and', 'or', 'for', 'to', 'of', 'in', 'on', 'with']);
    return value
      .split(/\s+/u)
      .map((word, index) => {
        const lower = word.toLowerCase();
        if (index > 0 && minorWords.has(lower)) {
          return lower;
        }
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  }

  private singularizeSingleReportProblem(value: string): string {
    return value
      .replace(
        /\bUsers experience complete failure when attempting to\b/giu,
        'One user reported a complete failure when attempting to',
      )
      .replace(
        /\bUsers (?:experience|encounter|face)\b/giu,
        'One user reported experiencing',
      )
      .replace(
        /\bVehicle owners (?:experience|encounter|face|fail to)\b/giu,
        'One vehicle owner reported experiencing',
      )
      .replace(
        /\b([A-Z][\p{L}'’&-]*(?:\s+[A-Z][\p{L}'’&-]*){0,3}) buyers (?:experience|encounter|face)\b/gu,
        'One buyer in $1 reported experiencing',
      )
      .replace(
        /\bBuyers (?:experience|encounter|face)\b/giu,
        'One buyer reported experiencing',
      )
      .replace(
        /\b(?:Language learners|Online learners|Learners|Students) lack\b/giu,
        'One learner reported lacking',
      )
      .replace(
        /\b(?:Language learners|Online learners|Learners|Students) (?:experience|encounter|face)\b/giu,
        'One learner reported experiencing',
      )
      .replace(
        /\b(?:a )?recurring challenge where vehicle owners fail to\b/giu,
        'a pairing difficulty reported by one vehicle owner who was unable to',
      )
      .replace(
        /\b(?:users|operators|customers|developers|creators|learners|students|buyers|sellers) (?:often|frequently|commonly|typically)\b/giu,
        'one observed user',
      )
      .replace(/\s{2,}/gu, ' ')
      .trim();
  }

  private normalizeComparableText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Grounds AI-generated opportunities against the persisted NLP evidence.
   *
   * Unsupported evidence samples are removed. An individual opportunity
   * is discarded when none of its evidence samples can be grounded.
   *
   * The complete AI response is rejected only when no grounded
   * opportunities remain.
   */
  private applyEvidenceGrounding(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
    allowExactRetainedEvidence = false,
  ): CommunityAiAnalysis {
    if (!context.nlp) {
      throw new Error('NLP evidence is required for grounding validation.');
    }

    const corpus = this.collectEvidenceCorpus(context.nlp);

    if (corpus.length === 0) {
      throw new Error(
        'No persisted NLP evidence samples are available for grounding.',
      );
    }

    const locationTerms = [
      context.location.country,
      context.location.city ?? '',
      context.location.region ?? '',
    ]
      .map((term) => this.normalizeComparableText(term))
      .filter((term) => term.length >= 3);

    const discardedOpportunityTitles: string[] = [];

    const groundedOpportunities = analysis.opportunities.flatMap(
      (opportunity): CommunityAiOpportunity[] => {
        const groundedEvidence = opportunity.evidenceSamples.flatMap(
          (sample): string[] => {
            const groundedSample = this.findGroundedCorpusMatch(sample, corpus);
            if (!groundedSample) {
              return [];
            }

            const exactRetainedEvidence =
              allowExactRetainedEvidence &&
              this.isExactOrContainedEvidenceMatch(sample, groundedSample);

            if (
              !exactRetainedEvidence &&
              !this.supportsOpportunity(opportunity, groundedSample)
            ) {
              return [];
            }

            return [groundedSample];
          },
        );

        const uniqueEvidence = [...new Set(groundedEvidence)].slice(0, 5);

        /*
         * Do not reject the complete provider response because one
         * opportunity was unsupported. Discard only that opportunity.
         */
        if (uniqueEvidence.length === 0) {
          discardedOpportunityTitles.push(opportunity.title);
          return [];
        }

        const groundingScore = Math.round(
          (uniqueEvidence.length /
            Math.max(opportunity.evidenceSamples.length, 1)) *
            100,
        );

        const localEvidenceSamples = uniqueEvidence.filter((sample) => {
          const normalizedSample = this.normalizeComparableText(sample);

          return locationTerms.some((term) => normalizedSample.includes(term));
        });

        const localEvidenceAvailable = localEvidenceSamples.length > 0;

        const groundedRisks = localEvidenceAvailable
          ? opportunity.risks
          : opportunity.risks.filter(
              (risk) => !this.isUnsupportedLocalRisk(risk, locationTerms),
            );

        const primaryEvidence = uniqueEvidence[0] ?? '';
        const problemIsDirect =
          this.looksLikeDirectProblemEvidence(opportunity.problem) &&
          !this.looksLikePromotionalOrPublisherText(opportunity.problem);
        const problemMatchesEvidence =
          this.tokenOverlap(
            this.normalizeComparableText(opportunity.problem),
            this.normalizeComparableText(primaryEvidence),
          ) >= 0.16;

        const baseGroundedProblem =
          problemIsDirect && problemMatchesEvidence
            ? opportunity.problem
            : this.buildProfessionalFallbackProblem(
                opportunity.problem,
                primaryEvidence,
              );
        const groundedProblem =
          uniqueEvidence.length === 1
            ? this.singularizeSingleReportProblem(baseGroundedProblem)
            : baseGroundedProblem;
        const groundedNeed = this.buildProfessionalFallbackNeed(
          opportunity.unmetNeed,
          groundedProblem,
        );
        const groundedTitle = this.deriveTitle(
          groundedProblem,
          groundedNeed,
          primaryEvidence,
        );

        return [
          {
            ...opportunity,
            title: groundedTitle,
            problem: groundedProblem,
            unmetNeed: groundedNeed,
            evidenceSamples: uniqueEvidence,
            groundingScore,
            localEvidenceAvailable,
            localEvidenceSamples,
            localRelevance: localEvidenceAvailable
              ? opportunity.localRelevance
              : Math.min(opportunity.localRelevance, 25),
            risks:
              groundedRisks.length > 0
                ? groundedRisks
                : [
                    'Direct local evidence is limited and requires further validation.',
                  ],
          },
        ];
      },
    );

    if (groundedOpportunities.length === 0) {
      throw new Error(
        'The AI response did not contain any opportunity supported by the persisted NLP evidence.',
      );
    }

    return {
      ...analysis,
      dominantProblems: groundedOpportunities.map(
        (opportunity) => opportunity.problem,
      ),
      unmetNeeds: groundedOpportunities.map(
        (opportunity) => opportunity.unmetNeed,
      ),
      opportunities: groundedOpportunities,
      qualityWarnings: [
        ...analysis.qualityWarnings,

        ...(discardedOpportunityTitles.length > 0
          ? [
              `${discardedOpportunityTitles.length} unsupported opportunity candidate(s) were discarded during evidence grounding.`,
            ]
          : []),

        ...(groundedOpportunities.some(
          (opportunity) => !opportunity.localEvidenceAvailable,
        )
          ? [
              'Requested location is treated as a pilot target where direct local evidence is unavailable.',
            ]
          : []),
      ],
    };
  }

  private collectEvidenceCorpus(value: unknown): string[] {
    const collected: string[] = [];

    const visit = (entry: unknown): void => {
      if (typeof entry === 'string') {
        const normalized = entry.replace(/\s+/gu, ' ').trim();
        if (normalized.length >= 12) collected.push(normalized);
        return;
      }
      if (Array.isArray(entry)) {
        for (const child of entry) visit(child);
        return;
      }
      if (this.isRecord(entry)) {
        for (const [key, child] of Object.entries(entry)) {
          if (
            [
              'evidenceSamples',
              'samplePosts',
              'sampleComments',
              'text',
              'content',
              'body',
              'title',
            ].includes(key)
          ) {
            visit(child);
          } else if (typeof child === 'object' && child !== null) {
            visit(child);
          }
        }
      }
    };

    visit(value);
    return [...new Set(collected)];
  }

  private providerReturnedNoOpportunities(text: string): boolean {
    try {
      const parsed: unknown = JSON.parse(text);
      return (
        this.isRecord(parsed) &&
        Array.isArray(parsed.opportunities) &&
        parsed.opportunities.length === 0
      );
    } catch {
      return false;
    }
  }

  private isExactOrContainedEvidenceMatch(
    sample: string,
    corpusSample: string,
  ): boolean {
    const normalizedSample = this.normalizeComparableText(sample);
    const normalizedCorpusSample = this.normalizeComparableText(corpusSample);

    if (
      normalizedSample.length < 12 ||
      normalizedCorpusSample.length < 12
    ) {
      return false;
    }

    return (
      normalizedSample === normalizedCorpusSample ||
      normalizedCorpusSample.includes(normalizedSample) ||
      normalizedSample.includes(normalizedCorpusSample)
    );
  }

  private findGroundedCorpusMatch(
    sample: string,
    corpus: readonly string[],
  ): string | null {
    const normalizedSample = this.normalizeComparableText(sample);
    if (normalizedSample.length < 12) return null;

    let best: { text: string; score: number } | null = null;
    for (const source of corpus) {
      const normalizedSource = this.normalizeComparableText(source);
      if (
        normalizedSource.includes(normalizedSample) ||
        normalizedSample.includes(normalizedSource)
      ) {
        return source;
      }
      const score = this.tokenOverlap(normalizedSample, normalizedSource);
      if (!best || score > best.score) best = { text: source, score };
    }
    return best && best.score >= 0.55 ? best.text : null;
  }

  private supportsOpportunity(
    opportunity: CommunityAiOpportunity,
    sample: string,
  ): boolean {
    const descriptor = this.normalizeComparableText(
      `${opportunity.problem} ${opportunity.unmetNeed} ${opportunity.solutionArea}`,
    );
    return (
      this.tokenOverlap(descriptor, this.normalizeComparableText(sample)) >=
      0.12
    );
  }

  private tokenOverlap(first: string, second: string): number {
    const ignored = new Set([
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'from',
      'have',
      'has',
      'are',
      'was',
      'were',
      'user',
      'users',
      'app',
      'application',
      'system',
    ]);
    const firstTokens = new Set(
      first
        .split(' ')
        .filter((token) => token.length >= 3 && !ignored.has(token)),
    );
    const secondTokens = new Set(
      second
        .split(' ')
        .filter((token) => token.length >= 3 && !ignored.has(token)),
    );
    if (firstTokens.size === 0 || secondTokens.size === 0) return 0;
    let intersection = 0;
    for (const token of firstTokens)
      if (secondTokens.has(token)) intersection += 1;
    return intersection / Math.min(firstTokens.size, secondTokens.size);
  }

  private isUnsupportedLocalRisk(
    risk: string,
    locationTerms: readonly string[],
  ): boolean {
    const normalized = this.normalizeComparableText(risk);
    return (
      locationTerms.some((term) => normalized.includes(term)) ||
      /\b(?:local expertise|infrastructure|resource constraints|economic|regulatory|connectivity|west bank|palestine|nablus)\b/iu.test(
        normalized,
      )
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown community AI analysis failure';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}