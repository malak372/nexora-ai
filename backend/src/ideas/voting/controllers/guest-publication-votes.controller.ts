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
import { GuestSessionService } from '../../../auth/guest/guest-session.service';
import { GUEST_SESSION_COOKIE_NAME } from '../../../utilities/constants/guest-session.constants';
import { VotePublicationDto } from '../dto/vote-publication.dto';
import { IdeaVotingService } from '../services/idea-voting.service';

/** Public guest voting endpoints backed by the secure guest-session cookie. */
@Controller('publications')
export class GuestPublicationVotesController {
    constructor(
        private readonly votingService: IdeaVotingService,
        private readonly guestSessionService: GuestSessionService,
    ) { }

    @Put(':publicationId/guest-vote')
    async upsertVote(
        @Req() request: Request,
        @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
        @Body() dto: VotePublicationDto,
    ) {
        const guest = await this.resolveGuest(request);
        return this.votingService.upsertVote(
            { guestSessionId: guest.id },
            publicationId,
            dto,
        );
    }

    @Get(':publicationId/guest-vote')
    async getMyVote(
        @Req() request: Request,
        @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
    ) {
        const guest = await this.resolveGuest(request);
        return this.votingService.getMyVote({ guestSessionId: guest.id }, publicationId);
    }

    @Delete(':publicationId/guest-vote')
    async deleteVote(
        @Req() request: Request,
        @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
    ) {
        const guest = await this.resolveGuest(request);
        return this.votingService.deleteVote({ guestSessionId: guest.id }, publicationId);
    }

    private resolveGuest(request: Request) {
        return this.guestSessionService.requireValidSession(
            request.cookies?.[GUEST_SESSION_COOKIE_NAME],
        );
    }
}