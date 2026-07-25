import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiRequestType,
  PromptType,
  Prisma,
  type AiModel,
} from '@prisma/client';

import { AiModelsService } from '../../../ai-models/ai-models.service';
import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import type { AiExecutionResult } from '../../../ai/types/ai-execution-result.type';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { PrismaService } from '../../../prisma/prisma.service';
import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import {
  IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT,
  IDEA_JUDGE_FINAL_SCORE_WEIGHT,
  IDEA_JUDGE_MAX_CANDIDATES,
  IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION,
} from '../constants/idea-judge.constants';
import {
  IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS,
  IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS,
  IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY,
  IDEA_BENCHMARK_TOP_OPPORTUNITY_COUNT,
} from '../constants/idea-generation.constants';
import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type { RankedIdeaOpportunity } from '../types/idea-opportunity-ranking.type';
import type {
  IdeaJudgeCandidateScore,
  IdeaJudgeEvaluation,
} from '../types/idea-judge.type';
import { IdeaAiOutputParserService } from './idea-ai-output-parser.service';
import { IdeaCandidateJudgeService } from './idea-candidate-judge.service';
import { IdeaGenerationModelSelectorService } from './idea-generation-model-selector.service';
import {
  IdeaSemanticDiversityService,
  type IdeaSemanticDiversityScore,
} from './idea-semantic-diversity.service';
import {
  IdeaQualityEvaluatorService,
  type IdeaQualityEvaluation,
  type IdeaQualityEvaluationContext,
} from './idea-quality-evaluator.service';

/**
 * One successfully generated benchmark candidate.
 *
 * quality contains the provider-independent deterministic assessment. aiJudge
 * contains the comparative score when the judge succeeds. finalScore combines
 * both signals and is used for winner selection.
 *
 * @author Malak
 */
export type IdeaBenchmarkCandidate = {
  readonly candidateId: string;
  readonly aiResult: AiExecutionResult;
  readonly parsedOutput: ParsedIdeaAiOutput;
  readonly quality: IdeaQualityEvaluation;
  readonly aiJudge: IdeaJudgeCandidateScore | null;
  readonly finalScore: number;
  readonly selected: boolean;
  readonly opportunityRank: number;
  readonly opportunityTitle: string;
  readonly semanticDiversity: IdeaSemanticDiversityScore | null;
};

/**
 * Final result of executing and comparing all eligible AI models.
 *
 * judgeEvaluation is null when comparison was unnecessary or when the AI judge
 * was temporarily unavailable and deterministic fallback ranking was used.
 *
 * @author Malak
 */
export type IdeaBenchmarkResult = {
  readonly winner: IdeaBenchmarkCandidate;
  readonly candidates: readonly IdeaBenchmarkCandidate[];
  readonly judgeEvaluation: IdeaJudgeEvaluation | null;
};

/** Result of one accepted model attempt before database persistence. */
type CandidateConceptDirection = {
  readonly opportunity: RankedIdeaOpportunity;
  readonly promptText: string;
};

/** Result of one accepted model attempt before database persistence. */
type AcceptedModelAttempt = {
  readonly aiResult: AiExecutionResult;
  readonly parsedOutput: ParsedIdeaAiOutput;
  readonly quality: IdeaQualityEvaluation;
};

