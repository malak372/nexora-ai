import type { AiJsonSchema } from '../../types/ai-json-schema.type';

/**
 * JSON-compatible primitive values accepted inside schema enums.
 */
type JsonPrimitive = string | number | boolean | null;

/**
 * Mutable internal representation used while translating a provider-neutral
 * JSON Schema into the smaller schema subset accepted by Google Gemini.
 */
type MutableSchema = Record<string, unknown>;

/**
 * Maximum schema depth accepted by the sanitizer.
 *
 * The bound protects the provider adapter from malformed cyclic or excessively
 * nested objects supplied through unsafe runtime calls.
 */
const MAX_SCHEMA_DEPTH = 64;

/**
 * Schema keywords intentionally forwarded to Google Gemini.
 *
 * Application-only validation keywords such as minLength, maxLength, pattern,
 * uniqueItems, additionalProperties, $schema, $defs, and $ref are deliberately
 * omitted. The original unsanitized schema remains the source of truth for the
 * central AJV validation performed after the provider returns its response.
 */
const DIRECT_SCHEMA_KEYS = new Set([
  'title',
  'description',
  'format',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'nullable',
]);

/**
 * Produces a Google-compatible structured-output schema without weakening the
 * application's final validation rules.
 *
 * Google Gemini accepts only a subset of JSON Schema. Passing the complete
 * application schema can cause a 400 INVALID_ARGUMENT response when it contains
 * unsupported keywords. This function therefore creates a provider-specific
 * copy while preserving the original schema for AJV validation.
 *
 * Important behavior:
 * - Removes unsupported application-only keywords.
 * - Converts nullable union types such as ['string', 'null'] into
 *   { type: 'string', nullable: true }.
 * - Converts const into a single-value enum.
 * - Converts oneOf into anyOf because Google supports the less restrictive
 *   union form more consistently; AJV still enforces the original oneOf later.
 * - Recursively sanitizes object properties, array items, and union branches.
 *
 * @param schema Provider-neutral JSON Schema.
 * @returns A detached Google-compatible schema object.
 *
 * @author Malak
 */
export function sanitizeJsonSchemaForGoogle(
  schema: AiJsonSchema,
): AiJsonSchema {
  if (!isPlainRecord(schema)) {
    return {};
  }

  return sanitizeSchemaNode(schema, 0);
}

/**
 * Sanitizes one schema node recursively.
 */
function sanitizeSchemaNode(
  schema: Readonly<Record<string, unknown>>,
  depth: number,
): AiJsonSchema {
  if (depth > MAX_SCHEMA_DEPTH) {
    return {};
  }

  const sanitized: MutableSchema = {};

  copyDirectKeywords(schema, sanitized);
  copyTypeKeyword(schema, sanitized);
  copyEnumOrConst(schema, sanitized);
  copyProperties(schema, sanitized, depth);
  copyRequired(schema, sanitized);
  copyItems(schema, sanitized, depth);
  copyUnionKeywords(schema, sanitized, depth);
  copyPropertyOrdering(schema, sanitized);

  return sanitized;
}

/**
 * Copies scalar keywords known to be accepted by the Google schema boundary.
 */
function copyDirectKeywords(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  for (const key of DIRECT_SCHEMA_KEYS) {
    const value = source[key];

    if (value === undefined) {
      continue;
    }

    switch (key) {
      case 'title':
      case 'description':
      case 'format':
        if (typeof value === 'string' && value.trim()) {
          target[key] = value.trim();
        }
        break;

      case 'minimum':
      case 'maximum':
        if (typeof value === 'number' && Number.isFinite(value)) {
          target[key] = value;
        }
        break;

      case 'minItems':
      case 'maxItems':
        if (Number.isSafeInteger(value) && (value as number) >= 0) {
          target[key] = value;
        }
        break;

      case 'nullable':
        if (typeof value === 'boolean') {
          target[key] = value;
        }
        break;

      default:
        break;
    }
  }
}

/**
 * Copies or normalizes the JSON Schema type keyword.
 */
