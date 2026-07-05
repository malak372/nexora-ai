import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UpsertIdeaFeedbackDto } from './dto/upsert-idea-feedback.dto';
import { UserFeedbackService } from './feedback.service';

/**
 * Controller responsible for authenticated user idea feedback.
 *
 * Base routes:
 * - /users/ideas/:id/feedback
 * - /users/feedback
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserFeedbackController {
    constructor(
        private readonly userFeedbackService: UserFeedbackService,
    ) { }

    /**
     * Creates or updates feedback for one of the authenticated user's ideas.
     */
    @Post('ideas/:id/feedback')
    upsertFeedback(
        @CurrentUser() user: { id: string },
        @Param('id', ParseUUIDPipe) ideaId: string,
        @Body() dto: UpsertIdeaFeedbackDto,
    ) {
        return this.userFeedbackService.upsertFeedback(
            user.id,
            ideaId,
            dto,
        );
    }

    /**
     * Retrieves feedback for one of the authenticated user's ideas.
     */
    @Get('ideas/:id/feedback')
    getFeedbackByIdea(
        @CurrentUser() user: { id: string },
        @Param('id', ParseUUIDPipe) ideaId: string,
    ) {
        return this.userFeedbackService.getFeedbackByIdea(user.id, ideaId);
    }

    /**
     * Retrieves all feedback submitted by the authenticated user.
     */
    @Get('feedback')
    getMyFeedback(@CurrentUser() user: { id: string }) {
        return this.userFeedbackService.getMyFeedback(user.id);
    }
}