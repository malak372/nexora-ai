import { Injectable, Logger } from '@nestjs/common';
import {
  AiRoutingStrategy,
  ApiRequestType,
  IdeaGenerationType,
  PromptType,
} from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { buildRequestCollectionPlanSchema } from '../schemas/request-collection-plan.schema';
import type {
  RequestCollectionPlan,
  RequestCollectionSourceFocus,
} from '../types/request-collection-plan.type';
import { inferDominantRequestDomainName } from '../utils/request-domain-inference.util';

const REQUEST_COLLECTION_PLAN_SCHEMA_NAME = 'nexora_request_collection_plan';
const REQUEST_COLLECTION_PLAN_TIMEOUT_MS = 7_500;
const REQUEST_COLLECTION_PLAN_PREFERRED_MODELS = [
  'gemini-3.5-flash-lite',
  'google/gemini-3.5-flash-lite',
] as const;

@Injectable()
export class RequestCollectionPlanningService {
  private readonly logger = new Logger(RequestCollectionPlanningService.name);

  constructor(private readonly aiExecutionService: AiExecutionService) {}

  async plan(input: {
    readonly description?: string | null;
    readonly keywords?: readonly string[];
    readonly generationType?: IdeaGenerationType;
    readonly userId?: string;
    readonly guestSessionId?: string;
  }): Promise<RequestCollectionPlan | null> {
    const description = input.description?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!description) {
      return null;
    }

    const deterministic = this.buildDeterministicFallback(
      description,
      input.keywords ?? [],
    );

