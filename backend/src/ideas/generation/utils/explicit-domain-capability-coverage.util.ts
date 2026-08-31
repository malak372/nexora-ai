import type { SelectedGenerationDomain } from '../types/idea-generation-context.type';

export type ExplicitDomainCoverageContract = Pick<
  SelectedGenerationDomain,
  'name' | 'keywords' | 'configuredKeywords' | 'effectiveSearchKeywords'
>;

/**
 * Shared semantic coverage guard for TEXT_AND_DOMAINS generation.
 *
 * The guard does not require a literal domain-name mention. It accepts concrete
 * implementation language that materially represents the selected domain and
 * also consumes each domain's configured/runtime search vocabulary so newly
 * added domains do not need test-specific branches in the benchmark or final
 * validator.
 */
export class ExplicitDomainCapabilityCoverageUtil {
  private static readonly STOPWORDS = new Set([
    'about',
    'across',
    'after',
    'against',
    'also',
    'among',
    'and',
    'because',
    'before',
    'between',
    'could',
    'domain',
    'from',
    'into',
    'many',
    'more',
    'platform',
    'service',
    'services',
    'system',
    'systems',
    'that',
    'their',
    'these',
    'this',
    'through',
    'using',
    'with',
  ]);

  static resolveMissing(
    domains: readonly ExplicitDomainCoverageContract[],
    candidateNarrative: string,
  ): string[] {
    return domains
      .filter((domain) => !this.isCovered(domain, candidateNarrative))
      .map((domain) => domain.name);
  }

  static isCovered(
    domain: ExplicitDomainCoverageContract,
    candidateNarrative: string,
  ): boolean {
    const narrative = this.normalize(candidateNarrative);
    const name = this.normalize(domain.name);
    if (!name || !narrative) return false;

    const strongAliases = this.resolveStrongAliases(name);
    if (strongAliases.some((alias) => this.containsPhrase(narrative, alias))) {
      return true;
    }

    const semanticGroups = this.resolveSemanticGroups(name);
    const matchedSemanticGroups = semanticGroups.filter((group) =>
      group.some((alias) => this.containsPhrase(narrative, alias)),
    ).length;
    if (matchedSemanticGroups >= 2) return true;

    const vocabulary = this.unique([
      ...(domain.configuredKeywords ?? []),
      ...(domain.keywords ?? []),
      ...(domain.effectiveSearchKeywords ?? []),
    ]).filter(
      (value) =>
        this.normalize(value) !== name && this.isUsefulVocabulary(value),
    );

    let strongPhraseMatches = 0;
    const matchedTokens = new Set<string>();
    for (const value of vocabulary.slice(0, 24)) {
      const normalized = this.normalize(value);
      if (!normalized) continue;
      const tokens = this.tokens(normalized);
      if (tokens.length >= 2 && this.containsPhrase(narrative, normalized)) {
        strongPhraseMatches += 1;
      }
      for (const token of tokens) {
        if (
          token.length >= 5 &&
          !this.STOPWORDS.has(token) &&
          this.containsPhrase(narrative, token)
        ) {
          matchedTokens.add(token);
        }
      }
    }

    return strongPhraseMatches >= 1 || matchedTokens.size >= 2;
  }

  private static resolveStrongAliases(normalizedDomainName: string): readonly string[] {
    if (
      normalizedDomainName.includes('artificial intelligence') ||
      normalizedDomainName === 'ai'
    ) {
      return [
        'machine learning',
        'deep learning',
        'computer vision',
        'predictive model',
        'forecasting model',
        'prediction model',
        'anomaly detection',
        'risk scoring',
        'classification model',
        'recommendation engine',
        'model inference',
        'model training',
        'ai assisted',
        'ai based',
      ];
    }

    if (normalizedDomainName.includes('cybersecurity')) {
      return [
        'cybersecurity',
        'cyber security',
        'threat detection',
        'security monitoring',
        'security incident',
        'access anomaly',
        'suspicious access',
      ];
    }

    if (normalizedDomainName.includes('blockchain')) {
      return [
        'blockchain',
        'distributed ledger',
        'permissioned ledger',
        'tamper evident ledger',
        'tamper-evident ledger',
        'smart contract',
      ];
    }

    return [];
  }

