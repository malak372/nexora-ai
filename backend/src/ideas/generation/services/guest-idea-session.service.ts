import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { GuestSession, Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Minimal guest-session information required by the idea
 * generation workflow.
 *
 * The public session token and fingerprint hash are intentionally
 * excluded from this result to prevent sensitive session data
 * from being exposed to callers that do not require it.
 *
 * @author Malak
 */
export type ResolvedGuestIdeaSession = {
  /**
   * Unique guest-session identifier.
   */
  id: string;

  /**
   * Indicates whether the guest already consumed the permitted
   * free idea generation.
   */
  hasGenerated: boolean;

  /**
   * Date and time at which the guest session was created.
   */
  createdAt: Date;

  /**
   * Date and time after which the session becomes invalid.
   *
   * Null means the current database record does not have an
   * explicit expiration date.
   */
  expiresAt: Date | null;
};

/**
 * Optional Prisma client accepted by transaction-aware methods.
 *
 * The normal PrismaService is used outside a transaction, while
 * Prisma.TransactionClient is supplied when the operation must
 * be part of a larger atomic workflow.
 *
 * @author Malak
 */
type GuestSessionDatabaseClient = PrismaService | Prisma.TransactionClient;

/**
 * Service responsible for resolving and consuming guest idea
 * generation sessions.
 *
 * Responsibilities:
 * - Resolve a guest session by its public session token.
 * - Reject missing, invalid or expired guest sessions.
 * - Reject sessions that already consumed guest generation.
 * - Atomically mark a guest session as consumed.
 * - Support execution inside an existing Prisma transaction.
 *
 * This service does not:
 * - Create guest sessions.
 * - Generate session tokens.
 * - Generate fingerprint hashes.
 * - Read cookies directly.
 * - Generate or persist ideas.
 *
 * Guest-session creation and cookie management should remain in
 * the authentication or guest-session boundary. This service
 * handles only the generation-related session rules.
 *
 * @author Malak
 */
@Injectable()
export class GuestIdeaSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a valid guest session by its public token.
   *
   * A session is considered valid when:
   * - A non-empty token is provided.
   * - A matching database record exists.
   * - The session has not expired.
   * - The session has not consumed its guest generation.
   *
   * @param sessionToken Public token received from the secure
   * guest-session cookie.
   * @returns Valid guest-session information.
   */
  async resolveAvailableSession(
    sessionToken: string,
  ): Promise<ResolvedGuestIdeaSession> {
    const normalizedToken = this.normalizeSessionToken(sessionToken);

    const guestSession = await this.prisma.guestSession.findUnique({
      where: {
        sessionToken: normalizedToken,
      },
      select: {
        id: true,
        hasGenerated: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    if (!guestSession) {
      this.throwInvalidSession();
    }

    this.assertNotExpired(guestSession);
    this.assertNotConsumed(guestSession);

    return guestSession;
  }

  /**
   * Resolves a guest session by its internal database identifier.
   *
   * This method is useful after the request boundary has already
   * resolved the session token and the generation pipeline only
   * carries the guest-session ID.
   *
   * @param guestSessionId Internal guest-session identifier.
   * @param db Optional Prisma transaction client.
   * @returns Valid guest-session information.
   */
  async resolveAvailableSessionById(
    guestSessionId: string,
    db: GuestSessionDatabaseClient = this.prisma,
  ): Promise<ResolvedGuestIdeaSession> {
    const normalizedId = this.normalizeGuestSessionId(guestSessionId);

    const guestSession = await db.guestSession.findUnique({
      where: {
        id: normalizedId,
      },
      select: {
        id: true,
        hasGenerated: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    if (!guestSession) {
      this.throwInvalidSession();
    }

    this.assertNotExpired(guestSession);
    this.assertNotConsumed(guestSession);

    return guestSession;
  }

  /**
   * Returns whether a guest session is currently eligible to
   * generate an idea.
   *
   * This method does not throw for missing, expired or consumed
   * sessions. It is intended for optional eligibility checks.
   *
   * The final generation persistence must still call consume()
   * because eligibility can change between validation and
   * persistence.
   *
   * @param guestSessionId Internal guest-session identifier.
   */
  async canGenerate(guestSessionId: string): Promise<boolean> {
    const normalizedId = guestSessionId?.trim();

    if (!normalizedId) {
      return false;
    }

    const guestSession = await this.prisma.guestSession.findUnique({
      where: {
        id: normalizedId,
      },
      select: {
        hasGenerated: true,
        expiresAt: true,
      },
    });

    if (!guestSession) {
      return false;
    }

    if (guestSession.hasGenerated) {
      return false;
    }

    return !this.isExpired(guestSession.expiresAt);
  }

  /**
   * Atomically consumes the single guest idea-generation
   * entitlement.
   *
   * This operation should be executed inside the same database
   * transaction that persists the generated idea. Therefore:
   * - The guest entitlement is consumed only when idea
   *   persistence succeeds.
   * - A failed transaction restores the entitlement.
   * - Two concurrent requests cannot consume the same session.
   *
   * The conditional update succeeds only when:
   * - The session exists.
   * - hasGenerated is still false.
   * - expiresAt is null or remains in the future.
   *
   * @param guestSessionId Internal guest-session identifier.
   * @param tx Existing Prisma transaction client.
   */
  async consume(
    guestSessionId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const normalizedId = this.normalizeGuestSessionId(guestSessionId);

    const now = new Date();

    const result = await tx.guestSession.updateMany({
      where: {
        id: normalizedId,
        hasGenerated: false,

        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: now,
            },
          },
        ],
      },
      data: {
        hasGenerated: true,
      },
    });

    if (result.count === 1) {
      return;
    }

    await this.throwConsumeFailure(normalizedId, tx);
  }

  /**
   * Retrieves a guest session without enforcing generation
   * eligibility.
   *
   * This method may be used by internal monitoring, debugging or
   * ownership-resolution workflows.
   *
   * Sensitive values such as sessionToken and fingerprintHash are
   * not selected.
   *
   * @param guestSessionId Internal guest-session identifier.
   * @returns Guest-session information or null.
   */
  async findById(
    guestSessionId: string,
  ): Promise<ResolvedGuestIdeaSession | null> {
    const normalizedId = guestSessionId?.trim();

    if (!normalizedId) {
      return null;
    }

    return this.prisma.guestSession.findUnique({
      where: {
        id: normalizedId,
      },
      select: {
        id: true,
        hasGenerated: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Determines the exact reason why a conditional consume
   * operation failed.
   *
   * The conditional update may fail because the session:
   * - Does not exist.
   * - Has expired.
   * - Has already been consumed.
   *
   * The database is queried again only on failure so the normal
   * successful path remains efficient.
   */
  private async throwConsumeFailure(
    guestSessionId: string,
    tx: Prisma.TransactionClient,
  ): Promise<never> {
    const guestSession = await tx.guestSession.findUnique({
      where: {
        id: guestSessionId,
      },
      select: {
        hasGenerated: true,
        expiresAt: true,
      },
    });

    if (!guestSession) {
      return this.throwInvalidSession();
    }

    if (this.isExpired(guestSession.expiresAt)) {
      return this.throwExpiredSession();
    }

    if (guestSession.hasGenerated) {
      return this.throwGenerationAlreadyUsed();
    }

    throw new ConflictException({
      code: 'GUEST_GENERATION_CONSUME_FAILED',
      message: 'The guest generation entitlement could not be consumed.',
    });
  }

  /**
   * Ensures that a guest session has not expired.
   */
  private assertNotExpired(
    guestSession: Pick<GuestSession, 'expiresAt'>,
  ): void {
    if (this.isExpired(guestSession.expiresAt)) {
      this.throwExpiredSession();
    }
  }

  /**
   * Ensures that a guest session has not already consumed its
   * permitted generation.
   */
  private assertNotConsumed(
    guestSession: Pick<GuestSession, 'hasGenerated'>,
  ): void {
    if (guestSession.hasGenerated) {
      this.throwGenerationAlreadyUsed();
    }
  }

  /**
   * Determines whether a nullable expiration date is in the past
   * or exactly equal to the current time.
   *
   * A null expiration date is treated as non-expired because the
   * current Prisma schema allows expiresAt to be nullable.
   */
  private isExpired(expiresAt: Date | null): boolean {
    return expiresAt !== null && expiresAt.getTime() <= Date.now();
  }

  /**
   * Normalizes and validates a public guest-session token.
   */
  private normalizeSessionToken(sessionToken: string): string {
    const normalizedToken = sessionToken?.trim();

    if (!normalizedToken) {
      this.throwInvalidSession();
    }

    return normalizedToken;
  }

  /**
   * Normalizes and validates an internal guest-session ID.
   */
  private normalizeGuestSessionId(guestSessionId: string): string {
    const normalizedId = guestSessionId?.trim();

    if (!normalizedId) {
      this.throwInvalidSession();
    }

    return normalizedId;
  }

  /**
   * Throws the standard error for a missing or invalid guest
   * session.
   */
  private throwInvalidSession(): never {
    throw new UnauthorizedException({
      code: 'INVALID_GUEST_SESSION',
      message: 'A valid guest session is required to generate an idea.',
    });
  }

  /**
   * Throws the standard error for an expired guest session.
   */
  private throwExpiredSession(): never {
    throw new UnauthorizedException({
      code: 'GUEST_SESSION_EXPIRED',
      message:
        'The guest session has expired. Start a new guest session or sign in.',
    });
  }

  /**
   * Throws the standard error when the guest already consumed
   * the single permitted generation.
   */
  private throwGenerationAlreadyUsed(): never {
    throw new ConflictException({
      code: 'GUEST_GENERATION_ALREADY_USED',
      message: 'This guest session has already used its free idea generation.',
    });
  }
}