/**
 * Executes diversified evidence-grounded concept prompts against a provider-diverse
 * selection of active, routable models supporting structured JSON output.
 *
 * Important guarantees:
 * - The initial benchmark group is interleaved by provider.
 * - Every candidate is evaluated using one provider-independent quality gate.
 * - A weak response receives one bounded revision attempt on the same model.
 * - A response that still fails the quality gate is persisted as rejected and
 *   excluded from winner selection.
 * - The comparative judge is used when at least two candidates survive.
 * - Deterministic ranking keeps the pipeline operational when the judge fails.
 *
 * Model eligibility is loaded dynamically from ai_models, so adding,
 * disabling, or recovering a model automatically affects future benchmark
 * runs without hard-coded provider preferences.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationBenchmarkService {
  private readonly logger = new Logger(IdeaGenerationBenchmarkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiModelsService: AiModelsService,
    private readonly aiExecutionService: AiExecutionService,
    private readonly outputParserService: IdeaAiOutputParserService,
    private readonly qualityEvaluatorService: IdeaQualityEvaluatorService,
    private readonly candidateJudgeService: IdeaCandidateJudgeService,
    private readonly modelSelectorService: IdeaGenerationModelSelectorService,
    private readonly semanticDiversityService: IdeaSemanticDiversityService,
  ) {}

  /**
   * Generates, quality-gates, persists, compares, and selects candidates.
   *
   * @param context Current generation pipeline context.
   * @returns All accepted candidates and the selected winner.
   */
  async benchmark(
    context: IdeaGenerationContext,
  ): Promise<IdeaBenchmarkResult> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model benchmarking.',
      );
    }

    const eligibleModels = (
      await this.aiModelsService.getRoutableModels()
    ).filter(
      (model) =>
        model.supportsJsonOutput &&
        !IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS.has(model.apiModelId),
    );

    if (eligibleModels.length === 0) {
      throw new ServiceUnavailableException(
        'No active routable AI model supporting JSON output is available.',
      );
    }

    const orderedModels = await this.modelSelectorService.orderModels(
      context,
      eligibleModels,
    );

    // A retried run must start with a clean candidate snapshot.
    await this.prisma.ideaGenerationCandidate.deleteMany({
      where: { runId: context.runId },
    });

    const successfulCandidates: IdeaBenchmarkCandidate[] = [];
    const conceptDirections = this.buildConceptDirections(context);
    const selectedModels = orderedModels.slice(
      0,
      Math.min(IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY, orderedModels.length),
    );
    let attemptedCandidateCount = 0;

    /*
     * Execute the selected models concurrently for one opportunity, then move
     * to the next opportunity. This bounded shape reduces total latency without
     * launching every candidate request in one provider-heavy burst.
     *
     * Promise.allSettled is required because one timeout or provider failure
     * must not discard successful results returned by the other models.
     */
    for (const direction of conceptDirections) {
      const remainingAttempts =
        IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS - attemptedCandidateCount;

      if (remainingAttempts <= 0) {
        break;
      }

      const modelsForDirection = selectedModels.slice(0, remainingAttempts);
      attemptedCandidateCount += modelsForDirection.length;

      const settledAttempts = await Promise.allSettled(
        modelsForDirection.map((model) =>
          this.executeModelCandidate(context, model, direction),
        ),
      );

      for (const attempt of settledAttempts) {
        if (attempt.status === 'fulfilled') {
          successfulCandidates.push(attempt.value);
        }
        // Rejected promises were already persisted and logged by the executor.
      }
    }

    if (successfulCandidates.length === 0) {
      throw new ServiceUnavailableException(
        'Every configured AI model failed or produced an idea below the required quality threshold.',
      );
    }

    if (successfulCandidates.length === 1) {
      const onlyCandidate = successfulCandidates[0];

      await this.selectSingleCandidate(
        context.runId,
        onlyCandidate.candidateId,
      );

      const selectedCandidate: IdeaBenchmarkCandidate = {
        ...onlyCandidate,
        semanticDiversity: {
          candidateId: onlyCandidate.candidateId,
          diversityScore: 100,
          maxSimilarity: 0,
          mostSimilarCandidateId: null,
          duplicateRisk: 'LOW',
        },
        selected: true,
      };

      return {
        winner: selectedCandidate,
        candidates: [selectedCandidate],
        judgeEvaluation: null,
      };
    }

    const diversityScores = this.semanticDiversityService.evaluate(
      successfulCandidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        parsedOutput: candidate.parsedOutput,
        opportunityTitle: candidate.opportunityTitle,
      })),
    );

    /*
     * Judge only the strongest opportunity-diverse shortlist. Sending every
     * accepted premium candidate in one request creates oversized prompts and
     * response schemas, which significantly increases timeout and malformed
     * JSON risk. Non-shortlisted candidates remain persisted for diagnostics.
     */
    const judgeCandidates = this.buildJudgeShortlist(
      successfulCandidates,
      IDEA_JUDGE_MAX_CANDIDATES,
    );
    const judgeCandidateIds = new Set(
      judgeCandidates.map((candidate) => candidate.candidateId),
    );

    const judgeEvaluation = await this.candidateJudgeService.evaluate(
      context,
      judgeCandidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        parsedOutput: candidate.parsedOutput,
      })),
    );

    const useJudgeScores =
      judgeEvaluation !== null &&
      judgeEvaluation.confidence >=
        IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION;

    const diversityScoresForScoring = diversityScores;

    const scoredCandidates = successfulCandidates.map((candidate) => {
      const aiJudge =
        judgeEvaluation?.scores.find(
          (score) => score.candidateId === candidate.candidateId,
        ) ?? null;
      const semanticDiversity =
        diversityScoresForScoring.get(candidate.candidateId) ?? null;

      return {
        ...candidate,
        aiJudge,
        semanticDiversity,
        finalScore: this.calculateFinalScore(
          candidate.quality.score,
          useJudgeScores && judgeCandidateIds.has(candidate.candidateId)
            ? (aiJudge?.overallScore ?? null)
            : null,
          semanticDiversity?.diversityScore ?? 100,
        ),
        selected: false,
      };
    });

    /* Only shortlisted candidates are eligible to win comparative selection. */
    const rankedCandidates = [...scoredCandidates].sort(
      (first, second) => {
        const shortlistDifference =
          Number(judgeCandidateIds.has(second.candidateId)) -
          Number(judgeCandidateIds.has(first.candidateId));

        return (
          shortlistDifference ||
          second.finalScore - first.finalScore ||
          second.quality.score - first.quality.score ||
          first.aiResult.responseTimeMs - second.aiResult.responseTimeMs
        );
      },
    );

    const topCandidate = rankedCandidates[0];

    if (!topCandidate) {
      throw new ServiceUnavailableException(
        'No successful idea candidate could be selected.',
      );
    }

    const winner: IdeaBenchmarkCandidate = {
      ...topCandidate,
      selected: true,
    };

    const candidates = rankedCandidates.map((candidate) =>
      candidate.candidateId === winner.candidateId
        ? winner
        : { ...candidate, selected: false },
    );

    const finalJudgeEvaluation = judgeEvaluation
      ? {
          ...judgeEvaluation,
          winnerCandidateId: winner.candidateId,
          reason: this.buildSelectionReason(
            winner,
            judgeEvaluation,
            useJudgeScores,
          ),
          comparisonReport: judgeEvaluation.comparisonReport.map((report) => ({
            ...report,
            verdict:
              report.candidateId === winner.candidateId
                ? ('WINNER' as const)
                : ('REJECTED' as const),
          })),
        }
      : null;

    await this.persistFinalDecision(
      context.runId,
      candidates,
      winner.candidateId,
      finalJudgeEvaluation,
    );

    return {
      winner,
      candidates,
      judgeEvaluation: finalJudgeEvaluation,
    };
  }

  /**
   * Builds a deterministic, opportunity-diverse shortlist for the AI judge.
   *
   * The highest-quality candidate from each opportunity is selected first,
   * then remaining slots are filled by deterministic quality. This prevents a
   * single opportunity from occupying the complete comparative request.
   */
  private buildJudgeShortlist(
    candidates: readonly IdeaBenchmarkCandidate[],
    maximumCandidates: number,
  ): IdeaBenchmarkCandidate[] {
    const ordered = [...candidates].sort(
      (first, second) =>
        second.quality.score - first.quality.score ||
        first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
    );
    const selected: IdeaBenchmarkCandidate[] = [];
    const selectedIds = new Set<string>();
    const usedOpportunities = new Set<string>();

    for (const candidate of ordered) {
      if (selected.length >= maximumCandidates) {
        break;
      }
      if (usedOpportunities.has(candidate.opportunityTitle)) {
        continue;
      }

      selected.push(candidate);
      selectedIds.add(candidate.candidateId);
      usedOpportunities.add(candidate.opportunityTitle);
    }

    for (const candidate of ordered) {
      if (selected.length >= maximumCandidates) {
        break;
      }
      if (selectedIds.has(candidate.candidateId)) {
        continue;
      }

      selected.push(candidate);
      selectedIds.add(candidate.candidateId);
    }

    return selected;
  }

  /**
   * Executes, parses, evaluates, optionally revises, and persists one model.
   *
   * A candidate is successful only when it passes the deterministic quality
   * gate. Provider failures and quality rejections are persisted separately so
   * administrators can distinguish availability problems from weak outputs.
   */
  private async executeModelCandidate(
    context: IdeaGenerationContext,
    model: AiModel,
    direction: CandidateConceptDirection,
  ): Promise<IdeaBenchmarkCandidate> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model execution.',
      );
    }

    const startedAt = Date.now();
    let failurePersisted = false;

    try {
      const qualityContext = this.buildQualityContext(context);
      const initialAttempt = await this.generateAndEvaluate(
        context,
        model,
        direction.promptText,
        qualityContext,
      );
      const acceptedAttempt = initialAttempt.quality.accepted
        ? initialAttempt
        : await this.reviseWeakCandidate(
            context,
            model,
            initialAttempt,
            qualityContext,
            direction.promptText,
          );

      if (!acceptedAttempt.quality.accepted) {
        const errorMessage = this.buildQualityRejectionMessage(
          acceptedAttempt.quality,
        );

        await this.persistRejectedCandidate({
          runId: context.runId,
          model,
          attempt: acceptedAttempt,
          errorMessage,
          direction,
        });
        failurePersisted = true;

        throw new ServiceUnavailableException(errorMessage);
      }

      const candidateId = await this.persistSuccessfulCandidate({
        runId: context.runId,
        model,
        aiResult: acceptedAttempt.aiResult,
        parsedOutput: acceptedAttempt.parsedOutput,
        quality: acceptedAttempt.quality,
        direction,
      });

      return {
        candidateId,
        aiResult: acceptedAttempt.aiResult,
        parsedOutput: acceptedAttempt.parsedOutput,
        quality: acceptedAttempt.quality,
        aiJudge: null,
        finalScore: acceptedAttempt.quality.score,
        selected: false,
        opportunityRank: direction.opportunity.rank,
        opportunityTitle: direction.opportunity.title,
        semanticDiversity: null,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown model execution failure.';

      if (!failurePersisted) {
        await this.persistFailedCandidate({
          runId: context.runId,
          model,
          responseTimeMs: Date.now() - startedAt,
          errorMessage,
          direction,
        });
      }

      this.logger.warn(
        `Idea benchmark model "${model.displayName ?? model.modelName}" failed: ${errorMessage}`,
      );

      throw error;
    }
  }

  /** Executes one exact model and evaluates its normalized response. */
  private async generateAndEvaluate(
    context: IdeaGenerationContext,
    model: AiModel,
    userPrompt: string,
    qualityContext: IdeaQualityEvaluationContext,
  ): Promise<AcceptedModelAttempt> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model execution.',
      );
    }

    const aiResult = await this.aiExecutionService.execute({
      aiModelId: model.id,
      userPrompt,
      systemInstruction: this.buildSystemInstruction(context),
      requestType: ApiRequestType.IDEA_GENERATION,
      promptType: PromptType.IDEA_GENERATION,
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
      responseSchema: prompt.responseSchema,
      responseSchemaName: prompt.responseSchemaName,
      estimatedOutputTokens: context.policy?.includePremiumOutputs
        ? 4_096
        : 2_048,
      temperature: 0.55,
    });
    const parsedOutput = this.outputParserService.parseOrThrow(aiResult.text);
    const quality = this.qualityEvaluatorService.evaluate(
      parsedOutput,
      qualityContext,
    );

    return { aiResult, parsedOutput, quality };
  }

  /**
   * Gives one weak candidate a single bounded self-revision opportunity.
   *
   * The same exact model is used so benchmark attribution remains correct. The
   * revised request receives the original trusted prompt, its previous JSON,
   * and only deterministic improvement instructions.
   */
  private async reviseWeakCandidate(
    context: IdeaGenerationContext,
    model: AiModel,
    initialAttempt: AcceptedModelAttempt,
    qualityContext: IdeaQualityEvaluationContext,
    assignedPromptText: string,
  ): Promise<AcceptedModelAttempt> {
    const prompt = context.prompt;

    if (!prompt) {
      return initialAttempt;
    }

    const revisionPrompt = [
      assignedPromptText,
      'QUALITY-GATE REVISION:',
      '- The previous response was valid JSON but did not meet the required quality threshold.',
      '- Rewrite the complete response, not only the listed fields.',
      '- Preserve every evidence-grounding, location, schema, and entitlement rule from the original prompt.',
      '- Do not invent facts, APIs, regulations, statistics, or local evidence.',
      this.qualityEvaluatorService.buildImprovementInstructions(
        initialAttempt.quality,
      ),
      '<previous_candidate_json>',
      JSON.stringify(initialAttempt.parsedOutput),
      '</previous_candidate_json>',
      '- Return exactly one complete JSON object matching the required schema.',
    ].join('\n');

    try {
      const revisedAttempt = await this.generateAndEvaluate(
        context,
        model,
        revisionPrompt,
        qualityContext,
      );

      return revisedAttempt.quality.score > initialAttempt.quality.score
        ? revisedAttempt
        : initialAttempt;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown revision failure.';

      this.logger.warn(
        `Quality revision for model "${model.displayName ?? model.modelName}" failed; retaining the initial candidate: ${message}`,
      );

      return initialAttempt;
    }
  }

  /**
   * Builds up to five evidence-grounded concept directions from the highest
   * ranked NLP opportunities. Every selected model receives every direction,
   * allowing the judge to compare both opportunity quality and model output
   * quality across as many as fifteen startup candidates.
   */
  private buildConceptDirections(
    context: IdeaGenerationContext,
  ): readonly CandidateConceptDirection[] {
    const prompt = context.prompt;
    const ranking = context.opportunityRanking;

    if (!prompt || !ranking) {
      throw new ServiceUnavailableException(
        'A persisted prompt and ranked opportunities are required before benchmarking.',
      );
    }

    const opportunities = [ranking.selected, ...ranking.alternatives]
      .slice(0, IDEA_BENCHMARK_TOP_OPPORTUNITY_COUNT);

    return opportunities.map((opportunity, index) => ({
      opportunity,
      promptText: [
        prompt.promptText,
        'BENCHMARK CONCEPT ASSIGNMENT:',
        `- This is candidate concept ${index + 1} of ${opportunities.length}.`,
        `- Build this candidate around ranked opportunity #${opportunity.rank}: "${opportunity.title}".`,
        '- This assignment overrides the default selected opportunity only for this benchmark candidate.',
        '- Produce one coherent standalone startup concept, not a feature list or a minor fix.',
        '- Use compatible lower-ranked needs only as supporting capabilities when they strengthen the same workflow.',
        '- Include a clear buyer or sponsor, an adoption trigger, repeatable deployment, and measurable organizational value whenever the schema permits.',
        '- Do not copy another candidate direction or merge unrelated opportunities.',
        '<untrusted_assigned_opportunity>',
        JSON.stringify({
          rank: opportunity.rank,
          title: opportunity.title,
          problem: opportunity.problem,
          need: opportunity.need,
          solutionArea: opportunity.solutionArea,
          frequency: opportunity.frequency,
          severity: opportunity.severity,
          score: opportunity.finalScore,
          evidenceSamples: opportunity.evidenceSamples,
        }),
        '</untrusted_assigned_opportunity>',
      ].join('\n'),
    }));
  }

  /** Builds trusted metrics used by premium-output quality validation. */
  private buildQualityContext(
    context: IdeaGenerationContext,
  ): IdeaQualityEvaluationContext {
    return {
      totalTextsAnalyzed: context.nlp?.totalTextsAnalyzed,
      totalPostsAnalyzed: context.nlp?.totalPostsAnalyzed,
      totalCommentsAnalyzed: context.nlp?.totalCommentsAnalyzed,
      requireAdvancedOutputs: context.policy?.includePremiumOutputs ?? false,
      targetCountry: context.location.country,
      targetCity: context.location.city,
      targetRegion: context.location.region,
      localEvidenceVerified: this.hasVerifiedLocalEvidence(context),
    };
  }

  /** Builds the application-controlled system instruction for all candidates. */
  private buildSystemInstruction(context: IdeaGenerationContext): string {
    const metrics = context.nlp
      ? `Trusted NLP totals: ${context.nlp.totalTextsAnalyzed} texts, ${context.nlp.totalPostsAnalyzed} posts, and ${context.nlp.totalCommentsAnalyzed} comments.`
      : 'Trusted NLP totals are unavailable.';

    return [
      'Generate one specific, evidence-grounded, differentiated, locally deployable software product.',
      'Do not invent statistics, market sizes, legal conclusions, API availability, institutional counts, failure rates, or local facts.',
      'When evidence is not locally verified, describe the discovered problem generally and use wording such as "designed for deployment in the target location". Never write that students, faculty, institutions, or residents in the requested city currently face or report the problem.',
      'Mark estimates and assumptions explicitly.',
      'Treat store descriptions and promotional product copy as contextual source material, never as direct proof of a user complaint or unmet need.',
      metrics,
      context.policy?.includePremiumOutputs
        ? 'The NLP executive summary must state those exact three totals. The budget estimation must be explicitly preliminary and include a currency, numeric range, major cost categories, and assumptions.'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Returns true only when persisted sample evidence contains location metadata
   * matching the requested target. Text mentions alone are not treated as
   * verified geolocation.
   */
  private hasVerifiedLocalEvidence(context: IdeaGenerationContext): boolean {
    const targets = [
      context.location.country,
      context.location.city,
      context.location.region,
    ]
      .map((value) => this.normalizeLocationValue(value))
      .filter((value): value is string => value !== null);

    if (targets.length === 0 || !context.nlp) {
      return false;
    }

    return [context.nlp.samplePosts, context.nlp.sampleComments].some((value) =>
      this.containsMatchingLocationMetadata(value, targets),
    );
  }

  private containsMatchingLocationMetadata(
    value: unknown,
    targets: readonly string[],
  ): boolean {
    if (Array.isArray(value)) {
      return value.some((item) =>
        this.containsMatchingLocationMetadata(item, targets),
      );
    }

    if (!value || typeof value !== 'object') {
      return false;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.toLocaleLowerCase();

      if (
        ['country', 'city', 'region', 'location'].includes(normalizedKey) &&
        typeof nestedValue === 'string'
      ) {
        const normalizedValue = this.normalizeLocationValue(nestedValue);

        if (
          normalizedValue &&
          targets.some(
            (target) =>
              normalizedValue === target ||
              normalizedValue.includes(target) ||
              target.includes(normalizedValue),
          )
        ) {
          return true;
        }
      }

      if (this.containsMatchingLocationMetadata(nestedValue, targets)) {
        return true;
      }
    }

    return false;
  }

  private normalizeLocationValue(value: string | null): string | null {
    const normalized = value
      ?.normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    return normalized ? normalized : null;
  }

  /** Converts deterministic issues into one concise rejection reason. */
  private buildQualityRejectionMessage(quality: IdeaQualityEvaluation): string {
    const issueCodes = quality.issues.map((issue) => issue.code).join(', ');

    return `QUALITY_GATE_REJECTED: candidate score ${quality.score} is below the required threshold. Issues: ${issueCodes || 'insufficient overall quality'}.`;
  }

  /** Persists one quality-approved model execution. */
  private async persistSuccessfulCandidate(input: {
    readonly runId: string;
    readonly model: Pick<
      AiModel,
      'id' | 'providerKey' | 'apiModelId' | 'modelName' | 'displayName'
    >;
    readonly aiResult: AiExecutionResult;
    readonly parsedOutput: ParsedIdeaAiOutput;
    readonly quality: IdeaQualityEvaluation;
    readonly direction: CandidateConceptDirection;
  }): Promise<string> {
    const candidate = await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        opportunityRank: input.direction.opportunity.rank,
        opportunityTitle: input.direction.opportunity.title,
        rawResponse: input.aiResult.text,
        parsedResponse: this.toPrismaJson(input.parsedOutput),
        overallScore: input.quality.score,
        finalScore: input.quality.score,
        innovationScore: input.quality.dimensions.innovation,
        marketFitScore: input.quality.dimensions.marketFit,
        technicalQualityScore: input.quality.dimensions.technicalQuality,
        completenessScore: input.quality.dimensions.completeness,
        originalityScore: input.quality.dimensions.originality,
        inputTokens: input.aiResult.inputTokens,
        outputTokens: input.aiResult.outputTokens,
        costEstimate: input.aiResult.costEstimate,
        responseTimeMs: input.aiResult.responseTimeMs,
        selected: false,
        errorCode: null,
        errorMessage: null,
      },
      select: { id: true },
    });

    return candidate.id;
  }

  /** Persists a structurally valid response rejected by the quality gate. */
  private async persistRejectedCandidate(input: {
    readonly runId: string;
    readonly model: Pick<
      AiModel,
      'id' | 'providerKey' | 'apiModelId' | 'modelName' | 'displayName'
    >;
    readonly attempt: AcceptedModelAttempt;
    readonly errorMessage: string;
    readonly direction: CandidateConceptDirection;
  }): Promise<void> {
    await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        opportunityRank: input.direction.opportunity.rank,
        opportunityTitle: input.direction.opportunity.title,
        rawResponse: input.attempt.aiResult.text,
        parsedResponse: this.toPrismaJson(input.attempt.parsedOutput),
        overallScore: input.attempt.quality.score,
        finalScore: input.attempt.quality.score,
        innovationScore: input.attempt.quality.dimensions.innovation,
        marketFitScore: input.attempt.quality.dimensions.marketFit,
        technicalQualityScore:
          input.attempt.quality.dimensions.technicalQuality,
        completenessScore: input.attempt.quality.dimensions.completeness,
        originalityScore: input.attempt.quality.dimensions.originality,
        inputTokens: input.attempt.aiResult.inputTokens,
        outputTokens: input.attempt.aiResult.outputTokens,
        costEstimate: input.attempt.aiResult.costEstimate,
        responseTimeMs: input.attempt.aiResult.responseTimeMs,
        selected: false,
        errorCode: 'QUALITY_GATE_REJECTED',
        errorMessage: input.errorMessage,
      },
    });
  }

  /** Persists a provider, parsing, or execution failure. */
  private async persistFailedCandidate(input: {
    readonly runId: string;
    readonly model: Pick<
      AiModel,
      'id' | 'providerKey' | 'apiModelId' | 'modelName' | 'displayName'
    >;
    readonly responseTimeMs: number;
    readonly errorMessage: string;
    readonly direction: CandidateConceptDirection;
  }): Promise<void> {
    await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        opportunityRank: input.direction.opportunity.rank,
        opportunityTitle: input.direction.opportunity.title,
        responseTimeMs: input.responseTimeMs,
        selected: false,
        errorCode: 'MODEL_EXECUTION_FAILED',
        errorMessage: input.errorMessage,
      },
    });
  }

  /** Selects the only quality-approved candidate atomically. */
  private async selectSingleCandidate(
    runId: string,
    candidateId: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: { selected: false },
      }),
      this.prisma.ideaGenerationCandidate.update({
        where: { id: candidateId },
        data: {
          selected: true,
          judgeReason:
            'Selected because it was the only quality-approved candidate available for this benchmark run.',
          judgeConfidence: 0,
          requiresLegalVerification: null,
        },
      }),
    ]);
  }

  /** Persists available judge scores and atomically marks the final winner. */
  private async persistFinalDecision(
    runId: string,
    candidates: readonly IdeaBenchmarkCandidate[],
    winnerCandidateId: string,
    evaluation: IdeaJudgeEvaluation | null,
  ): Promise<void> {
    const resetDecisionOperation =
      this.prisma.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: {
          selected: false,
          judgeReason: null,
          judgeConfidence: null,
          requiresLegalVerification: null,
        },
      });

    const candidateUpdateOperations = candidates.map((candidate) => {
      const score = candidate.aiJudge;
      const isWinner = candidate.candidateId === winnerCandidateId;

      return this.prisma.ideaGenerationCandidate.update({
        where: { id: candidate.candidateId },
        data: {
          aiJudgeScore: score?.overallScore ?? null,
          finalScore: candidate.finalScore,
          localRelevanceScore: score?.localRelevance ?? null,
          problemImportanceScore: score?.problemImportance ?? null,
          aiJudgeInnovationScore: score?.innovation ?? null,
          regulatoryFeasibilityScore: score?.regulatoryFeasibility ?? null,
          technicalFeasibilityScore: score?.technicalFeasibility ?? null,
          marketPotentialScore: score?.marketPotential ?? null,
          implementationClarityScore: score?.implementationClarity ?? null,
          judgeStrengths: score
            ? this.toPrismaJsonValue(score.strengths)
            : Prisma.JsonNull,
          judgeRisks: score
            ? this.toPrismaJsonValue(score.risks)
            : Prisma.JsonNull,
          judgeReason: isWinner
            ? (evaluation?.reason ??
              'Selected by deterministic fallback ranking because the comparative AI judge was unavailable.')
            : (evaluation?.comparisonReport.find(
                (report) => report.candidateId === candidate.candidateId,
              )?.whyItRankedHere ?? null),
          judgeConfidence: isWinner ? (evaluation?.confidence ?? 0) : null,
          requiresLegalVerification: isWinner
            ? (evaluation?.requiresLegalVerification ?? null)
            : null,
          selected: isWinner,
        },
      });
    });

    await this.prisma.$transaction([
      resetDecisionOperation,
      ...candidateUpdateOperations,
    ]);
  }

  /**
   * Builds an administrator-readable explanation of the final winner.
   *
   * Low-confidence judge results are retained for diagnostics but cannot
   * override the deterministic quality evaluator.
   */
  private buildSelectionReason(
    winner: IdeaBenchmarkCandidate,
    evaluation: IdeaJudgeEvaluation,
    useJudgeScores: boolean,
  ): string {
    const deterministicScore = winner.quality.score.toFixed(2);
    const judgeScore = winner.aiJudge?.overallScore;
    const finalScore = winner.finalScore.toFixed(2);

    if (!useJudgeScores) {
      return [
        `Deterministic winner selection was used because judge confidence ${evaluation.confidence.toFixed(2)} was below the required threshold ${IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION}.`,
        `Winner deterministic score: ${deterministicScore}.`,
        judgeScore === undefined
          ? 'The judge did not return a score for the selected candidate.'
          : `Retained judge score for diagnostics: ${judgeScore.toFixed(2)}.`,
        `Final score: ${finalScore}.`,
        `Original judge explanation: ${evaluation.reason}`,
      ].join(' ');
    }

    return [
      `Hybrid winner selection used ${Math.round(IDEA_JUDGE_FINAL_SCORE_WEIGHT * 100)}% AI judge and ${Math.round(IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT * 100)}% deterministic quality.`,
      `Winner deterministic score: ${deterministicScore}.`,
      judgeScore === undefined
        ? 'Judge score was unavailable.'
        : `Winner judge score: ${judgeScore.toFixed(2)}.`,
      `Final score: ${finalScore}.`,
      `Judge confidence: ${evaluation.confidence.toFixed(2)}.`,
      `Original judge explanation: ${evaluation.reason}`,
    ].join(' ');
  }

  /** Calculates the stable hybrid winner score. */
  private calculateFinalScore(
    deterministicScore: number,
    aiJudgeScore: number | null,
    diversityScore: number,
  ): number {
    const baseScore =
      aiJudgeScore === null
        ? deterministicScore
        : aiJudgeScore * IDEA_JUDGE_FINAL_SCORE_WEIGHT +
          deterministicScore * IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT;

    // Diversity acts as a bounded penalty, not as a substitute for quality.
    // A concept with 100 diversity keeps its full score; a near duplicate can
    // lose at most 12 points, preventing repeated ideas from winning only due
    // to polished wording.
    const diversityPenalty = Math.max(0, (100 - diversityScore) * 0.12);
    return Math.round(Math.max(0, baseScore - diversityPenalty) * 100) / 100;
  }

  /** Converts a validated idea output into Prisma-compatible JSON. */
  private toPrismaJson(value: ParsedIdeaAiOutput): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  /** Converts immutable JSON-compatible values into Prisma input JSON. */
  private toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}