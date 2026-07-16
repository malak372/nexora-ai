import { Transform } from 'class-transformer';

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { MAX_FEEDBACK_COMMENT_LENGTH } from '../constants/feedback.constants';

/**
 * DTO used to create or update textual feedback
 * for a published idea.
 *
 * Each authenticated user may submit only one feedback
 * comment per publication.
 *
 * @author Eman
 */
export class UpsertPublicationFeedbackDto {
    /**
     * Textual publication feedback.
     */
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(MAX_FEEDBACK_COMMENT_LENGTH)
    comment!: string;
}