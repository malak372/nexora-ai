import { Injectable } from '@nestjs/common';

import {
  GeneratedOutputType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { UserPermissionsService } from '../../users/permissions/permissions.service';
import { UserValidationService } from '../../users/validation/validation.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { GetUserIdeasQueryDto } from '../dto/get-user-ideas-query.dto';

/**
 * Service responsible for retrieving project ideas generated
 * by the authenticated user.
 *
 * Applies Nexora AI access rules:
 * - Free registered-user ideas expose basic information only.
 * - Locked ideas do not expose advanced outputs.
 * - Directly unlocked ideas expose advanced outputs.
 * - Premium credit-generated ideas expose advanced outputs.
 *
 * Supports:
 * - Pagination.
 * - Searching.
 * - Date filtering.
 * - Sorting.
 * - Filtering by generation type.
 * - Filtering by unlock status.
 * - Filtering by domain.
 * - Filtering by selected platform.
 * - Access-aware response formatting.
 *
 * @author Eman
 */
@Injectable()
export class UserIdeasService {
  /**
   * Advanced output types visible only for ideas that
   * have advanced-feature access.
   */
  private readonly advancedOutputTypes:
    GeneratedOutputType[] = [
      GeneratedOutputType.FULL_ABSTRACT,
      GeneratedOutputType.TECHNOLOGY_STACK,
      GeneratedOutputType.SYSTEM_ARCHITECTURE,
      GeneratedOutputType.DATABASE_DESIGN,
      GeneratedOutputType.COMMENT_ANALYSIS,
      GeneratedOutputType.SAMPLE_COMMENTS,
      GeneratedOutputType.NLP_ANALYSIS,
      GeneratedOutputType.RECURRING_PROBLEMS,
      GeneratedOutputType.EXTRACTED_KEYWORDS,
      GeneratedOutputType.LOCAL_REGULATIONS,
      GeneratedOutputType.BUDGET_ESTIMATION,
      GeneratedOutputType.BUSINESS_MODEL,
      GeneratedOutputType.TARGET_USERS,
      GeneratedOutputType.VALUE_PROPOSITION,
      GeneratedOutputType.REVENUE_MODEL,
      GeneratedOutputType.FEASIBILITY_ASSESSMENT,
      GeneratedOutputType.IMPLEMENTATION_TIMELINE,
      GeneratedOutputType.MARKET_POTENTIAL,
    ];

  constructor(
    private readonly prisma: PrismaService,

    private readonly userValidationService:
      UserValidationService,

    private readonly userPermissionsService:
      UserPermissionsService,
  ) {}

  /**
   * Retrieves generated ideas belonging to the
   * authenticated user.
   *
   * Basic information is always returned:
   * - Title.
   * - Problem statement.
   * - Objectives.
   * - Target users.
   * - Partial abstract.
   *
   * Advanced information is returned only when:
   * - The idea is unlocked through direct payment.
   * - The idea was generated using premium credits.
   */
  async getGeneratedIdeas(
    userId: string,
    query: GetUserIdeasQueryDto,
  ) {
    await this.userValidationService
      .findUserOrThrow(userId);

    const {
      page,
      limit,
      skip,
      take,
    } = buildPagination(query);

    const where: Prisma.IdeaWhereInput = {
      userId,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(
        [
          'title',
          'problemStatement',
          'objectives',
          'targetUsers',
          'partialAbstract',
        ],
        query.search,
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
        'domainId',
        query.domainId,
      ) ?? {}),

      ...(buildExactFilter(
        'selectedPlatformId',
        query.selectedPlatformId,
      ) ?? {}),
    };

    const orderBy = buildOrderBy(
      query,
      [
        'createdAt',
        'title',
        'generationType',
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

          problemStatement: true,
          objectives: true,
          targetUsers: true,
          partialAbstract: true,
          fullAbstract: true,

          generationType: true,
          isUnlocked: true,
          unlockMethod: true,
          unlockedAt: true,

          commentsCount: true,
          selectedRegion: true,
          createdAt: true,
          updatedAt: true,

          domain: true,
          selectedPlatform: true,

          generatedOutputs: {
            where: {
              outputType: {
                in: this.advancedOutputTypes,
              },
            },

            select: {
              id: true,
              outputType: true,
              content: true,
              createdAt: true,
            },

            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      }),

      this.prisma.idea.count({
        where,
      }),
    ]);

    const safeIdeas = ideas.map((idea) => {
      const canViewAdvanced =
        this.userPermissionsService
          .canViewAdvancedFeatures(idea);

      return {
        id: idea.id,
        title: idea.title,

        problemStatement:
          idea.problemStatement,

        objectives:
          idea.objectives,

        targetUsers:
          idea.targetUsers,

        partialAbstract:
          idea.partialAbstract,

        fullAbstract:
          canViewAdvanced
            ? idea.fullAbstract
            : null,

        generationType:
          idea.generationType,

        isUnlocked:
          idea.isUnlocked,

        unlockMethod:
          idea.unlockMethod,

        unlockedAt:
          idea.unlockedAt,

        commentsCount:
          canViewAdvanced
            ? idea.commentsCount
            : null,

        selectedRegion:
          idea.selectedRegion,

        domain:
          idea.domain,

        selectedPlatform:
          idea.selectedPlatform,

        createdAt:
          idea.createdAt,

        updatedAt:
          idea.updatedAt,

        access: {
          canViewAdvancedFeatures:
            canViewAdvanced,

          canViewFullAbstract:
            this.userPermissionsService
              .canViewFullAbstract(idea),

          canOpenAiChat:
            this.userPermissionsService
              .canOpenAiChat(idea),

          canViewCommentAnalysis:
            this.userPermissionsService
              .canViewCommentAnalysis(idea),

          canViewArchitecture:
            this.userPermissionsService
              .canViewArchitecture(idea),

          canViewDatabaseDesign:
            this.userPermissionsService
              .canViewDatabaseDesign(idea),

          canViewTechnologies:
            this.userPermissionsService
              .canViewTechnologies(idea),

          canViewBusinessModel:
            this.userPermissionsService
              .canViewBusinessModel(idea),

          canViewBudget:
            this.userPermissionsService
              .canViewBudget(idea),

          canViewTimeline:
            this.userPermissionsService
              .canViewTimeline(idea),

          canViewFeasibility:
            this.userPermissionsService
              .canViewFeasibility(idea),
        },

        advancedOutputs:
          canViewAdvanced
            ? idea.generatedOutputs
            : [],
      };
    });

    return {
      data: safeIdeas,

      meta: {
        total,
        page,
        limit,
        totalPages:
          Math.ceil(total / limit),
      },
    };
  }
}