import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  DUPLICATE_DETECTION_BATCH_SIZE,
  DUPLICATE_DETECTION_CANDIDATE_LIMIT,
  IDEA_GENERATION_ERROR_CODES,
  IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
  IDEA_TITLE_SIMILARITY_THRESHOLD,
  MAX_DUPLICATE_TEXT_LENGTH,
  MAX_DUPLICATE_TITLE_LENGTH,
} from '../constants/idea-generation.constants';
import type { CoreIdeaAiOutput } from '../types/idea-ai-output.type';

export type IdeaDuplicateDetectionDatabaseClient = Prisma.TransactionClient;

export type DuplicateIdeaCandidate = {
  readonly id: string;
  readonly title: string;
  readonly problemStatement: string;
  readonly objectives: Prisma.JsonValue;
  readonly targetUsers: Prisma.JsonValue;
  readonly partialAbstract: string | null;
  readonly fullAbstract: string | null;
  readonly createdAt: Date;
};

export type IdeaDuplicateReason =
  | 'EXACT_OR_NEAR_TITLE'
  | 'SEMANTIC_OVERLAP'
  | 'SAME_PROBLEM_FAMILY';

/**
 * Raw similarity result.
 *
 * `isDuplicate` includes compound similarity signals used by benchmark
 * redesign. The final pipeline stage applies a stricter decisive threshold so
 * moderate same-problem-family overlap cannot fail a successfully redesigned
 * paid generation.
 */
export type IdeaDuplicateCheckResult = {
  readonly isDuplicate: boolean;
  readonly highestSimilarity: number;
  readonly titleSimilarity: number;
  readonly semanticSimilarity: number;
  readonly workflowSimilarity: number;
  readonly sameProblemFamily: boolean;
  readonly familyPenalty: number;
  readonly duplicateReasons: readonly IdeaDuplicateReason[];
  readonly matchedIdea: DuplicateIdeaCandidate | null;
};

const BENCHMARK_DUPLICATE_CORPUS_TTL_MS = 2 * 60 * 1000;
const BENCHMARK_DUPLICATE_CORPUS_MAX_ENTRIES = 32;

type CachedDuplicateCorpus = {
  readonly domainId: string;
  readonly candidates: readonly DuplicateIdeaCandidate[];
  readonly expiresAt: number;
};

/**
 * Detects exact, near-title, and semantic duplicates globally across all
 * non-deleted ideas.
 *
 * The check intentionally spans users, countries, regions, cities, and domains.
 * Geographic or domain differences cannot be used to persist a materially
 * identical idea.
 *
 * Semantic comparison is provider-independent and uses a weighted token
 * fingerprint built from the title, problem statement, objectives, target
 * users, and available abstract.
 */
@Injectable()
export class IdeaDuplicateDetectionService {
  private readonly logger = new Logger(IdeaDuplicateDetectionService.name);
  private readonly benchmarkCorpusCache = new Map<string, CachedDuplicateCorpus>();
  private readonly benchmarkCorpusLoads = new Map<
    string,
    Promise<readonly DuplicateIdeaCandidate[]>
  >();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starts loading the benchmark's bounded semantic comparison corpus before
   * any provider response returns. The actual duplicate checks still perform a
   * fresh global exact-title query, and non-benchmark checks bypass this cache.
   */
  async prepareBenchmarkSemanticCorpus(
    cacheKey: string,
    domainId: string,
  ): Promise<readonly DuplicateIdeaCandidate[]> {
    const normalizedCacheKey = cacheKey.trim();
    const normalizedDomainId = domainId.trim();

    if (!normalizedCacheKey || !normalizedDomainId) {
      return [];
    }

    /*
     * Return the warmed corpus as well as caching it. Core generation can use
     * the same already-paid database read to tell the model which recent
     * same-domain concepts must not be reproduced. This prevents a predictable
     * duplicate from costing a second 15-25 second provider call while keeping
     * the normal exact-title and semantic duplicate checks unchanged.
     */
    return this.getBenchmarkSemanticCorpus(
      normalizedCacheKey,
      normalizedDomainId,
      this.prisma,
    );
  }

