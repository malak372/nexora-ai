import { Injectable, NotFoundException } from '@nestjs/common';

import {
  AccountStatus,
  IdeaPublicationStatus,
  IdeaPublicationVisibility,
  Prisma,
  UserType,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { PublicationCacheService } from '../cache/publication-cache.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicationCache: PublicationCacheService,
  ) { }

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
    const cacheKey = await this.publicationCache.buildKey(
      'public-list',
      'guest',
      query,
    );
    const cached = await this.publicationCache.get(cacheKey);
    if (cached) return cached;

    const result = await this.findMany(
      {
        status: IdeaPublicationStatus.PUBLISHED,
        isHidden: false,
        visibility: IdeaPublicationVisibility.PUBLIC,
      },
      query,
    );

    await this.publicationCache.set(cacheKey, result);
    return result;
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
    const identity = `${userId}:${userType ?? 'none'}:${accountStatus}`;
    const cacheKey = await this.publicationCache.buildKey(
      'discover-list',
      identity,
      query,
    );

    const cached = await this.publicationCache.get(cacheKey);
    if (cached) return cached;

    /*
     * Premium users can discover every active published publication except
     * their own. Normal users must additionally satisfy one of the supported
     * visibility or selected-audience rules.
     */
    const where: Prisma.IdeaPublicationWhereInput =
      accountStatus === AccountStatus.PREMIUM
        ? {
            status: IdeaPublicationStatus.PUBLISHED,
            isHidden: false,
            publisherId: { not: userId },
          }
        : {
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
          };

    /*
     * viewerUserId is passed to findMany so each card can include the current
     * user's acceptance and advanced-access state without extra frontend calls.
     */
    const result = await this.findMany(where, query, {
      viewerUserId: userId,
    });

    await this.publicationCache.set(cacheKey, result);
    return result;
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
      {
        includeAcceptors: true,
      },
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
    const cacheKey = `publications:public-detail:${publicationId}`;
    const cached = await this.publicationCache.get(cacheKey);
    if (cached) return cached;

    const result = await this.findOneOrThrow({
      id: publicationId,
      status: IdeaPublicationStatus.PUBLISHED,
      isHidden: false,
      visibility: IdeaPublicationVisibility.PUBLIC,
    });

    await this.publicationCache.set(cacheKey, result);
    return result;
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
    /*
     * Owners and previous accepters keep access. Premium users may open any
     * active published publication. Normal users must satisfy the publication
     * visibility or selected-audience rules.
     */
    const accessWhere: Prisma.IdeaPublicationWhereInput =
      accountStatus === AccountStatus.PREMIUM
        ? {
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
          }
        : {
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
          };

    const publication = await this.prisma.ideaPublication.findFirst({
      where: accessWhere,
      select: {
        ...this.publicationSelect,
        acceptances: {
          where: {
            userId,
          },
          take: 1,
          select: {
            id: true,
            acceptedAt: true,
            advancedUnlockedAt: true,
            advancedUnlockMethod: true,
          },
        },

        /*
         * Load the Business Model through the exact Idea relation used by this
         * publication. This is more reliable than a separate lookup by id and
         * prevents the accepted workspace from missing a model that exists in
         * the owner's Business Model Studio.
         *
         * `isCurrent desc, version desc` means:
         * - prefer the explicitly current version;
         * - fall back to the newest version for legacy/inconsistent rows.
         */
        idea: {
          select: {
            businessModels: {
              where: {
                userId,
              },
              orderBy: [
                { isCurrent: 'desc' },
                { version: 'desc' },
              ],
              take: 1,
              select: {
                id: true,
                version: true,
                isCurrent: true,
                content: true,
                createdAt: true,
                updatedAt: true,
                businessModelTemplate: {
                  select: {
                    key: true,
                    name: true,
                    description: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!publication) {
      throw new NotFoundException('Publication not found');
    }

    const acceptance = publication.acceptances[0] ?? null;
    const isOwner = publication.publisher.id === userId;

    /*
     * Access and availability are intentionally separate:
     * - access means the viewer is allowed to read advanced outputs;
     * - availability means the source idea actually has completed outputs.
     *
     * This prevents selling or displaying an empty advanced package.
     */
    const advancedAccessGranted =
      isOwner || acceptance?.advancedUnlockedAt != null;

    const advancedOutputsCount = await this.prisma.generatedOutput.count({
      where: {
        ideaId: publication.ideaId,
        status: 'COMPLETED',
      },
    });

    const advancedOutputsAvailable = advancedOutputsCount > 0;

    const advancedOutputs =
      advancedAccessGranted && advancedOutputsAvailable
        ? await this.prisma.generatedOutput.findMany({
            where: {
              ideaId: publication.ideaId,
              status: 'COMPLETED',
            },
            orderBy: [
              {
                sequence: 'asc',
              },
              {
                createdAt: 'asc',
              },
            ],
            select: {
              id: true,
              outputKey: true,
              title: true,
              content: true,
              structuredContent: true,
              sequence: true,
              generatedAt: true,
            },
          })
        : [];

    const businessModel =
      advancedAccessGranted
        ? publication.idea.businessModels[0] ?? null
        : null;

    /*
     * `idea` was loaded only to resolve the read-only Business Model.
     * Do not expose the nested owner-side Idea relation in the API response.
     */
    const {
      acceptances: _acceptances,
      idea: _idea,
      ...safePublication
    } = publication;

    return {
      ...safePublication,
      acceptance,
      hasAdvancedAccess:
        advancedAccessGranted && advancedOutputsAvailable,
      advancedAccessGranted,
      advancedOutputsAvailable,
      advancedOutputsCount,
      advancedOutputs,
      businessModel,
    };
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
    options: {
      readonly viewerUserId?: string;
      readonly includeAcceptors?: boolean;
    } = {},
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

    /*
     * The list and count are read-only and do not require a transactional
     * snapshot. Running them concurrently avoids serial round trips to the
     * remote PostgreSQL database on the first uncached Discover request.
     */
    const [items, total] = await Promise.all([
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

    const acceptanceByPublicationId = new Map<
      string,
      {
        id: string;
        advancedUnlockedAt: Date | null;
      }
    >();

    /*
     * Acceptance state and aggregate counts depend on the publication ids,
     * but not on each other. Fetch them concurrently for Discover instead of
     * waiting for two sequential database round trips.
     */
    const publicationIds = items.map((item) => item.id);

    type ViewerAcceptanceRow = {
      id: string;
      publicationId: string;
      advancedUnlockedAt: Date | null;
    };

    type GroupedAcceptanceRow = {
      publicationId: string;
      _count: {
        _all: number;
      };
    };

    let viewerAcceptances: ViewerAcceptanceRow[] = [];
    let groupedAcceptances: GroupedAcceptanceRow[] = [];

    if (items.length > 0 && !options.includeAcceptors) {
      const [viewerAcceptanceRows, groupedAcceptanceRows] = await Promise.all([
        options.viewerUserId
          ? this.prisma.ideaPublicationAcceptance.findMany({
              where: {
                userId: options.viewerUserId,
                publicationId: { in: publicationIds },
              },
              select: {
                id: true,
                publicationId: true,
                advancedUnlockedAt: true,
              },
            })
          : Promise.resolve([] as ViewerAcceptanceRow[]),
        this.prisma.ideaPublicationAcceptance.groupBy({
          by: ['publicationId'],
          where: {
            publicationId: { in: publicationIds },
          },
          _count: {
            _all: true,
          },
        }),
      ]);

      viewerAcceptances = viewerAcceptanceRows;
      groupedAcceptances = groupedAcceptanceRows;
    }

    viewerAcceptances.forEach((acceptance) => {
      acceptanceByPublicationId.set(acceptance.publicationId, acceptance);
    });

    /*
     * Acceptance totals are safe for discovery cards. Accepter identities are
     * loaded only for the owner's "My Published Ideas" view.
     */
    const acceptanceSummaryByPublicationId = new Map<
      string,
      {
        count: number;
        acceptedBy: Array<{
          id: string;
          fullName: string;
          userType: UserType | null;
          acceptedAt: Date;
          hasAdvancedAccess: boolean;
        }>;
      }
    >();

    if (options.includeAcceptors && items.length > 0) {
      const ownerAcceptances =
        await this.prisma.ideaPublicationAcceptance.findMany({
          where: {
            publicationId: { in: publicationIds },
          },
          orderBy: {
            acceptedAt: 'desc',
          },
          select: {
            publicationId: true,
            acceptedAt: true,
            advancedUnlockedAt: true,
            user: {
              select: {
                id: true,
                fullName: true,
                userType: true,
              },
            },
          },
        });

      ownerAcceptances.forEach((acceptance) => {
        const current = acceptanceSummaryByPublicationId.get(
          acceptance.publicationId,
        ) ?? {
          count: 0,
          acceptedBy: [],
        };

        current.count += 1;
        current.acceptedBy.push({
          id: acceptance.user.id,
          fullName: acceptance.user.fullName,
          userType: acceptance.user.userType,
          acceptedAt: acceptance.acceptedAt,
          hasAdvancedAccess: acceptance.advancedUnlockedAt !== null,
        });

        acceptanceSummaryByPublicationId.set(
          acceptance.publicationId,
          current,
        );
      });
    } else {
      groupedAcceptances.forEach((group) => {
        acceptanceSummaryByPublicationId.set(group.publicationId, {
          count: group._count._all,
          acceptedBy: [],
        });
      });
    }

    return {
      items: items.map((item) => {
        const acceptance = acceptanceByPublicationId.get(item.id) ?? null;
        const acceptanceSummary =
          acceptanceSummaryByPublicationId.get(item.id) ?? {
            count: 0,
            acceptedBy: [],
          };

        return {
          ...item,
          acceptanceCount: acceptanceSummary.count,
          acceptedBy: options.includeAcceptors
            ? acceptanceSummary.acceptedBy
            : undefined,
          isAccepted: acceptance !== null,
          acceptanceId: acceptance?.id ?? null,
          hasAdvancedAccess: acceptance?.advancedUnlockedAt !== null && acceptance !== null,
        };
      }),
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