import { Injectable } from '@nestjs/common';
import { IDEA_MIN_ACCEPTED_QUALITY_SCORE } from '../constants/idea-generation.constants';
import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { RequestCapabilityContractUtil } from '../utils/request-capability-contract.util';
import {
  ExplicitDomainCapabilityCoverageUtil,
  type ExplicitDomainCoverageContract,
} from '../utils/explicit-domain-capability-coverage.util';

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
    | 'UNSUPPORTED_PLATFORM_ACCESS'
    | 'MALFORMED_MEASURABLE_TARGET'
    | 'UNSUPPORTED_IMPACT_TARGET'
    | 'UNSUPPORTED_ROOT_CAUSE'
    | 'UNSUPPORTED_CONFIGURATION_STORAGE_ASSUMPTION'
    | 'COMMON_TITLE_MISSPELLING'
    | 'LOW_DIFFERENTIATION'
    | 'LOW_ACTIONABILITY'
    | 'NARROW_INTERMEDIARY_PRODUCT'
    | 'UNCLEAR_ADOPTION_PATH'
    | 'WEAK_BUDGET_ESTIMATION'
    | 'OVER_SCOPED_MVP'
    | 'UNSUPPORTED_MARKET_GENERALIZATION'
    | 'INACCURATE_NLP_SUMMARY'
    | 'AWKWARD_PRODUCT_COPY'
    | 'NO_DIRECT_EVIDENCE'
    | 'REQUEST_SCOPE_TITLE_DRIFT'
    | 'CATASTROPHIC_REQUEST_SCOPE_DRIFT'
    | 'REQUESTER_CONCRETE_FACET_MISSING'
    | 'REQUESTED_CAPABILITY_MISSING'
    | 'EXPLICIT_DOMAIN_COVERAGE_MISSING'
    | 'SECONDARY_DOMAIN_LEAKAGE'
    | 'WRONG_OUTPUT_LANGUAGE';
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
  /** Product-design quality, independent from evidence density. */
  readonly score: number;
  readonly productQualityScore: number;
  /** Strength of external validation; separate from product design quality. */
  readonly evidenceStrengthScore: number;
  readonly evidenceValidated: boolean;
  readonly accepted: boolean;
  /** Exact deterministic reasons the candidate did not pass acceptance. */
  readonly acceptanceFailureReasons: readonly string[];
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
  readonly directEvidenceCount?: number;
  readonly externalSupportingEvidenceCount?: number;
  readonly verifiedIndependentSourceCount?: number;
  readonly requesterDescription?: string | null;
  readonly requesterFacetDescription?: string | null;
  readonly requesterDesiredOutcome?: string | null;
  readonly outputLanguage?: string;
  readonly allowZeroEvidenceValidationCandidate?: boolean;
  readonly primaryDomainName?: string | null;
  readonly secondaryDomainNames?: readonly string[];
  readonly requiredDomainNames?: readonly string[];
  readonly requiredDomains?: readonly ExplicitDomainCoverageContract[];
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
    if (
      context.outputLanguage &&
      context.outputLanguage !== 'EN' &&
      context.outputLanguage !== 'ANY'
    ) {
      return this.evaluateLocalizedOutput(output, context);
    }

    const issues: IdeaQualityIssue[] = [];
    const idea = output.coreIdea;

    const title = this.normalize(idea.title);
    const hasCommonTitleMisspelling =
      /\bresiliant\b/iu.test(idea.title) ||
      /\brecieve\b/iu.test(idea.title) ||
      /\bseperate\b/iu.test(idea.title) ||
      /\boccured\b/iu.test(idea.title);
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

    const pipelineScaffoldTitle =
      /\b(?:cross[- ]domain|multi[- ]domain|request validation|validation pilot|evidence validation|opportunity discovery|requester[- ]defined workflow opportunity|connected workflow opportunity discovery|primary domain|preliminary pilot|validation)\b|\s\+\s/iu.test(
        title,
      );
    const genericTitle =
      pipelineScaffoldTitle ||
      this.GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(title));
    const actionableObjectives = objectives.filter((objective) =>
      this.isConcreteActionableObjective(objective),
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
    const hasUnsupportedPlatformAccess =
      this.hasUnsupportedPlatformAccess(output);
    const hasMalformedMeasurableTarget = this.hasMalformedMeasurableTarget(
      idea.objectives,
    );
    const hasAwkwardProductCopy = this.hasAwkwardProductCopy(output);

    if (genericTitle) {
      issues.push({
        code: 'GENERIC_TITLE',
        message:
          'Use a distinctive public-facing product title that communicates the product value. Do not expose internal pipeline labels such as Cross-Domain, Validation, Request Validation, Validation Pilot, Evidence Validation, Opportunity Discovery, or a plus-sign-joined domain list.',
        penalty: 14,
      });
    }

    if (
      context.requesterDescription?.trim() &&
      this.hasRequestScopeTitleDrift(
        idea.title,
        context.requesterDescription,
      )
    ) {
      issues.push({
        code: 'REQUEST_SCOPE_TITLE_DRIFT',
        message:
          "Keep the public-facing title centered on the requester's actual operational problem. Do not let a narrow sub-signal such as billing or payment recovery replace a broader transit-security, public-spending, or commission-versioning workflow.",
        penalty: 20,
      });
    }

    const requesterDescription = context.requesterDescription?.trim() ?? '';
    const strictWorkflowIdentityRequired =
      RequestEvidenceAlignmentUtil.requiresStrictWorkflowIdentity({
        requestDescription: requesterDescription,
      });
    const strictWorkflowAligned =
      !strictWorkflowIdentityRequired ||
      RequestEvidenceAlignmentUtil.isAligned({
        requestDescription: requesterDescription,
        evidenceText: [
          idea.title,
          idea.problemStatement,
          ...idea.objectives,
          ...idea.targetUsers,
          idea.fullAbstract ?? '',
          idea.partialAbstract ?? '',
          idea.limitedAbstract ?? '',
        ].join(' '),
      });
    if (requesterDescription && strictWorkflowIdentityRequired && !strictWorkflowAligned) {
      issues.push({
        code: 'CATASTROPHIC_REQUEST_SCOPE_DRIFT',
        message:
          "The generated product left the requester's concrete actor/vertical or workflow identity. Reject this candidate instead of substituting a better-evidenced problem from a nearby or incidental domain.",
        penalty: 100,
      });
    }

    const candidateNarrative = [
      idea.title,
      idea.problemStatement,
      ...idea.objectives,
      ...idea.targetUsers,
      idea.limitedAbstract ?? '',
      idea.partialAbstract ?? '',
      idea.fullAbstract ?? '',
      ...output.advancedOutputs.map((item) => item.content),
    ].join(' ');
    const missingRequesterFacets = this.resolveMissingRequesterConcreteFacets(
      context.requesterFacetDescription ?? requesterDescription,
      candidateNarrative,
    );
    if (missingRequesterFacets.length > 0) {
      issues.push({
        code: 'REQUESTER_CONCRETE_FACET_MISSING',
        message: `The candidate dropped concrete requester-owned workflow/data/problem facets. Keep these facets active in the product instead of replacing them with a narrower supporting-evidence workflow: ${missingRequesterFacets.join('; ')}.`,
        penalty: 100,
      });
    }
    const missingRequestedCapabilities = this.resolveMissingRequestedCapabilities(
      context.requesterDesiredOutcome,
      candidateNarrative,
    );
    if (missingRequestedCapabilities.length > 0) {
      issues.push({
        code: 'REQUESTED_CAPABILITY_MISSING',
        message: `Preserve every concrete requester-requested operation in the generated product before accepting the candidate. Missing active capabilities: ${missingRequestedCapabilities.join(', ')}.`,
        penalty: 100,
      });
    }

    const requiredDomains =
      context.requiredDomains ??
      (context.requiredDomainNames ?? []).map((name) => ({
        name,
        keywords: [] as readonly string[],
      }));
    const missingRequiredDomains =
      ExplicitDomainCapabilityCoverageUtil.resolveMissing(
        requiredDomains,
        candidateNarrative,
      );
    if (missingRequiredDomains.length > 0) {
      issues.push({
        code: 'EXPLICIT_DOMAIN_COVERAGE_MISSING',
        message: `The candidate omitted technically meaningful coverage for explicitly selected requester domains: ${missingRequiredDomains.join(', ')}. Generate the domains correctly in Core instead of relying on late narrative repair.`,
        penalty: 100,
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
        // Qualified pilot language is intentionally accepted here. The
        // generator is required to avoid inventing a confirmed root cause, so
        // strong problem statements often say "potential contributing
        // factors" while still naming the observed bottleneck/friction.
        'potential contributing factors',
        'workflow friction',
        'operational friction',
        'bottleneck',
        'bottlenecks',
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

    if (hasUnsupportedPlatformAccess) {
      issues.push({
        code: 'UNSUPPORTED_PLATFORM_ACCESS',
        message:
          "Replace unsupported cross-application access with a concrete platform-compliant integration. A standalone app cannot read or validate another app's receipts, private logs, secure storage, subscription status, entitlements, or authentication session; it also cannot bypass regional MFA or make a third-party host application recognize a session. Use a host-integrated SDK/vendor backend or supported OAuth/identity-provider integration when the host adopts the solution. Otherwise use a user-authorized diagnostic, compatibility-check, export/import, or recovery-guidance workflow that does not change the host application's protected state.",
        penalty: 30,
      });
    }

    if (hasCommonTitleMisspelling) {
      issues.push({
        code: 'COMMON_TITLE_MISSPELLING',
        message:
          'Correct common English spelling errors in the product title before returning the candidate. For example, use "Resilient" rather than "Resiliant". Keep the corrected spelling consistent in the title, abstracts, architecture, and generated outputs.',
        penalty: 18,
      });
    }

    if (hasMalformedMeasurableTarget) {
      issues.push({
        code: 'MALFORMED_MEASURABLE_TARGET',
        message:
          'Remove malformed percentage wording. Prefer a non-numeric pilot objective that establishes a baseline first, identifies the metric and measurement method, and then evaluates directional improvement during a defined period.',
        penalty: 20,
      });
    }

    if (hasAwkwardProductCopy) {
      issues.push({
        code: 'AWKWARD_PRODUCT_COPY',
        message:
          'Rewrite awkward product copy in natural, publication-ready English. Use “a unified primary user workflow” when related actions form one end-to-end job, and use “common navigation friction” or “recurring navigation friction” instead of malformed wording such as “commonly navigation friction”.',
        penalty: 8,
      });
    }

    if (this.hasUnsupportedImpactTarget(output)) {
      issues.push({
        code: 'UNSUPPORTED_IMPACT_TARGET',
        message:
          'Remove the invented numeric percentage. Unless the supplied evidence explicitly contains a validated baseline and prior measured result, write the objective as: establish a baseline during the first pilot phase, then measure whether the selected metric improves during the remaining pilot period.',
        penalty: 18,
      });
    }

    if (this.hasUnsupportedRootCauseClaim(output)) {
      issues.push({
        code: 'UNSUPPORTED_ROOT_CAUSE',
        message:
          'Keep the observed symptom separate from the inferred diagnosis. Describe token drift, session mismatch, database inconsistency, network failure, or any other root cause as suspected or plausible and explicitly require pilot validation unless the supplied evidence proves causation.',
        penalty: 18,
      });
    }

    if (this.hasUnsupportedConfigurationStorageAssumption(output)) {
      issues.push({
        code: 'UNSUPPORTED_CONFIGURATION_STORAGE_ASSUMPTION',
        message:
          'Do not imply that paywall, entitlement, or taxonomy rules are always available in local JSON, YAML, or XML files. Limit static analysis to host projects that explicitly expose supported configuration schemas, and describe backend databases, remote feature-flag services, application code, subscription APIs, and CMS rules as separate adapters or validation targets.',
        penalty: 16,
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
      const mvpFeatures = this.findAdvancedOutput(output, 'mvp-features');
      const marketPotential = this.findAdvancedOutput(
        output,
        'market-potential',
      );

      if (!budget || !this.hasUsefulBudgetEstimate(budget)) {
        issues.push({
          code: 'WEAK_BUDGET_ESTIMATION',
          message:
            'Provide an explicitly labeled preliminary budget with a currency, numeric range, major cost categories, and assumptions instead of vague cost wording.',
          penalty: 12,
        });
      }

      if (mvpFeatures && this.hasOverScopedMvp(mvpFeatures, output)) {
        issues.push({
          code: 'OVER_SCOPED_MVP',
          message:
            'Reduce the six-month MVP to one primary integration, one simple backend workflow, one basic report or dashboard, and manual remediation guidance. For sparse evidence, move Redis, automatic reproduction-script generation, generated test cases, autonomous code suggestions, advanced exports, and broad CI/CD enforcement to post-MVP.',
          penalty: 16,
        });
      }

      if (
        marketPotential &&
        this.hasUnsupportedMarketGeneralization(marketPotential)
      ) {
        issues.push({
          code: 'UNSUPPORTED_MARKET_GENERALIZATION',
          message:
            'Qualify market potential as an inference from the observed case. Do not call the need common, substantial, widespread, recurring, or market-proven when the supplied evidence contains only one direct report.',
          penalty: 14,
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

    const directEvidenceCount = Math.max(
      0,
      context.directEvidenceCount ?? context.totalTextsAnalyzed ?? 0,
    );
    const externalSupportingEvidenceCount = Math.max(
      0,
      context.externalSupportingEvidenceCount ?? 0,
    );
    const hasNoDirectEvidence = directEvidenceCount === 0;
    const requesterProblemProvided = Boolean(context.requesterDescription?.trim());
    const evidenceValidated =
      directEvidenceCount > 0 || externalSupportingEvidenceCount > 0;
    const verifiedIndependentSourceCount = Math.max(
      0,
      context.verifiedIndependentSourceCount ?? 0,
    );
    const evidenceStrengthScore = this.clamp(
      directEvidenceCount > 0
        ? 68 +
            Math.min(20, directEvidenceCount * 7) +
            Math.min(12, verifiedIndependentSourceCount * 4)
        : externalSupportingEvidenceCount > 0
          ? 34 +
              Math.min(24, externalSupportingEvidenceCount * 8) +
              Math.min(12, verifiedIndependentSourceCount * 4)
          : 8,
    );

    if (hasNoDirectEvidence) {
      issues.push({
        code: 'NO_DIRECT_EVIDENCE',
        message:
          externalSupportingEvidenceCount > 0
            ? 'No direct community complaint was retained, but at least one real external supporting problem signal exists. Keep the candidate preliminary and do not claim recurrence or market-wide demand.'
            : 'No direct community evidence was retained. The candidate may continue only as a clearly labeled validation hypothesis and must not receive a market-fit pass.',
        penalty: externalSupportingEvidenceCount > 0 ? 18 : 35,
      });
    }

    const secondaryDomainLeakage = (context.secondaryDomainNames ?? []).some(
      (domain) =>
        domain.trim().length > 0 &&
        new RegExp(`\\b${this.escapeRegExp(domain.trim())}\\b`, 'iu').test(
          [
            output.coreIdea.problemStatement,
            output.coreIdea.partialAbstract,
            output.coreIdea.fullAbstract,
          ].join(' '),
        ),
    );

    if (!evidenceValidated && secondaryDomainLeakage) {
      issues.push({
        code: 'SECONDARY_DOMAIN_LEAKAGE',
        message:
          'With zero retained direct or supporting evidence, keep the fallback strictly inside the authoritative final claim-domain set and remove only selected domains that are outside that set.',
        penalty: 20,
      });
    }

    /*
     * Product design and evidence density remain separate axes, but the
     * dimension named MARKET FIT must not report 92-100 when the canonical
     * ledger contains zero trusted problem signals. A requester-written problem
     * can still score highly for specificity, technical quality, completeness,
     * and originality; its market-fit dimension stays explicitly provisional
     * until external demand is retained. This fixes the misleading
     * `marketFitScore=100` + `verifiedEvidenceCount=0` snapshots without
     * lowering the global quality gate.
     */
    const independentSourceCount = Math.max(
      0,
      context.verifiedIndependentSourceCount ?? 0,
    );
    const marketFitEvidenceCap = hasNoDirectEvidence
      ? externalSupportingEvidenceCount > 0
        ? requesterProblemProvided
          ? 80
          : 74
        : requesterProblemProvided
          ? 64
          : 35
      : directEvidenceCount === 1
        ? independentSourceCount >= 2
          ? 92
          : 86
        : independentSourceCount >= 2
          ? 100
          : 94;

    const productMarketFitScore = this.clamp(
      35 +
        Math.min(problem.length / 8, 30) +
        concreteTargets * 8 +
        Math.min(adoptionHits, 4) * 3 +
        (isNarrowIntermediaryProduct ? -12 : 0),
    );

    const dimensions: IdeaQualityDimensions = {
      innovation: this.clamp(
        45 + differentiatorHits * 9 + (genericTitle ? -12 : 8),
      ),
      /*
       * The public market-fit dimension is evidence-aware: it must never look
       * validated when the canonical ledger is empty. Product design quality,
       * however, is scored against the requester-owned job using the uncapped
       * productMarketFitScore below. This keeps external validation honest
       * without turning a well-designed Text Only/Text+Domains product into a
       * 50-point candidate merely because bounded collection found no evidence.
       */
      marketFit: this.clamp(
        Math.min(marketFitEvidenceCap, productMarketFitScore),
      ),
      technicalQuality: this.clamp(
        40 +
          actionableObjectives * 9 +
          Math.min(actionabilityHits, 5) * 4 -
          (hasUnsupportedPlatformAccess ? 30 : 0),
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

    const evidenceAwareWeightedScore =
      dimensions.innovation * 0.25 +
      dimensions.marketFit * 0.25 +
      dimensions.technicalQuality * 0.2 +
      dimensions.completeness * 0.15 +
      dimensions.originality * 0.15;
    const productWeightedScore =
      dimensions.innovation * 0.25 +
      productMarketFitScore * 0.25 +
      dimensions.technicalQuality * 0.2 +
      dimensions.completeness * 0.15 +
      dimensions.originality * 0.15;

    /*
     * Product quality and evidence strength are independent axes. A requester
     * may provide a clear problem that has zero retained external evidence
     * inside the bounded collection window; that weakens validation, not the
     * software design. Discovery-only modes still require trusted evidence
     * before a concrete problem can be accepted.
     */
    const productIssuePenalty = issues
      .filter((issue) => issue.code !== 'NO_DIRECT_EVIDENCE')
      .reduce((sum, issue) => sum + issue.penalty, 0);
    const hasCatastrophicRequestDrift = issues.some(
      (issue) => issue.code === 'CATASTROPHIC_REQUEST_SCOPE_DRIFT',
    );
    const productQualityScore = hasCatastrophicRequestDrift
      ? Math.min(19, this.clamp(productWeightedScore - productIssuePenalty * 0.18))
      : this.clamp(productWeightedScore - productIssuePenalty * 0.18);
    // Kept explicit for diagnostics/debugging: this is the evidence-aware
    // weighted view represented by the published dimensions, not the product
    // acceptance score.
    void evidenceAwareWeightedScore;
    const evidenceGateSatisfied =
      evidenceValidated ||
      (requesterProblemProvided &&
        context.allowZeroEvidenceValidationCandidate === true);
    const blockingIssueCodes = issues
      .filter(
        (issue) =>
          issue.code === 'UNSUPPORTED_LOCAL_CLAIM' ||
          issue.code === 'UNSUPPORTED_PLATFORM_ACCESS' ||
          issue.code === 'MALFORMED_MEASURABLE_TARGET' ||
          issue.code === 'UNSUPPORTED_IMPACT_TARGET' ||
          issue.code === 'COMMON_TITLE_MISSPELLING' ||
          issue.code === 'SECONDARY_DOMAIN_LEAKAGE' ||
          issue.code === 'CATASTROPHIC_REQUEST_SCOPE_DRIFT' ||
          issue.code === 'REQUESTER_CONCRETE_FACET_MISSING' ||
          issue.code === 'REQUESTED_CAPABILITY_MISSING' ||
          issue.code === 'EXPLICIT_DOMAIN_COVERAGE_MISSING',
      )
      .map((issue) => issue.code);
    const acceptanceFailureReasons = [
      ...(productQualityScore < IDEA_MIN_ACCEPTED_QUALITY_SCORE
        ? ['QUALITY_SCORE_BELOW_THRESHOLD']
        : []),
      ...blockingIssueCodes,
      ...(!evidenceGateSatisfied ? ['EVIDENCE_GATE_NOT_SATISFIED'] : []),
    ];

    return {
      score: productQualityScore,
      productQualityScore,
      evidenceStrengthScore,
      evidenceValidated,
      accepted: acceptanceFailureReasons.length === 0,
      acceptanceFailureReasons,
      dimensions,
      issues,
    };
  }

  private evaluateLocalizedOutput(
    output: ParsedIdeaAiOutput,
    context: IdeaQualityEvaluationContext,
  ): IdeaQualityEvaluation {
    const issues: IdeaQualityIssue[] = [];
    const idea = output.coreIdea;
    const titleLength = idea.title.trim().length;
    const problemLength = idea.problemStatement.trim().length;
    const objectives = idea.objectives.map((value) => value.trim()).filter(Boolean);
    const targetUsers = idea.targetUsers.map((value) => value.trim()).filter(Boolean);
    const advancedComplete = !context.requireAdvancedOutputs || output.advancedOutputs.length >= 10;
    const directEvidenceCount = Math.max(0, context.directEvidenceCount ?? 0);
    const supportingEvidenceCount = Math.max(0, context.externalSupportingEvidenceCount ?? 0);
    const coreNarrative = [
      idea.title,
      idea.problemStatement,
      ...idea.objectives,
      ...idea.targetUsers,
      idea.limitedAbstract ?? '',
      idea.partialAbstract ?? '',
      idea.fullAbstract ?? '',
    ].join(' ');

    if (context.outputLanguage === 'AR') {
      const arabicLetters = (coreNarrative.match(/[\u0600-\u06ff]/gu) ?? []).length;
      const latinLetters = (coreNarrative.match(/[A-Za-z]/gu) ?? []).length;
      if (arabicLetters < 30 || arabicLetters * 1.25 < latinLetters) {
        issues.push({
          code: 'WRONG_OUTPUT_LANGUAGE',
          message: 'Rewrite every human-readable value in the frontend-selected output language while keeping schema keys and standard technical names unchanged.',
          penalty: 100,
        });
      }
    }

    if (titleLength < 8 || titleLength > 140) {
      issues.push({
        code: 'GENERIC_TITLE',
        message: 'Use a concise, distinctive public-facing title in the requested output language.',
        penalty: 12,
      });
    }

    if (problemLength < 120) {
      issues.push({
        code: 'WEAK_PROBLEM',
        message: 'Expand the problem narrative with affected users, workflow friction, and consequences in the requested output language.',
        penalty: 16,
      });
    }

    if (objectives.length < 4 || objectives.some((value) => value.length < 18)) {
      issues.push({
        code: 'GENERIC_OBJECTIVES',
        message: 'Return four concrete, non-empty objectives in the requested output language.',
        penalty: 16,
      });
    }

    if (targetUsers.length < 2 || targetUsers.some((value) => value.length < 4)) {
      issues.push({
        code: 'WEAK_TARGET_USERS',
        message: 'Return concrete target-user roles in the requested output language.',
        penalty: 10,
      });
    }

    if (!advancedComplete) {
      issues.push({
        code: 'LOW_ACTIONABILITY',
        message: 'Complete every required premium output section.',
        penalty: 18,
      });
    }

    if (directEvidenceCount <= 0 && supportingEvidenceCount <= 0) {
      issues.push({
        code: 'NO_DIRECT_EVIDENCE',
        message: 'No verified direct or supporting evidence exists; keep the idea explicitly validation-stage and avoid prevalence claims.',
        penalty: context.allowZeroEvidenceValidationCandidate ? 4 : 18,
      });
    }

    const requesterProblemProvided = Boolean(context.requesterDescription?.trim());
    const dimensions: IdeaQualityDimensions = {
      innovation: 90,
      marketFit:
        directEvidenceCount > 0
          ? Math.min(
              94,
              (context.verifiedIndependentSourceCount ?? 0) >= 2 ? 94 : 88,
            )
          : supportingEvidenceCount > 0
            ? requesterProblemProvided
              ? 80
              : 74
            : requesterProblemProvided
              ? 64
              : 35,
      technicalQuality: advancedComplete ? 92 : 68,
      completeness:
        problemLength >= 120 && objectives.length >= 4 && targetUsers.length >= 2
          ? 94
          : 65,
      originality: 90,
    };

    const weightedScore =
      dimensions.innovation * 0.25 +
      dimensions.marketFit * 0.25 +
      dimensions.technicalQuality * 0.2 +
      dimensions.completeness * 0.15 +
      dimensions.originality * 0.15;
    const productIssuePenalty = issues
      .filter((issue) => issue.code !== 'NO_DIRECT_EVIDENCE')
      .reduce((sum, issue) => sum + issue.penalty, 0);
    const score = this.clamp(weightedScore - productIssuePenalty * 0.18);
    const evidenceValidated = directEvidenceCount > 0 || supportingEvidenceCount > 0;
    const evidenceStrengthScore = this.clamp(
      directEvidenceCount > 0
        ? 75 + Math.min(20, directEvidenceCount * 6)
        : supportingEvidenceCount > 0
          ? 45 + Math.min(24, supportingEvidenceCount * 8)
          : 8,
    );
    const evidenceGateSatisfied =
      evidenceValidated ||
      (requesterProblemProvided && context.allowZeroEvidenceValidationCandidate === true);
    const blockingIssueCodes = issues
      .filter((issue) => issue.code === 'WRONG_OUTPUT_LANGUAGE')
      .map((issue) => issue.code);
    const acceptanceFailureReasons = [
      ...(score < IDEA_MIN_ACCEPTED_QUALITY_SCORE
        ? ['QUALITY_SCORE_BELOW_THRESHOLD']
        : []),
      ...blockingIssueCodes,
      ...(!evidenceGateSatisfied ? ['EVIDENCE_GATE_NOT_SATISFIED'] : []),
    ];

    return {
      score,
      productQualityScore: score,
      evidenceStrengthScore,
      evidenceValidated,
      accepted: acceptanceFailureReasons.length === 0,
      acceptanceFailureReasons,
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
   * Detects a small set of recurring copy-quality defects that are grammatically
   * valid enough to pass JSON/schema validation but make the generated idea
   * sound machine-written or internally inconsistent.
   */
  private hasAwkwardProductCopy(output: ParsedIdeaAiOutput): boolean {
    const idea = output.coreIdea;
    const text = this.normalize(
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

    return (
      /\bcommonly\s+navigation\s+friction\b/iu.test(text) ||
      /\bimplement\s+one\s+primary\s+user\s+workflow\b/iu.test(text) ||
      /\bone\s+primary\s+workflow\s+(?:featuring|including|covering)\s+(?:[^,.]+,\s*){2,}/iu.test(
        text,
      )
    );
  }

  /**
   * Rejects malformed or unverifiable percentage objectives before candidate
   * comparison. The quality-revision flow receives an exact grammatical repair
   * instruction, preventing polished but malformed phrases from reaching the
   * AI judge or persistence.
   */
  private hasMalformedMeasurableTarget(objectives: readonly string[]): boolean {
    return objectives.some((objective) => {
      const normalized = this.normalize(objective);
      const containsPercentage =
        /\b\d+(?:\.\d+)?\s*(?:%|percent(?:age)?)\b/iu.test(normalized);

      if (!containsPercentage) {
        return false;
      }

      const hasApprovedOpening =
        /^(?:target\s+(?:at\s+least\s+)?(?:a\s+)?\d|evaluate\s+whether\b)/iu.test(
          normalized,
        );
      const hasMalformedOpening =
        /^(?:target\s+(?:an|and)\s+evaluate|evaluate\s+at\s+least)\b/iu.test(
          normalized,
        );
      const hasExplicitDirection =
        /\b(?:increase|improvement|reduction|decrease|drop|growth|gain|fewer|lower|higher)\b/iu.test(
          normalized,
        );
      const hasAmbiguousChange =
        /\b\d+(?:\.\d+)?\s*(?:%|percent(?:age)?)\s+change\b/iu.test(normalized);
      const hasMeasurementMethod =
        /\b(?:measured\s+by|measurement|pre[- ]?and[- ]?post|before\s+and\s+after|ticket\s+volume|survey|benchmark|comparison|analytics?)\b/iu.test(
          normalized,
        );
      const hasEvaluationPeriod =
        /\b(?:during|over|within|after)\s+(?:a\s+|an\s+|the\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[ -]?(?:day|week|month|quarter|year)s?\b|\bpilot\s+period\b/iu.test(
          normalized,
        );

      return (
        hasMalformedOpening ||
        !hasApprovedOpening ||
        !hasExplicitDirection ||
        hasAmbiguousChange ||
        !hasMeasurementMethod ||
        !hasEvaluationPeriod
      );
    });
  }

  /**
   * Detects cross-application capabilities that violate common mobile,
   * desktop, browser, and app-store security boundaries.
   *
   * The check is intentionally narrow: it requires both a cross-app context
   * and a sensitive access/control claim. A candidate remains valid when it
   * makes a supported host SDK, vendor backend, official billing integration,
   * supported export, or explicit user-authorized import the primary path.
   */
  private hasUnsupportedPlatformAccess(output: ParsedIdeaAiOutput): boolean {
    const idea = output.coreIdea;
    const coreWorkflowText = this.normalize(
      [
        idea.title,
        idea.problemStatement,
        ...idea.objectives,
        idea.limitedAbstract ?? '',
        idea.partialAbstract ?? '',
        idea.fullAbstract ?? '',
      ].join(' '),
    );
    const platformText = this.normalize(
      [
        coreWorkflowText,
        ...output.advancedOutputs
          .filter((advancedOutput) =>
            [
              'system-architecture',
              'technology-stack',
              'mvp-features',
              'feasibility-assessment',
            ].includes(advancedOutput.outputKey),
          )
          .map((advancedOutput) => advancedOutput.content),
      ].join(' '),
    );

    const crossApplicationContext =
      /\b(?:standalone|independent|companion|user-controlled)\b[^.!?]{0,180}\b(?:host|third-party|another|external)\s+(?:mobile\s+)?app(?:lication)?\b/iu.test(
        platformText,
      ) ||
      /\bwhen\s+(?:a|the)\s+host\s+app(?:lication)?\b/iu.test(platformText);

    const sensitiveCrossAppAccess =
      /\b(?:read|extract|access|retrieve|capture|cache|validate|verify)\b[^.!?]{0,140}\b(?:purchase\s+receipts?|receipts?|secure\s+storage|private\s+logs?|internal\s+files?|subscription\s+status|entitlements?)\b/iu.test(
        platformText,
      );

    const directStoreVerification =
      /\b(?:validate|verify)\b[^.!?]{0,100}\b(?:purchase\s+)?receipts?\b[^.!?]{0,140}\b(?:apple\s+app\s+store|app\s+store|google\s+play|store\s+apis?)\b/iu.test(
        platformText,
      );

    const unsupportedEntitlementControl =
      /\b(?:restore|re[- ]?sync|synchroni[sz]e|grant|reactivate|trigger\s+re-validation)\b[^.!?]{0,120}\b(?:subscription|purchase|entitlement|pro\s+features?|host\s+app)\b/iu.test(
        platformText,
      );

    const unsupportedAuthenticationControl =
      /\b(?:bypass|circumvent|proxy\s+around|bridge|mint|create|restore|establish|inject|synchroni[sz]e)\b[^.!?]{0,150}\b(?:authentication|login|mfa|multi[- ]factor|two[- ]factor|2fa|host\s+(?:app|application)\s+session|authenticated\s+session)\b/iu.test(
        platformText,
      ) ||
      /\b(?:host|third[- ]party)\s+(?:app|application)\b[^.!?]{0,180}\b(?:recognize|accept|trust)\b[^.!?]{0,100}\b(?:session|token|authentication|login)\b/iu.test(
        platformText,
      );

    const supportedPrimaryPath =
      /\b(?:host[- ]integrated\s+sdk|sdk\s+(?:embedded|integrated)\s+(?:in|into|within)\s+(?:the\s+)?host\s+app(?:lication)?|host\s+app(?:lication)?\s+integrates?\s+(?:the\s+)?sdk|vendor[- ]owned\s+backend|application\s+developer(?:'s)?\s+backend|storekit(?:\s*2)?\s+integration|google\s+play\s+billing\s+integration|play\s+billing\s+integration|official\s+supported\s+(?:api|export)|explicit\s+user[- ]authorized\s+(?:receipt\s+)?import|user[- ]authorized\s+(?:receipt\s+)?import)\b/iu.test(
        coreWorkflowText,
      );
    const integrationIsOnlyOptional =
      /\b(?:optional(?:ly)?|alternatively|can\s+also|may\s+also|as\s+an\s+option)\b[^.!?]{0,100}\b(?:sdk|vendor\s+backend|supported\s+api|receipt\s+import)\b/iu.test(
        coreWorkflowText,
      );

    return (
      crossApplicationContext &&
      (sensitiveCrossAppAccess ||
        directStoreVerification ||
        unsupportedEntitlementControl ||
        unsupportedAuthenticationControl) &&
      (!supportedPrimaryPath || integrationIsOnlyOptional)
    );
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
    )
      .replace(
        /\b(?:the\s+)?(?:first|initial)\s+pilot\s+(?:deployment\s+)?(?:is\s+)?(?:planned|proposed|designed)\s+(?:for|in)\s+[^.!?]+[.!?]?/giu,
        ' ',
      )
      .replace(
        /\b(?:designed|planned|proposed)\s+for\s+(?:an?\s+)?(?:initial\s+|first\s+)?(?:pilot\s+)?deployment\s+(?:in|for)\s+[^.!?]+[.!?]?/giu,
        ' ',
      )
      /*
       * A target location may legitimately appear as a bounded deployment
       * constraint, e.g. "For a pilot deployment in Nablus, ...". Remove
       * those deployment-target clauses before looking for unsupported local
       * evidence claims. Statements such as "users in Nablus report..." are
       * intentionally left untouched and remain blockable below.
       */
      .replace(
        /\bfor\s+(?:an?\s+)?(?:first\s+|initial\s+|bounded\s+|controlled\s+)?pilot\s+(?:deployment|implementation|evaluation|trial)\s+(?:in|for|within)\s+[^,.;!?]+[,;]?/giu,
        ' ',
      )
      .replace(
        /\b(?:during|within)\s+(?:an?\s+)?(?:first\s+|initial\s+|bounded\s+|controlled\s+)?pilot\s+(?:deployment|implementation|evaluation|trial)\s+(?:in|for|within)\s+[^,.;!?]+[,;]?/giu,
        ' ',
      )
      .replace(
        /\b(?:during|within)\s+(?:the\s+)?(?:first\s+|initial\s+|bounded\s+|controlled\s+)?(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[ -]?(?:day|week|month|quarter|year)s?\s+)?pilot\s+(?:deployment|implementation|evaluation|trial)\s+(?:in|for|within)\s+[^,.;!?]+[,;]?/giu,
        ' ',
      );

    return locations.some((location) => {
      const escapedLocation = this.escapeRegExp(location);
      const affectedActor =
        '(?:students?|faculty|teachers?|learners?|users?|institutions?|universities|colleges|schools|administrators?|businesses|residents|organizations?)';
      const definitiveProblemVerb =
        "(?:face|faces|facing|encounter|encounters|experience|experiences|suffer|suffers|struggle|struggles|lack|lacks|report|reports|cannot|can't|are unable to|is unable to)";
      const locationOnlyProblemVerb =
        "(?:face|faces|facing|encounter|encounters|experience|experiences|suffer|suffers|struggle|struggles|lack|lacks|cannot|can't|are unable to|is unable to)";
      const actorThenLocation = new RegExp(
        `\\b${affectedActor}\\b[^.!?]{0,100}\\b(?:in|within|across|from)\\s+${escapedLocation}\\b[^.!?]{0,100}\\b${definitiveProblemVerb}\\b`,
        'iu',
      );
      const locationThenActor = new RegExp(
        `\\b${escapedLocation}\\b[^.!?]{0,100}\\b${affectedActor}\\b[^.!?]{0,100}\\b${definitiveProblemVerb}\\b`,
        'iu',
      );
      const inLocationClaim = new RegExp(
        `\\b(?:in|within|across)\\s+${escapedLocation}\\b[^.!?]{0,140}\\b${locationOnlyProblemVerb}\\b`,
        'iu',
      );

      return (
        actorThenLocation.test(claimText) ||
        locationThenActor.test(claimText) ||
        inLocationClaim.test(claimText)
      );
    });
  }

  private hasRequestScopeTitleDrift(
    title: string,
    requesterDescription: string,
  ): boolean {
    const request = this.normalize(requesterDescription);
    const normalizedTitle = this.normalize(title);

    const transitSecurityRequest =
      /\b(?:public transportation|public transport|transit|digital ticketing|fare system|connected vehicle|passenger application)\b/u.test(request) &&
      /\b(?:cyberattack|cybersecurity|unusual login|payment anomal|device behavior|service disruption|security incident|technical failure)\w*\b/u.test(request);
    if (transitSecurityRequest) {
      return !/\b(?:transit|transport|ticket|fare|passenger|vehicle|incident|security|cyber|anomaly|threat)\w*\b/u.test(
        normalizedTitle,
      );
    }

    const publicFiscalRequest =
      /\b(?:public institution|government|public sector|public administration)\w*\b/u.test(request) &&
      /\b(?:public budget|public funds|government spending|public spending|procurement|invoice|duplicate payment|overspending|expenditure)\w*\b/u.test(request);
    if (publicFiscalRequest) {
      return !/\b(?:public|government|budget|spending|procurement|invoice|payment|expenditure|audit|fraud|fund)\w*\b/u.test(
        normalizedTitle,
      );
    }

    const commissionVersionRequest =
      /\b(?:commission|custom order|design revision|approved version|dimension|engraving|material choice)\w*\b/u.test(request) &&
      /\b(?:artist|artisan|glass|craft|studio|maker)\w*\b/u.test(request);
    if (commissionVersionRequest) {
      return !/\b(?:glass|craft|commission|design|version|order|studio|artisan|artist)\w*\b/u.test(
        normalizedTitle,
      );
    }

    return false;
  }

  /**
   * Deterministic first-pass guard for concrete operations explicitly requested
   * by the user.  The provider may choose the implementation mechanism, but it
   * may not silently turn requested detection/tracking/prediction/prioritization
   * behavior into a generic dashboard because a narrower supporting article was
   * easier to ground.
   */
  private resolveMissingRequestedCapabilities(
    desiredOutcome: string | null | undefined,
    candidateNarrative: string,
  ): string[] {
    return RequestCapabilityContractUtil.resolveMissingCapabilities(
      desiredOutcome,
      candidateNarrative,
    );
  }

  /**
   * Extracts concrete requester-owned list facets from the explicit problem and
   * desired workflow text, then verifies that the generated candidate still
   * talks about those same concrete things.  This closes the gap between broad
   * semantic alignment and exact workflow preservation: a GeoAI candidate can
   * be generally relevant to Smart Cities while still silently dropping citizen
   * reports, streetlights, or water leaks from the user's requested workflow.
   *
   * The extractor is intentionally generic.  It recognizes enumerations after
   * request verbs (coordinate/combine/analyze/track/manage/monitor/protect) and
   * explicit example lists (such as/including), so it also applies to tailoring,
   * bakery, healthcare-access, manufacturing, and other unseen descriptions.
   */
  private resolveMissingRequesterConcreteFacets(
    requestDescription: string | null | undefined,
    candidateNarrative: string,
  ): string[] {
    const request = requestDescription?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!request) return [];

    const extracted: string[] = [];
    const collect = (value: string | undefined): void => {
      if (!value) return;
      for (const part of value.split(/\s*(?:,|;|\band\b|\bor\b)\s*/iu)) {
        const cleaned = part
          .replace(/^(?:the|a|an|their|its|current|existing)\s+/iu, '')
          .replace(/\s+/gu, ' ')
          .trim();
        if (
          /\b(?:prioriti[sz]|predict|forecast|detect|identif|analy[sz]|recommend|classif|scor|optimi[sz]|rank)\w*\b/iu.test(
            cleaned,
          ) ||
          /^(?:help|organize|organise|prepare|automate|automatically|flag|alert|notify|generate|build|develop|implement|create|provide|enable|allow|support)\b/iu.test(
            cleaned,
          )
        ) {
          continue;
        }
        const tokens = this.requestFacetTokens(cleaned);
        if (tokens.length < 2 || tokens.length > 7) continue;
        extracted.push(cleaned);
      }
    };

    for (const match of request.matchAll(
      /\b(?:such\s+as|including|for\s+example)\s+([^.!?]{4,240}?)(?=\b(?:before|when|while|which|so\s+that|to\s+(?:identify|detect|estimate|predict|prioriti[sz]e|help|flag|organize|organise|respond|reduce|improve))\b|[.!?]|$)/giu,
    )) {
      collect(match[1]);
    }

    for (const match of request.matchAll(
      /\b(?:coordinate|coordinates|coordinating|combine|combines|combining|analy[sz]e|analy[sz]es|analy[sz]ing|monitor|monitors|monitoring|track|tracks|tracking|manage|manages|managing|protect|protects|protecting)\s+([^.!?]{8,280}?)(?=\b(?:across|before|when|while|which|so\s+that|to\s+(?:identify|detect|estimate|predict|prioriti[sz]e|help|flag|organize|organise|respond|reduce|improve))\b|[.!?]|$)/giu,
    )) {
      collect(match[1]);
    }

    const uniqueFacets = [...new Map(
      extracted.map((facet) => [this.normalize(facet), facet] as const),
    ).values()].slice(0, 10);
    if (uniqueFacets.length === 0) return [];

    const candidateTokens = new Set(this.requestFacetTokens(candidateNarrative));
    return uniqueFacets.filter((facet) => {
      const tokens = this.requestFacetTokens(facet);
      if (tokens.length === 0) return false;
      const matched = tokens.filter((token) => candidateTokens.has(token)).length;
      const required = Math.max(1, Math.ceil(tokens.length * 0.6));
      return matched < required;
    });
  }

  private requestFacetTokens(value: string): string[] {
    const stop = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'from', 'in',
      'on', 'at', 'by', 'across', 'many', 'each', 'every', 'different', 'their',
      'its', 'current', 'existing', 'system', 'platform', 'workflow', 'data',
    ]);
    const seen = new Set<string>();
    const output: string[] = [];
    const normalized = value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    for (const raw of normalized.split(/\s+/u)) {
      let token = raw;
      if (!token || stop.has(token)) continue;
      if (/ies$/u.test(token) && token.length > 5) token = `${token.slice(0, -3)}y`;
      else if (/ing$/u.test(token) && token.length > 6) token = token.slice(0, -3);
      else if (/ed$/u.test(token) && token.length > 5) token = token.slice(0, -2);
      else if (/s$/u.test(token) && !/ss$/u.test(token) && token.length > 5) token = token.slice(0, -1);
      if (token === 'customer' || token === 'client') token = 'client';
      else if (token === 'citizen' || token === 'resident') token = 'resident';
      else if (token === 'garment' || token === 'apparel' || token === 'clothing') token = 'garment';
      if (token.length < 3 || stop.has(token) || seen.has(token)) continue;
      seen.add(token);
      output.push(token);
    }
    return output;
  }

  /**
   * Counts an objective as actionable when it either contains an existing
   * outcome/action term or pairs a concrete implementation verb with a real
   * software/operational capability. This avoids penalizing objectives such as
   * "Develop a telemetry ingestion engine" or "Establish RBAC and an audit
   * trail" while still rejecting empty prose like "develop the system".
   */
  private isConcreteActionableObjective(objective: string): boolean {
    if (this.containsAny(objective, this.ACTIONABILITY_TERMS)) return true;

    const hasImplementationVerb =
      /\b(?:build|develop|implement|establish|configure|ingest|aggregate|synchronize|coordinate|enforce|secure|route|orchestrate|deploy|create)\b/iu.test(
        objective,
      );
    if (!hasImplementationVerb) return false;

    const hasConcreteCapability =
      /\b(?:engine|model|module|workflow|pipeline|service|integration|api|database|data store|alert|notification|audit trail|access control|rbac|scheduler|tracker|queue|dashboard|prediction|forecast|anomaly detection|risk score|telemetry|sensor feed|data feed|decision support|rule engine)\b/iu.test(
        objective,
      );

    return hasConcreteCapability;
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

  /**
   * Detects MVP definitions that combine too many high-effort capabilities for
   * one bounded pilot.
   *
   * The check is intentionally conservative: it requires several independent
   * scope signals before applying a penalty.
   */
  private hasOverScopedMvp(
    mvpFeatures: string,
    output: ParsedIdeaAiOutput,
  ): boolean {
    const normalized = this.normalize(
      [
        mvpFeatures,
        output.coreIdea.fullAbstract ?? '',
        ...output.coreIdea.objectives,
      ].join(' '),
    );

    const scopeSignals = [
      /\bios\b/iu,
      /\bandroid\b/iu,
      /\bweb(?: sdk| client| integration| application)?\b/iu,
      /\b(?:simulation|sandbox replay) engine\b/iu,
      /\bsandbox replay\b/iu,
      /\banomaly detection\b/iu,
      /\bautomated (?:code|patch|fix) generation\b/iu,
      /\bsuggest(?:ed|s)? code fixes?\b/iu,
      /\bautomated (?:regression )?test(?: case| template)? generation\b/iu,
      /\bautomatically generated regression tests?\b/iu,
      /\bautomatic(?:ally)? (?:generate|generation of) (?:a )?(?:deterministic )?reproduction scripts?\b/iu,
      /\breproduction script generation\b/iu,
      /\bredis\b/iu,
      /\badvanced dashboard exports?\b/iu,
      /\breal-time\b/iu,
      /\bci\/cd\b/iu,
      /\bnative modules?\b/iu,
      /\bserver-side (?:log )?correlation\b/iu,
      /\bdeveloper dashboard\b/iu,
      /\bhost-embedded (?:validation )?sdk\b/iu,
      /\bbackend (?:analysis|orchestration|replay) engine\b/iu,
    ].filter((pattern) => pattern.test(normalized)).length;

    const clientPlatformCount = [
      /\bios\b/iu,
      /\bandroid\b/iu,
      /\bweb(?: sdk| client| integration| application)?\b/iu,
    ].filter((pattern) => pattern.test(normalized)).length;

    return clientPlatformCount >= 2 || scopeSignals >= 5;
  }

  /**
   * Rejects market wording that upgrades a single observed report into a
   * market-wide fact.
   */
  private hasUnsupportedMarketGeneralization(value: string): boolean {
    const normalized = this.normalize(value);

    return /\b(?:common|substantial|widespread|frequent(?:ly)?|recurring|industry-wide|market-wide|large demand|proven demand|strong demand)\b/iu.test(
      normalized,
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

  /**
   * Detects a generated diagnosis that is presented as established even though
   * the output itself does not qualify it as a hypothesis requiring validation.
   */
  private hasUnsupportedRootCauseClaim(output: ParsedIdeaAiOutput): boolean {
    const sections = [
      output.coreIdea.problemStatement,
      output.coreIdea.fullAbstract ?? '',
      ...output.coreIdea.objectives,
      ...output.advancedOutputs.map((item) => item.content),
    ];

    const diagnosisPattern =
      /\b(?:token drift|token-state mismatch|session mismatch|expired token stub|invalidated token stub|server-side identity mismatch|database inconsistency|network failure|race condition|hardcoded enumeration|feature-gating rule|root[- ]cause rule)\b/iu;
    const qualificationPattern =
      /\b(?:suspected|possible|plausible|hypothesized|hypothesis|may be|might be|could be|to be validated|requires? validation|validate whether|test whether|candidate cause|potential cause)\b/iu;

    return sections.some((section) =>
      section
        .split(/[.!?;\n]+/gu)
        .map((sentence) => this.normalize(sentence))
        .filter(Boolean)
        .some(
          (sentence) =>
            diagnosisPattern.test(sentence) &&
            !qualificationPattern.test(sentence),
        ),
    );
  }

  /**
   * Rejects candidates that turn one plausible storage mechanism into a
   * universal technical fact. Static configuration scanning is valid only when
   * the host project actually exposes the relevant rules in supported files.
   */
  private hasUnsupportedConfigurationStorageAssumption(
    output: ParsedIdeaAiOutput,
  ): boolean {
    const sections = [
      output.coreIdea.problemStatement,
      output.coreIdea.fullAbstract ?? '',
      ...output.coreIdea.objectives,
      ...output.advancedOutputs.map((item) => item.content),
    ];

    const staticFileMechanismPattern =
      /\b(?:json|yaml|yml|xml|configuration files?|config files?|static configuration|hardcoded subject (?:list|enum)s?|requiresSubscription|subscription flag)\b/iu;
    const universalDetectionPattern =
      /\b(?:detects?|finds?|prevents?|scans?|identifies?|catches?|ensures?|blocks?)\b/iu;
    const supportedScopePattern =
      /\b(?:when|where|only if|provided that|for host projects? that|supported schemas?|explicitly exposes?|configured adapter|adapter-based|within supported inputs?|hypothesis to validate|plausible)\b/iu;

    return sections.some((section) =>
      section
        .split(/[.!?;\n]+/gu)
        .map((sentence) => this.normalize(sentence))
        .filter(Boolean)
        .some(
          (sentence) =>
            staticFileMechanismPattern.test(sentence) &&
            universalDetectionPattern.test(sentence) &&
            !supportedScopePattern.test(sentence),
        ),
    );
  }

  /**
   * Detects unsupported guaranteed impact percentages.
   *
   * A generated idea may define what will be measured during a pilot, but it
   * must not promise a percentage reduction or improvement when the supplied
   * evidence contains no baseline or previous evaluation result.
   */
  private hasUnsupportedImpactTarget(output: ParsedIdeaAiOutput): boolean {
    return output.coreIdea.objectives.some((objective) => {
      const normalized = this.normalize(objective);
      const containsNumericPercentage =
        /\b\d{1,3}(?:\.\d+)?\s*(?:%|percent(?:age)?)\b/iu.test(normalized);

      if (!containsNumericPercentage) {
        return false;
      }

      /*
       * A numeric percentage is allowed only when the objective explicitly
       * states that the baseline and prior measured result were supplied by
       * the evidence. Generic phrases such as "evaluate whether" or
       * "during a pilot" are not enough because they can still introduce an
       * arbitrary 30% or 40% target.
       */
      const hasEvidenceSuppliedValidatedBaseline =
        /\b(?:validated baseline supplied by (?:the )?evidence|baseline and prior measured result supplied by (?:the )?evidence|evidence-provided baseline)\b/iu.test(
          normalized,
        );

      return !hasEvidenceSuppliedValidatedBaseline;
    });
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private clamp(value: number): number {
    return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
  }
}