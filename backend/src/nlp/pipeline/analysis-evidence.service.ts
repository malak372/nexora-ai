import { Injectable } from '@nestjs/common';

import type { AiEnhancementEvidence } from '../ai-enhancement/types/ai-enhancement-input.type';
import { Sentiment } from '../common/enums/sentiment.enum';

import type { TextAnalysisResult } from './types/intelligent-analysis.types';

const MAX_OUTPUT_POST_SAMPLES = 5;
const MAX_OUTPUT_COMMENT_SAMPLES = 5;
const MAX_AI_ENHANCEMENT_EVIDENCE = 40;

/**
 * Selects representative evidence from analyzed NLP texts.
 *
 * Evidence serves two related but distinct purposes:
 * - Lightweight post and comment samples for the final NLP output.
 * - Traceable evidence objects supplied to optional AI enhancement.
 *
 * Responsibilities:
 * - Select representative analyzed posts.
 * - Select representative analyzed comments.
 * - Rank evidence deterministically by confidence.
 * - Preserve stable source identifiers.
 * - Build provider-neutral AI-enhancement evidence.
 * - Avoid exposing empty or duplicate evidence items.
 *
 * This service does not:
 * - Call external AI providers.
 * - Modify analysis results.
 * - Persist evidence.
 * - Validate AI-generated evidence references.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisEvidenceService {
  /**
   * Extracts representative analyzed posts for the final NLP output.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns High-confidence post samples.
   */
  extractSamplePosts(analyzedTexts: ReadonlyArray<TextAnalysisResult>): Array<{
    id: string;
    text: string;
    sentiment: Sentiment;
  }> {
    return this.selectUniqueEvidence(analyzedTexts)
      .filter((text) => text.sourceType === 'POST')
      .slice(0, MAX_OUTPUT_POST_SAMPLES)
      .map((text) => ({
        id: text.id.trim(),
        text: text.originalText.trim(),
        sentiment: text.sentiment,
      }));
  }

  /**
   * Extracts representative analyzed comments for the final NLP output.
   *
   * Comments without a parent post identifier are excluded because they
   * cannot be traced back to their discussion context.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns High-confidence comment samples.
   */
  extractSampleComments(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): Array<{
    id: string;
    postId: string;
    text: string;
    sentiment: Sentiment;
  }> {
    return this.selectUniqueEvidence(analyzedTexts)
      .filter(
        (
          text,
        ): text is TextAnalysisResult & {
          sourceType: 'COMMENT';
          postId: string;
        } =>
          text.sourceType === 'COMMENT' &&
          typeof text.postId === 'string' &&
          text.postId.trim().length > 0,
      )
      .slice(0, MAX_OUTPUT_COMMENT_SAMPLES)
      .map((text) => ({
        id: text.id.trim(),
        postId: text.postId.trim(),
        text: text.originalText.trim(),
        sentiment: text.sentiment,
      }));
  }

  /**
   * Builds the bounded evidence collection supplied to optional AI
   * enhancement.
   *
   * Empty text, empty identifiers, and duplicate identifiers are excluded.
   * The highest-confidence occurrence is preserved.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Traceable evidence suitable for AiEnhancementInput.
   */
  buildAiEnhancementEvidence(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): ReadonlyArray<AiEnhancementEvidence> {
    return this.selectUniqueEvidence(analyzedTexts)
      .slice(0, MAX_AI_ENHANCEMENT_EVIDENCE)
      .map((text) => ({
        id: text.id.trim(),
        sourceType: text.sourceType,
        text: text.originalText.trim(),
        language: text.language,
      }));
  }

  /**
   * Selects non-empty, unique, deterministically ranked evidence.
   *
   * Duplicate identifiers are resolved by preserving the highest-confidence
   * occurrence.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Ranked and unique evidence records.
   */
  private selectUniqueEvidence(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): TextAnalysisResult[] {
    const selectedEvidence: TextAnalysisResult[] = [];
    const seenIds = new Set<string>();

    for (const text of this.rankEvidence(analyzedTexts)) {
      const id = text.id.trim();
      const originalText = text.originalText.trim();

      if (id.length === 0 || originalText.length === 0 || seenIds.has(id)) {
        continue;
      }

      seenIds.add(id);
      selectedEvidence.push(text);
    }

    return selectedEvidence;
  }

  /**
   * Returns a ranked copy without mutating the original collection.
   *
   * @param analyzedTexts Final analyzed text records.
   * @returns Deterministically ranked text records.
   */
  private rankEvidence(
    analyzedTexts: ReadonlyArray<TextAnalysisResult>,
  ): TextAnalysisResult[] {
    return [...analyzedTexts].sort((first, second) => {
      if (first.confidence !== second.confidence) {
        return second.confidence - first.confidence;
      }

      return first.id.localeCompare(second.id);
    });
  }
}
