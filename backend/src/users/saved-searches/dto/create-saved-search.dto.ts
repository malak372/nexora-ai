import {
    IsArray,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';

/**
 * DTO used to create a reusable saved generation search.
 *
 * Saved searches allow authenticated users to store idea generation
 * criteria for future reuse without re-entering the same information.
 *
 * @author Eman
 */
export class CreateSavedSearchDto {
    /**
     * Optional display name for the saved search.
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    name?: string;

    /**
     * Optional software domain.
     */
    @IsOptional()
    @IsUUID()
    domainId?: string;

    /**
     * Optional target country.
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    country?: string;

    /**
     * Optional target city.
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    city?: string;

    /**
     * Optional target region.
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    region?: string;

    /**
     * Optional preferred language.
     */
    @IsOptional()
    @IsString()
    @MaxLength(50)
    language?: string;

    /**
     * Selected data collection platforms.
     *
     * Example:
     * - Reddit
     * - GitHub
     * - YouTube
     */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    platforms?: string[];

    /**
     * Optional keywords that help refine idea generation.
     */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    keywords?: string[];
}