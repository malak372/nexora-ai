import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AiRoutingStrategy,
  ApiRequestType,
  CreditTransactionType,
  IdeaGenerationType,
  Prisma,
  PromptType,
  UnlockMethod,
} from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { CreditBalanceService } from '../../../credits/services/credit-balance.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PromptBuilderService } from '../../../prompts/services/prompt-builder.service';
import { PromptHistoryService } from '../../../prompts/services/prompt-history.service';
import { IdeaUnlockOutputParserService } from '../../generation/services/idea-unlock-output-parser.service';
import type { IdeaGenerationNlpContext } from '../../generation/types/idea-generation-context.type';

import type {
  UnlockIdeaWithCreditResult,
  UnlockPaidIdeaInput,
  UnlockPaidIdeaResult,
} from '../types/idea-output.type';
import { IdeaOutputPersistenceService } from './idea-output-persistence.service';

type UnlockWorkflowInput = {
  readonly ideaId: string;
  readonly userId: string;
  readonly unlockMethod: UnlockMethod;
  readonly paymentId?: string;
  readonly consumeCredit: boolean;
};

type UnlockWorkflowResult = {
  readonly ideaId: string;
  readonly alreadyUnlocked: boolean;
  readonly completedNow: boolean;
  readonly unlockedAt: Date;
  readonly creditBalance?: number;
};

