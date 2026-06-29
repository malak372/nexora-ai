import { Decimal } from '@prisma/client/runtime/library';
/**
 * @Author Malak
 * @Description
 * This file contains utility functions for analytics and reporting.
 */
export type DateRange = {
  fromDate?: string;
  toDate?: string;
};

export type Period = 'daily' | 'monthly';

export type TrendItem = {
  date: string;
  count: number;
};

export type MetricComparison = {
  current: number;
  previous: number;
  change: number;
  changePercentage: number;
};

/**
 * Converts Prisma Decimal, number, string, null, or undefined
 * into a safe JavaScript number.
 *
 * This is useful for report calculations because Prisma Decimal
 * fields cannot always be used directly in arithmetic operations.
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
 * - fromDate as greater than or equal
 * - toDate as less than or equal
 *
 * If no date is provided, or if an invalid date is provided,
 * an empty filter object is returned.
 */
export function buildReportDateFilter(query: DateRange) {
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
 * - Last 30 days
 */
export function getCurrentPeriodRange(days = 30) {
  const endDate = new Date();
  const startDate = new Date(endDate);

  startDate.setDate(startDate.getDate() - days);

  return { startDate, endDate };
}

/**
 * Returns the start and end dates for the previous reporting period.
 *
 * Example:
 * - If the current period is the last 30 days,
 *   this returns the 30 days before that.
 */
export function getPreviousPeriodRange(days = 30) {
  const { startDate: currentStartDate } = getCurrentPeriodRange(days);

  const endDate = new Date(currentStartDate);
  const startDate = new Date(currentStartDate);

  startDate.setDate(startDate.getDate() - days);

  return { startDate, endDate };
}

/**
 * Calculates the percentage change between current and previous values.
 *
 * Rules:
 * - 0 to 0 returns 0%
 * - 0 to any positive number returns 100%
 * - Otherwise, standard percentage change formula is used
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
 * - current value
 * - previous value
 * - numeric change
 * - percentage change
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
 */
export function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Formats a Date object as YYYY-MM.
 *
 * Used for monthly trend grouping.
 */
export function formatMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Groups records by day or month based on their createdAt field.
 *
 * This is useful for simple trend reports such as:
 * - user registrations over time
 * - payments over time
 * - generated ideas over time
 *
 * Note:
 * For very large tables, prefer Prisma groupBy or raw SQL
 * instead of loading all records into memory.
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
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Groups records by a selected enum or string field.
 *
 * Example:
 * - group payments by status
 * - group users by accountStatus
 * - group ideas by generationType
 */
export function groupByField<T>(
  records: T[],
  field: keyof T,
): Record<string, number> {
  return records.reduce<Record<string, number>>((acc, record) => {
    const key = String(record[field] ?? 'UNKNOWN');

    acc[key] = (acc[key] ?? 0) + 1;

    return acc;
  }, {});
}

/**
 * Calculates the total sum of a numeric field.
 *
 * Supports:
 * - number
 * - string numbers
 * - Prisma Decimal
 * - null or undefined values
 */
export function sumByField<T>(
  records: T[],
  field: keyof T,
): number {
  return records.reduce((total, record) => {
    return (
      total +
      toNumber(record[field] as Decimal | number | string | null | undefined)
    );
  }, 0);
}

/**
 * Calculates the average value of a numeric field.
 *
 * Returns 0 when the records array is empty.
 */
export function averageByField<T>(
  records: T[],
  field: keyof T,
): number {
  if (records.length === 0) {
    return 0;
  }

  return Number((sumByField(records, field) / records.length).toFixed(2));
}

/**
 * Calculates success rate as a percentage.
 *
 * Example:
 * successCount = 80
 * totalCount = 100
 * result = 80
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
 * - commas
 * - quotes
 * - null or undefined values
 */
export function escapeCsvValue(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * Converts headers and rows into a CSV string.
 *
 * Example:
 * buildCsv(['Name', 'Email'], [['Malak', 'test@example.com']])
 */
export function buildCsv(
  headers: string[],
  rows: unknown[][],
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\n');
}

/**
 * Calculates the total number of pages for paginated reports.
 *
 * Returns 0 if limit is invalid.
 */
export function calculateTotalPages(
  total: number,
  limit: number,
): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.ceil(total / limit);
}