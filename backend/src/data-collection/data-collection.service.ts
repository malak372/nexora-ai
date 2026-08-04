import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  CollectionJobStatus,
  DomainResolutionSource,
  LanguageCode,
} from '@prisma/client';

import { AuditService } from '../audit-logs/audit-logs.service';

import { CollectorQueueService } from '../collectors/base/collector-queue.service';

import {
  CollectorInput,
  CollectorPost,
} from '../collectors/base/collector.types';

import { RelevanceScoreUtil } from '../collectors/base/relevance-score.util';

import { CollectorsFactory } from '../collectors/collectors.factory';

import { CollectionJobService } from './collection-jobs/collection-job.service';

import { GetCollectionJobsQueryDto } from './collection-jobs/dto/get-collection-jobs-query.dto';

import { RunCollectionDto } from './dto/run-collection.dto';

import { GetSocialCommentsQueryDto } from './social-comments/dto/get-social-comments-query.dto';

import { SocialCommentService } from './social-comments/social-comment.service';

import { GetSocialPostsQueryDto } from './social-posts/dto/get-social-posts-query.dto';

import { SocialPostService } from './social-posts/social-post.service';

import { CollectionAccessContext } from './types/collection-access-context.type';

/**
 * Input used when the idea-generation pipeline
 * starts Data Collection internally.
 */
export type IdeaGenerationCollectionInput = {
  /**
   * Authenticated user who owns the generated job.
   *
   * Undefined is allowed for guest or system jobs.
   */
  readonly userId?: string;

  readonly domainId: string;
  readonly domainResolutionSource?: DomainResolutionSource;
  readonly domainResolutionConfidence?: number;
  readonly userDescription?: string;

  readonly country?: string;
  readonly city?: string;
  readonly region?: string;

  readonly language: LanguageCode;

  readonly radiusKm?: number;

  /**
   * Selected DataSource.key values.
   */
  readonly dataSourceKeys?: string[];

  readonly keywords?: string[];

  readonly collectionMode?: CollectorInput['collectionMode'];
  readonly collectorLimits?: CollectorInput['limits'];
};

/**
 * Identifies how Data Collection was started.
 */
type CollectionTrigger = 'USER_MANUAL' | 'SYSTEM_INTERNAL';

/**
 * Main orchestration service for the Data Collection pipeline.
 *
 * Important behavior:
 * - Persists collection-job ownership directly.
 * - Continues running after one source fails.
 * - Fails the parent job only when every source fails.
 * - Checks stop requests before and after external collection.
 * - Enforces user ownership when reading data.
 *
 * @author Malak
 */
@Injectable()
export class DataCollectionService {
  /**
   * Service logger used for centralized relevance diagnostics.
   */
  private readonly logger = new Logger(DataCollectionService.name);

  /**
   * Minimum relevance score required before a collected post is persisted.
   *
   * A score of 50 keeps the centralized filter strict enough to reject weak
   * results while still allowing strong title, body, or source-tag matches.
   */
  private readonly MIN_RELEVANCE_SCORE = 50;

  /**
   * Additional score granted when a source-provided tag exactly matches one
   * of the normalized domain or user relevance terms.
   *
   * This is especially useful for platforms such as DEV.to, where the source
   * API already classifies articles under meaningful tags.
   */
  private readonly EXACT_SOURCE_TAG_MATCH_BONUS = 10;

  /**
   * Reserved domain name representing all domains.
   */
  private readonly GENERAL_DOMAIN_NAME = 'general';

  constructor(
    private readonly collectionJobService: CollectionJobService,

    private readonly socialPostService: SocialPostService,

    private readonly socialCommentService: SocialCommentService,

    private readonly collectorsFactory: CollectorsFactory,

    private readonly collectorQueueService: CollectorQueueService,

    private readonly auditService: AuditService,
  ) {}

  /**
   * Starts Data Collection manually for
   * an authenticated user or administrator.
   */
  run(dto: RunCollectionDto, userId: string) {
    return this.runInternal(dto, 'USER_MANUAL', userId);
  }

  /**
   * Starts Data Collection internally as part
   * of the idea-generation workflow.
   */
  runForIdeaGeneration(dto: IdeaGenerationCollectionInput) {
    return this.runInternal(dto, 'SYSTEM_INTERNAL', dto.userId);
  }

