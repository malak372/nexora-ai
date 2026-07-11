import { LanguageCode } from '@prisma/client';

import {
  IntelligentAnalysisOutput,
  IntelligentTextInput,
} from '../../pipeline/types/intelligent-analysis.types';

/**
 * Types describing the input supplied to the NLP AI-enhancement layer.
 *
 * The enhancement layer receives the completed rule-based analysis,
 * selected evidence samples, and decision metadata required to build
 * a controlled AI-enhancement request.
 *
 * This layer does not collect data or modify rule-based statistics.
 *
 * @author Eman
 */

/**
 * Source types supported by NLP evidence.
 *
 * The type is derived from IntelligentTextInput to keep the evidence
 * contract synchronized with the main NLP pipeline.
 */
export type AiEnhancementEvidenceSource = IntelligentTextInput['sourceType'];

/**
 * Numeric metrics supplied as additional context to the AI
 * enhancement layer.
 *
 * Metric names are determined by the originating analysis service,
 * while values must remain numeric and prompt-safe.
 */
export type AiEnhancementMetrics = Readonly<Record<string, number>>;

/**
 * Represents one existing evidence sample made available to the
 * AI-enhancement layer.
 *
 * AI-generated results must reference these identifiers instead of
 * inventing raw quotations or unsupported evidence.
 */
export type AiEnhancementEvidence = {
  /**
   * Stable identifier of the analyzed post or comment.
   */
  readonly id: string;

  /**
   * Indicates whether the evidence originated from a post
   * or a comment.
   */
  readonly sourceType: AiEnhancementEvidenceSource;

  /**
   * Existing evidence text supplied to the AI model.
   */
  readonly text: string;

  /**
   * Detected language of the evidence text.
   */
  readonly language: LanguageCode;
};

/**
 * Input required to perform one optional AI-enhancement operation.
 */
export type AiEnhancementInput = {
  /**
   * Complete output produced by the rule-based NLP pipeline.
   *
   * Statistical values and frequencies in this output remain the
   * authoritative source during the later merge operation.
   */
  readonly ruleBasedOutput: IntelligentAnalysisOutput;

  /**
   * Selected real evidence samples supplied to the AI model.
   *
   * The collection should already be limited and prioritized before
   * reaching the enhancement layer.
   */
  readonly evidence: ReadonlyArray<AiEnhancementEvidence>;

  /**
   * Human-readable reasons produced by the decision layer explaining
   * why AI enhancement was requested.
   */
  readonly decisionReasons: ReadonlyArray<string>;

  /**
   * Optional text-complexity metrics used to provide additional
   * context to the AI model.
   */
  readonly complexityMetrics?: AiEnhancementMetrics;

  /**
   * Optional data-quality metrics used to help the AI model interpret
   * the reliability and coverage of the rule-based analysis.
   */
  readonly qualityMetrics?: AiEnhancementMetrics;
};
