import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionJobStatus, Prisma } from '@prisma/client';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { classifyDirectCommunityEvidence } from '../../../nlp/common/utils/community-evidence.util';
import { filterEvidenceByProblemFamily } from '../../../nlp/common/utils/problem-family-matching.util';
import { CollectorQueryBuilderUtil } from '../../../collectors/base/collector-query-builder.util';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { CollectionJobResolverService } from './collection-job-resolver.service';
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

  /** Keeps recovery bounded to two complementary evidence sources per run. */
  private readonly maximumRecoverySources = 2;

  /** Keeps provider queries bounded and natural-language complaint focused. */
  private readonly maximumRecoveryKeywords = 2;

  constructor(
    private readonly configService: ConfigService,
    private readonly collectionJobResolver: CollectionJobResolverService,
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
    const recoveryCandidateSources = await this.resolveRecoveryCandidateSources(
      context.selectedDataSources,
    );
    const recoverySources = this.selectRecoverySources(
      recoveryCandidateSources,
      evidenceFamilies,
      selectedOpportunity,
      excludedSourceKeys,
      context,
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
      plannedQueries: recoveryKeywords,
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
     * Recovery remains deterministic after collection. A second Community AI
     * call is intentionally avoided so a missing first-pass evidence sample
     * cannot add another provider-latency wave.
     */
    const rawRecoveredEvidenceSamples = this.collectRecoveredEvidenceSamples(
      nlp,
      null,
    );
    const requestAlignedRecoverySamples = rawRecoveredEvidenceSamples.filter(
      (sample) => this.isEvidenceAlignedToRequest(sample, context),
    );
    const requestAlignedNlp = this.filterNlpContextToNovelEvidence(
      nlp,
      requestAlignedRecoverySamples,
    );
    const retainedRecoveryTextCount = requestAlignedRecoverySamples.length;
    const retainedDirectEvidenceCount = requestAlignedRecoverySamples.length;

    const shouldRunCommunityAiRecovery = false;
    const rawCommunityAiAnalysis = null;

    if (retainedRecoveryTextCount === 0) {
      this.logger.debug(
        'Targeted recovery produced no request-aligned external evidence; ending the recovery pass without another AI call.',
      );
    } else {
      this.logger.debug(
        `Targeted recovery retained ${retainedDirectEvidenceCount} request-aligned external evidence sample(s); using deterministic evidence preservation instead of a second Community AI call.`,
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
      requestAlignedNlp,
      rawCommunityAiAnalysis,
    ).filter((sample) => this.isEvidenceAlignedToRequest(sample, context));
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
      requestAlignedNlp,
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
   * Excludes sources that actually failed, timed out, or were rate-limited in
   * the primary job. Healthy zero-yield sources remain eligible because the
   * recovery pass uses a different, problem-focused query.
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
            const failed = entry.status === CollectionJobStatus.FAILED;
            const rateLimited = /(?:429|rate\s*limit|too many requests)/iu.test(
              entry.failureReason ?? '',
            );
            const timedOut = /(?:timeout|timed out|exceeded \d+ms)/iu.test(
              entry.failureReason ?? '',
            );
            // A healthy zero-yield source is deliberately NOT excluded. Recovery
            // uses different, problem-focused planned queries, so the best source
            // should be allowed one bounded retry with a materially different query.
            return failed || rateLimited || timedOut;
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

  private async resolveRecoveryCandidateSources(
    selectedSources: readonly SelectedIdeaDataSource[],
  ): Promise<SelectedIdeaDataSource[]> {
    try {
      const reserveSources = await this.prisma.dataSource.findMany({
        where: { isActive: true, isImplemented: true },
        select: {
          id: true,
          key: true,
          displayName: true,
          supportsPosts: true,
          supportsComments: true,
          supportsRegion: true,
          supportsLanguage: true,
        },
      });
      const byKey = new Map<string, SelectedIdeaDataSource>();
      for (const source of [...selectedSources, ...reserveSources]) {
        if (!byKey.has(source.key)) {
          byKey.set(source.key, source);
        }
      }
      return [...byKey.values()];
    } catch (error: unknown) {
      this.logger.debug(
        `Unable to load reserve recovery sources; using selected sources only. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [...selectedSources];
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
    context: IdeaGenerationContext,
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
    const requestIntentText = `${context.requestDescription ?? ''} ${
      context.collectionPlan?.searchQueries.join(' ') ?? ''
    }`.toLocaleLowerCase();
    const institutionalIntent =
      /\b(?:government|municipal|city planner|city planners|city planning|urban planning|municipal planning|neighborhood management|neighbourhood management|public housing|housing authority|public infrastructure|property management.{0,80}city|city.{0,80}property management)\b/iu.test(
        requestIntentText,
      );
    const smallBusinessIntent =
      /\b(?:flower shop|flower shops|florist|florists|bouquet|tattoo studio|dance studio|pottery studio|photography studio|repair shop|custom order|custom orders|small business|local supplier|local suppliers)\b/iu.test(
        requestIntentText,
      );

    const familyPreferredOrder: readonly string[] =
      institutionalIntent
        ? ['news', 'youtube', 'github', 'blog', 'forum', 'hacker-news', 'stackoverflow', 'product-hunt']
        : smallBusinessIntent
          ? ['youtube', 'news', 'google-play', 'app-store', 'forum', 'blog', 'product-hunt']
          : isDeveloperTechnicalRecovery
            ? this.technicalSourceOrder
            : isGenericZeroEvidenceRecovery
              ? [
                  'reddit',
                  'forum',
                  'youtube',
                  'app-store',
                  'google-play',
                  'news',
                  'blog',
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

    const selected: SelectedIdeaDataSource[] = [];
    const firstPreferred = ordered[0];
    if (firstPreferred) selected.push(firstPreferred);

    // Prefer a complementary evidence shape for the second slot: pair a
    // report/article source with a comment-bearing source whenever possible.
    const complementary = firstPreferred?.supportsComments
      ? ordered.find(
          (source) =>
            !source.supportsComments && !selected.includes(source),
        )
      : ordered.find(
          (source) => source.supportsComments && !selected.includes(source),
        );
    if (complementary) selected.push(complementary);

    for (const source of ordered) {
      if (selected.length >= this.maximumRecoverySources) break;
      if (!selected.includes(source)) selected.push(source);
    }

    if (selected.length > 0) {
      return selected.slice(0, this.maximumRecoverySources);
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
    const targetedCollectorQueries = CollectorQueryBuilderUtil.buildDomainPainQueries({
      domainName: domainTerm,
      domainKeywords:
        context.selectedDomains.find((item) => item.id === context.domainId)
          ?.effectiveSearchKeywords ??
        context.selectedDomains.find((item) => item.id === context.domainId)
          ?.keywords ??
        [],
      userKeywords: context.keywords,
      maxQueries: this.maximumRecoveryKeywords,
    });
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
        ...targetedCollectorQueries,
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
      /\b(?:access|alerts?|alteration\w*|anomal\w*|approval\w*|breach\w*|burnout|conflict\w*|cost\w*|delay\w*|delivery\w*|dispute\w*|expense\w*|fabric\w*|fail\w*|fitting\w*|fraud\w*|friction|hiring|incident\w*|inefficien\w*|inventory\w*|license\w*|measurement\w*|missing|order\w*|outage\w*|permit\w*|record\w*|recruit\w*|risk\w*|security|suspicious|threat\w*|turnover|verification\w*|waste\w*|workload|errors?|unable|cannot|sync\w*|device\w*|firmware|unauthorized|outdated|technician\w*|parts?|pickup|notes?|repair\w*|status)\b/iu;
    const genericPhrase =
      /\b(?:coherent cross-domain workflow|management decision support|platform|system|software|application|workflow)\b/iu;

    const descriptionPhrases = context.requestDescription
      .split(/[.!?;,]/u)
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length >= 8)
      .flatMap((value) => {
        const words = value.split(/\s+/u);
        if (words.length <= 7) return [value];
        const phrases: string[] = [];
        for (let index = 0; index < words.length; index += 4) {
          const phrase = words.slice(index, index + 7).join(' ');
          if (phrase.split(/\s+/u).length >= 3) phrases.push(phrase);
        }
        return phrases;
      });

    const normalizedDescription = context.requestDescription
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    const contextualQueries: string[] = [];

    const paymentFraudWorkflow =
      /\b(?:marketplace|marketplaces|e[- ]?commerce|checkout|purchase|purchases|transaction|transactions|payment|payments)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:fraud|fraudulent|chargeback|chargebacks|account takeover|account takeovers|payment dispute|payment disputes|suspicious|risk signals?|false decline|blocked legitimate|legitimate customers?)\b/iu.test(
        normalizedDescription,
      );
    if (paymentFraudWorkflow) {
      contextualQueries.push(
        'payment fraud legitimate customer falsely blocked',
        'chargeback account takeover marketplace checkout risk',
        'suspicious transaction fraud signals reviewed separately',
      );
    }

    const photographyStudioWorkflow =
      /\b(?:photography studio|photography studios|photo studio|photo studios|professional photographer|commercial photographer|portrait studio|photography|photo shoot|photoshoot)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:client bookings?|shot lists?|editing requests?|equipment preparation|camera gear|image selections?|photo selections?|delivery deadlines?|location details?|shoot schedule|session schedule)\b/iu.test(
        normalizedDescription,
      );
    if (photographyStudioWorkflow) {
      contextualQueries.push(
        'photography studio booking shot list client request',
        'photographer equipment checklist forgotten gear',
        'editing requests image selection delivery deadline',
      );
    }

    const crossBorderAgreementWorkflow =
      /\b(?:cross[- ]border|international payments?|business agreements?|contract terms?|contractual conditions?|settlements?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:payments?|settlements?|contracts?|agreements?|approvals?|verification documents?|reconciliation|disputes?|transaction records?)\b/iu.test(
        normalizedDescription,
      );
    if (crossBorderAgreementWorkflow) {
      contextualQueries.push(
        'cross border payment settlement contract dispute',
        'contract conditions approval payment reconciliation',
        'agreement verification documents transaction mismatch',
      );
    }

    const laundryOperationsWorkflow =
      /\b(?:laundry shop|laundry shops|laundromat|laundromats|dry cleaning|dry-cleaning|dry cleaner|dry cleaners|garment cleaning|wash and fold)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:garments?|stains?|cleaning instructions?|pickup|deadlines?|additional treatment|paper tags?|lost garments?|incorrect cleaning|delayed orders?|customer disputes?)\b/iu.test(
        normalizedDescription,
      );
    if (laundryOperationsWorkflow) {
      contextualQueries.push(
        'laundry lost garment tracking problem',
        'dry cleaning special instructions stain treatment missed',
        'laundry pickup deadline delayed order customer dispute',
      );
    }

    const legalDocumentWorkflow =
      /\b(?:regulations?|contracts?|applications?|case[- ]related documents?|legal documents?|rules?|requirements?|compliance)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:search|compare|check|missing|inconsisten|delay|stored across|multiple systems|follow the correct rules)\w*\b/iu.test(
        normalizedDescription,
      );
    if (legalDocumentWorkflow) {
      contextualQueries.push(
        'legal document compliance missing requirements review',
        'regulation contract application requirements hard to compare',
        'case documents inconsistencies discovered late',
      );
    }

    const wardrobeWorkflow =
      /\b(?:wardrobe|closet|clothes|clothing|shoes|accessories|outfits?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:remember|inventory|fit|cleaning|repair|photos?|receipts?|duplicate purchases?|unused items?|weather|occasion)\b/iu.test(
        normalizedDescription,
      );
    if (wardrobeWorkflow) {
      contextualQueries.push(
        'wardrobe inventory forget clothes duplicate purchases',
        'closet cleaning repair status hard to track',
        'outfit planning weather occasion wardrobe problem',
      );
    }

    const municipalDeviceSecurityWorkflow =
      /\b(?:smart cit(?:y|ies)|municipal|city technology|traffic lights?|parking sensors?|public cameras?|environmental monitors?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:security|unauthorized|outdated|compromised|device behavior|firmware|connected devices?|iot|security standards?)\b/iu.test(
        normalizedDescription,
      );
    if (municipalDeviceSecurityWorkflow) {
      contextualQueries.push(
        'municipal iot unauthorized devices security visibility',
        'smart city sensors outdated firmware security problem',
        'city connected devices unusual behavior incident',
      );
    }

    const musicalInstrumentRepairWorkflow =
      /\b(?:musical instruments?|instrument repair|repair shop|luthier|guitar|violin|piano)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:repair|technician|replacement parts?|paper tags?|pickup|repair progress|repair status|notes?)\b/iu.test(
        normalizedDescription,
      );
    if (musicalInstrumentRepairWorkflow) {
      contextualQueries.push(
        'instrument repair shop lost repair ticket status',
        'guitar repair shop parts technician notes pickup delay',
        'musical instrument repair paper tags tracking problem',
      );
    }

    const candidates: string[] = [...contextualQueries, ...descriptionPhrases, ...context.keywords]
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

    const tailoringQueries = [
      'tailor shop lost customer measurements',
      'custom clothing order details missing',
      'alteration request history hard to find',
      'fitting appointment scheduling problem',
      'fabric selection order tracking',
      'returning customer measurements missing',
    ];
    const salonQueries = [
      'salon double booking appointment problem',
      'stylist availability scheduling conflict',
      'salon client preferences lost between employees',
      'salon product inventory waste',
      'salon loyalty history missing',
      'salon special requests not shared',
    ];
    const paymentFraudQueries = [
      'payment fraud detection false positive',
      'suspicious transaction legitimate customer blocked',
      'transaction fraud alert triage',
      'account behavior transaction risk scoring',
      'fraud detection false decline payment',
      'payment security alerts analyzed separately',
    ];
    const petCareQueries = [
      'family missed pet vaccination appointment',
      'pet grooming appointment forgotten',
      'pet feeding routine inconsistent family',
      'pet care history hard to share veterinarian',
      'pet sitter missing care instructions',
      'shared pet care records scattered messages',
    ];
    const eventPlanningQueries = [
      'wedding vendor booking conflict',
      'event venue photographer schedule conflict',
      'wedding guest list catering changes lost',
      'event budget unexpected vendor expenses',
      'last minute wedding vendor changes confusion',
      'event planning information scattered messages spreadsheets',
    ];
    const remotePatientMonitoringQueries = [
      'remote patient monitoring after discharge missed deterioration',
      'home care vital signs multiple devices monitoring',
      'post discharge patient alerts delayed intervention',
      'remote patient monitoring readmission risk',
      'clinical staff alert overload remote monitoring',
      'home health patient telemetry review problem',
    ];
    const sportsPerformanceQueries = [
      'athlete overtraining detection wearable data',
      'training load monitoring recovery injury risk',
      'coach combine wearable fitness equipment data',
      'athlete recovery metrics multiple devices',
      'sports performance dashboard training intensity alerts',
      'wearable workout data integration coaching problem',
    ];
    const funeralMemorialQueries = [
      'funeral service scheduling coordination problem',
      'memorial planning family requests missed',
      'funeral home guest communication coordination',
      'burial preferences documents service providers scattered',
      'funeral floral transportation scheduling conflict',
      'memorial arrangements duplicated family coordination',
    ];
    const governmentRecordQueries = [
      'permit approval status hard to trace',
      'license processing delay departments',
      'official record versions conflict departments',
      'cross department document verification problem',
      'ownership record verification dispute',
    ];

    const intentText = domainKeywords.join(' ').toLowerCase();
    const hasPaymentFraudIntent =
      /\b(?:fraud|fraudulent|suspicious transaction|transaction risk|false positive|false-positive|legitimate (?:customer|user|transaction)|payment fraud|account behavior|fraud alert)\b/iu.test(
        intentText,
      );

    const knownQueries =
      hasPaymentFraudIntent &&
      /(?:finance|cybersecurity|artificial intelligence)/u.test(normalizedDomain)
        ? paymentFraudQueries
        : normalizedDomain.includes('beauty') || normalizedDomain.includes('salon')
          ? salonQueries
        : normalizedDomain.includes('smart cit')
        ? smartCityQueries
        : normalizedDomain.includes('transport')
          ? transportationQueries
          : normalizedDomain.includes('logistic')
            ? logisticsQueries
            : normalizedDomain.includes('tailor') ||
                normalizedDomain.includes('custom apparel')
              ? tailoringQueries
              : normalizedDomain.includes('pet care') ||
                  normalizedDomain.includes('animal care')
                ? petCareQueries
                : normalizedDomain.includes('event planning') ||
                    normalizedDomain.includes('wedding')
                  ? eventPlanningQueries
                  : normalizedDomain.includes('funeral') ||
                      normalizedDomain.includes('memorial')
                    ? funeralMemorialQueries
                    : normalizedDomain.includes('sports') ||
                        normalizedDomain.includes('fitness')
                      ? sportsPerformanceQueries
                      : normalizedDomain.includes('healthcare') ||
                          normalizedDomain.includes('home care')
                        ? remotePatientMonitoringQueries
                        : normalizedDomain.includes('government') ||
                        normalizedDomain.includes('legaltech') ||
                        normalizedDomain.includes('blockchain')
                      ? governmentRecordQueries
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
    ]).filter((sample) => this.looksLikeUsableProblemEvidence(sample));
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
   * is intentionally skipped while the recovery corpus contains new
   * problem-matched external evidence. This is not synthetic market research: every claim is
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

    const rawSource =
      selectedOpportunity.raw &&
      typeof selectedOpportunity.raw === 'object' &&
      !Array.isArray(selectedOpportunity.raw) &&
      typeof (selectedOpportunity.raw as Prisma.JsonObject).source === 'string'
        ? String((selectedOpportunity.raw as Prisma.JsonObject).source)
        : null;
    const validationHypothesis =
      rawSource === 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS';
    if (validationHypothesis && !context.requestDescription?.trim()) {
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

    const familyMatchedNovelEvidence = validationHypothesis
      ? [...novelEvidenceSamples]
      : filterEvidenceByProblemFamily(
          problemDescriptor,
          novelEvidenceSamples,
        );
    const evidenceSamples = this.deduplicateEvidenceSamples(
      familyMatchedNovelEvidence.filter((sample) =>
        this.isEvidenceAlignedToRequest(sample, context),
      ),
    ).slice(0, 8);
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
    const title = validationHypothesis
      ? `${context.collectionPlan?.suggestedDomainName?.trim() || domainName} Evidence-Backed Pilot Opportunity`
      : `${selectedOpportunity.title} — recovered evidence`;
    const problem = validationHypothesis
      ? context.requestDescription!.replace(/\s+/gu, ' ').trim()
      : selectedOpportunity.problem ||
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
        `Targeted recovery retained ${evidenceSamples.length} new problem-matched external evidence sample(s). ` +
        'A deterministic evidence-preserving opportunity was created because online Community AI did not return an acceptable grounded response.',
      dominantProblems: [problem],
      unmetNeeds: [unmetNeed],
      opportunities: [opportunity],
      overallConfidence: confidence,
      qualityWarnings: [
        'A second Community AI recovery call was intentionally skipped; this opportunity was constructed deterministically from newly retained evidence.',
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
        'Targeted evidence recovery constructed this opportunity deterministically to preserve latency and provenance.',
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

  private looksLikeUsableProblemEvidence(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const commentMatch = normalized.match(/\bCommunity comment:\s*(.+)$/iu);
    const evidenceText = commentMatch?.[1]?.trim() ?? normalized;
    const kind = classifyDirectCommunityEvidence(
      evidenceText,
      commentMatch ? 'COMMENT' : 'POST',
    );
    if (kind === 'USER_COMPLAINT' || kind === 'FEATURE_REQUEST') {
      return true;
    }

    return /\b(?:challenge|problem|issue|failure|failed|delay|delayed|lost|misplaced|forgotten|incorrect|wrong|outdated|unauthorized|unmanaged|compromised|vulnerab|security gap|visibility gap|limited visibility|difficult to identify|hard to identify|cannot identify|unable to identify|fragmented|separate systems?|paper tags?|manual tracking|waiting longer|maintenance complaint|service disruption)\w*\b/iu.test(
      evidenceText,
    );
  }

  private isEvidenceAlignedToRequest(
    sample: string,
    context: IdeaGenerationContext,
  ): boolean {
    const description = context.requestDescription?.trim();
    if (!description) return true;

    return RequestEvidenceAlignmentUtil.isAligned({
      requestDescription: description,
      evidenceText: sample,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
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
   * Resolves small bounded limits only for targeted recovery. Normal collection
   * limits remain untouched, keeping the supplemental pass inside its latency
   * budget.
   */
  private resolveRecoveryCollectorLimits(): {
    readonly maxFetchedPosts: number;
    readonly maxSavedPosts: number;
    readonly maxFetchedComments: number;
    readonly maxSavedComments: number;
  } {
    return {
      maxFetchedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_POSTS', 4),
        20,
      ),
      maxSavedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_POSTS', 3),
        12,
      ),
      maxFetchedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_COMMENTS', 6),
        30,
      ),
      maxSavedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_COMMENTS', 4),
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