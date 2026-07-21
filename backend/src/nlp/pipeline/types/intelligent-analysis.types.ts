import { LanguageCode, NlpLexiconType } from '@prisma/client';

import { FeatureRequest } from '../../analysis/types/feature-request.type';
import { Sentiment } from '../../common/enums/sentiment.enum';

/**
 * Identifies the original source of a text item inside the NLP pipeline.
 *
 * Nexora AI analyzes both collected posts and their comments because:
 * - Posts provide the general discussion context.
 * - Comments frequently contain direct user problems, complaints, needs,
 *   and feature suggestions.
 *
 * @author Eman
 */
export type TextSourceType = 'POST' | 'COMMENT';

/**
 * Generic priority level used for recurring problems, extracted needs,
 * and other severity-based NLP results.
 *
 * @author Eman
 */
export type PriorityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Represents a language that was resolved for an individual analyzed text.
 *
 * ANY is a collection preference and not an actual detected text language.
 * Therefore, final per-text analysis results should contain a specific
 * supported language whenever language detection succeeds.
 *
 * @author Eman
 */
export type ResolvedLanguageCode = Exclude<
  LanguageCode,
  typeof LanguageCode.ANY
>;

/**
 * Represents a weighted keyword extracted from analyzed community texts.
 *
 * @author Eman
 */
export type WeightedKeyword = {
  /**
   * Normalized keyword extracted from analyzed text.
   */
  keyword: string;

  /**
   * Number of occurrences across relevant analyzed texts.
   */
  frequency: number;
};

/**
 * Represents a discussion topic and its supporting frequency.
 *
 * @author Eman
 */
export type WeightedTopic = {
  /**
   * Normalized topic label.
   */
  topic: string;

  /**
   * Number of occurrences or supporting mentions.
   */
  frequency: number;
};

/**
 * Unified input format for each post or comment entering the intelligent
 * NLP pipeline.
 *
 * This contract allows posts and comments to be processed consistently while
 * preserving their relevant source metadata.
 *
 * @author Eman
 */
export type IntelligentTextInput = {
  /**
   * Database identifier of the SocialPost or SocialComment.
   */
  id: string;

  /**
   * Indicates whether the input originated from a post or a comment.
   */
  sourceType: TextSourceType;

  /**
   * Parent SocialPost identifier.
   *
   * Required for comments and omitted for posts.
   */
  postId?: string;

  /**
   * Optional title of the source post.
   *
   * The title may be combined with the post body to improve relevance and
   * topic analysis.
   */
  title?: string | null;

  /**
   * Raw text content before preprocessing.
   */
  content: string;

  /**
   * Validated language supplied by the collector or resolved before the main
   * language-specific analysis stages.
   *
   * The Prisma SocialPost and SocialComment models currently store their
   * languageCode fields as nullable strings. Those values must be validated
   * and converted to LanguageCode before constructing this input.
   */
  language?: LanguageCode | null;

  /**
   * Engagement count used when ranking evidence samples.
   */
  likesCount?: number;

  /**
   * Reply count used for post-level relevance and importance ranking.
   */
  repliesCount?: number;
};

/**
 * Represents the result of analyzing one post or comment.
 *
 * This structure supports debugging, auditing, confidence calculation,
 * evidence selection, and administrative analysis views.
 *
 * @author Eman
 */
export type TextAnalysisResult = {
  /**
   * Identifier of the analyzed SocialPost or SocialComment.
   */
  id: string;

  /**
   * Original source type of the analyzed text.
   */
  sourceType: TextSourceType;

  /**
   * Parent SocialPost identifier when the analyzed text is a comment.
   */
  postId?: string;

  /**
   * Original text before preprocessing.
   */
  originalText: string;

  /**
   * Cleaned and normalized text used by the NLP engine.
   */
  cleanedText: string;

  /**
   * Specific language used for language-aware lexicon, topic, and sentiment
   * analysis.
   *
   * ANY must not be used here because it represents a collection preference,
   * not the actual language of an individual text.
   */
  language: ResolvedLanguageCode;

  /**
   * Final sentiment classification.
   */
  sentiment: Sentiment;

  /**
   * Analysis confidence score between 0 and 1.
   */
  confidence: number;

  /**
   * Matched NLP lexicon terms grouped by lexicon category.
   *
   * Example:
   * {
   *   PROBLEM: ['problem', 'issue'],
   *   TIME: ['delay', 'slow']
   * }
   */
  matchedLexicons: Partial<Record<NlpLexiconType, string[]>>;

  /**
   * Indicates whether AI fallback or enhancement was used for this text.
   */
  aiUsed: boolean;
};

/**
 * Represents the final aggregated output produced by the intelligent NLP
 * pipeline.
 *
 * This contract connects:
 *
 * NLP Pipeline
 * → Prompt Builder
 * → AI Idea Generation
 *
 * @author Eman
 */
