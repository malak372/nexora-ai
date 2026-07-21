import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IdeaGenerationRunStatus } from '@prisma/client';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';
import { CancelGenerationRunDto } from '../dto/cancel-generation-run.dto';
import { GetGenerationRunsQueryDto } from '../dto/get-generation-runs-query.dto';
import { IdeaGenerationCancellationService } from '../pipeline/idea-generation-cancellation.service';
import { IdeaGenerationQueryService } from '../services/idea-generation-query.service';

/** Authenticated generation-run monitoring and cancellation endpoints. */
@Controller('users/idea-generation-runs')
@UseGuards(JwtAuthGuard)
export class IdeaGenerationRunsController {
  constructor(
    private readonly queries: IdeaGenerationQueryService,
    private readonly cancellation: IdeaGenerationCancellationService,
  ) {}

  @Get()
  getMyGenerationRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetGenerationRunsQueryDto,
  ) {
    return this.queries.findUserRuns(user.id, query);
  }

  @Get(':runId')
  getMyGenerationRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
  ) {
    return this.queries.findOwnedUserRun(user.id, runId);
  }

  @Post(':runId/cancel')
  async cancelMyGenerationRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Body() dto: CancelGenerationRunDto,
  ) {
    const result = await this.cancellation.requestCancellation(runId, {
      type: 'USER',
      userId: user.id,
    });

    return {
      runId: result.run.id,
      status: result.run.status,
      cancelRequestedAt: result.run.cancelRequestedAt,
      cancellationRequested:
        result.run.cancelRequestedAt !== null ||
        result.run.status === IdeaGenerationRunStatus.CANCELLED,
      alreadyRequested: result.alreadyRequested,
      alreadyTerminal: result.alreadyTerminal,
      reason: dto.reason ?? null,
    };
  }
}
