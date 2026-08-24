import { RequestDynamicQueryUtil } from './request-dynamic-query.util';
import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';

export type RequestProductBlueprint = {
  readonly baseLabel: string;
  readonly title: string;
  readonly workflowFocus: string;
  readonly targetUsers: readonly string[];
  readonly features: readonly string[];
  readonly objectives: readonly string[];
  readonly databaseEntities: readonly string[];
  readonly metrics: readonly string[];
  readonly workflowTerms: readonly string[];
  readonly painTerms: readonly string[];
};

type EvidenceFeatureCapabilityProfile = {
  readonly key:
    | 'LEARNING_CONTENT'
    | 'REMINDERS_NOTIFICATIONS'
    | 'SEARCH_DISCOVERY'
    | 'INTEGRATION_EXCHANGE'
    | 'DATA_PORTABILITY'
    | 'CUSTOMIZATION_PREFERENCES'
    | 'COLLABORATION_SHARING'
    | 'LOCALIZATION_ACCESSIBILITY'
    | 'OFFLINE_SYNC'
    | 'ANALYTICS_REPORTING'
    | 'SCHEDULING_BOOKING'
    | 'MESSAGING_COMMUNICATION'
    | 'GENERIC_REQUESTED_CAPABILITY';
  readonly label: string;
  readonly titleFragment: string;
  readonly workflowFocus: string;
  readonly metrics: readonly string[];
};

export class RequestProductBlueprintUtil {
  static build(input: {
    readonly requestDescription?: string | null;
    readonly domainName?: string | null;
    readonly opportunityTitle?: string | null;
    readonly evidenceDescription?: string | null;
    readonly problemFamilyKey?: string | null;
    readonly enableEvidenceDerivedFeatureCapability?: boolean;
    readonly enableEvidenceDerivedProblemWorkflow?: boolean;
  }): RequestProductBlueprint | null {
    const requesterDescription = this.normalize(input.requestDescription ?? '');
    const opportunityDescription = this.normalize(input.opportunityTitle ?? '');
    const evidenceDescription = this.normalize(input.evidenceDescription ?? '');
    const description = [requesterDescription, opportunityDescription, evidenceDescription]
      .filter(Boolean)
      .join(' ');
    if (!description) return null;

    const requestSpecificBlueprint = this.resolveRequestSpecificBlueprint(
      requesterDescription,
    );
    if (requestSpecificBlueprint) {
      return requestSpecificBlueprint;
    }

    const actor = requesterDescription
      ? RequestDynamicQueryUtil.extractActor(requesterDescription)
      : '';
    const workflowTerms = this.normalizeWorkflowTerms(
      description,
      RequestDynamicQueryUtil.extractWorkflowTerms(description),
    ).slice(0, 8);
    const painTerms = this.normalizePainTerms(
      description,
      RequestDynamicQueryUtil.extractPainTerms(description),
    ).slice(0, 6);
    const baseLabel = this.resolveBaseLabel(actor, input.domainName ?? '', description);
    const featureCapability = input.enableEvidenceDerivedFeatureCapability
      ? this.resolveEvidenceFeatureCapability(description)
      : null;
    const category = this.resolveCategory(
      description,
      workflowTerms,
      featureCapability,
      Boolean(input.enableEvidenceDerivedProblemWorkflow),
      input.problemFamilyKey ?? null,
      requesterDescription,
    );
    const workflowFocus = this.resolveWorkflowFocus(
      category,
      workflowTerms,
      painTerms,
      featureCapability,
    );
    const title = this.resolveTitle(
      category,
      baseLabel,
      workflowTerms,
      featureCapability,
      opportunityDescription,
      input.problemFamilyKey ?? null,
    );
    const targetUsers = this.resolveTargetUsers(
      category,
      actor,
      baseLabel,
      featureCapability,
      workflowTerms,
    );
    const features = this.resolveFeatures(
      category,
      workflowTerms,
      painTerms,
      featureCapability,
    );
    const objectives = this.resolveObjectives(
      category,
      workflowTerms,
      painTerms,
      featureCapability,
    );
    const databaseEntities = this.resolveDatabaseEntities(
      category,
      workflowTerms,
      featureCapability,
    );
    const metrics = this.resolveMetrics(
      category,
      painTerms,
      featureCapability,
      workflowTerms,
    );

    return {
      baseLabel,
      title,
      workflowFocus,
      targetUsers,
      features,
      objectives,
      databaseEntities,
      metrics,
      workflowTerms,
      painTerms,
    };
  }

