import type { RequestCanonicalProblemProfile } from '../types/request-collection-plan.type';

export class SourceSpecificEvidenceQueryUtil {
  private static readonly forbiddenInternalLabels = [
    /selected[- ]domain/iu,
    /evidence discovery/iu,
    /requester[- ]defined/iu,
    /validation lane/iu,
    /canonical problem/iu,
    /validation hypothesis/iu,
  ];

  static compile(input: {
    readonly sourceKey: string;
    readonly baseQueries: readonly string[];
    readonly requestDescription?: string | null;
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
    readonly discoveryDomainName?: string | null;
    readonly maxQueries?: number;
    /**
     * Preserve planner-authored semantic queries ahead of mechanical
     * source adaptation. Use this for PRIMARY/SECONDARY lanes where PREPARING
     * already produced grounded search language.
     */
    readonly preserveBaseQueries?: boolean;
  }): string[] {
    const sourceKey = input.sourceKey.toLocaleLowerCase();
    const maxQueries = Math.max(1, Math.min(2, input.maxQueries ?? 2));
    const baseQueries = this.unique(
      input.baseQueries
        .map((query) => this.sanitize(query))
        .filter((query) => this.isSafe(query)),
    );
    const anchor = this.buildAnchor(input);
    const pain = this.buildPainAnchor(input);

    const transformed = (() => {
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          `${anchor} app`,
          `${anchor} tracker`,
        ];
      }
      if (sourceKey === 'github') {
        return [
          `${anchor} software issue`,
          `${pain || anchor} workflow bug`,
        ];
      }
      if (sourceKey === 'stackoverflow') {
        return [
          `${anchor} integration error`,
          `${pain || anchor} software problem`,
        ];
      }
      if (sourceKey === 'dev-to' || sourceKey === 'hacker-news') {
        return [
          `${anchor} developer workflow problem`,
          `${pain || anchor} production issue`,
        ];
      }
      if (sourceKey === 'product-hunt') {
        return [
          `${anchor} workflow software`,
          `${anchor} operations tool`,
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          `${anchor} workflow problem study`,
          `${pain || anchor} operational challenge`,
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt') {
        return [
          `${anchor} operational problem`,
          `${pain || anchor} incident delay`,
        ];
      }
      if (sourceKey === 'youtube' || sourceKey === 'blog') {
        return [
          `${anchor} workflow problem`,
          `${pain || anchor} practitioner experience`,
        ];
      }
      // Community/forum sources benefit most from first-person/friction wording.
      return [
        ...baseQueries.slice(0, 2),
        `${anchor} ${pain || 'problem'}`,
      ];
    })();

    const orderedCandidates =
      input.preserveBaseQueries && !['app-store', 'google-play', 'product-hunt'].includes(sourceKey)
        ? [...baseQueries, ...transformed]
        : [...transformed, ...baseQueries];
    const candidates = this.unique(orderedCandidates)
      .map((query) => this.sanitize(query))
      .filter((query) => this.isSafe(query))
      .filter((query) => query.length >= 8 && query.length <= 140);
    return candidates.slice(0, maxQueries);
  }

  static isSafe(query: string): boolean {
    const normalized = this.sanitize(query);
    if (!normalized || normalized.length > 140) return false;
    return !this.forbiddenInternalLabels.some((pattern) => pattern.test(normalized));
  }

  private static buildAnchor(input: {
    readonly requestDescription?: string | null;
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
    readonly discoveryDomainName?: string | null;
  }): string {
    const profile = input.problemProfile;
    const candidates = [
      profile?.object,
      profile?.actor,
      input.discoveryDomainName,
      profile?.workflow,
      input.requestDescription,
    ];
    for (const candidate of candidates) {
      const compact = this.compactNouns(candidate ?? '', 6);
      if (compact) return compact;
    }
    return 'software workflow';
  }

  private static buildPainAnchor(input: {
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
  }): string {
    const profile = input.problemProfile;
    return this.compactNouns(
      profile?.friction || profile?.failureModes?.[0] || profile?.consequences?.[0] || '',
      6,
    );
  }

  private static compactNouns(value: string, maxTokens: number): string {
    const stop = new Set([
      'the','and','for','with','from','into','while','often','struggle','struggles',
      'information','frequently','through','across','their','each','this','that',
      'making','difficult','used','using','manage','managing','large','amounts',
    ]);
    const tokens = this.sanitize(value)
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}-]+/u)
      .filter((token) => token.length >= 3 && !stop.has(token));
    return [...new Set(tokens)].slice(0, maxTokens).join(' ');
  }

  private static sanitize(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[\r\n\t]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .replace(/^[\s|,:;.-]+|[\s|,:;.-]+$/gu, '')
      .trim();
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of values) {
      const value = this.sanitize(raw);
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }
}
