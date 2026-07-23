/**
 * Persists aggregated intelligent NLP analysis results for collection jobs.
 *
 * This service is the only component in the NLP persistence layer that
 * communicates directly with Prisma.
 *
 * @author Eman
 */

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { NlpAnalysis } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { PersistAnalysisCommand } from './types/persist-analysis.command';

/**
 * Handles the creation and updating of persisted NLP analysis results.
 *
 * Each collection job owns at most one NLP analysis record. Re-running the
 * analysis updates the existing record instead of creating a duplicate.
 *
 * @author Eman
 */
@Injectable()
export class NlpPersistenceService {
  private readonly logger = new Logger(NlpPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or updates the NLP analysis associated with a collection job.
   *
   * @param command Strongly typed NLP analysis persistence command.
   * @returns The created or updated NLP analysis record.
   */
  async saveAnalysis(command: PersistAnalysisCommand): Promise<NlpAnalysis> {
    const collectionJobId = this.normalizeCollectionJobId(
      command.collectionJobId,
    );

    await this.ensureCollectionJobExists(collectionJobId);

    const persistenceData = this.buildPersistenceData(command);

    try {
      const analysis = await this.prisma.nlpAnalysis.upsert({
        where: {
          collectionJobId,
        },
        create: {
          collectionJobId,
          ...persistenceData,
        },
        update: {
          ...persistenceData,
        },
      });

      this.logger.log(
        `NLP analysis persisted for collection job ${collectionJobId}.`,
      );

      return analysis;
    } catch (error: unknown) {
      this.handlePersistenceError(collectionJobId, error);
    }
  }

  /**
   * Returns the persisted NLP analysis associated with a collection job.
   *
   * @param collectionJobId Collection job identifier.
   * @returns The stored NLP analysis, or null when it does not exist.
   */
  async findByCollectionJobId(
    collectionJobId: string,
  ): Promise<NlpAnalysis | null> {
    const normalizedCollectionJobId =
      this.normalizeCollectionJobId(collectionJobId);

    return this.prisma.nlpAnalysis.findUnique({
      where: {
        collectionJobId: normalizedCollectionJobId,
      },
    });
  }

  /**
   * Ensures that the referenced collection job exists.
   *
   * @param collectionJobId Collection job identifier.
   */
  private async ensureCollectionJobExists(
    collectionJobId: string,
  ): Promise<void> {
    const collectionJob = await this.prisma.collectionJob.findUnique({
      where: {
        id: collectionJobId,
      },
      select: {
        id: true,
      },
    });

    if (!collectionJob) {
      throw new NotFoundException(
        `Collection job with ID "${collectionJobId}" was not found.`,
      );
    }
  }

  /**
   * Converts the persistence command into data matching the NlpAnalysis model.
   *
   * @param command NLP analysis persistence command.
   * @returns Data ready for Prisma create and update operations.
   */
  private buildPersistenceData(command: PersistAnalysisCommand) {
    return {
      totalTextsAnalyzed: command.statistics.totalTextsAnalyzed,
      totalPostsAnalyzed: command.statistics.totalPostsAnalyzed,
      totalCommentsAnalyzed: command.statistics.totalCommentsAnalyzed,

      sentimentStats: this.toJsonValue(command.sentimentStats),
      keywords: this.toJsonValue(command.keywords),
      topics: this.toJsonValue(command.topics),

      recurringProblems: this.toJsonValue(command.recurringProblems),
      extractedNeeds: this.toJsonValue(command.extractedNeeds),
      featureRequests: this.toJsonValue(command.featureRequests),
      opportunities: this.toJsonValue(command.opportunities),

      insights: this.toJsonValue(command.insights),
      dataQuality: this.toJsonValue(command.dataQuality),

      samplePosts: this.toJsonValue(command.evidence.samplePosts),
      sampleComments: this.toJsonValue(command.evidence.sampleComments),

      aiUsed: command.metadata.aiUsed,
      confidence: this.normalizeConfidence(command.metadata.confidence),
    };
  }

  /**
   * Converts a domain value into a Prisma-compatible JSON value.
   *
   * @param value Value to convert.
   * @returns Prisma-compatible JSON value.
   */
  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    const serializedValue = JSON.stringify(value);

    if (serializedValue === undefined) {
      throw new BadRequestException(
        'NLP analysis contains a value that cannot be stored as JSON.',
      );
    }

    try {
      return JSON.parse(serializedValue) as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException('NLP analysis contains invalid JSON data.');
    }
  }

  /**
   * Restricts confidence to the supported range and precision.
   *
   * @param confidence Raw analysis confidence.
   * @returns Confidence represented as a Prisma Decimal.
   */
  private normalizeConfidence(confidence: number): Prisma.Decimal {
    if (!Number.isFinite(confidence)) {
      return new Prisma.Decimal(0);
    }

    const normalizedConfidence = Math.min(Math.max(confidence, 0), 1);

    return new Prisma.Decimal(normalizedConfidence.toFixed(3));
  }

  /**
   * Trims and validates a collection job identifier.
   *
   * @param collectionJobId Raw collection job identifier.
   * @returns Normalized collection job identifier.
   */
  private normalizeCollectionJobId(collectionJobId: string): string {
    const normalizedCollectionJobId = collectionJobId?.trim();

    if (!normalizedCollectionJobId) {
      throw new BadRequestException('Collection job ID is required.');
    }

    return normalizedCollectionJobId;
  }

  /**
   * Maps known Prisma failures into safe application exceptions.
   *
   * @param collectionJobId Collection job identifier.
   * @param error Persistence error.
   */
  private handlePersistenceError(
    collectionJobId: string,
    error: unknown,
  ): never {
    this.logPersistenceError(collectionJobId, error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2003' || error.code === 'P2025')
    ) {
      throw new NotFoundException(
        `Collection job with ID "${collectionJobId}" was not found.`,
      );
    }

    throw new InternalServerErrorException(
      'Failed to persist NLP analysis results.',
    );
  }

  /**
   * Logs persistence failures without exposing database details to clients.
   *
   * @param collectionJobId Collection job identifier.
   * @param error Persistence error.
   */
  private logPersistenceError(collectionJobId: string, error: unknown): void {
    const message =
      error instanceof Error ? error.message : 'Unknown persistence error.';

    const stack = error instanceof Error ? error.stack : undefined;

    this.logger.error(
      `Failed to persist NLP analysis for collection job ${collectionJobId}: ${message}`,
      stack,
    );
  }
}
