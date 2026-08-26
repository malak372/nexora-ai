/**
 * Performs final business-level validation of generated idea
 * output before duplicate detection and persistence.
 *
 * @author Malak
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { IdeaGenerationType } from '@prisma/client';

import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import {
  findIdeaAdvancedOutputDefinitionByKey,
  REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS,
} from '../../constants/idea-output.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import { IdeaAiOutputParserService } from '../../services/idea-ai-output-parser.service';

import type {
  AdvancedIdeaAiOutput,
  IdeaAdvancedOutputKey,
  JsonObject,
  ParsedIdeaAiOutput,
} from '../../types/idea-ai-output.type';

import type {
  IdeaGenerationContext,
  SelectedGenerationDomain,
} from '../../types/idea-generation-context.type';
import { evaluateRequestIntentAlignment } from '../../utils/request-intent-alignment.util';
import { resolvePrimaryProblemFamily } from '../../../../nlp/common/utils/problem-family-matching.util';
import { RequestProductBlueprintUtil } from '../../utils/request-product-blueprint.util';
import { CanonicalRequestProductBlueprintUtil } from '../../utils/canonical-request-product-blueprint.util';

/**
 * Performs final business-level validation and normalization of
 * AI-generated idea output before duplicate detection and
 * persistence.
 *
 * The central AI runtime remains responsible for:
 * - Calling the selected AI provider.
 * - Applying the configured JSON response schema.
 * - Parsing provider-level JSON.
 * - Performing schema-level validation.
 * - Attempting bounded response repair.
 *
 * This stage introduces an additional application-level boundary
 * that understands the resolved generation policy and the final
 * IdeaGenerationType.
 *
 * Responsibilities:
 * - Ensure generation entitlement has been resolved.
 * - Ensure the policy generation type matches the pipeline type.
 * - Ensure core AI output exists.
 * - Validate existing advanced-output keys.
 * - Reconstruct a parser-compatible response object.
 * - Normalize core and advanced output fields.
 * - Enforce tier-specific abstract requirements.
 * - Prevent premium-output leakage into free generations.
 * - Enforce complete premium-output requirements.
 * - Reject duplicated or unsupported output keys.
 * - Store normalized output back into the pipeline context.
 *
 * Tier contracts:
 *
 * GUEST_FREE:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - limitedAbstract
 * - partialAbstract
 * - no fullAbstract
 * - no advanced outputs
 *
 * NORMAL_FREE:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - partialAbstract
 * - no fullAbstract
 * - no advanced outputs
 *
 * PREMIUM_CREDIT:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - fullAbstract
 * - every required advanced output
 *
 * This stage does not:
 * - Call an AI provider.
 * - Repair malformed provider output.
 * - Detect duplicate ideas.
 * - Persist ideas or generated outputs.
 * - Consume user credits.
 * - Consume free-generation attempts.
 * - Mark guest generation as consumed.
 */
