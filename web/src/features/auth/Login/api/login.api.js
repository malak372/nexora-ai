/**
 * Login API
 *
 * Handles:
 * - User login request.
 * - Invalid email/password errors.
 * - Temporary account lock information.
 * - Lock countdown data.
 */

const API_BASE_URL = (
    process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000'
).replace(/\/$/, '');

const INVALID_CREDENTIALS_MESSAGE =
    'Invalid email or password.';

const NETWORK_ERROR_MESSAGE =
    'Unable to reach the server. Check your connection and try again.';

const ACCOUNT_TEMPORARILY_LOCKED_CODE =
    'ACCOUNT_TEMPORARILY_LOCKED';

/**
 * Safely parse the response body.
 *
 * @param {Response} response
 * @returns {Promise<Object|null>}
 */
async function readJsonBody(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Read the backend error message.
 *
 * @param {Object|null} body
 * @returns {string|null}
 */
function getBackendMessage(body) {
    if (Array.isArray(body?.message)) {
        return body.message.join(' ');
    }

    if (
        typeof body?.message === 'string' &&
        body.message.trim()
    ) {
        return body.message.trim();
    }

    return null;
}

/**
 * Calculate the remaining lock seconds.
 *
 * Priority:
 * 1. lockedUntil returned by backend.
 * 2. remainingSeconds returned by backend.
 * 3. Retry-After response header.
 *
 * @param {Response} response
 * @param {Object|null} body
 * @returns {number|null}
 */
function getRemainingSeconds(response, body) {
    if (body?.lockedUntil) {
        const lockedUntilTimestamp = Date.parse(
            body.lockedUntil,
        );

        if (!Number.isNaN(lockedUntilTimestamp)) {
            const remainingSeconds = Math.ceil(
                (lockedUntilTimestamp - Date.now()) / 1000,
            );

            if (remainingSeconds > 0) {
                return remainingSeconds;
            }
        }
    }

    const bodyRemainingSeconds = Number(
        body?.remainingSeconds,
    );

    if (
        Number.isFinite(bodyRemainingSeconds) &&
        bodyRemainingSeconds > 0
    ) {
        return Math.ceil(bodyRemainingSeconds);
    }

    const retryAfter = response.headers.get(
        'retry-after',
    );

    if (!retryAfter) {
        return null;
    }

    const retryAfterSeconds = Number(retryAfter);

    if (
        Number.isFinite(retryAfterSeconds) &&
        retryAfterSeconds > 0
    ) {
        return Math.ceil(retryAfterSeconds);
    }

    const retryDate = Date.parse(retryAfter);

    if (!Number.isNaN(retryDate)) {
        const remainingSeconds = Math.ceil(
            (retryDate - Date.now()) / 1000,
        );

        if (remainingSeconds > 0) {
            return remainingSeconds;
        }
    }

    return null;
}

/**
 * Build the locked account error.
 *
 * @param {Response} response
 * @param {Object|null} body
 * @returns {Error}
 */
function createLockedAccountError(response, body) {
    const remainingSeconds = getRemainingSeconds(
        response,
        body,
    );

    const lockedUntil =
        body?.lockedUntil ||
        (
            remainingSeconds
                ? new Date(
                    Date.now() +
                    remainingSeconds * 1000,
                ).toISOString()
                : null
        );

    const error = new Error(
        'Your account is temporarily locked.',
    );

    error.status = response.status;
    error.code = ACCOUNT_TEMPORARILY_LOCKED_CODE;
    error.type = 'locked';
    error.title = 'Account temporarily locked';

    error.justLocked =
        body?.justLocked === true ||
        body?.newlyLocked === true ||
        body?.lockApplied === true;

    error.remainingSeconds = remainingSeconds;

    error.lockDurationMinutes =
        Number(body?.lockDurationMinutes) > 0
            ? Number(body.lockDurationMinutes)
            : null;

    error.lockedAt = body?.lockedAt || null;
    error.lockedUntil = lockedUntil;

    error.loginLockLevel =
        Number(body?.loginLockLevel) > 0
            ? Number(body.loginLockLevel)
            : null;

    return error;
}

/**
 * Build a structured frontend error.
 *
 * @param {Response} response
 * @param {Object|null} body
 * @returns {Error}
 */
function createLoginError(response, body) {
    const backendMessage = getBackendMessage(body);
    const code = body?.code;

    const isLocked =
        code === ACCOUNT_TEMPORARILY_LOCKED_CODE ||
        response.status === 429;

    if (isLocked) {
        return createLockedAccountError(
            response,
            body,
        );
    }

    if (
        code === 'LOGIN_ATTEMPTS_WARNING' &&
        (
            Number(body?.attemptsRemaining) === 1 ||
            Number(body?.attemptsRemaining) === 2
        )
    ) {
        const attemptsRemaining = Number(
            body.attemptsRemaining,
        );

        const error = new Error(
            backendMessage ||
            `Invalid email or password. You have ${attemptsRemaining} ${attemptsRemaining === 1
                ? 'attempt'
                : 'attempts'
            } remaining before your account is temporarily locked.`,
        );

        error.status = response.status;
        error.code = code;
        error.type = 'warning';
        error.title = 'Incorrect password';
        error.attemptsRemaining = attemptsRemaining;

        return error;
    }

    if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
    ) {
        const error = new Error(
            INVALID_CREDENTIALS_MESSAGE,
        );

        error.status = response.status;
        error.code =
            code || 'INVALID_CREDENTIALS';
        error.type = 'error';
        error.title = 'Sign in failed';

        return error;
    }

    if (response.status >= 500) {
        const error = new Error(
            'The server could not complete the sign-in request. Please try again.',
        );

        error.status = response.status;
        error.code = code || 'SERVER_ERROR';
        error.type = 'error';
        error.title = 'Server unavailable';

        return error;
    }

    const error = new Error(
        backendMessage ||
        'Unable to sign in. Please try again.',
    );

    error.status = response.status;
    error.code = code || 'LOGIN_FAILED';
    error.type = 'error';
    error.title = 'Sign in failed';

    return error;
}

/**
 * Login using email and password.
 *
 * @param {{
 *   email: string,
 *   password: string
 * }} credentials
 *
 * @returns {Promise<Object>}
 */
export async function login(credentials) {
    let response;

    try {
        response = await fetch(
            `${API_BASE_URL}/auth/login`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: credentials.email
                        .trim()
                        .toLowerCase(),
                    password: credentials.password,
                }),
            },
        );
    } catch {
        const error = new Error(
            NETWORK_ERROR_MESSAGE,
        );

        error.code = 'NETWORK_ERROR';
        error.type = 'error';
        error.title = 'Connection problem';

        throw error;
    }

    const body = await readJsonBody(response);

    if (!response.ok) {
        throw createLoginError(
            response,
            body,
        );
    }

    if (!body) {
        const error = new Error(
            'The server returned an invalid response. Please try again.',
        );

        error.code =
            'INVALID_SERVER_RESPONSE';
        error.type = 'error';
        error.title =
            'Invalid server response';

        throw error;
    }

    return body;
}