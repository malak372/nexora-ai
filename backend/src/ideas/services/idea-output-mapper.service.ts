import { Injectable } from '@nestjs/common';

import { GeneratedOutputType, Prisma } from '@prisma/client';

import type { IntelligentAnalysisOutput } from '../../nlp/pipeline/types/intelligent-analysis.types';

import type { PremiumIdeaAiOutput } from '../types/idea-ai-output.type';

type OutputRow = Prisma.GeneratedOutputCreateManyInput;

/**
 * Maps premium output into persistent advanced features.
 *
 * @author Malak
 */
@Injectable()
export class IdeaOutputMapperService {
  mapPremium(
    ideaId: string,
    aiOutput: PremiumIdeaAiOutput,
    nlpOutput: IntelligentAnalysisOutput,
  ): OutputRow[] {
    return [
      this.row(
        ideaId,
        GeneratedOutputType.FULL_ABSTRACT,
        aiOutput.fullAbstract,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.TECHNOLOGY_STACK,
        aiOutput.technologyStack,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.SYSTEM_ARCHITECTURE,
        aiOutput.systemArchitecture,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.DATABASE_DESIGN,
        aiOutput.databaseDesign,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.COMMENT_ANALYSIS,
        aiOutput.communityFeedbackSummary,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.SAMPLE_COMMENTS,
        nlpOutput.sampleComments,
      ),

      this.row(ideaId, GeneratedOutputType.NLP_ANALYSIS, {
        executiveSummary: aiOutput.nlpExecutiveSummary,

        sentimentStats: nlpOutput.sentimentStats,

        topics: nlpOutput.topics,

        extractedNeeds: nlpOutput.extractedNeeds,

        featureRequests: nlpOutput.featureRequests,

        opportunities: nlpOutput.opportunities,

        insights: nlpOutput.insights,

        dataQuality: nlpOutput.dataQuality,

        confidence: nlpOutput.confidence,

        aiUsed: nlpOutput.aiUsed,
      }),

      this.row(
        ideaId,
        GeneratedOutputType.RECURRING_PROBLEMS,
        nlpOutput.recurringProblems,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.EXTRACTED_KEYWORDS,
        nlpOutput.keywords,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.LOCAL_REGULATIONS,
        aiOutput.localRegulations,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.BUDGET_ESTIMATION,
        aiOutput.budgetEstimation,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.BUSINESS_MODEL,
        aiOutput.businessModel,
      ),

      this.row(ideaId, GeneratedOutputType.TARGET_USERS, aiOutput.targetUsers),

      this.row(
        ideaId,
        GeneratedOutputType.VALUE_PROPOSITION,
        aiOutput.valueProposition,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.REVENUE_MODEL,
        aiOutput.revenueModel,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.FEASIBILITY_ASSESSMENT,
        aiOutput.feasibilityAssessment,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.IMPLEMENTATION_TIMELINE,
        aiOutput.implementationTimeline,
      ),

      this.row(
        ideaId,
        GeneratedOutputType.MARKET_POTENTIAL,
        aiOutput.marketPotential,
      ),
    ];
  }

  private row(
    ideaId: string,
    outputType: GeneratedOutputType,
    value: unknown,
  ): OutputRow {
    return {
      ideaId,
      outputType,

      content: typeof value === 'string' ? value : JSON.stringify(value),
    };
  }
}
