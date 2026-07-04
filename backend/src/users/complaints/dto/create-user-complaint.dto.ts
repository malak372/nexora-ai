import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * DTO for creating a complaint by the authenticated user.
 *
 * Users can submit complaints related to:
 * - General platform issues.
 * - Payment or credit issues.
 * - A specific generated idea.
 *
 * @author Eman
 */
export class CreateUserComplaintDto {
    /**
     * Complaint subject.
     */
    @IsString()
    @MinLength(3)
    @MaxLength(150)
    subject!: string;

    /**
     * Detailed complaint message.
     */
    @IsString()
    @MinLength(10)
    @MaxLength(2000)
    message!: string;

    /**
     * Optional related idea ID.
     */
    @IsOptional()
    @IsUUID()
    ideaId?: string;
}