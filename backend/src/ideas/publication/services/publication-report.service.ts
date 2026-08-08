import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertType,
  AuditAction,
  AuditTargetType,
  IdeaPublicationStatus,
  ModerationReportStatus,
  Prisma,
} from '@prisma/client';
import { SystemAlertsService } from '../../../alerts/services/system-alerts.service';
import { AuditService } from '../../../audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePublicationReportDto } from '../dto/create-publication-report.dto';
import { GetPublicationReportsQueryDto } from '../dto/get-publication-reports-query.dto';
import {
  PublicationReportModerationAction,
  ReviewPublicationReportDto,
} from '../dto/review-publication-report.dto';
import { PublicationCacheService } from '../cache/publication-cache.service';

/**
 * Handles user publication reports and the complete administrator moderation
 * workflow.
 *
 * Admin review is intentionally atomic: the report state, optional publisher
 * warning, publication moderation state and audit entries are committed in the
 * same transaction whenever possible.
 */
@Injectable()
export class PublicationReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly systemAlerts: SystemAlertsService,
    private readonly publicationCache: PublicationCacheService,
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

  /**
   * Returns the moderation queue with the publication and publisher information
   * needed by the admin UI. This avoids extra per-row requests in the frontend.
   */
  async findAll(query: GetPublicationReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();

    const where: Prisma.IdeaPublicationReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.reporterId ? { reporterId: query.reporterId } : {}),
      ...(query.publicationId ? { publicationId: query.publicationId } : {}),
      ...(search
        ? {
            OR: [
              { details: { contains: search, mode: 'insensitive' } },
              { reporter: { fullName: { contains: search, mode: 'insensitive' } } },
              { reporter: { email: { contains: search, mode: 'insensitive' } } },
              {
                publication: {
                  publicTitle: { contains: search, mode: 'insensitive' },
                },
              },
              {
                publication: {
                  publisher: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
              },
              {
                publication: {
                  publisher: {
                    email: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.ideaPublicationReport.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          publicationId: true,
          reporterId: true,
          reason: true,
          details: true,
          status: true,
          adminNote: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
          reporter: { select: { id: true, fullName: true, email: true } },
          publication: {
            select: {
              id: true,
              ideaId: true,
              publicTitle: true,
              publicAbstract: true,
              publicProblem: true,
              publisherId: true,
              status: true,
              isHidden: true,
              hiddenReason: true,
              publishedAt: true,
              publisher: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  accountStatus: true,
                },
              },
              _count: { select: { reports: true } },
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

  /** Lightweight analytics dedicated to the moderation queue. */
  async getSummary() {
    // Two compact queries are enough for the moderation header. Using groupBy
    // avoids issuing one COUNT query per status and keeps this endpoint cheap.
    const [statusGroups, affected] = await Promise.all([
      this.prisma.ideaPublicationReport.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.ideaPublicationReport.findMany({
        distinct: ['publicationId'],
        select: { publicationId: true },
      }),
    ]);

    const counts = Object.fromEntries(
      statusGroups.map((group) => [group.status, group._count._all]),
    ) as Partial<Record<ModerationReportStatus, number>>;

    const pending = counts[ModerationReportStatus.PENDING] ?? 0;
    const reviewing = counts[ModerationReportStatus.REVIEWING] ?? 0;
    const resolved = counts[ModerationReportStatus.RESOLVED] ?? 0;
    const dismissed = counts[ModerationReportStatus.DISMISSED] ?? 0;

    return {
      totalReports: pending + reviewing + resolved + dismissed,
      pendingReports: pending,
      reviewingReports: reviewing,
      resolvedReports: resolved,
      dismissedReports: dismissed,
      affectedPublications: affected.length,
    };
  }

  /**
   * Reviews a report and optionally performs a publisher/publication action.
   *
   * Supported moderation actions:
   * - WARN_PUBLISHER: persists an in-app ADMIN alert for the publisher.
   * - HIDE_PUBLICATION: removes the publication from discovery without changing
   *   its PUBLISHED status.
   * - ARCHIVE_PUBLICATION: unpublishes the item by archiving and hiding it.
   * - RESTORE_PUBLICATION: removes an administrator hide flag.
   */
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
      select: {
        id: true,
        publicationId: true,
        status: true,
        publication: {
          select: {
            id: true,
            publicTitle: true,
            publisherId: true,
            status: true,
            isHidden: true,
            hiddenReason: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Publication report not found');
    }

    const action =
      dto.moderationAction ?? PublicationReportModerationAction.NONE;
    const note = dto.adminNote?.trim();
    const now = new Date();
    let publicationChanged = false;

    const result = await this.prisma.$transaction(async (tx) => {
      let moderationResult: Record<string, unknown> | null = null;

      if (action === PublicationReportModerationAction.WARN_PUBLISHER) {
        const warningMessage = dto.publisherMessage?.trim();
        if (!warningMessage) {
          throw new BadRequestException(
            'A publisher warning message is required for WARN_PUBLISHER.',
          );
        }

        const alert = await this.systemAlerts.create(
          {
            userId: existing.publication.publisherId,
            title: 'Publication moderation notice',
            message: warningMessage,
            type: AlertType.ADMIN,
          },
          tx,
        );

        await this.audit.createLog(
          {
            actorId: adminId,
            action: AuditAction.ADMIN_CREATE_ALERT,
            targetType: AuditTargetType.ALERT,
            targetId: alert.id,
            newValue: {
              userId: existing.publication.publisherId,
              publicationId: existing.publication.id,
              reportId,
              title: alert.title,
              type: alert.type,
            },
          },
          tx,
        );

        moderationResult = { action, alertId: alert.id };
      }

      if (action === PublicationReportModerationAction.HIDE_PUBLICATION) {
        const publication = await tx.ideaPublication.update({
          where: { id: existing.publication.id },
          data: {
            isHidden: true,
            hiddenAt: now,
            hiddenReason: note || `Moderated from report ${reportId}`,
          },
          select: { id: true, status: true, isHidden: true, hiddenReason: true },
        });
        publicationChanged = true;

        await this.audit.createLog(
          {
            actorId: adminId,
            action: AuditAction.ADMIN_HIDE_PUBLICATION,
            targetType: AuditTargetType.IDEA_PUBLICATION,
            targetId: publication.id,
            oldValue: {
              isHidden: existing.publication.isHidden,
              hiddenReason: existing.publication.hiddenReason,
            },
            newValue: {
              isHidden: publication.isHidden,
              hiddenReason: publication.hiddenReason,
              reportId,
            },
          },
          tx,
        );

        moderationResult = { action, publication };
      }

      if (action === PublicationReportModerationAction.ARCHIVE_PUBLICATION) {
        const publication = await tx.ideaPublication.update({
          where: { id: existing.publication.id },
          data: {
            status: IdeaPublicationStatus.ARCHIVED,
            archivedAt: now,
            isHidden: true,
            hiddenAt: now,
            hiddenReason: note || `Unpublished from report ${reportId}`,
          },
          select: { id: true, status: true, isHidden: true, hiddenReason: true },
        });
        publicationChanged = true;

        await this.audit.createLog(
          {
            actorId: adminId,
            action: AuditAction.ADMIN_ARCHIVE_PUBLICATION,
            targetType: AuditTargetType.IDEA_PUBLICATION,
            targetId: publication.id,
            oldValue: {
              status: existing.publication.status,
              isHidden: existing.publication.isHidden,
            },
            newValue: {
              status: publication.status,
              isHidden: publication.isHidden,
              reason: publication.hiddenReason,
              reportId,
            },
          },
          tx,
        );

        moderationResult = { action, publication };
      }

      if (action === PublicationReportModerationAction.RESTORE_PUBLICATION) {
        const publication = await tx.ideaPublication.update({
          where: { id: existing.publication.id },
          data: { isHidden: false, hiddenAt: null, hiddenReason: null },
          select: { id: true, status: true, isHidden: true },
        });
        publicationChanged = true;

        await this.audit.createLog(
          {
            actorId: adminId,
            action: AuditAction.ADMIN_RESTORE_PUBLICATION,
            targetType: AuditTargetType.IDEA_PUBLICATION,
            targetId: publication.id,
            oldValue: {
              isHidden: existing.publication.isHidden,
              hiddenReason: existing.publication.hiddenReason,
            },
            newValue: { isHidden: false, reportId },
          },
          tx,
        );

        moderationResult = { action, publication };
      }

      const report = await tx.ideaPublicationReport.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          adminNote: note,
          reviewedById: adminId,
          reviewedAt: now,
        },
        select: {
          id: true,
          publicationId: true,
          reason: true,
          details: true,
          status: true,
          adminNote: true,
          reviewedAt: true,
        },
      });

      await this.audit.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_REVIEW_PUBLICATION_REPORT,
          targetType: AuditTargetType.IDEA_PUBLICATION_REPORT,
          targetId: reportId,
          oldValue: { status: existing.status },
          newValue: {
            status: report.status,
            adminNote: report.adminNote,
            moderationAction: action,
          },
        },
        tx,
      );

      return {
        message: this.buildReviewMessage(action),
        report,
        moderation: moderationResult,
      };
    });

    if (publicationChanged) {
      await this.publicationCache.invalidateDiscovery(existing.publication.id);
    }

    return result;
  }

  private buildReviewMessage(action: PublicationReportModerationAction) {
    switch (action) {
      case PublicationReportModerationAction.WARN_PUBLISHER:
        return 'Report reviewed and publisher warned successfully';
      case PublicationReportModerationAction.HIDE_PUBLICATION:
        return 'Report reviewed and publication hidden successfully';
      case PublicationReportModerationAction.ARCHIVE_PUBLICATION:
        return 'Report reviewed and publication unpublished successfully';
      case PublicationReportModerationAction.RESTORE_PUBLICATION:
        return 'Report reviewed and publication restored successfully';
      default:
        return 'Publication report reviewed successfully';
    }
  }
}