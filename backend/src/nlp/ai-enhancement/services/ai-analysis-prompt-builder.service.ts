import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import { createHash } from 'node:crypto';

import { DEFAULT_TOKEN_RATIO } from '../../../prompts/constants/prompt.constants';

import {
  AiEnhancementPromptPlaceholder,
  AiEnhancementPromptTemplateValues,
  REQUIRED_AI_ENHANCEMENT_PLACEHOLDERS,
} from '../constants/ai-enhancement-placeholders.constant';

import { MAX_AI_PROMPT_EVIDENCE_SAMPLES } from '../constants/ai-enhancement.constants';

import {
  AI_ENHANCEMENT_OUTPUT_SCHEMA,
  AI_ENHANCEMENT_RESPONSE_SCHEMA_NAME,
} from '../schemas/ai-enhancement-output.schema';

import { DEFAULT_AI_ENHANCEMENT_TEMPLATE } from '../templates/default-ai-enhancement.template';

import {
  AiEnhancementEvidence,
  AiEnhancementInput,
  AiEnhancementMetrics,
} from '../types/ai-enhancement-input.type';

import { AiAnalysisPromptBuilderOutput } from '../types/ai-analysis-prompt-builder-output.type';

/**
 * Approximate character-to-token ratio used when Arabic text appears
 * in an NLP AI-enhancement prompt.
 *
 * Arabic and mixed-language prompts may require more tokens per
 * character than English-only prompts. Provider-reported token usage
 * remains the authoritative value.
 */
const ARABIC_TOKEN_RATIO = 2.5;

/**
 * Matches Arabic Unicode characters commonly present in community
 * posts, comments, and NLP analysis values.
 */
const ARABIC_TEXT_PATTERN = /[\u0600-\u06FF]/;

/**
 * Matches placeholders supported by the NLP AI-enhancement template.
 *
 * Examples:
 * - {{decisionReasons}}
 * - {{evidence}}
 * - {{requestedOutputFormat}}
 */
const AI_ENHANCEMENT_PLACEHOLDER_PATTERN = /{{([a-zA-Z0-9_]+)}}/g;

/**
 * Maximum number of characters retained from one evidence sample
 * before it is inserted into the prompt.
 */
const MAX_PROMPT_EVIDENCE_TEXT_LENGTH = 2_000;

/**
 * Builds a provider-neutral prompt for semantic enhancement of an
 * existing rule-based NLP analysis.
 *
 * Responsibilities:
 * - Validate the prompt-builder boundary input.
 * - Select and normalize a bounded set of evidence samples.
 * - Project only the rule-based fields required by the AI task.
 * - Render and validate the enhancement template.
 * - Attach the provider-neutral response schema.
 * - Estimate input-token usage.
 * - Create a stable source-template hash.
 *
 * This service does not:
 * - Call an AI provider.
 * - Validate an AI response.
 * - Merge AI output with rule-based results.
 * - Persist analysis data.
 *
 * @author Eman
 */
@Injectable()
export class AiAnalysisPromptBuilderService {
  /**
   * Builds one complete NLP AI-enhancement prompt and its structured
   * response contract.
   *
   * @param input Rule-based analysis, selected evidence, and decision context.
   * @returns Rendered prompt and AI-execution metadata.
   */
  build(input: AiEnhancementInput): AiAnalysisPromptBuilderOutput {
    this.validateInput(input);

    const selectedEvidence = this.prepareEvidence(input.evidence);

    const templateValues = this.buildTemplateValues(input, selectedEvidence);

    const renderedPrompt = this.renderTemplate(
      DEFAULT_AI_ENHANCEMENT_TEMPLATE,
      templateValues,
    );

    const compactPrompt = this.compactPrompt(renderedPrompt);

    return {
      promptText: compactPrompt,
      estimatedInputTokens: this.estimateApproximateInputTokens(compactPrompt),
      templateHash: this.createTemplateHash(DEFAULT_AI_ENHANCEMENT_TEMPLATE),
      responseSchemaName: AI_ENHANCEMENT_RESPONSE_SCHEMA_NAME,
      responseSchema: AI_ENHANCEMENT_OUTPUT_SCHEMA,
    };
  }

