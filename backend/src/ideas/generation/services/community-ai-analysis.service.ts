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
  COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES,
  COMMUNITY_AI_ANALYSIS_SCHEMA_NAME,
  COMMUNITY_AI_ANALYSIS_TEMPERATURE,
} from '../constants/community-ai-analysis.constants';
import { buildCommunityAiAnalysisSchema } from '../schemas/community-ai-analysis.schema';
import type {
  CommunityAiAnalysis,
  CommunityAiOpportunity,
} from '../types/community-ai-analysis.type';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import { CommunityAiAnalysisPromptService } from './community-ai-analysis-prompt.service';

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
    const localFallbackModel = await this.findLocalFallbackModel();
    const excludedAiModelIds = new Set<string>(
      localFallbackModel ? [localFallbackModel.id] : [],
    );
    let lastError: unknown = null;

    /*
     * The bounded attempts below are online-only. Ollama is excluded explicitly
     * so a schema-valid but domain-invalid online response cannot consume the
     * local fallback invisibly inside AiExecutionService. After all online
     * attempts are exhausted, Ollama receives exactly one explicit final
     * attempt using the same schema and business-quality validation.
     */
    for (
      let attempt = 1;
      attempt <= COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const result = await this.aiExecutionService.execute({
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
          excludedAiModelIds: [...excludedAiModelIds],
          timeoutMs: COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
          maxRetriesPerModel: 0,
          maxModelsPerOperation: COMMUNITY_AI_ANALYSIS_MAX_MODELS_PER_OPERATION,
          allowProviderFallbackOnInvalidPrompt: true,
        });

        try {
          const analysis = this.parseGroundAndValidate(
            context,
            result.text,
            result.aiModelId,
            result.apiModelId,
            attempt,
          );

          this.logger.log(
            `Community AI analysis accepted. operationId=${result.operationId}, modelId=${result.aiModelId}, apiModelId=${result.apiModelId}, provider=${result.providerKey}, attempt=${attempt}/${COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS}, opportunities=${analysis.opportunities.length}.`,
          );

          return analysis;
        } catch (validationError: unknown) {
          lastError = validationError;
          excludedAiModelIds.add(result.aiModelId);

          this.logger.warn(
            `Community AI analysis response rejected. operationId=${result.operationId}, modelId=${result.aiModelId}, apiModelId=${result.apiModelId}, provider=${result.providerKey}, attempt=${attempt}/${COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS}, nextAttemptUsesDifferentOnlineModel=${attempt < COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS}, excludedModelCount=${excludedAiModelIds.size}, error=${this.getErrorMessage(validationError)}.`,
          );
        }
      } catch (executionError: unknown) {
        lastError = executionError;

        this.logger.warn(
          `Community AI analysis online execution failed. attempt=${attempt}/${COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS}, nextOnlineAttempt=false, localFallbackAvailable=${Boolean(localFallbackModel)}, error=${this.getErrorMessage(executionError)}.`,
        );
        break;
      }
    }

    if (localFallbackModel) {
      try {
        this.logger.warn(
          `Community AI online analysis was exhausted. Executing local Ollama fallback model "${localFallbackModel.displayName ?? localFallbackModel.modelName}" once.`,
        );

        const localResult = await this.aiExecutionService.execute({
          aiModelId: localFallbackModel.id,
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
          timeoutMs: COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
          maxRetriesPerModel: 0,
          allowProviderFallbackOnInvalidPrompt: true,
        });

        const localAnalysis = this.parseGroundAndValidate(
          context,
          localResult.text,
          localResult.aiModelId,
          localResult.apiModelId,
          COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS + 1,
        );

        this.logger.log(
          `Community AI analysis accepted from local Ollama fallback. operationId=${localResult.operationId}, modelId=${localResult.aiModelId}, apiModelId=${localResult.apiModelId}, opportunities=${localAnalysis.opportunities.length}.`,
        );

        return localAnalysis;
      } catch (localError: unknown) {
        lastError = localError;

        this.logger.warn(
          `Local Ollama community analysis failed or was rejected. Deterministic NLP fallback will be used. error=${this.getErrorMessage(localError)}.`,
        );
      }
    }

    this.logger.warn(
      `Community AI analysis was not applied after exhausting online execution${localFallbackModel ? ' and the local Ollama fallback' : ''}. Deterministic NLP fallback will be used. error=${this.getErrorMessage(lastError)}.`,
    );

    return null;
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
    const analysis = this.applyEvidenceGrounding(context, parsedAnalysis);

    this.validateBusinessQuality(analysis);

    return analysis;
  }

  /**
   * Finds one active, routable Ollama model supporting structured output.
   *
   * The model remains an explicit last-resort tier and is never mixed into the
   * online domain-validation rotation.
   */
  private async findLocalFallbackModel(): Promise<AiModel | null> {
    const models = await this.aiModelsService.getRoutableModels();

    return (
      models.find(
        (model) =>
          normalizeAiProviderKey(model.providerKey) ===
            AI_PROVIDER_KEYS.OLLAMA && model.supportsJsonOutput,
      ) ?? null
    );
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
  private validateBusinessQuality(analysis: CommunityAiAnalysis): void {
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

    for (const opportunity of credibleOpportunities) {
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
  }

  private parseOpportunity(value: unknown): CommunityAiOpportunity {
    if (!this.isRecord(value)) {
      throw new Error('Community AI analysis returned an invalid opportunity.');
    }

    const problem = this.firstString(value, [
      'problem',
      'problemStatement',
      'painPoint',
      'description',
    ]);
    const unmetNeed = this.firstString(value, [
      'unmetNeed',
      'need',
      'userNeed',
      'missingCapability',
    ]);
    const solutionArea = this.firstString(value, [
      'solutionArea',
      'solution',
      'proposedSolution',
      'opportunityArea',
      'direction',
    ]);

    const severity = this.normalizeSeverity(
      value.severity ?? value.impactLevel ?? value.priority,
    );

    const confidence = this.normalizeOptionalScore(
      value.confidence ?? value.score,
      50,
    );

    return {
      title: this.optionalString(
        value.title ?? value.name,
        this.deriveTitle(problem, unmetNeed),
      ),
      problem,
      unmetNeed,
      solutionArea,
      affectedUsers: this.normalizeTextArray(
        value.affectedUsers ?? value.targetUsers ?? value.users,
        ['Affected community users'],
      ),
      evidenceSamples: this.normalizeTextArray(
        value.evidenceSamples ??
          value.evidence ??
          value.examples ??
          value.quotes,
        [],
      ),
      frequency: this.normalizeOptionalPositiveInteger(
        value.frequency ?? value.occurrences ?? value.count,
        1,
      ),
      severity,
      confidence,
      problemImportance: this.normalizeOptionalScore(
        value.problemImportance ?? value.importance ?? value.impact,
        confidence,
      ),
      localEvidenceAvailable:
        value.localEvidenceAvailable === true ||
        value.hasLocalEvidence === true,
      localEvidenceSamples: this.normalizeTextArray(
        value.localEvidenceSamples ?? value.localEvidence,
        [],
        true,
      ),
      localRelevance: this.normalizeOptionalScore(
        value.localRelevance ?? value.relevance,
        25,
      ),
      groundingScore: 0,
      technicalFeasibility: this.normalizeOptionalScore(
        value.technicalFeasibility ?? value.feasibility,
        60,
      ),
      marketPotential: this.normalizeOptionalScore(
        value.marketPotential ?? value.marketScore,
        50,
      ),
      innovationPotential: this.normalizeOptionalScore(
        value.innovationPotential ?? value.innovation,
        50,
      ),
      risks: this.normalizeTextArray(
        value.risks ?? value.riskFactors ?? value.limitations,
        [],
        true,
      ),
    };
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
   * Verifies that every accepted quote exists in the supplied NLP evidence and
   * has a defensible lexical connection to the stated opportunity. Unsupported
   * quotes are removed; an opportunity with no grounded evidence is rejected.
   * Location scores and risks are also constrained by explicit local evidence.
   */
  private applyEvidenceGrounding(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    if (!context.nlp) {
      throw new Error('NLP evidence is required for grounding validation.');
    }

    const corpus = this.collectEvidenceCorpus(context.nlp);
    const locationTerms = [
      context.location.country,
      context.location.city ?? '',
      context.location.region ?? '',
    ]
      .map((term) => this.normalizeComparableText(term))
      .filter((term) => term.length >= 3);

    const opportunities = analysis.opportunities.map((opportunity) => {
      const groundedEvidence = opportunity.evidenceSamples
        .map((sample) => this.findGroundedCorpusMatch(sample, corpus))
        .filter((sample): sample is string => sample !== null)
        .filter((sample) => this.supportsOpportunity(opportunity, sample));

      const uniqueEvidence = [...new Set(groundedEvidence)].slice(0, 5);

      if (uniqueEvidence.length === 0) {
        throw new Error(
          `Opportunity "${opportunity.title}" has no directly grounded evidence sample.`,
        );
      }

      const groundingScore = Math.round(
        (uniqueEvidence.length /
          Math.max(opportunity.evidenceSamples.length, 1)) *
          100,
      );
      const localEvidenceSamples = uniqueEvidence.filter((sample) => {
        const normalized = this.normalizeComparableText(sample);
        return locationTerms.some((term) => normalized.includes(term));
      });
      const localEvidenceAvailable = localEvidenceSamples.length > 0;

      return {
        ...opportunity,
        evidenceSamples: uniqueEvidence,
        groundingScore,
        localEvidenceAvailable,
        localEvidenceSamples,
        localRelevance: localEvidenceAvailable
          ? opportunity.localRelevance
          : Math.min(opportunity.localRelevance, 25),
        risks: localEvidenceAvailable
          ? opportunity.risks
          : opportunity.risks.filter(
              (risk) => !this.isUnsupportedLocalRisk(risk, locationTerms),
            ),
      };
    });

    return {
      ...analysis,
      opportunities,
      qualityWarnings: [
        ...analysis.qualityWarnings,
        ...(opportunities.some((item) => !item.localEvidenceAvailable)
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
