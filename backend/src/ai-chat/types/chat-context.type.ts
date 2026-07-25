/**
 * Defines the provider-neutral context prepared for one AI chat response.
 *
 * @author Eman
 */

/**
 * Complete context submitted to the central AI runtime.
 */
export type AiChatContext = {
    /**
     * Authenticated owner of the chat operation.
     */
    readonly userId: string;

    /**
     * Chat session associated with the operation.
     */
    readonly sessionId: string;

    /**
     * Unlocked idea discussed by the session.
     */
    readonly ideaId: string;

    /**
     * System-level behavior and safety instruction.
     */
    readonly systemInstruction: string;

    /**
     * Rendered idea context, recent conversation, and latest user message.
     */
    readonly userPrompt: string;

    /**
     * Approximate number of input tokens used for monitoring and routing.
     */
    readonly estimatedInputTokens: number;
};