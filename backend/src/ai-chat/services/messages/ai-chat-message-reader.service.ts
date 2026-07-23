/**
 * Handles read-only operations for AI chat messages.
 *
 * Responsibilities:
 * - Validate access to the requested chat session.
 * - Retrieve paginated non-deleted chat messages.
 * - Apply deterministic chronological sorting.
 * - Return consistent pagination metadata.
 *
 * This service does not create, update, delete, or transition message states.
 *
 * @author Eman
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { AI_CHAT_MESSAGE_SELECT } from '../../constants/ai-chat-message-selects.constants';
import { GetChatMessagesQueryDto } from '../../dto/get-chat-messages-query.dto';
import type { PaginatedAiChatMessages } from '../../types/ai-chat-message.types';
import { AiChatAccessService } from '../../services/ai-chat-access.service';

/**
 * Service responsible for retrieving AI chat messages.
 */
@Injectable()
export class AiChatMessageReaderService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly aiChatAccessService: AiChatAccessService,
    ) { }

    /**
     * Retrieves paginated non-deleted messages from one accessible chat
     * session.
     *
     * Session ownership and availability are validated before querying its
     * messages.
     *
     * Messages are ordered using their creation timestamp. The message
     * identifier is used as a deterministic secondary sorting key when multiple
     * messages share the same timestamp.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param query Pagination and sorting parameters.
     * @returns Paginated chat-message collection.
     */
    async getMessages(
        userId: string,
        sessionId: string,
        query: GetChatMessagesQueryDto,
    ): Promise<PaginatedAiChatMessages> {
        await this.aiChatAccessService.ensureSessionChatAccess(userId, sessionId);

        const skip = (query.page - 1) * query.limit;

        const where: Prisma.ChatMessageWhereInput = {
            sessionId,
            deletedAt: null,
        };

        const [items, totalItems] = await this.prisma.$transaction([
            this.prisma.chatMessage.findMany({
                where,
                select: AI_CHAT_MESSAGE_SELECT,
                orderBy: [
                    {
                        createdAt: query.sortOrder,
                    },
                    {
                        id: query.sortOrder,
                    },
                ],
                skip,
                take: query.limit,
            }),
            this.prisma.chatMessage.count({
                where,
            }),
        ]);

        const totalPages =
            totalItems === 0 ? 0 : Math.ceil(totalItems / query.limit);

        return {
            items,
            pagination: {
                page: query.page,
                limit: query.limit,
                totalItems,
                totalPages,
                hasNextPage: query.page < totalPages,
                hasPreviousPage: query.page > 1 && totalPages > 0,
            },
        };
    }
}