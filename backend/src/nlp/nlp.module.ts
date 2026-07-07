import { Module } from '@nestjs/common';

import { DomainRelevanceService } from './domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from './language-detection/language-detection.service';
import { TextCleaningService } from './text-cleaning/text-cleaning.service';

@Module({
  providers: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
  ],
  exports: [
    TextCleaningService,
    LanguageDetectionService,
    DomainRelevanceService,
  ],
})
export class NlpModule { }