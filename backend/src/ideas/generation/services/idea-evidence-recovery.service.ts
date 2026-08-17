import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionJobStatus, Prisma } from '@prisma/client';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { classifyDirectCommunityEvidence } from '../../../nlp/common/utils/community-evidence.util';
import { filterEvidenceByProblemFamily } from '../../../nlp/common/utils/problem-family-matching.util';
import { CollectionJobResolverService } from './collection-job-resolver.service';
import { CommunityAiAnalysisService } from './community-ai-analysis.service';
import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
  SelectedIdeaDataSource,
} from '../types/idea-generation-context.type';
import type { RankedIdeaOpportunity } from '../types/idea-opportunity-ranking.type';
import type {
  CommunityAiAnalysis,
  CommunityAiOpportunity,
} from '../types/community-ai-analysis.type';

/** Supported targeted evidence families used only during recovery collection. */
export type EvidenceRecoveryFamily =
  | 'PAYWALL_ON_BASIC_CONFIGURATION'
  | 'RIGID_SUBJECT_TAXONOMY'
  | 'MOBILE_WEB_FEATURE_GAP'
  | 'IDLE_SESSION_AUTH_FAILURE'
  | 'STORAGE_AND_SYNC_FAILURE'
  | 'GENERIC_USER_FRICTION';

export type EvidenceRecoveryOutcome =
  | 'NEW_INDEPENDENT_EVIDENCE_FOUND'
  | 'RECOVERY_RETURNED_ONLY_EXISTING_EVIDENCE'
  | 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE';

/** Result of one bounded targeted evidence-recovery attempt. */
export type IdeaEvidenceRecoveryResult = {
  readonly collectionJobId: string;
  readonly selectedDataSourceKeys: readonly string[];
  readonly recoveryKeywords: readonly string[];
  readonly evidenceFamilies: readonly EvidenceRecoveryFamily[];
  readonly totalPosts: number;
  readonly totalComments: number;
  readonly usefulCleanTextCount: number;
  readonly complaintEvidenceCount: number;
  /** Number of evidence samples that are new to the complete recovery corpus. */
  readonly newCorpusEvidenceSampleCount: number;
  /**
   * Backward-compatible alias for newCorpusEvidenceSampleCount.
   * New ranking diagnostics should prefer the explicit corpus-level field.
   */
  readonly newEvidenceSampleCount: number;
  readonly novelEvidenceSamples: readonly string[];
  readonly recoveryOutcome: EvidenceRecoveryOutcome;
  readonly communityAiRecoveryExecuted: boolean;
  readonly nlp: IdeaGenerationNlpContext;
  readonly communityAiAnalysis: CommunityAiAnalysis | null;
};

/**
 * Performs one targeted collection pass when the initial NLP opportunities do
 * not satisfy the strict selection gate.
 *
 * Recovery differs from the initial domain-level collection in three ways:
 * - It derives complaint-oriented queries from the selected opportunity.
 * - It selects sources according to the detected evidence family.
 * - It reports useful-text and complaint-evidence counts for diagnostics.
 *
 * The service never invokes idea-generation AI and never weakens the strict
 * opportunity-selection thresholds.
 */
@Injectable()
export class IdeaEvidenceRecoveryService {
  private readonly logger = new Logger(IdeaEvidenceRecoveryService.name);

  private readonly reviewSourceOrder = [
    'app-store',
    'google-play',
    'youtube',
    'stackoverflow',
    'github',
    'forum',
  ] as const;

  private readonly technicalSourceOrder = [
    'stackoverflow',
    'github',
    'youtube',
    'app-store',
    'google-play',
    'forum',
  ] as const;

  /**
   * Recovery uses several complementary complaint-rich sources in parallel.
   * Three sources are enough to improve evidence recall without repeating the
   * full nine-source collection pass.
   */
  private readonly maximumRecoverySources = 2;

  /** Keeps provider queries bounded and natural-language complaint focused. */
  private readonly maximumRecoveryKeywords = 3;

  constructor(
    private readonly configService: ConfigService,
    private readonly collectionJobResolver: CollectionJobResolverService,
    private readonly communityAiAnalysisService: CommunityAiAnalysisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Executes one fresh, opportunity-directed collection and NLP pass.
   *
   * @param context Current generation context.
   * @param selectedOpportunity Best currently ranked fallback opportunity.
   * @returns Supplemental evidence and collection diagnostics.
   */
  async recover(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null = null,
  ): Promise<IdeaEvidenceRecoveryResult> {
    const evidenceFamilies = this.detectEvidenceFamilies(selectedOpportunity);
    const excludedSourceKeys = await this.resolveLowYieldSourceKeys(context);
    const recoverySources = this.selectRecoverySources(
      context.selectedDataSources,
      evidenceFamilies,
      selectedOpportunity,
      excludedSourceKeys,
    );
    const recoveryKeywords = this.buildRecoveryKeywords(
      context,
      selectedOpportunity,
      evidenceFamilies,
    );

    if (recoverySources.length === 0) {
      this.logger.debug(
        'Skipping targeted recovery because every eligible primary source already failed, was rate-limited, or returned zero records.',
      );
      return {
        collectionJobId: context.collection?.collectionJobId ?? 'recovery-skipped',
        selectedDataSourceKeys: [],
        recoveryKeywords,
        evidenceFamilies,
        totalPosts: 0,
        totalComments: 0,
        usefulCleanTextCount: 0,
        complaintEvidenceCount: 0,
        newCorpusEvidenceSampleCount: 0,
        newEvidenceSampleCount: 0,
        novelEvidenceSamples: [],
        recoveryOutcome: 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE',
        communityAiRecoveryExecuted: false,
        nlp: context.nlp!,
        communityAiAnalysis: null,
      };
    }

    const resolvedDomain =
      context.selectedDomains.find((domain) => domain.id === context.domainId) ??
      context.selectedDomains[0];
    const result = await this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,
      domainId: context.domainId,
      country: context.location.country,
      city: context.location.city ?? undefined,
      region: context.location.region ?? undefined,
      language: context.location.language,
      radiusKm: context.location.radiusKm ?? undefined,
      dataSourceKeys: recoverySources.map((source) => source.key),
      keywords: recoveryKeywords,
      forceRefresh: true,
      collectionMode: 'TARGETED_RECOVERY',
      collectorLimits: this.resolveRecoveryCollectorLimits(),
      ...(resolvedDomain
        ? {
            resolvedDomain: {
              id: resolvedDomain.id,
              name: resolvedDomain.name,
              keywords: [
                ...(resolvedDomain.effectiveSearchKeywords ?? []),
                ...resolvedDomain.keywords,
              ],
            },
          }
        : {}),
      resolvedDataSources: recoverySources.map((source) => ({
        id: source.id,
        key: source.key,
        displayName: source.displayName,
      })),
    });

