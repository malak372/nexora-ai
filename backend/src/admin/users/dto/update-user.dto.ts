import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AccountStatus, UserType } from '@prisma/client';

/**
 * Editable user fields exposed to administrators.
 *
 * Security decisions:
 * - Email is intentionally not editable here because changing it must continue
 *   to use the platform's verified email-change flow.
 * - Role is intentionally not editable to prevent accidental privilege escalation.
 * - Credit balance is intentionally not editable here; administrators must use
 *   the audited credit-adjustment endpoint so the credit ledger stays consistent.
 *
 * Used by:
 * PATCH /admin/users/:id
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  freeGenerationLimit?: number;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
