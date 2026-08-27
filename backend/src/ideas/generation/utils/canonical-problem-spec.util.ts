import type { SelectedGenerationDomain } from '../types/idea-generation-context.type';
import type {
  IdeaGenerationCanonicalProblemSpec,
  IdeaGenerationProblemFacet,
  IdeaGenerationProblemFacetType,
  IdeaGenerationRequestMode,
} from '../types/canonical-problem-spec.type';
import type { RequestCollectionPlan } from '../types/request-collection-plan.type';

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
    const hasExplicitProblem = requestIntent?.mode === 'EXPLICIT_PROBLEM' &&
      Boolean(requestIntent.explicitProblem?.trim());
    const profile = hasExplicitProblem ? input.collectionPlan?.problemProfile : undefined;
    const identity = input.collectionPlan?.domainIdentity;
    const description = this.clean(input.description ?? '');

    const actor = this.firstNonEmpty(profile?.actor, identity?.actor);
    const object = this.firstNonEmpty(profile?.object, identity?.object);
    const workflow = this.firstNonEmpty(profile?.workflow, identity?.workflow);
    const friction = hasExplicitProblem
      ? this.firstNonEmpty(
          profile?.friction,
          profile?.failureModes?.[0],
          identity?.failure,
        )
      : '';
    const failureModes = this.unique([
      ...(profile?.failureModes ?? []),
      ...(friction ? [friction] : []),
    ]).slice(0, 6);
    const consequences = hasExplicitProblem
      ? this.unique(profile?.consequences ?? []).slice(0, 8)
      : [];

    const facets: IdeaGenerationProblemFacet[] = [];
    const addFacet = (
      type: IdeaGenerationProblemFacetType,
      statement: string | null | undefined,
      index: number,
    ): void => {
      const value = this.clean(statement ?? '');
      if (!value) return;
      if (facets.some((facet) => facet.statement.toLocaleLowerCase() === value.toLocaleLowerCase())) {
        return;
      }
      facets.push({
        id: `${type.toLocaleLowerCase()}-${index + 1}`,
        type,
        statement: value,
      });
    };

    addFacet('WORKFLOW', workflow, 0);
    addFacet('FAILURE', friction, 0);
    failureModes.forEach((value, index) => addFacet('FAILURE', value, index + 1));
    consequences.forEach((value, index) => {
      const normalized = value.toLocaleLowerCase();
      const type: IdeaGenerationProblemFacetType = /delay|late|waiting|response time/u.test(normalized)
        ? 'DELAY'
        : /cost|fuel|waste|expense|charge|refund/u.test(normalized)
          ? 'COST'
          : /rework|repeat|redo|remake/u.test(normalized)
            ? 'REWORK'
            : /access|unauthor|permission|account/u.test(normalized)
              ? 'ACCESS'
              : /coordinat|handoff|repriorit|schedule/u.test(normalized)
                ? 'COORDINATION'
                : 'CONSEQUENCE';
      addFacet(type, value, index);
    });

    const explicitDomainIds = this.unique(input.requestedDomainIds ?? []);
    const inferredDomainId = explicitDomainIds.length === 0
      ? input.selectedDomains[0]?.id ?? null
      : null;

    return {
      mode: input.mode,
      actor: actor || (description && input.mode.startsWith('TEXT_') ? this.inferActor(description) : null),
      actorAliases: this.unique(profile?.actorAliases ?? (actor ? [actor] : [])).slice(0, 10),
      object: object || null,
      objectAliases: this.unique(profile?.objectAliases ?? (object ? [object] : [])).slice(0, 12),
      workflow: workflow || null,
      friction: friction || null,
      failureModes,
      consequences,
      facets: facets.slice(0, 14),
      explicitDomainIds,
      inferredDomainId,
    };
  }

  private static inferActor(description: string): string | null {
    const first = description.split(/[.!?]/u)[0]?.trim() ?? '';
    const match = first.match(/^(.{3,120}?)\s+(?:often\s+)?(?:struggle|struggles|face|faces|find|finds|have|has)\b/iu);
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
