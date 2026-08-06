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

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

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
    const normalizedNarrative = this.normalizeUnifiedIdeaNarrative(
      context,
      parsedOutput,
    );

    /*
     * Providers occasionally return optional premium fields even when the
     * active entitlement is free. This is a schema-adherence defect, not a
     * reason to discard an otherwise valid idea. Apply a deterministic tier
     * projection before strict validation so unauthorized fields are removed
     * rather than leaked or allowed to fail the complete generation run.
     */
    const normalizedOutput = this.sanitizeOutputForContext(
      context,
      this.projectOutputToGenerationTier(context, normalizedNarrative),
    );

    this.validateOutputForGenerationType(context, normalizedOutput);
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

    const sanitizeText = (value: string): string => {
      let sanitized = value
        .replace(/\bNext\s*\.\s*js\b/giu, 'Next.js')
        .replace(/\bNest\s*\.\s*js\b/giu, 'NestJS')
        .replace(/\bNode\s*\.\s*js\b/giu, 'Node.js')
        .replace(/\bReact\s*\.\s*js\b/giu, 'React')
        .replace(/\s+([,.;:!?])/gu, '$1')
        .replace(/[ \t]{2,}/gu, ' ')
        .replace(
          /\b(?:one retained community report|a retained community report) indicates that collected feedback(?: from [^.!?]{0,120})? indicates that\s*/giu,
          'One retained community report indicates that ',
        )
        .replace(/\bindicates that\s+indicates that\b/giu, 'indicates that')
        .trim();

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

      return sanitized;
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

    return {
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: sanitizeText(parsedOutput.coreIdea.title),
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

    const winner = this.resolveWinnerOpportunityRaw(context);
    const winnerDomain = winner?.domainName;
    const supportedDomains = winnerDomain ? [winnerDomain] : [];
    const normalizedStatement = this.normalizeComparableText(statement);
    const representedDomains = supportedDomains.filter((domain) =>
      normalizedStatement.includes(this.normalizeComparableText(domain)),
    );

    if (supportedDomains.length > 1 && representedDomains.length < 2) {
      this.throwInvalidOutput(
        'A cross-domain idea must integrate at least two evidence-supported domains in the unified problem narrative.',
        { supportedDomains, representedDomains },
      );
    }

    if (parsedOutput.coreIdea.objectives.length < 3) {
      this.throwInvalidOutput('At least three concrete objectives are required.');
    }
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
    const opportunityProblems = winner
      ? [
          {
            domainName: this.resolveOpportunityDomainName(
              context,
              winner.domainName,
            ),
            problem: winner.problem.trim(),
          },
        ]
      : [];

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
      winnerProblem &&
      !this.isGenericFallbackProblem(winnerProblem) &&
      !this.isFragmentLikeEvidenceProblem(winnerProblem)
        ? winnerProblem
        : providerProblemStatement || winnerProblem;

    let problemStatement = this.polishProblemStatement(preferredProblem);

    if (grounded.length > 0) {
      const domains = [...new Set(grounded.map((item) => item.domainName))];
      const cleanedProblems = grounded.map((item) =>
        this.removeRepeatedDomainPrefix(item.problem, item.domainName),
      );

      if (cleanedProblems.length === 1) {
        const domain =
          domains[0] ?? context.domainName ?? 'the selected domain';
        const groundedProblem = cleanedProblems[0] ?? '';
        const selectedProblem =
          this.isSpecificProblemStatement(providerProblemStatement) &&
          (!this.isSpecificProblemStatement(groundedProblem) ||
            this.isFragmentLikeEvidenceProblem(groundedProblem))
            ? providerProblemStatement
            : groundedProblem;
        const problem = this.capitalizeSentence(selectedProblem);

        problemStatement = this.polishProblemStatement(
          this.hasStrongIndependentEvidence(context)
            ? `Verified community evidence from ${domain} identifies a recurring operational challenge: ${problem}. ${this.buildProblemImpactSentence(cleanedProblems[0] ?? '')}`
            : `A preliminary community signal from ${domain} reports an operational challenge: ${problem}. ${this.buildProblemImpactSentence(cleanedProblems[0] ?? '')} The proposed pilot should validate how broadly this issue occurs before wider deployment.`,
        );
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

    if (!this.hasAnyRetainedDirectEvidence(context)) {
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
      const evidenceQualifiedContent = this.qualifyEvidenceClaims(
        context,
        output.content,
      );

      if (output.outputKey === 'technology-stack') {
        return {
          ...output,
          content: this.normalizeTechnologyStack(evidenceQualifiedContent),
        };
      }

      if (output.outputKey === 'system-architecture') {
        return {
          ...output,
          content: this.polishArchitectureContent(evidenceQualifiedContent),
        };
      }

      return {
        ...output,
        content: evidenceQualifiedContent,
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
    overview = this.finalizePersistedNarrativeCopy(overview);
    problemStatement = this.finalizePersistedNarrativeCopy(problemStatement);
    fullAbstract = this.finalizePersistedNarrativeCopy(fullAbstract);

    return {
      ...parsedOutput,
      coreIdea: {
        ...parsedOutput.coreIdea,
        title: parsedOutput.coreIdea.title
          .replace(/^(?:Nexora|Voxidence|Commivox)\s+/i, '')
          .trim(),
        problemStatement,
        objectives: this.sanitizePrimaryDomainObjectives(
          context,
          parsedOutput.coreIdea.objectives,
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

  /**
   * Final persisted-copy cleanup. This deliberately runs after all narrative
   * builders, sparse-evidence qualifiers, and abstract expansion.
   */
  private finalizePersistedNarrativeCopy(value: string): string {
    const cleaned = value
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
      .replace(/\bNext\s*\.\s*js\b/giu, 'Next.js')
      .replace(/\bNest\s*\.\s*js\b/giu, 'NestJS')
      .replace(/\bnablus\b/giu, 'Nablus')
      .replace(/\s{2,}/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();

    return this.removeRepeatedLeadingNarrative(cleaned);
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
  ): { domainName: string; problem: string } | null {
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

    const domainName =
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

    return { domainName, problem };
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
      /^A preliminary community signal from\s+(.+?)\s+reports an operational challenge:\s*(.+)$/iu,
    );

    if (communitySignal) {
      const domain = communitySignal[1]?.trim() || 'the selected domain';
      const problem = communitySignal[2]?.trim() || normalized;

      return `The proposed pilot responds to a limited community signal from the ${domain} domain: ${problem}`;
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

    return Boolean(
      selected?.selectionEligible &&
        (selected.verifiedIndependentEvidenceCount ?? 0) >= 3 &&
        (selected.verifiedIndependentSourceCount ?? 0) >= 2,
    );
  }

  private qualifyEvidenceClaims(
    context: IdeaGenerationContext,
    value: string,
  ): string {
    if (!this.hasAnyRetainedDirectEvidence(context)) {
      value = value
        .replace(/\bevidence-based\b/giu, 'evidence-collection and validation')
        .replace(
          /\ba preliminary community signal(?:\s+from\s+[^.]+)?\s+(?:reports|identifies|shows|indicates)\b/giu,
          'the unvalidated primary-domain hypothesis proposes',
        );
    }

    if (this.hasStrongIndependentEvidence(context)) {
      return value;
    }

    const directEvidenceCount =
      context.opportunityRanking?.selected.independentEvidence?.length ??
      context.opportunityRanking?.selected.evidenceSamples.length ??
      0;

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

    const hasZeroDirectEvidence =
      (context.opportunityRanking?.selected.verifiedIndependentEvidenceCount ??
        context.opportunityRanking?.selected.evidenceSamples.length ??
        0) === 0;

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

    if (hasZeroDirectEvidence) {
      const secondaryDomains = context.selectedDomains
        .slice(1)
        .map((domain) => domain.name.trim())
        .filter(Boolean);

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
      .replace(/\bfrequently (?:fail|fails|failed|encounter)\b/giu, 'may fail')
      .replace(/\busers? (?:often|commonly) (?:report|encounter|experience)\b/giu, 'one collected report describes')
      .replace(/\bIn many [^,.]{3,100} workflows,\s*/giu, 'In the collected report, ')
      .replace(
        /\bstandard ([^.]{2,100}?) models? fall short when users need\b/giu,
        'a referenced $1 model was described as insufficient when the user needed',
      )
      .replace(
        /\bpractitioners (?:often|commonly) (?:struggle|encounter|experience)\b/giu,
        'the collected report describes a practitioner who encountered',
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
    const selectedProblem =
      this.isSpecificProblemStatement(providerProblem) &&
      this.isFragmentLikeEvidenceProblem(winnerProblem)
        ? providerProblem
        : winnerProblem || providerProblem;
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
    const hasAnyDirectEvidence =
      (context.opportunityRanking?.selected.evidenceSamples.length ?? 0) > 0 ||
      (context.opportunityRanking?.selected
        .verifiedIndependentEvidenceCount ?? 0) > 0 ||
      context.domainEvidence.some((domain) => domain.evidenceAvailable);

    const evidenceSentence = hasAnyDirectEvidence
      ? this.buildSparseEvidenceSentence(normalizedProblem)
      : `This preliminary pilot does not claim that a specific community problem has already been validated. It tests whether ${this.lowercaseSentenceStart(
          normalizedProblem,
        )}.`;

    const productSentence =
      productSentences[0] ??
      `${title} provides a bounded pilot workflow that lets the target users test the proposed capabilities against their own authorized inputs and review the results before selecting an approach.`;

    const valueSentence =
      productSentences[1] ??
      'The pilot will measure whether this workflow reduces selection effort and improves output clarity without claiming that the need is widespread.';

    return this.buildConciseOverview(
      [evidenceSentence, productSentence, valueSentence].join(' '),
    );
  }

  /**
   * Produces a grammatical sentence for both noun-phrase problems and complete
   * verbal clauses. This avoids constructions such as:
   * "a case in which uncertainty regarding..."
   */
  private buildSparseEvidenceSentence(problem: string): string {
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
      /^(?:uncertainty|difficulty|friction|inability|failure|a lack|lack|missing|absence|limited access|insufficient|the need|a need|concern|confusion|authentication|configuration|redirect uri)/iu.test(
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

    if (nounPhraseStart) {
      return `One retained community report describes ${this.lowercaseSentenceStart(
        normalized,
      )}.`;
    }

    const firstPersonNeed = normalized.match(
      /^(?:the user|one user|a user)\s+(.+)$/iu,
    );
    if (firstPersonNeed?.[1]) {
      return `One retained community report describes a user who ${this.lowercaseSentenceStart(
        firstPersonNeed[1],
      )}.`;
    }

    return `One retained community report indicates that ${this.lowercaseSentenceStart(
      normalized,
    )}.`;
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

    const paragraphs = fullAbstract
      .split(/\n\s*\n/u)
      .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return fullAbstract;
    }

    const evidenceOpening =
      directEvidenceCount <= 0
        ? 'The proposed pilot currently has no retained direct community report and must be treated as an unvalidated primary-domain hypothesis.'
        : directEvidenceCount === 1
          ? 'The proposed pilot responds to one collected report rather than a validated market-wide pattern.'
          : `The proposed pilot responds to ${directEvidenceCount} collected reports rather than a validated market-wide pattern.`;

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
      );
      return [correctedFirstParagraph, ...paragraphs.slice(1)].join('\n\n');
    }

    return [evidenceQualifier, ...paragraphs].join('\n\n');
  }

  private countRetainedDirectEvidence(
    context: IdeaGenerationContext,
  ): number {
    const selected = context.opportunityRanking?.selected;

    // Narrative counts must describe evidence supporting the selected
    // opportunity, not every retained text from all selected domains.
    const verifiedCount = selected?.verifiedIndependentEvidenceCount;
    if (typeof verifiedCount === 'number' && verifiedCount > 0) {
      return Math.floor(verifiedCount);
    }

    if (Array.isArray(selected?.independentEvidence)) {
      const identities = new Set(
        selected.independentEvidence
          .map((item) =>
            typeof item?.identityKey === 'string'
              ? item.identityKey.trim().toLowerCase()
              : typeof item?.text === 'string'
                ? item.text.replace(/\s+/gu, ' ').trim().toLowerCase()
                : '',
          )
          .filter((item) => item.length >= 20),
      );
      if (identities.size > 0) return identities.size;
    }

    if (Array.isArray(selected?.evidenceSamples)) {
      const samples = new Set(
        selected.evidenceSamples
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.replace(/\s+/gu, ' ').trim().toLowerCase())
          .filter((item) => item.length >= 20),
      );
      if (samples.size > 0) return samples.size;
    }

    // Domain evidence is only a boolean last resort. It must never inflate the
    // report count shown in the persisted narrative.
    return (context.domainEvidence ?? []).some(
      (item) => item.evidenceAvailable && item.totalTextsAnalyzed > 0,
    )
      ? 1
      : 0;
  }

  private correctEvidenceQualifierCount(
    paragraph: string,
    directEvidenceCount: number,
  ): string {
    const opening =
      directEvidenceCount <= 0
        ? 'The proposed pilot currently has no retained direct community report and must be treated as an unvalidated primary-domain hypothesis.'
        : directEvidenceCount === 1
          ? 'The proposed pilot is supported by one retained direct community report and should be treated as a preliminary, not market-wide, signal.'
          : `The proposed pilot is supported by ${directEvidenceCount} retained direct community reports and should still avoid market-wide claims until broader validation.`;

    const remainder = paragraph
      .replace(
        /^(?:(?:The proposed pilot|The evidence limits market-wide claims)[^.]*\.\s*){1,2}/iu,
        '',
      )
      .replace(
        /^(?:one|a) (?:retained|collected) (?:community )?report (?:suggests|indicates|describes|reports)(?: that)?\s*/iu,
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

  private hasAnyRetainedDirectEvidence(
    context: IdeaGenerationContext,
  ): boolean {
    const selected = context.opportunityRanking?.selected;

    return (
      (selected?.verifiedIndependentEvidenceCount ?? 0) > 0 ||
      (selected?.independentEvidence?.length ?? 0) > 0 ||
      (selected?.evidenceSamples.length ?? 0) > 0 ||
      context.domainEvidence.some(
        (item) =>
          item.evidenceAvailable &&
          item.totalTextsAnalyzed > 0 &&
          ((Array.isArray(item.samplePosts) && item.samplePosts.length > 0) ||
            (Array.isArray(item.sampleComments) &&
              item.sampleComments.length > 0)),
      )
    );
  }

  /**
   * At zero retained evidence, the persisted statement must describe a testable
   * hypothesis—not a community signal that never existed.
   */
  private buildZeroEvidenceProblemStatement(
    context: IdeaGenerationContext,
  ): string {
    const domain =
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'the selected domain';
    const hypothesis =
      context.opportunityRanking?.selected.problem?.trim() ||
      `teams in ${domain} may lack a structured workflow for identifying and validating operational friction before implementation`;

    return this.polishProblemStatement(
      `No direct community signal was retained for ${domain} within the fast collection budget. The pilot tests the hypothesis that ${this.lowercaseSentenceStart(
        hypothesis,
      )}. This assumption must be validated with real ${domain} participants before any market-wide, recurring-demand, or impact claim is made.`,
    );
  }

  private sanitizePrimaryDomainObjectives(
    context: IdeaGenerationContext,
    objectives: readonly string[],
  ): string[] {
    if (this.hasAnyRetainedDirectEvidence(context)) {
      return [...objectives];
    }

    const primaryDomain =
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'the selected domain';
    const unsupportedNames = context.selectedDomains
      .slice(1)
      .map((domain) => domain.name.trim())
      .filter(Boolean);

    const sanitized = objectives
      .filter(
        (objective) =>
          !unsupportedNames.some((name) =>
            objective.toLowerCase().includes(name.toLowerCase()),
          ),
      )
      .map((objective) =>
        this.replaceUnsupportedDomainNames(
          objective,
          unsupportedNames,
          primaryDomain,
        ),
      );

    const defaults = [
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

  private sanitizePrimaryDomainTargetUsers(
    context: IdeaGenerationContext,
    targetUsers: readonly string[],
  ): string[] {
    const professionalized = targetUsers.map((user) =>
      this.professionalizeTargetUser(user),
    );

    if (this.hasAnyRetainedDirectEvidence(context)) {
      return professionalized;
    }

    const primaryDomain =
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      'the selected domain';
    const unsupportedNames = context.selectedDomains
      .slice(1)
      .map((domain) => domain.name.trim())
      .filter(Boolean);

    const retained = professionalized
      .filter(
        (user) =>
          !unsupportedNames.some((name) =>
            user.toLowerCase().includes(name.toLowerCase()),
          ),
      )
      .map((user) =>
        this.replaceUnsupportedDomainNames(
          user,
          unsupportedNames,
          primaryDomain,
        ),
      );

    const defaults = [
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

    const unsupportedDomains = new Set(
      context.domainEvidence
        .filter((evidence) => !evidence.evidenceAvailable)
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
    if (/search|knowledge graph|embedding|research/u.test(normalized)) {
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
    if (/search|knowledge graph|embedding|research/u.test(normalized)) {
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
    if (/search|knowledge graph|embedding|research/u.test(normalized)) {
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

    if (/revert|selector|signature|verification|contract/iu.test(normalized)) {
      return 'This can block contract execution, prevent proof-verification workflows from starting, and increase debugging time.';
    }

    if (/crash|failure|error|broken|not working|unable/iu.test(normalized)) {
      return 'This can interrupt the affected workflow, increase recovery effort, and delay task completion.';
    }

    if (/missing|lack|unsupported|feature request|need/iu.test(normalized)) {
      return 'This leaves users without a required workflow capability and increases manual work or workaround dependence.';
    }

    return 'The pilot should measure the resulting task delays, user effort, and unresolved cases before any broader impact claim is made.';
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

  private polishProblemStatement(value: string): string {
    return value
      .replace(/\band\s+and\b/gi, 'and')
      .replace(/\bsoftware[- ]ISP\b/gi, 'software application')
      .replace(/\bimage_generate\b/gi, 'image-generation')
      .replace(/\bBase64\b/g, 'Base64')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/([,.;:])(?=\S)/g, '$1 ')
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
      context.selectedDomains[0]?.name ??
      context.domainName ??
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