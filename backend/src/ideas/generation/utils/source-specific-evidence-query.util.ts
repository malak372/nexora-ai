import type { RequestCanonicalProblemProfile } from '../types/request-collection-plan.type';

/**
 * Converts PREPARING-stage retrieval seeds into source-shaped queries without
 * destroying the semantic wording authored by the AI planner.
 *
 * Query policy:
 * - planner/base queries are the strongest lane and are preserved verbatim;
 * - source-shaped variants are supporting-recall lanes;
 * - broader domain/object variants are last-resort recall lanes;
 * - source vocabulary must never manufacture a software/developer problem for
 *   a non-technical request merely because the destination is GitHub/HN/etc.
 */
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
     * Preserve planner-authored semantic queries ahead of mechanical source
     * adaptation. PRIMARY/SECONDARY lanes should normally enable this.
     */
    readonly preserveBaseQueries?: boolean;
  }): string[] {
    const sourceKey = input.sourceKey.toLocaleLowerCase();
    // PRIMARY lanes intentionally have room for one strong, one supporting and
    // one broad query. The old hard cap of 2 silently discarded the third query
    // even when the planner/runtime explicitly budgeted three.
    const maxQueries = Math.max(1, Math.min(4, input.maxQueries ?? 2));
    const baseQueries = this.unique(
      input.baseQueries
        .map((query) => this.sanitize(query))
        .filter((query) => this.isSafe(query)),
    );
    const anchor = this.buildAnchor(input);
    const workflow = this.buildWorkflowAnchor(input);
    const pain = this.buildPainAnchor(input);
    const domain = this.compactNouns(input.discoveryDomainName ?? '', 5);
    const technicalRequest = this.isTechnicalRequest(input);

    const supportingVariants = (() => {
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          `${anchor} ${workflow || 'management'}`,
          `${anchor} tracker`,
          `${domain || anchor} management app`,
        ];
      }

      if (sourceKey === 'github' || sourceKey === 'stackoverflow') {
        if (technicalRequest) {
          return sourceKey === 'github'
            ? [
                `${anchor} ${pain || 'software issue'}`,
                `${anchor} ${workflow || 'workflow'} bug`,
                `${domain || anchor} integration failure`,
              ]
            : [
                `${anchor} ${pain || 'integration error'}`,
                `${anchor} ${workflow || 'software problem'}`,
                `${domain || anchor} implementation issue`,
              ];
        }
        // Non-technical professional requests are allowed to probe these
        // sources, but the query must remain about the real object/workflow.
        return [
          `${anchor} ${pain || workflow || 'problems'}`,
          `${domain || anchor} ${workflow || 'workflow challenges'}`,
        ];
      }

      if (sourceKey === 'dev-to' || sourceKey === 'hacker-news') {
        return technicalRequest
          ? [
              `${anchor} ${pain || 'developer problem'}`,
              `${anchor} ${workflow || 'production workflow'} issue`,
              `${domain || anchor} implementation pain`,
            ]
          : [
              `${anchor} ${pain || workflow || 'workflow problems'}`,
              `${domain || anchor} practitioner workflow challenges`,
            ];
      }

      if (sourceKey === 'product-hunt') {
        return [
          `${anchor} ${workflow || 'workflow'} tool`,
          `${domain || anchor} operations workflow`,
        ];
      }

      if (sourceKey === 'crossref') {
        return [
          `${anchor} ${workflow || 'workflow'} challenges study`,
          `${anchor} ${pain || 'operational challenges'}`,
          `${domain || anchor} ${workflow || 'management'} research`,
        ];
      }

      if (sourceKey === 'news' || sourceKey === 'gdelt') {
        return [
          `${anchor} ${pain || 'operational problems'}`,
          `${domain || anchor} ${workflow || 'operations'} failures`,
          `${anchor} ${pain || 'inefficiency'} report`,
        ];
      }

      if (sourceKey === 'youtube' || sourceKey === 'blog') {
        return [
          `${anchor} ${workflow || 'workflow'} problems`,
          `${anchor} ${pain || 'practitioner challenges'}`,
          `${domain || anchor} ${workflow || 'practice'} experience`,
        ];
      }

      // Reddit/forums benefit from direct problem/friction wording while still
      // keeping the planner's exact query available as the strongest lane.
      return [
        `${anchor} ${pain || 'problems'}`,
        `${anchor} ${workflow || 'workflow'} frustrations`,
        `${domain || anchor} practitioner issues`,
      ];
    })();

    const broadVariants = [
      `${domain || anchor} ${workflow || 'workflow'}`,
      `${anchor} ${pain || 'challenges'}`,
      `${domain || anchor} ${pain || 'operational issues'}`,
    ];

    const transformed = this.unique([...supportingVariants, ...broadVariants])
      .map((query) => this.sanitize(query))
      .filter((query) => this.isSafe(query));

    const orderedCandidates: string[] = [];
    if (input.preserveBaseQueries) {
      // Interleave instead of appending every base query first. This guarantees
      // that a PRIMARY budget of three normally contains: strong planner query,
      // supporting source-shaped query, then another planner/broad query.
      const span = Math.max(baseQueries.length, transformed.length);
      for (let index = 0; index < span; index += 1) {
        if (baseQueries[index]) orderedCandidates.push(baseQueries[index]);
        if (transformed[index]) orderedCandidates.push(transformed[index]);
      }
    } else {
      orderedCandidates.push(...transformed, ...baseQueries);
    }

    return this.unique(orderedCandidates)
      .map((query) => this.sanitize(query))
      .filter((query) => this.isSafe(query))
      .filter((query) => query.length >= 8 && query.length <= 140)
      .slice(0, maxQueries);
  }

  static isSafe(query: string): boolean {
    const normalized = this.sanitize(query);
    if (!normalized || normalized.length > 140) return false;
    return !this.forbiddenInternalLabels.some((pattern) => pattern.test(normalized));
  }

  private static isTechnicalRequest(input: {
    readonly requestDescription?: string | null;
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
  }): boolean {
    const text = [
      input.requestDescription ?? '',
      input.problemProfile?.actor ?? '',
      input.problemProfile?.object ?? '',
      input.problemProfile?.workflow ?? '',
      input.problemProfile?.friction ?? '',
      ...(input.problemProfile?.failureModes ?? []),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return /\b(?:api|sdk|repository|github|source code|programming|developer|deployment|server|database|docker|kubernetes|container|runtime|library|dependency|integration error|http|endpoint|webhook|firmware|software engineering)\b/u.test(
      text,
    );
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

  private static buildWorkflowAnchor(input: {
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
  }): string {
    return this.compactNouns(input.problemProfile?.workflow ?? '', 5);
  }

  private static buildPainAnchor(input: {
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
  }): string {
    const profile = input.problemProfile;
    return this.compactNouns(
      profile?.friction ||
        profile?.failureModes?.[0] ||
        profile?.consequences?.[0] ||
        '',
      6,
    );
  }

  private static compactNouns(value: string, maxTokens: number): string {
    const stop = new Set([
      'the',
      'and',
      'for',
      'with',
      'from',
      'into',
      'while',
      'often',
      'struggle',
      'struggles',
      'information',
      'frequently',
      'through',
      'across',
      'their',
      'each',
      'this',
      'that',
      'making',
      'difficult',
      'used',
      'using',
      'manage',
      'managing',
      'large',
      'amounts',
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
