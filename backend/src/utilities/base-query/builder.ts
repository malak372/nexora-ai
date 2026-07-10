import { Prisma } from '@prisma/client';

/**
 * Builds pagination values for paginated queries.
 *
 * Responsible for calculating:
 * - Current page
 * - Page size (limit)
 * - Skip value for Prisma
 *
 * Default behavior:
 * - page = 1
 * - limit = 10
 *
 * @param query Pagination query parameters
 * @returns Object containing page, limit, skip
 *
 * Example:
 * buildPagination({ page: 2, limit: 10 })
 * → { page: 2, limit: 10, skip: 10 }
 *
 * @author Malak
 */
export function buildPagination(query: { page?: number; limit?: number }) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const skip = (page - 1) * limit;
  const take = limit;

  return { page, limit, skip, take };
}

/**
 * Builds a Prisma date range filter (createdAt).
 *
 * Supports filtering using:
 * - fromDate (gte)
 * - toDate (lte)
 *
 * Returns undefined if no valid dates provided.
 *
 * @param query Date filter parameters
 * @returns Prisma filter or undefined
 *
 * Example:
 * buildDateFilter({ fromDate: "2026-01-01" })
 *
 * @author Malak
 */
export function buildDateFilter(query: { fromDate?: string; toDate?: string }) {
  if (!query.fromDate && !query.toDate) return undefined;

  const from = query.fromDate ? new Date(query.fromDate) : undefined;
  const to = query.toDate ? new Date(query.toDate) : undefined;

  if (from && isNaN(from.getTime())) return undefined;
  if (to && isNaN(to.getTime())) return undefined;

  return {
    createdAt: {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    },
  };
}

/**
 * Builds a case-insensitive multi-field search filter.
 *
 * Uses Prisma OR condition to search across fields.
 *
 * Example:
 * fields = ['name', 'email']
 *
 * @param fields Fields to search in
 * @param search Search keyword
 * @returns Prisma OR filter or undefined
 *
 * @author Malak
 */
export function buildSearchFilter(fields: string[], search?: string) {
  if (!search?.trim()) return undefined;

  return {
    OR: fields.map((field) => ({
      [field]: {
        contains: search,
        mode: 'insensitive',
      },
    })),
  };
}

/**
 * Builds a safe Prisma orderBy object.
 *
 * Ensures only allowed fields are used to prevent invalid queries.
 * Default sort direction: desc
 *
 * @param query Sorting parameters
 * @param allowedFields Allowed sortable fields
 * @param defaultField Default sorting field
 * @returns Prisma orderBy object
 *
 * @author Malak
 */
export function buildOrderBy<T extends string>(
  query: {
    sortBy?: T;
    sortOrder?: Prisma.SortOrder;
  },
  allowedFields: readonly T[],
  defaultField: T,
) {
  const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';

  const sortBy =
    query.sortBy && allowedFields.includes(query.sortBy)
      ? query.sortBy
      : defaultField;

  return {
    [sortBy]: sortOrder,
  } as Record<string, Prisma.SortOrder>;
}

/**
 * Builds an exact match Prisma filter.
 *
 * Supports:
 * - string
 * - number
 * - boolean
 * - enum values
 *
 * Returns undefined if value is null/undefined.
 *
 * @param field Field name
 * @param value Value to match
 * @returns Prisma filter or undefined
 *
 * @author Malak
 */
export function buildExactFilter<T>(field: string, value?: T) {
  if (value === undefined || value === null) return undefined;

  return {
    [field]: value,
  };
}

/**
 * Builds a relational search filter (nested relation query).
 *
 * Allows searching inside related Prisma models.
 *
 * Example:
 * relation = "user"
 * fields = ["fullName", "email"]
 *
 * @param relation Relation name
 * @param fields Fields inside relation
 * @param search Search keyword
 * @returns Prisma relation filter or undefined
 *
 * @author Malak
 */
export function buildRelationSearchFilter(
  relation: string,
  fields: string[],
  search?: string,
) {
  if (!search?.trim()) return undefined;

  return {
    [relation]: {
      OR: fields.map((field) => ({
        [field]: {
          contains: search,
          mode: 'insensitive',
        },
      })),
    },
  };
}

/**
 * Builds a case-insensitive string filter (single field).
 *
 * Used for LIKE '%value%' behavior in Prisma.
 *
 * Example:
 * buildStringFilter('region', 'Palestine')
 *
 * Output:
 * {
 *   region: {
 *     contains: 'Palestine',
 *     mode: 'insensitive'
 *   }
 * }
 *
 * @param field Prisma field name
 * @param value Search value
 * @returns Prisma filter or undefined
 *
 * @author Malak
 */
export function buildStringFilter(field: string, value?: string) {
  if (!value?.trim()) return undefined;

  return {
    [field]: {
      contains: value,
      mode: 'insensitive',
    },
  };
}
