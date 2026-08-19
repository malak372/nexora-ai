import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';

import {
  IdeaGenerationRunStatus,
  IdeaGenerationType,
  LanguageCode,
  Prisma,
} from '@prisma/client';

import type { GenerateGuestIdeaDto } from '../dto/generate-guest-idea.dto';
import type { GenerateIdeaDto } from '../dto/generate-idea.dto';

import type { IdeaGenerationStage } from '../interfaces/idea-generation-stage.interface';

import {
  IdeaGenerationPipelineService,
  type IdeaGenerationPipelineResult,
} from '../pipeline/idea-generation-pipeline.service';

import {
  createIdeaGenerationContext,
  type IdeaGenerationContext,
  type IdeaGenerationDomainResolutionTrace,
  type IdeaGenerationLocation,
  type SelectedGenerationDomain,
} from '../types/idea-generation-context.type';

import type { IdeaOwner } from '../../shared/types/idea-owner.type';
import type { IdeaGenerationPolicy } from '../types/idea-generation-policy.type';
import type { RequestCollectionPlan } from '../types/request-collection-plan.type';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';

import { IDEA_GENERATION_ERROR_CODES } from '../constants/idea-generation.constants';
import { IDEA_GENERATION_STAGE_KEYS } from '../constants/idea-generation-stages.constants';

import { GuestIdeaSessionService } from './guest-idea-session.service';

import { IdeaGenerationLockService } from './idea-generation-lock.service';

import { IdeaGenerationRunService } from './idea-generation-run.service';
import { DomainResolutionService } from './domain-resolution.service';
import { IdeaGenerationPolicyService } from './idea-generation-policy.service';
import { RequestCollectionPlanningService } from './request-collection-planning.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

/**
 * Dependency-injection token used to register all executable
 * idea-generation stage implementations.
 *
 * IdeasModule must provide an array containing one implementation
 * for every stage required by the selected generation type.
 *
 * @author Malak
 */
export const IDEA_GENERATION_STAGES = Symbol('IDEA_GENERATION_STAGES');

/**
 * Input used to generate an idea for an authenticated user.
 *
 * @author Malak
 */
export type GenerateRegisteredIdeaInput = {
  /**
   * Authenticated registered-user identifier.
   */
  userId: string;

  /**
   * Validated generation request body.
   */
  dto: GenerateIdeaDto;
};

/**
 * Input used to generate an idea for a guest session.
 *
 * The session token must come from the secure guest-session
 * cookie and must not be accepted directly from the request body.
 *
 * @author Malak
 */
export type GenerateGuestIdeaInput = {
  /**
   * Public guest-session token resolved from the secure cookie.
   */
  guestSessionToken: string;

  /**
   * Validated guest-generation request body.
   */
  dto: GenerateGuestIdeaDto;
};

/** Result returned immediately after a generation job is accepted. */
export type QueuedIdeaGenerationResult = {
  readonly runId: string;
  readonly status: IdeaGenerationRunStatus;
  readonly progressPercent: number;
};

/**
 * Common input used internally after resolving the generation
 * owner.
 *
 * @author Malak
 */
type ExecuteOwnedIdeaGenerationInput = {
  /**
   * Registered-user or guest-session owner.
   */
  owner: IdeaOwner;

  /**
   * Requested generation type.
   */
  generationType: IdeaGenerationType;

  /**
   * Software-domain identifier.
   */
  domainId: string;

  /** Ordered domains participating in this generation run. */
  selectedDomains: SelectedGenerationDomain[];

  /** Explainability-only trace for how the primary domain was resolved. */
  domainResolution: IdeaGenerationDomainResolutionTrace | null;

  requestDescription: string | null;

  collectionPlan: RequestCollectionPlan | null;

  /**
   * User-provided generation keywords.
   */
  keywords: string[];

  /**
   * Raw data-source keys requested by the client.
   */
  requestedDataSourceKeys: string[];

  /**
   * Collection location and language information.
   */
  location: IdeaGenerationLocation;

  /**
   * Whether the resolver must bypass compatible historical collection jobs.
   */
  forceRefresh: boolean;
};

