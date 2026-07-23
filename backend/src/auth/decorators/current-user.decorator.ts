import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * HTTP request containing a successfully authenticated user.
 *
 * Passport attaches this value after JwtAuthGuard validates
 * the access token through JwtStrategy.
 *
 * @author Eman
 */
type AuthenticatedRequest = {
  user?: AuthenticatedUser;
};

/**
 * Supported property names that may be extracted from the
 * authenticated user object.
 *
 * @author Eman
 */
type AuthenticatedUserProperty = keyof AuthenticatedUser;

/**
 * Retrieves the authenticated user, or one selected property,
 * from the current HTTP request.
 *
 * The route must be protected by JwtAuthGuard so Passport can
 * attach the authenticated user to request.user.
 *
 * Usage examples:
 *
 * @example
 * ```ts
 * @CurrentUser() user: AuthenticatedUser
 * ```
 *
 * @example
 * ```ts
 * @CurrentUser('id') userId: string
 * ```
 *
 * @throws UnauthorizedException When the request does not contain
 * an authenticated user.
 *
 * @throws UnauthorizedException When the requested user property
 * does not exist or resolves to undefined.
 *
 * @author Eman
 */
export const CurrentUser = createParamDecorator<
  AuthenticatedUserProperty | undefined,
  AuthenticatedUser | AuthenticatedUser[AuthenticatedUserProperty]
>((property, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const user = request.user;

  if (!user) {
    throw new UnauthorizedException(
      'Authenticated user was not found in the request.',
    );
  }

  if (property === undefined) {
    return user;
  }

  const value = user[property];

  if (value === undefined) {
    throw new UnauthorizedException(
      `Authenticated user property "${property}" was not found.`,
    );
  }

  return value;
});
