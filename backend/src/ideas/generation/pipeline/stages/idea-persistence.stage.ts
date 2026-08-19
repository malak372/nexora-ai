/**
 * Persists validated generated ideas through the transactional
 * idea-persistence service.
 *
 * @author Malak
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { IdeaGenerationType } from '@prisma/client';

import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import { IdeaPersistenceService } from '../../services/idea-persistence.service';
import { IdeaDuplicateDetectionService } from '../../services/idea-duplicate-detection.service';

import type {
  IdeaAdvancedOutputKey,
  ParsedIdeaAiOutput,
} from '../../types/idea-ai-output.type';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';

/**
 * Persists a validated generated idea and consumes its generation
 * entitlement atomically.
 *
 * Responsibilities:
 * - Verify all persistence prerequisites.
 * - Verify generation-policy consistency.
 * - Verify owner and generation-type consistency.
 * - Build the normalized parsed AI-output object.
 * - Delegate transactional persistence to IdeaPersistenceService.
 * - Consume guest, free-user, or premium-credit entitlement.
 * - Persist advanced GeneratedOutput records.
 * - Attach the created idea and collection job to the generation
 *   run.
 * - Store persisted identifiers in the pipeline context.
 *
 * IdeaPersistenceService performs a second duplicate check inside
 * the serializable transaction to protect against concurrent
 * persistence races.
 *
 * This stage does not:
 * - Mark the generation run as completed.
 * - Set generation progress to 100 percent.
 * - Publish the generated idea.
 * - Generate additional AI content.
 * - Directly execute Prisma persistence operations.
 *
 * Generation-run completion remains the responsibility of
 * IdeaGenerationPipelineService after every required stage
 * succeeds.
 */
