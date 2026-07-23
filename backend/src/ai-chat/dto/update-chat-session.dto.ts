/**
 * Defines the validated request payload used to update an existing AI chat
 * session.
 *
 * Only mutable properties are exposed through this DTO. Immutable fields such
 * as the associated idea, owner, creation time, and identifiers are managed
 * internally by the backend.
 *
 * @author Eman
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

import {
    AI_CHAT_MAX_SESSION_TITLE_LENGTH,
    AI_CHAT_MIN_SESSION_TITLE_LENGTH,
} from '../constants/ai-chat.constants';

/**
 * Request body accepted when updating an existing AI chat session.
 */
export class UpdateChatSessionDto {
    /**
     * Optional replacement title for the chat session.
     */
    @ApiPropertyOptional({
        description:
            'Optional replacement title assigned to the AI chat session.',
        example: 'Updated database architecture discussion',
        minLength: AI_CHAT_MIN_SESSION_TITLE_LENGTH,
        maxLength: AI_CHAT_MAX_SESSION_TITLE_LENGTH,
    })
    @IsOptional()
    @Transform(({ value }: { value: unknown }) => {
        if (typeof value !== 'string') {
            return value;
        }

        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    })
    @IsString()
    @MinLength(AI_CHAT_MIN_SESSION_TITLE_LENGTH)
    @MaxLength(AI_CHAT_MAX_SESSION_TITLE_LENGTH)
    title?: string;
}