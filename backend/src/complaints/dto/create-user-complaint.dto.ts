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
 * A complaint may optionally be linked to one of the user's ideas.
 *
 * @author Eman
 */
export class CreateUserComplaintDto {
  /**
   * Complaint subject.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  /**
   * Detailed complaint message.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(2_000)
  message!: string;

  /**
   * Optional related idea identifier.
   */
  @IsOptional()
  @IsUUID('4')
  ideaId?: string;
}
