import { IsString, MaxLength, MinLength } from 'class-validator';

/** Reason recorded when an admin hides or archives a publication.
 *
 * @author malak
 *
 * */
export class AdminPublicationModerationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
