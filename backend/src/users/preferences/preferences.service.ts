import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/validation.service';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { userCacheKeys } from '../cache/user-cache.keys';

/**
 * Service responsible for authenticated user preference operations.
 *
 * User preferences are used by Nexora AI to personalize future
 * idea generation requests. These preferences can guide the system
 * when building AI prompts, selecting data collection context, and
 * improving project recommendation relevance.
 *
 * Preferences may include:
 * - Preferred country, city, or region.
 * - Preferred language.
 * - Preferred software domains.
 * - Preferred data platforms.
 * - Preferred technologies.
 *
 * Security rules:
 * - Users can only view and update their own preferences.
 * - Authentication is enforced at the controller level using JwtAuthGuard.
 *
 * Cache behavior:
 * - Preferences are cached because they may be requested frequently
 *   by dashboard or generation-related screens.
 * - Updating preferences invalidates the cached preferences response.
 *
 * @author Eman
 */
@Injectable()
export class UserPreferencesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,

        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) { }

    /**
     * Retrieves the authenticated user's preferences.
     *
     * If the user has not created preferences yet, this method
     * returns null values instead of creating a database record.
     */
    async getPreferences(userId: string) {
        const cacheKey = userCacheKeys.preferences(userId);
        const cachedPreferences = await this.cacheManager.get(cacheKey);

        if (cachedPreferences) {
            return cachedPreferences;
        }

        await this.userCommonService.findUserOrThrow(userId);

        const preferences = await this.prisma.userPreference.findUnique({
            where: { userId },
            select: {
                id: true,
                preferredCountry: true,
                preferredCity: true,
                preferredRegion: true,
                preferredLanguage: true,
                preferredDomains: true,
                preferredPlatforms: true,
                preferredTechnologies: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const response = preferences ?? {
            preferredCountry: null,
            preferredCity: null,
            preferredRegion: null,
            preferredLanguage: null,
            preferredDomains: [],
            preferredPlatforms: [],
            preferredTechnologies: [],
        };

        await this.cacheManager.set(cacheKey, response);

        return response;
    }

    /**
     * Creates or updates the authenticated user's preferences.
     *
     * Uses upsert because each user has one preferences record only.
     */
    async updatePreferences(userId: string, dto: UpdateUserPreferencesDto) {
        await this.userCommonService.findUserOrThrow(userId);

        const preferences = await this.prisma.userPreference.upsert({
            where: { userId },
            update: {
                preferredCountry: dto.preferredCountry,
                preferredCity: dto.preferredCity,
                preferredRegion: dto.preferredRegion,
                preferredLanguage: dto.preferredLanguage,
                preferredDomains: dto.preferredDomains ?? undefined,
                preferredPlatforms: dto.preferredPlatforms ?? undefined,
                preferredTechnologies: dto.preferredTechnologies ?? undefined,
            },
            create: {
                userId,
                preferredCountry: dto.preferredCountry,
                preferredCity: dto.preferredCity,
                preferredRegion: dto.preferredRegion,
                preferredLanguage: dto.preferredLanguage,
                preferredDomains: dto.preferredDomains ?? [],
                preferredPlatforms: dto.preferredPlatforms ?? [],
                preferredTechnologies: dto.preferredTechnologies ?? [],
            },
            select: {
                id: true,
                preferredCountry: true,
                preferredCity: true,
                preferredRegion: true,
                preferredLanguage: true,
                preferredDomains: true,
                preferredPlatforms: true,
                preferredTechnologies: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        await this.cacheManager.del(userCacheKeys.preferences(userId));

        return preferences;
    }
}