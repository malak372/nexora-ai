import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ModerationReportStatus } from '@prisma/client';

/** Admin decision on a publication report.
 *
 * @author malak
 *
 **/
export class ReviewPublicationReportDto {
  @IsEnum(ModerationReportStatus)
  status!: ModerationReportStatus;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  adminNote?: string;
}
