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

import {
  ARABIC_TOKEN_RATIO,
  DEFAULT_TOKEN_RATIO,
  MAX_PROMPT_DATA_SOURCES,
  MAX_RENDERED_PROMPT_LENGTH,
} from '../constants/prompt.constants';

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
 * Detects Arabic Unicode characters in rendered prompt content.
 */
const ARABIC_TEXT_PATTERN = /[\u0600-\u06ff]/;

/**
 * Provider-neutral structured-output contract selected according
 * to the generation access level and prompt purpose.
 */
type OutputContract = {
  /**
   * Stable schema name passed to the AI provider adapter.
   */
  readonly schemaName: string;

  /**
   * Human-readable JSON example inserted into the prompt.
   */
  readonly format: string;

  /**
   * Provider-neutral structured-output schema.
   */
  readonly schema: JsonSchema;
};

/**
 * Prisma query used to retrieve the exact CollectionJob context
 * required to generate an AI prompt.
 *
 * Platforms are resolved through:
 *
 * CollectionJob
 * → CollectionJobSource
 * → DataSource
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
 * CollectionJob result inferred directly from the Prisma query.
 */
type CollectionJobPromptContext = Prisma.CollectionJobGetPayload<
  typeof COLLECTION_JOB_PROMPT_QUERY
>;

/**
 * Existing Idea fields required for direct-unlock prompt context.
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
 * Existing Idea context inferred directly from Prisma.
 */
type ExistingIdeaContext = Prisma.IdeaGetPayload<{
  select: typeof EXISTING_IDEA_SELECT;
}>;

/**
 * Builds provider-neutral prompts from persisted collection and
 * NLP pipeline results.
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
 * - Validate collection and NLP prerequisites.
 * - Validate direct-unlock ownership and eligibility.
 * - Resolve the correct structured-output contract.
 * - Render the configurable prompt template.
 * - Protect against unexpectedly large rendered prompts.
 * - Estimate prompt input-token usage.
 * - Calculate the source-template SHA-256 hash.
 *
 * This service does not:
 * - Start data collection.
 * - Execute NLP analysis.
 * - Persist PromptHistory.
 * - Call an AI provider.
 * - Create or update an Idea.
 * - Deduct credits.
 * - Process payments.
 *
 * @author Malak
 */
