import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';

export type NicheCustomCraftKind =
  | 'WATCH_STRAP'
  | 'VIOLIN_BOW_COMMISSION'
  | 'BOOKBINDING_COMMISSION'
  | 'BOOK_EDGE_GILDING_COMMISSION'
  | 'LEATHER_BOOK_COVER_COMMISSION'
  | 'CALLIGRAPHY_STATIONERY_COMMISSION'
  | 'WEDDING_VEIL_COMMISSION'
  | 'WEDDING_SHOE_COMMISSION'
  | 'FLORAL_PRESERVATION_COMMISSION'
  | 'FLORAL_DESIGN_COMMISSION'
  | 'FOUNTAIN_PEN_COMMISSION'
  | 'GLASS_ENGRAVING_COMMISSION'
  | 'DOLL_CLOTHING_COMMISSION'
  | 'GENERIC_CUSTOM_CRAFT';

export type NicheCustomCraftProfile = {
  readonly kind: NicheCustomCraftKind;
  readonly label: string;
  readonly directIdentityTerms: readonly string[];
  readonly adjacentIdentityTerms: readonly string[];
  readonly workflowTerms: readonly string[];
  readonly painTerms: readonly string[];
  readonly preferredForumDomains: readonly string[];
  readonly preferredSubreddits: readonly string[];
  readonly suggestedDomainName: string | null;
};

/**
 * Request-derived retrieval contract for sparse custom-craft / bespoke-work
 * niches.  The profile is deliberately about workflow structure rather than a
 * single profession so new craft requests can reuse the same Direct vs
 * Supporting evidence semantics without inventing demand.
 */
export class RequestNicheCustomCraftUtil {
  static resolve(_requestDescription?: string | null): NicheCustomCraftProfile | null {
    return null;
  }

  static isDirectEvidence(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    return this.genericEvidenceScore(requestDescription, evidenceText) >= 0.6;
  }

  static isSupportingEvidence(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    return this.genericEvidenceScore(requestDescription, evidenceText) >= 0.35;
  }

  static isPlausibleRetrievalCandidate(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    return this.genericEvidenceScore(requestDescription, evidenceText) >= 0.2;
  }

  static isSafeExpandedRetrievalQuery(
    requestDescription: string | null | undefined,
    query: string,
  ): boolean {
    const requestTokens = new Set(this.tokens(requestDescription ?? ''));
    const queryTokens = this.tokens(query);
    if (queryTokens.length === 0) return false;
    if (requestTokens.size === 0) return true;
    return queryTokens.filter((token) => requestTokens.has(token)).length >= 1;
  }

  static buildSourceQueries(
    _requestDescription: string | null | undefined,
    _sourceKey: string,
  ): string[] {
    return [];
  }

  static preferredForumDomains(_requestDescription?: string | null): string[] {
    return [];
  }

  static preferredSubreddits(_requestDescription?: string | null): string[] {
    return [];
  }

  static suggestedDomainName(_requestDescription?: string | null): string | null {
    return null;
  }

  static isViolinBowServiceRequest(_requestDescription?: string | null): boolean {
    return false;
  }

  private static genericEvidenceScore(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): number {
    const request = this.tokens(requestDescription ?? '');
    const evidence = this.tokens(evidenceText);
    if (request.length === 0 || evidence.length === 0) return 0;
    const requestSet = new Set(request);
    const overlap = evidence.filter((token) => requestSet.has(token)).length;
    const denominator = Math.max(3, Math.min(requestSet.size, 12));
    return Math.min(1, overlap / denominator);
  }

  private static tokens(value: string): string[] {
    const stop = new Set([
      'the','and','for','with','from','that','this','these','those','often','usually','information','data','system','systems','problem','problems','workflow','workflows','user','users','their','they','them','which','making','difficult','can','may','into','across','between','through','while','when','where','about','more','most',
    ]);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)) {
      if (token.length < 3 || stop.has(token) || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }
}
