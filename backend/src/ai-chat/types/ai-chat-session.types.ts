/**
 * Defines shared AI chat-session result types.
 *
 * @author Eman
 */

import { Prisma } from '@prisma/client';

import { AI_CHAT_SESSION_SELECT } from '../constants/ai-chat-selects.constants';

/**
 * Publicly safe AI chat-session record returned by the application.
 */
export type AiChatSessionRecord = Prisma.ChatSessionGetPayload<{
    select: typeof AI_CHAT_SESSION_SELECT;
}>;

/**
 * Pagination metadata returned with chat-session collections.
 */
export type AiChatSessionsPagination = {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
};

/**
 * Paginated AI chat-session result.
 */
export type PaginatedAiChatSessions = {
    items: AiChatSessionRecord[];
    pagination: AiChatSessionsPagination;
};