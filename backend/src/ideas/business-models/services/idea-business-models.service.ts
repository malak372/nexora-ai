import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AiRoutingStrategy,
  ApiRequestType,
  Prisma,
  PromptType,
} from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { BusinessModelTemplatesService } from '../../../business-model-templates/services/business-model-templates.service';
import { PrismaService } from '../../../prisma/prisma.service';

import { GenerateIdeaBusinessModelDto } from '../dto/generate-idea-business-model.dto';

/**
 * One normalized section key required by a business-model template.
 */
type TemplateSectionKey = string;

/**
 * Generates and versions business models after idea generation completes.
 *
 * Responsibilities:
 * - Validate permanent advanced access to the source idea.
 * - Require the idea to be unlocked, regardless of the user's current
 *   NORMAL or PREMIUM account status.
 * - Validate the selected active template.
 * - Generate structured content matching the template sections.
 * - Preserve old versions when the current user changes the template.
 * - Keep exactly one current version per idea and user.
 *
 * This service does not participate in the original idea-generation
 * pipeline. Template selection always happens after the idea exists.
 *
 * @author Malak
 */
@Injectable()
export class IdeaBusinessModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiExecutionService: AiExecutionService,
    private readonly businessModelTemplatesService: BusinessModelTemplatesService,
  ) {}

  /**
   * Generates a new current business-model version for an accessible advanced idea.
   *
   * Reusing the same template is allowed and creates a newer version.
   * Selecting a different template also creates a newer version while
   * retaining the complete history.
   */
  async generate(
    userId: string,
    ideaId: string,
    dto: GenerateIdeaBusinessModelDto,
  ) {
    const [idea, template] = await Promise.all([
      this.findAccessibleIdea(userId, ideaId),
      this.prisma.businessModelTemplate.findFirst({
        where: {
          id: dto.businessModelTemplateId,
          isActive: true,
        },
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          sections: true,
          promptGuidance: true,
        },
      }),
    ]);

    if (!template) {
      throw new NotFoundException(
        'The selected business-model template was not found or is inactive.',
      );
    }

    const sectionKeys = this.resolveSectionKeys(template.sections);

    if (sectionKeys.length === 0) {
      throw new BadRequestException(
        'The selected business-model template has no valid sections.',
      );
    }

    const execution = await this.aiExecutionService.execute({
      userPrompt: this.buildPrompt({
        idea,
        template,
        sectionKeys,
      }),
      systemInstruction:
        'You generate evidence-grounded software business models. Return only one valid JSON object containing exactly the requested section keys. Do not return Markdown, commentary, or additional keys.',
      requestType: ApiRequestType.IDEA_GENERATION,
      promptType: PromptType.IDEA_GENERATION,
      userId,
      ideaId,
      maxOutputTokens: 3000,
      estimatedOutputTokens: 1800,
      temperature: 0.35,
      strategy: AiRoutingStrategy.BALANCED,
    });

    const content = this.parseAndValidateContent(execution.text, sectionKeys);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const latest = await tx.ideaBusinessModel.findFirst({
            where: {
              ideaId,
              userId,
            },
            orderBy: { version: 'desc' },
            select: { version: true },
          });

          await tx.ideaBusinessModel.updateMany({
            where: {
              ideaId,
              userId,
              isCurrent: true,
            },
            data: {
              isCurrent: false,
            },
          });

          return tx.ideaBusinessModel.create({
            data: {
              ideaId,
              userId,
              businessModelTemplateId: template.id,
              content,
              version: (latest?.version ?? 0) + 1,
              isCurrent: true,
            },
            select: this.businessModelSelect,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        throw new ConflictException(
          'Another business-model generation completed concurrently. Retry the request.',
        );
      }

      throw error;
    }
  }

  /** Returns the current business model for an accessible advanced idea. */
  async findCurrent(userId: string, ideaId: string) {
    await this.findAccessibleIdea(userId, ideaId);

    const businessModel = await this.prisma.ideaBusinessModel.findFirst({
      where: {
        ideaId,
        userId,
        isCurrent: true,
      },
      select: this.businessModelSelect,
    });

    if (!businessModel) {
      throw new NotFoundException(
        'No business model has been generated for this idea yet.',
      );
    }

    return businessModel;
  }

  /** Returns all preserved business-model versions for an accessible advanced idea. */
  async findHistory(userId: string, ideaId: string) {
    await this.findAccessibleIdea(userId, ideaId);

    return this.prisma.ideaBusinessModel.findMany({
      where: {
        ideaId,
        userId,
      },
      orderBy: { version: 'desc' },
      select: this.businessModelSelect,
    });
  }

  /**
   * Renders the current generated business model as a standalone HTML file.
   *
   * Ownership and permanent unlocked access are validated before the current
   * version is loaded. The local template renderer escapes all dynamic values.
   */
  async renderCurrentHtml(
    userId: string,
    ideaId: string,
  ): Promise<{
    fileName: string;
    html: string;
  }> {
    const idea = await this.findAccessibleIdea(userId, ideaId);

    const current = await this.prisma.ideaBusinessModel.findFirst({
      where: {
        ideaId,
        userId,
        isCurrent: true,
      },
      select: {
        content: true,
        businessModelTemplate: {
          select: {
            key: true,
          },
        },
      },
    });

    if (!current) {
      throw new NotFoundException(
        'No business model has been generated for this idea yet.',
      );
    }

    return this.businessModelTemplatesService.renderCompletedHtml({
      templateKey: current.businessModelTemplate.key,
      ideaTitle: idea.title,
      content: current.content,
    });
  }

  /**
   * Ensures the current user has permanent advanced access to the source idea.
   *
   * Access paths:
   * - owner: own unlocked idea;
   * - accepted user: publication acceptance with advancedUnlockedAt set.
   *
   * This intentionally does NOT depend on the current NORMAL/PREMIUM account
   * status. Once advanced access was purchased/unlocked, Business Model remains
   * available permanently.
   */
  private async findAccessibleIdea(userId: string, ideaId: string) {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        deletedAt: null,
        OR: [
          {
            userId,
            isUnlocked: true,
          },
          {
            publication: {
              acceptances: {
                some: {
                  userId,
                  advancedUnlockedAt: {
                    not: null,
                  },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        problemStatement: true,
        objectives: true,
        targetUsers: true,
        fullAbstract: true,
        partialAbstract: true,
        limitedAbstract: true,
        domain: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'The idea was not found or advanced access is not available for this user.',
      );
    }

    return idea;
  }

  /** Converts template JSON into a stable ordered list of section keys. */
  private resolveSectionKeys(sections: Prisma.JsonValue): TemplateSectionKey[] {
    if (!Array.isArray(sections)) {
      return [];
    }

    const keys = sections
      .map((section): string | null => {
        if (typeof section === 'string') {
          return section.trim();
        }

        if (section && typeof section === 'object' && !Array.isArray(section)) {
          const key = section.key;
          return typeof key === 'string' ? key.trim() : null;
        }

        return null;
      })
      .filter((key): key is string => Boolean(key));

    return [...new Set(keys)];
  }

  /** Builds a template-specific prompt from persisted idea information. */
  private buildPrompt(input: {
    idea: {
      title: string;
      problemStatement: string | null;
      objectives: Prisma.JsonValue | null;
      targetUsers: Prisma.JsonValue | null;
      fullAbstract: string | null;
      partialAbstract: string | null;
      limitedAbstract: string | null;
      domain: { name: string };
    };
    template: {
      name: string;
      description: string | null;
      promptGuidance: Prisma.JsonValue | null;
    };
    sectionKeys: readonly string[];
  }): string {
    const abstract =
      input.idea.fullAbstract ??
      input.idea.partialAbstract ??
      input.idea.limitedAbstract ??
      'Not provided';

    return [
      'Generate a complete business model for the following existing software idea.',
      '',
      `Template: ${input.template.name}`,
      `Template description: ${input.template.description ?? 'Not provided'}`,
      `Required JSON keys in this exact order: ${input.sectionKeys.join(', ')}`,
      `Template guidance: ${this.stringifyJson(input.template.promptGuidance)}`,
      '',
      'Output requirements:',
      '- Return only one valid JSON object.',
      '- Include exactly the required keys and no additional keys.',
      '- Every value must be a clear, detailed, non-empty string.',
      '- Base every section on the supplied idea information.',
      '- Do not invent unsupported market statistics, legal claims, or financial guarantees.',
      '- Do not include Markdown fences.',
      '',
      `Idea title: ${input.idea.title}`,
      `Domain: ${input.idea.domain.name}`,
      `Problem statement: ${input.idea.problemStatement ?? 'Not provided'}`,
      `Objectives: ${this.stringifyJson(input.idea.objectives)}`,
      `Target users: ${this.stringifyJson(input.idea.targetUsers)}`,
      `Abstract: ${abstract}`,
    ].join('\n');
  }

  /** Parses provider text and enforces the selected template contract. */
  private parseAndValidateContent(
    rawText: string,
    sectionKeys: readonly string[],
  ): Prisma.InputJsonObject {
    const normalized = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let parsed: unknown;

    try {
      parsed = JSON.parse(normalized);
    } catch (error) {
      throw new BadGatewayException(
        'The AI provider returned an invalid business-model JSON response.',
        { cause: error },
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadGatewayException(
        'The AI provider returned an invalid business-model structure.',
      );
    }

    const record = parsed as Record<string, unknown>;
    const returnedEntries = Object.entries(record);

    if (returnedEntries.length !== sectionKeys.length) {
      throw new BadGatewayException(
        'The generated business model does not match the selected template sections.',
      );
    }

    const normalizedReturnedKeys = new Map<string, string>();

    for (const [returnedKey] of returnedEntries) {
      const normalized = this.normalizeSectionKey(returnedKey);

      if (normalizedReturnedKeys.has(normalized)) {
        throw new BadGatewayException(
          'The generated business model contains duplicate section keys.',
        );
      }

      normalizedReturnedKeys.set(normalized, returnedKey);
    }

    const content: Record<string, Prisma.InputJsonValue> = {};

    for (const key of sectionKeys) {
      const exactValue = record[key];
      const returnedKey = normalizedReturnedKeys.get(
        this.normalizeSectionKey(key),
      );
      const value = exactValue ?? (returnedKey ? record[returnedKey] : undefined);

      if (typeof value !== 'string' || value.trim().length < 10) {
        throw new BadGatewayException(
          `The generated business-model section "${key}" is invalid or missing.`,
        );
      }

      content[key] = value.trim();
    }

    return content;
  }


  /** Normalizes provider section keys so harmless casing/separator differences are accepted. */
  private normalizeSectionKey(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  /** Converts nullable Prisma JSON into stable prompt text. */
  private stringifyJson(value: Prisma.JsonValue | null): string {
    if (value === null || value === undefined) {
      return 'Not provided';
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  /** Safe API projection for one generated business-model version. */
  private readonly businessModelSelect = {
    id: true,
    ideaId: true,
    userId: true,
    version: true,
    isCurrent: true,
    content: true,
    createdAt: true,
    updatedAt: true,
    businessModelTemplate: {
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        sections: true,
      },
    },
  } satisfies Prisma.IdeaBusinessModelSelect;
}