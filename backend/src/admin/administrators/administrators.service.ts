import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  UserRole,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt } from 'crypto';

import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

import { AcceptAdminInvitationDto } from './dto/accept-admin-invitation.dto';
import { CreateAdminInvitationDto } from './dto/create-admin-invitation.dto';

const ADMIN_INVITATION_LIFETIME_HOURS = 24;
const ADMIN_PASSWORD_SALT_ROUNDS = 10;

/**
 * Owns the complete administrator invitation lifecycle.
 *
 * Important account semantics:
 * - ADMIN is an authorization role, not a subscription plan.
 * - Admin accounts use AccountStatus.NOT_APPLICABLE.
 * - Admin accounts have zero credits and zero free-generation entitlement.
 * - Public registration never creates administrators.
 */
@Injectable()
export class AdministratorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Returns staff accounts plus outstanding invitations.
   *
   * The current administrator is included and marked `isCurrent` because a
   * dedicated staff directory should show the whole administration team.
   * Destructive self-actions are intentionally not exposed.
   */
  async getWorkspace(currentAdminId: string) {
    const now = new Date();

    const [administrators, invitations] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          role: UserRole.ADMIN,
          deletedAt: null,
        },
        orderBy: [
          { createdAt: 'asc' },
          { fullName: 'asc' },
        ],
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          accountStatus: true,
          isActive: true,
          isVerified: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          avatarUrl: true,
        },
      }),

      this.prisma.adminInvitation.findMany({
        where: {
          acceptedAt: null,
          cancelledAt: null,
          expiresAt: {
            gt: now,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          expiresAt: true,
          createdAt: true,
          invitedBy: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      administrators: administrators.map((admin) => ({
        ...admin,
        isCurrent: admin.id === currentAdminId,
        planLabel: 'Staff',
        hasGenerationEntitlement: false,
      })),
      invitations,
      summary: {
        activeAdministrators: administrators.filter((admin) => admin.isActive).length,
        pendingInvitations: invitations.length,
      },
    };
  }

  /**
   * Invites one specific email address to become an administrator.
   *
   * A fresh eight-digit code is generated, only its SHA-256 hash is stored,
   * and the plain code exists only in the outbound email.
   */
  async invite(
    dto: CreateAdminInvitationDto,
    currentAdminId: string,
  ) {
    const email = dto.email.trim().toLowerCase();
    const fullName = dto.fullName.trim();

    const [existingUser, currentAdmin] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          role: true,
        },
      }),
      this.prisma.user.findFirst({
        where: {
          id: currentAdminId,
          role: UserRole.ADMIN,
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      }),
    ]);

    if (!currentAdmin) {
      throw new NotFoundException('Administrator account not found.');
    }

    if (existingUser) {
      throw new BadRequestException(
        existingUser.role === UserRole.ADMIN
          ? 'This email already belongs to an administrator.'
          : 'This email already belongs to a platform user.',
      );
    }

    const invitationCode = this.generateInvitationCode();
    const codeHash = this.hashCode(invitationCode);
    const expiresAt = this.buildExpiration();

    /*
     * Only one pending invitation per email is kept active. Older invitations
     * remain in the database for traceability but can no longer be accepted.
     */
    await this.prisma.adminInvitation.updateMany({
      where: {
        email,
        acceptedAt: null,
        cancelledAt: null,
      },
      data: {
        cancelledAt: new Date(),
      },
    });

    const invitation = await this.prisma.adminInvitation.create({
      data: {
        fullName,
        email,
        codeHash,
        expiresAt,
        invitedById: currentAdminId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    try {
      await this.mailService.sendAdminInvitationEmail({
        email,
        fullName,
        invitationCode,
        invitedByName: currentAdmin.fullName,
        expiresAt,
      });
    } catch (error) {
      await this.prisma.adminInvitation
        .update({
          where: { id: invitation.id },
          data: { cancelledAt: new Date() },
        })
        .catch(() => undefined);

      throw error;
    }

    return {
      message: 'Administrator invitation sent successfully.',
      invitation,
    };
  }

  /**
   * Issues a new one-time code for an existing pending invitation.
   */
  async resend(invitationId: string, currentAdminId: string) {
    const invitation = await this.prisma.adminInvitation.findFirst({
      where: {
        id: invitationId,
        acceptedAt: null,
        cancelledAt: null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Pending administrator invitation not found.');
    }

    const currentAdmin = await this.prisma.user.findFirst({
      where: {
        id: currentAdminId,
        role: UserRole.ADMIN,
        deletedAt: null,
        isActive: true,
      },
      select: {
        fullName: true,
      },
    });

    if (!currentAdmin) {
      throw new NotFoundException('Administrator account not found.');
    }

    const invitationCode = this.generateInvitationCode();
    const codeHash = this.hashCode(invitationCode);
    const expiresAt = this.buildExpiration();

    await this.prisma.adminInvitation.update({
      where: { id: invitation.id },
      data: {
        codeHash,
        expiresAt,
      },
    });

    await this.mailService.sendAdminInvitationEmail({
      email: invitation.email,
      fullName: invitation.fullName,
      invitationCode,
      invitedByName: currentAdmin.fullName,
      expiresAt,
    });

    return {
      message: 'A new administrator invitation code was sent.',
      expiresAt,
    };
  }

  /**
   * Cancels an unused invitation.
   */
  async cancel(invitationId: string) {
    const updated = await this.prisma.adminInvitation.updateMany({
      where: {
        id: invitationId,
        acceptedAt: null,
        cancelledAt: null,
      },
      data: {
        cancelledAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Pending administrator invitation not found.');
    }

    return {
      message: 'Administrator invitation cancelled.',
    };
  }

  /**
   * Converts a valid invitation into a verified ADMIN account.
   *
   * The invitation code itself is the mailbox-verification proof, so the new
   * administrator is immediately marked verified and can sign in normally.
   */
  async accept(dto: AcceptAdminInvitationDto) {
    const email = dto.email.trim().toLowerCase();
    const codeHash = this.hashCode(dto.code);
    const now = new Date();

    const invitation = await this.prisma.adminInvitation.findFirst({
      where: {
        email,
        codeHash,
        acceptedAt: null,
        cancelledAt: null,
        expiresAt: {
          gt: now,
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (!invitation) {
      throw new BadRequestException(
        'Invitation code is invalid, expired, or no longer active.',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new BadRequestException(
        'An account already exists for this email address.',
      );
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      ADMIN_PASSWORD_SALT_ROUNDS,
    );

    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const createdAdmin = await tx.user.create({
          data: {
            fullName: invitation.fullName,
            email: invitation.email,
            passwordHash,
            role: UserRole.ADMIN,

            /*
             * Staff are not customers. This value is intentionally different
             * from NORMAL/PREMIUM and keeps subscription semantics clean.
             */
            accountStatus: AccountStatus.NOT_APPLICABLE,

            userType: UserType.OTHER,
            freeGenerationLimit: 0,
            freeGenerationsUsed: 0,
            creditBalance: 0,

            isActive: true,
            isVerified: true,
            emailVerifiedAt: now,
            passwordChangedAt: now,
          },
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            accountStatus: true,
            isActive: true,
            isVerified: true,
            createdAt: true,
          },
        });

        const accepted = await tx.adminInvitation.updateMany({
          where: {
            id: invitation.id,
            acceptedAt: null,
            cancelledAt: null,
            expiresAt: {
              gt: now,
            },
          },
          data: {
            acceptedAt: now,
          },
        });

        if (accepted.count !== 1) {
          throw new BadRequestException(
            'This administrator invitation is no longer active.',
          );
        }

        return createdAdmin;
      },
    );

    return {
      message: 'Administrator account activated. You can now sign in.',
      administrator: result,
    };
  }

  private generateInvitationCode(): string {
    return randomInt(10_000_000, 100_000_000).toString();
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code.trim()).digest('hex');
  }

  private buildExpiration(): Date {
    return new Date(
      Date.now() + ADMIN_INVITATION_LIFETIME_HOURS * 60 * 60 * 1000,
    );
  }
}