import {
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';

import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { RegisterDeviceDto } from '../dto/register-device.dto';

/**
 * Defines user-device fields that are safe to expose
 * through authenticated user-facing endpoints.
 *
 * The raw Firebase registration token is intentionally excluded
 * because it is used only for internal push-notification delivery.
 */
const USER_DEVICE_PUBLIC_SELECT = {
    id: true,
    platform: true,
    createdAt: true,
    updatedAt: true,
    lastUsedAt: true,
} satisfies Prisma.UserDeviceSelect;

/**
 * Defines the minimum device fields required internally
 * for Firebase push-notification delivery.
 *
 * Results produced using this selection must never be returned
 * directly from a public controller.
 */
const USER_DEVICE_PUSH_SELECT = {
    id: true,
    fcmToken: true,
} satisfies Prisma.UserDeviceSelect;

/**
 * Public representation of a registered user device.
 */
export type PublicUserDevice = Prisma.UserDeviceGetPayload<{
    select: typeof USER_DEVICE_PUBLIC_SELECT;
}>;

/**
 * Internal representation required for push delivery.
 */
export type ActivePushDeviceRecord = Prisma.UserDeviceGetPayload<{
    select: typeof USER_DEVICE_PUSH_SELECT;
}>;

/**
 * Manages push-notification device registrations belonging to users.
 *
 * Responsibilities:
 * - Register new Firebase Cloud Messaging device tokens.
 * - Refresh and reactivate existing device registrations.
 * - Transfer token ownership when a token is registered by another user.
 * - Retrieve active user-facing devices without exposing FCM tokens.
 * - Retrieve active devices for internal push-notification delivery.
 * - Revoke user-owned devices and tokens.
 * - Revoke devices reported as invalid by Firebase.
 *
 * This service is responsible only for device persistence.
 * Push delivery is handled by PushNotificationService.
 *
 * @author Eman
 */
@Injectable()
export class UserDeviceService {
    private readonly logger = new Logger(UserDeviceService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Registers a new device or refreshes an existing FCM token.
     *
     * An FCM registration token uniquely identifies an application
     * installation. If the same token is registered by another user,
     * ownership is transferred to the currently authenticated user.
     *
     * Previously revoked device registrations are reactivated.
     */
    async registerDevice(
        userId: string,
        dto: RegisterDeviceDto,
    ): Promise<PublicUserDevice> {
        const normalizedToken = this.normalizeFcmToken(dto.fcmToken);
        const registeredAt = new Date();

        const device = await this.prisma.userDevice.upsert({
            where: {
                fcmToken: normalizedToken,
            },
            create: {
                userId,
                fcmToken: normalizedToken,
                platform: dto.platform,
                lastUsedAt: registeredAt,
            },
            update: {
                userId,
                platform: dto.platform,
                lastUsedAt: registeredAt,
                revokedAt: null,
            },
            select: USER_DEVICE_PUBLIC_SELECT,
        });

        this.logger.log(
            `Push-notification device ${device.id} registered for user ${userId}.`,
        );

        return device;
    }

    /**
     * Retrieves active devices belonging to the authenticated user.
     *
     * Raw FCM registration tokens are intentionally excluded
     * from the returned records.
     */
    getActiveDevices(userId: string): Promise<PublicUserDevice[]> {
        return this.prisma.userDevice.findMany({
            where: {
                userId,
                revokedAt: null,
            },
            select: USER_DEVICE_PUBLIC_SELECT,
            orderBy: [
                {
                    lastUsedAt: 'desc',
                },
                {
                    createdAt: 'desc',
                },
            ],
        });
    }

    /**
     * Retrieves active devices required for internal
     * push-notification delivery.
     *
     * This method exposes FCM registration tokens and must only
     * be used by trusted internal services.
     */
    getActiveDevicesForPush(
        userId: string,
    ): Promise<ActivePushDeviceRecord[]> {
        return this.prisma.userDevice.findMany({
            where: {
                userId,
                revokedAt: null,
            },
            select: USER_DEVICE_PUSH_SELECT,
            orderBy: [
                {
                    lastUsedAt: 'desc',
                },
                {
                    createdAt: 'desc',
                },
            ],
        });
    }

    /**
     * Revokes one active device belonging to the authenticated user.
     *
     * The ownership check and state transition are performed
     * atomically through one updateMany operation.
     *
     * @throws NotFoundException when the device does not exist,
     * is already revoked, or belongs to another user.
     */
    async revokeDevice(
        userId: string,
        deviceId: string,
    ): Promise<void> {
        const result = await this.prisma.userDevice.updateMany({
            where: {
                id: deviceId,
                userId,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        if (result.count === 0) {
            this.logger.warn(
                `Device revocation rejected: active device ${deviceId} was not found for user ${userId}.`,
            );

            throw new NotFoundException(
                'Active user device was not found.',
            );
        }

        this.logger.log(
            `Push-notification device ${deviceId} revoked for user ${userId}.`,
        );
    }

    /**
     * Revokes an active FCM token belonging to a specific user.
     *
     * This method can be used during logout when the client still
     * has access to its current Firebase registration token.
     *
     * Returns true when an active device registration was revoked.
     */
    async revokeToken(
        userId: string,
        fcmToken: string,
    ): Promise<boolean> {
        const normalizedToken = this.normalizeFcmToken(fcmToken);

        const result = await this.prisma.userDevice.updateMany({
            where: {
                userId,
                fcmToken: normalizedToken,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        const wasRevoked = result.count > 0;

        if (wasRevoked) {
            this.logger.log(
                `Push-notification token revoked for user ${userId}.`,
            );
        }

        return wasRevoked;
    }

    /**
     * Revokes user-owned device records reported as permanently
     * invalid or unregistered by Firebase.
     *
     * Device IDs are used instead of raw registration tokens to avoid
     * passing secrets back into the persistence layer.
     *
     * The user ownership condition ensures that one delivery operation
     * cannot accidentally revoke another user's device registration.
     *
     * Duplicate and blank IDs are removed before the database update.
     * Already revoked or unknown devices are safely ignored.
     *
     * Returns the number of device registrations revoked.
     */
    async revokeDevices(
        userId: string,
        deviceIds: readonly string[],
    ): Promise<number> {
        const uniqueDeviceIds = this.normalizeDeviceIds(deviceIds);

        if (uniqueDeviceIds.length === 0) {
            return 0;
        }

        const result = await this.prisma.userDevice.updateMany({
            where: {
                userId,
                id: {
                    in: uniqueDeviceIds,
                },
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        if (result.count > 0) {
            this.logger.warn(
                `Revoked ${result.count} invalid Firebase device registration(s) for user ${userId}.`,
            );
        }

        return result.count;
    }

    /**
     * Normalizes an FCM registration token before persistence or lookup.
     */
    private normalizeFcmToken(fcmToken: string): string {
        return fcmToken.trim();
    }

    /**
     * Removes blank and duplicate device IDs.
     */
    private normalizeDeviceIds(
        deviceIds: readonly string[],
    ): string[] {
        return [
            ...new Set(
                deviceIds
                    .map((deviceId) => deviceId.trim())
                    .filter((deviceId) => deviceId.length > 0),
            ),
        ];
    }
}