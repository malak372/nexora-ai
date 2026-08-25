import { RequestDynamicQueryUtil } from './request-dynamic-query.util';

export type OperationalCostAttributionProfile = {
  readonly actor: string;
  readonly identityTerms: readonly string[];
  readonly costDrivers: readonly string[];
  readonly performanceTerms: readonly string[];
  readonly financialTerms: readonly string[];
  readonly publicService: boolean;
};

/**
 * Request-description-first compiler for operational cost attribution problems.
 *
 * This is intentionally workflow-based rather than domain-name based. The same
 * structure occurs in transit authorities, hospitals, universities, utilities,
 * airports, municipal services, distributors, manufacturers, and other future
 * verticals: several operating-cost streams are reviewed separately, so teams
 * cannot attribute financial pressure to a route/service/facility/product.
 */
export class RequestOperationalCostAttributionUtil {
  private static readonly COST_DRIVER_PATTERNS: readonly [RegExp, string][] = [
    [/\bfuel (?:expense|expenses|cost|costs|spend|spending)\b/iu, 'fuel cost'],
    [/\bvehicle maintenance\b|\bmaintenance (?:expense|expenses|cost|costs|spend|spending)\b/iu, 'maintenance cost'],
    [/\bstaffing (?:expense|expenses|cost|costs)\b|\blabou?r costs?\b|\bpayroll\b/iu, 'staffing cost'],
    [/\bprocurement (?:cost|costs|spend|spending|expense|expenses)\b|\bpurchasing costs?\b/iu, 'procurement cost'],
    [/\bcontractor (?:payment|payments|cost|costs|spend|spending)\b/iu, 'contractor payments'],
    [/\bsupplier (?:invoice|invoices|fee|fees|cost|costs|prices?|payments?)\b|\bvendor (?:invoice|invoices|fee|fees|cost|costs|payments?)\b|\bpartner invoices?\b/iu, 'supplier cost'],
    [/\btransportation costs?\b|\btransport costs?\b|\bfreight costs?\b|\bdelivery costs?\b|\bshipping costs?\b/iu, 'transportation cost'],
    [/\bwarehouse costs?\b|\bstorage costs?\b|\binventory holding costs?\b|\bcarrying costs?\b/iu, 'storage cost'],
    [/\bcancellations?\b|\brefund activity\b|\brefund costs?\b/iu, 'cancellation refund'],
    [/\bemergency (?:purchase|purchases|order|orders)\b/iu, 'emergency purchase'],
    [/\bexpired (?:inventory|stock|supplies?)\b|\binventory expiration\b|\bspoilage\b/iu, 'inventory loss'],
    [/\bsubsidy (?:payment|payments|cost|costs|spending)\b|\bsubsidies\b/iu, 'subsidy'],
    [/\bticket revenue\b|\bfare revenue\b|\bsales revenue\b|\bservice revenue\b/iu, 'revenue'],
    [/\bservice usage\b|\butilization\b|\butilisation\b|\broute utilization\b|\broute utilisation\b/iu, 'service utilization'],
    [/\bdepartmental spending\b|\bprogram expenditures?\b|\boperating expenses?\b|\boperating costs?\b/iu, 'operating cost'],
    [/\benergy costs?\b|\belectricity costs?\b|\butility costs?\b/iu, 'energy cost'],
    [/\braw material costs?\b|\bmaterial costs?\b|\binput costs?\b/iu, 'material cost'],
  ];

  private static readonly PERFORMANCE_PATTERNS: readonly [RegExp, string][] = [
    [/\bpassengers?\b|\bridership\b|\briders?\b/iu, 'passenger volume'],
    [/\bcitizens?\b|\bresidents?\b|\bbeneficiaries\b/iu, 'citizen volume'],
    [/\bpatients?\b|\bvisits?\b|\bencounters?\b/iu, 'patient volume'],
    [/\bbookings?\b|\breservations?\b|\btour packages?\b/iu, 'booking'],
    [/\bseasonal demand\b|\bcustomer demand\b/iu, 'seasonal demand'],
    [/\borders?\b|\bshipments?\b|\bdeliveries\b/iu, 'service volume'],
    [/\bcrops?\b|\bproducts?\b|\bunits?\b/iu, 'product volume'],
    [/\broutes?\b|\bservice lines?\b|\bservices?\b/iu, 'service or route'],
    [/\bfacilit(?:y|ies)\b|\bhospitals?\b|\bclinics?\b|\bdepartments?\b/iu, 'facility'],
  ];

