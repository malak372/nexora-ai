import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PublicationReportReason } from '@prisma/client';

/** Data supplied when a user reports a publication.
 *
 *  @author malak
 *
 **/
export class CreatePublicationReportDto {
  @IsEnum(PublicationReportReason)
  reason!: PublicationReportReason;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  details?: string;
}
