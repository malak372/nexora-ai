import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import { CollectionJobResolverService } from './collection-job-resolver.service';
import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
  SelectedIdeaDataSource,
} from '../types/idea-generation-context.type';

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
  ): Promise<IdeaEvidenceRecoveryResult> {
    const recoverySources = this.selectRecoverySources(
      context.selectedDataSources,
    );
    const recoveryKeywords = this.buildRecoveryKeywords(context);

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

  private buildRecoveryKeywords(context: IdeaGenerationContext): string[] {
    const domain = (context.domainName ?? '').trim();
    const country = context.location.country.trim();
    const city = context.location.city?.trim() ?? '';
    const baseTerms = [domain, ...context.keywords]
      .map((value) => value.trim())
      .filter(Boolean);

    const domainTerm = domain || baseTerms[0] || 'software';
    const locationTerms = [city, country].filter(Boolean).join(' ');

    const targeted = [
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

    return [...new Set([...baseTerms, ...targeted])]
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, this.maximumRecoveryKeywords);
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
