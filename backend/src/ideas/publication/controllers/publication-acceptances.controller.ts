import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

import { PaymentCheckoutService } from '../../../payments/services/payment-checkout.service';

import { CreatePublicationAcceptanceDto } from '../dto/create-publication-acceptance.dto';

import { IdeaPublicationAcceptanceService } from '../services/idea-publication-acceptance.service';

/**
 * Provides authenticated users with publication-acceptance endpoints.
 *
 * Responsibilities:
 * - Allow Premium users to accept basic publication details for free.
 * - Create paid publication-acceptance checkout sessions for Normal users.
 * - Allow Premium users to unlock advanced publication details using credits.
 * - Return the authenticated user's acceptance state for one publication.
 *
 * Base route:
 * /users/publications
 *
 * @author Malak
 */
@Controller('users/publications')
@UseGuards(JwtAuthGuard)
export class PublicationAcceptancesController {
  constructor(
    private readonly acceptanceService: IdeaPublicationAcceptanceService,
    private readonly paymentCheckoutService: PaymentCheckoutService,
  ) {}

  /**
   * Accepts one published idea.
   *
   * Premium users receive the basic publication acceptance immediately
   * without making a direct payment.
   *
   * Normal users receive an external checkout session. Their acceptance
   * is created only after successful payment-provider webhook confirmation.
   *
   * @param user Authenticated user.
   * @param publicationId Publication identifier.
   * @param dto Publication-acceptance and payment information.
   * @returns Existing or newly created acceptance for Premium users,
   * or an external checkout-session result for Normal users.
   */
  @Post(':publicationId/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,
    @Body() dto: CreatePublicationAcceptanceDto,
  ) {
    return this.paymentCheckoutService.createPublicationAcceptanceCheckout(
      user.id,
      publicationId,
      dto,
    );
  }

  /**
   * Unlocks advanced details for a previously accepted publication.
   *
   * The acceptance service verifies that:
   * - The authenticated user currently has a Premium account.
   * - The user has already accepted the publication.
   * - The advanced details have not already been unlocked.
   * - The user has enough credits.
   *
   * Repeated requests are handled safely by the acceptance service because
   * an acceptance whose advanced details are already unlocked is returned
   * without consuming credits again.
   *
   * @param user Authenticated user.
   * @param publicationId Publication identifier.
   * @returns Updated publication acceptance.
   */
  @Post(':publicationId/unlock-advanced')
  unlockAdvanced(
    @CurrentUser() user: AuthenticatedUser,
    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,
  ) {
    return this.acceptanceService.unlockAdvancedForPremium(
      user.id,
      publicationId,
    );
  }

  /**
   * Returns the authenticated user's acceptance state for
   * one publication.
   *
   * @param user Authenticated user.
   * @param publicationId Publication identifier.
   * @returns Acceptance state or null when the publication has not
   * been accepted by the authenticated user.
   */
  @Get(':publicationId/my-acceptance')
  getMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param(
      'publicationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    publicationId: string,
  ) {
    return this.acceptanceService.getMyAcceptance(user.id, publicationId);
  }
}