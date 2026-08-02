import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AccountStatus, GeneratedOutputStatus, Prisma } from '@prisma/client';
import type { Cache } from 'cache-manager';

import { PrismaService } from '../../../../prisma/prisma.service';
import { userCacheKeys } from '../../../../users/cache/user-cache.keys';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../../../utilities/base-query/builder';

import { calculateTotalPages } from '../../../../utilities/analytics/analytics.helper';

import {
  buildIdeaBenchmarkSummary,
  IDEA_BENCHMARK_CANDIDATE_SELECT,
  mapIdeaBenchmarkCandidate,
} from '../../../generation/mappers/idea-benchmark-response.mapper';
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
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  /**
   * Reads one nested value from a persisted JSON snapshot without trusting its
   * runtime shape. Generation snapshots are historical audit data and must be
   * treated as untyped input at the API boundary.
   */
  private readSnapshotRecord(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  }

  /**
   * Builds a user-facing evidence qualification for the generated idea.
   *
   * PRELIMINARY means the pipeline deliberately continued with the strongest
   * penalized fallback after no opportunity passed the strict evidence gate.
   * This is not a generation failure; it is an explicit validation warning.
   */
  private buildEvidenceAssessment(
    contextSnapshot: Prisma.JsonValue | null | undefined,
  ) {
    const snapshot = this.readSnapshotRecord(contextSnapshot);
    const ranking = this.readSnapshotRecord(
      snapshot?.opportunityRanking as Prisma.JsonValue | undefined,
    );
    const selected = this.readSnapshotRecord(
      ranking?.selected as Prisma.JsonValue | undefined,
    );
    const snapshotNlp = this.readSnapshotRecord(
      snapshot?.nlp as Prisma.JsonValue | undefined,
    );

    if (!selected) {
      return null;
    }

    const selectionEligible = selected.selectionEligible === true;
    const finalScore =
      typeof selected.finalScore === 'number' ? selected.finalScore : null;
    const reliability =
      typeof selected.evidenceReliabilityScore === 'number'
        ? selected.evidenceReliabilityScore
        : null;
    const evidenceScore =
      typeof selected.evidenceScore === 'number'
        ? selected.evidenceScore
        : null;
    const nlpConfidence =
      typeof selected.nlpConfidenceScore === 'number'
        ? selected.nlpConfidenceScore
        : typeof snapshotNlp?.confidence === 'number'
          ? snapshotNlp.confidence
          : null;
    const evidenceSamples = Array.isArray(selected.evidenceSamples)
      ? selected.evidenceSamples.filter(
        (sample): sample is string => typeof sample === 'string',
      )
      : [];
    const raw = this.readSnapshotRecord(
      selected.raw as Prisma.JsonValue | undefined,
    );
    const localEvidenceAvailable = raw?.localEvidenceAvailable === true;

    /*
     * Passing the strict gate is necessary but not sufficient for HIGH
     * confidence. A single highly specific report can pass the gate, yet it
     * must remain a pilot hypothesis until repetition or local evidence exists.
     */
    const hasRepeatedEvidence =
      evidenceSamples.length >= 2 ||
      (typeof selected.frequency === 'number' && selected.frequency >= 2);
    const hasStrongEvidenceQuality =
      evidenceScore !== null && evidenceScore >= 0.5;
    const hasStrongNlpConfidence =
      nlpConfidence !== null && nlpConfidence >= 0.65;

    const confidence = !selectionEligible
      ? 'LOW'
      : reliability !== null &&
        reliability >= 0.8 &&
        hasRepeatedEvidence &&
        hasStrongEvidenceQuality &&
        hasStrongNlpConfidence
        ? 'HIGH'
        : 'MEDIUM';

    const pilotValidationRequired =
      !selectionEligible || confidence !== 'HIGH' || !localEvidenceAvailable;

    return {
      status: selectionEligible ? 'SUPPORTED' : 'PRELIMINARY',
      confidence,
      pilotValidationRequired,
      strictEvidenceGatePassed: selectionEligible,
      opportunityEvidenceScore:
        finalScore === null ? null : Math.round(finalScore * 10_000) / 100,
      evidenceReliability:
        reliability === null ? null : Math.round(reliability * 10_000) / 100,
      evidenceQuality:
        evidenceScore === null
          ? null
          : Math.round(evidenceScore * 10_000) / 100,
      finalEvidenceConfidence:
        nlpConfidence === null
          ? null
          : Math.round(nlpConfidence * 10_000) / 100,
      directEvidenceCount: evidenceSamples.length,
      localEvidenceAvailable,
      disqualificationReasons: Array.isArray(selected.disqualificationReasons)
        ? selected.disqualificationReasons.filter(
          (reason): reason is string => typeof reason === 'string',
        )
        : [],
      message: !selectionEligible
        ? 'The idea is a preliminary pilot hypothesis because no opportunity passed the strict evidence gate after bounded recovery.'
        : pilotValidationRequired
          ? 'The opportunity passed the strict gate, but independent or local pilot validation is still required because the supporting evidence is limited.'
          : 'The selected opportunity passed the strict evidence gate with repeated, high-quality support.',
    } as const;
  }

  /**
   * Separates deterministic base NLP metrics from later community-AI
   * enrichment so clients never need to infer the meaning of legacy fields.
   */
  private buildNlpConfidenceSummary(
    baseConfidence: number | null,
    baseAiUsed: boolean,
    contextSnapshot: Prisma.JsonValue | null | undefined,
  ) {
    const snapshot = this.readSnapshotRecord(contextSnapshot);
    const snapshotNlp = this.readSnapshotRecord(
      snapshot?.nlp as Prisma.JsonValue | undefined,
    );
    const enrichedConfidence =
      typeof snapshotNlp?.confidence === 'number'
        ? snapshotNlp.confidence
        : null;
    const communityAiUsed = snapshot?.communityAiAnalysis != null;

    return {
      baseAnalysisMode: baseAiUsed ? 'AI_ENHANCED' : 'RULE_BASED',
      baseNlpConfidence: baseConfidence,
      perTextAiEnhancementUsed: baseAiUsed,
      communityAiAnalysisUsed: communityAiUsed,
      finalEvidenceConfidence: enrichedConfidence,
      /** @deprecated Use finalEvidenceConfidence. */
      enrichedNlpConfidence: enrichedConfidence,
    } as const;
  }

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
        ['title', 'problemStatement', 'partialAbstract'],
        query.search,
      ) ?? {}),

      ...(buildExactFilter('domainId', query.domainId) ?? {}),

      ...(buildExactFilter('generationType', query.generationType) ?? {}),

      ...(buildExactFilter('isUnlocked', query.isUnlocked) ?? {}),

      ...(buildExactFilter('unlockMethod', query.unlockMethod) ?? {}),
    };
  }

  /**
   * Retrieves ideas belonging to the authenticated user.
   *
   * List results intentionally contain summary data only.
   * Complete details are retrieved through getMyIdeaById.
   */
  async getMyIdeas(userId: string, query: GetUserIdeasQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildUserIdeasWhere(userId, query);

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

    const [user, ideas, total] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { accountStatus: true },
      }),

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
              status: GeneratedOutputStatus.COMPLETED,
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
              favorites: true,
            },
          },
        },
      }),

      this.prisma.idea.count({
        where,
      }),
    ]);

    const canUseAiChat = user.accountStatus === AccountStatus.PREMIUM;

    const data = ideas.map((idea) => ({
      ...idea,

      /**
       * Do not expose advanced-output metadata for locked ideas.
       */
      generatedOutputs: idea.isUnlocked ? idea.generatedOutputs : [],

      isFavorite: idea._count.favorites > 0,

      access: {
        canViewAdvancedOutputs: idea.isUnlocked,
        canUseAiChat: idea.isUnlocked && canUseAiChat,
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
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves a complete user-facing representation
   * of one user-owned idea.
   */
  async getMyIdeaById(userId: string, ideaId: string) {
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

        /*
         * The idea is already scoped to the authenticated owner. Select only
         * the owner's current account status so response access flags remain
         * consistent with the central AI Chat authorization service.
         */
        user: {
          select: {
            accountStatus: true,
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
            contextSnapshot: true,

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

            benchmarkCandidates: {
              orderBy: [
                { selected: 'desc' },
                { finalScore: 'desc' },
                { overallScore: 'desc' },
                { responseTimeMs: 'asc' },
              ],
              select: IDEA_BENCHMARK_CANDIDATE_SELECT,
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
            favorites: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException('Idea not found.');
    }

    const advancedAccess = idea.isUnlocked;
    const benchmarkCandidates =
      advancedAccess && idea.generationRun
        ? idea.generationRun.benchmarkCandidates.map(mapIdeaBenchmarkCandidate)
        : [];
    const generationRun = idea.generationRun
      ? {
        ...idea.generationRun,
        benchmarkCandidates,
        benchmarkSummary: buildIdeaBenchmarkSummary(benchmarkCandidates),
      }
      : null;

    const contextSnapshot = idea.generationRun?.contextSnapshot ?? null;
    const evidenceAssessment = this.buildEvidenceAssessment(contextSnapshot);
    const baseNlpConfidence =
      idea.collectionJob?.nlpAnalysis?.confidence?.toNumber() ?? null;
    const nlpConfidenceSummary = this.buildNlpConfidenceSummary(
      baseNlpConfidence,
      idea.collectionJob?.nlpAnalysis?.aiUsed ?? false,
      contextSnapshot,
    );

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
      fullAbstract: advancedAccess ? idea.fullAbstract : null,

      problemStatement: idea.problemStatement,
      objectives: idea.objectives,
      targetUsers: idea.targetUsers,

      commentsCount: advancedAccess ? idea.commentsCount : undefined,

      generationRun,

      evidenceAssessment: advancedAccess ? evidenceAssessment : null,

      /**
       * Collection metadata may be shown in a limited form
       * for locked ideas, but NLP evidence and sample data
       * are protected advanced features.
       */
      collection: idea.collectionJob
        ? {
          id: idea.collectionJob.id,
          country: idea.collectionJob.country,
          city: idea.collectionJob.city,
          region: idea.collectionJob.region,
          language: idea.collectionJob.language,

          dataSources: idea.collectionJob.sources.map((source) => ({
            key: source.dataSource.key,

            displayName: source.dataSource.displayName,

            status: source.status,

            totalPosts: advancedAccess ? source.totalPosts : undefined,

            totalComments: advancedAccess ? source.totalComments : undefined,
          })),

          totalPosts: advancedAccess
            ? idea.collectionJob.totalPosts
            : undefined,

          totalComments: advancedAccess
            ? idea.collectionJob.totalComments
            : undefined,

          nlpAnalysis:
            advancedAccess && idea.collectionJob.nlpAnalysis
              ? {
                ...idea.collectionJob.nlpAnalysis,
                samplePosts: this.sanitizeEvidenceSamples(
                  idea.collectionJob.nlpAnalysis.samplePosts,
                  'POST',
                ),
                sampleComments: this.sanitizeEvidenceSamples(
                  idea.collectionJob.nlpAnalysis.sampleComments,
                  'COMMENT',
                ),
                confidence: baseNlpConfidence,
                confidenceSummary: nlpConfidenceSummary,
              }
              : null,
        }
        : null,

      generatedOutputs: advancedAccess ? idea.generatedOutputs : [],

      publication: idea.publication,

      isFavorite: idea._count.favorites > 0,

      access: {
        canViewAdvancedOutputs: advancedAccess,

        canViewFullAbstract: advancedAccess,

        canViewCommunityData: advancedAccess,

        canViewNlpAnalysis: advancedAccess,

        canUseAiChat:
          advancedAccess && idea.user?.accountStatus === AccountStatus.PREMIUM,

        canPublish: true,

        requiresDirectUnlock: !advancedAccess,
      },

      counts: {
        chatSessions: advancedAccess ? idea._count.chatSessions : 0,

        generatedOutputs: advancedAccess ? idea._count.generatedOutputs : 0,

        payments: idea._count.payments,
      },

      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
    };
  }

  /**
   * Sanitizes persisted representative evidence at the API boundary.
   *
   * Older analyses may contain store descriptions, repository RFCs, or broad
   * conversation that was persisted before stricter extraction rules existed.
   * This method changes display output only; it does not delete source records,
   * rewrite NLP metrics, or alter opportunity ranking.
   */
  private sanitizeEvidenceSamples(
    value: unknown,
    sourceType: 'POST' | 'COMMENT',
  ): unknown[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is Record<string, unknown> => this.isRecord(item))
      .filter((item) => {
        const text = typeof item.text === 'string' ? item.text : '';
        return this.isUsefulEvidencePreview(text, sourceType);
      })
      .slice(0, 5);
  }

  /** Keeps only user-observed software evidence in the Evidence-tab preview. */
  private isUsefulEvidencePreview(
    text: string,
    sourceType: 'POST' | 'COMMENT',
  ): boolean {
    const normalized = text.replace(/\s+/gu, ' ').trim().toLowerCase();

    if (normalized.length < 20) {
      return false;
    }

    const softwareNeedSignal =
      /\b(?:cannot|can't|unable|blocked|missing|unavailable|error|fails?|failed|broken|bug|crash|timeout|slow|does not|doesn't|should|need|request|feature|paywall|subscription|login|authentication|sync|storage|interface|ui|website|app|document|transcript|subject|category|configuration)\b/iu.test(
        normalized,
      );

    if (!softwareNeedSignal) {
      return false;
    }

    const unrelatedConversation =
      /\b(?:love from|invite you|my country|mam |congratulations|beautiful speech|god bless|thank you for this video)\b/iu.test(
        normalized,
      ) &&
      !/\b(?:app|software|platform|website|login|error|feature|subscription|storage|sync)\b/iu.test(
        normalized,
      );

    if (unrelatedConversation) {
      return false;
    }

    if (sourceType === 'POST') {
      const promotionalOrBlueprint =
        normalized.length > 250 &&
        /\b(?:welcome to|all-in-one|download|app features|main features|award-winning|our mission|our goal|designed to|rfc|proposal|what i'?m proposing|implementation|roadmap|pilot centered)\b/iu.test(
          normalized,
        );

      if (promotionalOrBlueprint) {
        return false;
      }
    }

    return true;
  }

  /** Type guard used by evidence-preview sanitization. */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      throw new NotFoundException('Idea not found.');
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
          collectionJobId: idea.collectionJobId,

          ...(query.dataSourceKey
            ? {
              dataSource: {
                is: {
                  key: query.dataSourceKey,
                },
              },
            }
            : {}),
        },
      },

      ...(query.sentiment
        ? {
          sentiment: {
            equals: query.sentiment,
            mode: Prisma.QueryMode.insensitive,
          },
        }
        : {}),

      ...(query.languageCode
        ? {
          languageCode: {
            equals: query.languageCode,
            mode: Prisma.QueryMode.insensitive,
          },
        }
        : {}),
    };

    const [comments, total] = await Promise.all([
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
        totalPages: calculateTotalPages(total, limit),
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
  async deleteMyIdea(userId: string, ideaId: string) {
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
      throw new NotFoundException('Idea not found.');
    }

    if (idea.publication?.status === 'PUBLISHED') {
      throw new ForbiddenException(
        'Archive the published idea before deleting it.',
      );
    }

    const deletedAt = new Date();

    await this.prisma.$transaction(async (transaction) => {
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
              idea.publication.status === 'ARCHIVED' ? undefined : deletedAt,
          },
        });
      }
    });

    await this.cacheManager.del(userCacheKeys.summary(userId));

    return {
      message: 'Idea deleted successfully.',
    };
  }
}