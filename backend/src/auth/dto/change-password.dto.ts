import { IsString, Matches, MinLength } from 'class-validator';

/**
 * DTO used for changing the authenticated user's password.
 *
 * @author Eman
 */
export class ChangePasswordDto {
    @IsString()
    currentPassword!: string;

    @IsString()
    @MinLength(6)
    @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
        message: 'New password must contain at least one letter and one number',
    })
    newPassword!: string;
}