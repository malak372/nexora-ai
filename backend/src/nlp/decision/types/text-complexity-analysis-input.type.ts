import type { LanguageCode } from '@prisma/client';

import type {
  IntelligentAnalysisOutput,
  TextAnalysisResult,
} from '../../pipeline/types/intelligent-analysis.types';

/**
 * Represents the NLP data required to evaluate text complexity.
 *
 * The input reuses the existing rule-based NLP contracts instead of
 * duplicating analysis structures.
 *
 * The language is included so that language-specific linguistic
 * signals can be selected during complexity analysis.
 *
 * @author Eman
 */
export type TextComplexityAnalysisInput = {
  /**
   * Detailed analysis result for every analyzed text.
   */
  readonly analyzedTexts: readonly TextAnalysisResult[];

  /**
   * Topics extracted from the analyzed dataset.
   */
  readonly topics: IntelligentAnalysisOutput['topics'];

  /**
   * Language used to select the appropriate negation,
   * contrast, and other linguistic complexity signals.
   *
   * When the value is LanguageCode.ANY, the complexity
   * analyzer may use signals from all supported languages.
   */
  readonly language: LanguageCode;
};
