/**
 * Defines reusable Prisma selections for AI Chat messages.
 *
 * Centralizing selections ensures consistent response shapes and prevents
 * accidental exposure of internal relations or unnecessary database fields.
 *
 * @author Eman
 */

import { Prisma } from '@prisma/client';

/**
 * Publicly safe fields returned for one AI chat message.
 */
export const AI_CHAT_MESSAGE_SELECT =
    Prisma.validator<Prisma.ChatMessageSelect>()({
        id: true,
        sessionId: true,
        sender: true,
        status: true,
        message: true,
        errorCode: true,
        errorMessage: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
    });