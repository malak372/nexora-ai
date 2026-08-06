/**
 * Axios client for authenticated normal-user requests.
 *
 * The shared auth storage helpers support both:
 * - localStorage when "Keep me signed in" is selected.
 * - sessionStorage for the current browser tab otherwise.
 */

import axios from 'axios';

import {
    clearAuthSession,
    getAccessToken,
    getRefreshToken,
    saveAuthTokens,
} from '../../../auth/shared/auth.storage';

const API_URL =
    process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, '') ||
    process.env.REACT_APP_API_URL?.replace(/\/$/, '') ||
    'http://localhost:3000';

const API_TIMEOUT_MS = Number(
    process.env.REACT_APP_API_TIMEOUT_MS || 20000,
);

export const normalUserApi = axios.create({
    baseURL: API_URL,
    timeout: API_TIMEOUT_MS,
    withCredentials: true,
    headers: {
        Accept: 'application/json',
    },
});

normalUserApi.interceptors.request.use((config) => {
    const accessToken = getAccessToken();

    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
});

let refreshPromise = null;

const refreshAccessToken = async () => {
    const refreshToken = getRefreshToken();

    if (!refreshToken) {
        throw new Error('Refresh token is missing.');
    }

    const response = await axios.post(
        `${API_URL}/auth/refresh`,
        { refreshToken },
        {
            timeout: API_TIMEOUT_MS,
            withCredentials: true,
        },
    );

    const payload = response.data?.data ?? response.data;
    const nextAccessToken = payload?.accessToken;
    const nextRefreshToken = payload?.refreshToken;

    if (!nextAccessToken) {
        throw new Error(
            'The refresh response did not contain an access token.',
        );
    }

    saveAuthTokens({
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
    });

    return nextAccessToken;
};

normalUserApi.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        const isUnauthorized = error.response?.status === 401;
        const isRefreshRequest =
            originalRequest?.url?.includes('/auth/refresh');

        if (
            !isUnauthorized ||
            originalRequest?._retry ||
            isRefreshRequest
        ) {
            return Promise.reject(error);
        }

        originalRequest._retry = true;

        try {
            refreshPromise ??= refreshAccessToken().finally(() => {
                refreshPromise = null;
            });

            const accessToken = await refreshPromise;
            originalRequest.headers.Authorization =
                `Bearer ${accessToken}`;

            return normalUserApi(originalRequest);
        } catch (refreshError) {
            clearAuthSession();

            window.dispatchEvent(
                new CustomEvent('nexora:session-expired'),
            );

            return Promise.reject(refreshError);
        }
    },
);

export const extractApiData = (response) =>
    response?.data?.data ?? response?.data;

export const getApiErrorMessage = (
    error,
    fallback = 'Something went wrong.',
) => {
    const message = error?.response?.data?.message;

    if (Array.isArray(message)) {
        return message.join(' ');
    }

    return message || error?.message || fallback;
};
