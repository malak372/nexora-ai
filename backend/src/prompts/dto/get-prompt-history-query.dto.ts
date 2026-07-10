import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PromptType } from '@prisma/client';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering and paginating prompt history.
 *
 * Inherits:
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
  @IsOptional()
  @IsEnum(PromptType)
  promptType?: PromptType;

  @IsOptional()
  @IsUUID()
  ideaId?: string;

  @IsOptional()
  @IsUUID()
  collectionJobId?: string;

  @IsOptional()
  @IsString()
  templateHash?: string;
}