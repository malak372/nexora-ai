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
          (item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL') &&
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
        canonicalProblemProfile: context.collectionPlan?.problemProfile ?? null,
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

  buildEvidenceTriageCorpus(
    context: IdeaGenerationContext,
    batch: readonly {
      readonly id: string;
      readonly sourceKey: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly text: string;
    }[],
  ): CommunityAiAnalysisPrompt {
    const maxEvidenceChars =
      batch.length >= 72
        ? 720
        : batch.length >= 48
          ? 820
          : batch.length >= 24
            ? 960
            : 1_200;

    return {
      systemInstruction: this.buildEvidenceTriageSystemInstruction(),
      userPrompt: JSON.stringify({
        task: 'Classify EVERY supplied evidence item in this transport partition. The collection layer sends all partitions, so no collected item is intentionally omitted. Reuse concise evidence-native requester-owned problem-family labels when the evidence supports them. ROOT SHAPE IS EXACTLY {items:[...]}; never use a classifications field. Return only that JSON object; do not generate opportunities, summaries, explanations, or prose.',
        requestDescription: context.requestDescription,
        selectedDomains: context.selectedDomains.map((domain) => domain.name),
        canonicalProblemProfile: context.collectionPlan?.problemProfile ?? null,
        requestIntent: context.collectionPlan
          ? {
              intentConcepts: context.collectionPlan.intentConcepts.slice(0, 4),
              evidenceTargets: context.collectionPlan.evidenceTargets.slice(0, 3),
            }
          : null,
        items: batch.map((item) => ({
          evidenceId: item.id,
          sourceKey: item.sourceKey,
          sourceType: item.sourceType,
          text: item.text.slice(0, maxEvidenceChars),
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
      'When requestDescription is present, it is a scope constraint, not evidence. canonicalProblemProfile is the PREPARING-stage interpretation of that text and is the primary matching contract. Reject same-domain evidence that does not materially match the requested problem or workflow.',
      'When requestDescription is present, evidence may corroborate or challenge facets of canonicalProblemProfile, but an evidence title or narrower problemFamily must never rename, replace, or shrink the requester-defined problem. Keep the canonical requester workflow primary through synthesis.',
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
      'Return exactly one classification item for every supplied compact evidenceId whenever possible. Never invent an evidenceId.',
      'You are seeing one transport partition of the complete collected Community ledger. Other partitions are classified concurrently when the ledger exceeds one provider request. Evidence ids are compact aliases used only for this response. Classify every supplied item from what that item actually states; downstream canonical normalization keeps equivalent problemFamily labels consistent across partitions.',
      'When several independent items support the same requester-owned problem family, reuse the same concise problemFamily label so downstream ranking can count evidence volume and source diversity correctly.',
      'Allowed labels are DIRECT_PROBLEM, SUPPORTING_SIGNAL, CONTEXT_ONLY, and UNRELATED.',
      'Survey invitations, participant recruitment posts, thesis/dissertation recruitment, and research descriptions that explain what a study will explore but contain no reported findings are CONTEXT_ONLY when request-aligned, otherwise UNRELATED. They can never be DIRECT_PROBLEM or SUPPORTING_SIGNAL until the item itself states observed results, reported failures, shortages, delays, errors, barriers, or another concrete problem finding.',
      'When canonicalProblemProfile is supplied, classify problem-first in this priority order: coreProblem, workflow, actor/object, failureModes, consequences, then domain. Domain overlap alone never makes evidence relevant.',
      'DIRECT_PROBLEM means the evidence itself materially states the requester actor/workflow problem or a very close operational failure.',
      'SUPPORTING_SIGNAL means the evidence supports one real atomic part of the requester problem. Exact actor + exact pain is strongest. Adjacent actor/object + the same concrete workflow pain may still be weak SUPPORTING_SIGNAL when the evidence proves the same operational failure; adjacent actor plus merely adjacent pain is UNRELATED. It does NOT need to restate the complete causal chain or every requester field.',
      'Several independent SUPPORTING_SIGNAL items may complement one another across sources. Classify each item on its own evidence; do not require one sentence or one source to prove the whole requester problem. Read the full supplied excerpt because one useful signal may span multiple sentences.',
      'For digital-entertainment conversion requests, generic social-media marketing, education platforms, sales advice, AI tutorials, game reviews, or broad media trends are UNRELATED unless the same item explicitly connects a digital-entertainment/streaming/gaming platform to purchase, paid-content, subscription, transaction, conversion, abandonment/drop-off, promotion effectiveness, recommendations, or monetization friction.',
      'For digital-entertainment account-abuse/financial-loss requests, do not treat generic banking, telecom, e-commerce, authentication, wallet, or payment-platform evidence as DIRECT_PROBLEM. It may be SUPPORTING_SIGNAL only when it proves the same concrete account-takeover/refund/subscription/payment-abuse mechanism; the problemFamily must name only that mechanism actually stated by the evidence. Financial-loss/revenue-attribution wording requires explicit loss, revenue, chargeback, refund-cost, forecast, or financial-impact evidence in the same item.',
      'For custom musical-instrument-case requests, scientific/medical/optical/financial instruments, Texas Instruments, camera/computer/phone cases, and generic instrument history are UNRELATED. Require musical-instrument-case identity (for example violin/cello/guitar/instrument flight case) plus a specification, fit, measurement, padding, material, hardware, revision, approval, waste, rework, or delay facet.',
      'Atomic-support rule: if an item matches the requester actor/object context and proves any one concrete failure, incident, condition, consequence, missing-history fact, replacement/material decision, access/security event, disruption, false-positive restriction, delay, or rework facet from canonicalProblemProfile, classify it SUPPORTING_SIGNAL even when it does not mention the requester’s fragmented-record mechanism.',
      'Same-object evidence is especially important for niche physical/restoration work: condition damage, missing parts, unknown previous repairs, period/original-detail preservation, or replacement-material uncertainty can be SUPPORTING_SIGNAL for a restoration-history problem without mentioning notebooks or a software system.',
      'For physical/restoration requests, same-workflow but unrelated-object evidence is NOT problem evidence. However, a practitioner in the same craft/material family may be weak SUPPORTING_SIGNAL when it explicitly proves the exact requester pain (for example scattered photos/notes, no record of materials/finishes, lost prior-work history, or inability to reproduce previous work). Never upgrade that adjacent-practitioner evidence to DIRECT_PROBLEM. A generic restoration tutorial or different artifact with no matching pain remains UNRELATED.',
      'For restoration-history/documentation requests, production skill, chemistry, material science, generic conservation technique, or restoration of another object is UNRELATED unless the item explicitly proves the requester documentation/history/recordkeeping pain or the same exact object plus a missing/unknown treatment-history, coating/material record, preservation-preference, or reproducibility problem. Do not convert a technique/material article into evidence of fragmented records.',
      'Institutional security incidents can be SUPPORTING_SIGNAL when they prove a matching platform/account/access/assessment consequence such as a learning-platform breach, exposed student data, disrupted exams, delayed investigation, or false restriction, even if the item does not describe every siloed log source.',
      'For requester-defined digital security workflows in any vertical, same-domain security news is insufficient. Require requester actor/object identity plus a concrete digital incident and at least one matching facet such as account compromise, payment fraud, permission/access abuse, exposed records, suspicious activity, or security-alert handling. Generic cybersecurity breaches in unrelated companies are UNRELATED.',
      'For municipal/smart-city payment fraud requests, a documented municipality/city/public-service cyber or phishing incident with missing/stolen public funds, unauthorized transactions, account compromise, or investigation impact may be SUPPORTING_SIGNAL even when the item does not repeat parking/transit/utility payment rails or the full fragmented-record mechanism. Keep it SUPPORTING, not DIRECT, unless the fuller municipal-payment workflow is actually stated.',
      'For logistics shipment-integrity/security requests, SUPPORTING_SIGNAL may prove one atomic facet: missing packages at a 3PL/warehouse handoff, conflicting carrier/warehouse scans, proof-of-handoff gaps, cargo diversion/theft, suspicious rerouting, unauthorized delivery-account/address changes, or shipment tracking/audit inconsistencies. It does NOT need to restate every tracking/account/warehouse/driver/security silo in the requester description. Generic route optimization, shipment consolidation, packaging, unrelated shipping finance, or generic cybersecurity without a shipment/package/cargo/warehouse/carrier identity is UNRELATED.',
      'For professional book restoration/conservation requests, object identity is mandatory before pain matching. Evidence must actually concern physical books/manuscripts/bindings/pages/paper AND conservation/restoration/repair/condition/treatment. Fiction, book reviews, stories, movie/TV discussion, generic prose containing the word book, or unrelated uses of repair/restoration are UNRELATED even if they contain words such as missing, section, history, fragment, paper, or record. A real binding/page/paper condition, previous-treatment, material-selection, or conservation-documentation observation may be SUPPORTING_SIGNAL even when it proves only one facet of the broader restoration-history problem.',

      'For public-transit operating-cost requests, aviation, airlines, cargo, shipping, and private fleet articles are not requester evidence merely because they mention routes, schedules, fuel, passengers, or costs. Require explicit public transit, bus, metro, rail-transit, transit-agency/operator, or equivalent municipal passenger-service identity. Aviation may be kept only as non-qualifying context outside the trusted ledger.',
      'Example: for a university tuition/refund/account-security problem, evidence about federal student-aid fraud, fraudulent student refunds, university-account identity theft, or false-positive student payment restrictions can be SUPPORTING_SIGNAL even if it does not mention every siloed system in the requester description.',
      'You are classifying EVERY collected raw item. Do not skip noisy items: explicitly label each supplied id as DIRECT_PROBLEM, SUPPORTING_SIGNAL, CONTEXT_ONLY, or UNRELATED. DIRECT_PROBLEM and SUPPORTING_SIGNAL are the only trusted problem-evidence labels. CONTEXT_ONLY means the item is genuinely useful for understanding the requester workflow, terminology, existing solution landscape, professional practice, or recovery-query expansion, but it does not itself prove user pain, demand, recurrence, or the requester problem. For every DIRECT_PROBLEM or SUPPORTING_SIGNAL item, assign a concise requester-owned problemFamily so downstream clustering can count evidence across sources and select the strongest problem family. CONTEXT_ONLY and UNRELATED use an empty problemFamily.',
      'Problem families must describe the root operational friction or causal mechanism, not a downstream consequence. For example, fragmented building-performance data / energy anomaly diagnosis is a family; delayed efficiency improvements by itself is only a consequence.',
      'For app-store and google-play, application listing/marketing text can never be DIRECT_PROBLEM or SUPPORTING_SIGNAL. If the listing materially matches the requester actor/object/workflow and is useful for terminology or solution-landscape discovery, classify it CONTEXT_ONLY; otherwise classify it UNRELATED. User reviews/comments may be DIRECT_PROBLEM or SUPPORTING_SIGNAL only when they describe real experienced workflow pain.',
      'CONTEXT_ONLY is not evidence of a problem: use it for aligned professional methods, condition/reporting tools, existing workflow products, standards, or neutral descriptions that can improve vocabulary and recovery but do not state a requester-owned pain. UNRELATED means lexical overlap only, broad-domain overlap only, a genuinely different actor/workflow/problem family, or developer-only software material for a non-developer request.',
      'For GENERAL and local-service workflows, same-domain or same-object vocabulary is not enough for SUPPORTING_SIGNAL. The item must establish at least one concrete requester-owned pain/workflow facet such as a fitting/measurement error, forgotten approved change, delay, rework, missing record, or other failure actually represented in canonicalProblemProfile.',
      'Wedding participation costs, bachelorette travel, Airbnb/flights, Venmo splitting, maid-of-honor budgeting, or wedding-party spreadsheets are UNRELATED to a bridal-alterations fitting/measurement/approval-record problem unless the same item also states a concrete alterations/fitting failure. Self-hemming or DIY alteration mishaps may be SUPPORTING_SIGNAL for the narrow alteration outcome they prove, but they are not DIRECT_PROBLEM evidence of a professional alteration specialist workflow.',
      'Generic words such as material, customer, maintenance, service, system, data, cost, equipment, traffic, order, and design are never enough by themselves.',
      'For physical craft or local-service requests, software files, XML, SDKs, APIs, repositories, packages, UI layers, and programming errors are unrelated unless the requester itself is explicitly about software development.',
      'The phrase tourist traffic or visitor traffic normally means tourism volume/flow, not road traffic. Do not label it as road congestion or routing unless the same evidence explicitly mentions roads, vehicles, traffic jams, route delays, intersections, or road-network congestion.',
      'Positive-only praise is not a problem. Praise may still be SUPPORTING_SIGNAL only when it explicitly contains a real unmet need, limitation, wish, or workflow gap.',
      'problemFamily is required for every DIRECT_PROBLEM or SUPPORTING_SIGNAL item. The family must be EVIDENCE-NATIVE first and requester-owned second: name only the concrete problem/workflow facet that is explicitly present in the evidence text AND belongs to canonicalProblemProfile. Never copy a requester facet merely because it exists in the profile. If the evidence discusses leather templates/material waste but not customer measurements, do not label it Customer Measurements. If no concrete requester-owned problem family is stated but the item is still useful workflow/market context, use CONTEXT_ONLY with an empty problemFamily; otherwise classify it UNRELATED. Do not introduce any object, actor, workflow, or failure noun absent from the evidence itself. Use at most six words and keep the label under 80 characters. Generic labels such as Request-Aligned Operational Friction, Requester Problem, Most-Evidenced Problem, Supporting Evidence, or a single ambiguous keyword are invalid. Use an empty problemFamily for CONTEXT_ONLY and UNRELATED.',
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