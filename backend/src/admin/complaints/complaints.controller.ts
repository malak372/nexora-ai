import {
  Body,
  Controller,
  Get,
  Param,
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
 * Controller responsible for complaint management.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve submitted complaints.
 * - Filter complaints by status and priority.
 * - Review and update complaint details.
 *
 * Complaint management enables administrators to monitor
 * user-reported issues, assign priorities, respond to
 * complaints, and mark them as resolved when appropriate.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
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
  /**
   * Creates an instance of ComplaintsController.
   *
   * @param complaintsService - Service responsible for complaint management.
   */
  constructor(
    private readonly complaintsService: ComplaintsService,
  ) { }

  /**
   * Retrieves submitted complaints with optional filtering.
   *
   * Endpoint:
   * GET /admin/complaints
   *
   * Supported query parameters:
   * - status: Filter by complaint status.
   * - priority: Filter by complaint priority.
   *
   * Example:
   * GET /admin/complaints?status=OPEN&priority=HIGH
   *
   * @param query - Query parameters used for filtering complaints.
   * @returns A list of complaints with related user and idea information.
   */
  @Get()
  getComplaints(@Query() query: GetComplaintsQueryDto) {
    return this.complaintsService.getComplaints(query);
  }

  /**
   * Updates an existing complaint.
   *
   * Endpoint:
   * PATCH /admin/complaints/:id
   *
   * The administrator can update:
   * - Complaint status.
   * - Complaint priority.
   * - Administrative reply.
   *
   * Request body example:
   * {
   *   "status": "RESOLVED",
   *   "priority": "HIGH",
   *   "adminReply": "The issue has been reviewed and resolved."
   * }
   *
   * @param id - The unique identifier of the complaint.
   * @param body - DTO containing the updated complaint information.
   * @returns A success message and the updated complaint details.
   */
  @Patch(':id')
  updateComplaint(
    @Param('id') id: string,
    @Body() body: UpdateComplaintDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.complaintsService.updateComplaint(
      id,
      body,
      currentUser.id,
    );
  }
}