import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { GetPromptHistoryQueryDto } from './dto/get-prompt-history-query.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';

import { PromptHistoryService } from './services/prompt-history.service';
import {
  PromptTemplateResponse,
  PromptTemplateService,
} from './services/prompt-template.service';

import { PaginatedPromptHistory } from './types/prompt-history.type';

/**
 * Administrator-only controller for prompt-template management
 * and prompt-history retrieval.
 *
 * Routes:
 * - GET /prompts/template
 * - PATCH /prompts/template
 * - GET /prompts/history
 *
 * All routes require an authenticated administrator.
 *
 * @author Malak
 */
@Controller('prompts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PromptsController {
  constructor(
    private readonly promptTemplateService: PromptTemplateService,
    private readonly promptHistoryService: PromptHistoryService,
  ) {}

  /**
   * Returns the currently active idea-generation prompt template.
   */
  @Get('template')
  getCurrentTemplate(): Promise<PromptTemplateResponse> {
    return this.promptTemplateService.getCurrentTemplate();
  }

  /**
   * Updates the active idea-generation prompt template.
   */
  @Patch('template')
  updateTemplate(
    @Body() dto: UpdatePromptTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PromptTemplateResponse> {
    return this.promptTemplateService.updateTemplate(
      dto.ideaPromptTemplate,
      user.id,
    );
  }

  /**
   * Returns filtered, sorted, and paginated prompt-history records.
   */
  @Get('history')
  getPromptHistory(
    @Query() query: GetPromptHistoryQueryDto,
  ): Promise<PaginatedPromptHistory> {
    return this.promptHistoryService.findAll(query);
  }
}
