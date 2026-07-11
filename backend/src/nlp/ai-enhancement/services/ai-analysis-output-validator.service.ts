import { BadGatewayException, Injectable } from '@nestjs/common';

import {
  MAX_AI_EVIDENCE_IDS_PER_ITEM,
  MAX_AI_EXTRACTED_NEEDS,
  MAX_AI_FEATURE_REQUESTS,
  MAX_AI_INSIGHTS,
  MAX_AI_OPPORTUNITIES,
  MAX_AI_RECURRING_PROBLEMS,
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

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_NEED_LENGTH = 500;
const MAX_FEATURE_LENGTH = 500;
const MAX_INSIGHT_LENGTH = 750;
const MAX_EVIDENCE_ID_LENGTH = 150;

const ROOT_PROPERTIES = [
  'recurringProblems',
  'extractedNeeds',
  'featureRequests',
  'opportunities',
  'insights',
  'confidence',
] as const;

const RECURRING_PROBLEM_PROPERTIES = [
  'title',
  'description',
  'severity',
  'supportingEvidenceIds',
] as const;

const NEED_PROPERTIES = [
  'need',
  'confidence',
  'supportingEvidenceIds',
] as const;

const FEATURE_REQUEST_PROPERTIES = [
  'feature',
  'confidence',
  'supportingEvidenceIds',
] as const;

const OPPORTUNITY_PROPERTIES = [
  'title',
  'description',
  'confidence',
  'supportingEvidenceIds',
] as const;

const INSIGHT_PROPERTIES = [
  'insight',
  'confidence',
  'supportingEvidenceIds',
] as const;

/**
 * Validates and normalizes structured output returned by the NLP
 * AI-enhancement client.
 *
 * Validation responsibilities:
 * - Reject non-object or incomplete responses.
 * - Reject undeclared properties.
 * - Enforce configured collection-size limits.
 * - Enforce text-length and numeric-range constraints.
 * - Require at least one evidence identifier per analytical item.
 * - Reject duplicate or unknown evidence identifiers.
 * - Return a fully typed AiEnhancementOutput only after every
 *   validation rule succeeds.
 *
 * This service does not:
 * - Call an AI provider.
 * - Repair malformed responses.
 * - Merge AI output with rule-based analysis.
 * - Persist data.
 *
 * @author Eman
 */
@Injectable()
export class AiAnalysisOutputValidatorService {
  /**
   * Validates one unknown AI response against the NLP enhancement
   * output contract and the evidence supplied to the AI model.
   *
   * @param value Unknown parsed AI response.
   * @param evidence Evidence samples supplied in the original request.
   * @returns Fully validated and normalized AI-enhancement output.
   * @throws {BadGatewayException} When the AI response violates the
   * expected contract or references unsupported evidence.
   */
  validate(
    value: unknown,
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): AiEnhancementOutput {
    const root = this.requireObject(value, '$');

    this.assertExactProperties(root, ROOT_PROPERTIES, '$');

    const validEvidenceIds = this.buildEvidenceIdSet(evidence);

    return {
      recurringProblems: this.validateArray(
        root.recurringProblems,
        '$.recurringProblems',
        MAX_AI_RECURRING_PROBLEMS,
        (item, path) =>
          this.validateRecurringProblem(item, path, validEvidenceIds),
      ),

      extractedNeeds: this.validateArray(
        root.extractedNeeds,
        '$.extractedNeeds',
        MAX_AI_EXTRACTED_NEEDS,
        (item, path) => this.validateNeed(item, path, validEvidenceIds),
      ),

      featureRequests: this.validateArray(
        root.featureRequests,
        '$.featureRequests',
        MAX_AI_FEATURE_REQUESTS,
        (item, path) =>
          this.validateFeatureRequest(item, path, validEvidenceIds),
      ),

      opportunities: this.validateArray(
        root.opportunities,
        '$.opportunities',
        MAX_AI_OPPORTUNITIES,
        (item, path) => this.validateOpportunity(item, path, validEvidenceIds),
      ),

      insights: this.validateArray(
        root.insights,
        '$.insights',
        MAX_AI_INSIGHTS,
        (item, path) => this.validateInsight(item, path, validEvidenceIds),
      ),

      confidence: this.requireScore(root.confidence, '$.confidence'),
    };
  }

  private validateRecurringProblem(
    value: unknown,
    path: string,
    validEvidenceIds: ReadonlySet<string>,
  ): AiEnhancedRecurringProblem {
    const item = this.requireObject(value, path);

    this.assertExactProperties(item, RECURRING_PROBLEM_PROPERTIES, path);

    return {
      title: this.requireString(item.title, `${path}.title`, MAX_TITLE_LENGTH),
      description: this.requireNullableString(
        item.description,
        `${path}.description`,
        MAX_DESCRIPTION_LENGTH,
      ),
      severity: this.requireScore(item.severity, `${path}.severity`),
      supportingEvidenceIds: this.validateEvidenceIds(
        item.supportingEvidenceIds,
        `${path}.supportingEvidenceIds`,
        validEvidenceIds,
      ),
    };
  }

  private validateNeed(
    value: unknown,
    path: string,
    validEvidenceIds: ReadonlySet<string>,
  ): AiEnhancedNeed {
    const item = this.requireObject(value, path);

    this.assertExactProperties(item, NEED_PROPERTIES, path);

    return {
      need: this.requireString(item.need, `${path}.need`, MAX_NEED_LENGTH),
      confidence: this.requireScore(item.confidence, `${path}.confidence`),
      supportingEvidenceIds: this.validateEvidenceIds(
        item.supportingEvidenceIds,
        `${path}.supportingEvidenceIds`,
        validEvidenceIds,
      ),
    };
  }

  private validateFeatureRequest(
    value: unknown,
    path: string,
    validEvidenceIds: ReadonlySet<string>,
  ): AiEnhancedFeatureRequest {
    const item = this.requireObject(value, path);

    this.assertExactProperties(item, FEATURE_REQUEST_PROPERTIES, path);

    return {
      feature: this.requireString(
        item.feature,
        `${path}.feature`,
        MAX_FEATURE_LENGTH,
      ),
      confidence: this.requireScore(item.confidence, `${path}.confidence`),
      supportingEvidenceIds: this.validateEvidenceIds(
        item.supportingEvidenceIds,
        `${path}.supportingEvidenceIds`,
        validEvidenceIds,
      ),
    };
  }

  private validateOpportunity(
    value: unknown,
    path: string,
    validEvidenceIds: ReadonlySet<string>,
  ): AiEnhancedOpportunity {
    const item = this.requireObject(value, path);

    this.assertExactProperties(item, OPPORTUNITY_PROPERTIES, path);

    return {
      title: this.requireString(item.title, `${path}.title`, MAX_TITLE_LENGTH),
      description: this.requireNullableString(
        item.description,
        `${path}.description`,
        MAX_DESCRIPTION_LENGTH,
      ),
      confidence: this.requireScore(item.confidence, `${path}.confidence`),
      supportingEvidenceIds: this.validateEvidenceIds(
        item.supportingEvidenceIds,
        `${path}.supportingEvidenceIds`,
        validEvidenceIds,
      ),
    };
  }

  private validateInsight(
    value: unknown,
    path: string,
    validEvidenceIds: ReadonlySet<string>,
  ): AiEnhancedInsight {
    const item = this.requireObject(value, path);

    this.assertExactProperties(item, INSIGHT_PROPERTIES, path);

    return {
      insight: this.requireString(
        item.insight,
        `${path}.insight`,
        MAX_INSIGHT_LENGTH,
      ),
      confidence: this.requireScore(item.confidence, `${path}.confidence`),
      supportingEvidenceIds: this.validateEvidenceIds(
        item.supportingEvidenceIds,
        `${path}.supportingEvidenceIds`,
        validEvidenceIds,
      ),
    };
  }

  private validateArray<T>(
    value: unknown,
    path: string,
    maxItems: number,
    validateItem: (item: unknown, itemPath: string) => T,
  ): ReadonlyArray<T> {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array.');
    }

    if (value.length > maxItems) {
      this.fail(path, `must contain at most ${maxItems} items.`);
    }

    return value.map((item, index) => validateItem(item, `${path}[${index}]`));
  }

  private validateEvidenceIds(
    value: unknown,
    path: string,
    validEvidenceIds: ReadonlySet<string>,
  ): ReadonlyArray<string> {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array.');
    }

    if (value.length === 0) {
      this.fail(path, 'must contain at least one evidence identifier.');
    }

    if (value.length > MAX_AI_EVIDENCE_IDS_PER_ITEM) {
      this.fail(
        path,
        `must contain at most ${MAX_AI_EVIDENCE_IDS_PER_ITEM} evidence identifiers.`,
      );
    }

    const normalizedIds = value.map((item, index) =>
      this.requireString(item, `${path}[${index}]`, MAX_EVIDENCE_ID_LENGTH),
    );

    if (new Set(normalizedIds).size !== normalizedIds.length) {
      this.fail(path, 'must not contain duplicate evidence identifiers.');
    }

    const unknownId = normalizedIds.find((id) => !validEvidenceIds.has(id));

    if (unknownId !== undefined) {
      this.fail(
        path,
        `contains an evidence identifier that was not supplied: ${unknownId}`,
      );
    }

    return normalizedIds;
  }

  private buildEvidenceIdSet(
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): ReadonlySet<string> {
    const ids = new Set<string>();

    for (const item of evidence) {
      const id = item.id.trim();

      if (id.length === 0) {
        throw new BadGatewayException(
          'AI-enhancement evidence contains an empty identifier.',
        );
      }

      ids.add(id);
    }

    return ids;
  }

  private requireObject(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'must be an object.');
    }

    return value as Record<string, unknown>;
  }

  private assertExactProperties(
    value: Record<string, unknown>,
    allowedProperties: ReadonlyArray<string>,
    path: string,
  ): void {
    const allowed = new Set(allowedProperties);
    const actualProperties = Object.keys(value);

    const missingProperties = allowedProperties.filter(
      (property) => !Object.prototype.hasOwnProperty.call(value, property),
    );

    if (missingProperties.length > 0) {
      this.fail(
        path,
        `is missing required properties: ${missingProperties.join(', ')}`,
      );
    }

    const undeclaredProperties = actualProperties.filter(
      (property) => !allowed.has(property),
    );

    if (undeclaredProperties.length > 0) {
      this.fail(
        path,
        `contains undeclared properties: ${undeclaredProperties.join(', ')}`,
      );
    }
  }

  private requireString(
    value: unknown,
    path: string,
    maxLength: number,
  ): string {
    if (typeof value !== 'string') {
      this.fail(path, 'must be a string.');
    }

    const normalized = value.trim();

    if (normalized.length === 0) {
      this.fail(path, 'must not be empty.');
    }

    if (normalized.length > maxLength) {
      this.fail(path, `must not exceed ${maxLength} characters.`);
    }

    return normalized;
  }

  private requireNullableString(
    value: unknown,
    path: string,
    maxLength: number,
  ): string | null {
    if (value === null) {
      return null;
    }

    return this.requireString(value, path, maxLength);
  }

  private requireScore(value: unknown, path: string): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      this.fail(path, 'must be a finite number in the range [0, 1].');
    }

    return value;
  }

  private fail(path: string, message: string): never {
    throw new BadGatewayException(
      `Invalid NLP AI-enhancement response at ${path}: ${message}`,
    );
  }
}
