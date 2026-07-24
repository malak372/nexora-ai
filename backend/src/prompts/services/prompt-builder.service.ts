import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { createHash } from 'crypto';

import {
  CollectionJobStatus,
  IdeaGenerationType,
  Prisma,
  PromptType,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  ARABIC_TOKEN_RATIO,
  DEFAULT_TOKEN_RATIO,
  MAX_PROMPT_DATA_SOURCES,
  MAX_PROMPT_JSON_ARRAY_ITEMS,
  MAX_PROMPT_JSON_DEPTH,
  MAX_PROMPT_JSON_STRING_LENGTH,
  MAX_RENDERED_PROMPT_LENGTH,
  PROMPT_SECTION_CHARACTER_BUDGETS,
  PROMPT_TRUNCATION_MARKER,
} from '../constants/prompt.constants';

import {
  FREE_OUTPUT_FORMAT,
  FREE_OUTPUT_SCHEMA,
  GUEST_OUTPUT_FORMAT,
  GUEST_OUTPUT_SCHEMA,
  PREMIUM_OUTPUT_FORMAT,
  PREMIUM_OUTPUT_SCHEMA,
  UNLOCK_OUTPUT_FORMAT,
  UNLOCK_OUTPUT_SCHEMA,
} from '../output-formats';

import { JsonSchema } from '../types/json-schema.type';

import { PromptBuilderInput } from '../types/prompt-builder-input.type';

import { PromptBuilderOutput } from '../types/prompt-builder-output.type';

import { PromptTemplateService } from './prompt-template.service';

/**
 * Detects Arabic Unicode characters in rendered prompt content.
 */
const ARABIC_TEXT_PATTERN = /[\u0600-\u06ff]/;

/**
 * Provider-neutral structured-output contract selected according to
 * the generation access level and prompt purpose.
 */
type OutputContract = {
  /**
   * Stable schema name passed to the AI-provider adapter.
   */
  readonly schemaName: string;

  /**
   * Human-readable JSON example inserted into the prompt.
   */
  readonly format: string;

  /**
   * Provider-neutral structured-output schema.
   */
  readonly schema: JsonSchema;
};

/**
 * Prisma query used to retrieve the exact CollectionJob context
 * required to generate an AI prompt.
 *
 * Platforms are resolved through:
 *
 * CollectionJob
 * → CollectionJobSource
 * → DataSource
 */
const COLLECTION_JOB_PROMPT_QUERY = {
  select: {
    id: true,
    createdById: true,
    status: true,
    country: true,
    city: true,
    region: true,

    domain: {
      select: {
        id: true,
        name: true,
      },
    },

    nlpAnalysis: true,

    sources: {
      take: MAX_PROMPT_DATA_SOURCES,

      orderBy: {
        dataSource: {
          displayName: Prisma.SortOrder.asc,
        },
      },

      select: {
        dataSource: {
          select: {
            key: true,
            displayName: true,
            isActive: true,
            isImplemented: true,
          },
        },
      },
    },
  },
} satisfies Prisma.CollectionJobDefaultArgs;

/**
 * CollectionJob result inferred directly from the Prisma query.
 */
type CollectionJobPromptContext = Prisma.CollectionJobGetPayload<
  typeof COLLECTION_JOB_PROMPT_QUERY
>;

/**
 * Existing Idea fields required for direct-unlock prompt context.
 */
const EXISTING_IDEA_SELECT = {
  id: true,
  userId: true,
  collectionJobId: true,
  generationType: true,
  isUnlocked: true,
  title: true,
  problemStatement: true,
  objectives: true,
  targetUsers: true,
  limitedAbstract: true,
  partialAbstract: true,
} satisfies Prisma.IdeaSelect;

/**
 * Existing Idea context inferred directly from Prisma.
 */
type ExistingIdeaContext = Prisma.IdeaGetPayload<{
  select: typeof EXISTING_IDEA_SELECT;
}>;

