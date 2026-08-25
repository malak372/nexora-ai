export class RequestEvidenceDomainRoleUtil {
  private static readonly SOLUTION_ENABLER_ALIASES: Readonly<Record<string, readonly string[]>> = {
    'artificial intelligence': ['artificial intelligence', 'ai', 'machine learning', 'ml', 'generative ai'],
    blockchain: ['blockchain', 'distributed ledger', 'smart contract'],
    'internet of things': ['internet of things', 'iot', 'connected devices', 'sensor network'],
    cloud: ['cloud', 'cloud computing', 'cloud platform'],
    cybersecurity: ['cybersecurity', 'cyber security', 'information security'],
  };

  /**
   * Returns true when a selected domain is being used as a solution/enabling
   * technology rather than as part of the problem described by the requester.
   * The request text remains authoritative: if the technology is explicitly
   * part of the problem, it remains evidence-search relevant.
   */
  static isSolutionEnablerOnly(
    domainName: string,
    requestDescription?: string | null,
  ): boolean {
    const domain = this.normalize(domainName);
    const request = this.normalize(requestDescription ?? '');
    if (!domain || !request) return false;

    const aliases = this.resolveAliases(domain);
    if (aliases.length === 0) return false;
    if (aliases.some((alias) => this.containsPhrase(request, alias))) {
      return false;
    }

    /*
     * Some problem domains are expressed through their concrete failure
     * vocabulary rather than the catalog label itself. Cybersecurity is the
     * common example: a requester may describe account takeover, unauthorized
     * refunds, security alerts, or credential theft without writing the word
     * "cybersecurity". Treat those as problem evidence scope. Conversely, AI
     * remains solution-only unless AI/model behavior itself appears in the pain.
     */
    if (domain === 'cybersecurity') {
      return !/\b(?:security alerts?|security incidents?|account takeover|account compromise|compromised accounts?|unauthori[sz]ed access|credential theft|identity theft|fraud(?:ulent)?|suspicious activity|data breach|cyberattack|false positive(?:s)?|legitimate transactions? (?:being )?blocked)\b/u.test(
        request,
      );
    }
    if (domain === 'artificial intelligence') {
      return !/\b(?:ai model|ai models|artificial intelligence|machine learning|ml model|model prediction|model predictions|model error|model errors|model bias|ai-generated|ai generated|generative ai)\b/u.test(
        request,
      );
    }
    if (domain === 'internet of things') {
      return !/\b(?:iot|internet of things|sensor network|connected devices?|device telemetry|device security|sensor failure|sensor data)\b/u.test(
        request,
      );
    }
    if (domain === 'blockchain') {
      return !/\b(?:blockchain|distributed ledger|smart contracts?|on-chain|onchain|wallet compromise|wallet security)\b/u.test(
        request,
      );
    }

    return true;
  }

  static isEvidenceSearchDomain(
    domainName: string,
    requestDescription?: string | null,
  ): boolean {
    return !this.isSolutionEnablerOnly(domainName, requestDescription);
  }

  /** Remove only pure enabler labels/aliases; requester problem phrases stay. */
  static filterEvidenceSearchTerms(
    terms: readonly string[],
    selectedDomainNames: readonly string[],
    requestDescription?: string | null,
  ): string[] {
    const blocked = new Set<string>();
    for (const domainName of selectedDomainNames) {
      if (!this.isSolutionEnablerOnly(domainName, requestDescription)) continue;
      const normalized = this.normalize(domainName);
      blocked.add(normalized);
      for (const alias of this.resolveAliases(normalized)) blocked.add(alias);
    }

    return terms.filter((term) => {
      const normalized = this.normalize(term);
      if (!normalized) return false;
      if (blocked.has(normalized)) return false;
      // Do not keep a technology-only phrase whose meaningful content is one
      // blocked enabler alias. Mixed requester problem phrases are preserved.
      for (const alias of blocked) {
        if (normalized === alias || normalized === `${alias} domain`) return false;
      }
      return true;
    });
  }

  private static resolveAliases(normalizedDomainName: string): string[] {
    for (const [canonical, aliases] of Object.entries(this.SOLUTION_ENABLER_ALIASES)) {
      if (normalizedDomainName === canonical || aliases.some((alias) => normalizedDomainName === alias)) {
        return [...new Set([canonical, ...aliases].map((value) => this.normalize(value)))];
      }
    }
    return [];
  }

  private static containsPhrase(value: string, phrase: string): boolean {
    if (!phrase) return false;
    if (/^[a-z0-9]{2,3}$/u.test(phrase)) {
      return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u').test(value);
    }
    return value.includes(phrase);
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
