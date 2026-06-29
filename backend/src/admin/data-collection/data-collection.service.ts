import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AdminAction,
  AdminTargetType,
  ApiProvider,
  ApiRequestType,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

export type DataCollectionStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'FINISHED'
  | 'FAILED'
  | 'STOPPED';

export type DataCollectionState = {
  status: DataCollectionStatus;
  lastRun: Date | null;
  message: string;
};

/**
 * Service responsible for managing manual data collection operations.
 *
 * This service currently acts as a manual trigger placeholder for
 * the future real data collection job.
 *
 * Current behavior:
 * - Prevents duplicate running jobs.
 * - Marks the process as RUNNING.
 * - Creates an ExternalApiLog entry for monitoring.
 * - Marks the process as FINISHED immediately.
 * - Records admin actions in audit logs.
 *
 * Future behavior:
 * - Replace the placeholder section with real platform data collection.
 * - Collect comments/posts from supported public sources.
 * - Store comments with platform, language, region, and source metadata.
 * - Run NLP analysis when needed.
 *
 * Note:
 * The status is stored in memory and resets when the backend restarts.
 * For production-level job tracking, store job status in the database.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  /**
   * Current in-memory status of the data collection process.
   */
  private dataCollectionStatus: DataCollectionState = {
    status: 'IDLE',
    lastRun: null,
    message: 'Data collection has not started yet',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Starts the data collection process manually.
   *
   * Endpoint:
   * POST /admin/data-collection/run
   *
   * @param adminId - ID of the administrator who started the collection.
   * @returns Updated data collection status.
   */
  async runDataCollection(adminId: string) {
    if (this.dataCollectionStatus.status === 'RUNNING') {
      throw new BadRequestException('Data collection is already running');
    }

    const startTime = Date.now();

    this.dataCollectionStatus = {
      status: 'RUNNING',
      lastRun: new Date(),
      message: 'Data collection started',
    };

    try {
      /**
       * Placeholder for future real collection logic.
       *
       * Future steps:
       * - Fetch comments from configured platforms.
       * - Store collected comments.
       * - Run NLP preprocessing or analysis.
       * - Update collection statistics.
       */

      const responseTimeMs = Date.now() - startTime;

      const apiLog = await this.prisma.externalApiLog.create({
        data: {
          userId: adminId,
          provider: ApiProvider.OTHER,
          requestType: ApiRequestType.DATA_COLLECTION,
          endpoint: '/admin/data-collection/run',
          isSuccess: true,
          statusCode: 200,
          responseTimeMs,
        },
      });

      this.dataCollectionStatus = {
        status: 'FINISHED',
        lastRun: new Date(),
        message: 'Data collection placeholder finished successfully',
      };

      await this.auditLogsService.createLog({
        adminId,
        action: AdminAction.ADMIN_RUN_DATA_COLLECTION,
        targetType: AdminTargetType.DATA_COLLECTION,
        targetId: apiLog.id,
        newValue: {
          status: this.dataCollectionStatus.status,
          message: this.dataCollectionStatus.message,
          responseTimeMs,
          externalApiLogId: apiLog.id,
        },
      });

      return {
        message: 'Data collection finished successfully',
        status: this.dataCollectionStatus,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      this.dataCollectionStatus = {
        status: 'FAILED',
        lastRun: new Date(),
        message: 'Data collection failed',
      };

      const apiLog = await this.prisma.externalApiLog.create({
        data: {
          userId: adminId,
          provider: ApiProvider.OTHER,
          requestType: ApiRequestType.DATA_COLLECTION,
          endpoint: '/admin/data-collection/run',
          isSuccess: false,
          statusCode: 500,
          responseTimeMs,
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Unknown data collection error',
        },
      });

      await this.auditLogsService.createLog({
        adminId,
        action: AdminAction.ADMIN_RUN_DATA_COLLECTION,
        targetType: AdminTargetType.DATA_COLLECTION,
        targetId: apiLog.id,
        newValue: {
          status: this.dataCollectionStatus.status,
          message: this.dataCollectionStatus.message,
          responseTimeMs,
          externalApiLogId: apiLog.id,
        },
      });

      throw error;
    }
  }

  /**
   * Stops the currently running data collection process.
   *
   * Endpoint:
   * POST /admin/data-collection/stop
   *
   * In the placeholder version, runDataCollection finishes immediately,
   * so this endpoint is mainly prepared for future long-running jobs.
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
   * Retrieves the current in-memory data collection status.
   *
   * Endpoint:
   * GET /admin/data-collection/status
   */
  getDataCollectionStatus(): DataCollectionState {
    return this.dataCollectionStatus;
  }
}