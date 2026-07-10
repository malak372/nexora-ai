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

import { PrismaService } from '../../prisma/prisma.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { GetDomainsQueryDto } from './dto/get-domains-query.dto';
import { AuditService } from '../../audit-logs/audit-logs.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

type NormalizedDomainKeyword = {
  keyword: string;
  language: LanguageCode;
};

/**
 * Service responsible for Admin domain management operations.
 *
 * @author Malak
 */
@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditService,
  ) {}

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
      this.prisma.domain.count({ where }),
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
      this.prisma.domain.count({ where }),
      this.prisma.domain.count({ where: { ...where, isActive: true } }),
      this.prisma.domain.count({ where: { ...where, isActive: false } }),
      this.prisma.domain.count({ where: todayWhere }),
      this.prisma.domain.count({ where: monthWhere }),
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

  async createDomain(body: CreateDomainDto, adminId: string) {
    const existingDomain = await this.prisma.domain.findUnique({
      where: {
        name: body.name,
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
        domainKeywords: true,
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
        ...(body.name !== undefined && { name: body.name }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
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
        domainKeywords: true,
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

  private normalizeKeywords(
    keywords?: { keyword: string; language?: LanguageCode }[],
  ): NormalizedDomainKeyword[] {
    const map = new Map<string, NormalizedDomainKeyword>();

    for (const item of keywords ?? []) {
      const keyword = item.keyword.trim().toLowerCase();
      const language = item.language ?? LanguageCode.ANY;

      if (!keyword) {
        continue;
      }

      map.set(`${keyword}-${language}`, {
        keyword,
        language,
      });
    }

    return Array.from(map.values());
  }
}
