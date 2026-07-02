import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiProvider, ApiRequestType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating external API logs.
 *
 * Used in:
 * - GET /admin/ai-monitoring/logs
 * - GET /admin/ai-monitoring/summary
 * - GET /admin/ai-monitoring/charts
 * - GET /admin/ai-monitoring/logs/export/csv
 *
 * Supports:
 * - Pagination
 * - Sorting
 * - Date filtering
 * - Search
 * - Provider filtering
 * - Request type filtering
 * - Success status filtering
 *
 * @author Malak
 */
export class GetAiLogsQueryDto extends ListQueryDto {
  /**
   * External API provider filter.
   *
   * Examples:
   * OPENAI, REDDIT, FACEBOOK, PAYPAL, PALPAY
   */
  @IsOptional()
  @IsEnum(ApiProvider)
  provider?: ApiProvider;

  /**
   * External API request type filter.
   *
   * Examples:
   * IDEA_GENERATION, COMMENT_ANALYSIS, AI_CHAT, PAYMENT
   */
  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  /**
   * Success status filter.
   *
   * Query examples:
   * ?isSuccess=true
   * ?isSuccess=false
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();

      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }

    return value;
  })
  @IsBoolean()
  isSuccess?: boolean;
}