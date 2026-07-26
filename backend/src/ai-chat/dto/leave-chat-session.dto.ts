/**
 * Defines the payload used to leave one AI chat session room.
 *
 * @author Eman
 */

import { IsUUID } from 'class-validator';

/**
 * Socket.IO payload used when leaving a chat-session room.
 */
export class LeaveChatSessionDto {
  /**
   * Chat-session identifier to leave.
   */
  @IsUUID()
  sessionId!: string;
}
