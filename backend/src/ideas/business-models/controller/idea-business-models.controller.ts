import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';

import type { Response } from 'express';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';

import { GenerateIdeaBusinessModelDto } from '../dto/generate-idea-business-model.dto';
import { IdeaBusinessModelsService } from '../services/idea-business-models.service';

/**
 * Manages post-generation business models for authenticated idea owners.
 *
 * Responsibilities:
 * - Generate a new business-model version using a selected template.
 * - Return the current generated version.
 * - Return preserved historical versions.
 * - Render the current version as an inline HTML preview.
 * - Download the current version as a standalone HTML file.
 *
 * Base route:
 * /users/ideas/:ideaId/business-models
 *
 * @author Malak
 */
@Controller('users/ideas/:ideaId/business-models')
@UseGuards(JwtAuthGuard)
export class IdeaBusinessModelsController {
  constructor(
    private readonly ideaBusinessModelsService: IdeaBusinessModelsService,
  ) {}

  /**
   * Generates a new business-model version using the selected template.
   *
   * Calling this endpoint again with the same or another template preserves
   * the old version and makes the newly generated version current.
   */
  @Post()
  generate(
    @CurrentUser('id') userId: string,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' }))
    ideaId: string,
    @Body() dto: GenerateIdeaBusinessModelDto,
  ) {
    return this.ideaBusinessModelsService.generate(userId, ideaId, dto);
  }

  /** Returns the current business-model version as JSON. */
  @Get('current')
  findCurrent(
    @CurrentUser('id') userId: string,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' }))
    ideaId: string,
  ) {
    return this.ideaBusinessModelsService.findCurrent(userId, ideaId);
  }

  /**
   * Renders the current business-model version directly in the browser.
   */
  @Get('current/preview')
  async previewCurrent(
    @CurrentUser('id') userId: string,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' }))
    ideaId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.ideaBusinessModelsService.renderCurrentHtml(
      userId,
      ideaId,
    );

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.html);
  }

  /**
   * Downloads the current business-model version as a standalone HTML file.
   */
  @Get('current/download')
  async downloadCurrent(
    @CurrentUser('id') userId: string,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' }))
    ideaId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.ideaBusinessModelsService.renderCurrentHtml(
      userId,
      ideaId,
    );

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.html);
  }

  /** Returns all preserved versions, newest first. */
  @Get('history')
  findHistory(
    @CurrentUser('id') userId: string,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' }))
    ideaId: string,
  ) {
    return this.ideaBusinessModelsService.findHistory(userId, ideaId);
  }
}