  /**
   * Executes the shared Data Collection workflow.
   */
  private async runInternal(
    dto: RunCollectionDto | IdeaGenerationCollectionInput,

    trigger: CollectionTrigger,

    actorId?: string,
  ) {
    const domain = await this.collectionJobService.validateActiveDomain(
      dto.domainId,
    );

    const dataSources =
      await this.collectionJobService.resolveActiveImplementedDataSources(
        dto.dataSourceKeys,
      );

    const isGeneralDomain = this.isGeneralDomain(domain.name);

    const domainKeywords = isGeneralDomain
      ? await this.collectionJobService.getAllActiveDomainKeywords(dto.language)
      : this.getDomainKeywordsByLanguage(domain.domainKeywords, dto.language);

    const userKeywords = this.unique(dto.keywords ?? []);

    const relevanceTerms = this.unique([
      ...(isGeneralDomain ? [] : [domain.name]),

      ...domainKeywords,
      ...userKeywords,
    ]);

    const job = await this.collectionJobService.createRunningJob(
      dto,
      dataSources,
      actorId,
    );

    await this.auditService.createLog({
      actorId,

      action: AuditAction.RUN_DATA_COLLECTION,

      targetType: AuditTargetType.DATA_COLLECTION,

      targetId: job.id,

      newValue: {
        trigger,

        domainId: dto.domainId,

        domainName: isGeneralDomain ? 'General / All Domains' : domain.name,

        dataSourceKeys: dataSources.map((source) => source.key),

        country: dto.country,

        city: dto.city,

        region: dto.region,

        language: dto.language,

        radiusKm: dto.radiusKm,

        domainKeywords,
        userKeywords,
      },
    });

    const collectionMode =
      'collectionMode' in dto ? dto.collectionMode : undefined;

    const collectorLimits =
      'collectorLimits' in dto ? dto.collectorLimits : undefined;

    let completedSources = 0;
    let failedSources = 0;

    try {
      const sourceResults = await Promise.all(
        dataSources.map(async (dataSource) => {
          /*
           * Every selected source is submitted immediately. CollectorQueueService
           * enforces COLLECTOR_QUEUE_CONCURRENCY, so this service can wait for the
           * whole collection job without serializing individual collectors.
           */
          if (await this.isStopped(job.id)) {
            return 'STOPPED' as const;
          }

          await this.collectionJobService.markSourceRunning(
            job.id,
            dataSource.id,
          );

          try {
            const collector = this.collectorsFactory.getCollector(
              dataSource.key,
            );

            const collectorInput: CollectorInput = {
              domainName: isGeneralDomain ? 'All Domains' : domain.name,
              domainKeywords,
              country: dto.country,
              city: dto.city,
              region: dto.region,
              language: dto.language,
              radiusKm: dto.radiusKm,
              keywords: userKeywords,
              collectionMode,
              limits: collectorLimits,
            };

            const posts = await this.collectorQueueService.run(
              () => collector.collect(collectorInput),
              {
                platform: dataSource.key,
                timeoutMs: collectionMode === 'FAST_GENERATION' ? 12_000 : undefined,
              },
            );

            /*
             * A collector may finish after an administrator stopped the job.
             * Do not persist late results in that case.
             */
            if (await this.isStopped(job.id)) {
              return 'STOPPED' as const;
            }

            const relevantPosts = this.filterRelevantPosts(
              posts,
              relevanceTerms,
            );

            const totals = await this.socialPostService.createManyWithComments(
              job.id,
              dataSource.id,
              {
                country: dto.country,
                city: dto.city,
                region: dto.region,
              },
              relevantPosts,
            );

            await this.collectionJobService.markSourceCompleted(
              job.id,
              dataSource.id,
              totals,
            );

            return 'COMPLETED' as const;
          } catch (error: unknown) {
            /*
             * A source may fail after some records were already persisted. Count
             * those rows before marking the source failed so source-level and
             * parent counters remain consistent with data consumed by NLP.
             */
            const persistedTotals =
              await this.socialPostService.countByCollectionJobSource(
                job.id,
                dataSource.id,
              );

            await this.collectionJobService.markSourceFailed(
              job.id,
              dataSource.id,
              error,
              persistedTotals,
            );

            return 'FAILED' as const;
          }
        }),
      );

      completedSources = sourceResults.filter(
        (result) => result === 'COMPLETED',
      ).length;
      failedSources = sourceResults.filter(
        (result) => result === 'FAILED',
      ).length;

      if (
        sourceResults.some((result) => result === 'STOPPED') ||
        (await this.isStopped(job.id))
      ) {
        await this.collectionJobService.markRemainingSourcesStopped(job.id);

        return this.collectionJobService.findJobOrThrow(job.id);
      }

      /*
       * The parent job fails only when every selected source
       * failed. A successful source returning zero posts is
       * still considered a successful source execution.
       */
      const authoritativeTotals =
        await this.collectionJobService.countPersistedJobData(job.id);

      if (completedSources === 0 && authoritativeTotals.totalPosts === 0) {
        throw new ServiceUnavailableException(
          'All selected data sources failed without persisting usable data.',
        );
      }

      const completedJob = await this.collectionJobService.completeJob(job.id);

      await this.auditService.createLog({
        actorId,

        action: AuditAction.COMPLETE_DATA_COLLECTION,

        targetType: AuditTargetType.DATA_COLLECTION,

        targetId: job.id,

        newValue: {
          trigger,

          status: CollectionJobStatus.COMPLETED,

          completedSources,
          failedSources,

          totalPosts: completedJob.totalPosts,
          totalComments: completedJob.totalComments,

          completedAt: completedJob.completedAt,
        },
      });

      return completedJob;
    } catch (error: unknown) {
      const latestJob = await this.collectionJobService.findJobOrThrow(job.id);

      /*
       * Do not overwrite a stopped job with FAILED.
       */
      if (latestJob.status === CollectionJobStatus.STOPPED) {
        return latestJob;
      }

      const failedJob = await this.collectionJobService.failJob(job.id, error);

      await this.auditService.createLog({
        actorId,

        action: AuditAction.FAIL_DATA_COLLECTION,

        targetType: AuditTargetType.DATA_COLLECTION,

        targetId: job.id,

        newValue: {
          trigger,

          status: CollectionJobStatus.FAILED,

          completedSources,
          failedSources,

          failedReason: this.getErrorMessage(error),

          completedAt: failedJob.completedAt,
        },
      });

      throw error;
    }
  }

