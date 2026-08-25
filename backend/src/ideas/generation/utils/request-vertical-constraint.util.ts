import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';
import { RequestNicheCustomCraftUtil } from './request-niche-custom-craft.util';
import { RequestOnlinePharmacyFraudUtil } from './request-online-pharmacy-fraud.util';
import { RequestOperationalCostAttributionUtil } from './request-operational-cost-attribution.util';

export type RequestVerticalConstraint = {
  readonly kind:
    | 'TOURISM_DESTINATION'
    | 'PHYSICAL_SERVICE_VERTICAL'
    | 'RENTAL_INVENTORY_OPERATIONS'
    | 'ENTERPRISE_IDENTITY_ACCESS_GOVERNANCE'
    | 'ENTERPRISE_POLICY'
    | 'FINANCIAL_OPERATIONS'
    | 'ECOMMERCE_MARGIN_PROFITABILITY'
    | 'SUBSCRIPTION_REVENUE_RETENTION'
    | 'MEDIA_CONTENT_PROFITABILITY'
    | 'TRANSPORTATION_COST_PROFITABILITY'
    | 'LOGISTICS_COST_PROFITABILITY'
    | 'BOOK_COVER_COMMISSION_SPECIFICATION'
    | 'FRAME_RESTORATION_SPECIFICATION'
    | 'MUNICIPAL_WASTE_COLLECTION_COORDINATION'
    | 'MUSICAL_MANUSCRIPT_RESTORATION'
    | 'DIGITAL_TRUST_SAFETY'
    | 'ACCOUNT_ACCESS_SECURITY'
    | 'PROPERTY_ASSET_PERFORMANCE'
    | 'BUILDING_ENVIRONMENTAL_MONITORING'
    | 'MANUFACTURING_COST_PROFITABILITY'
    | 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH'
    | 'RENEWABLE_ASSET_PERFORMANCE'
    | 'MANUFACTURING_WASTE_SUSTAINABILITY'
    | 'RESTAURANT_DELIVERY_FRAUD'
    | 'TRANSACTION_ACCOUNT_ABUSE'
    | 'ONLINE_PHARMACY_FRAUD'
    | 'FACILITY_RESOURCE_MONITORING'
    | 'SHIPMENT_CHAIN_OF_CUSTODY'
    | 'GOVERNMENT_RECORD_ACCESS_INTEGRITY'
    | 'CUSTOM_ENGRAVING_SERVICE'
    | 'CUSTOM_MOSAIC_SERVICE'
    | 'INDUSTRIAL_OPERATIONS'
    | 'AGRICULTURE_LOGISTICS'
    | 'AGRICULTURE_DISTRIBUTION_PROFITABILITY'
    | 'AGRICULTURE_EXPORT_PROFITABILITY'
    | 'FARM_ENERGY_OPERATIONS'
    | 'COMMERCIAL_BUILDING_ENERGY'
    | 'CONNECTED_ASSET_SECURITY'
    | 'ENERGY_IOT_SECURITY_DIAGNOSIS'
    | 'URBAN_ENERGY_DEMAND_INTELLIGENCE'
    | 'URBAN_MOBILITY_CONGESTION_EMISSIONS'
    | 'DOLL_RESTORATION_SERVICE'
    | 'PROFESSIONAL_EVIDENCE_RECORDS'
    | 'PROFESSIONAL_SERVICE_AGENCY'
    | 'RESTAURANT_ENERGY'
    | 'FOOD_STORAGE_CONDITION'
    | 'RESTORATION_CONSERVATION'
    | 'RESIDENTIAL_CLEANING'
    | 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY'
    | 'ACADEMIC_OPERATIONS'
    | 'DELIVERY_SUSTAINABILITY'
    | 'CUSTOM_SPECIFICATION_SERVICE'
    | 'PUBLIC_HEALTH_DEMAND_CAPACITY'
    | 'HEALTHCARE_SUPPLY_COST_EFFICIENCY'
    | 'HEALTHCARE_COST_RESOURCE_EFFICIENCY'
    | 'HEALTHCARE_OPERATIONS'
    | 'PUBLIC_PROGRAM_COST_ATTRIBUTION'
    | 'OPERATIONAL_COST_ATTRIBUTION'
    | 'PUBLIC_SECTOR'
    | 'GENERAL';
  readonly label: string;
  readonly strict: boolean;
  readonly requiredAnchors: readonly string[];
  readonly workflowAnchors: readonly string[];
  readonly excludedAnchors: readonly string[];
};

export class RequestVerticalConstraintUtil {
  static resolve(input: {
    readonly requestDescription?: string | null;
    readonly domainName?: string | null;
    readonly selectedDomainNames?: readonly string[];
    readonly plannedQueries?: readonly string[];
  }): RequestVerticalConstraint {
    const requestText = this.normalize(input.requestDescription ?? '');
    const intentProfile = RequestWorkflowIntentProfileUtil.resolve(
      input.requestDescription,
    );
    const text = this.normalize([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.selectedDomainNames ?? []),
      ...(input.plannedQueries ?? []),
    ].join(' '));

    /*
     * The requester description is the problem truth. Planned queries and
     * selected-domain labels may enrich search context, but they must never
     * overwrite the workflow described by the requester. Resolve the
     * collision-prone logistics profitability workflow from the description
     * alone before consulting enriched query/domain text. This protects a
     * cost/margin request from being reclassified as shipment custody merely
     * because a later recovery query happened to contain "shipment".
     */
    if (RequestOnlinePharmacyFraudUtil.isRequest(input.requestDescription)) {
      return {
        kind: 'ONLINE_PHARMACY_FRAUD',
        label: 'online pharmacy prescription transaction and account fraud operations',
        strict: true,
        requiredAnchors: [
          'online pharmacy',
          'digital pharmacy',
          'e pharmacy',
          'internet pharmacy',
          'pharmacy marketplace',
          'digital healthcare marketplace',
          'healthcare marketplace',
          'e prescription',
          'electronic prescription',
        ],
        workflowAnchors: [
          'fraudulent prescription',
          'prescription fraud',
          'fake prescription',
          'forged prescription',
          'suspicious purchase',
          'suspicious order',
          'account takeover',
          'compromised account',
          'unauthorized payment',
          'delivery address change',
          'payment information change',
          'identity verification',
          'security alert',
          'fraud detection',
          'fraud monitoring',
          'false positive',
          'delayed legitimate order',
          'unnecessary restriction',
        ],
        excludedAnchors: [
          'food delivery',
          'meal delivery',
          'restaurant delivery',
          'delivery rider',
          'rider performance',
          'chronic pain',
          'pain management',
          'opioid use disorder',
          'prescription opioid abuse',
          'analgesic abuse',
          'abuse deterrent formulation',
        ],
      };
    }

    const logisticsCostProfitability =
      /\b(?:logistics companies?|logistics providers?|logistics operators?|third[- ]party logistics|3pl providers?|freight companies?|freight operators?|delivery operators?|parcel carriers?|distribution operators?|warehouse and delivery operators?|supply chain operators?)\b/u.test(requestText) &&
      /\b(?:delivery operations?|operating costs?|operating expenses?|fuel expenses?|fuel costs?|warehouse costs?|warehousing costs?|failed deliveries?|delivery failures?|vehicle maintenance|maintenance costs?|route performance|route profitability|customer penalties?|delivery penalties?|penalty costs?|profit margins?|margin erosion|profitability|route planning|pricing decisions?|financial forecasts?|shipment volumes?|delivery volumes?|cost per shipment|cost per delivery)\b/u.test(requestText) &&
      /\b(?:profit margins?|profitability|margin erosion|operating costs?|operating expenses?|financial forecasts?|pricing decisions?|reducing profit|reduce profit|become more expensive|cost increase|costs increase)\b/u.test(requestText);
    if (logisticsCostProfitability) {
      return {
        kind: 'LOGISTICS_COST_PROFITABILITY',
        label: 'logistics delivery cost and margin profitability operations',
        strict: true,
        requiredAnchors: [
          'logistics company',
          'logistics provider',
          'freight operator',
          'delivery operator',
          'parcel carrier',
          'distribution operator',
          'supply chain operator',
        ],
        workflowAnchors: [
          'operating cost',
          'fuel expense',
          'fuel cost',
          'warehouse cost',
          'failed delivery',
          'vehicle maintenance',
          'maintenance cost',
          'route performance',
          'route profitability',
          'customer penalty',
          'delivery penalty',
          'profit margin',
          'margin erosion',
          'route planning',
          'pricing decision',
          'financial forecast',
          'cost per shipment',
          'cost per delivery',
        ],
        excludedAnchors: [
          'chain of custody',
          'custody transfer',
          'tampered tracking',
          'record tampering',
          'altered tracking',
          'shipment provenance',
          'authentication',
          'login failure',
          'app crash',
          'server address',
        ],
      };
    }


    const renewableAssetPerformance =
      /\b(?:renewable energy compan(?:y|ies)|renewable energy operators?|renewable asset managers?|solar (?:and wind )?projects?|solar projects?|wind projects?|solar assets?|wind assets?|solar farms?|wind farms?)\b/u.test(requestText) &&
      /\b(?:financial returns?|returns? than expected|revenue forecasts?|revenue|profitability|financial performance|financing costs?|electricity prices?|power prices?|maintenance expenses?|maintenance costs?)\b/u.test(requestText) &&
      /\b(?:energy output|power output|generation output|equipment downtime|downtime|maintenance expenses?|maintenance costs?|weather conditions?|weather|electricity prices?|power prices?|financing costs?|technical inefficien|operational inefficien|asset performance|capacity factor)\w*\b/u.test(requestText) &&
      /\b(?:technical inefficien|financial conditions?|root cause|poor performance|underperformance|lower financial returns?|prioritiz(?:e|ing) assets?|asset attention|unnecessary maintenance|poorly timed investments?|forecast)\w*\b/u.test(requestText);
    if (renewableAssetPerformance) {
      return {
        kind: 'RENEWABLE_ASSET_PERFORMANCE',
        label: 'renewable asset technical and financial performance operations',
        strict: true,
        requiredAnchors: [
          'renewable energy',
          'solar project',
          'wind project',
          'solar asset',
          'wind asset',
          'solar farm',
          'wind farm',
          'renewable asset',
        ],
        workflowAnchors: [
          'energy output',
          'power output',
          'generation output',
          'equipment downtime',
          'downtime',
          'maintenance expense',
          'maintenance cost',
          'electricity price',
          'power price',
          'financing cost',
          'weather condition',
          'capacity factor',
          'asset performance',
          'financial return',
          'financial performance',
          'profitability',
          'revenue forecast',
          'technical inefficiency',
          'underperformance',
          'root cause',
        ],
        excludedAnchors: [
          'two factor authentication',
          '2fa',
          'face id',
          'login screen',
          'login failure',
          'pay my bill',
          'bill payment',
          'mobile app login',
          'stock analysis',
          'stocks',
          'shares',
          'price target',
          'buy signal',
          'sell signal',
          'facebook ads',
          'social media ads',
          'qwen',
          'vllm',
          'llm scaler',
        ],
      };
    }

    const frameRestorationSpecification =
      /\b(?:independent )?(?:frame restoration specialists?|picture frame restorers?|frame restorers?|antique frame restorers?|gilded frame restorers?|frame conservation specialists?|picture frame restoration workshops?|frame restoration workshops?)\b/u.test(requestText) &&
      /\b(?:damaged frames?|material selections?|decorative details?|repair notes?|finish preferences?|customer approvals?|approved restoration|completion dates?|promised completion dates?|photographs?|handwritten notes?|physical samples?|incorrect finishes?|repeated repairs?|lost design details?|wasted materials?|delayed customer orders?)\b/u.test(requestText);
    if (frameRestorationSpecification) {
      return {
        kind: 'FRAME_RESTORATION_SPECIFICATION',
        label: 'art frame restoration treatment specification and client approval operations',
        strict: true,
        requiredAnchors: [
          'frame restoration specialist',
          'picture frame restorer',
          'frame restorer',
          'antique frame restorer',
          'gilded frame restoration',
          'frame conservation',
          'picture frame restoration',
        ],
        workflowAnchors: [
          'damaged frame', 'material selection', 'decorative detail',
          'repair note', 'finish preference', 'customer approval',
          'approved restoration', 'completion date', 'promised completion',
          'condition photograph', 'handwritten note', 'physical sample',
          'incorrect finish', 'repeated repair', 'lost design detail',
          'wasted material', 'delayed order',
        ],
        excludedAnchors: [
          'digital photo frame', 'photo frame app', 'video frame',
          'frame rate', 'iframe', 'css frame', 'react frame',
        ],
      };
    }

    const municipalWasteObjectIdentity =
      /\b(?:municipal solid waste|solid waste|municipal waste|waste collection|garbage collection|trash collection|refuse collection|sanitation collection|waste bins?|garbage bins?|trash bins?|waste containers?|garbage containers?|refuse containers?|landfill|recycling collection)\b/u.test(
        requestText,
      );
    const municipalWasteCollection =
      municipalWasteObjectIdentity &&
      /\b(?:cities|city governments?|municipalities|municipal governments?|city councils?|sanitation departments?|waste management departments?|public works departments?)\b/u.test(requestText) &&
      /\b(?:collection schedules?|pickup schedules?|vehicle locations?|collection vehicles?|container capacity|bin capacity|fill levels?|citizen complaints?|route performance|waste collection routes?|disposal patterns?|population densities?|neighborhood density|overflowing containers?|overflowing bins?|missed pickups?|unnecessary collection trips?)\b/u.test(requestText);
    if (municipalWasteCollection) {
      return {
        kind: 'MUNICIPAL_WASTE_COLLECTION_COORDINATION',
        label: 'municipal waste collection scheduling routing and resource coordination',
        strict: true,
        requiredAnchors: [
          'municipal waste',
          'waste collection',
          'garbage collection',
          'refuse collection',
          'sanitation',
          'city waste',
          'municipality',
          'municipal',
        ],
        workflowAnchors: [
          'collection schedule',
          'pickup schedule',
          'vehicle location',
          'collection vehicle',
          'container capacity',
          'bin capacity',
          'fill level',
          'citizen complaint',
          'route performance',
          'collection route',
          'disposal pattern',
          'population density',
          'overflowing container',
          'overflowing bin',
          'unnecessary collection trip',
          'operating cost',
          'resource allocation',
          'earlier pickup',
          'additional resources',
        ],
        excludedAnchors: [
          'source code',
          'github issue',
          'software container',
          'memory garbage collection',
          'garbage collector runtime',
          'java garbage collection',
          'app crash',
          'package delivery',
          'warehouse shipment',
        ],
      };
    }

    const musicalManuscriptRestoration =
      /\b(?:musical score restoration specialists?|music score restoration specialists?|music manuscript conservators?|musical manuscript conservators?|paper conservators?|manuscript conservators?|document conservators?)\b/u.test(requestText) &&
      /\b(?:damaged manuscripts?|musical scores?|music manuscripts?|missing pages?|handwritten annotations?|marginalia|previous repairs?|paper types?|customer instructions?|client instructions?|approved treatment|treatment records?|restoration progress|conservation treatment|condition records?)\b/u.test(requestText);
    if (musicalManuscriptRestoration) {
      return {
        kind: 'MUSICAL_MANUSCRIPT_RESTORATION',
        label: 'musical manuscript condition treatment and restoration record operations',
        strict: true,
        requiredAnchors: [
          'musical score',
          'music score',
          'music manuscript',
          'musical manuscript',
          'manuscript conservation',
          'manuscript conservator',
          'paper conservation',
          'paper conservator',
          'document conservation',
          'document conservator',
        ],
        workflowAnchors: [
          'damaged manuscript',
          'missing page',
          'missing leaf',
          'handwritten annotation',
          'marginalia',
          'previous repair',
          'repair history',
          'paper type',
          'paper characteristic',
          'condition record',
          'condition report',
          'customer instruction',
          'client instruction',
          'approved treatment',
          'treatment record',
          'conservation treatment',
          'restoration progress',
          'treatment progress',
          'lost annotation',
          'duplicated work',
          'incorrect treatment',
          'damaged material',
          'delayed project',
        ],
        excludedAnchors: [
          'music streaming',
          'audio restoration',
          'audio mastering',
          'sheet music app',
          'music notation software',
          'source code',
          'github issue',
          'mobile app',
        ],
      };
    }

    const professionalServiceAgency =
      /\b(?:sign language interpretation agenc(?:y|ies)|sign language interpreting agenc(?:y|ies)|asl interpretation agenc(?:y|ies)|asl interpreting agenc(?:y|ies)|interpretation agenc(?:y|ies)|interpreting agenc(?:y|ies)|language service providers?|interpreter service providers?|interpreter agencies?|agency dispatchers?|interpreter coordinators?)\b/u.test(requestText) &&
      /\b(?:interpreter availability|interpreter scheduling|assignment details?|assignment matching|client communication preferences?|specialized vocabulary|session notes?|last[- ]minute schedule changes?|schedule changes?|scheduling conflicts?|missed assignments?|client requirements?)\b/u.test(requestText);
    if (professionalServiceAgency) {
      return {
        kind: 'PROFESSIONAL_SERVICE_AGENCY',
        label: 'professional interpretation agency assignment and coordination operations',
        strict: true,
        requiredAnchors: [
          'sign language interpretation agency',
          'sign language interpreting agency',
          'asl interpretation agency',
          'interpretation agency',
          'interpreter agency',
          'language service provider',
        ],
        workflowAnchors: [
          'interpreter availability',
          'assignment matching',
          'assignment details',
          'client communication preference',
          'specialized vocabulary',
          'session notes',
          'schedule change',
          'scheduling conflict',
          'missed assignment',
          'cancellation',
          'client requirement',
        ],
        excludedAnchors: [
          'sign language translator app',
          'learn asl app',
          'camera translator',
          'generic employee scheduling app',
          'time clock',
          'clock in',
          'password reset',
          'mobile app crash',
          'github issue',
        ],
      };
    }

    const scoredCrossDomain = this.resolveScoredCrossDomainConstraint(
      requestText || text,
    );
    if (scoredCrossDomain) {
      return scoredCrossDomain;
    }

