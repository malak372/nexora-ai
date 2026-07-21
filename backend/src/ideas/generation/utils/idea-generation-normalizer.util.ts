/**
 * Options used when normalizing generation string arrays.
 *
 * @author Malak
 */
export type NormalizeGenerationStringArrayOptions = {
  /**
   * Converts normalized values to lowercase.
   */
  lowercase?: boolean;

  /**
   * Maximum number of values allowed in the returned array.
   *
   * Values beyond this limit are discarded after normalization
   * and deduplication.
   */
  maxItems?: number;

  /**
   * Maximum length allowed for each normalized string.
   *
   * Longer values are truncated.
   */
  maxItemLength?: number;
};

/**
 * Normalizes an optional text value.
 *
 * Non-string, empty, and whitespace-only values become
 * undefined.
 *
 * @param value Raw optional value.
 * @returns Trimmed text or undefined.
 *
 * @author Malak
 */
export function normalizeOptionalGenerationText(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue || undefined;
}

/**
 * Normalizes a nullable text value.
 *
 * Non-string, empty, and whitespace-only values become null.
 *
 * @param value Raw optional value.
 * @returns Trimmed text or null.
 *
 * @author Malak
 */
export function normalizeNullableGenerationText(
  value: string | null | undefined,
): string | null {
  return normalizeOptionalGenerationText(value) ?? null;
}

/**
 * Normalizes a required text value.
 *
 * @param value Raw required text.
 * @param fieldName Field name used in error messages.
 * @returns Trimmed required text.
 * @throws Error when the normalized value is empty.
 *
 * @author Malak
 */
export function normalizeRequiredGenerationText(
  value: string,
  fieldName: string,
): string {
  const normalizedValue = normalizeOptionalGenerationText(value);

  if (!normalizedValue) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalizedValue;
}

/**
 * Normalizes a required identifier.
 *
 * This is an alias with clearer semantics for IDs used by the
 * generation workflow.
 *
 * @param value Raw identifier.
 * @param fieldName Identifier field name.
 * @returns Normalized required identifier.
 *
 * @author Malak
 */
export function normalizeGenerationId(
  value: string,
  fieldName: string,
): string {
  return normalizeRequiredGenerationText(value, fieldName);
}

/**
 * Trims, filters, limits, and deduplicates a string array while
 * preserving original order.
 *
 * Duplicate comparison follows the final normalized value. When
 * lowercase is enabled, values that differ only by letter case
 * are treated as duplicates.
 *
 * @param values Raw string values.
 * @param options Normalization options.
 * @returns Normalized unique string array.
 *
 * @author Malak
 */
export function normalizeGenerationStringArray(
  values: readonly string[] | null | undefined,
  options: NormalizeGenerationStringArrayOptions = {},
): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const { lowercase = false, maxItems, maxItemLength } = options;

  validateOptionalPositiveInteger(maxItems, 'Maximum generation array items');

  validateOptionalPositiveInteger(
    maxItemLength,
    'Maximum generation item length',
  );

  const normalizedValues: string[] = [];
  const seenValues = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    let normalizedValue = value.trim();

    if (!normalizedValue) {
      continue;
    }

    if (maxItemLength !== undefined && normalizedValue.length > maxItemLength) {
      normalizedValue = normalizedValue.slice(0, maxItemLength);
    }

    if (lowercase) {
      normalizedValue = normalizedValue.toLowerCase();
    }

    if (seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);

    if (maxItems !== undefined && normalizedValues.length >= maxItems) {
      break;
    }
  }

  return normalizedValues;
}

/**
 * Normalizes keywords used by idea generation.
 *
 * Keywords are:
 * - Trimmed.
 * - Converted to lowercase.
 * - Deduplicated.
 *
 * @param keywords Raw keyword values.
 * @param maxItems Optional keyword count limit.
 * @param maxItemLength Optional per-keyword length limit.
 * @returns Normalized keyword list.
 *
 * @author Malak
 */
export function normalizeGenerationKeywords(
  keywords: readonly string[] | null | undefined,
  maxItems?: number,
  maxItemLength?: number,
): string[] {
  return normalizeGenerationStringArray(keywords, {
    lowercase: true,
    maxItems,
    maxItemLength,
  });
}

/**
 * Merges multiple string arrays into one normalized and
 * deduplicated list.
 *
 * Values keep the order in which they first appear across the
 * input arrays.
 *
 * The merge is implemented with an explicit loop instead of
 * Array.prototype.flatMap so TypeScript preserves the concrete
 * string-array type and strict ESLint rules do not infer any[].
 *
 * @param groups String-array groups to merge.
 * @param options Normalization options.
 * @returns Merged normalized array.
 *
 * @author Malak
 */
export function mergeGenerationStringArrays(
  groups: readonly (readonly string[] | null | undefined)[],
  options: NormalizeGenerationStringArrayOptions = {},
): string[] {
  const mergedValues: string[] = [];

  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const value of group) {
      if (typeof value === 'string') {
        mergedValues.push(value);
      }
    }
  }

  return normalizeGenerationStringArray(mergedValues, options);
}

/**
 * Normalizes one optional finite number.
 *
 * @param value Raw number.
 * @returns Finite number or undefined.
 *
 * @author Malak
 */
export function normalizeOptionalGenerationNumber(
  value: number | null | undefined,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

/**
 * Normalizes one optional integer.
 *
 * @param value Raw number.
 * @returns Integer or undefined.
 *
 * @author Malak
 */
export function normalizeOptionalGenerationInteger(
  value: number | null | undefined,
): number | undefined {
  const normalizedValue = normalizeOptionalGenerationNumber(value);

  if (normalizedValue === undefined || !Number.isInteger(normalizedValue)) {
    return undefined;
  }

  return normalizedValue;
}

/**
 * Ensures one optional numeric configuration value is a positive
 * integer.
 *
 * @param value Optional numeric value.
 * @param fieldName Field name used in errors.
 *
 * @throws Error When the provided value is not a positive integer.
 *
 * @author Malak
 */
function validateOptionalPositiveInteger(
  value: number | undefined,
  fieldName: string,
): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
}
