import { Injectable, NotFoundException } from '@nestjs/common';

import {
  IdeaPublicationStatus,
  IdeaPublicationVisibility,
  Prisma,
  UserType,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { GetPublicationsQueryDto } from '../dto/get-publications-query.dto';

/**
 * Provides read-only queries for idea publications.
 *
 * This service is responsible for:
 * - Retrieving publicly visible publications.
 * - Retrieving publications discoverable by authenticated users.
 * - Retrieving publications owned by a specific publisher.
 * - Enforcing publication visibility and audience-access rules.
 * - Applying pagination, search, filtering, and sorting.
 *
 * The service exposes only the publication snapshot fields and does not return
 * protected premium idea outputs or internal AI-generation data.
 *
 * @author Malak
 */
@Injectable()
export class IdeaPublicationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves publications available to unauthenticated users.
   *
   * Only publications that are both published and publicly visible
   * are returned.
   *
   * @param query Publication list query options.
   * @returns Paginated public publications.
   */
  async findPublic(query: GetPublicationsQueryDto) {
    return this.findMany(
      {
        status: IdeaPublicationStatus.PUBLISHED,
        visibility: IdeaPublicationVisibility.PUBLIC,
      },
      query,
    );
  }

  /**
   * Retrieves publications discoverable by an authenticated user.
   *
   * A publication is discoverable when it is:
   * - Public.
   * - Visible to all registered users.
   * - Shared directly with the current user.
   * - Shared with the current user's account type.
   *
   * Draft and archived publications are excluded.
   *
   * @param userId Authenticated user identifier.
   * @param userType Authenticated user's account type, when available.
   * @param query Publication list query options.
   * @returns Paginated publications accessible to the user.
   */
  async findDiscoverable(
    userId: string,
    userType: UserType | null,
    query: GetPublicationsQueryDto,
  ) {
    return this.findMany(
      {
        status: IdeaPublicationStatus.PUBLISHED,
        OR: [
          {
            visibility: IdeaPublicationVisibility.PUBLIC,
          },
          {
            visibility: IdeaPublicationVisibility.REGISTERED_USERS,
          },
          {
            visibility: IdeaPublicationVisibility.SELECTED_AUDIENCE,
            audiences: {
              some: {
                OR: [
                  {
                    audienceType: 'specific-user',
                    audienceValue: userId,
                  },
                  ...(userType
                    ? [
                        {
                          audienceType: 'user-type',
                          audienceValue: userType,
                        },
                      ]
                    : []),
                ],
              },
            },
          },
        ],
      },
      query,
    );
  }

  /**
   * Retrieves publications created by a specific user.
   *
   * Unlike public discovery queries, this method may return publications
   * in any status or visibility state owned by the publisher.
   *
   * Optional status and visibility filters are applied when provided.
   *
   * @param userId Publisher identifier.
   * @param query Publication list query options.
   * @returns Paginated publications owned by the user.
   */
  async findMine(userId: string, query: GetPublicationsQueryDto) {
    return this.findMany(
      {
        publisherId: userId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.visibility ? { visibility: query.visibility } : {}),
      },
      query,
    );
  }

  /**
   * Retrieves one publicly accessible publication by identifier.
   *
   * The publication must be published and publicly visible.
   *
   * @param publicationId Publication identifier.
   * @returns Public publication details.
   * @throws NotFoundException When no matching publication exists.
   */
  async findPublicById(publicationId: string) {
    return this.findOneOrThrow({
      id: publicationId,
      status: IdeaPublicationStatus.PUBLISHED,
      visibility: IdeaPublicationVisibility.PUBLIC,
    });
  }

  /**
   * Retrieves one publication accessible to an authenticated user.
   *
   * Access is granted when:
   * - The user owns the publication.
   * - The publication is published and public.
   * - The publication is published and visible to registered users.
   * - The publication is published and explicitly shared with the user.
   * - The publication is published and shared with the user's account type.
   *
   * Publication owners can access their own drafts and archived publications.
   *
   * @param publicationId Publication identifier.
   * @param userId Authenticated user identifier.
   * @param userType Authenticated user's account type, when available.
   * @returns Accessible publication details.
   * @throws NotFoundException When the publication does not exist or is inaccessible.
   */
  async findAccessibleById(
    publicationId: string,
    userId: string,
    userType: UserType | null,
  ) {
    return this.findOneOrThrow({
      id: publicationId,
      OR: [
        {
          publisherId: userId,
        },
        {
          status: IdeaPublicationStatus.PUBLISHED,
          visibility: {
            in: [
              IdeaPublicationVisibility.PUBLIC,
              IdeaPublicationVisibility.REGISTERED_USERS,
            ],
          },
        },
        {
          status: IdeaPublicationStatus.PUBLISHED,
          visibility: IdeaPublicationVisibility.SELECTED_AUDIENCE,
          audiences: {
            some: {
              OR: [
                {
                  audienceType: 'specific-user',
                  audienceValue: userId,
                },
                ...(userType
                  ? [
                      {
                        audienceType: 'user-type',
                        audienceValue: userType,
                      },
                    ]
                  : []),
              ],
            },
          },
        },
      ],
    });
  }

  /**
   * Executes a paginated publication query.
   *
   * Applies:
   * - Base access conditions.
   * - Full-text-like search across safe public fields.
   * - Creation-date filtering.
   * - Safe sorting through an allowlist.
   * - Pagination metadata.
   *
   * @param where Base Prisma publication conditions.
   * @param query Publication list query options.
   * @returns Paginated publication results.
   */
  private async findMany(
    where: Prisma.IdeaPublicationWhereInput,
    query: GetPublicationsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();

    /**
     * Combines access conditions with optional search and date filters.
     */
    const effectiveWhere: Prisma.IdeaPublicationWhereInput = {
      AND: [
        where,
        search
          ? {
              OR: [
                {
                  publicTitle: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  publicAbstract: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  publicProblem: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {},
        query.fromDate || query.toDate
          ? {
              createdAt: {
                ...(query.fromDate
                  ? { gte: new Date(query.fromDate) }
                  : {}),
                ...(query.toDate
                  ? { lte: new Date(query.toDate) }
                  : {}),
              },
            }
          : {},
      ],
    };

    /**
     * Prevents clients from sorting by unsupported or sensitive fields.
     */
    const allowedSorts = new Set([
      'createdAt',
      'publishedAt',
      'averageRating',
      'upvotesCount',
      'feedbackCount',
    ]);

    const sortBy = allowedSorts.has(query.sortBy ?? '')
      ? query.sortBy!
      : 'publishedAt';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ideaPublication.findMany({
        where: effectiveWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: {
          [sortBy]: query.sortOrder ?? 'desc',
        },
        select: this.publicationSelect,
      }),
      this.prisma.ideaPublication.count({
        where: effectiveWhere,
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves one publication matching the supplied access conditions.
   *
   * Using a shared method keeps single-publication access rules consistent
   * across public and authenticated endpoints.
   *
   * @param where Prisma publication conditions.
   * @returns Publication details.
   * @throws NotFoundException When no matching publication is found.
   */
  private async findOneOrThrow(
    where: Prisma.IdeaPublicationWhereInput,
  ) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where,
      select: this.publicationSelect,
    });

    if (!publication) {
      throw new NotFoundException('Publication not found');
    }

    return publication;
  }

  /**
   * Safe publication projection returned by this query service.
   *
   * This selection intentionally exposes only the publication snapshot,
   * engagement counters, publication configuration, and limited publisher
   * information.
   *
   * Protected idea outputs, payment data, AI prompts, and internal generation
   * records are never included.
   */
  private readonly publicationSelect = {
    id: true,
    ideaId: true,
    status: true,
    visibility: true,

    publicTitle: true,
    publicAbstract: true,
    publicProblem: true,
    publicObjectives: true,
    publicTargetUsers: true,

    allowRatings: true,
    allowFeedback: true,
    allowVoting: true,

    averageRating: true,
    ratingsCount: true,
    upvotesCount: true,
    downvotesCount: true,
    feedbackCount: true,

    publishedAt: true,
    createdAt: true,
    updatedAt: true,

    publisher: {
      select: {
        id: true,
        fullName: true,
        userType: true,
      },
    },
  } satisfies Prisma.IdeaPublicationSelect;
}

