import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { GetUserIdeasQueryDto } from '../dto/get-user-ideas-query.dto';
import { UserIdeasService } from '../services/user-ideas.service';

/**
 * Controller responsible for authenticated-user generated ideas.
 *
 * Base route:
 * /users/ideas
 *
 * @author Eman
 */
@Controller('users/ideas')
@UseGuards(JwtAuthGuard)
export class UserIdeasController {
  constructor(
    private readonly userIdeasService: UserIdeasService,
  ) {}

  /**
   * Retrieves the authenticated user's generated ideas.
   *
   * GET /users/ideas
   */
  @Get()
  getGeneratedIdeas(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserIdeasQueryDto,
  ) {
    return this.userIdeasService.getGeneratedIdeas(
      user.id,
      query,
    );
  }
}