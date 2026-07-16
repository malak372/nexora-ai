import { AiModelHealthStatus } from '@prisma/client';

import { Transform } from 'class-transformer';

import {
  IsBooleanString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

import {
  SUPPORTED_AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../../ai/constants/ai-provider.constants';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used for administrator AI-model listing and filtering.
 *
 * Pagination, search, date-range filtering, and sorting are inherited
 * from ListQueryDto.
 *
 * @author Malak
 */
export class GetAiModelsQueryDto extends ListQueryDto {
  /**
   * Filters models by backend provider-registry key.
   *
   * Input is normalized to lowercase before validation.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsIn(SUPPORTED_AI_PROVIDER_KEYS)
  providerKey?: AiProviderKey;

  /**
   * Filters models by operational health status.
   */
  @IsOptional()
  @IsEnum(AiModelHealthStatus)
  healthStatus?: AiModelHealthStatus;

  /**
   * Filters models by active state.
   *
   * Query-string examples:
   * - isActive=true
   * - isActive=false
   */
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  /**
   * Filters models by default-model state.
   *
   * Query-string examples:
   * - isDefault=true
   * - isDefault=false
   */
  @IsOptional()
  @IsBooleanString()
  isDefault?: string;
}
