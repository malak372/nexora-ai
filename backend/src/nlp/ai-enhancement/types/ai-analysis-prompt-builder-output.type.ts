import { JsonSchema } from '../../../prompts/types/json-schema.type';

/**
 * Result produced by the NLP AI-enhancement prompt builder.
 *
 * This object contains the fully rendered prompt together with the
 * metadata required by the AI execution layer.
 *
 * @author Eman
 */
export type AiAnalysisPromptBuilderOutput = {
  /**
   * Fully rendered prompt ready to be submitted to an AI client.
   */
  readonly promptText: string;

  /**
   * Approximate number of input tokens.
   *
   * This value is an estimate used for preliminary routing,
   * monitoring, and cost estimation.
   *
   * Provider-reported token usage remains the authoritative value.
   */
  readonly estimatedInputTokens: number;

  /**
   * SHA-256 hash of the source AI-enhancement prompt template.
   *
   * The hash identifies the template version independently from
   * runtime analysis values, decision context, and evidence samples.
   *
   * It may be used for auditing, tracing, and detecting template
   * changes across AI-enhancement operations.
   */
  readonly templateHash: string;

  /**
   * Stable provider-neutral name of the expected response schema.
   */
  readonly responseSchemaName: string;

  /**
   * Provider-neutral JSON Schema describing the structured output
   * expected from the AI-enhancement operation.
   */
  readonly responseSchema: JsonSchema;
};