  static resolve(requestDescription?: string | null): OperationalCostAttributionProfile | null {
    const request = this.normalize(requestDescription ?? '');
    if (!request) return null;

    const actor = this.normalize(RequestDynamicQueryUtil.extractActor(request));
    if (!actor) return null;

    const costDrivers = this.collectMatches(request, this.COST_DRIVER_PATTERNS);
    const performanceTerms = this.collectMatches(request, this.PERFORMANCE_PATTERNS);
    const financialTerms = this.unique([
      // Prefer the request's decision metric over downstream consequences.
      /\bprofitability\b|\bprofit margins?\b|\bmargin erosion\b|\bprofit forecasts?\b/iu.test(request) ? 'profitability' : '',
      /\bbudget(?:s|ing)?\b|\bbudget overruns?\b|\bbudget variance\b/iu.test(request) ? 'budget' : '',
      /\bsubsid(?:y|ies)\b/iu.test(request) ? 'subsidy' : '',
      /\bpublic funding\b|\bfunding\b/iu.test(request) ? 'funding' : '',
      /\bfinancial pressure\b|\bcost pressure\b/iu.test(request) ? 'financial pressure' : '',
      /\boperating costs?\b|\boperating expenses?\b/iu.test(request) ? 'operating cost' : '',
      /\boverspend(?:ing)?\b|\bunnecessary (?:costs?|spending)\b/iu.test(request) ? 'overspending' : '',
    ].filter(Boolean));

    const attributionFriction =
      /\b(?:analy[sz](?:e|ed|ing)?|review(?:ed|ing)?|managed) separately\b|\bseparate (?:systems?|records?|datasets?|departments?)\b|\bsiloed\b|\bfragmented\b|\bdifficult to (?:identify|determine|understand|attribute)\b|\bhard to (?:identify|determine|understand|attribute)\b|\bcannot (?:identify|determine|understand|attribute)\b|\bcan'?t (?:identify|determine|understand|attribute)\b|\bwhy (?:some|certain)\b|\bcost attribution\b|\bcost drivers?\b|\bfinancial pressure\b/iu.test(request);

    // A real attribution request needs multiple financial/operational axes; a
    // generic mention of "cost" is not enough.
    if (costDrivers.length < 2 || financialTerms.length < 1 || !attributionFriction) {
      return null;
    }

    const identityTerms = this.resolveIdentityTerms(request, actor);
    if (identityTerms.length === 0 && performanceTerms.length === 0) return null;

    const publicService =
      /\b(?:government|public sector|public agency|municipal|municipality|city |authority|authorities|public transport|public transportation|transit agency|hospital network|public hospital|public university|public utility)\b/iu.test(request);

    return {
      actor,
      identityTerms,
      costDrivers: costDrivers.slice(0, 5),
      performanceTerms: performanceTerms.slice(0, 3),
      financialTerms: financialTerms.slice(0, 3),
      publicService,
    };
  }

  static buildFirstPassQueries(
    requestDescription: string,
    sourceKey: string,
  ): string[] {
    const profile = this.resolve(requestDescription);
    if (!profile) return [];

    const actor = this.compactActorForSearch(profile.actor);
    // Identity must come from the requester actor/service itself. Never infer
    // a new actor merely because a cost driver contains a domain word such as
    // "transportation costs". This prevents tour operators, manufacturers,
    // hospitals, etc. from being rewritten into public-transit queries.
    const identity = profile.identityTerms[0] ?? actor;
    const driver1 = profile.costDrivers[0] ?? 'operating cost';
    const driver2 = profile.costDrivers[1] ?? 'staffing cost';
    const driver3 = profile.costDrivers[2] ?? 'service cost';
    const performance = profile.performanceTerms[0] ?? 'service utilization';
    const financial = profile.financialTerms[0] ?? 'budget';

    const professional = sourceKey === 'crossref' || sourceKey === 'news' || sourceKey === 'gdelt';
    const community = sourceKey === 'reddit' || sourceKey === 'forum';

    // Keep professional queries deliberately short (<= ~8 meaningful tokens).
    // Crossref, GDELT and news search all degrade when long natural-language
    // consequences are appended, so every phrase carries identity + cost axis
    // + financial/attribution intent without planner prose.
    const analysisIntent = financial === 'profitability'
      ? 'margin analysis'
      : financial === 'budget'
        ? 'cost attribution'
        : `${financial} analysis`;
    const queries = professional
      ? [
          `${actor} ${driver1} ${driver2} ${financial}`,
          `${identity} ${performance} ${driver3} ${financial}`,
          `${identity} ${performance} ${driver1} ${analysisIntent}`,
          `${actor} ${driver1} cost drivers ${financial}`,
          `${identity} ${driver1} ${driver2} ${financial} variance`,
        ]
      : community
        ? [
            `${actor} ${driver1} ${driver2} ${financial} problem`,
            `${identity} ${performance} ${financial} problem`,
            `${identity} ${driver1} ${driver2} ${analysisIntent} problem`,
            `${actor} cost drivers analyzed separately ${financial}`,
          ]
        : [
            `${actor} ${driver1} ${driver2} ${financial}`,
            `${identity} ${performance} ${financial} cost drivers`,
          ];

    return this.unique(queries.map((query) => this.cleanQuery(query))).filter(Boolean).slice(0, 5);
  }

