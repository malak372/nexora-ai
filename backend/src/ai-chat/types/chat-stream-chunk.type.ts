/**
 * Defines one transport-level chunk emitted while presenting an AI response.
 *
 * @author Eman
 */

/**
 * One ordered AI response chunk.
 */
export type AiChatStreamChunk = {
  /**
   * Parent chat-session identifier.
   */
  readonly sessionId: string;

  /**
   * Persisted AI-message identifier.
   */
  readonly messageId: string;

  /**
   * Zero-based chunk index.
   */
  readonly index: number;

  /**
   * Newly emitted response fragment.
   */
  readonly content: string;
};
