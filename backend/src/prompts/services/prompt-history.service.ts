import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, PromptHistory, PromptType } from '@prisma/client';

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
 * Safe PromptHistory fields supported for administrative sorting.
 *
 * Any unsupported sortBy value must be rejected or replaced
 * by buildOrderBy().
 *
 * @author Malak
 */
const PROMPT_HISTORY_SORT_FIELDS = [
  'createdAt',
  'promptType',
  'estimatedInputTokens',
] as const;

/**
 * Prompt types that represent user-requested AI operations.
 *
 * These operations must belong to exactly one requester:
 * - An authenticated user.
 * - A guest session.
 *
 * Internal system operations such as NLP_ANALYSIS and
 * ABSTRACT_GENERATION may be persisted without a requester.
 *
 * @author Malak
 */
const REQUESTER_REQUIRED_PROMPT_TYPES = new Set<PromptType>([
  PromptType.IDEA_GENERATION,
  PromptType.IDEA_UNLOCK,
  PromptType.CHAT_RESPONSE,
]);

/**
 * Prompt types that require an authenticated registered user.
 *
 * Guest sessions are not permitted to:
 * - Unlock an existing idea.
 * - Access AI chat.
 *
 * @author Malak
 */
const AUTHENTICATED_USER_PROMPT_TYPES = new Set<PromptType>([
  PromptType.IDEA_UNLOCK,
  PromptType.CHAT_RESPONSE,
]);

