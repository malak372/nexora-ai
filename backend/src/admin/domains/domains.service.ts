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

/**
 * Service responsible for Admin domain management operations.
 *
 * This service allows administrators to:
 * - Retrieve all domains.
 * - Register new domains.
 * - Update existing domain information.
 * - Deactivate domains.
 * - Record audit logs for domain changes.
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
   * Builds the Prisma sorting configuration for domain queries.
   *
   * Maps the requested sorting field and direction
   * from the query parameters into a Prisma-compatible
   * orderBy object.
   *
   * If no sorting field is provided, domains are
   * sorted by creation date in descending order.
   *
   * @param query - Query parameters containing the optional
   * sorting field and sorting direction.
   * @returns Prisma orderBy object used when retrieving domains.
   *
   * @author Malak
   */
  private buildDomainsOrderBy(query: GetDomainsQueryDto) {
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';

    switch (query.sortBy) {
      case 'name':
        return { name: sortOrder };

      case 'isActive':
        return { isActive: sortOrder };

      case 'updatedAt':
        return { updatedAt: sortOrder };

      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  /**
   * Retrieves domains with optional date filtering, sorting, and pagination.
   *
   * @param query - Query parameters used for pagination, filtering, and sorting domains.
   * @returns Paginated domains list with metadata.
   */
  async getDomains(query: GetDomainsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.DomainWhereInput = {};

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate && { gte: new Date(query.fromDate) }),
        ...(query.toDate && { lte: new Date(query.toDate) }),
      };
    }

    const [domains, total] = await Promise.all([
      this.prisma.domain.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.buildDomainsOrderBy(query),
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