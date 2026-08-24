import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH,
  COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP,
  COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS,
  COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
  COMMUNITY_AI_EVIDENCE_SYNTHESIS_MAX_ITEMS,
} from '../constants/community-ai-analysis.constants';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type { CommunityAiEvidenceTriage } from '../types/community-ai-analysis.type';
import { evaluateRequestIntentAlignment } from '../utils/request-intent-alignment.util';

export type CommunityAiAnalysisPrompt = {
  readonly systemInstruction: string;
  readonly userPrompt: string;
};

/** Builds a bounded evidence-only prompt for community opportunity extraction. */
@Injectable()
export class CommunityAiAnalysisPromptService {
  build(
    context: IdeaGenerationContext,
    evidenceClassifications: readonly CommunityAiEvidenceTriage[] = [],
  ): CommunityAiAnalysisPrompt {
    if (!context.nlp) {
      throw new Error('NLP context is required before community AI analysis.');
    }

    const rawById = new Map(
      (context.rawEvidenceCorpus ?? []).map((item) => [item.id, item] as const),
    );
    const verifiedEvidenceCorpus = evidenceClassifications
      .filter(
        (item) =>
          item.verifiedByDeterministicGuard &&
          item.classification !== 'UNRELATED' &&
          rawById.has(item.evidenceId),
      )
      .sort((left, right) => {
        const labelDifference =
          (left.classification === 'DIRECT_PROBLEM' ? 0 : 1) -
          (right.classification === 'DIRECT_PROBLEM' ? 0 : 1);
        return labelDifference || right.confidence - left.confidence;
      })
      .slice(0, COMMUNITY_AI_EVIDENCE_SYNTHESIS_MAX_ITEMS)
      .map((item) => {
        const raw = rawById.get(item.evidenceId)!;
        return {
          evidenceId: item.evidenceId,
          classification: item.classification,
          confidence: item.confidence,
          problemFamily: item.problemFamily,
          sourceKey: raw.sourceKey,
          sourceType: raw.sourceType,
          text: raw.text.slice(0, 420),
        };
      });

    return {
      systemInstruction: this.buildSystemInstruction(),
      userPrompt: JSON.stringify({
        task: `Extract up to ${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} concise atomic software opportunities from the already-classified verified evidence. Return fewer or zero rather than inventing evidence.`,
        primaryDomain: { id: context.domainId, name: context.domainName },
        requestDescription: context.requestDescription,
        selectedDomains: context.selectedDomains.map((domain) => domain.name),
        requestIntent: context.collectionPlan
          ? {
              intentConcepts: context.collectionPlan.intentConcepts.slice(0, 5),
              evidenceTargets: context.collectionPlan.evidenceTargets.slice(0, 3),
            }
          : null,
        evidenceByDomain: this.buildDomainEvidencePortfolio(context),
        verifiedEvidenceCorpus,
        nlpTotals: {
          texts: context.nlp.totalTextsAnalyzed,
          posts: context.nlp.totalPostsAnalyzed,
          comments: context.nlp.totalCommentsAnalyzed,
          confidence: context.nlp.confidence,
        },
        evidenceRules: {
          useOnlySuppliedEvidence: true,
          exactEvidenceQuotes: true,
          requestDescriptionIsScopeNotEvidence: true,
          preferDirectUserEvidence: true,
          commentsRequireSemanticInterpretation: true,
          evidenceAlreadyClassified: true,
          noUnsupportedCausalOrMarketClaims: true,
        },
      }),
    };
  }

  buildEvidenceTriageBatch(
    context: IdeaGenerationContext,
    batch: readonly {
      readonly id: string;
      readonly sourceKey: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly text: string;
    }[],
  ): CommunityAiAnalysisPrompt {
    return {
      systemInstruction: this.buildEvidenceTriageSystemInstruction(),
      userPrompt: JSON.stringify({
        task: 'Classify every supplied evidence item. Return only the compact items array; do not generate opportunities, summaries, explanations, or prose.',
        requestDescription: context.requestDescription,
        selectedDomains: context.selectedDomains.map((domain) => domain.name),
        requestIntent: context.collectionPlan
          ? {
              intentConcepts: context.collectionPlan.intentConcepts.slice(0, 6),
              evidenceTargets: context.collectionPlan.evidenceTargets.slice(0, 4),
            }
          : null,
        items: batch.map((item) => ({
          evidenceId: item.id,
          sourceKey: item.sourceKey,
          sourceType: item.sourceType,
          text: item.text.slice(0, 700),
        })),
      }),
    };
  }

