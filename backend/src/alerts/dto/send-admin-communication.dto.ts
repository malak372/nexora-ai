import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Administrator communication payload.
 *
 * The caller must choose exactly one recipient mode:
 * - userIds: one or more selected users.
 * - broadcast: every active registered user.
 *
 * At least one delivery channel must be enabled.
 *
 * @author Eman
 */
export class SendAdminCommunicationDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @IsOptional()
  @IsBoolean()
  broadcast?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  message!: string;

  @IsBoolean()
  sendInApp!: boolean;

  @IsBoolean()
  sendEmail!: boolean;
}