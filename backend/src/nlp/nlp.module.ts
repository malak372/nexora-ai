import { Module } from '@nestjs/common';

import { DomainRelevanceService } from './domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from './language-detection/language-detection.service';
import { NlpLexiconService } from './lexicon/nlp-lexicon.service';
import { TextCleaningService } from './text-cleaning/text-cleaning.service';

/**
 * NLP module responsible for text preprocessing and linguistic analysis.
 *
 * This module provides the core services used throughout the Nexora AI
 * NLP pipeline, including:
 * - Text preprocessing and normalization.
 * - Language detection.
 * - Domain relevance filtering.
 * - Database-driven NLP lexicon management.
 *
 * Additional analysis services (such as sentiment analysis, keyword
 * extraction, and recurring problem detection) will build on these
 * foundational services.
 *
 * @author Eman
 */
@Module({
  providers: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
    NlpLexiconService,
  ],
  exports: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
    NlpLexiconService,
  ],
})
export class NlpModule { }