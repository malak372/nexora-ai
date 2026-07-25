/**
 * Defines typed Socket.IO payloads exchanged by the AI chat gateway.
 *
 * @author Eman
 */

import type { AiChatErrorCode } from '../constants/ai-chat.constants';
import type { CancelChatMessageDto } from '../dto/cancel-chat-message.dto';
import type { JoinChatSessionDto } from '../dto/join-chat-session.dto';
import type { LeaveChatSessionDto } from '../dto/leave-chat-session.dto';
import type { SendChatMessageDto } from '../dto/send-chat-message.dto';
import type { AiChatMessageRecord } from './ai-chat-message.types';
import type { AiChatStreamChunk } from './chat-stream-chunk.type';

/**
 * Error payload emitted by the gateway.
 */
export type AiChatSocketError = {
    readonly code: AiChatErrorCode;
    readonly message: string;
    readonly event?: string;
};

/**
 * Acknowledgement returned to a Socket.IO client callback.
 */
export type AiChatSocketAcknowledgement<TData> =
    | {
        readonly success: true;
        readonly data: TData;
    }
    | {
        readonly success: false;
        readonly error: AiChatSocketError;
    };

/**
 * Payload returned after joining or leaving a session room.
 */
export type AiChatSessionMembershipPayload = {
    readonly sessionId: string;
};

/**
 * Payload returned immediately after one user message and its pending AI
 * response placeholder are persisted.
 */
export type AiChatMessageAcceptedPayload = {
    readonly sessionId: string;
    readonly userMessage: AiChatMessageRecord;
    readonly aiMessage: AiChatMessageRecord;
};

/**
 * Payload emitted when an AI response starts streaming.
 */
export type AiChatMessageStartedPayload = {
    readonly sessionId: string;
    readonly message: AiChatMessageRecord;
};

/**
 * Payload emitted for terminal message states.
 */
export type AiChatMessageTerminalPayload = {
    readonly sessionId: string;
    readonly message: AiChatMessageRecord;
};

/**
 * Optional Socket.IO acknowledgement callback.
 */
export type AiChatAck<TData> = (
    response: AiChatSocketAcknowledgement<TData>,
) => void;

/**
 * Events accepted from connected clients.
 */
export interface AiChatClientToServerEvents {
    'chat:join-session': (
        payload: JoinChatSessionDto,
        acknowledgement?: AiChatAck<AiChatSessionMembershipPayload>,
    ) => void;

    'chat:leave-session': (
        payload: LeaveChatSessionDto,
        acknowledgement?: AiChatAck<AiChatSessionMembershipPayload>,
    ) => void;

    'chat:send-message': (
        payload: SendChatMessageDto,
        acknowledgement?: AiChatAck<AiChatMessageAcceptedPayload>,
    ) => void;

    'chat:cancel-message': (
        payload: CancelChatMessageDto,
        acknowledgement?: AiChatAck<AiChatMessageTerminalPayload>,
    ) => void;
}

/**
 * Events emitted by the backend.
 */
export interface AiChatServerToClientEvents {
    'chat:session-joined': (payload: AiChatSessionMembershipPayload) => void;
    'chat:session-left': (payload: AiChatSessionMembershipPayload) => void;
    'chat:message-accepted': (payload: AiChatMessageAcceptedPayload) => void;
    'chat:message-stream-started': (
        payload: AiChatMessageStartedPayload,
    ) => void;
    'chat:message-chunk': (payload: AiChatStreamChunk) => void;
    'chat:message-completed': (payload: AiChatMessageTerminalPayload) => void;
    'chat:message-failed': (payload: AiChatMessageTerminalPayload) => void;
    'chat:message-cancelled': (payload: AiChatMessageTerminalPayload) => void;
    'chat:error': (payload: AiChatSocketError) => void;
}

/**
 * Events exchanged internally between Socket.IO server instances.
 */
export type AiChatInterServerEvents = Record<never, never>;