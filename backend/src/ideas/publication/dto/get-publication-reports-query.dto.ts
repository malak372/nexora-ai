import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  ModerationReportStatus,
  PublicationReportReason,
} from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/** Admin filters for publication reports.
 *
 * @author malak
 *
 **/
export class GetPublicationReportsQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(ModerationReportStatus) status?: ModerationReportStatus;
  @IsOptional()
  @IsEnum(PublicationReportReason)
  reason?: PublicationReportReason;
  @IsOptional() @IsUUID('4') reporterId?: string;
  @IsOptional() @IsUUID('4') publicationId?: string;
}
