import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Idea, IdeaGenerationType, PromptType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { PromptTemplateService } from './prompt-template.service';
import { PromptBuilderInput } from '../types/prompt-builder-input.type';
import { PromptBuilderOutput } from '../types/prompt-builder-output.type';
import { DEFAULT_TOKEN_RATIO } from '../constants/prompt.constants';
import {
  FREE_OUTPUT_FORMAT,
  GUEST_OUTPUT_FORMAT,
  PREMIUM_OUTPUT_FORMAT,
  UNLOCK_OUTPUT_FORMAT,
} from '../output-formats';

/**
 * Builds AI prompts from database records.
 *
 * This service reads:
 * - CollectionJob
 * - Domain
 * - NlpAnalysis
 * - Existing Idea when unlocking
 *
 * It does not:
 * - Call OpenAI
 * - Save ideas
 * - Save prompt history
 * - Deduct credits
 * - Process payments
 * - Run NLP analysis
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
   * Builds a final AI prompt for idea generation or idea unlock.
   */
  async buildIdeaPrompt(
    input: PromptBuilderInput,
  ): Promise<PromptBuilderOutput> {
    this.validateInput(input);

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

    if (!collectionJob.nlpAnalysis) {
      throw new BadRequestException('NLP analysis is not ready yet.');
    }

    const existingIdea = await this.getExistingIdea(input);
    const template = await this.promptTemplateService.getIdeaPromptTemplate();

    const renderedPrompt = this.promptTemplateService.renderTemplate(template, {
      domain: collectionJob.domain.name,
      country: collectionJob.country ?? 'Not specified',
      city: collectionJob.city ?? 'Not specified',
      region: collectionJob.region ?? 'Not specified',
      platforms: this.formatJsonArray(collectionJob.platforms),
      commentsCount: String(collectionJob.totalComments),

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
      requestedOutputFormat: this.getRequestedOutputFormat(input),
    });

    const compactPrompt = this.compactPrompt(renderedPrompt);

    this.validateRenderedPrompt(compactPrompt);

    return {
      promptType: this.getPromptType(input),
      promptText: compactPrompt,
      estimatedInputTokens:
        this.estimateApproximateInputTokens(compactPrompt),
      templateHash: this.createTemplateHash(template),
    };
  }

  /**
   * Validates prompt builder input before reading from database.
   */
  private validateInput(input: PromptBuilderInput): void {
    if (input.purpose === 'IDEA_UNLOCK' && !input.existingIdeaId) {
      throw new BadRequestException(
        'existingIdeaId is required for idea unlock prompts.',
      );
    }
  }

  /**
   * Returns the existing idea when building unlock prompts.
   */
  private async getExistingIdea(
    input: PromptBuilderInput,
  ): Promise<Idea | null> {
    if (input.purpose !== 'IDEA_UNLOCK') {
      return null;
    }

    const idea = await this.prisma.idea.findUnique({
      where: {
        id: input.existingIdeaId,
      },
    });

    if (!idea) {
      throw new NotFoundException('Existing idea not found.');
    }

    if (idea.collectionJobId !== input.collectionJobId) {
      throw new BadRequestException(
        'Idea does not belong to the provided collection job.',
      );
    }

    return idea;
  }

  /**
   * Converts prompt purpose to Prisma PromptType.
   */
  private getPromptType(input: PromptBuilderInput): PromptType {
    return input.purpose === 'IDEA_UNLOCK'
      ? PromptType.IDEA_UNLOCK
      : PromptType.IDEA_GENERATION;
  }

  /**
   * Selects the required AI JSON output format based on access level.
   */
  private getRequestedOutputFormat(input: PromptBuilderInput): string {
    if (input.purpose === 'IDEA_UNLOCK') {
      return UNLOCK_OUTPUT_FORMAT;
    }

    if (input.generationType === IdeaGenerationType.GUEST_FREE) {
      return GUEST_OUTPUT_FORMAT;
    }

    if (input.generationType === IdeaGenerationType.NORMAL_FREE) {
      return FREE_OUTPUT_FORMAT;
    }

    return PREMIUM_OUTPUT_FORMAT;
  }

  /**
   * Formats existing idea data for direct unlock prompts.
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
   * Ensures that no unresolved placeholders remain in the final prompt.
   */
  private validateRenderedPrompt(prompt: string): void {
    const unresolvedPlaceholders = prompt.match(/{{\s*[\w]+\s*}}/g);

    if (unresolvedPlaceholders?.length) {
      throw new InternalServerErrorException(
        `Prompt contains unresolved placeholders: ${unresolvedPlaceholders.join(
          ', ',
        )}`,
      );
    }
  }

  /**
   * Formats any JSON value for prompt readability.
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
   * Formats JSON array values stored in Prisma Json fields.
   */
  private formatJsonArray(value: unknown): string {
    if (!value) {
      return 'Not specified';
    }

    if (Array.isArray(value)) {
      return value.length ? value.join(', ') : 'Not specified';
    }

    return this.formatJson(value);
  }

  /**
   * Removes excessive blank lines.
   */
  private compactPrompt(prompt: string): string {
    return prompt.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Estimates input tokens approximately.
   */
  private estimateApproximateInputTokens(text: string): number {
    return Math.ceil(text.length / DEFAULT_TOKEN_RATIO);
  }

  /**
   * Creates a stable SHA-256 hash for the template version used.
   */
  private createTemplateHash(template: string): string {
    return createHash('sha256').update(template).digest('hex');
  }
}