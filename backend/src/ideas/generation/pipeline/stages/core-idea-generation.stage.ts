import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_AI_RESPONSE_PREVIEW_LENGTH,
} from '../../constants/idea-generation.constants';
import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import { IdeaGenerationBenchmarkService } from '../../services/idea-generation-benchmark.service';
import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

/**
 * Generates the core idea through a dynamic multi-model benchmark.
 *
 * The highest-ranked NLP opportunity is evaluated by two rotating JSON-capable
 * models in parallel. Additional ordered models are used only when a fast-path
 * model fails. Quality-approved candidates remain preferred, while the best
 * structurally valid low-score candidate is retained only as an availability
 * fallback. Comparative judging runs when multiple candidates complete inside
 * the budget; otherwise deterministic quality selects the result.
 *
 * @author Malak
 */
@Injectable()
export class CoreIdeaGenerationStage implements IdeaGenerationStage {
  private readonly logger = new Logger(CoreIdeaGenerationStage.name);
  readonly key = IDEA_GENERATION_STAGE_KEYS.CORE_IDEA_GENERATION;

  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly benchmarkService: IdeaGenerationBenchmarkService,
  ) {}

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const benchmarkStartedAt = Date.now();
    const benchmark = await this.benchmarkService.benchmark(context);
    const benchmarkDurationMs = Date.now() - benchmarkStartedAt;
    const winner = benchmark.winner;
    const winnerOpportunity = context.opportunityRanking?.selected;

    if (!winnerOpportunity) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.AI_GENERATION_FAILED,
        message: 'The selected opportunity is required after benchmarking.',
      });
    }

    const updatedContext: IdeaGenerationContext = {
      ...context,
      coreIdea: winner.parsedOutput.coreIdea,
      benchmarkWinnerOpportunity: winnerOpportunity,
      advancedOutputs: this.mergeAdvancedOutputs(
        context.advancedOutputs,
        winner.parsedOutput.advancedOutputs,
      ),
    };

    const modelTimings = benchmark.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      providerKey: candidate.aiResult.providerKey,
      apiModelId: candidate.aiResult.apiModelId,
      responseTimeMs: candidate.aiResult.responseTimeMs,
      selected: candidate.candidateId === winner.candidateId,
    }));
    const measuredModelTimes = modelTimings
      .map((timing) => timing.responseTimeMs)
      .filter((value): value is number => Number.isFinite(value));

    this.logger.log(
      `Multi-AI timing for run ${context.runId}: benchmark=${benchmarkDurationMs}ms, candidates=${modelTimings
        .map((timing) => `${timing.providerKey}/${timing.apiModelId}=${timing.responseTimeMs}ms`)
        .join(', ')}`,
    );

    return {
      context: updatedContext,
      resultPreview: [
        `Benchmark selected the best model execution for the immutable opportunity #${winner.opportunityRank} "${winner.opportunityTitle}".`,
        this.createResponsePreview(winner.aiResult.text),
      ].join(' '),
      metadata: {
        winner: {
          candidateId: winner.candidateId,
          operationId: winner.aiResult.operationId,
          aiModelId: winner.aiResult.aiModelId,
          providerKey: winner.aiResult.providerKey,
          apiModelId: winner.aiResult.apiModelId,
          deterministicScore: winner.quality.score,
          qualityThresholdAccepted: winner.quality.accepted,
          availabilityFallbackUsed: !winner.quality.accepted,
          semanticDiversityAdjustedScore: winner.semanticDiversityAdjustedScore,
          aiJudgeScore: winner.aiJudge?.overallScore ?? null,
          hybridFinalScore: winner.hybridFinalScore,
          selectionScore: winner.finalScore,
          opportunityRank: winner.opportunityRank,
          opportunityTitle: winner.opportunityTitle,
          localRelevance: winner.aiJudge?.localRelevance ?? null,
          problemImportance: winner.aiJudge?.problemImportance ?? null,
          innovation: winner.aiJudge?.innovation ?? null,
          regulatoryFeasibility: winner.aiJudge?.regulatoryFeasibility ?? null,
          technicalFeasibility: winner.aiJudge?.technicalFeasibility ?? null,
          marketPotential: winner.aiJudge?.marketPotential ?? null,
          implementationClarity: winner.aiJudge?.implementationClarity ?? null,
          inputTokens: winner.aiResult.inputTokens,
          outputTokens: winner.aiResult.outputTokens,
          costEstimate: winner.aiResult.costEstimate,
          responseTimeMs: winner.aiResult.responseTimeMs,
        },
        benchmarkDurationMs,
        modelExecutionMode: 'PARALLEL_PER_BATCH',
        modelTimings,
        fastestModelResponseMs:
          measuredModelTimes.length > 0 ? Math.min(...measuredModelTimes) : null,
        slowestModelResponseMs:
          measuredModelTimes.length > 0 ? Math.max(...measuredModelTimes) : null,
        totalReportedModelResponseMs: measuredModelTimes.reduce(
          (total, value) => total + value,
          0,
        ),
        comparedCandidates: benchmark.candidates.length,
        comparedStartupConcepts: new Set(
          benchmark.candidates.map((candidate) => candidate.opportunityRank),
        ).size,
        aiJudgeUsed: benchmark.judgeEvaluation !== null,
        judgeConfidence: benchmark.judgeEvaluation?.confidence ?? null,
        judgeReason: benchmark.judgeEvaluation?.reason ?? null,
        judgeExecutiveSummary:
          benchmark.judgeEvaluation?.executiveSummary ?? null,
        judgeWinnerWhy: benchmark.judgeEvaluation?.winnerWhy ?? [],
        judgeComparisonReport:
          benchmark.judgeEvaluation?.comparisonReport ?? [],
        requiresLegalVerification:
          benchmark.judgeEvaluation?.requiresLegalVerification ?? null,
        candidates: benchmark.candidates.map((candidate, index) => ({
          rank: index + 1,
          candidateId: candidate.candidateId,
          aiModelId: candidate.aiResult.aiModelId,
          providerKey: candidate.aiResult.providerKey,
          apiModelId: candidate.aiResult.apiModelId,
          selected: candidate.selected,
          opportunityRank: candidate.opportunityRank,
          opportunityTitle: candidate.opportunityTitle,
          deterministicScore: candidate.quality.score,
          semanticDiversityAdjustedScore:
            candidate.semanticDiversityAdjustedScore,
          aiJudgeScore: candidate.aiJudge?.overallScore ?? null,
          hybridFinalScore: candidate.hybridFinalScore,
          selectionScore: candidate.finalScore,
          localRelevance: candidate.aiJudge?.localRelevance ?? null,
          problemImportance: candidate.aiJudge?.problemImportance ?? null,
          innovation: candidate.aiJudge?.innovation ?? null,
          regulatoryFeasibility:
            candidate.aiJudge?.regulatoryFeasibility ?? null,
          technicalFeasibility: candidate.aiJudge?.technicalFeasibility ?? null,
          marketPotential: candidate.aiJudge?.marketPotential ?? null,
          implementationClarity:
            candidate.aiJudge?.implementationClarity ?? null,
          inputTokens: candidate.aiResult.inputTokens,
          outputTokens: candidate.aiResult.outputTokens,
          costEstimate: candidate.aiResult.costEstimate,
          responseTimeMs: candidate.aiResult.responseTimeMs,
          validationScore: candidate.quality.score,
          qualityThresholdAccepted: candidate.quality.accepted,
          availabilityFallbackUsed: !candidate.quality.accepted,
          validationIssues: candidate.quality.issues.map((issue) => issue.code),
          semanticDiversityScore:
            candidate.semanticDiversity?.diversityScore ?? null,
          maximumSimilarity: candidate.semanticDiversity?.maxSimilarity ?? null,
          mostSimilarCandidateId:
            candidate.semanticDiversity?.mostSimilarCandidateId ?? null,
          semanticDuplicateRisk:
            candidate.semanticDiversity?.duplicateRisk ?? null,
          comparisonReport:
            benchmark.judgeEvaluation?.comparisonReport.find(
              (report) => report.candidateId === candidate.candidateId,
            ) ?? null,
        })),
      },
    };
  }

  private validateContext(context: IdeaGenerationContext): void {
    if (
      !context.policy ||
      !context.collection ||
      !context.nlp ||
      !context.prompt
    ) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.AI_GENERATION_FAILED,
        message:
          'Entitlement, collection data, NLP analysis, and a persisted prompt are required before model benchmarking.',
      });
    }

    if (
      !context.prompt.promptText.trim() ||
      !context.prompt.responseSchemaName.trim()
    ) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.AI_GENERATION_FAILED,
        message:
          'The rendered prompt and structured response schema are required.',
      });
    }
  }

  private mergeAdvancedOutputs(
    existing: IdeaGenerationContext['advancedOutputs'],
    incoming: IdeaGenerationContext['advancedOutputs'],
  ): IdeaGenerationContext['advancedOutputs'] {
    const outputsByKey = new Map(
      existing.map((output) => [output.outputKey, output]),
    );

    for (const output of incoming) {
      outputsByKey.set(output.outputKey, output);
    }

    return Array.from(outputsByKey.values());
  }

  private createResponsePreview(responseText: string): string {
    const normalized = responseText.trim();

    return normalized.length <= MAX_AI_RESPONSE_PREVIEW_LENGTH
      ? normalized
      : normalized.slice(0, MAX_AI_RESPONSE_PREVIEW_LENGTH);
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}