  static strengthenQuery(requestDescription: string, rawQuery: string): string {
    const profile = this.resolve(requestDescription);
    const query = this.cleanQuery(rawQuery);
    if (!profile || !query) return query;

    const normalized = this.normalize(query);
    const hasIdentity = profile.identityTerms.some((term) => this.containsPhrase(normalized, term)) ||
      this.actorCoreTokens(profile.actor).some((token) => this.containsPhrase(normalized, token));
    const hasCostDriver = profile.costDrivers.some((term) => this.containsPhrase(normalized, term)) ||
      /\b(?:cost|expense|spend|budget|subsid|maintenance|fuel|staffing|procurement|contractor|revenue|utilization)\w*\b/iu.test(normalized);
    const hasAttribution = /\b(?:cost attribution|cost drivers?|budget|financial pressure|operating cost|subsid|profit|margin|variance)\w*\b/iu.test(normalized);

    return this.cleanQuery([
      hasIdentity ? '' : this.compactActorForSearch(profile.actor),
      query,
      hasCostDriver ? '' : profile.costDrivers.slice(0, 2).join(' '),
      hasAttribution ? '' : 'operating cost attribution',
    ].filter(Boolean).join(' '));
  }

  static isQueryCompatible(requestDescription: string, query: string): boolean {
    const profile = this.resolve(requestDescription);
    const value = this.normalize(query);
    if (!profile || !value) return false;
    if (this.hasHardCollision(value)) return false;

    const identity = this.hasIdentity(profile, value);
    const cost = this.hasCostAxis(profile, value);
    const financial = /\b(?:operating cost|operating expense|budget|subsid|profit|margin|cost attribution|cost driver|financial pressure|variance|overspend)\w*\b/iu.test(value);

    /*
     * Do not let consequence fragments become network queries. AI planners can
     * legitimately mention phrases such as "analyzed separately", "poor
     * planning" or "inefficient subsidies" while explaining the problem,
     * but those phrases are weak retrieval keys on their own. At least one
     * concrete operating-cost driver (fuel, maintenance, staffing,
     * procurement, contractor, inventory, energy, etc.) or a measured service
     * denominator must survive whenever the query is consequence-heavy.
     */
    const consequenceFragment =
      /\b(?:separate(?:ly)?|fragment(?:ed|ation)?|poor|inaccurate|inefficient|delayed|difficult|struggl\w*|understand|unnecessary)\b/iu.test(value);
    const concreteDriver = profile.costDrivers
      .filter((term) => !/\b(?:subsid|revenue|funding|budget)\w*\b/iu.test(term))
      .some((term) => this.containsPhrase(value, term));
    const measuredServiceAxis =
      profile.performanceTerms.some((term) => this.containsPhrase(value, term)) ||
      /\b(?:route|service|program|facility|department|zone|terminal|passenger|ridership|student|customer|patient|shipment|product)\w*\b/iu.test(value);

    return (
      identity &&
      cost &&
      financial &&
      (!consequenceFragment || concreteDriver || measuredServiceAxis)
    );
  }

  static isPlausibleRetrievalCandidate(
    requestDescription: string,
    evidenceText: string,
  ): boolean {
    const profile = this.resolve(requestDescription);
    const evidence = this.normalize(evidenceText);
    if (!profile || !evidence || this.hasHardCollision(evidence)) return false;
    return this.hasIdentity(profile, evidence) && this.hasCostAxis(profile, evidence) && this.hasFinancialPressure(evidence);
  }

