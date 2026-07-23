/**
 * Manages write operations and state transitions for AI chat messages.
 *
 * Responsibilities:
 * - Persist authenticated-user messages.
 * - Create pending AI response records.
 * - Transition AI messages into the streaming state.
 * - Complete AI responses.
 * - Persist AI generation failures.
 * - Cancel active AI responses.
 * - Keep chat-session activity timestamps synchronized.
 * - Prevent invalid or duplicate message state transitions.
 *
 * This service does not retrieve paginated message history, call AI providers,
 * or emit WebSocket events.
 *
 * @author Eman
 */

import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    ChatMessageStatus,
    ChatSender,
    Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { AI_CHAT_MESSAGE_SELECT } from '../../constants/ai-chat-message-selects.constants';
import type {
    AiChatMessageRecord,
    FailAiChatMessageCommand,
} from '../../types/ai-chat-message.types';
import { AiChatAccessService } from '../../services/ai-chat-access.service';

/**
 * Message states from which an active AI response may transition into a
 * terminal state.
 */
const ACTIVE_AI_MESSAGE_STATUSES: ChatMessageStatus[] = [
    ChatMessageStatus.PENDING,
    ChatMessageStatus.STREAMING,
];

/**
 * Service responsible for persisting and transitioning AI chat messages.
 */
