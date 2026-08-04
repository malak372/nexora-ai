/**
 * Provides the current authenticated user's account-access information.
 *
 * The hook reads the locally stored user snapshot immediately, then refreshes
 * the latest account status and credit balance from the backend.
 *
 * It supports both NORMAL and PREMIUM users without changing the existing
 * normal-user routes or workspace structure.
 *
 * PREMIUM access is determined only by the user's account status.
 * It is not related to whether a specific idea is unlocked.
 *
 * @author Eman
 */

import { useCallback, useEffect, useState } from 'react';

import {
    getStoredUser,
    updateStoredUser,
} from '../../../auth/shared/auth.storage';
import {
    extractApiData,
    normalUserApi,
} from '../api/normalUserApi';

/**
 * Creates an account-access snapshot using the user information currently
 * stored in local storage.
 *
 * This allows the interface to render the last known account state while the
 * latest information is being requested from the backend.
 *
 * @returns {{
 *   accountStatus: string,
 *   creditBalance: number,
 *   isPremium: boolean,
 *   isLoading: boolean
 * }}
 */
const readSnapshot = () => {
    const user = getStoredUser() || {};

    const accountStatus = user.accountStatus || 'NORMAL';

    return {
        accountStatus,
        creditBalance: Number(user.creditBalance ?? 0),
        isPremium: accountStatus === 'PREMIUM',
        isLoading: true,
    };
};

/**
 * Returns the authenticated user's current account access state.
 *
 * The hook:
 * - Reads the locally stored account status.
 * - Requests the latest credit information from the backend.
 * - Synchronizes the returned values with the stored user.
 * - Reacts to user and credit update events.
 *
 * @returns {{
 *   accountStatus: string,
 *   creditBalance: number,
 *   isPremium: boolean,
 *   isLoading: boolean,
 *   refresh: Function
 * }}
 */
export default function useAccountAccess() {
    const [access, setAccess] = useState(readSnapshot);

    /**
     * Requests the latest account status and credit balance from the backend.
     *
     * If the request fails, the hook keeps using the last locally stored
     * account information instead of breaking the user interface.
     *
     * @returns {Promise<{
     *   accountStatus: string,
     *   creditBalance: number,
     *   isPremium: boolean,
     *   isLoading: boolean
     * }>}
     */
    const refresh = useCallback(async () => {
        try {
            const response = await normalUserApi.get('/users/credits');
            const payload = extractApiData(response) || {};

            const accountStatus = payload.accountStatus || 'NORMAL';

            const nextAccess = {
                accountStatus,
                creditBalance: Number(payload.creditBalance ?? 0),
                isPremium:
                    Boolean(payload.isPremium) ||
                    accountStatus === 'PREMIUM',
                isLoading: false,
            };

            setAccess(nextAccess);

            updateStoredUser({
                accountStatus: nextAccess.accountStatus,
                creditBalance: nextAccess.creditBalance,
            });

            return nextAccess;
        } catch {
            const fallbackAccess = {
                ...readSnapshot(),
                isLoading: false,
            };

            setAccess(fallbackAccess);

            return fallbackAccess;
        }
    }, []);

    useEffect(() => {
        refresh();

        /**
         * Updates the hook when the stored authenticated-user information changes.
         */
        const handleUserUpdate = () => {
            setAccess({
                ...readSnapshot(),
                isLoading: false,
            });
        };

        /**
         * The user-updated event refreshes the account information from storage.
         *
         * The credits-updated event requests the latest credit balance from the
         * backend after generation or credit purchase operations.
         */
        window.addEventListener(
            'nexora:user-updated',
            handleUserUpdate,
        );

        window.addEventListener(
            'nexora:credits-updated',
            refresh,
        );

        return () => {
            window.removeEventListener(
                'nexora:user-updated',
                handleUserUpdate,
            );

            window.removeEventListener(
                'nexora:credits-updated',
                refresh,
            );
        };
    }, [refresh]);

    return {
        ...access,
        refresh,
    };
}