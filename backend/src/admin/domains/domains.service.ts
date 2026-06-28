import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminAction, AdminTargetType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GetDomainsQueryDto } from './dto/get-domains-query.dto';
import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
  buildExactFilter,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for Admin domain management operations.
 *
 * This service allows administrators to retrieve, search,
 * filter, sort, create, update, and deactivate domains.
 *
 * @author Malak
 */
@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }

  /**
   * Retrieves domains with optional searching, date filtering,
   * sorting, and pagination.
   *
   * @param query Query parameters used for pagination,
   * searching, filtering, and sorting domains.
   * @returns Paginated domains list with metadata.
   */
  async getDomains(query: GetDomainsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const isActive =
      query.isActive !== undefined
        ? query.isActive === 'true'
        : undefined;

    const where: Prisma.DomainWhereInput = {
      ...buildDateFilter(query),
      ...buildSearchFilter(['name'], query.search),
      ...buildExactFilter('isActive', isActive),
    };

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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Creates a new domain and records the action in audit logs.
   *
   * @param body - DTO containing the domain information.
   * @param adminId - ID of the authenticated admin creating the domain.
   * @returns A success message and the newly created domain.
   *
   * @throws ConflictException if a domain with the same name already exists.
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
   *
   * @param id - ID of the domain to update.
   * @param body - DTO containing the updated domain information.
   * @param adminId - ID of the authenticated admin updating the domain.
   * @returns A success message and the updated domain.
   *
   * @throws NotFoundException if the domain does not exist.
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
    };
  }

  /**
   * Deactivates a domain and records the action in audit logs.
   *
   * This operation performs a soft deactivation by setting
   * the domain's active status to false.
   *
   * @param id - ID of the domain to deactivate.
   * @param adminId - ID of the authenticated admin deactivating the domain.
   * @returns A success message and the updated domain.
   *
   * @throws NotFoundException if the domain does not exist.
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
    };
  }
}