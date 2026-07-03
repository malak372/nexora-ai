import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetUserIdeasQueryDto } from './dto/get-user-ideas-query.dto';
import { UserValidationService } from '../validation/Validation.service';

import {
    buildDateFilter,
    buildExactFilter,
    buildOrderBy,
    buildPagination,
    buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for retrieving ideas generated
 * by the authenticated user.
 *
 * Features:
 * - Pagination.
 * - Searching.
 * - Date filtering.
 * - Sorting.
 * - Filtering by generation type, unlock status,
 *   domain, and selected platform.
 *
 * Business rule:
 * Advanced idea content is only returned for
 * unlocked ideas. Locked ideas expose only
 * the partial abstract.
 *
 * Uses UserValidationService for shared
 * user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserIdeasService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
    ) { }

    /**
     * Retrieves the authenticated user's generated ideas.
     *
     * Supports:
     * - Pagination.
     * - Searching.
     * - Date filtering.
     * - Sorting.
     * - Filtering by generation type.
     * - Filtering by unlock status.
     * - Filtering by selected domain.
     * - Filtering by selected platform.
     *
     * Locked ideas expose only the partial abstract,
     * while unlocked ideas expose the full abstract.
     *
     * @param userId Authenticated user ID.
     * @param query Query parameters.
     *
     * @returns Paginated generated ideas.
     *
     * @throws NotFoundException if the user does not exist.
     */
    async getGeneratedIdeas(
        userId: string,
        query: GetUserIdeasQueryDto,
    ) {
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
            ...buildExactFilter(
                'selectedPlatformId',
                query.selectedPlatformId,
            ),
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

            this.prisma.idea.count({
                where,
            }),
        ]);

        /**
         * Hide advanced content for locked ideas.
         */
        const safeIdeas = ideas.map((idea) => ({
            ...idea,
            fullAbstract: idea.isUnlocked ? idea.fullAbstract : null,
        }));

        return {
            data: safeIdeas,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}