    const subscriptionRevenueRetention =
      /\b(?:online subscription businesses?|subscription businesses?|subscription companies?|subscription services?|subscription platforms?|saas businesses?|saas companies?|membership businesses?)\b/u.test(requestText) &&
      /\b(?:customer cancellations?|customers? cancel|churn|churn risk|renewal history|renewals?|retention|retention offers?|recurring revenue|subscription payments?|discount usage|pricing plans?|pricing tiers?|product usage|support interactions?|refund activity|financial forecasts?|forecasting)\b/u.test(requestText) &&
      /\b(?:why customers? cancel|likely to leave|churn risk|retention offers?|unprofitable pricing plans?|pricing plans? .* unprofitable|recurring revenue|financial forecasts?|renewal behavior)\b/u.test(requestText);
    if (subscriptionRevenueRetention) {
      return {
        kind: 'SUBSCRIPTION_REVENUE_RETENTION',
        label: 'subscription churn retention and recurring-revenue intelligence',
        strict: true,
        requiredAnchors: [
          'subscription business',
          'subscription company',
          'subscription service',
          'saas company',
          'recurring revenue',
          'customer churn',
        ],
        workflowAnchors: [
          'customer cancellation',
          'churn',
          'churn risk',
          'renewal history',
          'retention',
          'retention offer',
          'subscription payment',
          'discount usage',
          'pricing plan',
          'pricing profitability',
          'product usage',
          'support interaction',
          'refund activity',
          'recurring revenue',
          'financial forecast',
        ],
        excludedAnchors: [
          'cannot access app',
          'account access blocked',
          'refund request blocked',
          'restore purchase',
          'password reset',
          'login failure',
        ],
      };
    }

    const ecommerceMarginProfitability =
      /\b(?:online retailers?|online stores?|e-?commerce|ecommerce merchants?|online merchants?|shopify merchants?|digital retailers?)\b/u.test(text) &&
      /\b(?:profit margins?|margin change|margin erosion|contribution margin|net profit|gross revenue|profitability|campaign profitability|profitable products?|profitable campaigns?)\b/u.test(text) &&
      /\b(?:product discounts?|advertising costs?|ad spend|returns?|refunds?|payment fees?|gateway fees?|shipping expenses?|shipping costs?|fulfillment costs?|customer purchasing behavior|pricing decisions?)\b/u.test(text);
    if (ecommerceMarginProfitability) {
      return {
        kind: 'ECOMMERCE_MARGIN_PROFITABILITY',
        label: 'e-commerce margin attribution and profitability operations',
        strict: true,
        requiredAnchors: ['online retailer', 'e-commerce', 'ecommerce merchant', 'online store', 'merchant'],
        workflowAnchors: [
          'profit margin',
          'contribution margin',
          'net profit',
          'gross revenue',
          'product discount',
          'advertising cost',
          'ad spend',
          'return',
          'refund',
          'payment fee',
          'shipping expense',
          'fulfillment cost',
          'campaign profitability',
          'pricing decision',
        ],
        excludedAnchors: [
          'receipt photo',
          'expense receipt',
          'healthcare complaint',
          'app crash',
          'authentication',
        ],
      };
    }

    /*
     * Security/transaction abuse is causally more specific than generic media
     * profitability. Resolve it before the media revenue family so terms such
     * as subscription/revenue cannot reclassify an account-theft/refund-abuse
     * request as content-performance economics.
     */
    const requestTransactionAccountAbuse =
      /\b(?:platforms?|services?|systems?|accounts?|subscriptions?|ordering|marketplaces?|payments?)\b/u.test(requestText) &&
      /\b(?:account theft|account takeover|compromised accounts?|fraudulent subscriptions?|unauthorized refunds?|unauthorised refunds?|payment abuse|fraudulent orders?|refund abuse|suspicious activity|security alerts?|chargebacks?|fraudulent payments?)\b/u.test(requestText) &&
      /\b(?:financial impact|financial losses?|revenue leakage|chargebacks?|refunds?|payments?|fraud|abuse|account restrictions?|coordinated patterns?|coordinated abuse)\b/u.test(requestText);
    if (requestTransactionAccountAbuse) {
      const identityAnchors = this.resolveRequestIdentityAnchors(requestText);
      const requestOwnedIdentity = [
        ...intentProfile.actorIdentityTerms,
        ...intentProfile.objectIdentityTerms,
      ];
      const requestOwnedWorkflow = [
        ...intentProfile.workflowIdentityTerms,
        ...intentProfile.failureIdentityTerms,
        ...intentProfile.outcomeIdentityTerms,
      ];
      return {
        kind: 'TRANSACTION_ACCOUNT_ABUSE',
        label: 'request-defined transaction account abuse and financial-impact investigation',
        strict: true,
        requiredAnchors: [...new Set([
          ...identityAnchors,
          ...requestOwnedIdentity,
        ])].filter(Boolean).slice(0, 12),
        workflowAnchors: [...new Set([
          ...requestOwnedWorkflow,
          'unauthorized account access',
          'account takeover',
          'fraudulent subscription',
          'unauthorized refund',
          'payment abuse',
          'security alert',
          'suspicious activity',
          'coordinated fraud',
          'fraud investigation',
          'financial loss',
          'revenue leakage',
          'chargeback',
          'false positive restriction',
        ])].filter(Boolean).slice(0, 22),
        excludedAnchors: [
          'smart agriculture',
          'smart farm',
          'crop',
          'irrigation',
          'manufacturing',
          'shipment chain of custody',
        ],
      };
    }

    const mediaContentProfitability =
      /\b(?:streaming and digital entertainment companies?|streaming companies?|streaming services?|streaming platforms?|digital entertainment companies?|digital entertainment platforms?|entertainment platforms?|media and entertainment companies?|media companies?|digital content platforms?|content platforms?|video platforms?|gaming platforms?|game platforms?)\b/u.test(text) &&
      /\b(?:content profitability|sustainable revenue|subscription activity|subscription revenue|advertising income|ad revenue|production costs?|viewing behavior|viewer behavior|content engagement|browsing behavior|content discovery|discover content|purchases?|purchase abandonment|checkout abandonment|paid experiences?|conversion|transaction history|cancellations?|churn|promotional campaigns?|offers?|customer feedback|content recommendations?|missed sales|marketing spend|financial return|revenue forecasts?|content investment|investment decisions?)\b/u.test(text);
    if (mediaContentProfitability) {
      return {
        kind: 'MEDIA_CONTENT_PROFITABILITY',
        label: 'digital entertainment conversion, subscription and revenue attribution',
        strict: true,
        requiredAnchors: [
          'streaming service',
          'streaming platform',
          'digital entertainment platform',
          'digital entertainment',
          'media and entertainment',
          'digital content platform',
          'video platform',
          'gaming platform',
          'game platform',
          'paid content',
          'netflix',
          'hulu',
          'disney+',
          'prime video',
        ],
        workflowAnchors: [
          'purchase abandonment',
          'checkout abandonment',
          'paid experience',
          'conversion',
          'conversion funnel',
          'transaction history',
          'browsing behavior',
          'content discovery',
          'content engagement',
          'subscription',
          'subscriber churn',
          'cancellation',
          'promotional campaign',
          'offer',
          'customer feedback',
          'content recommendation',
          'missed sales',
          'marketing spend',
          'revenue',
          'profitability',
        ],
        excludedAnchors: [
          'llm streaming',
          'streaming llm',
          'large language model',
          'first token',
          'token streaming',
          'next.js',
          'openai api',
          'digital teaching platform',
          'education platform',
          'mental health',
          'body image',
          'b2b marketing',
          'sales call',
          'microsoft fabric',
          'standard operating procedure',
          'brompton',
          'carmax',
          'automotive retail',
          'car shopping',
          'vehicle buying',
        ],
      };
    }

