import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
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
  private readonly reviewSourceOrder = [
    'google-play',
    'app-store',
    'reddit',
    'youtube',
    'forum',
    'product-hunt',
  ] as const;

  private readonly technicalSourceOrder = [
    'stackoverflow',
    'github',
    'dev-to',
    'youtube',
    'forum',
    'google-play',
    'app-store',
    'blog',
    'news',
    'hacker-news',
    'product-hunt',
  ] as const;

  /** Recovery focuses on high-yield end-user sources instead of every source. */
  private readonly maximumRecoverySources = 3;

  /** Keeps provider queries bounded and ensures the highest-value terms run first. */
  private readonly maximumRecoveryKeywords = 10;

  constructor(
    private readonly configService: ConfigService,
    private readonly collectionJobResolver: CollectionJobResolverService,
    private readonly communityAiAnalysisService: CommunityAiAnalysisService,
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
    const recoverySources = this.selectRecoverySources(
      context.selectedDataSources,
      evidenceFamilies,
    );
    const recoveryKeywords = this.buildRecoveryKeywords(
      context,
      selectedOpportunity,
      evidenceFamilies,
    );

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
    const rawCommunityAiAnalysis =
      await this.communityAiAnalysisService.analyze(recoveryContext);

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
    const communityAiAnalysis = this.filterCommunityAiAnalysisToNovelEvidence(
      rawCommunityAiAnalysis,
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
      communityAiRecoveryExecuted: true,
      nlp: novelNlp,
      communityAiAnalysis,
    };
  }

  /**
   * Selects review-rich sources for end-user friction and technical sources for
   * developer-facing failures. GitHub and DEV are intentionally deprioritized
   * for paywall, taxonomy, mobile parity, and session complaints.
   */
  private selectRecoverySources(
    selectedSources: readonly SelectedIdeaDataSource[],
    evidenceFamilies: readonly EvidenceRecoveryFamily[],
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

    /*
     * Widen both readonly tuple constants to one shared string-array type.
     * This prevents the ternary expression from producing an incompatible
     * tuple union and keeps Map#get supplied with a known string key.
     */
    const preferredOrder: readonly string[] = isDeveloperTechnicalRecovery
      ? this.technicalSourceOrder
      : this.reviewSourceOrder;

    const ordered = preferredOrder
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

    return selectedSources.slice(0, this.maximumRecoverySources);
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
    const opportunityTerms = this.buildOpportunityTerms(
      domainTerm,
      selectedOpportunity,
    );
    const familyTerms = evidenceFamilies.flatMap((family) =>
      this.buildFamilyQueries(domainTerm, family),
    );
    const genericComplaintTerms = [
      `${domainTerm} app user complaint`,
      `${domainTerm} app review problem`,
      `${domainTerm} negative app reviews`,
      `${domainTerm} feature request user review`,
      `${domainTerm} missing feature complaint`,
      `${domainTerm} inaccessible feature`,
      `${domainTerm} forced to use website`,
      `${domainTerm} login session problem`,
      `${domainTerm} synchronization storage problem`,
      `${domainTerm} workflow frustration`,
    ];
    const boundedBaseTerms = [domain, ...context.keywords]
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 2);

    return [
      ...new Set([
        ...familyTerms,
        ...opportunityTerms,
        ...genericComplaintTerms,
        ...boundedBaseTerms,
      ]),
    ]
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, this.maximumRecoveryKeywords);
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
      maxFetchedPosts: this.readPositiveConfig(
        'RECOVERY_MAX_FETCHED_POSTS',
        24,
      ),
      maxSavedPosts: this.readPositiveConfig('RECOVERY_MAX_SAVED_POSTS', 14),
      maxFetchedComments: this.readPositiveConfig(
        'RECOVERY_MAX_FETCHED_COMMENTS',
        30,
      ),
      maxSavedComments: this.readPositiveConfig(
        'RECOVERY_MAX_SAVED_COMMENTS',
        18,
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