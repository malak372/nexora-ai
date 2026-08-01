/**
 * Authentication API operations for the login flow.
 *
 * Responsibilities:
 * - Normalize credentials before sending them.
 * - Call the backend login endpoint.
 * - Convert backend failures into safe user-facing messages.
 *
 * @author Malak
 */

const API_BASE_URL = (
    process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000'
).replace(/\/$/, '');

const DEFAULT_LOGIN_ERROR = 'Invalid email or password.';
const NETWORK_ERROR =
    'Unable to reach the server. Check your connection and try again.';

/**
 * Safely reads a JSON response body.
 *
 * @param {Response} response HTTP response.
 * @returns {Promise<Object|null>} Parsed body or null.
 */
async function readJsonBody(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Returns a safe login error message.
 *
 * Authentication failures intentionally use one generic message so the UI
 * does not reveal whether a specific email address exists in the database.
 * Validation and unexpected server errors may still use a backend message.
 *
 * @param {Response} response HTTP response.
 * @param {Object|null} body Parsed response body.
 * @returns {string} User-facing error message.
 */
function getLoginErrorMessage(response, body) {
    if (response.status === 400 || response.status === 401 || response.status === 404) {
        return DEFAULT_LOGIN_ERROR;
    }

    if (response.status === 429) {
        return 'Too many sign-in attempts. Please wait a moment and try again.';
    }

    if (response.status >= 500) {
        return 'The server could not complete the sign-in request. Please try again.';
    }

    const backendMessage = Array.isArray(body?.message)
        ? body.message.join(' ')
        : body?.message;

    return backendMessage || 'Unable to sign in. Please try again.';
}

/**
 * Authenticates a user using email and password.
 *
 * The frontend validates only the email format. Whether the account exists
 * and whether the password is correct are both verified by the backend.
 *
 * @param {{email: string, password: string}} credentials Login credentials.
 * @returns {Promise<Object>} Authentication session returned by the backend.
 * @throws {Error} Safe authentication or network error.
 */
export async function login(credentials) {
    let response;

    try {
        response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: credentials.email.trim().toLowerCase(),
                password: credentials.password,
            }),
        });
    } catch {
        const error = new Error(NETWORK_ERROR);
        error.code = 'NETWORK_ERROR';
        throw error;
    }

    const body = await readJsonBody(response);

    if (!response.ok) {
        const error = new Error(getLoginErrorMessage(response, body));
        error.status = response.status;
        throw error;
    }

    if (!body) {
        throw new Error(
            'The server returned an invalid response. Please try again.',
        );
    }

    return body;
}
