import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CollectionSourceType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { GenerateIdeaDto } from '../dto/generate-idea.dto';

/**
 * Validated domain and platform selection.
 */
export type ValidatedIdeaGenerationSelection = {
  /**
   * Effective collection platforms.
   *
   * Contains either:
   * - The explicitly requested active platforms.
   * - All active supported platforms when none were requested.
   */
  readonly platforms: CollectionSourceType[];
};

/**
 * Validates and resolves idea-generation domain and platform choices.
 *
 * Rules:
 * - Domain must exist and be active.
 * - Explicit platforms must be active.
 * - Explicit platforms must map to supported CollectionSourceType values.
 * - Missing platforms resolve to all active supported platform rows.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationSelectionService {
  constructor(private readonly prisma: PrismaService) {}

  async validateAndResolve(
    dto: GenerateIdeaDto,
  ): Promise<ValidatedIdeaGenerationSelection> {
    const domain = await this.prisma.domain.findFirst({
      where: {
        id: dto.domainId,
        isActive: true,
      },

      select: {
        id: true,
      },
    });

    if (!domain) {
      throw new NotFoundException(
        'The selected domain does not exist or is inactive.',
      );
    }

    const activePlatformRows = await this.prisma.platform.findMany({
      where: {
        isActive: true,
      },

      select: {
        name: true,
      },

      orderBy: {
        name: 'asc',
      },
    });

    const activeSourceTypes = activePlatformRows
      .map((platform) => this.toCollectionSourceType(platform.name))
      .filter((value): value is CollectionSourceType => value !== undefined);

    const uniqueActiveSourceTypes = [...new Set(activeSourceTypes)];

    if (!dto.platforms?.length) {
      if (uniqueActiveSourceTypes.length === 0) {
        throw new BadRequestException(
          'No active supported collection platforms are available.',
        );
      }

      return {
        platforms: uniqueActiveSourceTypes,
      };
    }

    const requestedPlatforms = [...new Set(dto.platforms)];

    const activePlatformSet = new Set(uniqueActiveSourceTypes);

    const unavailablePlatforms = requestedPlatforms.filter(
      (platform) => !activePlatformSet.has(platform),
    );

    if (unavailablePlatforms.length > 0) {
      throw new BadRequestException({
        code: 'INACTIVE_OR_UNSUPPORTED_PLATFORMS',

        message: 'One or more selected platforms are inactive or unsupported.',

        platforms: unavailablePlatforms,
      });
    }

    return {
      platforms: requestedPlatforms,
    };
  }

  /**
   * Converts a persisted Platform name to CollectionSourceType.
   *
   * Normalization supports names such as:
   * - Stack Overflow
   * - Google Play
   * - App Store
   */
  private toCollectionSourceType(
    platformName: string,
  ): CollectionSourceType | undefined {
    const normalizedName = platformName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const aliases: Readonly<Record<string, CollectionSourceType>> = {
      STACK_OVERFLOW: CollectionSourceType.STACKOVERFLOW,

      STACKOVERFLOW: CollectionSourceType.STACKOVERFLOW,

      GOOGLEPLAY: CollectionSourceType.GOOGLE_PLAY,

      GOOGLE_PLAY: CollectionSourceType.GOOGLE_PLAY,

      APPSTORE: CollectionSourceType.APP_STORE,

      APP_STORE: CollectionSourceType.APP_STORE,
    };

    const alias = aliases[normalizedName];

    if (alias) {
      return alias;
    }

    const enumValues = Object.values(CollectionSourceType);

    return enumValues.find((value) => value === normalizedName);
  }
}
