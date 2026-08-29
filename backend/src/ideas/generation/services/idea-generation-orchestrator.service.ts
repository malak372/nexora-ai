import {
  BadRequestException,
  ConflictException,
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
  IdeaGenerationRunHandoffError,
  type IdeaGenerationPipelineResult,
} from '../pipeline/idea-generation-pipeline.service';
import { IdeaGenerationCancelledError } from '../pipeline/idea-generation-stage.service';

import {
  createIdeaGenerationContext,
  type IdeaGenerationContext,
  type IdeaGenerationDomainResolutionTrace,
  type IdeaGenerationLocation,
  type SelectedGenerationDomain,
} from '../types/idea-generation-context.type';

import type { IdeaOwner } from '../../shared/types/idea-owner.type';
import type { RequestCollectionPlan } from '../types/request-collection-plan.type';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';

import {
  GENERATION_HEARTBEAT_INTERVAL_MS,
  IDEA_GENERATION_ERROR_CODES,
} from '../constants/idea-generation.constants';
import { IDEA_GENERATION_STAGE_KEYS } from '../constants/idea-generation-stages.constants';

import { GuestIdeaSessionService } from './guest-idea-session.service';

import { IdeaGenerationLockService } from './idea-generation-lock.service';

import { IdeaGenerationRunService } from './idea-generation-run.service';
import { DomainResolutionService } from './domain-resolution.service';
import { RequestCollectionPlanningService } from './request-collection-planning.service';
import { RequestDynamicQueryUtil } from '../utils/request-dynamic-query.util';
import { RequestTextIntegrityUtil } from '../utils/request-text-integrity.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { LanguageDetectionService } from '../../../nlp/language-detection/language-detection.service';
import { createHash, randomUUID } from 'node:crypto';

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