  /**
   * Returns caller-scoped collection-job status together
   * with the shared queue and data-source state.
   */
  async getStatus(access: CollectionAccessContext) {
    return {
      service: 'Data Collection',

      available: true,

      queue: this.collectorQueueService.getStatus(),

      jobs: await this.collectionJobService.getStatus(access),

      dataSources: await this.collectionJobService.getDataSourcesStatus(),
    };
  }

  /**
   * Returns collection jobs visible to the caller.
   */
  getJobs(query: GetCollectionJobsQueryDto, access: CollectionAccessContext) {
    return this.collectionJobService.findJobs(query, access);
  }

  /**
   * Returns one collection job visible to the caller.
   */
  getJobDetails(id: string, access: CollectionAccessContext) {
    return this.collectionJobService.findJobDetails(id, access);
  }

  /**
   * Returns collected posts visible to the caller.
   */
  getPosts(query: GetSocialPostsQueryDto, access: CollectionAccessContext) {
    return this.socialPostService.findPosts(query, access);
  }

  /**
   * Returns collected comments visible to the caller.
   */
  getComments(
    query: GetSocialCommentsQueryDto,
    access: CollectionAccessContext,
  ) {
    return this.socialCommentService.findComments(query, access);
  }

  /**
   * Stops a running collection job.
   *
   * The controller restricts this operation to Admin.
   */
  async stop(id: string, adminId: string) {
    const stoppedJob = await this.collectionJobService.stopJob(id);

    await this.auditService.createLog({
      actorId: adminId,

      action: AuditAction.ADMIN_STOP_DATA_COLLECTION,

      targetType: AuditTargetType.DATA_COLLECTION,

      targetId: id,

      newValue: {
        status: stoppedJob.status,

        completedAt: stoppedJob.completedAt,
      },
    });

    return stoppedJob;
  }

