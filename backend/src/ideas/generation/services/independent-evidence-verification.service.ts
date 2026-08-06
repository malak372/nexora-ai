import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  INDEPENDENT_EVIDENCE_KINDS,
  type IndependentEvidence,
  type IndependentEvidenceKind,
} from '../types/independent-evidence.type';
import type {
  IdeaOpportunityRanking,
  RankedIdeaOpportunity,
} from '../types/idea-opportunity-ranking.type';

const MIN_VERIFIED_RECURRENCE_COUNT = 3;
const MIN_VERIFIED_SOURCE_COUNT = 2;
const MAX_VERIFIED_EVIDENCE_SAMPLES = 8;
const MIN_VERIFIED_SINGLE_EVIDENCE_PILOT_SCORE = 0.25;

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
  constructor(private readonly prisma: PrismaService) {}

  async verifyRanking(
    ranking: IdeaOpportunityRanking,
    collectionJobIds: readonly string[],
  ): Promise<IdeaOpportunityRanking> {
    const records = await this.loadEvidenceRecords(collectionJobIds);

    const verified = [ranking.selected, ...ranking.alternatives].map(
      (candidate) => this.verifyCandidate(candidate, records),
    );

    const sorted = [...verified].sort((first, second) => {
      if (first.selectionEligible !== second.selectionEligible) {
        return first.selectionEligible ? -1 : 1;
      }

      return (
        second.frequency - first.frequency ||
        second.finalScore - first.finalScore ||
        second.evidenceReliabilityScore - first.evidenceReliabilityScore
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

  private async loadEvidenceRecords(collectionJobIds: readonly string[]) {
    const uniqueJobIds = [...new Set(collectionJobIds.filter(Boolean))];

    if (uniqueJobIds.length === 0) {
      return [];
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

    return posts.flatMap((post) => {
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
  }

  private verifyCandidate(
    candidate: RankedIdeaOpportunity,
    records: ReadonlyArray<{
      readonly text: string;
      readonly sourceKey: string;
      readonly postExternalId: string;
      readonly commentExternalId: string | null;
      readonly author: string | null;
    }>,
  ): RankedIdeaOpportunity {
    const resolvedEvidence = this.deduplicateIndependentEvidence(
      candidate.evidenceSamples
        .map((sample) => this.resolveEvidence(sample, records))
        .filter((evidence): evidence is IndependentEvidence => Boolean(evidence)),
    ).slice(0, MAX_VERIFIED_EVIDENCE_SAMPLES);

    const directEvidence = resolvedEvidence.filter(
      (evidence) =>
        evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.UNKNOWN &&
        evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.SPECIFICATION,
    );
    const qualifyingEvidence = directEvidence.filter(
      (evidence) => evidence.qualifiesForRecurrence,
    );

    const verifiedCount = qualifyingEvidence.length;
    const verifiedSourceCount = new Set(
      qualifyingEvidence.map((evidence) => evidence.sourceKey),
    ).size;
    const verifiedEvidenceScore = Math.min(verifiedCount / 5, 1);
    const recurrenceEligible =
      verifiedCount >= MIN_VERIFIED_RECURRENCE_COUNT &&
      verifiedSourceCount >= MIN_VERIFIED_SOURCE_COUNT;

    const disqualificationReasons = new Set(candidate.disqualificationReasons);

    if (!recurrenceEligible) {
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_COMMUNITY_EVIDENCE',
      );
      disqualificationReasons.delete(
        'INSUFFICIENT_INDEPENDENT_SOURCE_DIVERSITY',
      );
      disqualificationReasons.add(
        verifiedCount < MIN_VERIFIED_RECURRENCE_COUNT
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
      resolvedEvidence.length > 0 && directEvidence.length === 0;
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

    /*
     * A candidate that passes the recurrence and source-diversity gate may be
     * restored when the sole remaining failure is the aggregate score and the
     * verified evidence is reliable. Scientific-validity failures remain
     * blocking and can never be bypassed by this pilot fallback.
     */
    const nonScoreReasons = [...disqualificationReasons].filter(
      (reason) => reason !== 'LOW_OPPORTUNITY_SCORE',
    );
    const qualifiesAsVerifiedPilot =
      recurrenceEligible &&
      qualifyingEvidence.length >= 1 &&
      adjustedFinalScore >= MIN_VERIFIED_SINGLE_EVIDENCE_PILOT_SCORE &&
      candidate.evidenceReliabilityScore >= 0.7 &&
      nonScoreReasons.length === 0;

    if (qualifiesAsVerifiedPilot) {
      disqualificationReasons.delete('LOW_OPPORTUNITY_SCORE');
    }

    return {
      ...candidate,
      frequency: verifiedCount,
      /*
       * Preserve every resolved direct sample for downstream ranking and prompt
       * grounding. Only qualifyingEvidence contributes to recurrence counts;
       * an exact one-off developer report must not disappear merely because it
       * has not reached the multi-source recurrence gate.
       */
      evidenceSamples: directEvidence.map((evidence) => evidence.text),
      evidenceScore: verifiedEvidenceScore,
      finalScore: adjustedFinalScore,
      selectionEligible:
        recurrenceEligible && disqualificationReasons.size === 0,
      disqualificationReasons: [...disqualificationReasons],
      independentEvidence: directEvidence,
      verifiedIndependentEvidenceCount: verifiedCount,
      verifiedIndependentSourceCount: verifiedSourceCount,
    };
  }

  private resolveEvidence(
    sample: string,
    records: ReadonlyArray<{
      readonly text: string;
      readonly sourceKey: string;
      readonly postExternalId: string;
      readonly commentExternalId: string | null;
      readonly author: string | null;
    }>,
  ): IndependentEvidence | null {
    const normalizedSample = this.normalizeText(sample);
    const record = records.find((entry) => {
      const normalizedRecord = this.normalizeText(entry.text);
      return (
        normalizedRecord === normalizedSample ||
        normalizedRecord.includes(normalizedSample) ||
        normalizedSample.includes(normalizedRecord) ||
        this.hasStrongTokenContainment(normalizedSample, normalizedRecord)
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

  private classifyEvidence(
    text: string,
    sourceKey: string,
    isComment: boolean,
  ): IndependentEvidenceKind {
    if (SPECIFICATION_PATTERNS.some((pattern) => pattern.test(text))) {
      return INDEPENDENT_EVIDENCE_KINDS.SPECIFICATION;
    }

    if (REVIEW_SOURCE_KEYS.has(sourceKey)) {
      if (!isComment) {
        return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
      }

      if (FEATURE_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
        return INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST;
      }

      if (
        COMPLAINT_PATTERNS.some((pattern) => pattern.test(text)) ||
        /\b(?:can'?t|cant|is it possible|is it possable|can i|could i)\b/iu.test(
          text,
        )
      ) {
        return INDEPENDENT_EVIDENCE_KINDS.REVIEW;
      }

      return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
    }

    if (FEATURE_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
      return INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST;
    }

    if (this.isNonComplaintMediaPost(text, sourceKey, isComment)) {
      return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
    }

    if (COMPLAINT_PATTERNS.some((pattern) => pattern.test(text))) {
      return INDEPENDENT_EVIDENCE_KINDS.USER_COMPLAINT;
    }

    if (sourceKey === 'github' || sourceKey === 'stackoverflow') {
      return INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET;
    }

    if (isComment) {
      return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
    }

    return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
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
      /\bcrash course\b/iu.test(normalized) &&
      /\b(?:sociology|history|biology|chemistry|physics|psychology|economics|literature|education|episode|lesson|today we(?:'ll| will) explore)\b/iu.test(
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
    return (
      kind === INDEPENDENT_EVIDENCE_KINDS.USER_COMPLAINT ||
      kind === INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST ||
      kind === INDEPENDENT_EVIDENCE_KINDS.REVIEW
    );
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
    return selected.selectionEligible
      ? `Selected after verifying ${selected.verifiedIndependentEvidenceCount ?? 0} independent community reports across ${selected.verifiedIndependentSourceCount ?? 0} source(s).`
      : `No opportunity currently has at least ${MIN_VERIFIED_RECURRENCE_COUNT} independently verified community reports across ${MIN_VERIFIED_SOURCE_COUNT} independent sources.`;
  }

  private mergeWarnings(
    existingWarnings: readonly string[],
    selected: RankedIdeaOpportunity,
  ): readonly string[] {
    const warnings = new Set(existingWarnings);

    if (!selected.selectionEligible) {
      warnings.add(
        `The strongest signal did not contain at least ${MIN_VERIFIED_RECURRENCE_COUNT} independently verified reports across ${MIN_VERIFIED_SOURCE_COUNT} independent sources.`,
      );
    }

    if (
      selected.independentEvidence?.some(
        (evidence) =>
          evidence.evidenceKind === INDEPENDENT_EVIDENCE_KINDS.SPECIFICATION,
      )
    ) {
      warnings.add(
        'Technical specifications or test checklists were excluded from the recurrence count.',
      );
    }

    return [...warnings];
  }
}