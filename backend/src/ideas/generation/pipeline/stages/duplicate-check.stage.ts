import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
  IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
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

/**
 * Checks whether the generated idea title is highly similar to an
 * existing idea in the same domain and geographic area.
 *
 * Responsibilities:
 * - Verify that validated core idea output exists.
 * - Scope duplicate detection to the selected domain and collection area.
 * - Compare the generated idea with recent ideas from all users in that area.
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
  private readonly logger = new Logger(DuplicateCheckStage.name);

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

    const result = await this.duplicateDetectionService.check(
      context.domainId,
      context.collection!.collectionJobId,
      context.coreIdea!,
    );

    /*
     * The benchmark already performs duplicate-aware redesign before winner
     * selection. AI output validation can then expand the problem statement and
     * full abstract using evidence wording shared by every concept generated
     * from the same opportunity. That expansion may trigger a broad compound
     * SAME_PROBLEM_FAMILY result even though the product mechanism was already
     * redesigned.
     *
     * The final stage therefore blocks only decisive duplicates:
     * - exact or near-exact title;
     * - very high overall semantic overlap;
     * - same problem family together with both high semantic and workflow
     *   overlap.
     *
     * Moderate same-family overlap is retained as diagnostic metadata instead
     * of failing the whole paid generation after a successful redesign.
     */
    const decisiveDuplicate = this.isDecisiveDuplicate(result);

    if (decisiveDuplicate) {
      throw new ConflictException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message:
          'A decisively similar generated idea already exists for this domain.',

        details: {
          matchedIdeaId: result.matchedIdea?.id ?? null,

          matchedTitle: result.matchedIdea?.title ?? null,

          highestSimilarity: result.highestSimilarity,

          titleSimilarity: result.titleSimilarity,

          semanticSimilarity: result.semanticSimilarity,

          workflowSimilarity: result.workflowSimilarity,

          sameProblemFamily: result.sameProblemFamily,

          duplicateReasons: result.duplicateReasons,

          titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,

          semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
        },
      });
    }

    if (result.isDuplicate) {
      this.logger.warn(
        [
          `Soft duplicate signal retained for run "${context.runId}" without failing generation.`,
          `matchedIdeaId=${result.matchedIdea?.id ?? 'none'}`,
          `titleSimilarity=${result.titleSimilarity}`,
          `semanticSimilarity=${result.semanticSimilarity}`,
          `workflowSimilarity=${result.workflowSimilarity}`,
          `sameProblemFamily=${result.sameProblemFamily}`,
          `reasons=${result.duplicateReasons.join(',') || 'none'}`,
        ].join(' '),
      );
    }

    return {
      context,

      resultPreview: result.isDuplicate
        ? 'A moderate same-problem-family overlap was detected after benchmark redesign, but no decisive duplicate was found.'
        : 'No duplicate generated idea was detected.',

      metadata: {
        isDuplicate: false,

        softDuplicateSignalDetected: result.isDuplicate,

        decisiveDuplicate: false,

        highestSimilarity: result.highestSimilarity,

        titleSimilarity: result.titleSimilarity,

        semanticSimilarity: result.semanticSimilarity,

        workflowSimilarity: result.workflowSimilarity,

        sameProblemFamily: result.sameProblemFamily,

        duplicateReasons: result.duplicateReasons,

        matchedIdeaId: result.matchedIdea?.id ?? null,

        matchedTitle: result.matchedIdea?.title ?? null,

        titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,

        semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
      },
    };
  }

  /**
   * Returns true only for similarity strong enough to reject the final idea.
   *
   * A same-family match by itself is not decisive because every candidate for
   * one evidence-backed opportunity necessarily shares part of the problem
   * vocabulary. The workflow must also remain nearly identical.
   */
  private isDecisiveDuplicate(
    result: Awaited<ReturnType<IdeaDuplicateDetectionService['check']>>,
  ): boolean {
    const exactOrNearTitle =
      result.titleSimilarity >= IDEA_TITLE_SIMILARITY_THRESHOLD;
    const veryHighSemanticOverlap =
      result.semanticSimilarity >= IDEA_SEMANTIC_SIMILARITY_THRESHOLD;
    const decisiveSameFamilyWorkflow =
      result.sameProblemFamily &&
      result.semanticSimilarity >= 0.86 &&
      result.workflowSimilarity >= 0.9;
    const decisiveCrossFamilyWorkflow =
      result.semanticSimilarity >= 0.8 &&
      result.workflowSimilarity >= 0.7;

    return (
      exactOrNearTitle ||
      veryHighSemanticOverlap ||
      decisiveSameFamilyWorkflow ||
      decisiveCrossFamilyWorkflow
    );
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