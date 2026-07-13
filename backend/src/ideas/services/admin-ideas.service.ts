import { Injectable, NotFoundException } from '@nestjs/common';

import { IdeaGenerationType, Prisma, UnlockMethod } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
  buildStringFilter,
} from '../../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../../utilities/analytics/analytics.helper';

import { GetIdeasQueryDto } from '../dto/get-admin-ideas-query.dto';

/**
 * Service responsible for administrative idea management.
 *
 * Provides:
 * - Paginated ideas list.
 * - Filtering by domain, platform, region, generation type,
 *   unlock method, unlock status, and owner user type.
 * - Search by title and problem statement.
 * - Safe sorting using whitelisted fields.
 * - Idea summary reports.
 * - Chart-ready idea analytics.
 * - CSV export.
 * - Detailed idea inspection with related collection jobs,
 *   social posts, comments, NLP analysis, prompts, payments,
 *   credits, outputs, and chat sessions.
 *
 * Notes:
 * - The old Comment and IdeaComment models were removed.
 * - Comments used for an idea are accessed through:
 *   Idea -> CollectionJob -> SocialPost -> SocialComment.
 *
 * @author Malak
 */
@Injectable()
export class AdminIdeasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the shared Prisma filter used by idea listing,
   * summaries, charts, and CSV export.
   */
  private buildIdeasWhere(query: GetIdeasQueryDto): Prisma.IdeaWhereInput {
    const isUnlocked =
      query.isUnlocked !== undefined ? query.isUnlocked === 'true' : undefined;

    return {
      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(['title', 'problemStatement'], query.search) ?? {}),

      ...(buildExactFilter('domainId', query.domainId) ?? {}),

      ...(buildExactFilter('selectedPlatformId', query.platformId) ?? {}),

      ...(buildExactFilter('generationType', query.generationType) ?? {}),

      ...(buildExactFilter('unlockMethod', query.unlockMethod) ?? {}),

      ...(buildExactFilter('isUnlocked', isUnlocked) ?? {}),

      ...(buildStringFilter('selectedRegion', query.region) ?? {}),

      ...(query.userType !== undefined
        ? {
            user: {
              userType: query.userType,
            },
          }
        : {}),
    };
  }

  /**
   * Adds a minimum createdAt date while preserving
   * any existing createdAt filters.
   */
  private mergeCreatedAtGte(
    where: Prisma.IdeaWhereInput,
    gte: Date,
  ): Prisma.IdeaWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' && where.createdAt !== null
        ? where.createdAt
        : {};

    return {
      ...where,

      createdAt: {
        ...existingCreatedAt,
        gte,
      },
    };
  }

  /**
   * Retrieves generated ideas with filtering,
   * searching, sorting, and pagination.
   */
  async getIdeas(query: GetIdeasQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildIdeasWhere(query);

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
        take,
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
              userType: true,
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

          collectionJob: {
            select: {
              id: true,
              status: true,
              totalPosts: true,
              totalComments: true,
            },
          },
        },
      }),

      this.prisma.idea.count({
        where,
      }),
    ]);

    return {
      data: ideas,

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves idea summary statistics.
   */
  async getIdeasSummary(query: GetIdeasQueryDto) {
    const where = this.buildIdeasWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);

    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

    const [
      totalIdeas,
      todayIdeas,
      thisMonthIdeas,
      unlockedIdeas,
      lockedIdeas,
      guestFreeIdeas,
      normalFreeIdeas,
      premiumCreditIdeas,
      directPaymentUnlocks,
      creditGenerationUnlocks,
    ] = await Promise.all([
      this.prisma.idea.count({
        where,
      }),

      this.prisma.idea.count({
        where: todayWhere,
      }),

      this.prisma.idea.count({
        where: monthWhere,
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          isUnlocked: true,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          isUnlocked: false,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          generationType: IdeaGenerationType.GUEST_FREE,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          generationType: IdeaGenerationType.NORMAL_FREE,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          generationType: IdeaGenerationType.PREMIUM_CREDIT,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          unlockMethod: UnlockMethod.DIRECT_PAYMENT,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          unlockMethod: UnlockMethod.CREDIT_GENERATION,
        },
      }),
    ]);

    return {
      totalIdeas,
      todayIdeas,
      thisMonthIdeas,
      unlockedIdeas,
      lockedIdeas,
      guestFreeIdeas,
      normalFreeIdeas,
      premiumCreditIdeas,
      directPaymentUnlocks,
      creditGenerationUnlocks,
    };
  }

  /**
   * Retrieves chart-ready idea analytics.
   */
  async getIdeasCharts(query: GetIdeasQueryDto) {
    const where = this.buildIdeasWhere(query);

    const [
      ideasByGenerationType,
      ideasByUnlockMethod,
      ideasByUnlockStatus,
      ideasByDomain,
      ideasByPlatform,
      ideasByRegion,
    ] = await Promise.all([
      this.prisma.idea.groupBy({
        by: ['generationType'],
        where,

        _count: {
          generationType: true,
        },

        orderBy: {
          _count: {
            generationType: 'desc',
          },
        },
      }),

      this.prisma.idea.groupBy({
        by: ['unlockMethod'],
        where,

        _count: {
          unlockMethod: true,
        },

        orderBy: {
          _count: {
            unlockMethod: 'desc',
          },
        },
      }),

      this.prisma.idea.groupBy({
        by: ['isUnlocked'],
        where,

        _count: {
          isUnlocked: true,
        },

        orderBy: {
          _count: {
            isUnlocked: 'desc',
          },
        },
      }),

      this.prisma.idea.groupBy({
        by: ['domainId'],
        where,

        _count: {
          domainId: true,
        },

        orderBy: {
          _count: {
            domainId: 'desc',
          },
        },

        take: 10,
      }),

      this.prisma.idea.groupBy({
        by: ['selectedPlatformId'],

        where: {
          ...where,

          selectedPlatformId: {
            not: null,
          },
        },

        _count: {
          selectedPlatformId: true,
        },

        orderBy: {
          _count: {
            selectedPlatformId: 'desc',
          },
        },

        take: 10,
      }),

      this.prisma.idea.groupBy({
        by: ['selectedRegion'],

        where: {
          ...where,

          selectedRegion: {
            not: null,
          },
        },

        _count: {
          selectedRegion: true,
        },

        orderBy: {
          _count: {
            selectedRegion: 'desc',
          },
        },

        take: 10,
      }),
    ]);

    const domainIds = ideasByDomain.map((item) => item.domainId);

    const platformIds = ideasByPlatform
      .map((item) => item.selectedPlatformId)
      .filter((id): id is string => Boolean(id));

    const [domains, platforms] = await Promise.all([
      this.prisma.domain.findMany({
        where: {
          id: {
            in: domainIds,
          },
        },

        select: {
          id: true,
          name: true,
        },
      }),

      this.prisma.platform.findMany({
        where: {
          id: {
            in: platformIds,
          },
        },

        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    const domainMap = new Map(
      domains.map((domain) => [domain.id, domain.name]),
    );

    const platformMap = new Map(
      platforms.map((platform) => [platform.id, platform.name]),
    );

    return {
      ideasByGenerationType: ideasByGenerationType.map((item) => ({
        label: item.generationType,
        generationType: item.generationType,
        count: item._count.generationType,
      })),

      ideasByUnlockMethod: ideasByUnlockMethod.map((item) => ({
        label: item.unlockMethod,
        unlockMethod: item.unlockMethod,
        count: item._count.unlockMethod,
      })),

      ideasByUnlockStatus: ideasByUnlockStatus.map((item) => ({
        label: item.isUnlocked ? 'UNLOCKED' : 'LOCKED',

        isUnlocked: item.isUnlocked,

        count: item._count.isUnlocked,
      })),

      ideasByDomain: ideasByDomain.map((item) => {
        const domainName = domainMap.get(item.domainId) ?? null;

        return {
          label: domainName ?? 'Unknown Domain',

          domainId: item.domainId,

          domainName,

          count: item._count.domainId,
        };
      }),

      ideasByPlatform: ideasByPlatform.map((item) => {
        const platformName = item.selectedPlatformId
          ? (platformMap.get(item.selectedPlatformId) ?? null)
          : null;

        return {
          label: platformName ?? 'Unknown Platform',

          platformId: item.selectedPlatformId,

          platformName,

          count: item._count.selectedPlatformId,
        };
      }),

      ideasByRegion: ideasByRegion.map((item) => ({
        label: item.selectedRegion ?? 'Unknown Region',

        region: item.selectedRegion,

        count: item._count.selectedRegion,
      })),
    };
  }

  /**
   * Exports filtered ideas as CSV.
   */
  async exportIdeasCsv(query: GetIdeasQueryDto) {
    const where = this.buildIdeasWhere(query);

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

    const ideas = await this.prisma.idea.findMany({
      where,
      orderBy,

      select: {
        id: true,
        title: true,
        selectedRegion: true,
        generationType: true,
        isUnlocked: true,
        unlockMethod: true,
        unlockedAt: true,
        commentsCount: true,
        createdAt: true,
        updatedAt: true,

        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            userType: true,
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

        collectionJob: {
          select: {
            id: true,
            status: true,
            totalPosts: true,
            totalComments: true,
          },
        },
      },
    });

    const headers = [
      'Idea ID',
      'Title',
      'User ID',
      'User Name',
      'User Email',
      'User Type',
      'Domain ID',
      'Domain Name',
      'Platform ID',
      'Platform Name',
      'Selected Region',
      'Generation Type',
      'Is Unlocked',
      'Unlock Method',
      'Unlocked At',
      'Comments Count',
      'Collection Job ID',
      'Collection Job Status',
      'Total Posts',
      'Total Comments',
      'Created At',
      'Updated At',
    ];

    const rows = ideas.map((idea) => [
      idea.id,
      idea.title,
      idea.user?.id ?? '',
      idea.user?.fullName ?? '',
      idea.user?.email ?? '',
      idea.user?.userType ?? '',
      idea.domain?.id ?? '',
      idea.domain?.name ?? '',
      idea.selectedPlatform?.id ?? '',
      idea.selectedPlatform?.name ?? '',
      idea.selectedRegion ?? '',
      idea.generationType,
      idea.isUnlocked,
      idea.unlockMethod,
      idea.unlockedAt?.toISOString() ?? '',
      idea.commentsCount,
      idea.collectionJob?.id ?? '',
      idea.collectionJob?.status ?? '',
      idea.collectionJob?.totalPosts ?? 0,
      idea.collectionJob?.totalComments ?? 0,
      idea.createdAt.toISOString(),
      idea.updatedAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Retrieves detailed information about one project idea.
   *
   * Includes:
   * - Basic idea details.
   * - Owner user or guest session.
   * - Domain and selected platform.
   * - Payments and credit transactions.
   * - Generated AI outputs.
   * - Collection job details.
   * - Social posts and collected comments.
   * - NLP analysis.
   * - Prompt history.
   * - Chat sessions and messages.
   */
  async getIdeaById(ideaId: string) {
    const idea = await this.prisma.idea.findUnique({
      where: {
        id: ideaId,
      },

      select: {
        id: true,
        title: true,
        selectedRegion: true,
        limitedAbstract: true,
        partialAbstract: true,
        fullAbstract: true,
        problemStatement: true,
        objectives: true,
        targetUsers: true,
        generationType: true,
        isUnlocked: true,
        unlockMethod: true,
        unlockedAt: true,
        commentsCount: true,
        createdAt: true,
        updatedAt: true,

        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            accountStatus: true,
            userType: true,
            creditBalance: true,
            isActive: true,
          },
        },

        guestSession: {
          select: {
            id: true,
            hasGenerated: true,
            createdAt: true,
            expiresAt: true,
          },
        },

        domain: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },

        selectedPlatform: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },

        collectionJob: {
          select: {
            id: true,
            country: true,
            city: true,
            region: true,
            radiusKm: true,
            platforms: true,
            keywords: true,
            status: true,
            totalPosts: true,
            totalComments: true,
            startedAt: true,
            completedAt: true,
            failedReason: true,
            createdAt: true,
            updatedAt: true,

            domain: {
              select: {
                id: true,
                name: true,
              },
            },

            posts: {
              take: 20,

              orderBy: {
                collectedAt: 'desc',
              },

              select: {
                id: true,
                sourceType: true,
                externalId: true,
                title: true,
                content: true,
                author: true,
                url: true,
                country: true,
                city: true,
                region: true,
                language: true,
                likesCount: true,
                repliesCount: true,
                publishedAt: true,
                collectedAt: true,
                createdAt: true,

                platform: {
                  select: {
                    id: true,
                    name: true,
                    isActive: true,
                  },
                },

                comments: {
                  take: 20,

                  orderBy: {
                    collectedAt: 'desc',
                  },

                  select: {
                    id: true,
                    externalId: true,
                    content: true,
                    author: true,
                    language: true,
                    sentiment: true,
                    likesCount: true,
                    publishedAt: true,
                    collectedAt: true,
                    createdAt: true,
                  },
                },
              },
            },

            nlpAnalysis: {
              select: {
                id: true,
                totalTextsAnalyzed: true,
                totalPostsAnalyzed: true,
                totalCommentsAnalyzed: true,
                sentimentStats: true,
                keywords: true,
                topics: true,
                recurringProblems: true,
                extractedNeeds: true,
                featureRequests: true,
                opportunities: true,
                insights: true,
                dataQuality: true,
                samplePosts: true,
                sampleComments: true,
                aiUsed: true,
                confidence: true,
                createdAt: true,
                updatedAt: true,
              },
            },

            promptHistories: {
              orderBy: {
                createdAt: 'desc',
              },

              take: 10,

              select: {
                id: true,
                promptType: true,
                promptText: true,
                createdAt: true,
                collectionJobId: true,
              },
            },
          },
        },

        payments: {
          orderBy: {
            createdAt: 'desc',
          },

          select: {
            id: true,
            amount: true,
            currency: true,
            paymentMethod: true,
            status: true,
            paymentPurpose: true,
            creditsAmount: true,
            transactionReference: true,
            createdAt: true,
          },
        },

        creditTransactions: {
          orderBy: {
            createdAt: 'desc',
          },

          select: {
            id: true,
            type: true,
            amount: true,
            balanceAfter: true,
            description: true,
            createdAt: true,
          },
        },

        generatedOutputs: {
          orderBy: {
            createdAt: 'desc',
          },

          select: {
            id: true,
            outputType: true,
            content: true,
            createdAt: true,
            updatedAt: true,
          },
        },

        chatSessions: {
          orderBy: {
            updatedAt: 'desc',
          },

          select: {
            id: true,
            title: true,
            createdAt: true,
            updatedAt: true,

            messages: {
              take: 20,

              orderBy: {
                createdAt: 'desc',
              },

              select: {
                id: true,
                sender: true,
                message: true,
                createdAt: true,
              },
            },
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
