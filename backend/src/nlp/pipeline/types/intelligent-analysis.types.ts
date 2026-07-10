import { LanguageCode, NlpLexiconType } from '@prisma/client';

/**
 * Identifies the original source of a text item inside the NLP pipeline.
 *
 * Nexora AI analyzes both collected social posts and their comments because:
 * - Posts provide the general discussion context.
 * - Comments usually contain real user pain points, needs, complaints, and suggestions.
 *
 * @author Eman
 */
export type TextSourceType = 'POST' | 'COMMENT';

/**
 * Standard sentiment labels used across the NLP pipeline and Prompt Builder.
 *
 * These labels are intentionally strict to keep the output consistent and easy
 * to store, aggregate, and use in AI prompts.
 */
export type SentimentLabel = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

/**
 * Generic priority level used for problems, needs, and insight severity.
 *
 * This helps the Prompt Builder understand which signals should receive more
 * attention during idea generation.
 */
export type PriorityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Represents a keyword extracted from posts/comments with its frequency.
 *
 * Frequency helps the AI understand which terms are most important instead
 * of treating all keywords equally.
 */
export type WeightedKeyword = {
  /**
   * Normalized keyword extracted from analyzed community text.
   */
  keyword: string;

  /**
   * Number of times the keyword appeared in relevant analyzed texts.
   */
  frequency: number;
};

/**
 * Represents a discovered topic with its frequency.
 *
 * Topics summarize recurring discussion areas and guide the AI toward the
 * most common community concerns.
 */
export type WeightedTopic = {
  /**
   * Topic name inferred from recurring keywords, problems, or AI analysis.
   */
  topic: string;

  /**
   * Number of occurrences or supporting mentions for this topic.
   */
  frequency: number;
};

/**
 * Unified input format for every text that enters the Intelligent NLP pipeline.
 *
 * This type allows the pipeline to treat posts and comments consistently while
 * still preserving important metadata such as source type, post relation,
 * engagement counts, and detected/original language.
 */
export type IntelligentTextInput = {
  /**
   * Database ID of the SocialPost or SocialComment.
   */
  id: string;

  /**
   * Indicates whether this text came from a post or a comment.
   */
  sourceType: TextSourceType;

  /**
   * Parent post ID.
   *
   * Exists only when sourceType is COMMENT.
   */
  postId?: string;

  /**
   * Optional post title.
   *
   * Used only for posts to improve analysis context.
   */
  title?: string | null;

  /**
   * Raw text content before cleaning.
   */
  content: string;

  /**
   * Language stored by the collector or detected later by the NLP pipeline.
   */
  language?: LanguageCode | null;

  /**
   * Engagement count used later for ranking evidence samples.
   */
  likesCount?: number;

  /**
   * Reply count used for post-level importance ranking.
   */
  repliesCount?: number;
};

/**
 * Result of analyzing a single text item.
 *
 * This is useful for debugging, auditing, confidence calculation, and future
 * admin dashboards that need to show how the NLP engine interpreted each item.
 */
export type TextAnalysisResult = {
  /**
   * ID of the analyzed SocialPost or SocialComment.
   */
  id: string;

  /**
   * Original source type of the analyzed text.
   */
  sourceType: TextSourceType;

  /**
   * Parent post ID when the analyzed item is a comment.
   */
  postId?: string;

  /**
   * Original raw text before preprocessing.
   */
  originalText: string;

  /**
   * Cleaned and normalized text used for NLP matching and extraction.
   */
  cleanedText: string;

  /**
   * Final language used during analysis.
   */
  language: LanguageCode;

  /**
   * Final sentiment label for this text.
   */
  sentiment: SentimentLabel;

  /**
   * Confidence score from 0 to 1.
   *
   * Higher confidence means the rule-based engine or AI analysis found clear
   * signals in the text.
   */
  confidence: number;

  /**
   * Matched NLP lexicon terms grouped by lexicon type.
   *
   * Example:
   * {
   *   PROBLEM: ['problem', 'issue'],
   *   TIME: ['delay', 'slow']
   * }
   */
  matchedLexicons: Partial<Record<NlpLexiconType, string[]>>;

  /**
   * Indicates whether AI fallback was used for this specific text.
   */
  aiUsed: boolean;
};

/**
 * Final output returned by IntelligentAnalysisService.
 *
 * This is the contract between:
 *
 * NLP Pipeline
 * → Prompt Builder
 * → AI Idea Generation
 *
 * The structure is designed to support Nexora AI requirements:
 * - Analyze real posts and comments.
 * - Detect recurring problems and unmet needs.
 * - Extract weighted keywords and topics.
 * - Provide evidence samples.
 * - Support local context, domain, platforms, and data quality.
 * - Enable premium idea generation with richer AI prompts.
 */
