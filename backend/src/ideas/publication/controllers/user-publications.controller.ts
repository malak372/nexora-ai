import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

import { GeneratePublicationDescriptionDto } from '../dto/generate-publication-description.dto';
import { GetPublicationsQueryDto } from '../dto/get-publications-query.dto';
import { UpsertIdeaPublicationDto } from '../dto/upsert-idea-publication.dto';
import { IdeaPublicationAiService } from '../services/idea-publication-ai.service';
import { IdeaPublicationQueryService } from '../services/idea-publication-query.service';
import { IdeaPublicationService } from '../services/idea-publication.service';

/**
 * Authenticated endpoints used to manage and discover idea publications.
 *
 * @author Malak
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserPublicationsController {
  constructor(
    private readonly publicationService: IdeaPublicationService,
    private readonly queryService: IdeaPublicationQueryService,
    private readonly publicationAiService: IdeaPublicationAiService,
  ) {}

  /**
   * Creates or updates the safe public snapshot of an owned idea.
   */
  @Put('ideas/:ideaId/publication')
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' })) ideaId: string,
    @Body() dto: UpsertIdeaPublicationDto,
  ) {
    return this.publicationService.upsert(user.id, ideaId, dto);
  }

  /**
   * Generates an editable AI-assisted public description.
   *
   * The generated text is returned to the client and is not saved or
   * published automatically.
   */
  @Post('ideas/:ideaId/publication/generate-description')
  generateDescription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' })) ideaId: string,
    @Body() dto: GeneratePublicationDescriptionDto,
  ) {
    return this.publicationAiService.generateDescription(user.id, ideaId, dto);
  }

  /**
   * Publishes an existing publication draft.
   */
  @Post('ideas/:ideaId/publication/publish')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' })) ideaId: string,
  ) {
    return this.publicationService.publish(user.id, ideaId);
  }

  /**
   * Archives an owned publication.
   */
  @Post('ideas/:ideaId/publication/archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' })) ideaId: string,
  ) {
    return this.publicationService.archive(user.id, ideaId);
  }

  /**
   * Deletes an owned publication while it is still a draft.
   */
  @Delete('ideas/:ideaId/publication')
  deleteDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ideaId', new ParseUUIDPipe({ version: '4' })) ideaId: string,
  ) {
    return this.publicationService.deleteDraft(user.id, ideaId);
  }

  /**
   * Returns publications owned by the authenticated user.
   */
  @Get('publications/mine')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPublicationsQueryDto,
  ) {
    return this.queryService.findMine(user.id, query);
  }

  /**
   * Returns published ideas visible to the authenticated user.
   */
  @Get('publications/discover')
  discover(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPublicationsQueryDto,
  ) {
    return this.queryService.findDiscoverable(user.id, user.userType, query);
  }

  /**
   * Returns one publication when the authenticated user can access it.
   */
  @Get('publications/:publicationId')
  findAccessible(
    @CurrentUser() user: AuthenticatedUser,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' }))
    publicationId: string,
  ) {
    return this.queryService.findAccessibleById(
      publicationId,
      user.id,
      user.userType,
    );
  }
}