    const transportationCostProfitability =
      /\b(?:transportation companies?|transport companies?|transport operators?|transportation operators?|fleet operators?|fleet managers?|transit operators?|passenger transport companies?|bus companies?|delivery fleets?|commercial fleets?)\b/u.test(text) &&
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|maintenance costs?|maintenance expenses?|route performance|route profitability|route margins?|driver schedules?|ticket revenue|fare revenue|delivery revenue|vehicle utilization|fleet utilization|pricing decisions?|financial forecasts?|profitability|margin erosion|cost variance|cost increases?|cost spikes?)\b/u.test(text);
    if (transportationCostProfitability) {
      return {
        kind: 'TRANSPORTATION_COST_PROFITABILITY',
        label: 'transportation route and fleet cost profitability operations',
        strict: true,
        requiredAnchors: [
          'transportation company',
          'transport operator',
          'transportation operator',
          'fleet operator',
          'fleet manager',
          'transit operator',
          'delivery fleet',
        ],
        workflowAnchors: [
          'operating cost',
          'fuel expense',
          'fuel cost',
          'maintenance cost',
          'route performance',
          'route profitability',
          'route margin',
          'driver schedule',
          'ticket revenue',
          'fare revenue',
          'delivery revenue',
          'vehicle utilization',
          'fleet utilization',
          'pricing decision',
          'financial forecast',
          'margin erosion',
          'cost variance',
        ],
        excludedAnchors: [
          'bus arrival app',
          'route planner app',
          'app crash',
          'server address',
          'login failure',
          'ui update',
          'night mode',
          'word processor',
          'markdown editor',
        ],
      };
    }

    const bookRestorationConservationRequest =
      /\b(?:antique books?|rare books?|historic books?|historical books?|book restoration specialists?|book restorers?|book conservators?|paper conservators?|book conservation workshops?|book restoration workshops?)\b/u.test(requestText) &&
      /\b(?:damaged bindings?|missing pages?|paper condition|previous repairs?|repair history|original materials?|restoration progress|restoration history|conservation treatment|condition assessment|condition report|customer preservation preferences?|preservation preferences?|replacement materials?)\b/u.test(requestText);

    const bookCoverCommissionSpecification =
      !bookRestorationConservationRequest &&
      /\b(?:book cover craftsmen?|book cover makers?|bookbinders?|custom bookbinders?|bookbinding craftsmen?|bookbinding artisans?|binderies?|bindery workshops?|bookbinding workshops?|book edge gilding specialists?|book edge gilders?|fore[- ]edge gilding specialists?|book gilding specialists?)\b/u.test(text) &&
      /\b(?:client artwork|book dimensions?|cover dimensions?|material selections?|material choices?|embossing details?|foil stamping|foil selections?|gold[- ]leaf selections?|gold leaf selections?|decorative patterns?|surface preparation notes?|finish specifications?|approved finish|color preferences?|colour preferences?|revision requests?|revision details?|approved specifications?|final approved specifications?|customer approvals?|completion deadlines?|wasted materials?|repeated work|damaged books?|delayed orders?|incorrect materials?|incorrect dimensions?|missed design details?)\b/u.test(text);
    if (bookCoverCommissionSpecification) {
      return {
        kind: 'BOOK_COVER_COMMISSION_SPECIFICATION',
        label: 'bookbinding commission specification and approval operations',
        strict: true,
        requiredAnchors: [
          'book cover craftsman',
          'book cover maker',
          'bookbinder',
          'custom bookbinder',
          'bookbinding craftsman',
          'bindery',
          'bookbinding workshop',
          'book edge gilding specialist',
          'book edge gilder',
          'fore-edge gilding specialist',
          'book gilding specialist',
        ],
        workflowAnchors: [
          'client artwork',
          'book dimension',
          'cover dimension',
          'material selection',
          'embossing',
          'foil stamping',
          'foil selection',
          'gold leaf selection',
          'decorative pattern',
          'surface preparation',
          'approved finish',
          'color preference',
          'revision request',
          'approved specification',
          'customer approval',
          'completion deadline',
          'wasted material',
          'repeated work',
          'delayed order',
        ],
        excludedAnchors: [
          'goodreads',
          'star rating',
          'reading dates',
          'wattpad cover app',
          'book cover maker app',
          'paywall',
          'app crash',
          'template editor',
        ],
      };
    }

    const governmentRecordAccessIntegrity =
      /\b(?:government agencies?|government departments?|public sector agencies?|public authorities?|regulatory agencies?|licensing authorities?)\b/u.test(text) &&
      /\b(?:legal records?|licensing documents?|citizen applications?|regulatory files?|official records?|public records?|permit records?|case files?)\b/u.test(text) &&
      /\b(?:unauthorized access|unauthorised access|manipulation|tamper(?:ing|ed)?|access logs?|document histor(?:y|ies)|employee activity|security alerts?|suspicious changes?|who accessed|incident investigation|audit trail)\b/u.test(text);
    if (governmentRecordAccessIntegrity) {
      return {
        kind: 'GOVERNMENT_RECORD_ACCESS_INTEGRITY',
        label: 'government sensitive-record access and integrity investigation',
        strict: true,
        requiredAnchors: [
          'government agency',
          'government department',
          'public sector',
          'public authority',
          'regulatory agency',
          'licensing authority',
        ],
        workflowAnchors: [
          'legal record',
          'licensing document',
          'citizen application',
          'regulatory file',
          'official record',
          'access log',
          'document history',
          'employee activity',
          'security alert',
          'unauthorized access',
          'suspicious change',
          'tamper',
          'who accessed',
          'incident investigation',
          'audit trail',
        ],
        excludedAnchors: [
          'municipal public works',
          'road repair',
          'streetlight',
          'citizen complaint repair',
          'payment page',
          'mobile app navigation',
        ],
      };
    }

    const tourismActor = /\b(?:tourism authorities?|tourism boards?|destination management|tourist destinations?|tourism offices?|visitor management|tourism|tourist|visitors?|destinations?|attractions?)\b/u.test(text);
    const tourismWorkflow = /\b(?:overcrowd|crowding|congestion|seasonal demand|visitor behavior|visitor feedback|visitor complaints?|attraction usage|resource allocation|public transport|local communit|destination pressure|tourism pressure|visitor experience)\w*\b/u.test(text);
    if (tourismActor && tourismWorkflow) {
      return {
        kind: 'TOURISM_DESTINATION',
        label: 'tourism destination operations',
        strict: true,
        requiredAnchors: [
          'tourism',
          'tourist',
          'visitor',
          'destination',
          'attraction',
        ],
        workflowAnchors: [
          'overcrowd',
          'crowding',
          'congestion',
          'seasonal demand',
          'visitor feedback',
          'visitor complaint',
          'resource allocation',
          'public transport',
          'local community',
          'tourism pressure',
          'overtourism',
          'visitor experience',
        ],
        excludedAnchors: [],
      };
    }


    const restaurantDeliveryFraud =
      /\b(?:restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|online food ordering services?|meal delivery platforms?|restaurant courier platforms?)\b/u.test(requestText) &&
      /\b(?:suspicious orders?|account takeovers?|account takeover|refund abuse|fraudulent refunds?|promotional abuse|promo(?:tional)? fraud|promo code abuse|payment behavior|device information|device signals?|device fingerprints?|customer complaints?|security alerts?|false positives?|blocked legitimate (?:users?|customers?)|coordinated abuse|fraud detection)\b/u.test(requestText);
    if (restaurantDeliveryFraud) {
      return {
        kind: 'RESTAURANT_DELIVERY_FRAUD',
        label: 'restaurant delivery fraud and account security operations',
        strict: true,
        requiredAnchors: [
          'restaurant delivery',
          'food delivery',
          'online food ordering',
          'meal delivery',
          'delivery app',
        ],
        workflowAnchors: [
          'suspicious order',
          'account takeover',
          'refund abuse',
          'fraudulent refund',
          'promotional abuse',
          'promo abuse',
          'promo fraud',
          'payment behavior',
          'device signal',
          'device information',
          'customer complaint',
          'security alert',
          'false positive',
          'blocked legitimate',
          'coordinated abuse',
          'fraud detection',
        ],
        excludedAnchors: [
          'carrier scan',
          'proof of delivery',
          'shipping address',
          'warehouse handoff',
          'parcel tracking',
          'shipment chain of custody',
          'lost merchandise',
          'freight cargo',
        ],
      };
    }

    const shipmentChainOfCustody =
      /\b(?:global supply chain|supply chain|shipment|shipments|cargo|carriers?|warehouses?|customs)\b/u.test(text) &&
      /\b(?:handover|handovers|chain of custody|custody transfer|tampered records?|record tampering|altered tracking|tracking information has been altered|trusted history|ownership records?|document provenance|fraudulent delivery claims?|shipment incident|lost goods)\b/u.test(text);
    if (shipmentChainOfCustody) {
      return {
        kind: 'SHIPMENT_CHAIN_OF_CUSTODY',
        label: 'shipment traceability and chain-of-custody operations',
        strict: true,
        requiredAnchors: [
          'shipment',
          'cargo',
          'supply chain',
          'carrier',
          'warehouse',
          'customs',
        ],
        workflowAnchors: [
          'handover',
          'chain of custody',
          'custody transfer',
          'tampered',
          'record tampering',
          'altered tracking',
          'tracking history',
          'ownership record',
          'document provenance',
          'audit trail',
          'fraudulent delivery',
          'delivery claim',
          'dispute',
          'lost goods',
          'location update',
          'incident attribution',
        ],
        excludedAnchors: [
          'app crash',
          'application crash',
          'screen freeze',
          'ui bug',
        ],
      };
    }

    const eyeglassFrameRepair =
      /\b(?:eyeglass frame repair specialists?|eyeglass repair specialists?|eyewear repair specialists?|optical frame repair specialists?|spectacle frame repair specialists?|glasses repair specialists?)\b/u.test(requestText) &&
      /\b(?:frame damage|previous repairs?|repair history|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|customer fit|adjustment notes?|repeated adjustments?|pickup dates?|promised pickup|delayed pickups?)\b/u.test(requestText);
    if (eyeglassFrameRepair) {
      return {
        kind: 'PHYSICAL_SERVICE_VERTICAL',
        label: 'eyeglass frame repair history parts fit and pickup operations',
        strict: true,
        requiredAnchors: [
          'eyeglass frame', 'eyeglass repair', 'eyewear repair', 'optical frame',
          'spectacle frame', 'glasses repair',
        ],
        workflowAnchors: [
          'frame damage', 'previous repair', 'repair history', 'replacement hinge',
          'replacement part', 'color matching', 'colour matching', 'fit preference',
          'adjustment note', 'repeated adjustment', 'pickup date', 'promised pickup',
        ],
        excludedAnchors: [
          'leather bag', 'leather goods', 'handbag repair', 'shoe repair',
        ],
      };
    }

    const customMosaicService =
      /\b(?:independent mosaic artists?|mosaic artists?|mosaic makers?|mosaic studios?|mosaic workshops?|custom mosaic|mosaic commissions?)\b/u.test(text) &&
      /\b(?:design references?|tile materials?|color combinations?|dimensions?|installation requirements?|revision requests?|approved version|final approved version|customer approval|incorrect patterns?|wasted materials?|repeated work|customization details?|delayed installations?)\b/u.test(text);
    if (customMosaicService) {
      return {
        kind: 'CUSTOM_MOSAIC_SERVICE',
        label: 'custom mosaic commission specification and approval operations',
        strict: true,
        requiredAnchors: [
          'mosaic artist',
          'mosaic maker',
          'mosaic studio',
          'mosaic workshop',
          'custom mosaic',
          'mosaic commission',
        ],
        workflowAnchors: [
          'design reference',
          'tile material',
          'color combination',
          'dimension',
          'installation requirement',
          'revision request',
          'approved version',
          'customer approval',
          'incorrect pattern',
          'wasted material',
          'repeated work',
          'customization detail',
          'completion deadline',
          'delayed installation',
        ],
        excludedAnchors: [
          'digital mosaic filter',
          'photo mosaic app',
          'image mosaic effect',
        ],
      };
    }

    const manufacturingCostProfitability =
      /\b(?:manufacturing companies?|manufacturers?|manufacturing plants?|factories|factory|industrial plants?|production lines?)\b/u.test(requestText) &&
      /\b(?:production costs?|raw material expenses?|raw material costs?|machine downtime|labor costs?|labour costs?|defect rates?|scrap rates?|maintenance spending|maintenance costs?|supplier prices?|supplier costs?|cost variance|cost forecasts?|profitability)\w*\b/u.test(requestText);
    if (manufacturingCostProfitability) {
      return {
        kind: 'MANUFACTURING_COST_PROFITABILITY',
        label: 'manufacturing production cost variance and profitability operations',
        strict: true,
        requiredAnchors: [
          'manufacturing',
          'manufacturer',
          'factory',
          'industrial production',
          'production line',
          'shop floor',
        ],
        workflowAnchors: [
          'production cost',
          'manufacturing cost',
          'raw material cost',
          'raw material variability',
          'machine downtime',
          'labor cost',
          'labour cost',
          'defect rate',
          'scrap rate',
          'maintenance cost',
          'maintenance spending',
          'supplier price',
          'supplier cost',
          'cost variance',
          'cost forecast',
          'bottleneck',
          'cost per unit',
          'profitability',
          'margin',
        ],
        excludedAnchors: [
          'cybersecurity',
          'malware',
          'phishing',
          'raw material test method',
          'bacterial cellulose',
          'fashion sustainability',
        ],
      };
    }

    const industrialEnergyEquipmentHealth =
      /\b(?:manufacturing plants?|manufacturers?|factories|factory|industrial plants?|production lines?|plant operators?|plant engineers?)\b/u.test(requestText) &&
      /\b(?:electricity usage|electricity consumption|energy consumption|energy usage|power draw|power consumption|electricity costs?|energy costs?|kwh|kilowatt|smart meter|submeter)\w*\b/u.test(requestText) &&
      /\b(?:machines?|equipment|equipment sensors?|machine sensors?|operating hours?|runtime|maintenance records?|maintenance history|production schedules?|equipment condition|machine condition|telemetry)\b/u.test(requestText) &&
      /\b(?:unusually high|abnormal|anomal(?:y|ies)|energy spike|power spike|losing efficiency|efficiency loss|efficiency decline|degradation|predictive maintenance|before (?:a )?failure|impending failure|breakdowns?|downtime|production interruptions?|unnecessary maintenance|electricity costs?|energy costs?)\b/u.test(requestText);
    if (industrialEnergyEquipmentHealth) {
      return {
        kind: 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH',
        label: 'industrial machine energy efficiency and equipment health operations',
        strict: true,
        requiredAnchors: [
          'factory',
          'manufacturing plant',
          'industrial plant',
          'machine',
          'industrial equipment',
          'plant operator',
          'plant engineer',
        ],
        workflowAnchors: [
          'equipment sensor',
          'machine sensor',
          'electricity usage',
          'electricity consumption',
          'energy consumption',
          'power draw',
          'operating hours',
          'maintenance record',
          'maintenance history',
          'production schedule',
          'equipment condition',
          'machine condition',
          'energy anomaly',
          'power spike',
          'efficiency loss',
          'predictive maintenance',
          'equipment failure',
          'breakdown',
          'downtime',
          'production interruption',
          'unnecessary maintenance',
          'electricity cost',
        ],
        excludedAnchors: [
          'material scrap',
          'raw material waste',
          'recycling',
          'circular economy',
          'plastic waste',
          'wastewater',
          'aquarium',
          'fish tank',
          'software crash',
          'application crash',
        ],
      };
    }

    const manufacturingWasteSustainability =
      /\b(?:manufacturing plants?|manufacturers?|factories|factory|industrial plants?|production lines?)\b/u.test(requestText) &&
      /\b(?:material waste|scrap|scrap records?|raw material consumption|material losses?|yield loss|quality defects?|production defects?|rework|emissions?|environmental impact|waste reduction|material efficiency|circularity|production waste)\b/u.test(requestText);
    if (manufacturingWasteSustainability) {
      return {
        kind: 'MANUFACTURING_WASTE_SUSTAINABILITY',
        label: 'manufacturing material waste and sustainability operations',
        strict: true,
        requiredAnchors: [
          'manufacturing',
          'factory',
          'industrial plant',
          'production line',
        ],
        workflowAnchors: [
          'scrap',
          'material waste',
          'raw material consumption',
          'machine output',
          'quality defect',
          'rework',
          'energy usage',
          'energy consumption',
          'emission',
          'environmental impact',
          'production efficiency',
          'yield loss',
        ],
        excludedAnchors: [
          'ransomware',
          'cyberattack',
          'unauthorized access',
          'authentication',
        ],
      };
    }

    const customEngravingService =
      /\b(?:engraving businesses?|engraving shops?|engraving studios?|engravers?|custom engraving|laser engraving)\b/u.test(text) &&
      /\b(?:customer artwork|text details?|material types?|object dimensions?|font preferences?|placement instructions?|revision requests?|approved design|approved version|spelling mistakes?|incorrect placement|wasted materials?)\b/u.test(text);
    if (customEngravingService) {
      return {
        kind: 'CUSTOM_ENGRAVING_SERVICE',
        label: 'custom engraving specification and approval operations',
        strict: true,
        requiredAnchors: [
          'engraving',
          'engraver',
          'custom engraving',
          'laser engraving',
        ],
        workflowAnchors: [
          'customer artwork',
          'text detail',
          'spelling',
          'material type',
          'object dimension',
          'font preference',
          'placement instruction',
          'revision request',
          'approved design',
          'approved version',
          'rework',
          'wasted material',
          'delayed order',
        ],
        excludedAnchors: [
          'embroidery',
          'thread color',
          'garment size',
          'stitching',
        ],
      };
    }

    const buildingEnvironmentalMonitoring =
      /\b(?:property managers?|building managers?|facility managers?|maintenance teams?|residential complexes?|apartment complexes?|housing complexes?|multi[- ]family buildings?|residential buildings?|apartment buildings?|property operations?)\b/u.test(text) &&
      /\b(?:temperature|humidity|water usage|water consumption|air quality|indoor air quality|equipment readings?|sensor readings?|environmental performance|environmental monitoring|building conditions?|abnormal conditions?|leak detection|water waste|iaq|iot|internet of things|telemetry|sensors?)\b/u.test(text);
    if (buildingEnvironmentalMonitoring) {
      return {
        kind: 'BUILDING_ENVIRONMENTAL_MONITORING',
        label: 'residential building environmental condition monitoring',
        strict: true,
        requiredAnchors: [
          'property manager',
          'building manager',
          'maintenance team',
          'residential complex',
          'apartment complex',
          'housing complex',
          'residential building',
          'apartment building',
        ],
        workflowAnchors: [
          'temperature',
          'humidity',
          'water usage',
          'water consumption',
          'air quality',
          'indoor air quality',
          'equipment reading',
          'sensor reading',
          'environmental monitoring',
          'environmental performance',
          'abnormal condition',
          'leak detection',
          'water waste',
          'telemetry',
          'iot',
        ],
        excludedAnchors: [
          'rental income',
          'cash flow',
          'mortgage interest',
          'payment reconciliation',
          'duplicate charge',
          'bank statement',
          'noi',
        ],
      };
    }

    const farmEnergyOperations =
      /\b(?:large farms?|farms?|farm operators?|farm managers?|agricultural enterprises?|agricultural operations?|agriculture)\b/u.test(requestText) &&
      /\b(?:electricity|energy consumption|energy usage|power consumption|irrigation pumps?|cold[- ]storage|greenhouses?|processing equipment|equipment performance|crop schedules?|weather conditions?|production demand)\b/u.test(requestText) &&
      /\b(?:energy waste|wasted energy|higher operating costs?|operating costs?|inefficient equipment|equipment use|unnecessary energy consumption|farm profitability|adjusted first|prioritiz(?:e|ing)|optimization|efficiency)\w*\b/u.test(requestText);
    if (farmEnergyOperations) {
      return {
        kind: 'FARM_ENERGY_OPERATIONS',
        label: 'farm energy consumption and equipment efficiency operations',
        strict: true,
        requiredAnchors: [
          'farm',
          'farms',
          'agriculture',
          'agricultural',
          'irrigation',
          'greenhouse',
        ],
        workflowAnchors: [
          'electricity',
          'energy use',
          'energy usage',
          'energy consumption',
          'energy demand',
          'power consumption',
          'irrigation pump',
          'cold storage',
          'greenhouse',
          'processing equipment',
          'equipment performance',
          'crop schedule',
          'weather condition',
          'production demand',
          'energy waste',
          'energy efficiency',
          'operating cost',
          'farm profitability',
        ],
        excludedAnchors: [
          'produce spoilage',
          'transport delay',
          'delivery delay',
          'shipment tracking',
          'cold chain logistics',
          'farm pickup',
          'market delivery',
          'commercial building',
          'office building',
          'hvac',
        ],
      };
    }

    const commercialBuildingEnergy =
      /\b(?:commercial buildings?|office buildings?|office complexes?|facility teams?|facility managers?|building operators?|building managers?)\b/u.test(requestText) &&
      /\b(?:electricity|energy consumption|utility bills?|utility costs?|smart meters?|submeters?|heating|hvac|elevators?|lighting|office equipment|equipment usage|consumption spikes?|abnormal usage|energy waste|energy efficiency|equipment downtime|meter readings?)\b/u.test(requestText);
    if (commercialBuildingEnergy) {
      return {
        kind: 'COMMERCIAL_BUILDING_ENERGY',
        label: 'commercial building energy and equipment operations',
        strict: true,
        requiredAnchors: ['commercial building', 'office building', 'facility', 'facility manager', 'building operator'],
        workflowAnchors: ['electricity', 'energy consumption', 'utility bill', 'smart meter', 'submeter', 'hvac', 'heating', 'elevator', 'lighting', 'office equipment', 'consumption spike', 'abnormal usage', 'energy waste', 'equipment downtime'],
        excludedAnchors: [],
      };
    }

    const deliverySustainability =
      /\b(?:delivery companies?|delivery fleets?|delivery operators?|courier companies?|couriers?|last[- ]mile delivery|parcel delivery|shipping companies?)\b/u.test(text) &&
      /\b(?:fuel consumption|fuel usage|fuel costs?|emissions?|carbon emissions?|environmental impact|unnecessary mileage|vehicle routes?|traffic conditions?|failed delivery attempts?|route efficiency|route inefficien)\w*\b/u.test(text);
    if (deliverySustainability) {
      return {
        kind: 'DELIVERY_SUSTAINABILITY',
        label: 'sustainable delivery fleet and route operations',
        strict: true,
        requiredAnchors: [
          'delivery company',
          'delivery fleet',
          'delivery operator',
          'courier',
          'last mile delivery',
          'parcel delivery',
          'shipping',
        ],
        workflowAnchors: [
          'fuel consumption',
          'fuel usage',
          'fuel cost',
          'emission',
          'carbon',
          'pollution',
          'environmental impact',
          'route planning',
          'route optimization',
          'traffic',
          'failed delivery',
          'delivery attempt',
          'mileage',
          'fleet telematics',
        ],
        excludedAnchors: [
          'software development company',
          'vendor shortlist',
          'erp migration',
        ],
      };
    }

    const bridalAlterationSpecificationService =
      /\b(?:alteration specialists?|bridal alteration specialists?|clothing alteration specialists?|seamstresses?|bridal seamstresses?|dressmakers?|bridal dressmakers?|tailors?|tailoring|alteration shops?|wedding dress alterations?|bridal alterations?)\b/u.test(text) &&
      /\b(?:dress measurements?|customer measurements?|fitting notes?|requested modifications?|requested changes?|alteration requests?|fabric details?|fabric samples?|accessory requirements?|customer approvals?|approved alterations?|pickup deadlines?|pickup dates?|fitting appointments?|repeated fittings?|incorrect adjustments?|fabric damage|forgotten requests?|delayed completion)\b/u.test(text);
    if (bridalAlterationSpecificationService) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'bridal alteration fitting specification and approval operations',
        strict: true,
        requiredAnchors: [
          'bridal alteration',
          'wedding dress alteration',
          'alteration specialist',
          'clothing alteration',
          'alteration shop',
          'seamstress',
          'dressmaker',
          'tailor',
          'tailoring',
        ],
        workflowAnchors: [
          'dress measurement',
          'customer measurement',
          'fitting note',
          'fitting appointment',
          'requested modification',
          'alteration request',
          'fabric detail',
          'fabric sample',
          'accessory requirement',
          'customer approval',
          'approved alteration',
          'revision',
          'pickup deadline',
          'pickup date',
          'incorrect adjustment',
          'repeated fitting',
          'forgotten request',
          'fabric damage',
          'delayed completion',
        ],
        excludedAnchors: [
          'wedding planner app',
          'guest list app',
          'venue booking platform',
          'vendor directory',
        ],
      };
    }

    const nicheCraftProfile = RequestNicheCustomCraftUtil.resolve(input.requestDescription);
    if (nicheCraftProfile?.kind === 'VIOLIN_BOW_COMMISSION') {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: nicheCraftProfile.label,
        strict: true,
        requiredAnchors: nicheCraftProfile.directIdentityTerms,
        workflowAnchors: nicheCraftProfile.workflowTerms,
        excludedAnchors: [
          'bow hunting',
          'archery bow',
          'crossbow',
          'software bow',
          'source code',
          'github issue',
          'violin lesson',
          'music streaming',
          'concert ticket',
        ],
      };
    }

    const watchStrapSpecificationService =
      /\b(?:independent\s+)?(?:watch strap makers?|watch band makers?|custom watch strap makers?|custom watch band makers?|bespoke watch strap makers?|bespoke strap makers?|leather watch strap makers?|watch strap workshops?|watch band workshops?|watch straps?|watch bands?|leather watch straps?|leather watch bands?)\b/u.test(
        requestText,
      ) &&
      /\b(?:wrist measurements?|wrist sizes?|strap measurements?|strap lengths?|strap widths?|lug widths?|leather types?|leather selections?|material choices?|stitching styles?|stitching preferences?|buckle selections?|buckle choices?|color preferences?|colour preferences?|design revisions?|revision requests?|customer approvals?|approved specifications?|final approved specifications?|completion deadlines?|sizing errors?|wrong sizes?|incorrect materials?|repeated adjustments?|remakes?|wasted leather|wasted supplies?)\b/u.test(
        requestText,
      );
    if (watchStrapSpecificationService) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'custom watch strap specification sizing and approval operations',
        strict: true,
        requiredAnchors: [
          'watch strap',
          'watch band',
          'leather watch strap',
          'leather watch band',
          'bespoke watch strap',
          'custom watch strap',
          'watch strap maker',
          'watch band maker',
        ],
        workflowAnchors: [
          'wrist measurement',
          'wrist size',
          'strap measurement',
          'strap length',
          'strap width',
          'lug width',
          'leather type',
          'leather selection',
          'material choice',
          'stitching style',
          'buckle selection',
          'color preference',
          'colour preference',
          'design revision',
          'revision request',
          'customer approval',
          'approved specification',
          'final approved specification',
          'sizing error',
          'wrong size',
          'incorrect material',
          'remake',
          'rework',
          'wasted leather',
          'wasted supplies',
          'delayed order',
        ],
        excludedAnchors: [
          'custom workflow forms',
          'software workflow',
          'workflow engine',
          'android widget',
          'custom widget',
          'visual studio workflow',
          'rf connector',
          'radio frequency connector',
          'wearable skin',
          'source code',
          'github issue',
          'mobile app',
        ],
      };
    }

    const customFootwearSpecificationService =
      /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/u.test(
        text,
      ) &&
      /\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|approved specifications?|latest approved specifications?|completion deadlines?|sizing errors?|repeated fittings?|wasted materials?)\b/u.test(
        text,
      );
    if (customFootwearSpecificationService) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'bespoke footwear specification fitting and approval operations',
        strict: true,
        requiredAnchors: [
          'shoemaker',
          'shoe maker',
          'shoemaking',
          'bespoke shoemaker',
          'custom footwear',
          'bespoke footwear',
          'handmade shoe',
          'made to measure shoe',
          'cordwainer',
        ],
        workflowAnchors: [
          'foot measurement',
          'leather selection',
          'sole type',
          'stitching preference',
          'fitting note',
          'design revision',
          'approved specification',
          'completion deadline',
          'sizing error',
          'incorrect material',
          'repeated fitting',
          'wasted material',
          'delayed order',
        ],
        excludedAnchors: [
          'shoe repair ticket',
          'cobbler repair',
          'wardrobe',
          'closet',
          'outfit planning',
          'shoe shopping',
          'mobile app',
          'source code',
        ],
      };
    }

    const headwearSpecificationService =
      /\b(?:independent hat makers?|hat makers?|custom hat makers?|bespoke hat makers?|milliners?|millinery studios?|millinery workshops?|hat studios?|hat workshops?|custom headwear makers?)\b/u.test(text) &&
      /\b(?:head measurements?|head circumference|brim dimensions?|brim width|material choices?|color preferences?|colour preferences?|decorative details?|fitting notes?|revision requests?|approved specifications?|approved version|final approved specifications?|delivery dates?)\b/u.test(text);
    if (headwearSpecificationService) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'custom hat specification fitting and approval operations',
        strict: true,
        requiredAnchors: [
          'hat maker',
          'custom hat maker',
          'bespoke hat maker',
          'milliner',
          'millinery',
          'hat studio',
          'hat workshop',
          'custom headwear maker',
        ],
        workflowAnchors: [
          'head measurement',
          'head circumference',
          'hat size',
          'brim dimension',
          'brim width',
          'material choice',
          'color preference',
          'decorative detail',
          'fitting note',
          'revision request',
          'approved specification',
          'approved version',
          'delivery date',
          'incorrect sizing',
          'mismatched material',
          'repeated adjustment',
          'wasted supplies',
        ],
        excludedAnchors: [
          'wig',
          'hairpiece',
          'mobile game',
          'source code',
          'runtime',
        ],
      };
    }

    const tattooSpecificationService =
      /\b(?:independent tattoo artists?|tattoo artists?|tattoo studios?|tattoo shops?|tattooists?)\b/u.test(text) &&
      /\b(?:design references?|reference images?|placement preferences?|placement notes?|size requirements?|dimensions?|color choices?|colour choices?|stencils?|revision requests?|design revisions?|approved design|approved version|final approved|client approval|appointment details?|aftercare notes?|client records?)\b/u.test(text);
    if (tattooSpecificationService) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'tattoo design specification revision and approval operations',
        strict: true,
        requiredAnchors: [
          'tattoo',
          'tattoo artist',
          'tattoo studio',
          'tattoo shop',
          'tattooist',
        ],
        workflowAnchors: [
          'design reference',
          'reference image',
          'placement preference',
          'placement note',
          'size requirement',
          'dimension',
          'color choice',
          'colour choice',
          'stencil',
          'revision request',
          'design revision',
          'approved design',
          'approved version',
          'client approval',
          'appointment',
          'aftercare',
          'client record',
          'social media message',
          'sketch',
          'photograph',
        ],
        excludedAnchors: [
          'laser tattoo removal',
          'tattoo removal clinic',
          'source code',
          'runtime',
        ],
      };
    }

    const customInstrumentCaseSpecification =
      /\b(?:independent\s+)?(?:musical\s+)?instrument case makers?|custom instrument case makers?|bespoke instrument case makers?|instrument case workshops?|violin case makers?|guitar case makers?|cello case makers?\b/u.test(requestText) &&
      /\b(?:measurements?|instrument shapes?|padding|foam|lining|materials?|hardware|design revisions?|approved specifications?|dimensions?|completion deadlines?|customer messages?)\b/u.test(requestText);
    if (customInstrumentCaseSpecification) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'custom musical instrument case specification and approval operations',
        strict: true,
        requiredAnchors: [
          'instrument case',
          'musical instrument case',
          'violin case',
          'viola case',
          'cello case',
          'guitar case',
          'double bass case',
          'custom fitted case',
          'instrument flight case',
        ],
        workflowAnchors: [
          'measurement',
          'dimension',
          'instrument shape',
          'padding',
          'foam',
          'lining',
          'material',
          'hardware',
          'hinge',
          'latch',
          'handle',
          'design revision',
          'approved specification',
          'customer approval',
          'sign-off',
          'deadline',
          'customer message',
          'sketch',
          'photograph',
        ],
        excludedAnchors: [
          'texas instruments',
          'scientific instrument',
          'laboratory instrument',
          'medical instrument',
          'precision instrument',
          'optical instrument',
          'financial instrument',
          'instrument jewel',
          'experimental psychology',
          'camera case',
          'computer case',
          'phone case',
          'raspberry pi',
          'electronic enclosure',
        ],
      };
    }

    const genericCustomCommissionService =
      (intentProfile.family === 'CUSTOM_COMMISSION' || intentProfile.family === 'SPECIFICATION_APPROVAL') &&
      /\b(?:independent|small|custom|local)?\s*[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,4}\s+(?:studios?|workshops?|shops?|makers?|artisans?|artists?|businesses?|specialists?|cutters?|framers?|luthiers?|archetiers?)\b/u.test(requestText) &&
      /\b(?:custom commissions?|commissions?|custom orders?|made[- ]to[- ]order|bespoke work|design references?|reference images?|dimensions?|measurements?|playing preferences?|material selections?|wood selections?|hair types?|balance requirements?|grip materials?|personalization details?|placement instructions?|revision requests?|design revisions?|design adjustments?|approved design|approved version|final approved|customer approval|completion deadlines?)\b/u.test(requestText) &&
      /\b(?:incorrect colors?|wrong colors?|incorrect dimensions?|wrong dimensions?|incorrect balance|wrong balance|unsuitable materials?|misspelled names?|spelling mistakes?|wrong placement|incorrect placement|wasted materials?|wasted supplies?|repeated work|repeated adjustments?|remakes?|rework|missed design changes?|missed revisions?|delayed customer orders?|delayed orders?|delayed commissions?|delayed completion|wrong version|outdated version)\b/u.test(requestText);
    if (genericCustomCommissionService) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'custom commission specification and approval operations',
        strict: true,
        requiredAnchors:
          nicheCraftProfile?.directIdentityTerms.length
            ? nicheCraftProfile.directIdentityTerms
            : [
                'studio',
                'workshop',
                'maker',
                'artisan',
                'artist',
                'specialist',
                'framer',
                'mat cutting',
                'custom order',
                'commission',
              ],
        workflowAnchors: [
          'design reference',
          'reference image',
          'color choice',
          'item size',
          'dimension',
          'measurement',
          'personalization',
          'painting instruction',
          'placement instruction',
          'material',
          'revision request',
          'approved design',
          'approved version',
          'customer approval',
          'pickup date',
          'delivery date',
          'incorrect color',
          'misspelled name',
          'wasted material',
          'repeated work',
        ],
        excludedAnchors: [
          'mobile game',
          'play button',
          'in app purchase',
          'source code',
          'runtime',
        ],
      };
    }

    const wigSpecificationService =
      /\b(?:independent wig makers?|wig makers?|custom wig makers?|wig artisans?|wig studios?|hairpiece makers?)\b/u.test(text) &&
      /\b(?:customer measurements?|hair texture preferences?|color choices?|colour choices?|cap specifications?|styling requests?|fitting notes?|revision history|approved specifications?)\b/u.test(text);
    if (wigSpecificationService) {
      return {
        kind: 'CUSTOM_SPECIFICATION_SERVICE',
        label: 'wig making custom order and fitting operations',
        strict: true,
        requiredAnchors: [
          'wig maker',
          'custom wig',
          'wig artisan',
          'wig studio',
          'hairpiece maker',
        ],
        workflowAnchors: [
          'customer measurement',
          'head measurement',
          'hair texture',
          'color choice',
          'cap specification',
          'cap size',
          'styling request',
          'fitting note',
          'fitting history',
          'revision history',
          'approved specification',
          'approved version',
          'material waste',
          'delayed order',
        ],
        excludedAnchors: [
          'browser extension',
          'generic notes app',
          'payment reconciliation',
        ],
      };
    }

    if (intentProfile.family === 'FACILITY_RESOURCE_MONITORING') {
      const resourceAnchors = intentProfile.objectIdentityTerms.filter((value) =>
        /(?:water|utility|electricity|energy|gas|steam|compressed air|cooling|resource)/u.test(value),
      );
      const actorAnchors = intentProfile.actorIdentityTerms.length > 0
        ? intentProfile.actorIdentityTerms
        : ['facility'];
      return {
        kind: 'FACILITY_RESOURCE_MONITORING',
        label: 'facility resource consumption monitoring anomaly and maintenance operations',
        strict: true,
        requiredAnchors: [...new Set([...actorAnchors, ...resourceAnchors])].slice(0, 10),
        workflowAnchors: [
          'water consumption', 'water usage', 'meter reading', 'water meter',
          'utility consumption', 'resource consumption', 'maintenance record',
          'equipment usage', 'facility activity', 'leak', 'abnormal consumption',
          'consumption anomaly', 'inefficient process', 'resource waste',
          'utility cost', 'equipment damage', 'environmental impact',
        ],
        excludedAnchors: [
          'surgical scheduling', 'operating room schedule', 'procedure scheduling',
          'clinical scheduling', 'patient appointment', 'medication', 'diagnosis',
          'railway rolling stock', 'petroleum drilling', 'inconel', 'metal machining',
        ],
      };
    }

    if (intentProfile.family === 'TRANSACTION_ACCOUNT_ABUSE') {
      const identityAnchors = this.resolveRequestIdentityAnchors(requestText);
      const requestOwnedIdentity = [
        ...intentProfile.actorIdentityTerms,
        ...intentProfile.objectIdentityTerms,
      ];
      const requestOwnedWorkflow = [
        ...intentProfile.workflowIdentityTerms,
        ...intentProfile.failureIdentityTerms,
        ...intentProfile.outcomeIdentityTerms,
      ];
      return {
        kind: 'TRANSACTION_ACCOUNT_ABUSE',
        label: 'request-defined transaction account abuse and investigation operations',
        strict: true,
        requiredAnchors: [...new Set([
          ...identityAnchors,
          ...requestOwnedIdentity,
        ])].filter(Boolean).slice(0, 12),
        workflowAnchors: [...new Set([
          ...requestOwnedWorkflow,
          'unauthorized account access',
          'account takeover',
          'identity verification',
          'security alert',
          'suspicious activity',
          'coordinated fraud',
          'fraud investigation',
          'fragmented records',
          'financial loss',
        ])].filter(Boolean).slice(0, 20),
        excludedAnchors: [
          'smart agriculture',
          'smart farm',
          'crop',
          'irrigation',
          'manufacturing',
          'shipment chain of custody',
        ],
      };
    }

    const transitIncidentSecurity =
      /\b(?:public transportation|public transport|transit operators?|transit agencies?|bus operators?|rail operators?|metro operators?|digital ticketing|fare systems?|passenger applications?)\b/u.test(text) &&
      /\b(?:connected vehicles?|vehicle telemetry|onboard systems?|fleet telemetry|remote vehicle monitoring|vehicle sensors?|network disruption|service disruption|cyberattack|cyber attack|technical failure|malicious interference)\w*\b/u.test(text);
    if (transitIncidentSecurity) {
      return {
        kind: 'CONNECTED_ASSET_SECURITY',
        label: 'public transportation cyber incident operations',
        strict: true,
        requiredAnchors: [
          'public transportation',
          'public transport',
          'transit',
          'bus',
          'rail',
          'metro',
          'ticketing',
          'fare',
          'passenger app',
          'vehicle telemetry',
        ],
        workflowAnchors: [
          'unusual login',
          'login anomaly',
          'payment anomaly',
          'fare payment',
          'device behavior',
          'vehicle telemetry',
          'service disruption',
          'cyberattack',
          'cyber attack',
          'cybersecurity',
          'security incident',
          'account compromise',
          'technical failure',
          'incident investigation',
          'incident response',
          'anomaly detection',
        ],
        excludedAnchors: [
          'hotel booking',
          'accommodation',
          'tour package',
          'travel price',
        ],
      };
    }

    const rentalActor =
      /\b(?:rental|rentals|hire)\s+(?:shops?|stores?|businesses?|services?|companies?)\b|\b(?:shops?|stores?|businesses?|services?|companies?)\b[^.!?]{0,70}\b(?:rental|rentals|hire)\b/iu.test(requestText);
    const rentalWorkflowAxes = [
      /\b(?:condition|damage|inspection|maintenance history|service history|servicing)\w*\b/iu,
      /\b(?:rental periods?|return dates?|expected returns?|late returns?|overdue)\w*\b/iu,
      /\b(?:accessories|parts?|deposit|deposits|charges?|fees?)\w*\b/iu,
      /\b(?:availability|available|booking|bookings|reservation|reservations|double booking|double bookings)\w*\b/iu,
    ].filter((pattern) => pattern.test(requestText)).length;
    const rentalFailure =
      /\b(?:double bookings?|missing accessories|missing parts?|overlooked damage|unrecorded damage|incorrect charges?|wrong charges?|delayed rentals?|availability conflict|booking conflict|maintenance overdue|requires? servicing)\w*\b/iu.test(requestText);
    if (rentalActor && rentalWorkflowAxes >= 2 && rentalFailure) {
      const identityAnchors = this.resolveRentalIdentityAnchors(requestText);
      return {
        kind: 'RENTAL_INVENTORY_OPERATIONS',
        label: 'rental inventory availability condition and return operations',
        strict: true,
        requiredAnchors:
          identityAnchors.length > 0
            ? identityAnchors
            : ['rental inventory', 'rental shop', 'rental business'],
        workflowAnchors: [
          'rental period', 'availability', 'return date', 'expected return',
          'deposit', 'accessory', 'condition', 'damage', 'maintenance history',
          'servicing', 'booking', 'reservation', 'double booking', 'charge',
        ],
        excludedAnchors: [
          'vacation rental', 'holiday rental', 'apartment rental', 'rental property',
          'car rental travel', 'movie rental',
        ],
      };
    }

    const decorativeFountainRestoration =
      /\b(?:decorative fountains?|ornamental fountains?|historic fountains?|fountain restoration specialists?|fountain restorers?|fountain maintenance contractors?|water features?)\b/u.test(requestText) &&
      /\b(?:pump condition|fountain pumps?|water[- ]?flow|stone damage|metal damage|metal corrosion|replacement components?|replacement parts?|finish preferences?|previous repairs?|repair history|customer requests?|restoration history)\b/u.test(requestText);
    if (decorativeFountainRestoration) {
      return {
        kind: 'PHYSICAL_SERVICE_VERTICAL',
        label: 'decorative fountain restoration service history operations',
        strict: true,
        requiredAnchors: [
          'decorative fountain',
          'ornamental fountain',
          'historic fountain',
          'fountain restoration',
          'fountain restorer',
          'water feature',
        ],
        workflowAnchors: [
          'pump condition',
          'fountain pump',
          'water flow',
          'water circulation',
          'stone damage',
          'metal damage',
          'metal corrosion',
          'replacement component',
          'replacement part',
          'finish preference',
          'previous repair',
          'repair history',
          'customer request',
          'restoration history',
        ],
        excludedAnchors: [
          'wall painting',
          'decorative laminate',
          'satoumi',
          'electronic component',
          'fountain pen',
          'software restoration',
        ],
      };
    }

    const academicPlatformSecurity =
      /\b(?:public education systems?|education systems?|schools?|school districts?|education authorities?|universities|university|higher education|online learning systems?|learning platforms?|learning management systems?|\blms\b|examination platforms?|online exams?|online assessments?|student information systems?|students?|instructors?|administrative accounts?)\b/u.test(requestText) &&
      /\b(?:login activity|login records?|sign[- ]?in activity|authentication logs?|exam sessions?|online exam sessions?|examination platforms?|account permissions?|access permissions?|administrative accounts?|device information|device data|device fingerprints?|security alerts?|account activity|student records?|record access|record changes?|academic integrity|exam integrity)\b/u.test(requestText) &&
      /\b(?:compromised accounts?|account compromise|suspicious activity|suspicious logins?|unauthorized access|unauthorised access|security incidents?|cybersecurity|detect compromised|false positives?|unnecessary restrictions?|exposed student information|academic misconduct|exam integrity)\b/u.test(requestText);
    if (academicPlatformSecurity) {
      return {
        kind: 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY',
        label: 'academic platform security and exam integrity monitoring',
        strict: true,
        requiredAnchors: [
          'public education',
          'education system',
          'school',
          'school district',
          'education authority',
          'university',
          'higher education',
          'online learning',
          'learning platform',
          'learning management system',
          'lms',
          'examination platform',
          'online exam',
          'student information system',
          'student',
        ],
        workflowAnchors: [
          'login activity',
          'authentication log',
          'exam session',
          'account permission',
          'access permission',
          'administrative account',
          'student record',
          'record access',
          'record change',
          'device information',
          'device fingerprint',
          'security alert',
          'compromised account',
          'suspicious login',
          'unauthorized access',
          'academic integrity',
          'exam integrity',
          'false positive',
          'unnecessary restriction',
        ],
        excludedAnchors: [
          'faculty workload',
          'teaching workload',
          'course staffing',
          'course assignment',
          'teaching assistant workload',
          'department staffing',
        ],
      };
    }

    const academicStaffing =
      /\b(?:universities|university departments?|academic departments?|department chairs?|faculty planners?|academic planners?|higher education)\b/u.test(requestText) &&
      /\b(?:instructors?|teaching assistants?|academic support staff|faculty workload|teaching workload|course staffing|course assignments?|student demand|course enrollment|staff availability|scheduling conflicts?|overloaded staff|expertise matching)\b/u.test(requestText);
    if (academicStaffing) {
      return {
        kind: 'ACADEMIC_OPERATIONS',
        label: 'academic staffing and teaching workload operations',
        strict: true,
        requiredAnchors: [
          'university',
          'academic department',
          'faculty',
          'instructor',
          'teaching assistant',
          'department chair',
          'higher education',
        ],
        workflowAnchors: [
          'faculty workload',
          'teaching workload',
          'course staffing',
          'course assignment',
          'course enrollment',
          'student demand',
          'staff availability',
          'instructor availability',
          'expertise',
          'scheduling conflict',
          'overloaded staff',
          'academic support',
          'teaching load',
          'workload allocation',
        ],
        excludedAnchors: [
          'student login',
          'account access',
          'payment page',
          'tuition payment',
          'lms authentication',
        ],
      };
    }

    const petTrainingOperations =
      /\b(?:independent pet trainers?|pet trainers?|dog trainers?|animal trainers?|behavior trainers?|behaviour trainers?|pet behavior consultants?|pet behaviour consultants?)\b/u.test(text) &&
      /\b(?:behavioral problems?|behavioural problems?|training exercises?|progress between sessions?|owner feedback|triggers?|recommended routines?|training sessions?|behavior history|behaviour history|home practice)\b/u.test(text);
    if (petTrainingOperations) {
      return {
        kind: 'PHYSICAL_SERVICE_VERTICAL',
        label: 'pet training behavior practice',
        strict: true,
        requiredAnchors: [
          'pet trainer',
          'dog trainer',
          'animal trainer',
          'behavior trainer',
          'behaviour trainer',
          'pet behavior consultant',
          'pet behaviour consultant',
        ],
        workflowAnchors: [
          'behavioral problem',
          'behavioural problem',
          'behavior trigger',
          'behaviour trigger',
          'training exercise',
          'training session',
          'session progress',
          'owner feedback',
          'owner instruction',
          'recommended routine',
          'home practice',
          'behavior history',
          'behaviour history',
          'session notes',
          'progress tracking',
          'repeated exercise',
          'inconsistent instruction',
        ],
        excludedAnchors: [
          'browser extension',
          'web highlight',
          'pdf highlight',
          'searchable library',
          'cash advance',
          'bank account',
          'payment method',
        ],
      };
    }


    const energyIotSecurityDiagnosis =
      /\b(?:energy providers?|electric utilities?|power utilities?|utility companies?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid|smart meter operators?)\b/u.test(text) &&
      /\b(?:connected meters?|smart meters?|remote monitoring devices?|automated control systems?|distribution automation|device failures?|meter failures?|unusual consumption|consumption anomalies?|network disruptions?|connectivity failures?|unauthorized access|access attempts?|malicious interference|cyberattack|cyber attack|telemetry|device health|network health|consumption data integrity|incident response)\b/u.test(text);
    if (energyIotSecurityDiagnosis) {
      return {
        kind: 'ENERGY_IOT_SECURITY_DIAGNOSIS',
        label: 'energy iot anomaly and incident attribution operations',
        strict: true,
        requiredAnchors: [
          'energy provider',
          'electric utility',
          'power utility',
          'grid operator',
          'electricity distribution',
          'power distribution',
          'power grid',
          'smart meter',
          'connected meter',
        ],
        workflowAnchors: [
          'connected meter',
          'smart meter',
          'remote monitoring',
          'automated control',
          'distribution automation',
          'device failure',
          'meter failure',
          'unusual consumption',
          'consumption anomaly',
          'network disruption',
          'connectivity failure',
          'unauthorized access',
          'access attempt',
          'malicious interference',
          'cyberattack',
          'telemetry',
          'device health',
          'network health',
          'consumption data integrity',
          'incident attribution',
          'root cause',
          'incident response',
        ],
        excludedAnchors: [
          'mobile payment',
          'billing app',
          'login screen',
          'subscription',
        ],
      };
    }

    const dollRestorationService =
      /\b(?:independent doll restoration specialists?|doll restoration specialists?|doll restorers?|doll restoration studios?|doll restoration workshops?|antique doll restorers?|doll repair specialists?)\b/u.test(text) &&
      /\b(?:customer requests?|damage photographs?|damage photos?|fabric selections?|replacement parts?|paint matching|restoration notes?|approved restoration|approved restoration work|material samples?|physical samples?|completion dates?|promised completion dates?|incorrect replacements?|mismatched materials?|repeated work|lost details|delayed customer orders?)\b/u.test(text);
    if (dollRestorationService) {
      return {
        kind: 'DOLL_RESTORATION_SERVICE',
        label: 'doll restoration treatment and customer approval operations',
        strict: true,
        requiredAnchors: [
          'doll restoration specialist',
          'doll restorer',
          'doll restoration studio',
          'doll restoration workshop',
          'antique doll restoration',
          'doll repair specialist',
        ],
        workflowAnchors: [
          'customer request',
          'damage photograph',
          'damage photo',
          'fabric selection',
          'replacement part',
          'paint matching',
          'restoration note',
          'approved restoration',
          'approved restoration work',
          'material sample',
          'physical sample',
          'completion date',
          'incorrect replacement',
          'mismatched material',
          'repeated work',
          'lost detail',
          'delayed customer order',
        ],
        excludedAnchors: [
          'doll repair game',
          'doll makeover game',
          'dress up game',
          'mobile game',
          'play button',
          'in app purchase',
        ],
      };
    }

    const connectedAssetSecurity =
      /\b(?:farms?|farm operators?|agriculture|manufacturing|manufacturers?|factories|industrial plants?|warehouses?|utilities|greenhouses?|irrigation systems?)\b/u.test(text) &&
      /\b(?:connected devices?|iot|internet of things|sensors?|telemetry|remote monitoring|irrigation controllers?|automated feeding|connectivity failures?|network disruption|unauthorized access|security alerts?|equipment failures?|device behavior|malicious activity)\b/u.test(text);
    if (connectedAssetSecurity) {
      return {
        kind: 'CONNECTED_ASSET_SECURITY',
        label: 'connected asset operational security',
        strict: true,
        requiredAnchors: [
          'farm',
          'agriculture',
          'irrigation',
          'greenhouse',
          'factory',
          'industrial plant',
          'facility',
          'warehouse',
          'utility',
        ],
        workflowAnchors: [
          'iot',
          'internet of things',
          'sensor',
          'telemetry',
          'connected device',
          'remote monitoring',
          'irrigation controller',
          'automated feeding',
          'connectivity failure',
          'network disruption',
          'unauthorized access',
          'security alert',
          'equipment failure',
          'device behavior',
          'malicious activity',
          'cyberattack',
          'cyber attack',
          'ransomware',
          'production anomaly',
          'machine behavior',
          'incident response',
        ],
        excludedAnchors: [],
      };
    }

    const professionalEvidenceRecords =
      /\b(?:appraisers?|valuers?|genealogists?|genealogy researchers?|family historians?|archivists?|researchers?|conservators?|provenance researchers?|auction specialists?|artifact historians?)\b/u.test(text) &&
      /\b(?:provenance|chain of custody|ownership history|authenticity|valuations?|restoration details?|historical certificates?|family records?|research notes?|source citations?|evidence trail|conflicting records?|scattered records?|auction catalogs?|duplicated research|inconsistent valuations?|missed relationships?)\b/u.test(text);
    if (professionalEvidenceRecords) {
      return {
        kind: 'PROFESSIONAL_EVIDENCE_RECORDS',
        label: 'professional evidence and provenance records',
        strict: true,
        requiredAnchors: [
          'appraiser',
          'valuation',
          'antique',
          'artifact',
          'auction',
          'provenance',
          'genealogy',
          'family history',
          'archive',
          'historical record',
        ],
        workflowAnchors: [
          'provenance',
          'chain of custody',
          'ownership history',
          'authenticity',
          'valuation',
          'restoration',
          'record',
          'document',
          'archive',
          'source citation',
          'evidence',
          'conflicting',
          'scattered',
          'duplicated research',
          'inconsistent',
          'blind spot',
        ],
        excludedAnchors: [],
      };
    }

    if (intentProfile.family === 'FOOD_STORAGE_CONDITION') {
      return {
        kind: 'FOOD_STORAGE_CONDITION',
        label: 'commercial kitchen food storage condition and spoilage risk operations',
        strict: true,
        requiredAnchors: [
          'restaurant',
          'restaurant kitchen',
          'commercial kitchen',
          'food service kitchen',
          'kitchen manager',
          'refrigerator',
          'freezer',
          'cold storage',
        ],
        workflowAnchors: [
          'refrigerator temperature',
          'freezer performance',
          'storage condition',
          'storage temperature',
          'ingredient expiration',
          'expiration date',
          'food spoilage',
          'spoiled food',
          'food waste',
          'equipment maintenance',
          'maintenance record',
          'equipment failure',
          'ingredient risk',
          'food quality',
        ],
        excludedAnchors: [
          'energy stock',
          'renewable energy stock',
          'household fridge',
          'home refrigerator',
          'warehouse fire',
          'landfill',
          'restaurant profitability',
          'profit margin',
          'revenue forecast',
        ],
      };
    }

    if (intentProfile.family === 'RESTAURANT_ENERGY') {
      return {
        kind: 'RESTAURANT_ENERGY',
        label: 'commercial kitchen energy operations',
        strict: true,
        requiredAnchors: [
          'restaurant',
          'commercial kitchen',
          'restaurant kitchen',
          'food service kitchen',
          'kitchen manager',
        ],
        workflowAnchors: [
          'electricity',
          'gas',
          'energy consumption',
          'utility bill',
          'utility cost',
          'equipment usage',
          'equipment runtime',
          'energy waste',
          'energy efficiency',
          'carbon',
          'emission',
          'consumption spike',
          'peak demand',
        ],
        excludedAnchors: [],
      };
    }

    const residentialCleaning =
      /\b(?:home[- ]cleaning businesses?|home cleaning businesses?|residential cleaning businesses?|residential cleaning services?|house cleaning businesses?|house cleaning services?|cleaning companies?|cleaning teams?)\b/u.test(text) &&
      /\b(?:customer preferences?|recurring appointments?|recurring bookings?|room[- ]specific instructions?|room instructions?|employee assignments?|cleaner assignments?|cleaning supplies?|last[- ]minute schedule changes?|schedule changes?|missed tasks?|scheduling conflicts?|forgotten customer requests?|service quality|phone calls?|messaging apps?|handwritten notes?)\b/u.test(text);
    if (residentialCleaning) {
      return {
        kind: 'RESIDENTIAL_CLEANING',
        label: 'residential cleaning operations',
        strict: true,
        requiredAnchors: [
          'home cleaning',
          'residential cleaning',
          'house cleaning',
          'cleaning service',
          'cleaning company',
          'cleaning business',
          'cleaning team',
          'cleaner',
        ],
        workflowAnchors: [
          'customer preference',
          'recurring appointment',
          'recurring booking',
          'room specific instruction',
          'room instruction',
          'employee assignment',
          'cleaner assignment',
          'cleaning supplies',
          'schedule change',
          'missed task',
          'scheduling conflict',
          'forgotten request',
          'service quality',
          'phone call',
          'messaging app',
          'handwritten note',
        ],
        excludedAnchors: [
          'home battery',
          'home batteries',
          'battery storage',
          'residential battery',
          'solar battery',
        ],
      };
    }

    const sneakerCleaningService =
      /\b(?:independent\s+)?(?:sneaker(?:\s+and\s+shoe)?\s+cleaning\s+specialists?|shoe\s+cleaning\s+specialists?|sneaker\s+cleaners?|shoe\s+cleaners?|sneaker\s+restoration\s+specialists?|shoe\s+restoration\s+specialists?|sneaker\s+cleaning\s+shops?|shoe\s+cleaning\s+shops?|sneaker\s+restoration\s+shops?|shoe\s+restoration\s+shops?)\b/u.test(text) &&
      /\b(?:customer items?|pairs?|material types?|stain conditions?|cleaning preferences?|previous treatments?|repair notes?|pickup deadlines?|service history|handwritten tags?|receipts?|customer messages?|misplaced items?|forgotten requests?|repeated treatments?|unsuitable cleaning methods?)\b/u.test(text);
    if (sneakerCleaningService) {
      return {
        kind: 'PHYSICAL_SERVICE_VERTICAL',
        label: 'sneaker and shoe cleaning service',
        strict: true,
        requiredAnchors: [
          'sneaker cleaning',
          'shoe cleaning',
          'sneaker cleaner',
          'shoe cleaner',
          'sneaker restoration',
          'shoe restoration',
          'footwear cleaning',
          'footwear restoration',
        ],
        workflowAnchors: [
          'customer item',
          'pair',
          'material type',
          'stain condition',
          'cleaning preference',
          'previous treatment',
          'treatment history',
          'repair note',
          'pickup deadline',
          'pickup date',
          'service history',
          'handwritten tag',
          'receipt',
          'customer message',
          'misplaced item',
          'forgotten request',
          'repeated treatment',
          'unsuitable cleaning method',
          'wrong cleaning method',
          'delayed pickup',
        ],
        excludedAnchors: [
          'meta ads',
          'facebook ads',
          'oil rig',
          'drilling',
          'gem catalogue',
          'product upload',
          'oem authorization',
          'shoe store',
          'sneaker release',
        ],
      };
    }

    const repairVertical = this.resolveRepairShopVertical(text);
    const typewriterRestoration =
      /\b(?:typewriter restoration specialists?|typewriter restorers?|typewriter repair specialists?|typewriter repairers?|typewriter restoration workshops?|typewriter repair shops?)\b/u.test(requestText) &&
      /\b(?:mechanical condition|missing keys?|ribbon mechanism|damaged components?|previous repairs?|repair history|cosmetic details?|replacement parts?|spare[- ]part records?|customer restoration preferences?|restoration history|repeated diagnostics?|overlooked defects?)\b/u.test(requestText);
    if (typewriterRestoration) {
      return {
        kind: 'PHYSICAL_SERVICE_VERTICAL',
        label: 'typewriter restoration condition parts and repair history operations',
        strict: true,
        requiredAnchors: [
          'typewriter',
          'typewriter restoration',
          'typewriter repair',
          'typewriter restorer',
          'typewriter repair specialist',
        ],
        workflowAnchors: [
          'mechanical condition',
          'missing key',
          'ribbon mechanism',
          'damaged component',
          'previous repair',
          'repair history',
          'replacement part',
          'spare part',
          'customer preference',
          'condition report',
          'diagnostic',
          'restoration history',
        ],
        excludedAnchors: [
          'questioned document',
          'document examination',
          'forensic document',
          'typing identification',
          'typeface identification',
        ],
      };
    }

    const violinCaseRestoration =
      /\b(?:violin case restoration specialists?|violin case restorers?|instrument case restoration specialists?|instrument case restorers?)\b/u.test(requestText) &&
      /\b(?:damaged hinges?|interior padding|fabric condition|handle repairs?|replacement hardware|previous restoration|restoration history|customer preferences?|repeated repairs?|overlooked damage|incorrect materials?)\b/u.test(requestText);
    if (violinCaseRestoration) {
      return {
        kind: 'PHYSICAL_SERVICE_VERTICAL',
        label: 'violin case restoration condition materials and repair history operations',
        strict: true,
        requiredAnchors: [
          'violin case',
          'instrument case',
          'violin case restoration',
          'instrument case restoration',
        ],
        workflowAnchors: [
          'damaged hinge',
          'interior padding',
          'fabric condition',
          'handle repair',
          'replacement hardware',
          'previous restoration',
          'restoration history',
          'repair history',
          'material',
          'customer preference',
          'overlooked damage',
          'repeated repair',
          'finish',
        ],
        excludedAnchors: [
          'document restoration',
          'document examination',
          'paper restoration',
          'image restoration',
          'audio restoration',
          'violin performance',
          'violin lesson',
        ],
      };
    }

    const restorationVertical = this.resolveRestorationServiceVertical(requestText);
    const localService = this.resolveLocalServiceVertical(text);
    const physicalWorkflow = /\b(?:customer|customers|clients?|service requests?|repair requests?|repair estimates?|technician notes?|parts?|tools?|paper tickets?|paper tags?|paper notes?|paper forms?|verbal communication|queues?|waiting times?|employee assignments?|equipment availability|pickup|pickup times?|collection dates?|approval|approved versions?|approved specifications?|final specifications?|work orders?|custom orders?|cake designs?|design references?|flavors?|flavours|allerg(?:y|ies)|dietary requirements?|cake dimensions?|decoration details?|last[- ]minute revisions?|ingredient waste|wasted ingredients?|reserved outfits?|accessories|alteration requests?|return dates?|garment condition|special event requirements?|double reservations?|costume bookings?|costume reservations?|fittings?|size mismatches?|damaged garments?|commissions?|scale requirements?|reference images?|paint details?|wording|lettering styles?|ink preferences?|reference examples?|revision requests?|design revisions?|delivery deadlines?|completion deadlines?|client messages?|customer messages?|chat messages?|social media messages?|handwritten notes?|sketches?|material samples?|repair status|furniture|furniture details?|furniture measurements?|fabric|fabric samples?|fabric selections?|fabric orders?|material quantities?|material choices?|leather types?|stitching styles?|hardware selections?|engraving details?|thread colors?|garment sizes?|placement instructions?|order quantities?|customer artwork|artwork measurements?|frame selections?|glass selections?|glass colors?|patterns?|material availability|special handling|completion dates?|promised completion dates?|design preferences?|design changes?|order changes?|wasted supplies?|wood types?|stain colors?|stain choices?|damage notes?|finish preferences?|restoration steps?|approved treatments?|final approved treatments?|treatment revisions?|cracked|damaged|missing|original color|original design|previous repairs?|replacement materials?|restoration history)\b/u.test(text);

    if (
      intentProfile.family === 'RESTORATION_CONSERVATION' &&
      restorationVertical &&
      physicalWorkflow
    ) {
      return {
        kind: 'RESTORATION_CONSERVATION',
        label: `${restorationVertical.label} condition history and treatment operations`,
        strict: restorationVertical.anchors.length > 0,
        requiredAnchors: restorationVertical.anchors,
        workflowAnchors: [
          'condition',
          'damage',
          'cracked',
          'missing section',
          'original color',
          'original design',
          'previous repair',
          'repair history',
          'restoration history',
          'replacement material',
          'material sample',
          'physical sample',
          'customer restoration preference',
          'treatment',
          'repeated work',
          'material waste',
          'delayed restoration',
        ],
        excludedAnchors: [
          'custom commission',
          'new design',
          'wrong dimensions',
          'production mistake',
          'made to order',
        ],
      };
    }

    const physicalVertical = repairVertical ?? restorationVertical ?? localService;
    if (physicalVertical && physicalWorkflow) {
      return {
        kind: 'PHYSICAL_SERVICE_VERTICAL',
        label: physicalVertical.label,
        strict: physicalVertical.anchors.length > 0,
        requiredAnchors: physicalVertical.anchors,
        workflowAnchors: [
          ...(physicalVertical.label === 'cake decorator studio'
            ? [
                'custom order',
                'cake design',
                'design reference',
                'flavor',
                'allergy note',
                'dietary requirement',
                'cake dimension',
                'decoration detail',
                'pickup time',
                'revision',
                'approved version',
                'customer message',
                'handwritten note',
                'ingredient waste',
                'rework',
              ]
            : []),
          ...(physicalVertical.label === 'costume rental wardrobe operations'
            ? [
                'costume reservation',
                'costume booking',
                'reserved outfit',
                'customer measurement',
                'size',
                'fitting',
                'accessory',
                'alteration request',
                'return date',
                'garment condition',
                'damage',
                'pickup',
                'special event',
                'double reservation',
                'wrong size',
                'missing accessory',
              ]
            : []),
          ...(physicalVertical.label === 'calligraphy commission studio'
            ? [
                'commission',
                'custom order',
                'client instruction',
                'wording',
                'lettering style',
                'paper selection',
                'ink preference',
                'reference example',
                'revision',
                'approved version',
                'approval',
                'design version',
                'client message',
                'direct message',
                'delivery deadline',
                'rework',
              ]
            : []),
          ...(physicalVertical.label === 'miniature model commission studio'
            ? [
                'custom commission',
                'scale requirement',
                'reference image',
                'material choice',
                'paint detail',
                'dimension',
                'revision request',
                'approved version',
                'final approval',
                'completion deadline',
                'incorrect proportion',
                'missed visual detail',
                'rework',
                'wasted material',
              ]
            : []),
          ...(physicalVertical.label === 'lamp restoration service'
            ? [
                'electrical condition',
                'shade measurement',
                'replacement part',
                'finish preference',
                'wiring note',
                'previous repair',
                'repair history',
                'customer request',
                'customer preference',
                'repeated diagnostic',
                'diagnostic',
                'wrong part',
                'incorrect part',
                'part mismatch',
                'forgotten request',
                'inconsistent finish',
                'delayed pickup',
                'restoration history',
              ]
            : []),
          ...(physicalVertical.label === 'custom craft workshop'
            ? [
                'custom order',
                'customer artwork',
                'design reference',
                'design revision',
                'approved version',
                'approved specification',
                'final specification',
                'material sample',
                'material choice',
                'wood type',
                'stain color',
                'damage note',
                'finish preference',
                'restoration step',
                'approved treatment',
                'treatment revision',
                'dimension',
                'measurement',
                'stitching',
                'hardware',
                'engraving',
                'thread color',
                'placement instruction',
                'order quantity',
                'completion deadline',
                'customer message',
                'handwritten note',
                'rework',
                'wasted material',
              ]
            : []),
          'work order',
          'job ticket',
          'paper ticket',
          'paper tag',
          'customer approval',
          'parts order',
          'technician notes',
          'repair status',
          'pickup',
          'collection',
          'queue',
          'employee assignment',
          'equipment availability',
          'verbal communication',
          'item condition',
          'condition photo',
          'condition assessment',
          'condition report',
          'condition record',
          'condition documentation',
          'treatment record',
          'treatment history',
          'conservation treatment',
          'conservation record',
          'previous repair',
          'repair history',
          'restoration history',
          'material selection',
          'customer preference',
          'client preference',
          'approved method',
          'approved treatment',
          'documentation',
          'rework',
          'repeated work',
          'project delay',
          'delayed project',
          'inconsistent result',
          'gemstone',
          'measurement',
          'modification',
          'repair estimate',
          'replacement material',
          'customer dispute',
          'repair dispute',
          'misunderstanding',
          'misplaced item',
          'artwork measurement',
          'frame selection',
          'glass selection',
          'material availability',
          'special handling',
          'completion date',
          'design preference',
          'design change',
          'order change',
          'paper form',
          'furniture measurement',
          'fabric sample',
          'fabric selection',
          'fabric order',
          'material quantity',
          'material choice',
          'customer note',
          'wasted supplies',
        ],
        excludedAnchors: physicalVertical.excluded,
      };
    }

    /*
     * Healthcare billing fraud/account-security is a security workflow, not a
     * generic healthcare-operations workflow. Resolve it from the requester
     * description before broad healthcare rules can absorb words such as
     * billing, claims, reimbursement, or patient.
     */
    const healthcareBillingFraudActor =
      /\b(?:private healthcare providers?|healthcare providers?|medical practices?|clinics?|hospitals?|patient billing systems?|medical billing systems?|health insurance systems?)\b/u.test(requestText);
    const healthcareBillingFraudWorkflow =
      /\b(?:patient billing|medical billing|insurance records?|insurance claims?|patient invoices?|login history|login activity|payment transactions?|payment activity|security alerts?|patient accounts?|patient portals?)\b/u.test(requestText);
    const healthcareBillingFraudRisk =
      /\b(?:fraudulent claims?|claim fraud|billing fraud|payment fraud|suspicious payment activity|unauthorized account access|unauthorised account access|compromised patient accounts?|account takeover|coordinated abuse|false positives?|unnecessary restrictions?|fraud investigations?|security investigations?)\b/u.test(requestText);
    if (
      healthcareBillingFraudActor &&
      healthcareBillingFraudWorkflow &&
      healthcareBillingFraudRisk
    ) {
      return {
        kind: 'ACCOUNT_ACCESS_SECURITY',
        label: 'healthcare billing fraud and patient account security investigation operations',
        strict: true,
        requiredAnchors: [
          'healthcare',
          'medical',
          'patient',
          'billing',
          'insurance',
        ].filter((anchor) => requestText.includes(anchor)),
        workflowAnchors: [
          'patient billing',
          'medical billing',
          'insurance claim',
          'patient invoice',
          'payment transaction',
          'payment activity',
          'login history',
          'login activity',
          'security alert',
          'patient account',
          'patient portal',
          'fraudulent claim',
          'billing fraud',
          'payment fraud',
          'unauthorized account access',
          'account takeover',
          'coordinated abuse',
          'false positive',
          'unnecessary restriction',
          'fraud investigation',
        ],
        excludedAnchors: [
          'staffing shortage',
          'workforce shortage',
          'clinical staffing',
          'appointment wait time',
          'treatment capacity',
        ],
      };
    }

    /*
     * Resolve employee identity/access governance from requester text only.
     * Enriched planned queries may mention HR policy or fraud terminology and
     * must not redirect a joiner/mover/leaver access problem into those lanes.
     */
    const enterpriseIdentityActor =
      /\b(?:large companies?|enterprises?|organizations?|organisations?|corporations?|businesses?|employers?)\b/u.test(requestText) &&
      /\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|employee accounts?|user accounts?|employee access)\b/u.test(requestText);
    const enterpriseIdentityWorkflow =
      /\b(?:login activity|login records?|sign[- ]?in activity|authentication logs?|system permissions?|account permissions?|access permissions?|permissions?|access rights?|entitlements?|employee access|role changes?|role transitions?|department changes?|move between departments?|transfers?|offboarding|deprovision(?:ing|ed)?|account removal|access removal|temporary project access|project access|privilege creep|least privilege|identity lifecycle|account lifecycle|joiner mover leaver|access review|access logs?)\b/u.test(requestText);
    const enterpriseIdentityRisk =
      /\b(?:unusual account behavior|unusual behavior|suspicious activity|compromised account|account compromise|unauthorized access|unauthorised access|internal information|excessive privileges?|stale access|orphaned accounts?|access drift|delayed account removal|delayed deprovisioning|security alerts?|security investigations?|security incidents?|unnecessary security investigations?|unnecessary restrictions?)\b/u.test(requestText);
    if (enterpriseIdentityActor && enterpriseIdentityWorkflow && enterpriseIdentityRisk) {
      /*
       * For IAM workflows the identity noun itself is the stable vertical
       * anchor. Do not reuse the generic modifier extractor here: phrases such
       * as "HR records", "delayed account removal", or "or accounts"
       * can otherwise produce meaningless anchors like "hr", "delayed",
       * or "or" and reject perfectly aligned evidence.
       */
      const identityAnchors = [
        'employee',
        'staff',
        'workforce',
        'personnel',
        'contractor',
        'former employee',
        'employee account',
        'user account',
      ].filter((anchor) => requestText.includes(anchor));
      const stableIdentityAnchors = identityAnchors.length > 0
        ? identityAnchors
        : ['employee', 'staff', 'workforce', 'personnel', 'contractor'];
      return {
        kind: 'ENTERPRISE_IDENTITY_ACCESS_GOVERNANCE',
        label: 'enterprise identity access governance and employee account lifecycle operations',
        strict: true,
        requiredAnchors: stableIdentityAnchors,
        workflowAnchors: [
          'employee',
          'staff',
          'role change',
          'role transition',
          'department transfer',
          'system permission',
          'access permission',
          'access right',
          'entitlement',
          'offboarding',
          'deprovisioning',
          'account removal',
          'privilege creep',
          'least privilege',
          'identity lifecycle',
          'account lifecycle',
          'joiner mover leaver',
          'login activity',
          'security alert',
          'unauthorized access',
          'excessive privilege',
          'orphaned account',
          'stale access',
        ],
        excludedAnchors: [
          'citizen report',
          'government payment',
          'tax payment',
          'permit payment',
          'benefit payment',
          'shipping address',
          'carrier scan',
        ],
      };
    }

    const enterprisePolicy = /\b(?:human resources?|\bhr\b|employee handbooks?|employment policies?|employment contracts?|leave rules?|internal procedures?|corporate policies?|hr compliance officers?)\b/u.test(requestText) &&
      /\b(?:outdated|conflicting|inconsistent|regulatory|compliance|repeated questions?|manual review|different departments?|policy updates?|version control)\b/u.test(requestText);
    if (enterprisePolicy) {
      return {
        kind: 'ENTERPRISE_POLICY',
        label: 'enterprise hr policy compliance',
        strict: true,
        requiredAnchors: [
          'human resources',
          'hr ',
          'employee handbook',
          'employment policy',
          'employment contract',
          'leave rule',
          'workplace policy',
        ],
        workflowAnchors: [
          'outdated',
          'conflicting',
          'inconsistent',
          'regulatory change',
          'compliance risk',
          'manual review',
          'repeated employee question',
          'version control',
        ],
        excludedAnchors: [],
      };
    }

    const accountSecurityActor =
      /\b(?:online portals?|user portals?|customer portals?|tenant portals?|staff portals?|member portals?|digital portals?|online platforms?|user accounts?|customer accounts?|tenant accounts?|staff accounts?|employee accounts?|member accounts?)\b/u.test(requestText);
    const accountSecurityWorkflow =
      /\b(?:login activity|login records?|sign[- ]?in activity|authentication|account permissions?|access permissions?|access rights?|roles?|privileges?|payment behavior|payment changes?|security alerts?|device information|account activity)\b/u.test(requestText);
    const accountSecurityRisk =
      /\b(?:compromised accounts?|account compromise|account takeover|unauthorized access|unauthorised access|fraudulent|fraud|suspicious activity|delayed investigations?|incident investigation|false positives?|unnecessary restrictions?|legitimate users? restricted)\b/u.test(requestText);
    if (accountSecurityActor && accountSecurityWorkflow && accountSecurityRisk) {
      const identityAnchors = this.resolveRequestIdentityAnchors(requestText);
      return {
        kind: 'ACCOUNT_ACCESS_SECURITY',
        label: 'digital account access security and human-reviewed investigation operations',
        strict: identityAnchors.length > 0,
        requiredAnchors: identityAnchors,
        workflowAnchors: [
          'login',
          'sign in',
          'authentication',
          'account permission',
          'access permission',
          'access right',
          'role change',
          'privilege',
          'payment behavior',
          'payment change',
          'security alert',
          'account compromise',
          'account takeover',
          'unauthorized access',
          'fraud',
          'suspicious activity',
          'investigation',
          'restriction',
          'false positive',
        ],
        excludedAnchors: [],
      };
    }

    const propertyActor =
      /\b(?:property management(?: companies?)?|property investment compan(?:y|ies)|property investors?|real estate investors?|investment properties?|property managers?|asset managers?|rental properties?|rental buildings?|apartment buildings?|residential properties?|landlords?|real estate portfolios?|buildings?)\b/u.test(text);
    const propertyWorkflow =
      /\b(?:maintenance expenses?|maintenance costs?|operating costs?|operating expenses?|property returns?|building returns?|return estimates?|investment returns?|\broi\b|net operating income|\bnoi\b|cash flow|vacancy periods?|vacancy rates?|tenant complaints?|repair expenses?|maintenance investments?|financing costs?|mortgage interest|interest rates?|local market changes?|market rents?|rent growth|profitability|financial inefficien|financial performance|property performance|portfolio performance|rent payments?|rental income|cost per property|expense forecasting|maintenance priorit|data silos?|separate systems?)\w*\b/u.test(text);
    if (propertyActor && propertyWorkflow) {
      return {
        kind: 'PROPERTY_ASSET_PERFORMANCE',
        label: 'property asset operating performance',
        strict: true,
        requiredAnchors: [
          'property management',
          'property investment company',
          'property investor',
          'real estate investor',
          'investment property',
          'property manager',
          'rental property',
          'building',
          'apartment',
          'landlord',
          'real estate portfolio',
        ],
        workflowAnchors: [
          'maintenance expense',
          'maintenance cost',
          'operating cost',
          'operating expense',
          'net operating income',
          'noi',
          'vacancy',
          'tenant complaint',
          'repair expense',
          'maintenance investment',
          'financial inefficiency',
          'property performance',
          'building return',
          'rental income',
          'cash flow',
          'profitability',
          'return estimate',
          'investment return',
          'roi',
          'financing cost',
          'mortgage interest',
          'interest rate',
          'local market change',
          'market rent',
          'rent growth',
          'financial performance',
          'expense forecast',
          'maintenance priorit',
          'fragmented',
          'separate systems',
          'data silo',
        ],
        excludedAnchors: [
          '1031 exchange',
          'depreciation recapture',
          'tax loophole',
          'cost segregation',
          'irs',
        ],
      };
    }

    const digitalTrust =
      /\b(?:online marketplaces?|marketplaces?|e[- ]?commerce platforms?|seller platforms?|multi[- ]vendor platforms?|online stores?|digital marketplaces?|trust and safety)\b/u.test(text) &&
      /\b(?:fake sellers?|seller accounts?|suspicious product listings?|suspicious listings?|fraudulent reviews?|fake reviews?|review manipulation|unusual purchasing|coordinated fraud|fraud patterns?|false positives?|legitimate sellers?|seller restrictions?|customer trust)\b/u.test(text);
    if (digitalTrust) {
      return {
        kind: 'DIGITAL_TRUST_SAFETY',
        label: 'digital marketplace trust and safety operations',
        strict: true,
        requiredAnchors: [
          'marketplace',
          'seller',
          'listing',
          'e commerce',
          'online store',
          'trust and safety',
        ],
        workflowAnchors: [
          'fraud',
          'fake seller',
          'suspicious listing',
          'fraudulent review',
          'fake review',
          'review manipulation',
          'unusual purchase',
          'transaction',
          'false positive',
          'restriction',
          'customer trust',
        ],
        excludedAnchors: [],
      };
    }

    const financial = /\b(?:financial institutions?|banks?|banking|digital payments?|payment platforms?|fintech|wallets?|transfers?)\b/u.test(text) &&
      /\b(?:fraud|unauthorized|suspicious(?: transaction)?|identity checks?|security alerts?|payment disputes?|transaction disputes?|account restrictions?|frozen accounts?)\b/u.test(text);
    if (financial) {
      return {
        kind: 'FINANCIAL_OPERATIONS',
        label: 'financial transaction operations',
        strict: true,
        requiredAnchors: [
          'payment',
          'transaction',
          'bank',
          'financial',
          'transfer',
          'account',
        ],
        workflowAnchors: [
          'fraud',
          'unauthorized',
          'verification',
          'dispute',
          'frozen account',
          'account restriction',
          'suspicious transaction',
        ],
        excludedAnchors: [],
      };
    }

    const agriculturalDistributionProfitability =
      /\b(?:agricultural distributors?|agriculture distributors?|produce distributors?|fresh produce distributors?|crop distributors?|farm produce distributors?|agricultural wholesalers?|produce wholesalers?|food distributors?|produce supply businesses?)\b/u.test(requestText) &&
      /\b(?:storage losses?|storage costs?|warehouse costs?|warehouse expenses?|transportation delays?|transport delays?|delivery delays?|delivery costs?|transportation costs?|market prices?|price fluctuations?|price volatility|crop profitability|product profitability|profit margins?|profit estimates?|spoilage|spoilage reports?|harvest records?|warehouse inventory|shipment activity|financial expenses?|route profitability|routes? responsible|pricing decisions?)\b/u.test(requestText) &&
      /\b(?:profitability|profit margins?|profit estimates?|financial losses?|reduced profit|reduced margins?|pricing decisions?|greatest losses?|route profitability|crop profitability|product profitability)\b/u.test(requestText);
    if (agriculturalDistributionProfitability) {
      return {
        kind: 'AGRICULTURE_DISTRIBUTION_PROFITABILITY',
        label: 'agricultural distribution crop and route profitability operations',
        strict: true,
        requiredAnchors: [
          'agricultural distributor',
          'produce distributor',
          'fresh produce distributor',
          'crop distributor',
          'farm produce distributor',
          'agricultural wholesaler',
          'produce wholesaler',
          'produce supply',
        ],
        workflowAnchors: [
          'storage loss',
          'storage cost',
          'warehouse cost',
          'transport delay',
          'delivery delay',
          'delivery cost',
          'transportation cost',
          'market price',
          'price fluctuation',
          'price volatility',
          'spoilage',
          'harvest record',
          'warehouse inventory',
          'shipment activity',
          'financial expense',
          'crop profitability',
          'product profitability',
          'route profitability',
          'profit margin',
          'pricing decision',
        ],
        excludedAnchors: [
          'stock market',
          'equity market',
          'asset pricing',
          'business cycle',
          'hydrogen distribution',
          'energy storage',
          'battery storage',
          'rail market',
          'vehicle pricing',
        ],
      };
    }

    const agriculturalExportProfitability =
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export(?:ers?| companies?| businesses?))\b/u.test(requestText) &&
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|changing market prices?|market prices?|product spoilage|produce spoilage|shipment profitability|profit margins?|profit estimates?|harvest records?|delivery schedules?|supplier payments?|sales revenues?|financial losses?|route profitability|distribution stages?)\b/u.test(requestText);
    if (agriculturalExportProfitability) {
      return {
        kind: 'AGRICULTURE_EXPORT_PROFITABILITY',
        label: 'agricultural export shipment profitability and logistics intelligence',
        strict: true,
        requiredAnchors: [
          'agricultural export',
          'produce export',
          'fresh produce',
          'produce shipment',
          'cold chain',
        ],
        workflowAnchors: [
          'transport delay', 'delivery delay', 'storage cost', 'warehouse expense',
          'market price', 'spoilage', 'shipment profitability', 'profit margin',
          'profit estimate', 'harvest record', 'delivery schedule', 'supplier payment',
          'sales revenue', 'financial loss', 'route profitability', 'distribution stage',
          'cold chain', 'warehouse', 'shipment', 'logistics cost',
        ],
        excludedAnchors: [
          'drone harvesting', 'smart farming drone', 'irrigation controller',
          'crop disease detection', 'precision agriculture sensor',
        ],
      };
    }

    const agricultureLogistics =
      /\b(?:agricultural cooperatives?|farm cooperatives?|farmers? cooperatives?|farms?|farmers?|agriculture|fresh produce|produce growers?|growers?|cold storage)\b/u.test(text) &&
      /\b(?:harvest(?:ing)?|storage|cold chain|temperature|shipments?|transportation|delivery|spoilage|transport costs?|shipment locations?|logistics|traceability)\b/u.test(text);
    if (agricultureLogistics) {
      return {
        kind: 'AGRICULTURE_LOGISTICS',
        label: 'agricultural cooperative produce logistics',
        strict: true,
        requiredAnchors: [
          'agricultural',
          'agriculture',
          'farm',
          'farmer',
          'fresh produce',
          'produce',
          'grower',
          'cold storage',
        ],
        workflowAnchors: [
          'harvest',
          'storage',
          'cold chain',
          'temperature',
          'shipment',
          'transport',
          'delivery',
          'spoil',
          'storage capacity',
          'location',
          'traceability',
          'logistics',
          'market',
        ],
        excludedAnchors: [],
      };
    }

    const industrial = /\b(?:manufacturing|manufacturer|factory|production line|industrial plant)\b/u.test(text) &&
      /\b(?:raw materials?|supplier|inventory|warehouse|shipment|production schedule|bottleneck|demand change)\b/u.test(text);
    if (industrial) {
      return {
        kind: 'INDUSTRIAL_OPERATIONS',
        label: 'industrial supply chain operations',
        strict: true,
        requiredAnchors: [
          'manufacturing',
          'factory',
          'production',
          'supply chain',
          'warehouse',
        ],
        workflowAnchors: [
          'supplier delay',
          'raw material',
          'inventory mismatch',
          'stockout',
          'bottleneck',
          'production disruption',
        ],
        excludedAnchors: [],
      };
    }

    const academic = /\b(?:school|university|learning management system|\blms\b|online assessment|students?)\b/u.test(text) &&
      /\b(?:records?|assignments?|exams?|assessments?|security|login|academic integrity|administrators?)\b/u.test(text);
    if (academic) {
      return {
        kind: 'ACADEMIC_OPERATIONS',
        label: 'academic institutional operations',
        strict: true,
        requiredAnchors: [
          'university',
          'school',
          'student',
          'exam',
          'assessment',
          'academic',
        ],
        workflowAnchors: ['failure', 'dispute', 'review', 'records', 'integrity', 'access'],
        excludedAnchors: [],
      };
    }

    const publicHealthDemandCapacity =
      /\b(?:public healthcare agencies?|public health agencies?|health departments?|health authorities?|healthcare agencies?|hospitals?|clinics?)\b/u.test(text) &&
      /\b(?:rising demand|service demand|healthcare demand|medical service demand|appointment volumes?|appointment demand|emergency visits?|emergency department visits?|regional health reports?|community health needs?|communities experiencing|hospital overload|hospitals? become overloaded|clinics? become overloaded|capacity pressure|waiting times?|resource availability|resource distribution|staff shortages?|demand forecasting|demand forecast|surge detection)\b/u.test(text);
    if (publicHealthDemandCapacity) {
      return {
        kind: 'PUBLIC_HEALTH_DEMAND_CAPACITY',
        label: 'public healthcare demand and capacity planning',
        strict: true,
        requiredAnchors: [
          'public healthcare',
          'public health',
          'health agency',
          'health authority',
          'hospital',
          'clinic',
        ],
        workflowAnchors: [
          'rising demand',
          'service demand',
          'appointment volume',
          'emergency visit',
          'regional health report',
          'community health need',
          'hospital overload',
          'clinic overload',
          'capacity pressure',
          'waiting time',
          'resource availability',
          'resource distribution',
          'staff shortage',
          'demand forecast',
          'surge detection',
        ],
        excludedAnchors: [
          'medical supply inventory',
          'blood product inventory',
          'pharmacy inventory',
          'expired supplies',
          'supplier delivery',
        ],
      };
    }

    const healthcareSupplyCostEfficiency =
      /\b(?:healthcare networks?|hospital networks?|hospital systems?|hospitals?|clinics?|medical centers?|health systems?)\b/u.test(requestText) &&
      /\b(?:emergency supply purchases?|emergency purchases?|urgent purchases?|expired medical inventory|expired supplies?|inventory expiration|medical inventory|supply inventory|uneven stock distribution|stock distribution|inventory imbalance|inter[- ]facility transfers?|transfer activity|supplier invoices?|procurement records?|inventory levels?|usage data|transportation costs?|transfer costs?|delivery costs?)\b/u.test(requestText) &&
      /\b(?:operating expenses?|operating costs?|unnecessary costs?|excess inventory|avoidable emergency orders?|emergency orders?|inefficient transfers?|inaccurate budgeting|budgeting|cost attribution|cost variance|financial expenses?)\b/u.test(requestText);
    if (healthcareSupplyCostEfficiency) {
      return {
        kind: 'HEALTHCARE_SUPPLY_COST_EFFICIENCY',
        label: 'healthcare supply inventory distribution and operating cost efficiency',
        strict: true,
        requiredAnchors: [
          'healthcare network', 'hospital network', 'hospital', 'clinic',
          'medical supply', 'medical inventory', 'pharmacy inventory',
        ],
        workflowAnchors: [
          'procurement', 'emergency purchase', 'expired inventory',
          'stock distribution', 'inventory imbalance', 'inter facility transfer',
          'transfer activity', 'supplier invoice', 'usage data',
          'transportation cost', 'operating expense', 'excess inventory', 'budget',
        ],
        excludedAnchors: ['diagnosis', 'disease detection', 'treatment efficacy', 'career', 'salary'],
      };
    }

    const hospitalCostResourceEfficiency =
      /\b(?:private hospitals?|hospitals?|hospital systems?|medical centers?)\b/u.test(requestText) &&
      /\b(?:staffing expenses?|staffing costs?|medical supply usage|supply costs?|patient volumes?|insurance reimbursements?|treatment costs?|department costs?|budget|profitability|financial inefficien|resource allocation|resource consumption|cost efficiency|cost-efficiency)\w*\b/u.test(requestText);
    if (hospitalCostResourceEfficiency) {
      return {
        kind: 'HEALTHCARE_COST_RESOURCE_EFFICIENCY',
        label: 'hospital cost resource utilization and financial efficiency operations',
        strict: true,
        requiredAnchors: [
          'hospital', 'medical center', 'healthcare', 'operating room', 'surgical',
        ],
        workflowAnchors: [
          'staffing cost', 'staffing expense', 'medical supply', 'supply usage',
          'patient volume', 'insurance reimbursement', 'treatment cost',
          'department cost', 'resource utilization', 'resource allocation',
          'budget', 'cost variance', 'cost efficiency', 'profitability',
        ],
        excludedAnchors: [
          'diagnosis accuracy', 'disease detection', 'clinical diagnosis only',
        ],
      };
    }

    const hospitalSupplyOperations =
      /\b(?:hospital|hospitals|healthcare|clinical units?|pharmacy|pharmacies|medical)\b/u.test(text) &&
      /\b(?:medical supplies?|clinical supplies?|hospital supplies?|medical inventory|supply inventory|stock levels?|stockouts?|blood products?|blood inventory|pharmacy inventory|expiration|expiry|expired products?|supplier deliveries?|supplier delays?|emergency supply requests?|reorder(?:ing)?|departmental inventory|medical supply chain)\b/u.test(text);
    if (hospitalSupplyOperations) {
      return {
        kind: 'HEALTHCARE_OPERATIONS',
        label: 'hospital supply inventory operations',
        strict: true,
        requiredAnchors: [
          'hospital',
          'healthcare',
          'clinical',
          'pharmacy',
          'medical supply',
          'hospital supply',
          'blood product',
        ],
        workflowAnchors: [
          'inventory',
          'stock level',
          'stockout',
          'shortage',
          'medical supply',
          'clinical supply',
          'blood product',
          'blood inventory',
          'pharmacy inventory',
          'expiration',
          'expiry',
          'expired',
          'supplier',
          'delivery',
          'emergency request',
          'reorder',
          'department',
          'supply chain',
          'fragmented',
          'disconnected',
          'separate systems',
        ],
        excludedAnchors: [],
      };
    }

    const hospitalOperatingRoomCoordination =
      /\b(?:hospital|hospitals|healthcare|medical center|medical centers)\b/u.test(text) &&
      /\b(?:operating rooms?|operating theatres?|operating theaters?|surgical suites?|surgery schedules?|surgical schedules?|surgeries|procedures)\b/u.test(text) &&
      /\b(?:medical staff|staffing|surgeons?|nurses?|equipment availability|urgent patients?|emergency cases?|resource allocation|room turnover|reschedul|idle operating rooms?|delayed procedures?|schedule conflicts?)\w*\b/u.test(text);
    if (hospitalOperatingRoomCoordination) {
      return {
        kind: 'HEALTHCARE_OPERATIONS',
        label: 'hospital operating room resource coordination',
        strict: true,
        requiredAnchors: [
          'operating room',
          'operating theatre',
          'operating theater',
          'surgical suite',
          'surgery schedule',
          'surgical schedule',
          'surgery',
          'surgical',
        ],
        workflowAnchors: [
          'surgery schedule',
          'surgical schedule',
          'operating room schedule',
          'staff availability',
          'medical staff',
          'staffing',
          'equipment availability',
          'emergency case',
          'urgent patient',
          'resource allocation',
          'room turnover',
          'reschedule',
          'reprioritization',
          'schedule conflict',
          'idle operating room',
          'delayed procedure',
          'operating room utilization',
        ],
        excludedAnchors: [
          'hospital supply chain',
          'pharmacy inventory',
          'medical supply shortage',
        ],
      };
    }

    const hospitalEquipmentOperations =
      /\b(?:hospital|hospitals|healthcare|medical|biomedical engineering|clinical engineering|operating rooms?|operating areas?)\b/u.test(text) &&
      /\b(?:medical equipment|medical devices?|equipment tracking|device tracking|asset tracking|equipment location|device location|maintenance status|maintenance logs?|service status|equipment usage|device usage|utilization|device availability|equipment availability|departmental movement|department transfers?|storage rooms?)\b/u.test(text);
    if (hospitalEquipmentOperations) {
      return {
        kind: 'HEALTHCARE_OPERATIONS',
        label: 'hospital medical equipment operations',
        strict: true,
        requiredAnchors: [
          'hospital',
          'healthcare',
          'medical equipment',
          'medical device',
          'biomedical',
          'clinical engineering',
        ],
        workflowAnchors: [
          'asset tracking',
          'equipment tracking',
          'device tracking',
          'location',
          'maintenance',
          'service status',
          'availability',
          'utilization',
          'inventory',
          'department',
          'transfer',
          'storage',
          'operating room',
          'search',
          'missing',
          'delay',
        ],
        excludedAnchors: [],
      };
    }

    const healthcare = /\b(?:hospital|clinic|healthcare|medical practice|pharmacy|patients?|rehabilitation centers?|rehab centers?|rehabilitation clinics?|sports medicine|physiotherapists?|physical therapists?|rehabilitation specialists?|athletes?)\b/u.test(text) &&
      /\b(?:appointments?|patient records?|medication|billing|care coordination|referrals?|claims?|scheduling|inventory|injury recovery|rehabilitation|return to play|return-to-play|training loads?|training workload|pain reports?|pain scores?|mobility measurements?|mobility scores?|performance data|recovery progress|recovery status|reinjury|re-injury)\b/u.test(text);
    if (healthcare) {
      return {
        kind: 'HEALTHCARE_OPERATIONS',
        label: 'healthcare and rehabilitation operations',
        strict: true,
        requiredAnchors: [
          'healthcare', 'hospital', 'clinic', 'patient', 'medical',
          'rehabilitation', 'rehab', 'sports medicine', 'physiotherapist',
          'physical therapist', 'athlete',
        ],
        workflowAnchors: [
          'records', 'appointment', 'billing', 'referral', 'coordination',
          'inventory', 'delay', 'injury', 'recovery', 'rehabilitation',
          'return to play', 'training load', 'pain report', 'pain score',
          'mobility', 'performance data', 'reinjury',
        ],
        excludedAnchors: [],
      };
    }

    const publicGrantAllocation =
      /\b(?:public grant programs?|government grant programs?|public funding programs?|grant-making agencies?|grantmaking agencies?|public agencies?)\b/u.test(requestText) &&
      /\b(?:grant applications?|funding applications?|eligibility checks?|previous funding|funding history|project outcomes?|financial records?|duplicate(?:d)? requests?|duplicate funding|unrealistic budgets?|budget reasonableness|underperformance risk|funding allocation|program impact|funded programs?)\b/u.test(requestText);
    if (publicGrantAllocation) {
      return {
        kind: 'PUBLIC_SECTOR',
        label: 'public grant evaluation and funding allocation',
        strict: true,
        requiredAnchors: [
          'public grant',
          'government grant',
          'grant program',
          'grant-making agency',
          'grantmaking agency',
          'public funding',
          'public agency',
        ],
        workflowAnchors: [
          'grant application',
          'funding application',
          'application review',
          'eligibility check',
          'previous funding',
          'funding history',
          'project outcome',
          'financial record',
          'duplicate request',
          'duplicate funding',
          'unrealistic budget',
          'budget review',
          'underperformance risk',
          'funding allocation',
          'program impact',
          'award decision',
        ],
        excludedAnchors: [
          'how to write a grant',
          'grant writing tips',
          'research proposal tips',
          'scholarship application',
        ],
      };
    }

    const publicProgramCostAttribution =
      /\b(?:government agencies?|government departments?|public agencies?|public sector agencies?|ministr(?:y|ies)|municipalit(?:y|ies)|public authorities?)\b/u.test(requestText) &&
      /\b(?:public programs?|government programs?|service programs?|departmental budgets?|program budgets?|operating budgets?|public services?)\b/u.test(requestText) &&
      /\b(?:staffing expenses?|staffing costs?|procurement costs?|procurement spending|contractor payments?|contractor costs?|service usage|service costs?|departmental spending|program expenditures?|operating expenses?|operating costs?)\b/u.test(requestText) &&
      /\b(?:exceed(?:s|ed|ing)? (?:their )?budgets?|budget overruns?|overspending|cost pressure|financial pressure|cost attribution|cost drivers?|budget variance|inaccurate budget planning|financial oversight|identify where overspending|greatest financial pressure)\b/u.test(requestText);
    if (publicProgramCostAttribution) {
      return {
        kind: 'PUBLIC_PROGRAM_COST_ATTRIBUTION',
        label: 'public program operating cost attribution and budget overrun analysis',
        strict: true,
        requiredAnchors: [
          'government agency', 'government department', 'public agency',
          'public sector', 'public program', 'government program', 'departmental budget',
        ],
        workflowAnchors: [
          'program budget', 'operating budget', 'budget overrun', 'overspending',
          'staffing expense', 'staffing cost', 'procurement cost', 'procurement spending',
          'contractor payment', 'contractor cost', 'service usage', 'service cost',
          'departmental spending', 'program expenditure', 'operating expense',
          'cost attribution', 'cost driver', 'budget variance', 'financial pressure',
        ],
        excludedAnchors: [
          'personal finance', 'house down payment', 'stock market', 'investment portfolio',
          'public works auction format', 'political budget cycle', 'construction project auction',
        ],
      };
    }

    const operationalCostAttribution =
      RequestOperationalCostAttributionUtil.resolve(input.requestDescription);
    if (operationalCostAttribution) {
      return {
        kind: 'OPERATIONAL_COST_ATTRIBUTION',
        label: operationalCostAttribution.publicService
          ? 'public service operating cost attribution and financial pressure analysis'
          : 'operational cost attribution and financial pressure analysis',
        strict: true,
        requiredAnchors: operationalCostAttribution.identityTerms,
        workflowAnchors: [
          ...operationalCostAttribution.costDrivers,
          ...operationalCostAttribution.performanceTerms,
          ...operationalCostAttribution.financialTerms,
          'cost attribution',
          'cost driver',
          'operating cost',
          'budget variance',
          'financial pressure',
        ],
        excludedAnchors: [
          'personal finance',
          'credit card debt',
          'credit utilization',
          'house down payment',
          'mortgage',
          'stock market',
          'investment portfolio',
          'video game',
          'gaming guide',
        ],
      };
    }

    const publicFiscalOversight =
      /\b(?:public institutions?|government|government agencies?|government departments?|public sector|public administration|ministr(?:y|ies)|municipal|municipality)\b/u.test(text) &&
      /\b(?:public budgets?|public funds?|government spending|public spending|procurement|procurement records?|invoices?|project expenses?|approval histor(?:y|ies)|duplicate payments?|duplicate invoices?|overspending|overpayments?|expenditure|financial management|budget planning|spending patterns?)\b/u.test(text);
    if (publicFiscalOversight) {
      return {
        kind: 'PUBLIC_SECTOR',
        label: 'public finance and expenditure oversight',
        strict: true,
        requiredAnchors: [
          'government',
          'public institution',
          'public sector',
          'public administration',
          'public agency',
          'ministry',
          'municipal',
          'taxpayer',
          'county',
          'city government',
          'city council',
          'state government',
          'federal government',
          'treasury',
          'public office',
          'public body',
        ],
        workflowAnchors: [
          'public budget',
          'public funds',
          'government spending',
          'public spending',
          'procurement',
          'public contract',
          'government contract',
          'invoice',
          'payment',
          'disbursement',
          'accounts payable',
          'project expense',
          'grant spending',
          'approval history',
          'duplicate payment',
          'duplicate invoice',
          'overspending',
          'overpayment',
          'improper payment',
          'irregular expenditure',
          'procurement fraud',
          'procurement scandal',
          'corruption',
          'embezzlement',
          'expenditure',
          'audit',
          'financial management',
          'budget planning',
          'spending pattern',
        ],
        excludedAnchors: [
          'patient complaint',
          'member complaint',
          'healthcare finance',
          'insurance claim',
        ],
      };
    }

    const publicSector = /\b(?:government|municipal|municipality|public sector|local authority|city council|citizen services?)\b/u.test(text);
    if (publicSector) {
      return {
        kind: 'PUBLIC_SECTOR',
        label: 'public sector operations',
        strict: false,
        requiredAnchors: ['government', 'municipal', 'public sector', 'citizen'],
        workflowAnchors: ['fragmented', 'delay', 'complaint', 'service', 'records'],
        excludedAnchors: [],
      };
    }

    return {
      kind: 'GENERAL',
      label: 'general operations',
      strict: false,
      requiredAnchors: [],
      workflowAnchors: [],
      excludedAnchors: [],
    };
  }

  static matchesVertical(
    value: string,
    constraint: RequestVerticalConstraint,
  ): boolean {
    if (!constraint.strict || constraint.requiredAnchors.length === 0) {
      return true;
    }
    const normalized = this.normalize(value);
    if (!normalized) return false;
    if (
      constraint.excludedAnchors.some((anchor) =>
        normalized.includes(this.normalize(anchor)),
      )
    ) {
      return false;
    }
    if (constraint.kind === 'PUBLIC_PROGRAM_COST_ATTRIBUTION') {
      const publicIdentity = /\b(?:government|public sector|public agency|public agencies|government agency|government agencies|government department|government departments|public authority|public authorities|municipal|municipality|ministr(?:y|ies))\b/u.test(normalized);
      const programOrBudgetIdentity = /\b(?:public program|government program|program budget|departmental budget|operating budget|public service|departmental spending)\b/u.test(normalized);
      return publicIdentity && programOrBudgetIdentity;
    }
    return constraint.requiredAnchors.some((anchor) =>
      normalized.includes(this.normalize(anchor)),
    );
  }

  static matchesWorkflow(
    value: string,
    constraint: RequestVerticalConstraint,
  ): boolean {
    if (constraint.workflowAnchors.length === 0) return true;
    const normalized = this.normalize(value);
    if (constraint.kind === 'PUBLIC_PROGRAM_COST_ATTRIBUTION') {
      const costDriver = /\b(?:staffing|payroll|personnel cost|procurement|purchasing|contractor|vendor payment|service usage|service cost|departmental spending|program expenditure|operating expense|operating cost)\w*\b/u.test(normalized);
      const budgetPressure = /\b(?:budget overrun|overspend|overspending|cost overrun|cost pressure|financial pressure|cost driver|cost attribution|budget variance|budget planning|expenditure analysis|spending analysis|financial oversight|inefficien|waste)\w*\b/u.test(normalized);
      return costDriver && budgetPressure;
    }
    return constraint.workflowAnchors.some((anchor) =>
      normalized.includes(this.normalize(anchor)),
    );
  }

  private static resolveRestorationServiceVertical(text: string): {
    readonly label: string;
    readonly anchors: readonly string[];
    readonly excluded: readonly string[];
  } | null {
    const match = text.match(
      /\b(?:independent\s+)?([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2})\s+restoration\s+(?:specialists?|studios?|workshops?|services?)\b/u,
    );
    if (!match?.[1]) return null;

    const vertical = match[1]
      .trim()
      .replace(/^(?:independent|local|small|professional)\s+/u, '');
    if (!vertical || new Set(['item', 'object', 'general']).has(vertical)) {
      return null;
    }

    if (vertical === 'lamp' || vertical === 'antique lamp') {
      return {
        label: 'lamp restoration service',
        anchors: [
          'lamp restoration',
          'antique lamp',
          'lamp repair',
          'lighting restoration',
          'lighting conservation',
          'lamp rewiring',
          'lamp restorer',
        ],
        excluded: [
          'headlight',
          'headlights',
          'tail light',
          'taillight',
          'vehicle lighting',
          'automotive',
          'car and driver',
          'christmas lights',
          'string lights',
          'keyboard',
          'television',
          'tv repair',
        ],
      };
    }

    const identityTokens = vertical
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter(
        (token) =>
          !new Set([
            'antique',
            'historic',
            'historical',
            'vintage',
            'traditional',
            'decorative',
          ]).has(token),
      );
    const coreIdentity = identityTokens.slice(-2).join(' ').trim();

    return {
      label: `${vertical} restoration service`,
      anchors: [
        `${vertical} restoration`,
        `${vertical} restorer`,
        vertical,
        ...(coreIdentity && coreIdentity !== vertical ? [coreIdentity] : []),
      ],
      excluded: [],
    };
  }

  private static resolveRepairShopVertical(text: string): {
    readonly label: string;
    readonly anchors: readonly string[];
    readonly excluded: readonly string[];
  } | null {
    const match = text.match(
      /\b([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2})\s+repair\s+(?:shops?|specialists?|technicians?|repairers?)\b/u,
    );
    if (!match?.[1]) return null;

    const vertical = match[1]
      .trim()
      .replace(/^(?:independent|local|small|professional)\s+/u, '');
    const genericPrefixes = new Set(['local', 'small', 'customer', 'service']);
    if (genericPrefixes.has(vertical)) return null;

    const synonymMap: Record<string, readonly string[]> = {
      bicycle: ['bicycle', 'bike', 'cycle'],
      bike: ['bicycle', 'bike', 'cycle'],
      watch: ['watch', 'watchmaker'],
      shoe: ['shoe', 'cobbler'],
      phone: ['phone', 'smartphone', 'mobile phone'],
      computer: ['computer', 'laptop', 'pc repair'],
      appliance: ['appliance'],
      jewelry: ['jewelry', 'jewellery'],
      jewellery: ['jewelry', 'jewellery'],
      motorcycle: ['motorcycle', 'motorbike'],
      guitar: ['guitar', 'guitar repair', 'luthier', 'instrument repair'],
      violin: ['violin', 'violin repair', 'luthier', 'instrument repair'],
      cello: ['cello', 'cello repair', 'luthier', 'instrument repair'],
      piano: ['piano', 'piano repair', 'piano technician', 'piano tuner'],
      'musical instrument': ['musical instrument', 'instrument repair', 'luthier'],
    };
    const anchors = synonymMap[vertical] ?? [vertical];
    const automotive = anchors.some((value) =>
      /\b(?:bicycle|bike|cycle|watch|shoe|phone|computer|appliance|jewelry|jewellery|musical instrument|luthier)\b/u.test(value),
    );

    return {
      label: `${vertical} repair service`,
      anchors,
      excluded: automotive
        ? ['automotive', 'toyota', 'car engine', 'rear window', 'truck repair']
        : [],
    };
  }

  private static resolveLocalServiceVertical(text: string): {
    readonly label: string;
    readonly anchors: readonly string[];
    readonly excluded: readonly string[];
  } | null {
    const patterns: Array<[RegExp, string, readonly string[]]> = [
      [/\b(?:cake decorators?|cake decorating|custom cake decorators?|home bakers?|independent bakers?|cake artists?|custom cake businesses?|bakery decorators?)\b/u, 'cake decorator studio', ['cake decorator', 'cake decorating', 'custom cake', 'home baker', 'cake artist', 'bakery decorator', 'wedding cake', 'birthday cake', 'cake business']],
      [/\b(?:costume rental shops?|costume rentals?|costume shops?|costume hire|wardrobe rentals?)\b/u, 'costume rental wardrobe operations', ['costume rental', 'costume shop', 'costume hire', 'wardrobe rental', 'theatrical costume', 'formalwear rental', 'tuxedo rental', 'dress rental', 'clothing rental']],
      [/\b(?:calligraphy artists?|calligraphers?|lettering artists?|custom stationery artists?|commissioned artists?)\b/u, 'calligraphy commission studio', ['calligraphy', 'calligrapher', 'lettering artist', 'custom stationery', 'commissioned artwork', 'art commission', 'freelance artist', 'independent artist', 'illustrator', 'graphic designer', 'stationery designer']],
      [/\b(?:upholstery workshops?|upholstery shops?|upholsterers?|reupholstery|furniture upholstery)\b/u, 'upholstery workshop', ['upholstery', 'upholsterer', 'reupholstery', 'furniture upholstery']],
      [/\bcar washes?\b/u, 'car wash business', ['car wash', 'vehicle wash']],
      [/\blocksmiths?\b/u, 'locksmith business', ['locksmith', 'lock service']],
      [/\b(?:tailors?|tailoring|alteration shops?|alteration specialists?|bridal alteration specialists?|clothing alteration specialists?|seamstresses?|bridal seamstresses?|dressmakers?|bridal dressmakers?|wedding dress alterations?|bridal alterations?)\b/u, 'tailor alteration shop', ['tailor', 'tailoring', 'alteration', 'alteration specialist', 'bridal alteration', 'seamstress', 'dressmaker', 'wedding dress alteration']],
      [/\b(?:salons?|barbers?)\b/u, 'salon business', ['salon', 'barber']],
      [/\b(?:flower shops?|florists?)\b/u, 'flower shop', ['flower shop', 'florist', 'bouquet']],
      [/\b(?:picture framing shops?|custom framing shops?|frame shops?|framers?)\b/u, 'picture framing shop', ['picture framing', 'framing shop', 'frame shop', 'custom frame', 'framer']],
      [/\b(?:home[- ]cleaning businesses?|home cleaning businesses?|residential cleaning businesses?|residential cleaning services?|house cleaning businesses?|house cleaning services?|cleaning companies?)\b/u, 'residential cleaning business', ['home cleaning', 'residential cleaning', 'house cleaning', 'cleaning service', 'cleaner']],
      [/\b(?:independent dollhouse makers?|dollhouse makers?|miniature house makers?|doll house makers?)\b/u, 'miniature model commission studio', ['dollhouse maker', 'dollhouse', 'doll house', 'miniature house', 'miniature furniture', 'custom dollhouse']],
      [/\b(?:independent miniature model makers?|miniature model makers?|scale model makers?|model makers?|miniature makers?)\b/u, 'miniature model commission studio', ['miniature model maker', 'model maker', 'scale model maker', 'miniature maker', 'custom miniature', 'scale model']],
      [/\b(?:glass artists?|glass artisans?|stained glass artists?|glassblowers?|glass blowing studios?|glass studios?|glass art studios?)\b/u, 'custom craft workshop', ['glass artist', 'glass artisan', 'stained glass', 'glassblower', 'glass blowing', 'glass studio', 'glass art']],
      [/\b(?:leather craft workshops?|leather workshops?|leatherworkers?|leather artisans?|embroidery businesses?|embroidery shops?|embroidery workshops?|embroiderers?|custom embroidery|screen printing shops?|woodworking shops?|woodworking workshops?|woodworkers?|craft workshops?|craft studios?|artisan workshops?|maker studios?)\b/u, 'custom craft workshop', ['leather craft', 'leather workshop', 'leatherworker', 'leather artisan', 'embroidery', 'embroiderer', 'screen printing', 'woodworking', 'woodworker', 'craft workshop', 'craft studio', 'artisan workshop', 'maker studio']],
      [/\brestaurants?\b/u, 'restaurant', ['restaurant', 'kitchen']],
    ];
    for (const [pattern, label, anchors] of patterns) {
      if (pattern.test(text)) return { label, anchors, excluded: [] };
    }

    const genericCraftMatch = text.match(
      /\b(?:independent|small|custom|local)?\s*([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2})\s+(?:craft\s+)?(?:workshops?|shops?|studios?|businesses?|makers?|artisans?|artists?|specialists?)\b/u,
    );
    if (
      genericCraftMatch?.[1] &&
      /\b(?:custom orders?|commissions?|materials?|design revisions?|approved specifications?|approved versions?|artwork|engraving|stitching|thread colors?|placement instructions?|hardware selections?|fragrance combinations?|wax types?|container sizes?|label designs?|color preferences?|quantities?|delivery deadlines?)\b/u.test(text)
    ) {
      const craft = genericCraftMatch[1].trim();
      return {
        label: 'custom craft workshop',
        anchors: [craft, `${craft} workshop`, `${craft} shop`, `${craft} business`, `${craft} maker`, `${craft} artisan`],
        excluded: [],
      };
    }
    return null;
  }

  private static resolveScoredCrossDomainConstraint(
    text: string,
  ): RequestVerticalConstraint | null {
    const urbanEnergyActor =
      /\b(?:cities|city governments?|municipalities|municipal governments?|smart cities|urban infrastructure operators?|city infrastructure teams?)\b/u.test(text);
    const urbanEnergyAssets =
      /\b(?:public buildings?|municipal buildings?|street lighting|streetlights?|charging stations?|ev charging|electric vehicle charging|urban infrastructure)\b/u.test(text);
    const urbanEnergyDemand =
      /\b(?:electricity demand|energy demand|energy consumption|power demand|peak demand|peak load|high usage|load growth|consumption patterns?|energy efficiency)\b/u.test(text);
    const urbanEnergySignals =
      /\b(?:equipment status|weather conditions?|service demand|consumption data|demand forecast|forecasting|overloaded infrastructure|service interruptions?|energy costs?)\b/u.test(text);

    const urbanEnergyScore =
      (urbanEnergyActor ? 3 : 0) +
      (urbanEnergyAssets ? 2.5 : 0) +
      (urbanEnergyDemand ? 2 : 0) +
      (urbanEnergySignals ? 1.5 : 0);

    if (urbanEnergyScore >= 7) {
      return {
        kind: 'URBAN_ENERGY_DEMAND_INTELLIGENCE',
        label: 'urban electricity demand and infrastructure efficiency operations',
        strict: true,
        requiredAnchors: [
          'city',
          'smart city',
          'municipality',
          'public building',
          'street lighting',
          'charging station',
          'urban infrastructure',
        ],
        workflowAnchors: [
          'electricity demand',
          'energy demand',
          'energy consumption',
          'power demand',
          'peak demand',
          'peak load',
          'equipment status',
          'weather condition',
          'service demand',
          'consumption pattern',
          'demand forecast',
          'overloaded infrastructure',
          'service interruption',
          'energy cost',
          'energy efficiency',
        ],
        excludedAnchors: [
          'consumer billing app',
          'home electricity bill',
          'mobile subscription',
          'login screen',
          'smart meter cyberattack',
          'malicious interference',
        ],
      };
    }

    const urbanActor =
      /\b(?:urban transportation agencies?|transportation agencies?|transit agencies?|city transport(?:ation)? departments?|municipal transport(?:ation)?|public transport(?:ation)? authorities?|urban mobility agencies?)\b/u.test(text);
    const urbanFlow =
      /\b(?:traffic flow|traffic congestion|public transit demand|transit demand|road incidents?|travel times?|travel time reliability|route performance|route inefficien|peak hours?|time periods?|bottlenecks?)\w*\b/u.test(text);
    const urbanImpact =
      /\b(?:vehicle emissions?|fuel consumption|fuel use|air quality|environmental measurements?|longer journeys?|transportation improvements?)\w*\b/u.test(text);
    const urbanIntegration =
      /\b(?:separate systems?|analy[sz]ed separately|greatest inefficien|which routes?|which time periods?)\w*\b/u.test(text);

    const energyActor =
      /\b(?:energy providers?|electric utilities?|power utilities?|utility companies?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid|smart meter operators?)\b/u.test(text);
    const energyDevice =
      /\b(?:connected meters?|smart meters?|remote monitoring devices?|automated control systems?|distribution automation|device failures?|meter failures?|telemetry|device health|network health)\b/u.test(text);
    const energySecurity =
      /\b(?:unauthorized access|access attempts?|malicious interference|cyberattacks?|cyber attacks?|consumption anomalies?|unusual consumption|consumption data integrity|incident attribution|incident response)\b/u.test(text);

    let urbanScore = 0;
    if (urbanActor) urbanScore += 3;
    if (urbanFlow) urbanScore += 2;
    if (urbanImpact) urbanScore += 1.5;
    if (urbanIntegration) urbanScore += 0.75;
    if (energyActor || energyDevice) urbanScore -= 2.5;

    let energyScore = 0;
    if (energyActor) energyScore += 3;
    if (energyDevice) energyScore += 2;
    if (energySecurity) energyScore += 2;
    if (urbanActor && !energyActor) energyScore -= 2.5;

    if (urbanScore >= 5 && urbanScore >= energyScore + 1) {
      return {
        kind: 'URBAN_MOBILITY_CONGESTION_EMISSIONS',
        label: 'urban mobility congestion, travel-time, and emissions operations',
        strict: true,
        requiredAnchors: [
          'urban transportation',
          'transportation agency',
          'transit agency',
          'urban mobility',
          'public transport',
        ],
        workflowAnchors: [
          'traffic flow',
          'traffic congestion',
          'public transit demand',
          'road incident',
          'travel time',
          'travel time reliability',
          'route performance',
          'peak hour',
          'bottleneck',
          'vehicle emission',
          'fuel consumption',
          'air quality',
          'environmental measurement',
          'transportation improvement',
        ],
        excludedAnchors: [
          'app registration',
          'login screen',
          'subscription',
          'food delivery',
          'hotel booking',
        ],
      };
    }

    if (energyScore >= 5 && energyScore >= urbanScore + 1) {
      return {
        kind: 'ENERGY_IOT_SECURITY_DIAGNOSIS',
        label: 'energy iot anomaly and incident attribution operations',
        strict: true,
        requiredAnchors: [
          'energy provider',
          'electric utility',
          'power utility',
          'grid operator',
          'electricity distribution',
          'power distribution',
          'power grid',
          'smart meter',
          'connected meter',
        ],
        workflowAnchors: [
          'connected meter',
          'smart meter',
          'remote monitoring',
          'automated control',
          'device failure',
          'meter failure',
          'unusual consumption',
          'consumption anomaly',
          'network disruption',
          'unauthorized access',
          'malicious interference',
          'telemetry',
          'device health',
          'network health',
          'consumption data integrity',
          'incident attribution',
          'incident response',
        ],
        excludedAnchors: [
          'mobile payment',
          'billing app',
          'login screen',
          'subscription',
        ],
      };
    }

    return null;
  }

  private static resolveRentalIdentityAnchors(value: string): string[] {
    const normalized = this.normalize(value);
    const anchors: string[] = [];
    const seen = new Set<string>();
    const add = (candidate: string) => {
      const cleaned = this.normalize(candidate)
        .replace(/\b(?:independent|local|small|large)\b/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!cleaned || seen.has(cleaned)) return;
      seen.add(cleaned);
      anchors.push(cleaned);
    };

    const match = normalized.match(
      /\b((?:[\p{L}\p{N}'’-]+\s+){0,4}[\p{L}\p{N}'’-]+)\s+(rental|rentals|hire)\s+(?:shops?|stores?|businesses?|services?|companies?)\b/u,
    );
    const object = this.normalize(match?.[1] ?? '')
      .replace(/\b(?:independent|local|small|large)\b/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const mode = this.normalize(match?.[2] ?? 'rental');
    if (object) {
      add(`${object} ${mode}`);
      add(object);
      const objectTokens = object.split(' ').filter(Boolean);
      if (objectTokens.length > 1) {
        const tail = objectTokens.slice(-2).join(' ');
        add(`${tail} ${mode}`);
        add(`${mode} ${tail}`);
      } else {
        add(`${mode} ${object}`);
      }
    }
    return anchors.slice(0, 4);
  }

  /**
   * Extracts a small set of requester-owned identity anchors for generic
   * account-security workflows. The extraction is intentionally domain
   * agnostic: it uses the actor/role nouns already present in the request
   * instead of maintaining a catalogue of industries.
   */
  private static resolveRequestIdentityAnchors(value: string): string[] {
    const normalized = this.normalize(value);
    const anchors: string[] = [];
    const seen = new Set<string>();
    const add = (candidate: string | undefined) => {
      const cleaned = this.normalize(candidate ?? '')
        .replace(/\b(?:independent|local|small|large|online|digital)\b/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!cleaned || cleaned.split(' ').length > 4 || seen.has(cleaned)) {
        return;
      }
      const generic = new Set([
        'company', 'companies', 'organization', 'organizations', 'business',
        'businesses', 'platform', 'platforms', 'portal', 'portals', 'service',
        'services', 'user', 'users', 'account', 'accounts', 'hr', 'or', 'and',
        'delayed', 'delay', 'security', 'access', 'online', 'digital', 'system',
      ]);
      const tokens = cleaned.split(' ').filter(Boolean);
      if (tokens.every((token) => generic.has(token))) return;
      seen.add(cleaned);
      anchors.push(cleaned);
    };

    const organizationMatch = normalized.match(
      /\b([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3})\s+(?:companies?|agencies?|organizations?|organisations?|institutions?|universities|hospitals?|clinics?|authorities?|providers?|operators?|departments?|utilities?)\b/u,
    );
    add(organizationMatch?.[1]);

    const municipalIdentityTerms = [
      'smart city', 'city government', 'municipal government', 'municipality',
      'local authority', 'public service', 'parking authority', 'parking operator',
      'public utility', 'utility provider', 'municipal payment', 'city payment',
      'parking payment', 'transit payment', 'utility payment', 'municipal fee',
    ];
    for (const term of municipalIdentityTerms) {
      if (normalized.includes(term)) add(term);
      if (anchors.length >= 4) break;
    }

    for (const match of normalized.matchAll(
      /\b([\p{L}\p{N}'’-]+)\s+(?:accounts?|portals?|records?|payments?|documents?|services?)\b/gu,
    )) {
      const modifier = match[1];
      if (/^(?:user|online|digital|account|security|access)$/u.test(modifier)) {
        continue;
      }
      add(modifier);
      if (anchors.length >= 4) break;
    }

    return anchors.slice(0, 4);
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s&/'’-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
