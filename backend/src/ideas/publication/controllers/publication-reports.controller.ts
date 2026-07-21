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
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';
import { CreatePublicationReportDto } from '../dto/create-publication-report.dto';
import { GetPublicationReportsQueryDto } from '../dto/get-publication-reports-query.dto';
import { ReviewPublicationReportDto } from '../dto/review-publication-report.dto';
import { PublicationReportService } from '../services/publication-report.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserPublicationReportsController {
  constructor(private readonly service: PublicationReportService) {}

  @Post('publications/:publicationId/reports')
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' }))
    publicationId: string,
    @Body() dto: CreatePublicationReportDto,
  ) {
    return this.service.report(user.id, publicationId, dto);
  }

  @Get('publication-reports/mine')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetPublicationReportsQueryDto,
  ) {
    return this.service.findMine(user.id, query);
  }
}

@Controller('admin/publication-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPublicationReportsController {
  constructor(private readonly service: PublicationReportService) {}

  @Get()
  findAll(@Query() query: GetPublicationReportsQueryDto) {
    return this.service.findAll(query);
  }

  @Patch(':reportId/review')
  review(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('reportId', new ParseUUIDPipe({ version: '4' })) reportId: string,
    @Body() dto: ReviewPublicationReportDto,
  ) {
    return this.service.review(admin.id, reportId, dto);
  }
}
