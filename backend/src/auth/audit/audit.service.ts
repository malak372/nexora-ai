import { Injectable } from '@nestjs/common';

import { AuthenticationLog, AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Maximum number of authentication logs returned to the
 * administrator when pagination is not supplied.
 */
const DEFAULT_AUTH_AUDIT_LOGS_LIMIT = 100;

/**
 * Metadata extracted from an authentication request.
 *
 * Provides additional context for security monitoring
 * and authentication-event traceability.
 */
export type AuthRequestMeta = {
  /**
   * Client IP address when available.
   */
  readonly ipAddress?: string;

  /**
   * Client user-agent header when available.
   */
  readonly userAgent?: string;
};

/**
 * Input required to create an authentication audit log.
 */
export type CreateAuthLogInput = AuthRequestMeta & {
  /**
   * Related authenticated user identifier.
   *
   * It may be absent for failed authentication attempts
   * where the user could not be identified.
   */
  readonly userId?: string;

  /**
   * Email involved in the authentication event.
   *
   * It may be stored even when no user record was found,
   * such as during a failed login attempt.
   */
  readonly email?: string;

  /**
   * Authentication action being recorded.
   */
  readonly action: AuthAction;

  /**
   * Indicates whether the authentication operation succeeded.
   *
   * Defaults to true when omitted.
   */
  readonly isSuccess?: boolean;

  /**
   * Optional safe description of the authentication event.
   *
   * Passwords, tokens, secrets, and other sensitive values
   * must never be included.
   */
  readonly message?: string;
};

/**
 * Service responsible for recording and retrieving
 * authentication audit logs.
 *
 * This service centralizes authentication-event persistence
 * for security monitoring and auditing purposes.
 *
 * Examples of recorded events:
 * - Registration.
 * - Successful and failed login attempts.
 * - Account locking.
 * - Logout.
 * - Refresh-token usage.
 * - Password changes and resets.
 * - Email verification.
 * - Account deactivation.
 *
 * @author Eman
 */
@Injectable()
export class AuthAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates an authentication audit-log entry.
   *
   * @param input Authentication event information.
   * @returns The newly created authentication log.
   */
  async createLog(input: CreateAuthLogInput): Promise<AuthenticationLog> {
    return this.prisma.authenticationLog.create({
      data: {
        userId: input.userId,
        email: input.email,
        action: input.action,
        isSuccess: input.isSuccess ?? true,
        message: input.message,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  /**
   * Retrieves the latest authentication audit logs,
   * ordered from newest to oldest.
   *
   * This method is intended for administrator security
   * monitoring. Access control is enforced by the controller.
   *
   * @returns The latest authentication audit-log records.
   */
  async getLogs(): Promise<AuthenticationLog[]> {
    return this.prisma.authenticationLog.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: DEFAULT_AUTH_AUDIT_LOGS_LIMIT,
    });
  }
}