function copyTypeKeyword(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  const typeValue = source.type;

  if (typeof typeValue === 'string' && typeValue.trim()) {
    target.type = typeValue.trim();
    return;
  }

  if (!Array.isArray(typeValue)) {
    return;
  }

  const normalizedTypes = Array.from(
    new Set(
      typeValue
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  const includesNull = normalizedTypes.includes('null');
  const nonNullTypes = normalizedTypes.filter((value) => value !== 'null');

  if (includesNull) {
    target.nullable = true;
  }

  if (nonNullTypes.length === 1) {
    target.type = nonNullTypes[0];
    return;
  }

  if (nonNullTypes.length > 1) {
    target.anyOf = nonNullTypes.map((value) => ({ type: value }));
  }
}

/**
 * Copies enum values or translates const into a one-value enum.
 */
function copyEnumOrConst(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  if (Array.isArray(source.enum)) {
    const enumValues = source.enum.filter(isJsonPrimitive);

    if (enumValues.length > 0) {
      target.enum = enumValues;
      return;
    }
  }

  if (isJsonPrimitive(source.const)) {
    target.enum = [source.const];
  }
}

/**
 * Recursively sanitizes object properties.
 */
function copyProperties(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
  depth: number,
): void {
  if (!isPlainRecord(source.properties)) {
    return;
  }

  const properties: Record<string, AiJsonSchema> = {};

  for (const [propertyName, propertySchema] of Object.entries(
    source.properties,
  )) {
    if (!propertyName.trim() || !isPlainRecord(propertySchema)) {
      continue;
    }

    properties[propertyName] = sanitizeSchemaNode(propertySchema, depth + 1);
  }

  if (Object.keys(properties).length > 0) {
    target.properties = properties;
  }
}

/**
 * Copies the required-property list after removing invalid entries.
 */
function copyRequired(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  if (!Array.isArray(source.required)) {
    return;
  }

  const required = Array.from(
    new Set(
      source.required
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (required.length > 0) {
    target.required = required;
  }
}

/**
 * Recursively sanitizes an array item schema or tuple-like item list.
 */
function copyItems(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
  depth: number,
): void {
  if (isPlainRecord(source.items)) {
    target.items = sanitizeSchemaNode(source.items, depth + 1);
    return;
  }

  if (Array.isArray(source.items)) {
    const tupleItems = source.items
      .filter(isPlainRecord)
      .map((item) => sanitizeSchemaNode(item, depth + 1));

    if (tupleItems.length === 1) {
      target.items = tupleItems[0];
    } else if (tupleItems.length > 1) {
      target.items = { anyOf: tupleItems };
    }
  }
}

/**
 * Copies supported union branches and safely weakens oneOf to anyOf.
 */
function copyUnionKeywords(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
  depth: number,
): void {
  const existingAnyOf = sanitizeSchemaArray(source.anyOf, depth);
  const oneOfAsAnyOf = sanitizeSchemaArray(source.oneOf, depth);

  const existingTargetAnyOf = Array.isArray(target.anyOf)
    ? target.anyOf.filter(isPlainRecord)
    : [];

  const anyOf = [
    ...existingTargetAnyOf,
    ...existingAnyOf,
    ...oneOfAsAnyOf,
  ];

  if (anyOf.length > 0) {
    target.anyOf = anyOf;
  }

  const allOf = sanitizeSchemaArray(source.allOf, depth);

  if (allOf.length === 1) {
    mergeMissingSchemaKeys(target, allOf[0]);
  }
}

/**
 * Preserves an explicitly supplied Google property ordering when valid.
 */
function copyPropertyOrdering(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  if (!Array.isArray(source.propertyOrdering)) {
    return;
  }

  const ordering = source.propertyOrdering.filter(
    (value): value is string => typeof value === 'string' && Boolean(value),
  );

  if (ordering.length > 0) {
    target.propertyOrdering = Array.from(new Set(ordering));
  }
}

/**
 * Sanitizes an array of nested schema nodes.
 */
function sanitizeSchemaArray(value: unknown, depth: number): AiJsonSchema[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPlainRecord)
    .map((item) => sanitizeSchemaNode(item, depth + 1));
}

/**
 * Merges schema keys without overwriting values already defined by the parent.
 */
function mergeMissingSchemaKeys(
  target: MutableSchema,
  source: AiJsonSchema,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

/**
 * Determines whether a value is a JSON-compatible primitive.
 */
function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * Determines whether a value is a non-array object record.
 */
function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}