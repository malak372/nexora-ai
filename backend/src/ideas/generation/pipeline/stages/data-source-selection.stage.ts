import { Injectable } from '@nestjs/common';

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
import { RequestWorkflowArchetypeUtil } from '../../utils/request-workflow-archetype.util';
import { RequestWorkflowIntentProfileUtil } from '../../utils/request-workflow-intent-profile.util';

/**
 * Resolves the active domain and data sources used by one
 * generation run.
 *
 * Responsibilities:
 * - Validate that the selected domain exists and is active.
 * - Load configured domain keywords.
 * - Select active and implemented data sources automatically.
 * - Apply high-confidence archetype source exclusions only for textual requests.
 * - Keep no-text and uncertain requests on full backend-controlled source coverage.
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
    private readonly collectorsFactory: CollectorsFactory,
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
    const requestDescription = context.requestDescription?.trim() ?? '';

    const selection = await this.selectionService.resolveSelection({
      domainId: context.domainId,
    });

    const currentSelectedDomains = Array.isArray(context.selectedDomains)
      ? context.selectedDomains
      : [];

    const selectedDomains =
      currentSelectedDomains.length > 0
        ? currentSelectedDomains.map((domain) => {
            const existingEffective = Array.isArray(
              domain.effectiveSearchKeywords,
            )
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

            const requestIntentKeywords =
              requestDescription && Array.isArray(domain.requestIntentKeywords)
                ? domain.requestIntentKeywords.slice(0, 8)
                : [];

            const effectiveSearchKeywords = mergeGenerationStringArrays(
              requestDescription
                ? [
                    requestIntentKeywords,
                    [domain.name],
                  ]
                : [
                    existingEffective,
                    configuredKeywords,
                  ],
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
        : [
            {
              id: selection.domain.id,
              name: selection.domain.name,
              keywords: selection.domain.keywords.slice(0, 12),
              configuredKeywords: selection.domain.keywords.slice(0, 12),
              effectiveSearchKeywords: selection.domain.keywords.slice(0, 12),
            },
          ];

    const balancedDomainTerms: string[] = [];

    const domainTermBuckets = selectedDomains.map((domain) => [
      domain.name,
      ...(domain.effectiveSearchKeywords ?? domain.keywords),
    ]);

    for (
      let termIndex = 0;
      balancedDomainTerms.length < 30;
      termIndex += 1
    ) {
      let added = false;

      for (const bucket of domainTermBuckets) {
        const term = bucket[termIndex];

        if (!term) {
          continue;
        }

        balancedDomainTerms.push(term);
        added = true;

        if (balancedDomainTerms.length >= 30) {
          break;
        }
      }

      if (!added) {
        break;
      }
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

      resultPreview: `Selected ${plannedDataSources.length} data source(s) for domain "${selection.domain.name}"${
        context.collectionPlan
          ? ' using the pre-collection intent plan'
          : ''
      }.`,

      metadata: {
        domainId: selection.domain.id,

        domainName: selection.domain.name,

        selectedDataSourceKeys: plannedDataSources.map(
          (dataSource) => dataSource.key,
        ),

        selectedDataSourcesCount: plannedDataSources.length,

        collectionPlanSourceFocus:
          context.collectionPlan?.sourceFocus ?? [],

        mergedKeywordsCount: mergedKeywords.length,

        selectedDomains: selectedDomains.map(({ id, name }) => ({
          id,
          name,
        })),

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
    const requestDescription = context.requestDescription?.trim() ?? '';

    if (!requestDescription) {
      /*
       * Keep the two no-text paths on their already-stable source set. GDELT,
       * Crossref, and runtime-configured Reddit remain request-scoped recall
       * lanes so text-aware routing cannot regress evidence-first discovery.
       */
      const requestScopedSupplementalKeys = new Set([
        'gdelt',
        'crossref',
        'reddit',
      ]);

      return dataSources.filter(
        (source) =>
          !requestScopedSupplementalKeys.has(source.key.toLocaleLowerCase()),
      );
    }

    /*
     * Text-bearing requests use smart selective fan-out. The AI source focus and
     * the request workflow archetype score the implemented collectors, then a
     * bounded high-yield subset participates in the same parallel first pass.
     * This still gives niche requests several independent evidence lanes while
     * preventing low-yield sources from dominating latency, rate limits, or
     * corpus size.
     *
     * Reddit remains request-scoped rather than globally enabled; the AI source
     * focus may opt it in for forum/community-heavy requests below.
     */
    const sourceFocusFamilies = new Set(
      context.collectionPlan?.sourceFocus ?? [],
    );
    const sourceFocusKeys = this.resolveSourceFocusKeys(
      context.collectionPlan?.sourceFocus ?? [],
    );
    const exactAiSourceKeys = new Set(
      context.collectionPlan?.selectedSourceKeys ?? [],
    );
    const allowRequestScopedReddit =
      sourceFocusFamilies.has('FORUMS') || exactAiSourceKeys.has('reddit');

    /*
     * Reddit is an optional request-scoped recall lane. Keep the previous
     * exclusion by default, but enable it automatically when the AI planner
     * explicitly says forum/community evidence is appropriate. Collector
     * failures remain non-fatal in FAST_GENERATION.
     */
    const requestSupportInput = {
      requestDescription,
      domainName: context.domainName ?? context.selectedDomains?.[0]?.name ?? '',
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
      keywords: context.keywords ?? [],
      collectionMode: 'FAST_GENERATION' as const,
    };
    const explicitlyRequestedKeys = new Set(
      (context.requestedDataSourceKeys ?? []).map((key) =>
        key.toLocaleLowerCase(),
      ),
    );
    const requestScopedSources = dataSources.filter((source) => {
      const key = source.key.toLocaleLowerCase();
      if (key === 'reddit' && !allowRequestScopedReddit) return false;
      if (explicitlyRequestedKeys.has(key)) return true;
      const sourcePlan = context.collectionPlan?.sourcePlans?.find(
        (plan) => plan.sourceKey.toLocaleLowerCase() === key,
      );
      return this.collectorsFactory.isCollectorRequestAvailable(
        key,
        {
          ...requestSupportInput,
          plannedQueries:
            sourcePlan?.queries ?? requestSupportInput.plannedQueries,
          sourceHints: sourcePlan?.routingHints ?? [],
        },
      );
    });

    /*
     * A valid AI text plan owns source selection. The deterministic archetype
     * layer is kept only as a fallback when AI planning was unavailable.
     * This prevents a secondary noun inside the request from reclassifying the
     * workflow after the AI has already selected the domain/query plan.
     */
    if (
      context.collectionPlan?.aiUsed &&
      !context.collectionPlan.fallbackUsed
    ) {
      const exactKeys = context.collectionPlan.selectedSourceKeys ?? [];
      if (exactKeys.length > 0) {
        const byKey = new Map(
          requestScopedSources.map((source) => [
            source.key.toLocaleLowerCase(),
            source,
          ] as const),
        );
        const selected: T[] = [];
        for (const requestedKey of exactKeys) {
          const key = requestedKey.toLocaleLowerCase();
          const source = byKey.get(key);
          if (source && !selected.some((item) => item.key.toLocaleLowerCase() === key)) {
            selected.push(source);
          }
        }
        for (const source of requestScopedSources) {
          const key = source.key.toLocaleLowerCase();
          if (
            explicitlyRequestedKeys.has(key) &&
            !selected.some((item) => item.key.toLocaleLowerCase() === key)
          ) {
            selected.push(source);
          }
        }

        /*
         * An AI plan can legitimately contain a source that is runtime-available
         * but guaranteed to return zero for this request (for example the generic
         * blog RSS adapter on a niche commission domain). After request-aware
         * filtering, backfill a small source-diverse set instead of silently
         * shrinking a three-source plan to Reddit alone or Reddit + an empty forum.
         */
        const workflowProfile =
          RequestWorkflowIntentProfileUtil.resolve(requestDescription);
        const minimumAiSourceCount = [
          'CUSTOM_COMMISSION',
          'SPECIFICATION_APPROVAL',
          'RESTORATION_CONSERVATION',
          'RENTAL_INVENTORY',
        ].includes(workflowProfile.family)
          ? 4
          : 3;
        if (selected.length < minimumAiSourceCount) {
          const backfillPriority = this.resolveAiSourceBackfillKeys(
            workflowProfile.family,
          );
          const byAvailableKey = new Map(
            requestScopedSources.map((source) => [
              source.key.toLocaleLowerCase(),
              source,
            ] as const),
          );
          for (const key of backfillPriority) {
            if (selected.length >= minimumAiSourceCount) break;
            const source = byAvailableKey.get(key);
            if (
              source &&
              !selected.some(
                (item) => item.key.toLocaleLowerCase() === key,
              )
            ) {
              selected.push(source);
            }
          }
        }

        if (selected.length > 0) {
          return selected.slice(0, 7);
        }
      }

      /*
       * Compatibility fallback for older cached AI plans that predate exact
       * source keys. New text plans should always use selectedSourceKeys.
       */
      if (sourceFocusFamilies.size > 0) {
        const aiBaseYield: Readonly<Record<string, number>> = {
          forum: 48,
          reddit: 54,
          news: 50,
          crossref: 42,
          gdelt: 36,
          youtube: 28,
          'app-store': 38,
          'google-play': 38,
          github: 30,
          stackoverflow: 28,
          'dev-to': 20,
          'hacker-news': 22,
          'product-hunt': 18,
          blog: 12,
        };
        const technicalRequest =
          /\b(?:api|sdk|source code|repository|github|webhook|endpoint|database schema|firmware integration|docker|kubernetes)\b/iu.test(requestDescription) ||
          /\b(?:software|application|app|server|container|node|javascript|typescript|python|java)\s+runtime\b|\bruntime\s+(?:error|exception|environment|version|dependency|crash)\b/iu.test(requestDescription);

        const ranked = requestScopedSources
          .map((source) => {
            const key = source.key.toLocaleLowerCase();
            let score = aiBaseYield[key] ?? 10;
            if (sourceFocusKeys.has(key)) score += 120;
            if (explicitlyRequestedKeys.has(key)) score += 1_000;
            if (
              !technicalRequest &&
              ['github', 'stackoverflow', 'dev-to', 'hacker-news'].includes(key) &&
              !explicitlyRequestedKeys.has(key)
            ) {
              score -= 180;
            }
            if (key === 'blog' && !explicitlyRequestedKeys.has(key)) score -= 90;
            return { source, key, score };
          })
          .filter((entry) => entry.score > 0 || explicitlyRequestedKeys.has(entry.key))
          .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));

        return ranked.slice(0, 7).map((entry) => entry.source);
      }
    }

    const requestOnlyArchetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription,
      selectedDomainNames: (context.selectedDomains ?? []).map(
        (domain) => domain.name,
      ),
    });

    const enrichedArchetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
      intentConcepts: context.collectionPlan?.intentConcepts ?? [],
      selectedDomainNames: (context.selectedDomains ?? []).map(
        (domain) => domain.name,
      ),
    });

    const archetype =
      requestOnlyArchetype.confidence >= enrichedArchetype.confidence
        ? requestOnlyArchetype
        : enrichedArchetype;

    const workflowProfile = RequestWorkflowIntentProfileUtil.resolve(requestDescription);
    const facilityResourceWorkflow = workflowProfile.family === 'FACILITY_RESOURCE_MONITORING';
    const craftRestorationNiche =
      this.isCraftRestorationNicheRequest(requestDescription);
    const preferredSourceKeys = craftRestorationNiche
      ? ['forum', 'reddit', 'youtube', 'news', 'crossref', 'gdelt']
      : archetype.preferredSourceKeys;
    const preferredRank = new Map(
      preferredSourceKeys.map((key, index) => [
        key.toLocaleLowerCase(),
        index,
      ] as const),
    );
    const blocked = new Set(
      archetype.blockedSourceKeys.map((key) => key.toLocaleLowerCase()),
    );
    if (craftRestorationNiche) {
      // Research/case-study material is useful for conservation/restoration
      // workflows even when a generic commission archetype would normally
      // suppress academic sources.
      blocked.delete('crossref');
    }

    const explicitlyRequested = new Set(
      (context.requestedDataSourceKeys ?? []).map((key) =>
        key.toLocaleLowerCase(),
      ),
    );
    const accountOrPortalWorkflow =
      /\b(?:portal|login|sign[- ]?in|authentication|account|permission|security alert|unauthorized access|unauthorised access|fraud|payment change)\w*\b/iu.test(
        requestDescription,
      );
    const technicalRequest =
      /\b(?:api|sdk|source code|repository|github|webhook|endpoint|database schema|firmware integration|docker|kubernetes)\b/iu.test(requestDescription) ||
      /\b(?:software|application|app|server|container|node|javascript|typescript|python|java)\s+runtime\b|\bruntime\s+(?:error|exception|environment|version|dependency|crash)\b/iu.test(requestDescription);
    const enterpriseIdentityWorkflow =
      archetype.archetype === 'ENTERPRISE_IDENTITY_ACCESS_SECURITY_OPERATIONS';
    const academicSecurityWorkflow =
      archetype.archetype === 'ACADEMIC_PLATFORM_SECURITY_OPERATIONS';
    const physicalServiceWorkflow =
      archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' ||
      archetype.archetype === 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS' ||
      archetype.archetype === 'PROFESSIONAL_EVIDENCE_RECORDS_OPERATIONS';

    /*
     * Text requests no longer fan out to every active collector. Score source
     * suitability from the AI focus + workflow archetype, then retain a small
     * diverse budget. This prevents repeated low-yield timeouts/429s from
     * dominating latency while keeping at least one community, publication and
     * review/technical lane when those families are relevant.
     */
    const sourceBaseYield: Readonly<Record<string, number>> = {
      forum: 34,
      reddit: 36,
      news: 34,
      'app-store': 30,
      'google-play': 30,
      youtube: 24,
      github: 22,
      crossref: 18,
      gdelt: 14,
      blog: 14,
      'dev-to': 10,
      'hacker-news': 9,
      stackoverflow: 8,
      'product-hunt': 6,
    };

    const scored = requestScopedSources
      .map((source) => {
        const key = source.key.toLocaleLowerCase();
        const preferredPosition = preferredRank.get(key);
        let score = sourceBaseYield[key] ?? 10;

        if (sourceFocusKeys.has(key)) score += 52;
        if (preferredPosition !== undefined) {
          score += Math.max(16, 56 - preferredPosition * 5);
        }
        if (blocked.has(key)) score -= 180;
        if (explicitlyRequested.has(key)) score += 500;

        if (
          accountOrPortalWorkflow &&
          !enterpriseIdentityWorkflow &&
          (key === 'app-store' || key === 'google-play')
        ) {
          score += 34;
        }
        if (
          !technicalRequest &&
          ['stackoverflow', 'dev-to', 'github', 'hacker-news'].includes(key) &&
          !explicitlyRequested.has(key)
        ) {
          // TECHNICAL in an AI source-focus response can mean technical subject
          // matter, not that developer communities are appropriate evidence
          // sources. Non-code requests therefore never auto-spend a slot here.
          score = -1_000;
        }

        /*
         * Forum request support is checked before scoring. Non-technical runs
         * never use developer Discourse communities; they only keep this source
         * when the forum collector has a concrete Stack Exchange route for the
         * current request.
         */
        if (!technicalRequest && key === 'forum') {
          /*
           * The forum collector also has a Stack Exchange path. For physical
           * craft/repair workflows it routes to community sites such as Crafts
           * and DIY, so treating every forum request as FreeCodeCamp-only
           * removes one of the few credential-free niche evidence lanes.
           */
          score +=
            physicalServiceWorkflow ||
            academicSecurityWorkflow ||
            enterpriseIdentityWorkflow
              ? 44
              : -150;
        }
        if (!technicalRequest && key === 'hacker-news') score -= 85;
        if (!technicalRequest && key === 'github') score -= 72;
        /*
         * The current blog adapter is feed-backed and intentionally skips
         * request-scoped domains that do not have a dedicated feed. Treat it
         * as a reserve source for textual generation instead of consuming a
         * first-pass slot that will predictably return zero. Explicit user
         * source selection still overrides this penalty.
         */
        if (key === 'blog' && !explicitlyRequested.has(key)) {
          // The feed-backed blog adapter has repeatedly returned static 404/zero
          // results for request-scoped generation. Keep it out of automatic
          // first-pass budgets; explicit user selection still overrides this.
          score = -1_000;
        }

        if (enterpriseIdentityWorkflow) {
          if (key === 'news') score += 58;
          if (key === 'crossref') score += 48;
          if (key === 'gdelt') score += 24;
          if (key === 'youtube') score += 10;
          if (key === 'blog') score -= 48;
          if (['app-store', 'google-play', 'product-hunt'].includes(key)) {
            score -= 100;
          }
        }

        if (physicalServiceWorkflow) {
          if (key === 'forum') score += 38;
          if (key === 'youtube') score += 28;
          if (key === 'crossref') score += 42;
          if (key === 'news') score += 26;
          if (key === 'gdelt') score += 16;
          if (key === 'blog') score -= 60;
          if (
            ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'].includes(
              key,
            )
          ) {
            score -= 110;
          }
        }
        if (facilityResourceWorkflow) {
          if (key === 'forum') score += 72;
          if (key === 'news') score += 62;
          if (key === 'crossref') score += 58;
          if (key === 'gdelt') score += 34;
          if (key === 'reddit') score += 28;
          if (key === 'youtube') score -= 18;
          if (['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'].includes(key)) score -= 120;
        }

        if (
          craftRestorationNiche &&
          ['app-store', 'google-play', 'product-hunt', 'stackoverflow'].includes(
            key,
          )
        ) {
          score -= 80;
        }
        if (craftRestorationNiche && key === 'blog') {
          // The current blog collector uses generic feeds and intentionally
          // skips request-scoped niche domains, so do not spend a first-pass
          // slot on it when stronger professional lanes are available.
          score -= 100;
        }

        return { source, key, score };
      })
      .filter((entry) => entry.score > 0 || explicitlyRequested.has(entry.key))
      .sort(
        (left, right) =>
          right.score - left.score || left.key.localeCompare(right.key),
      );

    const maxSources = facilityResourceWorkflow
      ? 6
      : craftRestorationNiche
        ? 5
        : enterpriseIdentityWorkflow
          ? 5
          : 7;
    const selected = scored.slice(0, maxSources);

    /* Guarantee explicitly requested sources even when they fall outside the
     * normal budget. User intent wins over automatic source optimization. */
    for (const entry of scored) {
      if (
        explicitlyRequested.has(entry.key) &&
        !selected.some((item) => item.key === entry.key)
      ) {
        selected.push(entry);
      }
    }

    return selected.map((entry) => entry.source);
  }

  private resolveAiSourceBackfillKeys(
    family: ReturnType<typeof RequestWorkflowIntentProfileUtil.resolve>['family'],
  ): readonly string[] {
    switch (family) {
      case 'CUSTOM_COMMISSION':
      case 'SPECIFICATION_APPROVAL':
      case 'RESTORATION_CONSERVATION':
      case 'RENTAL_INVENTORY':
        return ['reddit', 'forum', 'youtube', 'news', 'crossref', 'gdelt'];
      case 'FOOD_STORAGE_CONDITION':
        return ['reddit', 'forum', 'news', 'crossref', 'youtube', 'gdelt'];
      case 'RESTAURANT_ENERGY':
      case 'FACILITY_RESOURCE_MONITORING':
        return ['news', 'crossref', 'gdelt', 'reddit', 'forum', 'youtube'];
      case 'TRANSACTION_ACCOUNT_ABUSE':
        return [
          'reddit',
          'news',
          'crossref',
          'gdelt',
          'app-store',
          'google-play',
        ];
      default:
        return ['reddit', 'news', 'crossref', 'gdelt', 'forum', 'youtube'];
    }
  }

  private isCraftRestorationNicheRequest(requestDescription: string): boolean {
    const text = requestDescription.normalize('NFKC');
    const craftActorOrWork =
      /\b(?:restoration|restorer|restorers|repair specialist|repair specialists|repair technician|repair technicians|conservator|conservators|restoration specialist|restoration specialists)\b/iu.test(
        text,
      );
    const physicalSpecificationOrHistory =
      /\b(?:photographs?|handwritten|physical samples?|material samples?|measurements?|engraving|engravings|finish|finishes|stitching|buckle|decorative details?|previous repairs?|previous modifications?|restoration histor(?:y|ies)|service histor(?:y|ies)|approved choices?|approved specifications?|design revisions?)\b/iu.test(
        text,
      );
    return craftActorOrWork && physicalSpecificationOrHistory;
  }

  private resolveSourceFocusKeys(
    sourceFocus: readonly string[],
  ): ReadonlySet<string> {
    const keys = new Set<string>();

    const familyKeys: Record<string, readonly string[]> = {
      REVIEWS: ['app-store', 'google-play'],

      FORUMS: ['forum', 'reddit', 'hacker-news'],

      TECHNICAL: [
        'github',
        'stackoverflow',
        'dev-to',
        'hacker-news',
      ],

      NEWS: [
        'news',
        'gdelt',
        'crossref',
        'blog',
        'youtube',
      ],

      PRODUCT_DISCOVERY: ['product-hunt'],
    };

    for (const family of sourceFocus) {
      for (const key of familyKeys[family] ?? []) {
        keys.add(key);
      }
    }

    return keys;
  }

  private orderSourcesByPreference<
    T extends { readonly key: string },
  >(
    sources: readonly T[],
    preferredSourceKeys: readonly string[],
  ): T[] {
    const priority = new Map(
      preferredSourceKeys.map((key, index) => [
        key.toLocaleLowerCase(),
        index,
      ]),
    );

    return [...sources].sort((left, right) => {
      const leftRank =
        priority.get(left.key.toLocaleLowerCase()) ??
        Number.MAX_SAFE_INTEGER;

      const rightRank =
        priority.get(right.key.toLocaleLowerCase()) ??
        Number.MAX_SAFE_INTEGER;

      return (
        leftRank -
          rightRank ||
        left.key.localeCompare(right.key)
      );
    });
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Data-source-selection stage definition.
   */
  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition =
      findIdeaGenerationStageDefinition(this.key);

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}