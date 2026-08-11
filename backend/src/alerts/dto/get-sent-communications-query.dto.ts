import { IsIn, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query parameters for administrator sent-communication history.
 *
 * @author Eman
 */
export class GetSentCommunicationsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(['IN_APP', 'EMAIL', 'BOTH'])
  channel?: 'IN_APP' | 'EMAIL' | 'BOTH';

  @IsOptional()
  @IsIn(['SELECTED', 'BROADCAST'])
  scope?: 'SELECTED' | 'BROADCAST';
}