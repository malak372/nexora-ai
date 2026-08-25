import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';
import { RequestOperationalCostAttributionUtil } from './request-operational-cost-attribution.util';

export type RequestWorkflowArchetype =
  | 'CONSUMER_SOFTWARE'
  | 'DEVELOPER_TECHNICAL'
  | 'FINANCIAL_TRANSACTION_OPERATIONS'
  | 'ECOMMERCE_PROFITABILITY_OPERATIONS'
  | 'SUBSCRIPTION_REVENUE_RETENTION_OPERATIONS'
  | 'MEDIA_CONTENT_PROFITABILITY_OPERATIONS'
  | 'TRANSPORTATION_PROFITABILITY_OPERATIONS'
  | 'LOGISTICS_PROFITABILITY_OPERATIONS'
  | 'RESTAURANT_DELIVERY_FRAUD_OPERATIONS'
  | 'TRANSACTION_ACCOUNT_ABUSE_OPERATIONS'
  | 'FACILITY_RESOURCE_MONITORING_OPERATIONS'
  | 'DIGITAL_TRUST_SAFETY_OPERATIONS'
  | 'ACCOUNT_ACCESS_SECURITY_OPERATIONS'
  | 'ENTERPRISE_IDENTITY_ACCESS_SECURITY_OPERATIONS'
  | 'ACADEMIC_PLATFORM_SECURITY_OPERATIONS'
  | 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS'
  | 'BUILDING_ENVIRONMENTAL_MONITORING_OPERATIONS'
  | 'URBAN_MOBILITY_OPERATIONS'
  | 'URBAN_ENERGY_DEMAND_OPERATIONS'
  | 'GOVERNMENT_RECORD_SECURITY_OPERATIONS'
  | 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS'
  | 'PHYSICAL_LOCAL_SERVICE_OPERATIONS'
  | 'RENTAL_INVENTORY_OPERATIONS'
  | 'MANUFACTURING_COST_PROFITABILITY_OPERATIONS'
  | 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH_OPERATIONS'
  | 'RENEWABLE_ASSET_PERFORMANCE_OPERATIONS'
  | 'INDUSTRIAL_SUPPLY_CHAIN_OPERATIONS'
  | 'AGRICULTURAL_SUPPLY_CHAIN_OPERATIONS'
  | 'AGRICULTURAL_DISTRIBUTION_PROFITABILITY_OPERATIONS'
  | 'AGRICULTURAL_EXPORT_PROFITABILITY_OPERATIONS'
  | 'FARM_ENERGY_OPERATIONS'
  | 'COMMERCIAL_BUILDING_ENERGY_OPERATIONS'
  | 'CONNECTED_ASSET_SECURITY_OPERATIONS'
  | 'PROFESSIONAL_EVIDENCE_RECORDS_OPERATIONS'
  | 'PROFESSIONAL_SERVICE_AGENCY_OPERATIONS'
  | 'RESTAURANT_ENERGY_OPERATIONS'
  | 'FOOD_STORAGE_CONDITION_OPERATIONS'
  | 'RESTORATION_CONSERVATION_OPERATIONS'
  | 'RESIDENTIAL_CLEANING_OPERATIONS'
  | 'HEALTHCARE_COST_RESOURCE_EFFICIENCY_OPERATIONS'
  | 'HEALTHCARE_INSTITUTIONAL_OPERATIONS'
  | 'ACADEMIC_INSTITUTIONAL_OPERATIONS'
  | 'ENTERPRISE_POLICY_COMPLIANCE_OPERATIONS'
  | 'TOURISM_DESTINATION_OPERATIONS'
  | 'PUBLIC_SECTOR_OPERATIONS'
  | 'OPERATIONAL_COST_ATTRIBUTION_OPERATIONS'
  | 'MUNICIPAL_WASTE_COLLECTION_OPERATIONS'
  | 'MUSICAL_MANUSCRIPT_RESTORATION_OPERATIONS'
  | 'GENERAL_OPERATIONAL';

export type RequestWorkflowArchetypeResult = {
  readonly archetype: RequestWorkflowArchetype;
  readonly confidence: number;
  readonly preferredSourceKeys: readonly string[];
  readonly blockedSourceKeys: readonly string[];
};

