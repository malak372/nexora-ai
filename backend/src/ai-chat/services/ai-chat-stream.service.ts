/**
 * Orchestrates one complete AI chat response lifecycle.
 *
 * Responsibilities:
 * - Persist one user/AI conversation turn atomically.
 * - Build bounded project context.
 * - Execute the central AI runtime.
 * - Emit transport-neutral stream callbacks.
 * - Persist completed, failed, timed-out, and cancelled states.
 * - Prevent overlapping responses in one session.
 *
 * Provider adapters currently return a completed response. The service emits
 * bounded presentation chunks after generation so the transport contract is
 * already compatible with future native provider streaming.
 *
 * @author Eman
 */

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ApiRequestType, PromptType } from '@prisma/client';

import { AiProviderErrorCode } from '../../ai/errors/ai-provider-error-code.enum';
import { AiProviderError } from '../../ai/errors/ai-provider.error';
import { AiExecutionService } from '../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../ai/types/ai-provider.type';
import {
    AI_CHAT_ERROR_CODES,
    AI_CHAT_MAX_OUTPUT_TOKENS,
    AI_CHAT_RESPONSE_TEMPERATURE,
    AI_CHAT_RESPONSE_TIMEOUT_MS,
    AI_CHAT_STREAM_CHUNK_DELAY_MS,
    AI_CHAT_STREAM_CHUNK_SIZE,
} from '../constants/ai-chat.constants';
import type { ChatResponseStreamObserver } from '../interfaces/chat-response-stream.interface';
import type {
    AiChatConversationTurn,
    AiChatMessageRecord,
} from '../types/ai-chat-message.types';
import { AiChatAccessService } from './ai-chat-access.service';
import { AiChatContextService } from './ai-chat-context.service';
import { AiChatMessageWriterService } from './messages/ai-chat-message-writer.service';

/**
 * Reason for terminating one local active response.
 */
type AiChatTerminationReason = 'USER_CANCELLED' | 'TIMEOUT' | null;

/**
 * In-memory execution state for one active AI message.
 */
type ActiveAiChatResponse = {
    readonly userId: string;
    readonly sessionId: string;
    readonly messageId: string;
    readonly controller: AbortController;
    terminationReason: AiChatTerminationReason;
};

/**
 * Input accepted when starting one AI response.
 */
type StartAiChatResponseInput = {
    readonly userId: string;
    readonly sessionId: string;
    readonly clientRequestId: string;
    readonly message: string;
    readonly observer: ChatResponseStreamObserver;
};

/**
 * Service responsible for AI chat response orchestration.
 */
@Injectable()
export class AiChatStreamService {
    private readonly logger = new Logger(AiChatStreamService.name);

    /**
     * Active responses indexed by persisted AI-message identifier.
     */
    private readonly activeResponses = new Map<string, ActiveAiChatResponse>();

    /**
     * Active AI-message identifier indexed by chat-session identifier.
     */
    private readonly activeSessionMessages = new Map<string, string>();

    constructor(
        private readonly aiExecutionService: AiExecutionService,
        private readonly aiChatAccessService: AiChatAccessService,
        private readonly aiChatContextService: AiChatContextService,
        private readonly messageWriterService: AiChatMessageWriterService,
    ) { }

    /**
     * Persists and starts one AI response without blocking the Socket.IO
     * acknowledgement until generation completes.
     */
    async startResponse(
        input: StartAiChatResponseInput,
    ): Promise<AiChatConversationTurn> {
        if (this.activeSessionMessages.has(input.sessionId)) {
            throw new ConflictException(
                'An AI response is already being generated for this chat session.',
            );
        }

        const turn = await this.messageWriterService.createConversationTurn(
            input.userId,
            input.sessionId,
            input.clientRequestId,
            input.message,
        );

        const activeResponse: ActiveAiChatResponse = {
            userId: input.userId,
            sessionId: input.sessionId,
            messageId: turn.aiMessage.id,
            controller: new AbortController(),
            terminationReason: null,
        };

        this.activeResponses.set(turn.aiMessage.id, activeResponse);
        this.activeSessionMessages.set(input.sessionId, turn.aiMessage.id);

        void this.executeResponse(turn, activeResponse, input.observer).catch(
            (error: unknown) => {
                this.logger.error(
                    'Unhandled AI chat response orchestration failure.',
                    error instanceof Error ? error.stack : undefined,
                );
            },
        );

        return turn;
    }

