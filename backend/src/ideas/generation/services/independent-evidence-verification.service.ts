import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { classifyDirectCommunityEvidence } from '../../../nlp/common/utils/community-evidence.util';
import { matchEvidenceToProblemFamily } from '../../../nlp/common/utils/problem-family-matching.util';
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
    const classifiedDirectEvidence = nonSpecificationEvidence.filter(
      (evidence) =>
        evidence.evidenceKind !== INDEPENDENT_EVIDENCE_KINDS.UNKNOWN,
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
    const problemMatchedEvidence = classifiedDirectEvidence.filter(
      (evidence) =>
        groundedCommunityCandidate ||
        matchEvidenceToProblemFamily(problemDescriptor, evidence.text).matched,
    );
    const groundedSingleSample =
      groundedCommunityCandidate && problemMatchedEvidence.length > 0;
    const retainedEvidence = problemMatchedEvidence;
    const qualifyingEvidence = problemMatchedEvidence.filter(
      (evidence) => evidence.qualifiesForRecurrence,
    );

    const verifiedCount = qualifyingEvidence.length;
    const verifiedSourceCount = new Set(
      qualifyingEvidence.map((evidence) => evidence.sourceKey),
    ).size;
    const verifiedEvidenceScore = Math.max(
      Math.min(verifiedCount / 5, 1),
      groundedSingleSample ? MIN_GROUNDED_SINGLE_SAMPLE_SCORE : 0,
    );
    const recurrenceEligible =
      verifiedCount >= MIN_VERIFIED_RECURRENCE_COUNT &&
      verifiedSourceCount >= MIN_VERIFIED_SOURCE_COUNT;
    const effectiveEvidenceReliabilityScore = Math.max(
      candidate.evidenceReliabilityScore,
      groundedSingleSample ? 0.72 : 0,
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

    /*
     * A candidate that passes the recurrence and source-diversity gate may be
     * restored when the sole remaining failure is the aggregate score and the
     * verified evidence is reliable. Scientific-validity failures remain
     * blocking and can never be bypassed by this pilot fallback.
     */
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
    const blockingPilotReasons = [...disqualificationReasons].filter(
      (reason) => !pilotNonBlockingReasons.has(reason),
    );
    const qualifiesAsVerifiedPilot =
      qualifyingEvidence.length >= 1 &&
      adjustedFinalScore >= MIN_VERIFIED_SINGLE_EVIDENCE_PILOT_SCORE &&
      effectiveEvidenceReliabilityScore >= MIN_SINGLE_EVIDENCE_RELIABILITY &&
      blockingPilotReasons.length === 0;

    if (qualifiesAsVerifiedPilot) {
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
      evidenceSamples: retainedEvidence.map((evidence) => evidence.text),
      evidenceScore: verifiedEvidenceScore,
      evidenceReliabilityScore: effectiveEvidenceReliabilityScore,
      finalScore: adjustedFinalScore,
      selectionEligible:
        (recurrenceEligible || qualifiesAsVerifiedPilot) &&
        disqualificationReasons.size === 0,
      disqualificationReasons: [...disqualificationReasons],
      independentEvidence: retainedEvidence,
      verifiedIndependentEvidenceCount: verifiedCount,
      verifiedIndependentSourceCount: verifiedSourceCount,
    };
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
    const githubPlanningOrAcceptanceText =
      sourceKey === 'github' &&
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

    const directKind = classifyDirectCommunityEvidence(
      evidenceText,
      isComment ? 'COMMENT' : 'POST',
    );

    if (directKind === 'FEATURE_REQUEST') {
      return INDEPENDENT_EVIDENCE_KINDS.FEATURE_REQUEST;
    }

    if (directKind === 'USER_COMPLAINT') {
      return REVIEW_SOURCE_KEYS.has(sourceKey)
        ? INDEPENDENT_EVIDENCE_KINDS.REVIEW
        : INDEPENDENT_EVIDENCE_KINDS.USER_COMPLAINT;
    }

    if (this.isNonComplaintMediaPost(evidenceText, sourceKey, isComment)) {
      return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
    }

    /*
     * Technical tickets remain useful engineering evidence only when they are
     * not merely comments/proposals and were not rejected by the shared direct
     * community classifier as adversarial, promotional, or non-problem text.
     */
    if (!isComment && (sourceKey === 'github' || sourceKey === 'stackoverflow')) {
      const hasTechnicalFailure =
        /\b(?:cannot|can['’]?t|unable|fails?|failed|error|bug|crash|broken|missing|blocked|timeout|exception|incorrect|unexpected)\b/iu.test(
          evidenceText,
        );
      if (hasTechnicalFailure) {
        return INDEPENDENT_EVIDENCE_KINDS.TECHNICAL_TICKET;
      }
    }

    return INDEPENDENT_EVIDENCE_KINDS.UNKNOWN;
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
    const verifiedEvidenceCount =
      selected.verifiedIndependentEvidenceCount ?? 0;
    const verifiedSourceCount = selected.verifiedIndependentSourceCount ?? 0;
    const retainedDirectEvidenceCount = Math.max(
      verifiedEvidenceCount,
      selected.independentEvidence?.length ?? 0,
      selected.evidenceSamples.length,
    );

    if (selected.selectionEligible) {
      if (
        verifiedEvidenceCount < MIN_VERIFIED_RECURRENCE_COUNT ||
        verifiedSourceCount < MIN_VERIFIED_SOURCE_COUNT
      ) {
        return `Selected as a preliminary pilot after retaining ${verifiedEvidenceCount} problem-matched verified community report(s) across ${verifiedSourceCount} source(s). Recurrence is not established.`;
      }

      return `Selected after verifying ${verifiedEvidenceCount} problem-matched independent community reports across ${verifiedSourceCount} source(s).`;
    }

    if (retainedDirectEvidenceCount > 0) {
      const retainedLabel =
        retainedDirectEvidenceCount === 1
          ? 'One direct grounded community report was retained'
          : `${retainedDirectEvidenceCount} direct grounded community reports were retained`;

      return `${retainedLabel}, but the evidence does not yet satisfy the independent recurrence requirement of at least ${MIN_VERIFIED_RECURRENCE_COUNT} verified reports across ${MIN_VERIFIED_SOURCE_COUNT} independent sources.`;
    }

    return `No direct community evidence was retained, so the selected direction must remain an explicitly unvalidated primary-domain hypothesis.`;
  }

  private mergeWarnings(
    existingWarnings: readonly string[],
    selected: RankedIdeaOpportunity,
  ): readonly string[] {
    const warnings = new Set(existingWarnings);

    if (!selected.selectionEligible) {
      warnings.add(
        `The strongest signal did not contain at least one problem-matched verified community report suitable for a preliminary pilot.`,
      );
    } else if (
      (selected.verifiedIndependentEvidenceCount ?? 0) <
        MIN_VERIFIED_RECURRENCE_COUNT ||
      (selected.verifiedIndependentSourceCount ?? 0) < MIN_VERIFIED_SOURCE_COUNT
    ) {
      warnings.add(
        `Only preliminary problem-matched evidence is available; recurrence requires at least ${MIN_VERIFIED_RECURRENCE_COUNT} verified reports across ${MIN_VERIFIED_SOURCE_COUNT} independent sources.`,
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