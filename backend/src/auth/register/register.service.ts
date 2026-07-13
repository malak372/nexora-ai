import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import { AccountStatus, AuthAction, Prisma, UserRole } from '@prisma/client';

import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../prisma/prisma.service';

import { AuthAuditService, type AuthRequestMeta } from '../audit/audit.service';

import { RegisterDto } from '../dto/register.dto';

import { AuthEmailService } from '../email/email.service';

import { AuthGuestService } from '../guest/guest.service';

const SALT_ROUNDS = 10;

/**
 * Creates a registered account and transfers guest activity atomically.
 *
 * A transferred guest idea counts as one of the user's three free
 * generations.
 *
 * Example after transferring one guest idea:
 * - freeGenerationLimit = 3
 * - freeGenerationsUsed = 1
 * - remaining = 2
 *
 * Verification email delivery happens after the database transaction
 * commits successfully.
 *
 * @author Eman
 */
@Injectable()
export class AuthRegisterService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly authGuestService: AuthGuestService,

    private readonly authEmailService: AuthEmailService,

    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * Registers one user.
   */
  async register(
    dto: RegisterDto,

    meta?: AuthRequestMeta,

    guestSessionToken?: string,
  ) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },

      select: {
        id: true,

        email: true,
      },
    });

    if (existingUser) {
      await this.authAuditService.createLog({
        userId: existingUser.id,

        email: dto.email,

        action: AuthAction.REGISTER,

        isSuccess: false,

        message: 'Registration failed because email already exists',

        ...meta,
      });

      throw new BadRequestException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(
      dto.password,

      SALT_ROUNDS,
    );

    let result: Awaited<ReturnType<AuthRegisterService['createAccount']>>;

    try {
      result = await this.createAccount(
        dto,

        passwordHash,

        guestSessionToken,
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.authAuditService.createLog({
          email: dto.email,

          action: AuthAction.REGISTER,

          isSuccess: false,

          message: 'Registration failed because email already exists',

          ...meta,
        });

        throw new BadRequestException('Email already exists');
      }

      throw error;
    }

    /**
     * Email delivery is deliberately outside the transaction.
     *
     * External provider calls should not keep a database transaction
     * open or cause the committed user record to roll back.
     */
    try {
      await this.authEmailService.sendEmailVerificationLink(
        result.user.id,

        result.user.email,
      );
    } catch {
      await this.authAuditService.createLog({
        userId: result.user.id,

        email: result.user.email,

        action: AuthAction.REGISTER,

        isSuccess: true,

        message:
          'User registered successfully, but verification email delivery failed',

        ...meta,
      });

      throw new InternalServerErrorException(
        'The account was created, but the verification email could not be sent. Request a new verification email.',
      );
    }

    await this.authAuditService.createLog({
      userId: result.user.id,

      email: result.user.email,

      action: AuthAction.REGISTER,

      isSuccess: true,

      message: 'User registered successfully',

      ...meta,
    });

    return {
      message: 'Registered successfully. Please verify your email.',

      attachedGuestIdeasCount: result.attachment.transferredCount,

      attachedGuestIdeaIds: result.attachment.ideaIds,

      freeGenerations: {
        limit: result.user.freeGenerationLimit,

        used: result.user.freeGenerationsUsed,

        remaining: Math.max(
          0,

          result.user.freeGenerationLimit - result.user.freeGenerationsUsed,
        ),
      },

      user: result.user,
    };
  }

  /**
   * Creates the user and transfers guest ownership in one transaction.
   */
  private createAccount(
    dto: RegisterDto,

    passwordHash: string,

    guestSessionToken?: string,
  ) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdUser = await tx.user.create({
        data: {
          fullName: dto.fullName,

          email: dto.email,

          passwordHash,

          role: UserRole.USER,

          accountStatus: AccountStatus.NORMAL,

          freeGenerationLimit: 3,

          freeGenerationsUsed: 0,

          creditBalance: 0,

          userType: dto.userType,
        },

        select: {
          id: true,

          fullName: true,

          email: true,

          role: true,

          accountStatus: true,

          userType: true,

          freeGenerationLimit: true,

          freeGenerationsUsed: true,

          creditBalance: true,
        },
      });

      const attachment = await this.authGuestService.attachGuestIdeasToUser(
        guestSessionToken,

        createdUser.id,

        tx,
      );

      const user = await tx.user.findUniqueOrThrow({
        where: {
          id: createdUser.id,
        },

        select: {
          id: true,

          fullName: true,

          email: true,

          role: true,

          accountStatus: true,

          userType: true,

          freeGenerationLimit: true,

          freeGenerationsUsed: true,

          creditBalance: true,
        },
      });

      return {
        user,

        attachment,
      };
    });
  }
}
