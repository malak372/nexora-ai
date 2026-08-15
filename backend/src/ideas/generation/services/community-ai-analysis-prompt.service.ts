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

    const canonicalEvidence = this.collectCanonicalEvidenceSamples(context);

    return {
      systemInstruction: this.buildSystemInstruction(),
      userPrompt: JSON.stringify({
        task: `When related recurring problems can be solved by one coherent product, merge them into one compound opportunity and preserve evidence for every component. Never merge unrelated problems. Every opportunities item must be a JSON object, never a string.

Analyze cleaned community evidence and extract up to ${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} concise, non-duplicated software opportunities. Opportunities may belong to different domains. When two or more domains contribute to one connected workflow, preserve them as compatible components that a later stage can combine into one cross-domain product. Return fewer rather than inventing unsupported opportunities.`,
        primaryDomain: { id: context.domainId, name: context.domainName },
        requestDescription: context.requestDescription,
        selectedDomains: context.selectedDomains.map((domain) => ({
          id: domain.id,
          name: domain.name,
          configuredKeywords: (domain.configuredKeywords ?? []).slice(0, 6),
          effectiveSearchKeywords: (
            domain.effectiveSearchKeywords ?? domain.keywords
          ).slice(0, 8),
        })),
        location: context.location,
        domainEvidencePortfolio: this.buildDomainEvidencePortfolio(context),
        requestedKeywords: context.keywords.slice(0, 12),
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
        /*
         * Keep the online enrichment prompt small. The verbatim evidence is
         * already supplied below, so repeating sentiment/topic/keyword payloads
         * only increases provider latency without strengthening grounding.
         */
        nlpSummary: {
          totalTextsAnalyzed: context.nlp.totalTextsAnalyzed,
          totalPostsAnalyzed: context.nlp.totalPostsAnalyzed,
          totalCommentsAnalyzed: context.nlp.totalCommentsAnalyzed,
          confidence: context.nlp.confidence,
          recurringProblems: this.enrichEvidenceFragments(
            this.compactJson(context.nlp.recurringProblems),
            canonicalEvidence,
          ),
          extractedNeeds: this.enrichEvidenceFragments(
            this.compactJson(context.nlp.extractedNeeds),
            canonicalEvidence,
          ),
          featureRequests: this.enrichEvidenceFragments(
            this.compactJson(context.nlp.featureRequests),
            canonicalEvidence,
          ),
          existingOpportunities: this.enrichEvidenceFragments(
            this.compactJson(context.nlp.opportunities),
            canonicalEvidence,
          ),
          dataQuality: this.compactJson(context.nlp.dataQuality),
        },
        cleanedCommunitySamples: {
          posts: this.normalizeSamples(context.nlp.samplePosts),
          comments: this.normalizeSamples(context.nlp.sampleComments),
          canonicalEvidence,
          retainedEvidence: this.collectRetainedEvidenceSamples(
            context,
            canonicalEvidence,
          ),
        },
      }),
    };
  }

  private buildSystemInstruction(): string {
    /*
     * Provider-facing instructions are intentionally compact. Grounding rules
     * remain strict, but removing repeated prose substantially lowers input
     * tokens and gives the online community-analysis race a better chance to
     * finish inside its sub-five-second request budget.
     */
    return [
      'You are Voxidence community research analyst.',
      'Return one JSON object only; never use Markdown.',
      `Return 0-${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} evidence-grounded software opportunities.`,
      'Use only supplied cleanedCommunitySamples and retained NLP evidence.',
      'Never invent local facts, statistics, regulations, market size, recurrence, or user behavior.',
      'A single explicit complaint, failure, cost, security risk, missing capability, or feature request may support one preliminary opportunity with frequency 1.',
      'Do not reject a valid direct complaint only because independent recurrence is not established; later ranking handles recurrence.',
      'Treat cleanedCommunitySamples.canonicalEvidence as the authoritative richest quotes. If a shorter fragment is repeated elsewhere, use the canonical full quote instead.',
      'Prefer complete evidence that contains both the cause/context and the user impact over short fragments from the same report.',
      'Every opportunity must include at least one verbatim evidenceSamples item copied exactly from supplied evidence.',
      'One evidence quote may ground only one opportunity. Merge equivalent complaints and keep unrelated problems separate.',
      'For every selected domain with at least one supplied direct evidence sample, return at least one opportunity for that domain when the configured opportunity limit allows it.',
      'Treat the requester problem-scope as a mandatory selection constraint whenever requestDescription is present. An opportunity that does not materially address that described workflow may be returned only as a fallback diagnostic and must not be presented as the primary requested opportunity.',
      'Specific requester anchors such as homework/assignment, login/authentication, checkout/payment, or another named workflow/object must remain present in the selected problem when they are part of requestDescription; a merely same-domain problem is not sufficient.',
      'The requester problem-scope intent is a scope constraint only and is never evidence.',
      'domainName must exactly match one selectedDomains.name value.',
      'When selected domains lack evidence, add a quality warning instead of inventing an opportunity.',
      'Location is pilot context, never proof. localEvidenceAvailable is true only when evidence explicitly names the requested location.',
      'Keep problem, unmetNeed, solutionArea, and title concise professional English. Do not copy URLs, marketing copy, tutorial titles, or publisher promotion as a problem.',
      'frequency is the count of distinct supplied evidence samples for that exact problem family.',
      'Use conservative confidence for single-report opportunities and mention broader validation as a risk.',
      'Use exact root keys: summary, dominantProblems, unmetNeeds, opportunities, overallConfidence, qualityWarnings.',
      'Each opportunity must use exact keys: domainName, title, problem, unmetNeed, solutionArea, affectedUsers, evidenceSamples, frequency, severity, confidence, problemImportance, localEvidenceAvailable, localEvidenceSamples, localRelevance, technicalFeasibility, marketPotential, innovationPotential, risks.',
      'dominantProblems, unmetNeeds, affectedUsers, evidenceSamples, localEvidenceSamples, risks, qualityWarnings are arrays of strings.',
      'severity is LOW, MEDIUM, HIGH, or CRITICAL; all score fields are numbers from 0 to 100; frequency is a positive integer.',
      'Return fewer opportunities rather than unsupported or duplicated ones.',
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
    canonicalEvidence: readonly string[],
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

    return [...new Set(
      extracted.map((sample) =>
        this.resolveCanonicalEvidence(sample, canonicalEvidence),
      ),
    )].slice(0, COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS);
  }

  /**
   * Builds the richest authoritative quote list from domainEvidence. The
   * collection stage has already deduplicated these entries by real provenance
   * identity, so this is a safer source for provider grounding than short NLP
   * fragments produced by deterministic problem extraction.
   */
  private collectCanonicalEvidenceSamples(
    context: IdeaGenerationContext,
  ): readonly string[] {
    const perDomain = (context.domainEvidence ?? []).map((domain) => {
      const samples: string[] = [];
      const visit = (value: unknown): void => {
        if (typeof value === 'string') {
          const normalized = value.replace(/\s+/gu, ' ').trim();
          if (normalized.length >= 24) {
            samples.push(
              normalized.slice(0, COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH),
            );
          }
          return;
        }
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          const text = record.text ?? record.content ?? record.body ?? record.sample;
          if (typeof text === 'string') visit(text);
        }
      };
      visit(domain.sampleComments);
      visit(domain.samplePosts);
      return [...new Set(samples)];
    });

    const nlpFragments = this.collectNlpEvidenceFragments(context);
    const sorted = perDomain.map((samples) =>
      samples
        .map((sample) => ({
          sample,
          matchesNlpFragment: nlpFragments.some((fragment) =>
            this.evidenceTextsOverlap(fragment, sample),
          ),
        }))
        .sort((left, right) => {
          if (left.matchesNlpFragment !== right.matchesNlpFragment) {
            return left.matchesNlpFragment ? -1 : 1;
          }
          return right.sample.length - left.sample.length;
        })
        .map(({ sample }) => sample),
    );

    const result: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; result.length < COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS; index += 1) {
      let added = false;
      for (const samples of sorted) {
        const sample = samples[index];
        if (!sample || seen.has(sample)) continue;
        seen.add(sample);
        result.push(sample);
        added = true;
        if (result.length >= COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS) break;
      }
      if (!added) break;
    }

    return result;
  }

  private buildDomainEvidencePortfolio(
    context: IdeaGenerationContext,
  ): readonly {
    readonly domainName: string;
    readonly samples: readonly string[];
  }[] {
    return (context.selectedDomains ?? []).map((domain) => {
      const profile = (context.domainEvidence ?? []).find(
        (item) => item.domainId === domain.id ||
          item.domainName.trim().toLocaleLowerCase() === domain.name.trim().toLocaleLowerCase(),
      );
      const samples: string[] = [];
      const append = (value: unknown): void => {
        if (!Array.isArray(value)) return;
        for (const entry of value) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const text = (entry as Record<string, unknown>).text;
          if (typeof text !== 'string') continue;
          const normalized = text.replace(/\s+/gu, ' ').trim();
          if (normalized.length < 24) continue;
          samples.push(normalized.slice(0, COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH));
          if (samples.length >= COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP) break;
        }
      };
      append(profile?.sampleComments);
      append(profile?.samplePosts);
      return { domainName: domain.name, samples: [...new Set(samples)] };
    });
  }

  private collectNlpEvidenceFragments(
    context: IdeaGenerationContext,
  ): readonly string[] {
    const fragments: string[] = [];

    const visit = (value: unknown, parentKey = ''): void => {
      if (typeof value === 'string') {
        if (
          ['evidenceSamples', 'samplePosts', 'sampleComments', 'localEvidenceSamples'].includes(
            parentKey,
          )
        ) {
          const normalized = value.replace(/\s+/gu, ' ').trim();
          if (normalized.length >= 8) fragments.push(normalized);
        }
        return;
      }

      if (Array.isArray(value)) {
        for (const entry of value) visit(entry, parentKey);
        return;
      }

      if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
          visit(entry, key);
        }
      }
    };

    visit(context.nlp?.recurringProblems);
    visit(context.nlp?.extractedNeeds);
    visit(context.nlp?.featureRequests);
    visit(context.nlp?.opportunities);

    return [...new Set(fragments)];
  }

  private evidenceTextsOverlap(first: string, second: string): boolean {
    const left = this.normalizeEvidenceText(first);
    const right = this.normalizeEvidenceText(second);

    if (!left || !right) return false;
    if (left === right || left.includes(right) || right.includes(left)) {
      return true;
    }

    const leftTokens = new Set(
      left.split(' ').filter((token) => token.length >= 3),
    );
    const rightTokens = new Set(
      right.split(' ').filter((token) => token.length >= 3),
    );
    if (leftTokens.size === 0 || rightTokens.size === 0) return false;

    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    const smaller = Math.min(leftTokens.size, rightTokens.size);

    return smaller >= 4 && shared / smaller >= 0.72;
  }

  /** Replaces short evidence fragments with a matching richer canonical quote. */
  private enrichEvidenceFragments(
    value: Prisma.JsonValue | null | undefined,
    canonicalEvidence: readonly string[],
    parentKey = '',
  ): Prisma.JsonValue | null {
    if (value == null) return null;

    if (typeof value === 'string') {
      if (!['evidenceSamples', 'samplePosts', 'sampleComments', 'localEvidenceSamples'].includes(parentKey)) {
        return value;
      }
      return this.resolveCanonicalEvidence(value, canonicalEvidence);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((entry) =>
          this.enrichEvidenceFragments(entry, canonicalEvidence, parentKey),
        )
        .filter((entry): entry is Prisma.JsonValue => entry !== null);
    }

    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]): [string, Prisma.JsonValue | null] => [
          key,
          this.enrichEvidenceFragments(entry, canonicalEvidence, key),
        ])
        .filter(
          (entry): entry is [string, Prisma.JsonValue] => entry[1] !== null,
        ),
    );
  }

  private resolveCanonicalEvidence(
    sample: string,
    canonicalEvidence: readonly string[],
  ): string {
    const normalizedSample = this.normalizeEvidenceText(sample);
    if (!normalizedSample) return sample;

    const matches = canonicalEvidence.filter((candidate) =>
      this.evidenceTextsOverlap(sample, candidate),
    );

    if (matches.length === 0) return sample;
    return matches.sort((left, right) => right.length - left.length)[0];
  }

  private normalizeEvidenceText(value: string): string {
    return value
      .toLowerCase()
      .replace(/^[^.]{0,180}\.\s*community comment:\s*/u, '')
      .replace(/^community comment:\s*/u, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
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