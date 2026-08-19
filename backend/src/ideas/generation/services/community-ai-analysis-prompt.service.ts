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
import { evaluateRequestIntentAlignment } from '../utils/request-intent-alignment.util';

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
    const prioritizedCanonicalEvidence = this.prioritizeEvidenceForRequest(
      canonicalEvidence,
      context.requestDescription,
    );
    const requestAlignedEvidence = context.requestDescription?.trim()
      ? this.selectRequestAlignedEvidence(
          prioritizedCanonicalEvidence,
          context.requestDescription,
        )
      : [];

    return {
      systemInstruction: this.buildSystemInstruction(),
      userPrompt: JSON.stringify({
        task: `Keep each opportunity tied to one atomic problem. Do not merge distinct failures, requests, or workflow gaps merely because one product could address them; preserve them as separate opportunities so a later stage can combine compatible directions if justified. Every opportunities item must be a JSON object, never a string.

Analyze cleaned community evidence and extract up to ${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} concise, non-duplicated software opportunities. Opportunities may belong to different domains. When two or more domains contribute to one connected workflow, preserve them as separate evidence-grounded components that a later stage can combine into one cross-domain product. Return fewer rather than inventing unsupported opportunities.`,
        primaryDomain: { id: context.domainId, name: context.domainName },
        requestDescription: context.requestDescription,
        preCollectionPlan: context.collectionPlan
          ? {
              evidenceTargets: context.collectionPlan.evidenceTargets.slice(0, 6),
              intentConcepts: context.collectionPlan.intentConcepts.slice(0, 8),
              sourceFocus: context.collectionPlan.sourceFocus,
            }
          : null,
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
        requestAlignedEvidence,
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
          semanticallyRefineRetainedNlpCandidatesFirst: true,
          evidenceQuoteWordingMayDifferFromOpportunityWording: true,
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
            prioritizedCanonicalEvidence,
          ),
          extractedNeeds: this.enrichEvidenceFragments(
            this.compactJson(context.nlp.extractedNeeds),
            prioritizedCanonicalEvidence,
          ),
          featureRequests: this.enrichEvidenceFragments(
            this.compactJson(context.nlp.featureRequests),
            prioritizedCanonicalEvidence,
          ),
          existingOpportunities: this.enrichEvidenceFragments(
            this.compactJson(context.nlp.opportunities),
            prioritizedCanonicalEvidence,
          ),
          dataQuality: this.compactJson(context.nlp.dataQuality),
        },
        cleanedCommunitySamples: {
          posts: this.normalizeSamples(context.nlp.samplePosts),
          comments: this.normalizeSamples(context.nlp.sampleComments),
          canonicalEvidence: prioritizedCanonicalEvidence,
          retainedEvidence: this.collectRetainedEvidenceSamples(
            context,
            prioritizedCanonicalEvidence,
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
      'Treat nlpSummary.featureRequests, recurringProblems, extractedNeeds, and existingOpportunities as high-priority semantic anchors when they already contain retained evidence. Refine those grounded signals into professional opportunity wording instead of replacing them with unrelated ideas.',
      'The opportunity title/problem may paraphrase the evidence semantically, but evidenceSamples itself must remain a verbatim supplied quote. For example, long-term rental discovery friction may be grounded by a lease-term filtering request when both describe the same rental-duration problem.',
      'One evidence quote may ground only one atomic opportunity. Merge only semantically equivalent reports of the same atomic problem; keep distinct causes, symptoms, failures, and requests separate even if one future product could address them.',
      'Within each opportunity, title, problem, unmetNeed, solutionArea, affectedUsers, and evidenceSamples must all describe the same atomic problem. Do not introduce a second workflow, domain, technology, cause, or solution mechanism that is absent from the retained evidence.',
      'Respect explicit negation. Phrases such as "not crashing", "never crashes", "without crashing", or "no crash" are not crash evidence. A keyboard that only appears frozen because focus is trapped or keystrokes are captured is a navigation/accessibility problem, not a runtime crash.',
      'Treat words by workflow context rather than substring similarity: a physical scratch is not an application crash, a host computer mentioned in a networking topology is not cross-device access evidence, and changing a container network configuration is not feature-removal evidence.',
      'Do not classify narrative phrases such as "I need you to know" or "I want you to understand" as feature requests unless the same sentence explicitly requests a product capability, option, or supported action.',
      'Do not classify retrospective praise such as "I wish I had this app when...", "I wish I knew about this earlier", or "I wish this existed before" as a feature request. A valid wish/request must ask for a capability, option, supported action, or change to the product.',
      'Domain-specific vocabulary must be supported by the same retained evidence. Never introduce clinical/medical terminology into non-health evidence, therapeutic-persona language without an explicit persona/voice regression, or security/legal/finance terminology from generic words such as measurement, access, record, or verification.',
      'Do not introduce authentication, credentials, passwords, or account-management claims unless the retained evidence itself describes login, authentication, credentials, passwords, or account access. Life-event record updates across agencies are record-update coordination, not credential management.',
      'Do not infer a specific authentication mechanism from generic account-access evidence: if the quote only says the user cannot access an account, do not add Google, Apple, OAuth, email sign-up, MFA, 2FA, or identity-provider restrictions unless the quote explicitly names them.',
      'Do not turn a generic LLM or streaming bug into an AI-coding, generated-code, repository, refactoring, or code-quality opportunity unless the retained quote explicitly discusses coding or generated code.',
      'Authentication verification codes, MFA, and 2FA are account-access workflows; they are not evidence of a security-audit, vulnerability-management, legal-verification, or AI-application-cost problem unless those concepts are explicitly present in the same retained evidence.',
      'For every selected domain with at least one supplied direct evidence sample, return at least one opportunity for that domain when the configured opportunity limit allows it.',
      'Treat the requester problem-scope as a mandatory selection constraint whenever requestDescription is present. An opportunity that does not materially address that described workflow may be returned only as a fallback diagnostic and must not be presented as the primary requested opportunity.',
      'When requestAlignedEvidence is non-empty, the primary requester-facing opportunity must be grounded by one of those exact quotes. Inspect them before lower-ranked samples and prefer the strongest direct complaint that materially matches the requester workflow. Same-domain evidence with weak requester alignment must not outrank a better request-aligned quote from another selected domain.',
      'If one quote begins with praise but later reports a concrete failure, loss, delay, incorrect result, blocked action, missing item, or dispute, the failure clause is the atomic problem. Never use the praise sentence itself as the opportunity problem.',
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
    const requestDescription = context.requestDescription?.trim() ?? '';
    const sorted = perDomain.map((samples) =>
      samples
        .map((sample) => ({
          sample,
          requestScore: requestDescription
            ? this.scoreEvidenceAgainstRequest(requestDescription, sample)
            : 0,
          matchesNlpFragment: nlpFragments.some((fragment) =>
            this.evidenceTextsOverlap(fragment, sample),
          ),
        }))
        .sort((left, right) => {
          if (requestDescription && left.requestScore !== right.requestScore) {
            return right.requestScore - left.requestScore;
          }
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
      return {
        domainName: domain.name,
        samples: this.prioritizeEvidenceForRequest(
          [...new Set(samples)],
          context.requestDescription,
        ).slice(0, COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP),
      };
    });
  }

  private selectRequestAlignedEvidence(
    samples: readonly string[],
    requestDescription: string,
  ): string[] {
    const requestTokens = this.extractEvidencePriorityTokens(requestDescription);

    return samples
      .filter((sample) => {
        const alignment = evaluateRequestIntentAlignment(requestDescription, {
          title: sample.slice(0, 160),
          problemStatement: sample,
          objectives: [],
          targetUsers: [],
          fullAbstract: sample,
        });
        const evidenceTokens = this.extractEvidencePriorityTokens(sample);
        const sharedPriorityTokenCount = [...requestTokens].filter((token) =>
          evidenceTokens.has(token),
        ).length;
        const workflowConceptCoverage = this.scoreWorkflowConceptCoverage(
          requestDescription,
          sample,
        );
        const problemOrNeedSignal =
          /\b(?:cannot|can't|unable|failed|failure|broken|wrong|incorrect|inaccurate|missing|lost|late|delayed|delay|blocked|denied|flagged|fraud|fraudulent|chargeback|dispute|refund|duplicate|stain|ruined|damaged|crash|freez|error|problem|frustrat|difficult|not working|doesn't work|did not|won't|wish|need|should|would like|feature request)\w*\b/iu.test(
            sample,
          );

        return (
          (problemOrNeedSignal && workflowConceptCoverage >= 0.3) ||
          workflowConceptCoverage >= 0.45 ||
          sharedPriorityTokenCount >= 3 ||
          (problemOrNeedSignal &&
            workflowConceptCoverage >= 0.25 &&
            (sharedPriorityTokenCount >= 2 || alignment.sharedTokenCount >= 2))
        );
      })
      .slice(0, Math.min(COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS, 6));
  }

  private prioritizeEvidenceForRequest(
    samples: readonly string[],
    requestDescription: string | null | undefined,
  ): string[] {
    const description = requestDescription?.trim();
    if (!description || samples.length <= 1) {
      return [...samples];
    }

    return samples
      .map((sample, index) => ({
        sample,
        index,
        score: this.scoreEvidenceAgainstRequest(description, sample),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.index - right.index,
      )
      .map(({ sample }) => sample);
  }

  private scoreEvidenceAgainstRequest(
    requestDescription: string,
    evidence: string,
  ): number {
    const alignment = evaluateRequestIntentAlignment(requestDescription, {
      title: evidence.slice(0, 160),
      problemStatement: evidence,
      objectives: [],
      targetUsers: [],
      fullAbstract: evidence,
    });
    const requestTokens = this.extractEvidencePriorityTokens(requestDescription);
    const evidenceTokens = this.extractEvidencePriorityTokens(evidence);
    const sharedTokenCount = [...requestTokens].filter((token) =>
      evidenceTokens.has(token),
    ).length;
    const lexicalCoverage =
      requestTokens.size > 0 ? sharedTokenCount / requestTokens.size : 0;
    const workflowConceptCoverage = this.scoreWorkflowConceptCoverage(
      requestDescription,
      evidence,
    );
    const directProblemSignal =
      /\b(?:cannot|can't|unable|failed|failure|broken|wrong|incorrect|inaccurate|missing|lost|late|delayed|delay|blocked|denied|flagged|fraud|fraudulent|chargeback|dispute|refund|duplicate|stain|ruined|damaged|crash|freez|error|problem|frustrat|difficult|not working|doesn't work|did not|won't)\w*\b/iu.test(
        evidence,
      )
        ? 0.1
        : 0;
    const positiveOnlyPenalty =
      /\b(?:love|great|excellent|perfect|amazing|highly recommend|works flawlessly)\b/iu.test(
        evidence,
      ) &&
      directProblemSignal === 0
        ? 0.18
        : 0;

    return (
      workflowConceptCoverage * 0.42 +
      alignment.score * 0.22 +
      alignment.problemScore * 0.14 +
      lexicalCoverage * 0.22 +
      directProblemSignal -
      positiveOnlyPenalty
    );
  }

  private extractEvidencePriorityTokens(value: string): Set<string> {
    const stopWords = new Set([
      'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been',
      'before', 'being', 'between', 'both', 'but', 'can', 'could', 'different',
      'during', 'each', 'from', 'have', 'into', 'just', 'large', 'many', 'more',
      'most', 'often', 'only', 'other', 'same', 'several', 'should', 'small',
      'some', 'still', 'struggle', 'struggles', 'struggling', 'such', 'than',
      'that', 'their', 'them', 'there', 'these', 'they', 'this', 'those',
      'through', 'usually', 'very', 'when', 'where', 'which', 'while', 'with',
      'without', 'would', 'application', 'applications', 'data', 'digital',
      'information', 'management', 'platform', 'platforms', 'problem', 'problems',
      'service', 'services', 'software', 'system', 'systems', 'user', 'users',
      'workflow', 'workflows',
      'blockchain', 'web3', 'finance', 'financial', 'fintech', 'legaltech',
      'legal', 'cybersecurity', 'security', 'ecommerce', 'commerce',
      'artificial', 'intelligence', 'healthcare', 'government', 'logistics',
    ]);
    const aliases: Readonly<Record<string, string>> = {
      purchases: 'purchase',
      transactions: 'transaction',
      payments: 'payment',
      settlements: 'settlement',
      agreements: 'agreement',
      approvals: 'approval',
      verifications: 'verification',
      documents: 'document',
      disputes: 'dispute',
      chargebacks: 'chargeback',
      garments: 'garment',
      clothes: 'clothing',
      instructions: 'instruction',
      stains: 'stain',
      deadlines: 'deadline',
      orders: 'order',
      items: 'item',
      requirements: 'requirement',
      regulations: 'regulation',
      contracts: 'contract',
      applications: 'application',
      inconsistencies: 'inconsistency',
      devices: 'device',
      signals: 'signal',
    };

    return new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/\bpick\s+up\b/gu, 'pickup')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .map((token) => aliases[token] ?? token)
        .filter((token) => token.length >= 4 && !stopWords.has(token)),
    );
  }

  private scoreWorkflowConceptCoverage(
    requestDescription: string,
    evidence: string,
  ): number {
    const request = requestDescription.normalize('NFKC').toLocaleLowerCase();
    const sample = evidence.normalize('NFKC').toLocaleLowerCase();

    const conceptGroups: readonly RegExp[] = [
      /\b(?:payment|payments|settlement|settlements|transfer|transfers|fees?|invoice|billing|charge|charges)\b/iu,
      /\b(?:contract|contracts|agreement|agreements|contractual|clause|clauses|terms|legal document|legal documents)\b/iu,
      /\b(?:approval|approvals|verification|verify|verified|kyc|kyb|compliance|requirement|requirements)\b/iu,
      /\b(?:record|records|document|documents|version|versions|source of truth|audit trail|provenance)\b/iu,
      /\b(?:delay|delays|delayed|freeze|freezes|blocked|pending|dispute|disputes|reconciliation|reconcile|mismatch|error|errors)\b/iu,
      /\b(?:fraud|fraudulent|chargeback|chargebacks|account takeover|risk signal|risk signals|suspicious|false decline|false positive)\b/iu,
      /\b(?:booking|bookings|appointment|appointments|schedule|scheduling|session|sessions)\b/iu,
      /\b(?:shot list|shot lists|editing request|editing requests|image selection|image selections|photo selection|photo selections|gallery selection|gallery selections)\b/iu,
      /\b(?:equipment|gear|camera|cameras|lens|lenses|lighting kit|checklist|checklists)\b/iu,
      /\b(?:delivery deadline|delivery deadlines|final photos|photo delivery|client delivery|pickup deadline|pickup deadlines)\b/iu,
      /\b(?:garment|garments|stain|stains|cleaning instruction|cleaning instructions|dry cleaning|laundry|treatment)\b/iu,
      /\b(?:inventory|tracking|track|status|handoff|lost item|lost items|missing item|missing items)\b/iu,
      /\b(?:login|sign in|signin|authentication|2fa|mfa|oauth|credential|credentials|account access|identity provider)\b/iu,
      /\b(?:crash|crashes|bug|bugs|glitch|glitches|not working|failure|failures|unresponsive|sync|synchronization)\b/iu,
      /\b(?:separate systems|multiple systems|disconnected|scattered|fragmented|silo|silos|folders|messages|calendar|calendars|handwritten notes)\b/iu,
    ];

    const requestedGroups = conceptGroups.filter((pattern) => pattern.test(request));
    if (requestedGroups.length === 0) {
      return 0;
    }

    const matchedGroups = requestedGroups.filter((pattern) => pattern.test(sample));
    return matchedGroups.length / requestedGroups.length;
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