/**
 * Exposes authenticated real-time AI chat operations through Socket.IO.
 *
 * HTTP endpoints remain responsible for chat-session management and message
 * history. This gateway owns room membership, message submission, response
 * streaming, and cancellation.
 *
 * @author Eman
 */

import {
    UseFilters,
    UseGuards,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
    Ack,
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
    WsException,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
    AI_CHAT_CLIENT_EVENTS,
    AI_CHAT_ERROR_CODES,
    AI_CHAT_NAMESPACE,
    AI_CHAT_SERVER_EVENTS,
    buildAiChatSessionRoom,
    type AiChatErrorCode,
} from '../constants/ai-chat.constants';
import { WsCurrentUser } from '../decorators/ws-current-user.decorator';
import { CancelChatMessageDto } from '../dto/cancel-chat-message.dto';
import { JoinChatSessionDto } from '../dto/join-chat-session.dto';
import { LeaveChatSessionDto } from '../dto/leave-chat-session.dto';
import { SendChatMessageDto } from '../dto/send-chat-message.dto';
import { WsExceptionFilter } from '../filters/ws-exception.filter';
import { WsJwtAuthGuard } from '../guards/ws-jwt-auth.guard';
import type { ChatResponseStreamObserver } from '../interfaces/chat-response-stream.interface';
import { AiChatAccessService } from '../services/ai-chat-access.service';
import { AiChatStreamService } from '../services/ai-chat-stream.service';
import type {
    AiChatSocketData,
    AuthenticatedSocket,
} from '../types/authenticated-socket.type';
import type {
    AiChatAck,
    AiChatClientToServerEvents,
    AiChatInterServerEvents,
    AiChatMessageAcceptedPayload,
    AiChatMessageTerminalPayload,
    AiChatServerToClientEvents,
    AiChatSessionMembershipPayload,
} from '../types/chat-socket-events.type';

/**
 * Socket.IO gateway dedicated to authenticated AI chat communication.
 */
