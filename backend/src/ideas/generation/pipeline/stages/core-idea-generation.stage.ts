import { BadRequestException, Injectable } from '@nestjs/common';

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
 * Every active routable JSON-capable model receives the same prompt. Every
 * successful candidate is sent to the AI judge, which selects one existing
 * candidate without hybrid or deterministic winner scoring.
 *
 * Deterministic quality data remains visible only for diagnostics and does not
 * participate in selection.
 *
 * @author Eman
 */
@Injectable()
export class CoreIdeaGenerationStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.CORE_IDEA_GENERATION;

  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly benchmarkService: IdeaGenerationBenchmarkService,
  ) {}

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const benchmark = await this.benchmarkService.benchmark(context);
    const winner = benchmark.winner;

    const updatedContext: IdeaGenerationContext = {
      ...context,
      coreIdea: winner.parsedOutput.coreIdea,
      advancedOutputs: this.mergeAdvancedOutputs(
        context.advancedOutputs,
        winner.parsedOutput.advancedOutputs,
      ),
    };

    return {
      context: updatedContext,
      resultPreview: this.createResponsePreview(winner.aiResult.text),
      metadata: {
        winner: {
          candidateId: winner.candidateId,
          operationId: winner.aiResult.operationId,
          aiModelId: winner.aiResult.aiModelId,
          providerKey: winner.aiResult.providerKey,
          apiModelId: winner.aiResult.apiModelId,
          aiJudgeScore: winner.aiJudge?.overallScore ?? null,
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
        comparedCandidates: benchmark.candidates.length,
        aiJudgeUsed: benchmark.judgeEvaluation !== null,
        judgeConfidence: benchmark.judgeEvaluation?.confidence ?? null,
        judgeReason: benchmark.judgeEvaluation?.reason ?? null,
        requiresLegalVerification:
          benchmark.judgeEvaluation?.requiresLegalVerification ?? null,
        candidates: benchmark.candidates.map((candidate, index) => ({
          rank: index + 1,
          candidateId: candidate.candidateId,
          aiModelId: candidate.aiResult.aiModelId,
          providerKey: candidate.aiResult.providerKey,
          apiModelId: candidate.aiResult.apiModelId,
          selected: candidate.selected,
          aiJudgeScore: candidate.aiJudge?.overallScore ?? null,
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
          validationIssues: candidate.quality.issues.map((issue) => issue.code),
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
