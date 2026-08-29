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
import { RequestProductBlueprintUtil } from '../../utils/request-product-blueprint.util';

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

    // Ungrounded discovery titles are intentionally descriptive and may be
    // repeated for the same domain set. Resolve an existing exact title before
    // entering the serializable persistence transaction so the common case
    // does not pay for a failed transaction plus a retry.
    if (
      (context.evidenceState === 'NO_VALID_EVIDENCE_FOUND' || context.evidenceState === 'EVIDENCE_ADJUDICATION_UNAVAILABLE') &&
      !(await this.isExactTitleAvailable(persistenceCoreIdea))
    ) {
      const raceSafe = await this.buildRaceSafeDistinctOutput(
        context,
        persistenceCoreIdea,
        persistenceAdvancedOutputs,
        1,
      );
      persistenceCoreIdea = raceSafe.coreIdea;
      persistenceAdvancedOutputs = raceSafe.advancedOutputs;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const parsedOutput: ParsedIdeaAiOutput = {
        coreIdea: persistenceCoreIdea,
        advancedOutputs: persistenceAdvancedOutputs,
      };

      try {
        const collectionAnchorDomainId =
          collection.anchorDomainId ??
          context.domainResolution?.selectedDomain.id ??
          context.domainEvidence.find(
            (entry) => entry.collectionJobId === collection.collectionJobId,
          )?.domainId ??
          context.domainId;
        const allowedIdeaDomainIds = context.selectedDomains.map(
          (domain) => domain.id,
        );

        if (
          allowedIdeaDomainIds.length > 0 &&
          (!allowedIdeaDomainIds.includes(context.domainId) ||
            !allowedIdeaDomainIds.includes(collectionAnchorDomainId))
        ) {
          this.throwPersistenceError(
            'The idea domain or collection anchor escaped the validated generation domain scope.',
          );
        }

        if (collectionAnchorDomainId !== context.domainId) {
          this.logger.debug(
            `Persisting multi-domain run "${context.runId}" with semantic idea domain "${context.domainId}" and collection anchor domain "${collectionAnchorDomainId}".`,
          );
        }

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
          collectionDomainId: collectionAnchorDomainId,
          allowedIdeaDomainIds,
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
        if (!this.isExactTitleRace(error)) {
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
    const semanticTitles = this.buildRaceSafeSemanticTitles(
      context,
      currentCoreIdea.title,
    );
    const variants = [
      'Operations Workspace',
      'Coordination Hub',
      'Decision Support',
      'Workflow Manager',
      'Operations Console',
      'Pilot Workspace',
    ] as const;
    const attempts = semanticTitles.length > 0
      ? semanticTitles
      : variants.map((suffix, offset) =>
          this.buildRaceSafeTitle(
            currentCoreIdea.title,
            context.runId,
            seedAttempt + offset,
            suffix,
          ),
        );

    for (let offset = 0; offset < attempts.length; offset += 1) {
      const nextTitle = attempts[(seedAttempt - 1 + offset) % attempts.length];
      const nextCoreIdea = this.rewriteCoreIdeaTitle(
        currentCoreIdea,
        nextTitle,
      );

      if (await this.isExactTitleAvailable(nextCoreIdea)) {
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

    const fallbackTitle = await this.buildGuaranteedCollisionSafeTitle(
      currentCoreIdea,
      semanticTitles,
      seedAttempt,
    );

    return {
      coreIdea: this.rewriteCoreIdeaTitle(currentCoreIdea, fallbackTitle),
      advancedOutputs: this.rewriteOutputTitle(
        currentAdvancedOutputs,
        currentCoreIdea.title,
        fallbackTitle,
      ),
    };
  }

  private async isExactTitleAvailable(
    coreIdea: ParsedIdeaAiOutput['coreIdea'],
  ): Promise<boolean> {
    try {
      await this.duplicateDetectionService.assertNoExactTitleDuplicate(coreIdea);
      return true;
    } catch (error: unknown) {
      if (this.isExactTitleRace(error)) {
        return false;
      }
      throw error;
    }
  }

  private async buildGuaranteedCollisionSafeTitle(
    currentCoreIdea: ParsedIdeaAiOutput['coreIdea'],
    semanticTitles: readonly string[],
    seedAttempt: number,
  ): Promise<string> {
    const preferredTitle =
      semanticTitles[(seedAttempt - 1) % Math.max(semanticTitles.length, 1)] ??
      currentCoreIdea.title;
    const cleanBase = preferredTitle
      .replace(/\s+Workspace$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();

    const buildBoundedWorkspaceTitle = (identity: string): string => {
      const trailingIdentity = `${identity} Workspace`;
      const maximumBaseLength = Math.max(
        12,
        100 - trailingIdentity.length - 1,
      );
      const boundedBase = cleanBase.slice(0, maximumBaseLength).trim();

      return `${boundedBase} ${trailingIdentity}`
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 100);
    };

    const humanReadableIdentities = [
      'Continuity Review',
      'Recovery Operations',
      'Resolution Review',
      'Operational Continuity',
      'Exception Review',
      'Service Recovery',
      'Decision Review',
      'Follow-up Operations',
    ] as const;

    for (const identity of humanReadableIdentities) {
      const candidate = buildBoundedWorkspaceTitle(identity);
      if (
        await this.isExactTitleAvailable({
          ...currentCoreIdea,
          title: candidate,
        })
      ) {
        return candidate;
      }
    }

    /*
     * Exact-title uniqueness is a persistence concern, not a product-identity
     * concern. If every semantic and human-readable identity is already used,
     * advance through readable operation variants instead of exposing a run
     * UUID, database token, or internal "Trace Review Edition" label. Each
     * candidate is checked against the database before it is returned.
     */
    const variantsPerAttempt = 32;
    const firstVariant = 2 + Math.max(0, seedAttempt - 1) * variantsPerAttempt;
    let lastCandidate = buildBoundedWorkspaceTitle(
      `Operations ${firstVariant}`,
    );

    for (
      let variant = firstVariant;
      variant < firstVariant + variantsPerAttempt;
      variant += 1
    ) {
      const candidate = buildBoundedWorkspaceTitle(`Operations ${variant}`);
      lastCandidate = candidate;
      if (
        await this.isExactTitleAvailable({
          ...currentCoreIdea,
          title: candidate,
        })
      ) {
        return candidate;
      }
    }

    return lastCandidate;
  }

  private isDomainsOnlyPath(context: IdeaGenerationContext): boolean {
    return (
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_SELECTED'
    );
  }

  private buildDomainsOnlyRaceSafeTitles(currentTitle: string): string[] {
    const stem = currentTitle
      .replace(
        /\s+(?:(?:Trace|Case|Integrity|Exception|Pilot) Review|Decision Trace|Decision Audit|Evidence Trace|Human Review|Exception Resolution|Resolution Trace)(?: Edition| Workspace)?$/iu,
        '',
      )
      .replace(/\s+(?:edition|workspace|hub|platform|console|desk|board|ledger|assistant)$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const hadDecisionSuffix = /\s*&\s*Decision(?:\s+Workspace)?$/iu.test(
      currentTitle,
    );
    const semanticBase = stem.replace(/\s*&\s*Decision$/iu, '').trim() || stem;
    const decisionAuditTitle = hadDecisionSuffix
      ? `${semanticBase} & Decision Audit Workspace`
      : `${semanticBase} Decision Audit Workspace`;

    return [
      `${semanticBase} Evidence Trace Workspace`,
      `${semanticBase} Case Review Workspace`,
      decisionAuditTitle,
      `${semanticBase} Exception Resolution Workspace`,
      `${semanticBase} Human Review Workspace`,
      `${semanticBase} Resolution Trace Workspace`,
    ].map((title) => title.slice(0, 100));
  }

  private isNoInputPreferencePath(context: IdeaGenerationContext): boolean {
    return (
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_PREFERENCE'
    );
  }

  private buildRaceSafeSemanticTitles(
    context: IdeaGenerationContext,
    currentTitle: string,
  ): string[] {
    if ((context.evidenceState === 'NO_VALID_EVIDENCE_FOUND' || context.evidenceState === 'EVIDENCE_ADJUDICATION_UNAVAILABLE')) {
      const domainLabel = [
        ...new Set(
          context.selectedDomains
            .map((domain) => domain.name.trim())
            .filter(Boolean),
        ),
      ]
        .slice(0, 3)
        .join(' & ') || context.domainName?.trim() || 'Software';
      return [
        `${domainLabel} Problem Signal Discovery Workspace`,
        `${domainLabel} Evidence Validation Workspace`,
        `${domainLabel} Problem Evidence Review Workspace`,
        `${domainLabel} Validation Intake Workspace`,
        `${domainLabel} Evidence Qualification Workspace`,
        `${domainLabel} Problem Discovery & Validation Workspace`,
      ].map((title) => title.slice(0, 100));
    }

    if (this.isDomainsOnlyPath(context)) {
      return this.buildDomainsOnlyRaceSafeTitles(currentTitle);
    }

    if (!this.isNoInputPreferencePath(context)) {
      const semantic = [
        currentTitle,
        context.requestDescription ?? '',
        context.opportunityRanking?.selected.title ?? '',
        context.benchmarkWinnerOpportunity?.title ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase();
      const brand = currentTitle
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/u)
        .find((token) => token.length >= 4) ?? 'Voxidence';

      if (
        /\b(?:healthcare|hospital|emergency department|ambulance|patient)\b/u.test(semantic) &&
        /\b(?:capacity|patient demand|overcrowd|response time|resource allocation|care gap|delayed care)\b/u.test(semantic)
      ) {
        return [
          `${brand} Regional Demand Coordinator`,
          `${brand} Capacity Coordination Workspace`,
          `${brand} Emergency Flow Intelligence`,
          `${brand} Health Surge Coordinator`,
          `${brand} Facility Demand Operations`,
          `${brand} Care Capacity Workspace`,
        ].map((title) => title.slice(0, 100));
      }

      if (
        /\b(?:custom order|commission|specification|approved version|design revision|customer revision)\b/u.test(semantic)
      ) {
        return [
          `${brand} Specification Workspace`,
          `${brand} Commission Coordinator`,
          `${brand} Approval & Revision Workspace`,
          `${brand} Custom Order Control`,
          `${brand} Specification & Delivery Hub`,
          `${brand} Commission Operations`,
        ].map((title) => title.slice(0, 100));
      }

      const stem = currentTitle
        .replace(/\s+(?:workspace|hub|console|desk|platform|board|ledger|assistant|engine)$/iu, '')
        .replace(/\s+/gu, ' ')
        .trim();
      return [
        `${stem} Operations Workspace`,
        `${stem} Coordination Hub`,
        `${stem} Decision Support`,
        `${stem} Workflow Manager`,
        `${stem} Operations Console`,
        `${stem} Pilot Workspace`,
      ].map((title) => title.slice(0, 100));
    }

    const semantic = [
      currentTitle,
      context.opportunityRanking?.selected.title ?? '',
      context.benchmarkWinnerOpportunity?.title ?? '',
      context.coreIdea?.problemStatement ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase();
    const domainLabel = (
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'Operational'
    )
      .replace(/\s+/gu, ' ')
      .trim();

    if (
      /\b(?:authentication|account access|login|sign-in|sign in|two-factor|2fa|identity-provider|identity provider)\b/u.test(
        semantic,
      )
    ) {
      return [
        `${domainLabel} Account Access Recovery & Alternative Login Workspace`,
        `${domainLabel} Authentication Recovery & Access Continuity Workspace`,
        `${domainLabel} 2FA & Account Access Recovery Workspace`,
        `${domainLabel} Identity & Account Access Recovery Workspace`,
        `${domainLabel} Sign-In Recovery & Access Decision Workspace`,
        `${domainLabel} Account Recovery & Authentication Support Workspace`,
      ].map((title) => title.slice(0, 100));
    }

    if (
      /\b(?:validation[- ]first opportunity|no external problem evidence|no direct community evidence|no independent community evidence|collect direct evidence)\b/u.test(
        semantic,
      )
    ) {
      return [
        `${domainLabel} Problem Discovery & Validation Workspace`,
        `${domainLabel} Validation Evidence & Resolution Workspace`,
        `${domainLabel} Evidence Qualification & Pilot Validation Workspace`,
        `${domainLabel} Problem Evidence & Validation Workspace`,
        `${domainLabel} Validation Intake & Decision Workspace`,
        `${domainLabel} Evidence Discovery & Validation Workspace`,
      ].map((title) => title.slice(0, 100));
    }

    const stem = currentTitle
      .replace(/\s+(?:workspace|hub|console|desk|platform|board|ledger|assistant)$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    return [
      `${stem} Evidence & Resolution Workspace`,
      `${stem} Investigation & Decision Workspace`,
      `${stem} Exception Resolution Workspace`,
      `${stem} Case Review & Recovery Workspace`,
    ].map((title) => title.slice(0, 100));
  }

  private rewriteCoreIdeaTitle(
    coreIdea: ParsedIdeaAiOutput['coreIdea'],
    nextTitle: string,
  ): ParsedIdeaAiOutput['coreIdea'] {
    const previousTitle = coreIdea.title;
    if (!previousTitle.trim() || previousTitle === nextTitle) {
      return { ...coreIdea, title: nextTitle };
    }

    const escaped = previousTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(escaped, 'giu');
    const rewrite = (value?: string | null): string | undefined => {
      if (!value) return value ?? undefined;
      return value.replace(pattern, nextTitle);
    };

    return {
      ...coreIdea,
      title: nextTitle,
      limitedAbstract: rewrite(coreIdea.limitedAbstract),
      partialAbstract: rewrite(coreIdea.partialAbstract),
      fullAbstract: rewrite(coreIdea.fullAbstract),
      problemStatement: rewrite(coreIdea.problemStatement) ?? coreIdea.problemStatement,
    };
  }

  private buildRaceSafeTitle(
    originalTitle: string,
    runId: string,
    attempt: number,
    explicitSuffix?: string,
  ): string {
    const suffixes = [
      'Operations Workspace',
      'Coordination Hub',
      'Decision Support',
      'Workflow Manager',
    ] as const;
    const hash = [...runId].reduce(
      (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
      0,
    );
    const suffix =
      explicitSuffix ?? suffixes[(hash + attempt - 1) % suffixes.length];
    const cleanBase = originalTitle
      .replace(
        /\s+(?:(?:Evidence Trace|Case Review|Pilot Operations|Decision Audit|Trace Review|Integrity Review|Exception Review) Edition)(?:\s+[A-Z0-9]{1,6}-\d+)?$/iu,
        '',
      )
      .replace(/\s+(?:workspace|hub|console|platform|engine)$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const maximumBaseLength = Math.max(12, 100 - suffix.length - 1);
    const boundedBase = cleanBase.slice(0, maximumBaseLength).trim();

    return `${boundedBase} ${suffix}`
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 100);
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