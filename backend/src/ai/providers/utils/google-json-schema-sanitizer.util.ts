import type { AiJsonSchema } from '../../types/ai-json-schema.type';

/**
 * Mutable internal schema representation used while producing a detached
 * Google-compatible JSON Schema object.
 */
type MutableSchema = Record<string, unknown>;

/**
 * Maximum recursive schema depth accepted by the sanitizer.
 *
 * The bound protects the provider boundary from malformed or excessively
 * nested runtime objects supplied through unsafe JavaScript callers.
 */
const MAX_SCHEMA_DEPTH = 64;

/**
 * JSON Schema keywords supported by Google `responseJsonSchema`.
 *
 * Keywords such as `$schema`, `minLength`, `maxLength`, `pattern`, and
 * `uniqueItems` are intentionally omitted from the provider copy. The original
 * application schema remains unchanged and is still enforced centrally by AJV
 * after the provider returns its response.
 */
const SUPPORTED_SCALAR_KEYS = new Set([
  '$id',
  '$anchor',
  '$ref',
  'title',
  'description',
  'format',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

/**
 * Produces a detached JSON Schema containing only features accepted by the
 * Google Gemini `responseJsonSchema` boundary.
 *
 * Important behavior:
 * - Preserves standard nullable unions such as `type: ['string', 'null']`.
 * - Preserves `additionalProperties`, `$defs`, `$ref`, `anyOf`, and `oneOf`.
 * - Removes unsupported validation-only keywords from the provider copy.
 * - Keeps the caller's original schema untouched for strict AJV validation.
 *
 * @param schema Provider-neutral application JSON Schema.
 * @returns Detached Google-compatible JSON Schema.
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
  source: Readonly<Record<string, unknown>>,
  depth: number,
): AiJsonSchema {
  if (depth > MAX_SCHEMA_DEPTH) {
    return {};
  }

  const target: MutableSchema = {};

  copyScalarKeywords(source, target);
  copyTypeKeyword(source, target);
  copyEnumKeyword(source, target);
  copyProperties(source, target, depth);
  copyRequiredKeyword(source, target);
  copyItemsKeywords(source, target, depth);
  copyUnionKeywords(source, target, depth);
  copyAdditionalProperties(source, target, depth);
  copyDefinitions(source, target, depth);
  copyPropertyOrdering(source, target);

  return target;
}

/**
 * Copies supported scalar keywords after validating their runtime type.
 */
function copyScalarKeywords(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  for (const key of SUPPORTED_SCALAR_KEYS) {
    const value = source[key];

    if (value === undefined) {
      continue;
    }

    if (
      ['$id', '$anchor', '$ref', 'title', 'description', 'format'].includes(key)
    ) {
      if (typeof value === 'string' && value.trim()) {
        target[key] = value.trim();
      }

      continue;
    }

    if (['minimum', 'maximum'].includes(key)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        target[key] = value;
      }

      continue;
    }

    if (
      ['minItems', 'maxItems'].includes(key) &&
      Number.isSafeInteger(value) &&
      (value as number) >= 0
    ) {
      target[key] = value;
    }
  }
}

/**
 * Copies a supported primitive type or primitive-type union.
 *
 * Google `responseJsonSchema` follows JSON Schema semantics for nullable
 * values, so `['string', 'null']` must remain a type array rather than being
 * converted to the OpenAPI-only `nullable` keyword.
 */
function copyTypeKeyword(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  if (typeof source.type === 'string') {
    const normalizedType = source.type.trim();

    if (normalizedType) {
      target.type = normalizedType;
    }

    return;
  }

  if (!Array.isArray(source.type)) {
    return;
  }

  const normalizedTypes = Array.from(
    new Set(
      source.type
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (normalizedTypes.length > 0) {
    target.type = normalizedTypes;
  }
}

/**
 * Copies string and numeric enum values.
 */
function copyEnumKeyword(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  if (!Array.isArray(source.enum)) {
    return;
  }

  const values = source.enum.filter(
    (value): value is string | number =>
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value)),
  );

  if (values.length > 0) {
    target.enum = values;
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

  for (const [name, value] of Object.entries(source.properties)) {
    if (!name.trim() || !isPlainRecord(value)) {
      continue;
    }

    properties[name] = sanitizeSchemaNode(value, depth + 1);
  }

  if (Object.keys(properties).length > 0) {
    target.properties = properties;
  }
}

/**
 * Copies the required-property list after removing invalid entries.
 */
function copyRequiredKeyword(
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
 * Recursively sanitizes homogeneous and tuple-style array item schemas.
 */
function copyItemsKeywords(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
  depth: number,
): void {
  if (isPlainRecord(source.items)) {
    target.items = sanitizeSchemaNode(source.items, depth + 1);
  }

  if (Array.isArray(source.prefixItems)) {
    const prefixItems = source.prefixItems
      .filter(isPlainRecord)
      .map((item) => sanitizeSchemaNode(item, depth + 1));

    if (prefixItems.length > 0) {
      target.prefixItems = prefixItems;
    }
  }
}

/**
 * Copies supported union branches.
 */
function copyUnionKeywords(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
  depth: number,
): void {
  const anyOf = sanitizeSchemaArray(source.anyOf, depth);
  const oneOf = sanitizeSchemaArray(source.oneOf, depth);

  if (anyOf.length > 0) {
    target.anyOf = anyOf;
  }

  if (oneOf.length > 0) {
    target.oneOf = oneOf;
  }
}

/**
 * Copies `additionalProperties` when it is a boolean or nested schema.
 */
function copyAdditionalProperties(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
  depth: number,
): void {
  if (typeof source.additionalProperties === 'boolean') {
    target.additionalProperties = source.additionalProperties;
    return;
  }

  if (isPlainRecord(source.additionalProperties)) {
    target.additionalProperties = sanitizeSchemaNode(
      source.additionalProperties,
      depth + 1,
    );
  }
}

/**
 * Recursively sanitizes reusable `$defs` definitions.
 */
function copyDefinitions(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
  depth: number,
): void {
  if (!isPlainRecord(source.$defs)) {
    return;
  }

  const definitions: Record<string, AiJsonSchema> = {};

  for (const [name, value] of Object.entries(source.$defs)) {
    if (!name.trim() || !isPlainRecord(value)) {
      continue;
    }

    definitions[name] = sanitizeSchemaNode(value, depth + 1);
  }

  if (Object.keys(definitions).length > 0) {
    target.$defs = definitions;
  }
}

/**
 * Preserves Google's optional property-ordering extension.
 */
function copyPropertyOrdering(
  source: Readonly<Record<string, unknown>>,
  target: MutableSchema,
): void {
  if (!Array.isArray(source.propertyOrdering)) {
    return;
  }

  const ordering = Array.from(
    new Set(
      source.propertyOrdering
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (ordering.length > 0) {
    target.propertyOrdering = ordering;
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
 * Determines whether a value is a non-array object record.
 */
function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
