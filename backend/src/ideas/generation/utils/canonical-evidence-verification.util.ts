import type {
  IdeaGenerationCanonicalEvidenceItem,
  IdeaGenerationRawEvidenceItem,
  SelectedGenerationDomain,
} from '../types/idea-generation-context.type';
import type {
  IdeaGenerationCanonicalProblemSpec,
  IdeaGenerationRequestMode,
} from '../types/canonical-problem-spec.type';
import type {
  CommunityAiEvidenceNature,
  CommunityAiProblemFamilyBasis,
  CommunityAiSemanticAlignment,
} from '../types/community-ai-analysis.type';

export type CanonicalEvidenceProposal = {
  readonly classification: IdeaGenerationCanonicalEvidenceItem['classification'];
  readonly confidence: number;
  readonly problemFamily: string | null;
  readonly verifiedByDeterministicGuard: boolean;
  readonly origin: IdeaGenerationCanonicalEvidenceItem['origin'];
  readonly evidenceNature?: CommunityAiEvidenceNature;
  readonly domainAlignment?: CommunityAiSemanticAlignment;
  readonly problemAlignment?: CommunityAiSemanticAlignment;
  readonly familyBasis?: CommunityAiProblemFamilyBasis;
  readonly observedProblem?: string | null;
  readonly causalExplanation?: string | null;
  readonly matchedDomainNames?: readonly string[];
  readonly adjudicationStatus?: 'ADJUDICATED' | 'UNADJUDICATED';
  readonly adjudicationFailureReason?: 'AI_TIMEOUT' | 'AI_EXECUTION_FAILED' | 'AI_VALIDATION_REJECTED' | 'AI_UNAVAILABLE' | 'AI_ABORTED' | 'AI_MISSING_VERDICT' | null;
};

/**
 * Canonical evidence boundary.
 *
 * Semantic ownership belongs to Community AI. This utility deliberately does
 * not classify prose with keyword lists, regexes, domain dictionaries, or
 * token-overlap heuristics. It only enforces transport/provenance invariants:
 * - missing AI verdicts never become trusted evidence,
 * - documentary sources cannot masquerade as first-party DIRECT evidence,
 * - promotional/context verdicts cannot become trusted rows,
 * - a trusted row needs an AI-owned observed-problem family and alignment,
 * - retrieval provenance can identify which selected-domain/facet lane produced
 *   a row, but provenance alone never creates semantic trust.
 */
export class CanonicalEvidenceVerificationUtil {
  static buildDeterministicFallbackProposal(input: {
    readonly raw: IdeaGenerationRawEvidenceItem;
    readonly requestMode: IdeaGenerationRequestMode;
    readonly origin: IdeaGenerationCanonicalEvidenceItem['origin'];
  }): CanonicalEvidenceProposal {
    void input.raw;
    void input.requestMode;
    return {
      classification: 'UNADJUDICATED',
      confidence: 0,
      problemFamily: null,
      verifiedByDeterministicGuard: false,
      origin: input.origin,
      evidenceNature: 'OTHER',
      domainAlignment: 'NONE',
      problemAlignment: 'NONE',
      familyBasis: 'NONE',
      observedProblem: null,
      causalExplanation: null,
      matchedDomainNames: [],
      adjudicationStatus: 'UNADJUDICATED',
      adjudicationFailureReason: 'AI_UNAVAILABLE',
    };
  }

