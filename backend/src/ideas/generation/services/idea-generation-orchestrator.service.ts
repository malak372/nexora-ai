import { Inject, Injectable, Logger } from '@nestjs/common';

import { IdeaGenerationRunStatus, IdeaGenerationType } from '@prisma/client';

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
  type IdeaGenerationLocation,
} from '../types/idea-generation-context.type';

import type { IdeaOwner } from '../../shared/types/idea-owner.type';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';

import { IDEA_GENERATION_ERROR_CODES } from '../constants/idea-generation.constants';

import { GuestIdeaSessionService } from './guest-idea-session.service';

import { IdeaGenerationLockService } from './idea-generation-lock.service';

import { IdeaGenerationRunService } from './idea-generation-run.service';

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
export class IdeaGenerationOrchestratorService {
  private readonly logger = new Logger(IdeaGenerationOrchestratorService.name);

  constructor(
    private readonly guestSessionService: GuestIdeaSessionService,

    private readonly lockService: IdeaGenerationLockService,

    private readonly runService: IdeaGenerationRunService,

    private readonly pipelineService: IdeaGenerationPipelineService,

    @Inject(IDEA_GENERATION_STAGES)
    private readonly stages: readonly IdeaGenerationStage[],
  ) {}

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
  async generateForUser(
    input: GenerateRegisteredIdeaInput,
  ): Promise<IdeaGenerationPipelineResult> {
    const userId = this.normalizeRequiredValue(input.userId, 'User ID');

    const owner: IdeaOwner = {
      type: IDEA_OWNER_TYPES.USER,
      userId,
    };

    return this.executeOwnedGeneration({
      owner,

      generationType: input.dto.generationType,

      domainId: input.dto.domainId,

      keywords: this.normalizeStringArray(input.dto.keywords),

      requestedDataSourceKeys: this.normalizeSourceKeys(
        input.dto.dataSourceKeys,
      ),

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

    return this.executeOwnedGeneration({
      owner,

      generationType: IdeaGenerationType.GUEST_FREE,

      domainId: input.dto.domainId,

      keywords: this.normalizeStringArray(input.dto.keywords),

      requestedDataSourceKeys: this.normalizeSourceKeys(
        input.dto.dataSourceKeys,
      ),

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

    return this.queueOwnedGeneration({
      owner: { type: IDEA_OWNER_TYPES.USER, userId },
      generationType: input.dto.generationType,
      domainId: input.dto.domainId,
      keywords: this.normalizeStringArray(input.dto.keywords),
      requestedDataSourceKeys: this.normalizeSourceKeys(
        input.dto.dataSourceKeys,
      ),
      location: {
        country: this.normalizeRequiredValue(input.dto.country, 'Country'),
        city: this.normalizeOptionalValue(input.dto.city),
        region: this.normalizeOptionalValue(input.dto.region),
        radiusKm: input.dto.radiusKm ?? null,
        language: input.dto.language,
      },
    });
  }

  /** Accepts a guest generation request and returns its run ID immediately. */
  async queueForGuest(
    input: GenerateGuestIdeaInput,
  ): Promise<QueuedIdeaGenerationResult> {
    const guestSession = await this.guestSessionService.resolveAvailableSession(
      input.guestSessionToken,
    );

    return this.queueOwnedGeneration({
      owner: {
        type: IDEA_OWNER_TYPES.GUEST,
        guestSessionId: guestSession.id,
      },
      generationType: IdeaGenerationType.GUEST_FREE,
      domainId: input.dto.domainId,
      keywords: this.normalizeStringArray(input.dto.keywords),
      requestedDataSourceKeys: this.normalizeSourceKeys(
        input.dto.dataSourceKeys,
      ),
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
    const run = await this.runService.createRun({
      ...(input.owner.type === IDEA_OWNER_TYPES.USER
        ? { userId: input.owner.userId }
        : { guestSessionId: input.owner.guestSessionId }),
      generationType: input.generationType,
    });

    setImmediate(() => {
      void this.executePreparedRun(run.id, input).catch((error: unknown) => {
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
    const run = await this.runService.createRun({
      ...(input.owner.type === IDEA_OWNER_TYPES.USER
        ? { userId: input.owner.userId }
        : { guestSessionId: input.owner.guestSessionId }),
      generationType: input.generationType,
    });

    return this.executePreparedRun(run.id, input);
  }

  /** Executes a previously created queued run. */
  private async executePreparedRun(
    runId: string,
    input: ExecuteOwnedIdeaGenerationInput,
  ): Promise<IdeaGenerationPipelineResult> {
    let lockAcquired = false;

    try {
      await this.lockService.acquire({ owner: input.owner, runId });
      lockAcquired = true;

      const context = this.buildInitialContext(runId, input);
      this.logger.log(`Starting idea-generation pipeline for run "${runId}".`);

      const result = await this.pipelineService.executePipeline({
        context,
        stages: this.stages,
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

      keywords: input.keywords,

      requestedDataSourceKeys: input.requestedDataSourceKeys,

      location: input.location,
    });
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
