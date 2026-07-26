import { Injectable, Logger } from '@nestjs/common';

import type {
    BatchResponse,
    MulticastMessage,
    SendResponse,
} from 'firebase-admin/messaging';

import {
    FCM_MULTICAST_BATCH_SIZE,
    INVALID_FCM_TOKEN_ERROR_CODES,
    PUSH_NOTIFICATION_MAX_ATTEMPTS,
    PUSH_NOTIFICATION_RETRY_DELAY_MS,
    RETRYABLE_FCM_ERROR_CODES,
} from '../constants/push-notification.constants';

import type { ActivePushDevice } from '../types/active-push-device.type';
import type { PushNotificationResult } from '../types/push-notification-result.type';
import type { SendPushNotificationInput } from '../types/send-push-notification-input.type';

import { FirebaseService } from './firebase.service';
import { UserDeviceService } from './user-device.service';

interface BatchDeliveryResult {
    successCount: number;
    failureCount: number;
}

interface BatchResponseAnalysis {
    successCount: number;
    retryableDevices: ActivePushDevice[];
}

/**
 * Sends Firebase Cloud Messaging push notifications to registered
 * user devices.
 *
 * Responsibilities:
 * - Retrieve active devices through UserDeviceService.
 * - Build Firebase-compatible multicast messages.
 * - Split large device collections into supported batches.
 * - Retry transient Firebase delivery failures.
 * - Revoke invalid or expired device registrations.
 * - Prevent push-delivery failures from breaking primary workflows.
 *
 * Push delivery is treated as a best-effort side effect.
 * Persisted in-app alerts remain the reliable notification source.
 *
 * This service does not access Prisma directly.
 *
 * @author Eman
 */
@Injectable()
export class PushNotificationService {
    private readonly logger = new Logger(PushNotificationService.name);

    constructor(
        private readonly firebaseService: FirebaseService,
        private readonly userDeviceService: UserDeviceService,
    ) { }

    /**
     * Sends one push notification to all active devices
     * registered by the specified user.
     *
     * Delivery failures are captured and logged instead of being
     * propagated to the primary business workflow.
     */
    async sendToUser(
        input: SendPushNotificationInput,
    ): Promise<PushNotificationResult> {
        const startedAt = Date.now();

        try {
            const devices =
                await this.userDeviceService.getActiveDevicesForPush(
                    input.userId,
                );

            if (devices.length === 0) {
                this.logger.debug(
                    `Push notification skipped because user ${input.userId} has no active devices.`,
                );

                return this.createSkippedResult();
            }

            const deviceBatches = this.chunk(
                devices,
                FCM_MULTICAST_BATCH_SIZE,
            );

            const invalidDeviceIds = new Set<string>();

            let successCount = 0;
            let failureCount = 0;

            for (const deviceBatch of deviceBatches) {
                const batchResult = await this.sendDeviceBatch(
                    deviceBatch,
                    input,
                    invalidDeviceIds,
                );

                successCount += batchResult.successCount;
                failureCount += batchResult.failureCount;
            }

            const revokedTokenCount =
                await this.userDeviceService.revokeDevices(
                    input.userId,
                    [...invalidDeviceIds],
                );

            const result: PushNotificationResult = {
                attemptedCount: devices.length,
                successCount,
                failureCount,
                revokedTokenCount,
                skipped: false,
            };

            this.logDeliveryResult(
                input.userId,
                result,
                Date.now() - startedAt,
            );

            return result;
        } catch (error: unknown) {
            /*
             * Push notification delivery must never break the primary
             * business workflow. The persisted in-app alert remains
             * available even when Firebase delivery fails.
             */
            this.logger.error(
                `Push notification delivery failed for user ${input.userId}.`,
                this.getErrorStack(error),
            );

            return this.createSkippedResult();
        }
    }

    /**
     * Sends one Firebase-compatible device batch.
     *
     * Successful devices are removed from subsequent attempts.
     * Only devices with transient item-level failures are retried.
     */
    private async sendDeviceBatch(
        devices: readonly ActivePushDevice[],
        input: SendPushNotificationInput,
        invalidDeviceIds: Set<string>,
    ): Promise<BatchDeliveryResult> {
        let pendingDevices = [...devices];
        let successCount = 0;

        for (
            let attempt = 1;
            attempt <= PUSH_NOTIFICATION_MAX_ATTEMPTS;
            attempt += 1
        ) {
            if (pendingDevices.length === 0) {
                break;
            }

            try {
                const response = await this.sendBatch(
                    pendingDevices,
                    input,
                );

                const analysis = this.analyzeBatchResponse(
                    pendingDevices,
                    response,
                    invalidDeviceIds,
                );

                successCount += analysis.successCount;
                pendingDevices = analysis.retryableDevices;

                if (
                    pendingDevices.length > 0 &&
                    attempt < PUSH_NOTIFICATION_MAX_ATTEMPTS
                ) {
                    this.logger.warn(
                        `Retrying ${pendingDevices.length} transient Firebase delivery failure(s). Attempt ${attempt + 1} of ${PUSH_NOTIFICATION_MAX_ATTEMPTS}.`,
                    );

                    await this.delay(
                        PUSH_NOTIFICATION_RETRY_DELAY_MS * attempt,
                    );
                }
            } catch (error: unknown) {
                const errorCode = this.getFirebaseErrorCode(error);

                const canRetry =
                    attempt < PUSH_NOTIFICATION_MAX_ATTEMPTS &&
                    errorCode !== undefined &&
                    RETRYABLE_FCM_ERROR_CODES.has(errorCode);

                if (!canRetry) {
                    this.logger.error(
                        `Firebase batch delivery failed after attempt ${attempt}.`,
                        this.getErrorStack(error),
                    );

                    break;
                }

                this.logger.warn(
                    `Retrying Firebase batch after transient error ${errorCode}. Attempt ${attempt + 1} of ${PUSH_NOTIFICATION_MAX_ATTEMPTS}.`,
                );

                await this.delay(
                    PUSH_NOTIFICATION_RETRY_DELAY_MS * attempt,
                );
            }
        }

        return {
            successCount,
            failureCount: devices.length - successCount,
        };
    }

