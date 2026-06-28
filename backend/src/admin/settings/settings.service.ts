import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { AdminAction, AdminTargetType, Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Service responsible for managing system settings.
 *
 * This service allows administrators to retrieve and update
 * global system configuration values such as:
 * - Credit price.
 * - Bonus credit rules.
 * - Bonus threshold.
 *
 * It also records the administrator who performed the latest update
 * and the timestamp of the modification.
 *
 * @author Malak
 */
@Injectable()
export class SettingsService {
    /**
     * Creates an instance of SettingsService.
     *
     * @param prisma - Prisma service used to access the database.
     */
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditLogsService: AuditLogsService,
    ) { }

    /**
     * Retrieves the current system settings.
     *
     * If no settings record exists, a default configuration is created
     * automatically with the initial system values.
     *
     * The returned data includes the administrator who last updated
     * the settings.
     *
     * @returns The current system settings.
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

        return settings;
    }

    /**
     * Updates the global system settings.
     *
     * Administrators can modify:
     * - Credit price.
     * - Bonus threshold.
     * - Bonus credits.
     *
     * The ID of the administrator performing the update is stored
     * to maintain an audit trail of configuration changes.
     *
     * @param body - DTO containing the updated system settings.
     * @param adminId - ID of the authenticated administrator.
     * @returns A success message and the updated system settings.
     */
    async updateSystemSettings(
        adminId: string,
        body: UpdateSystemSettingsDto,
    ) {
        const currentSettings = await this.getSystemSettings();

        const oldSettings = await this.prisma.systemSetting.findUnique({
            where: {
                id: currentSettings.id,
            },
        });

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

        await this.auditLogsService.createLog({
            adminId,
            action: AdminAction.ADMIN_UPDATE_SETTINGS,
            targetType: AdminTargetType.SYSTEM_SETTING,
            targetId: updatedSettings.id,
            oldValue: oldSettings as Prisma.InputJsonValue,
            newValue: updatedSettings as Prisma.InputJsonValue,
        });

        return {
            message: 'System settings updated successfully',
            settings: updatedSettings,
        };
    }
}