  /**
   * Builds the complete typed placeholder-value map used to render
   * the default enhancement template.
   */
  private buildTemplateValues(
    input: AiEnhancementInput,
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): AiEnhancementPromptTemplateValues {
    return {
      decisionReasons: this.serializeJson(input.decisionReasons),
      complexityMetrics: this.serializeMetrics(input.complexityMetrics),
      qualityMetrics: this.serializeMetrics(input.qualityMetrics),

      sentimentStats: this.serializeJson(input.ruleBasedOutput.sentimentStats),
      keywords: this.serializeJson(input.ruleBasedOutput.keywords),
      topics: this.serializeJson(input.ruleBasedOutput.topics),
      recurringProblems: this.serializeJson(
        input.ruleBasedOutput.recurringProblems,
      ),
      extractedNeeds: this.serializeJson(input.ruleBasedOutput.extractedNeeds),
      featureRequests: this.serializeJson(
        input.ruleBasedOutput.featureRequests,
      ),
      opportunities: this.serializeJson(input.ruleBasedOutput.opportunities),
      insights: this.serializeJson(input.ruleBasedOutput.insights),

      evidence: this.serializeEvidence(evidence),

      /*
       * The provider-neutral JSON Schema is the single source of truth
       * for the expected structured response.
       */
      requestedOutputFormat: this.serializeJson(AI_ENHANCEMENT_OUTPUT_SCHEMA),
    };
  }

  /**
   * Performs boundary validation before prompt construction.
   *
   * Deeper semantic validation remains the responsibility of the
   * originating NLP services.
   */
  private validateInput(input: AiEnhancementInput): void {
    if (input.evidence.length === 0) {
      throw new BadRequestException(
        'At least one evidence sample is required for AI enhancement.',
      );
    }

    if (input.decisionReasons.length === 0) {
      throw new BadRequestException(
        'At least one AI-enhancement decision reason is required.',
      );
    }

    const hasInvalidDecisionReason = input.decisionReasons.some(
      (reason) => reason.trim().length === 0,
    );

    if (hasInvalidDecisionReason) {
      throw new BadRequestException(
        'AI-enhancement decision reasons must not contain empty values.',
      );
    }

    const hasInvalidEvidence = input.evidence.some(
      (item) => item.id.trim().length === 0 || item.text.trim().length === 0,
    );

    if (hasInvalidEvidence) {
      throw new BadRequestException(
        'AI-enhancement evidence must contain non-empty identifiers and text.',
      );
    }

    this.validateMetrics(input.complexityMetrics, 'complexity');
    this.validateMetrics(input.qualityMetrics, 'quality');
  }

  /**
   * Validates optional numeric metrics before prompt serialization.
   */
  private validateMetrics(
    metrics: AiEnhancementMetrics | undefined,
    metricGroup: string,
  ): void {
    if (!metrics) {
      return;
    }

    const hasInvalidMetric = Object.values(metrics).some(
      (value) => !Number.isFinite(value),
    );

    if (hasInvalidMetric) {
      throw new BadRequestException(
        `AI-enhancement ${metricGroup} metrics must contain finite numeric values only.`,
      );
    }
  }

  /**
   * Removes duplicate evidence identifiers, preserves upstream
   * priority order, normalizes text, and applies the configured
   * maximum evidence count.
   */
  private prepareEvidence(
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): ReadonlyArray<AiEnhancementEvidence> {
    const seenIds = new Set<string>();
    const preparedEvidence: AiEnhancementEvidence[] = [];

    for (const item of evidence) {
      const normalizedId = item.id.trim();

      if (seenIds.has(normalizedId)) {
        continue;
      }

      seenIds.add(normalizedId);

      preparedEvidence.push({
        id: normalizedId,
        sourceType: item.sourceType,
        language: item.language,
        text: this.truncateEvidenceText(item.text),
      });

      if (preparedEvidence.length >= MAX_AI_PROMPT_EVIDENCE_SAMPLES) {
        break;
      }
    }

    if (preparedEvidence.length === 0) {
      throw new BadRequestException(
        'No valid evidence samples are available for AI enhancement.',
      );
    }

    return preparedEvidence;
  }

