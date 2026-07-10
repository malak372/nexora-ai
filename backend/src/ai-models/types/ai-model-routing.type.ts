/**
 * Optional token estimates used by cost-aware AI-model routing.
 *
 * When the values are provided, the LOWEST_COST strategy calculates
 * the estimated request cost using the configured model prices.
 *
 * When omitted, the strategy compares the cost of one input token
 * and one output token.
 *
 * @author Malak
 */
export type AiRoutingCostContext = {
  /**
   * Estimated number of input tokens.
   */
  readonly estimatedInputTokens?: number;

  /**
   * Estimated number of output tokens.
   */
  readonly estimatedOutputTokens?: number;
};
