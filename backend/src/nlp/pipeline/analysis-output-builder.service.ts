import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { AnalysisEvidenceService } from './analysis-evidence.service';
import { AnalysisStatisticsService } from './analysis-statistics.service';
import type { AnalysisContext } from './types/analysis-context.type';
import type {
  IntelligentAnalysisOutput,
  TextAnalysisResult,
} from './types/intelligent-analysis.types';

/**
 * Builds the final IntelligentAnalysisOutput object from the analysis context.
 *
 * This service keeps output construction separated from the main NLP pipeline
 * orchestrator. It combines analysis metadata, statistics, evidence samples,
 * extracted insights, and pipeline results into the final contract used by
 * persistence and prompt generation.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisOutputBuilderService {
  constructor(
    private readonly analysisStatisticsService: AnalysisStatisticsService,
    private readonly analysisEvidenceService: AnalysisEvidenceService,
  ) { }

  /**
   * Builds the final intelligent analysis output.
   *
   * @param context Complete pipeline analysis context.
   * @returns Final intelligent NLP analysis output.
   */
  build(context: AnalysisContext): IntelligentAnalysisOutput {
    return {
      collectionJobId: context.collectionJobId,
      language: context.language,

      domain: {
        id: context.domain.id,
        name: context.domain.name,
      },

      location: context.location,
      platforms: context.platforms,

      totalTextsAnalyzed: context.analyzedTexts.length,
      totalPostsAnalyzed: this.analysisStatisticsService.countPosts(
        context.analyzedTexts,
      ),
      totalCommentsAnalyzed: this.analysisStatisticsService.countComments(
        context.analyzedTexts,
      ),

      dataQuality: {
        duplicateTextsRemoved: context.preprocessing.duplicateTextsRemoved,
        spamTextsRemoved: context.preprocessing.spamTextsRemoved,
        irrelevantTextsRemoved: context.preprocessing.irrelevantTextsRemoved,
      },

      sentimentStats: this.analysisStatisticsService.buildSentimentStats(
        context.analyzedTexts,
      ),

      keywords: context.keywords,
      topics: context.topics,
      recurringProblems: context.recurringProblems,
      extractedNeeds: context.extractedNeeds,
      featureRequests: context.featureRequests,
      opportunities: context.opportunities,

      insights: this.buildInsights(context.analyzedTexts),

      samplePosts: this.analysisEvidenceService.extractSamplePosts(
        context.analyzedTexts,
      ),
      sampleComments: this.analysisEvidenceService.extractSampleComments(
        context.analyzedTexts,
      ),

      aiUsed: context.analyzedTexts.some((text) => text.aiUsed),
      confidence: this.analysisStatisticsService.calculateOverallConfidence(
        context.analyzedTexts,
      ),

      analyzedTexts: context.analyzedTexts,
    };
  }

  /**
   * Builds classified rule-based concern signals from matched lexicons.
   *
   * Additional AI insights start empty and may be added later by the optional
   * AI-enhancement and merge layer.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Classified insight signals.
   */
  private buildInsights(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): IntelligentAnalysisOutput['insights'] {
    return {
      urgencySignals: this.collectSignals(
        analyzedTexts,
        NlpLexiconType.URGENCY,
      ),
      costConcerns: this.collectSignals(
        analyzedTexts,
        NlpLexiconType.COST,
      ),
      timeConcerns: this.collectSignals(
        analyzedTexts,
        NlpLexiconType.TIME,
      ),
      accessibilityConcerns: this.collectSignals(
        analyzedTexts,
        NlpLexiconType.ACCESSIBILITY,
      ),
      safetyConcerns: this.collectSignals(
        analyzedTexts,
        NlpLexiconType.SAFETY,
      ),
      reliabilityConcerns: this.collectSignals(
        analyzedTexts,
        NlpLexiconType.RELIABILITY,
      ),
      additionalInsights: [],
    };
  }

  /**
   * Collects unique lexicon signals for a specific insight category.
   *
   * @param analyzedTexts Final analyzed text records.
   * @param type NLP lexicon type.
   * @returns Unique normalized signals.
   */
  private collectSignals(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
    type: NlpLexiconType,
  ): string[] {
    return [
      ...new Set(
        analyzedTexts
          .flatMap((text) => text.matchedLexicons[type] ?? [])
          .map((signal) => signal.trim().toLowerCase())
          .filter((signal) => signal.length > 0),
      ),
    ];
  }
}