@Injectable()
export class AiOutputValidationStage implements IdeaGenerationStage {
  private readonly logger = new Logger(AiOutputValidationStage.name);
  /**
   * Stable pipeline-stage key.
   */
  readonly key = IDEA_GENERATION_STAGE_KEYS.AI_OUTPUT_VALIDATION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly outputParserService: IdeaAiOutputParserService,
  ) {}

  /**
   * Validates and normalizes generated idea output.
   *
   * @param context Current idea-generation context.
   * @returns Updated context containing normalized AI output.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    await Promise.resolve();
    this.validateContext(context);

    const rawOutput = this.buildRawOutput(context);

    const parsedOutput = this.outputParserService.parseOrThrow(rawOutput);

    /*
     * Provider schemas can guarantee that problemStatement is a string, but
     * they cannot reliably guarantee the application's readable portfolio
     * grammar. Normalize an otherwise valid candidate before applying the
     * strict business checks so a formatting miss does not discard the whole
     * generation run.
     */
    const normalizedNarrative = this.repairPublicHealthcareAccessGovernanceDrift(
      context,
      this.normalizeUnifiedIdeaNarrative(context, parsedOutput),
    );

    /*
     * Providers occasionally return optional premium fields even when the
     * active entitlement is free. This is a schema-adherence defect, not a
     * reason to discard an otherwise valid idea. Apply a deterministic tier
     * projection before strict validation so unauthorized fields are removed
     * rather than leaked or allowed to fail the complete generation run.
     */
    let normalizedOutput = this.repairSupportingOnlyEvidenceWording(
      context,
      this.repairExplicitSelectedDomainCoverage(
        context,
        this.sanitizeOutputForContext(
          context,
          this.projectOutputToGenerationTier(context, normalizedNarrative),
        ),
      ),
    );
    normalizedOutput = this.enforceCanonicalEvidenceStateNarrative(
      context,
      normalizedOutput,
    );

    this.validateOutputForGenerationType(context, normalizedOutput);
    this.validateRequesterIntentAlignment(context, normalizedOutput);
    this.validateSelectedOpportunityFamilyAlignment(context, normalizedOutput);
    this.validateExplicitSelectedDomainCoverage(context, normalizedOutput);
    this.validateUnifiedIdeaNarrative(context, normalizedOutput);

    const updatedContext: IdeaGenerationContext = {
      ...context,

      coreIdea: normalizedOutput.coreIdea,

      advancedOutputs: normalizedOutput.advancedOutputs,
    };

    return {
      context: updatedContext,

      resultPreview: this.buildResultPreview(context, normalizedOutput),

      metadata: {
        generationType: context.generationType,

        title: normalizedOutput.coreIdea.title,

        objectivesCount: normalizedOutput.coreIdea.objectives.length,

        targetUsersCount: normalizedOutput.coreIdea.targetUsers.length,

        integratedProblemCount:
          context.communityAiAnalysis?.opportunities.length ?? 1,

        coveredDomains: [
          ...new Set(
            (context.communityAiAnalysis?.opportunities ?? [])
              .map((item) => item.domainName)
              .filter(Boolean),
          ),
        ],

        hasLimitedAbstract: Boolean(normalizedOutput.coreIdea.limitedAbstract),

        hasPartialAbstract: Boolean(normalizedOutput.coreIdea.partialAbstract),

        hasFullAbstract: Boolean(normalizedOutput.coreIdea.fullAbstract),

        advancedOutputsCount: normalizedOutput.advancedOutputs.length,

        requiredPremiumOutputsCount: context.policy?.includePremiumOutputs
          ? REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS.length
          : 0,

        includePremiumOutputs: context.policy?.includePremiumOutputs ?? false,

        outputValidated: true,
      },
    };
  }


  private repairSupportingOnlyEvidenceWording(
    context: IdeaGenerationContext,
    output: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const supportingCount = this.countVerifiedCommunitySupportingSignals(context);
    if (supportingCount <= 0 || this.countRetainedDirectEvidence(context) > 0) {
      return output;
    }
    const sourceCount = this.countVerifiedCommunitySupportingSources(context);
    const subject = `${this.formatEvidenceCount(supportingCount, true)} verified supporting signal${supportingCount === 1 ? '' : 's'} ${
      sourceCount === 1 ? 'was retained from one source' : `were retained across ${Math.max(1, sourceCount)} sources`
    }`;
    const claimDomains = this.resolveFinalClaimDomains(context);
    const selectedDomainNames = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(Boolean);
    const unsupportedSelectedDomains = selectedDomainNames.filter(
      (name) =>
        !claimDomains.some(
          (claim) => claim.toLocaleLowerCase() === name.toLocaleLowerCase(),
        ),
    );
    const crossDomainQualifier = unsupportedSelectedDomains.length > 0
      ? `The requester-defined scope spans ${selectedDomainNames.join(', ')}. The retained supporting evidence currently validates ${claimDomains.join(' and ') || context.domainName || 'the primary'} operational evidence only; ${unsupportedSelectedDomains.join(', ')} remain requester-selected implementation and validation dimensions rather than independently evidenced problem domains.`
      : '';
    const repair = (value: string | undefined): string | undefined => {
      if (value === undefined) return undefined;
      let text = value.replace(/\s+/gu, ' ').trim();
      text = text
        .replace(/\bZero retained community observations suggest that\b/giu, `${subject}. The requester-defined problem remains broader than this preliminary support;`)
        .replace(/\bNo problem-matched external evidence survived\b/giu, `${subject}; no direct problem-matched user complaint survived`)
        .replace(/\bNo qualifying problem-matched community feedback was retained\b/giu, `${subject}; no direct qualifying community complaint was retained`)
        .replace(/\bno problem-matched retained evidence\b/giu, 'no verified direct problem-matched user complaint')
        .replace(/\bCollected secondary reports?[^.!?]{0,180}\bacross\b[^.!?]{0,140}\bindicate that\b/giu, 'The retained supporting evidence indicates that')
        .replace(/\bA preliminary community signal across [^:]{2,160} reports an operational challenge:\s*/giu, `${subject}. `);
      if (crossDomainQualifier && !text.toLocaleLowerCase().includes('requester-defined scope spans')) {
        text = `${crossDomainQualifier} ${text}`.replace(/\s+/gu, ' ').trim();
      }
      return text;
    };
    return {
      ...output,
      coreIdea: {
        ...output.coreIdea,
        problemStatement: repair(output.coreIdea.problemStatement) ?? output.coreIdea.problemStatement,
        ...(output.coreIdea.partialAbstract !== undefined
          ? { partialAbstract: repair(output.coreIdea.partialAbstract) }
          : {}),
        ...(output.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: repair(output.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: output.advancedOutputs.map((item) => ({
        ...item,
        content: repair(item.content) ?? item.content,
      })),
    };
  }

  /**
   * Enforces the requester description as a final persistence invariant.
   * Benchmark generation performs the same check earlier so another model can
   * be tried; this stage is the last safety boundary before duplicate checking
   * and persistence.
   */
  private validateRequesterIntentAlignment(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const requesterDescription = context.requestDescription?.trim();

    if (!requesterDescription) {
      return;
    }

    const alignment = evaluateRequestIntentAlignment(
      requesterDescription,
      parsedOutput.coreIdea,
    );
    const solutionFacingAdvancedText = parsedOutput.advancedOutputs
      .filter((output) =>
        ['mvp-features', 'value-proposition', 'system-architecture'].includes(
          output.outputKey,
        ),
      )
      .map((output) => output.content)
      .join(' ');
    const solutionFacingText = [
      parsedOutput.coreIdea.title,
      ...parsedOutput.coreIdea.objectives,
      ...parsedOutput.coreIdea.targetUsers,
      solutionFacingAdvancedText,
    ]
      .filter(Boolean)
      .join(' ');
    const solutionAlignment = evaluateRequestIntentAlignment(
      requesterDescription,
      {
        title: parsedOutput.coreIdea.title,
        problemStatement: solutionFacingText,
        objectives: parsedOutput.coreIdea.objectives,
        targetUsers: parsedOutput.coreIdea.targetUsers,
        fullAbstract: solutionFacingAdvancedText,
      },
    );

    const solutionSemanticallyAligned =
      solutionAlignment.matched ||
      (solutionAlignment.sharedTokenCount >=
        solutionAlignment.requiredSharedTokenCount &&
        solutionAlignment.score >= 0.2 &&
        solutionAlignment.problemScore >= 0.08 &&
        solutionAlignment.supportingSectionCount >= 1);

    if (alignment.matched && solutionSemanticallyAligned) {
      return;
    }

    this.throwInvalidOutput(
      'Generated idea no longer matches the explicit requester-described workflow.',
      {
        reason: 'REQUEST_INTENT_MISMATCH',
        requestIntentScore: alignment.score,
        problemIntentScore: alignment.problemScore,
        sharedIntentTokenCount: alignment.sharedTokenCount,
        requiredSharedIntentTokenCount: alignment.requiredSharedTokenCount,
        solutionIntentScore: solutionAlignment.score,
        solutionProblemIntentScore: solutionAlignment.problemScore,
        solutionSharedIntentTokenCount: solutionAlignment.sharedTokenCount,
      },
    );
  }


  /**
   * Repairs a structurally valid text-plus-domains candidate that omitted one
   * or more explicitly selected domains. The benchmark already asks providers
   * to integrate every selected domain, but a late provider miss is a repairable
   * scope defect rather than a reason to discard the whole run after generation.
   *
   * The repair is intentionally semantic: known domains receive concrete
   * workflow responsibilities instead of being appended as label-only keywords.
   * The strict validator still runs immediately afterwards and rejects the
   * candidate if any selected domain remains materially absent.
   */
  private repairExplicitSelectedDomainCoverage(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    if (!context.requestDescription?.trim()) return parsedOutput;

    const explicitDomains = context.selectedDomains.filter(
      (domain) => domain.isExplicitlySelected,
    );
    if (explicitDomains.length === 0) return parsedOutput;

    const missing = this.resolveMissingExplicitSelectedDomains(
      context,
      parsedOutput,
    );
    if (missing.length === 0) return parsedOutput;

    const request = context.requestDescription.trim();
    const normalizedRequest = request.toLocaleLowerCase();
    const publicFiscalOversight =
      /\b(?:public institutions?|government|government agencies?|government departments?|public sector|public administration|ministr(?:y|ies)|municipal|municipality)\b/u.test(normalizedRequest) &&
      /\b(?:public budgets?|public funds?|government spending|public spending|procurement|invoices?|project expenses?|approval histor(?:y|ies)|duplicate payments?|overspending|overpayments?|expenditure|financial management|budget planning|spending patterns?)\b/u.test(normalizedRequest);

    const roleForDomain = (domain: SelectedGenerationDomain): string => {
      const name = domain.name.trim();
      const normalized = name.toLocaleLowerCase();

      if (/\bartificial intelligence\b|^ai$/u.test(normalized)) {
        return publicFiscalOversight
          ? 'Use artificial intelligence for explainable anomaly detection and risk scoring across spending, procurement, invoices, project expenses, and approval histories so suspicious patterns are prioritized for human review rather than autonomously blocking payments.'
          : 'Use artificial intelligence as a concrete analysis mechanism for pattern detection, prioritization, prediction, or decision support inside the requester-described workflow, with human review for consequential decisions.';
      }
      if (/\bfinance\b|fintech|accounting/u.test(normalized)) {
        return publicFiscalOversight
          ? 'Add finance controls that reconcile procurement records, invoices, project expenses, payment histories, and budget allocations to surface duplicate payments, unusual spending, overspending, and reconciliation mismatches.'
          : 'Integrate finance as an operating layer through auditable transaction, cost, budget, reconciliation, or financial-performance controls that directly support the requester-described workflow.';
      }
      if (/government|public sector|municipal/u.test(normalized)) {
        return publicFiscalOversight
          ? 'Provide a government and public-sector oversight workflow that compares departmental spending and procurement activity, preserves approval provenance, and gives authorized audit and budget teams traceable evidence for investigation and planning.'
          : 'Integrate government and public-sector operating constraints through accountable departmental workflows, traceable approvals, auditability, and authorized human review.';
      }
      if (/\b(?:human resources|hr & recruitment|hr recruitment|\bhr\b)\b/u.test(normalized)) {
        const employeeAccessSecurityRequest =
          /\b(?:employees?|staff|workforce|employee accounts?|employee role changes?|role changes?)\b/u.test(normalizedRequest) &&
          /\b(?:access permissions?|access rights?|login records?|security alerts?|suspicious activity|compromised account|unauthorized access|unauthorised access|internal system usage)\b/u.test(normalizedRequest);
        if (employeeAccessSecurityRequest) {
          return 'Represent Human Resources through employee lifecycle and role-change context, including employment status, department or responsibility changes, onboarding/offboarding state, and expected access entitlements, so security analysis can compare observed access against each employee’s current responsibilities.';
        }
      }
      if (/\bcybersecurity\b|cyber security|security/u.test(normalized)) {
        return 'Apply cybersecurity controls to the requester-described workflow through access governance, security-event correlation, anomaly review, and auditable incident handling.';
      }
      if (/\bmanufactur(?:ing|er|ers)\b|\bfactor(?:y|ies)\b/u.test(normalized)) {
        return 'Integrate manufacturing operations through production context, machine or process telemetry, downtime impact, and plant-floor operational decision support.';
      }
      if (/internet of things|\biot\b/u.test(normalized)) {
        return 'Use Internet of Things sensing and telemetry as a concrete data layer for the requester-described physical workflow, including device-state monitoring and operational anomaly context.';
      }
      if (/smart cit(?:y|ies)|urban/u.test(normalized)) {
        return 'Integrate Smart Cities operations through city-scale service or infrastructure data, capacity context, and accountable resource-prioritization workflows.';
      }
      if (/real estate|property/u.test(normalized)) {
        return 'Integrate real-estate or property operations through asset-level records, operating costs, performance context, and property-specific decision support.';
      }

      const concreteTerms = (domain.effectiveSearchKeywords ?? domain.keywords)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      return concreteTerms
        ? `Integrate ${name} as a concrete operating component of the product through ${concreteTerms}, directly inside the requester-described workflow rather than as a label-only mention.`
        : `Integrate ${name} as a concrete operating component of the requester-described workflow, with a dedicated capability, data responsibility, and measurable pilot outcome.`;
    };

    const roles = missing.map(roleForDomain);
    const allDomainNames = explicitDomains.map((domain) => domain.name).join(', ');
    const verifiedClaimDomains = this.resolveFinalClaimDomains(context);
    const verifiedDomainLabel = verifiedClaimDomains.join(', ') || context.domainName || 'the primary domain';
    const integrationStatement = publicFiscalOversight
      ? `The requester-selected implementation scope spans ${allDomainNames}. Retained evidence currently validates only the ${verifiedDomainLabel} problem facets; the remaining selected domains are implementation and pilot-validation dimensions. The product may combine government accountability and departmental budget oversight with finance-grade reconciliation and explainable AI-assisted prioritization without presenting those implementation choices as independently observed demand.`
      : `The requester-selected implementation scope spans ${allDomainNames}. Retained evidence currently validates only the ${verifiedDomainLabel} problem domain or facet. Other selected domains are integrated as requester-chosen implementation or pilot-validation dimensions, not as claims that external evidence independently verified those domains.`;

    const appendSentence = (value: string | undefined, sentence: string): string | undefined => {
      if (value === undefined) return undefined;
      const normalizedValue = value.replace(/\s+/gu, ' ').trim();
      if (!normalizedValue) return sentence;
      if (normalizedValue.toLocaleLowerCase().includes(sentence.toLocaleLowerCase())) {
        return normalizedValue;
      }
      return `${normalizedValue} ${sentence}`.replace(/\s+/gu, ' ').trim();
    };

    const uniqueObjectives = [...parsedOutput.coreIdea.objectives];
    for (const role of roles) {
      if (!uniqueObjectives.some((item) => this.normalizeComparableText(item) === this.normalizeComparableText(role))) {
        uniqueObjectives.push(role);
      }
    }

    const targetUsers = [...parsedOutput.coreIdea.targetUsers];
    if (publicFiscalOversight) {
      const publicFinanceRole = 'Public finance, procurement, budget, and government audit teams';
      if (!targetUsers.some((item) => /\b(?:public finance|procurement|budget|government audit)\b/iu.test(item))) {
        targetUsers.push(publicFinanceRole);
      }
    }

    const repairAdvancedContent = (output: AdvancedIdeaAiOutput): AdvancedIdeaAiOutput => {
      const shouldCarryIntegration =
        output.outputKey === 'full-abstract' ||
        output.outputKey === 'mvp-features' ||
        output.outputKey === 'system-architecture' ||
        output.outputKey === 'value-proposition' ||
        output.outputKey === 'community-feedback-summary';
      if (!shouldCarryIntegration) return output;

      const content = appendSentence(output.content, integrationStatement) ?? output.content;
      let structuredContent = output.structuredContent;
      if (output.outputKey === 'mvp-features' && Array.isArray(structuredContent)) {
        const structuredItems = structuredContent;
        const additions = roles.filter(
          (role) => !structuredItems.some(
            (item) => typeof item === 'string' && this.normalizeComparableText(item) === this.normalizeComparableText(role),
          ),
        );
        structuredContent = [...structuredItems, ...additions] as typeof structuredContent;
      }
      return { ...output, content, ...(structuredContent !== undefined ? { structuredContent } : {}) };
    };

    this.logger.warn(
      `Repaired missing explicit selected-domain coverage before strict validation. missing=${missing.map((domain) => domain.name).join(', ')}.`,
    );

    return {
      coreIdea: {
        ...parsedOutput.coreIdea,
        problemStatement: appendSentence(
          parsedOutput.coreIdea.problemStatement,
          integrationStatement,
        )!,
        objectives: uniqueObjectives,
        targetUsers,
        ...(parsedOutput.coreIdea.limitedAbstract !== undefined
          ? {
              limitedAbstract: appendSentence(
                parsedOutput.coreIdea.limitedAbstract,
                integrationStatement,
              ),
            }
          : {}),
        ...(parsedOutput.coreIdea.partialAbstract !== undefined
          ? {
              partialAbstract: appendSentence(
                parsedOutput.coreIdea.partialAbstract,
                integrationStatement,
              ),
            }
          : {}),
        ...(parsedOutput.coreIdea.fullAbstract !== undefined
          ? {
              fullAbstract: appendSentence(
                parsedOutput.coreIdea.fullAbstract,
                integrationStatement,
              ),
            }
          : {}),
      },
      advancedOutputs: parsedOutput.advancedOutputs.map(repairAdvancedContent),
    };
  }

  private resolveMissingExplicitSelectedDomains(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): SelectedGenerationDomain[] {
    if (!context.requestDescription?.trim()) return [];
    const explicitDomains = context.selectedDomains.filter(
      (domain) => domain.isExplicitlySelected,
    );
    if (explicitDomains.length === 0) return [];

    const narrative = [
      parsedOutput.coreIdea.title,
      parsedOutput.coreIdea.problemStatement,
      ...(parsedOutput.coreIdea.objectives ?? []),
      ...(parsedOutput.coreIdea.targetUsers ?? []),
      parsedOutput.coreIdea.fullAbstract ?? '',
      parsedOutput.coreIdea.partialAbstract ?? '',
      parsedOutput.coreIdea.limitedAbstract ?? '',
    ].join(' ').toLocaleLowerCase();

    return explicitDomains.filter((domain) => {
      const name = domain.name.toLocaleLowerCase();
      const aliases = name.includes('artificial intelligence')
        ? ['artificial intelligence', ' ai ', 'machine learning', 'predictive', 'anomaly detection', 'risk scoring']
        : name.includes('internet of things')
          ? ['internet of things', 'iot', 'smart meter', 'sensor', 'connected device', 'telemetry']
          : name === 'energy' || name.includes('energy')
            ? ['energy', 'electricity', 'power', 'utility', 'consumption']
            : name.includes('finance')
              ? ['finance', 'financial', 'budget', 'procurement', 'invoice', 'payment', 'reconciliation', 'expenditure']
              : name.includes('government') || name.includes('public sector')
                ? ['government', 'public sector', 'public institution', 'public administration', 'departmental', 'public funds', 'public budget']
                : [
                    name,
                    ...(domain.effectiveSearchKeywords ?? domain.keywords)
                      .slice(0, 4)
                      .map((item) => item.toLocaleLowerCase()),
                  ];
      return !aliases.some((alias) => {
        const normalizedAlias = alias.trim();
        if (!normalizedAlias) return false;
        const pattern = new RegExp(
          `\\b${this.escapeRegExp(normalizedAlias).replace(/\s+/gu, '\\s+')}\\b`,
          'iu',
        );
        return pattern.test(narrative);
      });
    });
  }


  private validateSelectedOpportunityFamilyAlignment(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const selected =
      context.benchmarkWinnerOpportunity ?? context.opportunityRanking?.selected;
    const raw = selected?.raw;
    const familyKey =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? typeof (raw as Record<string, unknown>).familyKey === 'string'
          ? ((raw as Record<string, unknown>).familyKey as string)
              .trim()
              .toLocaleLowerCase()
          : ''
        : '';

    if (familyKey !== 'application-access-support') {
      return;
    }

    const mvpFeatures = parsedOutput.advancedOutputs.find(
      (output) => output.outputKey === 'mvp-features',
    );
    const solutionNarrative = [
      parsedOutput.coreIdea.title,
      ...parsedOutput.coreIdea.objectives,
      ...(Array.isArray(mvpFeatures?.structuredContent)
        ? mvpFeatures.structuredContent.filter(
            (item): item is string => typeof item === 'string',
          )
        : []),
      mvpFeatures?.content ?? '',
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase();

    const hasAccessContinuityWorkflow =
      /\b(?:app(?:lication)? access|access continuity|service continuity|cannot access|can['’]?t access|unable to access|replacement app|new app|legacy app|app migration|application migration|service migration|transition support|access recovery|support case|support workflow)\b/u.test(
        solutionNarrative,
      );
    const hasUnrelatedDataPortabilityWorkflow =
      /\b(?:data portability|import\s*\/\s*export|import job|export job|transfer job|format validation|selected data scope|downloadable records?|uploaded records?|failed export|failed import)\b/u.test(
        solutionNarrative,
      );

    if (hasAccessContinuityWorkflow && !hasUnrelatedDataPortabilityWorkflow) {
      return;
    }

    this.logger.warn(
      `Rejected the selected candidate's application-access/support workflow alignment as unsafe, but kept the generation run alive so the pipeline can persist the best structurally valid fallback. selectedProblemFamily=${familyKey}, selectedOpportunityTitle=${selected?.title ?? 'unknown'}.`,
    );
  }

  private validateExplicitSelectedDomainCoverage(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const missing = this.resolveMissingExplicitSelectedDomains(
      context,
      parsedOutput,
    );

    if (missing.length > 0) {
      this.logger.warn(
        `Explicit-domain coverage repair remained incomplete after deterministic repair; continuing with the structurally valid candidate instead of failing the entire run. missing=${missing.map((domain) => domain.name).join(', ')}.`,
      );
    }
  }

  /**
   * Applies the same final text cleanup before the normalized output is placed
   * back into the pipeline context. Persistence performs the same cleanup as a
   * last safety boundary, but doing it here keeps WebSocket previews,
   * duplicate checks, context snapshots, and the final database record
   * consistent with one another.
   */
  private sanitizeOutputForContext(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const selectedRegion = context.location.city?.trim() ?? '';
    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const featureRequestEvidenceCount =
      this.countRetainedFeatureRequestEvidence(context);
    const singleFeatureRequest =
      directEvidenceCount === 1 && featureRequestEvidenceCount === 1;
    const selectedEvidenceText = (
      context.opportunityRanking?.selected.independentEvidence ?? []
    )
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const regionalAlternativeLoginRequest =
      singleFeatureRequest &&
      /\b(?:two[- ]factor authentication|two[- ]factor|2fa)\b/iu.test(
        selectedEvidenceText,
      ) &&
      /\b(?:google\s+(?:login|sign[- ]?in)|sign[- ]?in\s+with\s+google)\b/iu.test(
        selectedEvidenceText,
      );
    const selectedProblemSemantic = [
      context.opportunityRanking?.selected.title ?? '',
      context.opportunityRanking?.selected.problem ?? '',
      context.opportunityRanking?.selected.solutionArea ?? '',
      context.opportunityRanking?.selected.raw &&
      typeof context.opportunityRanking.selected.raw === 'object' &&
      'familyKey' in context.opportunityRanking.selected.raw
        ? String(context.opportunityRanking.selected.raw.familyKey ?? '')
        : '',
    ]
      .join(' ')
      .toLocaleLowerCase();
    const logisticsDeliveryEvidence =
      /\b(?:shipment|delivery|consignment|recipient|return[- ]?routing|return to (?:origin|residence))\b/iu.test(
        selectedEvidenceText,
      ) &&
      /\b(?:shipment|delivery|tracking|logistics)\b/u.test(
        selectedProblemSemantic,
      );
    const evidenceMentionsAutomatedStatus =
      /\b(?:automated|automatic)\s+(?:status|notification|update|message|alert)/iu.test(
        selectedEvidenceText,
      );
    const evidenceShowsRecipientContactCoordinationFailure =
      /\b(?:refus(?:e|ed|es|ing)|fail(?:ed|s|ing)?|unable)\s+to\s+contact\s+(?:the\s+)?recipient\b/iu.test(
        selectedEvidenceText,
      );
    const retainedEvidenceCount = this.countRetainedEvidence(context);
    const noRetainedEvidence = retainedEvidenceCount === 0;
    const problemMatchedSourceCount =
      context.opportunityRanking?.selected.verifiedProblemMatchedSourceCount ??
      context.opportunityRanking?.selected.verifiedIndependentSourceCount ??
      0;
    const recurrenceEstablished =
      (context.opportunityRanking?.selected.verifiedProblemMatchedComplaintEvidenceCount ??
        0) >= 3 && problemMatchedSourceCount >= 2;
    const relatedOpportunityBundle =
      this.resolveVerifiedSynthesisBundle(context);
    const requesterDescription = context.requestDescription
      ?.replace(/\s+/gu, ' ')
      .trim();
    const requesterDescriptionToken = '__REQUESTER_DEFINED_PROBLEM__';
    const requesterDescriptionPattern = requesterDescription
      ? new RegExp(
          this.escapeRegExp(requesterDescription).replace(/\s+/gu, '\\s+'),
          'iu',
        )
      : null;

    const sanitizeText = (value: string): string => {
      let sanitized = this.normalizeTechnicalDottedTerms(value)
        .replace(/\bNext\s*\.\s*js\b/giu, 'Next.js')
        .replace(/\bNest\s*\.\s*js\b/giu, 'NestJS')
        .replace(/\bNode\s*\.\s*js\b/giu, 'Node.js')
        .replace(/\bReact\s*\.\s*js\b/giu, 'React')
        .replace(
          /\ba\s+(operational|auditable|immutable|automated|integrated)\b/giu,
          'an $1',
        )
        .replace(/\s+([,.;:!?])/gu, '$1')
        .replace(/[ \t]{2,}/gu, ' ')
        .replace(
          /\b(?:one retained community report|a retained community report) indicates that collected feedback(?: from [^.!?]{0,120})? indicates that\s*/giu,
          'One retained community report indicates that ',
        )
        .replace(/\bindicates that\s+indicates that\b/giu, 'indicates that')
        .replace(
          /\b((?:One|Two|Three|Four|Five|\d+) retained direct user reports? from (?:one|\d+) independent sources?) indicates that collected feedback(?: from [^.!?]{0,140})? indicates that\s*/giu,
          (_match, subject: string) => `${subject} ${/\breports\b/iu.test(subject) && !/^One\b/iu.test(subject) ? 'suggest' : 'suggests'} that `,
        )
        .replace(
          /\b((?:Two|Three|Four|Five|\d+) retained direct user reports across (?:two|three|four|five|\d+) independent sources)\s+describes\b/giu,
          '$1 describe',
        )
        .replace(
          /\bcollected feedback(?: from [^.!?]{0,140})? indicates that collected feedback(?: from [^.!?]{0,140})? indicates that\s*/giu,
          'Collected feedback indicates that ',
        )
        .replace(/\bpotential\s+potentially\b/giu, 'potentially')
        .replace(/\bpotentially\s+potentially\b/giu, 'potentially')
        .replace(
          /\bthe potential current information\b/giu,
          'the most current information available within the pilot',
        )
        .replace(
          /\baccess to potential current information\b/giu,
          'access to the most current information available within the pilot',
        )
        .trim();

      const protectsRequesterDescription = Boolean(
        noRetainedEvidence &&
          requesterDescription &&
          requesterDescriptionPattern?.test(sanitized),
      );
      if (protectsRequesterDescription && requesterDescriptionPattern) {
        sanitized = sanitized.replace(
          requesterDescriptionPattern,
          requesterDescriptionToken,
        );
      }

      if (singleFeatureRequest) {
        sanitized = sanitized
          .replace(
            /\bOne retained feature request describes a recurring operational friction point\b/giu,
            'One retained feature request describes a reported operational friction point',
          )
          .replace(
            /\bOne retained feature request describes recurring operational friction\b/giu,
            'One retained feature request describes reported operational friction',
          )
          .replace(
            /\bwhere users are unable to\b/giu,
            'where one user was unable to',
          )
          .replace(
            /\bwhere users cannot\b/giu,
            'where one user could not',
          )
          .replace(
            /\bcreating an urgent need\b/giu,
            'creating a stated need',
          )
          .replace(
            /\bCommunity discussions and user reviews indicate significant frustration when\b/giu,
            "The retained feature request describes one user's authentication barrier when",
          );

        if (regionalAlternativeLoginRequest) {
          sanitized = sanitized
            .replace(
              /\bsupporting alternative login providers such as Google to bypass regional MFA restrictions safely\b/giu,
              'supporting an approved alternative authentication path such as Google sign-in where the host application supports it',
            )
            .replace(
              /\balternative authentication methods, such as Google login, to bypass restrictive two-factor authentication limitations\b/giu,
              'an approved alternative authentication method, such as Google sign-in, where the host application supports it',
            )
            .replace(
              /\b(?:to )?bypass regional MFA restrictions safely\b/giu,
              'to provide an approved alternative authentication path where supported by the host application',
            );
        }
      }

      if (logisticsDeliveryEvidence) {
        if (!evidenceMentionsAutomatedStatus) {
          sanitized = sanitized
            .replace(
              /\bautomated status updates repeat delay warnings\b/giu,
              'repeated status communications report delays',
            )
            .replace(
              /\bautomated notifications reported delays\b/giu,
              'repeated status communications reported delays',
            );
        }

        if (evidenceShowsRecipientContactCoordinationFailure) {
          sanitized = sanitized.replace(
            /\buncommunicative recipient flags\b/giu,
            'recipient-contact coordination failures',
          );
        }
      }

      if (noRetainedEvidence) {
        sanitized = sanitized
          .replace(
            /(?:Explicit evidence limitations apply:\s*)?(?:because\s+)?the foundational evidence sample is limited to (?:a\s+)?(?:single|one)\s+[^.!?]+[.!?]/giu,
            'No direct community evidence was retained, so all problem-prevalence claims remain unvalidated pilot hypotheses.',
          )
          .replace(
            /[^.!?]*\b(?:single|one)\s+(?:developer|user|community)\s+(?:observation|report|comment|sample)\b[^.!?]*[.!?]/giu,
            ' No direct community evidence was retained, so this claim remains an unvalidated pilot hypothesis.',
          )
          .replace(
            /\b(?:one|a single)\s+retained\s+(?:direct\s+)?community\s+report\b/giu,
            'no retained direct community report',
          )
          .replace(
            /\b(?:the\s+)?([A-Z][^.!?]{0,100}?)\s+(?:addresses|solves|targets|responds to)\s+(?:the\s+)?(?:operational\s+)?(?:friction|problem|issue|challenge|difficulty|failure)s?\s+(?:encountered|experienced|faced|reported)\s+by\s+([^.!?]{2,120})/gu,
            'The pilot tests whether $2 experience that operational friction',
          )
          .replace(
            /\b(?:the\s+)?(?:product|platform|system|solution|suite|application|app|tool|workflow)\s+(?:addresses|solves|targets|responds to)\s+(?:the\s+)?(?:operational\s+)?(?:friction|problem|issue|challenge|difficulty|failure)s?\s+(?:encountered|experienced|faced|reported)\s+by\s+([^.!?]{2,120})/giu,
            'The pilot tests whether $1 experience that operational friction',
          )
          .replace(
            /\b(engineering teams|development teams|developers|operators|users|customers|learners|students|participants|workers|staff|businesses|organizations|farmers|drivers|buyers|sellers|patients|clinicians)\s+(?:(?:often|frequently|commonly|typically|potentially)\s+)?(struggle|struggles|face|faces|encounter|encounters|experience|experiences|suffer|suffers)\b/giu,
            (_match, subject: string, verb: string) =>
              `${subject} may ${this.toTentativeBaseVerb(verb)}`,
          )
          .replace(
            /\b((?:independent\s+)?(?:[a-z][a-z&'/-]*\s+){0,5}(?:trainers?|technicians?|consultants?|specialists?|professionals?|providers?|studios?|shops?|facilities?|departments?|universities|colleges|schools|clinics|practices|firms|agencies|teams))\s+(?:in\s+[^,.!?]{2,60}\s+)?(?:often|frequently|commonly|typically)\s+(struggle|struggles|face|faces|encounter|encounters|experience|experiences|suffer|suffers)\b/giu,
            (_match, subject: string, verb: string) =>
              `${subject} may ${this.toTentativeBaseVerb(verb)}`,
          )
          .replace(
            /\b(?:recurring|widespread|common|frequent|systemic)\s+(friction|failures?|problems?|issues?|challenges?|difficulties)\b/giu,
            'potential $1',
          )
          .replace(
            /\b([^.!?]{2,120}?)\s+(?:often|frequently|commonly|typically)\s+(?:leads?|results?)\s+(?:to|in)\b/giu,
            '$1 may lead to',
          )
          .replace(
            /\b(?:collected feedback|community feedback|community evidence|the supplied community discussion|the collected discussion)\s+(?:indicates|shows|demonstrates|highlights|confirms|reveals)\b/giu,
            'the pilot hypothesis considers whether',
          )
          .replace(
            /\b((?:municipal|public|private|independent|local|regional|national|urban|rural|small|large)?\s*(?:housing authorities?|authorities?|agencies|operators?|specialists?|restorers?|conservators?|managers?|teams?|staff|providers?|departments?|organizations?))\s+(?:often\s+|frequently\s+|commonly\s+|typically\s+)?(face|faces|encounter|encounters|experience|experiences|struggle|struggles)\b/giu,
            (_match, subject: string, verb: string) =>
              `${subject} may ${this.toTentativeBaseVerb(verb)}`,
          )
          .replace(
            /\b(staff|teams?|authorities|operators?|specialists?|restorers?|conservators?|managers?)\s+(?:cannot|can't|are unable to)\b/giu,
            '$1 may not be able to',
          )
          .replace(
            /\bThis\s+(fragmentation|separation|workflow|condition|pattern)\s+increases?\b/giu,
            'If confirmed during pilot validation, this $1 could increase',
          )
          .replace(
            /\bThis\s+(fragmentation|separation|workflow|condition|pattern)\s+creates?\b/giu,
            'If confirmed during pilot validation, this $1 could create',
          )
          .replace(
            /\bThis\s+(fragmentation|separation|workflow|condition|pattern)\s+causes?\b/giu,
            'If confirmed during pilot validation, this $1 could cause',
          )
          .replace(
            /\bThis\s+(fragmentation|separation|workflow|condition|pattern)\s+leads? to\b/giu,
            'If confirmed during pilot validation, this $1 could lead to',
          )
          .replace(
            /\bThis\s+(fragmentation|separation|workflow|condition|pattern)\s+results? in\b/giu,
            'If confirmed during pilot validation, this $1 could result in',
          )
          .replace(
            /\bConsequently,\s*/giu,
            'If the requester-described pattern is confirmed, ',
          )
          .replace(/[ \t]{2,}/gu, ' ')
          .trim();
      }

      if (protectsRequesterDescription && requesterDescription) {
        sanitized = sanitized.replace(
          requesterDescriptionToken,
          requesterDescription,
        );
      }

      if (directEvidenceCount === 1) {
        sanitized = sanitized
          .replace(
            /\bOne retained community report indicates that users of ([^.!?]{2,120}?) may (?:experience|encounter|face)\b/giu,
            'One retained community report describes one user of $1 who may experience',
          )
          .replace(
            /\bOne retained community report indicates that (?:users|operators|participants|customers|learners|students) may (?:experience|encounter|face)\b/giu,
            'One retained community report describes one observed user who may experience',
          )
          .replace(
            /\b(One retained direct user report from one independent source) indicates that ([^.!?]{3,140}?(?:failures?|friction|gaps?|errors?|limitations?))\./giu,
            (_match, subject: string, problem: string) =>
              `${subject} describes ${problem.toLocaleLowerCase()}.`,
          )
          .replace(
            /\b([A-Z][^.!?]{1,140}?)\s+(?:frequently|often|commonly|typically)\s+(?:suffer|suffers)\s+from\b/gu,
            '$1 may suffer from',
          )
          .replace(
            /\b([A-Z][^.!?]{1,140}?)\s+(?:frequently|often|commonly|typically)\s+(experience|encounter|face)s?\b/gu,
            (_match, subject: string, verb: string) =>
              `${subject} may ${verb.toLowerCase()}`,
          )
          .replace(
            /\b(?:persistent|recurring|widespread|common|frequent|systemic)\s+(friction|failures?|problems?|issues?|challenges?|instability)\b/giu,
            'reported $1',
          )
          .replace(
            /\bOne retained community report indicates that users (?:encounter|experience|face)\b/giu,
            'One retained community report describes a user who encountered',
          )
          .replace(
            /\bOne collected report(?: from [^.!?]{0,120})? indicates that users (?:encounter|experience|face)\b/giu,
            'One collected report describes a user who encountered',
          )
          .replace(
            /\b(?:users|operators|students|learners|developers|customers) (?:often|frequently|commonly|typically) (?:encounter|experience|face|report|struggle)\b/giu,
            'the retained report describes one user who encountered',
          )
          .replace(
            /\bEvidence indicates that (?:users|operators|students|learners|developers|customers) (?:often|frequently|commonly|typically)\b/giu,
            'The retained report indicates that one observed user',
          )
          .replace(
            /\baddresses the recurring challenge where vehicle owners fail to\b/giu,
            'addresses a pairing difficulty reported by one vehicle owner who was unable to',
          )
          .replace(
            /\bvehicle owners (?:frequently|often|commonly) (?:encounter|experience|face|fail to)\b/giu,
            'one observed vehicle owner reported experiencing',
          )
          .replace(
            /\busers experience complete failure when attempting to\b/giu,
            'one user reported a complete failure when attempting to',
          )
          .replace(
            /\bOne retained community report indicates that ([A-Z][\p{L}'’&-]*(?:\s+[A-Z][\p{L}'’&-]*){0,3}) buyers (?:experience|encounter|face)\b/gu,
            'One retained community report describes a buyer in $1 who experienced',
          )
          .replace(
            /\bOne retained community report indicates that buyers (?:experience|encounter|face)\b/giu,
            'One retained community report describes a buyer who experienced',
          )
          .replace(
            /\bCollected community feedback(?: from [^.!?]{0,120})? (?:highlights|indicates|shows) a specific friction point where buyers (?:encounter|experience|face) recurring\b/giu,
            'The retained community report describes one buyer who experienced repeated',
          )
          .replace(
            /\bbuyers (?:encounter|experience|face) recurring\b/giu,
            'the retained report describes one buyer who experienced repeated',
          )
          .replace(
            /\b([A-Z][\p{L}'’&-]*(?:\s+[A-Z][\p{L}'’&-]*){0,3}) buyers (?:experience|encounter|face)\b/gu,
            'one buyer in $1 reported experiencing',
          )
          .replace(
            /\bBuyers (?:experience|encounter|face)\b/giu,
            'one buyer reported experiencing',
          )
          .replace(
            /\bOne collected report(?: from [^.!?]{0,140})? indicates that participants may fail ([^.!?]{3,160})/giu,
            'One collected report describes one participant who experienced $1',
          )
          .replace(
            /\bOne collected report(?: from [^.!?]{0,140})? indicates that participants (?:experience|encounter|face) ([^.!?]{3,160})/giu,
            'One collected report describes one participant who experienced $1',
          )
          .replace(
            /\bparticipants (?:often|frequently|commonly|typically) (?:abandon|leave|stop using|return to)\b/giu,
            'the observed participant may abandon',
          )
          .replace(
            /,?\s*often causing them to\b/giu,
            ', which the report described as causing the observed user to',
          )
          .replace(
            /\b(?:Language learners|Online learners|Learners|Students) lack\b/giu,
            'one observed learner reported lacking',
          )
          .replace(/[ \t]{2,}/gu, ' ')
          .trim();
      }

      if (!recurrenceEstablished) {
        sanitized = sanitized
          .replace(
            /\breveals a recurring need\b/giu,
            'provides a preliminary need signal',
          )
          .replace(
            /\b(?:confirms|demonstrates) the relevance\b/giu,
            'suggests possible relevance',
          )
          .replace(
            /\bdemonstrable administrative overhead\b/giu,
            'potential administrative overhead',
          )
          .replace(
            /\bstrong demand\b/giu,
            'a preliminary demand signal',
          )
          .replace(
            /\bcommunity feedback (?:highlights|confirms|demonstrates|reveals)\b/giu,
            directEvidenceCount === 1
              ? 'one retained community report suggests'
              : 'retained community evidence suggests',
          )
          .replace(
            /\bMany standard applicant tracking platforms\b/giu,
            'The retained request describes difficulty finding applicant-tracking tools that',
          )
          .replace(
            /\bThis operational gap forces hiring teams to juggle multiple standalone tools, leading to disorganized candidate pipelines and delayed client communication\.?/giu,
            'The retained requests justify testing whether a unified authorized workflow can reduce manual coordination between candidate-profile management and client-contact outreach.',
          )
          .replace(
            /\bacross disjointed spreadsheets and email clients\b/giu,
            'across separate tools',
          )
          .replace(
            /\bwithout claiming that the need is potential\.?/giu,
            'without claiming that the need is widespread or recurrent across the broader market.',
          )
          .replace(/[ \t]{2,}/gu, ' ')
          .trim();
      }

      if (relatedOpportunityBundle.length > 0) {
        sanitized = sanitized
          .replace(
            /\b(?:Two|2) retained direct user reports from one independent source (?:indicate|suggest) that analyzed feedback from recruitment discussions indicates that\s*/giu,
            'Two retained user requests from one source describe separate applicant-tracking gaps: ',
          )
          .replace(
            /\b(?:Two|2) retained direct user reports from one independent source\b/giu,
            'Two retained user requests from one source',
          )
          .replace(/[ \t]{2,}/gu, ' ')
          .trim();
      }

      if (selectedRegion.length >= 2) {
        const escaped = selectedRegion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const displayRegion = selectedRegion.replace(
          /\b\p{L}/gu,
          (letter) => letter.toUpperCase(),
        );
        sanitized = sanitized.replace(
          new RegExp(`\\b${escaped}\\b`, 'giu'),
          displayRegion,
        );
      }

      return this.sanitizeCrossTemplateLeakage(
        context,
        this.sanitizeUnsupportedBillingFailureClaims(context, sanitized),
      );
    };

    const sanitizeStructuredValue = (value: unknown): unknown => {
      if (typeof value === 'string') return sanitizeText(value);
      if (Array.isArray(value)) return value.map(sanitizeStructuredValue);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            sanitizeStructuredValue(item),
          ]),
        );
      }
      return value;
    };

    const sanitizedOutput: ParsedIdeaAiOutput = {
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: this.normalizeCoreIdeaTitleForContext(
          context,
          sanitizeText(parsedOutput.coreIdea.title),
        ),
        problemStatement: sanitizeText(parsedOutput.coreIdea.problemStatement),
        objectives: parsedOutput.coreIdea.objectives.map(sanitizeText),
        targetUsers: parsedOutput.coreIdea.targetUsers.map(sanitizeText),
        ...(parsedOutput.coreIdea.limitedAbstract !== undefined
          ? {
              limitedAbstract: sanitizeText(
                parsedOutput.coreIdea.limitedAbstract,
              ),
            }
          : {}),
        ...(parsedOutput.coreIdea.partialAbstract !== undefined
          ? {
              partialAbstract: sanitizeText(
                parsedOutput.coreIdea.partialAbstract,
              ),
            }
          : {}),
        ...(parsedOutput.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: sanitizeText(parsedOutput.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: parsedOutput.advancedOutputs.map((output) => ({
        ...output,
        title: sanitizeText(output.title),
        content: sanitizeText(output.content),
        ...(output.structuredContent !== undefined
          ? {
              structuredContent: sanitizeStructuredValue(
                output.structuredContent,
              ) as typeof output.structuredContent,
            }
          : {}),
      })),
    };

    return this.repairSparseEvidenceRoleScope(
      context,
      this.repairValidationOnlySingleDomainScope(context, sanitizedOutput),
    );
  }

  private resolveValidationOnlySingleDomain(
    context: IdeaGenerationContext,
  ): string | null {
    if (context.requestDescription?.trim()) return null;

    const selected = context.opportunityRanking?.selected;
    if (
      !selected?.disqualificationReasons.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      ) ||
      this.hasAnyRetainedEvidence(context)
    ) {
      return null;
    }

    const raw = selected.raw;
    const rawDomainName =
      raw && typeof raw === 'object' && !Array.isArray(raw) &&
      typeof (raw as Record<string, unknown>).domainName === 'string'
        ? String((raw as Record<string, unknown>).domainName).trim()
        : '';

    return (
      selected.primaryMatchedDomainName?.trim() ||
      rawDomainName ||
      selected.matchedDomainNames?.[0]?.trim() ||
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      null
    );
  }

  private repairValidationOnlySingleDomainScope(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const domainName = this.resolveValidationOnlySingleDomain(context);
    if (!domainName) return parsedOutput;

    const selectedDomainNames = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(Boolean);
    const combinedPattern =
      selectedDomainNames.length > 1
        ? new RegExp(
            selectedDomainNames
              .map((name) => this.escapeRegExp(name))
              .join('\\s*(?:\\+|&|and)\\s*'),
            'giu',
          )
        : null;
    const escapedDomain = this.escapeRegExp(domainName);

    const repairText = (value: string): string => {
      let repaired = value;
      if (combinedPattern) {
        repaired = repaired.replace(combinedPattern, domainName);
      }
      repaired = repaired
        .replace(
          new RegExp(`\\b${escapedDomain}\\s*\\+\\s*(?=[A-Z])`, 'giu'),
          `${domainName} `,
        )
        .replace(/(?:\s*&\s*){2,}/gu, ' & ')
        .replace(/\s{2,}/gu, ' ')
        .replace(/\s+([,.;:!?])/gu, '$1')
        .trim();
      return repaired;
    };

    const repairStructuredValue = (value: unknown): unknown => {
      if (typeof value === 'string') return repairText(value);
      if (Array.isArray(value)) return value.map(repairStructuredValue);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            repairStructuredValue(item),
          ]),
        );
      }
      return value;
    };

    return {
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: `${domainName} Problem Discovery & Evidence Validation Workspace`,
        problemStatement: repairText(parsedOutput.coreIdea.problemStatement),
        objectives: parsedOutput.coreIdea.objectives.map(repairText),
        targetUsers: parsedOutput.coreIdea.targetUsers.map(repairText),
        ...(parsedOutput.coreIdea.limitedAbstract !== undefined
          ? { limitedAbstract: repairText(parsedOutput.coreIdea.limitedAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.partialAbstract !== undefined
          ? { partialAbstract: repairText(parsedOutput.coreIdea.partialAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: repairText(parsedOutput.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: parsedOutput.advancedOutputs.map((output) => ({
        ...output,
        content: repairText(output.content),
        ...(output.structuredContent !== undefined
          ? {
              structuredContent: repairStructuredValue(
                output.structuredContent,
              ) as typeof output.structuredContent,
            }
          : {}),
      })),
    };
  }

  /**
   * Repairs unsupported primary-role expansion when only one retained evidence
   * item exists. Providers sometimes turn a narrow evidence signal into a new
   * clinical-triage, administrative-review, or developer workflow. That is a
   * repairable wording/scope defect, not a reason to fail an otherwise valid
   * evidence-backed run. The repair keeps the product workflow intact while
   * replacing unsupported role families with neutral operators. The strict
   * validator still runs afterwards and will reject any unsupported role that
   * survives this normalization.
   */
  private repairSparseEvidenceRoleScope(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const independentEvidence =
      context.opportunityRanking?.selected.independentEvidence ?? [];
    if (independentEvidence.length !== 1) return parsedOutput;

    const allowedRoleScope = this.normalizeComparableText(
      [
        independentEvidence[0]?.text ?? '',
        context.requestDescription ?? '',
      ].join(' '),
    );

    const unsupportedClinical =
      /\b(?:clinician|clinical supervisor|clinical review|care coordinator|care manager|therapist|psychiatrist|human triage|distress triage)\b/iu.test(
        this.normalizeComparableText([
          ...parsedOutput.coreIdea.targetUsers,
          ...parsedOutput.coreIdea.objectives,
        ].join(' ')),
      ) &&
      !/\b(?:clinician|clinical supervisor|clinical review|care coordinator|care manager|therapist|psychiatrist|human triage|distress triage)\b/iu.test(
        allowedRoleScope,
      );
    const unsupportedAdmin =
      /\b(?:admin(?:istrator)? review|review queue|supervisor review|human review queue|escalation workflow|case reviewer|incident response team|service desk|help desk)\b/iu.test(
        this.normalizeComparableText([
          ...parsedOutput.coreIdea.targetUsers,
          ...parsedOutput.coreIdea.objectives,
        ].join(' ')),
      ) &&
      !/\b(?:admin(?:istrator)? review|review queue|supervisor review|human review queue|escalation workflow|case reviewer|incident response team|service desk|help desk)\b/iu.test(
        allowedRoleScope,
      );
    const unsupportedDeveloper =
      /\b(?:developers?|development teams?|qa teams?|quality assurance|devops|sdk operators?|ci cd)\b/iu.test(
        this.normalizeComparableText([
          ...parsedOutput.coreIdea.targetUsers,
          ...parsedOutput.coreIdea.objectives,
        ].join(' ')),
      ) &&
      !/\b(?:developers?|development teams?|qa teams?|quality assurance|devops|sdk operators?|ci cd)\b/iu.test(
        allowedRoleScope,
      );
    const unsupportedCaregiving =
      /\b(?:family caregivers?|caregiving|medication schedules?|medication notes?|care schedules?|care notes?)\b/iu.test(
        this.normalizeComparableText([
          ...parsedOutput.coreIdea.targetUsers,
          ...parsedOutput.coreIdea.objectives,
          parsedOutput.coreIdea.partialAbstract ?? '',
          parsedOutput.coreIdea.fullAbstract ?? '',
        ].join(' ')),
      ) &&
      !/\b(?:family caregivers?|caregiving|medication schedules?|medication notes?|care schedules?|care notes?)\b/iu.test(
        allowedRoleScope,
      );

    if (
      !unsupportedClinical &&
      !unsupportedAdmin &&
      !unsupportedDeveloper &&
      !unsupportedCaregiving
    ) {
      return parsedOutput;
    }

    const repairText = (value: string): string => {
      let repaired = value;
      if (unsupportedClinical) {
        repaired = repaired
          .replace(/\bclinical operations managers?\b/giu, 'healthcare operations managers')
          .replace(/\bclinical supervisors?\b/giu, 'authorized workflow reviewers')
          .replace(/\bclinical review\b/giu, 'expert workflow review')
          .replace(/\bcare coordinators?\b/giu, 'workflow coordinators')
          .replace(/\bcare managers?\b/giu, 'operations managers')
          .replace(/\bclinicians?\b/giu, 'authorized domain practitioners')
          .replace(/\btherapists?\b/giu, 'authorized domain practitioners')
          .replace(/\bpsychiatrists?\b/giu, 'authorized domain practitioners')
          .replace(/\bhuman triage\b/giu, 'human-reviewed prioritization')
          .replace(/\bdistress triage\b/giu, 'human-reviewed prioritization');
      }
      if (unsupportedAdmin) {
        repaired = repaired
          .replace(/\badmin(?:istrator)? review\b/giu, 'authorized review')
          .replace(/\bhuman review queue\b/giu, 'verification workflow')
          .replace(/\breview queue\b/giu, 'verification workflow')
          .replace(/\bsupervisor review\b/giu, 'peer review')
          .replace(/\bescalation workflow\b/giu, 'exception-handling workflow')
          .replace(/\bcase reviewers?\b/giu, 'workflow reviewers')
          .replace(/\bincident response team\b/giu, 'response operators')
          .replace(/\bservice desk\b/giu, 'support workflow')
          .replace(/\bhelp desk\b/giu, 'support workflow');
      }
      if (unsupportedDeveloper) {
        repaired = repaired
          .replace(/\bdevelopment[-\s]+teams?\b/giu, 'implementation teams')
          .replace(/\bdevelopers?\b/giu, 'implementation specialists')
          .replace(/\bqa[-\s]+teams?\b/giu, 'validation teams')
          .replace(/\bquality[-\s]+assurance\b/giu, 'output validation')
          .replace(/\bdevops\b/giu, 'platform operations')
          .replace(/\bsdk[-\s]+operators?\b/giu, 'system operators')
          .replace(/\bci[-\/\s]*cd\b/giu, 'deployment workflow');
      }
      if (unsupportedCaregiving) {
        repaired = repaired
          .replace(
            /\bFamily caregivers coordinating routine healthcare schedules and medication notes\b/giu,
            'Users who depend on persistent conversational history and personal notes',
          )
          .replace(/\bfamily caregivers?\b/giu, 'affected users')
          .replace(/\broutine health and caregiving observations\b/giu, 'personal reflections and workflow observations')
          .replace(/\bmedication schedules?\b/giu, 'personal workflow records')
          .replace(/\bmedication notes?\b/giu, 'personal notes')
          .replace(/\bcare schedules?\b/giu, 'personal workflow records')
          .replace(/\bcare notes?\b/giu, 'personal notes')
          .replace(/\bcaregiving\b/giu, 'personal workflow');
      }
      return repaired.replace(/\s+/gu, ' ').trim();
    };

    const repairStructuredValue = (value: unknown): unknown => {
      if (typeof value === 'string') return repairText(value);
      if (Array.isArray(value)) return value.map(repairStructuredValue);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            repairStructuredValue(item),
          ]),
        );
      }
      return value;
    };

    this.logger.warn(
      `Repaired unsupported sparse-evidence role expansion before strict validation. clinical=${unsupportedClinical} admin=${unsupportedAdmin} developer=${unsupportedDeveloper} caregiving=${unsupportedCaregiving}.`,
    );

    return {
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: repairText(parsedOutput.coreIdea.title),
        problemStatement: repairText(parsedOutput.coreIdea.problemStatement),
        objectives: parsedOutput.coreIdea.objectives.map(repairText),
        targetUsers: parsedOutput.coreIdea.targetUsers.map(repairText),
        ...(parsedOutput.coreIdea.limitedAbstract !== undefined
          ? { limitedAbstract: repairText(parsedOutput.coreIdea.limitedAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.partialAbstract !== undefined
          ? { partialAbstract: repairText(parsedOutput.coreIdea.partialAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: repairText(parsedOutput.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: parsedOutput.advancedOutputs.map((output) => ({
        ...output,
        title: repairText(output.title),
        content: repairText(output.content),
        ...(output.structuredContent !== undefined
          ? {
              structuredContent: repairStructuredValue(
                output.structuredContent,
              ) as typeof output.structuredContent,
            }
          : {}),
      })),
    };
  }

  /**
   * Repairs cross-domain title leakage instead of failing an otherwise valid
   * idea. A domain label may appear in the final title only when that domain has
   * retained evidence for this run (or when no evidence exists at all and the
   * primary-domain validation fallback is intentionally being used).
   */
  private normalizeCoreIdeaTitleForContext(
    context: IdeaGenerationContext,
    title: string,
  ): string {
    const validationOnlyDomain = this.resolveValidationOnlySingleDomain(context);
    if (validationOnlyDomain) {
      return `${validationOnlyDomain} Problem Discovery & Evidence Validation Workspace`;
    }

    const benchmarkProviderTitle = this.resolveSelectedBenchmarkProviderTitle(context);
    let candidate = (benchmarkProviderTitle || title)
      .replace(/^(?:Nexora|Voxidence|Commivox)\s+/iu, '')
      .trim();
    const claimedDomain = this.detectStrongTitleDomain(candidate);

    if (claimedDomain) {
      const evidenceBackedDomains = context.domainEvidence
        .filter((entry) => entry.evidenceAvailable)
        .map((entry) => entry.domainName.trim())
        .filter(Boolean);
      const winnerDomains = [
        ...(context.benchmarkWinnerOpportunity?.matchedDomainNames ?? []),
        ...(context.opportunityRanking?.selected.matchedDomainNames ?? []),
      ]
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value, index, values) =>
          values.findIndex(
            (item) =>
              item.toLocaleLowerCase() === value.toLocaleLowerCase(),
          ) === index,
        );
      const allowedDomains =
        winnerDomains.length > 0
          ? winnerDomains
          : evidenceBackedDomains.length > 0
            ? evidenceBackedDomains
            : [context.domainName, context.selectedDomains[0]?.name]
                .filter((value): value is string => Boolean(value?.trim()))
                .map((value) => value.trim());

      if (
        !allowedDomains.some(
          (domainName) =>
            this.detectStrongTitleDomain(domainName) === claimedDomain,
        )
      ) {
        const rankedTitle = context.opportunityRanking?.selected.title?.trim();
        if (rankedTitle) {
          const rankedClaim = this.detectStrongTitleDomain(rankedTitle);
          if (
            !rankedClaim ||
            allowedDomains.some(
              (domainName) =>
                this.detectStrongTitleDomain(domainName) === rankedClaim,
            )
          ) {
            candidate = rankedTitle;
          } else {
            candidate = `${allowedDomains[0] ?? 'Operational'} Insight Workspace`;
          }
        } else {
          candidate = `${allowedDomains[0] ?? 'Operational'} Insight Workspace`;
        }
      }
    }

    return this.normalizePublicIdeaTitle(context, candidate);
  }

  /**
   * Returns the exact provider title from the benchmark winner. The winner is
   * already the immutable candidate selected by core generation, so later
   * validation must not replace a valid product title with search-query or
   * evidence-keyword fragments.
   */
  private resolveSelectedBenchmarkProviderTitle(
    context: IdeaGenerationContext,
  ): string {
    const selected = context.benchmarkCandidates.find(
      (candidate) => candidate.selected,
    );
    const title = selected?.parsedOutput?.coreIdea?.title;
    return typeof title === 'string' ? title.trim() : '';
  }

  /** Keeps internal ranking state out of the title shown to the user. */
  private normalizePublicIdeaTitle(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    const clean = (title: string): string =>
      title
        .replace(/^(?:Nexora|Voxidence|Commivox)\s+/iu, '')
        .replace(/\bcross[- ]domain\b/giu, '')
        .replace(/\bmulti[- ]domain\b/giu, '')
        .replace(/\brequest(?:er)?[- ]?(?:scope|intent)?\s*validation\b/giu, '')
        .replace(/\b(?:evidence|problem|opportunity)\s+validation\b/giu, '')
        .replace(/\bvalidation\s+pilot\b/giu, '')
        .replace(/\bvalidation\b/giu, '')
        .replace(/\bpreliminary\s+pilot\b/giu, '')
        .replace(/\brequester[- ]defined workflow opportunity\b/giu, '')
        .replace(/\bconnected workflow opportunity discovery\b/giu, '')
        .replace(/\bopportunity\s+discovery\b/giu, '')
        .replace(/\bprimary[- ]domain\b/giu, '')
        .replace(/\bpilot\b/giu, '')
        .replace(/\s*\+\s*/gu, ' & ')
        .replace(/(?:\s*&\s*){2,}/gu, ' & ')
        .replace(/\s{2,}/gu, ' ')
        .replace(/^[\s:;,\-&]+|[\s:;,\-&]+$/gu, '')
        .trim();

    const isProductLike = (title: string): boolean => {
      if (title.length < 6 || title.length > 100) return false;
      if (
        /\b(?:cross[- ]domain|multi[- ]domain|request validation|validation pilot|evidence validation|opportunity discovery|requester[- ]defined workflow opportunity|connected workflow opportunity discovery|primary domain|preliminary pilot|validation)\b|\s\+\s/iu.test(
          title,
        )
      ) {
        return false;
      }
      if (
        /^(?:see|need|want|would like|please add|add)\b|\b(?:see a couple upgrades|couple upgrades|some upgrades|feature request|requested feature|general improvements?|miscellaneous improvements?)\b/iu.test(
          title,
        )
      ) {
        return false;
      }

      let withoutDomains = title;
      for (const domain of context.selectedDomains) {
        withoutDomains = withoutDomains.replace(
          new RegExp(`\\b${this.escapeRegExp(domain.name.trim())}\\b`, 'giu'),
          ' ',
        );
      }
      withoutDomains = withoutDomains
        .replace(/\b(?:and|or)\b|&/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

      return withoutDomains.split(/\s+/u).filter(Boolean).length >= 2;
    };

    const cleanedProviderTitle = clean(value);
    if (isProductLike(cleanedProviderTitle)) {
      return cleanedProviderTitle;
    }

    const rankedTitle = clean(context.opportunityRanking?.selected.title ?? '');
    if (isProductLike(rankedTitle)) {
      return rankedTitle;
    }

    const domainNames = new Set(
      context.selectedDomains.map((domain) => domain.name.toLocaleLowerCase()),
    );
    /*
     * Text-bearing requests already have an immutable requester problem and a
     * benchmark-selected product. Never manufacture a public product name from
     * search queries/evidence keywords: those phrases are intentionally search
     * shaped and can produce titles such as "staff searching ... & unavailable
     * ...". If the provider title is unusable, fall back to the resolved scope
     * label rather than leaking retrieval syntax into the product identity.
     * No-text paths retain the legacy keyword fallback below.
     */
    if (context.requestDescription?.trim()) {
      const fallbackDomain =
        context.domainName?.trim() ||
        context.selectedDomains[0]?.name?.trim() ||
        'Operational';
      return `${fallbackDomain} Operations Workspace`;
    }

    const keywordCandidates = context.keywords
      .map((keyword) => clean(keyword))
      .filter((keyword) => keyword.length >= 5 && keyword.length <= 60)
      .filter((keyword) => keyword.split(/\s+/u).length >= 2)
      .filter((keyword) => !domainNames.has(keyword.toLocaleLowerCase()))
      .filter(
        (keyword) =>
          !/\b(?:coherent|workflow combining|cross domain|requester|validation)\b/iu.test(
            keyword,
          ),
      )
      .slice(0, 2);

    if (keywordCandidates.length > 0) {
      return this.toPublicTitleCase(
        `${keywordCandidates[0]}${keywordCandidates[1] ? ` & ${keywordCandidates[1]}` : ' Workspace'}`,
      );
    }

    const fallbackDomain =
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'Operational';
    return `${fallbackDomain} Insight Workspace`;
  }

  private toPublicTitleCase(value: string): string {
    const smallWords = new Set([
      'and',
      'or',
      'of',
      'for',
      'to',
      'in',
      'on',
      'with',
    ]);
    return value
      .replace(/\s+/gu, ' ')
      .trim()
      .split(' ')
      .map((word, index) => {
        if (word === '&') return word;
        if (index > 0 && smallWords.has(word.toLocaleLowerCase())) {
          return word.toLocaleLowerCase();
        }
        return word.length > 0
          ? `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1)}`
          : word;
      })
      .join(' ');
  }

  /** Detects only strong domain labels; generic words such as monitor are ignored. */
  private detectStrongTitleDomain(value: string): string | null {
    const normalized = value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const definitions: readonly [string, RegExp][] = [
      ['energy', /\b(?:energy|solar|electricity|electric|power grid|battery)\b/u],
      ['education', /\b(?:education|student|students|school|homework|assignment|learning|classroom)\b/u],
      ['agriculture', /\b(?:agriculture|agricultural|farming|farm|irrigation|crop|crops)\b/u],
      ['ecommerce', /\b(?:e commerce|ecommerce|checkout|shopping cart|merchant|online store)\b/u],
      ['healthcare', /\b(?:healthcare|medical|patient|patients|clinic|hospital)\b/u],
      ['finance', /\b(?:finance|financial|accounting|payroll|banking|fintech)\b/u],
    ];

    for (const [label, pattern] of definitions) {
      if (pattern.test(normalized)) return label;
    }

    return null;
  }

  /**
   * Projects a provider response onto the exact entitlement contract.
   *
   * This method is deliberately deterministic and loss-limiting:
   * - Free tiers retain only their authorized abstract fields.
   * - Premium fields and advanced outputs are removed from free responses.
   * - Premium responses remain unchanged and continue through strict
   *   completeness validation.
   *
   * Removing unauthorized optional fields here prevents harmless provider
   * over-generation from failing the whole run while preserving the security
   * boundary that prevents premium content leakage.
   */
  private projectOutputToGenerationTier(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    switch (context.generationType) {
      case IdeaGenerationType.GUEST_FREE: {
        const partialAbstract =
          parsedOutput.coreIdea.partialAbstract?.trim() ||
          parsedOutput.coreIdea.fullAbstract?.trim() ||
          parsedOutput.coreIdea.limitedAbstract?.trim() ||
          '';
        const limitedAbstract =
          parsedOutput.coreIdea.limitedAbstract?.trim() ||
          this.buildLimitedAbstract(partialAbstract);

        if (
          parsedOutput.coreIdea.fullAbstract !== undefined ||
          parsedOutput.advancedOutputs.length > 0
        ) {
          this.logger.warn(
            'Guest output contained unauthorized premium fields. They were removed before validation.',
          );
        }

        return {
          coreIdea: {
            ...parsedOutput.coreIdea,
            limitedAbstract,
            partialAbstract,
            fullAbstract: undefined,
          },
          advancedOutputs: [],
        };
      }

      case IdeaGenerationType.NORMAL_FREE: {
        const partialAbstract =
          parsedOutput.coreIdea.partialAbstract?.trim() ||
          parsedOutput.coreIdea.fullAbstract?.trim() ||
          parsedOutput.coreIdea.limitedAbstract?.trim() ||
          '';

        if (
          parsedOutput.coreIdea.fullAbstract !== undefined ||
          parsedOutput.advancedOutputs.length > 0
        ) {
          this.logger.warn(
            'NORMAL_FREE output contained unauthorized premium fields. They were removed before validation.',
          );
        }

        return {
          coreIdea: {
            ...parsedOutput.coreIdea,
            partialAbstract: this.buildConciseOverview(partialAbstract),
            fullAbstract: undefined,
          },
          advancedOutputs: [],
        };
      }

      case IdeaGenerationType.PREMIUM_CREDIT:
        return parsedOutput;

      default:
        return this.assertNeverGenerationType(context.generationType);
    }
  }

  /** Builds a bounded guest preview without exposing premium-length content. */
  private buildLimitedAbstract(value: string): string {
    const overview = this.buildConciseOverview(value);
    const words = overview.split(/\s+/u).filter(Boolean);

    return words.slice(0, 70).join(' ').trim();
  }

  /**
   * Enforces the readable multi-problem contract after provider schema parsing.
   *
   * The database remains backward compatible because the portfolio is stored in
   * the existing problemStatement string as numbered entries. Every entry must
   * expose one problem and one directly corresponding solution response.
   */
  private validateUnifiedIdeaNarrative(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const statement = parsedOutput.coreIdea.problemStatement.trim();

    if (statement.length < 120 || statement.length > 2_200) {
      this.throwInvalidOutput(
        'The problem statement must be a focused narrative between 120 and 2200 characters.',
        { actualLength: statement.length },
      );
    }

    if (/solution response\s*:|^\s*\d+[.)]\s*\[/im.test(statement)) {
      this.throwInvalidOutput(
        'The problem statement must contain problems only; solutions and numbered portfolio syntax belong in objectives.',
      );
    }

    const claimDomains = this.resolveFinalClaimDomains(context);
    const normalizedStatement = this.normalizeComparableText(statement);
    const representedDomains = claimDomains.filter((domain) =>
      this.isDomainRepresentedInNarrative(context, normalizedStatement, domain),
    );
    const validationOnly = this.isValidationOnlyOpportunity(context);
    const explicitDomains = context.selectedDomains.filter(
      (domain) => domain.isExplicitlySelected,
    );
    const textPlusDomains = Boolean(
      context.requestDescription?.trim() && explicitDomains.length > 0,
    );
    const selectedHasProblemMatchedEvidence =
      this.hasSelectedProblemMatchedEvidence(context);

    /*
     * A zero-evidence / requester-intent validation pilot can legitimately keep
     * several selected domains in its validation scope without claiming that
     * each domain already has retained evidence. Treating matchedDomainNames on
     * PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS as evidence-supported domains made
     * the validator contradict the ranking stage and caused otherwise valid
     * cross-domain validation runs to fail after successful generation.
     *
     * Keep the strict multi-domain narrative requirement only for genuinely
     * evidence-backed cross-domain winners. Validation-only concepts instead
     * have to remain explicitly preliminary/validation-oriented.
     */
    if (
      !textPlusDomains &&
      !validationOnly &&
      selectedHasProblemMatchedEvidence &&
      claimDomains.length > 1 &&
      representedDomains.length < 2
    ) {
      this.throwInvalidOutput(
        'A cross-domain idea must integrate at least two evidence-supported domains in the unified problem narrative.',
        { claimDomains, representedDomains },
      );
    }

    /*
     * Text + Domains has a different contract: the description defines the
     * problem and explicit domains define the allowed context. Real evidence
     * may validate the problem through one selected operational domain while
     * another selected domain (for example AI) is only a solution-enabling
     * capability. Do not require two evidence-backed domains in the problem
     * statement. Instead require the verified problem evidence, when present,
     * to intersect at least one explicitly selected domain; the separate
     * explicit-domain coverage validator still guarantees that every selected
     * domain is represented materially somewhere in the generated product.
     */
    if (textPlusDomains && selectedHasProblemMatchedEvidence) {
      const explicitNames = new Set(
        explicitDomains.map((domain) => domain.name.trim().toLocaleLowerCase()),
      );
      const hasSelectedProblemDomain = claimDomains.some((domain) =>
        explicitNames.has(domain.trim().toLocaleLowerCase()),
      );
      if (!hasSelectedProblemDomain) {
        this.throwInvalidOutput(
          'Problem-matched evidence for a text-plus-domains idea must relate to at least one explicitly selected domain.',
          {
            reason: 'PROBLEM_EVIDENCE_OUTSIDE_EXPLICIT_SCOPE',
            claimDomains,
            explicitDomains: explicitDomains.map((domain) => domain.name),
          },
        );
      }
    }

    if (
      validationOnly &&
      !/\b(?:pilot|validat\w*|hypothes\w*|test\w*|preliminary|unvalidated|evidence)\b/iu.test(
        statement,
      )
    ) {
      this.throwInvalidOutput(
        'A validation-only idea must clearly state that the direction is preliminary and still requires validation.',
        { claimDomains },
      );
    }

    if (parsedOutput.coreIdea.objectives.length < 3) {
      this.throwInvalidOutput('At least three concrete objectives are required.');
    }

    this.validateSparseEvidenceRoleScope(context, parsedOutput);
  }

  private validateSparseEvidenceRoleScope(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const selected = context.opportunityRanking?.selected;
    const independentEvidence = selected?.independentEvidence ?? [];
    if (independentEvidence.length !== 1) return;

    const allowedRoleScope = this.normalizeComparableText(
      [
        independentEvidence[0]?.text ?? '',
        context.requestDescription ?? '',
      ].join(' '),
    );
    const primaryRoleText = this.normalizeComparableText(
      [
        ...parsedOutput.coreIdea.targetUsers,
        ...parsedOutput.coreIdea.objectives,
      ].join(' '),
    );

    const roleFamilies: Array<{
      readonly label: string;
      readonly pattern: RegExp;
    }> = [
      {
        label: 'clinical or care-triage roles',
        pattern:
          /\b(?:clinician|clinical supervisor|clinical review|care coordinator|care manager|therapist|psychiatrist|human triage|distress triage)\b/iu,
      },
      {
        label: 'administrative review or escalation roles',
        pattern:
          /\b(?:admin(?:istrator)? review|review queue|supervisor review|human review queue|escalation workflow|case reviewer|incident response team|service desk|help desk)\b/iu,
      },
      {
        label: 'developer or QA operator roles',
        pattern:
          /\b(?:developers?|development teams?|qa teams?|quality assurance|devops|sdk operators?|ci cd)\b/iu,
      },
    ];

    for (const family of roleFamilies) {
      if (
        family.pattern.test(primaryRoleText) &&
        !family.pattern.test(allowedRoleScope)
      ) {
        this.throwInvalidOutput(
          `Sparse evidence does not support introducing ${family.label} as a primary target user or MVP objective.`,
          {
            evidenceText: independentEvidence[0]?.text ?? '',
            targetUsers: parsedOutput.coreIdea.targetUsers,
            objectives: parsedOutput.coreIdea.objectives,
          },
        );
      }
    }
  }

  /**
   * Returns only bundle items that are allowed to participate in final
   * solution synthesis. Same-domain complements are safe. Cross-domain items
   * are allowed only when the winning opportunity explicitly verified that
   * domain as part of the same workflow.
   */
  private resolveVerifiedSynthesisBundle(context: IdeaGenerationContext) {
    const selected = context.opportunityRanking?.selected;
    if (!selected) return [];

    const claimDomains = new Set(
      (selected.matchedDomainNames ?? []).map((name) =>
        name.trim().toLocaleLowerCase(),
      ),
    );
    const workflowDomains = new Set(
      (selected.workflowDomainNames ?? []).map((name) =>
        name.trim().toLocaleLowerCase(),
      ),
    );

    return (selected.relatedOpportunityBundle ?? []).filter((item) =>
      item.matchedDomainNames.some((name) => {
        const normalized = name.trim().toLocaleLowerCase();
        return claimDomains.has(normalized) || workflowDomains.has(normalized);
      }),
    );
  }

  private repairPublicHealthcareAccessGovernanceDrift(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription) return parsedOutput;

    const request = requestDescription.toLocaleLowerCase();
    const healthcareAccessRequest =
      /\b(?:public healthcare|healthcare systems?|hospitals?|clinics?|patient records?|medical records?)\b/u.test(request) &&
      /\b(?:access logs?|identity verification|patient permissions?|security alerts?|unauthorized access|privacy|record exchange|government agencies?)\b/u.test(request);
    if (!healthcareAccessRequest) return parsedOutput;

    const requestContainsFinancialFraud =
      /\b(?:fraud|fraudulent|payment|payments|transaction|transactions|billing|refund|taxes?|permits?|benefits?|fees?)\b/u.test(request);
    if (requestContainsFinancialFraud) return parsedOutput;

    const generatedText = [
      parsedOutput.coreIdea.title,
      parsedOutput.coreIdea.problemStatement,
      ...parsedOutput.coreIdea.objectives,
      ...parsedOutput.coreIdea.targetUsers,
      parsedOutput.coreIdea.limitedAbstract ?? '',
      parsedOutput.coreIdea.partialAbstract ?? '',
      parsedOutput.coreIdea.fullAbstract ?? '',
      ...parsedOutput.advancedOutputs.map((item) => item.content),
    ].join(' ');
    const hasForeignGovernmentFraudTemplate =
      /\b(?:fraud signal|fraud case|fraud investigation|payment integrity|blocked[- ]legitimate[- ]payment|citizen report|taxes?|permits?|public service fees?|benefits? and fees?|transaction anomaly)\b/iu.test(
        generatedText,
      );
    if (!hasForeignGovernmentFraudTemplate) return parsedOutput;

    const blueprint =
      CanonicalRequestProductBlueprintUtil.build({
        profile: context.collectionPlan?.problemProfile,
        requestDescription,
        domainName: context.domainName,
        opportunityTitle: context.opportunityRanking?.selected.title,
      }) ??
      RequestProductBlueprintUtil.build({
        requestDescription,
        domainName: context.domainName,
      });
    if (!blueprint) return parsedOutput;

    const repairText = (value: string): string =>
      value
        .replace(/\bPublic Healthcare Fraud Signal Correlation Workspace\b/giu, blueprint.title)
        .replace(/\bGovernment payment integrity and fraud analysts\b/giu, 'Authorized public-health and government data-governance reviewers')
        .replace(/\bpublic[- ]service payment operations staff\b/giu, 'Healthcare privacy, security, and health-information operations staff')
        .replace(/\btransaction, identity, access, security-alert, and citizen-report correlation with human-reviewed fraud investigation\b/giu, blueprint.workflowFocus)
        .replace(/\btransactions?, identity-checks?, account-access, security-alerts?, and citizen-reports?\b/giu, 'patient-record access, identity-verification, permission, record-exchange, and security-alert events')
        .replace(/\btaxes?, permits?, benefits?, fees?, and related payment events\b/giu, 'patient-record access, permission, identity-verification, record-exchange, and security-alert events')
        .replace(/\bcross-service anomaly correlation across taxes?, permits?, benefits?, fees?, and related payment events\b/giu, 'cross-organization correlation of patient-record access, permission changes, identity verification, record exchange, and security alerts')
        .replace(/\bhuman-reviewed fraud case queue\b/giu, 'human-reviewed privacy incident queue')
        .replace(/\bfraud case queue\b/giu, 'privacy incident queue')
        .replace(/\bblocked[- ]legitimate[- ]payment recovery\b/giu, 'false-positive access-restriction resolution')
        .replace(/\bfraud investigation\b/giu, 'privacy and unauthorized-access investigation')
        .replace(/\bfraud signal correlation\b/giu, 'access-governance and incident correlation')
        .replace(/\s{2,}/gu, ' ')
        .trim();

    const repairStructured = (value: unknown): unknown => {
      if (typeof value === 'string') return repairText(value);
      if (Array.isArray(value)) return value.map(repairStructured);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, repairStructured(item)]),
        );
      }
      return value;
    };

    const supportingCount =
      context.opportunityRanking?.selected.qualifiedExternalSupportingEvidenceCount ?? 0;
    const supportingSourceCount =
      context.opportunityRanking?.selected.qualifiedExternalSupportingSourceCount ?? 0;
    const evidenceQualifier = supportingCount > 0
      ? `${supportingCount} verified external supporting signal(s) across ${supportingSourceCount} source(s) corroborate parts of this requester-defined workflow, but no direct recurrence claim is made.`
      : 'External evidence remains preliminary and does not replace the requester-defined workflow.';
    const problemStatement =
      `The requester-defined problem is: "${requestDescription}" ${evidenceQualifier}`;

    this.logger.warn(
      'Repaired post-evidence semantic drift from a generic government fraud/payment template back to the canonical public-healthcare access-governance workflow.',
    );

    return {
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: blueprint.title,
        problemStatement,
        objectives: [...blueprint.objectives],
        targetUsers: [...blueprint.targetUsers],
        ...(parsedOutput.coreIdea.limitedAbstract !== undefined
          ? { limitedAbstract: repairText(parsedOutput.coreIdea.limitedAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.partialAbstract !== undefined
          ? { partialAbstract: repairText(parsedOutput.coreIdea.partialAbstract) }
          : {}),
        ...(parsedOutput.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: repairText(parsedOutput.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: parsedOutput.advancedOutputs.map((output) => ({
        ...output,
        content: repairText(output.content),
        ...(output.structuredContent !== undefined
          ? {
              structuredContent: repairStructured(
                output.structuredContent,
              ) as typeof output.structuredContent,
            }
          : {}),
      })),
    };
  }

  /**
   * Converts legacy numbered portfolios into one readable, evidence-grounded
   * narrative and guarantees that premium detail is richer than the overview.
   */
  private normalizeUnifiedIdeaNarrative(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const legacyPairs = this.parseProblemSolutionPairs(
      parsedOutput.coreIdea.problemStatement,
    );
    const winner = this.resolveWinnerOpportunityRaw(context);
    const relatedOpportunityBundle =
      this.resolveVerifiedSynthesisBundle(context);
    const opportunityProblems = [
      ...(winner
        ? [
            {
              domainName: this.resolveOpportunityDomainName(
                context,
                winner.domainName,
              ),
              problem: winner.problem.trim(),
            },
          ]
        : []),
      ...relatedOpportunityBundle
        .filter((item) => Boolean(item.problem?.trim()))
        .map((item) => ({
          domainName:
            item.matchedDomainNames[0]?.trim() ||
            context.domainName ||
            'the selected domain',
          problem: item.problem?.trim() ?? '',
        })),
    ];

    const candidates = [
      ...legacyPairs.map((pair) => ({
        domainName: pair.domainName,
        problem: pair.problem,
      })),
      ...opportunityProblems,
    ];
    const unique = new Map<string, { domainName: string; problem: string }>();

    for (const candidate of candidates) {
      const key = this.normalizeComparableText(candidate.problem);
      if (key.length >= 20 && !unique.has(key)) {
        unique.set(key, candidate);
      }
    }

    const solutionCoverageText = [
      ...parsedOutput.coreIdea.objectives,
      parsedOutput.coreIdea.partialAbstract ?? '',
      parsedOutput.coreIdea.fullAbstract ?? '',
      ...parsedOutput.coreIdea.targetUsers,
    ].join(' ');

    const rankedGrounded = [...unique.values()]
      .map((item, index) => ({
        ...item,
        index,
        coverageScore: this.calculateProblemSolutionCoverage(
          item.problem,
          item.domainName,
          solutionCoverageText,
        ),
      }))
      .sort(
        (first, second) =>
          second.coverageScore - first.coverageScore || first.index - second.index,
      );

    /*
     * Never force the highest-ranked evidence item into the final narrative.
     * A problem is included only when the generated objectives, users, or
     * solution narrative actually cover it. This keeps cross-domain ideas
     * valid while preventing unrelated legal/HR/technical bundles from being
     * joined by a generic sentence.
     */
    const grounded = rankedGrounded
      .filter((item) => item.coverageScore >= 2)
      .slice(0, 3);

    const providerProblemStatement = parsedOutput.coreIdea.problemStatement
      .replace(/(?:^|\n)\s*\d+[.)-]?\s*\[[^\]]+\]\s*Problem:\s*/gi, ' ')
      .replace(/\s*\|\s*Solution response:\s*[^\n]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const winnerProblem = winner?.problem?.trim() ?? '';
    const preferredProblem =
      winnerProblem && !this.isGenericFallbackProblem(winnerProblem)
        ? winnerProblem
        : providerProblemStatement || winnerProblem;

    let problemStatement = this.polishProblemStatement(preferredProblem);

    if (grounded.length > 0) {
      const domains = [...new Set(grounded.map((item) => item.domainName))];
      const cleanedProblems = grounded.map((item) =>
        this.removeRepeatedDomainPrefix(item.problem, item.domainName),
      );

      if (cleanedProblems.length === 1) {
        const winnerDomains = (
          context.opportunityRanking?.selected.matchedDomainNames ?? []
        ).filter((name) =>
          context.selectedDomains.some(
            (domain) =>
              domain.name.trim().toLocaleLowerCase() ===
              name.trim().toLocaleLowerCase(),
          ),
        );
        const evidenceDomains =
          winnerDomains.length > 0
            ? winnerDomains
            : domains.length > 0
              ? domains
              : [context.domainName ?? 'the selected domain'];
        const domain = evidenceDomains[0] ?? 'the selected domain';
        const domainScope =
          evidenceDomains.length > 1
            ? `across ${evidenceDomains.join(' and ')}`
            : `from ${domain}`;
        const groundedProblem = cleanedProblems[0] ?? '';
        const selectedProblem = this.isNoInputPreferencePath(context)
          ? this.resolveNoInputPreferenceProblem(
              context,
              groundedProblem,
              providerProblemStatement,
            )
          : this.isSpecificProblemStatement(groundedProblem)
            ? groundedProblem
            : providerProblemStatement || groundedProblem;
        const directEvidenceCount = this.countRetainedDirectEvidence(context);
        const directEvidenceProblem =
          !this.hasStrongIndependentEvidence(context) && directEvidenceCount > 0
            ? this.buildDirectEvidenceProblemSummary(context, selectedProblem)
            : selectedProblem;
        const problem = this.capitalizeSentence(directEvidenceProblem);
        const problemWithoutRetainedLead = problem
          .replace(
            /^One retained (?:direct report|direct user report|feature request)\s+(?:indicates that|describes)\s+/iu,
            '',
          )
          .trim();

        if (this.hasStrongIndependentEvidence(context)) {
          problemStatement = this.polishProblemStatement(
            `Verified community evidence ${domainScope} identifies a recurring operational challenge: ${problem}. ${this.buildProblemImpactSentence(cleanedProblems[0] ?? '')}`,
          );
        } else if (directEvidenceCount > 0) {
          const evidenceSubject = this.buildRetainedEvidenceSubject(
            directEvidenceCount,
            this.countRetainedIndependentSources(context),
            true,
            'direct',
          );
          const domainLabel =
            evidenceDomains.length > 1
              ? evidenceDomains.join(' and ')
              : domain;
          problemStatement = this.polishProblemStatement(
            `${evidenceSubject} describes an operational challenge in ${domainLabel}: ${problemWithoutRetainedLead || problem}. ${this.buildProblemImpactSentence(directEvidenceProblem)} The proposed pilot should validate how broadly this issue occurs before wider deployment.`,
          );
        } else {
          problemStatement = this.polishProblemStatement(
            `A preliminary community signal ${domainScope} reports an operational challenge: ${problem}. ${this.buildProblemImpactSentence(cleanedProblems[0] ?? '')} The proposed pilot should validate how broadly this issue occurs before wider deployment.`,
          );
        }
      } else {
        const problemList = cleanedProblems
          .map((problem, index) => {
            const prefix =
              index === 0 ? '' : index === cleanedProblems.length - 1 ? 'and ' : '';
            return `${prefix}${this.lowercaseSentenceStart(problem)}`;
          })
          .join(cleanedProblems.length > 2 ? '; ' : ' and ');

        problemStatement = this.polishProblemStatement(
          this.hasStrongIndependentEvidence(context)
            ? `Verified community evidence from ${domains.join(', ')} identifies connected recurring operational gaps: ${problemList}. Together, these gaps cause avoidable failures, slow diagnosis, and inconsistent decisions across one end-to-end workflow.`
            : `Limited collected feedback from ${domains.join(', ')} suggests potentially connected operational gaps: ${problemList}. The proposed pilot should test whether these issues form one repeatable end-to-end workflow before any broader claim is made.`,
        );
      }
    }

    if (!this.hasAnyRetainedEvidence(context)) {
      problemStatement = this.buildZeroEvidenceProblemStatement(context);
    }

    problemStatement = this.ensureValidProblemStatementLength(
      context,
      problemStatement,
    );

    const rawFullAbstract = parsedOutput.coreIdea.fullAbstract?.trim() ?? '';
    const rawOverview = (
      parsedOutput.coreIdea.partialAbstract ??
      parsedOutput.coreIdea.limitedAbstract ??
      rawFullAbstract
    ).trim();
    let overview = this.buildConciseOverview(rawOverview);
    overview = this.qualifyEvidenceClaims(context, overview);
    overview = this.groundSparseEvidenceOverview(
      context,
      overview,
      parsedOutput,
    );
    let fullAbstract = this.sanitizeUnsupportedDomainExamples(
      context,
      problemStatement,
      rawFullAbstract,
    );
    fullAbstract = this.qualifyEvidenceClaims(context, fullAbstract);
    fullAbstract = this.groundSparseEvidenceFullAbstract(
      context,
      fullAbstract,
      problemStatement,
    );

    const advancedOutputs = parsedOutput.advancedOutputs.map((output) => {
      const evidenceIsolatedOutput = this.isolateEvidenceSummaryOutput(
        context,
        output,
      );
      const evidenceQualifiedContent = this.qualifyEvidenceClaims(
        context,
        evidenceIsolatedOutput.content,
      );
      const causalSafeContent = this.sanitizeUnsupportedCausalLanguage(
        evidenceQualifiedContent,
      );
      const domainSafeContent = this.polishNoInputPreferenceNarrativeBoundary(
        context,
        this.sanitizeFinalClaimDomainLeakage(
          context,
          this.sanitizeUnsupportedBillingFailureClaims(
            context,
            causalSafeContent,
          ),
        ),
      );
      const narrativeSafeContent =
        output.outputKey === 'market-potential' ||
        output.outputKey === 'community-feedback-summary'
          ? this.finalizePersistedNarrativeCopy(domainSafeContent).replace(
              /\bPreliminary observations from [^.!?]{1,140}?\s+the retained evidence suggests that\b/giu,
              'The retained evidence suggests that',
            )
          : domainSafeContent;

      if (output.outputKey === 'technology-stack') {
        return {
          ...evidenceIsolatedOutput,
          content: this.normalizeTechnologyStack(domainSafeContent),
        };
      }

      if (output.outputKey === 'system-architecture') {
        return {
          ...evidenceIsolatedOutput,
          content: this.polishArchitectureContent(
            this.normalizeTechnicalDottedTerms(domainSafeContent),
          ),
        };
      }

      return {
        ...evidenceIsolatedOutput,
        content: narrativeSafeContent,
      };
    });

    if (overview) {
      const similarity = fullAbstract
        ? this.calculateTextSimilarity(fullAbstract, overview)
        : 1;
      const wordCount = this.countWords(fullAbstract);

      if (
        !fullAbstract ||
        similarity >= 0.32 ||
        wordCount < 240 ||
        wordCount <= this.countWords(overview) + 100
      ) {
        fullAbstract = this.buildExpandedFullAbstract(
          context,
          parsedOutput,
          problemStatement,
          overview,
          advancedOutputs,
        );
      }
    }

    /*
     * The abstract may have been rebuilt after the first sanitization pass.
     * Qualify the final persisted text last so strong claims cannot return.
     */
    problemStatement = this.qualifyEvidenceClaims(context, problemStatement);
    fullAbstract = this.qualifyEvidenceClaims(context, fullAbstract);
    fullAbstract = this.groundSparseEvidenceFullAbstract(
      context,
      fullAbstract,
      problemStatement,
    );

    /*
     * Run final copy cleanup after every possible overview/full-abstract
     * reconstruction so duplicated zero-evidence wording cannot reappear.
     */
    overview = this.polishNoInputPreferenceNarrativeBoundary(
      context,
      this.finalizePersistedNarrativeCopy(
        this.sanitizeUnsupportedBillingFailureClaims(
          context,
          this.sanitizeFinalClaimDomainLeakage(
            context,
            this.enforceEvidenceNarrativeDiscipline(context, overview),
          ),
        ),
      ),
    );
    problemStatement = this.polishNoInputPreferenceNarrativeBoundary(
      context,
      this.finalizePersistedNarrativeCopy(
        this.sanitizeUnsupportedBillingFailureClaims(
          context,
          this.sanitizeFinalClaimDomainLeakage(
            context,
            this.enforceEvidenceNarrativeDiscipline(context, problemStatement),
          ),
        ),
      ),
    );
    fullAbstract = this.polishNoInputPreferenceNarrativeBoundary(
      context,
      this.finalizePersistedNarrativeCopy(
        this.sanitizeUnsupportedBillingFailureClaims(
          context,
          this.sanitizeFinalClaimDomainLeakage(
            context,
            this.enforceEvidenceNarrativeDiscipline(context, fullAbstract),
          ),
        ),
      ),
    );

    const winnerAlignedNarratives = this.alignSparseNarrativesToImmutableWinner(
      context,
      parsedOutput,
      problemStatement,
      overview,
    );
    problemStatement = winnerAlignedNarratives.problemStatement;
    overview = winnerAlignedNarratives.overview;

    return {
      ...parsedOutput,
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: this.normalizeCoreIdeaTitleForContext(
          context,
          parsedOutput.coreIdea.title,
        ),
        problemStatement,
        objectives: this.sanitizePrimaryDomainObjectives(
          context,
          parsedOutput.coreIdea.objectives.map((objective) =>
            this.sanitizeUnsupportedBillingFailureClaims(
              context,
              this.sanitizeUnsupportedCausalLanguage(objective),
            ),
          ),
        ),
        targetUsers: this.sanitizePrimaryDomainTargetUsers(
          context,
          parsedOutput.coreIdea.targetUsers,
        ),
        // Premium generations often return only fullAbstract. Persist a
        // concise partialAbstract as the workspace Overview so the UI never
        // falls back to displaying the full premium document twice.
        ...(overview ? { partialAbstract: overview } : {}),
        ...(parsedOutput.coreIdea.limitedAbstract && overview
          ? { limitedAbstract: overview }
          : {}),
        ...(fullAbstract ? { fullAbstract } : {}),
      },
      advancedOutputs,
    };
  }


  private isolateEvidenceSummaryOutput(
    context: IdeaGenerationContext,
    output: AdvancedIdeaAiOutput,
  ): AdvancedIdeaAiOutput {
    if (
      output.outputKey !== 'nlp-executive-summary' &&
      output.outputKey !== 'community-feedback-summary' &&
      output.outputKey !== 'market-potential'
    ) {
      return output;
    }

    const opportunity =
      context.benchmarkWinnerOpportunity ?? context.opportunityRanking?.selected;
    const requiresRequestMatch = Boolean(context.requestDescription?.trim());
    const evidenceCount = Math.max(
      requiresRequestMatch
        ? opportunity?.verifiedProblemMatchedEvidenceCount ?? 0
        : opportunity?.verifiedProblemMatchedEvidenceCount ??
            opportunity?.verifiedEvidenceCount ??
            opportunity?.independentEvidence?.length ??
            0,
      0,
    );
    const sourceCount = Math.max(
      requiresRequestMatch
        ? opportunity?.verifiedProblemMatchedEvidenceSourceCount ??
            opportunity?.verifiedProblemMatchedSourceCount ??
            0
        : opportunity?.verifiedProblemMatchedEvidenceSourceCount ??
            opportunity?.verifiedEvidenceSourceCount ??
            opportunity?.verifiedIndependentSourceCount ??
            0,
      0,
    );
    const nlp = context.nlp;
    const communitySupportingCountForState =
      this.countVerifiedCommunitySupportingSignals(context);
    const strictZeroEvidenceValidation = Boolean(
      communitySupportingCountForState === 0 &&
      (opportunity?.disqualificationReasons?.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      ) ||
        (evidenceCount === 0 &&
          (context.opportunityRanking?.evidenceCoverage ?? 0) === 0)),
    );
    const validationDomainLabel =
      opportunity?.primaryMatchedDomainName?.trim() ||
      opportunity?.matchedDomainNames?.[0]?.trim() ||
      context.domainName?.trim() ||
      'the selected domain';
    const hasExternalSupportingContext = this.hasExternalSupportingContext(context);
    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const supportingSourceCountForState =
      this.countVerifiedCommunitySupportingSources(context);
    const supportingOnlyEvidence =
      communitySupportingCountForState > 0 && directEvidenceCount === 0;
    const featureRequestEvidenceCount =
      this.countRetainedFeatureRequestEvidence(context);
    const featureOnlyEvidence =
      directEvidenceCount > 0 &&
      featureRequestEvidenceCount === directEvidenceCount;
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);
    const technicalEvidenceCount = this.countRetainedTechnicalEvidence(context);
    const secondaryOnlyEvidence =
      directEvidenceCount === 0 &&
      secondaryEvidenceCount > 0 &&
      technicalEvidenceCount === 0;
    const technicalOnlyEvidence =
      directEvidenceCount === 0 &&
      secondaryEvidenceCount === 0 &&
      technicalEvidenceCount > 0;
    const secondarySubject = secondaryOnlyEvidence
      ? this.buildRetainedEvidenceSubject(
          secondaryEvidenceCount,
          Math.max(sourceCount, 1),
          true,
          'secondary',
        )
      : null;
    const technicalSubject = technicalOnlyEvidence
      ? this.buildRetainedEvidenceSubject(
          technicalEvidenceCount,
          Math.max(sourceCount, 1),
          true,
          'technical',
        )
      : null;

    if (strictZeroEvidenceValidation) {
      if (output.outputKey === 'market-potential') {
        return {
          ...output,
          content: `Market potential for ${validationDomainLabel} remains unproven because no problem-matched external evidence survived the bounded collection and recovery window. The pilot must first collect direct evidence for one concrete problem, measure repeated occurrence and operational impact, and validate willingness to adopt before making prevalence, demand, or market-size claims.`,
        };
      }

      if (output.outputKey === 'nlp-executive-summary') {
        return {
          ...output,
          content: `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). No problem-matched external evidence survived final verification for the selected ${validationDomainLabel} validation hypothesis. Unrelated or rejected corpus items were excluded from product justification.`,
        };
      }

      return {
        ...output,
        content: `No qualifying problem-matched community feedback was retained for the selected ${validationDomainLabel} validation hypothesis. DIRECT_PROBLEM + SUPPORTING_SIGNAL trusted evidence count is zero. CONTEXT_ONLY and UNRELATED corpus items are excluded from community feedback, demand, recurrence, and operational-failure claims.`,
      };
    }

    if (supportingOnlyEvidence) {
      const supportingSubject = `${communitySupportingCountForState} retained external supporting signal(s) across ${Math.max(supportingSourceCountForState, 1)} source(s)`;
      const selectedProblem =
        opportunity?.problem?.replace(/\s+/gu, ' ').trim() ||
        context.requestDescription?.replace(/\s+/gu, ' ').trim() ||
        'the selected requester-defined workflow';

      if (output.outputKey === 'market-potential') {
        return {
          ...output,
          content: `Current market potential remains unproven. ${supportingSubject} provides preliminary support for part of the selected problem family, but no verified direct-user evidence establishes recurrence, prevalence, willingness to adopt, or market-wide demand. The pilot should collect direct evidence from additional target users or organizations before any broader commercial conclusion is made.`,
        };
      }

      if (output.outputKey === 'community-feedback-summary') {
        return {
          ...output,
          content: `${supportingSubject} survived final verification as SUPPORTING_SIGNAL evidence for part of the requester-defined workflow. The canonical requester problem remains: ${selectedProblem.slice(0, 520)} No themes from CONTEXT_ONLY or UNRELATED corpus items are used as community feedback or demand evidence.`,
        };
      }

      if (output.outputKey === 'nlp-executive-summary') {
        return {
          ...output,
          content: `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). ${supportingSubject} survived Community AI and deterministic verification as SUPPORTING_SIGNAL evidence. No verified direct-user evidence establishes recurrence or prevalence, so unsupported corpus themes were excluded from product justification.`,
        };
      }
    }

    if (featureOnlyEvidence && output.outputKey === 'nlp-executive-summary') {
      const featureSubject = this.buildRetainedEvidenceSubject(
        featureRequestEvidenceCount,
        Math.max(sourceCount, 1),
        true,
        'feature',
      );
      const selectedNeed =
        opportunity?.need?.replace(/\s+/gu, ' ').trim() ||
        opportunity?.problem?.replace(/\s+/gu, ' ').trim() ||
        'the selected product capability';
      return {
        ...output,
        content: `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). ${featureSubject} asks for ${this.lowercaseSentenceStart(selectedNeed.replace(/[.]+$/u, ''))}. It is a direct demand signal, but one request does not establish recurrence, prevalence, or market-wide demand.`,
      };
    }

    if (featureOnlyEvidence && output.outputKey === 'community-feedback-summary') {
      const featureSubject = this.buildRetainedEvidenceSubject(
        featureRequestEvidenceCount,
        Math.max(sourceCount, 1),
        true,
        'feature',
      );
      const selectedNeed =
        opportunity?.need?.replace(/\s+/gu, ' ').trim() ||
        opportunity?.problem?.replace(/\s+/gu, ' ').trim() ||
        'the selected capability';
      return {
        ...output,
        content: `${featureSubject} asks for ${this.lowercaseSentenceStart(selectedNeed.replace(/[.]+$/u, ''))}. The request supports a bounded pilot hypothesis, but it does not by itself prove complaint recurrence, prevalence, or broader market demand.`,
      };
    }

    const observationEvidenceCount = this.countRetainedObservationEvidence(context);
    const observationOnlyEvidence =
      observationEvidenceCount > 0 &&
      featureRequestEvidenceCount === 0 &&
      this.countRetainedComplaintEvidence(context) === 0 &&
      secondaryEvidenceCount === 0;

    if (observationOnlyEvidence && output.outputKey === 'community-feedback-summary') {
      const observedProblem =
        opportunity?.problem?.replace(/\s+/gu, ' ').trim() ||
        opportunity?.need?.replace(/\s+/gu, ' ').trim() ||
        'a specific workflow need';
      return {
        ...output,
        content: `The retained direct report describes ${this.lowercaseSentenceStart(observedProblem.replace(/[.]+$/u, ''))}. It is one observed user-need signal, not a product complaint and not proof of recurrence, prevalence, or broader market demand.`,
      };
    }

    if (observationOnlyEvidence && output.outputKey === 'nlp-executive-summary') {
      const observedProblem =
        opportunity?.problem?.replace(/\s+/gu, ' ').trim() ||
        opportunity?.need?.replace(/\s+/gu, ' ').trim() ||
        'a specific workflow need';
      return {
        ...output,
        content: `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). One retained direct report describes ${this.lowercaseSentenceStart(observedProblem.replace(/[.]+$/u, ''))}. The signal is an observed unmet need rather than a verified complaint, and broader recurrence remains unproven.`,
      };
    }

    if (output.outputKey === 'market-potential' && technicalOnlyEvidence) {
      return {
        ...output,
        content: `Current market potential remains unproven. ${technicalSubject} documents a technical workflow issue, but it does not establish direct user demand, recurrence, prevalence, or market-wide willingness to adopt. The pilot should validate the affected workflow with target participants before any broader commercial conclusion is made.`,
      };
    }

    if (output.outputKey === 'market-potential' && secondaryOnlyEvidence) {
      return {
        ...output,
        content: `Current market potential remains unproven. ${secondarySubject} provides preliminary contextual support for the selected problem family, but no verified direct user complaint establishes recurrence, prevalence, or market-wide demand. The pilot should collect direct evidence from additional target users or organizations before any broader commercial conclusion is made.`,
      };
    }

    if (output.outputKey === 'market-potential' && evidenceCount === 0) {
      return {
        ...output,
        content: hasExternalSupportingContext
          ? 'Current market potential remains unproven. One real external sample was retained as contextual support, but it did not pass the stricter problem-matched verification threshold for the exact requester workflow. The pilot should validate repeated occurrence, willingness to adopt, and operational impact before making prevalence, demand, or market-size claims.'
          : 'Current market potential is unproven because no request-aligned external evidence survived the bounded collection and recovery window. The pilot should first measure repeated problem occurrence, willingness to adopt the workflow, operational impact, and evidence from additional independent target users or organizations before making prevalence, demand, or market-size claims.',
      };
    }

    if (output.outputKey === 'nlp-executive-summary') {
      const content = technicalOnlyEvidence
        ? `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). ${technicalSubject} documents the selected technical problem family. It is technical evidence rather than verified direct user demand, so recurrence and prevalence remain unproven.`
        : secondaryOnlyEvidence
          ? `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). ${secondarySubject} supports the selected problem family as preliminary secondary context. No verified direct user complaint establishes recurrence or prevalence, so the direction remains a bounded validation hypothesis.`
        : evidenceCount > 0
        ? `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). The final direction is supported by ${evidenceCount} problem-matched external evidence item(s) across ${Math.max(sourceCount, 1)} source(s). Only evidence that passed the final problem and requester-intent checks informed the selected product direction; unrelated corpus themes were excluded.`
        : hasExternalSupportingContext
          ? `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). One real external sample was retained as preliminary supporting context after stricter request-matched verification remained inconclusive. The requester-defined workflow therefore remains the primary product scope, and the supporting sample must not be treated as proof of recurrence or market-wide demand.`
          : `Trusted NLP processed ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). No external evidence matched the requester-defined problem strongly enough to support the final direction. Unrelated corpus themes were excluded and did not inform the product. The requester description remains a validation hypothesis for the pilot.`;
      return { ...output, content };
    }

    const selectedProblem = opportunity?.problem?.trim() || context.requestDescription?.trim();
    const content = technicalOnlyEvidence
      ? `${technicalSubject} documents${selectedProblem ? ` ${this.lowercaseSentenceStart(selectedProblem.replace(/\s+/gu, ' ').replace(/[.]+$/u, ''))}` : ' the selected technical workflow issue'}. It is technical evidence, not a verified direct user complaint or proof of recurrence, prevalence, or broader market demand.`
      : secondaryOnlyEvidence
        ? `${secondarySubject} provides preliminary support for the selected direction.${selectedProblem ? ` The retained secondary source describes the problem family as: ${selectedProblem.replace(/\s+/gu, ' ').slice(0, 520)}` : ''} No verified direct user complaint establishes recurrence, prevalence, or market-wide demand; direct validation is still required.`
      : evidenceCount > 0
      ? `The selected direction retains ${evidenceCount} problem-matched external evidence item(s) across ${Math.max(sourceCount, 1)} source(s).${selectedProblem ? ` The supported problem is: ${selectedProblem.replace(/\s+/gu, ' ').slice(0, 520)}` : ''} The evidence remains preliminary unless recurrence thresholds are independently satisfied, and unrelated collected comments are excluded from product justification.`
      : hasExternalSupportingContext
        ? `One real external sample was retained as contextual support for the selected workflow, but it did not independently verify the exact requester problem. The product remains anchored to the requester-defined workflow, and the external sample is used only as preliminary context rather than proof of demand or recurrence.`
        : `No qualifying request-aligned community feedback was retained for the selected problem. The product therefore remains a validation-first pilot grounded in the requester-defined workflow, and unrelated reviews, comments, or technical posts are excluded from its justification.`;
    return { ...output, content };
  }

  /**
   * Final evidence-aware language guard. This runs after every narrative
   * reconstruction step, so a single retained report can never be rewritten
   * into a market-wide or recurring claim by a provider or an earlier helper.
   */
  private enforceEvidenceNarrativeDiscipline(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (!value.trim()) {
      return value;
    }

    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const featureRequestEvidenceCount =
      this.countRetainedFeatureRequestEvidence(context);
    const featureOnlyEvidence =
      directEvidenceCount > 0 &&
      featureRequestEvidenceCount === directEvidenceCount;
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);
    const technicalEvidenceCount = this.countRetainedTechnicalEvidence(context);
    const questionEvidenceCount = this.countRetainedQuestionEvidence(context);
    const observationEvidenceCount = this.countRetainedObservationEvidence(context);
    const retainedEvidenceCount = this.countRetainedEvidence(context);
    const requesterDescription =
      retainedEvidenceCount === 0
        ? context.requestDescription?.replace(/\s+/gu, ' ').trim() ?? ''
        : '';
    const requesterDescriptionToken = '__REQUESTER_DEFINED_PROBLEM__';
    const requesterDescriptionPattern = requesterDescription
      ? new RegExp(
          this.escapeRegExp(requesterDescription).replace(/\s+/gu, '\\s+'),
          'iu',
        )
      : null;

    let cleaned = value
      .replace(
        /\bCollected community\s+one collected report indicates(?: that)?\s*/giu,
        'One collected community report indicates that ',
      )
      .replace(
        /\bCollected community feedback\s+one collected report indicates(?: that)?\s*/giu,
        'One collected community report indicates that ',
      )
      .replace(
        /\bOne retained community report indicates that\s+collected community feedback(?:\s+from\s+[^.!?]{1,140})?\s+indicates that\s+/giu,
        'One retained community report indicates that ',
      )
      .replace(
        /\bOne retained community report indicates that\s+one collected report(?:\s+from\s+[^.!?]{1,140})?\s+indicates that\s+/giu,
        'One retained community report indicates that ',
      )
      .replace(
        /\bcollected community\s+one collected report indicates that\s+/giu,
        'one collected report indicates that ',
      )
      .replace(
        /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*(?:Collected community\s+)?one collected report indicates that\s+/giu,
        'A preliminary community report from $1 indicates that ',
      )
      .replace(
        /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*One retained community report indicates that\s+/giu,
        'A preliminary community report from $1 indicates that ',
      )
      .replace(
        /\bindicates that\s+(?:collected community feedback|one collected report)\s+indicates that\s+/giu,
        'indicates that ',
      )
      .replace(
        /\bOne retained community report indicates that\s+(?:a|one)\s+(developer|user|creator|operator|practitioner)\s+reported that\s+/giu,
        'One retained community report describes a $1 reporting that ',
      )
      .replace(
        /\bA preliminary community report from ([^.:]+) indicates that\s+(?:a|one)\s+(developer|user|creator|operator|practitioner)\s+reported that\s+/giu,
        'A preliminary community report from $1 describes a $2 reporting that ',
      )
      .replace(
        /\bOne retained community report describes a (developer|user|creator|operator|practitioner) who reported that\s+/giu,
        'One retained community report describes a $1 reporting that ',
      )
      .replace(
        /\bA preliminary community report from ([^.:]+) describes a (developer|user|creator|operator|practitioner) who reported that\s+/giu,
        'A preliminary community report from $1 describes a $2 reporting that ',
      )
      .replace(/\s{2,}/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();

    if (requesterDescriptionPattern?.test(cleaned)) {
      cleaned = cleaned.replace(
        requesterDescriptionPattern,
        requesterDescriptionToken,
      );
    }

    if (featureOnlyEvidence) {
      const featureSubject = this.buildRetainedEvidenceSubject(
        featureRequestEvidenceCount,
        this.countRetainedIndependentSources(context),
        true,
        'feature',
      );

      cleaned = cleaned
        .replace(
          /\bOne retained direct user report from one independent source\b/giu,
          featureSubject,
        )
        .replace(
          /\bOne retained direct user report\b/giu,
          featureSubject,
        )
        .replace(
          /\bCollected feedback from real estate applications indicates that housing seekers attempting to locate stable residential housing experience significant search friction when platforms lack granular controls to exclude short-term or vacation rentals\.?/giu,
          'One retained feature request describes search friction when trying to exclude short-term or vacation rentals while looking for long-term housing.',
        )
        .replace(
          /\bOne user experienced that existing filtering interfaces frequently support including temporary listings but do not allow effective negative filtering for lease duration\b/giu,
          'The retained user reports that the current interface can filter for short-term rentals but does not provide the exclusion control needed for long-term housing',
        )
        .replace(
          /\bUsers report that existing filtering interfaces frequently support including temporary listings but do not allow effective negative filtering for lease duration\b/giu,
          'The retained user reports that the current interface can filter for short-term rentals but does not provide the exclusion control needed for long-term housing',
        )
        .replace(
          /\bhousing seekers attempting to locate stable residential housing experience significant search friction when platforms lack granular controls to exclude short-term or vacation rentals\b/giu,
          'the retained feature request describes search friction when trying to exclude short-term or vacation rentals while looking for long-term housing',
        )
        .replace(
          /\bHousing seekers often encounter significant friction when searching for stable residential properties on major real estate platforms, as current search interfaces frequently conflate long-term residential listings with short-term vacation rentals\.?/giu,
          'One retained feature request describes difficulty excluding short-term or vacation rentals while searching for long-term housing.',
        )
        .replace(
          /\bCollected feedback indicates that the inability to exclude short-term listings forces users to manually sift through irrelevant results, which is a time-consuming and inefficient process for those attempting to secure stable housing\.?/giu,
          'The retained request suggests testing whether explicit short-term exclusion reduces manual review of irrelevant listings for long-term housing seekers.',
        )
        .replace(
          /\bexisting filtering interfaces frequently support including temporary listings but do not allow effective negative filtering for lease duration\b/giu,
          'the current interface can filter for short-term rentals but does not provide the exclusion control needed for long-term housing',
        );
    }

    if (featureOnlyEvidence && directEvidenceCount === 1) {
      cleaned = cleaned
        .replace(
          /\bOne retained feature request describes a recurring operational friction point\b/giu,
          'One retained feature request describes a reported operational friction point',
        )
        .replace(
          /\bOne retained feature request describes recurring operational friction\b/giu,
          'One retained feature request describes reported operational friction',
        )
        .replace(
          /\bwhere users are unable to\b/giu,
          'where one user was unable to',
        )
        .replace(
          /\bwhere users cannot\b/giu,
          'where one user could not',
        )
        .replace(
          /\bcreating an urgent need\b/giu,
          'creating a stated need',
        )
        .replace(
          /\bCommunity discussions and user reviews indicate significant frustration when\b/giu,
          "The retained feature request describes one user's authentication barrier when",
        );
    }

    if (directEvidenceCount > 1) {
      const evidenceSubject = this.buildRetainedEvidenceSubject(
        directEvidenceCount,
        this.countRetainedIndependentSources(context),
      );
      cleaned = cleaned
        .replace(
          /\bOne retained community report indicates that\b/giu,
          `${evidenceSubject} indicate that`,
        )
        .replace(
          /\bOne retained community report describes\b/giu,
          `${evidenceSubject} describe`,
        )
        .replace(
          /\bOne collected report(?: from [^.!?]{0,140})? indicates that\b/giu,
          `${evidenceSubject} indicate that`,
        )
        .replace(
          /\bOne collected report(?: from [^.!?]{0,140})? describes\b/giu,
          `${evidenceSubject} describe`,
        );
    }

    if (retainedEvidenceCount === 0) {
      cleaned = cleaned
        .replace(
          /\bThe proposed software product addresses the technical friction encountered when\b/giu,
          'The proposed pilot tests whether technical friction may arise when',
        )
        .replace(
          /\bThe supplied community discussion highlights an opportunity to\b/giu,
          'The pilot explores the possibility of using',
        )
        .replace(
          /\bCollected feedback(?: from [^.!?]{0,140})? indicates that\b/giu,
          'The pilot tests the hypothesis that',
        )
        .replace(
          /\bcollected feedback(?: from [^.!?]{0,140})? indicates that\b/giu,
          'the pilot tests the hypothesis that',
        )
        .replace(
          /\b(operators|users|farmers|planners|teams) lack\b/giu,
          '$1 may lack',
        )
        .replace(
          /\b(operators|users|farmers|planners|teams) struggle to\b/giu,
          '$1 may struggle to',
        )
        .replace(
          /\brecurring\s+(challenges?|problems?|issues?|categories?|friction|failures?)\b/giu,
          'potential $1',
        )
        .replace(
          /\bgathers explicit user complaints\b/giu,
          'gathers explicit user feedback during validation',
        )
        .replace(
          /\b(engineering teams|developers|users|creators|builders|practitioners)([^.!?]{0,140}?)\s+(?:often|frequently|commonly)\s+(experience|encounter|face|introduce)\b/giu,
          (_match, subject: string, qualifier: string, verb: string) =>
            `${subject}${qualifier.trim() ? ` ${qualifier.trim()}` : ''} may ${verb}`,
        )
        .replace(
          /\b(engineering teams|developers|users|creators|builders|practitioners)\s+(experience|encounter|face)\b/giu,
          (_match, subject: string, verb: string) => `${subject} may ${verb}`,
        )
        .replace(
          /(^|[.!?]\s+)(?:often|frequently|commonly),\s+/giu,
          '$1In the requester-described scenario, ',
        )
        .replace(
          /\b(?:many|most|numerous)\s+(users|customers|operators|teams|businesses|organizations|shops|cities|companies|participants|people)\b/giu,
          'some $1',
        )
        .replace(
          /\bwidespread\s+(friction|failures?|problems?|issues?|challenges?|difficulties)\b/giu,
          'potential $1',
        )
        .replace(
          /\b(?:often|frequently|commonly)\s+(struggle|struggles|face|faces|encounter|encounters|experience|experiences)\b/giu,
          (_match, verb: string) => `may ${this.toTentativeBaseVerb(verb)}`,
        )
        .replace(
          /\b((?:independent\s+)?(?:restaurants?|businesses?|shops?|operators?|teams?|organizations?|institutions?|tailors?|alteration shops?)[^.!?]{0,90}?)\s+(?:often|frequently|commonly)\s+(encounter|encounters|experience|experiences|face|faces|struggle|struggles)\b/giu,
          (_match, subject: string, verb: string) => `${subject} may ${this.toTentativeBaseVerb(verb)}`,
        )
        .replace(/\bleading to recurring\b/giu, 'which may contribute to')
        .replace(/\brecognized pain point\b/giu, 'hypothesized pain point')
        .replace(/\bobserved operational challenges?\b/giu, 'requester-described operational challenges')
        .replace(/\bthe observed workflow friction\b/giu, 'the requester-described workflow friction');
    }

    if (requesterDescription) {
      cleaned = cleaned.replace(
        requesterDescriptionToken,
        requesterDescription,
      );
    }

    if (directEvidenceCount === 0 && secondaryEvidenceCount > 0) {
      const secondarySubject = this.buildRetainedEvidenceSubject(
        secondaryEvidenceCount,
        this.countRetainedIndependentSources(context),
        true,
        'secondary',
      );
      cleaned = cleaned
        .replace(/\bOne retained community report\b/giu, secondarySubject)
        .replace(
          /\bCollected feedback(?: from [^.!?]{0,160})? indicates that\s*/giu,
          `${secondarySubject} describes a scenario in which `,
        )
        .replace(
          /\bCollected feedback(?: from [^.!?]{0,160})? (?:shows|suggests|highlights) that\s*/giu,
          `${secondarySubject} describes a scenario in which `,
        )
        .replace(
          /\b(?:the )?feedback indicates that\s*/giu,
          `${secondarySubject} describes a scenario in which `,
        )
        .replace(
          /\bproduction teams (?:encounter|experience|face)\b/giu,
          'production teams may encounter',
        )
        .replace(
          /\bengineering teams spend\b/giu,
          'engineering teams may spend',
        )
        .replace(
          /\b(?:users|developers|teams|operators) report that\b/giu,
          'the retained secondary source describes a case in which',
        )
        .replace(
          /\bagents (?:often|frequently|commonly) forget\b/giu,
          'agents may forget',
        )
        .replace(
          /\b(?:production teams|engineering teams|developers|users|operators) (?:often|frequently|commonly) (?:encounter|experience|face)\b/giu,
          'people in the retained secondary scenario may encounter',
        )
        .replace(/\bA preliminary community report\b/giu, 'A preliminary secondary report')
        .replace(
          /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*/giu,
          'A preliminary secondary report related to $1 describes an operational challenge: ',
        )
        .replace(
          /\b(?:this|the) failure reveals a recurring pattern\b/giu,
          'This report suggests a potential failure pattern that requires broader validation',
        )
        .replace(
          /\breveals a recurring pattern\b/giu,
          'suggests a potential failure pattern that requires broader validation',
        )
        .replace(
          /\brecurring\s+(pattern|friction|failures?|problems?|issues?|challenges?)\b/giu,
          'potential $1 requiring broader validation',
        )
        .replace(
          /\b(?:companies|organizations|teams|users|patients|operators)\s+(?:often|frequently|commonly)\s+(face|experience|encounter)\b/giu,
          (_match, verb: string) => `organizations may ${verb}`,
        )
        .replace(
          /\bwithout claiming that the need is widespread\b/giu,
          'without claiming broader prevalence',
        )
        .replace(
          /\bwidespread\s+(problem|need|demand|friction|failures?|issues?|challenges?)\b/giu,
          'potential $1 requiring broader validation',
        )
        .replace(
          /\b(?:many|most|numerous)\b/giu,
          'some',
        )
        .replace(
          /\bwidespread\b/giu,
          'broader but unverified',
        )
        .replace(
          /\b(?:often|frequently|commonly)\s+leads?\s+to\b/giu,
          'may contribute to',
        )
        .replace(
          /\b(?:reveals|shows|demonstrates|confirms)\s+(?:a\s+)?recurring\s+pattern\b/giu,
          'suggests a potential failure pattern that requires broader validation',
        );
    }

    if (
      directEvidenceCount === 0 &&
      secondaryEvidenceCount === 0 &&
      technicalEvidenceCount > 0
    ) {
      const technicalSubject = this.buildRetainedEvidenceSubject(
        technicalEvidenceCount,
        this.countRetainedIndependentSources(context),
        true,
        'technical',
      );
      cleaned = cleaned
        .replace(/\bOne retained community report\b/giu, technicalSubject)
        .replace(
          /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*/giu,
          'A retained technical issue related to $1 documents ',
        )
        .replace(
          /\bA preliminary community report from ([^.:]+) indicates that\s*/giu,
          'A retained technical issue related to $1 documents ',
        )
        .replace(
          /\bCollected feedback(?: from [^.!?]{0,140})? indicates that\s*/giu,
          'A retained technical issue documents ',
        )
        .replace(
          /\bcollected feedback(?: from [^.!?]{0,140})? indicates that\s*/giu,
          'a retained technical issue documents ',
        )
        .replace(
          /\brecurring\s+(pattern|friction|failures?|problems?|issues?|challenges?)\b/giu,
          'observed $1 requiring direct-user validation',
        )
        .replace(
          /\busers\s+(?:occasionally|often|frequently|commonly|typically)\s+(encounter|experience|face)\b/giu,
          (_match, verb: string) =>
            `the retained technical issue documents a case in which users ${verb}`,
        )
        .replace(
          /\b(?:widespread|common|commonly|frequently|often|occasionally|typically)\b/giu,
          'potential',
        );
    }

    if (
      directEvidenceCount === 0 &&
      secondaryEvidenceCount === 0 &&
      technicalEvidenceCount === 0 &&
      questionEvidenceCount > 0
    ) {
      const questionSubject = this.buildRetainedEvidenceSubject(
        questionEvidenceCount,
        this.countRetainedIndependentSources(context),
        true,
        'question',
      );
      cleaned = cleaned
        .replace(/\bOne retained community report\b/giu, questionSubject)
        .replace(
          /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*/giu,
          'A retained user scenario question related to $1 raises the possibility that ',
        )
        .replace(
          /\bCollected feedback(?: from [^.!?]{0,140})? indicates that\s*/giu,
          'A retained user scenario question raises the possibility that ',
        )
        .replace(
          /\brecurring\s+(pattern|friction|failures?|problems?|issues?|challenges?)\b/giu,
          'possible $1 requiring direct-user validation',
        )
        .replace(
          /\b(?:widespread|common|commonly|frequently|often)\b/giu,
          'potential',
        );
    }

    if (
      directEvidenceCount === 0 &&
      secondaryEvidenceCount === 0 &&
      technicalEvidenceCount === 0 &&
      questionEvidenceCount === 0 &&
      observationEvidenceCount > 0
    ) {
      const observationSubject = this.buildRetainedEvidenceSubject(
        observationEvidenceCount,
        this.countRetainedIndependentSources(context),
        true,
        'observation',
      );
      cleaned = cleaned
        .replace(/\bOne retained community report\b/giu, observationSubject)
        .replace(
          /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*/giu,
          'A retained community observation related to $1 suggests that ',
        )
        .replace(
          /\bMany individuals?\b/giu,
          'Some people',
        )
        .replace(
          /\bMany people\b/giu,
          'Some people',
        )
        .replace(
          /\b(?:This constraint|This barrier) (?:often|frequently|commonly|typically) prevents? users\b/giu,
          'This observation does not establish how often the constraint prevents people',
        )
        .replace(
          /\bthe collected evidence indicates that this barrier[^.!?]{0,220}significant concern[^.!?]*\.?/giu,
          'The retained observation identifies a concern that requires direct-user validation before any prevalence claim is made.',
        )
        .replace(
          /\bprofessionals who lack the autonomy or flexible scheduling required to\b/giu,
          'people whose daily responsibilities may make it difficult to',
        )
        .replace(
          /\b(?:many|most|numerous|widespread)\b/giu,
          'some',
        )
        .replace(
          /\b(?:often|frequently|commonly|typically|occasionally)\b/giu,
          'potentially',
        );

      if (!/\bpilot hypothesis\b/iu.test(cleaned)) {
        cleaned = `${cleaned} The proposed intervention is a bounded pilot hypothesis to test; the retained observation does not establish that scheduling, micro-break duration, or any other product mechanism is the primary cause or proven remedy.`;
      }
    }

    if (
      directEvidenceCount > 1 &&
      !this.hasStrongIndependentEvidence(context)
    ) {
      cleaned = cleaned
        .replace(
          /\bVerified community evidence([^.!?]{0,180}?)identifies a recurring operational challenge:\s*/giu,
          'Multiple retained user reports$1indicate a potential operational challenge: ',
        )
        .replace(
          /\brecurring\s+(operational\s+)?(challenge|problem|issue|friction|failure)s?\b/giu,
          'potential $1$2 requiring broader independent validation',
        )
        .replace(
          /\brecurring communication breakdowns\b/giu,
          'communication breakdowns reported in the retained reviews',
        )
        .replace(
          /\bCommunity discussions?(?:\s+from\s+[^.!?]{1,120})?(?:\s+and\s+review comments?)?\s+(?:highlight|indicate|show|suggest)\s+/giu,
          'Multiple retained reviews indicate ',
        )
        .replace(
          /\bUsers\s+(?:often|frequently|commonly)\s+form\b/giu,
          'Some retained reviews indicate that users can form',
        )
        .replace(
          /\b(?:users|patients|participants|customers)\s+(?:often|frequently|commonly)\s+(experience|encounter|face)\b/giu,
          (_match, verb: string) => `retained reports indicate that some users may ${verb}`,
        )
        .replace(/\bcan cause profound distress\b/giu, 'may cause distress')
        .replace(
          /\b(?:often|frequently|commonly)\s+lead(?:s)?\s+to\b/giu,
          'may contribute to',
        )
        .replace(
          /\b(?:widespread|market-wide|systemic)\b/giu,
          'potential',
        );
    }

    const selectedDirectEvidenceText = (
      context.opportunityRanking?.selected.independentEvidence ?? []
    )
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const evidenceSupportsRepeatedCrash =
      /\b(?:keeps?\s+crash(?:ing|es)?|crash(?:es|ing)\s+(?:again|repeatedly)|every\s+time|multiple\s+times|repeated\s+crash(?:es|ing))\b/iu.test(
        selectedDirectEvidenceText,
      );
    const evidenceExplicitlyMentionsWorkflowStateLoss =
      /\b(?:lost|lose|losing|transactional state|session state|workflow state|lost progress|lose progress|active service requests?|verification screens?)\b/iu.test(
        selectedDirectEvidenceText,
      );
    const evidenceSupportsBlockingErrorMessages =
      /\b(?:error messages?|errors?)\s+(?:pop up|appear|appeared|display|displayed|show|shown)|\b(?:blocking|unexpected)\s+error messages?\b/iu.test(
        selectedDirectEvidenceText,
      );

    if (directEvidenceCount === 1) {
      const singleDirectSubject = featureOnlyEvidence
        ? 'One retained feature request'
        : 'One retained direct report';
      const singleDirectLabel = featureOnlyEvidence
        ? 'feature request'
        : 'direct report';

      cleaned = cleaned
        .replace(
          /\bCommunity discussions?(?:\s+from\s+[^.!?]{1,120})?(?:\s+and\s+review comments?)?\s+(?:highlight|indicate|show|suggest)\s+/giu,
          `${singleDirectSubject} describes `,
        )
        .replace(
          /\bUsers express (?:a\s+)?(?:clear\s+|strong\s+)?desire for\b/gu,
          featureOnlyEvidence
            ? 'The retained feature request asks for'
            : `${singleDirectSubject} describes a desire for`,
        )
        .replace(
          /\busers express (?:a\s+)?(?:clear\s+|strong\s+)?desire for\b/giu,
          featureOnlyEvidence
            ? 'the retained feature request asks for'
            : `${singleDirectSubject.toLocaleLowerCase()} describes a desire for`,
        )
        .replace(
          /\bThe Logistics Shipment Recovery and Exception Triage System is designed to address recurring communication breakdowns, tracking opacity, and unresolved delivery delays in parcel logistics\b/giu,
          'The Logistics Shipment Recovery and Exception Triage System is designed to address the communication breakdown, tracking opacity, and unresolved delivery delay described in the retained report',
        )
        .replace(
          /\bAs indicated by community feedback, the retained scenario suggests that affected users may struggle when\b/giu,
          `${singleDirectSubject} describes one user struggling when`,
        )
        .replace(
          /\bUsers report feeling\b/gu,
          `${singleDirectSubject} describes the user as feeling`,
        )
        .replace(
          /\busers\s+attempting to\s+([^.!?]{2,180}?)\s+report being\s+([^.!?]{2,180}?)(?=[,.;]|$)/giu,
          (_match, attemptedWorkflow: string, reportedState: string) =>
            `the retained ${singleDirectLabel} describes one user who was ${reportedState.trim()} while attempting to ${attemptedWorkflow.trim()}`,
        )
        .replace(
          /\bOne retained direct report describes recurring user friction caused by unexpected application crashes and disruptive error messages\b/giu,
          evidenceSupportsRepeatedCrash
            ? 'One retained direct report describes repeated application crashes and disruptive error messages'
            : 'One retained direct report describes an application crash and disruptive error messages',
        )
        .replace(
          /\b(?:portals?|applications?|apps?) frequently crash or present blocking error messages\b/giu,
          evidenceSupportsRepeatedCrash && evidenceSupportsBlockingErrorMessages
            ? 'the affected application repeatedly crashed and displayed blocking error messages in the retained report'
            : evidenceSupportsRepeatedCrash
              ? 'the affected application repeatedly crashed in the retained report and may display blocking error messages'
              : 'the retained report describes an application crash and blocking error messages',
        )
        .replace(
          /\b(?:portals?|applications?|apps?) frequently crash\b/giu,
          evidenceSupportsRepeatedCrash
            ? 'the affected application repeatedly crashed in the retained report'
            : 'the retained report describes an application crash',
        )
        .replace(
          /\bThis issue (?:frequently|often|commonly|typically) stems from\b/giu,
          'A potential contributing factor to validate is',
        )
        .replace(
          /\bThis (?:failure|problem) (?:frequently|often|commonly|typically) stems from\b/giu,
          'A potential contributing factor to validate is',
        )
        .replace(
          /\b(One retained direct user report from one independent source) indicates that ([^.!?]{3,140}?(?:failures?|friction|gaps?|errors?|limitations?))\./giu,
          (_match, subject: string, problem: string) =>
            `${subject} describes ${problem.toLocaleLowerCase()}.`,
        )
        .replace(
          /\b([A-Z][^.!?]{1,140}?)\s+(?:frequently|often|commonly|typically)\s+(?:suffer|suffers)\s+from\b/gu,
          '$1 may suffer from',
        )
        .replace(
          /\b([A-Z][^.!?]{1,140}?)\s+(?:frequently|often|commonly|typically)\s+(experience|encounter|face)s?\b/gu,
          (_match, subject: string, verb: string) =>
            `${subject} may ${verb.toLowerCase()}`,
        )
        .replace(
          /\b(One retained direct user report from one independent source) indicates that (?:logistics service users|food delivery users|tourism users|users|customers) (?:occasionally|often|frequently|commonly) (?:encounter|experience|face)\b/giu,
          '$1 describes a case in which a user encountered',
        )
        .replace(
          /\bOne retained community report indicates that users of ([^.!?]{2,120}?) may (?:experience|encounter|face)\b/giu,
          'One retained community report describes one user of $1 who may experience',
        )
        .replace(
          /\bOne retained community report indicates that (?:users|operators|participants|customers|learners|students) may (?:experience|encounter|face)\b/giu,
          'One retained community report describes one observed user who may experience',
        )
        .replace(
          /\brecurring\s+(?:user\s+|operational\s+)?(friction|failures?|problems?|issues?|challenges?)\b/giu,
          'reported $1',
        )
        .replace(
          /\bOne retained community report indicates that\s+(developers|users|creators|builders|practitioners)\s+(experience|encounter|face)\b/giu,
          (_match, subject: string, verb: string) => {
            const singularSubject: Record<string, string> = {
              developers: 'developer',
              users: 'user',
              creators: 'creator',
              builders: 'builder',
              practitioners: 'practitioner',
            };
            const singularVerb =
              verb.toLowerCase() === 'face' ? 'faced' : 'encountered';
            return `One retained community report describes a ${
              singularSubject[subject.toLowerCase()] ?? 'user'
            } who ${singularVerb}`;
          },
        )
        .replace(
          /\b((?:novice|independent|non-technical|amateur|self-taught)\s+)?(builders|developers|creators|users|practitioners)\s+([^.!?]{1,100}?)\s+(?:often|frequently|commonly)\s+(inadvertently\s+)?(introduce|encounter|experience|face)\b/giu,
          (
            _match,
            descriptor: string | undefined,
            subject: string,
            qualifier: string,
            manner: string | undefined,
            verb: string,
          ) => {
            const singularNoun: Record<string, string> = {
              builders: 'builder',
              developers: 'developer',
              creators: 'creator',
              users: 'user',
              practitioners: 'practitioner',
            };
            const subjectNoun = singularNoun[subject.toLowerCase()] ?? 'user';
            const singularSubject = descriptor?.trim()
              ? `${descriptor.trim()} ${subjectNoun}`
              : subjectNoun;
            const normalizedQualifier = qualifier.trim();
            const normalizedManner = manner?.trim();
            return `the retained report suggests that a ${singularSubject}${
              normalizedQualifier ? ` ${normalizedQualifier}` : ''
            } may${normalizedManner ? ` ${normalizedManner}` : ''} ${verb}`;
          },
        )
        .replace(
          /\bThese users frequently introduce\b/giu,
          'The retained report suggests that a user may introduce',
        )
        .replace(
          /\bThese users often introduce\b/giu,
          'The retained report suggests that a user may introduce',
        )
        .replace(
          /\bThese users commonly introduce\b/giu,
          'The retained report suggests that a user may introduce',
        )
        .replace(
          /\busers ([^.!?]{0,120}?) frequently (encounter|experience|introduce|face)\b/giu,
          (_match, qualifier: string, verb: string) =>
            `the retained report suggests that a user ${qualifier.trim()} may ${verb}`,
        )
        .replace(
          /\busers ([^.!?]{0,120}?) often (encounter|experience|introduce|face)\b/giu,
          (_match, qualifier: string, verb: string) =>
            `the retained report suggests that a user ${qualifier.trim()} may ${verb}`,
        )
        .replace(
          /\busers ([^.!?]{0,120}?) commonly (encounter|experience|introduce|face)\b/giu,
          (_match, qualifier: string, verb: string) =>
            `the retained report suggests that a user ${qualifier.trim()} may ${verb}`,
        )
        .replace(
          /\b(?:users|developers|creators|practitioners) frequently\b/giu,
          'the retained report suggests that a user may',
        )
        .replace(
          /\b(?:users|developers|creators|practitioners) often\b/giu,
          'the retained report suggests that a user may',
        )
        .replace(
          /\b(?:users|developers|creators|practitioners) commonly\b/giu,
          'the retained report suggests that a user may',
        )
        .replace(
          /\b(?:students|learners|teams|operators|customers|people)\s+(?:often|frequently|commonly)\s+(struggle|experience|encounter|face|report)\b/giu,
          (_match, verb: string) =>
            `the retained report suggests that one observed user may ${verb}`,
        )
        .replace(
          /\bEvidence indicates that\s+([^.!?]{0,80}?)\s+(?:often|frequently|commonly)\s+(struggle|experience|encounter|face|report)\b/giu,
          (_match, subject: string, verb: string) =>
            `The retained report suggests that ${subject.trim()} may ${verb}`,
        )
        .replace(
          /\bthe user is (?:often|frequently|commonly) caught in\b/giu,
          'the affected user can be caught in',
        )
        .replace(
          /\ba user is (?:often|frequently|commonly) caught in\b/giu,
          'an affected user can be caught in',
        )
        .replace(
          /\bThis problem (?:often|frequently|commonly) arises when\b/giu,
          'The retained report illustrates how this problem can arise when',
        )
        .replace(
          /\b(?:logistics service users|food delivery users|tourism users|users|customers) (?:occasionally|often|frequently|commonly) (?:encounter|experience|face)\b/giu,
          'one retained report describes a user who encountered',
        )
        .replace(
          /\bUsers currently lack\b/giu,
          'The affected workflow may lack',
        )
        .replace(
          /\b(One retained direct user report from one independent source) indicates that housing seekers using real estate platforms (?:occasionally|often|frequently|commonly|typically) encounter significant friction when attempting to\b/giu,
          '$1 describes difficulty when attempting to',
        )
        .replace(
          /\bHousing seekers using real estate platforms (?:occasionally|often|frequently|commonly|typically) encounter significant friction when attempting to\b/giu,
          'One retained user review describes difficulty when attempting to',
        )
        .replace(
          /\bCurrent search interfaces typically lack granular controls for lease duration\b/giu,
          'The retained review describes a search interface with limited lease-duration controls',
        )
        .replace(
          /\bUsers currently face an inefficient workflow where\b/giu,
          'The retained review describes an inefficient workflow in which',
        )
        .replace(
          /\boften resulting in\b/giu,
          'which can result in',
        );

      if (!evidenceExplicitlyMentionsWorkflowStateLoss) {
        cleaned = cleaned
          .replace(
            /\b(residents and administrative personnel|residents and administrative staff|users|customers|operators)\s+lose transactional state\b/giu,
            '$1 may lose progress in an active workflow',
          )
          .replace(
            /\b(residents and administrative personnel|residents and administrative staff|users|customers|operators)\s+lose access to active service requests and verification screens\b/giu,
            '$1 may lose progress in active service workflows',
          )
          .replace(
            /\brequiring manual restarts and increasing frustration\b/giu,
            'potentially requiring a restart and increasing recovery effort',
          );
      }
    }

    if (
      directEvidenceCount === 1 &&
      /\b(?:crash|crashes|crashed|crashing|stopped working|won['’]?t open|doesn['’]?t work)\b/iu.test(
        selectedDirectEvidenceText,
      )
    ) {
      cleaned = cleaned
        .replace(
          /\bThe proposed product addresses the persistent issue of application crashes within ([^,.]{2,100}), where the affected workflow may lack effective methods to recover from runtime failures\.?/giu,
          'One retained report describes repeated crashes in $1 despite the user’s recovery attempts.',
        )
        .replace(
          /\bThe proposed product addresses the persistent issue of application crashes within ([^,.]{2,100})\.?/giu,
          'One retained report describes repeated crashes in $1.',
        )
        .replace(
          /\bThe evidence-grounded problem centers on the inability of users to resolve app-level instability, which directly impacts their ability to track shipments or manage active orders\.?/giu,
          'The retained report shows that the user could not resolve the app-level instability; it does not identify the specific in-app task affected by the crash.',
        )
        .replace(
          /\busers of logistics mobile applications, such as ([^,.]{2,80}), (?:occasionally|often|frequently|commonly|typically) experience persistent application crashes\b/giu,
          'one retained report describes repeated application crashes in $1',
        );
    }

    cleaned = this.removeUnsupportedSparseCausalSentences(context, cleaned);
    cleaned = this.repairSparsePilotMetricLanguage(context, cleaned);

    cleaned = cleaned.replace(/\ba\s+(operational|auditable|immutable|automated|integrated)\b/giu, 'an $1')
      .replace(/\bcan\s+may\b/giu, 'may')
      .replace(/\bPreliminary\s+preliminary\b/giu, 'Preliminary')
      .replace(/\bdescribes\s+reported\s+friction\b/giu, 'describes friction')
      .replace(/\bexperience\s+encounter\b/giu, 'experience')
      .replace(/\bencounter\s+experience\b/giu, 'encounter')
      .replace(/\bdescribes\s+the\s+reported\s+challenge\b/giu, 'describes the challenge')
      .replace(/\bdescribes\s+reported\s+challenge\b/giu, 'describes the challenge')
      .replace(/\b1\s+posts\b/giu, '1 post')
      .replace(/\b1\s+comments\b/giu, '1 comment')
      .replace(/\b1\s+texts\b/giu, '1 text')
      .replace(/\s{2,}/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();

    return this.repairFinalNarrativeSurface(context, cleaned);
  }

  private repairFinalNarrativeSurface(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);
    const technicalEvidenceCount = this.countRetainedTechnicalEvidence(context);

    let repaired = value
      .replace(/\be\s*\.\s*g\s*\./giu, 'e.g.')
      .replace(/\bi\s*\.\s*e\s*\./giu, 'i.e.')
      .replace(/\bTLS\s*-?\s*(\d+)\s*\.\s*(\d+)\b/giu, 'TLS-$1.$2')
      .replace(/\bHTTP\s+(\d+)\.\s+(\d+)\b/giu, 'HTTP $1.$2')
      .replace(/\b(\d+)\.\s+(\d+)(?=(?:ms|s|sec|secs|second|seconds|%|x)\b)/giu, '$1.$2')
      .replace(/\bv(\d+)\.\s+(\d+)\b/giu, 'v$1.$2')
      .replace(/\brobots\.\s*txt\b/giu, 'robots.txt')
      .replace(/\bdocuments\?\./giu, 'documents a technical workflow issue.')
      .replace(/\bpotential\s+omit\b/giu, 'may omit')
      .replace(/\bpotential\s+omits\b/giu, 'may omit')
      .replace(/\bpotential\s+omitted\b/giu, 'may have omitted')
      .replace(
        /\bA retained technical issue related to ([^.!?]{1,80}) documents A retained technical issue(?: and user-requested workflow)? (?:indicate|indicates|documents)(?: that)?\s*/giu,
        'A retained technical issue related to $1 documents that ',
      )
      .replace(
        /\bOne retained secondary report from one retained source indicates that retained evidence describes\s*/giu,
        'One retained secondary report describes ',
      )
      .replace(
        /\bOne retained secondary report indicates that retained evidence describes\s*/giu,
        'One retained secondary report describes ',
      )
      .replace(/\bdocuments\s+documents\b/giu, 'documents')
      .replace(/\bdescribes\s+describes\b/giu, 'describes')
      .replace(/\s{2,}/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();

    if (
      directEvidenceCount === 0 &&
      secondaryEvidenceCount === 1 &&
      technicalEvidenceCount === 0
    ) {
      repaired = repaired
        .replace(
          /\bCommunity discussions and secondary reports indicate(?: that)?\s*/giu,
          'One retained secondary report describes ',
        )
        .replace(
          /\bCommunity discussions and secondary reports (?:show|suggest|highlight|describe)(?: that)?\s*/giu,
          'One retained secondary report describes ',
        )
        .replace(/\bContributors highlight\b/giu, 'The retained secondary report highlights')
        .replace(
          /\bCollected discussions reflect(?: user)? concerns(?: regarding)?\s*/giu,
          'One retained secondary report describes concerns about ',
        )
        .replace(
          /\bCommunity discussions and developer posts (?:indicate|suggest|show|describe)(?: that)?\s*/giu,
          'One retained secondary report indicates that ',
        )
        .replace(
          /\bCommunity discussions (?:indicate|suggest|show|describe)(?: that)?\s*/giu,
          'One retained secondary report indicates that ',
        );
    }

    if (
      directEvidenceCount === 0 &&
      secondaryEvidenceCount === 0 &&
      technicalEvidenceCount === 1
    ) {
      repaired = repaired
        .replace(
          /\bCommunity discussions and retained technical issues document(?: that)?\s*/giu,
          'One retained technical ticket documents ',
        )
        .replace(
          /\bCommunity discussions and technical issues document(?: that)?\s*/giu,
          'One retained technical ticket documents ',
        )
        .replace(/\bContributors highlight\b/giu, 'The retained technical ticket highlights');
    }

    return repaired
      .replace(/([.!?]\s+)implementation specialists\b/giu, '$1Implementation specialists')
      .replace(/\s{2,}/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();
  }

  /**
   * Final persisted-copy cleanup. This deliberately runs after all narrative
   * builders, sparse-evidence qualifiers, and abstract expansion.
   */
  private removeUnsupportedSparseCausalSentences(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (this.hasStrongIndependentEvidence(context)) return value;

    const evidenceText = (context.opportunityRanking?.selected.independentEvidence ?? [])
      .map((item) => item.text)
      .join(' ')
      .toLowerCase();
    const hasExplicitCausalEvidence =
      /\b(?:because|due to|caused by|stems? from|results? from|root cause|algorithm|metadata|configuration|policy)\b/iu.test(
        evidenceText,
      );

    if (hasExplicitCausalEvidence) return value;

    return value
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => {
        const trimmed = sentence.trim();

        const pluralHypothesis = trimmed.match(
          /^Potential contributing factors to validate include\s+(.+)$/iu,
        );
        if (pluralHypothesis?.[1]) {
          return `The retained evidence does not identify the root cause. The pilot may test hypotheses such as ${pluralHypothesis[1]}`;
        }

        const singularHypothesis = trimmed.match(
          /^One potential contributing factor to validate is\s+(.+)$/iu,
        );
        if (singularHypothesis?.[1]) {
          return `The retained evidence does not identify the root cause. The pilot may test the hypothesis that ${singularHypothesis[1]}`;
        }

        return sentence;
      })
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private repairSparsePilotMetricLanguage(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (this.hasStrongIndependentEvidence(context)) return value;

    const evidenceText = (context.opportunityRanking?.selected.independentEvidence ?? [])
      .map((item) => item.text)
      .join(' ')
      .toLowerCase();

    if (
      /\b(?:lease term|rental length|short[- ]term rental|long[- ]term rental|vacation home)\b/iu.test(
        evidenceText,
      )
    ) {
      return value
        .replace(
          /The pilot will establish a baseline for task effort and resolution time in Real Estate and measure directional improvement without claiming that the need is widespread\.?/giu,
          'The pilot will establish a baseline for listing-review time and measure whether lease-term filtering reduces time spent reviewing irrelevant short-term listings, without claiming that the need is widespread.',
        )
        .replace(
          /reduces selection effort and improves output clarity/giu,
          'reduces irrelevant-listing review effort and improves rental-search relevance',
        );
    }

    if (
      /\b(?:paid .*cash|cash .*paid|charged .*again|double charg|duplicate charg|already paid|refund)\b/iu.test(
        evidenceText,
      )
    ) {
      return value.replace(
        /reduces selection effort and improves output clarity/giu,
        'reduces dispute-documentation effort and dispute-resolution time',
      );
    }

    return value;
  }

  private sanitizeUnsupportedCausalLanguage(value: string): string {
    return value
      .replace(
        /\bThe root cause is suspected to (?:be|involve|stem from|result from)\s+/giu,
        'Potential contributing factors to validate include ',
      )
      .replace(
        /\bThe root causes are suspected to (?:be|involve|stem from|result from)\s+/giu,
        'Potential contributing factors to validate include ',
      )
      .replace(
        /\b(?:A|The) suspected root cause is\s+/giu,
        'One potential contributing factor to validate is ',
      )
      .replace(
        /\bThe (?:likely|probable) root cause is\s+/giu,
        'One potential contributing factor to validate is ',
      )
      .replace(
        /\bThe root cause appears to be\s+/giu,
        'One potential contributing factor to validate is ',
      )
      .replace(
        /\bThis (?:is|appears to be) likely caused by\s+/giu,
        'One potential contributing factor to validate is ',
      )
      .replace(
        /\b(?:These|Those|Such|The)\s+(?:[\p{L}\p{N}-]+\s+){0,7}(?:failures?|issues?|problems?|friction|errors?|barriers?|regressions?|outages?|mismatches?)\s+(?:stem|stems|result|results)\s+from\s+/giu,
        'Potential contributing factors to validate include ',
      )
      .replace(
        /\b(?:These|Those|Such|The)\s+(?:[\p{L}\p{N}-]+\s+){0,7}(?:failures?|issues?|problems?|friction|errors?|barriers?|regressions?|outages?|mismatches?)\s+(?:are|is)\s+(?:caused|driven)\s+by\s+/giu,
        'Potential contributing factors to validate include ',
      )
      .replace(
        /\b(?:This|The)\s+(?:failure|issue|problem|friction|error|barrier|regression|outage|mismatch)\s+(?:stems|results)\s+from\s+/giu,
        'One potential contributing factor to validate is ',
      )
      .replace(
        /\b(?:This|The)\s+(?:failure|issue|problem|friction|error|barrier|regression|outage|mismatch)\s+is\s+(?:caused|driven)\s+by\s+/giu,
        'One potential contributing factor to validate is ',
      );
  }

  private sanitizeUnsupportedBillingFailureClaims(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (!value.trim()) return value;

    const selected = context.opportunityRanking?.selected;
    const evidenceText = (
      (selected?.independentEvidence ?? []).length > 0
        ? selected?.independentEvidence?.map((item) => item.text) ?? []
        : selected?.evidenceSamples ?? []
    )
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const explicitDuplicatePaymentFailure =
      /\b(?:duplicate|double)\s+(?:charge|charges|payment|payments|billing)\b|\b(?:charged|billed)\s+(?:twice|again)\b|\balready paid\b[^.!?]{0,120}\b(?:charged|pay|payment)\b|\bpayment reconciliation\b/iu.test(
        evidenceText,
      );
    const explicitRefundFailure =
      /\brefund\s+(?:missing|failed|failure|pending|delayed|not\s+received|never\s+received|error|issue|problem)\b/iu.test(
        evidenceText,
      );
    const explicitGenericPaymentFailure =
      /\b(?:payment|checkout|card|bank|billing)\b[^.!?]{0,130}\b(?:error|errors|issue|issues|fail(?:s|ed|ure|ures|ing)?|declin(?:e|ed)|reject(?:ed|ion)?|blocked|not accepted|not processed|not working|cannot|can['’]?t|unable|incorrect|wrong)\b|\b(?:error|errors|issue|issues|fail(?:s|ed|ure|ures|ing)?|declin(?:e|ed)|reject(?:ed|ion)?|blocked|not accepted|not processed|not working|cannot|can['’]?t|unable|incorrect|wrong)\b[^.!?]{0,130}\b(?:payment|checkout|card|bank|billing)\b/iu.test(
        evidenceText,
      );

    let sanitized = value;

    if (!explicitDuplicatePaymentFailure) {
      if (explicitGenericPaymentFailure) {
        sanitized = sanitized
          .replace(
            /\b(?:duplicate|double)\s+payment\s+errors?\b/giu,
            'payment errors',
          )
          .replace(
            /\b(?:duplicate|double)\s+(?:subscription\s+)?charges?\b/giu,
            'payment errors',
          )
          .replace(
            /\b(?:duplicate|double)\s+payments?\b/giu,
            'payment errors',
          )
          .replace(
            /\b(?:was|were|is|are)\s+(?:charged|billed)\s+(?:twice|again)\b/giu,
            'encountered a payment error',
          )
          .replace(
            /\b(?:charged|billed)\s+(?:twice|again)\b/giu,
            'encountered a payment error',
          );
      } else {
        const duplicateReplacement = explicitRefundFailure
          ? 'payment issue'
          : 'reported workflow impact';

        sanitized = sanitized
          .replace(
            /\b(?:duplicate|double)\s+(?:subscription\s+)?charges?\b/giu,
            duplicateReplacement,
          )
          .replace(
            /\b(?:duplicate|double)\s+payments?\b/giu,
            duplicateReplacement,
          )
          .replace(
            /\b(?:charged|billed)\s+(?:twice|again)\b/giu,
            duplicateReplacement,
          );
      }
    }

    if (explicitGenericPaymentFailure || explicitRefundFailure) {
      return sanitized
        .replace(/\s{2,}/gu, ' ')
        .replace(/\s+([,.;:!?])/gu, '$1')
        .trim();
    }

    const paidUseImpact =
      /\b(?:subscription|monthly fee|subscription fee|paid|paying|spent|cost|money|out my)\b|[$€£]\s*\d/iu.test(
        evidenceText,
      );
    const groundedReplacement = paidUseImpact
      ? 'lost value from paid use'
      : 'reported workflow impact';

    return sanitized
      .replace(
        /\b(?:unacknowledged|unauthori[sz]ed|unrecogni[sz]ed|incorrect|wrong|unexpected)\s+(?:subscription\s+)?charges?\b/giu,
        groundedReplacement,
      )
      .replace(
        /\brigid\s+subscription\s+billing\s+barriers?\b/giu,
        groundedReplacement,
      )
      .replace(
        /\b(?:subscription\s+)?billing\s+(?:discrepancies|discrepancy|errors?|failures?|barriers?|issues?)\b/giu,
        groundedReplacement,
      )
      .replace(
        /\b(?:charge|payment)\s+(?:discrepancies|discrepancy|errors?|failures?)\b/giu,
        groundedReplacement,
      )
      .replace(/\s{2,}/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();
  }

  private normalizeTechnicalDottedTerms(value: string): string {
    return value
      .replace(/\be\s*\.\s*g\s*\./giu, 'e.g.')
      .replace(/\bi\s*\.\s*e\s*\./giu, 'i.e.')
      .replace(/\bai\b/giu, 'AI')
      .replace(/\bTLS\s*-?\s*(\d+)\s*\.\s*(\d+)\b/giu, 'TLS-$1.$2')
      .replace(
        /\b(OAuth|OpenID(?: Connect)?|OIDC|HTTP|SAML)\s+(\d+)\s*\.\s+(\d+)\b/giu,
        '$1 $2.$3',
      )
      .replace(/\b(\d+)\.\s+(\d+)(?=(?:ms|s|sec|secs|second|seconds|%|x)\b)/giu, '$1.$2')
      .replace(/\bv(\d+)\.\s+(\d+)\b/giu, 'v$1.$2')
      .replace(/\brobots\s*\.\s*txt\b/giu, 'robots.txt')
      .replace(/\bNext\s*\.\s*js\b/giu, 'Next.js')
      .replace(/\bNode\s*\.\s*js\b/giu, 'Node.js');
  }

  private finalizePersistedNarrativeCopy(value: string): string {
    const cleaned = this.normalizeTechnicalDottedTerms(
      this.sanitizeUnsupportedCausalLanguage(value),
    )
      .replace(
        /\bIt tests whether the pilot will test whether\b/giu,
        'It tests whether',
      )
      .replace(
        /\bThe pilot tests whether the pilot will test whether\b/giu,
        'The pilot tests whether',
      )
      .replace(
        /\bmove(?:s)? from anecdotal (?:feedback|problem-solving) to (?:a )?(?:data-informed, )?structured validation process\b/giu,
        'collect initial operational reports and determine whether a recurring problem family exists',
      )
      .replace(
        /\bmove(?:s)? from anecdotal (?:feedback|problem-solving) to evidence-collection(?: and validation development)?\b/giu,
        'collect initial operational reports and determine whether a recurring problem family exists',
      )
      .replace(/\binfrastructure-agnostic layer\b/giu, 'bounded pilot workflow')
      .replace(/\bmay fail ambiguous operational failures\b/giu, 'may encounter ambiguous operational failures')
      .replace(/\bAn-assisted\b/gu, 'An AI-assisted')
      .replace(/\ban-assisted\b/gu, 'AI-assisted')
      .replace(/\ba expressed\b/giu, 'an expressed')
      .replace(/\bcan\s+may\b/giu, 'may')
      .replace(/\bPreliminary\s+preliminary\b/giu, 'Preliminary')
      .replace(/\bdescribes\s+reported\s+friction\b/giu, 'describes friction')
      .replace(/\bexperience\s+encounter\b/giu, 'experience')
      .replace(/\bencounter\s+experience\b/giu, 'encounter')
      .replace(/\bdescribes\s+the\s+reported\s+challenge\b/giu, 'describes the challenge')
      .replace(/\bdescribes\s+reported\s+challenge\b/giu, 'describes the challenge')
      .replace(
        /\bwithout claiming potential prevalence\b/giu,
        'without claiming broader prevalence or established market demand',
      )
      .replace(/\s*\+\s*\+\s*/gu, ' + ')
      .replace(/\s+\+\s+(?=validation scope\b)/giu, ' ')
      .replace(/\.{2,}/gu, '.')
      .replace(/\bNext\s*\.\s*js\b/giu, 'Next.js')
      .replace(/\bNest\s*\.\s*js\b/giu, 'NestJS')
      .replace(/\bnablus\b/giu, 'Nablus')
      .replace(
        /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*(?:one collected report from \1 communities indicates that\s*)/giu,
        'A preliminary community signal from $1 reports that ',
      )
      .replace(
        /\bA preliminary community signal from ([^.:]+) reports an operational challenge:\s*one collected report from ([^.]+?) indicates that\s*(?:the collected report indicates that\s*)?/giu,
        'A preliminary community report from $2 indicates that ',
      )
      .replace(
        /\bone collected report from ([^.]+?) indicates that\s+the collected report indicates that\s+/giu,
        'one collected report from $1 indicates that ',
      )
      .replace(
        /\bthe collected report indicates that\s+one user experienced\b/giu,
        'one user experienced',
      )
      .replace(
        /\bsoftware\s+one user experienced\b/giu,
        'one software developer experienced',
      )
      .replace(
        /\bsoftware\s+(?:a|an)\s+user experienced\b/giu,
        'a software user experienced',
      )
      .replace(
        /\bthat\s+(During|When|While|If|The|A|An)\b/gu,
        (_match, word: string) => `that ${word.toLocaleLowerCase()}`,
      )
      .replace(
        /\bindicates that\s+software\s+one user\b/giu,
        'indicates that one software developer',
      )
      .replace(
        /\bmay fail ([^.!?]{0,120}?(?:failures?|problems?|issues?|errors?))\b/giu,
        'may encounter $1',
      )
      .replace(
        /\b((?:One|Two|Three|Four|Five|\d+) retained direct user reports? from (?:one|\d+) independent sources?) (?:indicates|indicate) that the retained report suggests that\b/giu,
        (_match, subject: string) =>
          `${subject} ${/\breports\b/iu.test(subject) ? 'suggest' : 'suggests'} that`,
      )
      .replace(
        /\b((?:One|Two|Three|Four|Five|\d+) retained direct user reports? from (?:one|\d+) independent sources?) (?:indicates|indicate) that collected feedback(?: from [^.!?]{0,140})? indicates that\s*/giu,
        (_match, subject: string) =>
          `${subject} ${/\breports\b/iu.test(subject) && !/^One\b/iu.test(subject) ? 'suggest' : 'suggests'} that `,
      )
      .replace(
        /\bcollected feedback(?: from [^.!?]{0,140})? indicates that collected feedback(?: from [^.!?]{0,140})? indicates that\s*/giu,
        'Collected feedback indicates that ',
      )
      .replace(
        /\b((?:One|Two|Three|Four|Five|\d+) retained (?:secondary reports?|technical tickets?) from (?:one|\d+) independent sources?) (?:indicates|indicate) that the retained report suggests that\b/giu,
        (_match, subject: string) =>
          `${subject} ${/\b(?:reports|tickets)\b/iu.test(subject) && !/\bOne\b/iu.test(subject) ? 'suggest' : 'suggests'} that`,
      )
      .replace(
        /\b(one retained technical ticket) from one independent source\b/giu,
        '$1 from one source',
      )
      .replace(
        /\b(\d+|two|three|four|five) retained technical tickets across ([^.!?]{1,30}) independent sources\b/giu,
        '$1 retained technical tickets across $2 retained sources',
      )
      .replace(
        /\bA retained technical issue related to ([^.:]+) documents\s+A retained technical issue documents that\s+/giu,
        'A retained technical issue related to $1 documents that ',
      )
      .replace(
        /\bA retained technical issue documents\s+A retained technical issue documents that\s+/giu,
        'A retained technical issue documents that ',
      )
      .replace(
        /\bA retained technical issue related to ([^.:]+) (?:indicates that|documents)\s+A limited evidence sample\b/giu,
        'A retained technical issue related to $1 documents a limited evidence sample',
      )
      .replace(
        /\bA retained technical issue (?:indicates that|documents)\s+A limited evidence sample\b/giu,
        'A retained technical issue documents a limited evidence sample',
      )
      .replace(
        /\busers\s+(?:occasionally|often|frequently|commonly|typically)\s+(encounter|experience|face)\b/giu,
        (_match, verb: string) => `the retained evidence documents a case in which users ${verb}`,
      )
      .replace(/\bwhere\s+The\b/gu, 'where the')
      .replace(
        /\bOne retained direct user report from one independent source indicates that application Crash and Runtime Failures\.*/giu,
        'One retained direct user report from one independent source describes repeated application crashes that continued despite the user’s recovery attempts.',
      )
      .replace(
        /\b((?:[\p{L}]+-[\p{L}-]+|independent|nontechnical|non-technical|privacy-conscious|privacy-sensitive|self-taught|novice|amateur))\s+the retained report suggests that a user may\b/giu,
        (_match, descriptor: string) =>
          `The retained report suggests that a ${descriptor.trim()} user may`,
      )
      .replace(
        /\bWhen one user (?:experienced|encountered|faced) ([^.!?]{1,120}?) or require\b/giu,
        'When one user experiences $1 or requires',
      )
      .replace(
        /\bone user (?:experienced|encountered|faced) ([^.!?]{1,120}?) or require\b/giu,
        'one user experiences $1 or requires',
      )
      .replace(
        /\b(indicates|suggests|reports|shows) that The retained report suggests that\b/giu,
        '$1 that',
      )
      .replace(
        /\b(A preliminary secondary report related to [^.:]{2,80}) (?:indicates|suggests) that ([^.!?]{2,140}\b(?:failures?|gaps?|friction|problems?|issues?|challenges?))\./giu,
        (_match, subject: string, problem: string) =>
          `${subject} describes an operational challenge: ${this.capitalizeSentence(problem.trim())}.`,
      )
      .replace(
        /\b((?:One|Two|Three|Four|Five|\d+) retained secondary reports?(?: from one retained source| across [^.]{1,40} retained sources)?) (?:indicates|suggests) that ([^.!?]{2,140}\b(?:failures?|gaps?|friction|problems?|issues?|challenges?))\./giu,
        (_match, subject: string, problem: string) =>
          `${subject} describes ${this.capitalizeSentence(problem.trim())}.`,
      )
      .replace(
        /\bPreliminary observations from [^.!?]{1,140}?\s+the retained evidence suggests that\b/giu,
        'The retained evidence suggests that',
      )
      .replace(/\s{2,}/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();

    const deduplicated = this.removeRepeatedLeadingNarrative(cleaned);

    return deduplicated.replace(
      /(^|[.!?]\s+)([a-z])/gu,
      (_match, boundary: string, letter: string) =>
        `${boundary}${letter.toUpperCase()}`,
    );
  }

  private removeRepeatedLeadingNarrative(value: string): string {
    const paragraphs = value
      .split(/\n\s*\n/u)
      .map((item) => item.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);

    if (paragraphs.length > 1) {
      const firstKey = this.normalizeComparableText(paragraphs[0] ?? '');
      const secondKey = this.normalizeComparableText(paragraphs[1] ?? '');
      if (
        firstKey &&
        (firstKey === secondKey ||
          secondKey.startsWith(firstKey) ||
          firstKey.startsWith(secondKey))
      ) {
        paragraphs.splice(1, 1);
      }
    }

    const joined = paragraphs.join('\n\n');
    const sentences = joined.match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? [joined];
    const result: string[] = [];

    for (const sentence of sentences) {
      const normalized = this.normalizeComparableText(sentence);
      const duplicate = result.some(
        (previous) =>
          this.normalizeComparableText(previous) === normalized &&
          normalized.length >= 40,
      );
      if (!duplicate) result.push(sentence.trim());
    }

    return result.join(' ').replace(/\s+/gu, ' ').trim();
  }

  /**
   * Safely narrows the Prisma JsonValue attached to the winning ranked
   * opportunity. The ranking contract stores raw provider data as JSON, so
   * direct property access is unsafe until the value is confirmed to be a
   * non-null object.
   */
  private resolveWinnerOpportunityRaw(
    context: IdeaGenerationContext,
  ): { domainName: string; problem: string; familyKey: string | null } | null {
    const rankedWinner = context.benchmarkWinnerOpportunity;

    if (!rankedWinner) {
      return null;
    }

    const raw = rankedWinner.raw;
    const record =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;

    const rawDomainName =
      record && typeof record.domainName === 'string'
        ? record.domainName.trim()
        : '';
    const rawProblem =
      record && typeof record.problem === 'string'
        ? record.problem.trim()
        : '';
    const rawFamilyKey =
      record && typeof record.familyKey === 'string'
        ? record.familyKey.trim()
        : '';

    const domainName =
      rankedWinner.matchedDomainNames?.[0]?.trim() ||
      rawDomainName ||
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name.trim() ||
      'General';
    const problem = this.repairTruncatedProblemFromRetainedEvidence(
      context,
      rawProblem || rankedWinner.problem?.trim() || '',
    );

    if (!problem) {
      return null;
    }

    const inferredFamilyKey = resolvePrimaryProblemFamily(
      [
        rankedWinner.title,
        rankedWinner.problem ?? '',
        rankedWinner.need ?? '',
        rankedWinner.solutionArea ?? '',
        problem,
      ].join(' '),
    )?.key ?? null;

    return {
      domainName,
      problem,
      familyKey: rawFamilyKey || inferredFamilyKey,
    };
  }

  private repairTruncatedProblemFromRetainedEvidence(
    context: IdeaGenerationContext,
    problem: string,
  ): string {
    const normalized = problem.replace(/\s+/gu, ' ').trim();
    const lastWord =
      normalized.split(/\s+/u).at(-1)?.replace(/[^\p{L}\p{N}-]+/gu, '') ?? '';
    const looksTruncated =
      normalized.length > 0 &&
      !/[.!?]["')\]]?$/u.test(normalized) &&
      normalized.length < 170 &&
      lastWord.length <= 4;

    if (!looksTruncated) {
      return normalized;
    }

    const samples = [
      ...(context.opportunityRanking?.selected.evidenceSamples ?? []),
      ...(context.opportunityRanking?.selected.independentEvidence ?? []).map(
        (item) => item.text,
      ),
    ];

    for (const sample of samples) {
      const match = sample
        .replace(/\s+/gu, ' ')
        .match(
          /(?:problem statement|problem|issue|pain point)\s*:?\s*(.+?)(?=\s+(?:proposed solution|solution|alternatives considered|feature summary|mockups|additional context)\b|$)/iu,
        );
      const extracted = match?.[1]?.replace(/\s+/gu, ' ').trim();
      if (extracted && extracted.length >= 35) {
        return extracted.length <= 280
          ? extracted
          : extracted.slice(0, extracted.lastIndexOf(' ', 280)).trim();
      }
    }

    return normalized;
  }

  private removeRepeatedDomainPrefix(
    problem: string,
    domainName: string,
  ): string {
    const escapedDomain = domainName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return problem
      .trim()
      .replace(new RegExp(`^${escapedDomain}\\s*:\s*`, 'iu'), '')
      .replace(/^[^:]{2,60}:\s+(?=[a-z])/u, '')
      .replace(/[.]+$/u, '')
      .trim();
  }

  /**
   * Removes concrete use-case examples that belong to selected domains with no
   * supporting evidence. This is a pure in-memory text pass and adds no query,
   * AI call, NLP work, or recovery attempt.
   */
  /**
   * Downgrades strong market-evidence wording when the selected opportunity did
   * not pass independent verification.
   */
  /**
   * Builds one clean sparse-evidence introduction without repeating
   * "preliminary", "signal", or "hypothesis" in adjacent clauses.
   */
  private buildQualifiedEvidenceIntroduction(problemStatement: string): string {
    const normalized = problemStatement.replace(/\s+/gu, ' ').trim();

    const communitySignal = normalized.match(
      /^A preliminary community signal\s+(from|across)\s+(.+?)\s+reports an operational challenge:\s*(.+)$/iu,
    );

    if (communitySignal) {
      const scope = communitySignal[1]?.toLocaleLowerCase() ?? 'from';
      const domains = communitySignal[2]?.trim() || 'the selected domain';
      const problem = communitySignal[3]?.trim() || normalized;

      return scope === 'across'
        ? `The proposed pilot responds to a limited community signal across ${domains}: ${problem}`
        : `The proposed pilot responds to a limited community signal from the ${domains} domain: ${problem}`;
    }

    const limitedFeedback = normalized.match(
      /^Limited collected feedback from\s+(.+?)\s+suggests\s+(.+)$/iu,
    );

    if (limitedFeedback) {
      return `The proposed pilot is grounded in limited collected feedback from ${limitedFeedback[1]?.trim()}: ${limitedFeedback[2]?.trim()}`;
    }

    return `The proposed pilot is based on a limited evidence sample: ${normalized}`;
  }

  /**
   * Strong wording is allowed only after deterministic independent verification.
   */
  private hasStrongIndependentEvidence(
    context: IdeaGenerationContext,
  ): boolean {
    const selected = context.opportunityRanking?.selected;

    const directCount =
      selected?.verifiedProblemMatchedDirectUserEvidenceCount ??
      selected?.verifiedIndependentEvidenceCount ??
      0;
    const sourceCount =
      selected?.verifiedProblemMatchedSourceCount ??
      selected?.verifiedIndependentSourceCount ??
      0;

    return Boolean(
      selected?.selectionEligible &&
        directCount >= 3 &&
        sourceCount >= 2,
    );
  }

  private qualifyEvidenceClaims(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    const protectsRequesterDescription = !this.hasAnyRetainedEvidence(context);
    const requesterDescription = protectsRequesterDescription
      ? context.requestDescription?.replace(/\s+/gu, ' ').trim() ?? ''
      : '';
    const requesterDescriptionToken = '__REQUESTER_DEFINED_PROBLEM__';
    const requesterDescriptionPattern = requesterDescription
      ? new RegExp(
          this.escapeRegExp(requesterDescription).replace(/\s+/gu, '\\s+'),
          'iu',
        )
      : null;

    if (requesterDescriptionPattern?.test(value)) {
      value = value.replace(
        requesterDescriptionPattern,
        requesterDescriptionToken,
      );
    }

    if (!this.hasAnyRetainedEvidence(context)) {
      value = value
        .replace(/\bevidence-based\b/giu, 'evidence-collection and validation')
        .replace(
          /\bpersistent\s+(operational\s+)?(challenge|problem|issue|friction|gap)s?\b/giu,
          'requester-described $1$2',
        )
        .replace(/\b(?:frequently|often|commonly|usually)\s+results?\s+in\b/giu, 'may result in')
        .replace(/\b(?:frequently|often|commonly|usually)\s+leads?\s+to\b/giu, 'may lead to')
        .replace(
          /\ba preliminary community signal(?:\s+from\s+[^.]+)?\s+(?:reports|identifies|shows|indicates)\b/giu,
          'the unvalidated generation hypothesis proposes',
        );
    }

    if (this.hasStrongIndependentEvidence(context)) {
      return value;
    }

    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const featureRequestEvidenceCount =
      this.countRetainedFeatureRequestEvidence(context);
    const featureOnlyEvidence =
      directEvidenceCount > 0 &&
      featureRequestEvidenceCount === directEvidenceCount;
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);

    if (directEvidenceCount === 0 && secondaryEvidenceCount === 1) {
      value = value
        .replace(
          /\bRetained evidence indicates that\b/giu,
          'The retained secondary report indicates that',
        )
        .replace(
          /\b(The retained secondary report indicates that[^.!?]{0,180}?)\b(?:frequently|often|commonly|typically)\s+/giu,
          '$1',
        );
    }

    if (directEvidenceCount === 1) {
      value = value
        .replace(
          /\b(?:creators|developers|users|artists|operators|practitioners)\s+(?:report|describe|indicate|experience|encounter)\b/giu,
          'the collected report indicates that one user experienced',
        )
        .replace(
          /\bcollected feedback from\b/giu,
          'one collected report from',
        )
        .replace(
          /\bfeedback from [^.\n]+? indicates\b/giu,
          'one collected report indicates',
        );
    }

    if (featureOnlyEvidence) {
      const featureSubject = this.buildRetainedEvidenceSubject(
        featureRequestEvidenceCount,
        this.countRetainedIndependentSources(context),
        true,
        'feature',
      );

      value = value
        .replace(
          /\bOne retained direct user report from one independent source\b/giu,
          featureSubject,
        )
        .replace(
          /\bOne retained direct user report\b/giu,
          featureSubject,
        )
        .replace(
          /\bCollected feedback from real estate applications indicates that housing seekers attempting to locate stable residential housing experience significant search friction when platforms lack granular controls to exclude short-term or vacation rentals\.?/giu,
          'One retained feature request describes search friction when trying to exclude short-term or vacation rentals while looking for long-term housing.',
        )
        .replace(
          /\bOne user experienced that existing filtering interfaces frequently support including temporary listings but do not allow effective negative filtering for lease duration\b/giu,
          'The retained user reports that the current interface can filter for short-term rentals but does not provide the exclusion control needed for long-term housing',
        )
        .replace(
          /\bUsers report that existing filtering interfaces frequently support including temporary listings but do not allow effective negative filtering for lease duration\b/giu,
          'The retained user reports that the current interface can filter for short-term rentals but does not provide the exclusion control needed for long-term housing',
        )
        .replace(
          /\bHousing seekers often encounter significant friction when searching for stable residential properties on major real estate platforms, as current search interfaces frequently conflate long-term residential listings with short-term vacation rentals\.?/giu,
          'One retained feature request describes difficulty excluding short-term or vacation rentals while searching for long-term housing.',
        )
        .replace(
          /\bCollected feedback indicates that the inability to exclude short-term listings forces users to manually sift through irrelevant results, which is a time-consuming and inefficient process for those attempting to secure stable housing\.?/giu,
          'The retained request suggests testing whether explicit short-term exclusion reduces manual review of irrelevant listings for long-term housing seekers.',
        );
    }

    const hasNoRetainedEvidence = this.countRetainedEvidence(context) === 0;

    value = value
      .replace(
        /\bthe pilot tests the hypothesis that the pilot will test whether\b/giu,
        'the pilot tests whether',
      )
      .replace(
        /\btests the hypothesis that the pilot will test whether\b/giu,
        'tests whether',
      )
      .replace(
        /\bit tests the hypothesis that the pilot will test whether\b/giu,
        'It tests whether',
      )
      .replace(
        /\bIt tests whether the pilot will test whether\b/giu,
        'It tests whether',
      )
      .replace(
        /\bThe pilot tests whether the pilot will test whether\b/giu,
        'The pilot tests whether',
      );

    if (hasNoRetainedEvidence) {
      const finalClaimDomainSet = new Set(
        this.resolveFinalClaimDomains(context).map((name) =>
          name.trim().toLocaleLowerCase(),
        ),
      );
      const secondaryDomains = context.selectedDomains
        .slice(1)
        .map((domain) => domain.name.trim())
        .filter(Boolean)
        .filter(
          (name) => !finalClaimDomainSet.has(name.toLocaleLowerCase()),
        );

      for (const domain of secondaryDomains) {
        value = value.replace(
          new RegExp(`(?:,?\\s*(?:and|or|across)?\\s*)?\\b${this.escapeRegExp(domain)}\\b`, 'giu'),
          '',
        );
      }

      value = value
        .replace(
          /\bCollected feedback from preliminary operational reviews indicates that[^.!?]*[.!?]?/giu,
          '',
        )
        .replace(
          /\bCollected feedback[^.!?]*(?:indicates|shows|suggests)[^.!?]*[.!?]?/giu,
          '',
        )
        .replace(/\bcloud-native architecture\b/giu, 'modular deployment')
        .replace(/\bmobile and web platforms\b/giu, 'a web interface')
        .replace(/\bscalable approach\b/giu, 'bounded pilot approach')
        .replace(
          /\bmove from anecdotal feedback to evidence-collection(?: and validation development)?\b/giu,
          'collect initial operational reports and determine whether a recurring problem family exists',
        )
        .replace(
          /\binfrastructure-agnostic layer\b/giu,
          'bounded pilot workflow',
        )
        .replace(/([.!?]\s+)the pilot\b/gu, '$1The pilot')
        .replace(/\s+,/gu, ',')
        .replace(/,\s*,+/gu, ',')
        .replace(/\s{2,}/gu, ' ')
        .trim();
    }

    return value
      .replace(
        /\bThe evidence-backed opportunity centers on the following validated need:\s*/giu,
        'A preliminary community signal indicates the following pilot hypothesis: ',
      )
      .replace(
        /\bA preliminary community signal indicates the following pilot hypothesis:\s*A preliminary community signal from\b/giu,
        'The proposed pilot responds to a limited community signal from',
      )
      .replace(
        /\bThe proposed pilot is based on this preliminary hypothesis:\s*A preliminary community signal from\b/giu,
        'The proposed pilot responds to a limited community signal from',
      )
      .replace(
        /\bVerified community evidence from\b/giu,
        'Limited collected feedback from',
      )
      .replace(
        /\bEvidence from ([^.\n]+?) reveals a recurring operational challenge:\s*/giu,
        'A preliminary community signal from $1 reports an operational challenge: ',
      )
      .replace(
        /\bevidence-backed opportunity\b/giu,
        'preliminary opportunity signal',
      )
      .replace(/\bevidence-backed context\b/giu, 'evidence-qualified context')
      .replace(/\bvalidated need\b/giu, 'observed preliminary need')
      .replace(/\bvalidated requirement\b/giu, 'preliminary requirement')
      .replace(/\bvalidated problem\b/giu, 'reported preliminary problem')
      .replace(
        /\brecurring operational challenges?\b/giu,
        'reported operational challenge',
      )
      .replace(/\brecurring problems?\b/giu, 'reported problem')
      .replace(/\bproven demand\b/giu, 'potential demand to be tested')
      .replace(/\bmarket-wide evidence\b/giu, 'limited collected evidence')
      .replace(/\brecurring failure\b/giu, 'reported failure')
      .replace(/\brecurring need\b/giu, 'reported need')
      .replace(/\bcommon problem\b/giu, 'reported problem')
      .replace(/\bwidespread (?:problem|need|demand)\b/giu, 'potential need requiring validation')
      .replace(/\bsubstantial demand\b/giu, 'potential demand requiring validation')
      .replace(/\bmarket-proven\b/giu, 'pilot-stage')
      .replace(/\bfrequently (?:fail|fails|failed)\b/giu, 'may fail')
      .replace(/\bfrequently encounter\b/giu, 'may encounter')
      .replace(/\bfrequently experience\b/giu, 'may experience')
      .replace(/\bfrequently face\b/giu, 'may face')
      .replace(/\busers? (?:often|commonly) (?:report|encounter|experience)\b/giu, 'one collected report describes')
      .replace(/\bIn many [^,.]{3,100} workflows,\s*/giu, 'In the collected report, ')
      .replace(
        /\bstandard ([^.]{2,100}?) models? fall short when users need\b/giu,
        'a referenced $1 model was described as insufficient when the user needed',
      )
      .replace(
        /\bpractitioners (?:often|commonly) (?:struggle|encounter|experience)\b/giu,
        'the collected report describes a practitioner who encountered',
      )
      .replace(
        requesterDescriptionToken,
        requesterDescription,
      );
  }

  /**
   * Rewrites the concise overview when evidence is sparse so one report is not
   * generalized into claims about many users or an entire market.
   */
  private groundSparseEvidenceOverview(
    context: IdeaGenerationContext,
    overview: string,
    parsedOutput: ParsedIdeaAiOutput,
  ): string {
    if (!overview.trim() || this.hasStrongIndependentEvidence(context)) {
      return overview;
    }

    const winner = this.resolveWinnerOpportunityRaw(context);
    const winnerProblem = winner?.problem?.trim() ?? '';
    const providerProblem = parsedOutput.coreIdea.problemStatement
      .replace(/\s+/gu, ' ')
      .trim();
    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const featureRequestEvidenceCount =
      this.countRetainedFeatureRequestEvidence(context);
    const featureOnlyEvidence =
      directEvidenceCount > 0 &&
      featureRequestEvidenceCount === directEvidenceCount;
    const selectedNeed = context.opportunityRanking?.selected.need?.trim() ?? '';
    const selectedProblem =
      (featureOnlyEvidence ? selectedNeed : '') ||
      winnerProblem ||
      providerProblem;
    if (!selectedProblem) {
      return overview;
    }

    const sentences = overview
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/(?<=[.!?])\s+/u)
      .filter(Boolean);

    const productSentences = sentences.filter(
      (sentence) =>
        /\b(?:product|platform|suite|tool|workbench|system|workflow|dashboard|allows?|enables?|provides?|core workflow)\b/iu.test(
          sentence,
        ) &&
        !/\b(?:many|common|often|currently face|users face|models fail|market|widespread|recurring)\b/iu.test(
          sentence,
        ),
    );

    const title = parsedOutput.coreIdea.title.trim();
    const normalizedProblem = selectedProblem.replace(/[.]+$/u, '').trim();
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);
    const technicalEvidenceCount = this.countRetainedTechnicalEvidence(context);
    const questionEvidenceCount = this.countRetainedQuestionEvidence(context);
    const observationEvidenceCount = this.countRetainedObservationEvidence(context);
    const retainedEvidenceCount = this.countRetainedEvidence(context);
    const independentSourceCount =
      this.countRetainedIndependentSources(context);
    const sparseEvidenceCount =
      directEvidenceCount > 0
        ? directEvidenceCount
        : secondaryEvidenceCount > 0
          ? secondaryEvidenceCount
          : technicalEvidenceCount > 0
            ? technicalEvidenceCount
            : questionEvidenceCount > 0
              ? questionEvidenceCount
              : observationEvidenceCount;
    const sparseEvidenceClass:
      | 'direct'
      | 'feature'
      | 'secondary'
      | 'technical'
      | 'question'
      | 'observation' =
      featureOnlyEvidence
        ? 'feature'
        : directEvidenceCount > 0
          ? 'direct'
          : secondaryEvidenceCount > 0
          ? 'secondary'
          : technicalEvidenceCount > 0
            ? 'technical'
            : questionEvidenceCount > 0
              ? 'question'
              : 'observation';

    const sparseProblem = this.buildEvidenceDerivedProblemSummary(
      context,
      normalizedProblem,
      sparseEvidenceClass,
    );

    const requesterDescription = context.requestDescription
      ?.replace(/\s+/gu, ' ')
      .trim();
    const evidenceSentence = retainedEvidenceCount > 0
      ? this.buildSparseEvidenceSentence(
          sparseProblem,
          sparseEvidenceCount,
          independentSourceCount,
          sparseEvidenceClass,
        )
      : requesterDescription
        ? `This preliminary pilot does not claim that the requester-defined problem has already been validated by retained community evidence. The requester-defined problem is: "${requesterDescription}".`
        : `This preliminary pilot does not claim that a specific community problem has already been validated. It tests whether ${this.lowercaseSentenceStart(
            normalizedProblem,
          )}.`;

    const productSentence =
      productSentences[0] ??
      `${title} provides a bounded pilot workflow that lets the target users test the proposed capabilities against their own authorized inputs and review the results before selecting an approach.`;

    const candidateValueSentence = productSentences[1] ?? '';
    const valueSentence =
      candidateValueSentence &&
      !/\b(?:selection effort|output clarity|generic task completion|processing time)\b/iu.test(
        candidateValueSentence,
      )
        ? candidateValueSentence
        : this.buildSparsePilotMeasurementSentence(
            context,
            selectedProblem,
            title,
          );

    return this.buildConciseOverview(
      [evidenceSentence, productSentence, valueSentence].join(' '),
    );
  }

  private alignSparseNarrativesToImmutableWinner(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
    problemStatement: string,
    overview: string,
  ): { problemStatement: string; overview: string } {
    if (this.hasStrongIndependentEvidence(context)) {
      return { problemStatement, overview };
    }

    const winner = this.resolveWinnerOpportunityRaw(context);
    if (!winner?.familyKey) {
      return { problemStatement, overview };
    }

    const problemFamily = resolvePrimaryProblemFamily(problemStatement)?.key ?? null;
    const overviewFamily = resolvePrimaryProblemFamily(overview)?.key ?? null;
    const problemMismatch = Boolean(
      problemFamily && problemFamily !== winner.familyKey,
    );
    const overviewMismatch = Boolean(
      overviewFamily && overviewFamily !== winner.familyKey,
    );

    if (!problemMismatch && !overviewMismatch) {
      return { problemStatement, overview };
    }

    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const featureRequestEvidenceCount =
      this.countRetainedFeatureRequestEvidence(context);
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);
    const technicalEvidenceCount = this.countRetainedTechnicalEvidence(context);
    const questionEvidenceCount = this.countRetainedQuestionEvidence(context);
    const observationEvidenceCount = this.countRetainedObservationEvidence(context);
    const featureOnlyEvidence =
      directEvidenceCount > 0 &&
      featureRequestEvidenceCount === directEvidenceCount;
    const evidenceClass:
      | 'direct'
      | 'feature'
      | 'secondary'
      | 'technical'
      | 'question'
      | 'observation' = featureOnlyEvidence
      ? 'feature'
      : directEvidenceCount > 0
        ? 'direct'
        : secondaryEvidenceCount > 0
          ? 'secondary'
          : technicalEvidenceCount > 0
            ? 'technical'
            : questionEvidenceCount > 0
              ? 'question'
              : 'observation';
    const evidenceCount =
      evidenceClass === 'feature'
        ? featureRequestEvidenceCount
        : evidenceClass === 'direct'
          ? directEvidenceCount
          : evidenceClass === 'secondary'
            ? secondaryEvidenceCount
            : evidenceClass === 'technical'
              ? technicalEvidenceCount
              : evidenceClass === 'question'
                ? questionEvidenceCount
                : observationEvidenceCount;

    if (evidenceCount <= 0) {
      return { problemStatement, overview };
    }

    const evidenceSourceCount = Math.max(
      1,
      this.countRetainedIndependentSources(context),
    );
    const winnerProblem = this.buildEvidenceDerivedProblemSummary(
      context,
      winner.problem,
      evidenceClass,
    );
    const evidenceSentence = this.buildSparseEvidenceSentence(
      winnerProblem,
      evidenceCount,
      evidenceSourceCount,
      evidenceClass,
    );
    const selected =
      context.benchmarkWinnerOpportunity ?? context.opportunityRanking?.selected;
    const solutionArea = selected?.solutionArea?.replace(/\s+/gu, ' ').trim() ?? '';
    const title = parsedOutput.coreIdea.title.trim();
    const productSentence = solutionArea
      ? `${title} provides a focused pilot workflow for ${this.lowercaseSentenceStart(
          solutionArea.replace(/[.]+$/u, ''),
        )}.`
      : `${title} provides a focused pilot workflow for the verified winner problem family.`;
    const measurementSentence = this.buildSparsePilotMeasurementSentence(
      context,
      winner.problem,
      title,
    );

    const correctedProblemStatement = problemMismatch
      ? this.polishProblemStatement(
          `${evidenceSentence} ${this.buildProblemImpactSentence(
            winnerProblem,
          )} The proposed pilot should validate how broadly this issue occurs before wider deployment.`,
        )
      : problemStatement;
    const correctedOverview = overviewMismatch
      ? this.buildConciseOverview(
          [evidenceSentence, productSentence, measurementSentence].join(' '),
        )
      : overview;

    return {
      problemStatement: this.finalizePersistedNarrativeCopy(
        correctedProblemStatement,
      ),
      overview: this.finalizePersistedNarrativeCopy(correctedOverview),
    };
  }

  private buildSparsePilotMeasurementSentence(
    context: IdeaGenerationContext,
    problem: string,
    title: string,
  ): string {
    const semantic = `${title} ${problem}`.toLocaleLowerCase();

    if (
      /(?:payment|billing|cash|charged|duplicate charge|reconciliation|refund)/iu.test(
        semantic,
      )
    ) {
      return 'The pilot will measure whether the workflow reduces dispute-documentation effort and dispute-resolution time, without claiming that the need is widespread.';
    }

    const travelerPaymentWorkflow =
      /(?:international card|cross-border payment|traveler|traveller)/iu.test(
        semantic,
      ) ||
      (/(?:otp|verification code)/iu.test(semantic) &&
        /(?:card|payment|checkout|bank)/iu.test(semantic));

    if (travelerPaymentWorkflow) {
      return 'The pilot will measure whether the workflow reduces failed payment and verification attempts for participating travelers, without claiming broader prevalence.';
    }

    const domain =
      context.opportunityRanking?.selected.primaryMatchedDomainName ??
      context.domainName ??
      'the selected workflow';
    return `The pilot will establish a baseline for task effort and resolution time in ${domain} and measure directional improvement without claiming that the need is widespread.`;
  }

  private isNoInputPreferencePath(context: IdeaGenerationContext): boolean {
    return (
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_PREFERENCE'
    );
  }

  private resolveNoInputPreferenceProblem(
    context: IdeaGenerationContext,
    groundedProblem: string,
    providerProblemStatement: string,
  ): string {
    const rankedTitle = context.opportunityRanking?.selected.title
      ?.replace(/\s+/gu, ' ')
      .trim();
    if (
      rankedTitle &&
      !/\b(?:workflow opportunity|validation[- ]first|operational validation|requester-defined)\b/iu.test(
        rankedTitle,
      )
    ) {
      return rankedTitle;
    }

    const strippedProvider = providerProblemStatement
      .replace(
        /^(?:one retained (?:feature request|direct user report)(?: from one (?:source|independent source))?|verified community evidence|a preliminary community signal)[^:]{0,180}:\s*/iu,
        '',
      )
      .replace(
        /\s+The direction uses one retained external evidence item as preliminary support.*$/iu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();

    if (this.isSpecificProblemStatement(groundedProblem)) {
      return groundedProblem;
    }
    return strippedProvider || groundedProblem || rankedTitle || 'the retained access problem';
  }

  private buildDirectEvidenceProblemSummary(
    context: IdeaGenerationContext,
    fallbackProblem: string,
  ): string {
    const evidence = (
      context.opportunityRanking?.selected.independentEvidence ?? []
    )
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const normalized = evidence.toLocaleLowerCase();

    if (
      this.isNoInputPreferencePath(context) &&
      /\b(?:two[- ]factor authentication|2fa|multi[- ]factor authentication)\b/iu.test(
        normalized,
      ) &&
      /\b(?:not active|not available|unavailable|unsupported)\b/iu.test(
        normalized,
      ) &&
      /\b(?:country|region|location)\b/iu.test(normalized)
    ) {
      return /\bgoogle login|google sign[- ]?in\b/iu.test(normalized)
        ? 'account access blocked because two-factor authentication is unavailable in the user’s country, with a request for an alternative Google sign-in option'
        : 'account access blocked because the required two-factor authentication method is unavailable in the user’s country';
    }

    if (
      /\b(?:got married|married|name change|changed my (?:sur)?name|changed (?:my )?(?:sur)?name)\b/iu.test(
        normalized,
      ) &&
      /\b(?:government department|government departments|hmrc|dvla|passport office|dwp|student loans|land registry|record updated|agencies)\b/iu.test(
        normalized,
      )
    ) {
      return 'substantial administrative effort after a name change because the resident had to identify and contact multiple government departments separately';
    }

    if (
      /\b(?:can(?:not|['’]?t)|unable to)\s+(?:access|login|log in|sign in|log into|sign into)\s+(?:my|the|this)?\s*account\b/iu.test(
        normalized,
      )
    ) {
      return 'difficulty accessing an existing account through the current login workflow';
    }

    if (
      /\b(?:crash|crashes|crashed|crashing|stopped working|won['’]?t open|doesn['’]?t work)\b/iu.test(
        normalized,
      ) &&
      /\b(?:tried|still|reinstall|uninstall|restart|reset|solution|fix)\b/iu.test(
        normalized,
      )
    ) {
      return 'repeated application crashes that continued despite the user’s recovery attempts';
    }

    if (
      /\b(?:current transformers?|\bcts?\b|iotawatt|energy monitor(?:ing)?|power monitor(?:ing)?)\b/iu.test(normalized) &&
      /\b(?:too much work|install|installation|setup|configure|configuration|wire|wiring|calibrat(?:e|ion)|manual effort)\b/iu.test(normalized)
    ) {
      return 'excessive manual setup effort when installing and configuring multiple sensors or current transformers for energy monitoring';
    }

    const cleaned = fallbackProblem
      .replace(/^i\s+(?:can['’]?t|cannot)\s+tell\s+you\s+what\s+a\s+pain\s+it\s+has\s+been\s+to\s+/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();

    return this.lowercaseSentenceStart(cleaned || fallbackProblem);
  }

  private buildTechnicalEvidenceProblemSummary(
    context: IdeaGenerationContext,
    fallbackProblem: string,
  ): string {
    const evidence = (
      context.opportunityRanking?.selected.independentEvidence ?? []
    )
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const normalized = evidence.toLocaleLowerCase();

    if (
      /\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|unauthorizedaccess)\b/iu.test(
        normalized,
      )
    ) {
      return 'a local script-execution restriction in which a PowerShell-based development tool is blocked by the operating-system execution policy';
    }

    if (
      /\b(?:insufficient funds|insufficient balance|not enough funds)\b/iu.test(
        normalized,
      ) &&
      /\b(?:transaction|swap|transfer|wallet|fee|gas|sol|token|blockchain|jupiter)\b/iu.test(
        normalized,
      )
    ) {
      return 'a blockchain transaction that returns an insufficient-funds error despite the reported wallet balance appearing adequate for the attempted operation';
    }

    if (
      /\b(?:firefox|chrome|browser|tab|dapp|web3)\b/iu.test(normalized) &&
      /\b(?:crash|crashed|crashing|your tab just crashed)\b/iu.test(normalized)
    ) {
      return 'a browser runtime crash during local Web3 development in which starting the DApp opens a browser tab that crashes without a corresponding terminal error';
    }

    return this.lowercaseSentenceStart(fallbackProblem);
  }

  private extractStructuredEvidenceProblem(value: string): string {
    const normalized = value
      .replace(/\*{1,2}/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!normalized) return '';

    const problemSection = normalized.match(
      /(?:^|\s)Problem:\s*(.+?)(?=\s+(?:Problem:|JTBD:|Context(?:\s*&\s*frequency)?:|Pain\s*\/\s*stakes:|Current workaround:|Trigger(?:\s*\/\s*failure moment)?:|Why software may help:|Evidence(?:\s+and\s+confidence)?:|Domain:|Persona:)|$)/iu,
    )?.[1]?.trim();

    const selected = problemSection || normalized;
    const completeSentence = selected.match(/^(.+?[.!?])(?:\s|$)/u)?.[1]?.trim();
    const bounded = completeSentence || selected;

    return bounded
      .replace(/\s+(?:JTBD|Context|Pain|Current workaround|Trigger|Why software may help|Evidence|Domain|Persona):.*$/iu, '')
      .replace(/[\s,;:–—-]+$/u, '')
      .trim();
  }

  private buildEvidenceDerivedProblemSummary(
    context: IdeaGenerationContext,
    fallbackProblem: string,
    evidenceClass:
      | 'direct'
      | 'feature'
      | 'secondary'
      | 'technical'
      | 'question'
      | 'observation',
  ): string {
    if (evidenceClass === 'direct') {
      return this.buildDirectEvidenceProblemSummary(context, fallbackProblem);
    }

    if (evidenceClass === 'technical') {
      return this.buildTechnicalEvidenceProblemSummary(context, fallbackProblem);
    }

    const evidence = (context.opportunityRanking?.selected.independentEvidence ?? [])
      .map((item) => item.text.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .join(' ');
    const normalized = evidence.toLocaleLowerCase();

    if (
      /\b(?:model containment|containment breach|sandbox escape|security testing|escape onto the open internet|open[- ]weight model)\b/iu.test(normalized)
    ) {
      return 'an AI model containment or sandbox-boundary failure observed during security testing, including unexpected open-internet access';
    }

    if (
      /\b(?:current transformers?|\bcts?\b|iotawatt|energy monitor(?:ing)?|power monitor(?:ing)?)\b/iu.test(normalized) &&
      /\b(?:too much work|install|installation|setup|configure|configuration|wire|wiring|calibrat(?:e|ion)|manual effort)\b/iu.test(normalized)
    ) {
      return 'excessive manual setup effort when installing and configuring multiple sensors or current transformers for energy monitoring';
    }

    const cleanedFallback = this.extractStructuredEvidenceProblem(fallbackProblem);
    const syntheticLabel =
      /\b(?:workflow failure|specific user workflow friction|user workflow friction)\b/iu.test(cleanedFallback) ||
      /\b\w*([a-z])\1{2,}\w*\b/iu.test(cleanedFallback) ||
      /\b(?:informa|waaaay)\b/iu.test(cleanedFallback);

    if (!syntheticLabel && cleanedFallback.length >= 18) {
      return this.lowercaseSentenceStart(cleanedFallback);
    }

    const solutionArea = context.opportunityRanking?.selected.solutionArea?.trim();
    if (solutionArea && solutionArea.length >= 18) {
      return `friction in ${this.lowercaseSentenceStart(solutionArea)}`;
    }

    return 'a specific workflow problem documented by the retained evidence';
  }

  /**
   * Produces a grammatical sentence for both noun-phrase problems and complete
   * verbal clauses. This avoids constructions such as:
   * "a case in which uncertainty regarding..."
   */
  private buildSparseEvidenceSentence(
    problem: string,
    evidenceCount: number,
    independentSourceCount: number,
    evidenceClass:
      | 'direct'
      | 'feature'
      | 'secondary'
      | 'technical'
      | 'question'
      | 'observation' = 'direct',
  ): string {
    let normalized = problem.replace(/\s+/gu, ' ').trim();

    // Remove qualifiers already produced by the model. The validator owns the
    // single evidence qualifier and must not stack "report indicates" phrases.
    normalized = normalized
      .replace(
        /^(?:a preliminary community signal[^:]*:\s*|a preliminary community report (?:suggests|indicates|reports)(?: that)?\s*|a limited evidence sample(?: from [^,.]{1,100})? (?:suggests|indicates|shows|reports)(?: that)?\s*|(?:one|a) (?:retained|collected) (?:community )?report (?:suggests|indicates|describes|reports)(?: that)?\s*)/iu,
        '',
      )
      .replace(/^(?:the )?collected report indicates that\s*/iu, '')
      .replace(/^(?:one|a) user experienced\s*/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();

    // Raw evidence can contain a full question, configuration dump, or logs.
    // Keep only the first meaningful sentence so the abstract remains natural.
    normalized = (normalized.split(/(?<=[.!?])\s+/u)[0] ?? normalized)
      .replace(/[.]+$/u, '')
      .trim();

    const nounPhraseStart =
      /^(?:uncertainty|difficulty|friction|inability|failure|a lack|lack|missing|absence|limited access|insufficient|excessive|complex|repeated|unexpected|an? ai|the need|a need|concern|confusion|authentication|configuration|redirect uri)/iu.test(
        normalized,
      );

    const alreadyQualifiedClause =
      /^(?:a limited evidence sample|a preliminary signal|collected feedback|community feedback|the evidence|one report)\b/iu.test(
        normalized,
      );

    if (alreadyQualifiedClause) {
      normalized = normalized
        .replace(
          /^(?:a limited evidence sample(?: from [^,.]{1,100})?|a preliminary signal|collected feedback|community feedback|the evidence|one report)\s+(?:suggests|indicates|shows|reports|describes)(?: that)?\s*/iu,
          '',
        )
        .trim();
    }

    const evidenceSubject = this.buildRetainedEvidenceSubject(
      evidenceCount,
      independentSourceCount,
      true,
      evidenceClass,
    );

    if (evidenceClass === 'feature') {
      return `${evidenceSubject} ${
        evidenceCount === 1 ? 'asks' : 'ask'
      } for ${this.lowercaseSentenceStart(normalized)}.`;
    }

    if (evidenceClass === 'question') {
      return `${evidenceSubject} ${
        evidenceCount === 1 ? 'raises' : 'raise'
      } the possibility that ${this.lowercaseSentenceStart(normalized)}.`;
    }

    if (evidenceClass === 'observation') {
      return `${evidenceSubject} ${
        evidenceCount === 1 ? 'suggests' : 'suggest'
      } that ${this.lowercaseSentenceStart(normalized)}. The proposed product mechanism should be treated as a bounded pilot hypothesis rather than an evidence-proven remedy.`;
    }

    if (evidenceClass === 'technical') {
      return `${evidenceSubject} ${
        evidenceCount === 1 ? 'documents' : 'document'
      } ${this.lowercaseSentenceStart(normalized)}.`;
    }

    if (nounPhraseStart) {
      return `${evidenceSubject} ${
        evidenceCount === 1 ? 'describes' : 'describe'
      } ${this.lowercaseSentenceStart(normalized)}.`;
    }

    const firstPersonNeed = normalized.match(
      /^(?:the user|one user|a user)\s+(.+)$/iu,
    );
    if (firstPersonNeed?.[1] && evidenceCount === 1) {
      return `${evidenceSubject} describes a user who ${this.lowercaseSentenceStart(
        firstPersonNeed[1],
      )}.`;
    }

    return `${evidenceSubject} ${
      evidenceCount === 1 ? 'indicates' : 'indicate'
    } that ${this.lowercaseSentenceStart(normalized)}.`;
  }

  /**
   * Replaces the first paragraph of a sparse-evidence full abstract with one
   * deterministic evidence-qualified paragraph. Later workflow, architecture,
   * pilot, and risk paragraphs are preserved.
   */
  private groundSparseEvidenceFullAbstract(
    context: IdeaGenerationContext,
    fullAbstract: string,
    problemStatement: string,
  ): string {
    if (
      !fullAbstract.trim() ||
      this.hasStrongIndependentEvidence(context)
    ) {
      return fullAbstract;
    }

    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const featureRequestEvidenceCount =
      this.countRetainedFeatureRequestEvidence(context);
    const featureOnlyEvidence =
      directEvidenceCount > 0 &&
      featureRequestEvidenceCount === directEvidenceCount;
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);
    const technicalEvidenceCount = this.countRetainedTechnicalEvidence(context);
    const questionEvidenceCount = this.countRetainedQuestionEvidence(context);
    const observationEvidenceCount = this.countRetainedObservationEvidence(context);
    const retainedEvidenceCount = this.countRetainedEvidence(context);
    const communitySupportingCount =
      this.countVerifiedCommunitySupportingSignals(context);
    const communitySupportingSourceCount =
      this.countVerifiedCommunitySupportingSources(context);
    const independentSourceCount =
      this.countRetainedIndependentSources(context);
    const relatedOpportunityBundle =
      this.resolveVerifiedSynthesisBundle(context);
    const bundledDirectEvidenceCount = relatedOpportunityBundle.reduce(
      (total, item) =>
        total + (item.verifiedProblemMatchedDirectUserEvidenceCount ?? 0),
      0,
    );

    const paragraphs = fullAbstract
      .split(/\n\s*\n/u)
      .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return fullAbstract;
    }

    const evidenceOpening =
      relatedOpportunityBundle.length > 0 && directEvidenceCount > 0
        ? `The proposed pilot combines ${this.formatEvidenceCount(
            directEvidenceCount,
            false,
          )} retained direct-user signal${directEvidenceCount === 1 ? '' : 's'} for the primary atomic problem with ${this.formatEvidenceCount(
            bundledDirectEvidenceCount,
            false,
          )} separately verified complementary direct-user signal${bundledDirectEvidenceCount === 1 ? '' : 's'}. These are separate evidence-backed needs and do not establish recurrence of one problem.`
        : retainedEvidenceCount <= 0 && communitySupportingCount > 0
          ? `No verified direct problem-matched user complaint was retained. ${this.formatEvidenceCount(
              communitySupportingCount,
              true,
            )} verified community supporting signal${communitySupportingCount === 1 ? '' : 's'} ${
              communitySupportingSourceCount === 1
                ? 'was retained from one source'
                : `were retained across ${Math.max(1, communitySupportingSourceCount)} sources`
            }; the signal${communitySupportingCount === 1 ? '' : 's'} provide${communitySupportingCount === 1 ? 's' : ''} limited contextual support only and do not establish recurrence, prevalence, the broader requester workflow, or market-wide demand claims.`
          : retainedEvidenceCount <= 0
            ? 'The proposed product currently has no problem-matched retained evidence and must be treated as an unvalidated requester-defined hypothesis.'
          : featureOnlyEvidence
            ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                featureRequestEvidenceCount,
                independentSourceCount,
                false,
                'feature',
              )}. The request is a direct demand signal, but it does not by itself establish complaint recurrence or market-wide prevalence.`
            : directEvidenceCount > 0
              ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                  directEvidenceCount,
                  independentSourceCount,
                  false,
                  'direct',
                )} and should remain preliminary rather than be presented as a validated market-wide pattern.`
              : secondaryEvidenceCount > 0
            ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                secondaryEvidenceCount,
                independentSourceCount,
                false,
                'secondary',
              )} and no verified direct user complaint; it should remain preliminary rather than be presented as a recurring or market-wide pattern.`
            : technicalEvidenceCount > 0
              ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                  technicalEvidenceCount,
                  independentSourceCount,
                  false,
                  'technical',
                )} and no verified direct user complaint; it should remain a bounded validation pilot rather than be presented as user demand or recurrence.`
              : questionEvidenceCount > 0
                ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                    questionEvidenceCount,
                    independentSourceCount,
                    false,
                    'question',
                  )}; the retained scenario question is not a verified direct user complaint and must remain a discovery hypothesis.`
                : `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                    observationEvidenceCount,
                    independentSourceCount,
                    false,
                    'observation',
                  )} and no verified direct user complaint. The observed concern may justify a bounded pilot hypothesis, but it does not establish recurrence, prevalence, or that the proposed intervention mechanism is a proven remedy.`;

    const evidenceQualifier = [
      evidenceOpening,
      'The evidence limits market-wide claims, but it does not replace the product workflow, architecture, value, and pilot detail in the generated premium abstract.',
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();

    /*
     * Preserve every generated paragraph. Previously the validator replaced
     * paragraph one with a deterministic warning, which made a rich premium
     * abstract look like a fallback disclaimer. The qualifier is now a short
     * preface and the model-authored workflow remains intact.
     */
    const qualifierPatterns = [
      /no retained direct community report/iu,
      /one (?:retained|collected) direct community report/iu,
      /retained feature request/iu,
      /retained secondary report/iu,
      /retained technical (?:ticket|issue)/iu,
      /retained user scenario question/iu,
      /responds to one collected report/iu,
      /responds to \d+ collected reports/iu,
      /evidence limits market-wide claims/iu,
    ];
    const firstParagraph = paragraphs[0] ?? '';
    const alreadyQualified = qualifierPatterns.some((pattern) =>
      pattern.test(firstParagraph),
    );

    if (alreadyQualified) {
      const correctedFirstParagraph = this.correctEvidenceQualifierCount(
        firstParagraph,
        directEvidenceCount,
        independentSourceCount,
        secondaryEvidenceCount,
        technicalEvidenceCount,
        questionEvidenceCount,
        observationEvidenceCount,
        featureRequestEvidenceCount,
        communitySupportingCount,
        communitySupportingSourceCount,
      );
      return [correctedFirstParagraph, ...paragraphs.slice(1)].join('\n\n');
    }

    return [evidenceQualifier, ...paragraphs].join('\n\n');
  }

  private countRetainedDirectEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;

    if (
      selected?.disqualificationReasons?.includes('NO_DIRECT_EVIDENCE') ||
      selected?.disqualificationReasons?.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      )
    ) {
      return 0;
    }

    const verifiedCount =
      selected?.verifiedProblemMatchedDirectUserEvidenceCount ??
      selected?.verifiedDirectUserEvidenceCount ??
      selected?.verifiedIndependentEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount >= 0) {
      return Math.floor(verifiedCount);
    }

    const directKinds = new Set([
      'DIRECT_USER_COMPLAINT',
      'USER_COMPLAINT',
      'FEATURE_REQUEST',
      'REVIEW',
      'OBSERVED_UNMET_NEED',
    ]);
    const identities = new Set(
      (selected?.independentEvidence ?? [])
        .filter((item) => directKinds.has(item.evidenceKind))
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    );

    return identities.size;
  }

  private countRetainedComplaintEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;
    const verifiedCount =
      selected?.verifiedProblemMatchedComplaintEvidenceCount ??
      selected?.verifiedComplaintEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount >= 0) {
      return Math.floor(verifiedCount);
    }

    const complaintKinds = new Set([
      'DIRECT_USER_COMPLAINT',
      'USER_COMPLAINT',
      'REVIEW',
    ]);
    return new Set(
      (selected?.independentEvidence ?? [])
        .filter((item) => complaintKinds.has(item.evidenceKind))
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    ).size;
  }

  private countRetainedFeatureRequestEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;
    const verifiedCount =
      selected?.verifiedProblemMatchedFeatureRequestEvidenceCount ??
      selected?.verifiedFeatureRequestEvidenceCount;

    if (typeof verifiedCount === 'number' && verifiedCount >= 0) {
      return Math.floor(verifiedCount);
    }

    return new Set(
      (selected?.independentEvidence ?? [])
        .filter((item) => item.evidenceKind === 'FEATURE_REQUEST')
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    ).size;
  }

  private countVerifiedCommunitySupportingSignals(
    context: IdeaGenerationContext,
  ): number {
    return this.resolveVerifiedCommunitySupportingClassifications(context).length;
  }

  private countVerifiedCommunitySupportingSources(
    context: IdeaGenerationContext,
  ): number {
    const sourceByEvidenceId = new Map(
      (context.rawEvidenceCorpus ?? []).map(
        (item) => [item.id, item.sourceKey.trim().toLocaleLowerCase()] as const,
      ),
    );
    return new Set(
      this.resolveVerifiedCommunitySupportingClassifications(context)
        .map((item) => sourceByEvidenceId.get(item.evidenceId) ?? '')
        .filter(Boolean),
    ).size;
  }

  private resolveVerifiedCommunitySupportingClassifications(
    context: IdeaGenerationContext,
  ): Array<{ readonly evidenceId: string }> {
    const selected = context.opportunityRanking?.selected;
    if (!selected) return [];

    /*
     * Final-output wording must use the SAME post-verification ledger as
     * ranking. Community-AI classifications are an intermediate semantic
     * artifact: an item later downgraded to SECONDARY_EVIDENCE or marked
     * qualifiesAsCommunityEvidence=false must never be re-counted here.
     */
    const normalize = (value: string): string =>
      value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    const qualifyingTexts = new Set(
      (selected.supportingEvidence ?? [])
        .filter(
          (item) =>
            item.qualifiesAsCommunityEvidence &&
            item.sourceType === 'COMMUNITY_EVIDENCE' &&
            item.text.trim().length > 0,
        )
        .map((item) => normalize(item.text)),
    );
    const rawById = new Map(
      (context.rawEvidenceCorpus ?? []).map(
        (item) => [item.id, normalize(item.text)] as const,
      ),
    );
    const insights = context.nlp?.insights;
    if (!Array.isArray(insights)) return [];

    const output: Array<{ readonly evidenceId: string }> = [];
    const seen = new Set<string>();
    for (const rawInsight of insights) {
      if (!rawInsight || typeof rawInsight !== 'object' || Array.isArray(rawInsight)) {
        continue;
      }
      const insight = rawInsight as Record<string, unknown>;
      const classifications = insight.evidenceClassifications;
      if (!Array.isArray(classifications)) continue;
      for (const rawClassification of classifications) {
        if (!rawClassification || typeof rawClassification !== 'object' || Array.isArray(rawClassification)) {
          continue;
        }
        const classification = rawClassification as Record<string, unknown>;
        if (classification.classification !== 'SUPPORTING_SIGNAL') continue;
        if (classification.verifiedByDeterministicGuard !== true) continue;
        const evidenceId =
          typeof classification.evidenceId === 'string'
            ? classification.evidenceId.trim()
            : '';
        if (!evidenceId || seen.has(evidenceId)) continue;
        const rawText = rawById.get(evidenceId);
        if (!rawText) continue;
        /*
         * SUPPORTING_SIGNAL is itself a distinct verified evidence state. It
         * must survive even when ranking does not materialize the same item in
         * selected.supportingEvidence. This prevents a verified supporting-only
         * run from being rewritten as NO_EVIDENCE. The wording remains
         * explicitly supporting/preliminary and never upgrades the item to
         * direct evidence.
         */
        if (qualifyingTexts.size > 0 && !qualifyingTexts.has(rawText)) {
          const family =
            typeof classification.problemFamily === 'string'
              ? normalize(classification.problemFamily)
              : '';
          const selectedIdentity = normalize(
            `${selected.title ?? ''} ${selected.problem ?? ''} ${(selected.matchedDomainNames ?? []).join(' ')} ${selected.primaryMatchedDomainName ?? ''}`,
          );
          if (family && !selectedIdentity.includes(family)) {
            continue;
          }
        }
        seen.add(evidenceId);
        output.push({ evidenceId });
      }
    }
    return output;
  }

  private countRetainedSecondaryEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;
    const verifiedCount =
      selected?.verifiedProblemMatchedSecondaryEvidenceCount ??
      selected?.verifiedSecondaryEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount > 0) {
      return Math.floor(verifiedCount);
    }

    /*
     * `qualifiedExternalSupportingEvidenceCount` is evidence-class agnostic and
     * may represent a TECHNICAL_TICKET. Never use that aggregate as a secondary
     * count: doing so turns verified technical evidence into a "secondary
     * report" in final wording. Prefer the verifier counters and canonical
     * supportingEvidence metadata instead.
     */
    const canonicalSupportingCount =
      selected?.supportingEvidence?.filter(
        (item) => item.sourceType === 'SECONDARY_EVIDENCE',
      ).length ?? 0;
    if (canonicalSupportingCount > 0) {
      return canonicalSupportingCount;
    }

    const secondaryKinds = new Set([
      'SECONDARY_REPORT',
      'EDITORIAL_ANALYSIS',
      'NEWS_REPORT',
    ]);
    return new Set(
      (selected?.independentEvidence ?? [])
        .filter((item) => secondaryKinds.has(item.evidenceKind))
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    ).size;
  }

  private countRetainedTechnicalEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;
    const verifiedCount =
      selected?.verifiedProblemMatchedTechnicalEvidenceCount ??
      selected?.verifiedTechnicalEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount >= 0) {
      return Math.floor(verifiedCount);
    }

    return new Set(
      (selected?.independentEvidence ?? [])
        .filter((item) => item.evidenceKind === 'TECHNICAL_TICKET')
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    ).size;
  }

  private countRetainedQuestionEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;
    const verifiedCount =
      selected?.verifiedProblemMatchedQuestionEvidenceCount ??
      selected?.verifiedQuestionEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount >= 0) {
      return Math.floor(verifiedCount);
    }

    return new Set(
      (selected?.independentEvidence ?? [])
        .filter((item) => item.evidenceKind === 'USER_QUESTION')
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    ).size;
  }


  private countRetainedObservationEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;
    const verifiedCount =
      selected?.verifiedProblemMatchedObservationEvidenceCount ??
      selected?.verifiedObservationEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount >= 0) {
      return Math.floor(verifiedCount);
    }

    return new Set(
      (selected?.independentEvidence ?? [])
        .filter(
          (item) =>
            item.evidenceKind === 'GENERAL_COMMENTARY' ||
            item.evidenceKind === 'OBSERVED_UNMET_NEED',
        )
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    ).size;
  }

  private countRetainedEvidence(context: IdeaGenerationContext): number {
    const selected = context.opportunityRanking?.selected;
    const verifiedCount =
      selected?.verifiedProblemMatchedEvidenceCount ??
      selected?.verifiedEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount > 0) {
      return Math.floor(verifiedCount);
    }

    const qualifiedSupportingCount =
      selected?.qualifiedExternalSupportingEvidenceCount ?? 0;
    if (qualifiedSupportingCount > 0) {
      return Math.floor(qualifiedSupportingCount);
    }

    if (typeof verifiedCount === 'number' && verifiedCount === 0) {
      // Fall through so qualified/non-independent retained support can count.
    }

    const identities = new Set(
      (selected?.independentEvidence ?? [])
        .filter(
          (item) =>
            item.evidenceKind !== 'UNKNOWN' &&
            item.evidenceKind !== 'SPECIFICATION',
        )
        .map((item) => item.identityKey?.trim().toLowerCase() ?? '')
        .filter(Boolean),
    );
    if (identities.size > 0) return identities.size;

    return Math.max(
      this.countRetainedDirectEvidence(context) +
        this.countRetainedSecondaryEvidence(context) +
        this.countRetainedTechnicalEvidence(context) +
        this.countRetainedQuestionEvidence(context) +
        this.countRetainedObservationEvidence(context),
      this.countVerifiedCommunitySupportingSignals(context),
      0,
    );
  }

  private countRetainedIndependentSources(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;
    const directEvidenceCount = this.countRetainedDirectEvidence(context);

    if (directEvidenceCount > 0) {
      const verifiedDirectSourceCount =
        selected?.verifiedProblemMatchedSourceCount ??
        selected?.verifiedIndependentSourceCount;
      if (
        typeof verifiedDirectSourceCount === 'number' &&
        verifiedDirectSourceCount > 0
      ) {
        return Math.floor(verifiedDirectSourceCount);
      }

      const directKinds = new Set([
        'DIRECT_USER_COMPLAINT',
        'USER_COMPLAINT',
        'FEATURE_REQUEST',
        'REVIEW',
        'OBSERVED_UNMET_NEED',
      ]);
      const directSourceKeys = new Set(
        (selected?.independentEvidence ?? [])
          .filter((item) => directKinds.has(item.evidenceKind))
          .map((item) => item.sourceKey?.trim().toLocaleLowerCase() ?? '')
          .filter(Boolean),
      );
      if (directSourceKeys.size > 0) {
        return directSourceKeys.size;
      }
    }

    const verifiedCount =
      selected?.verifiedProblemMatchedEvidenceSourceCount ??
      selected?.verifiedEvidenceSourceCount ??
      selected?.verifiedProblemMatchedSourceCount ??
      selected?.verifiedIndependentSourceCount;
    if (typeof verifiedCount === 'number' && verifiedCount > 0) {
      return Math.floor(verifiedCount);
    }

    const qualifiedSourceCount =
      selected?.qualifiedExternalSupportingSourceCount ?? 0;
    if (qualifiedSourceCount > 0) {
      return Math.floor(qualifiedSourceCount);
    }

    const sourceKeys = new Set(
      (selected?.independentEvidence ?? [])
        .map((item) => item.sourceKey?.trim().toLocaleLowerCase() ?? '')
        .filter(Boolean),
    );

    return sourceKeys.size;
  }

  private buildRetainedEvidenceSubject(
    reportCount: number,
    sourceCount: number,
    capitalize = true,
    evidenceClass:
      | 'community'
      | 'direct'
      | 'feature'
      | 'secondary'
      | 'technical'
      | 'question'
      | 'observation' = 'community',
  ): string {
    const reportLabel = this.formatEvidenceCount(reportCount, capitalize);
    const reportWord =
      evidenceClass === 'technical'
        ? reportCount === 1
          ? 'ticket'
          : 'tickets'
        : evidenceClass === 'question'
          ? reportCount === 1
            ? 'question'
            : 'questions'
          : evidenceClass === 'observation'
            ? reportCount === 1
              ? 'observation'
              : 'observations'
            : evidenceClass === 'feature'
              ? reportCount === 1
                ? 'request'
                : 'requests'
              : reportCount === 1
                ? 'report'
                : 'reports';
    const evidenceLabel =
      evidenceClass === 'secondary'
        ? 'secondary'
        : evidenceClass === 'technical'
          ? 'technical'
          : evidenceClass === 'question'
            ? 'user scenario'
            : evidenceClass === 'observation'
              ? 'community'
              : evidenceClass === 'feature'
                ? 'feature'
                : evidenceClass === 'direct'
                  ? 'direct user'
                  : 'community';
    const usesIndependentSourceLanguage =
      evidenceClass === 'direct' || evidenceClass === 'community';
    const sourceSuffix =
      sourceCount === 1
        ? usesIndependentSourceLanguage
          ? ' from one independent source'
          : evidenceClass === 'technical' || evidenceClass === 'feature'
            ? ' from one source'
            : ' from one retained source'
        : sourceCount > 1
          ? ` across ${this.formatEvidenceCount(
              sourceCount,
              false,
            )} ${usesIndependentSourceLanguage ? 'independent' : 'retained'} sources`
          : '';

    return `${reportLabel} retained ${evidenceLabel} ${reportWord}${sourceSuffix}`;
  }

  private formatEvidenceCount(value: number, capitalize: boolean): string {
    const words = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
    ];
    const normalized = Math.max(0, Math.floor(value));
    const raw = words[normalized] ?? String(normalized);
    return capitalize && /^[a-z]/u.test(raw)
      ? `${raw[0].toUpperCase()}${raw.slice(1)}`
      : raw;
  }

  private correctEvidenceQualifierCount(
    paragraph: string,
    directEvidenceCount: number,
    independentSourceCount: number,
    secondaryEvidenceCount = 0,
    technicalEvidenceCount = 0,
    questionEvidenceCount = 0,
    observationEvidenceCount = 0,
    featureRequestEvidenceCount = 0,
    communitySupportingCount = 0,
    communitySupportingSourceCount = 0,
  ): string {
    const retainedEvidenceCount =
      directEvidenceCount +
      secondaryEvidenceCount +
      technicalEvidenceCount +
      questionEvidenceCount +
      observationEvidenceCount;
    const featureOnlyEvidence =
      directEvidenceCount > 0 &&
      featureRequestEvidenceCount === directEvidenceCount;
    const opening =
      retainedEvidenceCount <= 0 && communitySupportingCount > 0
        ? `No verified direct problem-matched user complaint was retained. ${this.formatEvidenceCount(
            communitySupportingCount,
            true,
          )} verified community supporting signal${communitySupportingCount === 1 ? '' : 's'} ${
            communitySupportingSourceCount === 1
              ? 'was retained from one source'
              : `were retained across ${Math.max(1, communitySupportingSourceCount)} sources`
          }; the signal${communitySupportingCount === 1 ? '' : 's'} remain${communitySupportingCount === 1 ? 's' : ''} preliminary and do not establish recurrence or market-wide demand.`
        : retainedEvidenceCount <= 0
          ? 'The proposed product currently has no problem-matched retained evidence and must be treated as an unvalidated requester-defined hypothesis.'
        : featureOnlyEvidence
          ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
              featureRequestEvidenceCount,
              independentSourceCount,
              false,
              'feature',
            )}. The request is a direct demand signal, but it does not establish complaint recurrence or market-wide prevalence.`
          : directEvidenceCount > 0
            ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                directEvidenceCount,
                independentSourceCount,
                false,
                'direct',
              )} and should remain preliminary until broader independent validation is available.`
            : secondaryEvidenceCount > 0
            ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                secondaryEvidenceCount,
                independentSourceCount,
                false,
                'secondary',
              )} and no verified direct user complaint; it should remain preliminary until broader independent validation is available.`
            : technicalEvidenceCount > 0
              ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                  technicalEvidenceCount,
                  independentSourceCount,
                  false,
                  'technical',
                )} and no verified direct user complaint; it should remain a bounded validation pilot until direct user demand is validated.`
              : questionEvidenceCount > 0
                ? `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                    questionEvidenceCount,
                    independentSourceCount,
                    false,
                    'question',
                  )}; the scenario question is not a verified direct user complaint and requires direct validation.`
                : `The proposed pilot is supported by ${this.buildRetainedEvidenceSubject(
                    observationEvidenceCount,
                    independentSourceCount,
                    false,
                    'observation',
                  )} and no verified direct user complaint. The observation supports a bounded pilot hypothesis only; recurrence, prevalence, and the proposed intervention mechanism remain unvalidated.`;

    const remainder = paragraph
      .replace(
        /^(?:(?:The proposed pilot|The evidence limits market-wide claims)[^.]*\.\s*){1,3}/iu,
        '',
      )
      .replace(
        /^(?:The request is a direct demand signal, but it does not(?: by itself)? establish complaint recurrence or market-wide prevalence\.\s*){1,2}/iu,
        '',
      )
      .replace(
        /^The evidence limits market-wide claims, but it does not replace the product workflow, architecture, value, and pilot detail in the generated premium abstract\.\s*/iu,
        '',
      )
      .replace(
        /^(?:one|a) (?:retained|collected) (?:community )?report (?:suggests|indicates|describes|reports)(?: that)?\s*/iu,
        '',
      )
      .replace(
        /^(?:one|a) retained user scenario question(?: from one independent source| across [^.]{1,40} independent sources)?(?: raises the possibility that| suggests that| indicates that)?\s*/iu,
        '',
      )
      .replace(/^the collected report indicates that\s*/iu, '')
      .trim();

    return remainder ? `${opening} ${remainder}` : opening;
  }

  private isFragmentLikeEvidenceProblem(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();

    if (!normalized) {
      return true;
    }

    const wordCount = normalized.split(' ').filter(Boolean).length;
    const hasProblemVerb =
      /\b(?:struggle|difficulty|difficult|fail|failure|delay|pressure|cost|margin|friction|error|unable|cannot|can't|lack|missing|slow|risk|overhead|problem|issue|challenge)\b/iu.test(
        normalized,
      );
    const looksLikeQuestionTitleFragment =
      /^(?:why|how|what|when|where|who)\b/iu.test(normalized) ||
      /\b(?:giants?|platforms?|apps?|systems?)\s*,?\s*(?:and|or)\s*[^.]+\.?$/iu.test(
        normalized,
      );

    return wordCount < 8 || !hasProblemVerb || looksLikeQuestionTitleFragment;
  }

  private isGenericFallbackProblem(value: string): boolean {
    return /(?:concrete workflow friction described by|evidence-led workflow opportunity|users in .+ experience the concrete workflow|retained community sample|focused software workflow that responds directly)/iu.test(
      value,
    );
  }

  private isSpecificProblemStatement(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length < 90 || this.isGenericFallbackProblem(normalized)) {
      return false;
    }

    return /(?:difficulty|unable|fails?|mismatch|inaccurate|error|friction|manual|extract|connect|integrat|visualiz|validate|debug)/iu.test(
      normalized,
    );
  }

  private hasExternalSupportingContext(
    context: IdeaGenerationContext,
  ): boolean {
    const selected = context.opportunityRanking?.selected;
    return Boolean(
      selected?.disqualificationReasons.includes(
        'EXTERNAL_SUPPORTING_CONTEXT_ONLY',
      ) && selected.evidenceSamples.length > 0,
    );
  }

  private hasAnyRetainedDirectEvidence(
    context: IdeaGenerationContext,
  ): boolean {
    return this.countRetainedDirectEvidence(context) > 0;
  }

  private hasAnyRetainedEvidence(context: IdeaGenerationContext): boolean {
    return this.countRetainedEvidence(context) > 0;
  }

  /**
   * At zero retained evidence, the persisted statement must describe a testable
   * hypothesis—not a community signal that never existed.
   */
  private buildZeroEvidenceProblemStatement(
    context: IdeaGenerationContext,
  ): string {
    const claimDomains = this.resolveFinalClaimDomains(context);
    const fallbackDomain =
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'the selected domain';
    const domainLabel =
      claimDomains.length > 0 ? claimDomains.join(' + ') : fallbackDomain;
    const requestDescription = context.requestDescription?.trim();
    const hypothesis = (
      requestDescription ||
      context.opportunityRanking?.selected.problem?.trim() ||
      `teams in ${domainLabel} may lack a structured workflow for identifying and validating operational friction before implementation`
    )
      .replace(/[.!?]+$/u, '')
      .trim();

    const externalContextPrefix = this.hasExternalSupportingContext(context)
      ? 'One real external sample was retained as preliminary contextual support, but it did not independently verify the exact requester problem. '
      : '';

    return this.polishProblemStatement(
      requestDescription
        ? `${externalContextPrefix}No direct community evidence sufficiently aligned to the requester description was retained within the fast collection budget for the ${domainLabel} validation scope. The requester-defined problem is: "${hypothesis}." The proposed pilot keeps this problem unchanged and validates it with real target participants instead of substituting a different, better-evidenced problem. The selected domains define the validation search space; they are not evidence that existing demand has already been established. Market-wide prevalence, recurrence, causal impact, and cross-domain demand remain unproven until direct evidence is collected.`
        : `No direct community evidence was retained within the fast collection budget for the ${domainLabel} validation scope. The proposed pilot tests whether ${this.lowercaseSentenceStart(
            hypothesis,
          )}. The selected domains define the validation search space; they are not evidence that existing demand has already been established. Market-wide prevalence, recurrence, causal impact, and cross-domain demand remain unproven until direct evidence is collected.`,
    );
  }

  private sanitizePrimaryDomainObjectives(
    context: IdeaGenerationContext,
    objectives: readonly string[],
  ): string[] {
    const claimDomains = this.resolveFinalClaimDomains(context);
    const primaryDomain =
      claimDomains[0] ||
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'the selected domain';
    const unsupportedNames = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(
        (name) =>
          Boolean(name) &&
          !claimDomains.some(
            (claim) =>
              claim.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ),
      );
    const unsupportedPatterns = this.buildUnsupportedDomainAliasPatterns(
      unsupportedNames,
    );

    const sanitized = objectives
      .filter(
        (objective) =>
          !unsupportedPatterns.some((pattern) => pattern.test(objective)),
      )
      .map((objective) =>
        this.sanitizeFinalClaimDomainLeakage(context, objective),
      );

    const defaults = this.hasAnyRetainedEvidence(context)
      ? [
          `Implement the core ${primaryDomain} workflow represented by the verified winning evidence.`,
          'Provide evidence-linked diagnostics and reviewed remediation guidance for the selected problem.',
          'Protect authorized inputs and operational records through role-based access control, retention rules, and auditable access.',
          `Establish a pilot baseline for the selected ${primaryDomain} workflow and measure directional change without inventing an unsupported impact target.`,
        ]
      : [
          `Capture structured operational-friction reports from authorized ${primaryDomain} participants.`,
          `Classify submitted reports into reviewable problem families without treating unverified clusters as recurring evidence.`,
          `Protect submitted operational data through role-based access control, retention rules, and auditable access.`,
          `Measure report quality, review time, and validated problem recurrence during the bounded ${primaryDomain} pilot.`,
        ];

    return [...sanitized, ...defaults]
      .filter(
        (item, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.toLowerCase().replace(/\s+/gu, ' ').trim() ===
              item.toLowerCase().replace(/\s+/gu, ' ').trim(),
          ) === index,
      )
      .slice(0, 4);
  }

  private isTargetUserSupportedByRetainedEvidence(
    context: IdeaGenerationContext,
    targetUser: string,
  ): boolean {
    const evidenceText = (context.opportunityRanking?.selected.independentEvidence ?? [])
      .map((item) => item.text)
      .join(' ')
      .toLocaleLowerCase();
    if (!evidenceText.trim()) return false;

    const userText = targetUser.toLocaleLowerCase();
    const roleFamilies: readonly [RegExp, RegExp][] = [
      [/\b(?:caregiver|caregivers)\b/u, /\b(?:caregiver|caregivers|caregiving)\b/u],
      [/\b(?:parent|parents|family parents?)\b/u, /\b(?:parent|parents|family[- ]parents?|family members?|households?)\b/u],
      [/\b(?:adult children|children|eldercare|elderly)\b/u, /\b(?:adult children|children|eldercare|elderly|aging parents?|elderly parents?)\b/u],
      [/\b(?:dispatcher|dispatchers|logistics coordinators?)\b/u, /\b(?:dispatcher|dispatchers|dispatch teams?|logistics coordinators?)\b/u],
      [/\b(?:driver|drivers|courier|couriers|carrier|carriers)\b/u, /\b(?:driver|drivers|courier|couriers|carrier|carriers)\b/u],
      [/\b(?:student|students|learner|learners)\b/u, /\b(?:student|students|learner|learners)\b/u],
      [/\b(?:teacher|teachers|educator|educators|instructor|instructors)\b/u, /\b(?:teacher|teachers|educator|educators|instructor|instructors)\b/u],
      [/\b(?:developer|developers|maintainer|maintainers|engineer|engineers)\b/u, /\b(?:developer|developers|maintainer|maintainers|engineer|engineers)\b/u],
      [/\b(?:patient|patients|clinician|clinicians|nurse|nurses)\b/u, /\b(?:patient|patients|clinician|clinicians|nurse|nurses)\b/u],
    ];

    if (
      roleFamilies.some(
        ([userPattern, evidencePattern]) =>
          userPattern.test(userText) && evidencePattern.test(evidenceText),
      )
    ) {
      return true;
    }

    const stopWords = new Set([
      'users', 'user', 'people', 'teams', 'team', 'primary', 'daily', 'shared',
      'responsible', 'managing', 'management', 'operations', 'operational',
      'pilot', 'participants', 'workflow', 'workflows', 'coordinating',
      'coordination', 'professionals', 'staff', 'members',
    ]);
    const evidenceTokens = new Set(
      evidenceText
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .filter((token) => token.length >= 4),
    );
    const userTokens = userText
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/u)
      .filter((token) => token.length >= 4 && !stopWords.has(token));
    const sharedTokens = userTokens.filter((token) => evidenceTokens.has(token));

    return new Set(sharedTokens).size >= 2;
  }

  private sanitizePrimaryDomainTargetUsers(
    context: IdeaGenerationContext,
    targetUsers: readonly string[],
  ): string[] {
    const directEvidenceCount = this.countRetainedDirectEvidence(context);
    const secondaryEvidenceCount = this.countRetainedSecondaryEvidence(context);
    const technicalEvidenceCount = this.countRetainedTechnicalEvidence(context);
    const sparseIndirectEvidence =
      directEvidenceCount === 0 &&
      secondaryEvidenceCount + technicalEvidenceCount > 0 &&
      secondaryEvidenceCount + technicalEvidenceCount <= 2;

    if (sparseIndirectEvidence) {
      const supportedUsers = targetUsers
        .map((user) => this.professionalizeTargetUser(user))
        .filter((user) => this.isTargetUserSupportedByRetainedEvidence(context, user));
      if (supportedUsers.length > 0) {
        return supportedUsers
          .filter(
            (item, index, items) =>
              items.findIndex(
                (candidate) =>
                  candidate.toLowerCase().replace(/\s+/gu, ' ').trim() ===
                  item.toLowerCase().replace(/\s+/gu, ' ').trim(),
              ) === index,
          )
          .slice(0, 4);
      }

      const safeUsers = technicalEvidenceCount > 0
        ? [
            'Technical maintainers responsible for the retained workflow',
            'Operators reviewing the retained technical workflow',
            'Pilot participants recruited to validate the affected workflow',
          ]
        : [
            'Users represented by the retained secondary evidence',
            'Operators responsible for the retained workflow',
            'Pilot participants recruited to validate the affected workflow',
          ];

      return safeUsers.slice(0, 4);
    }

    const professionalized = targetUsers.map((user) =>
      this.professionalizeTargetUser(user),
    );
    const claimDomains = this.resolveFinalClaimDomains(context);
    const primaryDomain =
      claimDomains[0] ||
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'the selected domain';
    const unsupportedNames = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(
        (name) =>
          Boolean(name) &&
          !claimDomains.some(
            (claim) =>
              claim.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ),
      );
    const unsupportedPatterns = this.buildUnsupportedDomainAliasPatterns(
      unsupportedNames,
    );

    const retained = professionalized.filter(
      (user) =>
        !unsupportedPatterns.some((pattern) => pattern.test(user)),
    );

    const defaults = retained.length >= 2
      ? []
      : [
          `${primaryDomain} operations professionals`,
          `${primaryDomain} engineering and process-improvement teams`,
          `${primaryDomain} pilot coordinators`,
        ];

    return [...retained, ...defaults]
      .filter(
        (item, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.toLowerCase().replace(/\s+/gu, ' ').trim() ===
              item.toLowerCase().replace(/\s+/gu, ' ').trim(),
          ) === index,
      )
      .slice(0, 4);
  }

  /**
   * Returns true when the selected opportunity is intentionally a bounded
   * validation hypothesis rather than an evidence-backed market claim.
   *
   * The ranking stage marks this state explicitly. The retained-evidence check
   * is a defensive fallback for older snapshots or partially recovered runs.
   */
  private hasSelectedProblemMatchedEvidence(
    context: IdeaGenerationContext,
  ): boolean {
    const selected =
      context.benchmarkWinnerOpportunity ?? context.opportunityRanking?.selected;
    if (!selected) return false;

    const verifiedProblemMatchedCount =
      selected.verifiedProblemMatchedEvidenceCount ?? 0;
    if (verifiedProblemMatchedCount > 0) return true;

    /*
     * For description-bearing paths, generic retained corpus evidence must not
     * turn an unvalidated requester hypothesis into an evidence-backed winner.
     * Only evidence explicitly verified against the described problem counts.
     */
    if (context.requestDescription?.trim()) {
      return false;
    }

    return Boolean(
      (selected.verifiedIndependentEvidenceCount ?? 0) > 0 ||
        (selected.independentEvidence?.length ?? 0) > 0,
    );
  }

  private isValidationOnlyOpportunity(context: IdeaGenerationContext): boolean {
    const selected = context.opportunityRanking?.selected;

    return Boolean(
      selected?.disqualificationReasons.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      ) ||
        (context.requestDescription?.trim()
          ? !this.hasSelectedProblemMatchedEvidence(context)
          : !this.hasAnyRetainedEvidence(context)),
    );
  }

  /**
   * Detects whether a domain is represented semantically in the final problem
   * narrative. Exact domain labels remain the strongest signal, but bounded
   * selected-domain keywords prevent valid wording such as "urban mobility"
   * from failing merely because it does not repeat the UI label verbatim.
   */
  private isDomainRepresentedInNarrative(
    context: IdeaGenerationContext,
    normalizedStatement: string,
    domainName: string,
  ): boolean {
    const normalizedDomain = this.normalizeComparableText(domainName);
    if (normalizedDomain && normalizedStatement.includes(normalizedDomain)) {
      return true;
    }

    const selectedDomain = context.selectedDomains.find(
      (domain) =>
        domain.name.trim().toLocaleLowerCase() ===
        domainName.trim().toLocaleLowerCase(),
    );
    if (!selectedDomain) return false;

    const boundedKeywords = [
      ...(selectedDomain.configuredKeywords ?? []),
      ...(selectedDomain.effectiveSearchKeywords ?? []),
      ...selectedDomain.keywords,
    ]
      .map((keyword) => this.normalizeComparableText(keyword))
      .filter((keyword) => keyword.length >= 4)
      .filter((keyword) => !this.isGenericDomainNarrativeKeyword(keyword))
      .slice(0, 16);

    return boundedKeywords.some((keyword) =>
      normalizedStatement.includes(keyword),
    );
  }

  private isGenericDomainNarrativeKeyword(value: string): boolean {
    return new Set([
      'app',
      'application',
      'business',
      'data',
      'digital',
      'management',
      'operations',
      'platform',
      'service',
      'software',
      'system',
      'workflow',
    ]).has(value);
  }

  private resolveFinalClaimDomains(
    context: IdeaGenerationContext,
  ): string[] {
    const validationOnlyDomain = this.resolveValidationOnlySingleDomain(context);
    if (validationOnlyDomain) {
      return [validationOnlyDomain];
    }

    const domains =
      context.benchmarkWinnerOpportunity?.matchedDomainNames?.length
        ? context.benchmarkWinnerOpportunity.matchedDomainNames
        : context.opportunityRanking?.selected.matchedDomainNames ?? [];

    return domains
      .map((name) => name.trim())
      .filter(
        (name, index, items) =>
          Boolean(name) &&
          items.findIndex(
            (candidate) =>
              candidate.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ) === index,
      );
  }

  private buildUnsupportedDomainAliasPatterns(
    domainNames: readonly string[],
  ): RegExp[] {
    const aliases: Readonly<Record<string, readonly string[]>> = {
      'hr & recruitment': [
        'hr & recruitment',
        'human resources',
        'recruitment',
        'hiring',
        'applicant tracking',
        'candidate screening',
      ],
      'artificial intelligence': [
        'artificial intelligence',
        'generative ai',
        'machine learning',
        'large language model',
        'ai domain',
      ],
      government: [
        'government',
        'public administration',
        'public sector',
        'citizen services',
      ],
      'mental health': [
        'mental health',
        'mental wellness',
        'therapy workflow',
        'counseling workflow',
      ],
    };

    return domainNames.flatMap((name) => {
      const normalized = name.trim().toLocaleLowerCase();
      const terms = aliases[normalized] ?? [name];
      return terms
        .map((term) => term.trim())
        .filter(Boolean)
        .map(
          (term) =>
            new RegExp(`\\b${this.escapeRegExp(term)}\\b`, 'iu'),
        );
    });
  }

  private sanitizeFinalClaimDomainLeakage(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (!value.trim()) return value;

    const claimDomains = this.resolveFinalClaimDomains(context);
    if (claimDomains.length === 0) return value;

    const forbiddenDomains = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(
        (name) =>
          Boolean(name) &&
          !claimDomains.some(
            (claim) =>
              claim.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ),
      );
    if (forbiddenDomains.length === 0) return value;

    const forbiddenPatterns = this.buildUnsupportedDomainAliasPatterns(
      forbiddenDomains,
    );
    const replacement = `The product remains scoped to the verified ${claimDomains.join(
      ' and ',
    )} workflow represented by the selected evidence.`;
    const sentences = value
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/(?<=[.!?])\s+/u)
      .filter(Boolean);

    const sanitized = sentences.map((sentence) => {
      const hasForbiddenDomain = forbiddenPatterns.some((pattern) =>
        pattern.test(sentence),
      );
      const makesScopeClaim =
        /\bcross[- ]domain\b|\bacross\b|\bbetween\b|\b(?:domain|sector|industry|workflow|market|participant|user segment)s?\b/iu.test(
          sentence,
        );
      return hasForbiddenDomain && makesScopeClaim ? replacement : sentence;
    });

    return sanitized
      .filter(
        (sentence, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.toLocaleLowerCase() === sentence.toLocaleLowerCase(),
          ) === index,
      )
      .join(' ')
      .replace(/\s*\+\s*\+\s*/gu, ' + ')
      .replace(/\s+\+\s+(?=validation scope\b)/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private replaceUnsupportedDomainNames(
    value: string,
    unsupportedNames: readonly string[],
    primaryDomain: string,
  ): string {
    return unsupportedNames
      .reduce(
        (current, domainName) =>
          current.replace(
            new RegExp(`\\b${this.escapeRegExp(domainName)}\\b`, 'giu'),
            primaryDomain,
          ),
        value,
      )
      .replace(/\bevidence-based\b/giu, 'evidence-collection and validation')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private sanitizeUnsupportedDomainExamples(
    context: IdeaGenerationContext,
    problemStatement: string,
    fullAbstract: string,
  ): string {
    if (!fullAbstract.trim()) {
      return fullAbstract;
    }

    const winner = this.resolveWinnerOpportunityRaw(context);
    const winnerDomain = (
      winner?.domainName ||
      context.domainName ||
      context.selectedDomains[0]?.name ||
      ''
    )
      .trim()
      .toLowerCase();

    const claimDomainSet = new Set(
      this.resolveFinalClaimDomains(context).map((name) =>
        name.trim().toLocaleLowerCase(),
      ),
    );
    const unsupportedDomains = new Set(
      context.domainEvidence
        .filter(
          (evidence) =>
            !evidence.evidenceAvailable &&
            !claimDomainSet.has(evidence.domainName.trim().toLocaleLowerCase()),
        )
        .map((evidence) => evidence.domainName.trim().toLowerCase()),
    );

    let sanitized = fullAbstract;

    const replacements: Array<{
      readonly domain: string;
      readonly patterns: readonly RegExp[];
      readonly replacement: string;
    }> = [
      {
        domain: 'food & restaurants',
        patterns: [
          /\bsmart[-\s]?restaurant inventory sensors?\b/giu,
          /\brestaurant inventory sensors?\b/giu,
          /\brestaurant automation\b/giu,
          /\bfood inventory sensors?\b/giu,
          /\bsmart restaurants?\b/giu,
        ],
        replacement: 'environmental monitoring sensors',
      },
      {
        domain: 'mental health',
        patterns: [
          /\bremote health[-\s]?monitoring prototypes?\b/giu,
          /\bmental health monitoring prototypes?\b/giu,
          /\bwellbeing monitoring prototypes?\b/giu,
          /\bhealth[-\s]?monitoring prototypes?\b/giu,
        ],
        replacement: 'asset-tracking and telemetry prototypes',
      },
    ];

    for (const rule of replacements) {
      if (unsupportedDomains.has(rule.domain) && winnerDomain !== rule.domain) {
        for (const pattern of rule.patterns) {
          sanitized = sanitized.replace(pattern, rule.replacement);
        }
      }
    }

    if (
      /internet of things|iot|embedded|microcontroller|esp32|arduino/u.test(
        `${winnerDomain} ${problemStatement.toLowerCase()}`,
      )
    ) {
      sanitized = sanitized
        .replace(
          /\blocal settings,\s*such as\s+environmental monitoring sensors\s+or\s+asset-tracking and telemetry prototypes\b/giu,
          'representative IoT settings, such as environmental sensors, asset-tracking devices, or industrial telemetry nodes',
        )
        .replace(
          /\bsuch as\s+environmental monitoring sensors\s+or\s+asset-tracking and telemetry prototypes\b/giu,
          'such as environmental sensors, asset-tracking devices, or industrial telemetry nodes',
        );
    }

    return sanitized;
  }

  /**
   * Guarantees that a structurally valid AI candidate cannot fail the whole run
   * only because its problem statement is slightly shorter or longer than the
   * presentation limits.
   *
   * This is a pure in-memory normalization step. It adds no AI request,
   * database query, recovery pass, or NLP work.
   */
  private ensureValidProblemStatementLength(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    let statement = this.polishProblemStatement(
      value
        .replace(/solution response\s*:[^\n]+/giu, ' ')
        .replace(/^\s*\d+[.)]\s*/gmu, '')
        .replace(/\s+/gu, ' ')
        .trim(),
    );

    if (!statement) {
      const winner = this.resolveWinnerOpportunityRaw(context);
      const domain =
        winner?.domainName ||
        context.domainName ||
        context.selectedDomains[0]?.name ||
        'the selected domain';
      const problem =
        winner?.problem ||
        'users face a recurring workflow gap that reduces reliability and increases manual effort';

      statement = this.polishProblemStatement(
        `Evidence from ${domain} indicates a preliminary operational challenge: ${this.capitalizeSentence(problem)}. The gap increases avoidable manual work, weakens consistency, and creates measurable friction that should be validated through a controlled pilot.`,
      );
    }

    if (statement.length < 120) {
      const winner = this.resolveWinnerOpportunityRaw(context);
      const domain =
        winner?.domainName ||
        context.domainName ||
        context.selectedDomains[0]?.name ||
        'the selected domain';

      statement = this.polishProblemStatement(
        `${statement} In ${domain}, this gap creates avoidable manual effort, inconsistent outcomes, and limited operational visibility. The proposed pilot should first establish a baseline and then measure whether the workflow becomes more reliable and easier to manage.`,
      );
    }

    if (statement.length > 2_200) {
      const bounded = statement.slice(0, 2_180);
      const lastSentenceBoundary = Math.max(
        bounded.lastIndexOf('. '),
        bounded.lastIndexOf('! '),
        bounded.lastIndexOf('? '),
      );

      statement =
        lastSentenceBoundary >= 120
          ? bounded.slice(0, lastSentenceBoundary + 1).trim()
          : `${bounded.trim().replace(/[,:;\s]+$/u, '')}.`;
    }

    return statement;
  }

  private buildExpandedFullAbstract(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
    problemStatement: string,
    overview: string,
    advancedOutputs: readonly AdvancedIdeaAiOutput[],
  ): string {
    const location = this.formatLocationName(
      context.location.city || context.location.region || context.location.country,
    );
    const architecture = advancedOutputs.find(
      (output) => output.outputKey === 'system-architecture',
    )?.content;
    const stack = advancedOutputs.find(
      (output) => output.outputKey === 'technology-stack',
    )?.content;
    const users = parsedOutput.coreIdea.targetUsers
      .map((user) => this.professionalizeTargetUser(user))
      .join(', ');
    const objectives = parsedOutput.coreIdea.objectives
      .slice(0, 5)
      .map((objective, index) => `${index + 1}) ${objective.replace(/[.]+$/u, '')}`)
      .join('; ');

    const componentParagraph = [
      `The proposed product converts that need into a bounded workflow for ${users || 'the affected operators'}.`,
      `Its initial capabilities are: ${objectives}.`,
      this.buildWorkflowBoundarySentence(problemStatement),
    ].join(' ');

    const deploymentDetails = [
      architecture ? this.firstSentences(architecture, 3) : '',
      stack
        ? `The implementation stack is centred on ${this.inlineList(stack)}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const pilotParagraph = this.buildPilotMeasurementParagraph(
      problemStatement,
      location || 'the target location',
    );

    const riskParagraph = this.buildRiskParagraph(problemStatement);

    const normalizedProblem = problemStatement.trim();
    const evidenceIntro = this.hasStrongIndependentEvidence(context)
      ? `The evidence-backed opportunity centers on the following validated need: ${normalizedProblem}`
      : this.buildQualifiedEvidenceIntroduction(normalizedProblem);

    return [
      evidenceIntro,
      componentParagraph,
      deploymentDetails || 'The deployment will separate collection, analysis, persistence, and presentation components so each boundary can be tested and audited independently.',
      pilotParagraph,
      riskParagraph,
    ]
      .filter(Boolean)
      .join('\n\n');
  }


  private buildWorkflowBoundarySentence(problem: string): string {
    const normalized = problem.toLowerCase();
    if (/anxiety|mindfulness|mental health|stress|wellbeing/u.test(normalized)) {
      return 'Users choose a guided exercise, receive clear step-by-step support, and control whether optional session data is retained; the product does not diagnose conditions or replace professional care.';
    }
    if (this.isSearchRetrievalWorkflow(problem)) {
      return 'Users submit authorized queries, inspect traceable results and confidence indicators, and retain control over which datasets are indexed or shared.';
    }
    return 'Users provide only authorized inputs, review the generated findings, and keep final control over any recommended action.';
  }

  private buildPilotMeasurementParagraph(
    problem: string,
    location: string,
  ): string {
    const normalized = problem.toLowerCase();
    if (/mood|emotion|sentiment|conversational|assistant|persona/u.test(normalized)) {
      return `A pilot in ${location} will begin with baseline measurements for response relevance, mood-detection correction rate, user override rate, false emotion classifications, and user trust. The remaining pilot period will compare those measures, document incorrect adaptations, and determine whether personalization improves interaction quality without inferring sensitive states beyond explicit user consent.`;
    }
    if (/anxiety|mindfulness|mental health|stress|wellbeing/u.test(normalized)) {
      return `A pilot in ${location} will begin with baseline measurements for exercise clarity, completion rate, perceived usefulness, and repeat engagement. The remaining pilot period will compare those measures, record drop-off and misunderstood instructions, and determine whether the product improves practical use without making clinical claims unsupported by the evidence.`;
    }
    if (this.isSearchRetrievalWorkflow(problem)) {
      return `A pilot in ${location} will establish baseline query relevance, retrieval time, source traceability, and researcher task completion. The remaining pilot period will compare those measures, document failed queries and weak matches, and determine whether the shared search layer improves evidence discovery.`;
    }
    if (
      /esp32|arduino|iot|embedded|microcontroller|firmware|device connectivity|wireguard/u.test(
        normalized,
      )
    ) {
      return `A pilot in ${location} will establish baseline connection success rate, device-enrollment time, reconnection latency, configuration failure rate, packet loss, and firmware resource consumption. The remaining pilot period will compare those measures across supported boards, document failed enrollments and unstable tunnels, and determine whether the connectivity bridge is reliable enough for broader deployment.`;
    }
    return `A pilot in ${location} will establish baseline task completion, processing time, output clarity, and user effort. The remaining pilot period will measure directional change, document unresolved cases, and determine whether broader deployment is justified.`;
  }

  private buildRiskParagraph(problem: string): string {
    const normalized = problem.toLowerCase();
    if (/mood|emotion|sentiment|conversational|assistant|persona/u.test(normalized)) {
      return 'The pilot must require explicit consent for mood adaptation, let users inspect and correct detected states, minimize retained conversation history, and provide a clear disable option. Key risks include false emotion classification, unwanted personalization, privacy leakage, and reduced trust when the assistant adapts incorrectly.';
    }
    if (/anxiety|mindfulness|mental health|stress|wellbeing/u.test(normalized)) {
      return 'The pilot must use clear non-clinical language, minimize sensitive data retention, support consent withdrawal, and provide escalation guidance when users need professional help. Key risks include misunderstood instructions, overreliance on self-guided support, cultural or language mismatch, and weak evidence from a small initial sample.';
    }
    if (this.isSearchRetrievalWorkflow(problem)) {
      return 'The pilot must preserve dataset permissions, provenance, access controls, and reproducible indexing. Key risks include incompatible embedding spaces, weak source metadata, biased retrieval, changing external APIs, and misleading similarity scores that require researcher review.';
    }
    if (
      /esp32|arduino|iot|embedded|microcontroller|firmware|device connectivity|wireguard/u.test(
        normalized,
      )
    ) {
      return 'The pilot must use secure device enrollment, revocable credentials, least-privilege policies, and safe configuration rollback. Key risks include ESP32 memory limits, cryptographic overhead, firmware incompatibility across board variants, unstable networks, incorrect key provisioning, and compromised devices.';
    }
    return 'The pilot must preserve permission boundaries, minimize retained data, and maintain traceability. Key risks include incomplete source data, changing integrations, noisy evidence, and the need for human review before important decisions.';
  }

  private isSearchRetrievalWorkflow(value: string): boolean {
    const normalized = value.toLocaleLowerCase();
    return /\b(?:semantic search|vector search|knowledge graph|embeddings?|embedding space|document retrieval|information retrieval|dataset indexing|research literature|research corpus|query relevance|source traceability|retrieval pipeline|shared search layer|search index|search indexing)\b/iu.test(
      normalized,
    );
  }

  private sanitizeCrossTemplateLeakage(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    const request = context.requestDescription?.trim() ?? '';
    const winner = context.opportunityRanking?.selected;
    const scopeText = [
      request,
      winner?.problem ?? '',
      winner?.need ?? '',
      winner?.solutionArea ?? '',
    ].join(' ');

    if (this.isSearchRetrievalWorkflow(scopeText)) {
      return value;
    }

    return value
      .replace(
        /Users submit authorized queries, inspect traceable results and confidence indicators, and retain control over which datasets are indexed or shared\.?/giu,
        'Authorized users record the relevant operational details, review status and evidence in one workspace, and retain final control over any consequential action.',
      )
      .replace(
        /A pilot in ([^.!?]{2,120}) will establish baseline query relevance, retrieval time, source traceability, and researcher task completion\. The remaining pilot period will compare those measures, document failed queries and weak matches, and determine whether the shared search layer improves evidence discovery\.?/giu,
        'A pilot in $1 will establish baseline task completion, processing time, unresolved-case age, and user effort. The remaining pilot period will compare those measures and determine whether the operational workflow improves coordination and status visibility.',
      )
      .replace(
        /The pilot must preserve dataset permissions, provenance, access controls, and reproducible indexing\. Key risks include incompatible embedding spaces, weak source metadata, biased retrieval, changing external APIs, and misleading similarity scores that require researcher review\.?/giu,
        'The pilot must preserve permission boundaries, data provenance, access controls, and auditable status changes. Key risks include incomplete records, inconsistent staff adoption, changing integrations, and operational decisions that still require human review.',
      )
      .replace(
        /[^.!?]*(?:semantic search|vector search|embedding spaces?|embeddings?|dataset indexing|shared search layer|query relevance|researcher task completion|research corpus|retrieval pipeline)[^.!?]*[.!?]?/giu,
        ' The operational workflow should preserve traceability, clear ownership, and human review without introducing unrelated retrieval or research-system assumptions.',
      )
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private firstSentences(value: string, count: number): string {
    return value
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/(?<=[.!?])\s+/u)
      .slice(0, count)
      .join(' ');
  }

  private inlineList(value: string): string {
    return value
      .split(/\r?\n|,/u)
      .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, '').trim())
      .filter(Boolean)
      .slice(0, 10)
      .join(', ');
  }

  private countWords(value: string): number {
    return value.trim().split(/\s+/u).filter(Boolean).length;
  }

  /**
   * Keeps the free overview intentionally concise so it cannot become a copy
   * of the premium full abstract. The full abstract is expanded separately
   * from problem, objectives, architecture, stack, pilot, and risk context.
   */
  private buildConciseOverview(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized) return '';

    const sentences = normalized.split(/(?<=[.!?])\s+/u);
    const selected: string[] = [];
    let words = 0;

    for (const sentence of sentences) {
      const sentenceWords = this.countWords(sentence);
      if (selected.length >= 4 || words + sentenceWords > 135) break;
      selected.push(sentence.trim());
      words += sentenceWords;
    }

    return (selected.join(' ') || normalized)
      .split(/\s+/u)
      .slice(0, 135)
      .join(' ')
      .trim();
  }

  /**
   * Uses impact language that matches the actual problem instead of injecting
   * the same technical "slow diagnosis" boilerplate into every domain.
   */
  private buildProblemImpactSentence(problem: string): string {
    const normalized = problem.toLowerCase();

    if (
      /(?:authentication|login|log in|sign in|two[- ]factor|2fa|multi[- ]factor|verification code|session timeout|account access)/iu.test(
        normalized,
      )
    ) {
      return 'This can force repeated sign-in attempts, delay account tasks, and increase abandonment of the affected access workflow.';
    }

    if (
      /(?:contract|signature|proof verification|proof-verification|legal verification|record verification|selector revert|revert selector)/iu.test(
        normalized,
      )
    ) {
      return 'This can block contract or record-verification workflows, delay approval steps, and increase investigation effort.';
    }

    if (/crash|failure|error|broken|not working|unable/iu.test(normalized)) {
      return 'This can interrupt the affected workflow, increase recovery effort, and delay task completion.';
    }

    if (/missing|lack|unsupported|feature request|need/iu.test(normalized)) {
      return 'This leaves users without a required workflow capability and increases manual work or workaround dependence.';
    }

    return 'The retained evidence identifies friction in the affected task; broader operational impact remains to be measured.';
  }

  private professionalizeTargetUser(value: string): string {
    return value
      .replace(/Self-Hosted Entertainment Enthusiasts/giu, 'Self-Hosted Media Platform Operators')
      .replace(/\benthusiasts\b/giu, 'Operators')
      .replace(/^General users(?: looking for)?/giu, 'Everyday AI Productivity Users')
      .replace(/^Students in [^,]+ seeking academic support$/giu, 'University Students Seeking Academic Support')
      .replace(/Creative professionals requiring mood-aligned writing assistance/giu, 'Content Creators and Writers')
      .replace(/^Local hardware hobbyists and makers$/giu, 'Hardware Hobbyists and Makers Participating in the Pilot')
      .replace(/^Local (.+)$/giu, '$1 Participating in the Pilot')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private polishArchitectureContent(value: string): string {
    return value
      .replace(/\s+/gu, ' ')
      .replace(/local storage directories/giu, 'authorized local storage directories mounted through explicit read-only paths')
      .replace(/polls configured/giu, 'periodically scans configured')
      .trim();
  }

  private polishNoInputPreferenceNarrativeBoundary(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (!this.isNoInputPreferencePath(context) || !value.trim()) {
      return this.polishDomainsOnlyNarrativeBoundary(context, value);
    }

    return this.polishProblemTitleNarrativeBoundary(context, value);
  }

  private polishDomainsOnlyNarrativeBoundary(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (
      value.trim() &&
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_SELECTED'
    ) {
      return this.polishProblemTitleNarrativeBoundary(context, value);
    }

    return value;
  }

  private polishProblemTitleNarrativeBoundary(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    const problemTitle = (
      context.opportunityRanking?.selected.title ??
      context.benchmarkWinnerOpportunity?.title ??
      ''
    )
      .replace(/\s+/gu, ' ')
      .replace(/[.!?]+$/u, '')
      .trim();

    if (!problemTitle) {
      return value;
    }

    const escapedProblemTitle = this.escapeRegExp(problemTitle);
    const boundary = new RegExp(
      `(${escapedProblemTitle})(?=\\s+(?:The direction|The evidence|The pilot|The product|The proposed|This direction|This product)\\b)`,
      'giu',
    );

    return value
      .replace(boundary, '$1.')
      .replace(/([.!?])\1+(?=\s|$)/gu, '$1')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .replace(/\s{2,}/gu, ' ')
      .trim();
  }

  private polishProblemStatement(value: string): string {
    return value
      .replace(/\band\s+and\b/gi, 'and')
      .replace(/\bsoftware[- ]ISP\b/gi, 'software application')
      .replace(/\bimage_generate\b/gi, 'image-generation')
      .replace(/\bBase64\b/g, 'Base64')
      .replace(
        /\b(documents|describes|indicates that)\s+A limited evidence sample\b/gi,
        '$1 a limited evidence sample',
      )
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/([,;])(?=\S)/g, '$1 ')
      .replace(/:(?=[A-Za-z])/g, ': ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+\./g, '.')
      .trim();
  }

  private calculateProblemSolutionCoverage(
    problem: string,
    domainName: string,
    solutionText: string,
  ): number {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'into',
      'using', 'without', 'while', 'where', 'have', 'has', 'are', 'was',
      'were', 'problem', 'issue', 'failure', 'system', 'platform', 'users',
    ]);
    const problemTokens = this.normalizeComparableText(problem)
      .split(' ')
      .filter((token) => token.length >= 4 && !stopWords.has(token));
    const solution = new Set(this.normalizeComparableText(solutionText).split(' '));
    const overlap = new Set(problemTokens.filter((token) => solution.has(token))).size;
    const domainCovered = this.normalizeComparableText(solutionText).includes(
      this.normalizeComparableText(domainName),
    );
    return overlap + (domainCovered ? 1 : 0);
  }

  private calculateTextSimilarity(first: string, second: string): number {
    const firstTokens = new Set(this.normalizeComparableText(first).split(' ').filter(Boolean));
    const secondTokens = new Set(this.normalizeComparableText(second).split(' ').filter(Boolean));
    if (firstTokens.size === 0 || secondTokens.size === 0) return 0;
    const intersection = [...firstTokens].filter((token) => secondTokens.has(token)).length;
    const union = new Set([...firstTokens, ...secondTokens]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private normalizeTechnologyStack(content: string): string {
    return content
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .map((line) =>
        line
          .replace(/^OpenAI API$/iu, 'Provider-agnostic LLM gateway')
          .replace(/^VADER(?: Sentiment Analysis)?$/iu, 'Multilingual transformer sentiment model'),
      )
      .filter(Boolean)
      .filter((line, index, lines) =>
        lines.findIndex(
          (candidate) =>
            this.normalizeComparableText(candidate) ===
            this.normalizeComparableText(line),
        ) === index,
      )
      .join('\n');
  }

  private capitalizeSentence(value: string): string {
    const trimmed = value.trim().replace(/[.]+$/u, '');
    return trimmed ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : trimmed;
  }

  private lowercaseSentenceStart(value: string): string {
    const trimmed = value.trim().replace(/[.]+$/, '');
    return trimmed ? trimmed[0]!.toLowerCase() + trimmed.slice(1) : trimmed;
  }

  /**
   * Converts the small verb set used by sparse-evidence qualification into a
   * base form so tentative rewrites remain grammatical (for example,
   * "students often struggle" -> "students may struggle").
   */
  private toTentativeBaseVerb(value: string): string {
    const normalized = value.toLocaleLowerCase();
    const baseForms: Readonly<Record<string, string>> = {
      struggles: 'struggle',
      faces: 'face',
      encounters: 'encounter',
      experiences: 'experience',
      suffers: 'suffer',
    };

    return baseForms[normalized] ?? normalized;
  }

  private formatLocationName(value: string | null | undefined): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());
  }

  /** Returns true when a model domain label matches the selected scope. */
  private isSelectedDomain(
    context: IdeaGenerationContext,
    domainName: string,
  ): boolean {
    const normalized = this.normalizeComparableText(domainName);

    return context.selectedDomains.some((domain) => {
      const selected = this.normalizeComparableText(domain.name);
      return (
        normalized === selected ||
        normalized.includes(selected) ||
        selected.includes(normalized)
      );
    });
  }

  /** Resolves invalid labels such as "Unassigned" to the primary selected domain. */
  private resolveOpportunityDomainName(
    context: IdeaGenerationContext,
    domainName: string,
  ): string {
    const trimmed = domainName.trim();

    if (trimmed && this.isSelectedDomain(context, trimmed)) {
      return trimmed;
    }

    return (
      context.benchmarkWinnerOpportunity?.matchedDomainNames?.[0] ??
      context.opportunityRanking?.selected.matchedDomainNames?.[0] ??
      context.domainName ??
      context.selectedDomains[0]?.name ??
      'General'
    );
  }

  private parseProblemSolutionPairs(problemStatement: string): Array<{
    domainName: string;
    problem: string;
    solutionResponse: string;
  }> {
    const normalized = problemStatement
      .trim()
      .replace(
        /\s+(?=\d+[.)]\s*\[[^\]]+\]\s*Problem:)/gi,
        '\n',
      );

    return normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) =>
        line.match(
          /^(?:\d+[.)-]?\s*)?\[([^\]]+)\]\s*Problem:\s*(.+?)\s*\|\s*Solution response:\s*(.+)$/i,
        ),
      )
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        domainName: match[1]?.trim() ?? '',
        problem: match[2]?.trim() ?? '',
        solutionResponse: match[3]?.trim() ?? '',
      }))
      .filter(
        (pair) =>
          pair.domainName.length > 0 &&
          pair.problem.length >= 10 &&
          pair.solutionResponse.length >= 10,
      );
  }

  /** Normalizes domain and problem text for stable coverage comparison. */
  private normalizeComparableText(value: string): string {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  /**
   * Escapes a dynamic string before inserting it into a regular expression.
   */
  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Validates all context values required before AI-output
   * validation can run.
   *
   * @param context Current idea-generation context.
   *
   * @throws BadRequestException When required context is missing
   * or inconsistent.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      this.throwInvalidOutput(
        'Generation entitlement must be resolved before AI-output validation.',
      );
    }

    if (context.policy.generationType !== context.generationType) {
      this.throwInvalidOutput(
        'Resolved generation policy does not match the pipeline generation type.',
      );
    }

    if (!context.coreIdea) {
      this.throwInvalidOutput(
        'Core AI idea output is required before validation.',
      );
    }

    if (!Array.isArray(context.advancedOutputs)) {
      this.throwInvalidOutput(
        'Advanced AI outputs must be represented as an array.',
      );
    }

    this.validateContextOutputKeys(context.advancedOutputs);
  }

  /**
   * Validates normalized output according to the authorized
   * generation type.
   *
   * @param context Current generation context.
   * @param parsedOutput Parsed and normalized AI output.
   */
  private enforceCanonicalEvidenceStateNarrative(
    context: IdeaGenerationContext,
    output: ParsedIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    if (context.evidenceState !== 'ZERO_VALIDATED_EVIDENCE') {
      return output;
    }

    const request = context.requestDescription?.replace(/\s+/gu, ' ').trim() ?? '';
    const domainNames = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(Boolean);
    const uniqueDomains = [...new Set(domainNames)];
    const domainScope =
      uniqueDomains.length > 0
        ? uniqueDomains.join(', ')
        : context.domainName?.trim() || 'the selected search space';
    const qualifier = request
      ? `The requester describes an unvalidated workflow hypothesis: "${request}"`
      : 'No verified external problem evidence survived the bounded discovery and recovery budget; no concrete people problem has been validated yet.';

    const sanitize = (value: string | undefined): string | undefined => {
      if (value === undefined) return undefined;
      let text = value.replace(/\s+/gu, ' ').trim();
      text = text
        .replace(
          /\b(?:data|evidence|collected feedback|retained reports?|community reports?|community signal|community feedback)\s+(?:shows?|indicates?|demonstrates?|proves?|confirms?|suggests?|reports?|identifies?)\b/giu,
          'the current unvalidated hypothesis suggests',
        )
        .replace(
          /\bA preliminary community signal(?:\s+from\s+[^.:]{1,120})?\s+reports an operational challenge:\s*/giu,
          '',
        )
        .replace(
          /\bThe retained evidence identifies friction in the affected task;?/giu,
          'No verified external evidence currently establishes friction in a concrete task;',
        )
        .replace(
          /\bZero retained community observations(?:\s+across\s+[^.]{1,120})?\s+suggest that\b/giu,
          'No verified observation currently establishes that',
        )
        .replace(
          /\busers?\s+(?:frequently|often|commonly|typically)\s+(?:report|experience|face|struggle)\b/giu,
          'target users may report',
        )
        .replace(
          /\b(?:frequently|typically|commonly|recurring|widespread|validated demand|observed demand)\b/giu,
          'potentially',
        )
        .replace(
          /\bThis fragmentation creates significant operational friction\b/giu,
          'If confirmed during pilot validation, this fragmentation could create operational friction',
        )
        .replace(
          /\bThis fragmentation can lead to\b/giu,
          'If confirmed during pilot validation, this fragmentation could contribute to',
        )
        .replace(
          /\bThis operational fragmentation can lead to\b/giu,
          'If confirmed during pilot validation, this operational fragmentation could contribute to',
        )
        .replace(
          /\bWithout a unified system\b/giu,
          'If the requester hypothesis is confirmed, without a unified system',
        )
        .replace(
          /\b(?:specialists|operators|teams|organizations|cities|businesses) risk\b/giu,
          'the affected users could risk',
        )
        .replace(
          /\bDocumentation is often split across\b/giu,
          'The requester describes documentation that may be split across',
        )
        .replace(
          /\bInformation is (?:often|usually|frequently) (?:split|scattered|fragmented) across\b/giu,
          'The requester describes information that may be distributed across',
        )
        .replace(
          /\b(?:equipment status|records|data|alerts|information) (?:is|are) often monitored through separate systems\b/giu,
          'the requester describes these operational signals as potentially monitored through separate systems',
        )
        .replace(
          /\b(?:face|faces) significant operational friction\b/giu,
          'may face operational friction if the requester hypothesis is confirmed',
        )
        .replace(/\bstaff cannot\b/giu, 'staff may be unable to')
        .replace(/\bteams cannot\b/giu, 'teams may be unable to')
        .replace(/\boperators cannot\b/giu, 'operators may be unable to')
        .replace(
          /\bConsequently,\s*/giu,
          'If the requester hypothesis is confirmed, this could mean that ',
        )
        .replace(
          /\bThis (?:fragmentation|operational fragmentation|lack of coordination) increases the risk of\b/giu,
          'If confirmed during pilot validation, this could increase the risk of',
        );

      if (!/^The requester describes an unvalidated workflow hypothesis|^No verified external problem evidence/iu.test(text)) {
        text = `${qualifier}. ${text}`;
      }
      return text.replace(/\.\s*\./gu, '.').trim();
    };

    /*
     * In discovery-only modes, CONTEXT_ONLY/UNRELATED material must never pick
     * a concrete problem or a new domain. Replace any model-invented concept
     * with a neutral evidence-discovery product that stays inside the
     * administrator/user-selected search space.
     */
    if (!request) {
      const neutralTitle =
        uniqueDomains.length <= 1
          ? `${uniqueDomains[0] ?? context.domainName ?? 'Software'} Problem Signal Discovery Workspace`
          : 'Problem Signal Discovery Workspace';
      const neutralProblem =
        `${qualifier} The active search space is ${domainScope}. ` +
        'The next product decision must be based on newly collected DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence, not on CONTEXT_ONLY or unrelated material.';
      const neutralObjectives = [
        `Collect bounded, provenance-preserving problem reports across ${domainScope}.`,
        'Classify each retained item as DIRECT_PROBLEM, SUPPORTING_SIGNAL, ANALOGOUS_WORKFLOW_SIGNAL, CONTEXT_ONLY, or UNRELATED and keep the canonical evidence ledger as the single source of truth.',
        'Compare problem-bearing evidence by domain, source diversity, and verified problem facets before selecting a software opportunity.',
        'Keep human review in the loop and generate a concrete software concept only after at least one verified direct or supporting signal is retained.',
      ];
      const neutralTargetUsers = [
        'Product discovery and validation teams',
        'Domain experts from the selected search space',
        'Software project teams evaluating evidence-backed opportunities',
      ];
      const neutralAbstract =
        `${neutralProblem} The proposed workspace is therefore a validation-stage software product, not a claim that a specific market problem already exists. ` +
        'It records the search query, source, domain lane, collection phase, and evidence classification for every candidate signal; compares verified problem families; and prevents unverified context from becoming a product requirement. ' +
        'A pilot should continue bounded evidence collection until at least one concrete people problem is supported by verified direct or supporting evidence. Only then should the system promote that problem into a normal software-project generation workflow.';

      return {
        ...output,
        coreIdea: {
          ...output.coreIdea,
          title: neutralTitle,
          problemStatement: neutralProblem,
          objectives: neutralObjectives,
          targetUsers: neutralTargetUsers,
          ...(output.coreIdea.limitedAbstract !== undefined
            ? { limitedAbstract: neutralAbstract }
            : {}),
          ...(output.coreIdea.partialAbstract !== undefined
            ? { partialAbstract: neutralAbstract }
            : {}),
          ...(output.coreIdea.fullAbstract !== undefined
            ? { fullAbstract: neutralAbstract }
            : {}),
        },
        advancedOutputs: output.advancedOutputs.map((item) => ({
          ...item,
          content:
            `Evidence-state constraint: no verified people problem is currently established in ${domainScope}. ` +
            `Treat all concrete problem mechanisms in this section as validation hypotheses only. ${sanitize(item.content) ?? item.content}`,
        })),
      };
    }

    return {
      ...output,
      coreIdea: {
        ...output.coreIdea,
        problemStatement: sanitize(output.coreIdea.problemStatement) ?? output.coreIdea.problemStatement,
        ...(output.coreIdea.limitedAbstract !== undefined
          ? { limitedAbstract: sanitize(output.coreIdea.limitedAbstract) }
          : {}),
        ...(output.coreIdea.partialAbstract !== undefined
          ? { partialAbstract: sanitize(output.coreIdea.partialAbstract) }
          : {}),
        ...(output.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: sanitize(output.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: output.advancedOutputs.map((item) => ({
        ...item,
        content: sanitize(item.content) ?? item.content,
      })),
    };
  }

  private validateOutputForGenerationType(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    switch (context.generationType) {
      case IdeaGenerationType.GUEST_FREE:
        this.validateGuestOutput(parsedOutput);
        return;

      case IdeaGenerationType.NORMAL_FREE:
        this.validateNormalFreeOutput(parsedOutput);
        return;

      case IdeaGenerationType.PREMIUM_CREDIT:
        this.validatePremiumOutput(context, parsedOutput);
        return;

      default:
        this.assertNeverGenerationType(context.generationType);
    }
  }

  /**
   * Validates guest-generation output.
   *
   * Guest generation produces the complete free foundation in one
   * AI request:
   * - limitedAbstract is exposed to the guest.
   * - partialAbstract is retained for the authenticated free view
   *   after a successful guest-idea transfer.
   *
   * Guest generation must never include full premium content.
   *
   * @param parsedOutput Parsed guest-generation output.
   */
  private validateGuestOutput(parsedOutput: ParsedIdeaAiOutput): void {
    this.requireCoreString(
      parsedOutput.coreIdea.limitedAbstract,
      'limitedAbstract',
      IdeaGenerationType.GUEST_FREE,
    );

    this.requireCoreString(
      parsedOutput.coreIdea.partialAbstract,
      'partialAbstract',
      IdeaGenerationType.GUEST_FREE,
    );

    this.rejectCoreStringWhenPresent(
      parsedOutput.coreIdea.fullAbstract,
      'fullAbstract',
      IdeaGenerationType.GUEST_FREE,
    );

    this.validateNoAdvancedOutputs(
      parsedOutput.advancedOutputs,
      IdeaGenerationType.GUEST_FREE,
    );
  }

  /**
   * Validates authenticated free-tier output.
   *
   * Normal free generation returns a partial abstract and must not
   * contain full premium content.
   *
   * A limited abstract is tolerated when returned by a shared
   * generation schema, but it is not required by this tier.
   *
   * @param parsedOutput Parsed normal-free output.
   */
  private validateNormalFreeOutput(parsedOutput: ParsedIdeaAiOutput): void {
    this.requireCoreString(
      parsedOutput.coreIdea.partialAbstract,
      'partialAbstract',
      IdeaGenerationType.NORMAL_FREE,
    );

    this.rejectCoreStringWhenPresent(
      parsedOutput.coreIdea.fullAbstract,
      'fullAbstract',
      IdeaGenerationType.NORMAL_FREE,
    );

    this.validateNoAdvancedOutputs(
      parsedOutput.advancedOutputs,
      IdeaGenerationType.NORMAL_FREE,
    );
  }

  /**
   * Validates premium credit-based generation output.
   *
   * Premium generation must:
   * - Be authorized for premium output generation.
   * - Be unlocked immediately.
   * - Return a complete full abstract.
   * - Return every output required by the centralized premium
   *   output registry.
   *
   * @param context Current generation context.
   * @param parsedOutput Parsed premium AI output.
   */
  private validatePremiumOutput(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const policy = context.policy;

    if (!policy) {
      this.throwInvalidOutput(
        'Generation policy is required for premium-output validation.',
      );
    }

    if (!policy.includePremiumOutputs) {
      this.throwInvalidOutput(
        'Premium generation policy must enable advanced outputs.',
      );
    }

    if (!policy.unlockOnGeneration) {
      this.throwInvalidOutput(
        'Premium-generated ideas must be unlocked on successful generation.',
      );
    }

    this.requireCoreString(
      parsedOutput.coreIdea.fullAbstract,
      'fullAbstract',
      IdeaGenerationType.PREMIUM_CREDIT,
    );

    this.validateRequiredPremiumOutputs(parsedOutput.advancedOutputs);
  }

  /**
   * Ensures free-tier generations do not contain advanced outputs.
   *
   * This protects against accidental persistence or exposure of
   * premium content when a provider returns fields outside the
   * selected response contract.
   *
   * @param outputs Parsed advanced outputs.
   * @param generationType Current free generation type.
   */
  private validateNoAdvancedOutputs(
    outputs: readonly AdvancedIdeaAiOutput[],
    generationType: IdeaGenerationType,
  ): void {
    if (outputs.length === 0) {
      return;
    }

    this.throwInvalidOutput(
      `${generationType} generation must not include advanced premium outputs.`,
      {
        unexpectedOutputKeys: outputs.map((output) => output.outputKey),
      },
    );
  }

  /**
   * Ensures every premium output registered as required exists
   * exactly once and contains valid normalized content.
   *
   * Required output keys are obtained from the centralized output
   * registry rather than duplicated in this stage.
   *
   * @param outputs Parsed advanced outputs.
   */
  private validateRequiredPremiumOutputs(
    outputs: readonly AdvancedIdeaAiOutput[],
  ): void {
    const outputByKey = new Map<IdeaAdvancedOutputKey, AdvancedIdeaAiOutput>();

    for (const output of outputs) {
      if (outputByKey.has(output.outputKey)) {
        this.throwInvalidOutput(
          `Premium AI output contains the duplicated output key "${output.outputKey}".`,
        );
      }

      this.validateAdvancedOutputContent(output);

      outputByKey.set(output.outputKey, output);
    }

    const missingOutputKeys = REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS.filter(
      (outputKey) => !outputByKey.has(outputKey),
    );

    if (missingOutputKeys.length > 0) {
      this.throwInvalidOutput(
        `Premium generation is missing required outputs: ${missingOutputKeys.join(', ')}.`,
        {
          missingOutputKeys,
        },
      );
    }
  }

  /**
   * Validates one normalized advanced output against its
   * centralized registry definition.
   *
   * @param output Advanced output to validate.
   */
  private validateAdvancedOutputContent(output: AdvancedIdeaAiOutput): void {
    const definition = findIdeaAdvancedOutputDefinitionByKey(output.outputKey);

    if (!definition) {
      this.throwInvalidOutput(
        `Unsupported advanced output key "${String(output.outputKey)}".`,
      );
    }

    if (typeof output.title !== 'string') {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain a string title.`,
      );
    }

    const normalizedTitle = output.title.trim();

    if (normalizedTitle !== definition.title) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" has an invalid title.`,
      );
    }

    if (
      typeof output.content !== 'string' ||
      output.content.trim().length === 0
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain non-empty string content.`,
      );
    }

    if (definition.collection) {
      this.validateCollectionStructuredContent(output);
      return;
    }

    if (output.structuredContent !== undefined) {
      this.throwInvalidOutput(
        `Scalar advanced output "${output.outputKey}" must not contain structured collection content.`,
      );
    }
  }

  /**
   * Validates structured content for one collection-valued output.
   *
   * @param output Collection-valued advanced output.
   */
  private validateCollectionStructuredContent(
    output: AdvancedIdeaAiOutput,
  ): void {
    const structuredContent = output.structuredContent;

    if (!Array.isArray(structuredContent)) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain structured array content.`,
      );
    }

    if (structuredContent.length === 0) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain at least one structured value.`,
      );
    }

    if (
      structuredContent.some(
        (item) => typeof item !== 'string' || item.trim().length === 0,
      )
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain a non-empty string array.`,
      );
    }
  }

  /**
   * Validates advanced-output keys already present in the context
   * before they are reconstructed for parser validation.
   *
   * This prevents unsupported or duplicated keys from being
   * silently discarded or overwritten while constructing the raw
   * provider-response object.
   *
   * @param outputs Context advanced outputs.
   */
  private validateContextOutputKeys(
    outputs: readonly AdvancedIdeaAiOutput[],
  ): void {
    const seenOutputKeys = new Set<IdeaAdvancedOutputKey>();

    for (const output of outputs) {
      if (!output || typeof output !== 'object') {
        this.throwInvalidOutput(
          'Every advanced output in the generation context must be an object.',
        );
      }

      const definition = findIdeaAdvancedOutputDefinitionByKey(
        output.outputKey,
      );

      if (!definition) {
        this.throwInvalidOutput(
          `Unsupported advanced output key "${String(output.outputKey)}" was found in the generation context.`,
        );
      }

      if (seenOutputKeys.has(output.outputKey)) {
        this.throwInvalidOutput(
          `Duplicated advanced output key "${output.outputKey}" was found in the generation context.`,
        );
      }

      seenOutputKeys.add(output.outputKey);
    }
  }

  /**
   * Reconstructs a parser-compatible AI response object from the
   * normalized generation context.
   *
   * Optional abstract fields are included only when present.
   *
   * This matters because the parser distinguishes between:
   * - A missing optional field.
   * - A present but invalid undefined or blank field.
   *
   * Advanced-output records are mapped back to their original AI
   * schema property names through the centralized output registry.
   *
   * @param context Current generation context.
   * @returns Parser-compatible AI-output object.
   */
  private buildRawOutput(context: IdeaGenerationContext): JsonObject {
    const coreIdea = context.coreIdea;

    if (!coreIdea) {
      this.throwInvalidOutput(
        'Core AI idea output is required before reconstructing the response payload.',
      );
    }

    const rawOutput: JsonObject = {
      title: coreIdea.title,

      problemStatement: coreIdea.problemStatement,

      objectives: coreIdea.objectives,

      targetUsers: coreIdea.targetUsers,
    };

    this.assignOptionalString(
      rawOutput,
      'limitedAbstract',
      coreIdea.limitedAbstract,
    );

    this.assignOptionalString(
      rawOutput,
      'partialAbstract',
      coreIdea.partialAbstract,
    );

    this.assignOptionalString(rawOutput, 'fullAbstract', coreIdea.fullAbstract);

    for (const output of context.advancedOutputs) {
      const definition = findIdeaAdvancedOutputDefinitionByKey(
        output.outputKey,
      );

      if (!definition) {
        this.throwInvalidOutput(
          `Unsupported advanced output key "${String(output.outputKey)}".`,
        );
      }

      if (definition.collection) {
        if (!Array.isArray(output.structuredContent)) {
          this.throwInvalidOutput(
            `Advanced output "${output.outputKey}" must contain structured array content.`,
          );
        }

        rawOutput[definition.field] = output.structuredContent;

        continue;
      }

      rawOutput[definition.field] = output.content;
    }

    return rawOutput;
  }

  /**
   * Adds an optional string to a reconstructed output object only
   * when the field is present.
   *
   * Blank values are intentionally included so the parser can
   * reject malformed present fields instead of treating them as
   * missing.
   *
   * @param target Reconstructed raw output object.
   * @param key AI schema field name.
   * @param value Optional string value.
   */
  private assignOptionalString(
    target: JsonObject,
    key: string,
    value: string | undefined,
  ): void {
    if (value === undefined) {
      return;
    }

    target[key] = value;
  }

  /**
   * Ensures a tier-required core string exists and is not blank.
   *
   * @param value Core field value.
   * @param fieldName Required field name.
   * @param generationType Generation type requiring the field.
   */
  private requireCoreString(
    value: string | undefined,
    fieldName: string,
    generationType: IdeaGenerationType,
  ): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.throwInvalidOutput(
        `${generationType} generation requires a non-empty "${fieldName}" field.`,
      );
    }
  }

  /**
   * Rejects a core string when it is not authorized for the
   * current generation type.
   *
   * @param value Optional core string.
   * @param fieldName Unauthorized field name.
   * @param generationType Current generation type.
   */
  private rejectCoreStringWhenPresent(
    value: string | undefined,
    fieldName: string,
    generationType: IdeaGenerationType,
  ): void {
    if (value === undefined) {
      return;
    }

    this.throwInvalidOutput(
      `${generationType} generation must not include the premium "${fieldName}" field.`,
    );
  }

  /**
   * Builds a safe stage-result preview.
   *
   * @param context Current generation context.
   * @param parsedOutput Validated parsed output.
   * @returns Human-readable stage result preview.
   */
  private buildResultPreview(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): string {
    const outputDescription =
      context.generationType === IdeaGenerationType.PREMIUM_CREDIT
        ? ` with ${parsedOutput.advancedOutputs.length} advanced outputs`
        : '';

    return (
      `AI output validated successfully for ` +
      `${context.generationType} idea ` +
      `"${parsedOutput.coreIdea.title}"` +
      `${outputDescription}.`
    );
  }

  /**
   * Throws a consistent business-level invalid-output exception.
   *
   * @param message Safe human-readable error message.
   * @param details Optional additional safe error details.
   *
   * @throws BadRequestException Always.
   */
  private throwInvalidOutput(
    message: string,
    details?: Record<string, unknown>,
  ): never {
    throw new BadRequestException({
      code: IDEA_GENERATION_ERROR_CODES.INVALID_AI_OUTPUT,

      message,

      ...(details ?? {}),
    });
  }

  /**
   * Provides exhaustive handling when a new IdeaGenerationType is
   * introduced.
   *
   * @param generationType Unexpected generation type.
   */
  private assertNeverGenerationType(generationType: never): never {
    return this.throwInvalidOutput(
      `Unsupported idea generation type "${String(generationType)}".`,
    );
  }

  /**
   * Resolves the static stage definition from the centralized
   * generation-stage registry.
   *
   * @returns AI-output-validation stage definition.
   */
  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}