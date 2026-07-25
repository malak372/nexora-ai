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
    | 'UNSUPPORTED_LOCAL_CLAIM'
    | 'LOW_DIFFERENTIATION'
    | 'LOW_ACTIONABILITY'
    | 'NARROW_INTERMEDIARY_PRODUCT'
    | 'UNCLEAR_ADOPTION_PATH'
    | 'WEAK_BUDGET_ESTIMATION'
    | 'INACCURATE_NLP_SUMMARY';
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

/** Trusted metrics used to validate generated premium summaries. */
export type IdeaQualityEvaluationContext = {
  readonly totalTextsAnalyzed?: number;
  readonly totalPostsAnalyzed?: number;
  readonly totalCommentsAnalyzed?: number;
  readonly requireAdvancedOutputs?: boolean;
  readonly targetCountry?: string | null;
  readonly targetCity?: string | null;
  readonly targetRegion?: string | null;
  readonly localEvidenceVerified?: boolean;
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
  private readonly MIN_ACCEPTED_SCORE = 70;

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

  private readonly INTERMEDIARY_PRODUCT_TERMS = [
    'gateway',
    'proxy',
    'wrapper',
    'middleware',
    'connector',
    'plugin',
    'integration layer',
    'authentication layer',
  ] as const;

  private readonly STANDALONE_VALUE_TERMS = [
    'workspace',
    'continuity',
    'recovery',
    'orchestration',
    'workflow',
    'collaboration',
    'case management',
    'decision support',
    'resource planning',
    'operational analytics',
    'service management',
    'learning progress',
  ] as const;

  private readonly ADOPTION_TERMS = [
    'buyer',
    'customer',
    'subscription',
    'license',
    'institution',
    'university',
    'school',
    'organization',
    'department',
    'administrator',
    'it team',
    'operations team',
    'enterprise',
    'procurement',
    'deploy',
    'adopt',
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

  evaluate(
    output: ParsedIdeaAiOutput,
    context: IdeaQualityEvaluationContext = {},
  ): IdeaQualityEvaluation {
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
        ...output.advancedOutputs.map(
          (advancedOutput) => advancedOutput.content,
        ),
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
    const intermediaryHits = this.countTerms(
      this.normalize(
        [
          idea.title,
          idea.fullAbstract ?? '',
          idea.partialAbstract ?? '',
          idea.limitedAbstract ?? '',
        ].join(' '),
      ),
      this.INTERMEDIARY_PRODUCT_TERMS,
    );
    const standaloneValueHits = this.countTerms(
      completeText,
      this.STANDALONE_VALUE_TERMS,
    );
    const adoptionHits = this.countTerms(completeText, this.ADOPTION_TERMS);
    const isNarrowIntermediaryProduct =
      intermediaryHits > 0 && standaloneValueHits < 2;

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

    if (this.hasUnsupportedLocalClaim(output, context)) {
      issues.push({
        code: 'UNSUPPORTED_LOCAL_CLAIM',
        message:
          'Do not claim that users or institutions in the target location currently face the discovered problem unless the supplied evidence is locally verified. Describe the evidence-backed problem generally and state that the product is designed or proposed for deployment in the target location.',
        penalty: 24,
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

    if (isNarrowIntermediaryProduct) {
      issues.push({
        code: 'NARROW_INTERMEDIARY_PRODUCT',
        message:
          'Redesign the idea around a durable user or organizational outcome. A gateway, proxy, wrapper, connector, plugin, or middleware layer should be a supporting capability unless it has clear standalone customer value.',
        penalty: 18,
      });
    }

    if (context.requireAdvancedOutputs && adoptionHits < 2) {
      issues.push({
        code: 'UNCLEAR_ADOPTION_PATH',
        message:
          'Identify a credible buyer or sponsor, adoption trigger, repeatable deployment path, and measurable organizational reason to purchase or adopt the product.',
        penalty: 14,
      });
    }

    if (context.requireAdvancedOutputs) {
      const budget = this.findAdvancedOutput(output, 'budget-estimation');
      const nlpSummary = this.findAdvancedOutput(
        output,
        'nlp-executive-summary',
      );

      if (!budget || !this.hasUsefulBudgetEstimate(budget)) {
        issues.push({
          code: 'WEAK_BUDGET_ESTIMATION',
          message:
            'Provide an explicitly labeled preliminary budget with a currency, numeric range, major cost categories, and assumptions instead of vague cost wording.',
          penalty: 12,
        });
      }

      if (!nlpSummary || !this.hasAccurateNlpCounts(nlpSummary, context)) {
        issues.push({
          code: 'INACCURATE_NLP_SUMMARY',
          message:
            'State the exact trusted NLP totals: total analyzed texts, analyzed posts, and analyzed comments. Do not merge comments and posts into one incorrect count.',
          penalty: 12,
        });
      }
    }

    const dimensions: IdeaQualityDimensions = {
      innovation: this.clamp(
        45 + differentiatorHits * 9 + (genericTitle ? -12 : 8),
      ),
      marketFit: this.clamp(
        35 +
          Math.min(problem.length / 8, 30) +
          concreteTargets * 8 +
          Math.min(adoptionHits, 4) * 3 +
          (isNarrowIntermediaryProduct ? -12 : 0),
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
        45 +
          differentiatorHits * 8 +
          Math.min(standaloneValueHits, 4) * 3 +
          (genericTitle ? -15 : 10) +
          (isNarrowIntermediaryProduct ? -10 : 0),
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
    const hasBlockingIssue = issues.some(
      (issue) => issue.code === 'UNSUPPORTED_LOCAL_CLAIM',
    );

    return {
      score,
      accepted: score >= this.MIN_ACCEPTED_SCORE && !hasBlockingIssue,
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

  /**
   * Detects definitive target-location claims that are not backed by local
   * source metadata.
   *
   * The requested city, region, and country are deployment constraints. They
   * cannot be converted into proof that a local population currently suffers
   * from a problem discovered in globally collected store or community data.
   */
  private hasUnsupportedLocalClaim(
    output: ParsedIdeaAiOutput,
    context: IdeaQualityEvaluationContext,
  ): boolean {
    if (context.localEvidenceVerified) {
      return false;
    }

    const locations = [
      context.targetCity,
      context.targetRegion,
      context.targetCountry,
    ]
      .map((value) => this.normalize(value ?? ''))
      .filter((value) => value.length >= 3);

    if (locations.length === 0) {
      return false;
    }

    const idea = output.coreIdea;
    const claimText = this.normalize(
      [
        idea.problemStatement,
        idea.limitedAbstract ?? '',
        idea.partialAbstract ?? '',
        idea.fullAbstract ?? '',
      ].join(' '),
    );

    return locations.some((location) => {
      const escapedLocation = this.escapeRegExp(location);
      const affectedActor =
        '(?:students?|faculty|teachers?|learners?|users?|institutions?|universities|colleges|schools|administrators?|businesses|residents|organizations?)';
      const definitiveProblemVerb =
        "(?:face|faces|facing|encounter|encounters|experience|experiences|suffer|suffers|struggle|struggles|lack|lacks|report|reports|cannot|can't|are unable to|is unable to)";
      const actorThenLocation = new RegExp(
        `\\b${affectedActor}\\b[^.!?]{0,100}\\b(?:in|within|across|from)\\s+${escapedLocation}\\b[^.!?]{0,100}\\b${definitiveProblemVerb}\\b`,
        'iu',
      );
      const locationThenActor = new RegExp(
        `\\b${escapedLocation}\\b[^.!?]{0,100}\\b${affectedActor}\\b[^.!?]{0,100}\\b${definitiveProblemVerb}\\b`,
        'iu',
      );
      const inLocationClaim = new RegExp(
        `\\b(?:in|within|across)\\s+${escapedLocation}\\b[^.!?]{0,140}\\b${definitiveProblemVerb}\\b`,
        'iu',
      );

      return (
        actorThenLocation.test(claimText) ||
        locationThenActor.test(claimText) ||
        inLocationClaim.test(claimText)
      );
    });
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private findAdvancedOutput(
    output: ParsedIdeaAiOutput,
    outputKey: ParsedIdeaAiOutput['advancedOutputs'][number]['outputKey'],
  ): string | null {
    return (
      output.advancedOutputs.find((item) => item.outputKey === outputKey)
        ?.content ?? null
    );
  }

  private hasUsefulBudgetEstimate(value: string): boolean {
    const normalized = this.normalize(value);
    const hasCurrency = /(?:\$|€|£|₪|\busd\b|\beur\b|\bils\b|\bnis\b)/iu.test(
      value,
    );
    const hasNumericRange =
      /\b\d[\d,]*(?:\.\d+)?\s*(?:-|–|to)\s*\d[\d,]*(?:\.\d+)?\b/iu.test(value);
    const hasAssumptionLanguage =
      /\b(?:estimate|estimated|preliminary|assumption|assumes|range|excluding|includes)\b/iu.test(
        normalized,
      );
    const hasCostCategories =
      /\b(?:development|infrastructure|hosting|testing|deployment|maintenance|integration|contingency)\b/iu.test(
        normalized,
      );

    return (
      hasCurrency &&
      hasNumericRange &&
      hasAssumptionLanguage &&
      hasCostCategories
    );
  }

  private hasAccurateNlpCounts(
    value: string,
    context: IdeaQualityEvaluationContext,
  ): boolean {
    const totalTexts = context.totalTextsAnalyzed;
    const totalPosts = context.totalPostsAnalyzed;
    const totalComments = context.totalCommentsAnalyzed;

    if (
      totalTexts === undefined ||
      totalPosts === undefined ||
      totalComments === undefined
    ) {
      return true;
    }

    return (
      this.containsLabeledCount(value, totalTexts, 'texts?') &&
      this.containsLabeledCount(value, totalPosts, 'posts?') &&
      this.containsLabeledCount(value, totalComments, 'comments?')
    );
  }

  /** Verifies that one trusted count is attached to its correct metric label. */
  private containsLabeledCount(
    value: string,
    number: number,
    labelPattern: string,
  ): boolean {
    const numberThenLabel = new RegExp(
      `\\b${number}\\b\\s+(?:analyzed\\s+)?${labelPattern}\\b`,
      'iu',
    );
    const labelThenNumber = new RegExp(
      `\\b${labelPattern}\\b\\s*[:=-]?\\s*${number}\\b`,
      'iu',
    );

    return numberThenLabel.test(value) || labelThenNumber.test(value);
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
