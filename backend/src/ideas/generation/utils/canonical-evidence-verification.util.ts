import {
  classifyDirectCommunityEvidence,
} from '../../../nlp/common/utils/community-evidence.util';
import type {
  IdeaGenerationCanonicalEvidenceItem,
  IdeaGenerationRawEvidenceItem,
  SelectedGenerationDomain,
} from '../types/idea-generation-context.type';
import type {
  IdeaGenerationCanonicalProblemSpec,
  IdeaGenerationRequestMode,
} from '../types/canonical-problem-spec.type';

export type CanonicalEvidenceProposal = {
  readonly classification: IdeaGenerationCanonicalEvidenceItem['classification'];
  readonly confidence: number;
  readonly problemFamily: string | null;
  readonly verifiedByDeterministicGuard: boolean;
  readonly origin: IdeaGenerationCanonicalEvidenceItem['origin'];
};

export class CanonicalEvidenceVerificationUtil {
  static verify(input: {
    readonly raw: IdeaGenerationRawEvidenceItem;
    readonly proposal: CanonicalEvidenceProposal;
    readonly requestMode: IdeaGenerationRequestMode;
    readonly problemSpec: IdeaGenerationCanonicalProblemSpec | null;
    readonly selectedDomains: readonly SelectedGenerationDomain[];
  }): IdeaGenerationCanonicalEvidenceItem {
    const { raw, proposal } = input;
    let classification = proposal.classification;
    let verified = proposal.verifiedByDeterministicGuard;
    const matchedDomainIds = this.resolveMatchedDomainIds(
      raw,
      input.selectedDomains,
      input.requestMode,
    );
    const matchedFacetIds = this.resolveMatchedFacetIds(raw.text, input.problemSpec);

    if (classification === 'DIRECT_PROBLEM' || classification === 'SUPPORTING_SIGNAL') {
      if (input.requestMode === 'DOMAINS_ONLY' || input.requestMode === 'NO_INPUT') {
        const domainBound = Boolean(raw.discoveryDomainId || raw.discoveryDomainName);
        const domainAligned = matchedDomainIds.length > 0;
        const problemBearing = this.looksProblemBearing(raw.text);
        const directKind = classifyDirectCommunityEvidence(raw.text, raw.sourceType);
        const directHumanSignal =
          directKind === 'USER_COMPLAINT' ||
          directKind === 'FEATURE_REQUEST' ||
          directKind === 'OBSERVED_UNMET_NEED';

        if (!domainBound || !domainAligned || !problemBearing) {
          classification = domainAligned ? 'CONTEXT_ONLY' : 'UNRELATED';
          verified = false;
        } else if (classification === 'DIRECT_PROBLEM' && !directHumanSignal) {
          // A technical ticket/question may support a domain pain, but discovery
          // mode must not promote it to DIRECT merely because it was retrieved
          // while probing that domain.
          classification = proposal.verifiedByDeterministicGuard
            ? 'SUPPORTING_SIGNAL'
            : 'CONTEXT_ONLY';
          verified = classification === 'SUPPORTING_SIGNAL';
        } else {
          verified = proposal.verifiedByDeterministicGuard || directHumanSignal;
        }
      } else {
        // Text paths already have an immutable requester problem. The Community
        // AI post-verifier remains authoritative, but explicit-domain requests
        // must also match at least one selected domain. Retrieval provenance is
        // not enough: the evidence text itself must establish that alignment.
        const explicitDomainAligned =
          input.requestMode !== 'TEXT_AND_DOMAINS' || matchedDomainIds.length > 0;
        verified = proposal.verifiedByDeterministicGuard && explicitDomainAligned;
        if (!verified && input.requestMode === 'TEXT_AND_DOMAINS') {
          classification = matchedDomainIds.length > 0 ? 'CONTEXT_ONLY' : 'UNRELATED';
        }
      }
    } else {
      verified = false;
    }

    return {
      id: raw.id,
      sourceKey: raw.sourceKey,
      sourceType: raw.sourceType,
      text: raw.text,
      title: raw.title,
      classification,
      confidence: Math.max(0, Math.min(100, proposal.confidence)),
      problemFamily: proposal.problemFamily,
      verified,
      origin: proposal.origin,
      matchedDomainIds,
      matchedFacetIds,
      discoveryDomainId: raw.discoveryDomainId ?? null,
      discoveryDomainName: raw.discoveryDomainName ?? null,
      queryIntentId: raw.queryIntentId ?? null,
      queryText: raw.queryText ?? null,
      collectionPhase: raw.collectionPhase ?? 'INITIAL',
      sourceTier: raw.sourceTier ?? 'MICRO_PROBE',
    };
  }

