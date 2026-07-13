import { Injectable } from '@nestjs/common';

import { ApiRequestType, IdeaGenerationType } from '@prisma/client';

import type { Request, Response } from 'express';

import { AiExecutionService } from '../../ai/services/ai-execution.service';

import { AiResponseFormat } from '../../ai/types/ai-provider.type';

import { PromptBuilderService } from '../../prompts/services/prompt-builder.service';

import { PromptHistoryService } from '../../prompts/services/prompt-history.service';

import type { GenerateGuestIdeaDto } from '../dto/generate-guest-idea.dto';

import type { GenerateIdeaDto } from '../dto/generate-idea.dto';

import { CollectionJobResolverService } from './collection-job-resolver.service';

import { GuestIdeaSessionService } from './guest-idea-session.service';

import { IdeaAiOutputParserService } from './idea-ai-output-parser.service';

import { IdeaGenerationLockService } from './idea-generation-lock.service';

import { IdeaGenerationPolicyService } from './idea-generation-policy.service';

import { IdeaGenerationSelectionService } from './idea-generation-selection.service';

import { IdeaPersistenceService } from './idea-persistence.service';

/**
 * Coordinates the complete idea-generation workflow.
 *
 * Flow:
 * - Validate domain and effective platforms.
 * - Resolve user or guest entitlement.
 * - Resolve or execute data collection.
 * - Resolve NLP analysis.
 * - Build and persist the prompt.
 * - Execute structured AI generation.
 * - Parse the generated output.
 * - Persist the final idea atomically.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationOrchestratorService {
  constructor(
    private readonly policyService: IdeaGenerationPolicyService,

    private readonly guestSessionService: GuestIdeaSessionService,

    private readonly generationLockService: IdeaGenerationLockService,

    private readonly selectionService: IdeaGenerationSelectionService,

    private readonly collectionJobResolver: CollectionJobResolverService,

    private readonly promptBuilderService: PromptBuilderService,

    private readonly promptHistoryService: PromptHistoryService,

    private readonly aiExecutionService: AiExecutionService,

    private readonly outputParser: IdeaAiOutputParserService,

    private readonly persistenceService: IdeaPersistenceService,
  ) {}

  /**
   * Generates a registered free-tier or premium-credit idea.
   */
  async generateForUser(userId: string, dto: GenerateIdeaDto) {
    return this.generationLockService.runExclusive(
      `user:${userId}`,

      async () => {
        const selection = await this.selectionService.validateAndResolve(dto);

        const policy = await this.policyService.resolve(userId);

        return this.generate({
          dto: {
            ...dto,

            platforms: selection.platforms,
          },

          generationType: policy.generationType,

          userId,
        });
      },
    );
  }

  /**
   * Generates the guest's single free idea.
   *
   * The response intentionally exposes only the fields permitted
   * for guests. Internally stored registered-user fields are omitted.
   */
  async generateForGuest(
    dto: GenerateGuestIdeaDto,
    request: Request,
    response: Response,
  ) {
    const guestSession = await this.guestSessionService.resolveOrCreate(
      request,
      response,
    );

    return this.generationLockService.runExclusive(
      `guest:${guestSession.id}`,

      async () => {
        const selection = await this.selectionService.validateAndResolve(dto);

        const result = await this.generate({
          dto: {
            ...dto,

            platforms: selection.platforms,
          },

          generationType: IdeaGenerationType.GUEST_FREE,

          guestSessionId: guestSession.id,
        });

        return {
          idea: {
            id: result.idea.id,

            title: result.idea.title,

            limitedAbstract: result.idea.limitedAbstract,

            generationType: result.idea.generationType,

            createdAt: result.idea.createdAt,
          },

          generation: {
            generationType: IdeaGenerationType.GUEST_FREE,

            remainingGuestGenerations: 0,

            requiresRegistration: true,

            message:
              'Register to view the registered-user information for this idea.',
          },

          execution: result.execution,
        };
      },
    );
  }

  /**
   * Executes the common generation pipeline.
   */
  private async generate(input: {
    readonly dto: GenerateIdeaDto;

    readonly generationType: IdeaGenerationType;

    readonly userId?: string;

    readonly guestSessionId?: string;
  }) {
    const {
      job: collectionJob,

      nlpOutput,

      selectedPlatformId,
    } = await this.collectionJobResolver.resolve({
      domainId: input.dto.domainId,

      country: input.dto.country,

      city: input.dto.city,

      region: input.dto.region,

      language: input.dto.language,

      radiusKm: input.dto.radiusKm,

      platforms: input.dto.platforms ?? [],

      keywords: input.dto.keywords,
    });

    const prompt = await this.promptBuilderService.buildIdeaPrompt({
      purpose: 'IDEA_GENERATION',

      collectionJobId: collectionJob.id,

      generationType: input.generationType,
    });

    const promptHistory = await this.promptHistoryService.savePrompt({
      userId: input.userId,

      guestSessionId: input.guestSessionId,

      collectionJobId: collectionJob.id,

      promptType: prompt.promptType,

      promptText: prompt.promptText,

      templateHash: prompt.templateHash,

      estimatedInputTokens: prompt.estimatedInputTokens,
    });

    const execution = await this.aiExecutionService.execute({
      userPrompt: prompt.promptText,

      requestType: ApiRequestType.IDEA_GENERATION,

      promptType: prompt.promptType,

      generationType: input.generationType,

      responseFormat: AiResponseFormat.JSON,

      responseSchema: prompt.responseSchema,

      responseSchemaName: prompt.responseSchemaName,

      userId: input.userId,

      guestSessionId: input.guestSessionId,

      maxOutputTokens: 4_000,

      estimatedOutputTokens: 4_000,

      temperature: 0.4,
    });

    const aiOutput = this.outputParser.parse(
      execution.text,
      input.generationType,
    );

    const persisted = await this.persistenceService.persist({
      generationType: input.generationType,

      userId: input.userId,

      guestSessionId: input.guestSessionId,

      domainId: input.dto.domainId,

      selectedPlatformId,

      selectedRegion: input.dto.region?.trim() || undefined,

      collectionJobId: collectionJob.id,

      commentsCount: nlpOutput.totalCommentsAnalyzed,

      promptHistoryId: promptHistory.id,

      aiOperationId: execution.operationId,

      aiOutput,

      nlpOutput,
    });

    return {
      idea: persisted.idea,

      generation: {
        generationType: input.generationType,

        remainingCredits: persisted.creditResult?.balanceAfter,

        requiresRegistration: false,
      },

      execution: {
        operationId: execution.operationId,

        provider: execution.provider,

        apiModelId: execution.apiModelId,

        fallbackUsed: execution.fallbackUsed,

        attemptCount: execution.attemptCount,

        responseTimeMs: execution.responseTimeMs,
      },
    };
  }
}
