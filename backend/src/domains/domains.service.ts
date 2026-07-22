import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  LanguageCode,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { calculateTotalPages } from '../utilities/analytics/analytics.helper';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../utilities/base-query/builder';

import { CreateDomainDto } from './dto/create-domain.dto';
import { GetDomainsQueryDto } from './dto/get-domains-query.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';

/**
 * Represents a normalized domain keyword ready for persistence.
 *
 * Keywords are normalized to lowercase and assigned a language.
 */
type NormalizedDomainKeyword = {
  /**
   * Normalized lowercase keyword.
   */
  keyword: string;

  /**
   * Language associated with the keyword.
   */
  language: LanguageCode;
};

/**
 * Service responsible for domain discovery and administration.
 *
 * User-facing responsibilities:
 * - Return active domains available for idea generation.
 *
 * Administrative responsibilities:
 * - List domains using pagination, filtering, searching, and sorting.
 * - Return domain summary statistics.
 * - Return chart-ready domain analytics.
 * - Create new domains and keywords.
 * - Update existing domains and keywords.
 * - Deactivate existing domains.
 * - Record administrative operations in the audit log.
 *
 * This service does not enforce authorization directly.
 * Authorization is handled by the corresponding controllers and guards.
 *
 * @author Malak
 * @author Eman
 */
