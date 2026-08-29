import { Injectable } from '@nestjs/common';

import { CollectorSourceHealthService } from '../../../../data-collection/collector-source-health.service';
import { CollectorsFactory } from '../../../../collectors/collectors.factory';
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
      const sourcePlan = context.collectionPlan?.sourcePlans?.find(
        (plan) => plan.sourceKey.toLocaleLowerCase() === normalized,
      );
      const capabilityInput = {
        requestDescription: context.requestDescription,
        domainName: context.domainName,
        keywords: context.keywords,
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
     * DIRECT_PROBLEM evidence is usually found in user/practitioner comments,
     * not publisher metadata. Keep at least two healthy comment-capable lanes
     * whenever the installed source set supports them. They still pass the
     * normal request-capability guard, so this does not force app stores or
     * developer communities into unrelated workflows.
     */
    const desiredCommentLanes = 2;
    if (
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
      Math.max(1, plannerKeys.length > 0 ? plannerKeys.length + 1 : 1),
    );
    if (plannerKeys.length > 0 && selected.length < targetAutomaticCount) {
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
    const requestFit = this.collectorsFactory.getCollectorRequestFitScore(
      source.key,
      {
        requestDescription: context.requestDescription,
        domainName: context.domainName,
        keywords: context.keywords,
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
