import { AiModelHealthStatus, AiProviderType } from '@prisma/client';
import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO for listing and filtering AI models.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Date filtering.
 * - Sorting.
 * - Provider filtering.
 * - Health-status filtering.
 * - Active-state filtering.
 * - Default-state filtering.
 *
 * @author Malak
 */
export class GetAiModelsQueryDto extends ListQueryDto {
  /**
   * Optional provider filter.
   *
   * Examples:
   * - OPENAI
   * - ANTHROPIC
   * - GOOGLE
   */
  @IsOptional()
  @IsEnum(AiProviderType)
  provider?: AiProviderType;

  /**
   * Optional model-health filter.
   *
   * Examples:
   * - UNKNOWN
   * - HEALTHY
   * - DEGRADED
   * - UNAVAILABLE
   */
  @IsOptional()
  @IsEnum(AiModelHealthStatus)
  healthStatus?: AiModelHealthStatus;

  /**
   * Optional active-state filter.
   *
   * Query examples:
   * - true
   * - false
   */
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  /**
   * Optional default-state filter.
   *
   * Query examples:
   * - true
   * - false
   */
  @IsOptional()
  @IsBooleanString()
  isDefault?: string;
}