export type IntelligentAnalysisOutput = {
  /**
   * Identifier of the analyzed collection job.
   */
  collectionJobId: string;

  /**
   * Language preference selected for the collection job.
   *
   * When this value is ANY, the dataset may contain multiple resolved
   * languages. Individual TextAnalysisResult records still use specific
   * resolved languages.
   */
  language: LanguageCode;

  /**
   * Software domain selected for data collection and analysis.
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
  };

  /**
   * Geographical context associated with the collected data.
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
   * Stable data-source keys used during data collection.
   *
   * Examples:
   * - youtube
   * - github
   * - stackoverflow
   * - dev-to
   */
  platforms: string[];

  /**
   * Total number of relevant texts analyzed after preprocessing.
   */
  totalTextsAnalyzed: number;

  /**
   * Total number of analyzed posts.
   */
  totalPostsAnalyzed: number;

  /**
   * Total number of analyzed comments.
   */
  totalCommentsAnalyzed: number;

  /**
   * Preprocessing and data-quality statistics.
   */
  dataQuality: {
    /**
     * Number of duplicate texts removed after normalization.
     */
    duplicateTextsRemoved: number;

    /**
     * Number of spam-like or insufficient-quality texts removed.
     */
    spamTextsRemoved: number;

    /**
     * Number of texts removed because they were unrelated to the selected
     * software domain.
     */
    irrelevantTextsRemoved: number;
  };

  /**
   * Sentiment distribution across analyzed posts and comments.
   */
  sentimentStats: {
    /**
     * Number of positively classified texts.
     */
    positive: number;

    /**
     * Number of negatively classified texts.
     */
    negative: number;

    /**
     * Number of neutrally classified texts.
     */
    neutral: number;

    /**
     * Most common sentiment in the analyzed dataset.
     */
    dominantSentiment: Sentiment;
  };

  /**
   * Most frequent normalized keywords.
   */
  keywords: WeightedKeyword[];

  /**
   * Most frequent discussion topics.
   */
  topics: WeightedTopic[];

  /**
   * Recurring community problems identified from posts and comments.
   */
  recurringProblems: {
    /**
     * Human-readable normalized problem title.
     */
    title: string;

    /**
     * Number of analyzed texts supporting the problem.
     */
    frequency: number;

    /**
     * Estimated problem severity.
     */
    severity: PriorityLevel;

    /**
     * Representative community evidence supporting the problem.
     */
    evidenceSamples: string[];
  }[];

  /**
   * User needs and unmet requirements extracted from community feedback.
   */
  extractedNeeds: {
    /**
     * Human-readable need statement.
     */
    need: string;

    /**
     * Estimated priority of the extracted need.
     */
    priority: PriorityLevel;

    /**
     * Recurring problem related to this need, when available.
     */
    relatedProblem?: string;

    /**
     * Representative community evidence supporting the need.
     */
    evidenceSamples: string[];
  }[];

  /**
   * Repeated feature requests extracted from community feedback.
   */
  featureRequests: FeatureRequest[];

  /**
   * Structured software-opportunity signals inferred from problems, needs,
   * topics, and keywords.
   */
  opportunities: {
    /**
     * Recurring problem connected to the opportunity.
     */
    problem?: string;

    /**
     * Extracted user need connected to the opportunity.
     */
    need?: string;

    /**
     * Discussion topic connected to the opportunity.
     */
    topic?: string;

    /**
     * Suggested solution area.
     */
    solutionArea: string;

    /**
     * Opportunity-strength score between 0 and 1.
     */
    score: number;

    /**
     * Representative evidence supporting the opportunity.
     */
    evidenceSamples: string[];
  }[];

  /**
   * Classified concern signals detected from community feedback.
   */
  insights: {
    /**
     * Urgency-related signals.
     */
    urgencySignals: string[];

    /**
     * Cost-related concerns.
     */
    costConcerns: string[];

    /**
     * Time-related concerns.
     */
    timeConcerns: string[];

    /**
     * Accessibility or usability concerns.
     */
    accessibilityConcerns: string[];

    /**
     * Safety-related concerns.
     */
    safetyConcerns: string[];

    /**
     * Reliability-related concerns.
     */
    reliabilityConcerns: string[];

    /**
     * Validated AI-enhanced insights that do not belong to one of the
     * predefined rule-based concern categories.
     */
    additionalInsights: string[];
  };

  /**
   * Representative analyzed posts used as supporting evidence.
   */
  samplePosts: {
    /**
     * SocialPost identifier.
     */
    id: string;

    /**
     * Representative post text.
     */
    text: string;

    /**
     * Final post sentiment.
     */
    sentiment: Sentiment;
  }[];

  /**
   * Representative analyzed comments used as supporting evidence.
   */
  sampleComments: {
    /**
     * SocialComment identifier.
     */
    id: string;

    /**
     * Parent SocialPost identifier.
     */
    postId: string;

    /**
     * Representative comment text.
     */
    text: string;

    /**
     * Final comment sentiment.
     */
    sentiment: Sentiment;
  }[];

  /**
   * Indicates whether AI was used at least once during the analysis.
   */
  aiUsed: boolean;

  /**
   * Overall analysis-confidence score between 0 and 1.
   */
  confidence: number;

  /**
   * Detailed per-text analysis results.
   *
   * These records are intended primarily for debugging, auditing,
   * administrative review, and metric calculations. They normally do not
   * need to be forwarded to the Prompt Builder.
   */
  analyzedTexts: TextAnalysisResult[];
};