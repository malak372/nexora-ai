import type { AnalysisQualityMetrics } from './analysis-quality-metrics.type';
import type { TextComplexityMetrics } from './text-complexity-metrics.type';

/**
 * Represents the complete input required by the NLP decision engine.
 *
 * The decision engine evaluates only aggregated analysis metrics and
 * dataset size. It intentionally has no knowledge of raw texts,
 * database entities, or AI providers.
 *
 * This keeps the decision layer independent, deterministic,
 * and easy to test.
 *
 * @author Eman
 */
export type AnalysisDecisionInput = {
  /**
   * Total number of texts successfully analyzed by the
   * rule-based NLP pipeline.
   *
   * This value is used to determine whether the available
   * dataset is large enough to produce reliable insights.
   */
  readonly totalAnalyzedTexts: number;

  /**
   * Quality metrics produced by the rule-based analysis.
   *
   * These metrics evaluate confidence, evidence quality,
   * lexical coverage, and other indicators describing
   * the reliability of the current NLP result.
   */
  readonly qualityMetrics: AnalysisQualityMetrics;

  /**
   * Complexity metrics calculated from the analyzed texts.
   *
   * These metrics estimate how difficult the dataset is
   * for a purely rule-based NLP engine and whether AI
   * enhancement may improve the final result.
   */
  readonly complexityMetrics: TextComplexityMetrics;
};
