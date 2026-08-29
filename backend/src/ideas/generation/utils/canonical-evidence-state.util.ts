import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type { IdeaGenerationEvidenceState } from '../types/canonical-problem-spec.type';

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
     * These two zero-trusted states are intentionally different:
     * - NO_VALID_EVIDENCE_FOUND: semantic adjudication completed and rejected
     *   the corpus as non-trusted/context-only.
     * - EVIDENCE_ADJUDICATION_UNAVAILABLE: at least one raw row still has no
     *   semantic AI verdict, so the system must not claim that no evidence was
     *   found. The correct statement is that evidence validity is unknown.
     */
    const state: IdeaGenerationEvidenceState =
      directCount > 0
        ? 'DIRECT_VALIDATED'
        : supportingCount > 0
          ? 'SUPPORTING_VALIDATED'
          : unadjudicatedCount > 0
            ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
            : 'NO_VALID_EVIDENCE_FOUND';

    return {
      state,
      trustedCount: trusted.length,
      directCount,
      supportingCount,
      unadjudicatedCount,
      adjudicatedCount,
      sourceCount: new Set(
        trusted.map((item) => item.sourceKey.toLocaleLowerCase()),
      ).size,
      verifiedFacetIds: [
        ...new Set(trusted.flatMap((item) => item.matchedFacetIds ?? [])),
      ],
    };
  }
}
