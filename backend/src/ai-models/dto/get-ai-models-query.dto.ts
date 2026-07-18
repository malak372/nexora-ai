import { AiModelHealthStatus } from '@prisma/client';

import { Transform } from 'class-transformer';

import {
  IsBoolean,
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
 * Converts a boolean query-string value into a real boolean.
 *
 * Unknown values remain unchanged so class-validator can reject them.
 */
const transformBooleanQuery = ({
  value,
}: {
  value: unknown;
}): unknown => {
  if (value === 'true' || value === true) {
    return true;
  }

  if (value === 'false' || value === false) {
    return false;
  }

  return value;
};

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
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : value,
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
  @Transform(transformBooleanQuery)
  @IsBoolean()
  isActive?: boolean;

  /**
   * Filters models by default-model state.
   *
   * Query-string examples:
   * - isDefault=true
   * - isDefault=false
   */
  @IsOptional()
  @Transform(transformBooleanQuery)
  @IsBoolean()
  isDefault?: boolean;
}