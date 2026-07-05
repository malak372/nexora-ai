import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionSourceType } from '@prisma/client';

import { BaseCollector } from '../../base/base.collector';
import {
    CollectorInput,
    CollectorPost,
    CollectorComment,
} from '../../base/collector.types';

import { CollectorHttpUtil } from '../../base/collector-http.util';
import { CollectorCacheUtil } from '../../base/collector-cache.util';
import { CollectorHeaderUtil } from '../../base/collector-header.util';

import { ForumAdapter } from './forum-adapter.interface';

/**
 * Adapter for Discourse-based forums.
 *
 * Uses public Discourse JSON endpoints:
 * - /search.json
 * - /t/{topicId}.json
 *
 * @author Malak
 */
@Injectable()
export class DiscourseForumAdapter
    extends BaseCollector
    implements ForumAdapter {
    readonly sourceType = CollectionSourceType.FORUM;
    readonly engineName = 'Discourse';

    private readonly platformName = 'Forum';

    constructor(configService: ConfigService) {
        super(configService, DiscourseForumAdapter.name);
    }

    async collect(
        forumUrl: string,
        searchQuery: string,
        input: CollectorInput,
    ): Promise<CollectorPost[]> {
        try {
            const cacheKey = CollectorCacheUtil.build('forum', 'discourse-search', [
                forumUrl,
                searchQuery,
                input.country,
                input.language,
            ]);

            const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
                `${forumUrl}/search.json`,
                {
                    headers: this.buildHeaders(),
                    params: {
                        q: searchQuery,
                    },
                    timeout: 10000,
                },
                {
                    cacheKey,
                    cacheTtlMs: this.cacheTtlMs,
                    retryAttempts: this.retryAttempts,
                    retryDelayMs: this.retryDelayMs,
                },
            );

            const topics = data?.topics ?? [];
            const searchPosts = data?.posts ?? [];

            const validTopics = topics
                .filter((topic: any) => this.isValidTopic(topic))
                .slice(0, Math.min(this.maxFetchedPosts, 5));

            const posts: CollectorPost[] = [];

            for (const topic of validTopics) {
                const post = await this.mapTopicToCollectorPost(
                    topic,
                    searchPosts,
                    forumUrl,
                    input,
                );

                posts.push(post);
            }

            return posts;
        } catch (error: any) {
            this.logger.warn(
                `Discourse forum skipped: ${forumUrl} - ${error.response?.status ?? error?.message ?? error
                }`,
            );

            return [];
        }
    }

    private async mapTopicToCollectorPost(
        topic: any,
        searchPosts: any[],
        forumUrl: string,
        input: CollectorInput,
    ): Promise<CollectorPost> {
        const matchedPost = searchPosts.find(
            (post: any) => post?.topic_id === topic?.id,
        );

        const comments = await this.collectTopicReplies(forumUrl, topic.id);

        return {
            sourceType: CollectionSourceType.FORUM,
            platformName: `${this.platformName} - ${this.engineName}`,
            externalId: topic.id.toString(),
            title: topic.title,
            content: this.stripHtml(
                matchedPost?.blurb ?? matchedPost?.excerpt ?? topic.title ?? '',
            ),
            author: topic.last_poster_username ?? matchedPost?.username,
            url: `${forumUrl}/t/${topic.slug}/${topic.id}`,

            country: input.country,
            city: input.city,
            region: input.region,

            language: input.language,
            likesCount: topic.like_count ?? 0,
            repliesCount: comments.length,
            publishedAt: topic.created_at ? new Date(topic.created_at) : undefined,
            comments,
        };
    }

    private async collectTopicReplies(
        forumUrl: string,
        topicId: number,
    ): Promise<CollectorComment[]> {
        try {
            const cacheKey = CollectorCacheUtil.build('forum', 'discourse-replies', [
                forumUrl,
                topicId,
            ]);

            const data = await CollectorHttpUtil.getWithRetryAndCache<any>(
                `${forumUrl}/t/${topicId}.json`,
                {
                    headers: this.buildHeaders(),
                    timeout: 10000,
                },
                {
                    cacheKey,
                    cacheTtlMs: this.cacheTtlMs,
                    retryAttempts: this.retryAttempts,
                    retryDelayMs: this.retryDelayMs,
                },
            );

            const topicPosts = data?.post_stream?.posts ?? [];
            const seenCommentIds = new Set<string>();

            return topicPosts
                .filter((post: any) => this.isUsefulReply(post))
                .filter((post: any) => {
                    const id = post?.id?.toString();

                    if (!id || seenCommentIds.has(id)) return false;

                    seenCommentIds.add(id);
                    return true;
                })
                .slice(0, this.maxSavedComments)
                .map((post: any): CollectorComment => ({
                    externalId: post.id.toString(),
                    content: this.stripHtml(post.cooked ?? post.excerpt ?? ''),
                    author: post.username,
                    likesCount: post.like_count ?? 0,
                    publishedAt: post.created_at ? new Date(post.created_at) : undefined,
                }));
        } catch (error: any) {
            this.logger.warn(
                `Failed to collect Discourse replies for topic ${topicId}`,
                error?.message ?? error,
            );

            return [];
        }
    }

    private isValidTopic(topic: any): boolean {
        const title = this.normalizeText(topic?.title ?? '');

        if (!topic?.id || !topic?.slug || !title) return false;

        const blockedWords = this.getBlockedWords();

        return !blockedWords.some((word) => title.includes(word));
    }

    private isUsefulReply(post: any): boolean {
        const content = this.normalizeText(
            this.stripHtml(post?.cooked ?? post?.excerpt ?? ''),
        );

        if (!post?.id || content.length < 30) {
            return false;
        }

        const cleaned = content.replace(/[^\p{L}\p{N}\s+]/gu, '').trim();

        if (!cleaned) {
            return false;
        }

        const author = this.normalizeText(post?.username ?? '');

        if (author === 'system') {
            return false;
        }

        const lowValueReplies = new Set([
            'thanks',
            'thank you',
            'great',
            'good',
            'awesome',
            'nice',
            'same',
            'me too',
            '+1',
            'fixed',
            'works',
            'solved',
        ]);

        if (lowValueReplies.has(content)) {
            return false;
        }

        const blockedWords = this.getBlockedWords();

        return !blockedWords.some((word) => content.includes(word));
    }

    protected getBlockedWords(): string[] {
        return super.getBlockedWords('FORUM_BLOCKED_WORDS');
    }

    private buildHeaders(): Record<string, string> {
        return {
            ...CollectorHeaderUtil.json(),
            'User-Agent': 'NexoraAI/1.0.0 academic-project',
        };
    }
}