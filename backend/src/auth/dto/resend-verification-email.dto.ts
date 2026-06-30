import { IsEmail } from 'class-validator';

/**
 * DTO used to resend an email verification link.
 *
 * @author Eman
 */
export class ResendVerificationEmailDto {
    @IsEmail()
    email!: string;
}