    /**
     * Cancels one pending or streaming AI response.
     */
    async cancelResponse(
        userId: string,
        sessionId: string,
        messageId: string,
    ): Promise<AiChatMessageRecord> {
        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        const activeResponse = this.activeResponses.get(messageId);

        if (
            activeResponse &&
            (activeResponse.userId !== userId ||
                activeResponse.sessionId !== sessionId)
        ) {
            throw new ConflictException(
                'The active AI response does not belong to this chat session.',
            );
        }

        const cancelledMessage =
            await this.messageWriterService.cancelAiMessage(
                userId,
                sessionId,
                messageId,
            );

        if (activeResponse) {
            activeResponse.terminationReason = 'USER_CANCELLED';
            activeResponse.controller.abort();
        }

        return cancelledMessage;
    }

    /**
     * Executes, streams, and persists the AI response.
     */
    private async executeResponse(
        turn: AiChatConversationTurn,
        activeResponse: ActiveAiChatResponse,
        observer: ChatResponseStreamObserver,
    ): Promise<void> {
        const timeoutHandle = setTimeout(() => {
            activeResponse.terminationReason = 'TIMEOUT';
            activeResponse.controller.abort();
        }, AI_CHAT_RESPONSE_TIMEOUT_MS);

        try {
            const context = await this.aiChatContextService.buildContext(
                activeResponse.userId,
                activeResponse.sessionId,
                turn.userMessage.id,
                turn.userMessage.message,
            );

            if (activeResponse.controller.signal.aborted) {
                await this.handleAbortedResponse(activeResponse, observer);
                return;
            }

            const streamingMessage =
                await this.messageWriterService.markAiMessageStreaming(
                    activeResponse.userId,
                    activeResponse.sessionId,
                    activeResponse.messageId,
                );

            observer.onStarted(streamingMessage);

            const result = await this.aiExecutionService.execute({
                userPrompt: context.userPrompt,
                systemInstruction: context.systemInstruction,
                requestType: ApiRequestType.AI_CHAT,
                promptType: PromptType.CHAT_RESPONSE,
                userId: context.userId,
                ideaId: context.ideaId,
                maxOutputTokens: AI_CHAT_MAX_OUTPUT_TOKENS,
                estimatedOutputTokens: AI_CHAT_MAX_OUTPUT_TOKENS,
                temperature: AI_CHAT_RESPONSE_TEMPERATURE,
                responseFormat: AiResponseFormat.TEXT,
            });

            if (activeResponse.controller.signal.aborted) {
                await this.handleAbortedResponse(activeResponse, observer);
                return;
            }

            await this.emitResponseChunks(activeResponse, result.text, observer);

            if (activeResponse.controller.signal.aborted) {
                await this.handleAbortedResponse(activeResponse, observer);
                return;
            }

            const completedMessage =
                await this.messageWriterService.completeAiMessage(
                    activeResponse.userId,
                    activeResponse.sessionId,
                    activeResponse.messageId,
                    result.text,
                );

            observer.onCompleted(completedMessage);
        } catch (error: unknown) {
            if (activeResponse.controller.signal.aborted) {
                await this.handleAbortedResponse(activeResponse, observer);
                return;
            }

            await this.handleGenerationFailure(activeResponse, error, observer);
        } finally {
            clearTimeout(timeoutHandle);
            this.releaseActiveResponse(activeResponse);
        }
    }

    /**
     * Handles explicit cancellation or the total response timeout.
     */
    private async handleAbortedResponse(
        activeResponse: ActiveAiChatResponse,
        observer: ChatResponseStreamObserver,
    ): Promise<void> {
        if (activeResponse.terminationReason === 'USER_CANCELLED') {
            return;
        }

        if (activeResponse.terminationReason !== 'TIMEOUT') {
            return;
        }

        try {
            const failedMessage = await this.messageWriterService.failAiMessage(
                activeResponse.userId,
                activeResponse.sessionId,
                activeResponse.messageId,
                {
                    errorCode: AI_CHAT_ERROR_CODES.MESSAGE_GENERATION_TIMEOUT,
                    errorMessage:
                        'The AI response exceeded the maximum allowed duration.',
                },
            );

            observer.onFailed(failedMessage);
        } catch (error: unknown) {
            this.logger.warn(
                `Could not persist timeout state for AI chat message ${activeResponse.messageId}: ${this.safeErrorMessage(error)}`,
            );
        }
    }