@Injectable()
export class AiChatMessageWriterService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly aiChatAccessService: AiChatAccessService,
    ) { }

    /**
     * Persists a message submitted by the authenticated user.
     *
     * User messages are immediately completed because they do not require
     * asynchronous processing.
     *
     * Message creation and parent-session activity updates are performed in one
     * transaction.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param message Validated and normalized user message.
     * @returns Persisted user message.
     */
    async createUserMessage(
        userId: string,
        sessionId: string,
        message: string,
    ): Promise<AiChatMessageRecord> {
        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        const completedAt = new Date();

        return this.prisma.$transaction(async (transaction) => {
            const createdMessage = await transaction.chatMessage.create({
                data: {
                    sessionId,
                    sender: ChatSender.USER,
                    status: ChatMessageStatus.COMPLETED,
                    message,
                    completedAt,
                },
                select: AI_CHAT_MESSAGE_SELECT,
            });

            await this.updateSessionActivityOrThrow(
                transaction,
                userId,
                sessionId,
                completedAt,
            );

            return createdMessage;
        });
    }

    /**
     * Creates an empty pending AI message before response generation begins.
     *
     * The pending record provides a stable message identifier that can be used
     * for streaming, cancellation, failure reporting, and client-side
     * reconciliation.
     *
     * Concurrent AI response prevention belongs to the dedicated orchestration
     * or locking service.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @returns Newly created pending AI message.
     */
    async createPendingAiMessage(
        userId: string,
        sessionId: string,
    ): Promise<AiChatMessageRecord> {
        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        return this.prisma.chatMessage.create({
            data: {
                sessionId,
                sender: ChatSender.AI,
                status: ChatMessageStatus.PENDING,
                message: '',
            },
            select: AI_CHAT_MESSAGE_SELECT,
        });
    }

    /**
     * Transitions one pending AI message into the streaming state.
     *
     * The conditional update enforces the PENDING -> STREAMING transition and
     * prevents duplicate workers from starting the same AI response.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param messageId AI message identifier.
     * @returns Updated streaming AI message.
     */
    async markAiMessageStreaming(
        userId: string,
        sessionId: string,
        messageId: string,
    ): Promise<AiChatMessageRecord> {
        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        const updateResult = await this.prisma.chatMessage.updateMany({
            where: {
                id: messageId,
                sessionId,
                sender: ChatSender.AI,
                status: ChatMessageStatus.PENDING,
                deletedAt: null,
            },
            data: {
                status: ChatMessageStatus.STREAMING,
                errorCode: null,
                errorMessage: null,
                completedAt: null,
            },
        });

        if (updateResult.count === 0) {
            await this.throwMessageTransitionError(sessionId, messageId);
        }

        return this.getMessageOrThrow(sessionId, messageId);
    }

    /**
     * Completes one pending or streaming AI message using the final generated
     * response.
     *
     * The final response should be persisted once after streaming finishes.
     * Individual streamed chunks should remain in the transport layer and
     * should not trigger database writes.
     *
     * The message transition and parent-session activity update are performed
     * atomically.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param messageId AI message identifier.
     * @param response Final normalized AI response.
     * @returns Completed AI message.
     * @throws BadRequestException When the final response is empty.
     */
    async completeAiMessage(
        userId: string,
        sessionId: string,
        messageId: string,
        response: string,
    ): Promise<AiChatMessageRecord> {
        const normalizedResponse = response.trim();

        if (!normalizedResponse) {
            throw new BadRequestException(
                'The completed AI response cannot be empty.',
            );
        }

        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        const completedAt = new Date();

        return this.prisma.$transaction(async (transaction) => {
            const updateResult = await transaction.chatMessage.updateMany({
                where: {
                    id: messageId,
                    sessionId,
                    sender: ChatSender.AI,
                    status: {
                        in: ACTIVE_AI_MESSAGE_STATUSES,
                    },
                    deletedAt: null,
                },
                data: {
                    message: normalizedResponse,
                    status: ChatMessageStatus.COMPLETED,
                    errorCode: null,
                    errorMessage: null,
                    completedAt,
                },
            });

            if (updateResult.count === 0) {
                await this.throwMessageTransitionError(
                    sessionId,
                    messageId,
                    transaction,
                );
            }

            await this.updateSessionActivityOrThrow(
                transaction,
                userId,
                sessionId,
                completedAt,
            );

            return this.getMessageOrThrow(
                sessionId,
                messageId,
                transaction,
            );
        });
    }

    /**
     * Marks one pending or streaming AI message as failed.
     *
     * Failure metadata is persisted to support observability, client error
     * handling, and retry decisions.
     *
     * The partially streamed response is not persisted by this method.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param messageId AI message identifier.
     * @param command Normalized failure information.
     * @returns Failed AI message.
     */
    async failAiMessage(
        userId: string,
        sessionId: string,
        messageId: string,
        command: FailAiChatMessageCommand,
    ): Promise<AiChatMessageRecord> {
        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        const completedAt = new Date();

        return this.prisma.$transaction(async (transaction) => {
            const updateResult = await transaction.chatMessage.updateMany({
                where: {
                    id: messageId,
                    sessionId,
                    sender: ChatSender.AI,
                    status: {
                        in: ACTIVE_AI_MESSAGE_STATUSES,
                    },
                    deletedAt: null,
                },
                data: {
                    status: ChatMessageStatus.FAILED,
                    errorCode: command.errorCode,
                    errorMessage: command.errorMessage,
                    completedAt,
                },
            });

            if (updateResult.count === 0) {
                await this.throwMessageTransitionError(
                    sessionId,
                    messageId,
                    transaction,
                );
            }

            await this.updateSessionActivityOrThrow(
                transaction,
                userId,
                sessionId,
                completedAt,
            );

            return this.getMessageOrThrow(
                sessionId,
                messageId,
                transaction,
            );
        });
    }

    /**
     * Cancels one pending or streaming AI message.
     *
     * Completed, failed, and already-cancelled messages cannot transition into
     * the cancelled state.
     *
     * The message transition and parent-session activity update are performed
     * atomically.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param messageId AI message identifier.
     * @returns Cancelled AI message.
     */
    async cancelAiMessage(
        userId: string,
        sessionId: string,
        messageId: string,
    ): Promise<AiChatMessageRecord> {
        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        const completedAt = new Date();

        return this.prisma.$transaction(async (transaction) => {
            const updateResult = await transaction.chatMessage.updateMany({
                where: {
                    id: messageId,
                    sessionId,
                    sender: ChatSender.AI,
                    status: {
                        in: ACTIVE_AI_MESSAGE_STATUSES,
                    },
                    deletedAt: null,
                },
                data: {
                    status: ChatMessageStatus.CANCELLED,
                    errorCode: null,
                    errorMessage: null,
                    completedAt,
                },
            });

            if (updateResult.count === 0) {
                await this.throwMessageTransitionError(
                    sessionId,
                    messageId,
                    transaction,
                );
            }

            await this.updateSessionActivityOrThrow(
                transaction,
                userId,
                sessionId,
                completedAt,
            );

            return this.getMessageOrThrow(
                sessionId,
                messageId,
                transaction,
            );
        });
    }

    /**
     * Retrieves one non-deleted message from a specific chat session.
     *
     * Public writer operations validate session ownership before calling this
     * helper.
     *
     * @param sessionId Chat-session identifier.
     * @param messageId Chat-message identifier.
     * @param client Prisma service or active transaction client.
     * @returns Selected chat-message record.
     * @throws NotFoundException When the message does not exist.
     */
    private async getMessageOrThrow(
        sessionId: string,
        messageId: string,
        client: PrismaService | Prisma.TransactionClient = this.prisma,
    ): Promise<AiChatMessageRecord> {
        const message = await client.chatMessage.findFirst({
            where: {
                id: messageId,
                sessionId,
                deletedAt: null,
            },
            select: AI_CHAT_MESSAGE_SELECT,
        });

        if (!message) {
            throw new NotFoundException('AI chat message was not found.');
        }

        return message;
    }

    /**
     * Updates the parent chat session's activity timestamp.
     *
     * Ownership and deletion-state checks are applied directly in the update to
     * prevent updating inaccessible or concurrently deleted sessions.
     *
     * @param transaction Active Prisma transaction client.
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param activityAt New activity timestamp.
     * @throws NotFoundException When the session is inaccessible or deleted.
     */
    private async updateSessionActivityOrThrow(
        transaction: Prisma.TransactionClient,
        userId: string,
        sessionId: string,
        activityAt: Date,
    ): Promise<void> {
        const updateResult = await transaction.chatSession.updateMany({
            where: {
                id: sessionId,
                userId,
                deletedAt: null,
            },
            data: {
                lastMessageAt: activityAt,
            },
        });

        if (updateResult.count === 0) {
            throw new NotFoundException('AI chat session was not found.');
        }
    }

    /**
     * Distinguishes between a missing message and an invalid state transition.
     *
     * Unknown or deleted messages produce NotFoundException. Existing messages
     * whose current state does not allow the requested operation produce
     * ConflictException.
     *
     * @param sessionId Chat-session identifier.
     * @param messageId Chat-message identifier.
     * @param client Prisma service or active transaction client.
     * @throws NotFoundException When the message does not exist.
     * @throws ConflictException When the current message state is incompatible
     * with the requested transition.
     */
    private async throwMessageTransitionError(
        sessionId: string,
        messageId: string,
        client: PrismaService | Prisma.TransactionClient = this.prisma,
    ): Promise<never> {
        const message = await client.chatMessage.findFirst({
            where: {
                id: messageId,
                sessionId,
                sender: ChatSender.AI,
                deletedAt: null,
            },
            select: {
                status: true,
            },
        });

        if (!message) {
            throw new NotFoundException('AI chat message was not found.');
        }

        throw new ConflictException(
            `AI chat message cannot transition from ${message.status}.`,
        );
    }
}