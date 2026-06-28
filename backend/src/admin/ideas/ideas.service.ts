import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetIdeasQueryDto } from './dto/get-ideas-query.dto';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for administrative idea management.
 *
 * This service allows administrators to retrieve, search,
 * filter, sort, paginate, and view generated software
 * project ideas.
 *
 * @author Malak
 */
@Injectable()
export class IdeasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves generated project ideas with optional filtering,
   * searching, sorting, and pagination.
   *
   * @param query Query parameters used for pagination,
   * searching, filtering, and sorting ideas.
   * @returns Paginated ideas list with metadata.
   */
  async getIdeas(query: GetIdeasQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const isUnlocked =
      query.isUnlocked !== undefined
        ? query.isUnlocked === 'true'
        : undefined;

    const where: Prisma.IdeaWhereInput = {
      ...buildDateFilter(query),

      ...buildSearchFilter(
        ['title', 'problemStatement'],
        query.search,
      ),

      ...buildExactFilter('domainId', query.domainId),
      ...buildExactFilter('selectedPlatformId', query.platformId),
      ...buildExactFilter('generationType', query.generationType),
      ...buildExactFilter('unlockMethod', query.unlockMethod),
      ...buildExactFilter('isUnlocked', isUnlocked),

      ...(query.region && {
        selectedRegion: {
          contains: query.region,
          mode: 'insensitive',
        },
      }),
    };

    const orderBy = buildOrderBy(
      query,
      [
        'title',
        'generationType',
        'isUnlocked',
        'unlockMethod',
        'commentsCount',
        'createdAt',
      ] as const,
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
          generationType: true,
          isUnlocked: true,
          unlockMethod: true,
          selectedRegion: true,
          commentsCount: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          domain: {
            select: {
              id: true,
              name: true,
            },
          },
          selectedPlatform: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.idea.count({ where }),
    ]);

    return {
      data: ideas,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves detailed information about a specific project idea.
   *
   * @param id Unique identifier of the project idea.
   * @returns Complete project idea information.
   *
   * @throws NotFoundException if the specified idea does not exist.
   */
  async getIdeaById(id: string) {
    const idea = await this.prisma.idea.findUnique({
      where: {
        id,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        domain: true,
        selectedPlatform: true,
        payments: true,
        creditTransactions: true,
        generatedOutputs: true,
        ideaComments: {
          include: {
            comment: true,
          },
        },
        chatSessions: {
          include: {
            messages: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException('Idea not found');
    }

    return idea;
  }
}