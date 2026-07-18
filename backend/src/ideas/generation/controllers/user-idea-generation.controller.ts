import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';

import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

import { GenerateIdeaDto } from '../dto/generate-idea.dto';

import { IdeaGenerationOrchestratorService } from '../services/idea-generation-orchestrator.service';

/**
 * Maximum number of authenticated idea-generation requests
 * permitted during one throttling window.
 *
 * @author Malak
 */
const USER_GENERATION_RATE_LIMIT = 5;

/**
 * Authenticated generation throttling window in milliseconds.
 *
 * @author Malak
 */
const USER_GENERATION_RATE_LIMIT_TTL_MS =
  60_000;

/**
 * Controller responsible for starting authenticated-user idea
 * generation.
 *
 * Base route:
 * /users/ideas/generate
 *
 * Responsibilities:
 * - Require JWT authentication.
 * - Resolve the authenticated user.
 * - Validate GenerateIdeaDto.
 * - Delegate generation orchestration.
 *
 * The requested generation type may be:
 * - NORMAL_FREE
 * - PREMIUM_CREDIT
 *
 * The entitlement stage still verifies the user's current
 * database state before generation is allowed.
 *
 * @author Malak
 */
@Controller('users/ideas/generate')
@UseGuards(JwtAuthGuard)
export class UserIdeaGenerationController {
  constructor(
    private readonly orchestrator:
      IdeaGenerationOrchestratorService,
  ) {}

  /**
   * Starts one idea-generation workflow for the authenticated
   * user.
   *
   * Endpoint:
   * POST /users/ideas/generate
   *
   * @param currentUser Authenticated user attached by Passport.
   * @param dto Validated generation request.
   * @returns Completed generation-pipeline result.
   */
  @Post()
  @Throttle({
    default: {
      limit:
        USER_GENERATION_RATE_LIMIT,

      ttl:
        USER_GENERATION_RATE_LIMIT_TTL_MS,
    },
  })
  generateIdea(
    @CurrentUser()
    currentUser: AuthenticatedUser,

    @Body()
    dto: GenerateIdeaDto,
  ) {
    return this.orchestrator.generateForUser({
      userId: currentUser.id,
      dto,
    });
  }
}