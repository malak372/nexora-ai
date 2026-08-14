import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PreferenceCategory, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import type {
  PreferenceCatalogGroup,
  PreferenceCatalogOption,
} from './types/preference-catalog-response.type';

/**
 * Manages the authenticated user's personalization profile.
 *
 * Responsibilities:
 * - Return the active preference catalog grouped by category.
 * - Create and update onboarding preferences transactionally.
 * - Replace old selections during an explicit interests refresh.
 * - Reset selections and mark onboarding as incomplete.
 * - Preserve legacy JSON preference fields during migration.
 *
 * @author Malak
 */
@Injectable()
export class UserPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all active preference cards grouped by category.
   * Selected options are marked for the authenticated user.
   */
  async getCatalog(userId: string): Promise<PreferenceCatalogGroup[]> {
    const [options, selections] = await this.prisma.$transaction([
      this.prisma.preferenceOption.findMany({
        where: { isActive: true },
        orderBy: [
          { category: 'asc' },
          { displayOrder: 'asc' },
          { name: 'asc' },
        ],
      }),
      this.prisma.userPreferenceSelection.findMany({
        where: { userId },
        select: { preferenceOptionId: true },
      }),
    ]);

    const selectedIds = new Set(
      selections.map((selection) => selection.preferenceOptionId),
    );

    const grouped = new Map<PreferenceCategory, PreferenceCatalogOption[]>();

    for (const option of options) {
      const group = grouped.get(option.category) ?? [];
      group.push({
        id: option.id,
        key: option.key,
        name: option.name,
        description: option.description,
        category: option.category,
        imageUrl: option.imageUrl,
        iconKey: option.iconKey,
        displayOrder: option.displayOrder,
        selected: selectedIds.has(option.id),
      });
      grouped.set(option.category, group);
    }

    return Array.from(grouped.entries()).map(([category, groupedOptions]) => ({
      category,
      options: groupedOptions,
    }));
  }

  /**
   * Returns the authenticated user's onboarding status and selections.
   */
  async getMyPreferences(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        preference: true,
        preferenceSelections: {
          orderBy: { selectedAt: 'asc' },
          select: {
            selectedAt: true,
            preferenceOption: {
              select: {
                id: true,
                key: true,
                name: true,
                description: true,
                category: true,
                imageUrl: true,
                iconKey: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return {
      onboardingCompleted: user.preference?.onboardingCompleted ?? false,
      onboardingCompletedAt: user.preference?.onboardingCompletedAt ?? null,
      lastRefreshedAt: user.preference?.lastRefreshedAt ?? null,
      preferredCountry: user.preference?.preferredCountry ?? null,
      preferredCity: user.preference?.preferredCity ?? null,
      preferredRegion: user.preference?.preferredRegion ?? null,
      preferredLanguage: user.preference?.preferredLanguage ?? null,
      paymentCurrency: user.preference?.paymentCurrency ?? 'USD',
      selections: user.preferenceSelections.map((selection) => ({
        ...selection.preferenceOption,
        selectedAt: selection.selectedAt,
      })),
    };
  }

  /**
   * Completes first-time onboarding or replaces existing selections.
   */
  async completeOnboarding(userId: string, dto: UpdateUserPreferencesDto) {
    return this.savePreferences(userId, dto, true);
  }

  /**
   * Refreshes the user's interests and immediately replaces old selections.
   */
  async updatePreferences(userId: string, dto: UpdateUserPreferencesDto) {
    return this.savePreferences(userId, dto, false);
  }

  /**
   * Removes all selections and makes onboarding available again.
   */
  async resetPreferences(userId: string) {
    await this.ensureUserExists(userId);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.userPreferenceSelection.deleteMany({
        where: { userId },
      });

      await transaction.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          onboardingCompleted: false,
          onboardingCompletedAt: null,
          lastRefreshedAt: new Date(),
        },
        update: {
          onboardingCompleted: false,
          onboardingCompletedAt: null,
          lastRefreshedAt: new Date(),
        },
      });
    });

    return this.getMyPreferences(userId);
  }

  private async savePreferences(
    userId: string,
    dto: UpdateUserPreferencesDto,
    isOnboarding: boolean,
  ) {
    await this.ensureUserExists(userId);

    const optionIds = [...new Set(dto.preferenceOptionIds)];
    const options = await this.prisma.preferenceOption.findMany({
      where: { id: { in: optionIds }, isActive: true },
      select: { id: true, category: true, key: true },
    });

    if (options.length !== optionIds.length) {
      throw new BadRequestException(
        'One or more preference options are invalid or inactive.',
      );
    }

    const selectedCategories = new Set(
      options.map((option) => option.category),
    );
    if (selectedCategories.size < 2) {
      throw new BadRequestException(
        'Select preferences from at least two different categories.',
      );
    }

    const now = new Date();
    const legacyValues = this.buildLegacyPreferenceValues(options);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          preferredCountry: this.normalizeOptionalText(dto.preferredCountry),
          preferredCity: this.normalizeOptionalText(dto.preferredCity),
          preferredRegion: this.normalizeOptionalText(dto.preferredRegion),
          preferredLanguage: dto.preferredLanguage,
          paymentCurrency: dto.paymentCurrency ?? 'USD',
          preferredDomains: legacyValues.preferredDomains,
          preferredTechnologies: legacyValues.preferredTechnologies,
          preferredDataSources: legacyValues.preferredDataSources,
          onboardingCompleted: true,
          onboardingCompletedAt: now,
          lastRefreshedAt: now,
        },
        update: {
          ...(dto.preferredCountry !== undefined && {
            preferredCountry: this.normalizeOptionalText(dto.preferredCountry),
          }),
          ...(dto.preferredCity !== undefined && {
            preferredCity: this.normalizeOptionalText(dto.preferredCity),
          }),
          ...(dto.preferredRegion !== undefined && {
            preferredRegion: this.normalizeOptionalText(dto.preferredRegion),
          }),
          ...(dto.preferredLanguage !== undefined && {
            preferredLanguage: dto.preferredLanguage,
          }),
          ...(dto.paymentCurrency !== undefined && {
            paymentCurrency: dto.paymentCurrency,
          }),
          preferredDomains: legacyValues.preferredDomains,
          preferredTechnologies: legacyValues.preferredTechnologies,
          preferredDataSources: legacyValues.preferredDataSources,
          onboardingCompleted: true,
          onboardingCompletedAt: isOnboarding ? now : undefined,
          lastRefreshedAt: now,
        },
      });

      await transaction.userPreferenceSelection.deleteMany({
        where: { userId },
      });

      await transaction.userPreferenceSelection.createMany({
        data: optionIds.map((preferenceOptionId) => ({
          userId,
          preferenceOptionId,
        })),
        skipDuplicates: true,
      });
    });

    return this.getMyPreferences(userId);
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Active user was not found.');
    }
  }

  /**
   * Keeps the legacy JSON columns synchronized while older domain-resolution
   * and data-source-selection code is migrated to normalized selections.
   */
  private buildLegacyPreferenceValues(
    options: Array<{
      key: string;
      category: PreferenceCategory;
    }>,
  ): {
    preferredDomains: Prisma.InputJsonValue;
    preferredTechnologies: Prisma.InputJsonValue;
    preferredDataSources: Prisma.InputJsonValue;
  } {
    const keysFor = (category: PreferenceCategory) =>
      options
        .filter((option) => option.category === category)
        .map((option) => option.key);

    return {
      preferredDomains: keysFor(PreferenceCategory.DOMAIN),
      preferredTechnologies: keysFor(PreferenceCategory.TECHNOLOGY),
      preferredDataSources: keysFor(PreferenceCategory.DATA_SOURCE),
    };
  }

  private normalizeOptionalText(value?: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}