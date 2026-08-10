import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ModerationReportStatus } from '@prisma/client';

/**
 * Moderation action that can be executed while reviewing a publication report.
 *
 * Keeping the report decision and the publication action in one DTO allows the
 * backend to execute both atomically. This prevents situations where a report is
 * marked as resolved but the publication action fails (or the opposite).
 */
export enum PublicationReportModerationAction {
  NONE = 'NONE',
  WARN_PUBLISHER = 'WARN_PUBLISHER',
  HIDE_PUBLICATION = 'HIDE_PUBLICATION',
  ARCHIVE_PUBLICATION = 'ARCHIVE_PUBLICATION',
  RESTORE_PUBLICATION = 'RESTORE_PUBLICATION',
}

/** Admin decision on a publication report. */
export class ReviewPublicationReportDto {
  /** Final workflow state for the report. PENDING is rejected by the service. */
  @IsEnum(ModerationReportStatus)
  status!: ModerationReportStatus;

  /** Internal moderation note stored with the report and audit log. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;

  /** Optional action applied to the reported publication/publisher. */
  @IsOptional()
  @IsEnum(PublicationReportModerationAction)
  moderationAction: PublicationReportModerationAction =
    PublicationReportModerationAction.NONE;

  /** Optional custom notification sent to the publisher. */
  @ValidateIf(
    (dto: ReviewPublicationReportDto) =>
      dto.moderationAction === PublicationReportModerationAction.WARN_PUBLISHER ||
      dto.publisherMessage !== undefined,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  publisherMessage?: string;

  /** Whether to notify the user who submitted the report. */
  @IsOptional()
  @IsBoolean()
  notifyReporter?: boolean;

  /** Optional custom outcome message for the reporter. */
  @ValidateIf((dto: ReviewPublicationReportDto) => dto.notifyReporter === true && dto.reporterMessage !== undefined)
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reporterMessage?: string;
}