import { CanonicalRequestUnderstandingUtil } from '../../ideas/generation/utils/canonical-request-understanding.util';
import { RequestQueryProvenanceUtil } from '../../ideas/generation/utils/request-query-provenance.util';
import { RequestReviewStoreQueryUtil } from '../../ideas/generation/utils/request-review-store-query.util';
import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';
import type { RequestCanonicalProblemProfile } from '../../ideas/generation/types/request-collection-plan.type';

export type ProblemFirstCollectorQueryInput = {
  readonly sourceKey: string;
  readonly domainName?: string | null;
  readonly requestDescription?: string | null;
  readonly plannedQueries?: readonly string[];
  readonly keywords?: readonly string[];
  readonly authoritativePlannedQueries?: boolean;
};

/**
 * Builds source-ready evidence queries from the canonical requester profile.
 *
 * The previous implementation contained thousands of lines of named vertical
 * branches (farm energy, custom crafts, restaurants, healthcare, etc.). Those
 * branches made retrieval depend on whether a request happened to match a
 * hand-written scenario. This implementation keeps the same public API but
 * derives every non-store query from the request actor/object/workflow,
 * failures, consequences, AI-planned seeds, and selected domain vocabulary.
 *
 * App stores remain a separate discovery surface because they search product
 * names rather than web evidence; RequestReviewStoreQueryUtil only determines
 * comparable app-search phrases. Review text is still the evidence.
 */
export class ProblemFirstCollectorQueryUtil {
  static build(input: ProblemFirstCollectorQueryInput): string[] {
    const sourceKey = this.normalize(input.sourceKey);
    const description = this.cleanText(input.requestDescription ?? '');
    const domainName = this.cleanText(input.domainName ?? '');
    const planned = this.unique(
      (input.plannedQueries ?? []).map((value) => this.cleanQuery(value)),
    );
    const maxQueries = this.resolveMaxQueries(sourceKey);

    if (input.authoritativePlannedQueries && planned.length > 0) {
      return this.compileQueries({
        sourceKey,
        description,
        queries: planned,
        maxQueries,
      });
    }

    const groundedPlanned = description
      ? planned.filter((query) =>
          RequestQueryProvenanceUtil.isQueryGrounded({
            requestDescription: description,
            query,
          }),
        )
      : planned;

    if ((sourceKey === 'app-store' || sourceKey === 'google-play') && description) {
      return RequestReviewStoreQueryUtil.build({
        requestDescription: description,
        domainName,
        plannedQueries: groundedPlanned,
        maxQueries: Math.min(4, maxQueries),
      });
    }

    if (!description) {
      return this.compileQueries({
        sourceKey,
        description: '',
        queries: [
          ...groundedPlanned,
          ...this.buildDomainDiscoveryQueries(domainName, input.keywords ?? []),
        ],
        maxQueries,
      });
    }

    const profile = CanonicalRequestUnderstandingUtil.resolve(description);
    const requestDerived = this.buildCanonicalRequestQueries(profile);
    const hasRichAiPlan = groundedPlanned.length >= 4;
    const candidates = hasRichAiPlan
      ? this.interleave([
          groundedPlanned.slice(0, 4),
          requestDerived,
          groundedPlanned.slice(4),
        ])
      : this.interleave([
          requestDerived,
          groundedPlanned,
        ]);

    return this.compileQueries({
      sourceKey,
      description,
      queries: candidates,
      maxQueries,
    });
  }

