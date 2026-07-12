import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { CreateSystemAlertInput } from '../types/create-system-alert-input.type';

/**
 * Creates in-app alerts for internal system workflows.
 *
 * This service is provider-neutral and contains no:
 * - HTTP controller logic.
 * - Administrator authorization.
 * - Email delivery.
 * - User notification listing.
 *
 * It supports an optional Prisma transaction client so alerts can
 * be persisted atomically with payments, credit updates, and ideas.
 *
 * @author Malak
 */
@Injectable()
export class SystemAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates one in-app alert.
   *
   * @param input Alert values.
   * @param tx Optional Prisma transaction client.
   */
  create(input: CreateSystemAlertInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;

    return client.alert.create({
      data: {
        userId: input.userId,
        title: this.normalizeText(input.title),
        message: this.normalizeText(input.message),
        type: input.type,
      },
    });
  }

  /**
   * Creates multiple in-app alerts.
   *
   * Used mainly for administrator broadcasts.
   *
   * @param inputs Alerts to create.
   * @param tx Optional Prisma transaction client.
   */
  createMany(
    inputs: readonly CreateSystemAlertInput[],
    tx?: Prisma.TransactionClient,
  ) {
    if (inputs.length === 0) {
      return Promise.resolve({
        count: 0,
      });
    }

    const client = tx ?? this.prisma;

    return client.alert.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        title: this.normalizeText(input.title),
        message: this.normalizeText(input.message),
        type: input.type,
      })),
    });
  }

  /**
   * Normalizes surrounding and repeated whitespace.
   */
  private normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }
}