export type IntelligentAnalysisOutput = {
  /**
   * Collection job analyzed by the NLP engine.
   */
  collectionJobId: string;

  /**
   * Domain selected for the collection job.
   *
   * Used by the Prompt Builder to keep generated ideas aligned with the
   * selected field, such as healthcare, education, fintech, etc.
   */
  domain: {
    id: string;
    name: string;
  };

  /**
   * Local context of the collected data.
   *
   * This helps the AI generate ideas that fit the selected country, city,
   * or region instead of producing generic global ideas.
   */
  location: {
    country?: string | null;
    city?: string | null;
    region?: string | null;
  };

  /**
   * Platforms used during data collection.
   *
   * Example:
   * ['Reddit', 'Facebook', 'GitHub']
   */
  platforms: string[];

  /**
   * Total number of relevant texts analyzed after cleaning and filtering.
   */
  totalTextsAnalyzed: number;

  /**
   * Number of posts analyzed.
   */
  totalPostsAnalyzed: number;

  /**
   * Number of comments analyzed.
   */
  totalCommentsAnalyzed: number;

  /**
   * Data quality summary.
   *
   * This improves transparency and helps the Prompt Builder know how reliable
   * the analysis is.
   */
  dataQuality: {
    /**
     * Number of duplicate texts removed after normalization.
     */
    duplicateTextsRemoved: number;

    /**
     * Number of spam-like or too-low-quality texts removed.
     */
    spamTextsRemoved: number;

    /**
     * Number of texts removed because they were not related to the selected domain.
     */
    irrelevantTextsRemoved: number;
  };

  /**
   * Sentiment distribution across analyzed posts and comments.
   *
   * Used by dashboards and prompts to understand whether the community is
   * mostly complaining, satisfied, or neutral.
   */
  sentimentStats: {
    positive: number;
    negative: number;
    neutral: number;
    dominantSentiment: SentimentLabel;
  };

  /**
   * Most frequent keywords extracted from analyzed texts.
   *
   * Frequencies help the AI prioritize the most repeated terms.
   */
  keywords: WeightedKeyword[];

  /**
   * Most discussed topics inferred from the analyzed dataset.
   */
  topics: WeightedTopic[];

  /**
   * Recurring problems detected from posts and comments.
   *
   * These are the strongest signals for generating useful software project ideas.
   */
  recurringProblems: {
    title: string;
    frequency: number;
    severity: PriorityLevel;
    evidenceSamples: string[];
  }[];

  /**
   * Extracted user needs and unmet requirements.
   *
   * These needs are used to transform real complaints into actionable project ideas.
   */
  extractedNeeds: {
    need: string;
    priority: PriorityLevel;
    relatedProblem?: string;
    evidenceSamples: string[];
  }[];

  /**
   * Feature requests mentioned by users.
   *
   * These can become product features or advanced requirements in generated ideas.
   */
  featureRequests: {
    feature: string;
    frequency: number;
    evidenceSamples: string[];
  }[];

  /**
   * Structured software opportunity signals detected from community discussion.
   *
   * These are not final project ideas. They provide evidence-based direction
   * for the Prompt Builder and AI idea generation layer.
   */
  opportunities: {
    /**
     * Recurring problem connected to this opportunity.
     */
    problem?: string;

    /**
     * User need connected to this opportunity.
     */
    need?: string;

    /**
     * Structured software opportunity signals detected from community discussion.
     *
     * These are not final project ideas. They provide evidence-based direction
     * for the Prompt Builder and AI idea generation layer.
     */
    opportunities: {
        /**
         * Recurring problem connected to this opportunity.
         */
        problem?: string;

        /**
         * User need connected to this opportunity.
         */
        need?: string;

        /**
         * Main discussion topic related to this opportunity.
         */
        topic?: string;

        /**
         * Suggested solution area inferred from problems, needs, topics, and keywords.
         */
        solutionArea: string;

        /**
         * Opportunity strength score from 0 to 1.
         */
        score: number;

        /**
         * Representative community evidence supporting this opportunity.
         */
        evidenceSamples: string[];
    }[];

    /**
     * Suggested solution area inferred from problems, needs, topics, and keywords.
     */
    solutionArea: string;

    /**
     * Opportunity strength score from 0 to 1.
     */
    score: number;

    /**
     * Representative community evidence supporting this opportunity.
     */
    evidenceSamples: string[];
  }[];

  /**
   * Classified concern signals based on extended NLP lexicon categories.
   *
   * These make the analysis richer than basic sentiment analysis.
   */
  insights: {
    urgencySignals: string[];
    costConcerns: string[];
    timeConcerns: string[];
    accessibilityConcerns: string[];
    safetyConcerns: string[];
    reliabilityConcerns: string[];
  };

  /**
   * Representative analyzed posts used as evidence in prompts and premium outputs.
   */
  samplePosts: {
    id: string;
    text: string;
    sentiment: SentimentLabel;
  }[];

  /**
   * Representative analyzed comments used as evidence in prompts and premium outputs.
   */
  sampleComments: {
    id: string;
    postId: string;
    text: string;
    sentiment: SentimentLabel;
  }[];

  /**
   * Indicates whether AI was used at least once during this analysis.
   */
  aiUsed: boolean;

  /**
   * Overall confidence score from 0 to 1 for the complete analysis.
   */
  confidence: number;

  /**
   * Optional detailed per-text analysis results.
   *
   * These records are primarily intended for debugging, auditing,
   * administrative review, and future improvements of the NLP engine.
   *
   * Since this collection can become quite large, it is optional and
   * does not have to be forwarded to the Prompt Builder. The AI prompt
   * typically requires only the aggregated analysis results.
   */
  analyzedTexts: TextAnalysisResult[];
};
