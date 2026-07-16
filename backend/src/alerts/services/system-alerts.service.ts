import { Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { CreateSystemAlertInput } from '../types/create-system-alert-input.type';

/**
 * Handles centralized persistence of in-app system alerts.
 *
 * This service is independent of:
 * - HTTP controllers.
 * - Administrator authorization.
 * - Email delivery.
 * - User notification retrieval.
 *
 * It supports an optional Prisma transaction client, allowing
 * alerts to be persisted atomically with related operations such
 * as payments, credit updates, idea generation, and audit logs.
 *
 * @author Malak
 */
@Injectable()
export class SystemAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates one in-app alert.
   *
   * @param input Alert data to persist.
   * @param tx Optional Prisma transaction client.
   * @returns The created alert record.
   */
  create(input: CreateSystemAlertInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;

    return client.alert.create({
      data: this.buildAlertData(input),
    });
  }

  /**
   * Creates multiple in-app alerts in one database operation.
   *
   * Primarily used for administrator broadcasts and other
   * bulk-notification workflows.
   *
   * @param inputs Alerts to persist.
   * @param tx Optional Prisma transaction client.
   * @returns The number of created alert records.
   */
  createMany(
    inputs: readonly CreateSystemAlertInput[],
    tx?: Prisma.TransactionClient,
  ) {
    if (inputs.length === 0) {
      return Promise.resolve({ count: 0 });
    }

    const client = tx ?? this.prisma;

    return client.alert.createMany({
      data: inputs.map((input) => this.buildAlertData(input)),
    });
  }

  /**
   * Builds normalized Prisma alert creation data.
   */
  private buildAlertData(
    input: CreateSystemAlertInput,
  ): Prisma.AlertCreateManyInput {
    return {
      userId: input.userId,
      title: this.normalizeText(input.title),
      message: this.normalizeText(input.message),
      type: input.type,
    };
  }

  /**
   * Removes surrounding whitespace and replaces repeated
   * whitespace characters with a single space.
   */
  private normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }
}
