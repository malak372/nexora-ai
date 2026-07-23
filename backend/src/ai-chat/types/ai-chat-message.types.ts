/**
 * Defines shared AI chat-message types.
 *
 * @author Eman
 */

import { ChatMessageStatus, Prisma } from '@prisma/client';

import { AI_CHAT_MESSAGE_SELECT } from '../constants/ai-chat-message-selects.constants';

/**
 * Publicly safe chat-message record returned by the application.
 */
export type AiChatMessageRecord = Prisma.ChatMessageGetPayload<{
    select: typeof AI_CHAT_MESSAGE_SELECT;
}>;

/**
 * Pagination metadata returned with chat-message collections.
 */
export type AiChatMessagesPagination = {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
};

/**
 * Paginated AI chat-message result.
 */
export type PaginatedAiChatMessages = {
    items: AiChatMessageRecord[];
    pagination: AiChatMessagesPagination;
};

/**
 * Internal command used when marking an AI message as failed.
 */
export type FailAiChatMessageCommand = {
    errorCode: string;
    errorMessage: string;
};

/**
 * Internal result returned when a message state transition succeeds.
 */
export type AiChatMessageTransitionResult = {
    message: AiChatMessageRecord;
    previousStatus: ChatMessageStatus;
};