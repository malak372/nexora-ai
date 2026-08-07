import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH,
  COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP,
  COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS,
  COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
  COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES,
} from '../constants/community-ai-analysis.constants';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

export type CommunityAiAnalysisPrompt = {
  readonly systemInstruction: string;
  readonly userPrompt: string;
};

/** Builds a bounded evidence-only prompt for community opportunity extraction. */
@Injectable()
export class CommunityAiAnalysisPromptService {
  build(context: IdeaGenerationContext): CommunityAiAnalysisPrompt {
    if (!context.nlp) {
      throw new Error('NLP context is required before community AI analysis.');
    }

    return {
      systemInstruction: this.buildSystemInstruction(),
      userPrompt: JSON.stringify({
        task: `When related recurring problems can be solved by one coherent product, merge them into one compound opportunity and preserve evidence for every component. Never merge unrelated problems. Every opportunities item must be a JSON object, never a string.

Analyze cleaned community evidence and extract up to ${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} concise, non-duplicated software opportunities. Opportunities may belong to different domains. When two or more domains contribute to one connected workflow, preserve them as compatible components that a later stage can combine into one cross-domain product. Return fewer rather than inventing unsupported opportunities.`,
        primaryDomain: { id: context.domainId, name: context.domainName },
        selectedDomains: context.selectedDomains.map((domain) => ({
          id: domain.id,
          name: domain.name,
          keywords: domain.keywords.slice(0, 20),
        })),
        location: context.location,
        requestedKeywords: context.keywords,
        evidenceRules: {
          useOnlySuppliedEvidence: true,
          doNotInventLocalFacts: true,
          locationIsContextNotEvidence: true,
          preserveEvidenceMeaning: true,
          avoidGenericOpportunities: true,
          mergeEquivalentProblems: true,
          oneEvidenceQuoteSupportsOneOpportunity: true,
          chooseDominantAtomicProblemWhenQuoteContainsMultipleIssues: true,
          returnEvidenceQuotesExactly: true,
          doNotParaphraseEvidence: true,
          distinguishObservedProblemFromProposedSolution: true,
          scoresArePreliminaryEstimates: true,
          requireDistinctProblemFamilies: true,
          requireDomainCoverageWhenEvidenceSupportsIt: true,
        },
        nlpSummary: {
          totalTextsAnalyzed: context.nlp.totalTextsAnalyzed,
          totalPostsAnalyzed: context.nlp.totalPostsAnalyzed,
          totalCommentsAnalyzed: context.nlp.totalCommentsAnalyzed,
          confidence: context.nlp.confidence,
          sentimentStats: this.compactJson(context.nlp.sentimentStats),
          keywords: this.compactJson(context.nlp.keywords),
          topics: this.compactJson(context.nlp.topics),
          recurringProblems: this.compactJson(context.nlp.recurringProblems),
          extractedNeeds: this.compactJson(context.nlp.extractedNeeds),
          featureRequests: this.compactJson(context.nlp.featureRequests),
          existingOpportunities: this.compactJson(context.nlp.opportunities),
          insights: this.compactJson(context.nlp.insights),
          dataQuality: this.compactJson(context.nlp.dataQuality),
        },
        cleanedCommunitySamples: {
          posts: this.normalizeSamples(context.nlp.samplePosts),
          comments: this.normalizeSamples(context.nlp.sampleComments),
          retainedEvidence: this.collectRetainedEvidenceSamples(context),
        },
      }),
    };
  }

