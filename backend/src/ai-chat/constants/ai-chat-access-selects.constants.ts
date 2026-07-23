/**
 * Defines reusable Prisma selections used by AI Chat access validation.
 *
 * These selections intentionally include only the minimum fields required
 * to authorize access to ideas and chat sessions.
 *
 * @author Eman
 */

import { Prisma } from '@prisma/client';

/**
 * Minimal idea fields required by AI Chat access checks.
 */
export const AI_CHAT_IDEA_ACCESS_SELECT =
    Prisma.validator<Prisma.IdeaSelect>()({
        id: true,
        userId: true,
        isUnlocked: true,
        deletedAt: true,
    });

/**
 * Minimal chat-session fields required by AI Chat access checks.
 *
 * The related idea is selected so access remains valid only while the idea
 * exists, belongs to the same user, is not soft-deleted, and is unlocked.
 */
export const AI_CHAT_SESSION_ACCESS_SELECT =
    Prisma.validator<Prisma.ChatSessionSelect>()({
        id: true,
        userId: true,
        ideaId: true,
        deletedAt: true,
        idea: {
            select: AI_CHAT_IDEA_ACCESS_SELECT,
        },
    });