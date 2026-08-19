import { Injectable } from '@nestjs/common';

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

/**
 * Resolves the active domain and data sources used by one
 * generation run.
 *
 * Responsibilities:
 * - Validate that the selected domain exists and is active.
 * - Load configured domain keywords.
 * - Select all active and implemented data sources automatically.
 * - Keep source coverage controlled by backend configuration.
 * - Merge domain keywords with requester-provided keywords.
 * - Store the resolved domain and source information in the
 *   generation context.
 *
 * This stage does not:
 * - Execute collectors.
 * - Create collection jobs.
 * - Run NLP analysis.
 * - Generate AI prompts.
 *
 * @author Malak
 */
@Injectable()
export class DataSourceSelectionStage implements IdeaGenerationStage {
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.DATA_SOURCE_SELECTION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly selectionService: IdeaGenerationSelectionService,
  ) {}

  /**
   * Resolves the domain, domain keywords, and applicable data
   * sources.
   *
   * @param context Current generation context.
   * @returns Context containing validated source selection.
   */
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
          const existingEffective = Array.isArray(domain.effectiveSearchKeywords)
            ? domain.effectiveSearchKeywords
            : Array.isArray(domain.keywords)
              ? domain.keywords
              : [];
          const configuredKeywords =
            domain.id === selection.domain.id &&
            Array.isArray(selection.domain.keywords)
              ? selection.domain.keywords.slice(0, 12)
              : Array.isArray(domain.configuredKeywords)
                ? domain.configuredKeywords.slice(0, 12)
                : [];
          const effectiveSearchKeywords = mergeGenerationStringArrays(
            [existingEffective, configuredKeywords],
            {
              lowercase: true,
              maxItems: 12,
              maxItemLength: 100,
            },
          );

          return {
            ...domain,
            name:
              domain.id === selection.domain.id
                ? selection.domain.name
                : domain.name,
            keywords: effectiveSearchKeywords,
            configuredKeywords,
            effectiveSearchKeywords,
          };
        })
      : [{
          id: selection.domain.id,
          name: selection.domain.name,
          keywords: selection.domain.keywords.slice(0, 12),
          configuredKeywords: selection.domain.keywords.slice(0, 12),
          effectiveSearchKeywords: selection.domain.keywords.slice(0, 12),
        }];

    const balancedDomainTerms: string[] = [];
    const domainTermBuckets = selectedDomains.map((domain) => [
      domain.name,
      ...(domain.effectiveSearchKeywords ?? domain.keywords),
    ]);
    for (let termIndex = 0; balancedDomainTerms.length < 30; termIndex += 1) {
      let added = false;
      for (const bucket of domainTermBuckets) {
        const term = bucket[termIndex];
        if (!term) continue;
        balancedDomainTerms.push(term);
        added = true;
        if (balancedDomainTerms.length >= 30) break;
      }
      if (!added) break;
    }

    const mergedKeywords = mergeGenerationStringArrays(
      [
        // Preserve explicit requester terms first, then fill the remaining
        // budget fairly across every selected domain.
        (Array.isArray(context.keywords) ? context.keywords : []).slice(0, 10),
        balancedDomainTerms,
      ],
      {
        lowercase: true,
        maxItems: 40,
        maxItemLength: 100,
      },
    );

    const plannedDataSources = this.selectPlannedDataSources(
      selection.dataSources,
      context,
    );

    const updatedContext: IdeaGenerationContext = {
      ...context,

      domainId: selection.domain.id,

      domainName: selection.domain.name,

      selectedDomains,

      keywords: mergedKeywords,

      selectedDataSources: plannedDataSources,
    };

    return {
      context: updatedContext,

      resultPreview: `Selected ${plannedDataSources.length} data source(s) for domain "${selection.domain.name}"${context.collectionPlan ? ' using the pre-collection intent plan' : ''}.`,

      metadata: {
        domainId: selection.domain.id,

        domainName: selection.domain.name,

        selectedDataSourceKeys: plannedDataSources.map(
          (dataSource) => dataSource.key,
        ),

        selectedDataSourcesCount: plannedDataSources.length,
        collectionPlanSourceFocus: context.collectionPlan?.sourceFocus ?? [],

        mergedKeywordsCount: mergedKeywords.length,
        selectedDomains: selectedDomains.map(({ id, name }) => ({ id, name })),

        // Observability only: proves whether automatic domain resolution came
        // from explicit input, current request text, saved interests, history,
        // or the deterministic fallback. It does not affect source selection.
        domainResolution: context.domainResolution,
      },
    };
  }

  private selectPlannedDataSources<T extends { readonly key: string }>(
    dataSources: readonly T[],
    context: IdeaGenerationContext,
  ): T[] {
    if (!context.requestDescription?.trim() || !context.collectionPlan) {
      return [...dataSources];
    }

    const sourceKeysByFocus: Record<string, readonly string[]> = {
      REVIEWS: ['google-play', 'app-store'],
      FORUMS: ['reddit', 'forum', 'hacker-news'],
      TECHNICAL: ['stackoverflow', 'github'],
      NEWS: ['news', 'blog'],
      PRODUCT_DISCOVERY: ['product-hunt'],
    };
    const requestedKeys = new Set<string>();
    for (const focus of context.collectionPlan.sourceFocus) {
      for (const key of sourceKeysByFocus[focus] ?? []) {
        requestedKeys.add(key);
      }
    }

    if (requestedKeys.size === 0) {
      return [...dataSources];
    }

    const normalizedIntentText = [
      context.requestDescription ?? '',
      ...(context.collectionPlan.searchQueries ?? []),
      ...(context.collectionPlan.intentConcepts ?? []),
    ]
      .join(' ')
      .toLocaleLowerCase();
    const institutionalPlan =
      /\b(?:government|municipal|public sector|public facility|city council|city government|local authority|public infrastructure|school district|library system|administrative building|city planner|city planners|city planning|urban planning|municipal planning|neighborhood management|neighbourhood management|public housing|residential planning|housing authority|property management.{0,80}city|city.{0,80}property management)\b/iu.test(
        normalizedIntentText,
      );
    const smallBusinessOperationsPlan =
      /\b(?:flower shop|flower shops|florist|florists|bouquet|bouquets|tattoo studio|dance studio|pottery studio|photography studio|repair shop|custom order|custom orders|small business|local supplier|local suppliers|musical instrument repair|luthier)\b/iu.test(
        normalizedIntentText,
      ) &&
      /\b(?:orders?|inventory|availability|delivery|booking|schedule|customer|supplier|substitution|pickup|preferences?|requirements?|appointments?|technician|parts?|notes?|repair status|paper tags?)\b/iu.test(
        normalizedIntentText,
      );
    const municipalDeviceSecurityPlan =
      /\b(?:smart cit(?:y|ies)|municipal|city technology|city network|public infrastructure|traffic lights?|parking sensors?|public cameras?|environmental monitors?|connected city devices?)\b/iu.test(
        normalizedIntentText,
      ) &&
      /\b(?:cybersecurity|security|unauthorized|outdated|firmware|compromised|device behavior|anomal|vulnerab|unmanaged|rogue device|security standards?)\w*\b/iu.test(
        normalizedIntentText,
      );
    const developerTechnicalIntent =
      /\b(?:api|sdk|code|runtime|exception|stack trace|docker|container|database schema|webhook|firmware|telemetry endpoint|developer|developers)\b/iu.test(
        normalizedIntentText,
      );

    if (institutionalPlan) {
      for (const key of ['news', 'youtube', 'blog', 'forum']) {
        requestedKeys.add(key);
      }
      if (!developerTechnicalIntent) {
        requestedKeys.delete('google-play');
        requestedKeys.delete('app-store');
        requestedKeys.delete('stackoverflow');
      }
    }

    if (smallBusinessOperationsPlan) {
      for (const key of ['youtube', 'news', 'google-play', 'app-store', 'forum']) {
        requestedKeys.add(key);
      }
    }

    if (municipalDeviceSecurityPlan) {
      for (const key of ['news', 'youtube', 'blog', 'github']) {
        requestedKeys.add(key);
      }
      requestedKeys.delete('google-play');
      requestedKeys.delete('app-store');
      requestedKeys.delete('product-hunt');
    }

    const priorityKeys = municipalDeviceSecurityPlan
      ? ['news', 'youtube', 'blog', 'github', 'forum', 'stackoverflow']
      : institutionalPlan
        ? ['news', 'youtube', 'blog', 'forum', 'github', 'hacker-news', 'stackoverflow']
      : smallBusinessOperationsPlan
        ? ['youtube', 'news', 'google-play', 'app-store', 'forum', 'blog', 'product-hunt']
      : [
          'google-play',
          'app-store',
          'reddit',
          'forum',
          'product-hunt',
          'github',
          'stackoverflow',
          'news',
          'blog',
          'hacker-news',
          'dev-to',
        ];

    const planned: T[] = [];
    for (const key of priorityKeys) {
      if (!requestedKeys.has(key) || planned.length >= 5) continue;
      const source = dataSources.find(
        (candidate) => candidate.key === key && !planned.includes(candidate),
      );
      if (source) planned.push(source);
    }

    for (const source of dataSources) {
      if (planned.length >= 5) break;
      if (requestedKeys.has(source.key) && !planned.includes(source)) {
        planned.push(source);
      }
    }

    if (planned.length >= 3) {
      return planned.slice(0, 4);
    }

    const isTechnicalPlan = context.collectionPlan.sourceFocus.includes('TECHNICAL');
    const safeSupplementKeys = municipalDeviceSecurityPlan
      ? ['news', 'youtube', 'blog', 'github']
      : institutionalPlan
        ? ['news', 'youtube', 'blog', 'forum', 'github']
      : smallBusinessOperationsPlan
        ? ['youtube', 'news', 'google-play', 'app-store', 'forum', 'blog']
      : isTechnicalPlan
        ? ['github', 'stackoverflow', 'reddit', 'forum', 'news', 'dev-to']
        : ['google-play', 'app-store', 'reddit', 'forum', 'product-hunt', 'news'];

    for (const key of safeSupplementKeys) {
      if (planned.length >= 3) break;
      const source = dataSources.find(
        (candidate) => candidate.key === key && !planned.includes(candidate),
      );
      if (source) planned.push(source);
    }

    return planned.length > 0 ? planned.slice(0, 4) : [...dataSources];
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Data-source-selection stage definition.
   */
  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}