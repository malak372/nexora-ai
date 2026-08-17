import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminConversationType, Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAdminGroupConversationDto } from '../dto/create-admin-group-conversation.dto';

/**
 * Defines the Prisma relations that are loaded whenever
 * an administrator conversation is retrieved.
 *
 * Each conversation includes:
 * - Conversation members and their basic user information.
 * - The latest non-deleted message.
 * - Basic information about the sender of the latest message.
 *
 * @author Eman
 */
const conversationInclude = Prisma.validator<Prisma.AdminConversationInclude>()(
    {
        members: {
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        avatarUrl: true,
                        isActive: true,
                    },
                },
            },
        },
        messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
                sender: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        },
    },
);

/**
 * Prisma payload type representing an administrator conversation
 * together with the relations defined in `conversationInclude`.
 */
type ConversationWithRelations = Prisma.AdminConversationGetPayload<{
    include: typeof conversationInclude;
}>;

/**
 * Service responsible for administrator team-chat operations.
 *
 * This service manages:
 * - Listing available administrators.
 * - Retrieving administrator conversations.
 * - Creating direct conversations.
 * - Creating group conversations.
 * - Retrieving conversation messages.
 * - Sending chat messages.
 * - Updating conversation read status.
 * - Calculating unread message counts.
 * - Broadcasting real-time chat events.
 *
 * @author Eman
 */
