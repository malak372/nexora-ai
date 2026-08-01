/**
 * Provides API operations for user registration.
 *
 * This module is responsible only for communicating with the
 * registration endpoint. Form state, validation, navigation,
 * and presentation logic remain inside the registration feature.
 *
 * @author Eman
 */

import { apiClient } from '../../../../api/client';

/**
 * Extracts a readable error message from an API error.
 *
 * @param {unknown} error - Error returned by Axios or JavaScript.
 * @returns {string} A safe message suitable for the interface.
 */
export function getRegisterErrorMessage(error) {
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

    return 'Registration could not be completed. Please try again.';
}

/**
 * Registers a new Nexora user.
 *
 * The payload follows the backend registration DTO and includes:
 * - Full name.
 * - Email address.
 * - Password.
 * - User type.
 *
 * Confirm password is validated in the frontend only and is intentionally
 * excluded from the API payload because it is not part of the backend DTO.
 *
 * @async
 * @param {{
 *     fullName: string,
 *     email: string,
 *     password: string,
 *     userType: string
 * }} payload - Registration values accepted by the backend.
 *
 * @returns {Promise<Object>} Registration response returned by the backend.
 *
 * @throws {import('axios').AxiosError}
 * Throws when registration fails.
 */
export async function registerUser(payload) {
    const response = await apiClient.post('/auth/register', {
        fullName: payload.fullName.trim(),
        email: payload.email.trim().toLowerCase(),
        password: payload.password,
        userType: payload.userType,
    });

    return response.data;
}