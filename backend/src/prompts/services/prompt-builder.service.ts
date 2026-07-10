import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { createHash } from 'crypto';

import {
  CollectionJobStatus,
  Idea,
  IdeaGenerationType,
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
 * Approximate character-to-token ratio used when Arabic text
 * appears in a prompt.
 *
 * Arabic and mixed-language text commonly require more tokens per
 * character than English. This conservative ratio reduces the risk
 * of underestimating prompt size.
 *
 * This remains an approximation. Exact token usage must be obtained
 * later from the selected AI provider when available.
 */
const ARABIC_TOKEN_RATIO = 2.5;

/**
 * Matches Arabic Unicode characters commonly found in:
 * - Community posts.
 * - Community comments.
 * - NLP output.
 * - Existing idea content.
 */
const ARABIC_TEXT_PATTERN = /[\u0600-\u06FF]/;

/**
 * Internal structured-output contract selected according to:
 * - Prompt purpose.
 * - User generation level.
 */
type OutputContract = {
  /**
   * Stable provider-neutral name for the response schema.
   */
  readonly schemaName: string;

  /**
   * Human-readable JSON structure inserted into the prompt.
   */
  readonly format: string;

  /**
   * Provider-neutral JSON schema supplied to the AI adapter.
   */
  readonly schema: JsonSchema;
};

/**
 * Builds provider-neutral AI prompts from persisted application data.
 *
 * Reads:
 * - CollectionJob.
 * - Domain.
 * - NlpAnalysis.
 * - Existing Idea for unlock requests.
 *
 * Does not:
 * - Call an AI provider.
 * - Deduct credits.
 * - Process payments.
 * - Persist ideas.
 * - Persist prompt history.
 * - Execute NLP analysis.
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
   * Builds a complete provider-neutral idea prompt and its expected
   * structured-output contract.
   *
   * The collection job must:
   * - Exist.
   * - Be completed.
   * - Have a persisted NLP analysis.
   */
  async buildIdeaPrompt(
    input: PromptBuilderInput,
  ): Promise<PromptBuilderOutput> {
    const collectionJob = await this.prisma.collectionJob.findUnique({
      where: {
        id: input.collectionJobId,
      },
      include: {
        domain: true,
        nlpAnalysis: true,
      },
    });

    if (!collectionJob) {
      throw new NotFoundException('Collection job not found.');
    }

    if (collectionJob.status !== CollectionJobStatus.COMPLETED) {
      throw new BadRequestException(
        'Collection job must be completed before building an idea prompt.',
      );
    }

    if (!collectionJob.nlpAnalysis) {
      throw new BadRequestException('NLP analysis is not ready yet.');
    }

    /**
     * For new idea generation, this returns null.
     * For unlock requests, it verifies and returns the existing idea.
     */
    const existingIdea = await this.getExistingIdea(input);

    const template = await this.promptTemplateService.getIdeaPromptTemplate();

    const outputContract = this.getOutputContract(input);

    const renderedPrompt = this.promptTemplateService.renderTemplate(template, {
      domain: collectionJob.domain.name,

      country: collectionJob.country || 'Not specified',

      city: collectionJob.city || 'Not specified',

      region: collectionJob.region || 'Not specified',

      platforms: this.formatJsonArray(collectionJob.platforms),

      /**
       * Uses the number of comments actually analyzed by NLP,
       * not merely the number of collected comments.
       */
      commentsCount: String(collectionJob.nlpAnalysis.totalCommentsAnalyzed),

      sentimentStats: this.formatJson(collectionJob.nlpAnalysis.sentimentStats),

      keywords: this.formatJson(collectionJob.nlpAnalysis.keywords),

      topics: this.formatJson(collectionJob.nlpAnalysis.topics),

      recurringProblems: this.formatJson(
        collectionJob.nlpAnalysis.recurringProblems,
      ),

      extractedNeeds: this.formatJson(collectionJob.nlpAnalysis.extractedNeeds),

      featureRequests: this.formatJson(
        collectionJob.nlpAnalysis.featureRequests,
      ),

      opportunities: this.formatJson(collectionJob.nlpAnalysis.opportunities),

      insights: this.formatJson(collectionJob.nlpAnalysis.insights),

      dataQuality: this.formatJson(collectionJob.nlpAnalysis.dataQuality),

      samplePosts: this.formatJson(collectionJob.nlpAnalysis.samplePosts),

      sampleComments: this.formatJson(collectionJob.nlpAnalysis.sampleComments),

      existingIdea: this.formatExistingIdea(existingIdea),

      requestedOutputFormat: outputContract.format,
    });

    const compactPrompt = this.compactPrompt(renderedPrompt);

    return {
      promptType: this.getPromptType(input),

      promptText: compactPrompt,

      estimatedInputTokens: this.estimateApproximateInputTokens(compactPrompt),

      templateHash: this.createTemplateHash(template),

      responseSchemaName: outputContract.schemaName,

      responseSchema: outputContract.schema,
    };
  }

  /**
   * Returns and verifies the existing idea for direct-unlock requests.
   *
   * Ownership is verified here as defense in depth, even when
   * IdeasService already performs authorization before calling
   * PromptBuilderService.
   *
   * Unlock requirements:
   * - The idea must exist.
   * - The idea must belong to the requester.
   * - The idea must belong to the provided collection job.
   * - The idea must have been generated as NORMAL_FREE.
   * - The idea must not already be unlocked.
   */
  private async getExistingIdea(
    input: PromptBuilderInput,
  ): Promise<Idea | null> {
    if (input.purpose !== 'IDEA_UNLOCK') {
      return null;
    }

    const idea = await this.prisma.idea.findFirst({
      where: {
        id: input.existingIdeaId,
        userId: input.requesterUserId,
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Existing idea was not found or does not belong to the requester.',
      );
    }

    if (idea.collectionJobId !== input.collectionJobId) {
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
   * Converts the type-safe prompt purpose into the corresponding
   * Prisma PromptType value.
   */
  private getPromptType(input: PromptBuilderInput): PromptType {
    return input.purpose === 'IDEA_UNLOCK'
      ? PromptType.IDEA_UNLOCK
      : PromptType.IDEA_GENERATION;
  }

  /**
   * Selects the permitted output contract.
   *
   * Direct unlock always receives UNLOCK_OUTPUT_SCHEMA.
   *
   * New generation receives an output contract according to:
   * - GUEST_FREE.
   * - NORMAL_FREE.
   * - PREMIUM_CREDIT.
   *
   * The switch is exhaustive so a future generation type cannot
   * silently receive an incorrect access level.
   */
  private getOutputContract(input: PromptBuilderInput): OutputContract {
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
   * Produces a compile-time error when an IdeaGenerationType value
   * is not handled by getOutputContract().
   */
  private assertNever(value: never): never {
    throw new BadRequestException(
      `Unsupported idea generation type: ${String(value)}`,
    );
  }

  /**
   * Converts the existing free-tier idea into readable context
   * for a direct-unlock prompt.
   *
   * The AI must expand this idea instead of replacing it with
   * an unrelated project.
   */
  private formatExistingIdea(idea: Idea | null): string {
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
   * Formats a persisted JSON value for prompt readability.
   *
   * Missing values and empty arrays are represented explicitly
   * to prevent the AI from assuming that data was supplied.
   */
  private formatJson(value: unknown): string {
    if (value === null || value === undefined) {
      return 'Not enough data';
    }

    if (Array.isArray(value) && value.length === 0) {
      return 'Not enough data';
    }

    return JSON.stringify(value, null, 2);
  }

  /**
   * Formats the CollectionJob platforms JSON value.
   *
   * Array values are converted into a comma-separated list.
   * Other valid JSON values fall back to formatted JSON.
   */
  private formatJsonArray(value: unknown): string {
    if (value === null || value === undefined) {
      return 'Not specified';
    }

    if (Array.isArray(value)) {
      return value.length > 0 ? value.map(String).join(', ') : 'Not specified';
    }

    return this.formatJson(value);
  }

  /**
   * Removes excessive blank lines while preserving readable
   * paragraph separation.
   */
  private compactPrompt(prompt: string): string {
    return prompt.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Estimates the approximate number of input tokens.
   *
   * English-only content uses DEFAULT_TOKEN_RATIO.
   * Arabic or mixed-language content uses a more conservative ratio.
   *
   * This value is for:
   * - Preliminary cost estimation.
   * - Monitoring.
   * - Input-size protection.
   *
   * Provider-reported token usage remains the source of truth.
   */
  private estimateApproximateInputTokens(text: string): number {
    const ratio = ARABIC_TEXT_PATTERN.test(text)
      ? ARABIC_TOKEN_RATIO
      : DEFAULT_TOKEN_RATIO;

    return Math.ceil(text.length / ratio);
  }

  /**
   * Creates a stable SHA-256 hash identifying the source
   * prompt-template version.
   */
  private createTemplateHash(template: string): string {
    return createHash('sha256').update(template).digest('hex');
  }
}
