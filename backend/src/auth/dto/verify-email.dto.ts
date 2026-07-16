import { Transform } from 'class-transformer';

import {
    IsEmail,
    IsNotEmpty,
    IsString,
} from 'class-validator';

/**
 * DTO used to validate an email-verification request.
 *
 * The email is normalized before validation, while the
 * verification token is trimmed and required to be non-empty.
 *
 * @author Eman
 */
export class VerifyEmailDto {
    /**
     * User email address.
     */
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : value,
    )
    @IsString()
    @IsEmail()
    email!: string;

    /**
     * Email-verification token received by email.
     */
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string'
            ? value.trim()
            : value,
    )
    @IsString()
    @IsNotEmpty()
    token!: string;
}