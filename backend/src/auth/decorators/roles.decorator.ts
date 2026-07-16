import { SetMetadata } from '@nestjs/common';

import { UserRole } from '@prisma/client';

/**
 * Metadata key used by RolesGuard to retrieve
 * the roles required to access a route.
 *
 * @author Eman
 */
export const ROLES_KEY = 'roles';

/**
 * Defines the roles allowed to access a controller
 * or route handler.
 *
 * The assigned roles are stored as metadata and
 * later validated by RolesGuard.
 *
 * @param roles Allowed user roles.
 */
export const Roles = (
    ...roles: UserRole[]
) => SetMetadata(ROLES_KEY, roles);