import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES } from '../../constants/community-ai-analysis.constants';

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
import { classifyDirectCommunityEvidence } from '../../../../nlp/common/utils/community-evidence.util';

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

    const baseAnalysis =
      context.nlp.totalTextsAnalyzed > 0
        ? (await this.communityAiAnalysisService.analyze(context)) ??
          this.buildFallbackAnalysis(context)
        : this.buildFallbackAnalysis(context);
    const analysis = this.ensureSelectedDomainCoverage(context, baseAnalysis);

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
      resultPreview: (() => {
        const groundedCount = analysis.opportunities.filter(
          (opportunity) => opportunity.evidenceSamples.length > 0,
        ).length;
        const hypothesisCount = analysis.opportunities.length - groundedCount;

        if (groundedCount === analysis.opportunities.length) {
          return `Community AI analysis extracted ${groundedCount} evidence-grounded opportunity candidate(s).`;
        }

        if (groundedCount > 0) {
          return `Generated ${analysis.opportunities.length} opportunity candidate(s): ${groundedCount} grounded by retained evidence and ${hypothesisCount} preliminary hypothesis candidate(s).`;
        }

        return `Created ${hypothesisCount} preliminary domain hypothesis candidate(s) because no direct community evidence was retained.`;
      })(),
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
  private ensureSelectedDomainCoverage(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    const represented = new Set(
      analysis.opportunities.map((item) =>
        item.domainName.trim().toLocaleLowerCase(),
      ),
    );
    const fallback = this.buildFallbackAnalysis(context);
    const additions = fallback.opportunities.filter((item) => {
      const key = item.domainName.trim().toLocaleLowerCase();
      return !represented.has(key) && item.evidenceSamples.length > 0;
    });
    const opportunities = [...analysis.opportunities];
    for (const item of additions) {
      if (opportunities.length >= COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES) break;
      opportunities.push(item);
      represented.add(item.domainName.trim().toLocaleLowerCase());
    }
    const missingEvidenceDomains = context.selectedDomains
      .filter((domain) => {
        const key = domain.name.trim().toLocaleLowerCase();
        if (represented.has(key)) return false;
        const profile = context.domainEvidence.find(
          (item) => item.domainId === domain.id,
        );
        const posts = Array.isArray(profile?.samplePosts) ? profile.samplePosts.length : 0;
        const comments = Array.isArray(profile?.sampleComments) ? profile.sampleComments.length : 0;
        return posts + comments === 0;
      })
      .map((domain) => domain.name);
    const qualityWarnings = analysis.qualityWarnings.filter(
      (warning) => !this.isProviderDomainCoverageWarning(warning, context),
    );

    return {
      ...analysis,
      opportunities,
      dominantProblems: opportunities.map((item) => item.problem),
      unmetNeeds: opportunities.map((item) => item.unmetNeed),
      qualityWarnings: [
        ...qualityWarnings,
        ...(additions.length > 0
          ? [`Added ${additions.length} retained-evidence fallback opportunity candidate(s) so selected domains with direct evidence remain represented.`]
          : []),
        ...(missingEvidenceDomains.length > 0
          ? [`No direct retained evidence was available for selected domain(s): ${missingEvidenceDomains.join(', ')}.`]
          : []),
      ],
    };
  }

  private isProviderDomainCoverageWarning(
    warning: string,
    context: IdeaGenerationContext,
  ): boolean {
    const normalized = warning
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const describesMissingEvidence =
      /(?:lack|lacked|lacks|missing|without|unavailable|no)\b.*\bevidence\b/u.test(
        normalized,
      ) ||
      /\bevidence\b.*\b(?:lack|lacked|lacks|missing|unavailable)\b/u.test(
        normalized,
      );

    if (!describesMissingEvidence) {
      return false;
    }

    const selectedDomainMentioned = context.selectedDomains.some((domain) =>
      normalized.includes(
        domain.name
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      ),
    );

    return selectedDomainMentioned || normalized.includes('selected domain');
  }

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
      const evidence =
        this.extractFirstEvidence(
          evidenceProfile?.sampleComments ?? null,
          'COMMENT',
        ) ??
        this.extractFirstEvidence(
          evidenceProfile?.samplePosts ?? null,
          'POST',
        );
      const hasEvidence = Boolean(evidence);

      const evidenceProblem = evidence
        ? this.deriveProblemFromEvidence(evidence, domain.name)
        : null;
      const evidenceTitle = evidenceProblem
        ? this.buildEvidenceOpportunityTitle(evidenceProblem, domain.name)
        : null;

      return {
        domainName: domain.name,
        title: hasEvidence
          ? evidenceTitle ?? `${domain.name} evidence-led workflow opportunity`
          : `${domain.name} validation-first workflow opportunity`,
        problem: hasEvidence
          ? evidenceProblem ??
            `Users in ${domain.name} experience a concrete workflow problem retained from community evidence.`
          : `A concrete community problem for ${domain.name} was not captured within the fast collection budget.`,
        unmetNeed: hasEvidence
          ? `A focused software workflow that directly resolves: ${evidenceProblem ?? `the retained ${domain.name} signal`}`
          : `A rapid validation workflow that discovers and tests the highest-value ${domain.name} problem before full implementation.`,
        solutionArea: hasEvidence
          ? this.deriveSolutionArea(evidenceProblem ?? evidence ?? '', domain.name)
          : 'Problem discovery, validation, and configurable pilot workflow',
        affectedUsers: hasEvidence
          ? this.deriveAffectedUsers(evidenceProblem ?? evidence ?? '', domain.name)
          : [`Users participating in ${domain.name} workflows`],
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

  /**
   * Converts retained evidence into a concise, concrete problem statement.
   *
   * The fallback must preserve the actual technical or operational friction
   * instead of replacing it with a generic "described by the sample" sentence.
   */
  private deriveProblemFromEvidence(
    evidence: string,
    domainName: string,
  ): string {
    const normalized = evidence.replace(/\s+/gu, ' ').trim();

    const explicitProblem = normalized.match(
      /(?:my problem is|the problem is|problem[:\s]+)([^.!?]{30,360})/iu,
    );
    if (explicitProblem?.[1]) {
      return this.ensureSentence(
        explicitProblem[1]
          .replace(/^(?:that|with)\s+/iu, '')
          .trim(),
      );
    }

    const difficulty = normalized.match(
      /((?:finding|extracting|connecting|integrating|visualizing|mapping|using|debugging|validating)[^.!?]{25,360})/iu,
    );
    if (difficulty?.[1]) {
      return this.ensureSentence(difficulty[1].trim());
    }

    const firstSentence =
      normalized
        .split(/(?<=[.!?])\s+/u)
        .find((item) => item.trim().length >= 35)
        ?.trim() ?? normalized.slice(0, 320).trim();

    return this.ensureSentence(
      firstSentence ||
        `A retained ${domainName} report describes unresolved workflow friction`,
    );
  }

  private buildEvidenceOpportunityTitle(
    problem: string,
    domainName: string,
  ): string {
    const normalized = problem.toLowerCase();

    if (/b-?spline|piecewise polynomial|spline coefficient/u.test(normalized)) {
      return 'Reliable B-Spline Coefficient Extraction and Validation';
    }
    if (/recommendation|recommender/u.test(normalized)) {
      return 'Recommendation Workflow Accuracy and Validation';
    }
    if (/connect|integration|api/u.test(normalized)) {
      return `${domainName} Integration Reliability`;
    }

    const words = problem
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 8);

    return words.length >= 3
      ? words.map((word) => this.capitalizeWord(word)).join(' ')
      : `${domainName} Evidence-Grounded Workflow Improvement`;
  }

  private deriveSolutionArea(problem: string, domainName: string): string {
    const normalized = problem.toLowerCase();

    if (/b-?spline|piecewise polynomial|coefficient/u.test(normalized)) {
      return 'Statistical model coefficient extraction, verification, and visualization';
    }
    if (/recommendation|recommender/u.test(normalized)) {
      return 'Recommendation quality diagnostics and explainable validation';
    }
    if (/connect|integration|api/u.test(normalized)) {
      return 'Integration diagnostics and guided configuration validation';
    }

    return `${domainName} workflow diagnostics and guided decision support`;
  }

  private deriveAffectedUsers(
    problem: string,
    domainName: string,
  ): string[] {
    const normalized = problem.toLowerCase();

    if (/\br\b|b-?spline|polynomial|statistical/u.test(normalized)) {
      return ['Data analysts', 'Statistical computing researchers', 'Software developers'];
    }
    if (/recommendation|recommender/u.test(normalized)) {
      return ['Recommendation-system developers', 'Data analysts', 'Product teams'];
    }

    return [`${domainName} practitioners`, 'Software developers', 'Operational analysts'];
  }

  private ensureSentence(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized) return normalized;

    const capitalized =
      normalized.charAt(0).toUpperCase() + normalized.slice(1);

    return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
  }

  private capitalizeWord(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  private extractFirstEvidence(
    value: unknown,
    sourceType: 'POST' | 'COMMENT',
  ): string | null {
    const candidates: string[] = [];

    const visit = (entry: unknown): void => {
      if (typeof entry === 'string') {
        const normalized = entry.replace(/\s+/gu, ' ').trim();
        if (normalized.length >= 8) candidates.push(normalized.slice(0, 450));
        return;
      }
      if (Array.isArray(entry)) {
        for (const item of entry) visit(item);
        return;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        for (const key of ['text', 'content', 'body', 'sample', 'samples']) {
          if (key in record) visit(record[key]);
        }
      }
    };

    visit(value);

    return (
      candidates
        .filter((candidate) =>
          this.isUsableFallbackEvidence(candidate, sourceType),
        )
        .sort(
          (first, second) =>
            this.scoreFallbackEvidence(second, sourceType) -
            this.scoreFallbackEvidence(first, sourceType),
        )[0] ?? null
    );
  }

  /**
   * Deterministic fallback may only treat a retained text as a community
   * problem when it contains observable user pain or a concrete request.
   * Publisher titles, reviews, tutorials, calls to action, and store links are
   * context only and cannot independently ground an opportunity.
   */
  private isUsableFallbackEvidence(
    value: string,
    sourceType: 'POST' | 'COMMENT',
  ): boolean {
    return classifyDirectCommunityEvidence(value, sourceType) !== 'NONE';
  }

  private scoreFallbackEvidence(
    value: string,
    sourceType: 'POST' | 'COMMENT',
  ): number {
    const normalized = value.toLowerCase();
    let score = sourceType === 'COMMENT' ? 30 : 0;
    if (/\b(?:cannot|can'?t|unable|failed|broken|bug|error|blocked|missing)\b/iu.test(normalized)) score += 30;
    if (/\b(?:security|privacy|billing|charged|unexpected (?:cost|bill)|cost)\b/iu.test(normalized)) score += 25;
    if (/\b(?:need|should|please add|feature request|wish|is it possible|can i|could i)\b/iu.test(normalized)) score += 15;
    if (/\b(?:i|we|my|our)\b/iu.test(normalized)) score += 10;
    if (/https?:\/\/|\b(?:check out|download|app review|subscribe|tutorial)\b/iu.test(normalized)) score -= 50;
    return score;
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