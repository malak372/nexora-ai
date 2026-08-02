import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toNumber } from '../../utilities/analytics/analytics.helper';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';

/**
 * Manages the single global configuration used by credits, Premium activation,
 * direct idea unlocks, and published-idea acceptance.
 *
 * Prompt text remains owned by the Prompts module even though it is stored in
 * the same database row.
 *
 * @author Malak
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditService,
  ) {}

  /** Returns the global settings row, creating safe defaults when absent. */
  async getSystemSettings() {
    let settings = await this.prisma.systemSetting.findUnique({
      where: { key: 'GLOBAL' },
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
          key: 'GLOBAL',
          creditPrice: 15,
          directUnlockPrice: 10,
          premiumActivationFee: 5,
          publishedIdeaPrice: 15,
          normalAcceptancePrice: 15,
          premiumAcceptancePrice: 5,
          normalPublicationAdvancedPrice: 5,
          publicationAdvancedCreditCost: 1,
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

    return this.normalizeSettings(settings);
  }

  /**
   * Applies a partial update and writes one audit record only when at least one
   * value changed.
   */
  async updateSystemSettings(adminId: string, body: UpdateSystemSettingsDto) {
    const currentSettings = await this.getSystemSettings();

    const hasChanges =
      this.changed(body.creditPrice, currentSettings.creditPrice) ||
      this.changed(body.directUnlockPrice, currentSettings.directUnlockPrice) ||
      this.changed(
        body.premiumActivationFee,
        currentSettings.premiumActivationFee,
      ) ||
      this.changed(body.publishedIdeaPrice, currentSettings.publishedIdeaPrice) ||
      this.changed(body.normalAcceptancePrice, currentSettings.normalAcceptancePrice) ||
      this.changed(body.premiumAcceptancePrice, currentSettings.premiumAcceptancePrice) ||
      this.changed(body.normalPublicationAdvancedPrice, currentSettings.normalPublicationAdvancedPrice) ||
      this.changed(
        body.publicationAdvancedCreditCost,
        currentSettings.publicationAdvancedCreditCost,
      ) ||
      this.changed(body.bonusThreshold, currentSettings.bonusThreshold) ||
      this.changed(body.bonusCredits, currentSettings.bonusCredits);

    if (!hasChanges) {
      return {
        message: 'No changes detected',
        settings: currentSettings,
        updated: false,
      };
    }

    const updatedSettings = await this.prisma.systemSetting.update({
      where: { id: currentSettings.id },
      data: {
        ...(body.creditPrice !== undefined && {
          creditPrice: body.creditPrice,
        }),
        ...(body.directUnlockPrice !== undefined && {
          directUnlockPrice: body.directUnlockPrice,
        }),
        ...(body.premiumActivationFee !== undefined && {
          premiumActivationFee: body.premiumActivationFee,
        }),
        ...(body.publishedIdeaPrice !== undefined && { publishedIdeaPrice: body.publishedIdeaPrice }),
        ...(body.normalAcceptancePrice !== undefined && { normalAcceptancePrice: body.normalAcceptancePrice }),
        ...(body.premiumAcceptancePrice !== undefined && { premiumAcceptancePrice: body.premiumAcceptancePrice }),
        ...(body.normalPublicationAdvancedPrice !== undefined && {
          normalPublicationAdvancedPrice: body.normalPublicationAdvancedPrice,
        }),
        ...(body.publicationAdvancedCreditCost !== undefined && {
          publicationAdvancedCreditCost: body.publicationAdvancedCreditCost,
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

    const normalizedUpdatedSettings = this.normalizeSettings(updatedSettings);

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_UPDATE_SETTINGS,
      targetType: AuditTargetType.SYSTEM_SETTING,
      targetId: updatedSettings.id,
      oldValue: this.toAuditableValues(currentSettings),
      newValue: this.toAuditableValues(normalizedUpdatedSettings),
    });

    return {
      message: 'System settings updated successfully',
      settings: normalizedUpdatedSettings,
      updated: true,
    };
  }

  /** Converts Prisma Decimal fields to JSON-safe numbers. */
  private normalizeSettings<
    T extends {
      creditPrice: Prisma.Decimal | number | string;
      directUnlockPrice: Prisma.Decimal | number | string;
      premiumActivationFee: Prisma.Decimal | number | string;
      publishedIdeaPrice: Prisma.Decimal | number | string;
      normalAcceptancePrice: Prisma.Decimal | number | string;
      premiumAcceptancePrice: Prisma.Decimal | number | string;
      normalPublicationAdvancedPrice: Prisma.Decimal | number | string;
    },
  >(settings: T) {
    return {
      ...settings,
      creditPrice: toNumber(settings.creditPrice),
      directUnlockPrice: toNumber(settings.directUnlockPrice),
      premiumActivationFee: toNumber(settings.premiumActivationFee),
      publishedIdeaPrice: toNumber(settings.publishedIdeaPrice),
      normalAcceptancePrice: toNumber(settings.normalAcceptancePrice),
      premiumAcceptancePrice: toNumber(settings.premiumAcceptancePrice),
      normalPublicationAdvancedPrice: toNumber(settings.normalPublicationAdvancedPrice),
    };
  }

  /** Handles both numeric and integer settings consistently. */
  private changed(
    nextValue: number | undefined,
    currentValue: number,
  ): boolean {
    return nextValue !== undefined && nextValue !== currentValue;
  }

  /** Restricts the audit payload to commercial fields only. */
  private toAuditableValues(settings: {
    creditPrice: number;
    directUnlockPrice: number;
    premiumActivationFee: number;
    publishedIdeaPrice: number;
    normalAcceptancePrice: number;
    premiumAcceptancePrice: number;
    normalPublicationAdvancedPrice: number;
    publicationAdvancedCreditCost: number;
    bonusThreshold: number;
    bonusCredits: number;
  }) {
    return {
      creditPrice: settings.creditPrice,
      directUnlockPrice: settings.directUnlockPrice,
      premiumActivationFee: settings.premiumActivationFee,
      publishedIdeaPrice: settings.publishedIdeaPrice,
      normalAcceptancePrice: settings.normalAcceptancePrice,
      premiumAcceptancePrice: settings.premiumAcceptancePrice,
      normalPublicationAdvancedPrice: settings.normalPublicationAdvancedPrice,
      publicationAdvancedCreditCost: settings.publicationAdvancedCreditCost,
      bonusThreshold: settings.bonusThreshold,
      bonusCredits: settings.bonusCredits,
    };
  }
}