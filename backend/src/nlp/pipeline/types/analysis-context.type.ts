import { FeatureRequest } from '../../analysis/types/feature-request.type';
import {
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
 * enriches this context with additional results until the final output is
 * built.
 *
 * This type is used internally by the NLP pipeline and is not exposed through
 * the public API.
 *
 * @author Eman
 */
export type AnalysisContext = {
  /**
   * Collection job being analyzed.
   */
  collectionJobId: string;

  /**
   * Selected software domain.
   */
  domain: {
    id: string;
    name: string;
    keywords: string[];
  };

  /**
   * Selected geographical context.
   */
  location: {
    country?: string | null;
    city?: string | null;
    region?: string | null;
  };

  /**
   * Selected collection platforms.
   */
  platforms: string[];

  /**
   * Final analyzed texts after preprocessing, lexicon analysis, and sentiment
   * refinement.
   */
  analyzedTexts: TextAnalysisResult[];

  /**
   * Preprocessing statistics.
   */
  preprocessing: {
    duplicateTextsRemoved: number;
    irrelevantTextsRemoved: number;
    spamTextsRemoved: number;
  };

  /**
   * Extracted weighted keywords.
   */
  keywords: WeightedKeyword[];

  /**
   * Extracted discussion topics.
   */
  topics: WeightedTopic[];

  /**
   * Recurring community problems.
   */
  recurringProblems: IntelligentAnalysisOutput['recurringProblems'];

  /**
   * Extracted user needs.
   */
  extractedNeeds: IntelligentAnalysisOutput['extractedNeeds'];

  /**
   * Extracted feature requests.
   */
  featureRequests: FeatureRequest[];

  /**
   * Structured software opportunities.
   */
  opportunities: IntelligentAnalysisOutput['opportunities'];
};
