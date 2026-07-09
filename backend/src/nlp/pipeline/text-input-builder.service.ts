import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { IntelligentTextInput } from './types/intelligent-analysis.types';

/**
 * Builds unified NLP text inputs from a collection job.
 *
 * This service is the first real step in the Intelligent NLP Engine.
 * It loads the selected CollectionJob with its domain, posts, and comments,
 * then converts all collected posts/comments into one normalized input format.
 *
 * Responsibilities:
 * - Load CollectionJob data.
 * - Include domain context.
 * - Convert SocialPost records into NLP text inputs.
 * - Convert SocialComment records into NLP text inputs.
 * - Preserve metadata such as language, likes, replies, and parent post ID.
 *
 * This service does not clean text, detect language, analyze sentiment,
 * or extract keywords. These steps are handled by later NLP services.
 *
 * @author Eman
 */
@Injectable()
export class TextInputBuilderService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Loads a collection job and converts its posts and comments into
     * unified IntelligentTextInput objects.
     *
     * @param collectionJobId Collection job ID to prepare for NLP analysis.
     * @returns Collection job context and unified text inputs.
     */
    async build(collectionJobId: string): Promise<{
        collectionJobId: string;
        domain: {
            id: string;
            name: string;
            keywords: string[];
        };
        location: {
            country: string;
            city?: string | null;
            region?: string | null;
        };
        platforms: string[];
        inputs: IntelligentTextInput[];
    }> {
        const collectionJob = await this.prisma.collectionJob.findUnique({
            where: { id: collectionJobId },
            include: {
                domain: {
                    include: {
                        domainKeywords: true,
                    },
                },
                posts: {
                    include: {
                        platform: true,
                        comments: true,
                    },
                },
            },
        });

        if (!collectionJob) {
            throw new NotFoundException('Collection job not found.');
        }

        const postInputs = collectionJob.posts.map((post): IntelligentTextInput => {
            return {
                id: post.id,
                sourceType: 'POST',
                title: post.title,
                content: this.mergePostTitleAndContent(post.title, post.content),
                language: post.language,
                likesCount: post.likesCount,
                repliesCount: post.repliesCount,
            };
        });

        const commentInputs = collectionJob.posts.flatMap((post) =>
            post.comments.map((comment): IntelligentTextInput => {
                return {
                    id: comment.id,
                    sourceType: 'COMMENT',
                    postId: post.id,
                    content: comment.content,
                    language: comment.language,
                    likesCount: comment.likesCount,
                };
            }),
        );

        const platforms = this.extractPlatformNames(collectionJob.posts);

        const domainKeywords = collectionJob.domain.domainKeywords.map(
            (keyword) => keyword.keyword,
        );

        return {
            collectionJobId: collectionJob.id,
            domain: {
                id: collectionJob.domain.id,
                name: collectionJob.domain.name,
                keywords: domainKeywords,
            },
            location: {
                country: collectionJob.country,
                city: collectionJob.city,
                region: collectionJob.region,
            },
            platforms,
            inputs: [...postInputs, ...commentInputs],
        };
    }

    /**
     * Merges post title and content to give the NLP engine better context.
     *
     * @param title Optional post title.
     * @param content Post body/content.
     * @returns Combined post text.
     */
    private mergePostTitleAndContent(
        title: string | null,
        content: string,
    ): string {
        return [title, content].filter(Boolean).join(' ');
    }

    /**
     * Extracts unique platform names from collected posts.
     *
     * Falls back to source type when platform relation is missing.
     *
     * @param posts Collection job posts.
     * @returns Unique platform/source names.
     */
    private extractPlatformNames(
        posts: {
            sourceType: string;
            platform?: {
                name: string;
            } | null;
        }[],
    ): string[] {
        return [
            ...new Set(
                posts.map((post) => post.platform?.name ?? post.sourceType),
            ),
        ];
    }
}