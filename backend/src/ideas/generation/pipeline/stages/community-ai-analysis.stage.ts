import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import { CommunityAiAnalysisService } from '../../services/community-ai-analysis.service';
import type { CommunityAiOpportunity } from '../../types/community-ai-analysis.type';
import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

/**
 * Enriches cleaned NLP output with evidence-grounded opportunities extracted
 * by an LLM. Failure is non-fatal: the original deterministic NLP output is
 * preserved so the existing ranking stage remains fully compatible.
 */
@Injectable()
export class CommunityAiAnalysisStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.COMMUNITY_AI_ANALYSIS;
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly communityAiAnalysisService: CommunityAiAnalysisService,
  ) {}

  shouldExecute(context: IdeaGenerationContext): boolean {
    return Boolean(context.nlp && context.nlp.totalTextsAnalyzed > 0);
  }

  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    if (!context.nlp) {
      return {
        context,
        resultPreview:
          'Community AI analysis skipped because NLP data is unavailable.',
        metadata: {
          analysisLayer: 'IDEA_OPPORTUNITY_ENRICHMENT',
          duplicatesNlpAiEnhancement: false,
          aiAnalysisApplied: false,
        },
      };
    }

    const analysis = await this.communityAiAnalysisService.analyze(context);
    if (!analysis) {
      return {
        context,
        resultPreview:
          'Community AI analysis was unavailable; deterministic NLP opportunities were preserved.',
        metadata: {
          analysisLayer: 'IDEA_OPPORTUNITY_ENRICHMENT',
          duplicatesNlpAiEnhancement: false,
          aiAnalysisApplied: false,
          fallbackApplied: true,
        },
      };
    }

    const enrichedNlp = {
      ...context.nlp,
      recurringProblems: this.mergeJsonArrays(
        context.nlp.recurringProblems,
        analysis.opportunities.map((opportunity) => ({
          domainName: opportunity.domainName,
          title: opportunity.title,
          problem: opportunity.problem,
          frequency: opportunity.frequency,
          severity: opportunity.severity,
          evidenceSamples: [...opportunity.evidenceSamples],
          source: 'COMMUNITY_LLM_ANALYSIS',
          aiConfidence: opportunity.confidence,
        })),
      ),
      extractedNeeds: this.mergeJsonArrays(
        context.nlp.extractedNeeds,
        analysis.opportunities.map((opportunity) => ({
          domainName: opportunity.domainName,
          title: opportunity.unmetNeed,
          need: opportunity.unmetNeed,
          problem: opportunity.problem,
          solutionArea: opportunity.solutionArea,
          frequency: opportunity.frequency,
          severity: opportunity.severity,
          evidenceSamples: [...opportunity.evidenceSamples],
          source: 'COMMUNITY_LLM_ANALYSIS',
        })),
      ),
      opportunities: this.mergeJsonArrays(
        context.nlp.opportunities,
        analysis.opportunities.map((opportunity) =>
          this.toNlpOpportunity(opportunity),
        ),
      ),
      insights: this.mergeJsonArrays(context.nlp.insights, [
        {
          type: 'COMMUNITY_AI_ANALYSIS',
          summary: analysis.summary,
          dominantProblems: [...analysis.dominantProblems],
          unmetNeeds: [...analysis.unmetNeeds],
          overallConfidence: analysis.overallConfidence,
          qualityWarnings: [...analysis.qualityWarnings],
          modelId: analysis.modelId,
          apiModelId: analysis.apiModelId,
          attemptCount: analysis.attemptCount,
        },
      ]),
      aiUsed: true,
      confidence: this.mergeConfidence(
        context.nlp.confidence,
        analysis.overallConfidence / 100,
      ),
    };

    return {
      context: {
        ...context,
        nlp: enrichedNlp,
        communityAiAnalysis: analysis,
      },
      resultPreview: `Community AI analysis extracted ${analysis.opportunities.length} evidence-grounded opportunity candidate(s).`,
      metadata: {
        analysisLayer: 'IDEA_OPPORTUNITY_ENRICHMENT',
        duplicatesNlpAiEnhancement: false,
        aiAnalysisApplied: true,
        opportunityCount: analysis.opportunities.length,
        overallConfidence: analysis.overallConfidence,
        modelId: analysis.modelId,
        apiModelId: analysis.apiModelId,
        attemptCount: analysis.attemptCount,
        qualityWarnings: analysis.qualityWarnings,
        representedDomains: [...new Set(analysis.opportunities.map((item) => item.domainName))],
      },
    };
  }

  private toNlpOpportunity(
    opportunity: CommunityAiOpportunity,
  ): Prisma.InputJsonObject {
    return {
      domainName: opportunity.domainName,
      title: opportunity.title,
      problem: opportunity.problem,
      need: opportunity.unmetNeed,
      solutionArea: opportunity.solutionArea,
      affectedUsers: [...opportunity.affectedUsers],
      frequency: opportunity.frequency,
      severity: opportunity.severity,
      evidenceSamples: [...opportunity.evidenceSamples],
      confidence: opportunity.confidence,
      problemImportance: opportunity.problemImportance,
      localRelevance: opportunity.localRelevance,
      technicalFeasibility: opportunity.technicalFeasibility,
      marketPotential: opportunity.marketPotential,
      innovationPotential: opportunity.innovationPotential,
      risks: [...opportunity.risks],
      source: 'COMMUNITY_LLM_ANALYSIS',
    };
  }

  private mergeJsonArrays(
    current: Prisma.JsonValue | null,
    additions: readonly Prisma.InputJsonValue[],
  ): Prisma.JsonArray {
    const existing = Array.isArray(current) ? current : [];
    return [...existing, ...additions] as Prisma.JsonArray;
  }

  private mergeConfidence(
    deterministicConfidence: number | null,
    aiConfidence: number,
  ): number {
    if (deterministicConfidence === null) {
      return aiConfidence;
    }
    return (
      Math.round((deterministicConfidence * 0.4 + aiConfidence * 0.6) * 1000) /
      1000
    );
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);
    if (!definition) {
      throw new Error(`Missing stage definition for ${this.key}.`);
    }
    return definition;
  }
}