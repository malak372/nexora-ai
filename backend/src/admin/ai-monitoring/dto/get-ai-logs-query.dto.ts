import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProvider, ApiRequestType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating external AI API logs.
 *
 * This DTO is used with the GET /admin/ai/logs endpoint.
 * It represents the optional query parameters that an administrator
 * can use to retrieve external AI/API request logs.
 *
 * Supported features:
 * - Pagination.
 * - Filter by AI provider.
 * - Filter by API request type.
 * - Filter by request success status.
 *
 * All properties are optional, allowing the administrator to
 * retrieve all logs or apply one or more filters.
 *
 * Example:
 * GET /admin/ai/logs?page=1&limit=10&provider=OPENAI&requestType=IDEA_GENERATION&isSuccess=true
 *
 * @author Malak
 */
export class GetAiLogsQueryDto extends ListQueryDto {
  /**
   * Optional AI provider filter.
   *
   * Must be one of the values defined in the
   * ApiProvider enum.
   *
   * Example:
   * OPENAI
   */
  @IsOptional()
  @IsEnum(ApiProvider)
  provider?: ApiProvider;

  /**
   * Optional API request type filter.
   *
   * Must be one of the values defined in the
   * ApiRequestType enum.
   *
   * Example:
   * IDEA_GENERATION
   */
  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  /**
   * Optional request success status filter.
   *
   * Filters logs based on whether the external
   * API request completed successfully.
   *
   * Accepted values:
   * - "true"
   * - "false"
   */
  @IsOptional()
  @IsString()
  isSuccess?: string;
}