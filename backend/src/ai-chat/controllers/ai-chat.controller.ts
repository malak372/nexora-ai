/**
 * Exposes authenticated HTTP endpoints for managing AI chat sessions and
 * retrieving their persisted messages.
 *
 * Real-time message submission, AI response generation, streaming,
 * cancellation, and Socket.IO room membership are handled separately by the
 * AI chat WebSocket gateway.
 *
 * @author Eman
 */

import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { CreateChatSessionDto } from '../dto/create-chat-session.dto';
import { GetChatMessagesQueryDto } from '../dto/get-chat-messages-query.dto';
import { GetChatSessionsQueryDto } from '../dto/get-chat-sessions-query.dto';
import { UpdateChatSessionDto } from '../dto/update-chat-session.dto';
import { AiChatMessageReaderService } from '../services/messages/ai-chat-message-reader.service';
import { AiChatService } from '../services/ai-chat.service';

/**
 * Controller responsible for authenticated AI chat session management.
 *
 * Supported operations:
 * - Create a chat session for an unlocked idea.
 * - List the authenticated user's sessions for an idea.
 * - Retrieve one user-owned chat session.
 * - Update one user-owned chat session.
 * - Delete one user-owned chat session.
 * - Retrieve paginated messages from one user-owned chat session.
 *
 * This controller intentionally contains no persistence or business logic.
 */
@ApiTags('AI Chat')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
    description: 'Authentication is required or the access token is invalid.',
})
@Controller()
@UseGuards(JwtAuthGuard)
export class AiChatController {
    constructor(
        private readonly aiChatService: AiChatService,
        private readonly aiChatMessageReaderService: AiChatMessageReaderService,
    ) { }

    /**
     * Creates a new AI chat session for an unlocked idea accessible to the
     * authenticated user.
     *
     * Endpoint:
     * POST /ideas/:ideaId/chat/sessions
     *
     * @param user Authenticated user.
     * @param ideaId Target idea identifier.
     * @param dto Chat-session creation payload.
     * @returns Newly created chat session.
     */
    @Post('ideas/:ideaId/chat/sessions')
    @ApiOperation({
        summary: 'Create an AI chat session for an idea',
        description:
            'Creates a new chat session for an unlocked idea accessible to the authenticated user.',
    })
    @ApiParam({
        name: 'ideaId',
        description: 'Target idea identifier.',
        type: String,
        format: 'uuid',
    })
    @ApiCreatedResponse({
        description: 'The AI chat session was created successfully.',
    })
    @ApiBadRequestResponse({
        description:
            'The request payload or idea identifier is invalid, or the session limit has been reached.',
    })
    @ApiForbiddenResponse({
        description:
            'The authenticated user cannot access the idea or the idea is not unlocked.',
    })
    @ApiNotFoundResponse({
        description: 'The requested idea was not found.',
    })
    createSession(
        @CurrentUser() user: AuthenticatedUser,
        @Param('ideaId', ParseUUIDPipe) ideaId: string,
        @Body() dto: CreateChatSessionDto,
    ) {
        return this.aiChatService.createSession(user.id, ideaId, dto);
    }

    /**
     * Retrieves paginated AI chat sessions belonging to the authenticated user
     * for one idea.
     *
     * Endpoint:
     * GET /ideas/:ideaId/chat/sessions
     *
     * @param user Authenticated user.
     * @param ideaId Target idea identifier.
     * @param query Pagination, search, and sorting parameters.
     * @returns Paginated chat-session collection.
     */
    @Get('ideas/:ideaId/chat/sessions')
    @ApiOperation({
        summary: 'List AI chat sessions for an idea',
        description:
            'Returns paginated chat sessions belonging to the authenticated user for one accessible idea.',
    })
    @ApiParam({
        name: 'ideaId',
        description: 'Target idea identifier.',
        type: String,
        format: 'uuid',
    })
    @ApiOkResponse({
        description: 'The AI chat sessions were retrieved successfully.',
    })
    @ApiBadRequestResponse({
        description: 'The idea identifier or query parameters are invalid.',
    })
    @ApiForbiddenResponse({
        description:
            'The authenticated user cannot access the idea or the idea is not unlocked.',
    })
    @ApiNotFoundResponse({
        description: 'The requested idea was not found.',
    })
    getSessions(
        @CurrentUser() user: AuthenticatedUser,
        @Param('ideaId', ParseUUIDPipe) ideaId: string,
        @Query() query: GetChatSessionsQueryDto,
    ) {
        return this.aiChatService.getSessions(user.id, ideaId, query);
    }

