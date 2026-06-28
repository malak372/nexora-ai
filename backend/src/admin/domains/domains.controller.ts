import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DomainsService } from './domains.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { GetDomainsQueryDto } from './dto/get-domains-query.dto';

/**
 * Controller responsible for application domain management.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve all available domains.
 * - Create new domains.
 * - Update existing domains.
 * - Deactivate domains.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/domains
 *
 * @author Malak
 */
@Controller('admin/domains')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) { }

  /**
   * Retrieves all configured domains.
   *
   * Endpoint:
   * GET /admin/domains
   *
   * @returns A list of application domains.
   */
  @Get()
  getDomains(@Query() query: GetDomainsQueryDto) {
    return this.domainsService.getDomains(query);
  }

  /**
   * Creates a new domain.
   *
   * Endpoint:
   * POST /admin/domains
   *
   * @param body - DTO containing the new domain information.
   * @param currentUser - The authenticated admin creating the domain.
   * @returns A success message and the newly created domain.
   */
  @Post()
  createDomain(
    @Body() body: CreateDomainDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.domainsService.createDomain(body, currentUser.id);
  }

  /**
   * Updates an existing domain.
   *
   * Endpoint:
   * PATCH /admin/domains/:id
   *
   * @param id - The unique identifier of the domain.
   * @param body - DTO containing the updated domain information.
   * @param currentUser - The authenticated admin updating the domain.
   * @returns A success message and the updated domain.
   */
  @Patch(':id')
  updateDomain(
    @Param('id') id: string,
    @Body() body: UpdateDomainDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.domainsService.updateDomain(id, body, currentUser.id);
  }

  /**
   * Deactivates a domain.
   *
   * Endpoint:
   * DELETE /admin/domains/:id
   *
   * @param id - The unique identifier of the domain.
   * @param currentUser - The authenticated admin deactivating the domain.
   * @returns A success message and the updated domain information.
   */
  @Delete(':id')
  deleteDomain(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.domainsService.deactivateDomain(id, currentUser.id);
  }
}