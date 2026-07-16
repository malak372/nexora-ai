import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { DataSourcesService } from '../data-sources.service';

import { CreateDataSourceDto } from '../dto/create-data-source.dto';
import { GetDataSourcesQueryDto } from '../dto/get-data-sources-query.dto';
import { UpdateDataSourceStatusDto } from '../dto/update-data-source-status.dto';
import { UpdateDataSourceDto } from '../dto/update-data-source.dto';

/**
 * Minimal authenticated administrator representation.
 */
type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Administrative endpoints for managing data sources.
 *
 * Administrators can:
 * - Create source metadata.
 * - List all sources.
 * - View source details.
 * - Update source metadata.
 * - Activate and deactivate sources.
 * - Synchronize implementation state with CollectorsFactory.
 *
 * Permanent deletion is intentionally not exposed because
 * historical jobs and collected posts may reference the source.
 *
 * Base route:
 * /admin/data-sources
 *
 * @author Malak
 */
@Controller('admin/data-sources')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDataSourcesController {
  constructor(private readonly dataSourcesService: DataSourcesService) {}

  /**
   * Creates a data-source record.
   */
  @Post()
  create(
    @Body()
    dto: CreateDataSourceDto,

    @CurrentUser()
    admin: AuthenticatedAdmin,
  ) {
    return this.dataSourcesService.create(dto, admin.id);
  }

  /**
   * Returns a paginated administrative source list.
   */
  @Get()
  findAll(
    @Query()
    query: GetDataSourcesQueryDto,
  ) {
    return this.dataSourcesService.findAllForAdmin(query);
  }

  /**
   * Synchronizes DataSource.isImplemented with
   * the deployed collector registry.
   *
   * Sources without operational collectors are also
   * deactivated automatically.
   */
  @Post('synchronize')
  synchronize() {
    return this.dataSourcesService.synchronizeImplementationStates();
  }

  /**
   * Returns one source with usage totals.
   */
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.dataSourcesService.findOneForAdmin(id);
  }

  /**
   * Updates editable source metadata.
   */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe)
    id: string,

    @Body()
    dto: UpdateDataSourceDto,

    @CurrentUser()
    admin: AuthenticatedAdmin,
  ) {
    return this.dataSourcesService.update(id, dto, admin.id);
  }

  /**
   * Activates or deactivates a source.
   */
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe)
    id: string,

    @Body()
    dto: UpdateDataSourceStatusDto,

    @CurrentUser()
    admin: AuthenticatedAdmin,
  ) {
    return this.dataSourcesService.updateStatus(id, dto, admin.id);
  }
}
