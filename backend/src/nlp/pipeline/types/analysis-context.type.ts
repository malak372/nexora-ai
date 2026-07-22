import type { LanguageCode } from '@prisma/client';

import type { FeatureRequest } from '../../analysis/types/feature-request.type';
import type {
  IntelligentAnalysisOutput,
  TextAnalysisResult,
  WeightedKeyword,
  WeightedTopic,
} from './intelligent-analysis.types';

/**
 * Represents the mutable state shared across the intelligent NLP pipeline.
 *
 * Instead of passing many intermediate values between services, the pipeline
 * stores its current analysis state inside a single context object. Each stage
 * enriches this context with additional results until the final aggregated
 * output is built.
 *
 * This type is used internally by the NLP pipeline and is not exposed through
 * the public API.
 *
 * Insights are intentionally excluded because they are built later by
 * AnalysisOutputBuilderService from analyzed-text lexicon matches.
 *
 * @author Eman
 */
export type AnalysisContext = {
  /**
   * Identifier of the collection job being analyzed.
   */
  collectionJobId: string;

  /**
   * Language selected for the collection job.
   *
   * When the value is ANY, the pipeline may analyze texts in multiple
   * supported languages. Each text must still receive a validated final
   * language before language-specific lexicons and topic rules are applied.
   */
  language: LanguageCode;

  /**
   * Selected software domain and its normalized matching keywords.
   */
  domain: {
    /**
     * Domain database identifier.
     */
    id: string;

    /**
     * Human-readable domain name.
     */
    name: string;

    /**
     * Normalized keywords used for domain-relevance analysis.
     */
    keywords: string[];
  };

  /**
   * Selected geographical context of the collection job.
   */
  location: {
    /**
     * Selected country, when provided.
     */
    country?: string | null;

    /**
     * Selected city, when provided.
     */
    city?: string | null;

    /**
     * Selected region, when provided.
     */
    region?: string | null;
  };

  /**
   * Stable data-source keys used during collection.
   *
   * Examples:
   * - youtube
   * - github
   * - stackoverflow
   * - dev-to
   */
  platforms: string[];

  /**
   * Final analyzed texts after preprocessing, language resolution,
   * lexicon analysis, and sentiment refinement.
   */
  analyzedTexts: TextAnalysisResult[];

  /**
   * Statistics produced by the preprocessing stage.
   */
  preprocessing: {
    /**
     * Number of duplicate texts removed after normalization.
     */
    duplicateTextsRemoved: number;

    /**
     * Number of texts removed because they were unrelated to the selected
     * software domain.
     */
    irrelevantTextsRemoved: number;

    /**
     * Number of spam-like or insufficient-quality texts removed.
     */
    spamTextsRemoved: number;
  };

  /**
   * Weighted keywords extracted from relevant analyzed texts.
   */
  keywords: WeightedKeyword[];

  /**
   * Weighted discussion topics extracted from relevant analyzed texts.
   */
  topics: WeightedTopic[];

  /**
   * Recurring community problems detected by the pipeline.
   */
  recurringProblems: IntelligentAnalysisOutput['recurringProblems'];

  /**
   * User needs and unmet requirements extracted by the pipeline.
   */
  extractedNeeds: IntelligentAnalysisOutput['extractedNeeds'];

  /**
   * Feature requests extracted from community feedback.
   */
  featureRequests: FeatureRequest[];

  /**
   * Structured software opportunity signals produced by the pipeline.
   */
  opportunities: IntelligentAnalysisOutput['opportunities'];
};
