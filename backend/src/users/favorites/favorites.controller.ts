import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserFavoritesService } from './favorites.service';

/**
 * Controller responsible for authenticated user favorite ideas.
 *
 * Base routes:
 * - /users/ideas/:id/favorite
 * - /users/favorites
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserFavoritesController {
  constructor(private readonly userFavoritesService: UserFavoritesService) {}

  /**
   * Adds one of the authenticated user's ideas to favorites.
   */
  @Post('ideas/:id/favorite')
  addFavorite(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) ideaId: string,
  ) {
    return this.userFavoritesService.addFavorite(user.id, ideaId);
  }

  /**
   * Removes one of the authenticated user's ideas from favorites.
   */
  @Delete('ideas/:id/favorite')
  removeFavorite(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) ideaId: string,
  ) {
    return this.userFavoritesService.removeFavorite(user.id, ideaId);
  }

  /**
   * Retrieves the authenticated user's favorite ideas.
   */
  @Get('favorites')
  getFavorites(@CurrentUser() user: { id: string }) {
    return this.userFavoritesService.getFavorites(user.id);
  }
}
