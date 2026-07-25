import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { isLikelyProductDescription } from '../common/utils/community-evidence.util';
import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';

/** Minimum signed difference required for positive or negative sentiment. */
const MINIMUM_SENTIMENT_DIFFERENCE = 1;

/** Contextual weight applied to an explicit complaint phrase. */
const EXPLICIT_NEGATIVE_PHRASE_WEIGHT = 2;

/** Contextual weight applied to an explicit positive phrase. */
const EXPLICIT_POSITIVE_PHRASE_WEIGHT = 1.25;

/** Additional multiplier for evidence appearing after a contrast marker. */
const CONTRAST_TAIL_MULTIPLIER = 1.75;

/** Maximum contextual score contributed by one polarity. */
const MAX_CONTEXTUAL_POLARITY_SCORE = 8;

/** Lexicon weights that contribute to positive sentiment. */
const POSITIVE_SENTIMENT_WEIGHTS: Readonly<
  Partial<Record<NlpLexiconType, number>>
> = {
  [NlpLexiconType.POSITIVE]: 2,
  [NlpLexiconType.OPPORTUNITY]: 1,
};

/** Lexicon weights that contribute to negative sentiment. */
const NEGATIVE_SENTIMENT_WEIGHTS: Readonly<
  Partial<Record<NlpLexiconType, number>>
> = {
  [NlpLexiconType.NEGATIVE]: 2,
  [NlpLexiconType.COMPLAINT]: 2,
  [NlpLexiconType.PROBLEM]: 1,
  [NlpLexiconType.URGENCY]: 1,
  [NlpLexiconType.COST]: 1,
  [NlpLexiconType.TIME]: 1,
  [NlpLexiconType.ACCESSIBILITY]: 1,
  [NlpLexiconType.SAFETY]: 1,
  [NlpLexiconType.RELIABILITY]: 1,
};

/**
 * Explicit complaint patterns that lexicon counting alone frequently misses.
 *
 * The patterns are intentionally conservative and focus on operational user
 * experience rather than isolated negative words.
 */
