import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';
import {
  classifyDirectCommunityEvidence,
  isLikelyPromotionalEvidence,
  isStructuredOperationalProblemEvidence,
  scoreProblemEvidenceActionability,
} from '../../../../nlp/common/utils/community-evidence.util';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_EVIDENCE_RECOVERY_ATTEMPTS,
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
import { IdeaEvidenceRecoveryService } from '../../services/idea-evidence-recovery.service';
import {
  IndependentEvidenceVerificationService,
  type EvidenceProvenanceHint,
} from '../../services/independent-evidence-verification.service';
import type {
  EvidenceRecoveryOutcome,
  RecoveredExternalEvidence,
} from '../../services/idea-evidence-recovery.service';
import type { IndependentEvidence } from '../../types/independent-evidence.type';
import {
  IdeaOpportunityRankingService,
  NoRankedIdeaOpportunityError,
} from '../../services/idea-opportunity-ranking.service';
import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';
import type {
  IdeaOpportunityRanking,
  RankedIdeaOpportunity,
} from '../../types/idea-opportunity-ranking.type';
import type {
  CommunityAiAnalysis,
  CommunityAiOpportunity,
} from '../../types/community-ai-analysis.type';
import { RequestEvidenceAlignmentUtil } from '../../utils/request-evidence-alignment.util';
import { CanonicalRequestProductBlueprintUtil } from '../../utils/canonical-request-product-blueprint.util';
import { RequestWorkflowArchetypeUtil } from '../../utils/request-workflow-archetype.util';
import { RequestDynamicQueryUtil } from '../../utils/request-dynamic-query.util';
import { CanonicalProblemFamilyUtil } from '../../utils/canonical-problem-family.util';
import { RequestWorkflowIntentProfileUtil } from '../../utils/request-workflow-intent-profile.util';
import { SelectedDomainEvidenceAlignmentUtil } from '../../utils/selected-domain-evidence-alignment.util';
import { CanonicalEvidenceVerificationUtil } from '../../utils/canonical-evidence-verification.util';
import { CanonicalEvidenceStateUtil } from '../../utils/canonical-evidence-state.util';
import {
  matchEvidenceToProblemFamily,
  resolvePrimaryProblemFamily,
} from '../../../../nlp/common/utils/problem-family-matching.util';

/**
 * Ranks evidence-backed opportunities and applies bounded evidence recovery.
 *
 * The stage never terminates generation solely because the strict evidence gate
 * remains unmet. After bounded recovery it continues with the strongest ranked
 * signal, or with a primary-domain validation hypothesis when no rankable signal
 * exists. Downstream prompt, benchmark, and validation stages are responsible for
 * keeping sparse-evidence claims explicitly qualified.
 */