@Injectable()
export class IdeaPersistenceStage implements IdeaGenerationStage {
  private readonly logger = new Logger(IdeaPersistenceStage.name);
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly persistenceService: IdeaPersistenceService,
    private readonly duplicateDetectionService: IdeaDuplicateDetectionService,
  ) {}

  /**
   * Persists the generated idea and enriches the context with
   * persisted identifiers.
   *
   * @param context Current generation context.
   * @returns Updated context containing persisted identifiers.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const policy = context.policy;

    const prompt = context.prompt;

    const collection = context.collection;

    const coreIdea = context.coreIdea;

    if (!policy || !prompt || !collection || !coreIdea) {
      this.throwPersistenceError(
        'Idea persistence prerequisites became unavailable after validation.',
      );
    }

    let persistenceCoreIdea = coreIdea;
    let persistenceAdvancedOutputs = [...context.advancedOutputs];
    let persistedIdea: Awaited<
      ReturnType<IdeaPersistenceService['persistIdea']>
    > | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parsedOutput: ParsedIdeaAiOutput = {
        coreIdea: persistenceCoreIdea,
        advancedOutputs: persistenceAdvancedOutputs,
      };

      try {
        persistedIdea = await this.persistenceService.persistIdea({
          runId: context.runId,
          promptHistoryId: prompt.promptHistoryId,
          userId:
            context.owner.type === IDEA_OWNER_TYPES.USER
              ? context.owner.userId
              : undefined,
          guestSessionId:
            context.owner.type === IDEA_OWNER_TYPES.GUEST
              ? context.owner.guestSessionId
              : undefined,
          domainId: context.domainId,
          selectedRegion: this.resolveSelectedRegion(context),
          collectionJobId: collection.collectionJobId,
          generationType: context.generationType,
          creditsToConsume: policy.creditsToConsume,
          analyzedCommentsCount:
            context.nlp?.totalCommentsAnalyzed ?? collection.totalComments ?? 0,
          parsedOutput,
        });
        break;
      } catch (error: unknown) {
        if (!this.isExactTitleRace(error) || attempt >= 3) {
          throw error;
        }

        const previousTitle = persistenceCoreIdea.title;
        const raceSafe = await this.buildRaceSafeDistinctOutput(
          context,
          persistenceCoreIdea,
          persistenceAdvancedOutputs,
          attempt + 1,
        );
        persistenceCoreIdea = raceSafe.coreIdea;
        persistenceAdvancedOutputs = raceSafe.advancedOutputs;

        this.logger.warn(
          `An exact-title race was detected while persisting run "${context.runId}". Retrying atomically with distinct collision-safe title "${persistenceCoreIdea.title}" instead of failing the generation run. previousTitle="${previousTitle}"`,
        );
      }
    }

    if (!persistedIdea) {
      this.throwPersistenceError(
        'Idea persistence did not return a committed idea after bounded collision-safe retries.',
      );
    }

    if (!Array.isArray(persistedIdea.generatedOutputs)) {
      this.throwPersistenceError(
        'Persisted generated outputs were not returned by the persistence service.',
      );
    }

    const generatedOutputIdsByKey = persistedIdea.generatedOutputs.reduce<
      Partial<Record<IdeaAdvancedOutputKey, string>>
    >((result, output) => {
      result[output.outputKey as IdeaAdvancedOutputKey] = output.id;
      return result;
    }, {});

    const updatedContext: IdeaGenerationContext = {
      ...context,
      coreIdea: persistenceCoreIdea,
      advancedOutputs: persistenceAdvancedOutputs,
      ideaId: persistedIdea.id,
      generatedOutputIdsByKey,
    };

    return {
      context: updatedContext,

      resultPreview: this.buildResultPreview(
        persistedIdea.id,
        persistedIdea.title,
        Object.keys(generatedOutputIdsByKey).length,
      ),

      metadata: {
        ideaId: persistedIdea.id,

        title: persistedIdea.title,

        domainId: persistedIdea.domain.id,

        domainName: persistedIdea.domain.name,

        collectionJobId: collection.collectionJobId,

        generatedOutputsCount: persistedIdea.generatedOutputs.length,

        generatedOutputIdsByKey,

        generationRunId: persistedIdea.generationRun?.id ?? context.runId,

        generationRunStatus: persistedIdea.generationRun?.status ?? null,

        generationType: context.generationType,

        ownerType: context.owner.type,

        entitlementConsumed: true,

        ideaPersisted: true,
      },
    };
  }


  private isExactTitleRace(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }

    const response = (error as { getResponse: () => unknown }).getResponse();
    if (typeof response === 'string') {
      return /same title|duplicate|already exists/iu.test(response);
    }

    if (!response || typeof response !== 'object') {
      return false;
    }

    const record = response as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : '';
    const message = typeof record.message === 'string' ? record.message : '';
    const details =
      record.details && typeof record.details === 'object'
        ? (record.details as Record<string, unknown>)
        : null;
    const reasons = Array.isArray(details?.duplicateReasons)
      ? details?.duplicateReasons.map(String)
      : [];

    return (
      code === IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA &&
      (/same title|already exists/iu.test(message) ||
        reasons.includes('EXACT_OR_NEAR_TITLE'))
    );
  }

  private async buildRaceSafeDistinctOutput(
    context: IdeaGenerationContext,
    currentCoreIdea: ParsedIdeaAiOutput['coreIdea'],
    currentAdvancedOutputs: ParsedIdeaAiOutput['advancedOutputs'],
    seedAttempt: number,
  ): Promise<{
    readonly coreIdea: ParsedIdeaAiOutput['coreIdea'];
    readonly advancedOutputs: ParsedIdeaAiOutput['advancedOutputs'];
  }> {
    const variants = [
      {
        suffix: 'Evidence Trace Edition',
        focus:
          'evidence provenance, discrepancy review, reviewer ownership, and traceable closure',
      },
      {
        suffix: 'Case Review Edition',
        focus:
          'case intake, exception classification, reviewer handoff, and audited disposition',
      },
      {
        suffix: 'Pilot Operations Edition',
        focus:
          'pilot signal capture, unresolved-case aging, ownership transitions, and human-reviewed resolution',
      },
      {
        suffix: 'Decision Audit Edition',
        focus:
          'decision provenance, supporting-record comparison, contradiction tracking, and final approval history',
      },
    ] as const;
    const country = context.location.country?.trim() || 'the selected pilot region';

    for (let offset = 0; offset < variants.length; offset += 1) {
      const variant = variants[(seedAttempt - 1 + offset) % variants.length];
      const nextTitle = this.buildRaceSafeTitle(
        currentCoreIdea.title,
        context.runId,
        seedAttempt + offset,
        variant.suffix,
      );
      const nextCoreIdea: ParsedIdeaAiOutput['coreIdea'] = {
        ...currentCoreIdea,
        title: nextTitle,
        problemStatement: [
          currentCoreIdea.problemStatement,
          `This edition narrows the implementation to ${variant.focus} so the workflow remains materially distinct while preserving the same grounded problem.`,
        ]
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim(),
        objectives: [
          `Create a structured intake for ${variant.focus} with source provenance, status, owner, and review history.`,
          'Separate confirmed evidence from assumptions and route uncertain cases to an authorized reviewer before any downstream action.',
          'Maintain a focused queue and immutable handoff history so each exception has one visible owner, next action, and reviewed closure state.',
          `Establish a baseline during the pilot in ${country} and measure directional change in unresolved-case age and coordination errors without unsupported percentage targets.`,
        ],
        ...(currentCoreIdea.fullAbstract
          ? {
              fullAbstract: `${nextTitle} is a focused workflow for ${variant.focus}. It preserves the already-grounded problem while changing the operational control loop to intake, evidence qualification, reviewer assignment, handoff tracking, and audited closure. Authorized users register only the minimum supporting records, document uncertainty, and route consequential decisions to human review. The implementation uses a NestJS backend, PostgreSQL persistence, a responsive web client, role-based access control, encrypted transport, and immutable audit logging. The pilot in ${country} first establishes a baseline and then measures directional change without claiming unsupported market-wide prevalence.`,
            }
          : {}),
        ...(currentCoreIdea.partialAbstract
          ? {
              partialAbstract: `${nextTitle} focuses on ${variant.focus} around the same grounded problem, with explicit evidence provenance and human-reviewed decisions.`,
            }
          : {}),
        ...(currentCoreIdea.limitedAbstract
          ? {
              limitedAbstract: `${nextTitle} is a focused pilot for ${variant.focus} with traceable evidence and human-reviewed decisions.`,
            }
          : {}),
      };
      const duplicateResult = await this.duplicateDetectionService.check(
        context.domainId,
        context.collection!.collectionJobId,
        nextCoreIdea,
      );

      if (!duplicateResult.isDuplicate) {
        return {
          coreIdea: nextCoreIdea,
          advancedOutputs: this.rewriteOutputTitle(
            currentAdvancedOutputs,
            currentCoreIdea.title,
            nextTitle,
          ),
        };
      }
    }

    const fallbackTitle = this.buildRaceSafeTitle(
      currentCoreIdea.title,
      context.runId,
      seedAttempt + variants.length,
      'Evidence Qualification Edition',
    );
    const fallbackCoreIdea: ParsedIdeaAiOutput['coreIdea'] = {
      ...currentCoreIdea,
      title: fallbackTitle,
      problemStatement: `${currentCoreIdea.problemStatement} This bounded edition is an evidence-qualification and implementation-decision workflow rather than another end-to-end operational solution.`,
      objectives: [
        'Register traceable evidence and distinguish direct observations, secondary reports, requester statements, and unresolved assumptions.',
        'Compare source independence, domain fit, contradiction signals, and problem specificity before any implementation decision is approved.',
        'Maintain a reviewer ledger for accepted, rejected, and unresolved signals so repeated product implementations are not generated from the same weak evidence.',
        'Produce a human-approved build, narrow, pivot, or stop decision with the exact evidence supporting that decision.',
      ],
      ...(currentCoreIdea.fullAbstract
        ? {
            fullAbstract: `${fallbackTitle} is an evidence-qualification workspace for deciding whether the grounded problem justifies a new implementation. It stores source provenance, direct-versus-secondary evidence status, contradiction notes, reviewer decisions, and unresolved questions. Its output is a reviewed build, narrow, pivot, or stop recommendation rather than another operational product that repeats an existing idea.`,
          }
        : {}),
    };

    return {
      coreIdea: fallbackCoreIdea,
      advancedOutputs: this.rewriteOutputTitle(
        currentAdvancedOutputs,
        currentCoreIdea.title,
        fallbackTitle,
      ),
    };
  }

  private buildRaceSafeTitle(
    originalTitle: string,
    runId: string,
    attempt: number,
    explicitSuffix?: string,
  ): string {
    const suffixes = [
      'Evidence Trace Edition',
      'Case Review Edition',
      'Pilot Operations Edition',
      'Decision Audit Edition',
    ] as const;
    const hash = [...runId].reduce(
      (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
      0,
    );
    const suffix =
      explicitSuffix ?? suffixes[(hash + attempt - 1) % suffixes.length];
    const cleanBase = originalTitle
      .replace(
        /\s+(Evidence Trace Edition|Case Review Edition|Pilot Operations Edition|Decision Audit Edition|Evidence Qualification Edition)$/iu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();

    return `${cleanBase} ${suffix}`.replace(/\s+/gu, ' ').trim().slice(0, 100);
  }

  private rewriteOutputTitle(
    outputs: readonly ParsedIdeaAiOutput['advancedOutputs'][number][],
    previousTitle: string,
    nextTitle: string,
  ): ParsedIdeaAiOutput['advancedOutputs'] {
    if (!previousTitle.trim() || previousTitle === nextTitle) {
      return outputs.map((output) => ({ ...output }));
    }

    const escaped = previousTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(escaped, 'giu');

    return outputs.map((output) => ({
      ...output,
      content: output.content.replace(pattern, nextTitle),
    }));
  }

  /**
   * Validates all values required before opening the persistence
   * transaction.
   *
   * @param context Current generation context.
   *
   * @throws BadRequestException When persistence prerequisites are
   * missing or inconsistent.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      this.throwPersistenceError(
        'Generation entitlement must be resolved before idea persistence.',
      );
    }

    if (context.policy.generationType !== context.generationType) {
      this.throwPersistenceError(
        'Resolved generation policy does not match the pipeline generation type.',
      );
    }

    if (!context.prompt) {
      this.throwPersistenceError(
        'Persisted prompt information is required before idea persistence.',
      );
    }

    if (
      typeof context.prompt.promptHistoryId !== 'string' ||
      context.prompt.promptHistoryId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid prompt-history identifier is required before idea persistence.',
      );
    }

    if (!context.coreIdea) {
      this.throwPersistenceError(
        'Validated core idea output is required before idea persistence.',
      );
    }

    if (!Array.isArray(context.advancedOutputs)) {
      this.throwPersistenceError(
        'Validated advanced outputs must be represented as an array.',
      );
    }

    if (!context.collection) {
      this.throwPersistenceError(
        'A resolved collection job is required before idea persistence.',
      );
    }

    if (
      typeof context.collection.collectionJobId !== 'string' ||
      context.collection.collectionJobId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid collection-job identifier is required before idea persistence.',
      );
    }

    if (
      typeof context.runId !== 'string' ||
      context.runId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid generation-run identifier is required before idea persistence.',
      );
    }

    if (
      typeof context.domainId !== 'string' ||
      context.domainId.trim().length === 0
    ) {
      this.throwPersistenceError(
        'A valid domain identifier is required before idea persistence.',
      );
    }

    if (context.ideaId) {
      this.throwPersistenceError(
        'The generation context is already linked to a persisted idea.',
      );
    }

    if (Object.keys(context.generatedOutputIdsByKey).length > 0) {
      this.throwPersistenceError(
        'The generation context is already linked to persisted generated outputs.',
      );
    }

    this.validateOwner(context);
  }

  /**
   * Validates that the resolved owner is compatible with the
   * authorized generation type.
   *
   * Guest generation must belong to a guest session.
   * Authenticated free and premium generation must belong to a
   * registered user.
   *
   * @param context Current generation context.
   */
  private validateOwner(context: IdeaGenerationContext): void {
    switch (context.generationType) {
      case IdeaGenerationType.GUEST_FREE:
        if (context.owner.type !== IDEA_OWNER_TYPES.GUEST) {
          this.throwPersistenceError(
            'Guest-free generation must be associated with a guest session.',
          );
        }

        if (
          typeof context.owner.guestSessionId !== 'string' ||
          context.owner.guestSessionId.trim().length === 0
        ) {
          this.throwPersistenceError(
            'A valid guest-session identifier is required for guest generation.',
          );
        }

        return;

      case IdeaGenerationType.NORMAL_FREE:
      case IdeaGenerationType.PREMIUM_CREDIT:
        if (context.owner.type !== IDEA_OWNER_TYPES.USER) {
          this.throwPersistenceError(
            `${context.generationType} generation must be associated with an authenticated user.`,
          );
        }

        if (
          typeof context.owner.userId !== 'string' ||
          context.owner.userId.trim().length === 0
        ) {
          this.throwPersistenceError(
            'A valid user identifier is required for authenticated idea generation.',
          );
        }

        return;

      default:
        this.assertNeverGenerationType(context.generationType);
    }
  }

  /**
   * Resolves the most specific selected geographic region stored
   * on the generated idea.
   *
   * Priority:
   * - Explicit region.
   * - City.
   * - Country.
   *
   * Blank location values are ignored.
   *
   * @param context Current generation context.
   * @returns Most specific selected location value.
   */
  private resolveSelectedRegion(context: IdeaGenerationContext): string {
    const candidates = [
      context.location.region,
      context.location.city,
      context.location.country,
    ];

    const selectedRegion = candidates.find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );

    if (!selectedRegion) {
      this.throwPersistenceError(
        'A valid geographic location is required before idea persistence.',
      );
    }

    return selectedRegion.trim();
  }

  /**
   * Builds a safe stage-result preview.
   *
   * @param ideaId Persisted idea identifier.
   * @param title Persisted idea title.
   * @param generatedOutputsCount Number of persisted outputs.
   * @returns Human-readable persistence result preview.
   */
  private buildResultPreview(
    ideaId: string,
    title: string,
    generatedOutputsCount: number,
  ): string {
    const outputDescription =
      generatedOutputsCount > 0
        ? ` with ${generatedOutputsCount} generated outputs`
        : '';

    return (
      `Generated idea "${title}" ` +
      `(${ideaId}) was persisted successfully` +
      `${outputDescription}.`
    );
  }

  /**
   * Throws a consistent persistence-stage exception.
   *
   * @param message Safe human-readable error message.
   * @param details Optional safe error details.
   *
   * @throws BadRequestException Always.
   */
  private throwPersistenceError(
    message: string,
    details?: Record<string, unknown>,
  ): never {
    throw new BadRequestException({
      code: IDEA_GENERATION_ERROR_CODES.PERSISTENCE_FAILED,

      message,

      ...(details ?? {}),
    });
  }

  /**
   * Provides exhaustive handling if a new generation type is
   * introduced.
   *
   * @param generationType Unexpected generation type.
   */
  private assertNeverGenerationType(generationType: never): never {
    return this.throwPersistenceError(
      `Unsupported idea generation type "${String(generationType)}".`,
    );
  }

  /**
   * Resolves the static stage definition from the centralized
   * stage registry.
   *
   * @returns Idea-persistence stage definition.
   */
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