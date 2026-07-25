/**
 * Defines the Socket.IO payload accepted when an authenticated user sends a
 * message to an existing AI chat session.
 *
 * @author Eman
 */

import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import {
  AI_CHAT_MAX_MESSAGE_LENGTH,
  AI_CHAT_MIN_MESSAGE_LENGTH,
} from '../constants/ai-chat.constants';

/**
 * WebSocket payload used when sending one message to an AI chat session.
 */
export class SendChatMessageDto {
  /**
   * Target chat-session identifier.
   */
  @ApiProperty({
    description: 'Target AI chat-session identifier.',
    format: 'uuid',
  })
  @IsUUID()
  sessionId!: string;

  /**
   * Client-generated identifier used to make message submission idempotent.
   *
   * The frontend must reuse the same identifier when retrying the same
   * message after a timeout or connection interruption.
   */
  @ApiProperty({
    description:
      'Client-generated UUID used to prevent duplicate message submissions.',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  clientRequestId!: string;

  /**
   * User message delivered to the AI assistant.
   */
  @ApiProperty({
    description: 'User message delivered to the AI assistant.',
    example: 'Suggest a scalable database architecture for this software idea.',
    minLength: AI_CHAT_MIN_MESSAGE_LENGTH,
    maxLength: AI_CHAT_MAX_MESSAGE_LENGTH,
  })
  @Transform(({ value }: TransformFnParams): unknown => {
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @MinLength(AI_CHAT_MIN_MESSAGE_LENGTH)
  @MaxLength(AI_CHAT_MAX_MESSAGE_LENGTH)
  message!: string;
}