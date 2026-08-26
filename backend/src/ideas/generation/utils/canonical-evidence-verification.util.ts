import {
  classifyDirectCommunityEvidence,
} from '../../../nlp/common/utils/community-evidence.util';
import { resolvePrimaryProblemFamily } from '../../../nlp/common/utils/problem-family-matching.util';
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
        // Text paths have an immutable requester problem. A same-workflow item
        // from a different actor/object (for example architectural restoration
        // evidence for a decorative-mask request) is useful design context, but
        // it must not validate demand for the requester market.
        const explicitDomainAligned =
          input.requestMode !== 'TEXT_AND_DOMAINS' || matchedDomainIds.length > 0;
        const requesterIdentityAligned = this.matchesRequesterIdentity(
          raw.text,
          input.problemSpec,
        );
        const workflowFacetAligned = matchedFacetIds.length > 0;
        const proposalVerified =
          proposal.verifiedByDeterministicGuard && explicitDomainAligned;

        if (proposalVerified && requesterIdentityAligned) {
          verified = true;
        } else if (proposalVerified && workflowFacetAligned) {
          classification = 'ANALOGOUS_WORKFLOW_SIGNAL';
          verified = false;
        } else {
          verified = false;
          if (input.requestMode === 'TEXT_AND_DOMAINS') {
            classification = matchedDomainIds.length > 0 ? 'CONTEXT_ONLY' : 'UNRELATED';
          } else if (classification === 'DIRECT_PROBLEM' || classification === 'SUPPORTING_SIGNAL') {
            classification = workflowFacetAligned ? 'ANALOGOUS_WORKFLOW_SIGNAL' : 'CONTEXT_ONLY';
          }
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
      problemFamily: this.resolveCanonicalProblemFamily(
        raw.text,
        proposal.problemFamily,
        input.requestMode,
      ),
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


  private static matchesRequesterIdentity(
    text: string,
    spec: IdeaGenerationCanonicalProblemSpec | null,
  ): boolean {
    if (!spec) return false;
    const normalizedText = this.normalize(text);
    const textTokens = new Set(
      normalizedText
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 4)
        .filter((token) => !this.IDENTITY_STOPWORDS.has(token)),
    );
    const identities = [
      spec.actor,
      ...spec.actorAliases,
      spec.object,
      ...spec.objectAliases,
    ].filter((value): value is string => Boolean(value?.trim()));

    for (const identity of identities) {
      const normalizedIdentity = this.normalize(identity);
      if (normalizedIdentity.length >= 5 && normalizedText.includes(normalizedIdentity)) {
        return true;
      }
      const tokens = normalizedIdentity
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 4)
        .filter((token) => !this.IDENTITY_STOPWORDS.has(token));
      if (tokens.length === 0) continue;
      const overlap = tokens.filter((token) => textTokens.has(token)).length;
      const minimum = tokens.length <= 2 ? 1 : 2;
      if (overlap >= minimum && overlap / tokens.length >= 0.4) return true;
    }
    return false;
  }

  private static readonly IDENTITY_STOPWORDS = new Set([
    'independent',
    'specialists',
    'specialist',
    'operators',
    'operator',
    'authorities',
    'authority',
    'management',
    'workflow',
    'records',
    'record',
    'system',
    'systems',
    'information',
    'service',
    'services',
    'project',
    'projects',
  ]);

  private static resolveCanonicalProblemFamily(
    evidenceText: string,
    proposedFamily: string | null,
    requestMode: IdeaGenerationRequestMode,
  ): string | null {
    const normalizedProposal = proposedFamily?.replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim() ?? '';

    // Text-bearing paths already have an immutable requester problem. The
    // family is descriptive metadata only, so preserve the provider label when
    // present and let requester facets remain authoritative downstream.
    if (requestMode === 'TEXT_ONLY' || requestMode === 'TEXT_AND_DOMAINS') {
      return normalizedProposal || null;
    }

    if (
      normalizedProposal &&
      this.problemFamilyIsEntailedByEvidence(evidenceText, normalizedProposal)
    ) {
      return normalizedProposal;
    }

    const deterministicFamily = resolvePrimaryProblemFamily(evidenceText);
    if (
      deterministicFamily &&
      !deterministicFamily.key.startsWith('lexical:') &&
      this.problemFamilyIsEntailedByEvidence(
        evidenceText,
        deterministicFamily.label,
      )
    ) {
      return deterministicFamily.label;
    }

    return this.buildEvidenceLocalProblemFamily(evidenceText);
  }

  private static problemFamilyIsEntailedByEvidence(
    evidenceText: string,
    family: string,
  ): boolean {
    const evidenceTokens = new Set(
      this.normalize(evidenceText)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 4)
        .filter((token) => !this.FAMILY_STOPWORDS.has(token)),
    );
    const familyTokens = this.normalize(family)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4)
      .filter((token) => !this.FAMILY_STOPWORDS.has(token));

    if (familyTokens.length === 0) return false;
    const overlap = familyTokens.filter((token) => evidenceTokens.has(token)).length;
    const required = familyTokens.length <= 2 ? 1 : 2;
    return overlap >= required && overlap / familyTokens.length >= 0.4;
  }

  private static buildEvidenceLocalProblemFamily(evidenceText: string): string | null {
    const normalized = this.normalize(evidenceText);
    const patterns: readonly { readonly when: RegExp; readonly label: string }[] = [
      {
        when: /\b(?:container|docker)\b[^.!?]{0,220}\b(?:network|socket|tcp|bridge|host)\b|\b(?:network|socket|tcp|bridge|host)\b[^.!?]{0,220}\b(?:container|docker)\b/iu,
        label: 'Container Network Connectivity and Isolation Constraints',
      },
      {
        when: /\b(?:equipment|machine|device|sensor|refrigerator|freezer|oven|ventilation)\b[^.!?]{0,220}\b(?:failure|fault|maintenance|downtime|alert|temperature)\b/iu,
        label: 'Equipment Failure Detection and Maintenance Prioritization',
      },
      {
        when: /\b(?:complaint|inspection|maintenance|repair)\b[^.!?]{0,220}\b(?:building|property|housing|facility)\b|\b(?:building|property|housing|facility)\b[^.!?]{0,220}\b(?:complaint|inspection|maintenance|repair)\b/iu,
        label: 'Property Maintenance Triage and Repair Prioritization',
      },
    ];
    const matched = patterns.find((entry) => entry.when.test(normalized));
    if (matched) return matched.label;

    const tokens = normalized
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4)
      .filter((token) => !this.FAMILY_STOPWORDS.has(token));
    const unique: string[] = [];
    for (const token of tokens) {
      if (unique.includes(token)) continue;
      unique.push(token);
      if (unique.length >= 4) break;
    }
    if (unique.length < 2) return null;
    return `${unique.map((token) => token.charAt(0).toLocaleUpperCase() + token.slice(1)).join(' ')} Workflow Friction`;
  }

  private static readonly FAMILY_STOPWORDS = new Set([
    'artificial','intelligence','cybersecurity','security','problem','problems',
    'issue','issues','failure','failures','workflow','workflows','operational',
    'system','systems','software','platform','service','services','user','users',
    'using','trying','working','application','project','because','another','their',
    'there','these','those','would','could','should','about','after','before',
  ]);

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
