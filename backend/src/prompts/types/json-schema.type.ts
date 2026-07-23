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
 * One valid JSON Schema type declaration.
 *
 * JSON Schema Draft 2020-12 permits either:
 * - One primitive type, such as "string".
 * - A union of primitive types, such as ["string", "null"].
 *
 * The readonly array form preserves immutable schema constants created
 * with `as const`.
 *
 * @author Malak
 */
export type JsonSchemaType =
  | JsonSchemaPrimitiveType
  | readonly JsonSchemaPrimitiveType[];

/**
 * Provider-neutral JSON Schema representation.
 *
 * PromptBuilderService produces this schema without depending on one
 * specific AI provider.
 *
 * Provider adapters may transform it into:
 * - OpenRouter structured-output configuration.
 * - Google response-schema configuration.
 *
 * Additional properties remain supported because AI provider adapters
 * and future JSON Schema keywords may require metadata not explicitly
 * modeled by this contract.
 *
 * @author Malak
 */
export type JsonSchema = {
  /**
   * Primitive type or nullable/union type declaration.
   *
   * Examples:
   * - 'string'
   * - ['string', 'null']
   */
  readonly type?: JsonSchemaType;

  /**
   * Human-readable schema description.
   */
  readonly description?: string;

  /**
   * Named child schemas for object values.
   */
  readonly properties?: Readonly<Record<string, JsonSchema>>;

  /**
   * Required object-property names.
   */
  readonly required?: readonly string[];

  /**
   * Schema applied to array items.
   */
  readonly items?: JsonSchema;

  /**
   * Controls whether undeclared object properties are accepted.
   */
  readonly additionalProperties?: boolean | JsonSchema;

  /**
   * Explicit set of accepted values.
   */
  readonly enum?: readonly unknown[];

  readonly minLength?: number;

  readonly maxLength?: number;

  readonly minItems?: number;

  readonly maxItems?: number;

  readonly minimum?: number;

  readonly maximum?: number;

  readonly pattern?: string;

  readonly format?: string;

  /**
   * Allows additional standard or provider-specific schema keywords
   * without weakening the strongly typed common fields above.
   */
  readonly [key: string]: unknown;
};
