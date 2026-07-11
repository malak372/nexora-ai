import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AiExecutionNlpClient } from './ai-enhancement/clients/ai-execution-nlp.client';
import { AiAnalysisOutputValidatorService } from './ai-enhancement/services/ai-analysis-output-validator.service';
import { AiAnalysisPromptBuilderService } from './ai-enhancement/services/ai-analysis-prompt-builder.service';
import { AiEnhancementService } from './ai-enhancement/services/ai-enhancement.service';
import { AnalysisMergeService } from './ai-enhancement/services/analysis-merge.service';
import { NLP_AI_CLIENT } from './ai-enhancement/tokens/nlp-ai-client.token';

import { AnalysisMetricsService } from './analysis/analysis-metrics.service';
import { FeatureRequestExtractionService } from './analysis/feature-request-extraction.service';
import { KeywordExtractionService } from './analysis/keyword-extraction.service';
import { NeedExtractionService } from './analysis/need-extraction.service';
import { OpportunityAnalysisService } from './analysis/opportunity-analysis.service';
import { SentimentAnalysisService } from './analysis/sentiment-analysis.service';
import { SentimentScoringPolicyService } from './analysis/sentiment-scoring-policy.service';
import { TopicExtractionService } from './analysis/topic-extraction.service';

import { AnalysisDecisionService } from './decision/analysis-decision.service';
import { TextComplexityAnalysisService } from './decision/text-complexity-analysis.service';

import { DomainRelevanceService } from './domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from './language-detection/language-detection.service';

import { LexiconAnalysisService } from './lexicon/lexicon-analysis.service';
import { NlpLexiconService } from './lexicon/nlp-lexicon.service';

import { NlpPersistenceService } from './persistence/nlp-persistence.service';

import { AnalysisEvidenceService } from './pipeline/analysis-evidence.service';
import { AnalysisOutputBuilderService } from './pipeline/analysis-output-builder.service';
import { AnalysisStatisticsService } from './pipeline/analysis-statistics.service';
import { IntelligentAnalysisService } from './pipeline/intelligent-analysis.service';
import { TextInputBuilderService } from './pipeline/text-input-builder.service';
import { TextPreprocessingService } from './pipeline/text-preprocessing.service';

import { ProblemsModule } from './problems/problems.module';

import { TextCleaningService } from './text-cleaning/text-cleaning.service';
import { TopicRuleService } from './topic-rules/topic-rule.service';

/**
 * NLP module for Nexora AI.
 *
 * This module assembles the complete rule-based NLP pipeline and the
 * optional AI-enhancement layer responsible for transforming collected
 * community posts and comments into structured, evidence-supported
 * analysis for software project discovery and idea generation.
 *
 * Rule-based NLP responsibilities:
 * - Build unified inputs from collected posts and comments.
 * - Clean and normalize raw community content.
 * - Resolve or detect text language.
 * - Filter unrelated content by domain relevance.
 * - Perform lexicon-based semantic analysis.
 * - Refine sentiment through reusable scoring policies.
 * - Extract keywords, topics, recurring problems, user needs,
 *   feature requests, and software opportunities.
 * - Calculate statistics, quality metrics, confidence, and text
 *   complexity.
 * - Decide whether the rule-based result requires optional AI
 *   enhancement.
 * - Build and persist the final intelligent-analysis output.
 *
 * AI-enhancement responsibilities:
 * - Build provider-neutral NLP enhancement prompts.
 * - Execute structured NLP enhancement requests through AiModule.
 * - Validate structured AI responses before they enter the pipeline.
 * - Reject unsupported or fabricated evidence references.
 * - Conservatively merge validated AI output with rule-based results.
 * - Preserve the original rule-based analysis when AI enhancement
 *   is unavailable, invalid, or fails.
 *
 * The NLP layer depends on the NLP_AI_CLIENT injection token instead
 * of depending directly on provider SDK implementations.
 *
 * AiExecutionNlpClient is registered as the production adapter between
 * the NLP enhancement layer and the central AiExecutionService.
 *
 * AiModule is imported because AiExecutionNlpClient depends on the
 * exported AiExecutionService.
 *
 * PrismaModule is imported because NLP services retrieve configurable
 * resources and collected data from the database, including:
 * - Domain keywords.
 * - NLP lexicons.
 * - Topic rules.
 * - Social posts and comments.
 * - Existing NLP analysis records.
 *
 * ProblemsModule is imported and re-exported because recurring-problem
 * extraction is maintained as a dedicated feature module.
 *
 * @author Eman
 */
@Module({
  imports: [
    AiModule,
    PrismaModule,
    ProblemsModule,
  ],

  providers: [
    /**
     * Text preparation and preprocessing.
     */
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
    TextInputBuilderService,
    TextPreprocessingService,

    /**
     * Lexicon and rule-based semantic analysis.
     */
    NlpLexiconService,
    LexiconAnalysisService,
    SentimentScoringPolicyService,
    SentimentAnalysisService,
    KeywordExtractionService,
    TopicRuleService,
    TopicExtractionService,
    NeedExtractionService,
    FeatureRequestExtractionService,
    OpportunityAnalysisService,

    /**
     * Statistics, evidence, quality, decision, and output construction.
     */
    AnalysisStatisticsService,
    AnalysisEvidenceService,
    AnalysisMetricsService,
    TextComplexityAnalysisService,
    AnalysisDecisionService,
    AnalysisOutputBuilderService,

    /**
     * Optional AI-enhancement layer.
     */
    AiAnalysisPromptBuilderService,
    AiAnalysisOutputValidatorService,
    AnalysisMergeService,
    AiEnhancementService,

    /**
     * Production NLP AI client.
     *
     * This adapter delegates provider selection, retries, timeouts,
     * fallback execution, health tracking, and external API logging
     * to the central AiExecutionService.
     */
    AiExecutionNlpClient,

    {
      provide: NLP_AI_CLIENT,
      useExisting: AiExecutionNlpClient,
    },

    /**
     * Persistence and complete pipeline orchestration.
     */
    NlpPersistenceService,
    IntelligentAnalysisService,
  ],

  exports: [
    /**
     * Main intelligent NLP pipeline.
     */
    IntelligentAnalysisService,

    /**
     * Optional AI-enhancement orchestrator.
     */
    AiEnhancementService,

    /**
     * Reusable text-preparation services.
     */
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
    TextInputBuilderService,
    TextPreprocessingService,

    /**
     * Reusable analysis and output services.
     */
    AnalysisStatisticsService,
    AnalysisEvidenceService,
    AnalysisOutputBuilderService,
    NlpLexiconService,
    LexiconAnalysisService,
    SentimentScoringPolicyService,
    SentimentAnalysisService,
    KeywordExtractionService,
    TopicRuleService,
    TopicExtractionService,
    NeedExtractionService,
    FeatureRequestExtractionService,
    OpportunityAnalysisService,

    /**
     * NLP persistence service.
     */
    NlpPersistenceService,

    /**
     * Recurring-problem feature module.
     */
    ProblemsModule,
  ],
})
export class NlpModule { }