import { BadRequestException, Injectable } from '@nestjs/common';
import { IdeaGenerationType, PromptType } from '@prisma/client';

import { PromptTemplateService } from './prompt-template.service';
import { PromptBuilderInput } from '../types/prompt-builder-input.type';
import { PromptBuilderOutput } from '../types/prompt-builder-output.type';

/**
 * Service responsible for building AI-ready prompts.
 *
 * It takes structured project, NLP, and idea context,
 * injects them into the active prompt template, then returns
 * a compact prompt ready to be sent to the AI provider.
 *
 * @author Malak
 */
@Injectable()
export class PromptBuilderService {
  /**
   * Maximum number of sample comments included in the prompt
   * to avoid sending overly large AI requests.
   */
  private readonly maxSampleComments = 10;

  /**
   * Maximum length allowed for each sample comment.
   */
  private readonly maxCommentLength = 500;

  constructor(
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  /**
   * Builds a complete AI prompt based on the provided input.
   *
   * This method:
   * - validates required data
   * - loads the active prompt template
   * - replaces template placeholders
   * - compacts unnecessary blank lines
   * - estimates input token count
   *
   * @param input Structured data used to build the prompt.
   * @returns AI-ready prompt output.
   */
  async buildPrompt(input: PromptBuilderInput): Promise<PromptBuilderOutput> {
    this.validateInput(input);

    const template =
      await this.promptTemplateService.getIdeaGenerationTemplate();

    const promptText = this.replacePlaceholders(template, {
      domain: input.domainName,
      country: input.country ?? 'Not specified',
      city: input.city ?? 'Not specified',
      region: input.region ?? 'Not specified',
      platforms: this.formatInlineList(input.platforms ?? []),
      commentsCount: String(input.commentsCount ?? 0),
      sentimentStats: JSON.stringify(
        input.sentimentStats ?? { positive: 0, negative: 0, neutral: 0 },
        null,
        2,
      ),
      recurringProblems: this.toBulletList(input.recurringProblems ?? []),
      extractedNeeds: this.toBulletList(input.extractedNeeds ?? []),
      keywords: this.formatInlineList(input.keywords ?? []),
      topics: this.formatInlineList(input.topics ?? []),
      sampleComments: this.toNumberedList(input.sampleComments ?? []),
      existingIdea: this.formatExistingIdea(input),
      chatMessage: input.chatMessage ?? 'No chat message provided.',
      nlpText: input.nlpText ?? 'No raw NLP text provided.',
      requestedOutputFormat: this.getOutputFormat(input),
    });

    const compactedPrompt = this.compactPrompt(promptText);

    return {
      promptType: input.promptType,
      promptText: compactedPrompt,
      estimatedInputTokens: this.estimateTokens(compactedPrompt),
    };
  }

  /**
   * Validates required fields according to prompt type.
   *
   * This prevents sending incomplete or invalid prompts to the AI provider.
   */
  private validateInput(input: PromptBuilderInput): void {
    if (!input.domainName?.trim()) {
      throw new BadRequestException('Domain name is required to build prompt');
    }

    if (input.promptType === PromptType.IDEA_UNLOCK && !input.existingIdea) {
      throw new BadRequestException(
        'Existing idea context is required for idea unlock prompt',
      );
    }

    if (
      input.promptType === PromptType.CHAT_RESPONSE &&
      !input.chatMessage?.trim()
    ) {
      throw new BadRequestException(
        'Chat message is required for chat response prompt',
      );
    }

    if (
      input.promptType === PromptType.IDEA_GENERATION &&
      !input.generationType
    ) {
      throw new BadRequestException(
        'Generation type is required for idea generation prompt',
      );
    }
  }

  /**
   * Selects the required JSON output format based on prompt type.
   */
  private getOutputFormat(input: PromptBuilderInput): string {
    switch (input.promptType) {
      case PromptType.IDEA_UNLOCK:
        return this.getUnlockOutputFormat();

      case PromptType.CHAT_RESPONSE:
        return this.getChatOutputFormat();

      case PromptType.NLP_ANALYSIS:
        return this.getNlpOutputFormat();

      case PromptType.ABSTRACT_GENERATION:
        return this.getAbstractOutputFormat();

      case PromptType.IDEA_GENERATION:
      default:
        return this.getIdeaGenerationOutputFormat(input.generationType);
    }
  }

  /**
   * Returns the idea generation output format according to access level.
   */
  private getIdeaGenerationOutputFormat(
    generationType?: IdeaGenerationType,
  ): string {
    if (generationType === IdeaGenerationType.GUEST_FREE) {
      return `
{
  "title": "string",
  "limitedAbstract": "string"
}
`;
    }

    if (generationType === IdeaGenerationType.NORMAL_FREE) {
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

    return this.getPremiumOutputFormat();
  }

  /**
   * Returns the full premium output format.
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
  "commentAnalysisSummary": "string"
}
`;
  }

  /**
   * Returns the output format used when unlocking an existing idea.
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
  "commentAnalysisSummary": "string"
}
`;
  }

  /**
   * Returns the expected AI chat response format.
   */
  private getChatOutputFormat(): string {
    return `
{
  "answer": "string",
  "recommendations": ["string"],
  "nextSteps": ["string"]
}
`;
  }

  /**
   * Returns the expected NLP analysis response format.
   */
  private getNlpOutputFormat(): string {
    return `
{
  "sentimentStats": {
    "positive": 0,
    "negative": 0,
    "neutral": 0
  },
  "keywords": ["string"],
  "topics": ["string"],
  "recurringProblems": ["string"],
  "extractedNeeds": ["string"],
  "sampleComments": ["string"]
}
`;
  }

  /**
   * Returns the expected abstract generation response format.
   */
  private getAbstractOutputFormat(): string {
    return `
{
  "limitedAbstract": "string",
  "partialAbstract": "string",
  "fullAbstract": "string"
}
`;
  }

  /**
   * Formats existing idea data for inclusion in the prompt.
   */
  private formatExistingIdea(input: PromptBuilderInput): string {
    if (!input.existingIdea) {
      return 'No existing idea context.';
    }

    const idea = input.existingIdea;

    return this.compactPrompt(`
- Title: ${idea.title}
- Problem statement: ${idea.problemStatement ?? 'Not available'}
- Objectives: ${idea.objectives ?? 'Not available'}
- Target users: ${idea.targetUsers ?? 'Not available'}
- Limited abstract: ${idea.limitedAbstract ?? 'Not available'}
- Partial abstract: ${idea.partialAbstract ?? 'Not available'}
- Full abstract: ${idea.fullAbstract ?? 'Not available'}
`);
  }

  /**
   * Replaces all template placeholders with real values.
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
   * Converts list values into a bullet list.
   */
  private toBulletList(items: string[]): string {
    const cleanedItems = this.cleanList(items);

    if (!cleanedItems.length) {
      return '- Not enough data';
    }

    return cleanedItems.map((item) => `- ${item}`).join('\n');
  }

  /**
   * Converts list values into a numbered list.
   *
   * Used mainly for sample comments.
   */
  private toNumberedList(items: string[]): string {
    const cleanedItems = this.cleanList(items)
      .slice(0, this.maxSampleComments)
      .map((item) => this.truncate(item, this.maxCommentLength));

    if (!cleanedItems.length) {
      return 'No sample comments available.';
    }

    return cleanedItems
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n');
  }

  /**
   * Converts list values into one inline comma-separated string.
   */
  private formatInlineList(items: string[]): string {
    const cleanedItems = this.cleanList(items);

    return cleanedItems.length ? cleanedItems.join(', ') : 'Not enough data';
  }

  /**
   * Removes empty strings and trims extra spaces from list items.
   */
  private cleanList(items: string[]): string[] {
    return items
      .filter((item) => Boolean(item?.trim()))
      .map((item) => item.trim());
  }

  /**
   * Truncates long text values to keep prompts within a reasonable size.
   */
  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  /**
   * Removes excessive blank lines from the final prompt.
   */
  private compactPrompt(prompt: string): string {
    return prompt.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Estimates token count using a simple approximation.
   *
   * Average approximation: 1 token ≈ 4 characters.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}