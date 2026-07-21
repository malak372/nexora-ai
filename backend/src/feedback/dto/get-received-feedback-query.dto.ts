import { IsEnum, IsOptional } from 'class-validator';
import { PublicationFeedbackStatus } from '@prisma/client';
import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/** Query used by a publisher to list feedback received on one publication.
 *
 * @author eman
 *
 **/
export class GetReceivedFeedbackQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(PublicationFeedbackStatus)
  status?: PublicationFeedbackStatus;
}
