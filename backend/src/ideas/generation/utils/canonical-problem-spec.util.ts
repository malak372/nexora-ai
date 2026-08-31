import type { SelectedGenerationDomain } from '../types/idea-generation-context.type';
import type {
  IdeaGenerationCanonicalProblemSpec,
  IdeaGenerationProblemFacet,
  IdeaGenerationProblemFacetType,
  IdeaGenerationRequestMode,
} from '../types/canonical-problem-spec.type';
import type { RequestCollectionPlan } from '../types/request-collection-plan.type';
import { RequestDynamicQueryUtil } from './request-dynamic-query.util';

export class CanonicalProblemSpecUtil {
  static resolveRequestMode(input: {
    readonly description?: string | null;
    readonly requestedDomainIds?: readonly string[];
  }): IdeaGenerationRequestMode {
    const hasText = Boolean(input.description?.trim());
    const hasDomains = (input.requestedDomainIds?.length ?? 0) > 0;
    if (hasText && hasDomains) return 'TEXT_AND_DOMAINS';
    if (hasText) return 'TEXT_ONLY';
    if (hasDomains) return 'DOMAINS_ONLY';
    return 'NO_INPUT';
  }

  static build(input: {
    readonly mode: IdeaGenerationRequestMode;
    readonly description?: string | null;
    readonly collectionPlan?: RequestCollectionPlan | null;
    readonly selectedDomains: readonly SelectedGenerationDomain[];
    readonly requestedDomainIds?: readonly string[];
  }): IdeaGenerationCanonicalProblemSpec {
    const requestIntent = input.collectionPlan?.requestIntent;
    const requesterProblemHypothesis =
      (requestIntent?.mode === 'EXPLICIT_PROBLEM_DISCOVERY' ||
        requestIntent?.mode === 'EXPLICIT_PROBLEM') &&
      Boolean(requestIntent.explicitProblem?.trim());
    const textBearingRequest =
      input.mode === 'TEXT_ONLY' || input.mode === 'TEXT_AND_DOMAINS';
    const profile = textBearingRequest
      ? input.collectionPlan?.problemProfile
      : undefined;
    const identity = input.collectionPlan?.domainIdentity;
    const description = this.clean(input.description ?? '');
    const problemText = this.clean([
      requesterProblemHypothesis
        ? requestIntent?.explicitProblem ?? ''
        : textBearingRequest
          ? description
          : '',
      profile?.friction ?? '',
      ...(profile?.failureModes ?? []),
      ...(profile?.consequences ?? []),
    ].join('. '));

    const actor = this.firstNonEmpty(profile?.actor, identity?.actor);
    const object = this.firstNonEmpty(profile?.object, identity?.object);
    const workflow = this.firstNonEmpty(profile?.workflow, identity?.workflow);
    const friction = textBearingRequest
      ? this.firstNonEmpty(
          profile?.friction,
          profile?.failureModes?.[0],
          identity?.failure,
          requesterProblemHypothesis ? requestIntent?.explicitProblem : undefined,
          RequestDynamicQueryUtil.extractPainTerms(problemText || description)
            .find((value) => this.isMaterialProblemFacet(value)),
        )
      : '';
    const failureModes = textBearingRequest
      ? this.unique([
          ...(profile?.failureModes ?? []),
          ...(identity?.failure ? [identity.failure] : []),
          ...(friction ? [friction] : []),
          ...RequestDynamicQueryUtil.extractPainTerms(problemText || description)
            .filter((value) => this.isMaterialProblemFacet(value)),
        ]).slice(0, 10)
      : [];
    const consequences = textBearingRequest
      ? this.unique(profile?.consequences ?? []).slice(0, 8)
      : [];

    const facets: IdeaGenerationProblemFacet[] = [];
    const counters = new Map<IdeaGenerationProblemFacetType, number>();
    const addFacet = (
      type: IdeaGenerationProblemFacetType,
      statement: string | null | undefined,
    ): void => {
      const value = this.clean(statement ?? '');
      if (!value || !this.isMaterialProblemFacet(value)) return;
      const key = value.toLocaleLowerCase();
      if (facets.some((facet) => facet.statement.toLocaleLowerCase() === key)) {
        return;
      }
      const next = (counters.get(type) ?? 0) + 1;
      counters.set(type, next);
      facets.push({
        id: `${type.toLocaleLowerCase()}-${next}`,
        type,
        statement: value,
      });
    };

    if (textBearingRequest) {
      const canonicalFacetText = problemText || description;
      const dynamicWorkflowFacets = RequestDynamicQueryUtil.extractWorkflowTerms(
        canonicalFacetText,
      ).filter((value) => this.isMaterialProblemFacet(value));
      const dynamicPainFacets = RequestDynamicQueryUtil.extractPainTerms(
        canonicalFacetText,
      ).filter((value) => this.isMaterialProblemFacet(value));

      /*
       * Problem-bearing facets intentionally come before generic workflow
       * nouns. The canonical facet list is bounded, so scheduling/delay/risk/
       * data-gap evidence must never be crowded out by many workflow phrases.
       */
      if (friction) addFacet(this.classifyFacetType(friction, 'FAILURE'), friction);
      for (const value of failureModes) {
        addFacet(this.classifyFacetType(value, 'FAILURE'), value);
      }
      for (const value of dynamicPainFacets) {
        addFacet(this.classifyFacetType(value, 'FAILURE'), value);
      }
      for (const value of profile?.evidenceFacets ?? []) {
        addFacet(this.classifyFacetType(value, 'FAILURE'), value);
      }
      for (const value of consequences) {
        addFacet(this.classifyFacetType(value, 'CONSEQUENCE'), value);
      }

      if (workflow) addFacet('WORKFLOW', workflow);
      for (const value of dynamicWorkflowFacets.slice(0, 8)) {
        addFacet(this.classifyFacetType(value, 'WORKFLOW'), value);
      }
    } else if (workflow) {
      addFacet('WORKFLOW', workflow);
    }

    const explicitDomainIds = this.unique(input.requestedDomainIds ?? []);
    const inferredDomainId =
      explicitDomainIds.length === 0 ? input.selectedDomains[0]?.id ?? null : null;

    return {
      mode: input.mode,
      actor:
        actor ||
        (description && input.mode.startsWith('TEXT_')
          ? this.inferActor(description)
          : null),
      actorAliases: this.unique(
        profile?.actorAliases ?? (actor ? [actor] : []),
      ).slice(0, 10),
      object: object || null,
      objectAliases: this.unique(
        profile?.objectAliases ?? (object ? [object] : []),
      ).slice(0, 12),
      workflow: workflow || null,
      friction: friction || null,
      failureModes,
      consequences,
      facets: facets.slice(0, 18),
      explicitDomainIds,
      inferredDomainId,
    };
  }

