/**
 * @file password-recovery.api.js
 * @description
 * Provides the frontend API functions used by the password-recovery flow.
 *
 * The module sends forgot-password and reset-password requests to the
 * authentication backend and converts backend or network failures into
 * clear messages that can be displayed safely in the user interface.
 *
 * @author Eman
 */

/**
 * Backend base URL without a trailing slash.
 *
 * @constant
 * @type {string}
 */
const API_BASE_URL = (
    process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000'
).replace(/\/$/, '');

/**
 * User-friendly message shown when the frontend cannot reach the backend.
 *
 * @constant
 * @type {string}
 */
const NETWORK_ERROR =
    'Unable to reach the server. Check your connection and try again.';

/**
 * Safely parses a JSON response body.
 *
 * Returns null when the response has no JSON body or the body cannot
 * be parsed.
 *
 * @async
 * @param {Response} response
 * The Fetch API response object.
 *
 * @returns {Promise<object|null>}
 * The parsed response body, or null when parsing fails.
 */
async function readJsonBody(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Converts backend and HTTP errors into a user-friendly message.
 *
 * @param {Response} response
 * The Fetch API response object.
 *
 * @param {object|null} body
 * The parsed backend response body.
 *
 * @param {string} fallback
 * The message used when the backend does not provide one.
 *
 * @returns {string}
 * An error message that can be displayed in the interface.
 */
function getErrorMessage(response, body, fallback) {
    if (response.status === 429) {
        return 'Too many attempts. Please wait a moment and try again.';
    }

    if (response.status >= 500) {
        return 'The server could not complete the request. Please try again.';
    }

    const backendMessage = Array.isArray(body?.message)
        ? body.message.join(' ')
        : body?.message;

    return backendMessage || fallback;
}

/**
 * Sends a JSON POST request to a password-recovery endpoint.
 *
 * @async
 * @param {string} path
 * The relative backend endpoint.
 *
 * @param {object} payload
 * The JSON request payload.
 *
 * @param {string} fallbackMessage
 * The message used when the backend does not return an error message.
 *
 * @returns {Promise<object>}
 * The parsed backend success response.
 *
 * @throws {Error}
 * Throws when the network request fails or the backend returns an error.
 */
async function postJson(path, payload, fallbackMessage) {
    let response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
    } catch {
        throw new Error(NETWORK_ERROR);
    }

    const body = await readJsonBody(response);

    if (!response.ok) {
        throw new Error(
            getErrorMessage(response, body, fallbackMessage),
        );
    }

    return body || {
        message: 'Request completed successfully.',
    };
}

/**
 * Requests a secure password-reset email for the supplied address.
 *
 * The email address is normalized before it is sent by removing
 * surrounding whitespace and converting it to lowercase.
 *
 * @param {string} email
 * The email address associated with the account.
 *
 * @returns {Promise<object>}
 * The generic backend confirmation response.
 */
export function requestPasswordReset(email) {
    return postJson(
        '/auth/password/forgot',
        {
            email: email.trim().toLowerCase(),
        },
        'Unable to send the reset link. Please try again.',
    );
}

/**
 * Replaces the account password using a valid password-recovery token.
 *
 * @param {string} token
 * The reset token received through the password-recovery email.
 *
 * @param {string} newPassword
 * The new password selected by the user.
 *
 * @returns {Promise<object>}
 * The backend confirmation response after resetting the password.
 */
export function resetPassword(token, newPassword) {
    return postJson(
        '/auth/password/reset',
        {
            token: token.trim(),
            newPassword,
        },
        'Unable to reset your password. Please request a new link.',
    );
}