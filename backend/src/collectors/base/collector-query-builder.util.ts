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

    const fallbackQueries = workflowTerms.flatMap((workflow) => [
      `${workflow} not working`,
      `${workflow} data is wrong`,
      `cannot use ${workflow}`,
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
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);

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
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);

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
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);

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