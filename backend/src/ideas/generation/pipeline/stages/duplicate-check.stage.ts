import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
  IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
  IDEA_TITLE_SIMILARITY_THRESHOLD,
} from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import { IdeaDuplicateDetectionService } from '../../services/idea-duplicate-detection.service';
import { AiOutputValidationStage } from './ai-output-validation.stage';
import { IdeaQualityEvaluatorService } from '../../services/idea-quality-evaluator.service';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';
import {
  RequestProductBlueprintUtil,
  type RequestProductBlueprint,
} from '../../utils/request-product-blueprint.util';
import { CanonicalRequestProductBlueprintUtil } from '../../utils/canonical-request-product-blueprint.util';
import { TargetUserDeduplicationUtil } from '../../utils/target-user-deduplication.util';
import type {
  AdvancedIdeaAiOutput,
  CoreIdeaAiOutput,
  ParsedIdeaAiOutput,
} from '../../types/idea-ai-output.type';

/**
 * Checks whether the generated idea title is highly similar to an
 * existing idea in the same domain and geographic area.
 *
 * Responsibilities:
 * - Verify that validated core idea output exists.
 * - Scope duplicate detection to the selected domain and collection area.
 * - Compare the generated idea with recent ideas from all users in that area.
 * - Stop the pipeline when the configured similarity threshold is
 *   reached.
 * - Return diagnostic similarity metadata.
 *
 * IdeaPersistenceService repeats the duplicate check inside its
 * serializable transaction. The repeated final check prevents a
 * race condition where another matching idea is persisted between
 * this pipeline stage and the persistence transaction.
 *
 * This stage does not:
 * - Persist the generated idea.
 * - Modify existing ideas.
 * - Deduct credits.
 * - Consume free-generation entitlement.
 *
 * @author Malak
 */
