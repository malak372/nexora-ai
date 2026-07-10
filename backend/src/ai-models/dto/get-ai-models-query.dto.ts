import { AiProviderType } from '@prisma/client';
import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO for listing AI models.
 *
 * Supports:
 * - Pagination
 * - Date filtering
 * - Search
 * - Sorting
 * - Provider filtering
 * - Active-state filtering
 * - Default-state filtering
 *
 * @author Malak
 */
export class GetAiModelsQueryDto extends ListQueryDto {
  /**
   * Optional provider filter.
   */
  @IsOptional()
  @IsEnum(AiProviderType)
  provider?: AiProviderType;

  /**
   * Optional active-state filter.
   *
   * Example:
   * true
   */
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  /**
   * Optional default-state filter.
   *
   * Example:
   * true
   */
  @IsOptional()
  @IsBooleanString()
  isDefault?: string;
}