@SkipThrottle()
@WebSocketGateway({
    namespace: AI_CHAT_NAMESPACE,
    transports: ['websocket', 'polling'],
})
@UseGuards(WsJwtAuthGuard)
@UseFilters(WsExceptionFilter)
@UsePipes(
    new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }),
)
export class AiChatGateway
    implements
    OnGatewayConnection<AuthenticatedSocket>,
    OnGatewayDisconnect<AuthenticatedSocket> {
    @WebSocketServer()
    private readonly server!: Namespace<
        AiChatClientToServerEvents,
        AiChatServerToClientEvents,
        AiChatInterServerEvents,
        AiChatSocketData
    >;

    constructor(
        private readonly wsJwtAuthGuard: WsJwtAuthGuard,
        private readonly aiChatAccessService: AiChatAccessService,
        private readonly aiChatStreamService: AiChatStreamService,
    ) { }

    /**
     * Authenticates the socket before accepting any room or message operation.
     */
    async handleConnection(client: AuthenticatedSocket): Promise<void> {
        try {
            await this.wsJwtAuthGuard.authenticateClient(client);
        } catch (error: unknown) {
            const payload = this.normalizeConnectionError(error);

            client.emit(AI_CHAT_SERVER_EVENTS.ERROR, payload);
            client.disconnect(true);
        }
    }

    /**
     * No generation is cancelled on disconnect. The response continues to be
     * persisted and can be retrieved after the client reconnects.
     */
    handleDisconnect(_client: AuthenticatedSocket): void { }

    /**
     * Joins the room associated with one accessible chat session.
     */
    @SubscribeMessage(AI_CHAT_CLIENT_EVENTS.JOIN_SESSION)
    async joinSession(
        @ConnectedSocket() client: AuthenticatedSocket,
        @WsCurrentUser() user: AuthenticatedUser,
        @MessageBody() dto: JoinChatSessionDto,
        @Ack() acknowledgement?: AiChatAck<AiChatSessionMembershipPayload>,
    ): Promise<void> {
        await this.aiChatAccessService.ensureSessionChatAccess(
            user.id,
            dto.sessionId,
        );

        await client.join(buildAiChatSessionRoom(dto.sessionId));

        const payload: AiChatSessionMembershipPayload = {
            sessionId: dto.sessionId,
        };

        client.emit(AI_CHAT_SERVER_EVENTS.SESSION_JOINED, payload);
        this.acknowledgeSuccess(acknowledgement, payload);
    }

    /**
     * Leaves one chat-session room.
     */
    @SubscribeMessage(AI_CHAT_CLIENT_EVENTS.LEAVE_SESSION)
    async leaveSession(
        @ConnectedSocket() client: AuthenticatedSocket,
        @WsCurrentUser() user: AuthenticatedUser,
        @MessageBody() dto: LeaveChatSessionDto,
        @Ack() acknowledgement?: AiChatAck<AiChatSessionMembershipPayload>,
    ): Promise<void> {
        await this.aiChatAccessService.ensureSessionChatAccess(
            user.id,
            dto.sessionId,
        );

        await client.leave(buildAiChatSessionRoom(dto.sessionId));

        const payload: AiChatSessionMembershipPayload = {
            sessionId: dto.sessionId,
        };

        client.emit(AI_CHAT_SERVER_EVENTS.SESSION_LEFT, payload);
        this.acknowledgeSuccess(acknowledgement, payload);
    }

    /**
     * Accepts one user message and starts its AI response asynchronously.
     */
    @SubscribeMessage(AI_CHAT_CLIENT_EVENTS.SEND_MESSAGE)
    async sendMessage(
        @ConnectedSocket() client: AuthenticatedSocket,
        @WsCurrentUser() user: AuthenticatedUser,
        @MessageBody() dto: SendChatMessageDto,
        @Ack() acknowledgement?: AiChatAck<AiChatMessageAcceptedPayload>,
    ): Promise<void> {
        this.ensureSessionJoined(client, dto.sessionId);

        const room = buildAiChatSessionRoom(dto.sessionId);
        const observer = this.createStreamObserver(room, dto.sessionId);

        const turn = await this.aiChatStreamService.startResponse({
            userId: user.id,
            sessionId: dto.sessionId,
            clientRequestId: dto.clientRequestId,
            message: dto.message,
            observer,
        });

        const payload: AiChatMessageAcceptedPayload = {
            sessionId: dto.sessionId,
            userMessage: turn.userMessage,
            aiMessage: turn.aiMessage,
        };

        this.server.to(room).emit(AI_CHAT_SERVER_EVENTS.MESSAGE_ACCEPTED, payload);
        this.acknowledgeSuccess(acknowledgement, payload);
    }

    /**
     * Cancels one active pending or streaming AI message.
     */
    @SubscribeMessage(AI_CHAT_CLIENT_EVENTS.CANCEL_MESSAGE)
    async cancelMessage(
        @ConnectedSocket() client: AuthenticatedSocket,
        @WsCurrentUser() user: AuthenticatedUser,
        @MessageBody() dto: CancelChatMessageDto,
        @Ack() acknowledgement?: AiChatAck<AiChatMessageTerminalPayload>,
    ): Promise<void> {
        this.ensureSessionJoined(client, dto.sessionId);

        const message = await this.aiChatStreamService.cancelResponse(
            user.id,
            dto.sessionId,
            dto.messageId,
        );

        const payload: AiChatMessageTerminalPayload = {
            sessionId: dto.sessionId,
            message,
        };

        this.server
            .to(buildAiChatSessionRoom(dto.sessionId))
            .emit(AI_CHAT_SERVER_EVENTS.MESSAGE_CANCELLED, payload);

        this.acknowledgeSuccess(acknowledgement, payload);
    }

    /**
     * Creates transport callbacks for one chat-session room.
     */
    private createStreamObserver(
        room: string,
        sessionId: string,
    ): ChatResponseStreamObserver {
        return {
            onStarted: (message) => {
                this.server
                    .to(room)
                    .emit(AI_CHAT_SERVER_EVENTS.MESSAGE_STREAM_STARTED, {
                        sessionId,
                        message,
                    });
            },
            onChunk: (chunk) => {
                this.server
                    .to(room)
                    .emit(AI_CHAT_SERVER_EVENTS.MESSAGE_CHUNK, chunk);
            },
            onCompleted: (message) => {
                this.server
                    .to(room)
                    .emit(AI_CHAT_SERVER_EVENTS.MESSAGE_COMPLETED, {
                        sessionId,
                        message,
                    });
            },
            onFailed: (message) => {
                this.server
                    .to(room)
                    .emit(AI_CHAT_SERVER_EVENTS.MESSAGE_FAILED, {
                        sessionId,
                        message,
                    });
            },
        };
    }

    /**
     * Rejects message operations until the client joins the target room.
     */
    private ensureSessionJoined(
        client: AuthenticatedSocket,
        sessionId: string,
    ): void {
        if (!client.rooms.has(buildAiChatSessionRoom(sessionId))) {
            throw new WsException({
                code: AI_CHAT_ERROR_CODES.SESSION_NOT_JOINED,
                message:
                    'Join the AI chat session before sending or cancelling messages.',
            });
        }
    }

    /**
     * Preserves stable authentication codes raised while opening a socket.
     */
    private normalizeConnectionError(error: unknown): {
        readonly code: AiChatErrorCode;
        readonly message: string;
    } {
        if (error instanceof WsException) {
            const value = error.getError();

            if (
                typeof value === 'object' &&
                value !== null &&
                'code' in value &&
                'message' in value &&
                typeof value.code === 'string' &&
                typeof value.message === 'string'
            ) {
                const supportedCodes = new Set<AiChatErrorCode>(
                    Object.values(AI_CHAT_ERROR_CODES),
                );

                if (supportedCodes.has(value.code as AiChatErrorCode)) {
                    return {
                        code: value.code as AiChatErrorCode,
                        message: value.message,
                    };
                }
            }
        }

        return {
            code: AI_CHAT_ERROR_CODES.INVALID_ACCESS_TOKEN,
            message: 'The AI Chat connection could not be authenticated.',
        };
    }

    /**
     * Sends a typed success response when the client supplied an ack callback.
     */
    private acknowledgeSuccess<TData>(
        acknowledgement: AiChatAck<TData> | undefined,
        data: TData,
    ): void {
        acknowledgement?.({
            success: true,
            data,
        });
    }
}