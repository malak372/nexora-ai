import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { toTitleCase } from '../common/utils/text-formatting.util';
import { TextAnalysisResult } from '../pipeline/types/intelligent-analysis.types';
import { FeatureRequest } from './types/feature-request.type';

/**
 * Extracts feature requests from analyzed community texts.
 *
 * This service detects repeated feature-request signals from posts and comments
 * and converts them into structured feature requests that can support premium
 * outputs, opportunity analysis, and AI prompt generation.
 *
 * Responsibilities:
 * - Detect feature-request lexicon matches.
 * - Group repeated feature requests.
 * - Count supporting texts.
 * - Attach representative evidence samples.
 *
 * This service does not persist results and does not call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class FeatureRequestExtractionService {
  private readonly maxEvidenceSamples = 3;

  /**
   * Extracts feature requests from analyzed texts.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Feature requests sorted by frequency.
   */
  extract(analyzedTexts: TextAnalysisResult[]): FeatureRequest[] {
    const requestMap = new Map<
      string,
      { frequency: number; evidenceSamples: string[] }
    >();

    for (const text of analyzedTexts) {
      const requests =
        text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? [];

      for (const request of new Set(requests)) {
        const feature = toTitleCase(request);
        const current = requestMap.get(feature) ?? {
          frequency: 0,
          evidenceSamples: [],
        };

        current.frequency += 1;
        this.addEvidenceSample(current.evidenceSamples, text.originalText);

        requestMap.set(feature, current);
      }
    }

    return [...requestMap.entries()]
      .map(([feature, value]) => ({
        feature,
        frequency: value.frequency,
        evidenceSamples: value.evidenceSamples,
      }))
      .sort((first, second) => second.frequency - first.frequency);
  }

  /**
   * Adds a representative evidence sample without duplicates.
   *
   * @param samples Existing evidence samples.
   * @param sample New sample candidate.
   */
  private addEvidenceSample(samples: string[], sample: string): void {
    const normalizedSample = sample.trim();

    if (!normalizedSample) {
      return;
    }

    if (samples.length >= this.maxEvidenceSamples) {
      return;
    }

    if (samples.includes(normalizedSample)) {
      return;
    }

    samples.push(normalizedSample);
  }
}