  private static isMaterialProblemFacet(value: string): boolean {
    const normalized = this.clean(value);
    const words = normalized.split(/\s+/u).filter(Boolean);
    if (words.length < 2) return false;
    if (
      /\b(?:a smarter|smarter (?:system|platform|tool)|platform could|system could)\b|\bcould\s+(?:combine|track|detect|estimate|help|flag|organize|organise|prioritize|prioritise|provide|enable|allow)\b|\bhelp\s+[^.!?]{0,90}\b(?:adjust|prioritize|prioritise|manage|allocate)\b/iu.test(
        normalized,
      )
    ) {
      return false;
    }
    return !/^(?:reported )?(?:problem|issue|risk|delay|failure|workload|overtraining|fatigue)$/iu.test(
      normalized,
    );
  }

  private static classifyFacetType(
    value: string,
    fallback: IdeaGenerationProblemFacetType,
  ): IdeaGenerationProblemFacetType {
    const normalized = value.toLocaleLowerCase();
    if (
      /fragment|scatter|silo|separate|disconnected|data gap|information gap|missing data|incomplete data/u.test(
        normalized,
      )
    ) {
      return 'DATA_GAP';
    }
    if (/delay|late|waiting|deadline|turnaround|backlog|promised pickup|pickup (?:time|times|deadline)/u.test(normalized)) {
      return 'DELAY';
    }
    if (/risk|injur|safety|harm|overtrain|fatigue|threat/u.test(normalized)) {
      return 'RISK';
    }
    if (/cost|fuel|waste|expense|charge|refund|overrun/u.test(normalized)) {
      return 'COST';
    }
    if (/rework|repeat|redo|remake|duplicat/u.test(normalized)) {
      return 'REWORK';
    }
    if (/access|unauthor|permission|account|login|authenticat/u.test(normalized)) {
      return 'ACCESS';
    }
    if (/coordinat|handoff|repriorit|schedule|assign|workload|booking/u.test(normalized)) {
      return 'COORDINATION';
    }
    if (/visib|detect|identify|understand|monitor|recogniz|recognis/u.test(normalized)) {
      return 'VISIBILITY';
    }
    if (/decid|priorit|adjust|allocate|plan|estimate/u.test(normalized)) {
      return 'DECISION';
    }
    return fallback;
  }

  private static inferActor(description: string): string | null {
    const first = description.split(/[.!?]/u)[0]?.trim() ?? '';
    const match = first.match(
      /^(.{3,120}?)\s+(?:often\s+)?(?:struggle|struggles|face|faces|find|finds|have|has)\b/iu,
    );
    return this.clean(match?.[1] ?? '') || null;
  }

  private static firstNonEmpty(...values: Array<string | null | undefined>): string {
    for (const value of values) {
      const normalized = this.clean(value ?? '');
      if (normalized) return normalized;
    }
    return '';
  }

  private static clean(value: string): string {
    return value.replace(/\s+/gu, ' ').trim();
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of values) {
      const value = this.clean(raw);
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }
}
