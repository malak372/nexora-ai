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

export function createAdminTeamChatSocket() {
    return io(`${SOCKET_URL}/admin-chat`, {
        transports: ['websocket', 'polling'],
        auth: {
            token: getAccessToken(),
        },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
    });
}

let adminTeamChatSocket = null;

export function getAdminTeamChatSocket() {
    if (!adminTeamChatSocket) {
        adminTeamChatSocket = createAdminTeamChatSocket();
    }

    return adminTeamChatSocket;
}

export const adminTeamChatApi = {
    administrators: getTeamChatAdministrators,
    conversations: getTeamChatConversations,
    direct: createDirectAdminConversation,
    createGroup: createAdminGroupConversation,
    messages: getAdminConversationMessages,
    send: sendAdminChatMessage,
    markRead: markAdminConversationRead,
};