/**
 * Axios client for authenticated normal-user requests.
 *
 * The shared auth storage helpers support both:
 * - localStorage when "Keep me signed in" is selected.
 * - sessionStorage for the current browser tab otherwise.
 *
 * Repeated concurrent GET requests are deduplicated at this shared layer so
 * separate components can safely request the same resource without creating
 * duplicate backend and Prisma work.
 *
 * @author Eman , Malak
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

function warmApiConnection() {
    if (typeof document === 'undefined') return;

    try {
        const apiOrigin = new URL(API_URL, window.location.origin).origin;
        const existing = document.head.querySelector(
            `link[data-voxidence-api-preconnect="${apiOrigin}"]`,
        );

        if (existing) return;

        const preconnect = document.createElement('link');
        preconnect.rel = 'preconnect';
        preconnect.href = apiOrigin;
        preconnect.crossOrigin = 'anonymous';
        preconnect.dataset.voxidenceApiPreconnect = apiOrigin;
        document.head.appendChild(preconnect);

        const dnsPrefetch = document.createElement('link');
        dnsPrefetch.rel = 'dns-prefetch';
        dnsPrefetch.href = apiOrigin;
        document.head.appendChild(dnsPrefetch);
    } catch {
        // Connection warming is only a performance optimization.
    }
}

warmApiConnection();

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

const inFlightGetRequests = new Map();
const rawGet = normalUserApi.get.bind(normalUserApi);

function normalizeForCache(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeForCache);
    }

    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                const nextValue = value[key];

                if (nextValue !== undefined) {
                    result[key] = normalizeForCache(nextValue);
                }

                return result;
            }, {});
    }

    return value;
}

function createGetRequestKey(url, config = {}) {
    const accessToken = getAccessToken() || '';
    const tokenSuffix = accessToken ? accessToken.slice(-24) : 'guest';

    return JSON.stringify({
        url,
        params: normalizeForCache(config.params || {}),
        responseType: config.responseType || 'json',
        token: tokenSuffix,
    });
}

/**
 * Deduplicates only overlapping JSON GET requests.
 *
 * It does not cache completed responses, so data freshness and mutation
 * semantics remain unchanged. Requests carrying an AbortSignal or non-JSON
 * response type stay independent because sharing those requests can change
 * cancellation or download behavior.
 */
normalUserApi.get = (url, config = {}) => {
    const responseType = config.responseType || 'json';
    const canDedupe =
        config.dedupe !== false &&
        !config.signal &&
        responseType === 'json';

    if (!canDedupe) {
        return rawGet(url, config);
    }

    const key = createGetRequestKey(url, config);
    const existingRequest = inFlightGetRequests.get(key);

    if (existingRequest) {
        return existingRequest;
    }

    const request = rawGet(url, config).finally(() => {
        if (inFlightGetRequests.get(key) === request) {
            inFlightGetRequests.delete(key);
        }
    });

    inFlightGetRequests.set(key, request);
    return request;
};

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
