import { Prisma } from '@prisma/client';

/**
 * Represents a JSON value that may contain a nested null value.
 *
 * Prisma distinguishes between a database null and a JSON null
 * when the value is stored at the top level of a JSON field.
 */
type SanitizedJsonValue =
  | Prisma.InputJsonValue
  | null;

/**
 * Represents a mutable JSON object while it is being constructed.
 *
 * Prisma.InputJsonObject contains readonly properties, so a
 * mutable record is used while building the result.
 */
type MutableInputJsonObject = Record<
  string,
  SanitizedJsonValue
>;

/**
 * Determines whether a value is a plain JSON object.
 */
export function isJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Converts an unknown value into a Prisma-compatible JSON input.
 *
 * Top-level null and undefined values are stored as JSON null.
 */
export function toPrismaJsonValue(
  value: unknown,
): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }

  const sanitizedValue = sanitizeJsonValue(value);

  return sanitizedValue === null
    ? Prisma.JsonNull
    : sanitizedValue;
}

/**
 * Converts an unknown value into a valid JSON-compatible value.
 *
 * Supported conversions:
 * - Dates become ISO strings.
 * - BigInt values become strings.
 * - Non-finite numbers become strings.
 * - Undefined array entries become null.
 * - Undefined object properties become null.
 * - Functions and symbols are omitted from objects.
 */
function sanitizeJsonValue(
  value: unknown,
): SanitizedJsonValue {
  if (value === null) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (
        item === undefined ||
        typeof item === 'function' ||
        typeof item === 'symbol'
      ) {
        return null;
      }

      return sanitizeJsonValue(item);
    });
  }

  if (isJsonObject(value)) {
    const result: MutableInputJsonObject = {};

    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === 'function' ||
        typeof item === 'symbol'
      ) {
        continue;
      }

      result[key] =
        item === undefined
          ? null
          : sanitizeJsonValue(item);
    }

    return result;
  }

  return String(value);
}

/**
 * Safely reads an object stored in a Prisma JSON field.
 *
 * Returns null when the stored value is not an object.
 */
export function readPrismaJsonObject(
  value: Prisma.JsonValue | null,
): Prisma.JsonObject | null {
  if (!isJsonObject(value)) {
    return null;
  }

  return value as Prisma.JsonObject;
}

/**
 * Safely reads an array stored in a Prisma JSON field.
 *
 * Returns an empty array when the stored value is not an array.
 */
export function readPrismaJsonArray(
  value: Prisma.JsonValue | null,
): Prisma.JsonArray {
  return Array.isArray(value)
    ? (value as Prisma.JsonArray)
    : [];
}