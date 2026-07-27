import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import { CollectionJobResolverService } from './collection-job-resolver.service';
import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
  SelectedIdeaDataSource,
} from '../types/idea-generation-context.type';
import type { RankedIdeaOpportunity } from '../types/idea-opportunity-ranking.type';

/** Result of one bounded targeted evidence-recovery attempt. */
export type IdeaEvidenceRecoveryResult = {
  readonly collectionJobId: string;
  readonly selectedDataSourceKeys: readonly string[];
  readonly recoveryKeywords: readonly string[];
  readonly totalPosts: number;
  readonly totalComments: number;
  readonly nlp: IdeaGenerationNlpContext;
};

/**
 * Performs one targeted collection pass when the initial NLP opportunities do
 * not satisfy the strict selection gate.
 *
 * The recovery pass intentionally uses a small subset of evidence-rich sources
 * and complaint-oriented keywords. It does not invoke idea-generation AI.
 */
@Injectable()
export class IdeaEvidenceRecoveryService {
  private readonly preferredSourceOrder = [
    'google-play',
    'app-store',
    'youtube',
    'forum',
    'stackoverflow',
    'github',
    'news',
    'blog',
    'dev-to',
    'hacker-news',
    'product-hunt',
  ] as const;

  private readonly maximumRecoverySources = 2;
  private readonly maximumRecoveryKeywords = 18;

  constructor(
    private readonly collectionJobResolver: CollectionJobResolverService,
  ) {}

