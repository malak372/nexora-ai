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
import { RequestNicheCustomCraftUtil } from './request-niche-custom-craft.util';

export type CanonicalEvidenceProposal = {
  readonly classification: IdeaGenerationCanonicalEvidenceItem['classification'];
  readonly confidence: number;
  readonly problemFamily: string | null;
  readonly verifiedByDeterministicGuard: boolean;
  readonly origin: IdeaGenerationCanonicalEvidenceItem['origin'];
};

export class CanonicalEvidenceVerificationUtil {
  /**
   * Produces a conservative deterministic proposal for a raw item that was
   * not classified by the online Community AI response (timeout, partial
   * response, schema omission, or recovery-only item).  Every raw evidence
   * item therefore receives a canonical row and can never disappear merely
   * because an AI batch was incomplete.  The returned proposal still passes
   * through verify(), so this improves evidence retention without lowering
   * the trusted-evidence admission bar.
   */
  static buildDeterministicFallbackProposal(input: {
    readonly raw: IdeaGenerationRawEvidenceItem;
    readonly requestMode: IdeaGenerationRequestMode;
    readonly origin: IdeaGenerationCanonicalEvidenceItem['origin'];
  }): CanonicalEvidenceProposal {
    const directKind = classifyDirectCommunityEvidence(
      input.raw.text,
      input.raw.sourceType,
    );
    const directHumanSignal =
      directKind === 'USER_COMPLAINT' ||
      directKind === 'FEATURE_REQUEST' ||
      directKind === 'OBSERVED_UNMET_NEED';
    const problemBearing = this.looksProblemBearing(input.raw.text);
    const classification: IdeaGenerationCanonicalEvidenceItem['classification'] =
      directHumanSignal
        ? 'DIRECT_PROBLEM'
        : problemBearing
          ? 'SUPPORTING_SIGNAL'
          : 'CONTEXT_ONLY';

    return {
      classification,
      confidence: directHumanSignal ? 70 : problemBearing ? 58 : 35,
      problemFamily: resolvePrimaryProblemFamily(input.raw.text)?.label ?? null,
      verifiedByDeterministicGuard: directHumanSignal || problemBearing,
      origin: input.origin,
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
        const boundDomain = this.resolveBoundDiscoveryDomain(raw, input.selectedDomains);
        const discoveryDomainName =
          boundDomain?.name ?? raw.discoveryDomainName ?? '';
        const weakDeveloperTechnicalNoise = this.isWeakDeveloperTechnicalDiscoveryNoise(
          raw,
          discoveryDomainName,
        );
        const weakEditorialDiscoveryNoise =
          this.isWeakGenericEditorialDiscoveryNoise(raw, discoveryDomainName);
        const digestOrRoundupNoise = this.isDiscoveryDigestOrRoundupNoise(raw);
        const directKind = classifyDirectCommunityEvidence(raw.text, raw.sourceType);
        const directHumanSignal =
          directKind === 'USER_COMPLAINT' ||
          directKind === 'FEATURE_REQUEST' ||
          directKind === 'OBSERVED_UNMET_NEED';

        if (!domainBound || !domainAligned || !problemBearing) {
          classification = domainAligned ? 'CONTEXT_ONLY' : 'UNRELATED';
          verified = false;
        } else if (
          weakDeveloperTechnicalNoise ||
          (weakEditorialDiscoveryNoise && !directHumanSignal) ||
          (digestOrRoundupNoise && !directHumanSignal)
        ) {
          // Query provenance is not evidence.  Generic programming/debugging
          // questions retrieved from an AI/Cybersecurity discovery lane must
          // not become trusted market/problem signals merely because the query
          // contained the selected domain name.  Keep them visible as context
          // for terminology, but exclude them from trusted counts/family lock.
          classification = 'CONTEXT_ONLY';
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
        const requesterDirectIdentityAligned = this.matchesRequesterDirectIdentity(
          raw.text,
          input.problemSpec,
          matchedFacetIds.length > 0,
        );
        const workflowFacetAligned = matchedFacetIds.length > 0;
        const requesterSupportingFacetAligned = this.matchesRequesterSupportingFacet(
          raw.text,
          input.problemSpec,
        );
        const proposalVerified =
          proposal.verifiedByDeterministicGuard && explicitDomainAligned;
        const nicheCraftRequest = RequestNicheCustomCraftUtil.resolve(
          this.describeProblemSpec(input.problemSpec),
        );
        const nicheDirect = nicheCraftRequest
          ? RequestNicheCustomCraftUtil.isDirectEvidence(
              this.describeProblemSpec(input.problemSpec),
              raw.text,
            )
          : null;
        const nicheSupporting = nicheCraftRequest
          ? RequestNicheCustomCraftUtil.isSupportingEvidence(
              this.describeProblemSpec(input.problemSpec),
              raw.text,
            )
          : null;

        if (
          proposalVerified &&
          classification === 'DIRECT_PROBLEM' &&
          requesterDirectIdentityAligned &&
          (nicheDirect ?? true)
        ) {
          verified = true;
        } else if (
          proposalVerified &&
          classification === 'SUPPORTING_SIGNAL' &&
          requesterSupportingFacetAligned &&
          (nicheSupporting ?? true)
        ) {
          // SUPPORTING_SIGNAL may validate one or more atomic requester facets
          // without restating the full actor/object/workflow causal chain.
          // For custom-commission niches, however, material/craft overlap alone
          // is not enough: the evidence must still contain a customer/commission
          // specification workflow contract.
          verified = true;
        } else if (
          proposalVerified &&
          requesterSupportingFacetAligned &&
          classification === 'DIRECT_PROBLEM' &&
          (nicheSupporting ?? true)
        ) {
          // The evidence is clearly requester-owned but not complete enough for
          // DIRECT. Preserve it as SUPPORTING instead of throwing it away.
          classification = 'SUPPORTING_SIGNAL';
          verified = true;
        } else if (proposalVerified && (workflowFacetAligned || Boolean(nicheCraftRequest))) {
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

    if (
      input.requestMode !== 'DOMAINS_ONLY' &&
      input.requestMode !== 'NO_INPUT' &&
      !verified &&
      (classification === 'CONTEXT_ONLY' || classification === 'UNRELATED')
    ) {
      const requestDescription = this.describeProblemSpec(input.problemSpec);
      if (this.matchesHealthcareEquipmentSupportingEvidence(requestDescription, raw.text)) {
        classification = 'SUPPORTING_SIGNAL';
        verified = true;
      } else if (
        this.matchesHealthcareInventoryAnalogousEvidence(requestDescription, raw.text)
      ) {
        classification = 'ANALOGOUS_WORKFLOW_SIGNAL';
        verified = false;
      } else {
        /*
         * Generic high-bar rescue for text requests. Community AI can be
         * conservative and label an actor/workflow-matched secondary report as
         * CONTEXT_ONLY even when the body explicitly states the requester pain.
         * Promote only when deterministic request identity + problem facets +
         * concrete pain all agree. Query provenance alone is never enough.
         * Existing niche contracts remain authoritative, so adjacent craft or
         * restoration evidence cannot be upgraded merely because it shares
         * materials or generic rework language.
         */
        const explicitDomainAligned =
          input.requestMode !== 'TEXT_AND_DOMAINS' || matchedDomainIds.length > 0;
        const nicheRequest = RequestNicheCustomCraftUtil.resolve(requestDescription);
        const nicheSupportingAligned = nicheRequest
          ? RequestNicheCustomCraftUtil.isSupportingEvidence(
              requestDescription,
              raw.text,
            )
          : true;
        if (
          explicitDomainAligned &&
          nicheSupportingAligned &&
          this.matchesStrongRequesterSupportingEvidence(
            raw.text,
            input.problemSpec,
            matchedFacetIds,
          )
        ) {
          classification = 'SUPPORTING_SIGNAL';
          verified = true;
        }
      }
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


  private static matchesHealthcareEquipmentSupportingEvidence(
    requestDescription: string,
    evidenceText: string,
  ): boolean {
    const request = this.normalize(requestDescription);
    const evidence = this.normalize(evidenceText);
    if (
      !/\b(?:healthcare|hospital|clinic|public health|health system)\b/u.test(request) ||
      !/\b(?:medical equipment|medical device|clinical equipment|biomedical equipment)\b/u.test(request)
    ) {
      return false;
    }

    const healthcareActor =
      /\b(?:hospital|hospitals|healthcare|health system|health systems|clinic|clinics|biomedical engineer|biomedical engineering)\b/u.test(evidence);
    const equipmentObject =
      /\b(?:medical equipment|medical device|medical devices|clinical equipment|biomedical equipment|patient monitor|infusion pump|ventilator|defibrillator|diagnostic equipment)\b/u.test(evidence);
    const operationalPain =
      /\b(?:maintenance|maintenance backlog|downtime|unavailable|availability|utilization|utilisation|unable to locate|location tracking|asset tracking|inventory shortage|equipment shortage|repair delay|service delay|fault alert|failure|redistribution|underused|overused)\b/u.test(evidence);

    return healthcareActor && equipmentObject && operationalPain;
  }

  private static matchesHealthcareInventoryAnalogousEvidence(
    requestDescription: string,
    evidenceText: string,
  ): boolean {
    const request = this.normalize(requestDescription);
    const evidence = this.normalize(evidenceText);
    if (
      !/\b(?:healthcare|hospital|clinic|public health|health system)\b/u.test(request) ||
      !/\b(?:medical equipment|medical device|clinical equipment|biomedical equipment)\b/u.test(request)
    ) {
      return false;
    }

    const healthcareActor =
      /\b(?:hospital|hospitals|healthcare|health system|health systems|clinic|clinics)\b/u.test(evidence);
    const inventoryWorkflow =
      /\b(?:inventory|point of use|supply chain|cycle count|cycle counts|scan items|scanning|asset tracking|availability|stock levels|location tracking|real time tracking)\b/u.test(evidence);
    const friction =
      /\b(?:nightmare|incorrect|inaccurate|missing|unavailable|shortage|waste|delay|delayed|not scan|never scan|cannot locate|hard to locate|rework|fix counts|count discrepancy)\b/u.test(evidence);

    return healthcareActor && inventoryWorkflow && friction;
  }

  private static describeProblemSpec(
    spec: IdeaGenerationCanonicalProblemSpec | null,
  ): string {
    if (!spec) return '';
    return [
      spec.actor ?? '',
      ...spec.actorAliases,
      spec.object ?? '',
      ...spec.objectAliases,
      spec.workflow ?? '',
      spec.friction ?? '',
      ...spec.failureModes,
      ...spec.consequences,
      ...spec.facets.map((facet) => facet.statement),
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static matchesRequesterDirectIdentity(
    text: string,
    spec: IdeaGenerationCanonicalProblemSpec | null,
    hasMatchedProblemFacet: boolean,
  ): boolean {
    if (!spec || !hasMatchedProblemFacet) return false;
    const actorValues = [spec.actor, ...spec.actorAliases].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const objectValues = [spec.object, ...spec.objectAliases].filter(
      (value): value is string => Boolean(value?.trim()),
    );

    // Direct evidence must carry the requester actor when one is known. A
    // paper that proves only "wasted energy" or "maintenance prioritization"
    // remains valuable SUPPORTING evidence, but it cannot become DIRECT merely
    // because it shares a broad object token such as energy/equipment.
    const actorAligned =
      actorValues.length === 0 || this.matchesIdentityAxis(text, actorValues, 0.5);
    const objectAligned =
      objectValues.length === 0 || this.matchesIdentityAxis(text, objectValues, 0.4);
    return actorAligned && objectAligned;
  }

  private static matchesIdentityAxis(
    text: string,
    values: readonly string[],
    minimumRatio: number,
  ): boolean {
    const normalizedText = this.normalize(text);
    const textTokens = this.semanticTokenSet(text, this.IDENTITY_STOPWORDS);
    return values.some((value) => {
      const normalizedValue = this.normalize(value);
      if (normalizedValue.length >= 5 && normalizedText.includes(normalizedValue)) {
        return true;
      }
      const tokens = [...this.semanticTokenSet(value, this.IDENTITY_STOPWORDS)];
      if (tokens.length === 0) return false;
      const overlap = tokens.filter((token) => textTokens.has(token)).length;
      return overlap >= Math.min(2, tokens.length) && overlap / tokens.length >= minimumRatio;
    });
  }

  private static matchesRequesterSupportingFacet(
    text: string,
    spec: IdeaGenerationCanonicalProblemSpec | null,
  ): boolean {
    if (!spec || !this.looksProblemBearing(text)) return false;

    const evidenceTokens = this.semanticTokenSet(text, this.SUPPORTING_STOPWORDS);
    if (evidenceTokens.size === 0) return false;

    const phraseAligned = (
      value: string | null | undefined,
      minimumRatio = 0.45,
    ): boolean => {
      if (!value?.trim()) return false;
      const tokens = [...this.semanticTokenSet(value, this.SUPPORTING_STOPWORDS)];
      if (tokens.length === 0) return false;
      const overlap = tokens.filter((token) => evidenceTokens.has(token)).length;
      const minimum = Math.min(2, tokens.length);
      return overlap >= minimum && overlap / tokens.length >= minimumRatio;
    };

    const actorValues = [spec.actor, ...spec.actorAliases].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const objectValues = [spec.object, ...spec.objectAliases].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const actorAxisPresent = actorValues.length > 0;
    const objectAxisPresent = objectValues.length > 0;
    const actorAligned =
      actorAxisPresent && actorValues.some((value) => phraseAligned(value, 0.5));
    const objectAligned =
      objectAxisPresent && objectValues.some((value) => phraseAligned(value, 0.5));

    const workflowAligned = phraseAligned(spec.workflow, 0.4);
    const frictionAligned = [spec.friction, ...spec.failureModes].some((value) =>
      phraseAligned(value, 0.4),
    );
    const consequenceAligned = spec.consequences.some((value) =>
      phraseAligned(value, 0.45),
    );
    const matchedFacetCount = spec.facets.filter((facet) =>
      phraseAligned(facet.statement, 0.45),
    ).length;
    const workflowIdentityTokens = this.semanticTokenSet(
      `${spec.object ?? ''} ${spec.workflow ?? ''}`,
      this.SUPPORTING_STOPWORDS,
    );
    const workflowIdentityOverlap = [...workflowIdentityTokens].filter((token) =>
      evidenceTokens.has(token),
    ).length;
    const strongAtomicWorkflowSupport =
      matchedFacetCount > 0 && workflowIdentityOverlap >= 2;

    /*
     * SUPPORTING evidence must preserve requester identity and one concrete
     * operational pain/workflow axis.  Pure consequence overlap (for example
     * generic credit-card fraud => "financial losses") or material overlap
     * (for example a generic restoration article that merely lists leather) is
     * useful context, but it does not validate the requester-owned workflow.
     *
     * Requiring an actor/object identity anchor is deliberately generic: it
     * applies to every text request instead of adding one-off guards for each
     * test domain.  Morphological token normalization below keeps this strict
     * gate practical for plural/singular wording differences.
     */
    const identityAxisCount = Number(actorAxisPresent) + Number(objectAxisPresent);
    const hasIdentityAnchor =
      identityAxisCount === 0 || actorAligned || objectAligned;
    const allKnownIdentityAxesAligned =
      (!actorAxisPresent || actorAligned) && (!objectAxisPresent || objectAligned);
    const hasOperationalAnchor =
      workflowAligned || frictionAligned || consequenceAligned || matchedFacetCount > 0;
    const strongOperationalAnchor =
      workflowAligned || frictionAligned || matchedFacetCount > 0;

    if (!hasIdentityAnchor || !hasOperationalAnchor) return false;

    // When only part of the known requester identity is present in the
    // evidence, require a strong workflow/failure/facet anchor. A consequence
    // such as "financial loss" alone is never sufficient to bridge a missing
    // actor or object identity.
    if (!allKnownIdentityAxesAligned) {
      if (!strongOperationalAnchor) return false;
      // When both actor and object are known but only one appears in the
      // evidence, require both a workflow match and an atomic facet match.
      // This blocks broad same-domain material from validating a narrower
      // requester workflow while still allowing a secondary report that omits
      // one identity phrase but clearly describes the same operation/failure.
      if (
        identityAxisCount >= 2 &&
        !(workflowAligned && matchedFacetCount > 0) &&
        !strongAtomicWorkflowSupport
      ) {
        return false;
      }
    }

    return true;
  }

  private static matchesStrongRequesterSupportingEvidence(
    text: string,
    spec: IdeaGenerationCanonicalProblemSpec | null,
    matchedFacetIds: readonly string[],
  ): boolean {
    if (!spec || matchedFacetIds.length === 0 || !this.looksProblemBearing(text)) {
      return false;
    }
    if (!this.matchesRequesterSupportingFacet(text, spec)) return false;

    const fullIdentityAligned = this.matchesRequesterDirectIdentity(
      text,
      spec,
      true,
    );

    /*
     * A fully matched requester identity needs one atomic problem facet. If a
     * secondary source omits part of the actor/object wording, require two
     * independently matched facets before it can become SUPPORTING. This keeps
     * generic same-domain articles as Context while rescuing real reports that
     * describe the same operation/failure using different professional terms.
     */
    return fullIdentityAligned || matchedFacetIds.length >= 2;
  }

  private static readonly SUPPORTING_STOPWORDS = new Set([
    'independent',
    'specialists',
    'specialist',
    'operators',
    'operator',
    'management',
    'workflow',
    'workflows',
    'records',
    'record',
    'information',
    'system',
    'systems',
    'service',
    'services',
    'project',
    'projects',
    'problem',
    'problems',
    'issue',
    'issues',
    'often',
    'struggle',
    'struggles',
    'difficult',
  ]);

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

  private static isWeakGenericEditorialDiscoveryNoise(
    raw: IdeaGenerationRawEvidenceItem,
    discoveryDomainName: string,
  ): boolean {
    const source = raw.sourceKey.trim().toLocaleLowerCase();
    if (!['news', 'blog', 'reddit', 'forum'].includes(source)) return false;

    const text = this.normalize(`${raw.title ?? ''} ${raw.text}`);
    const editorialFraming =
      /\b(?:strateg(?:y|ies)|how to|guide|best practices?|tips?|framework|future of|lessons?|what is|why most|thought leadership|trends?|weekly roundup|news roundup|week in review|this week in|catch up on what happened|newsletter|digest|headlines?|outlook|forecast|prediction|vision|roadmap|will fail unless|must become|should become|needs? to become|why [^.!?]{0,80} must)\b/u.test(text);
    if (!editorialFraming) return false;

    // Editorial content can still support discovery when it documents a
    // concrete affected operator/facility failure rather than merely talking
    // about a domain. Domain/query provenance alone is never sufficient.
    const concreteOperationalFailure =
      /\b(?:production|deployed|deployment (?:failed|failure)|incident|outage|downtime|breach|data leak|service disruption|customer complaint|operator reported|operations team|hospital|school|government agency|lawsuit|legal liability|cost overrun|financial loss|delayed service|integration failure|model drift|hallucination|unauthorized access|account compromise|failed update|system failure|shipment delay|warehouse delay|carrier delay|order failure|fulfillment failure|equipment failure)\b/u.test(text);

    // Keep the argument for observability/future domain-specific extensions,
    // but do not let a generic domain name turn editorial material into pain.
    void discoveryDomainName;
    return !concreteOperationalFailure;
  }

  private static isDiscoveryDigestOrRoundupNoise(
    raw: IdeaGenerationRawEvidenceItem,
  ): boolean {
    const source = raw.sourceKey.trim().toLocaleLowerCase();
    if (!['news', 'blog', 'reddit', 'forum'].includes(source)) return false;
    const text = this.normalize(`${raw.title ?? ''} ${raw.text}`);
    const digestFraming =
      /\b(?:catch up on what happened(?: this week)?|this week in|weekly (?:news )?(?:roundup|brief|digest|update)|news roundup|week in review|weekly recap|top (?:\d+ )?\w+ news|newsletter|headlines of the week|break down the top .* news)\b/u.test(text);
    if (!digestFraming) return false;

    const firstPersonAffectedFailure =
      /\b(?:i|we|our|my|customer|operator|driver|dispatcher|warehouse worker|carrier|shipper|recipient)\b[^.!?]{0,180}\b(?:cannot|can't|unable|failed|failure|delay|delayed|waiting|lost|missing|wrong|broken|outage|downtime|error|problem|issue)\b/u.test(text);
    return !firstPersonAffectedFailure;
  }

  private static resolveCanonicalProblemFamily(
    evidenceText: string,
    proposedFamily: string | null,
    requestMode: IdeaGenerationRequestMode,
  ): string | null {
    const normalizedProposal = proposedFamily?.replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim() ?? '';

    // Text-bearing paths already have an immutable requester problem, so the
    // family is descriptive metadata only. Keep an evidence-native provider
    // label when it actually names a problem/failure. Generic request-facet
    // nouns such as "Maintenance Records" or "Leather Selections" are not
    // problem families and previously made downstream summaries misleading.
    if (requestMode === 'TEXT_ONLY' || requestMode === 'TEXT_AND_DOMAINS') {
      if (normalizedProposal && this.looksProblemFamilyBearing(normalizedProposal)) {
        return normalizedProposal;
      }
      return this.buildEvidenceLocalProblemFamily(evidenceText) || normalizedProposal || null;
    }

    const evidenceLocalFamily = this.buildEvidenceLocalProblemFamily(evidenceText);
    if (
      normalizedProposal.endsWith('Workflow Friction') &&
      evidenceLocalFamily &&
      !evidenceLocalFamily.endsWith(' Workflow Friction')
    ) {
      return evidenceLocalFamily;
    }

    if (
      normalizedProposal &&
      this.looksProblemFamilyBearing(normalizedProposal) &&
      this.problemFamilyIsEntailedByEvidence(evidenceText, normalizedProposal)
    ) {
      return normalizedProposal;
    }

    if (
      evidenceLocalFamily &&
      !evidenceLocalFamily.endsWith(' Workflow Friction') &&
      this.looksProblemFamilyBearing(evidenceLocalFamily)
    ) {
      return evidenceLocalFamily;
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

    return evidenceLocalFamily;
  }

  private static looksProblemFamilyBearing(value: string): boolean {
    const normalized = this.normalize(value);
    return /\b(?:fail|failure|failed|fault|flaw|error|mistake|wrong|incorrect|delay|delayed|backlog|bottleneck|downtime|outage|unavailable|shortage|loss|cost|waste|rework|redo|remake|mismatch|inconsisten|fragment|scattered|fatigue|overload|fraud|abuse|breach|unauthorized|risk|unsafe|harm|lack|lacked|lacking|insufficient|inadequate|disruption|inefficien|difficulty|difficult|challenge|problem|issue|alert|diagnos|prioriti[sz])\w*\b/iu.test(
      normalized,
    );
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
    // Discovery labels are identity-bearing metadata. For a one/two-token
    // family require every meaningful token to be evidenced; otherwise a label
    // such as "education learning" could be accepted from an item that only
    // says "machine learning". Longer labels require strong majority overlap.
    if (familyTokens.length <= 2) return overlap === familyTokens.length;
    const required = Math.max(2, Math.ceil(familyTokens.length * 0.6));
    return overlap >= required;
  }

  private static buildEvidenceLocalProblemFamily(evidenceText: string): string | null {
    const normalized = this.normalize(evidenceText);
    const patterns: readonly { readonly when: RegExp; readonly label: string }[] = [
      {
        when: /\b(?:outage|outages|disruption|disruptions|meltdown|service failure|major failure)\b[^.!?]{0,500}\b(?:liability|liabilities|accountability|legal incentive|penalt(?:y|ies)|vendor|software provider|software compan(?:y|ies)|crowdstrike|microsoft)\b|\b(?:liability|liabilities|accountability|legal incentive|penalt(?:y|ies)|vendor|software provider|software compan(?:y|ies)|crowdstrike|microsoft)\b[^.!?]{0,500}\b(?:outage|outages|disruption|disruptions|meltdown|service failure|major failure)\b/iu,
        label: 'Software Outage Liability and Vendor Accountability Gaps',
      },
      {
        when: /\b(?:container|docker)\b[^.!?]{0,220}\b(?:network|socket|tcp|bridge|host)\b|\b(?:network|socket|tcp|bridge|host)\b[^.!?]{0,220}\b(?:container|docker)\b/iu,
        label: 'Container Network Connectivity and Isolation Constraints',
      },
      {
        when: /\b(?:equipment|machine|device|sensor|refrigerator|freezer|oven|ventilation)\b[^.!?]{0,220}\b(?:failure|fault|maintenance|downtime|alert|temperature)\b/iu,
        label: 'Equipment Failure Detection and Maintenance Prioritization',
      },
      {
        when: /\b(?:warehouse|carrier|shipment|shipper|delivery|freight|dispatcher|logistics)\b[\s\S]{0,500}\b(?:waiting(?: for)? updates?|status updates?|confirmation(?: delay)?|handoff delay|coordination delay|communication delay|freight inefficien|shipment delay)\w*\b|\b(?:waiting(?: for)? updates?|status updates?|confirmation(?: delay)?|handoff delay|coordination delay|communication delay|freight inefficien|shipment delay)\w*\b[\s\S]{0,500}\b(?:warehouse|carrier|shipment|shipper|delivery|freight|dispatcher|logistics)\b/iu,
        label: 'Logistics Status Coordination Delays',
      },
      {
        when: /\b(?:complaint|inspection|maintenance|repair)\b[^.!?]{0,220}\b(?:building|property|housing|facility)\b|\b(?:building|property|housing|facility)\b[^.!?]{0,220}\b(?:complaint|inspection|maintenance|repair)\b/iu,
        label: 'Property Maintenance Triage and Repair Prioritization',
      },
    ];
    const matched = patterns.find((entry) => entry.when.test(normalized));
    if (matched) return matched.label;

    /*
     * Discovery fallback families must come from a concrete pain clause, never
     * from the first words of an article/title. The old token fallback turned
     * headlines such as "When Artificial Intelligence Becomes a Direct Threat
     * to Life" into "When Becomes Direct Threat Workflow Friction". Keep
     * trusted evidence visible, but return null unless a real failure clause can
     * be normalized into a professional problem identity.
     */
    const explicitFailure = this.extractExplicitFailureFamily(normalized);
    if (explicitFailure) return explicitFailure;

    const explicitChallenge = this.extractEvidenceChallengeFamily(normalized);
    if (explicitChallenge) return explicitChallenge;

    const clauses = normalized
      .split(/(?<=[.!?;])\s+|\s+[—–-]\s+/u)
      .map((value) => value.trim())
      .filter((value) => value.length >= 18)
      .filter((value) => this.looksProblemBearing(value))
      .filter(
        (value) =>
          !/\b(?:download|subscribe|tutorial|guide|available now|sponsored|weekly roundup|newsletter)\b/u.test(value),
      );
    const best = clauses
      .map((value) => ({
        value,
        score:
          (this.looksProblemBearing(value) ? 5 : 0) +
          (/\b(?:failure|error|delay|downtime|outage|shortage|waste|inefficien\w*|risk|unsafe|barrier|constraint|gap|loss|cost|privacy|compliance|quality|fault|flaw|missing)\b/u.test(value)
            ? 8
            : 0) +
          Math.min(3, value.split(/[,;]/u).length - 1),
      }))
      .sort((left, right) => right.score - left.score)[0]?.value;
    if (!best) return null;

    const tokens = best
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4)
      .filter((token) => !this.FAMILY_STOPWORDS.has(token));
    const unique: string[] = [];
    for (const token of tokens) {
      if (unique.includes(token)) continue;
      unique.push(token);
      if (unique.length >= 6) break;
    }
    if (unique.length < 2) return null;
    const label = unique
      .map((token) => token.charAt(0).toLocaleUpperCase() + token.slice(1))
      .join(' ')
      .slice(0, 120);
    return this.looksProblemFamilyBearing(label) ? label : null;
  }

  private static extractExplicitFailureFamily(evidenceText: string): string | null {
    const patterns: readonly { readonly pattern: RegExp; readonly suffix: string }[] = [
      {
        pattern: /\b(?:lack|lacks|lacked|lacking|absence|insufficient|inadequate|missing)\s+(?:of\s+)?([^.;!?]{8,180})/giu,
        suffix: 'Gaps',
      },
      {
        pattern: /\b(?:fail|fails|failed|failing|unable|cannot|can't)\s+(?:to\s+)?([^.;!?]{8,180})/giu,
        suffix: 'Failures',
      },
      {
        pattern: /\b(?:unsafe|unreliable|incorrect|wrong|delayed|excessive|abnormal|inefficient)\s+([^.;!?]{8,180})/giu,
        suffix: 'Risk',
      },
    ];

    for (const { pattern, suffix } of patterns) {
      for (const match of evidenceText.matchAll(pattern)) {
        const fragment = (match[1] ?? '')
          .replace(/\b(?:and|but|while)\s+(?:this|that|the|a|an)\b.*$/iu, '')
          .replace(/\s+/gu, ' ')
          .trim();
        const label = this.buildProfessionalFailureLabel(fragment, suffix);
        if (label) return label;
      }
    }
    return null;
  }

  private static buildProfessionalFailureLabel(
    fragment: string,
    suffix: string,
  ): string | null {
    const extraStopwords = new Set([
      'effective',
      'effectively',
      'actual',
      'really',
      'proper',
      'properly',
      'enough',
      'continued',
      'continuing',
      'increased',
      'increasing',
    ]);
    const tokens = fragment
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.toLocaleLowerCase())
      .filter((token) => token.length >= 3)
      .filter((token) => !this.FAMILY_STOPWORDS.has(token))
      .filter((token) => !extraStopwords.has(token));
    const unique: string[] = [];
    for (const token of tokens) {
      if (unique.includes(token)) continue;
      unique.push(token);
      if (unique.length >= 5) break;
    }
    if (unique.length < 2) return null;
    const base = unique
      .map((token) => token.charAt(0).toLocaleUpperCase() + token.slice(1))
      .join(' ');
    return `${base} ${suffix}`.slice(0, 120);
  }

  private static extractEvidenceChallengeFamily(evidenceText: string): string | null {
    const patterns = [
      /\b(?:key\s+|main\s+|major\s+|persistent\s+|common\s+|remaining\s+)?(?:challenges?|barriers?|limitations?|constraints?|risks?|concerns?|issues?|problems?)\s*(?:include|includes|including|such as|are|remain|involve|related to|around|:)\s*([^.;!?]{12,240})/giu,
      /\b(?:faces?|encounters?|experiences?|struggles? with|suffers? from)\s+([^.;!?]{12,220})/giu,
      /\b(?:lack|absence|shortage) of\s+([^.;!?]{8,180})/giu,
    ];
    const candidates: string[] = [];
    for (const pattern of patterns) {
      for (const match of evidenceText.matchAll(pattern)) {
        const fragment = (match[1] ?? '').replace(/\s+/gu, ' ').trim();
        if (!fragment || !this.looksProblemBearing(`${match[0]} ${fragment}`)) continue;
        candidates.push(fragment);
      }
    }
    const selected = candidates
      .sort((left, right) => right.length - left.length)[0];
    if (!selected) return null;

    const tokens = selected
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4)
      .filter((token) => !this.FAMILY_STOPWORDS.has(token))
      .slice(0, 6);
    if (tokens.length < 2) return null;
    const label = [...new Set(tokens)]
      .map((token) => token.charAt(0).toLocaleUpperCase() + token.slice(1))
      .join(' ')
      .slice(0, 120);
    return this.looksProblemFamilyBearing(label) ? label : null;
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
      .filter((domain) =>
        requestMode === 'DOMAINS_ONLY' || requestMode === 'NO_INPUT'
          ? this.domainMatchesDiscoveryText(domain, text)
          : this.domainMatchesText(domain, text),
      )
      .map((domain) => domain.id);
  }

  private static resolveBoundDiscoveryDomain(
    raw: IdeaGenerationRawEvidenceItem,
    domains: readonly SelectedGenerationDomain[],
  ): SelectedGenerationDomain | null {
    if (raw.discoveryDomainId) {
      return domains.find((domain) => domain.id === raw.discoveryDomainId) ?? null;
    }
    if (raw.discoveryDomainName) {
      const name = raw.discoveryDomainName.trim().toLocaleLowerCase();
      return (
        domains.find(
          (domain) => domain.name.trim().toLocaleLowerCase() === name,
        ) ?? null
      );
    }
    return null;
  }

  private static isWeakDeveloperTechnicalDiscoveryNoise(
    raw: IdeaGenerationRawEvidenceItem,
    domainName: string,
  ): boolean {
    const source = raw.sourceKey.trim().toLocaleLowerCase();
    if (!['stackoverflow', 'github', 'dev-to'].includes(source)) return false;

    const text = this.normalize(`${raw.title ?? ''} ${raw.text}`);
    const domain = this.normalize(domainName);
    const aiDomain = /artificial intelligence|machine learning|\bai\b/iu.test(domain);
    const cybersecurityDomain = /cybersecurity|information security/iu.test(domain);
    if (!aiDomain && !cybersecurityDomain) return false;

    const genericDeveloperFailure =
      /\b(?:compile|compiler|syntax|parameter|argument|named parameter|undefined|exception|stack trace|python|javascript|typescript|java|flutter|function|method|class|package|library|dependency|api call|http status|loop|algorithm|array|regex|createprocessasuser|localsystem|windows service|permission denied|build error|runtime error)\b/iu.test(
        text,
      );
    if (!genericDeveloperFailure) return false;

    const operationalConsequence =
      /\b(?:production|deployment|deployed|customer|customers|end users?|operations?|incident|outage|downtime|service disruption|financial loss|revenue|security operations|soc analyst|alert fatigue|false positive|breach|compromise|attack|ransomware|phishing|vulnerability|data exposure|unauthorized access|model drift|hallucination|inference failure|model failure|agent failure)\b/iu.test(
        text,
      );

    const aiOperationalAnchor =
      /\b(?:machine learning model|ai model|language model|large language model|llm|inference|hallucination|model drift|model deployment|ai deployment|ai agent|agentic ai|training data|prediction model)\b/iu.test(
        text,
      );
    const cybersecurityOperationalAnchor =
      /\b(?:cybersecurity|security operations|soc analyst|incident response|threat detection|malware|ransomware|phishing|vulnerability|breach|compromise|attack|unauthorized access|identity and access|access control|privilege escalation|security alert|false positive)\b/iu.test(
        text,
      );

    if (aiDomain && aiOperationalAnchor && operationalConsequence) return false;
    if (cybersecurityDomain && cybersecurityOperationalAnchor && operationalConsequence) {
      return false;
    }
    return true;
  }

  private static domainMatchesDiscoveryText(
    domain: SelectedGenerationDomain,
    normalizedText: string,
  ): boolean {
    const name = this.normalize(domain.name);
    const configured = (domain.configuredKeywords ?? [])
      .map((value) => this.normalize(value))
      .filter(Boolean);
    const strongPhrases = [name, ...configured]
      .filter((value) => value.length >= 4)
      .slice(0, 20);

    if (strongPhrases.some((phrase) => normalizedText.includes(phrase))) {
      return true;
    }

    const aliases: Array<[RegExp, RegExp]> = [
      [/\bcyber(?:security)?\b|information security|network security|soc\b|security operations|incident response|threat detection|malware|ransomware|phishing|access control|identity and access|privilege escalation/iu, /cybersecurity|information security/iu],
      [/\bai\b|artificial intelligence|machine learning|large language model|\bllm\b|model drift|hallucination/iu, /artificial intelligence|machine learning/iu],
      [/finance|financial|bank|banking|payment|payroll|billing|loan|credit|accounting|invoice/iu, /finance|financial/iu],
      [/real estate|property management|tenant|landlord|housing|mortgage|appraisal/iu, /real estate/iu],
      [/government|public sector|municipal|permit|procurement|civil service|public agency/iu, /government|public sector/iu],
      [/healthcare|hospital|clinic|medical|patient|clinical|biomedical/iu, /healthcare|health/iu],
      [/education|school|student|university|college|academic|teacher/iu, /education/iu],
      [/internet of things|\biot\b|sensor|telemetry|connected device|smart device/iu, /internet of things|\biot\b/iu],
    ];
    for (const [textPattern, domainPattern] of aliases) {
      if (domainPattern.test(name) && textPattern.test(normalizedText)) return true;
    }
    return false;
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
    const textTokens = this.semanticTokenSet(text, this.SUPPORTING_STOPWORDS);
    return spec.facets
      .filter((facet) => {
        const facetTokens = [
          ...this.semanticTokenSet(facet.statement, this.SUPPORTING_STOPWORDS),
        ];
        if (facetTokens.length === 0) return false;
        const overlap = facetTokens.filter((token) => textTokens.has(token)).length;
        const minimum = Math.min(2, facetTokens.length);
        return overlap >= minimum && overlap / facetTokens.length >= 0.4;
      })
      .map((facet) => facet.id);
  }

  private static looksProblemBearing(value: string): boolean {
    return /\b(?:problem|issue|bug|error|mistake|mismatch|fault|flaw|fail(?:ed|ure|ing|s)?|cannot|can't|unable|missing|lack(?:ed|ing|s)?|insufficient|inadequate|wrong|inaccurate|delay(?:ed|s)?|slow|rework|repeat(?:ed)?|waste|wasting|inefficien\w*|excessive|abnormal|anomal(?:y|ies|ous)|refund|confusion|blocked|unavailable|security|unauthori[sz]ed|breach|risk|unsafe|friction|difficult|struggle|need|wish|should|feature request|fraud|fraudulent|tamper(?:ed|ing)?|loss|losses|overload|backlog|downtime|shortage|inconsistent|miscommunication|damage|damaged)\b/iu.test(
      value,
    );
  }

  private static semanticTokenSet(
    value: string,
    stopwords: ReadonlySet<string>,
  ): Set<string> {
    const tokens = this.normalize(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4)
      .filter((token) => !stopwords.has(token))
      .map((token) => this.normalizeSemanticToken(token))
      .filter((token) => token.length >= 4)
      .filter((token) => !stopwords.has(token));
    return new Set(tokens);
  }

  private static normalizeSemanticToken(value: string): string {
    const token = value.toLocaleLowerCase();
    if (token.length > 6 && token.endsWith('ies')) {
      return `${token.slice(0, -3)}y`;
    }
    if (token.length > 6 && token.endsWith('es')) {
      return token.slice(0, -2);
    }
    if (token.length > 5 && token.endsWith('s') && !token.endsWith('ss')) {
      return token.slice(0, -1);
    }
    return token;
  }

  private static normalize(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
  }
}
