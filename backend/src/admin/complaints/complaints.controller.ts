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

import { ComplaintsService } from './complaints.service';
import { GetComplaintsQueryDto } from './dto/get-complaints-query.dto';
import { UpdateComplaintDto } from './dto/update-complaint.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Authenticated admin payload.
 */
type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for admin complaint management.
 *
 * Provides admin-only endpoints for:
 * - Viewing submitted complaints.
 * - Filtering, searching, sorting, and paginating complaints.
 * - Viewing complaint summary reports.
 * - Viewing chart-ready complaint analytics.
 * - Updating complaint status, priority, and admin reply.
 *
 * Base route:
 * /admin/complaints
 *
 * @author Malak
 */
@Controller('admin/complaints')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  /**
   * Retrieves submitted complaints.
   *
   * Endpoint:
   * GET /admin/complaints
   */
  @Get()
  getComplaints(@Query() query: GetComplaintsQueryDto) {
    return this.complaintsService.getComplaints(query);
  }

  /**
   * Retrieves complaint summary statistics.
   *
   * Endpoint:
   * GET /admin/complaints/summary
   *
   * Supports the same filters used by the complaints list.
   */
  @Get('summary')
  getComplaintsSummary(@Query() query: GetComplaintsQueryDto) {
    return this.complaintsService.getComplaintsSummary(query);
  }

  /**
   * Retrieves chart-ready complaint analytics.
   *
   * Endpoint:
   * GET /admin/complaints/charts
   *
   * Supports the same filters used by the complaints list.
   */
  @Get('charts')
  getComplaintsCharts(@Query() query: GetComplaintsQueryDto) {
    return this.complaintsService.getComplaintsCharts(query);
  }
  /**
   * Exports filtered complaints as CSV.
   *
   * Endpoint:
   * GET /admin/complaints/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="complaints.csv"')
  exportComplaintsCsv(@Query() query: GetComplaintsQueryDto) {
    return this.complaintsService.exportComplaintsCsv(query);
  }
  /**
   * Updates an existing complaint.
   *
   * Endpoint:
   * PATCH /admin/complaints/:id
   */
  @Patch(':id')
  updateComplaint(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateComplaintDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.complaintsService.updateComplaint(id, body, currentUser.id);
  }
}
