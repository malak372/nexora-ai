import { Module } from '@nestjs/common';

import { ProblemInsightService } from './problem-insight.service';
import { ProblemNormalizerService } from './problem-normalizer.service';
import { ProblemSeverityPolicyService } from './problem-severity-policy.service';

/**
 * Problems module for Nexora AI NLP.
 *
 * This module groups all services responsible for detecting, normalizing,
 * ranking, and classifying recurring community problems extracted from
 * analyzed posts and comments.
 *
 * Responsibilities:
 * - Normalize similar problem terms into stable problem titles.
 * - Calculate problem severity using reusable policy rules.
 * - Extract recurring problem insights with evidence samples.
 * - Expose problem analysis services to the main NLP module and pipeline.
 *
 * @author Eman
 */
@Module({
  providers: [
    ProblemInsightService,
    ProblemNormalizerService,
    ProblemSeverityPolicyService,
  ],
  exports: [
    ProblemInsightService,
    ProblemNormalizerService,
    ProblemSeverityPolicyService,
  ],
})
export class ProblemsModule {}
