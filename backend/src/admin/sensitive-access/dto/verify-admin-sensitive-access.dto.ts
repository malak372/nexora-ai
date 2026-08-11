import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export enum AdminSensitiveScope {
  ADMINISTRATORS = 'ADMINISTRATORS',
  SYSTEM_SETTINGS = 'SYSTEM_SETTINGS',
}

export class VerifyAdminSensitiveAccessDto {
  @IsEnum(AdminSensitiveScope)
  scope!: AdminSensitiveScope;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
