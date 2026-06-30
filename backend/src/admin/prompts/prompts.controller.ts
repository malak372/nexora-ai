import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { PromptsService } from './prompts.service';
import { UpdatePromptDto } from './dto/update-prompt.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for managing AI prompt templates.
 *
 * Provides admin-only endpoints for:
 * - Retrieving the current AI prompt template.
 * - Updating the AI prompt template used for idea generation.
 *
 * Base route:
 * /admin/prompts
 *
 * @author Malak
 */
@Controller('admin/prompts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  /**
   * Retrieves the current AI prompt template.
   *
   * Endpoint:
   * GET /admin/prompts
   */
  @Get()
  getPrompt() {
    return this.promptsService.getPrompt();
  }

  /**
   * Updates the AI prompt template.
   *
   * Endpoint:
   * PATCH /admin/prompts
   */
  @Patch()
  updatePrompt(
    @Body() body: UpdatePromptDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.promptsService.updatePrompt(body, currentUser.id);
  }
}