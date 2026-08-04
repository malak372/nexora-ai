import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';

import { IdeaOutputsService } from '../services/idea-outputs.service';
import { IdeaUnlockService } from '../services/idea-unlock.service';

/**
 * Controller used by authenticated users to retrieve advanced outputs
 * belonging to their own unlocked project ideas.
 *
 * Base route:
 * /users/ideas/:ideaId/outputs
 *
 * Access rules:
 * - The idea must belong to the authenticated user.
 * - The idea must not be soft-deleted.
 * - The idea must already be unlocked through premium generation
 *   or successful direct payment.
 *
 * @author Malak
 */
@Controller('users/ideas/:ideaId/outputs')
@UseGuards(JwtAuthGuard)
export class IdeaOutputsController {
  constructor(
    private readonly ideaOutputsService: IdeaOutputsService,
    private readonly ideaUnlockService: IdeaUnlockService,
  ) { }

  /** Premium-only credit unlock for one owned NORMAL_FREE idea. */
  @Post('unlock-with-credit')
  unlockWithCredit(
    @CurrentUser('id') userId: string,
    @Param(
      'ideaId',
      new ParseUUIDPipe({ version: '4' }),
    )
    ideaId: string,
  ) {
    return this.ideaUnlockService.unlockIdeaWithCredit(userId, ideaId);
  }

  /**
   * Retrieves all successfully generated advanced outputs for one
   * authenticated-user-owned idea.
   *
   * GET /users/ideas/:ideaId/outputs
   */
  @Get()
  getMyIdeaOutputs(
    @CurrentUser('id') userId: string,

    @Param(
      'ideaId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,
  ) {
    return this.ideaOutputsService.findForOwner(userId, ideaId);
  }
}