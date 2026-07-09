import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PromptType } from '@prisma/client';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering and paginating prompt history.
 *
 * Inherits common query fields from ListQueryDto:
 * - page
 * - limit
 * - search
 * - sortBy
 * - sortOrder
 * - fromDate
 * - toDate
 *
 * @author Malak
 */
export class GetPromptHistoryQueryDto extends ListQueryDto {
  /**
   * Filter by prompt type.
   */
  @IsOptional()
  @IsEnum(PromptType)
  promptType?: PromptType;

  /**
   * Filter by idea ID.
   */
  @IsOptional()
  @IsUUID()
  ideaId?: string;

  /**
   * Filter by collection job ID.
   */
  @IsOptional()
  @IsUUID()
  collectionJobId?: string;
}