import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type { IdeaGenerationEvidenceState } from '../types/canonical-problem-spec.type';

export type CanonicalEvidenceStateSnapshot = {
  readonly state: IdeaGenerationEvidenceState;
  readonly trustedCount: number;
  readonly directCount: number;
  readonly supportingCount: number;
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
    const directCount = trusted.filter((item) => item.classification === 'DIRECT_PROBLEM').length;
    const supportingCount = trusted.filter((item) => item.classification === 'SUPPORTING_SIGNAL').length;
    const state: IdeaGenerationEvidenceState = directCount > 0
      ? 'DIRECT_VALIDATED'
      : supportingCount > 0
        ? 'SUPPORTING_VALIDATED'
        : 'ZERO_VALIDATED_EVIDENCE';

    return {
      state,
      trustedCount: trusted.length,
      directCount,
      supportingCount,
      sourceCount: new Set(trusted.map((item) => item.sourceKey.toLocaleLowerCase())).size,
      verifiedFacetIds: [
        ...new Set(trusted.flatMap((item) => item.matchedFacetIds ?? [])),
      ],
    };
  }
}
