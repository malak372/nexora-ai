import { Injectable } from '@nestjs/common';

import { CollectorsFactory } from '../../../../collectors/collectors.factory';
import { CollectorSourceHealthService } from '../../../../data-collection/collector-source-health.service';

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
import { RequestVerticalConstraintUtil } from '../../utils/request-vertical-constraint.util';
import { RequestNicheCustomCraftUtil } from '../../utils/request-niche-custom-craft.util';
import { RequestEvidenceDomainRoleUtil } from '../../utils/request-evidence-domain-role.util';

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
    private readonly collectorSourceHealth: CollectorSourceHealthService,
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

    const evidenceSearchDomains = selectedDomains.filter((domain) =>
      RequestEvidenceDomainRoleUtil.isEvidenceSearchDomain(
        domain.name,
        requestDescription,
      ),
    );
    const domainTermBuckets = evidenceSearchDomains.map((domain) => [
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

    const mergedKeywords = RequestEvidenceDomainRoleUtil.filterEvidenceSearchTerms(
      mergeGenerationStringArrays(
        [
          // Preserve requester problem terms first, then fill the remaining
          // budget only from domains that describe the problem itself.
          (Array.isArray(context.keywords) ? context.keywords : []).slice(0, 10),
          balancedDomainTerms,
        ],
        {
          lowercase: true,
          maxItems: 40,
          maxItemLength: 100,
        },
      ),
      selectedDomains.map((domain) => domain.name),
      requestDescription,
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
    const priority = new Map(
      (context.collectionPlan?.selectedSourceKeys ?? []).map((key, index) => [
        key.toLocaleLowerCase(),
        index,
      ] as const),
    );
    const explicit = new Set<string>(
      (context.requestedDataSourceKeys ?? []).map((key) => key.toLocaleLowerCase()),
    );
    const ordered = [...dataSources].sort((left, right) => {
      const leftKey = left.key.toLocaleLowerCase();
      const rightKey = right.key.toLocaleLowerCase();
      const leftExplicit = explicit.has(leftKey) ? 1 : 0;
      const rightExplicit = explicit.has(rightKey) ? 1 : 0;
      const leftPriority = priority.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priority.get(rightKey) ?? Number.MAX_SAFE_INTEGER;
      const leftHealth = this.collectorSourceHealth.score(leftKey);
      const rightHealth = this.collectorSourceHealth.score(rightKey);
      return (
        rightExplicit - leftExplicit ||
        leftPriority - rightPriority ||
        rightHealth - leftHealth ||
        leftKey.localeCompare(rightKey)
      );
    });

    /*
     * Every automatic path is bounded. NO_INPUT still receives the widest
     * automatic budget, but it must honor the planner/source-tier cap instead
     * of launching every enabled collector. This protects source quality and
     * rate limits while retaining a diverse discovery surface.
     */

    const planKeys = context.collectionPlan?.selectedSourceKeys ?? [];
    const tieredPlanKeys = (context.collectionPlan?.sourcePlans ?? [])
      .filter((plan) => plan.sourceTier !== 'MICRO_PROBE')
      .map((plan) => plan.sourceKey);
    const focusKeys = [...this.resolveSourceFocusKeys(
      context.collectionPlan?.sourceFocus ?? [],
    )];
    const workflowFamily = RequestWorkflowIntentProfileUtil.resolve(
      context.requestDescription,
    ).family;
    const niche = RequestNicheCustomCraftUtil.resolve(
      context.requestDescription,
    );
    const nicheBackfillKeys = niche
      ? ['reddit', 'forum', 'blog', 'youtube', 'news', 'crossref', 'gdelt']
      : [];
    const workflowBackfillKeys = context.requestDescription?.trim()
      ? this.resolveAiSourceBackfillKeys(workflowFamily)
      : [];

    const requestGroundedPlanning = Boolean(
      context.requestDescription?.trim() && context.collectionPlan,
    );
    const preferredKeys = [
      ...explicit,
      // For requester-grounded paths the AI/source plan is the authoritative
      // source order. Niche/workflow backfills may fill unavailable lanes but
      // must never outrank a healthy source explicitly selected by PREPARING.
      ...(requestGroundedPlanning ? planKeys : nicheBackfillKeys),
      ...tieredPlanKeys,
      ...(requestGroundedPlanning ? nicheBackfillKeys : planKeys),
      ...focusKeys,
      ...workflowBackfillKeys,
    ]
      .map((key) => key.toLocaleLowerCase())
      .filter((key, index, values) => values.indexOf(key) === index);
    const byKey = new Map(
      ordered.map((source) => [source.key.toLocaleLowerCase(), source] as const),
    );
    const preferred = preferredKeys
      .map((key) => byKey.get(key))
      .filter((source): source is T => Boolean(source));

    const discoveryMode =
      context.requestMode === 'DOMAINS_ONLY' || context.requestMode === 'NO_INPUT';
    const minimumSources = discoveryMode ? 6 : 4;
    const maximumSources = discoveryMode ? 8 : 6;
    const backfill = ordered.filter(
      (source) => !preferredKeys.includes(source.key.toLocaleLowerCase()),
    );
    const candidates = [...preferred, ...backfill];

    const selected = this.applySourceHealth(
      candidates,
      explicit,
      Math.min(minimumSources, candidates.length),
      Math.max(maximumSources, explicit.size),
      requestGroundedPlanning,
    );

    /*
     * A recognized niche request must actually reach the community-oriented
     * collectors that make the niche profile useful. Health scoring may
     * otherwise push Forum/Reddit just below a six-source cap even though the
     * plan contains excellent specialist queries. Preserve them when healthy;
     * never displace an explicitly requested source.
     */
    if (niche) {
      for (const requiredKey of ['forum', 'reddit']) {
        const required = byKey.get(requiredKey);
        if (
          !required ||
          this.collectorSourceHealth.isTemporarilyDegraded(required.key) ||
          selected.some(
            (source) => source.key.toLocaleLowerCase() === requiredKey,
          )
        ) {
          continue;
        }

        const replaceIndex = [...selected]
          .map((source, index) => ({ source, index }))
          .reverse()
          .find(
            ({ source }) =>
              !explicit.has(source.key.toLocaleLowerCase()) &&
              !['forum', 'reddit'].includes(source.key.toLocaleLowerCase()),
          )?.index;
        if (replaceIndex !== undefined) {
          selected[replaceIndex] = required;
        }
      }
    }

    return selected;
  }

  private applySourceHealth<T extends { readonly key: string }>(
    sources: readonly T[],
    explicitlyRequested: ReadonlySet<string>,
    minimumSources: number,
    maximumSources: number,
    preservePlannerOrder = false,
  ): T[] {
    const normalizedExplicit = new Set(
      [...explicitlyRequested].map((key) => key.toLocaleLowerCase()),
    );
    const scored = sources.map((source, index) => ({
      source,
      index,
      explicit: normalizedExplicit.has(source.key.toLocaleLowerCase()),
      health: this.collectorSourceHealth.score(source.key),
      degraded: this.collectorSourceHealth.isTemporarilyDegraded(source.key),
    }));

    if (preservePlannerOrder) {
      /*
       * Requester-grounded planning already performed semantic source
       * selection. Health is a circuit-breaker here, not a second recommender.
       * Keep every healthy planned lane in its original order and use later
       * candidates only to replace lanes that are actually degraded. This
       * prevents a globally healthy but semantically weak source (for example
       * GitHub/App Store for farm-profitability research) from displacing
       * Reddit/News/Crossref/Forum merely because its recent HTTP score is
       * higher.
       */
      const healthyInPlanOrder = scored.filter(
        (entry) => entry.explicit || !entry.degraded,
      );
      const selected = healthyInPlanOrder
        .slice(0, maximumSources)
        .map((entry) => entry.source);

      if (selected.length >= minimumSources) return selected;

      const selectedKeys = new Set(
        selected.map((source) => source.key.toLocaleLowerCase()),
      );
      const emergencyBackfill = scored
        .filter((entry) => !selectedKeys.has(entry.source.key.toLocaleLowerCase()))
        .sort(
          (left, right) =>
            Number(right.explicit) - Number(left.explicit) ||
            right.health - left.health ||
            left.index - right.index,
        );
      for (const entry of emergencyBackfill) {
        if (selected.length >= minimumSources || selected.length >= maximumSources) break;
        selected.push(entry.source);
      }
      return selected;
    }

    const healthRanked = scored.sort((left, right) =>
      Number(right.explicit) - Number(left.explicit) ||
      right.health - left.health ||
      left.index - right.index,
    );
    const healthy = healthRanked.filter(
      (entry) => entry.explicit || !entry.degraded,
    );
    const chosen = healthy.length >= minimumSources ? healthy : healthRanked;
    return chosen
      .slice(0, Math.max(minimumSources, maximumSources))
      .map((entry) => entry.source);
  }

  private resolveAiSourceBackfillKeys(
    family: ReturnType<typeof RequestWorkflowIntentProfileUtil.resolve>['family'],
  ): readonly string[] {
    switch (family) {
      case 'RESTORATION_CONSERVATION':
        return ['reddit', 'forum', 'crossref', 'news', 'gdelt', 'youtube', 'blog'];
      case 'CUSTOM_COMMISSION':
      case 'SPECIFICATION_APPROVAL':
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
          'forum',
          'news',
          'crossref',
          'gdelt',
          'blog',
          'youtube',
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

  private isClinicalPractitionerMonitoringRequest(
    requestDescription: string,
  ): boolean {
    const text = requestDescription.normalize('NFKC');
    const clinicalActor =
      /\b(?:sports rehabilitation centers?|rehabilitation centers?|rehab centers?|sports medicine|physical therapists?|physiotherapists?|clinics?|clinical teams?|therapists?)\b/iu.test(
        text,
      );
    const recoveryWorkflow =
      /\b(?:athletes?|patients?|recovery|rehabilitation|wearable(?: sensor)?s?|pain reports?|mobility measurements?|therapy notes?|remote monitoring|outpatient|reinjury|return to play|recovery program)\b/iu.test(
        text,
      );
    return clinicalActor && recoveryWorkflow;
  }

  private isEmergencyPublicLogisticsRequest(
    requestDescription: string,
  ): boolean {
    const text = requestDescription.normalize('NFKC');
    return (
      /\b(?:government agenc(?:y|ies)|public sector|public authorit(?:y|ies)|emergency management|disaster response|humanitarian)\b/iu.test(text) &&
      /\b(?:emergency supplies?|relief supplies?|humanitarian logistics|disaster logistics|inventory|warehouse|transportation availability|regional demand|resource allocation|distribution|shipments?|shortages?)\b/iu.test(text)
    );
  }

  private isPublicInstitutionalRequest(requestDescription: string): boolean {
    const text = requestDescription.normalize('NFKC');
    const publicActor =
      /\b(?:public transportation|transit agenc(?:y|ies)|transportation authorit(?:y|ies)|municipal|municipalit(?:y|ies)|city government|government agenc(?:y|ies)|public authorit(?:y|ies)|public sector|public education authorit(?:y|ies)|education authorit(?:y|ies)|school districts?|education departments?|ministr(?:y|ies) of education|public school systems?)\b/iu.test(text);
    const institutionalDecision =
      /\b(?:resource allocation|resource distribution|staffing|teachers?|learning resources?|intervention programs?|enrollment|attendance|assessment|school reports?|education spending|funding|overcrowd(?:ed|ing)?|road closures?|accidents?|incidents?|service disruptions?|passenger demand|rerout(?:e|ing)|delays?|traffic conditions?|vehicle locations?|route schedules?)\b/iu.test(text);
    return publicActor && institutionalDecision;
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