@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditService,
  ) {}

  /**
   * Returns active domains available for selection by users.
   *
   * This method is intended for the user-facing endpoint:
   *
   * GET /domains/available
   *
   * It deliberately exposes only the minimum information needed
   * by the frontend before data collection or idea generation.
   *
   * Inactive domains, internal keywords, administrative counts,
   * and analytics are not returned.
   *
   * @returns Active domains ordered alphabetically by name.
   */
  async getAvailableDomains() {
    const domains = await this.prisma.domain.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
      },
    });

    return {
      data: domains,
      total: domains.length,
    };
  }

  /**
   * Builds the Prisma filtering conditions used by administrative
   * domain listing, summary, and chart operations.
   *
   * Supported conditions include:
   * - Creation-date range.
   * - Domain-name search.
   * - Active-status filtering.
   *
   * The DTO represents `isActive` as a query-string value,
   * so it is converted into a boolean before being sent to Prisma.
   *
   * @param query - Administrative domain query parameters.
   * @returns Prisma-compatible domain filtering conditions.
   */
  private buildDomainsWhere(
    query: GetDomainsQueryDto,
  ): Prisma.DomainWhereInput {
    const isActive =
      query.isActive !== undefined ? query.isActive === 'true' : undefined;

    return {
      ...buildDateFilter(query),
      ...buildSearchFilter(['name'], query.search),
      ...buildExactFilter('isActive', isActive),
    };
  }

  /**
   * Adds or replaces the lower creation-date boundary of a domain filter.
   *
   * Existing `createdAt` filters are preserved, allowing this helper
   * to add a `gte` condition without discarding an existing `lte`
   * or other compatible date condition.
   *
   * @param where - Existing domain filter.
   * @param gte - Earliest accepted creation date.
   * @returns A new domain filter containing the lower date boundary.
   */
  private mergeCreatedAtGte(
    where: Prisma.DomainWhereInput,
    gte: Date,
  ): Prisma.DomainWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' && where.createdAt !== null
        ? where.createdAt
        : {};

    return {
      ...where,
      createdAt: {
        ...existingCreatedAt,
        gte,
      },
    };
  }

  /**
   * Returns the paginated administrative domain list.
   *
   * This method includes:
   * - Domain identifiers and names.
   * - Activation status.
   * - Creation and modification timestamps.
   * - Domain keywords.
   * - Number of generated ideas associated with each domain.
   *
   * Intended endpoint:
   *
   * GET /admin/domains
   *
   * @param query - Pagination, search, filter, and sorting parameters.
   * @returns Paginated domain data and metadata.
   */
  async getDomains(query: GetDomainsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildDomainsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['name', 'isActive', 'updatedAt', 'createdAt'] as const,
      'createdAt',
    );

    const [domains, total] = await Promise.all([
      this.prisma.domain.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          domainKeywords: {
            orderBy: [
              {
                language: 'asc',
              },
              {
                keyword: 'asc',
              },
            ],
            select: {
              id: true,
              keyword: true,
              language: true,
            },
          },
          _count: {
            select: {
              ideas: true,
            },
          },
        },
      }),
      this.prisma.domain.count({
        where,
      }),
    ]);

    return {
      data: domains,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Returns administrative summary statistics for domains.
   *
   * Statistics include:
   * - Total domains.
   * - Active domains.
   * - Inactive domains.
   * - Domains created today.
   * - Domains created during the current month.
   * - Domains associated with at least one generated idea.
   *
   * All supplied query filters are applied to the summary.
   *
   * Intended endpoint:
   *
   * GET /admin/domains/summary
   *
   * @param query - Search, status, and date filters.
   * @returns Domain summary statistics.
   */
  async getDomainsSummary(query: GetDomainsQueryDto) {
    const where = this.buildDomainsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

    const [
      totalDomains,
      activeDomains,
      inactiveDomains,
      todayDomains,
      thisMonthDomains,
      domainsWithIdeas,
    ] = await Promise.all([
      this.prisma.domain.count({
        where,
      }),

      this.prisma.domain.count({
        where: {
          ...where,
          isActive: true,
        },
      }),

      this.prisma.domain.count({
        where: {
          ...where,
          isActive: false,
        },
      }),

      this.prisma.domain.count({
        where: todayWhere,
      }),

      this.prisma.domain.count({
        where: monthWhere,
      }),

      this.prisma.domain.count({
        where: {
          ...where,
          ideas: {
            some: {},
          },
        },
      }),
    ]);

    return {
      totalDomains,
      activeDomains,
      inactiveDomains,
      todayDomains,
      thisMonthDomains,
      domainsWithIdeas,
    };
  }

  /**
   * Returns chart-ready administrative domain analytics.
   *
   * The response includes:
   * - Domain distribution by activation status.
   * - Up to ten domains with the highest number of generated ideas.
   *
   * All supplied query filters are applied before aggregation.
   *
   * Intended endpoint:
   *
   * GET /admin/domains/charts
   *
   * @param query - Search, status, and date filters.
   * @returns Chart-ready domain analytics.
   */
  async getDomainsCharts(query: GetDomainsQueryDto) {
    const where = this.buildDomainsWhere(query);

    const [domainsStatusGroup, domainsWithIdeaCounts] = await Promise.all([
      this.prisma.domain.groupBy({
        by: ['isActive'],
        where,
        _count: {
          isActive: true,
        },
        orderBy: {
          _count: {
            isActive: 'desc',
          },
        },
      }),

      this.prisma.domain.findMany({
        where,
        orderBy: {
          ideas: {
            _count: 'desc',
          },
        },
        take: 10,
        select: {
          id: true,
          name: true,
          isActive: true,
          _count: {
            select: {
              ideas: true,
            },
          },
        },
      }),
    ]);

    return {
      domainsByStatus: domainsStatusGroup.map((item) => ({
        label: item.isActive ? 'ACTIVE' : 'INACTIVE',
        isActive: item.isActive,
        count: item._count.isActive,
      })),

      domainsByIdeas: domainsWithIdeaCounts.map((domain) => ({
        label: domain.name,
        domainId: domain.id,
        domainName: domain.name,
        isActive: domain.isActive,
        count: domain._count.ideas,
      })),
    };
  }

  /**
   * Creates a new domain and its associated keywords.
   *
   * Domain names must be unique. Keywords are normalized before
   * persistence by:
   * - Removing surrounding whitespace.
   * - Converting text to lowercase.
   * - Applying `ANY` when no language is supplied.
   * - Removing duplicate keyword-language combinations.
   *
   * A successful operation is recorded in the audit log.
   *
   * Intended endpoint:
   *
   * POST /admin/domains
   *
   * @param body - Domain creation data.
   * @param adminId - Identifier of the administrator performing the action.
   * @returns The newly created domain and a success message.
   *
   * @throws ConflictException when a domain with the same name exists.
   */
  async createDomain(body: CreateDomainDto, adminId: string) {
    const existingDomain = await this.prisma.domain.findUnique({
      where: {
        name: body.name,
      },
      select: {
        id: true,
      },
    });

    if (existingDomain) {
      throw new ConflictException('Domain already exists');
    }

    const keywords = this.normalizeKeywords(body.keywords);

    const domain = await this.prisma.domain.create({
      data: {
        name: body.name,
        isActive: body.isActive ?? true,
        domainKeywords: {
          create: keywords.map((item) => ({
            keyword: item.keyword,
            language: item.language,
          })),
        },
      },
      include: {
        domainKeywords: {
          orderBy: [
            {
              language: 'asc',
            },
            {
              keyword: 'asc',
            },
          ],
        },
      },
    });

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_CREATE_DOMAIN,
      targetType: AuditTargetType.DOMAIN,
      targetId: domain.id,
      newValue: {
        id: domain.id,
        name: domain.name,
        isActive: domain.isActive,
        keywords,
      },
    });

    return {
      message: 'Domain created successfully',
      domain,
    };
  }

  /**
   * Updates an existing domain.
   *
   * Supported changes:
   * - Domain name.
   * - Activation status.
   * - Domain keywords.
   *
   * When `keywords` is provided, all existing keywords are replaced
   * by the normalized keyword collection from the request.
   *
   * When `keywords` is omitted, existing keywords remain unchanged.
   *
   * A successful operation is recorded in the audit log with the
   * previous and updated domain values.
   *
   * Intended endpoint:
   *
   * PATCH /admin/domains/:id
   *
   * @param id - Identifier of the domain to update.
   * @param body - Fields to update.
   * @param adminId - Identifier of the administrator performing the action.
   * @returns Updated domain data and a success message.
   *
   * @throws NotFoundException when the domain does not exist.
   * @throws ConflictException when the requested name is already used.
   */
  async updateDomain(id: string, body: UpdateDomainDto, adminId: string) {
    const domain = await this.prisma.domain.findUnique({
      where: {
        id,
      },
      include: {
        domainKeywords: true,
      },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    if (body.name !== undefined && body.name !== domain.name) {
      const duplicateDomain = await this.prisma.domain.findUnique({
        where: {
          name: body.name,
        },
        select: {
          id: true,
        },
      });

      if (duplicateDomain) {
        throw new ConflictException('Domain name already exists');
      }
    }

    const keywordsProvided = body.keywords !== undefined;
    const keywords = this.normalizeKeywords(body.keywords);

    const updatedDomain = await this.prisma.domain.update({
      where: {
        id,
      },
      data: {
        ...(body.name !== undefined && {
          name: body.name,
        }),
        ...(body.isActive !== undefined && {
          isActive: body.isActive,
        }),
        ...(keywordsProvided && {
          domainKeywords: {
            deleteMany: {},
            create: keywords.map((item) => ({
              keyword: item.keyword,
              language: item.language,
            })),
          },
        }),
      },
      include: {
        domainKeywords: {
          orderBy: [
            {
              language: 'asc',
            },
            {
              keyword: 'asc',
            },
          ],
        },
      },
    });

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_UPDATE_DOMAIN,
      targetType: AuditTargetType.DOMAIN,
      targetId: id,
      oldValue: {
        name: domain.name,
        isActive: domain.isActive,
        keywords: domain.domainKeywords.map((item) => ({
          keyword: item.keyword,
          language: item.language,
        })),
      },
      newValue: {
        name: updatedDomain.name,
        isActive: updatedDomain.isActive,
        keywords: updatedDomain.domainKeywords.map((item) => ({
          keyword: item.keyword,
          language: item.language,
        })),
      },
    });

    return {
      message: 'Domain updated successfully',
      domain: updatedDomain,
      updated: true,
    };
  }

  /**
   * Deactivates an existing domain.
   *
   * This is a soft administrative deactivation rather than a physical
   * deletion. Existing ideas, collection jobs, and related records
   * therefore remain valid.
   *
   * Calling this method for an already inactive domain is idempotent
   * and does not create another update.
   *
   * A successful state change is recorded in the audit log.
   *
   * Intended endpoint:
   *
   * DELETE /admin/domains/:id
   *
   * @param id - Identifier of the domain to deactivate.
   * @param adminId - Identifier of the administrator performing the action.
   * @returns Domain data, update status, and a result message.
   *
   * @throws NotFoundException when the domain does not exist.
   */
  async deactivateDomain(id: string, adminId: string) {
    const domain = await this.prisma.domain.findUnique({
      where: {
        id,
      },
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    if (!domain.isActive) {
      return {
        message: 'Domain is already inactive',
        domain,
        updated: false,
      };
    }

    const updatedDomain = await this.prisma.domain.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
    });

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_DEACTIVATE_DOMAIN,
      targetType: AuditTargetType.DOMAIN,
      targetId: id,
      oldValue: {
        name: domain.name,
        isActive: domain.isActive,
      },
      newValue: {
        name: updatedDomain.name,
        isActive: updatedDomain.isActive,
      },
    });

    return {
      message: 'Domain deactivated successfully',
      domain: updatedDomain,
      updated: true,
    };
  }

  /**
   * Normalizes domain keywords before persistence.
   *
   * Normalization rules:
   * - Trim surrounding whitespace.
   * - Convert keyword text to lowercase.
   * - Ignore empty values.
   * - Use `LanguageCode.ANY` when no language is supplied.
   * - Remove duplicates using keyword and language together.
   *
   * The same keyword may exist more than once when each occurrence
   * belongs to a different language.
   *
   * @param keywords - Optional keyword collection received from a DTO.
   * @returns Unique normalized keyword-language combinations.
   */
  private normalizeKeywords(
    keywords?: {
      keyword: string;
      language?: LanguageCode;
    }[],
  ): NormalizedDomainKeyword[] {
    const keywordMap = new Map<string, NormalizedDomainKeyword>();

    for (const item of keywords ?? []) {
      const keyword = item.keyword.trim().toLowerCase();
      const language = item.language ?? LanguageCode.ANY;

      if (!keyword) {
        continue;
      }

      keywordMap.set(`${keyword}:${language}`, {
        keyword,
        language,
      });
    }

    return Array.from(keywordMap.values());
  }
}