  static isSupportingEvidence(
    requestDescription: string,
    evidenceText: string,
  ): boolean {
    const profile = this.resolve(requestDescription);
    const evidence = this.normalize(evidenceText);
    if (!profile || !evidence || this.hasHardCollision(evidence)) return false;

    const identity = this.hasIdentity(profile, evidence);
    const costAxis = this.hasCostAxis(profile, evidence);
    const pressure = this.hasFinancialPressure(evidence);
    const operationalUnit = profile.performanceTerms.length === 0 ||
      profile.performanceTerms.some((term) => this.containsPhrase(evidence, term)) ||
      /\b(?:route|service|facility|department|program|product|fleet|passenger|ridership|utilization|usage|tour package|package|booking|reservation|seasonal demand)\w*\b/iu.test(evidence);

    return identity && costAxis && pressure && operationalUnit;
  }

  static isDirectEvidence(
    requestDescription: string,
    evidenceText: string,
  ): boolean {
    if (!this.isSupportingEvidence(requestDescription, evidenceText)) return false;
    const profile = this.resolve(requestDescription);
    const evidence = this.normalize(evidenceText);
    if (!profile) return false;

    const matchedDrivers = this.countMatchedCostDrivers(profile, evidence);
    const attribution = /\b(?:analy[sz](?:e|ed|ing)? separately|separate systems?|siloed|fragmented|cost attribution|cost drivers?|difficult to (?:identify|determine|understand)|hard to (?:identify|determine|understand)|cannot (?:identify|determine|understand)|why (?:some|certain)|financial pressure)\b/iu.test(evidence);
    return matchedDrivers >= 2 && attribution;
  }


  private static countMatchedCostDrivers(
    profile: OperationalCostAttributionProfile,
    evidence: string,
  ): number {
    return profile.costDrivers.filter((term) => {
      if (this.containsPhrase(evidence, term)) return true;
      switch (term) {
        case 'supplier cost':
          return /\b(?:supplier|vendor|partner)\s+(?:fees?|costs?|invoices?|payments?)\b/iu.test(evidence);
        case 'transportation cost':
          return /\b(?:transportation|transport|freight|delivery|shipping)\s+(?:fees?|costs?|expenses?)\b/iu.test(evidence);
        case 'cancellation refund':
          return /\b(?:cancellations?|refunds?|refund activity|cancellation fees?)\b/iu.test(evidence);
        case 'staffing cost':
          return /\b(?:staffing|labor|labour|payroll)\s*(?:costs?|expenses?)?\b/iu.test(evidence);
        case 'maintenance cost':
          return /\bmaintenance\s+(?:costs?|expenses?|spend(?:ing)?)\b/iu.test(evidence);
        case 'fuel cost':
          return /\bfuel\s+(?:costs?|expenses?|spend(?:ing)?)\b/iu.test(evidence);
        case 'operating cost':
          return /\boperating\s+(?:costs?|expenses?)\b/iu.test(evidence);
        default:
          return false;
      }
    }).length;
  }

