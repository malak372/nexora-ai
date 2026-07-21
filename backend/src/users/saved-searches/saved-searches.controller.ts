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

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { GetSavedSearchesQueryDto } from './dto/get-saved-searches-query.dto';
import { UpdateSavedSearchDto } from './dto/update-saved-search.dto';
import { UserSavedSearchesService } from './saved-searches.service';

/**
 * Authenticated endpoints for reusable idea-generation searches.
 *
 * Each operation is scoped to the current user inside the service.
 *
 * @author Eman
 */
@Controller('users/saved-searches')
@UseGuards(JwtAuthGuard)
export class UserSavedSearchesController {
  constructor(
    private readonly savedSearchesService: UserSavedSearchesService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateSavedSearchDto,
  ) {
    return this.savedSearchesService.createSavedSearch(user.id, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string },
    @Query() query: GetSavedSearchesQueryDto,
  ) {
    return this.savedSearchesService.getSavedSearches(user.id, query);
  }

  @Get(':savedSearchId')
  findOne(
    @CurrentUser() user: { id: string },
    @Param('savedSearchId', ParseUUIDPipe) savedSearchId: string,
  ) {
    return this.savedSearchesService.getSavedSearchById(user.id, savedSearchId);
  }

  @Patch(':savedSearchId')
  update(
    @CurrentUser() user: { id: string },
    @Param('savedSearchId', ParseUUIDPipe) savedSearchId: string,
    @Body() dto: UpdateSavedSearchDto,
  ) {
    return this.savedSearchesService.updateSavedSearch(
      user.id,
      savedSearchId,
      dto,
    );
  }

  @Post(':savedSearchId/use')
  markAsUsed(
    @CurrentUser() user: { id: string },
    @Param('savedSearchId', ParseUUIDPipe) savedSearchId: string,
  ) {
    return this.savedSearchesService.markSavedSearchAsUsed(
      user.id,
      savedSearchId,
    );
  }

  @Delete(':savedSearchId')
  remove(
    @CurrentUser() user: { id: string },
    @Param('savedSearchId', ParseUUIDPipe) savedSearchId: string,
  ) {
    return this.savedSearchesService.deleteSavedSearch(user.id, savedSearchId);
  }
}
