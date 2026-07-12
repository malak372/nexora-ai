import { Injectable } from '@nestjs/common';

import { AiEnhancementService } from '../ai-enhancement/services/ai-enhancement.service';
import { AnalysisMetricsService } from '../analysis/analysis-metrics.service';
import { FeatureRequestExtractionService } from '../analysis/feature-request-extraction.service';
import { KeywordExtractionService } from '../analysis/keyword-extraction.service';
import { NeedExtractionService } from '../analysis/need-extraction.service';
import { OpportunityAnalysisService } from '../analysis/opportunity-analysis.service';
import { SentimentAnalysisService } from '../analysis/sentiment-analysis.service';
import { TopicExtractionService } from '../analysis/topic-extraction.service';
import { AnalysisDecisionService } from '../decision/analysis-decision.service';
import { TextComplexityAnalysisService } from '../decision/text-complexity-analysis.service';
import { AnalysisDecisionAction } from '../decision/types/analysis-decision.type';
import { LexiconAnalysisService } from '../lexicon/lexicon-analysis.service';
import { IntelligentAnalysisPersistenceMapper } from '../persistence/mappers/intelligent-analysis-persistence.mapper';
import { NlpPersistenceService } from '../persistence/nlp-persistence.service';
import { ProblemInsightService } from '../problems/problem-insight.service';

import { AnalysisEvidenceService } from './analysis-evidence.service';
import { AnalysisOutputBuilderService } from './analysis-output-builder.service';
import { AnalysisStatisticsService } from './analysis-statistics.service';
import { TextInputBuilderService } from './text-input-builder.service';
import { TextPreprocessingService } from './text-preprocessing.service';
import type { AnalysisContext } from './types/analysis-context.type';
import type { IntelligentAnalysisOutput } from './types/intelligent-analysis.types';

/**
 * Orchestrates the complete intelligent NLP analysis workflow for one
 * collection job.
 *
 * The service coordinates both:
 * - The deterministic rule-based NLP pipeline.
 * - The optional evidence-grounded AI-enhancement layer.
 *
 * Processing flow:
 * 1. Load collected posts, comments, domain context, and location data.
 * 2. Clean, deduplicate, classify, and filter collected text.
 * 3. Run lexicon analysis and sentiment refinement.
 * 4. Extract keywords, topics, recurring problems, user needs,
 *    feature requests, and software opportunities.
 * 5. Build the authoritative rule-based analysis output.
 * 6. Calculate analysis-quality and text-complexity metrics.
 * 7. Decide whether rule-based analysis is sufficient.
 * 8. Run optional AI enhancement only when the decision layer requests it.
 * 9. Persist exactly one final analysis result.
 *
 * Rule-based statistics, frequencies, source evidence, and data-quality
 * values remain authoritative. The AI layer may only add or refine
 * evidence-supported semantic results through AnalysisMergeService.
 *
 * Responsibilities:
 * - Coordinate all NLP pipeline stages in the correct order.
 * - Build the shared AnalysisContext.
 * - Calculate rule-based quality metrics.
 * - Calculate linguistic and analytical complexity metrics.
 * - Obtain an explainable enhancement decision.
 * - Build traceable evidence for optional AI enhancement.
 * - Gracefully preserve the rule-based result when AI is skipped,
 *   unavailable, invalid, or fails.
 * - Persist and return the final analysis.
 *
 * This service does not:
 * - Implement individual NLP extraction algorithms.
 * - Select AI providers or models.
 * - Implement retries, fallback, timeout handling, or provider logging.
 * - Validate or merge AI responses directly.
 *
 * Those responsibilities remain delegated to focused services.
 *
 * @author Eman
 */
