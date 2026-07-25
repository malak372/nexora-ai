/**
 * Defines the payload used to join one authenticated AI chat session room.
 *
 * @author Eman
 */

import { IsUUID } from 'class-validator';

/**
 * Socket.IO payload used when joining a chat-session room.
 */
export class JoinChatSessionDto {
    /**
     * Chat-session identifier to join.
     */
    @IsUUID()
    sessionId!: string;
}