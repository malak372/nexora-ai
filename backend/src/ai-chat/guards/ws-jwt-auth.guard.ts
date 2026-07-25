/**
 * Authenticates Socket.IO clients using the same JWT and account rules used by
 * protected HTTP endpoints.
 *
 * @author Eman
 */

import {
    CanActivate,
    ExecutionContext,
    Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_CHAT_ERROR_CODES } from '../constants/ai-chat.constants';
import type { AuthenticatedSocket } from '../types/authenticated-socket.type';

/**
 * Minimal access-token payload required by the WebSocket guard.
 */
type WsJwtPayload = {
    readonly sub: string;
    readonly iat?: number;
    readonly exp?: number;
};

/**
 * Gateway guard responsible for authenticating AI chat sockets.
 */
@Injectable()
export class WsJwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Authenticates the current WebSocket execution context.
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const client = context.switchToWs().getClient<AuthenticatedSocket>();

        await this.authenticateClient(client);

        return true;
    }

    /**
     * Authenticates one Socket.IO client and refreshes its current account data.
     *
     * New connections verify the JWT signature. Every later event revalidates
     * token expiry, account state, and password-change invalidation against the
     * database so a long-lived socket cannot retain revoked access.
     */
    async authenticateClient(client: AuthenticatedSocket): Promise<void> {
        if (client.data.user) {
            this.ensureConnectionTokenActive(client);

            client.data.user = await this.loadAllowedUser(
                client.data.user.id,
                client.data.accessTokenIssuedAt,
            );

            return;
        }

        const token = this.extractAccessToken(client);

        if (!token) {
            throw this.createAuthenticationException(
                AI_CHAT_ERROR_CODES.AUTHENTICATION_REQUIRED,
                'An access token is required to connect to AI Chat.',
            );
        }

        let payload: WsJwtPayload;

        try {
            payload = await this.jwtService.verifyAsync<WsJwtPayload>(token);
        } catch {
            throw this.createAuthenticationException(
                AI_CHAT_ERROR_CODES.INVALID_ACCESS_TOKEN,
                'The AI Chat access token is invalid or expired.',
            );
        }

        if (!payload.sub || !this.isValidExpiration(payload.exp)) {
            throw this.createAuthenticationException(
                AI_CHAT_ERROR_CODES.INVALID_ACCESS_TOKEN,
                'The AI Chat access token is invalid.',
            );
        }

        client.data.user = await this.loadAllowedUser(payload.sub, payload.iat);
        client.data.accessTokenIssuedAt = payload.iat;
        client.data.accessTokenExpiresAt = payload.exp;
    }

    /**
     * Loads the latest account state and applies the HTTP JWT strategy rules.
     */
    private async loadAllowedUser(
        userId: string,
        issuedAtSeconds: number | undefined,
    ): Promise<AuthenticatedUser> {
        const user = await this.prisma.user.findUnique({
            where: {
                id: userId,
            },
            select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
                accountStatus: true,
                userType: true,
                isActive: true,
                isVerified: true,
                deletedAt: true,
                passwordChangedAt: true,
            },
        });

        if (!user || !user.isActive || !user.isVerified || user.deletedAt) {
            throw this.createAuthenticationException(
                AI_CHAT_ERROR_CODES.USER_NOT_ALLOWED,
                'The authenticated account cannot access AI Chat.',
            );
        }

        if (
            user.passwordChangedAt &&
            this.wasIssuedBeforePasswordChange(
                issuedAtSeconds,
                user.passwordChangedAt,
            )
        ) {
            throw this.createAuthenticationException(
                AI_CHAT_ERROR_CODES.INVALID_ACCESS_TOKEN,
                'The AI Chat access token is no longer valid.',
            );
        }

        return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            accountStatus: user.accountStatus,
            userType: user.userType,
            isActive: user.isActive,
            isVerified: user.isVerified,
        };
    }

    /**
     * Rejects events sent after the connection access token expires.
     */
    private ensureConnectionTokenActive(client: AuthenticatedSocket): void {
        const expiresAt = client.data.accessTokenExpiresAt;

        if (!this.isValidExpiration(expiresAt)) {
            delete client.data.user;
            delete client.data.accessTokenIssuedAt;
            delete client.data.accessTokenExpiresAt;

            throw this.createAuthenticationException(
                AI_CHAT_ERROR_CODES.INVALID_ACCESS_TOKEN,
                'The AI Chat access token is invalid or expired.',
            );
        }
    }

    /**
     * Validates a JWT expiration timestamp against the current time.
     */
    private isValidExpiration(expiresAtSeconds: number | undefined): boolean {
        return (
            typeof expiresAtSeconds === 'number' &&
            Number.isSafeInteger(expiresAtSeconds) &&
            expiresAtSeconds * 1_000 > Date.now()
        );
    }

    /**
     * Extracts a bearer token from Socket.IO auth data or request headers.
     */
    private extractAccessToken(client: AuthenticatedSocket): string | null {
        const auth = client.handshake.auth as Record<string, unknown>;
        const authToken = auth.accessToken ?? auth.token;

        if (typeof authToken === 'string' && authToken.trim()) {
            return this.removeBearerPrefix(authToken);
        }

        const authorization = client.handshake.headers.authorization;

        if (typeof authorization === 'string' && authorization.trim()) {
            return this.removeBearerPrefix(authorization);
        }

        return null;
    }

    /**
     * Removes an optional Bearer prefix from an access-token value.
     */
    private removeBearerPrefix(value: string): string {
        return value.replace(/^Bearer\s+/i, '').trim();
    }

    /**
     * Determines whether the token predates the user's latest password change.
     */
    private wasIssuedBeforePasswordChange(
        issuedAtSeconds: number | undefined,
        passwordChangedAt: Date,
    ): boolean {
        if (issuedAtSeconds === undefined) {
            return true;
        }

        return issuedAtSeconds * 1_000 < passwordChangedAt.getTime();
    }

    /**
     * Creates a stable structured WebSocket authentication exception.
     */
    private createAuthenticationException(
        code:
            | typeof AI_CHAT_ERROR_CODES.AUTHENTICATION_REQUIRED
            | typeof AI_CHAT_ERROR_CODES.INVALID_ACCESS_TOKEN
            | typeof AI_CHAT_ERROR_CODES.USER_NOT_ALLOWED,
        message: string,
    ): WsException {
        return new WsException({
            code,
            message,
        });
    }
}