  private static resolveRequestSpecificBlueprint(
    requesterDescription: string,
  ): RequestProductBlueprint | null {
    const text = this.normalize(requesterDescription).toLocaleLowerCase();
    const intentProfile = RequestWorkflowIntentProfileUtil.resolve(
      requesterDescription,
    );

    if (intentProfile.family === 'SPECIFICATION_APPROVAL') {
      const actor = RequestDynamicQueryUtil.extractActor(requesterDescription) || 'custom production specialist';
      const baseLabel = this.cleanActorLabel(actor) || 'Specification';
      return {
        baseLabel,
        title: `${baseLabel} Specification & Approval Workspace`.slice(0, 100),
        workflowFocus:
          'customer measurements and dimensions, material and color selections, shape or layout specifications, revision history, final approval state, production readiness, and completion status',
        targetUsers: [
          'Specialists preparing custom physical work from customer specifications',
          'Workshop staff responsible for measurement, material selection, and production preparation',
          'Customer-facing staff coordinating revisions and final approval',
        ],
        features: [
          'Single versioned specification record combining measurements, materials, colors, shapes, customer preferences, and reference attachments',
          'Revision history that preserves what changed, who requested it, and which version is currently active',
          'Explicit final-approval checkpoint before physical production or cutting begins',
          'Production-ready checklist that highlights missing or conflicting specification fields before materials are consumed',
          'Rework, waste, mismatch, and delay tracking linked back to the specification version used for the job',
        ],
        objectives: [
          'Replace scattered measurements, samples, photographs, and messages with one authoritative specification record.',
          'Prevent outdated or incomplete specifications from reaching physical production.',
          'Preserve customer revisions and approval history without assuming every specification workflow is a commission in the same craft domain.',
          'Measure incorrect-production incidents, material waste, revision turnaround, and delayed-order frequency during the pilot.',
        ],
        databaseEntities: [
          'WorkItem', 'SpecificationVersion', 'Measurement', 'MaterialSelection',
          'ColorSelection', 'ShapeSpecification', 'CustomerPreference', 'RevisionRequest',
          'ApprovalDecision', 'ProductionCheckpoint', 'ReworkIncident', 'AuditEvent',
        ],
        metrics: [
          'incorrect production incidents', 'material waste incidents', 'revision turnaround time',
          'approval cycle time', 'rework frequency', 'delayed orders',
        ],
        workflowTerms: [
          'dimensions', 'measurements', 'materials', 'colors', 'opening shapes',
          'customer preferences', 'revision requests', 'final approved specifications',
        ],
        painTerms: ['incorrect cuts', 'mismatched materials', 'wasted supplies', 'repeated work', 'delayed orders'],
      };
    }

    if (intentProfile.family === 'FACILITY_RESOURCE_MONITORING') {
      const actor = RequestDynamicQueryUtil.extractActor(requesterDescription) || 'facility operations';
      const baseLabel = this.cleanActorLabel(actor) || 'Facility';
      const waterFocused = /\bwater\b/u.test(text);
      return {
        baseLabel,
        title: `${baseLabel} ${waterFocused ? 'Water' : 'Resource'} Monitoring & Anomaly Workspace`.slice(0, 100),
        workflowFocus:
          'facility resource meters, zone-level consumption, equipment usage, maintenance history, operating activity, anomaly and leak detection, investigation context, and human-reviewed corrective actions',
        targetUsers: [
          'Facility engineers and utility operations teams',
          'Maintenance supervisors responsible for building equipment and leak response',
          'Sustainability and resource-efficiency managers',
        ],
        features: [
          'Unified meter and facility-zone timeline combining consumption readings, equipment usage, maintenance records, and operating activity',
          'Resource anomaly queue for leaks, abnormal consumption, and inefficient processes with clear evidence provenance',
          'Maintenance correlation view linking equipment condition and work history to unusual consumption events',
          'Human-reviewed investigation workflow for validating anomalies before maintenance or operational action',
          'Consumption, waste, utility-cost, equipment-damage, and environmental-outcome tracking by facility zone',
        ],
        objectives: [
          'Unify fragmented resource-consumption, equipment, maintenance, and facility-activity records into one operational view.',
          'Detect leaks and abnormal resource use earlier without treating generic healthcare, scheduling, or clinical activity as the target workflow.',
          'Connect resource anomalies with maintenance and equipment context before operators choose corrective action.',
          'Measure anomaly-detection time, leak-response time, unresolved exceptions, resource waste, and maintenance follow-through during the pilot.',
        ],
        databaseEntities: [
          'FacilityZone', 'ResourceMeter', 'ConsumptionReading', 'EquipmentAsset',
          'EquipmentUsageEvent', 'MaintenanceRecord', 'FacilityActivityEvent',
          'ResourceAnomaly', 'InvestigationCase', 'CorrectiveAction', 'AuditEvent',
        ],
        metrics: [
          'resource anomalies detected', 'leak-response time', 'abnormal-consumption review time',
          'unresolved anomalies', 'resource waste incidents', 'maintenance follow-through time',
        ],
        workflowTerms: [
          'meter readings', 'resource consumption', 'equipment usage', 'maintenance records',
          'facility activity', 'leak detection', 'abnormal consumption', 'inefficient processes',
        ],
        painTerms: [
          'higher utility costs', 'wasted resources', 'equipment damage', 'environmental impact',
        ],
      };
    }

    if (intentProfile.family === 'TRANSACTION_ACCOUNT_ABUSE') {
      const actor =
        RequestDynamicQueryUtil.extractActor(requesterDescription) ||
        'transportation operations';
      const baseLabel = this.cleanActorLabel(actor) || 'Transportation';
      return {
        baseLabel,
        title: `${baseLabel} Payment & Account Abuse Investigation Workspace`.slice(0, 100),
        workflowFocus:
          'payment and refund events, passenger-account activity, booking behavior, device and session signals, security alerts, coordinated-abuse indicators, false-positive context, and human-reviewed fraud investigation',
        targetUsers: [
          'Transportation fraud and revenue-protection analysts',
          'Ticketing, payment, and account-security operations teams',
          'Customer-support investigators reviewing suspicious refunds and legitimate passenger restrictions',
        ],
        features: [
          'Unified investigation timeline joining payment records, refund requests, passenger-account events, booking activity, device signals, and security alerts',
          'Cross-signal correlation for fraudulent payments, coordinated refund abuse, suspicious bookings, and account takeover indicators',
          'Human-reviewed fraud case queue that preserves evidence provenance and separates stronger coordinated-abuse signals from weak or ambiguous anomalies',
          'False-positive review workflow for legitimate passengers affected by account or payment restrictions',
          'Linked payment, refund, booking, account, device, and investigator-history views for case reconstruction and audit',
        ],
        objectives: [
          'Unify fragmented transportation payment, refund, account, booking, device, and security evidence into one investigation workflow.',
          'Detect coordinated abuse earlier by correlating transaction, account, booking, and device signals without treating one weak signal as proof of fraud.',
          'Reduce unnecessary restrictions by making false-positive evidence and human review explicit.',
          'Measure fraud-case triage time, refund-abuse investigation time, account-compromise resolution, false-positive disposition, and unresolved-case age during the pilot.',
        ],
        databaseEntities: [
          'PassengerAccount', 'BookingEvent', 'PaymentEvent', 'RefundRequest',
          'DeviceSignal', 'SecurityAlert', 'FraudIndicator', 'InvestigationCase',
          'CaseEvidence', 'RestrictionDecision', 'ReviewDecision', 'AuditEvent',
        ],
        metrics: [
          'fraud-case triage time', 'refund-abuse investigation time',
          'account-compromise resolution time', 'suspicious-booking review time',
          'false-positive disposition time', 'unresolved fraud cases',
        ],
        workflowTerms: [
          'fraudulent payments', 'refund requests', 'passenger accounts',
          'suspicious booking behavior', 'device information', 'security alerts',
          'coordinated abuse', 'legitimate passenger restrictions',
        ],
        painTerms: [
          'financial losses', 'fraudulent refunds', 'compromised customer accounts',
          'coordinated abuse detected late', 'unnecessary restrictions',
        ],
      };
    }

    if (intentProfile.family === 'FOOD_STORAGE_CONDITION') {
      const actor =
        RequestDynamicQueryUtil.extractActor(requesterDescription) ||
        'commercial kitchen';
      const baseLabel = this.cleanActorLabel(actor) || 'Commercial Kitchen';
      return {
        baseLabel,
        title: `${baseLabel} Storage Condition & Waste Risk Workspace`.slice(0, 100),
        workflowFocus:
          'refrigerator and freezer condition, storage-room environment, ingredient expiration, food inventory risk, equipment maintenance history, condition exceptions, spoilage incidents, and human-reviewed corrective actions',
        targetUsers: [
          'Kitchen operations managers responsible for food storage and equipment readiness',
          'Head chefs and inventory staff managing ingredient freshness and expiration',
          'Restaurant maintenance staff reviewing refrigeration and freezer condition',
        ],
        features: [
          'Unified storage-condition timeline combining refrigerator and freezer readings, storage-room conditions, ingredient expiration, and equipment maintenance history',
          'Ingredient-at-risk queue linking abnormal storage conditions with affected inventory and expiration windows',
          'Equipment condition and maintenance view that connects refrigeration faults with storage-risk incidents without assuming energy consumption is the primary problem',
          'Human-reviewed alerts for temperature, freezer-performance, expiration, and maintenance exceptions before disposal or service decisions',
          'Spoilage, disposal, equipment-failure, and food-quality outcome tracking tied back to the condition evidence that preceded each incident',
        ],
        objectives: [
          'Unify fragmented food-storage, inventory-expiration, and equipment-maintenance records into one operational view.',
          'Detect storage-condition exceptions early enough for kitchen staff to review ingredients at risk before avoidable spoilage.',
          'Link equipment condition and maintenance history to food-storage incidents without reframing the request as an energy or profitability workflow.',
          'Measure storage excursions, spoilage or disposal incidents, equipment failures, and review-to-action time during the pilot.',
        ],
        databaseEntities: [
          'KitchenStorageZone', 'RefrigerationAsset', 'ConditionReading',
          'IngredientLot', 'ExpirationRecord', 'MaintenanceRecord',
          'StorageRiskCase', 'SpoilageIncident', 'CorrectiveAction', 'AuditEvent',
        ],
        metrics: [
          'storage-condition exceptions', 'ingredients flagged at risk',
          'spoilage and unnecessary disposal incidents', 'equipment failure incidents',
          'risk review time', 'food-quality exceptions',
        ],
        workflowTerms: [
          'refrigerator temperatures', 'freezer performance', 'storage conditions',
          'ingredient expiration dates', 'equipment maintenance records', 'food spoilage',
          'food waste', 'food quality',
        ],
        painTerms: [
          'spoiled food', 'unnecessary disposal', 'equipment failures',
          'higher operating costs', 'inconsistent food quality',
        ],
      };
    }

    if (
      /\b(?:city transport(?:ation)? departments?|municipal transport(?:ation)? departments?|urban transportation agencies?|transit agencies?|public transport(?:ation)? authorities?)\b/u.test(text) &&
      /\b(?:intersections?|bus corridors?|traffic sensors?|vehicle locations?|signal timing|passenger volumes?|road incident reports?|traffic congestion|recurring delays?)\b/u.test(text) &&
      /\b(?:real cause|root cause|recurring delays?|inefficient signal adjustments?|overcrowded routes?|longer travel times?|poor use of transportation resources|separate systems?|siloed|fragmented)\b/u.test(text)
    ) {
      return {
        baseLabel: 'City Corridor Congestion',
        title: 'City Corridor Congestion Root-Cause & Signal Correlation Workspace',
        workflowFocus:
          'intersection and bus-corridor traffic sensors, vehicle locations, signal timing, passenger volumes, road incidents, time-of-day patterns, congestion episodes, root-cause hypotheses, and human-reviewed signal or transit adjustments',
        targetUsers: [
          'City transportation operations managers',
          'Municipal traffic signal engineers',
          'Public transit dispatch and corridor-planning teams',
        ],
        features: [
          'Unified time-aligned corridor timeline combining traffic sensors, vehicle locations, signal timing, passenger volumes, and road incident reports',
          'Recurring congestion pattern detection by intersection, bus corridor, time window, and operating condition',
          'Explainable root-cause correlation that distinguishes signal timing, incident, demand, vehicle-flow, and passenger-load contributors without claiming unverified causality',
          'Human-reviewed signal-adjustment and transit-response workspace with before/after evidence and rollback notes',
          'Corridor comparison dashboard for travel time, overcrowding, delay recurrence, and transportation-resource utilization',
        ],
        objectives: [
          'Unify fragmented municipal transportation signals into one time-aligned diagnostic workflow.',
          'Identify plausible contributors to recurring intersection and bus-corridor congestion with traceable evidence.',
          'Support safer human-reviewed signal and route adjustments instead of automated traffic-control decisions.',
          'Measure congestion recurrence, root-cause review time, corridor travel-time direction, overcrowding, and reviewed adjustment outcomes during the pilot.',
        ],
        databaseEntities: [
          'Intersection', 'TransitCorridor', 'TrafficSensorReading', 'VehicleLocation',
          'SignalTimingSnapshot', 'PassengerVolumeObservation', 'RoadIncident',
          'CongestionEpisode', 'RootCauseHypothesis', 'AdjustmentRecommendation',
          'HumanReview', 'OutcomeMeasurement', 'AuditEvent',
        ],
        metrics: [
          'recurring congestion episodes', 'root-cause review time',
          'corridor travel-time direction', 'overcrowding frequency',
          'signal-adjustment review time', 'transportation-resource utilization',
        ],
        workflowTerms: [
          'intersection congestion', 'bus corridors', 'traffic sensors', 'vehicle locations',
          'signal timing', 'passenger volumes', 'road incident reports', 'recurring delays',
        ],
        painTerms: [
          'inefficient signal adjustments', 'overcrowded routes', 'longer travel times',
          'poor use of transportation resources',
        ],
      };
    }

    if (
      /\b(?:restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|online food ordering services?|meal delivery platforms?|restaurant courier platforms?)\b/u.test(text) &&
      /\b(?:suspicious orders?|account takeovers?|account takeover|refund abuse|fraudulent refunds?|promotional abuse|promo(?:tional)? fraud|promo code abuse|payment behavior|device information|device signals?|customer complaints?|security alerts?|false positives?|blocked legitimate (?:users?|customers?)|coordinated abuse)\b/u.test(text)
    ) {
      return {
        baseLabel: 'Restaurant Delivery Fraud',
        title: 'Restaurant Delivery Fraud Signal Correlation Workspace',
        workflowFocus:
          'order history, payment behavior, account identity and access, device signals, refund history, promotion usage, customer complaints, security alerts, coordinated-abuse patterns, and human-reviewed fraud investigation',
        targetUsers: [
          'Restaurant delivery trust-and-safety and fraud analysts',
          'Payment, account-security, and risk operations teams',
          'Customer-support escalation specialists reviewing false positives and refund disputes',
        ],
        features: [
          'Unified order, payment, account-access, device, refund, promotion, customer-complaint, and security-alert timeline',
          'Cross-signal correlation for suspicious orders, account takeover, refund abuse, and coordinated promotional activity',
          'Explainable risk findings that preserve the underlying evidence and never block a legitimate customer without human review',
          'Linked account, order, device, refund, and promotion histories for coordinated-abuse investigation',
          'Human-reviewed case queue with false-positive disposition, customer-unblock workflow, investigator notes, and audit history',
        ],
        objectives: [
          'Unify fragmented restaurant-delivery fraud signals into one investigation workflow without replacing human judgment.',
          'Detect coordinated abuse earlier by correlating order, payment, account, device, refund, promotion, complaint, and security evidence.',
          'Reduce unnecessary customer disruption by making false-positive evidence and review decisions explicit.',
          'Measure suspicious-order triage time, refund-abuse review, account-takeover resolution, promotional-abuse cases, false-positive disposition, and unresolved investigations during the pilot.',
        ],
        databaseEntities: [
          'CustomerAccount', 'Order', 'PaymentSignal', 'AccountAccessEvent',
          'DeviceSignal', 'RefundEvent', 'PromotionUsageEvent', 'CustomerComplaint',
          'SecurityAlert', 'FraudPattern', 'InvestigationCase', 'ReviewDecision',
          'CustomerRestrictionEvent', 'AuditEvent',
        ],
        metrics: [
          'suspicious-order triage time', 'refund-abuse review time',
          'account-takeover resolution time', 'promotional-abuse case volume',
          'false-positive disposition time', 'unresolved fraud investigations',
        ],
        workflowTerms: [
          'suspicious orders', 'account takeover', 'refund abuse',
          'promotional abuse', 'payment behavior', 'device signals',
          'customer complaints', 'security alerts',
        ],
        painTerms: [
          'financial losses', 'unnecessary refunds', 'blocked legitimate users',
          'coordinated abuse detected late', 'reduced trust',
        ],
      };
    }

    if (
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export(?:ers?| companies?| businesses?))\b/u.test(text) &&
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|changing market prices?|market prices?|product spoilage|produce spoilage|shipment profitability|profit margins?|profit estimates?|harvest records?|delivery schedules?|supplier payments?|sales revenues?|financial losses?|distribution stages?)\b/u.test(text)
    ) {
      return {
        baseLabel: 'Agricultural Export Profitability',
        title: 'Fresh Produce Export Profitability & Logistics Intelligence Workspace',
        workflowFocus:
          'harvest records, shipment and route delays, cold-chain and warehouse costs, spoilage events, supplier payments, market prices, sales revenue, route and product margins, distribution-stage losses, and explainable human-reviewed profitability analysis',
        targetUsers: [
          'Agricultural export operations managers',
          'Fresh-produce logistics and cold-chain coordinators',
          'Export finance, pricing, and profitability analysts',
        ],
        features: [
          'Shipment-level reconciliation of harvest batches, storage and transport costs, supplier payments, market prices, spoilage, and sales revenue',
          'Route, product, and distribution-stage profitability views that preserve the underlying operational and financial evidence',
          'Cold-chain delay and spoilage impact analysis linked to cost and margin outcomes instead of isolated logistics dashboards',
          'Market-price and sales-revenue comparison with explainable margin variance and inaccurate-profit-estimate flags',
          'Human-reviewed loss-driver queue for routes, products, warehouses, and distribution stages with source traceability',
        ],
        objectives: [
          'Unify fragmented agricultural, logistics, and financial records at the shipment level.',
          'Connect transportation delays, storage costs, spoilage, and market-price changes to route and product profitability.',
          'Identify likely profit leaks without automating financial transactions or inventing causal claims not supported by evidence.',
          'Measure profit-estimate reconciliation time, spoilage-cost visibility, route-margin variance, logistics-cost attribution, and reviewed loss drivers during the pilot.',
        ],
        databaseEntities: [
          'Exporter', 'ProduceBatch', 'HarvestRecord', 'Shipment', 'Route',
          'DeliveryEvent', 'ColdChainEvent', 'WarehouseExpense', 'StorageCost',
          'SupplierPayment', 'MarketPrice', 'SpoilageEvent', 'SalesRevenue',
          'ProfitabilitySnapshot', 'LossDriverFinding', 'HumanReview', 'AuditEvent',
        ],
        metrics: [
          'profit-estimate reconciliation time', 'route margin variance',
          'spoilage cost by shipment', 'storage cost by product',
          'transport delay cost impact', 'reviewed financial loss drivers',
        ],
        workflowTerms: [
          'transportation delays', 'storage costs', 'market prices', 'product spoilage',
          'harvest records', 'warehouse expenses', 'supplier payments', 'sales revenues',
        ],
        painTerms: [
          'financial losses', 'unnecessary logistics costs', 'spoiled inventory',
          'poor pricing decisions', 'inaccurate profit estimates',
        ],
      };
    }

    if (
      /\b(?:eyeglass frame repair specialists?|eyeglass repair specialists?|eyewear repair specialists?|optical frame repair specialists?|spectacle frame repair specialists?|glasses repair specialists?)\b/u.test(text) &&
      /\b(?:frame damage|previous repairs?|repair history|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|customer fit|adjustment notes?|repeated adjustments?|pickup dates?|promised pickup|delayed pickups?)\b/u.test(text)
    ) {
      return {
        baseLabel: 'Eyeglass Frame Repair',
        title: 'Eyeglass Frame Repair History, Parts & Fit Workspace',
        workflowFocus:
          'frame-condition intake, prior repair history, hinge and replacement-part specifications, color matching, customer fit preferences, adjustment notes, repair actions, unresolved issues, and promised pickup dates',
        targetUsers: [
          'Independent eyeglass and optical-frame repair specialists',
          'Workshop technicians and repair assistants',
          'Customer-service intake staff coordinating fit preferences and pickups',
        ],
        features: [
          'Searchable frame-condition and repair-history ledger with photographs, receipts, prior work, and technician notes',
          'Replacement hinge and part specification record linked to the exact pair of glasses and previous repairs',
          'Color-matching and customer fit-preference history carried across repeated adjustments',
          'Structured adjustment and repair-action timeline that makes repeated work and unresolved issues visible',
          'Promised-pickup dashboard with outstanding parts, fit checks, and customer preference reminders',
        ],
        objectives: [
          'Maintain one complete repair history for each pair of glasses instead of scattered notes, receipts, photographs, and messages.',
          'Reduce incorrect replacement parts and repeated adjustments by preserving prior parts, fit, and repair context.',
          'Keep customer fit and color preferences visible through every repair and adjustment.',
          'Measure history retrieval time, incorrect-part incidents, repeated adjustments, forgotten preferences, repair consistency, and pickup delays.',
        ],
        databaseEntities: [
          'Customer', 'EyeglassFrame', 'RepairOrder', 'ConditionAssessment',
          'RepairHistoryEntry', 'FramePhotograph', 'ReplacementPart', 'HingeSpecification',
          'ColorMatchRecord', 'FitPreference', 'AdjustmentNote', 'RepairAction',
          'PickupCommitment', 'AuditEvent',
        ],
        metrics: [
          'repair-history retrieval time', 'incorrect replacement-part incidents',
          'repeated adjustment frequency', 'forgotten preference incidents',
          'repair rework frequency', 'pickup delay rate',
        ],
        workflowTerms: [
          'frame damage', 'previous repairs', 'replacement hinges', 'color matching',
          'customer fit preferences', 'adjustment notes', 'repair history', 'promised pickup dates',
        ],
        painTerms: [
          'incorrect replacement parts', 'repeated adjustments', 'forgotten preferences',
          'inconsistent repairs', 'delayed customer pickups',
        ],
      };
    }

    if (
      /\b(?:large farms?|farms?|farm operators?|farm managers?|agricultural enterprises?|agricultural operations?)\b/u.test(text) &&
      /\b(?:electricity|energy consumption|energy usage|irrigation pumps?|cold[- ]storage|greenhouses?|processing equipment|equipment performance)\b/u.test(text) &&
      /\b(?:crop schedules?|weather conditions?|production demand|energy waste|operating costs?|farm profitability|equipment use|energy efficiency)\b/u.test(text)
    ) {
      return {
        baseLabel: 'Farm Energy Operations',
        title: 'Farm Energy Operations & Efficiency Intelligence Workspace',
        workflowFocus:
          'electricity consumption, irrigation-pump operation, cold-storage loads, greenhouse demand, processing-equipment performance, crop schedules, weather conditions, production demand, waste detection, and human-reviewed operational prioritization',
        targetUsers: [
          'Large-farm operations managers and owners',
          'Irrigation, greenhouse, cold-storage, and processing supervisors',
          'Agricultural energy and sustainability analysts',
        ],
        features: [
          'Unified farm energy view combining electricity usage with irrigation, cold-storage, greenhouse, and processing-equipment activity',
          'Schedule-aware energy analysis linking crop plans, production demand, and weather conditions to equipment consumption',
          'Explainable waste and abnormal-consumption detection with asset-level evidence instead of autonomous machinery control',
          'Human-reviewed operational priority queue for pump timing, cooling cycles, greenhouse loads, and processing equipment',
          'Cost and efficiency trend tracking that treats profitability as an outcome of operational energy decisions',
        ],
        objectives: [
          'Unify fragmented energy, equipment, crop-schedule, weather, and production-demand data into one farm operations workflow.',
          'Identify likely energy waste and inefficient equipment use with explainable cross-signal analysis.',
          'Help operators prioritize which farm assets or schedules need attention without automatically controlling physical machinery.',
          'Measure energy-waste incidents, response time, equipment utilization, operating-cost trends, and recommendation outcomes during the pilot.',
        ],
        databaseEntities: [
          'Farm', 'FarmZone', 'EquipmentAsset', 'EnergyReading', 'IrrigationSchedule',
          'ColdStorageLoad', 'GreenhouseDemand', 'ProcessingRun', 'CropSchedule',
          'WeatherObservation', 'ProductionDemand', 'EfficiencyFinding',
          'OperationalRecommendation', 'HumanReview', 'AuditEvent',
        ],
        metrics: [
          'energy consumption by operation', 'energy-waste incident frequency',
          'equipment utilization', 'recommendation review time',
          'operating-cost trend', 'energy intensity per production unit',
        ],
        workflowTerms: [
          'electricity usage', 'irrigation pumps', 'cold storage', 'greenhouses',
          'processing equipment', 'crop schedules', 'weather conditions', 'production demand',
        ],
        painTerms: [
          'energy waste', 'higher operating costs', 'inefficient equipment use',
          'unnecessary energy consumption', 'reduced farm profitability',
        ],
      };
    }

    if (
      /\b(?:violin case restoration specialists?|violin case restorers?|instrument case restoration specialists?|instrument case restorers?)\b/u.test(text) &&
      /\b(?:damaged hinges?|interior padding|fabric condition|handle repairs?|replacement hardware|previous restoration|restoration history|customer preferences?|repeated repairs?|overlooked damage)\b/u.test(text)
    ) {
      return {
        baseLabel: 'Violin Case Restoration',
        title: 'Violin Case Condition, Restoration History & Materials Workspace',
        workflowFocus:
          'case intake condition, damaged hinges, interior padding, fabric condition, handle repairs, replacement hardware, prior restoration work, material choices, customer preferences, repair actions, and completion history',
        targetUsers: [
          'Independent violin and instrument case restoration specialists',
          'Workshop assistants documenting condition and repair work',
          'Instrument owners reviewing restoration preferences and progress',
        ],
        features: [
          'Structured case-condition record with photographs for hinges, handles, padding, fabric, hardware, and overlooked damage',
          'Chronological restoration-history ledger linking previous work, repeated repairs, materials, parts, and technician notes',
          'Replacement-hardware and material record for matching parts, padding, fabrics, and finishes to the correct case',
          'Customer-preference history and optional approvals attached to the restoration record rather than replacing repair-history tracking',
          'Completion and unresolved-damage checkpoints with before-and-after evidence',
        ],
        objectives: [
          'Maintain one traceable restoration history from intake condition through materials, hardware, repair actions, and completion.',
          'Reduce repeated repairs and incorrect materials by preserving prior restoration work and component history.',
          'Make overlooked damage and unresolved work visible through structured condition checkpoints.',
          'Measure history retrieval time, repeated-repair frequency, material errors, unresolved damage, finish rework, and completion lead time.',
        ],
        databaseEntities: [
          'InstrumentCase', 'ConditionAssessment', 'CasePhotograph', 'HingeFinding',
          'PaddingRecord', 'FabricCondition', 'HandleRepair', 'HardwarePart',
          'MaterialRecord', 'RestorationHistoryEntry', 'RepairAction',
          'CustomerPreference', 'CompletionCheckpoint', 'AuditEvent',
        ],
        metrics: [
          'restoration-history retrieval time', 'repeated-repair frequency',
          'incorrect-material incidents', 'overlooked-damage findings',
          'finish rework frequency', 'restoration completion lead time',
        ],
        workflowTerms: [
          'damaged hinges', 'interior padding', 'fabric condition', 'handle repairs',
          'replacement hardware', 'previous restoration work', 'customer preferences', 'restoration history',
        ],
        painTerms: [
          'incorrect materials', 'overlooked damage', 'repeated repairs',
          'inconsistent finishes', 'delayed completion',
        ],
      };
    }

    if (
      /\b(?:public grant programs?|government grant programs?|public funding programs?|grant-making agencies?|grantmaking agencies?|public agencies?)\b/u.test(text) &&
      /\b(?:grant applications?|funding applications?|eligibility checks?|previous funding|funding history|project outcomes?|financial records?|duplicate(?:d)? requests?|duplicate funding|unrealistic budgets?|underperformance risk|funding allocation|program impact)\b/u.test(text)
    ) {
      return {
        baseLabel: 'Public Grant Programs',
        title: 'Public Grant Evaluation & Funding Allocation Workspace',
        workflowFocus:
          'grant application intake, eligibility verification, previous-funding history, budget reasonableness, duplicate-request detection, project-outcome risk review, human funding decisions, and funded-program impact follow-up',
        targetUsers: [
          'Government grant program administrators and program officers',
          'Public finance and budget compliance analysts',
          'Grant review committee members, auditors, and impact-evaluation staff',
        ],
        features: [
          'Unified grant application review record combining application details, eligibility checks, previous funding, project outcomes, financial records, and reviewer decisions',
          'Duplicate-request and overlapping-funding detection with explainable match evidence for human verification',
          'Budget reasonableness and underperformance-risk review that highlights anomalies without automating the final funding decision',
          'Structured scoring, reviewer notes, conflict handling, and auditable approval or rejection decisions',
          'Funded-program outcome and impact follow-up linking award decisions to later delivery and financial results',
        ],
        objectives: [
          'Centralize fragmented grant application, eligibility, financial, prior-funding, and project-outcome records into one review workflow.',
          'Surface duplicated requests, unrealistic budget patterns, and historical underperformance risks as explainable reviewer signals.',
          'Preserve fair human decision-making through structured criteria, role-based review, decision rationale, and immutable audit history.',
          'Measure approval turnaround, duplicate-request detection, review consistency, unresolved exceptions, and funded-program outcome visibility during the pilot.',
        ],
        databaseEntities: [
          'GrantProgram',
          'GrantApplication',
          'Applicant',
          'EligibilityCheck',
          'FundingHistory',
          'BudgetLineItem',
          'ProjectOutcome',
          'DuplicateRequestMatch',
          'RiskAssessment',
          'ReviewScore',
          'FundingDecision',
          'ImpactFollowUp',
          'AuditEvent',
        ],
        metrics: [
          'application review lead time',
          'duplicate-request detection and disposition',
          'budget anomaly review time',
          'reviewer decision consistency',
          'unresolved eligibility or financial exceptions',
          'funded-program outcome and impact follow-up completeness',
        ],
        workflowTerms: [
          'grant applications',
          'eligibility checks',
          'previous funding',
          'project outcomes',
          'financial records',
          'duplicate requests',
          'budget review',
          'funding allocation',
        ],
        painTerms: [
          'inefficient allocation',
          'delayed approvals',
          'inconsistent decisions',
          'unrealistic budgets',
          'underperformance risk',
          'limited impact visibility',
        ],
      };
    }

    if (
      /\b(?:typewriter restoration specialists?|typewriter restorers?|typewriter repair specialists?|typewriter repairers?|typewriter restoration workshops?|typewriter repair shops?)\b/u.test(text) &&
      /\b(?:mechanical condition|missing keys?|ribbon mechanism|damaged components?|previous repairs?|repair history|cosmetic details?|replacement parts?|spare[- ]part records?|customer restoration preferences?|repeated diagnostics?|overlooked defects?)\b/u.test(text)
    ) {
      return {
        baseLabel: 'Typewriter Restoration',
        title: 'Typewriter Condition, Repair History & Parts Workspace',
        workflowFocus:
          'machine intake condition, missing keys, ribbon mechanisms, damaged components, previous repairs, compatible replacement parts, cosmetic details, customer restoration preferences, diagnostic findings, and completion history',
        targetUsers: [
          'Independent typewriter restoration and repair specialists',
          'Workshop technicians and assistants documenting diagnostics and parts',
          'Restoration clients reviewing proposed work and preferences',
        ],
        features: [
          'Machine intake and condition profile with photographs, serial details, missing keys, ribbon-mechanism state, component damage, and cosmetic notes',
          'Chronological repair-history ledger linking previous repairs, diagnostics, replaced components, and technician notes to each machine',
          'Replacement-part compatibility and spare-part record linking to reduce incorrect part selection',
          'Customer restoration preference and approval history for cosmetic and mechanical treatment choices',
          'Defect, diagnostic, and completion tracking with before-and-after evidence and unresolved issue status',
        ],
        objectives: [
          'Create one complete machine history from intake condition through diagnostics, parts, repair work, customer preferences, and completion.',
          'Reduce repeated diagnostics and incorrect replacement-part selection by preserving prior findings and component history.',
          'Make overlooked defects and unresolved restoration work visible through structured condition and repair checkpoints.',
          'Measure record retrieval time, diagnostic repetition, incorrect-part incidents, unresolved defects, rework, and project completion lead time during the pilot.',
        ],
        databaseEntities: [
          'TypewriterMachine',
          'ConditionAssessment',
          'MachinePhotograph',
          'ComponentFinding',
          'RibbonMechanismRecord',
          'RepairHistoryEntry',
          'ReplacementPart',
          'PartCompatibilityRecord',
          'CustomerRestorationPreference',
          'DiagnosticFinding',
          'RepairAction',
          'CompletionCheckpoint',
          'AuditEvent',
        ],
        metrics: [
          'machine-history retrieval time',
          'repeated diagnostic frequency',
          'incorrect replacement-part incidents',
          'overlooked defect findings',
          'rework frequency',
          'restoration completion lead time',
        ],
        workflowTerms: [
          'mechanical condition',
          'missing keys',
          'ribbon mechanism',
          'damaged components',
          'previous repairs',
          'replacement parts',
          'customer preferences',
          'repair history',
        ],
        painTerms: [
          'incorrect replacement parts',
          'repeated diagnostics',
          'overlooked defects',
          'inconsistent restoration results',
          'delayed projects',
        ],
      };
    }

    if (intentProfile.family === 'RESTORATION_CONSERVATION') {
      const actor =
        RequestDynamicQueryUtil.extractActor(requesterDescription) ||
        'restoration specialists';
      const baseLabel = this.cleanActorLabel(actor) || 'Restoration';
      const subject = intentProfile.restorationSubject
        ? this.toTitleCase(intentProfile.restorationSubject)
        : baseLabel;
      return {
        baseLabel,
        title: `${subject} Restoration Condition & History Workspace`.slice(0, 100),
        workflowFocus:
          'item condition, damaged or missing sections, original design and material references, previous repairs, replacement-material decisions, customer restoration preferences, treatment history, and project completion status',
        targetUsers: [
          `${baseLabel} specialists`,
          'Workshop restoration and conservation leads',
          'Clients or preservation stakeholders reviewing treatment choices',
        ],
        features: [
          'Structured condition record linking photographs and notes to damaged, cracked, missing, or altered sections of each item',
          'Original-detail reference ledger for colors, patterns, materials, decorative features, and other historically important characteristics',
          'Chronological restoration history connecting previous repairs, treatment notes, replacement materials, physical samples, and current condition findings',
          'Material-match and treatment decision record that preserves the evidence behind replacement choices instead of treating the job as a new custom commission',
          'Customer restoration-preference and approval notes attached to the existing artifact and its treatment history',
        ],
        objectives: [
          'Create one accurate restoration history for each existing item from intake through completion.',
          'Reduce incorrect material or color matching by keeping original-detail references, physical samples, and prior repair history together.',
          'Preserve original design information while supporting human restoration decisions and customer preferences.',
          'Measure repeated work, material waste, documentation retrieval time, and restoration delay during the pilot.',
        ],
        databaseEntities: [
          'RestorationItem', 'ConditionAssessment', 'DamageLocation',
          'OriginalDetailReference', 'PreviousRepair', 'MaterialReference',
          'PhysicalSample', 'TreatmentRecord', 'CustomerPreference',
          'RestorationMilestone', 'Attachment', 'AuditEvent',
        ],
        metrics: [
          'documentation retrieval time', 'material matching corrections',
          'repeated work incidents', 'material waste incidents',
          'lost-detail exceptions', 'restoration delay',
        ],
        workflowTerms: [
          'condition documentation', 'damaged sections', 'original design details',
          'previous repairs', 'replacement materials', 'physical samples',
          'customer restoration preferences', 'restoration history',
        ],
        painTerms: [
          'incorrect material matching', 'loss of original design details',
          'repeated work', 'wasted materials', 'delayed restoration projects',
        ],
      };
    }

    return null;
  }

  private static normalizeWorkflowTerms(
    description: string,
    values: readonly string[],
  ): string[] {
    const normalizedDescription = this.normalize(description).toLocaleLowerCase();
    const preferred: string[] = [];
    const commonCandidates: readonly [RegExp, string][] = [
      [/\bdesign references?\b/u, 'design references'],
      [/\btile materials?\b/u, 'tile materials'],
      [/\bcolor combinations?\b|\bcolour combinations?\b/u, 'color combinations'],
      [/\bdimensions?\b/u, 'dimensions'],
      [/\binstallation requirements?\b/u, 'installation requirements'],
      [/\brevision requests?\b/u, 'revision requests'],
      [/\bcompletion deadlines?\b/u, 'completion deadlines'],
      [/\blatest approved version\b|\bfinal approved version\b|\bcustomer finally approved\b/u, 'final approved version'],
      [/\bappointment volumes?\b/u, 'appointment volumes'],
      [/\bemergency visits?\b/u, 'emergency visits'],
      [/\bregional health reports?\b/u, 'regional health reports'],
      [/\bresource availability\b/u, 'resource availability'],
      [/\bresource distribution\b/u, 'resource distribution'],
      [/\bdisposal records?\b/u, 'disposal records'],
      [/\bsupply usage\b/u, 'supply usage'],
      [/\bexpiration dates?\b|\bexpiry dates?\b/u, 'expiration dates'],
      [/\btreatment volumes?\b/u, 'treatment volumes'],
      [/\benvironmental reports?\b/u, 'environmental reports'],
      [/\bdisposal costs?\b/u, 'disposal costs'],
      [/\bexpired supplies?\b/u, 'expired supplies'],
      [/\benvironmental footprint\b/u, 'environmental footprint'],
      [/\bcommunity healthcare needs?\b|\bcommunity health needs?\b/u, 'community healthcare demand'],
      [/\bwaiting times?\b/u, 'waiting times'],
      [/\bstaff shortages?\b/u, 'staff shortages'],
      [/\bconnected meters?\b|\bsmart meters?\b/u, 'smart meters'],
      [/\bremote monitoring devices?\b/u, 'remote monitoring devices'],
      [/\bautomated control systems?\b/u, 'automated control systems'],
      [/\bdevice failures?\b|\bmeter failures?\b/u, 'device failures'],
      [/\bunusual consumption(?: patterns?)?\b|\bconsumption anomalies?\b/u, 'consumption anomalies'],
      [/\bnetwork disruptions?\b|\bconnectivity failures?\b/u, 'network disruptions'],
      [/\bunauthorized access(?: attempts?)?\b/u, 'unauthorized access attempts'],
      [/\bmalicious interference\b/u, 'malicious interference'],
      [/\bconsumption data\b/u, 'consumption data integrity'],
      [/\btraffic flow\b/u, 'traffic flow'],
      [/\btraffic congestion\b/u, 'traffic congestion'],
      [/\bpublic transit demand\b|\btransit demand\b/u, 'public transit demand'],
      [/\broad incidents?\b/u, 'road incidents'],
      [/\btravel times?\b|\btravel time reliability\b/u, 'travel time reliability'],
      [/\benvironmental measurements?\b/u, 'environmental measurements'],
      [/\bnoise sensors?\b|\bsound sensors?\b/u, 'noise sensors'],
      [/\bnoise pollution\b|\benvironmental noise\b|\burban noise\b/u, 'noise pollution'],
      [/\bnoise levels?\b|\bsound levels?\b|\bdecibels?\b/u, 'sound level readings'],
      [/\btraffic activity\b/u, 'traffic activity'],
      [/\bcitizen complaints?\b/u, 'citizen complaints'],
      [/\bconstruction schedules?\b/u, 'construction schedules'],
      [/\blocation data\b/u, 'location data'],
      [/\bvehicle emissions?\b/u, 'vehicle emissions'],
      [/\bdesign references?\b/u, 'design references'],
      [/\bcolor choices?\b|\bcolour choices?\b/u, 'color choices'],
      [/\bitem sizes?\b/u, 'item sizes'],
      [/\bpersonalization details?\b/u, 'personalization details'],
      [/\bpainting instructions?\b/u, 'painting instructions'],
      [/\bpickup dates?\b/u, 'pickup dates'],
      [/\bapproved design\b|\bfinal approved design\b/u, 'final approved design'],
      [/\bdamage photographs?\b|\bdamage photos?\b/u, 'damage photographs'],
      [/\bfabric selections?\b/u, 'fabric selections'],
      [/\breplacement parts?\b/u, 'replacement parts'],
      [/\bpaint matching\b/u, 'paint matching'],
      [/\brestoration notes?\b/u, 'restoration notes'],
      [/\bapproved restoration(?: work)?\b/u, 'approved restoration work'],
      [/\bmaterial samples?\b|\bphysical material samples?\b/u, 'material samples'],
      [/\bfoot measurements?\b/u, 'foot measurements'],
      [/\bleather selections?\b/u, 'leather selections'],
      [/\bsole types?\b/u, 'sole types'],
      [/\bstitching preferences?\b/u, 'stitching preferences'],
      [/\bfitting notes?\b/u, 'fitting notes'],
      [/\bdesign revisions?\b/u, 'design revisions'],
      [/\bapproved specifications?\b|\blatest approved specifications?\b|\bfinal approved specifications?\b/u, 'final approved specifications'],
      [/\bdress measurements?\b|\bcustomer measurements?\b/u, 'dress measurements'],
      [/\brequested modifications?\b|\balteration requests?\b/u, 'requested alterations'],
      [/\bfabric details?\b|\bfabric samples?\b/u, 'fabric details'],
      [/\baccessory requirements?\b/u, 'accessory requirements'],
      [/\bcustomer approvals?\b|\bapproved alterations?\b/u, 'customer approvals'],
      [/\bfinal pickup deadlines?\b|\bpickup deadlines?\b/u, 'pickup deadlines'],
      [/\bsubscription activity\b|\bsubscription revenue\b/u, 'subscription revenue'],
      [/\badvertising income\b|\badvertising revenue\b|\bad revenue\b/u, 'advertising revenue'],
      [/\bproduction costs?\b|\bcontent costs?\b/u, 'production costs'],
      [/\bviewing behavior\b|\bviewer behavior\b|\bwatch time\b/u, 'viewing behavior'],
      [/\bcancellations?\b|\bsubscriber churn\b/u, 'subscriber churn'],
      [/\bpromotional campaigns?\b|\bcampaign roi\b/u, 'promotional campaigns'],
      [/\bfinancial return\b|\bcontent roi\b|\bcontent profitability\b/u, 'content financial return'],
      [/\bshows?\b|\bcreators?\b|\bcontent categories?\b/u, 'content performance'],
      [/\binterpreter availability\b/u, 'interpreter availability'],
      [/\bclient communication preferences?\b/u, 'client communication preferences'],
      [/\bassignment details?\b/u, 'assignment details'],
      [/\bspecialized vocabulary requirements?\b|\bspecialized vocabulary\b/u, 'specialized vocabulary'],
      [/\bsession notes?\b/u, 'session notes'],
      [/\blast[- ]minute schedule changes?\b|\bschedule changes?\b/u, 'schedule changes'],
      [/\bscheduling conflicts?\b/u, 'scheduling conflicts'],
    ];
    for (const [pattern, label] of commonCandidates) {
      if (pattern.test(normalizedDescription)) preferred.push(label);
    }

    const serviceHistoryCandidates: readonly [RegExp, string][] = [
      [/\bcustomer items?\b/u, 'customer items'],
      [/\bmechanical faults?\b/u, 'mechanical faults'],
      [/\breplacement parts?\b/u, 'replacement parts'],
      [/\bprevious repairs?\b|\brepair history\b/u, 'previous repairs'],
      [/\brestoration instructions?\b/u, 'restoration instructions'],
      [/\bcost approvals?\b/u, 'cost approvals'],
      [/\bpromised completion dates?\b|\bcompletion dates?\b/u, 'promised completion dates'],
      [/\bservice history\b/u, 'service history'],
    ];
    for (const [pattern, label] of serviceHistoryCandidates) {
      if (pattern.test(normalizedDescription)) preferred.push(label);
    }

    if (
      /\b(?:violin bow technicians?|bow technicians?|bow makers?|archetiers?|bow repairers?|bow rehair(?:ing)? specialists?)\b/u.test(
        normalizedDescription,
      )
    ) {
      preferred.unshift('violin bow service');
      const bowCandidates: readonly [RegExp, string][] = [
        [/\bbow(?:’s|'s)? condition\b|\bbow condition\b/u, 'bow condition'],
        [/\bprevious rehairing dates?\b|\brehairing dates?\b|\blast rehair(?:ing)? date\b/u, 'rehairing dates'],
        [/\bhair type preferences?\b|\bhair types?\b/u, 'hair type preferences'],
        [/\bgrip(?: details?| preferences?)?\b/u, 'grip details'],
        [/\bwinding(?: details?| preferences?)?\b/u, 'winding details'],
        [/\brepair notes?\b/u, 'repair notes'],
        [/\bcustomer requests?\b|\bcustomer preferences?\b/u, 'customer preferences'],
        [/\bservice history\b/u, 'service history'],
      ];
      for (const [pattern, label] of bowCandidates) {
        if (pattern.test(normalizedDescription)) preferred.push(label);
      }
    }

    if (
      /\b(?:fountain pen repair specialists?|pen repair specialists?|fountain pen technicians?|nib technicians?|nibmeisters?)\b/u.test(
        normalizedDescription,
      )
    ) {
      preferred.unshift('fountain pen service');
      const penCandidates: readonly [RegExp, string][] = [
        [/\bpen(?:’s|'s)? condition\b|\bpen condition\b/u, 'pen condition'],
        [/\bnib adjustments?\b|\bnib tuning\b|\bnib grinds?\b/u, 'nib adjustments'],
        [/\bink[- ]?flow problems?\b|\bink flow\b/u, 'ink-flow diagnostics'],
        [/\breplacement parts?\b/u, 'replacement parts'],
        [/\bprevious repairs?\b|\brepair history\b/u, 'previous repairs'],
        [/\bcustomer writing preferences?\b|\bwriting preferences?\b/u, 'writing preferences'],
        [/\brestoration requests?\b/u, 'restoration requests'],
        [/\bservice history\b/u, 'service history'],
      ];
      for (const [pattern, label] of penCandidates) {
        if (pattern.test(normalizedDescription)) preferred.push(label);
      }
    }

    const supportCandidates: readonly [RegExp, string][] = [
      [/\bsupport(?: contact| contacts| request| requests| ticket| tickets)?\b|\bcustomer support\b/u, 'support contacts'],
      [/\bemails?\b|\bemail attempts?\b/u, 'email contact attempts'],
      [/\bbot responses?\b|\bautomated responses?\b|\bchatbot responses?\b/u, 'bot responses'],
      [/\blive chat\b/u, 'live chat availability'],
      [/\bphone support\b|\bphone number\b|\bnumber to (?:call|talk to)\b/u, 'phone support availability'],
      [/\bhuman agents?\b|\bhuman support\b|\breal person\b/u, 'human-agent handoff'],
      [/\bescalation(?: status| path| paths)?\b/u, 'escalation status'],
      [/\bresolution status\b|\bcase status\b/u, 'resolution status'],
    ];
    for (const [pattern, label] of supportCandidates) {
      if (pattern.test(normalizedDescription)) preferred.push(label);
    }

    const retailProfitabilityCandidates: readonly [RegExp, string][] = [
      [/\bproduct discounts?\b/u, 'product discounts'],
      [/\badvertising costs?\b|\bad spend\b/u, 'advertising spend'],
      [/\breturns?\b|\brefunds?\b/u, 'returns and refunds'],
      [/\bpayment fees?\b|\bgateway fees?\b/u, 'payment fees'],
      [/\bshipping expenses?\b|\bshipping costs?\b|\bfulfillment costs?\b/u, 'shipping and fulfillment costs'],
      [/\bcustomer purchasing behavior\b|\bcustomer cohorts?\b/u, 'customer purchasing behavior'],
      [/\bprofit margins?\b|\bcontribution margin\b/u, 'profit margins'],
      [/\bcampaign profitability\b|\bprofitable campaigns?\b/u, 'campaign profitability'],
    ];
    for (const [pattern, label] of retailProfitabilityCandidates) {
      if (pattern.test(normalizedDescription)) preferred.push(label);
    }

    if (
      /\b(?:tourism businesses?|tour operators?|travel businesses?|travel agencies?|destination operators?|hospitality businesses?)\b/u.test(
        normalizedDescription,
      )
    ) {
      preferred.unshift('tourism profitability');
      const tourismCandidates: readonly [RegExp, string][] = [
        [/\bseasonal demand\b/u, 'seasonal demand'],
        [/\bchanging travel behavior\b|\btravel behavior\b/u, 'travel behavior'],
        [/\bbooking records?\b/u, 'booking records'],
        [/\bcustomer spending\b/u, 'customer spending'],
        [/\bpromotional campaigns?\b/u, 'promotional campaigns'],
        [/\bdiscounts?\b/u, 'discounts'],
        [/\bcancellations?\b/u, 'cancellations'],
        [/\brefund activity\b|\brefunds?\b/u, 'refund activity'],
        [/\boperating expenses?\b|\boperating costs?\b/u, 'operating expenses'],
        [/\bfinancial reports?\b/u, 'financial reports'],
        [/\bprofitability\b|\breal profit\b/u, 'service profitability'],
        [/\brevenue forecasts?\b/u, 'revenue forecasting'],
      ];
      for (const [pattern, label] of tourismCandidates) {
        if (pattern.test(normalizedDescription)) preferred.push(label);
      }
    }

    if (
      /\b(?:hat makers?|milliners?|millinery|custom hats?|bespoke hats?|custom headwear|hat studios?|hat workshops?)\b/u.test(
        normalizedDescription,
      )
    ) {
      preferred.unshift('custom hat');
      if (/\bhead measurements?\b/u.test(normalizedDescription)) {
        preferred.push('head measurements');
      }
      if (/\bbrim dimensions?\b/u.test(normalizedDescription)) {
        preferred.push('brim dimensions');
      }
      if (/\bdecorative details?\b/u.test(normalizedDescription)) {
        preferred.push('decorative details');
      }
      if (/\bfitting notes?\b/u.test(normalizedDescription)) {
        preferred.push('fitting notes');
      }
    }

    if (
      /\b(?:clock repair specialists?|clock repairers?|clockmakers?|horologists?|horology|antique clock repair|timepiece repair)\b/u.test(
        normalizedDescription,
      )
    ) {
      preferred.unshift('clock repair');
      const clockCandidates: readonly [RegExp, string][] = [
        [/\bcustomer items?\b/u, 'customer items'],
        [/\bmechanical faults?\b/u, 'mechanical faults'],
        [/\breplacement parts?\b/u, 'replacement parts'],
        [/\bprevious repairs?\b|\brepair history\b/u, 'previous repairs'],
        [/\brestoration instructions?\b/u, 'restoration instructions'],
        [/\bcost approvals?\b/u, 'cost approvals'],
        [/\bpromised completion dates?\b|\bcompletion dates?\b/u, 'promised completion dates'],
        [/\bservice history\b/u, 'service history'],
      ];
      for (const [pattern, label] of clockCandidates) {
        if (pattern.test(normalizedDescription)) preferred.push(label);
      }
    }

    if (
      /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/u.test(
        normalizedDescription,
      )
    ) {
      preferred.unshift('custom footwear');
      const footwearCandidates: readonly [RegExp, string][] = [
        [/\bfoot measurements?\b/u, 'foot measurements'],
        [/\bleather selections?\b/u, 'leather selections'],
        [/\bsole types?\b/u, 'sole types'],
        [/\bstitching preferences?\b/u, 'stitching preferences'],
        [/\bfitting notes?\b/u, 'fitting notes'],
        [/\bdesign revisions?\b/u, 'design revisions'],
        [/\bapproved specifications?\b|\blatest approved specifications?\b|\bfinal approved specifications?\b/u, 'final approved specifications'],
        [/\bcompletion deadlines?\b/u, 'completion deadlines'],
      ];
      for (const [pattern, label] of footwearCandidates) {
        if (pattern.test(normalizedDescription)) preferred.push(label);
      }
    }

    if (
      /\b(?:wig makers?|custom wigs?|hairpiece makers?|wig studios?|wig artisans?)\b/u.test(
        normalizedDescription,
      )
    ) {
      preferred.unshift('custom wig');
    }

    if (/\b(?:miniature model|scale model|miniature makers?|model makers?)\b/u.test(normalizedDescription)) {
      const candidates: readonly [RegExp, string][] = [
        [/\bscale requirements?\b/u, 'scale requirements'],
        [/\breference images?\b/u, 'reference images'],
        [/\bmaterial choices?\b/u, 'material choices'],
        [/\bpaint details?\b/u, 'paint details'],
        [/\bdimensions?\b/u, 'dimensions'],
        [/\brevision requests?\b/u, 'revision requests'],
        [/\bcompletion deadlines?\b/u, 'completion deadlines'],
        [/\bapproved version\b|\bcustomer finally approved\b/u, 'final approved version'],
      ];
      for (const [pattern, label] of candidates) {
        if (pattern.test(normalizedDescription)) preferred.push(label);
      }
    }

    const cleaned = values
      .map((value) => this.normalize(value).toLocaleLowerCase())
      .map((value) => value.replace(/\b(\w+)(?:\s+\1)+\b/gu, '$1'))
      .map((value) => value.split(/\s+/u).slice(0, 5).join(' '))
      .filter((value) => value.length >= 4)
      .filter((value) => !/^(?:independent|makers?|model makers?)$/u.test(value))
      .filter(
        (value) =>
          !/\b(?:analy[sz]ed|frequently|usually|separately|difficult|making|leading|struggle|struggles)\b/u.test(
            value,
          ),
      );

    return [...new Set([...preferred, ...cleaned])];
  }

  private static normalizePainTerms(
    description: string,
    values: readonly string[],
  ): string[] {
    const normalizedDescription = this.normalize(description).toLocaleLowerCase();
    const preferred: string[] = [];
    const candidates: readonly [RegExp, string][] = [
      [/\bincorrect proportions?\b/u, 'incorrect proportions'],
      [/\bmissed visual details?\b/u, 'missed visual details'],
      [/\bwasted materials?\b/u, 'wasted materials'],
      [/\brepeated work\b/u, 'repeated work'],
      [/\bdelayed commissions?\b/u, 'delayed commissions'],
      [/\bspelling mistakes?\b/u, 'spelling mistakes'],
      [/\bincorrect placement\b/u, 'incorrect placement'],
      [/\bdelayed orders?\b/u, 'delayed orders'],
      [/\bincorrect patterns?\b/u, 'incorrect patterns'],
      [/\bmissed customization details?\b/u, 'missed customization details'],
      [/\bdelayed installations?\b/u, 'delayed installations'],
      [/\blong waiting times?\b/u, 'long waiting times'],
      [/\buneven resource distribution\b/u, 'uneven resource distribution'],
      [/\bstaff shortages?\b/u, 'staff shortages'],
      [/\bconnected meters?\b|\bsmart meters?\b/u, 'smart meters'],
      [/\bremote monitoring devices?\b/u, 'remote monitoring devices'],
      [/\bautomated control systems?\b/u, 'automated control systems'],
      [/\bdevice failures?\b|\bmeter failures?\b/u, 'device failures'],
      [/\bunusual consumption(?: patterns?)?\b|\bconsumption anomalies?\b/u, 'consumption anomalies'],
      [/\bnetwork disruptions?\b|\bconnectivity failures?\b/u, 'network disruptions'],
      [/\bunauthorized access(?: attempts?)?\b/u, 'unauthorized access attempts'],
      [/\bmalicious interference\b/u, 'malicious interference'],
      [/\bconsumption data\b/u, 'consumption data integrity'],
      [/\bdamage photographs?\b|\bdamage photos?\b/u, 'damage photographs'],
      [/\bfabric selections?\b/u, 'fabric selections'],
      [/\breplacement parts?\b/u, 'replacement parts'],
      [/\bpaint matching\b/u, 'paint matching'],
      [/\brestoration notes?\b/u, 'restoration notes'],
      [/\bapproved restoration(?: work)?\b/u, 'approved restoration work'],
      [/\bmaterial samples?\b|\bphysical material samples?\b/u, 'material samples'],
      [/\blonger journeys?\b/u, 'longer journeys'],
      [/\bunnecessary fuel consumption\b/u, 'unnecessary fuel consumption'],
      [/\bhigher emissions?\b/u, 'higher emissions'],
      [/\bdelayed decisions?\b/u, 'delayed decisions'],
      [/\bincorrect colors?\b|\bwrong colors?\b/u, 'incorrect colors'],
      [/\bmisspelled names?\b|\bspelling mistakes?\b/u, 'misspelled names'],
      [/\bdelayed responses?\b/u, 'delayed responses'],
      [/\bdelayed incident response\b/u, 'delayed incident response'],
      [/\binaccurate consumption data\b/u, 'inaccurate consumption data'],
      [/\bservice disruptions?\b/u, 'service disruptions'],
      [/\bunnecessary operational costs?\b/u, 'unnecessary operational costs'],
      [/\bincorrect replacements?\b/u, 'incorrect replacements'],
      [/\bmismatched materials?\b/u, 'mismatched materials'],
      [/\blost details?\b/u, 'lost details'],
      [/\bdelayed customer orders?\b/u, 'delayed customer orders'],
      [/\bfraudulent delivery claims?\b|\bfalse delivery claims?\b/u, 'fraudulent delivery claims'],
      [/\bunauthorized (?:shipping|delivery) (?:information|address) changes?\b|\bshipping address changes?\b/u, 'unauthorized shipping changes'],
      [/\baccount misuse\b|\baccount abuse\b|\baccount takeover\b/u, 'account misuse'],
      [/\bcarrier scans?\b/u, 'carrier scans'],
      [/\bdelivery confirmations?\b|\bproof of delivery\b/u, 'delivery confirmation'],
      [/\brefund abuse\b/u, 'refund abuse'],
      [/\blost merchandise\b|\blost goods\b/u, 'lost merchandise'],
      [/\bsizing errors?\b|\bincorrect sizing\b/u, 'sizing errors'],
      [/\bincorrect material choices?\b|\bwrong material choices?\b/u, 'incorrect material choices'],
      [/\brepeated fittings?\b/u, 'repeated fittings'],
      [/\bincorrect adjustments?\b/u, 'incorrect adjustments'],
      [/\bforgotten requests?\b/u, 'forgotten requests'],
      [/\bfabric damage\b|\bdamaged fabric\b/u, 'fabric damage'],
      [/\bdelayed completion\b|\bdelayed pickup\b/u, 'delayed completion'],
      [/\blow[- ]performing content\b|\bunderperforming content\b/u, 'low-performing content'],
      [/\bpoor investment decisions?\b/u, 'poor investment decisions'],
    ];
    for (const [pattern, label] of candidates) {
      if (pattern.test(normalizedDescription)) preferred.push(label);
    }

    const supportPainCandidates: readonly [RegExp, string][] = [
      [/\bno (?:access to )?live chat\b|\blive chat (?:is )?(?:unavailable|missing)\b/u, 'no live chat access'],
      [/\bno (?:phone )?number\b|\bno number to (?:call|talk to)\b|\bno phone support\b/u, 'no phone support'],
      [/\bno human support\b|\bno human agent\b|\bcannot reach (?:a )?human\b|\bcan['’]?t reach (?:a )?human\b/u, 'no human support'],
      [/\bbot[- ]only\b|\bonly (?:a )?bot\b|\bbot responses?\b|\bautomated responses?\b/u, 'bot-only responses'],
      [/\bunanswered (?:emails?|messages?|requests?)\b|\bno response\b|\bwithout (?:a )?response\b/u, 'unanswered support contacts'],
      [/\brepeated (?:emails?|messages?|contacts?|requests?)\b|\bvarious emails?\b|\bmultiple (?:emails?|contacts?|requests?)\b/u, 'repeated support contacts'],
      [/\bunresolved (?:support )?(?:case|cases|issue|issues|request|requests)\b/u, 'unresolved support cases'],
      [/\bdelayed (?:support )?resolution\b|\blong resolution time\b/u, 'delayed support resolution'],
    ];
    for (const [pattern, label] of supportPainCandidates) {
      if (pattern.test(normalizedDescription)) preferred.push(label);
    }

    const additionalPainCandidates: readonly [RegExp, string][] = [
      [/\brepeated diagnostics?\b/u, 'repeated diagnostics'],
      [/\bincorrect replacement parts?\b/u, 'incorrect replacement parts'],
      [/\bincorrect parts?\b/u, 'incorrect parts'],
      [/\bforgotten adjustments?\b/u, 'forgotten adjustments'],
      [/\bunnecessary repairs?\b/u, 'unnecessary repairs'],
      [/\binconsistent restoration results?\b/u, 'inconsistent restoration results'],
      [/\bforgotten customer requests?\b/u, 'forgotten customer requests'],
      [/\bunexpected costs?\b/u, 'unexpected costs'],
      [/\bdelayed repairs?\b/u, 'delayed repairs'],
      [/\bmisleading revenue reports?\b/u, 'misleading revenue reports'],
      [/\boverspending\b|\boverspend\b/u, 'promotion overspending'],
      [/\bineffective promotions?\b/u, 'ineffective promotions'],
      [/\bpoor pricing decisions?\b/u, 'poor pricing decisions'],
      [/\bunnecessary operating costs?\b/u, 'unnecessary operating costs'],
      [/\binaccurate revenue forecasts?\b/u, 'inaccurate revenue forecasts'],
      [/\bdeclining margins?\b|\bmargin decline\b|\bmargin erosion\b/u, 'declining margins'],
    ];
    for (const [pattern, label] of additionalPainCandidates) {
      if (pattern.test(normalizedDescription)) preferred.push(label);
    }

    const cleaned = values
      .map((value) => this.normalize(value).toLocaleLowerCase())
      .map((value) => value.replace(/\b(\w+)(?:\s+\1)+\b/gu, '$1'))
      .map((value) => value.split(/\s+/u).slice(0, 4).join(' '))
      .filter((value) => value.length >= 4)
      .filter((value) => !/^(?:wasted|delayed|missing|incorrect)$/u.test(value));

    const supplemental = cleaned.filter(
      (value) =>
        !preferred.some(
          (preferredValue) =>
            value !== preferredValue &&
            (value.startsWith(`${preferredValue} `) ||
              value.endsWith(` ${preferredValue}`) ||
              preferredValue.startsWith(`${value} `)),
        ),
    );

    return [...new Set([...preferred, ...supplemental])];
  }

  private static resolveEvidenceFeatureCapability(
    description: string,
  ): EvidenceFeatureCapabilityProfile | null {
    const text = this.normalize(description).toLocaleLowerCase();
    const explicitRequest =
      /\b(?:i\s+wish|wish\s+(?:it|they|the\s+app|the\s+product)?|please\s+add|please\s+include|would\s+like|we\s+need|i\s+need|users?\s+need|need\s+(?:an?|the)|should\s+have|could\s+you\s+add|option\s+to|ability\s+to|support\s+for|add\s+(?:an?|the|more)|include\s+(?:an?|the|more)|allow\s+(?:me|us|users?)\s+to|feature\s+request|there\s+should\s+be|(?:it|the\s+app|the\s+product)\s+should\s+have)\b/u.test(text);
    const expansionRequest =
      /\b(?:more|additional|expand|expanded|larger|broader|extra|new)\b/u.test(text) &&
      /\b(?:courses?|lessons?|modules?|content|resources?|templates?|examples?|guides?|videos?|tutorials?|reports?|filters?|integrations?|languages?|notifications?|reminders?|options?|features?)\b/u.test(text);

    if (!explicitRequest && !expansionRequest) return null;

    if (
      /\b(?:micro[- ]?learning|microlearning|courses?|lessons?|learning modules?|training modules?|educational content|learning content|curriculum|tutorials?|training content)\b/u.test(text)
    ) {
      const micro = /\b(?:micro[- ]?learning|microlearning)\b/u.test(text);
      return {
        key: 'LEARNING_CONTENT',
        label: micro ? 'micro-learning content library' : 'learning content library',
        titleFragment: micro
          ? 'Micro-Learning Library & Progress'
          : 'Learning Content Library & Progress',
        workflowFocus:
          'requested learning content, course or module catalog, topic coverage, content status, learner progress, discovery, and human-reviewed publishing or curation decisions',
        metrics: [
          'requested-content coverage',
          'content discovery success',
          'module completion',
          'return engagement',
          'unresolved content requests',
        ],
      };
    }

    if (/\b(?:reminders?|notifications?|alerts?|nudges?|daily reminder|push notification)\b/u.test(text)) {
      return {
        key: 'REMINDERS_NOTIFICATIONS',
        label: 'reminder and notification capability',
        titleFragment: 'Reminder & Engagement',
        workflowFocus:
          'user-configurable reminders and notifications, timing, channel, preference, delivery state, acknowledgement, and opt-out controls with measurable engagement outcomes',
        metrics: [
          'notification delivery success',
          'reminder acknowledgement',
          'return engagement',
          'opt-out rate',
          'missed reminder events',
        ],
      };
    }

    if (/\b(?:search|filter|filters|sorting|sort by|find|discovery|discover|browse|faceted)\b/u.test(text)) {
      return {
        key: 'SEARCH_DISCOVERY',
        label: 'search and discovery capability',
        titleFragment: 'Search & Discovery',
        workflowFocus:
          'searchable records or content, filters, sorting, discovery context, result relevance, saved views, and traceable user feedback on findability',
        metrics: ['search success', 'time to find', 'zero-result searches', 'filter usage', 'repeat search effort'],
      };
    }

    if (/\b(?:integrat(?:e|ion|ions)|api|webhook|connect(?:ion|or)?|sync with|third[- ]party|external system)\b/u.test(text)) {
      return {
        key: 'INTEGRATION_EXCHANGE',
        label: 'integration and data-exchange capability',
        titleFragment: 'Integration & Data Exchange',
        workflowFocus:
          'requested external-system connection, mapped data, synchronization state, transfer errors, permissions, provenance, and human-reviewed integration controls',
        metrics: ['successful syncs', 'integration failures', 'data freshness', 'mapping errors', 'manual transfer effort'],
      };
    }

    if (/\b(?:export|import|download|upload|csv|spreadsheet|pdf|data portability|backup|restore)\b/u.test(text)) {
      return {
        key: 'DATA_PORTABILITY',
        label: 'data portability capability',
        titleFragment: 'Import, Export & Data Portability',
        workflowFocus:
          'requested imports, exports, downloadable or uploaded records, format validation, transfer status, provenance, and recoverable data-portability operations',
        metrics: ['successful transfers', 'format errors', 'transfer completion time', 'manual re-entry avoided', 'failed export or import attempts'],
      };
    }

    if (/\b(?:customi[sz](?:e|ation)|preferences?|themes?|dark mode|layout|custom fields?|configur(?:e|able|ation)|personalization|personalisation)\b/u.test(text)) {
      return {
        key: 'CUSTOMIZATION_PREFERENCES',
        label: 'customization and preference capability',
        titleFragment: 'Customization & Preferences',
        workflowFocus:
          'user-configurable preferences, field or layout options, saved settings, defaults, change history, and safe restoration of preferred experience state',
        metrics: ['preference adoption', 'configuration completion', 'reset events', 'repeated configuration effort', 'user-reported fit'],
      };
    }

    if (/\b(?:collaborat(?:e|ion)|share|sharing|shared|comments?|mentions?|team access|co-edit|coauthor|review together)\b/u.test(text)) {
      return {
        key: 'COLLABORATION_SHARING',
        label: 'collaboration and sharing capability',
        titleFragment: 'Collaboration & Shared Review',
        workflowFocus:
          'shared records or content, participant access, comments, mentions, review state, ownership, version history, and auditable collaboration decisions',
        metrics: ['review turnaround', 'unresolved comments', 'handoff time', 'shared-work completion', 'duplicate collaboration effort'],
      };
    }

    if (/\b(?:language|languages|translation|translate|locali[sz]ation|rtl|right[- ]to[- ]left|accessibility|screen reader|captions?|subtitles?|contrast|keyboard navigation)\b/u.test(text)) {
      return {
        key: 'LOCALIZATION_ACCESSIBILITY',
        label: 'localization and accessibility capability',
        titleFragment: 'Localization & Accessibility',
        workflowFocus:
          'requested language, translation, directionality, accessibility preference, assistive support, content coverage, and human-reviewed experience quality',
        metrics: ['localized coverage', 'accessibility issue closure', 'task completion', 'unsupported-language requests', 'assistive-use success'],
      };
    }

    if (/\b(?:offline|without internet|no internet|sync later|background sync|cached|cache|local sync)\b/u.test(text)) {
      return {
        key: 'OFFLINE_SYNC',
        label: 'offline access and synchronization capability',
        titleFragment: 'Offline Access & Sync',
        workflowFocus:
          'offline-readable or editable state, local changes, synchronization queue, conflict handling, reconnect status, and data-integrity verification',
        metrics: ['offline task completion', 'sync success', 'conflict rate', 'reconnect recovery time', 'lost-change incidents'],
      };
    }

    if (/\b(?:analytics|dashboard|dashboards|reporting|reports|insights|metrics|statistics|charts?|visuali[sz]ation)\b/u.test(text)) {
      return {
        key: 'ANALYTICS_REPORTING',
        label: 'analytics and reporting capability',
        titleFragment: 'Analytics & Reporting',
        workflowFocus:
          'requested measures, reporting dimensions, source records, calculated indicators, dashboard views, exports, and human-reviewed interpretation context',
        metrics: ['report completion time', 'data completeness', 'metric freshness', 'unresolved data gaps', 'report reuse'],
      };
    }

    if (/\b(?:appointment|appointments|booking|bookings|calendar|schedule|scheduling|reschedule|reservation|reservations|time slots?)\b/u.test(text)) {
      return {
        key: 'SCHEDULING_BOOKING',
        label: 'scheduling and booking capability',
        titleFragment: 'Scheduling & Booking',
        workflowFocus:
          'requested availability, time slots, booking or appointment state, participant constraints, reminders, changes, conflicts, and human-reviewed exceptions',
        metrics: ['booking completion', 'scheduling lead time', 'conflict rate', 'reschedule effort', 'missed appointments'],
      };
    }

    if (/\b(?:messages?|messaging|chat|inbox|conversation|communicat(?:e|ion)|direct message|dm)\b/u.test(text)) {
      return {
        key: 'MESSAGING_COMMUNICATION',
        label: 'messaging and communication capability',
        titleFragment: 'Messaging & Communication',
        workflowFocus:
          'requested conversations, participants, message state, attachments, delivery or read state, escalation context, and auditable communication history',
        metrics: ['message delivery success', 'response time', 'unanswered conversations', 'handoff time', 'repeated contact effort'],
      };
    }

    const requestedLabel = this.extractRequestedCapabilityLabel(description);
    if (!requestedLabel) return null;
    return {
      key: 'GENERIC_REQUESTED_CAPABILITY',
      label: requestedLabel.toLocaleLowerCase(),
      titleFragment: `${this.toTitleCase(requestedLabel)} Capability`,
      workflowFocus: `${requestedLabel.toLocaleLowerCase()}, affected-user context, requested behavior, delivery or completion state, supporting evidence, and measurable use outcomes`,
      metrics: ['feature adoption', 'successful use', 'user-reported usefulness', 'unresolved capability requests', 'repeat workaround effort'],
    };
  }

  private static extractRequestedCapabilityLabel(description: string): string {
    const normalized = description
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    const patterns = [
      /\bplease\s+(?:add|include)\s+(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
      /\b(?:option|ability)\s+to\s+(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
      /\bsupport\s+for\s+(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
      /\b(?:i\s+)?wish\s+(?:it|they|the\s+app|the\s+product)\s+(?:had|have|included)\s+(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
      /\b(?:i|we|users?)\s+(?:would\s+like|need)\s+(?:to\s+)?(?:have\s+)?(?:more\s+|an?\s+|the\s+)?(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
      /\b(?:it|the\s+app|the\s+product)\s+should\s+have\s+(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
      /\bthere\s+should\s+be\s+(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
      /\badd\s+(?:more\s+|an?\s+|the\s+)?(.{3,80}?)(?:[.!?]|\bbecause\b|\bso that\b|$)/iu,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(normalized);
      if (!match?.[1]) continue;
      const cleaned = match[1]
        .split(/\b(?:i\s+wish|we\s+need|users?\s+need|the\s+app\s+should|the\s+product\s+should|there\s+should|please\s+add|please\s+include|option\s+to|ability\s+to|support\s+for)\b/iu)[0]
        .replace(/\b(?:please|feature|capability|option|wish|had|have|need|should)\b/giu, ' ')
        .replace(/\b(?:i|we|they|it|users?)\b/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/\s+/u)
        .slice(0, 6)
        .join(' ')
        .replace(/^(?:more|additional|a|an|the)\s+/iu, '')
        .trim();
      if (cleaned.length >= 3) return cleaned;
    }
    return '';
  }

  private static resolveEvidenceFeatureCapabilityFeatures(
    profile: EvidenceFeatureCapabilityProfile | null,
  ): string[] {
    switch (profile?.key) {
      case 'LEARNING_CONTENT':
        return [
          'Learning-content catalog with course or module topic, format, audience, difficulty, status, source, and publication state',
          'Requested-content gap queue that links direct user requests to missing or underrepresented topics without treating a single request as market-wide demand',
          'Learner progress and discovery view showing available modules, completion state, saved progress, and relevant next content without autonomous clinical or consequential recommendations',
          'Human-reviewed content curation and publishing workflow with owner, review status, revision history, evidence provenance, and explicit release decision',
          'Pilot metrics for requested-content coverage, content discovery success, module completion, return engagement, and unresolved content requests',
        ];
      case 'REMINDERS_NOTIFICATIONS':
        return [
          'User-configurable reminder rules with purpose, cadence, time window, channel, timezone, active state, and opt-out preference',
          'Delivery timeline showing scheduled, sent, delivered, acknowledged, skipped, failed, and suppressed reminder events',
          'Preference safeguards that prevent duplicate, excessive, or unwanted notifications and preserve user-controlled quiet periods',
          'Human-reviewed reminder templates and escalation rules for sensitive or consequential workflows',
          'Pilot metrics for delivery success, acknowledgement, return engagement, opt-out rate, and missed reminder events',
        ];
      case 'SEARCH_DISCOVERY':
        return [
          'Search index over the requested records or content with clear searchable fields, filters, sorting, and saved views',
          'Result-quality view that captures zero-result searches, repeated queries, selected results, and user feedback on findability',
          'Discovery facets that expose relevant categories or attributes without changing source records or inventing unsupported matches',
          'Human-reviewed synonym, filter, and ranking configuration with change history and rollback',
          'Pilot metrics for search success, time to find, zero-result searches, filter usage, and repeat search effort',
        ];
      case 'INTEGRATION_EXCHANGE':
        return [
          'Integration registry with external system, connection method, permission scope, mapped objects, sync direction, and owner',
          'Field and record mapping with validation status, provenance, transformation rules, and explicit handling of unsupported values',
          'Synchronization queue showing pending, successful, failed, retried, and manually reviewed transfers',
          'Human-reviewed connection changes, credential rotation, mapping updates, and recovery actions with audit history',
          'Pilot metrics for successful syncs, integration failures, data freshness, mapping errors, and manual transfer effort',
        ];
      case 'DATA_PORTABILITY':
        return [
          'Import/export job record with requested format, selected data scope, requester, validation state, and transfer status',
          'Format validation and preview before data is committed or exported, with explicit rejected-row or unsupported-field reporting',
          'Traceable upload/download history with source, destination, checksum or integrity status, and recoverable retry state',
          'Human-reviewed handling for destructive imports, bulk changes, or sensitive exports',
          'Pilot metrics for successful transfers, format errors, transfer completion time, manual re-entry avoided, and failed attempts',
        ];
      case 'CUSTOMIZATION_PREFERENCES':
        return [
          'User preference profile for the requested configurable options with defaults, scope, saved state, and last-updated history',
          'Configuration preview that shows the effect of preference or layout changes before they are committed',
          'Per-user or per-workspace overrides with safe fallback to defaults and one-click reset where appropriate',
          'Human-reviewed administration for shared defaults, protected options, and compatibility constraints',
          'Pilot metrics for preference adoption, configuration completion, reset events, repeated configuration effort, and user-reported fit',
        ];
      case 'COLLABORATION_SHARING':
        return [
          'Shared workspace membership with participant role, access scope, ownership, invitation state, and removal history',
          'Comments, mentions, review requests, attachments, and resolved/unresolved discussion state linked to the exact record or version',
          'Version and handoff history showing who changed, reviewed, approved, or returned each shared item',
          'Human-reviewed permission and external-sharing controls for sensitive content',
          'Pilot metrics for review turnaround, unresolved comments, handoff time, shared-work completion, and duplicate effort',
        ];
      case 'LOCALIZATION_ACCESSIBILITY':
        return [
          'Language and accessibility preference profile covering locale, directionality, captions, assistive settings, and supported experience options',
          'Coverage matrix showing which screens, content, labels, media, or workflows are localized or accessibility-reviewed',
          'Issue queue for untranslated, unreadable, inaccessible, or directionality-breaking experiences with owner and verification state',
          'Human-reviewed translation and accessibility changes with source text, approved revision, and rollback history',
          'Pilot metrics for localized coverage, accessibility issue closure, task completion, unsupported-language requests, and assistive-use success',
        ];
      case 'OFFLINE_SYNC':
        return [
          'Offline-capable record state with local revision, last synchronized version, pending changes, and reconnect status',
          'Synchronization queue that preserves create/update/delete intent and exposes conflicts instead of silently overwriting data',
          'Conflict-resolution view comparing local and remote versions with human-reviewed merge or keep decisions when required',
          'Integrity checks and retry history for reconnect, partial sync, and interrupted transfer scenarios',
          'Pilot metrics for offline task completion, sync success, conflict rate, reconnect recovery time, and lost-change incidents',
        ];
      case 'ANALYTICS_REPORTING':
        return [
          'Metric catalog with definition, source fields, calculation rule, owner, refresh cadence, and known limitations',
          'Dashboard and report views with filters, time ranges, drill-down context, and visible source provenance',
          'Data-quality checks that flag missing, stale, conflicting, or unsupported inputs before metrics are presented as reliable',
          'Human-reviewed report publication and interpretation notes for consequential or externally shared outputs',
          'Pilot metrics for report completion time, data completeness, metric freshness, unresolved gaps, and report reuse',
        ];
      case 'SCHEDULING_BOOKING':
        return [
          'Availability and time-slot model with participant, resource, location, duration, timezone, and eligibility constraints',
          'Booking or appointment record with requested slot, confirmation state, reminders, changes, cancellation, and reschedule history',
          'Conflict detection for overlapping resources, unavailable participants, invalid slots, and unresolved scheduling constraints',
          'Human-reviewed exception handling for protected, scarce, or policy-constrained bookings',
          'Pilot metrics for booking completion, scheduling lead time, conflict rate, reschedule effort, and missed appointments',
        ];
      case 'MESSAGING_COMMUNICATION':
        return [
          'Conversation record with participants, message history, attachments, delivery state, read state, and linked operational context',
          'Inbox and thread organization with search, unread state, ownership, escalation, and follow-up markers',
          'Communication safeguards for permissions, sensitive attachments, retention, and auditable moderation or escalation actions',
          'Human-reviewed handoff and resolution history when conversations become support, approval, or exception cases',
          'Pilot metrics for delivery success, response time, unanswered conversations, handoff time, and repeated contact effort',
        ];
      case 'GENERIC_REQUESTED_CAPABILITY':
      default: {
        const label = profile?.label ?? 'requested capability';
        return [
          `Explicit ${label} request record linking the original user evidence, affected workflow, requested behavior, and current delivery state`,
          `Capability specification for ${label} with inputs, outputs, constraints, permissions, edge cases, and measurable acceptance criteria`,
          `Pilot implementation view that compares requested behavior, actual behavior, user feedback, and unresolved gaps without inventing broader demand`,
          'Human-reviewed release, exception, and rollback decisions with evidence provenance and change history',
          `Pilot metrics for ${profile?.metrics.join(', ') ?? 'feature adoption, successful use, unresolved capability requests, and repeat workaround effort'}`,
        ];
      }
    }
  }

  private static resolveEvidenceFeatureCapabilityObjectives(
    profile: EvidenceFeatureCapabilityProfile | null,
  ): string[] {
    const label = profile?.label ?? 'requested capability';
    const metrics = profile?.metrics ?? [
      'feature adoption',
      'successful use',
      'user-reported usefulness',
      'unresolved capability requests',
    ];
    return [
      `Translate the retained direct request for ${label} into an explicit, testable capability specification without broadening one request into market-wide demand.`,
      `Implement the minimum ${label} workflow with traceable state, user-controlled behavior, and clear failure or exception handling.`,
      `Validate the capability with affected users and preserve human-reviewed release, safety, policy, or content decisions where consequential outcomes are possible.`,
      `Measure ${metrics.slice(0, 5).join(', ')} during the pilot without unsupported percentage targets.`,
    ];
  }

  private static resolveEvidenceFeatureCapabilityEntities(
    profile: EvidenceFeatureCapabilityProfile | null,
  ): string[] {
    switch (profile?.key) {
      case 'LEARNING_CONTENT':
        return ['User', 'ContentRequest', 'LearningContent', 'LearningModule', 'Topic', 'ContentVersion', 'ContentReview', 'LearnerProgress', 'ContentFeedback', 'PublicationEvent'];
      case 'REMINDERS_NOTIFICATIONS':
        return ['User', 'ReminderRule', 'NotificationTemplate', 'NotificationPreference', 'ScheduledNotification', 'DeliveryEvent', 'AcknowledgementEvent', 'QuietPeriod', 'AuditEvent'];
      case 'SEARCH_DISCOVERY':
        return ['User', 'SearchQuery', 'SearchFilter', 'SavedView', 'SearchResultEvent', 'DiscoveryFeedback', 'SearchConfiguration', 'AuditEvent'];
      case 'INTEGRATION_EXCHANGE':
        return ['ExternalSystem', 'IntegrationConnection', 'PermissionScope', 'FieldMapping', 'SyncJob', 'SyncEvent', 'TransferError', 'ReviewDecision', 'AuditEvent'];
      case 'DATA_PORTABILITY':
        return ['TransferJob', 'TransferFile', 'DataSelection', 'FormatDefinition', 'ValidationFinding', 'TransferEvent', 'ReviewDecision', 'AuditEvent'];
      case 'CUSTOMIZATION_PREFERENCES':
        return ['User', 'PreferenceProfile', 'PreferenceDefinition', 'PreferenceValue', 'WorkspaceDefault', 'ConfigurationChange', 'ResetEvent', 'AuditEvent'];
      case 'COLLABORATION_SHARING':
        return ['Workspace', 'Participant', 'Membership', 'SharedItem', 'Comment', 'Mention', 'ReviewRequest', 'VersionEvent', 'PermissionChange', 'AuditEvent'];
      case 'LOCALIZATION_ACCESSIBILITY':
        return ['Locale', 'AccessibilityPreference', 'LocalizedResource', 'TranslationVersion', 'AccessibilityIssue', 'ReviewDecision', 'CoverageFinding', 'AuditEvent'];
      case 'OFFLINE_SYNC':
        return ['LocalRecordState', 'SyncJob', 'PendingChange', 'RemoteRevision', 'SyncConflict', 'ConflictDecision', 'SyncEvent', 'IntegrityCheck', 'AuditEvent'];
      case 'ANALYTICS_REPORTING':
        return ['MetricDefinition', 'DataSource', 'MetricSnapshot', 'Dashboard', 'Report', 'ReportFilter', 'DataQualityFinding', 'PublicationEvent', 'AuditEvent'];
      case 'SCHEDULING_BOOKING':
        return ['Participant', 'Resource', 'AvailabilityWindow', 'TimeSlot', 'Booking', 'BookingChange', 'ReminderEvent', 'ScheduleConflict', 'ReviewDecision', 'AuditEvent'];
      case 'MESSAGING_COMMUNICATION':
        return ['Conversation', 'Participant', 'Message', 'Attachment', 'DeliveryEvent', 'ReadEvent', 'EscalationEvent', 'FollowUpAction', 'AuditEvent'];
      case 'GENERIC_REQUESTED_CAPABILITY':
      default:
        return ['UserRequest', 'CapabilitySpecification', 'CapabilityState', 'CapabilityEvent', 'UserFeedback', 'ReviewDecision', 'ReleaseEvent', 'AuditEvent'];
    }
  }

  private static resolveCategory(
    description: string,
    workflowTerms: readonly string[],
    featureCapability: EvidenceFeatureCapabilityProfile | null,
    enableEvidenceDerivedProblemWorkflow: boolean,
    problemFamilyKey: string | null,
    requesterDescription = '',
  ):
    | 'FRAUD_INTEGRITY'
    | 'ORDER_DELIVERY_DISPUTE_INTEGRITY'
    | 'SHIPMENT_EXCEPTION_RECOVERY'
    | 'ECOMMERCE_MARGIN_PROFITABILITY'
    | 'TOURISM_PROFITABILITY_INTELLIGENCE'
    | 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE'
    | 'SUBSCRIPTION_ACCESS_REFUND'
    | 'CUSTOMER_SUPPORT_ESCALATION'
    | 'ACCESS_CAPACITY_PLANNING'
    | 'RISK_INTEGRITY_REVIEW'
    | 'MUNICIPAL_WASTE_COORDINATION'
    | 'COST_PERFORMANCE_INTELLIGENCE'
    | 'COMPLIANCE_GOVERNANCE_REVIEW'
    | 'INCIDENT_EXCEPTION_RESOLUTION'
    | 'QUALITY_RELIABILITY_IMPROVEMENT'
    | 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS'
    | 'FEATURE_CAPABILITY_DELIVERY'
    | 'TIME_ACCESS_RECOVERY_PLANNING'
    | 'AI_HALLUCINATION_OUTPUT_RELIABILITY'
    | 'DATA_SYNC_FRESHNESS_RECOVERY'
    | 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY'
    | 'WORKFORCE_CAPACITY_CONTINUITY'
    | 'PROBLEM_SPECIFIC_OPERATIONAL'
    | 'EVIDENCE_DECISION_REVIEW'
    | 'GOVERNMENT_RECORD_ACCESS_INTEGRITY'
    | 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY'
    | 'IDENTITY_ACCESS_GOVERNANCE'
    | 'ACCOUNT_SECURITY_MONITORING'
    | 'AUTH_ACCESS_RECOVERY'
    | 'CYBERSECURITY_LEARNING_CONTENT_SAFETY'
    | 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION'
    | 'MARKETPLACE_SELLER_TRUST'
    | 'PUBLIC_HEALTH_DEMAND_CAPACITY'
    | 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH'
    | 'ENERGY_IOT_INCIDENT_ATTRIBUTION'
    | 'URBAN_ENERGY_DEMAND_INTELLIGENCE'
    | 'URBAN_MOBILITY_CONGESTION_EMISSIONS'
    | 'DOLL_RESTORATION_SPECIFICATION'
    | 'SPECIFICATION_VERSIONING'
    | 'MANUFACTURING_WASTE_SUSTAINABILITY'
    | 'ENVIRONMENTAL_MONITORING'
    | 'ROUTING_SUSTAINABILITY'
    | 'SERVICE_HISTORY'
    | 'STAFFING_PLANNING'
    | 'GENERAL_OPERATIONAL' {
    const workflow = workflowTerms.join(' ');
    const text = `${description} ${workflow}`;
    const requestProfile = RequestWorkflowIntentProfileUtil.resolve(
      requesterDescription || description,
    );

    /*
     * Request-description-first guard: a municipal waste coordination request
     * can naturally mention operating cost and route performance, but those
     * are outcomes of the sanitation workflow rather than evidence of a
     * profitability/finance problem. Resolve this concrete workflow before
     * any broad problem-family or financial fallback can reframe it.
     */
    const municipalWasteObjectIdentity =
      /\b(?:municipal solid waste|solid waste|municipal waste|waste collection|garbage collection|trash collection|refuse collection|sanitation collection|waste bins?|garbage bins?|trash bins?|waste containers?|garbage containers?|refuse containers?|landfill|recycling collection)\b/iu.test(
        description,
      );
    if (
      municipalWasteObjectIdentity &&
      /\b(?:cities|city governments?|municipalities|municipal governments?|sanitation departments?|waste management departments?|public works departments?)\b/iu.test(description) &&
      /\b(?:collection schedules?|pickup schedules?|container capacity|bin capacity|fill levels?|citizen complaints?|collection routes?|route performance|municipal vehicles?|overflowing containers?|overflowing bins?|missed pickups?)\b/iu.test(description)
    ) {
      return 'MUNICIPAL_WASTE_COORDINATION';
    }

    if (
      /\b(?:noise pollution|environmental noise|urban noise|noise sensors?|sound sensors?|sound levels?|noise levels?|decibels?|acoustic monitoring|soundscape monitoring)\b/iu.test(description) &&
      /\b(?:cities|city|municipal|urban|neighborhoods?|neighbourhoods?|commercial districts?|construction zones?|major roads?|traffic|citizen complaints?|location data|enforcement|urban planning)\b/iu.test(description)
    ) {
      return 'ENVIRONMENTAL_MONITORING';
    }

    if (
      /\b(?:private hospitals?|hospitals?|hospital systems?|medical centers?)\b/iu.test(description) &&
      /\b(?:staffing expenses?|staffing costs?|medical supply usage|supply costs?|patient volumes?|insurance reimbursements?|treatment costs?|department costs?|budget|profitability|financial inefficien|resource allocation|resource consumption|cost efficiency|cost-efficiency)\w*\b/iu.test(description)
    ) {
      return 'COST_PERFORMANCE_INTELLIGENCE';
    }

    if (
      /\b(?:sign language interpretation agenc(?:y|ies)|sign language interpreting agenc(?:y|ies)|asl interpretation agenc(?:y|ies)|asl interpreting agenc(?:y|ies)|interpretation agenc(?:y|ies)|interpreting agenc(?:y|ies)|interpreter agenc(?:y|ies))\b/iu.test(description) &&
      /\b(?:interpreter availability|assignment details?|assignment matching|client communication preferences?|specialized vocabulary|session notes?|last[- ]minute schedule changes?|scheduling conflicts?)\b/iu.test(description)
    ) {
      return 'STAFFING_PLANNING';
    }

    if (
      /\b(?:public education systems?|education systems?|schools?|school districts?|education authorities?|universities|university|higher education|online learning systems?|learning platforms?|learning management systems?|lms|examination platforms?|online exams?|online assessments?|student information systems?|administrative accounts?)\b/iu.test(description) &&
      /\b(?:login activity|login records?|authentication logs?|exam sessions?|examination platforms?|account permissions?|access permissions?|administrative accounts?|student records?|record access|record changes?|device information|device data|device fingerprints?|security alerts?|account activity|academic integrity|exam integrity)\b/iu.test(description) &&
      /\b(?:compromised accounts?|account compromise|suspicious activity|suspicious logins?|unauthorized access|unauthorised access|security incidents?|cybersecurity|false positives?|unnecessary restrictions?|exposed student information|academic misuse|exam integrity)\b/iu.test(description)
    ) {
      return 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY';
    }

    const requestText = requesterDescription || description;

    /*
     * Request-first identity/access categories prevent downstream opportunity
     * text or old evidence-family labels from injecting payment-fraud,
     * citizen-report, or account-recovery blueprints into employee/portal
     * security workflows.
     */
    const enterpriseIdentityActor =
      /\b(?:large companies?|enterprises?|organizations?|organisations?|corporations?|businesses?|employers?)\b/iu.test(requestText) &&
      /\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|employee accounts?|user accounts?|employee access)\b/iu.test(requestText);
    const enterpriseIdentityWorkflow =
      /\b(?:system permissions?|account permissions?|access permissions?|permissions?|access rights?|entitlements?|employee access|role changes?|role transitions?|department changes?|move between departments?|transfers?|offboarding|deprovision(?:ing|ed)?|account removal|access removal|temporary project access|project access|identity lifecycle|account lifecycle|joiner mover leaver|login activity|access logs?)\b/iu.test(requestText);
    const enterpriseIdentityRisk =
      /\b(?:unusual account behavior|unusual behavior|suspicious activity|unauthorized access|unauthorised access|excessive privileges?|stale access|orphaned accounts?|access drift|delayed account removal|security alerts?|security investigations?|unnecessary security investigations?)\b/iu.test(requestText);
    if (enterpriseIdentityActor && enterpriseIdentityWorkflow && enterpriseIdentityRisk) {
      return 'IDENTITY_ACCESS_GOVERNANCE';
    }

    const accountSecurityActor =
      /\b(?:online portals?|user portals?|customer portals?|tenant portals?|staff portals?|member portals?|digital portals?|online platforms?|user accounts?|customer accounts?|tenant accounts?|staff accounts?|member accounts?|property management portals?|employee accounts?)\b/iu.test(requestText);
    const accountSecurityWorkflow =
      /\b(?:login activity|login records?|authentication|account permissions?|access permissions?|access rights?|roles?|privileges?|security alerts?|device information|account activity|payment behavior|payment changes?)\b/iu.test(requestText);
    const accountSecurityRisk =
      /\b(?:compromised accounts?|account compromise|account takeover|unauthorized access|unauthorised access|suspicious activity|delayed investigations?|security investigation|false positives?|unnecessary restrictions?|legitimate users? restricted|fraudulent payment changes?)\b/iu.test(requestText);
    if (accountSecurityActor && accountSecurityWorkflow && accountSecurityRisk) {
      return 'ACCOUNT_SECURITY_MONITORING';
    }

    const familyCategory = this.resolveCategoryFromProblemFamily(problemFamilyKey);
    if (familyCategory) {
      return familyCategory;
    }

    // Payment-fraud workflows may mention unauthorized account access as one
    // signal. Keep the primary object/problem (fraudulent payment activity)
    // ahead of the generic authentication fallback so the solution is an
    // investigation/correlation product rather than account recovery.
    if (
      /\b(?:fraud|fraudulent|suspicious transactions?|unusual payments?|unusual payment activity|coordinated fraud|unauthorized payment|identity checks?|security alerts?)\b/iu.test(description) &&
      /\b(?:government payment systems?|payments?|transactions?|taxes?|permits?|benefits?|public service fees?|financial losses?|investigations?)\b/iu.test(description)
    ) {
      return 'FRAUD_INTEGRITY';
    }

    if (
      /\b(?:login|log in|sign in|account access|authentication|two[- ]factor|2fa|identity provider|session recovery|account recovery|account activation)\b/iu.test(text)
    ) {
      return 'AUTH_ACCESS_RECOVERY';
    }

    if (
      /\b(?:cybersecurity course|cyber security course|security course|security training|cybersecurity training|students?|learners?)\b/iu.test(text) &&
      /\b(?:hacking tutorials?|unsafe videos?|unsafe content|malicious tutorials?|student exposure|exposure to|content safety|training content|youtube videos?)\b/iu.test(text)
    ) {
      return 'CYBERSECURITY_LEARNING_CONTENT_SAFETY';
    }

    if (
      /\b(?:tourism businesses?|tour operators?|travel businesses?|travel agencies?|destination operators?|hospitality businesses?|tourism)\b/iu.test(text) &&
      /\b(?:seasonal demand|travel behavior|booking records?|customer spending|promotional campaigns?|discounts?|cancellations?|refund activity|operating expenses?|profitability|real profit|revenue forecasts?|pricing decisions?)\b/iu.test(text) &&
      /\b(?:profitability|profit|margin|revenue|pricing|operating expenses?|costs?|forecast)\b/iu.test(text)
    ) {
      return 'TOURISM_PROFITABILITY_INTELLIGENCE';
    }

    if (
      /\b(?:online retailers?|online stores?|e-?commerce|ecommerce merchants?|online merchants?|shopify merchants?|digital retailers?)\b/iu.test(text) &&
      /\b(?:profit margins?|margin change|margin erosion|contribution margin|net profit|gross revenue|profitability|profitable products?|profitable campaigns?|campaign profitability)\b/iu.test(text) &&
      /\b(?:product discounts?|advertising costs?|ad spend|returns?|refunds?|payment fees?|gateway fees?|shipping expenses?|fulfillment costs?|customer purchasing behavior|customer cohorts?|pricing decisions?)\b/iu.test(text)
    ) {
      return 'ECOMMERCE_MARGIN_PROFITABILITY';
    }

    if (
      /\b(?:online subscription businesses?|subscription businesses?|subscription companies|subscription services?|subscription platforms?|saas businesses?|saas companies|membership businesses?)\b/iu.test(description) &&
      /\b(?:customer cancellation|customers? cancel|subscriber churn|customer churn|churn risk|renewal history|renewal behavior|retention|retention offers?|recurring revenue|subscription payments?|discount usage|pricing plans?|pricing tiers?|product usage|support interactions?|refund activity|financial forecasts?)\b/iu.test(description) &&
      /\b(?:why customers? cancel|likely to leave|signal(?:s)? that .* leave|churn risk|retention offers?|unprofitable pricing|pricing plans? .* unprofitable|declining recurring revenue|recurring revenue|financial forecasts?|forecast accuracy|renewal behavior)\b/iu.test(description)
    ) {
      return 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE';
    }

    if (
      /\b(?:refund|money back|subscription|trial|charged|charge|billing|payment)\b/iu.test(text) &&
      /\b(?:cannot|can['’]?t|unable|blocked|cannot access|can['’]?t access|unable to access|access app|access account|restore purchase|update required|support unavailable|cannot reach support|can['’]?t reach support|unable to reach support|request refund|refund request|refund denied|refund unresolved|cancel subscription|charged after cancellation|charged after cancel|duplicate charge|double charged|wrong charge)\b/iu.test(text)
    ) {
      return 'SUBSCRIPTION_ACCESS_REFUND';
    }

    if (
      /\b(?:customer support|support|support ticket|help desk|live chat|phone support|phone number|number to call|number to talk to|email|emails|bot|chatbot|automated response|human agent|human support|real person)\b/iu.test(text) &&
      /\b(?:no live chat|live chat unavailable|no phone|no number|no human|cannot reach|can['’]?t reach|unable to reach|bot response|bot-only|only a bot|automated response|unanswered|no response|repeated emails|various emails|multiple emails|support failure|support unavailable|cannot contact|can['’]?t contact|escalat(?:e|ion)|unresolved)\b/iu.test(text)
    ) {
      return 'CUSTOMER_SUPPORT_ESCALATION';
    }

    if (
      /\b(?:shipment|shipments|shipping|package|packages|parcel|parcels|courier|carrier|logistics|delivery)\b/iu.test(text) &&
      /\b(?:lost in transit|lost package|lost shipment|package gets lost|shipment gets lost|stuck in transit|sitting in .*facility|delivery stalled|shipment stalled|not delivered|missing shipment|missing package|tracking stalled|carrier delay)\b/iu.test(text)
    ) {
      return 'SHIPMENT_EXCEPTION_RECOVERY';
    }

    if (
      /\b(?:online retailers?|online stores?|e-?commerce|orders?|shipments?|shipping|deliver(?:y|ies)|carriers?|warehouses?)\b/iu.test(text) &&
      /\b(?:fraudulent delivery claims?|false delivery claims?|account misuse|account abuse|account takeover|unauthorized (?:shipping|delivery) (?:information|address) changes?|shipping address changes?|carrier scans?|delivery confirmations?|proof of delivery|refund abuse|lost merchandise|order disputes?|delivery disputes?)\b/iu.test(text)
    ) {
      return 'ORDER_DELIVERY_DISPUTE_INTEGRITY';
    }

    if (
      /\b(?:government agencies?|government departments?|public sector agencies?|public authorities?|regulatory agencies?|licensing authorities?)\b/iu.test(text) &&
      /\b(?:legal records?|licensing documents?|citizen applications?|regulatory files?|official records?|public records?|permit records?|case files?)\b/iu.test(text) &&
      /\b(?:unauthorized access|unauthorised access|manipulation|tamper(?:ing|ed)?|access logs?|document histor(?:y|ies)|employee activity|security alerts?|suspicious changes?|who accessed|accessed critical information|incident investigation|audit trail)\b/iu.test(text)
    ) {
      return 'GOVERNMENT_RECORD_ACCESS_INTEGRITY';
    }

    if (
      /\b(?:fraud|fraudulent|suspicious transaction|unusual payment|unauthorized account|account takeover|security alerts?|identity checks?|identity verification)\b/iu.test(text) &&
      /\b(?:payment|payments|transaction|transactions|taxes?|permits?|benefits?|fees?|financial)\b/iu.test(text)
    ) {
      return 'FRAUD_INTEGRITY';
    }

    if (
      /\b(?:cities|city governments?|municipalities|municipal governments?|smart cities|urban infrastructure operators?|city infrastructure teams?)\b/iu.test(text) &&
      /\b(?:public buildings?|municipal buildings?|street lighting|streetlights?|charging stations?|ev charging|electric vehicle charging|urban infrastructure)\b/iu.test(text) &&
      /\b(?:electricity demand|energy demand|energy consumption|power demand|peak demand|peak load|high usage|consumption patterns?|energy efficiency)\b/iu.test(text) &&
      /\b(?:equipment status|weather conditions?|service demand|consumption data|demand forecast|forecasting|overloaded infrastructure|service interruptions?|energy costs?)\b/iu.test(text)
    ) {
      return 'URBAN_ENERGY_DEMAND_INTELLIGENCE';
    }

    if (
      /\b(?:urban transportation agencies?|transportation agencies?|transit agencies?|city transport(?:ation)? departments?|municipal transport(?:ation)?|public transport(?:ation)? authorities?|urban mobility agencies?)\b/iu.test(text) &&
      /\b(?:traffic flow|traffic congestion|public transit demand|transit demand|road incidents?|travel times?|travel time reliability|route performance|peak hours?|time periods?|bottlenecks?)\b/iu.test(text) &&
      /\b(?:vehicle emissions?|fuel consumption|air quality|environmental measurements?|longer journeys?|longer travel times?|transportation improvements?|poor use of transportation resources)\b/iu.test(text)
    ) {
      return 'URBAN_MOBILITY_CONGESTION_EMISSIONS';
    }

    if (
      /\b(?:energy providers?|electric utilities?|power utilities?|utility companies?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid)\b/iu.test(text) &&
      /\b(?:connected meters?|smart meters?|remote monitoring devices?|automated control systems?|device failures?|meter failures?|unusual consumption|consumption anomalies?|network disruptions?|unauthorized access|malicious interference|telemetry|consumption data integrity|incident response)\b/iu.test(text)
    ) {
      return 'ENERGY_IOT_INCIDENT_ATTRIBUTION';
    }

    if (
      /\b(?:independent doll restoration specialists?|doll restoration specialists?|doll restorers?|doll restoration studios?|doll restoration workshops?|antique doll restorers?|doll repair specialists?)\b/iu.test(text) &&
      /\b(?:damage photographs?|damage photos?|fabric selections?|replacement parts?|paint matching|restoration notes?|approved restoration|material samples?|physical samples?|completion dates?|incorrect replacements?|mismatched materials?|repeated work|lost details|delayed customer orders?)\b/iu.test(text)
    ) {
      return 'DOLL_RESTORATION_SPECIFICATION';
    }

    if (
      /\b(?:healthcare facilities?|hospitals?|clinics?|medical centers?|health systems?)\b/iu.test(text) &&
      /\b(?:medical waste|clinical waste|healthcare waste|disposal records?|waste disposal|expired supplies?|expiration dates?|unused supplies?|supply usage|environmental footprint|disposal costs?)\b/iu.test(text) &&
      /\b(?:reduce|reduction|waste|disposal|expiration|expired|unused|environmental|sustainability|purchasing|procurement)\b/iu.test(text)
    ) {
      return 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION';
    }

    if (
      /\b(?:marketplace|marketplaces|e-?commerce|online marketplace|seller|sellers|listing|listings|buyer|buyers)\b/iu.test(text) &&
      /\b(?:seller risk|listing risk|seller trust|listing trust|fraud|fraudulent|fake seller|suspicious listing|misleading listing|dispute evidence|pre[- ]purchase risk|assess seller)\b/iu.test(text)
    ) {
      return 'MARKETPLACE_SELLER_TRUST';
    }

    if (
      /\b(?:public healthcare agencies?|public health agencies?|health departments?|health authorities?|healthcare agencies?|hospitals?|clinics?)\b/iu.test(text) &&
      /\b(?:rising demand|service demand|healthcare demand|medical service demand|appointment volumes?|emergency visits?|regional health reports?|community healthcare needs?|community health needs?|hospitals? become overloaded|clinics? become overloaded|capacity pressure|waiting times?|resource availability|resource distribution|staff shortages?|demand forecasting|surge detection)\b/iu.test(text)
    ) {
      return 'PUBLIC_HEALTH_DEMAND_CAPACITY';
    }

    if (
      /\b(?:manufacturing|manufacturer|factory|factories|industrial plants?|production lines?|plant engineers?|plant maintenance)\b/iu.test(text) &&
      /\b(?:machine|machines|machinery|industrial equipment|equipment sensors?|sensor feeds?|electricity usage|energy consumption|power draw|operating hours?|maintenance records?|equipment condition|machine efficiency|mechanical efficiency)\b/iu.test(text) &&
      /\b(?:abnormal|unusually high|energy anomal|consumption spike|losing efficiency|efficiency loss|equipment condition|predictive maintenance|impending failure|breakdown|downtime|production interruption|unnecessary maintenance|electricity costs?)\b/iu.test(text)
    ) {
      return 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH';
    }

    if (
      /\b(?:manufacturing|manufacturer|factory|factories|industrial plant|production line)\b/iu.test(text) &&
      /\b(?:material waste|scrap|raw material consumption|yield loss|defects?|rework|emissions?|environmental impact)\b/iu.test(text) &&
      /\b(?:material|scrap|yield|defect|rework|waste|emission|environmental)\b/iu.test(text)
    ) {
      return 'MANUFACTURING_WASTE_SUSTAINABILITY';
    }

    if (
      /\b(?:temperature|humidity|air quality|water usage|water use|sensor readings?|equipment readings?|environmental performance|environmental conditions?)\b/iu.test(text) &&
      /\b(?:building|buildings|residential|property|properties|complex|complexes|facility|facilities)\b/iu.test(text)
    ) {
      return 'ENVIRONMENTAL_MONITORING';
    }

    if (
      /\b(?:logistics companies?|logistics providers?|logistics operators?|third[- ]party logistics|3pl providers?|freight companies?|freight operators?|delivery operators?|parcel carriers?|distribution operators?|supply chain operators?)\b/iu.test(text) &&
      /\b(?:fuel expenses?|fuel costs?|warehouse costs?|warehousing costs?|failed deliveries?|delivery failures?|vehicle maintenance|maintenance costs?|route performance|route profitability|customer penalties?|delivery penalties?|penalty costs?|shipment volumes?|delivery volumes?|cost per shipment|cost per delivery)\b/iu.test(text) &&
      /\b(?:profit margins?|profitability|margin erosion|operating costs?|operating expenses?|pricing decisions?|financial forecasts?|reducing profit|reduce profit|become more expensive|cost increase|costs increase)\b/iu.test(text)
    ) {
      return 'COST_PERFORMANCE_INTELLIGENCE';
    }

    if (
      /\b(?:fuel consumption|fuel usage|fuel costs?|emissions?|carbon|mileage|vehicle routes?|route planning|failed delivery attempts?)\b/iu.test(text) &&
      /\b(?:delivery|courier|fleet|shipping|parcel|last[- ]mile)\b/iu.test(text)
    ) {
      return 'ROUTING_SUSTAINABILITY';
    }

    if (
      /\b(?:ai hallucination(?:s)?|model hallucination(?:s)?|hallucinat(?:e|es|ed|ing|ion|ions)|fabricated? (?:facts?|answers?|citations?|sources?)|made[- ]up (?:facts?|answers?|citations?|sources?)|invented (?:facts?|answers?|citations?|sources?)|false citations?|wrong facts?|incorrect facts?|unsupported claims?|unreliable (?:ai )?(?:outputs?|answers?|responses?)|output reliability|factuality failure|grounding failure)\b/iu.test(text) &&
      /\b(?:ai|artificial intelligence|llm|large language model|model|chatbot|assistant|prompt|response|output|citation|source|factuality|grounding)\b/iu.test(text)
    ) {
      return 'AI_HALLUCINATION_OUTPUT_RELIABILITY';
    }

    if (
      /\b(?:transaction reverted|transaction revert|execution reverted|execution revert|reverted without (?:a )?reason(?: string)?|revert reason|providererror|provider error|failed transaction|transaction failed|transaction status (?:is |was )?failed|status (?:is |was )?always failed|smart contract (?:call|transaction|execution) (?:failed|fails|reverted)|gas estimation failed|cannot estimate gas|evm revert)\b/iu.test(text) &&
      /\b(?:blockchain|smart contract|contract|web3|hardhat|alchemy|goerli|ethereum|evm|solidity|transaction)\b/iu.test(text)
    ) {
      return 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY';
    }

    if (
      /\b(?:workforce capacity and staffing continuity constraints?|workforce reductions?|staff cuts?|employee cuts?|staff shortages?|employee shortages?|worker shortages?|personnel shortages?|headcount loss|headcount reduction|understaffed|hiring freeze|layoffs?|turnover|vacancies|critical[- ]role coverage|service continuity)\b/iu.test(text)
    ) {
      return 'WORKFORCE_CAPACITY_CONTINUITY';
    }

    if (
      /\b(?:violin bow|bow technician|bow technicians|bow maker|bow makers|archetier|archetiers|bow rehair|rehairing)\b/iu.test(text) &&
      /\b(?:service history|rehair(?:ing)? dates?|hair type|grip|winding|repair notes?|customer preferences?|bow condition|previous service)\b/iu.test(text)
    ) {
      return 'SERVICE_HISTORY';
    }

    if (
      /\b(?:fountain pen|fountain pens|fountain pen repair specialists?|pen repair specialists?|nib technicians?|nibmeisters?)\b/iu.test(text) &&
      /\b(?:service history|repair history|previous repairs?|nib adjustments?|ink[- ]?flow problems?|replacement parts?|writing preferences?|restoration requests?|pen condition)\b/iu.test(text)
    ) {
      return 'SERVICE_HISTORY';
    }

    if (
      requestProfile.family !== 'FOOD_STORAGE_CONDITION' &&
      /\b(?:restaurants?|restaurant chains?|commercial kitchens?|restaurant operations?)\b/iu.test(text) &&
      requestProfile.explicitFinancialIntent &&
      /\b(?:daily sales|revenue|profit margins?|food costs?|labor costs?|staffing costs?|supplier prices?|budget|financial performance|pricing decisions?)\b/iu.test(text)
    ) {
      return 'COST_PERFORMANCE_INTELLIGENCE';
    }

    if (
      requestProfile.family !== 'RESTORATION_CONSERVATION' &&
      /\b(?:approved|approval|revision|version|preference|preferences|measurement|measurements|specification|specifications|formula|formulas|color|colour|stain|finish|treatment|design|sample|samples|material|materials|ingredient|ingredients)\b/iu.test(text) &&
      /\b(?:client|customer|order|orders|workshop|workshops|maker|makers|studio|studios|shop|shops|custom|piece|pieces|project|projects)\b/iu.test(text)
    ) {
      return 'SPECIFICATION_VERSIONING';
    }

    if (
      /\b(?:history|service history|maintenance history|previous repairs?|replaced parts?|visit history|follow[- ]up|treatment history)\b/iu.test(text)
    ) {
      return 'SERVICE_HISTORY';
    }

    if (
      /\b(?:workload|staffing|assignment|assignments|availability|scheduling conflicts?|course staffing|teaching load|shift assignment)\b/iu.test(text)
    ) {
      return 'STAFFING_PLANNING';
    }

    if (
      /\b(?:workday mental health time[- ]access constraints?|mental health time[- ]access constraints?|taking time for mental health|time for mental health|protected recovery time|recovery[- ]time access|self[- ]care time|wellness break|recovery break|short recovery break)\b/iu.test(text) &&
      /\b(?:workday|workplace|time|schedule|afford|access|break|recovery|self[- ]care|mental health|wellness)\b/iu.test(text)
    ) {
      return 'TIME_ACCESS_RECOVERY_PLANNING';
    }

    if (
      /\b(?:data sync|data synchronization|synchroni[sz](?:e|ed|es|ing|ation)?|sync(?:ed|ing)?|firestore|remote db|remote database|background sync|foreground sync|refresh latency|stale data|data freshness|up to date)\b/iu.test(text) &&
      /\b(?:data|records?|lists?|restaurants?|catalog|inventory|database|db|firestore|remote|fresh|freshness|stale|up to date|refresh|sync|synchroni[sz])\b/iu.test(text)
    ) {
      return 'DATA_SYNC_FRESHNESS_RECOVERY';
    }

    if (featureCapability) {
      return 'FEATURE_CAPABILITY_DELIVERY';
    }

    if (
      /\b(?:healthcare access|health care access|service access|access challenge|access barrier|access barriers|access to care|waiting times?|wait times?|availability|resource shortage|resource shortages|staff shortage|staff shortages|capacity pressure|capacity gap|capacity gaps|overloaded|overload|underserved|service shortage|service shortages|demand pressure)\b/iu.test(text)
    ) {
      return 'ACCESS_CAPACITY_PLANNING';
    }

    if (
      /\b(?:fraudsters?|felons?|scam|scams|deception|misconduct|integrity risk|trust risk|vendor risk|supplier risk|third[- ]party risk|abuse|abusive|unsafe|suspicious|assumed names?|fake (?:company|companies|identity|identities|claims?|records?|credentials?)|zero[- ]day|vulnerabilit(?:y|ies)|offensive security|conflict of interest|conflicts of interest|due diligence)\b/iu.test(text)
    ) {
      return 'RISK_INTEGRITY_REVIEW';
    }

    if (
      /\b(?:data visualization shape and reactive plotting errors?|reactive plotting errors?|ggplot2?|shiny|renderplot|plotoutput|geom_line|aesthetics must be either length)\b/iu.test(text) &&
      /\b(?:plot|plots|plotting|graph|graphs|chart|charts|aesthetics|reactive|observe|renderplot|plotoutput|ggplot2?|shiny|multiple lines|series)\b/iu.test(text)
    ) {
      return 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS';
    }

    if (
      /\b(?:app|application|software|program|process|service|server|client|browser|tab|mobile app|web app|desktop app)\b[^.!?]{0,100}\b(?:crash(?:es|ed|ing)?|freeze|frozen|unresponsive)\b|\b(?:crash(?:es|ed|ing)?|freeze|frozen|unresponsive)\b[^.!?]{0,100}\b(?:app|application|software|program|process|service|server|client|browser|tab|mobile app|web app|desktop app)\b|\b(?:runtime error|runtime failure|exception|segfault|terminated unexpectedly)\b/iu.test(text)
    ) {
      return 'INCIDENT_EXCEPTION_RESOLUTION';
    }

    const strongFinancialIntent =
      /\b(?:profitability|profit|profits|margin|margins|revenue|revenues|budget|budgets|financial performance|financial forecast|financial forecasting|forecast error|pricing decision|pricing decisions|return on investment|roi)\b/iu.test(text);
    const multiFinancialCostIntent =
      /\b(?:cost|costs|expense|expenses|overspend|overspending|spend|spending)\b/iu.test(text) &&
      /\b(?:variance|budget|forecast|pricing|profit|margin|revenue|financial)\b/iu.test(text);
    if (strongFinancialIntent || multiFinancialCostIntent) {
      return 'COST_PERFORMANCE_INTELLIGENCE';
    }

    if (
      /\b(?:compliance|regulatory|regulation|regulations|legal requirement|legal requirements|policy|policies|governance|audit|auditing|contract|contracts|licensing|license|licence|permit|permits|retention|consent|recordkeeping|record keeping)\b/iu.test(text)
    ) {
      return 'COMPLIANCE_GOVERNANCE_REVIEW';
    }

    if (
      /\b(?:incident|incidents|outage|outages|disruption|disruptions|exception|exceptions|anomaly|anomalies|breach|breaches|attack|attacks|downtime|service interruption|service interruptions|blocked workflow|operational failure|operational failures|system failure|system failures|app crash|application crash|software crash|runtime error|runtime failure|crashing|freeze|frozen|unresponsive)\b/iu.test(text)
    ) {
      return 'INCIDENT_EXCEPTION_RESOLUTION';
    }

    if (
      /\b(?:quality|reliability|accuracy|inaccuracy|inaccurate|error|errors|defect|defects|inconsistent|inconsistency|mistake|mistakes|rework|repeat work|performance issue|performance issues)\b/iu.test(text)
    ) {
      return 'QUALITY_RELIABILITY_IMPROVEMENT';
    }

    const validationOnlyDirection =
      /\b(?:validation[- ]first opportunity|validation hypothesis|no external problem evidence|no direct community evidence|no independent community evidence|collect direct evidence|problem discovery, validation)\b/iu.test(
        text,
      );

    if (enableEvidenceDerivedProblemWorkflow && !validationOnlyDirection) {
      return 'PROBLEM_SPECIFIC_OPERATIONAL';
    }

    return 'EVIDENCE_DECISION_REVIEW';
  }

  private static resolveCategoryFromProblemFamily(problemFamilyKey: string | null) {
    switch ((problemFamilyKey ?? '').trim().toLocaleLowerCase()) {
      case 'authentication':
        return 'AUTH_ACCESS_RECOVERY' as const;
      case 'application-access-support':
        return 'PROBLEM_SPECIFIC_OPERATIONAL' as const;
      case 'delivery-tracking':
      case 'shipment-transit-metrics':
        return 'SHIPMENT_EXCEPTION_RECOVERY' as const;
      case 'outage-reliability':
      case 'crash-runtime':
      case 'runtime-crash':
        return 'INCIDENT_EXCEPTION_RESOLUTION' as const;
      case 'data-visualization-reactive':
        return 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS' as const;
      case 'energy-grid-stability-inverter-trip':
        return 'INCIDENT_EXCEPTION_RESOLUTION' as const;
      case 'healthcare-preventive-care-reminders':
        return 'ACCESS_CAPACITY_PLANNING' as const;
      case 'medication-adherence-coordination':
      case 'ai-feedback-correction-inflexibility':
        return 'PROBLEM_SPECIFIC_OPERATIONAL' as const;
      case 'ai-hallucination-output-reliability':
        return 'AI_HALLUCINATION_OUTPUT_RELIABILITY' as const;
      case 'blockchain-transaction-execution':
        return 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY' as const;
      case 'workforce-capacity':
        return 'WORKFORCE_CAPACITY_CONTINUITY' as const;
      case 'legal-compliance-risk':
        return 'COMPLIANCE_GOVERNANCE_REVIEW' as const;
      case 'device-sync':
      case 'blockchain-wallet-state-sync':
      case 'streaming-data-integrity':
        return 'DATA_SYNC_FRESHNESS_RECOVERY' as const;
      case 'marketplace-trust-safety':
        return 'MARKETPLACE_SELLER_TRUST' as const;
      default:
        return null;
    }
  }

  private static resolveProblemSpecificTitleFragment(
    opportunityDescription: string,
    workflowTerms: readonly string[],
    baseLabel: string,
  ): string {
    const baseTokens = new Set(
      this.normalize(baseLabel)
        .toLocaleLowerCase()
        .split(/\s+/u)
        .filter(Boolean),
    );
    const raw = this.normalize(opportunityDescription)
      .replace(/\b(?:validation[- ]first opportunity|opportunity)\b/giu, ' ')
      .replace(/\b(?:failures?|constraints?|challenges?|problems?|issues?|gaps?)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const filtered = raw
      .split(/\s+/u)
      .filter((token) => !baseTokens.has(token.toLocaleLowerCase()))
      .slice(0, 5)
      .join(' ')
      .trim();

    const fallback = workflowTerms
      .flatMap((value) => value.split(/\s+/u))
      .filter((token) => !baseTokens.has(token.toLocaleLowerCase()))
      .slice(0, 5)
      .join(' ')
      .trim();

    return this.toTitleCase(filtered || fallback || 'Problem Response');
  }

  private static resolveBaseLabel(
    actor: string,
    domainName: string,
    description: string,
  ): string {
    const actorLabel = this.cleanActorLabel(actor);
    if (actorLabel) return actorLabel;

    const domainLabel = this.cleanDomainLabel(domainName);
    if (domainLabel) return domainLabel;

    const firstTerms = RequestDynamicQueryUtil.extractWorkflowTerms(description)
      .flatMap((value) => value.split(/\s+/u))
      .filter((value) => value.length >= 4)
      .slice(0, 3);
    return this.toTitleCase(firstTerms.join(' ') || 'Operational');
  }

  private static cleanActorLabel(value: string): string {
    const normalized = this.normalize(value)
      .replace(/\b(?:independent|small|local|large|many|some)\b/giu, ' ')
      .replace(/\b(?:companies?|businesses?|providers?|operators?|teams?|departments?|specialists?)\b/giu, ' ')
      .replace(/\b(?:workshops?|shops?|studios?)\b/giu, ' ')
      .replace(/\b(?:systems?)\b$/iu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    return normalized ? this.toTitleCase(normalized.split(/\s+/u).slice(0, 4).join(' ')) : '';
  }

  private static cleanDomainLabel(value: string): string {
    return this.toTitleCase(
      this.normalize(value)
        .replace(/\b(?:operations?|management|workflow|platform)\b/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/\s+/u)
        .slice(0, 4)
        .join(' '),
    );
  }

  private static resolveTitle(
    category: ReturnType<typeof this.resolveCategory>,
    baseLabel: string,
    workflowTerms: readonly string[],
    featureCapability: EvidenceFeatureCapabilityProfile | null,
    opportunityDescription: string,
    problemFamilyKey: string | null,
  ): string {
    if (problemFamilyKey === 'delivery-tracking') {
      return `${baseLabel} Shipment Tracking & Delivery Visibility Workspace`.slice(0, 100);
    }
    if (problemFamilyKey === 'energy-grid-stability-inverter-trip') {
      return `${baseLabel} Grid Stability & Inverter Resilience Workspace`.slice(0, 100);
    }
    if (problemFamilyKey === 'healthcare-preventive-care-reminders') {
      return `${baseLabel} Preventive Care Follow-Up & Screening Workspace`.slice(0, 100);
    }
    if (problemFamilyKey === 'medication-adherence-coordination') {
      return `${baseLabel} Medication Adherence & Caregiver Coordination Workspace`.slice(0, 100);
    }
    if (problemFamilyKey === 'outage-reliability') {
      return `${baseLabel} Service Reliability & Outage Recovery Workspace`.slice(0, 100);
    }

    switch (category) {
      case 'FRAUD_INTEGRITY':
        return `${baseLabel} Fraud Signal Correlation Workspace`.slice(0, 100);
      case 'ORDER_DELIVERY_DISPUTE_INTEGRITY':
        return 'Order Delivery Dispute & Shipment Integrity Hub';
      case 'SHIPMENT_EXCEPTION_RECOVERY':
        return 'Shipment Exception & Delivery Recovery Workspace';
      case 'ECOMMERCE_MARGIN_PROFITABILITY':
        return 'Retail Margin Attribution & Profitability Intelligence Hub';
      case 'TOURISM_PROFITABILITY_INTELLIGENCE':
        return 'Tourism Profitability & Revenue Intelligence Hub';
      case 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE':
        return 'Subscription Churn, Retention & Revenue Intelligence Workspace';
      case 'SUBSCRIPTION_ACCESS_REFUND':
        return `${baseLabel} Subscription Access & Refund Resolution Workspace`.slice(0, 100);
      case 'CUSTOMER_SUPPORT_ESCALATION':
        return `${baseLabel} Customer Support Escalation & Service Recovery Workspace`.slice(0, 100);
      case 'ACCESS_CAPACITY_PLANNING':
        return `${baseLabel} Access Barrier & Capacity Planning Workspace`.slice(0, 100);
      case 'RISK_INTEGRITY_REVIEW': {
        const riskContext = workflowTerms.join(' ').toLocaleLowerCase();
        return /(?:zero[- ]day|vulnerabilit|vendor|supplier|third[- ]party)/u.test(riskContext)
          ? `${baseLabel} Vendor Risk & Integrity Review Workspace`.slice(0, 100)
          : `${baseLabel} Risk & Integrity Review Workspace`.slice(0, 100);
      }
      case 'MUNICIPAL_WASTE_COORDINATION':
        return 'Municipal Waste Collection Coordination & Routing Workspace';
      case 'COST_PERFORMANCE_INTELLIGENCE':
        return `${baseLabel} Cost & Profitability Intelligence Workspace`.slice(0, 100);
      case 'COMPLIANCE_GOVERNANCE_REVIEW':
        return `${baseLabel} Compliance Evidence & Governance Review Workspace`.slice(0, 100);
      case 'INCIDENT_EXCEPTION_RESOLUTION':
        return `${baseLabel} Incident Triage & Exception Resolution Workspace`.slice(0, 100);
      case 'QUALITY_RELIABILITY_IMPROVEMENT':
        return `${baseLabel} Quality & Reliability Improvement Workspace`.slice(0, 100);
      case 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS':
        return `${baseLabel} Data Visualization & Reactive Plot Diagnostics Workspace`.slice(0, 100);
      case 'FEATURE_CAPABILITY_DELIVERY':
        return `${baseLabel} ${featureCapability?.titleFragment ?? 'Requested Capability'} Workspace`.slice(0, 100);
      case 'TIME_ACCESS_RECOVERY_PLANNING':
        return `${baseLabel} Time-Access & Recovery Planning Workspace`.slice(0, 100);
      case 'AI_HALLUCINATION_OUTPUT_RELIABILITY':
        return `${baseLabel} Hallucination & Output Reliability Workspace`.slice(0, 100);
      case 'DATA_SYNC_FRESHNESS_RECOVERY':
        return `${baseLabel} Data Synchronization & Freshness Recovery Workspace`.slice(0, 100);
      case 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY':
        return `${baseLabel} Transaction Failure Diagnosis & Recovery Workspace`.slice(0, 100);
      case 'PROBLEM_SPECIFIC_OPERATIONAL': {
        const problemFragment = this.resolveProblemSpecificTitleFragment(
          opportunityDescription,
          workflowTerms,
          baseLabel,
        );
        return `${baseLabel} ${problemFragment} Response Workspace`.slice(0, 100);
      }
      case 'EVIDENCE_DECISION_REVIEW':
        return `${baseLabel} Evidence Triage & Decision Workspace`.slice(0, 100);
      case 'GOVERNMENT_RECORD_ACCESS_INTEGRITY':
        return 'Government Record Access & Integrity Investigation Hub';
      case 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY':
        return `${baseLabel} Account Security & Assessment Integrity Workspace`.slice(0, 100);
      case 'IDENTITY_ACCESS_GOVERNANCE':
        return `${baseLabel} Identity Access Governance Workspace`.slice(0, 100);
      case 'ACCOUNT_SECURITY_MONITORING':
        return `${baseLabel} Account Security & Access Investigation Workspace`.slice(0, 100);
      case 'AUTH_ACCESS_RECOVERY':
        return `${baseLabel} Account Access Recovery & Decision Workspace`.slice(0, 100);
      case 'CYBERSECURITY_LEARNING_CONTENT_SAFETY':
        return 'Cybersecurity Learning Content Safety Review Workspace';
      case 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION':
        return 'Healthcare Medical Waste & Supply Sustainability Intelligence Hub';
      case 'MARKETPLACE_SELLER_TRUST':
        return 'Marketplace Seller Risk & Listing Trust Review Workspace';
      case 'PUBLIC_HEALTH_DEMAND_CAPACITY':
        return `${baseLabel} Demand & Capacity Early-Warning Hub`.slice(0, 100);
      case 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH':
        return 'Industrial Energy & Equipment Health Intelligence Workspace';
      case 'ENERGY_IOT_INCIDENT_ATTRIBUTION':
        return `${baseLabel} IoT Anomaly & Incident Attribution Hub`.slice(0, 100);
      case 'URBAN_ENERGY_DEMAND_INTELLIGENCE':
        return 'Urban Energy Demand & Infrastructure Intelligence Hub';
      case 'URBAN_MOBILITY_CONGESTION_EMISSIONS':
        return 'Urban Mobility Congestion & Emissions Intelligence Hub';
      case 'DOLL_RESTORATION_SPECIFICATION':
        return `${baseLabel} Treatment & Approval Workspace`.slice(0, 100);
      case 'MANUFACTURING_WASTE_SUSTAINABILITY':
        return `${baseLabel} Waste & Sustainability Intelligence`.slice(0, 100);
      case 'ENVIRONMENTAL_MONITORING': {
        const environmentalContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:noise sensors?|noise pollution|sound level readings?|traffic activity|construction schedules?|citizen complaints?)\b/u.test(environmentalContext)) {
          return 'Urban Noise Pollution & Acoustic Monitoring Workspace';
        }
        return `${baseLabel} Environmental Condition Monitor`.slice(0, 100);
      }
      case 'ROUTING_SUSTAINABILITY':
        return `${baseLabel} Route Efficiency & Emissions Monitor`.slice(0, 100);
      case 'SPECIFICATION_VERSIONING': {
        const specificationContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conserv|paper conserv|document conserv|handwritten annotation|missing pages?)\b/u.test(specificationContext)) {
          return 'Musical Score Restoration Treatment & Record Workspace';
        }
        if (/\bcustom hat\b/u.test(specificationContext)) {
          return 'Custom Hat Specification & Fitting Workspace';
        }
        if (/\bcustom footwear\b/u.test(specificationContext)) {
          return `${baseLabel} Specification & Fitting Workspace`.slice(0, 100);
        }
        if (/\bcustom wig\b/u.test(specificationContext)) {
          return 'Custom Wig Specification & Fitting Workspace';
        }
        const treatment = workflowTerms.some((term) => /\b(?:finish|stain|treatment|restoration|repair)\b/iu.test(term));
        return `${baseLabel} ${treatment ? 'Treatment' : 'Specification'} & Approval Workspace`.slice(0, 100);
      }
      case 'SERVICE_HISTORY': {
        const serviceContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:violin bow|bow condition|rehairing dates?|hair type preferences?)\b/u.test(serviceContext)) {
          return 'Violin Bow Service History & Rehair Management Workspace';
        }
        if (/\b(?:fountain pen|pen condition|nib adjustments?|ink-flow diagnostics|writing preferences?)\b/u.test(serviceContext)) {
          return 'Fountain Pen Service History & Repair Management Workspace';
        }
        return `${baseLabel} Service History & Follow-up Workspace`.slice(0, 100);
      }
      case 'WORKFORCE_CAPACITY_CONTINUITY':
        return `${baseLabel} Workforce Capacity & Service Continuity Workspace`.slice(0, 100);
      case 'STAFFING_PLANNING': {
        const staffingContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:interpreter availability|specialized vocabulary|session notes?|client communication preferences?)\b/u.test(staffingContext)) {
          return `${baseLabel} Assignment & Coordination Workspace`.slice(0, 100);
        }
        return `${baseLabel} Workload & Assignment Planner`.slice(0, 100);
      }
      case 'GENERAL_OPERATIONAL':
        return `${baseLabel} Workflow Coordination Workspace`.slice(0, 100);
    }
  }

  private static resolveWorkflowFocus(
    category: ReturnType<typeof this.resolveCategory>,
    workflowTerms: readonly string[],
    painTerms: readonly string[],
    featureCapability: EvidenceFeatureCapabilityProfile | null,
  ): string {
    const concrete = workflowTerms.slice(0, 4).join(', ');
    const pain = painTerms.slice(0, 2).join(' and ');
    switch (category) {
      case 'FRAUD_INTEGRITY': {
        const fraudContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (
          /\b(?:shipment|shipments|warehouse|warehouses|driver|drivers|tracking updates?|delivery operations?|logistics|freight|cargo)\b/u.test(
            fraudContext,
          )
        ) {
          return 'shipment records, driver access, warehouse-account activity, tracking updates, customer reports, and security alerts correlated for human-reviewed fraud and malicious-activity investigation';
        }
        const governmentFraudContext =
          /\b(?:government|public sector|municipal|tax|permit|benefit|citizen report|citizen reports)\b/u.test(fraudContext);
        return governmentFraudContext
          ? 'transaction, identity, access, security-alert, and citizen-report correlation with human-reviewed fraud investigation'
          : 'transaction, identity, account-access, payment-or-claim, device-or-behavior, and security-alert correlation with human-reviewed fraud investigation';
      }
      case 'ORDER_DELIVERY_DISPUTE_INTEGRITY':
        return 'customer-account, order-change, warehouse-update, carrier-scan, delivery-confirmation, shipping-address, refund, and dispute-event reconstruction for human-reviewed fraud and delivery-claim resolution';
      case 'SHIPMENT_EXCEPTION_RECOVERY':
        return 'shipment status, carrier scans, facility handoffs, delay duration, customer contact, investigation status, and recovery actions for lost, stalled, or missing deliveries';
      case 'ECOMMERCE_MARGIN_PROFITABILITY':
        return 'SKU-level revenue, discount, advertising-spend, return/refund, payment-fee, shipping/fulfillment, campaign, and customer-cohort attribution for contribution-margin analysis and human-reviewed pricing decisions';
      case 'TOURISM_PROFITABILITY_INTELLIGENCE':
        return 'booking revenue, customer spend, service and package margin, discounts, promotional campaigns, cancellations, refunds, operating expenses, seasonality, and demand forecasts for human-reviewed tourism pricing and profitability decisions';
      case 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE':
        return 'subscriber payment, discount, support-interaction, renewal, product-usage, refund, cancellation, churn-risk, pricing-plan profitability, and recurring-revenue forecast signals reconciled for human-reviewed retention and pricing decisions';
      case 'SUBSCRIPTION_ACCESS_REFUND':
        return 'subscription-charge, trial, app/account access, support-contact, refund-request, cancellation, and human-reviewed resolution tracking';
      case 'CUSTOMER_SUPPORT_ESCALATION':
        return 'customer contact attempts, email history, bot responses, phone and live-chat availability, escalation state, human-agent handoff, ownership, SLA deadlines, and resolution status for unresolved support cases';
      case 'ACCESS_CAPACITY_PLANNING':
        return 'service-access barriers, demand and waiting signals, capacity constraints, staff and resource availability, affected-user context, and human-reviewed actions that improve access without overstating prevalence';
      case 'RISK_INTEGRITY_REVIEW':
        return 'risk signals, actor and organization history, supporting claims, vulnerability or misconduct indicators, provenance, conflicts, reviewer findings, and human-reviewed integrity or due-diligence decisions';
      case 'MUNICIPAL_WASTE_COORDINATION':
        return 'neighborhood demand, collection schedules, container fill or capacity, citizen complaints, vehicle location and availability, traffic, route performance, pickup priority, and human-reviewed resource allocation';
      case 'COST_PERFORMANCE_INTELLIGENCE':
        return 'revenue, cost, budget, margin, demand, operational-driver, and forecast evidence reconciled into explainable performance views for human-reviewed planning decisions';
      case 'COMPLIANCE_GOVERNANCE_REVIEW':
        return 'requirements, policies, records, obligations, exceptions, approvals, evidence provenance, and review decisions needed for auditable compliance and governance';
      case 'INCIDENT_EXCEPTION_RESOLUTION':
        return 'incident signals, affected assets or services, timeline, severity, ownership, dependencies, evidence, remediation actions, and human-reviewed closure criteria';
      case 'QUALITY_RELIABILITY_IMPROVEMENT':
        return 'quality signals, defects or errors, process context, recurring failure patterns, corrective actions, ownership, and measurable reliability outcomes';
      case 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS':
        return 'reactive input state, selected series and columns, data shape, x/y/aesthetic mappings, wide-versus-long structure, render dependencies, plotting errors, corrected configuration, and human-reviewed verification of the reproduced chart';
      case 'FEATURE_CAPABILITY_DELIVERY':
        return featureCapability?.workflowFocus ?? 'the explicitly requested capability, its affected workflow, user context, delivery state, and measurable adoption outcomes';
      case 'TIME_ACCESS_RECOVERY_PLANNING':
        return 'workday time constraints, protected recovery windows, short-break availability, workload barriers, recovery-plan ownership, missed recovery opportunities, and human-reviewed escalation when protected time cannot be secured';
      case 'AI_HALLUCINATION_OUTPUT_RELIABILITY':
        return 'prompt and input context, model and version, generated response, factual claims, citations or sources, hallucination and unsupported-claim findings, human-reviewed correction or disposition, recurrence patterns, and verified output-reliability outcomes';
      case 'DATA_SYNC_FRESHNESS_RECOVERY':
        return 'local and remote data state, last successful synchronization, freshness age, app foreground or reopen event, sync latency, failed updates, retry state, and human-reviewed recovery when current data cannot be restored automatically';
      case 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY':
        return 'failed blockchain transaction, transaction hash or receipt, smart-contract address and method, network and provider, revert or provider error, event and console logs, gas or estimation context, failing condition, remediation action, retry verification, and human-reviewed closure';
      case 'PROBLEM_SPECIFIC_OPERATIONAL':
        return `${concrete || 'the exact evidence-backed problem and affected workflow'}, its operating constraints, ownership, response actions, recovery state, and measurable outcome${pain ? ` with explicit handling for ${pain}` : ''}`;
      case 'EVIDENCE_DECISION_REVIEW':
        return `${concrete || 'evidence, problem context, ownership, decision state, and supporting records'} with explicit provenance, uncertainty, human review, and measurable validation outcomes${pain ? ` focused on ${pain}` : ''}`;
      case 'GOVERNMENT_RECORD_ACCESS_INTEGRITY':
        return 'sensitive-record access events, document-version history, employee activity, security alerts, suspicious changes, tamper indicators, and human-reviewed incident reconstruction across legal, licensing, citizen-application, and regulatory records';
      case 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY':
        return 'education learning-platform login activity, assessment-session context, administrative or student account permissions, device identity, security alerts, compromised-account risk, student-record integrity signals, and human-reviewed restriction decisions';
      case 'IDENTITY_ACCESS_GOVERNANCE':
        return 'employee lifecycle events, HR records, identities, roles, permissions, login activity, security alerts, access-review findings, deprovisioning state, and human-reviewed remediation decisions';
      case 'ACCOUNT_SECURITY_MONITORING':
        return 'account identity, authentication and login activity, permissions, device or behavior signals, security alerts, suspicious changes, investigation context, and human-reviewed access decisions';
      case 'AUTH_ACCESS_RECOVERY':
        return 'login, authentication method, two-factor availability, identity-provider, session, account-state, recovery-path, and human-reviewed access restoration';
      case 'CYBERSECURITY_LEARNING_CONTENT_SAFETY':
        return 'course content, video source, security-topic classification, unsafe tutorial indicators, student exposure risk, reviewer decisions, and approved teaching-use context for human-reviewed cybersecurity learning safety';
      case 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION':
        return 'medical-supply usage, treatment volume, expiration risk, disposal reason, department attribution, regulatory constraints, disposal cost, procurement, and environmental-impact signals for human-reviewed waste reduction';
      case 'MARKETPLACE_SELLER_TRUST':
        return 'seller history, listing quality, suspicious listing signals, transaction and dispute history, buyer reports, and evidence snapshots for human-reviewed pre-purchase risk assessment';
      case 'PUBLIC_HEALTH_DEMAND_CAPACITY':
        return 'appointment-volume, emergency-visit, regional-demand, capacity, staffing, waiting-time, and resource-availability signals for early overload detection and human-reviewed resource planning';
      case 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH':
        return 'machine sensor telemetry, electricity usage, operating hours, maintenance history, production schedules, equipment condition, efficiency anomalies, and breakdown signals correlated for human-reviewed maintenance decisions';
      case 'ENERGY_IOT_INCIDENT_ATTRIBUTION':
        return 'smart-meter telemetry, device health, network health, consumption anomalies, access events, and control-system signals for human-reviewed technical-versus-malicious incident attribution';
      case 'URBAN_ENERGY_DEMAND_INTELLIGENCE':
        return 'city electricity-demand, public-building, street-lighting, charging-station, equipment-status, weather, and service-demand signals for peak-load forecasting and human-reviewed urban energy-efficiency planning';
      case 'URBAN_MOBILITY_CONGESTION_EMISSIONS':
        return 'traffic-flow, transit-demand, road-incident, route and time-period travel reliability, fuel-use, emissions, and environmental signals for bottleneck detection and human-reviewed transportation improvement prioritization';
      case 'DOLL_RESTORATION_SPECIFICATION':
        return 'damage assessment, fabric selection, replacement parts, paint matching, restoration notes, material samples, customer approval, and completion-date control for each doll restoration item';
      case 'MANUFACTURING_WASTE_SUSTAINABILITY':
        return 'scrap, machine output, quality defects, raw-material consumption, energy usage, emissions, and production-stage loss attribution';
      case 'ENVIRONMENTAL_MONITORING': {
        const environmentalContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:noise sensors?|noise pollution|sound level readings?|traffic activity|construction schedules?|citizen complaints?)\b/u.test(environmentalContext)) {
          return 'noise-sensor readings, sound levels, location and time context, traffic activity, citizen complaints, construction schedules, persistent hotspot detection, source attribution, and human-reviewed enforcement or urban-planning follow-up';
        }
        return 'environmental readings, equipment signals, abnormal-condition detection, and maintenance follow-up';
      }
      case 'ROUTING_SUSTAINABILITY':
        return 'route, traffic, failed-delivery, mileage, fuel, and emissions comparison';
      case 'SPECIFICATION_VERSIONING': {
        const specificationContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conserv|paper conserv|document conserv|handwritten annotation|missing pages?)\b/u.test(specificationContext)) {
          return 'manuscript condition, missing pages, handwritten annotations, paper characteristics, previous repairs, client instructions, approved treatment versions, restoration progress, and completion tracking';
        }
        if (/\bcustom hat\b/u.test(specificationContext)) {
          return 'head-measurement, material, brim-dimension, color, decoration, fitting-note, revision, approval, and delivery-date control for custom headwear orders';
        }
        if (/\bcustom footwear\b/u.test(specificationContext)) {
          return 'foot-measurement, leather, sole-type, stitching, fitting-note, design-revision, approval, and completion-deadline control for bespoke footwear orders';
        }
        if (/\bcustom wig\b/u.test(specificationContext)) {
          return 'client-measurement, hair-texture, color, cap, styling, fitting, revision, approval, and delivery control for custom wig orders';
        }
        if (/\b(?:scale requirements?|reference images?|paint details?|miniature|model)\b/u.test(specificationContext)) {
          return 'scale, reference-image, material, paint-detail, dimension, revision, final-approval, and completion-deadline control for custom miniature commissions';
        }
        if (/\b(?:mosaic|tile materials?|tile samples?|installation requirements?)\b/u.test(specificationContext)) {
          return 'design-reference, tile-material, color, dimension, installation-requirement, revision, final-approval, and completion-deadline control for custom mosaic commissions';
        }
        return `approved customer specifications, revisions, materials, and completion status${concrete ? ` across ${concrete}` : ''}`;
      }
      case 'SERVICE_HISTORY': {
        const serviceContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:violin bow|bow condition|rehairing dates?|hair type preferences?)\b/u.test(serviceContext)) {
          return 'bow condition, previous rehair dates, hair type preferences, grip and winding details, repair notes, customer requests, and chronological service history for each violin bow';
        }
        if (/\b(?:fountain pen|pen condition|nib adjustments?|ink-flow diagnostics|writing preferences?)\b/u.test(serviceContext)) {
          return 'pen condition, nib adjustments, ink-flow diagnostics, replacement parts, prior repairs, writing preferences, restoration requests, attachments, and chronological service history for each fountain pen';
        }
        return `service history, prior work, recurring issues, and follow-up decisions${concrete ? ` across ${concrete}` : ''}`;
      }
      case 'WORKFORCE_CAPACITY_CONTINUITY':
        return 'workforce levels, vacancies, critical-role coverage, workload redistribution, service-capacity impact, continuity thresholds, replacement priorities, and human-reviewed staffing response';
      case 'STAFFING_PLANNING':
        return `workload, availability, assignments, conflicts, and demand${concrete ? ` across ${concrete}` : ''}`;
      case 'GENERAL_OPERATIONAL':
        return `${concrete || 'the requester-defined operational records and tasks'}${pain ? ` with explicit handling for ${pain}` : ''}`;
    }
  }

  private static resolveFeatures(
    category: ReturnType<typeof this.resolveCategory>,
    workflowTerms: readonly string[],
    painTerms: readonly string[],
    featureCapability: EvidenceFeatureCapabilityProfile | null,
  ): string[] {
    const terms = workflowTerms.slice(0, 6);
    const termSummary = terms.join(', ');
    const painSummary = painTerms.slice(0, 3).join(', ');

    switch (category) {
      case 'FRAUD_INTEGRITY': {
        const fraudContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (
          /\b(?:shipment|shipments|warehouse|warehouses|driver|drivers|tracking updates?|delivery operations?|logistics|freight|cargo)\b/u.test(
            fraudContext,
          )
        ) {
          return [
            'Unified shipment-record, driver-access, warehouse-account, tracking-update, customer-report, and security-alert timeline',
            'Cross-system anomaly correlation that distinguishes operational exceptions from suspicious shipment or account changes without autonomous blocking',
            'Human-reviewed logistics investigation queue with evidence provenance, false-positive disposition, ownership, and case milestones',
            'Linked shipment and warehouse activity history for coordinated-pattern review across delivery and fulfillment operations',
            'Pilot metrics for alert triage time, false-positive investigations, unauthorized-change resolution, delivery disruption, and unresolved cases',
          ];
        }
        const governmentFraudContext =
          /\b(?:government|public sector|municipal|tax|permit|benefit|citizen report|citizen reports)\b/u.test(fraudContext);
        return governmentFraudContext
          ? [
              'Unified transaction, identity-check, account-access, security-alert, and citizen-report timeline',
              'Cross-service anomaly correlation across taxes, permits, benefits, fees, and related payment events',
              'Human-reviewed fraud case queue with evidence provenance, false-positive disposition, and investigation milestones',
              'Linked account and transaction signal history for coordinated-pattern review without autonomous blocking',
              'Pilot metrics for investigation age, false-positive review, blocked-legitimate-payment recovery, and unresolved cases',
            ]
          : [
              'Unified transaction, identity, account-access, payment-or-claim, device-or-behavior, and security-alert timeline',
              'Cross-system anomaly correlation that keeps billing/payment and account-security signals together without autonomous blocking',
              'Human-reviewed fraud case queue with evidence provenance, false-positive disposition, ownership, and investigation milestones',
              'Linked account, payment-or-claim, login, device, and alert history for coordinated-pattern review',
              'Pilot metrics for investigation age, false-positive restrictions, financial-loss exposure, and unresolved cases',
            ];
      }
      case 'ECOMMERCE_MARGIN_PROFITABILITY':
        return [
          'Unified SKU and campaign profitability ledger combining gross sales, discounts, advertising spend, returns/refunds, payment fees, shipping and fulfillment costs, and attributable customer behavior',
          'Contribution-margin attribution by product, campaign, channel, and customer cohort with transparent cost components instead of top-line revenue alone',
          'Margin-change diagnostics that highlights whether discounting, ad spend, return rate, payment fees, shipping cost, or mix shifts explain the movement',
          'Human-reviewed pricing and promotion scenario comparison with explicit assumptions and no autonomous price changes',
          'Pilot metrics for contribution margin, campaign profit, return-cost impact, ad-spend efficiency, shipping-cost burden, and time to explain margin changes',
        ];
      case 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE':
        return [
          'Unified subscriber timeline combining subscription payments, discount usage, support interactions, renewal history, product usage, refunds, and cancellation events',
          'Explainable churn-signal review that highlights behavior changes associated with non-renewal or cancellation without treating prediction as an automatic customer decision',
          'Pricing-plan profitability and discount-impact view linking recurring revenue, refunds, incentives, usage, and renewal outcomes',
          'Human-reviewed retention-offer workspace with customer context, reason codes, proposed action, outcome tracking, and no autonomous discounting',
          'Pilot metrics for churn rate, renewal rate, retention-offer conversion, discount-cost impact, plan contribution margin, and recurring-revenue forecast error',
        ];
      case 'SUBSCRIPTION_ACCESS_REFUND':
        return [
          'Subscription and charge case record linking trial status, charge events, app/account access state, support-contact attempts, refund request, and cancellation status',
          'Access-blocker triage that distinguishes update requirements, login/account issues, payment state, and support-channel availability',
          'Human-reviewed refund and cancellation workflow with evidence, ownership, status, deadlines, and escalation history',
          'Customer-visible resolution timeline that preserves what was charged, what access blocker occurred, and what action remains pending',
          'Pilot metrics for refund resolution time, blocked-support cases, repeated contacts, unresolved charges, and abandoned refund requests',
        ];
      case 'CUSTOMER_SUPPORT_ESCALATION':
        return [
          'Unified support-case timeline combining email and message attempts, bot or automated replies, phone and live-chat availability, prior escalation events, ownership, and current resolution status',
          'Escalation triage that detects repeated contacts, bot-only loops, unavailable human channels, missing responses, overdue cases, and unresolved requests without inventing customer-service outcomes',
          'Human-agent handoff queue with explicit owner, priority, reason for escalation, SLA deadline, supporting conversation history, and reviewer-visible next action',
          'Channel-availability and contact-history view that shows which support routes were attempted, which responses were automated, and where a human response is still required',
          'Pilot metrics for first human response time, escalation lead time, resolution time, repeated support contacts, bot-only loops, and unresolved support cases',
        ];
      case 'ACCESS_CAPACITY_PLANNING':
        return [
          'Access-barrier registry linking the affected service or population, wait or availability signal, capacity constraint, location or channel context, and evidence provenance',
          'Demand-versus-capacity view comparing service requests, waiting indicators, staff coverage, resource availability, throughput, and unresolved access constraints',
          'Barrier segmentation that distinguishes capacity, staffing, scheduling, geographic, channel, eligibility, and process constraints instead of collapsing every access problem into one generic queue',
          'Human-reviewed improvement planning with owner, proposed intervention, evidence strength, dependency, expected operational effect, and follow-up status',
          'Pilot metrics for access delay, waiting-time direction, capacity pressure, unresolved barriers, resource coverage, and intervention follow-up',
        ];
      case 'RISK_INTEGRITY_REVIEW':
        return [
          'Risk dossier linking organizations or actors, claims, vulnerability or misconduct indicators, prior events, source provenance, conflicts, and reviewer notes',
          'Evidence comparison view that separates verified facts, allegations, secondary reporting, direct evidence, and unresolved uncertainty before any integrity conclusion is recorded',
          'Risk-pattern triage for suspicious identity, ownership, behavior, vendor, vulnerability, abuse, or trust signals with explicit severity and confidence',
          'Human-reviewed due-diligence decision record with rationale, required follow-up, escalation owner, disposition, and immutable audit history',
          'Pilot metrics for review lead time, unresolved high-risk findings, evidence completeness, false-positive dispositions, and follow-up closure',
        ];
      case 'MUNICIPAL_WASTE_COORDINATION':
        return [
          'Neighborhood collection board combining pickup schedule, container fill or capacity, open citizen complaints, disposal pattern, and service priority in one operational view',
          'Municipal fleet map linking available collection vehicles, current location, route status, traffic conditions, and assigned neighborhoods without treating unrelated logistics shipments as evidence',
          'Priority recommendation queue that highlights containers or neighborhoods needing earlier pickup or additional resources, with the contributing signals visible for dispatcher review',
          'Human-reviewed route and resource planning workflow that records accepted, modified, or rejected pickup recommendations and preserves the operational rationale',
          'Pilot metrics for container overflow incidents, unnecessary collection trips, route completion, complaint backlog, vehicle utilization, and operating-cost direction',
        ];
      case 'COST_PERFORMANCE_INTELLIGENCE':
        return [
          'Performance ledger reconciling revenue, direct and indirect costs, budget items, demand drivers, operational activity, and time period into one traceable view',
          'Driver attribution showing which products, services, teams, channels, assets, or periods explain margin, cost, revenue, or forecast variance',
          'Scenario comparison for human-reviewed budget, resource, pricing, or operational changes using explicit assumptions rather than autonomous decisions',
          'Variance and anomaly review with source provenance, owner, explanation status, and follow-up action',
          'Pilot metrics for margin or cost variance, forecast error, unexplained spend, decision lead time, and realized performance direction',
        ];
      case 'COMPLIANCE_GOVERNANCE_REVIEW':
        return [
          'Requirement-to-evidence register linking obligations, policies, records, controls, owners, dates, and supporting source material',
          'Exception and gap review that distinguishes missing evidence, overdue obligations, policy conflicts, approval gaps, and unresolved compliance questions',
          'Human-reviewed governance workflow with reviewer assignment, rationale, approval or remediation state, due date, and immutable decision history',
          'Change-impact view connecting policy, regulation, contract, record, or control changes to affected workflows and required follow-up',
          'Pilot metrics for unresolved compliance gaps, evidence completeness, review lead time, overdue actions, and repeat exceptions',
        ];
      case 'INCIDENT_EXCEPTION_RESOLUTION':
        return [
          'Incident timeline combining the triggering signal, affected asset or service, severity, dependencies, evidence, ownership, and status changes',
          'Exception triage that separates outage, disruption, anomaly, failure, security, process, and dependency causes before remediation is approved',
          'Human-reviewed remediation workflow with next action, owner, escalation path, verification evidence, and closure criteria',
          'Recurring-pattern comparison across incidents to expose repeated causes, unresolved dependencies, and prior corrective actions',
          'Pilot metrics for detection-to-triage time, resolution time, repeated incidents, unresolved exceptions, and verification completeness',
        ];
      case 'QUALITY_RELIABILITY_IMPROVEMENT':
        return [
          'Quality issue record linking defect or error, affected item or process, conditions, evidence, severity, owner, and current disposition',
          'Recurring-failure analysis comparing defects, errors, conditions, process steps, corrective actions, and prior outcomes',
          'Human-reviewed corrective-action workflow with root-cause hypothesis, verification step, owner, due date, and closure evidence',
          'Reliability trend view that separates one-off defects from repeated or systemic failure patterns',
          'Pilot metrics for defect recurrence, rework, resolution lead time, unresolved quality issues, and corrective-action effectiveness',
        ];
      case 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS':
        return [
          'Reproducible plot-failure case capturing reactive inputs, selected series or columns, current data shape, plotting code or configuration, and the exact error message',
          'Data-shape and aesthetic-mapping inspector that checks x/y lengths, colour or group mappings, missing columns, incompatible selections, and wide-versus-long structure before render',
          'Reactive dependency trace for input state, observe/reactive expressions, renderPlot or equivalent render steps, and the values that reach the visualization layer',
          'Human-reviewed correction workflow that records the proposed reshape or mapping change, corrected plotting configuration, reviewer rationale, and verified render outcome',
          'Pilot metrics for reproduced plotting failures, mapping mismatches, reactive-state defects, correction lead time, repeated failures, and verified successful renders',
        ];
      case 'FEATURE_CAPABILITY_DELIVERY':
        return this.resolveEvidenceFeatureCapabilityFeatures(featureCapability);
      case 'TIME_ACCESS_RECOVERY_PLANNING':
        return [
          'Recovery-time planning board that records constrained workday windows, protected short breaks, workload barriers, and the user-approved recovery plan',
          'Availability and conflict view that identifies realistic short recovery windows without treating a sparse evidence sample as universal clinical guidance',
          'Barrier tracking for workload, schedule rigidity, cost, caregiving, access, or other constraints that prevent planned recovery time from being used',
          'Human-reviewed escalation and adjustment workflow when protected recovery time repeatedly cannot be secured',
          'Pilot metrics for protected-time attainment, missed recovery windows, unresolved barriers, plan adjustments, and user-reported usefulness',
        ];
      case 'AI_HALLUCINATION_OUTPUT_RELIABILITY':
        return [
          'Hallucination incident capture linking the user prompt, relevant input context, model/provider, model version, generated response, and the exact disputed claim or citation',
          'Factuality and source-verification queue that separates verified facts, unsupported claims, fabricated citations, ambiguous statements, and evidence that still requires human review',
          'Human-reviewed correction workflow with accepted answer, corrected answer, rejection rationale, supporting sources, reviewer confidence, and traceable disposition history',
          'Model and prompt comparison view for repeated hallucination patterns across model versions, providers, prompts, topics, and prior reviewed outcomes without assuming a root cause from one report',
          'Pilot metrics for hallucination findings, factual verification pass rate, unsupported claims, citation verification, reviewer corrections, repeated failures, and user-reported reliability',
        ];
      case 'DATA_SYNC_FRESHNESS_RECOVERY':
        return [
          'Data-freshness status for each synchronized dataset with local version, remote version, last successful sync, freshness age, and last app-open or foreground event',
          'Synchronization diagnostics that separates stale-cache, delayed remote fetch, background-sync, connectivity, retry, and conflict conditions before a recovery action is selected',
          'Human-reviewed recovery workflow for forced refresh, safe retry, conflict resolution, cache invalidation, or escalation when current data cannot be restored automatically',
          'Reopen-after-inactivity checks that verify whether critical lists and records are current before users act on stale information',
          'Pilot metrics for sync latency, stale-data exposure, failed refreshes, recovery time, repeated sync failures, and successful freshness verification',
        ];
      case 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY':
        return [
          'Failed-transaction case record with transaction hash or local request identity, chain/network, provider, contract address, method, caller, parameters, receipt/status, and timestamp',
          'Revert diagnostics that capture provider errors, decoded revert reasons when available, require/assert failure context, event and console logs, call trace or simulation evidence, and the exact failing execution step without inventing a root cause',
          'Gas and execution-context review comparing estimate, supplied gas, fees, nonce, account state, provider response, and prior successful or failed attempts before a remediation path is selected',
          'Human-reviewed remediation and retry workflow with proposed code, configuration, contract-state, provider, or transaction changes, verification evidence, owner, rollback path, and closure decision',
          'Pilot metrics for time-to-diagnosis, unresolved reverted transactions, repeat failure rate, successful verified retries, missing-revert-context cases, and remediation verification completeness',
        ];
      case 'PROBLEM_SPECIFIC_OPERATIONAL':
        return [
          `Problem-specific operating view for ${termSummary || 'the exact evidence-backed issue and affected workflow'}`,
          'Constraint and current-state view that keeps the observed problem, affected user or process, owner, dependencies, and unresolved blockers explicit',
          'Human-reviewed response and recovery workflow with next action, responsible owner, rationale, due state, and measurable closure criteria',
          'Outcome timeline that links actions and status changes back to the exact external evidence that justified the product direction',
          `Pilot metrics for ${painSummary || 'resolution time, unresolved blockers, repeated work, recovery progress, and user-reported usefulness'}`,
        ];
      case 'EVIDENCE_DECISION_REVIEW':
        return [
          `Structured evidence intake for ${termSummary || 'the selected problem, supporting records, affected users, and operational context'}`,
          'Problem-scope and evidence-strength view that separates direct signals, secondary reports, assumptions, and unresolved questions',
          'Human-reviewed decision queue with owner, rationale, uncertainty, next validation action, and traceable status history',
          'Source provenance and attachment history tied to the exact claim or decision they support',
          `Pilot metrics for review lead time, unresolved questions, evidence completeness, repeated work, and validation outcomes${painSummary ? `, including ${painSummary}` : ''}`,
        ];
      case 'ORDER_DELIVERY_DISPUTE_INTEGRITY':
        return [
          'Unified order-dispute timeline combining customer account events, payment references, warehouse updates, shipping-information changes, carrier scans, and delivery confirmations',
          'Change-of-custody and account-change reconstruction that highlights who changed shipping details, when the change occurred, and which warehouse or carrier event followed',
          'Human-reviewed fraud and delivery-claim triage that separates likely account misuse, unauthorized address changes, carrier exceptions, missing proof, and legitimate customer disputes without autonomous refund denial',
          'Evidence-integrity view linking proof-of-delivery, scan history, account-access events, order mutations, refund actions, and investigation notes with immutable provenance',
          'Pilot metrics for dispute reconstruction time, refund-abuse review, lost-merchandise cases, false-positive customer flags, unresolved delivery claims, and investigation lead time',
        ];
      case 'SHIPMENT_EXCEPTION_RECOVERY':
        return [
          'Shipment exception record combining tracking events, carrier scans, facility handoffs, promised delivery window, customer contacts, investigation notes, and current recovery status',
          'Stalled-shipment timeline that identifies the last confirmed handoff, how long the package has remained unchanged, and which carrier or facility currently owns the next action',
          'Human-reviewed recovery queue for lost, stuck, delayed, or missing shipments with explicit escalation, investigation, reshipment, refund, and customer-communication actions',
          'Evidence view linking tracking history, proof of handoff, facility events, support interactions, and resolution decisions without inventing shipment status',
          'Pilot metrics for exception age, recovery lead time, unresolved shipments, repeated customer contacts, stalled-facility dwell time, and successful resolution',
        ];
      case 'TOURISM_PROFITABILITY_INTELLIGENCE':
        return [
          'Unified profitability ledger combining bookings, customer spending, service or package revenue, discounts, promotional campaigns, cancellations, refunds, and attributable operating expenses',
          'Profitability analysis by service, package, channel, customer segment, and season so high booking volume cannot hide low-margin periods or offerings',
          'Promotion and discount ROI view that compares incremental booking demand with discount cost, refund activity, cancellation behavior, and operating margin',
          'Human-reviewed pricing and forecast scenarios that compare seasonal demand, travel behavior, booking pace, expenses, and margin assumptions without autonomously changing prices',
          'AI-assisted anomaly and forecast explanations that show which revenue, cancellation, refund, promotion, or cost signals drive each projected result',
          'Pilot metrics for service margin, seasonal margin variance, promotion ROI, cancellation/refund impact, forecast error, and cost-to-revenue ratio',
        ];
      case 'CYBERSECURITY_LEARNING_CONTENT_SAFETY':
        return [
          'Course-content review record linking each video or learning asset to its source, security topic, intended lesson, audience, and reviewer decision',
          'Unsafe-content signal review that flags hacking tutorials, exploit demonstrations, malicious instructions, or other high-risk material while preserving educational context and uncertainty',
          'Human-reviewed allow, restrict, replace, or contextualize decision workflow with rationale, safer alternatives, and audit history instead of automatic censorship',
          'Student-exposure risk view that records audience level, learning objective, sensitive techniques, required safeguards, and approved usage conditions',
          'Pilot metrics for review lead time, unsafe-content catches, false positives, unresolved assets, replacement effort, and reviewer agreement',
        ];
      case 'GOVERNMENT_RECORD_ACCESS_INTEGRITY':
        return [
          'Unified incident timeline linking sensitive-record access logs, document-version history, employee activity, security alerts, and investigation notes',
          'Document-integrity comparison that highlights suspicious edits, deletions, permission changes, version gaps, and conflicting histories across legal, licensing, citizen-application, and regulatory records',
          'Who-accessed-what reconstruction with user, role, device, timestamp, record, action, and authorization context for human-reviewed incident attribution',
          'Tamper and access-anomaly triage that separates legitimate administrative changes, policy violations, compromised credentials, and suspicious manipulation without autonomous disciplinary action',
          'Pilot metrics for investigation lead time, unresolved suspicious changes, compromised-record findings, false-positive access alerts, compliance exceptions, and evidence-reconstruction completeness',
        ];
      case 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY':
        return [
          'Unified education security timeline linking learning-platform or examination-system login activity, assessment sessions, device identity, administrative or student account permissions, student-record access, and security alerts',
          'Compromised-account and suspicious-session triage that correlates login, device, permission, record-access, and assessment context without treating every anomaly as malicious',
          'Assessment and record-integrity investigation workspace that preserves session evidence, account activity, suspicious record changes, device changes, reviewer notes, and incident provenance',
          'Human-reviewed access decision workflow that distinguishes genuine compromise from legitimate unusual behavior and records the rationale for any restriction, restoration, or record-integrity escalation',
          'Pilot metrics for investigation lead time, compromised-account findings, suspicious-record investigations, false-positive restrictions, unresolved security alerts, and evidence-correlation completeness',
        ];
      case 'IDENTITY_ACCESS_GOVERNANCE':
        return [
          'Unified employee identity lifecycle timeline linking HR status, role and department changes, temporary project assignments, active accounts, system permissions, and deprovisioning state',
          'Access-drift and privilege-review view that highlights stale, excessive, orphaned, or role-inconsistent access without automatically disabling accounts',
          'Login-activity and security-alert correlation tied to the affected employee identity, current role, expected entitlements, and recent lifecycle changes',
          'Human-reviewed joiner/mover/leaver investigation and remediation queue with owner, rationale, approval, evidence provenance, and audit history',
          'Pilot metrics for stale-access findings, delayed deprovisioning, privilege-review age, investigation turnaround, false-positive disposition, and unresolved access discrepancies',
        ];
      case 'ACCOUNT_SECURITY_MONITORING':
        return [
          'Unified account-security timeline linking authentication events, access permissions, role or privilege changes, device/activity signals, security alerts, and relevant account-service events',
          'Explainable anomaly and suspicious-change review that surfaces account compromise or unauthorized-access indicators without autonomous lockout',
          'Human-reviewed investigation queue with affected account context, evidence provenance, false-positive disposition, ownership, and resolution milestones',
          'Targeted verification and remediation workflow that preserves legitimate-user access unless an authorized reviewer confirms the security action',
          'Pilot metrics for investigation age, confirmed account-risk findings, false-positive reviews, delayed remediation, unresolved alerts, and unnecessary restriction recovery',
        ];
      case 'AUTH_ACCESS_RECOVERY':
        return [
          'Account-access incident record with authentication method, two-factor availability, identity-provider, session, device, account-state, and recovery context',
          'Deterministic recovery triage that distinguishes credential, two-factor, identity-provider, session, verification, and account-state failures before routing the next action',
          'Human-reviewed recovery workflow with alternative sign-in options, ownership handoff, recovery status, and explicit evidence provenance',
          'Access-history and exception timeline that preserves failed attempts, verification events, recovery actions, and unresolved blockers without weakening security controls',
          'Pilot metrics for successful recovery, repeated sign-in attempts, recovery time, unresolved access blockers, and abandoned access workflows',
        ];
      case 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION':
        return [
          'Unified medical-supply usage, treatment-volume, expiration-date, disposal-reason, disposal-cost, and environmental-report timeline by department',
          'Expiration-risk tracking that identifies unused or soon-to-expire supplies before disposal while preserving clinical safety constraints',
          'Department-level waste attribution comparing supply consumption, treatment activity, expiry, disposal category, and procurement patterns',
          'Regulatory and patient-safety guardrails that keep disposal and reduction recommendations human reviewed rather than automatically changing clinical practice',
          'AI-assisted waste-risk forecasting and purchasing recommendations with explicit evidence, confidence, and reviewer approval',
          'Pilot metrics for expired-supply waste, disposal cost, avoidable waste, purchasing variance, environmental-impact direction, and unresolved compliance exceptions',
        ];
      case 'MARKETPLACE_SELLER_TRUST':
        return [
          'Seller-history and listing-quality profile combining account age, listing changes, buyer reports, transaction outcomes, and dispute history',
          'Suspicious-listing signal review for inconsistent product claims, repeated complaints, unusual seller behavior, and missing trust evidence',
          'Pre-purchase evidence snapshot that shows the buyer which risk indicators are observed, disputed, missing, or independently supported',
          'Human-reviewed seller-risk assessment that separates fraud indicators from ordinary seller or fulfillment issues and preserves uncertainty',
          'Investigation timeline linking listing edits, seller activity, transactions, refunds, disputes, and reviewer decisions',
          'Pilot metrics for risky-listing detection, false-positive reviews, dispute rate, unresolved seller flags, and review lead time',
        ];
      case 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH':
        return [
          'Unified machine timeline combining sensor telemetry, electricity usage, operating hours, production schedules, and maintenance history',
          'Energy-anomaly detection that compares abnormal power draw with machine condition and recent operating context without claiming unverified causality',
          'Equipment-efficiency trend view for identifying machines that consume more energy while output or operating conditions remain comparable',
          'Human-reviewed maintenance investigation queue linking power anomalies, condition signals, prior repairs, and production interruptions before preventive work is approved',
          'Pilot metrics for abnormal energy events, investigation lead time, unexpected breakdowns, production interruptions, and unnecessary maintenance work',
        ];
      case 'ENERGY_IOT_INCIDENT_ATTRIBUTION':
        return [
          'Unified incident timeline combining smart-meter telemetry, device health, network health, consumption anomalies, access attempts, control-system events, and operator observations',
          'Deterministic anomaly triage that separates likely device, meter, connectivity, data-quality, and cybersecurity causes before escalation',
          'Technical-versus-malicious attribution workspace with evidence provenance, contributing signals, confidence, and explicit human review',
          'Consumption-data integrity and service-impact view linking suspicious readings or disruptions to meter, network, control, and access events without autonomous grid actions',
          'Pilot metrics for incident attribution time, unresolved anomalies, inaccurate consumption readings, service disruption duration, repeated false alarms, and operational investigation cost',
        ];
      case 'URBAN_ENERGY_DEMAND_INTELLIGENCE':
        return [
          'Unified city energy-demand view combining public-building consumption, street-lighting load, charging-station demand, other urban-infrastructure usage, equipment status, weather, and service-demand signals',
          'Peak-load and inefficient-consumption detection that identifies locations and time periods where demand is rising faster than expected or energy use is operationally inefficient',
          'Demand-forecast comparison with weather, equipment state, and public-service usage so planners can see the contributing signals behind each forecast instead of receiving a black-box alert',
          'Human-reviewed infrastructure and efficiency planning queue that prioritizes overloaded assets, service-interruption risk, and high-cost consumption patterns without autonomously changing public infrastructure',
          'Pilot metrics for peak-demand forecast error, overloaded-infrastructure alerts, service interruptions, energy-cost direction, avoidable consumption, and planning lead time',
        ];
      case 'URBAN_MOBILITY_CONGESTION_EMISSIONS':
        return [
          'Unified corridor and time-period view combining traffic flow, public-transit demand, road incidents, travel times, fuel-use indicators, emissions, and environmental measurements',
          'Bottleneck detection that identifies routes and periods where congestion, incidents, demand imbalance, or unreliable travel times create the greatest operational inefficiency',
          'Travel-time and emissions comparison across routes, corridors, and peak periods with source provenance and explicit uncertainty',
          'Human-reviewed transportation improvement queue that compares intervention scenarios without autonomously changing signals, routes, fares, or public-service policy',
          'Pilot metrics for corridor delay, travel-time reliability, congestion duration, fuel-use direction, emissions direction, and improvement-decision lead time',
        ];
      case 'DOLL_RESTORATION_SPECIFICATION':
        return [
          'Doll restoration record with item identity, customer request, damage photographs, fabric selections, replacement parts, paint-matching references, restoration notes, and promised completion date',
          'Versioned restoration-scope history with one clearly marked final customer-approved treatment and explicit approval event',
          'Damage photo, fabric swatch, replacement-part reference, paint sample, physical material sample, and customer-message attachments tied to the exact restoration revision they support',
          'Pre-work approval lock and restoration checklist that prevents incorrect replacement or material choices from proceeding from an outdated scope and records later customer changes explicitly',
          'Pilot metrics for incorrect replacements, mismatched materials, repeated work, lost details, revision count, and delayed customer orders',
        ];
      case 'PUBLIC_HEALTH_DEMAND_CAPACITY':
        return [
          'Unified regional demand board combining appointment volumes, emergency visits, service-demand indicators, hospital and clinic capacity, staffing availability, and waiting-time signals',
          'Early-warning detection for communities with accelerating demand, abnormal emergency-visit growth, appointment backlogs, or capacity pressure before overload becomes critical',
          'Geographic demand and capacity comparison that highlights mismatches between community need, available staff, clinic capacity, and deployable resources',
          'Human-reviewed resource-planning queue with forecast confidence, contributing signals, redistribution options, and explicit decision history instead of autonomous clinical decisions',
          'Pilot metrics for demand-warning lead time, waiting-time direction, unresolved capacity pressure, staff coverage, and resource-redistribution response time',
        ];
      case 'MANUFACTURING_WASTE_SUSTAINABILITY':
        return [
          'Unified scrap, machine-output, quality-defect, raw-material, energy, and emissions timeline by production stage',
          'Material-loss attribution that compares scrap records with output, defect, rework, and consumption signals',
          'Production-stage hotspot view for repeated scrap, excessive raw-material use, rework, and avoidable energy intensity',
          'Human-reviewed root-cause workspace that separates observed correlations from unverified causal assumptions',
          'Pilot metrics for scrap rate, material yield, rework, energy intensity, emissions intensity, and unresolved waste causes',
        ];
      case 'ENVIRONMENTAL_MONITORING': {
        const environmentalContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:noise sensors?|noise pollution|sound level readings?|traffic activity|construction schedules?|citizen complaints?)\b/u.test(environmentalContext)) {
          return [
            'Unified acoustic monitoring map combining noise-sensor readings, location, time window, neighborhood or district context, traffic activity, citizen complaints, and construction schedules',
            'Persistent noise-hotspot detection that distinguishes repeated excessive sound from isolated spikes and keeps the contributing observations visible for review',
            'Source-attribution workspace that compares traffic, construction, commercial activity, and other observed context without claiming an unverified cause automatically',
            'Human-reviewed enforcement and urban-planning queue linking each hotspot to complaints, sensor provenance, threshold context, investigation status, and decision history',
            'Pilot metrics for persistent hotspot age, complaint-to-sensor correlation, source-attribution confidence, enforcement response time, and unresolved excessive-noise areas',
          ];
        }
        return [
          'Unified temperature, humidity, water-use, air-quality, and equipment-reading dashboard',
          'Abnormal-condition timeline with building, zone, device, and maintenance context',
          'Water-waste, comfort, air-quality, and equipment exceptions routed to maintenance owners',
          'Sensor-source provenance and threshold review so faulty readings are distinguishable from real building conditions',
          'Pilot metrics for unresolved anomalies, maintenance response time, water waste, and repeated environmental exceptions',
        ];
      }
      case 'ROUTING_SUSTAINABILITY':
        return [
          'Route, delivery-volume, traffic, failed-attempt, mileage, fuel-use, and emissions timeline',
          'Route-level comparison of avoidable mileage, failed-delivery retries, and fuel impact',
          'Human-reviewed exception queue for high-fuel, high-mileage, or delayed delivery patterns',
          'Decision trace linking dispatch or route changes to service and environmental outcomes',
          'Pilot metrics for mileage, fuel use, failed attempts, delays, and emissions direction',
        ];
      case 'SPECIFICATION_VERSIONING': {
        const specificationContext = termSummary.toLowerCase();
        if (/\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conserv|paper conserv|document conserv|handwritten annotation|missing pages?)\b/u.test(specificationContext)) {
          return [
            'Digital musical-manuscript dossier with condition photographs, paper characteristics, missing-page records, handwritten annotations, previous repairs, client instructions, and promised completion date',
            'Versioned treatment plan linking each proposed conservation action to the relevant manuscript section, client instruction, revision history, and explicit final approval',
            'Page and section annotation register that preserves marginalia, handwritten notes, condition findings, physical-reference links, and photographic evidence without overwriting the original record',
            'Restoration progress ledger recording treatment steps, materials or methods used, exceptions, review notes, approval state, and completion milestones',
            'Pilot metrics for documentation gaps, lost annotations, duplicated work, incorrect treatment choices, material damage, revision count, and delayed projects',
          ];
        }
        if (/\bcustom footwear\b/u.test(specificationContext)) {
          return [
            'Custom footwear order specification with foot measurements, leather selection, sole type, stitching preference, fitting notes, design revision, approval status, and completion deadline',
            'Versioned shoe specification history with one clearly marked final customer-approved production version',
            'Sketch, photograph, leather sample, sole reference, stitching reference, fitting note, and customer-message attachments tied to the exact revision they support',
            'Pre-production and pre-completion checks that confirm measurements, leather, sole, stitching, fitting adjustments, and the latest customer approval before the pair is finalized',
            'Pilot metrics for sizing errors, incorrect material choices, repeated fittings, wasted materials, revision count, and delayed orders',
          ];
        }
        if (/\b(?:scale requirements?|reference images?|paint details?|miniature|model)\b/u.test(specificationContext)) {
          return [
            'Commission specification record with scale, dimensions, reference images, material choices, paint details, revision status, and completion deadline',
            'Versioned customer revision history with one clearly marked final approved model specification',
            'Reference-image, sketch, photograph, paint-sample, and material attachments tied to the exact revision they support',
            'Pre-build approval lock that prevents production from starting from an outdated revision and records later customer changes explicitly',
            'Pilot metrics for incorrect proportions, missed visual details, repeated work, wasted materials, revision count, and delayed commissions',
          ];
        }
        if (/\b(?:engraving|engraver|artwork|font|placement|object dimension|spelling)\b/u.test(specificationContext)) {
          return [
            'Customer engraving order with exact text, artwork, material type, object dimensions, font, placement, and promised completion date',
            'Versioned artwork and text specification history with one clearly marked final customer-approved production version',
            'Photo, artwork, material sample, font reference, placement proof, and customer-message attachments tied to the exact revision they support',
            'Pre-production lock that requires spelling, dimensions, material, font, placement, and final artwork approval before engraving starts',
            'Pilot metrics for spelling mistakes, incorrect placement, wrong-version production, rework, wasted materials, revision count, and delayed orders',
          ];
        }
        if (/\b(?:mosaic|tile materials?|tile samples?|installation requirements?)\b/u.test(specificationContext)) {
          return [
            'Commission specification record with design references, tile materials, color combinations, dimensions, installation requirements, revision status, and completion deadline',
            'Versioned customer revision history with one clearly marked final approved mosaic design and explicit approval event',
            'Sketch, photo, tile sample, color reference, installation note, and customer-message attachments tied to the exact design revision they support',
            'Pre-production approval lock that prevents fabrication or installation from starting from an outdated design and records later customer changes explicitly',
            'Pilot metrics for incorrect patterns, missed customization details, repeated work, wasted materials, revision count, and delayed installations',
          ];
        }
        if (/\b(?:ceramic|pottery|painting instructions?|personalization details?|item sizes?|misspelled names?|pickup dates?)\b/u.test(specificationContext)) {
          return [
            'Piece specification with ceramic item identity, design references, color choices, item size, personalization text, painting instructions, revision status, and pickup date',
            'Versioned design history with one clearly marked final customer-approved ceramic design and explicit approval event',
            'Sketch, photo, color reference, personalization proof, and customer-message attachments tied to the exact design revision they support',
            'Pre-paint approval lock that validates spelling, color, size, personalization, and instructions before production while recording later customer changes explicitly',
            'Pilot metrics for incorrect colors, misspelled names, wasted materials, repeated work, revision count, and delayed customer orders',
          ];
        }
        if (/\b(?:furniture|wood type|wooden furniture|stain|wood finish|furniture refinishing|furniture restoration|furniture repair)\b/u.test(specificationContext)) {
          return [
            'Customer furniture record with wood type, condition/damage notes, photos, and promised completion date',
            'Versioned stain, finish, and restoration-treatment history with one clearly marked final customer-approved treatment',
            'Material sample, stain/color reference, customer message, and photo attachments tied to the exact treatment revision',
            'Restoration-step checklist with damage findings, material usage, revision status, and completion tracking',
            'Pilot metrics for incorrect finishes, repeated work, wasted materials, overlooked damage, and delayed orders',
          ];
        }
        if (/\b(?:fragrance|scent|formula|ingredient|concentration|bottle)\b/u.test(specificationContext)) {
          return [
            'Client fragrance profile with preferences, ingredient combinations, concentration levels, bottle choice, and deadline',
            'Versioned fragrance formula and sample-feedback history with one clearly marked final approved formula',
            'Scent-sample, photograph, customer-message, and ingredient-reference attachments tied to the exact formula revision',
            'Sampling and formulation checklist with approval status, revision reason, ingredient usage, and delivery tracking',
            'Pilot metrics for incorrect formulations, repeated sampling, wasted ingredients, inconsistent results, and delayed orders',
          ];
        }
        if (/\bcustom hat\b/u.test(specificationContext)) {
          return [
            'Custom hat order specification with head measurements, material choice, brim dimensions, color preferences, decorative details, fitting notes, revision status, and delivery date',
            'Versioned specification history with one clearly marked final customer-approved hat design and explicit approval event',
            'Sketch, photograph, material sample, color reference, decoration reference, fitting note, and customer-message attachments tied to the exact revision they support',
            'Pre-production and pre-delivery checks that confirm sizing, brim dimensions, materials, decoration, fitting adjustments, and final approval before the piece is completed',
            'Pilot metrics for incorrect sizing, material mismatches, repeated adjustments, wasted supplies, revision count, and delayed delivery',
          ];
        }
        if (/\bcustom wig\b/u.test(specificationContext)) {
          return [
            'Client wig specification with measurements, hair texture, color choice, cap details, styling requests, and delivery date',
            'Versioned fitting and specification history with one clearly marked final approved client version',
            'Photo, color/sample, fitting-note, and customer-message attachments tied to the exact specification revision',
            'Preparation and fitting checklist with size, cap, styling, adjustment, and approval status',
            'Pilot metrics for sizing errors, color mismatches, repeated adjustments, wasted materials, and delayed orders',
          ];
        }
        return [
          `Structured customer/project record for ${termSummary || 'measurements, materials, preferences, and treatment details'}`,
          'Versioned specification or treatment history with one clearly marked final approved version',
          'Photo, sample, material-reference, and note attachments tied to the exact revision they support',
          'Step-by-step work checklist that preserves condition findings, customer changes, and completion status',
          `Pilot metrics for rework, incorrect outcomes, wasted materials, revision count, and delayed orders${painSummary ? `, with attention to ${painSummary}` : ''}`,
        ];
      }
      case 'SERVICE_HISTORY': {
        const serviceContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:violin bow|bow condition|rehairing dates?|hair type preferences?)\b/u.test(serviceContext)) {
          return [
            'Bow profile with condition, last and previous rehair dates, hair type preference, grip details, winding details, repair notes, and customer requests',
            'Chronological service history that shows prior rehairing, repairs, materials used, condition findings, and recurring issues before a new service decision',
            'Customer preference record for hair type, grip, winding, materials, handling notes, and approved service requests without re-entering them for every visit',
            'Photo, receipt, customer-message, material-reference, and repair-note attachments linked to the exact bow and service event they support',
            'Pilot metrics for repeated inspections, forgotten preferences, incorrect materials, unnecessary repairs, rework, and delayed service',
          ];
        }
        if (/\bclock repair\b/u.test(serviceContext)) {
          return [
            'Clock intake and service-history record linking the customer item, mechanical faults, diagnostic findings, previous repairs, replacement parts, restoration instructions, cost approvals, customer requests, and promised completion date',
            'Chronological repair history that lets the specialist compare prior diagnostics, prior work, and recurring mechanical faults before approving a new repair path',
            'Replacement-part and restoration-instruction tracking with supplier/reference details, approval status, installed part history, and explicit customer authorization for cost changes',
            'Photo, handwritten-note, receipt, customer-message, diagnostic-note, and repair-event attachments tied to the exact service-history entry they support',
            'Pilot metrics for repeated diagnostics, incorrect replacement parts, forgotten customer requests, unexpected costs, rework, and delayed repairs',
          ];
        }
        if (/\b(?:fountain pen|pen condition|nib adjustments?|ink-flow diagnostics|writing preferences?)\b/u.test(serviceContext)) {
          return [
            'Fountain pen profile with condition, nib configuration and adjustments, ink-flow findings, installed or replaced parts, restoration requests, customer writing preferences, and current service status',
            'Chronological repair and service history that exposes previous diagnostics, nib work, ink-flow interventions, parts used, recurring symptoms, and prior outcomes before new work is approved',
            'Writing-preference record for pressure, feedback, smoothness, line behavior, ink use, and other customer notes so technicians do not repeatedly rediscover the same preferences',
            'Photo, receipt, customer-message, diagnostic-note, nib-adjustment, replacement-part, and before/after attachments linked to the exact service event they support',
            'Pilot metrics for repeated diagnostics, incorrect parts, forgotten adjustments, unnecessary repairs, recurring faults, rework, and inconsistent restoration outcomes',
          ];
        }
        return [
          `Chronological service record for ${termSummary || 'prior work, recurring issues, parts, preferences, and conditions'}`,
          'Previous-work and recurring-problem comparison before a new diagnosis or recommendation is approved',
          'Follow-up and maintenance recommendation tracking with responsible owner and due date',
          'Evidence attachments and notes linked to the exact visit or service event',
          `Pilot metrics for repeated diagnostics, unnecessary replacement, forgotten follow-up, and service delay${painSummary ? `, including ${painSummary}` : ''}`,
        ];
      }
      case 'WORKFORCE_CAPACITY_CONTINUITY':
        return [
          'Workforce-capacity dashboard for active headcount, vacancies, departures, hiring restrictions, critical-role coverage, and workload by team or service',
          'Service-continuity impact view that links staffing loss to affected functions, workload pressure, backlogs, capacity gaps, and unresolved coverage risk',
          'Human-reviewed workload redistribution and staffing-response plan with responsible owner, priority, assumptions, dependencies, and approval history',
          'Critical-role and continuity-threshold tracking so teams can see where further workforce loss would materially degrade service delivery without claiming an unsupported exact failure point',
          'Pilot metrics for staffing coverage, vacancy age, workload concentration, unresolved critical-role gaps, service-capacity pressure, and response lead time',
        ];
      case 'STAFFING_PLANNING':
        return [
          `Unified planning board for ${termSummary || 'workload, availability, assignments, demand, and scheduling constraints'}`,
          'Conflict and overload detection before assignments are finalized',
          'Human-reviewed assignment rationale with expertise, availability, and demand context',
          'Change history for reassignments, exceptions, and unresolved staffing gaps',
          `Pilot metrics for overload, conflicts, delayed support, and reassignment effort${painSummary ? `, including ${painSummary}` : ''}`,
        ];
      case 'GENERAL_OPERATIONAL':
        return [
          `Structured workspace for ${termSummary || 'the requester-defined records, tasks, and status changes'}`,
          'Current-state and change-history view so the latest approved or verified information is explicit',
          'Owner, due-date, exception, and next-action tracking tied to the exact operational record',
          'Source provenance and attachments for messages, photos, notes, documents, or other requester-described inputs',
          `Pilot metrics for ${painSummary || 'repeated work, delay, unresolved exceptions, and coordination effort'}`,
        ];
    }
  }

  private static resolveObjectives(
    category: ReturnType<typeof this.resolveCategory>,
    workflowTerms: readonly string[],
    painTerms: readonly string[],
    featureCapability: EvidenceFeatureCapabilityProfile | null,
  ): string[] {
    const features = this.resolveFeatures(
      category,
      workflowTerms,
      painTerms,
      featureCapability,
    );

    if (category === 'TOURISM_PROFITABILITY_INTELLIGENCE') {
      return [
        'Reconcile tourism profitability by combining booking revenue, customer spending, discounts, promotions, cancellations, refunds, and attributable operating expenses at service, package, channel, and seasonal-period level.',
        'Identify which services, packages, campaigns, customer segments, and periods generate real margin rather than relying on booking volume or gross revenue alone.',
        'Compare human-reviewed pricing, discount, promotion, and demand scenarios using transparent assumptions, seasonal behavior, cancellation risk, and cost attribution instead of autonomous price changes.',
        'Measure service margin, seasonal margin variance, promotion ROI, cancellation/refund impact, forecast error, and operating-cost burden during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'SHIPMENT_EXCEPTION_RECOVERY') {
      return [
        'Reconstruct the shipment exception timeline from carrier scans, facility handoffs, tracking changes, customer contacts, investigation events, and the last confirmed custody point.',
        'Detect stalled, missing, lost-in-transit, or repeatedly delayed shipments and make the responsible carrier, facility, or internal owner and next recovery action explicit.',
        'Route each exception through a human-reviewed investigation, escalation, reshipment, refund, or customer-communication workflow without inventing delivery status or responsibility.',
        'Measure exception age, recovery lead time, unresolved shipments, repeated contacts, facility dwell time, and successful resolution during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'CYBERSECURITY_LEARNING_CONTENT_SAFETY') {
      return [
        'Identify cybersecurity learning assets that may expose students to unsafe hacking tutorials, malicious instructions, or techniques that require controlled educational context.',
        'Separate legitimate security education from unnecessarily risky content using source provenance, learning objective, audience level, content signals, and explicit reviewer rationale.',
        'Provide a human-reviewed allow, restrict, contextualize, or replace workflow with safer alternatives and traceable decisions instead of automatic content blocking.',
        'Measure review lead time, unsafe-content catches, false positives, unresolved assets, replacement effort, and reviewer agreement during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'ECOMMERCE_MARGIN_PROFITABILITY') {
      return [
        'Reconcile product and campaign economics by combining gross sales with discounts, advertising spend, returns/refunds, payment fees, shipping and fulfillment costs, and customer purchasing behavior.',
        'Explain margin movement at SKU, campaign, channel, and customer-cohort level so strong revenue cannot hide weak or declining contribution margin.',
        'Compare human-reviewed pricing and promotion scenarios using transparent cost attribution and explicit assumptions rather than autonomous price changes.',
        'Measure contribution margin, campaign profit, return-cost impact, ad-spend efficiency, shipping-cost burden, and time to explain margin changes during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE') {
      return [
        'Unify subscription payments, discount usage, customer-support interactions, renewal history, product usage, refund activity, and cancellation events into one subscriber-level analytical timeline.',
        'Identify explainable behavior patterns that precede churn or non-renewal and separate those signals from ordinary customer variation before a human reviewer acts on them.',
        'Evaluate pricing-plan profitability and discount effectiveness by linking recurring revenue, incentives, refunds, usage, and renewal outcomes instead of relying on sign-up volume alone.',
        'Measure churn rate, renewal rate, retention-offer conversion, discount-cost impact, plan contribution margin, and recurring-revenue forecast error during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'SUBSCRIPTION_ACCESS_REFUND') {
      return [
        'Reconstruct the subscription and refund case from trial, charge, access state, update requirement, support-contact attempts, and refund or cancellation actions.',
        'Identify the blocker preventing the user from reaching support or completing a refund request without treating the selected domain as proof of market-wide prevalence.',
        'Route the case through a human-reviewed refund, cancellation, or access-recovery workflow with explicit ownership, evidence, deadlines, and escalation.',
        'Measure refund resolution time, blocked-support cases, repeated contacts, unresolved charges, and abandoned refund requests during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'ORDER_DELIVERY_DISPUTE_INTEGRITY') {
      return [
        'Reconstruct the disputed order timeline by correlating customer-account access, order edits, payment references, warehouse updates, carrier scans, delivery confirmations, and refund actions.',
        'Detect conflicting or unauthorized shipping-information changes and distinguish account misuse, fulfillment mistakes, carrier exceptions, missing proof, and legitimate customer disputes with explicit uncertainty.',
        'Prioritize human-reviewed investigation actions using traceable custody and evidence provenance while preventing automatic customer blocking or refund denial from weak signals.',
        'Measure dispute reconstruction time, refund-abuse review, lost-merchandise cases, false-positive customer flags, unresolved delivery claims, and investigation lead time during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'IDENTITY_ACCESS_GOVERNANCE') {
      return [
        'Unify employee lifecycle changes, HR status, active accounts, roles, and system entitlements so joiner, mover, temporary-project, and leaver access can be reviewed from one traceable record.',
        'Detect stale, excessive, orphaned, or role-inconsistent access by comparing current permissions with employee role and department context without automatically revoking access.',
        'Correlate login activity and security alerts with lifecycle and entitlement changes so HR, IAM, and security reviewers can investigate unusual account behavior with explicit evidence and human approval.',
        'Measure stale-access findings, delayed deprovisioning, privilege-review age, investigation turnaround, false-positive disposition, and unresolved access discrepancies during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'ACCOUNT_SECURITY_MONITORING') {
      return [
        'Unify authentication activity, account permissions, role or privilege changes, device or behavior signals, and security alerts into one account-level investigation timeline.',
        'Identify suspicious account behavior, compromise indicators, or unauthorized changes while separating legitimate activity and false positives before any restrictive action is taken.',
        'Route findings through a human-reviewed verification and remediation workflow with traceable evidence, ownership, rationale, and audit history instead of autonomous account lockout.',
        'Measure investigation age, confirmed account-risk findings, false-positive reviews, delayed remediation, unresolved alerts, and unnecessary restriction recovery during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION') {
      return [
        'Identify where unnecessary medical waste is generated by reconciling supply usage, treatment volume, expiration dates, disposal reasons, procurement activity, and environmental reports at department level.',
        'Detect unused, overstocked, or expiration-risk supplies early enough for a human reviewer to consider safe redistribution, purchasing adjustments, or other policy-compliant actions.',
        'Separate clinically required disposal from potentially avoidable waste using explicit patient-safety, infection-control, and regulatory constraints rather than optimizing cost alone.',
        'Measure expired-supply waste, disposal cost, avoidable-waste direction, purchasing variance, environmental impact, and unresolved compliance exceptions during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'MARKETPLACE_SELLER_TRUST') {
      return [
        'Reconstruct seller and listing risk from seller history, listing changes, buyer reports, transaction outcomes, refund or dispute history, and available verification evidence before purchase.',
        'Detect suspicious or misleading listing patterns while distinguishing weak evidence, ordinary seller mistakes, fulfillment issues, and stronger fraud indicators with explicit uncertainty.',
        'Provide buyers or marketplace reviewers with a traceable pre-purchase evidence snapshot and human-reviewed risk assessment instead of an opaque automated block.',
        'Measure risky-listing review lead time, dispute rate, unresolved seller flags, false-positive assessments, and evidence completeness during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'CUSTOMER_SUPPORT_ESCALATION') {
      return [
        'Reconstruct each unresolved support case from customer contact attempts, email history, bot or automated replies, available support channels, prior escalations, ownership, and current resolution state.',
        'Detect repeated contacts, bot-only response loops, unavailable phone or live-chat routes, missing human replies, and overdue cases before the customer must restart the support process again.',
        'Route qualified cases to a human-reviewed escalation queue with an explicit owner, SLA deadline, escalation reason, full conversation context, and traceable next action rather than another generic automated response.',
        'Measure first human response time, escalation lead time, resolution time, repeated support contacts, bot-only loops, and unresolved cases during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY') {
      return [
        'Correlate education learning-platform or examination-system login activity, administrative and student account permissions, student-record access, device information, and security alerts into one incident view before deciding whether an account or record is compromised.',
        'Detect suspicious account, record-change, or assessment-session behavior while separating stronger compromise indicators from legitimate unusual activity and explicit false-positive risk.',
        'Support human-reviewed access, record-integrity, or assessment-integrity decisions with traceable evidence, reviewer rationale, and reversible restrictions instead of defaulting to account recovery.',
        'Measure investigation lead time, compromised-account findings, suspicious-record investigations, false-positive restrictions, unresolved security alerts, and evidence completeness during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'AUTH_ACCESS_RECOVERY') {
      return [
        'Detect the authentication, two-factor, identity-provider, session, verification, or account-state condition preventing a legitimate user from completing access.',
        'Compare available recovery paths, authentication context, and prior access events before selecting the safest human-reviewed restoration action.',
        'Prioritize recoverable access blockers and support an auditable handoff when identity, security, or account-state review is required.',
        'Measure successful recovery, repeated sign-in attempts, recovery time, unresolved blockers, and abandoned access workflows during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'URBAN_MOBILITY_CONGESTION_EMISSIONS') {
      return [
        'Detect routes, corridors, and time periods with the greatest congestion and travel-time unreliability by correlating traffic flow, public-transit demand, and road incidents.',
        'Compare congestion and travel-time patterns with fuel-use, vehicle-emission, and environmental measurements to expose the highest-impact inefficiencies without claiming unsupported causality.',
        'Prioritize human-reviewed transportation improvements using transparent route, time-period, incident, demand, and environmental evidence instead of generic case management.',
        'Measure corridor delay, travel-time reliability, congestion duration, fuel-use direction, emissions direction, and improvement-decision lead time during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'ENERGY_IOT_INCIDENT_ATTRIBUTION') {
      return [
        'Correlate smart-meter telemetry, device failures, network disruptions, unusual consumption, access attempts, and control-system events into one incident timeline before attribution.',
        'Distinguish likely technical faults, data-quality problems, connectivity failures, and malicious interference using deterministic evidence rules and explicit uncertainty.',
        'Prioritize human-reviewed incident response with device, meter, network, consumption, and security context while keeping consequential grid-control actions outside autonomous execution.',
        'Measure attribution time, unresolved anomalies, inaccurate consumption readings, service disruption duration, false alarms, and investigation effort during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'URBAN_ENERGY_DEMAND_INTELLIGENCE') {
      return [
        'Detect inefficient city energy-consumption patterns and emerging peak-demand periods by correlating public-building, street-lighting, charging-station, and other urban-infrastructure usage.',
        'Forecast where electricity demand is likely to increase by comparing historical consumption with equipment status, weather conditions, service demand, and time-of-use patterns.',
        'Prioritize human-reviewed energy-efficiency and infrastructure actions using transparent demand, equipment, weather, cost, and service-risk evidence instead of generic case management.',
        'Measure peak-demand forecast error, overloaded-infrastructure alerts, service interruptions, energy-cost direction, avoidable consumption, and planning lead time during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'GOVERNMENT_RECORD_ACCESS_INTEGRITY') {
      return [
        'Reconstruct sensitive-record incidents by correlating access logs, document versions, employee activity, security alerts, and authorization context across legal, licensing, citizen-application, and regulatory records.',
        'Detect suspicious or unauthorized record changes while preserving the distinction between legitimate administrative edits, policy violations, compromised credentials, and confirmed manipulation.',
        'Prioritize human-reviewed investigation actions with immutable evidence provenance so reviewers can determine who accessed or changed critical information and why.',
        'Measure investigation lead time, unresolved suspicious changes, compromised-record findings, false-positive access alerts, compliance exceptions, and reconstruction completeness during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'DOLL_RESTORATION_SPECIFICATION') {
      return [
        'Detect outdated, incomplete, or conflicting doll restoration instructions before work begins by comparing damage photographs, fabric selections, replacement parts, paint-matching references, restoration notes, and the approved restoration scope.',
        'Compare revision history, customer messages, photographs, swatches, part references, paint samples, and approval events so one final approved restoration version is explicit.',
        'Prevent incorrect replacements and mismatched materials by requiring a human-reviewed work lock after the latest restoration scope and customer approval are confirmed.',
        'Measure incorrect replacements, material mismatches, repeated work, lost details, revision count, and delayed customer orders during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'WORKFORCE_CAPACITY_CONTINUITY') {
      return [
        'Track workforce loss, vacancies, staffing restrictions, critical-role coverage, workload, and service-capacity impact in one auditable operating view.',
        'Identify which functions or services become most exposed as staffing capacity changes, while avoiding unsupported claims about an exact organizational failure threshold.',
        'Support human-reviewed workload redistribution, hiring or replacement priorities, escalation, and continuity actions with explicit assumptions, ownership, dependencies, and evidence provenance.',
        'Measure staffing coverage, vacancy age, workload concentration, unresolved critical-role gaps, service-capacity pressure, and response lead time during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'PUBLIC_HEALTH_DEMAND_CAPACITY') {
      return [
        'Detect communities with accelerating medical-service demand by comparing appointment volumes, emergency visits, waiting times, and regional demand signals before hospitals or clinics become overloaded.',
        'Compare demand forecasts with hospital and clinic capacity, staff availability, and deployable resources to expose emerging service-pressure gaps.',
        'Prioritize human-reviewed resource-planning actions with forecast confidence, contributing signals, and a traceable rationale for redistribution or escalation.',
        'Measure demand-warning lead time, waiting-time direction, capacity pressure, staff coverage, and resource-redistribution response during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'ACCESS_CAPACITY_PLANNING') {
      return [
        'Identify the concrete barriers preventing timely access by comparing demand, waiting, staffing, resource, location, channel, and service-capacity evidence instead of treating access as a generic coordination problem.',
        'Quantify where access pressure is concentrated and distinguish demand growth from capacity, staffing, scheduling, geographic, eligibility, or process constraints.',
        'Support human-reviewed improvement actions with explicit evidence strength, responsible owner, dependencies, and follow-up status.',
        'Measure access delay, waiting-time direction, capacity pressure, resource coverage, unresolved barriers, and intervention follow-up during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'RISK_INTEGRITY_REVIEW') {
      return [
        'Build one evidence-traceable risk view that separates verified facts, allegations, secondary reporting, vulnerability or misconduct indicators, prior events, and unresolved uncertainty.',
        'Compare actor, organization, vendor, ownership, identity, behavior, and supporting-source history to identify material integrity or due-diligence concerns without converting weak evidence into confirmed wrongdoing.',
        'Route high-risk findings to human review with explicit severity, confidence, rationale, follow-up evidence, and auditable disposition.',
        'Measure review lead time, unresolved high-risk findings, evidence completeness, false-positive dispositions, and follow-up closure during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'MUNICIPAL_WASTE_COORDINATION') {
      return [
        'Unify neighborhood pickup schedules, container capacity or fill signals, citizen complaints, vehicle status, traffic, and route performance without reframing the sanitation problem as generic finance analytics.',
        'Identify where earlier pickups, route changes, or additional municipal resources are justified by the combined operational signals and preserve the evidence behind each recommendation.',
        'Keep dispatchers in control of route and resource changes with explicit approval, modification, rejection, ownership, and audit history.',
        'Measure container overflow incidents, unnecessary trips, complaint backlog, route completion, vehicle utilization, and operating-cost direction during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'COST_PERFORMANCE_INTELLIGENCE') {
      return [
        'Reconcile revenue, costs, budget, operational activity, demand drivers, and time periods so teams can explain where financial or performance variance originates.',
        'Attribute margin, spend, revenue, or forecast variance to specific products, services, channels, assets, teams, or periods rather than relying on top-line totals.',
        'Compare human-reviewed scenarios with explicit assumptions before budget, pricing, resource, or operating changes are approved.',
        'Measure margin or cost variance, forecast error, unexplained spend, decision lead time, and realized performance direction during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'COMPLIANCE_GOVERNANCE_REVIEW') {
      return [
        'Map each material obligation, policy, contract, control, or recordkeeping requirement to its owner, supporting evidence, review status, and due date.',
        'Detect missing evidence, overdue obligations, policy conflicts, approval gaps, and unresolved governance exceptions before they become invisible operational risk.',
        'Preserve human-reviewed rationale, remediation actions, approvals, and change history so compliance decisions remain auditable.',
        'Measure unresolved compliance gaps, evidence completeness, review lead time, overdue actions, and repeated exceptions during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'INCIDENT_EXCEPTION_RESOLUTION') {
      return [
        'Reconstruct each incident or exception from trigger, affected asset or service, severity, dependency, ownership, evidence, and status history.',
        'Separate likely failure classes and recurring patterns before a remediation path is selected so teams do not treat every incident as the same generic case.',
        'Support human-reviewed remediation, escalation, verification, and closure with explicit rationale and evidence provenance.',
        'Measure detection-to-triage time, resolution time, repeated incidents, unresolved exceptions, and verification completeness during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'QUALITY_RELIABILITY_IMPROVEMENT') {
      return [
        'Capture defects, errors, reliability issues, affected items or processes, conditions, and supporting evidence in one traceable quality record.',
        'Compare repeated issues, process steps, prior corrective actions, and outcomes to distinguish one-off mistakes from recurring or systemic failure patterns.',
        'Require human-reviewed corrective action, verification, ownership, and closure evidence before a quality issue is treated as resolved.',
        'Measure defect recurrence, rework, resolution lead time, unresolved quality issues, and corrective-action effectiveness during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS') {
      return [
        'Capture each reproducible visualization failure with the reactive input state, selected series or columns, data shape, plotting configuration, and exact error instead of reducing the issue to a generic quality defect.',
        'Diagnose whether the failure comes from incompatible aesthetic lengths, wide-versus-long data shape, missing or unexpected selections, reactive dependency state, or another evidence-supported plotting condition.',
        'Support a human-reviewed correction that preserves the original failing case, proposed reshape or mapping change, corrected configuration, and verified render result.',
        'Measure reproduced failures, mapping and shape mismatches, reactive-state defects, correction lead time, repeated failures, and verified successful renders during the pilot without unsupported prevalence claims.',
      ];
    }

    if (category === 'FEATURE_CAPABILITY_DELIVERY') {
      return this.resolveEvidenceFeatureCapabilityObjectives(featureCapability);
    }

    if (category === 'TIME_ACCESS_RECOVERY_PLANNING') {
      return [
        'Identify realistic short recovery windows and the workday, workload, access, or affordability constraints that prevent users from protecting mental-health recovery time.',
        'Turn the retained time-access problem into a user-controlled recovery plan with explicit availability, conflicts, ownership, and adjustment history rather than an evidence-review queue.',
        'Escalate repeated inability to secure protected recovery time to an appropriate human reviewer while keeping clinical or employment decisions outside autonomous execution.',
        'Measure protected-time attainment, missed recovery windows, unresolved barriers, plan adjustments, and user-reported usefulness during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'AI_HALLUCINATION_OUTPUT_RELIABILITY') {
      return [
        'Capture each reported hallucination or unreliable AI output with its prompt, model context, generated response, disputed claims, citations, and supporting evidence.',
        'Verify factual claims and cited sources before classifying an output as supported, unsupported, fabricated, ambiguous, or requiring additional human review.',
        'Support human-reviewed correction, rejection, escalation, and closure while preserving the original output, evidence provenance, reviewer rationale, and model/version context.',
        'Measure hallucination findings, factual verification outcomes, repeated failure patterns, correction effort, citation reliability, and user-reported output usefulness during the pilot.',
      ];
    }

    if (category === 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY') {
      return [
        'Reconstruct each failed or reverted blockchain transaction from network, provider, contract method, caller, parameters, receipt/status, logs, gas context, and retained evidence.',
        'Identify the narrowest evidence-supported execution failure class before proposing a remediation, distinguishing revert conditions, provider errors, gas or estimation failures, contract-state constraints, and unresolved causes.',
        'Support human-reviewed remediation, simulation or replay where available, safe retry, verification, and closure while preserving the original failed transaction and decision rationale.',
        'Measure time-to-diagnosis, unresolved reverted transactions, repeat failures, successful verified retries, missing error context, and remediation verification completeness during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'PROBLEM_SPECIFIC_OPERATIONAL') {
      return [
        features[0],
        'Model the exact operating constraints, dependencies, affected workflow, ownership, and response state that are supported by the retained problem-matched evidence.',
        'Support a human-reviewed response and recovery path with explicit next actions, rationale, evidence provenance, and closure criteria instead of defaulting to a generic evidence-triage product.',
        'Measure resolution time, unresolved blockers, repeated work, recovery progress, and user-reported usefulness during the pilot without unsupported prevalence claims.',
      ];
    }

    if (category === 'EVIDENCE_DECISION_REVIEW') {
      return [
        features[0],
        'Separate direct evidence, secondary reports, requester assumptions, and unresolved questions so product decisions are not built on undifferentiated signals.',
        'Route the strongest supported problem to a human-reviewed decision and validation workflow with explicit owner, rationale, uncertainty, and next evidence action.',
        'Measure review lead time, evidence completeness, unresolved questions, repeated work, and validation outcomes during the pilot without unsupported percentage targets.',
      ];
    }

    if (category === 'SPECIFICATION_VERSIONING') {
      const specificationContext = workflowTerms.join(' ').toLocaleLowerCase();

      if (/\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conserv|paper conserv|document conserv|handwritten annotation|missing pages?)\b/u.test(specificationContext)) {
        return [
          'Create one traceable condition and treatment record for each musical manuscript by linking photographs, missing pages, handwritten annotations, paper characteristics, previous repairs, client instructions, and restoration progress.',
          'Compare condition findings, previous interventions, client messages, physical references, and treatment-plan revisions so the currently approved conservation treatment is explicit before work proceeds.',
          'Protect original annotations and treatment history by requiring human review for changes to treatment scope, page-level notes, materials or methods, and client approvals without overwriting earlier records.',
          'Measure documentation gaps, lost annotations, duplicated work, incorrect treatment choices, material damage, revision count, and delayed projects during the pilot without unsupported percentage targets.',
        ];
      }

      if (/\bcustom hat\b/u.test(specificationContext)) {
        return [
          'Detect outdated, incomplete, or conflicting custom-hat specifications before production by comparing head measurements, material choices, brim dimensions, color preferences, decorative details, fitting notes, and revisions.',
          'Compare sketches, photographs, physical samples, customer messages, fitting notes, and approval events so one final approved hat specification is explicit for every order.',
          'Prevent sizing and material mistakes by requiring a human-reviewed production lock after measurements, brim dimensions, materials, decorative details, and the latest customer approval are confirmed.',
          'Measure incorrect sizing, material mismatches, repeated adjustments, wasted supplies, revision count, and delayed delivery during the pilot without unsupported percentage targets.',
        ];
      }

      if (/\bcustom footwear\b/u.test(specificationContext)) {
        return [
          'Detect outdated, incomplete, or conflicting bespoke-footwear specifications before production by comparing foot measurements, leather selections, sole types, stitching preferences, fitting notes, design revisions, and completion deadlines.',
          'Compare sketches, physical samples, customer messages, fitting notes, and approval events so one final approved shoe specification is explicit for every pair.',
          'Prevent sizing and material mistakes by requiring a human-reviewed production lock after measurements, leather, sole, stitching, fitting adjustments, and the latest customer approval are confirmed.',
          'Measure sizing errors, incorrect material choices, repeated fittings, wasted materials, revision count, and delayed orders during the pilot without unsupported percentage targets.',
        ];
      }

      if (
        /\b(?:painting instructions?|personalization details?|item sizes?|pickup dates?|misspelled names?)\b/u.test(
          specificationContext,
        )
      ) {
        return [
          'Detect outdated, incomplete, or conflicting ceramic-piece instructions before painting by comparing design references, color choices, item size, personalization text, painting instructions, and revision history.',
          'Compare sketches, photos, customer messages, color references, personalization proofs, and approval events so one final approved design is explicit for every piece.',
          'Prevent wrong colors, misspelled names, and avoidable rework by requiring a human-reviewed pre-paint approval lock before production starts.',
          'Measure incorrect colors, personalization errors, repeated work, wasted materials, revision count, and delayed customer pickup during the pilot without unsupported percentage targets.',
        ];
      }

      return [
        `Detect outdated, incomplete, or conflicting customer specifications before production by comparing ${workflowTerms.slice(0, 5).join(', ') || 'the active design, material, dimension, and revision records'}.`,
        'Compare revision history, customer messages, photos, samples, and approval events so one final approved production version is explicit.',
        'Prevent avoidable rework by requiring a human-reviewed production lock after the latest specification, material, dimension, and customer approval are confirmed.',
        `Measure rework, incorrect outcomes, wasted materials, revision count, and late completion during the pilot${painTerms.length ? `, including ${painTerms.slice(0, 3).join(', ')}` : ''}.`,
      ];
    }

    if (
      category === 'SERVICE_HISTORY' &&
      /\bclock repair\b/u.test(workflowTerms.join(' ').toLocaleLowerCase())
    ) {
      return [
        'Maintain one chronological service history for each clock by linking intake details, mechanical faults, diagnostic findings, previous repairs, replacement parts, restoration instructions, customer requests, cost approvals, and promised completion dates.',
        'Compare previous diagnostics and repair history before approving new work so recurring faults and already-replaced parts are visible to the specialist.',
        'Prevent incorrect parts, forgotten requests, and unexpected costs by requiring traceable customer approval for material, part, restoration-scope, or cost changes before work continues.',
        'Measure repeated diagnostics, incorrect replacement parts, forgotten customer requests, unexpected costs, rework, and delayed repairs during the pilot without unsupported percentage targets.',
      ];
    }

    if (
      category === 'SERVICE_HISTORY' &&
      /\b(?:fountain pen|pen condition|nib adjustments?|ink-flow diagnostics|writing preferences?)\b/u.test(
        workflowTerms.join(' ').toLocaleLowerCase(),
      )
    ) {
      return [
        'Maintain one chronological service history for each fountain pen by linking condition findings, nib adjustments, ink-flow diagnostics, replacement parts, previous repairs, restoration requests, writing preferences, and attachments.',
        'Compare prior diagnostics and repair outcomes before approving new work so recurring symptoms, already-replaced parts, and previous nib interventions are visible to the technician.',
        'Preserve customer writing preferences and requested adjustments across visits so technicians can reproduce the intended feel without repeated rediscovery or contradictory notes.',
        'Measure repeated diagnostics, incorrect parts, forgotten adjustments, unnecessary repairs, recurring faults, rework, and inconsistent restoration results during the pilot without unsupported percentage targets.',
      ];
    }

    return [
      features[0],
      features[1],
      features[2],
      features[4],
    ];
  }

  private static resolveDatabaseEntities(
    category: ReturnType<typeof this.resolveCategory>,
    workflowTerms: readonly string[],
    featureCapability: EvidenceFeatureCapabilityProfile | null,
  ): string[] {
    switch (category) {
      case 'FRAUD_INTEGRITY': {
        const fraudContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (
          /\b(?:shipment|shipments|warehouse|warehouses|driver|drivers|tracking updates?|delivery operations?|logistics|freight|cargo)\b/u.test(
            fraudContext,
          )
        ) {
          return ['ShipmentRecord', 'DriverAccessLog', 'WarehouseAccountEvent', 'TrackingUpdate', 'CustomerReport', 'SecurityAlert', 'InvestigationCase', 'ReviewDecision', 'AuditEvent'];
        }
        return ['TransactionEvent', 'IdentityCheck', 'AccessSignal', 'SecurityAlert', 'CitizenReport', 'InvestigationCase', 'ReviewDecision', 'AuditEvent'];
      }
      case 'ECOMMERCE_MARGIN_PROFITABILITY':
        return ['Product', 'SkuEconomicsSnapshot', 'OrderRevenue', 'DiscountAllocation', 'AdvertisingSpend', 'ReturnRefundCost', 'PaymentFee', 'ShippingFulfillmentCost', 'CampaignAttribution', 'CustomerCohort', 'MarginAnalysis', 'PricingScenario'];
      case 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE':
        return ['Subscriber', 'SubscriptionPlan', 'SubscriptionPayment', 'DiscountEvent', 'SupportInteraction', 'RenewalEvent', 'ProductUsageEvent', 'RefundEvent', 'CancellationEvent', 'ChurnRiskSnapshot', 'PlanProfitabilitySnapshot', 'RetentionOffer', 'RevenueForecast', 'ReviewDecision', 'AuditEvent'];
      case 'SUBSCRIPTION_ACCESS_REFUND':
        return ['CustomerAccount', 'Subscription', 'TrialEvent', 'ChargeEvent', 'AccessState', 'SupportContactAttempt', 'RefundRequest', 'CancellationAction', 'ResolutionDecision', 'AuditEvent'];
      case 'CUSTOMER_SUPPORT_ESCALATION':
        return ['SupportCase', 'CustomerContactAttempt', 'SupportChannel', 'BotResponse', 'HumanHandoff', 'EscalationEvent', 'CaseOwner', 'SlaDeadline', 'ResolutionEvent', 'CustomerFeedback', 'AuditEvent'];
      case 'ACCESS_CAPACITY_PLANNING':
        return ['AccessBarrier', 'ServiceDemandSignal', 'WaitIndicator', 'CapacitySnapshot', 'StaffAvailability', 'ResourceAvailability', 'InterventionPlan', 'ReviewDecision', 'FollowUpEvent'];
      case 'RISK_INTEGRITY_REVIEW':
        return ['RiskSubject', 'RiskSignal', 'EvidenceItem', 'SourceClaim', 'Relationship', 'ReviewerFinding', 'DueDiligenceDecision', 'FollowUpAction', 'AuditEvent'];
      case 'MUNICIPAL_WASTE_COORDINATION':
        return ['Neighborhood', 'WasteContainer', 'ContainerStatus', 'CollectionSchedule', 'CitizenComplaint', 'MunicipalVehicle', 'VehicleLocation', 'CollectionRoute', 'TrafficSnapshot', 'PickupPriority', 'ResourceAllocation', 'DispatchDecision', 'AuditEvent'];
      case 'COST_PERFORMANCE_INTELLIGENCE':
        return ['PerformancePeriod', 'RevenueRecord', 'CostRecord', 'BudgetItem', 'OperationalDriver', 'VarianceFinding', 'Scenario', 'PlanningDecision', 'AuditEvent'];
      case 'COMPLIANCE_GOVERNANCE_REVIEW':
        return ['Requirement', 'Policy', 'Control', 'EvidenceItem', 'ComplianceGap', 'ReviewDecision', 'RemediationAction', 'ApprovalEvent', 'AuditEvent'];
      case 'INCIDENT_EXCEPTION_RESOLUTION':
        return ['Incident', 'AffectedAsset', 'TriggerSignal', 'TimelineEvent', 'Dependency', 'RemediationAction', 'VerificationEvent', 'ReviewDecision', 'AuditEvent'];
      case 'QUALITY_RELIABILITY_IMPROVEMENT':
        return ['QualityIssue', 'AffectedItem', 'ProcessStep', 'EvidenceItem', 'RootCauseHypothesis', 'CorrectiveAction', 'VerificationEvent', 'QualityDecision', 'AuditEvent'];
      case 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS':
        return ['VisualizationFailureCase', 'ReactiveInputSnapshot', 'SelectedSeries', 'DataShapeSnapshot', 'PlotConfiguration', 'AestheticMapping', 'ReactiveDependency', 'DiagnosticFinding', 'CorrectionProposal', 'RenderVerification', 'ReviewDecision', 'AuditEvent'];
      case 'FEATURE_CAPABILITY_DELIVERY':
        return this.resolveEvidenceFeatureCapabilityEntities(featureCapability);
      case 'TIME_ACCESS_RECOVERY_PLANNING':
        return ['User', 'RecoveryPlan', 'AvailabilityWindow', 'ProtectedTimeWindow', 'WorkloadConstraint', 'AccessBarrier', 'PlanAdjustment', 'Escalation', 'RecoveryCheckIn', 'OutcomeEvent', 'AuditEvent'];
      case 'AI_HALLUCINATION_OUTPUT_RELIABILITY':
        return ['EvaluationCase', 'PromptInput', 'ModelProvider', 'ModelVersion', 'GeneratedOutput', 'FactualClaim', 'CitationReference', 'VerificationFinding', 'HallucinationFinding', 'ReviewDecision', 'CorrectionEvent', 'OutcomeEvent', 'AuditEvent'];
      case 'DATA_SYNC_FRESHNESS_RECOVERY':
        return ['SyncTarget', 'LocalDataVersion', 'RemoteDataVersion', 'SyncAttempt', 'FreshnessSnapshot', 'AppLifecycleEvent', 'ConnectivityState', 'SyncFailure', 'RecoveryAction', 'ConflictResolution', 'VerificationEvent', 'AuditEvent'];
      case 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY':
        return ['TransactionFailureCase', 'BlockchainNetwork', 'ProviderContext', 'SmartContract', 'ContractMethod', 'TransactionAttempt', 'TransactionReceipt', 'RevertFinding', 'ExecutionLog', 'GasEstimate', 'RemediationAction', 'RetryVerification', 'ReviewDecision', 'AuditEvent'];
      case 'PROBLEM_SPECIFIC_OPERATIONAL':
        return ['ProblemCase', 'AffectedWorkflow', 'Constraint', 'ResponseAction', 'RecoveryState', 'OwnerAssignment', 'EvidenceLink', 'OutcomeEvent', 'StatusEvent', 'AuditEvent'];
      case 'EVIDENCE_DECISION_REVIEW':
        return ['ProblemCase', 'EvidenceItem', 'SourceRecord', 'Hypothesis', 'ReviewDecision', 'ValidationAction', 'StatusEvent', 'AuditEvent'];
      case 'ORDER_DELIVERY_DISPUTE_INTEGRITY':
        return ['CustomerAccount', 'AccountAccessEvent', 'Order', 'OrderChangeEvent', 'PaymentReference', 'WarehouseEvent', 'ShippingAddressChange', 'CarrierScan', 'DeliveryConfirmation', 'RefundAction', 'DeliveryDispute', 'InvestigationDecision', 'AuditEvent'];
      case 'SHIPMENT_EXCEPTION_RECOVERY':
        return ['Shipment', 'TrackingEvent', 'CarrierScan', 'FacilityHandoff', 'CustodyPoint', 'ShipmentException', 'CustomerContact', 'InvestigationEvent', 'RecoveryAction', 'ResolutionDecision', 'AuditEvent'];
      case 'TOURISM_PROFITABILITY_INTELLIGENCE':
        return ['TourismService', 'TravelPackage', 'Booking', 'CustomerSpend', 'DiscountAllocation', 'PromotionCampaign', 'Cancellation', 'Refund', 'OperatingExpense', 'SeasonalDemandSnapshot', 'ProfitabilitySnapshot', 'RevenueForecast', 'PricingScenario'];
      case 'CYBERSECURITY_LEARNING_CONTENT_SAFETY':
        return ['Course', 'LearningAsset', 'ContentSource', 'SecurityTopic', 'RiskSignal', 'AudienceProfile', 'ReviewCase', 'ReviewDecision', 'ApprovedUsageCondition', 'AlternativeAsset', 'AuditEvent'];
      case 'GOVERNMENT_RECORD_ACCESS_INTEGRITY':
        return ['GovernmentRecord', 'RecordVersion', 'RecordAccessEvent', 'EmployeeActivityEvent', 'PermissionChange', 'SecurityAlert', 'IntegrityFinding', 'IncidentCase', 'InvestigationDecision', 'ComplianceException', 'AuditEvent'];
      case 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY':
        return ['AcademicAccount', 'LoginEvent', 'ExamSession', 'DeviceIdentity', 'PermissionSnapshot', 'SecurityAlert', 'RiskSignal', 'IntegrityCase', 'InvestigationDecision', 'AccessRestriction', 'ReviewEvent', 'AuditEvent'];
      case 'IDENTITY_ACCESS_GOVERNANCE':
        return ['EmployeeIdentity', 'EmploymentLifecycleEvent', 'RoleAssignment', 'DepartmentAssignment', 'SystemAccount', 'AccessEntitlement', 'LoginEvent', 'SecurityAlert', 'AccessReviewCase', 'RemediationDecision', 'AuditEvent'];
      case 'ACCOUNT_SECURITY_MONITORING':
        return ['Account', 'AuthenticationEvent', 'PermissionGrant', 'RoleChange', 'DeviceSignal', 'ActivitySignal', 'SecurityAlert', 'InvestigationCase', 'VerificationDecision', 'RemediationAction', 'AuditEvent'];
      case 'AUTH_ACCESS_RECOVERY':
        return ['AccessCase', 'AuthenticationAttempt', 'AuthenticationMethod', 'TwoFactorStatus', 'IdentityProviderEvent', 'SessionEvent', 'VerificationEvent', 'RecoveryAction', 'ReviewDecision', 'AuditEvent'];
      case 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION':
        return ['SupplyItem', 'DepartmentUsage', 'TreatmentVolume', 'ExpirationRisk', 'DisposalRecord', 'DisposalReason', 'EnvironmentalReport', 'ProcurementDecision', 'ComplianceConstraint', 'ReviewerDecision'];
      case 'MARKETPLACE_SELLER_TRUST':
        return ['SellerProfile', 'ListingSnapshot', 'RiskSignal', 'BuyerReport', 'TransactionOutcome', 'DisputeRecord', 'EvidenceSnapshot', 'ReviewerDecision', 'AuditEvent'];
      case 'PUBLIC_HEALTH_DEMAND_CAPACITY':
        return ['CommunityRegion', 'DemandSnapshot', 'AppointmentVolume', 'EmergencyVisitMetric', 'CapacitySnapshot', 'StaffAvailability', 'ResourcePool', 'DemandForecast', 'CapacityAlert', 'PlanningDecision'];
      case 'INDUSTRIAL_ENERGY_EQUIPMENT_HEALTH':
        return ['Factory', 'Machine', 'EquipmentSensor', 'EnergyReading', 'OperatingHourRecord', 'ProductionSchedule', 'MaintenanceRecord', 'EquipmentConditionSignal', 'EnergyAnomaly', 'MaintenanceReview', 'BreakdownEvent', 'AuditEvent'];
      case 'ENERGY_IOT_INCIDENT_ATTRIBUTION':
        return ['GridAsset', 'SmartMeter', 'TelemetryEvent', 'DeviceHealthEvent', 'NetworkEvent', 'ConsumptionAnomaly', 'AccessEvent', 'ControlEvent', 'IncidentCase', 'AttributionDecision', 'AuditEvent'];
      case 'URBAN_ENERGY_DEMAND_INTELLIGENCE':
        return ['UrbanEnergyAsset', 'PublicBuilding', 'StreetLightingZone', 'ChargingStation', 'EnergyConsumptionSnapshot', 'EquipmentStatusSnapshot', 'WeatherSnapshot', 'ServiceDemandSnapshot', 'DemandForecast', 'PeakLoadAlert', 'EfficiencyOpportunity', 'PlanningDecision'];
      case 'URBAN_MOBILITY_CONGESTION_EMISSIONS':
        return ['TransportCorridor', 'Route', 'TrafficFlowSnapshot', 'TransitDemandSnapshot', 'RoadIncident', 'TravelTimeMetric', 'EnvironmentalReading', 'EmissionEstimate', 'MobilityBottleneck', 'ImprovementScenario', 'PlanningDecision'];
      case 'DOLL_RESTORATION_SPECIFICATION':
        return ['Customer', 'DollItem', 'DamageAssessment', 'RestorationScopeVersion', 'FabricReference', 'ReplacementPart', 'PaintReference', 'MaterialSample', 'ApprovalEvent', 'RestorationStep', 'CompletionDeadline'];
      case 'MANUFACTURING_WASTE_SUSTAINABILITY':
        return ['ProductionStage', 'MachineOutput', 'ScrapRecord', 'QualityDefect', 'RawMaterialUsage', 'EnergyReading', 'EmissionEstimate', 'RootCauseReview'];
      case 'ENVIRONMENTAL_MONITORING':
        return ['Building', 'Zone', 'SensorSource', 'EnvironmentalReading', 'EquipmentReading', 'ConditionException', 'MaintenanceAction', 'AuditEvent'];
      case 'ROUTING_SUSTAINABILITY':
        return ['DeliveryRoute', 'DeliveryStop', 'TrafficSnapshot', 'FailedAttempt', 'FuelReading', 'EmissionEstimate', 'RouteException', 'ReviewDecision'];
      case 'SPECIFICATION_VERSIONING': {
        const specificationContext = workflowTerms.join(' ').toLowerCase();
        if (/\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conserv|paper conserv|document conserv|handwritten annotation|missing pages?)\b/u.test(specificationContext)) {
          return ['Client', 'MusicalManuscript', 'ConditionAssessment', 'PageRecord', 'AnnotationRecord', 'PreviousRepair', 'PaperCharacteristic', 'TreatmentPlanVersion', 'ClientInstruction', 'ApprovalEvent', 'RestorationStep', 'CompletionDeadline'];
        }
        if (/\b(?:scale requirements?|reference images?|paint details?|miniature|model)\b/u.test(specificationContext)) {
          return ['Customer', 'MiniatureCommission', 'ModelSpecificationVersion', 'ScaleDimensionSet', 'ReferenceImage', 'MaterialChoice', 'PaintSpecification', 'ApprovalEvent', 'ProductionLock', 'CompletionDeadline'];
        }
        if (/\b(?:engraving|engraver|artwork|font|placement|object dimension|spelling)\b/u.test(specificationContext)) {
          return ['Customer', 'EngravingOrder', 'ArtworkVersion', 'TextSpecification', 'MaterialReference', 'DimensionSet', 'PlacementProof', 'ApprovalEvent', 'ProductionLock', 'CompletionDeadline'];
        }
        if (/\b(?:mosaic|tile materials?|tile samples?|installation requirements?)\b/u.test(specificationContext)) {
          return ['Customer', 'MosaicCommission', 'DesignVersion', 'DesignReference', 'TileMaterial', 'ColorPalette', 'DimensionSet', 'InstallationRequirement', 'ApprovalEvent', 'ProductionLock', 'CompletionDeadline'];
        }
        if (/\b(?:ceramic|pottery|painting instructions?|personalization details?|item sizes?|misspelled names?|pickup dates?)\b/u.test(specificationContext)) {
          return ['Customer', 'CeramicPiece', 'DesignVersion', 'DesignReference', 'ColorPalette', 'SizeSpecification', 'PersonalizationProof', 'PaintingInstruction', 'ApprovalEvent', 'ProductionLock', 'PickupDeadline'];
        }
        if (/\b(?:furniture|wood type|wooden furniture|stain|wood finish|furniture refinishing|furniture restoration|furniture repair)\b/u.test(specificationContext)) {
          return ['Customer', 'FurniturePiece', 'ConditionAssessment', 'TreatmentVersion', 'StainFinishReference', 'MaterialSample', 'ApprovalEvent', 'RestorationStep', 'CompletionDeadline'];
        }
        if (/\b(?:fragrance|scent|formula|ingredient|concentration|bottle)\b/u.test(specificationContext)) {
          return ['Client', 'FragranceProject', 'FormulaVersion', 'FormulaIngredient', 'SampleFeedback', 'BottleSelection', 'ApprovalEvent', 'DeliveryDeadline'];
        }
        if (/\bcustom hat\b/u.test(specificationContext)) {
          return ['Customer', 'HatOrder', 'HeadMeasurementSet', 'HatSpecificationVersion', 'BrimSpecification', 'MaterialSelection', 'ColorPreference', 'DecorationDetail', 'FittingNote', 'ApprovalEvent', 'DeliveryDeadline'];
        }
        if (/\bcustom footwear\b/u.test(specificationContext)) {
          return ['Customer', 'FootwearOrder', 'FootMeasurementSet', 'FootwearSpecificationVersion', 'LeatherSelection', 'SoleSpecification', 'StitchingPreference', 'FittingNote', 'ApprovalEvent', 'CompletionDeadline'];
        }
        if (/\bcustom wig\b/u.test(specificationContext)) {
          return ['Client', 'WigOrder', 'MeasurementSet', 'WigSpecificationVersion', 'FittingNote', 'MaterialReference', 'ApprovalEvent', 'DeliveryDeadline'];
        }
        return ['Customer', 'WorkItem', 'SpecificationVersion', 'MaterialReference', 'ConditionNote', 'ApprovalEvent', 'WorkStep', 'CompletionDeadline'];
      }
      case 'SERVICE_HISTORY': {
        const serviceContext = workflowTerms.join(' ').toLocaleLowerCase();
        if (/\b(?:violin bow|bow condition|rehairing dates?|hair type preferences?)\b/u.test(serviceContext)) {
          return ['Customer', 'ViolinBow', 'BowConditionAssessment', 'RehairService', 'HairTypePreference', 'GripDetail', 'WindingDetail', 'RepairNote', 'MaterialRecord', 'CustomerRequest', 'ServiceEvent', 'Attachment'];
        }
        if (/\b(?:fountain pen|pen condition|nib adjustments?|ink-flow diagnostics|writing preferences?)\b/u.test(serviceContext)) {
          return ['Customer', 'FountainPen', 'PenConditionAssessment', 'NibAdjustment', 'InkFlowFinding', 'ReplacementPart', 'PreviousRepair', 'WritingPreference', 'RestorationRequest', 'ServiceEvent', 'Attachment'];
        }
        return /\bclock repair\b/u.test(serviceContext)
          ? ['Customer', 'ClockItem', 'ServiceCase', 'MechanicalFault', 'DiagnosticFinding', 'PreviousRepair', 'ReplacementPart', 'RestorationInstruction', 'CostApproval', 'CustomerRequest', 'RepairEvent', 'CompletionDeadline']
          : ['Customer', 'Asset', 'ServiceVisit', 'IssueFinding', 'WorkPerformed', 'PartRecord', 'Recommendation', 'FollowUp'];
      }
      case 'WORKFORCE_CAPACITY_CONTINUITY':
        return ['OrganizationalUnit', 'Role', 'StaffingSnapshot', 'WorkforceChange', 'Vacancy', 'CriticalRoleCoverage', 'WorkloadSnapshot', 'ServiceCapacityImpact', 'ContinuityThreshold', 'StaffingResponseAction', 'ReviewDecision', 'AuditEvent'];
      case 'STAFFING_PLANNING':
        return ['StaffMember', 'DemandItem', 'AvailabilityWindow', 'Assignment', 'WorkloadSnapshot', 'Conflict', 'AssignmentDecision', 'AuditEvent'];
      case 'GENERAL_OPERATIONAL':
        return ['Workspace', 'WorkItem', 'WorkflowRecord', 'ChangeEvent', 'Attachment', 'Assignment', 'StatusEvent', 'AuditEvent'];
    }
  }

  private static resolveMetrics(
    category: ReturnType<typeof this.resolveCategory>,
    painTerms: readonly string[],
    featureCapability: EvidenceFeatureCapabilityProfile | null,
    workflowTerms: readonly string[] = [],
  ): string[] {
    const pain = painTerms.slice(0, 4);
    const fraudContext = workflowTerms.join(' ').toLocaleLowerCase();
    const logisticsFraud =
      category === 'FRAUD_INTEGRITY' &&
      /\b(?:shipment|shipments|warehouse|warehouses|driver|drivers|tracking updates?|delivery operations?|logistics|freight|cargo)\b/u.test(
        fraudContext,
      );
    const base =
      category === 'FRAUD_INTEGRITY'
        ? logisticsFraud
          ? ['alert triage time', 'false-positive investigation time', 'unauthorized shipment-change resolution', 'delivery disruption duration', 'unresolved integrity cases']
          : ['investigation age', 'false-positive disposition time', 'blocked-legitimate-payment recovery', 'unresolved fraud cases']
        : category === 'ORDER_DELIVERY_DISPUTE_INTEGRITY'
          ? ['dispute reconstruction time', 'refund-abuse review', 'lost-merchandise cases', 'false-positive customer flags', 'unresolved delivery claims', 'investigation lead time']
        : category === 'SHIPMENT_EXCEPTION_RECOVERY'
          ? ['shipment exception age', 'recovery lead time', 'unresolved shipments', 'repeated customer contacts', 'facility dwell time', 'successful resolution']
        : category === 'ECOMMERCE_MARGIN_PROFITABILITY'
          ? ['contribution margin', 'campaign profit', 'return-cost impact', 'ad-spend efficiency', 'shipping-cost burden', 'margin-explanation time']
        : category === 'TOURISM_PROFITABILITY_INTELLIGENCE'
          ? ['service margin', 'seasonal margin variance', 'promotion ROI', 'cancellation/refund impact', 'revenue forecast error', 'operating-cost burden']
        : category === 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE'
          ? ['churn rate', 'renewal rate', 'retention-offer conversion', 'discount-cost impact', 'plan contribution margin', 'recurring-revenue forecast error']
        : category === 'SUBSCRIPTION_ACCESS_REFUND'
          ? ['refund resolution time', 'blocked-support cases', 'repeated contacts', 'unresolved charges', 'abandoned refund requests']
        : category === 'CUSTOMER_SUPPORT_ESCALATION'
          ? ['first human response time', 'escalation lead time', 'resolution time', 'repeated support contacts', 'bot-only loops', 'unresolved support cases']
        : category === 'ACCESS_CAPACITY_PLANNING'
          ? ['access delay', 'waiting-time direction', 'capacity pressure', 'resource coverage', 'unresolved access barriers', 'intervention follow-up']
        : category === 'RISK_INTEGRITY_REVIEW'
          ? ['review lead time', 'unresolved high-risk findings', 'evidence completeness', 'false-positive dispositions', 'follow-up closure']
        : category === 'MUNICIPAL_WASTE_COORDINATION'
          ? ['container overflow incidents', 'unnecessary collection trips', 'complaint backlog', 'route completion', 'vehicle utilization', 'operating-cost direction']
        : category === 'COST_PERFORMANCE_INTELLIGENCE'
          ? ['margin or cost variance', 'forecast error', 'unexplained spend', 'decision lead time', 'realized performance direction']
        : category === 'COMPLIANCE_GOVERNANCE_REVIEW'
          ? ['unresolved compliance gaps', 'evidence completeness', 'review lead time', 'overdue actions', 'repeat exceptions']
        : category === 'INCIDENT_EXCEPTION_RESOLUTION'
          ? ['detection-to-triage time', 'resolution time', 'repeated incidents', 'unresolved exceptions', 'verification completeness']
        : category === 'QUALITY_RELIABILITY_IMPROVEMENT'
          ? ['defect recurrence', 'rework', 'resolution lead time', 'unresolved quality issues', 'corrective-action effectiveness']
        : category === 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS'
          ? ['reproduced plotting failures', 'aesthetic mapping mismatches', 'data-shape mismatches', 'reactive-state defects', 'correction lead time', 'verified successful renders']
        : category === 'FEATURE_CAPABILITY_DELIVERY'
          ? [...(featureCapability?.metrics ?? ['feature adoption', 'successful use', 'user-reported usefulness', 'unresolved capability requests'])]
        : category === 'TIME_ACCESS_RECOVERY_PLANNING'
          ? ['protected-time attainment', 'missed recovery windows', 'unresolved time-access barriers', 'plan adjustments', 'recovery check-in completion', 'user-reported usefulness']
        : category === 'AI_HALLUCINATION_OUTPUT_RELIABILITY'
          ? ['hallucination findings', 'factual verification pass rate', 'unsupported claims', 'citation verification', 'reviewer correction rate', 'repeated reliability failures']
        : category === 'DATA_SYNC_FRESHNESS_RECOVERY'
          ? ['sync latency', 'stale-data exposure', 'failed refreshes', 'recovery time', 'repeated sync failures', 'freshness verification']
        : category === 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY'
          ? ['time-to-diagnosis', 'unresolved reverted transactions', 'repeat transaction failures', 'successful verified retries', 'missing revert context', 'remediation verification completeness']
        : category === 'WORKFORCE_CAPACITY_CONTINUITY'
          ? ['staffing coverage', 'vacancy age', 'workload concentration', 'critical-role gaps', 'service-capacity pressure', 'staffing-response lead time']
        : category === 'PROBLEM_SPECIFIC_OPERATIONAL'
          ? ['resolution time', 'unresolved blockers', 'repeated work', 'recovery progress', 'closure verification', 'user-reported usefulness']
        : category === 'EVIDENCE_DECISION_REVIEW'
          ? ['review lead time', 'evidence completeness', 'unresolved questions', 'repeated work', 'validation outcomes']
        : category === 'GOVERNMENT_RECORD_ACCESS_INTEGRITY'
          ? ['investigation lead time', 'unresolved suspicious changes', 'compromised-record findings', 'false-positive access alerts', 'compliance exceptions', 'reconstruction completeness']
        : category === 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY'
          ? ['investigation lead time', 'compromised-account findings', 'false-positive restrictions', 'unresolved security alerts', 'exam-integrity cases', 'evidence-correlation completeness']
        : category === 'IDENTITY_ACCESS_GOVERNANCE'
          ? ['stale-access findings', 'delayed deprovisioning', 'privilege-review age', 'investigation turnaround', 'false-positive disposition', 'unresolved access discrepancies']
        : category === 'ACCOUNT_SECURITY_MONITORING'
          ? ['investigation age', 'confirmed account-risk findings', 'false-positive reviews', 'delayed remediation', 'unresolved alerts', 'unnecessary restriction recovery']
        : category === 'AUTH_ACCESS_RECOVERY'
          ? ['successful recovery', 'repeated sign-in attempts', 'recovery time', 'unresolved access blockers', 'abandoned access workflows']
        : category === 'CYBERSECURITY_LEARNING_CONTENT_SAFETY'
          ? ['content review lead time', 'unsafe-content catches', 'false-positive reviews', 'unresolved learning assets', 'replacement effort', 'reviewer agreement']
        : category === 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION'
          ? ['expired-supply waste', 'disposal cost', 'avoidable waste', 'purchasing variance', 'environmental-impact direction', 'compliance exceptions']
        : category === 'MARKETPLACE_SELLER_TRUST'
          ? ['risky-listing review lead time', 'dispute rate', 'unresolved seller flags', 'false-positive assessments', 'evidence completeness']
        : category === 'PUBLIC_HEALTH_DEMAND_CAPACITY'
          ? ['demand-warning lead time', 'waiting-time direction', 'capacity pressure', 'staff coverage', 'resource redistribution response']
        : category === 'ENERGY_IOT_INCIDENT_ATTRIBUTION'
          ? ['incident attribution time', 'unresolved anomalies', 'inaccurate consumption readings', 'service disruption duration', 'false alarms', 'investigation effort']
        : category === 'URBAN_ENERGY_DEMAND_INTELLIGENCE'
          ? ['peak-demand forecast error', 'overloaded-infrastructure alerts', 'service interruptions', 'energy-cost direction', 'avoidable consumption', 'planning lead time']
        : category === 'URBAN_MOBILITY_CONGESTION_EMISSIONS'
          ? ['corridor delay', 'travel-time reliability', 'congestion duration', 'fuel-use direction', 'emissions direction', 'improvement-decision lead time']
        : category === 'DOLL_RESTORATION_SPECIFICATION'
          ? ['incorrect replacements', 'material mismatches', 'repeated work', 'lost details', 'revision count', 'delayed customer orders']
        : category === 'SPECIFICATION_VERSIONING'
          ? /\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conserv|paper conserv|document conserv|handwritten annotation|missing pages?)\b/u.test(workflowTerms.join(' ').toLocaleLowerCase())
            ? ['documentation gaps', 'lost annotations', 'duplicated work', 'incorrect treatment choices', 'material damage', 'project delay']
            : ['rework', 'incorrect outcomes', 'wasted materials', 'late orders']
          : category === 'MANUFACTURING_WASTE_SUSTAINABILITY'
            ? ['scrap rate', 'material yield', 'rework', 'energy intensity', 'emissions intensity']
          : category === 'ENVIRONMENTAL_MONITORING'
            ? /\b(?:noise sensors?|noise pollution|sound level readings?|traffic activity|construction schedules?|citizen complaints?)\b/u.test(workflowTerms.join(' ').toLocaleLowerCase())
              ? ['persistent hotspot age', 'complaint-to-sensor correlation', 'source-attribution confidence', 'enforcement response time', 'unresolved excessive-noise areas']
              : ['unresolved anomalies', 'maintenance response time', 'water waste', 'repeated abnormal conditions']
            : category === 'ROUTING_SUSTAINABILITY'
              ? ['mileage', 'fuel use', 'failed attempts', 'delivery delay', 'emissions direction']
              : ['resolution time', 'coordination errors', 'unresolved items', 'repeated work'];
    return [...new Set([...base, ...pain])].slice(0, 6);
  }

  private static resolveTargetUsers(
    category: ReturnType<typeof this.resolveCategory>,
    actor: string,
    baseLabel: string,
    featureCapability: EvidenceFeatureCapabilityProfile | null,
    workflowTerms: readonly string[] = [],
  ): string[] {
    if (category === 'FRAUD_INTEGRITY') {
      const fraudContext = workflowTerms.join(' ').toLocaleLowerCase();
      if (
        /\b(?:shipment|shipments|warehouse|warehouses|driver|drivers|tracking updates?|delivery operations?|logistics|freight|cargo)\b/u.test(
          fraudContext,
        )
      ) {
        return [
          'Logistics compliance and fraud-investigation analysts',
          'Warehouse security, fleet, and shipment-operations staff',
          'Authorized cybersecurity and operational-integrity reviewers',
        ];
      }
      return [
        'Government payment integrity and fraud analysts',
        'Public-service payment operations staff',
        'Authorized identity, cybersecurity, and investigation reviewers',
      ];
    }

    if (category === 'HEALTHCARE_MEDICAL_WASTE_OPTIMIZATION') {
      return [
        'Healthcare sustainability and medical-waste managers',
        'Hospital supply-chain, procurement, and inventory operations staff',
        'Authorized clinical-safety, infection-control, environmental, and compliance reviewers',
      ];
    }

    if (category === 'MARKETPLACE_SELLER_TRUST') {
      return [
        'Marketplace trust and safety analysts',
        'E-commerce seller-risk and listing-quality reviewers',
        'Authorized fraud, dispute, and customer-protection operations staff',
      ];
    }

    if (category === 'ECOMMERCE_MARGIN_PROFITABILITY') {
      return [
        'E-commerce finance and profitability analysts',
        'Merchandising, growth, and performance-marketing teams',
        'Authorized pricing, promotion, and commercial operations reviewers',
      ];
    }

    if (category === 'TOURISM_PROFITABILITY_INTELLIGENCE') {
      return [
        'Tourism finance and commercial performance analysts',
        'Tour operators, revenue managers, and promotion owners',
        'Authorized pricing, forecasting, and operating-cost reviewers',
      ];
    }

    if (category === 'SUBSCRIPTION_CHURN_RETENTION_INTELLIGENCE') {
      return [
        'Subscription business operations and customer-success teams',
        'Finance, recurring-revenue, and forecasting analysts',
        'Authorized pricing, retention, and plan-profitability reviewers',
      ];
    }

    if (category === 'SHIPMENT_EXCEPTION_RECOVERY') {
      return [
        'Logistics exception and shipment-recovery teams',
        'Carrier, warehouse, and customer-support operations staff',
        'Authorized investigation, reshipment, and refund reviewers',
      ];
    }

    if (category === 'CYBERSECURITY_LEARNING_CONTENT_SAFETY') {
      return [
        'Cybersecurity instructors and course-content owners',
        'Learning-platform safety and curriculum reviewers',
        'Authorized security, academic-integrity, and student-safety reviewers',
      ];
    }

    if (category === 'CUSTOMER_SUPPORT_ESCALATION') {
      return [
        `${baseLabel} customer-support operations teams`,
        `${baseLabel} service-recovery and escalation staff`,
        'Authorized human-support, SLA, and case-resolution reviewers',
      ];
    }

    if (category === 'WORKFORCE_CAPACITY_CONTINUITY') {
      return [
        `${baseLabel} workforce and service-continuity planners`,
        `${baseLabel} operational leaders responsible for staffing, workload, and critical-role coverage`,
        'Authorized HR, finance, service-delivery, and continuity reviewers responsible for staffing-response decisions',
      ];
    }

    if (category === 'ACCESS_CAPACITY_PLANNING') {
      return [
        `${baseLabel} service-access and operations planners`,
        `${baseLabel} capacity, staffing, and resource owners`,
        'Authorized reviewers responsible for access-improvement and resource decisions',
      ];
    }

    if (category === 'RISK_INTEGRITY_REVIEW') {
      return [
        `${baseLabel} risk, trust, or due-diligence analysts`,
        `${baseLabel} operational and security reviewers`,
        'Authorized governance, compliance, investigation, or integrity decision makers',
      ];
    }

    if (category === 'MUNICIPAL_WASTE_COORDINATION') {
      return [
        `${baseLabel} sanitation operations managers`,
        `${baseLabel} municipal fleet dispatchers and route planners`,
        'Authorized public-works reviewers responsible for pickup priority and resource allocation',
      ];
    }

    if (category === 'COST_PERFORMANCE_INTELLIGENCE') {
      return [
        `${baseLabel} finance and performance analysts`,
        `${baseLabel} operational owners and planners`,
        'Authorized budget, pricing, resource, or performance reviewers',
      ];
    }

    if (category === 'COMPLIANCE_GOVERNANCE_REVIEW') {
      return [
        `${baseLabel} compliance and governance teams`,
        `${baseLabel} policy, records, or control owners`,
        'Authorized legal, audit, approval, and remediation reviewers',
      ];
    }

    if (category === 'INCIDENT_EXCEPTION_RESOLUTION') {
      return [
        `${baseLabel} incident and exception operations teams`,
        `${baseLabel} technical or service owners`,
        'Authorized triage, escalation, remediation, and closure reviewers',
      ];
    }

    if (category === 'QUALITY_RELIABILITY_IMPROVEMENT') {
      return [
        `${baseLabel} quality and reliability teams`,
        `${baseLabel} operational or process owners`,
        'Authorized root-cause, corrective-action, and verification reviewers',
      ];
    }

    if (category === 'DATA_VISUALIZATION_REACTIVE_DIAGNOSTICS') {
      return [
        `${baseLabel} analytics and visualization workflow owners`,
        `${baseLabel} users affected by reactive chart or multi-series plotting failures`,
        'Authorized data-shape, visualization-configuration, and render-verification reviewers',
      ];
    }

    if (category === 'FEATURE_CAPABILITY_DELIVERY') {
      return [
        `${baseLabel} product and service owners`,
        `${baseLabel} users affected by the ${featureCapability?.label.toLocaleLowerCase() ?? 'requested capability'}`,
        'Authorized product, content, operations, or experience reviewers responsible for the requested capability',
      ];
    }

    if (category === 'TIME_ACCESS_RECOVERY_PLANNING') {
      return [
        'People managing mental-health recovery within constrained workdays',
        'Mental Health wellbeing, access, or support program coordinators',
        'Authorized human reviewers responsible for recovery-plan support and escalation',
      ];
    }

    if (category === 'AI_HALLUCINATION_OUTPUT_RELIABILITY') {
      return [
        `${baseLabel} AI product, model-quality, and reliability teams`,
        `${baseLabel} users and operational reviewers affected by unreliable or hallucinated AI outputs`,
        'Authorized factuality, safety, output-verification, and human-review specialists responsible for verification and correction',
      ];
    }

    if (category === 'DATA_SYNC_FRESHNESS_RECOVERY') {
      return [
        `${baseLabel} application and data-reliability teams`,
        `${baseLabel} product or operations owners responsible for current synchronized data`,
        'Authorized support and engineering reviewers responsible for synchronization recovery and freshness verification',
      ];
    }

    if (category === 'BLOCKCHAIN_TRANSACTION_EXECUTION_RECOVERY') {
      return [
        `${baseLabel} smart-contract and Web3 developers`,
        `${baseLabel} blockchain integration and transaction-operations engineers`,
        'Authorized technical reviewers responsible for transaction remediation, safe retry, and execution verification',
      ];
    }

    if (category === 'PROBLEM_SPECIFIC_OPERATIONAL') {
      return [
        `${baseLabel} users directly affected by the retained problem`,
        `${baseLabel} operational owners responsible for response and recovery`,
        'Authorized human reviewers responsible for escalation, exception handling, and closure',
      ];
    }

    if (category === 'EVIDENCE_DECISION_REVIEW') {
      return [
        `${baseLabel} problem-discovery and operations leads`,
        `${baseLabel} subject-matter reviewers`,
        'Authorized evidence, validation, and decision reviewers',
      ];
    }

    if (category === 'SUBSCRIPTION_ACCESS_REFUND') {
      return [
        `${baseLabel} billing and subscription support teams`,
        `${baseLabel} account-access and customer-resolution staff`,
        'Authorized refund, cancellation, and escalation reviewers',
      ];
    }

    if (category === 'ORDER_DELIVERY_DISPUTE_INTEGRITY') {
      return [
        'E-commerce order integrity and fraud operations teams',
        'Logistics, fulfillment, and delivery-dispute investigators',
        'Authorized account-security, customer-support, and refund reviewers',
      ];
    }

    if (category === 'GOVERNMENT_RECORD_ACCESS_INTEGRITY') {
      return [
        'Government records, licensing, and regulatory operations teams',
        'Public-sector security, identity, and incident investigators',
        'Authorized legal, compliance, audit, and records-integrity reviewers',
      ];
    }

    if (category === 'ACADEMIC_PLATFORM_SECURITY_INTEGRITY') {
      return [
        `${baseLabel} learning-platform security and identity operations teams`,
        `${baseLabel} online-assessment and record-integrity incident reviewers`,
        'Authorized education IT, cybersecurity, administrative-account, and student-access reviewers',
      ];
    }

    if (category === 'IDENTITY_ACCESS_GOVERNANCE') {
      return [
        'Human resources and people-operations administrators',
        'Identity and access management or IT access-control teams',
        'Authorized information-security and compliance reviewers',
      ];
    }

    if (category === 'ACCOUNT_SECURITY_MONITORING') {
      return [
        'Account and portal operations administrators',
        'Information-security and identity-risk analysts',
        'Authorized support, compliance, and investigation reviewers',
      ];
    }

    if (category === 'AUTH_ACCESS_RECOVERY') {
      return [
        `${baseLabel} account-access operations staff`,
        `${baseLabel} identity and authentication support reviewers`,
        'Authorized security and account-recovery administrators',
      ];
    }

    if (category === 'PUBLIC_HEALTH_DEMAND_CAPACITY') {
      return [
        'Public-health demand and capacity planners',
        'Hospital and clinic operations coordinators',
        'Authorized regional resource-allocation and health-system reviewers',
      ];
    }

    if (category === 'ENERGY_IOT_INCIDENT_ATTRIBUTION') {
      return [
        'Energy utility operations and smart-meter monitoring teams',
        'OT/IoT reliability and cybersecurity incident analysts',
        'Authorized grid operations and security reviewers',
      ];
    }

    if (category === 'URBAN_ENERGY_DEMAND_INTELLIGENCE') {
      return [
        'Smart-city energy and infrastructure planners',
        'Municipal facilities, street-lighting, and charging-infrastructure operations teams',
        'Authorized energy-efficiency, resilience, and public-service planning reviewers',
      ];
    }

    if (category === 'URBAN_MOBILITY_CONGESTION_EMISSIONS') {
      return [
        'Urban transportation and mobility planners',
        'Traffic and public-transit operations analysts',
        'Authorized environmental and transportation improvement reviewers',
      ];
    }

    if (category === 'DOLL_RESTORATION_SPECIFICATION') {
      return [
        'Doll restoration specialists and workshop owners',
        'Restoration technicians responsible for materials, parts, paint, and treatment notes',
        'Authorized customer-approval and quality reviewers',
      ];
    }

    const cleanActor = this.normalize(actor).replace(/^independent\s+/iu, '').trim();
    const actorLabel = cleanActor || baseLabel;
    return [
      `${this.toTitleCase(actorLabel)} owners or operations leads`,
      `${this.toTitleCase(actorLabel)} frontline practitioners`,
      'Authorized reviewers responsible for approvals, exceptions, or customer changes',
    ];
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}\s&/'’:-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static toTitleCase(value: string): string {
    return value
      .split(/\s+/u)
      .filter(Boolean)
      .map((token) => `${token.charAt(0).toLocaleUpperCase()}${token.slice(1)}`)
      .join(' ');
  }
}
