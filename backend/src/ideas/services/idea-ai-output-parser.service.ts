import { BadRequestException, Injectable } from '@nestjs/common';

import { IdeaGenerationType } from '@prisma/client';

import type {
  FreeIdeaAiOutput,
  GuestIdeaAiOutput,
  IdeaAiOutput,
  PremiumIdeaAiOutput,
} from '../types/idea-ai-output.type';

/**
 * Parses and normalizes schema-validated AI idea output.
 *
 * AiExecutionService already validates JSON against the response
 * schema. This parser adds a business-level validation boundary
 * before generated content enters persistence.
 *
 * @author Malak
 */
@Injectable()
export class IdeaAiOutputParserService {
  /**
   * Parses one AI response according to its generation type.
   */
  parse(text: string, generationType: IdeaGenerationType): IdeaAiOutput {
    let value: unknown;

    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new BadRequestException(
        'AI idea output could not be parsed as JSON.',
      );
    }

    if (!this.isRecord(value)) {
      throw new BadRequestException('AI idea output must be a JSON object.');
    }

    switch (generationType) {
      case IdeaGenerationType.GUEST_FREE:
        return this.parseGuest(value);

      case IdeaGenerationType.NORMAL_FREE:
        return this.parseFree(value);

      case IdeaGenerationType.PREMIUM_CREDIT:
        return this.parsePremium(value);

      default:
        return this.assertNever(generationType);
    }
  }

  /**
   * Parses guest output.
   *
   * Registered-user fields are stored internally but are not exposed
   * through the public guest-generation response.
   */
  private parseGuest(value: Record<string, unknown>): GuestIdeaAiOutput {
    return {
      title: this.requireString(value, 'title'),

      limitedAbstract: this.requireString(value, 'limitedAbstract'),

      problemStatement: this.requireString(value, 'problemStatement'),

      objectives: this.requireString(value, 'objectives'),

      targetUsers: this.requireString(value, 'targetUsers'),

      partialAbstract: this.requireString(value, 'partialAbstract'),
    };
  }

  /**
   * Parses registered free-tier output.
   */
  private parseFree(value: Record<string, unknown>): FreeIdeaAiOutput {
    return {
      title: this.requireString(value, 'title'),

      problemStatement: this.requireString(value, 'problemStatement'),

      objectives: this.requireString(value, 'objectives'),

      targetUsers: this.requireString(value, 'targetUsers'),

      partialAbstract: this.requireString(value, 'partialAbstract'),
    };
  }

  /**
   * Parses premium credit output.
   */
  private parsePremium(value: Record<string, unknown>): PremiumIdeaAiOutput {
    return {
      title: this.requireString(value, 'title'),

      problemStatement: this.requireString(value, 'problemStatement'),

      objectives: this.requireString(value, 'objectives'),

      targetUsers: this.requireString(value, 'targetUsers'),

      fullAbstract: this.requireString(value, 'fullAbstract'),

      technologyStack: this.requireStringArray(value, 'technologyStack'),

      systemArchitecture: this.requireString(value, 'systemArchitecture'),

      databaseDesign: this.requireString(value, 'databaseDesign'),

      businessModel: this.requireString(value, 'businessModel'),

      valueProposition: this.requireString(value, 'valueProposition'),

      revenueModel: this.requireString(value, 'revenueModel'),

      localRegulations: this.requireString(value, 'localRegulations'),

      budgetEstimation: this.requireString(value, 'budgetEstimation'),

      feasibilityAssessment: this.requireString(value, 'feasibilityAssessment'),

      implementationTimeline: this.requireString(
        value,
        'implementationTimeline',
      ),

      marketPotential: this.requireString(value, 'marketPotential'),

      nlpExecutiveSummary: this.requireString(value, 'nlpExecutiveSummary'),

      communityFeedbackSummary: this.requireString(
        value,
        'communityFeedbackSummary',
      ),
    };
  }

  /**
   * Reads and normalizes one required non-empty string.
   */
  private requireString(value: Record<string, unknown>, key: string): string {
    const result = value[key];

    if (typeof result !== 'string' || result.trim().length === 0) {
      throw new BadRequestException(
        `AI idea output field "${key}" must be a non-empty string.`,
      );
    }

    return result.trim();
  }

  /**
   * Reads and normalizes an array of non-empty strings.
   *
   * Each item remains `unknown` until explicitly type-checked,
   * preventing unsafe any operations under strict ESLint rules.
   */
  private requireStringArray(
    value: Record<string, unknown>,
    key: string,
  ): string[] {
    const result = value[key];

    if (!Array.isArray(result)) {
      throw new BadRequestException(
        `AI idea output field "${key}" must be a non-empty string array.`,
      );
    }

    const items: readonly unknown[] = result as readonly unknown[];

    if (items.length === 0) {
      throw new BadRequestException(
        `AI idea output field "${key}" must be a non-empty string array.`,
      );
    }

    const normalizedItems: string[] = [];

    for (const item of items) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        throw new BadRequestException(
          `AI idea output field "${key}" must contain only non-empty strings.`,
        );
      }

      normalizedItems.push(item.trim());
    }

    return normalizedItems;
  }

  /**
   * Checks whether a value is a non-null plain object.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private assertNever(value: never): never {
    throw new BadRequestException(
      `Unsupported idea generation type: ${String(value)}.`,
    );
  }
}
