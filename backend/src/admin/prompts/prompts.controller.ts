import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PromptsService } from './prompts.service';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Controller responsible for managing AI prompt templates.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve the current AI prompt template.
 * - Update the prompt template used for software project idea generation.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
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
  constructor(private readonly promptsService: PromptsService) { }

  /**
   * Retrieves the current AI prompt template.
   *
   * Endpoint:
   * GET /admin/prompts
   *
   * This read-only endpoint is not recorded in audit logs.
   *
   * @returns The current AI prompt template.
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
   *
   * This is considered a sensitive admin action because it
   * directly affects the AI-generated project ideas.
   *
   * @param body - DTO containing the updated prompt template.
   * @param currentUser - The authenticated administrator.
   * @returns A success message and the updated prompt template.
   */
  @Patch()
  updatePrompt(
    @Body() body: UpdatePromptDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.promptsService.updatePrompt(body, currentUser.id);
  }
}