  /**
   * Builds one broader second wave without changing the request identity.
   * Used only after a request-scoped first pass returned too little material.
   */
  static buildProgressiveFallback(
    input: ProblemFirstCollectorQueryInput,
  ): string[] {
    const sourceKey = this.normalize(input.sourceKey);
    const description = this.cleanText(input.requestDescription ?? '');
    if (!description || input.authoritativePlannedQueries) return [];

    const profile = CanonicalRequestUnderstandingUtil.resolve(description);
    const aliases = this.unique([
      profile.actor,
      ...(profile.actorAliases ?? []),
      profile.object,
      ...(profile.objectAliases ?? []),
    ]).map((value) => this.compact(value, 4));
    const workflows = this.unique([
      profile.workflow,
      profile.object,
      ...(profile.evidenceFacets ?? []),
    ]).map((value) => this.compact(value, 4));
    const pains = this.unique([
      profile.friction ?? '',
      ...profile.failureModes,
      ...profile.consequences,
    ]).map((value) => this.compact(value, 4));

    const variants: string[] = [];
    const add = (...parts: Array<string | undefined>) => {
      const query = this.cleanQuery(parts.filter(Boolean).join(' '));
      if (query.split(/\s+/u).length >= 3) variants.push(query);
    };

    for (let index = 0; index < 5; index += 1) {
      add(
        aliases[index % Math.max(1, aliases.length)] ?? '',
        workflows[index % Math.max(1, workflows.length)] ?? '',
        pains[index % Math.max(1, pains.length)] ?? '',
      );
    }

    const relaxedPlanned = (input.plannedQueries ?? [])
      .map((query) => this.relaxPlannedQuery(query, profile))
      .filter(Boolean);

    return this.compileQueries({
      sourceKey,
      description,
      queries: [...variants, ...relaxedPlanned],
      maxQueries: sourceKey === 'forum' ? 4 : 5,
    });
  }

  private static buildCanonicalRequestQueries(
    profile: RequestCanonicalProblemProfile,
  ): string[] {
    const actor = this.compact(profile.actor, 4);
    const actorAlias = this.compact(profile.actorAliases?.[1] ?? actor, 4);
    const object = this.compact(profile.object, 5);
    const objectAlias = this.compact(profile.objectAliases?.[1] ?? object, 4);
    const workflow = this.compact(profile.workflow, 5);
    const friction = this.compact(profile.friction ?? profile.coreProblem, 5);
    const failures = this.unique(profile.failureModes)
      .map((value) => this.compact(value, 5))
      .filter(Boolean);
    const consequences = this.unique(profile.consequences)
      .map((value) => this.compact(value, 4))
      .filter(Boolean);

    const queries: string[] = [];
    const add = (...parts: Array<string | undefined>) => {
      const query = this.cleanQuery(parts.filter(Boolean).join(' '));
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    add(actor, object, friction);
    add(actorAlias, workflow, failures[0] ?? friction);
    add(object, workflow, failures[1] ?? failures[0] ?? friction);
    add(actor, objectAlias, consequences[0] ?? failures[0] ?? friction);
    add(objectAlias, failures[0] ?? friction, consequences[1] ?? consequences[0]);
    add(actorAlias, failures[1] ?? failures[0], consequences[0]);
    add(object, failures[2] ?? failures[0], consequences[2] ?? consequences[0]);
    add(actor, workflow, consequences[0] ?? friction);

    // CanonicalRequestUnderstandingUtil is itself request-derived and provides
    // additional compact combinations without knowing a business vertical.
    return this.unique([
      ...queries,
      ...CanonicalRequestUnderstandingUtil.buildSearchQueries(profile, 8),
    ]);
  }

  private static buildDomainDiscoveryQueries(
    domainName: string,
    keywords: readonly string[],
  ): string[] {
    const domain = this.compact(domainName, 4);
    const keywordGroups = this.unique(keywords)
      .map((value) => this.compact(value, 3))
      .filter(Boolean)
      .slice(0, 5);
    const queries: string[] = [];
    const add = (...parts: string[]) => {
      const query = this.cleanQuery(parts.join(' '));
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    if (domain) {
      add(domain, 'recurring operational problems');
      add(domain, 'user complaints delays failures');
      add(domain, 'cost pressure service friction');
      add(domain, 'workflow inefficiency unmet needs');
    }
    for (const keyword of keywordGroups) {
      add(domain, keyword, 'problems complaints');
      add(domain, keyword, 'failures delays');
    }
    return this.unique(queries);
  }

  private static compileQueries(input: {
    readonly sourceKey: string;
    readonly description: string;
    readonly queries: readonly string[];
    readonly maxQueries: number;
  }): string[] {
    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: input.description,
      plannedQueries: input.queries,
    });
    const output: string[] = [];

    for (const rawQuery of input.queries) {
      let query = this.cleanQuery(rawQuery);
      if (!query) continue;

      if (input.description) {
        query = this.anchorQueryToRequest(query, input.description, constraint);
        if (
          !RequestQueryProvenanceUtil.isQueryGrounded({
            requestDescription: input.description,
            query,
          })
        ) {
          continue;
        }
      }

      query = this.shapeForSource(query, input.sourceKey);
      if (!query) continue;
      if (
        input.description &&
        constraint.strict &&
        !this.queryMatchesConstraint(query, constraint)
      ) {
        continue;
      }
      output.push(query);
      if (this.unique(output).length >= input.maxQueries) break;
    }

    return this.unique(output).slice(0, input.maxQueries);
  }