@Injectable()
export class IntelligentAnalysisService {
  constructor(
    private readonly textInputBuilderService: TextInputBuilderService,
    private readonly textPreprocessingService: TextPreprocessingService,
    private readonly lexiconAnalysisService: LexiconAnalysisService,
    private readonly sentimentAnalysisService: SentimentAnalysisService,
    private readonly keywordExtractionService: KeywordExtractionService,
    private readonly topicExtractionService: TopicExtractionService,
    private readonly problemInsightService: ProblemInsightService,
    private readonly needExtractionService: NeedExtractionService,
    private readonly featureRequestExtractionService: FeatureRequestExtractionService,
    private readonly opportunityAnalysisService: OpportunityAnalysisService,
    private readonly analysisStatisticsService: AnalysisStatisticsService,
    private readonly analysisEvidenceService: AnalysisEvidenceService,
    private readonly analysisMetricsService: AnalysisMetricsService,
    private readonly textComplexityAnalysisService: TextComplexityAnalysisService,
    private readonly analysisDecisionService: AnalysisDecisionService,
    private readonly analysisOutputBuilderService: AnalysisOutputBuilderService,
    private readonly aiEnhancementService: AiEnhancementService,
    private readonly nlpPersistenceService: NlpPersistenceService,
  ) {}

  /**
   * Runs the complete intelligent NLP analysis for one collection job.
   *
   * Re-running analysis for the same collection job updates the
   * existing persisted record instead of creating a duplicate.
   *
   * AI enhancement is attempted only when the deterministic decision
   * layer returns AI_ENHANCEMENT_REQUIRED. All other outcomes preserve
   * the rule-based result.
   *
   * @param collectionJobId Collection job containing posts and comments.
   * @returns Final persisted intelligent-analysis output.
   */
  async analyze(collectionJobId: string): Promise<IntelligentAnalysisOutput> {
    const inputContext =
      await this.textInputBuilderService.build(collectionJobId);

    const preprocessingOutput = this.textPreprocessingService.process(
      inputContext.inputs,
      inputContext.domain.keywords,
    );

    const lexiconOutput = await this.lexiconAnalysisService.analyze(
      preprocessingOutput.texts,
      preprocessingOutput.initialAnalysisResults,
    );

    const analyzedTexts = this.sentimentAnalysisService.analyze(
      lexiconOutput.analyzedTexts,
    );

    const keywords = this.keywordExtractionService.extract(analyzedTexts);

    const dominantLanguage =
      this.analysisStatisticsService.detectDominantLanguage(analyzedTexts);

    const topics = await this.topicExtractionService.extract(
      keywords,
      dominantLanguage,
    );

    const recurringProblems = this.problemInsightService.extract(analyzedTexts);

    const extractedNeeds = this.needExtractionService.extract(analyzedTexts);

    const featureRequests =
      this.featureRequestExtractionService.extract(analyzedTexts);

    const opportunities = this.opportunityAnalysisService.extract(
      recurringProblems,
      extractedNeeds,
      topics,
      keywords,
    );

    const context: AnalysisContext = {
      collectionJobId: inputContext.collectionJobId,
      domain: inputContext.domain,
      location: inputContext.location,
      platforms: inputContext.platforms,

      preprocessing: {
        duplicateTextsRemoved: preprocessingOutput.duplicateTextsRemoved,
        irrelevantTextsRemoved: preprocessingOutput.irrelevantTextsRemoved,
        spamTextsRemoved: 0,
      },

      analyzedTexts,
      keywords,
      topics,
      recurringProblems,
      extractedNeeds,
      featureRequests,
      opportunities,
    };

    const builtRuleBasedOutput =
      this.analysisOutputBuilderService.build(context);

    const qualityMetrics = this.analysisMetricsService.calculate({
      totalTextsAnalyzed: builtRuleBasedOutput.totalTextsAnalyzed,
      dataQuality: builtRuleBasedOutput.dataQuality,
      keywords: builtRuleBasedOutput.keywords,
      topics: builtRuleBasedOutput.topics,
      recurringProblems: builtRuleBasedOutput.recurringProblems,
      extractedNeeds: builtRuleBasedOutput.extractedNeeds,
      featureRequests: builtRuleBasedOutput.featureRequests,
      opportunities: builtRuleBasedOutput.opportunities,
      analyzedTexts: builtRuleBasedOutput.analyzedTexts,
    });

    /*
     * AnalysisMetricsService owns the final deterministic rule-based
     * confidence calculation. The output is therefore normalized to
     * that authoritative metric before decision evaluation.
     */
    const ruleBasedOutput: IntelligentAnalysisOutput = {
      ...builtRuleBasedOutput,
      confidence: qualityMetrics.confidence,
      aiUsed: false,
    };

    const complexityMetrics = this.textComplexityAnalysisService.analyze({
      analyzedTexts: ruleBasedOutput.analyzedTexts,
      topics: ruleBasedOutput.topics,
    });

    const decision = this.analysisDecisionService.decide({
      totalAnalyzedTexts: ruleBasedOutput.totalTextsAnalyzed,
      qualityMetrics,
      complexityMetrics,
    });

    const finalOutput = await this.resolveFinalOutput(
      ruleBasedOutput,
      decision.action,
      decision.reasons.map((reason) => `${reason.code}: ${reason.message}`),
      {
        averageTextLength: complexityMetrics.averageTextLength,
        negationRatio: complexityMetrics.negationRatio,
        contrastRatio: complexityMetrics.contrastRatio,
        mixedSentimentRatio: complexityMetrics.mixedSentimentRatio,
        lowConfidenceRatio: complexityMetrics.lowConfidenceRatio,
        multiTopicRatio: complexityMetrics.multiTopicRatio,
        unmatchedLexiconRatio: complexityMetrics.unmatchedLexiconRatio,
        complexityScore: complexityMetrics.complexityScore,
      },
      {
        confidence: qualityMetrics.confidence,
        resultDensity: qualityMetrics.resultDensity,
        evidenceCoverage: qualityMetrics.evidenceCoverage,
        dataRetentionRate: qualityMetrics.dataRetentionRate,
        lexicalCoverage: qualityMetrics.lexicalCoverage,
        ruleBasedSuitabilityScore: decision.ruleBasedSuitabilityScore,
      },
    );

    const persistenceCommand =
      IntelligentAnalysisPersistenceMapper.toCommand(finalOutput);

    await this.nlpPersistenceService.saveAnalysis(persistenceCommand);

    return finalOutput;
  }