  private static resolveIdentityTerms(request: string, actor: string): string[] {
    const terms: string[] = [];
    const families: readonly [RegExp, readonly string[]][] = [
      // Travel/tourism is a distinct operator identity. A mention of
      // "transportation costs" is only a cost driver and must not turn this
      // into public-transit evidence.
      [/\b(?:travel compan(?:y|ies)|travel agenc(?:y|ies)|tour operators?|tour compan(?:y|ies)|tour packages?|tourism operators?|travel businesses?)\b/iu, ['travel company', 'travel companies', 'travel agency', 'travel agencies', 'tour operator', 'tour operators', 'tour package', 'tour packages', 'tourism']],
      // Transit identity requires an actual transit/mobility actor or service,
      // not the generic word "transportation" in an expense phrase.
      [/\b(?:transport authorities?|transportation authorities?|transit authorities?|transit agencies?|transit operators?|mobility services?|bus services?|bus routes?|public transport|public transportation|public transit|metro services?|rail transit|ridership)\b/iu, ['public transit', 'transit agency', 'transit operator', 'mobility service', 'bus service', 'passenger', 'ridership']],
      [/\b(?:healthcare|hospital|clinic|medical|patient)\b/iu, ['healthcare', 'hospital', 'clinic', 'medical', 'patient']],
      [/\b(?:agricultur|crop|produce|harvest|farm)\w*\b/iu, ['agriculture', 'agricultural', 'crop', 'produce', 'harvest']],
      [/\b(?:government|public program|public sector|departmental budget|citizen)\b/iu, ['government', 'public program', 'public sector', 'department', 'citizen']],
      [/\b(?:universit|higher education|campus|student)\w*\b/iu, ['university', 'higher education', 'campus', 'student']],
      [/\b(?:airport|aviation|airline|terminal)\b/iu, ['airport', 'aviation', 'terminal']],
      [/\b(?:utility|electricity|water service|energy provider|power grid)\b/iu, ['utility', 'electricity', 'water service', 'energy', 'power']],
      [/\b(?:waste collection|sanitation|garbage|refuse|municipal waste)\b/iu, ['waste collection', 'sanitation', 'garbage', 'municipal waste']],
      [/\b(?:manufactur|factory|production line|plant operations)\w*\b/iu, ['manufacturing', 'factory', 'production', 'plant']],
      [/\b(?:logistics|freight|warehouse|distribution|delivery operator)\b/iu, ['logistics', 'freight', 'warehouse', 'distribution', 'delivery']],
    ];
    for (const [pattern, values] of families) {
      if (pattern.test(request)) terms.push(...values);
    }

    // Family identities are safer than loose actor tokens (e.g. "travel"
    // on its own also appears in passenger-travel-time papers). Only fall back
    // to actor tokens when no explicit requester identity family was found.
    if (terms.length === 0) {
      terms.push(...this.actorCoreTokens(actor));
    }
    return this.unique(terms.map((term) => this.normalize(term)).filter((term) => term.length >= 4)).slice(0, 12);
  }

  private static hasIdentity(profile: OperationalCostAttributionProfile, evidence: string): boolean {
    return profile.identityTerms.some((term) => this.containsPhrase(evidence, term));
  }

  private static hasCostAxis(profile: OperationalCostAttributionProfile, evidence: string): boolean {
    return profile.costDrivers.some((term) => this.containsPhrase(evidence, term)) ||
      /\b(?:fuel costs?|maintenance costs?|staffing costs?|payroll|procurement costs?|contractor payments?|transportation costs?|supplier fees?|vendor fees?|partner invoices?|cancellations?|refund activity|storage costs?|warehouse costs?|subsidies|ticket revenue|fare revenue|operating costs?|operating expenses?|service costs?|cost per passenger|cost per rider)\b/iu.test(evidence);
  }

  private static hasFinancialPressure(evidence: string): boolean {
    return /\b(?:budget|budget overrun|overspend|operating cost|operating expense|subsidy|subsidies|financial pressure|cost pressure|cost variance|cost driver|profitability|profit margin|margin erosion|unnecessary costs?|funding|public funding|deficit|losses?)\w*\b/iu.test(evidence);
  }

  private static hasHardCollision(value: string): boolean {
    return /\b(?:personal finance|credit card debt|credit utilization|mortgage|house down payment|boyfriend|girlfriend|retirement account|stock market|investment portfolio|crypto portfolio|video game|gaming guide|tattoo aftercare|beauty tutorial)\b/iu.test(value);
  }

  private static actorCoreTokens(actor: string): string[] {
    const broad = new Set([
      'city', 'public', 'private', 'independent', 'local', 'regional', 'national',
      'authority', 'authorities', 'agency', 'agencies', 'company', 'companies',
      'network', 'networks', 'department', 'departments', 'operator', 'operators',
      'team', 'teams', 'service', 'services', 'system', 'systems',
    ]);
    return actor
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4 && !broad.has(token));
  }

  private static compactActorForSearch(actor: string): string {
    return actor
      .replace(/\b(?:often|frequently|regularly|commonly)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 5)
      .join(' ');
  }

  private static collectMatches(
    value: string,
    patterns: readonly [RegExp, string][],
  ): string[] {
    return this.unique(patterns.filter(([pattern]) => pattern.test(value)).map(([, label]) => label));
  }

  private static containsPhrase(value: string, phrase: string): boolean {
    const normalized = this.normalize(phrase);
    if (!normalized) return false;
    if (normalized.includes(' ')) return value.includes(normalized);
    return new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\w*\\b`, 'u').test(value);
  }

  private static cleanQuery(value: string): string {
    return this.normalize(value)
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 14)
      .join(' ');
  }

  private static unique(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
