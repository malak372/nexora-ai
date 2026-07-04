import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/validation.service';
import { UpsertIdeaFeedbackDto } from './dto/upsert-idea-feedback.dto';

/**
 * Service responsible for authenticated user idea feedback operations.
 *
 * Feedback allows users to rate generated ideas and optionally leave
 * comments about their usefulness or quality.
 *
 * This supports Nexora AI by:
 * - Measuring idea quality.
 * - Helping admins identify strong and weak generated ideas.
 * - Providing future signals for improving prompt design and recommendations.
 *
 * Security rules:
 * - Users can only submit feedback for ideas they own.
 * - Each user can have one feedback record per idea.
 * - Submitting feedback again updates the existing feedback record.
 *
 * @author Eman
 */
@Injectable()
export class UserFeedbackService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
    ) { }

    /**
     * Creates or updates feedback for an owned idea.
     *
     * @param userId - Authenticated user ID.
     * @param ideaId - Idea ID owned by the authenticated user.
     * @param dto - Rating and optional comment.
     * @returns Created or updated feedback record.
     *
     * @throws NotFoundException if the user does not exist.
     * @throws NotFoundException if the idea does not belong to the user.
     */
    async upsertFeedback(
        userId: string,
        ideaId: string,
        dto: UpsertIdeaFeedbackDto,
    ) {
        await this.userCommonService.findUserOrThrow(userId);

        const idea = await this.prisma.idea.findFirst({
            where: {
                id: ideaId,
                userId,
            },
            select: {
                id: true,
                title: true,
            },
        });

        if (!idea) {
            throw new NotFoundException('Idea not found');
        }

        return this.prisma.ideaFeedback.upsert({
            where: {
                userId_ideaId: {
                    userId,
                    ideaId,
                },
            },
            update: {
                rating: dto.rating,
                comment: dto.comment,
            },
            create: {
                userId,
                ideaId,
                rating: dto.rating,
                comment: dto.comment,
            },
            select: {
                id: true,
                rating: true,
                comment: true,
                createdAt: true,
                updatedAt: true,
                idea: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
            },
        });
    }

    /**
     * Retrieves the authenticated user's feedback for a specific owned idea.
     *
     * @param userId - Authenticated user ID.
     * @param ideaId - Idea ID owned by the authenticated user.
     * @returns Feedback record or null if feedback was not submitted yet.
     *
     * @throws NotFoundException if the user does not exist.
     * @throws NotFoundException if the idea does not belong to the user.
     */
    async getFeedbackByIdea(userId: string, ideaId: string) {
        await this.userCommonService.findUserOrThrow(userId);

        const idea = await this.prisma.idea.findFirst({
            where: {
                id: ideaId,
                userId,
            },
            select: {
                id: true,
                title: true,
            },
        });

        if (!idea) {
            throw new NotFoundException('Idea not found');
        }

        return this.prisma.ideaFeedback.findUnique({
            where: {
                userId_ideaId: {
                    userId,
                    ideaId,
                },
            },
            select: {
                id: true,
                rating: true,
                comment: true,
                createdAt: true,
                updatedAt: true,
                idea: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
            },
        });
    }

    /**
     * Retrieves all feedback submitted by the authenticated user.
     */
    async getMyFeedback(userId: string) {
        await this.userCommonService.findUserOrThrow(userId);

        return this.prisma.ideaFeedback.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                rating: true,
                comment: true,
                createdAt: true,
                updatedAt: true,
                idea: {
                    select: {
                        id: true,
                        title: true,
                        generationType: true,
                        isUnlocked: true,
                        createdAt: true,
                    },
                },
            },
        });
    }
}