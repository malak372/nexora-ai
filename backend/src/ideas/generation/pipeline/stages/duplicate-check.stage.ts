import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
  IDEA_TITLE_SIMILARITY_THRESHOLD,
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

import { IdeaDuplicateDetectionService } from '../../services/idea-duplicate-detection.service';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';

/**
 * Checks whether the generated idea title is highly similar to an
 * existing idea owned by the same requester in the same domain.
 *
 * Responsibilities:
 * - Verify that validated core idea output exists.
 * - Scope duplicate detection to the registered user when one is
 *   present.
 * - Compare the generated title with recent ideas in the selected
 *   domain.
 * - Stop the pipeline when the configured similarity threshold is
 *   reached.
 * - Return diagnostic similarity metadata.
 *
 * IdeaPersistenceService repeats the duplicate check inside its
 * serializable transaction. The repeated final check prevents a
 * race condition where another matching idea is persisted between
 * this pipeline stage and the persistence transaction.
 *
 * This stage does not:
 * - Persist the generated idea.
 * - Modify existing ideas.
 * - Deduct credits.
 * - Consume free-generation entitlement.
 *
 * @author Malak
 */
@Injectable()
export class DuplicateCheckStage implements IdeaGenerationStage {
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.DUPLICATE_CHECK;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly duplicateDetectionService: IdeaDuplicateDetectionService,
  ) {}

  /**
   * Performs pre-persistence duplicate detection.
   *
   * @param context Current generation context.
   * @returns Unchanged context when no duplicate is found.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const userId =
      context.owner.type === IDEA_OWNER_TYPES.USER
        ? context.owner.userId
        : undefined;

    const result = await this.duplicateDetectionService.check(
      userId,
      context.domainId,
      context.coreIdea!.title,
    );

    if (result.isDuplicate) {
      throw new ConflictException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message:
          'A highly similar generated idea already exists for this domain.',

        details: {
          matchedIdeaId: result.matchedIdea?.id ?? null,

          matchedTitle: result.matchedIdea?.title ?? null,

          similarity: result.highestSimilarity,

          threshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
        },
      });
    }

    return {
      context,

      resultPreview: 'No duplicate generated idea was detected.',

      metadata: {
        isDuplicate: false,

        highestSimilarity: result.highestSimilarity,

        matchedIdeaId: result.matchedIdea?.id ?? null,

        threshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
      },
    };
  }

  /**
   * Validates all context values required for duplicate
   * detection.
   *
   * @param context Current generation context.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.coreIdea) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message:
          'Validated core idea output is required before duplicate detection.',
      });
    }

    if (!context.domainId?.trim()) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message: 'A valid domain ID is required before duplicate detection.',
      });
    }

    if (!context.coreIdea.title?.trim()) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message:
          'A valid generated idea title is required before duplicate detection.',
      });
    }
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Duplicate-check stage definition.
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
