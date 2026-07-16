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

import { UserRole } from '@prisma/client';
import type { AiModel } from '@prisma/client';

import {
  SUPPORTED_AI_PROVIDERS,
  type SupportedAiProvider,
} from '../ai/constants/ai-provider.constants';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { AiModelsService } from './ai-models.service';

import { CreateAiModelDto } from './dto/create-ai-model.dto';
import { GetAiModelsQueryDto } from './dto/get-ai-models-query.dto';
import { UpdateAiModelDto } from './dto/update-ai-model.dto';

import type { PaginatedAiModelsResult } from './types/ai-models.type';

/**
 * Administrator-only AI-model management controller.
 *
 * Base route:
 * /ai-models
 *
 * @author Malak
 */
@Controller('ai-models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiModelsController {
  constructor(private readonly aiModelsService: AiModelsService) {}

  /**
   * Returns providers implemented by the deployed backend.
   *
   * This static route must remain declared before GET /:id.
   *
   * GET /ai-models/providers
   */
  @Get('providers')
  getSupportedProviders(): readonly SupportedAiProvider[] {
    return SUPPORTED_AI_PROVIDERS;
  }

  /**
   * Creates a new non-default AI-model configuration.
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
   * Returns filtered and paginated AI-model configurations.
   *
   * GET /ai-models
   */
  @Get()
  findAll(
    @Query()
    query: GetAiModelsQueryDto,
  ): Promise<PaginatedAiModelsResult> {
    return this.aiModelsService.findAll(query);
  }

  /**
   * Returns the active and routable default model.
   *
   * This static route must remain declared before GET /:id.
   *
   * GET /ai-models/default
   */
  @Get('default')
  getDefaultModel(): Promise<AiModel> {
    return this.aiModelsService.getDefaultModel();
  }

  /**
   * Returns one AI model by UUID.
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
   * Sets one model as the system default.
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
   * Activates one AI model.
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

  /**
   * Deactivates one non-default AI model.
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
}
