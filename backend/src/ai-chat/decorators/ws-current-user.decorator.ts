/**
 * Provides the authenticated user attached to the current Socket.IO client.
 *
 * @author Eman
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { AuthenticatedSocket } from '../types/authenticated-socket.type';

/**
 * Resolves the authenticated user from socket.data.
 */
export const WsCurrentUser = createParamDecorator(
    (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
        const client = context.switchToWs().getClient<AuthenticatedSocket>();
        const user = client.data.user;

        if (!user) {
            throw new Error(
                'Authenticated socket user is unavailable after guard execution.',
            );
        }

        return user;
    },
);