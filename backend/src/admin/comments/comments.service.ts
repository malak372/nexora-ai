import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { buildPagination } from '../../utilities/base-query/builder';
import { GetCommentsQueryDto } from './dto/get-comments-query.dto';

/**
 * Provides administrative monitoring and analytics for collected comments.
 *
 * The current schema associates a comment with a SocialPost, while the post
 * carries the DataSource and geographical metadata. All filters therefore use
 * relational Prisma conditions instead of the removed platformId field.
 *
 * @author Malak
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Builds one reusable filter for lists, summaries and charts. */
  private buildWhere(
    query: GetCommentsQueryDto,
  ): Prisma.SocialCommentWhereInput {
    return {
      ...(query.search
        ? {
            content: {
              contains: query.search,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
      ...(query.language
        ? {
            languageCode: {
              equals: query.language,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
      ...(query.fromDate || query.toDate
        ? {
            createdAt: {
              ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
              ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
            },
          }
        : {}),
      ...(query.dataSourceId || query.region
        ? {
            post: {
              is: {
                ...(query.dataSourceId
                  ? { dataSourceId: query.dataSourceId }
                  : {}),
                ...(query.region
                  ? {
                      region: {
                        equals: query.region,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
    };
  }

  /** Returns paginated comments with their source and post context. */
  async getComments(query: GetCommentsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);
    const where = this.buildWhere(query);

    const allowedSortFields = new Set([
      'createdAt',
      'collectedAt',
      'publishedAt',
      'likesCount',
    ]);
    const sortBy = allowedSortFields.has(query.sortBy ?? '')
      ? query.sortBy!
      : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [data, total] = await Promise.all([
      this.prisma.socialComment.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          externalId: true,
          content: true,
          author: true,
          languageCode: true,
          sentiment: true,
          likesCount: true,
          publishedAt: true,
          collectedAt: true,
          createdAt: true,
          post: {
            select: {
              id: true,
              title: true,
              url: true,
              country: true,
              city: true,
              region: true,
              dataSource: {
                select: {
                  id: true,
                  key: true,
                  displayName: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.socialComment.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Returns aggregate comment totals for the selected filters. */
  async getCommentsSummary(query: GetCommentsQueryDto) {
    const where = this.buildWhere(query);
    const [total, withSentiment, languages, sources] = await Promise.all([
      this.prisma.socialComment.count({ where }),
      this.prisma.socialComment.count({
        where: { ...where, sentiment: { not: null } },
      }),
      this.prisma.socialComment.groupBy({
        by: ['languageCode'],
        where,
        _count: { _all: true },
      }),
      this.prisma.socialPost.groupBy({
        by: ['dataSourceId'],
        where: {
          comments: { some: where },
        },
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      withSentiment,
      withoutSentiment: total - withSentiment,
      languagesCount: languages.length,
      dataSourcesCount: sources.length,
    };
  }

  /** Returns chart-ready breakdowns by language, sentiment and source. */
  async getCommentsCharts(query: GetCommentsQueryDto) {
    const where = this.buildWhere(query);

    const [byLanguage, bySentiment, postsBySource] = await Promise.all([
      this.prisma.socialComment.groupBy({
        by: ['languageCode'],
        where,
        _count: { _all: true },
        orderBy: { _count: { languageCode: 'desc' } },
      }),
      this.prisma.socialComment.groupBy({
        by: ['sentiment'],
        where,
        _count: { _all: true },
        orderBy: { _count: { sentiment: 'desc' } },
      }),
      this.prisma.socialPost.groupBy({
        by: ['dataSourceId'],
        where: { comments: { some: where } },
        _count: { _all: true },
        orderBy: { _count: { dataSourceId: 'desc' } },
      }),
    ]);

    const sourceIds = postsBySource.map((item) => item.dataSourceId);
    const sources = await this.prisma.dataSource.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, key: true, displayName: true },
    });
    const sourceMap = new Map(sources.map((source) => [source.id, source]));

    return {
      byLanguage: byLanguage.map((item) => ({
        label: item.languageCode ?? 'Unknown',
        languageCode: item.languageCode,
        count: item._count._all,
      })),
      bySentiment: bySentiment.map((item) => ({
        label: item.sentiment ?? 'Unknown',
        sentiment: item.sentiment,
        count: item._count._all,
      })),
      byDataSource: postsBySource.map((item) => {
        const source = sourceMap.get(item.dataSourceId);
        return {
          label: source?.displayName ?? 'Unknown source',
          dataSourceId: item.dataSourceId,
          dataSourceKey: source?.key ?? null,
          count: item._count._all,
        };
      }),
    };
  }
}
