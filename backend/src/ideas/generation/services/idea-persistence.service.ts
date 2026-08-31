/**
 * Persists validated generated ideas and consumes their generation
 * entitlement atomically.
 *
 * @author Malak
 */

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  GeneratedOutputStatus,
  IdeaGenerationRunStatus,
  IdeaGenerationType,
  Prisma,
  UnlockMethod,
} from '@prisma/client';

import { CreditBalanceNotificationService } from '../../../credits/services/credit-balance-notification.service';
import { CreditBalanceService } from '../../../credits/services/credit-balance.service';
import { CreditCacheService } from '../../../credits/services/credit-cache.service';
import type { CreditBalanceResult } from '../../../credits/types/credit-balance-result.type';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../../prisma/prisma.service';
import { userCacheKeys } from '../../../users/cache/user-cache.keys';

import {
  findIdeaAdvancedOutputDefinitionByKey,
  getIdeaAdvancedOutputSequence,
  REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS,
} from '../constants/idea-output.constants';
import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_DUPLICATE_TITLE_LENGTH,
} from '../constants/idea-generation.constants';

import type {
  AdvancedIdeaAiOutput,
  IdeaAdvancedOutputKey,
  JsonValue,
  ParsedIdeaAiOutput,
} from '../types/idea-ai-output.type';

import { isTransientDatabaseError } from '../utils/transient-database-error.util';
import { TargetUserDeduplicationUtil } from '../utils/target-user-deduplication.util';
import { IdeaOutputTextSanitizationUtil } from '../utils/idea-output-text-sanitization.util';

/**
 * Maximum number of attempts used when the atomic persistence transaction
 * fails because of a retryable lock/acquisition timeout or transient database
 * connection interruption.
 */
const PERSISTENCE_TRANSACTION_MAX_ATTEMPTS = 3;

/**
 * Maximum time Prisma may wait to acquire an interactive
 * transaction connection before failing the persistence attempt.
 */
const PERSISTENCE_TRANSACTION_MAX_WAIT_MS = 4_500;

/**
 * Maximum lifetime of one interactive persistence transaction.
 *
 * The flow keeps idea creation, run attachment, generated outputs, and
 * entitlement consumption atomic. Targeted row/advisory locks protect the
 * actual race-sensitive resources, so the transaction does not need the broad
 * SERIALIZABLE isolation level that caused avoidable PostgreSQL 40001 failures.
 */
const PERSISTENCE_TRANSACTION_TIMEOUT_MS = 14_000;

/**
 * Maximum server-side execution time for one SQL statement inside idea
 * persistence. This is intentionally shorter than the transaction lifetime so
 * a stalled remote query fails early and the complete atomic transaction can
 * be retried on a fresh pooled connection.
 */
const PERSISTENCE_STATEMENT_TIMEOUT_MS = 6_000;

/**
 * Maximum time one persistence statement may wait on a PostgreSQL lock.
 * Generation persistence should never sit behind a long-running lock while the
 * user waits on the completion screen; a short lock timeout lets the bounded
 * atomic persistence retry path recover instead.
 */
const PERSISTENCE_LOCK_TIMEOUT_MS = 1_500;

/**
 * Prisma transaction client accepted by idea-persistence
 * operations.
 */
export type IdeaPersistenceDatabaseClient = Prisma.TransactionClient;

/**
 * Values returned by the committed persistence transaction.
 */
type IdeaPersistenceTransactionResult = {
  readonly ideaId: string;
  readonly creditAdjustment: CreditBalanceResult | null;
  readonly persistedIdea: PersistedGeneratedIdea;
};

/**
 * Input required to persist one successfully generated idea.
 *
 * The caller must provide exactly one owner:
 * - userId for authenticated generation.
 * - guestSessionId for guest generation.
 */
export type PersistGeneratedIdeaInput = {
  /**
   * Generation-run identifier associated with this result.
   */
  readonly runId: string;

  /**
   * Persisted prompt-history identifier used to generate the idea.
   */
  readonly promptHistoryId: string;

  /**
   * Registered-user owner.
   *
   * Required for NORMAL_FREE and PREMIUM_CREDIT generation.
   */
  readonly userId?: string;

  /**
   * Guest-session owner.
   *
   * Required for GUEST_FREE generation.
   */
  readonly guestSessionId?: string;

  /**
   * Semantic domain assigned to the persisted idea. In multi-domain discovery
   * this may differ from the technical domain that owns the unified collection
   * job after ranking selects a stronger domain-aligned opportunity.
   */
  readonly domainId: string;

  /**
   * Technical domain row that owns collectionJobId.
   *
   * This value is intentionally separate from domainId. The collection job is
   * created before ranking, while the final idea domain may be selected later.
   */
  readonly collectionDomainId: string;

  /**
   * Domain ids that were part of the validated generation scope. The semantic
   * idea domain must remain inside this immutable set.
   */
  readonly allowedIdeaDomainIds?: readonly string[];

  /**
   * Most specific selected geographic region.
   */
  readonly selectedRegion: string;

  /**
   * Collection job that supplied source data and NLP analysis.
   */
  readonly collectionJobId: string;

  /**
   * Entitlement tier used for generation.
   */
  readonly generationType: IdeaGenerationType;

  /**
   * Credit amount already resolved by the entitlement stage.
   * Passing it here removes a system-setting read from the write transaction.
   */
  readonly creditsToConsume: number;

  /**
   * Number of analyzed community comments already available in pipeline
   * context. Passing it avoids re-reading NlpAnalysis inside the persistence
   * transaction solely to populate Idea.commentsCount.
   */
  readonly analyzedCommentsCount: number;

  /**
   * Parsed and normalized AI output.
   */
  readonly parsedOutput: ParsedIdeaAiOutput;
};

/**
 * Idea record returned after successful persistence.
 *
 * Generated outputs are included so the pipeline can use the
 * complete committed result without performing another query.
 */
export type PersistedGeneratedIdea = {
  readonly id: string;
  readonly title: string;
  readonly domain: {
    readonly id: string;
    readonly name: string;
  };
  readonly generatedOutputs: ReadonlyArray<{
    readonly id: string;
    readonly outputKey: string;
  }>;
  readonly generationRun: {
    readonly id: string;
    readonly status: IdeaGenerationRunStatus;
    readonly progressPercent: number;
  } | null;
};

