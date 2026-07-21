import { BadRequestException, Injectable } from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
  MIN_COLLECTED_TEXTS_FOR_GENERATION,
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

import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
} from '../../types/idea-generation-context.type';

/**
 * Validates the normalized NLP analysis resolved for the current
 * collection job.
 *
 * CollectionJobResolverService currently restores or executes
 * intelligent NLP analysis during collection-job resolution.
 *
 * This stage therefore provides an explicit NLP checkpoint that:
 * - Confirms a persisted NLP-analysis identifier exists.
 * - Confirms analyzed-text counters are valid.
 * - Confirms sufficient text was analyzed.
 * - Normalizes the optional confidence value.
 * - Preserves the NLP_ANALYSIS stage in pipeline tracking.
 *
 * This stage does not:
 * - Execute IntelligentAnalysisService directly.
 * - Persist NlpAnalysis records.
 * - Enhance analysis through an AI provider.
 * - Build the idea-generation prompt.
 *
 * @author Malak
 */
@Injectable()
export class NlpAnalysisStage implements IdeaGenerationStage {
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.NLP_ANALYSIS;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  /**
   * Determines whether the NLP validation checkpoint should run.
   *
   * @returns Always true.
   */
  shouldExecute(): boolean {
    return true;
  }

  /**
   * Validates and normalizes the NLP context.
   *
   * @param context Current generation context.
   * @returns Context containing validated NLP information.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    await Promise.resolve();
    if (!context.collection) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,

        message: 'Collection data must be resolved before NLP validation.',
      });
    }

    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,

        message: 'Collection-job resolution did not provide NLP analysis.',
      });
    }

    const normalizedNlp = this.normalizeNlpContext(context.nlp);

    if (normalizedNlp.totalTextsAnalyzed < MIN_COLLECTED_TEXTS_FOR_GENERATION) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INSUFFICIENT_COLLECTED_DATA,

        message: `At least ${MIN_COLLECTED_TEXTS_FOR_GENERATION} analyzed text record is required before prompt building.`,
      });
    }

    const updatedContext: IdeaGenerationContext = {
      ...context,
      nlp: normalizedNlp,
    };

    return {
      context: updatedContext,

      resultPreview: `NLP analysis verified successfully for ${normalizedNlp.totalTextsAnalyzed} text record(s).`,

      metadata: {
        nlpAnalysisId: normalizedNlp.nlpAnalysisId,

        totalTextsAnalyzed: normalizedNlp.totalTextsAnalyzed,

        totalPostsAnalyzed: normalizedNlp.totalPostsAnalyzed,

        totalCommentsAnalyzed: normalizedNlp.totalCommentsAnalyzed,

        aiUsed: normalizedNlp.aiUsed,

        confidence: normalizedNlp.confidence,
      },
    };
  }

  /**
   * Validates and normalizes the NLP data needed by subsequent
   * stages.
   *
   * @param nlp Raw NLP context.
   * @returns Normalized NLP context.
   */
  private normalizeNlpContext(
    nlp: IdeaGenerationNlpContext,
  ): IdeaGenerationNlpContext {
    const nlpAnalysisId = this.requireIdentifier(
      nlp.nlpAnalysisId,
      'NLP-analysis ID',
    );

    const totalPostsAnalyzed = this.normalizeCount(
      nlp.totalPostsAnalyzed,
      'Analyzed posts count',
    );

    const totalCommentsAnalyzed = this.normalizeCount(
      nlp.totalCommentsAnalyzed,
      'Analyzed comments count',
    );

    const totalTextsAnalyzed = this.normalizeCount(
      nlp.totalTextsAnalyzed,
      'Analyzed texts count',
    );

    const calculatedTotal = totalPostsAnalyzed + totalCommentsAnalyzed;

    if (totalTextsAnalyzed < calculatedTotal) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,

        message:
          'The total analyzed-text count cannot be lower than the combined post and comment counts.',
      });
    }

    return {
      ...nlp,

      nlpAnalysisId,

      totalTextsAnalyzed,

      totalPostsAnalyzed,

      totalCommentsAnalyzed,

      aiUsed: Boolean(nlp.aiUsed),

      confidence: this.normalizeConfidence(nlp.confidence),
    };
  }

  /**
   * Normalizes an optional NLP confidence value.
   *
   * Confidence is accepted in the inclusive range from zero to
   * one.
   *
   * @param confidence Raw confidence value.
   * @returns Valid confidence or null.
   */
  private normalizeConfidence(confidence: number | null): number | null {
    if (confidence === null || confidence === undefined) {
      return null;
    }

    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,

        message: 'NLP confidence must be a finite value between 0 and 1.',
      });
    }

    return confidence;
  }

  /**
   * Validates one non-negative analysis counter.
   *
   * @param value Raw counter.
   * @param fieldName Field name used in validation errors.
   * @returns Valid count.
   */
  private normalizeCount(value: number, fieldName: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,

        message: `${fieldName} must be a non-negative integer.`,
      });
    }

    return value;
  }

  /**
   * Validates and normalizes one required identifier.
   *
   * @param value Raw identifier.
   * @param fieldName Field name used in validation errors.
   * @returns Normalized identifier.
   */
  private requireIdentifier(value: string, fieldName: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,

        message: `${fieldName} is required.`,
      });
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,

        message: `${fieldName} is required.`,
      });
    }

    return normalizedValue;
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns NLP-analysis stage definition.
   */
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
