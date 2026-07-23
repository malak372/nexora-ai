import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiRequestType, PromptType } from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import {
  IDEA_JUDGE_MAX_OUTPUT_TOKENS,
  IDEA_JUDGE_RESPONSE_SCHEMA_NAME,
  IDEA_JUDGE_TEMPERATURE,
} from '../constants/idea-judge.constants';
import { buildIdeaJudgeResponseSchema } from '../schemas/idea-judge.schema';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type {
  IdeaJudgeCandidateInput,
  IdeaJudgeEvaluation,
} from '../types/idea-judge.type';
import { IdeaCandidateJudgePromptService } from './idea-candidate-judge-prompt.service';

/**
 * Executes AI-only comparative evaluation for all successful candidates.
 *
 * This service never calculates a hybrid score and never falls back to a
 * deterministic ranking. When two or more valid candidates exist, a valid AI
 * judge decision is required before the workflow can select a winner.
 *
 * Legal and regulatory results remain preliminary risk indicators only.
 *
 * @author Malak
 */
@Injectable()
export class IdeaCandidateJudgeService {
  private readonly logger = new Logger(IdeaCandidateJudgeService.name);

  constructor(
    private readonly aiExecutionService: AiExecutionService,
    private readonly promptService: IdeaCandidateJudgePromptService,
  ) {}

  /**
   * Compares every successful candidate using one structured AI request.
   *
   * @param context Current idea-generation context.
   * @param candidates All successfully generated and parsed candidates.
   * @returns Fully validated comparative AI decision.
   * @throws ServiceUnavailableException when comparison cannot be completed.
   */
  async evaluate(
    context: IdeaGenerationContext,
    candidates: readonly IdeaJudgeCandidateInput[],
  ): Promise<IdeaJudgeEvaluation> {
    if (candidates.length < 2) {
      throw new ServiceUnavailableException(
        'At least two successful candidates are required for AI comparison.',
      );
    }

    try {
      const prompt = this.promptService.build(context, candidates);

      const aiResult = await this.aiExecutionService.execute({
        userPrompt: prompt.userPrompt,
        systemInstruction: prompt.systemInstruction,
        requestType: ApiRequestType.IDEA_GENERATION,
        promptType: PromptType.IDEA_EVALUATION,
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
        responseSchema: buildIdeaJudgeResponseSchema(candidates.length),
        responseSchemaName: IDEA_JUDGE_RESPONSE_SCHEMA_NAME,
        estimatedOutputTokens: IDEA_JUDGE_MAX_OUTPUT_TOKENS,
        maxOutputTokens: IDEA_JUDGE_MAX_OUTPUT_TOKENS,
        temperature: IDEA_JUDGE_TEMPERATURE,
      });

      const evaluation = this.parseEvaluation(aiResult.text);
      this.validateCandidateReferences(evaluation, candidates);

      return evaluation;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown comparative judge failure.';

      this.logger.error(`AI candidate judge failed: ${message}`);

      throw new ServiceUnavailableException(
        'The AI judge could not compare all successful idea candidates.',
      );
    }
  }

  private parseEvaluation(text: string): IdeaJudgeEvaluation {
    const parsed: unknown = JSON.parse(text);

    if (!this.isRecord(parsed) || !Array.isArray(parsed.scores)) {
      throw new Error('The AI judge returned an invalid root structure.');
    }

    return parsed as IdeaJudgeEvaluation;
  }

  private validateCandidateReferences(
    evaluation: IdeaJudgeEvaluation,
    candidates: readonly IdeaJudgeCandidateInput[],
  ): void {
    const allowedIds = new Set(
      candidates.map((candidate) => candidate.candidateId),
    );

    if (!allowedIds.has(evaluation.winnerCandidateId)) {
      throw new Error('The AI judge selected an unknown candidate.');
    }

    const returnedIds = new Set<string>();

    for (const score of evaluation.scores) {
      if (!allowedIds.has(score.candidateId)) {
        throw new Error('The AI judge scored an unknown candidate.');
      }

      if (returnedIds.has(score.candidateId)) {
        throw new Error('The AI judge returned a duplicate candidate score.');
      }

      returnedIds.add(score.candidateId);
    }

    if (returnedIds.size !== candidates.length) {
      throw new Error('The AI judge did not score every submitted candidate.');
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
