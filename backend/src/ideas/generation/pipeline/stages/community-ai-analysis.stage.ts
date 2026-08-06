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
import type {
  CommunityAiAnalysis,
  CommunityAiOpportunity,
} from '../../types/community-ai-analysis.type';
import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
} from '../../types/idea-generation-context.type';

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
    return Boolean(context.nlp);
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

    const analysis =
      context.nlp.totalTextsAnalyzed > 0
        ? (await this.communityAiAnalysisService.analyze(context)) ??
          this.buildFallbackAnalysis(context)
        : this.buildFallbackAnalysis(context);

    const enrichedNlp: IdeaGenerationNlpContext = {
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
      /*
       * The AI portfolio is authoritative. Deterministic NLP no longer creates
       * opportunities, so replacing the array avoids duplicate ranking work
       * and guarantees that every ranked opportunity came from the AI layer.
       */
      opportunities: this.toNlpOpportunities(analysis.opportunities),
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
      resultPreview: analysis.opportunities.some(
        (opportunity) => opportunity.evidenceSamples.length > 0,
      )
        ? `Community AI analysis extracted ${analysis.opportunities.length} evidence-grounded opportunity candidate(s).`
        : `Created ${analysis.opportunities.length} preliminary domain hypothesis candidate(s) because no direct community evidence was retained.`,
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

  /**
   * Converts the AI opportunities to Prisma's read-side JSON representation.
   *
   * `IdeaGenerationNlpContext.opportunities` is `Prisma.JsonValue`, while
   * `Prisma.InputJsonObject` belongs to Prisma's write-side JSON API and is
   * intentionally not assignable to `JsonValue`. Building a `JsonArray` here
   * keeps the generation context type-safe without weakening its contract.
   */
  private toNlpOpportunities(
    opportunities: readonly CommunityAiOpportunity[],
  ): Prisma.JsonArray {
    return opportunities.map((opportunity) =>
      this.toNlpOpportunity(opportunity),
    );
  }

  private toNlpOpportunity(
    opportunity: CommunityAiOpportunity,
  ): Prisma.JsonObject {
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

  /**
   * Builds a low-confidence, clearly labelled fallback when the enrichment
   * provider is unavailable or a selected domain has no collected rows.
   * Evidence text is reused verbatim when available; no fake quote is created.
   */
  private buildFallbackAnalysis(
    context: IdeaGenerationContext,
  ): CommunityAiAnalysis {
    const domains = context.selectedDomains.length
      ? context.selectedDomains
      : [
          {
            id: context.domainId,
            name: context.domainName ?? 'Selected domain',
            keywords: context.keywords,
          },
        ];

    const opportunities = domains.map((domain): CommunityAiOpportunity => {
      const evidenceProfile = (context.domainEvidence ?? []).find(
        (item) => item.domainId === domain.id,
      );
      const evidence = this.extractFirstEvidence([
        evidenceProfile?.sampleComments ?? null,
        evidenceProfile?.samplePosts ?? null,
      ]);
      const hasEvidence = Boolean(evidence);

      return {
        domainName: domain.name,
        title: hasEvidence
          ? `${domain.name} evidence-led workflow opportunity`
          : `${domain.name} validation-first workflow opportunity`,
        problem: hasEvidence
          ? `Users in ${domain.name} experience the concrete workflow friction described by the retained community sample.`
          : `A concrete community problem for ${domain.name} was not captured within the fast collection budget.`,
        unmetNeed: hasEvidence
          ? `A focused software workflow that responds directly to the retained ${domain.name} signal.`
          : `A rapid validation workflow that discovers and tests the highest-value ${domain.name} problem before full implementation.`,
        solutionArea: hasEvidence
          ? 'Evidence-led workflow automation and guided decision support'
          : 'Problem discovery, validation, and configurable pilot workflow',
        affectedUsers: [`Users participating in ${domain.name} workflows`],
        evidenceSamples: evidence ? [evidence] : [],
        frequency: 1,
        severity: 'MEDIUM',
        confidence: hasEvidence ? 38 : 20,
        problemImportance: hasEvidence ? 45 : 25,
        localEvidenceAvailable: false,
        localEvidenceSamples: [],
        localRelevance: 20,
        groundingScore: hasEvidence ? 100 : 0,
        technicalFeasibility: 72,
        marketPotential: hasEvidence ? 48 : 30,
        innovationPotential: 55,
        risks: [
          hasEvidence
            ? 'The preliminary direction is supported by one retained sample and requires broader validation.'
            : 'No direct community evidence was collected within the fast budget; validate the hypothesis before implementation.',
        ],
      };
    });

    return {
      summary:
        'Fast fallback analysis preserved one cautious direction per selected domain so core idea generation can continue.',
      dominantProblems: opportunities.map((item) => item.problem),
      unmetNeeds: opportunities.map((item) => item.unmetNeed),
      opportunities,
      overallConfidence:
        opportunities.some((item) => item.evidenceSamples.length > 0) ? 35 : 20,
      qualityWarnings: [
        'Community AI enrichment was unavailable or evidence was sparse; fallback opportunities are preliminary and require validation.',
      ],
      modelId: null,
      apiModelId: null,
      attemptCount: 0,
    };
  }

  private extractFirstEvidence(values: readonly unknown[]): string | null {
    const visit = (value: unknown): string | null => {
      if (typeof value === 'string') {
        const normalized = value.replace(/\s+/gu, ' ').trim();
        return normalized.length >= 8 ? normalized.slice(0, 450) : null;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = visit(item);
          if (found) return found;
        }
      } else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        for (const key of ['text', 'content', 'body', 'sample', 'samples']) {
          if (key in record) {
            const found = visit(record[key]);
            if (found) return found;
          }
        }
      }
      return null;
    };

    for (const value of values) {
      const found = visit(value);
      if (found) return found;
    }
    return null;
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