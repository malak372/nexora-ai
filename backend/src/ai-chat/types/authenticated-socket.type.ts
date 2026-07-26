/**
 * Defines the authenticated Socket.IO client used by the AI chat gateway.
 *
 * @author Eman
 */

import type { Socket } from 'socket.io';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type {
  AiChatClientToServerEvents,
  AiChatInterServerEvents,
  AiChatServerToClientEvents,
} from './chat-socket-events.type';

/**
 * Per-connection data populated after successful JWT authentication.
 */
export type AiChatSocketData = {
  user?: AuthenticatedUser;
  accessTokenIssuedAt?: number;
  accessTokenExpiresAt?: number;
};

/**
 * Socket.IO client authenticated by WsJwtAuthGuard.
 */
export type AuthenticatedSocket = Socket<
  AiChatClientToServerEvents,
  AiChatServerToClientEvents,
  AiChatInterServerEvents,
  AiChatSocketData
>;
