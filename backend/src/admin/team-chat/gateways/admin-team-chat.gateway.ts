import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
    Ack,
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { UserRole } from '@prisma/client';
import type { Namespace, Socket } from 'socket.io';

import { PrismaService } from '../../../prisma/prisma.service';
import { AdminTeamChatService } from '../services/admin-team-chat.service';

/**
 * Handles authentication for administrator team-chat WebSocket connections.
 *
 * The service validates the access token provided through the Socket.IO
 * authentication payload or the Authorization header, verifies the token,
 * and confirms that the connected user is an active administrator.
 *
 * @author Eman
 */
@Injectable()
class AdminTeamChatSocketAuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * Authenticates an incoming administrator WebSocket connection.
     *
     * The access token can be provided through:
     * - `handshake.auth.token`
     * - `handshake.auth.accessToken`
     * - The `Authorization` request header
     *
     * After validating the JWT, the method checks that the corresponding
     * user exists and has administrator access.
     *
     * @param client The connected Socket.IO client.
     * @returns The authenticated administrator's user ID.
     * @throws Error If authentication fails or administrator access is invalid.
     */
    async authenticate(client: Socket) {
        const auth = client.handshake.auth as Record<string, unknown>;
        const header = client.handshake.headers.authorization;
        const rawToken =
            typeof auth.token === 'string'
                ? auth.token
                : typeof auth.accessToken === 'string'
                    ? auth.accessToken
                    : typeof header === 'string'
                        ? header
                        : '';

        const token = rawToken.replace(/^Bearer\s+/i, '').trim();

        if (!token) {
            throw new Error('Authentication required.');
        }

        const payload = await this.jwtService.verifyAsync<{ sub?: string }>(token, {
            secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });

        if (!payload.sub) {
            throw new Error('Invalid access token.');
        }

        const admin = await this.prisma.user.findFirst({
            where: {
                id: payload.sub,
                role: UserRole.ADMIN,
                deletedAt: null,
                isActive: true,
            },
            select: { id: true },
        });

        if (!admin) {
            throw new Error('Administrator access required.');
        }

        return admin.id;
    }
}

type AdminTeamChatSocket = Socket & {
    data: {
        adminId?: string;
    };
};

type AdminTeamChatSendAck = (payload: {
    success: boolean;
    message?: unknown;
    error?: string;
}) => void;

/**
 * WebSocket gateway responsible for real-time administrator
 * team-chat communication.
 *
 * The gateway:
 * - Authenticates administrator socket connections.
 * - Places each administrator in a private socket room.
 * - Broadcasts newly created messages.
 * - Broadcasts conversation updates.
 * - Broadcasts conversation read-status updates.
 *
 * The gateway operates under the `/admin-chat` Socket.IO namespace.
 *
 * @author Eman
 */
@WebSocketGateway({
    namespace: '/admin-chat',
    transports: ['websocket', 'polling'],
    cors: {
        origin: [
            /^http:\/\/localhost:\d+$/,
            /^http:\/\/127\.0\.0\.1:\d+$/,
        ],
        credentials: true,
        methods: ['GET', 'POST'],
    },
})
export class AdminTeamChatGateway implements OnGatewayConnection<Socket> {
    @WebSocketServer()
    private readonly server!: Namespace;

    constructor(
        private readonly socketAuth: AdminTeamChatSocketAuthService,
        private readonly teamChatService: AdminTeamChatService,
    ) { }

    /**
     * Handles a new WebSocket connection.
     *
     * The connected client is authenticated and, when successful,
     * joins a private room based on the administrator's user ID.
     *
     * A readiness event is then emitted back to the connected client.
     *
     * If authentication fails, the socket connection is immediately closed.
     *
     * @param client The newly connected Socket.IO client.
     */
    async handleConnection(client: AdminTeamChatSocket) {
        try {
            const adminId = await this.socketAuth.authenticate(client);
            client.data.adminId = adminId;

            await client.join(`admin-user:${adminId}`);

            client.emit('admin-chat:ready', { adminId });
        } catch {
            client.disconnect(true);
        }
    }

    @SubscribeMessage('admin-chat:send')
    async onSendMessage(
        @ConnectedSocket() client: AdminTeamChatSocket,
        @MessageBody()
        payload: {
            conversationId?: unknown;
            content?: unknown;
        },
        @Ack() acknowledgement?: AdminTeamChatSendAck,
    ) {
        const adminId = client.data.adminId;
        const conversationId =
            typeof payload?.conversationId === 'string'
                ? payload.conversationId.trim()
                : '';
        const content =
            typeof payload?.content === 'string'
                ? payload.content
                : '';

        if (!adminId) {
            acknowledgement?.({
                success: false,
                error: 'Authentication required.',
            });
            return;
        }

        if (!conversationId) {
            acknowledgement?.({
                success: false,
                error: 'Conversation id is required.',
            });
            return;
        }

        try {
            const message = await this.teamChatService.sendMessage(
                adminId,
                conversationId,
                content,
            );

            acknowledgement?.({
                success: true,
                message,
            });
        } catch (error) {
            acknowledgement?.({
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Could not send the message.',
            });
        }
    }

    /**
     * Handles the internal event emitted when a new administrator
     * chat message is created.
     *
     * The message is broadcast to the private rooms of all members
     * participating in the related conversation.
     *
     * Socket event emitted:
     * `admin-chat:message`
     *
     * @param payload The created message and the conversation member IDs.
     */
    @OnEvent('admin-chat.message.created')
    onMessageCreated(payload: { message: unknown; memberIds: string[] }) {
        this.server
            .to(payload.memberIds.map((id) => `admin-user:${id}`))
            .emit('admin-chat:message', payload.message);
    }

    @OnEvent('admin-chat.message.deleted')
    onMessageDeleted(payload: {
        conversationId: string;
        messageId: string;
        scope: 'me' | 'everyone';
        userId: string;
        memberIds: string[];
    }) {
        this.server
            .to(payload.memberIds.map((id) => `admin-user:${id}`))
            .emit('admin-chat:message-deleted', {
                conversationId: payload.conversationId,
                messageId: payload.messageId,
                scope: payload.scope,
                userId: payload.userId,
            });
    }

    /**
     * Handles conversation changes that must be reflected
     * in real time for participating administrators.
     *
     * Socket event emitted:
     * `admin-chat:conversation`
     *
     * @param payload The changed conversation ID and its member IDs.
     */
    @OnEvent('admin-chat.conversation.changed')
    onConversationChanged(payload: {
        conversationId: string;
        memberIds: string[];
    }) {
        this.server
            .to(payload.memberIds.map((id) => `admin-user:${id}`))
            .emit('admin-chat:conversation', {
                conversationId: payload.conversationId,
            });
    }

    /**
     * Handles conversation read-status updates.
     *
     * The updated read state is broadcast to all administrators
     * participating in the conversation.
     *
     * Socket event emitted:
     * `admin-chat:read`
     *
     * @param payload The conversation ID, administrator ID,
     * last-read timestamp, and conversation member IDs.
     */
    @OnEvent('admin-chat.conversation.read')
    onConversationRead(payload: {
        conversationId: string;
        userId: string;
        lastReadAt: Date;
        memberIds: string[];
    }) {
        this.server
            .to(payload.memberIds.map((id) => `admin-user:${id}`))
            .emit('admin-chat:read', {
                conversationId: payload.conversationId,
                userId: payload.userId,
                lastReadAt: payload.lastReadAt,
            });
    }
}

export { AdminTeamChatSocketAuthService };