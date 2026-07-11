import {
  IntelligentAnalysisOutput,
  TextAnalysisResult,
} from '../../pipeline/types/intelligent-analysis.types';

/**
 * Represents the NLP data required to evaluate text complexity.
 *
 * The input reuses the existing rule-based NLP contracts instead of
 * duplicating analysis structures.
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
};
