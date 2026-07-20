import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiRequestType,
  IdeaGenerationType,
  PromptType,
} from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { PrismaService } from '../../../prisma/prisma.service';
import { PromptBuilderService } from '../../../prompts/services/prompt-builder.service';
import { PromptHistoryService } from '../../../prompts/services/prompt-history.service';
import { IdeaUnlockOutputParserService } from '../../generation/services/idea-unlock-output-parser.service';

import type {
  UnlockPaidIdeaInput,
  UnlockPaidIdeaResult,
} from '../types/idea-output.type';
import { IdeaOutputPersistenceService } from './idea-output-persistence.service';

/**
 * Executes the complete advanced-output workflow for one successfully paid
 * NORMAL_FREE idea.
 *
 * A durable database claim is acquired before the AI request. This prevents
 * concurrent webhook deliveries from issuing duplicate paid AI calls. The
 * claim is marked FAILED when generation fails and can later be retried safely.
 */
@Injectable()
export class IdeaUnlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly promptHistory: PromptHistoryService,
    private readonly aiExecution: AiExecutionService,
    private readonly parser: IdeaUnlockOutputParserService,
    private readonly persistence: IdeaOutputPersistenceService,
  ) {}

  async unlockPaidIdea(
    input: UnlockPaidIdeaInput,
  ): Promise<UnlockPaidIdeaResult> {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: input.ideaId,
        userId: input.userId,
        deletedAt: null,
      },
      select: {
        id: true,
        collectionJobId: true,
        generationType: true,
      },
    });

    if (!idea) {
      throw new NotFoundException('The selected idea was not found.');
    }

    if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
      throw new BadRequestException(
        'Only a registered-user free idea can be unlocked by direct payment.',
      );
    }

    if (!idea.collectionJobId) {
      throw new BadRequestException(
        'The idea is missing the collection context required for unlocking.',
      );
    }

    const claim = await this.persistence.beginDirectUnlock(
      idea.id,
      input.userId,
    );

    if (claim.alreadyUnlocked) {
      if (!claim.unlockedAt) {
        throw new BadRequestException(
          'The idea has an inconsistent unlock state.',
        );
      }

      return {
        paymentId: input.paymentId,
        ideaId: claim.ideaId,
        alreadyUnlocked: true,
        completedNow: false,
        unlockedAt: claim.unlockedAt,
      };
    }

    try {
      const prompt = await this.promptBuilder.buildIdeaPrompt({
        purpose: 'IDEA_UNLOCK',
        collectionJobId: idea.collectionJobId,
        existingIdeaId: idea.id,
        requesterUserId: input.userId,
      });

      await this.promptHistory.savePrompt({
        userId: input.userId,
        collectionJobId: idea.collectionJobId,
        ideaId: idea.id,
        promptType: PromptType.IDEA_UNLOCK,
        promptText: prompt.promptText,
        templateHash: prompt.templateHash,
        estimatedInputTokens: prompt.estimatedInputTokens,
      });

      const aiResult = await this.aiExecution.execute({
        userPrompt: prompt.promptText,
        requestType: ApiRequestType.IDEA_GENERATION,
        promptType: PromptType.IDEA_UNLOCK,
        userId: input.userId,
        ideaId: idea.id,
        responseFormat: AiResponseFormat.JSON,
        responseSchema: prompt.responseSchema,
        responseSchemaName: prompt.responseSchemaName,
      });

      const parsed = this.parser.parseOrThrow(aiResult.text);

      const persisted = await this.persistence.persistDirectUnlock({
        ideaId: idea.id,
        userId: input.userId,
        output: parsed,
      });

      return {
        paymentId: input.paymentId,
        ideaId: persisted.ideaId,
        alreadyUnlocked: false,
        completedNow: true,
        unlockedAt: persisted.unlockedAt,
      };
    } catch (error) {
      await this.persistence.markDirectUnlockFailed(
        idea.id,
        input.userId,
        error,
      );

      throw error;
    }
  }
}