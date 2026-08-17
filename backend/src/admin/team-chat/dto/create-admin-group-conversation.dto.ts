import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
} from 'class-validator';

/**
 * Data transfer object used to create a new administrator
 * group conversation.
 *
 * The group must contain:
 * - A title between 2 and 80 characters.
 * - Between 2 and 20 administrator member IDs.
 * - Valid UUID v4 values for all member IDs.
 *
 * @author Eman
 */
export class CreateAdminGroupConversationDto {
    /**
     * The display title of the administrator group conversation.
     *
     * Must contain between 2 and 80 characters.
     */
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    title!: string;

    /**
     * The administrator IDs that will participate
     * in the group conversation.
     *
     * The array must contain between 2 and 20 members,
     * and every member ID must be a valid UUID v4.
     */
    @IsArray()
    @ArrayMinSize(2)
    @ArrayMaxSize(20)
    @IsUUID('4', { each: true })
    memberIds!: string[];
}