import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { CreateAdminGroupConversationDto } from '../dto/create-admin-group-conversation.dto';
import { SendAdminChatMessageDto } from '../dto/send-admin-chat-message.dto';
import { AdminTeamChatService } from '../services/admin-team-chat.service';

type CurrentAdmin = {
    id: string;
    role: UserRole;
};

/**
 * Handles communication between administrators inside the system.
 *
 * Provides endpoints for:
 * - Listing available administrators.
 * - Listing the current administrator's conversations.
 * - Creating direct conversations between administrators.
 * - Creating group conversations.
 * - Retrieving conversation messages.
 * - Sending messages.
 * - Marking conversations as read.
 *
 * Access to all endpoints is restricted to authenticated users
 * with the ADMIN role.
 *
 * @author Eman
 */
@Controller('admin/team-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTeamChatController {
    constructor(private readonly teamChatService: AdminTeamChatService) { }

    /**
     * Returns the administrators that can communicate with
     * the currently authenticated administrator.
     *
     * @param admin The currently authenticated administrator.
     * @returns A list of available administrators.
     */
    @Get('administrators')
    listAdministrators(@CurrentUser() admin: CurrentAdmin) {
        return this.teamChatService.listAdministrators(admin.id);
    }

    /**
     * Returns all team-chat conversations associated with
     * the currently authenticated administrator.
     *
     * @param admin The currently authenticated administrator.
     * @returns The administrator's conversations.
     */
    @Get('conversations')
    listConversations(@CurrentUser() admin: CurrentAdmin) {
        return this.teamChatService.listConversations(admin.id);
    }

    /**
     * Creates or retrieves a direct conversation between the
     * currently authenticated administrator and another administrator.
     *
     * @param admin The currently authenticated administrator.
     * @param otherAdminId The UUID of the other administrator.
     * @returns The direct conversation.
     */
    @Post('direct/:adminId')
    createDirectConversation(
        @CurrentUser() admin: CurrentAdmin,
        @Param('adminId', ParseUUIDPipe) otherAdminId: string,
    ) {
        return this.teamChatService.createDirectConversation(
            admin.id,
            otherAdminId,
        );
    }

    /**
     * Creates a new group conversation between multiple administrators.
     *
     * The authenticated administrator is used as the creator of
     * the conversation, while the group configuration and selected
     * members are provided through the request body.
     *
     * @param admin The currently authenticated administrator.
     * @param dto Group conversation creation data.
     * @returns The newly created group conversation.
     */
    @Post('conversations')
    createGroupConversation(
        @CurrentUser() admin: CurrentAdmin,
        @Body() dto: CreateAdminGroupConversationDto,
    ) {
        return this.teamChatService.createGroupConversation(admin.id, dto);
    }

    /**
     * Retrieves the messages belonging to a specific conversation.
     *
     * The service verifies that the authenticated administrator
     * has access to the requested conversation.
     *
     * @param admin The currently authenticated administrator.
     * @param conversationId The UUID of the conversation.
     * @returns The messages in the conversation.
     */
    @Get('conversations/:conversationId/messages')
    getMessages(
        @CurrentUser() admin: CurrentAdmin,
        @Param('conversationId', ParseUUIDPipe) conversationId: string,
    ) {
        return this.teamChatService.getMessages(admin.id, conversationId);
    }

    /**
     * Sends a new message to an administrator team-chat conversation.
     *
     * @param admin The currently authenticated administrator.
     * @param conversationId The UUID of the target conversation.
     * @param dto The message content.
     * @returns The newly created message.
     */
    @Post('conversations/:conversationId/messages')
    sendMessage(
        @CurrentUser() admin: CurrentAdmin,
        @Param('conversationId', ParseUUIDPipe) conversationId: string,
        @Body() dto: SendAdminChatMessageDto,
    ) {
        return this.teamChatService.sendMessage(
            admin.id,
            conversationId,
            dto.content,
        );
    }

    /**
     * Marks a conversation as read for the currently
     * authenticated administrator.
     *
     * This can be used to update unread-message indicators
     * after the administrator opens the conversation.
     *
     * @param admin The currently authenticated administrator.
     * @param conversationId The UUID of the conversation.
     * @returns The result of the read-status update.
     */
    @Patch('conversations/:conversationId/read')
    markRead(
        @CurrentUser() admin: CurrentAdmin,
        @Param('conversationId', ParseUUIDPipe) conversationId: string,
    ) {
        return this.teamChatService.markRead(admin.id, conversationId);
    }
}