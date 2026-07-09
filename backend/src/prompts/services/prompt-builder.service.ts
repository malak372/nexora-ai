import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Idea, IdeaGenerationType, PromptType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { PromptTemplateService } from './prompt-template.service';
import { PromptBuilderInput } from '../types/prompt-builder-input.type';
import { PromptBuilderOutput } from '../types/prompt-builder-output.type';

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
 * - Deduct credits
 * - Process payments
 * - Run NLP analysis
 *
 * This keeps the database as the single source of truth.
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

    const promptText = this.replacePlaceholders(template, {
      domain: collectionJob.domain.name,
      country: collectionJob.country ?? 'Not specified',
      city: collectionJob.city ?? 'Not specified',
      region: collectionJob.region ?? 'Not specified',
      platforms: this.formatJsonArray(collectionJob.platforms),
      commentsCount: String(collectionJob.totalComments),

      sentimentStats: this.formatJson(
        collectionJob.nlpAnalysis.sentimentStats,
      ),
      keywords: this.formatJson(collectionJob.nlpAnalysis.keywords),
      topics: this.formatJson(collectionJob.nlpAnalysis.topics),
      recurringProblems: this.formatJson(
        collectionJob.nlpAnalysis.recurringProblems,
      ),
      extractedNeeds: this.formatJson(
        collectionJob.nlpAnalysis.extractedNeeds,
      ),

      featureRequests: this.formatFromStatistics(
        collectionJob.nlpAnalysis.statistics,
        'featureRequests',
      ),
      opportunities: this.formatFromStatistics(
        collectionJob.nlpAnalysis.statistics,
        'opportunities',
      ),
      insights: this.formatFromStatistics(
        collectionJob.nlpAnalysis.statistics,
        'insights',
      ),
      samplePosts: this.formatFromStatistics(
        collectionJob.nlpAnalysis.statistics,
        'samplePosts',
      ),

      sampleComments: this.formatJson(
        collectionJob.nlpAnalysis.sampleComments,
      ),
      existingIdea: this.formatExistingIdea(existingIdea),
      requestedOutputFormat: this.getRequestedOutputFormat(input),
    });

    const compactPrompt = this.compactPrompt(promptText);

    return {
      promptType: this.getPromptType(input),
      promptText: compactPrompt,
      estimatedInputTokens: this.estimateTokens(compactPrompt),
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
      return this.getUnlockOutputFormat();
    }

    if (input.generationType === IdeaGenerationType.GUEST_FREE) {
      return this.getGuestOutputFormat();
    }

    if (input.generationType === IdeaGenerationType.NORMAL_FREE) {
      return this.getFreeUserOutputFormat();
    }

    return this.getPremiumOutputFormat();
  }

  /**
   * Guest output format.
   */
  private getGuestOutputFormat(): string {
    return `
{
  "title": "string",
  "limitedAbstract": "string"
}
`;
  }

  /**
   * Registered free user output format.
   */
  private getFreeUserOutputFormat(): string {
    return `
{
  "title": "string",
  "problemStatement": "string",
  "objectives": "string",
  "targetUsers": "string",
  "partialAbstract": "string"
}
`;
  }

  /**
   * Direct unlock output format.
   *
   * Used only for an already generated free idea.
   */
  private getUnlockOutputFormat(): string {
    return `
{
  "fullAbstract": "string",
  "technologyStack": "string",
  "systemArchitecture": "string",
  "databaseDesign": "string",
  "businessModel": "string",
  "revenueModel": "string",
  "budgetEstimation": "string",
  "implementationTimeline": "string",
  "feasibilityAssessment": "string",
  "marketPotential": "string",
  "localRegulations": "string",
  "valueProposition": "string",
  "nlpAnalysis": "string",
  "commentAnalysisSummary": "string",
  "recurringProblems": ["string"],
  "extractedKeywords": ["string"],
  "sampleComments": ["string"],
  "commentsCount": number
}
`;
  }

  /**
   * Premium credit output format.
   *
   * Used when one credit is consumed to generate a new complete idea.
   */
  private getPremiumOutputFormat(): string {
    return `
{
  "title": "string",
  "problemStatement": "string",
  "objectives": "string",
  "targetUsers": "string",
  "fullAbstract": "string",
  "technologyStack": "string",
  "systemArchitecture": "string",
  "databaseDesign": "string",
  "businessModel": "string",
  "revenueModel": "string",
  "budgetEstimation": "string",
  "implementationTimeline": "string",
  "feasibilityAssessment": "string",
  "marketPotential": "string",
  "localRegulations": "string",
  "valueProposition": "string",
  "nlpAnalysis": "string",
  "commentAnalysisSummary": "string",
  "recurringProblems": ["string"],
  "extractedKeywords": ["string"],
  "sampleComments": ["string"],
  "commentsCount": number
}
`;
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
   * Replaces all placeholders in the template.
   */
  private replacePlaceholders(
    template: string,
    values: Record<string, string>,
  ): string {
    return Object.entries(values).reduce((result, [key, value]) => {
      return result.replaceAll(`{{${key}}}`, value);
    }, template);
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
   * Reads optional nested data from NlpAnalysis.statistics.
   */
  private formatFromStatistics(
    statistics: unknown,
    key: string,
  ): string {
    if (
      !statistics ||
      typeof statistics !== 'object' ||
      Array.isArray(statistics)
    ) {
      return 'Not enough data';
    }

    const record = statistics as Record<string, unknown>;

    return this.formatJson(record[key]);
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
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}