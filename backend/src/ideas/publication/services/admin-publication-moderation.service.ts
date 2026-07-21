import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  IdeaPublicationStatus,
} from '@prisma/client';
import { AuditService } from '../../../audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminPublicationModerationDto } from '../dto/admin-publication-moderation.dto';

/** Admin moderation operations for idea publications.
 *
 * @author malak
 *
 **/
@Injectable()
export class AdminPublicationModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async hide(
    adminId: string,
    publicationId: string,
    dto: AdminPublicationModerationDto,
  ) {
    return this.setHidden(
      adminId,
      publicationId,
      true,
      dto.reason,
      AuditAction.ADMIN_HIDE_PUBLICATION,
    );
  }

  async restore(adminId: string, publicationId: string) {
    return this.setHidden(
      adminId,
      publicationId,
      false,
      null,
      AuditAction.ADMIN_RESTORE_PUBLICATION,
    );
  }

  async archive(
    adminId: string,
    publicationId: string,
    dto: AdminPublicationModerationDto,
  ) {
    const existing = await this.find(publicationId);
    return this.prisma.$transaction(async (tx) => {
      const publication = await tx.ideaPublication.update({
        where: { id: publicationId },
        data: {
          status: IdeaPublicationStatus.ARCHIVED,
          archivedAt: new Date(),
          isHidden: true,
          hiddenAt: new Date(),
          hiddenReason: dto.reason.trim(),
        },
      });
      await this.audit.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_ARCHIVE_PUBLICATION,
          targetType: AuditTargetType.IDEA_PUBLICATION,
          targetId: publicationId,
          oldValue: { status: existing.status, isHidden: existing.isHidden },
          newValue: {
            status: publication.status,
            isHidden: publication.isHidden,
            reason: publication.hiddenReason,
          },
        },
        tx,
      );
      return { message: 'Publication archived successfully', publication };
    });
  }

  private async setHidden(
    adminId: string,
    publicationId: string,
    hidden: boolean,
    reason: string | null,
    action: AuditAction,
  ) {
    const existing = await this.find(publicationId);
    return this.prisma.$transaction(async (tx) => {
      const publication = await tx.ideaPublication.update({
        where: { id: publicationId },
        data: {
          isHidden: hidden,
          hiddenAt: hidden ? new Date() : null,
          hiddenReason: hidden ? reason?.trim() : null,
        },
      });
      await this.audit.createLog(
        {
          actorId: adminId,
          action,
          targetType: AuditTargetType.IDEA_PUBLICATION,
          targetId: publicationId,
          oldValue: {
            isHidden: existing.isHidden,
            hiddenReason: existing.hiddenReason,
          },
          newValue: {
            isHidden: publication.isHidden,
            hiddenReason: publication.hiddenReason,
          },
        },
        tx,
      );
      return {
        message: hidden
          ? 'Publication hidden successfully'
          : 'Publication restored successfully',
        publication,
      };
    });
  }

  private async find(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findUnique({
      where: { id: publicationId },
      select: { id: true, status: true, isHidden: true, hiddenReason: true },
    });
    if (!publication) throw new NotFoundException('Publication not found');
    return publication;
  }
}
