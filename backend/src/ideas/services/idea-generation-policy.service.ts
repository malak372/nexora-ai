import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { IdeaGenerationType, UserRole } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { AuthenticatedIdeaGenerationPolicy } from '../types/idea-generation-policy.type';

/**
 * Resolves authenticated generation access.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string): Promise<AuthenticatedIdeaGenerationPolicy> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,

        role: true,

        isActive: true,

        isVerified: true,

        freeGenerationLimit: true,

        freeGenerationsUsed: true,

        creditBalance: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.role !== UserRole.USER) {
      throw new ForbiddenException(
        'Only registered user accounts can generate ideas.',
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException('The user account is inactive.');
    }

    if (!user.isVerified) {
      throw new ForbiddenException(
        'Email verification is required before generating ideas.',
      );
    }

    if (user.freeGenerationsUsed < user.freeGenerationLimit) {
      return {
        generationType: IdeaGenerationType.NORMAL_FREE,

        user,
      };
    }

    if (user.creditBalance > 0) {
      return {
        generationType: IdeaGenerationType.PREMIUM_CREDIT,

        user,
      };
    }

    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,

        error: 'Payment Required',

        code: 'FREE_GENERATION_LIMIT_REACHED',

        message:
          'Free generations are exhausted. Purchase credits to generate another idea.',
      },

      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
