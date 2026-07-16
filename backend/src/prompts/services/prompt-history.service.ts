
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  PromptHistory,
  PromptType,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { GetPromptHistoryQueryDto } from '../dto/get-prompt-history-query.dto';

import {
  PaginatedPromptHistory,
  PROMPT_HISTORY_INCLUDE,
} from '../types/prompt-history.type';

import { SavePromptParams } from '../types/save-prompt-params.type';

/**
 * PromptHistory fields permitted for administrator-controlled sorting.
 *
 * Restricting sorting to known scalar fields prevents unsupported
 * query values from being passed directly to Prisma.
 *
 * @author Malak
 */
const PROMPT_HISTORY_SORT_FIELDS = [
  'createdAt',
  'promptType',
  'estimatedInputTokens',
] as const;

/**
 * Prompt types representing user-requested AI operations.
 *
 * These operations must belong to exactly one requester:
 * - An authenticated user.
 * - A guest session.
 *
 * Internal operations such as NLP_ANALYSIS and
 * ABSTRACT_GENERATION may be saved without a requester.
 */
const REQUESTER_REQUIRED_PROMPT_TYPES =
  new Set<PromptType>([
    PromptType.IDEA_GENERATION,
    PromptType.IDEA_UNLOCK,
    PromptType.CHAT_RESPONSE,
  ]);

/**
 * Prompt types restricted to authenticated users.
 *
 * Guest sessions cannot:
 * - Unlock existing ideas.
 * - Access the idea AI chat.
 */
const AUTHENTICATED_USER_PROMPT_TYPES =
  new Set<PromptType>([
    PromptType.IDEA_UNLOCK,
    PromptType.CHAT_RESPONSE,
  ]);

/**
 * Prompt types that must be connected to a collection job.
 *
 * Idea generation and direct unlock depend on the persisted
 * collection and NLP stages.
 */
const COLLECTION_JOB_REQUIRED_PROMPT_TYPES =
  new Set<PromptType>([
    PromptType.IDEA_GENERATION,
    PromptType.IDEA_UNLOCK,
  ]);

/**
 * Handles prompt-history persistence and administrator retrieval.
 *
 * Prompt history provides:
 * - AI debugging information.
 * - Prompt auditing.
 * - Template-version tracking.
 * - Estimated token monitoring.
 * - User and guest ownership tracking.
 * - Collection-job traceability.
 * - Linking the generated Idea after successful generation.
 *
 * This service does not:
 * - Build prompts.
 * - Call AI providers.
 * - Create ideas.
 * - Deduct credits.
 * - Process payments.
 * - Execute NLP analysis.
 *
 * @author Malak
 */
