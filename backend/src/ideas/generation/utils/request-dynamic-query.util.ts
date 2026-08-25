import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';
import { RequestNicheCustomCraftUtil } from './request-niche-custom-craft.util';
import { RequestOnlinePharmacyFraudUtil } from './request-online-pharmacy-fraud.util';

export type DynamicRequestQueryInput = {
  readonly requestDescription?: string | null;
  readonly intentConcepts?: readonly string[];
  readonly evidenceTargets?: readonly string[];
  readonly plannedQueries?: readonly string[];
  readonly maxQueries?: number;
};

export class RequestDynamicQueryUtil {
  static build(input: DynamicRequestQueryInput): string[] {
    const rawDescription = (input.requestDescription ?? '')
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    const description = this.cleanText(rawDescription);
    if (!description) return [];

    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
    const evidenceFacetQueries = this.buildEvidenceFacetQueries({
      ...input,
      maxQueries,
    });
    const specialized = this.buildSpecializedQueries(rawDescription, maxQueries);

    /*
     * Generic request facets are the primary retrieval contract. A request does
     * not need a known vertical to receive useful evidence queries. Existing
     * specialized queries are retained only as bounded precision hints after
     * the request-derived actor/workflow/pain facets have been represented.
     */
    if (evidenceFacetQueries.length >= Math.min(4, maxQueries)) {
      const genericBudget = Math.max(4, Math.ceil(maxQueries * 0.75));
      return this.deduplicate([
        ...evidenceFacetQueries.slice(0, genericBudget),
        ...specialized.slice(0, Math.max(0, maxQueries - genericBudget)),
      ]).slice(0, maxQueries);
    }

    const actor = this.extractActor(description);
    const actorAliases = this.buildActorAliases(actor || description);
    const explicitConcepts = (input.intentConcepts ?? [])
      .map((value) => this.compactPhrase(value, 6))
      .filter(Boolean);
    const concepts = this.unique(
      explicitConcepts.length >= 3
        ? explicitConcepts
        : [...explicitConcepts, ...this.extractWorkflowPhrases(rawDescription)],
    ).slice(0, 8);
    const failures = this.unique([
      ...this.extractFailurePhrases(rawDescription),
      ...(input.evidenceTargets ?? []).flatMap((value) =>
        this.extractFailurePhrases(value),
      ),
    ]).filter(Boolean).slice(0, 8);

    const queries: string[] = [];
    const actorTerm = actorAliases[0] || actor || this.extractFallbackSubject(description);
    const compactActor = actorAliases[1] || actorTerm;
    const tradeActor = actorAliases[2] || compactActor;

    for (let index = 0; index < concepts.length && queries.length < maxQueries; index += 1) {
      const concept = concepts[index];
      const nextConcept = concepts[(index + 1) % Math.max(1, concepts.length)] ?? '';
      const failure = failures[index % Math.max(1, failures.length)] ?? '';
      const alias = actorAliases[index % Math.max(1, actorAliases.length)] || actorTerm;

      queries.push(this.compose(alias, concept, failure));
      if (queries.length < maxQueries && nextConcept) {
        queries.push(this.compose(compactActor, concept, nextConcept));
      }
    }

    if (queries.length < maxQueries) {
      for (let index = 0; index < failures.length && queries.length < maxQueries; index += 1) {
        queries.push(
          this.compose(
            actorAliases[(index + 1) % Math.max(1, actorAliases.length)] || tradeActor,
            concepts[index % Math.max(1, concepts.length)] ?? '',
            failures[index],
          ),
        );
      }
    }

    if (queries.length < maxQueries && /\b(?:scattered|fragmented|handwritten|messages?|photos?|samples?|separate systems?)\b/iu.test(description)) {
      queries.push(
        this.compose(
          tradeActor,
          concepts.slice(0, 2).join(' '),
          'scattered records',
        ),
      );
    }

    if (queries.length < Math.min(4, maxQueries)) {
      const descriptionTokens = this.semanticTokens(description).slice(0, 10);
      if (descriptionTokens.length > 0) {
        queries.push(
          this.compose(compactActor, descriptionTokens.slice(0, 5).join(' ')),
        );
      }
    }

    return this.deduplicate(queries)
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, maxQueries);
  }

  /**
   * Builds request-derived evidence queries without knowing or hard-coding a
   * domain. The request itself is decomposed into actor/object identity,
   * workflow facets, and pain/outcome facets so separate real observations can
   * later be combined into one composite evidence set.
   */
  static buildEvidenceFacetQueries(input: DynamicRequestQueryInput): string[] {
    const rawDescription = (input.requestDescription ?? '')
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    const description = this.cleanText(rawDescription);
    if (!description) return [];

    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 10, 14));
    const intentProfile = RequestWorkflowIntentProfileUtil.resolve(rawDescription);
    const specializedFirst = this.buildSpecializedQueries(rawDescription, maxQueries);
    const actor = this.extractActor(description);
    const actorAliases = this.buildActorAliases(actor || description);
    const workflows = this.unique([
      ...(input.intentConcepts ?? []).map((value) => this.compactPhrase(value, 6)),
      ...this.extractWorkflowPhrases(rawDescription),
    ]).filter(Boolean).slice(0, 10);
    const pains = this.unique([
      ...this.extractFailurePhrases(rawDescription),
      ...(input.evidenceTargets ?? []).flatMap((value) =>
        this.extractFailurePhrases(value),
      ),
    ]).filter(Boolean).slice(0, 10);
    const identityTerms = this.extractEvidenceIdentityTerms(rawDescription).slice(0, 12);
    const identityPhrases = this.buildIdentityPhrases(identityTerms);
    const actors = actorAliases.length > 0
      ? actorAliases
      : [this.extractFallbackSubject(description)].filter(Boolean);
    const queries: string[] = [];

    const add = (...parts: string[]) => {
      const query = this.compose(...parts);
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    for (
      let index = 0;
      index < Math.min(4, Math.max(workflows.length, pains.length));
      index += 1
    ) {
      add(
        actors[index % Math.max(1, actors.length)] ?? '',
        workflows[index % Math.max(1, workflows.length)] ?? '',
        pains[index % Math.max(1, pains.length)] ?? '',
      );
    }

    for (
      let index = 0;
      index < identityPhrases.length && queries.length < maxQueries;
      index += 1
    ) {
      add(
        identityPhrases[index],
        workflows[index % Math.max(1, workflows.length)] ?? '',
        pains[index % Math.max(1, pains.length)] ?? '',
      );
    }

    for (
      let index = 0;
      index < workflows.length && queries.length < maxQueries;
      index += 1
    ) {
      const next = workflows[(index + 1) % Math.max(1, workflows.length)] ?? '';
      add(
        identityPhrases[index % Math.max(1, identityPhrases.length)] ?? actors[0] ?? '',
        workflows[index],
        next,
      );
    }

    for (
      let index = 0;
      index < pains.length && queries.length < maxQueries;
      index += 1
    ) {
      add(
        identityPhrases[index % Math.max(1, identityPhrases.length)] ?? actors[0] ?? '',
        workflows[index % Math.max(1, workflows.length)] ?? '',
        pains[index],
      );
    }

    const genericQueries = this.deduplicate(queries);
    if (specializedFirst.length > 0) {
      const specializedBudget =
        intentProfile.family === 'GENERAL'
          ? Math.min(4, maxQueries)
          : Math.min(6, maxQueries);
      return this.deduplicate([
        ...specializedFirst.slice(0, specializedBudget),
        ...genericQueries.filter((query) =>
          RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(description, query),
        ),
        ...specializedFirst.slice(specializedBudget),
      ]).slice(0, maxQueries);
    }
    return genericQueries.slice(0, maxQueries);
  }

  /**
   * Builds a second retrieval wave from the AI-planned queries without knowing
   * the domain. Exact first-pass queries can be too narrow for sparse or niche
   * communities, so this method removes meta-search wording, keeps stable
   * profession/object/workflow terms, and creates shorter lexical variants.
   *
   * These queries are retrieval-only. They never count as evidence and they do
   * not weaken downstream evidence verification.
   */
  static buildRelaxedRetrievalQueries(
    input: DynamicRequestQueryInput,
  ): string[] {
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 6, 10));
    const planned = this.unique(
      (input.plannedQueries ?? [])
        .map((value) => this.cleanText(value))
        .filter(Boolean)
        .filter((value) =>
          RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(
            input.requestDescription,
            value,
          ),
        ),
    );
    const description = this.cleanText(input.requestDescription ?? '');
    if (planned.length === 0 && !description) return [];

    const retrievalStopWords = new Set([
      ...this.stopWords,
      'about',
      'complaint',
      'complaints',
      'discussion',
      'discussions',
      'example',
      'examples',
      'operator',
      'operators',
      'report',
      'reports',
      'reported',
      'problem',
      'problems',
      'issue',
      'issues',
      'difficult',
      'difficulty',
      'protect',
      'protecting',
      'allow',
      'allowing',
      'maintain',
      'maintaining',
      'lead',
      'leads',
      'leading',
    ]);

    const queryTokens = planned.map((query) =>
      this.semanticTokens(
        query
          .replace(
            /^(?:complaints? about|discussions? (?:about|on)|operator reports? (?:about|of)|reports? of|examples? of)\s+/iu,
            '',
          )
          .replace(/\b(?:problem|problems|workflow issue|user problem)\b/giu, ' '),
      ).filter((token) => !retrievalStopWords.has(token)),
    );

    const frequency = new Map<string, number>();
    for (const tokens of queryTokens) {
      for (const token of new Set(tokens)) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
      }
    }

    const stableTerms = [...frequency.entries()]
      .filter(([token, count]) => token.length >= 4 && count >= 2)
      .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
      .map(([token]) => token)
      .slice(0, 8);

    const actor = this.extractActor(description);
    const actorAliases = this.buildActorAliases(actor || description);
    const actorTerm = actorAliases[1] || actorAliases[0] || actor;
    const workflowTerms = this.extractWorkflowPhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 6);
    const painTerms = this.extractFailurePhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 4);

    const retrievalSignalTerms = new Set([
      'profit',
      'profitability',
      'margin',
      'margins',
      'cost',
      'costs',
      'revenue',
      'advertising',
      'subscription',
      'churn',
      'cancellation',
      'cancellations',
      'budget',
      'budgeting',
      'forecast',
      'forecasting',
      'revision',
      'revisions',
      'approval',
      'approved',
      'incorrect',
      'wrong',
      'rework',
      'waste',
      'wasted',
      'delay',
      'delayed',
      'missing',
      'lost',
      'failure',
      'failed',
      'scattered',
      'fragmented',
    ]);
    const actorTokenSet = new Set(this.semanticTokens(actorTerm));
    const queries: string[] = [];

    for (const tokens of queryTokens.slice(0, 6)) {
      if (tokens.length < 2) continue;
      const distinctive = this.unique([
        ...tokens.filter((token) => retrievalSignalTerms.has(token)),
        ...tokens.filter((token) => actorTokenSet.has(token)).slice(0, 3),
        ...tokens.filter((token) => stableTerms.includes(token)),
        ...tokens,
      ]).slice(0, 7);
      if (distinctive.length >= 2) {
        queries.push(distinctive.join(' '));
      }
    }

    for (let index = 0; index < workflowTerms.length && queries.length < maxQueries; index += 1) {
      queries.push(
        this.compose(
          actorTerm,
          workflowTerms[index],
          painTerms[index % Math.max(1, painTerms.length)] ?? '',
        ),
      );
    }

    if (stableTerms.length >= 3 && queries.length < maxQueries) {
      queries.push(stableTerms.slice(0, 5).join(' '));
    }

    const identityTerms = this.extractEvidenceIdentityTerms(description);
    if (identityTerms.length >= 2 && queries.length < maxQueries) {
      queries.push(
        this.compose(
          identityTerms.slice(0, 3).join(' '),
          workflowTerms[0] ?? '',
        ),
      );
    }

    return this.deduplicate(queries)
      .map((query) => query.split(/\s+/u).slice(0, 7).join(' '))
      .filter((query) => query.split(/\s+/u).length >= 2)
      .slice(0, maxQueries);
  }

  /**
   * Converts AI evidence targets and professional planner vocabulary into
   * search-engine-shaped recovery queries. Evidence targets are often the most
   * precise description of what a real external source should say, but older
   * recovery code reduced them to short generic fragments. This method keeps
   * the actor/object identity plus the professional failure terms while
   * removing meta phrases such as "reports of" and "case studies on".
   *
   * The output is retrieval-only and never counts as evidence.
   */
  static buildProfessionalEvidenceQueries(
    input: DynamicRequestQueryInput,
  ): string[] {
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
    const description = this.cleanText(input.requestDescription ?? '');
    if (!description) return [];

    const meta = /\b(?:reports?|reported|reporting|discussions?|discussing|case studies?|case study|examples?|accounts? of|complaints?|practitioner|practitioners|operator|operators|highlighting|regarding|describing|detailing|showing|instances? of)\b/giu;
    const searchStopWords = new Set([
      ...this.stopWords,
      'would', 'could', 'should', 'need', 'needs', 'mention', 'mentions',
      'support', 'supports', 'supporting', 'evidence', 'real', 'external',
    ]);

    const cleanTarget = (value: string): string => {
      const tokens = this.semanticTokens(
        this.cleanText(value).replace(meta, ' '),
      ).filter((token) => !searchStopWords.has(token));
      return tokens.slice(0, 9).join(' ');
    };

    const targetQueries = (input.evidenceTargets ?? [])
      .map(cleanTarget)
      .filter((query) => query.split(/\s+/u).length >= 3);

    const plannedQueries = (input.plannedQueries ?? [])
      .map((value) => this.cleanText(value))
      .filter(Boolean)
      .filter((value) =>
        RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(
          input.requestDescription,
          value,
        ),
      )
      .map((value) => value.split(/\s+/u).slice(0, 9).join(' '))
      .filter((value) => {
        const normalized = value.toLocaleLowerCase();
        return /\b(?:deprovision|offboard|orphan|privilege|entitlement|identity|access|audit|risk|anomal|condition|assessment|conservation|treatment|repair history|service history|record keeping|documentation|rework|delay|missing|incorrect|unauthori[sz]ed|suspicious|fragmented|scattered|reconciliation|approval|replacement)\w*\b/iu.test(normalized);
      });

    const actor = this.extractActor(description);
    const actorAliases = this.buildActorAliases(actor || description);
    const actorTerm = actorAliases[1] || actorAliases[0] || actor;
    const identity = this.extractEvidenceIdentityTerms(description).slice(0, 4).join(' ');
    const workflows = this.extractWorkflowPhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 4);
    const pains = this.extractFailurePhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 4);

    const derived: string[] = [];
    for (let index = 0; index < Math.max(workflows.length, pains.length); index += 1) {
      derived.push(
        this.compose(
          actorTerm || identity,
          workflows[index % Math.max(1, workflows.length)] ?? '',
          pains[index % Math.max(1, pains.length)] ?? '',
        ),
      );
    }

    return this.deduplicate([
      ...targetQueries,
      ...plannedQueries,
      ...derived,
      ...this.buildRelaxedRetrievalQueries({
        ...input,
        maxQueries: Math.min(4, maxQueries),
      }),
    ])
      .map((query) => query.split(/\s+/u).slice(0, 9).join(' '))
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, maxQueries);
  }

  /**
   * Distinctive identity tokens derived from the request itself. This keeps
   * unseen nouns available to retrieval/alignment without adding a domain rule.
   */
  static extractEvidenceIdentityTerms(value: string): string[] {
    const cleaned = this.cleanText(value).toLocaleLowerCase();
    if (!cleaned) return [];

    const actor = this.extractActor(cleaned);
    const broad = new Set([
      'independent', 'specialist', 'specialists', 'business', 'businesses',
      'company', 'companies', 'department', 'departments', 'team', 'teams',
      'operator', 'operators', 'provider', 'providers', 'service', 'services',
      'customer', 'customers', 'client', 'clients', 'management', 'operations',
      'workflow', 'workflows', 'record', 'records', 'tracking', 'track',
      'information', 'data', 'system', 'systems', 'platform', 'platforms',
      'software', 'application', 'applications', 'problem', 'problems',
      'history', 'notes',
      'often', 'struggle', 'struggles', 'document', 'manage', 'review',
      'analyze', 'analyzed', 'analysed', 'separate', 'separately', 'difficult',
      'precise', 'approved', 'progress', 'project', 'projects', 'delayed',
      'lead', 'leads', 'leading', 'making', 'maintain', 'activity',
      'protect', 'protecting', 'allow', 'allowing', 'exchange', 'exchanging',
      'detect', 'detecting', 'trace', 'tracing', 'quickly', 'necessary', 'can',
    ]);

    return this.unique(
      this.semanticTokens(`${actor} ${cleaned}`)
        .filter((token) => !broad.has(token))
        .filter((token) => token.length >= 4),
    ).slice(0, 14);
  }

  private static buildIdentityPhrases(identityTerms: readonly string[]): string[] {
    const phrases: string[] = [];
    for (let index = 0; index < identityTerms.length; index += 1) {
      const current = identityTerms[index];
      const next = identityTerms[index + 1];
      if (current && next) phrases.push(`${current} ${next}`);
      if (current) phrases.push(current);
    }
    return this.unique(phrases).slice(0, 8);
  }

  private static buildSpecializedQueries(
    description: string,
    maxQueries: number,
  ): string[] {
    const normalized = this.cleanText(description).toLocaleLowerCase();
    const intentProfile = RequestWorkflowIntentProfileUtil.resolve(description);

    /*
     * High-value first-pass retrieval contracts for the two recurrent failure
     * modes seen in QA: logistics shipment-integrity incidents and professional
     * book conservation/restoration. These queries deliberately name the
     * concrete object + failure mechanism so generic routing/AI/book-content
     * results do not dominate the raw corpus.
     */
    if (
      /\b(?:logistics companies?|logistics providers?|3pl|third[- ]party logistics|parcel carriers?|freight companies?|delivery operators?|warehouses?)\b/u.test(normalized) &&
      /\b(?:suspicious shipment|shipment changes?|unauthorized access|delivery accounts?|unusual routing|redirected|rerout|cargo fraud|shipment fraud|stolen goods?|false claims?|tracking records?|warehouse scans?|security alerts?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        '3PL missing packages warehouse carrier handoff scans proof of receipt',
        'shipment rerouting fraud unauthorized delivery account destination change',
        'cargo theft tracking discrepancy warehouse scan carrier handoff',
        'parcel redirected after account takeover unauthorized address change',
        'logistics shipment chain of custody missing scan lost package investigation',
        'carrier warehouse conflicting tracking records missing shipment',
        'freight cargo fraud unusual route diversion tracking anomaly',
        'delivery account unauthorized access shipment reroute security alert',
        'shipment compromise warehouse scan driver update tracking mismatch',
        'false delivery claim proof of handoff missing carrier scan logistics',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:book restoration specialists?|book restorers?|book conservation|book conservators?|book repair specialists?|rare book restoration|manuscript conservation)\b/u.test(normalized) &&
      /\b(?:damaged bindings?|torn pages?|missing sections?|previous repairs?|paper condition|preservation preferences?|restoration history|treatment history|repair history|condition assessment)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'book conservator condition report binding damage previous repairs documentation',
        'book restoration torn pages missing sections treatment history records',
        'rare book conservation previous treatment repair history paper condition',
        'bookbinding restoration material selection repair documentation rework',
        'book conservation treatment records photographs notes client preferences',
        'book repair unsuitable materials previous repair history paper damage',
        'manuscript conservation missing leaves binding repair condition assessment',
        'book restoration workshop records material samples treatment decisions',
        'book conservator repeated treatment missing documentation previous repairs',
        'book preservation client preferences repair history binding condition',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:digital media companies?|media companies?|streaming platforms?|streaming services?|digital publishers?|online media platforms?|video platforms?|content platforms?)\b/u.test(normalized) &&
      /\b(?:shows?|videos?|content|subscription plans?|subscription tiers?|production costs?|advertising revenue|subscription activity|audience engagement|cancellation patterns?|churn|profitability|sustainable profit|budgeting|revenue forecasts?)\b/u.test(normalized)
    ) {
      const actor = this.extractActor(description) || 'digital media company';
      return this.deduplicate([
        `${actor} content profitability production cost advertising revenue`,
        `${actor} show profitability subscription revenue production cost margin`,
        `${actor} video content ROI advertising yield audience engagement cost`,
        `${actor} subscription plan profitability churn cancellation revenue margin`,
        `${actor} content budget production spending revenue forecast accuracy`,
        `${actor} content cost attribution subscriber activity profitability`,
        `${actor} show investment audience engagement revenue performance`,
        `${actor} content portfolio unnecessary production expense budgeting forecast`,
      ]).slice(0, maxQueries);
    }


    if (
      /\b(?:public education authorities?|education authorities?|school districts?|education departments?|ministr(?:y|ies) of education|public school systems?)\b/u.test(normalized) &&
      /\b(?:teachers?|staffing|learning resources?|intervention programs?|enrollment|attendance|assessment|school reports?|resource distribution|overcrowded classrooms?|education spending)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'school district teacher shortage resource allocation staffing needs',
        'public schools overcrowded classrooms staffing resource allocation',
        'education authority enrollment attendance staffing early warning resource gaps',
        'school district assessment attendance data intervention resource allocation',
        'education management information systems fragmented school records resource planning',
        'public school funding allocation uneven resources student needs',
        'school staffing levels enrollment trends resource planning delayed support',
        'education authority school performance data resource allocation intervention',
      ]).slice(0, maxQueries);
    }

    const nicheCraftProfile = RequestNicheCustomCraftUtil.resolve(description);
    if (nicheCraftProfile) {
      const nicheQueries = RequestNicheCustomCraftUtil.buildSourceQueries(
        description,
        'generic',
      );
      if (nicheQueries.length > 0) {
        return this.deduplicate(nicheQueries).slice(0, maxQueries);
      }
    }

    const watchStrapSpecification =
      /\b(?:watch straps?|watch bands?|leather watch straps?|leather watch bands?|watch strap makers?|watch band makers?|bespoke straps?)\b/u.test(normalized) &&
      /\b(?:wrist measurements?|wrist sizes?|strap lengths?|strap widths?|lug widths?|leather types?|material choices?|stitching styles?|buckle selections?|design revisions?|customer approvals?|approved specifications?|wrong sizes?|sizing errors?|remakes?|rework|wasted leather|delayed orders?)\b/u.test(normalized);
    if (watchStrapSpecification) {
      return this.deduplicate([
        'custom watch strap wrong size wrist measurement remake',
        'watch band lug width strap length sizing mistake',
        'leather watch strap customer design revision approval rework',
        'bespoke watch strap leather material selection customer approval',
        'watch strap wrong leather stitching buckle order remake',
        'custom leather watch band approved specification changed revision',
        'watch strap maker customer measurement wrong size delayed order',
        'leathercraft custom order measurement material revision remake',
        'custom leather order customer changed design approval rework',
        'leatherworker bespoke order measurement mistake wasted leather',
      ]).slice(0, maxQueries);
    }

    if (intentProfile.family === 'SPECIFICATION_APPROVAL') {
      const actor = this.extractActor(description) || 'custom production specialist';
      return this.deduplicate([
        `${actor} measurement specification incorrect production`,
        `${actor} customer revision final approval errors`,
        `${actor} material selection mismatch rework`,
        `${actor} dimensions color specification wasted material`,
        `${actor} approved version revision tracking`,
        `${actor} handwritten measurements lost customer instructions`,
        `${actor} final specification production mistake`,
        `${actor} revision request delayed order`,
      ]).slice(0, maxQueries);
    }

    if (intentProfile.family === 'FACILITY_RESOURCE_MONITORING') {
      const actor = this.extractActor(description) || 'facility';
      const waterFocused = /\bwater\b/u.test(normalized);
      const resource = waterFocused ? 'water' : 'utility';
      return this.deduplicate([
        `${actor} ${resource} meter leak detection maintenance`,
        `${actor} ${resource} consumption anomaly monitoring`,
        `${actor} fragmented meter readings facility data`,
        `${actor} abnormal ${resource} consumption equipment usage`,
        `${actor} maintenance records ${resource} leak investigation`,
        `${actor} facility activity ${resource} consumption spike`,
        `${actor} inefficient ${resource} use utility cost`,
        `${actor} cooling system ${resource} consumption leak`,
      ]).slice(0, maxQueries);
    }

    if (RequestOnlinePharmacyFraudUtil.isRequest(description)) {
      return this.deduplicate(
        RequestOnlinePharmacyFraudUtil.buildSourceQueries('generic'),
      ).slice(0, maxQueries);
    }

    if (
      intentProfile.family === 'TRANSACTION_ACCOUNT_ABUSE' &&
      /\b(?:smart cities|smart city|cities|city governments?|municipalit(?:y|ies)|municipal governments?|local authorities?|public services?)\b/u.test(normalized) &&
      /\b(?:payments?|transactions?|parking fees?|parking payments?|transit payments?|fare payments?|utility payments?|utility bills?|municipal fees?|public service fees?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'municipal payment fraud detection unauthorized transactions',
        'smart city payments parking transit utility fraud detection',
        'city service payment account compromise unauthorized payment',
        'municipal payment systems fragmented fraud monitoring security alerts',
        'parking transit utility payments false positive fraud alerts',
        'public service payment transaction monitoring account takeover',
        'city payment records security alerts fraud investigation fragmented systems',
        'municipal digital payments suspicious activity account compromise',
      ]).slice(0, maxQueries);
    }

    if (
      intentProfile.family === 'TRANSACTION_ACCOUNT_ABUSE' &&
      /\b(?:financial institutions?|banks?|legal departments?|legal teams?|compliance teams?)\b/u.test(normalized) &&
      /\b(?:contract payments?|approval logs?|contract records?|payment histories?|financial misconduct|unauthorized account changes?|security alerts?|identity information)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'financial institution suspicious contract payment investigation approval logs',
        'bank contract payment fraud unauthorized account changes investigation',
        'legal compliance payment history approval log security alert correlation',
        'financial misconduct investigation contract records payment history identity events',
        'cross system financial investigation approval logs account changes security alerts',
        'contract payment anomaly legal compliance investigation fragmented records',
        'financial institution coordinated fraud payment approval identity event reconstruction',
        'legitimate transaction delayed fraud investigation false positive compliance review',
      ]).slice(0, maxQueries);
    }

    if (intentProfile.family === 'TRANSACTION_ACCOUNT_ABUSE') {
      /*
       * This family is intentionally domain-agnostic. Older code generated a
       * transportation template (passenger/ticket/booking) for every account-
       * abuse request, which contaminated procurement, education, healthcare,
       * marketplace, insurance, and other workflows whenever PREPARING fell
       * back to deterministic planning. Build every query only from identity,
       * workflow, failure, and outcome terms extracted from THIS request.
       */
      const actor = this.extractActor(description) ||
        intentProfile.actorIdentityTerms.slice(0, 2).join(' ') ||
        'request operator';
      const object = intentProfile.objectIdentityTerms.slice(0, 3).join(' ');
      const workflow = intentProfile.workflowIdentityTerms.slice(0, 3).join(' ');
      const failures = intentProfile.failureIdentityTerms.slice(0, 3);
      const outcomes = intentProfile.outcomeIdentityTerms.slice(0, 2);
      const primaryFailure = failures[0] || 'fraud unauthorized access';
      const secondaryFailure = failures[1] || 'suspicious activity';
      const primaryOutcome = outcomes[0] || 'financial loss';

      return this.deduplicate([
        `${actor} ${object} ${primaryFailure}`,
        `${actor} ${workflow} ${primaryFailure}`,
        `${object} ${workflow} ${secondaryFailure}`,
        `${actor} ${primaryFailure} ${primaryOutcome}`,
        `${object} unauthorized account access security alerts`,
        `${workflow} coordinated fraud pattern investigation`,
        `${actor} fragmented records ${primaryFailure}`,
        `${object} identity verification suspicious activity`,
      ].map((query) => query.replace(/\s+/gu, ' ').trim()))
        .filter(Boolean)
        .slice(0, maxQueries);
    }

    if (intentProfile.family === 'FOOD_STORAGE_CONDITION') {
      const actor = this.extractActor(description) || 'commercial kitchen';
      return this.deduplicate([
        `${actor} refrigerator temperature food spoilage`,
        `${actor} freezer performance ingredient risk`,
        `${actor} ingredient expiration food waste tracking`,
        `${actor} cold storage condition inventory loss`,
        `${actor} refrigeration maintenance food spoilage incident`,
        `${actor} storage temperature excursion expired ingredients`,
        `${actor} freezer failure food inventory loss`,
        `${actor} fragmented storage records delayed spoilage detection`,
      ]).slice(0, maxQueries);
    }

    if (intentProfile.family === 'RESTORATION_CONSERVATION') {
      const actor = this.extractActor(description) || 'restoration specialist';
      const subject = intentProfile.restorationSubject || actor;
      const shoeRestoration = /\b(?:shoe|footwear|boot|sneaker|cobbler)\b/iu.test(
        `${subject} ${actor} ${description}`,
      );
      const shoeQueries = shoeRestoration
        ? [
            'cobbler shoe repair customer notes repair history wrong materials',
            'shoe repair shop leather sole stitching restoration records customer preferences',
            'footwear restoration material matching color formula previous repair notes',
            'shoe restoration workshop scattered photos notes customer requests rework',
          ]
        : [];
      const hasHistory = /\b(?:history|previous coatings?|previous treatments?|previous repairs?|records?|documentation|notes?|formulas?|photos?|photographs?|samples?)\b/iu.test(description);
      const hasSurface = /\b(?:surface condition|condition|damaged areas?|damage|color variations?|colour variations?|color matching|colour matching)\b/iu.test(description);
      const hasMaterials = /\b(?:material mixtures?|materials?|coatings?|varnish|finish|resin|pigment)\b/iu.test(description);
      const hasTechnique = /\b(?:application techniques?|treatment techniques?|methods?|process)\b/iu.test(description);
      const hasPreferences = /\b(?:customer|client|owner|preservation preferences?|preferences?)\b/iu.test(description);
      const derived = [
        hasHistory ? `${subject} restoration treatment history documentation records` : '',
        hasHistory && hasSurface ? `${subject} condition history photos notes restoration` : '',
        hasMaterials ? `${subject} restoration coating material formula records` : '',
        hasMaterials && hasSurface ? `${subject} color matching material treatment history` : '',
        hasTechnique ? `${subject} restoration application technique treatment record` : '',
        hasPreferences ? `${subject} restoration preservation preferences treatment history` : '',
        `${subject} restoration documentation history problem`,
        `${subject} conservation treatment records condition history`,
      ];
      return this.deduplicate([
        ...shoeQueries,
        ...derived.filter(Boolean),
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:rental|rentals|hire)\s+(?:shops?|stores?|businesses?|services?|companies?)\b|\b(?:shops?|stores?|businesses?|services?|companies?)\b[^.!?]{0,70}\b(?:rental|rentals|hire)\b/u.test(normalized) &&
      /\b(?:condition|rental periods?|return dates?|expected returns?|accessories|deposits?|maintenance history|availability|booking|bookings|double bookings?|damage|charges?)\b/u.test(normalized)
    ) {
      const actor = this.extractActor(normalized) || 'rental shop';
      return this.deduplicate([
        `${actor} double booking availability conflict`,
        `${actor} missing accessories return condition`,
        `${actor} overlooked damage condition inspection`,
        `${actor} maintenance history servicing before rental`,
        `${actor} deposit incorrect charge rental record`,
        `${actor} expected return date delayed rental`,
        `${actor} rental inventory availability maintenance`,
        `${actor} late return next booking conflict`,
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:public grant programs?|government grant programs?|public funding programs?|grant-making agencies?|grantmaking agencies?|public agencies?)\b/u.test(normalized) &&
      /\b(?:grant applications?|funding applications?|eligibility checks?|funding history|previous funding|project outcomes?|financial records?|duplicate(?:d)? requests?|duplicate funding|unrealistic budgets?|budget reasonableness|underperformance risk|funding allocation|program impact)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'public grant application review duplicate funding requests eligibility checks',
        'government grant allocation unrealistic budgets project underperformance risk',
        'public grant administrators fragmented application financial records review',
        'grant program duplicate awards previous funding history application screening',
        'public funding application scoring inconsistent decisions budget review delays',
        'government grant project outcomes impact measurement funding decisions',
        'grant eligibility financial review duplicated requests public funds allocation',
        'public grant management application review budget anomaly risk assessment',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:typewriter restoration specialists?|typewriter restorers?|typewriter repair specialists?|typewriter repairers?|typewriter restoration workshops?|typewriter repair shops?)\b/u.test(normalized) &&
      /\b(?:mechanical condition|missing keys?|ribbon mechanism|damaged components?|previous repairs?|repair history|cosmetic details?|replacement parts?|spare[- ]part records?|customer restoration preferences?|restoration history|repeated diagnostics?|overlooked defects?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'typewriter restoration repair history missing keys ribbon mechanism parts',
        'typewriter repair workshop machine condition previous repairs documentation',
        'vintage typewriter restoration replacement parts compatibility repair records',
        'typewriter restorer repeated diagnostics missing repair history customer notes',
        'typewriter repair ribbon mechanism damaged components service history',
        'antique typewriter restoration condition report parts inventory customer preferences',
        'typewriter repair shop handwritten notes spare parts delayed restoration',
        'typewriter restoration overlooked defects wrong replacement parts documentation',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:online subscription businesses?|subscription businesses?|subscription companies?|subscription services?|subscription platforms?|saas businesses?|saas companies?)\b/u.test(normalized) &&
      /\b(?:customers? cancel|customer cancellations?|churn|renewal history|renewals?|retention|recurring revenue|subscription payments?|discount usage|pricing plans?|pricing tiers?|product usage|support interactions?|refund activity|financial forecasts?|forecasting)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'subscription business churn renewal retention recurring revenue problem',
        'subscription customer cancellation renewal history product usage signals',
        'saas churn customer support product usage payment behavior',
        'subscription pricing plan profitability discount usage churn',
        'subscription retention offer effectiveness churn risk customer behavior',
        'recurring revenue forecast churn cancellations renewal behavior',
        'subscription business fragmented payments support usage renewal data',
        'subscription plan profitability refunds discounts retention revenue',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:fitness centers?|fitness clubs?|gyms?|health clubs?)\b/u.test(normalized) &&
      /\b(?:membership|members?|registrations?|cancellations?|churn|class attendance|subscription payments?|promotional discounts?|facility usage|customer feedback|revenue|profitability|retention)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'fitness center membership churn revenue decline cancellations retention',
        'gym membership cancellation class attendance revenue profitability',
        'health club member retention facility utilization subscription revenue',
        'fitness center promotional discounts membership profitability churn',
        'gym member churn attendance customer feedback retention',
        'fitness club class profitability attendance membership revenue',
        'gym facility utilization operating cost membership revenue',
        'fitness center revenue forecasting cancellations payments attendance',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:taxidermy|taxidermists?|taxidermy restoration specialists?)\b/u.test(normalized) &&
      /\b(?:restoration|specimens?|condition|damaged areas?|previous repairs?|materials?|color[- ]?matching|colour[- ]?matching|customer preferences?|restoration progress|repair history)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'taxidermy restoration specimen condition previous repairs documentation',
        'taxidermy conservator restoration color cleaning preservation',
        'taxidermy specimen repair treatment material documentation',
        'taxidermy restoration condition report damaged specimen',
        'taxidermy restoration color matching repair records',
        'taxidermy specimen conservation treatment history documentation',
        'taxidermist restoration customer approval repair notes',
        'historic taxidermy restoration cleaning color preservation',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:tourism operators?|tour operators?|city transport services?|public transport services?|municipal transit|city transit)\b/u.test(normalized) &&
      /\b(?:festival|festivals|holiday|holidays|large public events?|visitor demand|passenger volumes?|transport capacity|congestion|overcrowd|waiting times?|vehicle allocation|attraction schedules?|booking activity)\w*\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'festival tourism public transport overcrowding passenger surge capacity',
        'holiday visitor demand city transit congestion waiting times',
        'tourist attraction event public transport capacity overcrowded routes',
        'city transport festival passenger volume vehicle allocation delay',
        'overtourism public transport congestion visitor hotspots capacity',
        'large public event transit demand surge route capacity waiting',
        'tourism visitor flow attraction schedule transport capacity planning',
        'tourism operators city transport sudden demand congestion response',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:umbrella repair|umbrella repair specialist|umbrella repair specialists|umbrella restoration|parasol repair)\b/u.test(normalized) &&
      /\b(?:damaged ribs?|fabric condition|handle problems?|replacement parts?|previous repairs?|customer preferences?|pickup dates?|repair history|repeated repairs?|incorrect replacement parts?)\w*\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'umbrella repair shop wrong replacement part repeated repair',
        'umbrella restoration broken ribs fabric handle repair history',
        'umbrella repair service customer instructions pickup date notes',
        'parasol repair replacement ribs canopy handle customer request',
        'umbrella frame repair previous repairs parts compatibility',
        'umbrella canopy repair customer preference repair ticket',
        'umbrella repair shop handwritten notes receipts delayed pickup',
        'umbrella repair service lost customer request wrong part',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:private hospitals?|hospitals?|hospital systems?|medical centers?)\b/u.test(normalized) &&
      /\b(?:staffing expenses?|medical supply usage|patient volumes?|insurance reimbursements?|treatment costs?|department costs?|budget|profitability|financial inefficien|resource allocation|cost efficiency|cost-efficiency)\w*\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'hospital department cost efficiency staffing supply reimbursement patient volume',
        'hospital service line profitability treatment cost insurance reimbursement',
        'hospital resource utilization cost variance department budget',
        'private hospital medical supply staffing cost financial performance',
        'hospital operating room resource utilization cost efficiency staffing',
        'hospital department resource allocation patient volume reimbursement cost',
        'healthcare service cost drivers budget variance resource utilization',
        'hospital financial efficiency treatment cost supply usage staffing expense',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:shoe restoration|footwear restoration|shoe repair|shoe repairer|shoe repairers|cobbler|cobblers|boot repair|sneaker restoration|shoe refinishing|resoling|re-?soling)\b/u.test(normalized) &&
      /\b(?:leather condition|sole damage|stitching|previous repairs?|repair history|color matching|colour matching|replacement materials?|customer preferences?|customer requests?|restoration history|scattered notes?|photographs?|physical samples?|repeated work|incorrect materials?|delayed restoration)\w*\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'cobbler shoe repair customer notes repair history wrong materials',
        'shoe repair shop leather sole stitching restoration records customer preferences',
        'footwear restoration material matching color formula previous repair notes',
        'shoe restoration workshop scattered photos notes customer requests rework',
        'cobbler repair ticket material choice repeated work delayed pickup',
        'shoe repair previous repairs sole leather stitching condition history',
        'footwear restoration wrong material color mismatch customer approval rework',
        'shoe repair shop restoration history customer preference record keeping',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:shoe dyeing|shoe dye service|shoe restoration|footwear restoration|leather recoloring|leather dyeing|shoe refinishing|sneaker restoration|cobbler dye)\b/u.test(normalized) &&
      /\b(?:requested shade|original color|finish preference|previous treatment|damage note|pickup deadline|mismatched color|repeated work|wrong treatment|color sample|customer message)\w*\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'shoe restoration shop wrong color customer requested shade rework',
        'leather recoloring service customer color sample treatment notes',
        'shoe dye service mismatched color wrong treatment damaged leather',
        'footwear restoration requested shade finish preference customer notes',
        'cobbler dye service color matching previous treatment pickup deadline',
        'sneaker restoration color mismatch customer approval rework',
        'leather dyeing shop customer specification color formula records',
        'shoe refinishing shop lost color notes delayed pickup',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:hospital|hospitals|healthcare|medical center|medical centers)\b/u.test(normalized) &&
      /\b(?:operating rooms?|operating theatres?|operating theaters?|surgical suites?|surgery schedules?|surgical schedules?|surgeries|procedures)\b/u.test(normalized) &&
      /\b(?:staffing|medical staff|surgeons?|nurses?|equipment availability|urgent patients?|emergency cases?|resource allocation|room turnover|reschedul|idle operating rooms?|delayed procedures?|schedule conflicts?)\w*\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'hospital operating room scheduling staff equipment emergency cases',
        'surgery schedule conflict medical staff equipment availability',
        'operating room utilization idle room resource allocation hospital',
        'urgent surgery rescheduling operating room staff availability',
        'operating room turnover delay staffing equipment bottleneck',
        'surgical suite schedule disruption emergency case hospital',
        'hospital operating room resource coordination procedure delay',
        'operating theatre staffing equipment availability schedule change',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:independent tattoo artists?|tattoo artists?|tattoo studios?|tattoo shops?|tattooists?)\b/u.test(normalized) &&
      /\b(?:design references?|reference images?|placement preferences?|size requirements?|dimensions?|color choices?|colour choices?|stencils?|revision requests?|design revisions?|approved design|approved version|final approved|appointment details?|aftercare notes?|client records?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'tattoo artist client design references scattered messages revisions',
        'tattoo artist placement size color revision client approval',
        'tattoo stencil approved design version appointment problem',
        'tattoo consultation client reference photos revision history',
        'tattoo artist final design approval wrong version rework',
        'tattoo client messages sketches appointment aftercare records',
        'tattoo studio design revision approval client record keeping',
        'tattoo artist scheduling confusion unconfirmed design revision',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:tourism businesses?|tour operators?|travel businesses?|travel agencies?|destination operators?|hospitality businesses?)\b/u.test(normalized) &&
      /\b(?:seasonal demand|travel behavior|booking records?|customer spending|promotional campaigns?|discounts?|cancellations?|refund activity|operating expenses?|profitability|revenue forecasts?|pricing decisions?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'tourism business profitability seasonal demand booking revenue margin',
        'tour operator pricing discounts cancellations refunds profit margin',
        'tourism promotion campaign roi customer spending profitability',
        'travel business operating expenses booking revenue service profitability',
        'tourism seasonal demand forecast revenue margin pricing decisions',
        'tour operator cancellation refund impact profit forecasting',
        'tourism service package profitability booking customer spend cost allocation',
        'travel promotion discount effectiveness revenue forecast operating cost',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:fountain pen repair specialists?|pen repair specialists?|fountain pen technicians?|nib technicians?|nibmeisters?)\b/u.test(normalized) &&
      /\b(?:pen(?:’s|'s)? condition|pen condition|nib adjustments?|ink[- ]?flow problems?|replacement parts?|previous repairs?|writing preferences?|service history|restoration requests?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'fountain pen repair service history nib adjustment ink flow',
        'fountain pen technician previous repairs replacement parts records',
        'nib adjustment writing preference customer service history fountain pen',
        'fountain pen ink flow diagnostics repeated repair history',
        'fountain pen restoration request condition photos repair notes',
        'pen repair specialist wrong replacement part forgotten adjustment',
        'fountain pen service record handwritten notes receipts customer messages',
        'fountain pen repeat diagnostics prior repair nib condition tracking',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:urban transportation agencies?|transportation agencies?|transit agencies?|city transport(?:ation)? departments?|municipal transport(?:ation)?|public transport(?:ation)? authorities?|urban mobility agencies?)\b/u.test(normalized) &&
      /\b(?:traffic flow|traffic congestion|public transit demand|transit demand|road incidents?|travel times?|route performance|peak hours?|time periods?|bottlenecks?)\b/u.test(normalized) &&
      /\b(?:vehicle emissions?|fuel consumption|air quality|environmental measurements?|longer journeys?|travel time reliability|transportation improvements?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'urban traffic congestion emissions peak hour travel time',
        'public transit demand road incidents congestion city',
        'traffic bottleneck fuel consumption vehicle emissions city',
        'transport agency integrated traffic transit air quality data',
        'route congestion travel time reliability emissions',
        'urban mobility corridor delay public transit demand emissions',
        'road incident traffic flow fuel consumption transport emissions',
        'transportation improvement priority congestion travel time air quality',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:government agencies?|government departments?|public sector agencies?|public authorities?|regulatory agencies?|licensing authorities?)\b/u.test(normalized) &&
      /\b(?:legal records?|licensing documents?|citizen applications?|regulatory files?|official records?|public records?|permit records?|case files?)\b/u.test(normalized) &&
      /\b(?:unauthorized access|unauthorised access|manipulation|tamper(?:ing|ed)?|access logs?|document histor(?:y|ies)|employee activity|security alerts?|suspicious changes?|who accessed|incident investigation|audit trail)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'government sensitive records unauthorized access audit log investigation',
        'public sector legal record tampering document history security alert',
        'government licensing document unauthorized change access log incident',
        'citizen application record suspicious modification employee activity',
        'regulatory file integrity who accessed changed record investigation',
        'government document version history access anomaly compliance incident',
        'public records compromised credentials suspicious change audit trail',
        'government records security incident access reconstruction legal compliance',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:energy companies?|energy providers?|electric utilities?|power utilities?|utility companies?|power producers?|power plants?|generation companies?)\b/u.test(normalized) &&
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|maintenance costs?|equipment efficiency|asset efficiency|outage records?|production data|energy production|profitability|financial forecasts?|investment decisions?|cost attribution|maintenance priorities)\w*\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'electric utility maintenance cost asset profitability operating expense',
        'power plant equipment efficiency operating cost maintenance spending',
        'utility outage maintenance cost financial performance asset reliability',
        'energy asset cost attribution maintenance fuel production data',
        'power generation fuel cost asset performance profitability',
        'utility operational financial data silos maintenance forecasting',
        'power plant maintenance prioritization cost overruns asset efficiency',
        'energy utility operating expense stable demand profitability assets',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:energy providers?|electric utilities?|power utilities?|utility companies?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid)\b/u.test(normalized) &&
      /\b(?:connected meters?|smart meters?|remote monitoring devices?|automated control systems?|device failures?|unusual consumption|consumption anomalies?|network disruptions?|unauthorized access|malicious interference|telemetry|consumption data integrity|incident response)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'smart meter anomaly cyberattack or device failure',
        'utility smart meter tampering unauthorized access incident',
        'power distribution iot device failure network disruption',
        'smart meter inaccurate readings cybersecurity incident',
        'energy utility distinguish equipment failure from cyber attack',
        'connected meter security anomaly consumption data integrity',
        'utility telemetry device health network health incident correlation',
        'smart grid abnormal consumption malicious interference root cause',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:independent doll restoration specialists?|doll restoration specialists?|doll restorers?|doll restoration studios?|doll restoration workshops?|antique doll restorers?|doll repair specialists?)\b/u.test(normalized) &&
      /\b(?:customer requests?|damage photographs?|damage photos?|fabric selections?|replacement parts?|paint matching|restoration notes?|approved restoration|material samples?|completion dates?|incorrect replacements?|mismatched materials?|repeated work|lost details|delayed customer orders?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'doll restoration customer approved repair scope revision',
        'antique doll restoration damage photos replacement parts records',
        'doll restorer fabric selection paint matching customer approval',
        'doll restoration wrong replacement mismatched material rework',
        'doll restoration scattered notes photos material samples lost details',
        'doll repair specialist final approved restoration version customer changes',
        'antique doll restoration parts paint fabric documentation workflow',
        'doll restoration delayed order revision completion date problem',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:transportation companies?|transport companies?|transport operators?|transportation operators?|fleet operators?|fleet managers?|transit operators?|passenger transport companies?|bus companies?|delivery fleets?|commercial fleets?)\b/u.test(normalized) &&
      /\b(?:operating costs?|fuel expenses?|fuel costs?|maintenance costs?|route performance|route profitability|driver schedules?|ticket revenue|fare revenue|delivery revenue|vehicle utilization|fleet utilization|pricing decisions?|financial forecasts?|profitability|cost variance)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'transport operator rising operating costs stable passenger volume',
        'fleet route profitability fuel maintenance vehicle utilization',
        'transit route performance ticket revenue operating margin',
        'delivery fleet route cost revenue vehicle utilization',
        'transportation driver scheduling fuel expense profitability',
        'fleet maintenance cost route margin financial forecast',
        'transport operator cost variance pricing decision route performance',
        'transportation operating expenses vehicle utilization profitability',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:book cover craftsmen?|book cover makers?|bookbinders?|custom bookbinders?|bookbinding craftsmen?|bookbinding artisans?|binderies?|bindery workshops?|bookbinding workshops?)\b/u.test(normalized) &&
      /\b(?:client artwork|book dimensions?|cover dimensions?|material selections?|embossing details?|color preferences?|revision requests?|approved specifications?|customer approvals?|completion deadlines?|incorrect dimensions?|wasted materials?|repeated work|delayed orders?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'bookbinder client artwork dimensions material selection approval',
        'custom bookbinding revision request final specification rework',
        'book cover craftsman wrong dimensions missed design detail',
        'bindery customer approval embossing color material specification',
        'bookbinder scattered sketches messages final approved cover',
        'custom bookbinding material waste wrong specification revision',
        'book cover commission customer changes completion deadline',
        'bindery approved specification version client artwork dimensions',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:public healthcare agencies?|public health agencies?|health departments?|health authorities?|healthcare agencies?|hospitals?|clinics?)\b/u.test(normalized) &&
      /\b(?:rising demand|service demand|healthcare demand|medical service demand|appointment volumes?|emergency visits?|regional health reports?|community healthcare needs?|community health needs?|hospitals? become overloaded|clinics? become overloaded|capacity pressure|waiting times?|resource availability|resource distribution|staff shortages?|demand forecasting|surge detection)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'public healthcare rising service demand hospital capacity pressure',
        'appointment volume surge clinic staffing resource availability',
        'emergency visit trends hospital overload community demand',
        'regional health demand waiting times resource distribution',
        'health agency community medical service demand forecasting',
        'hospital clinic capacity pressure appointment emergency visit trends',
        'public health demand early warning staff shortage waiting time',
        'community healthcare demand forecast resource allocation hospital capacity',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:miniature model makers?|model makers?|scale model makers?|miniature makers?|custom miniature commissions?)\b/u.test(normalized) &&
      /\b(?:scale requirements?|reference images?|material choices?|paint details?|dimensions?|revision requests?|approved version|customer finally approved|incorrect proportions|missed visual details|repeated work|delayed commissions?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'miniature model commission customer approved version revision',
        'custom miniature scale specification dimensions mistake rework',
        'model maker reference images paint details missed customer commission',
        'miniature commission material choice revision tracking approval',
        'scale model wrong proportions customer specification remake',
        'miniature maker wrong approved version repeated work wasted material',
        'custom model commission revision request completion deadline delay',
        'miniature painting commission reference image approval paint specification',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:online retailers?|online stores?|e-?commerce|ecommerce merchants?|online merchants?|shopify merchants?|digital retailers?)\b/u.test(normalized) &&
      /\b(?:profit margins?|margin change|margin erosion|contribution margin|net profit|gross revenue|profitability|campaign profitability|profitable products?|profitable campaigns?)\b/u.test(normalized) &&
      /\b(?:product discounts?|advertising costs?|ad spend|returns?|refunds?|payment fees?|gateway fees?|shipping expenses?|shipping costs?|fulfillment costs?|customer purchasing behavior|pricing decisions?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'ecommerce profit margin discounts advertising returns shipping fees',
        'online retailer contribution margin sku advertising spend returns',
        'shopify merchant net profit payment fees shipping costs discounts',
        'ecommerce campaign profitability ad spend refunds fulfillment cost',
        'online store strong sales declining margin hidden costs',
        'merchant gross revenue versus net profit product profitability',
        'ecommerce pricing decisions promotion overspending low margin products',
        'retail margin attribution customer cohort campaign product costs',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|online food ordering services?|meal delivery platforms?|restaurant courier platforms?)\b/u.test(normalized) &&
      /\b(?:suspicious orders?|account takeovers?|account takeover|refund abuse|fraudulent refunds?|promotional abuse|promo(?:tional)? fraud|promo code abuse|payment behavior|device information|device signals?|customer complaints?|security alerts?|false positives?|blocked legitimate (?:users?|customers?)|coordinated abuse)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'food delivery platform refund abuse account takeover fraud',
        'restaurant delivery suspicious orders promo abuse false positives',
        'food delivery account blocked legitimate customer fraud review',
        'restaurant delivery device signals payment behavior fraud detection',
        'food delivery customer complaints security alerts coordinated abuse',
        'delivery app promotional abuse refund fraud account security',
        'food ordering fraud detection false positive legitimate customer',
        'restaurant delivery refund history device account investigation',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:online retailers?|online stores?|e-?commerce|customer orders?|orders?|shipments?|shipping|deliver(?:y|ies))\b/u.test(normalized) &&
      /\b(?:fraudulent delivery claims?|false delivery claims?|account misuse|account abuse|account takeover|unauthorized (?:shipping|delivery) (?:information|address) changes?|shipping address changes?|carrier scans?|delivery confirmations?|proof of delivery|refund abuse|lost merchandise|order disputes?|delivery disputes?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'ecommerce fraudulent delivery claim proof of delivery dispute',
        'online retailer unauthorized shipping address change account misuse order',
        'order dispute carrier scan warehouse update delivery confirmation mismatch',
        'refund abuse lost merchandise delivery claim ecommerce investigation',
        'account takeover shipping information changed after order placed',
        'carrier scan proof of delivery customer dispute order fraud',
        'warehouse carrier delivery timeline reconstruct disputed ecommerce order',
        'legitimate customer falsely flagged delivery fraud refund dispute',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:cities|city governments?|municipalities|smart cities|urban areas?|neighborhoods?|neighbourhoods?)\b/u.test(normalized) &&
      /\b(?:noise pollution|environmental noise|urban noise|noise sensors?|sound sensors?|sound levels?|noise levels?|decibels?|acoustic monitoring|soundscape monitoring)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'urban noise pollution sensor monitoring traffic construction complaints',
        'city noise hotspot residential commercial district road traffic',
        'municipal noise complaints sensor readings source attribution',
        'construction traffic noise pollution neighborhood persistent hotspots',
        'urban acoustic monitoring citizen complaints enforcement delay',
        'city sound level data traffic construction schedule correlation',
        'noise pollution mapping residential neighborhoods commercial districts',
        'municipal noise enforcement sensor complaint location data silos',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:cities|city governments?|municipalities|municipal governments?|city councils?|sanitation departments?|waste management departments?|public works departments?)\b/u.test(normalized) &&
      /\b(?:municipal solid waste|solid waste|municipal waste|waste collection|garbage collection|trash collection|refuse collection|sanitation collection|waste bins?|garbage bins?|trash bins?|waste containers?|garbage containers?|refuse containers?|landfill|recycling collection)\b/u.test(normalized) &&
      /\b(?:collection schedules?|pickup schedules?|container capacity|bin capacity|fill levels?|vehicle locations?|collection vehicles?|citizen complaints?|route performance|overflowing containers?|overflowing bins?|missed pickups?|disposal patterns?|population densities?|neighborhood density)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'municipal waste collection fixed schedules overflowing bins neighborhoods',
        'city sanitation pickup frequency container fill level route performance',
        'waste collection vehicle routing citizen complaints operating cost',
        'municipal garbage collection population density disposal pattern scheduling',
        'city waste fleet unnecessary collection trips resource allocation',
        'urban solid waste collection route optimization container overflow',
        'municipal sanitation vehicle location pickup priority neighborhood demand',
        'smart city waste collection schedule route efficiency fill level',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:musical score restoration specialists?|music score restoration specialists?|music manuscript conservators?|musical manuscript conservators?|paper conservators?|manuscript conservators?|document conservators?)\b/u.test(normalized) &&
      /\b(?:damaged manuscripts?|musical scores?|music manuscripts?|missing pages?|handwritten annotations?|marginalia|previous repairs?|paper types?|customer instructions?|client instructions?|approved treatment|treatment records?|restoration progress|conservation treatment|condition records?)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'manuscript conservator condition report treatment documentation previous repairs',
        'paper conservation damaged manuscript missing pages annotations treatment records',
        'music manuscript conservation handwritten annotations restoration history',
        'manuscript restoration paper type condition assessment approved treatment',
        'document conservator scattered treatment notes client instructions progress',
        'historic manuscript conservation lost annotations duplicated restoration work',
        'paper conservator previous repair documentation treatment decision',
        'musical score conservation condition treatment record restoration workflow',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:logistics companies?|logistics providers?|logistics operators?|third[- ]party logistics|3pl providers?|freight companies?|freight operators?|delivery operators?|parcel carriers?|distribution operators?|supply chain operators?)\b/u.test(normalized) &&
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|warehouse costs?|warehousing costs?|failed deliveries?|delivery failures?|vehicle maintenance|maintenance costs?|route performance|route profitability|customer penalties?|delivery penalties?|profit margins?|margin erosion|profitability|route planning|pricing decisions?|financial forecasts?|shipment volumes?|delivery volumes?|cost per shipment|cost per delivery)\b/u.test(normalized) &&
      /\b(?:profit margins?|profitability|margin erosion|operating costs?|operating expenses?|financial forecasts?|pricing decisions?|cost increase|costs increase|become more expensive|reducing profit)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'logistics operating cost fuel warehouse failed delivery profit margin',
        'freight operator route profitability maintenance customer penalties',
        '3pl delivery cost per shipment warehouse expense margin erosion',
        'logistics stable shipment volume rising operating costs profitability',
        'delivery route performance fuel maintenance pricing financial forecast',
        'logistics customer penalties failed deliveries transportation cost drivers',
        'freight route planning vehicle maintenance warehouse cost profit margin',
        'logistics operating expense reconciliation route vehicle profitability',
      ]).slice(0, maxQueries);
    }

    if (
      /\b(?:shipment|shipments|cargo|supply chain|carrier|warehouse|customs)\b/u.test(normalized) &&
      /\b(?:handover|chain of custody|custody transfer|tampered records?|altered tracking|tracking information has been altered|trusted history|fraudulent delivery claims?|shipment provenance|record tampering)\b/u.test(normalized)
    ) {
      return this.deduplicate([
        'shipment handover tampered tracking record chain of custody dispute',
        'cargo custody transfer carrier warehouse customs record discrepancy',
        'supply chain altered shipment tracking history fraudulent delivery claim',
        'shipment handover verification ownership document provenance problem',
        'carrier warehouse customs conflicting shipment records custody timeline',
        'supply chain record tampering shipment incident traceability',
        'shipment chain of custody missing handover event lost goods dispute',
        'cargo tracking audit trail altered location update responsibility dispute',
      ]).slice(0, maxQueries);
    }

    if (
      intentProfile.family === 'CUSTOM_COMMISSION' &&
      /\b(?:custom commissions?|custom orders?|made[- ]to[- ]order|customer approval|approved version|final approved|revision requests?|design revisions?)\b/u.test(normalized) &&
      /\b(?:makers?|artisans?|artists?|workshops?|shops?|studios?|commissions?)\b/u.test(normalized)
    ) {
      const actor = this.extractActor(description) || 'custom maker';
      const aliases = this.buildActorAliases(actor);
      const subject = aliases[1] || aliases[0] || actor;
      const headwearWorkflow =
        /\b(?:hat makers?|milliners?|millinery|custom hats?|bespoke hats?|custom headwear)\b/u.test(
          normalized,
        );
      const queries = headwearWorkflow
        ? [
            'milliner custom hat head measurements brim dimensions fitting revision',
            'millinery bespoke hat material choice sizing customer approval rework',
            'custom hat maker wrong size brim measurement repeated adjustment',
            'bespoke headwear final approved specification material color decoration',
            'custom hat fitting notes revision customer order delayed delivery',
            'milliner customer measurements sketches physical samples wrong version',
            'custom headwear material mismatch brim dimension fitting problem',
            'hat maker final approved design revision wasted supplies delay',
          ]
        : [
            `${subject} customer approved design revision mistake`,
            `${subject} custom commission specification change rework`,
            `${subject} design reference color size personalization approval`,
            `${subject} wrong final approved version repeated work`,
            `${subject} revision request missed customer instruction`,
            `${subject} custom order material waste revision delay`,
            `${subject} spelling personalization proof approval error`,
            `${subject} sketches photos customer messages final design approval`,
          ];
      return this.deduplicate(queries).slice(0, maxQueries);
    }

    return [];
  }

  static extractActor(value: string): string {
    const normalized = this.cleanText(value);
    const explicit = normalized.match(
      /^(.{3,100}?)\s+(?:often|frequently|regularly|commonly|sometimes)\s+(?:struggle|struggles|have difficulty|has difficulty|find it difficult|finds it difficult)\b/iu,
    )?.[1];

    if (explicit) {
      return this.compactActor(explicit);
    }

    const firstClause = normalized.split(/[.!?;,]/u)[0] ?? '';
    const beforeVerb = firstClause.match(
      /^(.{3,100}?)\s+(?:(?:increasingly|often|frequently|regularly|commonly)\s+)?(?:struggle|struggles|need|needs|manage|manages|track|tracks|coordinate|coordinates|record|records|review|reviews|depend|depends|rely|relies|operate|operates|use|uses)\b/iu,
    )?.[1];

    return beforeVerb ? this.compactActor(beforeVerb) : '';
  }


  static extractWorkflowTerms(value: string): string[] {
    return this.extractWorkflowPhrases(value);
  }

  static extractPainTerms(value: string): string[] {
    return this.extractFailurePhrases(value);
  }

  static buildActorAliases(value: string): string[] {
    const actor = this.extractActor(value) || this.cleanText(value).split(/[.!?;,]/u)[0] || '';
    const normalized = this.cleanText(actor)
      .replace(/^\b(?:many|some|most|small|independent|local)\b\s*/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!normalized) return [];

    const aliases = [normalized];
    const withoutOrgSuffix = normalized
      .replace(/\b(?:companies?|businesses?|providers?|operators?|teams?)\b$/iu, '')
      .replace(/\b(?:workshops?|shops?|studios?)\b$/iu, '')
      .replace(/\b(?:systems?)\b$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (withoutOrgSuffix) aliases.push(withoutOrgSuffix);

    const singularized = withoutOrgSuffix
      .replace(/\bmakers\b/giu, 'maker')
      .replace(/\btechnicians\b/giu, 'technician')
      .replace(/\btrainers\b/giu, 'trainer')
      .replace(/\bmanagers\b/giu, 'manager')
      .replace(/\bcompanies\b/giu, 'company')
      .trim();
    if (singularized) aliases.push(singularized);

    const tradeVariants: string[] = [];
    if (/\brefinishing\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        withoutOrgSuffix.replace(/\brefinishing\b/giu, 'refinisher'),
        withoutOrgSuffix.replace(/\brefinishing\b/giu, 'restoration'),
      );
    }
    if (/\bperfume\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(withoutOrgSuffix.replace(/\bperfume\b/giu, 'fragrance'));
    }
    if (/\bwig\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(withoutOrgSuffix.replace(/\bwig\b/giu, 'hairpiece'));
    }
    if (/\btattoo\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        'tattoo artist',
        'tattooist',
        'tattoo studio',
      );
    }
    if (/\bhospitals?\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        'hospital',
        'operating room coordinator',
        'surgical scheduling team',
      );
    }
    if (/\bhat\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        'milliner',
        'millinery',
        'custom hat maker',
        'bespoke headwear maker',
      );
    }
    if (/\bdelivery\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(withoutOrgSuffix.replace(/\bdelivery\b/giu, 'courier'));
    }
    if (/\b(?:shoe|footwear|cobbler|sneaker)\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        'cobbler',
        'shoe repairer',
        'shoe repair shop',
        'footwear repair specialist',
        'shoe restoration specialist',
      );
    }
    if (/\balteration(?:s)?\b/iu.test(withoutOrgSuffix)) {
      const bridal = /\bbridal\b/iu.test(withoutOrgSuffix);
      tradeVariants.push(
        bridal ? 'bridal alteration specialist' : 'alteration specialist',
        bridal ? 'bridal seamstress' : 'seamstress',
        bridal ? 'bridal dressmaker' : 'dressmaker',
        bridal ? 'bridal tailor' : 'tailor',
        bridal ? 'wedding dress alterations' : 'clothing alterations',
      );
    }
    if (/\bphotograph(?:y)? restoration\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        'photograph restoration specialist',
        'photo restoration specialist',
        'photograph restorer',
        'photo restorer',
      );
    }
    if (/\b(?:frame restoration|picture frame restoration|frame restoration specialist)\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        'frame restorer',
        'picture frame restorer',
        'antique frame restorer',
        'gilded frame restorer',
        'picture frame restoration',
      );
    }
    if (/\b(?:musical score restoration|music score restoration|music manuscript|manuscript restoration)\b/iu.test(withoutOrgSuffix)) {
      tradeVariants.push(
        'manuscript conservator',
        'paper conservator',
        'document conservator',
        'music manuscript conservator',
        'manuscript conservation',
      );
    }

    return this.unique([...aliases, ...tradeVariants])
      .map((item) => item.split(/\s+/u).slice(0, 6).join(' '))
      .filter((item) => item.split(/\s+/u).length >= 1)
      .slice(0, 5);
  }

  private static extractFallbackSubject(description: string): string {
    const firstClause = description.split(/[.!?;,]/u)[0] ?? description;
    const tokens = firstClause
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => !this.stopWords.has(token.toLocaleLowerCase()));
    return tokens.slice(0, 5).join(' ');
  }

  private static extractWorkflowPhrases(description: string): string[] {
    const sentences = description
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/(?<=[.!?])\s+/u)
      .map((value) => value.replace(/[.!?]+$/u, '').trim())
      .filter(Boolean)
      .slice(0, 3);
    const outputs: string[] = [];

    for (const sentence of sentences) {
      const normalized = sentence.toLocaleLowerCase();
      const actionList = normalized.match(
        /\b(?:struggle|struggles|need|needs|have|has)\s+(?:to\s+)?(?:organize|organise|track|coordinate|identify|manage|monitor|record|review|maintain|handle|follow|understand)\s+(.+)$/iu,
      )?.[1];
      if (actionList) {
        outputs.push(...this.splitWorkflowList(actionList));
      }

      const passiveList = normalized.match(
        /^(.{5,260}?)\s+(?:are|is)\s+(?:often|usually|frequently|commonly|typically\s+)?(?:analy[sz]ed|reviewed|recorded|tracked|managed|stored|shared|handled|maintained)\b/iu,
      )?.[1];
      if (passiveList && !/^information\b/iu.test(passiveList)) {
        outputs.push(...this.splitWorkflowList(passiveList));
      }
    }

    if (outputs.length < 3) {
      const clauses = description
        .toLocaleLowerCase()
        .split(/[.!?;,]|\band\b|\bor\b/gu)
        .map((value) => value.trim())
        .filter((value) => value.length >= 6);
      for (const clause of clauses) {
        if (
          /^(?:often|frequently|usually)?\s*(?:struggle|struggles|making it difficult|difficult to|this can lead|can lead|lead to|leads to)\b/iu.test(
            clause,
          )
        ) {
          continue;
        }
        const compact = this.compactWorkflowPhrase(clause);
        if (compact) outputs.push(compact);
      }
    }

    return this.unique(outputs).slice(0, 10);
  }

  private static splitWorkflowList(value: string): string[] {
    const bounded = value
      .replace(
        /\b(?:before|after|while|when|because|since|making|which|so that|in order to|information\s+(?:is|are)|this\s+(?:can|may|makes?|leads?|results?))\b[\s\S]*$/iu,
        ' ',
      )
      .replace(/\s+/gu, ' ')
      .trim();

    return bounded
      .split(/,|\band\b|\bor\b/gu)
      .map((part) => this.compactWorkflowPhrase(part))
      .filter(Boolean);
  }

  private static compactWorkflowPhrase(value: string): string {
    const compact = this.compactPhrase(
      value
        .replace(
          /^(?:information|details?|records?|activity|data)\s+(?:about|for|on)\s+/iu,
          '',
        )
        .replace(
          /\b(?:while|when|because|making|which|so that|in order to)\b[\s\S]*$/iu,
          ' ',
        )
        .replace(
          /\b(?:are|is|was|were|usually|frequently|often|commonly|typically|separately|different|specialists?|technicians?|customers?)\b/giu,
          ' ',
        ),
      5,
    );
    if (!compact) return '';

    const normalized = compact.toLocaleLowerCase();
    if (
      /^(?:independent|specialists?|restorers?|businesses?|companies?)\b/iu.test(
        normalized,
      ) ||
      /\b(?:often struggle|struggle problem|document problem|for each problem)\b/iu.test(
        normalized,
      )
    ) {
      return '';
    }
    const workflowMarkers = /\b(?:account|activity|assessment|appointment|assignment|availability|billing|booking|bottle|client|concentration|condition|contractor|customer|deadline|delivery|design|equipment|expiration|feeding|filter|formula|fragrance|fraud|freezer|furniture|wood|stain|finish|restoration|damage|approval|health|history|ingredient|instruction|inventory|listing|load|maintenance|material|measurement|mobility|note|observation|pain|performance|preference|project|purchas|record|refrigerat|replacement|report|review|revision|sample|schedule|seller|selection|service|servicing|signal|scent|specification|status|storage|task|temperature|transaction|training|treatment|trust|usage|version|visit|water|waste|quality)\w*\b/iu;
    return workflowMarkers.test(normalized) ? compact : '';
  }

  private static extractFailurePhrases(description: string): string[] {
    const lower = description.toLocaleLowerCase();
    const outputs: string[] = [];

    const painPatterns = [
      /\bprogress(?:ing)? too (?:quickly|fast)\b/gu,
      /\brecover(?:ing)? (?:more )?slowly(?: than expected)?\b/gu,
      /\bearly signs? of (?:another )?injury\b/gu,
      /\bmissed [\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2}\b/gu,
      /\bforgotten [\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2}\b/gu,
      /\brepeated [\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2}\b/gu,
      /\b(?:equipment|service|system|process|workflow|maintenance) failures?\b/gu,
      /\b(?:scheduling|booking|record|data|service) conflicts?\b/gu,
      /\b(?:unhealthy|unsafe|incorrect|inconsistent|delayed|slow|slower|unexpected|fragmented|separate|lost|missing) [\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2}\b/gu,
      /\b(?:fraud|fraudulent|fake|suspicious|misleading|restricted|restriction|false positive|reinjury|re-injury|spoilage|waste|delay|error|failure|risk|conflict|outage|breakdown|loss|losses|damage|damaged)\w*\b/gu,
    ];

    for (const pattern of painPatterns) {
      for (const match of lower.matchAll(pattern)) {
        const compact = this.compactPhrase(match[0], 6);
        if (compact) outputs.push(compact);
      }
    }

    const consequenceMatches = lower.matchAll(
      /\b(?:lead to|leads to|result in|results in|causes?|causing|can cause|can lead to|making it difficult to|difficult to)\s+([^.!?]{5,220})/gu,
    );
    for (const match of consequenceMatches) {
      const consequence = match[1] ?? '';
      for (const part of consequence.split(/,|\band\b|\bor\b/gu)) {
        const compact = this.compactPhrase(part, 6);
        if (compact && this.isUsefulFailurePhrase(compact)) outputs.push(compact);
      }
    }

    return this.unique(outputs)
      .sort((left, right) => right.split(/\s+/u).length - left.split(/\s+/u).length)
      .slice(0, 8);
  }

  private static isUsefulFailurePhrase(value: string): boolean {
    const normalized = value.toLocaleLowerCase();
    return /\b(?:fraud|fake|suspicious|misleading|restrict|false positive|miss|forgot|repeat|failure|fail|error|risk|conflict|delay|slow|unsafe|unhealthy|incorrect|inconsistent|lost|missing|waste|spoil|breakdown|overload|reinjury|re-injury|warning|problem|issue|difficult|unable|cannot|can't|poor|fragmented|separate|loss|damage)\w*\b/iu.test(
      normalized,
    );
  }

  private static compactActor(value: string): string {
    return this.cleanText(value)
      .replace(/^(?:many|some|most|small)\s+/iu, (match) =>
        /small/i.test(match) ? 'small ' : '',
      )
      .split(/\s+/u)
      .slice(0, 7)
      .join(' ');
  }

  private static compactPhrase(value: string, maxWords: number): string {
    return this.cleanText(value)
      .replace(/^(?:reports?|discussions?|complaints?|examples?)\s+(?:of|about|regarding)?\s*/iu, '')
      .replace(/\b(?:often|usually|frequently|commonly|typically|really|very)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .filter((token) => !this.stopWords.has(token.toLocaleLowerCase()))
      .slice(0, maxWords)
      .join(' ');
  }

  private static compose(...parts: string[]): string {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const part of parts) {
      for (const token of this.cleanText(part).split(/\s+/u)) {
        if (!token) continue;
        const normalized = token.toLocaleLowerCase();
        const identity = this.queryTokenIdentity(normalized);
        if (seen.has(identity)) continue;
        seen.add(identity);
        output.push(token);
      }
    }
    return this.sanitizeGeneratedQuery(output.join(' ')).slice(0, 140);
  }

  private static deduplicate(values: readonly string[]): string[] {
    const output: string[] = [];
    const signatures: Array<Set<string>> = [];
    for (const raw of values) {
      const value = this.sanitizeGeneratedQuery(this.cleanText(raw));
      if (!value) continue;
      const tokens = new Set(this.semanticTokens(value));
      const duplicate = signatures.some((existing) => {
        const shared = [...tokens].filter((token) => existing.has(token)).length;
        return shared / Math.max(1, Math.min(tokens.size, existing.size)) >= 0.82;
      });
      if (duplicate) continue;
      output.push(value);
      signatures.push(tokens);
    }
    return output;
  }

  private static sanitizeGeneratedQuery(value: string): string {
    const tokens = this.cleanText(value)
      .replace(
        /^(?:can\s+)?(?:lead|leads|leading)(?:\s+to)?\s+|^(?:can cause|cause|causes|causing|result in|results in|making it difficult to|difficult to)\s+/iu,
        '',
      )
      .replace(
        /\s+(?:and|or|but|while|with|without|to|for|of|from|by|because)$/iu,
        '',
      )
      .split(/\s+/u)
      .filter(Boolean);

    const output: string[] = [];
    let previousIdentity = '';
    for (const token of tokens) {
      const identity = this.queryTokenIdentity(token.toLocaleLowerCase());
      if (identity && identity === previousIdentity) continue;
      output.push(token);
      previousIdentity = identity;
    }

    return output
      .join(' ')
      .replace(/\b(?:often struggle|struggles? problem)\b/giu, ' ')
      .replace(/\b(?:document|documenting)\s+problem\b/giu, 'documentation')
      .replace(/\b(?:an accurate )?history for each problem\b/giu, 'history')
      .replace(/\s+(?:problem|problems)$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static queryTokenIdentity(token: string): string {
    const normalized = token
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (normalized.length <= 4) return normalized;

    if (/ies$/u.test(normalized) && normalized.length > 5) {
      return `${normalized.slice(0, -3)}y`;
    }
    if (/(?:sses|shes|ches|xes|zes)$/u.test(normalized) && normalized.length > 6) {
      return normalized.slice(0, -2);
    }
    if (/s$/u.test(normalized) && !/ss$/u.test(normalized) && normalized.length > 5) {
      return normalized.slice(0, -1);
    }
    return normalized;
  }

  private static semanticTokens(value: string): string[] {
    return this.cleanText(value)
      .toLocaleLowerCase()
      .split(/\s+/u)
      .filter((token) => token.length >= 3)
      .filter((token) => !this.stopWords.has(token));
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of values) {
      const value = this.cleanText(raw);
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }

  private static cleanText(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/([\p{L}\p{N}])(?:['’]s)\b/giu, '$1')
      .replace(/(?:^|\s)['’]s\b/giu, ' ')
      .replace(/[^\p{L}\p{N}\s&/'’:-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static readonly stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'from', 'with', 'without',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'more', 'than', 'expected',
    'in', 'on', 'at', 'by', 'through', 'between', 'into', 'across', 'each', 'every',
    'this', 'that', 'these', 'those', 'which', 'what', 'when', 'where', 'who', 'how',
    'can', 'could', 'may', 'might', 'would', 'should', 'often', 'usually', 'frequently',
    'commonly', 'typically', 'different', 'separate', 'separately', 'difficult', 'difficulty',
    'makes', 'making', 'make', 'understand', 'identify', 'recognize', 'decide', 'recorded',
    'reviewed', 'shared', 'information', 'data', 'it', 'its', 'before', 'after', 'affected',
    'struggle', 'struggles', 'organize', 'organise', 'track', 'manage', 'keep', 'performed',
    'previous', 'during', 'physical', 'businesses',
  ]);
}
