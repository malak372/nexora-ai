/**
 * Defines the validated query parameters used to retrieve messages belonging
 * to an AI chat session owned by the authenticated user.
 *
 * The target session identifier is received through the route parameter and is
 * intentionally excluded from this DTO.
 *
 * @author Eman
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
    AI_CHAT_DEFAULT_MESSAGES_PAGE_SIZE,
    AI_CHAT_MAX_MESSAGES_PAGE_SIZE,
} from '../constants/ai-chat.constants';

/**
 * Supported database fields for sorting chat messages.
 *
 * Chat messages are ordered using their creation time to preserve the
 * chronological order of the conversation. The updatedAt field is
 * intentionally excluded because message status transitions can update it.
 */
export const AI_CHAT_MESSAGE_SORT_FIELDS = ['createdAt'] as const;

/**
 * Supported sorting directions for chat messages.
 */
export const AI_CHAT_MESSAGE_SORT_ORDERS = ['asc', 'desc'] as const;

/**
 * Supported chat-message sort field names.
 */
export type AiChatMessageSortField =
    (typeof AI_CHAT_MESSAGE_SORT_FIELDS)[number];

/**
 * Supported chat-message sort directions.
 */
export type AiChatMessageSortOrder =
    (typeof AI_CHAT_MESSAGE_SORT_ORDERS)[number];

/**
 * Query parameters accepted when retrieving messages from one chat session.
 */
export class GetChatMessagesQueryDto {
    /**
     * Page number to retrieve.
     */
    @ApiPropertyOptional({
        description: 'Page number to retrieve.',
        example: 1,
        minimum: 1,
        default: 1,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    /**
     * Maximum number of messages returned per page.
     */
    @ApiPropertyOptional({
        description: 'Maximum number of messages returned per page.',
        example: AI_CHAT_DEFAULT_MESSAGES_PAGE_SIZE,
        minimum: 1,
        maximum: AI_CHAT_MAX_MESSAGES_PAGE_SIZE,
        default: AI_CHAT_DEFAULT_MESSAGES_PAGE_SIZE,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(AI_CHAT_MAX_MESSAGES_PAGE_SIZE)
    limit: number = AI_CHAT_DEFAULT_MESSAGES_PAGE_SIZE;

    /**
     * Field used to sort the returned messages.
     */
    @ApiPropertyOptional({
        description:
            'Field used to sort the returned chat messages chronologically.',
        enum: AI_CHAT_MESSAGE_SORT_FIELDS,
        default: 'createdAt',
    })
    @IsOptional()
    @IsIn(AI_CHAT_MESSAGE_SORT_FIELDS)
    sortBy: AiChatMessageSortField = 'createdAt';

    /**
     * Direction used to sort the returned messages.
     */
    @ApiPropertyOptional({
        description: 'Direction used to sort the returned chat messages.',
        enum: AI_CHAT_MESSAGE_SORT_ORDERS,
        default: 'asc',
    })
    @IsOptional()
    @IsIn(AI_CHAT_MESSAGE_SORT_ORDERS)
    sortOrder: AiChatMessageSortOrder = 'asc';
}