    /**
     * Persists a safe failure state for provider and internal errors.
     */
    private async handleGenerationFailure(
        activeResponse: ActiveAiChatResponse,
        error: unknown,
        observer: ChatResponseStreamObserver,
    ): Promise<void> {
        const isProviderTimeout =
            error instanceof AiProviderError &&
            error.code === AiProviderErrorCode.TIMEOUT;

        const errorCode = isProviderTimeout
            ? AI_CHAT_ERROR_CODES.MESSAGE_GENERATION_TIMEOUT
            : AI_CHAT_ERROR_CODES.MESSAGE_GENERATION_FAILED;

        const errorMessage = isProviderTimeout
            ? 'The AI provider did not complete the response in time.'
            : 'The AI response could not be generated. Please try again.';

        this.logger.error(
            `AI chat generation failed for message ${activeResponse.messageId}: ${this.safeErrorMessage(error)}`,
            error instanceof Error ? error.stack : undefined,
        );

        try {
            const failedMessage = await this.messageWriterService.failAiMessage(
                activeResponse.userId,
                activeResponse.sessionId,
                activeResponse.messageId,
                {
                    errorCode,
                    errorMessage,
                },
            );

            observer.onFailed(failedMessage);
        } catch (persistenceError: unknown) {
            this.logger.error(
                `Could not persist failure state for AI chat message ${activeResponse.messageId}: ${this.safeErrorMessage(persistenceError)}`,
                persistenceError instanceof Error
                    ? persistenceError.stack
                    : undefined,
            );
        }
    }

    /**
     * Emits the completed provider response as ordered transport chunks.
     */
    private async emitResponseChunks(
        activeResponse: ActiveAiChatResponse,
        response: string,
        observer: ChatResponseStreamObserver,
    ): Promise<void> {
        const chunks = this.splitIntoChunks(response.trim());

        for (let index = 0; index < chunks.length; index += 1) {
            if (activeResponse.controller.signal.aborted) {
                return;
            }

            observer.onChunk({
                sessionId: activeResponse.sessionId,
                messageId: activeResponse.messageId,
                index,
                content: chunks[index],
            });

            await this.delay(
                AI_CHAT_STREAM_CHUNK_DELAY_MS,
                activeResponse.controller.signal,
            );
        }
    }

    /**
     * Splits text near whitespace boundaries without losing characters.
     */
    private splitIntoChunks(value: string): string[] {
        if (!value) {
            return [];
        }

        const chunks: string[] = [];
        let cursor = 0;

        while (cursor < value.length) {
            const maximumEnd = Math.min(
                cursor + AI_CHAT_STREAM_CHUNK_SIZE,
                value.length,
            );

            let end = maximumEnd;

            if (maximumEnd < value.length) {
                const candidate = value.lastIndexOf(' ', maximumEnd);

                if (candidate > cursor) {
                    end = candidate + 1;
                }
            }

            chunks.push(value.slice(cursor, end));
            cursor = end;
        }

        return chunks;
    }

    /**
     * Delays chunk presentation while remaining cancellation-aware.
     */
    private delay(milliseconds: number, signal: AbortSignal): Promise<void> {
        if (signal.aborted || milliseconds <= 0) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            let timeoutHandle: ReturnType<typeof setTimeout>;

            const handleAbort = () => {
                clearTimeout(timeoutHandle);
                resolve();
            };

            timeoutHandle = setTimeout(() => {
                signal.removeEventListener('abort', handleAbort);
                resolve();
            }, milliseconds);

            signal.addEventListener('abort', handleAbort, {
                once: true,
            });
        });
    }

    /**
     * Releases local execution state without deleting another newer response.
     */
    private releaseActiveResponse(activeResponse: ActiveAiChatResponse): void {
        if (
            this.activeResponses.get(activeResponse.messageId) === activeResponse
        ) {
            this.activeResponses.delete(activeResponse.messageId);
        }

        if (
            this.activeSessionMessages.get(activeResponse.sessionId) ===
            activeResponse.messageId
        ) {
            this.activeSessionMessages.delete(activeResponse.sessionId);
        }
    }

    /**
     * Extracts a safe log-only error message.
     */
    private safeErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : 'Unknown error';
    }
}