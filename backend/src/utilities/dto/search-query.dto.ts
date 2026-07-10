import { IsOptional, IsString } from 'class-validator';

/**
 * DTO for search query parameters.
 *
 * Provides an optional search keyword that can be
 * reused across list endpoints.
 *
 * @author Malak
 */
export class SearchQueryDto {
  /**
   * Optional search keyword.
   *
   * The searchable fields depend on the endpoint
   * that uses this DTO.
   *
   * Example:
   * openai
   */
  @IsOptional()
  @IsString()
  search?: string;
}
