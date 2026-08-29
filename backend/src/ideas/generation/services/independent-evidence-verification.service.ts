import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  classifyDirectCommunityEvidence,
  isExplicitTechnicalFeatureRequestEvidence,
  isPositiveFeedbackWithoutProblem,
  isPositiveTestimonialWithPreExistingNeed,
  isRelayedCommunityIssueReport,
  segmentCommunityEvidenceIssues,
} from '../../../nlp/common/utils/community-evidence.util';
import {
  clusterEvidenceByProblemFamily,
  matchEvidenceToProblemFamily,
} from '../../../nlp/common/utils/problem-family-matching.util';
import {
  INDEPENDENT_EVIDENCE_KINDS,
  type IndependentEvidence,
  type IndependentEvidenceKind,
} from '../types/independent-evidence.type';
import type {
  IdeaOpportunityRanking,
  RankedIdeaOpportunity,
} from '../types/idea-opportunity-ranking.type';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { EvidenceSourceIdentityUtil } from '../utils/evidence-source-identity.util';

const MIN_VERIFIED_RECURRENCE_COUNT = 3;
const MIN_VERIFIED_SOURCE_COUNT = 2;
const MAX_VERIFIED_EVIDENCE_SAMPLES = 8;
const MIN_VERIFIED_SINGLE_EVIDENCE_PILOT_SCORE = 0.16;
const MIN_GROUNDED_SINGLE_SAMPLE_SCORE = 0.2;
const MIN_SINGLE_EVIDENCE_RELIABILITY = 0.42;
const EVIDENCE_RECORD_CACHE_TTL_MS = 2 * 60 * 1000;
const EVIDENCE_RECORD_CACHE_MAX_ENTRIES = 100;

export type EvidenceProvenanceHint = {
  readonly text: string;
  readonly sourceKey: string;
  readonly postExternalId: string;
  readonly commentExternalId: string | null;
};

type EvidenceRecord = {
  readonly text: string;
  readonly sourceKey: string;
  readonly postExternalId: string;
  readonly commentExternalId: string | null;
  readonly author: string | null;
};

const SPECIFICATION_PATTERNS: readonly RegExp[] = [
  /^\s*(?:#{1,6}\s*)?(?:acceptance criteria|definition of done|requirements?|implementation plan|technical design|architecture|test plan|tests?)\s*[:-]/iu,
  /\b(?:the primitive owns|typed trusted interface|compare-and-set preconditions|immutable version graph|atomic no-write failure|transaction tests cover|tests cover every crash point|dependency boundary with|ticket\s+\d+[a-z]?)\b/iu,
  /^\s*[-*]\s*\[[ x]\]\s+/iu,
  /\b(?:must|shall)\s+(?:implement|persist|expose|support|validate|ensure)\b/iu,
];

const FEATURE_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(?:feature request|please add|should add|would like|wish|needs? to support|requesting support for)\b/iu,
  /(?:أرجو إضافة|يرجى إضافة|نحتاج ميزة|أتمنى إضافة|اقتراح ميزة)/iu,
];