  private static anchorQueryToRequest(
    query: string,
    description: string,
    constraint: ReturnType<typeof RequestVerticalConstraintUtil.resolve>,
  ): string {
    if (!constraint.strict) return query;
    if (this.queryMatchesConstraint(query, constraint)) return query;

    const profile = CanonicalRequestUnderstandingUtil.resolve(description);
    const identity = this.compact(
      [profile.actor, profile.object].filter(Boolean).join(' '),
      5,
    );
    return this.cleanQuery(`${identity} ${query}`);
  }

  private static queryMatchesConstraint(
    query: string,
    constraint: ReturnType<typeof RequestVerticalConstraintUtil.resolve>,
  ): boolean {
    return (
      RequestVerticalConstraintUtil.matchesVertical(query, constraint) &&
      RequestVerticalConstraintUtil.matchesWorkflow(query, constraint)
    );
  }

  private static relaxPlannedQuery(
    value: string,
    profile: RequestCanonicalProblemProfile,
  ): string {
    const stopWords = new Set([
      'complaint', 'complaints', 'discussion', 'discussions', 'reports',
      'reported', 'examples', 'problem', 'problems', 'issue', 'issues',
      'about', 'regarding', 'related', 'evidence', 'validation',
    ]);
    const tokens = this.cleanQuery(value)
      .split(/\s+/u)
      .filter((token) => !stopWords.has(token.toLocaleLowerCase()))
      .slice(0, 6);
    const identity = this.compact(
      profile.actorAliases?.[1] ?? profile.actor ?? profile.object,
      3,
    );
    return this.cleanQuery(`${identity} ${tokens.join(' ')}`);
  }

  private static shapeForSource(value: string, sourceKey: string): string {
    const cleaned = this.cleanQuery(value)
      .replace(
        /\b(?:software solution|software platform|dashboard|application solution|our product|proposed solution)\b/giu,
        ' ',
      )
      .replace(/\s+/gu, ' ')
      .trim();
    const maxWords =
      sourceKey === 'forum' || sourceKey === 'reddit'
        ? 8
        : sourceKey === 'youtube'
          ? 9
          : sourceKey === 'crossref' || sourceKey === 'news' || sourceKey === 'gdelt'
            ? 10
            : 9;
    return cleaned.split(/\s+/u).slice(0, maxWords).join(' ');
  }

  private static resolveMaxQueries(sourceKey: string): number {
    if (sourceKey === 'forum') return 5;
    if (sourceKey === 'crossref') return 4;
    if (sourceKey === 'news' || sourceKey === 'gdelt') return 5;
    if (sourceKey === 'youtube') return 5;
    if (sourceKey === 'app-store' || sourceKey === 'google-play') return 4;
    return 6;
  }

  private static interleave(groups: readonly (readonly string[])[]): string[] {
    const result: string[] = [];
    const maxLength = Math.max(0, ...groups.map((group) => group.length));
    for (let index = 0; index < maxLength; index += 1) {
      for (const group of groups) {
        const value = group[index];
        if (value) result.push(value);
      }
    }
    return result;
  }

  private static compact(value: string, maxWords: number): string {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'from',
      'often', 'frequently', 'usually', 'commonly', 'making', 'it', 'is', 'are', 'was', 'were',
      'business', 'businesses', 'company', 'companies', 'information',
    ]);
    return this.cleanText(value)
      .split(/\s+/u)
      .filter((token) => token.length >= 2 && !stopWords.has(token.toLocaleLowerCase()))
      .slice(0, maxWords)
      .join(' ');
  }

  private static cleanQuery(value: string): string {
    return this.cleanText(value)
      .replace(/[|,;:]+/gu, ' ')
      .replace(/^[,;:.\-\s]+|[,;:.\-\s]+$/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static cleanText(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[\r\n\t]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static normalize(value: string): string {
    return this.cleanText(value).toLocaleLowerCase();
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of values) {
      const value = this.cleanQuery(raw);
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }
}
