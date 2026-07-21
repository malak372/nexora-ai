import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  IdeaPublicationStatus,
  IdeaPublicationVisibility,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { UpsertIdeaPublicationDto } from '../dto/upsert-idea-publication.dto';

/**
 * Manages the lifecycle of idea publications.
 *
 * This service is responsible for:
 * - Creating publication drafts for user-owned ideas.
 * - Updating safe public snapshots.
 * - Managing restricted publication audiences.
 * - Publishing completed drafts.
 * - Archiving existing publications.
 * - Deleting draft publications.
 * - Creating immutable publication revisions.
 *
 * Publication data is stored as a separate public snapshot so that protected,
 * premium, and internal idea-generation data is not exposed directly.
 *
 * All write operations verify that the authenticated user owns the related
 * idea or publication.
 *
 * @author Malak
 */
@Injectable()
export class IdeaPublicationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or updates the publication snapshot of a user-owned idea.
   *
   * When the publication does not exist, a new draft is created.
   * When it already exists, its safe public fields and interaction settings
   * are updated.
   *
   * Missing public fields are populated from the original idea:
   * - The idea title is used as the default public title.
   * - The most complete available abstract is used as the public abstract.
   * - Problem, objectives, and target users are copied into the snapshot.
   *
   * Archived publications cannot be updated until a dedicated restore
   * operation is performed.
   *
   * When an already-published publication is updated, a new immutable
   * publication revision is created.
   *
   * @param userId Authenticated user identifier.
   * @param ideaId User-owned idea identifier.
   * @param dto Publication snapshot and visibility configuration.
   * @returns Created or updated publication with its audience rules.
   *
   * @throws NotFoundException When the idea does not exist or is not owned
   * by the authenticated user.
   * @throws BadRequestException When the publication is archived or its
   * selected-audience configuration is invalid.
   */
  async upsert(userId: string, ideaId: string, dto: UpsertIdeaPublicationDto) {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        limitedAbstract: true,
        partialAbstract: true,
        fullAbstract: true,
        problemStatement: true,
        objectives: true,
        targetUsers: true,
        publication: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!idea) {
      throw new NotFoundException('Idea not found');
    }

    if (idea.publication?.status === IdeaPublicationStatus.ARCHIVED) {
      throw new BadRequestException(
        'Archived publications cannot be edited. Create a restore operation first.',
      );
    }

    this.validateAudience(dto);

    /**
     * Builds a safe public snapshot.
     *
     * Values explicitly provided by the user take priority. Otherwise,
     * compatible fields are copied from the original idea.
     */
    const snapshot = {
      publicTitle: dto.publicTitle?.trim() || idea.title,

      publicAbstract:
        dto.publicAbstract?.trim() ||
        idea.fullAbstract ||
        idea.partialAbstract ||
        idea.limitedAbstract,

      publicProblem: dto.publicProblem?.trim() || idea.problemStatement,

      publicObjectives:
        dto.publicObjectives?.trim() || this.stringifyJson(idea.objectives),

      publicTargetUsers:
        dto.publicTargetUsers?.trim() || this.stringifyJson(idea.targetUsers),
    };

    return this.prisma.$transaction(async (tx) => {
      /**
       * Creates a draft publication or updates the existing snapshot.
       *
       * Undefined interaction flags are preserved during updates because
       * Prisma ignores undefined update values.
       */
      const publication = await tx.ideaPublication.upsert({
        where: {
          ideaId,
        },
        create: {
          ideaId,
          publisherId: userId,
          status: IdeaPublicationStatus.DRAFT,
          visibility: dto.visibility,

          ...snapshot,

          allowRatings: dto.allowRatings ?? true,
          allowFeedback: dto.allowFeedback ?? true,
          allowVoting: dto.allowVoting ?? true,
        },
        update: {
          visibility: dto.visibility,

          ...snapshot,

          allowRatings: dto.allowRatings,
          allowFeedback: dto.allowFeedback,
          allowVoting: dto.allowVoting,
        },
        select: {
          id: true,
          status: true,
        },
      });

      /**
       * Replaces the previous audience configuration.
       *
       * Audience entries are only stored when the publication uses
       * selected-audience visibility.
       */
      await tx.ideaPublicationAudience.deleteMany({
        where: {
          publicationId: publication.id,
        },
      });

      if (dto.visibility === IdeaPublicationVisibility.SELECTED_AUDIENCE) {
        await tx.ideaPublicationAudience.createMany({
          data: (dto.audiences ?? []).map((audience) => ({
            publicationId: publication.id,
            audienceType: audience.audienceType.trim().toLowerCase(),
            audienceValue: audience.audienceValue.trim(),
          })),
          skipDuplicates: true,
        });
      }

      /**
       * Stores an immutable revision whenever a published snapshot changes.
       */
      if (publication.status === IdeaPublicationStatus.PUBLISHED) {
        const latest = await tx.ideaPublicationRevision.aggregate({
          where: {
            publicationId: publication.id,
          },
          _max: {
            version: true,
          },
        });

        await tx.ideaPublicationRevision.create({
          data: {
            publicationId: publication.id,
            version: (latest._max.version ?? 0) + 1,
            publicTitle: snapshot.publicTitle,
            publicAbstract: snapshot.publicAbstract ?? '',
            publicProblem: snapshot.publicProblem,
            publicObjectives: snapshot.publicObjectives,
            publicTargetUsers: snapshot.publicTargetUsers,
          },
        });
      }

      return tx.ideaPublication.findUniqueOrThrow({
        where: {
          id: publication.id,
        },
        include: {
          audiences: true,
        },
      });
    });
  }

  /**
   * Publishes an existing idea-publication draft.
   *
   * Before publishing, the service verifies that:
   * - A public abstract exists.
   * - Selected-audience visibility has at least one audience.
   * - The publication is not archived.
   *
   * Publishing records the publication timestamp and creates the initial
   * immutable publication revision.
   *
   * Calling this method for an already-published publication is idempotent
   * and returns the existing publication without creating another revision.
   *
   * @param userId Authenticated user identifier.
   * @param ideaId User-owned idea identifier.
   * @returns Published publication.
   *
   * @throws NotFoundException When no owned publication exists.
   * @throws BadRequestException When required publication data is missing
   * or when the publication is archived.
   */
  async publish(userId: string, ideaId: string) {
    const publication = await this.findOwnedByIdea(userId, ideaId);

    if (!publication.publicAbstract?.trim()) {
      throw new BadRequestException(
        'A public abstract is required before publishing.',
      );
    }

    if (
      publication.visibility === IdeaPublicationVisibility.SELECTED_AUDIENCE &&
      publication.audiences.length === 0
    ) {
      throw new BadRequestException(
        'At least one audience is required for selected-audience visibility.',
      );
    }

    if (publication.status === IdeaPublicationStatus.PUBLISHED) {
      return publication;
    }

    if (publication.status === IdeaPublicationStatus.ARCHIVED) {
      throw new BadRequestException(
        'Archived publications cannot be published.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ideaPublication.update({
        where: {
          id: publication.id,
        },
        data: {
          status: IdeaPublicationStatus.PUBLISHED,
          publishedAt: new Date(),
          archivedAt: null,
        },
      });

      /**
       * Creates the first immutable revision representing the snapshot
       * originally made visible to other users.
       */
      await tx.ideaPublicationRevision.create({
        data: {
          publicationId: publication.id,
          version: 1,
          publicTitle: publication.publicTitle,
          publicAbstract: publication.publicAbstract ?? '',
          publicProblem: publication.publicProblem,
          publicObjectives: publication.publicObjectives,
          publicTargetUsers: publication.publicTargetUsers,
        },
      });

      return updated;
    });
  }

  /**
   * Archives a user-owned idea publication.
   *
   * Archived publications are no longer discoverable through public or
   * registered-user discovery endpoints.
   *
   * Calling this method for an already-archived publication is idempotent
   * and returns the current publication.
   *
   * @param userId Authenticated user identifier.
   * @param ideaId User-owned idea identifier.
   * @returns Archived publication.
   *
   * @throws NotFoundException When no owned publication exists.
   */
  async archive(userId: string, ideaId: string) {
    const publication = await this.findOwnedByIdea(userId, ideaId);

    if (publication.status === IdeaPublicationStatus.ARCHIVED) {
      return publication;
    }

    return this.prisma.ideaPublication.update({
      where: {
        id: publication.id,
      },
      data: {
        status: IdeaPublicationStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });
  }

  /**
   * Permanently deletes a user-owned publication draft.
   *
   * Published and archived publications cannot be deleted using this
   * operation because they may have associated revisions or engagement data.
   *
   * @param userId Authenticated user identifier.
   * @param ideaId User-owned idea identifier.
   * @returns Successful deletion message.
   *
   * @throws NotFoundException When no owned publication exists.
   * @throws ForbiddenException When the publication is not a draft.
   */
  async deleteDraft(userId: string, ideaId: string) {
    const publication = await this.findOwnedByIdea(userId, ideaId);

    if (publication.status !== IdeaPublicationStatus.DRAFT) {
      throw new ForbiddenException('Only draft publications can be deleted.');
    }

    await this.prisma.ideaPublication.delete({
      where: {
        id: publication.id,
      },
    });

    return {
      message: 'Publication draft deleted successfully',
    };
  }

  /**
   * Retrieves a publication belonging to the authenticated user.
   *
   * Soft-deleted ideas are excluded.
   *
   * Audience rules are included because they are required during publishing
   * validation and publication lifecycle operations.
   *
   * @param userId Authenticated user identifier.
   * @param ideaId Related idea identifier.
   * @returns Owned idea publication with audience configuration.
   *
   * @throws NotFoundException When the publication does not exist,
   * belongs to another user, or its idea has been deleted.
   */
  private async findOwnedByIdea(userId: string, ideaId: string) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        ideaId,
        publisherId: userId,
        idea: {
          deletedAt: null,
        },
      },
      include: {
        audiences: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Idea publication not found');
    }

    return publication;
  }

  /**
   * Validates restricted-audience publication settings.
   *
   * Publications using selected-audience visibility must provide at least
   * one audience rule.
   *
   * @param dto Publication configuration.
   *
   * @throws BadRequestException When selected-audience visibility is used
   * without audience entries.
   */
  private validateAudience(dto: UpsertIdeaPublicationDto): void {
    if (
      dto.visibility === IdeaPublicationVisibility.SELECTED_AUDIENCE &&
      (!dto.audiences || dto.audiences.length === 0)
    ) {
      throw new BadRequestException(
        'Selected-audience publications require at least one audience.',
      );
    }
  }

  /**
   * Converts a Prisma JSON value into a textual representation suitable
   * for the public publication snapshot.
   *
   * Existing strings are preserved, while objects and arrays are serialized
   * as JSON.
   *
   * @param value Prisma JSON value.
   * @returns String representation or null when no value exists.
   */
  private stringifyJson(value: Prisma.JsonValue | null): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value);
  }
}