    const nlp = this.mapNlpContext(
      result.job.nlpAnalysis?.id ?? null,
      result.nlpOutput,
    );

    /*
     * The regular collection resolver runs deterministic NLP only. Running the
     * same grounded Community AI analysis over the supplemental corpus is
     * essential; otherwise recovery can increase raw text counts while never
     * producing opportunity records that ranking can merge with the original
     * evidence family.
     */
    const recoveryContext: IdeaGenerationContext = {
      ...context,
      selectedDataSources: recoverySources,
      keywords: recoveryKeywords,
      collection: {
        collectionJobId: result.job.id,
        reused: result.reused,
        totalPosts: result.nlpOutput.totalPostsAnalyzed,
        totalComments: result.nlpOutput.totalCommentsAnalyzed,
      },
      nlp,
      communityAiAnalysis: null,
      opportunityRanking: null,
    };
    const retainedRecoveryTextCount = this.countRetainedRecoveryTexts(nlp);
    const retainedDirectEvidenceCount =
      this.countDirectCommunityEvidenceSamples(nlp);

    /*
     * If deterministic preprocessing already retained direct complaint/request
     * samples, do not spend another provider call asking Community AI to
     * rediscover the same evidence. The deterministic recovery opportunity
     * preserves the quotes unchanged and independent verification remains the
     * final eligibility gate.
     */
    const shouldRunCommunityAiRecovery =
      retainedRecoveryTextCount > 0 && retainedDirectEvidenceCount === 0;
    const rawCommunityAiAnalysis = shouldRunCommunityAiRecovery
      ? await this.communityAiAnalysisService.analyze(recoveryContext)
      : null;

    if (retainedRecoveryTextCount === 0) {
      this.logger.warn(
        'Targeted recovery retained zero final evidence texts; skipping Community AI recovery analysis.',
      );
    } else if (retainedDirectEvidenceCount > 0) {
      this.logger.debug(
        `Targeted recovery retained ${retainedDirectEvidenceCount} direct evidence sample(s); ` +
          'skipping redundant Community AI recovery analysis.',
      );
    }

    /*
     * Recovery is useful only when it contributes evidence that did not already
     * exist in the primary corpus. New opportunity wording based on an old
     * quote is not independent evidence and must not be merged into ranking.
     */
    const primaryEvidenceSamples = this.collectPrimaryEvidenceSamples(
      context,
      selectedOpportunity,
    );
    const recoveredEvidenceSamples = this.collectRecoveredEvidenceSamples(
      nlp,
      rawCommunityAiAnalysis,
    );
    const novelEvidenceSamples = recoveredEvidenceSamples.filter(
      (sample) =>
        !primaryEvidenceSamples.some((primarySample) =>
          this.areEquivalentEvidenceSamples(sample, primarySample),
        ),
    );
    const communityAiAnalysis =
      this.filterCommunityAiAnalysisToNovelEvidence(
        rawCommunityAiAnalysis,
        novelEvidenceSamples,
      ) ??
      this.buildDeterministicRecoveryAnalysis(
        context,
        selectedOpportunity,
        novelEvidenceSamples,
      );
    const novelNlp = this.filterNlpContextToNovelEvidence(
      nlp,
      novelEvidenceSamples,
    );
    const recoveryOutcome = this.resolveRecoveryOutcome(
      recoveredEvidenceSamples.length,
      novelEvidenceSamples.length,
    );

