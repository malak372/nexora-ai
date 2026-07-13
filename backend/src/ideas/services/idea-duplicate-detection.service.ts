import { ConflictException, Injectable } from '@nestjs/common';

import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Same-user, same-domain duplicate-title protection.
 *
 * @author Malak
 */
@Injectable()
export class IdeaDuplicateDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  async assertNotDuplicate(
    userId: string | undefined,
    domainId: string,
    title: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!userId) {
      return;
    }

    const client = tx ?? this.prisma;

    const existingIdeas = await client.idea.findMany({
      where: {
        userId,
        domainId,
      },

      select: {
        id: true,

        title: true,
      },

      orderBy: {
        createdAt: 'desc',
      },

      take: 100,
    });

    const normalizedTitle = this.normalizeTitle(title);

    const duplicate = existingIdeas.find(
      (idea) => this.normalizeTitle(idea.title) === normalizedTitle,
    );

    if (duplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_IDEA_TITLE',

        message: 'A similar idea already exists for this user and domain.',

        existingIdeaId: duplicate.id,
      });
    }
  }

  private normalizeTitle(title: string): string {
    return title
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }
}
