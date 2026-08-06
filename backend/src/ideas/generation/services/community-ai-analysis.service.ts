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
    const onlineModels = await this.findOnlineFallbackModels();
    const startedAt = Date.now();
    let lastError: unknown = null;

    /*
     * Use explicit ONLINE model rotation only. Ollama is intentionally excluded.
     * Each attempt has its own provider timeout and the complete chain has a
     * hard wall-clock cap, so a provider cannot keep the pipeline blocked for
     * minutes while structured-output repair or internal retries are running.
     */
    for (
      let attempt = 1;
      attempt <= Math.min(
        COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS,
        Math.max(1, onlineModels.length),
      );
      attempt += 1
    ) {
      const elapsedMs = Date.now() - startedAt;
      const totalRemainingMs =
        COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS - elapsedMs;

      if (totalRemainingMs <= 500) {
        break;
      }

      const model = onlineModels[attempt - 1];
      const attemptTimeoutMs = Math.min(
        COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
        totalRemainingMs,
      );

      try {
        const result = await this.withHardTimeout(
          this.aiExecutionService.execute({
            aiModelId: model?.id,
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
            /*
             * AiExecutionInput requires schema metadata for every JSON request.
             * This intentionally permissive provider-boundary schema only
             * guarantees a JSON object. Business validation below remains
             * strict and normalizes aliases before checking evidence grounding.
             */
            responseSchema: {
              type: 'object',
              additionalProperties: true,
            },
            responseSchemaName: `${COMMUNITY_AI_ANALYSIS_SCHEMA_NAME}_tolerant`,
            /*
             * Do not attach the strict provider-boundary JSON schema here.
             * Providers frequently return semantically correct aliases such as
             * name/description/need. The tolerant parser below normalizes those
             * aliases and then applies the same evidence and quality checks.
             */
            estimatedOutputTokens: COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
            maxOutputTokens: COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
            temperature: COMMUNITY_AI_ANALYSIS_TEMPERATURE,
            strategy: AiRoutingStrategy.BALANCED,
            excludedAiModelIds: onlineModels
              .slice(0, attempt - 1)
              .map((item) => item.id),
            timeoutMs: attemptTimeoutMs,
            maxRetriesPerModel: 0,
            maxModelsPerOperation: 1,
            allowProviderFallbackOnInvalidPrompt: true,
          }),
          attemptTimeoutMs + 750,
          `Community AI online attempt ${attempt}`,
        );

        const analysis = this.parseGroundAndValidate(
          context,
          result.text,
          result.aiModelId,
          result.apiModelId,
          attempt,
        );

        this.logger.log(
          `Community AI analysis accepted. operationId=${result.operationId}, modelId=${result.aiModelId}, apiModelId=${result.apiModelId}, provider=${result.providerKey}, attempt=${attempt}/${COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS}, opportunities=${analysis.opportunities.length}, elapsedMs=${Date.now() - startedAt}.`,
        );

        return analysis;
      } catch (error: unknown) {
        lastError = error;
        const databaseUnavailable = isTransientDatabaseError(error);

        this.logger.warn(
          `Community AI online model failed or was rejected. attempt=${attempt}/${COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS}, model=${model?.displayName ?? model?.modelName ?? 'balanced-routing'}, provider=${model?.providerKey ?? 'auto'}, databaseUnavailable=${databaseUnavailable}, elapsedMs=${Date.now() - startedAt}, error=${this.getErrorMessage(error)}.`,
        );

        if (databaseUnavailable) {
          break;
        }
      }
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
  private async findOnlineFallbackModels(): Promise<AiModel[]> {
    try {
      const [defaultModel, routableModels] = await Promise.all([
        this.aiModelsService.getDefaultModel().catch(() => null),
        this.aiModelsService.getRoutableModels(),
      ]);

      const onlineModels = routableModels.filter(
        (model) =>
          normalizeAiProviderKey(model.providerKey) !== AI_PROVIDER_KEYS.OLLAMA,
      );

      const ordered: AiModel[] = [];
      const append = (model: AiModel | null | undefined): void => {
        if (model && !ordered.some((item) => item.id === model.id)) {
          ordered.push(model);
        }
      };

      if (
        defaultModel &&
        normalizeAiProviderKey(defaultModel.providerKey) !==
          AI_PROVIDER_KEYS.OLLAMA
      ) {
        append(defaultModel);
      }

      const firstProvider = ordered[0]
        ? normalizeAiProviderKey(ordered[0].providerKey)
        : null;

      append(
        onlineModels.find(
          (model) =>
            normalizeAiProviderKey(model.providerKey) !== firstProvider,
        ),
      );

      for (const model of onlineModels) {
        append(model);
      }

      return ordered.slice(0, COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS);
    } catch (error: unknown) {
      this.logger.warn(
        `Online community-analysis model discovery failed; balanced routing will be attempted once. error=${this.getErrorMessage(error)}.`,
      );
      return [];
    }
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
    const parsedAnalysis = this.parseAndValidate(
      text,
      modelId,
      apiModelId,
      attemptCount,
    );
    const domainNormalizedAnalysis = this.normalizeOpportunityDomains(
      context,
      parsedAnalysis,
    );
    const analysis = this.applyEvidenceGrounding(
      context,
      domainNormalizedAnalysis,
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
    text: string,
    modelId: string,
    apiModelId: string,
    attemptCount: number,
  ): CommunityAiAnalysis {
    const parsed: unknown = JSON.parse(text);

    if (!this.isRecord(parsed) || !Array.isArray(parsed.opportunities)) {
      throw new Error('Community AI analysis returned an invalid root object.');
    }

    const opportunities = parsed.opportunities
      .slice(0, COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES)
      .map((value) => this.parseOpportunity(value));

    if (opportunities.length === 0) {
      throw new Error('Community AI analysis returned no opportunities.');
    }

    const inferredConfidence =
      opportunities.reduce((sum, item) => sum + item.confidence, 0) /
      opportunities.length;

    return {
      summary: this.optionalString(
        parsed.summary,
        `Extracted ${opportunities.length} evidence-grounded opportunity candidate(s).`,
      ),
      dominantProblems: this.normalizeTextArray(
        parsed.dominantProblems,
        opportunities.map((item) => item.problem),
      ),
      unmetNeeds: this.normalizeTextArray(
        parsed.unmetNeeds,
        opportunities.map((item) => item.unmetNeed),
      ),
      opportunities,
      overallConfidence: this.normalizeOptionalScore(
        parsed.overallConfidence,
        inferredConfidence,
      ),
      qualityWarnings: [
        ...this.normalizeTextArray(parsed.qualityWarnings, [], true),
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
   * Rejects suspicious but schema-valid responses so the next attempt uses a
   * different model instead of polluting opportunity ranking.
   */
  private validateBusinessQuality(
    analysis: CommunityAiAnalysis,
    context: IdeaGenerationContext,
  ): void {
    if (
      analysis.overallConfidence < COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE
    ) {
      throw new Error(
        `Overall confidence ${analysis.overallConfidence} is below the accepted minimum ${COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE}.`,
      );
    }

    const credibleOpportunities = analysis.opportunities.filter(
      (opportunity) =>
        opportunity.confidence >=
        COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE,
    );

    if (credibleOpportunities.length === 0) {
      throw new Error(
        'No opportunity met the minimum domain-confidence requirement.',
      );
    }

    const totalEvidenceSamples = credibleOpportunities.reduce(
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

    for (const opportunity of credibleOpportunities) {
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

    const labeled = normalized.match(
      /(?:^|\s)(?:#{1,6}\s*)?(?:🤔\s*)?(?:problem statement|problem|issue|pain point)\s*:?\s*(.+?)(?=\s+(?:#{1,6}\s*)?(?:🛠️\s*)?(?:proposed solution|solution|alternatives considered|feature summary|mockups|additional context)\b|$)/iu,
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

  private deriveTitle(problem: string, unmetNeed: string): string {
    const source = unmetNeed || problem;
    const title = source.replace(/\s+/gu, ' ').trim().slice(0, 120);
    return title.length >= 3 ? title : 'Community Opportunity';
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
        const groundedEvidence = opportunity.evidenceSamples
          .map((sample) => this.findGroundedCorpusMatch(sample, corpus))
          .filter((sample): sample is string => sample !== null)
          .filter((sample) => this.supportsOpportunity(opportunity, sample));

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

        return [
          {
            ...opportunity,
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