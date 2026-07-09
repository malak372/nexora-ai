import { Prisma } from '@prisma/client';

/**
 * Prompt history record with relations required by Admin history views.
 */
export type PromptHistoryWithRelations = Prisma.PromptHistoryGetPayload<{
  include: {
    idea: {
      select: {
        id: true;
        title: true;
        generationType: true;
        isUnlocked: true;
        unlockMethod: true;
      };
    };
    collectionJob: {
      select: {
        id: true;
        country: true;
        city: true;
        region: true;
        status: true;
        totalPosts: true;
        totalComments: true;
        createdAt: true;
      };
    };
  };
}>;

/**
 * Paginated prompt history response.
 */
export type PaginatedPromptHistory = {
  readonly data: PromptHistoryWithRelations[];
  readonly meta: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
};