/**
 * Main application facade for starting idea-generation
 * workflows.
 *
 * Responsibilities:
 * - Resolve the generation owner.
 * - Resolve guest sessions from secure session tokens.
 * - Create the initial queued generation run.
 * - Acquire an owner-specific generation lock.
 * - Create the initial generation context.
 * - Execute the complete idea-generation pipeline.
 * - Release the generation lock in every outcome.
 * - Persist pre-pipeline orchestration failures when possible.
 *
 * This service intentionally does not:
 * - Evaluate generation entitlement directly.
 * - Select domains or data sources directly.
 * - Deduct credits.
 * - Consume free generations.
 * - Consume guest generation entitlement.
 * - Execute individual AI or persistence operations.
 *
 * Those operations belong to pipeline stages:
 * - REQUEST_VALIDATION
 * - ENTITLEMENT_CHECK
 * - DATA_SOURCE_SELECTION
 * - IDEA_PERSISTENCE
 * - Other specialized generation stages
 *
 * Keeping policy and selection inside the pipeline prevents the
 * same logic from being executed once by the orchestrator and
 * again by the registered stages.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationOrchestratorService implements OnApplicationShutdown {
  private readonly logger = new Logger(IdeaGenerationOrchestratorService.name);

  /**
   * Locally executing runs are tracked so graceful shutdown can persist a
   * RETRYING state and release only locks owned by this process.
   */
  private readonly activeRuns = new Map<string, IdeaOwner>();

  /** Per-run heartbeat timers keep long external stages from looking stale. */
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();

  /** One non-overlapping run/lock heartbeat every 30 seconds. */
  private readonly heartbeatIntervalMs = 30_000;

  private readonly heartbeatInFlight = new Set<string>();

  constructor(
    private readonly guestSessionService: GuestIdeaSessionService,

    private readonly lockService: IdeaGenerationLockService,

    private readonly runService: IdeaGenerationRunService,

    private readonly pipelineService: IdeaGenerationPipelineService,

    private readonly domainResolutionService: DomainResolutionService,

    private readonly requestCollectionPlanningService: RequestCollectionPlanningService,

    private readonly prisma: PrismaService,

    private readonly policyService: IdeaGenerationPolicyService,

    @Inject(IDEA_GENERATION_STAGES)
    private readonly stages: readonly IdeaGenerationStage[],
  ) { }

  /**
   * Persists locally active work as recoverable before a graceful shutdown.
   *
   * Abrupt process termination cannot run this hook, so the recovery scanner
   * also detects stale RUNNING rows through their heartbeat timestamp.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    const activeEntries = [...this.activeRuns.entries()];

    for (const runId of this.heartbeatTimers.keys()) {
      this.stopRunHeartbeat(runId);
    }

    if (activeEntries.length === 0) {
      return;
    }

    this.logger.warn(
      `Preparing ${activeEntries.length} active generation run(s) for recovery${signal ? ` after ${signal}` : ''}.`,
    );

    await Promise.all(
      activeEntries.map(async ([runId, owner]) => {
        try {
          await this.runService.markRetrying(
            runId,
            'The generation process was interrupted by a server shutdown and will resume automatically.',
            new Date(),
            false,
          );
        } catch (error: unknown) {
          const normalized = this.normalizeError(error);
          this.logger.warn(
            `Could not mark generation run "${runId}" as retrying during shutdown: ${normalized.message}`,
          );
        }

        try {
          await this.lockService.release({ owner, runId });
        } catch (error: unknown) {
          const normalized = this.normalizeError(error);
          this.logger.warn(
            `Could not release generation lock for run "${runId}" during shutdown: ${normalized.message}`,
          );
        }
      }),
    );
  }

  /**
   * Returns run IDs currently executing inside this Node.js process.
   *
   * The recovery scanner uses this to avoid reclaiming a local run when a
   * temporary database outage delayed its heartbeat.
   */
  getLocallyActiveRunIds(): string[] {
    return [...this.activeRuns.keys()];
  }

  /**
   * Restarts an interrupted run from its latest durable context checkpoint.
   * Completed/skipped stage rows are preserved and ignored by the pipeline.
   */
  async resumeRunFromCheckpoint(
    runId: string,
  ): Promise<IdeaGenerationPipelineResult> {
    const run = await this.runService.findRunOrThrow(runId);

    if (
      run.status !== IdeaGenerationRunStatus.QUEUED &&
      run.status !== IdeaGenerationRunStatus.RETRYING &&
      run.status !== IdeaGenerationRunStatus.PAUSED
    ) {
      throw new Error(
        `Generation run "${runId}" cannot be resumed from status ${run.status}.`,
      );
    }

    if (!run.contextSnapshot || Array.isArray(run.contextSnapshot)) {
      throw new Error(
        `Generation run "${runId}" does not contain a valid context checkpoint.`,
      );
    }

    const checkpoint = run.contextSnapshot as unknown as IdeaGenerationContext;
    const context = this.normalizeRecoveredContext(run.id, checkpoint);

    const input: ExecuteOwnedIdeaGenerationInput = {
      owner: context.owner,
      generationType: context.generationType,
      domainId: context.domainId,
      selectedDomains: context.selectedDomains ?? [],
      domainResolution: context.domainResolution ?? null,
      requestDescription: context.requestDescription ?? null,
      collectionPlan: context.collectionPlan ?? null,
      keywords: context.keywords,
      requestedDataSourceKeys: context.requestedDataSourceKeys,
      location: context.location,
      forceRefresh: context.forceRefresh,
    };

    return this.executePreparedRun(run.id, input, context, true);
  }

  /**
   * Starts idea generation for an authenticated registered user.
   *
   * Entitlement is not trusted merely because the caller selected
   * NORMAL_FREE or PREMIUM_CREDIT. The ENTITLEMENT_CHECK stage
   * must load the current user state and evaluate it through
   * IdeaGenerationPolicyService.
   *
   * @param input Authenticated user and validated request DTO.
   * @returns Complete pipeline result.
   */
  /**
   * Resolves the primary domain for a registered-user request.
   *
   * For cross-domain generation, the first selected domain owns collection-job
   * compatibility and idea persistence. Additional selected domains are preserved as first-class generation
   * constraints and also contribute bounded collection keywords.
   */
  private resolveDomainForUser(
    userId: string,
    dto: GenerateIdeaDto,
    collectionPlan: RequestCollectionPlan | null = null,
  ) {
    return this.domainResolutionService.resolve({
      userId,
      domainId: dto.domainIds?.[0] ?? dto.domainId,
      description: dto.description,
      keywords: this.mergeCollectionPlanKeywords(dto.keywords, collectionPlan),
      plannedDomainName: collectionPlan?.suggestedDomainName ?? undefined,
      plannedKeywords: collectionPlan
        ? [
            ...collectionPlan.searchQueries,
            ...collectionPlan.evidenceTargets,
            ...collectionPlan.intentConcepts,
          ]
        : undefined,
      language: dto.language,
    });
  }

  /**
   * Resolves the ordered cross-domain profile used by collection and AI.
   *
   * The primary domain remains the persisted Idea.domainId. The remaining
   * domains are first-class prompt constraints rather than loose keywords.
   */
  private async buildCrossDomainProfile(
    dto: GenerateIdeaDto,
    resolvedDomain: Awaited<ReturnType<DomainResolutionService['resolve']>>,
    collectionPlan: RequestCollectionPlan | null = null,
  ): Promise<{
    readonly selectedDomains: SelectedGenerationDomain[];
    readonly keywords: string[];
  }> {
    const explicitRequestedIds = [
      ...new Set(
        [
          ...(dto.domainIds ?? []),
          dto.domainId,
        ].filter((value): value is string => Boolean(value?.trim())),
      ),
    ];
    const topAutoScore = resolvedDomain.trace.candidates[0]?.score ?? 0;
    const hasCurrentIntent = Boolean(
      dto.description?.trim() ||
      (dto.keywords ?? []).some((keyword) => keyword?.trim()),
    );
    const autoIntentDomainIds =
      hasCurrentIntent && topAutoScore > 0
        ? resolvedDomain.trace.candidates
            .filter(
              (candidate) =>
                candidate.score >= 3 &&
                candidate.score >= topAutoScore * 0.2,
            )
            .slice(0, 3)
            .map((candidate) => candidate.domainId)
        : [];
    const autoPersonalizationDomainIds =
      !hasCurrentIntent && explicitRequestedIds.length === 0 && topAutoScore > 0
        ? resolvedDomain.trace.candidates
            .filter(
              (candidate) => candidate.score >= topAutoScore * 0.7,
            )
            .slice(0, 2)
            .map((candidate) => candidate.domainId)
        : [];

    const requestedIds = [
      ...new Set(
        [
          resolvedDomain.domainId,
          ...explicitRequestedIds,
          ...autoIntentDomainIds,
          ...autoPersonalizationDomainIds,
        ].filter(Boolean),
      ),
    ].slice(0, 3);

    const domains = await this.prisma.domain.findMany({
      where: { id: { in: requestedIds }, isActive: true },
      select: {
        id: true,
        name: true,
        isVisible: true,
        domainKeywords: {
          where: { language: { in: [dto.language, LanguageCode.ANY] } },
          select: { keyword: true },
          orderBy: { createdAt: 'asc' },
          take: 10,
        },
      },
    });

    const explicitRequestedIdSet = new Set(explicitRequestedIds);
    const byId = new Map(domains.map((domain) => [domain.id, domain]));
    const selectedDomains = requestedIds
      .map((id) => byId.get(id))
      .filter((domain): domain is (typeof domains)[number] => Boolean(domain))
      .filter(
        (domain) =>
          domain.isVisible || !explicitRequestedIdSet.has(domain.id),
      )
      .map((domain) => {
        const configuredKeywords = this.normalizeStringArray(
          domain.domainKeywords.map((entry) => entry.keyword),
        ).slice(0, 10);
        const effectiveSearchKeywords = this.normalizeStringArray([
          ...configuredKeywords,
          ...this.buildFallbackDomainKeywords(domain.name),
        ]).slice(0, 10);

        return {
          id: domain.id,
          name: domain.name,
          keywords: effectiveSearchKeywords,
          configuredKeywords,
          effectiveSearchKeywords,
        };
      });

    if (selectedDomains.length === 0) {
      throw new NotFoundException('No selected generation domain is active.');
    }

    const requestIntentKeywords = this.buildRequestIntentKeywords(
      dto.description,
    );
    const plannedCollectionKeywords = collectionPlan
      ? [
          ...collectionPlan.searchQueries,
          ...collectionPlan.evidenceTargets,
          ...collectionPlan.intentConcepts,
        ]
      : [];
    const userKeywords = this.normalizeStringArray(dto.keywords).slice(0, 8);
    const bridgeKeyword = selectedDomains.length > 1
      ? `coherent cross-domain workflow combining ${selectedDomains.map((domain) => domain.name).join(' and ')}`
      : selectedDomains[0].name;

    /*
     * Build the collection keyword budget in round-robin order. A simple
     * flatMap().slice() allowed the first domain to consume the whole budget,
     * leaving secondary selected domains with no search coverage.
     */
    const balancedDomainKeywords: string[] = [];
    const perDomainTerms = selectedDomains.map((domain) => [
      domain.name,
      ...domain.keywords,
    ]);
    for (let termIndex = 0; balancedDomainKeywords.length < 24; termIndex += 1) {
      let added = false;
      for (const terms of perDomainTerms) {
        const term = terms[termIndex];
        if (!term) continue;
        balancedDomainKeywords.push(term);
        added = true;
        if (balancedDomainKeywords.length >= 24) break;
      }
      if (!added) break;
    }

    return {
      selectedDomains,
      keywords: [...new Set([
        ...plannedCollectionKeywords,
        ...requestIntentKeywords,
        ...userKeywords,
        bridgeKeyword,
        ...balancedDomainKeywords,
      ])].slice(0, 36),
    };
  }

  /**
   * Runtime search vocabulary used when a selected domain has sparse or empty
   * DomainKeyword rows. These terms also feed evidence attribution, so a result
   * about checkout/orders can still be recognized as E-commerce evidence even
   * when the database has not been fully seeded yet.
   */
  private buildFallbackDomainKeywords(domainName: string): string[] {
    const normalized = domainName
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const vocabulary: Readonly<Record<string, readonly string[]>> = {
      agriculture: [
        'farming',
        'irrigation',
        'crop management',
        'soil monitoring',
        'harvest planning',
      ],
      blockchain: [
        'distributed ledger',
        'smart contract',
        'web3',
        'crypto wallet',
        'blockchain security',
      ],
      cybersecurity: [
        'unauthorized access',
        'data breach',
        'suspicious activity',
        'security alerts',
        'threat detection',
        'incident response',
        'authentication security',
        'identity access',
        'access control',
        'ransomware',
      ],
      'artificial intelligence': [
        'artificial intelligence',
        'ai',
        'ai model',
        'ai chatbot',
        'ai application',
        'ai assistant',
        'generative ai',
        'machine learning',
        'large language model',
        'ai automation',
      ],
      'e commerce': [
        'checkout',
        'shopping cart',
        'order management',
        'seller marketplace',
        'refund workflow',
      ],
      ecommerce: [
        'checkout',
        'shopping cart',
        'order management',
        'seller marketplace',
        'refund workflow',
      ],
      energy: [
        'electricity',
        'solar',
        'energy consumption',
        'power grid',
        'battery monitoring',
      ],
      education: [
        'student homework',
        'assignment submission',
        'teacher feedback',
        'coursework',
        'grading workflow',
      ],
      finance: [
        'invoice',
        'expense management',
        'budget',
        'payroll',
        'reconciliation',
      ],
      healthcare: [
        'patient',
        'clinical workflow',
        'medical record',
        'appointment',
        'care coordination',
      ],
      government: [
        'government services',
        'citizen portal',
        'public administration',
        'government forms',
        'permit application',
        'public sector workflow',
      ],
      'hr recruitment': [
        'recruitment',
        'hiring',
        'applicant tracking',
        'candidate screening',
        'interview scheduling',
        'employee onboarding',
        'talent acquisition',
        'job application',
        'employee burnout',
        'employee turnover',
        'workforce retention',
        'employee feedback',
        'workload management',
      ],
      'human resources': [
        'recruitment',
        'hiring',
        'employee burnout',
        'employee turnover',
        'workforce retention',
        'employee feedback',
        'hr records',
        'workload management',
      ],
      'business operations': [
        'administrative workflow',
        'back office operations',
        'approval workflow',
        'office administration',
        'repetitive administrative tasks',
        'operational data',
        'workflow bottleneck',
        'process automation',
      ],
      'tailoring custom apparel': [
        'tailoring',
        'tailor shop',
        'custom clothing',
        'customer measurements',
        'fabric selection',
        'alteration requests',
        'fitting appointments',
        'design notes',
        'custom order tracking',
        'made to measure',
      ],
      tailoring: [
        'tailoring',
        'tailor shop',
        'custom clothing',
        'customer measurements',
        'fabric selection',
        'alteration requests',
        'fitting appointments',
        'design notes',
        'custom order tracking',
      ],
      environment: [
        'environmental monitoring',
        'waste management',
        'pollution monitoring',
        'sustainability',
        'environmental compliance',
      ],
      'food restaurants': [
        'restaurant operations',
        'food ordering',
        'kitchen workflow',
        'table reservation',
        'food delivery',
      ],
      'internet of things': [
        'connected devices',
        'sensor monitoring',
        'device management',
        'telemetry',
        'edge computing',
      ],
      iot: [
        'connected devices',
        'sensor monitoring',
        'device management',
        'telemetry',
        'edge computing',
      ],
      legaltech: [
        'legal documents',
        'contract management',
        'case management',
        'compliance workflow',
        'legal research',
      ],
      logistics: [
        'shipment tracking',
        'warehouse management',
        'last mile delivery',
        'fleet routing',
        'inventory logistics',
      ],
      manufacturing: [
        'production planning',
        'quality control',
        'predictive maintenance',
        'factory automation',
        'manufacturing supply chain',
        'machine energy consumption',
        'industrial equipment telemetry',
        'idle equipment energy waste',
      ],
      'book club reading group management': [
        'book club reading schedule',
        'member reading progress tracking',
        'book club meeting coordination',
        'discussion topic history',
        'shared reading notes',
        'book suggestion voting',
      ],
      'recipe culinary knowledge management': [
        'saved recipe organization',
        'recipe ingredient substitutions',
        'personal recipe changes',
        'cooking result history',
        'family recipe preferences',
        'recipe search and retrieval',
        'recipe version history',
        'cooking notes consolidation',
      ],
      'travel planning comparison': [
        'travel accommodation price comparison',
        'booking platform comparison',
        'activity availability',
        'transportation options',
        'travel reviews',
        'traveler preferences',
        'trip budget planning',
      ],
      'media entertainment': [
        'content creation',
        'streaming',
        'audience engagement',
        'media workflow',
        'digital publishing',
        'band rehearsal',
        'music collaboration',
        'song version management',
        'set list coordination',
        'recording version management',
      ],
      'moving home organization': [
        'moving home',
        'packed belongings',
        'room assignment',
        'moving checklist',
        'fragile item tracking',
        'moving service appointments',
        'household purchase checklist',
        'family moving coordination',
      ],
      'mental health': [
        'therapy access',
        'mental wellness',
        'counseling',
        'crisis support',
        'mood tracking',
      ],
      'real estate': [
        'property management',
        'real estate listing',
        'tenant management',
        'leasing workflow',
        'property inspection',
      ],
      'smart cities': [
        'urban mobility',
        'public infrastructure',
        'city services',
        'traffic management',
        'civic technology',
      ],
      'sports fitness': [
        'workout tracking',
        'fitness coaching',
        'sports training',
        'gym management',
        'athlete performance',
      ],
      tourism: [
        'travel planning',
        'tourist services',
        'travel booking',
        'destination management',
        'visitor experience',
      ],
      transportation: [
        'public transit',
        'route planning',
        'fleet management',
        'ticketing',
        'traffic congestion',
      ],
    };

    const configuredFallback = vocabulary[normalized];
    if (configuredFallback?.length) {
      return [...configuredFallback];
    }

    const canonicalName = domainName.replace(/\s+/gu, ' ').trim();
    if (!canonicalName) {
      return [];
    }

    return [
      `${canonicalName} workflow`,
      `${canonicalName} services`,
      `${canonicalName} operations`,
      `${canonicalName} management`,
      `${canonicalName} software`,
    ];
  }

  private resolveDomainForGuest(
    dto: GenerateGuestIdeaDto,
    collectionPlan: RequestCollectionPlan | null = null,
  ) {
    return this.domainResolutionService.resolve({
      domainId: dto.domainId,
      description: dto.description,
      keywords: this.mergeCollectionPlanKeywords(dto.keywords, collectionPlan),
      plannedDomainName: collectionPlan?.suggestedDomainName ?? undefined,
      plannedKeywords: collectionPlan
        ? [
            ...collectionPlan.searchQueries,
            ...collectionPlan.evidenceTargets,
            ...collectionPlan.intentConcepts,
          ]
        : undefined,
      language: dto.language,
    });
  }

  /**
   * Converts resolver diagnostics into context-safe JSON metadata.
   * Candidate diagnostics may already have been consumed by the orchestrator
   * to expand a bounded cross-domain search profile; this persisted copy is
   * explainability metadata for downstream observability.
   */
  private buildDomainResolutionTrace(
    resolvedDomain: Awaited<ReturnType<DomainResolutionService['resolve']>>,
  ): IdeaGenerationDomainResolutionTrace {
    return {
      source: resolvedDomain.source,
      confidence: resolvedDomain.confidence,
      selectedDomain: {
        id: resolvedDomain.domainId,
        name: resolvedDomain.domainName,
      },
      matchedInterests: [...resolvedDomain.trace.matchedInterests],
      reasons: [...resolvedDomain.trace.reasons],
      candidates: resolvedDomain.trace.candidates.map((candidate) => ({
        domainId: candidate.domainId,
        domainName: candidate.domainName,
        score: candidate.score,
        reasons: [...candidate.reasons],
      })),
    };
  }

  private async planRequestCollection(input: {
    readonly description?: string | null;
    readonly keywords?: readonly string[];
    readonly generationType: IdeaGenerationType;
    readonly userId?: string;
    readonly guestSessionId?: string;
  }): Promise<RequestCollectionPlan | null> {
    const description = this.normalizeOptionalValue(input.description ?? undefined);
    if (!description) {
      return null;
    }

    return this.requestCollectionPlanningService.plan({
      description,
      keywords: input.keywords ?? [],
      generationType: input.generationType,
      userId: input.userId,
      guestSessionId: input.guestSessionId,
    });
  }

  private mergeCollectionPlanKeywords(
    keywords: readonly string[] | undefined,
    collectionPlan: RequestCollectionPlan | null,
  ): string[] {
    return this.uniqueNormalizedStrings([
      ...(collectionPlan?.intentConcepts ?? []),
      ...(collectionPlan?.evidenceTargets ?? []),
      ...(keywords ?? []),
    ]).slice(0, 24);
  }

  private buildPlannedRequestKeywords(
    description: string | null | undefined,
    keywords: readonly string[] | undefined,
    collectionPlan: RequestCollectionPlan | null,
  ): string[] {
    const planned = this.uniqueNormalizedStrings([
      ...(collectionPlan?.searchQueries ?? []),
      ...(collectionPlan?.evidenceTargets ?? []),
      ...(collectionPlan?.intentConcepts ?? []),
    ]);

    if (planned.length > 0) {
      return this.uniqueNormalizedStrings([
        ...planned,
        ...(keywords ?? []),
      ]).slice(0, 30);
    }

    return this.uniqueNormalizedStrings([
      ...(keywords ?? []),
      ...this.extractRequestSearchPhrases(description ?? ''),
    ]).slice(0, 24);
  }

  private uniqueNormalizedStrings(values: readonly string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const raw of values) {
      if (typeof raw !== 'string') continue;
      const value = raw.replace(/\s+/gu, ' ').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }

    return result;
  }

  private extractRequestSearchPhrases(description: string): string[] {
    const words = description
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length >= 4);
    const phrases: string[] = [];

    for (let index = 0; index < words.length - 2 && phrases.length < 8; index += 2) {
      phrases.push(words.slice(index, index + 4).join(' '));
    }

    return phrases;
  }

  async generateForUser(
    input: GenerateRegisteredIdeaInput,
  ): Promise<IdeaGenerationPipelineResult> {
    const userId = this.normalizeRequiredValue(input.userId, 'User ID');
    /*
     * Entitlement lookup and domain resolution are independent database reads.
     * Run them together so personalization/domain inference does not add a
     * sequential database round-trip to the hot generation path.
     */
    const collectionPlanPromise = this.planRequestCollection({
      description: input.dto.description,
      keywords: input.dto.keywords,
      generationType: input.dto.generationType,
      userId,
    });
    const [policy, collectionPlan] = await Promise.all([
      this.resolveUserQueuePolicy(userId, input.dto.generationType),
      collectionPlanPromise,
    ]);
    const resolvedDomain = await this.resolveDomainForUser(
      userId,
      input.dto,
      collectionPlan,
    );

    const owner: IdeaOwner = {
      type: IDEA_OWNER_TYPES.USER,
      userId,
    };
    const domainProfile = await this.buildCrossDomainProfile(
      input.dto,
      resolvedDomain,
      collectionPlan,
    );

    return this.executeOwnedGeneration({
      owner,

      generationType: policy.generationType,

      domainId: resolvedDomain.domainId,

      selectedDomains: domainProfile.selectedDomains,

      domainResolution: this.buildDomainResolutionTrace(resolvedDomain),

      requestDescription: this.normalizeOptionalValue(input.dto.description),

      collectionPlan,

      keywords: domainProfile.keywords,

      requestedDataSourceKeys: [],

      forceRefresh: input.dto.forceRefresh ?? false,

      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),

        city: this.normalizeOptionalValue(input.dto.city),

        region: this.normalizeOptionalValue(input.dto.region),

        radiusKm: input.dto.radiusKm ?? null,

        language: input.dto.language,
      },
    });
  }

  /**
   * Starts the single guest-free generation available to a guest
   * session.
   *
   * The guest session is resolved before creating the generation
   * run because its internal identifier is required as the run
   * owner.
   *
   * Resolving the available session at this boundary also rejects:
   * - Missing session tokens.
   * - Unknown guest sessions.
   * - Expired guest sessions.
   * - Sessions that already consumed generation.
   *
   * The entitlement stage must still evaluate the guest policy
   * using current database state before persistence.
   *
   * @param input Guest-session token and validated request DTO.
   * @returns Complete pipeline result.
   */
  async generateForGuest(
    input: GenerateGuestIdeaInput,
  ): Promise<IdeaGenerationPipelineResult> {
    const guestSession = await this.guestSessionService.resolveAvailableSession(
      input.guestSessionToken,
    );

    const owner: IdeaOwner = {
      type: IDEA_OWNER_TYPES.GUEST,
      guestSessionId: guestSession.id,
    };
    const collectionPlan = await this.planRequestCollection({
      description: input.dto.description,
      keywords: input.dto.keywords,
      generationType: IdeaGenerationType.GUEST_FREE,
      guestSessionId: guestSession.id,
    });
    const resolvedDomain = await this.resolveDomainForGuest(
      input.dto,
      collectionPlan,
    );

    return this.executeOwnedGeneration({
      owner,

      generationType: IdeaGenerationType.GUEST_FREE,

      domainId: resolvedDomain.domainId,

      selectedDomains: [],

      domainResolution: this.buildDomainResolutionTrace(resolvedDomain),

      requestDescription: this.normalizeOptionalValue(input.dto.description),

      collectionPlan,

      keywords: this.buildPlannedRequestKeywords(
        input.dto.description,
        input.dto.keywords,
        collectionPlan,
      ),

      requestedDataSourceKeys: [],

      forceRefresh: input.dto.forceRefresh ?? false,

      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),

        city: this.normalizeOptionalValue(input.dto.city),

        region: this.normalizeOptionalValue(input.dto.region),

        radiusKm: input.dto.radiusKm ?? null,

        language: input.dto.language,
      },
    });
  }

  /**
   * Accepts an authenticated generation request and returns its run ID
   * immediately. The pipeline continues asynchronously and exposes progress
   * through IdeaGenerationRunsController.
   */
  async queueForUser(
    input: GenerateRegisteredIdeaInput,
  ): Promise<QueuedIdeaGenerationResult> {
    const userId = this.normalizeRequiredValue(input.userId, 'User ID');

    /*
     * Reject unavailable premium/free requests before a queued run is created.
     * The pipeline entitlement stage still performs the same validation again
     * to protect against balance changes between queue acceptance and execution.
     */
    const collectionPlanPromise = this.planRequestCollection({
      description: input.dto.description,
      keywords: input.dto.keywords,
      generationType: input.dto.generationType,
      userId,
    });
    const [policy, collectionPlan] = await Promise.all([
      this.resolveUserQueuePolicy(userId, input.dto.generationType),
      collectionPlanPromise,
    ]);
    const resolvedDomain = await this.resolveDomainForUser(
      userId,
      input.dto,
      collectionPlan,
    );
    const domainProfile = await this.buildCrossDomainProfile(
      input.dto,
      resolvedDomain,
      collectionPlan,
    );

    return this.queueOwnedGeneration({
      owner: { type: IDEA_OWNER_TYPES.USER, userId },
      generationType: policy.generationType,
      domainId: resolvedDomain.domainId,
      selectedDomains: domainProfile.selectedDomains,
      domainResolution: this.buildDomainResolutionTrace(resolvedDomain),
      requestDescription: this.normalizeOptionalValue(input.dto.description),
      collectionPlan,
      keywords: domainProfile.keywords,
      requestedDataSourceKeys: [],
      forceRefresh: input.dto.forceRefresh ?? false,
      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),
        city: this.normalizeOptionalValue(input.dto.city),
        region: this.normalizeOptionalValue(input.dto.region),
        radiusKm: input.dto.radiusKm ?? null,
        language: input.dto.language,
      },
    });
  }

  /**
   * Performs a lightweight entitlement preflight before creating a queued run.
   *
   * This avoids returning HTTP 202 for a request that is already known to be
   * impossible, such as premium generation with a zero credit balance. The
   * entitlement stage remains authoritative and validates the state again when
   * the pipeline starts.
   */
  private async resolveUserQueuePolicy(
    userId: string,
    requestedGenerationType: Exclude<
      IdeaGenerationType,
      typeof IdeaGenerationType.GUEST_FREE
    >,
  ): Promise<IdeaGenerationPolicy> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      select: {
        id: true,
        role: true,
        userType: true,
        accountStatus: true,
        isActive: true,
        isVerified: true,
        creditBalance: true,
        freeGenerationLimit: true,
        freeGenerationsUsed: true,
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_REQUEST,
        message: 'The registered generation owner was not found.',
      });
    }

    return this.policyService.evaluate({
      ownerType: IDEA_OWNER_TYPES.USER,
      requestedGenerationType,
      user,
    });
  }

  /** Accepts a guest generation request and returns its run ID immediately. */
  async queueForGuest(
    input: GenerateGuestIdeaInput,
  ): Promise<QueuedIdeaGenerationResult> {
    const guestSession = await this.guestSessionService.resolveAvailableSession(
      input.guestSessionToken,
    );
    const collectionPlan = await this.planRequestCollection({
      description: input.dto.description,
      keywords: input.dto.keywords,
      generationType: IdeaGenerationType.GUEST_FREE,
      guestSessionId: guestSession.id,
    });
    const resolvedDomain = await this.resolveDomainForGuest(
      input.dto,
      collectionPlan,
    );

    return this.queueOwnedGeneration({
      owner: {
        type: IDEA_OWNER_TYPES.GUEST,
        guestSessionId: guestSession.id,
      },
      generationType: IdeaGenerationType.GUEST_FREE,
      domainId: resolvedDomain.domainId,
      selectedDomains: [],
      domainResolution: this.buildDomainResolutionTrace(resolvedDomain),
      requestDescription: this.normalizeOptionalValue(input.dto.description),
      collectionPlan,
      keywords: this.buildPlannedRequestKeywords(
        input.dto.description,
        input.dto.keywords,
        collectionPlan,
      ),
      requestedDataSourceKeys: [],
      forceRefresh: input.dto.forceRefresh ?? false,
      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),
        city: this.normalizeOptionalValue(input.dto.city),
        region: this.normalizeOptionalValue(input.dto.region),
        radiusKm: input.dto.radiusKm ?? null,
        language: input.dto.language,
      },
    });
  }

  /**
   * Creates a queued run and schedules execution outside the HTTP request.
   *
   * The PostgreSQL owner lock still protects multi-instance deployments.
   * For very large deployments this dispatcher can later be replaced by
   * BullMQ without changing controllers or pipeline stages.
   */
  private async queueOwnedGeneration(
    input: ExecuteOwnedIdeaGenerationInput,
  ): Promise<QueuedIdeaGenerationResult> {
    const runId = randomUUID();
    const initialContext = this.buildInitialContext(runId, input);

    /*
     * Persist the normalized request context in the same INSERT that creates
     * the QUEUED run. If the process stops before setImmediate() executes, the
     * recovery service still has everything required to restart the pipeline.
     */
    const run = await this.runService.createRun({
      id: runId,
      ...(input.owner.type === IDEA_OWNER_TYPES.USER
        ? { userId: input.owner.userId }
        : { guestSessionId: input.owner.guestSessionId }),
      generationType: input.generationType,
      contextSnapshot: this.serializeContextSnapshot(initialContext),
    });

    setImmediate(() => {
      void this.executePreparedRun(
        run.id,
        input,
        initialContext,
        false,
      ).catch((error: unknown) => {
        const normalized = this.normalizeError(error);
        this.logger.error(
          `Queued idea-generation run "${run.id}" failed: ${normalized.message}`,
          normalized.stack,
        );
      });
    });

    return {
      runId: run.id,
      status: run.status,
      progressPercent: run.progressPercent,
    };
  }

  /**
   * Creates and executes an owner-specific generation workflow.
   *
   * The run is created before the lock is acquired because the
   * lock stores the run identifier of its owner.
   *
   * When lock acquisition fails, the newly created queued run is
   * marked as failed instead of leaving an abandoned QUEUED row.
   *
   * The lock is always released in finally after it has been
   * acquired successfully.
   *
   * @param input Resolved owner and normalized request values.
   * @returns Complete pipeline result.
   */
  private async executeOwnedGeneration(
    input: ExecuteOwnedIdeaGenerationInput,
  ): Promise<IdeaGenerationPipelineResult> {
    const runId = randomUUID();
    const initialContext = this.buildInitialContext(runId, input);

    const run = await this.runService.createRun({
      id: runId,
      ...(input.owner.type === IDEA_OWNER_TYPES.USER
        ? { userId: input.owner.userId }
        : { guestSessionId: input.owner.guestSessionId }),
      generationType: input.generationType,
      contextSnapshot: this.serializeContextSnapshot(initialContext),
    });

    return this.executePreparedRun(
      run.id,
      input,
      initialContext,
      false,
    );
  }

  /** Executes a previously created queued run. */
  private async executePreparedRun(
    runId: string,
    input: ExecuteOwnedIdeaGenerationInput,
    preparedContext?: IdeaGenerationContext,
    resumeFromCheckpoint = false,
  ): Promise<IdeaGenerationPipelineResult> {
    let lockAcquired = false;

    try {
      await this.lockService.acquire({ owner: input.owner, runId });
      lockAcquired = true;
      this.activeRuns.set(runId, input.owner);
      this.startRunHeartbeat(runId, input.owner);

      const context =
        preparedContext ?? this.buildInitialContext(runId, input);
      this.logger.log(`Starting idea-generation pipeline for run "${runId}".`);

      const result = await this.pipelineService.executePipeline({
        context,
        stages: this.stages,
        resumeFromCheckpoint,
      });

      this.logger.log(
        `Idea-generation orchestration completed for run "${runId}".`,
      );

      return result;
    } catch (error: unknown) {
      const normalizedError = this.normalizeError(error);
      await this.persistUnfinishedRunFailure(runId, normalizedError);

      this.logger.error(
        `Idea-generation orchestration failed for run "${runId}": ${normalizedError.message}`,
        normalizedError.stack,
      );

      throw error;
    } finally {
      this.stopRunHeartbeat(runId);
      this.activeRuns.delete(runId);

      if (lockAcquired) {
        await this.releaseLockSafely(input.owner, runId);
      }
    }
  }

  /**
   * Builds the empty context supplied to the first pipeline
   * stage.
   *
   * Policy, selected sources, collection data, NLP output, prompt,
   * AI output and persisted idea identifiers remain empty until
   * their corresponding pipeline stages complete.
   *
   * @param runId Persisted generation-run identifier.
   * @param input Normalized generation request.
   * @returns Initialized generation context.
   */
  private buildInitialContext(
    runId: string,
    input: ExecuteOwnedIdeaGenerationInput,
  ): IdeaGenerationContext {
    return createIdeaGenerationContext({
      runId,
      owner: input.owner,

      generationType: input.generationType,

      domainId: input.domainId,

      selectedDomains: input.selectedDomains,

      domainResolution: input.domainResolution,

      requestDescription: input.requestDescription,

      collectionPlan: input.collectionPlan,

      keywords: input.keywords,

      requestedDataSourceKeys: input.requestedDataSourceKeys,

      location: input.location,

      forceRefresh: input.forceRefresh,
    });
  }

  /**
   * Normalizes a durable checkpoint before it is passed back into the pipeline.
   *
   * Older run snapshots may predate fields that are required by the current
   * in-memory context shape. JSON persistence can also turn Date values into
   * strings. Normalizing here gives every resumed stage the same invariants as
   * a newly created generation context.
   */
  private normalizeRecoveredContext(
    runId: string,
    checkpoint: IdeaGenerationContext,
  ): IdeaGenerationContext {
    const selectedDomains = this.normalizeRecoveredSelectedDomains(checkpoint);

    return {
      ...checkpoint,
      runId,
      domainName: checkpoint.domainName ?? null,
      selectedDomains,
      domainResolution: checkpoint.domainResolution ?? null,
      requestDescription: this.normalizeOptionalValue(
        checkpoint.requestDescription ?? undefined,
      ),
      collectionPlan: checkpoint.collectionPlan ?? null,
      keywords: this.normalizeRecoveredStringArray(checkpoint.keywords),
      requestedDataSourceKeys: this.normalizeRecoveredStringArray(
        checkpoint.requestedDataSourceKeys,
      ),
      forceRefresh: checkpoint.forceRefresh === true,
      policy: checkpoint.policy ?? null,
      selectedDataSources: Array.isArray(checkpoint.selectedDataSources)
        ? checkpoint.selectedDataSources
        : [],
      collection: checkpoint.collection ?? null,
      nlp: checkpoint.nlp ?? null,
      domainEvidence: Array.isArray(checkpoint.domainEvidence)
        ? checkpoint.domainEvidence
        : [],
      communityAiAnalysis: checkpoint.communityAiAnalysis ?? null,
      opportunityRanking: checkpoint.opportunityRanking ?? null,
      benchmarkWinnerOpportunity:
        checkpoint.benchmarkWinnerOpportunity ?? null,
      benchmarkCandidates: Array.isArray(checkpoint.benchmarkCandidates)
        ? checkpoint.benchmarkCandidates
        : [],
      evidenceRecoveryAttempts:
        typeof checkpoint.evidenceRecoveryAttempts === 'number' &&
        Number.isFinite(checkpoint.evidenceRecoveryAttempts) &&
        checkpoint.evidenceRecoveryAttempts >= 0
          ? Math.floor(checkpoint.evidenceRecoveryAttempts)
          : 0,
      evidenceRecoveryCollectionJobIds: this.normalizeRecoveredStringArray(
        checkpoint.evidenceRecoveryCollectionJobIds,
      ),
      noResultOutcome: checkpoint.noResultOutcome ?? null,
      prompt: checkpoint.prompt ?? null,
      coreIdea: checkpoint.coreIdea ?? null,
      ideaId: checkpoint.ideaId ?? null,
      advancedOutputs: Array.isArray(checkpoint.advancedOutputs)
        ? checkpoint.advancedOutputs
        : [],
      generatedOutputIdsByKey: this.normalizeRecoveredOutputIds(
        checkpoint.generatedOutputIdsByKey,
      ),
      cancellationRequested: checkpoint.cancellationRequested === true,
      recoveryCheckpointStageKey:
        typeof checkpoint.recoveryCheckpointStageKey === 'string' &&
        checkpoint.recoveryCheckpointStageKey.trim().length > 0
          ? checkpoint.recoveryCheckpointStageKey
          : this.inferRecoveryCheckpointStageKey({
              ...checkpoint,
              selectedDomains,
            }),
      createdAt: this.normalizeRecoveredDate(checkpoint.createdAt),
    };
  }

  /**
   * Restores the ordered selected-domain list from legacy checkpoints.
   *
   * The selectedDomains field was added after the original single-domain
   * generation flow. When an older checkpoint does not contain it, the primary
   * resolved domain is reconstructed when its name is already known. If the
   * name has not been resolved yet, DATA_SOURCE_SELECTION will populate it.
   */
  private normalizeRecoveredSelectedDomains(
    checkpoint: IdeaGenerationContext,
  ): SelectedGenerationDomain[] {
    const rawDomains = Array.isArray(checkpoint.selectedDomains)
      ? checkpoint.selectedDomains
      : [];

    const normalizedDomains = rawDomains.flatMap((domain) => {
      if (!domain || typeof domain !== 'object') {
        return [];
      }

      const id = typeof domain.id === 'string' ? domain.id.trim() : '';
      const name = typeof domain.name === 'string' ? domain.name.trim() : '';

      if (!id || !name) {
        return [];
      }

      const keywords = this.normalizeRecoveredStringArray(domain.keywords);
      const configuredKeywords = this.normalizeRecoveredStringArray(
        domain.configuredKeywords,
      );
      const effectiveSearchKeywords = this.normalizeRecoveredStringArray(
        domain.effectiveSearchKeywords,
      );

      return [
        {
          id,
          name,
          keywords:
            effectiveSearchKeywords.length > 0
              ? effectiveSearchKeywords
              : keywords,
          configuredKeywords,
          effectiveSearchKeywords:
            effectiveSearchKeywords.length > 0
              ? effectiveSearchKeywords
              : keywords,
        },
      ];
    });

    if (normalizedDomains.length > 0) {
      return normalizedDomains;
    }

    const domainId =
      typeof checkpoint.domainId === 'string' ? checkpoint.domainId.trim() : '';
    const domainName =
      typeof checkpoint.domainName === 'string'
        ? checkpoint.domainName.trim()
        : '';

    if (!domainId || !domainName) {
      return [];
    }

    return [
      {
        id: domainId,
        name: domainName,
        keywords: [],
      },
    ];
  }

  /**
   * Converts an unknown checkpoint value into a clean string array.
   */
  private normalizeRecoveredStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const entry of value) {
      if (typeof entry !== 'string') {
        continue;
      }

      const item = entry.trim();

      if (!item || seen.has(item)) {
        continue;
      }

      seen.add(item);
      normalized.push(item);
    }

    return normalized;
  }

  /**
   * Keeps only valid persisted generated-output identifiers.
   */
  private normalizeRecoveredOutputIds(
    value: unknown,
  ): IdeaGenerationContext['generatedOutputIdsByKey'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, string> = {};

    for (const [key, rawValue] of Object.entries(value)) {
      if (typeof rawValue !== 'string') {
        continue;
      }

      const id = rawValue.trim();

      if (id) {
        result[key] = id;
      }
    }

    return result as IdeaGenerationContext['generatedOutputIdsByKey'];
  }

  /**
   * Restores a JSON-serialized checkpoint timestamp safely.
   */
  private normalizeRecoveredDate(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);

      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return new Date();
  }

  /**
   * Converts an in-memory generation context into Prisma-safe JSON.
   */
  private serializeContextSnapshot(
    context: IdeaGenerationContext,
  ): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(context)) as Prisma.InputJsonValue;
  }

  /**
   * Infers the newest safe checkpoint for rows created before the explicit
   * recoveryCheckpointStageKey field existed.
   */
  private inferRecoveryCheckpointStageKey(
    context: Partial<IdeaGenerationContext>,
  ): string | null {
    if (context.ideaId) {
      return IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE;
    }

    if (context.noResultOutcome) {
      return IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING;
    }

    if (context.coreIdea) {
      return IDEA_GENERATION_STAGE_KEYS.CORE_IDEA_GENERATION;
    }

    if (context.communityAiAnalysis) {
      return IDEA_GENERATION_STAGE_KEYS.COMMUNITY_AI_ANALYSIS;
    }

    if (context.collection) {
      return IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION;
    }

    return null;
  }

  /**
   * Starts a low-cost heartbeat for the durable run and its owner lock.
   */
  private startRunHeartbeat(runId: string, owner: IdeaOwner): void {
    this.stopRunHeartbeat(runId);

    const timer = setInterval(() => {
      if (this.heartbeatInFlight.has(runId)) {
        return;
      }

      this.heartbeatInFlight.add(runId);
      void (async () => {
        try {
          try {
            await this.runService.heartbeat(runId);
          } catch (reason) {
            const error = this.normalizeError(reason);
            this.logger.warn(
              `Generation heartbeat failed for run "${runId}": ${error.message}`,
            );
          }

          try {
            await this.lockService.refresh(owner, runId);
          } catch (reason) {
            const error = this.normalizeError(reason);
            this.logger.warn(
              `Generation lock heartbeat failed for run "${runId}": ${error.message}`,
            );
          }
        } finally {
          this.heartbeatInFlight.delete(runId);
        }
      })();
    }, this.heartbeatIntervalMs);

    timer.unref();
    this.heartbeatTimers.set(runId, timer);
  }

  /** Stops the background heartbeat associated with one local run. */
  private stopRunHeartbeat(runId: string): void {
    const timer = this.heartbeatTimers.get(runId);

    if (!timer) {
      return;
    }

    clearInterval(timer);
    this.heartbeatTimers.delete(runId);
  }

  /**
   * Persists an orchestration failure only when the run has not
   * already reached a terminal state.
   *
   * The pipeline service normally handles:
   * - FAILED runs.
   * - CANCELLED runs.
   * - COMPLETED runs.
   *
   * This fallback covers errors occurring before the pipeline's
   * own failure handler becomes active, such as:
   * - Generation-lock conflicts.
   * - Missing stage registrations.
   * - Stage-definition mismatches.
   * - Stage-record initialization failures.
   *
   * Persistence failures are logged without replacing the
   * original orchestration error.
   *
   * @param runId Generation-run identifier.
   * @param error Original orchestration error.
   */
  private async persistUnfinishedRunFailure(
    runId: string,
    error: Error,
  ): Promise<void> {
    try {
      const run = await this.runService.findRunOrThrow(runId);

      if (
        run.status !== IdeaGenerationRunStatus.QUEUED &&
        run.status !== IdeaGenerationRunStatus.RUNNING
      ) {
        return;
      }

      await this.runService.failRun({
        runId,

        errorCode: IDEA_GENERATION_ERROR_CODES.PIPELINE_FAILED,

        errorMessage: this.toSafeErrorMessage(error),
      });
    } catch (persistenceError: unknown) {
      const normalizedPersistenceError = this.normalizeError(persistenceError);

      this.logger.error(
        `Failed to persist orchestration failure for generation run "${runId}": ${normalizedPersistenceError.message}`,
        normalizedPersistenceError.stack,
      );
    }
  }

  /**
   * Releases a generation lock without replacing the original
   * pipeline result or error when cache cleanup fails.
   *
   * @param owner Generation owner.
   * @param runId Generation run that owns the lock.
   */
  private async releaseLockSafely(
    owner: IdeaOwner,
    runId: string,
  ): Promise<void> {
    try {
      await this.lockService.release({
        owner,
        runId,
      });
    } catch (error: unknown) {
      const normalizedError = this.normalizeError(error);

      this.logger.error(
        `Failed to release idea-generation lock for run "${runId}": ${normalizedError.message}`,
        normalizedError.stack,
      );
    }
  }

  /**
   * Normalizes a required string.
   *
   * @param value Raw string value.
   * @param fieldName Human-readable field name.
   * @returns Trimmed non-empty string.
   */
  private normalizeRequiredValue(value: string, fieldName: string): string {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new Error(`${fieldName} is required.`);
    }

    return normalizedValue;
  }

  /**
   * Normalizes an optional string to either a trimmed value or
   * null.
   *
   * @param value Optional raw string.
   * @returns Trimmed string or null.
   */
  private normalizeOptionalValue(value?: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue || null;
  }

  /**
   * Normalizes and deduplicates general string values.
   *
   * Original character casing is preserved because user keywords
   * may contain meaningful capitalization.
   *
   * @param values Optional values.
   * @returns Normalized unique values.
   */
  private normalizeStringArray(values?: readonly string[]): string[] {
    if (!values) {
      return [];
    }

    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private buildRequestIntentKeywords(description?: string): string[] {
    const normalized = this.normalizeOptionalValue(description);

    if (!normalized) {
      return [];
    }

    const evidenceIntent = this.stripSolutionPreferencePhrases(normalized);
    const searchableIntent = evidenceIntent || normalized;
    const aliasMap: Readonly<Record<string, string>> = {
      financial: 'finance',
      finances: 'finance',
      administration: 'administrative operations',
      administrative: 'administrative operations',
      company: 'business operations',
      companies: 'business operations',
      invoicing: 'invoice',
      invoices: 'invoice',
      expenses: 'expense',
      budgeting: 'budget',
      payrolls: 'payroll',
      reconciliations: 'reconciliation',
      procurements: 'procurement',
      employees: 'employee',
      workers: 'workforce',
      recruiting: 'recruitment',
      recruiters: 'recruitment',
      turnover: 'employee turnover',
      burnout: 'employee burnout',
      costs: 'cost',
      spending: 'expense',
      records: 'record',
      feedbacks: 'feedback',
      breaches: 'data breach',
      threats: 'security threat',
      alerts: 'security alert',
      attacks: 'cyber attack',
      incidents: 'security incident',
      credentials: 'credential security',
      vulnerabilities: 'security vulnerability',
      fabrics: 'fabric selection',
      alterations: 'alteration requests',
      fittings: 'fitting appointments',
      garments: 'garment',
      clothes: 'clothing',
      wardrobes: 'wardrobe',
      closets: 'closet',
      outfits: 'outfit',
      shoes: 'footwear',
      accessories: 'accessory',
      receipts: 'receipt',
      repairs: 'repair',
      bands: 'band',
      musicians: 'musician',
      rehearsals: 'rehearsal',
      recordings: 'recording',
      songs: 'song',
      setlists: 'set list',
      checklists: 'checklist',
      fields: 'field',
      crops: 'crop',
      forecasts: 'forecast',
    };

    const stopWords = new Set([
      'a',
      'an',
      'and',
      'are',
      'at',
      'be',
      'by',
      'for',
      'from',
      'in',
      'is',
      'it',
      'of',
      'on',
      'or',
      'the',
      'to',
      'with',
      'issue',
      'issues',
      'problem',
      'problems',
      'ai',
      'enhance',
      'enhanced',
      'enhancement',
      'improve',
      'improved',
      'improvement',
      'optimize',
      'optimized',
      'optimization',
      'often',
      'usually',
      'frequently',
      'commonly',
      'struggle',
      'struggles',
      'struggling',
      'keep',
      'keeps',
      'keeping',
      'need',
      'needs',
      'want',
      'wants',
      'difficult',
      'difficulty',
      'multiple',
      'several',
      'different',
      'shared',
      'manage',
      'manages',
      'managing',
      'large',
      'small',
      'numbers',
      'still',
      'remember',
      'what',
      'they',
      'their',
      'have',
      'only',
      'usually',
      'kept',
      'information',
      'specific',
      'leading',
    ]);

    const tokens = searchableIntent
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const normalizedContentTokens = tokens
      .filter((token) => !stopWords.has(token))
      .flatMap((token) => (aliasMap[token] ?? token).split(/\s+/u))
      .filter((token) => token.length >= 3 && !stopWords.has(token));

    const phraseCandidates: string[] = [];
    for (const width of [3, 2]) {
      for (let index = 0; index <= normalizedContentTokens.length - width; index += 1) {
        const phrase = normalizedContentTokens
          .slice(index, index + width)
          .join(' ')
          .trim();
        if (phrase) phraseCandidates.push(phrase);
      }
    }

    const compactSearchableIntent =
      searchableIntent.split(/\s+/u).filter(Boolean).length <= 8
        ? searchableIntent
        : null;
    const terms = [
      ...(compactSearchableIntent ? [compactSearchableIntent] : []),
      ...phraseCandidates,
      ...normalizedContentTokens,
    ];

    const hasAdministrationIntent = tokens.some((token) =>
      ['administration', 'administrative', 'operations', 'company'].includes(token),
    );
    const hasFinanceIntent = tokens.some((token) =>
      ['finance', 'financial', 'accounting', 'budget', 'invoice', 'expense', 'expenses', 'cost', 'costs', 'payroll', 'procurement', 'reconciliation'].includes(token),
    );
    const hasExplicitHrIntent =
      /\b(?:human resources|\bhr\b|recruitment|recruiting|hiring|talent acquisition|candidate screening|applicant tracking|employee onboarding)\b/iu.test(
        searchableIntent,
      );
    const hasWorkforcePainIntent =
      /\b(?:employee|employees|workforce|staff)\b/iu.test(searchableIntent) &&
      /\b(?:burnout|turnover|retention|workload|wellbeing|well-being|engagement|performance review|employee feedback|staffing shortage|recruitment|hiring|onboarding)\b/iu.test(
        searchableIntent,
      );
    const hasHrIntent = hasExplicitHrIntent || hasWorkforcePainIntent;
    const hasCybersecurityIntent =
      /\b(?:cybersecurity|cyber security|security|unauthori[sz]ed access|data breach|security breach|suspicious activity|security alert|threat|attack|incident response|malware|ransomware|phishing|vulnerab|credential|access control|privacy)\w*\b/iu.test(
        searchableIntent,
      );
    const hasHealthcareIntent =
      /\b(?:healthcare|health|medical|clinic|hospital|patient)\w*\b/iu.test(
        searchableIntent,
      );
    const hasEarlyDetectionIntent =
      /\b(?:detect|identify|spot|discover|predict|early|emerging|warning|anomaly|trend)\w*\b/iu.test(searchableIntent);
    const hasDataAnalysisIntent =
      /\b(?:data|feedback|record|records|insight|insights|analy[sz]|analytics|scattered|fragmented)\w*\b/iu.test(searchableIntent);
    const hasWardrobeIntent =
      /\b(?:wardrobe|closet|clothes|clothing|shoes|footwear|accessories|outfit|outfits)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:inventory|remember|fit|fits|sizing|cleaning|laundry|repair|maintenance|photos?|receipts?|duplicate purchases?|unused items?|occasion|weather|outfit|coordinate|coordination)\b/iu.test(
        searchableIntent,
      );
    const hasLaundryOperationsIntent =
      /\b(?:laundry shop|laundry shops|laundromat|laundromats|dry cleaning|dry-cleaning|dry cleaner|dry cleaners|laundry service|garment cleaning|wash and fold)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:garments?|clothes|stains?|cleaning instructions?|pickup|pick up|deadlines?|treatment|paper tags?|lost|missing|delayed|customer disputes?|order status)\b/iu.test(
        searchableIntent,
      );
    const hasTailoringAnchor =
      /\b(?:tailor|tailoring|custom clothing|custom apparel|made[- ]to[- ]measure|bespoke|garment|fabric|alteration|fitting appointment|design notes?)\b/iu.test(
        searchableIntent,
      );
    const hasTailoringMeasurementContext =
      /\bmeasurements?\b/iu.test(searchableIntent) &&
      /\b(?:customer|client|body|clothing|garment|tailor|tailoring|fitting|size|sizing)\b/iu.test(
        searchableIntent,
      );
    const hasTailoringIntent =
      hasTailoringAnchor || hasTailoringMeasurementContext;
    const hasPetCareIntent =
      /\b(?:pet care|pet owners?|pet sitter|veterinarian|veterinary|vaccination|grooming|feeding routine|animal care|pet health)\b/iu.test(
        searchableIntent,
      );
    const hasEventPlanningIntent =
      /\b(?:wedding|weddings|private event|event planning|event coordination|venue|venues|photographer|photographers|decorator|decorators|catering|guest list|guest lists|event vendor|event vendors)\b/iu.test(
        searchableIntent,
      );
    const hasBookClubIntent =
      /\b(?:book club|book clubs|reading group|reading groups|reading circle|reading circles)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:reading schedules?|meeting dates?|member progress|discussion topics?|book suggestions?|shared notes?|reading apps?|group chats?|finished each section|missed meetings?|falling behind)\b/iu.test(
        searchableIntent,
      );
    const hasIndustrialEnergyIntent =
      /\b(?:manufacturing plants?|factories|factory|production lines?|machines?|industrial equipment)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:energy costs?|energy consumption|electricity|power consumption|idle consumption|cooling systems?|production demand|waste energy|energy waste|unusual consumption|predictive maintenance|equipment problems?|connected equipment|telemetry)\b/iu.test(
        searchableIntent,
      );
    const hasPhotographyStudioIntent =
      /\b(?:photography studio|photography studios|photo studio|photo studios|professional photographer|professional photographers|commercial photographer|commercial photographers|portrait studio|portrait studios)\b/iu.test(
        searchableIntent,
      ) ||
      (
        /\b(?:photography|photo shoot|photoshoot|photographer)\b/iu.test(searchableIntent) &&
        /\b(?:client bookings?|shot lists?|editing requests?|equipment preparation|camera gear|image selections?|delivery deadlines?|shoot schedule)\b/iu.test(
          searchableIntent,
        )
      );
    const hasSalonIntent =
      /\b(?:beauty salon|beauty salons|hair salon|hair salons|salon appointment|salon appointments|salon scheduling|stylist|stylists|hairdresser|hairdressers|barber|barbers|barbershop|nail salon|nail technician|esthetician|spa appointment|beauty services|personal care services)\b/iu.test(
        searchableIntent,
      );
    const hasMusicCollaborationIntent =
      /\b(?:band|bands|musician|musicians|rehearsal|rehearsals|song versions?|song charts?|recordings?|set lists?|setlists?|practice notes?|music collaboration)\b/iu.test(
        searchableIntent,
      );
    const hasPaymentFraudIntent =
      /\b(?:bank|banks|payment provider|payment providers|digital payment|payments?|transaction|transactions)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:fraud|fraudulent|suspicious activity|suspicious transaction|risk(?:y)? transaction|false positive|false-positive|legitimate users?|legitimate customers?|blocked unnecessarily|fraud detection|security alerts?)\b/iu.test(
        searchableIntent,
      );
    const hasRemotePatientMonitoringIntent =
      /\b(?:hospital|home[- ]care|home care|patient|patients|clinical)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:vital signs?|recovery|post[- ]discharge|after discharge|remote monitoring|patient monitoring|wearable|connected devices?|telemetry)\b/iu.test(
        searchableIntent,
      );
    const hasGovernmentRecordsIntent =
      /\b(?:government|public sector|government agency|government agencies|government department|government departments|permit|permits|official records?|public records?|citizen services?)\b/iu.test(
        searchableIntent,
      ) ||
      (
        /\b(?:license|licenses|approval|approvals)\b/iu.test(searchableIntent) &&
        /\b(?:government|agency|agencies|department|departments|public sector|citizen)\b/iu.test(
          searchableIntent,
        )
      );
    const hasLegalRecordsIntent =
      /\b(?:legal|contract|contracts|ownership records?|dispute|disputes|verification|compliance|license|licenses)\b/iu.test(
        searchableIntent,
      );
    const hasLedgerIntent =
      /\b(?:blockchain|distributed ledger|immutable|provenance|tamper|audit trail|record verification|version history)\b/iu.test(
        searchableIntent,
      );

    if (hasAdministrationIntent) {
      terms.unshift(
        'business operations',
        'administrative workflow',
        'office administration',
        'approval workflow',
        'back office operations',
      );
    }

    if (hasAdministrationIntent && hasFinanceIntent) {
      terms.unshift(
        'financial administration',
        'administrative finance',
        'finance operations',
        'back office finance',
      );
    }

    if (hasHrIntent && !hasSalonIntent) {
      terms.unshift(
        'employee burnout',
        'employee turnover',
        'workforce retention',
        'employee feedback',
        'workforce management',
        'recruitment workflow',
      );
    }

    if (hasHrIntent && hasFinanceIntent) {
      terms.unshift(
        'workforce cost analytics',
        'employee expense analysis',
        'workforce financial insights',
      );
    }

    if (hasCybersecurityIntent) {
      terms.unshift(
        'unauthorized access',
        'data breach',
        'suspicious activity',
        'security alert triage',
        'threat detection',
        'security incident response',
      );
    }

    if (hasCybersecurityIntent && hasHealthcareIntent) {
      terms.unshift(
        'healthcare cybersecurity',
        'patient data security',
        'clinical security monitoring',
      );
    }

    if (hasPaymentFraudIntent) {
      terms.unshift(
        'payment fraud detection false positives',
        'suspicious transaction risk scoring',
        'legitimate payment falsely blocked',
        'transaction behavior fraud detection',
        'fraud alert triage payment operations',
        'account behavior transaction fraud',
        'false decline fraud prevention',
        'real time payment fraud review',
      );
    }

    if (hasBookClubIntent) {
      terms.unshift(
        'book club reading schedule',
        'member reading progress tracking',
        'book club meeting coordination',
        'discussion topic history',
        'shared reading notes',
        'book suggestion voting',
        'missed meeting catch up',
        'reading group section completion',
      );
    }

    if (hasIndustrialEnergyIntent) {
      terms.unshift(
        'factory machine energy consumption',
        'idle equipment electricity waste',
        'production demand energy monitoring',
        'industrial equipment power anomaly',
        'machine energy predictive maintenance',
        'factory cooling electricity consumption',
        'connected equipment energy telemetry',
        'manufacturing energy efficiency monitoring',
      );
    }

    if (hasPhotographyStudioIntent) {
      terms.unshift(
        'photography studio operations',
        'studio client booking management',
        'photo shoot location planning',
        'shot list management',
        'photography equipment preparation',
        'editing request tracking',
        'image selection workflow',
        'client photo delivery deadlines',
      );
    }

    if (hasSalonIntent) {
      terms.unshift(
        'salon appointment scheduling conflicts',
        'stylist availability coordination',
        'salon client preference history',
        'beauty service history sharing',
        'salon product usage inventory',
        'salon loyalty history',
        'salon double booking prevention',
        'salon special request tracking',
      );
    }

    if (hasLaundryOperationsIntent) {
      terms.unshift(
        'laundry garment tracking',
        'dry cleaning special instructions tracking',
        'laundry stain treatment records',
        'laundry pickup deadline tracking',
        'lost garment prevention laundry',
        'dry cleaning order status handoff',
        'laundry paper tag replacement',
        'laundry customer dispute order traceability',
      );
    }

    if (hasWardrobeIntent) {
      terms.unshift(
        'digital wardrobe inventory',
        'clothing inventory organization',
        'closet item tracking',
        'clothing fit tracking',
        'wardrobe cleaning repair tracking',
        'outfit planning by weather occasion',
        'duplicate clothing purchase prevention',
        'wardrobe receipt photo organization',
      );
    }

    if (hasTailoringIntent) {
      terms.unshift(
        'tailor shop order management',
        'customer measurement records',
        'fabric selection tracking',
        'alteration request history',
        'fitting appointment tracking',
        'custom clothing order tracking',
        'returning customer measurements',
      );
    }

    if (hasPetCareIntent) {
      terms.unshift(
        'shared pet care coordination',
        'pet vaccination tracking',
        'pet grooming appointment tracking',
        'feeding routine coordination',
        'pet care history sharing',
        'veterinarian care history',
        'pet sitter care instructions',
      );
    }

    if (hasEventPlanningIntent) {
      terms.unshift(
        'wedding vendor coordination problems',
        'event planning booking conflicts',
        'venue photographer catering coordination',
        'guest list and event schedule tracking',
        'wedding budget unexpected expenses',
        'last minute event vendor changes',
        'private event coordination spreadsheet problems',
      );
    }

    if (hasMusicCollaborationIntent) {
      terms.unshift(
        'band rehearsal coordination',
        'song version management',
        'set list coordination',
        'recording version management',
        'rehearsal equipment checklist',
        'music collaboration workflow',
      );
    }

    if (hasRemotePatientMonitoringIntent) {
      terms.unshift(
        'remote patient monitoring after discharge',
        'home care vital signs monitoring',
        'post discharge patient deterioration alerts',
        'multi device patient vital monitoring',
        'remote patient monitoring readmission',
        'home health patient monitoring workflow',
        'clinical alert prioritization remote patients',
      );
    }

    if (hasGovernmentRecordsIntent && hasLegalRecordsIntent) {
      terms.unshift(
        'permit and license approval tracking',
        'cross-department official record verification',
        'contract and ownership record reconciliation',
        'government document status traceability',
      );
    }

    if (hasGovernmentRecordsIntent && hasLegalRecordsIntent && hasLedgerIntent) {
      terms.unshift(
        'auditable public record provenance',
        'tamper-evident approval history',
        'cross-department record version verification',
      );
    }

    if (hasEarlyDetectionIntent && hasDataAnalysisIntent) {
      terms.push(
        'early problem detection',
        'operational anomaly detection',
        'feedback trend detection',
        'management decision support',
      );
    }

    return this.normalizeStringArray(terms).slice(0, 12);
  }

  private stripSolutionPreferencePhrases(value: string): string {
    return value
      .replace(/\b(?:ai|artificial intelligence)[ -]?(?:enhance|enhanced|enhancement|powered)\b/giu, ' ')
      .replace(/\b(?:enhance|enhanced|improve|improved|optimize|optimized)\b[^.!?,;]{0,24}\b(?:with|using|by)\s+(?:ai|artificial intelligence)\b/giu, ' ')
      .replace(/\b(?:using|use|with)\s+(?:ai|artificial intelligence)\b/giu, ' ')
      .replace(/\b(?:and|or|with|using|by)\s*$/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  /**
   * Normalizes and deduplicates data-source keys.
   *
   * Source keys use lowercase kebab-case identifiers.
   *
   * @param values Optional source keys.
   * @returns Normalized unique source keys.
   */
  private normalizeSourceKeys(values?: readonly string[]): string[] {
    if (!values) {
      return [];
    }

    return [
      ...new Set(
        values.map((value) => value.trim().toLowerCase()).filter(Boolean),
      ),
    ];
  }

  /**
   * Converts an unknown thrown value into an Error instance.
   *
   * @param error Unknown thrown value.
   * @returns Normalized Error.
   */
  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    return new Error('Unknown idea-generation orchestration error.');
  }

  /**
   * Produces a bounded error message suitable for persistence.
   *
   * Stack traces remain in application logs and are not stored in
   * the run's public error-message field.
   *
   * @param error Error whose message should be persisted.
   * @returns Safe bounded error message.
   */
  private toSafeErrorMessage(error: Error): string {
    const message =
      error.message.trim() || 'Idea-generation orchestration failed.';

    return message.slice(0, 2_000);
  }
}