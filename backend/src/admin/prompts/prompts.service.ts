import { Injectable } from '@nestjs/common';
import { AdminAction, AdminTargetType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Service responsible for managing the AI prompt template.
 *
 * This service allows administrators to:
 * - Retrieve the current AI prompt template.
 * - Update the prompt template used during idea generation.
 * - Record audit logs when the prompt template is updated.
 *
 * The prompt template is stored within the SystemSetting table
 * to ensure a single configurable prompt is used throughout
 * the application.
 *
 * If no system settings record exists, a default one is created
 * automatically.
 *
 * @author Malak
 */
@Injectable()
export class PromptsService {
  /**
   * Creates an instance of PromptsService.
   *
   * @param prisma - Prisma service used to access the database.
   * @param auditLogsService - Service used to record sensitive admin actions.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }

  /**
   * Retrieves the current system settings.
   *
   * If no settings record exists, a default configuration is created
   * automatically, including an empty AI prompt template.
   *
   * @returns The current system settings.
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
   * This method does not create an audit log because it is
   * a read-only operation.
   *
   * @returns The current prompt template.
   */
  async getPrompt() {
    const settings = await this.getSystemSettings();

    return {
      ideaPromptTemplate: settings.ideaPromptTemplate,
    };
  }

  /**
   * Updates the AI prompt template.
   *
   * The old prompt and the new prompt are recorded in audit logs
   * for traceability and accountability.
   *
   * @param body - DTO containing the updated prompt template.
   * @param adminId - ID of the authenticated administrator.
   * @returns A success message and the updated prompt settings.
   */
  async updatePrompt(body: UpdatePromptDto, adminId: string) {
    const settings = await this.getSystemSettings();

    const oldPrompt = settings.ideaPromptTemplate;

    const updatedSettings = await this.prisma.systemSetting.update({
      where: {
        id: settings.id,
      },
      data: {
        ideaPromptTemplate: body.ideaPromptTemplate,
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
    };
  }
}