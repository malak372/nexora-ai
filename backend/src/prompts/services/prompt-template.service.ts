import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

import {
  PromptPlaceholder,
  PromptTemplateValues,
  REQUIRED_PROMPT_PLACEHOLDERS,
} from '../constants/prompt-placeholders.constant';

import {
  GLOBAL_SYSTEM_SETTINGS_KEY,
  PROMPT_TEMPLATE_MAX_LENGTH,
  PROMPT_TEMPLATE_MIN_LENGTH,
} from '../constants/prompt.constants';

import { DEFAULT_IDEA_PROMPT_TEMPLATE } from '../templates/default-idea-prompt.template';

/**
 * Matches the supported prompt-placeholder syntax.
 *
 * Examples:
 * - {{domain}}
 * - {{sampleComments}}
 * - {{requestedOutputFormat}}
 */
const PROMPT_PLACEHOLDER_PATTERN = /{{([a-zA-Z0-9_]+)}}/g;

/**
 * Public response returned by the prompt-template endpoints.
 *
 * @author Malak
 */
export type PromptTemplateResponse = {
  /**
   * Currently active idea-generation prompt template.
   */
  readonly ideaPromptTemplate: string;
};

/**
 * Manages the configurable idea-generation prompt template.
 *
 * Responsibilities:
 * - Read the active prompt template.
 * - Fall back to the application default template.
 * - Normalize template input.
 * - Validate template length.
 * - Validate required placeholders.
 * - Reject unsupported placeholders.
 * - Render placeholder values.
 * - Update the template transactionally.
 * - Audit administrator template changes.
 *
 * Template validation always occurs before external values such as
 * posts, comments, NLP results, or existing idea content are inserted.
 *
 * @author Malak
 */
