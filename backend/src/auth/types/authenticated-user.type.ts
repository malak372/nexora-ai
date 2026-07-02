import { AccountStatus, UserRole, UserType } from '@prisma/client';

/**
 * Represents the authenticated user attached to the
 * current HTTP request after successful JWT authentication.
 *
 * This interface defines the user information returned by
 * the JWT authentication strategy and made available through
 * the CurrentUser decorator in protected endpoints.
 *
 * It includes the user's identity, authorization role,
 * account status, optional user type, and account
 * verification state.
 *
 * @author Eman
 */
export interface AuthenticatedUser {
    /**
     * Unique user identifier.
     */
    id: string;

    /**
     * User email address.
     */
    email: string;

    /**
     * User full name.
     */
    fullName: string;

    /**
     * User authorization role.
     */
    role: UserRole;

    /**
     * Current account status.
     */
    accountStatus: AccountStatus;

    /**
     * User classification used for personalization
     * and analytics.
     */
    userType: UserType | null;

    /**
     * Indicates whether the account is active.
     */
    isActive: boolean;

    /**
     * Indicates whether the user's email address
     * has been verified.
     */
    isVerified: boolean;
}