  private static resolveSemanticGroups(
    normalizedDomainName: string,
  ): readonly (readonly string[])[] {
    if (
      normalizedDomainName.includes('artificial intelligence') ||
      normalizedDomainName === 'ai'
    ) {
      return [
        ['artificial intelligence', 'machine learning', 'deep learning', 'computer vision'],
        ['predictive model', 'forecasting model', 'prediction model', 'model inference', 'model training'],
        ['anomaly detection', 'risk scoring', 'classification model', 'recommendation engine', 'ai assisted', 'ai based'],
      ];
    }

    if (
      normalizedDomainName.includes('internet of things') ||
      normalizedDomainName === 'iot'
    ) {
      return [
        ['internet of things', 'iot', 'connected device', 'connected devices'],
        ['sensor', 'sensors', 'device telemetry', 'telemetry', 'device state'],
        ['edge device', 'gateway', 'smart meter', 'remote device monitoring'],
      ];
    }

    if (normalizedDomainName.includes('energy')) {
      return [
        ['energy', 'electricity', 'electric power', 'power grid', 'grid energy', 'energy availability'],
        ['charging', 'charge level', 'charging level', 'state of charge', 'battery', 'battery level'],
        ['energy demand', 'energy consumption', 'power demand', 'charging demand', 'load forecasting'],
      ];
    }

    if (
      normalizedDomainName.includes('transportation') ||
      normalizedDomainName.includes('transport') ||
      normalizedDomainName.includes('mobility')
    ) {
      return [
        ['transportation', 'public transportation', 'public transport', 'transit', 'mobility'],
        ['route planning', 'route optimization', 'route optimisation', 'route adjustment', 'vehicle routing', 'dispatch'],
        ['fleet', 'fleet data', 'vehicle scheduling', 'passenger demand', 'route congestion', 'service interruption'],
      ];
    }

    if (normalizedDomainName.includes('cybersecurity')) {
      return [
        ['cybersecurity', 'cyber security', 'threat detection', 'security incident'],
        ['security monitoring', 'security alert', 'access anomaly', 'suspicious access', 'unauthorized access'],
        ['least privilege', 'role based access control', 'rbac', 'audit trail', 'audit log', 'data integrity'],
      ];
    }

    if (
      normalizedDomainName.includes('finance') ||
      normalizedDomainName.includes('financial') ||
      normalizedDomainName.includes('fintech')
    ) {
      return [
        ['finance', 'financial', 'financial transaction', 'financial ledger'],
        ['budget', 'budgeting', 'payment', 'payments', 'expenditure', 'spending'],
        ['reconciliation', 'transaction matching', 'financial audit', 'fund allocation', 'disbursement'],
      ];
    }

    if (
      normalizedDomainName.includes('government') ||
      normalizedDomainName.includes('public sector')
    ) {
      return [
        ['government', 'public sector', 'public institution', 'public administration'],
        ['municipal', 'municipality', 'departmental', 'public service'],
        ['public budget', 'public funds', 'public procurement', 'government spending'],
      ];
    }

    if (normalizedDomainName.includes('smart cit')) {
      return [
        ['smart city', 'smart cities', 'city infrastructure', 'urban infrastructure'],
        ['municipal', 'municipality', 'urban operations', 'city services'],
        ['city scale', 'city-scale', 'municipal waste', 'sanitation operations'],
      ];
    }

    if (normalizedDomainName.includes('logistics')) {
      return [
        ['logistics', 'logistical'],
        ['route optimization', 'route optimisation', 'vehicle routing', 'fleet routing'],
        ['fleet dispatch', 'dispatch', 'delivery route', 'collection route'],
      ];
    }

    if (normalizedDomainName.includes('manufactur')) {
      return [
        ['manufacturing', 'manufacturer', 'factory', 'industrial plant'],
        ['production line', 'plant floor', 'shop floor', 'production operations'],
        ['machine telemetry', 'process telemetry', 'downtime', 'production scheduling'],
      ];
    }

    if (normalizedDomainName.includes('blockchain')) {
      return [
        ['blockchain', 'distributed ledger', 'permissioned ledger'],
        ['append only ledger', 'append-only ledger', 'tamper evident ledger', 'tamper-evident ledger'],
        ['cryptographic hash', 'hash anchoring', 'smart contract', 'on chain', 'on-chain'],
      ];
    }

    return [];
  }

  private static isUsefulVocabulary(value: string): boolean {
    const normalized = this.normalize(value);
    if (!normalized || normalized.length < 4 || normalized.length > 90) {
      return false;
    }
    const tokens = this.tokens(normalized).filter(
      (token) => token.length >= 4 && !this.STOPWORDS.has(token),
    );
    return tokens.length > 0 && tokens.length <= 8;
  }

  private static containsPhrase(haystack: string, needle: string): boolean {
    const normalizedNeedle = this.normalize(needle);
    if (!normalizedNeedle) return false;
    const pattern = new RegExp(
      `\\b${this.escapeRegExp(normalizedNeedle).replace(/\s+/gu, '\\s+')}\\b`,
      'iu',
    );
    return pattern.test(haystack);
  }

  private static tokens(value: string): string[] {
    return this.normalize(value)
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
      const normalized = this.normalize(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(value);
    }
    return output;
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[’']/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
