import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Custom parameter decorator that retrieves the authenticated user
 * from the current HTTP request.
 *
 * This decorator is used with JwtAuthGuard in protected routes
 * to access the authenticated user object attached to the request
 * after successful JWT authentication.
 *
 * @param _data - Reserved parameter for future customization (unused).
 * @param ctx - The current execution context.
 * @returns The authenticated user object stored in the request.
 *
 * @author Eman
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);