export class RequestEvidenceAlignmentUtil {
  static isAligned(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const score = this.alignmentScore(input);
    return this.passesEvidenceAuthenticityGuard(input) &&
      this.hasProblemBearingClaim(input.evidenceText) &&
      this.hasMinimumConceptAlignment(input) &&
      score >= 0.34;
  }

  static classifyForRequest(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): 'DIRECT_PROBLEM' | 'SUPPORTING_SIGNAL' | 'UNRELATED' {
    const evidence = this.normalize(input.evidenceText);
    if (!evidence || this.isPromotional(evidence)) return 'UNRELATED';
    if (!this.passesEvidenceAuthenticityGuard(input)) return 'UNRELATED';
    if (!this.hasProblemBearingClaim(evidence)) return 'UNRELATED';
    if (!this.hasMinimumConceptAlignment(input)) return 'UNRELATED';
    const score = this.alignmentScore(input);
    if (score >= 0.58) return 'DIRECT_PROBLEM';
    if (score >= 0.34) return 'SUPPORTING_SIGNAL';
    return 'UNRELATED';
  }

  static passesRawCorpusLexicalHygieneGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
  }): boolean {
    const evidence = this.normalize(input.evidenceText);
    if (!evidence || evidence.length < 12) return false;
    if (this.isPromotional(evidence)) return false;
    return true;
  }

  static passesPreAiTriageCandidateGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    if (!this.passesRawCorpusLexicalHygieneGuard(input)) return false;
    const request = this.normalize(input.requestDescription ?? '');
    if (!request) return true;
    return this.alignmentScore(input) >= 0.08;
  }

  static passesAtomicSupportingProblemGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    return this.passesEvidenceAuthenticityGuard(input) &&
      this.hasProblemBearingClaim(input.evidenceText) &&
      this.hasMinimumConceptAlignment(input) &&
      this.alignmentScore(input) >= 0.34;
  }

  static passesAiEvidenceAdmissionGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    return this.classifyForRequest(input) !== 'UNRELATED';
  }

  static passesCompositeEvidenceCandidateGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    return this.passesRawCorpusLexicalHygieneGuard(input) &&
      this.passesEvidenceAuthenticityGuard(input) &&
      this.alignmentScore(input) >= 0.18;
  }

  static passesPostAiPainAwareEvidenceGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    return this.passesAiEvidenceAdmissionGuard(input);
  }

  static hasProblemBearingClaim(evidenceText: string): boolean {
    const text = this.normalize(evidenceText);
    if (!text) return false;
    return /\b(?:problem|problems|issue|issues|fail|fails|failed|failure|failures|error|errors|wrong|incorrect|missing|lost|delay|delayed|slow|difficult|difficulty|struggle|struggles|pain|complaint|complaints|risk|risks|waste|wasted|rework|costly|higher cost|higher costs|downtime|shortage|shortages|fragmented|scattered|inconsistent|unable|cannot|can't|inefficient|inefficiency|unreliable|overloaded|bottleneck|bottlenecks|manual burden|time consuming|time-consuming|unmet need|unmet needs)\b/u.test(text);
  }

  static isResearchContextOnlyEvidence(evidenceText: string): boolean {
    const text = this.normalize(evidenceText);
    if (!text) return false;
    const studySetup = /\b(?:this study aims|we recruited|participants were|methods|methodology|study protocol|trial registration|we propose|we present a framework|literature review)\b/u.test(text);
    const finding = /\b(?:found|finding|findings|results showed|results indicate|reported|observed|associated with|increased|decreased|caused|led to|significant|problem|failure|delay|waste|error|complaint)\b/u.test(text);
    return studySetup && !finding;
  }

  static classifyForRequestFallback(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): 'DIRECT_PROBLEM' | 'SUPPORTING_SIGNAL' | 'UNRELATED' {
    return this.classifyForRequest(input);
  }

  static selectCompositeAlignedEvidence(input: {
    readonly requestDescription?: string | null;
    readonly evidenceTexts: readonly string[];
    readonly plannedQueries?: readonly string[];
    readonly maxSamples?: number;
  }): string[] {
    const maxSamples = Math.max(1, Math.min(input.maxSamples ?? 5, 8));
    const candidates = [...new Set(input.evidenceTexts.map((value) => value.replace(/\s+/gu, ' ').trim()).filter((value) => value.length >= 12))];
    const scored = candidates
      .map((evidenceText) => ({
        evidenceText,
        score: this.alignmentScore({
          requestDescription: input.requestDescription,
          evidenceText,
          plannedQueries: input.plannedQueries,
        }) + (this.hasProblemBearingClaim(evidenceText) ? 0.25 : 0),
      }))
      .filter((entry) => entry.score >= 0.28)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxSamples)
      .map((entry) => entry.evidenceText);
    return scored;
  }

  static isCompositeAligned(input: {
    readonly requestDescription?: string | null;
    readonly evidenceTexts: readonly string[];
    readonly plannedQueries?: readonly string[];
  }): boolean {
    return this.selectCompositeAlignedEvidence({ ...input, maxSamples: 5 }).length > 0;
  }

  static isRequestWorkflowContextEvidence(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    if (!this.passesRawCorpusLexicalHygieneGuard(input)) return false;
    return this.alignmentScore(input) >= 0.18;
  }

  static isDomainAgnosticSupportingEvidence(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
  }): boolean {
    return this.passesEvidenceAuthenticityGuard(input) &&
      this.hasProblemBearingClaim(input.evidenceText) &&
      this.hasMinimumConceptAlignment(input) &&
      this.alignmentScore(input) >= 0.34;
  }

  static requiresStrictWorkflowIdentity(input: {
    readonly requestDescription?: string | null;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const tokens = this.tokens(input.requestDescription ?? '');
    return tokens.length >= 12;
  }

  private static passesEvidenceAuthenticityGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const evidence = this.normalize(input.evidenceText);
    if (!evidence) return false;

    const requestScope = this.normalize(
      [input.requestDescription ?? '', ...(input.plannedQueries ?? [])].join(' '),
    );
    const scenarioMarkers = /\b(?:what if|alternate scenario|alternative scenario|fictional|fiction|roleplay|role play|fanfic|fan fiction|game scenario|hypothetical scenario|imaginary scenario|worldbuilding|writing prompt|implementation brief|demo prompt|simulation scenario)\b/u;
    const realWorldMarkers = /\b(?:reported|reports|complaint|complaints|incident|incidents|survey|study|operators?|customers?|users?|workers?|staff|businesses?|organizations?|municipalities|agencies|observed|experienced|experiences|struggle|struggles|failed|failure|delay|delayed|outage|backlog|error|errors|waste|rework)\b/u;

    if (scenarioMarkers.test(evidence) && !scenarioMarkers.test(requestScope)) {
      return false;
    }

    if (/\b(?:prompt|specification|implementation brief|demo)\b/u.test(evidence) &&
        !realWorldMarkers.test(evidence) &&
        !/\b(?:prompt|specification|implementation|developer tool|software development)\b/u.test(requestScope)) {
      return false;
    }

    return true;
  }

  private static hasMinimumConceptAlignment(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const evidence = new Set(this.tokens(input.evidenceText));
    if (evidence.size === 0) return false;

    const requestTokens = this.tokens(input.requestDescription ?? '');
    const queryGroups = (input.plannedQueries ?? [])
      .map((query) => this.tokens(query))
      .filter((tokens) => tokens.length > 0);

    if (requestTokens.length > 0) {
      const requestOverlap = requestTokens.filter((token) => evidence.has(token));
      const distinctOverlap = new Set(requestOverlap).size;
      if (distinctOverlap >= 3) return true;
      return queryGroups.some((tokens) =>
        new Set(tokens.filter((token) => evidence.has(token))).size >= 3,
      );
    }

    // Domains-only/no-input requests have no prose problem. Require the item
    // to materially match one complete AI-planned discovery query rather than
    // sharing one generic word such as "government" or "failure".
    return queryGroups.some((tokens) => {
      const meaningful = [...new Set(tokens)];
      const overlap = meaningful.filter((token) => evidence.has(token)).length;
      return overlap >= Math.min(3, Math.max(2, Math.ceil(meaningful.length * 0.45)));
    });
  }

  private static alignmentScore(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): number {
    const requestTokens = this.tokens(input.requestDescription ?? '');
    const evidenceTokens = this.tokens(input.evidenceText);
    const queryTokens = this.tokens((input.plannedQueries ?? []).join(' '));
    if (evidenceTokens.length === 0) return 0;
    if (requestTokens.length === 0 && queryTokens.length === 0) return 0.2;

    const requestSet = new Set(requestTokens);
    const querySet = new Set(queryTokens);
    const evidenceSet = new Set(evidenceTokens);
    const requestOverlap = [...evidenceSet].filter((token) => requestSet.has(token)).length;
    const queryOverlap = [...evidenceSet].filter((token) => querySet.has(token)).length;
    const requestDenominator = Math.max(4, Math.min(requestSet.size, 16));
    const queryDenominator = Math.max(3, Math.min(querySet.size, 12));
    const requestScore = requestOverlap / requestDenominator;
    const queryScore = querySet.size > 0 ? queryOverlap / queryDenominator : 0;
    if (requestSet.size === 0) {
      return Math.min(1, queryScore);
    }
    if (querySet.size === 0) {
      return Math.min(1, requestScore);
    }
    return Math.min(1, requestScore * 0.7 + queryScore * 0.3);
  }

  private static isPromotional(value: string): boolean {
    const promotional = /\b(?:buy now|shop now|limited time|discount code|promo code|free shipping|order today|download now|best price|sale ends|sponsored)\b/u.test(value);
    const problem = this.hasProblemBearingClaim(value);
    return promotional && !problem;
  }

  private static tokens(value: string): string[] {
    const stop = new Set([
      'the','a','an','and','or','of','to','for','with','without','from','in','on','at','by','across','between','into','through','while','when','where','which','that','this','these','those','often','usually','frequently','making','companies','company','services','service','systems','system','platform','platforms','operations','workflow','problem','problems','issue','issues','records','record','information','data','request','requests','user','users','using','used','use','their','they','them','there','have','has','had','are','was','were','been','being','can','could','may','might','will','would','should','more','most','some','many','each','other','same','different',
    ]);
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of this.normalize(value).split(/\s+/u)) {
      const token = this.stem(raw);
      if (token.length < 3 || stop.has(token) || seen.has(token)) continue;
      seen.add(token);
      output.push(token);
    }
    return output;
  }

  private static stem(token: string): string {
    let value = token.toLocaleLowerCase();
    if (/ies$/u.test(value) && value.length > 5) value = `${value.slice(0, -3)}y`;
    else if (/ing$/u.test(value) && value.length > 6) value = value.slice(0, -3);
    else if (/ed$/u.test(value) && value.length > 5) value = value.slice(0, -2);
    else if (/s$/u.test(value) && !/ss$/u.test(value) && value.length > 5) value = value.slice(0, -1);
    return value;
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
