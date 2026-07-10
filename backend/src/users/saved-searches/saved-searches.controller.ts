import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { GetSavedSearchesQueryDto } from './dto/get-saved-searches-query.dto';
import { UserSavedSearchesService } from './saved-searches.service';

/**
 * Controller responsible for authenticated user saved generation searches.
 *
 * Base route:
 * /users/saved-searches
 *
 * Saved searches allow users to store and reuse idea generation criteria
 * such as domain, geographical context, language, selected platforms,
 * and keywords.
 *
 * @author Eman
 */
@Controller('users/saved-searches')
@UseGuards(JwtAuthGuard)
export class UserSavedSearchesController {
  constructor(
    private readonly userSavedSearchesService: UserSavedSearchesService,
  ) {}

  /**
   * Creates a reusable saved generation search for the authenticated user.
   */
  @Post()
  createSavedSearch(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateSavedSearchDto,
  ) {
    return this.userSavedSearchesService.createSavedSearch(user.id, dto);
  }

  /**
   * Retrieves the authenticated user's saved generation searches.
   *
   * Supports filtering, searching, sorting, date filtering, and pagination.
   */
  @Get()
  getSavedSearches(
    @CurrentUser() user: { id: string },
    @Query() query: GetSavedSearchesQueryDto,
  ) {
    return this.userSavedSearchesService.getSavedSearches(user.id, query);
  }

  /**
   * Retrieves a single saved generation search owned by the authenticated user.
   */
  @Get(':id')
  getSavedSearchById(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) savedSearchId: string,
  ) {
    return this.userSavedSearchesService.getSavedSearchById(
      user.id,
      savedSearchId,
    );
  }

  /**
   * Marks a saved generation search as used.
   *
   * Used by the frontend when the user reuses a saved search
   * through a "Generate Again" action.
   */
  @Patch(':id/use')
  markSavedSearchAsUsed(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) savedSearchId: string,
  ) {
    return this.userSavedSearchesService.markSavedSearchAsUsed(
      user.id,
      savedSearchId,
    );
  }

  /**
   * Deletes a saved generation search owned by the authenticated user.
   */
  @Delete(':id')
  deleteSavedSearch(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) savedSearchId: string,
  ) {
    return this.userSavedSearchesService.deleteSavedSearch(
      user.id,
      savedSearchId,
    );
  }
}
