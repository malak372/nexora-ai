import { Injectable, NotFoundException } from '@nestjs/common';

import {
  AccountStatus,
  IdeaPublicationStatus,
  IdeaPublicationVisibility,
  Prisma,
  UserType,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { GetAcceptedPublicationsQueryDto } from '../dto/get-accepted-publications-query.dto';
import { GetPublicationsQueryDto } from '../dto/get-publications-query.dto';

/**
 * Provides read-only queries for idea publications.
 *
 * This service is responsible for:
 * - Retrieving publicly visible publications.
 * - Retrieving publications discoverable by authenticated users.
 * - Retrieving publications owned by a specific publisher.
 * - Retrieving publications accepted by the authenticated user.
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
        isHidden: false,
        visibility: IdeaPublicationVisibility.PUBLIC,
      },
      query,
    );
  }

  /**
   * Retrieves publications discoverable by an authenticated user.
   *
   * Premium users may discover all active published publications.
   *
   * A non-premium user may discover a publication when it is:
   * - Public.
   * - Visible to all registered users.
   * - Shared directly with the current user.
   * - Shared with the current user's account type.
   *
   * Draft and archived publications are excluded.
   *
   * @param userId Authenticated user identifier.
   * @param userType Authenticated user's account type, when available.
   * @param accountStatus Authenticated user's current account status.
   * @param query Publication list query options.
   * @returns Paginated publications accessible to the user.
   */
  async findDiscoverable(
    userId: string,
    userType: UserType | null,
    accountStatus: AccountStatus,
    query: GetPublicationsQueryDto,
  ) {
    if (accountStatus === AccountStatus.PREMIUM) {
      return this.findMany(
        {
          status: IdeaPublicationStatus.PUBLISHED,
          isHidden: false,
          publisherId: { not: userId },
        },
        query,
      );
    }

    return this.findMany(
      {
        status: IdeaPublicationStatus.PUBLISHED,
        isHidden: false,
        publisherId: { not: userId },
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
   * Retrieves publications accepted by the authenticated user.
   *
   * Both NORMAL and PREMIUM users can retrieve their acceptance history.
   * The result includes the safe publication snapshot and the user's
   * acceptance and advanced-access state.
   *
   * @param userId Authenticated user identifier.
   * @param query Accepted-publication query options.
   * @returns Paginated publications accepted by the user.
   */
  async findAccepted(userId: string, query: GetAcceptedPublicationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();

    const publicationWhere: Prisma.IdeaPublicationWhereInput = {
      isHidden: false,
      ...(query.status ? { status: query.status } : {}),
      ...(query.visibility ? { visibility: query.visibility } : {}),
      ...(search
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
        : {}),
    };

    const where: Prisma.IdeaPublicationAcceptanceWhereInput = {
      userId,
      ...(query.advancedUnlocked === true
        ? {
            advancedUnlockedAt: {
              not: null,
            },
          }
        : {}),
      ...(query.advancedUnlocked === false
        ? {
            advancedUnlockedAt: null,
          }
        : {}),
      ...(query.fromDate || query.toDate
        ? {
            acceptedAt: {
              ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
              ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
            },
          }
        : {}),
      publication: publicationWhere,
    };

    const allowedSorts = new Set(['acceptedAt', 'createdAt', 'updatedAt']);

    const sortBy = allowedSorts.has(query.sortBy ?? '')
      ? query.sortBy!
      : 'acceptedAt';

    const [acceptances, total] = await this.prisma.$transaction([
      this.prisma.ideaPublicationAcceptance.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: {
          [sortBy]: query.sortOrder ?? 'desc',
        },
        select: this.acceptedPublicationSelect,
      }),
      this.prisma.ideaPublicationAcceptance.count({
        where,
      }),
    ]);

    return {
      items: acceptances.map((acceptance) => ({
        acceptanceId: acceptance.id,
        acceptedAt: acceptance.acceptedAt,
        country: acceptance.country,
        city: acceptance.city,
        region: acceptance.region,
        advancedUnlockedAt: acceptance.advancedUnlockedAt,
        advancedUnlockMethod: acceptance.advancedUnlockMethod,
        hasAdvancedAccess: acceptance.advancedUnlockedAt !== null,
        createdAt: acceptance.createdAt,
        updatedAt: acceptance.updatedAt,
        publication: acceptance.publication,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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
      isHidden: false,
      visibility: IdeaPublicationVisibility.PUBLIC,
    });
  }

  /**
   * Retrieves one publication accessible to an authenticated user.
   *
   * Access is granted when:
   * - The user owns the publication.
   * - The user has previously accepted the publication.
   * - The authenticated user is Premium and the publication is published.
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
   * @param accountStatus Authenticated user's current account status.
   * @returns Accessible publication details.
   * @throws NotFoundException When the publication does not exist or is inaccessible.
   */
  async findAccessibleById(
    publicationId: string,
    userId: string,
    userType: UserType | null,
    accountStatus: AccountStatus,
  ) {
    if (accountStatus === AccountStatus.PREMIUM) {
      return this.findOneOrThrow({
        id: publicationId,
        OR: [
          {
            publisherId: userId,
          },
          {
            isHidden: false,
            acceptances: {
              some: {
                userId,
              },
            },
          },
          {
            status: IdeaPublicationStatus.PUBLISHED,
            isHidden: false,
          },
        ],
      });
    }

    return this.findOneOrThrow({
      id: publicationId,
      OR: [
        {
          publisherId: userId,
        },
        {
          isHidden: false,
          acceptances: {
            some: {
              userId,
            },
          },
        },
        {
          status: IdeaPublicationStatus.PUBLISHED,
          isHidden: false,
          visibility: {
            in: [
              IdeaPublicationVisibility.PUBLIC,
              IdeaPublicationVisibility.REGISTERED_USERS,
            ],
          },
        },
        {
          status: IdeaPublicationStatus.PUBLISHED,
          isHidden: false,
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
                ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
                ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
              },
            }
          : {},
      ],
    };

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
  private async findOneOrThrow(where: Prisma.IdeaPublicationWhereInput) {
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
    allowAdoption: true,
    maximumAdoptions: true,
    adoptionMode: true,

    averageRating: true,
    ratingsCount: true,
    upvotesCount: true,
    downvotesCount: true,
    feedbackCount: true,

    publishedAt: true,
    archivedAt: true,
    isHidden: true,
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

  /**
   * Safe accepted-publication projection.
   */
  private readonly acceptedPublicationSelect = {
    id: true,
    acceptedAt: true,
    country: true,
    city: true,
    region: true,
    advancedUnlockedAt: true,
    advancedUnlockMethod: true,
    createdAt: true,
    updatedAt: true,
    publication: {
      select: this.publicationSelect,
    },
  } satisfies Prisma.IdeaPublicationAcceptanceSelect;
}