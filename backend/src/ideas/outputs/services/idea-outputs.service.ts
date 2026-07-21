import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GeneratedOutputStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

import type { IdeaOutputResponse } from '../types/idea-output.type';

/** Read service for user-owned generated outputs. */
@Injectable()
export class IdeaOutputsService {
  constructor(private readonly prisma: PrismaService) {}

  async findForOwner(
    userId: string,
    ideaId: string,
  ): Promise<IdeaOutputResponse[]> {
    const idea = await this.prisma.idea.findFirst({
      where: { id: ideaId, userId, deletedAt: null },
      select: { id: true, isUnlocked: true },
    });

    if (!idea) {
      throw new NotFoundException('The requested idea was not found.');
    }

    if (!idea.isUnlocked) {
      throw new ForbiddenException(
        'Advanced outputs are available only for unlocked ideas.',
      );
    }

    return this.prisma.generatedOutput.findMany({
      where: {
        ideaId,
        status: GeneratedOutputStatus.COMPLETED,
      },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        outputKey: true,
        title: true,
        sequence: true,
        content: true,
        structuredContent: true,
        generatedAt: true,
      },
    });
  }
}
