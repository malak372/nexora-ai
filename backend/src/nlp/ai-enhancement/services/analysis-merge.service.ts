import { Injectable } from '@nestjs/common';

import {
  AI_CONFIDENCE_WEIGHT,
  RULE_BASED_CONFIDENCE_WEIGHT,
} from '../constants/ai-enhancement.constants';

import { AiEnhancementEvidence } from '../types/ai-enhancement-input.type';

import {
  AiEnhancedFeatureRequest,
  AiEnhancedInsight,
  AiEnhancedNeed,
  AiEnhancedOpportunity,
  AiEnhancedRecurringProblem,
  AiEnhancementOutput,
} from '../types/ai-enhancement-output.type';

import {
  IntelligentAnalysisOutput,
  PriorityLevel,
} from '../../pipeline/types/intelligent-analysis.types';

/**
 * Numeric score assigned to LOW priority.
 */
const LOW_PRIORITY_SCORE = 0.33;

/**
 * Numeric score assigned to MEDIUM priority.
 */
const MEDIUM_PRIORITY_SCORE = 0.66;

/**
 * Numeric score assigned to HIGH priority.
 */
const HIGH_PRIORITY_SCORE = 1;

/**
 * Threshold at or above which an AI score becomes HIGH priority.
 */
const HIGH_PRIORITY_THRESHOLD = 0.67;

/**
 * Threshold at or above which an AI score becomes MEDIUM priority.
 */
const MEDIUM_PRIORITY_THRESHOLD = 0.34;

