import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Put,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { GuestSessionService } from '../../auth/guest/guest-session.service';
import { GUEST_SESSION_COOKIE_NAME } from '../../utilities/constants/guest-session.constants';
import { UpsertPublicationFeedbackDto } from '../dto/upsert-publication-feedback.dto';
import { UpsertPublicationRatingDto } from '../dto/upsert-publication-rating.dto';
import { UserFeedbackService } from '../services/user-feedback.service';

/**
 * Handles guest rating and feedback actions for published ideas.
 *
 * Guest identity is resolved through the secure guest-session cookie.
 *
 * @author Eman
 */
@Controller('publications')
export class GuestFeedbackController {
    constructor(
        private readonly userFeedbackService: UserFeedbackService,
        private readonly guestSessionService: GuestSessionService,
    ) { }

    /**
     * Creates or updates the current guest's rating.
     */
    @Put(':publicationId/guest-rating')
    async upsertRating(
        @Req() request: Request,
        @Param(
            'publicationId',
            new ParseUUIDPipe({ version: '4' }),
        )
        publicationId: string,
        @Body() dto: UpsertPublicationRatingDto,
    ) {
        const guest = await this.resolveGuest(request);

        return this.userFeedbackService.upsertRating(
            { guestSessionId: guest.id },
            publicationId,
            dto,
        );
    }

    /**
     * Returns the current guest's rating.
     */
    @Get(':publicationId/guest-rating')
    async getMyRating(
        @Req() request: Request,
        @Param(
            'publicationId',
            new ParseUUIDPipe({ version: '4' }),
        )
        publicationId: string,
    ) {
        const guest = await this.resolveGuest(request);

        return this.userFeedbackService.getMyRating(
            { guestSessionId: guest.id },
            publicationId,
        );
    }

    /**
     * Deletes the current guest's rating.
     */
    @Delete(':publicationId/guest-rating')
    async deleteRating(
        @Req() request: Request,
        @Param(
            'publicationId',
            new ParseUUIDPipe({ version: '4' }),
        )
        publicationId: string,
    ) {
        const guest = await this.resolveGuest(request);

        return this.userFeedbackService.deleteRating(
            { guestSessionId: guest.id },
            publicationId,
        );
    }

    /**
     * Creates or updates the current guest's feedback.
     */
    @Put(':publicationId/guest-feedback')
    async upsertFeedback(
        @Req() request: Request,
        @Param(
            'publicationId',
            new ParseUUIDPipe({ version: '4' }),
        )
        publicationId: string,
        @Body() dto: UpsertPublicationFeedbackDto,
    ) {
        const guest = await this.resolveGuest(request);

        return this.userFeedbackService.upsertFeedback(
            { guestSessionId: guest.id },
            publicationId,
            dto,
        );
    }

    /**
     * Returns the current guest's feedback.
     */
    @Get(':publicationId/guest-feedback')
    async getMyFeedback(
        @Req() request: Request,
        @Param(
            'publicationId',
            new ParseUUIDPipe({ version: '4' }),
        )
        publicationId: string,
    ) {
        const guest = await this.resolveGuest(request);

        return this.userFeedbackService.getMyFeedback(
            { guestSessionId: guest.id },
            publicationId,
        );
    }

    /**
     * Deletes the current guest's feedback.
     */
    @Delete(':publicationId/guest-feedback')
    async deleteFeedback(
        @Req() request: Request,
        @Param(
            'publicationId',
            new ParseUUIDPipe({ version: '4' }),
        )
        publicationId: string,
    ) {
        const guest = await this.resolveGuest(request);

        return this.userFeedbackService.deleteFeedback(
            { guestSessionId: guest.id },
            publicationId,
        );
    }

    /**
     * Resolves and validates the current guest session.
     */
    private resolveGuest(request: Request) {
        return this.guestSessionService.requireValidSession(
            request.cookies?.[GUEST_SESSION_COOKIE_NAME],
        );
    }
}
