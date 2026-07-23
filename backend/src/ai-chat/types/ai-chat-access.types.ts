/**
 * Defines shared result types for AI Chat access validation.
 *
 * @author Eman
 */

import { Prisma } from '@prisma/client';

import {
    AI_CHAT_IDEA_ACCESS_SELECT,
    AI_CHAT_SESSION_ACCESS_SELECT,
} from '../constants/ai-chat-access-selects.constants';

/**
 * Minimal idea record returned after successful AI Chat access validation.
 */
export type AiChatIdeaAccessRecord = Prisma.IdeaGetPayload<{
    select: typeof AI_CHAT_IDEA_ACCESS_SELECT;
}>;

/**
 * Minimal chat-session record returned after successful AI Chat access
 * validation.
 */
export type AiChatSessionAccessRecord = Prisma.ChatSessionGetPayload<{
    select: typeof AI_CHAT_SESSION_ACCESS_SELECT;
}>;