import {
  IsBooleanString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IdeaGenerationType, UnlockMethod } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating generated ideas.
 *
 * Used with:
 * GET /admin/ideas
 * GET /admin/ideas/summary
 * GET /admin/ideas/charts
 *
 * Supports:
 * - Pagination through page and limit.
 * - Sorting through sortBy and sortOrder.
 * - Date filtering through fromDate and toDate.
 * - Search by idea title and problem statement.
 * - Filter by domain.
 * - Filter by selected platform.
 * - Filter by selected region.
 * - Filter by idea generation type.
 * - Filter by unlock method.
 * - Filter by unlock status.
 *
 * Example:
 * GET /admin/ideas?page=1&limit=10&search=health&generationType=PREMIUM_CREDIT&isUnlocked=true
 *
 * @author Malak
 */
export class GetIdeasQueryDto extends ListQueryDto {
  /**
   * Optional domain identifier.
   *
   * Filters ideas that belong to a specific software domain.
   *
   * Must be a valid UUID.
   *
   * Example:
   * ?domainId=8a4d4fd1-8d2e-4f89-a7c6-2c28a6e4e6a1
   */
  @IsOptional()
  @IsUUID()
  domainId?: string;

  /**
   * Optional selected platform identifier.
   *
   * Filters ideas generated using comments collected
   * from a specific supported platform.
   *
   * Must be a valid UUID.
   *
   * Example:
   * ?platformId=92d64c18-9fa7-42ec-b39d-02d9cfb3de47
   */
  @IsOptional()
  @IsUUID()
  platformId?: string;

  /**
   * Optional selected region filter.
   *
   * Filters ideas based on the region selected during
   * idea generation.
   *
   * The service applies this filter as a case-insensitive
   * string search.
   *
   * Example:
   * ?region=Palestine
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  /**
   * Optional idea generation type filter.
   *
   * Must be one of the values defined in IdeaGenerationType enum.
   *
   * Examples:
   * - GUEST_FREE
   * - NORMAL_FREE
   * - PREMIUM_CREDIT
   */
  @IsOptional()
  @IsEnum(IdeaGenerationType)
  generationType?: IdeaGenerationType;

  /**
   * Optional unlock method filter.
   *
   * Must be one of the values defined in UnlockMethod enum.
   *
   * Examples:
   * - NONE
   * - DIRECT_PAYMENT
   * - CREDIT_GENERATION
   */
  @IsOptional()
  @IsEnum(UnlockMethod)
  unlockMethod?: UnlockMethod;

  /**
   * Optional unlock status filter.
   *
   * Accepted values:
   * - "true"
   * - "false"
   *
   * The value is received as a query string and converted
   * inside the service into a boolean.
   *
   * Example:
   * ?isUnlocked=true
   */
  @IsOptional()
  @IsBooleanString()
  isUnlocked?: string;
}