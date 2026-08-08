/**
 * Manages write operations and state transitions for AI chat messages.
 *
 * Responsibilities:
 * - Persist user messages and pending AI responses atomically.
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
import { ChatMessageStatus, ChatSender, Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import {
  AI_CHAT_ERROR_CODES,
  AI_CHAT_RESPONSE_TIMEOUT_MS,
} from '../../constants/ai-chat.constants';
import { AI_CHAT_MESSAGE_SELECT } from '../../constants/ai-chat-message-selects.constants';
import type {
  AiChatConversationTurn,
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
   * Creates one complete conversation turn atomically.
   *
   * The user message and pending AI response are written in one transaction
   * so the conversation cannot contain an accepted user message without its
   * corresponding AI placeholder.
   *
   * A PostgreSQL transaction-level advisory lock serializes concurrent
   * submissions for the same session across application instances.
   *
   * @param userId Authenticated user identifier.
   * @param sessionId Chat-session identifier.
   * @param clientRequestId Client-generated idempotency identifier.
   * @param message Validated and normalized user message.
   * @returns Persisted user message and pending AI response.
   */
  async createConversationTurn(
    userId: string,
    sessionId: string,
    clientRequestId: string,
    message: string,
  ): Promise<AiChatConversationTurn> {
    await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

    const normalizedMessage = message.trim();

    if (!normalizedMessage) {
      throw new BadRequestException('The user message cannot be empty.');
    }

    const activityAt = new Date();

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${sessionId}, 0)
          )
        `;

        const staleBefore = new Date(
          Date.now() - AI_CHAT_RESPONSE_TIMEOUT_MS * 2,
        );

        await transaction.chatMessage.updateMany({
          where: {
            sessionId,
            sender: ChatSender.AI,
            status: {
              in: ACTIVE_AI_MESSAGE_STATUSES,
            },
            deletedAt: null,
            updatedAt: {
              lt: staleBefore,
            },
          },
          data: {
            status: ChatMessageStatus.FAILED,
            errorCode: AI_CHAT_ERROR_CODES.MESSAGE_GENERATION_TIMEOUT,
            errorMessage: 'The previous AI response expired before completion.',
            completedAt: activityAt,
          },
        });

        const existingRequest = await transaction.chatMessage.findFirst({
          where: {
            sessionId,
            sender: ChatSender.USER,
            clientRequestId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (existingRequest) {
          throw new ConflictException(
            'This chat message request has already been submitted.',
          );
        }

        const activeResponse = await transaction.chatMessage.findFirst({
          where: {
            sessionId,
            sender: ChatSender.AI,
            status: {
              in: ACTIVE_AI_MESSAGE_STATUSES,
            },
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (activeResponse) {
          throw new ConflictException(
            'An AI response is already being generated for this chat session.',
          );
        }

        const userMessage = await transaction.chatMessage.create({
          data: {
            sessionId,
            sender: ChatSender.USER,
            status: ChatMessageStatus.COMPLETED,
            clientRequestId,
            message: normalizedMessage,
            completedAt: activityAt,
          },
          select: AI_CHAT_MESSAGE_SELECT,
        });

        const aiMessage = await transaction.chatMessage.create({
          data: {
            sessionId,
            sender: ChatSender.AI,
            status: ChatMessageStatus.PENDING,
            message: 'Generating response…',
          },
          select: AI_CHAT_MESSAGE_SELECT,
        });

        await this.updateSessionActivityOrThrow(
          transaction,
          userId,
          sessionId,
          activityAt,
        );

        return {
          userMessage,
          aiMessage,
        };
      }, {
        /*
         * Prisma interactive transactions default to 5 seconds. This chat turn
         * performs an advisory lock, cleanup/idempotency checks, two inserts,
         * and a session activity update against a remote PostgreSQL database.
         * A brief network spike can therefore exceed 5s even though no AI call
         * occurs inside the transaction.
         *
         * 15s is bounded but prevents valid turns from being rolled back merely
         * because the final DB query lands just after the default deadline.
         */
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This chat message request has already been submitted.',
        );
      }

      throw error;
    }
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

      return this.getMessageOrThrow(sessionId, messageId, transaction);
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

      return this.getMessageOrThrow(sessionId, messageId, transaction);
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

      return this.getMessageOrThrow(sessionId, messageId, transaction);
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