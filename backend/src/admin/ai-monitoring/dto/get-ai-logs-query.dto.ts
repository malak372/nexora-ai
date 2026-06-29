import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiProvider, ApiRequestType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating external AI API logs.
 *
 * Used in:
 * GET /admin/ai/logs
 *
 * Supports:
 * - Pagination (page, limit)
 * - Sorting (sortBy, sortOrder)
 * - Date filtering (fromDate, toDate)
 * - Provider filtering (OPENAI, etc.)
 * - Request type filtering
 * - Boolean filtering (isSuccess)
 *
 * This DTO ensures that query parameters are automatically
 * validated and transformed before reaching the service layer.
 *
 * @author Malak
 */
export class GetAiLogsQueryDto extends ListQueryDto {
  /**
   * AI provider filter.
   *
   * Example: OPENAI, REDDIT, etc.
   */
  @IsOptional()
  @IsEnum(ApiProvider)
  provider?: ApiProvider;

  /**
   * API request type filter.
   *
   * Example: IDEA_GENERATION, COMMENT_ANALYSIS, AI_CHAT, etc.
   */
  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  /**
   * Success status filter for API requests.
   *
   * Accepts:
   * ?isSuccess=true
   * ?isSuccess=false
   *
   * Automatically transforms the query value
   * into a boolean before validation.
   *
   * Query example:
   * ?isSuccess=true → true
   * ?isSuccess=false → false
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();

      if (normalized === 'true') {
        return true;
      }

      if (normalized === 'false') {
        return false;
      }
    }

    return value;
  })
  @IsBoolean()
  isSuccess?: boolean;
}