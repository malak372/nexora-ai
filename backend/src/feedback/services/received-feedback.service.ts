import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PublicationFeedbackStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetReceivedFeedbackQueryDto } from '../dto/get-received-feedback-query.dto';

/** Returns private feedback received by the publication owner. @author Eman */
@Injectable()
export class ReceivedFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async findReceived(
    userId: string,
    publicationId: string,
    query: GetReceivedFeedbackQueryDto,
  ) {
    const publication = await this.prisma.ideaPublication.findUnique({
      where: { id: publicationId },
      select: {
        id: true,
        publisherId: true,
        publicTitle: true,
        averageRating: true,
        ratingsCount: true,
        feedbackCount: true,
        upvotesCount: true,
        downvotesCount: true,
      },
    });
    if (!publication) throw new NotFoundException('Publication not found');
    if (publication.publisherId !== userId) {
      throw new ForbiddenException(
        'Only the publication owner can view received feedback.',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.IdeaPublicationFeedbackWhereInput = {
      publicationId,
      status: query.status ?? PublicationFeedbackStatus.VISIBLE,
      ...(query.search?.trim()
        ? { comment: { contains: query.search.trim(), mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.ideaPublicationFeedback.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          comment: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, fullName: true, userType: true } },
        },
      }),
      this.prisma.ideaPublicationFeedback.count({ where }),
    ]);
    return {
      publication: {
        id: publication.id,
        publicTitle: publication.publicTitle,
        averageRating: Number(publication.averageRating),
        ratingsCount: publication.ratingsCount,
        feedbackCount: publication.feedbackCount,
        upvotesCount: publication.upvotesCount,
        downvotesCount: publication.downvotesCount,
      },
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
