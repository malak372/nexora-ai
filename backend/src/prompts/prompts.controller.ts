import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { GetPromptHistoryQueryDto } from './dto/get-prompt-history-query.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';
import { PromptHistoryService } from './services/prompt-history.service';
import { PromptTemplateService } from './services/prompt-template.service';

/**
 * Admin-only controller for prompt template management and prompt history.
 *
 * Routes:
 * - GET /prompts/template
 * - PATCH /prompts/template
 * - GET /prompts/history
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
   * Returns the active AI idea prompt template.
   */
  @Get('template')
  getCurrentTemplate(): Promise<{ ideaPromptTemplate: string }> {
    return this.promptTemplateService.getCurrentTemplate();
  }

  /**
   * Updates the AI idea prompt template.
   */
  @Patch('template')
  updateTemplate(
    @Body() dto: UpdatePromptTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ideaPromptTemplate: string }> {
    return this.promptTemplateService.updateTemplate(
      dto.ideaPromptTemplate,
      user.id,
    );
  }

  /**
   * Returns paginated prompt history records.
   */
  @Get('history')
  getPromptHistory(
    @Query() query: GetPromptHistoryQueryDto,
  ): ReturnType<PromptHistoryService['findAll']> {
    return this.promptHistoryService.findAll(query);
  }
}