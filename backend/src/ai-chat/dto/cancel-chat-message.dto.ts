/**
 * Defines the payload used to cancel one active AI chat response.
 *
 * @author Eman
 */

import { IsUUID } from 'class-validator';

/**
 * Socket.IO payload used when cancelling an active AI response.
 */
export class CancelChatMessageDto {
    /**
     * Parent chat-session identifier.
     */
    @IsUUID()
    sessionId!: string;

    /**
     * Pending or streaming AI-message identifier.
     */
    @IsUUID()
    messageId!: string;
}