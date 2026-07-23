/**
 * Defines the validated query parameters used to retrieve AI chat sessions
 * belonging to the authenticated user for a specific unlocked idea.
 *
 * The target idea identifier is received through the route parameter and is
 * intentionally excluded from this DTO.
 *
 * @author Eman
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

import {
    AI_CHAT_DEFAULT_SESSIONS_PAGE_SIZE,
    AI_CHAT_MAX_SESSIONS_PAGE_SIZE,
    AI_CHAT_MAX_SESSION_TITLE_LENGTH,
} from '../constants/ai-chat.constants';

/**
 * Supported database fields for sorting chat sessions.
 */
export const AI_CHAT_SESSION_SORT_FIELDS = [
    'createdAt',
    'updatedAt',
    'lastMessageAt',
    'title',
] as const;

/**
 * Supported sorting directions.
 */
export const AI_CHAT_SORT_ORDERS = ['asc', 'desc'] as const;

export type AiChatSessionSortField =
    (typeof AI_CHAT_SESSION_SORT_FIELDS)[number];

export type AiChatSortOrder = (typeof AI_CHAT_SORT_ORDERS)[number];

/**
 * Query parameters accepted when listing AI chat sessions for one idea.
 */
export class GetChatSessionsQueryDto {
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
     * Maximum number of sessions returned per page.
     */
    @ApiPropertyOptional({
        description: 'Maximum number of sessions returned per page.',
        example: AI_CHAT_DEFAULT_SESSIONS_PAGE_SIZE,
        minimum: 1,
        maximum: AI_CHAT_MAX_SESSIONS_PAGE_SIZE,
        default: AI_CHAT_DEFAULT_SESSIONS_PAGE_SIZE,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(AI_CHAT_MAX_SESSIONS_PAGE_SIZE)
    limit: number = AI_CHAT_DEFAULT_SESSIONS_PAGE_SIZE;

    /**
     * Optional case-insensitive search value applied to session titles.
     */
    @ApiPropertyOptional({
        description:
            'Optional case-insensitive search value applied to session titles.',
        example: 'database',
        maxLength: AI_CHAT_MAX_SESSION_TITLE_LENGTH,
    })
    @IsOptional()
    @IsString()
    @MaxLength(AI_CHAT_MAX_SESSION_TITLE_LENGTH)
    search?: string;

    /**
     * Field used to sort the returned chat sessions.
     */
    @ApiPropertyOptional({
        description: 'Field used to sort the returned chat sessions.',
        enum: AI_CHAT_SESSION_SORT_FIELDS,
        default: 'lastMessageAt',
    })
    @IsOptional()
    @IsIn(AI_CHAT_SESSION_SORT_FIELDS)
    sortBy: AiChatSessionSortField = 'lastMessageAt';

    /**
     * Direction used to sort the returned chat sessions.
     */
    @ApiPropertyOptional({
        description: 'Direction used to sort the returned chat sessions.',
        enum: AI_CHAT_SORT_ORDERS,
        default: 'desc',
    })
    @IsOptional()
    @IsIn(AI_CHAT_SORT_ORDERS)
    sortOrder: AiChatSortOrder = 'desc';
}