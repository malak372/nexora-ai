import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for managing the AI prompt template used
 * by the Prompt Builder.
 *
 * It allows the system to:
 * - retrieve the current idea generation template
 * - return a safe default template when no custom template exists
 * - allow admins to update the template
 * - audit admin prompt updates
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
   * Returns the active idea generation prompt template.
   *
   * If no template is stored in system settings, the default template
   * is returned instead.
   */
  async getIdeaGenerationTemplate(): Promise<string> {
    const settings = await this.prisma.systemSetting.findFirst();

    return settings?.ideaPromptTemplate ?? this.getDefaultIdeaGenerationTemplate();
  }

  /**
   * Returns the current prompt template metadata.
   *
   * This is mainly used by admin screens to display:
   * - the active template
   * - last update date
   * - admin who updated it
   * - whether the template is the default one
   */
  async getCurrentTemplate() {
    const settings = await this.prisma.systemSetting.findFirst();

    return {
      ideaPromptTemplate:
        settings?.ideaPromptTemplate ?? this.getDefaultIdeaGenerationTemplate(),
      updatedAt: settings?.updatedAt ?? null,
      updatedById: settings?.updatedById ?? null,
      isDefault: !settings?.ideaPromptTemplate,
    };
  }

  /**
   * Updates the idea generation prompt template.
   *
   * The update is stored in system settings and recorded in audit logs
   * so admin changes remain traceable.
   *
   * @param adminId ID of the admin performing the update.
   * @param ideaPromptTemplate New prompt template content.
   */
  async updateTemplate(adminId: string, ideaPromptTemplate: string) {
    const currentSettings = await this.findOrCreateSettings();

    const updated = await this.prisma.systemSetting.update({
      where: {
        id: currentSettings.id,
      },
      data: {
        ideaPromptTemplate,
        updatedById: adminId,
      },
    });

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_UPDATE_PROMPT,
      targetType: AuditTargetType.PROMPT,
      targetId: updated.id,
      oldValue: {
        ideaPromptTemplate: currentSettings.ideaPromptTemplate,
      } as Prisma.InputJsonValue,
      newValue: {
        ideaPromptTemplate: updated.ideaPromptTemplate,
      } as Prisma.InputJsonValue,
    });

    return updated;
  }

  /**
   * Finds the existing system settings row.
   *
   * If the row does not exist, it creates one with safe default values.
   * This prevents prompt operations from failing on a fresh database.
   */
  private async findOrCreateSettings() {
    const settings = await this.prisma.systemSetting.findFirst();

    if (settings) {
      return settings;
    }

    return this.prisma.systemSetting.create({
      data: {
        creditPrice: 15,
        bonusThreshold: 0,
        bonusCredits: 0,
        ideaPromptTemplate: this.getDefaultIdeaGenerationTemplate(),
      },
    });
  }

  /**
   * Default idea generation prompt template.
   *
   * Placeholders such as {{domain}}, {{country}}, and {{sampleComments}}
   * are replaced by the Prompt Builder before sending the final prompt
   * to the AI provider.
   */
  private getDefaultIdeaGenerationTemplate(): string {
    return `
You are Nexora AI, an intelligent software project discovery assistant.

Generate a practical software project idea based on real community feedback.

Context:
- Domain: {{domain}}
- Country: {{country}}
- City: {{city}}
- Region: {{region}}
- Platforms: {{platforms}}
- Comments analyzed: {{commentsCount}}

NLP Insights:
- Sentiment: {{sentimentStats}}
- Recurring problems: {{recurringProblems}}
- User needs: {{extractedNeeds}}
- Keywords: {{keywords}}
- Topics: {{topics}}

Existing idea context:
{{existingIdea}}

Sample community comments:
{{sampleComments}}

User chat message:
{{chatMessage}}

Raw NLP text:
{{nlpText}}

Rules:
1. Use the provided community feedback as evidence.
2. Do not invent fake comments, fake statistics, or fake sources.
3. Generate a practical software project suitable for students or developers.
4. Consider local context and high-level regulatory constraints.
5. Return valid JSON only.
6. Do not include markdown.
7. Output must match the requested format exactly.

Required output:
{{requestedOutputFormat}}
`;
  }
}