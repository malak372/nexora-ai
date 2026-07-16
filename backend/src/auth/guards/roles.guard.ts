import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Represents the authenticated user data required
 * by the role authorization guard.
 */
type AuthenticatedUser = {
  /**
   * Role assigned to the authenticated user.
   */
  role: UserRole;
};

/**
 * Represents the minimal HTTP request shape required
 * by the role authorization guard.
 */
type RequestWithUser = {
  /**
   * Authenticated user attached by the authentication guard.
   *
   * The property may be undefined when authentication
   * has not been completed successfully.
   */
  user?: AuthenticatedUser;
};

/**
 * Guard that enforces role-based authorization.
 *
 * This guard retrieves the required roles defined by the
 * `@Roles()` decorator and verifies that the authenticated
 * user has one of the allowed roles before granting access.
 *
 * @author Eman
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  /**
   * Determines whether the current request is authorized
   * based on the user's assigned role.
   *
   * @param context - The current execution context.
   * @returns `true` if the user has one of the required roles
   * or if no roles are defined; otherwise, `false`.
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
}