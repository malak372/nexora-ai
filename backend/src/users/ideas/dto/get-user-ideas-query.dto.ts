import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsEnum,
    IsOptional,
    IsUUID,
} from 'class-validator';
import { IdeaGenerationType } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving the authenticated user's generated ideas.
 *
 * Extends the shared list query DTO to support:
 * - Pagination
 * - Date range filtering
 * - Search
 * - Sorting
 *
 * Additional filters:
 * - Generation type
 * - Unlock status
 * - Domain
 * - Selected platform
 *
 * @author Eman
 */
export class GetUserIdeasQueryDto extends ListQueryDto {
    /**
     * Optional idea generation type filter.
     */
    @IsOptional()
    @IsEnum(IdeaGenerationType)
    generationType?: IdeaGenerationType;

    /**
     * Optional unlock status filter.
     *
     * Accepts:
     * - true
     * - false
     */
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isUnlocked?: boolean;

    /**
     * Optional domain filter.
     */
    @IsOptional()
    @IsUUID()
    domainId?: string;

    /**
     * Optional selected platform filter.
     */
    @IsOptional()
    @IsUUID()
    selectedPlatformId?: string;
}