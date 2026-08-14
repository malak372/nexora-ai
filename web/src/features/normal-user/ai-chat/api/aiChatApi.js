/**
 * API and Socket.IO helpers for the Premium AI Chat feature.
 *
 * AI Chat is available exclusively to users whose account status is PREMIUM.
 * Access to the chat does not depend on the idea's isUnlocked value.
 *
 * The REST helpers manage chat sessions and message history, while the socket
 * helper creates the authenticated real-time connection used for streaming
 * AI responses.
 *
 * @author Eman
 */

import { io } from 'socket.io-client';

import {
    getAccessToken,
} from '../../../auth/shared/auth.storage';

import {
    extractApiData,
    getApiErrorMessage,
    normalUserApi,
} from '../../shared/api/normalUserApi';
import {
    cachedRequest,
    createRequestCacheKey,
    invalidateRequestCache,
} from '../../shared/cache/requestCache';

/**
 * Backend base URL used by the AI Chat Socket.IO connection.
 *
 * The trailing slash is removed to prevent malformed namespace URLs.
 */
const API_URL =
    process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, '') ||
    process.env.REACT_APP_API_URL?.replace(/\/$/, '') ||
    'http://localhost:3000';

const AI_CHAT_SESSIONS_CACHE_TTL_MS = 30 * 1000;
const AI_CHAT_MESSAGES_CACHE_TTL_MS = 20 * 1000;

/**
 * Converts supported backend collection envelopes into one stable shape.
 *
 * Supported payload examples:
 * - [...]
 * - { items: [...], pagination: {...} }
 * - { data: [...], meta: {...} }
 *
 * @param {Array|Object|null|undefined} payload
 *
 * @returns {{
 *   items: Array,
 *   pagination: Object|null
 * }}
 */
const normalizeCollection = (payload) => ({
    items: Array.isArray(payload)
        ? payload
        : payload?.items || payload?.data || [],
    pagination:
        payload?.pagination ||
        payload?.meta ||
        null,
});

/**
 * Loads all AI Chat sessions associated with one idea.
 *
 * Sessions are ordered from the most recently updated session to the oldest.
 *
 * @param {string} ideaId
 *
 * @returns {Promise<{
 *   items: Array,
 *   pagination: Object|null
 * }>}
 */
export async function listChatSessions(ideaId) {
    try {
        const cacheKey = createRequestCacheKey('ai-chat-sessions', { ideaId });

        return await cachedRequest(
            cacheKey,
            async () => {
                const response = await normalUserApi.get(
                    `/ideas/${ideaId}/chat/sessions`,
                    {
                        params: {
                            page: 1,
                            limit: 12,
                            sortBy: 'updatedAt',
                            sortOrder: 'desc',
                        },
                    },
                );

                return normalizeCollection(
                    extractApiData(response),
                );
            },
            {
                ttlMs: AI_CHAT_SESSIONS_CACHE_TTL_MS,
                persist: false,
                allowStaleOnError: true,
            },
        );
    } catch (error) {
        throw new Error(
            getApiErrorMessage(
                error,
                'AI chat sessions could not be loaded.',
            ),
        );
    }
}

/**
 * Creates a new AI Chat session for an idea.
 *
 * @param {string} ideaId
 * @param {string} [title]
 *
 * @returns {Promise<Object>}
 */
export async function createChatSession(
    ideaId,
    title,
) {
    try {
        const requestBody = title
            ? { title }
            : {};

        const response = await normalUserApi.post(
            `/ideas/${ideaId}/chat/sessions`,
            requestBody,
        );

        invalidateRequestCache(
            createRequestCacheKey('ai-chat-sessions', { ideaId }),
        );

        return extractApiData(response);
    } catch (error) {
        throw new Error(
            getApiErrorMessage(
                error,
                'A new AI chat session could not be created.',
            ),
        );
    }
}

/**
 * Updates an existing AI Chat session.
 *
 * @param {string} sessionId
 * @param {{title?: string}} updates
 *
 * @returns {Promise<Object>}
 */
export async function updateChatSession(
    sessionId,
    updates,
) {
    try {
        const response = await normalUserApi.patch(
            `/chat/sessions/${sessionId}`,
            updates,
        );

        invalidateRequestCache('ai-chat-sessions:');

        return extractApiData(response);
    } catch (error) {
        throw new Error(
            getApiErrorMessage(
                error,
                'The AI chat session could not be updated.',
            ),
        );
    }
}

/**
 * Deletes one AI Chat session owned by the current user.
 *
 * @param {string} sessionId
 *
 * @returns {Promise<void>}
 */
export async function deleteChatSession(sessionId) {
    try {
        await normalUserApi.delete(
            `/chat/sessions/${sessionId}`,
        );

        invalidateRequestCache(
            createRequestCacheKey('ai-chat-messages', { sessionId }),
        );
        invalidateRequestCache('ai-chat-sessions:');
    } catch (error) {
        throw new Error(
            getApiErrorMessage(
                error,
                'The AI chat session could not be deleted.',
            ),
        );
    }
}

