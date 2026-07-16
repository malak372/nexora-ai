import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used by an authenticated user to create a complaint.
 *
 * A complaint may optionally be linked to one active idea
 * owned by the authenticated user.
 *
 * Input strings are trimmed before validation and persistence.
 *
 * @author Eman
 */
export class CreateUserComplaintDto {
  /**
   * Complaint subject.
   *
   * Leading and trailing whitespace is removed before validation.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  /**
   * Detailed complaint message.
   *
   * Leading and trailing whitespace is removed before validation.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(2_000)
  message!: string;

  /**
   * Optional identifier of an active idea owned by the user.
   */
  @IsOptional()
  @IsUUID('4')
  ideaId?: string;
}
