import { IsString, MaxLength, MinLength } from 'class-validator';

/** Confirms an authenticated user's permanent account-deletion request. */
export class DeleteAccountDto {
    @IsString()
    @MinLength(6)
    @MaxLength(128)
    currentPassword!: string;
}