/**
 * Merges validated AI-enhancement output with the authoritative
 * rule-based NLP analysis.
 *
 * The rule-based result remains the source of truth for:
 * - Analyzed-text counts.
 * - Sentiment statistics.
 * - Keyword and topic frequencies.
 * - Data-quality metrics.
 * - Sample posts and comments.
 * - Existing frequencies and source-derived evidence.
 *
 * AI output is used only to:
 * - Refine or add recurring problems.
 * - Refine or add extracted needs.
 * - Refine or add feature requests.
 * - Refine or add software opportunities.
 * - Add evidence-supported analytical insights.
 * - Contribute to the final confidence score.
 *
 * Merge rules are deterministic and intentionally conservative:
 * - Existing rule-based items are never deleted.
 * - Existing rule-based frequencies are never reduced or replaced.
 * - AI-only frequencies are derived from unique supporting evidence
 *   identifiers rather than invented by the AI model.
 * - AI evidence identifiers are resolved back to real evidence text.
 * - Duplicate items are matched using normalized exact keys.
 * - Fuzzy semantic matching is intentionally avoided because it can
 *   silently merge unrelated community concerns.
 *
 * This service does not:
 * - Call AI providers.
 * - Validate raw AI responses.
 * - Build prompts.
 * - Persist the merged analysis.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisMergeService {
  /**
   * Merges one validated AI-enhancement output into a completed
   * rule-based NLP analysis.
   *
   * @param ruleBasedOutput Authoritative rule-based NLP result.
   * @param aiOutput Validated AI-enhancement output.
   * @param evidence Evidence supplied to the AI request.
   * @returns Final merged NLP analysis.
   */
  merge(
    ruleBasedOutput: IntelligentAnalysisOutput,
    aiOutput: AiEnhancementOutput,
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): IntelligentAnalysisOutput {
    const evidenceById = this.buildEvidenceLookup(evidence);

    return {
      ...ruleBasedOutput,

      recurringProblems: this.mergeRecurringProblems(
        ruleBasedOutput.recurringProblems,
        aiOutput.recurringProblems,
        evidenceById,
      ),

      extractedNeeds: this.mergeExtractedNeeds(
        ruleBasedOutput.extractedNeeds,
        aiOutput.extractedNeeds,
        evidenceById,
      ),

      featureRequests: this.mergeFeatureRequests(
        ruleBasedOutput.featureRequests,
        aiOutput.featureRequests,
        evidenceById,
      ),

      opportunities: this.mergeOpportunities(
        ruleBasedOutput.opportunities,
        aiOutput.opportunities,
        evidenceById,
      ),

      insights: {
        ...ruleBasedOutput.insights,

        additionalInsights: this.mergeAdditionalInsights(
          ruleBasedOutput.insights.additionalInsights,
          aiOutput.insights,
          evidenceById,
        ),
      },

      aiUsed: true,

      confidence: this.calculateMergedConfidence(
        ruleBasedOutput.confidence,
        aiOutput.confidence,
      ),
    };
  }

  /**
   * Merges recurring problems while preserving authoritative
   * rule-based frequencies.
   *
   * AI-only problem frequency is calculated from the number of unique
   * supporting evidence identifiers.
   */
  private mergeRecurringProblems(
    ruleBasedProblems: IntelligentAnalysisOutput['recurringProblems'],
    aiProblems: ReadonlyArray<AiEnhancedRecurringProblem>,
    evidenceById: ReadonlyMap<string, string>,
  ): IntelligentAnalysisOutput['recurringProblems'] {
    const merged = ruleBasedProblems.map((problem) => ({
      ...problem,
      evidenceSamples: [...problem.evidenceSamples],
    }));

    const indexByKey = new Map(
      merged.map((problem, index) => [this.normalizeKey(problem.title), index]),
    );

    for (const aiProblem of aiProblems) {
      const key = this.normalizeKey(aiProblem.title);
      const existingIndex = indexByKey.get(key);
      const aiEvidence = this.resolveEvidenceSamples(
        aiProblem.supportingEvidenceIds,
        evidenceById,
      );

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];

        merged[existingIndex] = {
          ...existing,
          severity: this.maxPriority(
            existing.severity,
            this.scoreToPriority(aiProblem.severity),
          ),
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            aiEvidence,
          ),
        };

        continue;
      }

      merged.push({
        title: aiProblem.title,
        frequency: aiProblem.supportingEvidenceIds.length,
        severity: this.scoreToPriority(aiProblem.severity),
        evidenceSamples: aiEvidence,
      });

      indexByKey.set(key, merged.length - 1);
    }

    return merged;
  }

  /**
   * Merges extracted needs while retaining existing related-problem
   * links and rule-based priority values.
   */
  private mergeExtractedNeeds(
    ruleBasedNeeds: IntelligentAnalysisOutput['extractedNeeds'],
    aiNeeds: ReadonlyArray<AiEnhancedNeed>,
    evidenceById: ReadonlyMap<string, string>,
  ): IntelligentAnalysisOutput['extractedNeeds'] {
    const merged = ruleBasedNeeds.map((need) => ({
      ...need,
      evidenceSamples: [...need.evidenceSamples],
    }));

    const indexByKey = new Map(
      merged.map((need, index) => [this.normalizeKey(need.need), index]),
    );

    for (const aiNeed of aiNeeds) {
      const key = this.normalizeKey(aiNeed.need);
      const existingIndex = indexByKey.get(key);
      const aiEvidence = this.resolveEvidenceSamples(
        aiNeed.supportingEvidenceIds,
        evidenceById,
      );

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];

        merged[existingIndex] = {
          ...existing,
          priority: this.maxPriority(
            existing.priority,
            this.scoreToPriority(aiNeed.confidence),
          ),
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            aiEvidence,
          ),
        };

        continue;
      }

      merged.push({
        need: aiNeed.need,
        priority: this.scoreToPriority(aiNeed.confidence),
        evidenceSamples: aiEvidence,
      });

      indexByKey.set(key, merged.length - 1);
    }

    return merged;
  }

  /**
   * Merges feature requests while preserving existing frequencies.
   *
   * For AI-only feature requests, frequency is derived from the
   * number of unique supporting evidence identifiers.
   */
  private mergeFeatureRequests(
    ruleBasedRequests: IntelligentAnalysisOutput['featureRequests'],
    aiRequests: ReadonlyArray<AiEnhancedFeatureRequest>,
    evidenceById: ReadonlyMap<string, string>,
  ): IntelligentAnalysisOutput['featureRequests'] {
    const merged = ruleBasedRequests.map((request) => ({
      ...request,
      evidenceSamples: [...request.evidenceSamples],
    }));

    const indexByKey = new Map(
      merged.map((request, index) => [
        this.normalizeKey(request.feature),
        index,
      ]),
    );

    for (const aiRequest of aiRequests) {
      const key = this.normalizeKey(aiRequest.feature);
      const existingIndex = indexByKey.get(key);
      const aiEvidence = this.resolveEvidenceSamples(
        aiRequest.supportingEvidenceIds,
        evidenceById,
      );

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];

        merged[existingIndex] = {
          ...existing,
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            aiEvidence,
          ),
        };

        continue;
      }

      merged.push({
        feature: aiRequest.feature,
        frequency: aiRequest.supportingEvidenceIds.length,
        evidenceSamples: aiEvidence,
      });

      indexByKey.set(key, merged.length - 1);
    }

    return merged;
  }

  /**
   * Merges software opportunities.
   *
   * Existing rule-based contextual links such as problem, need, and
   * topic remain unchanged. AI confidence may increase, but never
   * reduce, the existing opportunity score.
   */
  private mergeOpportunities(
    ruleBasedOpportunities: IntelligentAnalysisOutput['opportunities'],
    aiOpportunities: ReadonlyArray<AiEnhancedOpportunity>,
    evidenceById: ReadonlyMap<string, string>,
  ): IntelligentAnalysisOutput['opportunities'] {
    const merged = ruleBasedOpportunities.map((opportunity) => ({
      ...opportunity,
      evidenceSamples: [...opportunity.evidenceSamples],
    }));

    const indexByKey = new Map(
      merged.map((opportunity, index) => [
        this.normalizeKey(opportunity.solutionArea),
        index,
      ]),
    );

    for (const aiOpportunity of aiOpportunities) {
      const key = this.normalizeKey(aiOpportunity.title);
      const existingIndex = indexByKey.get(key);
      const aiEvidence = this.resolveEvidenceSamples(
        aiOpportunity.supportingEvidenceIds,
        evidenceById,
      );

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];

        merged[existingIndex] = {
          ...existing,
          score: Math.max(existing.score, aiOpportunity.confidence),
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            aiEvidence,
          ),
        };

        continue;
      }

      merged.push({
        solutionArea: aiOpportunity.title,
        score: aiOpportunity.confidence,
        evidenceSamples: aiEvidence,
      });

      indexByKey.set(key, merged.length - 1);
    }

    return merged;
  }

  /**
   * Merges evidence-supported AI insights into the dedicated
   * additional-insights collection.
   *
   * Existing classified concern arrays remain unchanged because the
   * generic AI insight contract does not contain a reliable concern
   * category.
   */
  private mergeAdditionalInsights(
    ruleBasedInsights: ReadonlyArray<string>,
    aiInsights: ReadonlyArray<AiEnhancedInsight>,
    evidenceById: ReadonlyMap<string, string>,
  ): string[] {
    const merged = [...ruleBasedInsights];
    const seen = new Set(merged.map((item) => this.normalizeKey(item)));

    for (const aiInsight of aiInsights) {
      /*
       * Resolution proves that every referenced identifier maps to
       * evidence supplied to the AI request. The validator has already
       * checked this, and the merge layer preserves defense in depth.
       */
      this.resolveEvidenceSamples(
        aiInsight.supportingEvidenceIds,
        evidenceById,
      );

      const key = this.normalizeKey(aiInsight.insight);

      if (!seen.has(key)) {
        seen.add(key);
        merged.push(aiInsight.insight);
      }
    }

    return merged;
  }

  /**
   * Builds a lookup from evidence identifiers to normalized evidence
   * text.
   *
   * The first occurrence of a duplicate identifier is preserved to
   * maintain stable upstream evidence priority.
   */
  private buildEvidenceLookup(
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): ReadonlyMap<string, string> {
    const lookup = new Map<string, string>();

    for (const item of evidence) {
      const id = item.id.trim();
      const text = item.text.trim();

      if (!lookup.has(id)) {
        lookup.set(id, text);
      }
    }

    return lookup;
  }

  /**
   * Resolves AI evidence identifiers back to real evidence text.
   *
   * Unknown identifiers are ignored defensively because they should
   * already have been rejected by AiAnalysisOutputValidatorService.
   */
  private resolveEvidenceSamples(
    evidenceIds: ReadonlyArray<string>,
    evidenceById: ReadonlyMap<string, string>,
  ): string[] {
    const samples: string[] = [];

    for (const id of evidenceIds) {
      const sample = evidenceById.get(id);

      if (sample !== undefined && sample.length > 0) {
        samples.push(sample);
      }
    }

    return this.mergeUniqueStrings([], samples);
  }

  /**
   * Calculates the final confidence score using the configured
   * rule-based and AI confidence weights.
   */
  private calculateMergedConfidence(
    ruleBasedConfidence: number,
    aiConfidence: number,
  ): number {
    const totalWeight = RULE_BASED_CONFIDENCE_WEIGHT + AI_CONFIDENCE_WEIGHT;

    const weightedConfidence =
      (this.clampScore(ruleBasedConfidence) * RULE_BASED_CONFIDENCE_WEIGHT +
        this.clampScore(aiConfidence) * AI_CONFIDENCE_WEIGHT) /
      totalWeight;

    return Number(this.clampScore(weightedConfidence).toFixed(3));
  }

  /**
   * Converts a normalized AI score into the priority contract used by
   * the rule-based NLP output.
   */
  private scoreToPriority(score: number): PriorityLevel {
    const normalizedScore = this.clampScore(score);

    if (normalizedScore >= HIGH_PRIORITY_THRESHOLD) {
      return 'HIGH';
    }

    if (normalizedScore >= MEDIUM_PRIORITY_THRESHOLD) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Returns the higher of two priority values.
   */
  private maxPriority(
    first: PriorityLevel,
    second: PriorityLevel,
  ): PriorityLevel {
    return this.priorityToScore(first) >= this.priorityToScore(second)
      ? first
      : second;
  }

  /**
   * Converts a priority value into a comparable numeric score.
   */
  private priorityToScore(priority: PriorityLevel): number {
    switch (priority) {
      case 'LOW':
        return LOW_PRIORITY_SCORE;

      case 'MEDIUM':
        return MEDIUM_PRIORITY_SCORE;

      case 'HIGH':
        return HIGH_PRIORITY_SCORE;

      default:
        return this.assertNever(priority);
    }
  }

  /**
   * Merges two string collections while preserving order and
   * removing blank or duplicate values.
   */
  private mergeUniqueStrings(
    first: ReadonlyArray<string>,
    second: ReadonlyArray<string>,
  ): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const value of [...first, ...second]) {
      const normalizedValue = value.trim();

      if (normalizedValue.length === 0) {
        continue;
      }

      const key = this.normalizeKey(normalizedValue);

      if (!seen.has(key)) {
        seen.add(key);
        result.push(normalizedValue);
      }
    }

    return result;
  }

  /**
   * Produces a stable comparison key for deterministic exact matching.
   *
   * This normalization intentionally does not perform fuzzy semantic
   * matching.
   */
  private normalizeKey(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Clamps an unknown score to the inclusive range [0, 1].
   */
  private clampScore(score: number): number {
    if (!Number.isFinite(score)) {
      return 0;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Ensures every PriorityLevel value is handled explicitly.
   */
  private assertNever(value: never): never {
    throw new Error(`Unsupported priority level: ${String(value)}`);
  }
}
