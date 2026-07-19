import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  IdeaGenerationType,
  Prisma,
  UnlockMethod,
} from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
  buildStringFilter,
} from '../../../../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../../../../utilities/analytics/analytics.helper';

import { GetAdminIdeasQueryDto } from '../dto/get-admin-ideas-query.dto';

/**
 * Administrative service for generated project ideas.
 *
 * Responsibilities:
 * - Retrieve paginated ideas.
 * - Filter ideas using their domain, region, owner, pipeline,
 *   data sources, generation type and unlock information.
 * - Produce summary statistics.
 * - Produce chart-ready analytics.
 * - Export filtered ideas as CSV.
 * - Retrieve a complete administrative view of one idea.
 *
 * The service uses the current data model:
 *
 * Idea
 *   -> CollectionJob
 *      -> CollectionJobSource
 *         -> DataSource
 *
 * It does not depend on the removed Platform model or the old
 * selectedPlatformId field.
 *
 * @author Malak
 */
@Injectable()
export class AdminIdeasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the shared Prisma filter used by listing,
   * summaries, charts and CSV export.
   *
   * Soft-deleted ideas are excluded from normal administrative
   * analytics. A separate recovery workflow should be introduced
   * if administrators need to inspect deleted ideas.
   */
  private buildIdeasWhere(
    query: GetAdminIdeasQueryDto,
  ): Prisma.IdeaWhereInput {
    const isUnlocked =
      query.isUnlocked === undefined
        ? undefined
        : query.isUnlocked === 'true';

    return {
      deletedAt: null,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(
        ['title', 'problemStatement'],
        query.search,
      ) ?? {}),

      ...(buildExactFilter('domainId', query.domainId) ?? {}),

      ...(buildExactFilter(
        'generationType',
        query.generationType,
      ) ?? {}),

      ...(buildExactFilter(
        'unlockMethod',
        query.unlockMethod,
      ) ?? {}),

      ...(buildExactFilter('isUnlocked', isUnlocked) ?? {}),

      ...(buildStringFilter(
        'selectedRegion',
        query.region,
      ) ?? {}),

      ...(query.userType
        ? {
            user: {
              is: {
                userType: query.userType,
              },
            },
          }
        : {}),

      ...(query.runStatus
        ? {
            generationRun: {
              is: {
                status: query.runStatus,
              },
            },
          }
        : {}),

      ...(query.dataSourceKey
        ? {
            collectionJob: {
              is: {
                sources: {
                  some: {
                    dataSource: {
                      is: {
                        key: query.dataSourceKey,
                      },
                    },
                  },
                },
              },
            },
          }
        : {}),
    };
  }

  /**
   * Adds a minimum createdAt constraint while preserving
   * any existing createdAt filter.
   */
  private mergeCreatedAtGte(
    where: Prisma.IdeaWhereInput,
    gte: Date,
  ): Prisma.IdeaWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' &&
      where.createdAt !== null
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
   * Retrieves generated ideas with filtering, searching,
   * pagination and safe sorting.
   */
  async getIdeas(query: GetAdminIdeasQueryDto) {
    const {
      page,
      limit,
      skip,
      take,
    } = buildPagination(query);

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
        'updatedAt',
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
          updatedAt: true,

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              userType: true,
              accountStatus: true,
            },
          },

          guestSession: {
            select: {
              id: true,
            },
          },

          domain: {
            select: {
              id: true,
              name: true,
            },
          },

          collectionJob: {
            select: {
              id: true,
              status: true,
              country: true,
              city: true,
              region: true,
              totalPosts: true,
              totalComments: true,

              sources: {
                select: {
                  status: true,
                  totalPosts: true,
                  totalComments: true,

                  dataSource: {
                    select: {
                      id: true,
                      key: true,
                      displayName: true,
                    },
                  },
                },

                orderBy: {
                  dataSource: {
                    displayName: 'asc',
                  },
                },
              },
            },
          },

          generationRun: {
            select: {
              id: true,
              status: true,
              currentStageKey: true,
              progressPercent: true,
              startedAt: true,
              completedAt: true,
            },
          },

          publication: {
            select: {
              id: true,
              status: true,
              visibility: true,
              publishedAt: true,
            },
          },

          _count: {
            select: {
              generatedOutputs: true,
              payments: true,
              creditTransactions: true,
              chatSessions: true,
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
   * Retrieves summary statistics for the currently applied filters.
   */
  async getIdeasSummary(query: GetAdminIdeasQueryDto) {
    const where = this.buildIdeasWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(
      where,
      todayStart,
    );

    const monthWhere = this.mergeCreatedAtGte(
      where,
      monthStart,
    );

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
      publishedIdeas,
      ideasWithCompletedRuns,
      ideasWithFailedRuns,
      aggregate,
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
          generationType:
            IdeaGenerationType.GUEST_FREE,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          generationType:
            IdeaGenerationType.NORMAL_FREE,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          generationType:
            IdeaGenerationType.PREMIUM_CREDIT,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          unlockMethod:
            UnlockMethod.DIRECT_PAYMENT,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,
          unlockMethod:
            UnlockMethod.CREDIT_GENERATION,
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,

          publication: {
            is: {
              status: 'PUBLISHED',
            },
          },
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,

          generationRun: {
            is: {
              status: 'COMPLETED',
            },
          },
        },
      }),

      this.prisma.idea.count({
        where: {
          ...where,

          generationRun: {
            is: {
              status: 'FAILED',
            },
          },
        },
      }),

      this.prisma.idea.aggregate({
        where,

        _sum: {
          commentsCount: true,
        },

        _avg: {
          commentsCount: true,
        },
      }),
    ]);

    return {
      totalIdeas,
      todayIdeas,
      thisMonthIdeas,

      access: {
        unlockedIdeas,
        lockedIdeas,
      },

      generationTypes: {
        guestFreeIdeas,
        normalFreeIdeas,
        premiumCreditIdeas,
      },

      unlockMethods: {
        directPaymentUnlocks,
        creditGenerationUnlocks,
      },

      pipeline: {
        completedRuns: ideasWithCompletedRuns,
        failedRuns: ideasWithFailedRuns,
      },

      publications: {
        publishedIdeas,
      },

      communityData: {
        totalCommentsUsed:
          aggregate._sum.commentsCount ?? 0,

        averageCommentsPerIdea:
          aggregate._avg.commentsCount ?? 0,
      },
    };
  }

  /**
   * Retrieves chart-ready administrative analytics.
   *
   * Relational data-source analytics are loaded through
   * CollectionJobSource because Prisma groupBy cannot group directly
   * by nested relation fields from Idea.
   */
  async getIdeasCharts(query: GetAdminIdeasQueryDto) {
    const where = this.buildIdeasWhere(query);

    const [
      ideasByGenerationType,
      ideasByUnlockMethod,
      ideasByUnlockStatus,
      ideasByDomain,
      ideasByRegion,
      matchedIdeas,
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

      this.prisma.idea.findMany({
        where,

        select: {
          collectionJob: {
            select: {
              sources: {
                select: {
                  dataSource: {
                    select: {
                      id: true,
                      key: true,
                      displayName: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const domainIds = ideasByDomain.map(
      (item) => item.domainId,
    );

    const domains = await this.prisma.domain.findMany({
      where: {
        id: {
          in: domainIds,
        },
      },

      select: {
        id: true,
        name: true,
      },
    });

    const domainMap = new Map(
      domains.map((domain) => [
        domain.id,
        domain.name,
      ]),
    );

    const dataSourceCounts = new Map<
      string,
      {
        dataSourceId: string;
        dataSourceKey: string;
        displayName: string;
        count: number;
      }
    >();

    for (const idea of matchedIdeas) {
      const sources =
        idea.collectionJob?.sources ?? [];

      const uniqueDataSourceKeys = new Set<string>();

      for (const source of sources) {
        const dataSource = source.dataSource;

        if (
          uniqueDataSourceKeys.has(dataSource.key)
        ) {
          continue;
        }

        uniqueDataSourceKeys.add(dataSource.key);

        const existing = dataSourceCounts.get(
          dataSource.key,
        );

        dataSourceCounts.set(dataSource.key, {
          dataSourceId: dataSource.id,
          dataSourceKey: dataSource.key,
          displayName: dataSource.displayName,
          count: (existing?.count ?? 0) + 1,
        });
      }
    }

    const ideasByDataSource = [
      ...dataSourceCounts.values(),
    ]
      .sort((first, second) =>
        second.count - first.count,
      )
      .slice(0, 10)
      .map((item) => ({
        label: item.displayName,
        ...item,
      }));

    return {
      ideasByGenerationType:
        ideasByGenerationType.map((item) => ({
          label: item.generationType,
          generationType: item.generationType,
          count: item._count.generationType,
        })),

      ideasByUnlockMethod:
        ideasByUnlockMethod.map((item) => ({
          label: item.unlockMethod,
          unlockMethod: item.unlockMethod,
          count: item._count.unlockMethod,
        })),

      ideasByUnlockStatus:
        ideasByUnlockStatus.map((item) => ({
          label: item.isUnlocked
            ? 'UNLOCKED'
            : 'LOCKED',

          isUnlocked: item.isUnlocked,
          count: item._count.isUnlocked,
        })),

      ideasByDomain: ideasByDomain.map(
        (item) => {
          const domainName =
            domainMap.get(item.domainId) ?? null;

          return {
            label:
              domainName ?? 'Unknown Domain',

            domainId: item.domainId,
            domainName,
            count: item._count.domainId,
          };
        },
      ),

      ideasByDataSource,

      ideasByRegion: ideasByRegion.map(
        (item) => ({
          label:
            item.selectedRegion ??
            'Unknown Region',

          region: item.selectedRegion,
          count: item._count.selectedRegion,
        }),
      ),
    };
  }

  /**
   * Exports the currently filtered ideas as CSV.
   */
  async exportIdeasCsv(
    query: GetAdminIdeasQueryDto,
  ) {
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
        'updatedAt',
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

        guestSession: {
          select: {
            id: true,
          },
        },

        domain: {
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

            sources: {
              select: {
                dataSource: {
                  select: {
                    key: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },

        generationRun: {
          select: {
            id: true,
            status: true,
            progressPercent: true,
          },
        },

        publication: {
          select: {
            id: true,
            status: true,
            visibility: true,
          },
        },
      },
    });

    const headers = [
      'Idea ID',
      'Title',
      'Owner Type',
      'User ID',
      'User Name',
      'User Email',
      'User Type',
      'Guest Session ID',
      'Domain ID',
      'Domain Name',
      'Data Sources',
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
      'Generation Run ID',
      'Generation Run Status',
      'Generation Progress',
      'Publication ID',
      'Publication Status',
      'Publication Visibility',
      'Created At',
      'Updated At',
    ];

    const rows = ideas.map((idea) => {
      const dataSources =
        idea.collectionJob?.sources
          .map(
            (source) =>
              `${source.dataSource.displayName} (${source.dataSource.key})`,
          )
          .join(' | ') ?? '';

      return [
        idea.id,
        idea.title,
        idea.user ? 'USER' : 'GUEST',
        idea.user?.id ?? '',
        idea.user?.fullName ?? '',
        idea.user?.email ?? '',
        idea.user?.userType ?? '',
        idea.guestSession?.id ?? '',
        idea.domain.id,
        idea.domain.name,
        dataSources,
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
        idea.generationRun?.id ?? '',
        idea.generationRun?.status ?? '',
        idea.generationRun?.progressPercent ?? '',
        idea.publication?.id ?? '',
        idea.publication?.status ?? '',
        idea.publication?.visibility ?? '',
        idea.createdAt.toISOString(),
        idea.updatedAt.toISOString(),
      ];
    });

    return buildCsv(headers, rows);
  }

  /**
   * Retrieves the complete administrative view of one idea.
   *
   * Includes:
   * - Owner information.
   * - Domain.
   * - Generation run and stages.
   * - Collection job and selected data sources.
   * - Collected posts and comments.
   * - NLP analysis.
   * - Prompt history.
   * - Generated outputs.
   * - Payments and credit deductions.
   * - Chat sessions.
   * - Publication, audience, votes, ratings and feedback.
   */
  async getIdeaById(ideaId: string) {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        deletedAt: null,
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
            freeGenerationLimit: true,
            freeGenerationsUsed: true,
            isActive: true,
            isVerified: true,
            createdAt: true,
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

        generationRun: {
          select: {
            id: true,
            generationType: true,
            status: true,
            currentStageKey: true,
            progressPercent: true,

            errorCode: true,
            errorMessage: true,

            lastHeartbeatAt: true,
            cancelRequestedAt: true,

            startedAt: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,

            stages: {
              orderBy: {
                sequence: 'asc',
              },

              select: {
                id: true,
                stageKey: true,
                displayName: true,
                sequence: true,
                status: true,
                progressPercent: true,
                resultPreview: true,
                errorMessage: true,
                attemptCount: true,
                maxAttempts: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },

        collectionJob: {
          select: {
            id: true,
            createdById: true,

            country: true,
            city: true,
            region: true,
            radiusKm: true,
            language: true,
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

            sources: {
              orderBy: {
                dataSource: {
                  displayName: 'asc',
                },
              },

              select: {
                id: true,
                status: true,
                totalPosts: true,
                totalComments: true,
                startedAt: true,
                completedAt: true,
                failureReason: true,

                dataSource: {
                  select: {
                    id: true,
                    key: true,
                    displayName: true,
                    description: true,
                    isActive: true,
                    isImplemented: true,
                    supportsPosts: true,
                    supportsComments: true,
                    supportsRegion: true,
                    supportsLanguage: true,
                  },
                },
              },
            },

            posts: {
              take: 20,

              orderBy: {
                collectedAt: 'desc',
              },

              select: {
                id: true,
                externalId: true,
                title: true,
                content: true,
                author: true,
                url: true,

                country: true,
                city: true,
                region: true,
                languageCode: true,

                likesCount: true,
                repliesCount: true,

                publishedAt: true,
                collectedAt: true,
                createdAt: true,

                dataSource: {
                  select: {
                    id: true,
                    key: true,
                    displayName: true,
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
                    languageCode: true,
                    sentiment: true,
                    likesCount: true,
                    publishedAt: true,
                    collectedAt: true,
                    createdAt: true,
                  },
                },

                _count: {
                  select: {
                    comments: true,
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

              take: 20,

              select: {
                id: true,
                userId: true,
                guestSessionId: true,
                ideaId: true,
                promptType: true,
                promptText: true,
                templateHash: true,
                estimatedInputTokens: true,
                createdAt: true,
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

            paymentMethodKey: true,
            providerKey: true,

            status: true,
            paymentPurpose: true,

            creditsAmount: true,
            bonusCreditsAmount: true,
            creditPriceAtPurchase: true,

            providerPaymentId: true,
            providerSessionId: true,
            transactionReference: true,
            failureReason: true,

            paidAt: true,
            failedAt: true,
            refundedAt: true,

            createdAt: true,
            updatedAt: true,
          },
        },

        creditTransactions: {
          orderBy: {
            createdAt: 'desc',
          },

          select: {
            id: true,
            paymentId: true,
            type: true,
            amount: true,
            balanceAfter: true,
            description: true,
            createdAt: true,
          },
        },

        generatedOutputs: {
          orderBy: {
            sequence: 'asc',
          },

          select: {
            id: true,
            outputKey: true,
            title: true,
            sequence: true,
            status: true,
            content: true,
            structuredContent: true,
            errorMessage: true,
            generatedAt: true,
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

        publication: {
          select: {
            id: true,
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
            archivedAt: true,
            createdAt: true,
            updatedAt: true,

            publisher: {
              select: {
                id: true,
                fullName: true,
                email: true,
                userType: true,
              },
            },

            audiences: {
              orderBy: {
                createdAt: 'asc',
              },

              select: {
                id: true,
                audienceType: true,
                audienceValue: true,
                createdAt: true,
              },
            },

            revisions: {
              orderBy: {
                version: 'desc',
              },

              select: {
                id: true,
                version: true,
                publicTitle: true,
                publicAbstract: true,
                publicProblem: true,
                publicObjectives: true,
                publicTargetUsers: true,
                createdAt: true,
              },
            },

            votes: {
              orderBy: {
                updatedAt: 'desc',
              },

              select: {
                id: true,
                value: true,
                createdAt: true,
                updatedAt: true,

                user: {
                  select: {
                    id: true,
                    fullName: true,
                    userType: true,
                  },
                },
              },
            },

            ratings: {
              orderBy: {
                updatedAt: 'desc',
              },

              select: {
                id: true,
                value: true,
                createdAt: true,
                updatedAt: true,

                user: {
                  select: {
                    id: true,
                    fullName: true,
                    userType: true,
                  },
                },
              },
            },

            feedback: {
              orderBy: {
                updatedAt: 'desc',
              },

              select: {
                id: true,
                comment: true,
                status: true,
                createdAt: true,
                updatedAt: true,

                user: {
                  select: {
                    id: true,
                    fullName: true,
                    userType: true,
                  },
                },
              },
            },

            _count: {
              select: {
                favorites: true,
                audiences: true,
                ratings: true,
                votes: true,
                feedback: true,
                revisions: true,
              },
            },
          },
        },

        externalApiLogs: {
          take: 50,

          orderBy: {
            createdAt: 'desc',
          },

          select: {
            id: true,
            serviceCategory: true,
            providerKey: true,
            endpoint: true,
            requestId: true,
            requestType: true,
            operationId: true,
            attemptNumber: true,
            fallbackUsed: true,
            statusCode: true,
            isSuccess: true,
            responseTimeMs: true,
            errorMessage: true,
            costEstimate: true,
            apiModelId: true,
            inputTokens: true,
            outputTokens: true,
            createdAt: true,

            aiModel: {
              select: {
                id: true,
                providerKey: true,
                modelName: true,
                apiModelId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Idea not found.',
      );
    }

    return idea;
  }
}