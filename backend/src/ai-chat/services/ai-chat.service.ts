/**
 * Manages AI chat sessions belonging to authenticated users.
 *
 * Responsibilities:
 * - Create chat sessions for accessible unlocked ideas.
 * - Retrieve paginated sessions for one idea.
 * - Retrieve one user-owned session.
 * - Update editable session properties.
 * - Soft-delete user-owned sessions.
 *
 * This service does not generate AI responses or manage chat messages.
 * Those responsibilities belong to the dedicated message and stream services.
 *
 * @author Eman
 */

import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { AI_CHAT_SESSION_SELECT } from '../constants/ai-chat-selects.constants';
import { CreateChatSessionDto } from '../dto/create-chat-session.dto';
import {
    type AiChatSessionSortField,
    type AiChatSortOrder,
    GetChatSessionsQueryDto,
} from '../dto/get-chat-sessions-query.dto';
import { UpdateChatSessionDto } from '../dto/update-chat-session.dto';
import type {
    AiChatSessionRecord,
    PaginatedAiChatSessions,
} from '../types/ai-chat-session.types';
import { AiChatAccessService } from './ai-chat-access.service';

/**
 * Service responsible for the lifecycle of authenticated users' AI chat
 * sessions.
 */
@Injectable()
export class AiChatService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly aiChatAccessService: AiChatAccessService,
    ) { }

    /**
     * Creates a new chat session for an unlocked idea accessible to the
     * authenticated user.
     *
     * @param userId Authenticated user identifier.
     * @param ideaId Target idea identifier.
     * @param dto Chat-session creation payload.
     * @returns Newly created chat session.
     */
    async createSession(
        userId: string,
        ideaId: string,
        dto: CreateChatSessionDto,
    ): Promise<AiChatSessionRecord> {
        await this.aiChatAccessService.ensureIdeaChatAccess(userId, ideaId);

        return this.prisma.chatSession.create({
            data: {
                userId,
                ideaId,
                title: dto.title,
            },
            select: AI_CHAT_SESSION_SELECT,
        });
    }

    /**
     * Retrieves paginated non-deleted chat sessions belonging to the
     * authenticated user for one accessible idea.
     *
     * @param userId Authenticated user identifier.
     * @param ideaId Target idea identifier.
     * @param query Pagination, search, and sorting parameters.
     * @returns Paginated chat-session collection.
     */
    async getSessions(
        userId: string,
        ideaId: string,
        query: GetChatSessionsQueryDto,
    ): Promise<PaginatedAiChatSessions> {
        await this.aiChatAccessService.ensureIdeaChatAccess(userId, ideaId);

        const skip = (query.page - 1) * query.limit;

        const where: Prisma.ChatSessionWhereInput = {
            userId,
            ideaId,
            deletedAt: null,
            ...(query.search
                ? {
                    title: {
                        contains: query.search,
                        mode: Prisma.QueryMode.insensitive,
                    },
                }
                : {}),
        };

        const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

        const [items, totalItems] = await this.prisma.$transaction([
            this.prisma.chatSession.findMany({
                where,
                select: AI_CHAT_SESSION_SELECT,
                orderBy: [
                    orderBy,
                    {
                        id: 'asc',
                    },
                ],
                skip,
                take: query.limit,
            }),
            this.prisma.chatSession.count({
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

    /**
     * Retrieves one non-deleted chat session belonging to the authenticated
     * user.
     *
     * Ownership is included in the database query to prevent disclosure of
     * sessions belonging to other users.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @returns Chat-session details.
     * @throws NotFoundException When the session does not exist, is deleted,
     * or does not belong to the authenticated user.
     */
    async getSessionById(
        userId: string,
        sessionId: string,
    ): Promise<AiChatSessionRecord> {
        const session = await this.prisma.chatSession.findFirst({
            where: {
                id: sessionId,
                userId,
                deletedAt: null,
            },
            select: AI_CHAT_SESSION_SELECT,
        });

        if (!session) {
            throw new NotFoundException('AI chat session was not found.');
        }

        return session;
    }

    /**
     * Updates editable properties of one non-deleted user-owned chat session.
     *
     * The ownership check, update, and result retrieval are performed within
     * one transaction. The conditional update prevents modifying a session
     * that is deleted or belongs to another user.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @param dto Chat-session update payload.
     * @returns Updated chat session.
     * @throws BadRequestException When no editable field is provided.
     * @throws NotFoundException When the session does not exist, is deleted,
     * or does not belong to the authenticated user.
     */
    async updateSession(
        userId: string,
        sessionId: string,
        dto: UpdateChatSessionDto,
    ): Promise<AiChatSessionRecord> {
        if (dto.title === undefined) {
            throw new BadRequestException(
                'At least one chat-session field must be provided.',
            );
        }

        return this.prisma.$transaction(async (transaction) => {
            const updateResult = await transaction.chatSession.updateMany({
                where: {
                    id: sessionId,
                    userId,
                    deletedAt: null,
                },
                data: {
                    title: dto.title,
                },
            });

            if (updateResult.count === 0) {
                throw new NotFoundException('AI chat session was not found.');
            }

            const updatedSession = await transaction.chatSession.findFirst({
                where: {
                    id: sessionId,
                    userId,
                    deletedAt: null,
                },
                select: AI_CHAT_SESSION_SELECT,
            });

            if (!updatedSession) {
                throw new NotFoundException('AI chat session was not found.');
            }

            return updatedSession;
        });
    }

    /**
     * Soft-deletes one non-deleted user-owned chat session.
     *
     * Related messages remain persisted because the chat session itself is not
     * physically removed. All public chat operations must exclude soft-deleted
     * sessions.
     *
     * The ownership and deletion-state conditions are included directly in the
     * update operation to avoid a separate read-before-write race condition.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @throws NotFoundException When the session does not exist, is already
     * deleted, or does not belong to the authenticated user.
     */
    async deleteSession(userId: string, sessionId: string): Promise<void> {
        const deleteResult = await this.prisma.chatSession.updateMany({
            where: {
                id: sessionId,
                userId,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
            },
        });

        if (deleteResult.count === 0) {
            throw new NotFoundException('AI chat session was not found.');
        }
    }

    /**
     * Builds a Prisma-compatible chat-session sorting expression using only
     * validated and explicitly supported fields.
     *
     * @param sortBy Validated chat-session sort field.
     * @param sortOrder Validated sorting direction.
     * @returns Prisma chat-session ordering expression.
     */
    private buildOrderBy(
        sortBy: AiChatSessionSortField,
        sortOrder: AiChatSortOrder,
    ): Prisma.ChatSessionOrderByWithRelationInput {
        const orderByMap: Record<
            AiChatSessionSortField,
            Prisma.ChatSessionOrderByWithRelationInput
        > = {
            createdAt: {
                createdAt: sortOrder,
            },
            updatedAt: {
                updatedAt: sortOrder,
            },
            lastMessageAt: {
                lastMessageAt: sortOrder,
            },
            title: {
                title: sortOrder,
            },
        };

        return orderByMap[sortBy];
    }
}