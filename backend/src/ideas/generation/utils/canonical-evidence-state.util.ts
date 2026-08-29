import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type { IdeaGenerationEvidenceState } from '../types/canonical-problem-spec.type';
import { EvidenceSourceIdentityUtil } from './evidence-source-identity.util';

export type CanonicalEvidenceStateSnapshot = {
  readonly state: IdeaGenerationEvidenceState;
  readonly trustedCount: number;
  readonly directCount: number;
  readonly supportingCount: number;
  readonly unadjudicatedCount: number;
  readonly adjudicatedCount: number;
  readonly sourceCount: number;
  readonly verifiedFacetIds: readonly string[];
};

export class CanonicalEvidenceStateUtil {
  static compute(
    ledger: readonly IdeaGenerationContext['canonicalEvidenceLedger'][number][],
  ): CanonicalEvidenceStateSnapshot {
    const trusted = ledger.filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const directCount = trusted.filter(
      (item) => item.classification === 'DIRECT_PROBLEM',
    ).length;
    const supportingCount = trusted.filter(
      (item) => item.classification === 'SUPPORTING_SIGNAL',
    ).length;
    const unadjudicatedCount = ledger.filter(
      (item) =>
        item.classification === 'UNADJUDICATED' ||
        item.adjudicationStatus === 'UNADJUDICATED',
    ).length;
    const adjudicatedCount = Math.max(0, ledger.length - unadjudicatedCount);

    /*
     * Zero-trusted evidence keeps provider failure distinct from a completed
     * negative semantic verdict. A very large full-corpus attempt may return a
     * tiny malformed/omitted tail while still adjudicating >=92% of the SAME
     * complete corpus with one model. In that case the adjudicated ledger is
     * usable and the unresolved tail remains explicitly UNADJUDICATED; one row
     * must not poison forty-plus valid sibling verdicts.
     *
     * This is structural coverage accounting only. It never infers relevance
     * for the unresolved rows and never promotes CONTEXT/UNRELATED evidence.
     */
    const highCoveragePartialAdjudication = Boolean(
      ledger.length >= 32 &&
        unadjudicatedCount > 0 &&
        unadjudicatedCount <= 3 &&
        adjudicatedCount / Math.max(1, ledger.length) >= 0.92,
    );
    const state: IdeaGenerationEvidenceState =
      directCount > 0
        ? 'DIRECT_VALIDATED'
        : supportingCount > 0
          ? 'SUPPORTING_VALIDATED'
          : unadjudicatedCount > 0 && !highCoveragePartialAdjudication
            ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
            : 'NO_VALID_EVIDENCE_FOUND';

    return {
      state,
      trustedCount: trusted.length,
      directCount,
      supportingCount,
      unadjudicatedCount,
      adjudicatedCount,
      sourceCount: EvidenceSourceIdentityUtil.count(trusted),
      verifiedFacetIds: [
        ...new Set(trusted.flatMap((item) => item.matchedFacetIds ?? [])),
      ],
    };
  }
}