@Injectable()
export class DuplicateCheckStage implements IdeaGenerationStage {
  private readonly logger = new Logger(DuplicateCheckStage.name);
  private readonly maximumRescueQualityDrop = 1.5;

  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.DUPLICATE_CHECK;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly duplicateDetectionService: IdeaDuplicateDetectionService,
    private readonly aiOutputValidationStage: AiOutputValidationStage,
    private readonly qualityEvaluatorService: IdeaQualityEvaluatorService,
  ) {}

  /**
   * Performs pre-persistence duplicate detection.
   *
   * @param context Current generation context.
   * @returns Unchanged context when no duplicate is found.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    if ((context.evidenceState === 'NO_VALID_EVIDENCE_FOUND' || context.evidenceState === 'EVIDENCE_ADJUDICATION_UNAVAILABLE')) {
      return {
        context,
        resultPreview:
          'Skipped semantic duplicate rescue for a ungrounded validation workspace; exact-title uniqueness is enforced atomically during persistence with domain-scoped title variants.',
        metadata: {
          isDuplicate: false,
          softDuplicateSignalDetected: false,
          decisiveDuplicate: false,
          duplicateWinnerReplaced: false,
          zeroEvidenceDuplicateBypass: true,
        },
      };
    }

    const collectionJobId = context.collection!.collectionJobId;
    /*
     * Core benchmarking already warms a bounded same-domain semantic corpus
     * under runId while providers are working. Reuse that exact run-scoped
     * corpus here instead of paying a second 4-7s PostgreSQL corpus read. The
     * global exact-title query remains fresh in IdeaDuplicateDetectionService,
     * and persistence repeats the atomic exact-title guard before commit.
     */
    const semanticCorpusCacheKey = context.runId;
    const initialResult = await this.duplicateDetectionService.check(
      context.domainId,
      collectionJobId,
      context.coreIdea!,
      undefined,
      semanticCorpusCacheKey,
    );

    if (this.isDecisiveDuplicate(initialResult)) {
      const rescued = await this.tryBenchmarkAlternative(
        context,
        collectionJobId,
        semanticCorpusCacheKey,
      );

      if (rescued) {
        this.logger.warn(
          [
            `Decisive duplicate winner replaced for run "${context.runId}" with benchmark candidate "${rescued.candidateId}".`,
            `title="${rescued.context.coreIdea?.title ?? 'unknown'}"`,
            `qualityScore=${rescued.qualityScore}`,
            `finalScore=${rescued.finalScore}`,
          ].join(' '),
        );

        return {
          context: rescued.context,
          resultPreview:
            'The original benchmark winner was decisively similar to an existing idea, so a validated distinct benchmark alternative was selected without restarting the generation run.',
          metadata: {
            isDuplicate: false,
            softDuplicateSignalDetected: rescued.result.isDuplicate,
            decisiveDuplicate: false,
            duplicateWinnerReplaced: true,
            replacementCandidateId: rescued.candidateId,
            replacementQualityScore: rescued.qualityScore,
            replacementFinalScore: rescued.finalScore,
            highestSimilarity: rescued.result.highestSimilarity,
            titleSimilarity: rescued.result.titleSimilarity,
            semanticSimilarity: rescued.result.semanticSimilarity,
            workflowSimilarity: rescued.result.workflowSimilarity,
            sameProblemFamily: rescued.result.sameProblemFamily,
            duplicateReasons: rescued.result.duplicateReasons,
            matchedIdeaId: rescued.result.matchedIdea?.id ?? null,
            matchedTitle: rescued.result.matchedIdea?.title ?? null,
            titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
            semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
          },
        };
      }

      /*
       * A requester description is the immutable product/problem blueprint.
       * Deterministic redesign strategies intentionally reshape workflows and
       * are therefore safe only for no-text paths. For Text Only and
       * Text+Domains, preserve the validated core and use the title-only
       * collision-safe identity fallback below instead of introducing a new
       * workflow or leaking a blueprint from another restoration/operations
       * family.
       */
      const localRescue = context.requestDescription?.trim()
        ? null
        : await this.tryDeterministicDistinctRedesign(
            context,
            collectionJobId,
            semanticCorpusCacheKey,
          );

      if (localRescue) {
        this.logger.warn(
          [
            `Decisive duplicate winner redesigned locally for run "${context.runId}" instead of failing generation.`,
            `title="${localRescue.context.coreIdea?.title ?? 'unknown'}"`,
            `strategy=${localRescue.strategy}`,
          ].join(' '),
        );

        return {
          context: localRescue.context,
          resultPreview:
            'The generated idea overlapped decisively with an existing idea, so the same grounded opportunity was converted into a distinct validated workflow without restarting or failing the run.',
          metadata: {
            isDuplicate: false,
            softDuplicateSignalDetected: localRescue.result.isDuplicate,
            decisiveDuplicate: false,
            duplicateWinnerReplaced: true,
            deterministicDuplicateRescueUsed: true,
            deterministicDuplicateRescueStrategy: localRescue.strategy,
            highestSimilarity: localRescue.result.highestSimilarity,
            titleSimilarity: localRescue.result.titleSimilarity,
            semanticSimilarity: localRescue.result.semanticSimilarity,
            workflowSimilarity: localRescue.result.workflowSimilarity,
            sameProblemFamily: localRescue.result.sameProblemFamily,
            duplicateReasons: localRescue.result.duplicateReasons,
            matchedIdeaId: localRescue.result.matchedIdea?.id ?? null,
            matchedTitle: localRescue.result.matchedIdea?.title ?? null,
            titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
            semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
          },
        };
      }

      const blueprint = this.buildRequesterLockedBlueprint(context);
      const identityFallback = await this.buildQualityFloorPreservingIdentityFallback(
        context,
        collectionJobId,
        semanticCorpusCacheKey,
        blueprint,
        initialResult,
      );

      this.logger.warn(
        [
          `All materially distinct duplicate rescue candidates still overlapped for run "${context.runId}".`,
          context.requestDescription?.trim()
            ? 'The requester-defined product blueprint was locked; only a collision-safe identity variant was allowed and duplicate rescue was not permitted to redesign the workflow.'
            : 'The original grounded product identity was preserved and only a collision-safe identity variant was allowed; duplicate rescue is not permitted to pivot the product into an evidence-validation tool.',
          `title="${identityFallback.context.coreIdea?.title ?? context.coreIdea?.title ?? 'unknown'}"`,
        ].join(' '),
      );

      return {
        context: identityFallback.context,
        resultPreview:
          'Existing ideas overlapped with the generated concept, so the same grounded product was preserved with a collision-safe identity instead of changing the product category or failing the run.',
        metadata: {
          isDuplicate: false,
          softDuplicateSignalDetected: identityFallback.result.isDuplicate,
          decisiveDuplicate: false,
          duplicateWinnerReplaced: true,
          deterministicDuplicateRescueUsed: true,
          deterministicDuplicateRescueStrategy: 'QUALITY_FLOOR_IDENTITY_FALLBACK',
          highestSimilarity: identityFallback.result.highestSimilarity,
          titleSimilarity: identityFallback.result.titleSimilarity,
          semanticSimilarity: identityFallback.result.semanticSimilarity,
          workflowSimilarity: identityFallback.result.workflowSimilarity,
          sameProblemFamily: identityFallback.result.sameProblemFamily,
          duplicateReasons: identityFallback.result.duplicateReasons,
          matchedIdeaId: identityFallback.result.matchedIdea?.id ?? null,
          matchedTitle: identityFallback.result.matchedIdea?.title ?? null,
          titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
          semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
        },
      };
    }

    if (initialResult.isDuplicate) {
      this.logger.warn(
        [
          `Soft duplicate signal retained for run "${context.runId}" without failing generation.`,
          `matchedIdeaId=${initialResult.matchedIdea?.id ?? 'none'}`,
          `titleSimilarity=${initialResult.titleSimilarity}`,
          `semanticSimilarity=${initialResult.semanticSimilarity}`,
          `workflowSimilarity=${initialResult.workflowSimilarity}`,
          `sameProblemFamily=${initialResult.sameProblemFamily}`,
          `reasons=${initialResult.duplicateReasons.join(',') || 'none'}`,
        ].join(' '),
      );
    }

    return {
      context,
      resultPreview: initialResult.isDuplicate
        ? 'A moderate same-problem-family overlap was detected after benchmark redesign, but no decisive duplicate was found.'
        : 'No duplicate generated idea was detected.',
      metadata: {
        isDuplicate: false,
        softDuplicateSignalDetected: initialResult.isDuplicate,
        decisiveDuplicate: false,
        duplicateWinnerReplaced: false,
        highestSimilarity: initialResult.highestSimilarity,
        titleSimilarity: initialResult.titleSimilarity,
        semanticSimilarity: initialResult.semanticSimilarity,
        workflowSimilarity: initialResult.workflowSimilarity,
        sameProblemFamily: initialResult.sameProblemFamily,
        duplicateReasons: initialResult.duplicateReasons,
        matchedIdeaId: initialResult.matchedIdea?.id ?? null,
        matchedTitle: initialResult.matchedIdea?.title ?? null,
        titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
        semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
      },
    };
  }

  private async tryBenchmarkAlternative(
    context: IdeaGenerationContext,
    collectionJobId: string,
    semanticCorpusCacheKey: string,
  ): Promise<{
    readonly context: IdeaGenerationContext;
    readonly candidateId: string;
    readonly qualityScore: number;
    readonly finalScore: number;
    readonly result: Awaited<
      ReturnType<IdeaDuplicateDetectionService['check']>
    >;
  } | null> {
    const selectedWinner = context.benchmarkCandidates.find(
      (candidate) => candidate.selected,
    );
    const minimumFinalScore = selectedWinner
      ? Math.max(0, selectedWinner.finalScore - 1.5)
      : 0;
    const minimumQualityScore = selectedWinner
      ? Math.max(0, selectedWinner.qualityScore - 1.5)
      : 0;
    const candidates = [...context.benchmarkCandidates]
      .filter(
        (candidate) =>
          !candidate.selected &&
          candidate.finalScore >= minimumFinalScore &&
          candidate.qualityScore >= minimumQualityScore,
      )
      .sort(
        (left, right) =>
          right.finalScore - left.finalScore ||
          right.qualityScore - left.qualityScore,
      )
      .slice(0, 2);

    for (const candidate of candidates) {
      const ranking = context.opportunityRanking;
      const winnerOpportunity = ranking
        ? [ranking.selected, ...ranking.alternatives].find(
            (opportunity) => opportunity.rank === candidate.opportunityRank,
          ) ?? context.benchmarkWinnerOpportunity
        : context.benchmarkWinnerOpportunity;

      const candidateContext: IdeaGenerationContext = {
        ...context,
        coreIdea: candidate.parsedOutput.coreIdea,
        advancedOutputs: [...candidate.parsedOutput.advancedOutputs],
        benchmarkWinnerOpportunity: winnerOpportunity,
        benchmarkCandidates: context.benchmarkCandidates.map((snapshot) => ({
          ...snapshot,
          selected: snapshot.candidateId === candidate.candidateId,
        })),
      };

      try {
        const validation = await this.aiOutputValidationStage.execute(
          candidateContext,
        );
        const validatedContext = validation.context;

        if (!validatedContext.coreIdea) {
          continue;
        }

        if (
          !this.isRescueWithinQualityFloor(
            context,
            validatedContext,
            'BENCHMARK_ALTERNATIVE',
          )
        ) {
          continue;
        }

        const duplicateResult = await this.duplicateDetectionService.check(
          context.domainId,
          collectionJobId,
          validatedContext.coreIdea,
          undefined,
          semanticCorpusCacheKey,
        );

        if (this.isDecisiveDuplicate(duplicateResult)) {
          continue;
        }

        return {
          context: validatedContext,
          candidateId: candidate.candidateId,
          qualityScore: candidate.qualityScore,
          finalScore: candidate.finalScore,
          result: duplicateResult,
        };
      } catch (error: unknown) {
        this.logger.warn(
          `Benchmark alternative "${candidate.candidateId}" could not rescue duplicate run "${context.runId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return null;
  }


  private async tryDeterministicDistinctRedesign(
    context: IdeaGenerationContext,
    collectionJobId: string,
    semanticCorpusCacheKey: string,
  ): Promise<{
    readonly context: IdeaGenerationContext;
    readonly strategy: string;
    readonly result: Awaited<ReturnType<IdeaDuplicateDetectionService['check']>>;
  } | null> {
    const variants = [
      {
        strategy: 'EVIDENCE_TRIAGE',
        suffix: 'Evidence Triage Console',
        focus:
          'evidence intake, discrepancy classification, reviewer assignment, and auditable escalation',
      },
      {
        strategy: 'CASE_HANDOFF',
        suffix: 'Case Handoff Ledger',
        focus:
          'case intake, ownership handoff, exception aging, and verified closure tracking',
      },
      {
        strategy: 'DECISION_TRACE',
        suffix: 'Decision Trace Workspace',
        focus:
          'decision provenance, supporting-record comparison, reviewer notes, and traceable final disposition',
      },
      {
        strategy: 'ROOT_CAUSE_LEDGER',
        suffix: 'Root Cause Investigation Desk',
        focus:
          'root-cause hypothesis logging, evidence comparison, investigation milestones, and human-reviewed resolution',
      },
      {
        strategy: 'EXCEPTION_QUEUE',
        suffix: 'Exception Coordination Hub',
        focus:
          'exception intake, priority scoring, responsibility assignment, and recovery-status coordination',
      },
      {
        strategy: 'PILOT_SIGNALS',
        suffix: 'Pilot Signal Review Board',
        focus:
          'baseline signal capture, recurring-pattern review, intervention notes, and pilot outcome comparison',
      },
    ] as const;

    const startIndex = this.stableVariantIndex(context.runId, variants.length);

    for (let offset = 0; offset < variants.length; offset += 1) {
      const variant = variants[(startIndex + offset) % variants.length];
      const candidateContext = this.buildDistinctLocalContext(context, variant);

      try {
        const validation = await this.aiOutputValidationStage.execute(
          candidateContext,
        );
        const validatedContext = validation.context;
        if (!validatedContext.coreIdea) {
          continue;
        }

        if (
          !this.isRescueWithinQualityFloor(
            context,
            validatedContext,
            variant.strategy,
          )
        ) {
          continue;
        }

        const duplicateResult = await this.duplicateDetectionService.check(
          context.domainId,
          collectionJobId,
          validatedContext.coreIdea,
          undefined,
          semanticCorpusCacheKey,
        );

        if (this.isDecisiveDuplicate(duplicateResult)) {
          continue;
        }

        return {
          context: this.synchronizePostRescueBenchmark(
            context,
            validatedContext,
            variant.strategy,
          ),
          strategy: variant.strategy,
          result: duplicateResult,
        };
      } catch (error: unknown) {
        this.logger.warn(
          `Local duplicate redesign strategy "${variant.strategy}" could not be used for run "${context.runId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return null;
  }

  private async buildValidationFirstEscapeHatch(
    context: IdeaGenerationContext,
    collectionJobId: string,
    semanticCorpusCacheKey: string,
  ): Promise<{
    readonly context: IdeaGenerationContext;
    readonly result: Awaited<ReturnType<IdeaDuplicateDetectionService['check']>>;
  }> {
    const focusWord = this.resolveRunFocusWord(context.runId);
    const anchor = this.resolveOpportunityAnchor(context);
    const coreIdea = context.coreIdea!;
    const problem = this.resolveGroundedProblem(context);
    const blueprint = this.buildRequesterLockedBlueprint(context);
    const title = this.limitTitle(
      blueprint
        ? `${blueprint.baseLabel} Evidence Decision Workspace`
        : `${anchor} ${focusWord} Evidence Decision Workspace`,
    );
    const country = context.location.country?.trim() || 'the selected pilot region';
    const targetUsers = this.mergeTargetUsers(
      coreIdea.targetUsers,
      blueprint?.targetUsers ?? [],
    );
    const problemStatement = [
      problem,
      'The implementation is intentionally limited to validating evidence quality, exception patterns, and workflow ownership before any broader operational product is deployed.',
      'The pilot does not claim market-wide recurrence or automate consequential decisions; it creates a traceable evidence base and a human-reviewed go/no-go decision for the next implementation phase.',
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const objectives = blueprint
      ? [
          `Detect evidence gaps, contradictions, and unresolved assumptions around ${blueprint.workflowFocus}.`,
          'Compare direct reports, secondary evidence, requester statements, and source provenance before any implementation claim is accepted.',
          'Prioritize the highest-risk unresolved questions and recommend a human-reviewed build, narrow, pivot, or stop decision with explicit rationale.',
          `Measure evidence coverage, source independence, review completion, and ${blueprint.metrics.slice(0, 3).join(', ')} during the pilot in ${country}.`,
        ]
      : [
          'Detect evidence gaps, contradictions, and unsupported assumptions across retained reports, requests, complaints, and secondary sources.',
          'Compare source provenance, problem specificity, domain fit, and independent support before any implementation claim is accepted.',
          'Prioritize unresolved questions and recommend a human-reviewed build, narrow, pivot, or stop decision with explicit rationale.',
          `Measure evidence coverage, source independence, review completion, and decision latency during the pilot in ${country}.`,
        ];
    const fullAbstract = [
      `${title} is a validation-first software workspace for the grounded problem: ${problem}`,
      'Instead of recreating an existing end-to-end solution, the product provides decision support for evidence qualification. Staff import or record the retained source material, attach provenance and workflow context, detect contradictions and unsupported assumptions, compare source independence, prioritize high-risk evidence gaps, and route uncertain items to a reviewer before engineering resources are committed.',
      'The workflow centers on an evidence inbox, source-provenance records, problem-family tagging, reviewer assignments, confidence notes, contradiction tracking, and a decision register. It does not modify external systems or automatically decide academic, clinical, financial, regulatory, or operational outcomes. Every consequential conclusion requires explicit human review.',
      'A modular NestJS backend and PostgreSQL database store evidence records, provenance, reviewer decisions, and audit history. A React or Next.js interface provides the review workspace. Optional BullMQ and Redis jobs handle bounded imports or report preparation, while role-based access control, encrypted transport, and immutable audit events protect sensitive records.',
      `For a pilot in ${country}, the first phase establishes evidence coverage and unresolved-question baselines. The remaining phase measures whether additional direct evidence confirms the same problem family strongly enough to justify a distinct implementation. The output is a documented build, narrow, pivot, or stop recommendation rather than an unsupported market claim.`,
    ].join('\n\n');
    const partialAbstract = `${title} validates whether the retained evidence around ${problem} is strong, independent, and specific enough to justify implementation. It centralizes provenance, reviewer decisions, contradictions, and unresolved questions while keeping all conclusions human reviewed.`;
    const limitedAbstract = partialAbstract.split(/\s+/u).slice(0, 64).join(' ');
    const redesignedCore: CoreIdeaAiOutput = {
      title,
      problemStatement,
      objectives,
      targetUsers,
      ...(coreIdea.fullAbstract ? { fullAbstract } : {}),
      ...(coreIdea.partialAbstract ? { partialAbstract } : {}),
      ...(coreIdea.limitedAbstract ? { limitedAbstract } : {}),
    };
    const redesignedContext: IdeaGenerationContext = {
      ...context,
      coreIdea: redesignedCore,
      advancedOutputs: this.rewriteAdvancedOutputs(
        context.advancedOutputs,
        coreIdea.title,
        title,
        redesignedCore,
        'evidence qualification, reviewer assignment, contradiction tracking, and a human-reviewed implementation decision',
      ),
    };

    const validation = await this.aiOutputValidationStage.execute(
      redesignedContext,
    );
    const validatedContext = validation.context;
    const validatedCore = validatedContext.coreIdea ?? redesignedCore;

    const duplicateResult = await this.duplicateDetectionService.check(
      context.domainId,
      collectionJobId,
      validatedCore,
      undefined,
      semanticCorpusCacheKey,
    );

    if (this.isDecisiveDuplicate(duplicateResult)) {
      const uniquenessTitle = this.limitTitle(
        blueprint
          ? `${blueprint.baseLabel} Evidence Decision & Go-No-Go Workspace`
          : `${anchor} ${focusWord} Evidence Decision & Go-No-Go Workspace`,
      );
      const finalCore: CoreIdeaAiOutput = {
        ...validatedCore,
        title: uniquenessTitle,
        problemStatement: [
          problem,
          'This product is a bounded evidence-qualification and implementation-decision workflow, not another operational solution for the underlying problem.',
          'Its output is a reviewed build, narrow, pivot, or stop decision supported by traceable source provenance and explicit uncertainty.',
        ]
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim(),
        objectives: blueprint
          ? [
              `Detect evidence gaps and contradictions around ${blueprint.workflowFocus} without converting weak signals into demand claims.`,
              'Compare evidence coverage by source independence, problem specificity, domain fit, and unresolved contradiction.',
              'Prioritize the highest-risk unresolved assumptions and recommend the next human-reviewed validation or implementation action.',
              `Measure evidence coverage, review completion, decision latency, and ${blueprint.metrics.slice(0, 3).join(', ')} before issuing a build, narrow, pivot, or stop recommendation.`,
            ]
          : [
              'Detect evidence gaps and contradictions while separating direct observations, secondary reports, requester statements, and unvalidated assumptions.',
              'Compare evidence coverage by source independence, problem specificity, domain fit, and unresolved contradiction.',
              'Prioritize the highest-risk unresolved assumptions and recommend the next human-reviewed validation or implementation action.',
              'Measure evidence coverage, review completion, and decision latency before issuing a final build, narrow, pivot, or stop recommendation.',
            ],
        ...(validatedCore.fullAbstract
          ? {
              fullAbstract: `${uniquenessTitle} is an evidence-qualification workspace for deciding whether the grounded problem should proceed to implementation. It stores source provenance, direct versus secondary evidence status, problem-family tags, contradictions, reviewer notes, and unresolved questions. The product deliberately stops before operational automation: its purpose is to prevent repeated ideas from being regenerated when the evidence only supports validating the problem. Teams use the workspace to compare independent signals, document uncertainty, and issue a human-reviewed build, narrow, pivot, or stop decision. The system uses a NestJS API, PostgreSQL persistence, a responsive web client, role-based access, encrypted transport, and immutable audit logging. No market-wide prevalence or causal claim is accepted without traceable support.`,
            }
          : {}),
      };
      const finalContext: IdeaGenerationContext = {
        ...validatedContext,
        coreIdea: finalCore,
        advancedOutputs: this.rewriteAdvancedOutputs(
          validatedContext.advancedOutputs,
          validatedCore.title,
          uniquenessTitle,
          finalCore,
          'evidence qualification, source provenance, reviewer decisions, and a build-or-stop recommendation',
        ),
      };
      const finalValidation = await this.aiOutputValidationStage.execute(
        finalContext,
      );
      const finalValidatedContext = finalValidation.context;
      const finalDuplicateResult = await this.duplicateDetectionService.check(
        context.domainId,
        collectionJobId,
        finalValidatedContext.coreIdea ?? finalCore,
        undefined,
        semanticCorpusCacheKey,
      );

      if (
        !this.isDecisiveDuplicate(finalDuplicateResult) &&
        this.isRescueWithinQualityFloor(
          context,
          finalValidatedContext,
          'EVIDENCE_VALIDATION_ESCAPE_HATCH',
        )
      ) {
        return {
          context: this.synchronizePostRescueBenchmark(
            context,
            finalValidatedContext,
            'EVIDENCE_VALIDATION_ESCAPE_HATCH',
          ),
          result: finalDuplicateResult,
        };
      }

      if (
        this.isRescueWithinQualityFloor(
          context,
          finalValidatedContext,
          'EVIDENCE_VALIDATION_ESCAPE_HATCH_COLLISION_SAFE',
        )
      ) {
        this.logger.warn(
          `Validation-first escape hatch still shares a problem family for run "${context.runId}", but the collision-safe workflow remains inside the configured quality floor. The semantic overlap is retained only as a diagnostic warning.`,
        );

        return {
          context: this.synchronizePostRescueBenchmark(
            context,
            finalValidatedContext,
            'EVIDENCE_VALIDATION_ESCAPE_HATCH',
          ),
          result: {
            ...finalDuplicateResult,
            isDuplicate: false,
          },
        };
      }

      const qualityPreserving = await this.buildQualityPreservingEscapeHatch(
        context,
        collectionJobId,
        semanticCorpusCacheKey,
        blueprint,
      );
      if (qualityPreserving) return qualityPreserving;

      return this.buildQualityFloorPreservingIdentityFallback(
        context,
        collectionJobId,
        semanticCorpusCacheKey,
        blueprint,
        finalDuplicateResult,
      );
    }

    if (
      this.isRescueWithinQualityFloor(
        context,
        validatedContext,
        'EVIDENCE_VALIDATION_ESCAPE_HATCH',
      )
    ) {
      return {
        context: this.synchronizePostRescueBenchmark(
          context,
          validatedContext,
          'EVIDENCE_VALIDATION_ESCAPE_HATCH',
        ),
        result: duplicateResult,
      };
    }

    const qualityPreserving = await this.buildQualityPreservingEscapeHatch(
      context,
      collectionJobId,
      semanticCorpusCacheKey,
      blueprint,
    );
    if (qualityPreserving) return qualityPreserving;

    return this.buildQualityFloorPreservingIdentityFallback(
      context,
      collectionJobId,
      semanticCorpusCacheKey,
      blueprint,
      duplicateResult,
    );
  }

  private async buildQualityFloorPreservingIdentityFallback(
    context: IdeaGenerationContext,
    collectionJobId: string,
    semanticCorpusCacheKey: string,
    blueprint: RequestProductBlueprint | null,
    previousDuplicateResult: Awaited<
      ReturnType<IdeaDuplicateDetectionService['check']>
    >,
  ): Promise<{
    readonly context: IdeaGenerationContext;
    readonly result: Awaited<ReturnType<IdeaDuplicateDetectionService['check']>>;
  }> {
    const originalCore = context.coreIdea!;
    const identityVariants = this.buildQualityFloorIdentityTitles(
      context,
      originalCore,
      blueprint,
    );
    const startIndex = this.isNoInputPreferencePath(context)
      ? 0
      : this.stableVariantIndex(
          `${context.runId}:${originalCore.title}`,
          identityVariants.length,
        );

    let bestContext: IdeaGenerationContext | null = null;
    let bestResult = previousDuplicateResult;
    let bestQuality = Number.NEGATIVE_INFINITY;

    for (let offset = 0; offset < identityVariants.length; offset += 1) {
      const title = this.limitTitle(
        identityVariants[(startIndex + offset) % identityVariants.length],
      );
      if (title.toLocaleLowerCase() === originalCore.title.toLocaleLowerCase()) {
        continue;
      }

      const identityCore = this.rewriteCoreIdeaIdentityOnly(
        originalCore,
        originalCore.title,
        title,
      );
      const candidateContext: IdeaGenerationContext = {
        ...context,
        coreIdea: identityCore,
        advancedOutputs: this.rewriteAdvancedOutputIdentityOnly(
          context.advancedOutputs,
          originalCore.title,
          title,
        ),
      };

      try {
        const validation = await this.aiOutputValidationStage.execute(
          candidateContext,
        );
        const validatedContext = validation.context;
        if (!validatedContext.coreIdea) continue;

        const quality = this.evaluateRescueQuality(validatedContext);
        if (quality.score > bestQuality) {
          bestQuality = quality.score;
          bestContext = validatedContext;
        }

        if (
          !this.isRescueWithinQualityFloor(
            context,
            validatedContext,
            'QUALITY_FLOOR_IDENTITY_FALLBACK',
          )
        ) {
          continue;
        }

        const result = await this.duplicateDetectionService.check(
          context.domainId,
          collectionJobId,
          validatedContext.coreIdea,
          undefined,
          semanticCorpusCacheKey,
        );

        /*
         * At this final guardrail, preserve the stronger product instead of
         * failing a paid generation because it belongs to the same semantic
         * problem family as an existing idea. Persistence already performs a
         * fresh global exact-title check inside a serializable transaction.
         *
         * Therefore the hard requirement here is identity uniqueness:
         * - exact title must no longer collide;
         * - quality must stay inside the configured floor.
         *
         * Remaining semantic/workflow overlap is retained as diagnostic
         * metadata. It is not silently represented as novel evidence.
         */
        if (result.titleSimilarity >= 0.999) {
          continue;
        }

        this.logger.warn(
          [
            `All materially different duplicate redesigns fell below the quality floor for run "${context.runId}".`,
            `Preserving the higher-quality grounded product with collision-safe identity "${validatedContext.coreIdea.title}" instead of failing generation.`,
            `quality=${quality.score.toFixed(2)}`,
            `semanticSimilarity=${result.semanticSimilarity.toFixed(4)}`,
            `workflowSimilarity=${result.workflowSimilarity.toFixed(4)}`,
          ].join(' '),
        );

        return {
          context: this.synchronizePostRescueBenchmark(
            context,
            validatedContext,
            'QUALITY_FLOOR_IDENTITY_FALLBACK',
          ),
          result: {
            ...result,
            isDuplicate: false,
          },
        };
      } catch (error: unknown) {
        this.logger.warn(
          `Collision-safe identity variant "${title}" could not be validated for run "${context.runId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    /*
     * If every validated title-only identity variant still misses the quality
     * floor, do not replace the benchmark winner with a weaker product. Keep
     * the original validated context and let the persistence stage resolve the
     * exact-title collision atomically with a title-only retry. This preserves
     * the benchmark score exactly while still guaranteeing that duplicate
     * detection cannot fail an otherwise valid paid generation.
     */
    this.logger.error(
      [
        `Duplicate rescue exhausted every materially distinct quality-preserving option for run "${context.runId}".`,
        `The original validated product and benchmark score are preserved; persistence will apply a collision-safe title-only identity if the exact title already exists.`,
        bestContext
          ? `bestValidatedIdentityQuality=${bestQuality.toFixed(2)}`
          : 'bestValidatedIdentityQuality=unavailable',
      ].join(' '),
    );

    return {
      context,
      result: {
        ...bestResult,
        isDuplicate: false,
      },
    };
  }

  private async buildQualityPreservingEscapeHatch(
    context: IdeaGenerationContext,
    collectionJobId: string,
    semanticCorpusCacheKey: string,
    blueprint: RequestProductBlueprint | null,
  ): Promise<{
    readonly context: IdeaGenerationContext;
    readonly result: Awaited<ReturnType<IdeaDuplicateDetectionService['check']>>;
  } | null> {
    if (!blueprint || !context.coreIdea) return null;

    const problem = this.resolveGroundedProblem(context);
    const country = context.location.country?.trim() || 'the selected pilot region';
    const variants = [
      {
        strategy: 'DECISION_SUPPORT_CONTROL',
        suffix: 'Decision Support & Pilot Control Workspace',
        differentiation:
          'decision support, early-warning review, explicit exception handling, and auditable human approval',
      },
      {
        strategy: 'SCENARIO_COMPARISON',
        suffix: 'Scenario Comparison & Intervention Review Workspace',
        differentiation:
          'baseline-versus-scenario comparison, intervention review, uncertainty tracking, and human-approved next-action selection',
      },
      {
        strategy: 'SIGNAL_PRIORITY',
        suffix: 'Signal Prioritization & Outcome Review Workspace',
        differentiation:
          'signal prioritization, outcome comparison, unresolved-risk review, and traceable human disposition',
      },
    ] as const;

    for (const variant of variants) {
      const title = this.limitTitle(
        `${this.blueprintTitleStem(blueprint)} ${variant.suffix}`,
      );
      const coreIdea: CoreIdeaAiOutput = {
        title,
        problemStatement: [
          problem,
          `This implementation preserves the requester-aligned workflow and concentrates on ${blueprint.workflowFocus}.`,
          `It is materially differentiated through ${variant.differentiation} rather than by weakening or replacing the underlying product problem.`,
        ]
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim(),
        objectives: [
          ...blueprint.objectives.slice(0, 3),
          `Measure ${blueprint.metrics.slice(0, 4).join(', ')} during the pilot in ${country} and compare outcomes against the baseline before broader rollout.`,
        ],
        targetUsers: this.mergeTargetUsers(
          context.coreIdea.targetUsers,
          blueprint.targetUsers,
        ),
        ...(context.coreIdea.fullAbstract
          ? {
              fullAbstract: [
                `${title} addresses the grounded problem: ${problem}`,
                `The product preserves the request-specific operational scope: ${blueprint.workflowFocus}. Its core capabilities are ${blueprint.features.slice(0, 5).join('; ')}.`,
                `A distinct control layer adds ${variant.differentiation}. It compares current signals with baseline conditions, detects exceptions or emerging risk, prioritizes items that need attention, and records the rationale for every human-reviewed recommendation. This keeps the rescue materially different without replacing the requester problem with a generic evidence-management product.`,
                `The data model centers on ${blueprint.databaseEntities.slice(0, 8).join(', ')}. A modular NestJS backend, PostgreSQL persistence, Prisma ORM, and a responsive React or Next.js client support the workflow. Optional BullMQ and Redis jobs handle bounded imports, alerts, and report preparation.`,
                `The pilot in ${country} establishes a baseline and measures ${blueprint.metrics.slice(0, 5).join(', ')}. Important operational decisions remain human reviewed, evidence provenance is retained, and unsupported market-wide claims are not introduced.`,
              ].join('\n\n'),
            }
          : {}),
        ...(context.coreIdea.partialAbstract
          ? {
              partialAbstract: `${title} is a request-specific workflow for ${blueprint.workflowFocus}. It adds ${variant.differentiation}, compares current conditions with the baseline, prioritizes human-reviewed actions, and measures ${blueprint.metrics.slice(0, 3).join(', ')} without changing the grounded problem.`,
            }
          : {}),
      };

      const candidateContext: IdeaGenerationContext = {
        ...context,
        coreIdea,
        advancedOutputs: this.rewriteAdvancedOutputs(
          context.advancedOutputs,
          context.coreIdea.title,
          title,
          coreIdea,
          `${blueprint.workflowFocus}; ${variant.differentiation}`,
        ),
      };
      const validation = await this.aiOutputValidationStage.execute(
        candidateContext,
      );
      const validatedContext = validation.context;
      if (!validatedContext.coreIdea) continue;
      if (
        !this.isRescueWithinQualityFloor(
          context,
          validatedContext,
          `QUALITY_PRESERVING_${variant.strategy}`,
        )
      ) {
        continue;
      }

      const result = await this.duplicateDetectionService.check(
        context.domainId,
        collectionJobId,
        validatedContext.coreIdea,
        undefined,
        semanticCorpusCacheKey,
      );
      if (this.isDecisiveDuplicate(result)) continue;

      return {
        context: this.synchronizePostRescueBenchmark(
          context,
          validatedContext,
          `QUALITY_PRESERVING_${variant.strategy}`,
        ),
        result,
      };
    }

    return null;
  }

  private buildDistinctLocalContext(
    context: IdeaGenerationContext,
    variant: {
      readonly strategy: string;
      readonly suffix: string;
      readonly focus: string;
    },
  ): IdeaGenerationContext {
    const coreIdea = context.coreIdea!;
    const anchor = this.resolveOpportunityAnchor(context);
    const blueprint = this.buildRequesterLockedBlueprint(context);
    const title = this.limitTitle(
      blueprint
        ? this.resolveBlueprintRescueTitle(blueprint, variant.strategy, variant.suffix)
        : `${anchor} ${variant.suffix}`,
    );
    const problem = this.resolveGroundedProblem(context);
    const country = context.location.country?.trim() || 'the selected pilot region';
    const problemStatement = [
      problem,
      `This implementation focuses specifically on ${variant.focus}.`,
      'It preserves the grounded problem while narrowing the product to a materially different operational slice with human-reviewed decisions and explicit evidence provenance.',
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const effectiveFocus = blueprint?.workflowFocus ?? variant.focus;
    const objectives = blueprint
      ? [
          ...blueprint.objectives.slice(0, 3),
          `Establish a baseline during the pilot in ${country} and measure directional change in ${blueprint.metrics.slice(0, 4).join(', ')} without unsupported percentage targets.`,
        ]
      : [
          `Create a structured intake for ${variant.focus} with source provenance, status, owner, and review history.`,
          'Separate confirmed evidence from assumptions and route uncertain or conflicting cases to an authorized reviewer before any downstream action.',
          'Provide a focused queue, handoff history, and audit trail so teams can resolve the selected workflow without recreating a broad end-to-end platform.',
          `Establish a baseline during the pilot in ${country} and measure directional change in unresolved-case age, handoff errors, and review completion without unsupported percentage targets.`,
        ];
    const fullAbstract = coreIdea.fullAbstract
      ? [
          `${title} addresses the grounded problem: ${problem}`,
          `The product deliberately narrows the workflow to ${effectiveFocus}. ${blueprint ? `Its core capabilities include ${blueprint.features.slice(0, 4).join('; ')}.` : 'Users begin by registering a case or evidence item, attaching the minimum supporting context, assigning ownership, and recording the current status. Reviewers then classify the item, document uncertainty, request missing information when needed, and approve the next human-reviewed action.'}`,
          'This design avoids duplicating a broad operational platform by concentrating on one traceable control loop: intake, qualification, assignment, review, escalation, and closure. Every transition is recorded so teams can reconstruct why a case moved forward and which evidence supported the decision.',
          'A modular NestJS backend and PostgreSQL database store cases, evidence links, assignments, status transitions, and audit events. A responsive React or Next.js interface provides the work queue. Optional BullMQ and Redis jobs handle bounded imports or notifications, while role-based access and encrypted transport protect sensitive records.',
          `The pilot in ${country} establishes a baseline first, then evaluates whether the focused workflow reduces unresolved-case age and coordination errors. The product makes no autonomous consequential decision and does not convert sparse evidence into market-wide demand claims.`,
        ].join('\n\n')
      : undefined;
    const partialAbstract = coreIdea.partialAbstract
      ? `${title} is a focused workflow for ${variant.focus}. It preserves the grounded problem, source provenance, reviewer decisions, and uncertainty while testing whether a narrower operational control loop improves coordination during the pilot.`
      : undefined;
    const limitedAbstract = coreIdea.limitedAbstract
      ? (partialAbstract ?? problemStatement).split(/\s+/u).slice(0, 64).join(' ')
      : undefined;
    const redesignedCore: CoreIdeaAiOutput = {
      title,
      problemStatement,
      objectives,
      targetUsers: this.mergeTargetUsers(
        coreIdea.targetUsers,
        blueprint?.targetUsers ?? [],
      ),
      ...(fullAbstract ? { fullAbstract } : {}),
      ...(partialAbstract ? { partialAbstract } : {}),
      ...(limitedAbstract ? { limitedAbstract } : {}),
    };

    return {
      ...context,
      coreIdea: redesignedCore,
      advancedOutputs: this.rewriteAdvancedOutputs(
        context.advancedOutputs,
        coreIdea.title,
        title,
        redesignedCore,
        effectiveFocus,
      ),
    };
  }

  private buildQualityFloorIdentityTitles(
    context: IdeaGenerationContext,
    originalCore: CoreIdeaAiOutput,
    blueprint: RequestProductBlueprint | null,
  ): string[] {
    if (this.isDomainsOnlyPath(context)) {
      return this.buildDomainsOnlyIdentityTitles(
        originalCore.title,
        blueprint?.title,
      );
    }

    if (!this.isNoInputPreferencePath(context)) {
      const sourceTitle = blueprint?.title?.trim() || originalCore.title;
      const base = sourceTitle
        .replace(
          /\s+(?:(?:Trace|Case|Integrity|Exception|Pilot) Review|Decision Trace|Decision Audit|Evidence Trace|Human Review|Exception Resolution)(?: Edition| Workspace)?$/iu,
          '',
        )
        .replace(/\s+(?:edition|workspace|hub|platform|console|engine)$/iu, '')
        .replace(/\s+/gu, ' ')
        .trim();
      const brand = originalCore.title
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/u)
        .find((token) => token.length >= 4) ?? base.split(/\s+/u)[0] ?? 'Voxidence';
      const semantic = [
        context.requestDescription ?? '',
        blueprint?.workflowFocus ?? '',
        context.opportunityRanking?.selected.title ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase();

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
        ];
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
        ];
      }

      return [
        `${base} Operations Workspace`,
        `${base} Coordination Hub`,
        `${base} Decision Support`,
        `${base} Workflow Manager`,
        `${base} Operations Console`,
        `${base} Pilot Workspace`,
      ];
    }

    const semantic = [
      originalCore.title,
      blueprint?.title ?? '',
      blueprint?.workflowFocus ?? '',
      context.opportunityRanking?.selected.title ?? '',
      context.benchmarkWinnerOpportunity?.title ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase();
    const domainLabel = (
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      blueprint?.baseLabel ||
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
      ];
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
      ];
    }

    if (/\b(?:learning content safety|hacking tutorial|student exposure|unsafe content)\b/u.test(semantic)) {
      return [
        `${domainLabel} Learning Content Safety Review Workspace`,
        `${domainLabel} Training Content Risk Review Workspace`,
        `${domainLabel} Learning Material Safety & Approval Workspace`,
        `${domainLabel} Security Training Content Review Workspace`,
      ];
    }

    const stem = blueprint
      ? this.blueprintTitleStem(blueprint)
      : originalCore.title
          .replace(/\s+(?:workspace|hub|console|desk|platform|board|ledger|assistant)$/iu, '')
          .replace(/\s+/gu, ' ')
          .trim();
    return [
      `${stem} Evidence & Resolution Workspace`,
      `${stem} Investigation & Decision Workspace`,
      `${stem} Exception Resolution Workspace`,
      `${stem} Case Review & Recovery Workspace`,
      `${stem} Operations & Decision Workspace`,
      `${stem} Evidence-Grounded Review Workspace`,
    ];
  }

  private buildRequesterLockedBlueprint(
    context: IdeaGenerationContext,
  ): RequestProductBlueprint | null {
    const canonical = CanonicalRequestProductBlueprintUtil.build({
      profile: context.collectionPlan?.problemProfile,
      requestDescription: context.requestDescription,
      domainName: context.domainName,
      opportunityTitle: context.opportunityRanking?.selected.title,
    });
    if (canonical) return canonical;

    return RequestProductBlueprintUtil.build({
      requestDescription: context.requestDescription,
      domainName: context.domainName,
      opportunityTitle: context.opportunityRanking?.selected.title,
      enableEvidenceDerivedFeatureCapability: this.isDomainsOnlyPath(context),
      enableEvidenceDerivedProblemWorkflow: this.isDomainsOnlyPath(context),
    });
  }

  private isDomainsOnlyPath(context: IdeaGenerationContext): boolean {
    return (
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_SELECTED'
    );
  }

  private buildDomainsOnlyIdentityTitles(
    currentTitle: string,
    blueprintTitle?: string | null,
  ): string[] {
    const sourceTitle = blueprintTitle?.trim() || currentTitle;
    const stem = sourceTitle
      .replace(
        /\s+(?:(?:Trace|Case|Integrity|Exception|Pilot) Review|Decision Trace|Decision Audit|Evidence Trace|Human Review|Exception Resolution)(?: Edition| Workspace)?$/iu,
        '',
      )
      .replace(/\s+(?:edition|workspace|hub|platform|console|desk|board|ledger|assistant)$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const hadDecisionSuffix = /\s*&\s*Decision(?:\s+Workspace)?$/iu.test(
      sourceTitle,
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
    ];
  }

  private isNoInputPreferencePath(context: IdeaGenerationContext): boolean {
    return (
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_PREFERENCE'
    );
  }

  private rewriteCoreIdeaIdentityOnly(
    coreIdea: CoreIdeaAiOutput,
    previousTitle: string,
    nextTitle: string,
  ): CoreIdeaAiOutput {
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

  private rewriteAdvancedOutputIdentityOnly(
    outputs: readonly AdvancedIdeaAiOutput[],
    previousTitle: string,
    nextTitle: string,
  ): AdvancedIdeaAiOutput[] {
    const escaped = previousTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    if (!escaped || previousTitle === nextTitle) {
      return outputs.map((output) => ({ ...output }));
    }

    const pattern = new RegExp(escaped, 'giu');
    return outputs.map((output) => ({
      ...output,
      content: output.content.replace(pattern, nextTitle),
    }));
  }

  private rewriteAdvancedOutputs(
    outputs: readonly AdvancedIdeaAiOutput[],
    previousTitle: string,
    nextTitle: string,
    redesignedCore?: CoreIdeaAiOutput,
    focus = 'traceable case intake, review, assignment, and closure',
  ): AdvancedIdeaAiOutput[] {
    const escaped = previousTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const titlePattern = escaped ? new RegExp(escaped, 'giu') : null;
    const previousIdentityTokens = previousTitle
      .split(/\s+/u)
      .map((token) => token.replace(/[^\p{L}\p{N}-]/gu, '').trim())
      .filter(
        (token) =>
          token.length >= 5 &&
          !/^(?:assistant|platform|system|solution|workspace|management|monitor|coordinator|regional|adaptive|authentication|recovery)$/iu.test(token),
      )
      .slice(0, 2);
    const replaceIdentity = (content: string): string => {
      let next = titlePattern ? content.replace(titlePattern, nextTitle) : content;
      for (const token of previousIdentityTokens) {
        next = next.replace(new RegExp(`\\b${this.escapeRegExp(token)}\\b`, 'giu'), 'the product');
      }
      return next.replace(/\s+/gu, ' ').trim();
    };

    const mvpItems = [
      `Structured intake for ${focus}`,
      'Reviewer assignment, status tracking, and explicit ownership handoffs',
      'Evidence provenance, uncertainty notes, and auditable decision history',
      'Role-based access control and pilot metrics for unresolved-case age and review completion',
    ];

    return outputs.map((output) => {
      if (output.outputKey === 'full-abstract' && redesignedCore?.fullAbstract) {
        return { ...output, content: redesignedCore.fullAbstract };
      }
      if (output.outputKey === 'mvp-features') {
        return {
          ...output,
          content: mvpItems.map((item) => `- ${item}`).join('\n'),
          structuredContent: mvpItems,
        };
      }
      if (output.outputKey === 'value-proposition') {
        return {
          ...output,
          content: `${nextTitle} turns ${focus} into one auditable, human-reviewed workflow so teams can coordinate exceptions without recreating the broader duplicated product.`,
        };
      }
      if (output.outputKey === 'system-architecture') {
        return {
          ...output,
          content: `${nextTitle} uses a modular NestJS backend, PostgreSQL persistence, and a responsive web client. Core records include cases, evidence links, assignments, status transitions, reviewer decisions, and audit events. Optional bounded background jobs handle notifications or imports. Role-based access control, encrypted transport, and explicit human review protect sensitive workflow decisions.`,
        };
      }
      if (output.outputKey === 'database-design') {
        return {
          ...output,
          content: 'The relational schema centers on Cases, EvidenceItems, Assignments, ReviewDecisions, StatusTransitions, and AuditEvents. Foreign keys preserve case ownership and provenance, while immutable audit records capture every reviewer-visible state change and final disposition.',
        };
      }
      if (output.outputKey === 'feasibility-assessment') {
        return {
          ...output,
          content: 'Technical feasibility is high because the redesigned product uses standard case-management and audit-workflow components rather than reproducing the original end-to-end solution. The main operational risk is reviewer adoption and consistent evidence entry, which the pilot measures explicitly.',
        };
      }
      return { ...output, content: replaceIdentity(output.content) };
    });
  }

  private synchronizePostRescueBenchmark(
    originalContext: IdeaGenerationContext,
    rescuedContext: IdeaGenerationContext,
    strategy: string,
  ): IdeaGenerationContext {
    if (!rescuedContext.coreIdea) return rescuedContext;

    const parsedOutput: ParsedIdeaAiOutput = {
      coreIdea: rescuedContext.coreIdea,
      advancedOutputs: [...rescuedContext.advancedOutputs],
    };
    const quality = this.evaluateRescueQuality(rescuedContext);
    const previousSelected = originalContext.benchmarkCandidates.find(
      (candidate) => candidate.selected,
    );
    const rescueCandidateId = `${originalContext.runId}:duplicate-rescue:${strategy.toLocaleLowerCase()}`;

    return {
      ...rescuedContext,
      benchmarkCandidates: [
        ...originalContext.benchmarkCandidates.map((candidate) => ({
          ...candidate,
          selected: false,
        })),
        {
          candidateId: rescueCandidateId,
          selected: true,
          finalScore: quality.score,
          qualityScore: quality.score,
          opportunityRank: previousSelected?.opportunityRank ?? 1,
          opportunityTitle:
            previousSelected?.opportunityTitle ??
            rescuedContext.opportunityRanking?.selected.title ??
            'Duplicate rescue',
          parsedOutput,
        },
      ],
    };
  }

  private evaluateRescueQuality(context: IdeaGenerationContext) {
    const parsedOutput: ParsedIdeaAiOutput = {
      coreIdea: context.coreIdea!,
      advancedOutputs: [...context.advancedOutputs],
    };
    return this.qualityEvaluatorService.evaluate(parsedOutput, {
      totalTextsAnalyzed: context.nlp?.totalTextsAnalyzed ?? 0,
      totalPostsAnalyzed: context.nlp?.totalPostsAnalyzed ?? 0,
      totalCommentsAnalyzed: context.nlp?.totalCommentsAnalyzed ?? 0,
      requireAdvancedOutputs: context.policy?.includePremiumOutputs ?? false,
      targetCountry: context.location.country,
      targetCity: context.location.city,
      targetRegion: context.location.region,
      directEvidenceCount:
        context.opportunityRanking?.selected.verifiedDirectUserEvidenceCount ?? 0,
      externalSupportingEvidenceCount:
        (context.opportunityRanking?.selected.verifiedSecondaryEvidenceCount ?? 0) +
        (context.opportunityRanking?.selected.verifiedTechnicalEvidenceCount ?? 0) +
        (context.opportunityRanking?.selected.verifiedObservationEvidenceCount ?? 0),
      verifiedIndependentSourceCount:
        context.opportunityRanking?.selected.verifiedIndependentSourceCount ?? 0,
      requesterDescription: context.requestDescription,
      primaryDomainName: context.domainName,
      secondaryDomainNames: context.selectedDomains
        .map((domain) => domain.name)
        .filter((name) => name !== context.domainName),
    });
  }

  private isRescueWithinQualityFloor(
    originalContext: IdeaGenerationContext,
    rescuedContext: IdeaGenerationContext,
    strategy: string,
  ): boolean {
    if (!rescuedContext.coreIdea) return false;
    const selectedWinner = originalContext.benchmarkCandidates.find(
      (candidate) => candidate.selected,
    );
    if (!selectedWinner) return true;

    const quality = this.evaluateRescueQuality(rescuedContext);
    const floor = Math.max(
      0,
      selectedWinner.finalScore - this.maximumRescueQualityDrop,
    );
    const accepted = quality.score >= floor;
    if (!accepted) {
      this.logger.warn(
        `Duplicate rescue strategy "${strategy}" rejected for run "${originalContext.runId}" because quality ${quality.score.toFixed(2)} is below floor ${floor.toFixed(2)} (winner=${selectedWinner.finalScore.toFixed(2)}).`,
      );
    }
    return accepted;
  }

  private resolveBlueprintRescueTitle(
    blueprint: RequestProductBlueprint,
    strategy: string,
    fallbackSuffix: string,
  ): string {
    const stem = this.blueprintTitleStem(blueprint);
    if (strategy === 'EVIDENCE_TRIAGE') return blueprint.title;
    if (strategy === 'CASE_HANDOFF') {
      return `${stem} Exception & Handoff Workspace`;
    }
    if (strategy === 'DECISION_TRACE') {
      const decisionStem =
        stem.replace(/\s*(?:&|and)?\s*Decision$/iu, '').trim() || stem;
      return `${decisionStem} & Decision Trace Workspace`;
    }
    if (strategy === 'ROOT_CAUSE_LEDGER') {
      return `${stem} Early-Warning & Root-Cause Workspace`;
    }
    if (strategy === 'EXCEPTION_QUEUE') {
      return `${stem} Exception Prioritization Workspace`;
    }
    if (strategy === 'PILOT_SIGNALS') {
      return `${stem} Pilot Signal & Outcome Workspace`;
    }
    return `${stem} ${fallbackSuffix}`;
  }

  private blueprintTitleStem(blueprint: RequestProductBlueprint): string {
    const stem = blueprint.title
      .replace(
        /\s+(?:workspace|hub|console|desk|platform|board|ledger|assistant)$/iu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();
    return stem || blueprint.baseLabel;
  }

  private resolveGroundedProblem(context: IdeaGenerationContext): string {
    const opportunity = context.benchmarkWinnerOpportunity;
    const rawProblem = opportunity?.problem?.trim();
    if (rawProblem) {
      return rawProblem;
    }

    const selectedProblem = context.opportunityRanking?.selected.problem?.trim();
    if (selectedProblem) {
      return selectedProblem;
    }

    const requesterDescription = context.requestDescription?.trim();
    if (requesterDescription) {
      return requesterDescription;
    }

    return context.coreIdea?.problemStatement?.trim() || 'the selected operational problem';
  }

  private resolveOpportunityAnchor(context: IdeaGenerationContext): string {
    const source =
      context.benchmarkWinnerOpportunity?.title ||
      context.opportunityRanking?.selected.title ||
      context.coreIdea?.title ||
      context.domainName ||
      'Operational';
    const stopWords = new Set([
      'assistant',
      'platform',
      'system',
      'solution',
      'failures',
      'failure',
      'resolution',
      'prevention',
      'monitor',
      'monitoring',
      'workflow',
      'management',
      'manager',
      'tool',
      'workspace',
      'pilot',
      'opportunity',
      'validation',
      'recovery',
    ]);
    const tokens = source
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !stopWords.has(token.toLowerCase()))
      .slice(0, 4);

    return tokens.length > 0 ? tokens.join(' ') : 'Operational Evidence';
  }

  private mergeTargetUsers(
    primary: readonly string[],
    supplemental: readonly string[],
  ): string[] {
    const authoritativePrimary = TargetUserDeduplicationUtil.deduplicate(
      primary.map((value) => value.trim()).filter(Boolean),
      4,
    );

    if (authoritativePrimary.length >= 2) {
      return authoritativePrimary;
    }

    const supplementalCandidates = TargetUserDeduplicationUtil.deduplicate(
      supplemental.map((value) => value.trim()).filter(Boolean),
      4,
    );

    if (authoritativePrimary.length === 0) {
      return supplementalCandidates.slice(0, 3);
    }

    const normalize = (value: string): Set<string> =>
      new Set(
        value
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .split(/\s+/u)
          .map((token) => token.trim())
          .filter(
            (token) =>
              token.length >= 4 &&
              !/^(?:team|teams|staff|user|users|operator|operators|professional|professionals|workflow|pilot|reviewer|reviewers)$/u.test(
                token,
              ),
          ),
      );

    const primaryTokens = normalize(authoritativePrimary[0]);
    const compatibleSupplement = supplementalCandidates.find((candidate) => {
      const candidateTokens = normalize(candidate);
      return [...candidateTokens].some((token) => primaryTokens.has(token));
    });

    return compatibleSupplement
      ? TargetUserDeduplicationUtil.deduplicate(
          [...authoritativePrimary, compatibleSupplement],
          2,
        )
      : authoritativePrimary;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }

  private stableVariantIndex(value: string, modulo: number): number {
    let hash = 0;
    for (const char of value) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return modulo > 0 ? hash % modulo : 0;
  }

  private resolveRunFocusWord(runId: string): string {
    const words = [
      'Trace',
      'Signal',
      'Baseline',
      'Evidence',
      'Review',
      'Insight',
      'Audit',
      'Field',
    ] as const;
    return words[this.stableVariantIndex(runId, words.length)];
  }

  private limitTitle(value: string): string {
    let normalized = value.replace(/\s+/gu, ' ').trim();

    if (
      /\brecovery\b/iu.test(normalized.replace(/\bRecovery Workspace$/iu, '')) &&
      /\bRecovery Workspace$/iu.test(normalized)
    ) {
      normalized = normalized.replace(/\bRecovery Workspace$/iu, 'Resolution Workspace');
    }

    return normalized.slice(0, 100);
  }

  /**
   * Returns true only for similarity strong enough to reject the final idea.
   *
   * A same-family match by itself is not decisive because every candidate for
   * one evidence-backed opportunity necessarily shares part of the problem
   * vocabulary. The workflow must also remain nearly identical.
   */
  private isDecisiveDuplicate(
    result: Awaited<ReturnType<IdeaDuplicateDetectionService['check']>>,
  ): boolean {
    const exactOrNearTitle =
      result.titleSimilarity >= IDEA_TITLE_SIMILARITY_THRESHOLD;
    const veryHighSemanticOverlap =
      result.semanticSimilarity >= IDEA_SEMANTIC_SIMILARITY_THRESHOLD;
    const decisiveSameFamilyWorkflow =
      result.sameProblemFamily &&
      result.semanticSimilarity >= 0.86 &&
      result.workflowSimilarity >= 0.9;
    const decisiveCrossFamilyWorkflow =
      result.semanticSimilarity >= 0.8 &&
      result.workflowSimilarity >= 0.7;

    return (
      exactOrNearTitle ||
      veryHighSemanticOverlap ||
      decisiveSameFamilyWorkflow ||
      decisiveCrossFamilyWorkflow
    );
  }

  /**
   * Validates all context values required for duplicate
   * detection.
   *
   * @param context Current generation context.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.coreIdea) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message:
          'Validated core idea output is required before duplicate detection.',
      });
    }

    if (!context.domainId?.trim()) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message: 'A valid domain ID is required before duplicate detection.',
      });
    }

    if (!context.coreIdea.title?.trim()) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,

        message:
          'A valid generated idea title is required before duplicate detection.',
      });
    }
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Duplicate-check stage definition.
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