@Injectable()
export class PromptTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns the currently active idea-generation prompt template.
   */
  async getCurrentTemplate(): Promise<PromptTemplateResponse> {
    return {
      ideaPromptTemplate: await this.getIdeaPromptTemplate(),
    };
  }

  /**
   * Updates the global idea-generation prompt template.
   *
   * The template is:
   * 1. Trimmed.
   * 2. Validated.
   * 3. Compared with the current value.
   * 4. Persisted transactionally.
   * 5. Recorded in the administrator audit log.
   *
   * No database update or audit record is created when the submitted
   * template is identical to the currently active template.
   *
   * @param ideaPromptTemplate New configurable prompt template.
   * @param adminId Identifier of the administrator performing the update.
   */
  async updateTemplate(
    ideaPromptTemplate: string,
    adminId: string,
  ): Promise<PromptTemplateResponse> {
    const normalizedTemplate = ideaPromptTemplate.trim();

    this.validateTemplate(normalizedTemplate);

    return this.prisma.$transaction(async (tx) => {
      const settings = await tx.systemSetting.findUnique({
        where: {
          key: GLOBAL_SYSTEM_SETTINGS_KEY,
        },
      });

      if (!settings) {
        throw new NotFoundException('System settings were not initialized.');
      }

      const previousTemplate =
        settings.ideaPromptTemplate ?? DEFAULT_IDEA_PROMPT_TEMPLATE;

      /**
       * Avoid unnecessary database writes and audit records.
       */
      if (previousTemplate === normalizedTemplate) {
        return {
          ideaPromptTemplate: previousTemplate,
        };
      }

      const updatedSettings = await tx.systemSetting.update({
        where: {
          key: GLOBAL_SYSTEM_SETTINGS_KEY,
        },
        data: {
          ideaPromptTemplate: normalizedTemplate,
          updatedById: adminId,
        },
        select: {
          id: true,
          ideaPromptTemplate: true,
        },
      });

      await this.auditService.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_UPDATE_PROMPT,
          targetType: AuditTargetType.PROMPT,
          targetId: updatedSettings.id,

          oldValue: this.toAuditJson({
            ideaPromptTemplate: previousTemplate,
          }),

          newValue: this.toAuditJson({
            ideaPromptTemplate: normalizedTemplate,
          }),
        },
        tx,
      );

      return {
        ideaPromptTemplate:
          updatedSettings.ideaPromptTemplate ?? DEFAULT_IDEA_PROMPT_TEMPLATE,
      };
    });
  }

  /**
   * Returns the configured idea-generation prompt template.
   *
   * The application default is used when:
   * - The global SystemSetting record has no custom template.
   * - ideaPromptTemplate is null.
   *
   * The selected template is always validated before being returned.
   */
  async getIdeaPromptTemplate(): Promise<string> {
    const settings = await this.prisma.systemSetting.findUnique({
      where: {
        key: GLOBAL_SYSTEM_SETTINGS_KEY,
      },
      select: {
        ideaPromptTemplate: true,
      },
    });

    const template = (
      settings?.ideaPromptTemplate ?? DEFAULT_IDEA_PROMPT_TEMPLATE
    ).trim();

    this.validateTemplate(template);

    return template;
  }

  /**
   * Replaces every supported placeholder with its provided value.
   *
   * The original template is validated before external data is
   * inserted. This prevents placeholder-like content contained inside
   * posts, comments, NLP evidence, or existing ideas from being treated
   * as unresolved application placeholders.
   *
   * @param template Valid prompt template.
   * @param values Values required to render every placeholder.
   */
  renderTemplate(template: string, values: PromptTemplateValues): string {
    const normalizedTemplate = template.trim();

    this.validateTemplate(normalizedTemplate);

    return normalizedTemplate.replace(
      PROMPT_PLACEHOLDER_PATTERN,
      (_match: string, key: string) => {
        const placeholder = key as PromptPlaceholder;
        const value = values[placeholder];

        if (value === undefined) {
          throw new InternalServerErrorException(
            `No value was provided for prompt placeholder: ${key}`,
          );
        }

        return value;
      },
    );
  }

  /**
   * Runs all validations required for a configurable prompt template.
   */
  private validateTemplate(template: string): void {
    this.validateTemplateLength(template);
    this.validateRequiredPlaceholders(template);
    this.validateSupportedPlaceholders(template);
  }

  /**
   * Ensures that the template length remains within the configured
   * application limits.
   *
   * Validation is repeated inside the service because service methods
   * may be called internally without passing through an HTTP DTO.
   */
  private validateTemplateLength(template: string): void {
    if (
      template.length < PROMPT_TEMPLATE_MIN_LENGTH ||
      template.length > PROMPT_TEMPLATE_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `Prompt template length must be between ${PROMPT_TEMPLATE_MIN_LENGTH} and ${PROMPT_TEMPLATE_MAX_LENGTH} characters.`,
      );
    }
  }

  /**
   * Ensures that every placeholder required by PromptBuilderService
   * exists in the configurable template.
   */
  private validateRequiredPlaceholders(template: string): void {
    const missingPlaceholders = REQUIRED_PROMPT_PLACEHOLDERS.filter(
      (placeholder) => !template.includes(`{{${placeholder}}}`),
    );

    if (missingPlaceholders.length > 0) {
      throw new BadRequestException(
        `Prompt template is missing required placeholders: ${missingPlaceholders.join(
          ', ',
        )}`,
      );
    }
  }

  /**
   * Ensures that every placeholder declared inside the template
   * is supported by PromptBuilderService.
   *
   * Unsupported placeholders are rejected instead of being left
   * unresolved in the final AI prompt.
   */
  private validateSupportedPlaceholders(template: string): void {
    const placeholders = Array.from(
      template.matchAll(PROMPT_PLACEHOLDER_PATTERN),
      (match) => match[1],
    );

    const supportedPlaceholders = new Set<string>(REQUIRED_PROMPT_PLACEHOLDERS);

    const unsupportedPlaceholders = [
      ...new Set(
        placeholders.filter(
          (placeholder) => !supportedPlaceholders.has(placeholder),
        ),
      ),
    ];

    if (unsupportedPlaceholders.length > 0) {
      throw new BadRequestException(
        `Prompt template contains unsupported placeholders: ${unsupportedPlaceholders.join(
          ', ',
        )}`,
      );
    }
  }

  /**
   * Converts a JavaScript value into Prisma-compatible JSON.
   *
   * The conversion removes unsupported values such as undefined
   * before the value is passed to AuditService.
   */
  private toAuditJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
