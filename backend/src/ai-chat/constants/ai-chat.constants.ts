/**
 * Central constants and helper utilities used by the Nexora AI chat module.
 *
 * Keeping chat limits, Socket.IO events, room identifiers, and stable error
 * codes in one dependency-free file prevents duplicated magic values across
 * controllers, gateways, guards, filters, DTOs, and services.
 *
 * @author Eman
 */

/**
 * Socket.IO namespace dedicated to AI chat communication.
 *
 * The frontend connects to this namespace after authentication.
 */
export const AI_CHAT_NAMESPACE = '/ai-chat';

/**
 * Prefix used to construct Socket.IO rooms for individual chat sessions.
 */
const AI_CHAT_SESSION_ROOM_PREFIX = 'ai-chat:session';

/**
 * Default number of chat sessions returned in one paginated request.
 */
export const AI_CHAT_DEFAULT_SESSIONS_PAGE_SIZE = 20;

/**
 * Maximum number of chat sessions that may be returned in one request.
 */
export const AI_CHAT_MAX_SESSIONS_PAGE_SIZE = 100;

/**
 * Default number of chat messages returned in one paginated request.
 */
export const AI_CHAT_DEFAULT_MESSAGES_PAGE_SIZE = 30;

/**
 * Maximum number of chat messages that may be returned in one request.
 */
export const AI_CHAT_MAX_MESSAGES_PAGE_SIZE = 100;

/**
 * Maximum number of non-deleted chat sessions a user may create for one idea.
 */
export const AI_CHAT_MAX_SESSIONS_PER_IDEA = 20;

/**
 * Minimum number of non-whitespace characters accepted in a user message.
 */
export const AI_CHAT_MIN_MESSAGE_LENGTH = 1;

/**
 * Maximum number of characters accepted in a single user message.
 */
export const AI_CHAT_MAX_MESSAGE_LENGTH = 4_000;

/**
 * Minimum number of non-whitespace characters accepted in a chat-session
 * title.
 */
export const AI_CHAT_MIN_SESSION_TITLE_LENGTH = 1;

/**
 * Maximum number of characters accepted in a chat-session title.
 */
export const AI_CHAT_MAX_SESSION_TITLE_LENGTH = 120;

/**
 * Maximum number of recent conversation messages included in one AI prompt.
 *
 * Older messages remain stored in PostgreSQL but are omitted from the AI
 * context to prevent uncontrolled token growth.
 */
export const AI_CHAT_MAX_CONTEXT_MESSAGES = 12;

/**
 * Maximum number of characters from previous chat messages that may be
 * included in one AI request.
 */
export const AI_CHAT_MAX_HISTORY_CONTEXT_CHARACTERS = 20_000;

/**
 * Maximum number of characters from the selected idea, NLP analysis, and
 * generated outputs that may be included in one AI request.
 */
export const AI_CHAT_MAX_IDEA_CONTEXT_CHARACTERS = 30_000;

/**
 * Approximate character length of each emitted response chunk when the
 * selected AI provider does not support native token streaming.
 */
export const AI_CHAT_STREAM_CHUNK_SIZE = 80;

/**
 * Delay between simulated response chunks.
 */
export const AI_CHAT_STREAM_CHUNK_DELAY_MS = 20;

/**
 * Maximum period allowed for completing one AI chat response.
 */
export const AI_CHAT_RESPONSE_TIMEOUT_MS = 60_000;

/**
 * Maximum number of simultaneous AI responses allowed in one chat session.
 *
 * Restricting the session to one active response preserves message ordering
 * and prevents overlapping answers.
 */
export const AI_CHAT_MAX_ACTIVE_RESPONSES_PER_SESSION = 1;

/**
 * Default title assigned when the user creates a session without a title.
 */
export const AI_CHAT_DEFAULT_SESSION_TITLE = 'New project discussion';

/**
 * Stable Socket.IO events emitted by the client and handled by the backend.
 */
export const AI_CHAT_CLIENT_EVENTS = Object.freeze({
    JOIN_SESSION: 'chat:join-session',
    LEAVE_SESSION: 'chat:leave-session',
    SEND_MESSAGE: 'chat:send-message',
    CANCEL_MESSAGE: 'chat:cancel-message',
} as const);

/**
 * Stable Socket.IO events emitted by the backend and handled by the client.
 */