  async recover(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null = null,
  ): Promise<IdeaEvidenceRecoveryResult> {
    const recoverySources = this.selectRecoverySources(
      context.selectedDataSources,
    );
    const recoveryKeywords = this.buildRecoveryKeywords(
      context,
      selectedOpportunity,
    );

    const result = await this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,
      domainId: context.domainId,
      country: context.location.country,
      city: context.location.city ?? undefined,
      region: context.location.region ?? undefined,
      language: context.location.language,
      radiusKm: context.location.radiusKm ?? undefined,
      dataSourceKeys: recoverySources.map((source) => source.key),
      keywords: recoveryKeywords,
      forceRefresh: true,
    });

    return {
      collectionJobId: result.job.id,
      selectedDataSourceKeys: recoverySources.map((source) => source.key),
      recoveryKeywords,
      totalPosts: result.nlpOutput.totalPostsAnalyzed,
      totalComments: result.nlpOutput.totalCommentsAnalyzed,
      nlp: this.mapNlpContext(
        result.job.nlpAnalysis?.id ?? null,
        result.nlpOutput,
      ),
    };
  }

  private selectRecoverySources(
    selectedSources: readonly SelectedIdeaDataSource[],
  ): SelectedIdeaDataSource[] {
    const byKey = new Map(
      selectedSources.map((source) => [source.key, source] as const),
    );

    const ordered = this.preferredSourceOrder
      .map((key) => byKey.get(key))
      .filter((source): source is SelectedIdeaDataSource => Boolean(source));

    const commentRich = ordered.filter((source) => source.supportsComments);
    const fallback = ordered.filter((source) => !source.supportsComments);
    const selected = [...commentRich, ...fallback].slice(
      0,
      this.maximumRecoverySources,
    );

    if (selected.length > 0) {
      return selected;
    }

    return selectedSources.slice(0, this.maximumRecoverySources);
  }

  /**
   * Builds issue-specific recovery queries before generic domain keywords.
   *
   * Previously, the full domain keyword list was appended first and then
   * truncated, which could remove every targeted complaint query. The selected
   * opportunity now receives priority so recovery searches for additional
   * evidence about the exact observed failure rather than recollecting broad
   * domain content.
   */
  private buildRecoveryKeywords(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null,
  ): string[] {
    const domain = (context.domainName ?? '').trim();
    const country = context.location.country.trim();
    const city = context.location.city?.trim() ?? '';
    const domainTerm = domain || context.keywords[0]?.trim() || 'software';
    const locationTerms = [city, country].filter(Boolean).join(' ');

    const opportunityTerms = this.buildOpportunityTerms(
      domainTerm,
      selectedOpportunity,
    );
    const genericTargeted = [
      `${domainTerm} app problems`,
      `${domainTerm} software complaints`,
      `${domainTerm} app reviews`,
      `${domainTerm} app crashes`,
      `${domainTerm} app data loss`,
      `${domainTerm} app offline problems`,
      `${domainTerm} app usability issues`,
      `${domainTerm} app feature requests`,
      `${domainTerm} users need`,
      `${domainTerm} service unreliable`,
      locationTerms ? `${domainTerm} problems ${locationTerms}` : '',
      locationTerms ? `${domainTerm} user complaints ${locationTerms}` : '',
    ];
    const boundedBaseTerms = [domain, ...context.keywords]
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 4);

    return [
      ...new Set([
        ...opportunityTerms,
        ...genericTargeted,
        ...boundedBaseTerms,
      ]),
    ]
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, this.maximumRecoveryKeywords);
  }

  /**
   * Derives bounded search phrases from the current ranking winner.
   *
   * Only normalized opportunity descriptors are used; raw evidence quotes are
   * intentionally excluded so user-generated text is not treated as a search
   * instruction.
   */
  private buildOpportunityTerms(
    domainTerm: string,
    selectedOpportunity: RankedIdeaOpportunity | null,
  ): string[] {
    if (!selectedOpportunity) {
      return [];
    }

    const descriptors = [
      selectedOpportunity.title,
      selectedOpportunity.problem,
      selectedOpportunity.need,
      selectedOpportunity.solutionArea,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim())
      .filter((value) => value.length >= 5)
      .slice(0, 4);

    const descriptorQueries = descriptors.flatMap((descriptor) => [
      `${domainTerm} ${descriptor}`,
      `${descriptor} user complaint`,
    ]);
    const normalizedDescriptorText = descriptors.join(' ').toLowerCase();
    const workflowQueries: string[] = [];

    if (
      /\b(?:subscription|purchase|billing|paywall|upgrade|entitlement|pro)\b/iu.test(
        normalizedDescriptorText,
      )
    ) {
      workflowQueries.push(
        `${domainTerm} paid subscription not recognized`,
        `${domainTerm} restore purchase failed`,
        `${domainTerm} pro upgrade not activated`,
        `${domainTerm} purchased features inaccessible`,
      );
    }

    if (
      /\b(?:account|activation|login|credential|access)\b/iu.test(
        normalizedDescriptorText,
      )
    ) {
      workflowQueries.push(
        `${domainTerm} account activation failed`,
        `${domainTerm} login no response`,
        `${domainTerm} cannot access paid account`,
      );
    }

    if (
      /\b(?:crash|reliability|unstable|failure|data loss)\b/iu.test(
        normalizedDescriptorText,
      )
    ) {
      workflowQueries.push(
        `${domainTerm} app keeps crashing`,
        `${domainTerm} reliability failure review`,
      );
    }

    return [...descriptorQueries, ...workflowQueries];
  }

  private mapNlpContext(
    persistedAnalysisId: string | null,
    output: {
      collectionJobId: string;
      totalTextsAnalyzed: number;
      totalPostsAnalyzed: number;
      totalCommentsAnalyzed: number;
      sentimentStats: unknown;
      keywords: unknown;
      topics: unknown;
      recurringProblems: unknown;
      extractedNeeds: unknown;
      featureRequests: unknown;
      opportunities: unknown;
      insights: unknown;
      dataQuality: unknown;
      samplePosts: unknown;
      sampleComments: unknown;
      aiUsed: boolean;
      confidence: number;
    },
  ): IdeaGenerationNlpContext {
    return {
      nlpAnalysisId: persistedAnalysisId ?? output.collectionJobId,
      totalTextsAnalyzed: output.totalTextsAnalyzed,
      totalPostsAnalyzed: output.totalPostsAnalyzed,
      totalCommentsAnalyzed: output.totalCommentsAnalyzed,
      sentimentStats: this.toJsonValue(output.sentimentStats),
      keywords: this.toJsonValue(output.keywords),
      topics: this.toJsonValue(output.topics),
      recurringProblems: this.toJsonValue(output.recurringProblems),
      extractedNeeds: this.toJsonValue(output.extractedNeeds),
      featureRequests: this.toJsonValue(output.featureRequests),
      opportunities: this.toJsonValue(output.opportunities),
      insights: this.toJsonValue(output.insights),
      dataQuality: this.toJsonValue(output.dataQuality),
      samplePosts: this.toJsonValue(output.samplePosts),
      sampleComments: this.toJsonValue(output.sampleComments),
      aiUsed: output.aiUsed,
      confidence: Number.isFinite(output.confidence) ? output.confidence : null,
    };
  }

  private toJsonValue(value: unknown): Prisma.JsonValue | null {
    if (value === undefined || value === null) {
      return null;
    }

    return value;
  }
}
