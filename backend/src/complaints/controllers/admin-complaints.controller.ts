import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { GetAdminComplaintsQueryDto } from '../dto/get-admin-complaints-query.dto';
import { UpdateComplaintDto } from '../dto/update-complaint.dto';

import { AdminComplaintsService } from '../services/admin-complaints.service';

/**
 * Handles administrator complaint-management endpoints.
 *
 * Base route:
 * /admin/complaints
 *
 * @author Malak
 */
@Controller('admin/complaints')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
)
@Roles(UserRole.ADMIN)
export class AdminComplaintsController {
  constructor(
    private readonly adminComplaintsService:
      AdminComplaintsService,
  ) {}

  /**
   * Returns complaints.
   *
   * GET /admin/complaints
   */
  @Get()
  getComplaints(
    @Query() query: GetAdminComplaintsQueryDto,
  ) {
    return this.adminComplaintsService.getComplaints(
      query,
    );
  }

  /**
   * Returns complaint summary statistics.
   *
   * GET /admin/complaints/summary
   */
  @Get('summary')
  getComplaintsSummary(
    @Query() query: GetAdminComplaintsQueryDto,
  ) {
    return this.adminComplaintsService
      .getComplaintsSummary(query);
  }

  /**
   * Returns complaint chart data.
   *
   * GET /admin/complaints/charts
   */
  @Get('charts')
  getComplaintsCharts(
    @Query() query: GetAdminComplaintsQueryDto,
  ) {
    return this.adminComplaintsService
      .getComplaintsCharts(query);
  }

  /**
   * Exports complaints as CSV.
   *
   * GET /admin/complaints/export/csv
   */
  @Get('export/csv')
  @Header(
    'Content-Type',
    'text/csv',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="complaints.csv"',
  )
  exportComplaintsCsv(
    @Query() query: GetAdminComplaintsQueryDto,
  ) {
    return this.adminComplaintsService
      .exportComplaintsCsv(query);
  }

  /**
   * Updates one complaint.
   *
   * PATCH /admin/complaints/:id
   */
  @Patch(':id')
  updateComplaint(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    complaintId: string,

    @Body() body: UpdateComplaintDto,

    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminComplaintsService.updateComplaint(
      complaintId,
      body,
      admin.id,
    );
  }
}