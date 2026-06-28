import { Prisma } from '@prisma/client';

/**
 * Builds pagination values for paginated queries.
 *
 * Calculates:
 * - current page
 * - page size (limit)
 * - number of records to skip
 *
 * Default values:
 * - page = 1
 * - limit = 10
 *
 * @param query Pagination query parameters
 * @returns Object containing page, limit, skip
 *
 * @author Malak
 */
export function buildPagination(query: {
  page?: number;
  limit?: number;
}) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Builds a Prisma date range filter (createdAt).
 *
 * Supports:
 * - fromDate (gte)
 * - toDate (lte)
 *
 * Returns undefined if no dates provided.
 *
 * @param query Date filter parameters
 * @returns Prisma date filter or undefined
 *
 * @author Malak
 */
export function buildDateFilter(query: {
  fromDate?: string;
  toDate?: string;
}) {
  if (!query.fromDate && !query.toDate) return undefined;

  const from = query.fromDate ? new Date(query.fromDate) : undefined;
  const to = query.toDate ? new Date(query.toDate) : undefined;

  return {
    createdAt: {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    },
  };
}

/**
 * Builds a case-insensitive search filter.
 *
 * Searches across multiple fields using OR condition.
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
export function buildSearchFilter(
  fields: string[],
  search?: string,
) {
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
 * Ensures only allowed fields are used for sorting.
 * Prevents invalid sorting and injection issues.
 *
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
  const sortOrder: Prisma.SortOrder =
    query.sortOrder ?? 'desc';

  const sortBy =
    query.sortBy && allowedFields.includes(query.sortBy)
      ? query.sortBy
      : defaultField;

  return {
    [sortBy]: sortOrder,
  } as Record<string, Prisma.SortOrder>;
}

/**
 * Builds an exact match filter.
 *
 * Supports:
 * - string
 * - number
 * - boolean
 * - enum values
 *
 * Returns undefined if value is not provided.
 *
 * @param field Field name
 * @param value Value to match
 * @returns Prisma filter or undefined
 *
 * @author Malak
 */
export function buildExactFilter<T>(
  field: string,
  value?: T,
) {
  if (value === undefined) return undefined;

  return {
    [field]: value,
  };
}

/**
 * Builds a relational search filter.
 *
 * Used to search inside related models (relations)
 * using nested OR conditions.
 *
 * Example:
 * relation = 'user'
 * fields = ['fullName', 'email']
 *
 * @param relation Relation name
 * @param fields Fields inside relation
 * @param search Search keyword
 * @returns Prisma relational filter or undefined
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
 * Builds a case-insensitive string filter for Prisma.
 *
 * Used for partial matching (LIKE %value%) on string fields.
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
 * @param field - Prisma field name
 * @param value - search value
 * @returns Prisma filter or undefined
 */
export function buildStringFilter(
  field: string,
  value?: string,
) {
  if (!value) return undefined;

  return {
    [field]: {
      contains: value,
      mode: 'insensitive',
    },
  };
}