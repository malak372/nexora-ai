import { IsString } from 'class-validator';

/**
 * Data Transfer Object (DTO) used to validate
 * the refresh token sent by the client.
 *
 * This DTO is used when requesting a new access token
 * using a valid refresh token.
 *
 * @author Eman
 */
export class RefreshDto {
  @IsString()
  refreshToken!: string;
}