import { Injectable } from '@nestjs/common';

import { CollectorSourceHealthService } from '../../../../data-collection/collector-source-health.service';
import { CollectorsFactory } from '../../../../collectors/collectors.factory';
import { CollectorRequestCapabilityUtil } from '../../../../collectors/base/collector-request-capability.util';
import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import { IdeaGenerationSelectionService } from '../../services/idea-generation-selection.service';
import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';
import { mergeGenerationStringArrays } from '../../utils/idea-generation-normalizer.util';
import { RequestWorkflowSourcePolicyUtil } from '../../utils/request-workflow-source-policy.util';

@Injectable()
export class DataSourceSelectionStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.DATA_SOURCE_SELECTION;
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly selectionService: IdeaGenerationSelectionService,
    private readonly collectorSourceHealth: CollectorSourceHealthService,
    private readonly collectorsFactory: CollectorsFactory,
  ) {}

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    const selection = await this.selectionService.resolveSelection({
      domainId: context.domainId,
    });

    const currentSelectedDomains = Array.isArray(context.selectedDomains)
      ? context.selectedDomains
      : [];

    const selectedDomains = currentSelectedDomains.length > 0
      ? currentSelectedDomains.map((domain) => {
          const configuredKeywords =
            domain.id === selection.domain.id && Array.isArray(selection.domain.keywords)
              ? selection.domain.keywords.slice(0, 12)
              : Array.isArray(domain.configuredKeywords)
                ? domain.configuredKeywords.slice(0, 12)
                : [];
          const requestIntentKeywords = Array.isArray(domain.requestIntentKeywords)
            ? domain.requestIntentKeywords.slice(0, 12)
            : [];
          const existingEffective = Array.isArray(domain.effectiveSearchKeywords)
            ? domain.effectiveSearchKeywords
            : Array.isArray(domain.keywords)
              ? domain.keywords
              : [];
          const effectiveSearchKeywords = mergeGenerationStringArrays(
            [requestIntentKeywords, existingEffective, [domain.name], configuredKeywords],
            { lowercase: true, maxItems: 18, maxItemLength: 120 },
          );
          return {
            ...domain,
            name: domain.id === selection.domain.id ? selection.domain.name : domain.name,
            keywords: effectiveSearchKeywords,
            configuredKeywords,
            effectiveSearchKeywords,
          };
        })
      : [
          {
            id: selection.domain.id,
            name: selection.domain.name,
            keywords: selection.domain.keywords.slice(0, 12),
            configuredKeywords: selection.domain.keywords.slice(0, 12),
            effectiveSearchKeywords: selection.domain.keywords.slice(0, 12),
          },
        ];

    const mergedKeywords = mergeGenerationStringArrays(
      [
        Array.isArray(context.keywords) ? context.keywords : [],
        ...selectedDomains.map((domain) => [
          domain.name,
          ...(domain.effectiveSearchKeywords ?? domain.keywords ?? []),
        ]),
      ],
      { lowercase: true, maxItems: 48, maxItemLength: 120 },
    );

    const selectedDataSources = this.selectPlannedDataSources(
      selection.dataSources,
      context,
    );

    /*
     * Data-source lookup is keyed by the semantic primary domain resolved in
     * PREPARING, but it must never become another domain-resolution authority.
     * Preserve that primary identity explicitly so later collection reuse or
     * source metadata cannot move a Text+Domains request back to the first UI
     * domain merely because that domain appears first in the selected set.
     */
    const semanticPrimaryDomain =
      selectedDomains.find((domain) => domain.id === context.domainId) ?? null;
    const semanticPrimaryDomainId = semanticPrimaryDomain?.id ?? context.domainId;
    const semanticPrimaryDomainName =
      semanticPrimaryDomain?.name ?? context.domainName ?? selection.domain.name;

    const updatedContext: IdeaGenerationContext = {
      ...context,
      domainId: semanticPrimaryDomainId,
      domainName: semanticPrimaryDomainName,
      selectedDomains,
      keywords: mergedKeywords,
      selectedDataSources,
    };

    return {
      context: updatedContext,
      resultPreview: `Selected ${selectedDataSources.length} data source(s) for domain "${semanticPrimaryDomainName}"${context.collectionPlan ? ' using the pre-collection AI plan' : ''}.`,
      metadata: {
        domainId: semanticPrimaryDomainId,
        domainName: semanticPrimaryDomainName,
        selectedDataSourceKeys: selectedDataSources.map((dataSource) => dataSource.key),
        selectedDataSourcesCount: selectedDataSources.length,
        collectionPlanSourceFocus: context.collectionPlan?.sourceFocus ?? [],
        mergedKeywordsCount: mergedKeywords.length,
        selectedDomains: selectedDomains.map(({ id, name }) => ({ id, name })),
        domainResolution: context.domainResolution,
      },
    };
  }

  private selectPlannedDataSources<
    T extends { readonly key: string; readonly supportsComments?: boolean },
  >(
    dataSources: readonly T[],
    context: IdeaGenerationContext,
  ): T[] {
    const byKey = new Map(
      dataSources.map((source) => [source.key.toLocaleLowerCase(), source] as const),
    );
    const explicitKeys = this.uniqueKeys(context.requestedDataSourceKeys ?? []);
    const plannerKeys = this.uniqueKeys([
      ...(context.collectionPlan?.selectedSourceKeys ?? []),
      ...(context.collectionPlan?.sourcePlans ?? []).map((plan) => plan.sourceKey),
    ]);
    const maxAutomatic = 9;
    const textOnlyRequest = context.requestMode === 'TEXT_ONLY';
    const textAndDomainsRequest = context.requestMode === 'TEXT_AND_DOMAINS';
    const requestedAutomaticTarget = textOnlyRequest
      ? 7
      : textAndDomainsRequest
        ? 8
        : Math.max(1, plannerKeys.length);

    const selected: T[] = [];
    const selectedKeys = new Set<string>();
    const add = (key: string, allowDegraded: boolean): void => {
      if (selected.length >= Math.max(maxAutomatic, explicitKeys.length)) return;
      const normalized = key.toLocaleLowerCase();
      if (selectedKeys.has(normalized)) return;
      const source = byKey.get(normalized);
      if (!source) return;
      if (!allowDegraded && !this.collectorSourceHealth.isHealthy(source.key)) {
        return;
      }
      const explicitlyRequested = explicitKeys.includes(normalized);
      if (
        !explicitlyRequested &&
        RequestWorkflowSourcePolicyUtil.shouldSuppressAppReviewLanes({
          requestDescription: context.requestDescription,
          problemProfile: context.collectionPlan?.problemProfile,
        }) &&
        RequestWorkflowSourcePolicyUtil.isAppReviewSource(normalized)
      ) {
        return;
      }
      if (
        !explicitlyRequested &&
        RequestWorkflowSourcePolicyUtil.shouldSuppressDeveloperCommunityLanes({
          requestDescription: context.requestDescription,
          problemProfile: context.collectionPlan?.problemProfile,
        }) &&
        RequestWorkflowSourcePolicyUtil.isDeveloperCommunitySource(normalized)
      ) {
        return;
      }
      const sourcePlan = context.collectionPlan?.sourcePlans?.find(
        (plan) => plan.sourceKey.toLocaleLowerCase() === normalized,
      );
      const problemOwnedKeywords = context.collectionPlan?.problemProfile
        ? [
            context.collectionPlan.problemProfile.actor,
            context.collectionPlan.problemProfile.object,
            context.collectionPlan.problemProfile.workflow,
            context.collectionPlan.problemProfile.friction ?? '',
            ...context.collectionPlan.problemProfile.failureModes,
            ...context.collectionPlan.problemProfile.consequences,
          ]
        : context.collectionPlan?.intentConcepts ?? [];
      const capabilityInput = {
        requestDescription: context.requestDescription,
        domainName: context.requestDescription?.trim() ? undefined : context.domainName,
        keywords: problemOwnedKeywords,
        plannedQueries: sourcePlan?.queries ?? context.collectionPlan?.searchQueries ?? [],
        sourceHints: sourcePlan?.routingHints ?? [],
        collectionMode: 'FAST_GENERATION' as const,
      };
      const plannerOwned = plannerKeys.includes(normalized);
      const routeExecutable = this.collectorsFactory.isCollectorRouteExecutable(
        source.key,
        capabilityInput,
      );
      const requestFitScore = this.collectorsFactory.getCollectorRequestFitScore(
        source.key,
        capabilityInput,
      );
      /*
       * Planner ownership is a positive semantic signal, not permission to use
       * a clearly incompatible corpus. Keep a slightly lower floor for an
       * explicitly AI-selected source so specialist lanes remain possible, but
       * reject developer/app-review routes whose generic workflow capability is
       * far below the request anchor. This prevents generated query wording
       * such as "software scheduling" from turning an operational request into
       * a GitHub/StackOverflow recovery path.
       */
      const requestAvailable = plannerOwned
        ? routeExecutable && requestFitScore >= 0.34
        : this.collectorsFactory.isCollectorRequestAvailable(
            source.key,
            capabilityInput,
          );
      if (!requestAvailable) return;
      selected.push(source);
      selectedKeys.add(normalized);
    };

    explicitKeys.forEach((key) => add(key, true));
    plannerKeys.forEach((key) => add(key, false));

    /*
     * TEXT_ONLY operational requests need at least one research/technical lane
     * in the actual executable portfolio, not only in the PREPARING plan. The
     * source still passes the same request-fit, health and downstream semantic
     * evidence gates.
     */
    if (
      textOnlyRequest &&
      context.collectionPlan?.domainIdentity?.workflow?.trim() &&
      context.collectionPlan?.domainIdentity?.failure?.trim()
    ) {
      add('crossref', false);
    }

    const plannedAutomaticTarget = Math.min(
      maxAutomatic,
      Math.max(plannerKeys.length, requestedAutomaticTarget),
    );
    const missingPlannerKeys = plannerKeys.filter((key) => !selectedKeys.has(key));

    if (missingPlannerKeys.length > 0 && selected.length < plannedAutomaticTarget) {
      const missingArchetypes = missingPlannerKeys
        .map((key) => CollectorRequestCapabilityUtil.sourceArchetype(key))
        .filter((archetype) => archetype !== 'OTHER');

      for (const archetype of missingArchetypes) {
        if (selected.length >= plannedAutomaticTarget) break;

        const substitute = [...dataSources]
          .filter(
            (source) =>
              !selectedKeys.has(source.key.toLocaleLowerCase()) &&
              CollectorRequestCapabilityUtil.sourceArchetype(source.key) === archetype,
          )
          .sort(
            (left, right) =>
              this.scoreAutomaticSource(context, right) -
                this.scoreAutomaticSource(context, left) ||
              left.key.localeCompare(right.key),
          )
          .find((source) => {
            const before = selected.length;
            add(source.key, false);
            return selected.length > before;
          });

        if (!substitute) continue;
      }
    }

    const missingPlannerLaneCount = Math.max(
      0,
      plannedAutomaticTarget - selected.length,
    );

    /*
     * DIRECT_PROBLEM evidence is usually found in user/practitioner comments,
     * not publisher metadata. Keep at least two healthy comment-capable lanes
     * whenever no AI plan exists. When an AI plan exists it owns the portfolio;
     * runtime comment-lane supplementation is allowed only to replace a planned
     * lane that was vetoed by health/capability/policy, never to expand a fully
     * executable AI portfolio.
     */
    const discoveryMode = !context.requestDescription?.trim();
    const desiredCommentLanes = discoveryMode ? 3 : 2;
    if (
      (plannerKeys.length === 0 || missingPlannerLaneCount > 0) &&
      selected.filter((source) => source.supportsComments === true).length <
      desiredCommentLanes
    ) {
      [...dataSources]
        .filter((source) => source.supportsComments === true)
        .sort(
          (left, right) =>
            this.scoreAutomaticSource(context, right) -
              this.scoreAutomaticSource(context, left) ||
            left.key.localeCompare(right.key),
        )
        .forEach((source) => {
          if (
            selected.filter((item) => item.supportsComments === true).length <
            desiredCommentLanes
          ) {
            add(source.key, false);
          }
        });
    }

    /*
     * Keep the AI plan authoritative, but reserve one extra healthy/capable
     * lane when possible. Bounded text runs often lose one planned source to a
     * transient 429 or a niche-zero result; one parallel reserve source raises
     * retrieval recall without creating a serial recovery wave.
     */
    const targetAutomaticCount = Math.min(
      maxAutomatic,
      Math.max(
        requestedAutomaticTarget,
        plannerKeys.length > 0 ? plannerKeys.length : 1,
      ),
    );
    if (
      (plannerKeys.length > 0 || textOnlyRequest || textAndDomainsRequest) &&
      selected.length < targetAutomaticCount
    ) {
      [...dataSources]
        .sort(
          (left, right) =>
            this.scoreAutomaticSource(context, right) -
              this.scoreAutomaticSource(context, left) ||
            left.key.localeCompare(right.key),
        )
        .forEach((source) => {
          if (selected.length < targetAutomaticCount) add(source.key, false);
        });
    }

    if (plannerKeys.length === 0) {
      [...dataSources]
        .sort(
          (left, right) =>
            this.scoreAutomaticSource(context, right) -
              this.scoreAutomaticSource(context, left) ||
            left.key.localeCompare(right.key),
        )
        .forEach((source) => add(source.key, false));
    }

    if (selected.length === 0) {
      const fallback = [...dataSources]
        .sort(
          (left, right) =>
            this.scoreAutomaticSource(context, right) -
              this.scoreAutomaticSource(context, left) ||
            left.key.localeCompare(right.key),
        )[0];
      if (fallback) selected.push(fallback);
    }

    return selected;
  }

  private scoreAutomaticSource(
    context: IdeaGenerationContext,
    source: { readonly key: string; readonly supportsComments?: boolean },
  ): number {
    const sourcePlan = context.collectionPlan?.sourcePlans?.find(
      (plan) =>
        plan.sourceKey.toLocaleLowerCase() === source.key.toLocaleLowerCase(),
    );
    const problemOwnedKeywords = context.collectionPlan?.problemProfile
      ? [
          context.collectionPlan.problemProfile.actor,
          context.collectionPlan.problemProfile.object,
          context.collectionPlan.problemProfile.workflow,
          context.collectionPlan.problemProfile.friction ?? '',
          ...context.collectionPlan.problemProfile.failureModes,
          ...context.collectionPlan.problemProfile.consequences,
        ]
      : context.collectionPlan?.intentConcepts ?? [];
    const requestFit = this.collectorsFactory.getCollectorRequestFitScore(
      source.key,
      {
        requestDescription: context.requestDescription,
        domainName: context.requestDescription?.trim() ? undefined : context.domainName,
        keywords: problemOwnedKeywords,
        plannedQueries:
          sourcePlan?.queries ?? context.collectionPlan?.searchQueries ?? [],
        sourceHints: sourcePlan?.routingHints ?? [],
        collectionMode: 'FAST_GENERATION',
      },
    );
    const health = Math.max(
      0,
      Math.min(1, this.collectorSourceHealth.score(source.key) / 1.25),
    );
    const directDiscussionBonus = source.supportsComments === true ? 0.07 : 0;
    return requestFit * 0.78 + health * 0.15 + directDiscussionBonus;
  }

  private uniqueKeys(keys: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of keys) {
      const key = raw.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(key);
    }
    return output;
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);
    if (!definition) {
      throw new Error(`Missing idea-generation stage definition for "${this.key}".`);
    }
    return definition;
  }
}
