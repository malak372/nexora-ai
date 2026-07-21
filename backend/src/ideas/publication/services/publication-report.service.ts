import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  IdeaPublicationStatus,
  ModerationReportStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../../audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePublicationReportDto } from '../dto/create-publication-report.dto';
import { GetPublicationReportsQueryDto } from '../dto/get-publication-reports-query.dto';
import { ReviewPublicationReportDto } from '../dto/review-publication-report.dto';

/** Handles user publication reports and admin review.
 *
 * @author malak
 *
 **/
@Injectable()
export class PublicationReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async report(
    userId: string,
    publicationId: string,
    dto: CreatePublicationReportDto,
  ) {
    const publication = await this.prisma.ideaPublication.findUnique({
      where: { id: publicationId },
      select: { id: true, publisherId: true, status: true, isHidden: true },
    });
    if (
      !publication ||
      publication.status !== IdeaPublicationStatus.PUBLISHED ||
      publication.isHidden
    ) {
      throw new NotFoundException('Published publication not found');
    }
    if (publication.publisherId === userId) {
      throw new ForbiddenException('You cannot report your own publication.');
    }

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.ideaPublicationReport.upsert({
        where: {
          publicationId_reporterId: { publicationId, reporterId: userId },
        },
        create: {
          publicationId,
          reporterId: userId,
          reason: dto.reason,
          details: dto.details?.trim(),
        },
        update: {
          reason: dto.reason,
          details: dto.details?.trim(),
          status: ModerationReportStatus.PENDING,
          reviewedById: null,
          reviewedAt: null,
          adminNote: null,
        },
      });
      await this.audit.createLog(
        {
          actorId: userId,
          action: AuditAction.USER_REPORT_PUBLICATION,
          targetType: AuditTargetType.IDEA_PUBLICATION_REPORT,
          targetId: report.id,
          newValue: {
            publicationId,
            reason: dto.reason,
            status: report.status,
          },
        },
        tx,
      );
      return { message: 'Publication report submitted successfully', report };
    });
  }

  async findMine(userId: string, query: GetPublicationReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.IdeaPublicationReportWhereInput = {
      reporterId: userId,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.ideaPublicationReport.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          publication: {
            select: {
              id: true,
              publicTitle: true,
              status: true,
              isHidden: true,
            },
          },
        },
      }),
      this.prisma.ideaPublicationReport.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAll(query: GetPublicationReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.IdeaPublicationReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.reporterId ? { reporterId: query.reporterId } : {}),
      ...(query.publicationId ? { publicationId: query.publicationId } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.ideaPublicationReport.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          reporter: { select: { id: true, fullName: true, email: true } },
          publication: {
            select: {
              id: true,
              publicTitle: true,
              publisherId: true,
              status: true,
              isHidden: true,
            },
          },
          reviewedBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.ideaPublicationReport.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async review(
    adminId: string,
    reportId: string,
    dto: ReviewPublicationReportDto,
  ) {
    if (dto.status === ModerationReportStatus.PENDING) {
      throw new BadRequestException(
        'An admin cannot return a report to PENDING.',
      );
    }
    const existing = await this.prisma.ideaPublicationReport.findUnique({
      where: { id: reportId },
    });
    if (!existing) throw new NotFoundException('Publication report not found');

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.ideaPublicationReport.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          adminNote: dto.adminNote?.trim(),
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });
      await this.audit.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_REVIEW_PUBLICATION_REPORT,
          targetType: AuditTargetType.IDEA_PUBLICATION_REPORT,
          targetId: reportId,
          oldValue: { status: existing.status },
          newValue: { status: report.status, adminNote: report.adminNote },
        },
        tx,
      );
      return { message: 'Publication report reviewed successfully', report };
    });
  }
}
