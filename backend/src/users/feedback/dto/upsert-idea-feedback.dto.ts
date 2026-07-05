import {
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

/**
 * DTO used by authenticated users to create or update
 * feedback for one of their generated ideas.
 *
 * @author Eman
 */
export class UpsertIdeaFeedbackDto {
    @IsInt()
    @Min(1)
    @Max(5)
    rating!: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    comment?: string;
}