/**
 * Loads the message history for a specific AI Chat session.
 *
 * Messages are returned from oldest to newest.
 *
 * A deleted session can return 404 if its messages were being loaded
 * at the same time it was removed. The page component handles that
 * stale request safely and ignores its result.
 *
 * @param {string} sessionId
 *
 * @returns {Promise<{
 *   items: Array,
 *   pagination: Object|null
 * }>}
 */
export async function listChatMessages(sessionId) {
    try {
        const cacheKey = createRequestCacheKey('ai-chat-messages', { sessionId });

        return await cachedRequest(
            cacheKey,
            async () => {
                const response = await normalUserApi.get(
                    `/chat/sessions/${sessionId}/messages`,
                    {
                        params: {
                            page: 1,
                            limit: 30,
                            sortBy: 'createdAt',
                            sortOrder: 'asc',
                        },
                    },
                );

                return normalizeCollection(
                    extractApiData(response),
                );
            },
            {
                ttlMs: AI_CHAT_MESSAGES_CACHE_TTL_MS,
                persist: false,
                allowStaleOnError: true,
            },
        );
    } catch (error) {
        throw new Error(
            getApiErrorMessage(
                error,
                'Chat messages could not be loaded.',
            ),
        );
    }
}

/**
 * Invalidates one session's short-lived message-history cache after a live
 * socket update so reopening the conversation never shows an older snapshot.
 */
export function invalidateChatMessages(sessionId) {
    if (!sessionId) return;

    invalidateRequestCache(
        createRequestCacheKey('ai-chat-messages', { sessionId }),
    );
}

/** Invalidates cached session lists after title/activity changes. */
export function invalidateChatSessions(ideaId) {
    if (ideaId) {
        invalidateRequestCache(
            createRequestCacheKey('ai-chat-sessions', { ideaId }),
        );
        return;
    }

    invalidateRequestCache('ai-chat-sessions:');
}

const AI_CHAT_SOCKET_IDLE_DISCONNECT_MS = 45 * 1000;

let sharedAiChatSocket = null;
let sharedAiChatSocketDisconnectTimer = null;

/**
 * Returns the shared authenticated AI Chat socket.
 *
 * Reusing one connection avoids paying a new WebSocket handshake every time
 * the user reopens AI Chat from the same authenticated workspace.
 *
 * @returns {import('socket.io-client').Socket}
 */
export function createAiChatSocket() {
    if (sharedAiChatSocket) {
        window.clearTimeout(sharedAiChatSocketDisconnectTimer);
        sharedAiChatSocketDisconnectTimer = null;

        const latestToken = getAccessToken();

        if (
            latestToken &&
            sharedAiChatSocket.auth?.token !== latestToken
        ) {
            sharedAiChatSocket.auth = {
                ...(sharedAiChatSocket.auth || {}),
                token: latestToken,
            };
        }

        if (!sharedAiChatSocket.connected) {
            sharedAiChatSocket.connect();
        }

        return sharedAiChatSocket;
    }

    sharedAiChatSocket = io(`${API_URL}/ai-chat`, {
        auth: {
            token: getAccessToken(),
        },
        transports: ['websocket'],
        upgrade: false,
        reconnection: true,
        reconnectionAttempts: 4,
        reconnectionDelay: 120,
        reconnectionDelayMax: 500,
        timeout: 2500,
    });

    return sharedAiChatSocket;
}

/**
 * Starts the socket connection before navigation to AI Chat.
 *
 * This is intentionally safe to call from hover/focus/pointer preloading.
 */
export function warmAiChatSocket() {
    try {
        return createAiChatSocket();
    } catch {
        return null;
    }
}

/**
 * Keeps the shared socket alive briefly after leaving AI Chat.
 *
 * Reopening the page during this interval is nearly instant, while a truly
 * idle connection is still released automatically.
 */
export function scheduleAiChatSocketDisconnect() {
    window.clearTimeout(sharedAiChatSocketDisconnectTimer);

    sharedAiChatSocketDisconnectTimer = window.setTimeout(() => {
        sharedAiChatSocket?.disconnect();
        sharedAiChatSocket = null;
        sharedAiChatSocketDisconnectTimer = null;
    }, AI_CHAT_SOCKET_IDLE_DISCONNECT_MS);
}

/**
 * Immediately closes the shared socket.
 *
 * Useful for explicit authentication teardown flows.
 */
export function disconnectAiChatSocket() {
    window.clearTimeout(sharedAiChatSocketDisconnectTimer);
    sharedAiChatSocketDisconnectTimer = null;
    sharedAiChatSocket?.disconnect();
    sharedAiChatSocket = null;
}
