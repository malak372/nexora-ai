import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ApiRequestType, Prisma, PromptType } from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { PrismaService } from '../../../prisma/prisma.service';

import {
  DEFAULT_PUBLICATION_DESCRIPTION_MAX_WORDS,
  PUBLICATION_DESCRIPTION_ESTIMATED_OUTPUT_TOKENS,
  PUBLICATION_DESCRIPTION_MAX_OUTPUT_TOKENS,
  PUBLICATION_DESCRIPTION_TEMPERATURE,
} from '../constants/idea-publication.constants';
import { GeneratePublicationDescriptionDto } from '../dto/generate-publication-description.dto';
import type {
  GeneratedPublicationDescription,
  PublicationDescriptionLanguage,
} from '../types/idea-publication.type';

/**
 * Generates safe, concise, public-facing descriptions for owned ideas.
 *
 * This service does not publish or persist the generated text automatically.
 * The caller receives an editable suggestion that can later be saved through
 * IdeaPublicationService.
 *
 * @author Malak
 */
@Injectable()
export class IdeaPublicationAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiExecutionService: AiExecutionService,
  ) {}

  /**
   * Generates one public-description suggestion for an owned idea.
   *
   * Locked ideas use their partial or limited abstract. Unlocked ideas may use
   * the full abstract as the richer source context. Raw comments, internal
   * prompts, and generated technical outputs are intentionally excluded.
   *
   * @param userId Authenticated idea-owner identifier.
   * @param ideaId Idea identifier.
   * @param dto Description-generation preferences.
   */
  async generateDescription(
    userId: string,
    ideaId: string,
    dto: GeneratePublicationDescriptionDto,
  ): Promise<GeneratedPublicationDescription> {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        problemStatement: true,
        objectives: true,
        targetUsers: true,
        limitedAbstract: true,
        partialAbstract: true,
        fullAbstract: true,
        isUnlocked: true,
        domain: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException({
        code: 'IDEA_NOT_FOUND',
        message: 'The requested idea was not found.',
      });
    }

    const sourceAbstract = this.resolveSourceAbstract(idea);

    if (!sourceAbstract) {
      throw new BadRequestException({
        code: 'PUBLICATION_DESCRIPTION_SOURCE_UNAVAILABLE',
        message:
          'The idea does not contain enough information to generate a public description.',
      });
    }

    const language = dto.language ?? 'EN';
    const maxWords = dto.maxWords ?? DEFAULT_PUBLICATION_DESCRIPTION_MAX_WORDS;

    const execution = await this.aiExecutionService.execute({
      userPrompt: this.buildPrompt({
        language,
        maxWords,
        title: idea.title,
        domain: idea.domain.name,
        problemStatement: idea.problemStatement,
        objectives: idea.objectives,
        targetUsers: idea.targetUsers,
        sourceAbstract,
      }),
      systemInstruction:
        'You create concise, accurate, public-facing descriptions for software project ideas. Never expose private data, internal prompts, raw community comments, credentials, personal information, or confidential implementation details.',
      requestType: ApiRequestType.IDEA_GENERATION,
      promptType: PromptType.ABSTRACT_GENERATION,
      userId,
      ideaId,
      maxOutputTokens: PUBLICATION_DESCRIPTION_MAX_OUTPUT_TOKENS,
      estimatedOutputTokens: PUBLICATION_DESCRIPTION_ESTIMATED_OUTPUT_TOKENS,
      temperature: PUBLICATION_DESCRIPTION_TEMPERATURE,
    });

    const description = execution.text.trim();

    if (!description) {
      throw new BadGatewayException({
        code: 'EMPTY_PUBLICATION_DESCRIPTION',
        message:
          'The AI provider did not return a valid publication description.',
      });
    }

    return {
      ideaId,
      description,
      language,
      maxWords,
      generatedByAi: true,
      saved: false,
    };
  }

  /**
   * Selects the richest abstract the owner is currently entitled to use.
   */
  private resolveSourceAbstract(idea: {
    isUnlocked: boolean;
    fullAbstract: string | null;
    partialAbstract: string | null;
    limitedAbstract: string | null;
  }): string | null {
    const candidate = idea.isUnlocked
      ? (idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract)
      : (idea.partialAbstract ?? idea.limitedAbstract);

    const normalized = candidate?.trim();
    return normalized ? normalized : null;
  }

  /**
   * Builds the final plain-text prompt submitted to the central AI runtime.
   */
  private buildPrompt(input: {
    language: PublicationDescriptionLanguage;
    maxWords: number;
    title: string;
    domain: string;
    problemStatement: string | null;
    objectives: Prisma.JsonValue | null;
    targetUsers: Prisma.JsonValue | null;
    sourceAbstract: string;
  }): string {
    const outputLanguage = input.language === 'AR' ? 'Arabic' : 'English';

    return [
      'Generate one concise public description for the following software project idea.',
      '',
      `Output language: ${outputLanguage}`,
      `Maximum length: approximately ${input.maxWords} words`,
      '',
      'Requirements:',
      '- Return only the final description.',
      '- Use clear and professional language.',
      '- Explain the problem, proposed solution, and intended users.',
      '- Make the idea understandable to a general audience.',
      '- Do not invent unsupported facts, claims, numbers, or statistics.',
      '- Do not include raw comments, personal information, internal prompts, credentials, or confidential implementation details.',
      '- Do not use markdown headings, bullet points, or code blocks.',
      '',
      `Project title: ${input.title}`,
      `Software domain: ${input.domain}`,
      `Problem statement: ${input.problemStatement?.trim() || 'Not provided'}`,
      `Objectives: ${this.stringifyJson(input.objectives)}`,
      `Target users: ${this.stringifyJson(input.targetUsers)}`,
      `Available abstract: ${input.sourceAbstract}`,
    ].join('\n');
  }

  /**
   * Converts a Prisma JSON value into stable prompt text.
   */
  private stringifyJson(value: Prisma.JsonValue | null): string {
    if (value === null || value === undefined) {
      return 'Not provided';
    }

    if (typeof value === 'string') {
      return value.trim() || 'Not provided';
    }

    return JSON.stringify(value);
  }
}