/**
 * Builds provider-neutral prompts from persisted collection and NLP
 * pipeline results.
 *
 * Reads:
 * - CollectionJob.
 * - Domain.
 * - CollectionJobSource.
 * - DataSource.
 * - NlpAnalysis.
 * - Existing Idea for direct unlock.
 *
 * Responsibilities:
 * - Validate collection and NLP prerequisites.
 * - Validate direct-unlock ownership and eligibility.
 * - Resolve the correct structured-output contract.
 * - Render the configurable prompt template.
 * - Protect against unexpectedly large rendered prompts.
 * - Estimate prompt input-token usage.
 * - Calculate the source-template SHA-256 hash.
 *
 * This service does not:
 * - Start data collection.
 * - Execute NLP analysis.
 * - Persist PromptHistory.
 * - Call an AI provider.
 * - Create or update an Idea.
 * - Deduct credits.
 * - Process payments.
 *
 * @author Malak
 */
@Injectable()
export class PromptBuilderService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  /**
   * Builds one complete idea-generation or direct-unlock prompt.
   *
   * Requirements:
   * - CollectionJob exists.
   * - CollectionJob status is COMPLETED.
   * - NlpAnalysis exists.
   * - Direct unlock references an eligible active Idea.
   *
   * @param input Type-safe prompt-building request.
   * @returns Rendered prompt and provider-neutral response contract.
   */
  async buildIdeaPrompt(
    input: PromptBuilderInput,
  ): Promise<PromptBuilderOutput> {
    const collectionJob = await this.getCollectionJobContext(
      input.collectionJobId,
    );

    this.validateCollectionJob(collectionJob, input);

    const existingIdea = await this.getExistingIdea(input);

    const template = await this.promptTemplateService.getIdeaPromptTemplate();

    const outputContract = this.getOutputContract(input);

    const normalizedCountry = this.normalizeLocation(collectionJob.country);
    const normalizedCity = this.normalizeLocation(collectionJob.city);
    const normalizedRegion = this.normalizeLocation(collectionJob.region);

    const recentIdeas = await this.getRecentIdeasForDiversity(
      input,
      collectionJob,
    );

    const renderedTemplate = this.promptTemplateService.renderTemplate(
      template,
      {
        domain: collectionJob.domain.name,

        country: normalizedCountry,

        city: normalizedCity,

        region: normalizedRegion,

        platforms: this.formatDataSources(collectionJob),

        commentsCount: String(collectionJob.nlpAnalysis!.totalCommentsAnalyzed),

        sentimentStats: this.wrapUntrustedData(
          'sentiment_statistics',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.sentimentStats,
            PROMPT_SECTION_CHARACTER_BUDGETS.sentimentStats,
          ),
        ),

        keywords: this.wrapUntrustedData(
          'extracted_keywords',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.keywords,
            PROMPT_SECTION_CHARACTER_BUDGETS.keywords,
          ),
        ),

        topics: this.wrapUntrustedData(
          'detected_topics',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.topics,
            PROMPT_SECTION_CHARACTER_BUDGETS.topics,
          ),
        ),

        recurringProblems: this.wrapUntrustedData(
          'recurring_problems',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.recurringProblems,
            PROMPT_SECTION_CHARACTER_BUDGETS.recurringProblems,
          ),
        ),

        extractedNeeds: this.wrapUntrustedData(
          'extracted_needs',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.extractedNeeds,
            PROMPT_SECTION_CHARACTER_BUDGETS.extractedNeeds,
          ),
        ),

        featureRequests: this.wrapUntrustedData(
          'feature_requests',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.featureRequests,
            PROMPT_SECTION_CHARACTER_BUDGETS.featureRequests,
          ),
        ),

        opportunities: this.wrapUntrustedData(
          'potential_opportunities',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.opportunities,
            PROMPT_SECTION_CHARACTER_BUDGETS.opportunities,
          ),
        ),

        insights: this.wrapUntrustedData(
          'additional_insights',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.insights,
            PROMPT_SECTION_CHARACTER_BUDGETS.insights,
          ),
        ),

        dataQuality: this.wrapUntrustedData(
          'data_quality',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.dataQuality,
            PROMPT_SECTION_CHARACTER_BUDGETS.dataQuality,
          ),
        ),

        samplePosts: this.wrapUntrustedData(
          'sample_posts',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.samplePosts,
            PROMPT_SECTION_CHARACTER_BUDGETS.samplePosts,
          ),
        ),

        sampleComments: this.wrapUntrustedData(
          'sample_comments',

          this.formatJsonForPrompt(
            collectionJob.nlpAnalysis!.sampleComments,
            PROMPT_SECTION_CHARACTER_BUDGETS.sampleComments,
          ),
        ),

        existingIdea: this.wrapUntrustedData(
          'existing_idea',

          this.formatExistingIdea(existingIdea),
        ),

        requestedOutputFormat: outputContract.format,
      },
    );

    /*
     * This application-controlled directive is deliberately injected
     * outside the configurable template.
     *
     * A SystemSetting may contain an older or weaker custom template.
     * Keeping the directive here guarantees that country, city, and
     * region remain authoritative generation constraints regardless
     * of which compatible template is currently active.
     */
    const renderedPrompt = [
      this.buildEvidenceGroundingDirective(),
      this.buildOpportunitySelectionDirective(input),
      this.buildDiversityDirective(recentIdeas),
      this.buildLocalGroundingDirective({
        domain: collectionJob.domain.name,
        country: normalizedCountry,
        city: normalizedCity,
        region: normalizedRegion,
      }),
      renderedTemplate,
    ].join('\n\n');

    const compactPrompt = this.compactPrompt(renderedPrompt);

    this.validateRenderedPromptLength(compactPrompt);

    return {
      promptType: this.getPromptType(input),

      promptText: compactPrompt,

      estimatedInputTokens: this.estimateApproximateInputTokens(compactPrompt),

      templateHash: this.createTemplateHash(template),

      responseSchemaName: outputContract.schemaName,

      responseSchema: outputContract.schema,
    };
  }



  /**
   * Builds the application-controlled directive that anchors generation to the
   * deterministic opportunity-ranking result.
   *
   * Keeping this directive outside the configurable template prevents an old
   * administrator-defined template from silently discarding the ranking stage.
   */
  private buildOpportunitySelectionDirective(
    input: PromptBuilderInput,
  ): string {
    if (
      input.purpose !== 'IDEA_GENERATION' ||
      !input.opportunityRanking
    ) {
      return [
        'OPPORTUNITY SELECTION:',
        '- No pre-ranked generation opportunity is available for this request.',
        '- Use the strongest evidence-backed problem while preserving the existing idea during direct unlock.',
      ].join('\n');
    }

    const ranking = input.opportunityRanking;
    const selected = ranking.selected;
    const alternatives = ranking.alternatives.slice(0, 5).map((item) => ({
      rank: item.rank,
      title: item.title,
      problem: item.problem,
      need: item.need,
      solutionArea: item.solutionArea,
      score: item.finalScore,
      evidenceSamples: item.evidenceSamples.slice(0, 2),
    }));

    const selectedContext = {
      rank: selected.rank,
      title: selected.title,
      problem: selected.problem,
      need: selected.need,
      solutionArea: selected.solutionArea,
      evidenceType: selected.evidenceType,
      frequency: selected.frequency,
      severity: selected.severity,
      score: selected.finalScore,
      evidenceSamples: selected.evidenceSamples,
    };

    return [
      'AUTHORITATIVE OPPORTUNITY SELECTION:',
      '- Build the idea around the selected opportunity below.',
      '- Derive a concrete user workflow and root cause from the evidence samples; never use a generic NLP label as the product concept.',
      '- Cover the selected primary problem completely before adding secondary capabilities.',
      '- Alternatives may be used only as supporting capabilities when they are compatible with the same user workflow.',
      '- Do not switch to a lower-ranked opportunity merely because it is easier to describe.',
      '- Do not generate a thin middleware, dashboard, wrapper, tracker, or document proxy unless the evidence proves that this is the complete product opportunity and the differentiator is substantial.',
      '- Prefer a defensible end-to-end product capability that measurably improves the affected workflow.',
      `- Evidence coverage: ${(ranking.evidenceCoverage * 100).toFixed(1)}%.`,
      ...ranking.qualityWarnings.map((warning) => `- Quality warning: ${warning}`),
      '<untrusted_selected_opportunity>',
      this.stringifyPromptData(selectedContext),
      '</untrusted_selected_opportunity>',
      '<untrusted_ranked_alternatives>',
      this.stringifyPromptData(alternatives),
      '</untrusted_ranked_alternatives>',
    ].join('\n');
  }

  /** Safely serializes application-controlled ranking data for the prompt. */
  private stringifyPromptData(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return 'null';
    }
  }

  /** Loads a bounded list of the requester's recent ideas in the same domain. */
  private async getRecentIdeasForDiversity(
    input: PromptBuilderInput,
    collectionJob: CollectionJobPromptContext,
  ): Promise<Array<{ title: string; problemStatement: string }>> {
    if (input.purpose !== 'IDEA_GENERATION') {
      return [];
    }

    const normalizedCountry = collectionJob.country?.trim();

    if (!normalizedCountry) {
      return [];
    }

    const normalizedCity = this.normalizeNullableLocationForQuery(
      collectionJob.city,
    );
    const normalizedRegion = this.normalizeNullableLocationForQuery(
      collectionJob.region,
    );

    const ideas = await this.prisma.idea.findMany({
      where: {
        domainId: collectionJob.domain.id,
        deletedAt: null,
        collectionJob: {
          is: {
            country: {
              equals: normalizedCountry,
              mode: 'insensitive',
            },
            city: normalizedCity
              ? { equals: normalizedCity, mode: 'insensitive' }
              : null,
            region: normalizedRegion
              ? { equals: normalizedRegion, mode: 'insensitive' }
              : null,
          },
        },
      },
      select: {
        title: true,
        problemStatement: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return ideas.map((idea) => ({
      title: idea.title.trim(),
      problemStatement: idea.problemStatement?.trim() ?? '',
    }));
  }

  /**
   * Normalizes optional collection locations before using them in an exact
   * regional Prisma filter.
   */
  private normalizeNullableLocationForQuery(
    value: string | null,
  ): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  /** Builds an application-controlled diversity directive. */
  private buildDiversityDirective(
    recentIdeas: Array<{ title: string; problemStatement: string }>,
  ): string {
    if (recentIdeas.length === 0) {
      return [
        'DIVERSITY REQUIREMENT:',
        '- Generate a distinctive product concept, not a generic variation of a common application.',
      ].join('\n');
    }

    const summaries = recentIdeas.map((idea, index) => {
      const problem = idea.problemStatement.replace(/\s+/gu, ' ').trim().slice(0, 280);
      return `${index + 1}. ${idea.title.trim().slice(0, 160)} — ${problem}`;
    });

    return [
      'DIVERSITY REQUIREMENT:',
      '- The new idea must differ materially from every previous idea generated for the same domain and geographic area below.',
      '- Changing only the title, branding, platform, or adding one feature is not sufficient.',
      '- Choose a different primary problem, root cause, core workflow, value proposition, target-user job, and capability combination.',
      '- A new name, platform wrapper, mobile version, dashboard, grade calculator, tracker, notification feature, or minor integration does not make an idea materially different.',
      '- Do not reuse the same central solution category or dominant capability combination from a previous idea.',
      '- Reusing the same collection evidence is allowed only when deriving a genuinely different product opportunity from another supported pain point or user workflow.',
      '<untrusted_regional_previous_ideas>',
      ...summaries,
      '</untrusted_regional_previous_ideas>',
    ].join('\n');
  }

  /**
   * Retrieves persisted CollectionJob, Domain, DataSource, and
   * NlpAnalysis context.
   */
  private async getCollectionJobContext(
    collectionJobId: string,
  ): Promise<CollectionJobPromptContext> {
    const normalizedCollectionJobId = this.requireIdentifier(
      collectionJobId,
      'Collection job ID',
    );

    const collectionJob = await this.prisma.collectionJob.findUnique({
      where: {
        id: normalizedCollectionJobId,
      },

      ...COLLECTION_JOB_PROMPT_QUERY,
    });

    if (!collectionJob) {
      throw new NotFoundException('Collection job not found.');
    }

    return collectionJob;
  }

  /**
   * Validates collection and NLP pipeline prerequisites.
   */
  private validateCollectionJob(
    collectionJob: CollectionJobPromptContext,

    input: PromptBuilderInput,
  ): void {
    if (collectionJob.status !== CollectionJobStatus.COMPLETED) {
      throw new BadRequestException(
        'Collection job must be completed before building an idea prompt.',
      );
    }

    if (!collectionJob.nlpAnalysis) {
      throw new BadRequestException('NLP analysis is not ready yet.');
    }

    if (
      input.purpose === 'IDEA_UNLOCK' &&
      collectionJob.createdById !== null &&
      collectionJob.createdById !== input.requesterUserId
    ) {
      /*
       * NotFoundException avoids revealing that another user's
       * CollectionJob exists.
       */
      throw new NotFoundException(
        'Collection job was not found for the requester.',
      );
    }
  }

  /**
   * Returns and validates the existing Idea used for direct unlock.
   */
  private async getExistingIdea(
    input: PromptBuilderInput,
  ): Promise<ExistingIdeaContext | null> {
    if (input.purpose !== 'IDEA_UNLOCK') {
      return null;
    }

    const normalizedIdeaId = this.requireIdentifier(
      input.existingIdeaId,
      'Existing idea ID',
    );

    const normalizedRequesterId = this.requireIdentifier(
      input.requesterUserId,
      'Requester user ID',
    );

    const normalizedCollectionJobId = this.requireIdentifier(
      input.collectionJobId,
      'Collection job ID',
    );

    const idea = await this.prisma.idea.findFirst({
      where: {
        id: normalizedIdeaId,

        userId: normalizedRequesterId,

        deletedAt: null,
      },

      select: EXISTING_IDEA_SELECT,
    });

    if (!idea) {
      throw new NotFoundException(
        'Existing idea was not found or does not belong to the requester.',
      );
    }

    if (idea.collectionJobId !== normalizedCollectionJobId) {
      throw new BadRequestException(
        'Idea does not belong to the provided collection job.',
      );
    }

    if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
      throw new BadRequestException(
        'Only registered free-tier ideas can be directly unlocked.',
      );
    }

    if (idea.isUnlocked) {
      throw new BadRequestException('The idea is already unlocked.');
    }

    return idea;
  }

  /**
   * Converts the prompt-building purpose into PromptType.
   */
  private getPromptType(input: PromptBuilderInput): PromptType {
    return input.purpose === 'IDEA_UNLOCK'
      ? PromptType.IDEA_UNLOCK
      : PromptType.IDEA_GENERATION;
  }

  /**
   * Selects the structured-output contract for the operation.
   */
  private getOutputContract(input: PromptBuilderInput): OutputContract {
    if (input.purpose === 'IDEA_UNLOCK') {
      return {
        schemaName: 'nexora_idea_unlock',

        format: UNLOCK_OUTPUT_FORMAT,

        schema: UNLOCK_OUTPUT_SCHEMA,
      };
    }

    const generationType = input.generationType;

    switch (generationType) {
      case IdeaGenerationType.GUEST_FREE:
        return {
          schemaName: 'nexora_guest_idea',

          format: GUEST_OUTPUT_FORMAT,

          schema: GUEST_OUTPUT_SCHEMA,
        };

      case IdeaGenerationType.NORMAL_FREE:
        return {
          schemaName: 'nexora_free_idea',

          format: FREE_OUTPUT_FORMAT,

          schema: FREE_OUTPUT_SCHEMA,
        };

      case IdeaGenerationType.PREMIUM_CREDIT:
        return {
          schemaName: 'nexora_premium_idea',

          format: PREMIUM_OUTPUT_FORMAT,

          schema: PREMIUM_OUTPUT_SCHEMA,
        };

      default:
        return this.assertNever(generationType);
    }
  }

  /**
   * Enforces exhaustive IdeaGenerationType handling.
   */
  private assertNever(value: never): never {
    throw new BadRequestException(
      `Unsupported idea generation type: ${String(value)}`,
    );
  }

  /**
   * Formats the existing free-tier Idea as direct-unlock context.
   *
   * objectives and targetUsers are stored as Prisma Json values.
   * The formatter accepts unknown values defensively so malformed or
   * legacy records cannot break prompt construction.
   */
  private formatExistingIdea(idea: ExistingIdeaContext | null): string {
    if (!idea) {
      return 'Not applicable. ' + 'This is a new idea generation request.';
    }

    return this.compactPrompt(`
Title:
${idea.title}

Problem statement:
${idea.problemStatement ?? 'Not available'}

Objectives:
${this.formatStoredStringArray(idea.objectives)}

Target users:
${this.formatStoredStringArray(idea.targetUsers)}

Limited abstract:
${idea.limitedAbstract ?? 'Not available'}

Partial abstract:
${idea.partialAbstract ?? 'Not available'}
    `);
  }

  /**
   * Formats a Prisma Json value expected to contain a string array.
   *
   * JSON arrays are converted into readable bullet points.
   *
   * A string fallback is retained for defensive compatibility with:
   * - Legacy records.
   * - Manually imported records.
   * - Data created before the JSON migration.
   *
   * @param value Stored Prisma JSON value.
   */
  private formatStoredStringArray(value: unknown): string {
    if (Array.isArray(value)) {
      const items = value
        .filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
        .map((item) => `- ${item.trim()}`);

      return items.length > 0 ? items.join('\n') : 'Not available';
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      /*
       * Defensive fallback for legacy data.
       */
      return value.trim();
    }

    return 'Not available';
  }

  /**
   * Formats the DataSource records selected for collection.
   */
  private formatDataSources(collectionJob: CollectionJobPromptContext): string {
    if (collectionJob.sources.length === 0) {
      return 'Not specified';
    }

    return collectionJob.sources
      .map(({ dataSource }) => {
        const availability =
          dataSource.isActive && dataSource.isImplemented
            ? 'available'
            : 'unavailable';

        return (
          `${dataSource.displayName} ` + `(${dataSource.key}, ${availability})`
        );
      })
      .join(', ');
  }

  /**
   * Formats persisted JSON context for provider input while enforcing
   * a strict per-section character budget.
   *
   * The complete NLP result remains stored in the database. This
   * method only produces a compact provider-facing representation so
   * one unusually long post, comment, evidence sample, or nested
   * analysis object cannot make the complete prompt unusable.
   *
   * @param value Persisted JSON-like value.
   * @param characterBudget Maximum rendered characters for the section.
   * @returns Readable and bounded prompt context.
   */
  private formatJsonForPrompt(value: unknown, characterBudget: number): string {
    if (this.isEmptyJsonValue(value)) {
      return 'Not enough data';
    }

    const compactedValue = this.compactJsonValue(value, 0);
    const serializedValue = JSON.stringify(compactedValue, null, 2);

    if (serializedValue.length <= characterBudget) {
      return serializedValue;
    }

    const safeContentLength = Math.max(
      0,
      characterBudget - PROMPT_TRUNCATION_MARKER.length,
    );

    return (
      serializedValue.slice(0, safeContentLength).trimEnd() +
      PROMPT_TRUNCATION_MARKER
    );
  }

  /**
   * Creates a bounded clone of arbitrary persisted JSON.
   *
   * Arrays preserve their original order because NLP services already
   * persist the most relevant evidence first. Objects preserve their
   * keys while deeply nested or oversized values are shortened.
   */
  private compactJsonValue(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      return this.truncatePromptString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (depth >= MAX_PROMPT_JSON_DEPTH) {
      return '[nested value omitted]';
    }

    if (Array.isArray(value)) {
      const retainedItems = value
        .slice(0, MAX_PROMPT_JSON_ARRAY_ITEMS)
        .map((item) => this.compactJsonValue(item, depth + 1));

      if (value.length > MAX_PROMPT_JSON_ARRAY_ITEMS) {
        retainedItems.push(
          `[${value.length - MAX_PROMPT_JSON_ARRAY_ITEMS} additional item(s) omitted]`,
        );
      }

      return retainedItems;
    }

    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([key, nestedValue]) => [
            key,
            this.compactJsonValue(nestedValue, depth + 1),
          ],
        ),
      );
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'symbol') {
      return value.description ?? '[symbol]';
    }

    if (typeof value === 'function') {
      return '[function omitted]';
    }

    return '[unsupported value omitted]';
  }

  /**
   * Shortens one free-text JSON value without cutting surrogate pairs.
   */
  private truncatePromptString(value: string): string {
    const normalizedValue = value.trim();

    if (normalizedValue.length <= MAX_PROMPT_JSON_STRING_LENGTH) {
      return normalizedValue;
    }

    return (
      normalizedValue.slice(0, MAX_PROMPT_JSON_STRING_LENGTH).trimEnd() + '…'
    );
  }

  /**
   * Determines whether a JSON-like value contains usable content.
   */
  private isEmptyJsonValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    if (typeof value === 'object') {
      return Object.keys(value).length === 0;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    return false;
  }

  /**
   * Wraps external or generated context inside explicit boundaries.
   */
  private wrapUntrustedData(label: string, value: string): string {
    return `<untrusted_${label}>
${value}
</untrusted_${label}>`;
  }

  /**
   * Builds the immutable evidence-grounding instruction applied to every
   * idea-generation and direct-unlock prompt.
   *
   * This directive is intentionally injected outside the configurable
   * template so an outdated or weakened SystemSetting template cannot
   * permit unsupported factual claims.
   *
   * The model may:
   * - State findings directly when they are supported by supplied NLP data.
   * - Make cautious product inferences when evidence suggests a need.
   *
   * The model may not:
   * - Convert a requested feature into proof that the local problem exists.
   * - Treat the request location as evidence about local conditions.
   * - Invent local statistics, institutions, service failures, regulations,
   *   infrastructure constraints, or user behavior.
   *
   * @returns Application-controlled evidence policy.
   */
  private buildEvidenceGroundingDirective(): string {
    return `
APPLICATION-ENFORCED EVIDENCE POLICY

Evidence hierarchy:
1. Direct evidence:
   A claim explicitly represented by supplied recurring problems, extracted
   needs, feature requests, opportunities, insights, data-quality results, or
   representative post/comment samples.
2. Supported inference:
   A cautious product or user-need inference reasonably derived from multiple
   supplied findings, but not stated as a verified local fact.
3. Unsupported assumption:
   A claim based only on the requested domain, location, common knowledge,
   stereotypes, plausibility, or the model's external knowledge.

Mandatory writing rules:
1. Build the central problem primarily from direct evidence.
2. Use supported inferences only with cautious wording such as:
   - "the supplied discussions indicate"
   - "the collected feedback suggests"
   - "users may benefit from"
   - "there appears to be an opportunity"
   - "the proposed product is designed to support"
3. Never transform a requested keyword or desired feature into proof that a
   local problem currently exists.
4. Never claim that a city, region, institution, authority, service provider,
   school, clinic, business sector, or population has a specific failure,
   shortage, behavior, rate, policy, workflow, or infrastructure condition
   unless the supplied evidence directly supports it.
5. Do not use definitive phrases such as:
   - "residents face"
   - "the city suffers from"
   - "services are unreliable"
   - "recycling rates are low"
   - "schools lack"
   - "businesses cannot"
   - "the government fails to"
   unless direct evidence supports that exact meaning.
6. Location fields establish the target deployment context only. They are not
   evidence that any location-specific problem, language preference, economic
   condition, connectivity issue, public policy, or institutional practice
   exists.
7. Feature requests establish desired capabilities, not verified root causes.
8. Sample evidence illustrates themes but does not prove population-wide facts.
9. Frequency, confidence, and data-quality values must be treated as internal
   evidence-strength signals. Never expose or invent numeric claims unless the
   requested output format explicitly permits them and the supplied data
   directly contains them.
10. Never convert one user's wording into a population statistic. For example,
    a comment saying an app works "50% of the time" is anecdotal evidence, not a
    verified 50% failure rate.
11. Market size, institution count, adoption rate, budget, implementation time,
    API availability, regulatory status, and feasibility claims must be framed
    as estimates or assumptions unless directly supplied and verified.
12. Do not claim an external platform exposes a required API or permits a
    proposed integration unless the supplied evidence establishes it. When
    uncertain, describe the integration as conditional and identify the need
    for provider/institution approval.
13. Regulatory text must use preliminary language and explicitly recommend
    local legal verification when relevant.
10. If evidence is weak, mixed, indirect, or non-local:
    - describe a general problem discovered in the source data;
    - position the solution as suitable for deployment in the requested
      location;
    - avoid claiming that the problem is unique to or proven within that
      location.
11. Internally review every sentence before returning JSON:
    - Is this statement directly supported?
    - Is it a cautious inference?
    - Is it an unsupported local assumption?
    Rewrite or remove every unsupported assumption.
`.trim();
  }

  /**
   * Builds the immutable local-grounding instruction applied to every
   * generated idea and direct-unlock request.
   *
   * The location must influence the product definition itself rather
   * than being appended only to the title, target users, or abstract.
   * At the same time, the model must not fabricate local facts that
   * are absent from the supplied collection and NLP evidence.
   *
   * @param context Persisted generation domain and location.
   * @returns Application-controlled prompt directive.
   */
  private buildLocalGroundingDirective(context: {
    readonly domain: string;
    readonly country: string;
    readonly city: string;
    readonly region: string;
  }): string {
    const hasCountry = this.isSpecifiedLocation(context.country);
    const hasCity = this.isSpecifiedLocation(context.city);
    const hasRegion = this.isSpecifiedLocation(context.region);
    const hasAnyLocation = hasCountry || hasCity || hasRegion;

    if (!hasAnyLocation) {
      return `
APPLICATION-ENFORCED CONTEXT RULES

- Target domain: ${context.domain}
- No specific geographic location was supplied.
- Generate a domain-grounded idea from the supplied evidence.
- Do not invent a country, city, region, local regulation, institution,
  infrastructure constraint, market fact, or cultural assumption.
`.trim();
    }

    return `
APPLICATION-ENFORCED LOCAL GROUNDING RULES

Authoritative target context:
- Domain: ${context.domain}
- Country: ${context.country}
- City: ${context.city}
- Region: ${context.region}

Mandatory behavior:
1. Treat the supplied country, city, and region as product-design
   constraints, not decorative labels.
2. The generated idea must explain through its permitted output fields
   how the discovered problem, affected workflow, target users, or
   solution requirements relate to this target context.
3. Do not create a globally generic idea and merely append phrases such
   as "for local users", "for Palestinian users", or the location name.
4. Prefer evidence-supported local implications involving language,
   connectivity, device access, operating workflows, institutional
   practices, affordability, adoption barriers, privacy, infrastructure,
   or service availability only when the supplied evidence supports them.
5. When the evidence establishes a general problem but does not establish
   a truly location-specific cause, generate a locally deployable version
   of the solution and clearly avoid claiming that the problem is unique
   to the target location.
6. Never invent local laws, statistics, institutions, integrations,
   economic conditions, cultural practices, government requirements, or
   infrastructure limitations.
7. Regulatory or legal content may only be preliminary high-level
   guidance and must never be presented as verified legal advice.
8. Keep the core problem coherent. Security, localization, analytics, and
   administration should remain supporting requirements unless the
   supplied evidence identifies them as primary recurring problems.
9. Ensure the title communicates the product's distinctive capability.
   The location may appear in the title only when it improves clarity and
   is genuinely central to the product positioning.
10. Before returning the JSON, internally verify that removing the
    location from the proposal would materially change at least one of:
    the problem framing, target users, product behavior, deployment
    constraints, accessibility requirements, or implementation priorities.
`.trim();
  }

  /**
   * Determines whether a normalized location value was provided.
   */
  private isSpecifiedLocation(value: string): boolean {
    return value !== 'Not specified';
  }

  /**
   * Normalizes optional location values.
   */
  private normalizeLocation(value: string | null): string {
    return value?.trim() || 'Not specified';
  }

  /**
   * Removes excessive blank lines while preserving paragraph
   * separation.
   */
  private compactPrompt(prompt: string): string {
    return prompt.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Rejects a rendered prompt exceeding the configured limit.
   */
  private validateRenderedPromptLength(prompt: string): void {
    if (prompt.length > MAX_RENDERED_PROMPT_LENGTH) {
      throw new BadRequestException(
        `Rendered prompt exceeds the maximum supported length of ${MAX_RENDERED_PROMPT_LENGTH} characters.`,
      );
    }
  }

  /**
   * Estimates rendered prompt input-token usage.
   *
   * This is an approximation only. Provider-reported usage remains
   * the final source of truth.
   */
  private estimateApproximateInputTokens(text: string): number {
    const ratio = ARABIC_TEXT_PATTERN.test(text)
      ? ARABIC_TOKEN_RATIO
      : DEFAULT_TOKEN_RATIO;

    return Math.ceil(text.length / ratio);
  }

  /**
   * Creates the SHA-256 hash identifying the template version.
   */
  private createTemplateHash(template: string): string {
    return createHash('sha256').update(template).digest('hex');
  }

  /**
   * Normalizes and validates a required identifier.
   */
  private requireIdentifier(value: string, fieldName: string): string {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} is required.`);
    }

    return normalizedValue;
  }
}