@Injectable()
export class AdminTeamChatService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly events: EventEmitter2,
    ) { }

    /**
     * Retrieves all active administrators.
     *
     * The currently authenticated administrator is also included
     * in the result and identified through the `isCurrent` property.
     *
     * @param currentAdminId The ID of the currently authenticated administrator.
     * @returns A list of active administrators.
     */
    async listAdministrators(currentAdminId: string) {
        const administrators = await this.prisma.user.findMany({
            where: {
                role: UserRole.ADMIN,
                deletedAt: null,
                isActive: true,
            },
            orderBy: [{ fullName: 'asc' }, { createdAt: 'asc' }],
            select: {
                id: true,
                fullName: true,
                email: true,
                avatarUrl: true,
                lastLoginAt: true,
            },
        });

        return administrators.map((administrator) => ({
            ...administrator,
            isCurrent: administrator.id === currentAdminId,
        }));
    }

    /**
     * Retrieves all conversations in which the current
     * administrator is a member.
     *
     * Conversations are ordered primarily by their latest message
     * timestamp and then by their last update timestamp.
     *
     * Each conversation is serialized before being returned.
     *
     * @param currentAdminId The ID of the current administrator.
     * @returns The administrator's serialized conversations.
     */
    async listConversations(currentAdminId: string) {
        const conversations = await this.prisma.adminConversation.findMany({
            where: {
                members: {
                    some: { userId: currentAdminId },
                },
            },
            orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
            include: conversationInclude,
        });

        return Promise.all(
            conversations.map((conversation) =>
                this.serializeConversation(conversation, currentAdminId),
            ),
        );
    }

    /**
     * Creates or retrieves a direct conversation between
     * two administrators.
     *
     * A deterministic `directKey` is generated from both administrator IDs
     * to prevent duplicate direct conversations.
     *
     * If two requests attempt to create the same conversation concurrently,
     * Prisma unique-constraint error `P2002` is handled by retrieving
     * the conversation that was created by the competing request.
     *
     * @param currentAdminId The ID of the current administrator.
     * @param otherAdminId The ID of the administrator to chat with.
     * @returns The serialized direct conversation.
     * @throws BadRequestException If the administrator attempts to chat with themselves.
     * @throws NotFoundException If the other administrator does not exist or the conversation cannot be created.
     */
    async createDirectConversation(currentAdminId: string, otherAdminId: string) {
        if (currentAdminId === otherAdminId) {
            throw new BadRequestException(
                'You cannot start a conversation with yourself.',
            );
        }

        await this.assertActiveAdministrator(otherAdminId);

        const directKey = [currentAdminId, otherAdminId].sort().join(':');

        let conversation = await this.prisma.adminConversation.findUnique({
            where: { directKey },
            include: conversationInclude,
        });

        if (!conversation) {
            try {
                conversation = await this.prisma.adminConversation.create({
                    data: {
                        type: AdminConversationType.DIRECT,
                        directKey,
                        createdById: currentAdminId,
                        members: {
                            create: [
                                { userId: currentAdminId, lastReadAt: new Date() },
                                { userId: otherAdminId },
                            ],
                        },
                    },
                    include: conversationInclude,
                });
            } catch (error) {
                if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2002'
                ) {
                    conversation = await this.prisma.adminConversation.findUnique({
                        where: { directKey },
                        include: conversationInclude,
                    });
                } else {
                    throw error;
                }
            }
        }

        if (!conversation) {
            throw new NotFoundException('Conversation could not be created.');
        }

        const payload = await this.serializeConversation(
            conversation,
            currentAdminId,
        );

        this.events.emit('admin-chat.conversation.changed', {
            conversationId: conversation.id,
            memberIds: conversation.members.map((member) => member.userId),
        });

        return payload;
    }

    /**
     * Creates a new administrator group conversation.
     *
     * Duplicate member IDs are removed and the current administrator
     * is excluded from the provided member list because they are added
     * automatically as the conversation creator.
     *
     * All selected members must be active, verified administrators.
     *
     * @param currentAdminId The ID of the administrator creating the group.
     * @param dto Group title and selected administrator IDs.
     * @returns The serialized group conversation.
     * @throws BadRequestException If fewer than two other administrators remain
     * after filtering or if any selected administrator is unavailable.
     */
    async createGroupConversation(
        currentAdminId: string,
        dto: CreateAdminGroupConversationDto,
    ) {
        const memberIds = [...new Set(dto.memberIds)].filter(
            (id) => id !== currentAdminId,
        );

        if (memberIds.length < 2) {
            throw new BadRequestException(
                'A group conversation requires at least two other administrators.',
            );
        }

        const validMembers = await this.prisma.user.findMany({
            where: {
                id: { in: memberIds },
                role: UserRole.ADMIN,
                deletedAt: null,
                isActive: true,
            },
            select: { id: true },
        });

        if (validMembers.length !== memberIds.length) {
            throw new BadRequestException(
                'One or more selected administrators are unavailable.',
            );
        }

        const conversation = await this.prisma.adminConversation.create({
            data: {
                title: dto.title.trim(),
                type: AdminConversationType.GROUP,
                createdById: currentAdminId,
                members: {
                    create: [
                        { userId: currentAdminId, lastReadAt: new Date() },
                        ...memberIds.map((userId) => ({ userId })),
                    ],
                },
            },
            include: conversationInclude,
        });

        const payload = await this.serializeConversation(
            conversation,
            currentAdminId,
        );

        this.events.emit('admin-chat.conversation.changed', {
            conversationId: conversation.id,
            memberIds: conversation.members.map((member) => member.userId),
        });

        return payload;
    }

    /**
     * Retrieves messages belonging to a conversation.
     *
     * Access is limited to administrators who are members
     * of the requested conversation.
     *
     * Up to the latest 100 non-deleted messages are loaded
     * and returned in chronological order.
     *
     * @param currentAdminId The ID of the current administrator.
     * @param conversationId The ID of the requested conversation.
     * @returns The serialized conversation and its messages.
     */
    async getMessages(currentAdminId: string, conversationId: string) {
        const conversation = await this.getConversationForMember(
            conversationId,
            currentAdminId,
        );

        const messages = await this.prisma.adminChatMessage.findMany({
            where: {
                conversationId,
                deletedAt: null,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: {
                sender: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        return {
            conversation: await this.serializeConversation(
                conversation,
                currentAdminId,
            ),
            messages: messages.reverse(),
        };
    }

    /**
     * Sends a new message to an administrator conversation.
     *
     * The message content is trimmed before storage.
     * Empty messages are rejected.
     *
     * Message creation, conversation timestamp update, and sender
     * read-status update are executed inside a single Prisma transaction.
     *
     * After creation, a real-time `admin-chat.message.created`
     * application event is emitted.
     *
     * @param currentAdminId The ID of the message sender.
     * @param conversationId The target conversation ID.
     * @param rawContent The raw message content.
     * @returns The newly created message.
     * @throws BadRequestException If the message contains no content after trimming.
     */
    async sendMessage(
        currentAdminId: string,
        conversationId: string,
        rawContent: string,
    ) {
        const content = rawContent.trim();

        if (!content) {
            throw new BadRequestException('Message content cannot be empty.');
        }

        const conversation = await this.getConversationForMember(
            conversationId,
            currentAdminId,
        );

        const now = new Date();

        const [message] = await this.prisma.$transaction([
            this.prisma.adminChatMessage.create({
                data: {
                    conversationId,
                    senderId: currentAdminId,
                    content,
                },
                include: {
                    sender: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            avatarUrl: true,
                        },
                    },
                },
            }),
            this.prisma.adminConversation.update({
                where: { id: conversationId },
                data: { lastMessageAt: now },
            }),
            this.prisma.adminConversationMember.update({
                where: {
                    conversationId_userId: {
                        conversationId,
                        userId: currentAdminId,
                    },
                },
                data: { lastReadAt: now },
            }),
        ]);

        const memberIds = conversation.members.map((member) => member.userId);

        this.events.emit('admin-chat.message.created', {
            message,
            memberIds,
        });

        return message;
    }

    /**
     * Marks a conversation as read for the current administrator.
     *
     * The member's `lastReadAt` timestamp is updated and a real-time
     * read-status event is emitted for all conversation members.
     *
     * @param currentAdminId The ID of the current administrator.
     * @param conversationId The ID of the conversation.
     * @returns The conversation ID and updated read timestamp.
     */
    async markRead(currentAdminId: string, conversationId: string) {
        const conversation = await this.getConversationForMember(
            conversationId,
            currentAdminId,
        );

        const lastReadAt = new Date();

        await this.prisma.adminConversationMember.update({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: currentAdminId,
                },
            },
            data: { lastReadAt },
        });

        this.events.emit('admin-chat.conversation.read', {
            conversationId,
            userId: currentAdminId,
            lastReadAt,
            memberIds: conversation.members.map((member) => member.userId),
        });

        return { conversationId, lastReadAt };
    }

    /**
     * Retrieves a conversation only when the specified administrator
     * is one of its members.
     *
     * This method provides the membership-level authorization check
     * used by message and read-status operations.
     *
     * @param conversationId The conversation ID.
     * @param currentAdminId The current administrator ID.
     * @returns The conversation with its configured relations.
     * @throws ForbiddenException If the administrator is not a conversation member.
     */
    private async getConversationForMember(
        conversationId: string,
        currentAdminId: string,
    ) {
        const conversation = await this.prisma.adminConversation.findFirst({
            where: {
                id: conversationId,
                members: {
                    some: { userId: currentAdminId },
                },
            },
            include: conversationInclude,
        });

        if (!conversation) {
            throw new ForbiddenException(
                'You do not have access to this conversation.',
            );
        }

        return conversation;
    }

    /**
     * Verifies that a user exists and is currently eligible
     * to participate in administrator team chat.
     *
     * The user must:
     * - Have the ADMIN role.
     * - Not be deleted.
     * - Be active.
     * - Be verified.
     *
     * @param adminId The administrator ID to validate.
     * @throws NotFoundException If no eligible administrator is found.
     */
    private async assertActiveAdministrator(adminId: string) {
        const administrator = await this.prisma.user.findFirst({
            where: {
                id: adminId,
                role: UserRole.ADMIN,
                deletedAt: null,
                isActive: true,
            },
            select: { id: true },
        });

        if (!administrator) {
            throw new NotFoundException('Administrator not found.');
        }
    }

    /**
     * Converts a Prisma conversation entity into the response structure
     * used by the administrator team-chat interface.
     *
     * The serialized response contains:
     * - Conversation metadata.
     * - Display name and avatar.
     * - Conversation members.
     * - Latest message.
     * - Unread message count for the current administrator.
     *
     * For direct conversations, display information is derived from
     * the other administrator. For group conversations, the configured
     * group title is used.
     *
     * @param conversation The conversation and its loaded relations.
     * @param currentAdminId The current administrator ID.
     * @returns The serialized conversation response.
     */
    private async serializeConversation(
        conversation: ConversationWithRelations,
        currentAdminId: string,
    ) {
        const currentMembership = conversation.members.find(
            (member) => member.userId === currentAdminId,
        );

        const lastReadAt = currentMembership?.lastReadAt ?? null;

        const unreadCount = await this.prisma.adminChatMessage.count({
            where: {
                conversationId: conversation.id,
                senderId: { not: currentAdminId },
                deletedAt: null,
                ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
            },
        });

        const otherMembers = conversation.members
            .filter((member) => member.userId !== currentAdminId)
            .map((member) => member.user);

        const displayName =
            conversation.type === AdminConversationType.GROUP
                ? conversation.title || 'Admin group'
                : otherMembers[0]?.fullName || 'Administrator';

        const displayAvatarUrl =
            conversation.type === AdminConversationType.DIRECT
                ? otherMembers[0]?.avatarUrl || null
                : null;

        return {
            id: conversation.id,
            type: conversation.type,
            title: conversation.title,
            displayName,
            displayAvatarUrl,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount,
            members: conversation.members.map((member) => ({
                id: member.user.id,
                fullName: member.user.fullName,
                email: member.user.email,
                avatarUrl: member.user.avatarUrl,
                isActive: member.user.isActive,
            })),
            lastMessage: conversation.messages[0] || null,
        };
    }
}