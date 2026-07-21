import { BadRequestException, Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { toTitleCase } from '../common/utils/text-formatting.util';

import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type {
  IntelligentAnalysisOutput,
  PriorityLevel,
} from '../pipeline/types/intelligent-analysis.types';

/**
 * Maximum number of representative evidence samples retained
 * for each extracted need.
 */
const MAX_NEED_EVIDENCE_SAMPLES = 3;

/**
 * Minimum supporting-text frequency required for medium priority.
 */
const MEDIUM_PRIORITY_FREQUENCY_THRESHOLD = 3;

/**
 * Minimum supporting-text frequency required for high priority.
 */
const HIGH_PRIORITY_FREQUENCY_THRESHOLD = 5;

/**
 * Numeric weights used to sort extracted needs by priority.
 */
const PRIORITY_WEIGHTS: Readonly<Record<PriorityLevel, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

type ExtractedNeed = IntelligentAnalysisOutput['extractedNeeds'][number];

/**
 * Internal aggregation state for one normalized need.
 */
type NeedAccumulator = {
  /**
   * Human-readable need statement.
   */
  readonly need: string;

  /**
   * Number of distinct analyzed texts supporting the need.
   */
  frequency: number;

  /**
   * Indicates whether the need was detected as an explicit
   * feature-request signal.
   */
  hasFeatureRequestSignal: boolean;

  /**
   * Representative evidence samples supporting the need.
   */
  readonly evidenceSamples: string[];

  /**
   * Optional related problem associated with the need.
   */
  relatedProblem?: string;
};

/**
 * Extracts user needs and unmet requirements from analyzed community texts.
 *
 * This service transforms explicit need signals and feature-request signals
 * into structured needs that help Nexora AI understand what users expect from
 * a potential software solution.
 *
 * Responsibilities:
 * - Detect explicit need-related lexicon matches.
 * - Detect feature-request signals from analyzed texts.
 * - Group repeated needs into stable need statements.
 * - Count each need once per analyzed text.
 * - Attach representative evidence samples.
 * - Calculate need priority.
 * - Produce structured needs for opportunity analysis and prompt building.
 *
 * This service does not:
 * - Persist extracted results.
 * - Call external AI providers.
 * - Modify the supplied analysis records.
 *
 * @author Eman
 */
@Injectable()
export class NeedExtractionService {
  /**
   * Extracts user needs from lexicon-enriched text-analysis results.
   *
   * When a limit is supplied, only the highest-ranked needs are returned.
   * Without a limit, all extracted needs are returned.
   *
   * @param analyzedTexts Lexicon-enriched analyzed texts.
   * @param limit Optional maximum number of needs to return.
   * @returns Extracted needs sorted by priority, frequency, and name.
   *
   * @throws BadRequestException when the supplied limit is invalid.
   */
  extract(
    analyzedTexts: readonly LexiconTextAnalysisResult[],
    limit?: number,
  ): ExtractedNeed[] {
    this.validateLimit(limit);

    const needMap = new Map<string, NeedAccumulator>();

    for (const text of analyzedTexts) {
      const uniqueNeedsForText = this.extractUniqueNeedTerms(text);
      const featureRequestKeys = this.extractFeatureRequestKeys(text);

      for (const [needKey, normalizedNeed] of uniqueNeedsForText) {
        const current =
          needMap.get(needKey) ?? this.createAccumulator(normalizedNeed);

        current.frequency += 1;
        current.hasFeatureRequestSignal =
          current.hasFeatureRequestSignal || featureRequestKeys.has(needKey);

        this.addEvidenceSample(current.evidenceSamples, text.originalText);

        needMap.set(needKey, current);
      }
    }

    const sortedNeeds = [...needMap.values()].sort((first, second) => {
      const firstPriority = this.calculatePriority(first);
      const secondPriority = this.calculatePriority(second);

      return (
        this.priorityWeight(secondPriority) -
          this.priorityWeight(firstPriority) ||
        second.frequency - first.frequency ||
        first.need.localeCompare(second.need)
      );
    });

    const selectedNeeds =
      limit === undefined ? sortedNeeds : sortedNeeds.slice(0, limit);

    return selectedNeeds.map((accumulator) => ({
      need: accumulator.need,
      priority: this.calculatePriority(accumulator),
      relatedProblem: accumulator.relatedProblem,
      evidenceSamples: [...accumulator.evidenceSamples],
    }));
  }

  /**
   * Extracts normalized and unique need-related terms from one analyzed text.
   *
   * Explicit needs and feature requests are combined, then counted at most
   * once per text using a normalized case-insensitive key.
   *
   * @param text Lexicon-enriched text-analysis result.
   * @returns Map of normalized keys to readable need statements.
   */
  private extractUniqueNeedTerms(
    text: LexiconTextAnalysisResult,
  ): ReadonlyMap<string, string> {
    const uniqueNeeds = new Map<string, string>();

    const matchedTerms = [
      ...(text.matchedLexicons[NlpLexiconType.NEED] ?? []),
      ...(text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? []),
    ];

    for (const term of matchedTerms) {
      const normalizedTerm = this.normalizeTerm(term);

      if (!normalizedTerm) {
        continue;
      }

      const needKey = this.createAggregationKey(normalizedTerm);

      if (!uniqueNeeds.has(needKey)) {
        uniqueNeeds.set(needKey, toTitleCase(normalizedTerm));
      }
    }

    return uniqueNeeds;
  }

  /**
   * Extracts normalized aggregation keys for feature-request signals
   * detected in one analyzed text.
   *
   * @param text Lexicon-enriched text-analysis result.
   * @returns Set of normalized feature-request keys.
   */
  private extractFeatureRequestKeys(
    text: LexiconTextAnalysisResult,
  ): ReadonlySet<string> {
    const featureRequestTerms =
      text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? [];

    const keys = featureRequestTerms
      .map((term) => this.normalizeTerm(term))
      .filter(Boolean)
      .map((term) => this.createAggregationKey(term));

    return new Set(keys);
  }

  /**
   * Normalizes a raw need term for stable grouping.
   *
   * @param term Raw need-related term.
   * @returns Normalized need term.
   */
  private normalizeTerm(term: string): string {
    return term
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  /**
   * Creates a case-insensitive key used to aggregate equivalent needs.
   *
   * @param normalizedTerm Normalized need term.
   * @returns Stable aggregation key.
   */
  private createAggregationKey(normalizedTerm: string): string {
    return normalizedTerm.toLocaleLowerCase();
  }

  /**
   * Calculates need priority using total supporting-text frequency and
   * explicit feature-request strength.
   *
   * @param accumulator Aggregated need information.
   * @returns Calculated need priority.
   */
  private calculatePriority(accumulator: NeedAccumulator): PriorityLevel {
    if (
      accumulator.hasFeatureRequestSignal ||
      accumulator.frequency >= HIGH_PRIORITY_FREQUENCY_THRESHOLD
    ) {
      return 'HIGH';
    }

    if (accumulator.frequency >= MEDIUM_PRIORITY_FREQUENCY_THRESHOLD) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Creates an empty accumulator for one extracted need.
   *
   * @param need Human-readable need statement.
   * @returns Initial need aggregation state.
   */
  private createAccumulator(need: string): NeedAccumulator {
    return {
      need,
      frequency: 0,
      hasFeatureRequestSignal: false,
      evidenceSamples: [],
    };
  }

  /**
   * Adds a meaningful and unique representative evidence sample.
   *
   * @param samples Existing evidence samples.
   * @param sample New evidence candidate.
   */
  private addEvidenceSample(samples: string[], sample: string): void {
    const normalizedSample = sample.trim();

    if (!normalizedSample || samples.length >= MAX_NEED_EVIDENCE_SAMPLES) {
      return;
    }

    const sampleAlreadyExists = samples.some(
      (existingSample) =>
        existingSample.toLocaleLowerCase() ===
        normalizedSample.toLocaleLowerCase(),
    );

    if (!sampleAlreadyExists) {
      samples.push(normalizedSample);
    }
  }

  /**
   * Converts a priority level into a sortable numeric weight.
   *
   * @param priority Priority level.
   * @returns Numeric priority weight.
   */
  private priorityWeight(priority: PriorityLevel): number {
    return PRIORITY_WEIGHTS[priority];
  }

  /**
   * Validates the optional result limit.
   *
   * @param limit Optional maximum number of returned needs.
   * @throws BadRequestException when the limit is not a positive integer.
   */
  private validateLimit(limit?: number): void {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new BadRequestException(
        'Need extraction limit must be a positive integer.',
      );
    }
  }
}
