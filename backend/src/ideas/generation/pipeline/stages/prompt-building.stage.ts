import { BadRequestException, Injectable } from '@nestjs/common';

import { PromptBuilderService } from '../../../../prompts/services/prompt-builder.service';

import { PromptHistoryService } from '../../../../prompts/services/prompt-history.service';

import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';

/**
 * Builds and persists the rendered prompt used for core idea
 * generation.
 *
 * Responsibilities:
 * - Verify that collection and NLP stages completed.
 * - Delegate prompt rendering to PromptBuilderService.
 * - Select the response contract from the authorized generation
 *   type.
 * - Persist PromptHistory before calling the AI runtime.
 * - Store prompt traceability information in the generation
 *   context.
 * - Preserve the exact response schema that belongs to the
 *   rendered prompt.
 *
 * Persisting PromptHistory before provider execution preserves:
 * - Requester ownership.
 * - Generation-run traceability.
 * - Collection-job traceability.
 * - Prompt-template version.
 * - The exact rendered prompt sent to the provider.
 *
 * Keeping the response schema in the context guarantees that the
 * AI execution stage uses the same contract selected during this
 * prompt-building operation.
 *
 * This stage does not:
 * - Execute the AI provider.
 * - Parse AI output.
 * - Create the Idea record.
 * - Attach the Idea to PromptHistory.
 *
 * The Idea is attached to PromptHistory after successful idea
 * persistence.
 *
 * @author Malak
 */
@Injectable()
export class PromptBuildingStage implements IdeaGenerationStage {
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.PROMPT_BUILDING;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly promptBuilderService: PromptBuilderService,

    private readonly promptHistoryService: PromptHistoryService,
  ) {}

  /**
   * Builds and persists the core idea-generation prompt.
   *
   * @param context Current generation context.
   * @returns Context containing persisted prompt information.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const collection = context.collection!;
    const collectionAnchorDomainId =
      collection.anchorDomainId ??
      context.domainResolution?.selectedDomain.id ??
      context.domainEvidence.find(
        (entry) => entry.collectionJobId === collection.collectionJobId,
      )?.domainId ??
      context.domainId;
    const collectionAnchorDomainName =
      collection.anchorDomainName ??
      context.selectedDomains.find(
        (domain) => domain.id === collectionAnchorDomainId,
      )?.name ??
      context.domainResolution?.selectedDomain.name ??
      context.domainName!;

    const prompt = await this.promptBuilderService.buildIdeaPrompt({
      purpose: 'IDEA_GENERATION',

      collectionJobId: collection.collectionJobId,

      generationType: context.generationType,

      requesterUserId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,

      requestDescription: context.requestDescription,
      requestIntent: context.collectionPlan?.requestIntent ?? null,
      outputLanguage: context.outputLanguage,

      opportunityRanking: context.opportunityRanking ?? undefined,

      selectedDomains: context.selectedDomains,

      // Use the merged multi-domain NLP result instead of reloading only the
      // primary collection job analysis.
      analysisOverride: context.nlp ?? undefined,

      // Every field below was already validated by earlier pipeline stages.
      // Reusing it removes one full Supabase read from prompt construction
      // without changing prompt content or weakening unlock validation.
      collectionContextOverride: {
        id: collection.collectionJobId,
        createdById:
          context.owner.type === IDEA_OWNER_TYPES.USER
            ? context.owner.userId
            : null,
        country: context.location.country,
        city: context.location.city,
        region: context.location.region,
        domain: {
          id: collectionAnchorDomainId,
          name: collectionAnchorDomainName,
        },
        sources: context.selectedDataSources.map((source) => ({
          dataSource: {
            key: source.key,
            displayName: source.displayName,
            isActive: true,
            isImplemented: true,
          },
        })),
      },

      // Preserve domain attribution for evidence-aware prompt instructions.
      domainEvidence: context.domainEvidence,

      // Canonical problem/evidence contracts are authoritative. PromptBuilder
      // must not reconstruct evidence truth from ranking prose or NLP snapshots.
      canonicalProblemSpec: context.canonicalProblemSpec,
      evidenceState: context.evidenceState,
      canonicalEvidence: context.canonicalEvidenceLedger,
    });

    const promptHistory = await this.promptHistoryService.savePrompt({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : null,

      guestSessionId:
        context.owner.type === IDEA_OWNER_TYPES.GUEST
          ? context.owner.guestSessionId
          : null,

      generationRunId: context.runId,

      collectionJobId: collection.collectionJobId,

      ideaId: null,

      promptType: prompt.promptType,

      promptText: prompt.promptText,

      templateHash: prompt.templateHash,

      estimatedInputTokens: prompt.estimatedInputTokens,
    });

    const updatedContext: IdeaGenerationContext = {
      ...context,

      prompt: {
        promptHistoryId: promptHistory.id,

        promptText: prompt.promptText,

        templateHash: prompt.templateHash,

        estimatedInputTokens: prompt.estimatedInputTokens,

        responseSchemaName: prompt.responseSchemaName,

        responseSchema: prompt.responseSchema,
      },
    };

    return {
      context: updatedContext,

      resultPreview: `Idea-generation prompt built and saved as "${promptHistory.id}".`,

      metadata: {
        promptHistoryId: promptHistory.id,

        promptType: prompt.promptType,

        templateHash: prompt.templateHash,

        estimatedInputTokens: prompt.estimatedInputTokens,

        responseSchemaName: prompt.responseSchemaName,

        promptLength: prompt.promptText.length,
      },
    };
  }

  /**
   * Validates all context values needed before prompt building.
   *
   * @param context Current generation context.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.runId.trim()) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.PROMPT_BUILD_FAILED,

        message: 'Generation run ID is required before prompt building.',
      });
    }

    if (!context.policy) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.PROMPT_BUILD_FAILED,

        message:
          'Generation entitlement must be resolved before prompt building.',
      });
    }

    if (!context.collection) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.PROMPT_BUILD_FAILED,

        message:
          'Collection-job information is required before prompt building.',
      });
    }

    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.PROMPT_BUILD_FAILED,

        message: 'NLP analysis is required before prompt building.',
      });
    }

    if (!context.opportunityRanking) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.PROMPT_BUILD_FAILED,

        message: 'Opportunity ranking must complete before prompt building.',
      });
    }

    if (!context.domainName) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.PROMPT_BUILD_FAILED,

        message:
          'A resolved generation domain is required before prompt building.',
      });
    }
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Prompt-building stage definition.
   */
  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}