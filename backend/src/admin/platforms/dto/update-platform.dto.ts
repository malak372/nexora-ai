import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for updating an existing platform.
 *
 * Used with:
 * PATCH /admin/platforms/:id
 *
 * All fields are optional to support partial updates.
 *
 * @author Malak
 */
export class UpdatePlatformDto {
  /**
   * Updated platform name.
   *
   * Must contain between 2 and 100 characters.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  /**
   * Updated active status.
   *
   * Indicates whether the platform is enabled for
   * comment collection and user idea generation.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
