/**
 * Represents a recurring feature request detected from community feedback.
 *
 * Feature requests are extracted from posts and comments using the NLP
 * lexicon and aggregated by frequency to help identify the most requested
 * software capabilities.
 *
 * @author Eman
 */
export type FeatureRequest = {
  /**
   * Human-readable feature request title.
   */
  feature: string;

  /**
   * Number of analyzed texts supporting this feature request.
   */
  frequency: number;

  /**
   * Representative community evidence supporting the request.
   */
  evidenceSamples: string[];
};