export class RequestWorkflowArchetypeUtil {
  static classify(input: {
    readonly requestDescription?: string | null;
    readonly plannedQueries?: readonly string[];
    readonly intentConcepts?: readonly string[];
    readonly selectedDomainNames?: readonly string[];
  }): RequestWorkflowArchetypeResult {
    const requestText = this.normalize(input.requestDescription ?? '');
    const intentProfile = RequestWorkflowIntentProfileUtil.resolve(
      input.requestDescription,
    );
    const text = this.normalize([
      input.requestDescription ?? '',
      ...(input.plannedQueries ?? []),
      ...(input.intentConcepts ?? []),
      ...(input.selectedDomainNames ?? []),
    ].join(' '));

    const developerSubject =
      /\b(?:api|sdk|source code|codebase|stack trace|exception|docker|kubernetes|containerized|containerization|container runtime|software container|database schema|webhook|endpoint|repository|github|smart contract code|contract testing|unit tests?|integration tests?|telemetry endpoint|firmware integration)\b/iu.test(text) ||
      /\b(?:software|application|app|server|container|node|javascript|typescript|python|java)\s+runtime\b|\bruntime\s+(?:error|exception|environment|version|dependency|crash)\b/iu.test(text);

    // Request-description-first collision guard. Payment/refund/account-abuse
    // transportation workflows must be fixed before broader account-security
    // or connected-asset branches inspect planner/domain vocabulary.
    if (
      intentProfile.family === 'TRANSACTION_ACCOUNT_ABUSE' &&
      !developerSubject
    ) {
      return this.result(
        'TRANSACTION_ACCOUNT_ABUSE_OPERATIONS',
        intentProfile.confidence,
        ['news', 'app-store', 'google-play', 'forum', 'crossref', 'gdelt', 'youtube'],
        ['github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }
    if (
      intentProfile.family === 'FACILITY_RESOURCE_MONITORING' &&
      !developerSubject
    ) {
      return this.result(
        'FACILITY_RESOURCE_MONITORING_OPERATIONS',
        intentProfile.confidence,
        ['forum', 'news', 'crossref', 'gdelt', 'reddit', 'youtube'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const buildingEnvironmentalActor =
      /\b(?:property managers?|building managers?|facility managers?|maintenance teams?|residential complexes?|apartment complexes?|housing complexes?|multi[- ]family buildings?|residential buildings?|apartment buildings?|property operations?)\b/iu.test(text);
    const buildingEnvironmentalWorkflow =
      /\b(?:temperature|humidity|water usage|water consumption|air quality|indoor air quality|equipment readings?|sensor readings?|environmental performance|environmental monitoring|building conditions?|abnormal conditions?|leak detection|water waste|iaq|iot|internet of things|telemetry|sensors?)\b/iu.test(text);
    const buildingEnvironmentalImpact =
      /\b(?:water waste|uncomfortable|comfort|delayed maintenance|maintenance delay|operating costs?|energy waste|environmental problems?|abnormal conditions?|leaks?|poor air quality|equipment fault|equipment failure|higher costs?)\w*\b/iu.test(text);
    if (buildingEnvironmentalActor && buildingEnvironmentalWorkflow && buildingEnvironmentalImpact && !developerSubject) {
      return this.result(
        'BUILDING_ENVIRONMENTAL_MONITORING_OPERATIONS',
        0.99,
        ['forum', 'gdelt', 'news', 'crossref', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const urbanEnergyActor =
      /\b(?:cities|city governments?|municipalities|municipal governments?|smart cities|urban infrastructure operators?|city infrastructure teams?)\b/iu.test(
        text,
      );
    const urbanEnergyAssets =
      /\b(?:public buildings?|municipal buildings?|street lighting|streetlights?|charging stations?|ev charging|electric vehicle charging|urban infrastructure)\b/iu.test(
        text,
      );
    const urbanEnergyDemand =
      /\b(?:electricity demand|energy demand|energy consumption|power demand|peak demand|peak load|high usage|load growth|consumption patterns?|energy efficiency)\b/iu.test(
        text,
      );
    const urbanEnergySignals =
      /\b(?:equipment status|weather conditions?|service demand|demand forecast|forecasting|overloaded infrastructure|service interruptions?|energy costs?|consumption data)\b/iu.test(
        text,
      );
    if (
      urbanEnergyActor &&
      urbanEnergyAssets &&
      urbanEnergyDemand &&
      urbanEnergySignals &&
      !developerSubject
    ) {
      return this.result(
        'URBAN_ENERGY_DEMAND_OPERATIONS',
        0.99,
        ['news', 'gdelt', 'crossref', 'forum', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const urbanMobilityActor =
      /\b(?:urban transportation agencies?|transportation agencies?|transit agencies?|city transport(?:ation)? departments?|municipal transport(?:ation)?|public transport(?:ation)? authorities?|urban mobility agencies?)\b/iu.test(text);
    const urbanMobilityWorkflow =
      /\b(?:traffic flow|traffic congestion|public transit demand|transit demand|road incidents?|travel times?|travel time reliability|route performance|route inefficien|peak hours?|time periods?|bottlenecks?|traffic demand)\w*\b/iu.test(text);
    const urbanMobilityImpact =
      /\b(?:vehicle emissions?|emissions?|fuel consumption|fuel use|air quality|environmental measurements?|longer journeys?|delays?|congestion|reliable travel times?|transportation improvements?)\w*\b/iu.test(text);
    if (
      urbanMobilityActor &&
      urbanMobilityWorkflow &&
      urbanMobilityImpact &&
      !developerSubject
    ) {
      return this.result(
        'URBAN_MOBILITY_OPERATIONS',
        0.99,
        ['news', 'gdelt', 'crossref', 'forum', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const governmentRecordActor =
      /\b(?:government agencies?|government departments?|public sector agencies?|public authorities?|regulatory agencies?|licensing authorities?)\b/iu.test(text);
    const governmentRecordWorkflow =
      /\b(?:legal records?|licensing documents?|citizen applications?|regulatory files?|official records?|public records?|permit records?|case files?|access logs?|document histor(?:y|ies)|employee activity|security alerts?)\b/iu.test(text);
    const governmentRecordSecurity =
      /\b(?:unauthorized access|unauthorised access|manipulation|tamper(?:ing|ed)?|suspicious changes?|who accessed|security incident|incident investigation|audit trail|compromised records?|compliance violations?)\b/iu.test(text);
    if (
      governmentRecordActor &&
      governmentRecordWorkflow &&
      governmentRecordSecurity &&
      !developerSubject
    ) {
      return this.result(
        'GOVERNMENT_RECORD_SECURITY_OPERATIONS',
        0.99,
        ['news', 'gdelt', 'crossref', 'forum', 'blog', 'youtube'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const academicSecurityActor =
      /\b(?:public education systems?|education systems?|schools?|school districts?|education authorities?|universities|university|higher education|online learning systems?|learning platforms?|learning management systems?|\blms\b|examination platforms?|online exams?|online assessments?|student information systems?|students?|instructors?|administrative accounts?)\b/iu.test(requestText);
    const academicSecurityWorkflow =
      /\b(?:login activity|login records?|sign[- ]?in activity|authentication logs?|exam sessions?|online exam sessions?|examination platforms?|account permissions?|access permissions?|administrative accounts?|device information|device data|device fingerprints?|security alerts?|account activity|student records?|record access|record changes?|academic integrity|exam integrity)\b/iu.test(requestText);
    const academicSecurityRisk =
      /\b(?:compromised accounts?|account compromise|suspicious activity|suspicious logins?|unauthorized access|unauthorised access|security incidents?|cybersecurity|detect compromised|false positives?|unnecessary restrictions?|exposed student information|exam integrity)\b/iu.test(requestText);
    if (
      academicSecurityActor &&
      academicSecurityWorkflow &&
      academicSecurityRisk &&
      !developerSubject
    ) {
      return this.result(
        'ACADEMIC_PLATFORM_SECURITY_OPERATIONS',
        0.995,
        ['forum', 'news', 'gdelt', 'crossref', 'youtube', 'blog'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    /*
     * Enterprise identity/access governance must be resolved from the requester
     * description itself. Planned queries are search hints and may contain HR
     * policy, fraud, or technical terms that must never reframe the real
     * workflow. This branch intentionally precedes generic enterprise policy.
     */
    const enterpriseEmployeeIdentityActor =
      /\b(?:large companies?|enterprises?|organizations?|organisations?|corporations?|businesses?|employers?)\b/iu.test(requestText) &&
      /\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|employee accounts?|user accounts?|employee access)\b/iu.test(requestText);
    const enterpriseEmployeeAccessWorkflow =
      /\b(?:login activity|login records?|sign[- ]?in activity|sign[- ]?in records?|authentication logs?|system permissions?|account permissions?|access permissions?|permissions?|access rights?|entitlements?|employee access|employee role changes?|role changes?|role transitions?|department changes?|move between departments?|transfers?|offboarding|deprovision(?:ing|ed)?|account removal|access removal|temporary project access|project access|responsibilit(?:y|ies)|privilege creep|least privilege|identity lifecycle|account lifecycle|joiner mover leaver|internal system usage|access logs?)\b/iu.test(requestText);
    const enterpriseEmployeeSecurityRisk =
      /\b(?:unusual account behavior|unusual behavior|suspicious account activity|suspicious activity|compromised account|account compromise|unauthorized access|unauthorised access|internal information|outside (?:their )?responsibilit(?:y|ies)|excessive privileges?|stale access|orphaned accounts?|access drift|delayed account removal|delayed deprovisioning|security alerts?|security investigations?|security incidents?|incident investigation|false positives?|unnecessary security investigations?|unnecessary account restrictions?)\b/iu.test(requestText);
    if (
      enterpriseEmployeeIdentityActor &&
      enterpriseEmployeeAccessWorkflow &&
      enterpriseEmployeeSecurityRisk &&
      !developerSubject
    ) {
      return this.result(
        'ENTERPRISE_IDENTITY_ACCESS_SECURITY_OPERATIONS',
        0.995,
        ['news', 'crossref', 'youtube', 'gdelt', 'reddit'],
        ['app-store', 'google-play', 'product-hunt', 'forum', 'hacker-news', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const healthcareBillingFraudActor =
      /\b(?:private healthcare providers?|healthcare providers?|medical practices?|clinics?|hospitals?|patient billing systems?|medical billing systems?|health insurance systems?)\b/iu.test(requestText);
    const healthcareBillingFraudWorkflow =
      /\b(?:patient billing|medical billing|insurance records?|insurance claims?|patient invoices?|login history|login activity|payment transactions?|payment activity|security alerts?|patient accounts?|patient portals?)\b/iu.test(requestText);
    const healthcareBillingFraudRisk =
      /\b(?:fraudulent claims?|claim fraud|billing fraud|payment fraud|suspicious payment activity|unauthorized account access|unauthorised account access|compromised patient accounts?|account takeover|coordinated abuse|false positives?|unnecessary restrictions?|fraud investigations?|security investigations?)\b/iu.test(requestText);
    if (
      healthcareBillingFraudActor &&
      healthcareBillingFraudWorkflow &&
      healthcareBillingFraudRisk &&
      !developerSubject
    ) {
      return this.result(
        'ACCOUNT_ACCESS_SECURITY_OPERATIONS',
        0.998,
        ['news', 'crossref', 'reddit', 'youtube', 'gdelt'],
        ['product-hunt', 'forum', 'hacker-news', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const accountSecurityActor =
      /\b(?:online portals?|user portals?|customer portals?|tenant portals?|staff portals?|member portals?|digital portals?|online platforms?|user accounts?|customer accounts?|tenant accounts?|staff accounts?|employee accounts?|member accounts?)\b/iu.test(text);
    const accountSecurityWorkflow =
      /\b(?:login activity|login records?|sign[- ]?in activity|authentication|account permissions?|access permissions?|access rights?|roles?|privileges?|payment behavior|payment changes?|security alerts?|device information|account activity)\b/iu.test(text);
    const accountSecurityRisk =
      /\b(?:compromised accounts?|account compromise|account takeover|unauthorized access|unauthorised access|fraudulent|fraud|suspicious activity|delayed investigations?|incident investigation|false positives?|unnecessary restrictions?|legitimate users? restricted)\b/iu.test(text);
    if (
      accountSecurityActor &&
      accountSecurityWorkflow &&
      accountSecurityRisk &&
      !developerSubject
    ) {
      return this.result(
        'ACCOUNT_ACCESS_SECURITY_OPERATIONS',
        0.995,
        [
          'forum',
          'reddit',
          'news',
          'app-store',
          'google-play',
          'github',
          'youtube',
          'crossref',
        ],
        ['product-hunt'],
      );
    }

    const propertyActor =
      /\b(?:property management(?: companies?)?|property investment compan(?:y|ies)|real estate compan(?:y|ies)|real estate firms?|property investors?|real estate investors?|investment properties?|property managers?|asset managers?|rental properties?|rental buildings?|apartment buildings?|residential properties?|landlords?|real estate portfolios?)\b/iu.test(text);
    const propertyFinancialAnchor =
      /\b(?:property returns?|building returns?|return estimates?|investment returns?|\broi\b|net operating income|\bnoi\b|cash flow|vacancy periods?|vacancy rates?|financing costs?|mortgage interest|interest rates?|market rents?|rent growth|profitability|financial performance|portfolio performance|rent payments?|rental income)\b/iu.test(text);
    const propertyPerformanceWorkflow =
      /\b(?:maintenance expenses?|maintenance costs?|operating costs?|operating expenses?|repair expenses?|maintenance investments?|local market changes?|expense forecasting|unexpected expenses?|declining returns?|lower returns?|financial inefficien|data silos?|separate systems?)\w*\b/iu.test(text);
    if (propertyActor && propertyFinancialAnchor && propertyPerformanceWorkflow && !developerSubject) {
      return this.result(
        'PROPERTY_ASSET_PERFORMANCE_OPERATIONS',
        0.98,
        ['reddit', 'forum', 'gdelt', 'news', 'crossref', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const ecommerceProfitabilityActor =
      /\b(?:online retailers?|online stores?|e[- ]?commerce|ecommerce merchants?|online merchants?|shopify merchants?|digital retailers?)\b/iu.test(text);
    const ecommerceProfitabilityWorkflow =
      /\b(?:profit margins?|margin change|margin erosion|contribution margin|net profit|gross revenue|profitability|campaign profitability|profitable products?|profitable campaigns?)\b/iu.test(text) &&
      /\b(?:product discounts?|advertising costs?|ad spend|returns?|refunds?|payment fees?|gateway fees?|shipping expenses?|shipping costs?|fulfillment costs?|customer purchasing behavior|pricing decisions?)\b/iu.test(text);
    if (ecommerceProfitabilityActor && ecommerceProfitabilityWorkflow && !developerSubject) {
      return this.result(
        'ECOMMERCE_PROFITABILITY_OPERATIONS',
        0.99,
        ['reddit', 'forum', 'news', 'gdelt', 'crossref', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    /*
     * Subscription-business retention analytics is an operator/revenue workflow,
     * not a consumer subscription-access/refund workflow. Resolve it from the
     * requester description alone so selected domains such as Finance or
     * E-commerce can enrich retrieval without changing the actor/problem.
     */
    const subscriptionRevenueActor =
      /\b(?:online subscription businesses?|subscription businesses?|subscription companies?|subscription services?|subscription platforms?|saas businesses?|saas companies?|membership businesses?)\b/iu.test(requestText);
    const subscriptionRevenueWorkflow =
      /\b(?:customer cancellations?|customers? cancel|churn|churn risk|renewal history|renewals?|retention|retention offers?|recurring revenue|subscription payments?|discount usage|pricing plans?|pricing tiers?|plan profitability|unprofitable plans?|product usage|usage behavior|support interactions?|refund activity|financial forecasts?|forecasting)\b/iu.test(requestText);
    const subscriptionRevenueDecision =
      /\b(?:why customers? cancel|likely to leave|signal(?:s)? that .* leave|churn risk|retention offers?|unprofitable pricing plans?|pricing plans? .* unprofitable|recurring revenue|financial forecasts?|forecast accuracy|renewal behavior)\b/iu.test(requestText);
    if (
      subscriptionRevenueActor &&
      subscriptionRevenueWorkflow &&
      subscriptionRevenueDecision &&
      !developerSubject
    ) {
      return this.result(
        'SUBSCRIPTION_REVENUE_RETENTION_OPERATIONS',
        0.995,
        ['forum', 'news', 'gdelt', 'crossref', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const mediaContentProfitabilityActor =
      /\b(?:streaming and digital entertainment companies?|streaming companies?|streaming services?|streaming platforms?|digital entertainment companies?|digital entertainment platforms?|digital entertainment services?|media and entertainment companies?|media and entertainment platforms?|media companies?|digital media platforms?|content platforms?|gaming platforms?|game platforms?)\b/iu.test(text);
    const mediaContentProfitabilityWorkflow =
      /\b(?:content profitability|sustainable revenue|subscription activity|subscription revenue|advertising income|advertising revenue|ad revenue|production costs?|viewing behavior|viewer behavior|cancellations?|subscriber churn|promotional campaigns?|content categories?|shows?|creators?|financial return|revenue forecasts?|content investment|investment decisions?)\b/iu.test(text);
    if (
      mediaContentProfitabilityActor &&
      mediaContentProfitabilityWorkflow &&
      !developerSubject
    ) {
      return this.result(
        'MEDIA_CONTENT_PROFITABILITY_OPERATIONS',
        0.99,
        ['reddit', 'forum', 'news', 'gdelt', 'crossref', 'blog', 'youtube'],
        ['github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news', 'app-store', 'google-play'],
      );
    }

    const logisticsProfitabilityActor =
      /\b(?:logistics companies?|logistics providers?|logistics operators?|third[- ]party logistics|3pl providers?|freight companies?|freight operators?|delivery operators?|parcel carriers?|distribution operators?|warehouse and delivery operators?|supply chain operators?)\b/iu.test(text);
    const logisticsProfitabilityWorkflow =
      /\b(?:delivery operations?|operating costs?|operating expenses?|fuel expenses?|fuel costs?|warehouse costs?|warehousing costs?|failed deliveries?|delivery failures?|vehicle maintenance|maintenance costs?|route performance|route profitability|customer penalties?|delivery penalties?|penalty costs?|profit margins?|margin erosion|profitability|route planning|pricing decisions?|financial forecasts?|shipment volumes?|delivery volumes?|cost per shipment|cost per delivery)\b/iu.test(text) &&
      /\b(?:profit margins?|profitability|margin erosion|operating costs?|operating expenses?|financial forecasts?|pricing decisions?|cost per shipment|cost per delivery|reducing profit|reduce profit|increasing costs?|become more expensive)\b/iu.test(text);
    if (
      logisticsProfitabilityActor &&
      logisticsProfitabilityWorkflow &&
      !developerSubject
    ) {
      return this.result(
        'LOGISTICS_PROFITABILITY_OPERATIONS',
        0.99,
        ['reddit', 'forum', 'news', 'gdelt', 'crossref', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const transportationProfitabilityActor =
      /\b(?:transportation companies?|transport companies?|transport operators?|transportation operators?|fleet operators?|fleet managers?|transit operators?|passenger transport companies?|bus companies?|coach operators?|delivery fleets?|delivery operators?|commercial fleets?)\b/iu.test(text);
    const transportationProfitabilityWorkflow =
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|maintenance costs?|maintenance expenses?|route performance|route profitability|route margins?|driver schedules?|driver rosters?|ticket revenue|fare revenue|delivery revenue|vehicle utilization|fleet utilization|pricing decisions?|financial forecasts?|profitability|margin erosion|cost variance|cost increases?|cost spikes?)\b/iu.test(text);
    if (
      transportationProfitabilityActor &&
      transportationProfitabilityWorkflow &&
      !developerSubject
    ) {
      return this.result(
        'TRANSPORTATION_PROFITABILITY_OPERATIONS',
        0.99,
        ['reddit', 'forum', 'news', 'gdelt', 'crossref', 'blog', 'youtube'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const operationalCostAttribution =
      RequestOperationalCostAttributionUtil.resolve(input.requestDescription);
    if (operationalCostAttribution && !developerSubject) {
      return this.result(
        'OPERATIONAL_COST_ATTRIBUTION_OPERATIONS',
        0.995,
        ['crossref', 'news', 'gdelt', 'reddit'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news', 'forum', 'youtube', 'blog'],
      );
    }

    const financialActor = /\b(?:financial institutions?|banks?|banking|digital payments?|payment platforms?|fintech|wallets?|card payments?|money transfer|transfers?|merchant payments?)\b/iu.test(text);
    const financialWorkflow = /\b(?:transactions?|payments?|fraud|unauthorized transfers?|identity checks?|account activity|security alerts?|verification failures?|chargebacks?|disputes?|reconciliation|account restrictions?|frozen accounts?|suspicious transactions?|payment delays?|payouts?)\b/iu.test(text);
    if (financialActor && financialWorkflow && !developerSubject) {
      return this.result(
        'FINANCIAL_TRANSACTION_OPERATIONS',
        0.96,
        ['reddit', 'hacker-news', 'news', 'gdelt', 'youtube', 'app-store', 'google-play', 'blog'],
        ['github', 'stackoverflow', 'dev-to', 'product-hunt'],
      );
    }

    const restaurantDeliveryFraudActor = /\b(?:restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|online food ordering services?|meal delivery platforms?|restaurant courier platforms?)\b/iu.test(requestText);
    const restaurantDeliveryFraudWorkflow = /\b(?:suspicious orders?|account takeovers?|account takeover|refund abuse|fraudulent refunds?|promotional abuse|promo(?:tional)? fraud|promo code abuse|payment behavior|device information|device signals?|device fingerprints?|customer complaints?|security alerts?|false positives?|blocked legitimate (?:users?|customers?)|coordinated abuse|fraud detection)\b/iu.test(requestText);
    if (restaurantDeliveryFraudActor && restaurantDeliveryFraudWorkflow && !developerSubject) {
      return this.result(
        'RESTAURANT_DELIVERY_FRAUD_OPERATIONS',
        0.995,
        ['app-store', 'google-play', 'news', 'gdelt', 'forum', 'youtube', 'blog', 'crossref'],
        ['github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const digitalTrustActor = /\b(?:online marketplaces?|marketplaces?|e[- ]?commerce platforms?|commerce platforms?|seller platforms?|multi[- ]vendor platforms?|online stores?|digital marketplaces?|trust and safety|content moderation)\b/iu.test(text);
    const digitalTrustWorkflow = /\b(?:fake sellers?|seller accounts?|suspicious listings?|product listings?|fraudulent reviews?|fake reviews?|review manipulation|unusual purchasing|purchase behavior|transaction history|seller activity|coordinated fraud|fraud patterns?|fraud detection|false positives?|legitimate sellers?|seller restrictions?|account restrictions?|customer trust)\b/iu.test(text);
    if (digitalTrustActor && digitalTrustWorkflow && !developerSubject) {
      return this.result(
        'DIGITAL_TRUST_SAFETY_OPERATIONS',
        0.98,
        ['app-store', 'google-play', 'news', 'gdelt', 'reddit', 'youtube', 'blog'],
        ['github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    if (
      intentProfile.family === 'FOOD_STORAGE_CONDITION' &&
      !developerSubject
    ) {
      return this.result(
        'FOOD_STORAGE_CONDITION_OPERATIONS',
        intentProfile.confidence,
        ['news', 'forum', 'crossref', 'youtube', 'gdelt'],
        ['product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news', 'app-store', 'google-play'],
      );
    }

    if (
      intentProfile.family === 'RESTAURANT_ENERGY' &&
      !developerSubject
    ) {
      return this.result(
        'RESTAURANT_ENERGY_OPERATIONS',
        intentProfile.confidence,
        ['news', 'gdelt', 'forum', 'crossref', 'youtube'],
        ['product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news', 'app-store', 'google-play'],
      );
    }

    const farmEnergyActor =
      /\b(?:large farms?|farms?|farm operators?|farm managers?|agricultural enterprises?|agricultural operations?|agriculture)\b/iu.test(requestText);
    const farmEnergySignals =
      /\b(?:electricity|energy consumption|energy usage|power consumption|irrigation pumps?|cold[- ]storage|greenhouses?|processing equipment|equipment performance)\b/iu.test(requestText);
    const farmEnergyDecision =
      /\b(?:crop schedules?|weather conditions?|production demand|energy waste|wasted energy|operating costs?|inefficient equipment|unnecessary energy consumption|farm profitability|adjusted first|prioritiz(?:e|ing)|optimization|efficiency)\w*\b/iu.test(requestText);
    if (farmEnergyActor && farmEnergySignals && farmEnergyDecision && !developerSubject) {
      return this.result(
        'FARM_ENERGY_OPERATIONS',
        0.995,
        ['news', 'crossref', 'gdelt', 'youtube', 'forum'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news', 'blog'],
      );
    }

    const commercialBuildingEnergyActor = /\b(?:commercial buildings?|office buildings?|office complexes?|facility teams?|facility managers?|building operators?|building managers?)\b/iu.test(requestText);
    const commercialBuildingEnergyWorkflow = /\b(?:electricity|energy consumption|utility bills?|utility costs?|smart meters?|submeters?|heating|hvac|elevators?|lighting|office equipment|equipment usage|equipment runtime|consumption spikes?|abnormal usage|energy waste|energy efficiency|technical problems?|equipment downtime|meter readings?)\b/iu.test(requestText);
    if (commercialBuildingEnergyActor && commercialBuildingEnergyWorkflow && !developerSubject) {
      return this.result(
        'COMMERCIAL_BUILDING_ENERGY_OPERATIONS',
        0.99,
        ['reddit', 'gdelt', 'news', 'crossref', 'forum', 'youtube', 'blog'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const manufacturingCostActor =
      /\b(?:manufacturing companies?|manufacturers?|manufacturing plants?|factories|factory|industrial plants?|production lines?|plant managers?|operations managers?|production planners?|manufacturing controllers?|financial controllers?)\b/iu.test(text);
    const manufacturingCostDrivers =
      /\b(?:production costs?|raw material expenses?|raw material costs?|material costs?|machine downtime|downtime costs?|labor costs?|labour costs?|defect rates?|scrap rates?|maintenance spending|maintenance costs?|supplier prices?|supplier costs?|cost per unit|cost variance|cost forecast|cost forecasts|profitability|margin erosion|production stage costs?)\b/iu.test(text);
    const manufacturingCostDecision =
      /\b(?:output remains stable|stable output|analy[sz](?:e|ed|ing)? separately|separate systems?|fragmented|siloed|identify which production stages?|reducing profitability|inaccurate cost forecasts?|delayed decisions?|unnecessary spending|production planning|operational improvements?|cost drivers?|root cause|variance analysis)\w*\b/iu.test(text);
    if (
      manufacturingCostActor &&
      manufacturingCostDrivers &&
      manufacturingCostDecision &&
      !developerSubject
    ) {
      return this.result(
        'MANUFACTURING_COST_PROFITABILITY_OPERATIONS',
        0.995,
        ['crossref', 'news', 'reddit', 'forum', 'blog', 'youtube', 'gdelt'],
        ['app-store', 'google-play', 'product-hunt', 'hacker-news', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const industrialEnergyActor = /\b(?:manufacturing plants?|manufacturers?|factories|factory|industrial plants?|production lines?|plant operators?|plant engineers?|maintenance managers?|production engineers?)\b/iu.test(text);
    const industrialEnergySignal = /\b(?:electricity|electrical consumption|energy consumption|energy usage|power draw|power consumption|electricity costs?|energy costs?|kwh|kilowatt|smart meter|submeter)\w*\b/iu.test(text);
    const industrialEnergyWorkflow = /\b(?:machines?|equipment|equipment sensors?|machine sensors?|operating hours?|maintenance records?|maintenance history|production schedules?|equipment condition|machine condition|condition monitoring|predictive maintenance|telemetry)\b/iu.test(text);
    const industrialEnergyImpact = /\b(?:unusually high|abnormal|anomal(?:y|ies)|energy spike|power spike|losing efficiency|efficiency loss|efficiency decline|degradation|impending failure|breakdowns?|downtime|production interruptions?|unnecessary maintenance|electricity costs?|energy costs?)\b/iu.test(text);
    if (industrialEnergyActor && industrialEnergySignal && industrialEnergyWorkflow && industrialEnergyImpact && !developerSubject) {
      return this.result(
        'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH_OPERATIONS',
        0.99,
        ['crossref', 'forum', 'news', 'gdelt', 'youtube', 'blog', 'reddit'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const renewableAssetActor =
      /\b(?:renewable energy compan(?:y|ies)|renewable energy operators?|renewable asset managers?|solar projects?|wind projects?|solar assets?|wind assets?|solar farms?|wind farms?)\b/iu.test(requestText);
    const renewableAssetSignals =
      /\b(?:energy output|power output|generation output|equipment downtime|downtime|maintenance expenses?|maintenance costs?|electricity prices?|power prices?|financing costs?|weather conditions?|capacity factor|asset performance)\b/iu.test(requestText);
    const renewableAssetFinancialDecision =
      /\b(?:financial returns?|financial performance|profitability|revenue forecasts?|technical inefficien|financial conditions?|underperformance|root cause|prioritiz(?:e|ing) assets?|unnecessary maintenance|investment decisions?)\w*\b/iu.test(requestText);
    if (
      renewableAssetActor &&
      renewableAssetSignals &&
      renewableAssetFinancialDecision &&
      !developerSubject
    ) {
      return this.result(
        'RENEWABLE_ASSET_PERFORMANCE_OPERATIONS',
        0.995,
        ['news', 'gdelt', 'crossref', 'forum', 'blog', 'youtube', 'dev-to'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'hacker-news'],
      );
    }

    const connectedAssetActor = /\b(?:farms?|farm operators?|agriculture|manufacturing|manufacturers?|factories|industrial plants?|warehouses?|utilities|electric utilities?|power utilities?|utility companies?|energy providers?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid|greenhouses?|livestock facilities?|irrigation systems?|remote sites?)\b/iu.test(text);
    const connectedAssetWorkflow = /\b(?:connected (?:devices?|equipment|systems?|meters?)|smart meters?|connected meters?|iot|internet of things|sensors?|telemetry|remote monitoring(?: devices?)?|automated control systems?|distribution automation|irrigation controllers?|automated feeding|device behavior|device failures?|meter failures?|connectivity failures?|network disruption|unauthorized access|access attempts?|security alerts?|equipment failures?|device health|network health|unusual consumption|consumption anomalies?|consumption data integrity|malicious activity|malicious interference|cyberattacks?|cyber attacks?|ransomware|production anomalies?|machine behavior|incident attribution|root cause|incident response)\b/iu.test(text);
    if (connectedAssetActor && connectedAssetWorkflow && !developerSubject) {
      return this.result(
        'CONNECTED_ASSET_SECURITY_OPERATIONS',
        0.98,
        ['reddit', 'gdelt', 'crossref', 'news', 'youtube', 'forum', 'blog'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const agriculturalDistributionProfitabilityActor =
      /\b(?:agricultural distributors?|agriculture distributors?|produce distributors?|fresh produce distributors?|crop distributors?|farm produce distributors?|agricultural wholesalers?|produce wholesalers?)\b/iu.test(requestText);
    const agriculturalDistributionProfitabilityWorkflow =
      /\b(?:storage losses?|storage costs?|warehouse costs?|transportation delays?|transport delays?|delivery delays?|delivery costs?|transportation costs?|market price fluctuations?|market prices?|price volatility|spoilage|harvest records?|warehouse inventory|shipment activity|financial expenses?|crop profitability|product profitability|profit margins?|route profitability|pricing decisions?)\b/iu.test(requestText);
    if (
      agriculturalDistributionProfitabilityActor &&
      agriculturalDistributionProfitabilityWorkflow &&
      !developerSubject
    ) {
      return this.result(
        'AGRICULTURAL_DISTRIBUTION_PROFITABILITY_OPERATIONS',
        0.995,
        ['crossref', 'news', 'reddit', 'forum', 'blog', 'gdelt'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const agriculturalExportProfitabilityActor =
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|export packing houses?|export-oriented farms?|agricultural export(?:ers?| companies?| businesses?))\b/iu.test(requestText);
    const agriculturalExportProfitabilityWorkflow =
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|changing market prices?|market prices?|product spoilage|produce spoilage|shipment profitability|profit margins?|profit estimates?|harvest records?|delivery schedules?|supplier payments?|sales revenues?|financial losses?|route profitability|distribution stages?)\b/iu.test(requestText);
    if (
      agriculturalExportProfitabilityActor &&
      agriculturalExportProfitabilityWorkflow &&
      !developerSubject
    ) {
      return this.result(
        'AGRICULTURAL_EXPORT_PROFITABILITY_OPERATIONS',
        0.995,
        ['news', 'crossref', 'gdelt', 'forum', 'youtube', 'blog'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const eyeglassRepairActor =
      /\b(?:eyeglass frame repair specialists?|eyeglass repair specialists?|eyewear repair specialists?|optical frame repair specialists?|spectacle frame repair specialists?|glasses repair specialists?)\b/iu.test(requestText);
    const eyeglassRepairWorkflow =
      /\b(?:frame damage|previous repairs?|repair history|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|customer fit|adjustment notes?|repeated adjustments?|pickup dates?|promised pickup|delayed pickups?)\b/iu.test(requestText);
    if (eyeglassRepairActor && eyeglassRepairWorkflow && !developerSubject) {
      return this.result(
        'PHYSICAL_LOCAL_SERVICE_OPERATIONS',
        0.995,
        ['forum', 'youtube', 'news', 'blog', 'crossref', 'gdelt'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const agricultureActor = /\b(?:agricultural cooperatives?|farm cooperatives?|farmers? cooperatives?|farms?|farmers?|agriculture|fresh produce|produce growers?|growers?|packing houses?|cold storage)\b/iu.test(text);
    const agricultureWorkflow = /\b(?:harvest(?:ing)?|storage capacity|cold storage|cold chain|temperature|shipments?|transportation|delivery times?|delivery windows?|produce spoilage|spoiled produce|partially empty deliveries|transport costs?|shipment locations?|farm pickup|market delivery|logistics|traceability)\b/iu.test(text);
    if (agricultureActor && agricultureWorkflow && !developerSubject) {
      return this.result(
        'AGRICULTURAL_SUPPLY_CHAIN_OPERATIONS',
        0.97,
        ['reddit', 'news', 'youtube', 'blog', 'forum'],
        ['github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news', 'app-store', 'google-play'],
      );
    }

    const industrialActor = /\b(?:manufacturing|manufacturer|manufacturers|factory|factories|production line|production lines|industrial plant|industrial plants|production planners?)\b/iu.test(text);
    const supplyWorkflow = /\b(?:raw materials?|supplier deliveries?|supplier updates?|supply chain|inventory|warehouse|warehouses|shipments?|production schedules?|demand changes?|demand forecast|bottlenecks?|order prioritization|stockouts?|excess stock)\b/iu.test(text);
    if (industrialActor && supplyWorkflow && !developerSubject) {
      return this.result(
        'INDUSTRIAL_SUPPLY_CHAIN_OPERATIONS',
        0.96,
        ['news', 'youtube', 'reddit', 'blog'],
        ['github', 'stackoverflow', 'dev-to', 'product-hunt', 'google-play', 'app-store', 'hacker-news'],
      );
    }


    const enterprisePolicyActor = /\b(?:human resources?|hr teams?|hr managers?|people operations?|employment policies?|employee handbooks?|employment contracts?|leave rules?|internal procedures?|corporate policies?|workplace policies?|legal teams?|compliance officers?)\b/iu.test(requestText);
    const enterprisePolicyWorkflow = /\b(?:policy consistency|version control|outdated information|outdated policies?|regulatory changes?|regulation changes?|compliance risks?|conflicting rules?|inconsistent decisions?|employee questions?|repeated questions?|document review|policy updates?|contract review|leave rules?|rights or responsibilities|handbooks?|procedures?)\b/iu.test(requestText);
    if (enterprisePolicyActor && enterprisePolicyWorkflow && !developerSubject) {
      return this.result(
        'ENTERPRISE_POLICY_COMPLIANCE_OPERATIONS',
        0.97,
        ['reddit', 'hacker-news', 'news', 'gdelt', 'youtube', 'blog'],
        ['product-hunt', 'google-play', 'app-store', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const tourismTransitSurgeActor =
      /\b(?:tourism operators?|tour operators?|tourism authorities?|city transport services?|public transport services?|municipal transit|city transit|visitors?|tourists?)\b/iu.test(text);
    const tourismTransitSurgeWorkflow =
      /\b(?:festival|festivals|holiday|holidays|large public events?|visitor demand|passenger volumes?|transport capacity|public transport capacity|congestion|overcrowd|waiting times?|vehicle allocation|attraction schedules?|booking activity|visitor surge|passenger surge|demand surge)\w*\b/iu.test(text);
    if (tourismTransitSurgeActor && tourismTransitSurgeWorkflow && !developerSubject) {
      return this.result(
        'TOURISM_DESTINATION_OPERATIONS',
        0.995,
        ['reddit', 'news', 'crossref', 'forum', 'gdelt', 'youtube', 'blog'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const tourismActor = /\b(?:tourism authorities?|tourism boards?|destination management|tourist destinations?|tourism offices?|visitor management|tourism|tourist|visitors?|destinations?|attractions?)\b/iu.test(text);
    const tourismWorkflow = /\b(?:overcrowd|crowding|congestion|seasonal demand|visitor behavior|visitor feedback|visitor complaints?|attraction usage|resource allocation|public transport|local communit|destination pressure|tourism pressure|visitor experience)\w*\b/iu.test(text);
    if (tourismActor && tourismWorkflow && !developerSubject) {
      return this.result(
        'TOURISM_DESTINATION_OPERATIONS',
        0.98,
        ['news', 'gdelt', 'forum', 'youtube', 'blog', 'crossref'],
        ['app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news', 'reddit'],
      );
    }

    const municipalWasteScopeText = requestText || text;
    const municipalWasteObjectIdentity =
      /\b(?:municipal solid waste|solid waste|municipal waste|waste collection|garbage collection|trash collection|refuse collection|sanitation collection|waste bins?|garbage bins?|trash bins?|waste containers?|garbage containers?|refuse containers?|landfill|recycling collection)\b/iu.test(
        municipalWasteScopeText,
      );
    const municipalWasteActor =
      /\b(?:cities|city governments?|municipalities|municipal governments?|city councils?|sanitation departments?|waste management departments?|municipal waste operators?|public works departments?)\b/iu.test(municipalWasteScopeText);
    const municipalWasteWorkflow =
      /\b(?:collection schedules?|pickup schedules?|container capacity|bin capacity|fill levels?|overflowing containers?|overflowing bins?|citizen complaints?|vehicle locations?|collection vehicles?|waste collection routes?|route performance|disposal patterns?|neighborhood population density|population densities|missed pickups?)\b/iu.test(municipalWasteScopeText);
    const municipalWasteImpact =
      /\b(?:overflow|overflowing|unnecessary collection trips?|extra collection trips?|higher operating costs?|route inefficien|inefficient use|resource allocation|earlier pickups?|additional resources?|missed pickups?|collection delay|fuel waste)\w*\b/iu.test(municipalWasteScopeText);
    if (
      municipalWasteObjectIdentity &&
      municipalWasteActor &&
      municipalWasteWorkflow &&
      municipalWasteImpact &&
      !developerSubject
    ) {
      return this.result(
        'MUNICIPAL_WASTE_COLLECTION_OPERATIONS',
        0.99,
        ['reddit', 'gdelt', 'news', 'crossref', 'forum', 'blog', 'youtube'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const musicalManuscriptActor =
      /\b(?:musical score restoration specialists?|music score restoration specialists?|music manuscript conservators?|musical manuscript conservators?|paper conservators?|manuscript conservators?|document conservators?)\b/iu.test(text);
    const musicalManuscriptWorkflow =
      /\b(?:damaged manuscripts?|musical scores?|music manuscripts?|missing pages?|missing leaves?|handwritten annotations?|marginalia|previous repairs?|repair history|paper types?|paper characteristics?|customer instructions?|client instructions?|approved treatment|treatment records?|restoration progress|conservation treatment|condition records?)\b/iu.test(text);
    if (
      musicalManuscriptActor &&
      musicalManuscriptWorkflow &&
      !developerSubject
    ) {
      return this.result(
        'MUSICAL_MANUSCRIPT_RESTORATION_OPERATIONS',
        0.99,
        ['reddit', 'crossref', 'forum', 'news', 'gdelt', 'youtube', 'blog'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const publicActor = /\b(?:government|municipal|municipality|smart cit(?:y|ies)|city network|public sector|local authority|city council|city government|public infrastructure|public housing|housing authority|city planning|urban planning)\b/iu.test(text);
    if (publicActor && !developerSubject) {
      return this.result(
        'PUBLIC_SECTOR_OPERATIONS',
        0.91,
        ['forum', 'gdelt', 'news', 'crossref', 'blog', 'youtube'],
        ['google-play', 'app-store', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news', 'reddit'],
      );
    }

    const academicActor = /\b(?:schools?|universit(?:y|ies)|learning management system|\blms\b|online assessments?|online exams?|academic administrators?|students?)\b/iu.test(requestText);
    const academicWorkflow = /\b(?:records?|assignments?|exams?|assessments?|security alerts?|login records?|academic integrity|account activity|administrators?|student services?|scheduling)\b/iu.test(requestText);
    if (academicActor && academicWorkflow && !developerSubject) {
      return this.result(
        'ACADEMIC_INSTITUTIONAL_OPERATIONS',
        0.92,
        ['news', 'youtube', 'blog', 'reddit'],
        ['google-play', 'app-store', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const hospitalCostEfficiencyActor =
      /\b(?:private hospitals?|hospitals?|hospital systems?|health systems?|medical centers?)\b/iu.test(text);
    const hospitalCostEfficiencyFinancial =
      /\b(?:staffing expenses?|staffing costs?|labor costs?|medical supply usage|supply costs?|patient volumes?|insurance reimbursements?|reimbursement rates?|treatment costs?|service costs?|department costs?|budget(?:s|ing)?|budget variance|unnecessary spending|operating expenses?|financial inefficien|profitability|resource allocation|resource consumption|cost efficiency|cost-efficiency|margin|service line profitability)\w*\b/iu.test(text);
    const hospitalCostEfficiencyDecision =
      /\b(?:analy[sz](?:e|ed|ing)? separately|separate systems?|fragmented|siloed|identify which services|which departments|financially inefficient|cost drivers?|cost variance|resource allocation|budget accuracy|declining profitability|without affecting quality of care|quality of care)\b/iu.test(text);
    if (
      hospitalCostEfficiencyActor &&
      hospitalCostEfficiencyFinancial &&
      hospitalCostEfficiencyDecision &&
      !developerSubject
    ) {
      return this.result(
        'HEALTHCARE_COST_RESOURCE_EFFICIENCY_OPERATIONS',
        0.995,
        ['crossref', 'news', 'reddit', 'forum', 'blog', 'youtube', 'gdelt'],
        ['app-store', 'google-play', 'product-hunt', 'hacker-news', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const healthcareActor = /\b(?:hospital|hospitals|clinic|clinics|healthcare|medical practice|medical practices|pharmacy|pharmacies|care teams?|patients?|biomedical engineering|clinical engineering|operating rooms?|operating areas?|rehabilitation centers?|rehab centers?|rehabilitation clinics?|sports medicine|physiotherapists?|physical therapists?|rehabilitation specialists?|medical teams?|athletes?)\b/iu.test(text);
    const healthcareWorkflow = /\b(?:appointments?|patient records?|medication|coverage|billing|care coordination|staffing|inventory|stock levels?|stockouts?|shortages?|medical supplies?|clinical supplies?|blood products?|blood inventory|pharmacy inventory|expiration|expiry|expired products?|supplier deliveries?|supplier delays?|emergency requests?|reorder(?:ing)?|referrals?|claims?|scheduling|follow[- ]?up|medical equipment|medical devices?|equipment tracking|device tracking|asset tracking|equipment location|device location|maintenance status|maintenance logs?|service status|equipment usage|device usage|utilization|availability|departmental movement|department transfers?|storage rooms?|operating rooms?|operating areas?|injury recovery|injuries|rehabilitation|return to play|return-to-play|training loads?|training workload|pain reports?|pain scores?|mobility measurements?|mobility scores?|performance data|recovery progress|recovery status|reinjury|re-injury)\b/iu.test(text);
    if (healthcareActor && healthcareWorkflow && !developerSubject) {
      return this.result(
        'HEALTHCARE_INSTITUTIONAL_OPERATIONS',
        0.96,
        ['reddit', 'gdelt', 'news', 'crossref', 'youtube', 'blog', 'forum'],
        ['app-store', 'google-play', 'product-hunt', 'hacker-news', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const professionalServiceAgencyActor =
      /\b(?:sign language interpretation agenc(?:y|ies)|sign language interpreting agenc(?:y|ies)|asl interpretation agenc(?:y|ies)|asl interpreting agenc(?:y|ies)|interpretation agenc(?:y|ies)|interpreting agenc(?:y|ies)|language service providers?|interpreter service providers?|interpreter agencies?|translation and interpretation agenc(?:y|ies)|agency dispatchers?|interpreter coordinators?)\b/iu.test(text);
    const professionalServiceAgencyWorkflow =
      /\b(?:interpreter availability|interpreter scheduling|assignment details?|assignment matching|match(?:ing)? interpreters?|client communication preferences?|communication preferences?|specialized vocabulary|subject[- ]matter vocabulary|session notes?|last[- ]minute schedule changes?|schedule changes?|cancellations?|double booking|double-booking|missed assignments?|assignment conflicts?|dispatcher workflow|interpreter records?|client requirements?)\b/iu.test(text);
    if (
      professionalServiceAgencyActor &&
      professionalServiceAgencyWorkflow &&
      !developerSubject
    ) {
      return this.result(
        'PROFESSIONAL_SERVICE_AGENCY_OPERATIONS',
        0.99,
        ['forum', 'reddit', 'news', 'gdelt', 'youtube', 'blog', 'crossref'],
        ['app-store', 'google-play', 'product-hunt', 'hacker-news', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const evidenceRecordsActor = /\b(?:appraisers?|valuers?|valuation professionals?|genealogists?|genealogy researchers?|family historians?|archivists?|researchers?|conservators?|provenance researchers?|auction specialists?|artifact historians?|inspectors?)\b/iu.test(text);
    const evidenceRecordsWorkflow = /\b(?:provenance|chain of custody|ownership history|authenticity|valuations?|restoration details?|historical certificates?|family records?|research notes?|source citations?|evidence trail|supporting evidence|conflicting records?|scattered records?|paper documents?|archives?|auction catalogs?|duplicated research|inconsistent valuations?|missed relationships?|record history|document history)\b/iu.test(text);
    if (evidenceRecordsActor && evidenceRecordsWorkflow && !developerSubject) {
      return this.result(
        'PROFESSIONAL_EVIDENCE_RECORDS_OPERATIONS',
        0.98,
        ['reddit', 'crossref', 'gdelt', 'news', 'forum', 'youtube', 'blog'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const residentialCleaningActor = /\b(?:home[- ]cleaning businesses?|home cleaning businesses?|residential cleaning businesses?|residential cleaning services?|house cleaning businesses?|house cleaning services?|cleaning companies?|cleaning teams?)\b/iu.test(text);
    const residentialCleaningWorkflow = /\b(?:customer preferences?|recurring appointments?|recurring bookings?|room[- ]specific instructions?|room instructions?|employee assignments?|cleaner assignments?|cleaning supplies?|supplies|required supplies?|last[- ]minute schedule changes?|schedule changes?|missed tasks?|scheduling conflicts?|forgotten customer requests?|service quality|phone calls?|messaging apps?|handwritten notes?)\b/iu.test(text);
    if (residentialCleaningActor && residentialCleaningWorkflow && !developerSubject) {
      return this.result(
        'RESIDENTIAL_CLEANING_OPERATIONS',
        0.98,
        ['app-store', 'google-play', 'news', 'gdelt', 'reddit', 'youtube', 'blog'],
        ['product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    if (
      intentProfile.family === 'RESTORATION_CONSERVATION' &&
      !developerSubject
    ) {
      return this.result(
        'RESTORATION_CONSERVATION_OPERATIONS',
        intentProfile.confidence,
        ['forum', 'youtube', 'crossref', 'news', 'gdelt'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const customFootwearActor =
      /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/iu.test(
        text,
      );
    const customFootwearSpecification =
      /\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|approved specifications?|latest approved specifications?|completion deadlines?)\b/iu.test(
        text,
      );
    const customFootwearFailure =
      /\b(?:sizing errors?|incorrect material choices?|wrong materials?|repeated fittings?|wasted materials?|delayed orders?|wrong specification|outdated specification)\b/iu.test(
        text,
      );
    if (
      customFootwearActor &&
      customFootwearSpecification &&
      customFootwearFailure &&
      !developerSubject
    ) {
      return this.result(
        'CUSTOM_COMMISSION_APPROVAL_OPERATIONS',
        0.99,
        ['forum', 'youtube', 'blog', 'news', 'gdelt'],
        ['crossref', 'app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const bookRestorationConservationRequest =
      /\b(?:antique books?|rare books?|historic books?|historical books?|book restoration specialists?|book restorers?|book conservators?|paper conservators?|book conservation workshops?|book restoration workshops?)\b/iu.test(requestText) &&
      /\b(?:damaged bindings?|missing pages?|paper condition|previous repairs?|repair history|original materials?|restoration progress|restoration history|conservation treatment|condition assessment|condition report|customer preservation preferences?|preservation preferences?|replacement materials?)\b/iu.test(requestText);
    if (bookRestorationConservationRequest && !developerSubject) {
      return this.result(
        'PHYSICAL_LOCAL_SERVICE_OPERATIONS',
        0.999,
        ['reddit', 'youtube', 'crossref', 'news', 'gdelt'],
        ['app-store', 'google-play', 'product-hunt', 'forum', 'hacker-news', 'github', 'stackoverflow', 'dev-to'],
      );
    }

    const bespokeBookbindingActor =
      !bookRestorationConservationRequest &&
      /\b(?:independent )?(?:book cover craftsmen?|book cover makers?|bookbinders?|custom bookbinders?|bookbinding craftsmen?|bookbinding artisans?|binderies?|bindery workshops?|bookbinding workshops?|book edge gilding specialists?|book edge gilders?|fore[- ]edge gilding specialists?|book gilding specialists?)\b/iu.test(text);
    const customCommissionActor =
      bespokeBookbindingActor ||
      /\b(?:independent|small|custom|local)?\s*[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,4}\s+(?:studios?|workshops?|shops?|makers?|artisans?|artists?|businesses?|specialists?|craftsmen?)\b/iu.test(text);
    const bookEdgeGildingSpecification =
      bespokeBookbindingActor &&
      /\b(?:book dimensions?|foil selections?|gold[- ]leaf selections?|gold leaf selections?|decorative patterns?|surface preparation notes?|finish specifications?|approved finish|revision details?|revision requests?|customer approval|completion deadlines?)\b/iu.test(text);
    const bookEdgeGildingFailure =
      bespokeBookbindingActor &&
      /\b(?:incorrect materials?|wrong materials?|inconsistent decoration|damaged books?|ruined books?|repeated work|rework|lost details?|missed details?|delayed customer orders?|delayed orders?|wrong version|approval confusion)\b/iu.test(text);
    if (bookEdgeGildingSpecification && bookEdgeGildingFailure && !developerSubject) {
      return this.result(
        'CUSTOM_COMMISSION_APPROVAL_OPERATIONS',
        0.995,
        ['forum', 'youtube', 'blog', 'news', 'gdelt'],
        ['crossref', 'app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const customCommissionSpecification =
      /\b(?:design references?|reference images?|color choices?|colour choices?|color combinations?|item sizes?|dimensions?|measurements?|personalization details?|names?|wording|painting instructions?|placement instructions?|material choices?|materials?|revision requests?|design revisions?|approved design|approved version|final approved|customer approval|completion dates?|pickup dates?|delivery dates?)\b/iu.test(text);
    const customCommissionFailure =
      /\b(?:incorrect colors?|wrong colors?|incorrect dimensions?|wrong dimensions?|mismatched materials?|misspelled names?|spelling mistakes?|wrong placement|incorrect placement|forgotten design changes?|missed design changes?|wasted materials?|wasted supplies?|repeated work|rework|lost details?|missed details?|delayed commissions?|delayed customer orders?|delayed orders?|wrong version|outdated version)\b/iu.test(text);
    if (
      (intentProfile.family === 'CUSTOM_COMMISSION' || intentProfile.family === 'SPECIFICATION_APPROVAL') &&
      customCommissionActor &&
      customCommissionSpecification &&
      customCommissionFailure &&
      !developerSubject
    ) {
      return this.result(
        'CUSTOM_COMMISSION_APPROVAL_OPERATIONS',
        0.99,
        ['forum', 'youtube', 'blog', 'news', 'gdelt'],
        ['crossref', 'app-store', 'google-play', 'github', 'stackoverflow', 'dev-to', 'product-hunt', 'hacker-news'],
      );
    }

    const decorativeFountainRestoration =
      /\b(?:decorative fountains?|ornamental fountains?|historic fountains?|fountain restoration specialists?|fountain restorers?|fountain maintenance contractors?|water features?)\b/iu.test(requestText) &&
      /\b(?:pump condition|fountain pumps?|water[- ]?flow|water flow|stone damage|metal damage|metal corrosion|replacement components?|replacement parts?|finish preferences?|previous repairs?|repair history|customer requests?|restoration history)\b/iu.test(requestText);
    if (decorativeFountainRestoration && !developerSubject) {
      return this.result(
        'PHYSICAL_LOCAL_SERVICE_OPERATIONS',
        0.995,
        ['forum', 'youtube', 'blog', 'news', 'gdelt'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const rentalScopeText = requestText || text;
    const rentalActor =
      /\b(?:rental|rentals|hire)\s+(?:shops?|stores?|businesses?|services?|companies?)\b|\b(?:shops?|stores?|businesses?|services?|companies?)\b[^.!?]{0,70}\b(?:rental|rentals|hire)\b/iu.test(rentalScopeText);
    const rentalInventoryAxes = [
      /\b(?:item|items|inventory|stock|availability|available)\b/iu,
      /\b(?:condition|damage|damaged|inspection|servicing|maintenance history|service history)\b/iu,
      /\b(?:rental periods?|rental dates?|return dates?|expected return|late return|overdue)\b/iu,
      /\b(?:accessories|parts?|kits?|cases?|cables?|attachments?)\b/iu,
      /\b(?:deposit|deposits|charge|charges|fees?|payment)\b/iu,
      /\b(?:booking|bookings|reservation|reservations|double booking|double bookings)\b/iu,
    ].filter((pattern) => pattern.test(rentalScopeText)).length;
    const rentalFailure =
      /\b(?:double bookings?|missing accessories|missing parts?|overlooked damage|unrecorded damage|incorrect charges?|wrong charges?|delayed rentals?|late returns?|unavailable|availability conflict|booking conflict|maintenance overdue|not serviced|requires? servicing)\w*\b/iu.test(rentalScopeText);
    if (rentalActor && rentalInventoryAxes >= 2 && rentalFailure && !developerSubject) {
      return this.result(
        'RENTAL_INVENTORY_OPERATIONS',
        0.995,
        ['forum', 'reddit', 'youtube', 'news', 'crossref', 'gdelt', 'blog'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const explicitProfessionalRepairActor =
      /\b(?:independent\s+)?(?:leather\s+bag\s+repair\s+specialists?|leather\s+repair\s+specialists?|leather\s+restoration\s+specialists?|bag\s+repair\s+specialists?|sneaker(?:\s+and\s+shoe)?\s+cleaning\s+specialists?|shoe\s+cleaning\s+specialists?|sneaker\s+cleaners?|shoe\s+cleaners?|sneaker\s+restoration\s+specialists?|shoe\s+restoration\s+specialists?)\b/iu.test(text);
    const professionalServiceHistoryActor =
      explicitProfessionalRepairActor ||
      (/\b(?:independent|local|specialist|specialists|technician|technicians|restorer|restorers|repairer|repairers|artisan|artisans|studio|studios|workshop|workshops|shop|shops)\b/iu.test(text) &&
        /\b(?:condition|previous repairs?|repair history|cleaning history|service history|styling preferences?|customer preferences?|client preferences?|adjustments?|replacement parts?|follow[- ]up requests?|service requests?)\b/iu.test(text));
    const professionalServiceHistoryRecords =
      /\b(?:handwritten notes?|handwritten tags?|paper tags?|photographs?|photos?|receipts?|customer messages?|client messages?|paper records?|service records?|service history|treatment history|history|records?)\b/iu.test(text);
    const professionalServiceHistoryFailure =
      /\b(?:repeated inspections?|forgotten preferences?|forgotten repair requests?|forgotten requests?|incorrect treatments?|wrong treatments?|unsuitable treatments?|unsuitable cleaning methods?|wrong cleaning methods?|incorrect materials?|wrong materials?|unnecessary repairs?|repeated treatments?|repeated work|duplicated work|duplicate work|inconsistent results?|inconsistent finishes?|lost notes?|lost tags?|misplaced items?|missing history|rework|delayed (?:customer )?pickups?|delayed pickups?|delayed projects?)\b/iu.test(text);
    if (
      professionalServiceHistoryActor &&
      professionalServiceHistoryRecords &&
      professionalServiceHistoryFailure &&
      !developerSubject
    ) {
      return this.result(
        'PHYSICAL_LOCAL_SERVICE_OPERATIONS',
        0.98,
        ['reddit', 'youtube', 'forum', 'blog', 'news', 'gdelt', 'crossref'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    const localServiceActor = /\b(?:cake decorator|cake decorators|cake decorating|custom cake decorator|custom cake decorators|home baker|home bakers|independent baker|independent bakers|cake artist|cake artists|custom cake business|custom cake businesses|bakery decorator|bakery decorators|upholstery workshop|upholstery workshops|upholstery shop|upholstery shops|upholsterer|upholsterers|reupholstery|furniture upholstery|car wash|car washes|locksmith|locksmiths|tailor|tailors|tailoring|alteration shop|alteration shops|alteration specialist|alteration specialists|bridal alteration specialist|bridal alteration specialists|seamstress|seamstresses|bridal seamstress|bridal seamstresses|dressmaker|dressmakers|bridal dressmaker|bridal dressmakers|wedding dress alterations|bridal alterations|repair shop|repair shops|cobbler|cobblers|luthier|florist|florists|flower shop|flower shops|picture framing shop|picture framing shops|custom framing shop|custom framing shops|frame shop|frame shops|framer|framers|tattoo studio|dance studio|pottery studio|photography studio|salon|salons|barber|barbers|cleaning service|cleaning services|field service|mobile service|service business|service businesses|local business|local businesses|restaurant|restaurants|commercial kitchen|small business|small businesses|calligraphy artist|calligraphy artists|calligrapher|calligraphers|lettering artist|lettering artists|custom stationery artist|custom stationery artists|commissioned artist|commissioned artists|independent artist|independent artists|costume rental shop|costume rental shops|costume rental|costume rentals|costume hire|wardrobe rental|wardrobe rentals|theatrical costume|theatre costume|theater costume|formalwear rental|tuxedo rental|dress rental|clothing rental|leather craft workshop|leather craft workshops|leather workshop|leather workshops|leatherworker|leatherworkers|leather artisan|leather artisans|embroidery business|embroidery businesses|embroidery shop|embroidery shops|embroidery workshop|embroidery workshops|embroiderer|embroiderers|custom embroidery|screen printing shop|screen printing shops|print shop|print shops|woodworking shop|woodworking shops|woodworking workshop|woodworking workshops|woodworker|woodworkers|craft workshop|craft workshops|craft studio|craft studios|artisan workshop|artisan workshops|maker studio|maker studios|candle maker|candle makers|soap maker|soap makers|jewelry maker|jewelry makers|jewellery maker|jewellery makers|doll restoration specialist|doll restoration specialists|doll restorer|doll restorers|doll restoration studio|doll restoration studios|doll restoration workshop|doll restoration workshops|antique doll restorer|antique doll restorers|doll repair specialist|doll repair specialists)\b/iu.test(text);
    const genericCraftWorkshopActor =
      /\b(?:independent|small|custom|local)?\s*[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3}\s+(?:craft\s+)?(?:workshops?|shops?|studios?|businesses?|makers?|artisans?)\b/iu.test(text) &&
      /\b(?:custom orders?|commissions?|materials?|design revisions?|approved specifications?|approved versions?|artwork|engraving|stitching|thread colors?|placement instructions?|hardware selections?|fragrance combinations?|wax types?|container sizes?|label designs?|color preferences?|quantities?|delivery deadlines?)\b/iu.test(text);
    const localServiceWorkflow = /\b(?:queues?|customer|customers|service requests?|repair requests?|packages?|preferences?|cake design|cake designs|design references?|flavor|flavors|flavour|flavours|allergy|allergies|dietary requirements?|cake dimensions?|decoration details?|pickup times?|last[- ]minute revisions?|ingredient waste|wasted ingredients?|fabric|fabric samples?|fabric selections?|fabric orders?|material quantities?|material choices?|design changes?|furniture|furniture measurements?|promised completion dates?|completion dates?|employee assignments?|staff assignments?|equipment availability|booking|bookings|appointments?|dispatch|technicians?|parts?|tools?|inventory|paper notes?|paper receipts?|paper forms?|verbal communication|workloads?|waiting times?|pickup|collection|fittings?|measurements?|dimensions?|repair status|supplier|food waste|ingredient shortages?|custom orders?|commissions?|wording|lettering styles?|paper selections?|ink preferences?|reference examples?|revision requests?|design revisions?|approved versions?|approved specifications?|final specifications?|delivery deadlines?|completion deadlines?|client messages?|customer messages?|chat messages?|social media messages?|handwritten notes?|sketches?|material samples?|reserved outfits?|accessories|alteration requests?|return dates?|garment condition|special event requirements?|double reservations?|costume bookings?|costume reservations?|fittings?|size mismatches?|damaged garments?|leather types?|stitching styles?|hardware selections?|engraving details?|thread colors?|placement instructions?|order quantities?|artwork|damage photographs?|damage photos?|replacement parts?|paint matching|restoration notes?|approved restoration|material samples?|physical samples?|incorrect replacements?|mismatched materials?|lost details?)\b/iu.test(text);
    const genericBusinessActor = /\b(?:businesses|shops?|studios?|facilities|service providers?)\b/iu.test(text);
    if ((localServiceActor || genericCraftWorkshopActor || genericBusinessActor) && localServiceWorkflow && !developerSubject) {
      return this.result(
        'PHYSICAL_LOCAL_SERVICE_OPERATIONS',
        0.97,
        ['reddit', 'youtube', 'forum', 'blog', 'news', 'gdelt', 'crossref'],
        ['app-store', 'google-play', 'product-hunt', 'github', 'stackoverflow', 'dev-to', 'hacker-news'],
      );
    }

    if (developerSubject) {
      return this.result(
        'DEVELOPER_TECHNICAL',
        0.95,
        ['github', 'stackoverflow', 'reddit', 'dev-to', 'forum', 'news', 'gdelt'],
        ['google-play', 'app-store', 'product-hunt'],
      );
    }

    const consumerSoftware = /\b(?:mobile app|mobile apps|app users?|application users?|app store|google play|subscription app|website users?|login|sign[- ]?in|account access|user interface|mobile experience)\b/iu.test(text);
    if (consumerSoftware) {
      return this.result(
        'CONSUMER_SOFTWARE',
        0.85,
        ['app-store', 'google-play', 'youtube', 'reddit', 'product-hunt', 'news', 'gdelt'],
        [],
      );
    }

    return this.result(
      'GENERAL_OPERATIONAL',
      0.62,
      ['app-store', 'google-play', 'news', 'gdelt', 'reddit', 'youtube', 'blog'],
      [],
    );
  }

  static sourceFocusFor(archetype: RequestWorkflowArchetype): readonly ('REVIEWS' | 'FORUMS' | 'TECHNICAL' | 'NEWS' | 'PRODUCT_DISCOVERY')[] {
    switch (archetype) {
      case 'CONSUMER_SOFTWARE':
        return ['REVIEWS', 'FORUMS'];
      case 'DEVELOPER_TECHNICAL':
        return ['TECHNICAL', 'FORUMS'];
      case 'RESTAURANT_DELIVERY_FRAUD_OPERATIONS':
      case 'TRANSACTION_ACCOUNT_ABUSE_OPERATIONS':
      case 'DIGITAL_TRUST_SAFETY_OPERATIONS':
        return ['REVIEWS', 'NEWS', 'FORUMS'];
      case 'ENTERPRISE_IDENTITY_ACCESS_SECURITY_OPERATIONS':
      case 'ACADEMIC_PLATFORM_SECURITY_OPERATIONS':
        return ['NEWS', 'FORUMS'];
      case 'URBAN_MOBILITY_OPERATIONS':
      case 'URBAN_ENERGY_DEMAND_OPERATIONS':
      case 'GOVERNMENT_RECORD_SECURITY_OPERATIONS':
      case 'FACILITY_RESOURCE_MONITORING_OPERATIONS':
      case 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS':
      case 'PHYSICAL_LOCAL_SERVICE_OPERATIONS':
      case 'RESTORATION_CONSERVATION_OPERATIONS':
      case 'FOOD_STORAGE_CONDITION_OPERATIONS':
      case 'RENTAL_INVENTORY_OPERATIONS':
      case 'MANUFACTURING_COST_PROFITABILITY_OPERATIONS':
      case 'HEALTHCARE_COST_RESOURCE_EFFICIENCY_OPERATIONS':
      case 'HEALTHCARE_INSTITUTIONAL_OPERATIONS':
        return ['FORUMS', 'NEWS'];
      case 'SUBSCRIPTION_REVENUE_RETENTION_OPERATIONS':
      case 'MEDIA_CONTENT_PROFITABILITY_OPERATIONS':
      case 'TRANSPORTATION_PROFITABILITY_OPERATIONS':
      case 'LOGISTICS_PROFITABILITY_OPERATIONS':
        return ['FORUMS', 'NEWS'];
      case 'ECOMMERCE_PROFITABILITY_OPERATIONS':
      case 'FINANCIAL_TRANSACTION_OPERATIONS':
      case 'RESIDENTIAL_CLEANING_OPERATIONS':
      case 'GENERAL_OPERATIONAL':
        return ['REVIEWS', 'NEWS', 'FORUMS'];
      case 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS':
      case 'RENEWABLE_ASSET_PERFORMANCE_OPERATIONS':
      case 'BUILDING_ENVIRONMENTAL_MONITORING_OPERATIONS':
      case 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH_OPERATIONS':
      case 'INDUSTRIAL_SUPPLY_CHAIN_OPERATIONS':
      case 'AGRICULTURAL_SUPPLY_CHAIN_OPERATIONS':
      case 'AGRICULTURAL_DISTRIBUTION_PROFITABILITY_OPERATIONS':
      case 'AGRICULTURAL_EXPORT_PROFITABILITY_OPERATIONS':
      case 'FARM_ENERGY_OPERATIONS':
      case 'COMMERCIAL_BUILDING_ENERGY_OPERATIONS':
      case 'PROFESSIONAL_EVIDENCE_RECORDS_OPERATIONS':
      case 'PROFESSIONAL_SERVICE_AGENCY_OPERATIONS':
      case 'RESTAURANT_ENERGY_OPERATIONS':
      case 'ACADEMIC_INSTITUTIONAL_OPERATIONS':
      case 'ENTERPRISE_POLICY_COMPLIANCE_OPERATIONS':
      case 'TOURISM_DESTINATION_OPERATIONS':
      case 'PUBLIC_SECTOR_OPERATIONS':
      case 'OPERATIONAL_COST_ATTRIBUTION_OPERATIONS':
        return ['NEWS', 'FORUMS'];
      case 'MUNICIPAL_WASTE_COLLECTION_OPERATIONS':
      case 'MUSICAL_MANUSCRIPT_RESTORATION_OPERATIONS':
        return ['FORUMS', 'NEWS'];
      case 'ACCOUNT_ACCESS_SECURITY_OPERATIONS':
        return ['REVIEWS', 'FORUMS', 'NEWS', 'TECHNICAL'];
      case 'CONNECTED_ASSET_SECURITY_OPERATIONS':
        return ['NEWS', 'FORUMS', 'TECHNICAL'];
    }

    // Defensive runtime fallback for values arriving from stale persisted data
    // or an older/newer service version. Every current union member is handled
    // explicitly above, so normal typed execution does not rely on this branch.
    return ['NEWS', 'FORUMS'];
  }

  private static result(
    archetype: RequestWorkflowArchetype,
    confidence: number,
    preferredSourceKeys: readonly string[],
    blockedSourceKeys: readonly string[],
  ): RequestWorkflowArchetypeResult {
    return { archetype, confidence, preferredSourceKeys, blockedSourceKeys };
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
