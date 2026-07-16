/**
 * Token estimates used by cost-aware routing.
 *
 * @author Malak
 */
export type AiRoutingCostContext = {
  readonly estimatedInputTokens?: number;
  readonly estimatedOutputTokens?: number;
};