  private static resolveMatchedDomainIds(
    raw: IdeaGenerationRawEvidenceItem,
    domains: readonly SelectedGenerationDomain[],
    requestMode: IdeaGenerationRequestMode,
  ): string[] {
    const text = this.normalize(raw.text);
    const bound = raw.discoveryDomainId
      ? domains.find((domain) => domain.id === raw.discoveryDomainId)
      : raw.discoveryDomainName
        ? domains.find(
            (domain) =>
              domain.name.trim().toLocaleLowerCase() ===
              raw.discoveryDomainName?.trim().toLocaleLowerCase(),
          )
        : undefined;
    /*
     * Retrieval provenance explains where the item was found; it is not a
     * claim-domain lock. Text-bearing requests may legitimately be supported
     * by any explicitly selected domain as long as the evidence also matches
     * the immutable requester workflow. Discovery-only paths remain bound to
     * their independent probe lane to prevent cross-domain false positives.
     */
    const candidates =
      requestMode === 'TEXT_AND_DOMAINS' || requestMode === 'TEXT_ONLY'
        ? domains
        : bound
          ? [bound]
          : domains;

    return candidates
      .filter((domain) => this.domainMatchesText(domain, text))
      .map((domain) => domain.id);
  }

  private static domainMatchesText(
    domain: SelectedGenerationDomain,
    normalizedText: string,
  ): boolean {
    const phrases = [
      domain.name,
      ...(domain.effectiveSearchKeywords ?? []),
      ...(domain.keywords ?? []),
      ...(domain.configuredKeywords ?? []),
    ]
      .map((value) => this.normalize(value))
      .filter(Boolean)
      .slice(0, 30);

    if (phrases.some((phrase) => phrase.length >= 5 && normalizedText.includes(phrase))) {
      return true;
    }

    const meaningfulTokens = new Set(
      phrases
        .flatMap((phrase) => phrase.split(/[^\p{L}\p{N}]+/u))
        .filter((token) => token.length >= 4)
        .filter((token) => !['platform','system','software','application','dashboard','management'].includes(token)),
    );
    const hits = [...meaningfulTokens].filter((token) => normalizedText.includes(token));
    if (hits.length >= 2) return true;

    const acronym = domain.name
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2 && !['and','the','for','of'].includes(token.toLocaleLowerCase()))
      .map((token) => token[0])
      .join('')
      .toLocaleLowerCase();
    return acronym.length >= 2 && new RegExp(`\\b${acronym}\\b`, 'iu').test(normalizedText);
  }

  private static resolveMatchedFacetIds(
    text: string,
    spec: IdeaGenerationCanonicalProblemSpec | null,
  ): string[] {
    if (!spec?.facets.length) return [];
    const normalized = this.normalize(text);
    const textTokens = new Set(
      normalized.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 4),
    );
    return spec.facets
      .filter((facet) => {
        const facetTokens = this.normalize(facet.statement)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((token) => token.length >= 4);
        if (facetTokens.length === 0) return false;
        const overlap = facetTokens.filter((token) => textTokens.has(token)).length;
        return overlap >= Math.min(2, facetTokens.length);
      })
      .map((facet) => facet.id);
  }

  private static looksProblemBearing(value: string): boolean {
    return /\b(?:problem|issue|bug|error|fail(?:ed|ure|ing|s)?|cannot|can't|unable|missing|wrong|inaccurate|delay(?:ed|s)?|slow|rework|repeat(?:ed)?|waste|refund|confusion|blocked|unavailable|security|unauthori[sz]ed|breach|risk|friction|difficult|struggle|need|wish|should|feature request)\b/iu.test(
      value,
    );
  }

  private static normalize(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
  }
}
