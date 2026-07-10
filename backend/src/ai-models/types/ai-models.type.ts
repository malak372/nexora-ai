import { AiModel } from '@prisma/client';

/**
 * Paginated AI-model response.
 *
 * @author Malak
 */
export type PaginatedAiModelsResult = {
  /**
   * AI-model records returned for the current page.
   */
  readonly data: AiModel[];

  /**
   * Pagination metadata.
   */
  readonly meta: {
    /**
     * Current page number.
     */
    readonly page: number;

    /**
     * Maximum records returned per page.
     */
    readonly limit: number;

    /**
     * Total matching records.
     */
    readonly total: number;

    /**
     * Total number of available pages.
     */
    readonly totalPages: number;
  };
};
