/**
 * Defines the validated request payload used to create a new AI chat session
 * for an unlocked project idea.
 *
 * The target idea identifier is received through the route parameter and is
 * intentionally excluded from this DTO to preserve a single authoritative
 * source for the selected idea.
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
 * Request body accepted when creating a new AI chat session.
 */
export class CreateChatSessionDto {
    /**
     * Optional title used to identify and organize the chat session.
     *
     * When omitted, the chat service assigns the configured default session
     * title.
     */
    @ApiPropertyOptional({
        description:
            'Optional title used to identify and organize the AI chat session.',
        example: 'Database design discussion',
        minLength: AI_CHAT_MIN_SESSION_TITLE_LENGTH,
        maxLength: AI_CHAT_MAX_SESSION_TITLE_LENGTH,
    })
    @IsOptional()
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @MinLength(AI_CHAT_MIN_SESSION_TITLE_LENGTH)
    @MaxLength(AI_CHAT_MAX_SESSION_TITLE_LENGTH)
    title?: string;
}