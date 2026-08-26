import {
  Injectable,
  Logger,
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
import { CollectorAbortContextUtil } from '../collectors/base/collector-abort-context.util';

import {
  CollectorInput,
  CollectorPost,
} from '../collectors/base/collector.types';
import { ProblemFirstCollectorQueryUtil } from '../collectors/base/problem-first-collector-query.util';
import { RequestVerticalConstraintUtil, type RequestVerticalConstraint } from '../ideas/generation/utils/request-vertical-constraint.util';
import { RequestWorkflowArchetypeUtil } from '../ideas/generation/utils/request-workflow-archetype.util';
import { RequestWorkflowIntentProfileUtil } from '../ideas/generation/utils/request-workflow-intent-profile.util';
import { RequestEvidenceAlignmentUtil } from '../ideas/generation/utils/request-evidence-alignment.util';
import { RequestQueryProvenanceUtil } from '../ideas/generation/utils/request-query-provenance.util';
import { RequestNicheCustomCraftUtil } from '../ideas/generation/utils/request-niche-custom-craft.util';
import { RequestOnlinePharmacyFraudUtil } from '../ideas/generation/utils/request-online-pharmacy-fraud.util';

import { RelevanceScoreUtil } from '../collectors/base/relevance-score.util';

import { CollectorsFactory } from '../collectors/collectors.factory';

import { TextInputBuilderService } from '../nlp/pipeline/text-input-builder.service';
import { classifyDirectCommunityEvidence } from '../nlp/common/utils/community-evidence.util';
import type { IntelligentTextInput } from '../nlp/pipeline/types/intelligent-analysis.types';

import { CollectionJobService } from './collection-jobs/collection-job.service';
import { CollectorSourceHealthService } from './collector-source-health.service';

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
  readonly plannedQueries?: string[];
  /** True only when PREPARING/RECOVERY actually accepted an online AI query plan. */
  readonly queriesGeneratedByAi?: boolean;
  readonly sourcePlans?: Array<{
    readonly sourceKey: string;
    readonly queries: readonly string[];
    readonly routingHints: readonly string[];
    readonly discoveryDomainId?: string | null;
    readonly discoveryDomainName?: string | null;
    readonly queryIntentId?: string | null;
    readonly sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE';
    readonly problemFacetIds?: readonly string[];
  }>;

  readonly collectionMode?: CollectorInput['collectionMode'];
  readonly collectorLimits?: CollectorInput['limits'];

  /** Runtime-only cancellation signal supplied by idea generation. */
  readonly signal?: AbortSignal;

  /**
   * Trusted metadata already resolved by the idea-generation selection stages.
   * FAST_GENERATION can reuse it to avoid repeating remote Domain/DataSource
   * lookups immediately before collectors start. Manual collection never sets
   * these hints and keeps the full database validation path.
   */
  readonly resolvedDomain?: {
    readonly id: string;
    readonly name: string;
    readonly keywords: readonly string[];
  };
  readonly resolvedDataSources?: readonly {
    readonly id: string;
    readonly key: string;
    readonly displayName: string;
  }[];
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
 * - Completes sparse internal generation jobs even when every external source
 *   fails, allowing a clearly labelled context-only generation fallback.
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

  /**
   * Generation does not impose an extra queue-level wall-clock cutoff on a
   * collector. Individual HTTP adapters retain their own request timeouts and
   * CollectorQueueService still isolates failures, but a healthy collector is
   * allowed to finish all of its configured evidence queries.
   */

  constructor(
    private readonly collectionJobService: CollectionJobService,

    private readonly socialPostService: SocialPostService,

    private readonly socialCommentService: SocialCommentService,

    private readonly collectorsFactory: CollectorsFactory,

    private readonly collectorQueueService: CollectorQueueService,

    private readonly collectorSourceHealth: CollectorSourceHealthService,

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
    const collectionMode =
      'collectionMode' in dto ? dto.collectionMode : undefined;
    const collectorLimits =
      'collectorLimits' in dto ? dto.collectorLimits : undefined;
    const signal = 'signal' in dto ? dto.signal : undefined;
    CollectorAbortContextUtil.throwIfAborted(signal);
    const isFastPathCollection =
      collectionMode === 'FAST_GENERATION' ||
      collectionMode === 'TARGETED_RECOVERY';
    const isFastInternal =
      trigger === 'SYSTEM_INTERNAL' && isFastPathCollection;
    const isTrustedInternalGeneration =
      trigger === 'SYSTEM_INTERNAL' &&
      (collectionMode === 'FAST_GENERATION' ||
        collectionMode === 'TARGETED_RECOVERY');

    const trustedResolvedDomain =
      isTrustedInternalGeneration && 'resolvedDomain' in dto
        ? dto.resolvedDomain
        : undefined;
    const trustedResolvedSources =
      isTrustedInternalGeneration && 'resolvedDataSources' in dto
        ? dto.resolvedDataSources
        : undefined;

    /*
     * DataSourceSelectionStage and DomainResolutionService have already
     * validated these exact records for an idea-generation run. Reusing that
     * immutable snapshot removes two redundant Supabase reads from the
     * pre-collector critical path. Manual collection intentionally retains the
     * database-backed validation path.
     */
    const [domain, dataSources] = await Promise.all([
      trustedResolvedDomain
        ? Promise.resolve({
            id: trustedResolvedDomain.id,
            name: trustedResolvedDomain.name,
            domainKeywords: [],
          })
        : this.collectionJobService.validateActiveDomain(dto.domainId),
      trustedResolvedSources?.length
        ? Promise.resolve(
            this.validateTrustedRuntimeSources(trustedResolvedSources),
          )
        : this.collectionJobService.resolveActiveImplementedDataSources(
            dto.dataSourceKeys,
          ),
    ]);

    const isGeneralDomain = this.isGeneralDomain(domain.name);
    const domainKeywords = trustedResolvedDomain
      ? this.unique(trustedResolvedDomain.keywords)
      : isGeneralDomain
        ? await this.collectionJobService.getAllActiveDomainKeywords(dto.language)
        : this.getDomainKeywordsByLanguage(domain.domainKeywords, dto.language);

    const requestDescriptionForCollection =
      'userDescription' in dto ? dto.userDescription?.trim() ?? '' : '';
    const rawUserKeywords = this.unique(dto.keywords ?? []);
    const userKeywords = requestDescriptionForCollection
      ? rawUserKeywords.filter((value) =>
          RequestQueryProvenanceUtil.isDerivedConceptGrounded(
            requestDescriptionForCollection,
            value,
          ),
        )
      : rawUserKeywords;
    const plannedRelevanceTerms =
      'plannedQueries' in dto
        ? this.extractPlannedRelevanceTerms(dto.plannedQueries ?? [])
        : [];
    const relevanceTerms = this.unique([
      ...(isGeneralDomain ? [] : [domain.name]),
      ...domainKeywords,
      ...userKeywords,
      ...plannedRelevanceTerms,
    ]);
    const requestVerticalConstraint = RequestVerticalConstraintUtil.resolve({
      requestDescription:
        'userDescription' in dto ? dto.userDescription : undefined,
      domainName: isGeneralDomain ? undefined : domain.name,
      plannedQueries:
        'plannedQueries' in dto ? dto.plannedQueries ?? [] : [],
    });

    const requestDescription =
      'userDescription' in dto ? dto.userDescription?.trim() ?? '' : '';
    const requestArchetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription,
      plannedQueries: 'plannedQueries' in dto ? dto.plannedQueries ?? [] : [],
      selectedDomainNames: isGeneralDomain ? [] : [domain.name],
    });
    const violinCaseRestorationRequest =
      requestVerticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      requestVerticalConstraint.label ===
        'violin case restoration condition materials and repair history operations';
    const hasAiOwnedTextPlan =
      Boolean(requestDescription) &&
      isTrustedInternalGeneration &&
      'queriesGeneratedByAi' in dto &&
      dto.queriesGeneratedByAi === true &&
      'plannedQueries' in dto &&
      (dto.plannedQueries?.length ?? 0) > 0;
    // The AI-owned plan is authoritative for query/source planning, but it must
    // never erase requester identity during evidence admission. A rich plan used
    // to downgrade strict verticals to GENERAL here, allowing lexical collisions
    // (food delivery, opioid-abuse papers, generic workflow pages) into the raw
    // corpus. Keep the request-derived constraint active for every collector item.
    const effectiveRequestVerticalConstraint = requestVerticalConstraint;
    const preferredRequestSourceKeys = new Set(
      (hasAiOwnedTextPlan
        ? ('sourcePlans' in dto && dto.sourcePlans?.length
            ? dto.sourcePlans.slice(0, 4).map((plan) => plan.sourceKey)
            : dataSources.slice(0, 4).map((source) => source.key))
        : violinCaseRestorationRequest
          ? ['forum', 'youtube', 'news', 'crossref', 'gdelt']
          : requestArchetype.preferredSourceKeys
      ).map((key) => key.toLocaleLowerCase()),
    );
    const blockedRequestSourceKeys = new Set(
      (hasAiOwnedTextPlan
        ? []
        : violinCaseRestorationRequest
          ? [
              ...requestArchetype.blockedSourceKeys,
              'blog',
              'app-store',
              'google-play',
              'product-hunt',
              'github',
              'stackoverflow',
              'dev-to',
              'hacker-news',
            ]
          : requestArchetype.blockedSourceKeys
      ).map((key) => key.toLocaleLowerCase()),
    );

    /*
     * In latency-sensitive internal collection the collectors do not need CollectionJob.id for any
     * network request or relevance calculation. Start the remote job insert and
     * all collector HTTP work in the same latency window; each source awaits the
     * job only immediately before persistence. This hides most CollectionJob
     * creation latency behind collector I/O instead of paying it first.
     */
    let resolvedJob: { id: string } | null = null;
    const jobPromise = this.collectionJobService
      .createRunningJob(dto, dataSources, actorId)
      .then((job) => {
        resolvedJob = job;
        return job;
      });

    const getJob = async () => resolvedJob ?? jobPromise;

    if (!isFastInternal) {
      await jobPromise;
    }

    const startAuditPromise = jobPromise.then((job) =>
      this.auditService.createLog({
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
      }),
    );

    if (trigger === 'USER_MANUAL') {
      await startAuditPromise;
    } else {
      void startAuditPromise.catch((error: unknown) => {
        const id = resolvedJob?.id ?? 'pending';
        this.logger.warn(
          `Could not persist the internal collection-start audit for job ${id}: ${this.getErrorMessage(error)}.`,
        );
      });
    }

    let completedSources = 0;
    let failedSources = 0;
    const fastEvidenceInputs: IntelligentTextInput[] = [];
    const rawEvidenceInputs: IntelligentTextInput[] = [];
    const completedSourceKeys: string[] = [];
    let fastPersistedPosts = 0;
    let fastPersistedComments = 0;

    /*
     * FAST_GENERATION source-status rows are operational/audit metadata.
     * Collected posts/comments are already durably persisted before a source is
     * considered successful. Keep these per-source status writes out of the
     * user-facing critical path and flush them only after the parent collection
     * job has been completed.
     */
    const deferredFastSourceCheckpoints: Array<() => Promise<unknown>> = [];

    try {
      const sourceResults = await Promise.all(
        dataSources.map(async (dataSource) => {
          const jobForStopCheck = resolvedJob;
          if (
            trigger === 'USER_MANUAL' &&
            jobForStopCheck &&
            (await this.isStopped(jobForStopCheck.id))
          ) {
            return 'STOPPED' as const;
          }

          const sourceStartedAt = new Date();
          const sourceStartedMs = Date.now();
          let jobForSource: { id: string } | null = null;

          try {
            const collector = this.collectorsFactory.getCollector(dataSource.key);
            let effectiveCollectorLimits = this.resolveSourceCollectorLimits(
              dataSource.key,
              collectionMode,
              collectorLimits,
              effectiveRequestVerticalConstraint,
              requestDescription,
              preferredRequestSourceKeys,
              blockedRequestSourceKeys,
              hasAiOwnedTextPlan,
            );

            const sourcePlan =
              isTrustedInternalGeneration && 'sourcePlans' in dto
                ? (dto.sourcePlans ?? []).find(
                    (plan) => plan.sourceKey.toLocaleLowerCase() === dataSource.key.toLocaleLowerCase(),
                  )
                : undefined;
            effectiveCollectorLimits = this.applySourceTierCollectorLimits(
              effectiveCollectorLimits,
              sourcePlan?.sourceTier,
              collectionMode,
            );
            const sourceQueryBudget = sourcePlan?.queries?.length
              ? sourcePlan.sourceTier === 'PRIMARY'
                ? 3
                : sourcePlan.sourceTier === 'SECONDARY'
                  ? 2
                  : 1
              : 1;
            const sourceSpecificAiQueries = this.unique(
              (sourcePlan?.queries?.length
                ? sourcePlan.queries
                : 'plannedQueries' in dto
                  ? dto.plannedQueries ?? []
                  : []
              ).map((query) => query.trim()).filter(Boolean),
            ).slice(0, sourceQueryBudget);
            const authoritativeRuntimeQueries =
              isTrustedInternalGeneration &&
              sourceSpecificAiQueries.length > 0;
            const queriesGeneratedByAi =
              authoritativeRuntimeQueries && hasAiOwnedTextPlan;

            const sourcePlannedQueries = authoritativeRuntimeQueries
              ? sourceSpecificAiQueries
              : isTrustedInternalGeneration && 'plannedQueries' in dto
                ? ProblemFirstCollectorQueryUtil.build({
                    sourceKey: dataSource.key,
                    domainName: isGeneralDomain ? 'All Domains' : domain.name,
                    requestDescription:
                      'userDescription' in dto ? dto.userDescription : undefined,
                    plannedQueries: this.unique(dto.plannedQueries ?? []),
                    keywords: userKeywords,
                  })
                : 'plannedQueries' in dto
                  ? this.unique(dto.plannedQueries ?? [])
                  : undefined;

            const guaranteedSourceQueries =
              sourcePlannedQueries && sourcePlannedQueries.length > 0
                ? sourcePlannedQueries
                : this.buildEmergencyRuntimeQueries({
                    requestDescription,
                    domainName: isGeneralDomain ? '' : domain.name,
                    userKeywords,
                  });

            const collectorInput: CollectorInput = {
              domainName: isGeneralDomain ? 'All Domains' : domain.name,
              domainKeywords,
              country: dto.country,
              city: dto.city,
              region: dto.region,
              language: dto.language,
              radiusKm: dto.radiusKm,
              keywords: userKeywords,
              requestDescription:
                'userDescription' in dto ? dto.userDescription : undefined,
              plannedQueries: guaranteedSourceQueries,
              authoritativePlannedQueries: authoritativeRuntimeQueries,
              sourceHints: sourcePlan?.routingHints ? [...sourcePlan.routingHints] : undefined,
              collectionMode,
              limits: effectiveCollectorLimits,
            };

            if (isFastPathCollection) {
              this.logger.debug(
                `Collector limits applied | source=${dataSource.key} | ` +
                  `fetchedPosts=${effectiveCollectorLimits?.maxFetchedPosts ?? 'default'} | ` +
                  `savedPosts=${effectiveCollectorLimits?.maxSavedPosts ?? 'default'} | ` +
                  `fetchedComments=${effectiveCollectorLimits?.maxFetchedComments ?? 'default'} | ` +
                  `savedComments=${effectiveCollectorLimits?.maxSavedComments ?? 'default'} | ` +
                  `problemQueries=${guaranteedSourceQueries.join(' || ') || 'none'} | authoritativeRuntime=${authoritativeRuntimeQueries} | queryOrigin=${queriesGeneratedByAi ? 'AI' : 'RUNTIME_FALLBACK'}`,
              );
            }

            const collectorStartedMs = Date.now();
            const postsPromise = this.collectorQueueService.run(
              (sourceSignal) =>
                CollectorAbortContextUtil.run(sourceSignal ?? signal, () =>
                  collector.runWithLimits(collectorInput, () =>
                    collector.collect(collectorInput),
                  ),
                ),
              {
                platform: dataSource.key,
                signal,
                timeoutMs: this.resolveSourceCollectorTimeoutMs(
                  dataSource.key,
                  collectionMode,
                  effectiveRequestVerticalConstraint,
                  requestDescription,
                  preferredRequestSourceKeys,
                  blockedRequestSourceKeys,
                  sourcePlan?.sourceTier,
                ),
                // FAST_GENERATION/TARGETED_RECOVERY are latency-bounded. A slow
                // collector must never hold the whole generation run hostage.
                // Collectors receive the AbortSignal and may return partial data;
                // if they do not cooperate, Promise.race still releases the
                // generation critical path at the tier-specific hard deadline.
                abortOnTimeout: true,
              },
            );

            /*
             * Manual jobs still expose RUNNING source state. Latency-sensitive internal collection
             * deliberately avoids that write and starts collection immediately.
             */
            const posts = (
              isFastPathCollection
                ? await postsPromise
                : (
                    await Promise.all([
                      postsPromise,
                      (async () => {
                        jobForSource = await getJob();
                        await this.collectionJobService.markSourceRunning(
                          jobForSource.id,
                          dataSource.id,
                        );
                      })(),
                    ])
                  )[0]
            ) as CollectorPost[];

            CollectorAbortContextUtil.throwIfAborted(signal);
            jobForSource = jobForSource ?? (await getJob());

            if (
              trigger === 'USER_MANUAL' &&
              (await this.isStopped(jobForSource.id))
            ) {
              return 'STOPPED' as const;
            }

            const collectorElapsedMs = Date.now() - collectorStartedMs;
            this.collectorSourceHealth.recordSuccess(
              dataSource.key,
              posts.length,
              collectorElapsedMs,
            );

            /*
             * Community-AI visibility invariant:
             * every non-empty post/comment returned by the collector is copied
             * into the in-memory raw evidence ledger BEFORE central relevance,
             * persistence caps, source-local identity gates, or NLP pruning run.
             *
             * This raw ledger is classification input only. It does not make an
             * item trusted evidence; DIRECT/SUPPORTING admission still requires
             * Community AI classification plus the existing deterministic
             * post-AI verifier. Keeping the ledger in memory also avoids extra
             * database writes and therefore adds recall without adding a serial
             * persistence step to the generation critical path.
             */
            const sourceCollectedRawEvidenceInputs = isFastPathCollection
              ? this.buildRawEvidenceInputsForCollectedPosts(
                  posts,
                  dataSource.key,
                  relevanceTerms,
                  guaranteedSourceQueries,
                  sourcePlan,
                  collectionMode === 'TARGETED_RECOVERY' ? 'RECOVERY' : 'INITIAL',
                )
              : [];
            if (sourceCollectedRawEvidenceInputs.length > 0) {
              rawEvidenceInputs.push(...sourceCollectedRawEvidenceInputs);
            }

            const relevanceStartedMs = Date.now();
            const strictRelevantPosts = this.filterRelevantPosts(
              posts,
              relevanceTerms,
              collectionMode,
              dataSource.key,
              guaranteedSourceQueries,
              effectiveRequestVerticalConstraint,
              requestDescription,
            );
            const relevantPosts = strictRelevantPosts.length > 0
              ? strictRelevantPosts
              : this.selectSupportingFallbackPosts(
                  posts,
                  relevanceTerms,
                  collectionMode,
                  dataSource.key,
                  sourcePlannedQueries ??
                    ('plannedQueries' in dto ? dto.plannedQueries ?? [] : []),
                  effectiveRequestVerticalConstraint,
                  requestDescription,
                );
            const relevanceElapsedMs = Date.now() - relevanceStartedMs;
            CollectorAbortContextUtil.throwIfAborted(signal);

            let totals: { totalPosts: number; totalComments: number };

            if (isFastPathCollection) {
              const persistenceStartedMs = Date.now();
              /*
               * Persist a bounded raw corpus for FAST_GENERATION/TARGETED_RECOVERY
               * instead of persisting only the deterministic relevance winner.
               * This lets Community AI inspect what collectors actually found
               * before lexical pruning, while the narrower relevantPosts set
               * remains the only corpus admitted directly to deterministic NLP.
               *
               * Relevant posts are placed first so the configured save cap can
               * never evict already-qualified evidence. Remaining collector
               * results are retained only as AI-triage candidates.
               */
              /*
               * RAW AI corpus policy: preserve broad semantic recall for general
               * workflows, but strict request contracts must pass the lightweight
               * requester-identity gate before persistence. This removes known
               * lexical collisions early while still retaining DIRECT and adjacent
               * SUPPORTING candidates for Community AI.
               */
              const sourceLocalTriageCandidates = posts.filter((post) =>
                this.passesFastRawTriageIdentityGate(
                  post,
                  effectiveRequestVerticalConstraint,
                  requestDescription,
                ),
              );
              const persistencePostCap = Math.min(
                effectiveCollectorLimits?.maxSavedPosts ?? 18,
                sourcePlan?.sourceTier === 'PRIMARY'
                  ? 3
                  : sourcePlan?.sourceTier === 'SECONDARY'
                    ? 2
                    : 1,
              );
              const persistenceCommentCap = Math.min(
                effectiveCollectorLimits?.maxSavedComments ?? 30,
                sourcePlan?.sourceTier === 'PRIMARY'
                  ? 3
                  : sourcePlan?.sourceTier === 'SECONDARY'
                    ? 2
                    : 1,
              );
              const triagePersistencePosts = this.buildFastTriagePersistencePosts(
                sourceLocalTriageCandidates,
                relevantPosts,
                persistencePostCap,
                persistenceCommentCap,
              );
              const fastPersistence =
                await this.socialPostService.createManyWithCommentsFast(
                  jobForSource.id,
                  dataSource.id,
                  {
                    country: dto.country,
                    city: dto.city,
                    region: dto.region,
                  },
                  triagePersistencePosts,
                );

              totals = {
                totalPosts: fastPersistence.totalPosts,
                totalComments: fastPersistence.totalComments,
              };

              const sourceFastEvidenceInputs =
                this.buildFastEvidenceInputsForPersistedPosts(
                  relevantPosts,
                  dataSource.key,
                  relevanceTerms,
                  effectiveCollectorLimits?.maxSavedComments ?? 1,
                  sourcePlannedQueries ?? [],
                );
              completedSourceKeys.push(dataSource.key);
              fastEvidenceInputs.push(
                ...sourceFastEvidenceInputs.map((input) => ({
                  ...input,
                  sourceKey: dataSource.key,
                })),
              );
              fastPersistedPosts += fastPersistence.totalPosts;
              fastPersistedComments += fastPersistence.totalComments;

              const persistenceElapsedMs = Date.now() - persistenceStartedMs;
              this.logger.debug(
                `${collectionMode} persisted source=${dataSource.key} | ` +
                  `posts=${fastPersistence.totalPosts} | ` +
                  `comments=${fastPersistence.totalComments} | ` +
                  `nlpInputs=${sourceFastEvidenceInputs.length} | ` +
                  `communityRawInputs=${sourceCollectedRawEvidenceInputs.length} | ` +
                  `collectorMs=${collectorElapsedMs} | ` +
                  `relevanceMs=${relevanceElapsedMs} | ` +
                  `persistenceMs=${persistenceElapsedMs} | ` +
                  `sourceMs=${Date.now() - sourceStartedMs}`,
              );
            } else {
              totals = await this.socialPostService.createManyWithComments(
                jobForSource.id,
                dataSource.id,
                {
                  country: dto.country,
                  city: dto.city,
                  region: dto.region,
                },
                relevantPosts,
              );
            }

            if (isFastPathCollection) {
              const completedJobId = jobForSource.id;
              const completedDataSourceId = dataSource.id;
              const completedTotals = { ...totals };
              deferredFastSourceCheckpoints.push(() =>
                this.collectionJobService.markSourceCompleted(
                  completedJobId,
                  completedDataSourceId,
                  completedTotals,
                  sourceStartedAt,
                ),
              );
            } else {
              await this.collectionJobService.markSourceCompleted(
                jobForSource.id,
                dataSource.id,
                totals,
              );
            }

            return 'COMPLETED' as const;
          } catch (error: unknown) {
            if (signal?.aborted || CollectorAbortContextUtil.isAbortError(error)) {
              throw error;
            }

            jobForSource = jobForSource ?? (await getJob());
            this.collectorSourceHealth.recordFailure(
              dataSource.key,
              Date.now() - sourceStartedMs,
            );

            if (isFastPathCollection) {
              const failedJobId = jobForSource.id;
              const failedDataSourceId = dataSource.id;
              const failedError = error;
              deferredFastSourceCheckpoints.push(async () => {
                const persistedTotals =
                  await this.socialPostService.countByCollectionJobSource(
                    failedJobId,
                    failedDataSourceId,
                  );

                await this.collectionJobService.markSourceFailed(
                  failedJobId,
                  failedDataSourceId,
                  failedError,
                  persistedTotals,
                  sourceStartedAt,
                );
              });

              this.logger.warn(
                `${collectionMode} source failed without blocking the evidence path | source=${dataSource.key} | ` +
                  `error=${this.getErrorMessage(error)}`,
              );

              return 'FAILED' as const;
            }

            const persistedTotals =
              await this.socialPostService.countByCollectionJobSource(
                jobForSource.id,
                dataSource.id,
              );

            this.logger.warn(
              `Collection source persistence failed | source=${dataSource.key} | ` +
                `persistedPosts=${persistedTotals.totalPosts} | ` +
                `persistedComments=${persistedTotals.totalComments} | ` +
                `error=${this.getErrorMessage(error)}`,
            );

            await this.collectionJobService.markSourceFailed(
              jobForSource.id,
              dataSource.id,
              error,
              persistedTotals,
            );

            return 'FAILED' as const;
          }
        }),
      );

      CollectorAbortContextUtil.throwIfAborted(signal);
      const job = await getJob();
      completedSources = sourceResults.filter(
        (result) => result === 'COMPLETED',
      ).length;
      failedSources = sourceResults.filter(
        (result) => result === 'FAILED',
      ).length;

      if (
        sourceResults.some((result) => result === 'STOPPED') ||
        (trigger === 'USER_MANUAL' && (await this.isStopped(job.id)))
      ) {
        await this.collectionJobService.markRemainingSourcesStopped(job.id);
        return this.collectionJobService.findJobOrThrow(job.id);
      }

      const authoritativeTotals =
        isFastPathCollection
          ? {
              totalPosts: fastPersistedPosts,
              totalComments: fastPersistedComments,
            }
          : await this.collectionJobService.countPersistedJobData(job.id);

      if (completedSources === 0 && authoritativeTotals.totalPosts === 0) {
        this.logger.warn(
          `Collection job ${job.id} completed without persisted posts. The generation pipeline will continue with a context-only fallback.`,
        );
      }

      const completedJob = isFastPathCollection
        ? await this.collectionJobService.completeJobWithTotalsForGeneration(
            job.id,
            authoritativeTotals,
          )
        : await this.collectionJobService.completeJobWithTotals(
            job.id,
            authoritativeTotals,
          );

      const completionAudit = this.auditService.createLog({
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

      if (trigger === 'USER_MANUAL') {
        await completionAudit;
      } else {
        void completionAudit.catch((error: unknown) => {
          this.logger.warn(
            `Could not persist the internal collection-completion audit for job ${job.id}: ${this.getErrorMessage(error)}.`,
          );
        });
      }

      if (isFastPathCollection) {
        const deduplicatedRawEvidenceInputs =
          this.deduplicateFastEvidenceInputs(rawEvidenceInputs);

        /*
         * Raw collector evidence and deterministic NLP inputs serve different
         * purposes. The raw corpus must survive even when the strict fast-NLP
         * relevance lane retains zero items so Community AI can semantically
         * triage everything that was actually collected.
         */
        this.logger.debug(
          `${collectionMode} Community raw ledger prepared | ` +
            `rawInputs=${deduplicatedRawEvidenceInputs.length} | ` +
            `nlpInputs=${fastEvidenceInputs.length} | ` +
            `allCollectedVisible=true`,
        );

        if (
          fastEvidenceInputs.length > 0 ||
          deduplicatedRawEvidenceInputs.length > 0
        ) {
          TextInputBuilderService.primeFastContext({
            collectionJobId: job.id,
            language: dto.language,
            domain: {
              id: domain.id,
              name: domain.name,
              keywords: relevanceTerms.slice(0, 30),
            },
            location: {
              country: dto.country,
              city: dto.city,
              region: dto.region,
            },
            platforms: [...new Set(completedSourceKeys)],
            inputs: fastEvidenceInputs,
            rawInputs: deduplicatedRawEvidenceInputs,
          });
        } else if (
          authoritativeTotals.totalPosts > 0 ||
          authoritativeTotals.totalComments > 0
        ) {
          this.logger.warn(
            `${collectionMode} cache bypass for job ${job.id}: persisted corpus ` +
              `contains ${authoritativeTotals.totalPosts} post(s) and ` +
              `${authoritativeTotals.totalComments} comment(s), but neither fast NLP ` +
              `inputs nor raw evidence inputs were built.`,
          );
        }

        /*
         * Start operational source checkpoints on the next event-loop turn so
         * the collection resolver can immediately continue into NLP. Failures
         * are logged but cannot invalidate already persisted evidence or the
         * completed parent job.
         */
        if (deferredFastSourceCheckpoints.length > 0) {
          setImmediate(() => {
            void Promise.allSettled(
              deferredFastSourceCheckpoints.map((checkpoint) => checkpoint()),
            ).then((results) => {
              const rejected = results.filter(
                (result) => result.status === 'rejected',
              );

              if (rejected.length > 0) {
                this.logger.warn(
                  `${collectionMode} deferred source checkpoint failures for job ${job.id}: ${rejected.length}/${results.length}.`,
                );
              }
            });
          });
        }
      }

      return completedJob;
    } catch (error: unknown) {
      let job: { id: string };

      try {
        job = await jobPromise;
      } catch {
        /* CollectionJob creation failed; there is no persistent job to mutate. */
        throw error;
      }

      if (signal?.aborted || CollectorAbortContextUtil.isAbortError(error)) {
        try {
          await this.collectionJobService.stopJob(job.id);
        } catch (stopError: unknown) {
          this.logger.warn(
            `Could not mark cancelled collection job ${job.id} as stopped: ${this.getErrorMessage(stopError)}.`,
          );
        }
        throw error;
      }

      const latestJob = await this.collectionJobService.findJobOrThrow(job.id);
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

  private validateTrustedRuntimeSources(
    sources: readonly {
      readonly id: string;
      readonly key: string;
      readonly displayName: string;
    }[],
  ): { id: string; key: string; displayName: string }[] {
    const runtimeKeys = new Set(
      this.collectorsFactory.getImplementedSourceKeys().map((key) =>
        key.trim().toLowerCase(),
      ),
    );

    const normalized = sources.map((source) => ({
      id: source.id.trim(),
      key: source.key.trim().toLowerCase(),
      displayName: source.displayName.trim(),
    }));

    const invalid = normalized.filter(
      (source) => !source.id || !source.key || !runtimeKeys.has(source.key),
    );
    if (invalid.length > 0) {
      throw new Error(
        `Resolved idea-generation data source is no longer implemented: ${invalid
          .map((source) => source.key || source.id)
          .join(', ')}.`,
      );
    }

    return [...new Map(normalized.map((source) => [source.key, source])).values()];
  }


  /**
   * Builds the Community-AI raw ledger from the collector response itself.
   *
   * Unlike deterministic NLP inputs, this method intentionally performs no
   * relevance, vertical, lexical, source-quota, or comment-ranking pruning.
   * Collector runWithLimits already defines what was actually collected; every
   * non-empty returned post and comment is preserved once for Community AI.
   */
  private applySourceTierCollectorLimits(
    limits: CollectorInput['limits'],
    tier: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE' | undefined,
    collectionMode: CollectorInput['collectionMode'],
  ): CollectorInput['limits'] {
    if (!limits || !tier || tier === 'PRIMARY') return limits;
    const cap = (value: number | undefined, maximum: number): number =>
      Math.min(value ?? maximum, maximum);

    if (tier === 'MICRO_PROBE') {
      return {
        ...limits,
        maxFetchedPosts: cap(limits.maxFetchedPosts, 2),
        maxSavedPosts: cap(limits.maxSavedPosts, 1),
        maxFetchedComments: cap(limits.maxFetchedComments, 2),
        maxSavedComments: cap(limits.maxSavedComments, 1),
      };
    }

    if (collectionMode === 'FAST_GENERATION') {
      return {
        ...limits,
        maxFetchedPosts: cap(limits.maxFetchedPosts, 6),
        maxSavedPosts: cap(limits.maxSavedPosts, 3),
        maxFetchedComments: cap(limits.maxFetchedComments, 6),
        maxSavedComments: cap(limits.maxSavedComments, 3),
      };
    }

    if (collectionMode === 'TARGETED_RECOVERY') {
      return {
        ...limits,
        maxFetchedPosts: cap(limits.maxFetchedPosts, 4),
        maxSavedPosts: cap(limits.maxSavedPosts, 2),
        maxFetchedComments: cap(limits.maxFetchedComments, 4),
        maxSavedComments: cap(limits.maxSavedComments, 2),
      };
    }
    return limits;
  }

  private buildRawEvidenceInputsForCollectedPosts(
    posts: readonly CollectorPost[],
    sourceKey: string,
    relevanceTerms: readonly string[],
    plannedQueries: readonly string[],
    sourcePlan?: NonNullable<IdeaGenerationCollectionInput['sourcePlans']>[number],
    collectionPhase: 'INITIAL' | 'RECOVERY' = 'INITIAL',
  ): IntelligentTextInput[] {
    const inputs: IntelligentTextInput[] = [];
    const provenance = {
      discoveryDomainId: sourcePlan?.discoveryDomainId ?? null,
      discoveryDomainName: sourcePlan?.discoveryDomainName ?? null,
      queryIntentId: sourcePlan?.queryIntentId ?? null,
      queryText: plannedQueries.length > 0 ? plannedQueries.join(' || ') : null,
      problemFacetIds: sourcePlan?.problemFacetIds ?? [],
      collectionPhase,
      sourceTier: sourcePlan?.sourceTier ?? 'MICRO_PROBE' as const,
    };

    posts.forEach((post, postIndex) => {
      const externalPostId =
        post.externalId.trim() || `collected-${postIndex.toString(36)}`;
      const postId = `${sourceKey}:post:${externalPostId}`;
      const postContent = this.buildDeduplicatedEvidenceText(
        post.title,
        post.content,
        3_600,
      );

      if (postContent) {
        inputs.push({
          id: postId,
          sourceKey,
          sourceType: 'POST',
          title: post.title ?? null,
          content: postContent,
          language: this.parseFastLanguageCode(post.languageCode),
          likesCount: post.likesCount,
          repliesCount: post.repliesCount ?? post.comments.length,
          requiresAiSemanticTriage: true,
          ...provenance,
        });
      }

      post.comments.forEach((comment, commentIndex) => {
        const content = comment.content.trim();
        if (!content) return;
        const externalCommentId =
          comment.externalId.trim() ||
          `${externalPostId}-comment-${commentIndex.toString(36)}`;

        inputs.push({
          id: `${sourceKey}:comment:${externalCommentId}`,
          sourceKey,
          sourceType: 'COMMENT',
          postId,
          title: post.title ?? null,
          content: content.slice(0, 2_400),
          language: this.parseFastLanguageCode(comment.languageCode),
          likesCount: comment.likesCount,
          isComplaintEvidence: this.isProtectedComplaintEvidence(
            content,
            post.title ?? '',
            relevanceTerms,
          ),
          requiresAiSemanticTriage: true,
          ...provenance,
        });
      });
    });

    return inputs;
  }

  private buildFastEvidenceInputsForPersistedPosts(
    posts: readonly CollectorPost[],
    sourceKey: string,
    relevanceTerms: readonly string[],
    maxSavedComments: number,
    plannedQueries: readonly string[],
  ): IntelligentTextInput[] {
    const inputs: IntelligentTextInput[] = [];
    const isMarketplaceSource =
      sourceKey === 'google-play' || sourceKey === 'app-store';

    for (const post of posts) {
      const externalPostId = post.externalId.trim();
      if (!externalPostId) continue;

      const postId = `${sourceKey}:post:${externalPostId}`;

      if (!isMarketplaceSource) {
        const postContent = this.buildDeduplicatedEvidenceText(
          post.title,
          post.content,
          2_000,
        );

        if (postContent) {
          inputs.push({
            id: postId,
            sourceType: 'POST',
            title: post.title ?? null,
            content: postContent,
            language: this.parseFastLanguageCode(post.languageCode),
            likesCount: post.likesCount,
            repliesCount: post.repliesCount ?? post.comments.length,
          });
        }
      }

      const evidencePattern =
        /\b(?:cannot|can'?t|unable|not working|does not work|doesn't work|crash(?:es|ed|ing)?|freeze|slow|lag|latency|error|fail(?:s|ed|ing)?|broken|problem|issue|bug|blocked|missing|inaccurate|wrong|unsafe|security|privacy|cost|billing|bill|charged|need|needs|should|please add|feature request|wish|is it possible|can i|could i|how can i|why can'?t i)\b/iu;

      const rankedComments = [...post.comments]
        .filter((comment) => comment.content.trim().length > 0)
        .sort((first, second) => {
          const firstEvidence = evidencePattern.test(first.content) ? 1 : 0;
          const secondEvidence = evidencePattern.test(second.content) ? 1 : 0;

          return (
            secondEvidence - firstEvidence ||
            Math.max(second.likesCount ?? 0, 0) -
              Math.max(first.likesCount ?? 0, 0)
          );
        })
        .slice(0, Math.max(0, maxSavedComments));

      for (const comment of rankedComments) {
        const externalCommentId = comment.externalId.trim();
        if (!externalCommentId) continue;

        inputs.push({
          id: `${sourceKey}:comment:${externalCommentId}`,
          sourceType: 'COMMENT',
          postId,
          title: post.title ?? null,
          content: comment.content.trim().slice(0, 1_200),
          language: this.parseFastLanguageCode(comment.languageCode),
          likesCount: comment.likesCount,
          isComplaintEvidence: this.isProtectedComplaintEvidence(
            comment.content,
            post.title ?? '',
            relevanceTerms,
          ),
          requiresAiSemanticTriage: this.isAiTriageCommentCandidate(
            comment.content,
            post.title ?? '',
            relevanceTerms,
            plannedQueries,
          ),
        });
      }
    }

    return inputs;
  }

  /**
   * Keeps smart all-source collection broad at the network boundary while
   * preventing obvious source-local collisions from entering the raw semantic
   * corpus. Relevant posts always survive. Extra raw candidates must still
   * match the requester object/workflow strongly enough to justify an AI triage
   * token. This is deliberately a pre-filter only: it never promotes evidence
   * and it does not replace Community AI classification.
   */
  private filterFastRawTriageCandidates(
    collectedPosts: readonly CollectorPost[],
    relevantPosts: readonly CollectorPost[],
    sourceKey: string,
    plannedQueries: readonly string[],
    verticalConstraint: RequestVerticalConstraint,
    relevanceTerms: readonly string[],
    requestDescription?: string,
  ): CollectorPost[] {
    if (plannedQueries.length === 0) {
      return [...collectedPosts];
    }

    const normalizedSourceKey = sourceKey.trim().toLocaleLowerCase();
    const relevantIds = new Set(
      relevantPosts.map((post) => post.externalId.trim()).filter(Boolean),
    );
    const normalizedTerms = this.expandTechnicalRelevanceTerms(
      this.normalizeRelevanceTerms(relevanceTerms),
    );
    const commentContainer =
      normalizedSourceKey === 'app-store' ||
      normalizedSourceKey === 'google-play' ||
      normalizedSourceKey === 'youtube';
    const technicalSource = this.isTechnicalCommunitySource(normalizedSourceKey);

    return collectedPosts.filter((post) => {
      if (relevantIds.has(post.externalId.trim())) {
        return true;
      }

      const commentsText = post.comments
        .slice(0, 16)
        .map((comment) => comment.content)
        .join(' ');
      const fullContext = [
        post.title,
        post.content,
        commentsText,
        ...(post.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ');

      if (
        !this.passesBroadDomainCollisionGuard(
          fullContext,
          normalizedTerms,
          verticalConstraint,
        )
      ) {
        return false;
      }

      const verticalAligned = RequestVerticalConstraintUtil.matchesVertical(
        fullContext,
        verticalConstraint,
      );
      const workflowAligned = RequestVerticalConstraintUtil.matchesWorkflow(
        fullContext,
        verticalConstraint,
      );
      const plannedProblemAligned = this.hasPlannedWorkflowProblemAnchor(
        fullContext,
        plannedQueries,
      );
      const plannedSupportingAligned = this.hasPlannedWorkflowSupportingAnchor(
        fullContext,
        plannedQueries,
      );
      const plannedSemanticAligned = this.hasPlannedSemanticOverlap(
        fullContext,
        plannedQueries,
        2,
      );
      const strongDomainAnchor = this.hasStrongDomainAnchor(
        fullContext,
        normalizedTerms,
      );
      const operationalSignal = this.hasSecondaryOperationalProblemSignal(
        fullContext,
      );
      const domainAgnosticSupportingAligned = Boolean(
        requestDescription?.trim() &&
        RequestEvidenceAlignmentUtil.isDomainAgnosticSupportingEvidence({
          requestDescription,
          evidenceText: fullContext,
        }),
      );
      const preAiSemanticTriageCandidate = Boolean(
        requestDescription?.trim() &&
        RequestEvidenceAlignmentUtil.passesPreAiTriageCandidateGuard({
          requestDescription,
          evidenceText: fullContext,
          plannedQueries,
        }),
      );

      /*
       * Reddit/forum are discovery sources whose wording is often informal and
       * incomplete. Keep a bounded, request-shaped raw lane for Community AI
       * instead of demanding full deterministic vertical syntax up front.
       * This does NOT promote the item to trusted evidence; DIRECT/SUPPORTING
       * admission still happens only after semantic triage and verification.
       */
      if (
        ['reddit', 'forum'].includes(normalizedSourceKey) &&
        preAiSemanticTriageCandidate &&
        (plannedSemanticAligned || strongDomainAnchor) &&
        (
          workflowAligned ||
          plannedProblemAligned ||
          plannedSupportingAligned ||
          operationalSignal
        )
      ) {
        return true;
      }

      if (verticalConstraint.strict) {
        /*
         * This branch controls the raw AI-triage persistence lane, not trusted
         * deterministic evidence. A plausible actor/object/problem candidate
         * must be allowed to reach Community AI even when a literal vertical
         * alias is missing from the source text. Final DIRECT/SUPPORTING
         * verification remains downstream and strict.
         */
        if (!verticalAligned) {
          const objectAlignedForAiTriage = Boolean(
            requestDescription?.trim() &&
            RequestQueryProvenanceUtil.hasObjectIdentityOverlap(
              requestDescription,
              fullContext,
            ),
          );
          return (
            preAiSemanticTriageCandidate &&
            objectAlignedForAiTriage &&
            (plannedSemanticAligned || operationalSignal) &&
            (plannedSupportingAligned || plannedProblemAligned || operationalSignal)
          );
        }

        if (commentContainer) {
          const hasCandidateComment = post.comments.some(
            (comment) =>
              this.isProtectedComplaintEvidence(
                comment.content,
                post.title ?? '',
                normalizedTerms,
              ) ||
              this.isAiTriageCommentCandidate(
                comment.content,
                post.title ?? '',
                normalizedTerms,
                plannedQueries,
              ),
          );
          return (
            hasCandidateComment &&
            (workflowAligned || plannedSupportingAligned) &&
            (plannedProblemAligned || plannedSupportingAligned)
          );
        }

        return (
          (workflowAligned &&
            (plannedProblemAligned || plannedSupportingAligned)) ||
          (plannedProblemAligned && operationalSignal) ||
          (plannedSupportingAligned && operationalSignal)
        );
      }

      if (commentContainer) {
        const hasCandidateComment = post.comments.some(
          (comment) =>
            this.isProtectedComplaintEvidence(
              comment.content,
              post.title ?? '',
              normalizedTerms,
            ) ||
            this.isAiTriageCommentCandidate(
              comment.content,
              post.title ?? '',
              normalizedTerms,
              plannedQueries,
            ),
        );
        return (
          hasCandidateComment &&
          (
            domainAgnosticSupportingAligned ||
            (plannedProblemAligned && strongDomainAnchor) ||
            (plannedSemanticAligned && (strongDomainAnchor || operationalSignal))
          )
        );
      }

      if (technicalSource) {
        return (
          domainAgnosticSupportingAligned ||
          (plannedProblemAligned && strongDomainAnchor) ||
          (plannedSemanticAligned && strongDomainAnchor && operationalSignal)
        );
      }

      return (
        domainAgnosticSupportingAligned ||
        (plannedSemanticAligned && operationalSignal) ||
        (strongDomainAnchor &&
          (plannedProblemAligned ||
            (plannedSupportingAligned && operationalSignal)))
      );
    });
  }

  private buildFastTriagePersistencePosts(
    collectedPosts: readonly CollectorPost[],
    relevantPosts: readonly CollectorPost[],
    maxSavedPosts: number,
    maxSavedComments: number,
  ): CollectorPost[] {
    const boundedPostLimit = Math.max(1, Math.floor(maxSavedPosts));
    const boundedCommentLimit = Math.max(0, Math.floor(maxSavedComments));
    const byExternalId = new Map<string, CollectorPost>();

    for (const post of [...relevantPosts, ...collectedPosts]) {
      const externalId = post.externalId.trim();
      if (!externalId) continue;

      const existing = byExternalId.get(externalId);
      if (existing) {
        const mergedComments = new Map(
          [...(existing.comments ?? []), ...(post.comments ?? [])]
            .filter(
              (comment) =>
                comment.externalId.trim().length > 0 &&
                comment.content.trim().length > 0,
            )
            .map((comment) => [comment.externalId.trim(), comment] as const),
        );
        byExternalId.set(externalId, {
          ...existing,
          comments: [...mergedComments.values()].slice(0, boundedCommentLimit),
        });
        continue;
      }

      if (byExternalId.size >= boundedPostLimit) continue;
      byExternalId.set(externalId, {
        ...post,
        comments: [...(post.comments ?? [])]
          .filter(
            (comment) =>
              comment.externalId.trim().length > 0 &&
              comment.content.trim().length > 0,
          )
          .slice(0, boundedCommentLimit),
      });
    }

    let remainingComments = boundedCommentLimit;
    return [...byExternalId.values()].map((post) => {
      const comments = post.comments.slice(0, Math.max(0, remainingComments));
      remainingComments -= comments.length;
      return { ...post, comments };
    });
  }

  private buildDeduplicatedEvidenceText(
    title: string | null | undefined,
    content: string | null | undefined,
    maxLength: number,
  ): string {
    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .trim();

    const normalizedTitle = normalize(title ?? '');
    let normalizedBody = normalize(content ?? '');

    /*
     * Several RSS/search adapters return a title inside both title and content,
     * sometimes repeated three or four times. Keep the title once and remove
     * exact copies from the body before Community AI sees the item. This is
     * token hygiene only; it never merges separate posts or changes evidence
     * identity/provenance.
     */
    if (normalizedTitle && normalizedBody) {
      const escapedTitle = normalizedTitle.replace(
        /[.*+?^${}()|[\]\\]/gu,
        '\\$&',
      );
      normalizedBody = normalizedBody
        .replace(new RegExp(escapedTitle, 'giu'), ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    }

    const collapseExactTokenRepetition = (value: string): string => {
      const tokens = value.split(/\s+/u).filter(Boolean);
      if (tokens.length < 6) return value;
      for (let repetitions = 4; repetitions >= 2; repetitions -= 1) {
        if (tokens.length % repetitions !== 0) continue;
        const width = tokens.length / repetitions;
        const first = tokens.slice(0, width).join(' ');
        let allEqual = true;
        for (let index = 1; index < repetitions; index += 1) {
          if (tokens.slice(index * width, (index + 1) * width).join(' ') !== first) {
            allEqual = false;
            break;
          }
        }
        if (allEqual) return first;
      }
      return value;
    };

    normalizedBody = collapseExactTokenRepetition(normalizedBody);
    return [normalizedTitle, normalizedBody]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, Math.max(1, maxLength));
  }

  private deduplicateFastEvidenceInputs(
    inputs: readonly IntelligentTextInput[],
  ): IntelligentTextInput[] {
    const output: IntelligentTextInput[] = [];
    const seen = new Set<string>();

    for (const input of inputs) {
      const key = [
        input.sourceKey ?? '',
        input.sourceType,
        input.id,
        input.postId ?? '',
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ ...input });
    }

    return output;
  }

  private parseFastLanguageCode(
    value: string | null | undefined,
  ): LanguageCode | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase().replace('_', '-');
    const primary = normalized.split('-')[0];
    const map: Readonly<Record<string, LanguageCode>> = {
      ar: LanguageCode.AR,
      en: LanguageCode.EN,
      fr: LanguageCode.FR,
      es: LanguageCode.ES,
      de: LanguageCode.DE,
      tr: LanguageCode.TR,
    };
    return map[normalized] ?? map[primary] ?? null;
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
  private passesFastRawTriageIdentityGate(
    post: CollectorPost,
    verticalConstraint: RequestVerticalConstraint,
    requestDescription: string,
  ): boolean {
    if (!requestDescription) return true;
    const evidenceText = `${post.title ?? ''} ${post.content ?? ''}`.replace(/\s+/gu, ' ').trim();
    if (!evidenceText) return false;

    if (verticalConstraint.kind === 'ONLINE_PHARMACY_FRAUD') {
      return RequestOnlinePharmacyFraudUtil.isPlausibleRetrievalCandidate(
        requestDescription,
        evidenceText,
      );
    }

    if (
      verticalConstraint.kind === 'CUSTOM_SPECIFICATION_SERVICE' &&
      RequestNicheCustomCraftUtil.resolve(requestDescription)
    ) {
      return RequestNicheCustomCraftUtil.isPlausibleRetrievalCandidate(
        requestDescription,
        evidenceText,
      );
    }

    /*
     * Every strict request must enforce requester identity before raw
     * persistence. Previously only Online Pharmacy and custom-craft requests
     * used this gate, so a PHYSICAL_SERVICE_VERTICAL post could be rejected by
     * central relevance and still leak into rawEvidenceCorpus for Community AI.
     *
     * The fallback classifier is intentionally SUPPORTING-aware: same-mechanism
     * evidence from an adjacent selected domain may survive, while lexical
     * collisions such as concrete/steel hinges for eyeglass repair do not.
     */
    if (verticalConstraint.strict) {
      const requestClassification =
        RequestEvidenceAlignmentUtil.classifyForRequestFallback({
          requestDescription,
          evidenceText,
        });
      if (requestClassification !== 'UNRELATED') return true;

      const verticalAligned = RequestVerticalConstraintUtil.matchesVertical(
        evidenceText,
        verticalConstraint,
      );
      const workflowAligned = RequestVerticalConstraintUtil.matchesWorkflow(
        evidenceText,
        verticalConstraint,
      );
      const concreteProblem =
        /\b(?:wrong|incorrect|inaccurate|missing|lost|forgotten|mismatch|mismatched|repeat(?:ed)?|rework|delay(?:ed)?|late|waste(?:d)?|shortage|interruption|downtime|cost|expense|loss|profit|margin|fragmented|scattered|siloed|difficult|hard to|failure|failed|problem|issue)\w*\b/iu.test(
          evidenceText,
        );
      return verticalAligned && workflowAligned && concreteProblem;
    }

    // Non-strict/general workflows keep the broad bounded corpus for semantic
    // discovery so the stricter policy above does not reduce generic recall.
    return true;
  }

  private filterRelevantPosts(
    posts: CollectorPost[],
    relevanceTerms: string[],
    collectionMode?: CollectorInput['collectionMode'],
    sourceKey?: string,
    plannedQueries: readonly string[] = [],
    verticalConstraint: RequestVerticalConstraint = RequestVerticalConstraintUtil.resolve({}),
    requestDescription?: string,
  ): CollectorPost[] {
    const hasPlannedQueries = plannedQueries.length > 0;
    const normalizedTerms = this.expandTechnicalRelevanceTerms(
      this.normalizeRelevanceTerms(relevanceTerms),
    );
    const minimumScore = this.resolveMinimumRelevanceScore(
      sourceKey,
      collectionMode,
    );

    if (!normalizedTerms.length) {
      return posts;
    }

    return posts.flatMap((post) => {
      const normalizedTags = this.normalizeRelevanceTerms(post.tags ?? []);

      const commentsBody = post.comments
        .slice(0, 20)
        .map((comment: { readonly content: string }) => comment.content)
        .join(' ');

      const isMarketplaceSource =
        sourceKey === 'google-play' || sourceKey === 'app-store';
      const isCommentContainerSource =
        isMarketplaceSource || sourceKey === 'youtube';

      const directEvidenceBody = isMarketplaceSource
        ? [commentsBody, ...normalizedTags].filter(Boolean).join(' ')
        : [post.content, commentsBody, ...normalizedTags]
            .filter(Boolean)
            .join(' ');
      const fullEvidenceContext = [
        post.title,
        post.content,
        commentsBody,
        ...normalizedTags,
      ]
        .filter(Boolean)
        .join(' ');
      const verticalAnchorGuard =
        RequestVerticalConstraintUtil.matchesVertical(
          fullEvidenceContext,
          verticalConstraint,
        );
      const verticalWorkflowSignal =
        RequestVerticalConstraintUtil.matchesWorkflow(
          fullEvidenceContext,
          verticalConstraint,
        );
      const strictWorkflowGuard =
        !hasPlannedQueries ||
        !verticalConstraint.strict ||
        verticalWorkflowSignal;

      /*
       * Marketplace descriptions remain excluded from evidence scoring.
       * Their title/content may still establish that the parent application is
       * domain relevant, allowing independently problematic reviews to survive.
       */
      const baseScore = RelevanceScoreUtil.scoreText({
        title: isMarketplaceSource ? '' : post.title,

        body: directEvidenceBody,

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
        baseScore >= minimumScore ||
        (hasExactSourceTagMatch && baseScore >= Math.max(30, minimumScore - 5));
      const passesGenericTitleGuard = this.passesGenericTitleGuard(
        post,
        normalizedTerms,
        normalizedTags,
        hasExactSourceTagMatch,
      );
      const hasCommunityProblemSignal =
        this.hasCommunityProblemSignal(post, sourceKey);
      const complaintComments = post.comments.filter((comment) =>
        this.isProtectedComplaintEvidence(
          comment.content,
          post.title ?? '',
          normalizedTerms,
        ),
      );
      const hasComplaintComment = complaintComments.length > 0;
      const aiTriageComments = post.comments.filter((comment) =>
        this.isAiTriageCommentCandidate(
          comment.content,
          post.title ?? '',
          normalizedTerms,
          plannedQueries,
        ),
      );
      const plannedEvidenceAlignmentGuard =
        !hasPlannedQueries ||
        this.hasPlannedWorkflowProblemAnchor(
          [post.title, post.content, commentsBody].filter(Boolean).join(' '),
          plannedQueries,
        );
      const plannedContainerAnchorGuard =
        !isCommentContainerSource || plannedEvidenceAlignmentGuard;
      const broadDomainCollisionGuard = this.passesBroadDomainCollisionGuard(
        fullEvidenceContext,
        normalizedTerms,
        verticalConstraint,
      );

      const containerDomainScore = isCommentContainerSource
        ? RelevanceScoreUtil.scoreText({
            title: post.title,
            body: [post.content, ...normalizedTags].filter(Boolean).join(' '),
            domainTerms: normalizedTerms,
            problemTerms: [],
            publishedAt: post.publishedAt,
          })
        : 0;

      const technicalProblemOverride =
        this.isTechnicalCommunitySource(sourceKey) &&
        hasCommunityProblemSignal &&
        this.hasTechnicalDomainAlias(
          [post.title, post.content, commentsBody].filter(Boolean).join(' '),
          normalizedTerms,
        );

      const secondaryOperationalSource =
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog' ||
        sourceKey === 'youtube' ||
        sourceKey === 'hacker-news' ||
        sourceKey === 'forum';

      const requestEvidenceText = [post.title, post.content]
        .filter(Boolean)
        .join(' ');
      const requestSemanticCandidateAdmission =
        !requestDescription?.trim() ||
        RequestEvidenceAlignmentUtil.passesPreAiTriageCandidateGuard({
          requestDescription,
          evidenceText: requestEvidenceText,
          plannedQueries,
        });
      const compositeRequestCandidateAdmission =
        Boolean(requestDescription?.trim()) &&
        RequestEvidenceAlignmentUtil.passesCompositeEvidenceCandidateGuard({
          requestDescription,
          evidenceText: requestEvidenceText,
          plannedQueries,
        });
      const atomicRequestPainAdmission =
        Boolean(requestDescription?.trim()) &&
        RequestEvidenceAlignmentUtil.passesAtomicSupportingProblemGuard({
          requestDescription,
          evidenceText: requestEvidenceText,
          plannedQueries,
        });
      const strictRequestSemanticAdmission =
        !requestDescription?.trim() ||
        requestSemanticCandidateAdmission ||
        compositeRequestCandidateAdmission ||
        atomicRequestPainAdmission;
      const requestIntentFamily = requestDescription?.trim()
        ? RequestWorkflowIntentProfileUtil.resolve(requestDescription).family
        : 'GENERAL';
      /*
       * Reddit is intentionally broad and lexical scoring can otherwise admit
       * relationship/AITAH posts through generic words such as expenses,
       * account, restrictions, delayed, or family. For transaction/account
       * abuse requests, require the dedicated request-aware semantic candidate
       * contract before the item may enter the broad first-pass lane.
       */
      const noisyCommunitySemanticGuard =
        sourceKey !== 'reddit' ||
        requestIntentFamily !== 'TRANSACTION_ACCOUNT_ABUSE' ||
        requestSemanticCandidateAdmission;


      /*
       * Composite evidence needs partial but semantically specific observations
       * to survive long enough to be synthesized later. For strict text-derived
       * workflows, retain a bounded supporting-candidate lane when the source is
       * independently relevant and matches the exact vertical + workflow
       * identity, even if it does not state the entire friction chain in one
       * text. This does not promote the item to verified evidence; the
       * idea-generation evidence alignment and independent verification stages
       * remain authoritative.
       */
      const plannedCompositeSupportingOverride =
        hasPlannedQueries &&
        (collectionMode === 'FAST_GENERATION' ||
          collectionMode === 'TARGETED_RECOVERY') &&
        secondaryOperationalSource &&
        sourceKey !== 'youtube' &&
        strictRequestSemanticAdmission &&
        compositeRequestCandidateAdmission &&
        verticalAnchorGuard &&
        verticalWorkflowSignal &&
        broadDomainCollisionGuard &&
        hasMinimumIndependentRelevance &&
        passesGenericTitleGuard &&
        this.hasPlannedWorkflowSupportingAnchor(
          [post.title, post.content].filter(Boolean).join(' '),
          plannedQueries,
        );

      const plannedSecondaryEvidenceOverride =
        hasPlannedQueries &&
        (collectionMode === 'FAST_GENERATION' || collectionMode === 'TARGETED_RECOVERY') &&
        secondaryOperationalSource &&
        strictRequestSemanticAdmission &&
        verticalAnchorGuard &&
        (verticalWorkflowSignal ||
          this.hasSecondaryOperationalProblemSignal(
            [post.title, post.content].filter(Boolean).join(' '),
          )) &&
        this.hasStrongDomainAnchor(
          [post.title, post.content, commentsBody].filter(Boolean).join(' '),
          normalizedTerms,
        ) &&
        plannedEvidenceAlignmentGuard &&
        plannedContainerAnchorGuard;

      const adaptiveRequestEvidenceOverride =
        hasPlannedQueries &&
        (collectionMode === 'FAST_GENERATION' ||
          collectionMode === 'TARGETED_RECOVERY') &&
        secondaryOperationalSource &&
        strictRequestSemanticAdmission &&
        verticalAnchorGuard &&
        verticalWorkflowSignal &&
        plannedEvidenceAlignmentGuard &&
        plannedContainerAnchorGuard &&
        (verticalConstraint.strict ||
          this.hasStrongDomainAnchor(
            [post.title, post.content, commentsBody].filter(Boolean).join(' '),
            normalizedTerms,
          )) &&
        this.hasSecondaryOperationalProblemSignal(
          [post.title, post.content, commentsBody].filter(Boolean).join(' '),
        );

      const domainAgnosticSupportingOverride =
        hasPlannedQueries &&
        Boolean(requestDescription?.trim()) &&
        (collectionMode === 'FAST_GENERATION' ||
          collectionMode === 'TARGETED_RECOVERY') &&
        secondaryOperationalSource &&
        broadDomainCollisionGuard &&
        passesGenericTitleGuard &&
        RequestEvidenceAlignmentUtil.isDomainAgnosticSupportingEvidence({
          requestDescription,
          evidenceText: [post.title, post.content].filter(Boolean).join(' '),
        });
      const domainAgnosticCommentSupportingOverride = Boolean(
        requestDescription?.trim() &&
        post.comments.slice(0, 16).some((comment) =>
          RequestEvidenceAlignmentUtil.isDomainAgnosticSupportingEvidence({
            requestDescription,
            evidenceText: [post.title, comment.content].filter(Boolean).join(' '),
          }),
        ),
      );
      const requestDerivedAdmissionGuard =
        !requestDescription?.trim() ||
        verticalConstraint.strict ||
        domainAgnosticSupportingOverride ||
        domainAgnosticCommentSupportingOverride;

      /*
       * Secondary research/news can support one exact pain/workflow without
       * naming the request's business vertical literally (for example a fraud
       * false-positive study that documents review cost/customer friction).
       * Keep such material only as an AI-triage candidate when it matches the
       * AI-planned workflow and problem signal. This bypasses only the literal
       * vertical-name admission check; it never upgrades the item to DIRECT
       * evidence and final Community AI + deterministic provenance guards stay
       * authoritative.
       */
      const secondarySemanticTriageAdmission =
        hasPlannedQueries &&
        (collectionMode === 'FAST_GENERATION' ||
          collectionMode === 'TARGETED_RECOVERY') &&
        secondaryOperationalSource &&
        !verticalAnchorGuard &&
        strictWorkflowGuard &&
        broadDomainCollisionGuard &&
        passesGenericTitleGuard &&
        plannedEvidenceAlignmentGuard &&
        domainAgnosticSupportingOverride &&
        this.hasSecondaryOperationalProblemSignal(
          [post.title, post.content].filter(Boolean).join(' '),
        );

      /*
       * Rescue exact requester-pain evidence even when generic relevance
       * scoring under-rates a proper noun/platform name. This is an additive
       * lane only: it does not remove broad discovery candidates. A specific
       * property-management platform breach, for example, can reach AI triage
       * even when the title contains a brand name that the lexical scorer does
       * not know.
       */
      const requestPainAlignedLowScoreOverride =
        Boolean(requestDescription?.trim()) &&
        (collectionMode === 'FAST_GENERATION' ||
          collectionMode === 'TARGETED_RECOVERY') &&
        secondaryOperationalSource &&
        passesGenericTitleGuard &&
        broadDomainCollisionGuard &&
        atomicRequestPainAdmission;

      /*
       * Wide first-pass semantic lane. The collectors are intentionally broad,
       * so do not require every useful candidate to already look like a full
       * complaint/problem statement before Community AI sees it. A candidate
       * may enter this lane only when the request-aware admission guard accepts
       * it and either exact vertical/object identity or domain-agnostic
       * supporting semantics are present. It is still RAW evidence only; AI
       * classification plus deterministic verification remain authoritative.
       */
      const broadFirstPassWorkflowIdentityRequired =
        verticalConstraint.kind === 'CUSTOM_SPECIFICATION_SERVICE' ||
        verticalConstraint.kind === 'PUBLIC_PROGRAM_COST_ATTRIBUTION' ||
        verticalConstraint.kind === 'OPERATIONAL_COST_ATTRIBUTION';
      const broadFirstPassSemanticTriageOverride =
        Boolean(requestDescription?.trim()) &&
        collectionMode === 'FAST_GENERATION' &&
        strictRequestSemanticAdmission &&
        (!broadFirstPassWorkflowIdentityRequired || verticalWorkflowSignal) &&
        (requestSemanticCandidateAdmission ||
          compositeRequestCandidateAdmission ||
          atomicRequestPainAdmission) &&
        broadDomainCollisionGuard &&
        passesGenericTitleGuard &&
        hasMinimumIndependentRelevance &&
        noisyCommunitySemanticGuard &&
        (verticalAnchorGuard || domainAgnosticSupportingOverride) &&
        (secondaryOperationalSource ||
          sourceKey === 'reddit' ||
          sourceKey === 'app-store' ||
          sourceKey === 'google-play');

      const targetedRecoveryRequiresExactWorkflow =
        verticalConstraint.kind === 'PUBLIC_PROGRAM_COST_ATTRIBUTION' ||
        verticalConstraint.kind === 'OPERATIONAL_COST_ATTRIBUTION';
      const targetedRecoveryDomainProblemOverride =
        collectionMode === 'TARGETED_RECOVERY' &&
        secondaryOperationalSource &&
        strictRequestSemanticAdmission &&
        verticalAnchorGuard &&
        broadDomainCollisionGuard &&
        this.hasStrongDomainAnchor(
          [post.title, post.content, commentsBody].filter(Boolean).join(' '),
          normalizedTerms,
        ) &&
        this.hasSecondaryOperationalProblemSignal(
          [post.title, post.content, commentsBody].filter(Boolean).join(' '),
        ) &&
        (targetedRecoveryRequiresExactWorkflow
          ? verticalWorkflowSignal
          : (verticalWorkflowSignal || plannedEvidenceAlignmentGuard));

      const commentContainerOverride =
        isCommentContainerSource &&
        hasComplaintComment &&
        plannedContainerAnchorGuard &&
        containerDomainScore >=
          this.resolveContainerDomainMinimum(sourceKey, collectionMode);

      /*
       * Fast generation also retains a very small AI-triage lane for comments
       * that describe concrete friction but are not yet confidently typed as a
       * complaint by deterministic rules. The parent still has to be a valid
       * domain/workflow container. Community AI performs the semantic analysis
       * later; final evidence verification remains authoritative.
       */
      const aiTriageContainerOverride =
        isCommentContainerSource &&
        (collectionMode === 'FAST_GENERATION' ||
          collectionMode === 'TARGETED_RECOVERY') &&
        aiTriageComments.length > 0 &&
        plannedContainerAnchorGuard &&
        verticalAnchorGuard &&
        (!verticalConstraint.strict || verticalWorkflowSignal) &&
        broadDomainCollisionGuard &&
        containerDomainScore >=
          Math.max(18, this.resolveContainerDomainMinimum(sourceKey, collectionMode) - 8);

      const accepted =
        requestPainAlignedLowScoreOverride ||
        broadFirstPassSemanticTriageOverride ||
        secondarySemanticTriageAdmission ||
        (verticalAnchorGuard &&
        strictWorkflowGuard &&
        broadDomainCollisionGuard &&
        requestDerivedAdmissionGuard &&
        ((hasMinimumIndependentRelevance &&
          finalScore >= minimumScore &&
          passesGenericTitleGuard &&
          plannedContainerAnchorGuard &&
          (hasCommunityProblemSignal || plannedSecondaryEvidenceOverride)) ||
        technicalProblemOverride ||
        commentContainerOverride ||
        aiTriageContainerOverride ||
        plannedCompositeSupportingOverride ||
        plannedSecondaryEvidenceOverride ||
        adaptiveRequestEvidenceOverride ||
        domainAgnosticSupportingOverride ||
        targetedRecoveryDomainProblemOverride));

      this.logger.debug(
        [
          'Central relevance evaluation',
          `title="${post.title}"`,
          `baseScore=${baseScore}`,
          `sourceTagBonus=${sourceTagBonus}`,
          `finalScore=${finalScore}`,
          `minimum=${minimumScore}`,
          `collectionMode=${collectionMode ?? 'STANDARD'}`,
          `independentRelevance=${hasMinimumIndependentRelevance}`,
          `genericTitleGuard=${passesGenericTitleGuard}`,
          `communityProblemSignal=${hasCommunityProblemSignal}`,
          `publisherCopyExcluded=${isMarketplaceSource}`,
          `technicalProblemOverride=${technicalProblemOverride}`,
          `plannedEvidenceAlignmentGuard=${plannedEvidenceAlignmentGuard}`,
          `plannedSecondaryEvidenceOverride=${plannedSecondaryEvidenceOverride}`,
          `adaptiveRequestEvidenceOverride=${adaptiveRequestEvidenceOverride}`,
          `domainAgnosticSupportingOverride=${domainAgnosticSupportingOverride}`,
          `domainAgnosticCommentSupportingOverride=${domainAgnosticCommentSupportingOverride}`,
          `requestDerivedAdmissionGuard=${requestDerivedAdmissionGuard}`,
          `atomicRequestPainAdmission=${atomicRequestPainAdmission}`,
          `requestPainAlignedLowScoreOverride=${requestPainAlignedLowScoreOverride}`,
          `secondarySemanticTriageAdmission=${secondarySemanticTriageAdmission}`,
          `broadFirstPassSemanticTriageOverride=${broadFirstPassSemanticTriageOverride}`,
          `noisyCommunitySemanticGuard=${noisyCommunitySemanticGuard}`,
          `targetedRecoveryDomainProblemOverride=${targetedRecoveryDomainProblemOverride}`,
          `verticalKind=${verticalConstraint.kind}`,
          `verticalAnchorGuard=${verticalAnchorGuard}`,
          `verticalWorkflowSignal=${verticalWorkflowSignal}`,
          `strictWorkflowGuard=${strictWorkflowGuard}`,
          `commentContainerOverride=${commentContainerOverride}`,
          `aiTriageContainerOverride=${aiTriageContainerOverride}`,
          `plannedCompositeSupportingOverride=${plannedCompositeSupportingOverride}`,
          `strictRequestSemanticAdmission=${strictRequestSemanticAdmission}`,
          `complaintComments=${complaintComments.length}`,
          `aiTriageComments=${aiTriageComments.length}`,
          `accepted=${accepted}`,
        ].join(' | '),
      );

      if (!accepted) {
        return [];
      }

      /*
       * For app stores and YouTube, retain only independently problematic user
       * comments when the parent is accepted as a domain container. The neutral
       * publisher/video description is not treated as community evidence.
       */
      if (commentContainerOverride || aiTriageContainerOverride) {
        const retainedComments = [...complaintComments, ...aiTriageComments]
          .filter(
            (comment, index, values) =>
              values.findIndex((candidate) => candidate.externalId === comment.externalId) ===
              index,
          )
          .slice(0, collectionMode === 'TARGETED_RECOVERY' ? 5 : 8);
        return [
          {
            ...post,
            comments: retainedComments,
          },
        ];
      }

      return [post];
    });
  }

  private selectSupportingFallbackPosts(
    posts: CollectorPost[],
    relevanceTerms: string[],
    collectionMode?: CollectorInput['collectionMode'],
    sourceKey?: string,
    plannedQueries: readonly string[] = [],
    verticalConstraint: RequestVerticalConstraint = RequestVerticalConstraintUtil.resolve({}),
    requestDescription?: string,
  ): CollectorPost[] {
    if (collectionMode !== 'FAST_GENERATION' && collectionMode !== 'TARGETED_RECOVERY') {
      return [];
    }

    const normalizedTerms = this.expandTechnicalRelevanceTerms(
      this.normalizeRelevanceTerms(relevanceTerms),
    );
    if (normalizedTerms.length === 0) return [];

    const retained: CollectorPost[] = [];
    for (const post of posts) {
      const commentsBody = post.comments
        .slice(0, 20)
        .map((comment) => comment.content)
        .join(' ');
      const fullContext = [
        post.title,
        post.content,
        commentsBody,
        ...(post.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ');

      const verticalAnchor = RequestVerticalConstraintUtil.matchesVertical(
        fullContext,
        verticalConstraint,
      );
      const workflowAnchor = RequestVerticalConstraintUtil.matchesWorkflow(
        fullContext,
        verticalConstraint,
      );
      const strongDomainAnchor = this.hasStrongDomainAnchor(
        fullContext,
        normalizedTerms,
      );
      const broadDomainCollisionGuard = this.passesBroadDomainCollisionGuard(
        fullContext,
        normalizedTerms,
        verticalConstraint,
      );
      const problemSignal =
        this.hasCommunityProblemSignal(post, sourceKey) ||
        this.hasSecondaryOperationalProblemSignal(fullContext);
      const plannedAnchor =
        plannedQueries.length === 0 ||
        this.hasPlannedWorkflowProblemAnchor(fullContext, plannedQueries);

      const domainAgnosticSupport = Boolean(
        requestDescription?.trim() &&
        RequestEvidenceAlignmentUtil.isDomainAgnosticSupportingEvidence({
          requestDescription,
          evidenceText: fullContext,
        }),
      );
      const requestSpecificFallbackClassification = requestDescription?.trim()
        ? RequestEvidenceAlignmentUtil.classifyForRequestFallback({
            requestDescription,
            evidenceText: fullContext,
            plannedQueries,
          })
        : 'SUPPORTING_SIGNAL';
      const requestSpecificSupport =
        !requestDescription?.trim() ||
        domainAgnosticSupport ||
        requestSpecificFallbackClassification !== 'UNRELATED';

      if (
        !broadDomainCollisionGuard ||
        !requestSpecificSupport ||
        (!domainAgnosticSupport && (!strongDomainAnchor || !problemSignal)) ||
        (verticalConstraint.strict && !verticalAnchor) ||
        (collectionMode === 'FAST_GENERATION' &&
          verticalConstraint.strict &&
          !workflowAnchor &&
          !plannedAnchor)
      ) {
        continue;
      }

      if (sourceKey === 'google-play' || sourceKey === 'app-store') {
        const complaintComments = post.comments
          .filter((comment: { readonly content: string; readonly externalId: string }) =>
            this.isProtectedComplaintEvidence(
              comment.content,
              post.title ?? '',
              normalizedTerms,
            ),
          )
          .slice(0, 4);
        if (complaintComments.length === 0) continue;
        retained.push({ ...post, comments: complaintComments });
      } else {
        retained.push(post);
      }

      if (retained.length >= 2) break;
    }

    if (retained.length > 0) {
      this.logger.debug(
        `Retained ${retained.length} workflow-adjacent external evidence item(s) from ${sourceKey ?? 'unknown'} after the strict relevance lane returned zero.`,
      );
    }

    return retained;
  }

  /**
   * Requires at least one concrete community problem, need, complaint, or
   * feature-request signal before a post can enter the evidence corpus.
   *
   * The check includes comments because marketplace listings often have a
   * neutral title while their reviews contain the actual user problems.
   */
  private hasCommunityProblemSignal(
    post: CollectorPost,
    sourceKey?: string,
  ): boolean {
    const commentsText = post.comments
      .slice(0, 20)
      .map((comment) => comment.content)
      .join(' ');

    // Marketplace descriptions are publisher marketing copy. They may describe
    // capabilities such as "adapts to your mood" but are not user complaints.
    // For app stores, only reviews/comments may establish a community problem.
    if (sourceKey === 'google-play' || sourceKey === 'app-store') {
      return this.hasComplaintSignal(commentsText);
    }

    const content = [post.title, post.content, commentsText]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return this.hasComplaintSignal(content);
  }


  /**
   * Marks only direct, domain-aligned user pain as protected evidence.
   * Generic educational questions, moments of understanding, praise, and
   * broad words such as "optimization" must not become complaint evidence.
   */
  private isProtectedComplaintEvidence(
    comment: string,
    parentTitle: string,
    relevanceTerms: readonly string[],
  ): boolean {
    const normalizedComment = comment
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();

    if (normalizedComment.length < 12) {
      return false;
    }

    const evidenceKind = classifyDirectCommunityEvidence(
      normalizedComment,
      'COMMENT',
    );

    if (
      evidenceKind !== 'USER_COMPLAINT' &&
      evidenceKind !== 'FEATURE_REQUEST'
    ) {
      return false;
    }

    return this.hasStrongDomainAnchor(
      `${parentTitle} ${comment}`,
      relevanceTerms,
    );
  }

  /**
   * Requires a substantive domain anchor. Generic workflow/product words are
   * ignored so "Optimization Problems in Calculus" cannot become Agriculture
   * evidence merely because the domain contains "agriculture optimization".
   */
  private isAiTriageCommentCandidate(
    comment: string,
    parentTitle: string,
    relevanceTerms: readonly string[],
    plannedQueries: readonly string[],
  ): boolean {
    const normalized = comment
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    if (normalized.length < 20) return false;

    const evidenceKind = classifyDirectCommunityEvidence(normalized, 'COMMENT');
    const directSemanticCandidate =
      evidenceKind === 'USER_COMPLAINT' ||
      evidenceKind === 'FEATURE_REQUEST' ||
      evidenceKind === 'OBSERVED_UNMET_NEED';
    const concreteFriction = /\b(?:cannot|can['’]?t|unable|failed|failure|broken|missing|lost|forgot|wrong|incorrect|inconsistent|confusing|delay|delayed|slow|stuck|crash|unavailable|restricted|blocked|problem|issue|frustrat|disappoint|wish|need|should|please add|keeps?|doesn['’]?t|does not|didn['’]?t|did not)\w*\b/iu.test(
      normalized,
    );
    if (!directSemanticCandidate && !concreteFriction) return false;

    const context = `${parentTitle} ${comment}`;
    if (!this.hasStrongDomainAnchor(context, relevanceTerms)) return false;

    return (
      plannedQueries.length === 0 ||
      this.hasPlannedWorkflowProblemAnchor(context, plannedQueries)
    );
  }

  private hasStrongDomainAnchor(
    value: string,
    relevanceTerms: readonly string[],
  ): boolean {
    const normalizedValue = value.normalize('NFKC').toLowerCase();
    const genericTokens = new Set([
      'app', 'application', 'platform', 'software', 'system', 'service',
      'technology', 'management', 'monitoring', 'automation', 'optimization',
      'prediction', 'recommendation', 'integration', 'analytics', 'dashboard',
      'problem', 'problems', 'workflow', 'tool', 'tools',
    ]);

    const anchors = new Set<string>();
    for (const term of relevanceTerms) {
      const normalizedTerm = term.normalize('NFKC').toLowerCase().trim();
      if (!normalizedTerm) continue;
      for (const token of normalizedTerm.split(/\s+/u)) {
        if (token.length >= 4 && !genericTokens.has(token)) anchors.add(token);
      }
    }

    return [...anchors].some((anchor) =>
      new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{M}\\p{N}])`, 'u').test(normalizedValue),
    );
  }

  /**
   * Detects direct complaints, failed workflows, incorrect data, and feature
   * requests in user-controlled text.
   */
  private hasComplaintSignal(value: string): boolean {
    const kind = classifyDirectCommunityEvidence(value, 'POST');
    return kind === 'USER_COMPLAINT' || kind === 'FEATURE_REQUEST';
  }


  /**
   * Recognizes a partial, workflow-specific observation that may participate in
   * composite evidence. It is intentionally narrower than broad domain
   * relevance and never makes the observation verified by itself.
   */
  private hasPlannedWorkflowSupportingAnchor(
    value: string,
    plannedQueries: readonly string[],
  ): boolean {
    const normalizedValue = value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    const planned = plannedQueries
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase();
    if (!normalizedValue || !planned) return false;

    const hospitalOperatingRoomRequest =
      /\b(?:hospital|hospitals|healthcare|medical center|medical centers)\b/iu.test(planned) &&
      /\b(?:operating rooms?|operating theatres?|operating theaters?|surgical suites?|surgery schedules?|surgical schedules?|surgeries|procedures)\b/iu.test(planned) &&
      /\b(?:medical staff|staffing|equipment availability|emergency cases?|resource allocation|room turnover|reschedul|operating room utilization|idle operating rooms?|delayed procedures?)\w*\b/iu.test(planned);
    if (hospitalOperatingRoomRequest) {
      const setting =
        /\b(?:operating rooms?|operating theatres?|operating theaters?|surgical suites?|surgeries|surgery|surgical|procedure|procedures)\b/iu.test(normalizedValue);
      const workflowOrFriction =
        /\b(?:surgery schedule|surgical schedule|operating room schedule|staff availability|medical staff|staffing|surgeon|nurse|equipment availability|emergency case|urgent patient|resource allocation|room turnover|reschedul|repriorit|schedule conflict|operating room utilization|delay|idle|underutilized|overworked|shortage|unavailable|bottleneck)\w*\b/iu.test(normalizedValue);
      const supplyOnly =
        /\b(?:pharmacy inventory|medical supplies?|blood products?|supplier delivery|supply chain)\b/iu.test(normalizedValue) &&
        !setting;
      return setting && workflowOrFriction && !supplyOnly;
    }

    const restaurantDeliveryFraudRequest =
      /\b(?:restaurant delivery|food delivery|online food ordering|meal delivery|delivery app|restaurant courier)\b/iu.test(planned) &&
      /\b(?:fraud|suspicious order|account takeover|refund abuse|promotional abuse|promo abuse|payment behavior|device signal|customer complaint|security alert|false positive|blocked legitimate|coordinated abuse)\w*\b/iu.test(planned);
    if (restaurantDeliveryFraudRequest) {
      const actor = /\b(?:restaurant delivery|food delivery|online food ordering|meal delivery|delivery app|restaurant courier|doordash|uber eats|ubereats|grubhub|deliveroo|foodpanda|talabat|instacart)\b/iu.test(normalizedValue);
      const fraudAxis = /\b(?:fraud|fraudulent|suspicious order|account takeover|refund abuse|refund fraud|promotional abuse|promo code abuse|payment fraud|payment behavior|device signal|device risk|customer complaint|security alert|false positive|blocked legitimate|account deactivated|coordinated abuse|chargeback abuse|coupon abuse)\w*\b/iu.test(normalizedValue);
      const shipmentOnly = /\b(?:carrier scan|proof of delivery|shipping address|warehouse handoff|warehouse update|parcel tracking|shipment chain of custody|lost merchandise|freight|cargo)\b/iu.test(normalizedValue) &&
        !/\b(?:food delivery|restaurant delivery|refund abuse|account takeover|promo|device|false positive)\b/iu.test(normalizedValue);
      return actor && fraudAxis && !shipmentOnly;
    }

    const agriculturalExportProfitabilityRequest =
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export|fresh produce|produce shipment|cold chain)\b/iu.test(planned) &&
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|market prices?|spoilage|shipment profitability|profit margins?|profit estimates?|supplier payments?|sales revenues?|financial losses?|route profitability|distribution stages?)\b/iu.test(planned);
    if (agriculturalExportProfitabilityRequest) {
      const context = /\b(?:agricultural exports?|agricultural exporters?|produce exports?|produce exporters?|fresh produce exports?|fresh produce exporters?|fruit exports?|fruit exporters?|vegetable exports?|vegetable exporters?|perishable produce|cold chain|produce shipments?|produce logistics|postharvest|post-harvest)\b/iu.test(normalizedValue);
      const logisticsFacet = /\b(?:transport(?:ation)? delay|delivery delay|storage|warehouse|shipment|distribution|route|logistics|spoilage|spoiled|quality loss|temperature excursion|postharvest loss)\w*\b/iu.test(normalizedValue);
      const financialFacet = /\b(?:storage cost|warehouse expense|transport cost|logistics cost|market price|price volatility|supplier payment|sales revenue|profitability|profit margin|profit estimate|financial loss|margin|revenue|route profitability)\w*\b/iu.test(normalizedValue);
      const fragmentedFacet = /\b(?:separate systems?|reviewed separately|fragmented|siloed|visibility gap|cost visibility|profit visibility|reconciliation|hard to determine|difficult to determine|which routes?|which products?|distribution stages?)\w*\b/iu.test(normalizedValue);
      const strongExporterWorkflowContext = /\bexporters?\b/iu.test(normalizedValue) && logisticsFacet && financialFacet && fragmentedFacet;
      const smartFarmingOnly = /\b(?:agricultural drones?|drone harvesting|precision agriculture|smart farming|crop disease detection|irrigation controller|soil sensor)\b/iu.test(normalizedValue) &&
        !/\b(?:export|shipment|cold chain|storage|warehouse|spoilage|logistics|profit|margin|market price)\b/iu.test(normalizedValue);
      return (context || strongExporterWorkflowContext) && (logisticsFacet || financialFacet || fragmentedFacet) && !smartFarmingOnly;
    }

    const eyeglassFrameRepairRequest =
      /\b(?:eyeglass(?: frame)? repair|eyewear repair|optical frame repair|spectacle frame repair|glasses repair|optical repair)\b/iu.test(planned) &&
      /\b(?:frame damage|previous repairs?|repair history|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|adjustment notes?|pickup dates?|customer pickups?|promised pickup)\b/iu.test(planned);
    if (eyeglassFrameRepairRequest) {
      const identity = /\b(?:eyeglass(?:es)?|eyewear|optical frames?|spectacle frames?|glasses frames?|glasses repair|eyeglass repair|optical repair)\b/iu.test(normalizedValue);
      const repairFacet = /\b(?:frame damage|damaged frame|repair history|previous repair|hinge|replacement part|temple|nose pad|bridge repair|screw|hardware|color matching|colour matching|finish matching|frame repair)\w*\b/iu.test(normalizedValue);
      const fitOrRecordFacet = /\b(?:fit preference|customer fit|fitting|adjustment|repair record|service history|repair notes?|handwritten notes?|receipts?|customer messages?|pickup date|promised pickup|delayed pickup|repair status|job ticket|work order)\w*\b/iu.test(normalizedValue);
      const leatherOnly = /\b(?:leather bag|leather goods|handbag repair|shoe repair|leather matching|leather stitching)\b/iu.test(normalizedValue) && !identity;
      return identity && (repairFacet || fitOrRecordFacet) && !leatherOnly;
    }

    const farmEnergyRequest =
      /\b(?:large farms?|farms?|farm operators?|farm managers?|agricultur(?:e|al))\b/iu.test(planned) &&
      /\b(?:electricity|energy consumption|energy usage|irrigation pumps?|cold[- ]storage|greenhouses?|processing equipment|crop schedules?|weather|production demand|energy waste|energy efficiency)\b/iu.test(planned);
    if (farmEnergyRequest) {
      const farmIdentity =
        /\b(?:farm|farms|farming|agriculture|agricultural|irrigation|greenhouse|crop)\b/iu.test(normalizedValue);
      const energyWorkflow =
        /\b(?:electricity|energy use|energy usage|energy consumption|power consumption|irrigation pump|cold storage|greenhouse|processing equipment|equipment performance|crop schedule|weather|production demand|energy efficiency|operating cost|energy demand)\w*\b/iu.test(normalizedValue);
      const logisticsOnly =
        /\b(?:shipment tracking|transport delay|delivery delay|farm pickup|market delivery|cold chain logistics|produce spoilage)\b/iu.test(normalizedValue) &&
        !/\b(?:electricity|energy|power|irrigation pump|greenhouse|equipment performance)\w*\b/iu.test(normalizedValue);
      return farmIdentity && energyWorkflow && !logisticsOnly;
    }

    const renewableAssetPerformanceRequest =
      /\b(?:renewable energy|solar (?:and wind )?projects?|solar assets?|wind assets?|solar farms?|wind farms?|renewable assets?)\b/iu.test(planned) &&
      /\b(?:financial returns?|revenue forecasts?|asset performance|energy output|generation output|downtime|maintenance|electricity prices?|power prices?|financing costs?|weather|technical inefficien|financial conditions?|underperformance|scada|monitoring|data integration)\w*\b/iu.test(planned);
    if (renewableAssetPerformanceRequest) {
      const renewableIdentity =
        /\b(?:renewable energy|solar (?:and wind )?projects?|solar projects?|wind projects?|solar assets?|wind assets?|solar farms?|wind farms?|renewable assets?|renewable power)\b/iu.test(normalizedValue);
      const workflowOrDataSignal =
        /\b(?:scada|monitoring|data integration|systems? integration|data visibility|visibility gap|generation data|energy output|power output|asset monitoring|asset performance|performance data|downtime|maintenance|weather data|power price|electricity price|financing|grid balancing|bess|operational data|financial data|forecast)\w*\b/iu.test(normalizedValue);
      const supportingFriction =
        /\b(?:challenge|challenges|problem|problems|gap|gaps|difficult|difficulty|siloed|fragmented|separate|integration|visibility|underperform|unreliable|uncertain|variance|anomal)\w*\b/iu.test(normalizedValue);
      const marketCollision =
        /\b(?:stock|stocks|shares?|price target|buy signal|sell signal|hold karo|facebook ads?|social media ads?)\b/iu.test(normalizedValue);
      return renewableIdentity && workflowOrDataSignal && supportingFriction && !marketCollision;
    }

    const tattooDesignRequest =
      /\b(?:tattoo artists?|tattoo studios?|tattoo shops?|tattooists?|tattoo)\b/iu.test(planned) &&
      /\b(?:design references?|placement preferences?|size requirements?|color choices?|revision requests?|approved design|approved version|client approval|appointment details?|aftercare notes?)\b/iu.test(planned);
    if (tattooDesignRequest) {
      const tattooIdentity =
        /\b(?:tattoo|tattoo artist|tattoo studio|tattoo shop|tattooist|tattooing)\b/iu.test(normalizedValue);
      const workflowOrRecord =
        /\b(?:design reference|reference image|placement|size|dimension|color|colour|stencil|revision|approved design|approved version|client approval|appointment|aftercare|client record|consultation|instagram|social media message|dm|sketch|photo|photograph|version history)\w*\b/iu.test(normalizedValue);
      const removalCollision =
        /\b(?:laser tattoo removal|tattoo removal clinic|tattoo removal treatment)\b/iu.test(normalizedValue);
      return tattooIdentity && workflowOrRecord && !removalCollision;
    }

    /*
     * Generic professional-evidence lane for new/niche domains. The caller of
     * this method already requires a strict vertical match, independent source
     * relevance and deterministic collision guards. Here we only decide
     * whether the publication/review contains enough of the AI-planned
     * workflow vocabulary to deserve semantic triage. This lets professional
     * terminology such as "textile conservation", "condition report" and
     * "treatment record" reach Community AI without declaring it verified.
     */
    const genericStopWords = new Set([
      'about', 'application', 'business', 'businesses', 'complaint', 'domain',
      'issue', 'issues', 'management', 'online', 'platform', 'problem',
      'problems', 'service', 'services', 'software', 'system', 'systems',
      'tracking', 'user', 'users', 'workflow', 'specialist', 'specialists',
    ]);
    const plannedConcepts = [
      ...new Set(
        planned
          .split(/[^\p{L}\p{N}]+/u)
          .map((token) => token.trim())
          .filter(
            (token) => token.length >= 4 && !genericStopWords.has(token),
          ),
      ),
    ];
    const matchedConcepts = plannedConcepts.filter((token) =>
      normalizedValue.includes(token),
    );
    const professionalWorkflowSignal =
      /\b(?:condition|assessment|report|documentation|documenting|conservation|treatment|repair|restoration|material|stitching|dye|fabric|approval|approved|preference|history|record|damage|rework|delay|preservation|component|finish)\w*\b/iu.test(
        normalizedValue,
      );

    if (professionalWorkflowSignal && matchedConcepts.length >= 3) {
      return true;
    }

    return false;
  }

  private hasPlannedWorkflowProblemAnchor(
    value: string,
    plannedQueries: readonly string[],
  ): boolean {
    const normalizedValue = value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    const planned = plannedQueries
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();

    if (!planned || !normalizedValue) return true;

    if (
      /\b(?:restaurant delivery|food delivery|online food ordering|meal delivery|delivery app|restaurant courier)\b/iu.test(planned) &&
      /\b(?:fraud|suspicious order|account takeover|refund abuse|promotional abuse|promo abuse|payment behavior|device signal|customer complaint|security alert|false positive|blocked legitimate|coordinated abuse)\w*\b/iu.test(planned)
    ) {
      const actor = /\b(?:restaurant delivery|food delivery|online food ordering|meal delivery|delivery app|restaurant courier|doordash|uber eats|ubereats|grubhub|deliveroo|foodpanda|talabat|instacart)\b/iu.test(normalizedValue);
      const fraudAxis = /\b(?:fraud|fraudulent|suspicious order|account takeover|refund abuse|refund fraud|promotional abuse|promo code abuse|payment fraud|device risk|security alert|false positive|blocked legitimate|coordinated abuse|chargeback abuse|coupon abuse)\w*\b/iu.test(normalizedValue);
      const problemOrImpact = /\b(?:problem|issue|abuse|attack|takeover|loss|losses|blocked|deactivated|false positive|unnecessary refund|difficult|hard to detect|suspicious|complaint|fraudulent|coordinated|misuse|unauthorized)\w*\b/iu.test(normalizedValue);
      const shipmentOnly = /\b(?:carrier scan|proof of delivery|shipping address|warehouse handoff|warehouse update|parcel tracking|shipment chain of custody|lost merchandise|freight|cargo)\b/iu.test(normalizedValue) &&
        !/\b(?:food delivery|restaurant delivery|refund abuse|account takeover|promo|device|false positive)\b/iu.test(normalizedValue);
      return actor && fraudAxis && problemOrImpact && !shipmentOnly;
    }

    if (
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export|fresh produce|produce shipment|cold chain)\b/iu.test(planned) &&
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|market prices?|spoilage|shipment profitability|profit margins?|profit estimates?|supplier payments?|sales revenues?|financial losses?|route profitability|distribution stages?)\b/iu.test(planned)
    ) {
      const context = /\b(?:agricultural exports?|agricultural exporters?|produce exports?|produce exporters?|fresh produce exports?|fresh produce exporters?|fruit exports?|fruit exporters?|vegetable exports?|vegetable exporters?|perishable produce|cold chain|produce shipments?|produce logistics|postharvest|post-harvest)\b/iu.test(normalizedValue);
      const logisticsFacet = /\b(?:transport(?:ation)? delay|delivery delay|storage|warehouse|shipment|distribution|route|logistics|spoilage|spoiled|quality loss|temperature excursion|postharvest loss)\w*\b/iu.test(normalizedValue);
      const financialFacet = /\b(?:storage cost|warehouse expense|transport cost|logistics cost|market price|price volatility|supplier payment|sales revenue|profitability|profit margin|profit estimate|financial loss|margin|revenue|route profitability)\w*\b/iu.test(normalizedValue);
      const friction = /\b(?:delay|delayed|spoilage|spoiled|loss|losses|higher cost|rising cost|volatile|uncertain|fragmented|siloed|reviewed separately|difficult|hard to determine|inaccurate|poor pricing|reconciliation|cost visibility|profit visibility)\w*\b/iu.test(normalizedValue);
      const smartFarmingOnly = /\b(?:agricultural drones?|drone harvesting|precision agriculture|smart farming|crop disease detection|irrigation controller|soil sensor)\b/iu.test(normalizedValue) &&
        !/\b(?:export|shipment|cold chain|storage|warehouse|spoilage|logistics|profit|margin|market price)\b/iu.test(normalizedValue);
      return context && logisticsFacet && financialFacet && friction && !smartFarmingOnly;
    }

    if (
      /\b(?:eyeglass(?: frame)? repair|eyewear repair|optical frame repair|spectacle frame repair|glasses repair|optical repair)\b/iu.test(planned) &&
      /\b(?:frame damage|previous repairs?|repair history|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|adjustment notes?|pickup dates?|customer pickups?|promised pickup)\b/iu.test(planned)
    ) {
      const identity = /\b(?:eyeglass(?:es)?|eyewear|optical frames?|spectacle frames?|glasses frames?|glasses repair|eyeglass repair|optical repair)\b/iu.test(normalizedValue);
      const repairFacet = /\b(?:frame damage|damaged frame|repair history|previous repair|hinge|replacement part|color matching|colour matching|frame repair)\w*\b/iu.test(normalizedValue);
      const workflowFacet = /\b(?:fit preference|customer fit|adjustment|repair record|service history|repair notes?|pickup date|promised pickup|customer pickup|work order|job ticket)\w*\b/iu.test(normalizedValue);
      const friction = /\b(?:wrong|incorrect|mismatch|forgotten|missing|lost|scattered|repeated|repeat|delayed|late|inconsistent|hard to track|difficult to track|incomplete|overlooked|miscommunication)\w*\b/iu.test(normalizedValue);
      const leatherOnly = /\b(?:leather bag|leather goods|handbag repair|shoe repair|leather matching|leather stitching)\b/iu.test(normalizedValue) && !identity;
      return identity && repairFacet && workflowFacet && friction && !leatherOnly;
    }

    if (
      /\b(?:renewable energy|solar (?:and wind )?projects?|solar assets?|wind assets?|solar farms?|wind farms?|renewable assets?)\b/iu.test(planned) &&
      /\b(?:financial returns?|revenue forecasts?|asset performance|energy output|generation output|downtime|maintenance|electricity prices?|power prices?|financing costs?|weather|technical inefficien|financial conditions?|underperformance)\w*\b/iu.test(planned)
    ) {
      const renewableIdentity =
        /\b(?:renewable energy|solar (?:and wind )?projects?|solar projects?|wind projects?|solar assets?|wind assets?|solar farms?|wind farms?|renewable assets?|renewable power)\b/iu.test(normalizedValue);
      const performanceWorkflow =
        /\b(?:energy output|generation output|power output|capacity factor|downtime|maintenance|o&m|operations? and maintenance|electricity price|power price|financing cost|weather|asset performance|financial return|financial performance|profitability|revenue forecast|technical inefficien|underperformance)\w*\b/iu.test(normalizedValue);
      const friction =
        /\b(?:lower|poor|underperform|unexpected|inaccurate|inefficient|downtime|loss|losses|cost|costs|difficult|difficulty|uncertain|variance|anomal|separate systems?|siloed|fragmented|maintenance spend|forecast error)\w*\b/iu.test(normalizedValue);
      const marketCollision =
        /\b(?:stock|stocks|shares?|price target|buy signal|sell signal|hold karo|facebook ads?|social media ads?|two factor authentication|2fa|face id|login)\b/iu.test(normalizedValue);
      return renewableIdentity && performanceWorkflow && friction && !marketCollision;
    }

    if (
      /\b(?:large farms?|farms?|farm operators?|farm managers?|agricultur(?:e|al))\b/iu.test(planned) &&
      /\b(?:electricity|energy consumption|energy usage|irrigation pumps?|cold[- ]storage|greenhouses?|processing equipment|crop schedules?|weather|production demand|energy waste|energy efficiency)\b/iu.test(planned)
    ) {
      const farmAnchor = /\b(?:farm|farms|farming|agriculture|agricultural|irrigation|greenhouse|crop)\b/iu.test(normalizedValue);
      const energyAnchor = /\b(?:electricity|energy|power|irrigation pump|cold storage|greenhouse|processing equipment|equipment performance|crop schedule|weather|production demand|operating cost|energy demand|energy efficiency)\w*\b/iu.test(normalizedValue);
      const frictionOrOperationalSignal = /\b(?:waste|wasted|inefficient|high cost|higher cost|operating cost|consumption|demand|usage|efficiency|schedule|monitor|performance|optimization|adjust|priorit|separate systems?|fragmented|siloed)\w*\b/iu.test(normalizedValue);
      const logisticsOnly = /\b(?:shipment tracking|transport delay|delivery delay|farm pickup|market delivery|cold chain logistics|produce spoilage)\b/iu.test(normalizedValue) &&
        !/\b(?:electricity|energy|power|irrigation pump|greenhouse|equipment performance)\w*\b/iu.test(normalizedValue);
      return farmAnchor && energyAnchor && frictionOrOperationalSignal && !logisticsOnly;
    }

    if (
      /\b(?:commercial buildings?|office buildings?|office complexes?|facility teams?|facility managers?|building operators?|building managers?)\b/iu.test(planned) &&
      /\b(?:electricity|energy consumption|utility bills?|smart meters?|heating|hvac|elevators?|lighting|office equipment|consumption spikes?|abnormal usage|energy waste|equipment downtime)\b/iu.test(planned)
    ) {
      const buildingAnchor = /\b(?:commercial building|office building|office complex|facility|facilities|facility manager|building operator|building manager)\b/iu.test(normalizedValue);
      const energyAnchor = /\b(?:electricity|energy|utility bill|smart meter|submeter|hvac|heating|elevator|lighting|office equipment|power consumption|meter reading)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:high bill|cost spike|consumption spike|sudden increase|abnormal usage|anomal|inefficient|waste|separate systems?|fragmented|limited visibility|hard to identify|difficult to identify|fault|failure|downtime|excess consumption)\w*\b/iu.test(normalizedValue);
      return buildingAnchor && energyAnchor && frictionAnchor;
    }

    if (
      /\b(?:public institutions?|government|government agencies?|government departments?|public sector|public administration|ministr(?:y|ies)|municipal|municipality)\b/iu.test(planned) &&
      /\b(?:public budgets?|public funds?|government spending|public spending|procurement|invoices?|project expenses?|approval histor(?:y|ies)|duplicate payments?|overspending|overpayments?|expenditure|financial management|budget planning|spending patterns?)\b/iu.test(planned)
    ) {
      const publicActor = /\b(?:government|government agency|government agencies|government department|government departments|public institution|public institutions|public sector|public administration|municipal|municipality|ministry|ministries|taxpayer|taxpayers|public authority|public authorities|public agency|public agencies|county|counties|city government|city council|state government|federal government|treasury|public office|public offices|public body|public bodies)\b/iu.test(normalizedValue);
      const fiscalWorkflow = /\b(?:public budget|public budgets|public funds|government spending|public spending|procurement|procurement record|procurement records|public contract|public contracts|government contract|government contracts|contract spending|invoice|invoices|payment|payments|disbursement|disbursements|accounts payable|project expense|project expenses|grant spending|approval history|approval histories|expenditure|expenditures|audit|auditing|budget planning|financial management|vendor payment|vendor payments|supplier payment|supplier payments)\b/iu.test(normalizedValue);
      const fiscalFriction = /(?:\b(?:unusual|suspicious|anomalous?|abnormal)\b.{0,32}\b(?:spending|payment|payments|transaction|transactions|expenditure)\b|\b(?:duplicate|double)\b.{0,32}\b(?:payment|invoice)s?\b|\b(?:overpayment|overpayments|overspend|overspending|waste|wasted funds|wasteful spending|fraud|fraudulent|corruption|corrupt|embezzlement|kickback|kickbacks|irregular expenditure|financial irregularity|financial irregularities|inefficient spending|misuse|misallocation|budget overrun|budget overruns|cost overrun|cost overruns|improper payment|improper payments|unauthorized payment|unauthorized payments|questionable payment|questionable payments|reconciliation mismatch|audit finding|audit findings|procurement scandal|procurement fraud|procurement abuse|scandal|suspicious transaction|suspicious transactions)\b|\b(?:investigation|investigations|probe|probes|audit|audits|review)\b.{0,100}\b(?:payment|payments|spending|procurement|expenditure|funds?|contracts?)\b|\b(?:payment|payments|spending|procurement|expenditure|funds?|contracts?)\b.{0,100}\b(?:investigation|investigations|probe|probes|audit|audits|review)\b)/iu.test(normalizedValue);
      const healthcareCollision = /\b(?:patient|patients|member complaint|member complaints|healthcare finance|health insurance|medical billing|hospital billing)\b/iu.test(normalizedValue) && !/\b(?:government|public sector|public institution|public funds|public budget|government spending|procurement|taxpayer)\b/iu.test(normalizedValue);
      return publicActor && fiscalWorkflow && fiscalFriction && !healthcareCollision;
    }

    if (
      /\b(?:cake decorators?|cake decorating|custom cake decorators?|home bakers?|independent bakers?|cake artists?|custom cake businesses?|bakery decorators?)\b/iu.test(planned) &&
      /\b(?:custom orders?|design references?|flavors?|flavours?|allergy notes?|allergies|dietary requirements?|cake dimensions?|decoration details?|pickup times?|last[- ]minute revisions?)\b/iu.test(planned)
    ) {
      const cakeActor = /\b(?:cake decorator|cake decorating|custom cake|home baker|independent baker|cake artist|bakery decorator|wedding cake|birthday cake|cake business)\b/iu.test(normalizedValue);
      const workflowAnchor = /\b(?:custom order|cake design|design reference|flavor|flavour|allergy|dietary requirement|dimension|size|decoration|pickup|revision|approved design|approval|customer message|chat message|photo|sketch|handwritten note)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:wrong|incorrect|missed|forgotten|overlooked|lost|scattered|outdated|last minute|last-minute|rework|remake|repeat work|waste|wasted ingredient|delay|delayed|allergy mistake|dietary mistake|miscommunication|not updated)\w*\b/iu.test(normalizedValue);
      return cakeActor && workflowAnchor && frictionAnchor;
    }

    if (
      /\b(?:calligraphy artists?|calligraphers?|lettering artists?|custom stationery artists?)\b/iu.test(planned) &&
      /\b(?:custom orders?|commissions?|wording|lettering styles?|paper selections?|ink preferences?|revision requests?|approved versions?|delivery deadlines?)\b/iu.test(planned)
    ) {
      const creativeActor = /\b(?:calligraphy|calligrapher|lettering artist|custom stationery|commissioned art|art commission|commissioned artwork|freelance artist|independent artist|graphic designer|illustrator|custom designer)\b/iu.test(normalizedValue);
      const workflowAnchor = /\b(?:commission|custom order|client instruction|wording|revision|approved version|approval|design version|reference example|paper|ink|dimension|deadline|client message|dm|direct message)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:wrong wording|missed revision|overlooked change|lost note|scattered message|outdated version|wrong version|rework|repeat work|wasted material|wasted paper|wasted ink|delay|delayed|miscommunication|forgotten|incorrect|mistake)\w*\b/iu.test(normalizedValue);
      return creativeActor && workflowAnchor && frictionAnchor;
    }

    if (
      /\b(?:restaurant|restaurants|commercial kitchen|commercial kitchens|restaurant kitchen|food service kitchen)\b/iu.test(planned) &&
      /\b(?:electricity|gas|energy|utility bills?|utility costs?|refrigeration|cooking equipment|ventilation|lighting|heating|equipment usage|equipment runtime|energy waste|energy efficiency|carbon|emissions?|consumption spikes?)\b/iu.test(planned)
    ) {
      const kitchenAnchor = /\b(?:restaurant|restaurants|commercial kitchen|commercial kitchens|restaurant kitchen|food service kitchen|kitchen manager|restaurant manager)\b/iu.test(normalizedValue);
      const energyAnchor = /\b(?:electricity|gas|energy|utility bill|utility bills|utility cost|utility costs|refrigeration|refrigerator|freezer|cooking equipment|oven|grill|ventilation|hood|lighting|heating|equipment usage|equipment runtime|meter|submeter|carbon|emissions?)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:high utility|high bill|higher bill|energy intensive|high energy|unusual consumption|consumption spike|energy waste|waste|wasted|inefficient|inefficiency|excess consumption|excessive consumption|limited visibility|no visibility|hard to identify|difficult to identify|cannot identify|unable to identify|separate systems?|fragmented|idle|left on|running overnight|cost increase|cost spike|reduce energy|energy saving|efficiency improvement)\w*\b/iu.test(normalizedValue);
      return kitchenAnchor && energyAnchor && frictionAnchor;
    }

    if (
      /\b(?:home cleaning|house cleaning|residential cleaning|cleaning business|cleaning service|cleaners?)\b/iu.test(planned) &&
      /\b(?:customer preferences?|client instructions?|recurring appointments?|recurring bookings?|room specific instructions?|employee assignments?|cleaner assignments?|cleaning supplies?|schedule changes?|missed tasks?|scheduling conflicts?|forgotten requests?|service quality)\b/iu.test(planned)
    ) {
      const cleaningAnchor = /\b(?:home cleaning|house cleaning|residential cleaning|cleaning service|cleaning company|cleaning business|cleaners?|housekeepers?|maid service|cleaning crew|cleaning team)\b/iu.test(normalizedValue);
      const workflowAnchor = /\b(?:customer preference|client preference|recurring appointment|recurring booking|room instruction|room-specific instruction|employee assignment|cleaner assignment|staff assignment|cleaning supplies|supply list|schedule change|appointment change|task list|checklist|customer request|client request|phone call|text message|messaging app|handwritten note)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:missed|forgotten|forget|conflict|double book|double-book|scheduling conflict|wrong cleaner|wrong assignment|missing supply|out of supplies|miscommunication|lost note|unclear instruction|inconsistent service|quality issue|last minute|last-minute|not updated|didn't know|did not know|failed to communicate)\w*\b/iu.test(normalizedValue);
      const batteryCollision = /\b(?:home batter(?:y|ies)|residential batter(?:y|ies)|battery storage|solar batter(?:y|ies)|powerwall)\b/iu.test(normalizedValue) && !cleaningAnchor;
      return cleaningAnchor && workflowAnchor && frictionAnchor && !batteryCollision;
    }

    if (/\b(?:instrument repair|repair shop|technician|replacement parts?|pickup|paper tags?)\b/iu.test(planned)) {
      return /\b(?:repair|luthier|technician|replacement parts?|parts?|pickup|pick up|repair ticket|service ticket|repair status|repair progress|paper tags?|instrument intake)\b/iu.test(
        normalizedValue,
      );
    }

    if (
      /\b(?:tourism|tourist|visitor|destination|attraction)\b/iu.test(planned) &&
      /\b(?:overcrowd|crowding|seasonal demand|visitor behavior|feedback|complaint|resource allocation|public transport|local communit|congestion)\w*\b/iu.test(planned)
    ) {
      const tourismAnchor = /\b(?:tourism|tourist|visitors?|destination|destinations|attraction|attractions)\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:overcrowd|crowding|congestion|seasonal demand|visitor complaint|visitor feedback|resource allocation|capacity pressure|tourism pressure|local residents?|local communit|public transport|visitor experience|delayed response|service pressure)\w*\b/iu.test(normalizedValue);
      return tourismAnchor && frictionAnchor;
    }

    if (/\b(?:smart city|municipal|iot|traffic sensors?|public cameras?)\b/iu.test(planned) && /\b(?:security|unauthorized|outdated|firmware|compromised|vulnerab|unmanaged|anomal)\w*\b/iu.test(planned)) {
      return /\b(?:security|unauthorized|outdated|firmware|compromised|vulnerab|unmanaged|rogue|anomal|unusual device behavior|limited visibility)\w*\b/iu.test(
        normalizedValue,
      );
    }

    if (
      /\b(?:manufacturing|manufacturer|factory|factories|production line|industrial plant)\b/iu.test(planned) &&
      /\b(?:raw materials?|supplier|supply chain|inventory|warehouse|shipment|production schedule|bottleneck|demand change|order prioritization)\b/iu.test(planned)
    ) {
      const manufacturingAnchor = /\b(?:manufacturing|manufacturer|factory|factories|production|plant|industrial)\b/iu.test(normalizedValue);
      const supplyAnchor = /\b(?:raw materials?|supplier|suppliers|supply chain|inventory|warehouse|warehouses|shipment|shipments|delivery|stock)\b/iu.test(normalizedValue);
      const disruptionAnchor = /\b(?:delay|delayed|shortage|stockout|bottleneck|disrupt|shutdown|downtime|demand change|forecast|inventory mismatch|excess stock|overstock|priorit|schedule conflict)\w*\b/iu.test(normalizedValue);
      return manufacturingAnchor && supplyAnchor && disruptionAnchor;
    }

    if (
      /\b(?:locksmith|locksmiths|field service|mobile service|service dispatch)\b/iu.test(planned) &&
      /\b(?:dispatch|technician|service request|emergency call|tools?|replacement parts?|parts inventory|availability|repeated trips?)\b/iu.test(planned)
    ) {
      const locksmithAnchor = /\b(?:locksmith|locksmiths|lock service|lock repair|key service)\b/iu.test(normalizedValue);
      const operationsAnchor = /\b(?:dispatch|dispatcher|technician|technicians|service call|service request|emergency call|job assignment|parts?|tools?|van inventory|mobile inventory|scheduling|availability)\b/iu.test(normalizedValue);
      const failureAnchor = /\b(?:delay|delayed|late|missing|wrong|incorrect|unavailable|repeat trip|repeated trip|return trip|miscommunication|missed call|poor coordination|stockout|out of stock)\w*\b/iu.test(normalizedValue);
      return locksmithAnchor && operationsAnchor && failureAnchor;
    }

    if (
      /\b(?:hospital|hospitals|healthcare|medical center|medical centers)\b/iu.test(planned) &&
      /\b(?:operating rooms?|operating theatres?|operating theaters?|surgical suites?|surgery schedules?|surgical schedules?|surgeries|procedures)\b/iu.test(planned) &&
      /\b(?:medical staff|staffing|surgeons?|nurses?|equipment availability|urgent patients?|emergency cases?|resource allocation|room turnover|reschedul|idle operating rooms?|delayed procedures?|schedule conflicts?|operating room utilization)\w*\b/iu.test(planned)
    ) {
      const hospitalOrSurgicalAnchor = /\b(?:hospital|hospitals|operating room|operating rooms|operating theatre|operating theater|surgical suite|surgery|surgical|procedure|procedures)\b/iu.test(normalizedValue);
      const coordinationAnchor = /\b(?:surgery schedule|surgical schedule|operating room schedule|staff availability|medical staff|staffing|surgeon|nurse|equipment availability|emergency case|urgent patient|resource allocation|room turnover|reschedul|repriorit|schedule conflict|operating room utilization)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:delay|delayed|postpone|postponed|cancel|cancelled|canceled|idle|underutilized|overworked|overload|shortage|unavailable|conflict|bottleneck|disruption|turnover time|wait|waiting|inefficient|utilization|resource constraint|capacity constraint)\w*\b/iu.test(normalizedValue);
      const supplyOnlyCollision = /\b(?:pharmacy inventory|medical supplies?|blood products?|stockout|supplier delivery|supply chain)\b/iu.test(normalizedValue) &&
        !/\b(?:operating room|surgery|surgical|procedure|staffing|staff availability|equipment availability)\b/iu.test(normalizedValue);
      return hospitalOrSurgicalAnchor && coordinationAnchor && frictionAnchor && !supplyOnlyCollision;
    }

    if (
      /\b(?:hospital|hospitals|healthcare|clinical units?|pharmacy|medical supplies?|blood products?)\b/iu.test(planned) &&
      /\b(?:inventory|stock levels?|stockouts?|shortages?|medical supplies?|blood products?|pharmacy inventory|expiration|expiry|expired|supplier deliveries?|emergency requests?|reorder|supply chain)\b/iu.test(planned)
    ) {
      const healthcareAnchor = /\b(?:hospital|hospitals|healthcare|clinical|pharmacy|medical)\b/iu.test(normalizedValue);
      const supplyAnchor = /\b(?:medical supplies?|clinical supplies?|hospital supplies?|inventory|stock|stockout|shortage|blood products?|blood inventory|pharmacy inventory|expiration|expiry|expired|supplier|delivery|reorder|supply chain)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:shortage|stockout|out of stock|expired|expiration|expiry|waste|wasted|delay|delayed|late|emergency purchase|emergency request|unavailable|missing|fragmented|disconnected|separate systems?|siloed|inventory mismatch|excess stock|overstock|wrong department|supplier delay|delivery delay|forecast error)\w*\b/iu.test(normalizedValue);
      return healthcareAnchor && supplyAnchor && frictionAnchor;
    }

    if (
      /\b(?:hospital|hospitals|healthcare|biomedical engineering|clinical engineering|medical)\b/iu.test(planned) &&
      /\b(?:medical equipment|medical devices?|equipment tracking|device tracking|asset tracking|equipment location|maintenance status|equipment availability|device availability|utilization|departmental movement|storage rooms?|operating rooms?)\b/iu.test(planned)
    ) {
      const healthcareAnchor = /\b(?:hospital|hospitals|healthcare|clinical|biomedical|medical)\b/iu.test(normalizedValue);
      const equipmentAnchor = /\b(?:medical equipment|medical device|medical devices|equipment|device|devices|asset|assets|infusion pump|ventilator|wheelchair|monitor)\b/iu.test(normalizedValue);
      const workflowAnchor = /\b(?:track|tracking|location|locate|search|searching|find|finding|missing|unavailable|availability|maintenance|service status|utilization|usage|inventory|department|transfer|storage|operating room|procedure delay|delayed procedure|duplicate purchase|underused)\w*\b/iu.test(normalizedValue);
      return healthcareAnchor && equipmentAnchor && workflowAnchor;
    }

    if (
      /\b(?:art restoration|art conservation|conservation workshop|conservation studio|conservator|painting restoration|artifact conservation)\b/iu.test(planned)
    ) {
      const conservationAnchor = /\b(?:art restoration|art conservation|conservator|conservation studio|conservation workshop|painting restoration|artifact conservation|museum conservation)\b/iu.test(normalizedValue);
      const recordAnchor = /\b(?:condition report|condition documentation|condition photo|treatment record|treatment history|repair history|previous repair|material|materials|restoration stage|client instruction|documentation|record|records|notes|photograph|photos)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:scattered|fragmented|missing|lost|incomplete|manual|paper|handwritten|duplicate|duplicated|missed|incorrect|wrong|delay|delayed|hard to find|not tracked|tracking problem)\w*\b/iu.test(normalizedValue);
      return conservationAnchor && recordAnchor && frictionAnchor;
    }

    if (
      /\b(?:agricultural cooperatives?|farm cooperatives?|farms?|agriculture|fresh produce|produce growers?|cold storage)\b/iu.test(planned) &&
      /\b(?:harvest(?:ing)?|storage|cold chain|temperature|shipment|transportation|delivery|spoilage|transport costs?|storage capacity|logistics)\b/iu.test(planned)
    ) {
      const agricultureAnchor = /\b(?:agricultural|agriculture|farm|farmer|fresh produce|produce|grower|cold storage)\b/iu.test(normalizedValue);
      const logisticsAnchor = /\b(?:harvest|storage|cold chain|temperature|shipment|transport|delivery|spoil|storage capacity|location|traceability|logistics|market)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:delay|delayed|late|spoil|spoiled|spoilage|temperature excursion|quality loss|waste|wasted|empty load|partial load|partially empty|transport cost|high cost|missing|tracking|visibility|fragmented|separate systems?|capacity shortage|storage shortage|coordination problem)\w*\b/iu.test(normalizedValue);
      return agricultureAnchor && logisticsAnchor && frictionAnchor;
    }

    if (
      /\b(?:upholstery workshops?|upholstery shops?|upholsterers?|reupholstery|furniture upholstery)\b/iu.test(planned) &&
      /\b(?:fabric samples?|fabric selections?|fabric orders?|furniture measurements?|material quantities?|material choices?|repair requests?|design changes?|customer notes?|completion dates?|delivery dates?)\b/iu.test(planned)
    ) {
      const upholsteryAnchor = /\b(?:upholstery|upholsterer|reupholstery|furniture upholstery)\b/iu.test(normalizedValue);
      const workflowAnchor = /\b(?:fabric sample|fabric selection|fabric order|fabric yardage|material quantity|material choice|furniture measurement|dimensions?|repair request|customer note|client note|design change|change request|completion date|delivery date|work order|job ticket)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:lost|missing|misplaced|wrong|incorrect|mistake|remeasure|rework|remake|waste|wasted|shortage|out of stock|delay|delayed|late|forgotten|miscommunication|changed|change request|not updated|paper note|handwritten note|scattered)\w*\b/iu.test(normalizedValue);
      return upholsteryAnchor && workflowAnchor && frictionAnchor;
    }

    if (
      /\b(?:picture framing shops?|custom framing shops?|frame shops?|framers?)\b/iu.test(planned) &&
      /\b(?:artwork measurements?|frame selections?|glass selections?|moulding|material availability|special handling|completion dates?|paper forms?|verbal communication|order changes?|wasted supplies?)\b/iu.test(planned)
    ) {
      const framingAnchor = /\b(?:picture framing|framing shop|frame shop|custom frame|framer|moulding|mat board|matting)\b/iu.test(normalizedValue);
      const workflowAnchor = /\b(?:measurement|dimensions?|frame|glass|moulding|material|special handling|customer preference|order change|completion date|pickup date|paper form|paper ticket|verbal instruction|work order)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:wrong|incorrect|mistake|remeasure|remake|waste|wasted|shortage|out of stock|delay|delayed|late|lost|missing|miscommunication|changed order|change request|paper|verbal)\w*\b/iu.test(normalizedValue);
      return framingAnchor && workflowAnchor && frictionAnchor;
    }

    if (
      /\b(?:property management|property investment compan(?:y|ies)|property investors?|real estate investors?|investment properties?|property managers?|rental propert|apartment buildings?|real estate portfolio|maintenance expenses?|operating costs?|net operating income|\bnoi\b|cash flow|vacancy|financing costs?|mortgage interest|profitability|return estimates?|local market changes?|tenant complaints?)\w*\b/iu.test(planned) &&
      /\b(?:maintenance|operating costs?|operating expenses?|lower returns?|financial inefficien|vacancy|tenant complaints?|repair expenses?|property performance|maintenance priorit|data silo|separate systems?)\w*\b/iu.test(planned)
    ) {
      const propertyAnchor = /\b(?:property management|property investment compan(?:y|ies)|property investors?|real estate investors?|investment properties?|property manager|rental property|rental properties|building|buildings|apartment|apartments|landlord|real estate portfolio)\b/iu.test(normalizedValue);
      const performanceAnchor = /\b(?:maintenance expense|maintenance cost|operating cost|operating expense|net operating income|\bnoi\b|vacancy|tenant complaint|repair expense|maintenance spend|maintenance investment|lower return|property performance|building performance|rental income|cash flow|profitability|return estimate|return on investment|\broi\b|financing cost|mortgage interest|interest rate|local market|market rent|rent growth|expense forecast|data silo|separate systems?)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:rising|higher|increase|unexpected|inaccurate|declining|lower|negative|erod|difficult|hard to|uncertain|vacancy|expense|cost|maintenance|repair|cash flow problem|poor return|missed|delay|fragment|silo|separate systems?|market change|interest rate)\w*\b/iu.test(normalizedValue);
      const taxOnly = /\b(?:1031 exchange|depreciation recapture|tax loophole|cost segregation|irs)\b/iu.test(normalizedValue) &&
        !/\b(?:maintenance|operating cost|operating expense|vacancy|property performance|\bnoi\b|cash flow|financing|mortgage|profitability|return)\w*\b/iu.test(normalizedValue);
      return propertyAnchor && performanceAnchor && frictionAnchor && !taxOnly;
    }

    if (
      /\b(?:financial institutions?|banks?|banking|digital payments?|payment platforms?|fintech|wallets?|card payments?|transactions?|transfers?)\b/iu.test(planned) &&
      /\b(?:fraud|unauthorized|suspicious|verification|identity checks?|security alerts?|disputes?|reconciliation|account restrictions?|frozen accounts?|payment delays?)\b/iu.test(planned)
    ) {
      const financialAnchor = /\b(?:bank|banking|financial|payment|payments|transaction|transactions|transfer|transfers|card|cards|wallet|merchant|payout|account)\b/iu.test(normalizedValue);
      const investigationAnchor = /\b(?:fraud|fraudulent|unauthorized|suspicious|verification|identity|dispute|chargeback|reconciliation|restriction|restricted|frozen|freeze|delay|delayed|failed|failure|declined|blocked|alert|investigation|mismatch|loss|losses)\w*\b/iu.test(normalizedValue);
      const developerOnly = /\b(?:unit tests?|test suite|code coverage|repository|pull request|smart contract tests?|cargo|github issue|sdk|api implementation)\b/iu.test(normalizedValue) &&
        !/\b(?:actual transaction|customer payment|unauthorized transfer|fraud investigation|frozen account|payment dispute|chargeback|verification failure)\b/iu.test(normalizedValue);
      return financialAnchor && investigationAnchor && !developerOnly;
    }

    if (
      /\b(?:hr|human resources|employee handbook|employment polic(?:y|ies)|leave rules?|internal procedures?|employment contracts?|corporate policy|compliance)\b/iu.test(planned) &&
      /\b(?:version control|outdated|conflicting|inconsistent|regulatory change|manual document review|repeated employee policy questions?|policy synchronization|compliance risk)\b/iu.test(planned)
    ) {
      const enterpriseAnchor = /\b(?:hr|human resources|employee handbook|employment polic(?:y|ies)|leave rules?|internal procedures?|employment contracts?|corporate policy|compliance|labor law|employment law)\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:outdated|version mismatch|version control|conflicting|inconsistent|regulatory change|not updated|manual review|repeated questions?|policy questions?|compliance risk|different departments?|multiple departments?)\w*\b/iu.test(normalizedValue);
      return enterpriseAnchor && frictionAnchor;
    }

    if (
      /\b(?:tattoo artists?|tattoo studios?|tattoo shops?|tattooists?)\b/iu.test(planned) &&
      /\b(?:design references?|reference images?|placement preferences?|size requirements?|dimensions?|color choices?|colour choices?|stencils?|revision requests?|design revisions?|approved design|approved version|client approval|appointment details?|aftercare notes?|client records?)\b/iu.test(planned)
    ) {
      const tattooAnchor = /\b(?:tattoo|tattoo artist|tattoo studio|tattoo shop|tattooist|tattooing)\b/iu.test(normalizedValue);
      const designWorkflow = /\b(?:design reference|reference image|placement|size|dimension|color|colour|stencil|revision|approved design|approved version|client approval|appointment|aftercare|client record|instagram|social media message|sketch|photo|photograph)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:wrong|incorrect|lost|missing|scattered|missed|forgotten|outdated|old version|unconfirmed|revision|rework|repeat|confusion|confusing|scheduling conflict|double book|delay|miscommunication|inconsistent|hard to confirm|difficult to confirm)\w*\b/iu.test(normalizedValue);
      const removalCollision = /\b(?:laser tattoo removal|tattoo removal clinic|tattoo removal treatment)\b/iu.test(normalizedValue);
      return tattooAnchor && designWorkflow && frictionAnchor && !removalCollision;
    }

    if (
      /\b(?:customer job ticket|paper records?|paper tickets?|repair ticket|work order|estimate approval|parts order|technician notes?|collection date|pickup date|service status tracking|customer approval|item condition|gemstone|measurements?|modifications?)\b/iu.test(planned)
    ) {
      const actorAnchor = /\b(?:bicycle repair|bike repair|cycle repair|watch repair|watchmaker|shoe repair|cobbler|jewelry repair|jewellery repair|jeweler|jeweller|locksmith|car wash|tailor|alteration shop|repair shop|salon|barber|photography studio|tattoo studio|dance studio|restaurant|service business)\b/iu.test(normalizedValue);
      const workflowAnchor = /\b(?:customer|ticket|work order|estimate|approval|parts order|ordered parts?|replacement material|technician notes?|service status|repair status|pickup|collection|paper records?|paper ticket|job record|intake record|item condition|condition photo|gemstone|measurement|modification)\w*\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:lost|misplaced|missing|wrong|incorrect|delayed|late|unexpected cost|unclear|not tracked|tracking problem|forgotten|paper|verbal|miscommunication|misunderstanding|dispute|customer complaint|unauthorized change|condition mismatch|produce spoilage|spoiled produce|cold chain|temperature excursion|quality loss|partial load|partially empty deliver|farm pickup delay|market delivery delay|picture framing|framing mistake|measurement mistake|wrong measurement|frame remake|wrong glass|wrong moulding|material shortage|wasted supplies|customer design change|order change)\w*\b/iu.test(normalizedValue);
      return actorAnchor && workflowAnchor && frictionAnchor;
    }

    if (
      /\b(?:businesses|shops?|studios?|facilities|upholstery workshops?|upholstery shops?|upholsterers?|car wash|car washes|restaurants?|salons?|barbers?|repair shops?|tailors?|locksmiths?|field service|service business)\b/iu.test(planned) &&
      /\b(?:queues?|customers?|service requests?|repair requests?|employee assignments?|staff assignments?|equipment availability|bookings?|appointments?|dispatch|technicians?|packages?|preferences?|inventory|fabric samples?|fabric orders?|measurements?|design changes?|paper notes?|paper receipts?|workloads?|waiting times?)\b/iu.test(planned)
    ) {
      const operationsAnchor = /\b(?:queue|queues|booking|bookings|appointment|appointments|customer|customers|service request|service requests|employee|employees|staff|technician|technicians|package|packages|equipment|parts?|tools?|inventory|assignment|assignments|bay|bays|pickup|collection|preferences?|workload|workloads)\b/iu.test(normalizedValue);
      const frictionAnchor = /\b(?:delay|delayed|late|long wait|waiting time|forgotten|missed|missing|wrong|incorrect|unavailable|uneven|overload|paper note|paper notes|paper receipt|verbal|miscommunication|bottleneck|repeat trip|repeated trip|lost|not tracked|tracking problem)\w*\b/iu.test(normalizedValue);
      return operationsAnchor && frictionAnchor;
    }

    /*
     * Generic/new domains do not have a hand-written workflow branch above.
     * Preserve a bounded semantic-triage lane by deriving workflow anchors from
     * the planner queries themselves. The caller still requires a strong domain
     * anchor and concrete friction before this method can admit an AI-triage
     * comment, so two request-concept overlaps improve recall without turning a
     * single broad domain word into evidence.
     */
    const genericPlannedStopWords = new Set([
      'about', 'application', 'business', 'businesses', 'complaint', 'domain',
      'issue', 'issues', 'management', 'online', 'platform', 'problem',
      'problems', 'service', 'services', 'software', 'system', 'systems',
      'tracking', 'user', 'users', 'workflow',
    ]);
    const dynamicPlannedConcepts = [
      ...new Set(
        planned
          .split(/[^\p{L}\p{N}]+/u)
          .map((token) => token.trim())
          .filter(
            (token) =>
              token.length >= 4 && !genericPlannedStopWords.has(token),
          ),
      ),
    ];
    const matchedDynamicConcepts = dynamicPlannedConcepts.filter((token) =>
      normalizedValue.includes(token),
    );

    const highSignalTerms = [
      ...new Set(
        planned
          .split(/[^\p{L}\p{N}]+/u)
          .filter((token) =>
            /^(?:access|account|alert|anomaly|approval|authentication|availability|blocked|bottleneck|breach|complaint|conflict|crowding|delay|delivery|dispatch|dispute|error|failure|firmware|inventory|login|missing|order|outage|overcrowding|pickup|prioritization|reliability|repair|request|resource|risk|security|shipment|shortage|status|supplier|sync|technician|threat|tools?|unauthorized|unavailable|verification|visibility|visitor|tourism|congestion|waste)$/iu.test(
              token,
            ),
          ),
      ),
    ];
    const matchedHighSignalTerms = highSignalTerms.filter((term) =>
      normalizedValue.includes(term),
    );

    if (matchedHighSignalTerms.length >= 2) {
      return true;
    }

    if (
      matchedHighSignalTerms.length >= 1 &&
      matchedDynamicConcepts.length >= 3
    ) {
      return true;
    }

    if (highSignalTerms.length === 0) {
      return matchedDynamicConcepts.length >= 4;
    }

    return false;
  }

  private hasSecondaryOperationalProblemSignal(value: string): boolean {
    const normalized = value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();

    if (!normalized) return false;

    return /\b(?:challenge|challenges|problem|problems|issue|issues|failure|failures|failed|delay|delays|delayed|shortage|shortages|stockout|stockouts|bottleneck|bottlenecks|production disruption|production shutdown|shutdown|demand change|demand changes|inventory mismatch|inaccurate inventory|excess stock|overstock|order reprioritization|repeated trip|repeated trips|return trip|return trips|missing tools?|wrong parts?|incorrect parts?|technician unavailable|missed emergency call|dispatch delay|long wait|long waits|waiting time|waiting times|uneven workload|uneven workloads|equipment unavailable|forgotten service request|forgotten service requests|verification failure|verification failures|unauthorized transfer|unauthorized transfers|frozen account|frozen accounts|account restriction|account restrictions|fraud investigation|fraud investigations|fraud|fraudulent|fake seller|fake sellers|fake review|fake reviews|review manipulation|suspicious listing|suspicious listings|coordinated fraud|seller restriction|seller restrictions|false positive restriction|legitimate seller restricted|scam|scams|payment dispute|payment disputes|lost|misplaced|forgotten|incorrect|wrong|waiting longer|waste|wasting|inefficient|inefficiency|inefficiently|fragmented|fragmentation|siloed|disconnected|separate systems?|separate records?|paper tags?|manual tracking|rising costs?|high costs?|higher costs?|energy bills?|utility bills?|utility costs?|high utility|high energy|energy intensive|energy waste|energy saving|energy efficiency|consumption spike|consumption spikes|sudden increase|unexpected increase|excess consumption|excessive consumption|emissions?|carbon impact|environmental impact|resource waste|maintenance failure|maintenance failures|outage|downtime|data gap|visibility gap|limited visibility|difficult to identify|hard to identify|unable to identify|unauthorized|unmanaged|security incident|security incidents|cyberattack|cyber attack|breach|breaches|account compromise|compromised account|compromised accounts|credential theft|outdated firmware|compromised device|unusual device behavior|security gap|cost overrun|cost overruns|excess consumption|excessive consumption|outdated policy|outdated policies|outdated handbook|outdated handbooks|conflicting policy|conflicting policies|conflicting leave rules?|inconsistent policy|inconsistent policies|compliance risk|compliance risks|manual document review|manual policy review|repeated employee questions?|repeated policy questions?|regulatory change|regulatory changes|policy update delay|policy updates? not reflected|estimate approval|customer approval|delayed collection|delayed pickup|paper ticket|paper tickets|verbal approval|overcrowd|overcrowding|crowding|overtourism|tourism pressure|destination pressure|visitor complaints?|visitor feedback|seasonal demand|resource allocation|attraction congestion|visitor congestion|capacity pressure|poor visitor experience|local community complaints?|delayed municipal response|net operating income|\bnoi\b|maintenance expense|maintenance expenses|operating cost|operating costs|operating expense|operating expenses|vacancy|tenant complaint|tenant complaints|property performance|lower returns|repair expense|repair expenses|maintenance investment|maintenance prioritization|item condition|gemstone|measurements?|measurement error|wrong measurement|modification|modifications|replacement material|replacement materials|fabric sample|lost fabric sample|missing fabric sample|fabric order|wrong fabric|incorrect fabric|fabric shortage|fabric out of stock|material quantity|material shortage|design change|customer change request|rework|remake|upholstery delay|furniture delivery delay|customer dispute|repair dispute|misunderstanding|condition mismatch|expired stock|expired product|expiration loss|expiry loss|emergency purchase|emergency request|blood product shortage|medical supply shortage|supplier delay|produce spoilage|spoiled produce|cold chain|temperature excursion|quality loss|partial load|partially empty deliver|farm pickup delay|market delivery delay|picture framing|framing mistake|measurement mistake|wrong measurement|frame remake|wrong glass|wrong moulding|material shortage|wasted supplies|customer design change|order change|recurring appointment|recurring booking|room specific instruction|room-specific instruction|cleaning supplies?|cleaner assignment|employee assignment|schedule change|scheduling conflict|missed task|forgotten customer request|inconsistent service|lost note|unclear instruction|injury recovery|recovery setback|recovery delay|reinjury|re-injury|training overload|training load spike|pain increase|pain report|mobility decline|return to play|return-to-play|missed warning sign|unsafe progression|missed maintenance|maintenance task missed|filter replacement missed|filter failure|equipment failure|unhealthy aquarium|water quality problem|water quality issue|feeding schedule missed|service history missing|visit history missing|repeated treatment|blind spot|provenance gap|chain of custody gap|ownership history conflict|authenticity dispute|valuation inconsistency|inconsistent valuation|record fragmentation|scattered archives?|duplicated research|duplicate research|wrong wording|missed revision|overlooked design change|outdated design|outdated version|wrong version|approved version|scattered dm|scattered message|lost client note|wasted paper|wasted ink|commission delay|delayed commission|repeated work|repeat work|cake design|wrong cake|custom cake|allergy note|allergy mistake|dietary requirement|forgotten dietary|wrong flavor|wrong flavour|wasted ingredient|ingredient waste|cake remake|pickup delay|last minute revision|last-minute revision|cash flow problem|profitability decline|declining property|financing cost|mortgage interest|interest rate increase|inaccurate return|return estimate|unexpected property expense|local market change|duplicate payment|duplicate payments|duplicate invoice|duplicate invoices|overpayment|overpayments|overspending|improper payment|improper payments|irregular expenditure|financial irregularity|financial irregularities|procurement fraud|procurement abuse|procurement scandal|corruption|embezzlement|kickback|kickbacks|suspicious spending|suspicious payment|questionable payment|government payment investigation|public spending investigation|operating room delay|operating room delays|surgery delay|surgery delays|procedure delay|procedure delays|scheduling conflict|scheduling conflicts|idle operating room|idle operating rooms|room turnover delay|staffing shortage|equipment unavailable|design approval confusion|wrong design version|unconfirmed design|lost design reference|missed revision|tattoo appointment confusion|client revision conflict)\w*\b/iu.test(
      normalized,
    );
  }

  private passesBroadDomainCollisionGuard(
    value: string,
    normalizedTerms: readonly string[],
    verticalConstraint: RequestVerticalConstraint,
  ): boolean {
    if (verticalConstraint.strict) {
      return true;
    }

    const normalized = value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();

    if (!normalized) return false;

    const foodSelected = normalizedTerms.some((term) =>
      /^(?:food|food & restaurants|food system|restaurant operations|kitchen workflow)$/u.test(
        term,
      ),
    );

    if (foodSelected && /\bfood\b/u.test(normalized)) {
      const foodContext = /\b(?:restaurant|restaurants|commercial kitchen|kitchen|food service|food delivery|food ordering|meal|meals|menu|menus|ingredient|ingredients|cooking|chef|dining|catering|grocery|groceries|food waste|refrigeration)\b/iu.test(
        normalized,
      );
      const otherSelectedDomainContext = normalizedTerms
        .filter(
          (term) =>
            term.length >= 5 &&
            !/^(?:food|food & restaurants|food system|food platform|food application|restaurant operations|kitchen workflow)$/u.test(
              term,
            ),
        )
        .some((term) => normalized.includes(term));

      if (!foodContext && !otherSelectedDomainContext) {
        return false;
      }
    }

    return true;
  }

  /**
   * Technical sources use domain vocabulary that differs from end-user labels.
   * This method recognizes transit feeds, sensor telemetry, and civic-service
   * integration terms as aliases of Smart Cities and Transportation.
   */
  private hasTechnicalDomainAlias(
    value: string,
    normalizedTerms: readonly string[],
  ): boolean {
    const normalized = value.normalize('NFKC').toLowerCase();
    const smartCitySelected = normalizedTerms.some((term) =>
      /smart cit|transport|public transport|urban mobility|city infrastructure|internet of things|iot/iu.test(
        term,
      ),
    );

    if (!smartCitySelected) {
      return false;
    }

    return /\b(?:gtfs(?:[_ -]?rt)?|general transit feed|avl feed|automatic vehicle location|train platform|platform change|arrival times?|departure times?|metro[- ]north|transit feed|parking availability|parking occupancy|street light|street lighting|traffic sensor|traffic signal|municipal service|civic service|vehicle location|sensor telemetry|iot sensor)\b/iu.test(
      normalized,
    );
  }

  /**
   * Adds compact technical aliases only when the selected domain family needs
   * them. These aliases improve scoring without polluting unrelated domains.
   */
  private expandTechnicalRelevanceTerms(
    normalizedTerms: readonly string[],
  ): string[] {
    const smartCitySelected = normalizedTerms.some((term) =>
      /smart cit|transport|public transport|urban mobility|city infrastructure|internet of things|iot/iu.test(
        term,
      ),
    );

    if (!smartCitySelected) {
      return [...normalizedTerms];
    }

    return this.unique([
      ...normalizedTerms,
      'gtfs',
      'gtfs rt',
      'transit feed',
      'train platform',
      'arrival time',
      'departure time',
      'parking availability',
      'parking occupancy',
      'street light',
      'traffic sensor',
      'municipal service',
      'vehicle location',
      'iot sensor',
    ]);
  }

  /**
   * Recovery thresholds are source aware. Technical community sources receive
   * a lower threshold only when a direct problem signal and technical-domain
   * alias are both present; noisy media and publisher sources remain strict.
   */
  private resolveMinimumRelevanceScore(
    sourceKey?: string,
    collectionMode?: CollectorInput['collectionMode'],
  ): number {
    if (collectionMode === 'TARGETED_RECOVERY') {
      return this.isTechnicalCommunitySource(sourceKey) ? 12 : 38;
    }

    if (collectionMode === 'FAST_GENERATION') {
      return this.isTechnicalCommunitySource(sourceKey) ? 15 : 35;
    }

    return this.MIN_RELEVANCE_SCORE;
  }

  private resolveContainerDomainMinimum(
    sourceKey?: string,
    collectionMode?: CollectorInput['collectionMode'],
  ): number {
    if (sourceKey === 'youtube') {
      return collectionMode === 'TARGETED_RECOVERY' ? 25 : 30;
    }

    return collectionMode === 'TARGETED_RECOVERY' ? 25 : 20;
  }

  private isTechnicalCommunitySource(sourceKey?: string): boolean {
    return sourceKey === 'github' || sourceKey === 'stackoverflow';
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
   * Gives marketplace collectors enough review depth to surface real user
   * complaints while keeping every collector inside the same fast timeout.
   *
   * App stores search only two applications but inspect more reviews per app.
   * Other sources keep the run-level limits unchanged.
   */
  private resolveSourceCollectorTimeoutMs(
    sourceKey: string,
    collectionMode: CollectorInput['collectionMode'],
    verticalConstraint: RequestVerticalConstraint | undefined,
    requestDescription: string,
    preferredSourceKeys: ReadonlySet<string>,
    blockedSourceKeys: ReadonlySet<string>,
    sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE',
  ): number | undefined {
    if (
      collectionMode !== 'FAST_GENERATION' &&
      collectionMode !== 'TARGETED_RECOVERY'
    ) {
      return undefined;
    }
    const key = sourceKey.toLocaleLowerCase();
    const tierCap =
      sourceTier === 'MICRO_PROBE'
        ? 2_100
        : sourceTier === 'SECONDARY'
          ? 3_800
          : 5_500;
    const recoveryAdjustment =
      collectionMode === 'TARGETED_RECOVERY' ? -700 : 0;
    const bounded = (value: number): number =>
      Math.min(tierCap, Math.max(1_500, value + recoveryAdjustment));

    // Discovery-only runs still execute every enabled collector, but no source
    // is allowed an unbounded wait just because there is no requester text.
    if (!requestDescription) {
      if (key === 'reddit') return bounded(5_200);
      if (key === 'app-store' || key === 'google-play') return bounded(4_500);
      if (key === 'crossref' || key === 'news' || key === 'forum') return bounded(4_200);
      return bounded(3_200);
    }

    /*
     * Review stores need time for two phases: app discovery and review fetch.
     * This value is a SOFT budget in generation mode (CollectorQueueService no
     * longer aborts the source), so crossing it only emits telemetry. Collector
     * local soft sub-deadlines still let the source return whatever completed.
     */
    if (key === 'app-store' || key === 'google-play') {
      return bounded(9_000);
    }

    const professionalEvidenceHeavy = Boolean(
      verticalConstraint?.strict &&
      [
        'PUBLIC_PROGRAM_COST_ATTRIBUTION',
        'OPERATIONAL_COST_ATTRIBUTION',
        'HEALTHCARE_SUPPLY_COST_EFFICIENCY',
        'HEALTHCARE_COST_RESOURCE_EFFICIENCY',
        'AGRICULTURE_DISTRIBUTION_PROFITABILITY',
        'AGRICULTURE_EXPORT_PROFITABILITY',
        'RESTORATION_CONSERVATION',
      ].includes(verticalConstraint.kind),
    );
    if (professionalEvidenceHeavy) {
      if (key === 'crossref') return bounded(6_000);
      if (key === 'news') return bounded(5_600);
      if (key === 'gdelt') return bounded(3_800);
    }

    /*
     * Strict requester workflows get source-aware deadlines before the generic
     * preferred-source timeout. The values are deliberately long enough for a
     * healthy source to finish, but short enough that one slow professional
     * lane cannot dominate the parallel collection wall clock.
     */
    if (verticalConstraint?.strict) {
      if (
        verticalConstraint.kind === 'RESTORATION_CONSERVATION' ||
        verticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL'
      ) {
        if (key === 'forum') return bounded(5_200);
        if (['news', 'crossref'].includes(key)) return bounded(4_800);
        if (key === 'youtube') return bounded(3_800);
        if (key === 'gdelt') return bounded(2_800);
        if (key === 'blog') return bounded(3_000);
      }
      if (verticalConstraint.kind === 'ECOMMERCE_MARGIN_PROFITABILITY') {
        if (['forum', 'news', 'crossref'].includes(key)) return bounded(4_800);
        if (key === 'youtube') return bounded(3_800);
        if (key === 'gdelt') return bounded(2_800);
        if (key === 'blog') return bounded(3_000);
      }
    }

    if (key === 'reddit') {
      /*
       * Reddit public RSS deliberately spaces requests to avoid 429 responses.
       * Resolve this before vertical-specific defaults so no request family can
       * accidentally push Reddit back to a 1.8-4.8s timeout.
       * The collector itself uses a smaller internal deadline and returns posts
       * before optional comments when the remaining budget is tight.
       */
      return bounded(7_200);
    }

    if (verticalConstraint?.strict && verticalConstraint.kind === 'HEALTHCARE_SUPPLY_COST_EFFICIENCY') {
      if (key === 'crossref') return bounded(6_200);
      if (key === 'news') return bounded(5_800);
      if (key === 'forum') return bounded(4_200);
      if (key === 'gdelt') return bounded(3_200);
      if (key === 'youtube') return bounded(3_000);
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'ACCOUNT_ACCESS_SECURITY'
    ) {
      if (['app-store', 'google-play'].includes(key)) return bounded(7_500);
      if (['news', 'crossref'].includes(key)) return bounded(4_400);
      if (key === 'youtube') return bounded(4_000);
      if (key === 'gdelt') return bounded(2_500);
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'PUBLIC_SECTOR' &&
      verticalConstraint.label === 'public grant evaluation and funding allocation'
    ) {
      if (['forum', 'news', 'gdelt', 'crossref', 'blog'].includes(key)) {
        return bounded(4_200);
      }
      if (key === 'youtube') return bounded(3_400);
      return bounded(2_200);
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      verticalConstraint.label ===
        'typewriter restoration condition parts and repair history operations'
    ) {
      if (['forum', 'youtube', 'blog'].includes(key)) return bounded(4_200);
      if (['crossref', 'news'].includes(key)) return bounded(3_200);
      if (key === 'gdelt') return bounded(2_500);
      return bounded(1_900);
    }

    if (
      verticalConstraint?.strict &&
      (verticalConstraint.kind === 'AGRICULTURE_EXPORT_PROFITABILITY' ||
        verticalConstraint.kind === 'AGRICULTURE_DISTRIBUTION_PROFITABILITY')
    ) {
      if (['news', 'crossref', 'forum'].includes(key)) return bounded(4_200);
      if (['gdelt', 'youtube', 'blog'].includes(key)) return bounded(3_600);
      return bounded(1_800);
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      verticalConstraint.label ===
        'eyeglass frame repair history parts fit and pickup operations'
    ) {
      if (['forum', 'youtube', 'news'].includes(key)) return bounded(3_800);
      if (['blog', 'crossref', 'gdelt'].includes(key)) return bounded(3_000);
      return bounded(1_700);
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'RESTAURANT_DELIVERY_FRAUD'
    ) {
      if (['app-store', 'google-play'].includes(key)) return bounded(6_500);
      if (['news', 'forum', 'youtube'].includes(key)) return bounded(3_600);
      if (key === 'gdelt') return bounded(3_200);
      if (['crossref', 'blog'].includes(key)) return bounded(2_800);
      return bounded(1_800);
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'FARM_ENERGY_OPERATIONS'
    ) {
      if (['news', 'crossref', 'gdelt', 'youtube', 'forum'].includes(key)) {
        return bounded(3_600);
      }
      if (key === 'blog') return bounded(2_000);
      return bounded(1_700);
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'RENEWABLE_ASSET_PERFORMANCE'
    ) {
      if (['news', 'gdelt', 'crossref', 'forum', 'blog', 'dev-to'].includes(key)) {
        return bounded(3_800);
      }
      if (key === 'youtube') return bounded(3_200);
      return bounded(1_800);
    }

    if (blockedSourceKeys.has(key)) return bounded(2_000);
    if (preferredSourceKeys.has(key)) return bounded(4_800);
    return bounded(3_000);
  }

  private resolveSourceCollectorLimits(
    sourceKey: string,
    collectionMode: CollectorInput['collectionMode'],
    limits: CollectorInput['limits'] | undefined,
    verticalConstraint: RequestVerticalConstraint | undefined,
    requestDescription: string,
    preferredSourceKeys: ReadonlySet<string>,
    blockedSourceKeys: ReadonlySet<string>,
    aiOwnedTextPlan: boolean,
  ): CollectorInput['limits'] {
    if (collectionMode !== 'FAST_GENERATION') {
      return limits;
    }

    const cap = (value: number | undefined, maximum: number): number =>
      Math.max(1, Math.min(value ?? maximum, maximum));
    const normalizedSourceKey = sourceKey.toLocaleLowerCase();

    // DOMAINS_ONLY / NO_INPUT now do the breadth up front so recovery is rarely
    // needed. PRIMARY lanes get two useful result slots and enough comments to
    // expose real complaints; MICRO_PROBE lanes are capped later by tier.
    if (!requestDescription.trim()) {
      return {
        // The tier limiter runs immediately after this method. Start with a
        // useful breadth budget so PRIMARY lanes can actually retain several
        // independent signals while SECONDARY/MICRO lanes are still capped.
        maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
        maxSavedPosts: cap(limits?.maxSavedPosts, 4),
        maxFetchedComments: cap(limits?.maxFetchedComments, 6),
        maxSavedComments: cap(limits?.maxSavedComments, 4),
      };
    }

    // All collectors participate for text requests too. Sources outside the
    // planner's preferred family are exploratory recall lanes, not equal-budget
    // fan-out. This keeps evidence breadth while protecting precision/tokens.
    if (
      preferredSourceKeys.size > 0 &&
      !preferredSourceKeys.has(normalizedSourceKey) &&
      !aiOwnedTextPlan
    ) {
      return {
        maxFetchedPosts: cap(limits?.maxFetchedPosts, 4),
        maxSavedPosts: cap(limits?.maxSavedPosts, 2),
        maxFetchedComments: cap(limits?.maxFetchedComments, 4),
        maxSavedComments: cap(limits?.maxSavedComments, 2),
      };
    }

    /*
     * A rich AI plan owns query wording, not evidence volume. Strict
     * restoration/physical/e-commerce workflows must apply their balanced
     * source budgets BEFORE the generic AI-owned-plan branch; otherwise one
     * broad Crossref/News source can consume most of the Community corpus with
     * lexical neighbours while specialist sources contribute little.
     * Community AI still receives every item actually fetched by these bounded
     * collectors through the all-collected raw ledger.
     */
    if (requestDescription && verticalConstraint?.strict) {
      if (blockedSourceKeys.has(normalizedSourceKey)) {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
          maxSavedPosts: cap(limits?.maxSavedPosts, 1),
          maxFetchedComments: cap(limits?.maxFetchedComments, 4),
          maxSavedComments: cap(limits?.maxSavedComments, 2),
        };
      }
      const balancedProblemFirstVertical =
        verticalConstraint.kind === 'RESTORATION_CONSERVATION' ||
        verticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL' ||
        verticalConstraint.kind === 'FOOD_STORAGE_CONDITION' ||
        verticalConstraint.kind === 'RENTAL_INVENTORY_OPERATIONS' ||
        verticalConstraint.kind === 'ECOMMERCE_MARGIN_PROFITABILITY' ||
        verticalConstraint.kind === 'PUBLIC_PROGRAM_COST_ATTRIBUTION' ||
        verticalConstraint.kind === 'OPERATIONAL_COST_ATTRIBUTION' ||
        verticalConstraint.kind === 'HEALTHCARE_SUPPLY_COST_EFFICIENCY';

      if (balancedProblemFirstVertical) {
        if (['forum', 'reddit'].includes(normalizedSourceKey)) {
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 12),
            maxSavedPosts: cap(limits?.maxSavedPosts, 7),
            maxFetchedComments: cap(limits?.maxFetchedComments, 20),
            maxSavedComments: cap(limits?.maxSavedComments, 6),
          };
        }
        if (normalizedSourceKey === 'crossref') {
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 12),
            maxSavedPosts: cap(limits?.maxSavedPosts, 8),
            maxFetchedComments: cap(limits?.maxFetchedComments, 2),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
        }
        if (normalizedSourceKey === 'news') {
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 10),
            maxSavedPosts: cap(limits?.maxSavedPosts, 6),
            maxFetchedComments: cap(limits?.maxFetchedComments, 2),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
        }
        if (normalizedSourceKey === 'youtube') {
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        }
        if (normalizedSourceKey === 'gdelt') {
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 1),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
        }
        if (normalizedSourceKey === 'blog') {
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 1),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
        }
      }
    }

    if (
      requestDescription &&
      aiOwnedTextPlan &&
      preferredSourceKeys.size > 0 &&
      !preferredSourceKeys.has(normalizedSourceKey)
    ) {
      return {
        maxFetchedPosts: cap(limits?.maxFetchedPosts, 4),
        maxSavedPosts: cap(limits?.maxSavedPosts, 2),
        maxFetchedComments: cap(limits?.maxFetchedComments, 4),
        maxSavedComments: cap(limits?.maxSavedComments, 2),
      };
    }

    if (requestDescription && aiOwnedTextPlan) {
      /*
       * Request-aware generation should collect a broad high-signal first-pass
       * corpus so targeted recovery is rarely necessary. These are source-level
       * budgets across parallel collectors; individual collectors still impose
       * tighter per-thread/per-item caps and Community AI applies lexical/source
       * hygiene before its single full-corpus race.
       */
      if (['news', 'crossref', 'gdelt', 'blog'].includes(normalizedSourceKey)) {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 10),
          maxSavedPosts: cap(limits?.maxSavedPosts, 6),
          maxFetchedComments: cap(limits?.maxFetchedComments, 4),
          maxSavedComments: cap(limits?.maxSavedComments, 2),
        };
      }

      if (['forum', 'reddit'].includes(normalizedSourceKey)) {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 9),
          maxSavedPosts: cap(limits?.maxSavedPosts, 6),
          maxFetchedComments: cap(limits?.maxFetchedComments, 16),
          maxSavedComments: cap(limits?.maxSavedComments, 8),
        };
      }

      if (normalizedSourceKey === 'youtube') {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 10),
          maxSavedPosts: cap(limits?.maxSavedPosts, 6),
          maxFetchedComments: cap(limits?.maxFetchedComments, 8),
          maxSavedComments: cap(limits?.maxSavedComments, 4),
        };
      }

      if (['app-store', 'google-play'].includes(normalizedSourceKey)) {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
          maxSavedPosts: cap(limits?.maxSavedPosts, 4),
          // Reviews are the evidence payload; keep every bounded fetched review
          // visible to Community instead of dropping three before semantic
          // classification. Listing posts remain discovery-only downstream.
          maxFetchedComments: cap(limits?.maxFetchedComments, 8),
          maxSavedComments: cap(limits?.maxSavedComments, 8),
        };
      }

      return {
        maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
        maxSavedPosts: cap(limits?.maxSavedPosts, 6),
        maxFetchedComments: cap(limits?.maxFetchedComments, 6),
        maxSavedComments: cap(limits?.maxSavedComments, 4),
      };
    }

    if (requestDescription && !aiOwnedTextPlan && !blockedSourceKeys.has(normalizedSourceKey)) {
      /*
       * PREPARING fallback must not mean narrow collection. The fallback is
       * still request-derived, so keep a large but bounded first-pass corpus
       * and let semantic triage decide relevance afterwards.
       */
      if (['news', 'crossref', 'gdelt', 'blog'].includes(normalizedSourceKey)) {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
          maxSavedPosts: cap(limits?.maxSavedPosts, 5),
          maxFetchedComments: cap(limits?.maxFetchedComments, 2),
          maxSavedComments: cap(limits?.maxSavedComments, 2),
        };
      }
      if (['forum', 'reddit'].includes(normalizedSourceKey)) {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
          maxSavedPosts: cap(limits?.maxSavedPosts, 5),
          maxFetchedComments: cap(limits?.maxFetchedComments, 12),
          maxSavedComments: cap(limits?.maxSavedComments, 6),
        };
      }
      if (normalizedSourceKey === 'youtube') {
        return {
          maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
          maxSavedPosts: cap(limits?.maxSavedPosts, 4),
          maxFetchedComments: cap(limits?.maxFetchedComments, 4),
          maxSavedComments: cap(limits?.maxSavedComments, 2),
        };
      }
      return {
        maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
        maxSavedPosts: cap(limits?.maxSavedPosts, 6),
        maxFetchedComments: cap(limits?.maxFetchedComments, 6),
        maxSavedComments: cap(limits?.maxSavedComments, 4),
      };
    }

    /*
     * Smart all-source fan-out keeps every source in the first pass, but a
     * source that the request archetype explicitly blocks receives only a
     * tiny exploratory budget. Sources outside the preferred family get a
     * bounded secondary budget. Preferred sources keep their source-specific
     * behavior below. No-text paths are left untouched.
     */
    if (requestDescription && blockedSourceKeys.has(normalizedSourceKey)) {
      return {
        maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
        maxSavedPosts: cap(limits?.maxSavedPosts, 1),
        maxFetchedComments: cap(limits?.maxFetchedComments, 4),
        maxSavedComments: cap(limits?.maxSavedComments, 2),
      };
    }

    if (
      requestDescription &&
      preferredSourceKeys.size > 0 &&
      !preferredSourceKeys.has(normalizedSourceKey)
    ) {
      return {
        maxFetchedPosts: cap(limits?.maxFetchedPosts, 4),
        maxSavedPosts: cap(limits?.maxSavedPosts, 2),
        maxFetchedComments: cap(limits?.maxFetchedComments, 6),
        maxSavedComments: cap(limits?.maxSavedComments, 2),
      };
    }

    if (
      verticalConstraint?.strict &&
      (verticalConstraint.kind === 'AGRICULTURE_EXPORT_PROFITABILITY' ||
        verticalConstraint.kind === 'AGRICULTURE_DISTRIBUTION_PROFITABILITY')
    ) {
      switch (normalizedSourceKey) {
        case 'news':
        case 'crossref':
        case 'gdelt':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'forum':
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 5),
          };
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 1),
            maxFetchedComments: cap(limits?.maxFetchedComments, 3),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      verticalConstraint.label ===
        'eyeglass frame repair history parts fit and pickup operations'
    ) {
      switch (normalizedSourceKey) {
        case 'forum':
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 5),
          };
        case 'news':
        case 'blog':
        case 'crossref':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 1),
            maxFetchedComments: cap(limits?.maxFetchedComments, 3),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'RESTAURANT_DELIVERY_FRAUD'
    ) {
      switch (normalizedSourceKey) {
        case 'app-store':
        case 'google-play':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 2),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 5),
          };
        case 'news':
        case 'gdelt':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'forum':
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 10),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'crossref':
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 4),
            maxSavedPosts: cap(limits?.maxSavedPosts, 2),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 1),
            maxFetchedComments: cap(limits?.maxFetchedComments, 3),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'FARM_ENERGY_OPERATIONS'
    ) {
      switch (normalizedSourceKey) {
        case 'news':
        case 'crossref':
        case 'gdelt':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'youtube':
        case 'forum':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 8),
            maxSavedComments: cap(limits?.maxSavedComments, 3),
          };
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 1),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 1),
            maxFetchedComments: cap(limits?.maxFetchedComments, 3),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'RENEWABLE_ASSET_PERFORMANCE'
    ) {
      switch (normalizedSourceKey) {
        case 'news':
        case 'gdelt':
        case 'crossref':
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'forum':
        case 'dev-to':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 10),
            maxSavedComments: cap(limits?.maxSavedComments, 3),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 2),
            maxFetchedComments: cap(limits?.maxFetchedComments, 8),
            maxSavedComments: cap(limits?.maxSavedComments, 2),
          };
        default:
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 1),
            maxFetchedComments: cap(limits?.maxFetchedComments, 3),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'PUBLIC_SECTOR' &&
      verticalConstraint.label === 'public grant evaluation and funding allocation'
    ) {
      switch (sourceKey) {
        case 'forum':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'news':
        case 'gdelt':
        case 'crossref':
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 8),
            maxSavedComments: cap(limits?.maxSavedComments, 3),
          };
        default:
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 3),
            maxSavedPosts: cap(limits?.maxSavedPosts, 2),
            maxFetchedComments: cap(limits?.maxFetchedComments, 4),
            maxSavedComments: cap(limits?.maxSavedComments, 2),
          };
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      verticalConstraint.label ===
        'typewriter restoration condition parts and repair history operations'
    ) {
      switch (sourceKey) {
        case 'forum':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 14),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 14),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'blog':
        case 'crossref':
        case 'news':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'gdelt':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 4),
            maxSavedPosts: cap(limits?.maxSavedPosts, 2),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 2),
            maxSavedPosts: cap(limits?.maxSavedPosts, 1),
            maxFetchedComments: cap(limits?.maxFetchedComments, 3),
            maxSavedComments: cap(limits?.maxSavedComments, 1),
          };
      }
    }

    if (sourceKey === 'google-play' || sourceKey === 'app-store') {
      return {
        maxFetchedPosts: Math.max(2, limits?.maxFetchedPosts ?? 2),
        maxSavedPosts: Math.max(2, limits?.maxSavedPosts ?? 2),
        maxFetchedComments: Math.max(20, limits?.maxFetchedComments ?? 20),
        maxSavedComments: Math.max(12, limits?.maxSavedComments ?? 12),
      };
    }

    /*
     * For high-confidence physical-service requests the first pass should be
     * community-first, not "save eighteen headlines from the first broad
     * publisher source". Lower per-source persistence caps keep source
     * diversity available to semantic triage, reduce database/LLM work, and
     * preserve more comment budget on sources that can contain first-person
     * workflow pain. The collectors still run concurrently.
     */
    if (
      verticalConstraint?.strict &&
      (verticalConstraint.kind === 'PHYSICAL_SERVICE_VERTICAL' ||
        verticalConstraint.kind === 'RESTORATION_CONSERVATION' ||
        verticalConstraint.kind === 'FOOD_STORAGE_CONDITION' ||
        verticalConstraint.kind === 'RENTAL_INVENTORY_OPERATIONS')
    ) {
      switch (sourceKey) {
        case 'forum':
        case 'reddit':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 9),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: cap(limits?.maxFetchedComments, 18),
            maxSavedComments: cap(limits?.maxSavedComments, 5),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 20),
            maxSavedComments: cap(limits?.maxSavedComments, 5),
          };
        case 'news':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'gdelt':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return limits;
      }
    }


    /*
     * Urban energy / EV infrastructure requests have strong academic and news
     * coverage, but saving a dozen variants from both News and Crossref only
     * enlarges semantic-triage and ranking cost. Keep corroborating sources
     * bounded while preserving enough independent utilization/cost evidence.
     */
    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'URBAN_ENERGY_DEMAND_INTELLIGENCE'
    ) {
      const cap = (value: number | undefined, maximum: number): number =>
        Math.max(1, Math.min(value ?? maximum, maximum));

      switch (sourceKey) {
        case 'forum':
        case 'reddit':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 10),
            maxSavedComments: cap(limits?.maxSavedComments, 3),
          };
        case 'news':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'gdelt':
        case 'crossref':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return limits;
      }
    }

    /*
     * Professional agency workflows should never spend the fast path on broad
     * consumer-app review corpora. Keep community and editorial sources small
     * and high-signal so semantic triage sees assignment/availability evidence
     * instead of dozens of generic scheduling-app comments.
     */
    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'PROFESSIONAL_SERVICE_AGENCY'
    ) {
      const cap = (
        value: number | undefined,
        maximum: number,
      ): number => Math.max(1, Math.min(value ?? maximum, maximum));

      switch (sourceKey) {
        case 'forum':
        case 'reddit':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: cap(limits?.maxFetchedComments, 14),
            maxSavedComments: cap(limits?.maxSavedComments, 5),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'news':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'gdelt':
        case 'crossref':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return limits;
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'MANUFACTURING_COST_PROFITABILITY'
    ) {
      const cap = (value: number | undefined, maximum: number): number =>
        Math.max(1, Math.min(value ?? maximum, maximum));
      switch (sourceKey) {
        case 'crossref':
        case 'news':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'reddit':
        case 'forum':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 8),
            maxSavedComments: cap(limits?.maxSavedComments, 3),
          };
        case 'blog':
        case 'gdelt':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return limits;
      }
    }

    if (verticalConstraint?.strict && verticalConstraint.kind === 'HEALTHCARE_SUPPLY_COST_EFFICIENCY') {
      const cap = (value: number | undefined, maximum: number): number => Math.max(1, Math.min(value ?? maximum, maximum));
      switch (sourceKey) {
        case 'crossref':
        case 'news': return { maxFetchedPosts: cap(limits?.maxFetchedPosts, 8), maxSavedPosts: cap(limits?.maxSavedPosts, 5), maxFetchedComments: 1, maxSavedComments: 1 };
        case 'reddit':
        case 'forum': return { maxFetchedPosts: cap(limits?.maxFetchedPosts, 7), maxSavedPosts: cap(limits?.maxSavedPosts, 4), maxFetchedComments: cap(limits?.maxFetchedComments, 10), maxSavedComments: cap(limits?.maxSavedComments, 4) };
        case 'gdelt': return { maxFetchedPosts: cap(limits?.maxFetchedPosts, 5), maxSavedPosts: cap(limits?.maxSavedPosts, 3), maxFetchedComments: 1, maxSavedComments: 1 };
        case 'youtube': return { maxFetchedPosts: cap(limits?.maxFetchedPosts, 4), maxSavedPosts: cap(limits?.maxSavedPosts, 2), maxFetchedComments: cap(limits?.maxFetchedComments, 4), maxSavedComments: cap(limits?.maxSavedComments, 2) };
        default: return limits;
      }
    }

    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'HEALTHCARE_COST_RESOURCE_EFFICIENCY'
    ) {
      const cap = (value: number | undefined, maximum: number): number =>
        Math.max(1, Math.min(value ?? maximum, maximum));
      switch (sourceKey) {
        case 'crossref':
        case 'news':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'reddit':
        case 'forum':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 12),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: cap(limits?.maxFetchedComments, 8),
            maxSavedComments: cap(limits?.maxSavedComments, 3),
          };
        case 'blog':
        case 'gdelt':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 5),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return limits;
      }
    }

    /*
     * Restaurant cost/energy requests already have a high-signal academic and
     * editorial surface. Keep each source bounded so one broad News/Crossref
     * lane cannot create a 30+ item corpus that then forces extra AI batches.
     * Community-bearing sources keep a larger comment allowance while
     * corroborating sources contribute only a few focused records.
     */
    if (
      verticalConstraint?.strict &&
      verticalConstraint.kind === 'RESTAURANT_ENERGY'
    ) {
      const cap = (
        value: number | undefined,
        maximum: number,
      ): number => Math.max(1, Math.min(value ?? maximum, maximum));

      switch (sourceKey) {
        case 'forum':
        case 'reddit':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: cap(limits?.maxFetchedComments, 16),
            maxSavedComments: cap(limits?.maxSavedComments, 5),
          };
        case 'youtube':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: cap(limits?.maxFetchedComments, 16),
            maxSavedComments: cap(limits?.maxSavedComments, 4),
          };
        case 'news':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 8),
            maxSavedPosts: cap(limits?.maxSavedPosts, 5),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'gdelt':
        case 'crossref':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 7),
            maxSavedPosts: cap(limits?.maxSavedPosts, 4),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        case 'blog':
          return {
            maxFetchedPosts: cap(limits?.maxFetchedPosts, 6),
            maxSavedPosts: cap(limits?.maxSavedPosts, 3),
            maxFetchedComments: 1,
            maxSavedComments: 1,
          };
        default:
          return limits;
      }
    }

    return limits;
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
  /**
   * Extracts a bounded lexical vocabulary from the AI retrieval plan. Terms
   * that recur across multiple planned queries are treated as stable request
   * concepts and can participate in collector/triage relevance scoring.
   *
   * This method changes retrieval recall only. It never labels a record as
   * verified evidence.
   */
  private extractPlannedRelevanceTerms(
    plannedQueries: readonly string[],
  ): string[] {
    if (plannedQueries.length === 0) return [];

    const stopWords = new Set([
      'about', 'after', 'before', 'business', 'businesses', 'complaint',
      'complaints', 'difficult', 'difficulty', 'discussion', 'discussions',
      'example', 'examples', 'from', 'issue', 'issues', 'management',
      'operator', 'operators', 'problem', 'problems', 'report', 'reports',
      'service', 'services', 'software', 'system', 'systems', 'tracking',
      'user', 'users', 'workflow', 'workflows', 'with', 'without',
    ]);
    const frequency = new Map<string, number>();

    for (const query of plannedQueries) {
      const tokens = query
        .normalize('NFKC')
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(
          (token) =>
            token.length >= 4 &&
            !stopWords.has(token),
        );

      for (const token of new Set(tokens)) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
      }
    }

    return [...frequency.entries()]
      .filter(([, count]) => count >= 2)
      .sort(
        (left, right) =>
          right[1] - left[1] ||
          right[0].length - left[0].length,
      )
      .map(([token]) => token)
      .slice(0, 16);
  }

  private hasPlannedSemanticOverlap(
    value: string,
    plannedQueries: readonly string[],
    minimumMatches = 2,
  ): boolean {
    const terms = this.extractPlannedRelevanceTerms(plannedQueries);
    if (terms.length === 0) return false;

    const normalized = value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!normalized) return false;

    let matches = 0;
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
        'u',
      );
      if (!pattern.test(normalized)) continue;
      matches += 1;
      if (matches >= minimumMatches) return true;
    }

    return false;
  }

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
  private unique(values: readonly string[]): string[] {
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
  private buildEmergencyRuntimeQueries(input: {
    readonly requestDescription: string;
    readonly domainName: string;
    readonly userKeywords: readonly string[];
  }): string[] {
    const clean = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

    const description = clean(input.requestDescription);
    const sentences = input.requestDescription
      .split(/[.!?]+/u)
      .map(clean)
      .filter(Boolean);
    const actorObject = sentences[0]?.split(/\s+/u).slice(0, 8).join(' ') ?? '';
    const lastSentence = sentences.length > 0 ? sentences[sentences.length - 1] : '';
    const consequence = lastSentence.split(/\s+/u).slice(0, 7).join(' ');
    const keywordLane = input.userKeywords
      .map(clean)
      .filter(Boolean)
      .slice(0, 4)
      .join(' ')
      .split(/\s+/u)
      .slice(0, 8)
      .join(' ');

    return this.unique([
      actorObject,
      [clean(input.domainName), keywordLane].filter(Boolean).join(' '),
      [actorObject.split(/\s+/u).slice(0, 4).join(' '), consequence]
        .filter(Boolean)
        .join(' '),
      description.split(/\s+/u).slice(0, 9).join(' '),
    ]).filter(Boolean).slice(0, 4);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown collection error.';
  }
}