  /**
   * Serializes selected evidence into a prompt-safe JSON structure.
   */
  private serializeEvidence(
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): string {
    return this.serializeJson(
      evidence.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        language: item.language,
        text: item.text,
      })),
    );
  }

  /**
   * Trims and limits one evidence text while preserving its stable
   * identifier for later validation.
   */
  private truncateEvidenceText(text: string): string {
    const normalizedText = text.trim();

    if (normalizedText.length <= MAX_PROMPT_EVIDENCE_TEXT_LENGTH) {
      return normalizedText;
    }

    return `${normalizedText.slice(0, MAX_PROMPT_EVIDENCE_TEXT_LENGTH)}…`;
  }

  /**
   * Serializes optional numeric metrics into deterministic JSON.
   *
   * Missing metrics are represented as an empty object.
   */
  private serializeMetrics(metrics?: AiEnhancementMetrics): string {
    return this.serializeJson(metrics ?? {});
  }

  /**
   * Serializes a value into readable JSON for deterministic prompt
   * rendering.
   *
   * Undefined values are represented as null rather than omitted.
   */
  private serializeJson(value: unknown): string {
    try {
      const serialized = JSON.stringify(value ?? null, null, 2);

      if (serialized === undefined) {
        throw new TypeError('Value is not JSON serializable.');
      }

      return serialized;
    } catch {
      throw new InternalServerErrorException(
        'AI-enhancement prompt data could not be serialized.',
      );
    }
  }

  /**
   * Renders every supported placeholder in the enhancement template.
   *
   * The template is validated before external analysis values or
   * evidence are inserted. This prevents placeholder-like content
   * inside community data from being interpreted as template syntax.
   */
  private renderTemplate(
    template: string,
    values: AiEnhancementPromptTemplateValues,
  ): string {
    const normalizedTemplate = template.trim();

    this.validateTemplate(normalizedTemplate);

    return normalizedTemplate.replace(
      AI_ENHANCEMENT_PLACEHOLDER_PATTERN,
      (_match: string, key: string) => {
        const placeholder = key as AiEnhancementPromptPlaceholder;
        const value = values[placeholder];

        if (value === undefined) {
          throw new InternalServerErrorException(
            `No value was provided for AI-enhancement prompt placeholder: ${key}`,
          );
        }

        return value;
      },
    );
  }

  /**
   * Ensures that every required placeholder exists exactly once and
   * that no unsupported placeholders are declared.
   */
  private validateTemplate(template: string): void {
    const declaredPlaceholders = Array.from(
      template.matchAll(AI_ENHANCEMENT_PLACEHOLDER_PATTERN),
      (match) => match[1],
    );

    const supportedPlaceholders = new Set<string>(
      REQUIRED_AI_ENHANCEMENT_PLACEHOLDERS,
    );

    const missingPlaceholders = REQUIRED_AI_ENHANCEMENT_PLACEHOLDERS.filter(
      (placeholder) => !declaredPlaceholders.includes(placeholder),
    );

    if (missingPlaceholders.length > 0) {
      throw new InternalServerErrorException(
        `AI-enhancement template is missing required placeholders: ${missingPlaceholders.join(
          ', ',
        )}`,
      );
    }

    const unsupportedPlaceholders = [
      ...new Set(
        declaredPlaceholders.filter(
          (placeholder) => !supportedPlaceholders.has(placeholder),
        ),
      ),
    ];

    if (unsupportedPlaceholders.length > 0) {
      throw new InternalServerErrorException(
        `AI-enhancement template contains unsupported placeholders: ${unsupportedPlaceholders.join(
          ', ',
        )}`,
      );
    }

    const duplicatePlaceholders = REQUIRED_AI_ENHANCEMENT_PLACEHOLDERS.filter(
      (placeholder) =>
        declaredPlaceholders.filter((declared) => declared === placeholder)
          .length > 1,
    );

    if (duplicatePlaceholders.length > 0) {
      throw new InternalServerErrorException(
        `AI-enhancement template contains duplicate placeholders: ${duplicatePlaceholders.join(
          ', ',
        )}`,
      );
    }
  }

  /**
   * Removes excessive blank lines while preserving readable section
   * separation.
   */
  private compactPrompt(prompt: string): string {
    return prompt.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Estimates approximate prompt input-token usage.
   *
   * Arabic or mixed-language prompts use a more conservative ratio.
   * Exact provider-reported token usage remains the source of truth.
   */
  private estimateApproximateInputTokens(text: string): number {
    const ratio = ARABIC_TEXT_PATTERN.test(text)
      ? ARABIC_TOKEN_RATIO
      : DEFAULT_TOKEN_RATIO;

    return Math.ceil(text.length / ratio);
  }

  /**
   * Creates a stable SHA-256 hash for the source prompt template.
   */
  private createTemplateHash(template: string): string {
    return createHash('sha256').update(template).digest('hex');
  }
}
