import { LanguageCode } from '@prisma/client';
import {
    IsArray,
    IsEnum,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';

/**
 * DTO used to create a reusable saved generation search.
 *
 * @author Eman
 */
export class CreateSavedSearchDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @IsUUID()
    domainId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    country?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    city?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    region?: string;

    /**
     * Optional preferred language.
     *
     * Must match one of the supported LanguageCode enum values
     * defined in Prisma.
     */
    @IsOptional()
    @IsEnum(LanguageCode)
    language?: LanguageCode;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    platforms?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    keywords?: string[];
}