import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { PublicMetadataService } from './public-metadata.service';

/**
 * Public read-only metadata endpoints used by unauthenticated pages.
 *
 * @author Eman
 */
@Controller('public-metadata')
export class PublicMetadataController {
    constructor(
        private readonly publicMetadataService: PublicMetadataService,
    ) { }

    /**
     * Returns languages stored in the PostgreSQL LanguageCode enum.
     *
     * Endpoint: GET /api/v1/public-metadata/languages
     */
    @Get('languages')
    @Throttle({ default: { limit: 30, ttl: 60_000 } })
    getLanguages() {
        return this.publicMetadataService.getLanguages();
    }
}