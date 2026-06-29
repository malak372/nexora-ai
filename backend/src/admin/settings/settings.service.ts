import { Injectable } from '@nestjs/common';
import { AdminAction, AdminTargetType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { toNumber } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for managing system settings.
 *
 * Provides:
 * - Retrieving current system settings.
 * - Creating default settings if no settings record exists.
 * - Updating credit price and bonus credit rules.
 * - Recording admin audit logs only when actual changes occur.
 *
 * @author Malak
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Retrieves the current system settings.
   *
   * If no settings record exists, a default configuration is created.
   *
   * The prompt template is included here because it exists in the
   * same SystemSetting table, but it is updated separately through
   * the Prompts module.
   *
   * Endpoint:
   * GET /admin/settings
   *
   * @returns Current system settings with Decimal fields converted to numbers.
   */
  async getSystemSettings() {
    let settings = await this.prisma.systemSetting.findFirst({
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        updatedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
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
        include: {
          updatedBy: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });
    }

    return {
      ...settings,
      creditPrice: toNumber(settings.creditPrice),
    };
  }

  /**
   * Updates the global credit system settings.
   *
   * Only changed fields are updated.
   * If no values changed, no database update and no audit log are created.
   *
   * The AI prompt template is intentionally not updated here,
   * because prompt updates are handled by the Prompts module.
   *
   * Endpoint:
   * PATCH /admin/settings
   *
   * @param adminId - Authenticated administrator ID.
   * @param body - DTO containing updated settings.
   * @returns Updated settings or no-change response.
   */
  async updateSystemSettings(
    adminId: string,
    body: UpdateSystemSettingsDto,
  ) {
    const currentSettings = await this.getSystemSettings();

    const hasChanges =
      (body.creditPrice !== undefined &&
        currentSettings.creditPrice !== body.creditPrice) ||
      (body.bonusThreshold !== undefined &&
        currentSettings.bonusThreshold !== body.bonusThreshold) ||
      (body.bonusCredits !== undefined &&
        currentSettings.bonusCredits !== body.bonusCredits);

    if (!hasChanges) {
      return {
        message: 'No changes detected',
        settings: currentSettings,
        updated: false,
      };
    }

    const updatedSettings = await this.prisma.systemSetting.update({
      where: {
        id: currentSettings.id,
      },
      data: {
        ...(body.creditPrice !== undefined && {
          creditPrice: body.creditPrice,
        }),
        ...(body.bonusThreshold !== undefined && {
          bonusThreshold: body.bonusThreshold,
        }),
        ...(body.bonusCredits !== undefined && {
          bonusCredits: body.bonusCredits,
        }),
        updatedById: adminId,
      },
      include: {
        updatedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const normalizedUpdatedSettings = {
      ...updatedSettings,
      creditPrice: toNumber(updatedSettings.creditPrice),
    };

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_UPDATE_SETTINGS,
      targetType: AdminTargetType.SYSTEM_SETTING,
      targetId: updatedSettings.id,
      oldValue: {
        creditPrice: currentSettings.creditPrice,
        bonusThreshold: currentSettings.bonusThreshold,
        bonusCredits: currentSettings.bonusCredits,
      },
      newValue: {
        creditPrice: normalizedUpdatedSettings.creditPrice,
        bonusThreshold: normalizedUpdatedSettings.bonusThreshold,
        bonusCredits: normalizedUpdatedSettings.bonusCredits,
      },
    });

    return {
      message: 'System settings updated successfully',
      settings: normalizedUpdatedSettings,
      updated: true,
    };
  }
}