    try {
      const result = await this.aiExecutionService.execute({
        userPrompt: this.buildUserPrompt(description, input.keywords ?? []),
        systemInstruction: this.buildSystemInstruction(),
        requestType: ApiRequestType.NLP_ENHANCEMENT,
        promptType: PromptType.NLP_ANALYSIS,
        generationType: input.generationType,
        userId: input.userId,
        guestSessionId: input.guestSessionId,
        responseFormat: AiResponseFormat.JSON,
        responseSchema: buildRequestCollectionPlanSchema(),
        responseSchemaName: REQUEST_COLLECTION_PLAN_SCHEMA_NAME,
        strategy: AiRoutingStrategy.BALANCED,
        preferredApiModelIds: REQUEST_COLLECTION_PLAN_PREFERRED_MODELS,
        estimatedOutputTokens: 360,
        maxOutputTokens: 520,
        temperature: 0.1,
        timeoutMs: REQUEST_COLLECTION_PLAN_TIMEOUT_MS,
        maxRetriesPerModel: 0,
        maxModelsPerOperation: 1,
        excludeLocalFallback: true,
        allowProviderFallbackOnInvalidPrompt: true,
      });

      const parsed = JSON.parse(result.text) as Record<string, unknown>;
      const planned = this.normalizeAiPlan(parsed, deterministic, description);

      if (!planned.fallbackUsed) {
        this.logger.log(
          `Pre-collection AI plan accepted. provider=${result.providerKey}, apiModelId=${result.apiModelId}, responseTimeMs=${result.responseTimeMs ?? 'unknown'}, queries=${planned.searchQueries.length}.`,
        );
      }

      if (planned.fallbackUsed) {
        this.logger.warn(
          'Pre-collection AI returned a plan that could not be grounded strongly enough; deterministic request planning was used instead.',
        );
      }

      return planned;
    } catch (error: unknown) {
      this.logger.warn(
        `Pre-collection AI planning fell back to deterministic intent extraction: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return deterministic;
    }
  }

  private buildSystemInstruction(): string {
    return [
      'You are the pre-collection planner for software opportunity research.',
      'Read the requester description before any data collector runs.',
      'Do not claim demand exists and do not invent evidence.',
      'Return one professional, reusable software-domain noun phrase plus focused evidence-search queries.',
      'Search queries must target the exact workflow, failure, missing record, coordination problem, dispute, or repeated work described by the requester.',
      'Prefer 5 or 6 concise natural-language queries. Do not repeat adjacent words, do not produce actor fragments, and do not add generic words such as problem, difficult, workflow, software, or app unless they are necessary to disambiguate the search.',
      'Evidence targets must describe what a real complaint, review, forum question, or technical report would need to mention to support the requester problem.',
      'Intent concepts must be compact noun phrases from the requester description.',
      'For consumer or local-service workflows prioritize REVIEWS and FORUMS. Add PRODUCT_DISCOVERY when relevant. For small-business coordination workflows such as florists, studios, repair shops, custom-order businesses, or local suppliers, prefer FORUMS plus REVIEWS and include NEWS when trade articles or operator reports are likely to contain operational evidence. For municipal, urban-planning, public-housing, neighborhood-management, city-planning, or institutional property workflows, prefer FORUMS plus NEWS; use TECHNICAL only when the requester actually describes APIs, SDKs, code, telemetry, runtime, or infrastructure integration. For multi-organization logistics, telemetry, integration, audit, chain-of-custody, or infrastructure workflows prefer FORUMS plus TECHNICAL or NEWS evidence instead of generic consumer-app reviews.',
      'The suggested domain must be the narrowest stable professional software domain supported by the description, such as "Recipe & Culinary Knowledge Management", "Tattoo Studio Operations & Client Management", "Dance Studio Operations & Performance Management", or "Shipment Traceability & Chain-of-Custody Management". Do not collapse a clearly described vertical workflow into a broad parent such as Education, Business Operations, Government, or Logistics when a reusable vertical label can be formed safely from the requester text. Never return an actor sentence such as "People Who Cook" or "Tattoo Studios Coordinate Artist".',
      'Do not introduce technologies that the requester did not mention.',
    ].join(' ');
  }

  private buildUserPrompt(
    description: string,
    keywords: readonly string[],
  ): string {
    return [
      'REQUEST DESCRIPTION:',
      description,
      '',
      'OPTIONAL REQUEST KEYWORDS:',
      keywords.filter(Boolean).slice(0, 8).join(', ') || 'none',
      '',
      'Create the first-pass collection plan. The collection should be useful even if only one pass is allowed, so every query must be specific to the requester workflow and likely evidence.',
    ].join('\n');
  }

  private normalizeAiPlan(
    parsed: Record<string, unknown>,
    fallback: RequestCollectionPlan,
    description: string,
  ): RequestCollectionPlan {
    const normalizedAiDomainName = this.normalizeDomainName(
      typeof parsed.suggestedDomainName === 'string'
        ? parsed.suggestedDomainName
        : null,
      fallback.suggestedDomainName,
      description,
    );
    const suggestedDomainName = this.shouldPreferSpecificFallbackDomain(
      normalizedAiDomainName,
      fallback.suggestedDomainName,
    )
      ? fallback.suggestedDomainName
      : normalizedAiDomainName;
    const searchQueries = this.normalizeQueries(parsed.searchQueries, 8);
    const evidenceTargets = this.normalizeStrings(parsed.evidenceTargets, 6, 6);
    const intentConcepts = this.normalizeStrings(parsed.intentConcepts, 8, 3);
    const sourceFocus = this.normalizeSourceFocus(parsed.sourceFocus);
    const confidence = this.normalizeScore(parsed.confidence, fallback.confidence);

    const plan: RequestCollectionPlan = {
      suggestedDomainName,
      searchQueries:
        searchQueries.length >= 4 ? searchQueries : fallback.searchQueries,
      evidenceTargets:
        evidenceTargets.length >= 3 ? evidenceTargets : fallback.evidenceTargets,
      intentConcepts:
        intentConcepts.length >= 3 ? intentConcepts : fallback.intentConcepts,
      sourceFocus: sourceFocus.length > 0 ? sourceFocus : fallback.sourceFocus,
      confidence,
      aiUsed: true,
      fallbackUsed: false,
    };

    if (!this.planRemainsGrounded(plan, description)) {
      return fallback;
    }

    return plan;
  }

  private planRemainsGrounded(
    plan: RequestCollectionPlan,
    description: string,
  ): boolean {
    const requestTokens = this.semanticTokens(description);
    if (requestTokens.size === 0) return false;

    const plannedText = [
      plan.suggestedDomainName ?? '',
      ...plan.searchQueries,
      ...plan.evidenceTargets,
      ...plan.intentConcepts,
    ].join(' ');
    const plannedTokens = this.semanticTokens(plannedText);
    const overlap = [...plannedTokens].filter((token) => requestTokens.has(token));

    const minimumOverlap = Math.min(
      4,
      Math.max(2, Math.ceil(requestTokens.size / 12)),
    );

    return overlap.length >= minimumOverlap;
  }

  private buildDeterministicFallback(
    description: string,
    keywords: readonly string[],
  ): RequestCollectionPlan {
    const combined = `${description} ${keywords.join(' ')}`.trim();
    const domainName =
      this.inferSpecializedProfessionalDomainName(combined) ??
      inferDominantRequestDomainName(combined) ??
      this.inferGenericProfessionalDomainName(combined);
    const concepts = this.extractConcepts(combined);
    const searchQueries = this.buildRequestQueries(description, concepts);

    return {
      suggestedDomainName: domainName,
      searchQueries,
      evidenceTargets: this.buildEvidenceTargets(description, concepts),
      intentConcepts: concepts.slice(0, 8),
      sourceFocus: this.inferSourceFocus(description),
      confidence: domainName ? 78 : 62,
      aiUsed: false,
      fallbackUsed: true,
    };
  }

  private inferSpecializedProfessionalDomainName(value: string): string | null {
    const normalized = value.toLowerCase();

    if (
      /\b(?:dance studio|dance studios|dance school|dance schools|dance academy|dance instructor|dance instructors)\b/u.test(
        normalized,
      ) &&
      /\b(?:class schedules?|instructor availability|student attendance|choreography|costume|rehearsal|performance|recital)\b/u.test(
        normalized,
      )
    ) {
      return 'Dance Studio Operations & Performance Management';
    }

    if (
      /\b(?:tattoo studio|tattoo studios|tattoo artist|tattoo artists|tattoo appointment|tattoo appointments)\b/u.test(
        normalized,
      )
    ) {
      return 'Tattoo Studio Operations & Client Management';
    }

    if (
      /\b(?:shipment|shipments|chain of custody|handover records?|customs checkpoints?|carriers?|high-value goods|high value goods)\b/u.test(
        normalized,
      )
    ) {
      return 'Shipment Traceability & Chain-of-Custody Management';
    }

    if (
      /\b(?:recipe|recipes|cooking|cook regularly|ingredient substitutions?|family preferences?|cooking results?)\b/u.test(
        normalized,
      )
    ) {
      return 'Recipe & Culinary Knowledge Management';
    }

    if (
      /\b(?:trip|travelers?|accommodations?|activities|transportation|booking websites?|local experiences?)\b/u.test(
        normalized,
      )
    ) {
      return 'Travel Planning & Comparison';
    }

    if (
      /\b(?:book clubs?|reading groups?|reading schedules?|discussion topics?)\b/u.test(
        normalized,
      )
    ) {
      return 'Book Club & Reading Group Management';
    }

    if (
      /\b(?:photography studios?|shot lists?|editing requests?|image selections?)\b/u.test(
        normalized,
      )
    ) {
      return 'Photography Studio Operations';
    }

    return null;
  }

  private shouldPreferSpecificFallbackDomain(
    aiDomainName: string | null,
    fallbackDomainName: string | null,
  ): boolean {
    if (!fallbackDomainName || !aiDomainName) return false;
    if (
      aiDomainName.trim().toLocaleLowerCase() ===
      fallbackDomainName.trim().toLocaleLowerCase()
    ) {
      return false;
    }

    const broadDomains = new Set([
      'education',
      'business operations',
      'government',
      'logistics',
      'healthcare',
      'tourism',
      'media & entertainment',
      'sports & fitness',
    ]);

    return (
      broadDomains.has(aiDomainName.trim().toLocaleLowerCase()) &&
      !broadDomains.has(fallbackDomainName.trim().toLocaleLowerCase())
    );
  }

  private inferGenericProfessionalDomainName(value: string): string | null {
    const normalized = value.toLowerCase();

    if (
      /\b(?:tattoo studio|tattoo studios|tattoo artist|tattoo artists|tattoo appointment|tattoo appointments)\b/u.test(
        normalized,
      )
    ) {
      return 'Tattoo Studio Operations & Client Management';
    }

    if (
      /\b(?:shipment|shipments|chain of custody|handover records?|customs checkpoints?|carriers?|high-value goods|high value goods)\b/u.test(
        normalized,
      )
    ) {
      return 'Shipment Traceability & Chain-of-Custody Management';
    }

    if (
      /\b(?:recipe|recipes|cooking|cook regularly|ingredient substitutions?|family preferences?|cooking results?)\b/u.test(
        normalized,
      )
    ) {
      return 'Recipe & Culinary Knowledge Management';
    }

    if (
      /\b(?:trip|travelers?|accommodations?|activities|transportation|booking websites?|local experiences?)\b/u.test(
        normalized,
      )
    ) {
      return 'Travel Planning & Comparison';
    }

    if (
      /\b(?:book clubs?|reading groups?|reading schedules?|discussion topics?)\b/u.test(
        normalized,
      )
    ) {
      return 'Book Club & Reading Group Management';
    }

    if (
      /\b(?:photography studios?|shot lists?|editing requests?|image selections?)\b/u.test(
        normalized,
      )
    ) {
      return 'Photography Studio Operations';
    }

    const actor = this.extractActorContext(value);
    if (actor) {
      const professionalActor = this.professionalizeActor(actor);
      if (professionalActor) {
        if (
          /\b(?:client|customer|appointment|booking|schedule|preference|consent|deposit|revision|session)\b/u.test(
            normalized,
          )
        ) {
          return `${professionalActor} Operations & Client Management`.slice(0, 80);
        }

        if (
          /\b(?:record|records|history|document|documents|handover|audit|compliance)\b/u.test(
            normalized,
          )
        ) {
          return `${professionalActor} Operations & Record Management`.slice(0, 80);
        }

        return `${professionalActor} Operations & Workflow Management`.slice(0, 80);
      }
    }

    const concepts = this.extractConcepts(value)
      .filter((concept) => concept.split(' ').length <= 3)
      .slice(0, 2);

    if (concepts.length === 0) return null;

    const label = concepts
      .map((part) => this.toTitleCase(part))
      .join(' & ')
      .replace(/\s+/gu, ' ')
      .trim();

    return label.length >= 4 ? `${label} Management`.slice(0, 80) : null;
  }

  private buildRequestQueries(
    description: string,
    concepts: readonly string[],
  ): string[] {
    const normalized = description.toLowerCase();

    if (
      /\b(?:dance studio|dance studios|dance school|dance schools|dance academy|dance instructor|dance instructors)\b/u.test(
        normalized,
      )
    ) {
      return [
        'dance studio class scheduling instructor availability conflicts',
        'dance student attendance missed rehearsal tracking',
        'dance choreography progress performance readiness tracking',
        'dance costume requirements recital preparation coordination',
        'dance studio group chats calendars attendance sheets fragmented',
        'dance performance student readiness costume rehearsal records',
      ];
    }

    if (
      /\b(?:tattoo studio|tattoo studios|tattoo artist|tattoo artists)\b/u.test(
        normalized,
      )
    ) {
      return [
        'tattoo studio artist scheduling booking conflicts',
        'tattoo design revisions client feedback lost changes',
        'tattoo appointment deposits consent forms management',
        'tattoo client preferences session history records',
        'tattoo studio aftercare instructions communication',
        'tattoo studio messages calendars paper forms fragmented',
      ];
    }

    if (
      /\b(?:shipment|shipments|chain of custody|handover records?|customs checkpoints?|carriers?)\b/u.test(
        normalized,
      )
    ) {
      return [
        'high value shipment chain of custody missing handover records',
        'shipment temperature readings damaged goods responsibility dispute',
        'carrier warehouse customs shipment record reconciliation',
        'shipment location updates conflicting delivery confirmations',
        'multi carrier shipment handoff timeline missing events',
        'supply chain partner shipment accountability records dispute',
      ];
    }

    if (/\b(?:recipe|recipes|cooking|ingredient substitutions?)\b/u.test(normalized)) {
      return [
        'saved recipes scattered across apps hard to find',
        'recipe ingredient substitutions personal changes forgotten',
        'family recipe preferences notes not stored together',
        'cooking results recipe adjustments hard to recreate',
        'recipe collection search organization home cook',
        'wasted ingredients forgotten recipe changes',
      ];
    }

    if (
      /\b(?:travelers?|accommodations?|activities|transportation|local experiences?|booking websites?)\b/u.test(
        normalized,
      )
    ) {
      return [
        'travel accommodation price comparison across booking platforms',
        'hotel activity transportation availability comparison',
        'travel price changes budget planning reviews scattered',
        'multi platform trip planning traveler preferences',
        'travel booking missed deals price availability',
        'trip planning reviews activities transport budget comparison',
      ];
    }

    const actor = this.extractActorContext(description);
    const painSignals = this.extractPainSignals(description);
    const compactConcepts = concepts.slice(0, 6);
    const rawQueries: string[] = [];

    for (let index = 0; index < compactConcepts.length; index += 1) {
      const concept = compactConcepts[index];
      const next = compactConcepts[(index + 1) % compactConcepts.length];
      const pain = painSignals[index % Math.max(1, painSignals.length)] ?? '';
      rawQueries.push(this.composeQuery(actor, concept, next, pain));
      if (rawQueries.length >= 6) break;
    }

    if (rawQueries.length < 4) {
      for (const pain of painSignals) {
        rawQueries.push(this.composeQuery(actor, ...compactConcepts.slice(0, 2), pain));
        if (rawQueries.length >= 6) break;
      }
    }

    return this.deduplicateQueries(rawQueries).slice(0, 6);
  }

  private buildEvidenceTargets(
    description: string,
    concepts: readonly string[],
  ): string[] {
    const normalized = description.toLowerCase();
    const targets: string[] = [];

    if (
      /\b(?:scattered|different platforms|separate systems|multiple apps|social media messages?|paper forms?|personal devices?|different organizations?)\b/u.test(
        normalized,
      )
    ) {
      targets.push('fragmented records or information across multiple tools or organizations');
    }
    if (/\b(?:missing|conflicting|lost|inconsistent)\b/u.test(normalized)) {
      targets.push('missing, conflicting, lost, or inconsistent records');
    }
    if (/\b(?:price|prices|cost|expenses?|budget)\b/u.test(normalized)) {
      targets.push('price, cost, or budget comparison friction');
    }
    if (/\b(?:availability|schedule|schedules|appointment|appointments|booking|bookings)\b/u.test(normalized)) {
      targets.push('availability, scheduling, or booking conflicts');
    }
    if (/\b(?:handover|chain of custody|responsibility|dispute|liability)\b/u.test(normalized)) {
      targets.push('handover, custody, responsibility, or dispute attribution gaps');
    }
    if (/\b(?:temperature|sensor|telemetry|location updates?)\b/u.test(normalized)) {
      targets.push('missing or inconsistent location or sensor telemetry');
    }
    if (/\b(?:preferences?|personal changes|substitutions?|reviews?|design revisions?)\b/u.test(normalized)) {
      targets.push('preference, revision, or change-history tracking');
    }
    if (/\b(?:consent forms?|deposits?|aftercare|session history)\b/u.test(normalized)) {
      targets.push('client forms, deposits, aftercare, or session-history coordination');
    }
    if (/\b(?:choreography|costume|costumes|rehearsal|rehearsals|performance readiness|recital|recitals)\b/u.test(normalized)) {
      targets.push('choreography, rehearsal, costume, or performance-readiness tracking gaps');
    }

    for (const pain of this.extractPainSignals(description)) {
      if (targets.length >= 6) break;
      targets.push(pain);
    }

    for (const concept of concepts) {
      if (targets.length >= 6) break;
      targets.push(`${concept} coordination or record gap`);
    }

    return this.normalizeStrings(targets, 6, 6);
  }

  private inferSourceFocus(description: string): RequestCollectionSourceFocus[] {
    const normalized = description.toLowerCase();

    if (
      /\b(?:city planner|city planners|urban planning|municipal planning|neighborhood management|neighbourhood management|public housing|residential planning|city planning|property managers?.{0,80}city|city.{0,80}property managers?)\b/u.test(
        normalized,
      )
    ) {
      return ['FORUMS', 'NEWS', 'REVIEWS'];
    }

    if (
      /\b(?:flower shop|flower shops|florist|florists|bouquet|bouquets|custom order|custom orders|local supplier|local suppliers|small shop|small business)\b/u.test(
        normalized,
      ) &&
      /\b(?:order|orders|inventory|availability|delivery|customer|supplier|schedule|booking|substitution|preference|requirements?)\b/u.test(
        normalized,
      )
    ) {
      return ['FORUMS', 'REVIEWS', 'NEWS'];
    }

    if (
      /\b(?:shipment|shipments|logistics|warehouse|warehouses|carrier|carriers|customs|supply[- ]chain|chain of custody|handover|telemetry|sensor|sensors)\b/u.test(
        normalized,
      )
    ) {
      return ['FORUMS', 'TECHNICAL', 'NEWS'];
    }

    if (
      /\b(?:api|developer|developers|sdk|code|integration|runtime|exception|github|database|docker|container|network route|stack trace)\b/u.test(
        normalized,
      )
    ) {
      return ['TECHNICAL', 'FORUMS'];
    }

    if (
      /\b(?:studio|appointment|booking|client|customer|consumer|recipe|travel|shipment|delivery|courier|home cook|member|service business)\b/u.test(
        normalized,
      )
    ) {
      return ['REVIEWS', 'FORUMS', 'PRODUCT_DISCOVERY'];
    }

    return ['FORUMS', 'REVIEWS', 'NEWS'];
  }

  private extractConcepts(value: string): string[] {
    const normalized = value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const phrasePatterns = [
      /\bhigh[- ]value shipments?\b/u,
      /\bchain of custody\b/u,
      /\blocation updates?\b/u,
      /\bhandover records?\b/u,
      /\btemperature readings?\b/u,
      /\bdelivery confirmations?\b/u,
      /\bcustoms checkpoints?\b/u,
      /\bshipment disputes?\b/u,
      /\bsupply[- ]chain partners?\b/u,
      /\bartist schedules?\b/u,
      /\bdesign revisions?\b/u,
      /\bclient preferences?\b/u,
      /\bappointment deposits?\b/u,
      /\bconsent forms?\b/u,
      /\baftercare instructions?\b/u,
      /\bclient sessions?\b/u,
      /\bbooking conflicts?\b/u,
      /\bdesign feedback\b/u,
      /\brecipe substitutions?\b/u,
      /\bcooking results?\b/u,
      /\bfamily preferences?\b/u,
      /\btravel prices?\b/u,
      /\bbooking platforms?\b/u,
      /\btraveler preferences?\b/u,
      /\breading progress\b/u,
      /\bmeeting dates?\b/u,
    ];

    const phrases: string[] = [];
    for (const pattern of phrasePatterns) {
      const match = normalized.match(pattern)?.[0];
      if (match) phrases.push(match);
    }

    const stopWords = new Set([
      'about', 'across', 'after', 'again', 'also', 'although', 'among', 'and',
      'are', 'because', 'before', 'being', 'between', 'can', 'could', 'different',
      'difficulty', 'difficult', 'from', 'have', 'important', 'information', 'into',
      'making', 'many', 'needed', 'often', 'other', 'people', 'rarely', 'regularly',
      'separate', 'significant', 'some', 'spend', 'struggle', 'struggles', 'their',
      'them', 'they', 'this', 'through', 'usually', 'while', 'with', 'without',
      'lead', 'leads', 'stored', 'spread', 'frequently',
    ]);

    const tokens = normalized
      .split(/\s+/u)
      .filter((token) => token.length >= 4 && !stopWords.has(token));

    for (let index = 0; index < tokens.length - 1 && phrases.length < 12; index += 2) {
      const pair = [tokens[index], tokens[index + 1]].filter(Boolean).join(' ');
      if (pair) phrases.push(pair);
    }

    return this.deduplicatePhrases(phrases).slice(0, 10);
  }

  private extractActorContext(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const match = normalized.match(
      /^(.{3,80}?)\s+(?:often|frequently|regularly|commonly|sometimes)\s+(?:struggle|struggles|have difficulty|find it difficult)\b/iu,
    );

    if (!match?.[1]) return '';

    return match[1]
      .replace(/^(?:many|some|most)\s+/iu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 5)
      .join(' ');
  }

  private professionalizeActor(actor: string): string | null {
    if (!actor) return null;

    const words = actor
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean);

    if (words.length === 0 || words.length > 5) return null;

    const last = words[words.length - 1];
    const singularMap: Record<string, string> = {
      studios: 'studio',
      companies: 'company',
      businesses: 'business',
      clinics: 'clinic',
      agencies: 'agency',
      teams: 'team',
      restaurants: 'restaurant',
      salons: 'salon',
      shops: 'shop',
      centers: 'center',
      centres: 'centre',
    };
    if (singularMap[last]) {
      words[words.length - 1] = singularMap[last];
    }

    const cleaned = words.filter(
      (word) => !['people', 'users', 'members', 'travelers', 'travellers'].includes(word),
    );

    return cleaned.length > 0 ? this.toTitleCase(cleaned.join(' ')) : null;
  }

  private extractPainSignals(description: string): string[] {
    const normalized = description
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/gu, ' ');

    const signals: string[] = [];
    const consequenceMatch = normalized.match(
      /\b(?:lead to|leads to|result in|results in|causing|cause)\s+([^.!?]{8,260})/u,
    );

    if (consequenceMatch?.[1]) {
      for (const part of consequenceMatch[1].split(/,|\band\b/gu)) {
        const cleaned = part
          .replace(/\b(?:can|may|often|difficulty|difficult)\b/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim();
        if (cleaned.length >= 5) signals.push(cleaned);
      }
    }

    const directPatterns = [
      /\bbooking conflicts?\b/u,
      /\blost design feedback\b/u,
      /\bconfusion about requested changes\b/u,
      /\bmissing records?\b/u,
      /\bconflicting records?\b/u,
      /\bshipment disputes?\b/u,
      /\bdamaged goods?\b/u,
      /\bdelayed deliveries?\b/u,
      /\brepeated searching\b/u,
      /\bwasted ingredients?\b/u,
      /\bmissed opportunities?\b/u,
      /\bunnecessary expenses?\b/u,
    ];

    for (const pattern of directPatterns) {
      const match = normalized.match(pattern)?.[0];
      if (match) signals.push(match);
    }

    return this.deduplicatePhrases(signals).slice(0, 6);
  }

  private composeQuery(...parts: Array<string | undefined>): string {
    const tokens: string[] = [];
    const seen = new Set<string>();

    for (const part of parts) {
      if (!part) continue;
      for (const token of part
        .toLowerCase()
        .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
        .split(/\s+/u)
        .filter(Boolean)) {
        if (seen.has(token)) continue;
        seen.add(token);
        tokens.push(token);
      }
    }

    return tokens.join(' ').slice(0, 140);
  }

  private normalizeDomainName(
    value: string | null,
    fallback: string | null,
    description: string,
  ): string | null {
    const canonical = inferDominantRequestDomainName(description);
    if (canonical) return canonical;

    const cleaned = value
      ?.replace(/\s+/gu, ' ')
      .replace(/[.!?]+$/gu, '')
      .trim();

    if (!cleaned) return fallback;

    if (
      cleaned.length > 80 ||
      /^(?:people|users|companies|travelers|travellers|members|owners|teams?|students?)\b/iu.test(cleaned) ||
      /\b(?:often|struggle|struggles|need to|want to|who|coordinate artist|studios coordinate)\b/iu.test(cleaned)
    ) {
      return fallback;
    }

    const wordCount = cleaned.split(/\s+/u).length;
    return wordCount >= 2 && wordCount <= 8 ? cleaned : fallback;
  }

  private normalizeQueries(value: unknown, maxItems: number): string[] {
    if (!Array.isArray(value)) return [];

    return this.deduplicateQueries(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => this.cleanRepeatedQueryTokens(item))
        .filter((item) => item.length >= 12),
    ).slice(0, maxItems);
  }

  private cleanRepeatedQueryTokens(value: string): string {
    const normalized = value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const output: string[] = [];
    for (const token of normalized.split(/\s+/u)) {
      if (output[output.length - 1] === token) continue;
      output.push(token);
    }

    return output.join(' ').slice(0, 140);
  }

  private deduplicateQueries(values: readonly string[]): string[] {
    const output: string[] = [];
    const fingerprints: Array<Set<string>> = [];

    for (const raw of values) {
      const value = this.cleanRepeatedQueryTokens(raw);
      if (value.length < 8) continue;

      const tokens = this.semanticTokens(value);
      const duplicate = fingerprints.some((existing) => {
        const intersection = [...tokens].filter((token) => existing.has(token)).length;
        const denominator = Math.max(1, Math.min(tokens.size, existing.size));
        return intersection / denominator >= 0.82;
      });

      if (duplicate) continue;
      fingerprints.push(tokens);
      output.push(value);
    }

    return output;
  }

  private deduplicatePhrases(values: readonly string[]): string[] {
    const output: string[] = [];
    const seen = new Set<string>();

    for (const raw of values) {
      const value = raw.replace(/\s+/gu, ' ').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }

    return output;
  }

  private normalizeStrings(
    value: unknown,
    maxItems: number,
    minLength: number,
  ): string[] {
    if (!Array.isArray(value)) return [];

    return this.deduplicatePhrases(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/\s+/gu, ' ').trim())
        .filter((item) => item.length >= minLength),
    ).slice(0, maxItems);
  }

  private normalizeSourceFocus(value: unknown): RequestCollectionSourceFocus[] {
    const allowed = new Set<RequestCollectionSourceFocus>([
      'REVIEWS',
      'FORUMS',
      'TECHNICAL',
      'NEWS',
      'PRODUCT_DISCOVERY',
    ]);
    if (!Array.isArray(value)) return [];

    return [...new Set(
      value.filter(
        (item): item is RequestCollectionSourceFocus =>
          typeof item === 'string' && allowed.has(item as RequestCollectionSourceFocus),
      ),
    )].slice(0, 4);
  }

  private normalizeScore(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : fallback;
  }

  private semanticTokens(value: string): Set<string> {
    return new Set(
      value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/u)
        .filter((token) => token.length >= 4),
    );
  }

  private toTitleCase(value: string): string {
    return value
      .split(/\s+/u)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
