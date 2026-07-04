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

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { UserComplaintsService } from './complaints.service';
import { CreateUserComplaintDto } from './dto/create-user-complaint.dto';
import { GetUserComplaintsQueryDto } from './dto/get-user-complaints-query.dto';

/**
 * Controller responsible for authenticated user complaint operations.
 *
 * Base route:
 * /users/complaints
 *
 * This controller allows authenticated users to:
 * - Submit complaints.
 * - View their own complaints.
 * - View details of a specific complaint.
 *
 * Users can never access complaints submitted by
 * other users.
 *
 * Administrative complaint management is handled
 * by the dedicated admin complaints module.
 *
 * @author Eman
 */
@Controller('users/complaints')
@UseGuards(JwtAuthGuard)
export class UserComplaintsController {
    constructor(
        private readonly userComplaintsService: UserComplaintsService,
    ) { }

    /**
     * Creates a new complaint submitted by
     * the authenticated user.
     */
    @Post()
    createComplaint(
        @CurrentUser() user: { id: string },
        @Body() dto: CreateUserComplaintDto,
    ) {
        return this.userComplaintsService.createComplaint(user.id, dto);
    }

    /**
     * Retrieves all complaints submitted by
     * the authenticated user.
     *
     * Supports filtering, searching,
     * sorting and pagination.
     */
    @Get()
    getComplaints(
        @CurrentUser() user: { id: string },
        @Query() query: GetUserComplaintsQueryDto,
    ) {
        return this.userComplaintsService.getComplaints(user.id, query);
    }

    /**
     * Retrieves a single complaint owned by
     * the authenticated user.
     */
    @Get(':id')
    getComplaint(
        @CurrentUser() user: { id: string },
        @Param('id', ParseUUIDPipe) complaintId: string,
    ) {
        return this.userComplaintsService.getComplaintById(
            user.id,
            complaintId,
        );
    }
}