import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';

/**
 * Data Transfer Object (DTO) used to validate
 * the refresh token provided by the client.
 *
 * The refresh token is automatically trimmed
 * before validation.
 *
 * @author Eman
 */
export class RefreshDto {
  /**
   * Refresh token issued during authentication.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  refreshToken!: string;
}