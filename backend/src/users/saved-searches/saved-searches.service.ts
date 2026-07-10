import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/validation.service';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { GetSavedSearchesQueryDto } from './dto/get-saved-searches-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for authenticated user saved generation searches.
 *
 * This service manages reusable idea generation criteria for Nexora AI users.
 * A saved search represents a previously selected generation context that may
 * include the software domain, geographical filters, language, target platforms,
 * and custom keywords.
 *
 * Purpose in Nexora AI:
 * - Allows users to save useful generation configurations.
 * - Allows users to reuse previous generation criteria without re-entering them.
 * - Supports the "Generate Again" workflow.
 * - Helps personalize future AI prompts and data collection requests.
 * - Improves user experience when working with repeated domains, regions,
 *   or supported social/community platforms.
 *
 * Supported operations:
 * - Create a saved generation search.
 * - Retrieve saved searches with filtering, searching, sorting, and pagination.
 * - Retrieve a single saved search by ID.
 * - Mark a saved search as used by updating lastUsedAt.
 * - Delete a saved search owned by the authenticated user.
 *
 * Security rules:
 * - Users can only create saved searches for their own account.
 * - Users can only view, update usage, or delete saved searches they own.
 * - Domain references are validated before saving.
 * - Only active domains can be linked to a newly saved search.
 * - Authentication is enforced at the controller level using JwtAuthGuard.
 *
 * Business rules:
 * - The geographical fields are optional because region-based collection
 *   is only applied when the user provides location filters.
 * - Platforms and keywords are stored as JSON arrays to support flexible
 *   platform selection and future expansion.
 * - lastUsedAt is updated when the user reuses a saved search for generation.
 *
 * @author Eman
 */
@Injectable()
export class UserSavedSearchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,
  ) {}

  /**
   * Creates a new saved generation search for the authenticated user.
   *
   * The saved search stores generation criteria such as:
   * - Domain.
   * - Country, city, or region.
   * - Preferred language.
   * - Selected platforms.
   * - Custom keywords.
   *
   * If a domain ID is provided, the domain must exist and be active.
   * This prevents users from saving generation contexts that reference
   * disabled or unavailable domains.
   *
   * @param userId - Authenticated user ID extracted from the JWT token.
   * @param dto - Saved search creation payload.
   * @returns The created saved generation search.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   * @throws NotFoundException if the provided domain does not exist or is inactive.
   */
  async createSavedSearch(userId: string, dto: CreateSavedSearchDto) {
    await this.userCommonService.findUserOrThrow(userId);

    if (dto.domainId) {
      const domain = await this.prisma.domain.findFirst({
        where: {
          id: dto.domainId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!domain) {
        throw new NotFoundException('Domain not found');
      }
    }

    return this.prisma.savedGenerationSearch.create({
      data: {
        userId,
        name: dto.name,
        domainId: dto.domainId,
        country: dto.country,
        city: dto.city,
        region: dto.region,
        language: dto.language,
        platforms: dto.platforms ?? [],
        keywords: dto.keywords ?? [],
      },
      select: this.savedSearchSelect,
    });
  }

  /**
   * Retrieves saved generation searches for the authenticated user.
   *
   * Supports:
   * - Pagination.
   * - Search by name, country, city, region, or language.
   * - Date range filtering.
   * - Filtering by domain.
   * - Sorting by allowed fields.
   *
   * The query is always scoped by userId to ensure that users cannot
   * access saved searches belonging to other accounts.
   *
   * @param userId - Authenticated user ID extracted from the JWT token.
   * @param query - Query parameters for filtering, searching, sorting, and pagination.
   * @returns Paginated saved search list with pagination metadata.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   */
  async getSavedSearches(userId: string, query: GetSavedSearchesQueryDto) {
    await this.userCommonService.findUserOrThrow(userId);

    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.SavedGenerationSearchWhereInput = {
      userId,
      ...buildDateFilter(query),
      ...buildSearchFilter(
        ['name', 'country', 'city', 'region', 'language'],
        query.search,
      ),
      ...buildExactFilter('domainId', query.domainId),
    };

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'updatedAt', 'lastUsedAt', 'name'] as const,
      'createdAt',
    );

    const [savedSearches, total] = await Promise.all([
      this.prisma.savedGenerationSearch.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: this.savedSearchSelect,
      }),
      this.prisma.savedGenerationSearch.count({ where }),
    ]);

    return {
      data: savedSearches,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves a single saved generation search owned by the authenticated user.
   *
   * This method is useful when the user wants to view a saved configuration
   * before reusing it for a new idea generation request.
   *
   * @param userId - Authenticated user ID extracted from the JWT token.
   * @param savedSearchId - Saved search ID.
   * @returns The requested saved search.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   * @throws NotFoundException if the saved search does not exist or does not belong to the user.
   */
  async getSavedSearchById(userId: string, savedSearchId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const savedSearch = await this.prisma.savedGenerationSearch.findFirst({
      where: {
        id: savedSearchId,
        userId,
      },
      select: this.savedSearchSelect,
    });

    if (!savedSearch) {
      throw new NotFoundException('Saved search not found');
    }

    return savedSearch;
  }

  /**
   * Marks a saved generation search as used.
   *
   * This method updates lastUsedAt when the user reuses a saved search,
   * for example through a "Generate Again" action in the frontend.
   *
   * @param userId - Authenticated user ID extracted from the JWT token.
   * @param savedSearchId - Saved search ID to mark as used.
   * @returns The updated saved search.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   * @throws NotFoundException if the saved search does not exist or does not belong to the user.
   */
  async markSavedSearchAsUsed(userId: string, savedSearchId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const savedSearch = await this.prisma.savedGenerationSearch.findFirst({
      where: {
        id: savedSearchId,
        userId,
      },
      select: { id: true },
    });

    if (!savedSearch) {
      throw new NotFoundException('Saved search not found');
    }

    return this.prisma.savedGenerationSearch.update({
      where: { id: savedSearchId },
      data: {
        lastUsedAt: new Date(),
      },
      select: this.savedSearchSelect,
    });
  }

  /**
   * Deletes a saved generation search owned by the authenticated user.
   *
   * Deleting a saved search removes only the reusable generation criteria.
   * It does not delete any generated ideas, collection jobs, NLP analysis,
   * payments, credits, or prompt history.
   *
   * @param userId - Authenticated user ID extracted from the JWT token.
   * @param savedSearchId - Saved search ID to delete.
   * @returns Success message.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   * @throws NotFoundException if the saved search does not exist or does not belong to the user.
   */
  async deleteSavedSearch(userId: string, savedSearchId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const savedSearch = await this.prisma.savedGenerationSearch.findFirst({
      where: {
        id: savedSearchId,
        userId,
      },
      select: { id: true },
    });

    if (!savedSearch) {
      throw new NotFoundException('Saved search not found');
    }

    await this.prisma.savedGenerationSearch.delete({
      where: { id: savedSearchId },
    });

    return {
      message: 'Saved search deleted successfully',
    };
  }

  /**
   * Shared Prisma selection for saved generation search responses.
   *
   * This keeps list, detail, create, and update responses consistent
   * while preventing unnecessary fields from being exposed.
   */
  private readonly savedSearchSelect = {
    id: true,
    name: true,
    domainId: true,
    country: true,
    city: true,
    region: true,
    language: true,
    platforms: true,
    keywords: true,
    lastUsedAt: true,
    createdAt: true,
    updatedAt: true,
    domain: {
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    },
  } satisfies Prisma.SavedGenerationSearchSelect;
}
