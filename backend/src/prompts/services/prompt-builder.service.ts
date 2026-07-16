
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { createHash } from 'crypto';

import {
  CollectionJobStatus,
  IdeaGenerationType,
  Prisma,
  PromptType,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { DEFAULT_TOKEN_RATIO } from '../constants/prompt.constants';

import {
  FREE_OUTPUT_FORMAT,
  FREE_OUTPUT_SCHEMA,
  GUEST_OUTPUT_FORMAT,
  GUEST_OUTPUT_SCHEMA,
  PREMIUM_OUTPUT_FORMAT,
  PREMIUM_OUTPUT_SCHEMA,
  UNLOCK_OUTPUT_FORMAT,
  UNLOCK_OUTPUT_SCHEMA,
} from '../output-formats';

import { JsonSchema } from '../types/json-schema.type';
import { PromptBuilderInput } from '../types/prompt-builder-input.type';
import { PromptBuilderOutput } from '../types/prompt-builder-output.type';

import { PromptTemplateService } from './prompt-template.service';

/**
 * Approximate character-to-token ratio used when Arabic
 * text appears in the rendered prompt.
 *
 * Arabic and mixed-language prompts commonly require more
 * tokens per character than English-only prompts.
 *
 * Provider-reported usage remains the final source of truth.
 */
const ARABIC_TOKEN_RATIO = 2.5;

/**
 * Detects Arabic Unicode characters in rendered prompt content.
 */
const ARABIC_TEXT_PATTERN = /[\u0600-\u06ff]/;

/**
 * Maximum number of collection sources included in one prompt.
 *
 * Collection jobs normally contain a much smaller source list,
 * but the limit protects the prompt from unexpected growth.
 */
const MAX_PROMPT_DATA_SOURCES = 50;

/**
 * Provider-neutral structured-output contract selected according
 * to the generation level and prompt purpose.
 */
type OutputContract = {
  /**
   * Stable name passed to the selected AI adapter.
   */
  readonly schemaName: string;

  /**
   * Human-readable JSON example inserted in the prompt.
   */
  readonly format: string;

  /**
   * Provider-neutral response schema.
   */
  readonly schema: JsonSchema;
};

/**
 * Prisma selection used to retrieve the exact CollectionJob
 * context required by PromptBuilderService.
 *
 * Platforms are resolved through:
 *
 * CollectionJob
 * → CollectionJobSource
 * → DataSource
 *
 * CollectionJob does not contain a direct platforms field.
 */
const COLLECTION_JOB_PROMPT_QUERY = {
  select: {
    id: true,
    createdById: true,
    status: true,
    country: true,
    city: true,
    region: true,

    domain: {
      select: {
        id: true,
        name: true,
      },
    },

    nlpAnalysis: true,

    sources: {
      take: MAX_PROMPT_DATA_SOURCES,
      orderBy: {
        dataSource: {
          displayName: Prisma.SortOrder.asc,
        },
      },
      select: {
        dataSource: {
          select: {
            key: true,
            displayName: true,
            isActive: true,
            isImplemented: true,
          },
        },
      },
    },
  },
} satisfies Prisma.CollectionJobDefaultArgs;

/**
 * Result type inferred directly from COLLECTION_JOB_PROMPT_QUERY.
 */
type CollectionJobPromptContext =
  Prisma.CollectionJobGetPayload<
    typeof COLLECTION_JOB_PROMPT_QUERY
  >;

/**
 * Existing idea fields required for direct-unlock context.
 */
const EXISTING_IDEA_SELECT = {
  id: true,
  userId: true,
  collectionJobId: true,
  generationType: true,
  isUnlocked: true,
  title: true,
  problemStatement: true,
  objectives: true,
  targetUsers: true,
  limitedAbstract: true,
  partialAbstract: true,
} satisfies Prisma.IdeaSelect;

/**
 * Existing idea shape inferred from Prisma.
 */
type ExistingIdeaContext =
  Prisma.IdeaGetPayload<{
    select: typeof EXISTING_IDEA_SELECT;
  }>;

/**
 * Builds provider-neutral prompts from persisted collection
 * and NLP pipeline results.
 *
 * Reads:
 * - CollectionJob.
 * - Domain.
 * - CollectionJobSource.
 * - DataSource.
 * - NlpAnalysis.
 * - Existing Idea for direct unlock.
 *
 * Responsibilities:
 * - Validate prerequisite pipeline stages.
 * - Resolve the correct output access contract.
 * - Render the configurable prompt template.
 * - Estimate prompt token usage.
 * - Calculate the prompt-template hash.
 *
 * This service is the prompt-building stage of the wider
 * idea-generation pipeline.
 *
 * It does not:
 * - Start collection.
 * - Execute NLP.
 * - Save PromptHistory.
 * - Call an AI provider.
 * - Create an Idea.
 * - Deduct credits.
 * - Process payments.
 *
 * @author Malak
 */
@Injectable()
export class PromptBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptTemplateService:
      PromptTemplateService,
  ) { }

  /**
   * Builds one complete idea-generation or unlock prompt.
   *
   * Requirements:
   * - CollectionJob exists.
   * - CollectionJob status is COMPLETED.
   * - NlpAnalysis exists.
   * - Direct unlock references an eligible active idea.
   *
   * @param input Type-safe prompt-building request.
   * @returns Rendered prompt and response contract.
   */
  async buildIdeaPrompt(
    input: PromptBuilderInput,
  ): Promise<PromptBuilderOutput> {
    const collectionJob =
      await this.getCollectionJobContext(
        input.collectionJobId,
      );

    this.validateCollectionJob(
      collectionJob,
      input,
    );

    const existingIdea =
      await this.getExistingIdea(input);

    const template =
      await this.promptTemplateService
        .getIdeaPromptTemplate();

    const outputContract =
      this.getOutputContract(input);

    const renderedPrompt =
      this.promptTemplateService.renderTemplate(
        template,
        {
          domain: collectionJob.domain.name,

          country:
            collectionJob.country?.trim() ||
            'Not specified',

          city:
            collectionJob.city?.trim() ||
            'Not specified',

          region:
            collectionJob.region?.trim() ||
            'Not specified',

          platforms: this.formatDataSources(
            collectionJob,
          ),

          commentsCount: String(
            collectionJob.nlpAnalysis!
              .totalCommentsAnalyzed,
          ),

          sentimentStats: this.formatJson(
            collectionJob.nlpAnalysis!
              .sentimentStats,
          ),

          keywords: this.formatJson(
            collectionJob.nlpAnalysis!.keywords,
          ),

          topics: this.formatJson(
            collectionJob.nlpAnalysis!.topics,
          ),

          recurringProblems: this.formatJson(
            collectionJob.nlpAnalysis!
              .recurringProblems,
          ),

          extractedNeeds: this.formatJson(
            collectionJob.nlpAnalysis!
              .extractedNeeds,
          ),

          featureRequests: this.formatJson(
            collectionJob.nlpAnalysis!
              .featureRequests,
          ),

          opportunities: this.formatJson(
            collectionJob.nlpAnalysis!
              .opportunities,
          ),

          insights: this.formatJson(
            collectionJob.nlpAnalysis!.insights,
          ),

          dataQuality: this.formatJson(
            collectionJob.nlpAnalysis!
              .dataQuality,
          ),

          samplePosts: this.formatJson(
            collectionJob.nlpAnalysis!
              .samplePosts,
          ),

          sampleComments: this.formatJson(
            collectionJob.nlpAnalysis!
              .sampleComments,
          ),

          existingIdea:
            this.formatExistingIdea(existingIdea),

          requestedOutputFormat:
            outputContract.format,
        },
      );

    const compactPrompt =
      this.compactPrompt(renderedPrompt);

    return {
      promptType: this.getPromptType(input),

      promptText: compactPrompt,

      estimatedInputTokens:
        this.estimateApproximateInputTokens(
          compactPrompt,
        ),

      templateHash:
        this.createTemplateHash(template),

      responseSchemaName:
        outputContract.schemaName,

      responseSchema:
        outputContract.schema,
    };
  }

  /**
   * Retrieves the persisted collection and NLP context.
   */
  private async getCollectionJobContext(
    collectionJobId: string,
  ): Promise<CollectionJobPromptContext> {
    const normalizedCollectionJobId =
      collectionJobId.trim();

    if (!normalizedCollectionJobId) {
      throw new BadRequestException(
        'Collection job ID is required.',
      );
    }

    const collectionJob =
      await this.prisma.collectionJob.findUnique({
        where: {
          id: normalizedCollectionJobId,
        },
        ...COLLECTION_JOB_PROMPT_QUERY,
      });

    if (!collectionJob) {
      throw new NotFoundException(
        'Collection job not found.',
      );
    }

    return collectionJob;
  }

  /**
   * Validates collection and NLP pipeline prerequisites.
   *
   * For direct unlock, collection-job ownership is also checked
   * against the authenticated requester when ownership exists.
   */
  private validateCollectionJob(
    collectionJob: CollectionJobPromptContext,
    input: PromptBuilderInput,
  ): void {
    if (
      collectionJob.status !==
      CollectionJobStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'Collection job must be completed before building an idea prompt.',
      );
    }

    if (!collectionJob.nlpAnalysis) {
      throw new BadRequestException(
        'NLP analysis is not ready yet.',
      );
    }

    if (
      input.purpose === 'IDEA_UNLOCK' &&
      collectionJob.createdById !== null &&
      collectionJob.createdById !==
      input.requesterUserId
    ) {
      throw new NotFoundException(
        'Collection job was not found for the requester.',
      );
    }
  }

  /**
   * Returns and validates the active existing idea for direct unlock.
   *
   * Requirements:
   * - The idea exists.
   * - The idea is not soft-deleted.
   * - The requester owns the idea.
   * - It belongs to the supplied collection job.
   * - It was generated as NORMAL_FREE.
   * - It is not already unlocked.
   */
  private async getExistingIdea(
    input: PromptBuilderInput,
  ): Promise<ExistingIdeaContext | null> {
    if (input.purpose !== 'IDEA_UNLOCK') {
      return null;
    }

    const idea =
      await this.prisma.idea.findFirst({
        where: {
          id: input.existingIdeaId,
          userId: input.requesterUserId,
          deletedAt: null,
        },
        select: EXISTING_IDEA_SELECT,
      });

    if (!idea) {
      throw new NotFoundException(
        'Existing idea was not found or does not belong to the requester.',
      );
    }

    if (
      idea.collectionJobId !==
      input.collectionJobId
    ) {
      throw new BadRequestException(
        'Idea does not belong to the provided collection job.',
      );
    }

    if (
      idea.generationType !==
      IdeaGenerationType.NORMAL_FREE
    ) {
      throw new BadRequestException(
        'Only registered free-tier ideas can be directly unlocked.',
      );
    }

    if (idea.isUnlocked) {
      throw new BadRequestException(
        'The idea is already unlocked.',
      );
    }

    return idea;
  }

  /**
   * Converts the input purpose into a persisted PromptType.
   */
  private getPromptType(
    input: PromptBuilderInput,
  ): PromptType {
    return input.purpose === 'IDEA_UNLOCK'
      ? PromptType.IDEA_UNLOCK
      : PromptType.IDEA_GENERATION;
  }

  /**
 * Selects the provider-neutral structured-output contract
 * according to the prompt purpose and generation access level.
 *
 * Rules:
 * - Direct unlock always uses the unlock output contract.
 * - Guest generation uses the guest output contract.
 * - Registered free generation uses the free output contract.
 * - Premium credit generation uses the premium output contract.
 *
 * Storing generationType in a local variable allows TypeScript
 * to narrow that value exhaustively inside the switch statement.
 *
 * @param input Type-safe prompt-building input.
 * @returns Structured-output contract permitted for the request.
 */
  private getOutputContract(
    input: PromptBuilderInput,
  ): OutputContract {
    if (input.purpose === 'IDEA_UNLOCK') {
      return {
        schemaName: 'nexora_idea_unlock',
        format: UNLOCK_OUTPUT_FORMAT,
        schema: UNLOCK_OUTPUT_SCHEMA,
      };
    }

    /**
     * At this point, input is narrowed to IdeaGenerationPromptInput,
     * so generationType is guaranteed to exist.
     */
    const generationType = input.generationType;

    switch (generationType) {
      case IdeaGenerationType.GUEST_FREE:
        return {
          schemaName: 'nexora_guest_idea',
          format: GUEST_OUTPUT_FORMAT,
          schema: GUEST_OUTPUT_SCHEMA,
        };

      case IdeaGenerationType.NORMAL_FREE:
        return {
          schemaName: 'nexora_free_idea',
          format: FREE_OUTPUT_FORMAT,
          schema: FREE_OUTPUT_SCHEMA,
        };

      case IdeaGenerationType.PREMIUM_CREDIT:
        return {
          schemaName: 'nexora_premium_idea',
          format: PREMIUM_OUTPUT_FORMAT,
          schema: PREMIUM_OUTPUT_SCHEMA,
        };

      default:
        return this.assertNever(generationType);
    }
  }

  /**
   * Enforces exhaustive IdeaGenerationType handling.
   */
  private assertNever(value: never): never {
    throw new BadRequestException(
      `Unsupported idea generation type: ${String(value)}`,
    );
  }

  /**
   * Formats the existing free-tier idea as context for unlock.
   */
  private formatExistingIdea(
    idea: ExistingIdeaContext | null,
  ): string {
    if (!idea) {
      return 'Not applicable. This is a new idea generation request.';
    }

    return this.compactPrompt(`
- Title: ${idea.title}
- Problem statement: ${idea.problemStatement ?? 'Not available'}
- Objectives: ${idea.objectives ?? 'Not available'}
- Target users: ${idea.targetUsers ?? 'Not available'}
- Limited abstract: ${idea.limitedAbstract ?? 'Not available'}
- Partial abstract: ${idea.partialAbstract ?? 'Not available'}
    `);
  }

  /**
   * Formats the DataSource records selected for collection.
   */
  private formatDataSources(
    collectionJob: CollectionJobPromptContext,
  ): string {
    if (collectionJob.sources.length === 0) {
      return 'Not specified';
    }

    return collectionJob.sources
      .map(({ dataSource }) => {
        const availability =
          dataSource.isActive &&
            dataSource.isImplemented
            ? 'available'
            : 'unavailable';

        return `${dataSource.displayName} (${dataSource.key}, ${availability})`;
      })
      .join(', ');
  }

  /**
   * Formats JSON values for readable prompt inclusion.
   */
  private formatJson(value: unknown): string {
    if (
      value === null ||
      value === undefined
    ) {
      return 'Not enough data';
    }

    if (
      Array.isArray(value) &&
      value.length === 0
    ) {
      return 'Not enough data';
    }

    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(
        value as Record<string, unknown>,
      ).length === 0
    ) {
      return 'Not enough data';
    }

    return JSON.stringify(value, null, 2);
  }

  /**
   * Removes excessive blank lines while preserving paragraphs.
   */
  private compactPrompt(prompt: string): string {
    return prompt
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Estimates rendered prompt input tokens.
   */
  private estimateApproximateInputTokens(
    text: string,
  ): number {
    const ratio =
      ARABIC_TEXT_PATTERN.test(text)
        ? ARABIC_TOKEN_RATIO
        : DEFAULT_TOKEN_RATIO;

    return Math.ceil(text.length / ratio);
  }

  /**
   * Creates the SHA-256 template-version hash.
   */
  private createTemplateHash(
    template: string,
  ): string {
    return createHash('sha256')
      .update(template)
      .digest('hex');
  }
}

