import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AccountStatus, AuthAction, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from '../dto/register.dto';
import { AuthGuestService } from '../guest/guest.service';
import { AuthEmailService } from '../email/email.service';
import {
    AuthAuditService,
    AuthRequestMeta,
} from '../audit/audit.service';

const SALT_ROUNDS = 10;

/**
 * Service responsible for user registration operations.
 *
 * Handles the creation of registered user accounts in Nexora AI.
 * Newly registered users are created as normal users with:
 * - USER role.
 * - NORMAL account status.
 * - Three free idea generation attempts.
 * - Zero used free generations.
 * - Zero credit balance.
 * - Optional user type for personalization and analytics.
 *
 * This service also supports transferring guest-generated ideas
 * to the newly registered account when a valid guest session token
 * is provided.
 *
 * After successful registration, the system sends an email verification
 * link and records the registration event in the authentication audit log.
 *
 * Access and refresh tokens are not issued during registration because
 * the user must verify their email before logging in.
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
    ) { }

    /**
     * Registers a new user account.
     *
     * The created account is initialized according to Nexora AI's
     * free-tier access model. Each registered user starts with three
     * free idea generation attempts and no credits.
     *
     * If the user previously generated an idea as a guest, the provided
     * guest session token is used to transfer guest-generated ideas to
     * the newly created account and update the used free generation count.
     *
     * The user's role is always assigned internally as USER to prevent
     * privilege escalation. The user type, if provided, is used only for
     * analytics and personalization, not for authorization.
     *
     * After registration, an email verification link is sent. The user
     * must verify their email before logging in and receiving authentication
     * tokens.
     *
     * @param dto Registration request data including full name, email,
     * password, optional user type, and optional guest session token.
     * @param meta Optional request metadata such as IP address and user agent.
     *
     * @returns Registered user data and the number of transferred guest ideas.
     *
     * @throws BadRequestException if the email address is already registered.
     * @throws UnauthorizedException if the newly created user cannot be retrieved.
     */
    async register(
        dto: RegisterDto,
        meta?: AuthRequestMeta,
    ) {
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existingUser) {
            throw new BadRequestException('Email already exists');
        }

        const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

        const user = await this.prisma.user.create({
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
        });

        const attachedGuestIdeasCount =
            await this.authGuestService.attachGuestIdeasToUser(
                dto.guestSessionToken,
                user.id,
            );

        const updatedUser = await this.prisma.user.findUnique({
            where: { id: user.id },
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

        if (!updatedUser) {
            throw new UnauthorizedException('User not found');
        }

        await this.authEmailService.sendEmailVerificationLink(
            updatedUser.id,
            updatedUser.email,
        );

        await this.authAuditService.createLog({
            userId: updatedUser.id,
            email: updatedUser.email,
            action: AuthAction.REGISTER,
            isSuccess: true,
            message: 'User registered successfully',
            ...meta,
        });

        return {
            message: 'Registered successfully. Please verify your email',
            attachedGuestIdeasCount,
            user: {
                id: updatedUser.id,
                fullName: updatedUser.fullName,
                email: updatedUser.email,
                role: updatedUser.role,
                accountStatus: updatedUser.accountStatus,
                userType: updatedUser.userType,
                freeGenerationLimit: updatedUser.freeGenerationLimit,
                freeGenerationsUsed: updatedUser.freeGenerationsUsed,
                creditBalance: updatedUser.creditBalance,
            },
        };
    }
}