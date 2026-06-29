import { Injectable } from '@nestjs/common';
import { AdminAction, AdminTargetType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Service responsible for managing the AI prompt template.
 *
 * Provides:
 * - Retrieving the current AI prompt template.
 * - Updating the prompt template used during idea generation.
 * - Creating default system settings if none exist.
 * - Recording audit logs when the prompt template is updated.
 *
 * @author Malak
 */
@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Retrieves the latest system settings record.
   *
   * If no settings record exists, a default configuration is created.
   */
  private async getSystemSettings() {
    let settings = await this.prisma.systemSetting.findFirst({
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!settings) {
      settings = await this.prisma.systemSetting.create({
        data: {
          creditPrice: 15,
          bonusThreshold: 0,
          bonusCredits: 0,
          ideaPromptTemplate: null,
        },
      });
    }

    return settings;
  }

  /**
   * Retrieves the current AI prompt template.
   *
   * Endpoint:
   * GET /admin/prompts
   */
  async getPrompt() {
    const settings = await this.getSystemSettings();

    return {
      id: settings.id,
      ideaPromptTemplate: settings.ideaPromptTemplate,
      updatedAt: settings.updatedAt,
    };
  }

  /**
   * Updates the AI prompt template and records the change in audit logs.
   *
   * Endpoint:
   * PATCH /admin/prompts
   */
  async updatePrompt(body: UpdatePromptDto, adminId: string) {
    const settings = await this.getSystemSettings();

    const oldPrompt = settings.ideaPromptTemplate;
    const newPrompt = body.ideaPromptTemplate.trim();

    if (oldPrompt === newPrompt) {
      return {
        message: 'No changes detected',
        settings: {
          id: settings.id,
          ideaPromptTemplate: settings.ideaPromptTemplate,
          updatedAt: settings.updatedAt,
        },
        updated: false,
      };
    }

    const updatedSettings = await this.prisma.systemSetting.update({
      where: {
        id: settings.id,
      },
      data: {
        ideaPromptTemplate: newPrompt,
        updatedById: adminId,
      },
      select: {
        id: true,
        ideaPromptTemplate: true,
        updatedAt: true,
        updatedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_UPDATE_PROMPT,
      targetType: AdminTargetType.PROMPT,
      targetId: updatedSettings.id,
      oldValue: {
        ideaPromptTemplate: oldPrompt,
      },
      newValue: {
        ideaPromptTemplate: updatedSettings.ideaPromptTemplate,
      },
    });

    return {
      message: 'Prompt template updated successfully',
      settings: updatedSettings,
      updated: true,
    };
  }
}