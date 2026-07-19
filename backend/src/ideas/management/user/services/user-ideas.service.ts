import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  GeneratedOutputStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../../../utilities/base-query/builder';

import {
  calculateTotalPages,
} from '../../../../utilities/analytics/analytics.helper';

import { GetIdeaCommentsQueryDto } from '../dto/get-idea-comments-query.dto';
import { GetUserIdeasQueryDto } from '../dto/get-user-ideas-query.dto';

/**
 * Service responsible for user-owned idea retrieval
 * and management.
 *
 * Responsibilities:
 * - Retrieve the authenticated user's ideas.
 * - Enforce idea ownership.
 * - Return output data according to idea access.
 * - Retrieve community evidence only for unlocked ideas.
 * - Soft-delete user-owned ideas.
 *
 * Access rules:
 *
 * Free locked idea:
 * - Title.
 * - Problem statement.
 * - Objectives.
 * - Target users.
 * - Partial abstract.
 *
 * Premium or directly unlocked idea:
 * - Complete idea information.
 * - Generated advanced outputs.
 * - Community comments and posts.
 * - NLP analysis.
 *
 * @author Malak
 */
@Injectable()
export class UserIdeasService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Creates the Prisma where clause shared by the
   * authenticated user's idea-listing endpoint.
   */
  private buildUserIdeasWhere(
    userId: string,
    query: GetUserIdeasQueryDto,
  ): Prisma.IdeaWhereInput {
    return {
      userId,
      deletedAt: null,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(
        [
          'title',
          'problemStatement',
          'partialAbstract',
        ],
        query.search,
      ) ?? {}),

      ...(buildExactFilter(
        'domainId',
        query.domainId,
      ) ?? {}),

      ...(buildExactFilter(
        'generationType',
        query.generationType,
      ) ?? {}),

      ...(buildExactFilter(
        'isUnlocked',
        query.isUnlocked,
      ) ?? {}),

      ...(buildExactFilter(
        'unlockMethod',
        query.unlockMethod,
      ) ?? {}),
    };
  }

  /**
   * Retrieves ideas belonging to the authenticated user.
   *
   * List results intentionally contain summary data only.
   * Complete details are retrieved through getMyIdeaById.
   */
  async getMyIdeas(
    userId: string,
    query: GetUserIdeasQueryDto,
  ) {
    const {
      page,
      limit,
      skip,
      take,
    } = buildPagination(query);

    const where = this.buildUserIdeasWhere(
      userId,
      query,
    );

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

          limitedAbstract: true,
          partialAbstract: true,

          problemStatement: true,
          objectives: true,
          targetUsers: true,

          selectedRegion: true,

          generationType: true,

          isUnlocked: true,
          unlockMethod: true,
          unlockedAt: true,

          commentsCount: true,

          createdAt: true,
          updatedAt: true,

          domain: {
            select: {
              id: true,
              name: true,
            },
          },

          generationRun: {
            select: {
              id: true,
              status: true,
              currentStageKey: true,
              progressPercent: true,
              errorCode: true,
              errorMessage: true,
              startedAt: true,
              completedAt: true,
            },
          },

          publication: {
            select: {
              id: true,
              status: true,
              visibility: true,
              publicTitle: true,
              publishedAt: true,
            },
          },

          generatedOutputs: {
            where: {
              status:
                GeneratedOutputStatus.COMPLETED,
            },

            orderBy: {
              sequence: 'asc',
            },

            select: {
              id: true,
              outputKey: true,
              title: true,
              sequence: true,
              status: true,
            },
          },

          _count: {
            select: {
              generatedOutputs: true,
              chatSessions: true,
              payments: true,
            },
          },
        },
      }),

      this.prisma.idea.count({
        where,
      }),
    ]);

    const data = ideas.map((idea) => ({
      ...idea,

      /**
       * Do not expose advanced-output metadata for locked ideas.
       */
      generatedOutputs: idea.isUnlocked
        ? idea.generatedOutputs
        : [],

      access: {
        canViewAdvancedOutputs: idea.isUnlocked,
        canUseAiChat: idea.isUnlocked,
        canViewCommunityData: idea.isUnlocked,
        canPublish: true,
      },
    }));

    return {
      data,

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(
          total,
          limit,
        ),
      },
    };
  }

  /**
   * Retrieves a complete user-facing representation
   * of one user-owned idea.
   */
  async getMyIdeaById(
    userId: string,
    ideaId: string,
  ) {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
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

        domain: {
          select: {
            id: true,
            name: true,
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
                startedAt: true,
                completedAt: true,
              },
            },
          },
        },

        collectionJob: {
          select: {
            id: true,

            country: true,
            city: true,
            region: true,
            radiusKm: true,
            language: true,

            totalPosts: true,
            totalComments: true,

            completedAt: true,

            sources: {
              orderBy: {
                dataSource: {
                  displayName: 'asc',
                },
              },

              select: {
                status: true,
                totalPosts: true,
                totalComments: true,

                dataSource: {
                  select: {
                    key: true,
                    displayName: true,
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

            _count: {
              select: {
                favorites: true,
                ratings: true,
                votes: true,
                feedback: true,
                revisions: true,
              },
            },
          },
        },

        _count: {
          select: {
            chatSessions: true,
            generatedOutputs: true,
            payments: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Idea not found.',
      );
    }

    const advancedAccess = idea.isUnlocked;

    return {
      id: idea.id,
      title: idea.title,

      domain: idea.domain,
      selectedRegion: idea.selectedRegion,

      generationType: idea.generationType,

      isUnlocked: idea.isUnlocked,
      unlockMethod: idea.unlockMethod,
      unlockedAt: idea.unlockedAt,

      /**
       * Guest-transfer compatibility:
       * If a guest idea was attached to a registered user,
       * both limited and partial abstracts may exist.
       */
      limitedAbstract: idea.limitedAbstract,
      partialAbstract: idea.partialAbstract,

      /**
       * Full abstract is returned only after advanced access
       * has been granted.
       */
      fullAbstract: advancedAccess
        ? idea.fullAbstract
        : null,

      problemStatement: idea.problemStatement,
      objectives: idea.objectives,
      targetUsers: idea.targetUsers,

      commentsCount: advancedAccess
        ? idea.commentsCount
        : undefined,

      generationRun: idea.generationRun,

      /**
       * Collection metadata may be shown in a limited form
       * for locked ideas, but NLP evidence and sample data
       * are protected advanced features.
       */
      collection: idea.collectionJob
        ? {
            id: idea.collectionJob.id,
            country:
              idea.collectionJob.country,
            city:
              idea.collectionJob.city,
            region:
              idea.collectionJob.region,
            language:
              idea.collectionJob.language,

            dataSources:
              idea.collectionJob.sources.map(
                (source) => ({
                  key:
                    source.dataSource.key,

                  displayName:
                    source.dataSource
                      .displayName,

                  status: source.status,

                  totalPosts:
                    advancedAccess
                      ? source.totalPosts
                      : undefined,

                  totalComments:
                    advancedAccess
                      ? source.totalComments
                      : undefined,
                }),
              ),

            totalPosts: advancedAccess
              ? idea.collectionJob.totalPosts
              : undefined,

            totalComments: advancedAccess
              ? idea.collectionJob.totalComments
              : undefined,

            nlpAnalysis: advancedAccess
              ? idea.collectionJob.nlpAnalysis
              : null,
          }
        : null,

      generatedOutputs: advancedAccess
        ? idea.generatedOutputs
        : [],

      publication: idea.publication,

      access: {
        canViewAdvancedOutputs:
          advancedAccess,

        canViewFullAbstract:
          advancedAccess,

        canViewCommunityData:
          advancedAccess,

        canViewNlpAnalysis:
          advancedAccess,

        canUseAiChat:
          advancedAccess,

        canPublish: true,

        requiresDirectUnlock:
          !advancedAccess,
      },

      counts: {
        chatSessions:
          advancedAccess
            ? idea._count.chatSessions
            : 0,

        generatedOutputs:
          advancedAccess
            ? idea._count.generatedOutputs
            : 0,

        payments: idea._count.payments,
      },

      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
    };
  }

  /**
   * Retrieves community comments used by an unlocked,
   * user-owned idea.
   *
   * The method queries SocialComment through its SocialPost
   * relation because SocialComment does not directly store
   * collectionJobId or dataSourceId.
   */
  async getMyIdeaComments(
    userId: string,
    ideaId: string,
    query: GetIdeaCommentsQueryDto,
  ) {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
        deletedAt: null,
      },

      select: {
        id: true,
        title: true,
        isUnlocked: true,
        collectionJobId: true,
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Idea not found.',
      );
    }

    if (!idea.isUnlocked) {
      throw new ForbiddenException(
        'Community comments are available only for unlocked ideas.',
      );
    }

    if (!idea.collectionJobId) {
      return {
        idea: {
          id: idea.id,
          title: idea.title,
        },

        data: [],

        meta: {
          page: query.page,
          limit: query.limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const page = query.page;
    const limit = query.limit;

    const skip = (page - 1) * limit;

    const where: Prisma.SocialCommentWhereInput = {
      post: {
        is: {
          collectionJobId:
            idea.collectionJobId,

          ...(query.dataSourceKey
            ? {
                dataSource: {
                  is: {
                    key:
                      query.dataSourceKey,
                  },
                },
              }
            : {}),
        },
      },

      ...(query.sentiment
        ? {
            sentiment: {
              equals:
                query.sentiment,
              mode:
                Prisma.QueryMode.insensitive,
            },
          }
        : {}),

      ...(query.languageCode
        ? {
            languageCode: {
              equals:
                query.languageCode,
              mode:
                Prisma.QueryMode.insensitive,
            },
          }
        : {}),
    };

    const [comments, total] =
      await Promise.all([
        this.prisma.socialComment.findMany({
          where,
          skip,
          take: limit,

          orderBy: [
            {
              likesCount: 'desc',
            },
            {
              collectedAt: 'desc',
            },
          ],

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

            post: {
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
        }),

        this.prisma.socialComment.count({
          where,
        }),
      ]);

    return {
      idea: {
        id: idea.id,
        title: idea.title,
      },

      data: comments,

      meta: {
        page,
        limit,
        total,
        totalPages:
          calculateTotalPages(
            total,
            limit,
          ),
      },
    };
  }

  /**
   * Soft-deletes one user-owned idea.
   *
   * A published idea must first be archived because deleting
   * an actively published project could leave public references
   * in an inconsistent state.
   */
  async deleteMyIdea(
    userId: string,
    ideaId: string,
  ) {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
        deletedAt: null,
      },

      select: {
        id: true,

        publication: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Idea not found.',
      );
    }

    if (
      idea.publication?.status ===
      'PUBLISHED'
    ) {
      throw new ForbiddenException(
        'Archive the published idea before deleting it.',
      );
    }

    const deletedAt = new Date();

    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.idea.update({
          where: {
            id: ideaId,
          },

          data: {
            deletedAt,
          },
        });

        if (idea.publication) {
          await transaction.ideaPublication.update({
            where: {
              id: idea.publication.id,
            },

            data: {
              status: 'ARCHIVED',
              archivedAt:
                idea.publication.status ===
                'ARCHIVED'
                  ? undefined
                  : deletedAt,
            },
          });
        }
      },
    );

    return {
      message:
        'Idea deleted successfully.',
    };
  }
}