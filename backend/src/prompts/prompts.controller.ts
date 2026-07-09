import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { PromptHistoryService } from './services/prompt-history.service';
import { PromptTemplateService } from './services/prompt-template.service';
import { GetPromptHistoryQueryDto } from './dto/get-prompt-history-query.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  JwtCurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Controller responsible for managing AI prompt configuration
 * and prompt execution history.
 *
 * This controller is restricted to ADMIN users only because prompt templates
 * directly affect the quality, consistency, and behavior of AI-generated outputs.
 *
 * Routes:
 * - GET   /prompts/template
 * - PATCH /prompts/template
 * - GET   /prompts/history
 *
 * @author Malak
 */
@Controller('prompts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PromptsController {
  constructor(
    private readonly promptHistoryService: PromptHistoryService,
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  /**
   * Retrieves the currently active idea generation prompt template.
   *
   * This template is used by the system when building prompts for AI-based
   * idea generation and advanced idea unlock outputs.
   *
   * Access:
   * - ADMIN only
   *
   * @returns The current system prompt template configuration.
   */
  @Get('template')
  getCurrentTemplate() {
    return this.promptTemplateService.getCurrentTemplate();
  }

  /**
   * Updates the active idea generation prompt template.
   *
   * Only ADMIN users can update the template because changes here affect
   * all future AI prompt generation behavior.
   *
   * The admin user ID is passed to the service so the update can be audited
   * and linked to the admin who performed the action.
   *
   * Access:
   * - ADMIN only
   *
   * @param user The currently authenticated admin user.
   * @param dto The new prompt template payload.
   * @returns The updated prompt template configuration.
   */
  @Patch('template')
  updateTemplate(
    @CurrentUser() user: JwtCurrentUser,
    @Body() dto: UpdatePromptTemplateDto,
  ) {
    return this.promptTemplateService.updateTemplate(
      user.id,
      dto.ideaPromptTemplate,
    );
  }

  /**
   * Retrieves stored prompt history records.
   *
   * Prompt history helps admins monitor what prompts were generated,
   * which feature created them, and whether they are linked to an idea
   * or a data collection job.
   *
   * Supports filtering, searching, sorting, and pagination through
   * GetPromptHistoryQueryDto.
   *
   * Access:
   * - ADMIN only
   *
   * @param query Query parameters used to filter and paginate prompt history.
   * @returns A paginated list of prompt history records.
   */
  @Get('history')
  getPromptHistories(@Query() query: GetPromptHistoryQueryDto) {
    return this.promptHistoryService.getPromptHistories(query);
  }
}