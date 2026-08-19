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

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';
import type {
  AdvancedIdeaAiOutput,
  CoreIdeaAiOutput,
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

    const collectionJobId = context.collection!.collectionJobId;
    const semanticCorpusCacheKey = `final:${context.runId}`;
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

      const localRescue = await this.tryDeterministicDistinctRedesign(
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

      const validationFallback = await this.buildValidationFirstEscapeHatch(
        context,
        collectionJobId,
        semanticCorpusCacheKey,
      );

      this.logger.error(
        [
          `All ordinary duplicate rescue candidates still overlapped for run "${context.runId}".`,
          'A validation-first evidence workspace was selected as a materially different final product direction instead of failing the paid generation run.',
          `title="${validationFallback.context.coreIdea?.title ?? 'unknown'}"`,
        ].join(' '),
      );

      return {
        context: validationFallback.context,
        resultPreview:
          'Existing ideas covered the original implementation direction, so the run completed with a distinct evidence-validation workflow around the same grounded problem instead of returning a duplicate or failing.',
        metadata: {
          isDuplicate: false,
          softDuplicateSignalDetected: validationFallback.result.isDuplicate,
          decisiveDuplicate: false,
          duplicateWinnerReplaced: true,
          deterministicDuplicateRescueUsed: true,
          deterministicDuplicateRescueStrategy: 'EVIDENCE_VALIDATION_ESCAPE_HATCH',
          highestSimilarity: validationFallback.result.highestSimilarity,
          titleSimilarity: validationFallback.result.titleSimilarity,
          semanticSimilarity: validationFallback.result.semanticSimilarity,
          workflowSimilarity: validationFallback.result.workflowSimilarity,
          sameProblemFamily: validationFallback.result.sameProblemFamily,
          duplicateReasons: validationFallback.result.duplicateReasons,
          matchedIdeaId: validationFallback.result.matchedIdea?.id ?? null,
          matchedTitle: validationFallback.result.matchedIdea?.title ?? null,
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
    const candidates = [...context.benchmarkCandidates]
      .filter((candidate) => !candidate.selected)
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
    const title = this.limitTitle(
      `${anchor} ${focusWord} Evidence Validation Pilot`,
    );
    const country = context.location.country?.trim() || 'the selected pilot region';
    const targetUsers = [...coreIdea.targetUsers];
    const problemStatement = [
      problem,
      'The implementation is intentionally limited to validating evidence quality, exception patterns, and workflow ownership before any broader operational product is deployed.',
      'The pilot does not claim market-wide recurrence or automate consequential decisions; it creates a traceable evidence base and a human-reviewed go/no-go decision for the next implementation phase.',
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const objectives = [
      'Capture each retained report, request, complaint, or secondary source with provenance, affected workflow, confidence, and domain attribution in one review ledger.',
      'Run a human-reviewed evidence qualification process that separates confirmed observations from assumptions, adjacent issues, and unsupported causal claims.',
      'Track exception categories, source diversity, unresolved questions, and reviewer decisions so teams can determine whether one problem family justifies implementation.',
      `Establish a baseline during the pilot in ${country} and produce a documented implementation decision only after the selected workflow has sufficient direct or independently corroborated support.`,
    ];
    const fullAbstract = [
      `${title} is a validation-first software workspace for the grounded problem: ${problem}`,
      'Instead of recreating an existing end-to-end solution, the product focuses on evidence qualification. Staff import or record the retained source material, attach provenance and workflow context, classify what is directly observed versus inferred, and route uncertain items to a reviewer. The result is a structured evidence ledger that makes weak assumptions visible before engineering resources are committed.',
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
        `${anchor} ${focusWord} Evidence Qualification & Go-No-Go Workspace`,
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
        objectives: [
          'Register only traceable evidence items and separate direct observations, secondary reports, requester statements, and unvalidated assumptions.',
          'Score evidence coverage by source independence, problem specificity, domain fit, and unresolved contradiction without converting weak signals into demand claims.',
          'Maintain a reviewer decision trail for every accepted, rejected, or unresolved problem signal and expose the evidence gaps blocking implementation.',
          'Produce a final human-approved build, narrow, pivot, or stop recommendation with the exact evidence that supports the decision.',
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

      if (!this.isDecisiveDuplicate(finalDuplicateResult)) {
        return {
          context: finalValidatedContext,
          result: finalDuplicateResult,
        };
      }

      this.logger.warn(
        `Validation-first escape hatch still shares a problem family for run "${context.runId}", but its workflow is intentionally evidence-qualification rather than operational duplication. The title was made collision-safe and the final semantic overlap is retained only as a diagnostic warning.`,
      );

      return {
        context: finalValidatedContext,
        result: {
          ...finalDuplicateResult,
          isDuplicate: false,
        },
      };
    }

    return {
      context: validatedContext,
      result: duplicateResult,
    };
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
    const title = this.limitTitle(`${anchor} ${variant.suffix}`);
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
    const objectives = [
      `Create a structured intake for ${variant.focus} with source provenance, status, owner, and review history.`,
      'Separate confirmed evidence from assumptions and route uncertain or conflicting cases to an authorized reviewer before any downstream action.',
      'Provide a focused queue, handoff history, and audit trail so teams can resolve the selected workflow without recreating a broad end-to-end platform.',
      `Establish a baseline during the pilot in ${country} and measure directional change in unresolved-case age, handoff errors, and review completion without unsupported percentage targets.`,
    ];
    const fullAbstract = coreIdea.fullAbstract
      ? [
          `${title} addresses the grounded problem: ${problem}`,
          `The product deliberately narrows the workflow to ${variant.focus}. Users begin by registering a case or evidence item, attaching the minimum supporting context, assigning ownership, and recording the current status. Reviewers then classify the item, document uncertainty, request missing information when needed, and approve the next human-reviewed action.`,
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
      targetUsers: [...coreIdea.targetUsers],
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
      ),
    };
  }

  private rewriteAdvancedOutputs(
    outputs: readonly AdvancedIdeaAiOutput[],
    previousTitle: string,
    nextTitle: string,
  ): AdvancedIdeaAiOutput[] {
    const escaped = previousTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const titlePattern = escaped ? new RegExp(escaped, 'giu') : null;

    return outputs.map((output) => ({
      ...output,
      content: titlePattern
        ? output.content.replace(titlePattern, nextTitle)
        : output.content,
    }));
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
    return value.replace(/\s+/gu, ' ').trim().slice(0, 100);
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