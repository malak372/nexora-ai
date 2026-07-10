import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Represents the authenticated user extracted from the JWT payload.
 *
 * The object is attached to the request by the JWT authentication strategy
 * after successful token validation.
 *
 * @author Malak
 */
export type JwtCurrentUser = {
  /**
   * Unique identifier of the authenticated user.
   */
  id: string;

  /**
   * User email address.
   */
  email: string;

  /**
   * User role.
   */
  role: UserRole;
};

/**
 * Custom parameter decorator for accessing the authenticated user
 * from the current HTTP request.
 *
 * This decorator retrieves the user object attached to the request
 * by the JWT authentication guard, eliminating the need to access
 * request.user directly inside controllers.
 *
 * @author Malak
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtCurrentUser => {
    const request = ctx.switchToHttp().getRequest();

    return request.user as JwtCurrentUser;
  },
);