  async checkPreparedBenchmarkCorpus(
    cacheKey: string,
    domainId: string,
    idea: CoreIdeaAiOutput,
  ): Promise<IdeaDuplicateCheckResult> {
    const normalizedCacheKey = cacheKey.trim();
    const normalizedDomainId = domainId.trim();

    if (!normalizedCacheKey || !normalizedDomainId) {
      return {
        isDuplicate: false,
        highestSimilarity: 0,
        titleSimilarity: 0,
        semanticSimilarity: 0,
        workflowSimilarity: 0,
        sameProblemFamily: false,
        familyPenalty: 0,
        duplicateReasons: [],
        matchedIdea: null,
      };
    }

    const candidates = await this.getBenchmarkSemanticCorpus(
      normalizedCacheKey,
      normalizedDomainId,
      this.prisma,
    );

    return this.evaluateAgainstCandidates(idea, candidates);
  }

  async check(
    domainId: string,
    collectionJobId: string,
    idea: CoreIdeaAiOutput,
    database?: IdeaDuplicateDetectionDatabaseClient,
    semanticCorpusCacheKey?: string,
  ): Promise<IdeaDuplicateCheckResult> {
    const normalizedDomainId = domainId.trim();
    const normalizedCollectionJobId = collectionJobId.trim();
    const normalizedTitle = this.normalizeText(
      idea.title,
      MAX_DUPLICATE_TITLE_LENGTH,
    );

    if (!normalizedDomainId || !normalizedCollectionJobId || !normalizedTitle) {
      throw new ConflictException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
        message:
          'A valid domain, collection job, and generated idea are required.',
      });
    }

    const client = database ?? this.prisma;
    const rawTitle = idea.title.trim().slice(0, MAX_DUPLICATE_TITLE_LENGTH);

    /*
     * Start the two independent database reads together.
     *
     * The global exact-title guard and the bounded same-domain semantic corpus
     * do not depend on each other. Running them sequentially made the final
     * duplicate stage pay two remote PostgreSQL round trips back-to-back.
     *
     * Quality and race protection are unchanged:
     * - exact-title protection is still global and fresh;
     * - the final pipeline stage still performs a fresh semantic corpus read;
     * - benchmark calls may still reuse only their run-scoped warmed corpus.
     */
    const duplicateCheckStartedAt = Date.now();

    const semanticCorpusPromise = (async () => {
      const startedAt = Date.now();
      const candidates = semanticCorpusCacheKey
        ? await this.getBenchmarkSemanticCorpus(
            semanticCorpusCacheKey,
            normalizedDomainId,
            client,
          )
        : await this.loadSemanticCorpus(normalizedDomainId, client);

      return {
        candidates,
        elapsedMs: Date.now() - startedAt,
      };
    })();

    const exactTitleStartedAt = Date.now();
    const exactTitleMatch = await client.idea.findFirst({
      where: {
        deletedAt: null,
        title: {
          equals: rawTitle,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        title: true,
        problemStatement: true,
        objectives: true,
        targetUsers: true,
        partialAbstract: true,
        fullAbstract: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const exactTitleMs = Date.now() - exactTitleStartedAt;

    if (exactTitleMatch) {
      /*
       * The semantic read was intentionally launched in parallel. If a global
       * exact-title collision is already decisive, do not delay the rejection
       * waiting for the unrelated corpus read. Attach a rejection handler so a
       * later database failure cannot become an unhandled promise rejection.
       */
      void semanticCorpusPromise.catch(() => undefined);

      this.logger.debug(
        `Duplicate detection exact-title hit | domainId=${normalizedDomainId} | exactTitleMs=${exactTitleMs} | totalMs=${Date.now() - duplicateCheckStartedAt}`,
      );

      return {
        isDuplicate: true,
        highestSimilarity: 1,
        titleSimilarity: 1,
        semanticSimilarity: 1,
        workflowSimilarity: 1,
        sameProblemFamily: true,
        familyPenalty: 0,
        duplicateReasons: ['EXACT_OR_NEAR_TITLE', 'SEMANTIC_OVERLAP'],
        matchedIdea: this.mapStoredIdeaToCandidate(exactTitleMatch),
      };
    }

    const {
      candidates,
      elapsedMs: semanticCorpusMs,
    } = await semanticCorpusPromise;
    const comparisonStartedAt = Date.now();

    let matchedIdea: DuplicateIdeaCandidate | null = null;
    let highestSimilarity = 0;
    let highestTitleSimilarity = 0;
    let highestSemanticSimilarity = 0;
    let highestWorkflowSimilarity = 0;
    let highestCapabilitySimilarity = 0;
    let highestSameProblemFamily = false;

    const newFingerprint = this.buildFingerprint(idea);
    const normalizedTitleTokens = this.toTokenSet(normalizedTitle);

    /*
     * Bounded parallel batches:
     *
     * - A single database query is used.
     * - At most eight comparisons are scheduled per batch.
     * - Cheap title/problem checks reject weak candidates before the expensive
     *   abstract, workflow, capability, and family comparisons.
     * - A decisive duplicate exits immediately and skips remaining batches.
     *
     * The work is CPU-bound, so Promise.all does not create extra Node.js
     * threads; the bounded batches mainly prevent one huge synchronous loop
     * and keep memory/event-loop pressure predictable.
     */
    for (
      let offset = 0;
      offset < candidates.length;
      offset += DUPLICATE_DETECTION_BATCH_SIZE
    ) {
      const batch = candidates.slice(
        offset,
        offset + DUPLICATE_DETECTION_BATCH_SIZE,
      );

      const comparisons = await Promise.all(
        batch.map((candidate) =>
          Promise.resolve().then(() =>
            this.compareCandidate(
              idea,
              candidate,
              newFingerprint,
              normalizedTitleTokens,
            ),
          ),
        ),
      );

      for (const comparison of comparisons) {
        if (
          comparison.combinedSimilarity > highestSimilarity ||
          (comparison.isDuplicate && matchedIdea === null)
        ) {
          highestSimilarity = comparison.combinedSimilarity;
          highestTitleSimilarity = comparison.titleSimilarity;
          highestSemanticSimilarity = comparison.semanticSimilarity;
          highestWorkflowSimilarity = comparison.workflowSimilarity;
          highestCapabilitySimilarity = comparison.capabilitySimilarity;
          highestSameProblemFamily = comparison.sameProblemFamily;
          matchedIdea = comparison.candidate;
        }
      }

      const decisiveDuplicate = comparisons.find(
        (comparison) =>
          comparison.titleSimilarity >= 0.995 ||
          comparison.semanticSimilarity >= 0.94 ||
          (comparison.sameProblemFamily &&
            comparison.semanticSimilarity >= 0.86 &&
            comparison.workflowSimilarity >= 0.84) ||
          (comparison.capabilitySimilarity >= 0.88 &&
            comparison.workflowSimilarity >= 0.8),
      );

      if (decisiveDuplicate) {
        matchedIdea = decisiveDuplicate.candidate;
        highestSimilarity = decisiveDuplicate.combinedSimilarity;
        highestTitleSimilarity = decisiveDuplicate.titleSimilarity;
        highestSemanticSimilarity = decisiveDuplicate.semanticSimilarity;
        highestWorkflowSimilarity = decisiveDuplicate.workflowSimilarity;
        highestCapabilitySimilarity = decisiveDuplicate.capabilitySimilarity;
        highestSameProblemFamily = decisiveDuplicate.sameProblemFamily;
        break;
      }

      /*
       * Yield between batches so WebSocket heartbeat, cancellation, and other
       * requests are not starved by a long CPU-only comparison loop.
       */
      if (offset + DUPLICATE_DETECTION_BATCH_SIZE < candidates.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    const nearTitleDuplicate = highestTitleSimilarity >= 0.9;
    const directSemanticDuplicate = highestSemanticSimilarity >= 0.82;
    const familyCompoundDuplicate =
      highestSameProblemFamily &&
      highestSemanticSimilarity >= 0.68 &&
      highestWorkflowSimilarity >= 0.7;
    const capabilityWorkflowDuplicate =
      highestCapabilitySimilarity >= 0.72 && highestWorkflowSimilarity >= 0.58;
    const isDuplicate =
      nearTitleDuplicate ||
      directSemanticDuplicate ||
      familyCompoundDuplicate ||
      capabilityWorkflowDuplicate;
    const duplicateReasons: IdeaDuplicateReason[] = [];

    if (nearTitleDuplicate) {
      duplicateReasons.push('EXACT_OR_NEAR_TITLE');
    }

    if (
      directSemanticDuplicate ||
      familyCompoundDuplicate ||
      capabilityWorkflowDuplicate
    ) {
      duplicateReasons.push('SEMANTIC_OVERLAP');
    }

    if (familyCompoundDuplicate) {
      duplicateReasons.push('SAME_PROBLEM_FAMILY');
    }

    const comparisonMs = Date.now() - comparisonStartedAt;

    this.logger.debug(
      [
        'Duplicate detection timing',
        `domainId=${normalizedDomainId}`,
        `candidates=${candidates.length}`,
        `exactTitleMs=${exactTitleMs}`,
        `semanticCorpusMs=${semanticCorpusMs}`,
        `comparisonMs=${comparisonMs}`,
        `totalMs=${Date.now() - duplicateCheckStartedAt}`,
      ].join(' | '),
    );

    return {
      isDuplicate,
      highestSimilarity: this.round(highestSimilarity),
      titleSimilarity: this.round(highestTitleSimilarity),
      semanticSimilarity: this.round(highestSemanticSimilarity),
      workflowSimilarity: this.round(highestWorkflowSimilarity),
      sameProblemFamily: highestSameProblemFamily,
      familyPenalty: 0,
      duplicateReasons,
      matchedIdea,
    };
  }

  /**
   * Reuses the bounded same-domain semantic corpus inside one benchmark or
   * final-stage rescue flow. Global exact-title protection still runs in the
   * final duplicate stage and again inside atomic persistence.
   */
  private async getBenchmarkSemanticCorpus(
    cacheKey: string,
    domainId: string,
    client: PrismaService | IdeaDuplicateDetectionDatabaseClient,
  ): Promise<readonly DuplicateIdeaCandidate[]> {
    const now = Date.now();
    const cached = this.benchmarkCorpusCache.get(cacheKey);

    if (
      cached &&
      cached.domainId === domainId &&
      cached.expiresAt > now
    ) {
      return cached.candidates;
    }

    const inFlight = this.benchmarkCorpusLoads.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = this.loadSemanticCorpus(domainId, client);
    this.benchmarkCorpusLoads.set(cacheKey, loadPromise);

    try {
      const candidates = await loadPromise;
      this.pruneBenchmarkCorpusCache(now);
      this.benchmarkCorpusCache.set(cacheKey, {
        domainId,
        candidates,
        expiresAt: now + BENCHMARK_DUPLICATE_CORPUS_TTL_MS,
      });
      return candidates;
    } finally {
      this.benchmarkCorpusLoads.delete(cacheKey);
    }
  }

  private async loadSemanticCorpus(
    domainId: string,
    client: PrismaService | IdeaDuplicateDetectionDatabaseClient,
  ): Promise<readonly DuplicateIdeaCandidate[]> {
    const storedIdeas = await client.idea.findMany({
      where: {
        deletedAt: null,
        domainId,
      },
      select: {
        id: true,
        title: true,
        problemStatement: true,
        objectives: true,
        targetUsers: true,
        partialAbstract: true,
        fullAbstract: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: DUPLICATE_DETECTION_CANDIDATE_LIMIT,
    });

    return storedIdeas.map((storedIdea) =>
      this.mapStoredIdeaToCandidate(storedIdea),
    );
  }

  private pruneBenchmarkCorpusCache(now: number): void {
    for (const [key, cached] of this.benchmarkCorpusCache.entries()) {
      if (cached.expiresAt <= now) {
        this.benchmarkCorpusCache.delete(key);
      }
    }

    while (
      this.benchmarkCorpusCache.size >= BENCHMARK_DUPLICATE_CORPUS_MAX_ENTRIES
    ) {
      const oldestKey = this.benchmarkCorpusCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) {
        break;
      }
      this.benchmarkCorpusCache.delete(oldestKey);
    }
  }

  /**
   * Performs the narrow race-protection check used inside idea persistence.
   *
   * The dedicated duplicate-check pipeline stage has already completed the
   * bounded semantic comparison immediately before persistence. Repeating that
   * full comparison inside the serializable transaction loads up to forty large
   * idea records again and extends the transaction without improving the normal
   * result. Persistence therefore rechecks only a global case-insensitive exact
   * title collision, which protects the most likely concurrent race while
   * keeping the transaction short.
   */
  async assertNoExactTitleDuplicate(
    idea: CoreIdeaAiOutput,
    database?: IdeaDuplicateDetectionDatabaseClient,
  ): Promise<void> {
    const client = database ?? this.prisma;
    const title = idea.title.trim().slice(0, MAX_DUPLICATE_TITLE_LENGTH);

    const match = await client.idea.findFirst({
      where: {
        deletedAt: null,
        title: {
          equals: title,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!match) {
      return;
    }

    throw new ConflictException({
      code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
      message:
        'An idea with the same title already exists on the platform and cannot be generated again.',
      details: {
        matchedIdeaId: match.id,
        matchedTitle: match.title,
        duplicateReasons: ['EXACT_OR_NEAR_TITLE'],
        titleSimilarity: 1,
      },
    });
  }

  async assertNotDuplicate(
    domainId: string,
    collectionJobId: string,
    idea: CoreIdeaAiOutput,
    database?: IdeaDuplicateDetectionDatabaseClient,
  ): Promise<void> {
    const result = await this.check(domainId, collectionJobId, idea, database);

    if (!result.isDuplicate) {
      return;
    }

    throw new ConflictException({
      code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
      message:
        'A materially similar idea already exists on the platform and cannot be generated again.',
      details: {
        matchedIdeaId: result.matchedIdea?.id ?? null,
        matchedTitle: result.matchedIdea?.title ?? null,
        highestSimilarity: result.highestSimilarity,
        titleSimilarity: result.titleSimilarity,
        semanticSimilarity: result.semanticSimilarity,
        workflowSimilarity: result.workflowSimilarity,
        sameProblemFamily: result.sameProblemFamily,
        familyPenalty: result.familyPenalty,
        duplicateReasons: result.duplicateReasons,
        titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
        semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
      },
    });
  }

  private evaluateAgainstCandidates(
    idea: CoreIdeaAiOutput,
    candidates: readonly DuplicateIdeaCandidate[],
  ): IdeaDuplicateCheckResult {
    const normalizedTitle = this.normalizeText(
      idea.title,
      MAX_DUPLICATE_TITLE_LENGTH,
    );
    const newFingerprint = this.buildFingerprint(idea);
    const normalizedTitleTokens = this.toTokenSet(normalizedTitle);

    let matchedIdea: DuplicateIdeaCandidate | null = null;
    let highestSimilarity = 0;
    let highestTitleSimilarity = 0;
    let highestSemanticSimilarity = 0;
    let highestWorkflowSimilarity = 0;
    let highestCapabilitySimilarity = 0;
    let highestSameProblemFamily = false;

    for (const candidate of candidates) {
      const comparison = this.compareCandidate(
        idea,
        candidate,
        newFingerprint,
        normalizedTitleTokens,
      );

      if (comparison.combinedSimilarity > highestSimilarity) {
        highestSimilarity = comparison.combinedSimilarity;
        highestTitleSimilarity = comparison.titleSimilarity;
        highestSemanticSimilarity = comparison.semanticSimilarity;
        highestWorkflowSimilarity = comparison.workflowSimilarity;
        highestCapabilitySimilarity = comparison.capabilitySimilarity;
        highestSameProblemFamily = comparison.sameProblemFamily;
        matchedIdea = comparison.candidate;
      }

      if (
        comparison.titleSimilarity >= 0.995 ||
        comparison.semanticSimilarity >= 0.94 ||
        (comparison.sameProblemFamily &&
          comparison.semanticSimilarity >= 0.86 &&
          comparison.workflowSimilarity >= 0.84) ||
        (comparison.capabilitySimilarity >= 0.88 &&
          comparison.workflowSimilarity >= 0.8)
      ) {
        highestSimilarity = comparison.combinedSimilarity;
        highestTitleSimilarity = comparison.titleSimilarity;
        highestSemanticSimilarity = comparison.semanticSimilarity;
        highestWorkflowSimilarity = comparison.workflowSimilarity;
        highestCapabilitySimilarity = comparison.capabilitySimilarity;
        highestSameProblemFamily = comparison.sameProblemFamily;
        matchedIdea = comparison.candidate;
        break;
      }
    }

    const nearTitleDuplicate = highestTitleSimilarity >= 0.9;
    const directSemanticDuplicate = highestSemanticSimilarity >= 0.82;
    const familyCompoundDuplicate =
      highestSameProblemFamily &&
      highestSemanticSimilarity >= 0.68 &&
      highestWorkflowSimilarity >= 0.7;
    const capabilityWorkflowDuplicate =
      highestCapabilitySimilarity >= 0.72 && highestWorkflowSimilarity >= 0.58;
    const isDuplicate =
      nearTitleDuplicate ||
      directSemanticDuplicate ||
      familyCompoundDuplicate ||
      capabilityWorkflowDuplicate;
    const duplicateReasons: IdeaDuplicateReason[] = [];

    if (nearTitleDuplicate) {
      duplicateReasons.push('EXACT_OR_NEAR_TITLE');
    }
    if (
      directSemanticDuplicate ||
      familyCompoundDuplicate ||
      capabilityWorkflowDuplicate
    ) {
      duplicateReasons.push('SEMANTIC_OVERLAP');
    }
    if (familyCompoundDuplicate) {
      duplicateReasons.push('SAME_PROBLEM_FAMILY');
    }

    return {
      isDuplicate,
      highestSimilarity: this.round(highestSimilarity),
      titleSimilarity: this.round(highestTitleSimilarity),
      semanticSimilarity: this.round(highestSemanticSimilarity),
      workflowSimilarity: this.round(highestWorkflowSimilarity),
      sameProblemFamily: highestSameProblemFamily,
      familyPenalty: 0,
      duplicateReasons,
      matchedIdea,
    };
  }

  private compareCandidate(
    idea: CoreIdeaAiOutput,
    candidate: DuplicateIdeaCandidate,
    newFingerprint: Record<string, Set<string>>,
    normalizedTitleTokens: Set<string>,
  ): {
    readonly candidate: DuplicateIdeaCandidate;
    readonly isDuplicate: boolean;
    readonly combinedSimilarity: number;
    readonly titleSimilarity: number;
    readonly semanticSimilarity: number;
    readonly workflowSimilarity: number;
    readonly capabilitySimilarity: number;
    readonly sameProblemFamily: boolean;
  } {
    const candidateTitleTokens = this.toTokenSet(
      this.normalizeText(candidate.title, MAX_DUPLICATE_TITLE_LENGTH),
    );
    const titleSimilarity = this.calculateDiceSimilarity(
      normalizedTitleTokens,
      candidateTitleTokens,
    );

    /*
     * Cheap pre-filter. A very weak title match does not immediately reject a
     * candidate because rebranded duplicates may still share the same problem.
     */
    const problemSimilarity = this.calculateDiceSimilarity(
      newFingerprint.problem,
      this.tokenize(candidate.problemStatement),
    );

    if (titleSimilarity < 0.18 && problemSimilarity < 0.28) {
      return {
        candidate,
        isDuplicate: false,
        combinedSimilarity: Math.max(titleSimilarity, problemSimilarity),
        titleSimilarity,
        semanticSimilarity: problemSimilarity * 0.35,
        workflowSimilarity: 0,
        capabilitySimilarity: 0,
        sameProblemFamily: false,
      };
    }

    const candidateFingerprint = this.buildCandidateFingerprint(candidate);
    const semanticSimilarity = this.calculateWeightedSemanticSimilarity(
      newFingerprint,
      candidateFingerprint,
    );

    /*
     * Second-stage pre-filter. Skip expensive family/capability extraction for
     * clearly unrelated candidates.
     */
    if (
      titleSimilarity < 0.45 &&
      problemSimilarity < 0.52 &&
      semanticSimilarity < 0.5
    ) {
      return {
        candidate,
        isDuplicate: false,
        combinedSimilarity: Math.max(titleSimilarity, semanticSimilarity),
        titleSimilarity,
        semanticSimilarity,
        workflowSimilarity: 0,
        capabilitySimilarity: 0,
        sameProblemFamily: false,
      };
    }

    const workflowSimilarity = this.calculateWorkflowSimilarity(
      newFingerprint,
      candidateFingerprint,
    );
    const capabilitySimilarity = this.calculateCapabilitySimilarity(
      idea,
      candidate,
    );
    const sameProblemFamily = this.belongsToSameProblemFamily(idea, candidate);

    const familyCompoundDuplicate =
      sameProblemFamily &&
      semanticSimilarity >= 0.84 &&
      workflowSimilarity >= 0.82;
    const capabilityWorkflowDuplicate =
      capabilitySimilarity >= 0.86 && workflowSimilarity >= 0.78;

    /*
     * Same-domain ideas often share vocabulary and broad workflows. A hard
     * duplicate now requires either an almost identical title, very high
     * semantic overlap, or a strong compound match across multiple dimensions.
     * This prevents false conflicts when two ideas address the same evidence
     * using meaningfully different products.
     */
    const isDuplicate =
      titleSimilarity >= IDEA_TITLE_SIMILARITY_THRESHOLD ||
      semanticSimilarity >= IDEA_SEMANTIC_SIMILARITY_THRESHOLD ||
      familyCompoundDuplicate ||
      capabilityWorkflowDuplicate;
    const combinedSimilarity = Math.max(
      titleSimilarity,
      semanticSimilarity,
      familyCompoundDuplicate || capabilityWorkflowDuplicate
        ? Math.max(workflowSimilarity, capabilitySimilarity)
        : 0,
    );

    return {
      candidate,
      isDuplicate,
      combinedSimilarity,
      titleSimilarity,
      semanticSimilarity,
      workflowSimilarity,
      capabilitySimilarity,
      sameProblemFamily,
    };
  }

  private mapStoredIdeaToCandidate(idea: {
    readonly id: string;
    readonly title: string;
    readonly problemStatement: string | null;
    readonly objectives: Prisma.JsonValue;
    readonly targetUsers: Prisma.JsonValue;
    readonly partialAbstract: string | null;
    readonly fullAbstract: string | null;
    readonly createdAt: Date;
  }): DuplicateIdeaCandidate {
    return {
      id: idea.id,
      title: idea.title.trim(),
      problemStatement: idea.problemStatement?.trim() ?? '',
      objectives: idea.objectives,
      targetUsers: idea.targetUsers,
      partialAbstract: idea.partialAbstract?.trim() || null,
      fullAbstract: idea.fullAbstract?.trim() || null,
      createdAt: idea.createdAt,
    };
  }

  private buildFingerprint(
    idea: CoreIdeaAiOutput,
  ): Record<string, Set<string>> {
    return {
      title: this.tokenize(idea.title),
      problem: this.tokenize(idea.problemStatement),
      objectives: this.tokenize(idea.objectives.join(' ')),
      users: this.tokenize(idea.targetUsers.join(' ')),
      abstract: this.tokenize(
        idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract ?? '',
      ),
    };
  }

  private buildCandidateFingerprint(
    idea: DuplicateIdeaCandidate,
  ): Record<string, Set<string>> {
    return {
      title: this.tokenize(idea.title),
      problem: this.tokenize(idea.problemStatement),
      objectives: this.tokenize(this.jsonText(idea.objectives)),
      users: this.tokenize(this.jsonText(idea.targetUsers)),
      abstract: this.tokenize(idea.fullAbstract ?? idea.partialAbstract ?? ''),
    };
  }

  /**
   * Detects repeated product directions even when branding and wording change.
   * The family comparison intentionally focuses on the primary problem and
   * workflow rather than generic terms such as platform or dashboard.
   */
  private belongsToSameProblemFamily(
    idea: CoreIdeaAiOutput,
    candidate: DuplicateIdeaCandidate,
  ): boolean {
    const first = [
      idea.title,
      idea.problemStatement,
      ...idea.objectives,
      ...idea.targetUsers,
      idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase();
    const second = [
      candidate.title,
      candidate.problemStatement,
      this.jsonText(candidate.objectives),
      this.jsonText(candidate.targetUsers),
      candidate.fullAbstract ?? candidate.partialAbstract ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase();

    const families: readonly RegExp[] = [
      /authentication|account activation|login|sign in|verification|credential|password recovery/iu,
      /data loss|synchroni[sz]|backup|restore|recovery|missing history/iu,
      /navigation|interface|usability|back button|scroll|popup/iu,
      /cross-device|desktop|laptop|mobile-only|computer access/iu,
      /paywall|pricing|subscription|cost restriction|paid access/iu,
    ];

    return families.some((family) => family.test(first) && family.test(second));
  }
  /**
   * Detects repeated capability combinations even when the model changes the
   * product name and rewrites the problem statement. This closes the gap where
   * two ideas share the same workbench, recommendation, local-processing, and
   * export workflow but remain below the token-similarity threshold.
   */
  private calculateCapabilitySimilarity(
    idea: CoreIdeaAiOutput,
    candidate: DuplicateIdeaCandidate,
  ): number {
    const first = this.extractCapabilities(
      [
        idea.title,
        idea.problemStatement,
        ...idea.objectives,
        ...idea.targetUsers,
        idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract ?? '',
      ].join(' '),
    );
    const second = this.extractCapabilities(
      [
        candidate.title,
        candidate.problemStatement,
        this.jsonText(candidate.objectives),
        this.jsonText(candidate.targetUsers),
        candidate.fullAbstract ?? candidate.partialAbstract ?? '',
      ].join(' '),
    );

    return this.calculateDiceSimilarity(first, second);
  }

  private extractCapabilities(value: string): Set<string> {
    const normalized = this.normalizeText(value, MAX_DUPLICATE_TEXT_LENGTH);
    const capabilities: Array<readonly [string, RegExp]> = [
      [
        'ai-recommendation',
        /recommend|suggest|discover|algorithm chain|recipe generation/iu,
      ],
      [
        'transformation-workbench',
        /transformation|encoding|hashing|compression|cryptographic|workbench/iu,
      ],
      [
        'sandbox-testing',
        /sandbox|test|validate|reorder|interactive workbench/iu,
      ],
      [
        'local-first',
        /local[- ]first|on-device|offline|client-side|webassembly/iu,
      ],
      [
        'privacy-isolation',
        /privacy|data isolation|never leaves|external server/iu,
      ],
      ['recipe-export', /recipe|workflow export|exportable|reproducible/iu],
      ['audit-trace', /audit log|step-by-step|history|trace/iu],
      ['sdk-backend', /sdk|vendor backend|host-integrated/iu],
      [
        'subscription-recovery',
        /subscription|receipt|entitlement|restore purchase/iu,
      ],
      [
        'productivity-context',
        /productivity|tab management|page content|user intent/iu,
      ],
      [
        'streaming-middleware',
        /streaming|tcp|udp|raspberry pi|real-time transmission/iu,
      ],
    ];

    return new Set(
      capabilities
        .filter(([, pattern]) => pattern.test(normalized))
        .map(([name]) => name),
    );
  }

  /**
   * Measures similarity of the candidate's operational flow separately from
   * broad topic similarity. Objectives and abstracts carry most of the weight
   * because they describe what users do and how the product delivers value.
   */
  private calculateWorkflowSimilarity(
    first: Record<string, Set<string>>,
    second: Record<string, Set<string>>,
  ): number {
    return (
      this.calculateDiceSimilarity(first.objectives, second.objectives) * 0.6 +
      this.calculateDiceSimilarity(first.abstract, second.abstract) * 0.4
    );
  }

  private calculateWeightedSemanticSimilarity(
    first: Record<string, Set<string>>,
    second: Record<string, Set<string>>,
  ): number {
    return (
      this.calculateDiceSimilarity(first.title, second.title) * 0.2 +
      this.calculateDiceSimilarity(first.problem, second.problem) * 0.35 +
      this.calculateDiceSimilarity(first.objectives, second.objectives) * 0.2 +
      this.calculateDiceSimilarity(first.users, second.users) * 0.1 +
      this.calculateDiceSimilarity(first.abstract, second.abstract) * 0.15
    );
  }

  private calculateDiceSimilarity(
    first: Set<string>,
    second: Set<string>,
  ): number {
    if (first.size === 0 || second.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const token of first) {
      if (second.has(token)) {
        intersection += 1;
      }
    }

    return (2 * intersection) / (first.size + second.size);
  }

  private tokenize(value: string): Set<string> {
    return this.toTokenSet(
      this.normalizeText(value, MAX_DUPLICATE_TEXT_LENGTH),
    );
  }

  private normalizeText(value: string, maxLength: number): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private toTokenSet(value: string): Set<string> {
    return new Set(
      value
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    );
  }

  private jsonText(value: Prisma.JsonValue): string {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .join(' ');
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private round(value: number): number {
    return Math.round(value * 10_000) / 10_000;
  }
}