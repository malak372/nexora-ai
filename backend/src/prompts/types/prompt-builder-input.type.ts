import { IdeaGenerationType, PromptType } from '@prisma/client';

/**
 * Sentiment distribution summary extracted from collected text/comments.
 */
export type PromptSentimentStats = {
  positive: number;
  negative: number;
  neutral: number;
};

/**
 * Existing idea data used when building prompts that continue from
 * or enhance a previously generated idea.
 */
export type ExistingIdeaPromptContext = {
  title: string;
  problemStatement?: string | null;
  objectives?: string | null;
  targetUsers?: string | null;
  limitedAbstract?: string | null;
  partialAbstract?: string | null;
  fullAbstract?: string | null;
};

/**
 * Input contract for building AI prompts.
 *
 * This type is shared by all prompt-building flows, such as:
 * - idea generation
 * - idea unlock / advanced idea expansion
 * - AI chat responses
 * - NLP analysis
 * - abstract generation
 *
 * Each prompt type may use only the fields relevant to its own flow.
 *
 * @author Malak
 */
export type PromptBuilderInput = {
  /**
   * Defines the purpose of the prompt being generated.
   *
   * Example:
   * - IDEA_GENERATION
   * - IDEA_UNLOCK
   * - CHAT_RESPONSE
   * - NLP_ANALYSIS
   * - ABSTRACT_GENERATION
   */
  promptType: PromptType;

  /**
   * Selected project domain name.
   *
   * Example:
   * Healthcare, Education, Agriculture, Transportation.
   */
  domainName: string;

  /**
   * Country used to localize the generated idea or analysis.
   */
  country?: string | null;

  /**
   * City used for more specific local context.
   */
  city?: string | null;

  /**
   * Region used for broader geographical context.
   *
   * Example:
   * West Bank, Gaza, Middle East.
   */
  region?: string | null;

  /**
   * Platforms used as data sources.
   *
   * Example:
   * Facebook, Reddit, YouTube, News.
   */
  platforms?: string[];

  /**
   * Generation access type.
   *
   * Used mainly for idea-generation prompts to distinguish between:
   * - guest generation
   * - free user generation
   * - credit-based generation
   */
  generationType?: IdeaGenerationType;

  /**
   * Sentiment summary extracted from collected posts/comments.
   */
  sentimentStats?: PromptSentimentStats;

  /**
   * Important keywords extracted from collected text.
   */
  keywords?: string[];

  /**
   * Main topics detected from collected text.
   */
  topics?: string[];

  /**
   * Repeated problems detected from user comments or posts.
   */
  recurringProblems?: string[];

  /**
   * User needs extracted from collected data.
   */
  extractedNeeds?: string[];

  /**
   * Representative comments used to ground the AI response
   * in real user feedback.
   */
  sampleComments?: string[];

  /**
   * Total number of comments/posts used in the analysis.
   */
  commentsCount?: number;

  /**
   * Existing idea context.
   *
   * Used when unlocking an idea, generating an abstract,
   * or continuing an AI chat about a previously generated idea.
   */
  existingIdea?: ExistingIdeaPromptContext;

  /**
   * User message used in AI chat prompts.
   */
  chatMessage?: string;

  /**
   * Raw text used for NLP analysis prompts.
   */
  nlpText?: string;
};