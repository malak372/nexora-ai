import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { toTitleCase } from '../common/utils/text-formatting.util';

import type { TextAnalysisResult } from '../pipeline/types/intelligent-analysis.types';
import type { FeatureRequest } from './types/feature-request.type';

/**
 * Maximum number of representative evidence samples retained
 * for each extracted feature request.
 *
 * Limiting evidence samples keeps the analysis output concise while
 * preserving enough community context for downstream consumers.
 *
 * @author Eman
 */
const MAX_FEATURE_REQUEST_EVIDENCE_SAMPLES = 3;

/**
 * Internal aggregation state used while grouping feature requests.
 *
 * @author Eman
 */
type FeatureRequestAggregation = {
  /**
   * Human-readable feature-request title.
   */
  readonly feature: string;

  /**
   * Number of distinct analyzed texts supporting the request.
   */
  frequency: number;

  /**
   * Representative community evidence supporting the request.
   */
  readonly evidenceSamples: string[];
};

/**
 * Extracts recurring feature requests from analyzed community texts.
 *
 * This service detects feature-request lexicon matches from posts and
 * comments and converts them into structured aggregated results that can
 * support:
 * - Premium idea outputs.
 * - Opportunity analysis.
 * - AI prompt generation.
 *
 * Responsibilities:
 * - Detect feature-request lexicon matches.
 * - Normalize semantically equivalent request labels.
 * - Group repeated feature requests.
 * - Count distinct supporting texts.
 * - Attach representative evidence samples.
 *
 * This service does not:
 * - Persist extracted results.
 * - Call external AI providers.
 * - Modify the supplied analysis records.
 *
 * @author Eman
 */
@Injectable()
export class FeatureRequestExtractionService {
  /**
   * Extracts and aggregates recurring feature requests from analyzed texts.
   *
   * A feature request is counted at most once per analyzed text, even when
   * the same lexicon term appears multiple times in that text.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Feature requests sorted by descending frequency and then title.
   */
  extract(analyzedTexts: readonly TextAnalysisResult[]): FeatureRequest[] {
    const requestMap = new Map<string, FeatureRequestAggregation>();

    for (const text of analyzedTexts) {
      const matchedRequests =
        text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? [];

      const uniqueRequestsForText =
        this.normalizeUniqueRequests(matchedRequests);

      for (const normalizedRequest of uniqueRequestsForText) {
        const aggregationKey = normalizedRequest.toLocaleLowerCase();

        const current = requestMap.get(aggregationKey);

        if (current) {
          current.frequency += 1;

          this.addEvidenceSample(current.evidenceSamples, text.originalText);

          continue;
        }

        const aggregation: FeatureRequestAggregation = {
          feature: toTitleCase(normalizedRequest),
          frequency: 1,
          evidenceSamples: [],
        };

        this.addEvidenceSample(aggregation.evidenceSamples, text.originalText);

        requestMap.set(aggregationKey, aggregation);
      }
    }

    return [...requestMap.values()]
      .map(({ feature, frequency, evidenceSamples }) => ({
        feature,
        frequency,
        evidenceSamples: [...evidenceSamples],
      }))
      .sort(
        (first, second) =>
          second.frequency - first.frequency ||
          first.feature.localeCompare(second.feature),
      );
  }

  /**
   * Normalizes feature-request labels and removes duplicates found
   * within the same analyzed text.
   *
   * Normalization prevents values such as:
   * - "dark mode"
   * - " Dark Mode "
   * - "DARK MODE"
   *
   * from being counted as different feature requests.
   *
   * @param requests Raw matched feature-request lexicon values.
   * @returns Unique normalized request labels.
   */
  private normalizeUniqueRequests(requests: readonly string[]): string[] {
    const uniqueRequests = new Map<string, string>();

    for (const request of requests) {
      const normalizedRequest = request.trim();

      if (!normalizedRequest) {
        continue;
      }

      const aggregationKey = normalizedRequest.toLocaleLowerCase();

      if (!uniqueRequests.has(aggregationKey)) {
        uniqueRequests.set(aggregationKey, normalizedRequest);
      }
    }

    return [...uniqueRequests.values()];
  }

  /**
   * Adds a representative evidence sample when it is meaningful,
   * unique, and the configured evidence limit has not been reached.
   *
   * @param samples Existing evidence samples.
   * @param sample New evidence candidate.
   */
  private addEvidenceSample(samples: string[], sample: string): void {
    const normalizedSample = sample.trim();

    if (!normalizedSample) {
      return;
    }

    if (samples.length >= MAX_FEATURE_REQUEST_EVIDENCE_SAMPLES) {
      return;
    }

    const sampleAlreadyExists = samples.some(
      (existingSample) =>
        existingSample.toLocaleLowerCase() ===
        normalizedSample.toLocaleLowerCase(),
    );

    if (sampleAlreadyExists) {
      return;
    }

    samples.push(normalizedSample);
  }
}
