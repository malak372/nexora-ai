import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  PromptTemplateValues,
  REQUIRED_PROMPT_PLACEHOLDERS,
} from '../constants/prompt-placeholders.constant';

/**
 * Manages the configurable AI prompt template.
 *
 * Responsibilities:
 * - Return the active idea prompt template.
 * - Update the admin-configured idea prompt template.
 * - Validate required placeholders before saving.
 * - Render templates using placeholder values.
 *
 * @author Malak
 */
@Injectable()
export class PromptTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the currently active AI prompt template.
   */
  async getCurrentTemplate(): Promise<{ ideaPromptTemplate: string }> {
    const template = await this.getIdeaPromptTemplate();

    return {
      ideaPromptTemplate: template,
    };
  }

  /**
   * Updates the admin-configured AI prompt template.
   */
  async updateTemplate(
    ideaPromptTemplate: string,
    adminId?: string,
  ): Promise<{ ideaPromptTemplate: string }> {
    this.validateRequiredPlaceholders(ideaPromptTemplate);

    const settings = await this.prisma.systemSetting.findFirst();

    if (!settings) {
      throw new NotFoundException('System settings were not initialized.');
    }

    const updatedSettings = await this.prisma.systemSetting.update({
      where: {
        id: settings.id,
      },
      data: {
        ideaPromptTemplate,
        updatedById: adminId,
      },
      select: {
        ideaPromptTemplate: true,
      },
    });

    return {
      ideaPromptTemplate:
        updatedSettings.ideaPromptTemplate ??
        this.getDefaultIdeaPromptTemplate(),
    };
  }

  /**
   * Returns the configured idea prompt template or the default template.
   */
  async getIdeaPromptTemplate(): Promise<string> {
    const settings = await this.prisma.systemSetting.findFirst();

    const template =
      settings?.ideaPromptTemplate ?? this.getDefaultIdeaPromptTemplate();

    this.validateRequiredPlaceholders(template);

    return template;
  }

  /**
   * Renders a prompt template by replacing supported placeholders.
   */
  renderTemplate(template: string, values: PromptTemplateValues): string {
    const renderedTemplate = Object.entries(values).reduce(
      (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
      template,
    );

    this.validateNoUnresolvedPlaceholders(renderedTemplate);

    return renderedTemplate;
  }

  private validateRequiredPlaceholders(template: string): void {
    const missingPlaceholders = REQUIRED_PROMPT_PLACEHOLDERS.filter(
      (placeholder) => !template.includes(`{{${placeholder}}}`),
    );

    if (missingPlaceholders.length) {
      throw new BadRequestException(
        `Prompt template is missing required placeholders: ${missingPlaceholders.join(
          ', ',
        )}`,
      );
    }
  }

  private validateNoUnresolvedPlaceholders(renderedTemplate: string): void {
    const unresolvedPlaceholders =
      renderedTemplate.match(/{{\s*[\w]+\s*}}/g) ?? [];

    if (unresolvedPlaceholders.length) {
      throw new BadRequestException(
        `Prompt contains unresolved placeholders: ${unresolvedPlaceholders.join(
          ', ',
        )}`,
      );
    }
  }

  private getDefaultIdeaPromptTemplate(): string {
    return `
You are Nexora AI, an intelligent software project discovery and generation assistant.

Your task is to generate a practical software project idea based on real community feedback, collected posts, collected comments, and NLP analysis.

Access rules:
- Guest users receive only: title and limitedAbstract.
- Registered free users receive only: title, problemStatement, objectives, targetUsers, and partialAbstract.
- Direct unlock expands an existing free idea and returns advanced features only.
- Premium credit generation creates a new idea with all advanced features immediately.

Context:
- Domain: {{domain}}
- Country: {{country}}
- City: {{city}}
- Region: {{region}}
- Platforms: {{platforms}}
- Number of comments analyzed: {{commentsCount}}

NLP analysis:
- Sentiment statistics:
{{sentimentStats}}

- Keywords:
{{keywords}}

- Topics:
{{topics}}

- Recurring problems:
{{recurringProblems}}

- Extracted needs:
{{extractedNeeds}}

- Feature requests:
{{featureRequests}}

- Opportunities:
{{opportunities}}

- Additional insights:
{{insights}}

- Data quality:
{{dataQuality}}

Sample posts:
{{samplePosts}}

Sample comments:
{{sampleComments}}

Existing idea context:
{{existingIdea}}

Strict rules:
1. Use only the provided community feedback and NLP analysis as evidence.
2. Do not invent fake comments, fake numbers, fake statistics, fake sources, or fake citations.
3. Generate a practical software project suitable for software engineering students or developers.
4. Consider local context and high-level legal/regulatory constraints.
5. Keep recommendations realistic and implementation-oriented.
6. Return valid JSON only.
7. Do not include markdown.
8. Do not include fields outside the requested JSON format.
9. For Guest and Free users, do not reveal advanced features.
10. For direct unlock, expand the existing idea instead of generating a new unrelated idea.

Required JSON output format:
{{requestedOutputFormat}}
`;
  }
}