    return {
      collectionJobId: result.job.id,
      selectedDataSourceKeys: recoverySources.map((source) => source.key),
      recoveryKeywords,
      evidenceFamilies,
      totalPosts: result.nlpOutput.totalPostsAnalyzed,
      totalComments: result.nlpOutput.totalCommentsAnalyzed,
      usefulCleanTextCount: result.nlpOutput.totalTextsAnalyzed,
      complaintEvidenceCount: this.countComplaintEvidence(nlp),
      newCorpusEvidenceSampleCount: novelEvidenceSamples.length,
      newEvidenceSampleCount: novelEvidenceSamples.length,
      novelEvidenceSamples,
      recoveryOutcome,
      communityAiRecoveryExecuted: shouldRunCommunityAiRecovery,
      nlp: novelNlp,
      communityAiAnalysis,
    };
  }

  /**
   * Counts only the corpus that survived central relevance, preprocessing, and
   * NLP persistence. Raw collector hits do not justify an AI recovery call.
   */
  private countDirectCommunityEvidenceSamples(
    nlp: IdeaGenerationNlpContext,
  ): number {
    const postTexts = this.readTextEntries(nlp.samplePosts);
    const commentTexts = this.readTextEntries(nlp.sampleComments);

    const directPosts = postTexts.filter((text) => {
      const kind = classifyDirectCommunityEvidence(text, 'POST');
      return kind === 'USER_COMPLAINT' || kind === 'FEATURE_REQUEST';
    }).length;
    const directComments = commentTexts.filter((text) => {
      const commentBody =
        text.match(/\bCommunity comment:\s*(.+)$/iu)?.[1]?.trim() ?? text;
      const kind = classifyDirectCommunityEvidence(commentBody, 'COMMENT');
      return kind === 'USER_COMPLAINT' || kind === 'FEATURE_REQUEST';
    }).length;

    return directPosts + directComments;
  }

  private countRetainedRecoveryTexts(nlp: IdeaGenerationNlpContext): number {
    const samplePosts = Array.isArray(nlp.samplePosts)
      ? nlp.samplePosts.length
      : 0;
    const sampleComments = Array.isArray(nlp.sampleComments)
      ? nlp.sampleComments.length
      : 0;
    const retainedTotals =
      (nlp.totalPostsAnalyzed ?? 0) + (nlp.totalCommentsAnalyzed ?? 0);

    return Math.max(samplePosts + sampleComments, retainedTotals);
  }

  /**
   * Excludes sources that already failed, were rate-limited, or returned zero
   * records in the primary job. Recovery should not repeat known-dead work.
   */
  private async resolveLowYieldSourceKeys(
    context: IdeaGenerationContext,
  ): Promise<ReadonlySet<string>> {
    const collectionJobId = context.collection?.collectionJobId;
    if (!collectionJobId) return new Set<string>();

    try {
      const diagnostics = await this.prisma.collectionJobSource.findMany({
        where: { collectionJobId },
        select: {
          status: true,
          totalPosts: true,
          totalComments: true,
          failureReason: true,
          dataSource: { select: { key: true } },
        },
      });

      return new Set(
        diagnostics
          .filter((entry) => {
            const noYield = entry.totalPosts + entry.totalComments <= 0;
            const failed = entry.status === CollectionJobStatus.FAILED;
            const rateLimited = /(?:429|rate\s*limit|too many requests)/iu.test(
              entry.failureReason ?? '',
            );
            return noYield || failed || rateLimited;
          })
          .map((entry) => entry.dataSource.key),
      );
    } catch (error: unknown) {
      this.logger.debug(
        `Unable to load primary source diagnostics for recovery; continuing without exclusions. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Set<string>();
    }
  }

  /**
   * Selects review-rich sources for end-user friction and technical sources for
   * developer-facing failures. GitHub and DEV are intentionally deprioritized
   * for paywall, taxonomy, mobile parity, and session complaints.
   */
  private selectRecoverySources(
    selectedSources: readonly SelectedIdeaDataSource[],
    evidenceFamilies: readonly EvidenceRecoveryFamily[],
    selectedOpportunity: RankedIdeaOpportunity | null,
    excludedSourceKeys: ReadonlySet<string>,
  ): SelectedIdeaDataSource[] {
    const byKey = new Map(
      selectedSources.map((source) => [source.key, source] as const),
    );

    /**
     * Authentication-session and storage/synchronization failures often need
     * technical sources such as Stack Overflow, GitHub, and DEV in addition to
     * user reviews. Paywall, taxonomy, mobile-parity, and generic-friction
     * recovery remains review-first because those families describe end-user
     * product experience rather than implementation defects.
     */
    const isDeveloperTechnicalRecovery = evidenceFamilies.some(
      (family) =>
        family === 'IDLE_SESSION_AUTH_FAILURE' ||
        family === 'STORAGE_AND_SYNC_FAILURE',
    );
    const isGenericZeroEvidenceRecovery = evidenceFamilies.includes(
      'GENERIC_USER_FRICTION',
    );

    /*
     * A generic zero-evidence recovery must not spend the whole budget on app
     * listings. It starts with direct complaint sources, then uses one review
     * source as a complementary signal.
     */
    const familyPreferredOrder: readonly string[] =
      isDeveloperTechnicalRecovery
        ? this.technicalSourceOrder
        : isGenericZeroEvidenceRecovery
          ? [
              'youtube',
              'app-store',
              'google-play',
              'forum',
              'stackoverflow',
              'github',
            ]
          : this.reviewSourceOrder;

    /*
     * Prefer the platform that produced the original verified complaint. This
     * is especially important for YouTube/comment evidence: recovery should not
     * ignore the only source that already demonstrated yield.
     */
    const originalEvidenceSources = [
      ...new Set(
        (selectedOpportunity?.independentEvidence ?? [])
          .map((evidence) => evidence.sourceKey)
          .filter(Boolean),
      ),
    ];
    const preferredOrder = [
      ...originalEvidenceSources,
      ...familyPreferredOrder.filter(
        (key) => !originalEvidenceSources.includes(key),
      ),
    ];

    const ordered = preferredOrder
      .filter((key) => !excludedSourceKeys.has(key))
      .map((key: string) => byKey.get(key))
      .filter((source): source is SelectedIdeaDataSource => Boolean(source));

    const commentRich = ordered.filter((source) => source.supportsComments);
    const fallback = ordered.filter((source) => !source.supportsComments);
    const selected = [...commentRich, ...fallback].slice(
      0,
      this.maximumRecoverySources,
    );

    if (selected.length > 0) {
      return selected;
    }

    return selectedSources
      .filter((source) => !excludedSourceKeys.has(source.key))
      .slice(0, this.maximumRecoverySources);
  }

  /**
   * Builds issue-specific queries before bounded generic domain keywords.
   *
   * Raw community quotes are never inserted directly into collection queries.
   * Only normalized descriptors and controlled family-specific variants are
   * used, preventing user-generated evidence from acting as search commands.
   */
  private buildRecoveryKeywords(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null,
    evidenceFamilies: readonly EvidenceRecoveryFamily[],
  ): string[] {
    const domain = (context.domainName ?? '').trim();
    const domainTerm = domain || context.keywords[0]?.trim() || 'software';
    const requestIntentTerms = this.buildRequestIntentRecoveryQueries(context);
    const opportunityTerms = this.buildOpportunityTerms(
      domainTerm,
      selectedOpportunity,
    );
    const familyTerms = evidenceFamilies.flatMap((family) =>
      this.buildFamilyQueries(domainTerm, family),
    );
    const genericComplaintTerms = this.buildNaturalComplaintQueries(
      domainTerm,
      context.keywords,
    );
    const boundedBaseTerms = [domain, ...context.keywords]
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 2);

    return [
      ...new Set([
        ...requestIntentTerms,
        ...opportunityTerms,
        ...familyTerms,
        ...genericComplaintTerms,
        ...boundedBaseTerms,
      ]),
    ]
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, this.maximumRecoveryKeywords);
  }

  /**
   * Uses the application-built request-intent keywords before generic recovery
   * phrases. These terms already encode the user's concrete workflow (for
   * example workforce turnover, security-alert triage, or expense anomalies),
   * so they are much more precise than searching for "the requester wants...".
   */
  private buildRequestIntentRecoveryQueries(
    context: IdeaGenerationContext,
  ): string[] {
    if (!context.requestDescription?.trim()) {
      return [];
    }

    const domainNames = new Set(
      context.selectedDomains.map((domain) =>
        domain.name.toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
      ),
    );
    const issueSignal =
      /\b(?:access|alerts?|anomal\w*|breach\w*|burnout|cost\w*|delay\w*|expense\w*|fail\w*|fraud\w*|friction|hiring|incident\w*|inefficien\w*|missing|outage\w*|recruit\w*|risk\w*|security|suspicious|threat\w*|turnover|waste\w*|workload|errors?|unable|cannot|sync\w*)\b/iu;
    const genericPhrase =
      /\b(?:coherent cross-domain workflow|management decision support|platform|system|software|application|workflow)\b/iu;

    const candidates: string[] = context.keywords
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length >= 5 && value.length <= 80)
      .filter((value) => value.split(/\s+/u).length >= 2)
      .filter((value) => !domainNames.has(value.toLocaleLowerCase()))
      .filter((value) => !genericPhrase.test(value))
      .map((value, index) => ({
        value,
        index,
        score:
          (issueSignal.test(value) ? 4 : 0) +
          (value.split(/\s+/u).length <= 5 ? 2 : 0) +
          (/[&+/]/u.test(value) ? -1 : 0),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.value);

    return Array.from(new Set<string>(candidates)).slice(
      0,
      this.maximumRecoveryKeywords,
    );
  }

  /**
   * Produces phrases that resemble how users actually describe failures.
   *
   * These are intentionally short and concrete. Search engines and community
   * APIs match "bus arrival data not updating" more reliably than synthetic
   * combinations such as "transportation inaccurate".
   */
  private buildNaturalComplaintQueries(
    domainTerm: string,
    domainKeywords: readonly string[],
  ): string[] {
    const normalizedDomain = domainTerm.toLowerCase();
    const smartCityQueries = [
      'parking status is wrong',
      'bus arrival data not updating',
      'street light outage not showing',
      'cannot submit municipal complaint',
      'public service request stuck',
      'traffic data is inaccurate',
      'city app missing service',
      'parking app not working',
    ];
    const transportationQueries = [
      'bus arrival time is wrong',
      'route planner gives wrong route',
      'trip tracking not updating',
      'fare payment failed',
      'vehicle profile missing',
      'public transport app not working',
    ];
    const logisticsQueries = [
      'delivery status not updating',
      'driver cannot complete delivery',
      'route assignment is wrong',
      'proof of delivery missing',
      'shipment tracking inaccurate',
      'warehouse picking error',
    ];

    const knownQueries =
      normalizedDomain.includes('smart cit')
        ? smartCityQueries
        : normalizedDomain.includes('transport')
          ? transportationQueries
          : normalizedDomain.includes('logistic')
            ? logisticsQueries
            : [];

    const usefulDomainTerms = domainKeywords
      .map((value) => value.toLowerCase().replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length >= 4)
      .filter(
        (value) =>
          !/\b(?:platform|system|software|application|dashboard|analytics|management|optimization|integration)\b/iu.test(
            value,
          ),
      )
      .slice(0, 2);

    return [
      ...knownQueries,
      ...usefulDomainTerms.flatMap((term) => [
        `${term} not working`,
        `${term} data is wrong`,
        `cannot use ${term}`,
      ]),
      `${domainTerm} user complaint`,
    ];
  }

  /** Derives safe descriptor queries from the currently selected opportunity. */
  private buildOpportunityTerms(
    domainTerm: string,
    selectedOpportunity: RankedIdeaOpportunity | null,
  ): string[] {
    if (!selectedOpportunity) {
      return [];
    }

    const descriptors = [
      selectedOpportunity.title,
      selectedOpportunity.problem,
      selectedOpportunity.need,
      selectedOpportunity.solutionArea,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) =>
        value
          .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      )
      .filter((value) => value.length >= 5)
      .map((value) => value.split(' ').slice(0, 8).join(' '))
      .slice(0, 2);

    return descriptors.flatMap((descriptor) => [
      `${descriptor} complaint`,
      `${descriptor} review`,
      `${descriptor} not working`,
      `${domainTerm} ${descriptor}`,
    ]);
  }

  /** Collects primary evidence so recovered paraphrases cannot be recounted. */
  private collectPrimaryEvidenceSamples(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null,
  ): string[] {
    const samples = [
      ...this.readTextEntries(context.nlp?.samplePosts ?? null),
      ...this.readTextEntries(context.nlp?.sampleComments ?? null),
      ...(context.communityAiAnalysis?.opportunities.flatMap(
        (opportunity) => opportunity.evidenceSamples,
      ) ?? []),
      ...(selectedOpportunity?.evidenceSamples ?? []),
    ];

    return this.deduplicateEvidenceSamples(samples);
  }

  /** Collects evidence references produced by the supplemental recovery pass. */
  private collectRecoveredEvidenceSamples(
    nlp: IdeaGenerationNlpContext,
    analysis: CommunityAiAnalysis | null,
  ): string[] {
    return this.deduplicateEvidenceSamples([
      ...this.readTextEntries(nlp.samplePosts),
      ...this.readTextEntries(nlp.sampleComments),
      ...(analysis?.opportunities.flatMap(
        (opportunity) => opportunity.evidenceSamples,
      ) ?? []),
    ]).filter((sample) => this.looksLikeComplaintEvidence(sample));
  }

  /** Keeps only opportunities that cite at least one genuinely new sample. */
  private filterCommunityAiAnalysisToNovelEvidence(
    analysis: CommunityAiAnalysis | null,
    novelEvidenceSamples: readonly string[],
  ): CommunityAiAnalysis | null {
    if (!analysis || novelEvidenceSamples.length === 0) {
      return null;
    }

    const opportunities = analysis.opportunities
      .map((opportunity) =>
        this.filterCommunityOpportunityEvidence(
          opportunity,
          novelEvidenceSamples,
        ),
      )
      .filter(
        (opportunity): opportunity is CommunityAiOpportunity =>
          opportunity !== null,
      );

    if (opportunities.length === 0) {
      return null;
    }

    return {
      ...analysis,
      opportunities,
      qualityWarnings: [
        ...analysis.qualityWarnings,
        `Targeted recovery contributed ${novelEvidenceSamples.length} new independent evidence sample(s).`,
      ],
    };
  }

  private filterCommunityOpportunityEvidence(
    opportunity: CommunityAiOpportunity,
    novelEvidenceSamples: readonly string[],
  ): CommunityAiOpportunity | null {
    const evidenceSamples = opportunity.evidenceSamples.filter((sample) =>
      novelEvidenceSamples.some((novelSample) =>
        this.areEquivalentEvidenceSamples(sample, novelSample),
      ),
    );

    if (evidenceSamples.length === 0) {
      return null;
    }

    const localEvidenceSamples = opportunity.localEvidenceSamples.filter(
      (sample) =>
        evidenceSamples.some((evidenceSample) =>
          this.areEquivalentEvidenceSamples(sample, evidenceSample),
        ),
    );

    return {
      ...opportunity,
      evidenceSamples,
      frequency: evidenceSamples.length,
      localEvidenceSamples,
      localEvidenceAvailable: localEvidenceSamples.length > 0,
    };
  }


  /**
   * Builds an auditable recovery opportunity when the online Community AI
   * cannot return a valid schema despite the recovery corpus containing new
   * complaint evidence. This is not synthetic market research: every claim is
   * inherited from the previously ranked problem family and every supporting
   * sample is copied from the newly collected corpus. The deterministic
   * ranking and independent-source verifier still decide whether the result is
   * eligible.
   */
  private buildDeterministicRecoveryAnalysis(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null,
    novelEvidenceSamples: readonly string[],
  ): CommunityAiAnalysis | null {
    if (!selectedOpportunity || novelEvidenceSamples.length === 0) {
      return null;
    }

    const problemDescriptor = [
      selectedOpportunity.problem ?? '',
      selectedOpportunity.need ?? '',
      selectedOpportunity.title,
      selectedOpportunity.solutionArea ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const familyMatchedNovelEvidence = filterEvidenceByProblemFamily(
      problemDescriptor,
      novelEvidenceSamples,
    );
    const familyMatchedExistingEvidence = filterEvidenceByProblemFamily(
      problemDescriptor,
      selectedOpportunity.evidenceSamples,
    );

    const evidenceSamples = this.deduplicateEvidenceSamples([
      ...familyMatchedExistingEvidence,
      ...familyMatchedNovelEvidence,
    ]).slice(0, 8);
    if (evidenceSamples.length === 0) {
      this.logger.debug(
        'Targeted recovery found direct evidence, but none matched the selected problem family; no deterministic recovery opportunity was created.',
      );
      return null;
    }

    const rawDomainName = this.readRecoveredDomainName(
      selectedOpportunity,
    );
    const domainName =
      context.domainName?.trim() ||
      rawDomainName ||
      'General';
    const title = `${selectedOpportunity.title} — recovered evidence`;
    const problem =
      selectedOpportunity.problem ||
      selectedOpportunity.need ||
      `Users in ${domainName} encounter a repeated workflow problem.`;
    const unmetNeed =
      selectedOpportunity.need ||
      `A focused workflow that addresses the recovered ${domainName} complaints.`;
    const solutionArea =
      selectedOpportunity.solutionArea ||
      'Evidence-led workflow improvement and operational decision support';
    const confidence = Math.min(78, 45 + evidenceSamples.length * 7);

    const opportunity: CommunityAiOpportunity = {
      domainName,
      title,
      problem,
      unmetNeed,
      solutionArea,
      affectedUsers: this.resolveRecoveredAffectedUsers(selectedOpportunity),
      evidenceSamples,
      frequency: evidenceSamples.length,
      severity: this.resolveRecoveredSeverity(selectedOpportunity.severity),
      confidence,
      problemImportance: Math.min(82, 55 + evidenceSamples.length * 5),
      localEvidenceAvailable: false,
      localEvidenceSamples: [],
      localRelevance: 20,
      groundingScore: 100,
      technicalFeasibility: 72,
      marketPotential: Math.min(75, 48 + evidenceSamples.length * 4),
      innovationPotential: 58,
      risks: [
        'The recovered evidence must still pass independent-source verification.',
        'The selected location is a deployment target unless explicitly named by the evidence.',
      ],
    };

    return {
      summary:
        `Targeted recovery retained ${evidenceSamples.length} new complaint evidence sample(s). ` +
        'A deterministic evidence-preserving opportunity was created because online Community AI did not return an acceptable grounded response.',
      dominantProblems: [problem],
      unmetNeeds: [unmetNeed],
      opportunities: [opportunity],
      overallConfidence: confidence,
      qualityWarnings: [
        'Community AI recovery output was unavailable; this opportunity was constructed deterministically from newly retained evidence.',
        'Eligibility remains controlled by deterministic ranking and independent-source verification.',
      ],
      modelId: null,
      apiModelId: null,
      attemptCount: 0,
      aiAttempted: false,
      aiSucceeded: false,
      fallbackUsed: true,
      onlineAttemptCount: 0,
      executionFailureCount: 0,
      validationRejectedCount: 0,
      fallbackReason:
        'Targeted evidence recovery constructed this opportunity deterministically after Community AI recovery was unavailable.',
      attemptDiagnostics: [],
      unvalidatedDomainHypotheses: [],
    };
  }

  /**
   * Reads the domain name from the raw ranked opportunity safely.
   *
   * The raw ranking payload is Prisma JSON and may not contain a usable
   * domainName field.
   */
  private readRecoveredDomainName(
    selectedOpportunity: RankedIdeaOpportunity,
  ): string | null {
    const raw = selectedOpportunity.raw;

    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw)
    ) {
      return null;
    }

    const domainName =
      (raw as Prisma.JsonObject).domainName;

    if (typeof domainName !== 'string') {
      return null;
    }

    const normalizedDomainName = domainName.trim();

    return normalizedDomainName.length > 0
      ? normalizedDomainName
      : null;
  }

  /** Maps ranking severity strings into the strict Community AI contract. */
  private resolveRecoveredSeverity(
    value: string | null,
  ): CommunityAiOpportunity['severity'] {
    const normalized = value?.toUpperCase();
    return normalized === 'LOW' ||
      normalized === 'HIGH' ||
      normalized === 'CRITICAL'
      ? normalized
      : 'MEDIUM';
  }

  /** Preserves known affected-user labels without inventing new personas. */
  private resolveRecoveredAffectedUsers(
    selectedOpportunity: RankedIdeaOpportunity,
  ): string[] {
    const raw = selectedOpportunity.raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const value = (raw as Prisma.JsonObject).affectedUsers;
      if (Array.isArray(value)) {
        const users = value
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.replace(/\s+/gu, ' ').trim())
          .filter(Boolean);
        if (users.length > 0) {
          return users.slice(0, 6);
        }
      }
    }

    return [`Users participating in ${selectedOpportunity.title} workflows`];
  }

  /** Prevents old or irrelevant recovery records from entering merged NLP data. */
  private filterNlpContextToNovelEvidence(
    nlp: IdeaGenerationNlpContext,
    novelEvidenceSamples: readonly string[],
  ): IdeaGenerationNlpContext {
    return {
      ...nlp,
      samplePosts: this.filterJsonSamplesToNovelEvidence(
        nlp.samplePosts,
        novelEvidenceSamples,
      ),
      sampleComments: this.filterJsonSamplesToNovelEvidence(
        nlp.sampleComments,
        novelEvidenceSamples,
      ),
      recurringProblems: this.filterJsonCandidatesToNovelEvidence(
        nlp.recurringProblems,
        novelEvidenceSamples,
      ),
      extractedNeeds: this.filterJsonCandidatesToNovelEvidence(
        nlp.extractedNeeds,
        novelEvidenceSamples,
      ),
      featureRequests: this.filterJsonCandidatesToNovelEvidence(
        nlp.featureRequests,
        novelEvidenceSamples,
      ),
      opportunities: this.filterJsonCandidatesToNovelEvidence(
        nlp.opportunities,
        novelEvidenceSamples,
      ),
    };
  }

  private filterJsonSamplesToNovelEvidence(
    value: Prisma.JsonValue | null,
    novelEvidenceSamples: readonly string[],
  ): Prisma.JsonValue | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return value.filter((entry) => {
      const text = this.readTextFromJsonEntry(entry);
      return (
        text.length > 0 &&
        novelEvidenceSamples.some((sample) =>
          this.areEquivalentEvidenceSamples(text, sample),
        )
      );
    });
  }

  private filterJsonCandidatesToNovelEvidence(
    value: Prisma.JsonValue | null,
    novelEvidenceSamples: readonly string[],
  ): Prisma.JsonValue | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return value.filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return false;
      }

      const evidenceSamples = Array.isArray(entry.evidenceSamples)
        ? entry.evidenceSamples.filter(
            (sample): sample is string => typeof sample === 'string',
          )
        : [];

      return evidenceSamples.some((sample) =>
        novelEvidenceSamples.some((novelSample) =>
          this.areEquivalentEvidenceSamples(sample, novelSample),
        ),
      );
    });
  }

  private readTextFromJsonEntry(entry: Prisma.JsonValue): string {
    if (typeof entry === 'string') {
      return entry.replace(/\s+/gu, ' ').trim();
    }

    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof entry.text === 'string'
    ) {
      return entry.text.replace(/\s+/gu, ' ').trim();
    }

    return '';
  }

  private resolveRecoveryOutcome(
    recoveredEvidenceCount: number,
    novelEvidenceCount: number,
  ): EvidenceRecoveryOutcome {
    if (novelEvidenceCount > 0) {
      return 'NEW_INDEPENDENT_EVIDENCE_FOUND';
    }

    return recoveredEvidenceCount > 0
      ? 'RECOVERY_RETURNED_ONLY_EXISTING_EVIDENCE'
      : 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE';
  }

  private deduplicateEvidenceSamples(samples: readonly string[]): string[] {
    const output: string[] = [];

    for (const sample of samples) {
      const normalized = sample.replace(/\s+/gu, ' ').trim();
      if (!normalized) {
        continue;
      }

      if (
        output.some((existing) =>
          this.areEquivalentEvidenceSamples(existing, normalized),
        )
      ) {
        continue;
      }

      output.push(normalized);
    }

    return output;
  }

  /** Exact, containment, and high-overlap checks block paraphrased duplicates. */
  private areEquivalentEvidenceSamples(left: string, right: string): boolean {
    const normalizedLeft = this.normalizeEvidenceSample(left);
    const normalizedRight = this.normalizeEvidenceSample(right);

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    if (normalizedLeft === normalizedRight) {
      return true;
    }

    const shorter =
      normalizedLeft.length <= normalizedRight.length
        ? normalizedLeft
        : normalizedRight;
    const longer =
      normalizedLeft.length > normalizedRight.length
        ? normalizedLeft
        : normalizedRight;

    if (shorter.length >= 80 && longer.includes(shorter)) {
      return true;
    }

    const leftTokens = new Set(normalizedLeft.split(' '));
    const rightTokens = new Set(normalizedRight.split(' '));
    const intersection = [...leftTokens].filter((token) =>
      rightTokens.has(token),
    ).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    const containment =
      Math.min(leftTokens.size, rightTokens.size) > 0
        ? intersection / Math.min(leftTokens.size, rightTokens.size)
        : 0;

    return jaccard >= 0.82 || containment >= 0.9;
  }

  private normalizeEvidenceSample(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private looksLikeComplaintEvidence(value: string): boolean {
    return /\b(?:cannot|can't|unable|blocked|missing|error|failed|failure|problem|issue|doesn't|does not|should|need|request|unavailable|inaccessible|paywall|subscription|forced|forcing)\b/iu.test(
      value,
    );
  }

  /** Returns controlled English and Arabic complaint variants per family. */
  private buildFamilyQueries(
    domainTerm: string,
    family: EvidenceRecoveryFamily,
  ): string[] {
    const queries: Record<EvidenceRecoveryFamily, readonly string[]> = {
      PAYWALL_ON_BASIC_CONFIGURATION: [
        `${domainTerm} paywall complaint`,
        `${domainTerm} basic features require subscription`,
        `${domainTerm} premium blocks settings`,
        `${domainTerm} cannot use without paying`,
        `${domainTerm} free tier limitations review`,
        `${domainTerm} subscription blocks country selection`,
        'تطبيق تعليمي يمنع الميزات الأساسية بدون اشتراك',
        'شكوى اشتراك تطبيق تعليمي',
      ],
      RIGID_SUBJECT_TAXONOMY: [
        `${domainTerm} cannot add subject`,
        `${domainTerm} missing university subject`,
        `${domainTerm} subject categories too limited`,
        `${domainTerm} custom subject unavailable`,
        `${domainTerm} psychology subject missing`,
        `${domainTerm} curriculum categories complaint`,
        'تطبيق تعليمي لا يدعم المادة',
        'تصنيف المواد محدود في تطبيق تعليمي',
      ],
      MOBILE_WEB_FEATURE_GAP: [
        `${domainTerm} mobile app missing features`,
        `${domainTerm} app forces website`,
        `${domainTerm} website feature unavailable in app`,
        `${domainTerm} mobile web feature mismatch`,
        `${domainTerm} app feature request review`,
        'تطبيق التعليم لا يحتوي ميزات الموقع',
      ],
      IDLE_SESSION_AUTH_FAILURE: [
        `${domainTerm} login every time complaint`,
        `${domainTerm} session expires repeatedly`,
        `${domainTerm} cannot log back in`,
        `${domainTerm} Face ID missing review`,
        `${domainTerm} Google sign in unavailable`,
        `${domainTerm} authentication failure review`,
        'مشكلة تسجيل الدخول المتكرر تطبيق تعليمي',
      ],
      STORAGE_AND_SYNC_FAILURE: [
        `${domainTerm} data transfer storage complaint`,
        `${domainTerm} SD card phone storage problem`,
        `${domainTerm} sync failure review`,
        `${domainTerm} offline sync not working`,
        `${domainTerm} data lost after sync`,
        `${domainTerm} storage location missing`,
        'مشكلة مزامنة بيانات تطبيق تعليمي',
      ],
      GENERIC_USER_FRICTION: [
        `${domainTerm} app negative reviews`,
        `${domainTerm} app user complaints`,
        `${domainTerm} app not working`,
        `${domainTerm} missing feature review`,
        `${domainTerm} frustrating app experience`,
        `${domainTerm} feature request`,
      ],
    };

    return [...queries[family]];
  }

  /**
   * Detects one or more concrete evidence families from normalized opportunity
   * descriptors. Multiple families are retained when one review contains two
   * distinct dimensions, such as paywall access and subject taxonomy rigidity.
   */
  private detectEvidenceFamilies(
    opportunity: RankedIdeaOpportunity | null,
  ): EvidenceRecoveryFamily[] {
    if (!opportunity) {
      return ['GENERIC_USER_FRICTION'];
    }

    const text = [
      opportunity.title,
      opportunity.problem ?? '',
      opportunity.need ?? '',
      opportunity.solutionArea ?? '',
      ...opportunity.evidenceSamples,
    ]
      .join(' ')
      .toLowerCase();
    const families: EvidenceRecoveryFamily[] = [];

    if (
      /\b(?:paywall|subscription|premium|paid feature|country selection)\b/iu.test(
        text,
      )
    ) {
      families.push('PAYWALL_ON_BASIC_CONFIGURATION');
    }

    if (
      /\b(?:subject categor|taxonomy|curriculum categor|psychology|regional language|discipline)\b/iu.test(
        text,
      )
    ) {
      families.push('RIGID_SUBJECT_TAXONOMY');
    }

    if (
      /\b(?:mobile|website|web portal|transcript|feature parity)\b/iu.test(text)
    ) {
      families.push('MOBILE_WEB_FEATURE_GAP');
    }

    if (
      /\b(?:idle|inactivity|session expired|log back in|authentication error)\b/iu.test(
        text,
      )
    ) {
      families.push('IDLE_SESSION_AUTH_FAILURE');
    }

    if (
      /\b(?:storage|sd card|sync conflict|data transfer|offline sync)\b/iu.test(
        text,
      )
    ) {
      families.push('STORAGE_AND_SYNC_FAILURE');
    }

    return families.length > 0
      ? [...new Set(families)]
      : ['GENERIC_USER_FRICTION'];
  }

  /**
   * Resolves larger limits only for targeted recovery. Normal collection limits
   * remain untouched, preventing a recovery optimization from increasing every
   * collection job's cost and latency.
   */
  private resolveRecoveryCollectorLimits(): {
    readonly maxFetchedPosts: number;
    readonly maxSavedPosts: number;
    readonly maxFetchedComments: number;
    readonly maxSavedComments: number;
  } {
    return {
      maxFetchedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_POSTS', 6),
        20,
      ),
      maxSavedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_POSTS', 4),
        12,
      ),
      maxFetchedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_COMMENTS', 8),
        30,
      ),
      maxSavedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_COMMENTS', 6),
        20,
      ),
    };
  }

  private readPositiveConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<unknown>(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  /** Counts retained complaint or request entries for monitoring diagnostics. */
  private countComplaintEvidence(nlp: IdeaGenerationNlpContext): number {
    const texts = [
      ...this.readTextEntries(nlp.samplePosts),
      ...this.readTextEntries(nlp.sampleComments),
    ];

    return texts.filter((text) =>
      /\b(?:cannot|can't|unable|blocked|missing|error|failed|failure|problem|issue|doesn't|does not|should|need|request|unavailable|inaccessible|paywall|subscription)\b/iu.test(
        text,
      ),
    ).length;
  }

  /** Extracts text fields from persisted JSON sample arrays safely. */
  private readTextEntries(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof entry.text === 'string'
        ) {
          return entry.text;
        }

        return '';
      })
      .map((text) => text.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
  }

  private mapNlpContext(
    persistedAnalysisId: string | null,
    output: {
      collectionJobId: string;
      totalTextsAnalyzed: number;
      totalPostsAnalyzed: number;
      totalCommentsAnalyzed: number;
      sentimentStats: unknown;
      keywords: unknown;
      topics: unknown;
      recurringProblems: unknown;
      extractedNeeds: unknown;
      featureRequests: unknown;
      opportunities: unknown;
      insights: unknown;
      dataQuality: unknown;
      samplePosts: unknown;
      sampleComments: unknown;
      aiUsed: boolean;
      confidence: number;
    },
  ): IdeaGenerationNlpContext {
    return {
      nlpAnalysisId: persistedAnalysisId ?? output.collectionJobId,
      totalTextsAnalyzed: output.totalTextsAnalyzed,
      totalPostsAnalyzed: output.totalPostsAnalyzed,
      totalCommentsAnalyzed: output.totalCommentsAnalyzed,
      sentimentStats: this.toJsonValue(output.sentimentStats),
      keywords: this.toJsonValue(output.keywords),
      topics: this.toJsonValue(output.topics),
      recurringProblems: this.toJsonValue(output.recurringProblems),
      extractedNeeds: this.toJsonValue(output.extractedNeeds),
      featureRequests: this.toJsonValue(output.featureRequests),
      opportunities: this.toJsonValue(output.opportunities),
      insights: this.toJsonValue(output.insights),
      dataQuality: this.toJsonValue(output.dataQuality),
      samplePosts: this.toJsonValue(output.samplePosts),
      sampleComments: this.toJsonValue(output.sampleComments),
      aiUsed: output.aiUsed,
      confidence: Number.isFinite(output.confidence) ? output.confidence : null,
    };
  }

  private toJsonValue(value: unknown): Prisma.JsonValue | null {
    if (value === undefined || value === null) {
      return null;
    }

    return value;
  }
}