/**
 * Persists generated ideas and consumes their corresponding
 * entitlement atomically.
 *
 * Responsibilities:
 * - Validate persistence input.
 * - Validate idea ownership.
 * - Validate the referenced generation run.
 * - Validate generation-type consistency.
 * - Validate prompt-history and collection-job consistency.
 * - Perform a final duplicate-title check.
 * - Create the base Idea record.
 * - Consume guest, free-user, or premium-credit entitlement.
 * - Store objectives and target users as Prisma JSON values.
 * - Store advanced AI results as GeneratedOutput records.
 * - Link the generation run to the created idea.
 * - Retry transient/lock transaction conflicts without weakening atomicity.
 * - Invalidate credit caches after a committed premium deduction.
 * - Trigger low or exhausted credit emails after commit.
 *
 * Transaction guarantees:
 * - A guest session is consumed only when persistence succeeds.
 * - A free generation is consumed only when persistence succeeds.
 * - A premium credit is deducted only when persistence succeeds.
 * - Premium credit transactions are linked to the created idea.
 * - Generated outputs cannot remain without their parent idea.
 * - A generation run cannot reference a partially persisted idea.
 *
 * Run completion is intentionally excluded. The generation
 * pipeline completes the run only after every required stage has
 * succeeded.
 *
 * This service does not:
 * - Execute AI generation.
 * - Parse provider responses.
 * - Start data collection.
 * - Run NLP analysis.
 * - Select generation entitlement.
 * - Publish generated ideas.
 * - Mark the complete pipeline as completed.
 */
@Injectable()
export class IdeaPersistenceService {
  private readonly logger = new Logger(IdeaPersistenceService.name);

  constructor(
    private readonly prisma: PrismaService,

    private readonly creditBalanceService: CreditBalanceService,

    private readonly creditBalanceNotificationService: CreditBalanceNotificationService,

    private readonly creditCacheService: CreditCacheService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  /**
   * Persists one generated idea and consumes its entitlement
   * inside one atomic Prisma transaction.
   *
   * The pipeline should call this method only after:
   * - Data collection is complete.
   * - NLP analysis is complete.
   * - AI output has been parsed and validated.
   * - Cancellation has been checked.
   *
   * @param input Validated idea-persistence input.
   * @returns Fully persisted idea with outputs and run data.
   */
  async persistIdea(
    input: PersistGeneratedIdeaInput,
  ): Promise<PersistedGeneratedIdea> {
    const normalizedInput = this.normalizeInput(input);

    /*
     * Do not repeat the same remote reads before the transaction. The
     * atomic transaction already validates the run, prompt history,
     * collection job, duplicate state, and entitlement immediately before
     * writing. Removing the three preflight queries saves database round-trips
     * without weakening atomicity or race protection.
     */
    const transactionStartedAt = Date.now();
    const transactionResult =
      await this.executeAtomicPersistenceTransaction(normalizedInput);
    this.logger.debug(
      `Idea persistence transaction committed in ${Date.now() - transactionStartedAt}ms for run "${normalizedInput.runId}" with ${normalizedInput.parsedOutput.advancedOutputs.length} advanced output(s).`,
    );

    const summaryInvalidation = normalizedInput.userId
      ? this.cacheManager.del(
          userCacheKeys.summary(normalizedInput.userId),
        )
      : Promise.resolve();

    const persistedIdea = transactionResult.persistedIdea;

    /*
     * The idea and entitlement are already committed. A low/exhausted-credit
     * in-app alert is user-visible state, so make its persistence a guaranteed
     * post-commit step before returning. The notification service keeps email
     * and push delivery best-effort so they do not extend generation latency.
     */
    await this.notifyPremiumCreditBalance(
      normalizedInput,
      transactionResult.creditAdjustment,
    );

    /* Cache invalidation is recoverable and may safely finish off the response path. */
    void Promise.allSettled([
      this.invalidatePremiumCreditCaches(normalizedInput),
      summaryInvalidation,
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          this.logger.warn(
            `Post-commit idea persistence side effect failed: ${message}`,
          );
        }
      }
    });

