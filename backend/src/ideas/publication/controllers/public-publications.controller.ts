import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';

import { GetPublicationsQueryDto } from '../dto/get-publications-query.dto';
import { IdeaPublicationQueryService } from '../services/idea-publication-query.service';

/**
 * Public controller exposing published idea publications.
 *
 * These endpoints are accessible without authentication and only return
 * publications that are:
 * - Published.
 * - Publicly visible.
 *
 * No draft, archived, private, or restricted publications can be accessed
 * through this controller.
 *
 * Responsibilities:
 * - Retrieve paginated public publications.
 * - Retrieve a single published public publication.
 *
 * @author Malak
 */
@Controller('publications')
export class PublicPublicationsController {
  constructor(
    private readonly queryService: IdeaPublicationQueryService,
  ) {}

  /**
   * Retrieves paginated published public idea publications.
   *
   * Supported query features:
   * - Pagination.
   * - Search.
   * - Sorting.
   * - Date filtering.
   *
   * Only publications with:
   * - status = PUBLISHED
   * - visibility = PUBLIC
   * are returned.
   *
   * @param query Publication query options.
   * @returns Paginated list of public publications.
   */
  @Get()
  findAll(@Query() query: GetPublicationsQueryDto) {
    return this.queryService.findPublic(query);
  }

  /**
   * Retrieves a single published public publication.
   *
   * Returns 404 if:
   * - The publication does not exist.
   * - The publication is not published.
   * - The publication is not publicly visible.
   *
   * @param publicationId Publication UUID.
   * @returns Publication details.
   */
  @Get(':publicationId')
  findOne(
    @Param(
      'publicationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    publicationId: string,
  ) {
    return this.queryService.findPublicById(publicationId);
  }
}