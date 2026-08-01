/**
 * Provides API operations for email verification.
 *
 * This module communicates with the backend endpoints responsible for:
 * - Verifying an email address through a secure token.
 * - Requesting a new verification email.
 *
 * UI state, routing, and presentation remain inside the verification page.
 *
 * @author Eman
 */

import { apiClient } from '../../../../../api/client';
/**
 * Extracts a readable message from an API error.
 *
 * @param {unknown} error - Error returned by Axios or JavaScript.
 * @returns {string} A safe message suitable for the interface.
 */
export function getEmailVerificationErrorMessage(error) {
    const responseMessage = error?.response?.data?.message;

    if (Array.isArray(responseMessage) && responseMessage.length > 0) {
        return responseMessage.join(' ');
    }

    if (
        typeof responseMessage === 'string' &&
        responseMessage.trim()
    ) {
        return responseMessage;
    }

    if (error?.code === 'ECONNABORTED') {
        return 'The request took too long. Please try again.';
    }

    if (!error?.response) {
        return 'The server is currently unavailable. Please check your connection.';
    }

    return 'Email verification could not be completed. Please try again.';
}

/**
 * Verifies a user's email address.
 *
 * The backend expects the email and verification token as query parameters.
 *
 * Endpoint:
 * GET /auth/email/verify?email=...&token=...
 *
 * @async
 * @param {{
 *     email: string,
 *     token: string
 * }} payload - Verification values received from the email link.
 *
 * @returns {Promise<Object>} Verification response returned by the backend.
 *
 * @throws {Error}
 * Throws a normalized error when verification fails.
 */
export async function verifyEmail(payload) {
    try {
        const response = await apiClient.get('/auth/email/verify', {
            params: {
                email: payload.email.trim().toLowerCase(),
                token: payload.token.trim(),
            },
        });

        return response.data;
    } catch (error) {
        throw new Error(
            getEmailVerificationErrorMessage(error),
        );
    }
}

/**
 * Requests a new verification email.
 *
 * Endpoint:
 * POST /auth/email/resend-verification
 *
 * @async
 * @param {string} email - Account email address.
 *
 * @returns {Promise<Object>} Resend response returned by the backend.
 *
 * @throws {Error}
 * Throws a normalized error when the request fails.
 */
export async function resendVerificationEmail(email) {
    try {
        const response = await apiClient.post(
            '/auth/email/resend-verification',
            {
                email: email.trim().toLowerCase(),
            },
        );

        return response.data;
    } catch (error) {
        throw new Error(
            getEmailVerificationErrorMessage(error),
        );
    }
}