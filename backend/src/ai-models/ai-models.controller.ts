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
 * UUID validation pipe used by all AI-model identifier parameters.
 *
 * AI-model identifiers are expected to use UUID version 4.
 */
const AI_MODEL_ID_PIPE = new ParseUUIDPipe({
  version: '4',
});

/**
 * Administrator-only controller responsible for managing configured
 * AI models.
 *
 * All routes require:
 * - A valid authenticated user.
 * - The ADMIN user role.
 *
 * Base route:
 * /ai-models
 *
 * Available operations:
 * - List backend-supported AI providers.
 * - Create AI-model configurations.
 * - Retrieve paginated AI-model configurations.
 * - Retrieve the active default model.
 * - Retrieve one model by identifier.
 * - Update editable model metadata.
 * - Set one model as the system default.
 * - Activate an inactive model.
 * - Deactivate a non-default model.
 *
 * Static GET routes such as /providers and /default are declared before
 * the dynamic GET /:id route to keep route resolution explicit and
 * predictable.
 *
 * @author Malak
 */
@Controller('ai-models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiModelsController {
  constructor(private readonly aiModelsService: AiModelsService) {}

  /**
   * Returns the AI providers implemented by the deployed backend.
   *
   * This endpoint exposes provider-registry metadata that administrators
   * can use when creating or updating AI-model configurations.
   *
   * Providers are defined by the backend provider registry rather than
   * being dynamically loaded from the database.
   *
   * Route:
   * GET /ai-models/providers
   *
   * @returns Read-only list of supported AI providers.
   */
  @Get('providers')
  getSupportedProviders(): readonly SupportedAiProvider[] {
    return SUPPORTED_AI_PROVIDERS;
  }

  /**
   * Creates a new AI-model configuration.
   *
   * Newly created models are not automatically selected as the default
   * model. Default-model selection is handled through the dedicated
   * PATCH /ai-models/:id/default endpoint.
   *
   * The authenticated administrator identifier is forwarded to the
   * service for audit logging.
   *
   * Route:
   * POST /ai-models
   *
   * @param dto Validated AI-model configuration.
   * @param user Authenticated administrator performing the operation.
   * @returns Newly created AI-model record.
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
   * Returns filtered, sorted, and paginated AI-model configurations.
   *
   * Supported query behavior is defined by GetAiModelsQueryDto and may
   * include:
   * - Provider filtering.
   * - Health-status filtering.
   * - Active-status filtering.
   * - Default-status filtering.
   * - Text search.
   * - Date filtering.
   * - Sorting.
   * - Pagination.
   *
   * Route:
   * GET /ai-models
   *
   * @param query Validated list-query parameters.
   * @returns Paginated AI-model result.
   */
  @Get()
  findAll(
    @Query()
    query: GetAiModelsQueryDto,
  ): Promise<PaginatedAiModelsResult> {
    return this.aiModelsService.findAll(query);
  }

  /**
   * Returns the currently configured active and routable default model.
   *
   * The service rejects the request when no valid default model is
   * currently configured.
   *
   * This static route is declared before GET /ai-models/:id.
   *
   * Route:
   * GET /ai-models/default
   *
   * @returns Active and routable default AI model.
   */
  @Get('default')
  getDefaultModel(): Promise<AiModel> {
    return this.aiModelsService.getDefaultModel();
  }

  /**
   * Returns one AI model by UUID.
   *
   * The route identifier is validated as UUID version 4 before the
   * service method is called.
   *
   * Route:
   * GET /ai-models/:id
   *
   * @param id Valid AI-model UUID.
   * @returns Matching AI-model record.
   */
  @Get(':id')
  findOne(
    @Param('id', AI_MODEL_ID_PIPE)
    id: string,
  ): Promise<AiModel> {
    return this.aiModelsService.findOne(id);
  }

  /**
   * Updates editable metadata and configuration fields for one AI model.
   *
   * Generic updates do not directly manage activation state or default
   * selection. Those operations are exposed through dedicated endpoints.
   *
   * The authenticated administrator identifier is forwarded to the
   * service for audit logging.
   *
   * Route:
   * PATCH /ai-models/:id
   *
   * @param id Valid AI-model UUID.
   * @param dto Validated partial AI-model update.
   * @param user Authenticated administrator performing the operation.
   * @returns Updated AI-model record.
   */
  @Patch(':id')
  update(
    @Param('id', AI_MODEL_ID_PIPE)
    id: string,

    @Body()
    dto: UpdateAiModelDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.update(id, dto, user.id);
  }

  /**
   * Sets one active and routable model as the system default.
   *
   * The service ensures that only one model remains marked as default.
   * Selecting the model that is already default is treated as an
   * idempotent operation.
   *
   * Route:
   * PATCH /ai-models/:id/default
   *
   * @param id Valid AI-model UUID.
   * @param user Authenticated administrator performing the operation.
   * @returns Newly selected default AI model.
   */
  @Patch(':id/default')
  setDefault(
    @Param('id', AI_MODEL_ID_PIPE)
    id: string,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.setDefault(id, user.id);
  }

  /**
   * Activates one inactive AI model.
   *
   * Activating a model resets its operational health state so that
   * future executions can evaluate its current availability again.
   *
   * Activating a model that is already active is treated as an
   * idempotent operation.
   *
   * Route:
   * PATCH /ai-models/:id/activate
   *
   * @param id Valid AI-model UUID.
   * @param user Authenticated administrator performing the operation.
   * @returns Active AI-model record.
   */
  @Patch(':id/activate')
  activate(
    @Param('id', AI_MODEL_ID_PIPE)
    id: string,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.activate(id, user.id);
  }

  /**
   * Deactivates one non-default AI model.
   *
   * The currently configured default model cannot be deactivated until
   * another eligible model is selected as default.
   *
   * Deactivating a model that is already inactive is treated as an
   * idempotent operation.
   *
   * Route:
   * PATCH /ai-models/:id/deactivate
   *
   * @param id Valid AI-model UUID.
   * @param user Authenticated administrator performing the operation.
   * @returns Inactive AI-model record.
   */
  @Patch(':id/deactivate')
  deactivate(
    @Param('id', AI_MODEL_ID_PIPE)
    id: string,

    @CurrentUser()
    user: AuthenticatedUser,
  ): Promise<AiModel> {
    return this.aiModelsService.deactivate(id, user.id);
  }
}