  static verify(input: {
    readonly raw: IdeaGenerationRawEvidenceItem;
    readonly proposal: CanonicalEvidenceProposal;
    readonly requestMode: IdeaGenerationRequestMode;
    readonly problemSpec: IdeaGenerationCanonicalProblemSpec | null;
    readonly selectedDomains: readonly SelectedGenerationDomain[];
  }): IdeaGenerationCanonicalEvidenceItem {
    const { raw, proposal } = input;
    const evidenceNature = proposal.evidenceNature ?? 'OTHER';
    const domainAlignment = proposal.domainAlignment ?? 'NONE';
    const problemAlignment = proposal.problemAlignment ?? 'NONE';
    const familyBasis = proposal.familyBasis ?? 'NONE';
    const observedProblem = this.cleanOptional(proposal.observedProblem, 260);
    const causalExplanation = this.cleanOptional(proposal.causalExplanation, 260);
    const problemFamily = this.cleanOptional(proposal.problemFamily, 120);
    const matchedDomainNames = this.resolveAiMatchedDomainNames(
      proposal.matchedDomainNames ?? [],
      input.selectedDomains,
    );

    let classification = proposal.classification;

    // Source provenance is structural, not semantic. News/research/blog reports
    // may strongly support a problem, but they are not a first-party DIRECT row.
    if (classification === 'DIRECT_PROBLEM' && this.isDocumentarySource(raw.sourceKey)) {
      classification = 'SUPPORTING_SIGNAL';
    }
    if (
      evidenceNature === 'PROMOTIONAL' ||
      evidenceNature === 'NEUTRAL_CONTEXT'
    ) {
      classification = classification === 'UNRELATED' ? 'UNRELATED' : 'CONTEXT_ONLY';
    }
    if (evidenceNature === 'MARKET_RESEARCH' && classification === 'DIRECT_PROBLEM') {
      classification = 'SUPPORTING_SIGNAL';
    }
    if (classification === 'DIRECT_PROBLEM' && evidenceNature !== 'LIVED_EXPERIENCE') {
      classification = 'SUPPORTING_SIGNAL';
    }

    const discoveryMode =
      input.requestMode === 'DOMAINS_ONLY' || input.requestMode === 'NO_INPUT';
    const requiredAlignment = discoveryMode ? domainAlignment : problemAlignment;
    const trustedCandidate =
      classification === 'DIRECT_PROBLEM' || classification === 'SUPPORTING_SIGNAL';
    const semanticallyComplete =
      proposal.confidence >= 58 &&
      proposal.verifiedByDeterministicGuard &&
      familyBasis === 'OBSERVED_PROBLEM' &&
      Boolean(problemFamily) &&
      Boolean(observedProblem) &&
      requiredAlignment !== 'NONE' &&
      (!discoveryMode || matchedDomainNames.length > 0);

    if (trustedCandidate && !semanticallyComplete) {
      classification = requiredAlignment === 'NONE' ? 'UNRELATED' : 'CONTEXT_ONLY';
    } else if (
      classification === 'DIRECT_PROBLEM' &&
      requiredAlignment === 'PARTIAL'
    ) {
      classification = 'SUPPORTING_SIGNAL';
    }

    const verified =
      semanticallyComplete &&
      (classification === 'DIRECT_PROBLEM' || classification === 'SUPPORTING_SIGNAL');

    const matchedDomainIds = matchedDomainNames
      .map((name) => input.selectedDomains.find((domain) => domain.name === name)?.id)
      .filter((id): id is string => Boolean(id));
    const matchedFacetIds = this.resolveProvenanceFacetIds(
      raw,
      input.problemSpec,
      problemAlignment,
    );

    return {
      id: raw.id,
      sourceKey: raw.sourceKey,
      sourceType: raw.sourceType,
      text: raw.text,
      title: raw.title,
      classification,
      confidence: Math.max(0, Math.min(100, proposal.confidence)),
      problemFamily: verified ? problemFamily : null,
      evidenceKind: this.resolveEvidenceKind(raw, evidenceNature),
      evidenceNature,
      domainAlignment,
      problemAlignment,
      familyBasis,
      observedProblem,
      causalExplanation,
      matchedDomainNames,
      verified,
      adjudicationStatus:
        proposal.adjudicationStatus ??
        (proposal.classification === 'UNADJUDICATED' ? 'UNADJUDICATED' : 'ADJUDICATED'),
      adjudicationFailureReason: proposal.adjudicationFailureReason ?? null,
      origin: proposal.origin,
      matchedDomainIds,
      matchedFacetIds,
      discoveryDomainId: raw.discoveryDomainId ?? null,
      discoveryDomainName: raw.discoveryDomainName ?? null,
      discoveryDomainIds: raw.discoveryDomainIds ?? [],
      discoveryDomainNames: raw.discoveryDomainNames ?? [],
      queryIntentId: raw.queryIntentId ?? null,
      queryText: raw.queryText ?? null,
      collectionPhase: raw.collectionPhase ?? 'INITIAL',
      sourceTier: raw.sourceTier ?? 'MICRO_PROBE',
    };
  }

  /**
   * Deprecated compatibility hook. Semantic family entailment is no longer a
   * deterministic responsibility. New code must validate family identity from
   * the AI verdict (familyBasis + exact normalized family on selected rows).
   */
  static stronglyEntailsProblemFamily(
    _evidenceText: string,
    _family: string,
  ): boolean {
    return false;
  }

  private static resolveAiMatchedDomainNames(
    values: readonly string[],
    selectedDomains: readonly SelectedGenerationDomain[],
  ): string[] {
    const authoritative = new Map(
      selectedDomains.map((domain) => [
        domain.name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
        domain.name,
      ] as const),
    );
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const key = value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
      const canonical = authoritative.get(key);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      out.push(canonical);
    }
    return out;
  }

  private static resolveProvenanceFacetIds(
    raw: IdeaGenerationRawEvidenceItem,
    spec: IdeaGenerationCanonicalProblemSpec | null,
    alignment: CommunityAiSemanticAlignment,
  ): string[] {
    if (alignment === 'NONE' || !spec) return [];
    const valid = new Set(spec.facets.map((facet) => facet.id));
    return (raw.problemFacetIds ?? []).filter((id) => valid.has(id));
  }

  private static resolveEvidenceKind(
    raw: IdeaGenerationRawEvidenceItem,
    nature: CommunityAiEvidenceNature,
  ): IdeaGenerationCanonicalEvidenceItem['evidenceKind'] {
    const source = raw.sourceKey.trim().toLocaleLowerCase();
    if (source === 'crossref') return 'ACADEMIC_TECHNICAL_SIGNAL';
    if (source === 'news' || source === 'gdelt') return 'NEWS_REPORT';
    if (source === 'product-hunt') return 'MARKET_REPORT';
    if (nature === 'LIVED_EXPERIENCE') return 'USER_COMPLAINT';
    if (nature === 'DOCUMENTED_FINDING') return 'OPERATIONAL_INCIDENT';
    if (nature === 'MARKET_RESEARCH') return 'COMMUNITY_DISCUSSION';
    if (raw.sourceType === 'COMMENT') return 'COMMUNITY_DISCUSSION';
    return 'UNKNOWN';
  }

  private static isDocumentarySource(sourceKey: string): boolean {
    return ['crossref', 'news', 'gdelt', 'blog'].includes(
      sourceKey.trim().toLocaleLowerCase(),
    );
  }

  private static cleanOptional(
    value: string | null | undefined,
    maxLength: number,
  ): string | null {
    const cleaned = value
      ?.normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maxLength) ?? '';
    return cleaned || null;
  }
}
