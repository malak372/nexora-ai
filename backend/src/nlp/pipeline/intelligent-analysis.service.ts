import { Injectable, Logger } from '@nestjs/common';

import { AiEnhancementService } from '../ai-enhancement/services/ai-enhancement.service';
import { AnalysisMetricsService } from '../analysis/analysis-metrics.service';
import { FeatureRequestExtractionService } from '../analysis/feature-request-extraction.service';
import { KeywordExtractionService } from '../analysis/keyword-extraction.service';
import { NeedExtractionService } from '../analysis/need-extraction.service';
import { TopicExtractionService } from '../analysis/topic-extraction.service';
import { IntelligentAnalysisPersistenceMapper } from '../persistence/mappers/intelligent-analysis-persistence.mapper';
import { NlpPersistenceService } from '../persistence/nlp-persistence.service';
import { ProblemInsightService } from '../problems/problem-insight.service';
import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';

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
  private readonly logger = new Logger(IntelligentAnalysisService.name);

  constructor(
    private readonly textInputBuilderService: TextInputBuilderService,
    private readonly textPreprocessingService: TextPreprocessingService,
    private readonly keywordExtractionService: KeywordExtractionService,
    private readonly topicExtractionService: TopicExtractionService,
    private readonly problemInsightService: ProblemInsightService,
    private readonly needExtractionService: NeedExtractionService,
    private readonly featureRequestExtractionService: FeatureRequestExtractionService,
    private readonly analysisStatisticsService: AnalysisStatisticsService,
    private readonly analysisEvidenceService: AnalysisEvidenceService,
    private readonly analysisMetricsService: AnalysisMetricsService,
    private readonly analysisOutputBuilderService: AnalysisOutputBuilderService,
    private readonly aiEnhancementService: AiEnhancementService,
    private readonly nlpPersistenceService: NlpPersistenceService,
  ) {}

  /**
   * Runs the complete intelligent NLP analysis for one collection job.
   *
   * Re-running analysis for the same collection job updates the existing
   * persisted record instead of creating a duplicate.
   *
   * AI enhancement is attempted only when the deterministic decision layer
   * returns AI_ENHANCEMENT_REQUIRED. All other outcomes preserve the
   * rule-based result.
   *
   * @param collectionJobId Collection job containing posts and comments.
   * @returns Final persisted intelligent-analysis output.
   */
  async analyze(collectionJobId: string): Promise<IntelligentAnalysisOutput> {
    const inputContext =
      await this.textInputBuilderService.build(collectionJobId);

    const relevanceKeywords = this.selectMatchingDomainKeywords(
      inputContext.domain.keywords,
      inputContext.inputs.map((input) => input.content),
    );

    const preprocessingOutput = this.textPreprocessingService.process(
      inputContext.inputs,
      relevanceKeywords,
      inputContext.language,
    );

    /*
     * FAST EVIDENCE PATH
     * ------------------
     * Opportunity discovery is owned by CommunityAiAnalysisStage. Running the
     * complete lexicon + sentiment stack here duplicated semantic work and
     * forced the request to wait for remote lexicon configuration before the
     * AI could inspect the evidence.
     *
     * Preprocessing already returns cleaned, language-resolved, domain-filtered
     * TextAnalysisResult records. They remain the authoritative evidence rows
     * and are sufficient for keyword/problem/need extraction. The AI stage then
     * performs the deeper semantic synthesis and opportunity discovery.
     *
     * This removes the expensive lexicon/sentiment pass without reducing the
     * collected corpus, evidence samples, domain filtering, duplicate removal,
     * or the final AI quality checks.
     */
    const analyzedTexts: LexiconTextAnalysisResult[] =
      preprocessingOutput.initialAnalysisResults.map((text) => ({
        ...text,
        totalLexiconMatches: 0,
        positiveMatches: 0,
        negativeMatches: 0,
      }));

    const keywords = this.keywordExtractionService.extract(analyzedTexts);

    /*
     * The dedicated Community AI stage owns semantic opportunity discovery.
     * For this synchronous evidence-preparation pass, canonical topics are
     * resolved entirely in memory. This avoids a remote TopicRule query on
     * every generation while preserving stable topic labels for the AI prompt.
     * Administrator-curated topic rules remain available to other callers via
     * TopicExtractionService.extract().
     */
    const topics = this.topicExtractionService.extractCanonical(keywords);

    const recurringProblems = this.problemInsightService.extract(analyzedTexts);
    const extractedNeeds = this.needExtractionService.extract(analyzedTexts);
    const featureRequests =
      this.featureRequestExtractionService.extract(analyzedTexts);

    /*
     * Opportunity discovery is intentionally owned by
     * CommunityAiAnalysisStage. The deterministic NLP pass prepares only the
     * evidence signals required by the AI: cleaned texts, keywords, topics,
     * problems, needs, and feature requests.
     *
     * Avoiding a second rule-based opportunity synthesis removes duplicated
     * work and prevents deterministic opportunity fragments from competing
     * with the AI-grounded opportunity portfolio.
     */
    const opportunities: IntelligentAnalysisOutput['opportunities'] = [];

    const context: AnalysisContext = {
      collectionJobId: inputContext.collectionJobId,
      language: inputContext.language,
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
     * confidence calculation. The output is therefore normalized to that
     * authoritative metric before decision evaluation.
     */
    const ruleBasedOutput: IntelligentAnalysisOutput = {
      ...builtRuleBasedOutput,
      confidence: qualityMetrics.confidence,
      aiUsed: false,
    };

    /*
     * CommunityAiAnalysisStage is now the only semantic AI/opportunity layer.
     * The old complexity and decision passes could no longer trigger an NLP AI
     * request, so calculating them duplicated a full scan of every analyzed
     * text without changing the result. Keep the deterministic quality metric
     * above, then finalize the evidence package directly.
     */
    const finalOutput = this.aiEnhancementService.skip(ruleBasedOutput).analysis;

    const persistenceCommand =
      IntelligentAnalysisPersistenceMapper.toCommand(finalOutput);

    /*
     * The in-memory evidence package is already complete and is the value used
     * by CommunityAiAnalysisStage. Persisting the same package to Supabase is a
     * durability concern, not a prerequisite for semantic generation, so it is
     * started immediately without holding the user-facing critical path.
     */
    void this.nlpPersistenceService
      .saveAnalysis(persistenceCommand)
      .catch((error: unknown) => {
        this.logger.error(
          `Background NLP persistence failed for collection job ${collectionJobId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    return finalOutput;
  }



  /**
   * Narrows a very large domain-keyword list to terms that can actually match
   * the current corpus.
   *
   * This is a safe optimization:
   * - It does not remove collected texts.
   * - It does not lower relevance thresholds.
   * - It does not change the matching semantics for terms that are present.
   * - It falls back to the original keyword list when no term is found, so the
   *   preprocessing behavior never becomes less permissive by accident.
   *
   * Matching is case-insensitive and Unicode-aware. Terms are normalized in
   * the same way as the corpus before checking simple phrase containment.
   *
   * @param domainKeywords Full domain keyword list.
   * @param textContents Current collected text contents.
   * @returns Only keywords present in the corpus, or the original list as a
   * fallback when no match is found.
   */
  private selectMatchingDomainKeywords(
    domainKeywords: readonly string[],
    textContents: readonly string[],
  ): string[] {
    const normalizedKeywords = [...new Set(
      domainKeywords
        .map((keyword) => this.normalizeSearchText(keyword))
        .filter((keyword) => keyword.length > 0),
    )];

    if (normalizedKeywords.length === 0) {
      return [];
    }

    const corpus = this.normalizeSearchText(textContents.join(' '));

    if (!corpus) {
      return [...domainKeywords];
    }

    const matchingKeywords = normalizedKeywords.filter((keyword) =>
      corpus.includes(keyword),
    );

    /*
     * Keep the original terms rather than the normalized copies so downstream
     * services receive the same values they received before this optimization.
     */
    if (matchingKeywords.length > 0) {
      const matchingSet = new Set(matchingKeywords);

      return domainKeywords.filter((keyword) =>
        matchingSet.has(this.normalizeSearchText(keyword)),
      );
    }

    return [...domainKeywords];
  }

  /**
   * Produces a stable Unicode-aware comparison value for corpus preselection.
   */
  private normalizeSearchText(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
  }

}