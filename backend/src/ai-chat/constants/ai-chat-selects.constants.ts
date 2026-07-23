/**
 * Defines reusable Prisma selections for the AI Chat module.
 *
 * Centralizing selections ensures consistent API responses and prevents
 * accidental exposure of sensitive user, idea, or internal relation data.
 *
 * @author Eman
 */

import { Prisma } from '@prisma/client';

/**
 * Publicly safe fields returned for an AI chat session.
 *
 * The message count includes only non-deleted messages.
 */
export const AI_CHAT_SESSION_SELECT =
    Prisma.validator<Prisma.ChatSessionSelect>()({
        id: true,
        ideaId: true,
        title: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
            select: {
                messages: {
                    where: {
                        deletedAt: null,
                    },
                },
            },
        },
    });