/**
 * Handles prompt-history persistence and administrative retrieval.
 *
 * Prompt history supports:
 * - AI debugging.
 * - Prompt auditing.
 * - Template-version tracking.
 * - Estimated token and cost analysis.
 * - User and guest-session ownership tracking.
 * - Linking a generated idea after successful AI generation.
 *
 * This service does not:
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
   * Requester rules:
   * - IDEA_GENERATION must belong to exactly one user or guest session.
   * - IDEA_UNLOCK must belong to an authenticated user.
   * - CHAT_RESPONSE must belong to an authenticated user.
   * - Internal operations may be stored without a requester.
   *
   * The relation to Idea is optional because the prompt may be
   * persisted before the generated Idea record exists.
   *
   * @param params Rendered prompt and ownership metadata.
   * @returns The persisted PromptHistory record.
   */
  async savePrompt(params: SavePromptParams): Promise<PromptHistory> {
    this.validateRequester(params);

    return this.prisma.promptHistory.create({
      data: {
        userId: this.normalizeOptionalId(params.userId),

        guestSessionId: this.normalizeOptionalId(params.guestSessionId),

        collectionJobId: this.normalizeOptionalId(params.collectionJobId),

        ideaId: this.normalizeOptionalId(params.ideaId),

        promptType: params.promptType,

        promptText: params.promptText,

        templateHash: params.templateHash?.trim() || undefined,

        estimatedInputTokens: params.estimatedInputTokens ?? undefined,
      },
    });
  }

  /**
   * Associates a saved PromptHistory record with the Idea created
   * from that prompt.
   *
   * This method is used when the generation workflow is:
   *
   * 1. Build prompt.
   * 2. Save PromptHistory.
   * 3. Call AI provider.
   * 4. Create Idea.
   * 5. Attach Idea to PromptHistory.
   *
   * The method prevents:
   * - Linking one prompt history to multiple ideas.
   * - Linking prompts and ideas owned by different users.
   * - Linking prompts and ideas from different guest sessions.
   * - Linking prompts and ideas from different collection jobs.
   *
   * @param promptHistoryId Prompt-history record identifier.
   * @param ideaId Generated idea identifier.
   * @returns The updated PromptHistory record.
   */
  async attachIdea(
    promptHistoryId: string,
    ideaId: string,
  ): Promise<PromptHistory> {
    const [promptHistory, idea] = await Promise.all([
      this.prisma.promptHistory.findUnique({
        where: {
          id: promptHistoryId,
        },
        select: {
          id: true,
          ideaId: true,
          userId: true,
          guestSessionId: true,
          collectionJobId: true,
        },
      }),

      this.prisma.idea.findUnique({
        where: {
          id: ideaId,
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
      throw new NotFoundException('Prompt history record not found.');
    }

    if (!idea) {
      throw new NotFoundException('Idea not found.');
    }

    /**
     * Allows idempotent attachment to the same idea, but prevents
     * changing the relation to a different idea.
     */
    if (promptHistory.ideaId !== null && promptHistory.ideaId !== ideaId) {
      throw new BadRequestException(
        'Prompt history is already associated with another idea.',
      );
    }

    /**
     * Prevents accidentally linking a registered user's prompt
     * to an idea owned by another user.
     */
    if (promptHistory.userId !== null && promptHistory.userId !== idea.userId) {
      throw new BadRequestException(
        'Prompt history and idea belong to different users.',
      );
    }

    /**
     * Prevents accidentally linking a guest prompt to an idea
     * created by another guest session.
     */
    if (
      promptHistory.guestSessionId !== null &&
      promptHistory.guestSessionId !== idea.guestSessionId
    ) {
      throw new BadRequestException(
        'Prompt history and idea belong to different guest sessions.',
      );
    }

    /**
     * The generated idea must originate from the same collection job
     * used to build the original prompt.
     */
    if (
      promptHistory.collectionJobId !== null &&
      promptHistory.collectionJobId !== idea.collectionJobId
    ) {
      throw new BadRequestException(
        'Prompt history and idea belong to different collection jobs.',
      );
    }

    /**
     * Return the existing record when it is already attached
     * to the requested idea.
     */
    if (promptHistory.ideaId === ideaId) {
      return this.prisma.promptHistory.findUniqueOrThrow({
        where: {
          id: promptHistoryId,
        },
      });
    }

    return this.prisma.promptHistory.update({
      where: {
        id: promptHistoryId,
      },
      data: {
        ideaId,
      },
    });
  }

  /**
   * Returns filtered, sorted, and paginated PromptHistory records
   * for the administrative prompt-history view.
   *
   * Included relations:
   * - Requesting user.
   * - Guest-session metadata.
   * - Related idea.
   * - Related collection job.
   *
   * Sensitive guest-session tokens are never selected.
   *
   * @param query Administrative prompt-history filters.
   * @returns Paginated prompt-history records.
   */
  async findAll(
    query: GetPromptHistoryQueryDto,
  ): Promise<PaginatedPromptHistory> {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildWhereClause(query);

    const orderBy = buildOrderBy(
      query,
      PROMPT_HISTORY_SORT_FIELDS,
      'createdAt',
    );

    const [data, total] = await this.prisma.$transaction([
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
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Validates requester ownership before prompt persistence.
   *
   * Rules:
   * - A prompt cannot belong to both a user and guest session.
   * - User-facing operations must have exactly one requester.
   * - Unlock and chat operations require an authenticated user.
   * - Internal operations may be persisted without a requester.
   *
   * @param params Prompt persistence parameters.
   */
  private validateRequester(params: SavePromptParams): void {
    const userId = this.normalizeOptionalId(params.userId);
    const guestSessionId = this.normalizeOptionalId(params.guestSessionId);

    const hasUser = userId !== undefined;
    const hasGuestSession = guestSessionId !== undefined;

    /**
     * A prompt must never belong to both requester types.
     */
    if (hasUser && hasGuestSession) {
      throw new BadRequestException(
        'Prompt history cannot belong to both a user and a guest session.',
      );
    }

    /**
     * User-facing AI operations must belong to exactly one requester.
     */
    if (
      REQUESTER_REQUIRED_PROMPT_TYPES.has(params.promptType) &&
      !hasUser &&
      !hasGuestSession
    ) {
      throw new BadRequestException(
        'Prompt history must belong to a user or a guest session.',
      );
    }

    /**
     * Idea unlock and AI chat are authenticated-user-only operations.
     */
    if (AUTHENTICATED_USER_PROMPT_TYPES.has(params.promptType) && !hasUser) {
      throw new BadRequestException(
        `${params.promptType} prompt history must belong to an authenticated user.`,
      );
    }
  }

  /**
   * Builds the Prisma filter used for prompt-history queries.
   *
   * Search is applied to the rendered prompt text.
   *
   * @param query Administrative filtering parameters.
   * @returns Prisma-compatible PromptHistory filter.
   */
  private buildWhereClause(
    query: GetPromptHistoryQueryDto,
  ): Prisma.PromptHistoryWhereInput {
    const search = query.search?.trim();

    return {
      ...(buildDateFilter(query) ?? {}),

      ...(query.promptType !== undefined && {
        promptType: query.promptType,
      }),

      ...(query.ideaId !== undefined && {
        ideaId: query.ideaId,
      }),

      ...(query.collectionJobId !== undefined && {
        collectionJobId: query.collectionJobId,
      }),

      ...(query.templateHash !== undefined && {
        templateHash: query.templateHash,
      }),

      ...(search && {
        promptText: {
          contains: search,
          mode: 'insensitive',
        },
      }),
    };
  }

  /**
   * Normalizes an optional identifier before Prisma persistence.
   *
   * Null, undefined, and blank strings are converted to undefined.
   * Valid identifiers are trimmed before use.
   *
   * @param value Optional database identifier.
   * @returns Trimmed identifier or undefined.
   */
  private normalizeOptionalId(
    value: string | null | undefined,
  ): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : undefined;
  }
}
