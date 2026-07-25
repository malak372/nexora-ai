import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiRoutingStrategy, ApiRequestType, PromptType } from '@prisma/client';

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
  ): Promise<IdeaJudgeEvaluation | null> {
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
        strategy: AiRoutingStrategy.BALANCED,
        allowProviderFallbackOnInvalidPrompt: true,
      });

      const evaluation = this.parseEvaluation(aiResult.text);
      this.validateEvaluation(evaluation);
      this.validateCandidateReferences(evaluation, candidates);

      return evaluation;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown comparative judge failure.';

      this.logger.warn(
        `AI candidate judge was unavailable; deterministic ranking will be used. Reason: ${message}`,
      );

      return null;
    }
  }

  private parseEvaluation(text: string): IdeaJudgeEvaluation {
    const parsed: unknown = JSON.parse(text);

    if (!this.isRecord(parsed) || !Array.isArray(parsed.scores)) {
      throw new Error('The AI judge returned an invalid root structure.');
    }

    const confidence = this.normalizeConfidence(parsed.confidence);

    return {
      ...(parsed as Omit<IdeaJudgeEvaluation, 'confidence'>),
      confidence,
    };
  }

  /**
   * Normalizes provider confidence to the canonical 0-100 percentage range.
   *
   * Some models return confidence as a fraction such as 0.6 even when the
   * schema requests a percentage. Values from 0 through 1 are therefore
   * converted to percentages, while values above 1 remain unchanged.
   */
  private normalizeConfidence(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('The AI judge returned an invalid confidence value.');
    }

    const normalized = value <= 1 ? value * 100 : value;

    if (normalized < 0 || normalized > 100) {
      throw new Error('AI judge confidence must be between 0 and 100.');
    }

    return Math.round(normalized * 100) / 100;
  }

  /** Validates core scalar fields before candidate-reference validation. */
  private validateEvaluation(evaluation: IdeaJudgeEvaluation): void {
    if (
      typeof evaluation.winnerCandidateId !== 'string' ||
      !evaluation.winnerCandidateId.trim()
    ) {
      throw new Error('The AI judge returned an invalid winner candidate ID.');
    }

    if (typeof evaluation.reason !== 'string' || !evaluation.reason.trim()) {
      throw new Error('The AI judge returned an invalid decision reason.');
    }

    if (typeof evaluation.requiresLegalVerification !== 'boolean') {
      throw new Error(
        'The AI judge returned an invalid legal-verification flag.',
      );
    }
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
