/**
 * Defines the payload accepted when an authenticated user sends a message
 * to an existing AI chat session.
 *
 * The target session identifier is supplied through the route parameter or
 * WebSocket event payload and is therefore intentionally excluded from this
 * DTO.
 *
 * @author Eman
 */

import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

import {
    AI_CHAT_MAX_MESSAGE_LENGTH,
    AI_CHAT_MIN_MESSAGE_LENGTH,
} from '../constants/ai-chat.constants';

/**
 * Request payload used when sending a new chat message.
 */
export class SendChatMessageDto {
    /**
     * User message delivered to the AI assistant.
     */
    @ApiProperty({
        description: 'User message delivered to the AI assistant.',
        example:
            'Suggest a scalable database architecture for this software idea.',
        minLength: AI_CHAT_MIN_MESSAGE_LENGTH,
        maxLength: AI_CHAT_MAX_MESSAGE_LENGTH,
    })
    @Transform(({ value }: TransformFnParams): unknown => {
        if (typeof value !== 'string') {
            return value;
        }

        const trimmed = value.trim();

        return trimmed;
    })
    @IsString()
    @MinLength(AI_CHAT_MIN_MESSAGE_LENGTH)
    @MaxLength(AI_CHAT_MAX_MESSAGE_LENGTH)
    message!: string;
}