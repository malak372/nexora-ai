import { Injectable, Logger } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import { isRepositoryOperationalRecord } from '../common/utils/community-evidence.util';
import { DomainRelevanceService } from '../domain-relevance/domain-relevance.service';
import { LanguageDetectionService } from '../language-detection/language-detection.service';
import {
  type CleanTextResult,
  TextCleaningService,
} from '../text-cleaning/text-cleaning.service';

import type {
  IntelligentTextInput,
  ResolvedLanguageCode,
  TextAnalysisResult,
} from './types/intelligent-analysis.types';

/**
 * Represents a cleaned and validated text item ready for deeper NLP analysis.
 *
 * This type preserves the original metadata from the collected post or comment
 * while adding preprocessing results such as cleaned text, resolved language,
 * and domain-relevance information.
 *
 * @author Eman
 */
export type PreprocessedTextInput = IntelligentTextInput & {
  /**
   * Original raw text and its cleaned representation.
   */
  cleaning: CleanTextResult;

  /**
   * Final specific language used by the NLP pipeline.
   *
   * LanguageCode.ANY is not allowed here because every text forwarded to
   * language-aware analysis must have a specific supported language.
   */
  finalLanguage: ResolvedLanguageCode;

  /**
   * Relevance score in the range [0, 1] showing how strongly the text
   * matches the selected software domain.
   */
  relevanceScore: number;

  /**
   * Confidence score in the range [0, 1] produced by domain-relevance
   * analysis.
   */
  relevanceConfidence: number;

  /**
   * Single-word domain keywords matched in the cleaned text.
   */
  matchedKeywords: readonly string[];

  /**
   * Multi-word domain phrases matched in the cleaned text.
   */
  matchedPhrases: readonly string[];
};

/**
 * Internal preprocessing result containing the prepared text and its
 * domain-relevance decision.
 *
 * The relevance flag remains internal and is not forwarded to later
 * NLP pipeline stages.
 *
 * @author Eman
 */
type RelevanceEvaluatedText = {
  readonly text: PreprocessedTextInput;
  readonly isRelevant: boolean;
};

/**
 * Summary returned after preprocessing collected community texts.
 *
 * This summary is used later by the intelligent NLP pipeline to calculate
 * data quality, build transparent analysis outputs, and provide reliable
 * community evidence for prompt generation.
 *
 * @author Eman
 */
export type TextPreprocessingOutput = {
  /**
   * Text inputs that passed cleaning, duplicate filtering,
   * language resolution, and domain-relevance filtering.
   */
  texts: PreprocessedTextInput[];

  /**
   * Number of empty texts removed after cleaning.
   */
  emptyTextsRemoved: number;

  /**
   * Number of duplicate texts removed after normalization.
   */
  duplicateTextsRemoved: number;

  /**
   * Number of texts removed because a specific supported language
   * could not be resolved reliably.
   */
  unresolvedLanguageTextsRemoved: number;

  /**
   * Number of texts removed because they were not related to the
   * selected domain.
   */
  irrelevantTextsRemoved: number;

  /**
   * Initial per-text analysis records used for debugging and auditing.
   *
   * Later NLP services enrich these records with sentiment, lexicon matches,
   * extracted insights, and confidence values.
   */
  initialAnalysisResults: TextAnalysisResult[];
};

/**
 * Internal item produced after cleaning and duplicate filtering.
 *
 * @author Eman
 */
type CleanedTextItem = {
  readonly input: IntelligentTextInput;
  readonly cleaning: CleanTextResult;
};

/**
 * Internal item containing a cleaned text and its successfully
 * resolved language.
 *
 * @author Eman
 */
type LanguageResolvedTextItem = CleanedTextItem & {
  readonly finalLanguage: ResolvedLanguageCode;
};

/**
 * Preprocesses unified text inputs before deeper NLP analysis.
 *
 * This service receives unified post and comment inputs produced by
 * TextInputBuilderService and prepares them for:
 * - Lexicon analysis.
 * - Keyword extraction.
 * - Topic extraction.
 * - Recurring-problem detection.
 * - Need and opportunity extraction.
 * - Optional AI enhancement.
 *
 * Responsibilities:
 * - Clean raw post and comment content.
 * - Remove empty and duplicate texts.
 * - Resolve a specific supported language for every accepted text.
 * - Exclude texts whose language cannot be resolved reliably.
 * - Filter unrelated texts using selected-domain keywords.
 * - Preserve relevance metadata for later confidence calculations.
 * - Produce initial analysis records for auditing and observability.
 *
 * This service does not:
 * - Perform sentiment analysis.
 * - Extract keywords or topics.
 * - Generate analytical insights.
 * - Call external AI services.
 * - Persist NLP analysis.
 *
 * @author Eman
 */
@Injectable()
export class TextPreprocessingService {
  private static readonly MAX_FAST_ANALYSIS_TEXTS = 30;
  private static readonly MAX_FINAL_EVIDENCE_TEXTS = 20;

  private readonly logger = new Logger(TextPreprocessingService.name);

  constructor(
    private readonly textCleaningService: TextCleaningService,
    private readonly languageDetectionService: LanguageDetectionService,
    private readonly domainRelevanceService: DomainRelevanceService,
  ) {}

