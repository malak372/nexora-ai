export class RequestEvidenceDomainRoleUtil {
  static isSolutionEnablerOnly(
    _domainName: string,
    _requestDescription?: string | null,
  ): boolean {
    return false;
  }

  static isEvidenceSearchDomain(
    domainName: string,
    _requestDescription?: string | null,
  ): boolean {
    return Boolean(this.normalize(domainName));
  }

  static filterEvidenceSearchTerms(
    terms: readonly string[],
    _selectedDomainNames: readonly string[],
    _requestDescription?: string | null,
  ): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const term of terms) {
      const value = term.replace(/\s+/gu, ' ').trim();
      if (!value) continue;
      const key = this.normalize(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
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
