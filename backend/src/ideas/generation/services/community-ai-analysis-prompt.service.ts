import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH,
  COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP,
  COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS,
  COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
  COMMUNITY_AI_EVIDENCE_NATURES,
  COMMUNITY_AI_EVIDENCE_SYNTHESIS_MAX_ITEMS,
  COMMUNITY_AI_PROBLEM_FAMILY_BASES,
  COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS,
  COMMUNITY_AI_SEMANTIC_ALIGNMENTS,
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

    const requesterProblemLocked =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM';

    return {
      systemInstruction: this.buildSystemInstruction(),
      userPrompt: JSON.stringify({
        task: `Extract up to ${COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES} concise atomic software opportunities from the already-classified verified evidence. Return fewer or zero rather than inventing evidence.`,
        primaryDomain: { id: context.domainId, name: context.domainName },
        requestDescription: requesterProblemLocked ? context.requestDescription : null,
        selectedDomains: context.selectedDomains.map((domain) => domain.name),
        canonicalProblemProfile: requesterProblemLocked
          ? context.collectionPlan?.problemProfile ?? null
          : null,
        canonicalProblemFacets: requesterProblemLocked
          ? context.canonicalProblemSpec?.facets.map((facet) => ({
              id: facet.id,
              type: facet.type,
              statement: facet.statement,
            })) ?? []
          : [],
        requestWorkflowIdentity: requesterProblemLocked
          ? context.collectionPlan?.domainIdentity ?? null
          : null,
        requestIntent: context.collectionPlan
          ? {
              interpretation: requesterProblemLocked
                ? context.collectionPlan.requestIntent ?? null
                : context.collectionPlan.requestIntent
                  ? {
                      mode: context.collectionPlan.requestIntent.mode,
                      summary: '',
                      explicitProblem: null,
                      desiredOutcome: null,
                    }
                  : null,
              intentConcepts: requesterProblemLocked
                ? context.collectionPlan.intentConcepts.slice(0, 5)
                : [],
              evidenceTargets: requesterProblemLocked
                ? context.collectionPlan.evidenceTargets.slice(0, 3)
                : [],
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
    corpus: readonly {
      readonly id: string;
      readonly sourceKey: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly text: string;
      readonly discoveryDomainName?: string | null;
      readonly discoveryDomainNames?: readonly string[];
      readonly queryText?: string | null;
      readonly sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE';
    }[],
  ): CommunityAiAnalysisPrompt {
    const maxEvidenceChars =
      corpus.length >= 64
        ? 300
        : corpus.length >= 40
          ? 360
          : corpus.length >= 24
            ? 500
            : 760;

    const requesterProblemLocked =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM';

    return {
      systemInstruction: this.buildEvidenceTriageSystemInstruction(),
      userPrompt: JSON.stringify({
        task: [
          'Classify EVERY supplied evidence item semantically. The full corpus is one semantic context and must not be split.',
          'Return exactly one object for every supplied evidenceId. Do not omit fields to save tokens.',
          `classification MUST be exactly one of: ${COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS.join(', ')}.`,
          `evidenceNature MUST be exactly one of: ${COMMUNITY_AI_EVIDENCE_NATURES.join(', ')}.`,
          `domainAlignment and problemAlignment MUST be exactly one of: ${COMMUNITY_AI_SEMANTIC_ALIGNMENTS.join(', ')}. Never use HIGH/MEDIUM/LOW, STRONG/WEAK, RELATED/UNRELATED, booleans, or free-text alternatives for alignment.`,
          `familyBasis MUST be exactly one of: ${COMMUNITY_AI_PROBLEM_FAMILY_BASES.join(', ')}.`,
          'Every item MUST include evidenceId, classification, confidence, reason, and matchedFacetIds. matchedFacetIds must contain only ids from canonicalProblemFacets that this evidence explicitly supports; use [] when none. Keep reason under 8 words. For CONTEXT_ONLY/UNRELATED use problemFamily="", observedProblem="", causalExplanation="", and matchedDomainNames=[] unless a matched selected domain is directly evidenced. For DIRECT_PROBLEM/SUPPORTING_SIGNAL include a concise non-empty problemFamily, familyBasis=OBSERVED_PROBLEM, observedProblem under 18 words, and causalExplanation only when the row explicitly states a cause. problemFamily must be a neutral reusable noun phrase, never a first-person/individual anecdote sentence or copied headline; remove evaluative filler while preserving only evidence-entailed meaning.',
          'requestDescription/query/domain are retrieval context only, never proof. In EXPLICIT_PROBLEM_DISCOVERY and DISCOVERY_INTENT, requester text is a DOMAIN/SCOPE signal, not the canonical problem target: classify real problems found anywhere inside the resolved selected/inferred domain scope even when they differ from the requester-stated example. canonicalProblemFacets and requestWorkflowIdentity are optional soft context for ranking/solution design only and MUST NOT be required for evidence admission. EXPLICIT_PROBLEM is reserved only for an internal corroboration pass after an evidence-selected canonical family already exists.',
          'Choose selectedProblemFamily only from DIRECT_PROBLEM/SUPPORTING_SIGNAL rows with familyBasis=OBSERVED_PROBLEM, and selectedEvidenceIds must carry that exact neutral family. If none exists, use selectedProblemFamily="" and selectedEvidenceIds=[].',
          'For discovery modes, you may also return jointEvidenceGroups when 2-3 independently sourced evidence items support complementary observations of the SAME evidence-native problem family inside the resolved domain scope. Matching requester facets is optional, not required. The group is SUPPORTING evidence only: synthesize the narrowest problem jointly supported by the members and never invent an unstated causal link. Never group UNRELATED, PROMOTIONAL, or NEUTRAL_CONTEXT rows. Return at most 3 groups. Each group must contain evidenceIds, confidence, reason, problemFamily, observedProblem, actorAlignment, objectAlignment, workflowAlignment, failureAlignment, matchedDomainNames, and matchedFacetIds.',
          'ROOT SHAPE IS EXACTLY {selectedProblemFamily:"",selectedEvidenceIds:[],jointEvidenceGroups:[],items:[...]}. Return JSON only.',
        ].join(' '),
        requestDescription: requesterProblemLocked ? context.requestDescription : null,
        selectedDomains: context.selectedDomains.map((domain) => domain.name),
        canonicalProblemProfile: requesterProblemLocked
          ? context.collectionPlan?.problemProfile ?? null
          : null,
        canonicalProblemFacets: requesterProblemLocked
          ? context.canonicalProblemSpec?.facets.map((facet) => ({
              id: facet.id,
              type: facet.type,
              statement: facet.statement,
            })) ?? []
          : [],
        requestWorkflowIdentity: requesterProblemLocked
          ? context.collectionPlan?.domainIdentity ?? null
          : null,
        requestIntent: context.collectionPlan
          ? {
              interpretation: requesterProblemLocked
                ? context.collectionPlan.requestIntent ?? null
                : context.collectionPlan.requestIntent
                  ? {
                      mode: context.collectionPlan.requestIntent.mode,
                      summary: '',
                      explicitProblem: null,
                      desiredOutcome: null,
                    }
                  : null,
              intentConcepts: requesterProblemLocked
                ? context.collectionPlan.intentConcepts.slice(0, 4)
                : [],
              evidenceTargets: requesterProblemLocked
                ? context.collectionPlan.evidenceTargets.slice(0, 3)
                : [],
            }
          : null,
        items: corpus.map((item) => ({
          evidenceId: item.id,
          sourceKey: item.sourceKey,
          sourceType: item.sourceType,
          discoveryDomainName: item.discoveryDomainName ?? null,
          discoveryDomainNames: item.discoveryDomainNames ?? [],
          queryText: item.queryText?.slice(0, 120) ?? null,
          sourceTier: item.sourceTier ?? null,
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
      'REQUEST-INTENT PRECEDENCE: requestDescription is never evidence. EXPLICIT_PROBLEM_DISCOVERY and DISCOVERY_INTENT are domain/scope discovery modes: the requester text helps resolve the relevant profession/domain and supplies soft product context, but verified external evidence owns the canonical problem family and may select a different concrete problem inside that resolved scope. EXPLICIT_PROBLEM is reserved for an internal post-evidence corroboration pass where the application has already locked an evidence-selected family.',
      'In every mode, the final selectedProblemFamily must be evidence-backed. Requester text, selected domains, query provenance, and domain names may constrain relevance but can never count as evidence.',
      'verifiedEvidenceCorpus, when present, has already passed the dedicated AI semantic triage plus structural/provenance safety checks. Do not reclassify it and do not output evidenceClassifications.',
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
      'When requestDescription is present, it is a retrieval-scope constraint, not evidence. Any text-derived actor/object/workflow/failure profile is search metadata only and must not become the canonical problem. Community AI must select the strongest evidence-backed problem inside the classified domain/request scope.',
      'When requestIntent.interpretation.mode=DISCOVERY_INTENT or EXPLICIT_PROBLEM_DISCOVERY, requester prose is scope/context only. Resolve the strongest verified evidence-backed problem family inside the selected/inferred domain scope even when the evidence does not match the requester-stated example problem. Do not use requester facets to choose the winning problem family; problem selection is evidence-first. Requester facets return only after selection as compatible solution-design context. When no requester text exists, use the same evidence-native discovery rule. When mode=EXPLICIT_PROBLEM, treat it as an internal corroboration contract for an already evidence-selected family and require evidence to support that same family.',
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
    const classifications = COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS.join(' | ');
    const natures = COMMUNITY_AI_EVIDENCE_NATURES.join(' | ');
    const alignments = COMMUNITY_AI_SEMANTIC_ALIGNMENTS.join(' | ');
    const familyBases = COMMUNITY_AI_PROBLEM_FAMILY_BASES.join(' | ');

    return [
      'You are Voxidence raw-evidence semantic triage. You, not downstream regexes, own semantic classification.',
      'Return one compact JSON object only and no Markdown. The complete corpus is one semantic unit; return one item for EVERY supplied evidenceId and never invent an id.',
      'ITEM-LEVEL COMPOSITION: judge each evidence item from its FULL supplied text, not sentence-by-sentence. Multiple sentences inside one post/comment/news/report may collectively establish actor, workflow, and failure even when no single sentence contains the whole problem. Keep that as one item verdict; do not discard a valid multi-sentence claim merely because the facets are distributed across sentences.',
      `Use these exact enum strings only. classification=${classifications}; evidenceNature=${natures}; domainAlignment=${alignments}; problemAlignment=${alignments}; actorAlignment=${alignments}; objectAlignment=${alignments}; workflowAlignment=${alignments}; failureAlignment=${alignments}; familyBasis=${familyBases}.`,
      'Do not replace alignment enums with HIGH/MEDIUM/LOW, STRONG/WEAK, RELATED/UNRELATED, YES/NO, true/false, or prose. If uncertain use PARTIAL or NONE.',
      'Each item must contain evidenceId, classification, confidence, reason, problemFamily, evidenceNature, domainAlignment, problemAlignment, actorAlignment, objectAlignment, workflowAlignment, failureAlignment, familyBasis, observedProblem, causalExplanation, matchedDomainNames, matchedFacetIds. TRANSPORT COMPACTION: reason must be at most 8 words; for CONTEXT_ONLY/UNRELATED use empty problemFamily/observedProblem/causalExplanation and [] matchedDomainNames unless a selected-domain workflow is directly evidenced; for DIRECT_PROBLEM/SUPPORTING_SIGNAL keep observedProblem under 18 words and causalExplanation empty unless an explicit cause is stated. Never omit a row to save tokens.',
      'Canonical item example (format only, not a semantic hint): {"evidenceId":"e0","classification":"CONTEXT_ONLY","confidence":70,"reason":"Relevant background only.","problemFamily":"","evidenceNature":"NEUTRAL_CONTEXT","domainAlignment":"PARTIAL","problemAlignment":"NONE","actorAlignment":"NONE","objectAlignment":"PARTIAL","workflowAlignment":"NONE","failureAlignment":"NONE","familyBasis":"NONE","observedProblem":"","causalExplanation":"","matchedDomainNames":[],"matchedFacetIds":[]}.',
      'Use only what the evidence item itself states. requestDescription, selectedDomains, discoveryDomainName, queryText, sourceTier, and canonicalProblemProfile are context/provenance; none of them are evidence by themselves.',
      'classification meanings: DIRECT_PROBLEM = a first-party/lived or clearly observed affected-user/operator problem; SUPPORTING_SIGNAL = a credible documented finding/report/study/community demand signal that materially supports a concrete problem but is not first-party direct evidence; CONTEXT_ONLY = relevant terminology, method, product, market, recruitment, or neutral background that does not itself establish the problem; UNRELATED = the actual problem/workflow is outside the request/discovery lane even if broad domain words overlap.',
      'SEMANTIC FRAGMENTS: evidence does not need to be a complete grammatical sentence. Interpret short comments, sentence fragments, quoted snippets, hashtags, and emoji together with their surrounding retained text. An emoji may strengthen or clarify sentiment when paired with meaningful text, but emoji alone or vague sentiment alone cannot establish a problem family. Do not reject a concrete problem merely because it is indirect, colloquial, abbreviated, or spread across a short comment plus context.',
      'evidenceNature meanings: LIVED_EXPERIENCE for first-party or directly observed user/operator pain; DOCUMENTED_FINDING for news/research/case/report evidence with an actual finding; MARKET_RESEARCH for pain-point solicitation/feature discovery without lived evidence in that row; PROMOTIONAL for vendor/listing/CTA copy; NEUTRAL_CONTEXT for relevant non-problem background; OTHER otherwise.',
      'domainAlignment asks whether the PROBLEM/WORKFLOW in the evidence belongs to at least one selected domain. A person identity, employer, student status, location, or broad domain word alone is not domain alignment. matchedDomainNames must contain only exact selectedDomains names whose operational problem/workflow is actually evidenced by this row; use [] when none. For TEXT_ONLY, the resolved inferred profession/domain is the evidence-discovery boundary: a trusted row must genuinely belong to that resolved domain and matchedDomainNames must identify it. For TEXT_AND_DOMAINS, at least one requester-selected domain must be genuinely evidenced, but no row needs to support every selected domain. discoveryDomainName/discoveryDomainNames are retrieval hints only and never force a match.',
      'problemAlignment is descriptive metadata only in DISCOVERY_INTENT and EXPLICIT_PROBLEM_DISCOVERY: MATCH/PARTIAL may note similarity to requester text, but NONE does NOT disqualify a real problem inside the resolved selected/inferred domain. In discovery, domainAlignment plus the row itself having a concrete observed problem controls admission. For every row also return matchedFacetIds for requester facets explicitly supported by the evidence, but [] is fully valid for a different evidence-native problem in the same domain. Generic words such as delivery, bottleneck, maintenance, data, equipment, delay, cost, system, or AI are never enough by themselves. In internal EXPLICIT_PROBLEM corroboration, problemAlignment becomes authoritative: MATCH means the same locked evidence-selected family, PARTIAL means one real atomic facet of that same family, and NONE means adjacent/broad overlap only.',
      'In DISCOVERY_INTENT and EXPLICIT_PROBLEM_DISCOVERY, actorAlignment/objectAlignment/workflowAlignment/failureAlignment/matchedFacetIds describe similarity to requester text only and are never mandatory. DIRECT_PROBLEM requires a genuine lived/first-party concrete problem in the resolved domain; SUPPORTING_SIGNAL requires a credible documented concrete problem in that domain. If domainAlignment=PARTIAL, DIRECT_PROBLEM must be downgraded to SUPPORTING_SIGNAL. Same-domain background that does not itself state a concrete problem remains CONTEXT_ONLY. In internal EXPLICIT_PROBLEM corroboration, requester alignment becomes mandatory again.',
      'JOINT EVIDENCE COMPOSITION is allowed in discovery modes. A joint group may combine 2-3 evidence items from different external sources when the rows independently describe complementary aspects of the SAME evidence-native problem family inside one or more selected domains. Requester-facet overlap is optional. The rows do not need to restate one complete causal chain. The group must remain a SUPPORTING claim and must not invent causation between the rows.',
      'For each jointEvidenceGroup, evidenceIds must reference only supplied rows with evidenceNature LIVED_EXPERIENCE, DOCUMENTED_FINDING, or MARKET_RESEARCH that explicitly report a real problem and have domainAlignment=MATCH or PARTIAL plus at least one matched selected domain. The members must cohere on the same evidence-native problem family across at least two independent external sources; requester problemAlignment and matchedFacetIds may be NONE/empty. Group-level requester alignments summarize only overlap that actually exists. matchedDomainNames is the union of selected domains directly evidenced by the members and may span multiple selected domains. A Text + Domains row or group does NOT need to support every selected domain. Keep problemFamily under 14 words and observedProblem under 28 words.',
      'JOINT EVIDENCE ANTI-BRIDGING RULE: requester text, selectedDomains, queryText, retrieval vocabulary, desiredOutcome, and model/world knowledge may NEVER supply facts missing from the evidence members. If the members only share a broad topic, concern unrelated actors/workflows, or require an unstated causal claim to sound coherent, do not create a group. Complementary facets may coexist without claiming that one causes another. A joint group is SUPPORTING evidence only; it is never DIRECT evidence and never proves prevalence.',
      'observedProblem must be a neutral one-sentence statement of the actual friction/failure explicitly observed or reported by this item. Do not add causes, solutions, actors, or mechanisms that the evidence does not state.',
      'problemFamily must be a short neutral label for observedProblem. It must describe the observed friction only. Exclude editorial causation such as because/due to/caused by unless the cause itself is the directly observed problem. Exclude recommendations, solutions, headlines, slogans, prevalence claims, and marketing wording.',
      'CANONICAL FAMILY WORDING: write problemFamily as a reusable problem-category noun phrase, not as a retelling of one person\'s sentence or one incident headline. Remove first-person/individual-story framing (for example "customer left vendor", "user said", "I switched", "company experienced") and evaluative filler such as terrible/awful/bad when a neutral evidence-entailed abstraction is available. Preserve the same observed meaning and mechanism; do not add synonyms, causes, actors, or scope that the evidence does not support. Prefer a concise friction/category label over a subject-verb anecdote.',
      'STRICT FAMILY SELF-CONSISTENCY: problemFamily must be directly entailed by observedProblem from THIS evidence row. Never copy, paraphrase, or broaden requester text into problemFamily when observedProblem supports a narrower or different evidence-native issue. If the observedProblem cannot naturally be summarized by the proposed family, use CONTEXT_ONLY or a narrower family.',
      'EVIDENCE-NATIVE FAMILY RULE: every meaningful noun or mechanism in problemFamily must be present in, or be a direct ordinary-language abstraction of, observedProblem from the same row. Do not import nouns from requestDescription, selectedDomains, queryText, or desired solution language. For example, evidence about patch-management failure cannot be labeled as record-authenticity failure unless the evidence itself mentions records/authenticity. When several rows truly share one family, choose the narrowest label jointly entailed by ALL selected rows.',
      'For a single documentary SUPPORTING_SIGNAL, keep the claim narrow: the row itself must document a concrete problem inside at least one resolved selected/inferred domain. It does not need to match the requester sentence, requester actor/workflow/failure chain, or every selected domain. Treat it as preliminary supporting evidence only, never DIRECT_PROBLEM and never proof of prevalence. Broad market/product/tooling background with no concrete problem remains CONTEXT_ONLY.',
      'familyBasis must be OBSERVED_PROBLEM only when problemFamily names the observed friction. Use CAUSAL_EXPLANATION if the proposed wording mainly states why the problem happens, SOLUTION_OPINION if it is prescriptive, and NONE when no trusted family exists. DIRECT_PROBLEM and SUPPORTING_SIGNAL require familyBasis=OBSERVED_PROBLEM and a non-empty problemFamily.',
      'causalExplanation may capture a cause explicitly claimed by the source, but it must stay separate from problemFamily. Leave it empty when the item does not establish a cause.',
      'Market-research or feature-solicitation rows are never DIRECT_PROBLEM by themselves. They may be SUPPORTING_SIGNAL only when the row itself contains a concrete documented demand/problem signal; otherwise CONTEXT_ONLY.',
      'Promotional/listing/CTA copy is never trusted problem evidence by itself. User comments/reviews attached to a listing are separate rows and must be judged from their own content.',
      'PROMOTIONAL NATURE OVERRIDES PAIN LANGUAGE: when the row primarily sells, promotes, announces, teaches, or drives traffic to a named product, framework, method, newsletter, podcast, course, service, vendor, or article, classify evidenceNature=PROMOTIONAL even if the copy says it solves a major/biggest problem or describes pain to justify the promoted solution. Do not upgrade marketing pain framing into DOCUMENTED_FINDING.',
      'DOCUMENTED_FINDING requires an actual reported observation, study result, incident, measured outcome, or independently described operational finding in the row itself. A solution pitch that merely asserts a problem exists is PROMOTIONAL or MARKET_RESEARCH, not DOCUMENTED_FINDING. Mixed rows stay non-trusted unless the problem observation clearly stands on its own independently of the promotion.',
      "For community posts that mainly link or advertise the author's own article/video/Substack/tool/method, use PROMOTIONAL unless the post independently reports a first-party operational incident with concrete facts. A promotional post must not become OPERATIONAL_INCIDENT merely because it uses production-failure vocabulary.",
      'Research/news/report evidence can be SUPPORTING_SIGNAL when it reports a concrete failure, shortage, delay, outage, bottleneck, risk, barrier, rework, cost pressure, quality/reliability issue, or other operational problem inside the resolved selected/inferred domain. For text-backed discovery, a different concrete workflow/failure inside that same domain is still eligible evidence because the evidence, not the requester example, selects the final problem. Do not require exact requester wording or requester-facet overlap. Keep the claim bounded to what the row actually establishes.',
      'Several independent SUPPORTING_SIGNAL rows can support the same family. Reuse the exact same neutral problemFamily label when the rows truly describe the same operational root problem, even when the surface wording differs. In discovery mode especially, normalize compatible observations onto one evidence-native family when they share the same actor/workflow and failure mechanism; do not split one recurring production problem into overly narrow one-row labels merely because each source uses different wording. Keep genuinely different root problems separate.',
      'After classifying all items, choose selectedProblemFamily as the strongest neutral OBSERVED_PROBLEM family supported by individually trusted DIRECT_PROBLEM/SUPPORTING_SIGNAL rows. Direct evidence is valuable, but an isolated one-row/one-source implementation error must not automatically beat a broader, better-corroborated family solely because it is DIRECT. For DOMAINS_ONLY/NO_INPUT with multiple selected domains, prioritize representativeness: selected-domain coverage, independent-source diversity, repeated evidence, then directness/confidence. Prefer a cross-domain family only when the trusted rows actually carry those matchedDomainNames; never manufacture an intersection. Joint groups are returned separately and must not be inserted into selectedEvidenceIds because their members are not individually sufficient. If no individually trusted family exists, return selectedProblemFamily="" and selectedEvidenceIds=[] even when a valid jointEvidenceGroup exists; application code will validate the group separately.',
      'Never infer prevalence, recurrence, causal mechanisms, legal/medical/security facts, technical mechanisms, or market size unless the evidence explicitly states them.',
      'CAUSAL CLAIM BOUNDARY: requesterDescription may contain a proposed explanation such as fragmented data, separate systems, missing coordination, shortages causing delays, or another why/how statement. That explanation is NOT externally validated unless at least one trusted evidence row explicitly states the same causal relationship in causalExplanation or observedProblem. Supporting evidence for the resulting problem does not automatically validate the requester cause. Keep the cause as an unvalidated requester hypothesis.',
      'Confidence is confidence in the semantic classification and alignment, not importance. Keep reason concise and evidence-specific.',
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
    const requesterProblemLocked =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM';
    const sorted = perDomain.map((samples) =>
      samples
        .map((sample) => ({
          sample,
          requestScore: requesterProblemLocked && requestDescription
            ? this.scoreEvidenceAgainstRequest(requestDescription, sample)
            : 0,
          matchesNlpFragment: nlpFragments.some((fragment) =>
            this.evidenceTextsOverlap(fragment, sample),
          ),
        }))
        .sort((left, right) => {
          if (
            requesterProblemLocked &&
            requestDescription &&
            left.requestScore !== right.requestScore
          ) {
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
          context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
            ? context.requestDescription
            : null,
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