  /**
   * Runs preprocessing for collected posts and comments.
   *
   * Individual texts whose language cannot be resolved are excluded instead
   * of terminating the complete NLP analysis. Community sources can contain
   * short identifiers, code fragments, links, emoji-only comments, or mixed
   * language content that cannot be classified reliably.
   *
   * @param inputs Unified post and comment inputs.
   * @param domainKeywords Domain keywords used to evaluate relevance.
   * @returns Cleaned, deduplicated, language-aware, and relevant texts.
   */
  process(
    inputs: ReadonlyArray<IntelligentTextInput>,
    domainKeywords: ReadonlyArray<string>,
    fallbackLanguage: LanguageCode = LanguageCode.EN,
  ): TextPreprocessingOutput {
    const selectedInputs = this.selectFastAnalysisInputs(inputs);

    const cleanedItems: CleanedTextItem[] = selectedInputs.map((input) => ({
      input,
      /*
       * A short complaint comment often contains the actual user problem while
       * the parent post title carries the selected-domain signal. Analyze both
       * together so useful comments are not discarded merely because the
       * comment itself says only "it crashes" or "this does not work".
       */
      cleaning: this.textCleaningService.clean(
        this.buildContextualAnalysisText(input),
      ),
    }));

    const nonEmptyItems = cleanedItems.filter((item) => !item.cleaning.isEmpty);

    const emptyTextsRemoved = cleanedItems.length - nonEmptyItems.length;

    const uniqueItems = this.removeDuplicateItems(nonEmptyItems);

    const duplicateTextsRemoved = nonEmptyItems.length - uniqueItems.length;

    const languageResolvedItems = this.resolveItemLanguages(
      uniqueItems,
      fallbackLanguage,
    );

    const unresolvedLanguageTextsRemoved =
      uniqueItems.length - languageResolvedItems.length;

    const contentFilteredItems = languageResolvedItems.filter((item) => {
      const collectorProtectedComment =
        item.input.sourceType === 'COMMENT' &&
        item.input.isComplaintEvidence === true;

      /*
       * The central collector already classified this exact comment as one of
       * the complaintComments=N records. Preserve that decision through NLP
       * instead of trying to rediscover it with a second, slightly different
       * regex. Empty/duplicate/language checks have already run above.
       */
      if (collectorProtectedComment) {
        return this.isDirectUserCommentEvidence(item.input.content);
      }

      if (this.isTechnicalNoise(item.cleaning.cleanedText)) {
        return false;
      }

      /*
       * Parent titles are intentionally included in comment context so short
       * comments can inherit the selected-domain signal. A promotional parent
       * title must not, however, cause a genuine user complaint to be removed.
       * Evaluate the raw comment independently before applying publisher-copy
       * rejection to the combined contextual text.
       */
      if (
        item.input.sourceType === 'COMMENT' &&
        this.isDirectUserCommentEvidence(item.input.content)
      ) {
        return true;
      }

      return !this.isNonComplaintContext(item.cleaning.cleanedText);
    });
    const technicalNoiseTextsRemoved =
      languageResolvedItems.length - contentFilteredItems.length;

    const evaluatedTexts: RelevanceEvaluatedText[] = contentFilteredItems.map(
      (item) => {
        const relevance = this.domainRelevanceService.analyze(
          item.cleaning.cleanedText,
          domainKeywords,
        );

        const text: PreprocessedTextInput = {
          ...item.input,
          cleaning: item.cleaning,
          finalLanguage: item.finalLanguage,
          relevanceScore: relevance.score,
          relevanceConfidence: relevance.confidence,
          matchedKeywords: relevance.matchedKeywords,
          matchedPhrases: relevance.matchedPhrases,
        };

        return {
          text,
          isRelevant: relevance.isRelevant,
        };
      },
    );

    /*
     * Collection relevance is the first gate, while this NLP-side check is a
     * defensive second gate. Collectors can still persist short replies,
     * emotional text, or generic error messages that contain no domain signal.
     * Fail open only when no domain keywords are configured.
     */
    const shouldApplyRelevanceFilter = domainKeywords.some(
      (keyword) => keyword.trim().length > 0,
    );
    /*
     * Use one internal balanced policy for every user. The API intentionally
     * exposes no STRICT/BALANCED/BROAD option.
     *
     * Strongly relevant texts always pass. Borderline texts are retained only
     * when they contain concrete complaint, need, failure, or feature-request
     * evidence and still have a minimum domain signal. This improves recall
     * without forwarding the complete noisy corpus to the AI layer.
     */
    const relevantItems = shouldApplyRelevanceFilter
      ? evaluatedTexts.filter(
          (item) =>
            item.text.isComplaintEvidence === true ||
            item.isRelevant ||
            this.shouldRetainBorderlineEvidence(item.text),
        )
      : evaluatedTexts;
    let relevantTexts = relevantItems.map((item) => item.text);

    const collectorProtectedRetained = relevantTexts.filter(
      (text) =>
        text.sourceType === 'COMMENT' && text.isComplaintEvidence === true,
    ).length;
    if (collectorProtectedRetained > 0) {
      this.logger.debug(
        `Retained ${collectorProtectedRetained} collector-protected complaint comment(s) through NLP preprocessing.`,
      );
    }

    /*
     * A direct complaint comment must not disappear merely because another
     * contextual post already passed the strict relevance filter. Earlier this
     * recovery ran only when relevantTexts was empty, which allowed a single
     * surviving post to suppress stronger complaint comments. Preserve a small,
     * bounded set of traceable direct comments on every pass.
     */
    const retainedIds = new Set(relevantTexts.map((text) => text.id));
    const protectedDirectComments = evaluatedTexts
      .map((item) => item.text)
      .filter(
        (text) =>
          text.sourceType === 'COMMENT' &&
          !retainedIds.has(text.id) &&
          this.isDirectUserCommentEvidence(text.content) &&
          this.hasMinimumContextualDomainSignal(text),
      )
      .sort(
        (first, second) =>
          this.contextualEvidencePriority(second) -
            this.contextualEvidencePriority(first) ||
          second.relevanceScore - first.relevanceScore,
      )
      .slice(0, 12);

    if (protectedDirectComments.length > 0) {
      relevantTexts = [...relevantTexts, ...protectedDirectComments];
      for (const comment of protectedDirectComments) {
        retainedIds.add(comment.id);
      }
      this.logger.debug(
        `Protected ${protectedDirectComments.length} direct complaint/request comment(s) from strict NLP relevance pruning.`,
      );
    }

    /*
     * A fast run must not collapse a non-empty collected corpus to zero merely
     * because short complaint comments depend on their parent title for domain
     * context. When the strict relevance pass retains nothing, recover only
     * concrete complaint/request records whose contextual analysis text still
     * contains a selected-domain signal. This is bounded and evidence-driven;
     * it does not forward the complete noisy corpus to the AI provider.
     */
    if (relevantTexts.length === 0 && evaluatedTexts.length > 0) {
      const allEvaluatedTexts = evaluatedTexts.map((item) => item.text);
      const complaintCandidates = allEvaluatedTexts.filter((text) =>
        this.isRecoverableContextualEvidence(text),
      );
      const boundedFallbackPool =
        complaintCandidates.length > 0
          ? complaintCandidates
          : allEvaluatedTexts.filter((text) =>
              this.isSafeMinimumFallbackEvidence(text),
            );

      relevantTexts = boundedFallbackPool
        .sort((first, second) => {
          const firstComment = first.sourceType === 'COMMENT' ? 1 : 0;
          const secondComment = second.sourceType === 'COMMENT' ? 1 : 0;
          const firstEvidence = this.contextualEvidencePriority(first);
          const secondEvidence = this.contextualEvidencePriority(second);
          return (
            secondEvidence - firstEvidence ||
            secondComment - firstComment ||
            second.relevanceScore - first.relevanceScore
          );
        })
        .slice(0, 12);

      if (relevantTexts.length > 0) {
        this.logger.warn(
          `Strict NLP relevance retained zero texts; recovered ${relevantTexts.length} contextual complaint/request evidence text(s) instead of discarding the collected corpus.`,
        );
      }
    }

    /*
     * A strict relevance pass can be technically correct yet too destructive
     * for discovery (for example 90+ collected records collapsing to 2-3
     * texts). Top up a sparse result from the already-cleaned/evaluated corpus
     * using only concrete complaint/request/privacy/performance/reliability
     * signals. This adds no provider call and keeps the AI payload bounded.
     */
    const minimumEvidenceTarget = Math.min(
      12,
      TextPreprocessingService.MAX_FINAL_EVIDENCE_TEXTS,
    );
    if (relevantTexts.length < minimumEvidenceTarget) {
      const currentIds = new Set(relevantTexts.map((text) => text.id));
      const topUpCandidates = evaluatedTexts
        .map((item) => item.text)
        .filter((text) => !currentIds.has(text.id))
        .filter((text) => this.isDiscoveryEvidenceCandidate(text))
        .sort(
          (first, second) =>
            this.contextualEvidencePriority(second) -
              this.contextualEvidencePriority(first) ||
            second.relevanceScore - first.relevanceScore,
        );

      for (const candidate of topUpCandidates) {
        if (relevantTexts.length >= minimumEvidenceTarget) break;
        relevantTexts.push(candidate);
        currentIds.add(candidate.id);
      }

      if (topUpCandidates.length > 0) {
        this.logger.debug(
          `Evidence top-up retained ${relevantTexts.length} bounded discovery text(s) after strict relevance filtering.`,
        );
      }
    }

    /*
     * Keep the synchronous/AI corpus broad enough to cover several problem
     * families, but bounded enough for a sub-minute generation target. Avoid
     * letting one video/thread or one problem family monopolize all 20 slots.
     */
    relevantTexts = this.selectDiverseFinalEvidence(
      relevantTexts,
      TextPreprocessingService.MAX_FINAL_EVIDENCE_TEXTS,
    );

    const irrelevantTextsRemoved =
      evaluatedTexts.length - relevantTexts.length + technicalNoiseTextsRemoved;

    if (irrelevantTextsRemoved > 0) {
      this.logger.debug(
        `Removed ${irrelevantTextsRemoved} off-domain or technical-noise text(s) before evidence extraction.`,
      );
    }

    if (unresolvedLanguageTextsRemoved > 0) {
      this.logger.debug(
        `Removed ${unresolvedLanguageTextsRemoved} text(s) because a specific supported language could not be resolved.`,
      );
    }

    return {
      texts: relevantTexts,
      emptyTextsRemoved,
      duplicateTextsRemoved,
      unresolvedLanguageTextsRemoved,
      irrelevantTextsRemoved,
      initialAnalysisResults: this.buildInitialAnalysisResults(relevantTexts),
    };
  }


