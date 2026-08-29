import type { RequestCanonicalProblemProfile } from '../types/request-collection-plan.type';

export type CanonicalProblemFamilyMatch = {
  readonly key: string;
  readonly label: string;
  readonly source:
    | 'FAILURE_MODE'
    | 'WORKFLOW'
    | 'OBJECT'
    | 'CONSEQUENCE'
    | 'CORE_PROBLEM';
  readonly sourceIndex: number;
  readonly segmentIndex: number;
  readonly evidenceOverlap: number;
  readonly providerOverlap: number;
  readonly score: number;
};

type CanonicalFacet = {
  readonly key: string;
  readonly text: string;
  readonly label: string;
  readonly tokens: readonly string[];
  readonly source: CanonicalProblemFamilyMatch['source'];
  readonly sourceIndex: number;
  readonly segmentIndex: number;
  readonly priority: number;
};

/**
 * Normalizes free-form AI problem-family labels back onto the requester-owned
 * PREPARING-stage canonical problem profile.
 *
 * Provider labels are hints only. The returned family always comes from a
 * canonical requester facet, which prevents foreign-object labels and makes
 * semantically equivalent evidence converge into deterministic cluster keys.
 */
export class CanonicalProblemFamilyUtil {
  static resolve(input: {
    readonly profile: RequestCanonicalProblemProfile | null | undefined;
    readonly evidenceText: string;
    readonly providerFamily?: string | null;
  }): CanonicalProblemFamilyMatch | null {
    const profile = input.profile;
    if (!profile) return null;

    const evidenceTokens = new Set(this.tokenize(input.evidenceText));
    if (evidenceTokens.size === 0) return null;
    const providerTokens = new Set(this.tokenize(input.providerFamily ?? ''));

    const candidates = this.buildFacets(profile)
      .map((facet) => {
        const evidenceOverlap = facet.tokens.filter((token) =>
          evidenceTokens.has(token),
        ).length;
        const providerOverlap = facet.tokens.filter((token) =>
          providerTokens.has(token),
        ).length;
        const evidenceRatio =
          facet.tokens.length > 0 ? evidenceOverlap / facet.tokens.length : 0;
        const providerRatio =
          facet.tokens.length > 0 ? providerOverlap / facet.tokens.length : 0;
        const providerEvidenceOverlap = [...providerTokens].filter((token) =>
          evidenceTokens.has(token),
        ).length;
        const providerEvidenceRatio =
          providerTokens.size > 0
            ? providerEvidenceOverlap / providerTokens.size
            : 0;
        const providerHintEvidenceNative =
          providerTokens.size > 0 &&
          providerEvidenceOverlap >= Math.min(2, providerTokens.size) &&
          providerEvidenceRatio >= 0.6;

        /*
         * Evidence chooses the family; the provider label may only break ties.
         * Previously one or two generic object words plus a provider label
         * copied from the requester could attach a leather-template post to
         * "Manage Customer Waist Measurements" even though the evidence never
         * mentioned customers or measurements. Long facets now require
         * substantial evidence-native overlap and provider hints cannot make an
         * otherwise ineligible facet pass.
         */
        const eligible =
          facet.tokens.length <= 2
            ? evidenceOverlap >= 1 && evidenceRatio >= 0.5
            : facet.tokens.length <= 4
              ? evidenceOverlap >= 2 && evidenceRatio >= 0.5
              : evidenceOverlap >= 3 || evidenceRatio >= 0.5;

        return {
          facet,
          evidenceOverlap,
          providerOverlap,
          eligible,
          score:
            evidenceOverlap * 6 +
            evidenceRatio * 5 +
            (providerHintEvidenceNative ? providerOverlap * 0.75 + providerRatio : 0) +
            facet.priority,
        };
      })
      .filter((candidate) => candidate.eligible)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.evidenceOverlap - left.evidenceOverlap ||
          right.facet.priority - left.facet.priority ||
          left.facet.sourceIndex - right.facet.sourceIndex ||
          left.facet.segmentIndex - right.facet.segmentIndex,
      );

    const best = candidates[0];
    if (!best) return null;

