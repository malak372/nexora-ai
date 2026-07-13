import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AiModel, UserRole } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { AiModelsService } from './ai-models.service';

import { CreateAiModelDto } from './dto/create-ai-model.dto';
import { GetAiModelsQueryDto } from './dto/get-ai-models-query.dto';
import { UpdateAiModelDto } from './dto/update-ai-model.dto';

import { PaginatedAiModelsResult } from './types/ai-models.type';

/**
 * Administrator-only AI-model management controller.
 *
 * Base route:
 * /ai-models
 *
 * All routes require:
 * - A valid JWT access token.
 * - ADMIN role.
 *
 * Runtime model routing and health operations are intentionally not
 * exposed from this controller.
 *
 * @author Malak
 */
@Controller('ai-models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiModelsController {
  constructor(private readonly aiModelsService: AiModelsService) {}

  /**
   * Creates a new AI-model configuration.
   *
   * The model is always created as non-default.
   *
   * POST /ai-models
   */
  @Post()
  create(
    @Body()
    dto: CreateAiModelDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.create(dto, user.id);
  }

  /**
   * Returns paginated and filtered AI models.
   *
   * GET /ai-models
   *
   * Supported examples:
   * - /ai-models?page=1&limit=10
   * - /ai-models?provider=OPENROUTER
   * - /ai-models?isActive=true
   * - /ai-models?healthStatus=HEALTHY
   * - /ai-models?search=gpt
   */
  @Get()
  findAll(
    @Query()
    query: GetAiModelsQueryDto,
  ): Promise<PaginatedAiModelsResult> {
    return this.aiModelsService.findAll(query);
  }

  /**
   * Returns the configured active default model.
   *
   * This route must be declared before GET /:id so the word
   * "default" is not interpreted as a UUID parameter.
   *
   * GET /ai-models/default
   */
  @Get('default')
  getDefaultModel(): Promise<AiModel> {
    return this.aiModelsService.getDefaultModel();
  }

  /**
   * Returns one AI model by its UUID.
   *
   * GET /ai-models/:id
   */
  @Get(':id')
  findOne(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    id: string,
  ): Promise<AiModel> {
    return this.aiModelsService.findOne(id);
  }

  /**
   * Updates editable AI-model metadata.
   *
   * This endpoint cannot:
   * - Activate or deactivate a model.
   * - Set a model as default.
   * - Change operational health fields.
   *
   * PATCH /ai-models/:id
   */
  @Patch(':id')
  update(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    id: string,

    @Body()
    dto: UpdateAiModelDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.update(id, dto, user.id);
  }

  /**
   * Sets one active and routable model as default.
   *
   * PATCH /ai-models/:id/default
   */
  @Patch(':id/default')
  setDefault(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    id: string,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.setDefault(id, user.id);
  }

  /**
   * Deactivates one non-default AI model.
   *
   * The current default model cannot be deactivated.
   *
   * PATCH /ai-models/:id/deactivate
   */
  @Patch(':id/deactivate')
  deactivate(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    id: string,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.deactivate(id, user.id);
  }

  /**
   * Activates one inactive AI model.
   *
   * The model returns to UNKNOWN health and does not automatically
   * become the default model.
   *
   * PATCH /ai-models/:id/activate
   */
  @Patch(':id/activate')
  activate(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    id: string,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.activate(id, user.id);
  }
}
