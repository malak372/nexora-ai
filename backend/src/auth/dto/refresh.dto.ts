import { Transform } from 'class-transformer';

import {
  IsString,
  IsNotEmpty,
} from 'class-validator';

/**
 * DTO used to validate a refresh token
 * received from the client.
 *
 * The refresh token is normalized by
 * trimming surrounding whitespace before validation.
 *
 * @author Eman
 */
export class RefreshDto {
  /**
   * Refresh token issued during authentication.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim()
      : value,
  )
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}