    /**
     * Sends one multicast request through Firebase Cloud Messaging.
     */
    private sendBatch(
        devices: readonly ActivePushDevice[],
        input: SendPushNotificationInput,
    ): Promise<BatchResponse> {
        const message = this.buildMulticastMessage(devices, input);

        return this.firebaseService
            .getMessaging()
            .sendEachForMulticast(message);
    }

    /**
     * Builds a Firebase-compatible multicast message.
     */
    private buildMulticastMessage(
        devices: readonly ActivePushDevice[],
        input: SendPushNotificationInput,
    ): MulticastMessage {
        return {
            tokens: devices.map((device) => device.fcmToken),

            notification: {
                title: input.title,
                body: input.body,
                ...(input.imageUrl
                    ? {
                        imageUrl: input.imageUrl,
                    }
                    : {}),
            },

            ...(input.data
                ? {
                    data: { ...input.data },
                }
                : {}),

            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                },
            },

            apns: {
                headers: {
                    'apns-priority': '10',
                },
                payload: {
                    aps: {
                        sound: 'default',
                    },
                },
            },
        };
    }

    /**
     * Analyzes Firebase item-level responses.
     *
     * Permanently invalid devices are scheduled for revocation.
     * Transient failures are returned for another delivery attempt.
     * Permanent non-token failures are counted without retrying.
     */
    private analyzeBatchResponse(
        devices: readonly ActivePushDevice[],
        response: BatchResponse,
        invalidDeviceIds: Set<string>,
    ): BatchResponseAnalysis {
        const retryableDevices: ActivePushDevice[] = [];
        let successCount = 0;

        response.responses.forEach(
            (sendResponse: SendResponse, index: number) => {
                const device = devices[index];

                if (!device) {
                    this.logger.warn(
                        `Firebase returned an unmatched response at index ${index}.`,
                    );
                    return;
                }

                if (sendResponse.success) {
                    successCount += 1;
                    return;
                }

                const errorCode = sendResponse.error?.code;

                if (
                    errorCode &&
                    INVALID_FCM_TOKEN_ERROR_CODES.has(errorCode)
                ) {
                    invalidDeviceIds.add(device.id);
                    return;
                }

                if (
                    errorCode &&
                    RETRYABLE_FCM_ERROR_CODES.has(errorCode)
                ) {
                    retryableDevices.push(device);
                    return;
                }

                this.logger.warn(
                    `Firebase permanently rejected device ${device.id}${errorCode ? ` with error ${errorCode}` : ''
                    }.`,
                );
            },
        );

        return {
            successCount,
            retryableDevices,
        };
    }

    /**
     * Splits values into Firebase-compatible batches.
     */
    private chunk<T>(
        values: readonly T[],
        size: number,
    ): T[][] {
        if (size <= 0) {
            throw new RangeError(
                'Push-notification batch size must be greater than zero.',
            );
        }

        const batches: T[][] = [];

        for (
            let index = 0;
            index < values.length;
            index += size
        ) {
            batches.push(values.slice(index, index + size));
        }

        return batches;
    }

    /**
     * Logs a structured summary of the completed push-delivery operation.
     */
    private logDeliveryResult(
        userId: string,
        result: PushNotificationResult,
        durationMs: number,
    ): void {
        this.logger.log(
            [
                `Push notification completed for user ${userId}.`,
                `Attempted: ${result.attemptedCount}.`,
                `Successful: ${result.successCount}.`,
                `Failed: ${result.failureCount}.`,
                `Revoked: ${result.revokedTokenCount}.`,
                `Duration: ${durationMs}ms.`,
            ].join(' '),
        );
    }

    /**
     * Pauses execution before a transient retry.
     */
    private delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }

    /**
     * Safely extracts a Firebase error code.
     */
    private getFirebaseErrorCode(
        error: unknown,
    ): string | undefined {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
        ) {
            return error.code;
        }

        return undefined;
    }

    /**
     * Safely extracts an error stack for application logging.
     */
    private getErrorStack(error: unknown): string | undefined {
        return error instanceof Error
            ? error.stack
            : undefined;
    }

    /**
     * Creates the result returned when push delivery is skipped.
     */
    private createSkippedResult(): PushNotificationResult {
        return {
            attemptedCount: 0,
            successCount: 0,
            failureCount: 0,
            revokedTokenCount: 0,
            skipped: true,
        };
    }
}