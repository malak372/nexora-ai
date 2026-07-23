import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type { IntelligentAnalysisOutput } from '../pipeline/types/intelligent-analysis.types';

import { ProblemNormalizerService } from './problem-normalizer.service';
import { ProblemSeverityPolicyService } from './problem-severity-policy.service';

const MAX_PROBLEM_EVIDENCE_SAMPLES = 3;

type RecurringProblem = IntelligentAnalysisOutput['recurringProblems'][number];

type ProblemAccumulator = {
  frequency: number;
  negativeSignals: number;
  urgencySignals: number;
  evidenceSamples: string[];
};

/**
 * Extracts recurring problem insights from lexicon-analyzed community texts.
 *
 * This service transforms low-level lexicon matches into structured recurring
 * problems that support evidence-based software project idea generation.
 *
 * Responsibilities:
 * - Detect problem-related signals from analyzed posts and comments.
 * - Group semantically related terms according to the text language.
 * - Count the number of supporting community texts.
 * - Estimate severity using a dedicated policy service.
 * - Attach representative evidence samples.
 * - Return deterministically ranked recurring problems.
 *
 * This service does not persist results or call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class ProblemInsightService {
  constructor(
    private readonly problemNormalizerService: ProblemNormalizerService,
    private readonly problemSeverityPolicyService: ProblemSeverityPolicyService,
  ) {}

  /**
   * Extracts recurring problems from lexicon-enriched text results.
   *
   * Each text contributes at most once to the frequency of a normalized
   * problem, even when multiple matching terms from that text belong to the
   * same problem group.
   *
   * @param analyzedTexts Lexicon-enriched analyzed texts.
   * @param limit Optional maximum number of results.
   * @returns Recurring problems sorted by frequency and severity.
   */
  extract(
    analyzedTexts: ReadonlyArray<LexiconTextAnalysisResult>,
    limit?: number,
  ): RecurringProblem[] {
    const problemMap = new Map<string, ProblemAccumulator>();

    for (const text of analyzedTexts) {
      if (!this.shouldAnalyzeText(text)) {
        continue;
      }

      const normalizedProblems = new Set(
        this.extractProblemTerms(text)
          .map((term) =>
            this.problemNormalizerService.normalize(term, text.language),
          )
          .filter((title) => title.length > 0),
      );

      for (const title of normalizedProblems) {
        const current = problemMap.get(title) ?? this.createAccumulator();

        current.frequency += 1;

        if (text.sentiment === Sentiment.NEGATIVE) {
          current.negativeSignals += 1;
        }

        if (this.hasUrgencySignal(text)) {
          current.urgencySignals += 1;
        }

        this.addEvidenceSample(current.evidenceSamples, text.originalText);

        problemMap.set(title, current);
      }
    }

    const results: RecurringProblem[] = [...problemMap.entries()]
      .map(([title, accumulator]) => ({
        title,
        frequency: accumulator.frequency,
        severity: this.problemSeverityPolicyService.calculate({
          frequency: accumulator.frequency,
          negativeSignals: accumulator.negativeSignals,
          urgencySignals: accumulator.urgencySignals,
        }),
        evidenceSamples: accumulator.evidenceSamples,
      }))
      .sort((first, second) => {
        if (second.frequency !== first.frequency) {
          return second.frequency - first.frequency;
        }

        const severityDifference =
          this.problemSeverityPolicyService.getWeight(second.severity) -
          this.problemSeverityPolicyService.getWeight(first.severity);

        if (severityDifference !== 0) {
          return severityDifference;
        }

        return first.title.localeCompare(second.title);
      });

    const normalizedLimit = this.normalizeLimit(limit);

    return normalizedLimit === undefined
      ? results
      : results.slice(0, normalizedLimit);
  }

  /**
   * Determines whether a text should contribute to problem extraction.
   *
   * Negative sentiment or explicit problem/complaint signals are required.
   * This avoids interpreting neutral mentions of cost, time, safety, or
   * reliability as confirmed community problems.
   *
   * @param text Lexicon-enriched text.
   * @returns True when the text contains problem-worthy signals.
   */
  private shouldAnalyzeText(text: LexiconTextAnalysisResult): boolean {
    return (
      text.sentiment === Sentiment.NEGATIVE ||
      this.hasLexiconMatches(text, NlpLexiconType.PROBLEM) ||
      this.hasLexiconMatches(text, NlpLexiconType.COMPLAINT)
    );
  }

  /**
   * Extracts all problem-related lexicon terms from one text.
   *
   * @param text Lexicon-enriched text.
   * @returns Cleaned problem-related terms.
   */
  private extractProblemTerms(text: LexiconTextAnalysisResult): string[] {
    const relevantTypes: ReadonlyArray<NlpLexiconType> = [
      NlpLexiconType.PROBLEM,
      NlpLexiconType.COMPLAINT,
      NlpLexiconType.TIME,
      NlpLexiconType.COST,
      NlpLexiconType.ACCESSIBILITY,
      NlpLexiconType.SAFETY,
      NlpLexiconType.RELIABILITY,
    ];

    return relevantTypes
      .flatMap((type) => text.matchedLexicons[type] ?? [])
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
  }

  /**
   * Checks whether a text contains urgency signals.
   *
   * @param text Lexicon-enriched text.
   * @returns True when urgency terms were matched.
   */
  private hasUrgencySignal(text: LexiconTextAnalysisResult): boolean {
    return this.hasLexiconMatches(text, NlpLexiconType.URGENCY);
  }

  /**
   * Checks whether a text contains matches for one lexicon type.
   *
   * @param text Lexicon-enriched text.
   * @param type Lexicon category.
   * @returns True when at least one term was matched.
   */
  private hasLexiconMatches(
    text: LexiconTextAnalysisResult,
    type: NlpLexiconType,
  ): boolean {
    return (text.matchedLexicons[type] ?? []).length > 0;
  }

  /**
   * Creates an empty accumulator for one problem group.
   *
   * @returns Empty problem accumulator.
   */
  private createAccumulator(): ProblemAccumulator {
    return {
      frequency: 0,
      negativeSignals: 0,
      urgencySignals: 0,
      evidenceSamples: [],
    };
  }

  /**
   * Adds a unique and non-empty evidence sample.
   *
   * @param samples Existing evidence samples.
   * @param sample New sample candidate.
   */
  private addEvidenceSample(samples: string[], sample: string): void {
    const normalizedSample = sample.trim();

    if (
      normalizedSample.length === 0 ||
      samples.length >= MAX_PROBLEM_EVIDENCE_SAMPLES ||
      samples.includes(normalizedSample)
    ) {
      return;
    }

    samples.push(normalizedSample);
  }

  /**
   * Normalizes the optional result limit.
   *
   * Invalid, zero, and negative values produce an empty result collection.
   *
   * @param limit Requested result limit.
   * @returns Normalized integer limit or undefined.
   */
  private normalizeLimit(limit?: number): number | undefined {
    if (limit === undefined) {
      return undefined;
    }

    if (!Number.isFinite(limit) || limit <= 0) {
      return 0;
    }

    return Math.floor(limit);
  }
}
