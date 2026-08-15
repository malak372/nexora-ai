/**
 * Utility responsible for building complaint-focused search queries.
 *
 * The builder deliberately avoids broad domain-only searches such as
 * "smart city" because those mostly return marketing, tutorials, news, and
 * generic discussion. It combines a concrete workflow noun with a direct
 * failure/request expression so collectors search for real user problems.
 *
 * @author Malak
 */
export class CollectorQueryBuilderUtil {
  private static readonly DEFAULT_PROBLEM_WORDS = [
    'not working',
    'cannot',
    "can't",
    'unable',
    'missing',
    'inaccurate',
    'slow',
    'failed',
    'error',
    'bug',
    'difficult',
    'confusing',
    'need',
    'feature request',
  ] as const;

  private static readonly DOMAIN_PROBLEM_FAMILIES: Readonly<
    Record<string, readonly string[]>
  > = {
    'smart cities': [
      'smart parking availability',
      'parking gate access',
      'traffic signal timing',
      'municipal service request',
      'street lighting outage',
      'waste collection schedule',
      'public transport arrival',
      'citizen issue reporting',
      'city service accessibility',
      'urban mobility route',
    ],
    transportation: [
      'public transport delay',
      'route planning',
      'vehicle profile',
      'trip tracking',
      'fare payment',
      'arrival prediction',
      'accessibility routing',
      'parking availability',
    ],
    logistics: [
      'delivery tracking',
      'route assignment',
      'proof of delivery',
      'inventory handoff',
      'fleet dispatch',
      'warehouse picking',
      'shipment status',
      'driver workflow',
    ],
    'artificial intelligence': [
      'model accuracy',
      'computer vision segmentation',
      'AI output correction',
      'model evaluation',
      'prompt reliability',
      'AI integration',
    ],
    agriculture: [
      'irrigation scheduling',
      'crop monitoring',
      'farm inventory',
      'harvest planning',
      'soil monitoring',
      'farmer marketplace',
    ],
    'e commerce': [
      'checkout payment',
      'shopping cart',
      'order tracking',
      'seller marketplace',
      'product listing',
      'refund workflow',
    ],
    ecommerce: [
      'checkout payment',
      'shopping cart',
      'order tracking',
      'seller marketplace',
      'product listing',
      'refund workflow',
    ],
    'e-commerce': [
      'checkout payment',
      'shopping cart',
      'order tracking',
      'seller marketplace',
      'product listing',
      'refund workflow',
    ],
    energy: [
      'energy consumption',
      'solar monitoring',
      'electricity usage',
      'power outage reporting',
      'battery monitoring',
      'meter reading',
    ],
    education: [
      'student homework',
      'assignment submission',
      'teacher feedback',
      'coursework tracking',
      'grading workflow',
      'classroom learning',
    ],
    finance: [
      'invoice approval',
      'expense tracking',
      'budget workflow',
      'payroll processing',
      'reconciliation',
      'cash flow tracking',
    ],
    healthcare: [
      'patient appointment',
      'clinical workflow',
      'medical record access',
      'medication tracking',
      'patient communication',
      'care coordination',
    ],
    'sports & fitness': [
      'exercise calorie adjustment',
      'nutrition tracking',
      'workout synchronization',
      'macro targets',
      'activity import',
      'training plan',
    ],
  };

  static buildProblemQueries(
    domainKeywords: string[],
    problemWords: string[] = [],
  ): string[] {
    const selectedProblemWords = problemWords.length
      ? problemWords
      : [...this.DEFAULT_PROBLEM_WORDS];

    return this.unique(
      domainKeywords.flatMap((keyword) =>
        selectedProblemWords.map((problemWord) => `${keyword} ${problemWord}`),
      ),
    );
  }

