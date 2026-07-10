import { Decimal } from '@prisma/client/runtime/library';

/**
 * Date range used for analytics and report filters.
 */
export type DateRange = {
  /**
   * Optional inclusive start date.
   */
  fromDate?: string;

  /**
   * Optional inclusive end date.
   */
  toDate?: string;
};

/**
 * Supported report grouping periods.
 */
export type Period = 'daily' | 'monthly';

/**
 * Represents one analytics trend data point.
 */
export type TrendItem = {
  /**
   * Formatted date or month key.
   */
  date: string;

  /**
   * Number of records associated with the period.
   */
  count: number;
};

/**
 * Represents a metric comparison between the current
 * and previous reporting periods.
 */
export type MetricComparison = {
  /**
   * Metric value for the current period.
   */
  current: number;

  /**
   * Metric value for the previous period.
   */
  previous: number;

  /**
   * Numeric difference between current and previous values.
   */
  change: number;

  /**
   * Percentage difference between current and previous values.
   */
  changePercentage: number;
};

/**
 * Converts Prisma Decimal, number, string, null, or undefined
 * into a safe JavaScript number.
 *
 * This is useful for report calculations because Prisma Decimal
 * fields cannot always be used directly in arithmetic operations.
 *
 * @param value Value to convert.
 * @returns Safe numeric value, or zero when conversion fails.
 */
export function toNumber(
  value: Decimal | number | string | null | undefined,
): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (value instanceof Decimal) {
    return value.toNumber();
  }

  const numericValue = Number(value);

  return Number.isNaN(numericValue) ? 0 : numericValue;
}

/**
 * Builds a safe Prisma date range filter using createdAt.
 *
 * Supports:
 * - fromDate as greater than or equal.
 * - toDate as less than or equal.
 *
 * If no date is provided, or if an invalid date is provided,
 * an empty filter object is returned.
 *
 * @param query Date range query.
 * @returns Created-at filter or an empty object.
 */