  private buildSystemInstruction(): string {
    return [
      'You are Voxidence community research analyst.',
      'Return one compact JSON object only and no Markdown.',
      `Return at most ${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} atomic evidence-grounded opportunities; return an empty opportunities array when no supplied evidence supports one.`,
      'Use only supplied evidence. Never invent facts, statistics, recurrence, causes, regulations, location evidence, or user behavior.',
      'verifiedEvidenceCorpus, when present, has already passed semantic triage plus deterministic noise/identity verification. Do not reclassify it and do not output evidenceClassifications.',
      'Use verifiedEvidenceCorpus items labelled DIRECT_PROBLEM or SUPPORTING_SIGNAL as the preferred grounding source. Preserve the supplied evidence text verbatim in evidenceSamples.',
      'Do not promote generic words such as material, customer, maintenance, service, system, data, cost, equipment, traffic, or design into a new mechanism by themselves. Identity and workflow meaning must match.',
      'Every opportunity must contain at least one evidenceSamples quote copied verbatim from the supplied evidence.',
      'A single quote does not need to restate the complete problem. You may synthesize one atomic opportunity from 2 to 5 complementary evidenceSamples when the samples describe the same actor or operational context and collectively establish the same workflow friction, consequence, or unmet need.',
      'When synthesizing multiple evidenceSamples, preserve each quote verbatim and make only the narrow conclusion supported by their combined signals. Do not claim that any one quote individually states the whole synthesized problem.',
      'Never combine evidence merely because it shares a broad domain. Evidence about different actors, workflows, or unrelated failures must remain separate even when all samples come from the same selected domain.',
      'Semantically analyze every retained Community comment as first-class direct-user evidence and distinguish complaint, unmet need, feature request, question, praise-with-problem, and banter.',
      'Positive-only praise is not a complaint. A positive testimonial that mentions a pre-existing user limitation, wish, memory problem, or desired workflow is an observed unmet need/demand signal, not a complaint against the product. A praise sentence followed by a concrete product failure may ground the failure only.',
      'Do not classify self-description such as terrible memory, forgetfulness, or difficulty recalling past activity as a product complaint unless the quote explicitly says the product failed.',
      'Repository design backlogs, implementation plans, acceptance criteria, technical tickets, and product-design specifications are not direct user complaints unless a separate verbatim user complaint is present. However, a repository item that explicitly states a current missing capability and a concrete demand to add, support, provide, or implement that capability is valid FEATURE_REQUEST evidence; it may ground an opportunity as a feature-request demand signal without being recast as a complaint.',
      'Generic finance-adjacent words such as spending, receipts, budget, cost, or grocery do not support payment-method linking, bank linking, wallet linking, failed-charge, or charge-mismatch claims. Those mechanisms require explicit payment/card/bank/wallet/charge evidence in the same quote.',
      'Never use the opening sentence of a narrative review as an opportunity title. Titles must name the canonical problem family or unmet workflow need supported by the quote.',
      'Keep each opportunity tied to one atomic problem family. Complementary observations may be combined only when they form one coherent actor/workflow problem; do not combine unrelated failures or introduce mechanisms absent from the evidence.',
      'When requestDescription is present, it is a scope constraint, not evidence. Reject same-domain evidence that does not materially match the requested workflow.',
      'When requestDescription is absent, prefer concrete direct-user problems over secondary reports when both are available inside the selected domains.',
      'domainName must match a selectedDomains.name. If uncertain, omit domainName and let the deterministic service map the evidence to a selected domain.',
      'Keep title, problem, unmetNeed, solutionArea, affectedUsers, risks, summary, and warnings concise.',
      'Do not repeat publisher headlines or marketing copy as the problem. Express the operational problem supported by the quote.',
      'Do not infer authentication, medical, legal, financial, security, or coding mechanisms unless the same retained quote supports them.',
      'frequency is the number of distinct supplied quotes supporting that exact atomic problem and must remain conservative.',
      'Location is deployment context only unless the evidence explicitly names it.',
      'evidenceSamples is the only mandatory opportunity field. Return title/problem when confident; any missing semantic fields are deterministically repaired from the grounded quote.',
    ].join(' ');
  }

  private buildEvidenceTriageSystemInstruction(): string {
    return [
      'You are Voxidence raw-evidence semantic triage.',
      'Return one compact JSON object only and no Markdown.',
      'Return exactly one classification item for every supplied evidenceId whenever possible. Never invent an evidenceId.',
      'Allowed labels are DIRECT_PROBLEM, SUPPORTING_SIGNAL, and UNRELATED.',
      'DIRECT_PROBLEM means the evidence itself materially states the requester actor/workflow problem or a very close operational failure.',
      'SUPPORTING_SIGNAL means the evidence is genuinely about the same actor, asset, or workflow and supports an important subset of the requester problem, but does not establish the complete problem alone.',
      'UNRELATED means lexical overlap only, broad-domain overlap only, marketing/publisher text without a usable problem signal, a different actor/workflow, or developer-only software material for a non-developer request.',
      'Generic words such as material, customer, maintenance, service, system, data, cost, equipment, traffic, order, and design are never enough by themselves.',
      'For physical craft or local-service requests, software files, XML, SDKs, APIs, repositories, packages, UI layers, and programming errors are unrelated unless the requester itself is explicitly about software development.',
      'The phrase tourist traffic or visitor traffic normally means tourism volume/flow, not road traffic. Do not label it as road congestion or routing unless the same evidence explicitly mentions roads, vehicles, traffic jams, route delays, intersections, or road-network congestion.',
      'Positive-only praise is not a problem. Praise may still be SUPPORTING_SIGNAL only when it explicitly contains a real unmet need, limitation, wish, or workflow gap.',
      'problemFamily must be a short semantic family of at most eight words and must reflect the evidence meaning, not a single ambiguous keyword.',
      'confidence is 0-100 and should reflect confidence in the classification, not importance.',
      'Do not return reasons, summaries, opportunities, risks, recommendations, or extra fields.',
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

}