  /**
   * Builds a small set of high-intent searches for the selected domain.
   *
   * The result is bounded so FAST_GENERATION remains fast. Generic keyword
   * expansions such as "platform", "dashboard", and "analytics" are ignored
   * because they produce publisher copy instead of community pain.
   */
  static buildDomainPainQueries(input: {
    readonly domainName?: string | null;
    readonly domainKeywords?: readonly string[];
    readonly userKeywords?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const requestedMax = Math.max(1, input.maxQueries ?? 4);
    const userTerms = this.cleanTerms(input.userKeywords ?? []).filter(
      (term) => !this.isGenericProductExpansion(term),
    );
    const domainTerms = this.cleanTerms(input.domainKeywords ?? []).filter(
      (term) => !this.isGenericProductExpansion(term),
    );
    const knownFamilies =
      this.DOMAIN_PROBLEM_FAMILIES[domainName] ??
      this.findClosestKnownFamilies(domainName);

    const naturalTemplates =
      domainName.includes('smart cit')
        ? [
            'parking status is wrong',
            'bus arrival data not updating',
            'street light outage not showing',
            'cannot submit municipal complaint',
            'public service request stuck',
            'traffic data is inaccurate',
          ]
        : domainName.includes('transport')
          ? [
              'bus arrival time is wrong',
              'route planner gives wrong route',
              'trip tracking not updating',
              'fare payment failed',
              'public transport app not working',
            ]
          : domainName.includes('logistic')
            ? [
                'delivery status not updating',
                'driver cannot complete delivery',
                'route assignment is wrong',
                'proof of delivery missing',
                'shipment tracking inaccurate',
              ]
            : [];

    const workflowTerms = this.unique([
      ...userTerms,
      ...knownFamilies,
      ...domainTerms,
    ]).slice(0, 4);

    /*
     * Round-robin the first query wave across workflow/domain terms. Earlier
     * flatMap()+slice() generated every variant for the first term before the
     * second selected domain was ever queried.
     */
    const fallbackQueries = this.unique([
      ...workflowTerms.map((workflow) => `${workflow} not working`),
      ...workflowTerms.map((workflow) => `${workflow} data is wrong`),
      ...workflowTerms.map((workflow) => `cannot use ${workflow}`),
    ]);

    return this.unique([...naturalTemplates, ...fallbackQueries]).slice(
      0,
      requestedMax,
    );
  }


  /**
   * Stack Overflow needs implementation-language queries rather than
   * end-user complaint sentences. These phrases target APIs, sensors, feeds,
   * stale data, synchronization, and submission failures.
   */
  static buildStackOverflowTechnicalQueries(input: {
    readonly domainName?: string | null;
    readonly userKeywords?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);
    const balancedTerms = this.cleanTerms(input.userKeywords ?? [])
      .filter((term) => !this.isGenericProductExpansion(term))
      .map((term) => this.expandKnownDomainAnchor(term))
      .filter((term) => !/(?:user complaint problem|not working difficult confusing|review missing feature)$/iu.test(term))
      .filter((term) => !/^(?:coherent cross-domain workflow|cross-domain workflow)/iu.test(term))
      .slice(0, maxQueries);

    if (balancedTerms.length > 1) {
      return this.unique(
        balancedTerms.map((term, index) =>
          index % 3 === 0
            ? `${term} api workflow fails`
            : index % 3 === 1
              ? `${term} integration error`
              : `${term} data submission not working`,
        ),
      ).slice(0, maxQueries);
    }

    const queries =
      domainName.includes('smart cit')
        ? [
            'parking availability api stale data',
            'gtfs realtime feed not updating',
            'street light sensor status incorrect',
            'municipal service api submission fails',
            'traffic data api returns wrong value',
            'smart parking occupancy synchronization error',
          ]
        : domainName.includes('transport')
          ? [
              'gtfs realtime feed not updating',
              'bus arrival prediction inaccurate api',
              'route planning api wrong route',
              'trip tracking websocket not updating',
              'fare payment api failed transaction',
            ]
          : domainName.includes('logistic')
            ? [
                'shipment tracking status not updating',
                'delivery route assignment incorrect',
                'proof of delivery upload fails',
                'warehouse inventory synchronization error',
                'driver app location not updating',
              ]
            : [
                `${domainName} api not updating`,
                `${domainName} data incorrect`,
                `${domainName} integration fails`,
              ];

    return this.unique(queries).slice(0, maxQueries);
  }

  /**
   * GitHub search performs better with unquoted keyword groups. Each query
   * combines one workflow object with one or two failure words while allowing
   * GitHub to match natural wording variations.
   */
  static buildGitHubFlexibleQueries(input: {
    readonly domainName?: string | null;
    readonly userKeywords?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);
    const balancedTerms = this.cleanTerms(input.userKeywords ?? [])
      .filter((term) => !this.isGenericProductExpansion(term))
      .map((term) => this.expandKnownDomainAnchor(term))
      .filter((term) => !/(?:user complaint problem|not working difficult confusing|review missing feature)$/iu.test(term))
      .filter((term) => !/^(?:coherent cross-domain workflow|cross-domain workflow)/iu.test(term))
      .slice(0, maxQueries);

    if (balancedTerms.length > 1) {
      return this.unique(
        balancedTerms.map((term, index) =>
          index % 3 === 0
            ? `${term} bug failure`
            : index % 3 === 1
              ? `${term} not working issue`
              : `${term} incorrect missing`,
        ),
      ).slice(0, maxQueries);
    }

    const queries =
      domainName.includes('smart cit')
        ? [
            'parking availability stale incorrect',
            'gtfs realtime arrival update',
            'street light outage status',
            'municipal service request submit',
            'traffic sensor data wrong',
          ]
        : domainName.includes('transport')
          ? [
              'bus arrival realtime stale',
              'route planner incorrect route',
              'trip tracking not updating',
              'fare payment failed',
              'vehicle location stale',
            ]
          : domainName.includes('logistic')
            ? [
                'shipment status stale update',
                'delivery route assignment wrong',
                'proof delivery upload fail',
                'inventory sync incorrect',
                'driver tracking not updating',
              ]
            : [
                `${domainName} stale data`,
                `${domainName} incorrect result`,
                `${domainName} request failed`,
              ];

    return this.unique(queries).slice(0, maxQueries);
  }

  /**
   * YouTube queries always retain a domain anchor and a review/problem intent.
   * This prevents broad words such as arrival, delivery, or app from returning
   * unrelated entertainment and news videos.
   */
  static buildYouTubeAnchoredQueries(input: {
    readonly domainName?: string | null;
    readonly userKeywords?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);
    const balancedDomainTerms = this.cleanTerms(input.userKeywords ?? [])
      .filter((term) => !/^(?:coherent cross-domain workflow|cross-domain workflow)/iu.test(term))
      .filter((term) => !this.isGenericProductExpansion(term))
      .map((term) => this.expandKnownDomainAnchor(term))
      .filter((term) => !/(?:user complaint problem|not working difficult confusing|review missing feature)$/iu.test(term))
      .slice(0, maxQueries);

    if (balancedDomainTerms.length > 1) {
      return this.unique(
        balancedDomainTerms.map((term, index) =>
          index % 3 === 0
            ? `${term} app problems review`
            : index % 3 === 1
              ? `${term} user complaint`
              : `${term} software issue review`,
        ),
      ).slice(0, maxQueries);
    }

    const queries =
      domainName.includes('smart cit')
        ? [
            'smart city parking app problems review',
            'public transport arrival app complaint',
            'municipal service app user review',
            'street lighting app issue',
            'smart city citizen app not working',
          ]
        : domainName.includes('transport')
          ? [
              'public transport app problems review',
              'bus arrival app complaint',
              'route planner app not working',
              'fare payment app issue',
            ]
          : domainName.includes('logistic')
            ? [
              'delivery tracking app problems review',
              'driver app complaint logistics',
              'shipment tracking app not working',
              'warehouse app user issue',
            ]
          : [
              `${domainName} app problems review`,
              `${domainName} user complaint`,
              `${domainName} software issue`,
            ];

    return this.unique(queries).slice(0, maxQueries);
  }

  /**
   * Returns compact GitHub-ready clauses that target bug reports and feature
   * requests instead of repositories that merely mention the domain.
   */
  static buildGitHubProblemClauses(input: {
    readonly domainName?: string | null;
    readonly domainKeywords?: readonly string[];
    readonly userKeywords?: readonly string[];
    readonly maxClauses?: number;
  }): string[] {
    const queries = this.buildDomainPainQueries({
      ...input,
      maxQueries: input.maxClauses ?? 3,
    });

    return queries;
  }

  private static findClosestKnownFamilies(
    domainName: string,
  ): readonly string[] {
    for (const [key, values] of Object.entries(
      this.DOMAIN_PROBLEM_FAMILIES,
    )) {
      if (domainName.includes(key) || key.includes(domainName)) {
        return values;
      }
    }

    return [];
  }

  /**
   * Converts a bare selected-domain label into one concrete search anchor.
   * This is the zero-keyword safety net for newly added or incompletely seeded
   * domains and guarantees useful first-run expansion without another DB read.
   */
  private static expandKnownDomainAnchor(value: string): string {
    const normalized = this.normalize(value);
    const anchors: Readonly<Record<string, string>> = {
      agriculture: 'farming irrigation crop',
      'e commerce': 'checkout marketplace order',
      'e-commerce': 'checkout marketplace order',
      ecommerce: 'checkout marketplace order',
      energy: 'energy monitoring electricity',
      education: 'student homework assignment',
      finance: 'invoice expense reconciliation',
      healthcare: 'patient clinical workflow',
      transportation: 'public transport route',
      logistics: 'shipment delivery tracking',
      'artificial intelligence': 'AI model reliability',
      'business operations': 'administrative approval workflow',
    };

    return anchors[normalized] ?? value;
  }

  private static cleanTerms(values: readonly string[]): string[] {
    return this.unique(
      values
        .map((value) => this.normalize(value))
        .filter((value) => value.length >= 3)
        .filter((value) => value.split(/\s+/u).length <= 5),
    );
  }

  private static isGenericProductExpansion(value: string): boolean {
    return /\b(?:platform|system|application|software|dashboard|analytics|monitoring|automation|management|optimization|prediction|recommendation|integration|smart)\b/iu.test(
      value,
    );
  }

  private static normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static unique(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
  }
}