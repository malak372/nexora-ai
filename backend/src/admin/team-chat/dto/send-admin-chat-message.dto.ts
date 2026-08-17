import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Data transfer object used to send a message
 * within an administrator team-chat conversation.
 *
 * The message content must:
 * - Be a string.
 * - Contain at least 1 character.
 * - Not exceed 3000 characters.
 *
 * @author Eman
 */
export class SendAdminChatMessageDto {
    /**
     * The textual content of the administrator's message.
     *
     * Must contain between 1 and 3000 characters.
     */
    @IsString()
    @MinLength(1)
    @MaxLength(3000)
    content!: string;
}