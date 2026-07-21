import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { IdeaGenerationType } from '@prisma/client';

import {
  getIdeaGenerationStageDefinitions,
  type IdeaGenerationStageDefinition,
  type IdeaGenerationStageKey,
} from '../constants/idea-generation-stages.constants';

/**
 * Input used to validate one stage progress range.
 *
 * @author Malak
 */
export type ValidateIdeaGenerationProgressInput = {
  /**
   * Progress recorded before stage execution.
   */
  startProgressPercent: number;

  /**
   * Progress recorded after successful stage execution.
   */
  completedProgressPercent: number;
};

/**
 * Progress metadata resolved for one pipeline stage.
 *
 * @author Malak
 */
export type IdeaGenerationStageProgress = {
  /**
   * Stable stage key.
   */
  stageKey: IdeaGenerationStageKey;

  /**
   * Progress recorded before stage execution.
   */
  startProgressPercent: number;

  /**
   * Progress recorded after successful stage execution.
   *
   * The value never exceeds 99 because progress 100 is reserved
   * for the final generation-run completion operation.
   */
  completedProgressPercent: number;
};

/**
 * Service responsible for resolving and validating progress
 * metadata used by the idea-generation pipeline.
 *
 * Responsibilities:
 * - Resolve stage definitions for free and premium pipelines.
 * - Find the progress definition associated with one stage.
 * - Validate stage progress ranges.
 * - Prevent active stages from setting progress to 100.
 * - Ensure completed progress is not lower than start progress.
 * - Resolve whether premium stages should be included.
 *
 * This service does not:
 * - Persist progress values.
 * - Update IdeaGenerationRun records.
 * - Execute pipeline stages.
 * - Complete generation runs.
 *
 * Progress 100 is intentionally reserved for
 * IdeaGenerationRunService.completeRun().
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationProgressService {
  /**
   * Returns the ordered stage definitions for a generation type.
   *
   * Premium-credit generation includes both core and advanced
   * output stages. Guest-free and normal-free generation include
   * only the core pipeline and finalization stage.
   *
   * @param generationType Selected generation type.
   * @returns Ordered stage definitions.
   */
  getDefinitionsForGenerationType(
    generationType: IdeaGenerationType,
  ): readonly IdeaGenerationStageDefinition[] {
    return this.getDefinitions(this.includesPremiumStages(generationType));
  }

  /**
   * Returns the ordered stage definitions for one pipeline.
   *
   * @param includePremiumStages Whether advanced stages should be included.
   * @returns Ordered stage definitions.
   */
  getDefinitions(
    includePremiumStages: boolean,
  ): readonly IdeaGenerationStageDefinition[] {
    const definitions = getIdeaGenerationStageDefinitions(includePremiumStages);

    this.validateDefinitions(definitions);

    return definitions;
  }

  /**
   * Returns one stage definition by its stable key.
   *
   * @param stageKey Stable stage key.
   * @param includePremiumStages Whether advanced stages are included.
   * @returns Matching stage definition.
   * @throws NotFoundException when the stage is not part of the selected pipeline.
   */
  getDefinition(
    stageKey: IdeaGenerationStageKey,
    includePremiumStages: boolean,
  ): IdeaGenerationStageDefinition {
    const definition = this.getDefinitions(includePremiumStages).find(
      ({ key }) => key === stageKey,
    );

    if (!definition) {
      throw new NotFoundException({
        code: 'IDEA_GENERATION_STAGE_DEFINITION_NOT_FOUND',
        message: `Idea-generation stage "${stageKey}" is not part of the selected pipeline.`,
      });
    }

    return definition;
  }

  /**
   * Returns one stage definition for the selected generation
   * type.
   *
   * @param stageKey Stable stage key.
   * @param generationType Selected generation type.
   * @returns Matching stage definition.
   */
  getDefinitionForGenerationType(
    stageKey: IdeaGenerationStageKey,
    generationType: IdeaGenerationType,
  ): IdeaGenerationStageDefinition {
    return this.getDefinition(
      stageKey,
      this.includesPremiumStages(generationType),
    );
  }

  /**
   * Resolves progress metadata from one stage definition.
   *
   * @param definition Pipeline-stage definition.
   * @returns Safe stage progress metadata.
   */
  resolveStageProgress(
    definition: IdeaGenerationStageDefinition,
  ): IdeaGenerationStageProgress {
    const progress = {
      stageKey: definition.key,
      startProgressPercent: definition.progressStart,
      completedProgressPercent: this.getCompletedProgress(definition),
    };

    this.validateProgress({
      startProgressPercent: progress.startProgressPercent,
      completedProgressPercent: progress.completedProgressPercent,
    });

    return progress;
  }

  /**
   * Resolves safe running progress after successful stage
   * execution.
   *
   * Progress 100 is reserved for completeRun(), therefore stage
   * completion is capped at 99.
   *
   * @param definition Stage definition.
   * @returns Safe completed-stage progress.
   */
  getCompletedProgress(definition: IdeaGenerationStageDefinition): number {
    return Math.min(definition.progressEnd, 99);
  }

  /**
   * Returns whether advanced premium stages must be included for
   * the selected generation type.
   *
   * @param generationType Selected generation type.
   * @returns True only for premium-credit generation.
   */
  includesPremiumStages(generationType: IdeaGenerationType): boolean {
    return generationType === IdeaGenerationType.PREMIUM_CREDIT;
  }

  /**
   * Validates progress values used while a generation run is
   * active.
   *
   * @param input Stage progress range.
   * @throws BadRequestException when progress metadata is invalid.
   */
  validateProgress(input: ValidateIdeaGenerationProgressInput): void {
    this.validateProgressValue(
      input.startProgressPercent,
      'Stage start progress',
    );

    this.validateProgressValue(
      input.completedProgressPercent,
      'Stage completed progress',
    );

    if (input.completedProgressPercent < input.startProgressPercent) {
      throw new BadRequestException({
        code: 'INVALID_IDEA_GENERATION_PROGRESS_ORDER',
        message:
          'Stage completed progress cannot be lower than stage start progress.',
      });
    }
  }

  /**
   * Validates all stage definitions associated with one
   * pipeline.
   *
   * This protects the pipeline from:
   * - Duplicate keys.
   * - Duplicate sequences.
   * - Invalid progress ranges.
   * - Regressing progress between stages.
   *
   * @param definitions Ordered pipeline definitions.
   */
  private validateDefinitions(
    definitions: readonly IdeaGenerationStageDefinition[],
  ): void {
    const stageKeys = new Set<IdeaGenerationStageKey>();

    const sequences = new Set<number>();

    let previousSequence = 0;
    let previousProgressEnd = 0;

    for (const definition of definitions) {
      if (stageKeys.has(definition.key)) {
        throw new BadRequestException({
          code: 'DUPLICATE_IDEA_GENERATION_STAGE_KEY',
          message: `Duplicate idea-generation stage key "${definition.key}".`,
        });
      }

      if (sequences.has(definition.sequence)) {
        throw new BadRequestException({
          code: 'DUPLICATE_IDEA_GENERATION_STAGE_SEQUENCE',
          message: `Duplicate idea-generation stage sequence "${definition.sequence}".`,
        });
      }

      if (!Number.isInteger(definition.sequence) || definition.sequence <= 0) {
        throw new BadRequestException({
          code: 'INVALID_IDEA_GENERATION_STAGE_SEQUENCE',
          message: `Stage "${definition.key}" must have a positive integer sequence.`,
        });
      }

      if (definition.sequence <= previousSequence) {
        throw new BadRequestException({
          code: 'INVALID_IDEA_GENERATION_STAGE_ORDER',
          message: `Stage "${definition.key}" is not ordered correctly.`,
        });
      }

      this.validateProgress({
        startProgressPercent: definition.progressStart,
        completedProgressPercent: this.getCompletedProgress(definition),
      });

      if (definition.progressStart < previousProgressEnd) {
        throw new BadRequestException({
          code: 'INVALID_IDEA_GENERATION_PROGRESS_SEQUENCE',
          message: `Stage "${definition.key}" starts before the previous stage progress has completed.`,
        });
      }

      if (
        !Number.isInteger(definition.maxAttempts) ||
        definition.maxAttempts <= 0
      ) {
        throw new BadRequestException({
          code: 'INVALID_IDEA_GENERATION_STAGE_ATTEMPTS',
          message: `Stage "${definition.key}" must allow at least one execution attempt.`,
        });
      }

      stageKeys.add(definition.key);
      sequences.add(definition.sequence);

      previousSequence = definition.sequence;

      previousProgressEnd = this.getCompletedProgress(definition);
    }
  }

  /**
   * Validates one active-run progress percentage.
   *
   * Progress must be an integer from 0 to 99.
   *
   * @param progressPercent Progress value.
   * @param fieldName Field name used in validation errors.
   */
  private validateProgressValue(
    progressPercent: number,
    fieldName: string,
  ): void {
    if (
      !Number.isInteger(progressPercent) ||
      progressPercent < 0 ||
      progressPercent > 99
    ) {
      throw new BadRequestException({
        code: 'INVALID_IDEA_GENERATION_PROGRESS',
        message: `${fieldName} must be an integer between 0 and 99.`,
      });
    }
  }
}
