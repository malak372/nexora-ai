import { Injectable } from '@nestjs/common';

import { FeatureRequestExtractionService } from '../analysis/feature-request-extraction.service';
import { KeywordExtractionService } from '../analysis/keyword-extraction.service';
import { NeedExtractionService } from '../analysis/need-extraction.service';
import { OpportunityAnalysisService } from '../analysis/opportunity-analysis.service';
import { SentimentAnalysisService } from '../analysis/sentiment-analysis.service';
import { TopicExtractionService } from '../analysis/topic-extraction.service';
import { LexiconAnalysisService } from '../lexicon/lexicon-analysis.service';
import { IntelligentAnalysisPersistenceMapper } from '../persistence/mappers/intelligent-analysis-persistence.mapper';
import { NlpPersistenceService } from '../persistence/nlp-persistence.service';
import { ProblemInsightService } from '../problems/problem-insight.service';

import { AnalysisOutputBuilderService } from './analysis-output-builder.service';
import { AnalysisStatisticsService } from './analysis-statistics.service';
import { TextInputBuilderService } from './text-input-builder.service';
import { TextPreprocessingService } from './text-preprocessing.service';
import type { AnalysisContext } from './types/analysis-context.type';
import type { IntelligentAnalysisOutput } from './types/intelligent-analysis.types';

/**
 * Orchestrates the complete rule-based intelligent NLP analysis pipeline.
 *
 * This service coordinates the workflow that transforms collected community
 * posts and comments into structured insights used by persistence, prompt
 * building, and AI-based software project idea generation.
 *
 * Responsibilities:
 * - Build unified text inputs from a collection job.
 * - Run preprocessing, lexicon analysis, and sentiment refinement.
 * - Coordinate keyword, topic, problem, need, feature request, and
 *   opportunity extraction.
 * - Store intermediate pipeline state inside AnalysisContext.
 * - Delegate final output construction to AnalysisOutputBuilderService.
 * - Persist the final aggregated NLP analysis result.
 *
 * This service does not call external AI services.
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
        private readonly analysisOutputBuilderService: AnalysisOutputBuilderService,
        private readonly nlpPersistenceService: NlpPersistenceService,
    ) { }

    /**
     * Runs the complete rule-based NLP analysis for a collection job
     * and persists the final aggregated result.
     *
     * Re-running the analysis for the same collection job updates the
     * existing persisted analysis instead of creating a duplicate.
     *
     * @param collectionJobId Collection job ID containing collected posts
     * and comments.
     * @returns Structured intelligent NLP analysis output.
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

        const recurringProblems =
            this.problemInsightService.extract(analyzedTexts);

        const extractedNeeds =
            this.needExtractionService.extract(analyzedTexts);

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
                duplicateTextsRemoved:
                    preprocessingOutput.duplicateTextsRemoved,
                irrelevantTextsRemoved:
                    preprocessingOutput.irrelevantTextsRemoved,
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

        const output = this.analysisOutputBuilderService.build(context);

        const persistenceCommand =
            IntelligentAnalysisPersistenceMapper.toCommand(output);

        await this.nlpPersistenceService.saveAnalysis(persistenceCommand);

        return output;
    }
}