@Injectable()
export class PromptHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists one rendered prompt prepared for an AI provider.
   *
   * Validation rules:
   * - A prompt cannot belong to both a user and a guest session.
   * - User-facing prompts must have exactly one requester.
   * - IDEA_UNLOCK and CHAT_RESPONSE require a registered user.
   * - IDEA_GENERATION and IDEA_UNLOCK require a collection job.
   * - The rendered prompt must not be blank.
   * - Estimated token usage cannot be negative.
   * - Template hashes must be valid SHA-256 hashes when supplied.
   *
   * PromptHistory may initially have no ideaId because the prompt
   * is normally saved before the AI result and Idea record exist.
   *
   * @param params Prompt text, type, ownership, and trace metadata.
   * @returns Newly created PromptHistory record.
   */
  async savePrompt(
    params: SavePromptParams,
  ): Promise<PromptHistory> {
    const normalizedParams =
      this.normalizeSaveParams(params);

    this.validatePromptPersistence(normalizedParams);

    return this.prisma.promptHistory.create({
      data: {
        userId: normalizedParams.userId,
        guestSessionId:
          normalizedParams.guestSessionId,
        collectionJobId:
          normalizedParams.collectionJobId,
        ideaId: normalizedParams.ideaId,
        promptType: normalizedParams.promptType,
        promptText: normalizedParams.promptText,
        templateHash:
          normalizedParams.templateHash,
        estimatedInputTokens:
          normalizedParams.estimatedInputTokens,
      },
    });
  }

  /**
   * Associates a saved PromptHistory record with the Idea created
   * or expanded from that prompt.
   *
   * Expected generation workflow:
   *
   * 1. Build the prompt.
   * 2. Save PromptHistory.
   * 3. Call the AI provider.
   * 4. Validate the AI result.
   * 5. Create or update the Idea.
   * 6. Attach the Idea to PromptHistory.
   *
   * Validation prevents:
   * - Linking a prompt to more than one idea.
   * - Linking a soft-deleted idea.
   * - Linking records belonging to different users.
   * - Linking records belonging to different guest sessions.
   * - Linking records associated with different collection jobs.
   *
   * Calling the method repeatedly with the same relationship
   * is idempotent.
   *
   * @param promptHistoryId PromptHistory identifier.
   * @param ideaId Active Idea identifier.
   * @returns Updated or already-associated PromptHistory record.
   */
  async attachIdea(
    promptHistoryId: string,
    ideaId: string,
  ): Promise<PromptHistory> {
    const normalizedPromptHistoryId =
      this.requireIdentifier(
        promptHistoryId,
        'Prompt history ID',
      );

    const normalizedIdeaId =
      this.requireIdentifier(ideaId, 'Idea ID');

    const [promptHistory, idea] =
      await Promise.all([
        this.prisma.promptHistory.findUnique({
          where: {
            id: normalizedPromptHistoryId,
          },
          select: {
            id: true,
            promptType: true,
            ideaId: true,
            userId: true,
            guestSessionId: true,
            collectionJobId: true,
          },
        }),

        /**
         * findFirst is used because deletedAt is not part of
         * the unique identifier. Soft-deleted ideas must not
         * be attached to prompt history.
         */
        this.prisma.idea.findFirst({
          where: {
            id: normalizedIdeaId,
            deletedAt: null,
          },
          select: {
            id: true,
            userId: true,
            guestSessionId: true,
            collectionJobId: true,
          },
        }),
      ]);

    if (!promptHistory) {
      throw new NotFoundException(
        'Prompt history record not found.',
      );
    }

    if (!idea) {
      throw new NotFoundException(
        'Active idea not found.',
      );
    }

    /**
     * Allows idempotent attachment to the same idea while
     * preventing the prompt from being reassigned.
     */
    if (
      promptHistory.ideaId !== null &&
      promptHistory.ideaId !== idea.id
    ) {
      throw new BadRequestException(
        'Prompt history is already associated with another idea.',
      );
    }

    this.validatePromptIdeaOwnership(
      promptHistory,
      idea,
    );

    if (promptHistory.ideaId === idea.id) {
      return this.prisma.promptHistory.findUniqueOrThrow({
        where: {
          id: promptHistory.id,
        },
      });
    }

    return this.prisma.promptHistory.update({
      where: {
        id: promptHistory.id,
      },
      data: {
        ideaId: idea.id,
      },
    });
  }

  /**
   * Returns filtered, sorted, and paginated PromptHistory records
   * for the administrator history view.
   *
   * Included context:
   * - Authenticated requester.
   * - Guest-session metadata.
   * - Related idea.
   * - Collection job.
   * - Domain.
   * - Collection data sources.
   *
   * Sensitive values such as password hashes, guest tokens,
   * and guest fingerprints are intentionally excluded.
   *
   * @param query Administrator filtering and pagination values.
   * @returns Paginated prompt-history result.
   */
  async findAll(
    query: GetPromptHistoryQueryDto,
  ): Promise<PaginatedPromptHistory> {
    const { page, limit, skip, take } =
      buildPagination(query);

    const where = this.buildWhereClause(query);

    const orderBy = buildOrderBy(
      query,
      PROMPT_HISTORY_SORT_FIELDS,
      'createdAt',
    );

    const [data, total] =
      await this.prisma.$transaction([
        this.prisma.promptHistory.findMany({
          where,
          skip,
          take,
          orderBy,
          include: PROMPT_HISTORY_INCLUDE,
        }),

        this.prisma.promptHistory.count({
          where,
        }),
      ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages:
          calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Validates normalized values before prompt persistence.
   *
   * @param params Normalized prompt persistence values.
   */
  private validatePromptPersistence(
    params: NormalizedSavePromptParams,
  ): void {
    const hasUser = params.userId !== undefined;
    const hasGuestSession =
      params.guestSessionId !== undefined;

    /**
     * A single prompt cannot have two different requester types.
     */
    if (hasUser && hasGuestSession) {
      throw new BadRequestException(
        'Prompt history cannot belong to both a user and a guest session.',
      );
    }

    /**
     * User-requested AI operations must identify one requester.
     */
    if (
      REQUESTER_REQUIRED_PROMPT_TYPES.has(
        params.promptType,
      ) &&
      !hasUser &&
      !hasGuestSession
    ) {
      throw new BadRequestException(
        'Prompt history must belong to a user or a guest session.',
      );
    }

    /**
     * Direct unlock and chat cannot be requested by guests.
     */
    if (
      AUTHENTICATED_USER_PROMPT_TYPES.has(
        params.promptType,
      ) &&
      !hasUser
    ) {
      throw new BadRequestException(
        `${params.promptType} prompt history must belong to an authenticated user.`,
      );
    }

    /**
     * Generation and unlock depend on collection and NLP context.
     */
    if (
      COLLECTION_JOB_REQUIRED_PROMPT_TYPES.has(
        params.promptType,
      ) &&
      params.collectionJobId === undefined
    ) {
      throw new BadRequestException(
        `${params.promptType} prompt history must be associated with a collection job.`,
      );
    }

    if (params.promptText.length === 0) {
      throw new BadRequestException(
        'Prompt text cannot be empty.',
      );
    }

    if (
      params.estimatedInputTokens !== undefined &&
      params.estimatedInputTokens < 0
    ) {
      throw new BadRequestException(
        'Estimated input tokens cannot be negative.',
      );
    }

    if (
      params.templateHash !== undefined &&
      !/^[a-f0-9]{64}$/i.test(
        params.templateHash,
      )
    ) {
      throw new BadRequestException(
        'Template hash must be a valid SHA-256 hash.',
      );
    }
  }

  /**
   * Verifies that PromptHistory and Idea represent the same
   * requester and collection-job context.
   *
   * @param promptHistory Saved PromptHistory ownership values.
   * @param idea Active Idea ownership values.
   */
  private validatePromptIdeaOwnership(
    promptHistory: {
      promptType: PromptType;
      userId: string | null;
      guestSessionId: string | null;
      collectionJobId: string | null;
    },
    idea: {
      userId: string | null;
      guestSessionId: string | null;
      collectionJobId: string | null;
    },
  ): void {
    if (
      promptHistory.userId !== null &&
      promptHistory.userId !== idea.userId
    ) {
      throw new BadRequestException(
        'Prompt history and idea belong to different users.',
      );
    }

    if (
      promptHistory.guestSessionId !== null &&
      promptHistory.guestSessionId !==
        idea.guestSessionId
    ) {
      throw new BadRequestException(
        'Prompt history and idea belong to different guest sessions.',
      );
    }

    if (
      promptHistory.collectionJobId !== null &&
      promptHistory.collectionJobId !==
        idea.collectionJobId
    ) {
      throw new BadRequestException(
        'Prompt history and idea belong to different collection jobs.',
      );
    }

    /**
     * Unlock prompts must belong to registered users.
     */
    if (
      promptHistory.promptType ===
        PromptType.IDEA_UNLOCK &&
      idea.userId === null
    ) {
      throw new BadRequestException(
        'An idea unlock prompt cannot be attached to a guest-owned idea.',
      );
    }
  }

  /**
   * Builds the Prisma filter used by the administrator history view.
   *
   * Search is applied to the complete rendered prompt.
   *
   * @param query Prompt-history query options.
   */
  private buildWhereClause(
    query: GetPromptHistoryQueryDto,
  ): Prisma.PromptHistoryWhereInput {
    const search = query.search?.trim();

    return {
      ...(buildDateFilter(query) ?? {}),

      ...(query.promptType !== undefined
        ? {
            promptType: query.promptType,
          }
        : {}),

      ...(query.ideaId !== undefined
        ? {
            ideaId: query.ideaId,
          }
        : {}),

      ...(query.collectionJobId !== undefined
        ? {
            collectionJobId:
              query.collectionJobId,
          }
        : {}),

      ...(query.templateHash !== undefined
        ? {
            templateHash:
              query.templateHash.toLowerCase(),
          }
        : {}),

      ...(search
        ? {
            promptText: {
              contains: search,
              mode: 'insensitive',
            },
          }
        : {}),
    };
  }

  /**
   * Normalizes all prompt persistence inputs before validation.
   *
   * Optional blank identifiers and hashes are converted to
   * undefined so Prisma stores database NULL values.
   */
  private normalizeSaveParams(
    params: SavePromptParams,
  ): NormalizedSavePromptParams {
    return {
      userId:
        this.normalizeOptionalString(params.userId),

      guestSessionId:
        this.normalizeOptionalString(
          params.guestSessionId,
        ),

      collectionJobId:
        this.normalizeOptionalString(
          params.collectionJobId,
        ),

      ideaId:
        this.normalizeOptionalString(params.ideaId),

      promptType: params.promptType,

      promptText: params.promptText.trim(),

      templateHash:
        this.normalizeOptionalString(
          params.templateHash,
        )?.toLowerCase(),

      estimatedInputTokens:
        params.estimatedInputTokens ?? undefined,
    };
  }

  /**
   * Normalizes an optional string.
   *
   * Null, undefined, and blank strings become undefined.
   */
  private normalizeOptionalString(
    value: string | null | undefined,
  ): string | undefined {
    if (
      value === null ||
      value === undefined
    ) {
      return undefined;
    }

    const normalizedValue = value.trim();

    return normalizedValue.length > 0
      ? normalizedValue
      : undefined;
  }

  /**
   * Normalizes and validates a required identifier.
   */
  private requireIdentifier(
    value: string,
    fieldName: string,
  ): string {
    const normalizedValue = value.trim();

    if (normalizedValue.length === 0) {
      throw new BadRequestException(
        `${fieldName} is required.`,
      );
    }

    return normalizedValue;
  }
}

/**
 * Internal normalized representation of SavePromptParams.
 */
type NormalizedSavePromptParams = {
  readonly userId?: string;
  readonly guestSessionId?: string;
  readonly collectionJobId?: string;
  readonly ideaId?: string;
  readonly promptType: PromptType;
  readonly promptText: string;
  readonly templateHash?: string;
  readonly estimatedInputTokens?: number;
};
