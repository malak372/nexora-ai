import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';

import type { Request, Response } from 'express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { GenerateGuestIdeaDto } from '../dto/generate-guest-idea.dto';

import { GenerateIdeaDto } from '../dto/generate-idea.dto';

import { IdeaGenerationOrchestratorService } from '../services/idea-generation-orchestrator.service';

/**
 * Handles guest and authenticated idea generation.
 *
 * Base route:
 * /ideas
 *
 * @author Malak
 */
@Controller('ideas')
export class IdeaGenerationController {
  constructor(
    private readonly generationService: IdeaGenerationOrchestratorService,
  ) {}

  /**
   * Generates the single guest idea.
   *
   * POST /ideas/guest/generate
   */
  @Post('guest/generate')
  generateGuest(
    @Body()
    dto: GenerateGuestIdeaDto,

    @Req()
    request: Request,

    @Res({
      passthrough: true,
    })
    response: Response,
  ) {
    return this.generationService.generateForGuest(
      dto,

      request,

      response,
    );
  }

  /**
   * Generates a registered free-tier or premium-credit idea.
   *
   * POST /ideas/generate
   */
  @Post('generate')
  @UseGuards(JwtAuthGuard)
  generateForUser(
    @CurrentUser()
    user: AuthenticatedUser,

    @Body()
    dto: GenerateIdeaDto,
  ) {
    return this.generationService.generateForUser(
      user.id,

      dto,
    );
  }
}
