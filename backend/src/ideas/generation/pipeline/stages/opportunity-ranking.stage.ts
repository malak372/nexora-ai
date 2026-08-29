import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  IdeaEvidenceRecoveryResult,
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
import { RequestDynamicQueryUtil } from '../../utils/request-dynamic-query.util';
import { CanonicalProblemFamilyUtil } from '../../utils/canonical-problem-family.util';
import { SelectedDomainEvidenceAlignmentUtil } from '../../utils/selected-domain-evidence-alignment.util';
import { CanonicalEvidenceVerificationUtil } from '../../utils/canonical-evidence-verification.util';
import { CanonicalEvidenceStateUtil } from '../../utils/canonical-evidence-state.util';
import { EvidenceSourceIdentityUtil } from '../../utils/evidence-source-identity.util';
import { CollectorRequestCapabilityUtil } from '../../../../collectors/base/collector-request-capability.util';
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

  private readonly logger = new Logger(OpportunityRankingStage.name);

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
    signal?: AbortSignal,
  ): Promise<IdeaGenerationStageExecutionResult> {
    if (!context.nlp) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
        message: 'NLP analysis is required before opportunity ranking.',
      });
    }

    // Ranking always starts from a freshly synchronized canonical state. No
    // downstream verifier/ranker is allowed to resurrect evidence that is not
    // present as a verified DIRECT/SUPPORTING row in this ledger.
    context = this.synchronizeCanonicalEvidenceState(context);

    const explicitDomainsOnlyCompetition =
      !this.hasExplicitRequesterProblem(context) &&
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

    /*
     * Discovery paths already have one canonical evidence-family winner from
     * Community AI + deterministic ledger verification.  Preserve that exact
     * family through ranking instead of letting the generic NLP tournament
     * rename it to another taxonomy candidate.  The locked candidate still
     * passes independent provenance verification below, so this is an identity
     * lock rather than an evidence-quality bypass.
     */
    const canonicalFamilyRanking =
      await this.buildVerifiedCanonicalFamilyRanking(context);
    let ranking = canonicalFamilyRanking ?? explicitDirectCompetition;

    if (!ranking) {
      const genericRanking = await this.tryRankContext(
        workingContext,
        previousIdeaTexts,
      );
      const discoveryHasCanonicalFamily = Boolean(
        workingContext.communityAiAnalysis?.selectedProblemFamily?.trim() &&
          (workingContext.communityAiAnalysis
            ?.selectedProblemFamilyTrustedEvidenceCount ?? 0) > 0,
      );

      /*
       * Discovery-only runs may collect a verified row that does not survive the
       * canonical family lock. That row is useful diagnostics, but it must not
       * seed a concrete unrelated product. Without a canonical family, fall back
       * to the safe domain-validation workspace and let bounded recovery search
       * for a coherent family.
       */
      ranking = this.enforcePrimaryDomainFallback(
        !this.hasExplicitRequesterProblem(workingContext) &&
          !discoveryHasCanonicalFamily
          ? null
          : genericRanking,
        workingContext,
      );
    }

    if (ranking) {
      // Apply request intent before recovery so a mismatch cannot consume the
      // bounded recovery budget just because its existing evidence is strong.
      ranking = this.applyRequestIntentAlignment(ranking, workingContext);
      /*
       * A one-source AI family that later fails the existing explicit-request
       * intent gate must not remain immutable and block a better recovery
       * family. Release only the family LOCK here; the adjudicated row remains
       * in the audit ledger until final request-scope reconciliation. No new
       * deterministic semantic classifier is introduced.
       */
      workingContext = this.releaseWeakExplicitRequestCanonicalLock(
        workingContext,
        ranking,
        false,
      );
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
      this.hasExplicitRequesterProblem(workingContext) &&
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
      (!this.hasExplicitRequesterProblem(workingContext) ||
        primaryAiClassifiedExternalEvidence.length > 0)
    ) {
      const retainedExternalFallback =
        await this.verifyExternalSupportingEvidenceFallback(
          workingContext,
          primaryAiClassifiedExternalEvidence,
        );
      if (
        retainedExternalFallback &&
        (this.hasExplicitRequesterProblem(workingContext) ||
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
    /*
     * Text-bearing requests carry useful requester intent. If the first targeted
     * recovery wave still has zero trusted evidence, allow one additional
     * source/query-rotated wave before declaring the scoped discovery externally
     * unvalidated. DOMAINS_ONLY/NO_INPUT also receive one bounded targeted
     * recovery wave when their first broad pass retains zero trusted evidence;
     * successful evidence-backed runs still skip recovery entirely.
     */
    const requesterHasText = Boolean(workingContext.requestDescription?.trim());
    /*
     * The first pass now fans out across a broader capability-balanced source
     * portfolio. Keep the common evidence-backed path at zero/one recovery wave,
     * but let a text-bearing request with ZERO canonical trusted evidence spend
     * the existing second bounded attempt on a source/query-rotated recovery.
     * This extra wave is exceptional rather than the default latency path.
     */
    const zeroTrustedBeforeRecovery =
      CanonicalEvidenceStateUtil.compute(
        workingContext.canonicalEvidenceLedger ?? [],
      ).trustedCount === 0;
    /*
     * Preserve the existing bounded recall budget. Text requests with zero
     * trusted evidence may still use the second rotated wave; we reduce latency
     * only by removing redundant post-recovery work, never by deleting an
     * evidence opportunity or shortening semantic deadlines.
     */
    const maximumRecoveryExecutionWaves =
      requesterHasText && zeroTrustedBeforeRecovery
        ? MAX_EVIDENCE_RECOVERY_ATTEMPTS
        : 1;
    const maximumRecoveryAttemptsForRun = maximumRecoveryExecutionWaves;
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
      const selectedFamilySourceKeys =
        this.resolveSelectedProblemFamilyTrustedSourceKeys(recoveryContext);
      const recoveryExcludedSourceKeys = [...new Set([
        ...recoveryMetadata.flatMap(
          (attempt) => attempt.selectedDataSourceKeys,
        ),
        ...(selectedFamilySourceKeys.length === 1
          ? selectedFamilySourceKeys
          : []),
      ])];

      const recovery = await this.evidenceRecoveryService.recover(
        recoveryContext,
        recoveryTarget,
        recoveryExcludedSourceKeys,
        signal,
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
      /*
       * Recovery output is provisional until the raw recovery rows have been
       * merged into the run-level canonical ledger. Do not let the recovery
       * service's local DIRECT/SUPPORTING interpretation become a second
       * verification authority.
       */

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

      const trustedEvidenceCountBeforeMerge =
        CanonicalEvidenceStateUtil.compute(
          workingContext.canonicalEvidenceLedger ?? [],
        ).trustedCount;
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
        domainEvidence: workingContext.domainEvidence,
        opportunityRanking: null,
        evidenceRecoveryAttempts: workingContext.evidenceRecoveryAttempts,
        evidenceRecoveryCollectionJobIds: [
          ...workingContext.evidenceRecoveryCollectionJobIds,
          recovery.collectionJobId,
        ],
      });

      const canonicalRecoverySupportingExternalEvidence =
        this.buildCanonicalTrustedRecoveredExternalEvidence(
          workingContext,
          recovery.rawEvidenceCorpus,
        );
      recoverySupportingExternalEvidence.push(
        ...canonicalRecoverySupportingExternalEvidence,
      );
      const trustedEvidenceCountAfterMerge =
        CanonicalEvidenceStateUtil.compute(
          workingContext.canonicalEvidenceLedger ?? [],
        ).trustedCount;
      const recoveryAddedTrustedEvidence =
        canonicalRecoverySupportingExternalEvidence.length > 0 ||
        trustedEvidenceCountAfterMerge > trustedEvidenceCountBeforeMerge;
      if (
        contributedEvidence &&
        canonicalRecoverySupportingExternalEvidence.length > 0
      ) {
        workingContext = {
          ...workingContext,
          domainEvidence: this.mergeRecoveredEvidenceIntoDomainEvidence(
            workingContext,
            canonicalRecoverySupportingExternalEvidence,
            recovery.collectionJobId,
          ),
        };
      }

      /*
       * Re-ranking + independent provenance verification is intentionally
       * skipped when the recovery wave added ZERO trusted canonical rows.
       * Context-only/unrelated recovery results still remain in the canonical
       * audit ledger, but re-running the unchanged ranking used to burn another
       * 10-20 seconds without any possible scoring/evidence change.
       */
      if (recoveryAddedTrustedEvidence) {
        const recoveredCanonicalRanking =
          await this.buildVerifiedCanonicalFamilyRanking(workingContext);
        ranking = recoveredCanonicalRanking ?? this.enforcePrimaryDomainFallback(
          await this.tryRankContext(workingContext, previousIdeaTexts),
          workingContext,
        );
        if (ranking) {
          ranking = this.applyRequestIntentAlignment(ranking, workingContext);
        }

        if (
          ranking &&
          this.hasExplicitRequesterProblem(workingContext) &&
          canonicalRecoverySupportingExternalEvidence.length > 0
        ) {
          const verifiedRecoveredRequesterSupport =
            this.verifyQualifiedRequesterSupportingEvidence(
              workingContext,
              canonicalRecoverySupportingExternalEvidence,
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
         * hypothesis.
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
      } else {
        this.logger.debug(
          `Recovery wave added no trusted canonical evidence; preserving the already-verified ranking and skipping redundant independent re-verification. rawRecovery=${recovery.rawEvidenceCorpus.length}.`,
        );
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
       * A second text-recovery wave is exceptional, not automatic. If the first
       * wave produced new provenance from at least two materially different
       * evidence-source archetypes and the complete recovery corpus was
       * semantically adjudicated with zero trusted rows, another rotated crawl
       * is unlikely to improve evidence and only adds serial latency. Continue
       * only when source coverage was genuinely thin/empty or collection itself
       * failed. An AI-adjudication outage is never "fixed" by recollecting.
       */
      if (
        !this.shouldContinueRecoveryAfterWave(
          workingContext,
          recovery,
          recoveryExecutionWaves,
          maximumRecoveryExecutionWaves,
        )
      ) {
        break;
      }

      /*
       * Request-scoped text generation may use one additional rotated wave only
       * when the first wave failed the coverage test above. Sources used by the
       * previous wave are excluded and runtime-unavailable collectors remain
       * filtered by IdeaEvidenceRecoveryService.
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
    let hasVerifiedExternalEvidence =
      CanonicalEvidenceStateUtil.compute(
        workingContext.canonicalEvidenceLedger ?? [],
      ).trustedCount > 0;

    if (!hasVerifiedExternalEvidence) {
      const verifiedSupportingFallback =
        await this.verifyExternalSupportingEvidenceFallback(
          workingContext,
          recoverySupportingExternalEvidence,
        );
      if (verifiedSupportingFallback) {
        ranking = verifiedSupportingFallback;
        // A fallback may organize canonical evidence, but it cannot create a
        // trusted state independently of the canonical ledger.
        hasVerifiedExternalEvidence =
          CanonicalEvidenceStateUtil.compute(
            workingContext.canonicalEvidenceLedger ?? [],
          ).trustedCount > 0;
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
      !this.hasExplicitRequesterProblem(workingContext) &&
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
  private shouldContinueRecoveryAfterWave(
    context: IdeaGenerationContext,
    recovery: IdeaEvidenceRecoveryResult,
    executedWaves: number,
    maximumWaves: number,
  ): boolean {
    if (executedWaves >= maximumWaves) return false;
    if (!context.requestDescription?.trim()) return false;

    const canonicalState = CanonicalEvidenceStateUtil.compute(
      context.canonicalEvidenceLedger ?? [],
    );
    if (canonicalState.trustedCount > 0) return false;

    const rawRows = recovery.rawEvidenceCorpus ?? [];
    if (rawRows.length === 0) {
      this.logger.debug(
        'Skipping a second text-recovery wave because the previous completed wave added zero new canonical raw rows; another serial recollection has low expected marginal value.',
      );
      return false;
    }

    if (!recovery.communityAiRecoveryExecuted || !recovery.communityAiAnalysis) {
      this.logger.warn(
        `Skipping another collection wave because ${rawRows.length} recovered raw row(s) already exist but recovery semantic adjudication did not complete; recollection cannot repair an AI/provider adjudication outage.`,
      );
      return false;
    }

    const classificationById = new Map(
      (recovery.communityAiAnalysis.evidenceClassifications ?? []).map((item) => [
        item.evidenceId,
        item,
      ] as const),
    );
    const fullRecoveryCorpusAdjudicated = rawRows.every((row) => {
      const classification = classificationById.get(row.id);
      return Boolean(
        classification &&
          classification.adjudicationStatus === 'ADJUDICATED' &&
          classification.classification !== 'UNADJUDICATED',
      );
    });

    if (!fullRecoveryCorpusAdjudicated) {
      this.logger.warn(
        `Skipping another collection wave because the previous recovery already returned ${rawRows.length} raw row(s) but semantic adjudication is incomplete; the same evidence must remain authoritative rather than being replaced by recollection.`,
      );
      return false;
    }

    const productiveSourceKeys = new Set(
      rawRows
        .map((row) => row.sourceKey.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const productiveArchetypes = new Set(
      [...productiveSourceKeys].map((sourceKey) =>
        CollectorRequestCapabilityUtil.sourceArchetype(sourceKey),
      ),
    );
    productiveArchetypes.delete('OTHER');

    const coverageSufficient =
      productiveSourceKeys.size >= 2 && productiveArchetypes.size >= 2;

    if (coverageSufficient) {
      this.logger.debug(
        `Skipping redundant second recovery wave after a complete zero-trusted verdict from ${productiveSourceKeys.size} productive source(s) across ${productiveArchetypes.size} evidence archetype(s).`,
      );
      return false;
    }

    this.logger.debug(
      `A second text-recovery wave remains eligible because productive source coverage was thin: sources=${productiveSourceKeys.size}, archetypes=${productiveArchetypes.size}.`,
    );
    return true;
  }

  private shouldRunEvidenceRecovery(
    ranking: IdeaOpportunityRanking | null,
    context: IdeaGenerationContext,
  ): boolean {
    const maximumAttemptsForContext = context.requestDescription?.trim()
      ? MAX_EVIDENCE_RECOVERY_ATTEMPTS
      : 1;
    if (context.evidenceRecoveryAttempts >= maximumAttemptsForContext) {
      return false;
    }

    const primaryAi = context.communityAiAnalysis;
    const classifications = primaryAi?.evidenceClassifications ?? [];
    const trustedEvidence = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const trustedEvidenceCount = trustedEvidence.length;
    const selectedIds = new Set(
      (primaryAi?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const selectedTrustedEvidence = selectedIds.size > 0
      ? trustedEvidence.filter((item) => selectedIds.has(item.id))
      : [];
    const corroborationSet =
      selectedTrustedEvidence.length > 0
        ? selectedTrustedEvidence
        : trustedEvidence;
    const corroborationSourceCount =
      EvidenceSourceIdentityUtil.count(corroborationSet);
    const needsIndependentSourceCorroboration =
      corroborationSet.length > 0 && corroborationSourceCount < 2;
    const rawEvidenceCount = context.rawEvidenceCorpus?.length ?? 0;
    const rawSourceCount = new Set(
      (context.rawEvidenceCorpus ?? []).map((item) => item.sourceKey.toLocaleLowerCase()),
    ).size;
    const rawSourceArchetypes = new Set(
      (context.rawEvidenceCorpus ?? [])
        .map((item) =>
          CollectorRequestCapabilityUtil.sourceArchetype(
            item.sourceKey.toLocaleLowerCase(),
          ),
        )
        .filter((archetype) => archetype !== 'OTHER'),
    );
    const rawSourceArchetypeCount = rawSourceArchetypes.size;
    const directExperienceSourceCount = new Set(
      (context.rawEvidenceCorpus ?? [])
        .filter((item) => {
          const archetype = CollectorRequestCapabilityUtil.sourceArchetype(
            item.sourceKey.toLocaleLowerCase(),
          );
          return archetype === 'COMMUNITY' || archetype === 'PRODUCT_REVIEW';
        })
        .map((item) => item.sourceKey.toLocaleLowerCase()),
    ).size;
    const selectedSourceCount = Math.max(1, context.selectedDataSources.length);
    const minimumBroadRawCount = context.requestDescription?.trim()
      ? 10
      : Math.max(8, Math.min(14, selectedSourceCount));
    const minimumBroadSourceCount = Math.min(4, selectedSourceCount);
    const broadFirstPassCompleted =
      rawEvidenceCount >= minimumBroadRawCount &&
      rawSourceCount >= minimumBroadSourceCount;

    const classificationByEvidenceId = new Map(
      classifications.map((item) => [item.evidenceId, item] as const),
    );
    const fullPrimaryCorpusAdjudicated =
      rawEvidenceCount > 0 &&
      (context.rawEvidenceCorpus ?? []).every((row) => {
        const classification = classificationByEvidenceId.get(row.id);
        return Boolean(
          classification &&
            classification.adjudicationStatus === 'ADJUDICATED' &&
            classification.classification !== 'UNADJUDICATED',
        );
      });
    const textCorpusHasIndependentBreadth = Boolean(
      context.requestDescription?.trim() &&
        fullPrimaryCorpusAdjudicated &&
        rawEvidenceCount >= 14 &&
        rawSourceCount >= 4 &&
        rawSourceArchetypeCount >= 3 &&
        (directExperienceSourceCount >= 1 ||
          (rawSourceCount >= 5 && rawSourceArchetypeCount >= 4)),
    );
    const discoveryCorpusHasIndependentBreadth = Boolean(
      !context.requestDescription?.trim() &&
        fullPrimaryCorpusAdjudicated &&
        rawEvidenceCount >= Math.max(10, minimumBroadRawCount) &&
        rawSourceCount >= Math.min(3, minimumBroadSourceCount),
    );
    /*
     * Trusted evidence is evaluated at the selected-family level, not at the
     * global-corpus level. A run can have many trusted rows overall while the
     * winning family is still supported by one independent source. In that
     * case allow exactly one bounded corroboration wave; the recovery service
     * performs source-health/executability preflight before any expensive AI
     * re-planning and excludes the already represented family source. This is
     * structural provenance logic only — no domain/problem meaning is inferred.
     */
    if (trustedEvidenceCount > 0) {
      if (
        context.evidenceRecoveryAttempts === 0 &&
        needsIndependentSourceCorroboration
      ) {
        this.logger.debug(
          `Selected-family corroboration remains eligible: familyEvidence=${corroborationSet.length}, familySources=${corroborationSourceCount}, globalTrusted=${trustedEvidenceCount}, raw=${rawEvidenceCount}, rawSources=${rawSourceCount}.`,
        );
        return true;
      }
      return false;
    }

    /*
     * A text-bearing request already gives us a stable problem identity, so a
     * zero-trusted first pass is worth a bounded source/query-rotated recovery
     * sequence even when the raw corpus itself was broad. The second wave is
     * reached only when the first one still produced no canonical trusted
     * evidence. Previously the
     * `broadFirstPassCompleted` shortcut stopped recovery after 10+ generic
     * results, which is precisely how municipal-housing style requests could
     * end at NO_VALID_EVIDENCE_FOUND despite having enough search surface to
     * try a more natural, facet-level vocabulary.
     *
     * The recovery service remains bounded by MAX_EVIDENCE_RECOVERY_ATTEMPTS and
     * the same canonical DIRECT/SUPPORTING verifier. This increases recall; it does not promote
     * context-only material or manufacture evidence.
     */
    if (
      context.evidenceState === 'EVIDENCE_ADJUDICATION_UNAVAILABLE' &&
      rawEvidenceCount > 0
    ) {
      this.logger.warn(
        `Evidence recovery skipped because ${rawEvidenceCount} raw item(s) already exist but semantic adjudication is unavailable; recollecting cannot repair an AI/provider outage.`,
      );
      return false;
    }

    const conclusiveBroadTextZeroTrusted = Boolean(
      context.requestDescription?.trim() &&
        trustedEvidenceCount === 0 &&
        textCorpusHasIndependentBreadth,
    );

    /*
     * A broad, source-diverse text corpus that was fully adjudicated item by
     * item and still produced zero canonical DIRECT/SUPPORTING evidence is a
     * conclusive bounded verdict for this run. Re-collecting one or two more
     * rows serially cannot justify another 10-20 second recovery tail. Smaller
     * or thin corpora (for example 6-7 rows) still receive targeted recovery,
     * so niche recall is preserved where another lane can materially help.
     */
    if (conclusiveBroadTextZeroTrusted) {
      this.logger.debug(
        `Skipping redundant text recovery after a complete broad zero-trusted verdict: raw=${rawEvidenceCount}, sources=${rawSourceCount}, archetypes=${rawSourceArchetypeCount}, adjudicated=${classifications.length}.`,
      );
      return false;
    }

    if (context.requestDescription?.trim()) {
      return true;
    }

    if (
      trustedEvidenceCount === 0 &&
      discoveryCorpusHasIndependentBreadth
    ) {
      this.logger.debug(
        `Skipping redundant discovery recovery after a complete broad zero-trusted verdict: raw=${rawEvidenceCount}, sources=${rawSourceCount}, archetypes=${rawSourceArchetypeCount}, adjudicated=${classifications.length}.`,
      );
      return false;
    }

    // A broad discovery corpus was already collected and semantically reviewed
    // (or explicitly marked unavailable above). Repeating generic domain-label
    // collection is not semantic re-planning and only adds latency.
    if (broadFirstPassCompleted) {
      return false;
    }

    // Discovery paths cannot safely manufacture evidence from domain labels.
    // When the first pass retained zero DIRECT/SUPPORTING rows, spend exactly
    // one bounded source-rotated recovery wave before accepting a completed no-valid-evidence result.
    // The surrounding per-run cap keeps this recall improvement latency-bounded.
    if (context.evidenceRecoveryAttempts === 0) {
      return true;
    }

    const semanticClassificationCompleted = Boolean(
      classifications.length > 0 &&
      classifications.every(
        (item) =>
          item.classification === 'UNRELATED' ||
          item.classification === 'CONTEXT_ONLY' ||
          item.classification === 'ANALOGOUS_WORKFLOW_SIGNAL',
      ),
    );

    // If semantic triage completed on a smaller but still usable corpus, do not
    // recollect the same zero-evidence problem unless source coverage was truly
    // tiny (fewer than two sources or fewer than four raw items).
    if (semanticClassificationCompleted && rawEvidenceCount >= 3) {
      return false;
    }

    // Do not recollect when the semantic AI layer itself was unavailable but
    // the first pass already returned material; retrying collection cannot fix
    // a model outage.
    if (
      rawEvidenceCount > 0 &&
      primaryAi &&
      primaryAi.onlineAttemptCount === 0 &&
      !semanticClassificationCompleted
    ) {
      return false;
    }

    return rawEvidenceCount < 4 || rawSourceCount < 2;
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
    const explicitProblem = this.resolveExplicitRequesterProblem(context);
    const requestIntentScope = this.resolveRequestIntentScope(context);
    const requesterBlueprint = explicitProblem
      ? CanonicalRequestProductBlueprintUtil.build({
          profile: context.collectionPlan?.problemProfile,
          requestDescription: explicitProblem,
          domainName: context.domainName,
          opportunityTitle: context.opportunityRanking?.selected?.title,
        })
      : null;
    const isCrossDomain = selectedDomainNames.length > 1;
    const title = explicitProblem
      ? 'Requester-Defined Workflow Opportunity'
      : requestDescription
        ? 'Intent-Grounded Evidence Discovery'
        : isCrossDomain
        ? 'Selected-Domain Evidence Discovery'
        : `${domainLabel} Opportunity Discovery`;
    const problem = explicitProblem
      ? `The requester wants to address this specific problem across the resolved generation scope (${domainLabel}): "${explicitProblem}". Direct community evidence was not sufficiently aligned inside the bounded fast-search budget, so the generated direction must validate this exact requester workflow instead of substituting a different well-evidenced problem.`
      : requestDescription
        ? `No verified external problem has yet been selected inside the requester intent (${requestIntentScope || requestDescription}) across ${domainLabel}. The text constrains discovery but is not itself treated as the problem or as evidence.`
        : isCrossDomain
        ? `No direct community problem has yet been validated across ${domainLabel}. The selected domains are independent discovery lanes: the pilot must compare real evidence per domain, prefer the strongest single-domain problem when one emerges, and combine domains only when retained evidence explicitly demonstrates a connected workflow.`
        : `The pilot will test whether teams working in ${domainLabel} need a structured, low-cost workflow for collecting, classifying, and validating operational-friction reports before committing to a full software implementation.`;
    const need = explicitProblem
      ? requesterBlueprint
        ? `A focused ${requesterBlueprint.title} workflow centered on ${requesterBlueprint.workflowFocus}. External demand and prevalence remain unvalidated, but the requester-described operational workflow can still be implemented and tested directly without being replaced by a generic problem-discovery product.`
        : `A focused software workflow that directly addresses the requester-described actors, records, pains, and outcomes while keeping external demand and prevalence explicitly unvalidated.`
      : requestDescription
        ? `A bounded evidence-discovery workflow that uses the requester intent (${requestIntentScope || requestDescription}) to search for, compare, and validate real external problem signals before selecting the software problem.`
        : isCrossDomain
        ? `A bounded evidence-discovery pilot that searches each selected domain independently, identifies the strongest evidence-backed problem family, and avoids inventing cross-domain integration when no evidence connects the domains.`
        : `A bounded pilot that captures real user reports, groups recurring workflow problems, and measures which problem family is strong enough to justify implementation.`;
    const solutionArea = explicitProblem
      ? requesterBlueprint?.workflowFocus ??
        'Requester-described operational workflow implementation with traceable records, human-reviewed decisions, and bounded pilot validation'
      : requestDescription
        ? 'Intent-constrained evidence intake, AI problem-family selection, and evidence-backed opportunity validation'
        : isCrossDomain
        ? 'Domain-balanced evidence intake, independent problem-family comparison, and single-domain-first pilot validation'
        : 'User-feedback intake, evidence classification, and pilot validation workflow';
    const domainRelevanceScores = Object.fromEntries(
      selectedDomainNames.map((name) => [name, 1]),
    );

    const requesterValidationScore = explicitProblem
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
      specificityScore: explicitProblem ? 0.9 : requestDescription ? 0.8 : 0.72,
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
        // The semantic primary problem domain was already resolved in
        // PREPARING. Keep the complete selected-domain scope separately, but do
        // not let selectedDomains[0] silently replace that primary role.
        domainName: context.domainName?.trim() || selectedDomainNames[0],
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
      selectionReason: explicitProblem
        ? `No sufficiently request-aligned direct community problem was retained within the fast collection budget. The run stays anchored to the explicit requester problem across ${domainLabel} and uses a validation pilot rather than switching to an unrelated high-evidence problem.`
        : isCrossDomain
          ? `No direct community problem was retained within the fast collection budget. The run keeps all explicitly selected domains (${domainLabel}) in the validation search space instead of forcing the first domain to win by position.`
          : `No direct community problem was retained within the fast collection budget. The run remains anchored to "${domainLabel}" and generates a clearly labeled validation hypothesis.`,
      qualityWarnings: [
        explicitProblem
          ? 'No sufficiently request-aligned direct community problem was established. The requester statement is preserved as traceable scope evidence but does not count as community demand evidence.'
          : requestDescription
            ? 'The requester text is preserved as intent/context only. No evidence-backed problem survived yet, so the run remains in problem-discovery mode instead of treating the text itself as demand evidence.'
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
     * Only an explicitly stated requester problem is problem-locked. When free text
     * is DISCOVERY_INTENT, recovery may compare alternative evidence-backed
     * families inside that intent scope because the problem itself is selected
     * after collection. Domains-only/no-input discovery keeps the same
     * multi-candidate behavior.
     */
    if (this.hasExplicitRequesterProblem(context)) {
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
            evidenceNature: classification.evidenceNature,
            domainAlignment: classification.domainAlignment,
            problemAlignment: classification.problemAlignment,
            familyBasis: classification.familyBasis,
            observedProblem: classification.observedProblem,
            causalExplanation: classification.causalExplanation,
            matchedDomainNames: classification.matchedDomainNames,
            origin: 'RECOVERY',
          },
          requestMode: context.requestMode,
          problemSpec: context.canonicalProblemSpec,
          selectedDomains: context.selectedDomains,
        }),
      );
    }

    // Recovery has the same completeness contract as the first pass. An AI
    // timeout/partial response must never make newly collected raw evidence
    // disappear between collection and the canonical ledger.
    for (const raw of recoveredRaw) {
      if (byId.has(raw.id)) continue;
      const proposal = CanonicalEvidenceVerificationUtil.buildDeterministicFallbackProposal({
        raw,
        requestMode: context.requestMode,
        origin: 'RECOVERY',
      });
      byId.set(
        raw.id,
        CanonicalEvidenceVerificationUtil.verify({
          raw,
          proposal,
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
    if (!primary) return recovered;
    if (!recovered) return primary;

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

    const primaryHasCanonicalLock = Boolean(
      primary.canonicalProblemFamilyLabel?.trim() &&
      (primary.canonicalProblemFamilyEvidenceIds?.length ?? 0) > 0,
    );
    const recoveredHasCanonicalLock = Boolean(
      recovered.canonicalProblemFamilyLabel?.trim() &&
      (recovered.canonicalProblemFamilyEvidenceIds?.length ?? 0) > 0,
    );
    const recoveredHasSelectedFamily = Boolean(
      recovered.selectedProblemFamily?.trim() &&
      (recovered.selectedProblemFamilyEvidenceIds?.length ?? 0) > 0,
    );
    const lockSource = primaryHasCanonicalLock
      ? primary
      : recoveredHasCanonicalLock || recoveredHasSelectedFamily
        ? recovered
        : null;
    const lockedLabel = lockSource?.canonicalProblemFamilyLabel?.trim() ||
      lockSource?.selectedProblemFamily?.trim() || null;
    const lockedEvidenceIds = [...new Set(
      (lockSource?.canonicalProblemFamilyEvidenceIds ??
        lockSource?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    )];
    const lockedCanonicalId = lockSource?.canonicalProblemFamilyId?.trim() || null;

    // A recovery pass may corroborate a canonical family, but it may never
    // replace that family with a different label. When the primary pass already
    // has a lock, preserve its opportunity identity and use recovered output
    // only for classifications/diagnostics. If there was no lock, recovery gets
    // exactly one chance to establish the initial family before ledger sync.
    const opportunities = primaryHasCanonicalLock
      ? primary.opportunities
      : this.mergeCommunityOpportunities(
          primary.opportunities,
          recovered.opportunities,
        );

    return {
      summary: primaryHasCanonicalLock
        ? `${primary.summary} Supplemental targeted recovery completed without changing the canonical problem-family identity.`
        : `${primary.summary} Supplemental targeted recovery: ${recovered.summary}`.trim(),
      dominantProblems: primaryHasCanonicalLock
        ? [...primary.dominantProblems]
        : this.mergeStrings(primary.dominantProblems, recovered.dominantProblems),
      unmetNeeds: primaryHasCanonicalLock
        ? [...primary.unmetNeeds]
        : this.mergeStrings(primary.unmetNeeds, recovered.unmetNeeds),
      opportunities,
      overallConfidence:
        Math.round(
          Math.max(primary.overallConfidence, recovered.overallConfidence) * 100,
        ) / 100,
      qualityWarnings: this.mergeStrings(
        primary.qualityWarnings,
        recovered.qualityWarnings,
      ),
      modelId: recovered.modelId ?? primary.modelId,
      apiModelId: recovered.apiModelId ?? primary.apiModelId,
      attemptCount: primary.attemptCount + recovered.attemptCount,
      aiAttempted: primary.aiAttempted || recovered.aiAttempted,
      triageAiSucceeded:
        Boolean(primary.triageAiSucceeded) || Boolean(recovered.triageAiSucceeded),
      synthesisAiSucceeded:
        Boolean(primary.synthesisAiSucceeded) || Boolean(recovered.synthesisAiSucceeded),
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
      aiProposedProblemFamily:
        primary.aiProposedProblemFamily ?? recovered.aiProposedProblemFamily ?? null,
      aiProposedProblemFamilyEvidenceIds: [
        ...new Set([
          ...(primary.aiProposedProblemFamilyEvidenceIds ?? []),
          ...(recovered.aiProposedProblemFamilyEvidenceIds ?? []),
        ]),
      ],
      selectedProblemFamily: lockedLabel,
      selectedProblemFamilySelectionSource:
        lockSource?.selectedProblemFamilySelectionSource ?? null,
      selectedProblemFamilyTrustedEvidenceCount:
        lockSource?.selectedProblemFamilyTrustedEvidenceCount ?? lockedEvidenceIds.length,
      selectedProblemFamilyDistinctSourceCount:
        lockSource?.selectedProblemFamilyDistinctSourceCount ?? 0,
      selectedProblemFamilyEvidenceIds: lockedEvidenceIds,
      canonicalProblemFamilyId: lockedCanonicalId,
      canonicalProblemFamilyLabel: lockedLabel,
      canonicalProblemFamilyEvidenceIds: lockedEvidenceIds,
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
    if (this.hasExplicitRequesterProblem(context)) {
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

  private async buildVerifiedCanonicalFamilyRanking(
    context: IdeaGenerationContext,
  ): Promise<IdeaOpportunityRanking | null> {
    const analysis = context.communityAiAnalysis;
    const lockedFamily = analysis?.selectedProblemFamily?.trim() ?? '';
    if (
      !lockedFamily ||
      (analysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0) <= 0
    ) {
      return null;
    }

    const canonicalRanking = this.buildGroundedCommunityFallbackRanking(context);
    if (!canonicalRanking) return null;

    const collectionJobIds = this.resolveEvidenceCollectionJobIds(context);
    const provenanceHints = this.buildEvidenceProvenanceHints(context);
    const verified = this.preferVerifiedEvidenceQualityWinner(
      this.enforceEvidenceNarrativeConsistency(
        this.opportunityRankingService.reconcileVerifiedDomainAttribution(
          await this.independentEvidenceVerificationService.verifyRanking(
            canonicalRanking,
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

    const selected = verified.selected;
    const canonicalEvidenceIds = new Set(
      (analysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const canonicalFamilyItems = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        canonicalEvidenceIds.has(item.id) &&
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL') &&
        this.canonicalEvidenceSupportsFamily(
          lockedFamily,
          item.problemFamily,
          item.text,
        ),
    );

    const independentlyVerifiedCount =
      selected.verifiedProblemMatchedEvidenceCount ??
      selected.verifiedEvidenceCount ??
      selected.independentEvidence?.length ??
      0;
    const verifiedCount = Math.max(
      independentlyVerifiedCount,
      canonicalFamilyItems.length,
      analysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0,
    );
    if (verifiedCount <= 0) return null;

    const canonicalSelected = canonicalRanking.selected;
    const canonicalSamples = canonicalFamilyItems.length > 0
      ? canonicalFamilyItems.map((item) => item.text).filter(Boolean).slice(0, 8)
      : canonicalSelected.evidenceSamples;
    if (canonicalSamples.length === 0) return null;

    const canonicalDirectCount = canonicalFamilyItems.filter(
      (item) => item.classification === 'DIRECT_PROBLEM',
    ).length;
    const canonicalSupportingCount = Math.max(
      0,
      canonicalFamilyItems.length - canonicalDirectCount,
    );
    const canonicalSourceCount = Math.max(
      analysis?.selectedProblemFamilyDistinctSourceCount ?? 0,
      EvidenceSourceIdentityUtil.count(canonicalFamilyItems),
    );
    const hasExplicitRequesterProblem = this.hasExplicitRequesterProblem(context);

    /*
     * Evidence strength is structural, not semantic: the Community AI owns the
     * family label and every row already passed canonical request/domain
     * verification. Ranking therefore measures only how much independently
     * corroborated support survived (count, source diversity, directness, and
     * Community confidence). This prevents a 7-row/5-source canonical family
     * from inheriting the fixed low score of a zero-evidence validation
     * hypothesis while keeping the Core 70-point product-quality gate intact.
     */
    const evidenceCountStrength = Math.min(1, verifiedCount / 5);
    const sourceDiversityStrength = Math.min(1, canonicalSourceCount / 3);
    const directStrength = Math.min(
      1,
      canonicalDirectCount / Math.max(1, verifiedCount),
    );
    const communityConfidence = Math.max(
      0,
      Math.min(1, (analysis?.overallConfidence ?? 0) / 100),
    );
    const canonicalEvidenceStrength = Math.min(
      0.92,
      Math.round(
        (0.25 +
          evidenceCountStrength * 0.25 +
          sourceDiversityStrength * 0.22 +
          directStrength * 0.08 +
          communityConfidence * 0.1) *
          1000,
      ) / 1000,
    );
    const canonicalReliabilityFloor = Math.min(
      0.9,
      0.52 + sourceDiversityStrength * 0.18 + directStrength * 0.12,
    );
    const canonicalSupportFloor = Math.min(
      0.88,
      0.42 + evidenceCountStrength * 0.2 + sourceDiversityStrength * 0.18,
    );

    const removableEvidenceReasons = new Set<string>([
      'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      'EVIDENCE_SEMANTIC_MISMATCH',
      'LOW_OPPORTUNITY_SCORE',
    ]);
    if (verifiedCount >= 2 && canonicalSourceCount >= 2) {
      removableEvidenceReasons.add('INSUFFICIENT_EVIDENCE_COUNT');
      removableEvidenceReasons.add('INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE');
      removableEvidenceReasons.add('NO_SUPPORTED_FREQUENCY');
      removableEvidenceReasons.add('LOW_EVIDENCE_RELIABILITY');
      removableEvidenceReasons.add('LOW_EVIDENCE_QUALITY');
      removableEvidenceReasons.add('INSUFFICIENT_SUPPORT');
      removableEvidenceReasons.add('LOW_CONFIDENCE_REQUIRES_STRONGER_EVIDENCE');
    }
    /*
     * NO_DIRECT_EVIDENCE is a useful warning but must not make a repeatedly
     * corroborated supporting-only family equivalent to zero evidence. The
     * absence of direct user complaints is preserved in qualityWarnings and
     * the final evidence qualification language below.
     */
    if (verifiedCount >= 1 && canonicalSupportingCount >= 1) {
      removableEvidenceReasons.add('NO_DIRECT_EVIDENCE');
    }

    const canonicalDisqualificationReasons = selected.disqualificationReasons.filter(
      (reason) => !removableEvidenceReasons.has(reason),
    );
    const canonicalSelectionEligible =
      !canonicalDisqualificationReasons.some(
        (reason) =>
          reason === 'OFF_SELECTED_DOMAIN' ||
          reason === 'EXPLICIT_DOMAIN_SCOPE_MISMATCH' ||
          reason === 'PROBLEM_EVIDENCE_OUTSIDE_EXPLICIT_SCOPE',
      );

    const selectedTitle = hasExplicitRequesterProblem
      ? canonicalSelected.title
      : lockedFamily;
    const selectedProblem = hasExplicitRequesterProblem
      ? canonicalSelected.problem
      : canonicalSelected.problem;

    const raw =
      selected.raw &&
      typeof selected.raw === 'object' &&
      !Array.isArray(selected.raw)
        ? ({
            ...(selected.raw as Prisma.JsonObject),
            familyKey: hasExplicitRequesterProblem
              ? (selected.raw as Prisma.JsonObject).familyKey ?? null
              : null,
            canonicalProblemFamily: lockedFamily,
            canonicalProblemEvidenceIds: [
              ...(analysis?.selectedProblemFamilyEvidenceIds ?? []),
            ],
            canonicalProblemTrustedEvidenceCount: verifiedCount,
            canonicalProblemDistinctSourceCount: canonicalSourceCount,
            canonicalProblemDirectEvidenceCount: canonicalDirectCount,
            canonicalProblemSupportingEvidenceCount: canonicalSupportingCount,
            ...(hasExplicitRequesterProblem
              ? {
                  canonicalRequesterProblemSupported: true,
                  canonicalRequesterSupportFamily: lockedFamily,
                }
              : {
                  canonicalDiscoveryProblemLocked: true,
                  canonicalDiscoveryProblemFamily: lockedFamily,
                }),
          } as Prisma.JsonObject)
        : selected.raw;

    return {
      ...verified,
      selected: {
        ...selected,
        title: selectedTitle,
        problem: selectedProblem,
        need: canonicalSelected.need,
        solutionArea: canonicalSelected.solutionArea,
        evidenceSamples: canonicalSamples,
        frequency: verifiedCount,
        frequencyScore: Math.max(
          selected.frequencyScore,
          Math.min(1, verifiedCount / 5),
        ),
        evidenceScore: Math.max(
          selected.evidenceScore,
          Math.min(1, verifiedCount / 5),
        ),
        evidenceReliabilityScore: Math.max(
          selected.evidenceReliabilityScore,
          canonicalReliabilityFloor,
        ),
        supportScore: Math.max(selected.supportScore, canonicalSupportFloor),
        baseScore: Math.max(selected.baseScore, canonicalEvidenceStrength),
        finalScore: Math.max(selected.finalScore, canonicalEvidenceStrength),
        selectionEligible: canonicalSelectionEligible,
        disqualificationReasons: canonicalDisqualificationReasons,
        qualifiedExternalSupportingEvidenceCount: Math.max(
          selected.qualifiedExternalSupportingEvidenceCount ?? 0,
          canonicalSupportingCount,
        ),
        qualifiedExternalSupportingSourceCount: Math.max(
          selected.qualifiedExternalSupportingSourceCount ?? 0,
          canonicalSourceCount,
        ),
        verifiedProblemMatchedEvidenceCount: verifiedCount,
        verifiedEvidenceCount: Math.max(
          selected.verifiedEvidenceCount ?? 0,
          verifiedCount,
        ),
        verifiedProblemMatchedDirectUserEvidenceCount: Math.max(
          selected.verifiedProblemMatchedDirectUserEvidenceCount ?? 0,
          canonicalDirectCount,
        ),
        verifiedDirectUserEvidenceCount: Math.max(
          selected.verifiedDirectUserEvidenceCount ?? 0,
          canonicalDirectCount,
        ),
        verifiedProblemMatchedSourceCount: Math.max(
          selected.verifiedProblemMatchedSourceCount ?? 0,
          canonicalSourceCount,
        ),
        verifiedIndependentSourceCount: Math.max(
          selected.verifiedIndependentSourceCount ?? 0,
          canonicalSourceCount,
        ),
        verifiedEvidenceSourceCount: Math.max(
          selected.verifiedEvidenceSourceCount ?? 0,
          canonicalSourceCount,
        ),
        verifiedProblemMatchedEvidenceSourceCount: Math.max(
          selected.verifiedProblemMatchedEvidenceSourceCount ?? 0,
          canonicalSourceCount,
        ),
        raw,
      },
      evidenceCoverage: Math.max(
        verified.evidenceCoverage,
        Math.min(1, verifiedCount / 3),
      ),
      selectionReason: hasExplicitRequesterProblem
        ? `Preserved the requester-defined problem with canonical supporting family "${lockedFamily}" backed by ${verifiedCount} trusted item(s) across ${canonicalSourceCount} source(s).`
        : `Locked discovery ranking to canonical verified problem family "${lockedFamily}" with ${verifiedCount} family-matched trusted evidence item(s) across ${canonicalSourceCount} source(s).`,
      qualityWarnings: [
        ...(canonicalDirectCount === 0
          ? [
              `The canonical family is supported by ${canonicalSupportingCount} verified secondary/supporting signal(s) across ${canonicalSourceCount} source(s) but no direct retained user complaint; prevalence remains preliminary.`,
            ]
          : []),
        hasExplicitRequesterProblem
          ? 'The requester problem remains the product scope; the canonical evidence family corroborates that scope but cannot replace unsupported requester facets.'
          : 'The discovery winner is locked to the Community/canonical-ledger problem family; unrelated generic NLP taxonomy candidates cannot rename it downstream.',
        ...verified.qualityWarnings,
      ],
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
        !this.hasExplicitRequesterProblem(context) &&
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
        const problemCandidate = (
          familySemantics?.problem ??
          problemSentence ??
          strongest.body
        ).replace(/\s+/gu, ' ').trim();
        const boundedProblem = problemCandidate.length <= 260
          ? problemCandidate
          : (() => {
              const prefix = problemCandidate.slice(0, 261);
              const sentenceBoundary = Math.max(
                prefix.lastIndexOf('. '),
                prefix.lastIndexOf('! '),
                prefix.lastIndexOf('? '),
              );
              const wordBoundary = prefix.lastIndexOf(' ');
              const boundary = sentenceBoundary >= 120
                ? sentenceBoundary + 1
                : wordBoundary >= 120
                  ? wordBoundary
                  : 260;
              return prefix.slice(0, boundary).trim();
            })();
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
          uniqueSamples.map((item) =>
            EvidenceSourceIdentityUtil.resolve({
              sourceKey: item.sourceKey,
              text: item.sample,
            }),
          ),
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

    /*
     * Discovery winner identity is owned by Community AI after canonical
     * deterministic evidence verification.  A selected family that still has
     * verified DIRECT/SUPPORTING ledger items must never be downgraded here
     * merely because the independent-evidence adapter represented those items
     * as SUPPORTING rather than one of its direct-user evidence kinds.
     *
     * This was the last handoff hole behind runs where Community selected four
     * verified MyByram ordering signals, but this invariant later reset the
     * winner to zero evidence and made a generic Mental Health candidate
     * eligible.  Recurrence/source-diversity warnings remain unchanged; only
     * the false ZERO_EVIDENCE downgrade is blocked.
     */
    if (!this.hasExplicitRequesterProblem(context)) {
      const lockedFamily = context.communityAiAnalysis?.selectedProblemFamily?.trim() ?? '';
      const selectedIds = new Set(
        (context.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
          .map((id) => id.trim())
          .filter(Boolean),
      );
      const canonicalTrusted = (context.canonicalEvidenceLedger ?? []).filter(
        (item) =>
          selectedIds.has(item.id) &&
          item.verified &&
          (item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL'),
      );
      if (
        lockedFamily &&
        canonicalTrusted.length > 0 &&
        selected.title.trim().toLocaleLowerCase() ===
          lockedFamily.toLocaleLowerCase()
      ) {
        return ranking;
      }
    }
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
          (this.isCanonicalTrustedExternalEvidence(context, {
            text: item.text,
            sourceKey: item.sourceKey,
          }) ||
            this.passesFinalRequesterSupportingLedgerGuard(context, item.text)),
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
              this.hasExplicitRequesterProblem(context) && hasQualifiedContext,
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
        selectionEligible: Boolean(this.hasExplicitRequesterProblem(context) && hasQualifiedContext),
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

    return score;
  }

  private verifyQualifiedRequesterSupportingEvidence(
    context: IdeaGenerationContext,
    evidence: readonly RecoveredExternalEvidence[],
  ): readonly IndependentEvidence[] {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription || evidence.length === 0) return [];

    /*
     * These candidates were already admitted into the canonical evidence
     * ledger only after a complete Community-AI semantic verdict plus the
     * structural canonical verifier. Do not run a second keyword/overlap
     * semantic veto here: it can reject genuinely related evidence simply
     * because the requester and the source use different wording.
     *
     * The final boundary below is provenance-only: a row must still exist as a
     * verified canonical DIRECT/SUPPORTING item from the same source and with
     * the same normalized text. This preserves the AI-owned semantic verdict
     * while preventing arbitrary recovery text from bypassing the ledger.
     */
    const semanticallyQualified = evidence.filter((item) =>
      this.isCanonicalTrustedExternalEvidence(context, item),
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

  private isCanonicalTrustedEvidenceText(
    context: IdeaGenerationContext,
    evidenceText: string,
  ): boolean {
    const normalize = (value: string): string =>
      value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    const normalizedText = normalize(evidenceText);
    if (!normalizedText) return false;

    return (context.canonicalEvidenceLedger ?? []).some(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL') &&
        normalize(item.text) === normalizedText,
    );
  }

  private isCanonicalTrustedExternalEvidence(
    context: IdeaGenerationContext,
    evidence: Pick<RecoveredExternalEvidence, 'text' | 'sourceKey'>,
  ): boolean {
    const normalize = (value: string): string =>
      value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    const normalizedText = normalize(evidence.text);
    const normalizedSource = evidence.sourceKey.trim().toLocaleLowerCase();
    if (!normalizedText || !normalizedSource) return false;

    return (context.canonicalEvidenceLedger ?? []).some(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL') &&
        item.sourceKey.trim().toLocaleLowerCase() === normalizedSource &&
        normalize(item.text) === normalizedText,
    );
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

    if (!painAware) {
      return false;
    }
    if (context.collectionPlan?.problemProfile && !canonical) {
      return false;
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
        this.isCanonicalTrustedEvidenceText(context, item.text) ||
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
      ...(ranking.selected.independentEvidence ?? []).filter(
        (item) =>
          this.isCanonicalTrustedExternalEvidence(context, {
            text: item.text,
            sourceKey: item.sourceKey,
          }) || this.passesFinalRequesterSupportingLedgerGuard(context, item.text),
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
    const distinctSourceCount = EvidenceSourceIdentityUtil.count(
      mergedExternal.map((item) => ({
        sourceKey: item.sourceKey,
        text: item.text,
        id: item.postExternalId,
      })),
    );
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
      this.hasExplicitRequesterProblem(context) && supportingCount > 0;
    const selectionEligible =
      selected.selectionEligible || preliminarySupportingEligible;
    /*
     * A requester-defined workflow can remain the immutable product scope while
     * verified SUPPORTING_SIGNAL rows materially strengthen the opportunity.
     * Previously these rows were attached to the candidate but baseScore and
     * finalScore were deliberately left at the zero-evidence hypothesis value,
     * so three canonical signals across three independent sources could still
     * surface as a 0.41 opportunity. Score only structural evidence strength
     * here: count + independent-source diversity. Semantic ownership remains
     * with Community AI/canonical verification and the requester problem text
     * is never replaced by this calculation.
     */
    const supportingCountStrength = Math.min(1, supportingCount / 5);
    const supportingSourceStrength = Math.min(1, distinctSourceCount / 3);
    const qualifiedSupportingStrength = Math.min(
      0.86,
      Math.round(
        (0.28 +
          supportingCountStrength * 0.28 +
          supportingSourceStrength * 0.3) *
          1000,
      ) / 1000,
    );
    const evidenceReliabilityFloor = Math.min(
      0.84,
      0.48 + supportingCountStrength * 0.14 + supportingSourceStrength * 0.22,
    );
    const supportFloor = Math.min(
      0.82,
      0.4 + supportingCountStrength * 0.16 + supportingSourceStrength * 0.22,
    );
    const evidenceScoreFloor = Math.min(
      0.86,
      0.24 + supportingCountStrength * 0.3 + supportingSourceStrength * 0.28,
    );
    const evidenceReliabilityScore = Math.max(
      selected.evidenceReliabilityScore,
      evidenceReliabilityFloor,
    );
    const supportScore = Math.max(selected.supportScore, supportFloor);
    const evidenceScore = Math.max(selected.evidenceScore, evidenceScoreFloor);
    const baseScore = Math.max(selected.baseScore, qualifiedSupportingStrength);
    const finalScore = Math.max(selected.finalScore, qualifiedSupportingStrength);
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
         * These rows already passed Community AI semantic triage plus the
         * canonical/provenance verifier, so they are legitimate problem-matched
         * SUPPORTING_SIGNAL counters. They still remain distinct from direct-user
         * evidence and therefore never establish recurrence by themselves.
         */
        verifiedProblemMatchedEvidenceCount: Math.max(
          selected.verifiedProblemMatchedEvidenceCount ?? 0,
          supportingCount,
        ),
        verifiedProblemMatchedSecondaryEvidenceCount: Math.max(
          selected.verifiedProblemMatchedSecondaryEvidenceCount ?? 0,
          supportingCount,
        ),
        verifiedEvidenceSourceCount: Math.max(
          selected.verifiedEvidenceSourceCount ?? 0,
          distinctSourceCount,
        ),
        verifiedProblemMatchedSourceCount: Math.max(
          selected.verifiedProblemMatchedSourceCount ?? 0,
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
    const trustedCanonicalEvidence = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const trustedCanonicalIds = new Set(
      trustedCanonicalEvidence.map((item) => item.id.trim()).filter(Boolean),
    );
    const normalizeEvidenceText = (value: string): string =>
      value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    const trustedCanonicalTexts = new Set(
      trustedCanonicalEvidence.map((item) => normalizeEvidenceText(item.text)),
    );
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
    const trustedRetainedEntries = retainedEntries.filter((entry) =>
      trustedCanonicalIds.has(entry.id) ||
      trustedCanonicalTexts.has(normalizeEvidenceText(entry.text)),
    );
    const hasTrustedExternalEvidence = trustedRetainedEntries.length > 0;
    const strongestTrusted = trustedRetainedEntries[0] ?? null;

    const exactRequestEvidence = Boolean(
      requestDescription && strongestTrusted?.requestAligned,
    );
    const workflowAdjacentEvidence = Boolean(
      requestDescription && !exactRequestEvidence && Boolean(strongestTrusted?.workflowAdjacent),
    );
    const evidenceMatchedDomains = [
      ...new Set(
        (hasTrustedExternalEvidence ? trustedRetainedEntries : retainedEntries).flatMap((entry) =>
          entry.matchedDomainNames.length ? entry.matchedDomainNames : [entry.domainName],
        ),
      ),
    ];
    const domainLabel = evidenceMatchedDomains.join(' + ');
    const semanticAnchor = hasTrustedExternalEvidence
      ? strongestTrusted!
      : strongest;
    const canonicalAnchor = hasTrustedExternalEvidence
      ? trustedCanonicalEvidence.find(
          (item) =>
            item.id === strongestTrusted?.id ||
            normalizeEvidenceText(item.text) ===
              normalizeEvidenceText(strongestTrusted?.text ?? ''),
        ) ?? null
      : null;
    const canonicalAnchorFamily = canonicalAnchor?.problemFamily?.trim() ?? '';
    const familySemantics = canonicalAnchorFamily
      ? {
          familyKey: `canonical:${this.normalizeEvidenceKey(canonicalAnchorFamily)}`,
          problem: canonicalAnchorFamily,
          title: canonicalAnchorFamily,
          need: `A focused ${domainLabel || semanticAnchor.domainName} workflow should address the retained ${canonicalAnchorFamily.toLocaleLowerCase()} signal while preserving human review and validating recurrence before wider deployment.`,
          solutionArea: `${canonicalAnchorFamily} Response and Human-Reviewed Resolution`,
        }
      : this.resolveExternalFallbackFamilySemantics(
          semanticAnchor.body,
          domainLabel,
        );
    /*
     * With requester text, evidence may corroborate one or many facets but is
     * never allowed to rename, narrow, or replace the canonical problem.
     */
    const problem = requestDescription ||
      (hasTrustedExternalEvidence
        ? familySemantics?.problem || strongestTrusted?.body.slice(0, 360).trim() || null
        : `No canonical DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence survived verification in ${domainLabel || strongest.domainName}; a concrete external problem remains unvalidated.`);
    const title = requestDescription
      ? hasTrustedExternalEvidence
        ? 'Requester-Defined Workflow with Verified External Support'
        : 'Requester-Defined Workflow Validation Hypothesis'
      : hasTrustedExternalEvidence
        ? familySemantics?.title ?? `${strongestTrusted?.domainName ?? strongest.domainName} Evidence-Grounded Preliminary Opportunity`
        : `${strongest.domainName} Validation-First Opportunity`;
    const need = requestDescription
      ? hasTrustedExternalEvidence
        ? 'A focused implementation that preserves the complete requester-described workflow while using only canonical trusted external signals as complementary preliminary support. The pilot must validate the unproven mechanisms and prevalence without substituting a narrower evidence title for the requester problem.'
        : 'A focused implementation that preserves the complete requester-described workflow as an unvalidated hypothesis. Retrieval context may guide follow-up collection, but it must not be described as verified evidence or user feedback until canonical verification succeeds.'
      : hasTrustedExternalEvidence
        ? familySemantics?.need ?? `A focused implementation that addresses the retained ${domainLabel} problem signal without overstating what the evidence proves.`
        : `A validation workflow that continues evidence collection in ${domainLabel || strongest.domainName} before promoting a concrete problem into normal product generation.`;
    const solutionArea = requestDescription
      ? hasTrustedExternalEvidence
        ? 'Requester-Defined Workflow Implementation with Canonical Evidence Validation'
        : 'Requester-Defined Workflow Validation and Evidence Collection'
      : hasTrustedExternalEvidence
        ? familySemantics?.solutionArea ??
          'Evidence-grounded workflow implementation with explicit preliminary-pilot validation.'
        : 'Validation-first problem discovery and evidence collection.';
    const supportingEvidence = [
      ...trustedRetainedEntries.map((entry) => ({
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
        evidenceSamples: trustedRetainedEntries.map((entry) => entry.text),
        frequencyScore: 0.2,
        severityScore: 0.6,
        evidenceScore: hasTrustedExternalEvidence ? 0.16 : 0,
        evidenceReliabilityScore: !hasTrustedExternalEvidence
          ? 0
          : strongestTrusted?.directSignal
            ? 0.62
            : strongestTrusted?.secondaryOperationalSignal
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
        supportScore: !hasTrustedExternalEvidence
          ? 0
          : strongestTrusted?.directSignal
            ? 0.48
            : strongestTrusted?.secondaryOperationalSignal
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
        qualifiedExternalSupportingEvidenceCount: trustedRetainedEntries.length,
        qualifiedExternalSupportingSourceCount:
          EvidenceSourceIdentityUtil.count(trustedRetainedEntries),
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
          evidenceSamples: trustedRetainedEntries.map((entry) => entry.text),
          retrievalContextSamples: retainedEntries
            .filter((entry) => !trustedRetainedEntries.includes(entry))
            .map((entry) => entry.text),
          supportingEvidence,
          externalSourceKey: strongest.sourceKey || null,
          externalEvidenceStrength: !hasTrustedExternalEvidence
            ? 'UNVERIFIED_RETRIEVAL_CONTEXT'
            : strongestTrusted?.directSignal
              ? 'PRELIMINARY_DIRECT_SIGNAL'
              : 'PRELIMINARY_EXTERNAL_REPORT',
          evidenceMatchedDomainNames: evidenceMatchedDomains,
        } as unknown as Prisma.JsonValue,
      },
      alternatives: [],
      evaluatedCount: Math.max(1, entries.length),
      evidenceCoverage: hasTrustedExternalEvidence ? 1 / 3 : 0,
      selectionReason: requestDescription
        ? hasTrustedExternalEvidence
          ? `Selected the requester-defined workflow unchanged with ${trustedRetainedEntries.length} canonical trusted supporting item(s) across ${EvidenceSourceIdentityUtil.count(trustedRetainedEntries)} source(s). No evidence item is allowed to redefine the requester problem.`
          : 'Selected the requester-defined workflow unchanged as an unvalidated hypothesis. Retrieved context was not promoted because no canonical DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence survived verification.'
        : hasTrustedExternalEvidence
          ? `Selected ${trustedRetainedEntries.length} canonical trusted problem signal(s) from the evidence-backed domain lane (${domainLabel}) without fabricating recurrence.`
          : `No canonical trusted problem signal survived; retained retrieval context is diagnostic only and the selected direction remains validation-first.`,
      qualityWarnings: [
        hasTrustedExternalEvidence
          ? `The selected direction is supported by ${trustedRetainedEntries.length} canonical trusted item(s) across ${EvidenceSourceIdentityUtil.count(trustedRetainedEntries)} source(s) and must remain preliminary until direct recurrence is validated.`
          : context.evidenceState === 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
            ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE: raw retrieval context exists, but semantic AI adjudication did not complete; the corpus must not be described as unrelated or as proof of no evidence.'
            : 'NO_VALID_EVIDENCE_FOUND: semantic adjudication completed but no canonical trusted evidence supports an external-demand claim.',
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

    const lockedDiscoveryFamily = !this.hasExplicitRequesterProblem(context) &&
      (analysis.selectedProblemFamilyTrustedEvidenceCount ?? 0) > 0
        ? analysis.selectedProblemFamily?.trim() ?? ''
        : '';
    const normalizeFamily = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const normalizedLockedDiscoveryFamily = normalizeFamily(lockedDiscoveryFamily);

    let candidates = analysis.opportunities
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

    /*
     * Community AI has already selected the evidence-leading discovery family.
     * Ranking is allowed to validate provenance and enrich scores, but it is
     * not a second problem-selection model.  When a verified canonical family
     * exists, build the fallback from that exact Community opportunity instead
     * of re-sorting all Community opportunities by generic confidence fields.
     */
    if (normalizedLockedDiscoveryFamily) {
      const lockedCandidates = candidates.filter((opportunity) => {
        const title = normalizeFamily(opportunity.title);
        const problem = normalizeFamily(opportunity.problem);
        return (
          title === normalizedLockedDiscoveryFamily ||
          problem === normalizedLockedDiscoveryFamily ||
          title.includes(normalizedLockedDiscoveryFamily) ||
          normalizedLockedDiscoveryFamily.includes(title)
        );
      });
      if (lockedCandidates.length > 0) {
        candidates = lockedCandidates;
      }
    }

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
        (selected.independentEvidence ?? []).map((evidence) =>
          EvidenceSourceIdentityUtil.resolve({
            sourceKey: evidence.sourceKey,
            text: evidence.text,
            id: evidence.postExternalId,
          }),
        ),
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

  private resolveSelectedProblemFamilyTrustedSourceKeys(
    context: IdeaGenerationContext,
  ): string[] {
    const trusted = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const selectedIds = new Set(
      (context.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const selected =
      selectedIds.size > 0
        ? trusted.filter((item) => selectedIds.has(item.id))
        : trusted;
    const sourceKeysToExclude: string[] = selected.flatMap((item) => {
      const collectorKey = item.sourceKey.trim().toLocaleLowerCase();
      if (!collectorKey) return [];
      const independentIdentity = EvidenceSourceIdentityUtil.resolve(item);

      /*
       * Do not exclude an entire documentary collector merely because the
       * current family contains one publisher fetched through it. For example,
       * `news` may have supplied CBC and can still corroborate the same family
       * from Reuters or a municipal publisher. Community/forum sources whose
       * independent identity is the collector itself are rotated normally.
       */
      return independentIdentity === collectorKey ? [collectorKey] : [];
    });
    return [...new Set<string>(sourceKeysToExclude)].filter(Boolean);
  }

  private canonicalEvidenceSupportsFamily(
    family: string,
    evidenceFamily: string | null,
    evidenceText: string,
  ): boolean {
    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const selected = normalize(family);
    const evidence = normalize(evidenceFamily ?? '');
    if (!selected) return false;
    if (evidence && selected === evidence) return true;
    if (
      evidence &&
      (selected.includes(evidence) || evidence.includes(selected))
    ) {
      return true;
    }
    return matchEvidenceToProblemFamily(family, evidenceText).matched;
  }

  private canonicalEvidenceGroupSupportsFamily(
    family: string,
    items: readonly IdeaGenerationContext['canonicalEvidenceLedger'][number][],
  ): boolean {
    if (!family.trim() || items.length === 0) return false;
    if (
      items.some((item) =>
        this.canonicalEvidenceSupportsFamily(
          family,
          item.problemFamily,
          item.text,
        ),
      )
    ) {
      return true;
    }
    const combinedEvidence = items.map((item) => item.text).join(' ');
    if (matchEvidenceToProblemFamily(family, combinedEvidence).matched) {
      return true;
    }

    return this.canonicalFamilyTokenCoverage(family, combinedEvidence);
  }

  /**
   * Revalidates a canonical family against the selected trusted evidence as a
   * group. This is intentionally family-level rather than item-level so
   * complementary cross-domain rows are not discarded merely because each row
   * covers a different facet of the same verified problem family.
   */
  private canonicalFamilyTokenCoverage(
    family: string,
    combinedEvidence: string,
  ): boolean {
    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const stop = new Set([
      'problem', 'problems', 'challenge', 'challenges', 'issue', 'issues',
      'workflow', 'workflows', 'system', 'systems', 'service', 'services',
      'user', 'users', 'operational', 'technical', 'selected', 'domain',
      'domains', 'across', 'using', 'with', 'from', 'into', 'that', 'this',
      'their', 'they', 'them', 'when', 'where', 'which', 'while', 'more',
    ]);
    const stem = (token: string): string =>
      token.length >= 8 ? token.slice(0, 6) : token.length >= 6 ? token.slice(0, 5) : token;
    const tokens = (value: string): string[] =>
      normalize(value)
        .split(/\s+/u)
        .filter((token) => token.length >= 3 && !stop.has(token))
        .map(stem);

    const familyTokens = [...new Set(tokens(family))];
    const evidenceTokens = new Set(tokens(combinedEvidence));
    if (familyTokens.length < 2 || evidenceTokens.size < 2) return false;

    const covered = familyTokens.filter((token) => evidenceTokens.has(token)).length;
    const required = Math.max(2, Math.ceil(familyTokens.length * 0.55));
    return covered >= required;
  }

  private selectStrongestCanonicalTrustedFamily(
    trusted: readonly IdeaGenerationContext['canonicalEvidenceLedger'][number][],
  ): IdeaGenerationContext['canonicalEvidenceLedger'] {
    let best: IdeaGenerationContext['canonicalEvidenceLedger'] = [];
    let bestScore = Number.NEGATIVE_INFINITY;
    const families = [...new Set(
      trusted
        .map((item) => item.problemFamily?.trim() ?? '')
        .filter(Boolean),
    )];

    for (const family of families) {
      const items = trusted.filter((item) =>
        this.canonicalEvidenceSupportsFamily(
          family,
          item.problemFamily,
          item.text,
        ),
      );
      if (items.length === 0) continue;
      const directCount = items.filter(
        (item) => item.classification === 'DIRECT_PROBLEM',
      ).length;
      const sourceCount = EvidenceSourceIdentityUtil.count(items);
      const avgConfidence =
        items.reduce((sum, item) => sum + item.confidence, 0) /
        Math.max(1, items.length);
      const score =
        directCount * 100 +
        sourceCount * 35 +
        items.length * 20 +
        avgConfidence;
      if (score > bestScore) {
        bestScore = score;
        best = items;
      }
    }

    if (best.length > 0) {
      return [...best].sort((left, right) => {
        const leftDirect =
          left.classification === 'DIRECT_PROBLEM' ? 1 : 0;
        const rightDirect =
          right.classification === 'DIRECT_PROBLEM' ? 1 : 0;
        return (
          rightDirect - leftDirect ||
          right.confidence - left.confidence
        );
      });
    }

    return [...trusted]
      .sort((left, right) => {
        const leftDirect =
          left.classification === 'DIRECT_PROBLEM' ? 1 : 0;
        const rightDirect =
          right.classification === 'DIRECT_PROBLEM' ? 1 : 0;
        return (
          rightDirect - leftDirect ||
          right.confidence - left.confidence
        );
      })
      .slice(0, 1);
  }

  private buildCanonicalTrustedRecoveredExternalEvidence(
    context: IdeaGenerationContext,
    recoveryRaw: readonly IdeaGenerationContext['rawEvidenceCorpus'][number][],
  ): RecoveredExternalEvidence[] {
    const rawById = new Map(
      recoveryRaw.map((item) => [item.id, item] as const),
    );
    const canonicalTrusted = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        rawById.has(item.id) &&
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );

    return canonicalTrusted.flatMap((item) => {
      const raw = rawById.get(item.id);
      if (!raw) return [];
      const externalId =
        raw.id.split(':').slice(2).join(':') || raw.id;
      const parentExternalId =
        raw.postId?.split(':').slice(2).join(':') || externalId;
      return [{
        text: raw.text,
        sourceKey: raw.sourceKey,
        postExternalId:
          raw.sourceType === 'COMMENT'
            ? parentExternalId
            : externalId,
        commentExternalId:
          raw.sourceType === 'COMMENT'
            ? externalId
            : null,
        sourceType: raw.sourceType,
        discoveryDomainId: raw.discoveryDomainId ?? null,
        discoveryDomainName: raw.discoveryDomainName ?? null,
        queryIntentId: raw.queryIntentId ?? null,
        queryText: raw.queryText ?? null,
        problemFacetIds: raw.problemFacetIds ?? [],
        collectionPhase: raw.collectionPhase ?? 'RECOVERY',
        sourceTier: raw.sourceTier ?? 'PRIMARY',
      }];
    });
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
      evidenceKind: item.evidenceKind,
      adjudicationStatus: item.adjudicationStatus,
      adjudicationFailureReason: item.adjudicationFailureReason ?? null,
      evidenceNature: item.evidenceNature,
      domainAlignment: item.domainAlignment,
      problemAlignment: item.problemAlignment,
      familyBasis: item.familyBasis,
      observedProblem: item.observedProblem ?? null,
      causalExplanation: item.causalExplanation ?? null,
      matchedDomainNames: [...(item.matchedDomainNames ?? [])],
    }));
    const trustedCanonicalItems = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const canonicalLabel =
      context.communityAiAnalysis?.canonicalProblemFamilyLabel?.trim() ||
      context.communityAiAnalysis?.selectedProblemFamily?.trim() ||
      null;
    const existingCanonicalId =
      context.communityAiAnalysis?.canonicalProblemFamilyId?.trim() || null;
    const lockedEvidenceIds = [...new Set(
      (context.communityAiAnalysis?.canonicalProblemFamilyEvidenceIds ??
        context.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    )];
    const lockedEvidenceIdSet = new Set(lockedEvidenceIds);
    const lockedTrustedItems = canonicalLabel
      ? trustedCanonicalItems.filter((item) => lockedEvidenceIdSet.has(item.id))
      : [];
    const lockRemainsValid = Boolean(
      canonicalLabel &&
      lockedEvidenceIds.length > 0 &&
      lockedTrustedItems.length === lockedEvidenceIds.length &&
      this.canonicalEvidenceGroupSupportsFamily(
        canonicalLabel,
        lockedTrustedItems,
      ),
    );
    const canonicalId = lockRemainsValid
      ? existingCanonicalId ?? this.createCanonicalProblemFamilyId(
          canonicalLabel!,
          lockedEvidenceIds,
        )
      : null;

    // Canonical identity is immutable after Community/ledger verification.
    // Ranking only rechecks that every locked row is still trusted and that the
    // selected rows collectively support the family. It must never require each
    // row to repeat the complete family, because complementary cross-domain
    // evidence can legitimately prove different facets of one shared problem.
    // If the group no longer supports the lock, clear it instead of silently
    // switching to a different problem identity.
    const selectedProblemFamily = lockRemainsValid ? canonicalLabel : null;
    const normalizeFamilyIdentity = (value: string | null | undefined): string =>
      (value ?? '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const canonicalFamilyIdentity = normalizeFamilyIdentity(canonicalLabel);
    const corroboratingTrustedItems = lockRemainsValid
      ? trustedCanonicalItems.filter((item) => {
          if (lockedEvidenceIdSet.has(item.id)) return false;
          if (!item.problemFamily?.trim()) return false;
          const itemFamilyIdentity = normalizeFamilyIdentity(item.problemFamily);
          if (!itemFamilyIdentity || !canonicalFamilyIdentity) return false;
          if (itemFamilyIdentity === canonicalFamilyIdentity) return true;
          const shorter = Math.min(
            itemFamilyIdentity.length,
            canonicalFamilyIdentity.length,
          );
          return shorter >= 18 && (
            itemFamilyIdentity.includes(canonicalFamilyIdentity) ||
            canonicalFamilyIdentity.includes(itemFamilyIdentity)
          );
        })
      : [];
    /*
     * Recovery may strengthen an immutable family with new verified publishers
     * without changing its identity. Only rows that already survived canonical
     * verification and carry the same AI-owned family label are appended. The
     * original locked ids remain the validity anchor and canonical hash input.
     */
    const selectedCanonicalItems = lockRemainsValid
      ? [...lockedTrustedItems, ...corroboratingTrustedItems]
      : [];
    const priorSelectionSource =
      context.communityAiAnalysis?.selectedProblemFamilySelectionSource ?? null;
    const selectedProblemFamilySelectionSource = lockRemainsValid
      ? priorSelectionSource === 'AI_SELECTED_PENDING_VERIFICATION'
        ? 'AI_SELECTED_VERIFIED'
        : priorSelectionSource ?? 'DETERMINISTIC_VERIFIED_FALLBACK'
      : context.communityAiAnalysis?.aiProposedProblemFamily?.trim()
        ? 'AI_PROPOSAL_REJECTED'
        : null;

    const canonicalOpportunity = lockRemainsValid
      ? context.communityAiAnalysis?.opportunities.find((opportunity) =>
          this.canonicalEvidenceSupportsFamily(
            canonicalLabel!,
            opportunity.title,
            opportunity.problem,
          ),
        ) ?? context.communityAiAnalysis?.opportunities[0] ?? null
      : null;
    const canonicalDistinctSourceCount =
      EvidenceSourceIdentityUtil.count(selectedCanonicalItems);
    const selectedCanonicalDirectCount = selectedCanonicalItems.filter(
      (item) => item.classification === 'DIRECT_PROBLEM',
    ).length;
    const reconciledCanonicalEvidenceSamples = selectedCanonicalItems.map(
      (item) => item.text,
    );
    const reconciledCanonicalOpportunity =
      lockRemainsValid && canonicalOpportunity
        ? {
            ...canonicalOpportunity,
            title: canonicalLabel!,
            frequency: selectedCanonicalItems.length,
            evidenceSamples: reconciledCanonicalEvidenceSamples,
            localEvidenceSamples: canonicalOpportunity.localEvidenceSamples.filter(
              (sample) =>
                reconciledCanonicalEvidenceSamples.some(
                  (evidenceSample) => evidenceSample === sample,
                ),
            ),
            localEvidenceAvailable: canonicalOpportunity.localEvidenceSamples.some(
              (sample) =>
                reconciledCanonicalEvidenceSamples.some(
                  (evidenceSample) => evidenceSample === sample,
                ),
            ),
            groundingScore: selectedCanonicalItems.length > 0 ? 100 : 0,
            risks: [
              `The selected problem family is grounded by ${selectedCanonicalItems.length} retained verified evidence item(s) across ${canonicalDistinctSourceCount} distinct source(s); broader validation is still required before prevalence claims are made.`,
            ],
          }
        : null;
    const finalEvidenceVerdictState =
      state.trustedCount > 0
        ? ('VALID_EVIDENCE_FOUND' as const)
        : state.state === 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
          ? ('EVIDENCE_ADJUDICATION_UNAVAILABLE' as const)
          : ('NO_VALID_EVIDENCE_FOUND' as const);
    const finalStateWarning = state.state === 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
      ? 'Canonical evidence state is EVIDENCE_ADJUDICATION_UNAVAILABLE; at least one collected raw row still lacks an online semantic verdict, so the final run must not claim that no evidence exists.'
      : state.state === 'NO_VALID_EVIDENCE_FOUND'
        ? 'Canonical evidence state is NO_VALID_EVIDENCE_FOUND; semantic adjudication completed and no DIRECT_PROBLEM or SUPPORTING_SIGNAL row survived canonical verification.'
        : null;
    const reconciledTrustedCount = selectedCanonicalItems.length > 0
      ? selectedCanonicalItems.length
      : state.trustedCount;
    const reconciledSourceCount = selectedCanonicalItems.length > 0
      ? canonicalDistinctSourceCount
      : state.sourceCount;
    const finalSupportWarning = reconciledTrustedCount > 0
      ? `Canonical evidence reconciliation retained ${reconciledTrustedCount} trusted DIRECT/SUPPORTING signal(s) across ${reconciledSourceCount} independent provenance source(s); broader prevalence remains unproven unless direct recurrence evidence is separately verified.`
      : null;
    const reconciledQualityWarnings = context.communityAiAnalysis
      ? Array.from(new Set([
          ...context.communityAiAnalysis.qualityWarnings.filter(
            (warning) =>
              !/Canonical evidence state is (?:NO_VALID_EVIDENCE_FOUND|EVIDENCE_ADJUDICATION_UNAVAILABLE)/iu.test(warning) &&
              !/semantic adjudication completed but no DIRECT_PROBLEM or SUPPORTING_SIGNAL/iu.test(warning) &&
              !/Canonical evidence retained \d+ trusted problem signal/iu.test(warning) &&
              !/selected direction is grounded by \d+ canonical supporting signal/iu.test(warning) &&
              !(reconciledTrustedCount > 0 &&
                /No synthesis-eligible (?:recovered )?evidence remained/iu.test(warning)) &&
              !(reconciledTrustedCount > 0 &&
                warning.includes('No external evidence-backed partial candidate survived verification')) &&
              !(reconciledTrustedCount > 0 &&
                warning.includes('No sufficiently request-aligned direct community problem was established')) &&
              !(selectedCanonicalDirectCount > 0 &&
                warning.includes('No verified direct-user complaint establishes recurrence')) &&
              !(selectedCanonicalDirectCount > 0 &&
                warning.includes('No verified direct user complaint establishes recurrence')),
          ),
          ...(finalStateWarning ? [finalStateWarning] : []),
          ...(finalSupportWarning ? [finalSupportWarning] : []),
        ]))
      : [];
    const communityAiAnalysis = context.communityAiAnalysis
      ? {
          ...context.communityAiAnalysis,
          evidenceVerdictState: finalEvidenceVerdictState,
          qualityWarnings: reconciledQualityWarnings,
          triageAiSucceeded:
            state.adjudicatedCount > 0
              ? true
              : context.communityAiAnalysis.triageAiSucceeded,
          summary: lockRemainsValid
            ? `Canonical evidence verification locked the problem family to "${canonicalLabel}" using ${selectedCanonicalItems.length} verified family-matched signal(s) across ${canonicalDistinctSourceCount} distinct source(s). This identity is immutable downstream.`
            : context.communityAiAnalysis.summary,
          dominantProblems: reconciledCanonicalOpportunity
            ? [reconciledCanonicalOpportunity.problem]
            : [],
          unmetNeeds: reconciledCanonicalOpportunity
            ? [reconciledCanonicalOpportunity.unmetNeed]
            : [],
          opportunities: reconciledCanonicalOpportunity
            ? [reconciledCanonicalOpportunity]
            : [],
          evidenceClassifications: classifications,
          selectedProblemFamily,
          selectedProblemFamilySelectionSource,
          selectedProblemFamilyEvidenceIds: selectedCanonicalItems.map((item) => item.id),
          canonicalProblemFamilyId: canonicalId,
          canonicalProblemFamilyLabel: lockRemainsValid ? canonicalLabel : null,
          canonicalProblemFamilyEvidenceIds: selectedCanonicalItems.map((item) => item.id),
          selectedProblemFamilyTrustedEvidenceCount: selectedCanonicalItems.length,
          selectedProblemFamilyDistinctSourceCount: canonicalDistinctSourceCount,
        }
      : null;

    const insights = Array.isArray(context.nlp?.insights)
      ? context.nlp!.insights.map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
          const record = entry as Record<string, unknown>;
          if (record.type !== 'COMMUNITY_AI_ANALYSIS') return entry;
          return {
            ...record,
            summary: communityAiAnalysis?.summary ?? record.summary,
            dominantProblems: communityAiAnalysis?.dominantProblems ?? [],
            unmetNeeds: communityAiAnalysis?.unmetNeeds ?? [],
            evidenceClassifications: classifications,
            evidenceVerdictState: finalEvidenceVerdictState,
            evidenceAdjudicationUnavailable:
              state.state === 'EVIDENCE_ADJUDICATION_UNAVAILABLE',
            unadjudicatedEvidenceClassificationCount: state.unadjudicatedCount,
            /*
             * Every public/debug counter is recomputed from the merged
             * canonical stores after recovery. Never keep the first-pass raw
             * count beside post-recovery classifications.
             */
            rawEvidenceCandidateCount: Math.max(
              context.rawEvidenceCorpus?.length ?? 0,
              classifications.length,
            ),
            triageEligibleEvidenceCount: Math.max(
              context.rawEvidenceCorpus?.length ?? 0,
              classifications.length,
            ),
            reviewedEvidenceCandidateCount: classifications.length,
            contextualEvidenceCandidateCount: classifications.filter(
              (item) =>
                item.classification === 'CONTEXT_ONLY' ||
                item.classification === 'ANALOGOUS_WORKFLOW_SIGNAL',
            ).length,
            trustedNlpEvidenceCount: state.trustedCount,
            selectedProblemFamily:
              communityAiAnalysis?.selectedProblemFamily ?? null,
            selectedProblemFamilySelectionSource:
              communityAiAnalysis?.selectedProblemFamilySelectionSource ?? null,
            selectedProblemFamilyTrustedEvidenceCount:
              communityAiAnalysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0,
            selectedProblemFamilyDistinctSourceCount:
              communityAiAnalysis?.selectedProblemFamilyDistinctSourceCount ?? 0,
            selectedProblemFamilyEvidenceIds:
              [...(communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])],
            canonicalProblemFamilyId:
              communityAiAnalysis?.canonicalProblemFamilyId ?? null,
            canonicalProblemFamilyLabel:
              communityAiAnalysis?.canonicalProblemFamilyLabel ?? null,
            canonicalProblemFamilyEvidenceIds:
              [...(communityAiAnalysis?.canonicalProblemFamilyEvidenceIds ?? [])],
            directEvidenceClassificationCount: state.directCount,
            supportingEvidenceClassificationCount: state.supportingCount,
            analogousWorkflowSignalClassificationCount: (context.canonicalEvidenceLedger ?? []).filter(
              (item) => item.classification === 'ANALOGOUS_WORKFLOW_SIGNAL',
            ).length,
            contextOnlyEvidenceClassificationCount: (context.canonicalEvidenceLedger ?? []).filter(
              (item) => item.classification === 'CONTEXT_ONLY',
            ).length,
            unrelatedEvidenceClassificationCount: (context.canonicalEvidenceLedger ?? []).filter(
              (item) => item.classification === 'UNRELATED',
            ).length,
          } as Prisma.JsonObject;
        })
      : context.nlp?.insights ?? null;

    const reconciledNlpOpportunity: Prisma.JsonObject | null =
      reconciledCanonicalOpportunity
        ? {
            domainName: reconciledCanonicalOpportunity.domainName,
            title: reconciledCanonicalOpportunity.title,
            problem: reconciledCanonicalOpportunity.problem,
            need: reconciledCanonicalOpportunity.unmetNeed,
            solutionArea: reconciledCanonicalOpportunity.solutionArea,
            affectedUsers: [...reconciledCanonicalOpportunity.affectedUsers],
            frequency: reconciledCanonicalOpportunity.frequency,
            severity: reconciledCanonicalOpportunity.severity,
            evidenceSamples: [...reconciledCanonicalOpportunity.evidenceSamples],
            confidence: reconciledCanonicalOpportunity.confidence,
            problemImportance: reconciledCanonicalOpportunity.problemImportance,
            localRelevance: reconciledCanonicalOpportunity.localRelevance,
            technicalFeasibility:
              reconciledCanonicalOpportunity.technicalFeasibility,
            marketPotential: reconciledCanonicalOpportunity.marketPotential,
            innovationPotential:
              reconciledCanonicalOpportunity.innovationPotential,
            risks: [...reconciledCanonicalOpportunity.risks],
            source: 'COMMUNITY_LLM_ANALYSIS',
          }
        : null;
    const reconciledRecurringProblems: Prisma.JsonValue | null =
      reconciledCanonicalOpportunity
        ? ([
            {
              domainName: reconciledCanonicalOpportunity.domainName,
              title: reconciledCanonicalOpportunity.title,
              problem: reconciledCanonicalOpportunity.problem,
              frequency: reconciledCanonicalOpportunity.frequency,
              severity: reconciledCanonicalOpportunity.severity,
              evidenceSamples: [...reconciledCanonicalOpportunity.evidenceSamples],
              source: 'COMMUNITY_LLM_ANALYSIS',
              aiConfidence: reconciledCanonicalOpportunity.confidence,
            },
          ] as Prisma.JsonArray)
        : state.trustedCount === 0
          ? ([] as Prisma.JsonArray)
          : context.nlp?.recurringProblems ?? null;
    const reconciledExtractedNeeds: Prisma.JsonValue | null =
      reconciledCanonicalOpportunity
        ? ([
            {
              domainName: reconciledCanonicalOpportunity.domainName,
              title: reconciledCanonicalOpportunity.unmetNeed,
              need: reconciledCanonicalOpportunity.unmetNeed,
              problem: reconciledCanonicalOpportunity.problem,
              solutionArea: reconciledCanonicalOpportunity.solutionArea,
              frequency: reconciledCanonicalOpportunity.frequency,
              severity: reconciledCanonicalOpportunity.severity,
              evidenceSamples: [...reconciledCanonicalOpportunity.evidenceSamples],
              source: 'COMMUNITY_LLM_ANALYSIS',
            },
          ] as Prisma.JsonArray)
        : state.trustedCount === 0
          ? ([] as Prisma.JsonArray)
          : context.nlp?.extractedNeeds ?? null;
    const reconciledNlpOpportunities: Prisma.JsonValue | null =
      reconciledNlpOpportunity
        ? ([reconciledNlpOpportunity] as Prisma.JsonArray)
        : state.trustedCount === 0
          ? ([] as Prisma.JsonArray)
          : context.nlp?.opportunities ?? null;

    return {
      ...context,
      evidenceState: state.state,
      communityAiAnalysis,
      nlp: context.nlp
        ? {
            ...context.nlp,
            recurringProblems: reconciledRecurringProblems,
            extractedNeeds: reconciledExtractedNeeds,
            opportunities: reconciledNlpOpportunities,
            insights,
          }
        : context.nlp,
    };
  }

  private createCanonicalProblemFamilyId(
    label: string,
    evidenceIds: readonly string[],
  ): string {
    const normalizedLabel = label
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    return createHash('sha256')
      .update(`${normalizedLabel}|${[...evidenceIds].sort().join('|')}`)
      .digest('hex')
      .slice(0, 24);
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
    let synchronizedContext = this.synchronizeCanonicalEvidenceState(context);
    let intentAlignedRanking = this.applyRequestIntentAlignment(ranking, synchronizedContext);
    /*
     * Final request-scope reconciliation: if an explicit-problem candidate is
     * still WEAK/UNRELATED after all bounded recovery, retained provider rows
     * remain adjudicated audit context but cannot count as trusted evidence for
     * that requester problem. This converts a false single-source family lock
     * into honest CONTEXT_ONLY rows instead of fabricating request grounding.
     */
    const requestScopedContext = this.releaseWeakExplicitRequestCanonicalLock(
      synchronizedContext,
      intentAlignedRanking,
      true,
    );
    if (requestScopedContext !== synchronizedContext) {
      synchronizedContext = this.synchronizeCanonicalEvidenceState(
        requestScopedContext,
      );
      intentAlignedRanking = this.applyRequestIntentAlignment(
        ranking,
        synchronizedContext,
      );
    }
    const provenanceNormalizedRanking =
      this.independentEvidenceVerificationService.normalizeVerifiedRankingProvenance(
        intentAlignedRanking,
      );
    const orderedBeforeCanonicalLock = this.normalizeFinalRankingEvidenceCoverage(
      this.normalizeFinalOpportunityOrdering(provenanceNormalizedRanking),
      synchronizedContext,
    );
    const canonicalInvariantRanking = this.enforceCanonicalLedgerRankingInvariant(
      synchronizedContext,
      this.enforceCanonicalDiscoveryRankingAtHandoff(
        synchronizedContext,
        orderedBeforeCanonicalLock,
      ),
    );
    const requesterLockedRanking = this.enforceExplicitRequesterRankingAtHandoff(
      synchronizedContext,
      canonicalInvariantRanking,
    );
    /*
     * Canonical counts are the final source of truth. Warning normalization used
     * to run before the canonical handoff, so an intermediate verifier could
     * leave text such as "1 secondary / no direct" beside a final ledger of
     * 7 DIRECT + 1 SUPPORTING. Rebuild warning/coverage narratives only after
     * canonical and requester identity locks have finished.
     */
    const normalizedRanking = this.normalizeFinalRankingWarnings(
      this.normalizeFinalRankingEvidenceCoverage(
        requesterLockedRanking,
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
        // Keep global corpus evidence metrics separate from the canonical
        // winner's own evidence. This prevents a discovery run with seven
        // trusted signals across several families from presenting all seven
        // as support for the one selected family.
        selectedProblemFamily:
          updatedContext.communityAiAnalysis?.selectedProblemFamily ?? null,
        selectedProblemFamilyTrustedEvidenceCount:
          updatedContext.communityAiAnalysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0,
        selectedProblemFamilyDistinctSourceCount:
          updatedContext.communityAiAnalysis?.selectedProblemFamilyDistinctSourceCount ?? 0,
        selectedProblemFamilyEvidenceIds:
          [...(updatedContext.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])],
        globalTrustedEvidenceCount:
          CanonicalEvidenceStateUtil.compute(
            updatedContext.canonicalEvidenceLedger ?? [],
          ).trustedCount,
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
   * Hard handoff invariant between evidence analysis and every downstream
   * stage. Ranking may score, order, and attach provenance, but it may never
   * manufacture a verified-evidence count that is absent from the canonical
   * ledger. Conversely, a verified canonical row is never dropped merely
   * because an adapter represented it differently.
   */
  private enforceCanonicalLedgerRankingInvariant(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    const canonicalTrusted = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const selectedIds = new Set(
      (context.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const explicitRequesterProblem = this.hasExplicitRequesterProblem(context);
    const selectedTrusted =
      selectedIds.size > 0
        ? canonicalTrusted.filter((item) => selectedIds.has(item.id))
        : explicitRequesterProblem
          ? []
          : canonicalTrusted;

    const normalize = (value: string): string =>
      value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    const globallyAllowedTexts = new Set(canonicalTrusted.map((item) => normalize(item.text)));
    const selectedAllowedTexts = new Set(selectedTrusted.map((item) => normalize(item.text)));

    const clearNonCanonicalCandidate = (
      candidate: RankedIdeaOpportunity,
      injectSelectedCanonical: boolean,
    ): RankedIdeaOpportunity => {
      const allowedTexts = injectSelectedCanonical
        ? selectedAllowedTexts
        : globallyAllowedTexts;
      const retainedSamples = candidate.evidenceSamples.filter((sample) =>
        allowedTexts.has(normalize(sample)),
      );
      const retainedIndependent = (candidate.independentEvidence ?? []).filter((item) =>
        allowedTexts.has(normalize(item.text)),
      );
      const retainedSupporting = (candidate.supportingEvidence ?? []).filter((item) =>
        allowedTexts.has(normalize(item.text)),
      );
      const retainedCount = Math.max(
        retainedSamples.length,
        retainedIndependent.length,
        retainedSupporting.length,
      );

      if (retainedCount > 0) {
        return {
          ...candidate,
          evidenceSamples: retainedSamples,
          independentEvidence: retainedIndependent,
          supportingEvidence: retainedSupporting,
        };
      }

      const reasons = new Set(candidate.disqualificationReasons);
      reasons.add('NO_DIRECT_EVIDENCE');
      reasons.add('INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE');
      return {
        ...candidate,
        evidenceSamples: [],
        independentEvidence: [],
        supportingEvidence: [],
        frequency: 0,
        frequencyScore: 0,
        evidenceScore: 0,
        evidenceReliabilityScore: 0,
        supportScore: 0,
        selectionEligible: false,
        disqualificationReasons: [...reasons],
        qualifiedExternalSupportingEvidenceCount: 0,
        qualifiedExternalSupportingSourceCount: 0,
        verifiedIndependentEvidenceCount: 0,
        verifiedIndependentSourceCount: 0,
        verifiedEvidenceCount: 0,
        verifiedDirectUserEvidenceCount: 0,
        verifiedSecondaryEvidenceCount: 0,
        verifiedTechnicalEvidenceCount: 0,
        verifiedQuestionEvidenceCount: 0,
        verifiedObservationEvidenceCount: 0,
        verifiedComplaintEvidenceCount: 0,
        verifiedComplaintSourceCount: 0,
        verifiedFeatureRequestEvidenceCount: 0,
        verifiedEvidenceSourceCount: 0,
        verifiedProblemMatchedEvidenceCount: 0,
        verifiedProblemMatchedDirectUserEvidenceCount: 0,
        verifiedProblemMatchedSecondaryEvidenceCount: 0,
        verifiedProblemMatchedTechnicalEvidenceCount: 0,
        verifiedProblemMatchedQuestionEvidenceCount: 0,
        verifiedProblemMatchedObservationEvidenceCount: 0,
        verifiedProblemMatchedComplaintEvidenceCount: 0,
        verifiedProblemMatchedComplaintSourceCount: 0,
        verifiedProblemMatchedFeatureRequestEvidenceCount: 0,
        verifiedProblemMatchedSourceCount: 0,
        verifiedProblemMatchedEvidenceSourceCount: 0,
      };
    };

    if (selectedTrusted.length === 0) {
      const selected = clearNonCanonicalCandidate(ranking.selected, true);
      return {
        ...ranking,
        selected,
        alternatives: ranking.alternatives.map((candidate) =>
          clearNonCanonicalCandidate(candidate, false),
        ),
        evidenceCoverage: 0,
        selectionReason:
          `${ranking.selectionReason} Canonical handoff verified zero trusted DIRECT/SUPPORTING evidence; all downstream evidence counters were reset to zero.`,
        qualityWarnings: Array.from(new Set([
          ...ranking.qualityWarnings,
          'The canonical evidence ledger contains no verified DIRECT_PROBLEM or SUPPORTING_SIGNAL item; downstream ranking cannot promote context-only, analogous, or independently reconstructed evidence.',
        ])),
      };
    }

    const directCount = selectedTrusted.filter(
      (item) => item.classification === 'DIRECT_PROBLEM',
    ).length;
    const supportingCount = selectedTrusted.filter(
      (item) => item.classification === 'SUPPORTING_SIGNAL',
    ).length;
    const sourceCount = EvidenceSourceIdentityUtil.count(selectedTrusted);
    const canonicalSamples = selectedTrusted.map((item) => item.text.trim()).filter(Boolean);
    const hardReasons = new Set([
      'OFF_SELECTED_DOMAIN',
      'EXPLICIT_DOMAIN_SCOPE_MISMATCH',
      'PROBLEM_EVIDENCE_OUTSIDE_EXPLICIT_SCOPE',
      'REQUEST_INTENT_MISMATCH',
      'EVIDENCE_SEMANTIC_MISMATCH',
    ]);
    const reasons = ranking.selected.disqualificationReasons.filter((reason) =>
      hardReasons.has(reason),
    );
    if (directCount === 0) reasons.push('NO_DIRECT_EVIDENCE');
    if (sourceCount < 2) reasons.push('INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE');

    const selected: RankedIdeaOpportunity = {
      ...ranking.selected,
      evidenceSamples: canonicalSamples,
      independentEvidence: (ranking.selected.independentEvidence ?? []).filter((item) =>
        selectedAllowedTexts.has(normalize(item.text)),
      ),
      supportingEvidence: (ranking.selected.supportingEvidence ?? []).filter((item) =>
        selectedAllowedTexts.has(normalize(item.text)),
      ),
      frequency: selectedTrusted.length,
      frequencyScore: Math.min(1, selectedTrusted.length / 5),
      evidenceScore: Math.min(1, selectedTrusted.length / 5),
      evidenceReliabilityScore: Math.max(
        ranking.selected.evidenceReliabilityScore,
        directCount > 0 ? 0.8 : 0.65,
      ),
      supportScore: Math.max(
        ranking.selected.supportScore,
        directCount > 0 ? 0.7 : 0.5,
      ),
      selectionEligible: reasons.every((reason) => !hardReasons.has(reason)),
      disqualificationReasons: Array.from(new Set(reasons)),
      qualifiedExternalSupportingEvidenceCount: supportingCount,
      qualifiedExternalSupportingSourceCount: EvidenceSourceIdentityUtil.count(
        selectedTrusted.filter(
          (item) => item.classification === 'SUPPORTING_SIGNAL',
        ),
      ),
      verifiedIndependentEvidenceCount: selectedTrusted.length,
      verifiedIndependentSourceCount: sourceCount,
      verifiedEvidenceCount: selectedTrusted.length,
      verifiedDirectUserEvidenceCount: directCount,
      verifiedSecondaryEvidenceCount: supportingCount,
      verifiedEvidenceSourceCount: sourceCount,
      verifiedProblemMatchedEvidenceCount: selectedTrusted.length,
      verifiedProblemMatchedDirectUserEvidenceCount: directCount,
      verifiedProblemMatchedSecondaryEvidenceCount: supportingCount,
      verifiedProblemMatchedSourceCount: sourceCount,
      verifiedProblemMatchedEvidenceSourceCount: sourceCount,
    };

    return {
      ...ranking,
      selected,
      alternatives: ranking.alternatives.map((candidate) =>
        clearNonCanonicalCandidate(candidate, false),
      ),
      evidenceCoverage: Number(Math.min(1, selectedTrusted.length / 3).toFixed(4)),
      qualityWarnings: Array.from(new Set([
        ...ranking.qualityWarnings,
        directCount === 0
          ? `The selected direction is grounded by ${supportingCount} canonical supporting signal(s) across ${sourceCount} source(s); direct-user recurrence remains unproven.`
          : `The selected direction is grounded by ${directCount} canonical direct signal(s) and ${supportingCount} canonical supporting signal(s) across ${sourceCount} source(s).`,
      ])),
    };
  }

  /**
   * Final identity lock for TEXT_ONLY / TEXT_AND_DOMAINS explicit-problem runs.
   *
   * Evidence is allowed to prioritize a requester facet, but it may never
   * replace the requester-owned problem identity with a stale taxonomy title
   * from an earlier ranking candidate/checkpoint. This is intentionally applied
   * after the canonical evidence-count invariant so it changes identity only;
   * it does not create or inflate evidence.
   */
  private enforceExplicitRequesterRankingAtHandoff(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    const explicitProblem = this.resolveExplicitRequesterProblem(context);
    if (!explicitProblem) return ranking;

    const selectedFamily =
      (context.communityAiAnalysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0) > 0
        ? context.communityAiAnalysis?.selectedProblemFamily?.trim() ?? ''
        : '';
    const desiredOutcome =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
        ? context.collectionPlan.requestIntent.desiredOutcome
            ?.replace(/\s+/gu, ' ')
            .trim() ?? ''
        : '';
    const blueprint = CanonicalRequestProductBlueprintUtil.build({
      profile: context.collectionPlan?.problemProfile,
      requestDescription: explicitProblem,
      domainName: context.domainName,
      opportunityTitle: 'Requester-Defined Workflow Opportunity',
    });
    const canonicalNeed = desiredOutcome
      ? `Implement the requester-defined workflow outcome: ${desiredOutcome}`
      : `A focused software workflow that directly addresses the requester-defined problem without replacing it with a narrower evidence family.`;
    const canonicalSolutionArea =
      blueprint?.workflowFocus ||
      (selectedFamily
        ? `Requester-defined workflow implementation with preliminary support for the facet: ${selectedFamily}`
        : 'Requester-defined workflow implementation with bounded evidence validation');

    const previousTitle = ranking.selected.title.trim();
    const raw =
      ranking.selected.raw &&
      typeof ranking.selected.raw === 'object' &&
      !Array.isArray(ranking.selected.raw)
        ? ({
            ...(ranking.selected.raw as Prisma.JsonObject),
            canonicalRequesterProblemLocked: true,
            canonicalRequesterProblem: explicitProblem,
            evidencePrioritizedRequesterFacet: selectedFamily || null,
          } as Prisma.JsonObject)
        : ranking.selected.raw;

    const canonicalSupportCount = Math.max(
      0,
      context.communityAiAnalysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0,
    );
    const canonicalSupportSourceCount = Math.max(
      0,
      context.communityAiAnalysis?.selectedProblemFamilyDistinctSourceCount ?? 0,
    );
    const evidenceGroundedRequesterTitle =
      selectedFamily && canonicalSupportCount >= 2 && canonicalSupportSourceCount >= 2
        ? `Evidence-Grounded Requester Workflow — ${selectedFamily}`
        : 'Requester-Defined Workflow Opportunity';

    const selected: RankedIdeaOpportunity = {
      ...ranking.selected,
      title: evidenceGroundedRequesterTitle,
      problem: explicitProblem,
      need: canonicalNeed,
      solutionArea: canonicalSolutionArea,
      raw,
    };

    const staleTitle = previousTitle.toLocaleLowerCase();
    const qualityWarnings = ranking.qualityWarnings.filter(
      (warning) =>
        !staleTitle ||
        previousTitle === selected.title ||
        !warning.toLocaleLowerCase().includes(staleTitle),
    );
    const evidenceSuffix = selectedFamily
      ? ` Retained canonical evidence may prioritize the supported facet "${selectedFamily}", but the requester problem remains the immutable product scope.`
      : ' No retained evidence family may substitute a different problem for the requester-defined scope.';

    return {
      ...ranking,
      selected,
      alternatives: ranking.alternatives.map((candidate, index) => ({
        ...candidate,
        rank: index + 2,
      })),
      selectionReason:
        `Requester-defined problem identity locked at the final ranking handoff.${evidenceSuffix}`,
      qualityWarnings: Array.from(new Set([
        ...qualityWarnings,
        'Requester problem identity is immutable downstream; evidence may qualify or prioritize facets but cannot rename the opportunity to a different problem family.',
      ])),
    };
  }

  private enforceCanonicalDiscoveryRankingAtHandoff(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    if (this.hasExplicitRequesterProblem(context)) return ranking;

    const analysis = context.communityAiAnalysis;
    const family = analysis?.selectedProblemFamily?.trim() ?? '';
    if (!family || (analysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0) <= 0) {
      return ranking;
    }

    const selectedIds = new Set(
      (analysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const familyItems = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        selectedIds.has(item.id) &&
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    if (familyItems.length === 0) return ranking;

    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const normalizedFamily = normalize(family);
    const currentCandidates = [ranking.selected, ...ranking.alternatives];
    const existingCanonicalCandidate = currentCandidates.find(
      (candidate) => normalize(candidate.title) === normalizedFamily,
    );
    const groundedCanonicalCandidate =
      this.buildGroundedCommunityFallbackRanking(context)?.selected ?? null;
    const base =
      existingCanonicalCandidate ?? groundedCanonicalCandidate ?? ranking.selected;
    const communityOpportunity = analysis?.opportunities.find((opportunity) => {
      const title = normalize(opportunity.title);
      const problem = normalize(opportunity.problem);
      return (
        title === normalizedFamily ||
        problem === normalizedFamily ||
        title.includes(normalizedFamily) ||
        normalizedFamily.includes(title)
      );
    });
    const evidenceSamples = familyItems
      .map((item) => item.text.trim())
      .filter(Boolean)
      .slice(0, 8);
    const directCount = familyItems.filter(
      (item) => item.classification === 'DIRECT_PROBLEM',
    ).length;
    const sourceCount = Math.max(
      analysis?.selectedProblemFamilyDistinctSourceCount ?? 0,
      EvidenceSourceIdentityUtil.count(familyItems),
    );
    const staleReasons = new Set([
      'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      'NO_DIRECT_EVIDENCE',
      'EVIDENCE_SEMANTIC_MISMATCH',
    ]);
    const disqualificationReasons = base.disqualificationReasons.filter(
      (reason) => !staleReasons.has(reason),
    );
    const selectionEligible = !disqualificationReasons.some(
      (reason) =>
        reason === 'OFF_SELECTED_DOMAIN' ||
        reason === 'EXPLICIT_DOMAIN_SCOPE_MISMATCH' ||
        reason === 'PROBLEM_EVIDENCE_OUTSIDE_EXPLICIT_SCOPE',
    );
    const raw =
      base.raw && typeof base.raw === 'object' && !Array.isArray(base.raw)
        ? ({
            ...(base.raw as Prisma.JsonObject),
            familyKey: null,
            canonicalDiscoveryProblemLocked: true,
            canonicalDiscoveryProblemFamily: family,
            canonicalDiscoveryProblemEvidenceIds: [...selectedIds],
            canonicalDiscoveryProblemTrustedEvidenceCount: familyItems.length,
            canonicalDiscoveryProblemDistinctSourceCount: sourceCount,
          } as Prisma.JsonObject)
        : base.raw;

    const selected: RankedIdeaOpportunity = {
      ...base,
      rank: 1,
      title: family,
      problem: communityOpportunity?.problem ?? family,
      need:
        communityOpportunity?.unmetNeed ??
        `A focused software workflow that addresses ${family} while preserving human review and validating how broadly the problem occurs.`,
      solutionArea:
        communityOpportunity?.solutionArea ?? `Evidence-grounded workflow for ${family}`,
      evidenceSamples,
      frequency: Math.max(base.frequency, familyItems.length),
      frequencyScore: Math.max(
        base.frequencyScore,
        Math.min(1, familyItems.length / 5),
      ),
      evidenceScore: Math.max(base.evidenceScore, Math.min(1, familyItems.length / 5)),
      evidenceReliabilityScore: Math.max(
        base.evidenceReliabilityScore,
        directCount > 0 ? 0.85 : 0.7,
      ),
      supportScore: Math.max(base.supportScore, directCount > 0 ? 0.7 : 0.55),
      selectionEligible,
      disqualificationReasons,
      verifiedProblemMatchedEvidenceCount: Math.max(
        base.verifiedProblemMatchedEvidenceCount ?? 0,
        familyItems.length,
      ),
      verifiedEvidenceCount: Math.max(
        base.verifiedEvidenceCount ?? 0,
        familyItems.length,
      ),
      verifiedProblemMatchedDirectUserEvidenceCount: Math.max(
        base.verifiedProblemMatchedDirectUserEvidenceCount ?? 0,
        directCount,
      ),
      verifiedDirectUserEvidenceCount: Math.max(
        base.verifiedDirectUserEvidenceCount ?? 0,
        directCount,
      ),
      verifiedProblemMatchedSourceCount: Math.max(
        base.verifiedProblemMatchedSourceCount ?? 0,
        sourceCount,
      ),
      verifiedProblemMatchedEvidenceSourceCount: Math.max(
        base.verifiedProblemMatchedEvidenceSourceCount ?? 0,
        sourceCount,
      ),
      verifiedIndependentSourceCount: Math.max(
        base.verifiedIndependentSourceCount ?? 0,
        sourceCount,
      ),
      verifiedEvidenceSourceCount: Math.max(
        base.verifiedEvidenceSourceCount ?? 0,
        sourceCount,
      ),
      raw,
    };
    const alternatives = currentCandidates
      .filter((candidate) => normalize(candidate.title) !== normalizedFamily)
      .map((candidate, index) => ({ ...candidate, rank: index + 2 }));

    const selectionSource = analysis?.selectedProblemFamilySelectionSource ?? null;
    const selectionSourceLabel =
      selectionSource === 'AI_SELECTED_VERIFIED'
        ? 'The full-corpus Community AI selected the family and its evidence ids survived deterministic verification'
        : selectionSource === 'AI_CLUSTER_VERIFIED'
          ? 'The AI-derived evidence cluster survived deterministic verification'
          : selectionSource === 'DETERMINISTIC_VERIFIED_FALLBACK'
            ? 'Deterministic verification selected the strongest surviving evidence-native family after the AI proposal was unavailable or rejected'
            : 'Canonical evidence verification selected the surviving discovery family';

    return {
      ...ranking,
      selected,
      alternatives,
      evaluatedCount: Math.max(ranking.evaluatedCount, alternatives.length + 1),
      evidenceCoverage: Math.max(
        ranking.evidenceCoverage,
        Math.min(1, familyItems.length / 3),
      ),
      selectionReason: `${selectionSourceLabel}: "${family}" from ${familyItems.length} verified family-matched evidence item(s). Ranking preserved that canonical winner through the prompt handoff.`,
      qualityWarnings: [
        ...ranking.qualityWarnings.filter(
          (warning) =>
            !/no problem-matched retained evidence|zero[_ -]?evidence|validation-first opportunity/iu.test(
              warning,
            ),
        ),
        selectionSource === 'AI_SELECTED_VERIFIED'
          ? 'The verified Community AI discovery family is the single problem identity used by prompt building and benchmarking; ranking may validate it but may not substitute another family.'
          : 'The deterministic canonical discovery family is the single verified problem identity used by prompt building and benchmarking; it must not be described as an AI-owned winner.',
      ],
    };
  }

  /**
   * Removes stale pre-verification fallback warnings once independent evidence
   * verification has promoted the selected candidate to an eligible, traceable
   * preliminary opportunity. The numeric score is intentionally left untouched:
   * one verified report can justify a pilot while still being below recurrence
   * and market-confidence thresholds.
   */
  /**
   * Releases a weak single-source canonical lock for an EXPLICIT_PROBLEM run.
   *
   * Community AI still owns semantic classification. This method consumes the
   * ranking layer's already-existing request-intent verdict; it does not inspect
   * raw prose with a new keyword/regex classifier. Before recovery it clears
   * only the immutable family lock so a better AI recovery family can win. At
   * final handoff it additionally demotes those weak locked rows to adjudicated
   * CONTEXT_ONLY audit rows so they cannot create false requester grounding.
   */
  private releaseWeakExplicitRequestCanonicalLock(
    context: IdeaGenerationContext,
    ranking: IdeaOpportunityRanking,
    finalizeLedger: boolean,
  ): IdeaGenerationContext {
    if (!this.hasExplicitRequesterProblem(context)) return context;

    const analysis = context.communityAiAnalysis;
    if (!analysis) return context;
    const lockedIds = [...new Set(
      (analysis.canonicalProblemFamilyEvidenceIds ??
        analysis.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    )];
    if (lockedIds.length === 0) return context;

    const lockedFamilyLabel =
      analysis.canonicalProblemFamilyLabel?.trim() ||
      analysis.selectedProblemFamily?.trim() ||
      '';
    const normalizedLockedFamily = this.normalizeIntentText(lockedFamilyLabel);
    const canonicalFamilyCandidate = normalizedLockedFamily
      ? [ranking.selected, ...ranking.alternatives].find(
          (candidate) =>
            this.normalizeIntentText(candidate.title) === normalizedLockedFamily,
        ) ?? null
      : null;

    /*
     * Explicit-problem ranking may correctly wrap the final selection in a
     * requester-defined opportunity while the actual AI-owned evidence family
     * remains only an alternative. Judge the FAMILY'S request-intent verdict,
     * not the wrapper candidate's score. Otherwise a weak one-source family can
     * stay locked, steer recovery toward the wrong facet, and survive merely
     * because the requester wrapper itself has alignment=1.
     */
    const familyIntentCandidate = canonicalFamilyCandidate ??
      (this.normalizeIntentText(ranking.selected.title) === normalizedLockedFamily
        ? ranking.selected
        : null);
    if (!familyIntentCandidate) return context;

    const weakRequestMatch =
      familyIntentCandidate.requestIntentSupportTier === 'WEAK_OR_UNRELATED' ||
      familyIntentCandidate.disqualificationReasons.includes(
        'REQUEST_INTENT_MISMATCH',
      );
    if (!weakRequestMatch) return context;

    /*
     * Multi-source corroboration is intentionally left to AI/canonical review;
     * this guard targets the observed failure mode where ONE broad documentary
     * row locked a requester-sized family despite the downstream intent gate
     * rating that candidate weak/unrelated.
     */
    const distinctLockedSources = Math.max(
      analysis.selectedProblemFamilyDistinctSourceCount ?? 0,
      EvidenceSourceIdentityUtil.count(
        (context.canonicalEvidenceLedger ?? []).filter((item) =>
          lockedIds.includes(item.id),
        ),
      ),
    );
    if (distinctLockedSources > 1 || lockedIds.length > 1) return context;

    const warning =
      'A single-source AI-proposed family did not pass the explicit requester-intent gate. Its row remains adjudicated audit context, but it cannot lock or ground the requester-defined problem.';
    const communityAiAnalysis: CommunityAiAnalysis = {
      ...analysis,
      selectedProblemFamily: null,
      selectedProblemFamilySelectionSource: analysis.aiProposedProblemFamily?.trim()
        ? 'AI_PROPOSAL_REJECTED'
        : null,
      selectedProblemFamilyEvidenceIds: [],
      selectedProblemFamilyTrustedEvidenceCount: 0,
      selectedProblemFamilyDistinctSourceCount: 0,
      canonicalProblemFamilyId: null,
      canonicalProblemFamilyLabel: null,
      canonicalProblemFamilyEvidenceIds: [],
      opportunities: finalizeLedger ? [] : analysis.opportunities,
      qualityWarnings: Array.from(new Set([
        ...analysis.qualityWarnings,
        warning,
      ])),
    };

    if (!finalizeLedger) {
      return {
        ...context,
        communityAiAnalysis,
      };
    }

    const lockedIdSet = new Set(lockedIds);
    const canonicalEvidenceLedger = (context.canonicalEvidenceLedger ?? []).map(
      (item) => {
        if (
          !lockedIdSet.has(item.id) ||
          !item.verified ||
          (item.classification !== 'DIRECT_PROBLEM' &&
            item.classification !== 'SUPPORTING_SIGNAL')
        ) {
          return item;
        }
        return {
          ...item,
          classification: 'CONTEXT_ONLY' as const,
          problemFamily: null,
          verified: false,
        };
      },
    );

    return {
      ...context,
      canonicalEvidenceLedger,
      communityAiAnalysis,
    };
  }

  private applyRequestIntentAlignment(
    ranking: IdeaOpportunityRanking,
    context: IdeaGenerationContext,
  ): IdeaOpportunityRanking {
    const explicitRequesterProblem = this.hasExplicitRequesterProblem(context);
    const description = explicitRequesterProblem
      ? this.resolveExplicitRequesterProblem(context)
      : this.resolveRequestIntentScope(context);
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
      if (explicitRequesterProblem && rawCandidate?.requestIntentAlignmentApplied === true) {
        return candidate;
      }
      const isCanonicalRequesterHypothesis =
        explicitRequesterProblem &&
        rawSource === 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS' &&
        rawRequestDescription.length > 0 &&
        this.normalizeIntentText(rawRequestDescription) === normalizedDescription;
      const alignment = isCanonicalRequesterHypothesis
        ? 1
        : explicitRequesterProblem
          ? this.calculateRequestIntentAlignment(candidate, description)
          : this.calculateDiscoveryIntentAlignment(candidate, context);
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
        explicitRequesterProblem &&
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

      if (
        explicitRequesterProblem &&
        !isStronglyAligned &&
        !disqualificationReasons.includes('WEAK_REQUEST_INTENT_ALIGNMENT')
      ) {
        disqualificationReasons.push('WEAK_REQUEST_INTENT_ALIGNMENT');
      }
      if (
        explicitRequesterProblem &&
        !isPreliminaryAligned &&
        !disqualificationReasons.includes('REQUEST_INTENT_MISMATCH')
      ) {
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
       * Explicit-problem text keeps its strict problem-first selection gate.
       * Discovery-intent text only constrains the search/actor/domain scope;
       * verified evidence is allowed to choose the actual software problem.
       */
      const selectionEligible =
        candidate.selectionEligible &&
        !isOffSelectedDomain &&
        (explicitRequesterProblem ? isStronglyAligned : true);
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
       * DISCOVERY_INTENT text is search scope, not a requester-owned problem.
       * When no verified evidence-backed candidate survives, keep an
       * intent-constrained evidence-discovery hypothesis instead of converting
       * the description into the problem or attaching partial evidence to it.
       */
      if (!explicitRequesterProblem) {
        const fallback = this.buildPrimaryDomainHypothesisRanking(context);
        const fallbackIdentity = this.buildOpportunityIdentityKey(fallback.selected);
        const diagnosticAlternatives = scored
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

        return {
          ...fallback,
          alternatives: diagnosticAlternatives,
          evaluatedCount: Math.max(fallback.evaluatedCount, ranking.evaluatedCount),
          qualityWarnings: Array.from(new Set([
            'Requester text was classified as DISCOVERY_INTENT. It constrained evidence collection but was not promoted into a problem statement or external evidence.',
            partialSupportCandidates.length > 0
              ? `${partialSupportCandidates.length} partial evidence candidate(s) remained diagnostic because none survived the canonical discovery-selection gate.`
              : 'No canonical DIRECT/SUPPORTING problem family survived inside the requester intent and selected-domain scope.',
            ...fallback.qualityWarnings,
          ])),
          selectionReason:
            `No canonical evidence-backed problem survived inside discovery intent "${description}". ` +
            'The pipeline kept the text as search scope only and preserved a validation-first discovery direction instead of inventing a requester-defined problem.',
        };
      }

      /*
       * With an explicit requester problem, same-domain evidence is not a
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

  private calculateDiscoveryIntentAlignment(
    candidate: IdeaOpportunityRanking['selected'],
    context: IdeaGenerationContext,
  ): number {
    const candidateText = this.normalizeIntentText(
      [
        candidate.title,
        candidate.problem,
        candidate.need,
        candidate.solutionArea,
        ...candidate.evidenceSamples,
        ...(candidate.independentEvidence ?? []).map((item) => item.text),
      ].join(' '),
    );
    const candidateTokens = this.extractIntentTokens(candidateText);
    const identity = context.collectionPlan?.domainIdentity;
    const rawConcepts = [
      identity?.actor,
      identity?.object,
      identity?.workflow,
      ...(context.collectionPlan?.intentConcepts ?? []),
    ]
      .map((value) => value?.replace(/\s+/gu, ' ').trim() ?? '')
      .filter(Boolean);
    const concepts = [...new Set(rawConcepts)].slice(0, 10);

    if (concepts.length === 0) {
      return candidate.matchedDomainNames?.length ? 0.7 : 0.5;
    }

    let matched = 0;
    for (const concept of concepts) {
      const normalizedConcept = this.normalizeIntentText(concept);
      if (!normalizedConcept) continue;
      if (candidateText.includes(normalizedConcept)) {
        matched += 1;
        continue;
      }
      const conceptTokens = this.extractIntentTokens(normalizedConcept);
      if (conceptTokens.size === 0) continue;
      const overlap = [...conceptTokens].filter((token) =>
        candidateTokens.has(token),
      ).length / conceptTokens.size;
      if (overlap >= 0.5) matched += 1;
    }

    const conceptScore = matched / concepts.length;
    const selectedDomainNames = new Set(
      context.selectedDomains
        .map((domain) => domain.name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const domainAligned = (candidate.matchedDomainNames ?? []).some((name) =>
      selectedDomainNames.has(name.trim().toLocaleLowerCase()),
    );
    return Math.max(0, Math.min(1, conceptScore * 0.8 + (domainAligned ? 0.2 : 0)));
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
    const cleanedWarnings = ranking.qualityWarnings.filter((warning) => {
      if (staleFallbackWarning.test(warning)) return false;
      if (
        verifiedEvidenceCount > 0 &&
        warning.includes('No external evidence-backed partial candidate survived verification')
      ) {
        return false;
      }
      if (
        verifiedEvidenceCount > 0 &&
        warning.includes('No sufficiently request-aligned direct community problem was established')
      ) {
        return false;
      }
      if (verifiedDirectCount > 0) {
        if (
          /no verified direct[- ]user complaint|no verified direct user|no direct retained evidence|supported by \d+ problem-matched secondary report|supported by \d+ secondary retained report|only by secondary|secondary report(?:s)? and no direct/iu.test(
            warning,
          )
        ) {
          return false;
        }
      }
      if (verifiedDirectCount === 0) {
        if (
          /supported by \d+ verified direct user report|\d+ canonical direct signal|verified direct-user signal/iu.test(
            warning,
          )
        ) {
          return false;
        }
      }
      return true;
    });

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

    const canonicalSelectionReason =
      verifiedDirectCount > 0
        ? `Selected from the final canonical ledger with ${verifiedDirectCount} verified direct signal(s) and ${verifiedSecondaryCount} supporting signal(s). Recurrence and prevalence remain bounded by source diversity.`
        : verifiedSecondaryCount > 0
          ? `Selected from the final canonical ledger with ${verifiedSecondaryCount} supporting signal(s) and no verified direct-user signal. The product remains a preliminary validation pilot.`
          : ranking.selectionReason;

    return {
      ...ranking,
      selectionReason: canonicalSelectionReason,
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
    /*
     * Description-bearing runs have an immutable semantic problem anchor from
     * PREPARING. Selected-domain evidence may support that problem, but ranking
     * must not reassign the idea to whichever selected domain happens to appear
     * first in matchedDomainNames. Discovery-only runs may still move to the
     * evidence-backed winning domain below.
     */
    if (this.hasExplicitRequesterProblem(context)) {
      const semanticPrimary = context.selectedDomains.find(
        (domain) => domain.id === context.domainId,
      );
      if (semanticPrimary) {
        return { id: semanticPrimary.id, name: semanticPrimary.name };
      }
      if (context.domainId && context.domainName) {
        return { id: context.domainId, name: context.domainName };
      }
    }

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
  private hasExplicitRequesterProblem(context: IdeaGenerationContext): boolean {
    return Boolean(this.resolveExplicitRequesterProblem(context));
  }

  private resolveExplicitRequesterProblem(context: IdeaGenerationContext): string {
    const intent = context.collectionPlan?.requestIntent;
    if (intent?.mode !== 'EXPLICIT_PROBLEM') return '';
    return intent.explicitProblem?.replace(/\s+/gu, ' ').trim() ?? '';
  }

  private resolveRequestIntentScope(context: IdeaGenerationContext): string {
    const intent = context.collectionPlan?.requestIntent;
    return (
      (intent?.mode === 'EXPLICIT_PROBLEM' ? intent.explicitProblem : intent?.summary)?.replace(/\s+/gu, ' ').trim() ||
      context.requestDescription?.replace(/\s+/gu, ' ').trim() ||
      ''
    );
  }

}