export function buildReportDateFilter(query: DateRange): {
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
} {
  if (!query.fromDate && !query.toDate) {
    return {};
  }

  const from = query.fromDate ? new Date(query.fromDate) : undefined;

  const to = query.toDate ? new Date(query.toDate) : undefined;

  if (from && Number.isNaN(from.getTime())) {
    return {};
  }

  if (to && Number.isNaN(to.getTime())) {
    return {};
  }

  return {
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

/**
 * Returns the start and end dates for the current reporting period.
 *
 * Default period:
 * - Last 30 days.
 *
 * @param days Number of days in the reporting period.
 * @returns Current reporting period range.
 */
export function getCurrentPeriodRange(days = 30): {
  startDate: Date;
  endDate: Date;
} {
  const endDate = new Date();
  const startDate = new Date(endDate);

  startDate.setDate(startDate.getDate() - days);

  return {
    startDate,
    endDate,
  };
}

/**
 * Returns the start and end dates for the previous reporting period.
 *
 * Example:
 * - If the current period is the last 30 days,
 *   this returns the 30 days before that.
 *
 * @param days Number of days in the reporting period.
 * @returns Previous reporting period range.
 */
export function getPreviousPeriodRange(days = 30): {
  startDate: Date;
  endDate: Date;
} {
  const { startDate: currentStartDate } = getCurrentPeriodRange(days);

  const endDate = new Date(currentStartDate);

  const startDate = new Date(currentStartDate);

  startDate.setDate(startDate.getDate() - days);

  return {
    startDate,
    endDate,
  };
}

/**
 * Calculates the percentage change between current
 * and previous values.
 *
 * Rules:
 * - 0 to 0 returns 0%.
 * - 0 to any positive number returns 100%.
 * - Otherwise, the standard percentage-change formula is used.
 *
 * @param current Current metric value.
 * @param previous Previous metric value.
 * @returns Percentage change.
 */
export function calculateChangePercentage(
  current: number,
  previous: number,
): number {
  if (previous === 0 && current === 0) {
    return 0;
  }

  if (previous === 0) {
    return 100;
  }

  return Number((((current - previous) / previous) * 100).toFixed(2));
}

/**
 * Builds a full comparison object for report metrics.
 *
 * Includes:
 * - Current value.
 * - Previous value.
 * - Numeric change.
 * - Percentage change.
 *
 * @param current Current metric value.
 * @param previous Previous metric value.
 * @returns Metric comparison result.
 */
export function buildMetricComparison(
  current: number,
  previous: number,
): MetricComparison {
  return {
    current,
    previous,
    change: current - previous,
    changePercentage: calculateChangePercentage(current, previous),
  };
}

/**
 * Formats a Date object as YYYY-MM-DD.
 *
 * Used for daily trend grouping.
 *
 * @param date Date to format.
 * @returns Daily date key.
 */
export function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Formats a Date object as YYYY-MM.
 *
 * Used for monthly trend grouping.
 *
 * @param date Date to format.
 * @returns Monthly date key.
 */
export function formatMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Groups records by day or month using their createdAt field.
 *
 * This is useful for simple trend reports such as:
 * - User registrations over time.
 * - Payments over time.
 * - Generated ideas over time.
 *
 * Note:
 * For very large tables, prefer Prisma groupBy or raw SQL
 * instead of loading all records into memory.
 *
 * @template T Record type containing createdAt.
 * @param records Records to group.
 * @param period Daily or monthly grouping period.
 * @returns Sorted trend data.
 */
export function groupRecordsByPeriod<T extends { createdAt: Date }>(
  records: T[],
  period: Period = 'daily',
): TrendItem[] {
  const grouped = new Map<string, number>();

  records.forEach((record) => {
    const key =
      period === 'monthly'
        ? formatMonthKey(record.createdAt)
        : formatDateKey(record.createdAt);

    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  });

  return Array.from(grouped.entries())
    .map(([date, count]) => ({
      date,
      count,
    }))
    .sort((first, second) => first.date.localeCompare(second.date));
}

/**
 * Groups records by a selected enum or string field.
 *
 * Examples:
 * - Group payments by status.
 * - Group users by accountStatus.
 * - Group ideas by generationType.
 *
 * @template T Record type.
 * @param records Records to group.
 * @param field Field used as grouping key.
 * @returns Counts grouped by normalized field value.
 */
export function groupByField<T>(
  records: T[],
  field: keyof T,
): Record<string, number> {
  return records.reduce<Record<string, number>>((accumulator, record) => {
    const key = toSafeString(record[field] ?? 'UNKNOWN');

    accumulator[key] = (accumulator[key] ?? 0) + 1;

    return accumulator;
  }, {});
}

/**
 * Calculates the total sum of a numeric field.
 *
 * Supports:
 * - Number.
 * - Numeric string.
 * - Prisma Decimal.
 * - Null or undefined values.
 *
 * @template T Record type.
 * @param records Records to sum.
 * @param field Numeric field.
 * @returns Numeric total.
 */
export function sumByField<T>(records: T[], field: keyof T): number {
  return records.reduce(
    (total, record) =>
      total +
      toNumber(record[field] as Decimal | number | string | null | undefined),
    0,
  );
}

/**
 * Calculates the average value of a numeric field.
 *
 * Returns zero when the records array is empty.
 *
 * @template T Record type.
 * @param records Records to average.
 * @param field Numeric field.
 * @returns Average numeric value.
 */
export function averageByField<T>(records: T[], field: keyof T): number {
  if (records.length === 0) {
    return 0;
  }

  return Number((sumByField(records, field) / records.length).toFixed(2));
}

/**
 * Calculates success rate as a percentage.
 *
 * Example:
 * - successCount = 80
 * - totalCount = 100
 * - result = 80
 *
 * @param successCount Number of successful records.
 * @param totalCount Total number of records.
 * @returns Success percentage.
 */
export function calculateSuccessRate(
  successCount: number,
  totalCount: number,
): number {
  if (totalCount === 0) {
    return 0;
  }

  return Number(((successCount / totalCount) * 100).toFixed(2));
}

/**
 * Escapes a single CSV value safely.
 *
 * Handles:
 * - Commas.
 * - Quotes.
 * - Objects and arrays.
 * - Null or undefined values.
 *
 * @param value Value to escape.
 * @returns Quoted CSV-safe value.
 */
export function escapeCsvValue(value: unknown): string {
  const normalizedValue = toSafeString(value);

  return `"${normalizedValue.replace(/"/g, '""')}"`;
}

/**
 * Converts headers and rows into a CSV string.
 *
 * Example:
 * buildCsv(
 *   ['Name', 'Email'],
 *   [['Malak', 'test@example.com']],
 * )
 *
 * @param headers CSV column headers.
 * @param rows CSV data rows.
 * @returns Complete CSV string.
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
    .join('\n');
}

/**
 * Calculates the total number of pages for paginated reports.
 *
 * Returns zero if the limit is invalid.
 *
 * @param total Total number of records.
 * @param limit Number of records per page.
 * @returns Total page count.
 */
export function calculateTotalPages(total: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.ceil(total / limit);
}

/**
 * Converts an unknown value into a safe string.
 *
 * Primitive values are converted directly.
 * Objects and arrays are serialized as JSON instead of using
 * JavaScript's default "[object Object]" representation.
 *
 * @param value Unknown value.
 * @returns Safe textual representation.
 */
function toSafeString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Decimal) {
    return value.toString();
  }

  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
