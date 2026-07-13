/**
 * AI output returned for guest generation.
 *
 * Only title and limitedAbstract are exposed in the public
 * guest-generation response.
 *
 * The registered free-tier fields are persisted internally and
 * become visible after the guest registers and claims the idea.
 *
 * @author Malak
 */
export type GuestIdeaAiOutput = {
  readonly title: string;

  readonly limitedAbstract: string;

  readonly problemStatement: string;

  readonly objectives: string;

  readonly targetUsers: string;

  readonly partialAbstract: string;
};

/**
 * AI output returned during the registered free tier.
 *
 * @author Malak
 */
export type FreeIdeaAiOutput = {
  readonly title: string;

  readonly problemStatement: string;

  readonly objectives: string;

  readonly targetUsers: string;

  readonly partialAbstract: string;
};

/**
 * AI output returned for premium credit generation.
 *
 * Premium ideas are unlocked immediately.
 *
 * @author Malak
 */
export type PremiumIdeaAiOutput = {
  readonly title: string;

  readonly problemStatement: string;

  readonly objectives: string;

  readonly targetUsers: string;

  readonly fullAbstract: string;

  readonly technologyStack: string[];

  readonly systemArchitecture: string;

  readonly databaseDesign: string;

  readonly businessModel: string;

  readonly valueProposition: string;

  readonly revenueModel: string;

  readonly localRegulations: string;

  readonly budgetEstimation: string;

  readonly feasibilityAssessment: string;

  readonly implementationTimeline: string;

  readonly marketPotential: string;

  readonly nlpExecutiveSummary: string;

  readonly communityFeedbackSummary: string;
};

/**
 * Every structured output accepted by IdeaPersistenceService.
 */
export type IdeaAiOutput =
  | GuestIdeaAiOutput
  | FreeIdeaAiOutput
  | PremiumIdeaAiOutput;
