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

    const selectedDomains = context.selectedDomains.length > 0
      ? context.selectedDomains.map((domain) =>
          domain.id === selection.domain.id
            ? { ...domain, name: selection.domain.name, keywords: selection.domain.keywords }
            : domain,
        )
      : [{
          id: selection.domain.id,
          name: selection.domain.name,
          keywords: selection.domain.keywords,
        }];

    const balancedDomainTerms: string[] = [];
    const domainTermBuckets = selectedDomains.map((domain) => [
      domain.name,
      ...domain.keywords,
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
        context.keywords.slice(0, 10),
        balancedDomainTerms,
      ],
      {
        lowercase: true,
        maxItems: 40,
        maxItemLength: 100,
      },
    );

    const updatedContext: IdeaGenerationContext = {
      ...context,

      domainId: selection.domain.id,

      domainName: selection.domain.name,

      selectedDomains,

      keywords: mergedKeywords,

      selectedDataSources: selection.dataSources,
    };

    return {
      context: updatedContext,

      resultPreview: `Selected ${selection.dataSources.length} data source(s) for domain "${selection.domain.name}".`,

      metadata: {
        domainId: selection.domain.id,

        domainName: selection.domain.name,

        selectedDataSourceKeys: selection.dataSources.map(
          (dataSource) => dataSource.key,
        ),

        selectedDataSourcesCount: selection.dataSources.length,

        mergedKeywordsCount: mergedKeywords.length,
        selectedDomains: selectedDomains.map(({ id, name }) => ({ id, name })),
      },
    };
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