import {
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
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
 * Current behavior:
 * - Starts data collection as a background task.
 * - Prevents duplicate running jobs.
 * - Allows stopping a running job.
 * - Tracks in-memory collection status.
 * - Creates External API logs.
 * - Creates Admin Audit Logs.
 *
 * Note:
 * This is still a prepared placeholder for the future real data collection job.
 * For production-level tracking, data collection jobs should be stored
 * in the database instead of memory.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  /**
   * Current in-memory collection state.
   *
   * This value resets when the backend restarts.
   */
  private dataCollectionStatus: DataCollectionState = {
    status: 'IDLE',
    lastRun: null,
    message: 'Data collection has not started yet',
  };

  /**
   * Indicates whether the current running job was requested to stop.
   */
  private shouldStop = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Updates the in-memory data collection status.
   *
   * @param status New collection status.
   * @param message Human-readable status message.
   */
  private updateStatus(
    status: DataCollectionStatus,
    message: string,
  ): void {
    this.dataCollectionStatus = {
      status,
      lastRun: new Date(),
      message,
    };
  }

  /**
   * Starts the data collection process manually.
   *
   * This method starts a background task and returns immediately,
   * which allows the status endpoint to show RUNNING
   * and the stop endpoint to work correctly.
   *
   * Endpoint:
   * POST /admin/data-collection/run
   *
   * @param adminId ID of the admin who started the process.
   * @returns Current collection status after starting.
   */
  async runDataCollection(adminId: string) {
    if (this.dataCollectionStatus.status === 'RUNNING') {
      throw new BadRequestException('Data collection is already running');
    }

    this.shouldStop = false;

    this.updateStatus(
      'RUNNING',
      'Data collection started in the background',
    );

    void this.executeDataCollection(adminId);

    return {
      message: 'Data collection started successfully',
      status: this.dataCollectionStatus,
    };
  }

  /**
   * Executes the actual data collection process in the background.
   *
   * Current placeholder behavior:
   * - Simulates future collection steps.
   * - Checks if stop was requested.
   * - Logs successful or failed execution.
   *
   * Future real implementation:
   * - Load active platforms.
   * - Fetch public posts/comments where permitted.
   * - Store comments with platform, language, region, and source URL.
   * - Trigger NLP preprocessing or analysis.
   *
   * @param adminId ID of the admin who started the process.
   */
  private async executeDataCollection(adminId: string): Promise<void> {
    const startTime = Date.now();

    try {
      /**
       * Placeholder delay to simulate a long-running collection job.
       * Replace this block with real collection logic later.
       */
      await new Promise((resolve) => setTimeout(resolve, 3000));

      if (this.shouldStop) {
        await this.logStoppedCollection(adminId, startTime);
        return;
      }

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

      this.updateStatus(
        'FINISHED',
        'Data collection placeholder finished successfully',
      );

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
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      this.updateStatus('FAILED', 'Data collection failed');

      const apiLog = await this.prisma.externalApiLog.create({
        data: {
          userId: adminId,
          provider: ApiProvider.OTHER,
          requestType: ApiRequestType.DATA_COLLECTION,
          endpoint: '/admin/data-collection/run',
          isSuccess: false,
          statusCode: error instanceof HttpException ? error.getStatus() : 500,
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
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Unknown data collection error',
        },
      });
    }
  }

  /**
   * Stops the currently running data collection process.
   *
   * The actual background job checks the shouldStop flag and
   * then records the stop action safely.
   *
   * Endpoint:
   * POST /admin/data-collection/stop
   *
   * @param adminId ID of the admin who requested stopping the process.
   * @returns Current collection status.
   */
  async stopDataCollection(adminId: string) {
    if (this.dataCollectionStatus.status !== 'RUNNING') {
      throw new BadRequestException('Data collection is not running');
    }

    this.shouldStop = true;

    this.updateStatus(
      'STOPPED',
      'Data collection stop request received',
    );

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_STOP_DATA_COLLECTION,
      targetType: AdminTargetType.DATA_COLLECTION,
      newValue: {
        status: this.dataCollectionStatus.status,
        message: this.dataCollectionStatus.message,
        lastRun: this.dataCollectionStatus.lastRun?.toISOString() ?? null,
      },
    });

    return {
      message: 'Data collection stop request submitted successfully',
      status: this.dataCollectionStatus,
    };
  }

  /**
   * Logs a stopped data collection job after the background task
   * detects that stop was requested.
   *
   * @param adminId ID of the admin who started the process.
   * @param startTime Timestamp when the process started.
   */
  private async logStoppedCollection(
    adminId: string,
    startTime: number,
  ): Promise<void> {
    const responseTimeMs = Date.now() - startTime;

    const apiLog = await this.prisma.externalApiLog.create({
      data: {
        userId: adminId,
        provider: ApiProvider.OTHER,
        requestType: ApiRequestType.DATA_COLLECTION,
        endpoint: '/admin/data-collection/run',
        isSuccess: false,
        statusCode: 499,
        responseTimeMs,
        errorMessage: 'Data collection stopped by admin',
      },
    });

    this.updateStatus(
      'STOPPED',
      'Data collection stopped by admin',
    );

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_STOP_DATA_COLLECTION,
      targetType: AdminTargetType.DATA_COLLECTION,
      targetId: apiLog.id,
      newValue: {
        status: this.dataCollectionStatus.status,
        message: this.dataCollectionStatus.message,
        responseTimeMs,
        externalApiLogId: apiLog.id,
      },
    });
  }

  /**
   * Retrieves the current in-memory data collection status.
   *
   * Endpoint:
   * GET /admin/data-collection/status
   *
   * @returns Current collection state.
   */
  getDataCollectionStatus(): DataCollectionState {
    return this.dataCollectionStatus;
  }
}