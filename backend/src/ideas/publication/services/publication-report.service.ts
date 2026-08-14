import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
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
import type { Cache } from 'cache-manager';

import { SystemAlertsService } from '../../../alerts/services/system-alerts.service';
import { AuditService } from '../../../audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { userCacheKeys } from '../../../users/cache/user-cache.keys';

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
 *
 * @author Eman
 */
@Injectable()
export class PublicationReportService {
  private summaryCache: {
    value: {
      totalReports: number;
      pendingReports: number;
      reviewingReports: number;
      resolvedReports: number;
      dismissedReports: number;
      affectedPublications: number;
    };
    expiresAt: number;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly systemAlerts: SystemAlertsService,
    private readonly publicationCache: PublicationCacheService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) { }

  /**
   * Creates or reopens a publication report.
   */
  async report(
    userId: string,
    publicationId: string,
    dto: CreatePublicationReportDto,
  ) {
    const publication =
      await this.prisma.ideaPublication.findUnique({
        where: {
          id: publicationId,
        },
        select: {
          id: true,
          publisherId: true,
          status: true,
          isHidden: true,
        },
      });

    if (
      !publication ||
      publication.status !==
      IdeaPublicationStatus.PUBLISHED ||
      publication.isHidden
    ) {
      throw new NotFoundException(
        'Published publication not found',
      );
    }

    if (publication.publisherId === userId) {
      throw new ForbiddenException(
        'You cannot report your own publication.',
      );
    }

    const result =
      await this.prisma.$transaction(
        async (tx) => {
          const report =
            await tx.ideaPublicationReport.upsert({
              where: {
                publicationId_reporterId: {
                  publicationId,
                  reporterId: userId,
                },
              },
              create: {
                publicationId,
                reporterId: userId,
                reason: dto.reason,
                details:
                  dto.details?.trim(),
              },
              update: {
                reason: dto.reason,
                details:
                  dto.details?.trim(),

                // Re-reporting should return the report
                // back to the moderation queue.
                status:
                  ModerationReportStatus.PENDING,

                reviewedById: null,
                reviewedAt: null,
                adminNote: null,
              },
            });

          await this.audit.createLog(
            {
              actorId: userId,
              action:
                AuditAction.USER_REPORT_PUBLICATION,
              targetType:
                AuditTargetType
                  .IDEA_PUBLICATION_REPORT,
              targetId: report.id,
              newValue: {
                publicationId,
                reason: dto.reason,
                status: report.status,
              },
            },
            tx,
          );

          return {
            message:
              'Publication report submitted successfully',
            report,
          };
        },
      );

    /*
     * IMPORTANT
     *
     * The publication-report summary is cached for one minute.
     *
     * Without invalidating it here:
     * - user submits report
     * - report exists in PostgreSQL
     * - admin opens Reports
     * - old summary can still say 0
     * - manual reload later appears to "fix" it
     *
     * Clearing it immediately ensures the first admin load
     * reflects the current database state.
     */
    this.summaryCache = null;

    return result;
  }

  /**
   * Returns reports submitted by the currently authenticated user.
   */
  async findMine(
    userId: string,
    query: GetPublicationReportsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where:
      Prisma.IdeaPublicationReportWhereInput = {
      reporterId: userId,
    };

    const [data, total] =
      await this.prisma.$transaction([
        this.prisma.ideaPublicationReport.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
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

        this.prisma.ideaPublicationReport.count({
          where,
        }),
      ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages:
          Math.ceil(total / limit),
      },
    };
  }

