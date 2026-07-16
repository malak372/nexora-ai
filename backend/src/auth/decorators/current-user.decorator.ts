import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * HTTP request containing a successfully authenticated user.
 */
type AuthenticatedRequest = {
  user?: AuthenticatedUser;
};

/**
 * Retrieves the currently authenticated user from the HTTP request.
 *
 * The user is attached to the request by Passport after successful
 * authentication through JwtAuthGuard and JwtStrategy.
 *
 * This decorator must only be used on routes protected by
 * JwtAuthGuard.
 *
 * @example
 *
 * @Get('me')
 * @UseGuards(JwtAuthGuard)
 * getCurrentUser(
 *   @CurrentUser() user: AuthenticatedUser,
 * ) {
 *   return user;
 * }
 *
 * @throws UnauthorizedException When no authenticated user exists
 * on the current request.
 *
 * @author Eman
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new UnauthorizedException(
        'Authenticated user was not found in the request.',
      );
    }

    return request.user;
  },
);
