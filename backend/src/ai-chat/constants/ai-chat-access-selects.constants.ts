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
export const AI_CHAT_IDEA_ACCESS_SELECT = Prisma.validator<Prisma.IdeaSelect>()(
  {
    id: true,
    userId: true,
    isUnlocked: true,
    deletedAt: true,
    publication: {
      select: {
        id: true,
        acceptances: {
          select: {
            userId: true,
            advancedUnlockedAt: true,
          },
        },
      },
    },
  },
);

/**
 * Minimal chat-session fields required by AI Chat access checks.
 *
 * The session user is selected only for the current account status check.
 * The related idea is selected with the entitlement fields required for
 * owner and accepted-publication access validation.
 */
export const AI_CHAT_SESSION_ACCESS_SELECT =
  Prisma.validator<Prisma.ChatSessionSelect>()({
    id: true,
    userId: true,
    ideaId: true,
    deletedAt: true,
    user: {
      select: {
        accountStatus: true,
      },
    },
    idea: {
      select: AI_CHAT_IDEA_ACCESS_SELECT,
    },
  });