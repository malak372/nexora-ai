import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { CreateUserComplaintDto } from '../dto/create-user-complaint.dto';
import { GetUserComplaintsQueryDto } from '../dto/get-user-complaints-query.dto';

import { UserComplaintsService } from '../services/user-complaints.service';

/**
 * Handles authenticated-user complaint endpoints.
 *
 * Base route:
 * /users/complaints
 *
 * @author Eman
 */
@Controller('users/complaints')
@UseGuards(JwtAuthGuard)
export class UserComplaintsController {
  constructor(private readonly userComplaintsService: UserComplaintsService) {}

  /**
   * Creates a new complaint.
   *
   * POST /users/complaints
   */
  @Post()
  createComplaint(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserComplaintDto,
  ) {
    return this.userComplaintsService.createComplaint(user.id, dto);
  }

  /**
   * Returns the authenticated user's complaints.
   *
   * GET /users/complaints
   */
  @Get()
  getComplaints(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetUserComplaintsQueryDto,
  ) {
    return this.userComplaintsService.getComplaints(user.id, query);
  }

  /**
   * Returns one complaint owned by the authenticated user.
   *
   * GET /users/complaints/:id
   */
  @Get(':id')
  getComplaint(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    complaintId: string,
  ) {
    return this.userComplaintsService.getComplaintById(user.id, complaintId);
  }
}