  /**
   * Resolves whether the final result should remain rule-based or
   * pass through optional AI enhancement.
   *
   * INSUFFICIENT_DATA and RULE_BASED_ONLY both bypass the AI client.
   * AI_ENHANCEMENT_REQUIRED delegates the complete enhancement flow to
   * AiEnhancementService.
   *
   * @param ruleBasedOutput Completed rule-based analysis.
   * @param action Decision-layer action.
   * @param decisionReasons Explainable decision reasons.
   * @param complexityMetrics Prompt-safe complexity metrics.
   * @param qualityMetrics Prompt-safe quality metrics.
   * @returns Final analysis safe for persistence.
   */
  private async resolveFinalOutput(
    ruleBasedOutput: IntelligentAnalysisOutput,
    action: AnalysisDecisionAction,
    decisionReasons: readonly string[],
    complexityMetrics: Readonly<Record<string, number>>,
    qualityMetrics: Readonly<Record<string, number>>,
  ): Promise<IntelligentAnalysisOutput> {
    switch (action) {
      case AnalysisDecisionAction.RULE_BASED_ONLY:
      case AnalysisDecisionAction.INSUFFICIENT_DATA:
        return this.aiEnhancementService.skip(ruleBasedOutput).analysis;

      case AnalysisDecisionAction.AI_ENHANCEMENT_REQUIRED: {
        const evidence =
          this.analysisEvidenceService.buildAiEnhancementEvidence(
            ruleBasedOutput.analyzedTexts,
          );

        const result = await this.aiEnhancementService.enhance({
          ruleBasedOutput,
          evidence,
          decisionReasons,
          complexityMetrics,
          qualityMetrics,
        });

        return result.analysis;
      }

      default:
        return this.assertNever(action);
    }
  }

  /**
   * Ensures every AnalysisDecisionAction value is handled explicitly.
   *
   * TypeScript will report a compile-time error when a future enum
   * value is added without updating resolveFinalOutput().
   *
   * @param value Unhandled decision action.
   * @throws Error Always.
   */
  private assertNever(value: never): never {
    throw new Error(
      `Unsupported NLP analysis decision action: ${String(value)}.`,
    );
  }
}
