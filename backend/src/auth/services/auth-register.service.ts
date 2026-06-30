import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from '../dto/register.dto';
import { AuthTokenService } from './auth-token.service';
import { AuthGuestService } from './auth-guest.service';
import { AuthEmailService } from './auth-email.service';

const SALT_ROUNDS = 10;

/**
 * Service responsible for user registration operations.
 *
 * Handles:
 * - Creating normal user accounts.
 * - Hashing user passwords.
 * - Initializing free generation limits and credit balance.
 * - Transferring guest-generated ideas to the new account.
 * - Sending email verification links.
 * - Generating initial access and refresh tokens.
 *
 * @author Eman
 */
@Injectable()
export class AuthRegisterService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authTokenService: AuthTokenService,
        private readonly authGuestService: AuthGuestService,
        private readonly authEmailService: AuthEmailService,
    ) { }

    /**
     * Registers a new user account.
     *
     * The created account starts as a normal user with:
     * - 3 free idea generations.
     * - 0 used free generations.
     * - 0 credit balance.
     *
     * If a guest session token is provided, any guest-generated
     * ideas are transferred to the newly registered user.
     *
     * After registration, an email verification link is sent
     * and authentication tokens are returned.
     *
     * @param dto - Registration request data.
     * @returns Registered user data, access token, refresh token,
     * and number of transferred guest ideas.
     *
     * @throws BadRequestException if the email is already registered.
     * @throws UnauthorizedException if the newly created user cannot be retrieved.
     */
    async register(dto: RegisterDto) {
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
            },
        });

        const attachedGuestIdeasCount =
            await this.authGuestService.attachGuestIdeasToUser(
                dto.guestSessionToken,
                user.id,
            );

        const updatedUser = await this.prisma.user.findUnique({
            where: { id: user.id },
        });

        if (!updatedUser) {
            throw new UnauthorizedException('User not found');
        }

        await this.authEmailService.sendEmailVerificationLink(
            updatedUser.id,
            updatedUser.email,
        );

        const accessToken =
            await this.authTokenService.generateAccessToken(updatedUser);

        const refreshToken =
            await this.authTokenService.generateRefreshToken(updatedUser.id);

        return {
            message: 'Registered successfully',
            accessToken,
            refreshToken,
            attachedGuestIdeasCount,
            user: {
                id: updatedUser.id,
                fullName: updatedUser.fullName,
                email: updatedUser.email,
                role: updatedUser.role,
                accountStatus: updatedUser.accountStatus,
                freeGenerationLimit: updatedUser.freeGenerationLimit,
                freeGenerationsUsed: updatedUser.freeGenerationsUsed,
                creditBalance: updatedUser.creditBalance,
            },
        };
    }
}