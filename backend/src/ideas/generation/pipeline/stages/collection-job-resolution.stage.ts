import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import {
  CollectionJobResolverService,
  type ResolveCollectionJobResult,
} from '../../services/collection-job-resolver.service';
import type {
  IdeaGenerationContext,
  SelectedGenerationDomain,
} from '../../types/idea-generation-context.type';
import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';
import { classifyDirectCommunityEvidence } from '../../../../nlp/common/utils/community-evidence.util';

/**
 * Resolves one bounded collection job for the complete generation request.
 *
 * All selected collectors run in parallel exactly once. Keywords from every
 * selected domain are merged into the same job, preventing the previous
 * multiplicative behavior where GitHub, DEV.to, Product Hunt, Hacker News, and
 * NLP persistence were repeated once per domain.
 *
 * @author Malak
 * @author Eman
 */
@Injectable()
export class CollectionJobResolutionStage implements IdeaGenerationStage {
  private readonly logger = new Logger(CollectionJobResolutionStage.name);

  readonly key = IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION;
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly collectionJobResolver: CollectionJobResolverService,
  ) {}

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const domains = this.resolveDomains(context);
    const primaryDomain =
      domains.find((domain) => domain.id === context.domainId) ?? domains[0];

    if (!primaryDomain) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_NOT_FOUND,
        message: 'At least one resolved generation domain is required.',
      });
    }

    /*
     * Execute one collection job for the complete request. Previously the same
     * collectors were executed once per selected domain, which duplicated
     * GitHub, DEV.to, Product Hunt, and Hacker News requests and repeated NLP
     * persistence. One merged job keeps every collector while removing the
     * multiplicative domain fan-out.
     */
    const result = await this.resolveUnifiedCollection(
      context,
      primaryDomain,
      domains,
    );

    const nlp = result.nlpOutput;

    /*
     * FAST_GENERATION keeps a richer in-memory collector corpus than the
     * intentionally bounded NLP pass. Preserve direct problem evidence from
     * that first collection here so ranking never needs to recollect a bug or
     * complaint that was already found initially.
     */
    const fastEvidenceByDomain = new Map(
      domains.map((domain) => [
        domain.id,
        this.buildFastEvidenceForDomain(
          result.fastEvidenceInputs ?? [],
          domain,
          domains,
        ),
      ]),
    );

    const canonicalDirectNlpEvidence = this.buildCanonicalDirectNlpEvidence(
      nlp,
      result.fastEvidenceInputs ?? [],
    );

    const domainEvidence = domains.map((domain) => {
      /*
       * samplePosts/sampleComments may be empty while analyzedTexts already
       * contains the authoritative in-memory NLP evidence. Build the domain
       * evidence map from analyzedTexts first, then fall back to representative
       * samples. This fixes the previous contradiction where NLP reported
       * analyzed texts but every domainEvidence entry reported zero.
       */
      const analyzedDomainEvidence = this.buildAnalyzedEvidenceForDomain(
        nlp.analyzedTexts,
        domain,
        domains,
      );

      const fastDomainEvidence = fastEvidenceByDomain.get(domain.id) ?? {
        posts: [],
        comments: [],
      };
      const samplePosts = this.mergeRepresentativeEvidence(
        fastDomainEvidence.posts,
        analyzedDomainEvidence.posts.length > 0
          ? analyzedDomainEvidence.posts
          : this.filterEvidenceForDomain(nlp.samplePosts, domain, domains),
        10,
      );
      const canonicalNlpComments = canonicalDirectNlpEvidence.filter((item) =>
        this.evidenceBelongsToDomain(item.text, domain, domains),
      );
      const sampleComments = this.mergeRepresentativeEvidence(
        [
          ...canonicalNlpComments,
          ...fastDomainEvidence.comments,
        ],
        (analyzedDomainEvidence.comments.length > 0
          ? analyzedDomainEvidence.comments
          : this.filterEvidenceForDomain(nlp.sampleComments, domain, domains)
        ).filter((value) =>
          this.isRepresentativeProblemEvidence(this.extractEvidenceText(value)),
        ),
        14,
      );

      const totalPostsAnalyzed = samplePosts.length;
      const totalCommentsAnalyzed = sampleComments.length;
      const totalTextsAnalyzed = totalPostsAnalyzed + totalCommentsAnalyzed;

      return {
        domainId: domain.id,
        domainName: domain.name,
        collectionJobId: result.job.id,
        reused: result.reused,
        totalTextsAnalyzed,
        totalPostsAnalyzed,
        totalCommentsAnalyzed,
        evidenceAvailable: totalTextsAnalyzed > 0,
        samplePosts: this.toJsonValue(samplePosts),
        sampleComments: this.toJsonValue(sampleComments),
      };
    });

    const firstPassPosts = this.mergeRepresentativeEvidence(
      domains.flatMap((domain) =>
        fastEvidenceByDomain.get(domain.id)?.posts ?? [],
      ),
      Array.isArray(nlp.samplePosts) ? nlp.samplePosts : [],
      16,
    );
    const firstPassComments = this.mergeRepresentativeEvidence(
      domains.flatMap((domain) =>
        fastEvidenceByDomain.get(domain.id)?.comments ?? [],
      ),
      Array.isArray(nlp.sampleComments) ? nlp.sampleComments : [],
      20,
    );

    const updatedContext: IdeaGenerationContext = {
      ...context,
      domainId: result.job.domain.id,
      domainName: result.job.domain.name,
      collection: {
        collectionJobId: result.job.id,
        reused: result.reused,
        totalPosts: nlp.totalPostsAnalyzed,
        totalComments: nlp.totalCommentsAnalyzed,
      },
      nlp: {
        nlpAnalysisId:
          result.job.nlpAnalysis?.id ?? nlp.collectionJobId,
        totalTextsAnalyzed: nlp.totalTextsAnalyzed,
        totalPostsAnalyzed: nlp.totalPostsAnalyzed,
        totalCommentsAnalyzed: nlp.totalCommentsAnalyzed,
        sentimentStats: this.toJsonValue(nlp.sentimentStats) as Prisma.JsonObject,
        keywords: this.toJsonValue(nlp.keywords) as Prisma.JsonArray,
        topics: this.toJsonValue(nlp.topics) as Prisma.JsonArray,
        recurringProblems: this.toJsonValue(nlp.recurringProblems) as Prisma.JsonArray,
        extractedNeeds: this.toJsonValue(nlp.extractedNeeds) as Prisma.JsonArray,
        featureRequests: this.toJsonValue(nlp.featureRequests) as Prisma.JsonArray,
        opportunities: this.toJsonValue(nlp.opportunities) as Prisma.JsonArray,
        insights: this.toJsonValue(nlp.insights) as Prisma.JsonArray,
        dataQuality: this.toJsonValue(nlp.dataQuality) as Prisma.JsonObject,
        samplePosts: this.toJsonValue(firstPassPosts) as Prisma.JsonArray,
        sampleComments: this.toJsonValue(firstPassComments) as Prisma.JsonArray,
        aiUsed: nlp.aiUsed,
        confidence: nlp.confidence,
      },
      domainEvidence,
    };

    return {
      context: updatedContext,
      resultPreview:
        `Executed all selected collectors once in parallel and analyzed ${nlp.totalTextsAnalyzed} text(s) for ${domains.length} selected domain(s).`,
      metadata: {
        stageRole: 'UNIFIED_PARALLEL_COLLECTION',
        collectionMode: 'FAST_GENERATION',
        domainCount: domains.length,
        collectionJobIds: [result.job.id],
        primaryCollectionJobId: result.job.id,
        reusedCollectionJobs: result.reused ? 1 : 0,
        totalTextsAnalyzed: nlp.totalTextsAnalyzed,
        totalPostsAnalyzed: nlp.totalPostsAnalyzed,
        totalCommentsAnalyzed: nlp.totalCommentsAnalyzed,
        firstPassDirectEvidenceCount:
          firstPassPosts.length + firstPassComments.length,
        nlpAnalysisId:
          result.job.nlpAnalysis?.id ?? nlp.collectionJobId,
        nlpAiUsed: nlp.aiUsed,
        nlpConfidence: nlp.confidence,
      },
    };
  }

  private async resolveUnifiedCollection(
    context: IdeaGenerationContext,
    primaryDomain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): Promise<ResolveCollectionJobResult> {
    const sourceKeys = this.selectAllActiveSourceKeys(
      context.selectedDataSources.map((source) => source.key),
    );

    return this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,
      domainId: primaryDomain.id,
      country: context.location.country,
      city: context.location.city ?? undefined,
      region: context.location.region ?? undefined,
      language: context.location.language,
      radiusKm: context.location.radiusKm ?? undefined,
      dataSourceKeys: sourceKeys,
      keywords: this.buildUnifiedKeywords(context, domains),
      forceRefresh: context.forceRefresh,
      collectionMode: 'FAST_GENERATION',
      resolvedDomain: {
        id: primaryDomain.id,
        name: primaryDomain.name,
        /*
         * Keep the persisted primary domain identity, but expose a balanced
         * vocabulary from every selected domain to collectors. This fixes the
         * old behavior where collectors received only the first domain even
         * though the request selected two or three domains.
         */
        keywords: this.buildBalancedDomainVocabulary(domains),
      },
      resolvedDataSources: context.selectedDataSources.map((source) => ({
        id: source.id,
        key: source.key,
        displayName: source.displayName,
      })),
      /*
       * Collect a stronger first-pass corpus so most runs satisfy evidence
       * requirements without a second targeted-recovery collection. All
       * collectors still execute in parallel, therefore the additional depth
       * improves recall without creating one sequential request chain.
       */
      collectorLimits: {
        maxFetchedPosts: 14,
        maxSavedPosts: 10,
        maxFetchedComments: 24,
        maxSavedComments: 16,
      },
    });
  }

  private resolveDomains(
    context: IdeaGenerationContext,
  ): SelectedGenerationDomain[] {
    return context.selectedDomains.length > 0
      ? context.selectedDomains
      : [
          {
            id: context.domainId,
            name: context.domainName!,
            keywords: context.keywords,
          },
        ];
  }

  private selectAllActiveSourceKeys(keys: readonly string[]): string[] {
    /*
     * DataSourceSelectionStage has already filtered this list to active,
     * allowed sources. Keep every active source and only normalize/deduplicate
     * the keys. Collectors still execute in parallel, while per-source limits
     * above prevent the aggregate corpus from becoming unnecessarily large.
     */
    return [...new Set(
      keys
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean),
    )];
  }

  private buildUnifiedKeywords(
    context: IdeaGenerationContext,
    domains: readonly SelectedGenerationDomain[],
  ): string[] {
    const balanced: string[] = [];
    const addUnique = (value: string | null | undefined) => {
      const trimmed = value?.trim();

      if (!trimmed) {
        return;
      }

      const normalized = this.normalizeTerm(trimmed);

      if (
        !balanced.some(
          (candidate) => this.normalizeTerm(candidate) === normalized,
        )
      ) {
        balanced.push(trimmed);
      }
    };

    // The literal requester problem always receives the first search slot.
    addUnique(this.buildEvidenceSearchIntent(context.requestDescription));

    /*
     * Reserve the next slots for one explicit anchor from every selected
     * domain before adding generic/request expansion. This guarantees that a
     * 3-domain request cannot spend the entire FAST_GENERATION budget on the
     * first domain.
     */
    for (const domain of domains) {
      addUnique(domain.name);
    }

    // Keep direct requester terms near the front without sacrificing one slot
    // per selected domain. In text-only requests these terms are the strongest
    // available intent signal.
    for (const keyword of context.keywords.slice(0, 4)) {
      addUnique(keyword);
    }

    const buckets = domains.map((domain) => {
      const focused = this.buildProblemFocusedQueries(domain).slice(0, 3);
      const specific = this.selectSpecificDomainTerms(domain, 4);
      return [domain.name, ...specific, ...focused];
    });

    for (let index = 1; balanced.length < 14; index += 1) {
      let added = false;

      for (const bucket of buckets) {
        const value = bucket[index];
        if (!value) continue;
        const before = balanced.length;
        addUnique(value);
        added = added || balanced.length > before;
        if (balanced.length >= 14) break;
      }

      if (!added) break;
    }

    // Fill the remaining budget with the orchestrator's request-first terms.
    for (const keyword of context.keywords) {
      if (balanced.length >= 20) break;
      addUnique(keyword);
    }

    return balanced.slice(0, 20);
  }

  /**
   * Creates a round-robin domain vocabulary for collectors that still consume
   * resolvedDomain.keywords. Domain names are emitted first, followed by each
   * domain's configured terms in layers, so secondary domains are never hidden
   * behind a primary-domain flatMap().slice().
   */
  private buildBalancedDomainVocabulary(
    domains: readonly SelectedGenerationDomain[],
  ): string[] {
    const output: string[] = [];
    const seen = new Set<string>();
    const buckets = domains.map((domain) => [domain.name, ...domain.keywords]);

    for (let index = 0; output.length < 24; index += 1) {
      let added = false;
      for (const bucket of buckets) {
        const value = bucket[index]?.trim();
        if (!value) continue;
        const normalized = this.normalizeTerm(value);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(value);
        added = true;
        if (output.length >= 24) break;
      }
      if (!added) break;
    }

    return output;
  }

  private buildEvidenceSearchIntent(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/\b(?:ai|artificial intelligence)[ -]?(?:enhance|enhanced|enhancement|powered)\b/giu, ' ')
      .replace(/\b(?:enhance|enhanced|improve|improved|optimize|optimized)\b[^.!?,;]{0,24}\b(?:with|using|by)\s+(?:ai|artificial intelligence)\b/giu, ' ')
      .replace(/\b(?:using|use|with)\s+(?:ai|artificial intelligence)\b/giu, ' ')
      .replace(/\b(?:and|or|with|using|by)\s*$/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }



  /** Builds high-intent queries that describe a user problem, not a topic. */
  private buildProblemFocusedQueries(
    domain: SelectedGenerationDomain,
  ): string[] {
    const specificTerms = this.selectSpecificDomainTerms(domain, 5);
    const baseTerms = specificTerms.length > 0
      ? specificTerms
      : [domain.name];

    const intentSuffixes = [
      'user complaint problem',
      'not working difficult confusing',
      'review missing feature',
    ];

    return baseTerms
      .slice(0, 4)
      .flatMap((term, index) => [
        `${term} ${intentSuffixes[index % intentSuffixes.length]}`,
      ]);
  }

  /**
   * Prioritizes domain-specific problem spaces over generated generic phrases
   * such as "media platform", "media software", and "media dashboard".
   */
  private selectSpecificDomainTerms(
    domain: SelectedGenerationDomain,
    limit: number,
  ): string[] {
    const domainTokens = new Set(
      this.normalizeTerm(domain.name)
        .split(/[^\p{L}\p{N}]+/gu)
        .filter((token) => token.length >= 3),
    );
    const genericTail =
      /\b(?:platform|system|application|app|software|dashboard|analytics|monitoring|automation|management|optimization|prediction|recommendation|integration|smart)\b/iu;

    return domain.keywords
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => {
        const normalized = this.normalizeTerm(value);
        const tokens = normalized
          .split(/[^\p{L}\p{N}]+/gu)
          .filter(Boolean);
        const nonDomainTokens = tokens.filter(
          (token) => !domainTokens.has(token),
        );

        return (
          tokens.length >= 2 &&
          nonDomainTokens.length >= 1 &&
          !genericTail.test(normalized)
        );
      })
      .sort((left, right) => {
        const score = (value: string): number => {
          const normalized = this.normalizeTerm(value);
          const tokens = normalized.split(/\s+/u).filter(Boolean);
          const phraseBonus = Math.min(tokens.length, 4) * 5;
          const specificSignal =
            /\b(?:content creation|video streaming|music streaming|podcasting|digital publishing|social media|content moderation|audience analytics|creator economy|gaming|live streaming|interactive media|public service|municipal|urban mobility|traffic|waste|energy|citizen service|administrative operations|office administration|approval workflow|document workflow|back office operations|business operations|invoice|expense|reconciliation|payroll|procurement)\b/iu.test(
              normalized,
            )
              ? 25
              : 0;
          return phraseBonus + specificSignal - normalized.length / 100;
        };

        return score(right) - score(left);
      })
      .slice(0, limit);
  }

  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_REQUEST,
        message:
          'Generation entitlement must be resolved before collection-job resolution.',
      });
    }
    if (!context.domainName) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_NOT_FOUND,
        message:
          'Generation domain must be resolved before collection-job resolution.',
      });
    }
    if (context.selectedDataSources.length === 0) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NO_DATA_SOURCES_AVAILABLE,
        message:
          'At least one active data source must be selected before resolving a collection job.',
      });
    }
  }

  private normalizeTerm(value: string): string {
    return value.toLowerCase().replace(/\s+/gu, ' ').trim();
  }


  /**
   * Converts the richer FAST_GENERATION collector corpus into direct,
   * domain-matched representative evidence. The collector corpus is already
   * centrally relevance-filtered; this method adds the stricter selected-domain
   * and direct-problem gates required by idea generation.
   */
  private buildFastEvidenceForDomain(
    inputs: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly title?: string | null;
      readonly content: string;
      readonly isComplaintEvidence?: boolean;
    }[],
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): {
    readonly posts: unknown[];
    readonly comments: unknown[];
  } {
    const candidates = inputs
      .map((input) => {
        const title = input.title?.replace(/\s+/gu, ' ').trim() ?? '';
        const content = input.content.replace(/\s+/gu, ' ').trim();
        const text =
          input.sourceType === 'COMMENT' && title
            ? `${title}. Community comment: ${content}`
            : [title, content].filter(Boolean).join(' ');

        return { input, text };
      })
      .filter(({ input, text }) => {
        if (!text) return false;
        if (!this.evidenceBelongsToDomain(text, domain, domains)) {
          return false;
        }

        return (
          input.isComplaintEvidence === true ||
          this.isRepresentativeProblemEvidence(text)
        );
      });

    const posts = candidates
      .filter(({ input }) => input.sourceType === 'POST')
      .slice(0, 10)
      .map(({ input, text }) => ({
        id: input.id,
        text,
        sentiment: 'NEUTRAL',
      }));
    const comments = candidates
      .filter(({ input }) => input.sourceType === 'COMMENT')
      .slice(0, 14)
      .map(({ input, text }) => ({
        id: input.id,
        postId: input.postId ?? input.id,
        text,
        sentiment: 'NEUTRAL',
      }));

    return { posts, comments };
  }

  /**
   * Promotes direct evidence samples already retained by deterministic NLP into
   * the primary-domain evidence registry. Community AI and deterministic NLP
   * can retain a complaint even when the bounded representative sampler omits
   * it; ranking must still receive the exact quote so provenance verification
   * can resolve it against the persisted collection rows.
   */
  private buildCanonicalDirectNlpEvidence(
    nlp: ResolveCollectionJobResult['nlpOutput'],
    fastEvidenceInputs: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly content: string;
    }[],
  ): Array<{
    readonly id: string;
    readonly postId: string;
    readonly text: string;
    readonly sentiment: string;
  }> {
    const containers: unknown[] = [
      nlp.recurringProblems,
      nlp.extractedNeeds,
      nlp.featureRequests,
      nlp.opportunities,
    ];
    const seen = new Set<string>();
    const output: Array<{
      readonly id: string;
      readonly postId: string;
      readonly text: string;
      readonly sentiment: string;
    }> = [];

    const normalizeBody = (value: string): string =>
      value
        .replace(/\s+/gu, ' ')
        .replace(/^.*?\bCommunity comment:\s*/isu, '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

    const originalComments = fastEvidenceInputs.filter(
      (input) =>
        input.sourceType === 'COMMENT' &&
        Boolean(input.postId) &&
        !input.id.startsWith('nlp:'),
    );

    const findOriginal = (sample: string) => {
      const normalizedSample = normalizeBody(sample);
      if (normalizedSample.length < 8) return null;

      return (
        originalComments.find((input) => {
          const normalizedInput = normalizeBody(input.content);
          return (
            normalizedInput === normalizedSample ||
            (normalizedSample.length >= 24 &&
              (normalizedInput.includes(normalizedSample) ||
                normalizedSample.includes(normalizedInput)))
          );
        }) ?? null
      );
    };

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const samples = Array.isArray(record.evidenceSamples)
        ? record.evidenceSamples
        : [];

      for (const sample of samples) {
        if (output.length >= 12) return;
        if (typeof sample !== 'string') continue;
        const text = sample.replace(/\s+/gu, ' ').trim();
        if (text.length < 20) continue;
        const body = text.replace(/^.*?\bCommunity comment:\s*/isu, '').trim();
        const kind = classifyDirectCommunityEvidence(body, 'COMMENT');
        if (kind !== 'USER_COMPLAINT' && kind !== 'FEATURE_REQUEST') continue;

        const original = findOriginal(text);
        /*
         * Never invent nlp:direct identifiers. If an NLP quote cannot be
         * mapped back to the original collector comment, it remains available
         * in NLP/Community-AI context but is not promoted as canonical
         * provenance evidence. The verifier may still resolve it from DB text.
         */
        if (!original?.postId) continue;

        const key = `${original.id}:${original.postId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
          id: original.id,
          postId: original.postId,
          text,
          sentiment: 'NEUTRAL',
        });
      }
    };

    containers.forEach(visit);
    return output;
  }

  /**
   * Deduplicates representative evidence by real provenance whenever possible.
   *
   * NLP may surface a short sentence fragment while the fast collector corpus
   * still contains the complete original review/comment under the same
   * external id. Text-only deduplication treated those as two different pieces
   * of evidence and could bias Community AI toward the shorter fragment.
   *
   * When two values share the same provenance id, retain the richer text while
   * preserving the first-seen position. Values without provenance still fall
   * back to normalized-text deduplication.
   */
  private mergeRepresentativeEvidence(
    preferred: readonly unknown[],
    fallback: readonly unknown[],
    limit: number,
  ): unknown[] {
    const orderedKeys: string[] = [];
    const bestByKey = new Map<
      string,
      { readonly value: unknown; readonly richness: number }
    >();

    for (const value of [...preferred, ...fallback]) {
      const text = this.extractEvidenceText(value)
        .replace(/\s+/gu, ' ')
        .trim();
      if (!text) continue;

      const provenanceKey = this.extractEvidenceProvenanceKey(value);
      const key = provenanceKey ?? `text:${this.normalizeTerm(text).slice(0, 500)}`;
      const richness = this.scoreEvidenceRichness(text);
      const existing = bestByKey.get(key);

      if (!existing) {
        orderedKeys.push(key);
        bestByKey.set(key, { value, richness });
        continue;
      }

      if (richness > existing.richness) {
        bestByKey.set(key, { value, richness });
      }
    }

    return orderedKeys
      .slice(0, limit)
      .map((key) => bestByKey.get(key)?.value)
      .filter((value): value is unknown => value !== undefined);
  }

  /** Returns a stable real-source key for a representative evidence object. */
  private extractEvidenceProvenanceKey(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const postId =
      typeof record.postId === 'string' ? record.postId.trim() : '';

    if (id && !id.startsWith('nlp:')) {
      return `id:${id.toLowerCase()}`;
    }

    if (postId && !postId.startsWith('nlp:')) {
      return `post:${postId.toLowerCase()}`;
    }

    return null;
  }

  /** Prefers complete complaint/request context over extracted sentence fragments. */
  private scoreEvidenceRichness(text: string): number {
    const normalized = text.replace(/\s+/gu, ' ').trim();
    const directBody = normalized
      .replace(/^.*?\bCommunity comment:\s*/isu, '')
      .trim();
    const contextBonus = /\bCommunity comment:\s*/iu.test(normalized) ? 120 : 0;
    const problemBonus =
      classifyDirectCommunityEvidence(directBody, 'COMMENT') !== 'NONE' ? 80 : 0;
    const detailBonus = Math.min(120, directBody.split(/\s+/u).length * 3);

    return normalized.length + contextBonus + problemBonus + detailBonus;
  }

  /**
   * Builds representative domain evidence directly from the authoritative
   * analyzed-text records returned by the in-memory NLP pipeline.
   *
   * The unified collection job uses merged keywords from all selected domains.
   * A text is assigned to a domain when it matches either two strong domain
   * terms or one non-generic specific domain anchor. This keeps attribution
   * honest while allowing secondary domains with sparse DB keywords to retain
   * evidence found by their own search anchors.
   */
  private buildAnalyzedEvidenceForDomain(
    analyzedTexts: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly originalText: string;
      readonly cleanedText: string;
      readonly sentiment: string;
    }[],
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): {
    readonly posts: Array<{
      readonly id: string;
      readonly text: string;
      readonly sentiment: string;
    }>;
    readonly comments: Array<{
      readonly id: string;
      readonly postId: string;
      readonly text: string;
      readonly sentiment: string;
    }>;
  } {
    const resolved = analyzedTexts.filter((item) =>
      this.evidenceBelongsToDomain(
        `${item.originalText} ${item.cleanedText}`,
        domain,
        domains,
      ),
    );

    const representative = resolved.filter((item) =>
      this.isRepresentativeProblemEvidence(
        `${item.originalText} ${item.cleanedText}`,
      ),
    );

    const posts = representative
      .filter((item) => item.sourceType === 'POST')
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        text: item.originalText || item.cleanedText,
        sentiment: item.sentiment,
      }));

    const comments = representative
      .filter((item) => item.sourceType === 'COMMENT')
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        postId: item.postId ?? item.id,
        text: item.originalText || item.cleanedText,
        sentiment: item.sentiment,
      }));

    return { posts, comments };
  }

  /**
   * Uses the same strong-term policy as representative evidence filtering.
   */
  /**
   * Keeps representative samples limited to concrete complaints, failures,
   * limitations, requests, or unmet needs. Generic explainers and promotions
   * may remain in NLP totals but are not shown as problem evidence.
   */
  private isRepresentativeProblemEvidence(value: string): boolean {
    const fullText = value.replace(/\s+/gu, ' ').trim();
    if (fullText.length < 35) {
      return false;
    }

    const commentMarker = /\bCommunity comment:\s*/iu;
    const match = fullText.match(commentMarker);
    const evidenceText = match
      ? fullText.slice((match.index ?? 0) + match[0].length).trim()
      : fullText;

    return (
      classifyDirectCommunityEvidence(
        evidenceText,
        match ? 'COMMENT' : 'POST',
      ) !== 'NONE'
    );
  }

  /**
   * One-specific-term fallback used when the strict two-term matcher produced
   * no evidence for a selected domain. Generic cross-domain words are excluded
   * so secondary domains gain recall without inheriting unrelated comments.
   */
  private evidenceBelongsToDomain(
    value: string,
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): boolean {
    const scores = domains.map((candidate) => ({
      domain: candidate,
      score: this.calculateEvidenceDomainScore(value, candidate),
    }));
    const targetScore =
      scores.find((item) => item.domain.id === domain.id)?.score ?? 0;
    const bestScore = Math.max(0, ...scores.map((item) => item.score));

    return (
      targetScore >= 0.28 &&
      targetScore >= bestScore - 0.12
    );
  }

  private calculateEvidenceDomainScore(
    value: string,
    domain: SelectedGenerationDomain,
  ): number {
    const marker = value.match(/\bCommunity comment:\s*/iu);
    const body = marker && marker.index !== undefined
      ? value.slice(marker.index + marker[0].length)
      : value;
    const context = marker && marker.index !== undefined
      ? value.slice(0, marker.index)
      : '';
    const bodyScore = this.calculateTextDomainSemanticScore(body, domain);
    const contextScore = this.calculateTextDomainSemanticScore(context, domain);

    if (bodyScore >= 0.28) {
      return Math.min(1, bodyScore + contextScore * 0.08);
    }

    return Math.min(1, Math.max(bodyScore, contextScore * 0.55));
  }

  private calculateTextDomainSemanticScore(
    value: string,
    domain: SelectedGenerationDomain,
  ): number {
    const text = this.normalizeTerm(value)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!text) return 0;

    const domainName = this.normalizeTerm(domain.name)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (domainName.length >= 3 && this.containsSemanticTerm(text, domainName)) {
      return 1;
    }

    const terms = this.buildDomainSemanticTerms(domain);
    const matched = terms.filter((term) =>
      this.containsSemanticTerm(text, term),
    );

    if (matched.length >= 3) return 0.92;
    if (matched.length === 2) return 0.78;
    if (matched.length === 1) {
      const term = matched[0];
      return term.includes(' ') ? 0.68 : 0.5;
    }

    return 0;
  }

  private buildDomainSemanticTerms(
    domain: SelectedGenerationDomain,
  ): string[] {
    const normalizedName = this.normalizeTerm(domain.name)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const aliases: string[] = [];

    if (/^(?:finance|financial services|fintech)$/u.test(normalizedName)) {
      aliases.push(
        'finance',
        'financial',
        'bank',
        'banking',
        'payment',
        'payments',
        'card',
        'credit',
        'debit',
        'loan',
        'cash',
        'accounting',
        'invoice',
        'expense',
        'budget',
        'payroll',
        'reconciliation',
      );
    }

    if (/^(?:e commerce|ecommerce|online retail|retail)$/u.test(normalizedName)) {
      aliases.push(
        'e commerce',
        'ecommerce',
        'marketplace',
        'buyer',
        'seller',
        'checkout',
        'shopping cart',
        'cart',
        'order',
        'orders',
        'refund',
        'storefront',
        'paypal',
      );
    }

    if (/^(?:artificial intelligence|ai|machine learning)$/u.test(normalizedName)) {
      aliases.push(
        'artificial intelligence',
        'machine learning',
        'generative ai',
        'large language model',
        'llm',
        'ai model',
        'prompt',
        'chatbot',
        'computer vision',
        'natural language processing',
      );
    }

    const generic = new Set([
      'platform',
      'system',
      'application',
      'software',
      'dashboard',
      'monitoring',
      'management',
      'analytics',
      'integration',
      'automation',
      'optimization',
      'smart',
      'digital',
      'online',
    ]);

    return [...new Set([domain.name, ...domain.keywords, ...aliases])]
      .map((term) =>
        this.normalizeTerm(term)
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      )
      .filter((term) => term.length >= 3 && !generic.has(term));
  }

  private containsSemanticTerm(text: string, term: string): boolean {
    if (!term) return false;
    if (term.includes(' ')) return text.includes(term);
    return new RegExp(`(?:^|\\s)${this.escapeRegExp(term)}(?:$|\\s)`, 'u').test(text);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private filterEvidenceForDomain(
    values: unknown,
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): unknown[] {
    if (!Array.isArray(values)) return [];

    return values.filter((value) => {
      const text = this.extractEvidenceText(value);
      if (!text) return false;
      return this.evidenceBelongsToDomain(text, domain, domains);
    });
  }

  private extractEvidenceText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';

    const record = value as Record<string, unknown>;
    return [record.text, record.title, record.content]
      .filter((item): item is string => typeof item === 'string')
      .join(' ');
  }

  private toJsonValue(value: unknown): Prisma.JsonValue | null {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
    } catch {
      return null;
    }
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);
    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }
    return definition;
  }
}