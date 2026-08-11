import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AdministratorsService } from '../administrators.service';
import { AcceptAdminInvitationDto } from '../dto/accept-admin-invitation.dto';

const ACCEPT_INVITATION_RATE_LIMIT_MS = 60_000;

/**
 * Public endpoint used only by the person who received an invitation.
 *
 * The eight-digit email code is rate-limited to make online guessing
 * impractical while keeping the onboarding flow simple.
 */
@Controller('auth/admin-invitations')
export class AdminInvitationAcceptanceController {
  constructor(
    private readonly administratorsService: AdministratorsService,
  ) {}

  @Post('accept')
  @Throttle({
    default: {
      limit: 5,
      ttl: ACCEPT_INVITATION_RATE_LIMIT_MS,
    },
  })
  accept(@Body() dto: AcceptAdminInvitationDto) {
    return this.administratorsService.accept(dto);
  }
}