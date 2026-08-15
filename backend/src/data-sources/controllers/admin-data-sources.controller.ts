import {
  Body,
  Controller,
  Delete,
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

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

@Controller('admin/data-sources')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDataSourcesController {
  constructor(
    private readonly dataSourcesService: DataSourcesService,
  ) {}

  @Post()
  create(
    @Body()
    dto: CreateDataSourceDto,

    @CurrentUser()
    admin: AuthenticatedAdmin,
  ) {
    return this.dataSourcesService.create(dto, admin.id);
  }

  @Get('summary')
  getSummary() {
    return this.dataSourcesService.getAdminSummary();
  }

  @Get()
  findAll(
    @Query()
    query: GetDataSourcesQueryDto,
  ) {
    return this.dataSourcesService.findAllForAdmin(query);
  }

  @Post('synchronize')
  synchronize() {
    return this.dataSourcesService.synchronizeImplementationStates();
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.dataSourcesService.findOneForAdmin(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe)
    id: string,

    @Body()
    dto: UpdateDataSourceDto,

    @CurrentUser()
    admin: AuthenticatedAdmin,
  ) {
    return this.dataSourcesService.update(
      id,
      dto,
      admin.id,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe)
    id: string,

    @Body()
    dto: UpdateDataSourceStatusDto,

    @CurrentUser()
    admin: AuthenticatedAdmin,
  ) {
    return this.dataSourcesService.updateStatus(
      id,
      dto,
      admin.id,
    );
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe)
    id: string,

    @CurrentUser()
    admin: AuthenticatedAdmin,
  ) {
    return this.dataSourcesService.remove(
      id,
      admin.id,
    );
  }
}