/**
 * Defines callbacks used by the AI chat stream service without coupling it to
 * Socket.IO or any other transport implementation.
 *
 * @author Eman
 */

import type { AiChatMessageRecord } from '../types/ai-chat-message.types';
import type { AiChatStreamChunk } from '../types/chat-stream-chunk.type';

/**
 * Transport callbacks invoked during one AI response lifecycle.
 */
export interface ChatResponseStreamObserver {
  /**
   * Called after the pending AI message enters the streaming state.
   */
  onStarted(message: AiChatMessageRecord): void;

  /**
   * Called for every ordered response fragment.
   */
  onChunk(chunk: AiChatStreamChunk): void;

  /**
   * Called after the final response is persisted successfully.
   */
  onCompleted(message: AiChatMessageRecord): void;

  /**
   * Called after a generation failure is persisted.
   */
  onFailed(message: AiChatMessageRecord): void;
}
