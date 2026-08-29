export class RequestQueryProvenanceUtil {
  static isQueryGrounded(input: {
    readonly requestDescription?: string | null;
    readonly query: string;
  }): boolean {
    const request = this.semanticTokens(input.requestDescription ?? '');
    const query = this.semanticTokens(input.query);
    if (query.length === 0) return false;
    if (request.length === 0) return true;
    const requestSet = new Set(request);
    const overlap = query.filter((token) => requestSet.has(token)).length;
    if (overlap >= 2) return true;
    if (overlap === 1 && query.length <= 7) return true;
    return false;
  }

  static isDerivedConceptGrounded(
    requestDescription: string | null | undefined,
    value: string,
  ): boolean {
    const request = this.semanticTokens(requestDescription ?? '');
    const candidate = this.semanticTokens(value);
    if (candidate.length === 0) return false;
    if (request.length === 0) return true;
    const requestSet = new Set(request);
    return candidate.some((token) => requestSet.has(token));
  }

  static filterQueries(
    requestDescription: string | null | undefined,
    queries: readonly string[],
  ): string[] {
    return queries.filter((query) =>
      this.isQueryGrounded({ requestDescription, query }),
    );
  }

  static extractObjectIdentityTokens(value: string): string[] {
    return this.semanticTokens(value).slice(0, 10);
  }

  static hasObjectIdentityOverlap(
    requestDescription: string | null | undefined,
    candidate: string,
  ): boolean {
    const request = new Set(this.semanticTokens(requestDescription ?? ''));
    return this.semanticTokens(candidate).some((token) => request.has(token));
  }

  private static semanticTokens(value: string): string[] {
    const stop = new Set([
      'the','a','an','and','or','of','to','for','with','without','from','in','on','at','by','across','between','into','through','while','when','where','which','that','this','these','those','often','usually','frequently','struggle','struggles','difficult','making','lead','leads','leading','companies','company','services','service','systems','system','platform','platforms','operations','workflow','problem','problems','issue','issues','reviewed','review','records','record','information','data','requests','request','activity','activities','user','users',
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
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
