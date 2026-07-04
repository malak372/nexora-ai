import {
    IsArray,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';

/**
 * DTO used to update authenticated user preferences.
 *
 * These preferences help Nexora AI personalize future
 * project idea generation by considering the user's
 * preferred region, platforms, domains, technologies,
 * and language.
 *
 * @author Eman
 */
export class UpdateUserPreferencesDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    preferredCountry?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    preferredCity?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    preferredRegion?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    preferredLanguage?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredDomains?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredPlatforms?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredTechnologies?: string[];
}