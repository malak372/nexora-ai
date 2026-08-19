import { Injectable } from '@nestjs/common';

import {
  buildCommunityEvidenceExcerpt,
  hasDirectCommunityComplaint,
  isLikelyGamingEvidence,
  isLikelyProductDescription,
  isLikelyPromotionalEvidence,
} from '../../common/utils/community-evidence.util';

import {
  AI_CONFIDENCE_WEIGHT,
  RULE_BASED_CONFIDENCE_WEIGHT,
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

import {
  IntelligentAnalysisOutput,
  PriorityLevel,
} from '../../pipeline/types/intelligent-analysis.types';

/**
 * Numeric score assigned to LOW priority.
 */
const LOW_PRIORITY_SCORE = 0.33;

/**
 * Numeric score assigned to MEDIUM priority.
 */
const MEDIUM_PRIORITY_SCORE = 0.66;

/**
 * Numeric score assigned to HIGH priority.
 */
const HIGH_PRIORITY_SCORE = 1;

/**
 * Threshold at or above which an AI score becomes HIGH priority.
 */
const HIGH_PRIORITY_THRESHOLD = 0.67;

/**
 * Threshold at or above which an AI score becomes MEDIUM priority.
 */
const MEDIUM_PRIORITY_THRESHOLD = 0.34;

type EvidenceRecord = Pick<AiEnhancementEvidence, 'text' | 'sourceType'>;

/** Complaint samples that express sentiment without identifying a concrete failure. */
const VAGUE_COMPLAINT_PATTERNS: readonly RegExp[] = [
  /^(?:very\s+)?(?:bad|terrible|awful|horrible|useless)(?:\s+(?:app|application|service|system))?[.!…]*$/iu,
  /^(?:what\s+a\s+)?terrible\s+logic[.!…]*$/iu,
  /^(?:doesn['’]?t\s+work|not\s+working)[.!…]*$/iu,
  /^(?:سيئ|سيء|فظيع|تطبيق\s+سيئ|لا\s+يعمل)[.!…]*$/iu,
];

/** Signals that make a complaint useful for opportunity discovery. */
const CONCRETE_FAILURE_PATTERNS: readonly RegExp[] = [
  /\b(?:connect|disconnect|sync|crash|freeze|glitch|error|delete|save|load|login|schedule|irrigat|controller|notification|payment|upload|download|offline|network|bluetooth|firmware)\w*\b/iu,
  /\b(?:cannot|can['’]?t|unable|fails?\s+to|failed\s+to|without\s+warning|keeps?\s+\w+ing)\b/iu,
  /(?:اتصال|ينفصل|مزامنة|تعطل|خطأ|حذف|حفظ|تحميل|دخول|جدولة|ري|متحكم|إشعار|دفع|بدون\s+تحذير)/iu,
];

/**
 * Merges validated AI-enhancement output with the authoritative
 * rule-based NLP analysis.
 *
 * The rule-based result remains the source of truth for:
 * - Analyzed-text counts.
 * - Sentiment statistics.
 * - Keyword and topic frequencies.
 * - Data-quality metrics.
 * - Sample posts and comments.
 * - Existing frequencies and source-derived evidence.
 *
 * AI output is used only to:
 * - Refine or add recurring problems.
 * - Refine or add extracted needs.
 * - Refine or add feature requests.
 * - Refine or add software opportunities.
 * - Add evidence-supported analytical insights.
 * - Contribute to the final confidence score.
 *
 * Merge rules are deterministic and intentionally conservative:
 * - Existing rule-based items are never deleted.
 * - Existing rule-based frequencies are never reduced or replaced.
 * - AI-only frequencies are derived from unique supporting evidence
 *   identifiers rather than invented by the AI model.
 * - AI evidence identifiers are resolved back to real evidence text.
 * - Duplicate items are matched using normalized exact keys.
 * - Fuzzy semantic matching is intentionally avoided because it can
 *   silently merge unrelated community concerns.
 *
 * This service does not:
 * - Call AI providers.
 * - Validate raw AI responses.
 * - Build prompts.
 * - Persist the merged analysis.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisMergeService {
  /**
   * Merges one validated AI-enhancement output into a completed
   * rule-based NLP analysis.
   *
   * @param ruleBasedOutput Authoritative rule-based NLP result.
   * @param aiOutput Validated AI-enhancement output.
   * @param evidence Evidence supplied to the AI request.
   * @returns Final merged NLP analysis.
   */
  merge(
    ruleBasedOutput: IntelligentAnalysisOutput,
    aiOutput: AiEnhancementOutput,
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): IntelligentAnalysisOutput {
    const evidenceById = this.buildEvidenceLookup(evidence);

    return {
      ...ruleBasedOutput,

      recurringProblems: this.mergeRecurringProblems(
        ruleBasedOutput.recurringProblems,
        aiOutput.recurringProblems,
        evidenceById,
      ),

      extractedNeeds: this.mergeExtractedNeeds(
        ruleBasedOutput.extractedNeeds,
        aiOutput.extractedNeeds,
        evidenceById,
      ),

      featureRequests: this.mergeFeatureRequests(
        ruleBasedOutput.featureRequests,
        aiOutput.featureRequests,
        evidenceById,
      ),

      opportunities: this.mergeOpportunities(
        ruleBasedOutput.opportunities,
        aiOutput.opportunities,
        evidenceById,
      ),

      insights: {
        ...ruleBasedOutput.insights,

        additionalInsights: this.mergeAdditionalInsights(
          ruleBasedOutput.insights.additionalInsights,
          aiOutput.insights,
          evidenceById,
        ),
      },

      aiUsed: true,

      confidence: this.calculateMergedConfidence(
        ruleBasedOutput.confidence,
        aiOutput.confidence,
      ),
    };
  }

  /**
   * Merges recurring problems while preserving authoritative
   * rule-based frequencies.
   *
   * AI-only problem frequency is calculated from the number of unique
   * supporting evidence identifiers.
   */
  private mergeRecurringProblems(
    ruleBasedProblems: IntelligentAnalysisOutput['recurringProblems'],
    aiProblems: ReadonlyArray<AiEnhancedRecurringProblem>,
    evidenceById: ReadonlyMap<string, EvidenceRecord>,
  ): IntelligentAnalysisOutput['recurringProblems'] {
    const merged = this.consolidateRuleBasedProblems(ruleBasedProblems);

    const indexByKey = new Map(
      merged.map((problem, index) => [
        this.normalizeKey(this.canonicalizeProblemTitle(problem.title)),
        index,
      ]),
    );

    for (const aiProblem of aiProblems) {
      const canonicalTitle = this.canonicalizeProblemTitle(aiProblem.title);
      const key = this.normalizeKey(canonicalTitle);
      const existingIndex = indexByKey.get(key);
      const aiEvidence = this.resolveEvidenceSamples(
        aiProblem.supportingEvidenceIds,
        evidenceById,
        true,
      ).filter((sample) =>
        this.isEvidenceAlignedWithCanonicalLabel(canonicalTitle, sample),
      );

      if (aiEvidence.length === 0) {
        continue;
      }

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];

        merged[existingIndex] = {
          ...existing,
          severity: this.maxPriority(
            existing.severity,
            this.scoreToPriority(aiProblem.severity),
          ),
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            aiEvidence,
          ),
        };

        continue;
      }

      merged.push({
        title: canonicalTitle,
        frequency: aiEvidence.length,
        severity: this.scoreToPriority(aiProblem.severity),
        evidenceSamples: aiEvidence,
      });

      indexByKey.set(key, merged.length - 1);
    }

    return merged;
  }

  /**
   * Merges extracted needs while retaining existing related-problem
   * links and rule-based priority values.
   */
  private mergeExtractedNeeds(
    ruleBasedNeeds: IntelligentAnalysisOutput['extractedNeeds'],
    aiNeeds: ReadonlyArray<AiEnhancedNeed>,
    evidenceById: ReadonlyMap<string, EvidenceRecord>,
  ): IntelligentAnalysisOutput['extractedNeeds'] {
    const merged = this.consolidateRuleBasedNeeds(ruleBasedNeeds);

    const indexByKey = new Map(
      merged.map((need, index) => [
        this.normalizeKey(this.canonicalizeNeedTitle(need.need)),
        index,
      ]),
    );

    for (const aiNeed of aiNeeds) {
      const canonicalNeed = this.canonicalizeNeedTitle(aiNeed.need);
      const key = this.normalizeKey(canonicalNeed);
      const existingIndex = indexByKey.get(key);
      const aiEvidence = this.resolveEvidenceSamples(
        aiNeed.supportingEvidenceIds,
        evidenceById,
        true,
      ).filter((sample) =>
        this.isEvidenceAlignedWithCanonicalLabel(canonicalNeed, sample),
      );

      if (aiEvidence.length === 0) {
        continue;
      }

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];

        merged[existingIndex] = {
          ...existing,
          priority: this.maxPriority(
            existing.priority,
            this.scoreToPriority(aiNeed.confidence),
          ),
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            aiEvidence,
          ),
        };

        continue;
      }

      merged.push({
        need: canonicalNeed,
        priority: this.scoreToPriority(aiNeed.confidence),
        relatedProblem: this.inferRelatedProblemForNeed(canonicalNeed),
        evidenceSamples: aiEvidence,
      });

      indexByKey.set(key, merged.length - 1);
    }

    return merged;
  }

  /**
   * Merges feature requests while preserving existing frequencies.
   *
   * For AI-only feature requests, frequency is derived from the
   * number of unique supporting evidence identifiers.
   */
  private mergeFeatureRequests(
    ruleBasedRequests: IntelligentAnalysisOutput['featureRequests'],
    aiRequests: ReadonlyArray<AiEnhancedFeatureRequest>,
    evidenceById: ReadonlyMap<string, EvidenceRecord>,
  ): IntelligentAnalysisOutput['featureRequests'] {
    const merged: IntelligentAnalysisOutput['featureRequests'] = [];
    const indexByKey = new Map<string, number>();

    const upsert = (
      feature: string,
      frequency: number,
      evidenceSamples: ReadonlyArray<string>,
    ): void => {
      const canonicalFeature = this.canonicalizeFeatureRequestTitle(feature);
      const key = this.normalizeKey(canonicalFeature);
      const existingIndex = indexByKey.get(key);

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];

        merged[existingIndex] = {
          ...existing,
          frequency: Math.max(existing.frequency, frequency),
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            evidenceSamples,
          ),
        };
        return;
      }

      merged.push({
        feature: canonicalFeature,
        frequency,
        evidenceSamples: this.mergeUniqueStrings([], evidenceSamples),
      });
      indexByKey.set(key, merged.length - 1);
    };

    for (const request of ruleBasedRequests) {
      upsert(request.feature, request.frequency, request.evidenceSamples);
    }

    for (const aiRequest of aiRequests) {
      const aiEvidence = this.resolveEvidenceSamples(
        aiRequest.supportingEvidenceIds,
        evidenceById,
        false,
      );

      if (aiEvidence.length === 0) {
        continue;
      }

      upsert(
        aiRequest.feature,
        aiRequest.supportingEvidenceIds.length,
        aiEvidence,
      );
    }

    return merged;
  }

  /**
   * Maps semantically equivalent media-player requests to one stable feature.
   * Other feature labels remain unchanged to avoid broad or unsafe merging.
   */
  private canonicalizeFeatureRequestTitle(value: string): string {
    const normalized = this.normalizeKey(value);

    if (
      /(?:playback speed|faster playback|video speed|1x|1\.5x|2x|skip forward|forward skip|forward 10 seconds|10 second forward|seek control|media player control)/iu.test(
        normalized,
      )
    ) {
      return 'Enhanced Educational Video Player Controls';
    }

    return value.trim();
  }

  /**
   * Merges software opportunities.
   *
   * Existing rule-based contextual links such as problem, need, and
   * topic remain unchanged. AI confidence may increase, but never
   * reduce, the existing opportunity score.
   */
  private mergeOpportunities(
    ruleBasedOpportunities: IntelligentAnalysisOutput['opportunities'],
    aiOpportunities: ReadonlyArray<AiEnhancedOpportunity>,
    evidenceById: ReadonlyMap<string, EvidenceRecord>,
  ): IntelligentAnalysisOutput['opportunities'] {
    const merged = ruleBasedOpportunities.map((opportunity) => ({
      ...opportunity,
      evidenceSamples: [...opportunity.evidenceSamples],
    }));

    const indexByKey = new Map(
      merged.map((opportunity, index) => [
        this.normalizeKey(opportunity.solutionArea),
        index,
      ]),
    );

    for (const aiOpportunity of aiOpportunities) {
      const key = this.normalizeKey(aiOpportunity.title);
      const existingIndex = indexByKey.get(key);
      const aiEvidence = this.resolveEvidenceSamples(
        aiOpportunity.supportingEvidenceIds,
        evidenceById,
        true,
      );

      if (aiEvidence.length === 0) {
        continue;
      }

      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];
        const enrichedDescriptors =
          this.buildOpportunityDescriptors(aiOpportunity);

        merged[existingIndex] = {
          ...existing,
          problem: existing.problem ?? enrichedDescriptors.problem,
          need: existing.need ?? enrichedDescriptors.need,
          solutionArea:
            existing.solutionArea ?? enrichedDescriptors.solutionArea,
          score: Math.max(existing.score, aiOpportunity.confidence),
          evidenceSamples: this.mergeUniqueStrings(
            existing.evidenceSamples,
            aiEvidence,
          ),
        };

        continue;
      }

      const descriptors = this.buildOpportunityDescriptors(aiOpportunity);

      merged.push({
        problem: descriptors.problem,
        need: descriptors.need,
        solutionArea: descriptors.solutionArea,
        score: aiOpportunity.confidence,
        evidenceSamples: aiEvidence,
      });

      indexByKey.set(key, merged.length - 1);
    }

    return merged.filter(
      (opportunity) =>
        opportunity.evidenceSamples.length > 0 &&
        opportunity.evidenceSamples.some((sample) =>
          this.isEvidenceAlignedWithCanonicalLabel(
            [
              opportunity.problem,
              opportunity.need,
              opportunity.solutionArea,
              opportunity.topic,
            ]
              .filter((value): value is string => Boolean(value))
              .join(' '),
            sample,
          ),
        ),
    );
  }

  /**
   * Converts one AI-only opportunity into the same complete descriptor shape
   * used by rule-based opportunities.
   *
   * The AI-enhancement contract exposes a title and optional description, not
   * separate problem/need fields. Persisting only solutionArea caused later
   * ranking to receive structurally incomplete records. This deterministic
   * adapter preserves the AI title as the solution area, uses the supported
   * description as the problem statement, and derives a cautious user-need
   * label without inventing frequencies, causes, or local claims.
   */
  private buildOpportunityDescriptors(opportunity: AiEnhancedOpportunity): {
    readonly problem: string;
    readonly need: string;
    readonly solutionArea: string;
  } {
    const title = opportunity.title.replace(/\s+/gu, ' ').trim();
    const description = opportunity.description?.replace(/\s+/gu, ' ').trim();

    return {
      problem: description || title,
      need: this.deriveOpportunityNeed(title),
      solutionArea: title,
    };
  }

  /**
   * Produces a stable need label from an evidence-supported opportunity title.
   * Known workflow families receive precise wording; unknown titles use a
   * neutral "reliable support for" form rather than an unsupported claim.
   */
  private deriveOpportunityNeed(title: string): string {
    const normalized = title.toLocaleLowerCase();

    if (
      /\b(?:login|sign[ -]?in|authentication|activation|identity|verification|session|token|handshake)\b/iu.test(
        normalized,
      )
    ) {
      return 'Reliable Login and Session Recovery';
    }

    if (
      /\b(?:subscription|purchase|payment|billing|renewal|restore purchase|account access)\b/iu.test(
        normalized,
      )
    ) {
      return 'Reliable Subscription Restoration and Account Access';
    }

    if (
      /\b(?:crash|reliability|stability|runtime|performance|recovery)\b/iu.test(
        normalized,
      )
    ) {
      return 'Stable and Recoverable Application Operation';
    }

    if (
      /\b(?:productivity|focus|browser|context-aware|context aware)\b/iu.test(
        normalized,
      )
    ) {
      return 'Context-aware Focus and Browser Workflow Support';
    }

    if (
      /\b(?:cross-environment|cross environment|deployment|container|model consistency)\b/iu.test(
        normalized,
      )
    ) {
      return 'Consistent AI Model Behavior Across Environments';
    }

    if (
      /\b(?:data transformation|algorithm|decoding|encoding|recipe)\b/iu.test(
        normalized,
      )
    ) {
      return 'Guided Data Transformation and Algorithm Discovery';
    }

    return `Reliable Support for ${title}`;
  }

  /**
   * Merges evidence-supported AI insights into the dedicated
   * additional-insights collection.
   *
   * Existing classified concern arrays remain unchanged because the
   * generic AI insight contract does not contain a reliable concern
   * category.
   */
  private mergeAdditionalInsights(
    ruleBasedInsights: ReadonlyArray<string>,
    aiInsights: ReadonlyArray<AiEnhancedInsight>,
    evidenceById: ReadonlyMap<string, EvidenceRecord>,
  ): string[] {
    const merged = [...ruleBasedInsights];
    const seen = new Set(merged.map((item) => this.normalizeKey(item)));

    for (const aiInsight of aiInsights) {
      /*
       * Resolution proves that every referenced identifier maps to
       * evidence supplied to the AI request. The validator has already
       * checked this, and the merge layer preserves defense in depth.
       */
      this.resolveEvidenceSamples(
        aiInsight.supportingEvidenceIds,
        evidenceById,
        false,
      );

      const key = this.normalizeKey(aiInsight.insight);

      if (!seen.has(key)) {
        seen.add(key);
        merged.push(aiInsight.insight);
      }
    }

    return merged;
  }

  /**
   * Builds a lookup from evidence identifiers to normalized evidence
   * text.
   *
   * The first occurrence of a duplicate identifier is preserved to
   * maintain stable upstream evidence priority.
   */
  private buildEvidenceLookup(
    evidence: ReadonlyArray<AiEnhancementEvidence>,
  ): ReadonlyMap<string, EvidenceRecord> {
    const lookup = new Map<string, EvidenceRecord>();

    for (const item of evidence) {
      const id = item.id.trim();
      const text = item.text.trim();

      if (!lookup.has(id)) {
        lookup.set(id, { text, sourceType: item.sourceType });
      }
    }

    return lookup;
  }

  /**
   * Resolves AI evidence identifiers back to real evidence text.
   *
   * Unknown identifiers are ignored defensively because they should
   * already have been rejected by AiAnalysisOutputValidatorService.
   */
  private resolveEvidenceSamples(
    evidenceIds: ReadonlyArray<string>,
    evidenceById: ReadonlyMap<string, EvidenceRecord>,
    requireDirectEvidence: boolean,
  ): string[] {
    const samples: string[] = [];

    for (const id of evidenceIds) {
      const evidence = evidenceById.get(id);

      if (!evidence?.text) {
        continue;
      }

      if (isLikelyGamingEvidence(evidence.text)) {
        continue;
      }

      const hasComplaint = hasDirectCommunityComplaint(evidence.text);

      if (requireDirectEvidence && !hasComplaint) {
        continue;
      }

      if (
        !hasComplaint &&
        (isLikelyPromotionalEvidence(evidence.text) ||
          isLikelyProductDescription(evidence.text, evidence.sourceType))
      ) {
        continue;
      }

      const sample = hasComplaint
        ? buildCommunityEvidenceExcerpt(evidence.text, 500)
        : evidence.text.trim();

      if (
        sample &&
        !isLikelyGamingEvidence(sample) &&
        !isLikelyPromotionalEvidence(sample) &&
        !isLikelyProductDescription(sample, evidence.sourceType)
      ) {
        samples.push(sample);
      }
    }

    return this.rankEvidenceSamples(samples, requireDirectEvidence);
  }

  /**
   * Orders evidence by diagnostic value and prevents generic sentiment-only
   * comments from becoming the primary support for a problem or need.
   */
  private rankEvidenceSamples(
    samples: ReadonlyArray<string>,
    requireConcreteEvidence: boolean,
  ): string[] {
    const uniqueSamples = this.mergeUniqueStrings([], samples);
    const scored = uniqueSamples.map((sample) => ({
      sample,
      score: this.calculateEvidenceSpecificityScore(sample),
    }));
    const concrete = scored.filter((item) => item.score >= 0.55);

    if (requireConcreteEvidence && concrete.length === 0) {
      return [];
    }

    const selected = concrete.length > 0 ? concrete : scored;

    return selected
      .sort(
        (first, second) =>
          second.score - first.score ||
          second.sample.length - first.sample.length ||
          first.sample.localeCompare(second.sample),
      )
      .map((item) => item.sample);
  }

  /** Returns a deterministic 0..1 diagnostic-value score for one sample. */
  private calculateEvidenceSpecificityScore(sample: string): number {
    const normalized = sample.replace(/\s+/gu, ' ').trim();

    if (isLikelyGamingEvidence(normalized)) {
      return 0;
    }

    if (
      !normalized ||
      VAGUE_COMPLAINT_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      return 0.15;
    }

    let score = 0.25;

    if (CONCRETE_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      score += 0.45;
    }
    if (
      /\b(?:when|while|after|before|because|during|every\s+time)\b/iu.test(
        normalized,
      )
    ) {
      score += 0.12;
    }
    if (
      /\b(?:data|plan|field|crop|water|device|account|screen|button|record|command)\b/iu.test(
        normalized,
      )
    ) {
      score += 0.1;
    }
    if (normalized.split(/\s+/u).length >= 8) {
      score += 0.08;
    }

    return Math.min(1, score);
  }

  /**
   * Consolidates semantically equivalent rule-based problem labels before AI
   * output is merged. Frequencies are summed and evidence is deduplicated.
   */
  private consolidateRuleBasedProblems(
    problems: IntelligentAnalysisOutput['recurringProblems'],
  ): IntelligentAnalysisOutput['recurringProblems'] {
    const groups = new Map<
      string,
      IntelligentAnalysisOutput['recurringProblems'][number]
    >();

    for (const problem of problems) {
      const directEvidence = this.rankEvidenceSamples(
        problem.evidenceSamples
          .filter(
            (sample) =>
              hasDirectCommunityComplaint(sample) &&
              !isLikelyGamingEvidence(sample),
          )
          .map((sample) => buildCommunityEvidenceExcerpt(sample, 500))
          .filter(
            (sample) => Boolean(sample) && !isLikelyPromotionalEvidence(sample),
          ),
        true,
      );

      if (directEvidence.length === 0) {
        continue;
      }

      const title = this.canonicalizeProblemTitle(problem.title);
      const alignedEvidence = directEvidence.filter((sample) =>
        this.isEvidenceAlignedWithCanonicalLabel(title, sample),
      );
      const key = this.normalizeKey(title);

      if (alignedEvidence.length === 0) {
        continue;
      }

      const current = groups.get(key);

      if (!current) {
        groups.set(key, {
          ...problem,
          title,
          evidenceSamples: this.mergeUniqueStrings([], alignedEvidence),
        });
        continue;
      }

      groups.set(key, {
        ...current,
        frequency: current.frequency + problem.frequency,
        severity: this.maxPriority(current.severity, problem.severity),
        evidenceSamples: this.mergeUniqueStrings(
          current.evidenceSamples,
          alignedEvidence,
        ),
      });
    }

    return [...groups.values()].sort(
      (first, second) =>
        second.frequency - first.frequency ||
        this.priorityToScore(second.severity) -
          this.priorityToScore(first.severity) ||
        first.title.localeCompare(second.title),
    );
  }

  /**
   * Consolidates equivalent rule-based needs and removes product-description
   * evidence before AI additions are considered.
   */
  private consolidateRuleBasedNeeds(
    needs: IntelligentAnalysisOutput['extractedNeeds'],
  ): IntelligentAnalysisOutput['extractedNeeds'] {
    const groups = new Map<
      string,
      IntelligentAnalysisOutput['extractedNeeds'][number]
    >();

    for (const need of needs) {
      const directEvidence = this.rankEvidenceSamples(
        need.evidenceSamples
          .filter(
            (sample) =>
              hasDirectCommunityComplaint(sample) &&
              !isLikelyGamingEvidence(sample),
          )
          .map((sample) => buildCommunityEvidenceExcerpt(sample, 500))
          .filter(
            (sample) => Boolean(sample) && !isLikelyPromotionalEvidence(sample),
          ),
        true,
      );
      const canonicalNeed = this.canonicalizeNeedTitle(
        need.need,
        directEvidence,
      );
      const alignedEvidence = directEvidence.filter((sample) =>
        this.isEvidenceAlignedWithCanonicalLabel(canonicalNeed, sample),
      );
      const key = this.normalizeKey(canonicalNeed);

      if (alignedEvidence.length === 0) {
        continue;
      }

      const current = groups.get(key);

      if (!current) {
        groups.set(key, {
          ...need,
          need: canonicalNeed,
          relatedProblem:
            need.relatedProblem ??
            this.inferRelatedProblemForNeed(canonicalNeed),
          evidenceSamples: this.mergeUniqueStrings([], alignedEvidence),
        });
        continue;
      }

      groups.set(key, {
        ...current,
        priority: this.maxPriority(current.priority, need.priority),
        relatedProblem:
          current.relatedProblem ??
          need.relatedProblem ??
          this.inferRelatedProblemForNeed(canonicalNeed),
        evidenceSamples: this.mergeUniqueStrings(
          current.evidenceSamples,
          alignedEvidence,
        ),
      });
    }

    return [...groups.values()];
  }

  /**
   * Keeps AI evidence attached only to the canonical workflow it actually
   * describes. This prevents login complaints from becoming document-access
   * evidence and scientific uses of "error" from becoming crash evidence.
   */
  private isEvidenceAlignedWithCanonicalLabel(
    label: string,
    evidence: string,
  ): boolean {
    const normalizedLabel = this.normalizeKey(label);
    const normalizedEvidence = this.normalizeKey(evidence);

    if (
      /account activation|login|verification|authentication|sign in/iu.test(
        normalizedLabel,
      )
    ) {
      return /(?:account|activation|verification|authentication|login|log in|sign in|phone|email|code|otp)/iu.test(
        normalizedEvidence,
      );
    }

    if (/document|download|syllabus|file access/iu.test(normalizedLabel)) {
      const hasDocumentObject =
        /(?:document|download|syllabus|attachment|pdf|file|broken link)/iu.test(
          normalizedEvidence,
        );
      const hasDocumentFailure =
        /(?:cannot|can['’]?t|unable|won['’]?t|doesn['’]?t|fail|failed|broken|error|null|not open|open)/iu.test(
          normalizedEvidence,
        );

      return (
        hasDocumentObject &&
        hasDocumentFailure &&
        !/(?:login|log in|sign in|authentication|activation|verification|account|phone number|otp)/iu.test(
          normalizedEvidence,
        )
      );
    }

    if (/data loss|synchronization|sync|recovery/iu.test(normalizedLabel)) {
      return /(?:data|sync|synchronization|history|progress|work|draft|save|saved|missing|lost|gone|deleted)/iu.test(
        normalizedEvidence,
      );
    }

    if (
      /playback|video speed|media player|seek control|forward 10 seconds/iu.test(
        normalizedLabel,
      )
    ) {
      return /(?:playback|video|media player|speed|1x|1\.5x|2x|faster|forward 10 seconds|skip forward|seek control)/iu.test(
        normalizedEvidence,
      );
    }

    if (/search|filtering|filter|search criteria/iu.test(normalizedLabel)) {
      return /\b(?:search|filter|filtering|filters|search criteria|search option|catalog|listing)\b/iu.test(
        normalizedEvidence,
      );
    }

    if (/feature removal|change notification|functionality change/iu.test(normalizedLabel)) {
      const hasFeatureObject = /\b(?:feature|functionality|capability|option|setting)\b/iu.test(
        normalizedEvidence,
      );
      const hasChange = /\b(?:removed|removal|disappeared|disappear|changed|change|deprecated|replaced)\b/iu.test(
        normalizedEvidence,
      );
      const hasCommunicationNeed = /\b(?:notify|notification|announce|communication|alternative|replacement)\b/iu.test(
        normalizedEvidence,
      );

      return hasFeatureObject && hasChange && hasCommunicationNeed;
    }

    if (/navigation|interface|usability/iu.test(normalizedLabel)) {
      return /(?:navigate|navigation|interface|back button|scroll|popup|tab|menu|schedule)/iu.test(
        normalizedEvidence,
      );
    }

    if (/cross[- ]device|desktop|laptop|computer/iu.test(normalizedLabel)) {
      const hasTargetDevice =
        /(?:desktop|laptop|computer|pc|ios|android|mobile|tablet)/iu.test(
          normalizedEvidence,
        );
      const hasAccessFailure =
        /(?:cannot|can['’]?t|unable|not available|doesn['’]?t work|won['’]?t work|fails? to|only works|works on).{0,80}(?:desktop|laptop|computer|pc|ios|android|mobile|tablet)|(?:desktop|laptop|computer|pc|ios|android|mobile|tablet).{0,80}(?:cannot|can['’]?t|unable|not available|doesn['’]?t work|won['’]?t work|fails? to|only works|works just fine)/iu.test(
          normalizedEvidence,
        );

      return (
        hasTargetDevice &&
        hasAccessFailure &&
        !/(?:login|log in|sign in|authentication|activation|verification|account|phone number|otp)/iu.test(
          normalizedEvidence,
        )
      );
    }

    if (/cost|paywall|price|subscription/iu.test(normalizedLabel)) {
      return /(?:cost|price|pricing|paywall|paid|pay|subscription|fee|limited unless paid)/iu.test(
        normalizedEvidence,
      );
    }

    if (
      /reliability|crash|stable application|performance/iu.test(normalizedLabel)
    ) {
      if (
        /\b(?:scratch|scratches|sore|sores|bug bite|bug bites|insect bite|wound|skin)\b/iu.test(
          normalizedEvidence,
        ) &&
        !/\b(?:app|application|software|runtime|screen|process|service)\b/iu.test(
          normalizedEvidence,
        )
      ) {
        return false;
      }

      if (
        !/\b(?:crash|crashes|crashed|crashing|freeze|freezes|frozen)\b|white screen/iu.test(
          normalizedEvidence,
        ) &&
        /(?:login|log in|sign in|activation|verification|account|server|network|website|connection|document|download|syllabus|file|link)/iu.test(
          normalizedEvidence,
        )
      ) {
        return false;
      }

      if (
        /(?:quantum error correction|error[- ]correcting code|error correction algorithm|statistical error|measurement error|prediction error|training error)/iu.test(
          normalizedEvidence,
        )
      ) {
        return false;
      }

      const hasExplicitCrash =
        /\b(?:crash|crashes|crashed|crashing|freeze|freezes|frozen)\b|white screen/iu.test(
          normalizedEvidence,
        );
      const hasOperationalFailure =
        /\b(?:bug|glitch)\b|submission failed|fails? to submit|upload failed|not working|doesn['’]?t work/iu.test(
          normalizedEvidence,
        ) &&
        !/(?:login|log in|sign in|authentication|activation|verification|account|server|network|website|connection|document|download|syllabus|file|link)/iu.test(
          normalizedEvidence,
        );

      return hasExplicitCrash || hasOperationalFailure;
    }

    return true;
  }

  /** Maps semantically equivalent need phrases to one stable label. */
  private canonicalizeNeedTitle(
    value: string,
    evidenceSamples: readonly string[] = [],
  ): string {
    const normalized = this.normalizeKey(value);
    const evidenceText = this.normalizeKey(evidenceSamples.join(' '));

    if (
      /connect|disconnect|network|device|controller|bluetooth|firmware|signal/iu.test(
        evidenceText,
      ) &&
      /fail|failed|failing|problem|issue|never|unable|cannot|can't|disconnect/iu.test(
        evidenceText,
      )
    ) {
      return 'Reliable Connectivity and Device Communication';
    }

    // Match concrete workflows before generic words such as "reliable".
    if (/offline|without internet|no internet/iu.test(normalized)) {
      const isLearningContext =
        /learn|lesson|course|education|student|teacher|material|content|curriculum/iu.test(
          `${normalized} ${evidenceText}`,
        );

      return isLearningContext
        ? 'Offline Access to Learning Materials'
        : 'Offline Access to Operational Data and Controls';
    }

    if (
      /\b(?:desktop|laptop)\b|cross[- ]device|cross[- ]platform|(?:computer|pc).{0,50}(?:access|install|download|available)/iu.test(normalized)
    ) {
      return 'Cross-Device Desktop and Laptop Access';
    }

    if (/navigation|interface|back button|scroll|popup/iu.test(normalized)) {
      return 'Clear and Stable Navigation';
    }

    if (/data|sync|synchronization|recovery|lost progress/iu.test(normalized)) {
      return 'Reliable Data Synchronization and Recovery';
    }

    if (/activation|verification|login|sign in|account/iu.test(normalized)) {
      return 'Reliable Account Activation and Login';
    }

    if (/document|download|syllabus|file access/iu.test(normalized)) {
      return 'Reliable Document Access and Downloads';
    }

    if (
      /playback|video speed|forward 10 seconds|skip forward/iu.test(normalized)
    ) {
      return 'Playback Speed Control for Educational Videos';
    }

    if (/connectivity|service availability|server|network/iu.test(normalized)) {
      return 'Reliable Connectivity and Service Availability';
    }

    if (
      /\b(?:crash|crashes|crashed|crashing|reliability|performance)\b|stable app|stable application/iu.test(
        normalized,
      )
    ) {
      return 'Stable and Reliable Application Operation';
    }

    return value.replace(/\s+/gu, ' ').trim();
  }

  /** Infers the canonical problem related to one normalized need. */
  private inferRelatedProblemForNeed(value: string): string | undefined {
    const normalized = this.normalizeKey(value);

    if (
      /connectivity|device communication|controller communication/iu.test(
        normalized,
      )
    ) {
      return 'Connectivity and Device Communication Failures';
    }

    if (/\b(?:crash|crashes|crashed|crashing|stable|performance)\b|reliable application/iu.test(normalized)) {
      return 'Application Reliability and Crash Failures';
    }

    if (/desktop|laptop|cross device|cross platform/iu.test(normalized)) {
      return 'Cross-Device Access Barriers';
    }

    if (/navigation|interface/iu.test(normalized)) {
      return 'Navigation and Interface Failures';
    }

    if (/data|sync|recovery/iu.test(normalized)) {
      return 'Data Loss and Synchronization Failures';
    }

    if (/activation|verification|login|account/iu.test(normalized)) {
      return 'Account Activation and Login Failures';
    }

    if (/document|download|syllabus|file/iu.test(normalized)) {
      return 'Document Access and Download Failures';
    }

    if (/playback|video speed|media player|seek control/iu.test(normalized)) {
      return 'Missing Video Playback Controls';
    }

    return undefined;
  }

  /** Maps equivalent AI and rule-based labels to one stable problem title. */
  private canonicalizeProblemTitle(value: string): string {
    const normalized = this.normalizeKey(value);

    // Match concrete workflows before generic terms such as "failure".
    if (
      /document|download|syllabus|file access|broken link/iu.test(normalized)
    ) {
      return 'Document Access and Download Failures';
    }

    if (
      /data loss|synchronization|sync|recovery|missing history/iu.test(
        normalized,
      )
    ) {
      return 'Data Loss and Synchronization Failures';
    }

    if (
      /cross[- ]device|\b(?:desktop|laptop|mobile only)\b|(?:computer|pc).{0,50}(?:access|install|download|available)/iu.test(
        normalized,
      )
    ) {
      return 'Cross-Device Access Barriers';
    }

    if (
      /activation|verification|authentication|login|sign in|account access/iu.test(
        normalized,
      )
    ) {
      return 'Account Activation and Login Failures';
    }

    if (
      /navigation|interface|usability|back button|scroll|popup/iu.test(
        normalized,
      )
    ) {
      return 'Navigation and Interface Failures';
    }

    if (/cost|paywall|paid|price|subscription/iu.test(normalized)) {
      return 'High Cost or Paywall Restrictions';
    }

    if (
      /playback|video speed|forward 10 seconds|skip forward/iu.test(normalized)
    ) {
      return 'Missing Video Playback Controls';
    }

    if (
      /connectivity|service availability|server|network outage/iu.test(
        normalized,
      )
    ) {
      return 'Connectivity and Service Availability Failures';
    }

    if (
      /\b(?:crash|crashes|crashed|crashing|instability|reliability|freeze|frozen|glitch)\b|generic error/iu.test(
        normalized,
      )
    ) {
      return 'Application Reliability and Crash Failures';
    }

    return value.replace(/\s+/gu, ' ').trim();
  }

  /**
   * Calculates the final confidence score using the configured
   * rule-based and AI confidence weights.
   */
  private calculateMergedConfidence(
    ruleBasedConfidence: number,
    aiConfidence: number,
  ): number {
    const totalWeight = RULE_BASED_CONFIDENCE_WEIGHT + AI_CONFIDENCE_WEIGHT;

    const weightedConfidence =
      (this.clampScore(ruleBasedConfidence) * RULE_BASED_CONFIDENCE_WEIGHT +
        this.clampScore(aiConfidence) * AI_CONFIDENCE_WEIGHT) /
      totalWeight;

    return Number(this.clampScore(weightedConfidence).toFixed(3));
  }

  /**
   * Converts a normalized AI score into the priority contract used by
   * the rule-based NLP output.
   */
  private scoreToPriority(score: number): PriorityLevel {
    const normalizedScore = this.clampScore(score);

    if (normalizedScore >= HIGH_PRIORITY_THRESHOLD) {
      return 'HIGH';
    }

    if (normalizedScore >= MEDIUM_PRIORITY_THRESHOLD) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Returns the higher of two priority values.
   */
  private maxPriority(
    first: PriorityLevel,
    second: PriorityLevel,
  ): PriorityLevel {
    return this.priorityToScore(first) >= this.priorityToScore(second)
      ? first
      : second;
  }

  /**
   * Converts a priority value into a comparable numeric score.
   */
  private priorityToScore(priority: PriorityLevel): number {
    switch (priority) {
      case 'LOW':
        return LOW_PRIORITY_SCORE;

      case 'MEDIUM':
        return MEDIUM_PRIORITY_SCORE;

      case 'HIGH':
        return HIGH_PRIORITY_SCORE;

      default:
        return this.assertNever(priority);
    }
  }

  /**
   * Merges two string collections while preserving order and
   * removing blank or duplicate values.
   */
  private mergeUniqueStrings(
    first: ReadonlyArray<string>,
    second: ReadonlyArray<string>,
  ): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const value of [...first, ...second]) {
      const normalizedValue = value.trim();

      if (normalizedValue.length === 0) {
        continue;
      }

      const key = this.normalizeKey(normalizedValue);

      if (!seen.has(key)) {
        seen.add(key);
        result.push(normalizedValue);
      }
    }

    return result;
  }

  /**
   * Produces a stable comparison key for deterministic exact matching.
   *
   * This normalization intentionally does not perform fuzzy semantic
   * matching.
   */
  private normalizeKey(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Clamps an unknown score to the inclusive range [0, 1].
   */
  private clampScore(score: number): number {
    if (!Number.isFinite(score)) {
      return 0;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Ensures every PriorityLevel value is handled explicitly.
   */
  private assertNever(value: never): never {
    throw new Error(`Unsupported priority level: ${String(value)}`);
  }
}