  /**
   * Keeps a broad, evidence-ranked corpus for the synchronous evidence-preparation pass
   * pass. This prevents long repository comments and low-signal records from
   * multiplying the cost of language detection, regex filters, lexicon scans,
   * problem extraction, and confidence calculations.
   *
   * Posts are preferred, then concrete complaint/request signals and engagement.
   * Up to fourteen high-signal posts and comments are retained so the AI receives broad evidence without allowing an unbounded corpus.
   */
  private selectFastAnalysisInputs(
    inputs: ReadonlyArray<IntelligentTextInput>,
  ): IntelligentTextInput[] {
    if (inputs.length <= TextPreprocessingService.MAX_FAST_ANALYSIS_TEXTS) {
      return [...inputs];
    }

    const evidencePattern =
      /\b(?:cannot|can't|unable|missing|unavailable|difficult|confusing|slow|lag|latency|crash|freeze|error|fails?|failed|broken|problem|issue|bug|blocked|inaccurate|wrong|hallucinat(?:e|es|ed|ion)|unsafe|security|privacy|need|needs|should|please add|feature request|wish)\b/iu;

    const ranked = inputs
      .map((input, index) => {
        const contextualText = this.buildContextualAnalysisText(input);
        const evidenceBonus =
          input.isComplaintEvidence === true
            ? 1_000
            : evidencePattern.test(contextualText)
              ? 120
              : 0;
        /*
         * Complaint comments receive priority over generic post titles. Posts
         * still remain represented so every retained comment keeps context and
         * the NLP stage does not become comment-only.
         */
        const sourceBonus = input.sourceType === 'COMMENT' ? 55 : 35;
        const engagement =
          Math.min(Math.max(input.likesCount ?? 0, 0), 25) +
          Math.min(Math.max(input.repliesCount ?? 0, 0), 25);

        return {
          input,
          index,
          score: evidenceBonus + sourceBonus + engagement,
        };
      })
      .sort(
        (first, second) =>
          second.score - first.score || first.index - second.index,
      );

    const selected: IntelligentTextInput[] = [];
    const selectedIds = new Set<string>();

    const take = (sourceType: 'POST' | 'COMMENT', limit: number): void => {
      for (const entry of ranked) {
        if (selected.length >= TextPreprocessingService.MAX_FAST_ANALYSIS_TEXTS) {
          break;
        }
        if (
          entry.input.sourceType !== sourceType ||
          selectedIds.has(entry.input.id)
        ) {
          continue;
        }
        const currentCount = selected.filter(
          (item) => item.sourceType === sourceType,
        ).length;
        if (currentCount >= limit) break;
        selected.push(entry.input);
        selectedIds.add(entry.input.id);
      }
    };

    take('COMMENT', 20);
    take('POST', 10);

    for (const entry of ranked) {
      if (selected.length >= TextPreprocessingService.MAX_FAST_ANALYSIS_TEXTS) {
        break;
      }
      if (!selectedIds.has(entry.input.id)) {
        selected.push(entry.input);
        selectedIds.add(entry.input.id);
      }
    }

    return selected;
  }

  /**
   * Builds the text used only for relevance and evidence extraction. The raw
   * database content is preserved on the input object for auditing.
   */
  private buildContextualAnalysisText(input: IntelligentTextInput): string {
    const title = input.title?.replace(/\s+/gu, ' ').trim() ?? '';
    const content = input.content.replace(/\s+/gu, ' ').trim();

    if (input.sourceType === 'COMMENT' && title && content) {
      return `${title}. Community comment: ${content}`;
    }

    return title && content && !content.toLowerCase().includes(title.toLowerCase())
      ? `${title}. ${content}`
      : content || title;
  }


  /**
   * Recognizes a concrete user-authored complaint/request from the raw comment
   * body. This deliberately ignores the parent post title so promotional video
   * metadata cannot suppress useful comment evidence.
   */
  private isDirectUserCommentEvidence(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim().toLowerCase();
    if (normalized.length < 12) {
      return false;
    }

    const explicitPainOrRequest =
      /\b(?:cannot|can'?t|cant|unable|not working|does not work|doesn't work|crash(?:es|ed|ing)?|freeze|slow|lag|latency|error|fail(?:s|ed|ing)?|broken|bug|blocked|missing|inaccurate|wrong|unsafe|security|privacy|cost|billing|bill|charged|confusing|difficult|frustrating|struggle|please add|feature request|should add|why can'?t i|how can i)\b/iu.test(normalized) ||
      /\b(?:i|we|my|our|user|users|customer|customers|operator|operators|learner|learners)\b[^.!?]{0,60}\b(?:need|needs)\b/iu.test(normalized) ||
      /\bi wish\b[^.!?]{0,80}\b(?:app|platform|service|feature|option|setting|support|allow|let|could|would|had|add|include)\b/iu.test(normalized);

    const comprehensionOrPraiseOnly =
      /\b(?:i (?:think i )?(?:understand|get it)|makes sense|so much easier|helped me understand|great explanation|thank you|thanks|love this|amazing|awesome)\b/iu.test(normalized) &&
      !/\b(?:cannot|can'?t|unable|not working|error|fail|broken|bug|missing|wrong|confusing|difficult|frustrating|struggle|need)\b/iu.test(normalized) &&
      !/\bi wish\b[^.!?]{0,80}\b(?:app|platform|service|feature|option|setting|support|allow|let|could|would|had|add|include)\b/iu.test(normalized);
    const positiveRecommendationOnly =
      /\b(?:highly recommend|recommend(?:ed|ing)?|great company|great app|excellent|works great|very satisfied|five stars?|5 stars?|love (?:the|this) app)\b/iu.test(normalized) &&
      !/\b(?:cannot|can'?t|unable|does(?:n'?t| not) work|not working|error|fail(?:s|ed|ing)?|broken|bug|missing|incorrect|wrong|crash|freeze|slow|confusing|difficult|frustrating|struggle|support|refund|withdraw)\b/iu.test(normalized);

    const purePromotion =
      /\b(?:check out|download|install|subscribe|link in (?:the )?description|use my code|sponsored|available now|try it|watch the full|app review|review of)\b/iu.test(normalized) &&
      !explicitPainOrRequest;

    return explicitPainOrRequest && !comprehensionOrPraiseOnly && !positiveRecommendationOnly && !purePromotion;
  }

  /**
   * Retains useful borderline evidence under the single internal balanced
   * filtering policy.
   *
   * A text must have:
   * - A minimum domain-relevance score.
   * - At least one matched domain keyword or phrase.
   * - A concrete user-problem or requested-improvement signal.
   *
   * Promotional descriptions, implementation tickets, and technical noise are
   * already removed before this method is evaluated.
   */
  /**
   * Allows a direct complaint comment to inherit domain context from its parent
   * title without treating completely unrelated comments as domain evidence.
   */
  private hasMinimumContextualDomainSignal(text: PreprocessedTextInput): boolean {
    const genericTerms = new Set([
      'app', 'application', 'platform', 'software', 'system', 'service', 'technology',
      'management', 'monitoring', 'automation', 'optimization', 'prediction',
      'recommendation', 'integration', 'analytics', 'dashboard', 'workflow',
      'problem', 'problems', 'tool', 'tools',
    ]);

    const specificKeyword = text.matchedKeywords.some(
      (term) => !genericTerms.has(term.toLowerCase()),
    );
    const specificPhrase = text.matchedPhrases.some((phrase) => {
      const tokens = phrase.toLowerCase().split(/\s+/u);
      return tokens.some((token) => token.length >= 4 && !genericTerms.has(token));
    });

    return specificKeyword || specificPhrase;
  }

  private shouldRetainBorderlineEvidence(text: PreprocessedTextInput): boolean {
    const normalized = text.cleaning.cleanedText.toLowerCase();

    const hasDomainSignal =
      text.matchedKeywords.length > 0 || text.matchedPhrases.length > 0;

    if (!hasDomainSignal || text.relevanceScore < 0.2) {
      return false;
    }

    const evidenceSignals = [
      'cannot',
      "can't",
      'unable',
      'not working',
      'does not work',
      "doesn't work",
      'missing',
      'unavailable',
      'forced to',
      'difficult',
      'hard to',
      'confusing',
      'slow',
      'lag',
      'latency',
      'privacy',
      'security',
      'inaccurate',
      'wrong',
      'deleted',
      'crash',
      'error',
      'fails',
      'failed',
      'problem',
      'issue',
      'bug',
      'blocked',
      'needs ',
      'need ',
      'should ',
      'please add',
      'please improve',
      'feature request',
      'wish ',
    ];

    return evidenceSignals.some((signal) => normalized.includes(signal));
  }


  /**
   * Recovers a bounded complaint/request record after an otherwise empty strict
   * pass. Parent-title context is already present in cleanedText for comments.
   */
  private isRecoverableContextualEvidence(text: PreprocessedTextInput): boolean {
    const normalized = text.cleaning.cleanedText.toLowerCase();
    const hasDomainSignal =
      text.matchedKeywords.length > 0 ||
      text.matchedPhrases.length > 0 ||
      text.relevanceScore >= 0.12;
    if (text.sourceType === 'COMMENT') {
      return (
        this.isDirectUserCommentEvidence(text.content) &&
        this.hasMinimumContextualDomainSignal(text)
      );
    }

    const hasConcreteEvidence =
      /\b(?:cannot|can't|unable|not working|does not work|doesn't work|crash(?:es|ed|ing)?|freeze|slow|lag|latency|error|fail(?:s|ed|ing)?|broken|issue|bug|blocked|missing|inaccurate|wrong|unsafe|security|privacy|need|needs|please add|feature request|wish)\b/iu.test(
        normalized,
      );

    return hasDomainSignal && hasConcreteEvidence;
  }


  /**
   * Last-resort bounded evidence retention for a non-empty collected corpus.
   * This path is used only when every stricter relevance rule removed the
   * complete sample. It keeps traceable natural-language records and never
   * forwards code-heavy or machine-generated operational noise.
   */
  private isSafeMinimumFallbackEvidence(text: PreprocessedTextInput): boolean {
    const normalized = text.cleaning.cleanedText.replace(/\s+/gu, ' ').trim();
    if (normalized.length < 24 || normalized.length > 1800) {
      return false;
    }
    if (this.isTechnicalNoise(normalized) || this.isNonComplaintContext(normalized)) {
      return false;
    }
    if (text.sourceType === 'COMMENT') {
      return (
        this.isDirectUserCommentEvidence(text.content) &&
        this.hasMinimumContextualDomainSignal(text)
      );
    }

    return text.relevanceScore >= 0.05;
  }

  /**
   * Accepts concrete discovery evidence even when strict domain relevance is
   * borderline. The text has already passed language, duplicate, publisher-copy
   * and technical-noise filtering before reaching this method.
   */
  private isDiscoveryEvidenceCandidate(text: PreprocessedTextInput): boolean {
    const normalized = `${text.title ?? ''} ${text.content}`
      .replace(/\s+/gu, ' ')
      .toLowerCase();
    const concreteSignal = /\b(?:cannot|can't|unable|not working|does not work|crash(?:es|ed|ing)?|freeze|slow|lag|latency|error|fail(?:s|ed|ing)?|broken|problem|issue|bug|blocked|missing|deleted|inaccurate|wrong|hallucinat(?:e|es|ed|ion)|unsafe|security|privacy|permission|history|need|needs|should|please add|please improve|feature request|wish|frustrat(?:e|ed|ing))\b/iu.test(normalized);
    if (!concreteSignal) return false;

    if (text.sourceType === 'COMMENT' && this.isDirectUserCommentEvidence(text.content)) {
      return true;
    }

    return (
      text.isComplaintEvidence === true ||
      text.relevanceScore >= 0.05 ||
      text.matchedKeywords.length > 0 ||
      text.matchedPhrases.length > 0
    );
  }

  /**
   * Produces a deterministic, diverse final evidence set. At most two comments
   * from the same parent thread are retained during the first pass and each
   * major problem family receives representation before remaining slots are
   * filled by overall evidence strength.
   */
  private selectDiverseFinalEvidence(
    texts: ReadonlyArray<PreprocessedTextInput>,
    limit: number,
  ): PreprocessedTextInput[] {
    if (texts.length <= limit) return [...texts];

    const ranked = [...texts].sort(
      (first, second) =>
        this.contextualEvidencePriority(second) -
          this.contextualEvidencePriority(first) ||
        second.relevanceScore - first.relevanceScore,
    );
    const selected: PreprocessedTextInput[] = [];
    const selectedIds = new Set<string>();
    const threadCounts = new Map<string, number>();
    const familyCounts = new Map<string, number>();

    const familyOf = (text: PreprocessedTextInput): string => {
      const value = `${text.title ?? ''} ${text.content}`.toLowerCase();
      if (/privacy|permission|consent|deleted.*history|data exposure/iu.test(value)) return 'privacy';
      if (/slow|lag|latency|timeout|performance/iu.test(value)) return 'performance';
      if (/crash|freeze|broken|not working|fail|error|stability|reliab/iu.test(value)) return 'reliability';
      if (/inaccurate|wrong|hallucinat|incorrect|quality/iu.test(value)) return 'accuracy';
      if (/feature request|please add|please improve|wish|need|should/iu.test(value)) return 'request';
      return 'other';
    };

    const tryAdd = (text: PreprocessedTextInput, enforceFamilyCap: boolean): boolean => {
      if (selectedIds.has(text.id) || selected.length >= limit) return false;
      const threadKey = text.postId ?? (text.sourceType === 'POST' ? text.id : 'orphan-comment');
      const threadCount = threadCounts.get(threadKey) ?? 0;
      if (threadCount >= 2) return false;
      const family = familyOf(text);
      const familyCount = familyCounts.get(family) ?? 0;
      if (enforceFamilyCap && familyCount >= 4) return false;
      selected.push(text);
      selectedIds.add(text.id);
      threadCounts.set(threadKey, threadCount + 1);
      familyCounts.set(family, familyCount + 1);
      return true;
    };

    for (const family of ['reliability', 'privacy', 'performance', 'accuracy', 'request', 'other']) {
      for (const text of ranked) {
        if (familyOf(text) === family) {
          tryAdd(text, true);
          if ((familyCounts.get(family) ?? 0) >= 2 || selected.length >= limit) break;
        }
      }
    }

    for (const text of ranked) {
      if (selected.length >= limit) break;
      tryAdd(text, true);
    }
    for (const text of ranked) {
      if (selected.length >= limit) break;
      tryAdd(text, false);
    }

    return selected;
  }

  /** Ranks bounded fallback evidence without another provider call. */
  private contextualEvidencePriority(text: PreprocessedTextInput): number {
    const normalized = text.cleaning.cleanedText.toLowerCase();
    const collectorProtected = text.isComplaintEvidence === true ? 20 : 0;
    const complaint = /\b(?:cannot|can't|unable|not working|does not work|crash|freeze|slow|lag|latency|error|fail|failed|broken|problem|issue|bug|blocked|missing|inaccurate|wrong|unsafe|security|privacy|need|should|feature request|wish)\b/iu.test(normalized) ? 5 : 0;
    const traceableComment = text.sourceType === 'COMMENT' && Boolean(text.postId) ? 3 : 0;
    return collectorProtected + complaint + traceableComment + Math.min(text.relevanceScore * 10, 2);
  }

  /**
   * Rejects code-heavy troubleshooting content that happens to contain broad
   * domain words such as "application", "system", or "student". Such records
   * are useful to developer forums but are not reliable community evidence for
   * discovering an end-user problem in the selected domain.
   */
  private isTechnicalNoise(text: string): boolean {
    const normalized = text.toLowerCase();

    if (isRepositoryOperationalRecord(text)) {
      return true;
    }

    /*
     * Repository data-contract and implementation investigations can contain
     * isolated natural-language fragments such as "an address cannot do
     * that". Those fragments must never become end-user navigation evidence.
     */
    const isRepositoryInvestigation =
      /\b(?:split out of|the mechanism|what would unblock it|not in scope|target architecture|phased build|build skills|depends on)\b/iu.test(
        normalized,
      ) &&
      /\b(?:stg_|rpt_|safe_offset|pydantic|avro|schema|endpoint|sql|pull request|issue|#\d+)\b/iu.test(
        normalized,
      );

    const isMachineOperationalReceipt =
      /\b(?:read-only production api receipts?|expected surfaces?|claimed=|saved modules?|missing modules?|attemptedmodules|persisted\.sheet|http 200|finite evening occurrence|wider freeze holds?)\b/iu.test(
        normalized,
      );

    const isRepositoryStatusOrRunbook =
      /\b(?:upstream contribution status|still open|merged|pull request|fixture|negative contract|sole qb|authorized to proceed|runbook|deployment receipt)\b/iu.test(
        normalized,
      ) &&
      /\b(?:github|repository|commit|branch|pr|#\d+|api|http|yaml|config|test)\b/iu.test(
        normalized,
      );

    const isAppStoreMarketingDescription =
      /\b(?:download now|why choose us|key features|welcome to .*your all-in-one|our goal is|with .* you can|we are committed to)\b/iu.test(
        normalized,
      ) &&
      !/\b(?:cannot|can't|unable|blocked|error|fails?|broken|missing|unavailable|does not|doesn't|should|request|problem|issue)\b/iu.test(
        normalized,
      );

    /**
     * Rejects educational media titles where "Crash Course" is a brand or
     * lesson-series name, not an application failure. This must happen before
     * deterministic problem extraction because removing the phrase only from
     * keyword extraction does not prevent a false reliability problem.
     */
    const isCrashCourseEducationalMedia =
      /\bcrash course\b/iu.test(normalized) &&
      /\b(?:sociology|history|biology|chemistry|physics|psychology|economics|literature|education|episode|lesson|today we(?:'ll| will) explore)\b/iu.test(
        normalized,
      ) &&
      !/\b(?:app|application|platform|software|website|system)\b[^.!?\n]{0,80}\b(?:crash(?:es|ed|ing)?|freeze|frozen)\b/iu.test(
        normalized,
      );

    /**
     * Rejects repository authorization/checklist receipts that describe
     * packages, branches, checksums, tests, or deployment blockers rather than
     * an independently observed learner problem.
     */
    const isRepositoryAuthorizationChecklist =
      /\b(?:remaining hard blockers?|ratification|exact package\/?model versions?|checksums?|draft pr authorization|current-main|allowlist|non-synthetic use)\b/iu.test(
        normalized,
      ) &&
      /\b(?:branch|tests?|licenses?|dependency|cpu compatibility|privacy|retention|deletion|incident profile|#\d+)\b/iu.test(
        normalized,
      );

    if (
      isRepositoryInvestigation ||
      isMachineOperationalReceipt ||
      isRepositoryStatusOrRunbook ||
      isAppStoreMarketingDescription ||
      isCrashCourseEducationalMedia ||
      isRepositoryAuthorizationChecklist
    ) {
      return true;
    }

    const hardTechnicalSignals = [
      'connectionstrings',
      'stacktrace',
      'nullpointerexception',
      'dotnet ef',
      'msbuild',
      'scaffolding',
      'package com.',
      'public class ',
      'requestmapping',
      'servlet',
      'begin;',
      'insert into ',
      'delete from ',
      'select * from ',
      'residual stream',
      'parameter-space bottleneck',
      'layer-sensitivity',
      'tokens per second',
      'vram footprint',
      'calibration dataset',
      'goal divergence index',
      'privateexactsha',
      'expectedbasesha',
      'expectedchangedfilecount',
      'validationprofile',
      'destructive resets',
      'sql e2e',
    ];
    const hardSignalCount = hardTechnicalSignals.filter((signal) =>
      normalized.includes(signal),
    ).length;

    const structuralSignalCount =
      (normalized.match(/[{};<>]/gu)?.length ?? 0) +
      (normalized.match(/```/gu)?.length ?? 0) * 3 +
      (normalized.match(/\b(?:class|void|public|private|import|package)\b/gu)
        ?.length ?? 0);

    const longResearchLikeText =
      normalized.length > 3_500 &&
      [
        'report',
        'methodology',
        'ablation',
        'benchmark',
        'architecture',
        'dataset',
        'hypothesis',
      ].filter((signal) => normalized.includes(signal)).length >= 3;

    return (
      hardSignalCount >= 2 ||
      structuralSignalCount >= 12 ||
      longResearchLikeText
    );
  }

  /**
   * Rejects domain-adjacent material that is not usable community evidence.
   *
   * The rule distinguishes first-person complaints from promotional copy,
   * political news, repository governance records, research reports, and
   * third-party developer-program failures that only contain broad words such
   * as "student" or "education".
   */
  private isNonComplaintContext(text: string): boolean {
    const normalized = text.toLowerCase();

    const firstPersonSignals = [
      ' i ',
      " i'm ",
      " i've ",
      ' my ',
      ' me ',
      ' we ',
      ' our ',
      'cannot',
      "can't",
      'unable',
      'stuck',
      'forced to',
      'keeps ',
      'does not ',
      "doesn't ",
    ];
    const hasFirstPersonExperience = firstPersonSignals.some((signal) =>
      ` ${normalized} `.includes(signal),
    );

    const actionableFeedbackSignals = [
      'problem',
      'issue',
      'bug',
      'error message',
      'fails',
      'failed',
      'cannot',
      "can't",
      'unable',
      'difficult',
      'hard to',
      'needs to',
      'please ',
      'improve',
      'missing',
      'blocked',
      'crash',
      'slow',
      'confusing',
      'not accessible',
      'forced to',
    ];
    const hasActionableFeedback = actionableFeedbackSignals.some((signal) =>
      normalized.includes(signal),
    );

    const promotionalSignals = [
      'download now',
      'ultimate guide',
      'key features',
      'trusted companion',
      'leading provider',
      'discover the',
      'take control of',
      'perfect for',
      'feature-rich',
      'our free ',
      'disclaimer',
      'is not affiliated',
      'provides enhanced functionality',
      'complete and feature-rich',
      'manages everything',
      'built for convenient access',
      'receive push notifications',
      'access all of your videos',
      'end user license agreement',
      'official resources',
      'step-by-step application guidance',
      'join millions of students',
      'trusted by millions',
      'why choose',
      'unlock your potential',
      'download the student planner',
      'effortlessly manage',
      'get better grades',
      'available everywhere',
      'top reviews',
      'detailed features',
      'designed to simplify',
      'welcome to ',
      'all-in-one application',
      'all-in-one platform',
      'award-winning',
      'watch video lessons',
      'earn certificates',
      'start your learning adventure',
      'join our communities',
      'make screen time more meaningful',
    ];
    const promotionalSignalCount = promotionalSignals.filter((signal) =>
      normalized.includes(signal),
    ).length;

    const repositorySignals = [
      'implementation scope',
      'acceptance criteria',
      'testing requirements',
      'emit event',
      'contracts/',
      'src/',
      'expectedchangedfilecount',
      'private repository',
      'privatepr:',
      'exact-head evidence',
      'runner-local',
      'artifact upload',
      'typecheck/build',
      'upgrade replay',
      'implement student enrollment',
      'successful enrollment',
      'duplicate enrollment',
      'persisted on-chain',
      'stellar wallet',
      'repo maintainers',
      'review their application',
      'assign @',
      'affected modules:',
      'expected behavior',
      '## tasks',
      '- [ ]',
      'add tests verifying',
      'implement an ',
      'function that registers',
      'function that updates',
    ];
    const repositorySignalCount = repositorySignals.filter((signal) =>
      normalized.includes(signal),
    ).length;

    const politicalSignals = [
      'government',
      'minister',
      'parliament',
      'lok sabha',
      'political party',
      'representatives',
      'election',
      'ruling',
      'resigns',
      'protest',
    ];
    const productSoftwareSignals = [
      'app',
      'application',
      'platform',
      'website',
      'portal',
      'software',
      'system',
      'login',
      'interface',
    ];

    const externalDeveloperProgramSignals = [
      'github student developer pack',
      'heroku platform credits',
      'oauth access',
      'claim my credits',
      'billing information',
    ];
    const educationProductSignals = [
      'learning app',
      'education app',
      'school app',
      'student portal',
      'learning platform',
      'course platform',
      'classroom',
      'transcript',
      'attendance',
      'grades',
    ];

    const cybersecurityNewsSignals = [
      'ransomware attack',
      'data breach',
      'breach compromised',
      'attacker deleted',
      'cyberattack',
      'malware incident',
      'h drive',
      'j drive',
      'personal information compromised',
    ];
    const newsReportSignals = [
      'according to',
      'reported that',
      'bbc news',
      'breaking news',
      'suffered a ransomware attack',
      'employee and student personal information',
    ];
    const isCybersecurityNews =
      cybersecurityNewsSignals.some((signal) => normalized.includes(signal)) &&
      (newsReportSignals.some((signal) => normalized.includes(signal)) ||
        !hasFirstPersonExperience);

    const storeCatalogueSignalCount = [
      'key features',
      'built for',
      'access all of',
      'download',
      'privacy policy',
      'end user license agreement',
      'requires ios',
      'please note',
      'join millions',
      'trusted by millions',
      'why choose',
      'detailed features',
      'top reviews',
      'available everywhere',
      'get better grades',
      'unlock your potential',
      'pomodoro timer',
      'deadline reminders',
      'award-winning',
      'all-in-one application',
      'all-in-one platform',
      'watch video lessons',
      'earn certificates',
      'start your learning adventure',
      'join our communities',
    ].filter((signal) => normalized.includes(signal)).length;

    const looksLikeStoreDescription =
      normalized.length > 420 &&
      storeCatalogueSignalCount >= 2 &&
      !(hasFirstPersonExperience && hasActionableFeedback);

    const isPromotionalDescription =
      promotionalSignalCount >= 2 &&
      !(hasFirstPersonExperience && hasActionableFeedback);
    const hasConcreteCurrentWorkflowFailure =
      /\b(?:currently|at present|today|now)\b[^.!?]{0,220}\b(?:cancelled|canceled|pending|active queue|cannot|unable|misled|wrong status|incorrect status|still appears?|remains?)\b/iu.test(
        normalized,
      ) ||
      /\b(?:user|administrator|institution|ministry|student|teacher|parent)\b[^.!?]{0,180}\b(?:cannot|unable|misled|forced to|sees?|receives?|encounters?)\b/iu.test(
        normalized,
      );

    const looksLikeImplementationTask =
      repositorySignalCount >= 2 &&
      /\b(?:implementation|requirements?|acceptance criteria|testing requirements|expected behavior|tasks?|affected modules?|contracts\/|src\/|add tests?|emit event|function)\b/iu.test(
        normalized,
      );

    /*
     * A repository issue may contain a genuine user-facing problem and still
     * be useful evidence. However, a solution-complete engineering ticket
     * that names source paths, functions, exact code changes, and tests is an
     * implementation artifact rather than independent community demand.
     */
    const codeArtifactSignals = [
      /\b[a-z_][a-z0-9_]*\(\)/iu,
      /\bcontracts\/[a-z0-9_./-]+/iu,
      /\bsrc\/[a-z0-9_./-]+/iu,
      /\b(?:affected modules?|implementation scope|testing requirements)\b/iu,
      /\b(?:add|write|update|implement)\s+(?:unit\s+)?tests?\b/iu,
      /\b(?:event struct|assertion logic|payload structure|ledger sequence)\b/iu,
      /(?:^|\n)\s*[-*]\s*\[[ x]\]/iu,
      /\b(?:stellar wave program|claim this issue|repo maintainers|assign @)\b/iu,
    ];
    const codeArtifactSignalCount = codeArtifactSignals.filter((pattern) =>
      pattern.test(normalized),
    ).length;

    /**
     * Detects repository tickets that already contain a near-complete product
     * design. These records may mention a real user pain, but they are not
     * independent demand evidence because they prescribe routes, components,
     * files, infrastructure, tests, and rollout details for one repository.
     */
    const solutionBlueprintPatterns: readonly RegExp[] = [
      /\bproposed implementation\b/iu,
      /\bfiles to modify(?:\/create)?\b/iu,
      /\bfrontend components?\b/iu,
      /\bbackend(?: components?| implementation)?\b/iu,
      /\b(?:phase|step)\s+\d+\b/iu,
      /\bexpected impact\b/iu,
      /\bcreate\s+`?(?:app|src|lib|components?|tests?)\//iu,
      /\b(?:redis|websocket|server-sent events?|webrtc|playwright)\b/iu,
      /\b(?:api tests?|e2e tests?|unit tests?|test fixtures?)\b/iu,
      /\b(?:route\.js|manager\.js|service\.js|spec\.js|config\.js)\b/iu,
    ];
    const solutionBlueprintSignalCount = solutionBlueprintPatterns.filter(
      (pattern) => pattern.test(normalized),
    ).length;

    const isSolutionCompleteRepositoryArtifact =
      (looksLikeImplementationTask && codeArtifactSignalCount >= 2) ||
      (normalized.length >= 900 && solutionBlueprintSignalCount >= 3) ||
      solutionBlueprintSignalCount >= 5;

    const isRepositoryGovernance =
      (repositorySignalCount >= 2 &&
        looksLikeImplementationTask &&
        !hasConcreteCurrentWorkflowFailure) ||
      isSolutionCompleteRepositoryArtifact;
    const isPoliticalDiscussion =
      politicalSignals.some((signal) => normalized.includes(signal)) &&
      !productSoftwareSignals.some((signal) => normalized.includes(signal));
    const isExternalDeveloperProgramIssue =
      externalDeveloperProgramSignals.some((signal) =>
        normalized.includes(signal),
      ) &&
      !educationProductSignals.some((signal) => normalized.includes(signal));
    const isGenericPositiveDescription =
      normalized.length > 500 &&
      promotionalSignalCount >= 1 &&
      !hasActionableFeedback;

    const isGovernmentGuidePromotion =
      /\b(?:fafsa|federal student aid guide|official resources|eligibility insights|deadline reminders)\b/iu.test(
        normalized,
      ) &&
      /\b(?:download|guide app|key features|trusted companion|disclaimer)\b/iu.test(
        normalized,
      );

    const isGenericMediaOrPolicyHeadline =
      /\b(?:global media|education system|education minister|government ruling|future generations)\b/iu.test(
        normalized,
      ) &&
      !/\b(?:app|application|platform|portal|software|login|dashboard|lms)\b/iu.test(
        normalized,
      );

    /*
     * Reject institutional or store-catalogue descriptions that enumerate
     * product capabilities but contain no concrete user-observed failure.
     * These records often include domain words and therefore pass a simple
     * relevance score even though they are marketing material rather than
     * evidence of an unmet need.
     */
    const brochureFeatureSignals = [
      'under the leadership of',
      'is developed with the intention',
      'this application comprises',
      'on-demand learning',
      'multimedia resources',
      'with you can',
      'app features',
      'follow and create courses',
      'designed to facilitate',
      'empowering e-learning',
      'our goal is to',
      'successfully implemented',
      'providing students with additional learning resources',
      'learn on their own pace',
      'communication allowing students and teachers',
      'assessment providing ways',
      'share courses fully offline',
      'welcome to ',
      'all-in-one application',
      'all-in-one platform',
      'watch video lessons',
      'earn certificates',
      'start your learning adventure',
      'join our communities',
      'award-winning educational app',
    ];
    const brochureFeatureSignalCount = brochureFeatureSignals.filter((signal) =>
      normalized.includes(signal),
    ).length;
    const looksLikeInstitutionalProductBrochure =
      normalized.length > 350 &&
      brochureFeatureSignalCount >= 2 &&
      !(hasFirstPersonExperience && hasActionableFeedback);

    /*
     * Generic opinions about education or AI are not software-failure
     * evidence unless they describe a reproducible product behavior.
     */
    const hasConcreteSoftwareFailure =
      /\b(?:app|application|platform|portal|software|system|tool|dashboard|lms)\b[^.!?]{0,180}\b(?:cannot|can't|unable|fails?|failed|wrong|incorrect|blocked|missing|crash(?:es|ed)?|slow|confusing|does not|doesn't)\b/iu.test(
        normalized,
      ) ||
      /\b(?:cannot|can't|unable|blocked|forced to|wrong|incorrect)\b[^.!?]{0,180}\b(?:app|application|platform|portal|software|system|tool|dashboard|lms|feature|subscription|paywall)\b/iu.test(
        normalized,
      );

    const isGenericEducationOpinion =
      /\b(?:education differently|future generations|smaller classes|ai tutor|teacher relationships|hype-averse|count me skeptical)\b/iu.test(
        normalized,
      ) && !hasConcreteSoftwareFailure;

    const isVaguePositiveReview =
      /\b(?:great app|excellent|user friendly|best app|works perfectly|top 10)\b/iu.test(
        normalized,
      ) &&
      /\b(?:minor bugs|some errors|hope the developers improve)\b/iu.test(
        normalized,
      ) &&
      !/\b(?:when|after|before|while|screen|page|button|feature|login|upload|download|sync|subscription|country|subject)\b/iu.test(
        normalized,
      );

    const isRepositoryClaimOrAssignment =
      /\b(?:stellar wave program|claim this issue|repo maintainers|review their application|assign @)\b/iu.test(
        normalized,
      );

    /**
     * Rejects repository work items that prescribe implementation rather than
     * report independent user-observed demand. The detector intentionally uses
     * several independent signals so short bug reports with a real workflow
     * symptom remain available to the NLP pipeline.
     */
    const repositoryWorkItemPatterns: readonly RegExp[] = [
      /\bimplementation requirements?\b/iu,
      /\btechnical specifications?\b/iu,
      /\bacceptance criteria\b/iu,
      /\bproposed implementation\b/iu,
      /\bfiles to modify(?:\/create)?\b/iu,
      /\b(?:phase|step)\s+\d+\b/iu,
      /\bexpected impact\b/iu,
      /\b(?:e2e|end-to-end|unit|integration|performance) tests?\b/iu,
      /\b(?:playwright|jest|vitest|cypress)\b/iu,
      /\b(?:next\.js|react|typescript|redis|webrtc|websocket|sse)\b/iu,
      /\b(?:route|manager|service|controller|component|fixture|config)\.(?:js|ts|jsx|tsx)\b/iu,
      /(?:^|\n)\s*[-*]\s*\[[ x]\]/iu,
      /\b(?:timeline|difficulty level|build skills|depends on)\b/iu,
    ];
    const repositoryWorkItemSignalCount = repositoryWorkItemPatterns.filter(
      (pattern) => pattern.test(normalized),
    ).length;
    const isPrescriptiveRepositoryWorkItem =
      repositoryWorkItemSignalCount >= 4 ||
      (normalized.length >= 700 && repositoryWorkItemSignalCount >= 3);

    /**
     * Detects full product-requirement documents and implementation plans.
     *
     * A PRD can contain convincing first-person user stories, complaint-like
     * language, and domain terminology. Those phrases must not make the
     * document count as independent community evidence when the same text also
     * prescribes routes, services, schema decisions, tests, and out-of-scope
     * items. Requiring several structural sections keeps short issue reports
     * and genuine user reviews eligible.
     */
    const productSpecificationSectionPatterns: readonly RegExp[] = [
      /(?:^|\n)\s*#{0,4}\s*problem statement\b/iu,
      /(?:^|\n)\s*#{0,4}\s*solution\b/iu,
      /(?:^|\n)\s*#{0,4}\s*user stories\b/iu,
      /(?:^|\n)\s*#{0,4}\s*implementation decisions?\b/iu,
      /(?:^|\n)\s*#{0,4}\s*testing decisions?\b/iu,
      /(?:^|\n)\s*#{0,4}\s*out of scope\b/iu,
      /(?:^|\n)\s*#{0,4}\s*(?:ui layout|route-level testing|further notes)\b/iu,
      /\bnew route:\s*`?[^\s`]+/iu,
      /\btest file:\s*`?[^\s`]+/iu,
      /\bno schema changes\b/iu,
      /\bwhat makes a good test\b/iu,
    ];
    const productSpecificationSectionCount =
      productSpecificationSectionPatterns.filter((pattern) =>
        pattern.test(normalized),
      ).length;

    const userStoryCount =
      normalized.match(/\bas an?\s+[a-z][^.!?\n]{0,90}\bi want\b/giu)?.length ??
      0;

    const implementationArtifactCount = [
      /\b(?:loader|controller|service|component|route|schema|migration)\b/iu,
      /\b(?:vitest|jest|playwright|cypress|sqlite|drizzle|prisma)\b/iu,
      /\b(?:api|database|table|column|query|function)\b/iu,
      /`[^`]+\.(?:ts|tsx|js|jsx|sql)`/iu,
      /\b(?:acceptance criteria|implementation decisions?|testing decisions?)\b/iu,
    ].filter((pattern) => pattern.test(normalized)).length;

    const isProductRequirementsDocument =
      productSpecificationSectionCount >= 4 ||
      (normalized.length >= 1_200 &&
        productSpecificationSectionCount >= 3 &&
        implementationArtifactCount >= 2) ||
      (normalized.length >= 1_500 &&
        userStoryCount >= 4 &&
        implementationArtifactCount >= 3);

    return (
      isPromotionalDescription ||
      isRepositoryGovernance ||
      isPoliticalDiscussion ||
      isExternalDeveloperProgramIssue ||
      isGenericPositiveDescription ||
      isCybersecurityNews ||
      looksLikeStoreDescription ||
      isGovernmentGuidePromotion ||
      isGenericMediaOrPolicyHeadline ||
      looksLikeInstitutionalProductBrochure ||
      isGenericEducationOpinion ||
      isVaguePositiveReview ||
      isRepositoryClaimOrAssignment ||
      isPrescriptiveRepositoryWorkItem ||
      isProductRequirementsDocument
    );
  }

  /**
   * Removes duplicate collected texts based on their cleaned representation.
   *
   * The first occurrence is preserved to retain stable upstream ordering.
   *
   * @param items Cleaned input items.
   * @returns Unique cleaned input items.
   */
  private removeDuplicateItems<
    T extends Readonly<{ cleaning: CleanTextResult }>,
  >(items: ReadonlyArray<T>): T[] {
    const seen = new Set<string>();

    return items.filter((item) => {
      const key = item.cleaning.cleanedText;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
  }

  /**
   * Resolves languages for cleaned text items.
   *
   * Items whose language remains generic or unsupported are excluded.
   * Excluding only the affected item prevents one ambiguous community text
   * from terminating the complete collection-job NLP analysis.
   *
   * @param items Cleaned and deduplicated text items.
   * @returns Items with a successfully resolved specific language.
   */
  private resolveItemLanguages(
    items: ReadonlyArray<CleanedTextItem>,
    fallbackLanguage: LanguageCode,
  ): LanguageResolvedTextItem[] {
    const resolvedItems: LanguageResolvedTextItem[] = [];

    for (const item of items) {
      const finalLanguage = this.resolveLanguage(
        item.input.language,
        item.cleaning.cleanedText,
        fallbackLanguage,
      );

      if (finalLanguage === null) {
        this.logger.debug(
          `Skipping text "${item.input.id}" because its language could not be resolved.`,
        );

        continue;
      }

      resolvedItems.push({
        ...item,
        finalLanguage,
      });
    }

    return resolvedItems;
  }

  /**
   * Resolves the final specific language used for NLP analysis.
   *
   * Collector-provided languages are reused when valid and specific.
   * Missing or generic values are resolved through language detection.
   *
   * A null result means that the language detector could not classify the
   * text as one of the specific languages supported by the NLP pipeline.
   *
   * @param storedLanguage Language stored during data collection.
   * @param cleanedText Cleaned text used for fallback detection.
   * @returns A specific supported language, or null when unresolved.
   */
  private resolveLanguage(
    storedLanguage: LanguageCode | null | undefined,
    cleanedText: string,
    fallbackLanguage: LanguageCode,
  ): ResolvedLanguageCode | null {
    if (
      storedLanguage !== null &&
      storedLanguage !== undefined &&
      storedLanguage !== LanguageCode.ANY
    ) {
      return storedLanguage;
    }

    const detectedLanguage =
      this.languageDetectionService.detectCode(cleanedText);

    if (detectedLanguage !== LanguageCode.ANY) {
      return detectedLanguage;
    }

    /*
     * A short but meaningful text must not disappear only because language
     * detection is inconclusive. Reuse the collection language when specific;
     * otherwise use English as the neutral supported fallback.
     */
    return fallbackLanguage !== LanguageCode.ANY
      ? fallbackLanguage
      : LanguageCode.EN;
  }

  /**
   * Builds initial analysis records for preprocessed texts.
   *
   * These records provide a consistent structure from the beginning of the
   * pipeline. Later services replace the initial neutral sentiment and enrich
   * confidence, lexicon matches, and AI-usage metadata.
   *
   * @param texts Preprocessed and domain-relevant texts.
   * @returns Initial per-text analysis records.
   */
  private buildInitialAnalysisResults(
    texts: ReadonlyArray<PreprocessedTextInput>,
  ): TextAnalysisResult[] {
    return texts.map((text) => ({
      id: text.id,
      sourceType: text.sourceType,
      postId: text.postId,
      originalText: text.cleaning.originalText,
      cleanedText: text.cleaning.cleanedText,
      language: text.finalLanguage,
      sentiment: Sentiment.NEUTRAL,
      confidence: text.relevanceConfidence,
      matchedLexicons: {},
      aiUsed: false,
    }));
  }
}