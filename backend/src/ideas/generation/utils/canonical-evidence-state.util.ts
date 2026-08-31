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
     * Keep the canonical state aligned with CommunityAiAnalysisService's
     * accepted full-corpus partial-adjudication contract. A bounded corpus is
     * still usable when one model returned at least eight valid per-item
     * verdicts, no more than three rows remain unresolved, and coverage is at
     * least 70%. The unresolved tail stays explicitly UNADJUDICATED and is
     * never promoted into positive or negative evidence.
     *
     * This prevents a 10/12 result from being mislabeled as a provider outage
     * while preserving the distinction for genuinely incomplete adjudication.
     */
    const adjudicationCoverage =
      adjudicatedCount / Math.max(1, ledger.length);
    const highCoveragePartialAdjudication = Boolean(
      adjudicatedCount >= 8 &&
        unadjudicatedCount > 0 &&
        unadjudicatedCount <= 3 &&
        adjudicationCoverage >= 0.7,
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