@Injectable()
export class PromptBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  /**
   * Builds one complete idea-generation or direct-unlock prompt.
   *
   * Requirements:
   * - CollectionJob exists.
   * - CollectionJob status is COMPLETED.
   * - NlpAnalysis exists.
   * - Direct unlock references an eligible active Idea.
   *
   * @param input Type-safe prompt-building request.
   * @returns Rendered prompt and provider-neutral response contract.
   */
  async buildIdeaPrompt(
    input: PromptBuilderInput,
  ): Promise<PromptBuilderOutput> {
    const collectionJob = await this.getCollectionJobContext(
      input.collectionJobId,
    );

    this.validateCollectionJob(collectionJob, input);

    const existingIdea = await this.getExistingIdea(input);

    const template =
      await this.promptTemplateService.getIdeaPromptTemplate();

    const outputContract = this.getOutputContract(input);

    const renderedPrompt = this.promptTemplateService.renderTemplate(
      template,
      {
        domain: collectionJob.domain.name,

        country: this.normalizeLocation(collectionJob.country),

        city: this.normalizeLocation(collectionJob.city),

        region: this.normalizeLocation(collectionJob.region),

        platforms: this.formatDataSources(collectionJob),

        commentsCount: String(
          collectionJob.nlpAnalysis!.totalCommentsAnalyzed,
        ),

        sentimentStats: this.wrapUntrustedData(
          'sentiment_statistics',
          this.formatJson(collectionJob.nlpAnalysis!.sentimentStats),
        ),

        keywords: this.wrapUntrustedData(
          'extracted_keywords',
          this.formatJson(collectionJob.nlpAnalysis!.keywords),
        ),

        topics: this.wrapUntrustedData(
          'detected_topics',
          this.formatJson(collectionJob.nlpAnalysis!.topics),
        ),

        recurringProblems: this.wrapUntrustedData(
          'recurring_problems',
          this.formatJson(
            collectionJob.nlpAnalysis!.recurringProblems,
          ),
        ),

        extractedNeeds: this.wrapUntrustedData(
          'extracted_needs',
          this.formatJson(collectionJob.nlpAnalysis!.extractedNeeds),
        ),

        featureRequests: this.wrapUntrustedData(
          'feature_requests',
          this.formatJson(collectionJob.nlpAnalysis!.featureRequests),
        ),

        opportunities: this.wrapUntrustedData(
          'potential_opportunities',
          this.formatJson(collectionJob.nlpAnalysis!.opportunities),
        ),

        insights: this.wrapUntrustedData(
          'additional_insights',
          this.formatJson(collectionJob.nlpAnalysis!.insights),
        ),

        dataQuality: this.wrapUntrustedData(
          'data_quality',
          this.formatJson(collectionJob.nlpAnalysis!.dataQuality),
        ),

        samplePosts: this.wrapUntrustedData(
          'sample_posts',
          this.formatJson(collectionJob.nlpAnalysis!.samplePosts),
        ),

        sampleComments: this.wrapUntrustedData(
          'sample_comments',
          this.formatJson(collectionJob.nlpAnalysis!.sampleComments),
        ),

        existingIdea: this.wrapUntrustedData(
          'existing_idea',
          this.formatExistingIdea(existingIdea),
        ),

        requestedOutputFormat: outputContract.format,
      },
    );

    const compactPrompt = this.compactPrompt(renderedPrompt);

    this.validateRenderedPromptLength(compactPrompt);

    return {
      promptType: this.getPromptType(input),

      promptText: compactPrompt,

      estimatedInputTokens:
        this.estimateApproximateInputTokens(compactPrompt),

      templateHash: this.createTemplateHash(template),

      responseSchemaName: outputContract.schemaName,

      responseSchema: outputContract.schema,
    };
  }

  /**
   * Retrieves persisted CollectionJob, Domain, DataSource, and
   * NlpAnalysis context.
   *
   * @param collectionJobId CollectionJob identifier.
   * @returns Complete prompt-building context.
   */
  private async getCollectionJobContext(
    collectionJobId: string,
  ): Promise<CollectionJobPromptContext> {
    const normalizedCollectionJobId = this.requireIdentifier(
      collectionJobId,
      'Collection job ID',
    );

    const collectionJob = await this.prisma.collectionJob.findUnique({
      where: {
        id: normalizedCollectionJobId,
      },

      ...COLLECTION_JOB_PROMPT_QUERY,
    });

    if (!collectionJob) {
      throw new NotFoundException('Collection job not found.');
    }

    return collectionJob;
  }

  /**
   * Validates collection and NLP pipeline prerequisites.
   *
   * For direct unlock, CollectionJob ownership is checked against
   * the authenticated requester when the job has an owner.
   *
   * @param collectionJob Persisted collection context.
   * @param input Prompt-building input.
   */
  private validateCollectionJob(
    collectionJob: CollectionJobPromptContext,
    input: PromptBuilderInput,
  ): void {
    if (collectionJob.status !== CollectionJobStatus.COMPLETED) {
      throw new BadRequestException(
        'Collection job must be completed before building an idea prompt.',
      );
    }

    if (!collectionJob.nlpAnalysis) {
      throw new BadRequestException('NLP analysis is not ready yet.');
    }

    if (
      input.purpose === 'IDEA_UNLOCK' &&
      collectionJob.createdById !== null &&
      collectionJob.createdById !== input.requesterUserId
    ) {
      /*
       * NotFoundException avoids revealing that another user's
       * CollectionJob exists.
       */
      throw new NotFoundException(
        'Collection job was not found for the requester.',
      );
    }
  }

  /**
   * Returns and validates the existing Idea used for direct unlock.
   *
   * Requirements:
   * - The Idea exists.
   * - The Idea is not soft-deleted.
   * - The requester owns the Idea.
   * - The Idea belongs to the supplied CollectionJob.
   * - The Idea was generated as NORMAL_FREE.
   * - The Idea is not already unlocked.
   *
   * @param input Prompt-building input.
   * @returns Existing Idea context or null for new generation.
   */
  private async getExistingIdea(
    input: PromptBuilderInput,
  ): Promise<ExistingIdeaContext | null> {
    if (input.purpose !== 'IDEA_UNLOCK') {
      return null;
    }

    const normalizedIdeaId = this.requireIdentifier(
      input.existingIdeaId,
      'Existing idea ID',
    );

    const normalizedRequesterId = this.requireIdentifier(
      input.requesterUserId,
      'Requester user ID',
    );

    const normalizedCollectionJobId = this.requireIdentifier(
      input.collectionJobId,
      'Collection job ID',
    );

    const idea = await this.prisma.idea.findFirst({
      where: {
        id: normalizedIdeaId,
        userId: normalizedRequesterId,
        deletedAt: null,
      },

      select: EXISTING_IDEA_SELECT,
    });

    if (!idea) {
      throw new NotFoundException(
        'Existing idea was not found or does not belong to the requester.',
      );
    }

    if (idea.collectionJobId !== normalizedCollectionJobId) {
      throw new BadRequestException(
        'Idea does not belong to the provided collection job.',
      );
    }

    if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
      throw new BadRequestException(
        'Only registered free-tier ideas can be directly unlocked.',
      );
    }

    if (idea.isUnlocked) {
      throw new BadRequestException('The idea is already unlocked.');
    }

    return idea;
  }

  /**
   * Converts the prompt-building purpose into the persisted
   * PromptType enum.
   *
   * @param input Prompt-building input.
   * @returns PromptType used by PromptHistory.
   */
  private getPromptType(input: PromptBuilderInput): PromptType {
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
   *
   * @param value Unexpected unhandled value.
   */
  private assertNever(value: never): never {
    throw new BadRequestException(
      `Unsupported idea generation type: ${String(value)}`,
    );
  }

  /**
   * Formats the existing free-tier Idea as direct-unlock context.
   *
   * objectives and targetUsers are stored as String values in the
   * current Prisma schema. They may contain JSON-encoded arrays or
   * legacy plain-text values, so both formats are supported.
   *
   * @param idea Existing Idea or null for new generation.
   */
  private formatExistingIdea(
    idea: ExistingIdeaContext | null,
  ): string {
    if (!idea) {
      return 'Not applicable. This is a new idea generation request.';
    }

    return this.compactPrompt(`
Title:
${idea.title}

Problem statement:
${idea.problemStatement ?? 'Not available'}

Objectives:
${this.formatStoredStringArray(idea.objectives)}

Target users:
${this.formatStoredStringArray(idea.targetUsers)}

Limited abstract:
${idea.limitedAbstract ?? 'Not available'}

Partial abstract:
${idea.partialAbstract ?? 'Not available'}
    `);
  }

  /**
   * Formats a String database value that may contain:
   * - A JSON-encoded array of strings.
   * - A legacy plain-text value.
   * - null.
   *
   * @param value Stored database value.
   */
  private formatStoredStringArray(value: string | null): string {
    if (!value?.trim()) {
      return 'Not available';
    }

    const normalizedValue = value.trim();

    try {
      const parsedValue: unknown = JSON.parse(normalizedValue);

      if (Array.isArray(parsedValue)) {
        const items = parsedValue
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .map((item) => `- ${item.trim()}`);

        return items.length > 0
          ? items.join('\n')
          : 'Not available';
      }
    } catch {
      /*
       * A legacy plain-text value is still valid and should be
       * included without failing prompt generation.
       */
    }

    return normalizedValue;
  }

  /**
   * Formats the DataSource records selected for collection.
   *
   * @param collectionJob CollectionJob prompt context.
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
          dataSource.isActive && dataSource.isImplemented
            ? 'available'
            : 'unavailable';

        return `${dataSource.displayName} (${dataSource.key}, ${availability})`;
      })
      .join(', ');
  }

  /**
   * Formats nullable JSON-like values for readable prompt inclusion.
   *
   * Empty values are represented consistently to prevent the model
   * from assuming that missing evidence exists.
   *
   * @param value Persisted JSON-like value.
   */
  private formatJson(value: unknown): string {
    if (value === null || value === undefined) {
      return 'Not enough data';
    }

    if (Array.isArray(value) && value.length === 0) {
      return 'Not enough data';
    }

    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length === 0
    ) {
      return 'Not enough data';
    }

    return JSON.stringify(value, null, 2);
  }

  /**
   * Wraps external or generated context inside explicit boundaries.
   *
   * These boundaries help distinguish trusted application
   * instructions from untrusted posts, comments, NLP content, and
   * previously generated Idea values.
   *
   * @param label Stable boundary label.
   * @param value Untrusted data content.
   */
  private wrapUntrustedData(label: string, value: string): string {
    return `<untrusted_${label}>
${value}
</untrusted_${label}>`;
  }

  /**
   * Normalizes optional location values.
   *
   * @param value Country, city, or region value.
   */
  private normalizeLocation(value: string | null): string {
    return value?.trim() || 'Not specified';
  }

  /**
   * Removes excessive blank lines while preserving paragraph
   * separation.
   *
   * @param prompt Prompt content.
   */
  private compactPrompt(prompt: string): string {
    return prompt.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Rejects a rendered prompt that exceeds the application limit.
   *
   * The correct long-term solution for oversized prompts is to
   * reduce or summarize the supplied evidence before this stage,
   * rather than silently truncating arbitrary prompt content.
   *
   * @param prompt Complete rendered prompt.
   */
  private validateRenderedPromptLength(prompt: string): void {
    if (prompt.length > MAX_RENDERED_PROMPT_LENGTH) {
      throw new BadRequestException(
        `Rendered prompt exceeds the maximum supported length of ${MAX_RENDERED_PROMPT_LENGTH} characters.`,
      );
    }
  }

  /**
   * Estimates rendered prompt input-token usage.
   *
   * This is an approximation only. The provider-reported usage
   * stored in ExternalApiLog remains the final source of truth.
   *
   * @param text Complete rendered prompt.
   */
  private estimateApproximateInputTokens(text: string): number {
    const ratio = ARABIC_TEXT_PATTERN.test(text)
      ? ARABIC_TOKEN_RATIO
      : DEFAULT_TOKEN_RATIO;

    return Math.ceil(text.length / ratio);
  }

  /**
   * Creates the SHA-256 hash identifying the source-template
   * version used to generate the prompt.
   *
   * @param template Original configurable template.
   */
  private createTemplateHash(template: string): string {
    return createHash('sha256').update(template).digest('hex');
  }

  /**
   * Normalizes and validates a required identifier.
   *
   * @param value Identifier value.
   * @param fieldName Human-readable field name.
   */
  private requireIdentifier(
    value: string,
    fieldName: string,
  ): string {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} is required.`);
    }

    return normalizedValue;
  }
}