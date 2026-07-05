import { Injectable } from '@nestjs/common';
import { AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Metadata extracted from an authentication request.
 *
 * This metadata provides additional context for authentication
 * audit logs, allowing authentication events to be traced back
 * to the originating client when available.
 */
export type AuthRequestMeta = {
    ipAddress?: string;
    userAgent?: string;
};

/**
 * Service responsible for recording authentication audit logs.
 *
 * This service centralizes authentication activity logging for
 * security monitoring and auditing purposes.
 *
 * Logged events include:
 * - User registration.
 * - Successful and failed login attempts.
 * - Account lock events.
 * - Logout operations.
 * - Refresh token usage.
 * - Password changes.
 * - Password reset requests and completions.
 * - Email verification.
 * - Verification email resend requests.
 * - Account deactivation.
 *
 * Each log entry may optionally include client metadata,
 * such as the IP address and user agent, to improve
 * traceability and support future security analysis.
 *
 * @author Eman
 */
@Injectable()
export class AuthAuditService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Creates a new authentication audit log entry.
     *
     * @param data Authentication audit log information.
     * @returns Created authentication log record.
     */
    async createLog(data: {
        userId?: string;
        email?: string;
        action: AuthAction;
        isSuccess?: boolean;
        message?: string;
        ipAddress?: string;
        userAgent?: string;
    }) {
        return this.prisma.authenticationLog.create({
            data: {
                userId: data.userId,
                email: data.email,
                action: data.action,
                isSuccess: data.isSuccess ?? true,
                message: data.message,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
            },
        });
    }
    /**
 * Retrieves authentication audit logs ordered from newest to oldest.
 *
 * This method is intended for admin monitoring screens to review
 * authentication-related events such as login attempts, password
 * changes, token refreshes, logouts, and email verification actions.
 *
 * @returns List of authentication audit logs.
 */
    async getLogs() {
        return this.prisma.authenticationLog.findMany({
            orderBy: {
                createdAt: 'desc',
            },
            take: 100,
        });
    }
}