export const AI_CHAT_SERVER_EVENTS = Object.freeze({
    SESSION_JOINED: 'chat:session-joined',
    SESSION_LEFT: 'chat:session-left',

    MESSAGE_ACCEPTED: 'chat:message-accepted',
    MESSAGE_STREAM_STARTED: 'chat:message-stream-started',
    MESSAGE_CHUNK: 'chat:message-chunk',
    MESSAGE_COMPLETED: 'chat:message-completed',
    MESSAGE_FAILED: 'chat:message-failed',
    MESSAGE_CANCELLED: 'chat:message-cancelled',

    ERROR: 'chat:error',
} as const);

/**
 * Prefix used for stable application-level AI chat error codes.
 */
const AI_CHAT_ERROR_CODE_PREFIX = 'AI_CHAT';

/**
 * Creates a strongly typed AI chat error code.
 *
 * @param code Error-code suffix.
 * @returns Stable error code prefixed with `AI_CHAT_`.
 */
function createAiChatErrorCode<const TCode extends string>(
    code: TCode,
): `AI_CHAT_${TCode}` {
    return `${AI_CHAT_ERROR_CODE_PREFIX}_${code}`;
}

/**
 * Stable application-level AI chat error codes.
 *
 * The frontend should use these values for conditional behavior rather than
 * relying on human-readable messages that may change over time.
 */
export const AI_CHAT_ERROR_CODES = Object.freeze({
    AUTHENTICATION_REQUIRED: createAiChatErrorCode(
        'AUTHENTICATION_REQUIRED',
    ),
    INVALID_ACCESS_TOKEN: createAiChatErrorCode('INVALID_ACCESS_TOKEN'),
    USER_NOT_ALLOWED: createAiChatErrorCode('USER_NOT_ALLOWED'),

    IDEA_NOT_FOUND: createAiChatErrorCode('IDEA_NOT_FOUND'),
    IDEA_NOT_UNLOCKED: createAiChatErrorCode('IDEA_NOT_UNLOCKED'),
    IDEA_ACCESS_DENIED: createAiChatErrorCode('IDEA_ACCESS_DENIED'),

    SESSION_NOT_FOUND: createAiChatErrorCode('SESSION_NOT_FOUND'),
    SESSION_ACCESS_DENIED: createAiChatErrorCode('SESSION_ACCESS_DENIED'),
    SESSION_LIMIT_REACHED: createAiChatErrorCode('SESSION_LIMIT_REACHED'),
    SESSION_DELETED: createAiChatErrorCode('SESSION_DELETED'),
    SESSION_NOT_JOINED: createAiChatErrorCode('SESSION_NOT_JOINED'),

    MESSAGE_NOT_FOUND: createAiChatErrorCode('MESSAGE_NOT_FOUND'),
    MESSAGE_ALREADY_PROCESSING: createAiChatErrorCode(
        'MESSAGE_ALREADY_PROCESSING',
    ),
    MESSAGE_ALREADY_COMPLETED: createAiChatErrorCode(
        'MESSAGE_ALREADY_COMPLETED',
    ),
    MESSAGE_ALREADY_CANCELLED: createAiChatErrorCode(
        'MESSAGE_ALREADY_CANCELLED',
    ),
    MESSAGE_GENERATION_FAILED: createAiChatErrorCode(
        'MESSAGE_GENERATION_FAILED',
    ),
    MESSAGE_GENERATION_TIMEOUT: createAiChatErrorCode(
        'MESSAGE_GENERATION_TIMEOUT',
    ),

    INVALID_PAYLOAD: createAiChatErrorCode('INVALID_PAYLOAD'),
    INTERNAL_ERROR: createAiChatErrorCode('INTERNAL_ERROR'),
} as const);

/**
 * Union of all events accepted from connected AI chat clients.
 */
export type AiChatClientEvent =
    (typeof AI_CHAT_CLIENT_EVENTS)[keyof typeof AI_CHAT_CLIENT_EVENTS];

/**
 * Union of all events emitted by the AI chat backend.
 */
export type AiChatServerEvent =
    (typeof AI_CHAT_SERVER_EVENTS)[keyof typeof AI_CHAT_SERVER_EVENTS];

/**
 * Union of all stable AI chat error-code values.
 */
export type AiChatErrorCode =
    (typeof AI_CHAT_ERROR_CODES)[keyof typeof AI_CHAT_ERROR_CODES];

/**
 * Builds the Socket.IO room name assigned to one chat session.
 *
 * @param sessionId Chat-session UUID.
 * @returns Stable and namespace-specific Socket.IO room name.
 */
export function buildAiChatSessionRoom(sessionId: string): string {
    return `${AI_CHAT_SESSION_ROOM_PREFIX}:${sessionId}`;
}