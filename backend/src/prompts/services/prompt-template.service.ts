import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

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
 * Public response returned by prompt-template endpoints.
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
 * - Reject duplicated required placeholders.
 * - Render placeholder values.
 * - Update the template transactionally.
 * - Audit administrator template changes.
 *
 * Template validation occurs before external values such as posts,
 * comments, NLP results, or existing Idea content are inserted.
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
   * @param adminId Administrator performing the update.
   */
  async updateTemplate(
    ideaPromptTemplate: string,
    adminId: string,
  ): Promise<PromptTemplateResponse> {
    const normalizedTemplate = ideaPromptTemplate.trim();

    const normalizedAdminId = adminId.trim();

    if (!normalizedAdminId) {
      throw new BadRequestException(
        'Administrator ID is required.',
      );
    }

    this.validateTemplate(normalizedTemplate);

    return this.prisma.$transaction(async (tx) => {
      const settings = await tx.systemSetting.findUnique({
        where: {
          key: GLOBAL_SYSTEM_SETTINGS_KEY,
        },
      });

      if (!settings) {
        throw new NotFoundException(
          'System settings were not initialized.',
        );
      }

      const previousTemplate = (
        settings.ideaPromptTemplate ??
        DEFAULT_IDEA_PROMPT_TEMPLATE
      ).trim();

      /*
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
          updatedById: normalizedAdminId,
        },

        select: {
          id: true,
          ideaPromptTemplate: true,
        },
      });

      await this.auditService.createLog(
        {
          actorId: normalizedAdminId,
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
          updatedSettings.ideaPromptTemplate ??
          DEFAULT_IDEA_PROMPT_TEMPLATE,
      };
    });
  }

  /**
   * Returns the configured idea-generation prompt template.
   *
   * The application default is used when:
   * - The global SystemSetting record does not exist yet.
   * - The record has no custom ideaPromptTemplate.
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
      settings?.ideaPromptTemplate ??
      DEFAULT_IDEA_PROMPT_TEMPLATE
    ).trim();

    this.validateTemplate(template);

    return template;
  }

  /**
   * Replaces every supported placeholder with its supplied value.
   *
   * The original template is validated before external data is
   * inserted. This prevents placeholder-like content contained in
   * posts, comments, NLP evidence, or existing Ideas from being
   * treated as unresolved application placeholders.
   *
   * @param template Valid prompt template.
   * @param values Values required to render all placeholders.
   */
  renderTemplate(
    template: string,
    values: PromptTemplateValues,
  ): string {
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
   * Runs all validations required for a configurable prompt
   * template.
   *
   * @param template Normalized template.
   */
  private validateTemplate(template: string): void {
    this.validateTemplateLength(template);

    const placeholders =
      this.extractTemplatePlaceholders(template);

    this.validateRequiredPlaceholders(placeholders);

    this.validateSupportedPlaceholders(placeholders);

    this.validateDuplicatePlaceholders(placeholders);
  }

  /**
   * Ensures the template length remains within configured limits.
   *
   * Validation is repeated inside the service because service
   * methods may be called internally without an HTTP DTO.
   *
   * @param template Normalized template.
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
   * Extracts all declared placeholder names from the template.
   *
   * @param template Prompt template.
   */
  private extractTemplatePlaceholders(
    template: string,
  ): string[] {
    return Array.from(
      template.matchAll(PROMPT_PLACEHOLDER_PATTERN),
      (match) => match[1],
    );
  }

  /**
   * Ensures every placeholder required by PromptBuilderService
   * exists in the configurable template.
   *
   * @param placeholders Extracted template placeholders.
   */
  private validateRequiredPlaceholders(
    placeholders: readonly string[],
  ): void {
    const placeholderSet = new Set(placeholders);

    const missingPlaceholders =
      REQUIRED_PROMPT_PLACEHOLDERS.filter(
        (placeholder) => !placeholderSet.has(placeholder),
      );

    if (missingPlaceholders.length > 0) {
      throw new BadRequestException(
        `Prompt template is missing required placeholders: ${missingPlaceholders.join(', ')}`,
      );
    }
  }

  /**
   * Ensures every declared placeholder is supported by
   * PromptBuilderService.
   *
   * Unsupported placeholders are rejected instead of being left
   * unresolved in the final AI prompt.
   *
   * @param placeholders Extracted template placeholders.
   */
  private validateSupportedPlaceholders(
    placeholders: readonly string[],
  ): void {
    const supportedPlaceholders = new Set<string>(
      REQUIRED_PROMPT_PLACEHOLDERS,
    );

    const unsupportedPlaceholders = [
      ...new Set(
        placeholders.filter(
          (placeholder) =>
            !supportedPlaceholders.has(placeholder),
        ),
      ),
    ];

    if (unsupportedPlaceholders.length > 0) {
      throw new BadRequestException(
        `Prompt template contains unsupported placeholders: ${unsupportedPlaceholders.join(', ')}`,
      );
    }
  }

  /**
   * Ensures each required placeholder appears exactly once.
   *
   * Repeated placeholders can accidentally duplicate large NLP or
   * community datasets and significantly increase token usage.
   *
   * @param placeholders Extracted template placeholders.
   */
  private validateDuplicatePlaceholders(
    placeholders: readonly string[],
  ): void {
    const counts = new Map<string, number>();

    for (const placeholder of placeholders) {
      counts.set(
        placeholder,
        (counts.get(placeholder) ?? 0) + 1,
      );
    }

    const duplicatedPlaceholders = [
      ...counts.entries(),
    ]
      .filter(([, count]) => count > 1)
      .map(([placeholder]) => placeholder);

    if (duplicatedPlaceholders.length > 0) {
      throw new BadRequestException(
        `Prompt template contains duplicated placeholders: ${duplicatedPlaceholders.join(', ')}`,
      );
    }
  }

  /**
   * Converts a JavaScript value into Prisma-compatible JSON.
   *
   * JSON serialization removes unsupported values such as undefined
   * before the value is passed to AuditService.
   *
   * @param value Audit value.
   */
  private toAuditJson(
    value: unknown,
  ): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value),
    ) as Prisma.InputJsonValue;
  }
}