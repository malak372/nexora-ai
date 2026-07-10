import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { FeatureRequestExtractionService } from './analysis/feature-request-extraction.service';
import { KeywordExtractionService } from './analysis/keyword-extraction.service';
import { NeedExtractionService } from './analysis/need-extraction.service';
import { OpportunityAnalysisService } from './analysis/opportunity-analysis.service';
import { SentimentAnalysisService } from './analysis/sentiment-analysis.service';
import { SentimentScoringPolicyService } from './analysis/sentiment-scoring-policy.service';
import { TopicExtractionService } from './analysis/topic-extraction.service';
import { DomainRelevanceService } from './domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from './language-detection/language-detection.service';
import { LexiconAnalysisService } from './lexicon/lexicon-analysis.service';
import { NlpLexiconService } from './lexicon/nlp-lexicon.service';
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
 * This module assembles the complete rule-based NLP engine responsible for
 * transforming collected community posts and comments into structured
 * analytical insights that support software project idea generation.
 *
 * Responsibilities:
 * - Build unified NLP inputs from collected social content.
 * - Clean and normalize raw community texts.
 * - Detect text language.
 * - Filter content by domain relevance.
 * - Perform lexicon-based semantic analysis.
 * - Refine sentiment using reusable scoring policies.
 * - Extract keywords, topics, needs, feature requests, opportunities, and recurring problems.
 * - Build final analysis outputs through dedicated pipeline builder services.
 * - Orchestrate the full intelligent analysis pipeline.
 *
 * The module imports PrismaModule because several NLP services retrieve
 * configurable analysis resources from the database, including domain
 * keywords, lexicons, topic rules, and collected community content.
 *
 * @author Eman
 */
@Module({
  imports: [PrismaModule, ProblemsModule],
  providers: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,

    TextInputBuilderService,
    TextPreprocessingService,
    AnalysisStatisticsService,
    AnalysisEvidenceService,
    AnalysisOutputBuilderService,
    IntelligentAnalysisService,

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
  ],
  exports: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,

    TextInputBuilderService,
    TextPreprocessingService,
    AnalysisStatisticsService,
    AnalysisEvidenceService,
    AnalysisOutputBuilderService,
    IntelligentAnalysisService,

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

    ProblemsModule,
  ],
})
export class NlpModule {}