  /**
   * Checks whether a collection job was stopped.
   */
  private async isStopped(jobId: string): Promise<boolean> {
    const job = await this.collectionJobService.findJobOrThrow(jobId);

    return job.status === CollectionJobStatus.STOPPED;
  }

  /**
   * Filters collector results using the centralized relevance policy.
   *
   * Relevance is calculated from:
   * - The normalized post title.
   * - The normalized post content.
   * - Optional source-provided tags.
   * - Domain keywords and user-provided keywords.
   * - Engagement values and publication recency.
   *
   * An exact source-tag match receives an additional bonus because source
   * platforms such as DEV.to already classify content under those tags.
   *
   * @param posts Posts returned by a source collector.
   * @param relevanceTerms Domain and user relevance terms.
   * @returns Posts that satisfy the configured minimum relevance score.
   */
  private filterRelevantPosts(
    posts: CollectorPost[],
    relevanceTerms: string[],
  ): CollectorPost[] {
    const normalizedTerms = this.normalizeRelevanceTerms(relevanceTerms);

    if (!normalizedTerms.length) {
      return posts;
    }

    return posts.filter((post) => {
      const normalizedTags = this.normalizeRelevanceTerms(post.tags ?? []);

      const baseScore = RelevanceScoreUtil.scoreText({
        title: post.title,

        body: [post.content, ...normalizedTags].filter(Boolean).join(' '),

        domainTerms: normalizedTerms,

        problemTerms: [],

        likes: post.likesCount ?? 0,

        replies: post.repliesCount ?? 0,

        publishedAt: post.publishedAt,
      });

      const hasExactSourceTagMatch = normalizedTags.some((tag) =>
        normalizedTerms.includes(tag),
      );

      const sourceTagBonus = hasExactSourceTagMatch
        ? this.EXACT_SOURCE_TAG_MATCH_BONUS
        : 0;

      const finalScore = baseScore + sourceTagBonus;
      const hasMinimumIndependentRelevance =
        baseScore >= this.MIN_RELEVANCE_SCORE ||
        (hasExactSourceTagMatch && baseScore >= 40);
      const passesGenericTitleGuard = this.passesGenericTitleGuard(
        post,
        normalizedTerms,
        normalizedTags,
        hasExactSourceTagMatch,
      );
      const hasCommunityProblemSignal = this.hasCommunityProblemSignal(post);

      const accepted =
        hasMinimumIndependentRelevance &&
        finalScore >= this.MIN_RELEVANCE_SCORE &&
        passesGenericTitleGuard &&
        hasCommunityProblemSignal;

      this.logger.debug(
        [
          'Central relevance evaluation',
          `title="${post.title}"`,
          `baseScore=${baseScore}`,
          `sourceTagBonus=${sourceTagBonus}`,
          `finalScore=${finalScore}`,
          `minimum=${this.MIN_RELEVANCE_SCORE}`,
          `independentRelevance=${hasMinimumIndependentRelevance}`,
          `genericTitleGuard=${passesGenericTitleGuard}`,
          `communityProblemSignal=${hasCommunityProblemSignal}`,
          `accepted=${accepted}`,
        ].join(' | '),
      );

      return accepted;
    });
  }

  /**
   * Requires at least one concrete community problem, need, complaint, or
   * feature-request signal before a post can enter the evidence corpus.
   *
   * The check includes comments because marketplace listings often have a
   * neutral title while their reviews contain the actual user problems.
   */
  private hasCommunityProblemSignal(post: CollectorPost): boolean {
    const commentsText = post.comments
      .slice(0, 20)
      .map((comment) => comment.content)
      .join(' ');

    const content = [post.title, post.content, commentsText]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return /(?:\b(?:cannot|can't|unable|doesn't work|not working|failed|failure|error|bug|crash|freeze|missing|limited|blocked|need|needs|wish|request|feature request|should add|please add|privacy|consent|paywall|subscription|slow|confusing|difficult|problem|issue|frustrating|unavailable|inaccessible)\b|(?:لا يعمل|لا أستطيع|غير متاح|مشكلة|خطأ|تعطل|بطيء|صعب|مفقود|اشتراك|مدفوع|أحتاج|نحتاج|اقتراح|طلب ميزة))/iu.test(
      content,
    );
  }

