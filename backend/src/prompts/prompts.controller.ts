import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../utilities/decorators/current-user.decorator';
import type { JwtCurrentUser } from '../utilities/decorators/current-user.decorator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

import { GetPromptHistoryQueryDto } from './dto/get-prompt-history-query.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';
import { PromptHistoryService } from './services/prompt-history.service';
import { PromptTemplateService } from './services/prompt-template.service';

/**
 * Admin controller for prompt template management and prompt history.
 *
 * All routes are restricted to ADMIN users.
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
   * Returns the active prompt template.
   */
  @Get('template')
  getCurrentTemplate() {
    return this.promptTemplateService.getCurrentTemplate();
  }

  /**
   * Updates the prompt template.
   */
  @Patch('template')
  updateTemplate(
    @Body() dto: UpdatePromptTemplateDto,
    @CurrentUser() user: JwtCurrentUser,
  ) {
    return this.promptTemplateService.updateTemplate(
      dto.ideaPromptTemplate,
      user.id,
    );
  }

  /**
   * Returns prompt history with filters and pagination.
   */
  @Get('history')
  getPromptHistory(@Query() query: GetPromptHistoryQueryDto) {
    return this.promptHistoryService.findAll(query);
  }
}