  private buildSystemInstruction(): string {
    return [
      'You are Voxidence community research analyst.',
      'Extract evidence-grounded software opportunities from the supplied cleaned community data.',
      'Do not generate finished project ideas, product names, architectures, or implementation plans.',
      'Identify recurring problems, unmet needs, affected users, and solution areas only.',
      `Return between ${COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES} and ${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} materially distinct opportunities when evidence supports that range; return fewer only when additional opportunities would be unsupported or duplicative.`,
      'Cover different problem families and user jobs instead of producing wording variations of one complaint.',
      'When selectedDomains contains multiple domains, assign every opportunity to exactly one selected domain using domainName and return at least one evidence-backed opportunity per selected domain whenever supplied evidence supports it.',
      'Do not invent an opportunity merely to fill a missing domain. Add a quality warning naming any domain whose supplied evidence was insufficient.',
      'Do not combine unrelated problem dimensions inside one opportunity. Keep domain-specific evidence units atomic so the idea-generation stage can combine only compatible units into one cross-domain workflow.',
      'A single evidence quote may ground only one returned opportunity. When one quote mentions multiple issues, select the most concrete actionable user problem as the primary opportunity and mention the secondary issue only as context or a risk; do not emit a second opportunity backed by the same quote.',
      'Two opportunities must not contain the same normalized evidence quote. If their evidenceSamples overlap exactly, merge them into one atomic opportunity and choose the title/problem pair that best matches the dominant user job.',
      'For example, session recovery and storage persistence must remain separate opportunities when they come from different comments. A multi-part title is allowed only when at least one supplied quote explicitly supports all included parts.',
      'Set frequency from the number of distinct supplied evidence samples supporting that exact problem family. Never copy topic frequency, keyword frequency, or the total number of mentions into opportunity frequency.',
      'Order opportunities from strongest to weakest evidence support, while preserving different confidence values rather than assigning the same score to every item.',
      'Keep summary under 260 characters. Keep each problem, unmetNeed, and solutionArea under 150 characters. Keep affectedUsers to at most 2 short items, risks to at most 2 short items, and evidenceSamples to exactly 1 strongest supplied quote per opportunity. Return compact JSON only; no markdown and no explanatory prose outside the schema.',
      'Never derive a problem from publisher marketing copy, app feature listings, product descriptions, tutorials, or promotional promises. Such text may describe an existing solution but is not evidence that users experience the claimed problem.',
      'Treat video titles, article headlines, app-store descriptions, review-video descriptions, calls to action, download links, referral links, and phrases such as check out, app review, download, install, subscribe, or link in description as non-problem context unless an explicit user complaint appears separately in the supplied evidence.',
      'Never place URLs, tracking parameters, store links, creator calls to action, channel promotion, or publisher copy inside title, problem, unmetNeed, solutionArea, dominantProblems, or unmetNeeds.',
      'Write title, problem, unmetNeed, and solutionArea in polished professional English. Correct grammar, remove fragments and filler, preserve the factual meaning of the evidence, and prefer precise user-impact language over copying raw wording.',
      'A problem statement must describe an observed user difficulty, failure, cost, risk, delay, missing capability, or repeated manual effort. A question, topic headline, product review title, or tutorial title by itself is not a problem statement.',
      'If the evidence is too weak to support a clean problem statement, return fewer opportunities or an empty opportunities array rather than converting a headline into a user problem.',
      'A single explicit direct user complaint, failure, cost, security risk, missing capability, or concrete request is sufficient to return one preliminary opportunity with frequency 1. Do not return an empty opportunities array solely because independent recurrence has not yet been established; recurrence is verified by a later ranking stage.',
      'When exactly one direct evidence sample supports a problem, keep the opportunity cautious: describe one reported case, set frequency to 1, keep confidence conservative, and add a risk or quality warning that broader validation is required. Do not generalize the report into a market-wide pattern.',
      'Prefer explicit first-person complaints, review comments, bug reports, failures, missing capabilities, and direct requests. When none exists, return fewer opportunities rather than converting product features into unmet needs.',
      'Every opportunity must include at least one supplied evidence sample; use two or more distinct samples when available for that problem family.',
      'Do not fabricate facts, statistics, regulations, market sizes, local conditions, or user behavior.',
      'Treat country, city, region, requested keywords, and source selection as context rather than proof.',
      'Merge semantically equivalent complaints and avoid generic labels such as app, platform, issue, or solution.',
      'Use cautious wording when evidence is limited.',
      'Return one JSON object only. Do not wrap it in Markdown.',
      'Use these exact root keys: summary, dominantProblems, unmetNeeds, opportunities, overallConfidence, qualityWarnings.',
      'Every opportunity must use these exact keys: domainName, title, problem, unmetNeed, solutionArea, affectedUsers, evidenceSamples, frequency, severity, confidence, problemImportance, localEvidenceAvailable, localEvidenceSamples, localRelevance, technicalFeasibility, marketPotential, innovationPotential, risks.',
      'domainName must exactly equal one selectedDomains.name value. dominantProblems, unmetNeeds, affectedUsers, evidenceSamples, localEvidenceSamples, risks, and qualityWarnings must be arrays of strings.',
      'Set localEvidenceAvailable to true only when a supplied evidence quote explicitly mentions the requested country, city, or region.',
      'When localEvidenceAvailable is false, localEvidenceSamples must be empty, localRelevance must not exceed 25, and risks must not invent location-specific infrastructure, expertise, economic, or regulatory claims.',
      'Every evidenceSamples item must be copied verbatim from one supplied cleanedCommunitySamples posts, comments, or retainedEvidence value. Do not paraphrase, summarize, translate, combine, or rewrite evidence text.',
      'All score fields must be numbers from 0 to 100. frequency must be a positive integer. severity must be LOW, MEDIUM, HIGH, or CRITICAL. Confidence, importance, feasibility, market potential, innovation potential, and local relevance must be assessed independently and should vary when evidence strength differs.',
      'Never return objects inside dominantProblems or unmetNeeds.',
      'Each opportunity must include concrete risks grounded in technical uncertainty, adoption constraints, evidence limitations, or integration boundaries; do not invent local regulations or infrastructure constraints.',
      'If fewer than the preferred minimum can be supported, return only the supported opportunities and add a quality warning explaining the evidence limitation instead of padding the response.',
      'If evidence is limited, still use the exact structure and add a quality warning rather than changing field names or types.',
    ].join(' ');
  }

