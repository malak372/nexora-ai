import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminAction, AdminTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { GetDomainsQueryDto } from './dto/get-domains-query.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin domain management operations.
 *
 * Provides:
 * - Paginated domain listing.
 * - Search by domain name.
 * - Filtering by active status and date range.
 * - Safe sorting.
 * - Summary reports.
 * - Chart-ready analytics.
 * - Domain creation.
 * - Domain update.
 * - Soft deactivation.
 * - Audit logging.
 *
 * @author Malak
 */
@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Builds the shared Prisma where filter for domain list,
   * summary, and chart queries.
   */
  private buildDomainsWhere(
    query: GetDomainsQueryDto,
  ): Prisma.DomainWhereInput {
    const isActive =
      query.isActive !== undefined
        ? query.isActive === 'true'
        : undefined;

    return {
      ...buildDateFilter(query),
      ...buildSearchFilter(['name'], query.search),
      ...buildExactFilter('isActive', isActive),
    };
  }

  /**
   * Adds a minimum createdAt date while preserving existing date filters.
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
   * Retrieves domains with searching, filtering, sorting, and pagination.
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

  /**
   * Retrieves domain summary statistics.
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
      this.prisma.domain.count({ where }),

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

  /**
   * Retrieves chart-ready domain analytics.
   */
  async getDomainsCharts(query: GetDomainsQueryDto) {
    const where = this.buildDomainsWhere(query);

    const [domainsStatusGroup, domainsWithIdeaCounts] =
      await Promise.all([
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
   * Creates a new domain and records the action in audit logs.
   */
  async createDomain(body: CreateDomainDto, adminId: string) {
    const existingDomain = await this.prisma.domain.findUnique({
      where: {
        name: body.name,
      },
    });

    if (existingDomain) {
      throw new ConflictException('Domain already exists');
    }

    const domain = await this.prisma.domain.create({
      data: {
        name: body.name,
        isActive: body.isActive ?? true,
      },
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_CREATE_DOMAIN,
      targetType: AdminTargetType.DOMAIN,
      targetId: domain.id,
      newValue: {
        id: domain.id,
        name: domain.name,
        isActive: domain.isActive,
      },
    });

    return {
      message: 'Domain created successfully',
      domain,
    };
  }

  /**
   * Updates an existing domain and records the change in audit logs.
   */
  async updateDomain(
    id: string,
    body: UpdateDomainDto,
    adminId: string,
  ) {
    const domain = await this.prisma.domain.findUnique({
      where: {
        id,
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

    const hasChanges =
      (body.name !== undefined && body.name !== domain.name) ||
      (body.isActive !== undefined &&
        body.isActive !== domain.isActive);

    if (!hasChanges) {
      return {
        message: 'No changes detected',
        domain,
        updated: false,
      };
    }

    const updatedDomain = await this.prisma.domain.update({
      where: {
        id,
      },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_UPDATE_DOMAIN,
      targetType: AdminTargetType.DOMAIN,
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
      message: 'Domain updated successfully',
      domain: updatedDomain,
      updated: true,
    };
  }

  /**
   * Deactivates a domain using soft deactivation.
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
      adminId,
      action: AdminAction.ADMIN_DEACTIVATE_DOMAIN,
      targetType: AdminTargetType.DOMAIN,
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
}