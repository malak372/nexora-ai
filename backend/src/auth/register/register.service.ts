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
 * Service responsible for user registration operations in Nexora AI.
 *
 * This service handles the complete registration flow, including:
 * - Creating new registered user accounts.
 * - Enforcing the default USER role to prevent privilege escalation.
 * - Initializing the free-tier idea generation limits.
 * - Supporting optional user type classification for analytics.
 * - Transferring guest-generated ideas to the new registered account.
 * - Sending email verification links after successful registration.
 * - Recording successful and failed registration events in authentication logs.
 *
 * New users are created with:
 * - USER role.
 * - NORMAL account status.
 * - Three free idea generation attempts.
 * - Zero used free generations.
 * - Zero credit balance.
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
     * If the email is already registered, the failed registration attempt
     * is recorded in the authentication audit log before rejecting the request.
     *
     * If a guest session token is provided, any guest-generated ideas linked
     * to that session are transferred to the newly registered user account.
     *
     * After successful registration, an email verification link is sent and
     * a successful registration audit log is recorded.
     *
     * @param dto Registration request data including full name, email,
     * password, optional user type, and optional guest session token.
     * @param meta Optional request metadata such as IP address and user agent.
     *
     * @returns Registered user data and number of transferred guest ideas.
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