  /**
   * Produces a bounded JSON representation of deterministic NLP summaries.
   *
   * Large evidence arrays are already sent through cleanedCommunitySamples.
   * Truncating nested summary payloads avoids repeating long quotes and keeps
   * the non-fatal enrichment request within a predictable latency budget.
   */
  private compactJson(
    value: Prisma.JsonValue | null | undefined,
    depth = 0,
  ): Prisma.JsonValue | null {
    if (value == null) {
      return null;
    }

    if (typeof value === 'string') {
      return value
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      if (depth >= 4) {
        return [];
      }

      return value
        .slice(0, COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS)
        .map((entry) => this.compactJson(entry, depth + 1))
        .filter((entry): entry is Prisma.JsonValue => entry !== null);
    }

    if (depth >= 4) {
      return {};
    }

    const compactedEntries = Object.entries(value)
      .slice(0, COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS)
      .map(([key, entry]): [string, Prisma.JsonValue | null] => [
        key,
        this.compactJson(entry, depth + 1),
      ])
      .filter(
        (entry): entry is [string, Prisma.JsonValue] => entry[1] !== null,
      );

    return Object.fromEntries(compactedEntries);
  }

  /**
   * Builds the authoritative provider evidence list from every retained NLP
   * location. Some NLP runs intentionally keep samplePosts/sampleComments null
   * while preserving verbatim quotes inside recurringProblems,
   * extractedNeeds, opportunities, or insights. Supplying those quotes here
   * prevents a compliant model from returning an empty opportunities array.
   */
  private collectRetainedEvidenceSamples(
    context: IdeaGenerationContext,
  ): readonly string[] {
    const extracted: string[] = [];
    const evidenceKeys = new Set([
      'evidenceSamples',
      'samplePosts',
      'sampleComments',
      'localEvidenceSamples',
    ]);

    const visit = (value: unknown, parentKey = ''): void => {
      if (extracted.length >= COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS) {
        return;
      }

      if (typeof value === 'string') {
        if (!evidenceKeys.has(parentKey)) {
          return;
        }

        const normalized = value.replace(/\s+/gu, ' ').trim();
        if (normalized.length >= 24) {
          extracted.push(
            normalized.slice(0, COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH),
          );
        }
        return;
      }

      if (Array.isArray(value)) {
        for (const entry of value) {
          visit(entry, parentKey);
          if (extracted.length >= COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS) {
            break;
          }
        }
        return;
      }

      if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
          if (evidenceKeys.has(key) || typeof entry === 'object') {
            visit(entry, key);
          }
          if (extracted.length >= COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS) {
            break;
          }
        }
      }
    };

    visit(context.nlp);

    return [...new Set(extracted)].slice(
      0,
      COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS,
    );
  }

  private normalizeSamples(value: Prisma.JsonValue | null): readonly string[] {
    const extracted: string[] = [];

    const visit = (entry: Prisma.JsonValue): void => {
      if (typeof entry === 'string') {
        const normalized = entry.replace(/\s+/gu, ' ').trim();
        if (normalized) {
          extracted.push(
            normalized.slice(0, COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH),
          );
        }
        return;
      }

      if (Array.isArray(entry)) {
        for (const child of entry) {
          visit(child);
          if (extracted.length >= COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP) {
            return;
          }
        }
        return;
      }

      if (entry && typeof entry === 'object') {
        for (const key of ['text', 'content', 'body', 'title', 'sample']) {
          const child = (entry as Record<string, Prisma.JsonValue>)[key];
          if (child !== undefined) {
            visit(child);
            break;
          }
        }
      }
    };

    if (value !== null) {
      visit(value);
    }

    return [...new Set(extracted)].slice(
      0,
      COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP,
    );
  }
}