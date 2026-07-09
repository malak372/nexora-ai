import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { DomainRelevanceService } from './domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from './language-detection/language-detection.service';
import { TextCleaningService } from './text-cleaning/text-cleaning.service';
import { TextInputBuilderService } from './pipeline/text-input-builder.service';
import { TextPreprocessingService } from './pipeline/text-preprocessing.service';
import { LexiconAnalysisService } from './lexicon/lexicon-analysis.service';
import { NlpLexiconService } from './lexicon/nlp-lexicon.service';

/**
 * NLP module for Nexora AI.
 *
 * This module groups the core services responsible for preparing, filtering,
 * and analyzing collected community content before it is used for AI-based
 * software project idea generation.
 *
 * Responsibilities:
 * - Build unified text inputs from collected posts and comments.
 * - Clean and normalize raw social content.
 * - Remove duplicate and empty community texts.
 * - Detect or validate text language.
 * - Filter texts by selected software domain relevance.
 * - Match texts against configurable NLP lexicons.
 * - Provide reusable NLP services for intelligent analysis and prompt building.
 *
 * The module imports PrismaModule because NLP services may need access to
 * collection jobs, domain keywords, social posts, social comments, NLP lexicons,
 * and persisted analysis results.
 *
 * @author Eman
 */
@Module({
  imports: [PrismaModule],
  providers: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
    TextInputBuilderService,
    TextPreprocessingService,
    NlpLexiconService,
    LexiconAnalysisService,
  ],
  exports: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
    TextInputBuilderService,
    TextPreprocessingService,
    NlpLexiconService,
    LexiconAnalysisService,
  ],
})
export class NlpModule { }