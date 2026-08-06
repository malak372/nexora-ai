/**
 * Configures the shared Axios client used by the Nexora web application.
 *
 * All requests sent through this client:
 * - Use the configured backend API URL.
 * - Include HTTP-only authentication and guest-session cookies.
 * - Accept JSON responses.
 * - Fail after the configured request timeout.
 *
 * @module apiClient
 * @author Eman
 */

import axios from 'axios';

/**
 * Backend API base URL.
 *
 * REACT_APP_API_BASE_URL should be defined inside the web environment file.
 *
 * Example:
 * REACT_APP_API_BASE_URL=http://localhost:3000
 */
const API_BASE_URL = (
    process.env.REACT_APP_API_BASE_URL ||
    'http://localhost:3000'
).replace(/\/$/, '');

const API_TIMEOUT_MS = Number(
    process.env.REACT_APP_API_TIMEOUT_MS || 20000,
);

/**
 * Shared Axios client used by Nexora frontend features.
 *
 * withCredentials must remain enabled so the browser sends:
 * - Refresh-token cookies.
 * - Guest-session cookies.
 */
export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: API_TIMEOUT_MS,
    withCredentials: true,
    headers: {
        Accept: 'application/json',
    },
});