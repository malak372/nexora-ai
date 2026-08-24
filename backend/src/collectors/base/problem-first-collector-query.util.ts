import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';
import { RequestDynamicQueryUtil } from '../../ideas/generation/utils/request-dynamic-query.util';
import { RequestWorkflowIntentProfileUtil } from '../../ideas/generation/utils/request-workflow-intent-profile.util';
import { RequestQueryProvenanceUtil } from '../../ideas/generation/utils/request-query-provenance.util';

export class ProblemFirstCollectorQueryUtil {
  static build(input: {
    readonly sourceKey: string;
    readonly domainName?: string | null;
    readonly requestDescription?: string | null;
    readonly plannedQueries?: readonly string[];
    readonly keywords?: readonly string[];
  }): string[] {
    const sourceKey = this.normalize(input.sourceKey);
    const description = this.normalize(input.requestDescription ?? '');
    const domainName = this.normalize(input.domainName ?? '');
    const planned = this.unique(
      (input.plannedQueries ?? [])
        .map((value) => this.cleanQuery(value))
        .filter(Boolean),
    );
    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: input.requestDescription,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries,
    });
    const hasAiOwnedPlannedQueries = Boolean(description) && planned.length >= 6;
    const safePlanned = planned.filter((query) => {
      if (!RequestQueryProvenanceUtil.isQueryGrounded({
        requestDescription: description,
        query,
      })) {
        return false;
      }
      if (hasAiOwnedPlannedQueries) {
        return true;
      }
      return (
        RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(description, query) &&
        this.isPlannedQueryCompatibleWithConstraint(query, constraint)
      );
    });
    const sourceVerticalQueries = this.buildVerticalSourceQueries(
      constraint,
      sourceKey,
      description,
    );
    const specialized = this.buildSpecializedQueries(description, domainName);
    const dynamicRequestQueries = RequestDynamicQueryUtil.build({
      requestDescription: input.requestDescription,
      maxQueries: 6,
    }).filter((query) =>
      RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(description, query) &&
      RequestQueryProvenanceUtil.isQueryGrounded({ requestDescription: description, query }) &&
      (!constraint.strict ||
        this.isPlannedQueryCompatibleWithConstraint(query, constraint)),
    );
    const evidenceFacetQueries = RequestDynamicQueryUtil.buildEvidenceFacetQueries({
      requestDescription: input.requestDescription,
      maxQueries: 8,
    }).filter((query) =>
      RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(description, query) &&
      RequestQueryProvenanceUtil.isQueryGrounded({ requestDescription: description, query }) &&
      (!constraint.strict ||
        this.isPlannedQueryCompatibleWithConstraint(query, constraint)),
    );
    const isDomainsOnlyMultiDomainDiscovery =
      !description &&
      safePlanned.some((query) =>
        /(?:coherent cross-domain|cross-domain workflow|workflow combining|selected domains|validation scope)/iu.test(
          query,
        ),
      );
    const rankedPlanned = safePlanned
      .map((query) => ({
        query,
        score:
          this.scoreProblemQuery(query) +
          this.scoreVerticalQuery(query, constraint.requiredAnchors),
      }))
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.query);
    const sourceAwarePlanned = this.rankPlannedQueriesForSource(
      rankedPlanned,
      sourceKey,
      description,
    );

    /*
     * For text-bearing requests a sufficiently complete AI retrieval plan is
     * authoritative. Do not inject vertical/template query families after the
     * model has already classified the request and generated its evidence
     * searches. The generic provenance gate remains the final drift guard.
     */
    if (hasAiOwnedPlannedQueries && sourceAwarePlanned.length >= 4) {
      const maxQueries = this.resolveMaxQueries(sourceKey, false);
      return this.unique(
        sourceAwarePlanned
          .map((query) => this.shapeForSource(query, sourceKey))
          .filter(Boolean)
          .filter((query) =>
            RequestQueryProvenanceUtil.isQueryGrounded({
              requestDescription: description,
              query,
            }),
          ),
      ).slice(0, maxQueries);
    }

    if (sourceKey === 'app-store' || sourceKey === 'google-play') {
      const marketplaceRequestQueries = description
        ? [
            ...(constraint.kind === 'TRANSACTION_ACCOUNT_ABUSE'
              ? sourceVerticalQueries.filter((query) =>
                  this.queryAvoidsForeignWorkflowDrift(query, description),
                )
              : []),
            ...evidenceFacetQueries,
            ...sourceAwarePlanned,
            ...dynamicRequestQueries,
            ...(constraint.kind === 'TRANSACTION_ACCOUNT_ABUSE'
              ? []
              : sourceVerticalQueries.filter((query) =>
                  this.queryAvoidsForeignWorkflowDrift(query, description),
                )),
            ...specialized.filter((query) =>
              this.queryAvoidsForeignWorkflowDrift(query, description),
            ),
          ]
        : [
            ...rankedPlanned,
            ...sourceVerticalQueries,
            ...dynamicRequestQueries,
            ...specialized,
          ];

      const marketplaceQueries = this.buildMarketplaceQueries(
        domainName,
        input.keywords ?? [],
        isDomainsOnlyMultiDomainDiscovery ? [] : marketplaceRequestQueries,
      );
      return description
        ? marketplaceQueries.filter((query) =>
            RequestQueryProvenanceUtil.isQueryGrounded({
              requestDescription: description,
              query,
            }),
          )
        : marketplaceQueries;
    }

    const domainDiscovery = this.buildDomainDiscoveryQueries(
      domainName,
      input.keywords ?? [],
    );
    const requestAdjacentDiscovery = description
      ? this.buildRequestAdjacentDomainDiscoveryQueries(
          description,
          domainName,
          input.keywords ?? [],
        )
      : [];
    const requestCompatibleSourceVerticalQueries = description
      ? sourceVerticalQueries.filter((query) =>
          this.queryAvoidsForeignWorkflowDrift(query, description),
        )
      : sourceVerticalQueries;
    const requestCompatibleSpecializedQueries = description
      ? specialized.filter((query) =>
          this.queryAvoidsForeignWorkflowDrift(query, description),
        )
      : specialized;
    const candidates = this.unique(
      isDomainsOnlyMultiDomainDiscovery
        ? [
            ...domainDiscovery,
            ...sourceVerticalQueries,
            ...rankedPlanned,
            ...specialized,
          ]
        : Boolean(description)
          ? constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' ||
            constraint.kind === 'RENTAL_INVENTORY_OPERATIONS' ||
            constraint.kind === 'RESTORATION_CONSERVATION' ||
            constraint.kind === 'FOOD_STORAGE_CONDITION'
            ? [
                /*
                 * Niche physical-service searches have sparse exact matches.
                 * Put actor/workflow/pain facets first so the first two or
                 * three network requests are natural trade queries rather than
                 * long planner prose. The AI plan remains in the same bounded
                 * candidate set immediately afterwards.
                 */
                ...(constraint.kind === 'RESTORATION_CONSERVATION' ||
                constraint.kind === 'FOOD_STORAGE_CONDITION'
                  ? [
                      ...requestCompatibleSourceVerticalQueries.slice(0, 3),
                      ...evidenceFacetQueries.slice(0, 2),
                    ]
                  : evidenceFacetQueries.slice(0, 4)),
                ...this.interleaveQueryGroups([
                  dynamicRequestQueries,
                  sourceAwarePlanned,
                  requestAdjacentDiscovery,
                  requestCompatibleSourceVerticalQueries,
                  requestCompatibleSpecializedQueries,
                ]),
              ]
            : [
              /*
               * The AI planner owns the first retrieval slots. Several
               * collectors execute only the first two or three queries, so
               * deterministic facet expansion must never push the AI plan out
               * of that window.
               */
              ...sourceAwarePlanned.slice(0, 4),
              ...this.interleaveQueryGroups([
                evidenceFacetQueries,
                sourceAwarePlanned.slice(4),
                dynamicRequestQueries,
                requestAdjacentDiscovery,
                requestCompatibleSourceVerticalQueries,
                requestCompatibleSpecializedQueries,
              ]),
            ]
          : [
              ...rankedPlanned,
              ...sourceVerticalQueries,
              ...dynamicRequestQueries,
              ...specialized,
              ...domainDiscovery,
            ],
    );
    const maxQueries = this.resolveMaxQueries(
      sourceKey,
      constraint.strict && Boolean(description),
    );

    return this.unique(
      candidates
        .map((query) => this.shapeForSource(query, sourceKey))
        .filter(Boolean)
        .filter((query) =>
          RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(description, query) &&
          RequestQueryProvenanceUtil.isQueryGrounded({ requestDescription: description, query }) &&
          (!constraint.strict ||
            this.isPlannedQueryCompatibleWithConstraint(query, constraint)),
        ),
    ).slice(0, maxQueries);
  }

  private static isPlannedQueryCompatibleWithConstraint(
    query: string,
    constraint: ReturnType<typeof RequestVerticalConstraintUtil.resolve>,
  ): boolean {
    if (!constraint.strict) return true;
    const normalized = this.normalize(query);

    if (
      constraint.excludedAnchors.some((anchor) =>
        normalized.includes(this.normalize(anchor)),
      )
    ) {
      return false;
    }

    if (constraint.kind === 'TRANSACTION_ACCOUNT_ABUSE') {
      if (/\b(?:smart agriculture|smart farm|crop|irrigation|insurance claim|insurance reimbursement|manufacturing|factory|hotel booking|accommodation|shipment chain of custody)\b/u.test(normalized)) {
        return false;
      }
      const actor = /\b(?:transportation|transport|transit|mobility|ticketing|ticket|fare|passenger|rail|train|bus|metro)\b/u.test(normalized);
      const concreteMechanism = /\b(?:payment|transaction|refund|chargeback|account|login|booking|reservation|device|security alert|false positive|restriction|investigation)\w*\b/u.test(normalized);
      const abuseSignal = /\b(?:fraud|fraudulent|scam|abuse|suspicious|unauthorized|compromis|takeover|anomal)\w*\b/u.test(normalized);
      return actor && concreteMechanism && abuseSignal;
    }

    if (constraint.kind === 'RESTAURANT_DELIVERY_FRAUD') {
      if (
        /\b(?:carrier scan|proof of delivery|shipping address|warehouse handoff|warehouse update|parcel tracking|shipment chain of custody|chain of custody|lost merchandise|freight|cargo)\b/u.test(normalized)
      ) {
        return false;
      }
      const actor = /\b(?:restaurant delivery|food delivery|online food ordering|meal delivery|delivery app|restaurant courier)\b/u.test(normalized);
      const fraudAxis = /\b(?:fraud|suspicious order|account takeover|refund abuse|fraudulent refund|promo(?:tional)? abuse|promo(?:tional)? fraud|payment behavior|device signal|device information|customer complaint|security alert|false positive|blocked legitimate|coordinated abuse)\w*\b/u.test(normalized);
      return actor && fraudAxis;
    }

    if (constraint.kind === 'FOOD_STORAGE_CONDITION') {
      if (/\b(?:household|home fridge|young adults?|warehouse fire|landfill|energy stocks?|profitability|revenue forecast)\b/u.test(normalized)) {
        return false;
      }
      const commercialStorageIdentity =
        /\b(?:restaurant|restaurant kitchen|commercial kitchen|foodservice|food service|refrigerat\w*|freezer\w*|cold storage|ingredient|food storage)\b/u.test(normalized);
      const storageWorkflow =
        /\b(?:temperature|freezer performance|refrigerator performance|expiration|expiry|storage condition|maintenance|spoil\w*|food waste|ingredient waste|inventory loss|equipment failure|temperature excursion|monitor\w*|track\w*)\b/u.test(normalized);
      return commercialStorageIdentity && storageWorkflow;
    }

    if (constraint.kind === 'RESTORATION_CONSERVATION') {
      if (/\b(?:custom commission|custom order|new design|wrong dimensions?|approved design revision|personalization|production mistake)\b/u.test(normalized)) {
        return false;
      }
      const requestIdentity = constraint.requiredAnchors.some((anchor) =>
        normalized.includes(this.normalize(anchor)),
      );
      const restorationWorkflow =
        /\b(?:restoration|conservation|condition|damage|cracked|missing|original design|original color|original colour|previous repair|repair history|restoration history|treatment history|replacement material|material match|color match|colour match|physical sample|documentation|records?|rework|waste|delay)\w*\b/u.test(normalized);
      return requestIdentity && restorationWorkflow;
    }

    if (constraint.kind === 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY') {
      if (/\b(?:faculty workload|teaching workload|course staffing|course assignment|teaching assistant workload|department staffing|staffing shortage)\b/u.test(normalized)) {
        return false;
      }
      return /\b(?:login|authentication|account|permission|device|security|compromis|suspicious|unauthorized|integrity|exam)\w*\b/u.test(normalized);
    }

    if (constraint.kind === 'RENTAL_INVENTORY_OPERATIONS') {
      if (
        /\b(?:custom orders?|commissions?|production mistakes?|material waste|customer specifications?|manufacturing|vacation rental|holiday rental|apartment rental|rental property|movie rental|ski rental)\b/u.test(normalized)
      ) {
        return false;
      }
      const requestIdentity = constraint.requiredAnchors.some((anchor) =>
        normalized.includes(this.normalize(anchor)),
      );
      const rentalWorkflow =
        /\b(?:rental periods?|availability|available|return dates?|expected returns?|late returns?|overdue|accessories|deposits?|charges?|condition|damage|maintenance history|service history|servicing|inspection|booking|bookings|reservation|reservations|double booking|double bookings)\w*\b/u.test(normalized);
      return requestIdentity && rentalWorkflow;
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'decorative fountain restoration service history operations'
    ) {
      return /\b(?:fountain|water feature)\b/u.test(normalized) &&
        /\b(?:pump|water[- ]?flow|circulation|stone|metal|corrosion|replacement|finish|repair|restoration|maintenance|customer request|history|diagnostic)\w*\b/u.test(normalized);
    }

    if (
      constraint.kind === 'PUBLIC_SECTOR' &&
      constraint.label === 'public grant evaluation and funding allocation'
    ) {
      if (
        /\b(?:grant writing tips?|how to write a grant|scholarship application|research proposal advice)\b/u.test(normalized)
      ) {
        return false;
      }
      return /\b(?:grant|funding|award)\w*\b/u.test(normalized) &&
        /\b(?:application|eligibility|budget|duplicate|funding history|previous funding|project outcome|underperformance|allocation|impact|review|scoring|decision)\w*\b/u.test(normalized);
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'typewriter restoration condition parts and repair history operations'
    ) {
      if (
        /\b(?:questioned document|document examination|forensic document|typeface identification|document reinserted)\b/u.test(normalized)
      ) {
        return false;
      }
      return /\btypewriter\b/u.test(normalized) &&
        /\b(?:repair|restoration|mechanical|ribbon|keys?|parts?|component|condition|service history|repair history|diagnostic|workshop|restorer)\w*\b/u.test(normalized);
    }

    if (constraint.kind === 'AGRICULTURE_EXPORT_PROFITABILITY') {
      if (
        /\b(?:drone harvesting|agricultural drones?|precision agriculture|crop disease detection|irrigation controller|soil sensor|smart farming)\b/u.test(normalized) &&
        !/\b(?:export|shipment|cold chain|storage|spoilage|logistics|profit|margin|market price|warehouse)\b/u.test(normalized)
      ) {
        return false;
      }
      const context =
        /\b(?:agricultural export|produce export|fresh produce|produce shipment|cold chain|perishable produce|postharvest|post-harvest)\b/u.test(normalized);
      const axis =
        /\b(?:transport|delivery delay|storage|warehouse|shipment|spoil|logistics|market price|supplier payment|sales revenue|profit|margin|financial loss|distribution stage)\w*\b/u.test(normalized);
      return context && axis;
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'eyeglass frame repair history parts fit and pickup operations'
    ) {
      if (/\b(?:leather bag|leather goods|handbag repair|leather matching|shoe repair)\b/u.test(normalized)) {
        return false;
      }
      return /\b(?:eyeglass|eyewear|optical frame|spectacle frame|glasses repair)\b/u.test(normalized) &&
        /\b(?:repair|damage|history|hinge|replacement part|color matching|colour matching|fit|adjustment|pickup)\w*\b/u.test(normalized);
    }

    if (constraint.kind === 'FARM_ENERGY_OPERATIONS') {
      if (/\b(?:spoilage|shipment|transport delay|delivery delay|cold chain logistics|farm pickup|market delivery)\b/u.test(normalized)) {
        return false;
      }
      return /\b(?:farm|farms|agricultur|irrigation|greenhouse)\w*\b/u.test(normalized) &&
        /\b(?:electricity|energy|power|irrigation pump|cold storage|greenhouse|processing equipment|crop schedule|weather|production demand|operating cost|efficiency|waste)\w*\b/u.test(normalized);
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'violin case restoration condition materials and repair history operations'
    ) {
      return /\b(?:violin case|instrument case)\b/u.test(normalized) &&
        /\b(?:restoration|repair|hinge|padding|fabric|handle|hardware|material|condition|history|previous restoration|customer preference|damage)\w*\b/u.test(normalized);
    }

    if (constraint.kind === 'SUBSCRIPTION_REVENUE_RETENTION') {
      if (
        /\b(?:fitness|gym|health club|membership class|workout)\b/u.test(normalized) ||
        /\b(?:cannot access|account access|restore purchase|password reset|login failure|refund denied|request refund|charged after cancellation|duplicate charge)\b/u.test(normalized)
      ) {
        return false;
      }

      const actorMatch =
        /\b(?:subscription|subscriber|saas|recurring revenue)\b/u.test(normalized);
      const workflowMatches = [
        /\b(?:cancel|cancellation|churn)\w*\b/u,
        /\b(?:renewal|retention)\w*\b/u,
        /\b(?:pricing|profitability|margin|discount)\w*\b/u,
        /\b(?:product usage|customer usage|usage behavior|support interaction|refund activity|payment behavior)\b/u,
        /\b(?:forecast|recurring revenue)\w*\b/u,
      ].filter((pattern) => pattern.test(normalized)).length;

      return actorMatch && workflowMatches >= 1;
    }

    return true;
  }

  static buildProgressiveFallback(input: {
    readonly sourceKey: string;
    readonly domainName?: string | null;
    readonly requestDescription?: string | null;
    readonly plannedQueries?: readonly string[];
    readonly keywords?: readonly string[];
  }): string[] {
    const sourceKey = this.normalize(input.sourceKey);
    const description = this.normalize(input.requestDescription ?? '');
    if (!description) return [];

    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: input.requestDescription,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries,
    });

    const relaxedPlannedQueries = RequestDynamicQueryUtil.buildRelaxedRetrievalQueries({
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      maxQueries: sourceKey === 'forum' ? 4 : 5,
    })
      .map((query) => this.shapeForSource(query, sourceKey))
      .filter(Boolean)
      .filter((query) =>
        !constraint.strict ||
        this.isPlannedQueryCompatibleWithConstraint(query, constraint),
      );

    const domainAgnosticFallbackQueries = RequestDynamicQueryUtil.buildEvidenceFacetQueries({
      requestDescription: input.requestDescription,
      maxQueries: sourceKey === 'forum' ? 4 : 5,
    })
      .map((query) => this.shapeForSource(query, sourceKey))
      .filter(Boolean)
      .filter((query) =>
        !constraint.strict ||
        this.isPlannedQueryCompatibleWithConstraint(query, constraint),
      );

    const genericFallbackQueries = this.unique([
      ...relaxedPlannedQueries,
      ...domainAgnosticFallbackQueries,
    ]);
    if (genericFallbackQueries.length > 0) {
      return genericFallbackQueries.slice(
        0,
        sourceKey === 'forum' ? 4 : 5,
      );
    }

    if (constraint.kind === 'AGRICULTURE_EXPORT_PROFITABILITY') {
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          'fresh produce export cold chain spoilage economic loss',
          'agricultural exporter transport storage cost profitability',
          'postharvest loss market price produce export revenue',
        ];
      }
      return [
        'fresh produce exporter logistics cost spoilage margin',
        'agricultural export shipment profitability problem',
        'produce export route cost market price loss',
      ];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'eyeglass frame repair history parts fit and pickup operations'
    ) {
      return [
        'eyeglass frame repair hinge replacement history',
        'glasses repair repeated adjustment fit preference',
        'optical frame repair notes pickup delay',
      ];
    }

    if (constraint.kind === 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'university suspicious login learning platform compromised account',
        'online exam suspicious account device activity false positive',
        'higher education account permission unauthorized access security alert',
        'lms login security incident student account compromise',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'higher education learning platform compromised account security incident',
        'university online exam account device anomaly integrity investigation',
        'university lms unauthorized access security alerts login activity',
        'academic platform security false positive student account restriction',
      ];
      if (sourceKey === 'crossref') return [
        'higher education learning management system account security anomaly detection',
        'online assessment authentication device anomaly academic integrity',
        'university account compromise login behavior security monitoring',
      ];
      if (sourceKey === 'youtube') return [
        'university lms suspicious login account security',
        'online exam account device anomaly security investigation',
        'higher education compromised account detection login records',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play') return [];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'decorative fountain restoration service history operations'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'decorative fountain restoration pump water flow repeated diagnosis',
        'fountain restorer wrong replacement part stone metal repair',
        'ornamental fountain restoration previous repair history finish preference',
        'water feature restoration pump condition customer request notes',
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        'decorative fountain restoration pump water flow stone metal repair',
        'historic fountain restoration replacement parts finish treatment',
        'fountain maintenance restoration repair history pump condition',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        'historic decorative fountain restoration pump stone corrosion repair',
        'ornamental fountain restoration water flow replacement components',
        'fountain restoration maintenance delayed repair incorrect parts',
      ];
      if (sourceKey === 'crossref') return [
        'historic fountain conservation restoration stone metal water system',
        'ornamental fountain conservation pump circulation stone deterioration',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play' || sourceKey === 'hacker-news') return [];
    }

    if (
      constraint.kind === 'PUBLIC_SECTOR' &&
      constraint.label === 'public grant evaluation and funding allocation'
    ) {
      if (sourceKey === 'forum') return [
        'public grant administrator application review duplicate funding budget problem',
        'government grant program eligibility review inconsistent scoring delays',
        'grant manager previous funding history duplicate request review workflow',
        'public funding program unrealistic budget underperformance risk review',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'government grant audit duplicate awards application review budget risk',
        'public grant program funding allocation inconsistent decisions delays',
        'grant oversight unrealistic budgets project underperformance public funds',
        'public funding program outcome tracking impact measurement grant awards',
      ];
      if (sourceKey === 'crossref') return [
        'public grant allocation application evaluation eligibility budget decision making',
        'government grant program evaluation funding allocation project outcomes',
        'grant application review scoring consistency budget risk public administration',
        'public funding allocation program performance impact evaluation',
      ];
      if (sourceKey === 'youtube') return [
        'grant management application review eligibility budget workflow',
        'public grant administrator duplicate funding application review',
        'government grant program evaluation funding allocation workflow',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play') return [
        'grant management application review',
        'grant administration funding review',
      ];
      if (
        sourceKey === 'github' || sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' || sourceKey === 'hacker-news' ||
        sourceKey === 'product-hunt'
      ) return [
        'grant management application review duplicate detection budget scoring',
        'public grant administration software eligibility review funding history',
      ];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'typewriter restoration condition parts and repair history operations'
    ) {
      if (sourceKey === 'forum') return [
        'typewriter repair restoration missing keys ribbon mechanism parts history',
        'typewriter restorer wrong replacement part repair history notes',
        'vintage typewriter repair repeated diagnostics previous repairs',
        'typewriter restoration workshop machine condition customer preferences',
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        'typewriter restoration repair ribbon mechanism replacement parts',
        'vintage typewriter repair workshop mechanical condition service history',
        'typewriter restoration damaged components missing keys repair notes',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        'typewriter restoration specialist repair workshop vintage machine parts',
        'antique typewriter repair restoration missing keys ribbon mechanism',
      ];
      if (sourceKey === 'crossref') return [
        'typewriter mechanical repair restoration maintenance condition',
        'typewriter repair replacement parts mechanical restoration',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play') return [
        'typewriter repair service history',
        'restoration workshop parts repair history',
      ];
      if (
        sourceKey === 'github' || sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' || sourceKey === 'hacker-news' ||
        sourceKey === 'product-hunt'
      ) return [
        'typewriter repair shop work order parts history software',
        'typewriter restoration repair records inventory workflow',
      ];
    }

    if (constraint.kind === 'FARM_ENERGY_OPERATIONS') {
      if (sourceKey === 'forum') return [
        'farm irrigation pump electricity energy waste operating cost',
        'agricultural energy use cold storage greenhouse efficiency',
        'farm energy monitoring crop schedule weather production demand',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'farm electricity energy use irrigation cold storage operating costs',
        'agricultural energy efficiency irrigation pumps greenhouses',
        'farm energy waste equipment schedules weather production demand',
        'agricultural electricity costs processing equipment efficiency',
      ];
      if (sourceKey === 'crossref') return [
        'farm energy consumption irrigation pumping cold storage efficiency',
        'agricultural electricity demand irrigation greenhouse energy management',
        'farm equipment energy efficiency crop schedules weather',
      ];
      if (sourceKey === 'youtube') return [
        'farm energy efficiency irrigation pumps cold storage',
        'agriculture electricity use greenhouse processing equipment',
        'farm energy monitoring crop schedule weather',
      ];
      return [
        'farm energy monitoring irrigation equipment efficiency',
        'agriculture electricity consumption operating cost',
      ];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'violin case restoration condition materials and repair history operations'
    ) {
      if (sourceKey === 'forum') return [
        'violin case restoration hinge padding hardware repair history',
        'instrument case restoration fabric material previous repair notes',
        'violin case restorer replacement hardware overlooked damage',
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        'violin case restoration hinge padding fabric hardware repair',
        'instrument case restoration materials repair history',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        'violin case restoration specialist repair materials history',
        'instrument case conservation restoration hardware padding fabric',
      ];
      if (sourceKey === 'crossref') return [
        'musical instrument case conservation materials repair history',
        'violin case conservation restoration materials condition',
      ];
      return [
        'violin case restoration repair history materials',
        'instrument case repair tracking restoration records',
      ];
    }

    if (constraint.kind === 'SUBSCRIPTION_REVENUE_RETENTION') {
      if (sourceKey === 'forum') return [
        'subscription business churn renewal retention recurring revenue problem',
        'subscription company customer cancellation product usage support data silos',
        'saas churn signals renewal history customer support product usage',
        'subscription pricing plan profitability discounts refunds retention',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'subscription business churn retention recurring revenue forecasting',
        'subscription customer cancellation renewal product usage analytics',
        'subscription pricing profitability discount retention revenue',
        'subscription business customer churn support usage payment data',
      ];
      if (sourceKey === 'crossref') return [
        'subscription customer churn prediction renewal product usage retention',
        'subscription pricing profitability churn discount recurring revenue',
        'customer churn subscription services behavioral signals retention',
      ];
      if (sourceKey === 'youtube') return [
        'subscription churn retention recurring revenue analytics',
        'subscription customer cancellation renewal product usage',
        'subscription pricing profitability discounts churn',
      ];
      if (
        sourceKey === 'app-store' || sourceKey === 'google-play' ||
        sourceKey === 'github' || sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' || sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news' || sourceKey === 'reddit'
      ) return [];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'violin case restoration condition materials and repair history operations'
    ) {
      if (sourceKey === 'forum') return [
        'violin case restoration hinge padding hardware repair history',
        'instrument case restoration fabric material previous repair notes',
        'violin case restorer replacement hardware overlooked damage',
        'violin case restoration repeated repair material finish history',
      ];
      if (sourceKey === 'youtube') return [
        'violin case restoration hinge padding fabric hardware repair',
        'instrument case restoration materials repair history',
        'violin case repair replacement hardware interior restoration',
      ];
      if (sourceKey === 'blog' || sourceKey === 'news' || sourceKey === 'gdelt') return [
        'violin case restoration specialist repair materials history',
        'instrument case conservation restoration hardware padding fabric',
        'violin case restoration previous repairs replacement hardware',
      ];
      if (sourceKey === 'crossref') return [
        'musical instrument case conservation materials repair history',
        'violin case conservation restoration materials condition',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play') return [
        'violin case restoration repair history',
        'instrument case repair records',
      ];
      return [
        'violin case restoration repair history materials',
        'instrument case repair tracking restoration records',
      ];
    }

    if (constraint.kind === 'MANUFACTURING_COST_PROFITABILITY') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'factory unexplained production cost increase stable output',
        'manufacturing raw material labor downtime cost variance problem',
        'production line defect scrap maintenance profitability issue',
        'manufacturer supplier price increase margin pressure',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'manufacturing cost inflation raw materials supplier prices production margins',
        'factory production bottleneck operating cost profitability',
        'manufacturing downtime defects maintenance cost pressure',
      ];
      if (sourceKey === 'crossref') return [
        'manufacturing cost variance production bottleneck profitability analysis',
        'raw material variability production cost manufacturing',
        'supplier cost uncertainty manufacturing operations',
      ];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'lamp restoration service'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'antique lamp restoration wrong replacement part customer request',
        'lamp repair workshop lost wiring notes repeated diagnostics',
        'lamp restorer shade measurement finish preference customer approval',
        'lamp restoration pickup delay repair history notes',
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        'professional lamp restoration workshop rewiring replacement parts',
        'antique lamp repair restoration documentation customer preferences',
        'lamp restoration specialist shade measurement finish repair',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        'antique lamp restoration workshop specialist repair parts',
        'professional lamp restoration conservation rewiring customer',
        'lamp restoration repair workshop repeated repair incorrect parts',
      ];
      if (sourceKey === 'crossref') return [
        'lamp conservation restoration treatment documentation',
        'historic lighting object conservation repair records',
      ];
    }

    const governmentLegalReview =
      /\b(?:government|municipal|public sector|agency|agencies|attorney general)\b/u.test(description) &&
      /\b(?:legal|permit|permits|contract|contracts|regulation|regulations|citizen application|citizen applications|case history|case histories|regulatory)\b/u.test(description) &&
      /\b(?:review|approval|approvals|missing information|conflicting requirements|manual review|backlog|delay|delayed|workload|urgent)\b/u.test(description);
    if (governmentLegalReview) {
      if (sourceKey === 'forum' || sourceKey === 'reddit' || sourceKey === 'youtube') {
        return [
          'government legal department permit review backlog manual review',
          'municipal permit application missing information approval delay',
          'government contract regulatory review conflicting requirements workload',
          'public sector legal document review case history fragmented records',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'government legal department permit approval backlog document review',
          'municipal legal review citizen applications delayed approvals',
          'government contract review regulatory requirements manual workload',
          'attorney general office legal review productivity document workload',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'public administration permit application review processing delay',
          'government legal document review regulatory compliance workflow',
          'municipal permit approval administrative burden fragmented records',
          'public sector contract review decision consistency workload',
        ];
      }
    }

    if (constraint.kind === 'PROFESSIONAL_SERVICE_AGENCY') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') {
        return [
          'sign language interpreter agency scheduling conflict assignment matching',
          'asl interpreting agency interpreter availability last minute cancellation',
          'interpreter agency client communication preferences assignment requirements',
          'sign language interpreter specialized vocabulary assignment notes problem',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'sign language interpreting agency scheduling workflow interpreter availability',
          'asl interpreter agency assignment coordination client requirements',
          'interpreter dispatcher last minute schedule changes sign language',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'sign language interpreter shortage agency scheduling assignments',
          'asl interpreters availability service assignment coordination',
          'interpreter agency scheduling cancellations client requirements',
          'sign language interpretation service staffing assignment pressure',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'sign language interpreter scheduling assignment allocation',
          'interpreter availability assignment matching language services',
          'sign language interpreting service coordination scheduling',
        ];
      }
    }

    const tourismTransitSurge =
      /\b(?:tourism operators?|tour operators?|city transport services?|public transport services?|municipal transit|city transit)\b/u.test(description) &&
      /\b(?:festival|festivals|holiday|holidays|large public events?|visitor demand|passenger volumes?|transport capacity|congestion|overcrowd|waiting times?|vehicle allocation|attraction schedules?|booking activity)\w*\b/u.test(description);
    if (tourismTransitSurge) {
      if (sourceKey === 'forum' || sourceKey === 'reddit' || sourceKey === 'youtube') {
        return [
          'festival public transport overcrowding visitor surge waiting times',
          'holiday tourism city transit congestion passenger demand',
          'large event public transport capacity overcrowded routes',
          'tourist attraction transit capacity visitor flow complaints',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'overtourism public transport congestion visitor hotspots capacity',
          'festival tourism transport overcrowding passenger surge city',
          'holiday visitor demand transit capacity waiting times',
          'large public event transport capacity vehicle allocation congestion',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'tourism visitor demand public transport capacity congestion',
          'event passenger demand transit capacity planning city',
          'demand responsive public transport tourist attractions',
          'visitor flow congestion transport to attractions',
        ];
      }
    }

    const umbrellaRepair =
      /\b(?:umbrella repair|umbrella repair specialist|umbrella repair specialists|umbrella restoration|parasol repair)\b/u.test(description) &&
      /\b(?:damaged ribs?|fabric condition|handle problems?|replacement parts?|previous repairs?|customer preferences?|pickup dates?|repair history|repeated repairs?|incorrect replacement parts?)\w*\b/u.test(description);
    if (umbrellaRepair) {
      if (sourceKey === 'forum' || sourceKey === 'reddit' || sourceKey === 'youtube') {
        return [
          'umbrella repair shop wrong replacement part repeated repair',
          'umbrella restoration broken ribs fabric handle repair history',
          'umbrella repair service customer instructions pickup date notes',
          'parasol repair replacement ribs canopy handle customer request',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'umbrella repair service replacement parts repair shop',
          'umbrella restoration repair workshop broken frame canopy',
          'parasol repair service parts customer repair',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'umbrella repair restoration frame ribs canopy',
          'umbrella product repairability replacement parts',
        ];
      }
    }

    const weddingDressPreservation =
      /\b(?:wedding dress|wedding gown|bridal gown|bridal dress)\b/u.test(description) &&
      /\b(?:preservation|preserve|textile restoration|garment restoration|dry cleaning|cleaning restriction|cleaning restrictions)\b/u.test(description);
    if (weddingDressPreservation) {
      if (sourceKey === 'forum' || sourceKey === 'reddit' || sourceKey === 'youtube') {
        return [
          'wedding dress preservation lost customer instructions handwritten notes',
          'bridal gown cleaning damaged beadwork wrong treatment',
          'wedding gown preservation fabric cleaning restrictions alterations records',
          'textile restoration shop repeated work missing garment notes',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'wedding dress preservation cleaning damage beadwork customer complaint',
          'bridal gown preservation dry cleaner lost wedding dress customer items',
          'wedding gown restoration cleaning restrictions fabric damage',
          'textile restoration garment documentation customer instructions',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'wedding gown textile conservation cleaning fabric preservation',
          'historic textile conservation cleaning decorative elements documentation',
          'garment conservation treatment documentation fabric damage',
          'textile preservation treatment records cleaning restrictions',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'sneaker and shoe cleaning service'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') {
        return [
          'sneaker cleaning shop lost customer shoes paper tags',
          'shoe cleaning business forgotten customer instructions pickup delay',
          'sneaker restoration shop wrong treatment material stain notes',
          'shoe cleaner repeated treatment missing service history',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'sneaker cleaning shop workflow customer shoes pickup',
          'shoe restoration shop intake stain material treatment history',
          'sneaker cleaner customer item tracking paper tags',
          'shoe cleaning business misplaced shoes delayed pickup',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'sneaker cleaning business customer item tracking service history',
          'shoe restoration shop material treatment records pickup deadlines',
          'shoe cleaning service misplaced items customer requests',
          'sneaker restoration operations treatment history customer intake',
        ];
      }
      if (sourceKey === 'crossref') return [];
    }

    if (
      constraint.kind === 'RESTAURANT_ENERGY'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') {
        return [
          'restaurant manager rising energy costs refrigeration equipment problem',
          'commercial kitchen utility bills refrigeration maintenance cost',
          'restaurant food waste equipment failure operating cost',
          'restaurant sales demand energy usage cost tracking problem',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'restaurant refrigeration energy cost equipment maintenance',
          'commercial kitchen utility cost food waste equipment efficiency',
          'restaurant operating costs refrigeration cooking equipment',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'restaurants rising energy costs refrigeration equipment maintenance',
          'commercial kitchen utility costs refrigeration efficiency operating margins',
          'restaurant equipment failures food spoilage operating costs',
          'restaurant HVAC refrigeration financial cost maintenance',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'restaurant refrigeration energy consumption operating cost',
          'commercial kitchen equipment energy efficiency maintenance',
          'restaurant food waste energy use operating cost',
          'commercial refrigeration fault energy consumption restaurant',
        ];
      }
    }

    if (
      constraint.kind === 'HEALTHCARE_OPERATIONS' &&
      constraint.label === 'hospital operating room resource coordination'
    ) {
      if (
        sourceKey === 'crossref' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'news' ||
        sourceKey === 'blog'
      ) {
        return [
          'operating room scheduling staff equipment emergency cases',
          'surgical suite resource allocation operating room utilization',
          'operating room schedule disruption emergency surgery staffing',
          'surgery scheduling equipment availability procedure delays',
        ];
      }
      if (sourceKey === 'forum' || sourceKey === 'youtube') {
        return [
          'operating room scheduling conflict staff equipment',
          'surgery schedule emergency case operating room delay',
          'operating room utilization idle room staffing problem',
          'hospital surgery rescheduling equipment unavailable',
        ];
      }
      if (
        sourceKey === 'app-store' || sourceKey === 'google-play' ||
        sourceKey === 'github' || sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' || sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) return [];
    }

    if (
      constraint.kind === 'CUSTOM_SPECIFICATION_SERVICE' &&
      constraint.label === 'tattoo design specification revision and approval operations'
    ) {
      if (
        sourceKey === 'crossref' || sourceKey === 'gdelt' ||
        sourceKey === 'news' || sourceKey === 'blog'
      ) {
        return [
          'tattoo artist client design revision approval workflow',
          'tattoo consultation design references placement client approval',
          'tattoo appointment design version revision records',
          'tattoo studio client communication design approval',
        ];
      }
      if (sourceKey === 'forum' || sourceKey === 'youtube') {
        return [
          'tattoo artist lost client design reference messages',
          'tattoo artist wrong design version revision approval',
          'tattoo placement size color client revision problem',
          'tattoo appointment client approval aftercare notes',
        ];
      }
      if (
        sourceKey === 'app-store' || sourceKey === 'google-play' ||
        sourceKey === 'github' || sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' || sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) return [];
    }

    if (constraint.kind === 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH') {
      if (sourceKey === 'crossref' || sourceKey === 'gdelt' || sourceKey === 'news' || sourceKey === 'blog') {
        return [
          'industrial equipment condition monitoring energy consumption',
          'machine energy efficiency predictive maintenance',
          'electric motor condition monitoring power consumption',
          'factory equipment energy anomaly downtime',
        ];
      }
      if (sourceKey === 'reddit' || sourceKey === 'forum' || sourceKey === 'youtube') {
        return [
          'machine energy consumption equipment failure',
          'factory equipment efficiency predictive maintenance',
          'machine power draw maintenance condition',
        ];
      }
    }

    if (constraint.kind === 'MUSICAL_MANUSCRIPT_RESTORATION') {
      if (sourceKey === 'crossref' || sourceKey === 'gdelt' || sourceKey === 'news' || sourceKey === 'blog') {
        return [
          'manuscript conservation treatment documentation',
          'paper conservation condition reports previous repairs',
          'document conservation treatment records annotations',
          'music manuscript conservation',
        ];
      }
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'manuscript conservation treatment records',
          'paper conservator condition report',
          'document conservator previous repairs',
          'music manuscript restoration',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'manuscript conservation treatment',
          'paper conservation condition report',
          'music manuscript restoration',
        ];
      }
    }

    const facetQueries = RequestDynamicQueryUtil.buildEvidenceFacetQueries({
      requestDescription: input.requestDescription,
      maxQueries: sourceKey === 'forum' ? 4 : 5,
    })
      .map((query) => this.shapeForSource(query, sourceKey))
      .filter(Boolean)
      .filter((query) =>
        !constraint.strict ||
        this.isPlannedQueryCompatibleWithConstraint(query, constraint),
      );
    if (facetQueries.length > 0) {
      return this.unique(facetQueries).slice(0, sourceKey === 'forum' ? 4 : 5);
    }

    const actor = RequestDynamicQueryUtil.extractActor(description);
    const workflow = RequestDynamicQueryUtil.extractWorkflowTerms(description)
      .map((value) => this.cleanQuery(value))
      .filter(Boolean)
      .slice(0, 3);
    const pains = RequestDynamicQueryUtil.extractPainTerms(description)
      .map((value) => this.cleanQuery(value))
      .filter(Boolean)
      .slice(0, 2);
    const domain = this.cleanQuery(input.domainName ?? '');
    const actorQuery = this.cleanQuery(actor);

    return this.unique([
      actorQuery && workflow[0] ? `${actorQuery} ${workflow[0]}` : '',
      domain && workflow[0] ? `${domain} ${workflow[0]}` : '',
      actorQuery && pains[0] ? `${actorQuery} ${pains[0]}` : '',
      workflow.slice(0, 2).join(' '),
    ]).filter(Boolean).slice(0, 4);
  }

  private static buildVerticalSourceQueries(
    constraint: ReturnType<typeof RequestVerticalConstraintUtil.resolve>,
    sourceKey: string,
    requestDescription: string,
  ): string[] {
    const actor = constraint.label;

    if (constraint.kind === 'TRANSACTION_ACCOUNT_ABUSE') {
      if (sourceKey === 'app-store' || sourceKey === 'google-play') return [
        'transit refund fraud',
        'ticket payment fraud',
        'passenger account takeover',
        'mobility booking fraud',
      ];
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'transit operator fraudulent refund account abuse',
        'transport ticket payment fraud passenger account takeover',
        'mobility booking suspicious payment false positive passenger',
        'train ticket refund scam fraud investigation',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        'train company ticket refund fraud financial loss',
        'transit ticketing fraudulent refund coordinated abuse',
        'transportation payment fraud passenger account compromise',
        'mobility service suspicious booking payment fraud',
      ];
      if (sourceKey === 'crossref') return [
        'transportation payment fraud account takeover detection',
        'transit ticketing refund fraud anomaly detection',
        'mobility payment account abuse device fingerprinting',
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        'transit ticket refund fraud investigation',
        'transportation payment fraud account takeover device signals',
        'mobility booking fraud false positive passenger restriction',
      ];
    }

    if (constraint.kind === 'FOOD_STORAGE_CONDITION') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'restaurant kitchen refrigerator temperature food spoilage problem',
        'commercial kitchen freezer failure ingredient loss',
        'restaurant ingredient expiration food waste tracking',
        'commercial kitchen refrigeration maintenance spoilage incident',
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        'commercial kitchen refrigerator temperature spoilage monitoring',
        'restaurant freezer performance ingredient expiration waste',
        'restaurant refrigeration maintenance food inventory loss',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        'restaurant refrigeration failure food spoilage inventory loss',
        'commercial kitchen cold storage temperature food waste',
        'restaurant freezer breakdown spoiled ingredients maintenance',
        'foodservice storage temperature expiration waste incident',
      ];
      if (sourceKey === 'crossref') return [
        'commercial kitchen cold storage temperature food spoilage',
        'restaurant refrigeration condition food waste expiration',
        'foodservice refrigeration maintenance inventory loss',
      ];
    }

    if (constraint.kind === 'RESTORATION_CONSERVATION') {
      const identity =
        constraint.requiredAnchors.find((value) => value.split(/\s+/u).length >= 2) ??
        constraint.requiredAnchors[0] ??
        'restoration';
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        `${identity} condition previous repairs documentation`,
        `${identity} original design details restoration history`,
        `${identity} replacement material matching rework`,
        `${identity} damage condition handwritten notes photos`,
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        `${identity} condition assessment previous restoration materials`,
        `${identity} restoration history original details material matching`,
        `${identity} conservation treatment records physical samples`,
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        `${identity} restoration incorrect material matching`,
        `${identity} conservation lost original design details`,
        `${identity} restoration repeated work material waste`,
      ];
      if (sourceKey === 'crossref') return [
        `${identity} conservation condition assessment treatment history`,
        `${identity} restoration material matching previous repairs`,
        `${identity} conservation documentation original design`,
      ];
    }

    if (constraint.kind === 'RENTAL_INVENTORY_OPERATIONS') {
      const identity =
        constraint.requiredAnchors.find((value) => value.split(/\s+/u).length >= 2) ??
        constraint.requiredAnchors[0] ??
        'rental inventory';
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        `${identity} double booking availability conflict`,
        `${identity} missing accessories return condition`,
        `${identity} overlooked damage condition inspection`,
        `${identity} deposit incorrect charge return record`,
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        `${identity} condition inspection maintenance history rental`,
        `${identity} missing accessories return checklist`,
        `${identity} availability double booking servicing`,
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        `${identity} double booking delayed rental availability`,
        `${identity} missing accessories damage incorrect charge`,
        `${identity} overdue return maintenance availability`,
      ];
      if (sourceKey === 'crossref') return [
        `${identity} inventory availability maintenance rental operations`,
        `${identity} condition assessment maintenance history rental`,
        `${identity} booking return date inventory management`,
      ];
      return [
        `${identity} availability return date condition`,
        `${identity} double booking accessories maintenance`,
      ];
    }

    if (constraint.kind === 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'university lms suspicious login compromised student account',
        'online exam session device anomaly account security false positive',
        'higher education unauthorized account permission security incident',
        'learning platform login records security alerts investigation',
        'university compromised credentials exam integrity incident',
      ];
      if (sourceKey === 'youtube') return [
        'university lms suspicious login compromised account investigation',
        'online exam account device anomaly academic integrity security',
        'higher education login security alerts account permissions',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'higher education learning platform compromised account security incident',
        'university lms unauthorized access account permission investigation',
        'online assessment suspicious account device activity integrity review',
        'academic platform security false positive account restriction legitimate student',
      ];
      if (sourceKey === 'crossref') return [
        'higher education learning management system authentication anomaly detection',
        'online examination account behavior device anomaly academic integrity',
        'university compromised account login security monitoring',
        'learning platform access control security alert correlation higher education',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play' || sourceKey === 'hacker-news') return [];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'decorative fountain restoration service history operations'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'decorative fountain restoration pump condition water flow issue',
        'fountain restorer stone damage metal corrosion wrong replacement part',
        'historic fountain previous repair history repeated diagnosis',
        'ornamental fountain finish preference customer request restoration notes',
      ];
      if (sourceKey === 'youtube') return [
        'decorative fountain restoration pump repair water flow stone damage',
        'historic fountain restoration metal corrosion replacement components',
        'ornamental fountain restoration maintenance repair history finish',
      ];
      if (sourceKey === 'blog' || sourceKey === 'news' || sourceKey === 'gdelt') return [
        'professional decorative fountain restoration pump water flow repair',
        'historic fountain stone metal restoration replacement components',
        'ornamental fountain maintenance previous repairs finish restoration',
        'fountain restoration incorrect parts repeated diagnostics delayed completion',
      ];
      if (sourceKey === 'crossref') return [
        'historic fountain conservation stone metal deterioration restoration',
        'ornamental fountain conservation water circulation pump restoration',
        'fountain stonework metal conservation repair documentation',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play' || sourceKey === 'hacker-news') return [];
    }

    if (
      constraint.kind === 'PUBLIC_SECTOR' &&
      constraint.label === 'public grant evaluation and funding allocation'
    ) {
      if (sourceKey === 'forum') return [
        'public grant administrator application review duplicate funding budget problem',
        'government grant eligibility review inconsistent scoring approval delay',
        'grant manager previous funding history duplicate request workflow',
        'public funding program unrealistic budget underperformance review',
      ];
      if (sourceKey === 'youtube') return [
        'grant management application review eligibility budget workflow',
        'public grant duplicate funding review administration',
        'government grant allocation project outcome evaluation',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'government grant audit duplicate awards application review budget risk',
        'public grant funding allocation inconsistent decisions approval delays',
        'grant oversight unrealistic budgets project underperformance public funds',
        'public funding program outcome impact tracking award decisions',
      ];
      if (sourceKey === 'crossref') return [
        'public grant application evaluation eligibility budget allocation decision',
        'government grant program evaluation project outcomes funding allocation',
        'grant review scoring consistency budget risk public administration',
        'public funding program performance impact evaluation',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play') return [
        'grant management application review',
        'grant administration funding review',
      ];
      return [
        'grant management application review duplicate detection budget scoring',
        'public grant administration eligibility review funding history',
      ];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'typewriter restoration condition parts and repair history operations'
    ) {
      if (sourceKey === 'forum') return [
        'typewriter repair restoration missing keys ribbon mechanism parts history',
        'typewriter restorer wrong replacement part previous repair notes',
        'vintage typewriter repeated diagnostics machine repair history',
        'typewriter restoration workshop condition customer preferences',
      ];
      if (sourceKey === 'youtube') return [
        'typewriter restoration repair ribbon mechanism replacement parts',
        'vintage typewriter repair mechanical condition service history',
        'typewriter restoration damaged components missing keys repair notes',
      ];
      if (sourceKey === 'blog' || sourceKey === 'news' || sourceKey === 'gdelt') return [
        'typewriter restoration specialist workshop vintage machine repair parts',
        'antique typewriter repair missing keys ribbon mechanism restoration',
        'typewriter restorer repair history wrong replacement parts diagnostics',
      ];
      if (sourceKey === 'crossref') return [
        'typewriter mechanical repair restoration maintenance condition',
        'typewriter repair replacement parts mechanical restoration',
      ];
      if (sourceKey === 'app-store' || sourceKey === 'google-play') return [
        'typewriter repair service history',
        'restoration workshop parts repair history',
      ];
      return [
        'typewriter repair shop work order parts history software',
        'typewriter restoration repair records inventory workflow',
      ];
    }

    if (constraint.kind === 'MANUFACTURING_COST_PROFITABILITY') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'manufacturing production cost increase stable output root cause',
        'factory raw material labor downtime cost overrun profitability',
        'manufacturing defect scrap maintenance cost per unit problem',
        'supplier price increase factory production margin cost variance',
      ];
      if (sourceKey === 'youtube' || sourceKey === 'blog') return [
        'manufacturing cost variance raw material downtime labor defects',
        'factory production cost per unit bottleneck maintenance supplier price',
        'manufacturing profitability production stage cost driver analysis',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt') return [
        'manufacturing production costs raw material supplier prices margin pressure',
        'factory cost increases stable output downtime defects maintenance',
        'manufacturing supplier price volatility production profitability',
        'production bottleneck cost overrun manufacturing margins',
      ];
      if (sourceKey === 'crossref') return [
        'manufacturing production cost variance bottleneck profitability',
        'raw material variability manufacturing production cost',
        'supplier cost uncertainty manufacturing profitability',
        'machine downtime defect maintenance cost manufacturing',
        'production stage cost driver manufacturing cost per unit',
      ];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'lamp restoration service'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'antique lamp restoration workshop replacement parts wiring notes customer request',
        'lamp repair shop wrong part repeated diagnostic customer notes',
        'lamp restorer shade measurement finish preference repair history',
        'lamp rewiring restoration customer approval pickup delay',
      ];
      if (sourceKey === 'youtube') return [
        'professional antique lamp restoration workshop rewiring repair history',
        'lamp restoration specialist replacement parts shade measurement workflow',
        'lamp repair workshop customer request finish restoration',
      ];
      if (sourceKey === 'blog' || sourceKey === 'news' || sourceKey === 'gdelt') return [
        'antique lamp restoration specialist workshop replacement parts customer',
        'lamp restoration workshop rewiring repair history customer request',
        'professional lamp repair restoration incorrect parts repeated repair',
        'lighting conservation lamp restoration treatment documentation',
      ];
      if (sourceKey === 'crossref') return [
        'historic lamp conservation restoration treatment documentation',
        'lighting object conservation electrical restoration documentation',
        'lamp restoration conservation repair history materials',
      ];
    }

    const governmentLegalReview =
      /\b(?:government|municipal|public sector|agency|agencies|attorney general)\b/u.test(requestDescription) &&
      /\b(?:legal|permit|permits|contract|contracts|regulation|regulations|citizen application|citizen applications|case history|case histories|regulatory)\b/u.test(requestDescription);
    if (governmentLegalReview) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'government legal department permit review backlog manual review',
        'municipal permit application missing information approval delay',
        'government contract regulatory review conflicting requirements workload',
      ];
      if (sourceKey === 'youtube') return [
        'government legal department document review workflow permit backlog',
        'municipal permit review approval process legal workload',
        'attorney general office legal research document review productivity',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'government legal department permit approval backlog document review',
        'municipal legal review citizen applications delayed approvals',
        'government contract review regulatory requirements manual workload',
        'attorney general office legal review productivity document workload',
      ];
      if (sourceKey === 'crossref') return [
        'public administration permit application review processing delay',
        'government legal document review regulatory compliance workflow',
        'municipal permit approval administrative burden fragmented records',
      ];
    }

    if (constraint.kind === 'PROFESSIONAL_SERVICE_AGENCY') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'sign language interpreter agency scheduling conflict assignment matching',
        'asl interpreting agency interpreter availability last minute cancellation',
        'interpreter agency client preferences specialized vocabulary assignment',
        'sign language interpretation agency missed assignment communication problem',
      ];
      if (sourceKey === 'youtube') return [
        'sign language interpreting agency scheduling workflow interpreter availability',
        'asl interpreter agency assignment matching client requirements',
        'interpreter dispatcher last minute schedule changes sign language',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'sign language interpreter shortage agency scheduling assignments',
        'asl interpreters availability service assignment coordination',
        'interpreter agency scheduling cancellations client requirements',
        'sign language interpretation service staffing assignment pressure',
      ];
      if (sourceKey === 'crossref') return [
        'sign language interpreter scheduling assignment allocation',
        'interpreter availability assignment matching language services',
        'sign language interpreting service coordination scheduling',
      ];
    }

    const weddingDressPreservation =
      /\b(?:wedding dress|wedding gown|bridal gown|bridal dress)\b/u.test(requestDescription) &&
      /\b(?:preservation|preserve|textile restoration|garment restoration|dry cleaning|cleaning restriction|cleaning restrictions)\b/u.test(requestDescription);
    if (weddingDressPreservation) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') return [
        'wedding dress preservation lost customer instructions handwritten notes',
        'bridal gown cleaning damaged beadwork wrong treatment',
        'wedding gown preservation fabric cleaning restrictions alterations records',
        'textile restoration repeated work missing garment notes',
      ];
      if (sourceKey === 'youtube') return [
        'wedding dress preservation shop cleaning restrictions customer instructions',
        'bridal gown preservation damaged beadwork cleaning treatment',
        'wedding gown restoration fabric stains alterations documentation',
      ];
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') return [
        'wedding dress preservation cleaning damage beadwork customer complaint',
        'bridal gown preservation dry cleaner lost wedding dress customer items',
        'wedding gown restoration cleaning restrictions fabric damage',
        'textile restoration garment documentation customer instructions',
      ];
      if (sourceKey === 'crossref') return [
        'wedding gown textile conservation cleaning fabric preservation',
        'historic textile conservation cleaning decorative elements documentation',
        'garment conservation treatment documentation fabric damage',
      ];
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'sneaker and shoe cleaning service'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'reddit') {
        return [
          'sneaker cleaning shop lost customer shoes paper tags',
          'shoe cleaner forgotten customer cleaning preferences pickup deadline',
          'sneaker restoration wrong treatment material stain condition',
          'shoe cleaning business repeated treatment missing service history',
          'sneaker cleaner misplaced pair customer request delayed pickup',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'sneaker cleaning shop customer shoes intake pickup workflow',
          'shoe restoration shop stain material treatment history',
          'sneaker cleaner paper tags service history customer preferences',
          'shoe cleaning business misplaced shoes delayed pickup',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'sneaker cleaning business customer item tracking service history',
          'shoe restoration shop material treatment records pickup deadlines',
          'shoe cleaning service misplaced items customer requests',
          'sneaker restoration operations treatment history customer intake',
        ];
      }
      if (sourceKey === 'crossref') return [];
    }

    if (constraint.kind === 'RESTAURANT_ENERGY') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') {
        return [
          'restaurant manager rising energy costs refrigeration equipment problem',
          'commercial kitchen utility bills refrigeration maintenance cost',
          'restaurant food waste equipment failure operating cost',
          'restaurant sales demand energy usage cost tracking problem',
          'restaurant refrigeration breakdown food spoilage utility expense',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'restaurant refrigeration energy cost equipment maintenance',
          'commercial kitchen utility cost food waste equipment efficiency',
          'restaurant operating costs refrigeration cooking equipment',
          'restaurant HVAC refrigeration maintenance cost',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'restaurants rising energy costs refrigeration equipment maintenance',
          'commercial kitchen utility costs refrigeration efficiency operating margins',
          'restaurant equipment failures food spoilage operating costs',
          'restaurant HVAC refrigeration financial cost maintenance',
          'restaurant smart kitchen energy equipment cost operations',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'restaurant refrigeration energy consumption operating cost',
          'commercial kitchen equipment energy efficiency maintenance',
          'restaurant food waste energy use operating cost',
          'commercial refrigeration fault energy consumption restaurant',
        ];
      }
    }

    if (
      constraint.kind === 'HEALTHCARE_OPERATIONS' &&
      constraint.label === 'hospital operating room resource coordination'
    ) {
      if (sourceKey === 'forum') {
        return [
          'operating room scheduling conflicts staff equipment emergency cases',
          'surgery schedule disruption operating room staffing shortage',
          'operating room idle time resource allocation scheduling problem',
          'urgent surgery rescheduling equipment availability hospital',
          'operating room turnover delay staff availability procedure',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          'hospital operating room scheduling staff equipment emergency cases',
          'surgical suite resource allocation operating room utilization delays',
          'operating room scheduling disruptions emergency surgery staffing',
          'surgery scheduling equipment availability procedure delay',
          'operating theatre utilization room turnover staffing coordination',
        ];
      }
      if (sourceKey === 'blog' || sourceKey === 'youtube') {
        return [
          'operating room scheduling conflict hospital staff equipment',
          'surgery rescheduling emergency case operating room utilization',
          'operating room turnover idle time staffing equipment availability',
          'hospital surgical scheduling resource coordination delays',
        ];
      }
      if (
        sourceKey === 'app-store' || sourceKey === 'google-play' ||
        sourceKey === 'github' || sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' || sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) return [];
    }

    if (
      constraint.kind === 'CUSTOM_SPECIFICATION_SERVICE' &&
      constraint.label === 'tattoo design specification revision and approval operations'
    ) {
      if (sourceKey === 'forum') {
        return [
          'tattoo artist client design references lost messages revisions',
          'tattoo artist wrong stencil size placement client approval',
          'tattoo design revision approved version appointment confusion',
          'tattoo client reference photos instagram messages lost details',
          'tattoo artist revision requests color placement record problem',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'tattoo studio client consultation design revision records',
          'tattoo artist client communication design approval workflow',
          'tattoo design versioning placement size revision management',
          'tattoo appointment design approval client record keeping',
          'tattoo aftercare client records consultation workflow',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'tattoo consultation design revision client approval',
          'tattoo artist stencil placement size revision workflow',
          'tattoo appointment client design approval records',
        ];
      }
      if (
        sourceKey === 'app-store' || sourceKey === 'google-play' ||
        sourceKey === 'github' || sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' || sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) return [];
    }


    if (constraint.kind === 'SUBSCRIPTION_REVENUE_RETENTION') {
      if (sourceKey === 'forum') {
        return [
          'subscription business churn renewal retention recurring revenue problem',
          'subscription company customer cancellation product usage support data silos',
          'saas churn signals renewal history customer support product usage',
          'subscription pricing plan profitability discounts refunds retention',
          'subscription retention offer effectiveness churn risk customer behavior',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'subscription business churn retention recurring revenue forecasting',
          'subscription customer cancellation renewal product usage analytics',
          'subscription pricing profitability discount retention revenue',
          'subscription customer churn support interactions payment renewal data',
          'recurring revenue forecast churn cancellation renewal behavior',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'subscription churn retention recurring revenue analytics',
          'subscription customer cancellation renewal product usage',
          'subscription pricing profitability discounts churn',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news' ||
        sourceKey === 'reddit'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'ECOMMERCE_MARGIN_PROFITABILITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'ecommerce merchant profit margin hidden advertising shipping fees',
          'online retailer contribution margin discount returns payment fees',
          'shopify merchant strong sales low profit ad spend shipping costs',
          'ecommerce promotion overspending campaign profitability margin decline',
          'seller net profit gross revenue hidden fulfillment costs',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'ecommerce contribution margin advertising returns shipping fees profitability',
          'online retail unit economics discounts fulfillment payment fees',
          'retail campaign profitability ad spend returns margin analysis',
          'merchant margin erosion strong sales hidden ecommerce costs',
          'ecommerce product profitability gross revenue net profit attribution',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'ecommerce contribution margin product profitability',
          'shopify profit margin shipping fees returns ads',
          'online retail campaign profitability ad spend',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'MEDIA_CONTENT_PROFITABILITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'streaming service content profitability production cost subscriber revenue',
          'streaming show production budget subscriber retention financial return',
          'digital entertainment content roi viewing engagement churn profitability',
          'streaming platform ad revenue content cost title performance',
          'media company content investment low performing shows revenue forecast',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'streaming content profitability production costs subscriber revenue attribution',
          'streaming title economics viewing engagement subscriber retention content investment',
          'digital entertainment show performance advertising revenue production budget',
          'media content roi churn campaign performance revenue forecast',
          'streaming platform content investment financial return creator performance',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'streaming content profitability production cost subscriber revenue',
          'streaming show roi viewing engagement churn',
          'media content investment revenue forecasting',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'TRANSPORTATION_COST_PROFITABILITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'transport operator rising fuel maintenance costs stable passenger volume',
          'fleet manager route profitability vehicle utilization operating cost',
          'transit operator route margin ticket revenue maintenance expense',
          'delivery fleet operating cost route performance revenue profitability',
          'transportation company driver scheduling fuel cost margin erosion',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'transportation operating cost fuel maintenance route profitability analysis',
          'fleet vehicle utilization route margin operating expense financial forecast',
          'transit operating cost ticket revenue route performance profitability',
          'delivery fleet cost per route utilization maintenance fuel revenue',
          'transport operator cost variance pricing route financial performance',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'fleet operating cost route profitability vehicle utilization',
          'transit route cost fuel maintenance ticket revenue',
          'transportation financial forecasting fleet cost analysis',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'LOGISTICS_COST_PROFITABILITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'logistics company rising delivery costs stable shipment volume fuel warehouse penalties',
          'freight operator profit margin failed deliveries fuel maintenance route performance',
          '3pl operating cost warehouse expense delivery penalty margin erosion',
          'delivery operator cost per shipment route profitability customer penalties',
          'logistics manager route planning pricing financial forecast operating expenses',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'logistics operating costs fuel warehouse maintenance route profitability analysis',
          'freight delivery cost per shipment failed delivery penalties profit margin',
          '3pl route performance vehicle maintenance warehouse cost financial forecast',
          'logistics shipment volume stable operating expense margin erosion pricing',
          'delivery operations route planning customer penalties profitability cost drivers',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'logistics delivery cost profit margin fuel warehouse route performance',
          '3pl operating expenses failed deliveries maintenance profitability',
          'freight route profitability cost per shipment financial forecasting',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'FRAME_RESTORATION_SPECIFICATION') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'frame restorer customer approved finish repair notes lost details',
          'antique picture frame restoration wrong finish repeated repair client changes',
          'gilded frame restorer material sample finish approval documentation',
          'picture frame restoration scattered photos handwritten notes customer approval',
          'frame conservation repair notes decorative details delayed client order',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'picture frame restoration treatment documentation client approval materials',
          'antique frame conservation condition documentation finish restoration records',
          'gilded frame restoration material selection treatment records client specification',
          'frame restoration repeated repair incorrect finish documentation workflow',
          'picture frame conservator repair notes material samples completion delay',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'picture frame restoration repair documentation finish selection',
          'antique frame restoration client approval treatment notes',
          'gilded frame restoration material finish repair workflow',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'MUNICIPAL_WASTE_COLLECTION_COORDINATION') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'municipal waste collection fixed schedules overflowing bins route inefficiency',
          'city sanitation missed pickups citizen complaints collection routes',
          'waste collection vehicle routing container fill levels unnecessary trips',
          'municipal garbage collection neighborhood demand pickup frequency problem',
          'city waste fleet route performance operating cost resource allocation',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'municipal waste collection route optimization overflowing containers operational study',
          'urban solid waste collection scheduling container fill level fleet routing',
          'city sanitation collection frequency neighborhood demand route efficiency',
          'municipal waste vehicle routing citizen complaints service allocation',
          'smart city waste collection pickup scheduling operating cost container overflow',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'municipal waste collection route optimization bin overflow',
          'city sanitation collection scheduling vehicle routing',
          'smart waste collection fill level route planning',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'MUSICAL_MANUSCRIPT_RESTORATION') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'manuscript conservator treatment records annotations previous repairs problem',
          'paper conservator condition report missing pages treatment documentation',
          'music manuscript restoration annotations paper repair records',
          'document conservator scattered treatment notes client instructions',
          'manuscript conservation lost annotations duplicated treatment work',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'manuscript conservation treatment documentation condition report annotations',
          'paper conservation previous repairs treatment records historic manuscript',
          'music manuscript conservation missing pages annotations restoration',
          'document conservation treatment history paper type condition assessment',
          'manuscript restoration documentation approved treatment workflow',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'manuscript conservation condition report treatment documentation',
          'paper conservation restoration annotations repair history',
          'music manuscript conservation restoration workflow',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'BOOK_COVER_COMMISSION_SPECIFICATION') {
      const bookEdgeGilding = /\b(?:book edge gilding|edge gilding|fore[- ]edge gilding|book gilding|gold[- ]leaf book edges?|gold leaf book edges?)\b/iu.test(
        requestDescription,
      );
      if (bookEdgeGilding) {
        if (sourceKey === 'reddit' || sourceKey === 'forum') {
          return [
            'book edge gilding gold leaf material selection mistake rework',
            'fore-edge gilding surface preparation damaged book problem',
            'bookbinder gilding customer specification revision approval notes',
            'gold leaf book edges inconsistent finish wrong material',
            'custom bookbinding gilding scattered client notes delayed order',
            'book edge decoration pattern revision customer approval problem',
          ];
        }
        if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
          return [
            'book edge gilding surface preparation gold leaf material selection',
            'fore-edge gilding bookbinding finishing errors damaged books',
            'custom bookbinding client specifications revision tracking rework',
            'book restoration gilding material mismatch surface preparation',
            'bookbinder custom order approval finish specification workflow',
            'gold leaf book edge finishing repeated work deadline',
          ];
        }
        if (sourceKey === 'youtube') {
          return [
            'book edge gilding mistakes surface preparation gold leaf',
            'fore-edge gilding bookbinding problems material selection',
            'book edge gold leaf finishing rework damaged book',
            'custom bookbinding gilding client specification approval',
          ];
        }
        if (sourceKey === 'app-store' || sourceKey === 'google-play' || sourceKey === 'github' || sourceKey === 'stackoverflow' || sourceKey === 'dev-to' || sourceKey === 'product-hunt' || sourceKey === 'hacker-news') {
          return [];
        }
      }
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'bookbinder client dimensions material embossing revision approval problem',
          'custom bookbinding lost client specifications artwork measurements rework',
          'book cover craftsman wrong dimensions missed design details customer approval',
          'bindery revision request final approved specification delayed order',
          'bookbinder material selection foil stamping customer changes wasted material',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'custom bookbinding specification client approval dimensions materials revisions',
          'bookbinder commission workflow artwork dimensions embossing material selection',
          'bindery production errors incorrect dimensions revision communication',
          'bespoke bookbinding client specifications version control material waste',
          'book cover craftsmanship custom order approval revision production deadline',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'bookbinder custom commission client specification workflow',
          'bookbinding cover dimensions materials embossing customer approval',
          'custom bookbinding revision rework material waste',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'URBAN_ENERGY_DEMAND_INTELLIGENCE') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'city public building electricity demand peak load energy waste',
          'street lighting energy consumption municipal demand problem',
          'ev charging station peak demand city infrastructure overload',
          'smart city energy forecast weather service demand problem',
          'municipal energy efficiency public assets consumption patterns',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'smart city electricity demand public buildings street lighting',
          'municipal energy consumption charging stations peak demand forecast',
          'urban infrastructure energy demand weather equipment status',
          'city public assets energy efficiency overloaded infrastructure',
          'municipal electricity demand service interruption energy cost',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'smart city electricity demand public buildings street lighting',
          'city charging station peak demand energy forecast',
          'urban infrastructure energy efficiency demand management',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [];
      }
    }

    if (constraint.kind === 'URBAN_MOBILITY_CONGESTION_EMISSIONS') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'city traffic congestion peak hour travel time transit demand',
          'urban transport route bottleneck road incident commuter delay',
          'public transit demand traffic flow congestion corridor problem',
          'traffic congestion idling fuel consumption vehicle emissions city',
          'transport agency route travel time reliability improvement priority',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'urban traffic congestion travel time vehicle emissions transport agency',
          'public transit demand road incidents traffic flow city mobility',
          'traffic bottleneck fuel consumption emissions urban corridor',
          'transport planning traffic transit air quality integrated data',
          'route congestion travel time reliability emissions improvement',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'urban traffic congestion emissions travel time',
          'public transit demand road incident congestion analysis',
          'city transport route bottleneck fuel emissions',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [];
      }
    }

    if (constraint.kind === 'ENERGY_IOT_SECURITY_DIAGNOSIS') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'smart meter anomaly device failure or cyber attack utility operator',
          'electric utility smart meter tampering unauthorized access incident',
          'power distribution telemetry network disruption device health problem',
          'utility unusual consumption meter fault malicious interference investigation',
          'smart grid incident attribution technical failure cybersecurity',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'smart meter cybersecurity tampering anomaly utility incident',
          'electric utility iot device failure network disruption incident response',
          'power distribution smart meter data integrity unauthorized access',
          'smart grid technical fault versus cyber attack incident attribution',
          'utility telemetry consumption anomaly malicious interference detection',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'smart meter tampering cybersecurity utility incident',
          'smart grid device failure network disruption anomaly',
          'energy utility technical failure versus cyber attack',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [];
      }
    }

    if (constraint.kind === 'DOLL_RESTORATION_SERVICE') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'doll restoration customer approved repair scope revision mistake',
          'antique doll restorer replacement parts fabric paint matching problem',
          'doll restoration damage photos notes material samples record keeping',
          'doll restorer wrong replacement mismatched material rework',
          'doll restoration client changes final approval delayed order',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'professional doll restoration documentation customer approval workflow',
          'antique doll restoration replacement parts material matching records',
          'doll restoration condition photos treatment notes client approval',
          'doll restoration repair scope revision material mismatch rework',
          'antique doll conservator restoration documentation parts paint fabric',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'professional doll restoration damage assessment repair documentation',
          'antique doll restoration replacement parts paint fabric matching',
          'doll restorer customer approval restoration workflow',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [];
      }
    }

    if (constraint.kind === 'RESTAURANT_DELIVERY_FRAUD') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'food delivery app refund abuse account takeover customer complaint',
          'restaurant delivery platform suspicious orders promo abuse false positive',
          'food delivery account blocked legitimate customer fraud review',
          'delivery app refund fraud device account investigation',
          'restaurant delivery coordinated abuse multiple accounts devices refunds',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'blog'
      ) {
        return [
          'food delivery platform refund abuse account takeover fraud',
          'restaurant delivery promotional abuse fraud detection false positives',
          'food delivery suspicious orders device signals payment behavior',
          'delivery platform coordinated abuse refund promotion accounts',
          'online food ordering blocked legitimate customer fraud detection',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'online food delivery fraud detection account takeover refund abuse',
          'food delivery platform device risk payment fraud false positive',
          'promotional abuse online food ordering fraud detection',
          'restaurant delivery coordinated fraud suspicious orders refunds',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'food delivery app refund abuse account takeover fraud',
          'restaurant delivery promo abuse suspicious orders',
          'food delivery false positive blocked customer fraud review',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'food delivery refund account blocked',
          'restaurant delivery refund fraud',
          'food delivery account security refund',
          'food delivery promo code account issue',
        ];
      }
      return [
        'food delivery fraud refund abuse account takeover',
        'restaurant delivery suspicious orders false positives',
      ];
    }

    if (constraint.kind === 'SHIPMENT_CHAIN_OF_CUSTODY') {
      const ecommerceDeliveryDispute =
        /\b(?:online retailers?|online stores?|e-?commerce|customer orders?|orders?|shipping|deliver(?:y|ies))\b/u.test(requestDescription) &&
        /\b(?:fraudulent delivery claims?|false delivery claims?|account misuse|account abuse|account takeover|unauthorized (?:shipping|delivery) (?:information|address) changes?|shipping address changes?|carrier scans?|delivery confirmations?|proof of delivery|refund abuse|lost merchandise|order disputes?|delivery disputes?)\b/u.test(requestDescription);

      if (ecommerceDeliveryDispute) {
        if (sourceKey === 'reddit' || sourceKey === 'forum') {
          return [
            'online retailer fraudulent delivery claim proof dispute',
            'shipping address changed after order account takeover ecommerce',
            'carrier scan delivery confirmation mismatch customer dispute',
            'refund abuse lost merchandise ecommerce delivery claim',
            'legitimate customer falsely flagged delivery fraud',
          ];
        }
        if (
          sourceKey === 'news' ||
          sourceKey === 'gdelt' ||
          sourceKey === 'crossref' ||
          sourceKey === 'blog'
        ) {
          return [
            'ecommerce delivery fraud proof of delivery refund abuse',
            'online retailer account takeover shipping address change fraud',
            'order dispute warehouse carrier scan delivery confirmation investigation',
            'retail delivery claim fraud lost merchandise refund investigation',
            'ecommerce shipping information unauthorized change account misuse',
          ];
        }
        if (sourceKey === 'youtube') {
          return [
            'ecommerce delivery fraud proof of delivery dispute',
            'shipping address account takeover order fraud',
            'carrier scan delivery confirmation refund dispute',
          ];
        }
        if (sourceKey === 'app-store' || sourceKey === 'google-play') {
          return [
            'online shopping delivery dispute refund',
            'order shipping address changed account',
            'delivery proof carrier scan dispute',
          ];
        }
      }

      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'shipment handover tampered tracking record chain of custody',
          'carrier warehouse customs custody transfer discrepancy',
          'fraudulent delivery claim missing handover proof shipment dispute',
          'altered shipment tracking history logistics dispute',
          'cargo ownership document provenance incident investigation',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'supply chain record tampering shipment chain of custody',
          'cargo custody transfer carrier customs dispute',
          'shipment tracking data integrity handover audit trail',
          'logistics fraudulent delivery claim custody records',
          'shipment provenance document integrity incident investigation',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'shipment chain of custody tampered records handover',
          'cargo tracking record integrity delivery dispute',
          'carrier warehouse customs custody audit trail',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'shipment tracking integrity',
          'delivery proof tracking',
          'cargo handover tracking',
        ];
      }
    }

    if (constraint.kind === 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'factory machine abnormal electricity consumption predictive maintenance',
          'industrial equipment energy anomaly machine condition breakdown',
          'machine power draw maintenance history production schedule',
          'plant maintenance electricity spike before equipment failure',
          'factory equipment efficiency loss energy use downtime',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'industrial equipment energy consumption condition monitoring predictive maintenance',
          'machine energy anomaly equipment degradation maintenance records',
          'factory electricity consumption equipment health downtime',
          'electric motor energy efficiency condition monitoring failure',
          'industrial machine power consumption maintenance condition monitoring',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'industrial machine energy anomaly predictive maintenance',
          'equipment power consumption condition monitoring failure',
          'factory energy efficiency machine health maintenance',
        ];
      }
      if (
        sourceKey === 'app-store' ||
        sourceKey === 'google-play' ||
        sourceKey === 'github' ||
        sourceKey === 'stackoverflow' ||
        sourceKey === 'dev-to' ||
        sourceKey === 'product-hunt' ||
        sourceKey === 'hacker-news'
      ) {
        return [];
      }
    }

    if (constraint.kind === 'MANUFACTURING_WASTE_SUSTAINABILITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'manufacturing scrap material waste production stage root cause',
          'factory scrap records machine output quality defects rework',
          'production line material loss raw material consumption problem',
          'manufacturing repeated defects scrap waste operator discussion',
          'factory energy use material waste production efficiency emissions',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'manufacturing scrap reduction material efficiency production stage study',
          'factory raw material waste defects rework production efficiency',
          'industrial manufacturing energy consumption emissions material waste',
          'manufacturing yield loss scrap quality machine output analysis',
          'production process material waste environmental impact efficiency',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'manufacturing scrap waste reduction production line defects',
          'factory material loss machine output quality rework',
          'manufacturing energy material efficiency emissions',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'manufacturing scrap tracker',
          'production waste monitor',
          'factory quality scrap',
        ];
      }
    }

    if (constraint.kind === 'CUSTOM_MOSAIC_SERVICE') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'mosaic artist client revision wrong pattern rework',
          'custom mosaic customer changed design tile color approval',
          'mosaic commission wrong dimensions installation rework',
          'mosaic maker latest approved design version customer message',
          'mosaic project wasted tile material revision mistake',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'custom mosaic commission design approval revision workflow',
          'mosaic installation design change material waste rework',
          'mosaic project specification version customer approval',
          'mosaic fabrication tile material dimension quality rework',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'mosaic commission design revision client approval',
          'mosaic installation wrong pattern rework customer changes',
          'custom mosaic tile color dimension approval workflow',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'mosaic project tracker',
          'custom commission approval',
          'design revision tracker',
        ];
      }
    }

    if (constraint.kind === 'CUSTOM_ENGRAVING_SERVICE') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'engraving shop wrong spelling placement customer order',
          'engraver artwork revision approved design version mistake',
          'custom engraving font placement material specification error',
          'laser engraving customer changes scattered messages rework',
          'engraving business wrong approved version wasted material',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'custom engraving order artwork approval revision workflow',
          'engraving shop customer specification version control',
          'laser engraving text font placement quality error rework',
          'custom personalization production approval material waste',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'engraving customer artwork approval revision mistakes',
          'laser engraving wrong spelling placement rework',
          'custom engraving order specification workflow',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'engraving order tracker',
          'custom order proof approval',
          'artwork revision tracker',
        ];
      }
    }

    if (constraint.kind === 'BUILDING_ENVIRONMENTAL_MONITORING') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'property manager building temperature humidity sensor monitoring problem',
          'apartment complex water usage leak detection maintenance delay',
          'residential building indoor air quality monitoring maintenance team',
          'property maintenance scattered sensor readings abnormal building conditions',
          'building manager humidity air quality water waste equipment readings',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'residential building environmental monitoring temperature humidity water air quality',
          'apartment building water waste leak detection sensor monitoring maintenance',
          'multi family building indoor air quality environmental performance sensors',
          'property management building condition monitoring IoT environmental sensors',
          'residential complex abnormal building conditions delayed maintenance water waste',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'building environmental monitoring temperature humidity water air quality',
          'property manager IoT sensors building conditions maintenance',
          'apartment water leak air quality sensor monitoring',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'building sensor monitor',
          'property maintenance IoT',
          'air quality water leak',
        ];
      }
    }

    if (constraint.kind === 'DELIVERY_SUSTAINABILITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'delivery fleet fuel consumption route inefficiency emissions',
          'last mile delivery unnecessary mileage fuel costs traffic',
          'courier failed delivery attempts extra mileage fuel waste',
          'delivery driver route planning fuel efficiency complaints',
          'parcel delivery traffic delays emissions fuel use',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'delivery emissions fuel consumption route efficiency',
          'last mile delivery carbon emissions traffic failed attempts',
          'fast shipping environmental impact delivery pollution',
          'courier fleet fuel use mileage carbon footprint',
          'delivery route optimization fuel efficiency emissions study',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'delivery fleet fuel consumption route efficiency emissions',
          'last mile delivery fuel waste traffic mileage',
          'courier route optimization carbon emissions',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'delivery route tracker',
          'courier route fuel',
          'last mile delivery',
        ];
      }
    }

    if (constraint.kind === 'GOVERNMENT_RECORD_ACCESS_INTEGRITY') {
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'government records unauthorized access document tampering investigation',
          'public sector legal records access log suspicious change security incident',
          'government licensing records integrity breach employee access audit',
          'citizen application record unauthorized modification compliance investigation',
          'regulatory records tampering access history public sector cybersecurity',
        ];
      }
      if (sourceKey === 'forum' || sourceKey === 'reddit') {
        return [
          'government records access logs suspicious changes investigation problem',
          'public sector document history unauthorized edit audit trail',
          'licensing record access incident who changed document',
          'government employee access sensitive records security alert investigation',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'government document security access logs record integrity incident',
          'public sector records tampering investigation audit trail',
          'government records cybersecurity suspicious access changes',
        ];
      }
      return [];
    }

    if (constraint.kind === 'CUSTOM_SPECIFICATION_SERVICE') {
      const isBridalAlterationWorkflow =
        /\b(?:bridal alteration|wedding dress alteration|alteration specialists?|alteration shops?|seamstresses?|dressmakers?|tailors?|tailoring)\b/iu.test(
          `${actor} ${requestDescription}`,
        ) &&
        /\b(?:measurements?|fittings?|alterations?|modifications?|fabric|accessories|approvals?|revisions?|pickup|deadlines?)\b/iu.test(
          requestDescription,
        );
      const isCustomFootwearWorkflow =
        /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/iu.test(
          `${actor} ${requestDescription}`,
        );
      const isHatWorkflow =
        /\b(?:hat makers?|hat maker|milliner|millinery|custom hats?|bespoke hats?|headwear)\b/iu.test(
          `${actor} ${requestDescription}`,
        );
      const isWigWorkflow =
        /\b(?:wig makers?|wig maker|custom wigs?|hairpiece makers?|hairpiece maker)\b/iu.test(
          `${actor} ${requestDescription}`,
        );

      if (isBridalAlterationWorkflow) {
        if (sourceKey === 'reddit' || sourceKey === 'forum') {
          return [
            'bridal seamstress wedding dress measurements fitting notes lost changes',
            'wedding dress alterations approved changes repeated fitting problem',
            'bridal alteration specialist customer approval fitting revision notes',
            'seamstress dress alteration wrong adjustment forgotten request fitting',
            'bridal tailor pickup deadline alteration rework fabric damage',
          ];
        }
        if (
          sourceKey === 'news' ||
          sourceKey === 'gdelt' ||
          sourceKey === 'crossref' ||
          sourceKey === 'blog'
        ) {
          return [
            'bridal alteration fitting measurements customer approval workflow',
            'wedding dress alteration revision fitting notes workflow',
            'bridal seamstress customer measurements alterations record keeping',
            'dressmaker alteration approval fabric fitting order management',
            'bridal tailor fitting revisions pickup deadline workflow',
          ];
        }
        if (sourceKey === 'youtube') {
          return [
            'bridal seamstress fitting measurements alteration notes',
            'wedding dress alterations customer approval revisions',
            'bridal tailor fitting workflow pickup deadline',
          ];
        }
        if (
          sourceKey === 'app-store' ||
          sourceKey === 'google-play' ||
          sourceKey === 'github' ||
          sourceKey === 'stackoverflow' ||
          sourceKey === 'dev-to' ||
          sourceKey === 'product-hunt' ||
          sourceKey === 'hacker-news'
        ) {
          return [];
        }
      }

      if (isCustomFootwearWorkflow) {
        if (sourceKey === 'reddit' || sourceKey === 'forum') {
          return [
            'bespoke shoemaker foot measurements fitting errors client order',
            'custom shoemaking leather sole stitching revision approval problem',
            'made to measure shoes wrong sizing repeated fitting customer',
            'cordwainer custom footwear specification material mismatch rework',
            'handmade shoe maker final approved version delayed order',
          ];
        }
        if (
          sourceKey === 'news' ||
          sourceKey === 'gdelt' ||
          sourceKey === 'crossref' ||
          sourceKey === 'blog'
        ) {
          return [
            'bespoke shoemaking client measurements fitting workflow',
            'custom footwear leather sole specification revision approval',
            'made to measure shoes fitting measurement customer records',
            'cordwainer handmade shoe order specification workflow',
            'custom shoemaker final approved specification production',
          ];
        }
        if (sourceKey === 'youtube') {
          return [
            'bespoke shoemaker foot measurement fitting custom order',
            'custom shoe leather sole stitching specification revision',
            'handmade shoe maker customer fitting approval workflow',
          ];
        }
        return [];
      }

      if (isHatWorkflow) {
        if (sourceKey === 'reddit' || sourceKey === 'forum') {
          return [
            'milliner custom hat head measurements brim dimensions fitting revision',
            'custom hat maker wrong sizing material mismatch repeated adjustment',
            'millinery client approved hat specification revision lost notes',
            'bespoke hat fitting measurement material color decoration problem',
            'custom headwear delayed order wrong approved version wasted material',
          ];
        }
        if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
          return [
            'millinery custom hat fitting measurements order workflow',
            'bespoke hat maker client specification brim material revision',
            'custom headwear customer approval sizing material records',
            'milliner made to measure hat fitting order management',
          ];
        }
        if (sourceKey === 'youtube') {
          return [
            'milliner custom hat measurements fitting client order',
            'bespoke hat brim dimensions material fitting revision',
            'custom hat maker approved specification sizing workflow',
          ];
        }
        return [];
      }

      if (isWigWorkflow) {
        if (sourceKey === 'reddit' || sourceKey === 'forum') {
          return [
            'wig maker client measurements fitting notes revision history',
            'custom wig wrong cap size repeated fitting adjustment',
            'wig maker color texture specification client order notes',
            'custom wig approved revision lost chat measurements',
            'wig fitting sizing mismatch material waste delayed order',
          ];
        }
        if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
          return [
            'custom wig fitting measurement workflow client specifications',
            'wig maker cap size color texture custom order revision',
            'wig making client consultation fitting measurement records',
            'custom hairpiece fitting revision specification workflow',
          ];
        }
        if (sourceKey === 'youtube') {
          return [
            'wig maker client fitting measurements custom order',
            'custom wig cap size color revision fitting',
            'wig making client consultation measurement notes',
          ];
        }
        if (sourceKey === 'app-store' || sourceKey === 'google-play') {
          return [];
        }
      }

      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'custom studio customer approved design revision wrong version rework',
          'commission design reference color size personalization approval mistake',
          'custom order customer instruction revision lost message repeated work',
          'studio final approved design misspelled name wrong color problem',
          'custom commission material waste revision pickup delay customer change',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'custom commission design approval revision workflow studio',
          'custom order specification version customer approval rework',
          'design reference color size personalization revision records',
          'studio customer approval wrong version material waste',
          'custom production revision control delayed order approval',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'custom commission design revision customer approval workflow',
          'studio custom order final approved design version',
          'custom painting personalization revision approval',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [];
      }
    }

    if (
      constraint.kind === 'ACADEMIC_OPERATIONS' &&
      constraint.label === 'academic staffing and teaching workload operations'
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'faculty teaching workload overload course assignment university',
          'teaching assistant workload scheduling conflict department',
          'university course staffing instructor availability enrollment',
          'academic workload allocation unfair teaching load faculty',
          'department chair course staffing student demand support',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'faculty workload allocation university course staffing',
          'teaching assistant staffing course enrollment demand',
          'higher education teaching workload scheduling conflict',
          'academic staff workload inequity course assignment',
          'university faculty staffing shortage student support',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'faculty workload course assignment university problem',
          'teaching assistant staffing workload scheduling conflict',
          'academic department teaching load allocation',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'faculty workload',
          'course staffing',
          'teaching schedule',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'pet training behavior practice'
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'dog trainer client notes behavior progress sessions',
          'pet trainer owner feedback training history',
          'animal behavior trainer triggers exercises session notes',
          'dog training repeated exercises missing history',
          'pet trainer inconsistent owner instructions routine',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'professional dog trainer client record keeping behavior progress',
          'pet training session notes owner feedback tracking',
          'animal behavior training records progress documentation',
          'dog trainer client communication training plan consistency',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'dog trainer client notes behavior progress tracking',
          'pet trainer session records owner feedback',
          'animal behavior trainer triggers training history',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'dog training tracker',
          'pet training log',
          'dog trainer client',
        ];
      }
    }

    if (constraint.kind === 'CONNECTED_ASSET_SECURITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'smart farm sensor connectivity failure operator problem',
          'agricultural iot unauthorized access device incident',
          'irrigation controller network outage farm problem',
          'farm telemetry equipment failure security alert confusion',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'smart agriculture iot cybersecurity connectivity failures',
          'farm sensor network disruption irrigation equipment failure',
          'agricultural connected device unauthorized access monitoring',
          'farm operational technology security telemetry anomaly',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'smart farm iot connectivity security problem',
          'irrigation sensor network failure unauthorized access',
          'farm device telemetry security monitoring',
        ];
      }
    }

    if (constraint.kind === 'PROFESSIONAL_EVIDENCE_RECORDS') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'antique appraiser provenance records scattered documents',
          'appraisal ownership history authenticity evidence problem',
          'provenance research conflicting records duplicate work',
          'valuation restoration history documentation problem',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref' || sourceKey === 'blog') {
        return [
          'antique appraisal provenance documentation gaps',
          'art provenance ownership history authenticity records',
          'valuation history restoration documentation inconsistency',
          'provenance chain of custody evidence appraisal',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'antique appraisal provenance documentation problem',
          'ownership history authenticity evidence appraisal',
          'provenance research record keeping valuation',
        ];
      }
    }

    if (constraint.kind === 'TOURISM_DESTINATION') {
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref')) {
        return [
          'overtourism overcrowding residents complaints destination',
          'tourism overcrowding visitor complaints destination management',
          'tourist attraction congestion seasonal demand local community',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'overtourism crowded destination local residents complaints',
          'tourism overcrowding visitor complaints destination',
          'tourist attraction overcrowding public transport problem',
        ];
      }
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'overtourism overcrowding local residents complaints',
          'tourism overcrowding visitor experience complaints',
          'tourist destination crowding public transport problem',
        ];
      }
      if (sourceKey === 'blog') {
        return [
          'overtourism destination overcrowding visitor management problem',
          'tourism seasonal demand visitor feedback resource allocation',
          'tourism crowd management local community visitor flow',
        ];
      }
    }

    if (constraint.kind === 'RENEWABLE_ASSET_PERFORMANCE') {
      if (sourceKey === 'forum' || sourceKey === 'reddit') {
        return [
          'solar asset manager underperformance downtime maintenance revenue problem',
          'wind farm O&M poor financial return power price maintenance cost',
          'renewable asset performance technical versus financial root cause',
          'solar wind portfolio inaccurate revenue forecast downtime weather',
          'renewable project maintenance spending asset prioritization problem',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'renewable asset underperformance financial returns downtime maintenance electricity prices',
          'solar wind project profitability technical performance financing costs weather',
          'wind farm availability maintenance cost power prices financial performance',
          'solar asset revenue forecast equipment downtime weather electricity market',
          'renewable portfolio asset performance root cause technical financial conditions',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'renewable energy asset performance financial return downtime maintenance weather',
          'solar photovoltaic project techno economic performance maintenance electricity price',
          'wind farm economic performance availability downtime maintenance cost',
          'renewable asset revenue forecasting weather power price operational performance',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'solar asset underperformance maintenance downtime revenue forecast',
          'wind farm O&M financial performance power price downtime',
          'renewable asset technical financial performance analysis',
        ];
      }
      if (sourceKey === 'dev-to' || sourceKey === 'github' || sourceKey === 'stackoverflow') {
        return [
          'renewable asset performance data integration SCADA financial analytics',
          'solar wind performance anomaly operational financial reconciliation',
          'renewable energy monitoring downtime weather revenue analytics',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play' || sourceKey === 'product-hunt') {
        return [
          'renewable asset performance monitoring solar wind operations',
          'solar wind portfolio performance analytics maintenance downtime',
        ];
      }
    }

    if (constraint.kind === 'PROPERTY_ASSET_PERFORMANCE') {
      const maintenanceCostForecasting =
        /\b(?:predict|prediction|predictive|forecast|forecasting|rising maintenance|maintenance costs?|repair histories?|repair costs?|tenant complaints?|building age|contractor expenses?|deterioration|renovation|property budgets?|budget variance|unexpected repair bills?)\w*\b/iu.test(
          requestDescription,
        );

      if (maintenanceCostForecasting && sourceKey === 'crossref') {
        return [
          'building maintenance cost prediction deterioration',
          'property maintenance expenditure forecasting building age',
          'building repair cost forecasting maintenance history',
          'facility deterioration predictive maintenance operating cost',
          'building lifecycle maintenance cost contractor expenditure',
        ];
      }
      if (
        maintenanceCostForecasting &&
        (sourceKey === 'news' || sourceKey === 'gdelt')
      ) {
        return [
          'property managers unexpected maintenance repair costs budget',
          'building maintenance costs tenant complaints property management',
          'landlords unexpected repair bills property budget',
          'property management maintenance expenses profitability deterioration',
          'building repair costs renovation budget property managers',
        ];
      }
      if (
        maintenanceCostForecasting &&
        (sourceKey === 'reddit' || sourceKey === 'forum')
      ) {
        return [
          'property manager unexpected maintenance costs repair budget problem',
          'landlord repair bills maintenance expenses profitability problem',
          'property management tenant complaints maintenance cost tracking',
          'building repair history contractor costs budget problem',
          'property manager renovation timing unexpected repair costs',
        ];
      }
      if (maintenanceCostForecasting && sourceKey === 'blog') {
        return [
          'property management maintenance cost forecasting workflow problem',
          'building repair history budget forecasting property management',
          'predictive maintenance real estate operating expenses',
          'property maintenance budget variance contractor costs',
        ];
      }
      if (maintenanceCostForecasting && sourceKey === 'youtube') {
        return [
          'property management maintenance cost forecasting',
          'landlord unexpected repair costs property budget',
          'building maintenance expenses property profitability',
        ];
      }

      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref')) {
        return [
          'rental property profitability rental income maintenance vacancy financing',
          'property investment returns mortgage interest operating expenses vacancy',
          'real estate portfolio NOI cash flow maintenance vacancy',
          'rental property local market rent change return estimate',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'rental property cash flow maintenance vacancy financing costs',
          'property investment profitability NOI operating expenses vacancy',
          'landlord mortgage interest maintenance lower returns',
          'real estate investment return estimate market rent vacancy',
        ];
      }
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'property investor rental income expenses vacancy cash flow problem',
          'rental property maintenance mortgage vacancy lower profit',
          'landlord unexpected expenses financing costs returns',
          'property management data silo rent expenses vacancy profitability',
        ];
      }
      if (sourceKey === 'blog') {
        return [
          'rental property profitability analysis rent expenses vacancy financing',
          'real estate portfolio NOI cash flow vacancy maintenance costs',
          'property investment returns local market financing expenses',
          'rental asset declining performance unexpected expenses',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'property management maintenance',
          'rental property expenses',
          'property manager operations',
        ];
      }
    }

    if (constraint.kind === 'PUBLIC_HEALTH_DEMAND_CAPACITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'hospital staff rising patient demand waiting times capacity pressure',
          'public health appointment volume surge staffing shortage',
          'emergency department crowding community demand resource allocation',
          'clinic overload appointment backlog staff availability',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          'public healthcare rising demand hospital capacity pressure',
          'emergency visit trends hospital overload regional demand',
          'appointment volume surge clinic capacity staffing shortage',
          'health service demand forecasting resource allocation waiting times',
        ];
      }
      if (sourceKey === 'blog' || sourceKey === 'youtube') {
        return [
          'public health demand forecasting hospital capacity planning',
          'healthcare demand early warning appointment emergency visit trends',
          'hospital capacity planning community demand resource distribution',
          'clinic demand surge staffing waiting time forecasting',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'hospital appointment wait time',
          'clinic appointment availability',
          'health service demand',
        ];
      }
    }

    if (
      constraint.kind === 'HEALTHCARE_OPERATIONS' &&
      constraint.label === 'hospital supply inventory operations'
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'hospital medical supply shortage inventory problem',
          'hospital expired supplies inventory waste',
          'blood product shortage hospital emergency request',
          'pharmacy inventory stockout hospital clinical unit',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          'hospital medical supply inventory shortage stockout',
          'hospital inventory expiration expired supplies waste',
          'blood product inventory shortage emergency hospital',
          'hospital supplier delivery delay medical supplies',
        ];
      }
      if (sourceKey === 'blog' || sourceKey === 'youtube') {
        return [
          'hospital department inventory disconnected systems stockout',
          'pharmacy inventory expiration hospital clinical units',
          'hospital supply reorder emergency purchase shortage',
          'medical supply inventory waste expired products hospital',
        ];
      }
    }

    if (
      constraint.kind === 'HEALTHCARE_OPERATIONS' &&
      constraint.label === 'hospital medical equipment operations'
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'hospital staff searching for medical equipment',
          'missing medical equipment hospital department',
          'medical device unavailable operating room delay',
          'biomedical equipment location tracking problem',
        ];
      }
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref')) {
        return [
          'hospital medical equipment tracking delays',
          'hospital asset tracking maintenance status',
          'medical device utilization hospital inventory',
          'hospital equipment availability procedure delay',
        ];
      }
      if (sourceKey === 'blog') {
        return [
          'hospital equipment tracking maintenance workflow problem',
          'biomedical engineering medical equipment location tracking',
          'hospital device utilization availability inventory problem',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'hospital medical equipment tracking problem',
          'hospital staff searching for medical devices',
          'medical equipment maintenance availability hospital',
        ];
      }
    }

    if (constraint.kind === 'DIGITAL_TRUST_SAFETY') {
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'marketplace seller fraud',
          'online shopping fake seller',
          'marketplace account restriction',
        ];
      }
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') || sourceKey === 'blog') {
        return [
          'online marketplace fake seller fraud problem',
          'ecommerce fraudulent reviews suspicious listings',
          'marketplace coordinated fraud legitimate seller false positive',
          'online marketplace trust safety seller restriction',
        ];
      }
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'marketplace fake seller scam complaint',
          'online seller fraudulent review problem',
          'legitimate seller falsely restricted marketplace',
          'suspicious product listing marketplace fraud',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'online marketplace fake seller fraud',
          'ecommerce fake reviews suspicious listings problem',
          'marketplace seller restriction false positive',
        ];
      }
    }

    if (constraint.kind === 'RESTAURANT_ENERGY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'restaurant owner high utility bill equipment energy use',
          'commercial kitchen refrigeration energy waste problem',
          'kitchen ventilation cooking equipment energy cost',
          'restaurant equipment electricity consumption spike',
        ];
      }
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') || sourceKey === 'blog') {
        return [
          'commercial kitchen energy waste refrigeration ventilation',
          'restaurant equipment energy consumption utility costs',
          'commercial kitchen energy efficiency equipment monitoring',
          'restaurant gas electricity waste operating hours',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'commercial kitchen energy waste equipment usage',
          'restaurant refrigeration ventilation energy cost problem',
          'restaurant utility bill equipment energy consumption',
        ];
      }
    }

    if (constraint.kind === 'RESIDENTIAL_CLEANING') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'house cleaning business missed client instructions',
          'residential cleaning recurring appointments scheduling conflict',
          'cleaners room specific instructions forgotten customer request',
          'cleaning business employee assignment supplies schedule changes',
        ];
      }
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') || sourceKey === 'blog') {
        return [
          'residential cleaning business scheduling coordination problem',
          'house cleaning client instructions employee assignments',
          'cleaning service missed tasks inconsistent quality',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'cleaning business scheduling customer instructions problem',
          'house cleaning recurring appointments staff assignment',
          'cleaner room instructions supplies missed tasks',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.requiredAnchors.some((anchor) =>
        /\b(?:picture framing|framing shop|frame shop|custom frame|framer)\b/u.test(
          this.normalize(anchor),
        ),
      )
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'picture framing shop wrong measurements remake',
          'custom framing glass moulding order change problem',
          'framing shop paper order form customer changes',
          'picture framer material shortage delayed order',
        ];
      }
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') || sourceKey === 'blog') {
        return [
          'picture framing order management measurement errors',
          'custom framing material waste remake wrong dimensions',
          'framing shop customer order changes paper records',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'picture framing measurement mistakes wasted material',
          'custom framing shop order tracking customer changes',
          'frame shop glass moulding selection order problem',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'costume rental wardrobe operations'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'hacker-news') {
        return [
          'costume rental double booking wrong size customer',
          'costume shop missing accessories reservation problem',
          'formalwear rental measurement fitting wrong size',
          'theatrical wardrobe costume return damage tracking',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          'costume rental inventory reservation errors double booking',
          'formalwear rental wrong size alteration pickup delay',
          'clothing rental garment damage return tracking',
          'theatrical costume inventory missing accessories',
        ];
      }
      if (sourceKey === 'blog' || sourceKey === 'youtube') {
        return [
          'costume rental shop reservation measurement workflow problem',
          'theater wardrobe missing costume accessories tracking',
          'tuxedo rental fitting alteration reservation mistake',
          'dress rental return condition damage tracking problem',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'cake decorator studio'
    ) {
      if (sourceKey === 'forum' || sourceKey === 'hacker-news') {
        return [
          'cake decorator missed customer revision wrong design',
          'custom cake allergy note forgotten order mistake',
          'home baker customer details scattered messages rework',
          'wedding cake last minute design change pickup delay',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          'custom cake order mistakes allergy revision design',
          'cake decorator customer specification errors wasted ingredients',
          'bakery custom order revision communication problem',
          'cake business dietary requirement order error rework',
        ];
      }
      if (sourceKey === 'blog' || sourceKey === 'youtube') {
        return [
          'cake decorator order tracking customer revisions problem',
          'custom cake design reference allergy notes workflow mistake',
          'home baker custom order last minute change rework',
          'cake decorating customer approval version pickup delay',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'upholstery workshop'
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'upholstery shop lost fabric sample customer notes',
          'upholsterer wrong furniture measurement rework',
          'upholstery fabric order mistake customer change',
          'upholstery material shortage delayed furniture delivery',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          'upholstery workshop fabric order measurement errors',
          'custom upholstery material waste wrong measurements',
          'upholstery shop customer design changes paper records',
          'upholstery furniture delivery delay material shortage',
        ];
      }
      if (sourceKey === 'blog' || sourceKey === 'youtube') {
        return [
          'upholstery project fabric sample tracking problem',
          'upholstery customer measurements design change workflow',
          'upholstery work order material quantity mistake',
          'upholstery promised completion date delay',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'custom craft workshop'
    ) {
      const craftActor = constraint.requiredAnchors[0] || actor || 'custom craft workshop';
      if (sourceKey === 'forum' || sourceKey === 'hacker-news') {
        return [
          `${craftActor} custom order wrong specification revision`,
          `${craftActor} customer design changes scattered messages`,
          `${craftActor} wrong material missed customization rework`,
          `${craftActor} approved version order details mistake`,
          `${craftActor} dimensions hardware engraving deadline problem`,
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') {
        return [
          `${craftActor} custom order errors material waste revisions`,
          `${craftActor} production mistakes customer specifications`,
          `${craftActor} order management design revision delays`,
          `${craftActor} customization errors wasted materials rework`,
        ];
      }
      if (sourceKey === 'blog' || sourceKey === 'youtube') {
        return [
          `${craftActor} custom order tracking design revisions problem`,
          `${craftActor} customer specification approval workflow mistake`,
          `${craftActor} material hardware engraving instructions missed`,
          `${craftActor} scattered notes messages wrong order rework`,
          `${craftActor} final approved design version deadline delay`,
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'miniature model commission studio'
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'dollhouse maker custom commission dimensions revision material mistake',
          'dollhouse miniature furniture customer specification approval',
          'miniature model commission customer approved version revision',
          'scale model maker wrong proportions customer specification rework',
          'dollhouse maker wrong dimensions mismatched materials delayed commission',
        ];
      }
      if (
        sourceKey === 'news' ||
        sourceKey === 'gdelt' ||
        sourceKey === 'crossref' ||
        sourceKey === 'blog'
      ) {
        return [
          'dollhouse custom commission dimensions material revision approval',
          'dollhouse maker customer specifications material waste design changes',
          'custom miniature commission specification approval revision workflow',
          'scale model customer dimensions proportions rework',
          'miniature maker customer approval production errors wasted material',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'dollhouse maker customer dimensions design revision mistakes',
          'dollhouse miniature furniture material paint approval changes',
          'miniature commission customer approval revision mistakes',
          'scale model wrong proportions reference image paint details',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'custom commission tracker',
          'model approval revisions',
          'project specification tracker',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.requiredAnchors.some((anchor) =>
        /\b(?:guitar|guitar repair|luthier|instrument repair)\b/u.test(
          this.normalize(anchor),
        ),
      )
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'luthier lost setup notes repair history',
          'guitar repair shop customer setup preferences service records',
          'guitar technician repeated inspection previous repair history',
          'guitar repair wrong replacement parts customer notes',
          'luthier scattered photos receipts customer messages',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'luthier shop workflow repair history setup notes',
          'guitar repair customer setup preferences service records',
          'guitar repair shop intake parts tracking',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt') {
        return [
          'guitar repair shop service records customer preferences',
          'luthier repair history work order records',
          'guitar repair workshop parts tracking customer intake',
        ];
      }
      if (sourceKey === 'blog') {
        return [
          'luthier repair records customer setup preferences',
          'guitar repair shop service history paper notes',
          'guitar repair intake parts tracking customer records',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'musical instrument repair service records workflow',
          'guitar maintenance service history repair records',
          'instrument repair customer preference documentation',
        ];
      }
    }

    if (
      constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' &&
      constraint.label === 'eyeglass frame repair history parts fit and pickup operations'
    ) {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'eyeglass frame repair wrong hinge repeated adjustment customer fit',
          'glasses repair shop lost repair history pickup delay',
          'eyewear repair replacement hinge color matching customer preference',
          'optical frame repair previous repairs adjustment notes problem',
          'eyeglass repair incorrect replacement part repeated adjustment',
        ];
      }
      if (sourceKey === 'youtube' || sourceKey === 'blog') {
        return [
          'eyeglass frame repair hinge replacement fit adjustment history',
          'glasses repair color matching replacement parts pickup delay',
          'eyewear repair workshop repair history customer fit preferences',
          'optical frame repair repeated adjustment previous repair notes',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt') {
        return [
          'eyeglass repair shop replacement parts repair history',
          'optical frame repair customer pickup delay parts',
          'eyewear repair repeated adjustments fit preferences',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'spectacle frame repair hinge replacement adjustment',
          'eyeglass frame repair material color matching',
          'optical frame maintenance repair history',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [];
      }
    }

    if (constraint.kind === 'PHYSICAL_SERVICE_VERTICAL' && actor) {
      const actorVariants = this.buildPhysicalActorVariants(actor, constraint.requiredAnchors);
      const firstActor = actorVariants[0] ?? actor;
      const secondActor = actorVariants[1] ?? firstActor;
      const thirdActor = actorVariants[2] ?? firstActor;
      const isJewelryRepair = constraint.requiredAnchors.some((anchor) =>
        /\b(?:jewelry|jewellery)\b/u.test(this.normalize(anchor)),
      );

      if (isJewelryRepair) {
        if (sourceKey === 'youtube') {
          return [
            'jewelry repair customer dispute',
            'jeweler repair estimate dispute',
            'jewelry repair lost item complaint',
            'jewelry repair customer approval problem',
          ];
        }
        if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref')) {
          return [
            'jewelry repair dispute customer item',
            'jeweler lost customer jewelry repair',
            'jewelry repair estimate complaint',
            'jewelry repair wrong modification dispute',
          ];
        }
        if (sourceKey === 'reddit' || sourceKey === 'forum') {
          return [
            'jewelry repair shop lost item',
            'jeweler repair customer approval dispute',
            'jewelry repair estimate misunderstanding',
            'jewelry repair item condition dispute',
          ];
        }
        if (sourceKey === 'blog') {
          return [
            'jewelry repair intake customer approval dispute',
            'jewelry repair item condition documentation',
            'jeweler repair ticket lost item prevention',
          ];
        }
      }

      if (sourceKey === 'youtube') {
        return [
          `${firstActor} work order paper tickets problem`,
          `${secondActor} delayed pickup parts tracking problem`,
          `${thirdActor} customer approval technician notes problem`,
        ];
      }
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref')) {
        return [
          `${firstActor} work order tracking paper records`,
          `${secondActor} parts delay customer pickup`,
          `${thirdActor} repair status customer service problem`,
        ];
      }
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          `${firstActor} lost repair ticket customer pickup`,
          `${secondActor} work order parts tracking problem`,
          `${thirdActor} technician notes customer approval problem`,
        ];
      }
      if (sourceKey === 'blog') {
        return [
          `${firstActor} work order management paper tickets`,
          `${secondActor} parts tracking delayed pickup workflow`,
          `${thirdActor} repair status customer handoff problem`,
        ];
      }
    }

    if (constraint.kind === 'ENTERPRISE_IDENTITY_ACCESS_GOVERNANCE') {
      if (sourceKey === 'crossref') {
        return [
          'identity governance employee offboarding deprovisioning study',
          'privilege creep role change access review enterprise',
          'orphaned accounts employee lifecycle security risk',
          'joiner mover leaver access management audit',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'former employee account still active security risk',
          'employee offboarding delayed account deprovisioning',
          'privilege creep department transfer access audit',
          'orphaned employee accounts unauthorized access investigation',
        ];
      }
      if (sourceKey === 'youtube' || sourceKey === 'reddit') {
        return [
          'employee offboarding account access not removed',
          'role change old permissions still active',
          'joiner mover leaver access management problem',
          'privilege creep employee transfer security problem',
        ];
      }
      return [
        'employee role transition access review deprovisioning',
        'orphaned accounts stale employee permissions',
        'identity governance privilege creep access lifecycle',
        'hr directory permissions reconciliation account removal',
      ];
    }

    if (constraint.kind === 'ENTERPRISE_POLICY') {
      return [
        'hr employee handbook outdated policy departments',
        'employment leave rules conflict compliance risk',
        'regulatory policy updates inconsistent departments',
        'hr repeated employee policy questions manual review',
      ];
    }

    if (constraint.kind === 'FINANCIAL_OPERATIONS') {
      return [
        'payment verification delay fraud investigation',
        'unauthorized transfer dispute frozen account',
        'suspicious transaction investigation fragmented systems',
        'false positive account restriction fraud detection',
      ];
    }

    if (constraint.kind === 'AGRICULTURE_EXPORT_PROFITABILITY') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'fresh produce exporter transport delay spoilage profit margin problem',
          'agricultural exporter storage cost market price shipment profitability',
          'produce export warehouse expense supplier payment sales revenue reconciliation',
          'fresh produce route profitability logistics cost spoilage exporter',
          'agricultural exporter inaccurate profit estimate delivery delay storage cost',
          'produce exporter distribution stage financial loss cold chain',
        ];
      }
      if (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog') {
        return [
          'fresh produce export cold chain delay spoilage financial loss',
          'agricultural exporter logistics costs storage costs market prices profitability',
          'produce shipment spoilage warehouse cost route profitability',
          'fresh produce exporter transport delay sales revenue margin',
          'agricultural export market price volatility logistics profitability',
          'postharvest losses fresh produce export supply chain cost profitability',
        ];
      }
      if (sourceKey === 'crossref') {
        return [
          'fresh produce export supply chain profitability postharvest loss logistics cost',
          'cold chain fresh produce spoilage economic loss transportation',
          'agricultural export price volatility transport storage cost profitability',
          'perishable food supply chain route cost spoilage margin',
          'postharvest loss market price agricultural exporter revenue',
        ];
      }
      if (sourceKey === 'youtube') {
        return [
          'fresh produce export cold chain spoilage logistics cost',
          'agricultural exporter shipment profitability transport delays',
          'produce export storage cost market price profit',
          'fresh produce distribution losses route profitability',
        ];
      }
      if (sourceKey === 'app-store' || sourceKey === 'google-play') {
        return [
          'fresh produce shipment logistics',
          'cold chain produce export',
        ];
      }
      return [
        'agricultural export logistics profitability spoilage',
        'fresh produce shipment cost margin',
      ];
    }

    if (constraint.kind === 'AGRICULTURE_LOGISTICS') {
      if (sourceKey === 'reddit' || sourceKey === 'forum') {
        return [
          'farm cooperative produce spoilage transport delay',
          'fresh produce cold chain temperature problem',
          'farm harvest storage shipment coordination problem',
          'produce delivery partial loads transport cost',
        ];
      }
      if ((sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref')) {
        return [
          'fresh produce cold chain spoilage transportation delay',
          'agricultural cooperative logistics storage capacity',
          'produce shipment temperature tracking quality loss',
          'farm transport costs partially empty deliveries',
        ];
      }
      if (sourceKey === 'youtube' || sourceKey === 'blog') {
        return [
          'agricultural cooperative harvest logistics problem',
          'fresh produce cold storage transport coordination',
          'produce temperature shipment tracking spoilage',
        ];
      }
    }

    if (constraint.kind === 'INDUSTRIAL_OPERATIONS') {
      return [
        'manufacturing raw material delay production disruption',
        'factory inventory mismatch production schedule',
        'supplier delivery delay manufacturing bottleneck',
        'warehouse stock mismatch production planning',
      ];
    }

    return [];
  }

  private static buildSpecializedQueries(
    description: string,
    domainName: string,
  ): string[] {
    const text = `${description} ${domainName}`.trim();


    const hospitalOperatingRoomCoordination =
      /\b(?:hospital|hospitals|healthcare|medical center|medical centers)\b/u.test(text) &&
      /\b(?:operating rooms?|operating theatres?|operating theaters?|surgical suites?|surgery schedules?|surgical schedules?|surgeries|procedures)\b/u.test(text) &&
      /\b(?:staffing|medical staff|surgeons?|nurses?|equipment availability|urgent patients?|emergency cases?|resource allocation|room turnover|reschedul|idle operating rooms?|delayed procedures?|schedule conflicts?)\w*\b/u.test(text);
    if (hospitalOperatingRoomCoordination) {
      return [
        'hospital operating room scheduling staff equipment emergency cases',
        'surgery schedule conflict medical staff equipment availability',
        'operating room utilization idle room resource allocation hospital',
        'urgent surgery rescheduling operating room staff availability',
        'operating room turnover delay staffing equipment bottleneck',
        'surgical suite schedule disruption emergency case hospital',
      ];
    }

    const tattooDesignApproval =
      /\b(?:independent tattoo artists?|tattoo artists?|tattoo studios?|tattoo shops?|tattooists?)\b/u.test(text) &&
      /\b(?:design references?|reference images?|placement preferences?|size requirements?|dimensions?|color choices?|colour choices?|stencils?|revision requests?|design revisions?|approved design|approved version|final approved|appointment details?|aftercare notes?|client records?)\b/u.test(text);
    if (tattooDesignApproval) {
      return [
        'tattoo artist client design references scattered messages revisions',
        'tattoo artist placement size color revision client approval',
        'tattoo stencil approved design version appointment problem',
        'tattoo consultation client reference photos revision history',
        'tattoo artist final design approval wrong version rework',
        'tattoo client messages sketches appointment aftercare records',
      ];
    }

    const academicStaffing =
      /\b(?:universities|university departments?|academic departments?|department chairs?|faculty planners?|academic planners?|higher education)\b/u.test(text) &&
      /\b(?:instructors?|teaching assistants?|academic support staff|faculty workload|teaching workload|course staffing|course assignments?|student demand|course enrollment|staff availability|scheduling conflicts?|overloaded staff)\b/u.test(text);
    if (academicStaffing) {
      return [
        'faculty workload course assignment overload university',
        'teaching assistant workload scheduling conflict',
        'university course staffing instructor availability enrollment',
        'academic teaching load allocation faculty inequity',
        'department chair staffing student demand support',
        'higher education fragmented staffing enrollment schedule data',
      ];
    }

    const petTraining =
      /\b(?:independent pet trainers?|pet trainers?|dog trainers?|animal trainers?|behavior trainers?|behaviour trainers?|pet behavior consultants?|pet behaviour consultants?)\b/u.test(text) &&
      /\b(?:behavioral problems?|behavioural problems?|training exercises?|progress between sessions?|owner feedback|triggers?|recommended routines?|training sessions?|behavior history|behaviour history)\b/u.test(text);
    if (petTraining) {
      return [
        'dog trainer client notes behavior progress sessions',
        'pet trainer owner feedback training history tracking',
        'animal behavior trainer triggers exercises records',
        'dog training repeated exercises missing session history',
        'pet trainer scattered notes messages owner instructions',
        'pet behavior consultant progress routine tracking',
      ];
    }

    const energyIotSecurityDiagnosis =
      /\b(?:energy providers?|electric utilities?|power utilities?|utility companies?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid)\b/u.test(text) &&
      /\b(?:connected meters?|smart meters?|remote monitoring devices?|automated control systems?|device failures?|unusual consumption|consumption anomalies?|network disruptions?|unauthorized access|malicious interference|telemetry|consumption data integrity|incident response)\b/u.test(text);
    if (energyIotSecurityDiagnosis) {
      return [
        'smart meter anomaly cyberattack or device failure',
        'utility smart meter tampering unauthorized access incident',
        'power distribution iot device failure network disruption',
        'smart meter inaccurate readings cybersecurity incident',
        'energy utility distinguish equipment failure from cyber attack',
        'connected meter security anomaly consumption data integrity',
      ];
    }

    const dollRestorationService =
      /\b(?:independent doll restoration specialists?|doll restoration specialists?|doll restorers?|doll restoration studios?|doll restoration workshops?|antique doll restorers?|doll repair specialists?)\b/u.test(text) &&
      /\b(?:customer requests?|damage photographs?|damage photos?|fabric selections?|replacement parts?|paint matching|restoration notes?|approved restoration|material samples?|completion dates?|incorrect replacements?|mismatched materials?|repeated work|lost details|delayed customer orders?)\b/u.test(text);
    if (dollRestorationService) {
      return [
        'doll restoration customer approved repair scope revision',
        'antique doll restoration damage photos replacement parts records',
        'doll restorer fabric selection paint matching customer approval',
        'doll restoration wrong replacement mismatched material rework',
        'doll restoration scattered notes photos material samples lost details',
        'doll restoration delayed order revision completion date problem',
      ];
    }

    const publicHealthDemandCapacity =
      /\b(?:public healthcare agencies?|public health agencies?|health departments?|health authorities?|healthcare agencies?|hospitals?|clinics?)\b/u.test(text) &&
      /\b(?:rising demand|service demand|healthcare demand|medical service demand|appointment volumes?|emergency visits?|regional health reports?|community healthcare needs?|community health needs?|hospitals? become overloaded|clinics? become overloaded|capacity pressure|waiting times?|resource availability|resource distribution|staff shortages?|demand forecasting|surge detection)\b/u.test(text);
    if (publicHealthDemandCapacity) {
      return [
        'public healthcare rising service demand hospital capacity pressure',
        'appointment volume surge clinic staffing resource availability',
        'emergency visit trends hospital overload community demand',
        'regional health demand waiting times resource distribution',
        'health agency community medical service demand forecasting',
        'hospital clinic capacity pressure appointment emergency visit trends',
      ];
    }

    const hospitalSupply =
      /\b(?:hospital|hospitals|healthcare|clinical units?|pharmacy|medical)\b/u.test(text) &&
      /\b(?:medical supplies?|clinical supplies?|medical inventory|supply inventory|stock levels?|stockouts?|blood products?|pharmacy inventory|expiration|expiry|expired products?|supplier deliveries?|emergency supply requests?|reorder|medical supply chain)\b/u.test(text);
    if (hospitalSupply) {
      return [
        'hospital medical supply inventory shortage stockout',
        'hospital inventory expiration expired supplies waste',
        'blood product inventory shortage emergency hospital',
        'pharmacy inventory expiration hospital clinical units',
        'hospital department supply chain disconnected inventory systems',
        'medical supply supplier delivery delay hospital',
      ];
    }

    const hospitalEquipment =
      /\b(?:hospital|hospitals|healthcare|biomedical engineering|clinical engineering|medical)\b/u.test(text) &&
      /\b(?:medical equipment|medical devices?|equipment tracking|device tracking|asset tracking|equipment location|maintenance status|equipment availability|device availability|utilization|departmental movement|storage rooms?|operating rooms?)\b/u.test(text);
    if (hospitalEquipment) {
      return [
        'hospital staff searching for medical equipment',
        'hospital medical equipment unavailable procedure delay',
        'medical equipment location tracking hospital departments',
        'hospital device maintenance status availability',
        'medical equipment utilization hospital inventory',
      ];
    }

    const frameRestoration =
      /\b(?:independent )?(?:frame restoration specialists?|picture frame restorers?|frame restorers?|antique frame restorers?|gilded frame restorers?|frame conservation specialists?|picture frame restoration workshops?|frame restoration workshops?)\b/u.test(text) &&
      /\b(?:damaged frames?|material selections?|decorative details?|repair notes?|finish preferences?|customer approvals?|approved restoration|completion dates?|promised completion dates?|photographs?|handwritten notes?|physical samples?|incorrect finishes?|repeated repairs?|lost design details?|wasted materials?|delayed customer orders?)\b/u.test(text);
    if (frameRestoration) {
      return [
        'frame restorer customer approval finish repair notes',
        'antique picture frame restoration treatment documentation',
        'gilded frame restoration material finish client approval',
        'frame restoration scattered photos notes physical samples',
        'picture frame restoration wrong finish repeated repair',
        'frame conservator decorative details completion delay',
      ];
    }

    const artRestoration =
      /\b(?:art restoration|art conservation|conservation studio|conservation workshop|conservator|conservators|painting restoration|artifact conservation)\b/u.test(text) &&
      /\b(?:condition|treatment|previous repairs?|materials?|client instructions?|restoration stages?|deadlines?|photographs?|handwritten notes?|treatment history|documentation|records?)\b/u.test(text);
    if (artRestoration) {
      return [
        'art conservator condition report documentation problem',
        'art restoration treatment records scattered notes photographs',
        'conservation workshop previous repairs treatment history missing',
        'art conservator materials treatment documentation problem',
        'art restoration client instructions deadline tracking',
      ];
    }

    const connectedAssetSecurity =
      /\b(?:farms?|farm operators?|agriculture|factories|industrial plants?|facilities|warehouses?|utilities|greenhouses?|irrigation systems?)\b/u.test(text) &&
      /\b(?:connected devices?|iot|internet of things|sensors?|telemetry|remote monitoring|irrigation controllers?|automated feeding|connectivity failures?|network disruption|unauthorized access|security alerts?|equipment failures?|device behavior)\b/u.test(text);
    if (connectedAssetSecurity) {
      return [
        'smart farm sensor connectivity failure monitoring',
        'agricultural iot unauthorized device access incident',
        'irrigation controller network outage equipment failure',
        'farm telemetry device health security alert correlation',
        'connected farm equipment malicious activity network disruption',
        'remote farm monitoring sensor failure unauthorized access',
      ];
    }

    const professionalEvidenceRecords =
      /\b(?:appraisers?|valuers?|genealogists?|genealogy researchers?|family historians?|archivists?|researchers?|conservators?|provenance researchers?|auction specialists?|artifact historians?)\b/u.test(text) &&
      /\b(?:provenance|chain of custody|ownership history|authenticity|valuations?|restoration details?|historical certificates?|family records?|research notes?|source citations?|evidence trail|conflicting records?|scattered records?|auction catalogs?|duplicated research|inconsistent valuations?|missed relationships?)\b/u.test(text);
    if (professionalEvidenceRecords) {
      return [
        'appraiser provenance records scattered documentation problem',
        'ownership history authenticity evidence gaps appraisal',
        'valuation history restoration records inconsistency',
        'chain of custody documentation antique appraisal',
        'provenance research duplicated work conflicting records',
        'professional research source citations scattered archives',
      ];
    }

    const agriculturalExportProfitability =
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export(?:ers?| companies?| businesses?))\b/u.test(description) &&
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|market prices?|product spoilage|produce spoilage|shipment profitability|profit margins?|profit estimates?|supplier payments?|sales revenues?|financial losses?)\b/u.test(description);
    if (agriculturalExportProfitability) {
      return [
        'fresh produce exporter transport delay spoilage profitability',
        'agricultural exporter storage cost market price profit margin',
        'produce export warehouse expense supplier payment sales revenue',
        'fresh produce cold chain financial loss logistics cost',
        'agricultural export route profitability spoilage distribution stage',
        'produce exporter inaccurate profit estimate logistics costs',
      ];
    }

    const agricultureLogistics =
      /\b(?:agricultural cooperatives?|farm cooperatives?|farmers? cooperatives?|agriculture|farms?|fresh produce|produce growers?|cold storage)\b/u.test(text) &&
      /\b(?:harvest(?:ing)?|storage|temperature|cold chain|shipment|transportation|delivery|spoilage|transport costs?|storage capacity|logistics)\b/u.test(text);
    if (agricultureLogistics) {
      return [
        'farm cooperative produce spoilage transport delay',
        'fresh produce cold chain temperature tracking problem',
        'agricultural harvest storage shipment coordination',
        'produce delivery partial loads transport cost',
        'farm logistics storage capacity delivery delay',
      ];
    }

    const restaurantEnergy =
      /\b(?:restaurants?|commercial kitchens?|restaurant kitchens?|food service kitchens?|kitchen managers?|restaurant managers?)\b/u.test(text) &&
      /\b(?:electricity|gas|energy consumption|utility bills?|utility costs?|refrigeration|cooking equipment|ventilation|lighting|heating|equipment usage|equipment runtime|energy waste|energy efficiency|carbon|emissions?|environmental impact|consumption spikes?|energy monitoring)\b/u.test(text);
    if (restaurantEnergy) {
      return [
        'restaurant high utility bill equipment energy use',
        'commercial kitchen refrigeration energy waste problem',
        'restaurant ventilation cooking equipment energy cost',
        'commercial kitchen equipment consumption spike',
        'restaurant energy monitoring operating hours waste',
        'kitchen energy efficiency utility cost equipment',
      ];
    }

    const residentialCleaning =
      /\b(?:home[- ]cleaning businesses?|home cleaning businesses?|residential cleaning businesses?|residential cleaning services?|house cleaning businesses?|house cleaning services?|cleaning companies?|cleaning teams?)\b/u.test(text) &&
      /\b(?:customer preferences?|recurring appointments?|recurring bookings?|room[- ]specific instructions?|room instructions?|employee assignments?|cleaner assignments?|cleaning supplies?|last[- ]minute schedule changes?|schedule changes?|missed tasks?|scheduling conflicts?|forgotten customer requests?|service quality|phone calls?|messaging apps?|handwritten notes?)\b/u.test(text);
    if (residentialCleaning) {
      return [
        'house cleaning business missed client instructions',
        'residential cleaning recurring appointments scheduling conflict',
        'cleaners room specific instructions forgotten requests',
        'cleaning business employee assignments supplies schedule changes',
        'house cleaning messaging notes missed tasks',
        'residential cleaning inconsistent service customer preferences',
      ];
    }

    const pictureFraming =
      /\b(?:picture framing shops?|custom framing shops?|frame shops?|framers?)\b/u.test(text) &&
      /\b(?:artwork measurements?|frame selections?|glass selections?|moulding|material availability|special handling|completion dates?|paper forms?|verbal|order changes?|wasted supplies?)\b/u.test(text);
    if (pictureFraming) {
      return [
        'picture framing shop wrong measurements remake',
        'custom framing glass moulding order change problem',
        'framing shop paper order form customer changes',
        'picture framer material shortage delayed order',
        'custom frame wasted material incorrect dimensions',
      ];
    }

    const tourism =
      /\b(?:tourism|tourist|visitor|destination|attraction)\b/u.test(text) &&
      /\b(?:overcrowd|crowding|seasonal demand|visitor behavior|feedback|complaint|resource allocation|public transport|local communit|congestion)\w*\b/u.test(text);
    if (tourism) {
      return [
        'tourism overcrowding visitor complaints destination management',
        'tourist attraction congestion seasonal demand',
        'visitor behavior feedback public transport tourism problem',
        'tourism pressure local community delayed response',
      ];
    }

    const enterprisePolicy =
      /\b(?:human resources?|hr teams?|employee handbooks?|employment policies?|employment contracts?|leave rules?|internal procedures?|corporate policies?|compliance officers?)\b/u.test(text) &&
      /\b(?:outdated|conflicting|inconsistent|regulatory|compliance|repeated questions?|manual review|different departments?|policy updates?)\b/u.test(text);
    if (enterprisePolicy) {
      return [
        'hr employee handbook outdated policy departments',
        'employment leave rules conflict compliance risk',
        'hr repeated employee policy questions manual review',
        'regulatory policy updates inconsistent departments',
        'employment contract policy version control problem',
      ];
    }

    const propertyPerformance =
      /\b(?:property management(?: companies?)?|property managers?|asset managers?|rental properties?|apartment buildings?|landlords?|real estate portfolios?)\b/u.test(text) &&
      /\b(?:maintenance expenses?|maintenance costs?|operating costs?|operating expenses?|property returns?|net operating income|\bnoi\b|vacancy|tenant complaints?|repair expenses?|financial inefficien|maintenance investments?|data silos?|separate systems?)\w*\b/u.test(text);
    if (propertyPerformance) {
      return [
        'property management maintenance costs NOI problem',
        'rental property operating expenses vacancy maintenance',
        'property manager maintenance spend lower returns',
        'tenant complaints maintenance costs property performance',
        'property management data silo operating expenses',
      ];
    }

    const financial =
      /\b(?:financial institutions?|banks?|banking|digital payments?|payment platforms?|fintech|wallets?|transfers?)\b/u.test(text) &&
      /\b(?:fraud|unauthorized|suspicious(?: transaction)?|identity checks?|security alerts?|payment disputes?|transaction disputes?|account restrictions?|frozen accounts?)\b/u.test(text);
    if (financial) {
      return [
        'payment verification delay fraud investigation',
        'unauthorized transfer dispute frozen account',
        'financial identity verification failure payment',
        'suspicious transaction investigation fragmented systems',
        'false positive account restriction fraud detection',
      ];
    }

    const industrial =
      /\b(?:manufacturing|manufacturer|factory|production line|industrial plant)\b/u.test(text) &&
      /\b(?:raw materials?|supplier|inventory|warehouse|shipment|production schedule|bottleneck|demand change)\b/u.test(text);
    if (industrial) {
      return [
        'manufacturing raw material delay production disruption',
        'factory inventory mismatch production schedule',
        'supplier delivery delay manufacturing bottleneck',
        'warehouse stock mismatch production planning',
        'manufacturing demand change excess inventory',
      ];
    }

    const publicSector =
      /\b(?:government|municipal|municipality|public sector|local authority|city council|citizen services?)\b/u.test(text);
    if (publicSector) {
      return [
        'government services fragmented records citizen problem',
        'public service multiple agencies update records',
        'government forms process delay citizen complaint',
        'public sector service integration problem',
      ];
    }

    const healthcare =
      /\b(?:hospital|clinic|healthcare|medical practice|pharmacy|patients?)\b/u.test(text) &&
      /\b(?:appointments?|patient records?|medication|billing|care coordination|referrals?|claims?|scheduling|inventory)\b/u.test(text);
    if (healthcare) {
      return [
        'healthcare fragmented patient records coordination problem',
        'hospital appointment scheduling delay patient',
        'clinic referral follow up coordination problem',
        'medical billing records mismatch workflow',
      ];
    }

    const academic =
      /\b(?:school|university|learning management system|\blms\b|online assessment|students?)\b/u.test(text) &&
      /\b(?:records?|assignments?|exams?|assessments?|security|login|academic integrity|administrators?)\b/u.test(text);
    if (academic) {
      return [
        'university student records workflow problem',
        'lms login security investigation problem',
        'online assessment academic integrity false positive',
        'school administration records coordination delay',
      ];
    }

    const physicalActor = this.resolvePhysicalServiceActor(text);
    const physicalWorkflow =
      /\b(?:customer|customers|service requests?|repair requests?|repair estimates?|technician notes?|parts?|tools?|paper tickets?|paper tags?|paper notes?|verbal communication|queues?|waiting times?|employee assignments?|equipment availability|pickup|collection dates?|approval|work orders?|repair status|furniture|fabric samples?|fabric selections?|fabric orders?|material quantities?|material choices?|measurements?|design changes?|completion dates?)\b/u.test(text);
    if (physicalActor && physicalWorkflow) {
      const output = [
        `${physicalActor} customer work order tracking problem`,
        `${physicalActor} paper tickets lost records customer`,
        `${physicalActor} service status tracking workflow problem`,
      ];
      if (/\b(?:parts?|replacement parts?|ordered parts?)\b/u.test(text)) {
        output.unshift(`${physicalActor} parts order tracking problem`);
      }
      if (/\b(?:estimate|estimates|approval|approved|unexpected costs?)\b/u.test(text)) {
        output.unshift(`${physicalActor} estimate customer approval problem`);
      }
      if (/\b(?:pickup|collection|collection date|delayed collection)\b/u.test(text)) {
        output.unshift(`${physicalActor} delayed pickup collection tracking`);
      }
      if (/\b(?:queue|queues|waiting|employee assignment|staff assignment|equipment availability)\b/u.test(text)) {
        output.unshift(`${physicalActor} queue staff equipment availability problem`);
      }
      return this.unique(output).slice(0, 6);
    }

    const consumerSoftware =
      /\b(?:mobile app|app users?|application users?|login|sign in|account access|subscription app|user interface)\b/u.test(text);
    if (consumerSoftware) {
      return [
        'app login account access problem review',
        'mobile app authentication failure user complaint',
        'app subscription access problem user review',
      ];
    }

    return [];
  }

  private static resolvePhysicalServiceActor(text: string): string {
    const repairMatch = text.match(
      /\b([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+)?)\s+repair\s+shops?\b/u,
    );
    if (repairMatch?.[1]) {
      const vertical = repairMatch[1].trim();
      if (!/^(?:local|small|service|customer)$/u.test(vertical)) {
        return `${vertical} repair shop`;
      }
    }

    const patterns: Array<[RegExp, string]> = [
      [/\b(?:upholstery workshop|upholstery workshops|upholstery shop|upholstery shops|upholsterer|upholsterers|reupholstery|furniture upholstery)\b/u, 'upholstery workshop'],
      [/\b(?:costume rental shops?|costume rentals?|costume shops?|costume hire|wardrobe rentals?)\b/u, 'costume rental shop'],
      [/\bcar wash(?: business| businesses| shop| shops)?\b/u, 'car wash business'],
      [/\blocksmith(?: business| businesses| shop| shops|s)?\b/u, 'locksmith business'],
      [/\b(?:tailor|tailoring|alteration shop|alteration shops)\b/u, 'tailor alteration shop'],
      [/\b(?:salon|salons|barber|barbers)\b/u, 'salon business'],
      [/\b(?:flower shop|flower shops|florist|florists)\b/u, 'flower shop'],
      [/\b(?:picture framing shop|picture framing shops|custom framing shop|custom framing shops|frame shop|frame shops|framer|framers)\b/u, 'picture framing shop'],
      [/\b(?:home[- ]cleaning business|home cleaning business|residential cleaning business|house cleaning business|cleaning company|cleaning service|cleaners?)\b/u, 'residential cleaning business'],
      [/\b(?:restaurant|restaurants|commercial kitchen|commercial kitchens)\b/u, 'restaurant'],
      [/\b(?:field service|mobile service)\b/u, 'field service business'],
    ];
    for (const [pattern, value] of patterns) {
      if (pattern.test(text)) return value;
    }
    return '';
  }

  private static buildPhysicalActorVariants(
    actor: string,
    anchors: readonly string[],
  ): string[] {
    const variants = [actor];
    for (const anchor of anchors) {
      const normalized = this.cleanQuery(anchor);
      if (!normalized) continue;
      if (/\b(?:shop|business|service)\b/u.test(normalized)) {
        variants.push(normalized);
      } else if (/\b(?:watchmaker|cobbler|florist|locksmith|tailor|salon|barber)\b/u.test(normalized)) {
        variants.push(`${normalized} shop`);
      } else {
        variants.push(`${normalized} repair shop`);
      }
    }
    return this.unique(variants).slice(0, 3);
  }

  private static buildRequestAdjacentDomainDiscoveryQueries(
    requestDescription: string,
    domainName: string,
    keywords: readonly string[],
  ): string[] {
    const actor = RequestDynamicQueryUtil.extractActor(requestDescription);
    const actorAliases = RequestDynamicQueryUtil.buildActorAliases(
      requestDescription,
    );
    const workflowTerms = RequestDynamicQueryUtil.extractWorkflowTerms(
      requestDescription,
    )
      .map((value) => this.cleanQuery(value))
      .filter(Boolean)
      .slice(0, 5);
    const painTerms = RequestDynamicQueryUtil.extractPainTerms(
      requestDescription,
    )
      .map((value) => this.cleanQuery(value))
      .filter(Boolean)
      .slice(0, 4);
    const domainAnchor = this.cleanQuery(domainName)
      .replace(
        /\b(?:management|operations?|workflow|analytics|intelligence|platform|system|software|application)\b/gu,
        ' ',
      )
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 4)
      .join(' ');
    const keywordAnchors = this.unique(
      keywords
        .map((value) => this.cleanQuery(value))
        .filter(Boolean)
        .filter((value) => value.split(/\s+/u).length <= 5)
        .filter((value) =>
          RequestQueryProvenanceUtil.isDerivedConceptGrounded(requestDescription, value),
        ),
    ).slice(0, 3);
    const actors = this.unique([
      actor,
      ...actorAliases,
    ]).filter(Boolean).slice(0, 3);
    if (actors.length === 0) return [];

    const queries: string[] = [];
    const add = (...parts: Array<string | undefined>) => {
      const query = this.cleanQuery(parts.filter(Boolean).join(' '));
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    add(actors[0], workflowTerms[0], painTerms[0] || 'problem');
    add(actors[1] ?? actors[0], workflowTerms[1] ?? workflowTerms[0], 'problem');
    add(actors[0], domainAnchor, workflowTerms[0], workflowTerms[2], painTerms[1]);
    add(actors[0], painTerms[0], painTerms[1]);
    add(actors[1] ?? actors[0], domainAnchor, keywordAnchors[0], workflowTerms[1], 'problem');
    add(actors[2] ?? actors[0], keywordAnchors[1], painTerms[2] || 'workflow issue');

    return this.unique(queries).slice(0, 6);
  }

  private static interleaveQueryGroups(
    groups: readonly (readonly string[])[],
  ): string[] {
    const output: string[] = [];
    const maxLength = groups.reduce(
      (max, group) => Math.max(max, group.length),
      0,
    );

    for (let index = 0; index < maxLength; index += 1) {
      for (const group of groups) {
        const value = group[index];
        if (value) output.push(value);
      }
    }

    return output;
  }

  private static buildDomainDiscoveryQueries(
    domainName: string,
    keywords: readonly string[],
  ): string[] {
    const joined = this.normalize([domainName, ...keywords].join(' '));
    const primary: string[] = [];
    const secondary: string[] = [];

    if (/\b(?:blockchain|distributed ledger|smart contract|web3|crypto wallet)\b/u.test(joined)) {
      primary.push('blockchain transaction user problem');
      secondary.push('smart contract failure user complaint');
    }
    if (/\b(?:energy|electricity|power grid|solar|battery monitoring|energy consumption)\b/u.test(joined)) {
      primary.push('electricity power grid outage problem');
      secondary.push('energy consumption billing monitoring problem');
    }
    if (/\b(?:government|public administration|citizen portal|permit application|government services)\b/u.test(joined)) {
      primary.push('government online service delay citizen complaint');
      secondary.push('permit application process delay public sector');
    }
    if (/\b(?:agriculture|farming|crop management|harvest planning)\b/u.test(joined)) {
      primary.push('farm harvest logistics delay problem');
      secondary.push('agriculture storage delivery spoilage problem');
    }
    if (/\b(?:logistics|shipment tracking|warehouse management|fleet routing|inventory logistics)\b/u.test(joined)) {
      primary.push('shipment tracking delay logistics problem');
      secondary.push('warehouse inventory delivery coordination problem');
    }
    if (/\b(?:internet of things|\biot\b|sensor monitoring|connected devices|telemetry)\b/u.test(joined)) {
      primary.push('iot sensor monitoring reliability problem');
      secondary.push('connected device telemetry tracking issue');
    }

    if (/\b(?:artificial intelligence|\bai\b|ai model|generative ai|machine learning)\b/u.test(joined)) {
      primary.push('ai application user error reliability problem');
      secondary.push('ai model response failure user complaint');
    }
    if (/\b(?:cybersecurity|security alerts?|unauthorized access|identity access|threat detection)\b/u.test(joined)) {
      primary.push('cybersecurity account access security alert user problem');
      secondary.push('security false positive access restriction complaint');
    }
    if (/\b(?:e commerce|ecommerce|online marketplace|seller marketplace|online store|checkout)\b/u.test(joined)) {
      primary.push('online marketplace seller fraud customer complaint');
      secondary.push('ecommerce suspicious listing fake review problem');
    }
    if (/\b(?:healthcare|medical|patient|clinical workflow|rehabilitation)\b/u.test(joined)) {
      primary.push('healthcare workflow patient coordination problem');
      secondary.push('medical rehabilitation tracking user problem');
    }

    /*
     * Domains-only requests can contain newly added domains that have no
     * hand-written vocabulary in this utility. Treat the first compact,
     * domain-shaped keyword anchors as independent discovery lanes instead of
     * collapsing them into a single cross-domain query. The source-specific
     * max-query cap then naturally gives each selected domain one early slot.
     */
    const knownSeedPattern = /\b(?:blockchain|distributed ledger|smart contract|web3|crypto|energy|electricity|power grid|solar|government|public administration|agriculture|farming|logistics|shipment|warehouse|internet of things|\biot\b|artificial intelligence|\bai\b|cybersecurity|security|e commerce|ecommerce|marketplace|online store|healthcare|medical|patient|clinical|rehabilitation)\b/iu;
    const genericSeeds = this.unique(
      [domainName, ...keywords]
        .map((value) => this.cleanQuery(value))
        .filter(Boolean)
        .filter((value) => !/coherent cross-domain|workflow combining|validation scope/iu.test(value))
        .filter((value) => value.split(/\s+/u).length <= 4)
        .filter((value) => !this.hasProblemLanguage(value))
        .filter((value) => !knownSeedPattern.test(value))
        .filter((value) => !/\b(?:services?|platform|system|application|software|management|operations?|workflow|tracking|analytics|dashboard)\b/iu.test(value))
        .slice(0, 3),
    );
    for (const seed of genericSeeds) {
      primary.push(`${seed} user complaint problem`);
      secondary.push(`${seed} workflow issue`);
    }

    const genericDomain = this.cleanQuery(domainName)
      .split(/\s+/u)
      .slice(0, 4)
      .join(' ');
    if (genericDomain) {
      secondary.push(`${genericDomain} user problem`);
    }

    return this.unique([...primary, ...secondary]).slice(0, 10);
  }


  private static buildMarketplaceQueries(
    domainName: string,
    keywords: readonly string[],
    specialized: readonly string[],
  ): string[] {
    const storeStopWords = new Set([
      'problem', 'problems', 'complaint', 'complaints', 'difficult', 'difficulty',
      'failure', 'failures', 'failed', 'missing', 'forgotten', 'fragmented',
      'bottleneck', 'delay', 'delayed', 'risk', 'risks', 'manual', 'team', 'teams',
      'business', 'businesses', 'system', 'systems', 'workflow', 'workflows',
      'detecting', 'identify', 'identifying', 'analysis', 'analyze', 'review',
      'reviews', 'organization', 'organizing', 'for', 'and', 'the', 'of', 'to',
    ]);
    const compactStorePhrase = (value: string): string =>
      this.cleanQuery(value)
        .split(/\s+/u)
        .filter(Boolean)
        .filter((token) => !storeStopWords.has(token))
        .slice(0, 3)
        .join(' ');

    const keywordTerms = keywords
      .map((value) => compactStorePhrase(value))
      .filter(Boolean)
      .filter((value) => value.split(/\s+/u).length <= 4)
      .slice(0, 6);
    const domainTerms = domainName
      ? [compactStorePhrase(domainName)]
      : [];
    const fallback = specialized
      .map((value) => compactStorePhrase(value))
      .filter(Boolean);

    /*
     * Request-derived phrases come first for text paths. Hidden/generated
     * domain names are often professional taxonomy labels rather than real app
     * store search terms, so using them first can consume the store query
     * budget without finding the apps whose reviews contain the evidence.
     */
    return this.unique([...fallback, ...keywordTerms, ...domainTerms]).slice(0, 6);
  }

  /**
   * Reorders the AI-planned portfolio for each source family without knowing
   * the domain. This gives short-budget collectors different high-value query
   * lanes instead of making every source execute the same first three strings.
   */
  private static rankPlannedQueriesForSource(
    queries: readonly string[],
    sourceKey: string,
    requestDescription: string,
  ): string[] {
    const normalizedSource = this.normalize(sourceKey);
    const technicalRequest =
      /\b(?:api|apis|sdk|code|coding|runtime|server|database|telemetry|logs?|integration|webhook|http|network|firmware|software|application|platform|authentication|cybersecurity)\b/u.test(
        requestDescription,
      );

    return [...queries]
      .map((query, index) => {
        const normalized = this.normalize(query);
        const wordCount = normalized.split(/\s+/u).filter(Boolean).length;
        let sourceScore = 0;

        const enterpriseIdentityRequest =
          /\b(?:employee|staff|workforce|personnel)\w*\b/u.test(requestDescription) &&
          /\b(?:permission|entitlement|privilege|access|offboard|deprovision|account removal|role change|department change|security alert)\w*\b/u.test(requestDescription);
        if (
          enterpriseIdentityRequest &&
          /\b(?:identity governance|identity access|joiner mover leaver|offboard|deprovision|orphaned account|stale access|privilege creep|entitlement review|access review|account lifecycle|role transition|department transfer)\w*\b/u.test(normalized)
        ) {
          sourceScore += 10;
        }

        if (normalizedSource === 'crossref') {
          if (
            /\b(?:assessment|condition|documentation|record|history|treatment|conservation|evaluation|study|analysis|monitoring|maintenance|quality|impact|risk)\w*\b/u.test(
              normalized,
            )
          ) {
            sourceScore += 5;
          }
          if (/\b(?:complaint|customer complaint|wrong|forgotten)\w*\b/u.test(normalized)) {
            sourceScore -= 2;
          }
        } else if (
          normalizedSource === 'news' ||
          normalizedSource === 'gdelt' ||
          normalizedSource === 'blog'
        ) {
          if (
            /\b(?:delay|cost|loss|waste|failure|incident|risk|shortage|dispute|damage|overload|inefficien|incorrect|rework|fraud|breach)\w*\b/u.test(
              normalized,
            )
          ) {
            sourceScore += 5;
          }
        } else if (
          normalizedSource === 'forum' ||
          normalizedSource === 'reddit' ||
          normalizedSource === 'youtube'
        ) {
          if (this.hasProblemLanguage(normalized)) sourceScore += 5;
          if (
            /\b(?:customer|client|operator|manager|technician|specialist|restorer|owner|user|employee|student|patient|provider|maker|shop|studio|workshop)\w*\b/u.test(
              normalized,
            )
          ) {
            sourceScore += 2;
          }
        } else if (
          normalizedSource === 'github' ||
          normalizedSource === 'stackoverflow' ||
          normalizedSource === 'dev-to' ||
          normalizedSource === 'hacker-news'
        ) {
          sourceScore += technicalRequest ? 2 : -3;
          if (
            /\b(?:api|sdk|code|runtime|server|database|telemetry|integration|webhook|network|firmware|authentication|security)\w*\b/u.test(
              normalized,
            )
          ) {
            sourceScore += technicalRequest ? 5 : -2;
          }
        }

        const financialDecisionRequest =
          /\b(?:profit|profitability|margin|margins|financial performance|revenue forecast|budget variance)\b/u.test(
            requestDescription,
          ) &&
          /\b(?:cost|costs|expense|expenses|spending|revenue|budget|forecast|subscription|churn|cancellation)\w*\b/u.test(
            requestDescription,
          );
        if (financialDecisionRequest) {
          const financialCoverage = [
            /\b(?:profit|profitability|margin|margins)\b/u,
            /\b(?:cost|costs|expense|expenses|spending)\b/u,
            /\b(?:revenue|advertising|yield|subscription)\b/u,
            /\b(?:budget|budgeting|forecast|forecasting|churn|cancellation)\w*\b/u,
          ].filter((pattern) => pattern.test(normalized)).length;
          sourceScore += financialCoverage * 3;
          if (
            !/\b(?:profit|profitability|margin|margins|revenue)\b/u.test(
              normalized,
            )
          ) {
            sourceScore -= 8;
          }
        }

        if (wordCount >= 3 && wordCount <= 8) sourceScore += 2;
        if (wordCount > 10) sourceScore -= Math.min(4, wordCount - 10);

        return {
          query,
          score:
            sourceScore +
            this.scoreProblemQuery(query) * 0.35 -
            index * 0.02,
        };
      })
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.query);
  }

  private static shapeForSource(query: string, sourceKey: string): string {
    const compact = this.cleanQuery(query)
      .split(/\s+/u)
      .slice(0, (sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'crossref') ? 8 : 10)
      .join(' ');

    if (!compact) return '';

    if (sourceKey === 'reddit' || sourceKey === 'forum') {
      return this.hasProblemLanguage(compact)
        ? compact
        : `${compact} problem`;
    }
    if (sourceKey === 'blog') {
      return this.hasProblemLanguage(compact)
        ? compact
        : `${compact} workflow problem`;
    }
    if (sourceKey === 'youtube') {
      return this.hasProblemLanguage(compact)
        ? compact
        : `${compact} problem`;
    }
    return compact;
  }

  private static scoreProblemQuery(query: string): number {
    let score = 0;
    const normalized = this.normalize(query);
    if (this.hasProblemLanguage(normalized)) score += 6;
    if (/\b(?:customer|employee|hr|technician|operator|manager|citizen|patient|student|faculty|instructor|teaching assistant|academic|university|trainer|pet trainer|dog trainer|animal trainer|owner|bank|financial|factory|supplier|shop|business|department|visitor|tourist|destination|artist|maker|media|streaming)\b/u.test(normalized)) score += 3;
    if (/\b(?:ticket|record|policy|contract|approval|approved|parts?|inventory|dispatch|queue|verification|dispute|schedule|handoff|workflow|workload|teaching load|course assignment|enrollment|training session|behavior|behaviour|trigger|routine|progress|overcrowd|congestion|feedback|revision|version)\w*\b/u.test(normalized)) score += 3;

    const concreteProblemAxes = [
      /\b(?:cost|costs|expense|expenses|spending|profit|profitability|margin|margins|revenue)\b/u,
      /\b(?:budget|budgeting|forecast|forecasting|churn|cancellation|cancellations)\w*\b/u,
      /\b(?:revision|revisions|approval|approved|version|versions|specification|specifications)\w*\b/u,
      /\b(?:waste|wasted|rework|incorrect|wrong|missed|missing|lost|delay|delayed|inaccurate)\w*\b/u,
    ].filter((pattern) => pattern.test(normalized)).length;
    score += Math.min(8, concreteProblemAxes * 2);

    if (/\b(?:platform|solution|assistant|dashboard|technology|innovation|guide|how to)\b/u.test(normalized)) score -= 2;
    return score;
  }

  private static scoreVerticalQuery(
    query: string,
    anchors: readonly string[],
  ): number {
    if (anchors.length === 0) return 0;
    const normalized = this.normalize(query);
    return anchors.some((anchor) => normalized.includes(this.normalize(anchor)))
      ? 8
      : -4;
  }

  private static hasProblemLanguage(value: string): boolean {
    return /\b(?:problem|problems|complaint|complaints|failed|failure|delay|delayed|lost|missing|misplaced|wrong|incorrect|inaccurate|outdated|conflict|conflicting|inconsistent|fraud|unauthorized|frozen|dispute|risk|manual|paper|verbal|bottleneck|shortage|stockout|unavailable|forgotten|repeated|unexpected|mismatch|fragmented|siloed|overcrowd|crowding|congestion|pressure|waste|wasted|rework|churn|cancellation)\w*\b/u.test(
      this.normalize(value),
    );
  }

  private static resolveMaxQueries(
    sourceKey: string,
    focusedTextRequest = false,
  ): number {
    /*
     * Generation evidence collection is recall-oriented. Keep the source-aware
     * query shaping, but do not let a three-query lane become the effective
     * evidence ceiling after the upstream planner produced a much richer
     * domain/problem vocabulary.
     */
    if (sourceKey === 'blog') return focusedTextRequest ? 5 : 4;
    if (
      sourceKey === 'news' ||
      sourceKey === 'gdelt' ||
      sourceKey === 'crossref'
    ) {
      return focusedTextRequest ? 10 : 8;
    }
    if (sourceKey === 'reddit') return 10;
    if (sourceKey === 'forum') return focusedTextRequest ? 10 : 8;
    if (sourceKey === 'youtube') return focusedTextRequest ? 8 : 6;
    if (sourceKey === 'app-store' || sourceKey === 'google-play') {
      return focusedTextRequest ? 8 : 6;
    }
    return focusedTextRequest ? 10 : 8;
  }

  /**
   * Generic cross-domain drift guard for legacy query templates. Request-driven
   * facet queries are always preferred; older templates may only add workflow
   * nouns that are actually present in the current request. This prevents a
   * new niche from inheriting unrelated concepts such as parts, pickup or work
   * orders without hard-coding the niche itself.
   */
  private static queryAvoidsForeignWorkflowDrift(
    query: string,
    requestDescription: string,
  ): boolean {
    const normalizedQuery = this.normalize(query);
    const normalizedRequest = this.normalize(requestDescription);
    if (!normalizedQuery || !normalizedRequest) return true;

    const highRiskWorkflowPhrases = [
      'work order',
      'repair shop',
      'replacement part',
      'replacement parts',
      'spare part',
      'spare parts',
      'pickup',
      'pick up',
      'technician',
      'technicians',
      'inventory',
      'warranty',
      'dispatch',
      'fleet',
      'warehouse',
      'carrier scan',
      'proof of delivery',
      'shipping address',
    ] as const;

    for (const phrase of highRiskWorkflowPhrases) {
      if (
        normalizedQuery.includes(phrase) &&
        !normalizedRequest.includes(phrase)
      ) {
        return false;
      }
    }

    return true;
  }

  private static cleanQuery(value: string): string {
    const tokens = this.normalize(value)
      .replace(/\b(?:reports? of|discussion(?:s)? of|complaints? from|evidence of|users? report(?:ed)?|operators? report(?:ed)?)\b/gu, ' ')
      .replace(/\bwhile\b[\s\S]*$/u, ' ')
      .replace(/^(?:protect|protecting|maintain|maintaining|allow|allowing)\s+/u, '')
      .replace(
        /^(?:can lead to|can cause|lead to|leads to|result in|results in|making it difficult to|difficult to)\s+/u,
        '',
      )
      .replace(
        /\s+(?:and|or|but|while|with|without|to|for|of|from|by|because)$/u,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .filter(Boolean);

    const identity = (token: string): string => {
      if (token.length <= 4) return token;
      if (/ies$/u.test(token) && token.length > 5) return `${token.slice(0, -3)}y`;
      if (/s$/u.test(token) && !/ss$/u.test(token) && token.length > 5) {
        return token.slice(0, -1);
      }
      return token;
    };
    const output: string[] = [];
    const outputIdentity: string[] = [];
    let index = 0;
    while (index < tokens.length) {
      let repeatedSpan = 0;
      const maxSpan = Math.min(4, outputIdentity.length, tokens.length - index);
      for (let span = maxSpan; span >= 1; span -= 1) {
        const incoming = tokens
          .slice(index, index + span)
          .map((token) => identity(token));
        const previous = outputIdentity.slice(outputIdentity.length - span);
        if (
          incoming.length === previous.length &&
          incoming.every((token, tokenIndex) => token === previous[tokenIndex])
        ) {
          repeatedSpan = span;
          break;
        }
      }

      if (repeatedSpan > 0) {
        index += repeatedSpan;
        continue;
      }

      const token = tokens[index];
      output.push(token);
      outputIdentity.push(identity(token));
      index += 1;
    }

    return output.join(' ').trim();
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s&/'’-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static unique(values: readonly string[]): string[] {
    const output: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = this.normalize(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(value.trim());
    }
    return output;
  }
}
