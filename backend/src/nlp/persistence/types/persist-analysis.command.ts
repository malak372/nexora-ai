/**
 * Defines the strongly typed command used to persist NLP analysis results.
 *
 * The persistence contract reuses the final NLP pipeline output types
 * and remains independent from Prisma or any database implementation.
 *
 * @author Eman
 */

import type { IntelligentAnalysisOutput } from '../../pipeline/types/intelligent-analysis.types';

/**
 * Represents the analysis counters that will be stored
 * for a specific collection job.
 */
export type AnalysisPersistenceStatistics = Readonly<
  Pick<
    IntelligentAnalysisOutput,
    | 'totalTextsAnalyzed'
    | 'totalPostsAnalyzed'
    | 'totalCommentsAnalyzed'
  >
>;

/**
 * Represents metadata describing how the final NLP analysis
 * was produced and how reliable it is.
 */
export type AnalysisPersistenceMetadata = Readonly<
  Pick<IntelligentAnalysisOutput, 'confidence' | 'aiUsed'>
>;

/**
 * Represents the post and comment samples supporting
 * the generated NLP analysis.
 */
export type AnalysisPersistenceEvidence = {
  readonly samplePosts: ReadonlyArray<
    IntelligentAnalysisOutput['samplePosts'][number]
  >;

  readonly sampleComments: ReadonlyArray<
    IntelligentAnalysisOutput['sampleComments'][number]
  >;
};

/**
 * Represents the command used to create or update the NLP analysis
 * associated with a specific data collection job.
 */
export type PersistAnalysisCommand = {
  readonly collectionJobId: string;

  readonly statistics: AnalysisPersistenceStatistics;
  readonly metadata: AnalysisPersistenceMetadata;

  readonly sentimentStats: IntelligentAnalysisOutput['sentimentStats'];

  readonly keywords: ReadonlyArray<
    IntelligentAnalysisOutput['keywords'][number]
  >;

  readonly topics: ReadonlyArray<
    IntelligentAnalysisOutput['topics'][number]
  >;

  readonly recurringProblems: ReadonlyArray<
    IntelligentAnalysisOutput['recurringProblems'][number]
  >;

  readonly extractedNeeds: ReadonlyArray<
    IntelligentAnalysisOutput['extractedNeeds'][number]
  >;

  readonly featureRequests: ReadonlyArray<
    IntelligentAnalysisOutput['featureRequests'][number]
  >;

  readonly opportunities: ReadonlyArray<
    IntelligentAnalysisOutput['opportunities'][number]
  >;

  readonly insights: IntelligentAnalysisOutput['insights'];
  readonly dataQuality: IntelligentAnalysisOutput['dataQuality'];
  readonly evidence: AnalysisPersistenceEvidence;
};