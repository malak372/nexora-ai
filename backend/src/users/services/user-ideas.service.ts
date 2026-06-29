import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetUserIdeasQueryDto } from '../dto/get-user-ideas-query.dto';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';
import { UserCommonService } from './user-common.service';

/**
 * Service responsible for user generated ideas operations.
 *
 * This service handles retrieving ideas generated
 * by the authenticated user.
 *
 * It supports pagination, filtering, searching,
 * and sorting for generated ideas.
 *
 * It uses UserCommonService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserIdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserCommonService,
  ) { }

  /**
   * Retrieves the authenticated user's generated ideas.
   *
   * Supports pagination, date filtering, searching,
   * filtering by idea properties, and sorting.
   *
   * @param userId - Authenticated user ID.
   * @param query - Query parameters for listing generated ideas.
   * @returns Paginated generated ideas with pagination metadata.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getGeneratedIdeas(userId: string, query: GetUserIdeasQueryDto) {
    await this.userCommonService.findUserOrThrow(userId);

    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.IdeaWhereInput = {
      userId,

      ...buildDateFilter(query),

      ...buildSearchFilter(
        ['title', 'partialAbstract', 'fullAbstract'],
        query.search,
      ),

      ...buildExactFilter('generationType', query.generationType),
      ...buildExactFilter('isUnlocked', query.isUnlocked),
      ...buildExactFilter('domainId', query.domainId),
      ...buildExactFilter('selectedPlatformId', query.selectedPlatformId),
    };

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'title', 'generationType'] as const,
      'createdAt',
    );

    const [ideas, total] = await Promise.all([
      this.prisma.idea.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          title: true,
          partialAbstract: true,
          fullAbstract: true,
          generationType: true,
          isUnlocked: true,
          unlockMethod: true,
          commentsCount: true,
          selectedRegion: true,
          createdAt: true,
          domain: true,
          selectedPlatform: true,
        },
      }),
      this.prisma.idea.count({ where }),
    ]);

    return {
      data: ideas,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}