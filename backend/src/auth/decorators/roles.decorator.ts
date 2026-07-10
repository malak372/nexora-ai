import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Defines metadata used for role-based authorization.
 *
 * `ROLES_KEY` stores the required roles, while the `Roles`
 * decorator assigns them to controllers or route handlers.
 *
 * @author Eman
 */
export const ROLES_KEY = 'roles';

/**
 * Custom decorator used to define the roles required
 * to access a specific route or controller.
 *
 * The assigned roles are stored as metadata and later
 * validated by the RolesGuard during request processing.
 *
 * @param roles - One or more user roles allowed to access the route.
 * @returns A metadata decorator containing the required roles.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
