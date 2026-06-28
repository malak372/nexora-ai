import { Prisma } from '@prisma/client';

/**
 * Builds pagination values for paginated queries.
 *
 * Calculates the current page, page size, and the
 * number of records to skip based on the provided
 * pagination parameters.
 *
 * Default values:
 * - page: 1
 * - limit: 10
 *
 * @param query Query object containing the optional
 * page number and page size.
 * @returns Pagination values including page, limit,
 * and skip.
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
 * Builds a Prisma createdAt date filter.
 *
 * Creates a date range filter using the optional
 * start and end dates. If no dates are provided,
 * no filter is returned.
 *
 * @param query Query object containing the optional
 * fromDate and toDate values.
 * @returns Prisma createdAt filter or undefined
 * when no date filters are provided.
 *
 * @author Malak
 */
export function buildDateFilter(query: {
  fromDate?: string;
  toDate?: string;
}) {
  if (!query.fromDate && !query.toDate) return undefined;

  return {
    createdAt: {
      ...(query.fromDate && { gte: new Date(query.fromDate) }),
      ...(query.toDate && { lte: new Date(query.toDate) }),
    },
  };
}

/**
 * Builds a case-insensitive Prisma search filter.
 *
 * Creates an OR condition that searches the provided
 * value across multiple fields using partial,
 * case-insensitive matching.
 *
 * @param fields List of searchable fields.
 * @param search Search keyword.
 * @returns Prisma OR filter or undefined when
 * no search keyword is provided.
 *
 * @author Malak
 */
export function buildSearchFilter(
  fields: string[],
  search?: string,
) {
  if (!search) return undefined;

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
 * Builds a validated Prisma orderBy object.
 *
 * Ensures that only allowed sorting fields are used.
 * If an invalid or missing field is provided, the
 * default field is used instead.
 *
 * The sorting direction defaults to descending.
 *
 * @param query Query object containing the optional
 * sorting field and sorting direction.
 * @param allowedFields List of supported sorting fields.
 * @param defaultField Default sorting field.
 * @returns Prisma orderBy object.
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
 * Builds a Prisma exact-match filter.
 *
 * Creates an exact-match filter for the specified field.
 * Supports enum, string, number, boolean, and other scalar values.
 *
 * @param field Name of the field to filter.
 * @param value Value to match.
 * @returns Prisma filter object, or undefined if
 * no value is provided.
 *
 * @author Malak
 */
export function buildExactFilter<T>(
  field: string,
  value?: T,
) {
  if (value === undefined || value === null) return undefined;

  return {
    [field]: value,
  };
}