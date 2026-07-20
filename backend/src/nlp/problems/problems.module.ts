import { Module } from '@nestjs/common';

import { ProblemInsightService } from './problem-insight.service';
import { ProblemNormalizerService } from './problem-normalizer.service';
import { ProblemSeverityPolicyService } from './problem-severity-policy.service';

/**
 * Groups services responsible for recurring-problem analysis.
 *
 * Responsibilities:
 * - Normalize language-aware problem terms.
 * - Calculate recurring-problem severity.
 * - Extract, rank, and classify recurring problems.
 * - Expose problem-analysis services to the main NLP pipeline.
 *
 * @author Eman
 */
@Module({
  providers: [
    ProblemNormalizerService,
    ProblemSeverityPolicyService,
    ProblemInsightService,
  ],
  exports: [
    ProblemInsightService,
    ProblemNormalizerService,
    ProblemSeverityPolicyService,
  ],
})
export class ProblemsModule { }