import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserFavoritesService } from './favorites.service';

/**
 * Authenticated endpoints for private generated-idea favorites.
 *
 * Favorites belong exclusively to the authenticated user and do not depend on
 * idea publication status.
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserFavoritesController {
  constructor(private readonly favoritesService: UserFavoritesService) {}

  /** Adds a user-owned idea to private favorites. */
  @Post('ideas/:ideaId/favorite')
  addFavorite(
    @CurrentUser() user: { id: string },
    @Param('ideaId', ParseUUIDPipe) ideaId: string,
  ) {
    return this.favoritesService.addFavorite(user.id, ideaId);
  }

  /** Removes a user-owned idea from private favorites. */
  @Delete('ideas/:ideaId/favorite')
  removeFavorite(
    @CurrentUser() user: { id: string },
    @Param('ideaId', ParseUUIDPipe) ideaId: string,
  ) {
    return this.favoritesService.removeFavorite(user.id, ideaId);
  }

  /** Returns all private favorite ideas for the authenticated user. */
  @Get('favorites')
  getFavorites(@CurrentUser() user: { id: string }) {
    return this.favoritesService.getFavorites(user.id);
  }
}
