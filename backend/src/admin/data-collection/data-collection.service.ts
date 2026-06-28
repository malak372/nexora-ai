import { BadRequestException, Injectable } from '@nestjs/common';
import {
    AdminAction,
    AdminTargetType,
    ApiProvider,
    ApiRequestType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Service responsible for managing manual data collection operations.
 *
 * This service allows administrators to start, stop, and monitor
 * the data collection process from the Admin panel.
 *
 * It also creates audit logs for admin actions related to
 * running or stopping data collection.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
    /**
     * Current in-memory status of the data collection process.
     */
    private dataCollectionStatus = {
        status: 'IDLE',
        lastRun: null as Date | null,
        message: 'Data collection has not started yet',
    };

    /**
     * Creates an instance of DataCollectionService.
     *
     * @param prisma - Prisma service used to access the database.
     * @param auditLogsService - Service used to record admin actions.
     */
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditLogsService: AuditLogsService,
    ) { }

    /**
     * Starts the data collection process manually.
     *
     * @param adminId - ID of the administrator who started the collection.
     * @returns A success message and the updated data collection status.
     *
     * @throws BadRequestException if data collection is already running.
     */
    async runDataCollection(adminId: string) {
        if (this.dataCollectionStatus.status === 'RUNNING') {
            throw new BadRequestException('Data collection is already running');
        }

        this.dataCollectionStatus = {
            status: 'RUNNING',
            lastRun: new Date(),
            message: 'Data collection started',
        };

        try {
            const apiLog = await this.prisma.externalApiLog.create({
                data: {
                    userId: adminId,
                    provider: ApiProvider.OTHER,
                    requestType: ApiRequestType.DATA_COLLECTION,
                    endpoint: '/admin/data-collection/run',
                    isSuccess: true,
                    statusCode: 200,
                    responseTimeMs: 0,
                },
            });

            this.dataCollectionStatus = {
                status: 'FINISHED',
                lastRun: new Date(),
                message: 'Data collection finished successfully',
            };

            await this.auditLogsService.createLog({
                adminId,
                action: AdminAction.ADMIN_RUN_DATA_COLLECTION,
                targetType: AdminTargetType.DATA_COLLECTION,
                targetId: apiLog.id,
                newValue: {
                    status: this.dataCollectionStatus.status,
                    message: this.dataCollectionStatus.message,
                    externalApiLogId: apiLog.id,
                },
            });

            return {
                message: 'Data collection finished successfully',
                status: this.dataCollectionStatus,
            };
        } catch (error) {
            this.dataCollectionStatus = {
                status: 'FAILED',
                lastRun: new Date(),
                message: 'Data collection failed',
            };

            throw error;
        }
    }

    /**
     * Stops the currently running data collection process.
     *
     * @param adminId - ID of the administrator who stopped the collection.
     * @returns A success message and the updated data collection status.
     *
     * @throws BadRequestException if data collection is not running.
     */
    async stopDataCollection(adminId: string) {
        if (this.dataCollectionStatus.status !== 'RUNNING') {
            throw new BadRequestException('Data collection is not running');
        }

        this.dataCollectionStatus = {
            status: 'STOPPED',
            lastRun: new Date(),
            message: 'Data collection stopped by admin',
        };

        await this.auditLogsService.createLog({
            adminId,
            action: AdminAction.ADMIN_STOP_DATA_COLLECTION,
            targetType: AdminTargetType.DATA_COLLECTION,
            targetId: 'DATA_COLLECTION',
            newValue: {
                status: this.dataCollectionStatus.status,
                message: this.dataCollectionStatus.message,
                lastRun: this.dataCollectionStatus.lastRun?.toISOString() ?? null,
            },
        });

        return {
            message: 'Data collection stopped successfully',
            status: this.dataCollectionStatus,
        };
    }

    /**
     * Retrieves the current data collection status.
     *
     * @returns The current status, last run date, and status message.
     */
    getDataCollectionStatus() {
        return this.dataCollectionStatus;
    }
}