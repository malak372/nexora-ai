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

/**
 * Backend base URL used by the AI Chat Socket.IO connection.
 *
 * The trailing slash is removed to prevent malformed namespace URLs.
 */
const API_URL =
    process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, '') ||
    process.env.REACT_APP_API_URL?.replace(/\/$/, '') ||
    'http://localhost:3000';

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
 * @param {string} ideaId - Identifier of the idea whose sessions are requested.
 *
 * @returns {Promise<{
 *   items: Array,
 *   pagination: Object|null
 * }>}
 *
 * @throws {Error} When the chat sessions cannot be loaded.
 */
export async function listChatSessions(ideaId) {
    try {
        const response = await normalUserApi.get(
            `/ideas/${ideaId}/chat/sessions`,
            {
                params: {
                    page: 1,
                    limit: 50,
                    sortBy: 'updatedAt',
                    sortOrder: 'desc',
                },
            },
        );

        return normalizeCollection(
            extractApiData(response),
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
 * The title is optional. When no title is provided, the backend can generate
 * or assign a default session title.
 *
 * @param {string} ideaId - Identifier of the related idea.
 * @param {string} [title] - Optional title for the chat session.
 *
 * @returns {Promise<Object>} The newly created chat session.
 *
 * @throws {Error} When the chat session cannot be created.
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
 * Loads the message history for a specific AI Chat session.
 *
 * Messages are returned from oldest to newest to preserve the natural
 * conversation order.
 *
 * @param {string} sessionId - Identifier of the requested chat session.
 *
 * @returns {Promise<{
 *   items: Array,
 *   pagination: Object|null
 * }>}
 *
 * @throws {Error} When the chat messages cannot be loaded.
 */
export async function listChatMessages(sessionId) {
    try {
        const response = await normalUserApi.get(
            `/chat/sessions/${sessionId}/messages`,
            {
                params: {
                    page: 1,
                    limit: 100,
                    sortBy: 'createdAt',
                    sortOrder: 'asc',
                },
            },
        );

        return normalizeCollection(
            extractApiData(response),
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
 * Creates an authenticated Socket.IO connection to the AI Chat namespace.
 *
 * The access token is included in the socket authentication object so the
 * backend can verify that the connected user has PREMIUM access.
 *
 * @returns {import('socket.io-client').Socket}
 */
export function createAiChatSocket() {
    return io(`${API_URL}/ai-chat`, {
        auth: {
            token: getAccessToken(),
        },
        transports: [
            'websocket',
            'polling',
        ],
        reconnection: true,
    });
}