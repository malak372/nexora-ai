import { Injectable } from '@nestjs/common';

import {
  IntelligentAnalysisOutput,
  WeightedKeyword,
  WeightedTopic,
} from '../pipeline/types/intelligent-analysis.types';

type RecurringProblem = IntelligentAnalysisOutput['recurringProblems'][number];
type ExtractedNeed = IntelligentAnalysisOutput['extractedNeeds'][number];
type Opportunity = IntelligentAnalysisOutput['opportunities'][number];

/**
 * Extracts structured software opportunity signals from NLP analysis results.
 *
 * This service connects recurring problems, user needs, discussion topics,
 * and weighted keywords into structured opportunity objects. These objects are
 * intentionally not written as final project ideas; they provide evidence-based
 * direction for the Prompt Builder and AI idea generation layer.
 *
 * Responsibilities:
 * - Connect problems with related needs.
 * - Infer possible solution areas from topics and keywords.
 * - Score opportunities using problem severity, need priority, and frequency.
 * - Preserve evidence samples from real community feedback.
 * - Return structured outputs suitable for prompt generation.
 *
 * This service does not persist results and does not call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class OpportunityAnalysisService {
  private readonly maxOpportunities = 10;
  private readonly maxEvidenceSamples = 3;

  /**
   * Extracts structured opportunity signals from NLP analysis outputs.
   *
   * @param problems Recurring community problems.
   * @param needs Extracted user needs.
   * @param topics High-level discussion topics.
   * @param keywords Weighted keywords.
   * @returns Ranked structured opportunity signals.
   */
  extract(
    problems: RecurringProblem[],
    needs: ExtractedNeed[],
    topics: WeightedTopic[],
    keywords: WeightedKeyword[],
  ): Opportunity[] {
    const opportunities: Opportunity[] = [
      ...this.buildProblemNeedOpportunities(problems, needs, topics, keywords),
      ...this.buildProblemOnlyOpportunities(problems, topics, keywords),
      ...this.buildNeedOnlyOpportunities(needs, topics, keywords),
      ...this.buildTopicOpportunities(topics, keywords),
    ];

    return this.mergeSimilarOpportunities(opportunities)
      .sort((first, second) => {
        if (second.score !== first.score) {
          return second.score - first.score;
        }

        return first.solutionArea.localeCompare(second.solutionArea);
      })
      .slice(0, this.maxOpportunities);
  }

  /**
   * Builds opportunities by connecting recurring problems with related needs.
   */
  private buildProblemNeedOpportunities(
    problems: RecurringProblem[],
    needs: ExtractedNeed[],
    topics: WeightedTopic[],
    keywords: WeightedKeyword[],
  ): Opportunity[] {
    const opportunities: Opportunity[] = [];

    for (const problem of problems) {
      const relatedNeeds = this.findRelatedNeeds(problem, needs);

      for (const need of relatedNeeds) {
        opportunities.push({
          problem: problem.title,
          need: need.need,
          topic: this.selectBestTopic(topics),
          solutionArea: this.inferSolutionArea(
            problem.title,
            need.need,
            keywords,
          ),
          score: this.normalizeScore(
            this.problemScore(problem) +
              this.needScore(need) +
              this.relationshipBoost(problem.title, need.need),
          ),
          evidenceSamples: this.pickEvidenceSamples([
            ...problem.evidenceSamples,
            ...need.evidenceSamples,
          ]),
        });
      }
    }

    return opportunities;
  }

  /**
   * Builds opportunities from problems when explicit needs are missing.
   */
  private buildProblemOnlyOpportunities(
    problems: RecurringProblem[],
    topics: WeightedTopic[],
    keywords: WeightedKeyword[],
  ): Opportunity[] {
    return problems.map((problem) => ({
      problem: problem.title,
      topic: this.selectBestTopic(topics),
      solutionArea: this.inferSolutionArea(problem.title, undefined, keywords),
      score: this.normalizeScore(this.problemScore(problem)),
      evidenceSamples: this.pickEvidenceSamples(problem.evidenceSamples),
    }));
  }

  /**
   * Builds opportunities from needs when explicit problems are missing.
   */
  private buildNeedOnlyOpportunities(
    needs: ExtractedNeed[],
    topics: WeightedTopic[],
    keywords: WeightedKeyword[],
  ): Opportunity[] {
    return needs.map((need) => ({
      need: need.need,
      topic: this.selectBestTopic(topics),
      solutionArea: this.inferSolutionArea(undefined, need.need, keywords),
      score: this.normalizeScore(this.needScore(need)),
      evidenceSamples: this.pickEvidenceSamples(need.evidenceSamples),
    }));
  }

  /**
   * Builds opportunities from dominant topics and keyword trends.
   */
  private buildTopicOpportunities(
    topics: WeightedTopic[],
    keywords: WeightedKeyword[],
  ): Opportunity[] {
    return topics.slice(0, 5).map((topic) => ({
      topic: topic.topic,
      solutionArea: this.inferSolutionArea(topic.topic, undefined, keywords),
      score: this.normalizeScore(Math.min(topic.frequency / 10, 1)),
      evidenceSamples: [],
    }));
  }

  /**
   * Finds needs that are related to a recurring problem.
   */
  private findRelatedNeeds(
    problem: RecurringProblem,
    needs: ExtractedNeed[],
  ): ExtractedNeed[] {
    const relatedNeeds = needs.filter(
      (need) =>
        need.relatedProblem === problem.title ||
        this.hasSharedTerms(problem.title, need.need),
    );

    return relatedNeeds.length > 0 ? relatedNeeds : needs.slice(0, 3);
  }

  /**
   * Infers the most suitable software solution area.
   */
  private inferSolutionArea(
    problem?: string,
    need?: string,
    keywords: WeightedKeyword[] = [],
  ): string {
    const sourceText = [
      problem,
      need,
      ...keywords.slice(0, 5).map((item) => item.keyword),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (this.containsAny(sourceText, ['appointment', 'booking', 'schedule'])) {
      return 'Appointment Management';
    }

    if (this.containsAny(sourceText, ['waiting', 'queue', 'delay'])) {
      return 'Queue Management';
    }

    if (this.containsAny(sourceText, ['notification', 'message', 'update'])) {
      return 'Communication and Notifications';
    }

    if (this.containsAny(sourceText, ['payment', 'cost', 'price', 'fee'])) {
      return 'Payment and Cost Management';
    }

    if (this.containsAny(sourceText, ['access', 'available', 'availability'])) {
      return 'Access and Availability Management';
    }

    if (this.containsAny(sourceText, ['error', 'crash', 'bug', 'reliable'])) {
      return 'Reliability and Performance Improvement';
    }

    return this.toTitleCase(need ?? problem ?? 'Digital Service Improvement');
  }

  /**
   * Selects the strongest discussion topic.
   */
  private selectBestTopic(topics: WeightedTopic[]): string | undefined {
    return topics[0]?.topic;
  }

  /**
   * Calculates a normalized problem score.
   */
  private problemScore(problem: RecurringProblem): number {
    const severityWeight = {
      LOW: 0.3,
      MEDIUM: 0.6,
      HIGH: 1,
    }[problem.severity];

    const frequencyWeight = Math.min(problem.frequency / 10, 1);

    return severityWeight * 0.6 + frequencyWeight * 0.4;
  }

  /**
   * Calculates a normalized need score.
   */
  private needScore(need: ExtractedNeed): number {
    return {
      LOW: 0.3,
      MEDIUM: 0.6,
      HIGH: 1,
    }[need.priority];
  }

  /**
   * Adds a relationship boost when problem and need share terms.
   */
  private relationshipBoost(problem: string, need: string): number {
    return this.hasSharedTerms(problem, need) ? 0.3 : 0;
  }

  /**
   * Merges duplicate opportunities by solution area, problem, and need.
   */
  private mergeSimilarOpportunities(
    opportunities: Opportunity[],
  ): Opportunity[] {
    const opportunityMap = new Map<string, Opportunity>();

    for (const opportunity of opportunities) {
      const key = this.buildOpportunityKey(opportunity);
      const existing = opportunityMap.get(key);

      if (!existing) {
        opportunityMap.set(key, {
          ...opportunity,
          score: this.normalizeScore(opportunity.score),
          evidenceSamples: this.pickEvidenceSamples(
            opportunity.evidenceSamples,
          ),
        });

        continue;
      }

      existing.score = this.normalizeScore(
        existing.score + opportunity.score * 0.25,
      );
      existing.evidenceSamples = this.pickEvidenceSamples([
        ...existing.evidenceSamples,
        ...opportunity.evidenceSamples,
      ]);
    }

    return [...opportunityMap.values()];
  }

  /**
   * Builds a stable key for opportunity deduplication.
   */
  private buildOpportunityKey(opportunity: Opportunity): string {
    return [
      opportunity.problem,
      opportunity.need,
      opportunity.topic,
      opportunity.solutionArea,
    ]
      .filter(Boolean)
      .join('|')
      .toLowerCase()
      .trim();
  }

  /**
   * Checks whether two statements share meaningful terms.
   */
  private hasSharedTerms(first: string, second: string): boolean {
    const firstTerms = this.extractMeaningfulTerms(first);
    const secondTerms = this.extractMeaningfulTerms(second);

    return [...firstTerms].some((term) => secondTerms.has(term));
  }

  /**
   * Extracts meaningful terms from a short statement.
   */
  private extractMeaningfulTerms(value: string): Set<string> {
    const ignoredTerms = new Set([
      'a',
      'an',
      'and',
      'or',
      'the',
      'to',
      'for',
      'of',
      'in',
      'on',
      'with',
      'solution',
      'software',
      'system',
      'service',
      'provide',
      'provides',
      'reduce',
      'address',
    ]);

    return new Set(
      value
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !ignoredTerms.has(term)),
    );
  }

  /**
   * Checks whether text contains any term from a list.
   */
  private containsAny(text: string, terms: string[]): boolean {
    return terms.some((term) => text.includes(term));
  }

  /**
   * Normalizes a score between 0 and 1.
   */
  private normalizeScore(score: number): number {
    return Number(Math.min(score, 1).toFixed(3));
  }

  /**
   * Keeps unique evidence samples within the configured limit.
   */
  private pickEvidenceSamples(samples: string[]): string[] {
    return [
      ...new Set(samples.map((sample) => sample.trim()).filter(Boolean)),
    ].slice(0, this.maxEvidenceSamples);
  }

  /**
   * Converts text into a readable title.
   */
  private toTitleCase(value: string): string {
    return value
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