  /**
   * Returns the administrator moderation queue.
   *
   * Publication, reporter, publisher and review information
   * are returned together so the mobile UI does not have
   * to perform additional requests for each card.
   */
  async findAll(
    query: GetPublicationReportsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();

    const where:
      Prisma.IdeaPublicationReportWhereInput = {
      ...(query.status
        ? {
          status: query.status,
        }
        : {}),

      ...(query.reason
        ? {
          reason: query.reason,
        }
        : {}),

      ...(query.reporterId
        ? {
          reporterId:
            query.reporterId,
        }
        : {}),

      ...(query.publicationId
        ? {
          publicationId:
            query.publicationId,
        }
        : {}),

      ...(search
        ? {
          OR: [
            {
              details: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              reporter: {
                fullName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
            {
              reporter: {
                email: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
            {
              publication: {
                publicTitle: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
            {
              publication: {
                publisher: {
                  fullName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            },
            {
              publication: {
                publisher: {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            },
          ],
        }
        : {}),
    };

    /**
     * Only supported sort values are mapped.
     *
     * This prevents arbitrary query strings from
     * being passed directly to Prisma.
     */
    const direction: Prisma.SortOrder =
      query.sortOrder === 'asc'
        ? 'asc'
        : 'desc';

    const orderBy:
      Prisma.IdeaPublicationReportOrderByWithRelationInput =
      (() => {
        switch (query.sortBy) {
          case 'status':
            return {
              status: direction,
            };

          case 'reason':
            return {
              reason: direction,
            };

          case 'reviewedAt':
            return {
              reviewedAt: direction,
            };

          case 'publication':
            return {
              publication: {
                publicTitle:
                  direction,
              },
            };

          case 'reporter':
            return {
              reporter: {
                fullName:
                  direction,
              },
            };

          case 'createdAt':
          default:
            return {
              createdAt: direction,
            };
        }
      })();

    const [data, total] =
      await this.prisma.$transaction([
        this.prisma.ideaPublicationReport.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy,
          select: {
            id: true,
            publicationId: true,
            reporterId: true,
            reason: true,
            details: true,
            status: true,

            adminNote: true,
            moderationAction: true,

            publisherMessage: true,
            reporterMessage: true,

            publisherNotified: true,
            reporterNotified: true,

            reviewedAt: true,
            createdAt: true,
            updatedAt: true,

            reporter: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },

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

                _count: {
                  select: {
                    reports: true,
                  },
                },
              },
            },

            reviewedBy: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        }),

        this.prisma.ideaPublicationReport.count({
          where,
        }),
      ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages:
          Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lightweight report list used for publication insights.
   */
  async findForPublication(
    publicationId: string,
    query: GetPublicationReportsQueryDto,
  ) {
    const page = query.page ?? 1;

    const limit = Math.min(
      query.limit ?? 20,
      50,
    );

    const where:
      Prisma.IdeaPublicationReportWhereInput = {
      publicationId,

      ...(query.status
        ? {
          status: query.status,
        }
        : {}),

      ...(query.reason
        ? {
          reason: query.reason,
        }
        : {}),
    };

    const [data, total] =
      await Promise.all([
        this.prisma.ideaPublicationReport.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            publicationId: true,
            reporterId: true,

            reason: true,
            details: true,
            status: true,

            adminNote: true,
            moderationAction: true,

            publisherMessage: true,
            reporterMessage: true,

            publisherNotified: true,
            reporterNotified: true,

            reviewedAt: true,
            createdAt: true,
            updatedAt: true,

            reporter: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },

            reviewedBy: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        }),

        this.prisma.ideaPublicationReport.count({
          where,
        }),
      ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages:
          Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lightweight summary for Publication Reports.
   *
   * A short in-memory cache keeps repeated admin tab
   * visits fast without doing six independent COUNTs.
   */
  async getSummary() {
    const now = Date.now();

    if (
      this.summaryCache &&
      this.summaryCache.expiresAt > now
    ) {
      return this.summaryCache.value;
    }

    const [
      statusGroups,
      affected,
    ] = await Promise.all([
      this.prisma.ideaPublicationReport.groupBy({
        by: ['status'],
        _count: {
          _all: true,
        },
      }),

      this.prisma.ideaPublicationReport.groupBy({
        by: ['publicationId'],
        _count: {
          publicationId: true,
        },
      }),
    ]);

    const counts =
      Object.fromEntries(
        statusGroups.map(
          (group) => [
            group.status,
            group._count._all,
          ],
        ),
      ) as Partial<
        Record<
          ModerationReportStatus,
          number
        >
      >;

    const pending =
      counts[
      ModerationReportStatus.PENDING
      ] ?? 0;

    const reviewing =
      counts[
      ModerationReportStatus.REVIEWING
      ] ?? 0;

    const resolved =
      counts[
      ModerationReportStatus.RESOLVED
      ] ?? 0;

    const dismissed =
      counts[
      ModerationReportStatus.DISMISSED
      ] ?? 0;

    const value = {
      totalReports:
        pending +
        reviewing +
        resolved +
        dismissed,

      pendingReports: pending,
      reviewingReports: reviewing,
      resolvedReports: resolved,
      dismissedReports: dismissed,

      affectedPublications:
        affected.length,
    };

    this.summaryCache = {
      value,
      expiresAt:
        Date.now() + 60_000,
    };

    return value;
  }

  /**
   * Reviews a report and optionally performs a moderation
   * action against its publication.
   */
  async review(
    adminId: string,
    reportId: string,
    dto: ReviewPublicationReportDto,
  ) {
    const existing =
      await this.prisma.ideaPublicationReport.findUnique({
        where: {
          id: reportId,
        },
        select: {
          id: true,
          publicationId: true,
          reporterId: true,
          status: true,
          adminNote: true,

          moderationAction: true,
          publisherMessage: true,
          reporterMessage: true,

          publisherNotified: true,
          reporterNotified: true,

          reviewedAt: true,

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
      throw new NotFoundException(
        'Publication report not found',
      );
    }

    const action =
      dto.moderationAction ??
      PublicationReportModerationAction.NONE;

    const storedModerationAction =
      action ===
        PublicationReportModerationAction.NONE &&
        existing.moderationAction &&
        existing.moderationAction !==
        PublicationReportModerationAction.NONE
        ? existing.moderationAction
        : action;

    const note =
      dto.adminNote?.trim();

    const publisherMessage =
      dto.publisherMessage?.trim();

    const requestedReporterMessage =
      dto.reporterMessage?.trim();

    const now = new Date();

    let publicationChanged = false;

    const isTerminalStatus =
      dto.status ===
      ModerationReportStatus.RESOLVED ||
      dto.status ===
      ModerationReportStatus.DISMISSED;

    /*
     * A resolved/dismissed report should always
     * inform its reporter.
     */
    const shouldNotifyReporter =
      Boolean(dto.notifyReporter) ||
      Boolean(
        requestedReporterMessage,
      ) ||
      isTerminalStatus;

    const result =
      await this.prisma.$transaction(
        async (tx) => {
          let moderationResult:
            Record<string, unknown> | null =
            null;

          let publisherNotified = false;
          let reporterNotified = false;

          let storedPublisherMessage:
            string | undefined;

          let storedReporterMessage:
            string | undefined;

          const notifyPublisher = async (
            title: string,
            message: string,
          ) => {
            const alert =
              await this.systemAlerts.create(
                {
                  userId:
                    existing.publication
                      .publisherId,
                  title,
                  message,
                  type: AlertType.ADMIN,
                },
                tx,
              );

            await this.audit.createLog(
              {
                actorId: adminId,
                action:
                  AuditAction.ADMIN_CREATE_ALERT,

                targetType:
                  AuditTargetType.ALERT,

                targetId: alert.id,

                newValue: {
                  userId:
                    existing.publication
                      .publisherId,

                  publicationId:
                    existing.publication.id,

                  reportId,

                  title: alert.title,
                  message: alert.message,
                  type: alert.type,

                  moderationAction:
                    action,
                },
              },
              tx,
            );

            publisherNotified = true;
            storedPublisherMessage =
              message;

            return alert;
          };

          if (
            action ===
            PublicationReportModerationAction.WARN_PUBLISHER
          ) {
            if (!publisherMessage) {
              throw new BadRequestException(
                'A publisher warning message is required for WARN_PUBLISHER.',
              );
            }

            const alert =
              await notifyPublisher(
                'Administrator message about your publication',
                publisherMessage,
              );

            moderationResult = {
              action,
              alertId: alert.id,
            };
          }

          /*
           * Allows the admin to send a publisher
           * notification without hiding/unpublishing.
           */
          if (
            action ===
            PublicationReportModerationAction.NONE &&
            publisherMessage
          ) {
            const alert =
              await notifyPublisher(
                'Message from the moderation team',
                publisherMessage,
              );

            moderationResult = {
              action:
                PublicationReportModerationAction.NONE,
              alertId: alert.id,
              notificationOnly: true,
            };
          }

          if (
            action ===
            PublicationReportModerationAction.HIDE_PUBLICATION
          ) {
            const publication =
              await tx.ideaPublication.update({
                where: {
                  id:
                    existing.publication.id,
                },
                data: {
                  isHidden: true,
                  hiddenAt: now,
                  hiddenReason:
                    note ||
                    `Moderated from report ${reportId}`,
                },
                select: {
                  id: true,
                  status: true,
                  isHidden: true,
                  hiddenReason: true,
                },
              });

            publicationChanged = true;

            await this.audit.createLog(
              {
                actorId: adminId,

                action:
                  AuditAction.ADMIN_HIDE_PUBLICATION,

                targetType:
                  AuditTargetType.IDEA_PUBLICATION,

                targetId:
                  publication.id,

                oldValue: {
                  isHidden:
                    existing.publication
                      .isHidden,

                  hiddenReason:
                    existing.publication
                      .hiddenReason,
                },

                newValue: {
                  isHidden:
                    publication.isHidden,

                  hiddenReason:
                    publication.hiddenReason,

                  reportId,
                },
              },
              tx,
            );

            moderationResult = {
              action,
              publication,
            };
          }

          if (
            action ===
            PublicationReportModerationAction.ARCHIVE_PUBLICATION
          ) {
            const publication =
              await tx.ideaPublication.update({
                where: {
                  id:
                    existing.publication.id,
                },
                data: {
                  status:
                    IdeaPublicationStatus.ARCHIVED,

                  archivedAt: now,

                  isHidden: true,
                  hiddenAt: now,

                  hiddenReason:
                    note ||
                    `Unpublished from report ${reportId}`,
                },

                select: {
                  id: true,
                  status: true,
                  isHidden: true,
                  hiddenReason: true,
                },
              });

            publicationChanged = true;

            await this.audit.createLog(
              {
                actorId: adminId,

                action:
                  AuditAction.ADMIN_ARCHIVE_PUBLICATION,

                targetType:
                  AuditTargetType.IDEA_PUBLICATION,

                targetId:
                  publication.id,

                oldValue: {
                  status:
                    existing.publication
                      .status,

                  isHidden:
                    existing.publication
                      .isHidden,
                },

                newValue: {
                  status:
                    publication.status,

                  isHidden:
                    publication.isHidden,

                  reason:
                    publication.hiddenReason,

                  reportId,
                },
              },
              tx,
            );

            moderationResult = {
              action,
              publication,
            };
          }

          if (
            action ===
            PublicationReportModerationAction.RESTORE_PUBLICATION
          ) {
            const publication =
              await tx.ideaPublication.update({
                where: {
                  id:
                    existing.publication.id,
                },

                data: {
                  status:
                    IdeaPublicationStatus.PUBLISHED,

                  archivedAt: null,

                  isHidden: false,
                  hiddenAt: null,
                  hiddenReason: null,

                  publishedAt:
                    existing.publication
                      .status ===
                      IdeaPublicationStatus.PUBLISHED
                      ? undefined
                      : now,
                },

                select: {
                  id: true,
                  status: true,
                  isHidden: true,
                },
              });

            publicationChanged = true;

            await this.audit.createLog(
              {
                actorId: adminId,

                action:
                  AuditAction.ADMIN_RESTORE_PUBLICATION,

                targetType:
                  AuditTargetType.IDEA_PUBLICATION,

                targetId:
                  publication.id,

                oldValue: {
                  isHidden:
                    existing.publication
                      .isHidden,

                  hiddenReason:
                    existing.publication
                      .hiddenReason,
                },

                newValue: {
                  isHidden: false,
                  reportId,
                },
              },
              tx,
            );

            moderationResult = {
              action,
              publication,
            };
          }

          /*
           * Hide/archive/restore automatically informs
           * the publisher.
           */
          if (
            action !==
            PublicationReportModerationAction.NONE &&
            action !==
            PublicationReportModerationAction.WARN_PUBLISHER
          ) {
            const defaultPublisherMessage =
              action ===
                PublicationReportModerationAction.HIDE_PUBLICATION
                ? `Your publication "${existing.publication.publicTitle}" was hidden by an administrator while a report was reviewed.`
                : action ===
                  PublicationReportModerationAction.ARCHIVE_PUBLICATION
                  ? `Your publication "${existing.publication.publicTitle}" was unpublished by an administrator after a report review.`
                  : `Your publication "${existing.publication.publicTitle}" was restored and is visible to the community again.`;

            const publisherNotificationTitle =
              action ===
                PublicationReportModerationAction.HIDE_PUBLICATION
                ? 'Your publication was hidden temporarily'
                : action ===
                  PublicationReportModerationAction.ARCHIVE_PUBLICATION
                  ? 'Your publication was unpublished'
                  : 'Your publication was restored';

            await notifyPublisher(
              publisherNotificationTitle,
              publisherMessage ||
              defaultPublisherMessage,
            );
          }

          /*
           * Reporter notification.
           */
          if (shouldNotifyReporter) {
            const defaultReporterMessage =
              dto.status ===
                ModerationReportStatus.RESOLVED
                ? `Your report about "${existing.publication.publicTitle}" has been resolved. Thank you for helping keep the community safe.`
                : dto.status ===
                  ModerationReportStatus.DISMISSED
                  ? `Your report about "${existing.publication.publicTitle}" has been reviewed and closed.`
                  : `Your report about "${existing.publication.publicTitle}" is now ${String(dto.status)
                    .toLowerCase()
                    .replace(/_/g, ' ')}.`;

            storedReporterMessage =
              requestedReporterMessage ||
              defaultReporterMessage;

            const reporterAlert =
              await this.systemAlerts.create(
                {
                  userId:
                    existing.reporterId,

                  title:
                    dto.status ===
                      ModerationReportStatus.RESOLVED
                      ? 'Your publication report was resolved'
                      : dto.status ===
                        ModerationReportStatus.DISMISSED
                        ? 'Your publication report was closed'
                        : 'Publication report update',

                  message:
                    storedReporterMessage,

                  type:
                    AlertType.ADMIN,
                },
                tx,
              );

            await this.audit.createLog(
              {
                actorId: adminId,

                action:
                  AuditAction.ADMIN_CREATE_ALERT,

                targetType:
                  AuditTargetType.ALERT,

                targetId:
                  reporterAlert.id,

                newValue: {
                  userId:
                    existing.reporterId,

                  publicationId:
                    existing.publication.id,

                  reportId,

                  title:
                    reporterAlert.title,

                  message:
                    reporterAlert.message,

                  type:
                    reporterAlert.type,

                  recipientRole:
                    'REPORTER',
                },
              },
              tx,
            );

            reporterNotified = true;
          }

          const finalPublisherMessage =
            storedPublisherMessage ??
            existing.publisherMessage ??
            null;

          const finalReporterMessage =
            storedReporterMessage ??
            existing.reporterMessage ??
            null;

          const finalPublisherNotified =
            publisherNotified ||
            existing.publisherNotified;

          const finalReporterNotified =
            reporterNotified ||
            existing.reporterNotified;

          const report =
            await tx.ideaPublicationReport.update({
              where: {
                id: reportId,
              },

              data: {
                status: dto.status,

                adminNote:
                  note ??
                  existing.adminNote ??
                  null,

                moderationAction:
                  storedModerationAction,

                publisherMessage:
                  finalPublisherMessage,

                reporterMessage:
                  finalReporterMessage,

                publisherNotified:
                  finalPublisherNotified,

                reporterNotified:
                  finalReporterNotified,

                reviewedById:
                  dto.status ===
                    ModerationReportStatus.PENDING
                    ? null
                    : adminId,

                reviewedAt:
                  dto.status ===
                    ModerationReportStatus.PENDING
                    ? null
                    : now,
              },

              select: {
                id: true,
                publicationId: true,

                reason: true,
                details: true,
                status: true,

                adminNote: true,
                moderationAction: true,

                publisherMessage: true,
                reporterMessage: true,

                publisherNotified: true,
                reporterNotified: true,

                reviewedAt: true,

                reviewedBy: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                  },
                },
              },
            });

          await this.audit.createLog(
            {
              actorId: adminId,

              action:
                AuditAction.ADMIN_REVIEW_PUBLICATION_REPORT,

              targetType:
                AuditTargetType
                  .IDEA_PUBLICATION_REPORT,

              targetId: reportId,

              oldValue: {
                status: existing.status,
              },

              newValue: {
                status: report.status,

                adminNote:
                  report.adminNote,

                moderationAction:
                  storedModerationAction,

                moderationActionThisReview:
                  action,

                publisherNotified:
                  finalPublisherNotified,

                reporterNotified:
                  finalReporterNotified,

                publisherMessage:
                  finalPublisherMessage,

                reporterMessage:
                  finalReporterMessage,
              },
            },
            tx,
          );

          return {
            message:
              this.buildReviewMessage(
                action,
              ),

            report,

            moderation:
              moderationResult,

            publisherNotified:
              finalPublisherNotified,

            reporterNotified:
              finalReporterNotified,

            publisherNotifiedThisReview:
              publisherNotified,

            reporterNotifiedThisReview:
              reporterNotified,
          };
        },
      );

    /*
     * Any visibility/status change must clear
     * publication discovery cache.
     */
    if (publicationChanged) {
      await this.publicationCache
        .invalidateDiscovery(
          existing.publication.id,
        );
    }

    /*
     * In-app admin notifications affect the user's
     * notification/activity summary.
     */
    const notificationRecipients =
      new Set<string>();

    if (
      result.publisherNotifiedThisReview
    ) {
      notificationRecipients.add(
        existing.publication.publisherId,
      );
    }

    if (
      result.reporterNotifiedThisReview
    ) {
      notificationRecipients.add(
        existing.reporterId,
      );
    }

    await Promise.all(
      Array.from(
        notificationRecipients,
      ).flatMap(
        (userId) => [
          this.cacheManager.del(
            userCacheKeys.summary(
              userId,
            ),
          ),
          this.cacheManager.del(
            userCacheKeys.activity(
              userId,
            ),
          ),
        ],
      ),
    );

    /*
     * Any moderation change can change the
     * pending/reviewing/resolved/dismissed totals.
     */
    this.summaryCache = null;

    return result;
  }

  /**
   * Builds the API success message for an administrator
   * moderation action.
   */
  private buildReviewMessage(
    action:
      PublicationReportModerationAction,
  ) {
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