import { Injectable } from '@nestjs/common';

import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';

/**
 * Individual deterministic quality issue detected in a generated idea.
 *
 * @author Malak
 */
export type IdeaQualityIssue = {
  readonly code:
    | 'GENERIC_TITLE'
    | 'WEAK_PROBLEM'
    | 'GENERIC_OBJECTIVES'
    | 'WEAK_TARGET_USERS'
    | 'LOW_DIFFERENTIATION'
    | 'LOW_ACTIONABILITY';
  readonly message: string;
  readonly penalty: number;
};

/**
 * Explainable quality dimensions used to compare different AI models.
 * Every score is bounded to the inclusive range 0..100.
 *
 * @author Malak
 */
export type IdeaQualityDimensions = {
  readonly innovation: number;
  readonly marketFit: number;
  readonly technicalQuality: number;
  readonly completeness: number;
  readonly originality: number;
};

/**
 * Deterministic evaluation result used by both quality regeneration and
 * multi-model benchmarking.
 *
 * @author Malak
 */
export type IdeaQualityEvaluation = {
  readonly score: number;
  readonly accepted: boolean;
  readonly dimensions: IdeaQualityDimensions;
  readonly issues: readonly IdeaQualityIssue[];
};

/**
 * Performs deterministic, provider-independent quality evaluation.
 *
 * The same evaluator is applied to every model candidate. This guarantees
 * that Google and OpenRouter-backed models are compared using identical,
 * explainable rules rather than provider-specific preferences.
 *
 * @author Malak
 */
@Injectable()
export class IdeaQualityEvaluatorService {
  private readonly MIN_ACCEPTED_SCORE = 72;

  private readonly GENERIC_TITLE_PATTERNS = [
    /\bmanagement system\b/i,
    /\bmonitoring system\b/i,
    /\breporting system\b/i,
    /\binformation system\b/i,
    /\bapplication system\b/i,
    /\btracking system\b/i,
  ] as const;

  private readonly DIFFERENTIATION_TERMS = [
    'predict',
    'forecast',
    'recommend',
    'optimize',
    'automation',
    'automated',
    'anomaly',
    'risk',
    'personalized',
    'adaptive',
    'intelligent',
    'real-time',
    'decision support',
    'early warning',
    'prioritization',
    'offline',
    'low-bandwidth',
  ] as const;

  private readonly ACTIONABILITY_TERMS = [
    'reduce',
    'increase',
    'detect',
    'prevent',
    'prioritize',
    'alert',
    'recommend',
    'measure',
    'evaluate',
    'compare',
    'predict',
    'automate',
    'optimize',
    'integrate',
    'enable',
    'support',
  ] as const;

  evaluate(output: ParsedIdeaAiOutput): IdeaQualityEvaluation {
    const issues: IdeaQualityIssue[] = [];
    const idea = output.coreIdea;

    const title = this.normalize(idea.title);
    const problem = this.normalize(idea.problemStatement);
    const objectives = idea.objectives.map((value) => this.normalize(value));
    const targetUsers = idea.targetUsers.map((value) => this.normalize(value));
    const completeText = this.normalize(
      [
        idea.title,
        idea.problemStatement,
        ...idea.objectives,
        ...idea.targetUsers,
        idea.limitedAbstract ?? '',
        idea.partialAbstract ?? '',
        idea.fullAbstract ?? '',
      ].join(' '),
    );

    const genericTitle = this.GENERIC_TITLE_PATTERNS.some((pattern) =>
      pattern.test(title),
    );
    const actionableObjectives = objectives.filter((objective) =>
      this.containsAny(objective, this.ACTIONABILITY_TERMS),
    ).length;
    const differentiatorHits = this.countTerms(
      completeText,
      this.DIFFERENTIATION_TERMS,
    );
    const actionabilityHits = this.countTerms(
      completeText,
      this.ACTIONABILITY_TERMS,
    );
    const concreteTargets = targetUsers.filter(
      (targetUser) => targetUser.split(' ').length >= 3,
    ).length;

    if (genericTitle) {
      issues.push({
        code: 'GENERIC_TITLE',
        message:
          'Use a distinctive title that communicates the unique product value instead of only naming a generic system category.',
        penalty: 14,
      });
    }

    if (
      problem.length < 180 ||
      !this.containsAny(problem, [
        'because',
        'which causes',
        'resulting in',
        'making it difficult',
        'leads to',
        'lack',
        'limited',
      ])
    ) {
      issues.push({
        code: 'WEAK_PROBLEM',
        message:
          'State the affected workflow, root cause, consequence, and local context supported by the supplied evidence.',
        penalty: 16,
      });
    }

    if (
      objectives.length < 4 ||
      actionableObjectives < Math.min(3, objectives.length)
    ) {
      issues.push({
        code: 'GENERIC_OBJECTIVES',
        message:
          'Use concrete capabilities, automation, decision support, and measurable outcomes instead of generic CRUD objectives.',
        penalty: 16,
      });
    }

    if (targetUsers.length < 2 || concreteTargets < targetUsers.length) {
      issues.push({
        code: 'WEAK_TARGET_USERS',
        message:
          'Name concrete user roles, organizations, or operational teams rather than broad labels.',
        penalty: 10,
      });
    }

    if (differentiatorHits === 0) {
      issues.push({
        code: 'LOW_DIFFERENTIATION',
        message:
          'Add an evidence-supported differentiator such as prediction, automation, personalization, optimization, offline operation, or real-time decision support.',
        penalty: 18,
      });
    }

    if (actionabilityHits === 0) {
      issues.push({
        code: 'LOW_ACTIONABILITY',
        message:
          'Explain what the product actively changes, detects, prevents, recommends, enables, or optimizes.',
        penalty: 14,
      });
    }

    const dimensions: IdeaQualityDimensions = {
      innovation: this.clamp(
        45 + differentiatorHits * 9 + (genericTitle ? -12 : 8),
      ),
      marketFit: this.clamp(
        35 + Math.min(problem.length / 8, 30) + concreteTargets * 8,
      ),
      technicalQuality: this.clamp(
        40 + actionableObjectives * 9 + Math.min(actionabilityHits, 5) * 4,
      ),
      completeness: this.clamp(
        30 +
          Math.min(objectives.length, 7) * 7 +
          Math.min(targetUsers.length, 4) * 6,
      ),
      originality: this.clamp(
        45 + differentiatorHits * 8 + (genericTitle ? -15 : 10),
      ),
    };

    const weightedScore =
      dimensions.innovation * 0.25 +
      dimensions.marketFit * 0.25 +
      dimensions.technicalQuality * 0.2 +
      dimensions.completeness * 0.15 +
      dimensions.originality * 0.15;

    const issuePenalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
    const score = this.clamp(weightedScore - issuePenalty * 0.35);

    return {
      score,
      accepted: score >= this.MIN_ACCEPTED_SCORE,
      dimensions,
      issues,
    };
  }

  buildImprovementInstructions(evaluation: IdeaQualityEvaluation): string {
    if (evaluation.issues.length === 0) {
      return 'Strengthen specificity, differentiation, actionability, and evidence alignment.';
    }

    return evaluation.issues
      .map((issue, index) => `${index + 1}. ${issue.message}`)
      .join('\n');
  }

  private countTerms(value: string, terms: readonly string[]): number {
    return terms.reduce(
      (count, term) => count + (value.includes(this.normalize(term)) ? 1 : 0),
      0,
    );
  }

  private containsAny(value: string, terms: readonly string[]): boolean {
    return terms.some((term) => value.includes(this.normalize(term)));
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private clamp(value: number): number {
    return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
  }
}