    return persistedIdea;
  }

  private async executeAtomicPersistenceTransaction(
    input: PersistGeneratedIdeaInput,
  ): Promise<IdeaPersistenceTransactionResult> {
    for (
      let attempt = 1;
      attempt <= PERSISTENCE_TRANSACTION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const attemptStartedAt = Date.now();

      try {
        const transactionInvocationAt = Date.now();
        let callbackEnteredAt = 0;
        let callbackExitedAt = 0;
        const result = await this.prisma.$transaction(
          async (transaction): Promise<IdeaPersistenceTransactionResult> => {
            callbackEnteredAt = Date.now();
            const timingStartedAt = callbackEnteredAt;

            /*
             * Interactive Prisma transactions use one database connection.
             * Promise.all does not make queries on that connection execute in
             * parallel and can make timeout behaviour harder to reason about.
             * Apply narrow server-side limits and execute the validation reads
             * in their actual database order.
             */
            /*
             * Apply both local transaction limits in one PostgreSQL round trip.
             * Supabase latency made the two sequential SET statements visible
             * in the 9-10s persistence envelope even though they carry no
             * business data. set_config(..., true) has the same transaction-
             * local semantics and automatically resets at transaction end.
             */
            const commentsCount = input.analyzedCommentsCount;

            /*
             * Create the base idea, attach prompt history, and insert all
             * generated outputs in one PostgreSQL CTE. This keeps the outer
             * atomic transaction while removing the hidden nested-write
             * round trips that dominated Supabase persistence latency.
             */
            const ideaCreateStartedAt = Date.now();
            const created = await this.createIdeaWithRelations(
              transaction,
              input,
              commentsCount,
            );
            const ideaCreateMs = Date.now() - ideaCreateStartedAt;
            const idea = created.idea;

            const guardedWritesStartedAt = Date.now();
            /*
             * These writes share the same interactive-transaction connection,
             * so run them explicitly in sequence. If either one fails, Prisma
             * rolls the whole transaction back, including the newly created
             * idea and every generated output.
             */
            const creditAdjustment = await this.consumeEntitlement(
              transaction,
              input,
              idea.id,
            );
            const run = created.run;
            const guardedWritesMs = Date.now() - guardedWritesStartedAt;

            callbackExitedAt = Date.now();
            this.logger.debug(
              `Idea persistence DB timing for run "${input.runId}": atomicCreateAndAttach=${ideaCreateMs}ms, entitlement=${guardedWritesMs}ms, transactionBody=${callbackExitedAt - timingStartedAt}ms.`,
            );

            return {
              ideaId: idea.id,
              creditAdjustment,
              persistedIdea: {
                id: idea.id,
                title: idea.title,
                domain: idea.domain,
                generatedOutputs: created.generatedOutputs,
                generationRun: {
                  id: run.id,
                  status: run.status,
                  progressPercent: run.progressPercent,
                },
              },
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: PERSISTENCE_TRANSACTION_MAX_WAIT_MS,
            timeout: PERSISTENCE_TRANSACTION_TIMEOUT_MS,
          },
        );
        const transactionResolvedAt = Date.now();
        this.logger.debug(
          `Idea persistence transaction envelope for run "${input.runId}": ` +
          `acquireOrBegin=${callbackEnteredAt > 0 ? callbackEnteredAt - transactionInvocationAt : transactionResolvedAt - transactionInvocationAt}ms, ` +
          `callback=${callbackEnteredAt > 0 && callbackExitedAt >= callbackEnteredAt ? callbackExitedAt - callbackEnteredAt : 0}ms, ` +
          `commitOrResolve=${callbackExitedAt > 0 ? transactionResolvedAt - callbackExitedAt : 0}ms, ` +
          `total=${transactionResolvedAt - transactionInvocationAt}ms, attempt=${attempt}.`,
        );
        return result;
      } catch (error: unknown) {
        if (
          !this.isRetryableTransactionError(error) ||
          attempt === PERSISTENCE_TRANSACTION_MAX_ATTEMPTS
        ) {
          throw error;
        }

        const transientConnectionFailure = isTransientDatabaseError(error);
        const retryDelayMs = transientConnectionFailure
          ? Math.min(900, 250 * 2 ** (attempt - 1))
          : Math.min(650, 180 * attempt);
        const jitterMs = Math.floor(Math.random() * 90);
        const boundedDelayMs = retryDelayMs + jitterMs;

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const compactError = errorMessage
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, 220);

        this.logger.warn(
          `Retrying idea-persistence transaction after a transient ${
            transientConnectionFailure ? 'database connection' : 'transaction'
          } failure. Attempt ${attempt + 1}/${PERSISTENCE_TRANSACTION_MAX_ATTEMPTS} in ${boundedDelayMs}ms; failedAttemptMs=${Date.now() - attemptStartedAt}; reason=${compactError}.`,
        );
        await new Promise<void>((resolve) => {
          setTimeout(resolve, boundedDelayMs);
        });
      }
    }

    throw new BadRequestException('Idea persistence could not be completed.');
  }

  /**
   * Normalizes and validates persistence input before opening the
   * database transaction.
   *
   * Ownership rules:
   * - GUEST_FREE requires guestSessionId and rejects userId.
   * - NORMAL_FREE requires userId and rejects guestSessionId.
   * - PREMIUM_CREDIT requires userId and rejects guestSessionId.
   *
   * @param input Raw persistence input.
   * @returns Normalized persistence input.
   */
  private normalizeInput(
    input: PersistGeneratedIdeaInput,
  ): PersistGeneratedIdeaInput {
    const runId = this.requireText(input.runId, 'Generation run ID');

    const promptHistoryId = this.requireText(
      input.promptHistoryId,
      'Prompt history ID',
    );

    const domainId = this.requireText(input.domainId, 'Domain ID');
    const collectionDomainId = this.requireText(
      input.collectionDomainId,
      'Collection domain ID',
    );
    const allowedIdeaDomainIds = [
      ...new Set(
        (input.allowedIdeaDomainIds ?? [])
          .map((value) => this.normalizeOptionalText(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    if (
      allowedIdeaDomainIds.length > 0 &&
      !allowedIdeaDomainIds.includes(domainId)
    ) {
      throw new BadRequestException(
        'The persisted idea domain is outside the validated generation domain scope.',
      );
    }
    if (
      allowedIdeaDomainIds.length > 0 &&
      !allowedIdeaDomainIds.includes(collectionDomainId)
    ) {
      throw new BadRequestException(
        'The collection anchor domain is outside the validated generation domain scope.',
      );
    }

    const selectedRegion = this.requireText(
      input.selectedRegion,
      'Selected region',
    );

    const collectionJobId = this.requireText(
      input.collectionJobId,
      'Collection job ID',
    );

    const userId = this.normalizeOptionalText(input.userId);

    const guestSessionId = this.normalizeOptionalText(input.guestSessionId);

    this.validateOwner(input.generationType, userId, guestSessionId);

    this.validateParsedOutput(input.generationType, input.parsedOutput);

    return {
      runId,
      promptHistoryId,
      userId,
      guestSessionId,
      domainId,
      collectionDomainId,
      allowedIdeaDomainIds,
      selectedRegion,
      collectionJobId,
      generationType: input.generationType,
      creditsToConsume:
        input.generationType === IdeaGenerationType.PREMIUM_CREDIT
          ? Math.max(1, Math.floor(input.creditsToConsume))
          : 0,
      analyzedCommentsCount: Math.max(
        0,
        Math.floor(input.analyzedCommentsCount || 0),
      ),
      parsedOutput: this.sanitizeParsedOutput(input.parsedOutput, selectedRegion),
    };
  }

  private sanitizeParsedOutput(
    parsedOutput: ParsedIdeaAiOutput,
    selectedRegion: string,
  ): ParsedIdeaAiOutput {
    const sanitizeText = (value: string): string => {
      let sanitized = value
        .replace(/\be\s*\.\s*g\s*\./giu, 'e.g.')
        .replace(/\bi\s*\.\s*e\s*\./giu, 'i.e.')
        .replace(/\bai\b/giu, 'AI')
        .replace(/\bTLS\s*-?\s*(\d+)\s*\.\s*(\d+)\b/giu, 'TLS-$1.$2')
        .replace(
          /\b(OAuth|OpenID(?: Connect)?|OIDC|HTTP|SAML)\s+(\d+)\s*\.\s+(\d+)\b/giu,
          '$1 $2.$3',
        )
        .replace(/\b(\d+)\.\s+(\d+)(?=(?:ms|s|sec|secs|second|seconds|%|x)\b)/giu, '$1.$2')
        .replace(/\bv(\d+)\.\s+(\d+)\b/giu, 'v$1.$2')
        .replace(/\brobots\s*\.\s*txt\b/giu, 'robots.txt')
        .replace(/\bNext\s*\.\s*js\b/giu, 'Next.js')
        .replace(/\bNest\s*\.\s*js\b/giu, 'NestJS')
        .replace(/\bNode\s*\.\s*js\b/giu, 'Node.js')
        .replace(/\bReact\s*\.\s*js\b/giu, 'React')
        .replace(/\s+([,.;:!?])/gu, '$1')
        .replace(
          /\bdesigned to help\s+([^.!?]{3,140}?)\s+is\b/giu,
          'designed to help ensure $1 is',
        )
        .replace(/[ \t]{2,}/gu, ' ')
        .replace(
          /\b(?:one retained community report|a retained community report) indicates that collected feedback(?: from [^.!?]{0,120})? indicates that\s*/giu,
          'One retained community report indicates that ',
        )
        .replace(/\bindicates that\s+indicates that\b/giu, 'indicates that')
        .replace(
          /\bOne retained community report indicates that ([A-Z][\p{L}'’&-]*(?:\s+[A-Z][\p{L}'’&-]*){0,3}) buyers (?:experience|encounter|face)\b/gu,
          'One retained community report describes a buyer in $1 who experienced',
        )
        .replace(
          /\bOne retained community report indicates that buyers (?:experience|encounter|face)\b/giu,
          'One retained community report describes a buyer who experienced',
        )
        .replace(
          /\bOne collected report(?: from [^.!?]{0,140})? indicates that participants may fail ([^.!?]{3,160})/giu,
          'One collected report describes one participant who experienced $1',
        )
        .replace(
          /,?\s*often causing them to\b/giu,
          ', which the report described as causing the observed user to',
        )
        .replace(
          /\b((?:Two|Three|Four|Five|\d+) retained direct user reports across (?:two|three|four|five|\d+) independent sources)\s+describes\b/giu,
          '$1 describe',
        )
        .replace(
          /\b((?:Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+) retained (?:secondary reports?|supporting reports?|community reports?|supporting signals?)(?: across (?:two|three|four|five|six|seven|eight|nine|ten|\d+) (?:retained |independent )?sources?)?)\s+describes\b/giu,
          '$1 describe',
        )
        .replace(
          /\b((?:Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+) verified supporting signals) was retained\b/giu,
          '$1 were retained',
        )
        .replace(
          /\b(help|helps|helped|ensure|ensures|the|to|and|or|of|for|with|that|this|these|those)\s+\1\b/giu,
          '$1',
        )
        .replace(/\bproduction\s+future\s+pilot participants\b/giu, 'future pilot participants')
        .replace(
          /\bsupporting\s+human operators\s+retain\s+final authority\b/giu,
          'ensuring human operators retain final authority',
        )
        .replace(
          /\bThis unvalidated ([^.!?]{3,120}?) creates\b/giu,
          'This unvalidated $1 could create',
        )
        .replace(
          /\bThis unvalidated ([^.!?]{3,120}?) causes\b/giu,
          'This unvalidated $1 could cause',
        )
        .trim();

      const region = selectedRegion.trim();
      if (region.length >= 2) {
        const escaped = region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        sanitized = sanitized.replace(
          new RegExp(`\\b${escaped}\\b`, 'giu'),
          region.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()),
        );
      }
      return IdeaOutputTextSanitizationUtil.normalizeIdempotentPhrases(
        sanitized.replace(/^([a-z])/u, (letter) => letter.toUpperCase()),
      );
    };

    const sanitizeJson = (value: JsonValue): JsonValue => {
      if (typeof value === 'string') return sanitizeText(value);
      if (Array.isArray(value)) return value.map((item) => sanitizeJson(item));
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, sanitizeJson(item)]),
        ) as JsonValue;
      }
      return value;
    };

    return {
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: sanitizeText(parsedOutput.coreIdea.title),
        problemStatement: sanitizeText(parsedOutput.coreIdea.problemStatement),
        objectives: parsedOutput.coreIdea.objectives.map(sanitizeText),
        targetUsers: TargetUserDeduplicationUtil.deduplicate(
          parsedOutput.coreIdea.targetUsers.map(sanitizeText),
          4,
        ),
        ...(parsedOutput.coreIdea.limitedAbstract !== undefined
          ? { limitedAbstract: sanitizeText(parsedOutput.coreIdea.limitedAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.partialAbstract !== undefined
          ? { partialAbstract: sanitizeText(parsedOutput.coreIdea.partialAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: sanitizeText(parsedOutput.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: parsedOutput.advancedOutputs.map((output) => ({
        ...output,
        title: sanitizeText(output.title),
        content: sanitizeText(output.content),
        ...(output.structuredContent !== undefined
          ? { structuredContent: sanitizeJson(output.structuredContent) as typeof output.structuredContent }
          : {}),
      })),
    };
  }

  /**
   * Validates owner fields against the selected generation type.
   *
   * @param generationType Selected generation entitlement.
   * @param userId Optional registered owner.
   * @param guestSessionId Optional guest owner.
   */
  private validateOwner(
    generationType: IdeaGenerationType,
    userId?: string,
    guestSessionId?: string,
  ): void {
    switch (generationType) {
      case IdeaGenerationType.GUEST_FREE:
        if (!guestSessionId) {
          throw new BadRequestException(
            'Guest session ID is required for guest idea generation.',
          );
        }

        if (userId) {
          throw new BadRequestException(
            'Guest idea generation cannot be assigned to a registered user.',
          );
        }

        return;

      case IdeaGenerationType.NORMAL_FREE:
      case IdeaGenerationType.PREMIUM_CREDIT:
        if (!userId) {
          throw new BadRequestException(
            'User ID is required for authenticated idea generation.',
          );
        }

        if (guestSessionId) {
          throw new BadRequestException(
            'Authenticated idea generation cannot be assigned to a guest session.',
          );
        }

        return;

      default:
        this.assertNeverGenerationType(generationType);
    }
  }

  /**
   * Defensively validates the normalized parsed output before any
   * database transaction is opened.
   *
   * The dedicated validation stage remains the primary owner of
   * tier-level validation. These checks protect direct service
   * callers and future pipeline changes.
   *
   * @param generationType Selected generation type.
   * @param parsedOutput Parsed AI output.
   */
  private validateParsedOutput(
    generationType: IdeaGenerationType,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    if (
      !parsedOutput ||
      !parsedOutput.coreIdea ||
      !Array.isArray(parsedOutput.advancedOutputs)
    ) {
      throw new BadRequestException(
        'Parsed AI output is required before idea persistence.',
      );
    }

    switch (generationType) {
      case IdeaGenerationType.GUEST_FREE:
        this.requireNonBlankOutputField(
          parsedOutput.coreIdea.limitedAbstract,
          'limitedAbstract',
          generationType,
        );

        this.requireNonBlankOutputField(
          parsedOutput.coreIdea.partialAbstract,
          'partialAbstract',
          generationType,
        );

        this.rejectPremiumOutputForFreeTier(parsedOutput, generationType);

        return;

      case IdeaGenerationType.NORMAL_FREE:
        this.requireNonBlankOutputField(
          parsedOutput.coreIdea.partialAbstract,
          'partialAbstract',
          generationType,
        );

        this.rejectPremiumOutputForFreeTier(parsedOutput, generationType);

        return;

      case IdeaGenerationType.PREMIUM_CREDIT:
        this.requireNonBlankOutputField(
          parsedOutput.coreIdea.fullAbstract,
          'fullAbstract',
          generationType,
        );

        this.validatePremiumOutputs(parsedOutput.advancedOutputs);

        return;

      default:
        this.assertNeverGenerationType(generationType);
    }
  }

  /**
   * Rejects full premium data for guest and normal-free
   * persistence.
   *
   * @param parsedOutput Parsed free-tier output.
   * @param generationType Free generation type.
   */
  private rejectPremiumOutputForFreeTier(
    parsedOutput: ParsedIdeaAiOutput,
    generationType: IdeaGenerationType,
  ): void {
    if (parsedOutput.coreIdea.fullAbstract !== undefined) {
      throw new BadRequestException(
        `${generationType} persistence must not contain a full abstract.`,
      );
    }

    if (parsedOutput.advancedOutputs.length > 0) {
      throw new BadRequestException(
        `${generationType} persistence must not contain advanced premium outputs.`,
      );
    }
  }

  /**
   * Ensures every required premium output exists exactly once and
   * matches the centralized output registry.
   *
   * @param outputs Parsed premium outputs.
   */
  private validatePremiumOutputs(
    outputs: readonly AdvancedIdeaAiOutput[],
  ): void {
    const outputKeys = new Set<IdeaAdvancedOutputKey>();

    for (const output of outputs) {
      const definition = findIdeaAdvancedOutputDefinitionByKey(
        output.outputKey,
      );

      if (!definition) {
        throw new BadRequestException(
          `Unsupported advanced output key "${String(output.outputKey)}".`,
        );
      }

      if (outputKeys.has(output.outputKey)) {
        throw new BadRequestException(
          `Duplicated advanced output key "${output.outputKey}".`,
        );
      }

      if (
        typeof output.title !== 'string' ||
        output.title.trim() !== definition.title
      ) {
        throw new BadRequestException(
          `Advanced output "${output.outputKey}" has an invalid title.`,
        );
      }

      if (
        typeof output.content !== 'string' ||
        output.content.trim().length === 0
      ) {
        throw new BadRequestException(
          `Advanced output "${output.outputKey}" must contain non-empty content.`,
        );
      }

      if (
        definition.collection &&
        (!Array.isArray(output.structuredContent) ||
          output.structuredContent.length === 0 ||
          output.structuredContent.some(
            (item) => typeof item !== 'string' || item.trim().length === 0,
          ))
      ) {
        throw new BadRequestException(
          `Advanced output "${output.outputKey}" must contain a non-empty structured string array.`,
        );
      }

      outputKeys.add(output.outputKey);
    }

    const missingOutputKeys = REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS.filter(
      (outputKey) => !outputKeys.has(outputKey),
    );

    if (missingOutputKeys.length > 0) {
      throw new BadRequestException(
        `Premium persistence is missing required outputs: ${missingOutputKeys.join(', ')}.`,
      );
    }
  }

  /**
   * Validates the referenced generation run inside the active
   * transaction.
   *
   * The run must:
   * - Exist.
   * - Not already belong to an idea.
   * - Be in RUNNING state.
   * - Match the selected generation type.
   * - Match the provided owner.
   * - Match the supplied collection job.
   * - Not have a pending cancellation request.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @returns Validated generation run.
   */
  private async validateGenerationRun(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ) {
    const run = await transaction.ideaGenerationRun.findUnique({
      where: {
        id: input.runId,
      },

      select: {
        id: true,
        userId: true,
        guestSessionId: true,
        ideaId: true,
        collectionJobId: true,
        generationType: true,
        status: true,
        cancelRequestedAt: true,
        progressPercent: true,
        promptHistories: {
          where: { id: input.promptHistoryId },
          select: { id: true, collectionJobId: true },
          take: 1,
        },
      },
    });

    if (!run) {
      throw new NotFoundException(
        `Idea generation run "${input.runId}" was not found.`,
      );
    }

    if (run.ideaId) {
      throw new BadRequestException(
        'The generation run is already linked to a persisted idea.',
      );
    }

    if (run.status !== IdeaGenerationRunStatus.RUNNING) {
      throw new BadRequestException(
        `The generation run cannot persist an idea while its status is "${run.status}".`,
      );
    }

    if (run.generationType !== input.generationType) {
      throw new BadRequestException(
        'The generation run type does not match the persistence request.',
      );
    }

    if (run.userId !== (input.userId ?? null)) {
      throw new BadRequestException(
        'The generation run does not belong to the provided user.',
      );
    }

    if (run.guestSessionId !== (input.guestSessionId ?? null)) {
      throw new BadRequestException(
        'The generation run does not belong to the provided guest session.',
      );
    }

    if (
      run.collectionJobId !== null &&
      run.collectionJobId !== input.collectionJobId
    ) {
      throw new BadRequestException(
        'The generation run is already associated with a different collection job.',
      );
    }

    if (run.cancelRequestedAt) {
      throw new BadRequestException(
        'The generation run was cancelled before idea persistence.',
      );
    }

    if (run.promptHistories.length !== 1) {
      throw new NotFoundException(
        `Prompt history "${input.promptHistoryId}" was not found for generation run "${input.runId}".`,
      );
    }

    if (run.promptHistories[0]?.collectionJobId !== input.collectionJobId) {
      throw new BadRequestException(
        'The prompt history is not linked to the collection job used by this generation run.',
      );
    }

    return run;
  }

  /**
   * Validates the referenced collection job.
   *
   * The collection job must exist and belong to the technical collection
   * anchor domain. The final semantic idea domain is validated separately.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   */
  private async validateCollectionJob(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ): Promise<number> {
    const collectionJob = await transaction.collectionJob.findUnique({
      where: {
        id: input.collectionJobId,
      },

      select: {
        id: true,
        domainId: true,
        nlpAnalysis: {
          select: {
            totalCommentsAnalyzed: true,
          },
        },
      },
    });

    if (!collectionJob) {
      throw new NotFoundException(
        `Collection job "${input.collectionJobId}" was not found.`,
      );
    }

    if (collectionJob.domainId !== input.collectionDomainId) {
      throw new BadRequestException(
        'The collection job does not belong to the generation collection anchor domain.',
      );
    }

    return collectionJob.nlpAnalysis?.totalCommentsAnalyzed ?? 0;
  }

  /**
   * Consumes the entitlement associated with the selected
   * generation type.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @param ideaId Newly created idea identifier.
   */
  private async consumeEntitlement(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
    ideaId: string,
  ): Promise<CreditBalanceResult | null> {
    switch (input.generationType) {
      case IdeaGenerationType.GUEST_FREE:
        await this.consumeGuestGeneration(transaction, input);
        return null;

      case IdeaGenerationType.NORMAL_FREE:
        await this.consumeFreeGeneration(transaction, input);
        return null;

      case IdeaGenerationType.PREMIUM_CREDIT:
        return this.consumePremiumCredit(transaction, input, ideaId);

      default:
        this.assertNeverGenerationType(input.generationType);
    }
  }

  /**
   * Atomically consumes the one generation allowed for a guest
   * session.
   *
   * The session must exist, remain unused, and not be expired.
   * A nullable expiresAt represents a session without configured
   * expiration.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   */
  private async consumeGuestGeneration(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    const guestSessionId = input.guestSessionId;

    if (!guestSessionId) {
      throw new BadRequestException(
        'Guest session ID is required for guest entitlement consumption.',
      );
    }

    const now = new Date();

    const updated = await transaction.guestSession.updateMany({
      where: {
        id: guestSessionId,

        hasGenerated: false,

        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: now,
            },
          },
        ],
      },

      data: {
        hasGenerated: true,
      },
    });

    if (updated.count === 1) {
      return;
    }

    const session = await transaction.guestSession.findUnique({
      where: {
        id: guestSessionId,
      },

      select: {
        hasGenerated: true,
        expiresAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Guest session was not found.');
    }

    if (session.hasGenerated) {
      throw new BadRequestException(
        'The guest session has already consumed its free generation.',
      );
    }

    if (session.expiresAt && session.expiresAt <= now) {
      throw new BadRequestException(
        'The guest session has expired and cannot generate an idea.',
      );
    }

    throw new BadRequestException(
      'The guest generation entitlement could not be consumed.',
    );
  }

  /**
   * Atomically consumes one authenticated free generation.
   *
   * updateMany prevents the counter from exceeding the configured
   * user-specific limit even under concurrent requests.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   */
  private async consumeFreeGeneration(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    const userId = input.userId;

    if (!userId) {
      throw new BadRequestException(
        'User ID is required for free-generation entitlement consumption.',
      );
    }

    /*
     * Consume the free entitlement in one guarded SQL round trip. The previous
     * findUnique + updateMany sequence doubled remote latency on every normal
     * free persistence and still needed the update predicate for concurrency.
     * The database-side comparison is atomic and preserves the same limit.
     */
    const consumed = await transaction.$queryRaw<Array<{ id: string }>>`
      UPDATE "users"
      SET
        "free_generations_used" = "free_generations_used" + 1,
        "updated_at" = NOW()
      WHERE "id" = ${userId}
        AND "free_generations_used" < "free_generation_limit"
      RETURNING "id"
    `;

    if (consumed.length === 1) {
      return;
    }

    // Failure-path lookup only: distinguish a missing user from an exhausted
    // entitlement without paying this read on successful generations.
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    throw new BadRequestException(
      'No remaining free generations are available.',
    );
  }

  /**
   * Deducts the premium-generation credit through the central
   * credits service and links the resulting CreditTransaction to
   * the created idea.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @param ideaId Newly created premium idea identifier.
   */
  private async consumePremiumCredit(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
    ideaId: string,
  ): Promise<CreditBalanceResult> {
    const userId = input.userId;

    if (!userId) {
      throw new BadRequestException(
        'User ID is required for premium-credit consumption.',
      );
    }

    return this.creditBalanceService.consumeForIdeaGeneration(
      userId,
      ideaId,
      input.creditsToConsume,
      transaction,
    );
  }

  /**
   * Creates the base Idea record.
   *
   * Premium-credit generation creates an immediately unlocked idea
   * using CREDIT_GENERATION as its unlock method.
   *
   * Guest and normal-free ideas remain locked.
   *
   * @param transaction Active Prisma transaction.
   * @param input Normalized persistence input.
   * @returns Newly created idea.
   */
  private async createIdeaWithRelations(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
    commentsCount: number,
  ) {
    const core = input.parsedOutput.coreIdea;
    const isPremium =
      input.generationType === IdeaGenerationType.PREMIUM_CREDIT;
    const now = new Date();
    const ideaId = randomUUID();
    const generatedOutputs = input.parsedOutput.advancedOutputs.map(
      (output) => ({
        id: randomUUID(),
        outputKey: output.outputKey,
        title: output.title,
        sequence: getIdeaAdvancedOutputSequence(output.outputKey),
        status: GeneratedOutputStatus.COMPLETED,
        content: output.content,
        structuredContent:
          output.structuredContent === undefined
            ? null
            : this.toInputJsonValue(output.structuredContent),
        errorMessage: null,
        generatedAt: now.toISOString(),
      }),
    );

    /*
     * Supabase/network latency made Prisma's nested create visible as several
     * SQL round trips (idea row, prompt connect, generated-output createMany).
     * Persist those independent relational writes in one PostgreSQL CTE while
     * retaining the outer atomic transaction for entitlement/run guards.
     * Transaction-local advisory locks serialize only the same generation run
     * and the same normalized title, avoiding broad SERIALIZABLE conflicts while
     * preserving race protection for the resources that actually collide.
     * No business invariant is weakened: a missing/foreign prompt makes the
     * later guarded run attachment fail and rolls the entire transaction back.
     */
    const duplicateTitle = core.title
      .trim()
      .slice(0, MAX_DUPLICATE_TITLE_LENGTH);
    const rows = await transaction.$queryRaw<Array<{
      id: string | null;
      title: string | null;
      domainId: string | null;
      domainName: string | null;
      runId: string | null;
      runStatus: IdeaGenerationRunStatus | null;
      runProgressPercent: number | null;
      duplicateId: string | null;
      duplicateTitle: string | null;
    }>>(Prisma.sql`
      WITH settings AS (
        SELECT
          set_config('statement_timeout', ${`${PERSISTENCE_STATEMENT_TIMEOUT_MS}ms`}, true),
          set_config('lock_timeout', ${`${PERSISTENCE_LOCK_TIMEOUT_MS}ms`}, true),
          pg_advisory_xact_lock(hashtextextended(${`idea-run:${input.runId}`}, 0)),
          pg_advisory_xact_lock(hashtextextended(${`idea-title:${duplicateTitle.toLocaleLowerCase()}`}, 0))
      ),
      existing_duplicate AS (
        SELECT idea."id", idea."title"
        FROM "ideas" AS idea, settings
        WHERE idea."deleted_at" IS NULL
          AND lower(idea."title") = lower(${duplicateTitle})
        LIMIT 1
      ),
      eligible_run AS (
        SELECT
          run."id",
          run."status",
          run."progress_percent"
        FROM "idea_generation_runs" AS run, settings
        WHERE run."id" = ${input.runId}
          AND run."status"::text = ${IdeaGenerationRunStatus.RUNNING}
          AND run."idea_id" IS NULL
          AND run."cancel_requested_at" IS NULL
          AND run."generation_type"::text = ${input.generationType}
          AND run."user_id" IS NOT DISTINCT FROM ${input.userId ?? null}
          AND run."guest_session_id" IS NOT DISTINCT FROM ${input.guestSessionId ?? null}
          AND (
            run."collection_job_id" IS NULL
            OR run."collection_job_id" = ${input.collectionJobId}
          )
          AND EXISTS (
            SELECT 1
            FROM "prompt_histories" AS prompt
            WHERE prompt."id" = ${input.promptHistoryId}
              AND prompt."generation_run_id" = run."id"
              AND prompt."collection_job_id" = ${input.collectionJobId}
              AND prompt."idea_id" IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM "collection_jobs" AS collection
            WHERE collection."id" = ${input.collectionJobId}
              AND collection."domain_id" = ${input.collectionDomainId}
              AND (
                collection."created_by_id" IS NULL
                OR collection."created_by_id" IS NOT DISTINCT FROM ${input.userId ?? null}
              )
          )
        LIMIT 1
      ),
      inserted_idea AS (
        INSERT INTO "ideas" (
          "id", "user_id", "guest_session_id", "title",
          "limited_abstract", "partial_abstract", "full_abstract",
          "problem_statement", "generation_type", "is_unlocked",
          "unlock_method", "unlocked_at", "comments_count",
          "created_at", "updated_at", "selected_region", "domain_id",
          "collection_job_id", "objectives", "target_users"
        )
        SELECT
          ${ideaId},
          ${input.userId ?? null},
          ${input.guestSessionId ?? null},
          ${core.title},
          ${core.limitedAbstract ?? null},
          ${core.partialAbstract ?? null},
          ${core.fullAbstract ?? null},
          ${core.problemStatement},
          CAST(${input.generationType} AS "IdeaGenerationType"),
          ${isPremium},
          CAST(${isPremium ? UnlockMethod.CREDIT_GENERATION : UnlockMethod.NONE} AS "UnlockMethod"),
          ${isPremium ? now : null},
          ${commentsCount},
          ${now},
          ${now},
          ${input.selectedRegion},
          ${input.domainId},
          ${input.collectionJobId},
          CAST(${JSON.stringify(core.objectives)} AS jsonb),
          CAST(${JSON.stringify(core.targetUsers)} AS jsonb)
        FROM eligible_run
        WHERE NOT EXISTS (SELECT 1 FROM existing_duplicate)
        RETURNING "id", "title", "domain_id"
      ),
      linked_prompt AS (
        UPDATE "prompt_histories" AS prompt
        SET "idea_id" = ${ideaId}
        WHERE prompt."id" = ${input.promptHistoryId}
          AND prompt."generation_run_id" = ${input.runId}
          AND prompt."collection_job_id" = ${input.collectionJobId}
          AND prompt."idea_id" IS NULL
          AND EXISTS (SELECT 1 FROM inserted_idea)
        RETURNING prompt."id"
      ),
      inserted_outputs AS (
        INSERT INTO "generated_outputs" (
          "id", "idea_id", "content", "created_at", "updated_at",
          "error_message", "generated_at", "output_key", "sequence",
          "status", "structured_content", "title"
        )
        SELECT
          output."id",
          inserted_idea."id",
          output."content",
          ${now},
          ${now},
          NULL,
          CAST(output."generatedAt" AS timestamptz),
          output."outputKey",
          output."sequence",
          CAST(${GeneratedOutputStatus.COMPLETED} AS "GeneratedOutputStatus"),
          output."structuredContent",
          output."title"
        FROM inserted_idea
        CROSS JOIN jsonb_to_recordset(CAST(${JSON.stringify(generatedOutputs)} AS jsonb)) AS output(
          "id" text,
          "outputKey" text,
          "title" text,
          "sequence" integer,
          "content" text,
          "structuredContent" jsonb,
          "generatedAt" text
        )
        RETURNING "id"
      ),
      attached_run AS (
        UPDATE "idea_generation_runs" AS run
        SET
          "idea_id" = ${ideaId},
          "collection_job_id" = ${input.collectionJobId},
          "last_heartbeat_at" = NOW(),
          "updated_at" = NOW()
        WHERE run."id" IN (SELECT "id" FROM eligible_run)
          AND EXISTS (SELECT 1 FROM inserted_idea)
          AND EXISTS (SELECT 1 FROM linked_prompt)
        RETURNING run."id", run."status", run."progress_percent"
      )
      SELECT
        inserted_idea."id" AS "id",
        inserted_idea."title" AS "title",
        domain."id" AS "domainId",
        domain."name" AS "domainName",
        attached_run."id" AS "runId",
        attached_run."status" AS "runStatus",
        attached_run."progress_percent" AS "runProgressPercent",
        NULL::text AS "duplicateId",
        NULL::text AS "duplicateTitle"
      FROM inserted_idea
      INNER JOIN "domains" AS domain ON domain."id" = inserted_idea."domain_id"
      CROSS JOIN attached_run
      UNION ALL
      SELECT
        NULL::text AS "id",
        NULL::text AS "title",
        NULL::text AS "domainId",
        NULL::text AS "domainName",
        NULL::text AS "runId",
        NULL::"IdeaGenerationRunStatus" AS "runStatus",
        NULL::integer AS "runProgressPercent",
        existing_duplicate."id" AS "duplicateId",
        existing_duplicate."title" AS "duplicateTitle"
      FROM existing_duplicate
      WHERE NOT EXISTS (SELECT 1 FROM inserted_idea)
      LIMIT 1
    `);

    const created = rows[0];
    if (created?.duplicateId && created.duplicateTitle) {
      throw new ConflictException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
        message:
          'An idea with the same title already exists on the platform and cannot be generated again.',
        details: {
          matchedIdeaId: created.duplicateId,
          matchedTitle: created.duplicateTitle,
          duplicateReasons: ['EXACT_OR_NEAR_TITLE'],
          titleSimilarity: 1,
        },
      });
    }
    if (
      !created?.id ||
      !created.title ||
      !created.domainId ||
      !created.domainName ||
      !created.runId ||
      !created.runStatus ||
      created.runProgressPercent === null
    ) {
      throw new BadRequestException(
        'The generated idea could not be atomically persisted and attached to the active generation run.',
      );
    }

    return {
      idea: {
        id: created.id,
        title: created.title,
        domain: { id: created.domainId, name: created.domainName },
      },
      run: {
        id: created.runId,
        status: created.runStatus,
        progressPercent: created.runProgressPercent,
      },
      generatedOutputs: generatedOutputs
        .slice()
        .sort((first, second) => first.sequence - second.sequence)
        .map((output) => ({
          id: output.id,
          outputKey: output.outputKey,
        })),
    };
  }

  /**
   * Associates the prompt-history record with the persisted idea.
   *
   * The relation is owned by PromptHistory through ideaId.
   *
   * @param transaction Active Prisma transaction.
   * @param promptHistoryId Prompt-history identifier.
   * @param ideaId Persisted idea identifier.
   */
  /**
   * Persists every advanced output generated for the idea.
   *
   * Sequence values come from the centralized output registry,
   * preventing output order from depending on provider response
   * order or array position.
   *
   * @param transaction Active Prisma transaction.
   * @param ideaId Persisted parent-idea identifier.
   * @param parsedOutput Parsed and validated AI output.
   */
  /**
   * Links the persisted idea and collection job to the running
   * generation run without completing the run.
   *
   * Final completion remains the responsibility of the generation
   * pipeline after all required stages succeed.
   *
   * @param transaction Active Prisma transaction.
   * @param runId Generation-run identifier.
   * @param ideaId Newly persisted idea identifier.
   * @param collectionJobId Collection-job identifier.
   */
  private async attachIdeaToGenerationRun(
    transaction: IdeaPersistenceDatabaseClient,
    input: PersistGeneratedIdeaInput,
    ideaId: string,
  ): Promise<{
    readonly id: string;
    readonly status: IdeaGenerationRunStatus;
    readonly progressPercent: number;
  }> {
    /*
     * One guarded UPDATE replaces the previous successful-path
     * IdeaGenerationRun.findUnique + later updateMany pair. The predicates
     * preserve every run invariant and additionally verify that the prompt
     * belongs to this run and collection job, and that the supplied collection
     * job exists under the immutable collection-anchor domain. The idea's final
     * semantic domain may legitimately differ after multi-domain ranking. PostgreSQL RETURNING gives the small run snapshot
     * required by the stage without opening another round trip.
     */
    const rows = await transaction.$queryRaw<Array<{
      id: string;
      status: IdeaGenerationRunStatus;
      progressPercent: number;
    }>>(Prisma.sql`
      UPDATE "idea_generation_runs" AS run
      SET
        "idea_id" = ${ideaId},
        "collection_job_id" = ${input.collectionJobId},
        "last_heartbeat_at" = NOW(),
        "updated_at" = NOW()
      WHERE run."id" = ${input.runId}
        AND run."status"::text = ${IdeaGenerationRunStatus.RUNNING}
        AND run."idea_id" IS NULL
        AND run."cancel_requested_at" IS NULL
        AND run."generation_type"::text = ${input.generationType}
        AND run."user_id" IS NOT DISTINCT FROM ${input.userId ?? null}
        AND run."guest_session_id" IS NOT DISTINCT FROM ${input.guestSessionId ?? null}
        AND (
          run."collection_job_id" IS NULL
          OR run."collection_job_id" = ${input.collectionJobId}
        )
        AND EXISTS (
          SELECT 1
          FROM "prompt_histories" AS prompt
          WHERE prompt."id" = ${input.promptHistoryId}
            AND prompt."generation_run_id" = run."id"
            AND prompt."collection_job_id" = ${input.collectionJobId}
            AND prompt."idea_id" = ${ideaId}
        )
        AND EXISTS (
          SELECT 1
          FROM "collection_jobs" AS collection
          WHERE collection."id" = ${input.collectionJobId}
            AND collection."domain_id" = ${input.collectionDomainId}
            AND (
              collection."created_by_id" IS NULL
              OR collection."created_by_id" IS NOT DISTINCT FROM ${input.userId ?? null}
            )
        )
      RETURNING
        run."id",
        run."status",
        run."progress_percent" AS "progressPercent"
    `);

    const attached = rows[0];
    if (attached) {
      return attached;
    }

    /*
     * Failure-path diagnostics are deliberately outside the normal success
     * path. They preserve the previous precise exceptions while keeping healthy
     * persistence to one fewer remote database read.
     */
    await this.validateGenerationRun(transaction, input);
    await this.validateCollectionJob(transaction, input);

    throw new BadRequestException(
      'The generated idea could not be attached because the generation-run state changed.',
    );
  }

  /**
   * Sends a low or exhausted credit-balance email after the premium
   * persistence transaction has committed successfully.
   *
   * Email failures are contained by CreditBalanceNotificationService and
   * therefore never change the result of the already committed idea.
   */
  private async notifyPremiumCreditBalance(
    input: PersistGeneratedIdeaInput,
    creditAdjustment: CreditBalanceResult | null,
  ): Promise<void> {
    if (
      input.generationType !== IdeaGenerationType.PREMIUM_CREDIT ||
      !input.userId ||
      !creditAdjustment
    ) {
      return;
    }

    await this.creditBalanceNotificationService.notifyAfterCommittedBalanceChange(
      {
        userId: input.userId,
        previousBalance: creditAdjustment.previousBalance,
        balanceAfter: creditAdjustment.balanceAfter,
        referencePremiumIdeaCreditCost: input.creditsToConsume,
      },
    );
  }

  /**
   * Invalidates user credit caches after a premium deduction has
   * committed successfully.
   *
   * Cache failures must not roll back or misreport the already
   * committed idea.
   *
   * @param input Normalized persistence input.
   */
  private async invalidatePremiumCreditCaches(
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    if (
      input.generationType !== IdeaGenerationType.PREMIUM_CREDIT ||
      !input.userId
    ) {
      return;
    }

    try {
      await this.creditCacheService.invalidateUserCreditCaches(input.userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Premium idea persisted, but credit caches could not be invalidated for user "${input.userId}": ${message}`,
      );
    }
  }

  /**
   * Converts a validated JSON-compatible value into a Prisma JSON
   * input value.
   *
   * The parser guarantees that these values contain only valid JSON
   * primitives, objects, and arrays.
   *
   * @param value Validated JSON-compatible value.
   * @returns Prisma-compatible JSON input value.
   */
  private toInputJsonValue(value: JsonValue): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  /**
   * Ensures a required output string exists and is not blank.
   *
   * @param value Output value.
   * @param fieldName Required field name.
   * @param generationType Generation type requiring the field.
   */
  private requireNonBlankOutputField(
    value: string | undefined,
    fieldName: string,
    generationType: IdeaGenerationType,
  ): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(
        `${generationType} persistence requires a non-empty "${fieldName}" field.`,
      );
    }
  }

  /**
   * Normalizes and validates required text.
   *
   * @param value Raw text value.
   * @param fieldName Human-readable field name.
   * @returns Trimmed non-empty text.
   */
  private requireText(value: string, fieldName: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} is required.`);
    }

    const normalized = value.trim();

    if (!normalized) {
      throw new BadRequestException(`${fieldName} is required.`);
    }

    return normalized;
  }

  /**
   * Normalizes optional text values.
   *
   * Undefined, null, empty, and whitespace-only values become
   * undefined. Non-empty values are trimmed.
   *
   * @param value Optional text value.
   * @returns Trimmed text or undefined.
   */
  private normalizeOptionalText(
    value: string | null | undefined,
  ): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();

    return normalized || undefined;
  }

  /**
   * Determines whether a Prisma error represents a retryable
   * transaction conflict, lock timeout, or transient database interruption.
   *
   * @param error Unknown transaction error.
   * @returns Whether the complete transaction may be retried.
   */
  private isRetryableTransactionError(error: unknown): boolean {
    if (isTransientDatabaseError(error)) {
      return true;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2028', 'P2034'].includes(error.code)) {
        return true;
      }

      if (error.code === 'P2010') {
        const metadata = error.meta as Record<string, unknown> | undefined;
        const databaseCode = String(metadata?.code ?? '');
        if (['55P03', '57014', '40001', '40P01'].includes(databaseCode)) {
          return true;
        }
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return /(?:transaction already closed|expired transaction|connection pool|canceling statement due to (?:lock|statement) timeout|lock timeout|statement timeout|deadlock detected|could not serialize access)/iu.test(
      message,
    );
  }

  /**
   * Provides exhaustive handling if a new IdeaGenerationType is
   * introduced.
   *
   * @param generationType Unexpected generation type.
   */
  private assertNeverGenerationType(generationType: never): never {
    throw new BadRequestException(
      `Unsupported idea generation type "${String(generationType)}".`,
    );
  }
}