@Injectable()
export class OpportunityRankingStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING;

  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  private readonly previousIdeaTextCache = new Map<
    string,
    { readonly expiresAt: number; readonly texts: readonly string[] }
  >();

  constructor(
    private readonly opportunityRankingService: IdeaOpportunityRankingService,
    private readonly independentEvidenceVerificationService: IndependentEvidenceVerificationService,
    private readonly evidenceRecoveryService: IdeaEvidenceRecoveryService,
    private readonly prisma: PrismaService,
  ) {}

  shouldExecute(): boolean {
    return true;
  }

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message: 'NLP analysis is required before opportunity ranking.',
      });
    }

    const explicitDomainsOnlyCompetition =
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_SELECTED' &&
      context.selectedDomains.length > 1;

    /*
     * Direct retained evidence across explicitly selected domains is resolved
     * before the generic ranking/recovery path. This prevents positional bias
     * toward selectedDomains[0]: if Mental Health, HR, or any other explicitly
     * selected secondary domain has a verified complaint/request, that evidence
     * must beat a no-evidence primary-domain hypothesis.
     *
     * Load duplicate-history text in parallel with this provenance check. The
     * direct competition does not depend on previous ideas, so overlapping the
     * two DB reads removes avoidable ranking latency without changing quality.
     */
    const previousIdeaTextsPromise = this.loadPreviousIdeaTexts(context.domainId);
    const explicitDirectCompetitionPromise = explicitDomainsOnlyCompetition
      ? this.verifyExplicitDomainsOnlyDirectCompetition(context)
      : Promise.resolve<IdeaOpportunityRanking | null>(null);

    const [previousIdeaTexts, explicitDirectCompetition] = await Promise.all([
      previousIdeaTextsPromise,
      explicitDirectCompetitionPromise,
    ]);

    let workingContext = context;
    let ranking = explicitDirectCompetition;

    if (!ranking) {
      ranking = this.enforcePrimaryDomainFallback(
        await this.tryRankContext(workingContext, previousIdeaTexts),
        workingContext,
      );
    }

    if (ranking) {
      // Apply request intent before recovery so a mismatch cannot consume the
      // bounded recovery budget just because its existing evidence is strong.
      ranking = this.applyRequestIntentAlignment(ranking, workingContext);
    }

    /*
     * Before paying for targeted recovery, verify whether the primary retained
     * corpus already contains a concrete problem-matched secondary report. The
     * normal NLP tournament can legitimately return a validation hypothesis when
     * all direct-user signals were filtered out even though a news/research item
     * with a concrete family is already present in domainEvidence.
     *
     * This does not weaken evidence quality: the candidate is rebuilt from the
     * verbatim retained sample, then passes the same provenance, selected-domain,
     * and problem-family verification used after recovery. It only removes the
     * redundant second collection wave when that verification already succeeds.
     */
    const currentIsValidationHypothesis = Boolean(
      ranking?.selected.disqualificationReasons.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      ),
    );
    const currentHasUsableEvidence = Boolean(
      ranking && this.hasUsableExternalEvidence(ranking.selected),
    );
    const primaryAiClassifiedExternalEvidence =
      this.buildCommunityAiClassifiedExternalEvidence(workingContext);
    const primaryAiHasDirectProblem =
      workingContext.communityAiAnalysis?.evidenceClassifications?.some(
        (item) =>
          item.classification === 'DIRECT_PROBLEM' &&
          item.verifiedByDeterministicGuard,
      ) ?? false;

    /*
     * Description-bearing runs may legitimately have verified external
     * SUPPORTING_SIGNAL records without a DIRECT_PROBLEM. Those records must
     * remain attached to the canonical requester hypothesis instead of being
     * discarded merely because they are not strong enough to replace it.
     * Once provenance verifies them, they are sufficient to ground a cautious
     * pilot and also prevent an unnecessary recovery wave whose only purpose
     * would be to upgrade supporting evidence to direct evidence.
     */
    if (
      workingContext.requestDescription?.trim() &&
      !primaryAiHasDirectProblem &&
      primaryAiClassifiedExternalEvidence.length > 0 &&
      ranking
    ) {
      const verifiedRequesterSupport =
        this.verifyQualifiedRequesterSupportingEvidence(
          workingContext,
          primaryAiClassifiedExternalEvidence,
        );
      if (verifiedRequesterSupport.length > 0) {
        ranking = this.mergeQualifiedRequesterSupportingEvidence(
          workingContext,
          ranking,
          verifiedRequesterSupport,
        );
      }
    } else if (
      (!ranking || currentIsValidationHypothesis || !currentHasUsableEvidence) &&
      (!workingContext.requestDescription?.trim() ||
        primaryAiClassifiedExternalEvidence.length > 0)
    ) {
      const retainedExternalFallback =
        await this.verifyExternalSupportingEvidenceFallback(
          workingContext,
          primaryAiClassifiedExternalEvidence,
        );
      if (
        retainedExternalFallback &&
        (workingContext.requestDescription?.trim() ||
          this.isSufficientVerifiedSecondaryPilotEvidence(
            retainedExternalFallback.selected,
          ))
      ) {
        ranking = retainedExternalFallback;
      }
    }

    const recoverySupportingExternalEvidence: RecoveredExternalEvidence[] = [
      ...primaryAiClassifiedExternalEvidence,
    ];
    let recoveryExecutionWaves = 0;
    // Recovery is a single rescue wave, never a repeating loop.
    const maximumRecoveryExecutionWaves = 1;
    const maximumRecoveryAttemptsForRun = 1;
    const seenRecoveryCollectionJobIds = new Set(
      workingContext.evidenceRecoveryCollectionJobIds.filter(Boolean),
    );
    const recoveryMetadata: Array<{
      readonly collectionJobId: string;
      readonly selectedDataSourceKeys: readonly string[];
      readonly recoveryKeywords: readonly string[];
      readonly totalPosts: number;
      readonly totalComments: number;
      readonly usefulCleanTextCount: number;
      readonly complaintEvidenceCount: number;
      readonly evidenceFamilies: readonly string[];
      readonly communityAiRecoveryApplied: boolean;
      readonly communityAiRecoveryExecuted: boolean;
      readonly newCorpusEvidenceSampleCount: number;
      readonly selectedOpportunityNewEvidenceCount: number;
      readonly newEvidenceSampleCount: number;
      readonly recoveryOutcome: EvidenceRecoveryOutcome;
    }> = [];

    while (
      this.shouldRunEvidenceRecovery(ranking, workingContext) &&
      workingContext.evidenceRecoveryAttempts < maximumRecoveryAttemptsForRun &&
      recoveryExecutionWaves < maximumRecoveryExecutionWaves
    ) {
      const recoveryTarget = this.resolveRecoveryTarget(
        ranking,
        recoveryExecutionWaves,
        workingContext,
      );
      const recoveryContext = {
        ...workingContext,
        evidenceRecoveryAttempts: Math.min(
          recoveryExecutionWaves,
          MAX_EVIDENCE_RECOVERY_ATTEMPTS - 1,
        ),
      };
      const recovery = await this.evidenceRecoveryService.recover(
        recoveryContext,
        recoveryTarget,
        recoveryMetadata.flatMap((attempt) => attempt.selectedDataSourceKeys),
      );
      recoveryExecutionWaves += 1;

      /*
       * Count every executed recovery wave, including timeout/skip/failure.
       * Previously the counter advanced only after a completed UUID-backed
       * collection, so timed-out waves were reported as zero attempts and could
       * be repeated after resume/retry.
       */
      workingContext = {
        ...workingContext,
        evidenceRecoveryAttempts: Math.min(
          MAX_EVIDENCE_RECOVERY_ATTEMPTS,
          workingContext.evidenceRecoveryAttempts + 1,
        ),
      };

      if (recovery.selectedDataSourceKeys.length === 0) {
        recoveryMetadata.push({
          collectionJobId: recovery.collectionJobId,
          selectedDataSourceKeys: recovery.selectedDataSourceKeys,
          recoveryKeywords: recovery.recoveryKeywords,
          totalPosts: recovery.totalPosts,
          totalComments: recovery.totalComments,
          usefulCleanTextCount: recovery.usefulCleanTextCount,
          complaintEvidenceCount: recovery.complaintEvidenceCount,
          evidenceFamilies: recovery.evidenceFamilies,
          communityAiRecoveryApplied: false,
          communityAiRecoveryExecuted: recovery.communityAiRecoveryExecuted,
          newCorpusEvidenceSampleCount: 0,
          selectedOpportunityNewEvidenceCount: 0,
          newEvidenceSampleCount: 0,
          recoveryOutcome: recovery.recoveryOutcome,
        });
        break;
      }

      const completedRecoveryCollection =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          recovery.collectionJobId,
        );
      const contributedEvidence =
        completedRecoveryCollection && recovery.newCorpusEvidenceSampleCount > 0;
      const duplicateRecoveryCollection =
        completedRecoveryCollection &&
        seenRecoveryCollectionJobIds.has(recovery.collectionJobId);
      if (completedRecoveryCollection) {
        seenRecoveryCollectionJobIds.add(recovery.collectionJobId);
      }
      recoverySupportingExternalEvidence.push(
        ...recovery.supportingExternalEvidence,
      );

      if (duplicateRecoveryCollection) {
        recoveryMetadata.push({
          collectionJobId: recovery.collectionJobId,
          selectedDataSourceKeys: recovery.selectedDataSourceKeys,
          recoveryKeywords: recovery.recoveryKeywords,
          totalPosts: recovery.totalPosts,
          totalComments: recovery.totalComments,
          usefulCleanTextCount: recovery.usefulCleanTextCount,
          complaintEvidenceCount: recovery.complaintEvidenceCount,
          evidenceFamilies: recovery.evidenceFamilies,
          communityAiRecoveryApplied: false,
          communityAiRecoveryExecuted: recovery.communityAiRecoveryExecuted,
          newCorpusEvidenceSampleCount: 0,
          selectedOpportunityNewEvidenceCount: 0,
          newEvidenceSampleCount: 0,
          recoveryOutcome: 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE',
        });
        break;
      }

      if (!completedRecoveryCollection) {
        recoveryMetadata.push({
          collectionJobId: recovery.collectionJobId,
          selectedDataSourceKeys: recovery.selectedDataSourceKeys,
          recoveryKeywords: recovery.recoveryKeywords,
          totalPosts: recovery.totalPosts,
          totalComments: recovery.totalComments,
          usefulCleanTextCount: recovery.usefulCleanTextCount,
          complaintEvidenceCount: recovery.complaintEvidenceCount,
          evidenceFamilies: recovery.evidenceFamilies,
          communityAiRecoveryApplied: false,
          communityAiRecoveryExecuted: recovery.communityAiRecoveryExecuted,
          newCorpusEvidenceSampleCount: 0,
          selectedOpportunityNewEvidenceCount: 0,
          newEvidenceSampleCount: 0,
          recoveryOutcome: recovery.recoveryOutcome,
        });
        continue;
      }

      const mergedCommunityAiAnalysis = recovery.communityAiAnalysis
        ? this.mergeCommunityAiAnalyses(
            workingContext.communityAiAnalysis,
            recovery.communityAiAnalysis,
          )
        : workingContext.communityAiAnalysis;
      const mergedRawEvidenceCorpus = this.mergeRawEvidenceCorpus(
        workingContext.rawEvidenceCorpus,
        recovery.rawEvidenceCorpus,
      );

      workingContext = this.synchronizeCanonicalEvidenceState({
        ...workingContext,
        nlp: contributedEvidence
          ? this.mergeNlpContexts(workingContext.nlp!, recovery.nlp)
          : workingContext.nlp,
        communityAiAnalysis: mergedCommunityAiAnalysis,
        rawEvidenceCorpus: mergedRawEvidenceCorpus,
        canonicalEvidenceLedger: this.mergeCanonicalEvidenceLedger(
          workingContext,
          workingContext.canonicalEvidenceLedger,
          recovery.rawEvidenceCorpus,
          recovery.communityAiAnalysis,
        ),
        domainEvidence: contributedEvidence
          ? this.mergeRecoveredEvidenceIntoDomainEvidence(
              workingContext,
              recovery.supportingExternalEvidence,
              recovery.collectionJobId,
            )
          : workingContext.domainEvidence,
        opportunityRanking: null,
        evidenceRecoveryAttempts: workingContext.evidenceRecoveryAttempts,
        evidenceRecoveryCollectionJobIds: [
          ...workingContext.evidenceRecoveryCollectionJobIds,
          recovery.collectionJobId,
        ],
      });

      ranking = this.enforcePrimaryDomainFallback(
        await this.tryRankContext(workingContext, previousIdeaTexts),
        workingContext,
      );
      if (ranking) {
        ranking = this.applyRequestIntentAlignment(ranking, workingContext);
      }

      if (
        ranking &&
        workingContext.requestDescription?.trim() &&
        recovery.supportingExternalEvidence.length > 0
      ) {
        const verifiedRecoveredRequesterSupport =
          this.verifyQualifiedRequesterSupportingEvidence(
            workingContext,
            recovery.supportingExternalEvidence,
          );
        if (verifiedRecoveredRequesterSupport.length > 0) {
          ranking = this.mergeQualifiedRequesterSupportingEvidence(
            workingContext,
            ranking,
            verifiedRecoveredRequesterSupport,
          );
        }
      }

      /*
       * Recovery evidence must re-enter the exact same provenance-verification
       * and domain-alignment gate as primary evidence. A recovered, verified
       * selected-domain signal always outranks a zero-evidence validation
       * hypothesis. This prevents a successful Manufacturing recovery from
       * being discarded merely because the primary HR profile was empty.
       */
      if (
        recoverySupportingExternalEvidence.length > 0 &&
        !this.hasUsableExternalEvidence(ranking?.selected ?? null)
      ) {
        const verifiedRecoveredRanking =
          await this.verifyExternalSupportingEvidenceFallback(
            workingContext,
            recoverySupportingExternalEvidence,
          );
        if (verifiedRecoveredRanking) {
          const currentUsable = Boolean(
            ranking && this.hasUsableExternalEvidence(ranking.selected),
          );
          const currentIsValidationHypothesis = Boolean(
            ranking?.selected.disqualificationReasons.includes(
              'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
            ),
          );
          const recoveredActionability = this.candidateEvidenceActionability(
            verifiedRecoveredRanking.selected,
          );
          const currentActionability = ranking
            ? this.candidateEvidenceActionability(ranking.selected)
            : 0;
          const recoveredReliability =
            verifiedRecoveredRanking.selected.evidenceReliabilityScore ?? 0;
          const currentReliability =
            ranking?.selected.evidenceReliabilityScore ?? 0;

          if (
            !currentUsable ||
            currentIsValidationHypothesis ||
            recoveredActionability + recoveredReliability >
              currentActionability + currentReliability + 0.08
          ) {
            ranking = verifiedRecoveredRanking;
          }
        }
      }
      const selectedOpportunityNewEvidenceCount =
        this.countSelectedOpportunityNovelEvidence(
          ranking?.selected ?? null,
          recovery.novelEvidenceSamples,
        );

      recoveryMetadata.push({
        collectionJobId: recovery.collectionJobId,
        selectedDataSourceKeys: recovery.selectedDataSourceKeys,
        recoveryKeywords: recovery.recoveryKeywords,
        totalPosts: recovery.totalPosts,
        totalComments: recovery.totalComments,
        usefulCleanTextCount: recovery.usefulCleanTextCount,
        complaintEvidenceCount: recovery.complaintEvidenceCount,
        evidenceFamilies: recovery.evidenceFamilies,
        communityAiRecoveryApplied:
          contributedEvidence && Boolean(recovery.communityAiAnalysis),
        communityAiRecoveryExecuted: recovery.communityAiRecoveryExecuted,
        newCorpusEvidenceSampleCount: recovery.newCorpusEvidenceSampleCount,
        selectedOpportunityNewEvidenceCount,
        newEvidenceSampleCount: recovery.newEvidenceSampleCount,
        recoveryOutcome: recovery.recoveryOutcome,
      });

      if (
        !workingContext.requestDescription?.trim() &&
        recovery.newCorpusEvidenceSampleCount === 0 &&
        recoveryExecutionWaves >= maximumRecoveryExecutionWaves
      ) {
        break;
      }

      /*
       * Do not stop recovery merely because a raw external sample exists.
       * The sample must survive provenance verification and the requester/domain
       * alignment gate first. Otherwise a false-positive recovery hit can stop
       * the search and still leave the final ranking at evidenceCoverage=0.
       */
      if (this.hasUsableExternalEvidence(ranking?.selected ?? null)) {
        break;
      }

      if (
        recoverySupportingExternalEvidence.length > 0 &&
        !this.hasUsableExternalEvidence(ranking?.selected ?? null)
      ) {
        const verifiedRecoveryFallback =
          await this.verifyExternalSupportingEvidenceFallback(
            workingContext,
            recoverySupportingExternalEvidence,
          );
        if (verifiedRecoveryFallback) {
          ranking = verifiedRecoveryFallback;
          break;
        }
      }

      /*
       * Request-scoped text generation is allowed one additional rotated wave
       * when the first recovery wave still has no verified evidence. Sources
       * used by the previous wave are excluded, and runtime-unavailable
       * collectors are removed by IdeaEvidenceRecoveryService. This is enough
       * to survive a quota/rate-limit failure without returning to the old
       * all-source fan-out or weakening evidence verification.
       */
    }

    /*
     * A generated idea must have at least one real request-matched external
     * evidence sample. Independently verified direct community evidence is
     * preferred; strongly aligned secondary evidence remains explicitly qualified. A primary-domain validation hypothesis is
     * useful internally for recovery targeting, but it is not sufficient to
     * justify charging the user or persisting a premium idea.
     *
     * One verified report is enough for a cautious preliminary pilot. The
     * existing recurrence gate remains stricter and still requires independent
     * multi-source support before recurring-demand language is allowed.
     */
    let selectedCandidate = ranking?.selected ?? null;
    let hasVerifiedExternalEvidence = Boolean(
      selectedCandidate &&
        !selectedCandidate.disqualificationReasons.includes(
          'OFF_SELECTED_DOMAIN',
        ) &&
        !selectedCandidate.disqualificationReasons.includes(
          'REQUEST_INTENT_MISMATCH',
        ) &&
        !selectedCandidate.disqualificationReasons.includes(
          'EVIDENCE_SEMANTIC_MISMATCH',
        ) &&
        ((selectedCandidate.verifiedProblemMatchedEvidenceCount ??
          selectedCandidate.verifiedIndependentEvidenceCount ??
          selectedCandidate.verifiedEvidenceCount ??
          0) > 0 ||
          (selectedCandidate.independentEvidence?.some(
            (evidence) =>
              evidence.evidenceKind !== 'UNKNOWN' &&
              evidence.evidenceKind !== 'SPECIFICATION',
          ) ?? false) ||
          (selectedCandidate.qualifiedExternalSupportingEvidenceCount ?? 0) > 0),
    );

    if (!hasVerifiedExternalEvidence) {
      const verifiedSupportingFallback =
        await this.verifyExternalSupportingEvidenceFallback(
          workingContext,
          recoverySupportingExternalEvidence,
        );
      if (verifiedSupportingFallback) {
        ranking = verifiedSupportingFallback;
        selectedCandidate = ranking.selected;
        hasVerifiedExternalEvidence = this.hasUsableExternalEvidence(
          selectedCandidate,
        );
      }
    }

    /*
     * Generation is result-preserving: a run must not terminate at ranking
     * merely because bounded external collection returned no verifiable
     * evidence. When at least one real external sample exists, the supporting
     * fallback above is used and the final idea is explicitly preliminary.
     * When every external source genuinely returned no usable evidence, keep
     * the primary/requester validation hypothesis and continue generation as
     * an explicitly UNVALIDATED pilot. This never upgrades requester text or
     * personalization into community evidence; it only guarantees that a
     * technically successful run returns a useful idea instead of an empty
     * workspace.
     */
    if (!hasVerifiedExternalEvidence) {
      ranking = ranking ?? this.buildEmergencyFallbackRanking(workingContext);
    }

    ranking = ranking ?? this.buildEmergencyFallbackRanking(workingContext);

    if (
      !hasVerifiedExternalEvidence &&
      !workingContext.requestDescription?.trim() &&
      workingContext.selectedDomains.length > 1
    ) {
      ranking = this.buildSingleDomainValidationFallback(workingContext);
    }

    const aggregatedRecoveryMetadata = recoveryMetadata.length
      ? {
          ...this.aggregateRecoveryMetadata(recoveryMetadata),
          recoveredExternalEvidenceSampleCount:
            recoverySupportingExternalEvidence.length,
          verifiedRecoveredEvidenceCount: ranking
            ? this.countVerifiedRecoveredEvidence(
                ranking.selected,
                recoverySupportingExternalEvidence,
              )
            : 0,
          rejectedRecoveredEvidenceCount: ranking
            ? Math.max(
                0,
                recoverySupportingExternalEvidence.length -
                  this.countVerifiedRecoveredEvidence(
                    ranking.selected,
                    recoverySupportingExternalEvidence,
                  ),
              )
            : recoverySupportingExternalEvidence.length,
        }
      : null;

    ranking = this.enforceCommunityEvidenceQualificationInvariant(
      workingContext,
      ranking,
    );

    return this.buildSuccessResult(
      workingContext,
      ranking,
      recoveryMetadata.length > 0,
      aggregatedRecoveryMetadata,
    );
  }

  /**
   * Runs recovery only when the primary corpus has no usable direct signal.
   *
   * A concrete feature request, bug report, failure description, or explicit
   * missing-capability statement is already valuable evidence for a bounded
   * pilot, even when strict recurrence verification has not reached the
   * multi-source gate. Skipping recovery in that case avoids repeating a full
   * collection/NLP/Community-AI pass that cannot materially improve the idea.
   */
  private shouldRunEvidenceRecovery(
    ranking: IdeaOpportunityRanking | null,
    context: IdeaGenerationContext,
  ): boolean {
    if (context.evidenceRecoveryAttempts >= 1) {
      return false;
    }

    const primaryAi = context.communityAiAnalysis;
    const classifications = primaryAi?.evidenceClassifications ?? [];
    const trustedEvidenceCount = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    ).length;

    // The canonical ledger is the only recovery admission source-of-truth.
    if (trustedEvidenceCount > 0) {
      return false;
    }

    if (ranking && this.hasUsableExternalEvidence(ranking.selected)) {
      return false;
    }

    const rawEvidenceCount = context.rawEvidenceCorpus?.length ?? 0;
    const semanticClassificationCompleted = Boolean(
      classifications.length > 0 &&
      classifications.every(
        (item) =>
          item.classification === 'UNRELATED' ||
          item.classification === 'CONTEXT_ONLY',
      ),
    );

    // Do not recollect when the semantic AI layer itself was unavailable.
    if (
      rawEvidenceCount > 0 &&
      primaryAi &&
      primaryAi.onlineAttemptCount === 0 &&
      !semanticClassificationCompleted
    ) {
      return false;
    }

    return true;
  }

  /**
   * Accepts explicit user/developer problem reports, not product marketing.
   * This is deliberately stricter than generic keyword relevance.
   */
  private looksLikeDirectProblemEvidence(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const commentMatch = normalized.match(/\bCommunity comment:\s*(.+)$/iu);
    const evidenceText = commentMatch?.[1]?.trim() ?? normalized;

    const kind = classifyDirectCommunityEvidence(
      evidenceText,
      commentMatch ? 'COMMENT' : 'POST',
    );
    return kind === 'USER_COMPLAINT' ||
      kind === 'FEATURE_REQUEST' ||
      kind === 'OBSERVED_UNMET_NEED';
  }

  private isLikelyTechnicalTicketFallback(
    value: string,
    sourceKind: 'POST' | 'COMMENT',
    sourceKey = '',
  ): boolean {
    if (sourceKind !== 'POST') return false;

    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized) return false;
    const normalizedSourceKey = sourceKey.trim().toLocaleLowerCase();

    const structuredTicket =
      /(?:^|\b)(?:summary|issue|bug description|environment info|steps? to reproduce|expected behavior|actual behavior|error message|stack trace|feedback id|version)(?:\s*:|\b)/iu.test(
        normalized,
      );
    const planningOrDesignTicket =
      /\b(?:acceptance criteria|definition of done|implementation plan|technical design|design v\d+|design version \d+|daily loop|backlog|milestone|roadmap|proposed architecture|test plan|engineering task|implementation task)\b/iu.test(
        normalized,
      ) &&
      /\b(?:design|implementation|architecture|feature|workflow|module|component|api|database|schema|frontend|backend|service|repository|issue|ticket|version|v\d+)\b/iu.test(
        normalized,
      );
    const technicalContext =
      /\b(?:production|deployment|cloud|aws|developer|developers|runtime|terminal|tmux|version|api|endpoint|code|billing logic|date check|quality control|error|bug|platform|repository|github|implementation|architecture|schema|frontend|backend|module|component|ics|yaml|calendar feed|feed parser)\b/iu.test(
        normalized,
      );
    const sourceBackedTechnicalIssue =
      (normalizedSourceKey === 'github' || normalizedSourceKey === 'stackoverflow') &&
      structuredTicket &&
      technicalContext;

    return sourceBackedTechnicalIssue ||
      (structuredTicket && technicalContext) ||
      planningOrDesignTicket;
  }

  /**
   * Reads representative domain-evidence text from nullable Prisma JSON.
   *
   * Domain evidence is persisted as JsonValue, so samplePosts/sampleComments
   * cannot be accessed as typed arrays directly. Invalid entries are ignored
   * instead of failing the whole generation run.
   */
  private readDomainEvidenceTexts(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const rawText = (item as Prisma.JsonObject).text;

        return typeof rawText === 'string'
          ? rawText.replace(/\s+/gu, ' ').trim()
          : null;
      })
      .filter((item): item is string => Boolean(item));
  }

  /**
   * Prevents an unsupported secondary-domain fallback from becoming the final
   * product direction. Secondary domains may win only when they retain direct
   * evidence. With no direct evidence, generation remains anchored to the
   * primary domain selected by the user.
   */
  private enforcePrimaryDomainFallback(
    ranking: IdeaOpportunityRanking | null,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking | null {
    if (!ranking) {
      return this.buildPrimaryDomainHypothesisRanking(context);
    }

    const candidates = [ranking.selected, ...ranking.alternatives];
    const directCandidate = candidates.find((candidate) => {
      if (candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN')) {
        return false;
      }

      const hasVerifiedRetainedEvidence =
        candidate.independentEvidence?.some(
          (evidence) =>
            evidence.evidenceKind !== 'UNKNOWN' &&
            evidence.evidenceKind !== 'SPECIFICATION',
        ) ?? false;
      const hasDirectProblemSample = candidate.evidenceSamples.some((sample) =>
        this.looksLikeDirectProblemEvidence(sample),
      );

      return hasVerifiedRetainedEvidence || hasDirectProblemSample;
    });

    if (directCandidate) {
      const directEvidenceCount = directCandidate.evidenceSamples.filter(
        (sample) => this.looksLikeDirectProblemEvidence(sample),
      ).length;
      const verifiedDirectEvidenceCount =
        directCandidate.verifiedProblemMatchedDirectUserEvidenceCount ??
        directCandidate.verifiedDirectUserEvidenceCount ??
        directCandidate.verifiedIndependentEvidenceCount ??
        0;
      const verifiedSecondaryEvidenceCount =
        directCandidate.verifiedProblemMatchedSecondaryEvidenceCount ??
        directCandidate.verifiedSecondaryEvidenceCount ??
        0;
      const verifiedTechnicalEvidenceCount =
        directCandidate.verifiedProblemMatchedTechnicalEvidenceCount ??
        directCandidate.verifiedTechnicalEvidenceCount ??
        0;
      const verifiedFeatureRequestEvidenceCount =
        directCandidate.verifiedProblemMatchedFeatureRequestEvidenceCount ??
        directCandidate.verifiedFeatureRequestEvidenceCount ??
        0;
      const verifiedComplaintEvidenceCount =
        directCandidate.verifiedProblemMatchedComplaintEvidenceCount ??
        directCandidate.verifiedComplaintEvidenceCount ??
        0;
      const featureRequestOnly =
        verifiedDirectEvidenceCount > 0 &&
        verifiedComplaintEvidenceCount === 0 &&
        verifiedFeatureRequestEvidenceCount === verifiedDirectEvidenceCount;
      const verifiedEvidenceCount =
        directCandidate.verifiedProblemMatchedEvidenceCount ??
        directCandidate.verifiedEvidenceCount ??
        Math.max(
          directEvidenceCount,
          verifiedDirectEvidenceCount +
            verifiedSecondaryEvidenceCount +
            verifiedTechnicalEvidenceCount,
        );
      const verifiedDirectSourceCount =
        directCandidate.verifiedProblemMatchedSourceCount ??
        directCandidate.verifiedIndependentSourceCount ??
        0;
      const verifiedSourceCount =
        directCandidate.verifiedProblemMatchedEvidenceSourceCount ??
        directCandidate.verifiedEvidenceSourceCount ??
        verifiedDirectSourceCount;

      const selectionReason = directCandidate.selectionEligible
        ? featureRequestOnly
          ? `Selected the strongest evidence-backed preliminary opportunity after retaining ${verifiedFeatureRequestEvidenceCount} verified feature request(s) across ${Math.max(1, verifiedDirectSourceCount)} source(s). Feature requests are direct demand signals but do not by themselves establish complaint recurrence.`
          : verifiedDirectEvidenceCount > 0
            ? `Selected the strongest evidence-backed preliminary opportunity after retaining ${verifiedDirectEvidenceCount} verified direct user report(s) across ${Math.max(1, verifiedDirectSourceCount)} direct source(s). Recurrence is not established unless at least 3 direct reports span 2 independent sources.`
            : verifiedSecondaryEvidenceCount > 0
            ? `Selected the strongest evidence-backed preliminary opportunity from ${verifiedSecondaryEvidenceCount} retained secondary report(s) across ${Math.max(1, verifiedSourceCount)} retained source(s); no verified direct user complaint establishes recurrence.`
            : verifiedTechnicalEvidenceCount > 0
              ? `Selected the strongest evidence-backed preliminary opportunity from ${verifiedTechnicalEvidenceCount} retained technical ticket(s) across ${Math.max(1, verifiedSourceCount)} retained source(s); no verified direct user complaint establishes recurrence.`
              : `Selected the strongest available domain-aligned preliminary opportunity from retained evidence; no verified direct user complaint establishes recurrence.`
        : `${verifiedEvidenceCount === 1 ? 'One problem-matched evidence item was retained' : `${verifiedEvidenceCount} problem-matched evidence items were retained`}, but the evidence does not yet satisfy the independent recurrence requirement of at least 3 verified direct reports across 2 independent sources.`;

      const ordered = [
        directCandidate,
        ...candidates.filter((candidate) => candidate !== directCandidate),
      ].map((candidate, index) => ({ ...candidate, rank: index + 1 }));

      return {
        ...ranking,
        selected: ordered[0],
        alternatives: ordered.slice(1),
        selectionReason,
      };
    }

    /*
     * No selected-domain candidate retained independently verifiable evidence.
     * Do not force a weak or synthetic candidate from the first selected domain.
     * The validation fallback preserves the complete selected-domain scope and,
     * when a request description exists, preserves that exact requester intent.
     */
    return this.buildPrimaryDomainHypothesisRanking(context);
  }

  private readCandidateDomainName(value: Prisma.JsonValue): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }

    const domainName = (value as Prisma.JsonObject).domainName;
    return typeof domainName === 'string' ? domainName.trim() : '';
  }

  private isMissingEvidencePlaceholder(value: string): boolean {
    return /(?:problem .* not captured|no direct community evidence|highest-value .* problem before full implementation|validation-first workflow opportunity)/iu.test(
      value,
    );
  }

  /**
   * Creates a primary-domain validation hypothesis without pretending that an
   * absent community problem is itself evidence.
   */
  private buildPrimaryDomainHypothesisRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const selectedDomainNames = [
      ...new Set(
        context.selectedDomains
          .map((domain) => domain.name?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    if (selectedDomainNames.length === 0) {
      const fallbackDomainName = context.domainName?.trim();
      if (fallbackDomainName) {
        selectedDomainNames.push(fallbackDomainName);
      }
    }
    if (selectedDomainNames.length === 0) {
      selectedDomainNames.push('Selected domain');
    }

    const domainLabel = selectedDomainNames.join(' + ');
    const requestDescription = context.requestDescription?.trim() ?? '';
    const requesterBlueprint = requestDescription
      ? CanonicalRequestProductBlueprintUtil.build({
          profile: context.collectionPlan?.problemProfile,
          requestDescription,
          domainName: context.domainName,
          opportunityTitle: context.opportunityRanking?.selected?.title,
        })
      : null;
    const isCrossDomain = selectedDomainNames.length > 1;
    const title = requestDescription
      ? 'Requester-Defined Workflow Opportunity'
      : isCrossDomain
        ? 'Selected-Domain Evidence Discovery'
        : `${domainLabel} Opportunity Discovery`;
    const problem = requestDescription
      ? `The requester wants to address this specific problem across the resolved generation scope (${domainLabel}): "${requestDescription}". Direct community evidence was not sufficiently aligned inside the bounded fast-search budget, so the generated direction must validate this exact requester workflow instead of substituting a different well-evidenced problem.`
      : isCrossDomain
        ? `No direct community problem has yet been validated across ${domainLabel}. The selected domains are independent discovery lanes: the pilot must compare real evidence per domain, prefer the strongest single-domain problem when one emerges, and combine domains only when retained evidence explicitly demonstrates a connected workflow.`
        : `The pilot will test whether teams working in ${domainLabel} need a structured, low-cost workflow for collecting, classifying, and validating operational-friction reports before committing to a full software implementation.`;
    const need = requestDescription
      ? requesterBlueprint
        ? `A focused ${requesterBlueprint.title} workflow centered on ${requesterBlueprint.workflowFocus}. External demand and prevalence remain unvalidated, but the requester-described operational workflow can still be implemented and tested directly without being replaced by a generic problem-discovery product.`
        : `A focused software workflow that directly addresses the requester-described actors, records, pains, and outcomes while keeping external demand and prevalence explicitly unvalidated.`
      : isCrossDomain
        ? `A bounded evidence-discovery pilot that searches each selected domain independently, identifies the strongest evidence-backed problem family, and avoids inventing cross-domain integration when no evidence connects the domains.`
        : `A bounded pilot that captures real user reports, groups recurring workflow problems, and measures which problem family is strong enough to justify implementation.`;
    const solutionArea = requestDescription
      ? requesterBlueprint?.workflowFocus ??
        'Requester-described operational workflow implementation with traceable records, human-reviewed decisions, and bounded pilot validation'
      : isCrossDomain
        ? 'Domain-balanced evidence intake, independent problem-family comparison, and single-domain-first pilot validation'
        : 'User-feedback intake, evidence classification, and pilot validation workflow';
    const domainRelevanceScores = Object.fromEntries(
      selectedDomainNames.map((name) => [name, 1]),
    );

    const requesterValidationScore = requestDescription
      ? Math.max(0, Math.min(1, 0.18 * 0.72 + 1 * 0.28))
      : 0.08;

    const supportingEvidence = requestDescription
      ? [
          {
            sourceType: 'REQUESTER_STATEMENT' as const,
            text: requestDescription,
            qualifiesAsCommunityEvidence: false,
          },
        ]
      : [
          {
            sourceType:
              context.domainResolution?.source === 'USER_SELECTED'
                ? ('REQUESTER_DOMAIN_SELECTION' as const)
                : ('PERSONALIZATION_SIGNAL' as const),
            text: `Validation scope: ${selectedDomainNames.join(' + ')}`,
            qualifiesAsCommunityEvidence: false,
          },
        ];

    const selected: IdeaOpportunityRanking['selected'] = {
      rank: 1,
      title,
      problem,
      need,
      solutionArea,
      evidenceType: 'OPPORTUNITY',
      sourceIndex: 0,
      frequency: 0,
      severity: 'MEDIUM',
      evidenceSamples: [],
      frequencyScore: 0,
      severityScore: 0.6,
      evidenceScore: 0,
      evidenceReliabilityScore: 0.1,
      weakEvidencePenalty: 0.26,
      specificityScore: requestDescription ? 0.9 : 0.72,
      feasibilityScore: 0.88,
      localRelevanceScore: 0.25,
      noveltyScore: 0.62,
      businessValueScore: 0.5,
      marketGapScore: 0.5,
      competitionScore: 0.5,
      technicalRiskScore: 0.32,
      supportScore: 0.08,
      nlpConfidenceScore: context.nlp?.confidence ?? 0.2,
      baseScore: 0.24,
      confidencePenalty: 0.16,
      finalScore: requesterValidationScore,
      matchedDomainNames: selectedDomainNames,
      domainRelevanceScores,
      selectionEligible: false,
      disqualificationReasons: [
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        'NO_DIRECT_EVIDENCE',
        'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      ],
      verifiedIndependentEvidenceCount: 0,
      verifiedIndependentSourceCount: 0,
      independentEvidence: [],
      requestIntentAlignmentScore: requestDescription ? 1 : undefined,
      requestIntentAdjustedScore: requestDescription
        ? requesterValidationScore
        : undefined,
      supportingEvidence,
      raw: {
        source: 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        domainName: selectedDomainNames[0],
        domainNames: selectedDomainNames,
        title,
        problem,
        unmetNeed: need,
        solutionArea,
        requestDescription: requestDescription || null,
        requestIntentAlignmentScore: requestDescription ? 1 : null,
        requestIntentAdjustedScore: requestDescription
          ? requesterValidationScore
          : null,
        requestIntentAlignmentApplied: requestDescription ? true : null,
        evidenceSamples: [],
        supportingEvidence,
      },
    };

    return {
      selected,
      alternatives: [],
      evaluatedCount: 1,
      evidenceCoverage: 0,
      selectionReason: requestDescription
        ? `No sufficiently request-aligned direct community problem was retained within the fast collection budget. The run stays anchored to the explicit requester problem across ${domainLabel} and uses a validation pilot rather than switching to an unrelated high-evidence problem.`
        : isCrossDomain
          ? `No direct community problem was retained within the fast collection budget. The run keeps all explicitly selected domains (${domainLabel}) in the validation search space instead of forcing the first domain to win by position.`
          : `No direct community problem was retained within the fast collection budget. The run remains anchored to "${domainLabel}" and generates a clearly labeled validation hypothesis.`,
      qualityWarnings: [
        requestDescription
          ? 'No sufficiently request-aligned direct community problem was established. The requester statement is preserved as traceable scope evidence but does not count as community demand evidence.'
          : 'No direct community problem was established. The selected-domain or personalization signal is preserved only as traceable validation-scope support and does not count as market-demand evidence.',
        'The selected location is a pilot deployment target and is not claimed as evidence origin.',
      ],
    };
  }

  private buildSingleDomainValidationFallback(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const rankedDomains = context.selectedDomains
      .map((domain, index) => {
        const evidence = context.domainEvidence.find(
          (entry) => entry.domainId === domain.id,
        );
        const retainedCount = Math.max(
          evidence?.totalTextsAnalyzed ?? 0,
          (evidence?.totalPostsAnalyzed ?? 0) +
            (evidence?.totalCommentsAnalyzed ?? 0),
        );
        const keywordSpecificity = new Set([
          ...(domain.effectiveSearchKeywords ?? []),
          ...domain.keywords,
        ].map((value) => value.trim().toLocaleLowerCase()).filter(Boolean)).size;
        return { domain, index, retainedCount, keywordSpecificity };
      })
      .sort(
        (left, right) =>
          right.retainedCount - left.retainedCount ||
          right.keywordSpecificity - left.keywordSpecificity ||
          left.index - right.index,
      );

    const chosen = rankedDomains[0]?.domain ?? context.selectedDomains[0];
    const domainName = chosen?.name?.trim() || context.domainName?.trim() || 'Selected domain';
    const problem = `No external problem evidence survived the bounded collection and recovery window strongly enough to rank across the selected domains. To avoid inventing a cross-domain bridge, the final fallback narrows the product to one validation lane: ${domainName}. The pilot must collect direct evidence for one concrete ${domainName} problem before making prevalence, demand, or cross-domain claims.`;
    const need = `A single-domain validation-first workflow for ${domainName} that captures real user or operator problems, preserves source provenance, and measures which concrete problem is strong enough to justify implementation.`;
    const supportingEvidence = [
      {
        sourceType: 'REQUESTER_DOMAIN_SELECTION' as const,
        text: `Validation lane: ${domainName}`,
        qualifiesAsCommunityEvidence: false,
      },
    ];

    const selected: IdeaOpportunityRanking['selected'] = {
      rank: 1,
      title: `${domainName} Validation-First Opportunity`,
      problem,
      need,
      solutionArea: 'Single-domain evidence capture and bounded pilot validation',
      evidenceType: 'OPPORTUNITY',
      sourceIndex: 0,
      frequency: 0,
      severity: 'MEDIUM',
      evidenceSamples: [],
      frequencyScore: 0,
      severityScore: 0.6,
      evidenceScore: 0,
      evidenceReliabilityScore: 0.1,
      weakEvidencePenalty: 0.26,
      specificityScore: 0.8,
      feasibilityScore: 0.88,
      localRelevanceScore: 0.25,
      noveltyScore: 0.6,
      businessValueScore: 0.5,
      marketGapScore: 0.5,
      competitionScore: 0.5,
      technicalRiskScore: 0.3,
      supportScore: 0.08,
      nlpConfidenceScore: context.nlp?.confidence ?? 0.2,
      baseScore: 0.24,
      confidencePenalty: 0.16,
      finalScore: 0.1,
      matchedDomainNames: [domainName],
      problemDomainNames: [domainName],
      primaryMatchedDomainName: domainName,
      domainRelevanceScores: Object.fromEntries(
        context.selectedDomains.map((domain) => [
          domain.name,
          domain.name.trim().toLocaleLowerCase() === domainName.toLocaleLowerCase()
            ? 1
            : 0,
        ]),
      ),
      selectionEligible: false,
      disqualificationReasons: [
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        'NO_DIRECT_EVIDENCE',
        'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      ],
      verifiedIndependentEvidenceCount: 0,
      verifiedIndependentSourceCount: 0,
      independentEvidence: [],
      supportingEvidence,
      raw: {
        source: 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        domainName,
        domainNames: [domainName],
        title: `${domainName} Validation-First Opportunity`,
        problem,
        unmetNeed: need,
        solutionArea: 'Single-domain evidence capture and bounded pilot validation',
        requestDescription: null,
        evidenceSamples: [],
        supportingEvidence,
      } as unknown as Prisma.JsonValue,
    };

    return {
      selected,
      alternatives: [],
      evaluatedCount: Math.max(1, context.selectedDomains.length),
      evidenceCoverage: 0,
      selectionReason: `No selected domain retained usable external evidence, so the fallback narrowed generation to ${domainName} instead of inventing a product that combines unrelated selected domains.`,
      qualityWarnings: [
        `The ${domainName} direction is an unvalidated single-domain pilot. It is not evidence of demand.`,
        'The other selected domains remain discovery lanes only and must not be merged into the product unless future retained evidence connects them.',
      ],
    };
  }

  /**
   * Chooses a different evidence direction on every bounded recovery attempt.
   * Attempts 1-3 target the three strongest ranked opportunities. The final
   * attempt is broad and lets the recovery service derive domain-level
   * complaint queries instead of repeatedly chasing the same weak signal.
   */
  private resolveRecoveryTarget(
    ranking: IdeaOpportunityRanking | null,
    completedAttempts: number,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking['selected'] | null {
    if (!ranking) {
      return null;
    }

    /*
     * Description-bearing paths are problem-first. Recovery may rotate query
     * wording and source families, but it must never rotate to an unrelated
     * ranked alternative merely because that alternative has stronger generic
     * domain evidence. This keeps both Text Only and Text + Domains anchored to
     * the immutable requester workflow. Domains-only/no-input discovery keeps
     * the existing multi-candidate recovery behavior unchanged.
     */
    if (context.requestDescription?.trim()) {
      return ranking.selected;
    }

    const rankedCandidates = [ranking.selected, ...ranking.alternatives]
      .filter(
        (candidate, index, candidates) =>
          candidates.findIndex((item) => item.title === candidate.title) ===
          index,
      )
      .slice(0, 3);

    return rankedCandidates[completedAttempts] ?? null;
  }

  private countVerifiedRecoveredEvidence(
    candidate: IdeaOpportunityRanking['selected'],
    recoveredEvidence: readonly RecoveredExternalEvidence[],
  ): number {
    const verified = candidate.independentEvidence ?? [];
    return recoveredEvidence.filter((recovered) =>
      verified.some((item) =>
        this.areEquivalentEvidenceSamples(recovered.text, item.text),
      ),
    ).length;
  }

  private mergeRecoveredEvidenceIntoDomainEvidence(
    context: IdeaGenerationContext,
    recoveredEvidence: readonly RecoveredExternalEvidence[],
    collectionJobId: string,
  ): IdeaGenerationContext['domainEvidence'] {
    if (recoveredEvidence.length === 0) {
      return context.domainEvidence;
    }

    const domainDescriptors = context.selectedDomains.map((domain) => ({
      name: domain.name,
      keywords: domain.keywords,
      effectiveSearchKeywords: domain.effectiveSearchKeywords,
    }));
    const profiles = context.domainEvidence.map((profile) => ({ ...profile }));

    for (const evidence of recoveredEvidence) {
      const text = evidence.text.replace(/\s+/gu, ' ').trim();
      if (!text) continue;

      const matchedDomainNames =
        SelectedDomainEvidenceAlignmentUtil.matchStrictDomainNames(
          text,
          domainDescriptors,
        );
      if (matchedDomainNames.length === 0) continue;

      for (const domainName of matchedDomainNames) {
        const selectedDomain = context.selectedDomains.find(
          (domain) =>
            domain.name.trim().toLocaleLowerCase() ===
            domainName.trim().toLocaleLowerCase(),
        );
        if (!selectedDomain) continue;

        const profileIndex = profiles.findIndex(
          (profile) => profile.domainId === selectedDomain.id,
        );
        const existing =
          profileIndex >= 0
            ? profiles[profileIndex]
            : {
                domainId: selectedDomain.id,
                domainName: selectedDomain.name,
                collectionJobId,
                reused: false,
                totalTextsAnalyzed: 0,
                totalPostsAnalyzed: 0,
                totalCommentsAnalyzed: 0,
                evidenceAvailable: false,
                samplePosts: [] as Prisma.JsonArray,
                sampleComments: [] as Prisma.JsonArray,
              };
        const posts = Array.isArray(existing.samplePosts)
          ? [...existing.samplePosts]
          : [];
        const comments = Array.isArray(existing.sampleComments)
          ? [...existing.sampleComments]
          : [];
        const target = evidence.sourceType === 'COMMENT' ? comments : posts;
        const alreadyPresent = target.some((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return false;
          }
          const raw = (entry as Prisma.JsonObject).text;
          return (
            typeof raw === 'string' &&
            this.areEquivalentEvidenceSamples(raw, text)
          );
        });
        if (alreadyPresent) continue;

        const id = evidence.commentExternalId
          ? `${evidence.sourceKey}:comment:${evidence.commentExternalId}`
          : `${evidence.sourceKey}:post:${evidence.postExternalId}`;
        target.push({
          id,
          text,
          ...(evidence.commentExternalId
            ? { postId: `${evidence.sourceKey}:post:${evidence.postExternalId}` }
            : {}),
        } as Prisma.JsonObject);

        const updated = {
          ...existing,
          evidenceAvailable: true,
          totalTextsAnalyzed: existing.totalTextsAnalyzed + 1,
          totalPostsAnalyzed:
            existing.totalPostsAnalyzed +
            (evidence.sourceType === 'POST' ? 1 : 0),
          totalCommentsAnalyzed:
            existing.totalCommentsAnalyzed +
            (evidence.sourceType === 'COMMENT' ? 1 : 0),
          samplePosts: posts as Prisma.JsonArray,
          sampleComments: comments as Prisma.JsonArray,
        };

        if (profileIndex >= 0) {
          profiles[profileIndex] = updated;
        } else {
          profiles.push(updated);
        }
      }
    }

    return profiles;
  }

  private aggregateRecoveryMetadata(
    attempts: readonly {
      readonly collectionJobId: string;
      readonly selectedDataSourceKeys: readonly string[];
      readonly recoveryKeywords: readonly string[];
      readonly totalPosts: number;
      readonly totalComments: number;
      readonly usefulCleanTextCount: number;
      readonly complaintEvidenceCount: number;
      readonly evidenceFamilies: readonly string[];
      readonly communityAiRecoveryApplied: boolean;
      readonly communityAiRecoveryExecuted: boolean;
      readonly newCorpusEvidenceSampleCount: number;
      readonly selectedOpportunityNewEvidenceCount: number;
      readonly newEvidenceSampleCount: number;
      readonly recoveryOutcome: EvidenceRecoveryOutcome;
    }[],
  ) {
    const latest = attempts[attempts.length - 1];

    return {
      collectionJobId: latest.collectionJobId,
      selectedDataSourceKeys: Array.from(
        new Set(attempts.flatMap((item) => item.selectedDataSourceKeys)),
      ),
      recoveryKeywords: Array.from(
        new Set(attempts.flatMap((item) => item.recoveryKeywords)),
      ),
      totalPosts: attempts.reduce((sum, item) => sum + item.totalPosts, 0),
      totalComments: attempts.reduce(
        (sum, item) => sum + item.totalComments,
        0,
      ),
      usefulCleanTextCount: attempts.reduce(
        (sum, item) => sum + item.usefulCleanTextCount,
        0,
      ),
      complaintEvidenceCount: attempts.reduce(
        (sum, item) => sum + item.complaintEvidenceCount,
        0,
      ),
      evidenceFamilies: Array.from(
        new Set(attempts.flatMap((item) => item.evidenceFamilies)),
      ),
      communityAiRecoveryApplied: attempts.some(
        (item) => item.communityAiRecoveryApplied,
      ),
      communityAiRecoveryExecuted: attempts.some(
        (item) => item.communityAiRecoveryExecuted,
      ),
      newCorpusEvidenceSampleCount: attempts.reduce(
        (sum, item) => sum + item.newCorpusEvidenceSampleCount,
        0,
      ),
      selectedOpportunityNewEvidenceCount: attempts.reduce(
        (sum, item) => sum + item.selectedOpportunityNewEvidenceCount,
        0,
      ),
      newEvidenceSampleCount: attempts.reduce(
        (sum, item) => sum + item.newEvidenceSampleCount,
        0,
      ),
      recoveryOutcome: latest.recoveryOutcome,
    } as const;
  }

  /**
   * Merges supplemental recovery evidence with the original NLP context.
   *
   * Evidence recovery must add information rather than discard the primary
   * evidence. The primary analysis remains canonical for its identifier,
   * verified headline counts, statistics, and quality metrics. Recovery output
   * only supplements ranking-related evidence arrays with deduplicated entries.
   * Every merged sample is revalidated by IdeaOpportunityRankingService before
   * it affects scoring.
   */
  /**
   * Combines primary and recovery Community AI analyses while preserving
   * independent evidence samples. Ranking performs the final semantic merge,
   * evidence validation, and duplicate control.
   */
  private mergeCanonicalEvidenceLedger(
    context: IdeaGenerationContext,
    primary: IdeaGenerationContext['canonicalEvidenceLedger'],
    recoveredRaw: readonly IdeaGenerationContext['rawEvidenceCorpus'][number][],
    recoveredAnalysis: CommunityAiAnalysis | null,
  ): IdeaGenerationContext['canonicalEvidenceLedger'] {
    const byId = new Map(primary.map((item) => [item.id, item] as const));
    const rawById = new Map(recoveredRaw.map((item) => [item.id, item] as const));

    for (const classification of recoveredAnalysis?.evidenceClassifications ?? []) {
      const raw = rawById.get(classification.evidenceId);
      if (!raw) continue;
      byId.set(
        raw.id,
        CanonicalEvidenceVerificationUtil.verify({
          raw,
          proposal: {
            classification: classification.classification,
            confidence: classification.confidence,
            problemFamily: classification.problemFamily,
            verifiedByDeterministicGuard: classification.verifiedByDeterministicGuard,
            origin: 'RECOVERY',
          },
          requestMode: context.requestMode,
          problemSpec: context.canonicalProblemSpec,
          selectedDomains: context.selectedDomains,
        }),
      );
    }

    return [...byId.values()];
  }

  private mergeRawEvidenceCorpus(
    primary: IdeaGenerationContext['rawEvidenceCorpus'],
    recovered: readonly IdeaGenerationContext['rawEvidenceCorpus'][number][],
  ): IdeaGenerationContext['rawEvidenceCorpus'] {
    const byId = new Map(primary.map((item) => [item.id, item] as const));
    for (const item of recovered) {
      byId.set(item.id, item);
    }
    return [...byId.values()];
  }

  private mergeCommunityAiAnalyses(
    primary: CommunityAiAnalysis | null,
    recovered: CommunityAiAnalysis | null,
  ): CommunityAiAnalysis | null {
    if (!primary) {
      return recovered;
    }

    if (!recovered) {
      return primary;
    }

    const recoveredAttemptOffset = primary.onlineAttemptCount;
    const attemptDiagnostics = [
      ...primary.attemptDiagnostics,
      ...recovered.attemptDiagnostics.map((item) => ({
        ...item,
        attempt: recoveredAttemptOffset + item.attempt,
      })),
    ];
    const hypothesisByKey = new Map(
      [...primary.unvalidatedDomainHypotheses, ...recovered.unvalidatedDomainHypotheses].map(
        (item) => [
          `${item.domainName.trim().toLocaleLowerCase()}::${item.title.trim().toLocaleLowerCase()}`,
          item,
        ],
      ),
    );

    return {
      summary:
        `${primary.summary} Supplemental targeted recovery: ${recovered.summary}`.trim(),
      dominantProblems: this.mergeStrings(
        primary.dominantProblems,
        recovered.dominantProblems,
      ),
      unmetNeeds: this.mergeStrings(primary.unmetNeeds, recovered.unmetNeeds),
      opportunities: this.mergeCommunityOpportunities(
        primary.opportunities,
        recovered.opportunities,
      ),
      overallConfidence:
        Math.round(
          Math.max(primary.overallConfidence, recovered.overallConfidence) *
            100,
        ) / 100,
      qualityWarnings: this.mergeStrings(
        primary.qualityWarnings,
        recovered.qualityWarnings,
      ),
      modelId: recovered.modelId ?? primary.modelId,
      apiModelId: recovered.apiModelId ?? primary.apiModelId,
      attemptCount: primary.attemptCount + recovered.attemptCount,
      aiAttempted: primary.aiAttempted || recovered.aiAttempted,
      aiSucceeded: primary.aiSucceeded || recovered.aiSucceeded,
      fallbackUsed: primary.fallbackUsed || recovered.fallbackUsed,
      onlineAttemptCount:
        primary.onlineAttemptCount + recovered.onlineAttemptCount,
      executionFailureCount:
        primary.executionFailureCount + recovered.executionFailureCount,
      validationRejectedCount:
        primary.validationRejectedCount + recovered.validationRejectedCount,
      fallbackReason:
        recovered.fallbackReason ?? primary.fallbackReason ?? null,
      attemptDiagnostics,
      unvalidatedDomainHypotheses: [...hypothesisByKey.values()],
      evidenceClassifications: this.mergeCommunityEvidenceClassifications(
        primary.evidenceClassifications ?? [],
        recovered.evidenceClassifications ?? [],
      ),
    };
  }

  /**
   * Keeps each recovered opportunity intact. The ranking service owns semantic
   * family matching and only merges candidates after revalidating their direct
   * evidence samples.
   */
  private mergeCommunityEvidenceClassifications(
    primary: NonNullable<CommunityAiAnalysis['evidenceClassifications']>,
    recovered: NonNullable<CommunityAiAnalysis['evidenceClassifications']>,
  ): NonNullable<CommunityAiAnalysis['evidenceClassifications']> {
    const byId = new Map<string, NonNullable<CommunityAiAnalysis['evidenceClassifications']>[number]>();
    for (const item of [...primary, ...recovered]) {
      const existing = byId.get(item.evidenceId);
      if (!existing || item.confidence >= existing.confidence) {
        byId.set(item.evidenceId, item);
      }
    }
    return [...byId.values()];
  }

  private mergeCommunityOpportunities(
    primary: readonly CommunityAiOpportunity[],
    recovered: readonly CommunityAiOpportunity[],
  ): CommunityAiOpportunity[] {
    const values = [...primary, ...recovered];
    const seen = new Set<string>();

    return values.filter((opportunity) => {
      const evidenceKey = opportunity.evidenceSamples
        .map((sample) => this.normalizeEvidenceKey(sample))
        .sort()
        .join('|');
      const key = `${this.normalizeEvidenceKey(opportunity.title)}::${evidenceKey}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private mergeStrings(
    primary: readonly string[],
    recovered: readonly string[],
  ): string[] {
    const seen = new Set<string>();
    const output: string[] = [];

    for (const value of [...primary, ...recovered]) {
      const normalized = this.normalizeEvidenceKey(value);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      output.push(value);
    }

    return output;
  }

  private normalizeEvidenceKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private areEquivalentEvidenceSamples(left: string, right: string): boolean {
    const normalizedLeft = this.normalizeEvidenceKey(left);
    const normalizedRight = this.normalizeEvidenceKey(right);
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;

    const shorter =
      normalizedLeft.length <= normalizedRight.length
        ? normalizedLeft
        : normalizedRight;
    const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
    return shorter.length >= 80 && longer.includes(shorter);
  }

  private mergeNlpContexts(
    primary: NonNullable<IdeaGenerationContext['nlp']>,
    recovered: NonNullable<IdeaGenerationContext['nlp']>,
  ): NonNullable<IdeaGenerationContext['nlp']> {
    return {
      ...primary,
      recurringProblems: this.mergeJsonEvidence(
        primary.recurringProblems,
        recovered.recurringProblems,
      ),
      extractedNeeds: this.mergeJsonEvidence(
        primary.extractedNeeds,
        recovered.extractedNeeds,
      ),
      featureRequests: this.mergeJsonEvidence(
        primary.featureRequests,
        recovered.featureRequests,
      ),
      opportunities: this.mergeJsonEvidence(
        primary.opportunities,
        recovered.opportunities,
      ),
      samplePosts: this.mergeJsonEvidence(
        primary.samplePosts,
        recovered.samplePosts,
      ),
      sampleComments: this.mergeJsonEvidence(
        primary.sampleComments,
        recovered.sampleComments,
      ),
      aiUsed: primary.aiUsed || recovered.aiUsed,
      confidence: this.mergeConfidence(
        primary.confidence,
        recovered.confidence,
      ),
      totalPostsAnalyzed:
        (primary.totalPostsAnalyzed ?? 0) +
        (recovered.totalPostsAnalyzed ?? 0),
      totalCommentsAnalyzed:
        (primary.totalCommentsAnalyzed ?? 0) +
        (recovered.totalCommentsAnalyzed ?? 0),
      totalTextsAnalyzed:
        (primary.totalTextsAnalyzed ?? 0) +
        (recovered.totalTextsAnalyzed ?? 0),
      dataQuality: this.mergeDataQuality(
        primary.dataQuality,
        recovered.dataQuality,
      ),
    };
  }

  /** Deduplicates top-level JSON evidence without changing nested contracts. */
  private mergeJsonEvidence(
    primary: Prisma.JsonValue | null,
    recovered: Prisma.JsonValue | null,
  ): Prisma.JsonValue | null {
    if (!Array.isArray(primary) && !Array.isArray(recovered)) {
      return primary ?? recovered;
    }

    const values = [
      ...(Array.isArray(primary) ? primary : []),
      ...(Array.isArray(recovered) ? recovered : []),
    ];
    const seen = new Set<string>();

    return values.filter((value) => {
      const key = JSON.stringify(value);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  /** Merges persisted NLP quality counters stored as generic Prisma JSON. */
  private mergeDataQuality(
    primary: Prisma.JsonValue | null,
    recovered: Prisma.JsonValue | null,
  ): Prisma.JsonValue {
    const readMetric = (value: Prisma.JsonValue | null, key: string): number => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return 0;
      }

      const metric = (value as Prisma.JsonObject)[key];
      return typeof metric === 'number' && Number.isFinite(metric) ? metric : 0;
    };

    return {
      spamTextsRemoved:
        readMetric(primary, 'spamTextsRemoved') +
        readMetric(recovered, 'spamTextsRemoved'),
      duplicateTextsRemoved:
        readMetric(primary, 'duplicateTextsRemoved') +
        readMetric(recovered, 'duplicateTextsRemoved'),
      irrelevantTextsRemoved:
        readMetric(primary, 'irrelevantTextsRemoved') +
        readMetric(recovered, 'irrelevantTextsRemoved'),
    };
  }

  private mergeConfidence(
    primary: number | null,
    recovered: number | null,
  ): number | null {
    if (primary === null) {
      return recovered;
    }

    if (recovered === null) {
      return primary;
    }

    return Math.round((primary * 0.7 + recovered * 0.3) * 1_000) / 1_000;
  }

  private async loadPreviousIdeaTexts(domainId: string): Promise<string[]> {
    const cached = this.previousIdeaTextCache.get(domainId);
    if (cached && cached.expiresAt > Date.now()) {
      return [...cached.texts];
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const previousIdeas = await Promise.race([
        this.prisma.idea.findMany({
          where: {
            domainId,
            deletedAt: null,
          },
          select: {
            title: true,
            problemStatement: true,
            partialAbstract: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('Previous idea ranking context exceeded 900ms.')),
            900,
          );
        }),
      ]);

      const texts = previousIdeas
        .map((idea) =>
          [idea.title, idea.problemStatement, idea.partialAbstract ?? ''].join(' '),
        )
        .map((text) => text.replace(/\s+/gu, ' ').trim())
        .filter(Boolean);

      this.previousIdeaTextCache.set(domainId, {
        expiresAt: Date.now() + 90_000,
        texts,
      });
      if (this.previousIdeaTextCache.size > 40) {
        const oldestKey = this.previousIdeaTextCache.keys().next().value as
          | string
          | undefined;
        if (oldestKey) this.previousIdeaTextCache.delete(oldestKey);
      }

      return texts;
    } catch {
      return [];
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }


  /**
   * Makes representative domainEvidence a first-class ranking input. The NLP
   * pipeline is intentionally bounded for speed, so direct collector evidence
   * must not disappear merely because it fell outside that top slice.
   */
  private hydrateNlpWithDomainEvidence(
    context: IdeaGenerationContext,
  ): NonNullable<IdeaGenerationContext['nlp']> {
    const nlp = context.nlp!;
    const trusted = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const posts = trusted
      .filter((item) => item.sourceType === 'POST')
      .map((item) => ({ id: item.id, text: item.text } as Prisma.JsonObject));
    const comments = trusted
      .filter((item) => item.sourceType === 'COMMENT')
      .map((item) => ({ id: item.id, text: item.text } as Prisma.JsonObject));

    return {
      ...nlp,
      samplePosts: this.mergeDomainEvidenceJson(nlp.samplePosts, posts),
      sampleComments: this.mergeDomainEvidenceJson(nlp.sampleComments, comments),
    };
  }

  private readDomainEvidenceObjects(
    value: Prisma.JsonValue | null,
  ): Prisma.JsonValue[] {
    return Array.isArray(value) ? [...value] : [];
  }

  private mergeDomainEvidenceJson(
    existing: Prisma.JsonValue | null,
    additions: readonly Prisma.JsonValue[],
  ): Prisma.JsonArray {
    const values: Prisma.JsonValue[] = [
      ...(Array.isArray(existing) ? existing : []),
      ...additions,
    ];
    const output: Prisma.JsonValue[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const text =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Prisma.JsonObject).text
          : null;
      const key =
        typeof text === 'string'
          ? text.replace(/\s+/gu, ' ').trim().toLowerCase().slice(0, 500)
          : JSON.stringify(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
      if (output.length >= 24) break;
    }

    return output as Prisma.JsonArray;
  }

  private buildEvidenceProvenanceHints(
    context: IdeaGenerationContext,
  ): EvidenceProvenanceHint[] {
    const hints: EvidenceProvenanceHint[] = [];
    const seen = new Set<string>();

    const parseId = (
      value: string,
      expectedKind: 'post' | 'comment',
    ): { sourceKey: string; externalId: string } | null => {
      if (!value || value.startsWith('nlp:')) return null;
      const marker = `:${expectedKind}:`;
      const markerIndex = value.indexOf(marker);
      if (markerIndex <= 0) return null;
      const sourceKey = value.slice(0, markerIndex).trim();
      const externalId = value.slice(markerIndex + marker.length).trim();
      return sourceKey && externalId ? { sourceKey, externalId } : null;
    };

    for (const domain of context.domainEvidence) {
      if (Array.isArray(domain.samplePosts)) {
        for (const raw of domain.samplePosts) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
          const item = raw as Prisma.JsonObject;
          const id = typeof item.id === 'string' ? item.id : '';
          const text = typeof item.text === 'string' ? item.text.trim() : '';
          if (!text) continue;

          const post = parseId(id, 'post');
          if (!post) continue;

          const key = `${post.sourceKey}|${post.externalId}|`;
          if (seen.has(key)) continue;
          seen.add(key);
          hints.push({
            text,
            sourceKey: post.sourceKey,
            postExternalId: post.externalId,
            commentExternalId: null,
          });
        }
      }

      if (!Array.isArray(domain.sampleComments)) continue;

      for (const raw of domain.sampleComments) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const item = raw as Prisma.JsonObject;
        const id = typeof item.id === 'string' ? item.id : '';
        const postId = typeof item.postId === 'string' ? item.postId : '';
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) continue;

        const comment = parseId(id, 'comment');
        const post = parseId(postId, 'post');
        if (!comment || !post || comment.sourceKey !== post.sourceKey) continue;

        const key = `${comment.sourceKey}|${post.externalId}|${comment.externalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push({
          text,
          sourceKey: comment.sourceKey,
          postExternalId: post.externalId,
          commentExternalId: comment.externalId,
        });
      }
    }

    return hints;
  }

  /**
   * Verifies direct retained evidence across every explicitly selected domain
   * before a validation-only fallback is allowed to consume recovery time.
   *
   * This path is intentionally strict: only verified complaint, feature-request,
   * observed-unmet-need, or other direct-user evidence can short-circuit the
   * generic ranking path. Secondary articles and technical posts still flow
   * through the normal ranking tournament so quality is not reduced.
   */
  private async verifyExplicitDomainsOnlyDirectCompetition(
    context: IdeaGenerationContext,
  ): Promise<IdeaOpportunityRanking | null> {
    const directCompetition =
      this.buildDirectDomainEvidenceFallbackRanking(context);
    if (!directCompetition) return null;

    const verified = this.enforceEvidenceNarrativeConsistency(
      this.opportunityRankingService.reconcileVerifiedDomainAttribution(
        await this.independentEvidenceVerificationService.verifyRanking(
          directCompetition,
          this.resolveEvidenceCollectionJobIds(context),
          this.buildEvidenceProvenanceHints(context),
        ),
        context.selectedDomains.map((domain) => ({
          name: domain.name,
          keywords: domain.effectiveSearchKeywords ?? domain.keywords,
        })),
      ),
    );

    const directCandidates = [verified.selected, ...verified.alternatives]
      .filter(
        (candidate) =>
          !candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') &&
          !candidate.disqualificationReasons.includes(
            'EVIDENCE_SEMANTIC_MISMATCH',
          ) &&
          this.countVerifiedDirectSignals(candidate) > 0,
      )
      .sort((first, second) => {
        const qualityDifference =
          this.candidateVerifiedEvidenceTournamentScore(second) -
          this.candidateVerifiedEvidenceTournamentScore(first);
        if (Math.abs(qualityDifference) > 0.0001) return qualityDifference;

        const classDifference =
          this.verifiedDirectEvidencePriority(second) -
          this.verifiedDirectEvidencePriority(first);
        if (classDifference !== 0) return classDifference;

        return second.finalScore - first.finalScore;
      });

    const selected = directCandidates[0];
    if (!selected) return null;

    const remaining = [verified.selected, ...verified.alternatives].filter(
      (candidate) => candidate !== selected,
    );

    return {
      ...verified,
      selected: { ...selected, rank: 1 },
      alternatives: remaining.map((candidate, index) => ({
        ...candidate,
        rank: index + 2,
      })),
      selectionReason:
        `Selected the strongest independently verified direct evidence across all explicitly selected domains before recovery. Winner: ${selected.title} (${selected.primaryMatchedDomainName ?? selected.matchedDomainNames?.[0] ?? 'selected domain'}).`,
      qualityWarnings: [
        ...verified.qualityWarnings,
        'A verified direct signal from any explicitly selected domain outranks a no-evidence primary-domain validation hypothesis; domain order is not treated as evidence strength.',
      ],
    };
  }

  private countVerifiedDirectSignals(
    candidate: IdeaOpportunityRanking['selected'],
  ): number {
    return Math.max(
      candidate.verifiedProblemMatchedDirectUserEvidenceCount ?? 0,
      candidate.verifiedDirectUserEvidenceCount ?? 0,
      (candidate.verifiedComplaintEvidenceCount ?? 0) +
        (candidate.verifiedFeatureRequestEvidenceCount ?? 0) +
        (candidate.verifiedObservationEvidenceCount ?? 0),
    );
  }

  private verifiedDirectEvidencePriority(
    candidate: IdeaOpportunityRanking['selected'],
  ): number {
    if ((candidate.verifiedComplaintEvidenceCount ?? 0) > 0) return 4;
    if ((candidate.verifiedFeatureRequestEvidenceCount ?? 0) > 0) return 3;
    if ((candidate.verifiedObservationEvidenceCount ?? 0) > 0) return 2;
    if ((candidate.verifiedDirectUserEvidenceCount ?? 0) > 0) return 1;
    return 0;
  }

  private preferVerifiedEvidenceQualityWinner(
    ranking: IdeaOpportunityRanking,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    if (context.requestDescription?.trim()) {
      return ranking;
    }

    const candidates = [ranking.selected, ...ranking.alternatives];
    const ordered = [...candidates].sort((first, second) => {
      const qualityDifference =
        this.candidateVerifiedEvidenceTournamentScore(second) -
        this.candidateVerifiedEvidenceTournamentScore(first);
      if (Math.abs(qualityDifference) > 0.0001) {
        return qualityDifference;
      }

      const sourceDifference =
        (second.verifiedProblemMatchedEvidenceSourceCount ??
          second.verifiedEvidenceSourceCount ??
          0) -
        (first.verifiedProblemMatchedEvidenceSourceCount ??
          first.verifiedEvidenceSourceCount ??
          0);
      if (sourceDifference !== 0) return sourceDifference;

      if (first.selectionEligible !== second.selectionEligible) {
        return first.selectionEligible ? -1 : 1;
      }

      return second.finalScore - first.finalScore;
    });

    const selected = ordered[0];
    if (!selected || selected === ranking.selected) {
      return ranking;
    }

    return {
      ...ranking,
      selected: { ...selected, rank: 1 },
      alternatives: ordered.slice(1).map((candidate, index) => ({
        ...candidate,
        rank: index + 2,
      })),
      selectionReason:
        `Selected the strongest verified evidence candidate after jointly scoring semantic selected-domain fit, actionability, evidence class, structured problem detail, and provenance. Winner: ${selected.title}.`,
      qualityWarnings: [
        ...ranking.qualityWarnings,
        'Domains-only/no-description ranking uses semantic domain fit and evidence actionability as primary tournament signals; collector/profile attribution alone cannot promote a candidate, and a rich structured problem may outrank a weaker direct comment when it is materially more specific and domain-grounded.',
      ],
    };
  }

  private candidateVerifiedEvidenceTournamentScore(
    candidate: IdeaOpportunityRanking['selected'],
  ): number {
    if (
      candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') ||
      candidate.disqualificationReasons.includes('EVIDENCE_SEMANTIC_MISMATCH')
    ) {
      return -1_000;
    }

    const domainScores = Object.values(
      candidate.problemDomainRelevanceScores ?? candidate.domainRelevanceScores ?? {},
    ).filter((value): value is number => typeof value === 'number');
    const verifiedDomainFit = domainScores.length > 0
      ? Math.max(...domainScores)
      : 0;
    const raw =
      candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
        ? (candidate.raw as Prisma.JsonObject)
        : null;
    const rawSemanticDomainScore =
      raw && typeof raw.semanticDomainScore === 'number'
        ? Number(raw.semanticDomainScore)
        : 0;
    const semanticDomainFit = Math.max(verifiedDomainFit, rawSemanticDomainScore);
    const actionability = this.candidateEvidenceActionability(candidate);

    let evidenceClassScore = 0;
    if ((candidate.verifiedComplaintEvidenceCount ?? 0) > 0) {
      evidenceClassScore = 0.18;
    } else if ((candidate.verifiedFeatureRequestEvidenceCount ?? 0) > 0) {
      evidenceClassScore = 0.17;
    } else if ((candidate.verifiedObservationEvidenceCount ?? 0) > 0) {
      evidenceClassScore = 0.15;
    } else if ((candidate.verifiedTechnicalEvidenceCount ?? 0) > 0) {
      evidenceClassScore = 0.13;
    } else if ((candidate.verifiedDirectUserEvidenceCount ?? 0) > 0) {
      evidenceClassScore = 0.12;
    } else if ((candidate.verifiedQuestionEvidenceCount ?? 0) > 0) {
      evidenceClassScore = 0.08;
    } else if ((candidate.verifiedSecondaryEvidenceCount ?? 0) > 0) {
      evidenceClassScore = 0.07;
    }

    const structuredProblemBonus =
      raw &&
      typeof raw.structuredProblemCount === 'number' &&
      Number(raw.structuredProblemCount) > 0
        ? 0.16
        : 0;
    const concreteFamilyBonus =
      raw && typeof raw.familyKey === 'string' && raw.familyKey.trim().length > 0
        ? 0.06
        : 0;
    const sourceCount =
      candidate.verifiedProblemMatchedEvidenceSourceCount ??
      candidate.verifiedEvidenceSourceCount ??
      0;
    const sourceDiversityBonus = Math.min(0.06, Math.max(0, sourceCount - 1) * 0.03);
    const eligibilityBonus = candidate.selectionEligible ? 0.04 : 0;

    return (
      Math.min(1, semanticDomainFit) * 0.35 +
      Math.min(1, actionability) * 0.35 +
      evidenceClassScore +
      structuredProblemBonus +
      concreteFamilyBonus +
      sourceDiversityBonus +
      eligibilityBonus
    );
  }

  private candidateEvidenceActionability(
    candidate: IdeaOpportunityRanking['selected'],
  ): number {
    const verifiedSamples = candidate.independentEvidence ?? [];
    const verifiedScore = verifiedSamples.reduce((maximum, evidence) => {
      const sourceType = evidence.commentExternalId ? 'COMMENT' : 'POST';
      return Math.max(
        maximum,
        scoreProblemEvidenceActionability(evidence.text, sourceType),
      );
    }, 0);
    const rawScore =
      candidate.raw &&
      typeof candidate.raw === 'object' &&
      !Array.isArray(candidate.raw) &&
      typeof (candidate.raw as Prisma.JsonObject).evidenceActionabilityScore ===
        'number'
        ? Number(
            (candidate.raw as Prisma.JsonObject).evidenceActionabilityScore,
          )
        : 0;

    return Math.max(verifiedScore, rawScore);
  }

  private enforceEvidenceNarrativeConsistency(
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    const normalizeCandidate = (
      candidate: IdeaOpportunityRanking['selected'],
    ): IdeaOpportunityRanking['selected'] => {
      const evidence = candidate.independentEvidence ?? [];
      if (evidence.length === 0) return candidate;

      const descriptor = [
        candidate.title,
        candidate.problem ?? '',
        candidate.need ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!descriptor) return candidate;

      const problemDescriptor =
        candidate.problem?.replace(/\s+/gu, ' ').trim() || descriptor;
      const rawCandidate =
        candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
          ? candidate.raw as Record<string, unknown>
          : null;
      const requesterDescription =
        rawCandidate && typeof rawCandidate.requestDescription === 'string'
          ? rawCandidate.requestDescription.trim()
          : '';
      const matchingEvidence = evidence.filter(
        (item) =>
          matchEvidenceToProblemFamily(descriptor, item.text).matched ||
          RequestEvidenceAlignmentUtil.isAligned({
            requestDescription: problemDescriptor,
            evidenceText: item.text,
          }),
      );
      const verifiedSupportingLedger =
        (candidate.qualifiedExternalSupportingEvidenceCount ?? 0) > 0 &&
        (candidate.independentEvidence?.length ?? 0) > 0;
      const compositeEvidenceMatches =
        matchingEvidence.length === 0 &&
        RequestEvidenceAlignmentUtil.isCompositeAligned({
          requestDescription: requesterDescription || problemDescriptor,
          evidenceTexts: evidence.map((item) => item.text),
        });
      if (
        matchingEvidence.length > 0 ||
        compositeEvidenceMatches ||
        verifiedSupportingLedger
      ) {
        if (!candidate.disqualificationReasons.includes('EVIDENCE_SEMANTIC_MISMATCH')) {
          return candidate;
        }
        return {
          ...candidate,
          disqualificationReasons: candidate.disqualificationReasons.filter(
            (reason) => reason !== 'EVIDENCE_SEMANTIC_MISMATCH',
          ),
        };
      }

      return {
        ...candidate,
        selectionEligible: false,
        disqualificationReasons: [
          ...candidate.disqualificationReasons.filter(
            (reason) => reason !== 'EVIDENCE_SEMANTIC_MISMATCH',
          ),
          'EVIDENCE_SEMANTIC_MISMATCH',
        ],
      };
    };

    const normalized = [ranking.selected, ...ranking.alternatives].map(
      normalizeCandidate,
    );
    const eligible = normalized
      .filter(
        (candidate) =>
          !candidate.disqualificationReasons.includes(
            'EVIDENCE_SEMANTIC_MISMATCH',
          ),
      )
      .sort((left, right) => {
        if (left.selectionEligible !== right.selectionEligible) {
          return left.selectionEligible ? -1 : 1;
        }
        return right.finalScore - left.finalScore;
      });
    const winner = eligible[0] ?? normalized[0] ?? ranking.selected;
    const ordered = [
      winner,
      ...normalized.filter((candidate) => candidate !== winner),
    ].map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    return {
      ...ranking,
      selected: ordered[0],
      alternatives: ordered.slice(1),
      qualityWarnings:
        winner !== ranking.selected
          ? [
              'Evidence-semantic consistency rejected a higher-scoring candidate whose title/problem did not describe the retained evidence family.',
              ...ranking.qualityWarnings,
            ]
          : ranking.qualityWarnings,
      selectionReason:
        winner !== ranking.selected
          ? `Selected "${winner.title}" after rejecting a candidate whose problem narrative was not supported by its retained evidence.`
          : ranking.selectionReason,
    };
  }

  private async tryRankContext(
    context: IdeaGenerationContext,
    previousIdeaTexts: readonly string[],
  ): Promise<IdeaOpportunityRanking | null> {
    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message: 'NLP analysis is required before opportunity ranking.',
      });
    }

    try {
      let ranking: IdeaOpportunityRanking;

      try {
        ranking = this.opportunityRankingService.rank(
          this.hydrateNlpWithDomainEvidence(context),
          [
            context.location.country,
            context.location.city ?? '',
            context.location.region ?? '',
          ],
          previousIdeaTexts,
          context.communityAiAnalysis,
          context.selectedDomains,
        );
      } catch (error: unknown) {
        if (!(error instanceof NoRankedIdeaOpportunityError)) {
          throw error;
        }

        const groundedCommunityFallback =
          this.buildGroundedCommunityFallbackRanking(context);

        if (!groundedCommunityFallback) {
          return null;
        }

        ranking = groundedCommunityFallback;
      }

      const collectionJobIds = this.resolveEvidenceCollectionJobIds(context);
      const provenanceHints = this.buildEvidenceProvenanceHints(context);
      const verifiedRanking = this.preferVerifiedEvidenceQualityWinner(
        this.enforceEvidenceNarrativeConsistency(
          this.opportunityRankingService.reconcileVerifiedDomainAttribution(
          await this.independentEvidenceVerificationService.verifyRanking(
            ranking,
            collectionJobIds,
            provenanceHints,
          ),
          context.selectedDomains.map((domain) => ({
            name: domain.name,
            keywords: domain.effectiveSearchKeywords ?? domain.keywords,
          })),
          ),
        ),
        context,
      );

      const verifiedHasUsableEvidence =
        !verifiedRanking.selected.disqualificationReasons.includes(
          'EVIDENCE_SEMANTIC_MISMATCH',
        ) &&
        (verifiedRanking.selected.evidenceSamples.length > 0 ||
        (verifiedRanking.selected.verifiedProblemMatchedEvidenceCount ??
          verifiedRanking.selected.verifiedIndependentEvidenceCount ??
          verifiedRanking.selected.verifiedEvidenceCount ??
          0) > 0);

      const selectedVerifiedDirectCount =
        (verifiedRanking.selected.verifiedComplaintEvidenceCount ?? 0) +
        (verifiedRanking.selected.verifiedFeatureRequestEvidenceCount ?? 0) +
        (verifiedRanking.selected.verifiedObservationEvidenceCount ?? 0) +
        (verifiedRanking.selected.verifiedDirectUserEvidenceCount ?? 0);
      const selectedVerifiedSecondaryCount =
        verifiedRanking.selected.verifiedSecondaryEvidenceCount ?? 0;

      if (
        !context.requestDescription?.trim() &&
        selectedVerifiedSecondaryCount > 0 &&
        selectedVerifiedDirectCount === 0
      ) {
        const directDomainFallback =
          this.buildDirectDomainEvidenceFallbackRanking(context);
        if (directDomainFallback) {
          const verifiedDirectDomainFallback = this.enforceEvidenceNarrativeConsistency(
            this.opportunityRankingService.reconcileVerifiedDomainAttribution(
              await this.independentEvidenceVerificationService.verifyRanking(
                directDomainFallback,
                collectionJobIds,
                provenanceHints,
              ),
              context.selectedDomains.map((domain) => ({
                name: domain.name,
                keywords: domain.effectiveSearchKeywords ?? domain.keywords,
              })),
            ),
          );
          const verifiedFallbackDirectCount =
            (verifiedDirectDomainFallback.selected.verifiedComplaintEvidenceCount ?? 0) +
            (verifiedDirectDomainFallback.selected.verifiedFeatureRequestEvidenceCount ?? 0) +
            (verifiedDirectDomainFallback.selected.verifiedObservationEvidenceCount ?? 0) +
            (verifiedDirectDomainFallback.selected.verifiedDirectUserEvidenceCount ?? 0);
          const verifiedFallbackEvidenceCount =
            verifiedDirectDomainFallback.selected.verifiedProblemMatchedEvidenceCount ??
            verifiedDirectDomainFallback.selected.verifiedEvidenceCount ??
            verifiedDirectDomainFallback.selected.independentEvidence?.length ??
            0;
          const currentActionability = this.candidateEvidenceActionability(
            verifiedRanking.selected,
          );
          const fallbackActionability = this.candidateEvidenceActionability(
            verifiedDirectDomainFallback.selected,
          );

          if (
            verifiedFallbackDirectCount > 0 ||
            (verifiedFallbackEvidenceCount > 0 &&
              fallbackActionability >= Math.max(0.55, currentActionability + 0.08))
          ) {
            return verifiedDirectDomainFallback;
          }
        }
      }

      if (verifiedHasUsableEvidence) {
        return verifiedRanking;
      }

      /*
       * Defensive rescue: a schema-validated Community AI opportunity with an
       * exact grounded corpus quote must not be replaced by a no-evidence
       * hypothesis merely because a generic NLP normalization rule discarded
       * it. Re-run provenance verification on the strongest grounded community
       * opportunity and keep the strict recurrence gate unchanged.
       */
      const groundedCommunityFallback =
        this.buildGroundedCommunityFallbackRanking(context);

      if (!groundedCommunityFallback) {
        return verifiedRanking;
      }

      const verifiedCommunityFallback = this.enforceEvidenceNarrativeConsistency(
        this.opportunityRankingService.reconcileVerifiedDomainAttribution(
          await this.independentEvidenceVerificationService.verifyRanking(
            groundedCommunityFallback,
            collectionJobIds,
            provenanceHints,
          ),
          context.selectedDomains.map((domain) => ({
            name: domain.name,
            keywords: domain.effectiveSearchKeywords ?? domain.keywords,
          })),
        ),
      );
      const fallbackHasDirectEvidence =
        !verifiedCommunityFallback.selected.disqualificationReasons.includes(
          'EVIDENCE_SEMANTIC_MISMATCH',
        ) &&
        (verifiedCommunityFallback.selected.evidenceSamples.length > 0 ||
          (verifiedCommunityFallback.selected.verifiedProblemMatchedEvidenceCount ??
            verifiedCommunityFallback.selected.verifiedIndependentEvidenceCount ??
            0) > 0);

      if (fallbackHasDirectEvidence) {
        return verifiedCommunityFallback;
      }

      /*
       * Final provenance-safe rescue. Community AI is allowed to fail or return
       * an empty array, but an exact retained direct complaint in domainEvidence
       * must never be converted into a no-evidence validation hypothesis. Build
       * a conservative candidate from the verbatim retained text and pass it
       * through the same independent DB verification service before accepting it.
       */
      const directDomainFallback =
        this.buildDirectDomainEvidenceFallbackRanking(context);

      if (!directDomainFallback) {
        return verifiedRanking;
      }

      const verifiedDirectDomainFallback = this.enforceEvidenceNarrativeConsistency(
        this.opportunityRankingService.reconcileVerifiedDomainAttribution(
          await this.independentEvidenceVerificationService.verifyRanking(
            directDomainFallback,
            collectionJobIds,
            provenanceHints,
          ),
          context.selectedDomains.map((domain) => ({
            name: domain.name,
            keywords: domain.effectiveSearchKeywords ?? domain.keywords,
          })),
        ),
      );
      const directFallbackHasEvidence =
        !verifiedDirectDomainFallback.selected.disqualificationReasons.includes(
          'EVIDENCE_SEMANTIC_MISMATCH',
        ) &&
        (verifiedDirectDomainFallback.selected.evidenceSamples.length > 0 ||
          (verifiedDirectDomainFallback.selected.verifiedProblemMatchedEvidenceCount ??
            verifiedDirectDomainFallback.selected.verifiedIndependentEvidenceCount ??
            0) > 0);

      return directFallbackHasEvidence
        ? verifiedDirectDomainFallback
        : verifiedRanking;
    } catch (error: unknown) {
      if (error instanceof NoRankedIdeaOpportunityError) {
        return null;
      }

      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to rank the discovered product opportunities.',
      });
    }
  }

  /**
   * Builds a conservative ranking record from the strongest schema-validated
   * Community AI opportunity when the generic NLP candidate normalizer drops
   * that opportunity. This is a rescue path, not an eligibility bypass:
   * independent provenance verification still runs immediately afterward and
   * recurrence/source-diversity requirements remain unchanged.
   */
  private buildDirectDomainEvidenceFallbackRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking | null {
    const trustedIds = new Set(
      (context.canonicalEvidenceLedger ?? [])
        .filter((item) => item.verified && item.classification === 'DIRECT_PROBLEM')
        .map((item) => item.id),
    );
    if (trustedIds.size === 0) return null;
    const selectedDomainNames = new Set(
      context.selectedDomains.map((domain) => domain.name.trim().toLowerCase()),
    );
    const candidateEvidence = context.domainEvidence.filter(
      (entry) =>
        selectedDomainNames.size === 0 ||
        selectedDomainNames.has(entry.domainName.trim().toLowerCase()),
    );
    const selectedDomainDescriptors = context.selectedDomains.map((domain) => ({
      name: domain.name,
      keywords: domain.keywords,
      effectiveSearchKeywords: domain.effectiveSearchKeywords,
    }));

    const samples = candidateEvidence
      .flatMap((domainEvidence) => [
        ...this.readDomainEvidenceEntries(domainEvidence.sampleComments).map((entry) => ({
          sample: entry.text,
          evidenceId: entry.id,
          sourceKey: this.readSourceKeyFromEvidenceId(entry.id),
          collectorDomainName: domainEvidence.domainName,
          domainName: domainEvidence.domainName,
          domainId: domainEvidence.domainId,
          sourceKind: 'COMMENT' as const,
        })),
        ...this.readDomainEvidenceEntries(domainEvidence.samplePosts).map((entry) => ({
          sample: entry.text,
          evidenceId: entry.id,
          sourceKey: this.readSourceKeyFromEvidenceId(entry.id),
          collectorDomainName: domainEvidence.domainName,
          domainName: domainEvidence.domainName,
          domainId: domainEvidence.domainId,
          sourceKind: 'POST' as const,
        })),
      ])
      .filter((entry) => trustedIds.has(entry.evidenceId))
      .map((entry) => ({
        ...entry,
        sample: entry.sample.replace(/\s+/gu, ' ').trim(),
      }))
      .filter((entry) => entry.sample.length >= 20)
      .map((entry) => {
        const strictDomainNames =
          SelectedDomainEvidenceAlignmentUtil.matchStrictDomainNames(
            entry.sample,
            selectedDomainDescriptors,
          );
        const relaxedDomainNames =
          strictDomainNames.length > 0
            ? []
            : SelectedDomainEvidenceAlignmentUtil.matchDomainNames(
                entry.sample,
                selectedDomainDescriptors,
              );
        const normalizedCollectorDomain = entry.collectorDomainName
          .trim()
          .toLocaleLowerCase();
        const strictCollectorDomain = strictDomainNames.find(
          (name) => name.trim().toLocaleLowerCase() === normalizedCollectorDomain,
        );
        const relaxedCollectorDomain = relaxedDomainNames.find(
          (name) => name.trim().toLocaleLowerCase() === normalizedCollectorDomain,
        );
        const semanticDomainName =
          strictCollectorDomain ?? strictDomainNames[0] ?? relaxedCollectorDomain ?? null;
        const semanticDomain = semanticDomainName
          ? context.selectedDomains.find(
              (domain) =>
                domain.name.trim().toLocaleLowerCase() ===
                semanticDomainName.trim().toLocaleLowerCase(),
            )
          : null;
        const semanticDomainNames = strictDomainNames.length > 0
          ? strictDomainNames
          : relaxedCollectorDomain
            ? [relaxedCollectorDomain]
            : [];
        const semanticDomainScore = strictDomainNames.length > 0 ? 1 : 0.7;

        return {
          ...entry,
          domainName: semanticDomain?.name ?? '',
          domainId: semanticDomain?.id ?? entry.domainId,
          semanticDomainNames,
          semanticDomainScore: semanticDomain ? semanticDomainScore : 0,
        };
      })
      .filter((entry) => Boolean(entry.domainName))
      .map((entry) => {
        const sample = entry.sample;
        const body = sample.replace(
          /^.*?\bCommunity comment:\s*/isu,
          '',
        ).trim();
        const promotional = isLikelyPromotionalEvidence(body);
        const classifiedKind = promotional
          ? ('NONE' as const)
          : classifyDirectCommunityEvidence(body, entry.sourceKind);
        const explicitFeatureRequest = classifiedKind === 'FEATURE_REQUEST';
        const structuredProblem =
          !promotional &&
          !explicitFeatureRequest &&
          isStructuredOperationalProblemEvidence(sample, entry.sourceKind);
        const technicalTicket =
          !promotional &&
          !explicitFeatureRequest &&
          this.isLikelyTechnicalTicketFallback(
            body,
            entry.sourceKind,
            entry.sourceKey,
          );
        const directKind =
          structuredProblem || technicalTicket
            ? ('NONE' as const)
            : classifiedKind;
        const family = resolvePrimaryProblemFamily(body);
        const actionabilityScore = scoreProblemEvidenceActionability(
          sample,
          entry.sourceKind,
        );
        let score = actionabilityScore * 20;
        score += entry.semanticDomainScore * 10;
        score += Math.min(body.length, 320) / 160;
        if (directKind === 'USER_COMPLAINT') score += 8;
        if (directKind === 'FEATURE_REQUEST') score += 6;
        if (directKind === 'OBSERVED_UNMET_NEED') score += 5;
        if (structuredProblem) score += 7;
        if (technicalTicket) score += 7;
        if (
          /\b(?:cannot|can['’]?t|unable|blocked|unavailable|not available|error|wrong|crash|slow|delay|wait|missing|risk|unsafe|bias|liability|privacy|problem|issue|struggle|difficult)\b/iu.test(
            body,
          )
        ) {
          score += 3;
        }
        return {
          ...entry,
          sample,
          body,
          directKind,
          structuredProblem,
          technicalTicket,
          actionabilityScore,
          familyKey: family?.key ?? null,
          score,
        };
      })
      .filter((item) => {
        const directKind =
          item.directKind === 'USER_COMPLAINT' ||
          item.directKind === 'FEATURE_REQUEST' ||
          item.directKind === 'OBSERVED_UNMET_NEED';
        if (!directKind && !item.structuredProblem && !item.technicalTicket) {
          return false;
        }
        if (item.sourceKind === 'COMMENT') return true;

        if (
          item.structuredProblem ||
          item.technicalTicket ||
          item.directKind === 'FEATURE_REQUEST'
        ) {
          return true;
        }

        return /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b/iu.test(
          item.body,
        );
      });

    if (samples.length === 0) {
      return null;
    }

    const clusters = new Map<string, typeof samples>();
    for (const sample of samples) {
      const semanticCluster = sample.familyKey
        ? sample.familyKey
        : `sample:${sample.body
            .normalize('NFKC')
            .toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 90)}`;
      // A semantic familyKey represents the same problem mechanism across
      // domains. Keep lexical/no-family clusters domain-scoped, but allow a
      // verified family to aggregate Finance + Cybersecurity + Healthcare, etc.
      const key = sample.familyKey
        ? `family::${semanticCluster}`
        : `${sample.domainName.trim().toLocaleLowerCase()}::${semanticCluster}`;
      const existing = clusters.get(key) ?? [];
      clusters.set(key, [...existing, sample]);
    }

    const rankedClusters = [...clusters.values()]
      .map((cluster) => {
        const orderedSamples = [...cluster].sort(
          (first, second) => second.score - first.score,
        );
        const strongest = orderedSamples[0];
        if (!strongest) return null;

        const uniqueSamples = [
          ...new Map(
            orderedSamples.map((entry) => [
              entry.sample.normalize('NFKC').toLocaleLowerCase(),
              entry,
            ]),
          ).values(),
        ].slice(0, 6);
        const complaintCount = uniqueSamples.filter(
          (item) => item.directKind === 'USER_COMPLAINT',
        ).length;
        const requestCount = uniqueSamples.filter(
          (item) => item.directKind === 'FEATURE_REQUEST',
        ).length;
        const observedNeedCount = uniqueSamples.filter(
          (item) => item.directKind === 'OBSERVED_UNMET_NEED',
        ).length;
        const structuredProblemCount = uniqueSamples.filter(
          (item) => item.structuredProblem,
        ).length;
        const technicalTicketCount = uniqueSamples.filter(
          (item) => item.technicalTicket,
        ).length;
        const familySemantics = this.resolveExternalFallbackFamilySemantics(
          strongest.body,
          strongest.domainName,
        );
        const problemSentence = this.extractStrongestDirectProblemSentence(
          strongest.body,
        );
        const boundedProblem = (
          familySemantics?.problem ??
          problemSentence ??
          strongest.body
        ).slice(0, 260).trim();
        const title =
          familySemantics?.title ??
          this.buildNeutralDirectEvidenceTitle(
            strongest.domainName,
            strongest.directKind,
            strongest.structuredProblem,
            strongest.technicalTicket,
          );
        const evidenceSamples = uniqueSamples.map((item) => item.sample);
        const fallbackNeed = this.buildNeutralDirectEvidenceNeed(
          strongest.directKind,
          strongest.structuredProblem,
          strongest.technicalTicket,
        );
        const fallbackSolutionArea = this.buildNeutralDirectEvidenceSolutionArea(
          strongest.directKind,
          strongest.structuredProblem,
          strongest.technicalTicket,
        );
        const clusterSupportBonus = Math.min(
          10,
          Math.max(0, evidenceSamples.length - 1) * 4,
        );
        const clusterDomainNames = [...new Set(
          uniqueSamples.map((item) => item.domainName.trim()).filter(Boolean),
        )];
        const clusterSourceKeys = [...new Set(
          uniqueSamples.map((item) => item.sourceKey.trim().toLocaleLowerCase()).filter(Boolean),
        )];
        const coherentDomainDiversityBonus = strongest.familyKey
          ? Math.min(6, Math.max(0, clusterDomainNames.length - 1) * 2)
          : 0;
        const sourceDiversityBonus = Math.min(6, Math.max(0, clusterSourceKeys.length - 1) * 2);
        const classStrength =
          complaintCount > 0
            ? 30
            : requestCount > 0
              ? 24
              : observedNeedCount > 0
                ? 22
                : technicalTicketCount > 0
                  ? 20
                  : structuredProblemCount > 0
                    ? 20
                    : 12;
        const actionabilityBonus = Math.round(
          Math.max(...uniqueSamples.map((item) => item.actionabilityScore)) * 12,
        );
        const clusterScore =
          strongest.score +
          clusterSupportBonus +
          classStrength +
          actionabilityBonus +
          coherentDomainDiversityBonus +
          sourceDiversityBonus;

        const candidate: IdeaOpportunityRanking['selected'] = {
          rank: 1,
          title,
          problem: boundedProblem,
          need: familySemantics?.need ?? fallbackNeed,
          solutionArea: familySemantics?.solutionArea ?? fallbackSolutionArea,
          evidenceType: 'OPPORTUNITY',
          sourceIndex: 0,
          frequency: evidenceSamples.length,
          severity: 'MEDIUM',
          evidenceSamples,
          frequencyScore: Math.min(1, evidenceSamples.length / 5),
          severityScore: 0.6,
          evidenceScore: Math.min(1, evidenceSamples.length / 5),
          evidenceReliabilityScore: Math.min(
            0.97,
            0.88 + Math.max(0, evidenceSamples.length - 1) * 0.03,
          ),
          weakEvidencePenalty: evidenceSamples.length === 1 ? 0.08 : 0.04,
          specificityScore: familySemantics ? 0.92 : 0.84,
          feasibilityScore: 0.72,
          localRelevanceScore: 0.25,
          noveltyScore: 0.5,
          businessValueScore: 0.5,
          marketGapScore: 0.45,
          competitionScore: 0.5,
          technicalRiskScore: 0.28,
          supportScore: Math.min(
            0.9,
            0.68 + Math.max(0, evidenceSamples.length - 1) * 0.06,
          ),
          nlpConfidenceScore: context.nlp?.confidence ?? 0.4,
          baseScore: Math.min(
            0.76,
            0.56 + Math.max(0, evidenceSamples.length - 1) * 0.06,
          ),
          confidencePenalty: evidenceSamples.length === 1 ? 0.04 : 0.02,
          finalScore: Math.min(
            0.76,
            0.5 + Math.max(0, evidenceSamples.length - 1) * 0.08,
          ),
          matchedDomainNames: clusterDomainNames,
          problemDomainNames: clusterDomainNames,
          primaryMatchedDomainName: strongest.domainName,
          domainRelevanceScores: Object.fromEntries(
            clusterDomainNames.map((domainName) => [domainName, 1]),
          ),
          problemDomainRelevanceScores: Object.fromEntries(
            clusterDomainNames.map((domainName) => [domainName, 1]),
          ),
          selectionEligible: false,
          disqualificationReasons: [
            'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
          ],
          verifiedIndependentEvidenceCount: 0,
          verifiedIndependentSourceCount: 0,
          independentEvidence: [],
          supportingEvidence: uniqueSamples.map((item) => ({
            sourceType:
              item.directKind === 'FEATURE_REQUEST' ||
              item.directKind === 'USER_COMPLAINT' ||
              item.directKind === 'OBSERVED_UNMET_NEED'
                ? ('COMMUNITY_EVIDENCE' as const)
                : item.structuredProblem || item.technicalTicket
                  ? ('SECONDARY_EVIDENCE' as const)
                  : ('COMMUNITY_EVIDENCE' as const),
            text: item.sample,
            qualifiesAsCommunityEvidence:
              item.directKind === 'FEATURE_REQUEST' ||
              item.directKind === 'USER_COMPLAINT' ||
              item.directKind === 'OBSERVED_UNMET_NEED' ||
              (!item.structuredProblem && !item.technicalTicket),
          })),
          raw: {
            title,
            source: 'DIRECT_DOMAIN_EVIDENCE_FALLBACK',
            ...(familySemantics ? { familyKey: familySemantics.familyKey } : {}),
            problem: boundedProblem,
            unmetNeed: familySemantics?.need ?? fallbackNeed,
            domainName: strongest.domainName,
            domainNames: clusterDomainNames,
            collectorDomainName: strongest.collectorDomainName,
            semanticDomainNames: strongest.semanticDomainNames,
            semanticDomainVerified: true,
            semanticDomainScore: strongest.semanticDomainScore,
            solutionArea:
              familySemantics?.solutionArea ?? fallbackSolutionArea,
            evidenceSamples,
            supportingEvidence: uniqueSamples.map((item) => ({
              sourceType:
                item.directKind === 'FEATURE_REQUEST' ||
                item.directKind === 'USER_COMPLAINT' ||
                item.directKind === 'OBSERVED_UNMET_NEED'
                  ? 'COMMUNITY_EVIDENCE'
                  : item.structuredProblem || item.technicalTicket
                    ? 'SECONDARY_EVIDENCE'
                    : 'COMMUNITY_EVIDENCE',
              text: item.sample,
              qualifiesAsCommunityEvidence:
                item.directKind === 'FEATURE_REQUEST' ||
                item.directKind === 'USER_COMPLAINT' ||
                item.directKind === 'OBSERVED_UNMET_NEED' ||
                (!item.structuredProblem && !item.technicalTicket),
            })),
            directComplaintCount: complaintCount,
            featureRequestCount: requestCount,
            observedUnmetNeedCount: observedNeedCount,
            technicalTicketCount,
            structuredProblemCount,
            evidenceActionabilityScore: Math.max(
              ...uniqueSamples.map((item) => item.actionabilityScore),
            ),
            groundingScore: 100,
          } as unknown as Prisma.JsonValue,
        };

        return { candidate, clusterScore };
      })
      .filter(
        (
          entry,
        ): entry is {
          candidate: IdeaOpportunityRanking['selected'];
          clusterScore: number;
        } => Boolean(entry),
      )
      .sort(
        (first, second) =>
          second.clusterScore - first.clusterScore ||
          second.candidate.evidenceSamples.length -
            first.candidate.evidenceSamples.length ||
          second.candidate.finalScore - first.candidate.finalScore,
      );

    const selectedCluster = rankedClusters[0];
    if (!selectedCluster) {
      return null;
    }

    const orderedCandidates = rankedClusters.map((entry, index) => ({
      ...entry.candidate,
      rank: index + 1,
    }));
    const [selected, ...alternatives] = orderedCandidates;
    if (!selected) return null;

    return {
      selected,
      alternatives,
      evaluatedCount: rankedClusters.length,
      evidenceCoverage: Math.min(1, selected.evidenceSamples.length / 3),
      selectionReason:
        `Compared direct retained evidence globally across all selected domains and selected "${selected.title}" from ${selected.primaryMatchedDomainName ?? selected.matchedDomainNames?.[0] ?? 'the strongest domain'} with ${selected.evidenceSamples.length} coherent direct evidence sample(s). Independent DB provenance verification remains mandatory.`,
      qualityWarnings: [
        selected.evidenceSamples.length >= 3
          ? 'Multiple coherent direct reports support this problem family, but independent source diversity still determines whether recurrence may be claimed.'
          : 'The selected direct-evidence cluster is suitable for a preliminary pilot; broader recurrence and market-wide claims remain unproven until source diversity is verified.',
      ],
    };
  }

  /**
   * Selects the sentence that expresses the actual user pain rather than the
   * first sentence that merely contains a generic word such as "problem".
   * Specific recognized problem families receive the highest weight so a
   * statement such as "I encountered shocking hallucinations" outranks a later
   * narrative sentence such as "this problem may be overcome soon".
   */
  private buildNeutralDirectEvidenceTitle(
    domainName: string,
    directKind: 'USER_COMPLAINT' | 'FEATURE_REQUEST' | 'OBSERVED_UNMET_NEED' | 'USER_QUESTION' | 'GENERAL_COMMENTARY' | 'NONE',
    structuredProblem: boolean,
    technicalTicket: boolean,
  ): string {
    if (technicalTicket) {
      return `${domainName} Technical Workflow Issue`;
    }
    if (structuredProblem) {
      return `${domainName} Operational Workflow Gap`;
    }
    if (directKind === 'FEATURE_REQUEST') {
      return `${domainName} Requested Workflow Capability`;
    }
    if (directKind === 'OBSERVED_UNMET_NEED') {
      return `${domainName} User Workflow Need`;
    }
    if (directKind === 'USER_COMPLAINT') {
      return `${domainName} User-Reported Workflow Failure`;
    }
    return `${domainName} Evidence-Grounded Workflow Need`;
  }

  private buildNeutralDirectEvidenceNeed(
    directKind: 'USER_COMPLAINT' | 'FEATURE_REQUEST' | 'OBSERVED_UNMET_NEED' | 'USER_QUESTION' | 'GENERAL_COMMENTARY' | 'NONE',
    structuredProblem: boolean,
    technicalTicket: boolean,
  ): string {
    if (technicalTicket) {
      return 'A bounded technical workflow that addresses only the implementation issue explicitly supported by the retained ticket and does not convert technical planning into user-complaint evidence.';
    }
    if (structuredProblem) {
      return 'A bounded workflow response to the structured operational problem, with broader demand and recurrence left for direct validation.';
    }
    if (directKind === 'FEATURE_REQUEST') {
      return 'A focused workflow capability that addresses the retained request without inferring additional failures, causes, or mechanisms.';
    }
    if (directKind === 'OBSERVED_UNMET_NEED') {
      return 'A focused workflow that addresses the observed user need without recasting the positive testimonial as a product complaint or claiming recurrence.';
    }
    return 'A focused workflow response limited to the concrete failure explicitly supported by the retained direct report, with broader recurrence left for validation.';
  }

  private buildNeutralDirectEvidenceSolutionArea(
    directKind: 'USER_COMPLAINT' | 'FEATURE_REQUEST' | 'OBSERVED_UNMET_NEED' | 'USER_QUESTION' | 'GENERAL_COMMENTARY' | 'NONE',
    structuredProblem: boolean,
    technicalTicket: boolean,
  ): string {
    if (technicalTicket) {
      return 'Technical Workflow Validation and Implementation Traceability';
    }
    if (structuredProblem) {
      return 'Operational Workflow Validation and Guided Resolution';
    }
    if (directKind === 'FEATURE_REQUEST') {
      return 'Requested Capability Validation and Evidence-Grounded Workflow Design';
    }
    if (directKind === 'OBSERVED_UNMET_NEED') {
      return 'Observed-Need Capture, Recall Support, and Human-Validated Workflow Design';
    }
    return 'Evidence-Grounded Diagnosis, Guided Resolution, and Pilot Validation';
  }

  private extractStrongestDirectProblemSentence(value: string): string | null {
    const body = value
      .replace(/^.*?\bCommunity comment:\s*/isu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!body) return null;

    return body
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 20)
      .map((sentence) => {
        const kind = classifyDirectCommunityEvidence(sentence, 'COMMENT');
        const direct =
          kind === 'USER_COMPLAINT' ||
          kind === 'FEATURE_REQUEST' ||
          kind === 'OBSERVED_UNMET_NEED';
        if (!direct) return null;

        const family = resolvePrimaryProblemFamily(sentence);
        const normalized = sentence.toLocaleLowerCase();
        let score = Math.min(sentence.length, 240) / 100;
        if (family && !family.key.startsWith('lexical:')) score += 9;
        if (/\b(?:hallucinat(?:e|es|ed|ing|ion|ions)|transaction reverted|execution reverted|cannot|can['’]?t|unable|failed|failure|error|wrong|incorrect|missing|unsafe|risk|breach|crash|slow|delay)\b/iu.test(normalized)) {
          score += 5;
        }
        if (/\b(?:problem|issue)\b/iu.test(normalized) && !family) score += 0.5;
        return { sentence, score };
      })
      .filter((entry): entry is { sentence: string; score: number } => entry !== null)
      .sort((first, second) => second.score - first.score)[0]?.sentence ?? null;
  }

  /**
   * Final invariant: contextual evidence may explain or motivate a pilot, but
   * only explicitly qualifying community evidence (or a directly verified
   * technical/user signal) may contribute to recurrence, verified evidence
   * score, or selection eligibility.
   *
   * This closes the leak where a later requester-support merge re-inflated
   * evidenceScore/frequency after the provenance verifier had already marked
   * every supporting entry `qualifiesAsCommunityEvidence=false`.
   */
  private enforceCommunityEvidenceQualificationInvariant(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    const selected = ranking.selected;
    const qualifyingSupportingCount =
      selected.supportingEvidence?.filter(
        (item) => item.qualifiesAsCommunityEvidence && item.text.trim(),
      ).length ?? 0;
    const explicitlyNonQualifyingTexts = new Set(
      (selected.supportingEvidence ?? [])
        .filter((item) => !item.qualifiesAsCommunityEvidence && item.text.trim())
        .map((item) => item.text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()),
    );
    const directIndependentKinds = new Set([
      'DIRECT_USER_COMPLAINT',
      'USER_COMPLAINT',
      'USER_QUESTION',
      'FEATURE_REQUEST',
      'REVIEW',
      'TECHNICAL_TICKET',
    ]);
    const qualifyingIndependentCount =
      selected.independentEvidence?.filter(
        (item) =>
          directIndependentKinds.has(item.evidenceKind) &&
          !explicitlyNonQualifyingTexts.has(
            item.text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
          ) &&
          this.passesFinalRequesterSupportingLedgerGuard(context, item.text),
      ).length ?? 0;
    const verifiedDirectCount =
      explicitlyNonQualifyingTexts.size === 0
        ? (selected.verifiedProblemMatchedDirectUserEvidenceCount ?? 0) +
          (selected.verifiedProblemMatchedComplaintEvidenceCount ?? 0) +
          (selected.verifiedProblemMatchedFeatureRequestEvidenceCount ?? 0) +
          (selected.verifiedProblemMatchedTechnicalEvidenceCount ?? 0)
        : 0;

    if (
      qualifyingSupportingCount > 0 ||
      qualifyingIndependentCount > 0 ||
      verifiedDirectCount > 0
    ) {
      return ranking;
    }

    const qualifiedSupportingCount =
      selected.qualifiedExternalSupportingEvidenceCount ?? 0;
    const hasQualifiedContext =
      qualifiedSupportingCount > 0 ||
      (selected.supportingEvidence?.some(
        (item) =>
          !item.qualifiesAsCommunityEvidence &&
          (item.sourceType === 'SECONDARY_EVIDENCE' ||
            item.sourceType === 'TECHNICAL_EVIDENCE' ||
            item.sourceType === 'COMMUNITY_EVIDENCE') &&
          item.text.trim(),
      ) ?? false);
    if (!hasQualifiedContext) {
      return ranking;
    }

    const reasons = new Set(selected.disqualificationReasons);
    reasons.add('NO_DIRECT_EVIDENCE');
    reasons.add('INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE');

    const raw =
      selected.raw && typeof selected.raw === 'object' && !Array.isArray(selected.raw)
        ? ({
            ...(selected.raw as Prisma.JsonObject),
            evidenceGroundingMode: 'SUPPORTING_ONLY',
            communityEvidenceInvariantApplied: true,
            supportingOnlyPreliminaryEligible: Boolean(
              context.requestDescription?.trim() && hasQualifiedContext,
            ),
          } as Prisma.JsonObject)
        : selected.raw;

    return {
      ...ranking,
      selected: {
        ...selected,
        raw,
        frequency: 0,
        frequencyScore: 0,
        evidenceScore: 0,
        supportScore: Math.min(selected.supportScore, 0.35),
        selectionEligible: Boolean(context.requestDescription?.trim() && hasQualifiedContext),
        disqualificationReasons: [...reasons],
        verifiedProblemMatchedEvidenceCount: 0,
        verifiedProblemMatchedDirectUserEvidenceCount: 0,
        verifiedProblemMatchedComplaintEvidenceCount: 0,
        verifiedProblemMatchedComplaintSourceCount: 0,
        verifiedProblemMatchedFeatureRequestEvidenceCount: 0,
        verifiedProblemMatchedSourceCount: 0,
      },
      evidenceCoverage: Math.max(
        ranking.evidenceCoverage,
        Math.min(0.5, Math.max(1, qualifiedSupportingCount) / 6),
      ),
    };
  }

  private hasUsableExternalEvidence(
    candidate: IdeaOpportunityRanking['selected'] | null,
  ): boolean {
    if (!candidate) return false;
    if (candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN')) {
      return false;
    }
    if (candidate.disqualificationReasons.includes('REQUEST_INTENT_MISMATCH')) {
      return false;
    }

    const strictVerifiedCount =
      candidate.verifiedProblemMatchedEvidenceCount ??
      candidate.verifiedIndependentEvidenceCount ??
      candidate.verifiedEvidenceCount ??
      0;
    const qualifiedSupportingCount =
      candidate.qualifiedExternalSupportingEvidenceCount ?? 0;
    const provenanceVerifiedCount = Math.max(
      candidate.verifiedEvidenceCount ?? 0,
      candidate.independentEvidence?.length ?? 0,
    );

    return (
      strictVerifiedCount > 0 ||
      (qualifiedSupportingCount > 0 && provenanceVerifiedCount > 0)
    );
  }

  private isSufficientVerifiedSecondaryPilotEvidence(
    candidate: IdeaOpportunityRanking['selected'],
  ): boolean {
    if (
      candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') ||
      candidate.disqualificationReasons.includes('REQUEST_INTENT_MISMATCH') ||
      candidate.disqualificationReasons.includes('EVIDENCE_SEMANTIC_MISMATCH') ||
      candidate.disqualificationReasons.includes('LOW_EVIDENCE_QUALITY') ||
      candidate.disqualificationReasons.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      )
    ) {
      return false;
    }

    const secondaryCount =
      candidate.verifiedProblemMatchedSecondaryEvidenceCount ??
      candidate.verifiedSecondaryEvidenceCount ??
      0;
    const problemMatchedCount =
      candidate.verifiedProblemMatchedEvidenceCount ??
      candidate.verifiedEvidenceCount ??
      0;
    const verifiedSourceCount =
      candidate.verifiedProblemMatchedEvidenceSourceCount ??
      candidate.verifiedEvidenceSourceCount ??
      0;
    const directCount =
      (candidate.verifiedProblemMatchedComplaintEvidenceCount ??
        candidate.verifiedComplaintEvidenceCount ??
        0) +
      (candidate.verifiedProblemMatchedFeatureRequestEvidenceCount ??
        candidate.verifiedFeatureRequestEvidenceCount ??
        0) +
      (candidate.verifiedProblemMatchedObservationEvidenceCount ??
        candidate.verifiedObservationEvidenceCount ??
        0) +
      (candidate.verifiedProblemMatchedDirectUserEvidenceCount ??
        candidate.verifiedDirectUserEvidenceCount ??
        0);
    const technicalCount =
      candidate.verifiedProblemMatchedTechnicalEvidenceCount ??
      candidate.verifiedTechnicalEvidenceCount ??
      0;
    const raw =
      candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
        ? (candidate.raw as Prisma.JsonObject)
        : null;
    const familyKey =
      raw && typeof raw.familyKey === 'string' ? raw.familyKey.trim() : '';
    const concreteFamily = Boolean(
      familyKey && !familyKey.toLocaleLowerCase().startsWith('lexical:'),
    );
    const reliability = candidate.evidenceReliabilityScore ?? 0;
    const hasVerifiedSecondaryProvenance =
      candidate.independentEvidence?.some(
        (item) =>
          item.evidenceKind === 'NEWS_REPORT' ||
          item.evidenceKind === 'SECONDARY_REPORT',
      ) ?? false;

    return (
      secondaryCount > 0 &&
      problemMatchedCount > 0 &&
      verifiedSourceCount > 0 &&
      directCount === 0 &&
      technicalCount === 0 &&
      concreteFamily &&
      reliability >= 0.72 &&
      hasVerifiedSecondaryProvenance
    );
  }

  private buildCommunityAiClassifiedExternalEvidence(
    context: IdeaGenerationContext,
  ): RecoveredExternalEvidence[] {
    const trusted = (context.canonicalEvidenceLedger ?? [])
      .filter(
        (item) =>
          item.verified &&
          (item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL'),
      )
      .map((item, index) => ({
        item,
        index,
        score: this.scoreSupportingEvidencePriority(
          context,
          item.text,
          item.confidence,
        ),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const output: RecoveredExternalEvidence[] = [];
    const seen = new Set<string>();
    for (const { item } of trusted) {
      const sourceKey = item.sourceKey.trim().toLocaleLowerCase();
      const sourceType = item.sourceType;
      const prefix = `${sourceKey}:${sourceType.toLocaleLowerCase()}:`;
      const externalId = item.id.startsWith(prefix)
        ? item.id.slice(prefix.length)
        : item.id;
      const raw = context.rawEvidenceCorpus.find((candidate) => candidate.id === item.id);
      const postExternalId = sourceType === 'COMMENT'
        ? (() => {
            const postId = raw?.postId?.trim() ?? '';
            const postPrefix = `${sourceKey}:post:`;
            return postId.startsWith(postPrefix)
              ? postId.slice(postPrefix.length)
              : postId || externalId;
          })()
        : externalId;
      const key = `${sourceKey}:${sourceType}:${postExternalId}:${sourceType === 'COMMENT' ? externalId : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        text: item.text,
        sourceKey,
        postExternalId,
        commentExternalId: sourceType === 'COMMENT' ? externalId : null,
        sourceType,
      });
    }
    return output;
  }


  private scoreSupportingEvidencePriority(
    context: IdeaGenerationContext,
    evidenceText: string,
    aiConfidence: number,
  ): number {
    const request = context.requestDescription?.trim() ?? '';
    if (!request) return aiConfidence;

    const tokenize = (value: string): Set<string> =>
      new Set(
        value
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
          .split(/\s+/u)
          .filter((token) => token.length >= 4)
          .filter(
            (token) =>
              !new Set([
                'with', 'from', 'that', 'this', 'these', 'those', 'their',
                'often', 'struggle', 'reviewed', 'separate', 'systems',
                'service', 'services', 'company', 'companies', 'information',
                'records', 'record', 'problem', 'workflow',
              ]).has(token),
          ),
      );

    const evidenceTokens = tokenize(evidenceText);
    const actorTokens = tokenize(RequestDynamicQueryUtil.extractActor(request));
    const workflowTerms = RequestDynamicQueryUtil.extractWorkflowTerms(request);
    const painTerms = RequestDynamicQueryUtil.extractPainTerms(request);

    const phraseOverlap = (value: string): boolean => {
      const tokens = tokenize(value);
      return [...tokens].some((token) => evidenceTokens.has(token));
    };
    const actorOverlap = [...actorTokens].filter((token) => evidenceTokens.has(token)).length;
    const workflowOverlap = workflowTerms.filter(phraseOverlap).length;
    const painOverlap = painTerms.filter(phraseOverlap).length;
    const selectedDomainOverlap = context.selectedDomains.filter((domain) =>
      [...tokenize(domain.name)].some((token) => evidenceTokens.has(token)),
    ).length;

    let score =
      aiConfidence * 0.08 +
      actorOverlap * 12 +
      workflowOverlap * 6 +
      painOverlap * 5 +
      selectedDomainOverlap * 4;

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
    if (archetype.archetype === 'TRANSACTION_ACCOUNT_ABUSE_OPERATIONS') {
      /*
       * This archetype is shared by transportation, education, marketplaces,
       * public services, and other transaction/account workflows. Never bias
       * supporting evidence toward one hard-coded vertical. Rank it against
       * the current requester actor/object and the same abuse mechanisms.
       */
      const sameRequesterFamily =
        RequestEvidenceAlignmentUtil.passesAiEvidenceAdmissionGuard({
          requestDescription: request,
          evidenceText,
          plannedQueries: context.collectionPlan?.searchQueries ?? [],
        });
      const sameMechanism = [
        /\b(?:payment|transaction|billing|tuition|financial aid|scholarship|fare|fee)\w*\b/iu,
        /\b(?:refund|chargeback|refund abuse|refund fraud|fraudulent refund)\w*\b/iu,
        /\b(?:account takeover|account compromise|identity theft|unauthorized account|fraudulent account)\w*\b/iu,
        /\b(?:security alert|suspicious activity|anomalous activity|fraud detection)\w*\b/iu,
      ].filter((pattern) => pattern.test(evidenceText)).length;
      score += sameRequesterFamily ? 24 : -8;
      score += sameMechanism * 7;
    }

    return score;
  }

  private verifyQualifiedRequesterSupportingEvidence(
    context: IdeaGenerationContext,
    evidence: readonly RecoveredExternalEvidence[],
  ): readonly IndependentEvidence[] {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription || evidence.length === 0) return [];

    /*
     * This is the last semantic boundary before evidence reaches the ranking
     * ledger. Community AI classification alone is not enough: every retained
     * SUPPORTING_SIGNAL must still map to the current canonical requester
     * profile (or pass a strict request guard) before provenance verification.
     * This prevents stale/broad items such as unrelated municipal or traffic
     * stories from surviving merely because an earlier model labelled them as
     * supporting.
     */
    const semanticallyQualified = evidence.filter((item) =>
      this.passesFinalRequesterSupportingLedgerGuard(context, item.text),
    );
    if (semanticallyQualified.length === 0) return [];

    const provenanceHints: EvidenceProvenanceHint[] = semanticallyQualified.map(
      (item) => ({
        text: item.text,
        sourceKey: item.sourceKey,
        postExternalId: item.postExternalId,
        commentExternalId: item.commentExternalId,
      }),
    );

    const verified = this.independentEvidenceVerificationService.verifyProvenanceHints(
      provenanceHints,
    );
    const priority = new Map(
      semanticallyQualified.map((item, index) => [
        item.text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
        index,
      ] as const),
    );
    return [...verified].sort((left, right) => {
      const leftKey = left.text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
      const rightKey = right.text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
      return (priority.get(leftKey) ?? Number.MAX_SAFE_INTEGER) -
        (priority.get(rightKey) ?? Number.MAX_SAFE_INTEGER);
    });
  }

  private passesFinalRequesterSupportingLedgerGuard(
    context: IdeaGenerationContext,
    evidenceText: string,
  ): boolean {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription || !evidenceText.trim()) return false;

    const strict = RequestEvidenceAlignmentUtil.classifyForRequest({
      requestDescription,
      evidenceText,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
    const fallback = RequestEvidenceAlignmentUtil.classifyForRequestFallback({
      requestDescription,
      evidenceText,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
    const atomic = RequestEvidenceAlignmentUtil.passesAtomicSupportingProblemGuard({
      requestDescription,
      evidenceText,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
    const painAware =
      RequestEvidenceAlignmentUtil.passesPostAiPainAwareEvidenceGuard({
        requestDescription,
        evidenceText,
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
      });
    const canonical = CanonicalProblemFamilyUtil.resolve({
      profile: context.collectionPlan?.problemProfile,
      evidenceText,
      providerFamily: null,
    });

    const intent = RequestWorkflowIntentProfileUtil.resolve(requestDescription);
    if (!painAware) {
      return false;
    }
    if (context.collectionPlan?.problemProfile && !canonical) {
      return false;
    }
    if (intent.family === 'RESTORATION_CONSERVATION') {
      /* Restoration evidence must preserve both object identity and a concrete
       * requester-owned facet. Same-workflow foreign objects never qualify. */
      return Boolean(canonical) && atomic;
    }

    if (canonical && canonical.evidenceOverlap >= 2 && (atomic || painAware)) {
      return true;
    }
    if (
      canonical &&
      (strict !== 'UNRELATED' || fallback !== 'UNRELATED') &&
      (atomic || painAware)
    ) {
      return true;
    }
    if (
      !context.collectionPlan?.problemProfile &&
      (strict !== 'UNRELATED' || fallback !== 'UNRELATED') &&
      painAware
    ) {
      return true;
    }
    return false;
  }

  private mergeQualifiedRequesterSupportingEvidence(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
    verifiedSupportingEvidence: readonly IndependentEvidence[],
  ): IdeaOpportunityRanking {
    const verifiedExternal = verifiedSupportingEvidence.filter(
      (item) =>
        item.evidenceKind !== 'UNKNOWN' &&
        item.evidenceKind !== 'SPECIFICATION',
    );
    if (verifiedExternal.length === 0) return ranking;

    const supportingSourceType = (
      item: IndependentEvidence,
    ):
      | 'COMMUNITY_EVIDENCE'
      | 'SECONDARY_EVIDENCE'
      | 'TECHNICAL_EVIDENCE' => {
      if (item.evidenceKind === 'TECHNICAL_TICKET') return 'TECHNICAL_EVIDENCE';
      if (
        item.evidenceKind === 'DIRECT_USER_COMPLAINT' ||
        item.evidenceKind === 'USER_COMPLAINT' ||
        item.evidenceKind === 'USER_QUESTION' ||
        item.evidenceKind === 'FEATURE_REQUEST' ||
        item.evidenceKind === 'REVIEW'
      ) {
        return 'COMMUNITY_EVIDENCE';
      }
      return 'SECONDARY_EVIDENCE';
    };

    const existingSupporting = (ranking.selected.supportingEvidence ?? []).filter(
      (item) =>
        item.sourceType === 'REQUESTER_STATEMENT' ||
        item.sourceType === 'REQUESTER_DOMAIN_SELECTION' ||
        item.sourceType === 'PERSONALIZATION_SIGNAL' ||
        this.passesFinalRequesterSupportingLedgerGuard(context, item.text),
    );
    const supportingEntries = verifiedExternal.map((item) => ({
      sourceType: supportingSourceType(item),
      text: item.text,
      /*
       * SUPPORTING_SIGNAL is corroboration, not proof that the full requester
       * problem recurs. Preserve provenance without promoting it to direct
       * community-demand evidence.
       */
      qualifiesAsCommunityEvidence: false,
    }));
    const seenSupporting = new Set<string>();
    const supportingEvidence = [...supportingEntries, ...existingSupporting].filter(
      (item) => {
        const normalized = item.text.replace(/\s+/gu, ' ').trim().toLowerCase();
        if (!normalized) return false;
        const key = normalized;
        if (seenSupporting.has(key)) return false;
        seenSupporting.add(key);
        return true;
      },
    );

    const mergedIndependentEvidence: IndependentEvidence[] = [];
    const seenIndependent = new Set<string>();
    for (const item of [
      ...(ranking.selected.independentEvidence ?? []).filter((item) =>
        this.passesFinalRequesterSupportingLedgerGuard(context, item.text),
      ),
      ...verifiedExternal,
    ]) {
      const provenanceKey = [
        item.sourceKey.trim().toLocaleLowerCase(),
        item.postExternalId.trim(),
        item.commentExternalId?.trim() ?? '',
      ].join(':');
      const textKey = item.text
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase();
      const key = provenanceKey.replace(/:+$/u, '') || item.identityKey || textKey;
      const semanticKey = `${item.sourceKey.trim().toLocaleLowerCase()}:${textKey}`;
      if (seenIndependent.has(key) || seenIndependent.has(semanticKey)) continue;
      seenIndependent.add(key);
      seenIndependent.add(semanticKey);
      mergedIndependentEvidence.push(item);
    }

    const mergedExternal = mergedIndependentEvidence.filter(
      (item) =>
        item.evidenceKind !== 'UNKNOWN' &&
        item.evidenceKind !== 'SPECIFICATION',
    );
    const distinctSourceCount = new Set(
      mergedExternal.map((item) => item.sourceKey).filter(Boolean),
    ).size;
    const supportingMatchedDomainNames = [
      ...new Set(
        mergedExternal.flatMap((item) =>
          SelectedDomainEvidenceAlignmentUtil.matchStrictDomainNames(
            item.text,
            context.selectedDomains,
          ),
        ),
      ),
    ];
    const uniqueSupportingEvidenceKeys = new Set(
      mergedExternal.map((item) =>
        [
          item.sourceKey.trim().toLocaleLowerCase(),
          item.postExternalId.trim(),
          item.commentExternalId?.trim() ?? '',
        ].join(':'),
      ),
    );
    const supportingCount = uniqueSupportingEvidenceKeys.size;
    const evidenceSamples = [...new Set([
      ...mergedExternal.map((item) => item.text.replace(/\s+/gu, ' ').trim()),
      ...ranking.selected.evidenceSamples,
    ])].filter(Boolean).slice(0, 8);
    const selected = ranking.selected;
    const secondaryCount = mergedExternal.filter((item) =>
      ['SECONDARY_REPORT', 'EDITORIAL_ANALYSIS', 'NEWS_REPORT'].includes(
        item.evidenceKind,
      ),
    ).length;
    /*
     * SUPPORTING_ONLY is a first-class preliminary grounding state. It does
     * not establish recurrence and it never upgrades supporting material to
     * DIRECT_PROBLEM, but one provenance-verified requester-aligned external
     * signal is enough to select a bounded evidence-supported pilot instead of
     * collapsing back to a zero-evidence requester hypothesis.
     */
    const disqualificationReasons = [...selected.disqualificationReasons];
    const preliminarySupportingEligible =
      Boolean(context.requestDescription?.trim()) && supportingCount > 0;
    const selectionEligible =
      selected.selectionEligible || preliminarySupportingEligible;
    /*
     * Contextual/secondary support has its own qualified counters below.
     * It must never inflate the verified-demand scores that are derived from
     * `qualifiesAsCommunityEvidence=true` or other directly verified evidence.
     */
    const evidenceReliabilityScore = selected.evidenceReliabilityScore;
    const supportScore = selected.supportScore;
    const evidenceScore = selected.evidenceScore;
    const baseScore = selected.baseScore;
    const finalScore = selected.finalScore;
    const raw =
      selected.raw && typeof selected.raw === 'object' && !Array.isArray(selected.raw)
        ? ({
            ...(selected.raw as Prisma.JsonObject),
            source: 'REQUESTER_PROBLEM_WITH_VERIFIED_SUPPORTING_EVIDENCE',
            qualifiedExternalSupportingEvidenceCount: supportingCount,
            qualifiedExternalSupportingSourceCount: distinctSourceCount,
            externalSupportingEvidenceScope: 'SUPPORTING_SIGNAL',
            canonicalProblemSource: 'REQUEST_DESCRIPTION',
            evidenceGroundingMode:
              supportingCount > 0
                ? 'SUPPORTING_ONLY'
                : 'UNVALIDATED',
          } as Prisma.JsonObject)
        : selected.raw;

    return {
      ...ranking,
      selected: {
        ...selected,
        evidenceSamples,
        frequency: selected.frequency,
        frequencyScore: selected.frequencyScore,
        evidenceScore,
        evidenceReliabilityScore,
        weakEvidencePenalty: selected.weakEvidencePenalty,
        supportScore,
        baseScore,
        finalScore,
        selectionEligible,
        disqualificationReasons,
        supportingEvidence,
        independentEvidence: mergedIndependentEvidence,
        qualifiedExternalSupportingEvidenceCount: supportingCount,
        qualifiedExternalSupportingSourceCount: distinctSourceCount,
        verifiedEvidenceCount: Math.max(
          selected.verifiedEvidenceCount ?? 0,
          mergedExternal.length,
        ),
        verifiedSecondaryEvidenceCount: Math.max(
          selected.verifiedSecondaryEvidenceCount ?? 0,
          secondaryCount,
        ),
        /*
         * Problem-matched/trusted counters remain untouched. The contextual
         * secondary ledger is exposed only through qualifiedExternalSupporting*
         * and verifiedSecondaryEvidenceCount.
         */
        verifiedProblemMatchedEvidenceCount:
          selected.verifiedProblemMatchedEvidenceCount ?? 0,
        verifiedProblemMatchedSecondaryEvidenceCount:
          selected.verifiedProblemMatchedSecondaryEvidenceCount ?? 0,
        verifiedEvidenceSourceCount: Math.max(
          selected.verifiedEvidenceSourceCount ?? 0,
          distinctSourceCount,
        ),
        verifiedProblemMatchedEvidenceSourceCount: Math.max(
          selected.verifiedProblemMatchedEvidenceSourceCount ?? 0,
          distinctSourceCount,
        ),
        matchedDomainNames: [
          ...new Set([
            ...(selected.matchedDomainNames ?? []),
            ...supportingMatchedDomainNames,
          ]),
        ],
        problemDomainNames: [
          ...new Set([
            ...(selected.problemDomainNames ?? []),
            ...supportingMatchedDomainNames,
          ]),
        ],
        raw:
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? ({
                ...(raw as Prisma.JsonObject),
                supportingEvidenceDomainNames: supportingMatchedDomainNames,
                supportingEvidenceDomainCount: supportingMatchedDomainNames.length,
              } as Prisma.JsonObject)
            : raw,
      },
      evidenceCoverage: Math.max(
        ranking.evidenceCoverage,
        Math.min(1, supportingCount / 6),
      ),
      selectionReason:
        `Selected the requester-described workflow as the canonical problem scope with ${supportingCount} provenance-verified external SUPPORTING_SIGNAL item(s) across ${distinctSourceCount} distinct source(s). ` +
        (selectionEligible
          ? 'The opportunity is evidence-grounded for pilot selection, while recurrence and market-wide prevalence remain unproven without verified direct-user evidence.'
          : 'The supporting evidence is retained and visible, but remains below the grounded-selection threshold; recurrence and market-wide prevalence remain unproven.'),
      qualityWarnings: [
        ...ranking.qualityWarnings.filter(
          (warning) =>
            !/No sufficiently request-aligned direct community problem was established/iu.test(
              warning,
            ) &&
            !/No opportunity reached the strict minimum score/iu.test(warning) &&
            !/No opportunity passed the strict selection gate/iu.test(warning) &&
            !/supported by one real external sample/iu.test(warning),
        ),
        `No verified direct-user complaint establishes recurrence; ${supportingCount} external supporting signal(s) across ${distinctSourceCount} source(s) ground only the supported facets of the requester-defined workflow.`,
      ],
    };
  }

  private async verifyExternalSupportingEvidenceFallback(
    context: IdeaGenerationContext,
    evidence: readonly RecoveredExternalEvidence[],
  ): Promise<IdeaOpportunityRanking | null> {
    const supportingFallback =
      this.buildExternalSupportingEvidenceFallbackRanking(context, evidence);
    if (!supportingFallback) return null;

    const recoveryProvenanceHints: EvidenceProvenanceHint[] = evidence.map(
      (item) => ({
        text: item.text,
        sourceKey: item.sourceKey,
        postExternalId: item.postExternalId,
        commentExternalId: item.commentExternalId,
      }),
    );
    const verified = this.enforceEvidenceNarrativeConsistency(
      this.opportunityRankingService.reconcileVerifiedDomainAttribution(
        await this.independentEvidenceVerificationService.verifyRanking(
          supportingFallback,
          this.resolveEvidenceCollectionJobIds(context),
          [
            ...this.buildEvidenceProvenanceHints(context),
            ...recoveryProvenanceHints,
          ],
        ),
        context.selectedDomains.map((domain) => ({
          name: domain.name,
          keywords: domain.effectiveSearchKeywords ?? domain.keywords,
        })),
      ),
    );
    const aligned = this.applyRequestIntentAlignment(verified, context);
    return this.hasUsableExternalEvidence(aligned.selected) ? aligned : null;
  }

  /**
   * Normalizes a verified external fallback through the same problem-family
   * matcher used by ranking and evidence verification. This prevents a real
   * retained signal from bypassing semantic classification merely because it
   * entered through EXTERNAL_SUPPORTING_CONTEXT_FALLBACK.
   */
  private resolveExternalFallbackFamilySemantics(
    evidenceText: string,
    domainLabel: string,
  ): {
    readonly familyKey: string;
    readonly problem: string;
    readonly title: string;
    readonly need: string;
    readonly solutionArea: string;
  } | null {
    const family = resolvePrimaryProblemFamily(evidenceText);
    if (!family || family.key.startsWith('lexical:')) {
      return null;
    }

    switch (family.key) {
      case 'ai-feedback-correction-inflexibility':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Users in ${domainLabel} need a traceable correction loop that preserves prompt/output context, captures corrective feedback, compares revised outputs, and shows whether the identified mistake was addressed before reuse.`,
          solutionArea:
            'AI Feedback Capture, Correction Replay, Revision Comparison, and Human-Reviewed Output Recovery',
        };
      case 'ai-hallucination-output-reliability':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Users in ${domainLabel} need a traceable way to capture hallucinated or unsupported AI outputs, preserve prompt/model context, verify factuality and sources, and route uncertain results to human review before they are trusted or reused.`,
          solutionArea:
            'AI Hallucination Detection, Factuality Verification, and Human-Reviewed Output Reliability',
        };
      case 'legal-compliance-risk':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Teams in ${domainLabel} need a structured way to identify legal, compliance, licensing, privacy, consent, and rights risks in the retained workflow before content or operational decisions are approved.`,
          solutionArea:
            'Legal and Compliance Risk Review, Rights Verification, and Human-Reviewed Remediation',
        };
      case 'knowledge-resource-indexing':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Teams in ${domainLabel} need a searchable and reviewable resource foundation that inventories retained documents and research assets, preserves provenance and metadata, and makes approved material easy to find and reuse.`,
          solutionArea:
            'Knowledge Resource Inventory, Indexing, Metadata Review, Citation Governance, and Search',
        };
      case 'workforce-capacity':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Organizations in ${domainLabel} need a clearer way to track workforce loss, staffing capacity, critical-role coverage, workload redistribution, and service-continuity risk before staffing gaps become operational failures.`,
          solutionArea:
            'Workforce Capacity, Critical-Role Coverage, and Service Continuity Planning',
        };
      case 'blockchain-transaction-execution':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Teams in ${domainLabel} need a traceable way to diagnose reverted or failed blockchain transactions from provider errors, contract execution context, logs, gas estimation, and retry outcomes before remediation is approved.`,
          solutionArea:
            'Blockchain Transaction Failure Diagnosis, Revert Analysis, and Human-Reviewed Recovery',
        };
      case 'identity-wallet-authentication-integration':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Government identity systems in ${domainLabel} need native verifier-side support for OID4VP-compatible digital identity wallets so users can authenticate with verified credentials such as PID or electronic attestations.`,
          solutionArea:
            'OID4VP Identity Wallet Verifier Integration and Credential Authentication',
        };
      case 'authentication':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Users in ${domainLabel} need reliable diagnosis and recovery for login, authentication, verification, session, identity-provider, and account-state failures without weakening access controls.`,
          solutionArea:
            'Authentication, Account Access, and Human-Reviewed Recovery',
        };
      case 'regional-feature-access':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Users in ${domainLabel} need transparent region-aware feature availability, clear explanations when a capability is unavailable in their area, and supported alternative access paths that do not bypass host-platform restrictions.`,
          solutionArea:
            'Region-Aware Feature Availability, Supported Access Alternatives, and User Guidance',
        };
      case 'device-sync':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `Teams in ${domainLabel} need reliable data freshness, synchronization-state diagnostics, retry handling, and verification when local or remote records become stale or fail to synchronize.`,
          solutionArea:
            'Data Synchronization, Freshness Diagnostics, and Recovery',
        };
      case 'calendar-event-visibility':
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            'Calendar users and maintainers need a traceable way to control recurring-event inclusion, verify omitted or duplicated public-holiday entries, preserve feed provenance, and review exceptions before publishing or reusing a calendar feed.',
          solutionArea:
            'Calendar Feed Parsing, Recurring-Event Inclusion Rules, Holiday Visibility Verification, and Human-Reviewed Exceptions',
        };
      default:
        return {
          familyKey: family.key,
          problem: family.label,
          title: family.label,
          need:
            `A focused ${domainLabel} workflow should address the verified ${family.label.toLocaleLowerCase()} signal while preserving the retained evidence as the validation baseline and keeping broader prevalence claims preliminary.`,
          solutionArea: `${family.label} Response and Human-Reviewed Resolution`,
        };
    }
  }

  private buildExternalSupportingEvidenceFallbackRanking(
    context: IdeaGenerationContext,
    additionalExternalEvidence: readonly RecoveredExternalEvidence[] = [],
  ): IdeaOpportunityRanking | null {
    const selectedDomainNames = new Set(
      context.selectedDomains
        .map((domain) => domain.name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const requestDescription = context.requestDescription?.trim() ?? '';
    const domainDescriptors = context.selectedDomains.map((domain) => ({
      name: domain.name,
      keywords: domain.keywords,
      effectiveSearchKeywords: domain.effectiveSearchKeywords,
    }));
    const domainEntries = context.domainEvidence
      .filter(
        (entry) =>
          selectedDomainNames.size === 0 ||
          selectedDomainNames.has(entry.domainName.trim().toLocaleLowerCase()),
      )
      .flatMap((entry) => [
        ...this.readDomainEvidenceEntries(entry.sampleComments).map((sample) => ({
          ...sample,
          domainName: entry.domainName,
          profileDomainName: entry.domainName,
          matchedDomainNames: SelectedDomainEvidenceAlignmentUtil.matchDomainNames(
            sample.text,
            domainDescriptors,
          ),
          sourceKind: 'COMMENT' as const,
        })),
        ...this.readDomainEvidenceEntries(entry.samplePosts).map((sample) => ({
          ...sample,
          domainName: entry.domainName,
          profileDomainName: entry.domainName,
          matchedDomainNames: SelectedDomainEvidenceAlignmentUtil.matchDomainNames(
            sample.text,
            domainDescriptors,
          ),
          sourceKind: 'POST' as const,
        })),
      ]);
    const recoveryEntries = additionalExternalEvidence
      .map((evidence) => {
        const text = evidence.text.replace(/\s+/gu, ' ').trim();
        const matchedDomainNames = SelectedDomainEvidenceAlignmentUtil.matchStrictDomainNames(
          text,
          domainDescriptors,
        );
        return {
          id:
            evidence.commentExternalId
              ? `${evidence.sourceKey}:comment:${evidence.commentExternalId}`
              : `${evidence.sourceKey}:post:${evidence.postExternalId}`,
          text,
          semanticTriageVerified: true,
          domainName:
            matchedDomainNames[0] ??
            context.domainName?.trim() ??
            context.selectedDomains[0]?.name?.trim() ??
            'Selected domain',
          matchedDomainNames,
          sourceKind: evidence.sourceType,
          sourceKey: evidence.sourceKey,
          postExternalId: evidence.postExternalId,
          commentExternalId: evidence.commentExternalId,
        };
      })
      .filter((entry) => entry.text.length >= 20);

    const entries = [...domainEntries, ...recoveryEntries]
      .map((entry) => {
        const text = entry.text.replace(/\s+/gu, ' ').trim();
        const body = text.replace(/^.*?\bCommunity comment:\s*/isu, '').trim();
        const evidenceKind = classifyDirectCommunityEvidence(
          body,
          entry.sourceKind,
        );
        const sourceKey =
          'sourceKey' in entry && typeof entry.sourceKey === 'string'
            ? entry.sourceKey.toLocaleLowerCase()
            : this.readSourceKeyFromEvidenceId(entry.id).toLocaleLowerCase();
        const directSignal = this.isDirectCommunityProvenance({
          sourceKey,
          sourceKind: entry.sourceKind,
          evidenceKind,
        });
        const problemSignal = this.looksLikeDirectProblemEvidence(body);
        const requestAligned = requestDescription
          ? RequestEvidenceAlignmentUtil.isAligned({
              requestDescription,
              evidenceText: text,
              plannedQueries: context.collectionPlan?.searchQueries ?? [],
            })
          : false;
        const requestAlignment = requestDescription
          ? this.calculateExternalSampleIntentAlignment(text, requestDescription)
          : 0.5;
        const semanticTriageVerified =
          'semanticTriageVerified' in entry && entry.semanticTriageVerified === true;
        const workflowAdjacent = Boolean(
          requestDescription &&
            !requestAligned &&
            ((semanticTriageVerified &&
              RequestEvidenceAlignmentUtil.passesAiEvidenceAdmissionGuard({
                requestDescription,
                evidenceText: text,
                plannedQueries: context.collectionPlan?.searchQueries ?? [],
              })) ||
              (requestAlignment >= 0.28 && problemSignal)),
        );
        const secondaryOperationalSignal =
          /^(?:news|gdelt|blog|crossref)$/u.test(sourceKey) &&
          /\b(?:reported|reports?|study|survey|operators?|facilities?|restaurants?|kennels?|boarding|cost|costs|margin|margins|profit|profits|waste|missed|missing|error|errors|problem|problems|delay|delayed|failure|failures|rising|increasing|declining|complaints?|struggle|difficult)\w*\b/iu.test(
            text,
          );
        const semanticDomainText =
          entry.sourceKind === 'COMMENT' ? body : text;
        const semanticMatches = SelectedDomainEvidenceAlignmentUtil.matchDomainNames(
          semanticDomainText,
          domainDescriptors,
        );
        const matchedDomainNames = [...new Set(semanticMatches)];
        const domainAligned =
          selectedDomainNames.size === 0 || matchedDomainNames.length > 0;
        const sourceQualityBonus = /^(?:news|gdelt|youtube|forum|blog|crossref|app-store|google-play)$/u.test(
          sourceKey,
        )
          ? 0.75
          : 0;
        const score =
          (requestAligned ? 8 : 0) +
          (workflowAdjacent ? 4 : 0) +
          requestAlignment * 5 +
          matchedDomainNames.length * 3 +
          (directSignal ? 7 : 0) +
          (problemSignal ? 3 : 0) +
          (secondaryOperationalSignal ? 4 : 0) +
          (entry.sourceKind === 'COMMENT' ? 1.5 : 0.5) +
          sourceQualityBonus;
        return {
          ...entry,
          text,
          body,
          evidenceKind,
          directSignal,
          problemSignal,
          secondaryOperationalSignal,
          requestAligned,
          requestAlignment,
          workflowAdjacent,
          semanticTriageVerified,
          sourceKey,
          matchedDomainNames,
          domainAligned,
          score,
        };
      })
      .filter((entry) => entry.text.length >= 20)
      .filter(
        (entry) =>
          entry.directSignal ||
          entry.problemSignal ||
          entry.secondaryOperationalSignal ||
          (entry.semanticTriageVerified && entry.workflowAdjacent),
      )
      .filter((entry) =>
        requestDescription
          ? entry.requestAligned ||
            (entry.semanticTriageVerified && entry.workflowAdjacent)
          : entry.domainAligned,
      )
      .sort((left, right) => right.score - left.score);

    const strongest = entries[0];
    if (!strongest) return null;
    const retainedEntries = entries.slice(0, Math.min(8, entries.length));

    const exactRequestEvidence = Boolean(
      requestDescription && strongest.requestAligned,
    );
    const workflowAdjacentEvidence = Boolean(
      requestDescription && !exactRequestEvidence && strongest.workflowAdjacent,
    );
    const evidenceMatchedDomains = [
      ...new Set(
        retainedEntries.flatMap((entry) =>
          entry.matchedDomainNames.length ? entry.matchedDomainNames : [entry.domainName],
        ),
      ),
    ];
    const domainLabel = evidenceMatchedDomains.join(' + ');
    const familySemantics = this.resolveExternalFallbackFamilySemantics(
      strongest.body,
      domainLabel,
    );
    /*
     * With requester text, evidence may corroborate one or many facets but is
     * never allowed to rename, narrow, or replace the canonical problem.
     */
    const problem = requestDescription ||
      familySemantics?.problem ||
      strongest.body.slice(0, 360).trim();
    const title = requestDescription
      ? 'Requester-Defined Workflow with Verified External Evidence'
      : familySemantics?.title ?? `${strongest.domainName} Evidence-Grounded Preliminary Opportunity`;
    const need = requestDescription
      ? 'A focused implementation that preserves the complete requester-described workflow while using all retained external signals as complementary preliminary support. The pilot must validate the unproven mechanisms and prevalence without substituting a narrower evidence title for the requester problem.'
      : familySemantics?.need ?? `A focused implementation that addresses the retained ${domainLabel} problem signal without overstating what the evidence proves.`;
    const solutionArea = requestDescription
      ? 'Requester-Defined Workflow Implementation with Multi-Source Evidence Validation'
      : familySemantics?.solutionArea ??
        'Evidence-grounded workflow implementation with explicit preliminary-pilot validation.';
    const supportingEvidence = [
      ...retainedEntries.map((entry) => ({
        sourceType: entry.directSignal
          ? ('COMMUNITY_EVIDENCE' as const)
          : ('SECONDARY_EVIDENCE' as const),
        text: entry.text,
        qualifiesAsCommunityEvidence: entry.directSignal,
      })),
      ...(requestDescription
        ? [
            {
              sourceType: 'REQUESTER_STATEMENT' as const,
              text: requestDescription,
              qualifiesAsCommunityEvidence: false,
            },
          ]
        : []),
    ];

    return {
      selected: {
        rank: 1,
        title,
        problem,
        need,
        solutionArea,
        evidenceType: 'OPPORTUNITY',
        sourceIndex: 0,
        frequency: 1,
        severity: 'MEDIUM',
        evidenceSamples: retainedEntries.map((entry) => entry.text),
        frequencyScore: 0.2,
        severityScore: 0.6,
        evidenceScore: 0.16,
        evidenceReliabilityScore: strongest.directSignal
          ? 0.62
          : strongest.secondaryOperationalSignal
            ? 0.56
            : 0.46,
        weakEvidencePenalty: 0.12,
        specificityScore: exactRequestEvidence ? 0.92 : workflowAdjacentEvidence ? 0.84 : 0.78,
        feasibilityScore: 0.88,
        localRelevanceScore: 0.25,
        noveltyScore: 0.55,
        businessValueScore: 0.5,
        marketGapScore: 0.5,
        competitionScore: 0.5,
        technicalRiskScore: 0.32,
        supportScore: strongest.directSignal
          ? 0.48
          : strongest.secondaryOperationalSignal
            ? 0.42
            : 0.34,
        nlpConfidenceScore: context.nlp?.confidence ?? 0.2,
        baseScore: 0.34,
        confidencePenalty: 0.1,
        finalScore: exactRequestEvidence ? 0.32 : 0.29,
        matchedDomainNames: evidenceMatchedDomains,
        problemDomainNames: evidenceMatchedDomains,
        primaryMatchedDomainName: evidenceMatchedDomains[0] ?? strongest.domainName,
        domainRelevanceScores: Object.fromEntries(
          context.selectedDomains.map((domain) => [
            domain.name,
            evidenceMatchedDomains.some(
              (name) => name.toLocaleLowerCase() === domain.name.toLocaleLowerCase(),
            )
              ? 0.82
              : 0,
          ]),
        ),
        selectionEligible: false,
        disqualificationReasons: [
          'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
        ],
        qualifiedExternalSupportingEvidenceCount: retainedEntries.length,
        qualifiedExternalSupportingSourceCount: new Set(
          retainedEntries.map((entry) => entry.sourceKey).filter(Boolean),
        ).size,
        verifiedIndependentEvidenceCount: 0,
        verifiedIndependentSourceCount: 0,
        independentEvidence: [],
        requestIntentAlignmentScore: requestDescription
          ? strongest.requestAlignment
          : undefined,
        requestIntentAdjustedScore: requestDescription
          ? Math.max(0.2, strongest.requestAlignment * 0.5)
          : undefined,
        requestIntentSupportTier: exactRequestEvidence
          ? 'FULL_REQUEST_MATCH'
          : workflowAdjacentEvidence
            ? 'PARTIAL_REQUEST_SUPPORT'
            : requestDescription
              ? 'DOMAIN_SUPPORTED_FALLBACK'
              : undefined,
        supportingEvidence,
        raw: {
          source: 'EXTERNAL_SUPPORTING_CONTEXT_FALLBACK',
          ...(familySemantics ? { familyKey: familySemantics.familyKey } : {}),
          evidenceScope: exactRequestEvidence
            ? 'REQUEST_MATCHED'
            : workflowAdjacentEvidence
              ? 'WORKFLOW_ADJACENT'
              : 'SELECTED_DOMAIN_FALLBACK',
          semanticTriageVerified: strongest.semanticTriageVerified,
          domainName: evidenceMatchedDomains[0] ?? strongest.domainName,
          domainNames: evidenceMatchedDomains,
          title,
          problem,
          unmetNeed: need,
          solutionArea,
          requestDescription: requestDescription || null,
          evidenceSamples: retainedEntries.map((entry) => entry.text),
          supportingEvidence,
          externalSourceKey: strongest.sourceKey || null,
          externalEvidenceStrength: strongest.directSignal
            ? 'PRELIMINARY_DIRECT_SIGNAL'
            : 'PRELIMINARY_EXTERNAL_REPORT',
          evidenceMatchedDomainNames: evidenceMatchedDomains,
        } as unknown as Prisma.JsonValue,
      },
      alternatives: [],
      evaluatedCount: Math.max(1, entries.length),
      evidenceCoverage: 1 / 3,
      selectionReason: requestDescription
        ? `Selected the requester-defined workflow unchanged and retained ${retainedEntries.length} external supporting item(s) across ${new Set(retainedEntries.map((entry) => entry.sourceKey).filter(Boolean)).size} source(s) as complementary preliminary evidence. No single evidence item is allowed to redefine the requester problem.`
        : `Selected ${retainedEntries.length} real external problem signal(s) from the evidence-backed domain lane (${domainLabel}) without fabricating recurrence.`,
      qualityWarnings: [
        `The selected direction is supported by ${retainedEntries.length} retained external item(s) across ${new Set(retainedEntries.map((entry) => entry.sourceKey).filter(Boolean)).size} source(s) and must remain preliminary until direct recurrence is validated.`,
        ...(workflowAdjacentEvidence
          ? [
              "The retained external evidence is workflow-adjacent rather than proof of the requester's exact vertical. It may justify a validation-first design pattern but not a prevalence or demand claim for the requester domain.",
            ]
          : !exactRequestEvidence && requestDescription
            ? [
                'The evidence supports a selected/inferred domain problem rather than every detail of the requester description. The final idea must not claim that the full requester workflow was externally proven.',
              ]
            : []),
      ],
    };
  }

  private readDomainEvidenceEntries(
    value: Prisma.JsonValue | null,
  ): Array<{ readonly id: string; readonly text: string }> {
    if (!Array.isArray(value)) return [];

    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const object = entry as Prisma.JsonObject;
        const text = typeof object.text === 'string' ? object.text.trim() : '';
        const id = typeof object.id === 'string' ? object.id.trim() : '';
        return text ? { id, text } : null;
      })
      .filter(
        (entry): entry is { readonly id: string; readonly text: string } =>
          Boolean(entry),
      );
  }

  private readSourceKeyFromEvidenceId(value: string): string {
    const normalized = value.trim().toLocaleLowerCase();
    const separator = normalized.indexOf(':');
    return separator > 0 ? normalized.slice(0, separator) : '';
  }

  private calculateExternalSampleIntentAlignment(
    sample: string,
    description: string,
  ): number {
    const sampleText = this.normalizeIntentText(sample);
    const requestText = this.normalizeIntentText(description);
    const requestTokens = this.extractIntentTokens(requestText);
    const sampleTokens = this.extractIntentTokens(sampleText);
    if (requestTokens.size === 0 || sampleTokens.size === 0) return 0;

    const lexicalMatches = [...requestTokens].filter((token) =>
      sampleTokens.has(token),
    ).length;
    const lexicalScore = lexicalMatches / requestTokens.size;
    const conceptGroups = this.resolveIntentConceptGroups(requestText);
    const conceptMatches = conceptGroups.filter((group) =>
      group.some((term) => sampleText.includes(term)),
    ).length;
    const conceptScore = conceptGroups.length
      ? conceptMatches / conceptGroups.length
      : lexicalScore;

    return Math.max(0, Math.min(1, lexicalScore * 0.35 + conceptScore * 0.65));
  }

  private buildGroundedCommunityFallbackRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking | null {
    const analysis = context.communityAiAnalysis;

    if (!analysis) {
      return null;
    }

    const selectedDomainNames = new Set(
      context.selectedDomains
        .map((domain) => domain.name.trim().toLowerCase())
        .filter(Boolean),
    );
    if (selectedDomainNames.size === 0 && context.domainName?.trim()) {
      selectedDomainNames.add(context.domainName.trim().toLowerCase());
    }

    const candidates = analysis.opportunities
      .filter((opportunity) => {
        const evidenceSamples = opportunity.evidenceSamples
          .map((sample) => sample.replace(/\s+/gu, ' ').trim())
          .filter(Boolean);
        const domainMatches =
          selectedDomainNames.size === 0 ||
          selectedDomainNames.has(opportunity.domainName.trim().toLowerCase());

        return (
          domainMatches &&
          evidenceSamples.length > 0 &&
          opportunity.groundingScore >= 50
        );
      })
      .sort(
        (first, second) =>
          second.groundingScore - first.groundingScore ||
          second.confidence - first.confidence ||
          second.problemImportance - first.problemImportance,
      );

    const opportunity = candidates[0];

    if (!opportunity) {
      return null;
    }

    const evidenceSamples = opportunity.evidenceSamples
      .map((sample) => sample.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, 3);
    const confidence = Math.max(0, Math.min(1, opportunity.confidence / 100));
    const grounding = Math.max(
      0,
      Math.min(1, opportunity.groundingScore / 100),
    );
    const evidenceScore = Math.min(1, evidenceSamples.length / 5);
    const reliability = Number(
      Math.max(0.7, grounding * 0.8 + confidence * 0.2).toFixed(4),
    );
    const supportScore = Number(
      Math.min(1, reliability * 0.7 + evidenceScore * 0.3).toFixed(4),
    );
    const baseScore = Number(
      Math.min(
        1,
        supportScore * 0.4 +
          (opportunity.problemImportance / 100) * 0.25 +
          (opportunity.technicalFeasibility / 100) * 0.2 +
          (opportunity.innovationPotential / 100) * 0.15,
      ).toFixed(4),
    );
    const weakEvidencePenalty = evidenceSamples.length === 1 ? 0.08 : 0.04;
    const finalScore = Number(
      Math.max(0, baseScore - weakEvidencePenalty).toFixed(4),
    );

    return {
      selected: {
        rank: 1,
        title: opportunity.title,
        problem: opportunity.problem,
        need: opportunity.unmetNeed,
        solutionArea: opportunity.solutionArea,
        evidenceType: 'OPPORTUNITY',
        sourceIndex: 0,
        frequency: evidenceSamples.length,
        severity: opportunity.severity,
        evidenceSamples,
        frequencyScore: Math.min(1, evidenceSamples.length / 5),
        severityScore:
          opportunity.severity === 'CRITICAL'
            ? 1
            : opportunity.severity === 'HIGH'
              ? 0.85
              : opportunity.severity === 'MEDIUM'
                ? 0.6
                : 0.35,
        evidenceScore,
        evidenceReliabilityScore: reliability,
        weakEvidencePenalty,
        specificityScore: 0.82,
        feasibilityScore: opportunity.technicalFeasibility / 100,
        localRelevanceScore: opportunity.localEvidenceAvailable
          ? opportunity.localRelevance / 100
          : 0.25,
        noveltyScore: opportunity.innovationPotential / 100,
        businessValueScore: opportunity.marketPotential / 100,
        marketGapScore: Math.max(0.4, opportunity.marketPotential / 100 - 0.1),
        competitionScore: 0.5,
        technicalRiskScore: 1 - opportunity.technicalFeasibility / 100,
        supportScore,
        nlpConfidenceScore: context.nlp?.confidence ?? confidence,
        baseScore,
        confidencePenalty: Number(((1 - confidence) * 0.08).toFixed(4)),
        finalScore,
        matchedDomainNames: [opportunity.domainName],
        domainRelevanceScores: { [opportunity.domainName]: 1 },
        selectionEligible: false,
        disqualificationReasons: [
          'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
        ],
        verifiedIndependentEvidenceCount: 0,
        verifiedIndependentSourceCount: 0,
        independentEvidence: [],
        raw: {
          ...opportunity,
          source: 'COMMUNITY_AI_ANALYSIS',
        } as unknown as Prisma.JsonValue,
      },
      alternatives: [],
      evaluatedCount: analysis.opportunities.length,
      evidenceCoverage: Number(
        Math.min(1, evidenceSamples.length / 3).toFixed(4),
      ),
      selectionReason:
        `Recovered schema-validated grounded Community AI opportunity "${opportunity.title}" after generic NLP normalization produced no direct-evidence ranking. Independent recurrence verification remains required.`,
      qualityWarnings: [
        `The recovered candidate entered independent verification with ${evidenceSamples.length} retained evidence sample(s); the final verified evidence class and count control all downstream prevalence and demand claims.`,
        'The requested location remains a pilot deployment target unless direct local evidence is independently verified.',
      ],
    };
  }

  /**
   * Resolves every collection job that may contain evidence for this run.
   *
   * The primary collection identifier is nested under context.collection.
   * Recovery identifiers are stored separately. The resulting list excludes
   * missing values and duplicate identifiers before evidence verification.
   */
  private resolveEvidenceCollectionJobIds(
    context: IdeaGenerationContext,
  ): string[] {
    const collectionJobIds = [
      context.collection?.collectionJobId,
      ...context.domainEvidence.map((entry) => entry.collectionJobId),
      ...context.evidenceRecoveryCollectionJobIds,
    ];

    return Array.from(
      new Set(
        collectionJobIds.filter(
          (collectionJobId): collectionJobId is string =>
            typeof collectionJobId === 'string' &&
            collectionJobId.trim().length > 0,
        ),
      ),
    );
  }

  /**
   * Builds a last-resort, auditable pilot opportunity when NLP completed but
   * normalization produced no rankable candidate. This prevents a user-facing
   * "completed without an idea" result while keeping every claim explicitly
   * preliminary and tied to the requested domain.
   */
  private buildEmergencyFallbackRanking(
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    return this.buildPrimaryDomainHypothesisRanking(context);
  }

  private hasEligibleOpportunity(ranking: IdeaOpportunityRanking): boolean {
    return [ranking.selected, ...ranking.alternatives].some(
      (opportunity) => opportunity.selectionEligible,
    );
  }

  /**
   * Requests one bounded recovery pass when the winner is technically eligible
   * but still lacks enough representative evidence for a defensible idea.
   */
  private requiresEvidenceRecovery(ranking: IdeaOpportunityRanking): boolean {
    const selected = ranking.selected;
    const directEvidenceCount = Math.max(
      selected.evidenceSamples.length,
      selected.independentEvidence?.length ?? 0,
      selected.verifiedProblemMatchedDirectUserEvidenceCount ??
        selected.verifiedIndependentEvidenceCount ??
        0,
    );
    const independentSourceCount = Math.max(
      selected.verifiedProblemMatchedSourceCount ??
        selected.verifiedIndependentSourceCount ??
        0,
      new Set(
        (selected.independentEvidence ?? [])
          .map((evidence) => evidence.sourceKey)
          .filter(Boolean),
      ).size,
    );

    /*
     * Recovery is justified only for a sparse winning cluster: zero/one direct
     * sample or evidence coming from a single independent source. A cluster with
     * multiple reports across multiple sources is already useful and must not
     * pay the 20-30 second recovery penalty.
     */
    return directEvidenceCount <= 1 || independentSourceCount <= 1;
  }

  private synchronizeCanonicalEvidenceState(
    context: IdeaGenerationContext,
  ): IdeaGenerationContext {
    const state = CanonicalEvidenceStateUtil.compute(context.canonicalEvidenceLedger ?? []);
    const classifications = (context.canonicalEvidenceLedger ?? []).map((item) => ({
      evidenceId: item.id,
      classification: item.classification,
      confidence: item.confidence,
      reason: 'Canonical evidence ledger classification after deterministic verification.',
      problemFamily: item.problemFamily,
      verifiedByDeterministicGuard: item.verified,
    }));
    const communityAiAnalysis = context.communityAiAnalysis
      ? {
          ...context.communityAiAnalysis,
          evidenceClassifications: classifications,
        }
      : null;

    const insights = Array.isArray(context.nlp?.insights)
      ? context.nlp!.insights.map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
          const record = entry as Record<string, unknown>;
          if (record.type !== 'COMMUNITY_AI_ANALYSIS') return entry;
          return {
            ...record,
            evidenceClassifications: classifications,
            /*
             * Every public/debug counter is recomputed from the merged
             * canonical stores after recovery. Never keep the first-pass raw
             * count beside post-recovery classifications.
             */
            rawEvidenceCandidateCount: context.rawEvidenceCorpus?.length ?? 0,
            triageEligibleEvidenceCount: context.rawEvidenceCorpus?.length ?? 0,
            trustedNlpEvidenceCount: state.trustedCount,
            directEvidenceClassificationCount: state.directCount,
            supportingEvidenceClassificationCount: state.supportingCount,
            contextOnlyEvidenceClassificationCount: (context.canonicalEvidenceLedger ?? []).filter(
              (item) => item.classification === 'CONTEXT_ONLY',
            ).length,
            unrelatedEvidenceClassificationCount: (context.canonicalEvidenceLedger ?? []).filter(
              (item) => item.classification === 'UNRELATED',
            ).length,
          } as Prisma.JsonObject;
        })
      : context.nlp?.insights ?? null;

    return {
      ...context,
      evidenceState: state.state,
      communityAiAnalysis,
      nlp: context.nlp ? { ...context.nlp, insights } : context.nlp,
    };
  }

  private buildSuccessResult(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
    recoveryApplied: boolean,
    recoveryMetadata: {
      readonly collectionJobId: string;
      readonly selectedDataSourceKeys: readonly string[];
      readonly recoveryKeywords: readonly string[];
      readonly totalPosts: number;
      readonly totalComments: number;
      readonly usefulCleanTextCount: number;
      readonly complaintEvidenceCount: number;
      readonly evidenceFamilies: readonly string[];
      readonly communityAiRecoveryApplied: boolean;
      readonly communityAiRecoveryExecuted: boolean;
      readonly newCorpusEvidenceSampleCount: number;
      readonly selectedOpportunityNewEvidenceCount: number;
      /** Backward-compatible corpus-level alias. */
      readonly newEvidenceSampleCount: number;
      readonly recoveryOutcome: EvidenceRecoveryOutcome;
      readonly recoveredExternalEvidenceSampleCount?: number;
      readonly verifiedRecoveredEvidenceCount?: number;
      readonly rejectedRecoveredEvidenceCount?: number;
    } | null,
  ): IdeaGenerationStageExecutionResult {
    const synchronizedContext = this.synchronizeCanonicalEvidenceState(context);
    const intentAlignedRanking = this.applyRequestIntentAlignment(ranking, synchronizedContext);
    const provenanceNormalizedRanking =
      this.independentEvidenceVerificationService.normalizeVerifiedRankingProvenance(
        intentAlignedRanking,
      );
    const normalizedRanking = this.normalizeFinalRankingWarnings(
      this.normalizeFinalRankingEvidenceCoverage(
        this.normalizeFinalOpportunityOrdering(provenanceNormalizedRanking),
        synchronizedContext,
      ),
    );
    const winnerDomain = this.resolveWinnerPrimaryDomain(
      synchronizedContext,
      normalizedRanking,
    );
    const winnerContext: IdeaGenerationContext = winnerDomain
      ? {
          ...synchronizedContext,
          domainId: winnerDomain.id,
          domainName: winnerDomain.name,
        }
      : synchronizedContext;
    const synchronizedDomainEvidence = this.synchronizeSelectedOpportunityEvidence(
      winnerContext,
      normalizedRanking,
    );

    const updatedContext: IdeaGenerationContext = {
      ...winnerContext,
      domainEvidence: synchronizedDomainEvidence,
      opportunityRanking: normalizedRanking,
      // A previous checkpoint or retry must never keep a stale terminal
      // no-result marker once this stage has selected a controlled fallback.
      noResultOutcome: null,
    };

    return {
      context: updatedContext,
      resultPreview: normalizedRanking.selected.selectionEligible
        ? recoveryApplied
          ? `Targeted evidence recovery completed; ranked ${normalizedRanking.evaluatedCount} candidate(s) and selected opportunity "${normalizedRanking.selected.title}" with score ${(normalizedRanking.selected.finalScore * 100).toFixed(1)}.`
          : `Ranked ${ranking.evaluatedCount} opportunity candidate(s); selected opportunity "${normalizedRanking.selected.title}" with score ${(normalizedRanking.selected.finalScore * 100).toFixed(1)}. ${normalizedRanking.selectionReason}`
        : recoveryApplied
          ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot after targeted evidence recovery. Idea generation will continue, while sparse-evidence claims remain explicitly qualified.`
          : Math.max(
                normalizedRanking.selected.evidenceSamples.length,
                normalizedRanking.selected.independentEvidence?.length ?? 0,
                normalizedRanking.selected.verifiedProblemMatchedEvidenceCount ??
                  normalizedRanking.selected.verifiedEvidenceCount ??
                  0,
              ) > 0
            ? (normalizedRanking.selected.verifiedProblemMatchedDirectUserEvidenceCount ??
                normalizedRanking.selected.verifiedDirectUserEvidenceCount ??
                normalizedRanking.selected.verifiedIndependentEvidenceCount ??
                0) > 0
              ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained direct-user evidence. The evidence is insufficient for independent recurrence, so claims remain explicitly qualified.`
              : (normalizedRanking.selected.verifiedProblemMatchedSecondaryEvidenceCount ??
                  normalizedRanking.selected.verifiedSecondaryEvidenceCount ??
                  0) > 0
                ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained secondary evidence. No verified direct user complaint establishes recurrence, so claims remain explicitly qualified.`
                : (normalizedRanking.selected.verifiedProblemMatchedTechnicalEvidenceCount ??
                    normalizedRanking.selected.verifiedTechnicalEvidenceCount ??
                    0) > 0
                  ? `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained technical evidence. No verified direct user complaint establishes recurrence, so claims remain explicitly qualified.`
                  : `Selected the strongest available domain-aligned signal "${normalizedRanking.selected.title}" as a controlled preliminary pilot from retained evidence. No verified direct user complaint establishes recurrence, so claims remain explicitly qualified.`
            : `Selected a controlled primary-domain validation hypothesis "${normalizedRanking.selected.title}" because no problem-matched retained evidence was verified. The generated idea must remain explicitly unvalidated.`,
      metadata: {
        selectedTitle: normalizedRanking.selected.title,
        selectedScore: normalizedRanking.selected.finalScore,
        selectedEligible: normalizedRanking.selected.selectionEligible,
        matchedDomainNames: normalizedRanking.selected.matchedDomainNames ?? [],
        problemDomainNames: normalizedRanking.selected.problemDomainNames ?? [],
        workflowDomainNames: normalizedRanking.selected.workflowDomainNames ?? [],
        primaryMatchedDomainName:
          normalizedRanking.selected.primaryMatchedDomainName ?? null,
        evidenceRecoveryApplied: recoveryApplied,
        evidenceRecoveryAttempts: updatedContext.evidenceRecoveryAttempts,
        evidenceRecovery: recoveryMetadata,
        shortlistedOpportunities: [
          normalizedRanking.selected,
          ...normalizedRanking.alternatives.slice(0, 4),
        ].map((opportunity) => ({
          rank: opportunity.rank,
          title: opportunity.title,
          score: opportunity.finalScore,
          baseScore: opportunity.baseScore,
          supportScore: opportunity.supportScore,
          evidenceReliabilityScore: opportunity.evidenceReliabilityScore,
          nlpConfidenceScore: opportunity.nlpConfidenceScore,
          confidencePenalty: opportunity.confidencePenalty,
          selectionEligible: opportunity.selectionEligible,
          matchedDomainNames: opportunity.matchedDomainNames ?? [],
          problemDomainNames: opportunity.problemDomainNames ?? [],
          workflowDomainNames: opportunity.workflowDomainNames ?? [],
          primaryMatchedDomainName: opportunity.primaryMatchedDomainName ?? null,
          domainRelevanceScores: opportunity.domainRelevanceScores ?? {},
          problemDomainRelevanceScores:
            opportunity.problemDomainRelevanceScores ?? {},
          workflowDomainRelevanceScores:
            opportunity.workflowDomainRelevanceScores ?? {},
          disqualificationReasons: opportunity.disqualificationReasons,
        })),
        selectionReason: normalizedRanking.selectionReason,
        evidenceCoverage: normalizedRanking.evidenceCoverage,
        evaluatedCount: normalizedRanking.evaluatedCount,
        qualityWarnings: [...normalizedRanking.qualityWarnings],
      },
    };
  }

  /**
   * Removes stale pre-verification fallback warnings once independent evidence
   * verification has promoted the selected candidate to an eligible, traceable
   * preliminary opportunity. The numeric score is intentionally left untouched:
   * one verified report can justify a pilot while still being below recurrence
   * and market-confidence thresholds.
   */
  private applyRequestIntentAlignment(
    ranking: IdeaOpportunityRanking,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const description = context.requestDescription?.trim();
    if (!description) return ranking;

    /*
     * Intent is a selection gate, not merely another small ranking weight.
     * A strongly evidenced login/authentication problem must not become the
     * primary result for a request about student homework when its alignment is
     * effectively zero. The lower band remains usable as a preliminary,
     * explicitly warned fallback so sparse data does not turn into FAILED.
     */
    const normalizedDescription = this.normalizeIntentText(description);
    const intentConceptCount =
      this.resolveIntentConceptGroups(normalizedDescription).length;
    const STRONG_INTENT_ALIGNMENT =
      intentConceptCount >= 3 ? 0.58 : intentConceptCount === 2 ? 0.52 : 0.45;
    const PRELIMINARY_INTENT_ALIGNMENT =
      intentConceptCount >= 3 ? 0.46 : intentConceptCount === 2 ? 0.36 : 0.28;
    const originalCandidates = [ranking.selected, ...ranking.alternatives];
    const explicitDomainNames = new Set(
      context.selectedDomains
        .filter((domain) => domain.isExplicitlySelected)
        .map((domain) => domain.name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const textPlusDomains = explicitDomainNames.size > 0;

    const scored = originalCandidates.map((candidate) => {
      const rawCandidate =
        candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
          ? (candidate.raw as Prisma.JsonObject)
          : null;
      const rawSource =
        rawCandidate && typeof rawCandidate.source === 'string'
          ? rawCandidate.source
          : null;
      const rawRequestDescription =
        rawCandidate && typeof rawCandidate.requestDescription === 'string'
          ? rawCandidate.requestDescription.trim()
          : '';
      if (rawCandidate?.requestIntentAlignmentApplied === true) {
        return candidate;
      }
      const isCanonicalRequesterHypothesis =
        rawSource === 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS' &&
        rawRequestDescription.length > 0 &&
        this.normalizeIntentText(rawRequestDescription) === normalizedDescription;
      const alignment = isCanonicalRequesterHypothesis
        ? 1
        : this.calculateRequestIntentAlignment(candidate, description);
      const adjusted = Math.max(
        0,
        Math.min(1, candidate.finalScore * 0.72 + alignment * 0.28),
      );
      const candidateMatchedDomains = new Set(
        (candidate.matchedDomainNames ?? [])
          .map((name) => name.trim().toLocaleLowerCase())
          .filter(Boolean),
      );
      const hasExplicitDomainRelation =
        !textPlusDomains ||
        [...explicitDomainNames].some((name) => candidateMatchedDomains.has(name));
      const isOffSelectedDomain =
        candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') ||
        !hasExplicitDomainRelation;
      const strictWorkflowIdentityRequired =
        RequestEvidenceAlignmentUtil.requiresStrictWorkflowIdentity({
          requestDescription: description,
          plannedQueries: context.collectionPlan?.searchQueries ?? [],
        });
      const externalEvidenceParts = [
        ...candidate.evidenceSamples,
        ...(candidate.independentEvidence ?? []).map((item) => item.text),
        ...(candidate.supportingEvidence ?? [])
          .filter((item) =>
            item.sourceType === 'COMMUNITY_EVIDENCE' ||
            item.sourceType === 'SECONDARY_EVIDENCE' ||
            item.sourceType === 'TECHNICAL_EVIDENCE',
          )
          .map((item) => item.text),
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));
      const candidateEvidenceText = (
        externalEvidenceParts.length > 0
          ? externalEvidenceParts
          : [candidate.title, candidate.problem, candidate.need, candidate.solutionArea]
      ).join(' ');
      const strictWorkflowAligned =
        !strictWorkflowIdentityRequired ||
        isCanonicalRequesterHypothesis ||
        RequestEvidenceAlignmentUtil.isAligned({
          requestDescription: description,
          evidenceText: candidateEvidenceText,
          plannedQueries: context.collectionPlan?.searchQueries ?? [],
        });
      const rawEvidenceScope =
        rawCandidate && typeof rawCandidate.evidenceScope === 'string'
          ? rawCandidate.evidenceScope
          : null;
      const isWorkflowAdjacentRaw = rawEvidenceScope === 'WORKFLOW_ADJACENT';
      const isSemanticallyVerifiedWorkflowAdjacent = Boolean(
        isWorkflowAdjacentRaw &&
          rawCandidate?.semanticTriageVerified === true,
      );
      const isStronglyAligned =
        alignment >= STRONG_INTENT_ALIGNMENT &&
        strictWorkflowAligned &&
        !isWorkflowAdjacentRaw;
      const isPreliminaryAligned =
        isSemanticallyVerifiedWorkflowAdjacent ||
        (alignment >= PRELIMINARY_INTENT_ALIGNMENT && strictWorkflowAligned);
      const requestIntentSupportTier = isStronglyAligned
        ? 'FULL_REQUEST_MATCH' as const
        : isPreliminaryAligned || alignment >= 0.24
          ? 'PARTIAL_REQUEST_SUPPORT' as const
          : 'WEAK_OR_UNRELATED' as const;
      const disqualificationReasons = [...candidate.disqualificationReasons];

      if (
        textPlusDomains &&
        !hasExplicitDomainRelation &&
        !disqualificationReasons.includes('EXPLICIT_DOMAIN_SCOPE_MISMATCH')
      ) {
        disqualificationReasons.push('EXPLICIT_DOMAIN_SCOPE_MISMATCH');
      }

      if (!isStronglyAligned && !disqualificationReasons.includes('WEAK_REQUEST_INTENT_ALIGNMENT')) {
        disqualificationReasons.push('WEAK_REQUEST_INTENT_ALIGNMENT');
      }
      if (!isPreliminaryAligned && !disqualificationReasons.includes('REQUEST_INTENT_MISMATCH')) {
        disqualificationReasons.push('REQUEST_INTENT_MISMATCH');
      }

      const verifiedProblemMatchedEvidenceCount = Math.max(
        candidate.verifiedProblemMatchedEvidenceCount ?? 0,
        candidate.verifiedDirectUserEvidenceCount ?? 0,
        candidate.verifiedFeatureRequestEvidenceCount ?? 0,
      );
      const qualifiedExternalSupportingEvidenceCount =
        candidate.qualifiedExternalSupportingEvidenceCount ?? 0;
      const evidenceBackedPartialEligible =
        !isOffSelectedDomain &&
        isPreliminaryAligned &&
        (verifiedProblemMatchedEvidenceCount > 0 ||
          qualifiedExternalSupportingEvidenceCount > 0);
      /*
       * Description-bearing paths are problem-first. Partial/adjacent evidence
       * can remain visible as supporting context, but it cannot become the
       * winner merely because it belongs to a selected/inferred domain. Only a
       * strong requester-problem/workflow match may replace the canonical
       * requester hypothesis.
       */
      const selectionEligible =
        candidate.selectionEligible &&
        !isOffSelectedDomain &&
        isStronglyAligned;
      const raw =
        candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
          ? {
              ...(candidate.raw as Prisma.JsonObject),
              requestIntentAlignmentScore: alignment,
              requestIntentAdjustedScore: adjusted,
              requestIntentAlignmentApplied: true,
              requestIntentSupportTier,
              requestIntentSelectionTier: isStronglyAligned
                ? 'STRONG_ALIGNED'
                : evidenceBackedPartialEligible
                  ? 'EVIDENCE_BACKED_PARTIAL'
                  : isPreliminaryAligned
                    ? 'PRELIMINARY_ALIGNED'
                    : 'MISMATCH_FALLBACK_ONLY',
            }
          : candidate.raw;

      return {
        ...candidate,
        finalScore: adjusted,
        requestIntentAlignmentScore: alignment,
        requestIntentAdjustedScore: adjusted,
        requestIntentSupportTier,
        selectionEligible,
        disqualificationReasons,
        raw,
      };
    });

    const strongEligible = scored
      .filter((candidate) => candidate.selectionEligible)
      .sort((left, right) => right.finalScore - left.finalScore);
    const preliminaryAligned = scored
      .filter(
        (candidate) =>
          !candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') &&
          (candidate.requestIntentAlignmentScore ?? 0) >= PRELIMINARY_INTENT_ALIGNMENT,
      )
      .sort((left, right) =>
        (right.requestIntentAlignmentScore ?? 0) -
          (left.requestIntentAlignmentScore ?? 0) ||
        right.finalScore - left.finalScore,
      );

    const partialSupportCandidates = scored.filter(
      (candidate) =>
        !candidate.disqualificationReasons.includes('OFF_SELECTED_DOMAIN') &&
        candidate.requestIntentSupportTier === 'PARTIAL_REQUEST_SUPPORT' &&
        ((candidate.qualifiedExternalSupportingEvidenceCount ?? 0) > 0 ||
          (candidate.verifiedProblemMatchedEvidenceCount ??
            candidate.verifiedEvidenceCount ??
            0) > 0 ||
          (candidate.independentEvidence?.length ?? 0) > 0 ||
          (candidate.supportingEvidence ?? []).some(
            (item) => item.sourceType !== 'REQUESTER_STATEMENT',
          )),
    );

    if (strongEligible.length === 0) {
      /*
       * With an explicit requester description, same-domain evidence is not a
       * substitute for the requested workflow. If nothing reaches the
       * preliminary intent threshold, preserve the requester-defined
       * validation hypothesis and keep unrelated/adjacent evidence diagnostic.
       */
      let fallback = this.buildPrimaryDomainHypothesisRanking(context);
      const verifiedPartialSupportingEvidence = partialSupportCandidates.flatMap(
        (candidate) => candidate.independentEvidence ?? [],
      );
      if (verifiedPartialSupportingEvidence.length > 0) {
        fallback = this.mergeQualifiedRequesterSupportingEvidence(
          context,
          fallback,
          verifiedPartialSupportingEvidence,
        );
      }
      const fallbackIdentity = this.buildOpportunityIdentityKey(fallback.selected);
      const mismatchAlternatives = scored
        .filter(
          (candidate) =>
            this.buildOpportunityIdentityKey(candidate) !== fallbackIdentity,
        )
        .sort(
          (left, right) =>
            (right.requestIntentAlignmentScore ?? 0) -
              (left.requestIntentAlignmentScore ?? 0) ||
            right.finalScore - left.finalScore,
        )
        .slice(0, 4)
        .map((candidate, index) => ({ ...candidate, rank: index + 2 }));

      const groundedRequesterFallback =
        fallback.selected.selectionEligible &&
        (fallback.selected.qualifiedExternalSupportingEvidenceCount ?? 0) > 0;
      return {
        ...fallback,
        alternatives: mismatchAlternatives,
        evaluatedCount: Math.max(fallback.evaluatedCount, ranking.evaluatedCount),
        qualityWarnings: [
          ...(groundedRequesterFallback
            ? [
                `${fallback.selected.qualifiedExternalSupportingEvidenceCount ?? 0} provenance-verified external supporting signal(s) ground the requester-defined workflow for pilot selection. They prioritize supported facets without proving recurrence or market-wide prevalence.`,
              ]
            : partialSupportCandidates.length > 0
              ? [
                  `${partialSupportCandidates.length} evidence-backed candidate(s) support part of the requester-described workflow. Their provenance-verified external signals are attached to the primary requester-defined problem as supporting context, but they do not replace it or establish direct recurrence.`,
                ]
              : preliminaryAligned.length > 0
                ? [
                    `No external evidence-backed partial candidate survived verification for the requester workflow. ${preliminaryAligned.length} preliminary semantic candidate(s) were retained only as diagnostics and do not count as community evidence.`,
                  ]
                : [
                    `The collected evidence was stronger for problems that did not materially match the requester description "${description}". Those candidates were retained only as fallback diagnostics and were not allowed to become the primary idea.`,
                  ]),
          ...fallback.qualityWarnings,
        ],
        selectionReason: groundedRequesterFallback
          ? `The strongest retained evidence supports part of the requester description "${description}". The pipeline selected the canonical requester problem with verified supporting evidence and will generate from its most-evidenced facet while keeping unsupported facets explicitly provisional.`
          : `No retained evidence candidate passed the strong requester-intent gate for "${description}". The pipeline preserved the requester-defined problem as the primary validation direction and kept partial evidence only as supporting context.`,
      };
    }

    const winner = strongEligible[0];
    const explicitPrimaryDomain =
      context.domainResolution?.source === 'USER_SELECTED'
        ? context.domainResolution.selectedDomain.name.trim()
        : '';
    const winnerClaimDomains = new Set(
      (winner.matchedDomainNames ?? [])
        .map((name) => name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );

    if (
      explicitPrimaryDomain &&
      context.selectedDomains.length <= 1 &&
      !winnerClaimDomains.has(explicitPrimaryDomain.toLocaleLowerCase())
    ) {
      const fallback = this.buildPrimaryDomainHypothesisRanking(context);
      const fallbackIdentity = this.buildOpportunityIdentityKey(fallback.selected);
      const diagnosticAlternatives = scored
        .filter(
          (candidate) =>
            this.buildOpportunityIdentityKey(candidate) !== fallbackIdentity,
        )
        .sort((left, right) => right.finalScore - left.finalScore)
        .slice(0, 4)
        .map((candidate, index) => ({ ...candidate, rank: index + 2 }));

      return {
        ...fallback,
        alternatives: diagnosticAlternatives,
        evaluatedCount: Math.max(fallback.evaluatedCount, ranking.evaluatedCount),
        qualityWarnings: [
          `The strongest request-aligned evidence did not include the explicitly selected domain "${explicitPrimaryDomain}". The final direction therefore remains a cross-domain validation hypothesis instead of silently dropping the user's selected domain or inventing unsupported cross-domain evidence.`,
          ...fallback.qualityWarnings,
        ],
        selectionReason: `The requester explicitly selected "${explicitPrimaryDomain}" and supplied a description whose strongest retained evidence pointed elsewhere. Because no verified coherent bundle connected both sides, the pipeline preserved both as a cross-domain validation scope rather than ignoring either input.`,
      };
    }

    const ordered = [winner, ...scored.filter((candidate) => candidate !== winner)]
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    const isPreliminaryWinner =
      winner.requestIntentSupportTier === 'PARTIAL_REQUEST_SUPPORT';
    const changed = winner.title !== ranking.selected.title;

    return {
      ...ranking,
      selected: ordered[0],
      alternatives: ordered.slice(1),
      selectionReason: isPreliminaryWinner
        ? `No candidate passed the strong requester-intent gate. Selected the best weak-but-aligned preliminary opportunity for "${description}" instead of promoting an unrelated high-evidence problem.`
        : changed
          ? `Selected the strongest evidence-backed opportunity that also passed the requester-intent gate for: ${description}`
          : ranking.selectionReason,
      qualityWarnings: [
        ...(isPreliminaryWinner
          ? [
              'The selected direction is only weakly aligned to the explicit requester intent and must be presented as a preliminary validation candidate.',
            ]
          : []),
        ...(changed
          ? [
              `Requester-intent gating changed the preferred opportunity from "${ranking.selected.title}" to "${winner.title}".`,
            ]
          : []),
        ...ranking.qualityWarnings,
      ],
    };
  }

  /**
   * Makes the final shortlist deterministic and removes semantic duplicates.
   * The canonical requester-defined validation hypothesis used to be re-added
   * as an alternative after intent reranking, which could even leave an
   * alternative with a higher score than the selected copy. Identity is based
   * on the original requester description for validation hypotheses and on a
   * normalized semantic tuple for normal evidence-backed candidates.
   */
  private normalizeFinalOpportunityOrdering(
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    const selectedIdentity = this.buildOpportunityIdentityKey(ranking.selected);
    const seen = new Set<string>([selectedIdentity]);
    const alternatives = [...ranking.alternatives]
      .filter((candidate) => {
        const identity = this.buildOpportunityIdentityKey(candidate);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .sort(
        (left, right) =>
          Number(right.selectionEligible) - Number(left.selectionEligible) ||
          right.finalScore - left.finalScore ||
          (right.requestIntentAlignmentScore ?? 0) -
            (left.requestIntentAlignmentScore ?? 0),
      )
      .map((candidate, index) => ({ ...candidate, rank: index + 2 }));

    return {
      ...ranking,
      selected: { ...ranking.selected, rank: 1 },
      alternatives,
    };
  }

  private buildOpportunityIdentityKey(
    candidate: RankedIdeaOpportunity,
  ): string {
    const raw =
      candidate.raw &&
      typeof candidate.raw === 'object' &&
      !Array.isArray(candidate.raw)
        ? (candidate.raw as Prisma.JsonObject)
        : null;
    const rawSource = typeof raw?.source === 'string' ? raw.source : '';
    const rawRequestDescription =
      typeof raw?.requestDescription === 'string'
        ? raw.requestDescription.trim()
        : '';

    if (
      rawSource === 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS' &&
      rawRequestDescription
    ) {
      return `requester:${this.normalizeIntentText(rawRequestDescription)}`;
    }

    const title = this.normalizeIntentText(candidate.title);
    const problem = this.normalizeIntentText(candidate.problem ?? '');
    const need = this.normalizeIntentText(candidate.need ?? '');
    const solutionArea = this.normalizeIntentText(candidate.solutionArea ?? '');
    return `semantic:${title}|${problem}|${need}|${solutionArea}`;
  }

  private isDirectCommunityProvenance(input: {
    readonly sourceKey: string;
    readonly sourceKind: 'POST' | 'COMMENT';
    readonly evidenceKind: ReturnType<typeof classifyDirectCommunityEvidence>;
  }): boolean {
    const directKind =
      input.evidenceKind === 'USER_COMPLAINT' ||
      input.evidenceKind === 'FEATURE_REQUEST' ||
      input.evidenceKind === 'OBSERVED_UNMET_NEED';
    if (!directKind) return false;
    if (input.sourceKind === 'COMMENT') return true;

    return new Set([
      'forum',
      'reddit',
      'hacker-news',
      'app-store',
      'google-play',
    ]).has(input.sourceKey);
  }

  private calculateRequestIntentAlignment(
    candidate: IdeaOpportunityRanking['selected'],
    description: string,
  ): number {
    const externalEvidenceParts = [
      ...candidate.evidenceSamples,
      ...(candidate.independentEvidence ?? []).map((item) => item.text),
      ...(candidate.supportingEvidence ?? [])
        .filter((item) =>
          item.sourceType === 'COMMUNITY_EVIDENCE' ||
          item.sourceType === 'SECONDARY_EVIDENCE' ||
          item.sourceType === 'TECHNICAL_EVIDENCE',
        )
        .map((item) => item.text),
      ...(candidate.relatedOpportunityBundle ?? []).flatMap((item) =>
        item.evidenceSamples,
      ),
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    const candidateText = this.normalizeIntentText(
      (
        externalEvidenceParts.length > 0
          ? externalEvidenceParts
          : [
              candidate.title,
              candidate.problem ?? '',
              candidate.need ?? '',
              candidate.solutionArea ?? '',
            ]
      ).join(' '),
    );
    const requestText = this.normalizeIntentText(description);
    const requestTokens = this.extractIntentTokens(requestText);
    const candidateTokens = this.extractIntentTokens(candidateText);
    const lexicalMatches = [...requestTokens].filter((token) =>
      candidateTokens.has(token),
    ).length;
    const lexicalScore =
      requestTokens.size > 0 ? lexicalMatches / requestTokens.size : 0.5;

    const conceptGroups = this.resolveIntentConceptGroups(requestText);
    const matchedConceptCount = conceptGroups.filter((group) =>
      group.some((term) => candidateText.includes(term)),
    ).length;
    const conceptScore =
      conceptGroups.length > 0
        ? matchedConceptCount / conceptGroups.length
        : lexicalScore;

    const rawAlignment = Math.max(
      0,
      Math.min(1, lexicalScore * 0.3 + conceptScore * 0.7),
    );
    const requiredAnchors = this.resolveRequiredIntentAnchors(requestText);
    const missingRequiredAnchor = requiredAnchors.some(
      (group) => !group.some((term) => candidateText.includes(term)),
    );

    const hasMaterialPartialSupport =
      missingRequiredAnchor &&
      conceptGroups.length >= 2 &&
      matchedConceptCount >= 2 &&
      conceptScore >= 0.5;

    const strictProblemEvidenceMatch = candidate.evidenceSamples.some(
      (sample) =>
        RequestEvidenceAlignmentUtil.isAligned({
          requestDescription: description,
          evidenceText: sample,
        }),
    );

    /*
     * External evidence proves the requester-described problem, not every
     * implementation mechanism mentioned in the request. If a retained sample
     * passes the strict request/evidence matcher, missing solution-mechanism
     * tokens (AI, IoT, data integration, forecasting, etc.) must not collapse
     * alignment. Explicit domains remain enforced later as solution constraints.
     */
    const strictEvidenceFloor = strictProblemEvidenceMatch ? 0.74 : 0;
    const lexicalAlignment = missingRequiredAnchor
      ? Math.min(rawAlignment, hasMaterialPartialSupport ? 0.44 : 0.12)
      : rawAlignment;

    return Math.max(lexicalAlignment, strictEvidenceFloor);
  }

  private resolveRequiredIntentAnchors(requestText: string): readonly string[][] {
    const anchors: string[][] = [];

    if (/\b(?:homework|assignment|coursework|worksheet|schoolwork)\b/u.test(requestText)) {
      anchors.push([
        'homework',
        'assignment',
        'coursework',
        'worksheet',
        'schoolwork',
        'submit',
        'submission',
        'due date',
        'grading',
        'grade',
      ]);
    }

    if (/\b(?:login|log in|sign in|signin|authentication|authenticate|oauth|password|account access)\b/u.test(requestText)) {
      anchors.push([
        'login',
        'log in',
        'sign in',
        'signin',
        'authentication',
        'authenticate',
        'oauth',
        'password',
        'account access',
      ]);
    }

    if (
      /\b(?:cybersecurity|cyber security|security|unauthorized access|unauthorised access|data breach|security breach|suspicious activity|security alert|threat|attack|incident response|malware|ransomware|phishing|vulnerability|credential|access control)\b/u.test(
        requestText,
      )
    ) {
      anchors.push([
        'cybersecurity',
        'cyber security',
        'security',
        'unauthorized access',
        'unauthorised access',
        'data breach',
        'security breach',
        'suspicious activity',
        'security alert',
        'threat',
        'attack',
        'incident response',
        'malware',
        'ransomware',
        'phishing',
        'vulnerability',
        'credential',
        'access control',
        'authentication',
        'privacy',
      ]);
    }

    if (
      /\b(?:employee account activity|employee accounts?|employee role changes?|role changes?|access permissions?|access rights?|privilege creep|least privilege|identity lifecycle|account lifecycle|internal system usage)\b/u.test(requestText)
    ) {
      anchors.push([
        'employee',
        'employees',
        'staff',
        'workforce',
        'employee account',
        'employee accounts',
        'role change',
        'role changes',
        'access permission',
        'access permissions',
        'access rights',
        'privilege creep',
        'least privilege',
        'identity lifecycle',
        'account lifecycle',
      ]);
      anchors.push([
        'suspicious activity',
        'compromised account',
        'account compromise',
        'unauthorized access',
        'unauthorised access',
        'security alert',
        'security alerts',
        'access drift',
        'excessive privilege',
        'excessive privileges',
      ]);
    }

    if (
      /\b(?:human resources|\bhr\b|recruitment|recruiting|hiring|talent acquisition|candidate|applicant|employee onboarding|burnout|turnover|retention|workload|employee feedback)\b/u.test(
        requestText,
      ) ||
      (/\b(?:employee|employees|workforce|staff)\b/u.test(requestText) &&
        /\b(?:burnout|turnover|retention|workload|wellbeing|well being|engagement|performance review|staffing shortage|recruitment|hiring|onboarding)\b/u.test(
          requestText,
        ))
    ) {
      anchors.push([
        'human resources',
        'hr',
        'employee',
        'employees',
        'workforce',
        'staff',
        'recruitment',
        'hiring',
        'burnout',
        'turnover',
        'retention',
        'workload',
        'wellbeing',
        'well being',
        'engagement',
        'onboarding',
      ]);
    }

    if (/\b(?:recruitment|recruiting|hiring|candidate|candidates|applicant|applicants|talent acquisition)\b/u.test(requestText)) {
      anchors.push([
        'recruitment',
        'recruiting',
        'hiring',
        'candidate',
        'candidates',
        'applicant',
        'applicants',
        'talent acquisition',
      ]);
    }

    if (/\b(?:expense|expenses|cost|costs|spending|budget|waste|wasted|financial|finance)\b/u.test(requestText)) {
      anchors.push([
        'expense',
        'expenses',
        'cost',
        'costs',
        'spending',
        'budget',
        'waste',
        'wasted',
        'financial',
        'finance',
        'money',
      ]);
    }

    if (/\b(?:administrative|administration|admin work|paperwork|back office|repetitive task|repetitive tasks)\b/u.test(requestText)) {
      anchors.push([
        'administrative',
        'administration',
        'admin',
        'paperwork',
        'back office',
        'repetitive task',
        'repetitive tasks',
        'automation',
      ]);
    }

    if (/\b(?:detect|identify|early|emerging|analyze|analyse|analytics|insight|insights|scattered|fragmented|feedback|records|data)\b/u.test(requestText)) {
      anchors.push([
        'detect',
        'detection',
        'identify',
        'early',
        'emerging',
        'analyze',
        'analyse',
        'analytics',
        'insight',
        'insights',
        'feedback',
        'record',
        'records',
        'data',
        'trend',
        'warning',
        'anomaly',
      ]);
    }

    if (
      /\b(?:tailor|tailoring|custom clothing|custom apparel|bespoke clothing|bespoke tailoring|garment|made to measure)\b/u.test(
        requestText,
      )
    ) {
      anchors.push([
        'tailor',
        'tailoring',
        'custom clothing',
        'custom apparel',
        'bespoke',
        'garment',
        'made to measure',
      ]);
    }

    return anchors;
  }

  private resolveIntentConceptGroups(requestText: string): readonly string[][] {
    const groups: string[][] = [];
    const definitions: readonly { readonly trigger: RegExp; readonly terms: readonly string[] }[] = [
      {
        trigger: /\b(?:homework|assignment|coursework|worksheet|schoolwork)\b/u,
        terms: ['homework', 'assignment', 'coursework', 'worksheet', 'schoolwork', 'submit', 'submission', 'due', 'feedback', 'grade'],
      },
      {
        trigger: /\b(?:student|students|school|teacher|education|learning|classroom|course|lesson)\b/u,
        terms: ['student', 'students', 'school', 'teacher', 'education', 'learning', 'classroom', 'course', 'lesson', 'assignment', 'homework'],
      },
      {
        trigger: /\b(?:login|log in|sign in|signin|authentication|authenticate|oauth|password|account access)\b/u,
        terms: ['login', 'log in', 'sign in', 'signin', 'authentication', 'authenticate', 'oauth', 'password', 'account access'],
      },
      {
        trigger: /\b(?:cybersecurity|cyber security|security|unauthorized access|unauthorised access|data breach|security breach|suspicious activity|security alert|threat|attack|incident response|malware|ransomware|phishing|vulnerability|credential|access control)\b/u,
        terms: [
          'cybersecurity',
          'cyber security',
          'security',
          'unauthorized access',
          'unauthorised access',
          'data breach',
          'security breach',
          'suspicious activity',
          'security alert',
          'threat',
          'attack',
          'incident response',
          'malware',
          'ransomware',
          'phishing',
          'vulnerability',
          'credential',
          'access control',
          'authentication',
          'privacy',
        ],
      },
      {
        trigger: /\b(?:admin|administration|administrative|back office|operations?)\b/u,
        terms: ['admin', 'administration', 'administrative', 'back office', 'operations', 'approval', 'workflow', 'paperwork'],
      },
      {
        trigger: /\b(?:financ|financial|accounting|budget|expense|invoice|payroll|procurement|reconcil|cash flow|payment)\w*\b/u,
        terms: ['finance', 'financial', 'accounting', 'budget', 'expense', 'invoice', 'payroll', 'procurement', 'reconciliation', 'cash flow', 'payment'],
      },
      {
        trigger: /\b(?:employee account activity|employee accounts?|employee role changes?|role changes?|access permissions?|access rights?|privilege creep|least privilege|identity lifecycle|account lifecycle|internal system usage)\b/u,
        terms: ['employee', 'employees', 'staff', 'workforce', 'employee account', 'role change', 'role changes', 'access permission', 'access permissions', 'access rights', 'privilege creep', 'least privilege', 'identity lifecycle', 'account lifecycle', 'internal system usage'],
      },
      {
        trigger: /\b(?:suspicious account activity|suspicious activity|compromised account|account compromise|unauthorized access|unauthorised access|access drift|excessive privileges?)\b/u,
        terms: ['suspicious account activity', 'suspicious activity', 'compromised account', 'account compromise', 'unauthorized access', 'unauthorised access', 'access drift', 'excessive privilege', 'excessive privileges', 'security alert', 'incident investigation'],
      },
      {
        trigger: /\b(?:human resources|\bhr\b|recruitment|recruiting|hiring|talent acquisition|candidate|applicant|employee onboarding|burnout|turnover|retention|workload|employee feedback)\b/u,
        terms: ['human resources', 'hr', 'employee', 'employees', 'workforce', 'staff', 'recruitment', 'hiring', 'candidate', 'applicant', 'burnout', 'turnover', 'retention', 'workload', 'wellbeing', 'onboarding'],
      },
      {
        trigger: /\b(?:recruitment|recruiting|hiring|candidate|candidates|applicant|applicants|talent acquisition)\b/u,
        terms: ['recruitment', 'recruiting', 'hiring', 'candidate', 'candidates', 'applicant', 'applicants', 'talent acquisition'],
      },
      {
        trigger: /\b(?:cost|costs|expense|expenses|spending|waste|wasted|budget)\b/u,
        terms: ['cost', 'costs', 'expense', 'expenses', 'spending', 'waste', 'wasted', 'budget', 'money'],
      },
      {
        trigger: /\b(?:detect|identify|early|emerging|analyze|analyse|analytics|insight|insights|scattered|fragmented|feedback|records|data)\b/u,
        terms: ['detect', 'detection', 'identify', 'early', 'emerging', 'analyze', 'analyse', 'analytics', 'insight', 'insights', 'feedback', 'record', 'records', 'data', 'trend', 'warning', 'anomaly'],
      },
      {
        trigger: /\b(?:fraud|fraudulent|chargeback|chargebacks|account takeover|account takeovers|payment dispute|payment disputes|false decline|false declines|legitimate purchase|legitimate purchases|suspicious transaction|suspicious transactions)\b/u,
        terms: ['fraud', 'fraudulent', 'chargeback', 'chargebacks', 'account takeover', 'payment dispute', 'false decline', 'legitimate purchase', 'suspicious transaction', 'risk scoring', 'blocked purchase', 'fraud detection'],
      },
      {
        trigger: /\b(?:laundry|laundromat|dry cleaning|dry-cleaning|dry cleaner|garment cleaning|wash and fold)\b/u,
        terms: ['laundry', 'laundromat', 'dry cleaning', 'dry-cleaning', 'dry cleaner', 'garment', 'garments', 'stain', 'cleaning instruction', 'pickup', 'deadline', 'treatment', 'lost garment', 'delayed order', 'paper tag'],
      },
      {
        trigger: /\b(?:tailor|tailoring|custom clothing|custom apparel|bespoke clothing|bespoke tailoring|garment|made to measure)\b/u,
        terms: ['tailor', 'tailoring', 'custom clothing', 'custom apparel', 'bespoke', 'garment', 'made to measure'],
      },
      {
        trigger: /\b(?:measurement|measurements|fabric|alteration|fitting|custom order|clothing order|design notes?)\b/u,
        terms: ['measurement', 'measurements', 'fabric', 'alteration', 'fitting', 'custom order', 'clothing order', 'design note', 'order details'],
      },
      {
        trigger: /\b(?:paper|messages?|previous measurements?|history|historical|returning customers?|recorded|records?)\b/u,
        terms: ['paper', 'message', 'messages', 'previous measurement', 'history', 'historical', 'returning customer', 'record', 'records', 'order details'],
      },
      {
        trigger: /\b(?:mistake|mistakes|repeated fittings?|delay|delayed orders?|follow ups?|poor management)\b/u,
        terms: ['mistake', 'mistakes', 'repeated fitting', 'delay', 'delayed', 'delivery', 'follow up', 'poor management', 'order not ready'],
      },
      {
        trigger: /\b(?:public transportation|public transport|transit|ticketing|fare|passenger app|connected vehicle|vehicle telemetry)\b/u,
        terms: ['public transportation', 'public transport', 'transit', 'ticketing', 'fare', 'fare payment', 'passenger app', 'bus', 'rail', 'metro', 'vehicle telemetry', 'connected vehicle'],
      },
      {
        trigger: /\b(?:glass artist|glass art|stained glass|glassblower|custom commission|design revision|approved version|engraving|glass color)\b/u,
        terms: ['glass artist', 'glass art', 'stained glass', 'glassblower', 'commission', 'custom commission', 'design revision', 'revision', 'approved version', 'engraving', 'dimension', 'material', 'client approval', 'rework'],
      },
      {
        trigger: /\b(?:company|business|organization|organisation|enterprise|department|office|staff|team)\b/u,
        terms: ['company', 'business', 'organization', 'organisation', 'enterprise', 'department', 'office', 'staff', 'team', 'employee'],
      },
    ];

    for (const definition of definitions) {
      if (definition.trigger.test(requestText)) groups.push([...definition.terms]);
    }

    return groups;
  }

  private extractIntentTokens(value: string): Set<string> {
    const stop = new Set([
      'about', 'after', 'before', 'company', 'issue', 'issues', 'problem', 'problems',
      'with', 'from', 'into', 'that', 'this', 'there', 'their', 'have', 'has', 'need',
      'needs', 'want', 'wants', 'software', 'system', 'application', 'platform', 'company',
    ]);
    const aliases = new Map<string, string>([
      ['financial', 'finance'],
      ['finances', 'finance'],
      ['administrative', 'administration'],
      ['admin', 'administration'],
      ['businesses', 'business'],
      ['companies', 'business'],
      ['organisation', 'organization'],
      ['organizations', 'organization'],
      ['students', 'student'],
      ['assignments', 'assignment'],
      ['homeworks', 'homework'],
      ['submissions', 'submission'],
      ['employees', 'employee'],
      ['workers', 'workforce'],
      ['recruiting', 'recruitment'],
      ['recruiters', 'recruitment'],
      ['candidates', 'candidate'],
      ['applicants', 'applicant'],
      ['expenses', 'expense'],
      ['costs', 'cost'],
      ['records', 'record'],
      ['insights', 'insight'],
      ['breaches', 'breach'],
      ['threats', 'threat'],
      ['attacks', 'attack'],
      ['alerts', 'alert'],
      ['incidents', 'incident'],
      ['credentials', 'credential'],
      ['vulnerabilities', 'vulnerability'],
    ]);
    return new Set(
      value
        .split(' ')
        .map((token) => aliases.get(token) ?? token)
        .filter((token) => token.length >= 4 && !stop.has(token)),
    );
  }

  private normalizeIntentText(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private normalizeFinalRankingWarnings(
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    if (!ranking.selected.selectionEligible) {
      return ranking;
    }

    const verifiedDirectCount =
      ranking.selected.verifiedProblemMatchedDirectUserEvidenceCount ??
      ranking.selected.verifiedDirectUserEvidenceCount ??
      ranking.selected.verifiedIndependentEvidenceCount ??
      0;
    const verifiedSecondaryCount =
      ranking.selected.verifiedProblemMatchedSecondaryEvidenceCount ??
      ranking.selected.verifiedSecondaryEvidenceCount ??
      0;
    const verifiedTechnicalCount =
      ranking.selected.verifiedProblemMatchedTechnicalEvidenceCount ??
      ranking.selected.verifiedTechnicalEvidenceCount ??
      0;
    const verifiedFeatureRequestCount =
      ranking.selected.verifiedProblemMatchedFeatureRequestEvidenceCount ??
      ranking.selected.verifiedFeatureRequestEvidenceCount ??
      0;
    const verifiedComplaintCount =
      ranking.selected.verifiedProblemMatchedComplaintEvidenceCount ??
      ranking.selected.verifiedComplaintEvidenceCount ??
      0;
    const featureRequestOnly =
      verifiedDirectCount > 0 &&
      verifiedComplaintCount === 0 &&
      verifiedFeatureRequestCount === verifiedDirectCount;
    const verifiedEvidenceCount =
      ranking.selected.verifiedProblemMatchedEvidenceCount ??
      ranking.selected.verifiedEvidenceCount ??
      verifiedDirectCount + verifiedSecondaryCount;
    if (verifiedEvidenceCount <= 0) {
      return ranking;
    }

    const staleFallbackWarning =
      /^(?:No opportunity reached the strict minimum score|No opportunity passed the strict selection gate|The selected opportunity is supported by .*verified direct community report)/iu;
    const cleanedWarnings = ranking.qualityWarnings.filter(
      (warning) => !staleFallbackWarning.test(warning),
    );

    const preliminaryWarning =
      featureRequestOnly
        ? `The selected opportunity is supported by ${verifiedFeatureRequestCount} verified feature request(s). It is eligible for a preliminary pilot, but feature requests do not by themselves establish complaint recurrence or market-wide prevalence.`
        : verifiedDirectCount === 0 && verifiedSecondaryCount > 0
          ? `The selected opportunity is supported by ${verifiedSecondaryCount} secondary retained report(s) and no verified direct user complaint. It is eligible only for a preliminary pilot; recurrence and market-wide claims remain unproven.`
          : verifiedDirectCount === 0 && verifiedTechnicalCount > 0
            ? `The selected opportunity is supported by ${verifiedTechnicalCount} retained technical issue(s) and no verified direct user complaint. It is eligible only for a preliminary pilot; direct user demand and recurrence remain unproven.`
            : `The selected opportunity is supported by ${verifiedDirectCount} verified direct user report(s). It is eligible for a preliminary pilot, while recurrence and market-wide claims remain unproven.`;

    if (!cleanedWarnings.includes(preliminaryWarning)) {
      cleanedWarnings.unshift(preliminaryWarning);
    }

    return {
      ...ranking,
      qualityWarnings: cleanedWarnings,
    };
  }

  private normalizeFinalRankingEvidenceCoverage(
    ranking: IdeaOpportunityRanking,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const isNoTextNoDomainsPath =
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_PREFERENCE' &&
      context.selectedDomains.length > 0 &&
      context.selectedDomains.every(
        (domain) => domain.isExplicitlySelected !== true,
      );

    if (isNoTextNoDomainsPath) {
      const verifiedProblemEvidenceCount =
        ranking.selected.verifiedProblemMatchedEvidenceCount ??
        ranking.selected.verifiedIndependentEvidenceCount ??
        0;
      const problemDomainNames =
        ranking.selected.problemDomainNames?.filter((name) => name.trim()) ?? [];
      const hasProblemDomain =
        problemDomainNames.length > 0 ||
        Boolean(ranking.selected.primaryMatchedDomainName?.trim());
      const problemEvidenceCoverage =
        verifiedProblemEvidenceCount > 0 && hasProblemDomain ? 1 : 0;

      if (problemEvidenceCoverage === ranking.evidenceCoverage) {
        return ranking;
      }

      return {
        ...ranking,
        evidenceCoverage: problemEvidenceCoverage,
      };
    }

    const retainedEvidenceCount = Math.max(
      ranking.selected.evidenceSamples.length,
      ranking.selected.verifiedProblemMatchedEvidenceCount ??
        ranking.selected.verifiedIndependentEvidenceCount ??
        0,
    );
    const normalizedCoverage = Math.max(
      ranking.evidenceCoverage,
      retainedEvidenceCount > 0
        ? Math.min(1, retainedEvidenceCount / 3)
        : 0,
    );

    if (normalizedCoverage === ranking.evidenceCoverage) {
      return ranking;
    }

    return {
      ...ranking,
      evidenceCoverage: Number(normalizedCoverage.toFixed(4)),
    };
  }

  private resolveWinnerPrimaryDomain(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): { readonly id: string; readonly name: string } | null {
    const matchedNames = ranking.selected.matchedDomainNames ?? [];
    const rawDomainName = this.readCandidateDomainName(ranking.selected.raw);
    const candidateNames = [
      ranking.selected.primaryMatchedDomainName ?? '',
      ...matchedNames,
      rawDomainName,
    ].filter(Boolean);

    for (const candidateName of candidateNames) {
      const normalized = candidateName.trim().toLocaleLowerCase();
      const selected = context.selectedDomains.find(
        (domain) => domain.name.trim().toLocaleLowerCase() === normalized,
      );
      if (selected) {
        return { id: selected.id, name: selected.name };
      }
    }

    const current = context.selectedDomains.find(
      (domain) => domain.id === context.domainId,
    );
    return current
      ? { id: current.id, name: current.name }
      : context.domainId && context.domainName
        ? { id: context.domainId, name: context.domainName }
        : null;
  }

  private synchronizeSelectedOpportunityEvidence(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): IdeaGenerationContext['domainEvidence'] {
    const selectedDomainName = (
      ranking.selected.primaryMatchedDomainName ??
      ranking.selected.matchedDomainNames?.[0] ??
      this.readCandidateDomainName(ranking.selected.raw) ??
      context.domainName ??
      ''
    ).trim();
    const selectedSamples = ranking.selected.evidenceSamples
      .map((sample) => sample.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);

    if (!selectedDomainName || selectedSamples.length === 0) {
      return context.domainEvidence;
    }

    const provenanceByText = new Map(
      (ranking.selected.independentEvidence ?? []).map((item) => [
        this.normalizeEvidenceKey(item.text),
        item,
      ]),
    );

    return context.domainEvidence.map((entry) => {
      if (
        entry.domainName.trim().toLowerCase() !==
        selectedDomainName.toLowerCase()
      ) {
        return entry;
      }

      const existingPosts = Array.isArray(entry.samplePosts)
        ? entry.samplePosts.filter(
            (item): item is Prisma.JsonObject =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [];
      const existingComments = Array.isArray(entry.sampleComments)
        ? entry.sampleComments.filter(
            (item): item is Prisma.JsonObject =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [];
      const existingKeys = new Set(
        [...existingPosts, ...existingComments]
          .map((item) =>
            typeof item.text === 'string'
              ? this.normalizeEvidenceKey(item.text)
              : '',
          )
          .filter(Boolean),
      );

      const synchronizedPosts: Prisma.JsonObject[] = [];
      const synchronizedComments: Prisma.JsonObject[] = [];

      selectedSamples.forEach((sample, index) => {
        const key = this.normalizeEvidenceKey(sample);
        if (existingKeys.has(key)) return;

        const provenance = provenanceByText.get(key);
        if (provenance?.commentExternalId) {
          synchronizedComments.push({
            id: provenance.commentExternalId,
            postId: provenance.postExternalId || provenance.threadExternalId,
            text: sample,
            sentiment: 'NEUTRAL',
          });
          return;
        }

        synchronizedPosts.push({
          id: provenance?.postExternalId || `selected-opportunity:evidence:${index + 1}`,
          text: sample,
          sentiment: 'NEUTRAL',
        });
      });

      const mergedPosts = [...synchronizedPosts, ...existingPosts].slice(0, 8);
      const mergedComments = [
        ...synchronizedComments,
        ...existingComments,
      ].slice(0, 8);
      const totalPostsAnalyzed = Math.max(
        entry.totalPostsAnalyzed,
        mergedPosts.length,
      );
      const totalCommentsAnalyzed = Math.max(
        entry.totalCommentsAnalyzed,
        mergedComments.length,
      );

      return {
        ...entry,
        samplePosts: mergedPosts,
        sampleComments: mergedComments,
        evidenceAvailable: mergedPosts.length + mergedComments.length > 0,
        totalPostsAnalyzed,
        totalCommentsAnalyzed,
        totalTextsAnalyzed: totalPostsAnalyzed + totalCommentsAnalyzed,
      };
    });
  }

  /**
   * Counts only novel recovery samples that directly support the opportunity
   * selected after reranking. Corpus novelty and opportunity support are
   * intentionally separate metrics: unrelated new complaints must never imply
   * stronger evidence for the selected problem family.
   */
  private countSelectedOpportunityNovelEvidence(
    selectedOpportunity: IdeaOpportunityRanking['selected'] | null,
    novelRecoverySamples: readonly string[],
  ): number {
    if (!selectedOpportunity || novelRecoverySamples.length === 0) {
      return 0;
    }

    const selectedSamples = selectedOpportunity.evidenceSamples
      .map((sample) => this.normalizeEvidenceKey(sample))
      .filter(Boolean);

    return novelRecoverySamples.filter((sample) => {
      const normalizedRecoverySample = this.normalizeEvidenceKey(sample);
      if (!normalizedRecoverySample) {
        return false;
      }

      return selectedSamples.some(
        (selectedSample) =>
          selectedSample === normalizedRecoverySample ||
          (selectedSample.length >= 80 &&
            normalizedRecoverySample.includes(selectedSample)) ||
          (normalizedRecoverySample.length >= 80 &&
            selectedSample.includes(normalizedRecoverySample)),
      );
    }).length;
  }

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