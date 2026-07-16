/**
 * Primitive JSON Schema property types supported by the prompt
 * structured-output contracts.
 *
 * @author Malak
 */
export type JsonSchemaPrimitiveType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

/**
 * Provider-neutral JSON Schema representation.
 *
 * PromptBuilderService produces this schema without depending on
 * one specific AI provider.
 *
 * Provider adapters may transform it into:
 * - OpenRouter structured-output configuration.
 * - Google response-schema configuration.
 *
 * Additional properties remain supported because AI provider
 * adapters may require provider-specific schema metadata.
 *
 * @author Malak
 */
export type JsonSchema = {
  readonly type?: JsonSchemaPrimitiveType;

  readonly description?: string;

  readonly properties?: Readonly<Record<string, JsonSchema>>;

  readonly required?: readonly string[];

  readonly items?: JsonSchema;

  readonly additionalProperties?: boolean | JsonSchema;

  readonly enum?: readonly unknown[];

  readonly minLength?: number;

  readonly maxLength?: number;

  readonly minItems?: number;

  readonly maxItems?: number;

  readonly minimum?: number;

  readonly maximum?: number;

  readonly pattern?: string;

  readonly format?: string;

  readonly [key: string]: unknown;
};