    /**
     * Retrieves one AI chat session belonging to the authenticated user.
     *
     * Endpoint:
     * GET /chat/sessions/:sessionId
     *
     * @param user Authenticated user.
     * @param sessionId Chat-session identifier.
     * @returns Chat-session details.
     */
    @Get('chat/sessions/:sessionId')
    @ApiOperation({
        summary: 'Retrieve an AI chat session',
        description:
            'Returns one non-deleted AI chat session belonging to the authenticated user.',
    })
    @ApiParam({
        name: 'sessionId',
        description: 'AI chat-session identifier.',
        type: String,
        format: 'uuid',
    })
    @ApiOkResponse({
        description: 'The AI chat session was retrieved successfully.',
    })
    @ApiBadRequestResponse({
        description: 'The chat-session identifier is invalid.',
    })
    @ApiForbiddenResponse({
        description:
            'The authenticated user is not allowed to access the chat session.',
    })
    @ApiNotFoundResponse({
        description: 'The requested chat session was not found.',
    })
    getSessionById(
        @CurrentUser() user: AuthenticatedUser,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
    ) {
        return this.aiChatService.getSessionById(user.id, sessionId);
    }

    /**
     * Updates one AI chat session belonging to the authenticated user.
     *
     * Endpoint:
     * PATCH /chat/sessions/:sessionId
     *
     * @param user Authenticated user.
     * @param sessionId Chat-session identifier.
     * @param dto Chat-session update payload.
     * @returns Updated chat session.
     */
    @Patch('chat/sessions/:sessionId')
    @ApiOperation({
        summary: 'Update an AI chat session',
        description:
            'Updates editable properties of one chat session belonging to the authenticated user.',
    })
    @ApiParam({
        name: 'sessionId',
        description: 'AI chat-session identifier.',
        type: String,
        format: 'uuid',
    })
    @ApiOkResponse({
        description: 'The AI chat session was updated successfully.',
    })
    @ApiBadRequestResponse({
        description:
            'The chat-session identifier or request payload is invalid.',
    })
    @ApiForbiddenResponse({
        description:
            'The authenticated user is not allowed to update the chat session.',
    })
    @ApiNotFoundResponse({
        description: 'The requested chat session was not found.',
    })
    updateSession(
        @CurrentUser() user: AuthenticatedUser,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
        @Body() dto: UpdateChatSessionDto,
    ) {
        return this.aiChatService.updateSession(user.id, sessionId, dto);
    }

    /**
     * Permanently or logically deletes one AI chat session belonging to the
     * authenticated user, according to the service persistence strategy.
     *
     * Endpoint:
     * DELETE /chat/sessions/:sessionId
     *
     * @param user Authenticated user.
     * @param sessionId Chat-session identifier.
     */
    @Delete('chat/sessions/:sessionId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete an AI chat session',
        description:
            'Deletes one chat session belonging to the authenticated user.',
    })
    @ApiParam({
        name: 'sessionId',
        description: 'AI chat-session identifier.',
        type: String,
        format: 'uuid',
    })
    @ApiNoContentResponse({
        description: 'The AI chat session was deleted successfully.',
    })
    @ApiBadRequestResponse({
        description: 'The chat-session identifier is invalid.',
    })
    @ApiForbiddenResponse({
        description:
            'The authenticated user is not allowed to delete the chat session.',
    })
    @ApiNotFoundResponse({
        description: 'The requested chat session was not found.',
    })
    async deleteSession(
        @CurrentUser() user: AuthenticatedUser,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
    ): Promise<void> {
        await this.aiChatService.deleteSession(user.id, sessionId);
    }

    /**
     * Retrieves paginated messages from one AI chat session belonging to the
     * authenticated user.
     *
     * Endpoint:
     * GET /chat/sessions/:sessionId/messages
     *
     * @param user Authenticated user.
     * @param sessionId Chat-session identifier.
     * @param query Pagination and sorting parameters.
     * @returns Paginated chat-message collection.
     */
    @Get('chat/sessions/:sessionId/messages')
    @ApiOperation({
        summary: 'List messages from an AI chat session',
        description:
            'Returns paginated persisted messages from one chat session belonging to the authenticated user.',
    })
    @ApiParam({
        name: 'sessionId',
        description: 'AI chat-session identifier.',
        type: String,
        format: 'uuid',
    })
    @ApiOkResponse({
        description: 'The AI chat messages were retrieved successfully.',
    })
    @ApiBadRequestResponse({
        description:
            'The chat-session identifier or query parameters are invalid.',
    })
    @ApiForbiddenResponse({
        description:
            'The authenticated user is not allowed to access the chat session.',
    })
    @ApiNotFoundResponse({
        description: 'The requested chat session was not found.',
    })
    getMessages(
        @CurrentUser() user: AuthenticatedUser,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
        @Query() query: GetChatMessagesQueryDto,
    ) {
        return this.aiChatMessageReaderService.getMessages(
            user.id,
            sessionId,
            query,
        );
    }
}