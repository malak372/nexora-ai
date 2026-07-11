/**
 * Maps the final intelligent NLP analysis output into the persistence
 * command consumed by the database layer.
 *
 * @author Eman
 */

import type { IntelligentAnalysisOutput } from '../../pipeline/types/intelligent-analysis.types';
import type { PersistAnalysisCommand } from '../types/persist-analysis.command';

/**
 * Converts the final intelligent analysis output into a persistence command.
 *
 * This mapper contains no business logic and performs no database access.
 * Its only responsibility is adapting the NLP pipeline output structure
 * to the persistence contract.
 */
export class IntelligentAnalysisPersistenceMapper {
  private constructor() {}

  /**
   * Converts the final NLP analysis output into a persistence command.
   *
   * @param output Final output produced by the intelligent NLP pipeline.
   * @returns A strongly typed command ready for the persistence layer.
   */
  static toCommand(output: IntelligentAnalysisOutput): PersistAnalysisCommand {
    if (!output.collectionJobId?.trim()) {
      throw new Error('Collection job ID is required.');
    }

    return {
      collectionJobId: output.collectionJobId,

      statistics: {
        totalTextsAnalyzed: output.totalTextsAnalyzed,
        totalPostsAnalyzed: output.totalPostsAnalyzed,
        totalCommentsAnalyzed: output.totalCommentsAnalyzed,
      },

      metadata: {
        confidence: output.confidence,
        aiUsed: output.aiUsed,
      },

      sentimentStats: output.sentimentStats,

      keywords: output.keywords,
      topics: output.topics,

      recurringProblems: output.recurringProblems,
      extractedNeeds: output.extractedNeeds,
      featureRequests: output.featureRequests,
      opportunities: output.opportunities,

      insights: output.insights,
      dataQuality: output.dataQuality,

      evidence: {
        samplePosts: output.samplePosts,
        sampleComments: output.sampleComments,
      },
    };
  }
}