const NEGATIVE_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\bnot useful\b/iu,
  /\bnot helpful\b/iu,
  /\bdoes(?:n['’]?t| not) work\b/iu,
  /\bdid(?:n['’]?t| not) work\b/iu,
  /\b(?:can(?:not|['’]?t)|can\s+not)\b/iu,
  /\bcould(?:n['’]?t| not)\b/iu,
  /\bunable to\b/iu,
  /\bnever (?:receive|received|get|got|arrive|arrived)\b/iu,
  /\bdata (?:is |was )?(?:gone|lost|missing|deleted)\b/iu,
  /\b(?:classes|history|progress|files?) (?:are |were |is |was )?(?:gone|lost|missing|deleted)\b/iu,
  /\b(?:crash|crashes|crashed|crashing|freezes?|frozen|broken|bug|error|failure|failed|failing)\b/iu,
  /\b(?:hard|difficult|confusing) to (?:use|navigate|access|find|download|install|login|log in)\b/iu,
  /\b(?:terrible|disappointing|disappointed|frustrating|frustrated)\b/iu,
  /\b(?:too expensive|paywall|limited unless|have to pay|gotta pay)\b/iu,
  /(?:غير مفيد|لا يعمل|ما بشتغل|مش شغال|لا أستطيع|لا يمكن|لم يصل|ما وصل|فقدت|اختفت|تعطل|يتعطل|خطأ|مشكلة|صعب|مربك|سيئ)/iu,
];

/** Explicit positive-experience patterns. */
const POSITIVE_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\b(?:very helpful|really helpful|easy to use|works well|excellent|love this|great app)\b/iu,
  /(?:مفيد جدًا|سهل الاستخدام|يعمل بشكل جيد|ممتاز|أحب هذا)/iu,
];

/** Contrast markers indicating that the later clause may reverse sentiment. */
const CONTRAST_MARKERS: readonly RegExp[] = [
  /\bbut\b/giu,
  /\bhowever\b/giu,
  /\balthough\b/giu,
  /\byet\b/giu,
  /(?:لكن|ولكن|بس|مع ذلك)/gu,
];

/** Sentiment scoring result calculated from lexicon and contextual signals. */
export type SentimentScore = {
  positiveScore: number;
  negativeScore: number;
  difference: number;
  totalScore: number;
};

/**
 * Provides reusable sentiment scoring rules for the NLP engine.
 *
 * In addition to weighted lexicon matches, the policy handles explicit
 * negation and contrast clauses. This prevents a review such as
 * "the app is helpful, but it does not work on my laptop" from being marked
 * positive merely because the first clause contains positive vocabulary.
 *
 * @author Eman
 */
@Injectable()
export class SentimentScoringPolicyService {
  /** Calculates sentiment scores for one analyzed text. */
  score(text: LexiconTextAnalysisResult): SentimentScore {
    /*
     * App-store product descriptions are catalog content rather than user
     * opinions. Returning a neutral score prevents words such as "unsafe" or
     * "problem" inside feature descriptions from distorting community
     * sentiment statistics.
     */
    if (isLikelyProductDescription(text.originalText, text.sourceType)) {
      return {
        positiveScore: 0,
        negativeScore: 0,
        difference: 0,
        totalScore: 0,
      };
    }

    const lexicalPositiveScore = this.calculateWeightedScore(
      text,
      POSITIVE_SENTIMENT_WEIGHTS,
    );
    const lexicalNegativeScore = this.calculateWeightedScore(
      text,
      NEGATIVE_SENTIMENT_WEIGHTS,
    );
    const contextual = this.calculateContextualScore(text.originalText);

    const positiveScore = this.round(
      lexicalPositiveScore + contextual.positiveScore,
    );
    const negativeScore = this.round(
      lexicalNegativeScore + contextual.negativeScore,
    );

    return {
      positiveScore,
      negativeScore,
      difference: this.round(positiveScore - negativeScore),
      totalScore: this.round(positiveScore + negativeScore),
    };
  }

  /** Returns the minimum score difference required for classification. */
  getMinimumSentimentDifference(): number {
    return MINIMUM_SENTIMENT_DIFFERENCE;
  }

  /** Calculates a weighted score for configured lexicon categories. */
  private calculateWeightedScore(
    text: LexiconTextAnalysisResult,
    weights: Readonly<Partial<Record<NlpLexiconType, number>>>,
  ): number {
    let totalScore = 0;

    for (const lexiconType of Object.values(
      NlpLexiconType,
    ) as NlpLexiconType[]) {
      const weight = weights[lexiconType];

      if (weight === undefined || weight <= 0) {
        continue;
      }

      const uniqueMatches = new Set(
        (text.matchedLexicons[lexiconType] ?? [])
          .map((match) => this.normalizeText(match))
          .filter(Boolean),
      );

      totalScore += uniqueMatches.size * weight;
    }

    return totalScore;
  }

  /** Calculates explicit phrase and contrast-aware sentiment signals. */
  private calculateContextualScore(value: string): {
    positiveScore: number;
    negativeScore: number;
  } {
    const normalizedText = this.normalizeText(value);

    if (!normalizedText) {
      return { positiveScore: 0, negativeScore: 0 };
    }

    let positiveScore =
      this.countMatchingPatterns(normalizedText, POSITIVE_CONTEXT_PATTERNS) *
      EXPLICIT_POSITIVE_PHRASE_WEIGHT;
    let negativeScore =
      this.countMatchingPatterns(normalizedText, NEGATIVE_CONTEXT_PATTERNS) *
      EXPLICIT_NEGATIVE_PHRASE_WEIGHT;

    const contrastTail = this.extractContrastTail(normalizedText);

    if (contrastTail) {
      positiveScore +=
        this.countMatchingPatterns(contrastTail, POSITIVE_CONTEXT_PATTERNS) *
        EXPLICIT_POSITIVE_PHRASE_WEIGHT *
        CONTRAST_TAIL_MULTIPLIER;
      negativeScore +=
        this.countMatchingPatterns(contrastTail, NEGATIVE_CONTEXT_PATTERNS) *
        EXPLICIT_NEGATIVE_PHRASE_WEIGHT *
        CONTRAST_TAIL_MULTIPLIER;
    }

    return {
      positiveScore: Math.min(positiveScore, MAX_CONTEXTUAL_POLARITY_SCORE),
      negativeScore: Math.min(negativeScore, MAX_CONTEXTUAL_POLARITY_SCORE),
    };
  }

  /** Counts pattern matches without allowing one global RegExp to retain state. */
  private countMatchingPatterns(
    value: string,
    patterns: readonly RegExp[],
  ): number {
    return patterns.reduce(
      (count, pattern) => count + (pattern.test(value) ? 1 : 0),
      0,
    );
  }

  /** Returns the final clause appearing after the last contrast marker. */
  private extractContrastTail(value: string): string | null {
    let finalIndex = -1;
    let finalLength = 0;

    for (const marker of CONTRAST_MARKERS) {
      marker.lastIndex = 0;

      for (const match of value.matchAll(marker)) {
        if (match.index !== undefined && match.index >= finalIndex) {
          finalIndex = match.index;
          finalLength = match[0].length;
        }
      }
    }

    if (finalIndex < 0) {
      return null;
    }

    const tail = value.slice(finalIndex + finalLength).trim();
    return tail || null;
  }

  /** Normalizes text for stable pattern and lexicon comparison. */
  private normalizeText(value: string): string {
    return typeof value === 'string'
      ? value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
      : '';
  }

  /** Rounds score values for deterministic output. */
  private round(value: number): number {
    return Number(value.toFixed(3));
  }
}
