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
   * Example: OPENAI, GEMINI, etc.
   */
  @IsOptional()
  @IsEnum(ApiProvider)
  provider?: ApiProvider;

  /**
   * API request type filter.
   *
   * Example: IDEA_GENERATION, ANALYSIS, etc.
   */
  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  /**
   * Success status filter for API requests.
   *
   * Before: string ("true" | "false")
   * After: boolean (true | false)
   *
   * Query example:
   * ?isSuccess=true → true
   * ?isSuccess=false → false
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }) @IsBoolean()
  isSuccess?: boolean;
}