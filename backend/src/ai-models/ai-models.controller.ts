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

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { AiModelsService } from './ai-models.service';
import { CreateAiModelDto } from './dto/create-ai-model.dto';
import { GetAiModelsQueryDto } from './dto/get-ai-models-query.dto';
import { UpdateAiModelDto } from './dto/update-ai-model.dto';

/**
 * Admin controller for AI model management.
 *
 * Base route:
 * /ai-models
 *
 * Access:
 * ADMIN only.
 *
 * @author Malak
 */
@Controller('ai-models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiModelsController {
  constructor(
    private readonly aiModelsService: AiModelsService,
  ) {}

  /**
   * Creates a new AI model.
   *
   * Endpoint:
   * POST /ai-models
   */
  @Post()
  create(
    @Body() dto: CreateAiModelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiModelsService.create(dto, user.id);
  }

  /**
   * Returns paginated AI models.
   *
   * Endpoint:
   * GET /ai-models
   */
  @Get()
  findAll(
    @Query() query: GetAiModelsQueryDto,
  ) {
    return this.aiModelsService.findAll(query);
  }

  /**
   * Returns the active default AI model.
   *
   * Endpoint:
   * GET /ai-models/default
   */
  @Get('default')
  getDefaultModel() {
    return this.aiModelsService.getDefaultModel();
  }

  /**
   * Returns one AI model.
   *
   * Endpoint:
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
  ) {
    return this.aiModelsService.findOne(id);
  }

  /**
   * Updates one AI model.
   *
   * Endpoint:
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
    @Body() dto: UpdateAiModelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiModelsService.update(
      id,
      dto,
      user.id,
    );
  }

  /**
   * Sets one model as default.
   *
   * Endpoint:
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiModelsService.setDefault(
      id,
      user.id,
    );
  }

  /**
   * Deactivates one AI model.
   *
   * Endpoint:
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiModelsService.deactivate(
      id,
      user.id,
    );
  }

  /**
   * Activates one AI model.
   *
   * Endpoint:
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiModelsService.activate(
      id,
      user.id,
    );
  }
}