    const providerFamily = (input.providerFamily ?? '').trim();
    if (
      providerFamily &&
      this.isProviderFamilyCompatible({
        profile,
        evidenceText: input.evidenceText,
        providerFamily,
      })
    ) {
      const providerTokens = this.tokenize(providerFamily);
      const evidenceSupported = providerTokens.filter((token) =>
        evidenceTokens.has(token),
      );
      if (
        evidenceSupported.length >= Math.min(2, providerTokens.length) &&
        evidenceSupported.length / Math.max(1, providerTokens.length) >= 0.6
      ) {
        const label = this.toLabel(providerFamily);
        if (label) {
          return {
            key: `evidence:${[...new Set(evidenceSupported)].sort().join('|')}`,
            label,
            source: best.facet.source,
            sourceIndex: best.facet.sourceIndex,
            segmentIndex: best.facet.segmentIndex,
            evidenceOverlap: best.evidenceOverlap,
            providerOverlap: best.providerOverlap,
            score: best.score + 0.5,
          };
        }
      }
    }
    const semanticOverlap = [...new Set(
      best.facet.tokens.filter((token) => evidenceTokens.has(token)),
    )].sort();
    return {
      key:
        semanticOverlap.length > 0
          ? `semantic:${semanticOverlap.join('|')}`
          : best.facet.key,
      label: this.enrichLabel(best.facet.label, best.facet.tokens, evidenceTokens),
      source: best.facet.source,
      sourceIndex: best.facet.sourceIndex,
      segmentIndex: best.facet.segmentIndex,
      evidenceOverlap: best.evidenceOverlap,
      providerOverlap: best.providerOverlap,
      score: best.score,
    };
  }

  static supportsEvidence(input: {
    readonly profile: RequestCanonicalProblemProfile | null | undefined;
    readonly evidenceText: string;
    readonly providerFamily?: string | null;
  }): boolean {
    return this.resolve(input) !== null;
  }

  /**
   * Rejects provider labels that introduce unsupported foreign concepts.
   * This is intentionally stricter than ordinary semantic overlap: a label is
   * metadata, so it has no right to add nouns that neither the requester nor
   * the evidence contains.
   */
  static isProviderFamilyCompatible(input: {
    readonly profile: RequestCanonicalProblemProfile | null | undefined;
    readonly evidenceText: string;
    readonly providerFamily: string | null | undefined;
  }): boolean {
    const providerTokens = this.tokenize(input.providerFamily ?? '');
    if (providerTokens.length === 0) return false;

    const profile = input.profile;
    const allowed = new Set([
      ...this.tokenize(input.evidenceText),
      ...(profile
        ? this.tokenize(
            [
              profile.actor,
              profile.object,
              profile.workflow,
              profile.coreProblem,
              ...profile.failureModes,
              ...profile.consequences,
            ].join(' '),
          )
        : []),
    ]);
    const evidenceTokens = new Set(this.tokenize(input.evidenceText));
    const evidenceSupported = providerTokens.filter((token) =>
      evidenceTokens.has(token),
    ).length;
    const evidenceRatio = evidenceSupported / providerTokens.length;
    if (
      evidenceSupported < Math.min(2, providerTokens.length) ||
      evidenceRatio < 0.6
    ) {
      return false;
    }

    // After the evidence-native requirement passes, ensure the family still
    // belongs to the requester/evidence vocabulary and introduces no foreign
    // object or workflow nouns.
    const supported = providerTokens.filter((token) => allowed.has(token)).length;
    const ratio = supported / providerTokens.length;
    return supported >= Math.min(2, providerTokens.length) && ratio >= 0.8;
  }

  private static buildFacets(
    profile: RequestCanonicalProblemProfile,
  ): readonly CanonicalFacet[] {
    const output: CanonicalFacet[] = [];
    const append = (
      source: CanonicalFacet['source'],
      sourceIndex: number,
      priority: number,
      value: string,
    ): void => {
      const segments = this.atomicSegments(value);
      segments.forEach((segment, segmentIndex) => {
        const tokens = this.tokenize(segment);
        if (tokens.length === 0) return;
        output.push({
          key: `${source.toLocaleLowerCase()}:${sourceIndex}:${segmentIndex}`,
          text: segment,
          label: this.toLabel(segment),
          tokens,
          source,
          sourceIndex,
          segmentIndex,
          priority,
        });
      });
    };

    profile.failureModes.forEach((value, index) =>
      append('FAILURE_MODE', index, 6, value),
    );
    append('WORKFLOW', 0, 5, profile.workflow);
    append('OBJECT', 0, 4, profile.object);
    profile.consequences.forEach((value, index) =>
      append('CONSEQUENCE', index, -2, value),
    );
    append('CORE_PROBLEM', 0, 3, profile.coreProblem);

    const seen = new Set<string>();
    return output.filter((facet) => {
      const semantic = [...new Set(facet.tokens)].sort().join('|');
      if (!semantic || seen.has(semantic)) return false;
      seen.add(semantic);
      return true;
    });
  }

  private static atomicSegments(value: string): readonly string[] {
    const cleaned = value
      .normalize('NFKC')
      .replace(/[\r\n]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!cleaned) return [];

    const coarse = cleaned
      .split(/\s*(?:;|\||\/|,|\band\b|\bor\b)\s*/iu)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const meaningful = coarse.filter((segment) => this.tokenize(segment).length > 0);
    if (meaningful.length <= 1) return [cleaned];
    return meaningful;
  }

  private static toLabel(value: string): string {
    const cleaned = value
      .replace(/\s+/gu, ' ')
      /*
       * Core problem sentences often start with the actor (for example
       * "Independent ... specialists often struggle to ..."). Strip that
       * grammatical lead-in before title-casing so a provider cannot turn the
       * first eight words of the request into a meaningless problem family.
       */
      .replace(
        /^.{0,160}?\b(?:often\s+)?(?:struggle|struggles|struggling)\s+to\s+/iu,
        '',
      )
      .replace(
        /^.{0,160}?\b(?:find|finds)\s+it\s+difficult\s+to\s+/iu,
        '',
      )
      .replace(
        /^(?:failing to|failure to|difficulty(?: in)?|difficulties(?: in)?|inability to|unable to|struggling to|struggle to|experiencing|causing|leading to|reviewing|analyzing|analysing|documenting|managing)\s+/iu,
        '',
      )
      .replace(/[.!?]+$/gu, '')
      .trim();
    const words = cleaned.split(/\s+/u).filter(Boolean).slice(0, 8);
    return this.truncateAtBoundary(
      words
        .map((word) =>
          /^[A-Z0-9_-]+$/u.test(word)
            ? word
            : word.charAt(0).toLocaleUpperCase() + word.slice(1),
        )
        .join(' '),
      120,
    );
  }

  private static truncateAtBoundary(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    const bounded = normalized.slice(0, maxLength + 1);
    const boundary = Math.max(
      bounded.lastIndexOf('. '),
      bounded.lastIndexOf('; '),
      bounded.lastIndexOf(', '),
      bounded.lastIndexOf(' '),
    );
    return (boundary >= Math.floor(maxLength * 0.55)
      ? bounded.slice(0, boundary)
      : bounded.slice(0, maxLength)).trim();
  }

  private static enrichLabel(
    baseLabel: string,
    facetTokens: readonly string[],
    evidenceTokens: ReadonlySet<string>,
  ): string {
    // The family label is evidence-native. Facet/token overlap is used only to
    // verify entailment; it must never inject a pre-authored domain scenario.
    void facetTokens;
    void evidenceTokens;
    return this.truncateAtBoundary(baseLabel, 120);
  }

  private static tokenize(value: string): string[] {
    const normalized = value
      .normalize('NFKC')
      .toLocaleLowerCase();
    const semanticExpansions: string[] = [];
    /*
     * Concrete monetary-loss wording is evidence-native support for a
     * requester facet such as "financial impact", even when a headline says
     * "missing public funds" or gives a fraud amount instead of repeating
     * the abstract phrase. Add the semantic tokens before canonical matching so
     * atomic support is not discarded or mislabeled as an unrelated "public"
     * workflow facet.
     */
    if (
      /\b(?:missing|lost|stolen|misappropriated)\s+(?:public\s+)?funds?\b/iu.test(normalized) ||
      (/(?:[$£€]\s*\d+(?:[.,]\d+)?\s*(?:k|m|million|thousand)?\b|\b\d+(?:[.,]\d+)?\s*(?:k|m|million|thousand)\b)/iu.test(normalized) &&
        /\b(?:fraud|scam|phishing|theft|stolen|loss)\w*\b/iu.test(normalized))
    ) {
      semanticExpansions.push('financial impact');
    }

    const tokens = `${normalized} ${semanticExpansions.join(' ')}`
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .split(/\s+/u)
      .map((token) => token.replace(/^-+|-+$/gu, ''))
      .filter(Boolean)
      .map((token) => this.alias(token))
      .filter((token) => token.length >= 3)
      .filter((token) => !this.stopWords.has(token));
    return [...new Set(tokens)];
  }

  private static alias(token: string): string {
    if (/^(?:booking|bookings|reservation|reservations)$/u.test(token)) return 'booking';
    if (/^(?:fraud|frauds|fraudulent|scam|scams|scamming)$/u.test(token)) return 'fraud';
    if (/^(?:takeover|takeovers|hijack|hijacked|hijacking|compromise|compromised|compromise)$/u.test(token)) return 'compromise';
    if (/^(?:review|reviews|recommendation|recommendations)$/u.test(token)) return 'review';
    if (/^(?:payment|payments|transaction|transactions|chargeback|chargebacks|refund|refunds)$/u.test(token)) return 'payment';
    if (/^(?:part|parts|component|components|replacement|replacements)$/u.test(token)) return 'component';
    if (/^(?:gear|gears|movement|movements|mechanism|mechanisms|mechanical)$/u.test(token)) return 'mechanism';
    if (/^(?:repair|repairs|repaired|restoration|restorations|restoring|treatment|treatments)$/u.test(token)) return 'restoration';
    if (/^(?:history|historical|records|record|documentation|document|documents|notes|notebook|notebooks)$/u.test(token)) return 'history';
    if (/^(?:damage|damaged|deterioration|deteriorated|broken|breakage)$/u.test(token)) return 'damage';
    if (/^(?:case|cases|casing|cabinet|cabinets)$/u.test(token)) return 'case';
    if (/^(?:customer|customers|client|clients|preference|preferences)$/u.test(token)) return 'preference';
    if (/^(?:delay|delays|delayed|late)$/u.test(token)) return 'delay';
    if (/^(?:cost|costs|expense|expenses)$/u.test(token)) return 'cost';
    if (/^(?:profit|profits|profitability|margin|margins)$/u.test(token)) return 'profitability';
    if (/^(?:transport|transportation|freight|shipping|shipment|shipments|logistics)$/u.test(token)) return 'transport';
    if (/^(?:distribution|distributor|distributors)$/u.test(token)) return 'distribution';
    if (/^(?:inventory|inventories|stock|stocks|warehouse|warehousing|storage)$/u.test(token)) return 'inventory';
    if (/^(?:crop|crops)$/u.test(token)) return 'crop';
    if (/^(?:produce|vegetable|vegetables|fruit|fruits)$/u.test(token)) return 'produce';
    if (/^(?:agriculture|agricultural|farming|farm)$/u.test(token)) return 'agricultural';
    if (/^(?:postharvest|post-harvest)$/u.test(token)) return 'postharvest';
    if (/^(?:downtime|outage|outages)$/u.test(token)) return 'downtime';
    if (/^(?:defect|defects|defective|scrap)$/u.test(token)) return 'defect';
    if (/^(?:labor|labour|overtime|staffing)$/u.test(token)) return 'labor';
    if (/^(?:material|materials|raw-material|raw-materials)$/u.test(token)) return 'material';
    if (/^(?:maintain|maintenance|servicing|service)$/u.test(token)) return 'maintenance';
    if (/^(?:blocked|blocking|restriction|restrictions)$/u.test(token)) return 'blocked';
    if (/^(?:false-positive|false-positives|falsepositive|falsepositives)$/u.test(token)) return 'falsepositive';
    if (/^(?:missing|lost|absent)$/u.test(token)) return 'missing';
    if (/^(?:separate|separated|separately|fragmented|scattered|siloed)$/u.test(token)) return 'fragmented';
    return token;
  }

  private static readonly stopWords = new Set([
    'the', 'and', 'for', 'from', 'with', 'that', 'this', 'these', 'those',
    'their', 'there', 'into', 'across', 'where', 'when', 'which', 'while',
    'often', 'struggle', 'struggles', 'making', 'difficult', 'difficulty',
    'system', 'systems', 'workflow', 'workflows', 'problem', 'problems',
    'issue', 'issues', 'service', 'services', 'user', 'users', 'information',
    'data', 'activity', 'activities', 'individual', 'single', 'current',
    'existing', 'operational', 'management', 'requester', 'supporting',
    'evidence', 'signal', 'signals', 'friction', 'most', 'evidenced',
    'aligned', 'request', 'primary', 'secondary', 'general', 'related', 'pattern', 'patterns', 'public',
    'using', 'used', 'through', 'before', 'after', 'without', 'within',
  ]);
}