  /**
   * Prevents generic marketplace listings from passing relevance checks only
   * because their title repeats a broad domain label such as "AI" or
   * "Artificial Intelligence".
   *
   * Generic titles remain acceptable when at least one stronger signal exists:
   * - A trusted exact source tag match.
   * - The post body contains two distinct relevance terms.
   * - The body contains a concrete problem, need, or feature-request signal.
   */
  private passesGenericTitleGuard(
    post: CollectorPost,
    normalizedTerms: readonly string[],
    normalizedTags: readonly string[],
    hasExactSourceTagMatch: boolean,
  ): boolean {
    const title = (post.title ?? '').trim().toLowerCase().replace(/\s+/gu, ' ');

    if (!this.isGenericDomainTitle(title, normalizedTerms)) {
      return true;
    }

    if (hasExactSourceTagMatch && normalizedTags.length > 0) {
      const body = (post.content ?? '').toLowerCase();
      const hasConcreteTaggedSignal =
        /\b(?:cannot|can't|doesn't work|failed|failure|error|bug|crash|freeze|missing|limited|need|wish|request|should add|privacy|consent|paywall|subscription|slow|confusing|difficult)\b/iu.test(
          body,
        );

      if (hasConcreteTaggedSignal) {
        return true;
      }
    }

    const body = (post.content ?? '').toLowerCase();
    const matchedBodyTerms = normalizedTerms.filter(
      (term) => term.length >= 3 && body.includes(term),
    );
    const hasMultipleBodyMatches = new Set(matchedBodyTerms).size >= 2;
    const hasConcreteCommunitySignal =
      /\b(?:cannot|can't|doesn't work|failed|failure|error|bug|crash|freeze|missing|limited|need|wish|request|should add|privacy|consent|paywall|subscription|slow|confusing|difficult)\b/iu.test(
        body,
      );

    return hasMultipleBodyMatches || hasConcreteCommunitySignal;
  }

  /**
   * Detects titles composed mainly of broad domain terms and marketplace filler.
   */
  private isGenericDomainTitle(
    title: string,
    normalizedTerms: readonly string[],
  ): boolean {
    const genericMarketplaceWords = new Set([
      'app',
      'application',
      'assistant',
      'bot',
      'chat',
      'chatbot',
      'platform',
      'software',
      'system',
      'tool',
      'writer',
      'ask',
      'anything',
      'smart',
    ]);
    const normalizedDomainTerms = new Set(
      normalizedTerms.flatMap((term) => term.split(/\s+/u)),
    );
    const meaningfulTokens = title
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)
      .filter(
        (token) =>
          !genericMarketplaceWords.has(token) &&
          !normalizedDomainTerms.has(token),
      );

    const containsDomainTerm = normalizedTerms.some(
      (term) => term.length >= 2 && title.includes(term),
    );

    return containsDomainTerm && meaningfulTokens.length <= 1;
  }

  /**
   * Normalizes relevance terms and source tags for stable comparison.
   *
   * Normalization:
   * - Trims surrounding whitespace.
   * - Converts values to lowercase.
   * - Replaces repeated internal whitespace with a single space.
   * - Removes empty and duplicate values.
   *
   * @param values Raw domain terms, user keywords, or source tags.
   * @returns Unique normalized relevance values.
   */
  private normalizeRelevanceTerms(values: readonly string[]): string[] {
    return [
      ...new Set(
        values
          .map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '))
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Returns domain keywords compatible with
   * the requested language.
   */
  private getDomainKeywordsByLanguage(
    keywords: Array<{
      keyword: string;
      language: LanguageCode;
    }>,

    language: LanguageCode,
  ): string[] {
    return keywords
      .filter(
        (item) =>
          language === LanguageCode.ANY ||
          item.language === LanguageCode.ANY ||
          item.language === language,
      )
      .map((item) => item.keyword.trim())
      .filter(Boolean);
  }

  /**
   * Trims, removes empty values, and deduplicates strings.
   */
  private unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  /**
   * Identifies the reserved general domain.
   */
  private isGeneralDomain(domainName: string): boolean {
    return domainName.trim().toLowerCase() === this.GENERAL_DOMAIN_NAME;
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown collection error.';
  }
}