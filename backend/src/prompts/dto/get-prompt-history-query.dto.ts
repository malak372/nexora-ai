import { PromptType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used to filter, search, sort, and paginate
 * prompt history records.
 *
 * Inherited properties:
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
   * Filters prompt history by prompt type.
   */
  @IsOptional()
  @IsEnum(PromptType)
  promptType?: PromptType;

  /**
   * Filters prompt history by the related idea identifier.
   */
  @IsOptional()
  @IsUUID('4')
  ideaId?: string;

  /**
   * Filters prompt history by the related collection job identifier.
   */
  @IsOptional()
  @IsUUID('4')
  collectionJobId?: string;

  /**
   * Filters prompt history by the exact SHA-256 hash
   * of the prompt template.
   */
  @IsOptional()
  @IsString()
  @Length(64, 64)
  templateHash?: string;
}
