/**
 * Centralizes authorization and access validation for the AI Chat module.
 *
 * Responsibilities:
 * - Verify that an idea exists and belongs to the authenticated user.
 * - Verify that an idea is not soft-deleted.
 * - Verify that AI Chat is available for the idea.
 * - Verify that a chat session exists and belongs to the authenticated user.
 * - Verify that a chat session and its related idea are not soft-deleted.
 *
 * This service does not create, update, or delete chat data.
 * It only validates access and returns the minimum required records.
 *
 * @author Eman
 */

import {
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import {
    AI_CHAT_IDEA_ACCESS_SELECT,
    AI_CHAT_SESSION_ACCESS_SELECT,
} from '../constants/ai-chat-access-selects.constants';
import type {
    AiChatIdeaAccessRecord,
    AiChatSessionAccessRecord,
} from '../types/ai-chat-access.types';

/**
 * Service responsible for AI Chat authorization and resource-access checks.
 */
@Injectable()
export class AiChatAccessService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Ensures that the authenticated user may use AI Chat for the requested
     * idea.
     *
     * Access is allowed only when:
     * - The idea exists.
     * - The idea is not soft-deleted.
     * - The idea belongs to the authenticated user.
     * - The idea has been unlocked.
     *
     * A missing or inaccessible idea is reported as not found to avoid exposing
     * whether an idea belonging to another user exists.
     *
     * @param userId Authenticated user identifier.
     * @param ideaId Idea identifier.
     * @returns Minimal validated idea record.
     * @throws NotFoundException When the idea does not exist, is deleted, or
     * does not belong to the authenticated user.
     * @throws ForbiddenException When AI Chat is unavailable because the idea
     * has not been unlocked.
     */
    async ensureIdeaChatAccess(
        userId: string,
        ideaId: string,
    ): Promise<AiChatIdeaAccessRecord> {
        const idea = await this.prisma.idea.findFirst({
            where: {
                id: ideaId,
                userId,
                deletedAt: null,
            },
            select: AI_CHAT_IDEA_ACCESS_SELECT,
        });

        if (!idea) {
            throw new NotFoundException('Idea was not found.');
        }

        if (!idea.isUnlocked) {
            throw new ForbiddenException(
                'AI Chat is available only for unlocked ideas.',
            );
        }

        return idea;
    }

    /**
     * Ensures that the authenticated user may access the requested chat session.
     *
     * Access is allowed only when:
     * - The session exists.
     * - The session is not soft-deleted.
     * - The session belongs to the authenticated user.
     * - The related idea exists and is not soft-deleted.
     * - The related idea belongs to the authenticated user.
     * - The related idea is unlocked.
     *
     * Ownership constraints are included directly in the database query to
     * prevent exposing resources belonging to another user.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Chat-session identifier.
     * @returns Minimal validated chat-session record.
     * @throws NotFoundException When the session or related idea does not exist,
     * is deleted, or does not belong to the authenticated user.
     * @throws ForbiddenException When AI Chat is unavailable because the related
     * idea has not been unlocked.
     */
    async ensureSessionChatAccess(
        userId: string,
        sessionId: string,
    ): Promise<AiChatSessionAccessRecord> {
        const session = await this.prisma.chatSession.findFirst({
            where: {
                id: sessionId,
                userId,
                deletedAt: null,
                idea: {
                    userId,
                    deletedAt: null,
                },
            },
            select: AI_CHAT_SESSION_ACCESS_SELECT,
        });

        if (!session) {
            throw new NotFoundException('AI chat session was not found.');
        }

        if (!session.idea.isUnlocked) {
            throw new ForbiddenException(
                'AI Chat is available only for unlocked ideas.',
            );
        }

        return session;
    }

    /**
     * Ensures that the authenticated user may access a chat session that belongs
     * to a specific idea.
     *
     * This stricter check is useful for routes or WebSocket events that receive
     * both an idea identifier and a session identifier.
     *
     * @param userId Authenticated user identifier.
     * @param ideaId Expected idea identifier.
     * @param sessionId Chat-session identifier.
     * @returns Minimal validated chat-session record.
     * @throws NotFoundException When the session does not belong to the expected
     * idea or cannot be accessed by the authenticated user.
     * @throws ForbiddenException When AI Chat is unavailable because the related
     * idea has not been unlocked.
     */
    async ensureSessionBelongsToIdea(
        userId: string,
        ideaId: string,
        sessionId: string,
    ): Promise<AiChatSessionAccessRecord> {
        const session = await this.prisma.chatSession.findFirst({
            where: {
                id: sessionId,
                ideaId,
                userId,
                deletedAt: null,
                idea: {
                    id: ideaId,
                    userId,
                    deletedAt: null,
                },
            },
            select: AI_CHAT_SESSION_ACCESS_SELECT,
        });

        if (!session) {
            throw new NotFoundException('AI chat session was not found.');
        }

        if (!session.idea.isUnlocked) {
            throw new ForbiddenException(
                'AI Chat is available only for unlocked ideas.',
            );
        }

        return session;
    }
}