/**
 * Persists validated generated ideas and consumes their generation
 * entitlement atomically.
 *
 * @author Malak
 */

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
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

import type {
  AdvancedIdeaAiOutput,
  IdeaAdvancedOutputKey,
  JsonValue,
  ParsedIdeaAiOutput,
} from '../types/idea-ai-output.type';

import { IdeaDuplicateDetectionService } from './idea-duplicate-detection.service';

/**
 * Maximum number of attempts used when a serializable transaction
 * fails because of a write conflict or deadlock.
 */
const SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 3;

/**
 * Maximum time Prisma may wait to acquire an interactive
 * transaction connection before failing the persistence attempt.
 */
const SERIALIZABLE_TRANSACTION_MAX_WAIT_MS = 10_000;

/**
 * Maximum lifetime of one interactive persistence transaction.
 *
 * The persistence flow performs several dependent validation and
 * write operations. The explicit timeout prevents Prisma's shorter
 * default timeout from closing the transaction before entitlement
 * consumption and generation-run linking are completed.
 */
const SERIALIZABLE_TRANSACTION_TIMEOUT_MS = 30_000;

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
   * Selected software-domain identifier.
   */
  readonly domainId: string;

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
 * - Retry retryable serializable transaction conflicts.
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

    private readonly duplicateDetectionService: IdeaDuplicateDetectionService,

    private readonly creditBalanceService: CreditBalanceService,

    private readonly creditBalanceNotificationService: CreditBalanceNotificationService,

    private readonly creditCacheService: CreditCacheService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  /**
   * Persists one generated idea and consumes its entitlement
   * inside one serializable Prisma transaction.
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
     * serializable transaction already validates the run, prompt history,
     * collection job, duplicate state, and entitlement immediately before
     * writing. Removing the three preflight queries saves database round-trips
     * without weakening atomicity or race protection.
     */
    const transactionStartedAt = Date.now();
    const transactionResult =
      await this.executeSerializableTransaction(normalizedInput);
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
     * The idea and entitlement are already committed. Cache invalidation and
     * notification are post-commit side effects and must not hold the user on
     * the generation screen. Execute them concurrently in the background while
     * preserving failure logging inside their dedicated services.
     */
    void Promise.allSettled([
      this.invalidatePremiumCreditCaches(normalizedInput),
      summaryInvalidation,
      this.notifyPremiumCreditBalance(
        normalizedInput,
        transactionResult.creditAdjustment,
      ),
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

  /**
   * Executes the persistence transaction with bounded retries for
   * retryable serializable write conflicts.
   *
   * Each retry runs the entire transaction again. Therefore, no
   * partial entitlement consumption or idea persistence can escape
   * a rolled-back attempt.
   *
   * @param input Normalized persistence input.
   * @returns Committed idea identifier and optional credit adjustment.
   */
  private async preflightGenerationRun(
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    const run = await this.prisma.ideaGenerationRun.findUnique({
      where: { id: input.runId },
      select: { id: true },
    });
    if (!run) {
      throw new NotFoundException(`Idea generation run "${input.runId}" was not found.`);
    }
  }

  private async preflightPromptHistory(
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    const prompt = await this.prisma.promptHistory.findUnique({
      where: { id: input.promptHistoryId },
      select: { generationRunId: true },
    });
    if (!prompt || prompt.generationRunId !== input.runId) {
      throw new BadRequestException(
        'The prompt history does not belong to the provided generation run.',
      );
    }
  }

  private async preflightCollectionJob(
    input: PersistGeneratedIdeaInput,
  ): Promise<void> {
    const collection = await this.prisma.collectionJob.findUnique({
      where: { id: input.collectionJobId },
      select: { domainId: true },
    });
    if (!collection || collection.domainId !== input.domainId) {
      throw new BadRequestException(
        'The collection job does not belong to the selected domain.',
      );
    }
  }

  private async executeSerializableTransaction(
    input: PersistGeneratedIdeaInput,
  ): Promise<IdeaPersistenceTransactionResult> {
    for (
      let attempt = 1;
      attempt <= SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          async (transaction): Promise<IdeaPersistenceTransactionResult> => {
            const timingStartedAt = Date.now();
            const [run] = await Promise.all([
              this.validateGenerationRun(transaction, input),
              this.duplicateDetectionService.assertNoExactTitleDuplicate(
                input.parsedOutput.coreIdea,
                transaction,
              ),
            ]);
            const validationMs = Date.now() - timingStartedAt;
            /*
             * CollectionJob is normally attached to the run before this stage.
             * Keep a defensive fallback for legacy/direct callers so removing
             * the normal-path round-trip never weakens domain validation.
             */
            if (!run.collectionJobId) {
              await this.validateCollectionJob(transaction, input);
            }

            const commentsCount = input.analyzedCommentsCount;

            /*
             * Create the base idea, attach prompt history, and insert all
             * generated outputs in one nested Prisma write. This removes two
             * remote database round-trips from the serializable transaction.
             */
            const ideaCreateStartedAt = Date.now();
            const created = await this.createIdeaWithRelations(
              transaction,
              input,
              commentsCount,
            );
            const ideaCreateMs = Date.now() - ideaCreateStartedAt;
            const idea = created.idea;

            const parallelWritesStartedAt = Date.now();
            const entitlementPromise = this.consumeEntitlement(
              transaction,
              input,
              idea.id,
            );
            const runAttachPromise = this.attachIdeaToGenerationRun(
              transaction,
              run.id,
              idea.id,
              input.collectionJobId,
            );
            /*
             * Generated outputs and PromptHistory are now nested into the idea
             * creation query. Only the entitlement deduction and guarded run
             * attachment remain after the base create, reducing the number of
             * serial round-trips on Prisma's single interactive-transaction
             * connection.
             */
            const [creditAdjustment] = await Promise.all([
              entitlementPromise,
              runAttachPromise,
            ]);
            const parallelWritesMs = Date.now() - parallelWritesStartedAt;

            this.logger.debug(
              `Idea persistence DB timing for run "${input.runId}": validation=${validationMs}ms, ideaCreate=${ideaCreateMs}ms, parallelWrites=${parallelWritesMs}ms, transactionBody=${Date.now() - timingStartedAt}ms.`,
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
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: SERIALIZABLE_TRANSACTION_MAX_WAIT_MS,
            timeout: SERIALIZABLE_TRANSACTION_TIMEOUT_MS,
          },
        );
      } catch (error: unknown) {
        if (
          !this.isRetryableTransactionError(error) ||
          attempt === SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS
        ) {
          throw error;
        }

        this.logger.warn(
          `Retrying idea-persistence transaction after a serializable conflict. Attempt ${attempt + 1}/${SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS}.`,
        );
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
        .replace(/\bNext\s*\.\s*js\b/giu, 'Next.js')
        .replace(/\bNest\s*\.\s*js\b/giu, 'NestJS')
        .replace(/\bNode\s*\.\s*js\b/giu, 'Node.js')
        .replace(/\bReact\s*\.\s*js\b/giu, 'React')
        .replace(/\s+([,.;:!?])/gu, '$1')
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
        .trim();

      const region = selectedRegion.trim();
      if (region.length >= 2) {
        const escaped = region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        sanitized = sanitized.replace(
          new RegExp(`\\b${escaped}\\b`, 'giu'),
          region.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()),
        );
      }
      return sanitized;
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
        targetUsers: parsedOutput.coreIdea.targetUsers.map(sanitizeText),
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
          select: { id: true },
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

    return run;
  }

  /**
   * Validates the referenced collection job.
   *
   * The collection job must exist and belong to the selected
   * domain.
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

    if (collectionJob.domainId !== input.domainId) {
      throw new BadRequestException(
        'The collection job does not belong to the selected domain.',
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

    const user = await transaction.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        freeGenerationLimit: true,
        freeGenerationsUsed: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const updated = await transaction.user.updateMany({
      where: {
        id: user.id,

        freeGenerationsUsed: {
          lt: user.freeGenerationLimit,
        },
      },

      data: {
        freeGenerationsUsed: {
          increment: 1,
        },
      },
    });

    if (updated.count !== 1) {
      throw new BadRequestException(
        'No remaining free generations are available.',
      );
    }
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
            ? undefined
            : this.toInputJsonValue(output.structuredContent),
        errorMessage: null,
        generatedAt: now,
      }),
    );

    const idea = await transaction.idea.create({
      data: {
        userId: input.userId ?? null,
        guestSessionId: input.guestSessionId ?? null,
        domainId: input.domainId,
        collectionJobId: input.collectionJobId,
        commentsCount,
        selectedRegion: input.selectedRegion,
        title: core.title,
        problemStatement: core.problemStatement,
        objectives: this.toInputJsonValue(core.objectives),
        targetUsers: this.toInputJsonValue(core.targetUsers),
        limitedAbstract: core.limitedAbstract ?? null,
        partialAbstract: core.partialAbstract ?? null,
        fullAbstract: core.fullAbstract ?? null,
        generationType: input.generationType,
        isUnlocked: isPremium,
        unlockMethod: isPremium
          ? UnlockMethod.CREDIT_GENERATION
          : UnlockMethod.NONE,
        unlockedAt: isPremium ? now : null,

        /*
         * These relations do not depend on entitlement consumption and can be
         * persisted by Prisma as part of the same nested create. This removes
         * separate PromptHistory.update + GeneratedOutput.createMany calls.
         */
        promptHistories: {
          connect: { id: input.promptHistoryId },
        },
        ...(generatedOutputs.length > 0
          ? {
              generatedOutputs: {
                createMany: {
                  data: generatedOutputs.map((output) => ({
                    id: output.id,
                    outputKey: output.outputKey,
                    title: output.title,
                    sequence: output.sequence,
                    status: output.status,
                    content: output.content,
                    structuredContent:
                      output.structuredContent === undefined
                        ? Prisma.JsonNull
                        : output.structuredContent,
                    errorMessage: output.errorMessage,
                    generatedAt: output.generatedAt,
                  })),
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        domain: {
          select: { id: true, name: true },
        },
      },
    });

    return {
      idea,
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
    runId: string,
    ideaId: string,
    collectionJobId: string,
  ): Promise<void> {
    const updated = await transaction.ideaGenerationRun.updateMany({
      where: {
        id: runId,

        status: IdeaGenerationRunStatus.RUNNING,

        ideaId: null,

        cancelRequestedAt: null,
      },

      data: {
        ideaId,

        collectionJobId,

        lastHeartbeatAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      throw new BadRequestException(
        'The generated idea could not be attached because the generation-run state changed.',
      );
    }
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
   * serializable write conflict or deadlock.
   *
   * @param error Unknown transaction error.
   * @returns Whether the complete transaction may be retried.
   */
  private isRetryableTransactionError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
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