/** Valid UUID placeholder used only until the PREPARING pipeline stage resolves a concrete primary domain. */
const PREPARING_DOMAIN_PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

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

  requestFingerprint: string;

  /** Explicit caller-selected domains preserved until the in-pipeline PREPARING stage resolves semantic scope. */
  requestedDomainIds: string[];

  /** Ordered UI assertions paired with requestedDomainIds for UUID->name verification. */
  requestedDomainNames: string[];

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

  /** Request-content-resolved language for every human-readable generated idea value. */
  outputLanguage: LanguageCode;

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

  /** One non-overlapping run/lock heartbeat on the shared generation cadence. */
  private readonly heartbeatIntervalMs = GENERATION_HEARTBEAT_INTERVAL_MS;

  private readonly heartbeatInFlight = new Set<string>();

  constructor(
    private readonly guestSessionService: GuestIdeaSessionService,

    private readonly lockService: IdeaGenerationLockService,

    private readonly runService: IdeaGenerationRunService,

    private readonly pipelineService: IdeaGenerationPipelineService,

    private readonly domainResolutionService: DomainResolutionService,

    private readonly requestCollectionPlanningService: RequestCollectionPlanningService,

    private readonly languageDetectionService: LanguageDetectionService,

    private readonly prisma: PrismaService,

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
    /*
     * Recovery also obeys the same lifecycle contract as a fresh run: semantic
     * request planning never executes before IdeaGenerationPipelineService. If
     * PREPARING was not durably checkpointed, the pipeline simply reruns the
     * PREPARING stage from the raw request snapshot.
     */

    const input: ExecuteOwnedIdeaGenerationInput = {
      owner: context.owner,
      generationType: context.generationType,
      domainId: context.domainId,
      selectedDomains: context.selectedDomains ?? [],
      domainResolution: context.domainResolution ?? null,
      requestDescription: context.requestDescription ?? null,
      requestFingerprint:
        context.requestFingerprint ?? this.buildRecoveredRequestFingerprint(context),
      requestedDomainIds: context.requestedDomainIds ?? [],
      requestedDomainNames: context.requestedDomainNames ?? [],
      collectionPlan: context.collectionPlan ?? null,
      keywords: context.keywords,
      requestedDataSourceKeys: context.requestedDataSourceKeys,
      location: context.location,
      outputLanguage: this.resolveOutputLanguage(context.outputLanguage, context.requestDescription),
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
      plannedExistingDomainId:
        collectionPlan?.selectedExistingDomainId ?? undefined,
      plannedDomainSelectionMode:
        collectionPlan?.domainSelectionMode ?? undefined,
      plannedDomainName: collectionPlan?.suggestedDomainName ?? undefined,
      plannedDomainConfidence:
        collectionPlan?.aiUsed && !collectionPlan.fallbackUsed
          ? collectionPlan.confidence
          : undefined,
      plannedKeywords: collectionPlan
        ? [
            ...(collectionPlan.problemProfile
              ? [
                  collectionPlan.problemProfile.actor,
                  collectionPlan.problemProfile.object,
                  collectionPlan.problemProfile.coreProblem,
                  collectionPlan.problemProfile.workflow,
                  ...collectionPlan.problemProfile.failureModes,
                  ...collectionPlan.problemProfile.consequences,
                ]
              : []),
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
    if (
      dto.domainId?.trim() &&
      (dto.domainIds?.length ?? 0) > 0 &&
      dto.domainIds?.[0]?.trim() !== dto.domainId.trim()
    ) {
      throw new BadRequestException(
        'domainId must match the first domainIds entry when both are supplied.',
      );
    }
    const explicitRequestedIds = [
      ...new Set(
        (dto.domainIds && dto.domainIds.length > 0
          ? dto.domainIds
          : [dto.domainId]
        ).filter((value): value is string => Boolean(value?.trim())),
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
            .slice(0, 3)
            .map((candidate) => candidate.domainId)
        : [];

    const maximumDomainConstraints = hasCurrentIntent ? 4 : 3;
    const hasExplicitDomainSelection = explicitRequestedIds.length > 0;
    const inferredCapacity = hasExplicitDomainSelection
      ? 0
      : maximumDomainConstraints;
    const inferredIds = [
      ...new Set([
        resolvedDomain.domainId,
        ...autoIntentDomainIds,
        ...autoPersonalizationDomainIds,
      ].filter((id) => Boolean(id) && !explicitRequestedIds.includes(id))),
    ].slice(0, inferredCapacity);
    /*
     * Explicit domain selection is immutable request input. Previous behavior
     * prepended the auto-resolved domain even when domainIds were supplied,
     * which could silently replace/add a scope that the user never selected.
     * Auto inference is now used only
     * when the request contains no explicit domain id at all.
     */
    const requestedIds = hasExplicitDomainSelection
      ? explicitRequestedIds.slice(0, maximumDomainConstraints)
      : inferredIds.slice(0, maximumDomainConstraints);

    const domains = await this.prisma.domain.findMany({
      where: { id: { in: requestedIds }, isActive: true },
      select: {
        id: true,
        name: true,
        isAutoGenerated: true,
        isVisible: true,
        domainKeywords: {
          where: { language: { in: [dto.language, LanguageCode.ANY] } },
          select: { keyword: true },
          orderBy: { createdAt: 'asc' },
          take: 20,
        },
      },
    });

    const requestIntentKeywords = this.buildCollectionRequestIntentKeywords(
      dto.description,
      collectionPlan,
    );

    const byId = new Map(domains.map((domain) => [domain.id, domain]));
    const selectedDomains = requestedIds
      .map((id) => byId.get(id))
      .filter((domain): domain is (typeof domains)[number] => Boolean(domain))
      .map((domain) => {
        const persistentConfiguredKeywords = this.sanitizePersistentDomainKeywords(
          domain.name,
          this.normalizeStringArray(
            domain.domainKeywords.map((entry) => entry.keyword),
          ),
        ).slice(0, 20);
        const configuredKeywords =
          dto.description?.trim() && domain.isAutoGenerated && !domain.isVisible
            ? this.filterPersistentKeywordsForCurrentRequest(
                persistentConfiguredKeywords,
                dto.description,
              ).slice(0, 12)
            : persistentConfiguredKeywords;
        const domainRequestIntentKeywords = dto.description?.trim()
          ? this.buildDomainScopedRequestIntentKeywords({
              domainName: domain.name,
              description: dto.description,
              collectionPlan,
              configuredKeywords,
            })
          : [];
        const effectiveSearchKeywords = this.normalizeStringArray(
          dto.description?.trim()
            ? [
                ...domainRequestIntentKeywords,
                domain.name,
                ...this.filterPersistentKeywordsForCurrentRequest(
                  configuredKeywords,
                  dto.description,
                ),
              ]
            : [
                ...configuredKeywords,
                ...this.buildFallbackDomainKeywords(domain.name),
              ],
        ).slice(0, 20);

        return {
          id: domain.id,
          name: domain.name,
          keywords: effectiveSearchKeywords,
          configuredKeywords,
          requestIntentKeywords: domainRequestIntentKeywords,
          effectiveSearchKeywords,
          isExplicitlySelected: explicitRequestedIds.includes(domain.id),
        };
      });

    const selectedDomainIdSet = new Set(selectedDomains.map((domain) => domain.id));
    const missingExplicitDomainIds = explicitRequestedIds.filter(
      (id) => !selectedDomainIdSet.has(id),
    );

    if (missingExplicitDomainIds.length > 0) {
      throw new NotFoundException(
        'One or more explicitly selected generation domains are unavailable or inactive.',
      );
    }

    if (selectedDomains.length === 0) {
      throw new NotFoundException('No selected generation domain is active.');
    }

    const plannedCollectionKeywords = collectionPlan
      ? [
          ...collectionPlan.searchQueries,
          ...collectionPlan.evidenceTargets,
          ...collectionPlan.intentConcepts,
        ]
      : [];
    const userKeywords = this.normalizeStringArray(dto.keywords).slice(0, 8);
    const selectedScopeKeyword = selectedDomains[0].name;

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
    for (let termIndex = 0; balancedDomainKeywords.length < 36; termIndex += 1) {
      let added = false;
      for (const terms of perDomainTerms) {
        const term = terms[termIndex];
        if (!term) continue;
        balancedDomainKeywords.push(term);
        added = true;
        if (balancedDomainKeywords.length >= 36) break;
      }
      if (!added) break;
    }

    return {
      selectedDomains,
      keywords: [...new Set([
        ...plannedCollectionKeywords,
        ...requestIntentKeywords,
        ...userKeywords,
        selectedScopeKeyword,
        ...balancedDomainKeywords,
      ])].slice(0, 60),
    };
  }

  /**
   * Runtime search vocabulary used when a selected domain has sparse or empty
   * DomainKeyword rows. These terms also feed evidence attribution, so a result
   * about checkout/orders can still be recognized as E-commerce evidence even
   * when the database has not been fully seeded yet.
   */
  private sanitizePersistentDomainKeywords(
    domainName: string,
    keywords: readonly string[],
  ): string[] {
    const normalizedDomain = domainName
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const broadVisibleDomains = new Set([
      'transportation',
      'environment',
      'artificial intelligence',
      'cybersecurity',
      'internet of things',
      'energy',
      'government',
      'healthcare',
      'logistics',
      'food restaurants',
      'hr recruitment',
      'legaltech',
      'finance',
      'real estate',
      'agriculture',
      'e commerce',
    ]);

    if (!broadVisibleDomains.has(normalizedDomain)) {
      return this.normalizeStringArray(keywords);
    }

    const sentenceLike =
      /\b(?:often|usually|frequently|commonly|struggle|struggles|increasingly|may struggle|can lead|making it difficult|coordination or record gap|agencies reduce|providers increasingly|delayed decisions? about|become overloaded)\b/iu;
    const generatedOutcome =
      /^(?:longer journeys?|unnecessary fuel consumption|higher emissions?|delayed customer orders?|incorrect replacements?|mismatched materials?|lost details?|wasted materials?|repeated work)$/iu;

    return this.normalizeStringArray(keywords).filter((keyword) => {
      const normalized = keyword
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!normalized) return false;
      if (sentenceLike.test(normalized) || generatedOutcome.test(normalized)) {
        return false;
      }
      return normalized.split(/\s+/u).length <= 4;
    });
  }

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
      plannedExistingDomainId:
        collectionPlan?.selectedExistingDomainId ?? undefined,
      plannedDomainSelectionMode:
        collectionPlan?.domainSelectionMode ?? undefined,
      plannedDomainName: collectionPlan?.suggestedDomainName ?? undefined,
      plannedDomainConfidence:
        collectionPlan?.aiUsed && !collectionPlan.fallbackUsed
          ? collectionPlan.confidence
          : undefined,
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


  private handleActiveQueuedRun(
    activeRun: { readonly id: string; readonly status: IdeaGenerationRunStatus; readonly progressPercent: number; readonly contextSnapshot: Prisma.JsonValue | null },
    requestFingerprint: string,
  ): QueuedIdeaGenerationResult {
    const activeFingerprint = this.extractRunRequestFingerprint(
      activeRun.contextSnapshot,
    );

    if (activeFingerprint && activeFingerprint === requestFingerprint) {
      this.logger.debug(
        `Coalesced an identical generation request into active run "${activeRun.id}".`,
      );
      return {
        runId: activeRun.id,
        status: activeRun.status,
        progressPercent: activeRun.progressPercent,
      };
    }

    throw new ConflictException({
      code: 'IDEA_GENERATION_ALREADY_IN_PROGRESS',
      message:
        'A different idea-generation request is already running for this account. The new request was not merged or discarded; retry it after the active run finishes.',
      activeRunId: activeRun.id,
    });
  }

  private extractRunRequestFingerprint(
    snapshot: Prisma.JsonValue | null,
  ): string | null {
    if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object') {
      return null;
    }

    const value = (snapshot as Record<string, unknown>).requestFingerprint;
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private buildRegisteredRequestFingerprint(
    dto: GenerateIdeaDto,
    generationType: IdeaGenerationType,
  ): string {
    const description = RequestTextIntegrityUtil.normalize(dto.description).text;
    return this.hashRequestFingerprint({
      generationType,
      description: description ?? '',
      domainIds: this.normalizeExplicitDomainIds(dto.domainIds, dto.domainId),
      domainNames: this.normalizeStringArray(dto.domainNames),
      keywords: this.normalizeStringArray(dto.keywords),
      country: this.normalizeRequiredValue(dto.country, 'Country'),
      city: this.normalizeOptionalValue(dto.city) ?? '',
      region: this.normalizeOptionalValue(dto.region) ?? '',
      radiusKm: dto.radiusKm ?? null,
      language: dto.language,
      outputLanguage: this.resolveOutputLanguage(dto.outputLanguage, description),
      forceRefresh: dto.forceRefresh === true,
    });
  }

  private buildGuestRequestFingerprint(dto: GenerateGuestIdeaDto): string {
    const description = RequestTextIntegrityUtil.normalize(dto.description).text;
    return this.hashRequestFingerprint({
      generationType: IdeaGenerationType.GUEST_FREE,
      description: description ?? '',
      domainIds: this.normalizeExplicitDomainIds(undefined, dto.domainId),
      keywords: this.normalizeStringArray(dto.keywords),
      country: this.normalizeRequiredValue(dto.country, 'Country'),
      city: this.normalizeOptionalValue(dto.city) ?? '',
      region: this.normalizeOptionalValue(dto.region) ?? '',
      radiusKm: dto.radiusKm ?? null,
      language: dto.language,
      outputLanguage: this.resolveOutputLanguage(dto.outputLanguage, description),
      forceRefresh: dto.forceRefresh === true,
    });
  }

  private buildRecoveredRequestFingerprint(
    context: IdeaGenerationContext,
  ): string {
    return this.hashRequestFingerprint({
      generationType: context.generationType,
      description: context.requestDescription?.trim() ?? '',
      // Preserve the canonical requester/UI domain order in recovered-run
      // fingerprints. Sorting here made an ordered TEXT_AND_DOMAINS request
      // indistinguishable from a differently ordered request and could revive
      // a stale primary-domain identity during checkpoint recovery.
      domainIds: context.selectedDomains
        .filter((domain) => domain.isExplicitlySelected)
        .map((domain) => domain.id),
      domainNames: context.requestedDomainNames ?? [],
      keywords: this.normalizeStringArray(context.keywords),
      country: context.location.country,
      city: context.location.city ?? '',
      region: context.location.region ?? '',
      radiusKm: context.location.radiusKm,
      language: context.location.language,
      outputLanguage: this.resolveOutputLanguage(context.outputLanguage, context.requestDescription),
      forceRefresh: context.forceRefresh === true,
    });
  }

  private resolveOutputLanguage(
    _value: LanguageCode | null | undefined,
    description?: string | null,
  ): LanguageCode {
    const text = description?.normalize('NFKC').replace(/\s+/gu, ' ').trim() ?? '';
    if (!text) {
      return LanguageCode.EN;
    }

    const detected = this.languageDetectionService.detect(text);
    if (
      detected.language === LanguageCode.AR &&
      detected.confidence >= 0.35
    ) {
      return LanguageCode.AR;
    }

    const arabicLetters = (text.match(/[\u0600-\u06FF]/gu) ?? []).length;
    const latinLetters = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿĞğİıŞşÇç]/gu) ?? []).length;

    if (arabicLetters >= 3 && arabicLetters >= latinLetters) {
      return LanguageCode.AR;
    }

    return LanguageCode.EN;
  }

  private resolveRequestedDomainNameAssertions(
    dto: GenerateIdeaDto,
    requestedDomainIds: readonly string[],
  ): string[] {
    /*
     * UUIDs alone cannot prove which labels the user actually selected. Modern
     * multi-domain requests therefore echo the ordered UI names; PREPARING
     * resolves the authoritative DB rows and compares id/name pairs before any
     * collection starts. Legacy single-domain `domainId` calls stay compatible.
     */
    if (!dto.domainIds || dto.domainIds.length === 0) {
      return [];
    }

    const assertedNames = Array.isArray(dto.domainNames)
      ? dto.domainNames.map((name) =>
          typeof name === 'string' ? name.replace(/\s+/gu, ' ').trim() : '',
        )
      : [];

    /*
     * `domainNames` is an assertion channel, not the source of truth. Older
     * web/mobile clients only send UUIDs, so rejecting the request when the
     * assertion is absent turns this safety check into a breaking API change.
     * PREPARING still resolves every UUID from the authoritative domain table.
     * When a modern client supplies names, the strict ordered id/name check is
     * preserved and any mismatch is rejected before collection starts.
     */
    if (assertedNames.length === 0) {
      this.logger.warn(
        `[DOMAIN ASSERTION] No domainNames supplied for ${requestedDomainIds.length} explicit domain id(s); continuing in compatibility mode with authoritative backend UUID resolution.`,
      );
      return [];
    }

    if (
      assertedNames.length !== requestedDomainIds.length ||
      assertedNames.some((name) => !name)
    ) {
      throw new BadRequestException({
        code: 'DOMAIN_SELECTION_ASSERTION_LENGTH_MISMATCH',
        message:
          'When domainNames are supplied, they must match domainIds in the same order and length.',
        requestedDomainIds: [...requestedDomainIds],
        requestedDomainNames: assertedNames,
      });
    }

    return assertedNames;
  }

  private normalizeExplicitDomainIds(
    domainIds: readonly string[] | undefined,
    domainId: string | undefined,
  ): string[] {
    return [...new Set(
      (domainIds && domainIds.length > 0 ? domainIds : [domainId])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    )];
  }

  private hashRequestFingerprint(value: Record<string, unknown>): string {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex');
  }

  private async planRequestCollection(input: {
    readonly description?: string | null;
    readonly keywords?: readonly string[];
    readonly generationType: IdeaGenerationType;
    readonly language?: LanguageCode;
    readonly requestedDomainIds?: readonly string[];
    readonly userId?: string;
    readonly guestSessionId?: string;
  }): Promise<RequestCollectionPlan | null> {
    const description = this.normalizeOptionalValue(input.description ?? undefined);
    if (!description) {
      return null;
    }

    const plan = await this.requestCollectionPlanningService.plan({
      description,
      keywords: input.keywords ?? [],
      generationType: input.generationType,
      language: input.language,
      requestedDomainIds: input.requestedDomainIds ?? [],
      userId: input.userId,
      guestSessionId: input.guestSessionId,
    });
    this.logger.debug(
      `[PREPARING] Request/evidence plan resolved | aiUsed=${plan?.aiUsed ?? false} | fallbackUsed=${plan?.fallbackUsed ?? false} | queries=${plan?.searchQueries.length ?? 0} | sources=${plan?.selectedSourceKeys?.length ?? plan?.sourcePlans?.length ?? 0}.`,
    );
    return plan;
  }

  private filterPersistentKeywordsForCurrentRequest(
    configuredKeywords: readonly string[],
    description: string,
  ): string[] {
    const normalizedDescription = description
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!normalizedDescription) return [...configuredKeywords];

    const requestTokens = new Set(
      normalizedDescription
        .split(' ')
        .filter((token) => token.length >= 4),
    );
    const generic = new Set([
      'management', 'workflow', 'system', 'platform', 'software', 'operations',
      'business', 'service', 'services', 'tracking', 'application', 'applications',
      'workload', 'administrative', 'document', 'documents', 'customer', 'customers',
    ]);

    return configuredKeywords.filter((keyword) => {
      const normalized = keyword
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!normalized) return false;

      /*
       * Persistent domain keywords may have been learned from a previous
       * request. Never let fraud/security/anomaly vocabulary leak into a new
       * profitability or operations request merely because both share generic
       * words such as payment, finance, review, or service.
       */
      const containsRiskTemplateVocabulary =
        /\b(?:fraud|fraudulent|anomal(?:y|ies|ous)?|suspicious|abuse|scam|insurance claim|reimbursement fraud|identity risk|security alert|account compromise|predictive detection)\b/u.test(
          normalized,
        );
      const requestActuallyHasRiskIntent =
        /\b(?:fraud|fraudulent|anomal(?:y|ies|ous)?|suspicious|abuse|scam|unauthori[sz]ed|compromised|security|insurance claims?|reimbursement fraud|false positive)\b/u.test(
          normalizedDescription,
        );
      if (containsRiskTemplateVocabulary && !requestActuallyHasRiskIntent) {
        return false;
      }

      if (normalizedDescription.includes(normalized)) return true;
      const specificTokens = normalized
        .split(' ')
        .filter((token) => token.length >= 4 && !generic.has(token));
      if (specificTokens.length === 0) return false;
      const matches = specificTokens.filter((token) => requestTokens.has(token));
      return matches.length >= Math.min(2, specificTokens.length);
    });
  }

  private mergeCollectionPlanKeywords(
    keywords: readonly string[] | undefined,
    collectionPlan: RequestCollectionPlan | null,
  ): string[] {
    const profile = collectionPlan?.problemProfile;
    return this.uniqueNormalizedStrings([
      ...(profile
        ? [
            profile.actor,
            profile.object,
            profile.coreProblem,
            profile.workflow,
            ...profile.failureModes,
            ...profile.consequences,
          ]
        : []),
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
    const profile = collectionPlan?.problemProfile;
    const planned = this.uniqueNormalizedStrings([
      ...(profile
        ? [
            profile.actor,
            profile.object,
            profile.coreProblem,
            profile.workflow,
            ...profile.failureModes,
            ...profile.consequences,
          ]
        : []),
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
    const requestDescription = this.normalizeRequestDescription(
      input.dto.description,
    );
    const requestedDomainIds = this.normalizeExplicitDomainIds(
      input.dto.domainIds,
      input.dto.domainId,
    );
    const requestedDomainNames = this.resolveRequestedDomainNameAssertions(
      input.dto,
      requestedDomainIds,
    );
    const owner: IdeaOwner = { type: IDEA_OWNER_TYPES.USER, userId };
    const requestFingerprint = this.buildRegisteredRequestFingerprint(
      input.dto,
      input.dto.generationType,
    );

    return this.executeOwnedGeneration({
      owner,
      generationType: input.dto.generationType,
      domainId: requestedDomainIds[0] ?? PREPARING_DOMAIN_PLACEHOLDER_ID,
      selectedDomains: [],
      domainResolution: null,
      requestDescription,
      requestFingerprint,
      requestedDomainIds,
      requestedDomainNames,
      collectionPlan: null,
      keywords: this.normalizeStringArray(input.dto.keywords),
      requestedDataSourceKeys: [],
      forceRefresh: input.dto.forceRefresh ?? false,
      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),
        city: this.normalizeOptionalValue(input.dto.city),
        region: this.normalizeOptionalValue(input.dto.region),
        radiusKm: input.dto.radiusKm ?? null,
        language: input.dto.language,
      },
      outputLanguage: this.resolveOutputLanguage(
        input.dto.outputLanguage,
        requestDescription,
      ),
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
    const requestedDomainIds = this.normalizeExplicitDomainIds(
      undefined,
      input.dto.domainId,
    );
    const requestDescription = this.normalizeRequestDescription(
      input.dto.description,
    );
    const owner: IdeaOwner = {
      type: IDEA_OWNER_TYPES.GUEST,
      guestSessionId: guestSession.id,
    };

    return this.executeOwnedGeneration({
      owner,
      generationType: IdeaGenerationType.GUEST_FREE,
      domainId: requestedDomainIds[0] ?? PREPARING_DOMAIN_PLACEHOLDER_ID,
      selectedDomains: [],
      domainResolution: null,
      requestDescription,
      requestFingerprint: this.buildGuestRequestFingerprint(input.dto),
      requestedDomainIds,
      requestedDomainNames: [],
      collectionPlan: null,
      keywords: this.normalizeStringArray(input.dto.keywords),
      requestedDataSourceKeys: [],
      forceRefresh: input.dto.forceRefresh ?? false,
      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),
        city: this.normalizeOptionalValue(input.dto.city),
        region: this.normalizeOptionalValue(input.dto.region),
        radiusKm: input.dto.radiusKm ?? null,
        language: input.dto.language,
      },
      outputLanguage: this.resolveOutputLanguage(
        input.dto.outputLanguage,
        requestDescription,
      ),
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
    const requestDescription = this.normalizeRequestDescription(
      input.dto.description,
    );
    const requestFingerprint = this.buildRegisteredRequestFingerprint(
      input.dto,
      input.dto.generationType,
    );

    /*
     * Only duplicate-run arbitration stays at the HTTP boundary. All semantic
     * preparation, AI planning, domain resolution, and entitlement evaluation
     * now happen after IdeaGenerationPipelineService starts the run.
     */
    const activeRun = await this.runService.findActiveRunForOwner({ userId });
    if (activeRun) {
      return this.handleActiveQueuedRun(activeRun, requestFingerprint);
    }

    const requestedDomainIds = this.normalizeExplicitDomainIds(
      input.dto.domainIds,
      input.dto.domainId,
    );
    const requestedDomainNames = this.resolveRequestedDomainNameAssertions(
      input.dto,
      requestedDomainIds,
    );

    return this.queueOwnedGeneration({
      owner: { type: IDEA_OWNER_TYPES.USER, userId },
      generationType: input.dto.generationType,
      domainId: requestedDomainIds[0] ?? PREPARING_DOMAIN_PLACEHOLDER_ID,
      selectedDomains: [],
      domainResolution: null,
      requestDescription,
      requestFingerprint,
      requestedDomainIds,
      requestedDomainNames,
      collectionPlan: null,
      keywords: this.normalizeStringArray(input.dto.keywords),
      requestedDataSourceKeys: [],
      forceRefresh: input.dto.forceRefresh ?? false,
      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),
        city: this.normalizeOptionalValue(input.dto.city),
        region: this.normalizeOptionalValue(input.dto.region),
        radiusKm: input.dto.radiusKm ?? null,
        language: input.dto.language,
      },
      outputLanguage: this.resolveOutputLanguage(
        input.dto.outputLanguage,
        requestDescription,
      ),
    });
  }


  /** Accepts a guest generation request and returns its run ID immediately. */
  async queueForGuest(
    input: GenerateGuestIdeaInput,
  ): Promise<QueuedIdeaGenerationResult> {
    const guestSession = await this.guestSessionService.resolveAvailableSession(
      input.guestSessionToken,
    );
    const requestFingerprint = this.buildGuestRequestFingerprint(input.dto);
    const activeRun = await this.runService.findActiveRunForOwner({
      guestSessionId: guestSession.id,
    });
    if (activeRun) {
      return this.handleActiveQueuedRun(activeRun, requestFingerprint);
    }

    const requestedDomainIds = this.normalizeExplicitDomainIds(
      undefined,
      input.dto.domainId,
    );
    const requestDescription = this.normalizeRequestDescription(
      input.dto.description,
    );

    return this.queueOwnedGeneration({
      owner: {
        type: IDEA_OWNER_TYPES.GUEST,
        guestSessionId: guestSession.id,
      },
      generationType: IdeaGenerationType.GUEST_FREE,
      domainId: requestedDomainIds[0] ?? PREPARING_DOMAIN_PLACEHOLDER_ID,
      selectedDomains: [],
      domainResolution: null,
      requestDescription,
      requestFingerprint,
      requestedDomainIds,
      requestedDomainNames: [],
      collectionPlan: null,
      keywords: this.normalizeStringArray(input.dto.keywords),
      requestedDataSourceKeys: [],
      forceRefresh: input.dto.forceRefresh ?? false,
      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),
        city: this.normalizeOptionalValue(input.dto.city),
        region: this.normalizeOptionalValue(input.dto.region),
        radiusKm: input.dto.radiusKm ?? null,
        language: input.dto.language,
      },
      outputLanguage: this.resolveOutputLanguage(
        input.dto.outputLanguage,
        requestDescription,
      ),
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
    const runOwner =
      input.owner.type === IDEA_OWNER_TYPES.USER
        ? { userId: input.owner.userId }
        : { guestSessionId: input.owner.guestSessionId };
    const runId = randomUUID();
    const initialContext = this.buildInitialContext(runId, input);

    /*
     * Run creation and owner-lock acquisition are independent. Starting both
     * together removes the previous post-create active-run query + lock wait
     * from the normal startup path. The cache lock remains the race authority:
     * if another request wins it, the just-created loser row is cancelled and
     * the active run is returned exactly as before.
     */
    const createRunPromise = this.runService.createRun({
      id: runId,
      ...(input.owner.type === IDEA_OWNER_TYPES.USER
        ? { userId: input.owner.userId }
        : { guestSessionId: input.owner.guestSessionId }),
      generationType: input.generationType,
      contextSnapshot: this.serializeContextSnapshot(initialContext),
    });
    const acquireLockPromise = this.lockService.acquire({
      owner: input.owner,
      runId,
    });

    const [runResult, lockResult] = await Promise.allSettled([
      createRunPromise,
      acquireLockPromise,
    ]);

    if (lockResult.status === 'rejected') {
      if (runResult.status === 'fulfilled') {
        await this.runService.cancelRun(runResult.value.id).catch(() => undefined);
      }

      /*
       * The cache lock can win a few milliseconds before the winning run row
       * becomes visible through a remote PostgreSQL connection. Resolve that
       * rare collision from the lock owner first, with a tiny bounded wait only
       * on the losing request. The normal successful queue path never waits.
       */
      const lockedRunId = await this.lockService
        .getActiveRunId(input.owner)
        .catch(() => null);

      if (lockedRunId && lockedRunId !== runId) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            const lockedRun = await this.runService.findRunOrThrow(lockedRunId);
            if (
              (lockedRun.status === IdeaGenerationRunStatus.QUEUED ||
                lockedRun.status === IdeaGenerationRunStatus.RUNNING) &&
              lockedRun.cancelRequestedAt === null
            ) {
              return this.handleActiveQueuedRun(
                lockedRun,
                input.requestFingerprint,
              );
            }
          } catch {
            // The winning INSERT may still be committing on another request.
          }

          if (attempt < 4) {
            await new Promise<void>((resolve) => setTimeout(resolve, 75));
          }
        }
      }

      const queueWinner = await this.runService.findActiveRunForOwner(runOwner);
      if (queueWinner) {
        return this.handleActiveQueuedRun(
          queueWinner,
          input.requestFingerprint,
        );
      }

      throw lockResult.reason;
    }

    if (runResult.status === 'rejected') {
      await this.releaseLockSafely(input.owner, runId);
      throw runResult.reason;
    }

    const run = runResult.value;

    setImmediate(() => {
      void this.executePreparedRun(
        run.id,
        input,
        initialContext,
        false,
        true,
      ).catch((error: unknown) => {
        const normalized = this.normalizeError(error);

        if (error instanceof IdeaGenerationCancelledError) {
          this.logger.log(
            `Queued idea-generation run "${run.id}" stopped after user cancellation.`,
          );
          return;
        }

        if (error instanceof IdeaGenerationRunHandoffError) {
          this.logger.warn(
            `Queued idea-generation run "${run.id}" yielded to checkpoint recovery and remains non-terminal: ${normalized.message}`,
          );
          return;
        }

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
    lockAlreadyAcquired = false,
  ): Promise<IdeaGenerationPipelineResult> {
    let lockAcquired = lockAlreadyAcquired;

    try {
      if (!lockAlreadyAcquired) {
        await this.lockService.acquire({ owner: input.owner, runId });
        lockAcquired = true;
      }
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

      if (error instanceof IdeaGenerationCancelledError) {
        this.logger.log(
          `Idea-generation orchestration stopped normally after cancellation for run "${runId}".`,
        );
        throw error;
      }

      if (error instanceof IdeaGenerationRunHandoffError) {
        this.logger.warn(
          `Idea-generation orchestration handed run "${runId}" to checkpoint recovery without marking it failed: ${normalizedError.message}`,
        );
        throw error;
      }

      await this.persistUnfinishedRunFailure(
        runId,
        normalizedError,
        lockAcquired,
      );

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

      requestFingerprint: input.requestFingerprint,

      requestedDomainIds: input.requestedDomainIds,

      requestedDomainNames: input.requestedDomainNames,

      collectionPlan: input.collectionPlan,

      keywords: input.keywords,

      requestedDataSourceKeys: input.requestedDataSourceKeys,

      location: input.location,

      outputLanguage: input.outputLanguage,

      forceRefresh: input.forceRefresh,
    });
  }

  /**
   * Rebuilds request-scoped semantic planning for an interrupted run before
   * community analysis/ranking resumes. Persisted collector output is never
   * trusted as a semantic authority: a fresh request plan replaces stale query
   * families and request-derived hidden-domain keywords are re-scoped to the
   * current description. Already collected raw evidence is preserved intact for
   * Community AI triage; semantic rejection happens only after classification.
   * This prevents an interrupted Noise request,
   * for example, from resuming with an older waste-collection archetype.
   */
  private async refreshRecoveredRequestSemantics(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationContext> {
    const description = context.requestDescription?.trim();
    if (!description) return context;

    const checkpointStage = context.recoveryCheckpointStageKey ?? '';
    const semanticRefreshStages = new Set<string>([
      IDEA_GENERATION_STAGE_KEYS.PREPARING,
      IDEA_GENERATION_STAGE_KEYS.DATA_SOURCE_SELECTION,
      IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION,
      IDEA_GENERATION_STAGE_KEYS.DATA_COLLECTION,
      IDEA_GENERATION_STAGE_KEYS.NLP_ANALYSIS,
      IDEA_GENERATION_STAGE_KEYS.COMMUNITY_AI_ANALYSIS,
      IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING,
    ]);
    if (checkpointStage && !semanticRefreshStages.has(checkpointStage)) {
      return context;
    }

    try {
      const planningKeywords = this.buildCollectionRequestIntentKeywords(
        description,
        context.collectionPlan ?? null,
      );
      const refreshedPlan = await this.planRequestCollection({
        description,
        keywords: planningKeywords.slice(0, 8),
        generationType: context.generationType,
        language: context.location.language,
        requestedDomainIds:
          context.requestedDomainIds?.length
            ? context.requestedDomainIds
            : (context.selectedDomains ?? [])
                .filter((domain) => domain.isExplicitlySelected)
                .map((domain) => domain.id),
        userId:
          context.owner.type === IDEA_OWNER_TYPES.USER
            ? context.owner.userId
            : undefined,
        guestSessionId:
          context.owner.type === IDEA_OWNER_TYPES.GUEST
            ? context.owner.guestSessionId
            : undefined,
      });
      if (!refreshedPlan) return context;
      const requestIntentKeywords = this.buildCollectionRequestIntentKeywords(
        description,
        refreshedPlan,
      );

      const selectedDomains = context.selectedDomains.map((domain) => {
        const configuredKeywords = this.filterPersistentKeywordsForCurrentRequest(
          domain.configuredKeywords ?? [],
          description,
        ).slice(0, 12);
        const domainRequestIntentKeywords = this.buildDomainScopedRequestIntentKeywords({
          domainName: domain.name,
          description,
          collectionPlan: refreshedPlan,
          configuredKeywords,
        });
        const effectiveSearchKeywords = this.normalizeStringArray([
          ...domainRequestIntentKeywords,
          domain.name,
          ...configuredKeywords,
        ]).slice(0, 20);
        return {
          ...domain,
          keywords: effectiveSearchKeywords,
          configuredKeywords,
          requestIntentKeywords: domainRequestIntentKeywords,
          effectiveSearchKeywords,
        };
      });

      /*
       * Recovery must preserve the complete raw collector corpus. Semantic
       * classification belongs to Community AI; request guards are applied only
       * after AI labels each item. Replanning may change query language, but it
       * must never delete already collected provenance before triage.
       */
      const rawEvidenceCorpus = [...(context.rawEvidenceCorpus ?? [])];

      const keywords = this.normalizeStringArray([
        ...refreshedPlan.searchQueries,
        ...refreshedPlan.intentConcepts,
        ...refreshedPlan.evidenceTargets,
        ...requestIntentKeywords,
        ...selectedDomains.flatMap((domain) => [
          domain.name,
          ...(domain.effectiveSearchKeywords ?? []),
        ]),
      ]).slice(0, 60);

      this.logger.log(
        `Revalidated recovered request semantics for run "${context.runId}" before stage "${checkpointStage || 'unknown'}"; rawEvidence ${context.rawEvidenceCorpus?.length ?? 0}->${rawEvidenceCorpus.length}, queries=${refreshedPlan.searchQueries.length}.`,
      );

      return {
        ...context,
        collectionPlan: refreshedPlan,
        selectedDomains,
        keywords,
        rawEvidenceCorpus,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Recovered request semantic revalidation failed for run "${context.runId}"; preserving the checkpoint plan. error=${message}`,
      );
      return context;
    }
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
      requestDescription: this.normalizeRequestDescription(
        checkpoint.requestDescription ?? undefined,
      ),
      requestFingerprint:
        typeof checkpoint.requestFingerprint === 'string' &&
        checkpoint.requestFingerprint.trim().length > 0
          ? checkpoint.requestFingerprint.trim()
          : null,
      requestedDomainIds: this.normalizeRecoveredStringArray(
        checkpoint.requestedDomainIds ?? [],
      ),
      requestedDomainNames: this.normalizeRecoveredStringArray(
        checkpoint.requestedDomainNames ?? [],
      ),
      collectionPlan: checkpoint.collectionPlan ?? null,
      keywords: this.normalizeRecoveredStringArray(checkpoint.keywords),
      requestedDataSourceKeys: this.normalizeRecoveredStringArray(
        checkpoint.requestedDataSourceKeys,
      ),
      outputLanguage: this.resolveOutputLanguage(checkpoint.outputLanguage, checkpoint.requestDescription),
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
      const rawConfiguredKeywords = this.normalizeRecoveredStringArray(
        domain.configuredKeywords,
      );
      const rawEffectiveSearchKeywords = this.normalizeRecoveredStringArray(
        domain.effectiveSearchKeywords,
      );
      const recoveredDescription = this.normalizeOptionalValue(
        checkpoint.requestDescription ?? undefined,
      );
      const requestIntentKeywords = recoveredDescription
        ? this.buildRequestIntentKeywords(recoveredDescription)
        : this.normalizeRecoveredStringArray(domain.requestIntentKeywords);
      const configuredKeywords = recoveredDescription
        ? this.filterPersistentKeywordsForCurrentRequest(
            rawConfiguredKeywords,
            recoveredDescription,
          ).slice(0, 12)
        : rawConfiguredKeywords;
      const effectiveSearchKeywords = recoveredDescription
        ? this.normalizeStringArray([
            ...requestIntentKeywords,
            name,
            ...configuredKeywords,
          ]).slice(0, 20)
        : rawEffectiveSearchKeywords;

      return [
        {
          id,
          name,
          keywords:
            effectiveSearchKeywords.length > 0
              ? effectiveSearchKeywords
              : keywords,
          configuredKeywords,
          requestIntentKeywords,
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
    executionOwnershipEstablished: boolean,
  ): Promise<void> {
    try {
      const run = await this.runService.findRunOrThrow(runId);

      if (
        run.status !== IdeaGenerationRunStatus.QUEUED &&
        run.status !== IdeaGenerationRunStatus.RUNNING
      ) {
        return;
      }

      /*
       * A failed lock acquisition does not own a RUNNING durable run. Another
       * process may be executing that same run (for example after duplicate
       * queue delivery or a recovery scan). Marking it FAILED here used to let
       * the losing contender kill the healthy foreground pipeline immediately
       * before idea persistence. Only the execution that actually established
       * ownership may terminally fail a RUNNING row. A newly-created QUEUED
       * contender can still be closed normally when it never acquired a lock.
       */
      if (
        run.status === IdeaGenerationRunStatus.RUNNING &&
        !executionOwnershipEstablished
      ) {
        this.logger.warn(
          `Skipped failure mutation for generation run "${runId}" because this orchestration attempt never acquired its execution lock; another process may still own the RUNNING run.`,
        );
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

  private normalizeRequestDescription(value?: string | null): string | null {
    const normalized = RequestTextIntegrityUtil.normalize(value);
    if (normalized.repaired && normalized.text) {
      this.logger.warn(
        `Generation request text integrity repair applied (${normalized.reason}); stale text surrounding a mid-token paste was excluded before fingerprinting and pipeline planning.`,
      );
    }
    return normalized.text;
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

  /**
   * Text-bearing runs should use the AI planner's semantic vocabulary before
   * the older deterministic intent-expansion catalogue. This prevents broad
   * presets (for example generic payment-fraud or profitability phrases) from
   * becoming the shared keyword pool for every selected domain.
   */
  private buildCollectionRequestIntentKeywords(
    description: string | null | undefined,
    collectionPlan: RequestCollectionPlan | null,
  ): string[] {
    const normalized = this.normalizeOptionalValue(description ?? undefined);
    if (!normalized) return [];

    if (collectionPlan?.aiUsed && !collectionPlan.fallbackUsed) {
      return this.normalizeStringArray([
        ...collectionPlan.intentConcepts,
        ...RequestDynamicQueryUtil.extractWorkflowTerms(normalized),
        ...RequestDynamicQueryUtil.extractPainTerms(normalized),
        ...RequestDynamicQueryUtil.extractEvidenceIdentityTerms(normalized),
      ]).slice(0, 14);
    }

    return this.buildRequestIntentKeywords(normalized);
  }

  /**
   * Builds one isolated retrieval lane per selected domain without requiring a
   * hand-written rule for that domain. The lane keeps the same requester actor,
   * workflow and pain, then projects those concepts through the selected domain
   * label. Because the AI planner supplies the semantic concepts, a brand-new
   * domain still receives useful queries immediately.
   */
  private buildDomainScopedRequestIntentKeywords(input: {
    readonly domainName: string;
    readonly description: string;
    readonly collectionPlan: RequestCollectionPlan | null;
    readonly configuredKeywords: readonly string[];
  }): string[] {
    const normalizePhrase = (value: string, maxWords: number): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .slice(0, maxWords)
        .join(' ');

    const compose = (...parts: string[]): string => {
      const seen = new Set<string>();
      const tokens: string[] = [];
      for (const part of parts) {
        for (const token of normalizePhrase(part, 12).split(' ')) {
          if (!token || seen.has(token)) continue;
          seen.add(token);
          tokens.push(token);
          if (tokens.length >= 9) break;
        }
        if (tokens.length >= 9) break;
      }
      return tokens.join(' ');
    };

    const description = input.description.trim();
    if (!description) return [];

    const domainName = normalizePhrase(input.domainName, 5);
    if (!domainName) return [];

    const plan = input.collectionPlan;
    const professionalAnchor = normalizePhrase(
      plan?.suggestedDomainName ?? '',
      6,
    );
    const identityTerms = RequestDynamicQueryUtil.extractEvidenceIdentityTerms(
      description,
    ).slice(0, 6);
    const identityPhrase = identityTerms.slice(0, 3).join(' ');
    const workflowTerms = this.normalizeStringArray([
      ...(plan?.intentConcepts ?? []),
      ...RequestDynamicQueryUtil.extractWorkflowTerms(description),
    ]).slice(0, 8);
    const painTerms = this.normalizeStringArray([
      ...(plan?.evidenceTargets ?? []).flatMap((value) =>
        RequestDynamicQueryUtil.extractPainTerms(value),
      ),
      ...RequestDynamicQueryUtil.extractPainTerms(description),
    ]).slice(0, 8);
    const perspectiveTerms = this.resolveDomainPerspectiveTerms(
      domainName,
      description,
      plan,
    );

    /*
     * Reuse planner queries that already express this domain's perspective.
     * This is more semantic than prepending the domain name to one shared
     * query and works for arbitrary domains when the planner has already used
     * their professional vocabulary.
     */
    const normalizedDomain = domainName.toLocaleLowerCase();
    const domainAliases = /\b(?:artificial intelligence|machine learning|data science)\b/u.test(normalizedDomain)
      ? ['ai', 'machine learning', 'ml', 'data science']
      : /\b(?:cybersecurity|cyber security|information security|identity security)\b/u.test(normalizedDomain)
        ? ['cybersecurity', 'cyber security', 'security', 'iam']
        : /\b(?:human resources?|hr|recruitment|workforce|people operations?)\b/u.test(normalizedDomain)
          ? ['human resources', 'hr', 'workforce', 'people operations']
          : [];
    const domainTokens = new Set(
      normalizePhrase(
        [domainName, ...domainAliases, ...input.configuredKeywords].join(' '),
        24,
      )
        .split(' ')
        .filter((token) => token.length >= 2),
    );
    const genericPerspectiveTokens = new Set([
      'employee', 'employees', 'account', 'accounts', 'access', 'identity',
      'security', 'system', 'systems', 'review', 'management', 'governance',
      'organization', 'organizations', 'large', 'human', 'resources',
    ]);
    const perspectiveTokens = new Set(
      perspectiveTerms
        .flatMap((value) => normalizePhrase(value, 6).split(' '))
        .filter(
          (token) =>
            token.length >= 3 && !genericPerspectiveTokens.has(token),
        ),
    );
    const plannerAligned = (plan?.searchQueries ?? [])
      .map((value) => normalizePhrase(value, 9))
      .filter(Boolean)
      .map((query) => {
        const tokens = new Set(query.split(' '));
        const domainOverlap = [...domainTokens].filter((token) =>
          tokens.has(token),
        ).length;
        const perspectiveOverlap = [...perspectiveTokens].filter((token) =>
          tokens.has(token),
        ).length;
        return {
          query,
          score: domainOverlap * 2 + perspectiveOverlap * 3,
        };
      })
      .filter((entry) => {
        const tokens = new Set(entry.query.split(' '));
        const domainOverlap = [...domainTokens].filter((token) =>
          tokens.has(token),
        ).length;
        const perspectiveOverlap = [...perspectiveTokens].filter((token) =>
          tokens.has(token),
        ).length;
        return domainOverlap >= 1 || perspectiveOverlap >= 2;
      })
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.query)
      .slice(0, 3);

    const requestCompatibleConfigured =
      this.filterPersistentKeywordsForCurrentRequest(
        input.configuredKeywords,
        description,
      ).slice(0, 2);

    const candidates = [
      ...plannerAligned,
      ...perspectiveTerms.slice(0, 4).map((perspective, index) =>
        compose(
          professionalAnchor || identityPhrase,
          perspective,
          workflowTerms[index % Math.max(1, workflowTerms.length)] ?? '',
          painTerms[index % Math.max(1, painTerms.length)] ?? '',
        ),
      ),
      compose(
        domainName,
        professionalAnchor,
        perspectiveTerms[0] ?? workflowTerms[0] ?? '',
      ),
      compose(
        identityPhrase,
        perspectiveTerms[1] ?? workflowTerms[1] ?? workflowTerms[0] ?? '',
        painTerms[0] ?? '',
      ),
      ...requestCompatibleConfigured.map((keyword) =>
        compose(keyword, professionalAnchor || identityPhrase, painTerms[0] ?? ''),
      ),
    ];

    return this.normalizeStringArray(candidates)
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, 8);
  }

  /**
   * Derives a domain perspective from the selected domain plus the requester
   * semantics. The method uses broad capability families rather than
   * per-vertical business rules, so an unseen industry still falls back to the
   * AI planner's professional domain and request concepts.
   */
  private resolveDomainPerspectiveTerms(
    normalizedDomainName: string,
    description: string,
    collectionPlan: RequestCollectionPlan | null,
  ): string[] {
    const request = description.toLocaleLowerCase();
    const domain = normalizedDomainName.toLocaleLowerCase();
    const terms: string[] = [];
    const add = (value: string) => {
      if (value && !terms.includes(value)) terms.push(value);
    };

    const aiDomain = /\b(?:artificial intelligence|machine learning|\bai\b|predictive analytics|data science)\b/u.test(domain);
    const securityDomain = /\b(?:cybersecurity|cyber security|information security|identity security|security)\b/u.test(domain);
    const workforceDomain = /\b(?:human resources?|\bhr\b|recruitment|workforce|people operations?)\b/u.test(domain);
    const healthcareDomain = /\b(?:healthcare|health care|medical|clinical|hospital|patient care)\b/u.test(domain);
    const financeDomain = /\b(?:finance|financial|banking|payments?|insurance|revenue)\b/u.test(domain);

    if (aiDomain) {
      const anomalyOrSecurityIntent =
        /\b(?:unusual|suspicious|anomal|abnormal|fraud|fraudulent|risk|security|unauthori[sz]ed|compromised|privilege|abuse)\w*\b/u.test(
          request,
        );

      if (/\b(?:unusual|suspicious|anomal|abnormal)\w*\b/u.test(request)) {
        add('behavioral anomaly detection');
      }
      if (/\b(?:risk|security|unauthori[sz]ed|compromised|privilege)\w*\b/u.test(request)) {
        add('identity risk scoring');
      }
      if (
        anomalyOrSecurityIntent &&
        /\b(?:login|activity|behavior|behaviour|usage|transaction|payment)\w*\b/u.test(
          request,
        )
      ) {
        add('behavioral analytics');
      }
      if (/\b(?:forecast|predict|likelihood|early detection)\w*\b/u.test(request)) {
        add('predictive forecasting');
      }
      if (anomalyOrSecurityIntent) {
        add('human reviewed anomaly prioritization');
      }
      if (
        !anomalyOrSecurityIntent &&
        /\b(?:profit|profitable|profitability|margin|revenue|cost|pricing|forecast|budget)\w*\b/u.test(
          request,
        )
      ) {
        add('explainable profitability and forecast analysis');
      }
    } else if (securityDomain) {
      if (/\b(?:permission|privilege|entitlement|access right|role change|offboard|deprovision|account removal)\w*\b/u.test(request)) {
        add('identity access governance');
        add('privilege and entitlement review');
        add('account lifecycle security');
      }
      if (/\b(?:login|authentication|account|unauthori[sz]ed|compromised)\w*\b/u.test(request)) {
        add('account access security');
      }
      if (/\b(?:alert|investigation|incident|suspicious)\w*\b/u.test(request)) {
        add('security alert investigation');
      }
    } else if (workforceDomain) {
      if (/\b(?:role|department|transfer|move|project)\w*\b/u.test(request)) {
        add('employee role transition access review');
      }
      if (/\b(?:leave|leaving|offboard|deprovision|account removal|former employee)\w*\b/u.test(request)) {
        add('employee offboarding deprovisioning');
      }
      if (/\b(?:permission|access|entitlement|account)\w*\b/u.test(request)) {
        add('joiner mover leaver access lifecycle');
        add('hr directory permission reconciliation');
      }
    } else if (healthcareDomain) {
      if (/\b(?:billing|invoice|claim|insurance|reimbursement)\w*\b/u.test(request)) {
        add('patient billing claims abuse');
        add('medical invoice and insurance claim review');
        add('healthcare revenue cycle fraud workflow');
      }
      if (/\b(?:patient account|patient portal|login|unauthori[sz]ed|compromised)\w*\b/u.test(request)) {
        add('patient portal account compromise');
      }
    } else if (financeDomain) {
      const fraudOrRiskIntent =
        /\b(?:fraud|fraudulent|suspicious|anomal|abuse|unauthori[sz]ed|scam|claim fraud|reimbursement fraud|false positive|blocked|freeze)\w*\b/u.test(
          request,
        );

      if (
        fraudOrRiskIntent &&
        /\b(?:payment|transaction|invoice|claim|reimbursement)\w*\b/u.test(request)
      ) {
        add('payment transaction anomaly review');
      }
      if (
        fraudOrRiskIntent &&
        /\b(?:insurance|claim|claims|reimbursement)\w*\b/u.test(request)
      ) {
        add('insurance claim and reimbursement fraud');
      }
      if (/\b(?:restriction|false positive|legitimate user|freeze|blocked)\w*\b/u.test(request)) {
        add('payment restriction false positive review');
      }
      if (/\b(?:fraud|fraudulent|financial loss|financial losses)\w*\b/u.test(request)) {
        add('financial loss and fraud investigation');
      }
      if (
        !fraudOrRiskIntent &&
        /\b(?:profit|profitable|profitability|margin|revenue|cost|pricing|budget|forecast|cancellation|churn)\w*\b/u.test(
          request,
        )
      ) {
        add('profitability margin and revenue analysis');
        add('cost and forecast variance analysis');
      }
    }

    /*
     * Known cross-domain capability families keep their own perspective
     * vocabulary. Appending every shared request concept here makes the lanes
     * converge again (for example an AI anomaly query leaking into HR merely
     * because both contain "employee access"). For an unseen domain, fall
     * back to the AI planner's professional vocabulary instead of hardcoding a
     * new industry rule.
     */
    if (terms.length === 0) {
      for (const value of collectionPlan?.intentConcepts ?? []) add(value);
      if (collectionPlan?.suggestedDomainName) add(collectionPlan.suggestedDomainName);
    }

    return terms.slice(0, 7);
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

    const hasAdministrationIntent =
      /\b(?:administration|administrative|back[- ]office|office administration|admin workflow|administrative workflow)\b/iu.test(
        searchableIntent,
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
    const hasCustomFootwearProductionIntent =
      /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|approved specifications?|completion deadlines?|handmade shoes?|custom pairs?)\b/iu.test(
        searchableIntent,
      );
    const hasWardrobeCoreIntent =
      /\b(?:wardrobe|closet|clothes|clothing|accessories|outfit|outfits)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:inventory|remember|fit|fits|sizing|cleaning|laundry|repair|maintenance|photos?|receipts?|duplicate purchases?|unused items?|occasion|weather|outfit|coordinate|coordination)\b/iu.test(
        searchableIntent,
      );
    const hasFootwearWardrobeIntent =
      /\b(?:shoes|footwear)\b/iu.test(searchableIntent) &&
      /\b(?:wardrobe|closet|inventory|outfit|shopping|purchase|purchases|receipt|receipts|own|owned|wear|worn|weather|occasion)\b/iu.test(
        searchableIntent,
      );
    const hasWardrobeIntent =
      !hasCustomFootwearProductionIntent &&
      (hasWardrobeCoreIntent || hasFootwearWardrobeIntent);
    const hasLaundryOperationsIntent =
      /\b(?:laundry shop|laundry shops|laundromat|laundromats|dry cleaning|dry-cleaning|dry cleaner|dry cleaners|laundry service|garment cleaning|wash and fold)\b/iu.test(
        searchableIntent,
      ) &&
      /\b(?:garments?|clothes|stains?|cleaning instructions?|pickup|pick up|deadlines?|treatment|paper tags?|lost|missing|delayed|customer disputes?|order status)\b/iu.test(
        searchableIntent,
      );
    const hasTailoringAnchor =
      /\b(?:tailor|tailoring|custom clothing|custom apparel|made[- ]to[- ]measure|bespoke clothing|bespoke tailoring|alteration shop|alteration shops|fitting appointment)\b/iu.test(
        searchableIntent,
      ) ||
      (/\b(?:garment|fabric|alteration|design notes?)\b/iu.test(searchableIntent) &&
        /\b(?:dress|suit|shirt|pants|trousers|clothing|apparel|seamstress|dressmaker|tailor|fitting|body measurements?)\b/iu.test(searchableIntent));
    const hasTailoringMeasurementContext =
      /\bmeasurements?\b/iu.test(searchableIntent) &&
      /\b(?:body|clothing|garment|tailor|tailoring|dress|suit|shirt|pants|trousers|apparel|alteration)\b/iu.test(
        searchableIntent,
      );
    const excludesNonGarmentFitting =
      /\b(?:hat makers?|milliners?|millinery|custom hats?|headwear|wig makers?|custom wigs?|hairpiece makers?)\b/iu.test(
        searchableIntent,
      );
    const hasTailoringIntent =
      !excludesNonGarmentFitting &&
      (hasTailoringAnchor || hasTailoringMeasurementContext);
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

    if (hasCustomFootwearProductionIntent) {
      terms.unshift(
        'bespoke shoemaker customer foot measurements',
        'custom footwear leather selection tracking',
        'made to measure shoes sole type specification',
        'shoemaking stitching preference fitting notes',
        'custom shoe design revision approval',
        'handmade shoe final approved specification',
        'bespoke footwear fitting revision history',
        'custom shoemaking completion deadline tracking',
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