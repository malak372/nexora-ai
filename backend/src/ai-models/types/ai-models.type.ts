import type { AiModel } from '@prisma/client';

/**
 * Paginated result returned by the administrator AI-model listing
 * endpoint.
 *
 * @author Malak
 */
export type PaginatedAiModelsResult = {
  /**
   * AI-model records included in the current page.
   */
  readonly data: AiModel[];

  /**
   * Pagination metadata.
   */
  readonly meta: {
    /**
     * Current one-based page number.
     */
    readonly page: number;

    /**
     * Maximum number of records returned per page.
     */
    readonly limit: number;

    /**
     * Total number of models matching the supplied filters.
     */
    readonly total: number;

    /**
     * Total number of available pages.
     */
    readonly totalPages: number;
  };
};
