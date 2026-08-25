import { io } from 'socket.io-client';

import { getAccessToken } from '../../../auth/shared/auth.storage';
import {
    extractApiData,
    normalUserApi,
} from '../../../normal-user/shared/api/normalUserApi';

const TEAM_CHAT_BASE = '/admin/team-chat';

const SOCKET_URL =
    process.env.REACT_APP_SOCKET_URL?.replace(/\/$/, '') ||
    process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, '') ||
    process.env.REACT_APP_API_URL?.replace(/\/$/, '') ||
    'http://localhost:3000';

const unwrap = extractApiData;

export async function getTeamChatAdministrators() {
    const response = await normalUserApi.get(
        `${TEAM_CHAT_BASE}/administrators`,
    );

    const payload = unwrap(response);

    return Array.isArray(payload) ? payload : [];
}

export async function getTeamChatConversations() {
    const response = await normalUserApi.get(
        `${TEAM_CHAT_BASE}/conversations`,
    );

    const payload = unwrap(response);

    return Array.isArray(payload) ? payload : [];
}

export async function getAdminTeamChatUnreadSummary() {
    const response = await normalUserApi.get(
        `${TEAM_CHAT_BASE}/unread-summary`,
    );

    const payload = unwrap(response);

    return payload && typeof payload === 'object'
        ? payload
        : { unreadCount: 0, latestMessage: null };
}

export async function createDirectAdminConversation(adminId) {
    if (!adminId) {
        throw new Error('Administrator id is required.');
    }

    const response = await normalUserApi.post(
        `${TEAM_CHAT_BASE}/direct/${encodeURIComponent(adminId)}`,
    );

    return unwrap(response);
}

export async function createAdminGroupConversation(payload) {
    const response = await normalUserApi.post(
        `${TEAM_CHAT_BASE}/conversations`,
        {
            title: payload?.title,
            memberIds: payload?.memberIds ?? [],
        },
    );

    return unwrap(response);
}

export async function getAdminConversationMessages(conversationId) {
    if (!conversationId) {
        throw new Error('Conversation id is required.');
    }

    const response = await normalUserApi.get(
        `${TEAM_CHAT_BASE}/conversations/${encodeURIComponent(
            conversationId,
        )}/messages`,
    );

    return unwrap(response);
}

export async function sendAdminChatMessage(
    conversationId,
    content,
) {
    if (!conversationId) {
        throw new Error('Conversation id is required.');
    }

    const message = String(content ?? '').trim();

    if (!message) {
        throw new Error('Message content is required.');
    }

    const socket = getAdminTeamChatSocket();

    if (socket?.connected) {
        return new Promise((resolve, reject) => {
            let settled = false;

            const timeoutId = window.setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                reject(new Error('Realtime message send timed out.'));
            }, 5000);

            socket.emit(
                'admin-chat:send',
                {
                    conversationId,
                    content: message,
                },
                (acknowledgement) => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    window.clearTimeout(timeoutId);

                    if (
                        acknowledgement?.success === true &&
                        acknowledgement?.message
                    ) {
                        resolve(acknowledgement.message);
                        return;
                    }

                    reject(
                        new Error(
                            acknowledgement?.error ||
                            'Could not send the message.',
                        ),
                    );
                },
            );
        });
    }

    const response = await normalUserApi.post(
        `${TEAM_CHAT_BASE}/conversations/${encodeURIComponent(
            conversationId,
        )}/messages`,
        {
            content: message,
        },
    );

    return unwrap(response);
}

export async function deleteAdminChatMessage(
    conversationId,
    messageId,
    scope = 'me',
) {
    if (!conversationId || !messageId) {
        throw new Error('Conversation id and message id are required.');
    }

    const normalizedScope = scope === 'everyone' ? 'everyone' : 'me';

    const response = await normalUserApi.delete(
        `${TEAM_CHAT_BASE}/conversations/${encodeURIComponent(
            conversationId,
        )}/messages/${encodeURIComponent(
            messageId,
        )}?scope=${normalizedScope}`,
    );

    return unwrap(response);
}

export async function markAdminConversationRead(conversationId) {
    if (!conversationId) {
        throw new Error('Conversation id is required.');
    }

    const response = await normalUserApi.patch(
        `${TEAM_CHAT_BASE}/conversations/${encodeURIComponent(
            conversationId,
        )}/read`,
    );

    return unwrap(response);
}

export function createAdminTeamChatSocket(token = getAccessToken()) {
    return io(`${SOCKET_URL}/admin-chat`, {
        transports: ['websocket', 'polling'],
        auth: {
            token,
        },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 150,
        reconnectionDelayMax: 1000,
    });
}

let adminTeamChatSocket = null;
let adminTeamChatSocketToken = '';

export function disconnectAdminTeamChatSocket() {
    if (adminTeamChatSocket) {
        adminTeamChatSocket.removeAllListeners();
        adminTeamChatSocket.disconnect();
    }

    adminTeamChatSocket = null;
    adminTeamChatSocketToken = '';
}

export function getAdminTeamChatSocket() {
    const token = getAccessToken() || '';

    if (adminTeamChatSocket && adminTeamChatSocketToken !== token) {
        disconnectAdminTeamChatSocket();
    }

    if (!adminTeamChatSocket) {
        adminTeamChatSocket = createAdminTeamChatSocket(token);
        adminTeamChatSocketToken = token;
    }

    return adminTeamChatSocket;
}

export const adminTeamChatApi = {
    administrators: getTeamChatAdministrators,
    conversations: getTeamChatConversations,
    unreadSummary: getAdminTeamChatUnreadSummary,
    direct: createDirectAdminConversation,
    createGroup: createAdminGroupConversation,
    messages: getAdminConversationMessages,
    send: sendAdminChatMessage,
    deleteMessage: deleteAdminChatMessage,
    markRead: markAdminConversationRead,
};