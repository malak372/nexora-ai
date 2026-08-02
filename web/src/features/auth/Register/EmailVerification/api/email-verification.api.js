/**
 * Provides API operations for email verification by a six-digit code.
 *
 * @author Eman
 */
import { apiClient } from '../../../../../api/client';

export function getEmailVerificationErrorMessage(error) {
    const responseMessage = error?.response?.data?.message;

    if (Array.isArray(responseMessage) && responseMessage.length > 0) {
        return responseMessage.join(' ');
    }

    if (typeof responseMessage === 'string' && responseMessage.trim()) {
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
 * Verifies an email address using a six-digit verification code.
 *
 * @param {{ email: string, code: string }} payload
 * @returns {Promise<Object>}
 */
export async function verifyEmail(payload) {
    try {
        const response = await apiClient.post('/auth/email/verify', {
            email: payload.email.trim().toLowerCase(),
            code: payload.code.replace(/\D/g, '').slice(0, 6),
        });

        return response.data;
    } catch (error) {
        throw new Error(getEmailVerificationErrorMessage(error));
    }
}

/**
 * Requests a new email verification code.
 *
 * @param {string} email
 * @returns {Promise<Object>}
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
        throw new Error(getEmailVerificationErrorMessage(error));
    }
}