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
    const posts = this.selectUniqueEvidence(analyzedTexts).filter(
      (text) =>
        text.sourceType === 'POST' &&
        this.isUsefulDisplayEvidence(text.originalText) &&
        !this.isLikelyPromotionalDescription(text.originalText),
    );

    return posts
      .sort((first, second) => {
        const sentimentDifference =
          this.displayEvidencePriority(second.sentiment) -
          this.displayEvidencePriority(first.sentiment);

        if (sentimentDifference !== 0) {
          return sentimentDifference;
        }

        return second.confidence - first.confidence;
      })
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
          text.postId.trim().length > 0 &&
          this.isUsefulDisplayEvidence(text.originalText),
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
   * Assigns display priority without changing the NLP analysis itself.
   * Negative evidence is most useful on the Evidence tab, followed by
   * positive evidence and then neutral context.
   */
  private displayEvidencePriority(sentiment: Sentiment): number {
    if (sentiment === Sentiment.NEGATIVE) {
      return 3;
    }

    if (sentiment === Sentiment.POSITIVE) {
      return 2;
    }

    return 1;
  }

  /**
   * Hides store-listing and promotional descriptions from representative
   * post samples. This affects display samples only; it does not delete source
   * records, change sentiment counts, or alter ranking evidence.
   */
  private isLikelyPromotionalDescription(text: string): boolean {
    const normalized = text.replace(/\s+/gu, ' ').trim().toLowerCase();

    if (normalized.length < 120) {
      return false;
    }

    const complaintSignal =
      /\b(?:cannot|can't|blocked|missing|error|fails?|failed|broken|problem|issue|does not|doesn't|unavailable|forced to|crash|timeout|slow|bug)\b/iu.test(
        normalized,
      );

    if (complaintSignal) {
      return false;
    }

    const promotionalSignals = [
      /\b(?:welcome to|all-in-one|download (?:the app|now)|app features|main features|with .+ you can)\b/iu,
      /\b(?:award-winning|join our communit|start your learning adventure|make screen time more meaningful)\b/iu,
      /\b(?:watch video lessons|earn certificates|browse course content|track your progress)\b/iu,
      /\b(?:our goal is|our mission is|designed to be|helps? students? to|perfect for)\b/iu,
    ];

    const repositoryBlueprint =
      normalized.length > 900 &&
      /\b(?:rfc|proposal|what i'?m proposing|implementation|architecture|roadmap|pilot centered|who drives it|logistics|should we do this)\b/iu.test(
        normalized,
      );

    return (
      repositoryBlueprint ||
      promotionalSignals.filter((pattern) => pattern.test(normalized)).length >=
        1
    );
  }

  /**
   * Returns true only for text that can help explain a software problem,
   * feature request, access barrier, reliability issue, or concrete user need.
   * Broad social conversation and promotional copy remain stored but are not
   * surfaced as representative evidence.
   */
  private isUsefulDisplayEvidence(text: string): boolean {
    const normalized = text.replace(/\s+/gu, ' ').trim().toLowerCase();

    if (normalized.length < 20) {
      return false;
    }

    const softwareNeedSignal =
      /\b(?:cannot|can't|unable|blocked|missing|unavailable|error|fails?|failed|broken|bug|crash|timeout|slow|does not|doesn't|should|need|request|feature|paywall|subscription|login|authentication|sync|storage|interface|ui|website|app|document|transcript|subject|category|configuration)\b/iu.test(
        normalized,
      );

    const unrelatedConversation =
      /\b(?:love from|invite you|my country|mam |congratulations|beautiful speech|god bless|thank you for this video)\b/iu.test(
        normalized,
      ) &&
      !/\b(?:app|software|platform|website|login|error|feature|subscription|storage|sync)\b/iu.test(
        normalized,
      );

    return softwareNeedSignal && !unrelatedConversation;
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
