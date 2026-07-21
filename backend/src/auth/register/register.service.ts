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

const DEFAULT_FREE_GENERATION_LIMIT = 3;
const DEFAULT_FREE_GENERATIONS_USED = 0;
const DEFAULT_CREDIT_BALANCE = 0;

const EMAIL_ALREADY_EXISTS_MESSAGE = 'Email already exists';

const REGISTRATION_SUCCESS_MESSAGE =
  'Registered successfully. Please verify your email.';

const REGISTRATION_AUDIT_SUCCESS_MESSAGE = 'User registered successfully';

const REGISTRATION_EMAIL_FAILURE_MESSAGE =
  'The account was created, but the verification email could not be sent. Request a new verification email.';

/**
 * Public user fields returned after registration.
 */
const REGISTERED_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  accountStatus: true,
  userType: true,
  freeGenerationLimit: true,
  freeGenerationsUsed: true,
  creditBalance: true,
} satisfies Prisma.UserSelect;

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
 * Verification-email delivery happens after the database transaction
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
   * Registers a user and optionally transfers eligible guest activity.
   *
   * @param dto - User registration data.
   * @param meta - Optional request metadata.
   * @param guestSessionToken - Optional guest-session token.
   * @returns Registration result and guest-attachment summary.
   *
   * @throws BadRequestException when the email is already registered.
   * @throws InternalServerErrorException when the account is created
   * but the verification email cannot be delivered.
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
      await this.logDuplicateEmailRegistration(
        dto.email,
        meta,
        existingUser.id,
      );

      throw new BadRequestException(EMAIL_ALREADY_EXISTS_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    let result: Awaited<ReturnType<AuthRegisterService['createAccount']>>;

    try {
      result = await this.createAccount(dto, passwordHash, guestSessionToken);
    } catch (error: unknown) {
      if (this.isEmailUniqueConstraintViolation(error)) {
        await this.logDuplicateEmailRegistration(dto.email, meta);

        throw new BadRequestException(EMAIL_ALREADY_EXISTS_MESSAGE);
      }

      throw error;
    }

    /**
     * Email delivery remains outside the database transaction.
     *
     * External service calls should not keep a database transaction
     * open or roll back an already-created user account.
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
        REGISTRATION_EMAIL_FAILURE_MESSAGE,
      );
    }

    await this.authAuditService.createLog({
      userId: result.user.id,
      email: result.user.email,
      action: AuthAction.REGISTER,
      isSuccess: true,
      message: REGISTRATION_AUDIT_SUCCESS_MESSAGE,
      ...meta,
    });

    return {
      message: REGISTRATION_SUCCESS_MESSAGE,

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
   * Creates the account and transfers guest activity
   * inside one database transaction.
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
          freeGenerationLimit: DEFAULT_FREE_GENERATION_LIMIT,
          freeGenerationsUsed: DEFAULT_FREE_GENERATIONS_USED,
          creditBalance: DEFAULT_CREDIT_BALANCE,
          userType: dto.userType,
        },
        select: REGISTERED_USER_SELECT,
      });

      const attachment = await this.authGuestService.attachGuestIdeasToUser(
        guestSessionToken,
        createdUser.id,
        tx,
      );

      /**
       * Reload the user because transferring a guest idea may
       * increment freeGenerationsUsed.
       */
      const user = await tx.user.findUniqueOrThrow({
        where: {
          id: createdUser.id,
        },
        select: REGISTERED_USER_SELECT,
      });

      return {
        user,
        attachment,
      };
    });
  }

  /**
   * Records a failed registration caused by an existing email.
   */
  private async logDuplicateEmailRegistration(
    email: string,
    meta?: AuthRequestMeta,
    userId?: string,
  ): Promise<void> {
    await this.authAuditService.createLog({
      userId,
      email,
      action: AuthAction.REGISTER,
      isSuccess: false,
      message: 'Registration failed because email already exists',
      ...meta,
    });
  }

  /**
   * Determines whether a Prisma unique-constraint error
   * was specifically caused by the user's email field.
   */
  private isEmailUniqueConstraintViolation(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;

    if (Array.isArray(target)) {
      return target.some(
        (field) =>
          typeof field === 'string' && field.toLowerCase().includes('email'),
      );
    }

    return typeof target === 'string' && target.toLowerCase().includes('email');
  }
}
