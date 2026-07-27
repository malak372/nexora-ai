import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  IDEA_JUDGE_MAX_ATTEMPTS,
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
    private readonly aiModelsService: AiModelsService,
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

    const prompt = this.promptService.build(context, candidates);
    const localFallbackModel = await this.findLocalFallbackModel();
    const onlineExcludedModelIds = localFallbackModel
      ? [localFallbackModel.id]
      : [];
    let lastFailureMessage = 'Unknown comparative judge failure.';

    /*
     * Online attempts explicitly exclude Ollama. This ensures that the local
     * model is a visible, auditable final tier rather than being consumed
     * somewhere inside an online retry. If an online provider fails or returns
     * a schema-valid but business-invalid decision, Ollama receives one final
     * request using the exact same validation rules.
     */
    for (let attempt = 1; attempt <= IDEA_JUDGE_MAX_ATTEMPTS; attempt += 1) {
      try {
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
          strategy:
            attempt === 1
              ? AiRoutingStrategy.BALANCED
              : AiRoutingStrategy.DEFAULT,
          excludedAiModelIds: onlineExcludedModelIds,
          allowProviderFallbackOnInvalidPrompt: true,
        });

        const evaluation = this.parseAndValidateEvaluation(
          aiResult.text,
          candidates,
        );

        if (attempt > 1) {
          this.logger.log(
            `AI candidate judge succeeded on bounded online retry ${attempt}.`,
          );
        }

        return evaluation;
      } catch (error: unknown) {
        lastFailureMessage =
          error instanceof Error
            ? error.message
            : 'Unknown comparative judge failure.';

        this.logger.warn(
          `Online AI candidate judge attempt ${attempt}/${IDEA_JUDGE_MAX_ATTEMPTS} failed: ${lastFailureMessage}`,
        );
      }
    }

    if (localFallbackModel) {
      try {
        this.logger.warn(
          `Online AI judge attempts were exhausted. Executing local Ollama judge "${localFallbackModel.displayName ?? localFallbackModel.modelName}" once.`,
        );

        const localResult = await this.aiExecutionService.execute({
          aiModelId: localFallbackModel.id,
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
          allowProviderFallbackOnInvalidPrompt: true,
        });

        const localEvaluation = this.parseAndValidateEvaluation(
          localResult.text,
          candidates,
        );

        this.logger.log(
          `AI candidate judge succeeded using local Ollama fallback. modelId=${localResult.aiModelId}, apiModelId=${localResult.apiModelId}.`,
        );

        return localEvaluation;
      } catch (localError: unknown) {
        lastFailureMessage =
          localError instanceof Error
            ? localError.message
            : 'Unknown local Ollama judge failure.';

        this.logger.warn(
          `Local Ollama AI judge failed or returned an invalid comparison: ${lastFailureMessage}`,
        );
      }
    }

    this.logger.warn(
      `AI candidate judge was unavailable after exhausting online attempts${localFallbackModel ? ' and the local Ollama fallback' : ''}; deterministic ranking will be used. Reason: ${lastFailureMessage}`,
    );

    return null;
  }

  /**
   * Parses and validates one comparative response from either execution tier.
   */
  private parseAndValidateEvaluation(
    text: string,
    candidates: readonly IdeaJudgeCandidateInput[],
  ): IdeaJudgeEvaluation {
    const evaluation = this.parseEvaluation(text);

    this.validateEvaluation(evaluation);
    this.validateCandidateReferences(evaluation, candidates);

    return evaluation;
  }

  /**
   * Finds one active, routable local model that can return structured JSON.
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

    if (
      typeof evaluation.executiveSummary !== 'string' ||
      !evaluation.executiveSummary.trim() ||
      !Array.isArray(evaluation.winnerWhy) ||
      evaluation.winnerWhy.length < 2 ||
      !Array.isArray(evaluation.comparisonReport)
    ) {
      throw new Error('The AI judge returned an incomplete comparison report.');
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

    const reportIds = new Set<string>();
    for (const report of evaluation.comparisonReport) {
      if (!allowedIds.has(report.candidateId)) {
        throw new Error('The AI judge reported on an unknown candidate.');
      }
      if (reportIds.has(report.candidateId)) {
        throw new Error('The AI judge returned a duplicate comparison report.');
      }
      reportIds.add(report.candidateId);
    }

    if (reportIds.size !== candidates.length) {
      throw new Error(
        'The AI judge did not report on every submitted candidate.',
      );
    }

    const winnerReports = evaluation.comparisonReport.filter(
      (report) => report.verdict === 'WINNER',
    );
    if (
      winnerReports.length !== 1 ||
      winnerReports[0]?.candidateId !== evaluation.winnerCandidateId
    ) {
      throw new Error('The AI judge comparison report has an invalid winner.');
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
