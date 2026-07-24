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
    const evidenceBackedProblems = problems.filter(
      (problem) => problem.evidenceSamples.length > 0,
    );
    const evidenceBackedNeeds = needs.filter(
      (need) => need.evidenceSamples.length > 0,
    );
    const opportunities: Opportunity[] = [
      ...this.buildProblemNeedOpportunities(
        evidenceBackedProblems,
        evidenceBackedNeeds,
        topics,
        keywords,
      ),
      ...this.buildUnmatchedProblemOpportunities(
        evidenceBackedProblems,
        evidenceBackedNeeds,
        topics,
        keywords,
      ),
      ...this.buildUnmatchedNeedOpportunities(
        evidenceBackedProblems,
        evidenceBackedNeeds,
        topics,
        keywords,
      ),
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
          topic: this.selectBestTopic(topics, `${problem.title} ${need.need}`),
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

  /** Builds problem-only opportunities only when no related need exists. */
  private buildUnmatchedProblemOpportunities(
    problems: RecurringProblem[],
    needs: ExtractedNeed[],
    topics: WeightedTopic[],
    keywords: WeightedKeyword[],
  ): Opportunity[] {
    return problems
      .filter((problem) => this.findRelatedNeeds(problem, needs).length === 0)
      .map((problem) => ({
        problem: problem.title,
        topic: this.selectBestTopic(topics, problem.title),
        solutionArea: this.inferSolutionArea(
          problem.title,
          undefined,
          keywords,
        ),
        score: this.normalizeScore(this.problemScore(problem)),
        evidenceSamples: this.pickEvidenceSamples(problem.evidenceSamples),
      }));
  }

  /** Builds need-only opportunities only when no recurring problem matches. */
  private buildUnmatchedNeedOpportunities(
    problems: RecurringProblem[],
    needs: ExtractedNeed[],
    topics: WeightedTopic[],
    keywords: WeightedKeyword[],
  ): Opportunity[] {
    return needs
      .filter(
        (need) =>
          !problems.some(
            (problem) =>
              need.relatedProblem === problem.title ||
              this.hasSharedTerms(problem.title, need.need),
          ),
      )
      .map((need) => ({
        need: need.need,
        topic: this.selectBestTopic(topics, need.need),
        solutionArea: this.inferSolutionArea(undefined, need.need, keywords),
        score: this.normalizeScore(this.needScore(need)),
        evidenceSamples: this.pickEvidenceSamples(need.evidenceSamples),
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

    return relatedNeeds;
  }

  /**
   * Infers the most suitable software solution area.
   */
  private inferSolutionArea(
    problem?: string,
    need?: string,
    keywords: WeightedKeyword[] = [],
  ): string {
    /*
     * Problem and need labels are authoritative. Global keywords are consulted
     * only when those labels do not identify a workflow. This prevents one
     * frequent keyword such as "computer" from incorrectly converting every
     * opportunity into "Cross-Device Learning Access".
     */
    const primaryText = [problem, need]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    const keywordText = keywords
      .slice(0, 8)
      .map((item) => item.keyword)
      .join(' ')
      .toLocaleLowerCase();

    return (
      this.matchSolutionArea(primaryText) ??
      this.matchSolutionArea(keywordText) ??
      this.toTitleCase(need ?? problem ?? 'Digital Service Improvement')
    );
  }

  /** Maps one normalized workflow description to a stable solution area. */
  private matchSolutionArea(sourceText: string): string | null {
    if (!sourceText) {
      return null;
    }

    if (
      this.containsAny(sourceText, [
        'activation',
        'verification',
        'authentication',
        'login',
        'sign in',
        'account',
        'session',
        'otp',
        'receive email',
      ])
    ) {
      return 'Account Activation and Authentication Recovery';
    }

    if (
      this.containsAny(sourceText, [
        'document',
        'download',
        'syllabus',
        'file access',
        'broken link',
        'null error',
      ])
    ) {
      return 'Document Access and Download Reliability';
    }

    if (
      this.containsAny(sourceText, [
        'data loss',
        'lost progress',
        'missing history',
        'synchronization',
        'sync',
        'recovery',
      ])
    ) {
      return 'Learning Data Synchronization and Recovery';
    }

    if (
      this.containsAny(sourceText, [
        'navigation',
        'interface',
        'confusing',
        'usability',
        'back button',
        'scroll',
        'popup',
      ])
    ) {
      return 'Navigation and Usability Improvement';
    }

    if (
      this.containsAny(sourceText, [
        'desktop',
        'laptop',
        'computer',
        'cross-device',
        'cross device',
        'mobile only',
      ])
    ) {
      return 'Cross-Device Learning Access';
    }

    if (
      this.containsAny(sourceText, [
        'crash',
        'freeze',
        'instability',
        'reliability',
        'glitch',
        'slow',
        'error loop',
      ])
    ) {
      return 'Application Reliability and Performance Recovery';
    }

    if (
      this.containsAny(sourceText, [
        'payment',
        'cost',
        'price',
        'fee',
        'paywall',
        'subscription',
      ])
    ) {
      return 'Pricing and Access Management';
    }

    if (this.containsAny(sourceText, ['appointment', 'booking', 'schedule'])) {
      return 'Appointment Management';
    }

    if (this.containsAny(sourceText, ['waiting', 'queue', 'delay'])) {
      return 'Queue Management';
    }

    if (this.containsAny(sourceText, ['notification', 'message', 'update'])) {
      return 'Communication and Notifications';
    }

    if (this.containsAny(sourceText, ['access', 'available', 'availability'])) {
      return 'Access and Availability Management';
    }

    return null;
  }

  /**
   * Selects the strongest discussion topic.
   */
  private selectBestTopic(
    topics: WeightedTopic[],
    context: string,
  ): string | undefined {
    const normalizedContext = context.toLocaleLowerCase();
    const related = topics.find((topic) =>
      this.hasSharedTerms(topic.topic, normalizedContext),
    );

    return related?.topic ?? topics[0]?.topic;
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
      this.canonicalOpportunityLabel(opportunity.solutionArea),
      this.canonicalOpportunityLabel(
        opportunity.problem ?? opportunity.need ?? opportunity.topic,
      ),
    ]
      .filter(Boolean)
      .join('|')
      .toLowerCase()
      .trim();
  }

  private canonicalOpportunityLabel(value?: string): string {
    const normalized = value?.toLocaleLowerCase().trim() ?? '';

    // Match concrete workflows before generic terms such as "failure".
    if (
      /document|download|syllabus|file access|broken link/iu.test(normalized)
    ) {
      return 'document access';
    }

    if (/data loss|sync|synchronization|recovery/iu.test(normalized)) {
      return 'data synchronization recovery';
    }

    if (
      /desktop|laptop|computer|cross-device|cross device/iu.test(normalized)
    ) {
      return 'cross device access';
    }

    if (
      /activation|verification|login|authentication|account/iu.test(normalized)
    ) {
      return 'account access';
    }

    if (
      /navigation|interface|usability|back button|scroll|popup/iu.test(
        normalized,
      )
    ) {
      return 'navigation usability';
    }

    if (/cost|price|paywall|paid|subscription/iu.test(normalized)) {
      return 'pricing access restrictions';
    }

    if (
      /crash|reliability|instability|freeze|generic error/iu.test(normalized)
    ) {
      return 'application reliability';
    }

    return normalized;
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