/** Generates advanced outputs for an eligible free idea. */
@Injectable()
export class IdeaUnlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly promptHistory: PromptHistoryService,
    private readonly aiExecution: AiExecutionService,
    private readonly parser: IdeaUnlockOutputParserService,
    private readonly persistence: IdeaOutputPersistenceService,
    private readonly creditBalanceService: CreditBalanceService,
  ) { }

  async unlockPaidIdea(input: UnlockPaidIdeaInput): Promise<UnlockPaidIdeaResult> {
    const result = await this.executeUnlock({
      ideaId: input.ideaId,
      userId: input.userId,
      paymentId: input.paymentId,
      unlockMethod: UnlockMethod.DIRECT_PAYMENT,
      consumeCredit: false,
    });

    return {
      paymentId: input.paymentId,
      ideaId: result.ideaId,
      alreadyUnlocked: result.alreadyUnlocked,
      completedNow: result.completedNow,
      unlockedAt: result.unlockedAt,
    };
  }

  /** Premium users unlock one NORMAL_FREE idea by spending one credit. */
  async unlockIdeaWithCredit(
    userId: string,
    ideaId: string,
  ): Promise<UnlockIdeaWithCreditResult> {
    const result = await this.executeUnlock({
      ideaId,
      userId,
      unlockMethod: UnlockMethod.CREDIT_GENERATION,
      consumeCredit: true,
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });

    return {
      ideaId: result.ideaId,
      alreadyUnlocked: result.alreadyUnlocked,
      completedNow: result.completedNow,
      unlockedAt: result.unlockedAt,
      creditBalance: user?.creditBalance ?? result.creditBalance ?? 0,
    };
  }

  private async executeUnlock(
    input: UnlockWorkflowInput,
  ): Promise<UnlockWorkflowResult> {
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
        isUnlocked: true,
        unlockedAt: true,
        user: {
          select: {
            accountStatus: true,
            creditBalance: true,
          },
        },
        generationRun: {
          select: {
            contextSnapshot: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException('The selected idea was not found.');
    }

    if (!idea.user) {
      throw new BadRequestException('The selected idea has no registered owner.');
    }

    if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
      throw new BadRequestException(
        'Only a registered-user free idea can be unlocked.',
      );
    }

    if (idea.isUnlocked && idea.unlockedAt) {
      return {
        ideaId: idea.id,
        alreadyUnlocked: true,
        completedNow: false,
        unlockedAt: idea.unlockedAt,
        creditBalance: idea.user.creditBalance,
      };
    }

    const settings = input.consumeCredit
      ? await this.prisma.systemSetting.findUnique({
          where: { key: 'GLOBAL' },
          select: { premiumIdeaCreditCost: true },
        })
      : null;
    const requiredCredits = settings?.premiumIdeaCreditCost ?? 15;

    if (input.consumeCredit) {
      if (idea.user.accountStatus !== AccountStatus.PREMIUM) {
        throw new ForbiddenException(
          'Only Premium users can unlock a free idea with credits.',
        );
      }

      if (idea.user.creditBalance < requiredCredits) {
        throw new BadRequestException('Insufficient credit balance.');
      }
    }

    if (!idea.collectionJobId) {
      throw new BadRequestException(
        'The idea is missing the collection context required for unlocking.',
      );
    }

    let claim = await this.persistence.beginDirectUnlock(idea.id, input.userId);

    if (claim.alreadyUnlocked && claim.unlockedAt) {
      return {
        ideaId: claim.ideaId,
        alreadyUnlocked: true,
        completedNow: false,
        unlockedAt: claim.unlockedAt,
        creditBalance: idea.user.creditBalance,
      };
    }

    if (claim.inProgress) {
      const concurrentResult =
        await this.persistence.waitForDirectUnlockCompletion(
          idea.id,
          input.userId,
        );

      if (concurrentResult.completed && concurrentResult.unlockedAt) {
        return {
          ideaId: idea.id,
          alreadyUnlocked: true,
          completedNow: false,
          unlockedAt: concurrentResult.unlockedAt,
          creditBalance: idea.user.creditBalance,
        };
      }

      if (!concurrentResult.retryable) {
        throw new ConflictException(
          'Advanced-output generation is still in progress for this idea.',
        );
      }

      claim = await this.persistence.beginDirectUnlock(idea.id, input.userId);

      if (claim.alreadyUnlocked && claim.unlockedAt) {
        return {
          ideaId: idea.id,
          alreadyUnlocked: true,
          completedNow: false,
          unlockedAt: claim.unlockedAt,
          creditBalance: idea.user.creditBalance,
        };
      }

      if (claim.inProgress) {
        throw new ConflictException(
          'Advanced-output generation is still in progress for this idea.',
        );
      }
    }

    let creditWasConsumed = false;
    let balanceAfter: number | undefined;

    try {
      if (input.consumeCredit) {
        const creditResult = await this.creditBalanceService.consumeForIdeaGeneration(
          input.userId,
          idea.id,
          requiredCredits,
        );
        creditWasConsumed = true;
        balanceAfter = creditResult.balanceAfter;
      }

      const prompt = await this.promptBuilder.buildIdeaPrompt({
        purpose: 'IDEA_UNLOCK',
        collectionJobId: idea.collectionJobId,
        existingIdeaId: idea.id,
        requesterUserId: input.userId,
        analysisOverride: this.readGenerationSnapshotNlp(
          idea.generationRun?.contextSnapshot,
        ),
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
        strategy: AiRoutingStrategy.BALANCED,
        timeoutMs: null,
        allowProviderFallbackOnInvalidPrompt: true,
      });

      const parsed = this.parser.parseOrThrow(aiResult.text);

      const persisted = await this.persistence.persistDirectUnlock({
        ideaId: idea.id,
        userId: input.userId,
        output: parsed,
        unlockMethod: input.unlockMethod,
      });

      return {
        ideaId: persisted.ideaId,
        alreadyUnlocked: false,
        completedNow: true,
        unlockedAt: persisted.unlockedAt,
        creditBalance: balanceAfter,
      };
    } catch (error) {
      await this.persistence.markDirectUnlockFailed(idea.id, input.userId, error);

      if (creditWasConsumed) {
        await this.creditBalanceService.adjustBalance({
          userId: input.userId,
          ideaId: idea.id,
          amount: requiredCredits,
          type: CreditTransactionType.REFUND,
          description: 'Credit refunded because advanced-output generation failed.',
          activatePremium: false,
        });
      }

      throw error;
    }
  }

  private readGenerationSnapshotNlp(
    contextSnapshot: Prisma.JsonValue | null | undefined,
  ): IdeaGenerationNlpContext | undefined {
    const snapshot = this.readJsonRecord(contextSnapshot);
    const nlp = this.readJsonRecord(
      snapshot?.nlp as Prisma.JsonValue | undefined,
    );

    if (!nlp) {
      return undefined;
    }

    const nlpAnalysisId =
      typeof nlp.nlpAnalysisId === 'string' ? nlp.nlpAnalysisId.trim() : '';
    const totalTextsAnalyzed = this.readNonNegativeNumber(
      nlp.totalTextsAnalyzed,
    );
    const totalPostsAnalyzed = this.readNonNegativeNumber(
      nlp.totalPostsAnalyzed,
    );
    const totalCommentsAnalyzed = this.readNonNegativeNumber(
      nlp.totalCommentsAnalyzed,
    );

    if (
      !nlpAnalysisId ||
      totalTextsAnalyzed === null ||
      totalPostsAnalyzed === null ||
      totalCommentsAnalyzed === null ||
      typeof nlp.aiUsed !== 'boolean'
    ) {
      return undefined;
    }

    const confidence =
      nlp.confidence === null || nlp.confidence === undefined
        ? null
        : typeof nlp.confidence === 'number' && Number.isFinite(nlp.confidence)
          ? nlp.confidence
          : null;

    return {
      nlpAnalysisId,
      totalTextsAnalyzed,
      totalPostsAnalyzed,
      totalCommentsAnalyzed,
      sentimentStats: this.readJsonValue(nlp.sentimentStats),
      keywords: this.readJsonValue(nlp.keywords),
      topics: this.readJsonValue(nlp.topics),
      recurringProblems: this.readJsonValue(nlp.recurringProblems),
      extractedNeeds: this.readJsonValue(nlp.extractedNeeds),
      featureRequests: this.readJsonValue(nlp.featureRequests),
      opportunities: this.readJsonValue(nlp.opportunities),
      insights: this.readJsonValue(nlp.insights),
      dataQuality: this.readJsonValue(nlp.dataQuality),
      samplePosts: this.readJsonValue(nlp.samplePosts),
      sampleComments: this.readJsonValue(nlp.sampleComments),
      aiUsed: nlp.aiUsed,
      confidence,
    };
  }

  private readJsonRecord(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, Prisma.JsonValue> | null {
    return value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : null;
  }

  private readJsonValue(
    value: Prisma.JsonValue | undefined,
  ): Prisma.JsonValue | null {
    return value === undefined ? null : value;
  }

  private readNonNegativeNumber(
    value: Prisma.JsonValue | undefined,
  ): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : null;
  }
}