const COMPLAINT_PATTERNS: readonly RegExp[] = [
  /\b(?:cannot|can't|unable to|doesn't work|not working|failed to|fails to|crash(?:es|ed)?|freeze|frozen|lost|missing|blocked|unavailable|broken|bug|error|slow|confusing|frustrating|paywall|subscription)\b/iu,
  /\b(?:not accurate enough|insufficient(?:ly)? accurate|inaccurate|imprecise|lacks? (?:the required )?precision|difficulty identifying|struggle(?:s|d)? to identify|cannot accurately|can't accurately)\b/iu,
  /(?:لا أستطيع|لا يمكن|لا يعمل|ما بشتغل|فشل|يتعطل|تعطل|مفقود|محجوب|غير متاح|بطيء|مربك|اشتراك|مدفوع)/iu,
];

const REVIEW_SOURCE_KEYS = new Set(['google-play', 'app-store']);
const EDITORIAL_SOURCE_KEYS = new Set(['dev-to', 'blog']);
const NEWS_SOURCE_KEYS = new Set(['news', 'gdelt']);
const COMMUNITY_DISCUSSION_SOURCE_KEYS = new Set([
  'reddit',
  'forum',
  'hacker-news',
]);
const SECONDARY_REPORT_SOURCE_KEYS = new Set(['product-hunt', 'crossref']);
const PUBLISHER_POST_SOURCE_KEYS = new Set([
  'google-play',
  'app-store',
  'youtube',
]);
const SECONDARY_REPORT_PATTERNS: readonly RegExp[] = [
  /\b(?:according to|reported by|reports? that|a report|study|survey|case study|experiment)\b/iu,
  /\b(?:after|following)\s+(?:hundreds?|dozens?|many|multiple)\s+of\s+(?:user\s+)?complaints?\b/iu,
  /\b(?:pulled|withdrew|removed|suspended|stopped)\b[^.!?]{0,120}\b(?:after|following|because of)\b[^.!?]{0,100}\bcomplaints?\b/iu,
  /\b(?:users?|customers?|patients?|developers?)\s+(?:reported|complained|raised concerns|experienced)\b/iu,
];

/**
 * Revalidates ranked evidence against persisted collection provenance.
 *
 * Responsibilities:
 * - Resolve each evidence quote to its original post/comment record.
 * - Classify reviews, complaints, requests, tickets, and specifications.
 * - Deduplicate by independent author/thread identity.
 * - Exclude specifications and technical checklists from recurrence counts.
 * - Reorder opportunities after verified recurrence is applied.
 *
 * This service intentionally does not modify the NLP analysis itself. It acts
 * as a deterministic scientific-validity gate between opportunity ranking and
 * idea generation.
 *
 * @author Malak
 */
@Injectable()
export class IndependentEvidenceVerificationService {
  private readonly evidenceRecordCache = new Map<
    string,
    { readonly expiresAt: number; readonly records: readonly EvidenceRecord[] }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async verifyRanking(
    ranking: IdeaOpportunityRanking,
    collectionJobIds: readonly string[],
    provenanceHints: readonly EvidenceProvenanceHint[] = [],
  ): Promise<IdeaOpportunityRanking> {
    const hintedRecords: readonly EvidenceRecord[] = provenanceHints
      .filter(
        (hint) =>
          hint.text.trim().length > 0 &&
          hint.sourceKey.trim().length > 0 &&
          hint.postExternalId.trim().length > 0,
      )
      .map((hint) => ({
        ...hint,
        author: null,
      }));

    /*
     * FAST_GENERATION provenance hints originate from collector rows only after
     * their bulk DB transaction has committed. Resolve against those canonical
     * ids first and avoid a remote Prisma corpus read on the healthy path.
     */
    let records = hintedRecords;
    let verified = [ranking.selected, ...ranking.alternatives].map(
      (candidate) => this.verifyCandidate(candidate, records),
    );

    const resolvedFromHints = verified.some(
      (candidate) => (candidate.independentEvidence?.length ?? 0) > 0,
    );

    if (!resolvedFromHints) {
      const persistedRecords = await this.loadEvidenceRecords(collectionJobIds);
      records = this.mergeEvidenceRecords(hintedRecords, persistedRecords);
      verified = [ranking.selected, ...ranking.alternatives].map(
        (candidate) => this.verifyCandidate(candidate, records),
      );
    }

    const sorted = [...verified].sort((first, second) => {
      if (first.selectionEligible !== second.selectionEligible) {
        return first.selectionEligible ? -1 : 1;
      }

      return (
        second.finalScore - first.finalScore ||
        (second.verifiedEvidenceCount ?? 0) -
          (first.verifiedEvidenceCount ?? 0) ||
        second.evidenceReliabilityScore - first.evidenceReliabilityScore ||
        second.frequency - first.frequency
      );
    });

    const [selected, ...alternatives] = sorted.map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));

    if (!selected) {
      return ranking;
    }

    return {
      ...ranking,
      selected,
      alternatives,
      evidenceCoverage: this.calculateEvidenceCoverage(sorted),
      selectionReason: this.buildSelectionReason(selected),
      qualityWarnings: this.mergeWarnings(ranking.qualityWarnings, selected),
    };
  }

  /**
   * Re-applies independently verified provenance after any downstream ranking
   * reconciliation. Domain/family reconciliation is allowed to change labels
   * and ordering, but it must never reclassify a TECHNICAL_TICKET or secondary
   * report as community evidence. This method is intentionally idempotent and
   * safe to call at the final ranking boundary.
   */
  /**
   * Verifies collector-backed evidence provenance without requiring the item
   * to represent the complete selected problem family.
   *
   * This is intentionally narrower than verifyRanking(): Community AI may
   * classify an item as SUPPORTING_SIGNAL because it validates only one part
   * of a requester workflow. Re-running full problem-family selection would
   * incorrectly erase that legitimate partial support. The caller must only
   * use this method for evidence that already passed semantic triage and the
   * deterministic requester/domain guard.
   */
  verifyProvenanceHints(
    provenanceHints: readonly EvidenceProvenanceHint[],
  ): readonly IndependentEvidence[] {
    const records: readonly EvidenceRecord[] = provenanceHints
      .filter(
        (hint) =>
          hint.text.trim().length > 0 &&
          hint.sourceKey.trim().length > 0 &&
          hint.postExternalId.trim().length > 0,
      )
      .map((hint) => ({
        ...hint,
        author: null,
      }));

    return this.deduplicateIndependentEvidence(
      provenanceHints
        .map((hint) => {
          const resolved = this.resolveEvidence(hint.text, records);
          if (!resolved) return null;

          /*
           * This method is called only after Community AI semantic triage and
           * the deterministic requester/workflow guard have already accepted
           * the item as partial support. Some collector-backed publisher/video
           * posts are intentionally UNKNOWN to the direct-evidence classifier
           * because they are not first-person complaints. Do not erase that
           * valid contextual support here; preserve its provenance as
           * non-recurrence editorial/general commentary. This never upgrades
           * the item to a complaint, review, feature request, or recurrence
           * evidence.
           */
          if (resolved.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.UNKNOWN) {
            return {
              ...resolved,
              evidenceKind:
                resolved.commentExternalId === null
                  ? INDEPENDENT_EVIDENCE_KINDS.EDITORIAL_ANALYSIS
                  : INDEPENDENT_EVIDENCE_KINDS.GENERAL_COMMENTARY,
              qualifiesForRecurrence: false,
            } satisfies IndependentEvidence;
          }

          return resolved;
        })
        .filter((evidence): evidence is IndependentEvidence => Boolean(evidence))
        .filter(
          (evidence) =>
            evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.SPECIFICATION &&
            evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.POSITIVE_FEEDBACK,
        ),
    ).slice(0, MAX_VERIFIED_EVIDENCE_SAMPLES);
  }

  normalizeVerifiedRankingProvenance(
    ranking: IdeaOpportunityRanking,
  ): IdeaOpportunityRanking {
    const normalizeCandidate = (
      candidate: RankedIdeaOpportunity,
    ): RankedIdeaOpportunity => {
      const retainedEvidence = candidate.independentEvidence ?? [];
      if (retainedEvidence.length === 0) return candidate;

      return {
        ...candidate,
        supportingEvidence: this.synchronizeSupportingEvidenceMetadata(
          retainedEvidence,
          candidate.supportingEvidence,
        ),
        raw: this.synchronizeRawEvidenceMetadata(
          candidate.raw,
          retainedEvidence,
        ),
      };
    };

    return {
      ...ranking,
      selected: normalizeCandidate(ranking.selected),
      alternatives: ranking.alternatives.map(normalizeCandidate),
    };
  }

  private async loadEvidenceRecords(
    collectionJobIds: readonly string[],
  ): Promise<readonly EvidenceRecord[]> {
    const uniqueJobIds = [...new Set(collectionJobIds.filter(Boolean))].sort();

    if (uniqueJobIds.length === 0) {
      return [];
    }

    const cacheKey = uniqueJobIds.join('|');
    const cached = this.evidenceRecordCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.records;
    }
    if (cached) {
      this.evidenceRecordCache.delete(cacheKey);
    }

    const posts = await this.prisma.socialPost.findMany({
      where: {
        collectionJobId: {
          in: uniqueJobIds,
        },
      },
      select: {
        externalId: true,
        title: true,
        content: true,
        author: true,
        dataSource: {
          select: {
            key: true,
          },
        },
        comments: {
          select: {
            externalId: true,
            content: true,
            author: true,
          },
        },
      },
    });

    const records: readonly EvidenceRecord[] = posts.flatMap((post) => {
      const postText = this.mergePostText(post.title, post.content);
      const sourceKey = post.dataSource.key;

      return [
        {
          text: postText,
          sourceKey,
          postExternalId: post.externalId,
          commentExternalId: null,
          author: post.author,
        },
        ...post.comments.map((comment) => ({
          text: comment.content,
          sourceKey,
          postExternalId: post.externalId,
          commentExternalId: comment.externalId,
          author: comment.author,
        })),
      ];
    });

    if (records.length > 0) {
      if (this.evidenceRecordCache.size >= EVIDENCE_RECORD_CACHE_MAX_ENTRIES) {
        const oldestKey = this.evidenceRecordCache.keys().next().value as
          | string
          | undefined;
        if (oldestKey) this.evidenceRecordCache.delete(oldestKey);
      }
      this.evidenceRecordCache.set(cacheKey, {
        expiresAt: Date.now() + EVIDENCE_RECORD_CACHE_TTL_MS,
        records,
      });
    }

    return records;
  }

  private mergeEvidenceRecords(
    first: readonly EvidenceRecord[],
    second: readonly EvidenceRecord[],
  ): readonly EvidenceRecord[] {
    const seen = new Set<string>();
    const merged: EvidenceRecord[] = [];

    for (const record of [...first, ...second]) {
      const key = [
        record.sourceKey,
        record.postExternalId,
        record.commentExternalId ?? '',
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(record);
    }

    return merged;
  }

  private verifyCandidate(
    candidate: RankedIdeaOpportunity,
    records: readonly EvidenceRecord[],
  ): RankedIdeaOpportunity {
    const resolvedEvidence = this.deduplicateIndependentEvidence(
      candidate.evidenceSamples
        .map((sample) => this.resolveEvidence(sample, records))
        .filter((evidence): evidence is IndependentEvidence => Boolean(evidence)),
    ).slice(0, MAX_VERIFIED_EVIDENCE_SAMPLES);

    const nonSpecificationEvidence = resolvedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.SPECIFICATION,
    );
    const classifiedEvidence = nonSpecificationEvidence.filter(
      (evidence) =>
        evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.UNKNOWN &&
        evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.POSITIVE_FEEDBACK,
    );
    const problemDescriptor = [
      candidate.problem ?? '',
      candidate.need ?? '',
      candidate.title,
      candidate.solutionArea ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const groundedCommunityCandidate =
      this.isGroundedCommunityCandidate(candidate);

    /*
     * Domain relevance is intentionally not enough for opportunity evidence.
     * A broad domain such as Mental Health can contain several unrelated
     * problems (access affordability, investor disputes, therapeutic persona
     * changes, data loss, etc.). Select one coherent problem cluster before
     * recurrence counting so unrelated same-domain evidence cannot inflate the
     * winning opportunity.
     */
    const problemMatchedEvidence = this.selectProblemMatchedEvidence(
      candidate,
      classifiedEvidence,
      problemDescriptor,
    );
    const retainedEvidence = problemMatchedEvidence;

    const allDirectEvidence = classifiedEvidence.filter((evidence) =>
      this.isDirectUserEvidence(evidence.evidenceKind),
    );
    const allSecondaryEvidence = classifiedEvidence.filter((evidence) =>
      this.isSecondaryEvidence(evidence.evidenceKind),
    );
    const allTechnicalEvidence = classifiedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET,
    );
    const allQuestionEvidence = classifiedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.USER_QUESTION,
    );

    const allObservationEvidence = classifiedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.GENERAL_COMMENTARY,
    );

    const directEvidence = retainedEvidence.filter((evidence) =>
      this.isDirectUserEvidence(evidence.evidenceKind),
    );
    const secondaryEvidence = retainedEvidence.filter((evidence) =>
      this.isSecondaryEvidence(evidence.evidenceKind),
    );
    const technicalEvidence = retainedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET,
    );
    const questionEvidence = retainedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.USER_QUESTION,
    );
    const observationEvidence = retainedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.GENERAL_COMMENTARY,
    );
    const complaintEvidence = directEvidence.filter((evidence) =>
      this.isComplaintEvidence(evidence.evidenceKind),
    );
    const featureRequestEvidence = directEvidence.filter(
      (evidence) => evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST,
    );
    const recurrenceEvidence = complaintEvidence.filter(
      (evidence) => evidence.qualifiesForRecurrence,
    );

    const verifiedProblemMatchedDirectCount = directEvidence.length;
    const verifiedProblemMatchedDirectSourceCount = this.countIndependentSourceIdentities(directEvidence);
    const verifiedProblemMatchedComplaintCount = complaintEvidence.length;
    const verifiedProblemMatchedFeatureRequestCount = featureRequestEvidence.length;
    const verifiedProblemMatchedComplaintSourceCount = this.countIndependentSourceIdentities(recurrenceEvidence);
    const verifiedProblemMatchedSecondaryCount = secondaryEvidence.length;
    const verifiedProblemMatchedTechnicalCount = technicalEvidence.length;
    const verifiedProblemMatchedQuestionCount = questionEvidence.length;
    const verifiedProblemMatchedObservationCount = observationEvidence.length;
    const verifiedProblemMatchedEvidenceCount = retainedEvidence.length;
    const verifiedProblemMatchedEvidenceSourceCount = this.countIndependentSourceIdentities(retainedEvidence);

    /*
     * Preserve candidate-level diagnostic totals separately. They answer
     * "what evidence was resolved in this domain/candidate corpus?" while the
     * problem-matched counters below answer "what actually supports the final
     * opportunity?". Only the latter may drive recurrence or final claims.
     */
    const verifiedDirectCount = allDirectEvidence.length;
    const allComplaintEvidence = allDirectEvidence.filter((evidence) =>
      this.isComplaintEvidence(evidence.evidenceKind),
    );
    const verifiedComplaintCount = allComplaintEvidence.length;
    const verifiedComplaintSourceCount = this.countIndependentSourceIdentities(allComplaintEvidence);
    const verifiedFeatureRequestCount = allDirectEvidence.filter(
      (evidence) => evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST,
    ).length;
    const verifiedDirectSourceCount = this.countIndependentSourceIdentities(allDirectEvidence);
    const verifiedSecondaryCount = allSecondaryEvidence.length;
    const verifiedTechnicalCount = allTechnicalEvidence.length;
    const verifiedQuestionCount = allQuestionEvidence.length;
    const verifiedObservationCount = allObservationEvidence.length;
    const verifiedEvidenceCount = classifiedEvidence.length;
    const verifiedEvidenceSourceCount = this.countIndependentSourceIdentities(classifiedEvidence);
    const synchronizedSupportingEvidence =
      this.synchronizeSupportingEvidenceMetadata(
        retainedEvidence,
        candidate.supportingEvidence,
      );
    const synchronizedRaw = this.synchronizeRawEvidenceMetadata(
      candidate.raw,
      retainedEvidence,
    );
    const weightedEvidenceScore = Math.min(
      1,
      verifiedProblemMatchedDirectCount / 5 +
        verifiedProblemMatchedSecondaryCount * 0.12 +
        verifiedProblemMatchedTechnicalCount * 0.1 +
        verifiedProblemMatchedQuestionCount * 0.04 +
        verifiedProblemMatchedObservationCount * 0.06,
    );
    const groundedSingleSample =
      groundedCommunityCandidate && retainedEvidence.length > 0;
    const verifiedEvidenceScore = Math.max(
      weightedEvidenceScore,
      groundedSingleSample
        ? verifiedProblemMatchedDirectCount > 0
          ? MIN_GROUNDED_SINGLE_SAMPLE_SCORE
          : verifiedProblemMatchedObservationCount > 0
            ? 0.1
            : 0.12
        : 0,
    );
    const recurrenceEligible =
      verifiedProblemMatchedComplaintCount >= MIN_VERIFIED_RECURRENCE_COUNT &&
      verifiedProblemMatchedComplaintSourceCount >= MIN_VERIFIED_SOURCE_COUNT;
    const effectiveEvidenceReliabilityScore = Math.max(
      candidate.evidenceReliabilityScore,
      verifiedProblemMatchedDirectCount > 0 && groundedSingleSample
        ? 0.72
        : verifiedProblemMatchedSecondaryCount > 0
          ? 0.58
          : verifiedProblemMatchedTechnicalCount > 0
            ? 0.55
            : verifiedProblemMatchedQuestionCount > 0
              ? 0.45
              : verifiedProblemMatchedObservationCount > 0
                ? 0.44
                : 0,
    );

    const disqualificationReasons = new Set(candidate.disqualificationReasons);

    if (!recurrenceEligible) {
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      );
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_SOURCE_DIVERSITY',
      );
      disqualificationReasons.add(
        verifiedProblemMatchedComplaintCount < MIN_VERIFIED_RECURRENCE_COUNT
          ? 'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE'
          : 'INSUFFICIENT_INDEPENDENT_SOURCE_DIVERSITY',
      );
    } else {
      disqualificationReasons.delete('INSUFFICIENT_EVIDENCE_COUNT');
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      );
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_SOURCE_DIVERSITY',
      );
    }

    const evidencePenalty = Math.max(
      0,
      candidate.evidenceScore - verifiedEvidenceScore,
    );
    const unknownOnlyEvidence =
      resolvedEvidence.length > 0 && retainedEvidence.length === 0;
    const unsupportedProblemPenalty = unknownOnlyEvidence ? 0.22 : 0;
    const adjustedFinalScore = Math.max(
      0,
      Number(
        (
          candidate.finalScore -
          evidencePenalty * 0.35 -
          unsupportedProblemPenalty
        ).toFixed(4),
      ),
    );

    if (unknownOnlyEvidence) {
      disqualificationReasons.add('NO_DIRECT_EVIDENCE');
      disqualificationReasons.add('LOW_EVIDENCE_QUALITY');
    }

    const pilotNonBlockingReasons = new Set([
      'LOW_OPPORTUNITY_SCORE',
      'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      'INSUFFICIENT_INDEPENDENT_SOURCE_DIVERSITY',
      'INSUFFICIENT_EVIDENCE_COUNT',
      'INSUFFICIENT_SUPPORT',
      'LOW_CONFIDENCE_REQUIRES_STRONGER_EVIDENCE',
      'LOW_EVIDENCE_RELIABILITY',
      'LOW_EVIDENCE_QUALITY',
    ]);
    if (
      verifiedProblemMatchedEvidenceCount > 0 &&
      verifiedProblemMatchedDirectCount === 0
    ) {
      pilotNonBlockingReasons.add('NO_DIRECT_EVIDENCE');
    }
    const blockingPilotReasons = [...disqualificationReasons].filter(
      (reason) => !pilotNonBlockingReasons.has(reason),
    );
    const qualifiesAsRetainedEvidencePilot =
      verifiedProblemMatchedEvidenceCount >= 1 &&
      adjustedFinalScore >= MIN_VERIFIED_SINGLE_EVIDENCE_PILOT_SCORE &&
      effectiveEvidenceReliabilityScore >= MIN_SINGLE_EVIDENCE_RELIABILITY &&
      blockingPilotReasons.length === 0;

    if (qualifiesAsRetainedEvidencePilot) {
      disqualificationReasons.delete('LOW_OPPORTUNITY_SCORE');
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      );
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_SOURCE_DIVERSITY',
      );
      disqualificationReasons.delete('INSUFFICIENT_EVIDENCE_COUNT');
      disqualificationReasons.delete('INSUFFICIENT_SUPPORT');
      disqualificationReasons.delete('LOW_CONFIDENCE_REQUIRES_STRONGER_EVIDENCE');
      disqualificationReasons.delete('LOW_EVIDENCE_RELIABILITY');
      disqualificationReasons.delete('LOW_EVIDENCE_QUALITY');
      // A verified problem-matched SUPPORTING signal is trusted evidence.
      // Missing a direct complaint remains a quality/evidence-strength warning
      // (recomputed by the quality evaluator) but must not turn the candidate
      // back into a zero-evidence hypothesis.
      if (
        verifiedProblemMatchedEvidenceCount > 0 &&
        verifiedProblemMatchedDirectCount === 0
      ) {
        disqualificationReasons.delete('NO_DIRECT_EVIDENCE');
      }
    }

    return {
      ...candidate,
      raw: synchronizedRaw,
      supportingEvidence: synchronizedSupportingEvidence,
      frequency: verifiedProblemMatchedEvidenceCount,
      evidenceSamples: retainedEvidence.map((evidence) => evidence.text),
      evidenceScore: verifiedEvidenceScore,
      evidenceReliabilityScore: effectiveEvidenceReliabilityScore,
      finalScore: adjustedFinalScore,
      selectionEligible:
        (recurrenceEligible || qualifiesAsRetainedEvidencePilot) &&
        disqualificationReasons.size === 0,
      disqualificationReasons: [...disqualificationReasons],
      independentEvidence: retainedEvidence,
      verifiedIndependentEvidenceCount: verifiedDirectCount,
      verifiedIndependentSourceCount: verifiedDirectSourceCount,
      verifiedEvidenceCount,
      verifiedDirectUserEvidenceCount: verifiedDirectCount,
      verifiedSecondaryEvidenceCount: verifiedSecondaryCount,
      verifiedTechnicalEvidenceCount: verifiedTechnicalCount,
      verifiedQuestionEvidenceCount: verifiedQuestionCount,
      verifiedObservationEvidenceCount: verifiedObservationCount,
      verifiedComplaintEvidenceCount: verifiedComplaintCount,
      verifiedComplaintSourceCount: verifiedComplaintSourceCount,
      verifiedFeatureRequestEvidenceCount: verifiedFeatureRequestCount,
      verifiedEvidenceSourceCount,
      verifiedProblemMatchedEvidenceCount,
      verifiedProblemMatchedDirectUserEvidenceCount:
        verifiedProblemMatchedDirectCount,
      verifiedProblemMatchedSecondaryEvidenceCount:
        verifiedProblemMatchedSecondaryCount,
      verifiedProblemMatchedTechnicalEvidenceCount:
        verifiedProblemMatchedTechnicalCount,
      verifiedProblemMatchedQuestionEvidenceCount:
        verifiedProblemMatchedQuestionCount,
      verifiedProblemMatchedObservationEvidenceCount:
        verifiedProblemMatchedObservationCount,
      verifiedProblemMatchedComplaintEvidenceCount:
        verifiedProblemMatchedComplaintCount,
      verifiedProblemMatchedComplaintSourceCount:
        verifiedProblemMatchedComplaintSourceCount,
      verifiedProblemMatchedFeatureRequestEvidenceCount:
        verifiedProblemMatchedFeatureRequestCount,
      verifiedProblemMatchedSourceCount:
        verifiedProblemMatchedDirectSourceCount,
      verifiedProblemMatchedEvidenceSourceCount:
        verifiedProblemMatchedEvidenceSourceCount,
    };

  }

  /**
   * Rebuilds candidate-level evidence provenance from independently verified
   * evidence. Provider/ranking classifications are intentionally discarded for
   * evidence-bearing entries so `selected.supportingEvidence`, `raw`, and the
   * independent-evidence counters cannot disagree after verification.
   *
   * Requester/domain/personalization entries are trace metadata rather than
   * external evidence, so they are preserved without being promoted to
   * community evidence.
   */
  private synchronizeSupportingEvidenceMetadata(
    retainedEvidence: readonly IndependentEvidence[],
    existingSupportingEvidence: RankedIdeaOpportunity['supportingEvidence'],
  ): NonNullable<RankedIdeaOpportunity['supportingEvidence']> {
    type SupportingEvidenceEntry = NonNullable<
      RankedIdeaOpportunity['supportingEvidence']
    >[number];

    const verifiedEntries: SupportingEvidenceEntry[] = retainedEvidence.map(
      (evidence) => {
        const direct = this.isDirectUserEvidence(evidence.evidenceKind);
        const technical =
          evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET;
        const communityObservation =
          evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.GENERAL_COMMENTARY &&
          (COMMUNITY_DISCUSSION_SOURCE_KEYS.has(
            evidence.sourceKey.trim().toLocaleLowerCase(),
          ) || evidence.commentExternalId !== null);
        const qualifyingCommunitySupport = direct || communityObservation;

        return {
          text: evidence.text,
          sourceType: qualifyingCommunitySupport
            ? 'COMMUNITY_EVIDENCE'
            : technical
              ? 'TECHNICAL_EVIDENCE'
              : 'SECONDARY_EVIDENCE',
          /*
           * Partial first-person/community observations may support one atomic
           * requester facet without proving recurrence. They therefore remain
           * community evidence, while qualifiesForRecurrence stays false.
           */
          qualifiesAsCommunityEvidence: qualifyingCommunitySupport,
        };
      },
    );

    const traceEntries: SupportingEvidenceEntry[] = (
      existingSupportingEvidence ?? []
    ).filter(
      (entry) =>
        entry.sourceType === 'REQUESTER_STATEMENT' ||
        entry.sourceType === 'REQUESTER_DOMAIN_SELECTION' ||
        entry.sourceType === 'PERSONALIZATION_SIGNAL',
    );

    const seen = new Set<string>();
    return [...verifiedEntries, ...traceEntries].filter((entry) => {
      const normalizedText = entry.text.replace(/\s+/gu, ' ').trim().toLowerCase();
      if (!normalizedText) return false;

      const key = `${entry.sourceType}:${normalizedText}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private synchronizeRawEvidenceMetadata(
    raw: RankedIdeaOpportunity['raw'],
    retainedEvidence: readonly IndependentEvidence[],
  ): RankedIdeaOpportunity['raw'] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return raw;
    }

    const complaintCount = retainedEvidence.filter((evidence) =>
      this.isComplaintEvidence(evidence.evidenceKind),
    ).length;
    const featureRequestCount = retainedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST,
    ).length;
    const observedUnmetNeedCount = retainedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind ===
        INDEPENDENT_EVIDENCE_KINDS.OBSERVED_UNMET_NEED,
    ).length;
    const technicalTicketCount = retainedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET,
    ).length;

    const supportingEvidence = this.synchronizeSupportingEvidenceMetadata(
      retainedEvidence,
      [],
    );

    return {
      ...(raw as Record<string, unknown>),
      directComplaintCount: complaintCount,
      featureRequestCount,
      observedUnmetNeedCount,
      technicalTicketCount,
      supportingEvidence,
    } as unknown as RankedIdeaOpportunity['raw'];
  }


  /**
   * Chooses one coherent problem family from the resolved candidate evidence.
   *
   * The ranking layer may intentionally start with a broad domain family. This
   * verifier narrows that broad family using only retained evidence, preferring
   * clusters with more direct-user support and source diversity. This prevents
   * same-domain but different-problem items from inflating recurrence.
   */
  private selectProblemMatchedEvidence(
    candidate: RankedIdeaOpportunity,
    evidence: readonly IndependentEvidence[],
    problemDescriptor: string,
  ): IndependentEvidence[] {
    const rawCandidate =
      candidate.raw && typeof candidate.raw === 'object' && !Array.isArray(candidate.raw)
        ? candidate.raw as Record<string, unknown>
        : null;
    const requesterDescription =
      rawCandidate && typeof rawCandidate.requestDescription === 'string'
        ? rawCandidate.requestDescription.trim()
        : '';
    const rawSource =
      rawCandidate && typeof rawCandidate.source === 'string'
        ? rawCandidate.source.trim().toUpperCase()
        : '';
    const requesterDefinedCandidate =
      rawSource === 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS' ||
      candidate.title.trim().toLocaleLowerCase() ===
        'requester-defined workflow opportunity';

    const requestScopedEvidence = requesterDescription
      ? evidence.flatMap((item) => {
          if (
            !RequestEvidenceAlignmentUtil.passesPostAiPainAwareEvidenceGuard({
              requestDescription: requesterDescription,
              evidenceText: item.text,
            })
          ) {
            return [];
          }

          const strictRole = RequestEvidenceAlignmentUtil.classifyForRequest({
            requestDescription: requesterDescription,
            evidenceText: item.text,
          });
          const semanticRole =
            strictRole === 'UNRELATED'
              ? RequestEvidenceAlignmentUtil.classifyForRequestFallback({
                  requestDescription: requesterDescription,
                  evidenceText: item.text,
                })
              : strictRole;

          if (semanticRole === 'UNRELATED') return [];
          if (semanticRole !== 'SUPPORTING_SIGNAL') return [item];

          /*
           * A first-person report about only a partial/adjacent facet is still
           * useful supporting evidence, but it is not DIRECT evidence that the
           * requester-owned workflow recurs. Cap the independent-evidence role
           * so examples such as DIY bridesmaid hemming cannot become a direct
           * specialist complaint merely because the prose is first person.
           */
          if (this.isDirectUserEvidence(item.evidenceKind)) {
            return [
              {
                ...item,
                evidenceKind: INDEPENDENT_EVIDENCE_KINDS.GENERAL_COMMENTARY,
                qualifiesForRecurrence: false,
              },
            ];
          }

          return item.qualifiesForRecurrence
            ? [{ ...item, qualifiesForRecurrence: false }]
            : [item];
        })
      : [...evidence];

    if (requestScopedEvidence.length === 0) return [];

    /*
     * External evidence-backed candidates must preserve BOTH identities:
     * requester workflow and candidate problem family. Previously a single
     * request-aligned sample could verify a completely different candidate
     * (for example employee-access evidence validating a crypto/MCP family).
     * Requester-defined validation hypotheses are the only exception because
     * their problem descriptor intentionally wraps the request itself.
     */
    const evidenceForSelection = requesterDefinedCandidate
      ? requestScopedEvidence
      : requestScopedEvidence.filter((item) =>
          matchEvidenceToProblemFamily(problemDescriptor, item.text).matched,
        );

    if (evidenceForSelection.length === 0) return [];

    if (evidenceForSelection.length === 1) {
      return [evidenceForSelection[0]];
    }
    const compositeEvidence =
      RequestEvidenceAlignmentUtil.selectCompositeAlignedEvidence({
        requestDescription: requesterDescription || problemDescriptor,
        evidenceTexts: evidenceForSelection.map((item) => item.text),
        maxSamples: MAX_VERIFIED_EVIDENCE_SAMPLES,
      });
    if (compositeEvidence.length >= 2) {
      const selected = new Set(
        compositeEvidence.map((text) =>
          text.toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
        ),
      );
      return evidenceForSelection.filter((item) =>
        selected.has(
          item.text.toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
        ),
      );
    }

    const segmentedEvidence = evidenceForSelection.flatMap((item) =>
      segmentCommunityEvidenceIssues(item.text).map((text) => ({ item, text })),
    );
    const clusters = clusterEvidenceByProblemFamily(
      segmentedEvidence.map((entry) => entry.text),
    );

    if (clusters.length === 0) {
      return evidenceForSelection.filter((item) =>
        matchEvidenceToProblemFamily(problemDescriptor, item.text).matched,
      );
    }

    const normalized = (value: string) =>
      value.toLowerCase().replace(/\s+/gu, ' ').trim();

    const scoredClusters = clusters.map((cluster) => {
      const clusterTexts = new Set(cluster.evidenceSamples.map(normalized));
      const items = evidenceForSelection.filter((item) =>
        segmentedEvidence.some(
          (entry) =>
            entry.item === item && clusterTexts.has(normalized(entry.text)),
        ),
      );
      const direct = items.filter((item) =>
        this.isDirectUserEvidence(item.evidenceKind),
      );
      const secondary = items.filter((item) =>
        this.isSecondaryEvidence(item.evidenceKind),
      );
      const technical = items.filter(
        (item) =>
          item.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET,
      );
      const directSources = this.countIndependentSourceIdentities(direct);
      const allSources = this.countIndependentSourceIdentities(items);
      const descriptorMatch = matchEvidenceToProblemFamily(
        problemDescriptor,
        cluster.label,
      );
      const specificFamilyBonus =
        cluster.key !== 'generic-friction' &&
        cluster.key !== 'mental-health-care' &&
        !cluster.key.startsWith('lexical:')
          ? 1
          : 0;

      const score =
        direct.length * 4 +
        directSources * 1.5 +
        technical.length * 1.75 +
        secondary.length * 0.8 +
        allSources * 0.35 +
        items.length * 0.2 +
        (descriptorMatch.matched ? descriptorMatch.score * 0.75 : 0) +
        specificFamilyBonus;

      return { cluster, items, score, directCount: direct.length };
    });

    const selected = scoredClusters.sort(
      (first, second) =>
        second.score - first.score ||
        second.directCount - first.directCount ||
        second.items.length - first.items.length ||
        first.cluster.label.localeCompare(second.cluster.label),
    )[0];

    if (!selected || selected.items.length === 0) {
      return evidenceForSelection.filter((item) =>
        matchEvidenceToProblemFamily(problemDescriptor, item.text).matched,
      );
    }

    return selected.items;
  }


  private isGroundedCommunityCandidate(
    candidate: RankedIdeaOpportunity,
  ): boolean {
    if (!candidate.raw || typeof candidate.raw !== 'object' || Array.isArray(candidate.raw)) {
      return false;
    }

    const raw = candidate.raw as Record<string, unknown>;
    const source = typeof raw.source === 'string' ? raw.source : '';
    const groundingScore =
      typeof raw.groundingScore === 'number' ? raw.groundingScore : 0;

    return (
      (source === 'COMMUNITY_AI_ANALYSIS' ||
        source === 'COMMUNITY_LLM_ANALYSIS' ||
        source === 'DIRECT_DOMAIN_EVIDENCE_FALLBACK') &&
      groundingScore >= 70 &&
      candidate.evidenceSamples.length > 0
    );
  }

  private resolveEvidence(
    sample: string,
    records: readonly EvidenceRecord[],
  ): IndependentEvidence | null {
    const sampleVariants = this.buildEvidenceMatchVariants(sample);
    const record = records.find((entry) => {
      const recordVariants = this.buildEvidenceMatchVariants(entry.text);

      return sampleVariants.some((normalizedSample) =>
        recordVariants.some((normalizedRecord) =>
          this.evidenceVariantsMatch(normalizedSample, normalizedRecord),
        ),
      );
    });

    if (!record) {
      return null;
    }

    const evidenceKind = this.classifyEvidence(
      sample,
      record.sourceKey,
      record.commentExternalId !== null,
    );

    return {
      text: sample.trim(),
      sourceKey: record.sourceKey,
      postExternalId: record.postExternalId,
      commentExternalId: record.commentExternalId,
      threadExternalId: record.postExternalId,
      identityKey: this.buildIdentityKey(record),
      evidenceKind,
      qualifiesForRecurrence: this.qualifiesForRecurrence(evidenceKind),
    };
  }

  /**
   * Builds provenance-safe text variants for evidence matching. Collector and
   * NLP layers sometimes wrap a raw comment as
   * "<parent title>. Community comment: <body>" while Prisma stores only the
   * comment body. Matching the canonical body as well as the complete text
   * preserves the original DB provenance without accepting synthetic evidence.
   */
  private buildEvidenceMatchVariants(value: string): string[] {
    const normalizedFull = this.normalizeText(value);
    const commentBody = this.extractCommunityCommentBody(value);
    const normalizedCommentBody = this.normalizeText(commentBody);
    const labelledBody = value
      .replace(
        /^\s*(?:community\s+comment|user\s+comment|review|community\s+review)\s*:\s*/iu,
        '',
      )
      .trim();
    const normalizedLabelledBody = this.normalizeText(labelledBody);

    return [...new Set([
      normalizedFull,
      normalizedCommentBody,
      normalizedLabelledBody,
    ].filter((item) => item.length >= 6))];
  }

  private evidenceVariantsMatch(sample: string, record: string): boolean {
    if (!sample || !record) {
      return false;
    }

    if (sample === record) {
      return true;
    }

    const shorter = sample.length <= record.length ? sample : record;
    const longer = sample.length > record.length ? sample : record;

    /*
     * Exact substring matching is reliable for a meaningful comment body, but
     * very short snippets are intentionally excluded to prevent accidental
     * provenance matches on generic phrases such as "not working".
     */
    if (shorter.length >= 24 && longer.includes(shorter)) {
      return true;
    }

    return (
      this.hasStrongTokenContainment(sample, record) ||
      this.hasStrongTokenContainment(record, sample)
    );
  }

  private classifyEvidence(
    text: string,
    sourceKey: string,
    isComment: boolean,
  ): IndependentEvidenceKind {
    const evidenceText = isComment
      ? this.extractCommunityCommentBody(text)
      : text;
    const normalizedSourceKey = sourceKey.trim().toLowerCase();

    if (
      (isComment || REVIEW_SOURCE_KEYS.has(normalizedSourceKey)) &&
      isPositiveTestimonialWithPreExistingNeed(evidenceText)
    ) {
      return INDEPENDENT_EVIDENCE_KINDS.OBSERVED_UNMET_NEED;
    }

    if (isComment && isPositiveFeedbackWithoutProblem(evidenceText)) {
      return INDEPENDENT_EVIDENCE_KINDS.POSITIVE_FEEDBACK;
    }

    if (
      !isComment &&
      normalizedSourceKey === 'github' &&
      isRelayedCommunityIssueReport(evidenceText)
    ) {
      return INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET;
    }

    const explicitTechnicalFeatureRequest =
      !isComment &&
      isExplicitTechnicalFeatureRequestEvidence(evidenceText, 'POST');

    if (explicitTechnicalFeatureRequest) {
      return INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST;
    }

    if (
      !isComment &&
      normalizedSourceKey === 'github' &&
      this.isEditorialOrGuidePostWithoutDirectExperience(evidenceText)
    ) {
      return INDEPENDENT_EVIDENCE_KINDS.SECONDARY_REPORT;
    }

    const githubPlanningOrAcceptanceText =
      normalizedSourceKey === 'github' &&
      !isComment &&
      /(?:\bproduct outcome\b|\bacceptance\b|\bacceptance criteria\b|\bdefinition of done\b|\bimplementation plan\b|\btechnical design\b|\btest plan\b|\bscope\b|\bdepends on\b|\bverify that\b|\bthe goal is\b|\bmust remain\b|\bmust not\b|\bshould remain\b|\boperators no longer see\b|\bproposed architecture\b)/iu.test(
        evidenceText,
      );

    if (
      githubPlanningOrAcceptanceText ||
      SPECIFICATION_PATTERNS.some((pattern) => pattern.test(evidenceText))
    ) {
      return INDEPENDENT_EVIDENCE_KINDS.SPECIFICATION;
    }

    if (!isComment && NEWS_SOURCE_KEYS.has(normalizedSourceKey)) {
      return INDEPENDENT_EVIDENCE_KINDS.NEWS_REPORT;
    }

    if (!isComment && EDITORIAL_SOURCE_KEYS.has(normalizedSourceKey)) {
      return SECONDARY_REPORT_PATTERNS.some((pattern) => pattern.test(evidenceText))
        ? INDEPENDENT_EVIDENCE_KINDS.SECONDARY_REPORT
        : INDEPENDENT_EVIDENCE_KINDS.EDITORIAL_ANALYSIS;
    }

    if (!isComment && SECONDARY_REPORT_SOURCE_KEYS.has(normalizedSourceKey)) {
      return INDEPENDENT_EVIDENCE_KINDS.SECONDARY_REPORT;
    }

    if (
      !isComment &&
      (normalizedSourceKey === 'github' || normalizedSourceKey === 'stackoverflow')
    ) {
      const structuredTechnicalIssue =
        /(?:^|\n|\r|\b)(?:#{1,6}\s*)?(?:summary|issue|environment|steps? to reproduce|reproduction|expected(?: result| behavior)?|actual(?: result| behavior)?|error message|stack trace|log excerpt|lua\.log)(?:\s*:|\s+(?=[A-Z0-9]))/iu.test(
          evidenceText,
        ) ||
        (/(?:^|\n|\r)\s*#{1,6}\s*(?:problem|expected behavior|actual behavior|impact)\b/iu.test(evidenceText) &&
          /\b(?:bug|issue|expected behavior|actual behavior|impact|requested by)\b/iu.test(evidenceText));
      const hasTechnicalFailure =
        !/\bcrash[- ]course\b/iu.test(evidenceText) &&
        /\b(?:cannot|can['’]?t|unable|fails?|failure|failed|error|bug|crash|broken|missing|blocked|timeout|exception|incorrect|unexpected|freeze|freezes|frozen|hang|hung|unresponsive|inaccessible|404|no visible candidate|focus remains|focus trapped|keystrokes? (?:are )?(?:captured|consumed))\b/iu.test(
          evidenceText,
        );
      const technicalArtifactContext =
        /\b(?:stack trace|traceback|exception|runtime|compiler|build|repository|repo|commit|pull request|branch|function|method|class|api|endpoint|http|json|yaml|sql|database|query|javascript|typescript|python|java|kotlin|swift|dart|flutter|react|angular|node\.js|docker|kubernetes|sdk|cli|package\.json|config|log excerpt|error message|steps? to reproduce|expected result|actual result)\b/iu.test(
          evidenceText,
        );
      const structuredDomainProblem =
        /(?:^|\n|\r)\s*(?:#{1,6}\s*)?(?:problem|job to be done|jtbd|user problem|pain point|unmet need)\s*:/iu.test(
          evidenceText,
        ) &&
        /\b(?:patient|healthcare|health care|medical|medication|preventive|screening|appointment|caregiver|energy|electricity|grid|inverter|mental health|therapy|delivery|shipment|logistics|booking|tourism|government|workforce)\b/iu.test(
          evidenceText,
        );

      /*
       * GitHub is a hosting platform, not an evidence intent. A structured
       * JTBD/problem record without implementation artifacts is retained as a
       * secondary problem report instead of being upgraded to TECHNICAL_TICKET.
       */
      if (
        normalizedSourceKey === 'github' &&
        structuredDomainProblem &&
        !technicalArtifactContext
      ) {
        return INDEPENDENT_EVIDENCE_KINDS.SECONDARY_REPORT;
      }

      if (
        structuredTechnicalIssue ||
        (hasTechnicalFailure &&
          (normalizedSourceKey === 'stackoverflow' || technicalArtifactContext))
      ) {
        return INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET;
      }
    }

    if (!isComment && normalizedSourceKey === 'youtube') {
      const explicitProblemReport =
        SECONDARY_REPORT_PATTERNS.some((pattern) => pattern.test(evidenceText)) ||
        /\b(?:problem|issue|failure|failed|delay|delayed|lost|misplaced|forgotten|incorrect|wrong|outdated|unauthorized|unmanaged|compromised|vulnerab|limited visibility|difficult to identify|hard to identify|manual tracking|paper tags?|waiting longer)\w*\b/iu.test(
          evidenceText,
        );
      if (explicitProblemReport) {
        return INDEPENDENT_EVIDENCE_KINDS.EDITORIAL_ANALYSIS;
      }
    }

    if (!isComment && PUBLISHER_POST_SOURCE_KEYS.has(normalizedSourceKey)) {
      return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
    }

    const directKind = classifyDirectCommunityEvidence(
      evidenceText,
      isComment ? 'COMMENT' : 'POST',
    );

    if (directKind === 'FEATURE_REQUEST') {
      return INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST;
    }

    if (directKind === 'OBSERVED_UNMET_NEED') {
      return INDEPENDENT_EVIDENCE_KINDS.OBSERVED_UNMET_NEED;
    }

    if (directKind === 'USER_COMPLAINT') {
      return REVIEW_SOURCE_KEYS.has(normalizedSourceKey)
        ? INDEPENDENT_EVIDENCE_KINDS.REVIEW
        : INDEPENDENT_EVIDENCE_KINDS.DIRECT_USER_COMPLAINT;
    }

    if (directKind === 'USER_QUESTION') {
      return INDEPENDENT_EVIDENCE_KINDS.USER_QUESTION;
    }

    if (directKind === 'GENERAL_COMMENTARY') {
      return INDEPENDENT_EVIDENCE_KINDS.GENERAL_COMMENTARY;
    }

    if (this.isNonComplaintMediaPost(evidenceText, normalizedSourceKey, isComment)) {
      return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
    }

    return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
  }

  private isEditorialOrGuidePostWithoutDirectExperience(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized) return false;

    const directExperience =
      /\b(?:i|we|my|our)\b[^.!?]{0,160}\b(?:paid|tried|used|submitted|applied|encountered|experienced|was charged|were charged|cannot|can['’]?t|unable|failed|declined|blocked|stuck)\b/iu.test(
        normalized,
      );

    if (directExperience) return false;

    const questionHeadings =
      normalized.match(
        /\b(?:how|what|why|when|where|who|can|should|are|is|do|does)\b[^?]{8,180}\?/giu,
      ) ?? [];
    const guideStructure =
      /\b(?:guide|requirements?|expected wait time|conclusion|frequently asked|faq|step[- ]by[- ]step|eligibility|application guide|before applying|after applying|best practices?|recommendations?|key risks?|key benefits?|future of|final thoughts|what is|how to address|how to implement|organizations should|businesses should)\b/iu.test(
        normalized,
      );
    const articleStructure =
      /(?:^|\s)(?:what is|why |how to |key |best practices?|future of|final thoughts|conclusion)\b/iu.test(normalized) &&
      (normalized.match(/\b(?:organizations?|businesses?|companies?|teams?)\b/giu) ?? []).length >= 2;
    const instructionalDensity =
      (normalized.match(/\b(?:implement|use|apply|monitor|review|validate|secure|protect|ensure|organizations should|teams should)\b/giu) ?? []).length >= 4;

    return (questionHeadings.length >= 3 && guideStructure) ||
      (guideStructure && articleStructure) ||
      (guideStructure && instructionalDensity);
  }

  private isDirectUserEvidence(kind: IndependentEvidenceKind): boolean {
    return (
      kind === INDEPENDENT_EVIDENCE_KINDS.DIRECT_USER_COMPLAINT ||
      kind === INDEPENDENT_EVIDENCE_KINDS.USER_COMPLAINT ||
      kind === INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST ||
      kind === INDEPENDENT_EVIDENCE_KINDS.REVIEW ||
      kind === INDEPENDENT_EVIDENCE_KINDS.OBSERVED_UNMET_NEED
    );
  }

  private isComplaintEvidence(kind: IndependentEvidenceKind): boolean {
    return (
      kind === INDEPENDENT_EVIDENCE_KINDS.DIRECT_USER_COMPLAINT ||
      kind === INDEPENDENT_EVIDENCE_KINDS.USER_COMPLAINT ||
      kind === INDEPENDENT_EVIDENCE_KINDS.REVIEW
    );
  }

  private isSecondaryEvidence(kind: IndependentEvidenceKind): boolean {
    return (
      kind === INDEPENDENT_EVIDENCE_KINDS.SECONDARY_REPORT ||
      kind === INDEPENDENT_EVIDENCE_KINDS.EDITORIAL_ANALYSIS ||
      kind === INDEPENDENT_EVIDENCE_KINDS.NEWS_REPORT
    );
  }

  private extractCommunityCommentBody(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const match = normalized.match(/\bCommunity comment:\s*(.+)$/iu);
    return match?.[1]?.trim() ?? normalized;
  }

  /**
   * Prevents video titles/descriptions from being counted as user complaints.
   * YouTube posts are publisher content; only comments or an explicit
   * first-person software complaint may qualify as community evidence.
   */
  private isNonComplaintMediaPost(
    text: string,
    sourceKey: string,
    isComment: boolean,
  ): boolean {
    if (sourceKey !== 'youtube' || isComment) {
      return false;
    }

    const normalized = text.toLowerCase();
    const isCrashCourseEducationalMedia =
      /\bcrash[- ]course\b/iu.test(normalized) &&
      !/\b(?:app|application|platform|software|website|system|process|service|server|client)\b[^.!?]{0,80}\b(?:crash(?:es|ed|ing)?|freeze|frozen|unresponsive|exception|segfault)\b/iu.test(
        normalized,
      );

    const hasExplicitFirstPersonSoftwareComplaint =
      /\b(?:i|we|my|our)\b/iu.test(normalized) &&
      /\b(?:app|application|platform|software|website|system)\b/iu.test(
        normalized,
      ) &&
      /\b(?:cannot|can't|unable|broken|missing|fails?|failed|crash(?:es|ed|ing)?|freeze|frozen|blocked)\b/iu.test(
        normalized,
      );

    return (
      isCrashCourseEducationalMedia || !hasExplicitFirstPersonSoftwareComplaint
    );
  }

  private qualifiesForRecurrence(kind: IndependentEvidenceKind): boolean {
    return this.isComplaintEvidence(kind);
  }

  private deduplicateIndependentEvidence(
    evidence: readonly IndependentEvidence[],
  ): IndependentEvidence[] {
    const seenIdentityKeys = new Set<string>();
    const seenTexts = new Set<string>();
    const result: IndependentEvidence[] = [];

    for (const item of evidence) {
      const normalizedText = this.normalizeText(item.text);

      if (
        seenIdentityKeys.has(item.identityKey) ||
        seenTexts.has(normalizedText)
      ) {
        continue;
      }

      seenIdentityKeys.add(item.identityKey);
      seenTexts.add(normalizedText);
      result.push(item);
    }

    return result;
  }

  private countIndependentSourceIdentities(
    evidence: readonly IndependentEvidence[],
  ): number {
    return new Set(
      evidence.map((item) =>
        EvidenceSourceIdentityUtil.resolve({
          sourceKey: item.sourceKey,
          text: item.text,
          id: item.postExternalId,
        }),
      ),
    ).size;
  }

  private buildIdentityKey(record: {
    readonly sourceKey: string;
    readonly postExternalId: string;
    readonly commentExternalId: string | null;
    readonly author: string | null;
  }): string {
    const normalizedAuthor = this.normalizeText(record.author ?? '');

    if (normalizedAuthor) {
      return `${record.sourceKey}:author:${normalizedAuthor}:thread:${record.postExternalId}`;
    }

    if (record.commentExternalId) {
      return `${record.sourceKey}:comment:${record.commentExternalId}`;
    }

    return `${record.sourceKey}:post:${record.postExternalId}`;
  }

  private mergePostText(title: string | null, content: string): string {
    return [title, content].filter(Boolean).join('\n').trim();
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/<[^>]+>/gu, ' ')
      .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/giu, ' ')
      .replace(/[`*_>#()[\]{}.,!?;:\/'"“”‘’|+=~-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  /** Resolves harmless formatting differences for long source excerpts. */
  private hasStrongTokenContainment(sample: string, record: string): boolean {
    const sampleTokens = [...new Set(sample.split(' ').filter(Boolean))];
    const recordTokens = new Set(record.split(' ').filter(Boolean));

    if (sampleTokens.length < 12 || recordTokens.size < 12) {
      return false;
    }

    const matched = sampleTokens.filter((token) => recordTokens.has(token)).length;
    return matched / sampleTokens.length >= 0.88;
  }

  private calculateEvidenceCoverage(
    candidates: readonly RankedIdeaOpportunity[],
  ): number {
    if (candidates.length === 0) {
      return 0;
    }

    const eligibleCount = candidates.filter(
      (candidate) => candidate.selectionEligible,
    ).length;

    return Number((eligibleCount / candidates.length).toFixed(4));
  }

  private buildSelectionReason(selected: RankedIdeaOpportunity): string {
    const directCount =
      selected.verifiedProblemMatchedDirectUserEvidenceCount ??
      selected.verifiedDirectUserEvidenceCount ??
      selected.verifiedIndependentEvidenceCount ??
      0;
    const complaintCount =
      selected.verifiedProblemMatchedComplaintEvidenceCount ??
      selected.verifiedComplaintEvidenceCount ??
      directCount;
    const featureRequestCount =
      selected.verifiedProblemMatchedFeatureRequestEvidenceCount ??
      selected.verifiedFeatureRequestEvidenceCount ??
      0;
    const complaintSourceCount =
      selected.verifiedProblemMatchedComplaintSourceCount ??
      selected.verifiedComplaintSourceCount ??
      0;
    const secondaryCount =
      selected.verifiedProblemMatchedSecondaryEvidenceCount ??
      selected.verifiedSecondaryEvidenceCount ??
      0;
    const technicalCount =
      selected.verifiedProblemMatchedTechnicalEvidenceCount ??
      selected.verifiedTechnicalEvidenceCount ??
      0;
    const questionCount =
      selected.verifiedProblemMatchedQuestionEvidenceCount ??
      selected.verifiedQuestionEvidenceCount ??
      0;
    const observationCount =
      selected.verifiedProblemMatchedObservationEvidenceCount ??
      selected.verifiedObservationEvidenceCount ??
      0;
    const totalCount =
      selected.verifiedProblemMatchedEvidenceCount ??
      selected.verifiedEvidenceCount ??
      directCount + secondaryCount + technicalCount + questionCount + observationCount;
    const directSourceCount =
      selected.verifiedProblemMatchedSourceCount ??
      selected.verifiedIndependentSourceCount ??
      0;
    const totalSourceCount =
      selected.verifiedProblemMatchedEvidenceSourceCount ??
      selected.verifiedEvidenceSourceCount ??
      this.countIndependentSourceIdentities(selected.independentEvidence ?? []);
    const diagnosticTotal = selected.verifiedEvidenceCount ?? totalCount;

    if (selected.selectionEligible) {
      if (
        complaintCount >= MIN_VERIFIED_RECURRENCE_COUNT &&
        complaintSourceCount >= MIN_VERIFIED_SOURCE_COUNT
      ) {
        return `Selected after verifying ${complaintCount} problem-matched complaint/review signals across ${complaintSourceCount} independent sources.`;
      }

      if (directCount > 0) {
        const diagnosticSuffix =
          diagnosticTotal > totalCount
            ? ` ${diagnosticTotal - totalCount} additional same-domain evidence item(s) were excluded because they did not match the selected atomic problem.`
            : '';
        const signalParts = [
          complaintCount > 0
            ? `${complaintCount} complaint/review signal(s)`
            : '',
          featureRequestCount > 0
            ? `${featureRequestCount} feature request(s)`
            : '',
        ].filter(Boolean);
        return `Selected as a preliminary pilot after retaining ${directCount} problem-matched direct-user signal(s) across ${Math.max(1, directSourceCount)} source(s)${signalParts.length > 0 ? ` (${signalParts.join(', ')})` : ''}. Recurrence of one operational problem is not established.${diagnosticSuffix}`;
      }

      if (secondaryCount > 0) {
        return `Selected as a preliminary pilot from ${secondaryCount} problem-matched secondary report(s) across ${Math.max(1, totalSourceCount)} source(s). No verified direct user complaint establishes recurrence.`;
      }

      if (technicalCount > 0) {
        return `Selected as a preliminary pilot from ${technicalCount} problem-matched technical ticket(s) across ${Math.max(1, totalSourceCount)} source(s). User recurrence is not established.`;
      }

      if (questionCount > 0) {
        return `Selected as a bounded validation pilot from ${questionCount} problem-matched user scenario question(s) across ${Math.max(1, totalSourceCount)} source(s). The question is not counted as a direct user complaint or recurrence evidence.`;
      }
      if (observationCount > 0) {
        return `Selected as a bounded validation pilot from ${observationCount} problem-matched community observation(s) across ${Math.max(1, totalSourceCount)} source(s). No verified direct user complaint establishes recurrence; the product response remains a pilot hypothesis.`;
      }
    }

    if (totalCount > 0) {
      return `${totalCount === 1 ? 'One problem-matched evidence item was retained' : `${totalCount} problem-matched evidence items were retained`}, but direct-user recurrence has not been established across at least ${MIN_VERIFIED_SOURCE_COUNT} independent sources.`;
    }

    return 'No problem-matched retained evidence was verified, so the selected direction must remain an explicitly unvalidated primary-domain hypothesis.';
  }

  private mergeWarnings(
    existingWarnings: readonly string[],
    selected: RankedIdeaOpportunity,
  ): readonly string[] {
    const warnings = new Set(existingWarnings);
    const directCount =
      selected.verifiedProblemMatchedDirectUserEvidenceCount ??
      selected.verifiedDirectUserEvidenceCount ??
      selected.verifiedIndependentEvidenceCount ??
      0;
    const complaintCount =
      selected.verifiedProblemMatchedComplaintEvidenceCount ??
      selected.verifiedComplaintEvidenceCount ??
      directCount;
    const featureRequestCount =
      selected.verifiedProblemMatchedFeatureRequestEvidenceCount ??
      selected.verifiedFeatureRequestEvidenceCount ??
      0;
    const complaintSourceCount =
      selected.verifiedProblemMatchedComplaintSourceCount ??
      selected.verifiedComplaintSourceCount ??
      0;
    const secondaryCount =
      selected.verifiedProblemMatchedSecondaryEvidenceCount ??
      selected.verifiedSecondaryEvidenceCount ??
      0;
    const technicalCount =
      selected.verifiedProblemMatchedTechnicalEvidenceCount ??
      selected.verifiedTechnicalEvidenceCount ??
      0;
    const questionCount =
      selected.verifiedProblemMatchedQuestionEvidenceCount ??
      selected.verifiedQuestionEvidenceCount ??
      0;
    const observationCount =
      selected.verifiedProblemMatchedObservationEvidenceCount ??
      selected.verifiedObservationEvidenceCount ??
      0;
    const totalCount =
      selected.verifiedProblemMatchedEvidenceCount ??
      selected.verifiedEvidenceCount ??
      directCount + secondaryCount + technicalCount + questionCount + observationCount;
    const directSourceCount =
      selected.verifiedProblemMatchedSourceCount ??
      selected.verifiedIndependentSourceCount ??
      0;
    const diagnosticTotal = selected.verifiedEvidenceCount ?? totalCount;

    if (directCount === 0) {
      for (const warning of [...warnings]) {
        if (
          /(?:selected opportunity is supported by .*verified direct user|preliminary problem-matched direct-user evidence|only preliminary direct-user evidence)/iu.test(
            warning,
          )
        ) {
          warnings.delete(warning);
        }
      }
    }

    if (!selected.selectionEligible) {
      warnings.add(
        'The strongest signal did not contain enough problem-matched retained evidence for a reliable primary opportunity.',
      );
    } else if (directCount === 0 && secondaryCount > 0) {
      warnings.add(
        `The selected opportunity is supported by ${secondaryCount} problem-matched secondary report(s) and no verified direct user complaint. Recurrence and market-wide demand remain unproven.`,
      );
    } else if (
      directCount > 0 &&
      (complaintCount < MIN_VERIFIED_RECURRENCE_COUNT ||
        complaintSourceCount < MIN_VERIFIED_SOURCE_COUNT)
    ) {
      warnings.add(
        `Only preliminary problem-matched direct-user evidence is available; recurrence of one operational problem requires at least ${MIN_VERIFIED_RECURRENCE_COUNT} complaint/review signals across ${MIN_VERIFIED_SOURCE_COUNT} independent sources. Feature requests remain demand signals but do not by themselves prove complaint recurrence.`,
      );
    }

    if (
      totalCount > 0 &&
      directCount === 0 &&
      secondaryCount === 0 &&
      technicalCount > 0
    ) {
      warnings.add(
        'Retained problem-matched technical evidence may support a bounded pilot, but it does not establish direct user demand or recurrence.',
      );
    }

    if (
      totalCount > 0 &&
      directCount === 0 &&
      secondaryCount === 0 &&
      technicalCount === 0 &&
      questionCount > 0
    ) {
      warnings.add(
        'Retained problem-matched scenario questions may support bounded discovery, but they are not direct user complaints and do not establish recurrence.',
      );
    }
    if (
      totalCount > 0 &&
      directCount === 0 &&
      secondaryCount === 0 &&
      technicalCount === 0 &&
      questionCount === 0 &&
      observationCount > 0
    ) {
      warnings.add(
        'Retained problem-matched community observations may justify a bounded pilot hypothesis, but they are not first-person direct user complaints and do not establish recurrence or prevalence.',
      );
    }

    if (diagnosticTotal > totalCount) {
      warnings.add(
        `${diagnosticTotal - totalCount} additional verified same-domain evidence item(s) were excluded from recurrence because they did not match the selected atomic problem.`,
      );
    }

    return [...warnings];
  }

}
