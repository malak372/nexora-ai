/**
 * Generates concise AI chat-session titles from the conversation's meaning.
 *
 * Titles are refreshed at bounded conversation milestones so they can evolve
 * when the dominant topic changes. A title edited manually by the user is
 * never overwritten.
 *
 * @author Eman
 */

import { Injectable, Logger } from '@nestjs/common';
import {
    ApiRequestType,
    ChatMessageStatus,
    ChatSender,
    PromptType,
} from '@prisma/client';

import { AiExecutionService } from '../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../ai/types/ai-provider.type';
import { PrismaService } from '../../prisma/prisma.service';
import {
    AI_CHAT_DEFAULT_SESSION_TITLE,
    AI_CHAT_MAX_SESSION_TITLE_LENGTH,
    AI_CHAT_TITLE_CONTEXT_MESSAGES,
    AI_CHAT_TITLE_MAX_OUTPUT_TOKENS,
    AI_CHAT_TITLE_TEMPERATURE,
    AI_CHAT_TITLE_TIMEOUT_MS,
} from '../constants/ai-chat.constants';

type SmartTitleSessionRow = {
    id: string;
    ideaId: string;
    title: string | null;
    titleManuallyEdited: boolean;
    titleGeneratedAt: Date | null;
};

@Injectable()
export class AiChatTitleService {
    private readonly logger = new Logger(AiChatTitleService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly aiExecutionService: AiExecutionService,
    ) { }

    /**
     * Refreshes a session title when the conversation reaches a title milestone.
     * Title failures never fail or delay the main chat response.
     */
    async refreshTitleIfNeeded(
        userId: string,
        sessionId: string,
    ): Promise<void> {
        try {
            const rows = await this.prisma.$queryRaw<SmartTitleSessionRow[]>`
        SELECT
          "id",
          "idea_id" AS "ideaId",
          "title",
          "title_manually_edited" AS "titleManuallyEdited",
          "title_generated_at" AS "titleGeneratedAt"
        FROM "chat_sessions"
        WHERE "id" = ${sessionId}
          AND "user_id" = ${userId}
          AND "deleted_at" IS NULL
        LIMIT 1
      `;

            const session = rows[0];

            if (!session || session.titleManuallyEdited) {
                return;
            }

            const userMessageCount = await this.prisma.chatMessage.count({
                where: {
                    sessionId,
                    sender: ChatSender.USER,
                    status: ChatMessageStatus.COMPLETED,
                    deletedAt: null,
                },
            });

            if (!this.shouldGenerateTitle(userMessageCount, session.titleGeneratedAt)) {
                return;
            }

            const messages = await this.prisma.chatMessage.findMany({
                where: {
                    sessionId,
                    status: ChatMessageStatus.COMPLETED,
                    deletedAt: null,
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: AI_CHAT_TITLE_CONTEXT_MESSAGES,
                select: {
                    sender: true,
                    message: true,
                },
            });

            if (messages.length === 0) {
                return;
            }

            const transcript = messages
                .reverse()
                .map((message) => {
                    const speaker =
                        message.sender === ChatSender.USER ? 'User' : 'Assistant';
                    return `${speaker}: ${message.message}`;
                })
                .join('\n');

            const result = await this.aiExecutionService.execute({
                systemInstruction: [
                    'Create one concise title that represents the main meaning of the conversation.',
                    'Use the same language as the conversation.',
                    'Return only the title, with no quotation marks, label, punctuation suffix, or explanation.',
                    'Prefer 3 to 7 words and never exceed 80 characters.',
                    'Describe the topic rather than copying the first message literally.',
                ].join(' '),
                userPrompt: `Conversation:\n${transcript}\n\nTitle:`,
                requestType: ApiRequestType.AI_CHAT,
                promptType: PromptType.CHAT_RESPONSE,
                userId,
                ideaId: session.ideaId,
                maxOutputTokens: AI_CHAT_TITLE_MAX_OUTPUT_TOKENS,
                estimatedOutputTokens: AI_CHAT_TITLE_MAX_OUTPUT_TOKENS,
                temperature: AI_CHAT_TITLE_TEMPERATURE,
                timeoutMs: AI_CHAT_TITLE_TIMEOUT_MS,
                maxModelsPerOperation: 2,
                responseFormat: AiResponseFormat.TEXT,
            });

            const title = this.normalizeTitle(result.text);

            if (!title) {
                return;
            }

            await this.prisma.$executeRaw`
        UPDATE "chat_sessions"
        SET
          "title" = ${title},
          "title_generated_at" = NOW(),
          "updated_at" = NOW()
        WHERE "id" = ${sessionId}
          AND "user_id" = ${userId}
          AND "deleted_at" IS NULL
          AND "title_manually_edited" = false
      `;
        } catch (error: unknown) {
            this.logger.warn(
                `Could not refresh AI chat title for session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    /**
     * Generate after the first user message, then at meaningful checkpoints.
     * The title can therefore change later when the conversation changes topic,
     * without spending one AI request on every turn.
     */
    private shouldGenerateTitle(
        userMessageCount: number,
        titleGeneratedAt: Date | null,
    ): boolean {
        if (userMessageCount <= 0) {
            return false;
        }

        if (!titleGeneratedAt) {
            return true;
        }

        return (
            userMessageCount === 3 ||
            userMessageCount === 6 ||
            userMessageCount % 5 === 0
        );
    }

    private normalizeTitle(value: string): string | null {
        const normalized = value
            .trim()
            .replace(/^title\s*:\s*/i, '')
            .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
            .replace(/[.!?،,:;؛]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalized || normalized === AI_CHAT_DEFAULT_SESSION_TITLE) {
            return null;
        }

        return normalized.slice(0, AI_CHAT_MAX_SESSION_TITLE_LENGTH).trim();
    }
}