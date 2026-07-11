/**
 * Persists aggregated intelligent NLP analysis results for collection jobs.
 *
 * This service is the only component in the NLP persistence layer that
 * communicates directly with Prisma.
 *
 * @author Eman
 */

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NlpAnalysis, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { PersistAnalysisCommand } from './types/persist-analysis.command';

/**
 * Handles the creation and updating of persisted NLP analysis results.
 *
 * Each collection job owns at most one NLP analysis record. Re-running the
 * analysis updates the existing record instead of creating a duplicate.
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
    await this.ensureCollectionJobExists(command.collectionJobId);

    const persistenceData = this.buildPersistenceData(command);

    try {
      const analysis = await this.prisma.nlpAnalysis.upsert({
        where: {
          collectionJobId: command.collectionJobId,
        },

        create: {
          collectionJobId: command.collectionJobId,
          ...persistenceData,
        },

        update: persistenceData,
      });

      this.logger.log(
        `NLP analysis persisted for collection job ${command.collectionJobId}`,
      );

      return analysis;
    } catch (error) {
      this.logPersistenceError(command.collectionJobId, error);

      throw new InternalServerErrorException(
        'Failed to persist NLP analysis results.',
      );
    }
  }

  /**
   * Returns the persisted NLP analysis for a collection job.
   *
   * @param collectionJobId Collection job identifier.
   * @returns The stored analysis or null when no analysis exists.
   */
  async findByCollectionJobId(
    collectionJobId: string,
  ): Promise<NlpAnalysis | null> {
    return this.prisma.nlpAnalysis.findUnique({
      where: {
        collectionJobId,
      },
    });
  }

  /**
   * Ensures that the collection job exists before storing its analysis.
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
   * Converts the persistence command into values accepted by Prisma.
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

      evidenceSamples: this.toJsonValue({
        samplePosts: command.evidence.samplePosts,
        sampleComments: command.evidence.sampleComments,
      }),

      aiUsed: command.metadata.aiUsed,
      confidence: this.normalizeConfidence(command.metadata.confidence),
    };
  }

  /**
   * Converts strongly typed domain values into Prisma-compatible JSON.
   */
  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  /**
   * Restricts confidence to the supported range and precision.
   */
  private normalizeConfidence(confidence: number): Prisma.Decimal {
    const normalizedConfidence = Math.min(Math.max(confidence, 0), 1);

    return new Prisma.Decimal(normalizedConfidence.toFixed(3));
  }

  /**
   * Logs persistence failures without exposing internal database details.
   */
  private logPersistenceError(collectionJobId: string, error: unknown): void {
    const stack = error instanceof Error ? error.stack : undefined;

    this.logger.error(
      `Failed to persist NLP analysis for collection job ${collectionJobId}`,
      stack,
    );
  }
}
