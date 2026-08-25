import { RequestWorkflowArchetypeUtil } from './request-workflow-archetype.util';
import { RequestDynamicQueryUtil } from './request-dynamic-query.util';
import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';
import { RequestNicheCustomCraftUtil } from './request-niche-custom-craft.util';
import { RequestOnlinePharmacyFraudUtil } from './request-online-pharmacy-fraud.util';
import { RequestOperationalCostAttributionUtil } from './request-operational-cost-attribution.util';

export class RequestEvidenceAlignmentUtil {
  static isAligned(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    const planned = this.normalize((input.plannedQueries ?? []).join(' '));

    if (!request || !evidence) return false;

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (
      archetype.archetype !== 'DEVELOPER_TECHNICAL' &&
      this.isDeveloperOnlyEvidence(evidence)
    ) {
      return false;
    }

    if (archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS') {
      return this.isFoodStorageConditionEvidence(request, evidence);
    }

    if (this.isLogisticsShipmentIntegrityRequest(request)) {
      return this.isLogisticsShipmentIntegrityEvidence(evidence);
    }

    if (this.isBookRestorationRequest(request)) {
      return this.isBookRestorationSupportingEvidence(evidence);
    }

    if (this.isRestorationConservationRequest(request, input.plannedQueries ?? [])) {
      return this.isRestorationConservationEvidence(request, evidence);
    }

    if (archetype.archetype === 'TRANSACTION_ACCOUNT_ABUSE_OPERATIONS') {
      return this.isTransactionAccountAbuseDirectEvidence(request, evidence);
    }

    if (this.isAgriculturalDistributionProfitabilityRequest(request)) {
      return this.isAgriculturalDistributionProfitabilityEvidence(evidence);
    }

    if (this.isAgriculturalExportProfitabilityRequest(request)) {
      return this.isAgriculturalExportProfitabilityEvidence(evidence);
    }

    if (this.isEyeglassFrameRepairRequest(request)) {
      return this.isEyeglassFrameRepairEvidence(evidence);
    }

    if (this.isRestaurantDeliveryFraudRequest(request)) {
      return this.isRestaurantDeliveryFraudSupportingEvidence(evidence);
    }

    if (this.isMunicipalCorridorCongestionRequest(request)) {
      return this.isMunicipalCorridorCongestionEvidence(evidence);
    }

    if (this.isBookEdgeGildingRequest(request)) {
      return this.isBookEdgeGildingEvidence(evidence);
    }

    if (this.isEnterpriseEmployeeAccessSecurityRequest(request)) {
      return this.isEnterpriseEmployeeAccessSecurityEvidence(evidence);
    }

    if (this.isHealthcareBillingFraudSecurityRequest(request)) {
      return this.isHealthcareBillingFraudSecurityEvidence(evidence);
    }

    if (this.isGovernmentPaymentFraudRequest(request)) {
      return this.isGovernmentPaymentFraudEvidence(evidence);
    }

    if (this.isGovernmentRecordAccessIntegrityRequest(request)) {
      return this.isGovernmentRecordAccessIntegrityEvidence(evidence);
    }

    if (this.isHomeRemoteMedicalDeviceTrustRequest(request)) {
      return this.isHomeRemoteMedicalDeviceTrustEvidence(evidence);
    }

    if (this.isAcademicPlatformSecurityRequest(request)) {
      return this.isAcademicPlatformSecurityEvidence(evidence);
    }

    if (this.isDecorativeFountainRestorationRequest(request)) {
      return this.isDecorativeFountainRestorationEvidence(evidence);
    }

    if (this.isAcademicStaffingWorkloadRequest(request)) {
      return this.isAcademicStaffingWorkloadEvidence(evidence);
    }

    if (this.isPetTrainerBehaviorTrackingRequest(request)) {
      return this.isPetTrainerBehaviorTrackingEvidence(evidence);
    }

    if (this.isEnergyIotSecurityRequest(request)) {
      return this.isEnergyIotSecurityEvidence(evidence);
    }

    if (this.isUrbanEnergyDemandRequest(request)) {
      return this.isUrbanEnergyDemandEvidence(evidence);
    }

    if (this.isDollRestorationRequest(request)) {
      return this.isDollRestorationEvidence(evidence);
    }

    if (this.isUrbanMobilityCongestionEmissionsRequest(request)) {
      return this.isUrbanMobilityCongestionEmissionsEvidence(evidence);
    }

    if (this.isBuildingEnvironmentalMonitoringRequest(request)) {
      return this.isBuildingEnvironmentalMonitoringEvidence(evidence);
    }

    if (this.isDeliveryFuelEmissionsRequest(request)) {
      return this.isDeliveryFuelEmissionsEvidence(evidence);
    }

    if (RequestOnlinePharmacyFraudUtil.isRequest(request)) {
      return RequestOnlinePharmacyFraudUtil.isDirectEvidence(request, evidence);
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isDirectEvidence(request, evidence);
    }

    if (this.isCustomFootwearSpecificationRequest(request)) {
      return this.isCustomFootwearSpecificationEvidence(evidence);
    }

    if (this.isHeadwearSpecificationRequest(request)) {
      return this.isHeadwearSpecificationEvidence(evidence);
    }

    if (this.isWigMakerSpecificationRequest(request)) {
      return this.isWigMakerSpecificationEvidence(evidence);
    }

    if (this.isEcommerceProfitabilityRequest(request)) {
      return this.isEcommerceProfitabilityEvidence(evidence);
    }

    if (this.isMediaContentProfitabilityRequest(request)) {
      return this.isMediaContentProfitabilityEvidence(evidence);
    }

    if (this.isMunicipalWasteCollectionRequest(request)) {
      return this.isMunicipalWasteCollectionEvidence(evidence);
    }

    if (this.isMusicalManuscriptRestorationRequest(request)) {
      return this.isMusicalManuscriptRestorationEvidence(evidence);
    }

    if (this.isLogisticsProfitabilityRequest(request)) {
      return this.isLogisticsProfitabilityEvidence(evidence);
    }

    if (this.isPublicTransportationProfitabilityRequest(request)) {
      return this.isPublicTransportationProfitabilityEvidence(evidence);
    }

    if (this.isTransportationProfitabilityRequest(request)) {
      return this.isTransportationProfitabilityEvidence(evidence);
    }

    if (this.isBookCoverCommissionRequest(request)) {
      return this.isBookCoverCommissionEvidence(evidence);
    }

    if (this.isBridalAlterationWorkflowRequest(request)) {
      return this.isBridalAlterationWorkflowEvidence(evidence);
    }

    if (this.isClockRepairServiceHistoryRequest(request)) {
      return this.isClockRepairServiceHistoryEvidence(evidence);
    }

    if (this.isRestaurantProfitabilityRequest(request)) {
      return this.isRestaurantProfitabilityEvidence(evidence);
    }

    if (this.isPetBoardingCareRequest(request)) {
      return this.isPetBoardingCareEvidence(evidence);
    }

    if (this.isManufacturingCostProfitabilityRequest(request)) {
      return this.isManufacturingCostProfitabilitySupportingEvidence(evidence);
    }

    if (this.isTourismCrowdingRequest(request)) {
      const tourismAnchor =
        /\b(?:tourism|tourist|tourists|visitor|visitors|destination|destinations|attraction|attractions|tourism surge|overtourism|tourism hub|transportation hub|public space)\b/iu.test(evidence);
      const crowdingAnchor =
        /\b(?:overcrowd|overcrowded|crowding|crowded|congestion|congested|long wait|waiting time|queues?|visitor pressure|capacity pressure|service quality concern|visitor experience|tourism surge|peak visitor|too many visitors|packed)\w*\b/iu.test(evidence);
      const operationalImpact =
        /\b(?:service quality|visitor experience|transport|public space|local service|capacity|resource|support|delay|wait|queue|pressure|management|city|destination|attraction)\w*\b/iu.test(evidence);
      return tourismAnchor && crowdingAnchor && operationalImpact;
    }

    if (this.isPublicProgramCostAttributionRequest(request)) {
      return this.isPublicProgramCostAttributionDirectEvidence(evidence);
    }

    if (RequestOperationalCostAttributionUtil.resolve(request)) {
      return RequestOperationalCostAttributionUtil.isDirectEvidence(request, evidence);
    }

    if (this.isPublicFiscalOversightRequest(request)) {
      const publicActor =
        /\b(?:government|government agency|government agencies|government department|government departments|public institution|public institutions|public sector|public administration|municipal|municipality|ministry|ministries|taxpayer|taxpayers|public authority|public authorities|public agency|public agencies|county|counties|city government|city council|state government|federal government|treasury|public office|public offices|public body|public bodies)\b/iu.test(evidence);
      const fiscalWorkflow =
        /\b(?:public budget|public budgets|public funds|government spending|public spending|procurement|procurement record|procurement records|public contract|public contracts|government contract|government contracts|contract spending|invoice|invoices|payment|payments|disbursement|disbursements|accounts payable|project expense|project expenses|grant spending|approval history|approval histories|expenditure|expenditures|audit|auditing|budget planning|financial management|vendor payment|vendor payments|supplier payment|supplier payments)\b/iu.test(evidence);
      const fiscalFriction =
        /(?:\b(?:unusual|suspicious|anomalous?|abnormal)\b.{0,32}\b(?:spending|payment|payments|transaction|transactions|expenditure)\b|\b(?:duplicate|double)\b.{0,32}\b(?:payment|invoice)s?\b|\b(?:overpayment|overpayments|overspend|overspending|waste|wasted funds|wasteful spending|fraud|fraudulent|corruption|corrupt|embezzlement|kickback|kickbacks|irregular expenditure|financial irregularity|financial irregularities|inefficient spending|misuse|misallocation|budget overrun|budget overruns|cost overrun|cost overruns|improper payment|improper payments|unauthorized payment|unauthorized payments|questionable payment|questionable payments|reconciliation mismatch|audit finding|audit findings|procurement scandal|procurement fraud|procurement abuse|scandal|suspicious transaction|suspicious transactions)\b|\b(?:investigation|investigations|probe|probes|audit|audits|review)\b.{0,100}\b(?:payment|payments|spending|procurement|expenditure|funds?|contracts?)\b|\b(?:payment|payments|spending|procurement|expenditure|funds?|contracts?)\b.{0,100}\b(?:investigation|investigations|probe|probes|audit|audits|review)\b)/iu.test(evidence);
      const healthcareCollision =
        /\b(?:patient|patients|member complaint|member complaints|healthcare finance|health insurance|medical billing|hospital billing)\b/iu.test(evidence) &&
        !/\b(?:government|public sector|public institution|public funds|public budget|government spending|procurement|taxpayer)\b/iu.test(evidence);
      return publicActor && fiscalWorkflow && fiscalFriction && !healthcareCollision;
    }

    if (this.isTransitCyberIncidentRequest(request)) {
      const transitAnchor =
        /\b(?:public transportation|public transport|transit|transit agency|transit operator|bus|rail|metro|ticketing|fare system|fare payment|passenger app|vehicle telemetry|connected vehicle)\w*\b/iu.test(evidence);
      const securityOrFailureAnchor =
        /\b(?:unusual login|login anomal|authentication|account compromise|payment anomal|fraud|device behavior|telemetry anomal|service disruption|outage|technical failure|cyberattack|cyber attack|cybersecurity|security incident|incident response|malicious activity|misuse)\w*\b/iu.test(evidence);
      const investigationAnchor =
        /\b(?:investigat|triage|correlat|root cause|distinguish|diagnos|anomaly detection|risk scoring|incident categor|false positive|security alert)\w*\b/iu.test(evidence);
      const travelPlanningCollision =
        /\b(?:hotel|accommodation|tour package|travel booking|trip planning|booking platform|local experience)\b/iu.test(evidence) &&
        !transitAnchor;
      return transitAnchor && securityOrFailureAnchor && (investigationAnchor || /\b(?:delay|loss|compromised|interruption|disruption)\w*\b/iu.test(evidence)) && !travelPlanningCollision;
    }


    if (this.isPublicTransitDisruptionCoordinationRequest(request)) {
      return this.isPublicTransitDisruptionCoordinationEvidence(evidence);
    }

    if (this.isInstrumentCaseSpecificationRequest(request)) {
      return this.isInstrumentCaseSpecificationEvidence(evidence);
    }

    if (this.isTattooDesignApprovalRequest(request)) {
      return this.isTattooDesignApprovalEvidence(evidence);
    }

    if (this.isCustomCraftOrderRequest(request)) {
      const craftAnchor = this.matchesCustomCraftActor(request, evidence);
      const orderWorkflow =
        /\b(?:custom order|commission|customer artwork|artwork|design reference|design revision|revision|approved version|approval|approved specification|final specification|dimension|measurement|material|leather|thread color|stitching|hardware|engraving|placement instruction|fragrance|scent|wax|container size|label design|label|color preference|quantity|order quantity|deadline|delivery deadline|customer message|chat message|handwritten note|sketch|sample)\w*\b/iu.test(evidence);
      const requestSpecificWorkflow =
        /\b(?:custom order|commission|customer artwork|design revision|revision|approved version|approval|approved specification|final specification|dimension|measurement|stitching|hardware|engraving|thread color|placement instruction|fragrance|scent|wax|container size|label design|label|color preference|quantity|order quantity|delivery deadline|customer message|chat message|handwritten note)\w*\b/iu.test(evidence);
      const frictionAnchor =
        /\b(?:wrong|incorrect|missed|missing|forgotten|lost|scattered|outdated|rework|repeat work|repeated work|waste|wasted|delay|delayed|mistake|miscommunication|harder to organize|hard to organize|difficult to organize|wrong material|missed customization|unapproved|old version)\w*\b/iu.test(evidence);
      const developerContamination = this.isDeveloperOnlyEvidence(evidence);
      return craftAnchor && orderWorkflow && requestSpecificWorkflow && frictionAnchor && !developerContamination;
    }

    if (this.isMunicipalInfrastructureMaintenanceRequest(request)) {
      const municipalAnchor =
        /\b(?:municipal|municipality|city government|city council|public works|city infrastructure|public infrastructure|roads?|roadway|streetlights?|street lights?|public spaces?|city streets?|neighborhood infrastructure)\b/iu.test(evidence);
      const maintenanceAnchor =
        /\b(?:maintenance|repair|repairs|repairing|maintenance request|service request|inspection|repair history|maintenance backlog|road delay|streetlight repair|infrastructure repair|work order|asset maintenance)\w*\b/iu.test(evidence);
      const frictionAnchor =
        /\b(?:delay|delayed|overdue|backlog|repeat|repeated complaints?|complaints?|urgent|priority|prioritization|lower[- ]priority|inefficient|waste|cost|costs|spending|double repair cost|deteriorat|unaddressed|unresolved|slow response|resource allocation)\w*\b/iu.test(evidence);
      return municipalAnchor && maintenanceAnchor && frictionAnchor;
    }

    if (this.isCostumeRentalRequest(request)) {
      const directActor =
        /\b(?:costume rental|costume rentals|costume shop|costume shops|costume hire|wardrobe rental|wardrobe rentals|theatrical costume|theatre costume|theater costume|costume department|costume departments)\b/iu.test(evidence);
      const adjacentActor =
        /\b(?:formalwear rental|formal wear rental|tuxedo rental|suit rental|dress rental|clothing rental|garment rental|rental boutique|theatrical wardrobe|theatre wardrobe|theater wardrobe)\b/iu.test(evidence);
      const workflowAnchor =
        /\b(?:reservation|reservations|booking|bookings|measurement|measurements|size|sizes|fitting|fittings|accessor(?:y|ies)|alteration|alterations|return date|return dates|garment condition|condition check|damage|pickup|pick up|outfit|outfits|costume|wardrobe|event requirement|event date)\w*\b/iu.test(evidence);
      const frictionAnchor =
        /\b(?:missing|lost|wrong|incorrect|double book|double-book|duplicate reservation|overbook|unavailable|damaged|damage unnoticed|late|delay|delayed|missed|forgotten|size mismatch|wrong size|accessor(?:y|ies) missing|not returned|overdue|miscommunication|scattered|paper form)\w*\b/iu.test(evidence);
      return (directActor || adjacentActor) && workflowAnchor && frictionAnchor;
    }

    if (this.isCommercialBuildingEnergyRequest(request)) {
      const buildingAnchor = /\b(?:commercial building|office building|office complex|facility|facilities|facility manager|building operator|building manager)\b/iu.test(evidence);
      const energyAnchor = /\b(?:electricity|energy|utility bill|smart meter|submeter|hvac|heating|elevator|lighting|office equipment|power consumption|meter reading)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:high bill|cost spike|consumption spike|sudden increase|abnormal usage|anomal|inefficient|waste|fragment|separate systems?|limited visibility|hard to identify|difficult to identify|fault|failure|downtime|unexpected consumption|excess consumption)\w*\b/iu.test(evidence);
      return buildingAnchor && energyAnchor && frictionAnchor;
    }

    if (this.isCakeDecoratorRequest(request)) {
      const cakeActor = /\b(?:cake decorator|cake decorating|custom cake|home baker|independent baker|cake artist|bakery decorator|wedding cake|birthday cake|cake business)\b/iu.test(evidence);
      const workflowAnchor = /\b(?:custom order|cake design|design reference|flavor|flavour|allergy|dietary requirement|dimension|size|decoration|pickup|revision|approved design|approval|customer message|chat message|photo|sketch|handwritten note)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:wrong|incorrect|missed|forgotten|overlooked|lost|scattered|outdated|last minute|last-minute|rework|remake|repeat work|waste|wasted ingredient|delay|delayed|allergy mistake|dietary mistake|miscommunication|not updated)\w*\b/iu.test(evidence);
      return cakeActor && workflowAnchor && frictionAnchor;
    }

    if (this.isCalligraphyCommissionRequest(request)) {
      const directActor = /\b(?:calligraphy|calligrapher|lettering artist|hand lettering|custom stationery)\b/iu.test(evidence);
      const adjacentCreativeActor = /\b(?:commissioned art|art commission|commissioned artwork|freelance artist|independent artist|graphic designer|illustrator|custom designer|stationery designer)\b/iu.test(evidence);
      const workflowAnchor = /\b(?:commission|custom order|client instruction|wording|revision|approved version|approval|design version|reference example|paper|ink|dimension|deadline|client message|dm|direct message)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:wrong wording|missed revision|overlooked change|lost note|scattered message|outdated version|wrong version|rework|repeat work|wasted material|wasted paper|wasted ink|delay|delayed|deadline|miscommunication|forgotten|incorrect|mistake)\w*\b/iu.test(evidence);
      return (directActor || adjacentCreativeActor) && workflowAnchor && frictionAnchor;
    }

    if (this.isConnectedAssetSecurityRequest(request)) {
      const operationalAnchor = /\b(?:farm|farming|agriculture|irrigation|greenhouse|livestock|factory|industrial|facility|warehouse|utility|connected equipment)\b/iu.test(evidence);
      const deviceAnchor = /\b(?:iot|internet of things|sensor|telemetry|connected device|controller|remote monitoring|device health|equipment|network)\b/iu.test(evidence);
      const frictionAnchor = /\b(?:fail|failure|outage|disconnect|connectivity|network disruption|unauthorized|attack|malicious|security|anomal|fault|downtime|damage|waste|loss|blind spot|visibility|incident)\w*\b/iu.test(evidence);
      if (!operationalAnchor || !deviceAnchor || !frictionAnchor) return false;
      return true;
    }

    if (this.isProfessionalEvidenceRecordsRequest(request)) {
      const professionalOrObjectAnchor = /\b(?:apprais|appraiser|valuation|antique|artifact|artwork|auction|provenance|genealog|family history|archiv|historical record|conservator|collection)\w*\b/iu.test(evidence);
      const recordAnchor = /\b(?:provenance|record|document|archive|ownership history|chain of custody|authenticity|valuation|restoration|citation|source|evidence|history|certificate|catalog)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:missing|gap|blind spot|scattered|fragment|conflict|inconsisten|duplicate|duplicated|difficult|uncertain|dispute|overlook|trace|verify|verification|poorly documented|incomplete)\w*\b/iu.test(evidence);
      if (!professionalOrObjectAnchor || !recordAnchor || !frictionAnchor) return false;
      return true;
    }

    if (this.isMusicalRepairRequest(request)) {
      const instrumentAnchor = /\b(?:musical instrument|instrument|guitar|violin|viola|cello|piano|brass|woodwind|saxophone|clarinet|trumpet|luthier)\b/iu.test(evidence);
      const repairWorkflowAnchor = /\b(?:repair|repairs|repairing|repair shop|luthier|technician|tuner|tuning|service history|tuning history|work order|service ticket|parts?|replacement part|replaced part|intake|bench notes?|repair status|maintenance recommendation|follow[- ]up visit|mechanical problem|room condition|humidity|customer preference|instrument tracking)\w*\b/iu.test(evidence);
      const recordOrFrictionAnchor = /\b(?:history|record|records|notes?|paper invoice|handwritten|message|missing|forgotten|repeat|repeated|diagnos|unnecessary|inconsistent|follow[- ]up|maintenance|replaced|replacement|mechanical|condition|humidity)\w*\b/iu.test(evidence);
      if (!instrumentAnchor || !repairWorkflowAnchor || !recordOrFrictionAnchor) return false;
      if (/\bvirtual musical instruments?\b/iu.test(evidence) && !repairWorkflowAnchor) return false;
    }

    if (this.isMunicipalDeviceSecurityRequest(request)) {
      const infrastructureAnchor = /\b(?:smart cit(?:y|ies)|municipal|city network|public infrastructure|traffic lights?|traffic signals?|parking sensors?|public cameras?|environmental monitors?|connected devices?|iot devices?|sensors?|municipal devices?)\b/iu.test(evidence);
      const securityAnchor = /\b(?:security|cyber|unauthorized|unmanaged|outdated|firmware|compromised|vulnerab|anomal|unusual behavior|device behavior|intrusion|breach|attack|hack|visibility|inventory|unknown connection|rogue device)\w*\b/iu.test(evidence);
      if (!infrastructureAnchor || !securityAnchor) return false;
    }

    if (this.isShoeRepairRequest(request)) {
      const shoeAnchor = /\b(?:shoe|shoes|boot|boots|footwear|cobbler|cobblers)\b/iu.test(evidence);
      const repairWorkflowAnchor = /\b(?:repair|repairs|repair shop|repair ticket|work order|customer item|technician|material choice|payment status|collection date|pickup date|paper ticket|misplaced|repair status|repair instruction)\w*\b/iu.test(evidence);
      if (!shoeAnchor || !repairWorkflowAnchor) return false;
      if (/\b(?:shopping|outfit|fashion trend|wardrobe|sneaker release|shoe size|shoe store)\b/iu.test(evidence) && !/\b(?:repair|cobbler|work order|repair ticket)\b/iu.test(evidence)) return false;
    }

    if (this.isAcademicSecurityRequest(request)) {
      const academicAnchor = /\b(?:school|schools|university|universities|student|students|learning platform|learning management system|lms|online assessment|online exam|assessment|exam)\b/iu.test(evidence);
      const securityAnchor = /\b(?:security|cyber|suspicious|login|account takeover|unauthorized|identity|authentication|anomal|academic misuse|academic integrity|proctor|cheating|false positive|security alert)\w*\b/iu.test(evidence);
      if (!academicAnchor || !securityAnchor) return false;
    }

    if (this.isHospitalOperatingRoomCoordinationRequest(request)) {
      return this.isHospitalOperatingRoomCoordinationEvidence(evidence);
    }

    if (this.isHospitalEquipmentTrackingRequest(request)) {
      const healthcareAnchor = /\b(?:hospital|hospitals|healthcare|clinical|biomedical|medical)\b/iu.test(evidence);
      const equipmentAnchor = /\b(?:medical equipment|medical device|medical devices|equipment|device|devices|asset|assets|infusion pump|ventilator|wheelchair|monitor)\b/iu.test(evidence);
      const workflowAnchor = /\b(?:track|tracking|location|locate|search|searching|find|finding|missing|unavailable|availability|maintenance|service status|utilization|usage|inventory|department|transfer|storage|operating room|procedure delay|delayed procedure|duplicate purchase|underused)\w*\b/iu.test(evidence);
      if (!healthcareAnchor || !equipmentAnchor || !workflowAnchor) return false;
    }

    if (this.isBookRestorationRequest(request)) {
      if (!this.isBookRestorationEvidenceIdentity(evidence)) {
        return false;
      }
    }

    if (this.isLogisticsShipmentIntegrityRequest(request)) {
      if (!this.isLogisticsShipmentIntegrityEvidence(evidence)) {
        return false;
      }
    }

    if (this.isAthleteRecoveryRequest(request)) {
      const athleteAnchor = /\b(?:athlete|athletes|sports club|sports clubs|rehabilitation center|rehab center|sports medicine|physiotherapist|physical therapist)\b/iu.test(evidence);
      const recoveryAnchor = /\b(?:injury|injuries|recovery|rehabilitation|return to play|return-to-play|training load|training loads|pain report|pain reports|pain score|mobility|performance data|medical assessment|reinjury|re-injury)\b/iu.test(evidence);
      const frictionAnchor = /\b(?:too quickly|too fast|too slowly|slower than expected|overload|overtraining|setback|reinjury|re-injury|injury risk|warning sign|missed sign|fragmented|separate systems?|different specialists?|not shared|not integrated|delay|delayed|unsafe|uncertain)\b/iu.test(evidence);
      if (!athleteAnchor || !recoveryAnchor || !frictionAnchor) return false;
    }

    if (this.isFrameRestorationWorkflowRequest(request)) {
      if (!this.isExactPictureFrameRestorationEvidenceIdentity(evidence)) return false;
      const workflowAnchor = /\b(?:damaged frame|condition|repair note|restoration note|treatment record|material selection|material sample|decorative detail|finish preference|finish sample|customer approval|client approval|approved restoration|completion date|photograph|photo|handwritten note|physical sample|gesso|gilding|gold leaf|molding|moulding)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:scattered|fragmented|missing|lost|incorrect|wrong finish|repeated repair|rework|wasted material|delay|delayed|miscommunication|outdated approval|missed detail|lost detail|damaged|deteriorat|overpaint)\w*\b/iu.test(evidence);
      if (!workflowAnchor || !frictionAnchor) return false;
      return true;
    }

    if (this.isArtRestorationWorkflowRequest(request)) {
      const conservationAnchor = /\b(?:art restoration|art conservation|conservator|conservation studio|conservation workshop|painting restoration|artifact conservation|museum conservation)\b/iu.test(evidence);
      const recordAnchor = /\b(?:condition report|condition documentation|condition photo|treatment record|treatment history|repair history|previous repair|material|materials|restoration stage|client instruction|documentation|record|records|notes|photograph|photos)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:scattered|fragmented|missing|lost|incomplete|manual|paper|handwritten|duplicate|duplicated|missed|incorrect|wrong|delay|delayed|hard to find|not tracked|tracking problem)\w*\b/iu.test(evidence);
      if (!conservationAnchor || !recordAnchor || !frictionAnchor) return false;
    }

    if (this.isRestaurantEnergyRequest(request)) {
      const kitchenAnchor = /\b(?:restaurant|restaurants|commercial kitchen|commercial kitchens|restaurant kitchen|food service kitchen|kitchen manager|restaurant manager)\b/iu.test(evidence);
      const energyAnchor = /\b(?:electricity|gas|energy|utility bill|utility bills|utility cost|utility costs|refrigeration|refrigerator|freezer|cooking equipment|oven|grill|ventilation|hood|lighting|heating|equipment usage|equipment runtime|meter|submeter|carbon|emissions?)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:high bill|higher bill|unusual consumption|consumption spike|energy waste|waste|wasted|inefficient|inefficiency|excess consumption|excessive consumption|limited visibility|no visibility|hard to identify|difficult to identify|cannot identify|unable to identify|separate systems?|fragmented|operating hours?|idle|left on|running overnight|cost increase|cost spike|energy saving|efficiency improvement)\w*\b/iu.test(evidence);
      if (!kitchenAnchor || !energyAnchor || !frictionAnchor) return false;
    }

    if (this.isResidentialCleaningRequest(request)) {
      const cleaningAnchor = /\b(?:home cleaning|house cleaning|residential cleaning|cleaning service|cleaning company|cleaning business|cleaners?|housekeepers?|maid service|cleaning crew|cleaning team)\b/iu.test(evidence);
      const workflowAnchor = /\b(?:customer preference|client preference|recurring appointment|recurring booking|room instruction|room-specific instruction|employee assignment|cleaner assignment|staff assignment|cleaning supplies|supply list|schedule change|appointment change|task list|checklist|customer request|client request|phone call|text message|messaging app|handwritten note)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:missed|forgotten|forget|conflict|double book|double-book|scheduling conflict|wrong cleaner|wrong assignment|missing supply|out of supplies|miscommunication|lost note|unclear instruction|inconsistent service|quality issue|last minute|last-minute|not updated|didn't know|did not know|failed to communicate)\w*\b/iu.test(evidence);
      const batteryCollision = /\b(?:home batter(?:y|ies)|residential batter(?:y|ies)|battery storage|solar batter(?:y|ies)|powerwall)\b/iu.test(evidence) && !cleaningAnchor;
      if (!cleaningAnchor || !workflowAnchor || !frictionAnchor || batteryCollision) return false;
    }

    if (this.isAgricultureLogisticsRequest(request)) {
      const agricultureAnchor = /\b(?:agricultural|agriculture|farm|farmer|fresh produce|produce|grower|cold storage)\b/iu.test(evidence);
      const logisticsAnchor = /\b(?:harvest|storage|cold chain|temperature|shipment|transport|delivery|spoil|storage capacity|location|traceability|logistics|market)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:delay|delayed|late|spoil|spoiled|spoilage|quality loss|waste|wasted|partial load|partially empty|transport cost|missing|tracking|visibility|fragmented|separate systems?|capacity shortage|coordination problem|temperature excursion)\w*\b/iu.test(evidence);
      if (!agricultureAnchor || !logisticsAnchor || !frictionAnchor) return false;
    }

    if (this.isPictureFramingRequest(request)) {
      const framingAnchor = /\b(?:picture framing|framing shop|frame shop|custom frame|framer|moulding|mat board|matting)\b/iu.test(evidence);
      const workflowAnchor = /\b(?:measurement|dimensions?|frame|glass|moulding|material|special handling|customer preference|order change|completion date|pickup date|paper form|paper ticket|verbal instruction|work order)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:wrong|incorrect|mistake|remeasure|remake|waste|wasted|shortage|out of stock|delay|delayed|late|lost|missing|miscommunication|change request|paper|verbal)\w*\b/iu.test(evidence);
      if (!framingAnchor || !workflowAnchor || !frictionAnchor) return false;
    }

    if (this.isManufacturingSupplyChainRequest(request)) {
      const manufacturingAnchor = /\b(?:manufacturing|manufacturer|manufacturers|factory|factories|production|production line|plant|industrial)\b/iu.test(evidence);
      const supplyAnchor = /\b(?:raw materials?|supplier|suppliers|supply chain|inventory|warehouse|warehouses|shipment|shipments|delivery|deliveries|stock)\b/iu.test(evidence);
      const disruptionAnchor = /\b(?:delay|delayed|shortage|shortages|stockout|stockouts|bottleneck|bottlenecks|disrupt|disruption|shutdown|downtime|demand change|demand changes|forecast|inaccurate inventory|inventory mismatch|excess stock|overstock|priorit|schedule conflict)\w*\b/iu.test(evidence);
      if (!manufacturingAnchor || !supplyAnchor || !disruptionAnchor) return false;
    }

    if (this.isLocksmithDispatchRequest(request)) {
      const locksmithAnchor = /\b(?:locksmith|locksmiths|lock service|lock services|lock repair|key service)\b/iu.test(evidence);
      const operationsAnchor = /\b(?:dispatch|dispatcher|technician|technicians|service call|service calls|service request|service requests|emergency call|job assignment|parts?|tools?|van inventory|mobile inventory|scheduling|availability)\b/iu.test(evidence);
      const failureAnchor = /\b(?:delay|delayed|late|missing|wrong|incorrect|unavailable|repeat trip|repeated trip|return trip|miscommunication|missed call|poor coordination|stockout|out of stock)\w*\b/iu.test(evidence);
      if (!locksmithAnchor || !operationsAnchor || !failureAnchor) return false;
    }

    if (archetype.archetype === 'DIGITAL_TRUST_SAFETY_OPERATIONS') {
      const platformAnchor = /\b(?:marketplace|marketplaces|e[- ]?commerce|online store|seller|sellers|merchant|merchants|listing|listings|product listing|review|reviews|buyer|buyers|customer|customers)\b/iu.test(evidence);
      const trustAnchor = /\b(?:fraud|fraudulent|fake|scam|suspicious|manipulat|coordinated|misleading|restriction|restricted|false positive|incorrectly banned|wrongly banned|trust|abuse|account takeover|unauthorized|loss|losses)\w*\b/iu.test(evidence);
      if (!platformAnchor || !trustAnchor) return false;
    }

    if (archetype.archetype === 'FINANCIAL_TRANSACTION_OPERATIONS') {
      const financialAnchor = /\b(?:bank|banking|financial|payment|payments|transaction|transactions|transfer|transfers|card|cards|wallet|merchant|payout|account)\b/iu.test(evidence);
      const investigationAnchor = /\b(?:fraud|fraudulent|unauthorized|suspicious|verification|identity|dispute|chargeback|reconciliation|restriction|restricted|frozen|freeze|delay|delayed|failed|failure|declined|blocked|alert|investigation|mismatch|loss|losses)\w*\b/iu.test(evidence);
      const developerOnly = /\b(?:unit tests?|test suite|code coverage|repository|pull request|smart contract tests?|cargo|github issue|sdk|api implementation)\b/iu.test(evidence) &&
        !/\b(?:actual transaction|customer payment|unauthorized transfer|fraud investigation|frozen account|payment dispute|chargeback|verification failure)\b/iu.test(evidence);
      if (!financialAnchor || !investigationAnchor || developerOnly) return false;
    }

    if (this.isRestaurantDeliveryFraudRequest(request)) {
      return this.isRestaurantDeliveryFraudSupportingEvidence(evidence);
    }

    if (
      archetype.archetype === 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS'
    ) {
      const propertyAnchor = /\b(?:property management|property investment compan(?:y|ies)|real estate compan(?:y|ies)|real estate firms?|property investors?|real estate investors?|investment properties?|property managers?|asset managers?|rental property|rental properties|buildings?|apartments?|landlords?|real estate portfolios?)\b/iu.test(evidence);
      const performanceAnchor = /\b(?:maintenance expense|maintenance cost|maintenance spend|operating cost|operating expense|vacancy|tenant complaint|repair expense|property performance|building return|lower return|net operating income|\bnoi\b|rental income|cash flow|profitability|return estimate|return on investment|\broi\b|financing cost|mortgage interest|interest rate|local market|market rent|rent growth|expense forecast|maintenance priorit|data silo|separate systems?)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:rising|higher|increase|unexpected|inaccurate|declining|lower|negative|erod|difficult|hard to|uncertain|vacancy|expense|cost|maintenance|repair|cash flow problem|poor return|missed|delay|fragment|silo|separate systems?|market change|interest rate)\w*\b/iu.test(evidence);
      const taxOnly = /\b(?:1031 exchange|depreciation recapture|tax loophole|cost segregation|irs)\b/iu.test(evidence) && !performanceAnchor;
      if (!propertyAnchor || !performanceAnchor || !frictionAnchor || taxOnly) return false;
      return true;
    }

    if (
      archetype.archetype === 'ENTERPRISE_POLICY_COMPLIANCE_OPERATIONS'
    ) {
      const enterpriseAnchor = /\b(?:human resources?|\bhr\b|employee handbook|employment polic(?:y|ies)|workplace polic(?:y|ies)|employment contracts?|leave rules?|internal procedures?|legal team|compliance|labor law|employment law|staff handbook|corporate policy)\b/iu.test(evidence);
      const governanceFrictionAnchor = /\b(?:outdated|version control|version mismatch|conflict|conflicting|inconsistent|inconsistency|regulatory change|regulation change|not updated|manual review|document review|repeated questions?|policy questions?|compliance risk|policy update|policy synchronization|different departments?|multiple departments?)\w*\b/iu.test(evidence);
      const genericTechOnly = /\b(?:microsoft 365|workflow automation|orchestration|api integration|code generation|developer tooling)\b/iu.test(evidence) &&
        !enterpriseAnchor;
      if (!enterpriseAnchor || !governanceFrictionAnchor || genericTechOnly) {
        return false;
      }
    }

    if (
      archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' ||
      archetype.archetype === 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS'
    ) {
      const operationsAnchor = /\b(?:queue|queues|booking|bookings|appointment|appointments|customer|customers|client|clients|service request|service requests|employee|employees|staff|technician|technicians|equipment|inventory|assignment|assignments|preferences?|workload|workloads|work order|work orders|custom order|custom orders|commission|commissions|measurement|measurements|dimension|dimensions|schedule|schedules|instruction|instructions|service history|visit history|previous visits?|maintenance|servicing|material|materials|hardware|stitching|engraving|artwork|design|revision|revisions|approved version|approval|specification|specifications|deadline|deadlines|water quality|feeding|filter|replacement|health observation|condition|record|records|notes?|messages?|task|tasks)\w*\b/iu.test(evidence);
      const frictionAnchor = /\b(?:delay|delayed|late|long wait|waiting time|forgotten|missed|missing|wrong|incorrect|unavailable|uneven|overload|paper note|paper notes|paper receipt|paper ticket|paper form|verbal|miscommunication|bottleneck|repeat|repeated|rework|waste|wasted|lost|misplaced|not tracked|tracking problem|unclear status|misunderstanding|dispute|condition mismatch|failure|failures|unhealthy|inconsistent|fragmented|scattered|separate|duplicate|duplicated|outdated|wrong version|old version|harder to organize|hard to organize)\w*\b/iu.test(evidence);
      const actorAligned = this.localServiceActorAligned(request, evidence) &&
        this.dynamicActorAligned(request, evidence);
      if (
        !actorAligned ||
        !operationsAnchor ||
        !frictionAnchor ||
        this.isDeveloperOnlyEvidence(evidence)
      ) return false;
    }

    if (this.hasGenericWorkflowContract(request)) {
      if (!this.genericWorkflowContractAligned(request, evidence)) return false;
    }

    const requestTokens = this.extractTokens(`${request} ${planned}`);
    const evidenceTokens = this.extractTokens(evidence);
    if (requestTokens.size === 0 || evidenceTokens.size === 0) return false;

    const overlap = [...requestTokens].filter((token) => evidenceTokens.has(token));
    const minimumOverlap = requestTokens.size <= 6 ? 1 : requestTokens.size <= 12 ? 2 : 3;
    if (overlap.length < minimumOverlap) return false;

    const signalTokens = [...requestTokens].filter((token) => this.isProblemOrWorkflowSignal(token));
    if (signalTokens.length > 0) {
      const signalOverlap = signalTokens.filter((token) => evidenceTokens.has(token));
      if (signalOverlap.length === 0 && overlap.length < Math.max(3, minimumOverlap + 1)) {
        return false;
      }
    }

    const coverage = overlap.length / Math.max(1, Math.min(requestTokens.size, 14));
    return coverage >= (requestTokens.size <= 6 ? 0.16 : requestTokens.size <= 12 ? 0.14 : 0.12);
  }

  static classifyForRequest(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): 'DIRECT_PROBLEM' | 'SUPPORTING_SIGNAL' | 'UNRELATED' {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence) return 'UNRELATED';

    if (this.isPromotionalProductListingEvidence(evidence)) {
      return 'UNRELATED';
    }

    if (RequestOnlinePharmacyFraudUtil.isRequest(request)) {
      if (RequestOnlinePharmacyFraudUtil.isDirectEvidence(request, evidence)) {
        return 'DIRECT_PROBLEM';
      }
      return RequestOnlinePharmacyFraudUtil.isSupportingEvidence(request, evidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      if (RequestNicheCustomCraftUtil.isDirectEvidence(request, evidence)) {
        return 'DIRECT_PROBLEM';
      }
      return RequestNicheCustomCraftUtil.isSupportingEvidence(request, evidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isAgriculturalDistributionProfitabilityRequest(request)) {
      if (!this.isAgriculturalDistributionProfitabilitySupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAgriculturalDistributionProfitabilityEvidence(evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isAgriculturalExportProfitabilityRequest(request)) {
      if (!this.isAgriculturalExportProfitabilitySupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAgriculturalExportProfitabilityEvidence(evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isEyeglassFrameRepairRequest(request)) {
      if (!this.isEyeglassFrameRepairSupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isEyeglassFrameRepairEvidence(evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isRestaurantDeliveryFraudRequest(request)) {
      if (!this.isRestaurantDeliveryFraudSupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAligned({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isTransactionAccountAbuseRequest(request)) {
      if (!this.isTransactionAccountAbuseSupportingEvidence(request, evidence)) {
        return 'UNRELATED';
      }
      return this.isTransactionAccountAbuseDirectEvidence(request, evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isPublicProgramCostAttributionRequest(request)) {
      if (!this.isPublicProgramCostAttributionSupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.isPublicProgramCostAttributionDirectEvidence(evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (RequestOperationalCostAttributionUtil.resolve(request)) {
      if (!RequestOperationalCostAttributionUtil.isSupportingEvidence(request, evidence)) {
        return 'UNRELATED';
      }
      return RequestOperationalCostAttributionUtil.isDirectEvidence(request, evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isMunicipalCorridorCongestionRequest(request)) {
      if (!this.isMunicipalCorridorCongestionSupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isMunicipalCorridorCongestionEvidence(evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isBookEdgeGildingRequest(request)) {
      if (!this.isBookEdgeGildingSupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isBookEdgeGildingEvidence(evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isManufacturingCostProfitabilityRequest(request)) {
      if (!this.isManufacturingCostProfitabilitySupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAligned({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isTourismTransitSurgeCapacityRequest(request)) {
      if (!this.isTourismTransitSurgeCapacitySupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAligned({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isHealthcareSupplyCostEfficiencyRequest(request)) {
      if (!this.isHealthcareSupplyCostEfficiencySupportingEvidence(evidence)) return 'UNRELATED';
      return this.isHealthcareSupplyCostEfficiencyDirectEvidence(evidence) &&
        this.isAligned({ requestDescription: request, evidenceText: input.evidenceText, plannedQueries: input.plannedQueries ?? [] })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isHospitalCostResourceEfficiencyRequest(request)) {
      if (!this.isHospitalCostResourceEfficiencySupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAligned({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isShoeDyeingServiceRequest(request)) {
      if (!this.isShoeDyeingSupportingEvidence(evidence)) return 'UNRELATED';
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAligned({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isEvChargingInfrastructureRequest(request)) {
      if (!this.isEvChargingInfrastructureSupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAligned({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isProfessionalInterpretationAgencyRequest(request)) {
      if (!this.isProfessionalInterpretationAgencySupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isAligned({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isHealthcareBillingFraudSecurityRequest(request)) {
      if (!this.isHealthcareBillingFraudSecuritySupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.isHealthcareBillingFraudSecurityEvidence(evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    const requestArchetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (this.isLogisticsShipmentIntegrityRequest(request)) {
      if (!this.isLogisticsShipmentIntegrityEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.hasDeterministicProblemExpression(input.evidenceText)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isBookRestorationRequest(request)) {
      if (!this.isBookRestorationSupportingEvidence(evidence)) {
        return 'UNRELATED';
      }
      return this.isRestorationConservationEvidence(request, evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (this.isRestorationConservationRequest(request, input.plannedQueries ?? [])) {
      if (!this.isRestorationConservationSupportingEvidence(request, evidence)) {
        return 'UNRELATED';
      }
      return this.isRestorationConservationEvidence(request, evidence)
        ? 'DIRECT_PROBLEM'
        : 'SUPPORTING_SIGNAL';
    }

    if (
      this.isAligned({
        requestDescription: request,
        evidenceText: input.evidenceText,
        plannedQueries: input.plannedQueries ?? [],
      })
    ) {
      return 'DIRECT_PROBLEM';
    }

    return this.isRequestSupportingSignal(request, evidence)
      ? 'SUPPORTING_SIGNAL'
      : 'UNRELATED';
  }

  /**
   * Lightweight post-AI safety gate. This is intentionally less strict than
   * classifyForRequest(): semantic relevance belongs to the AI triage phase,
   * while this guard only vetoes obvious actor/workflow contamination and
   * developer-only material for non-developer requests.
   */
  /**
   * Broad, provenance-safe admission gate used before Community AI semantic
   * triage. This gate deliberately answers a different question from
   * classifyForRequest(): "is this result plausible enough for AI to inspect?"
   *
   * It never promotes a record to DIRECT or SUPPORTING evidence. It only keeps
   * grey-area search results out of the deterministic trash path when they
   * share a concrete requester object/workflow/problem axis or strongly match
   * one of the AI-planned problem queries.
   */
  /**
   * Cheap lexical/raw-corpus hygiene used before online Community AI.
   *
   * This is deliberately NOT a semantic relevance gate. It only removes
   * unambiguous entity/term collisions that cannot represent the requester
   * workflow (for example Citizen watches or Star Citizen when the requester
   * means municipal citizen complaints, or JVM garbage collection when the
   * requester means municipal waste collection). Grey-area evidence remains
   * eligible for AI triage.
   */
  static passesRawCorpusLexicalHygieneGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence) return true;

    const citizenPublicServiceRequest =
      /\b(?:citizen complaints?|citizen reports?|resident complaints?|resident reports?)\b/iu.test(request) ||
      (this.isMunicipalWasteCollectionRequest(request) && /\bcitizen\b/iu.test(request));
    if (citizenPublicServiceRequest) {
      const citizenEntityCollision =
        /\b(?:star citizen|citizen watches?|citizen watch|citizen chronographs?|citizen eco[- ]?drive|citizen promaster|citizenship interviews?|citizenship test|naturalization interviews?)\b/iu.test(
          evidence,
        );
      const publicServiceAnchor =
        /\b(?:municipal|municipality|city government|public works|sanitation|waste|garbage|refuse|trash|dumping|dumpster|bin|collection route|pickup|resident complaint|citizen complaint|inspection|environmental measurement)\w*\b/iu.test(
          evidence,
        );
      if (citizenEntityCollision && !publicServiceAnchor) return false;
    }

    if (this.isMunicipalWasteCollectionRequest(request)) {
      const runtimeGarbageCollectionCollision =
        /\b(?:java|javascript|node\.js|jvm|runtime|heap|memory management|gc pause|garbage collector|garbage collection algorithm|mark[- ]and[- ]sweep|source code)\b/iu.test(
          evidence,
        );
      const physicalWasteAnchor =
        /\b(?:municipal|sanitation|solid waste|waste collection|garbage truck|refuse collection|trash pickup|missed pickup|illegal dumping|dumpster|landfill)\b/iu.test(
          evidence,
        );
      if (runtimeGarbageCollectionCollision && !physicalWasteAnchor) return false;
    }

    if (this.isWatchStrapSpecificationRequest(request)) {
      const exactWatchIdentity = this.hasWatchStrapIdentity(evidence);
      const adjacentLeathercraftIdentity =
        /\b(?:leathercraft|leather craft|leatherwork|leather worker|leatherworker|leather artisan|leather goods maker|custom leather|bespoke leather|leather workshop|leather shop)\b/iu.test(evidence);
      const softwareOrConnectorCollision =
        /\b(?:custom workflow forms?|workflow engine|workflow designer|visual studio workflow|android widgets?|custom widgets?|software widgets?|rf connectors?|radio frequency connectors?|source code|github issues?|programming|api|sdk)\b/iu.test(evidence);
      const genericWearableCollision =
        /\b(?:wearable skin|electronic skin|smartwatch app|wearable sensor|fitness tracker|android wear|wear os)\b/iu.test(evidence) &&
        !/\b(?:strap|band|leather|sizing|measurement|lug width|buckle|stitching)\b/iu.test(evidence);
      if (
        (softwareOrConnectorCollision || genericWearableCollision) &&
        !exactWatchIdentity &&
        !adjacentLeathercraftIdentity
      ) {
        return false;
      }
    }

    if (this.isInstrumentCaseSpecificationRequest(request)) {
      const musicalCaseAnchor =
        /\b(?:musical instrument cases?|instrument case makers?|instrument case builders?|violin cases?|viola cases?|cello cases?|guitar cases?|double bass cases?|flight cases?\s+(?:for|for a|for an)?\s*(?:violin|viola|cello|guitar|instrument)|custom fitted cases?|case padding|case foam|interior padding|instrument fit)\b/iu.test(
          evidence,
        );
      const nonMusicalInstrumentCollision =
        /\b(?:texas instruments?|scientific instruments?|laboratory instruments?|medical instruments?|precision instruments?|optical instruments?|financial instruments?|instrument jewels?|experimental psychology|measuring instruments?|analytical instruments?)\b/iu.test(
          evidence,
        );
      const nonMusicalCaseCollision =
        /\b(?:camera cases?|computer cases?|phone cases?|server cases?|raspberry pi.{0,24}cases?|electronic enclosures?|protective phone cases?)\b/iu.test(
          evidence,
        );
      if (
        (nonMusicalInstrumentCollision || nonMusicalCaseCollision) &&
        !musicalCaseAnchor
      ) {
        return false;
      }
    }

    if (this.isBookRestorationRequest(request)) {
      if (!this.isBookRestorationEvidenceIdentity(evidence)) {
        return false;
      }
    }

    if (this.isLogisticsShipmentIntegrityRequest(request)) {
      if (!this.isLogisticsShipmentIntegrityEvidence(evidence)) {
        return false;
      }
    }

    if (this.isAthleteRecoveryRequest(request)) {
      /*
       * Hard pre-AI identity hygiene for sports-rehabilitation monitoring.
       * Generic sports headlines, politics, entertainment, wildlife rescue and
       * everyday uses of words such as "delayed", "progressing" or "rehab"
       * previously consumed most of the full-corpus context window. Keep broad
       * rehabilitation research (including adjacent remote-rehab studies), but
       * require an actual rehabilitation/recovery/clinical-monitoring axis.
       */
      const rehabilitationAxis =
        /\b(?:sports rehabilitation|athletic rehabilitation|injury rehabilitation|rehabilitation monitoring|remote rehabilitation|remote monitoring|physical therapy|physical therapist|physiotherapy|physiotherapist|sports medicine|return to play|return-to-play|injury recovery|recovery monitoring|wearable sensor|wearable device|pain score|pain report|mobility measurement|exercise adherence|therapeutic exercise|rehabilitation exercise)\b/iu.test(
          evidence,
        );
      const athleteInjuryAxis =
        /\b(?:athlete|athletes|player|players|sports|sport)\b/iu.test(evidence) &&
        /\b(?:injury|injuries|reinjury|re-injury|recovery|rehabilitation|therapy|therapeutic|return to play|return-to-play|mobility|training load)\b/iu.test(
          evidence,
        );
      if (!rehabilitationAxis && !athleteInjuryAxis) {
        return false;
      }
    }

    return true;
  }

  static passesPreAiTriageCandidateGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence || evidence.length < 12) return false;
    if (
      !this.passesRawCorpusLexicalHygieneGuard({
        requestDescription: request,
        evidenceText: evidence,
      })
    ) {
      return false;
    }

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (
      archetype.archetype !== 'DEVELOPER_TECHNICAL' &&
      this.isDeveloperOnlyEvidence(evidence)
    ) {
      return false;
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isPlausibleRetrievalCandidate(request, evidence);
    }

    if (this.isMediaContentProfitabilityRequest(request)) {
      return (
        this.isMediaContentProfitabilityEvidence(evidence) ||
        this.isMediaContentProfitabilitySupportingSignal(evidence)
      );
    }

    if (this.isInstrumentCaseSpecificationRequest(request)) {
      return (
        this.isInstrumentCaseSpecificationEvidence(evidence) ||
        this.isInstrumentCaseSpecificationSupportingSignal(evidence)
      );
    }

    const intentProfile = RequestWorkflowIntentProfileUtil.resolve(request);
    if (!RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(request, evidence)) {
      return false;
    }

    if (
      this.passesAiEvidenceAdmissionGuard({
        requestDescription: request,
        evidenceText: evidence,
        plannedQueries: input.plannedQueries ?? [],
      })
    ) {
      return true;
    }
    if (intentProfile.family === 'FOOD_STORAGE_CONDITION') {
      return this.isFoodStorageConditionTriageCandidate(request, evidence);
    }
    if (intentProfile.family === 'RESTORATION_CONSERVATION') {
      return (
        this.isRestorationConservationTriageCandidate(request, evidence) ||
        this.isExactObjectRestorationPartialTriageCandidate(request, evidence)
      );
    }

    if (intentProfile.family === 'FACILITY_RESOURCE_MONITORING') {
      const evidence = this.normalize(input.evidenceText);
      if (/\b(?:petroleum drilling|wellbore|drilling fluid|rolling stock|railway applications|inconel|ultrasonic cutting|metal machining|seismic damage|software maintenance)\b/u.test(evidence)) {
        return false;
      }
      const object = /\b(?:water|utility|meter|consumption|usage|leak|resource|cooling|equipment)\w*\b/u.test(evidence);
      const workflow = /\b(?:maintenance|monitor|forecast failures?|anomaly|abnormal|inefficien|waste|fragment|silo|reading|telemetry|leak)\w*\b/u.test(evidence);
      if (!object || !workflow) return false;
      return true;
    }

    if (intentProfile.family === 'TRANSACTION_ACCOUNT_ABUSE') {
      return this.isTransactionAccountAbuseTriageCandidate(request, evidence);
    }

    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    const distinctiveOverlap = [...requestTokens]
      .filter((token) => this.isDistinctiveRequestAnchorToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const workflowOverlap = [...requestTokens]
      .filter((token) => this.isWorkflowAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const outcomeOverlap = [...requestTokens]
      .filter((token) => this.isOutcomeAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const actorAligned = this.dynamicActorAligned(request, evidence);
    const plannedOverlap = this.maximumPlannedSemanticOverlap(
      input.plannedQueries ?? [],
      evidenceTokens,
    );
    const incidentOrProblemSignal =
      this.hasDeterministicProblemExpression(evidence) ||
      /\b(?:breach|cyberattack|cyber attack|compromis\w*|account takeover|credential theft|unauthori[sz]ed|suspicious|anomal\w*|security incident|security alert|expos\w*|tamper\w*|misuse|fraud\w*|wrong|incorrect|mismatch\w*|rework|repeat\w*|forgotten|missing|lost|delay\w*|complain\w*|failure|failed|risk)\b/iu.test(
        evidence,
      );

    if (!incidentOrProblemSignal) return false;

    /*
     * Planned queries already encode the AI planner's actor/object/problem
     * interpretation. Strong overlap with one planned query is enough to let a
     * candidate reach semantic triage even when a literal vertical alias (for
     * example a product/platform name) is absent from deterministic regexes.
     */
    if (plannedOverlap >= 3) return true;

    if (
      plannedOverlap >= 2 &&
      (distinctiveOverlap >= 1 || workflowOverlap >= 1 || outcomeOverlap >= 1)
    ) {
      return true;
    }

    if (
      actorAligned &&
      (workflowOverlap >= 1 || outcomeOverlap >= 1 || distinctiveOverlap >= 1)
    ) {
      return true;
    }

    return (
      distinctiveOverlap >= 2 &&
      workflowOverlap + outcomeOverlap >= 1
    );
  }

  static passesAtomicSupportingProblemGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence || evidence.length < 12) return false;

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (
      archetype.archetype !== 'DEVELOPER_TECHNICAL' &&
      this.isDeveloperOnlyEvidence(evidence)
    ) {
      return false;
    }

    /*
     * Specific semantic contracts must run before coarse workflow archetypes.
     * A higher-education security request, for example, can legitimately share
     * account-abuse vocabulary without becoming a generic transaction problem.
     */
    if (this.isAcademicPlatformSecurityRequest(request)) {
      return this.isAcademicPlatformSecuritySupportingEvidence(evidence);
    }

    if (archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS') {
      return this.isFoodStorageConditionSupportingEvidence(request, evidence);
    }

    if (this.isPublicEducationResourceAllocationRequest(request)) {
      return this.isPublicEducationResourceAllocationSupportingEvidence(evidence);
    }

    if (this.isPublicProgramCostAttributionRequest(request)) {
      return this.isPublicProgramCostAttributionSupportingEvidence(evidence);
    }

    if (RequestOperationalCostAttributionUtil.resolve(request)) {
      return RequestOperationalCostAttributionUtil.isSupportingEvidence(request, evidence);
    }

    if (this.isPublicFiscalOversightRequest(request)) {
      return this.isPublicFiscalOversightSupportingEvidence(evidence);
    }

    if (this.isLogisticsShipmentIntegrityRequest(request)) {
      return this.isLogisticsShipmentIntegrityEvidence(evidence);
    }

    if (this.isBookRestorationRequest(request)) {
      return this.isBookRestorationSupportingEvidence(evidence);
    }

    if (this.isRestorationConservationRequest(request, input.plannedQueries ?? [])) {
      return (
        this.isRestorationConservationSupportingEvidence(request, evidence) ||
        this.isProfessionalRestorationWorkflowSupportingEvidence(request, evidence) ||
        this.isAdjacentPhysicalWorkflowExactPainSupportingEvidence(request, evidence)
      );
    }

    if (this.isEcommerceProfitabilityRequest(request)) {
      return this.isEcommerceProfitabilitySupportingEvidence(evidence);
    }

    if (this.isPublicTransportationProfitabilityRequest(request)) {
      return this.isPublicTransportationProfitabilitySupportingEvidence(evidence);
    }

    if (this.isBridalAlterationWorkflowRequest(request)) {
      return this.isBridalAlterationWorkflowSupportingEvidence(evidence);
    }

    if (this.isMunicipalWasteCollectionRequest(request)) {
      return this.isMunicipalWasteCollectionSupportingSignal(evidence);
    }

    if (this.isOperationalDigitalSecurityRequest(request)) {
      return this.isOperationalDigitalSecuritySupportingEvidence(
        request,
        evidence,
      );
    }

    if (
      archetype.archetype === 'TRANSACTION_ACCOUNT_ABUSE_OPERATIONS' &&
      this.isTransactionAccountAbuseSupportingEvidence(request, evidence)
    ) {
      return true;
    }

    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    const identityTerms = RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request);
    const identityOverlap = identityTerms.filter((term) =>
      this.semanticTokenAligned(term, evidenceTokens),
    ).length;
    const actorAligned = this.dynamicActorAligned(request, evidence);
    const distinctiveOverlap = [...requestTokens]
      .filter((token) => this.isDistinctiveRequestAnchorToken(token))
      .filter((token) => evidenceTokens.has(token)).length;

    const workflowFacetOverlap = RequestDynamicQueryUtil.extractWorkflowTerms(request)
      .filter((facet) => this.facetPhraseStronglyAligned(facet, evidenceTokens)).length;
    const painFacetOverlap = RequestDynamicQueryUtil.extractPainTerms(request)
      .filter((facet) => this.facetPhraseStronglyAligned(facet, evidenceTokens)).length;
    const workflowTokenOverlap = [...requestTokens]
      .filter((token) => this.isWorkflowAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const outcomeOverlap = [...requestTokens]
      .filter((token) => this.isOutcomeAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;

    const objectGate =
      actorAligned || identityOverlap >= 2 || distinctiveOverlap >= 2;
    const workflowGate =
      workflowFacetOverlap >= 1 ||
      (workflowTokenOverlap >= 2 && (actorAligned || distinctiveOverlap >= 1));
    const failureGate =
      painFacetOverlap >= 1 ||
      (outcomeOverlap >= 1 && this.hasDeterministicProblemExpression(evidence)) ||
      /\b(?:need|needs|needed|request|requested|wish|wants?|should support|missing capability|unable to|cannot|can't)\b/iu.test(
        evidence,
      );

    return objectGate && workflowGate && failureGate;
  }

  static passesAiEvidenceAdmissionGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence || evidence.length < 12) return false;

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (
      archetype.archetype !== 'DEVELOPER_TECHNICAL' &&
      this.isDeveloperOnlyEvidence(evidence)
    ) {
      return false;
    }

    /*
     * Specific semantic contracts must run before coarse workflow archetypes.
     * A higher-education security request, for example, can legitimately share
     * account-abuse vocabulary without becoming a generic transaction problem.
     */
    if (this.isAcademicPlatformSecurityRequest(request)) {
      return this.isAcademicPlatformSecuritySupportingEvidence(evidence);
    }

    if (archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS') {
      return this.isFoodStorageConditionSupportingEvidence(request, evidence);
    }

    if (this.isPublicEducationResourceAllocationRequest(request)) {
      return this.isPublicEducationResourceAllocationSupportingEvidence(evidence);
    }

    if (this.isLogisticsShipmentIntegrityRequest(request)) {
      return this.isLogisticsShipmentIntegrityEvidence(evidence);
    }

    if (this.isBookRestorationRequest(request)) {
      return this.isBookRestorationSupportingEvidence(evidence);
    }

    if (this.isRestorationConservationRequest(request, input.plannedQueries ?? [])) {
      return (
        this.isRestorationConservationSupportingEvidence(request, evidence) ||
        this.isProfessionalRestorationWorkflowSupportingEvidence(request, evidence) ||
        this.isAdjacentPhysicalWorkflowExactPainSupportingEvidence(request, evidence)
      );
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isSupportingEvidence(request, evidence);
    }

    if (this.isPublicTransportationProfitabilityRequest(request)) {
      return this.isPublicTransportationProfitabilitySupportingEvidence(evidence);
    }

    if (this.isBridalAlterationWorkflowRequest(request)) {
      return this.isBridalAlterationWorkflowSupportingEvidence(evidence);
    }

    if (this.isMunicipalWasteCollectionRequest(request)) {
      return this.isMunicipalWasteCollectionSupportingSignal(evidence);
    }

    if (this.isOperationalDigitalSecurityRequest(request)) {
      return this.isOperationalDigitalSecuritySupportingEvidence(
        request,
        evidence,
      );
    }

    if (
      archetype.archetype === 'TRANSACTION_ACCOUNT_ABUSE_OPERATIONS' &&
      this.isTransactionAccountAbuseSupportingEvidence(request, evidence)
    ) {
      return true;
    }

    if (this.isAgriculturalExportProfitabilityRequest(request)) {
      return this.isAgriculturalExportProfitabilitySupportingEvidence(evidence);
    }

    if (this.isMunicipalCorridorCongestionRequest(request)) {
      return this.isMunicipalCorridorCongestionSupportingEvidence(evidence);
    }

    if (this.isBookEdgeGildingRequest(request)) {
      return this.isBookEdgeGildingSupportingEvidence(evidence);
    }

    if (this.isEyeglassFrameRepairRequest(request)) {
      return this.isEyeglassFrameRepairSupportingEvidence(evidence);
    }

    if (this.isEnterpriseEmployeeAccessSecurityRequest(request)) {
      return this.isEnterpriseEmployeeAccessSecurityEvidence(evidence) ||
        this.isEnterpriseEmployeeAccessSupportingEvidence(evidence);
    }

    if (this.isHealthcareBillingFraudSecurityRequest(request)) {
      return this.isHealthcareBillingFraudSecuritySupportingEvidence(evidence);
    }

    if (this.isDecorativeFountainRestorationRequest(request)) {
      return this.isDecorativeFountainRestorationSupportingEvidence(evidence);
    }

    if (this.isManufacturingCostProfitabilityRequest(request)) {
      return this.isManufacturingCostProfitabilitySupportingEvidence(evidence);
    }

    if (this.isTourismTransitSurgeCapacityRequest(request)) {
      return this.isTourismTransitSurgeCapacitySupportingEvidence(evidence);
    }

    if (this.isHealthcareSupplyCostEfficiencyRequest(request)) {
      return this.isHealthcareSupplyCostEfficiencySupportingEvidence(evidence);
    }

    if (this.isHospitalCostResourceEfficiencyRequest(request)) {
      return this.isHospitalCostResourceEfficiencySupportingEvidence(evidence);
    }

    if (this.isShoeDyeingServiceRequest(request)) {
      return this.isShoeDyeingSupportingEvidence(evidence);
    }

    if (this.isEvChargingInfrastructureRequest(request)) {
      return this.isEvChargingInfrastructureSupportingEvidence(evidence);
    }

    if (this.isProfessionalInterpretationAgencyRequest(request)) {
      return this.isProfessionalInterpretationAgencySupportingEvidence(evidence);
    }

    if (
      archetype.archetype === 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS' &&
      this.isPropertyAssetPerformanceSupportingEvidence(evidence)
    ) {
      return true;
    }

    if (
      this.isRestaurantEnergyRequest(request) &&
      this.isRestaurantEnergySupportingEvidence(evidence)
    ) {
      return true;
    }

    if (
      this.isSneakerCleaningServiceRequest(request) &&
      this.isSneakerCleaningSupportingEvidence(evidence)
    ) {
      return true;
    }

    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    const sharedTokens = [...requestTokens].filter((token) =>
      evidenceTokens.has(token),
    );
    const distinctiveRequestTokens = [...requestTokens].filter((token) =>
      this.isDistinctiveRequestAnchorToken(token),
    );
    const distinctiveOverlap = distinctiveRequestTokens.filter((token) =>
      evidenceTokens.has(token),
    ).length;
    const workflowOverlap = [...requestTokens]
      .filter((token) => this.isWorkflowAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const outcomeOverlap = [...requestTokens]
      .filter((token) => this.isOutcomeAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const actor = RequestDynamicQueryUtil.extractActor(request);
    const actorAligned = actor
      ? this.dynamicActorAligned(request, evidence)
      : false;

    if (
      archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' ||
      archetype.archetype === 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS'
    ) {
      if (
        archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' &&
        this.passesAtomicSupportingProblemGuard({
          requestDescription: request,
          evidenceText: input.evidenceText,
          plannedQueries: input.plannedQueries ?? [],
        })
      ) {
        return true;
      }

      if (this.isMusicalRepairRequest(request)) {
        return (
          this.isAligned({
            requestDescription: request,
            evidenceText: input.evidenceText,
            plannedQueries: input.plannedQueries ?? [],
          }) ||
          this.isMusicalRepairSupportingSignal(evidence)
        );
      }

      return (
        this.isRequestSupportingSignal(request, evidence) ||
        (workflowOverlap >= 2 &&
          outcomeOverlap >= 1 &&
          sharedTokens.length >= 3 &&
          (actorAligned || distinctiveOverlap >= 1))
      );
    }

    return (
      actorAligned ||
      distinctiveOverlap >= 1 ||
      sharedTokens.length >= 2 ||
      this.isDomainAgnosticSupportingEvidence({
        requestDescription: request,
        evidenceText: evidence,
      }) ||
      this.isRequestSupportingSignal(request, evidence)
    );
  }

  /**
   * Broad pre-AI admission for a partial evidence fragment that can participate
   * in a later source-diverse composite. This never proves the requester problem
   * by itself; it only preserves actor/workflow-specific fragments so multiple
   * independent sources can jointly support different facets.
   */
  static passesCompositeEvidenceCandidateGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence || evidence.length < 12) return false;
    if (
      !this.passesRawCorpusLexicalHygieneGuard({
        requestDescription: request,
        evidenceText: evidence,
      })
    ) {
      return false;
    }
    if (!RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(request, evidence)) {
      return false;
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isSupportingEvidence(request, evidence);
    }

    if (this.isEcommerceProfitabilityRequest(request)) {
      return this.isEcommerceProfitabilitySupportingEvidence(evidence);
    }

    if (this.isMediaContentProfitabilityRequest(request)) {
      return this.isMediaContentProfitabilitySupportingSignal(evidence);
    }
    if (this.isInstrumentCaseSpecificationRequest(request)) {
      return this.isInstrumentCaseSpecificationSupportingSignal(evidence);
    }
    if (RequestWorkflowIntentProfileUtil.resolve(request).family === 'RESTORATION_CONSERVATION') {
      return (
        this.isRestorationConservationSupportingEvidence(request, evidence) ||
        this.isProfessionalRestorationWorkflowSupportingEvidence(request, evidence) ||
        this.isAdjacentPhysicalWorkflowExactPainSupportingEvidence(request, evidence) ||
        this.isExactObjectRestorationPartialTriageCandidate(request, evidence)
      );
    }
    if (this.isRequestSupportingSignal(request, evidence)) {
      return true;
    }

    const actorAligned = this.dynamicActorAligned(request, evidence);
    const plannedAlignment = (input.plannedQueries ?? []).some((query) => {
      const queryTokens = new Set(
        this.normalize(query)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((token) => token.length >= 4),
      );
      if (queryTokens.size === 0) return false;
      const evidenceTokens = new Set(
        evidence
          .split(/[^\p{L}\p{N}]+/u)
          .filter((token) => token.length >= 4),
      );
      let overlap = 0;
      for (const token of queryTokens) {
        if (evidenceTokens.has(token)) overlap += 1;
      }
      return overlap >= 3;
    });
    const pain =
      /\b(?:abandon|drop[- ]?off|churn|cancel|failed|failure|wrong|incorrect|inaccurate|unsuitable|missing|lost|scattered|fragmented|siloed|separate systems?|rework|repeat|waste|wasted|delay|delayed|inefficien|overspend|missed sales?|poor recommendation|low conversion|hard to|difficult to|unable to)\w*\b/iu.test(
        evidence,
      );

    return (actorAligned && pain) || (actorAligned && plannedAlignment);
  }

  /**
   * Post-AI semantic safety gate for evidence that the model labelled DIRECT or
   * SUPPORTING. Unlike the broad pre-AI candidate gate, this requires a real
   * requester pain/workflow facet before evidence can enter the trusted ledger.
   *
   * GENERAL/local-service requests are intentionally stricter here because
   * same-domain vocabulary is common and was previously enough to admit nearby
   * but different problems (for example wedding-party costs for a bridal
   * alterations records problem).
   */
  static passesPostAiPainAwareEvidenceGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence || evidence.length < 12) return false;

    /*
     * Transaction/account-abuse is a specialized evidence family. Let its
     * actor/workflow/fraud contract establish atomic SUPPORTING_SIGNAL before
     * the generic fragmented-information guard below asks the same source to
     * repeat the request's full causal mechanism. Without this precedence a
     * documented municipal phishing loss could be rejected merely because the
     * headline does not say that payment/security records were analyzed
     * separately.
     */
    if (
      this.isTransactionAccountAbuseRequest(request) &&
      this.isTransactionAccountAbuseSupportingEvidence(request, evidence)
    ) {
      return true;
    }

    /*
     * SUPPORTING evidence does not have to restate the request verbatim. A
     * request-aligned actor/object/workflow item may support one facet when it
     * contains a real problem-bearing observation (failure, risk, downtime,
     * error, delay, rework, cost, shortage, etc.). Research recruitment and
     * promotional/context-only material are excluded by the helpers below.
     */
    if (
      !this.isResearchContextOnlyEvidence(evidence) &&
      this.hasProblemBearingClaim(evidence) &&
      this.isRequestWorkflowContextEvidence({
        requestDescription: request,
        evidenceText: evidence,
        plannedQueries: input.plannedQueries ?? [],
      })
    ) {
      return true;
    }

    /*
     * Generic causal-mechanism guard for requests whose root problem is
     * fragmented/separate information preventing diagnosis, confirmation, or
     * attribution. A source that merely repeats a downstream consequence (for
     * example a delayed policy/standard) is not support for that workflow.
     * This is intentionally domain-agnostic so the same protection applies to
     * building energy, public budgets, custom commissions, logistics, and new
     * future domains with the same information-fragmentation pattern.
     */
    const fragmentedDiagnosticRequest =
      /\b(?:scattered|fragmented|disconnected|siloed|silos?|analy[sz]ed separately|analysed separately|separate systems?|managed separately|stored separately)\b/u.test(request) &&
      /\b(?:identify|understand|confirm|detect|diagnos|attribute|reconcile|trace|determine|pinpoint|compare)\w*\b/u.test(request);
    if (fragmentedDiagnosticRequest) {
      const sameMechanism = /\b(?:scattered|fragmented|disconnected|siloed|silos?|separate systems?|data|records?|logs?|metrics?|measurements?|monitoring|benchmark|anomal(?:y|ies)|diagnos|correlat|reconcil|trace|version|approval|specification|notes?|messages?|history|telemetry|usage|performance)\w*\b/u.test(evidence);
      const concreteOperationalFailure = /\b(?:wrong|incorrect|mismatch|missed|lost|missing|rework|repeat(?:ed)? work|waste|abnormal|unexplained|inefficient|excess|overrun|overspend|unexpected consumption|higher consumption|fault|failure|error|delay caused by)\w*\b/u.test(evidence);
      const policyOrStandardOnly =
        /\b(?:regulation|regulatory|standard|standards|legislation|policy|mandate|compliance deadline)\w*\b/u.test(evidence) &&
        !sameMechanism &&
        !concreteOperationalFailure;
      if (policyOrStandardOnly || (!sameMechanism && !concreteOperationalFailure)) {
        return false;
      }
    }

    /*
     * Public-procurement evidence often uses audit/records/supplier terminology
     * instead of repeating the request's longer anomaly-detection phrasing. The
     * dedicated contract below is stricter than generic lexical overlap, so let
     * it rescue legitimate partial support before the broad hygiene gate.
     */
    if (
      this.isPublicProgramCostAttributionRequest(request) &&
      this.isPublicProgramCostAttributionSupportingEvidence(evidence)
    ) {
      return true;
    }
    if (
      this.isPublicFiscalOversightRequest(request) &&
      this.isPublicFiscalOversightSupportingEvidence(evidence)
    ) {
      return true;
    }

    /*
     * Exact-object professional conservation material is allowed to support a
     * requester restoration workflow even when the source is written as a
     * condition/specification report rather than a complaint. Crossref/news/blog
     * provenance is capped to SUPPORTING later, so this recall lane cannot turn
     * a scholarly specification into a direct-user complaint.
     */
    if (
      this.isRestorationConservationRequest(request, input.plannedQueries ?? []) &&
      this.isProfessionalRestorationWorkflowSupportingEvidence(request, evidence)
    ) {
      return true;
    }

    if (
      !this.passesRawCorpusLexicalHygieneGuard({
        requestDescription: request,
        evidenceText: evidence,
      })
    ) {
      return false;
    }

    if (this.isBridalAlterationWorkflowRequest(request)) {
      return (
        this.isBridalAlterationWorkflowEvidence(evidence) ||
        this.isBridalAlterationWorkflowSupportingEvidence(evidence)
      );
    }

    if (this.isMunicipalWasteCollectionRequest(request)) {
      return (
        this.isMunicipalWasteCollectionEvidence(evidence) ||
        this.isMunicipalWasteCollectionSupportingSignal(evidence)
      );
    }

    if (this.isLogisticsShipmentIntegrityRequest(request)) {
      return this.isLogisticsShipmentIntegrityEvidence(evidence);
    }

    if (this.isBookRestorationRequest(request)) {
      return this.isBookRestorationSupportingEvidence(evidence);
    }

    if (this.isOperationalDigitalSecurityRequest(request)) {
      return this.isOperationalDigitalSecuritySupportingEvidence(
        request,
        evidence,
      );
    }

    if (this.isPublicTransportationProfitabilityRequest(request)) {
      return this.isPublicTransportationProfitabilitySupportingEvidence(evidence);
    }

    if (this.isPublicFiscalOversightRequest(request)) {
      return this.isPublicFiscalOversightSupportingEvidence(evidence);
    }

    if (this.isDecorativeFountainRestorationRequest(request)) {
      return this.isDecorativeFountainRestorationSupportingEvidence(evidence);
    }

    if (this.isMediaContentProfitabilityRequest(request)) {
      return this.isMediaContentProfitabilitySupportingSignal(evidence);
    }

    if (this.isInstrumentCaseSpecificationRequest(request)) {
      return this.isInstrumentCaseSpecificationSupportingSignal(evidence);
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isSupportingEvidence(request, evidence);
    }

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    const intentProfile = RequestWorkflowIntentProfileUtil.resolve(request);
    const genericPainSensitive =
      intentProfile.family === 'GENERAL' ||
      archetype.archetype === 'GENERAL_OPERATIONAL' ||
      archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      archetype.archetype === 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS';

    if (genericPainSensitive) {
      return (
        this.passesAtomicSupportingProblemGuard(input) ||
        this.isDomainAgnosticSupportingEvidence({
          requestDescription: request,
          evidenceText: evidence,
        })
      );
    }

    return this.passesAiEvidenceAdmissionGuard(input);
  }

  /**
   * Always produces a conservative classification for fallback execution.
   * Strict deterministic matches remain DIRECT; semantically admissible but
   * incomplete evidence is kept as SUPPORTING instead of being silently lost.
   */
  static hasProblemBearingClaim(evidenceText: string): boolean {
    const value = evidenceText
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    if (!value) return false;
    if (this.isResearchContextOnlyEvidence(value)) return false;

    return /\b(?:fail(?:ed|ure|ures|ing)?|faults?|errors?|incorrect|wrong|mismatch(?:es|ed)?|missing|lost|damage(?:d)?|shortages?|stockouts?|downtime|outages?|disrupt(?:ion|ions|ed)?|delay(?:s|ed)?|backlogs?|rework|repeat(?:ed)?|waste(?:d)?|inefficien\w*|bottlenecks?|fragment(?:ed|ation)?|silo(?:ed|s)?|separate systems?|lack of visibility|poor visibility|hard to|difficult to|unable to|cannot|risk(?:s)?|threat(?:s)?|attack(?:s|ed)?|breach(?:es)?|unauthori[sz]ed|fraud(?:ulent)?|compromis(?:e|ed|es)|costly|costs?|loss(?:es)?|challenges?|barriers?|limitations?|unreliable|reliability problem|quality problem|manual burden|time-consuming)\b/iu.test(value) ||
      /\b(?:results?|findings?|study|report|analysis|data|respondents?|participants?)\b.{0,80}\b(?:found|show(?:s|ed)?|indicat(?:e|es|ed)|report(?:ed|s)?|observ(?:ed|es)?|document(?:ed|s)?|identif(?:ied|ies)|experienced?)\b/iu.test(value);
  }

  static isResearchContextOnlyEvidence(evidenceText: string): boolean {
    const value = evidenceText
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    if (!value) return false;

    const recruitment =
      /\b(?:academic survey|survey link|answer (?:a|this) (?:short )?survey|take (?:a|this) survey|questionnaire|looking for (?:people|participants|respondents)|seeking participants|master(?:'s|s) student|doctoral student|phd student|dissertation|thesis survey|responses? (?:genuinely )?help)\b/u.test(value);
    const studyDescriptionOnly =
      /\b(?:research project|study (?:explores?|examines?|evaluates?|investigates?)|technology acceptance model|tam)\b/u.test(value);
    const reportedFinding =
      /\b(?:results? (?:show|shows|showed|indicate|indicates|indicated|found)|findings? (?:show|shows|indicate|indicates)|study (?:found|finds|reported|reports|shows|showed|identified|observed|documented)|respondents? (?:reported|report|experienced|experience)|participants? (?:reported|experienced)|data (?:show|shows|showed|indicate|indicates))\b/u.test(value);

    return (recruitment || studyDescriptionOnly) && !reportedFinding;
  }

  static classifyForRequestFallback(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): 'DIRECT_PROBLEM' | 'SUPPORTING_SIGNAL' | 'UNRELATED' {
    const normalizedRequest = this.normalize(input.requestDescription ?? '');
    const normalizedEvidence = this.normalize(input.evidenceText);
    if (!normalizedRequest || !normalizedEvidence) return 'UNRELATED';
    if (this.isPromotionalProductListingEvidence(normalizedEvidence)) return 'UNRELATED';
    if (RequestOnlinePharmacyFraudUtil.isRequest(normalizedRequest)) {
      if (RequestOnlinePharmacyFraudUtil.isDirectEvidence(normalizedRequest, normalizedEvidence)) {
        return 'DIRECT_PROBLEM';
      }
      return RequestOnlinePharmacyFraudUtil.isSupportingEvidence(normalizedRequest, normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (RequestNicheCustomCraftUtil.resolve(normalizedRequest)) {
      if (RequestNicheCustomCraftUtil.isDirectEvidence(normalizedRequest, normalizedEvidence)) {
        return 'DIRECT_PROBLEM';
      }
      return RequestNicheCustomCraftUtil.isSupportingEvidence(normalizedRequest, normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isAgriculturalDistributionProfitabilityRequest(normalizedRequest)) {
      return this.isAgriculturalDistributionProfitabilitySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (
      this.isEnterpriseEmployeeAccessSecurityRequest(normalizedRequest) &&
      (this.isEnterpriseEmployeeAccessSecurityEvidence(normalizedEvidence) ||
        this.isEnterpriseEmployeeAccessSupportingEvidence(normalizedEvidence))
    ) {
      // Without source/provenance metadata the deterministic fallback must not
      // promote enterprise security articles or control guidance to a direct
      // user complaint. Preserve them as supporting evidence so the later
      // provenance verifier can still use the useful employee/access signal.
      return 'SUPPORTING_SIGNAL';
    }

    if (this.isHealthcareBillingFraudSecurityRequest(normalizedRequest)) {
      return this.isHealthcareBillingFraudSecuritySupportingEvidence(
        normalizedEvidence,
      )
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isAcademicPlatformSecurityRequest(normalizedRequest)) {
      return this.isAcademicPlatformSecuritySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    /*
     * Public procurement contains words such as platform, account, suspicious,
     * and fraud that can look like generic cybersecurity. Resolve the narrower
     * procurement/oversight contract first so valid audit, supplier, records,
     * and anomaly evidence is not destroyed by the broader security matcher.
     */
    if (this.isPublicProgramCostAttributionRequest(normalizedRequest)) {
      return this.isPublicProgramCostAttributionSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (RequestOperationalCostAttributionUtil.resolve(normalizedRequest)) {
      return RequestOperationalCostAttributionUtil.isSupportingEvidence(
        normalizedRequest,
        normalizedEvidence,
      )
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isPublicFiscalOversightRequest(normalizedRequest)) {
      return this.isPublicFiscalOversightSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isLogisticsShipmentIntegrityRequest(normalizedRequest)) {
      return this.isLogisticsShipmentIntegrityEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isBookRestorationRequest(normalizedRequest)) {
      return this.isBookRestorationSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isOperationalDigitalSecurityRequest(normalizedRequest)) {
      return this.isOperationalDigitalSecuritySupportingEvidence(
        normalizedRequest,
        normalizedEvidence,
      )
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isTransactionAccountAbuseRequest(normalizedRequest)) {
      if (
        this.isTransactionAccountAbuseSupportingEvidence(
          normalizedRequest,
          normalizedEvidence,
        )
      ) {
        return 'SUPPORTING_SIGNAL';
      }
      // Do not let a coarse account-abuse family veto later generic/specific
      // semantic checks when its own vocabulary does not fit the request.
    }

    if (this.isPublicEducationResourceAllocationRequest(normalizedRequest)) {
      return this.isPublicEducationResourceAllocationSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isDecorativeFountainRestorationRequest(normalizedRequest)) {
      return this.isDecorativeFountainRestorationSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isBridalAlterationWorkflowRequest(normalizedRequest)) {
      if (this.isBridalAlterationWorkflowEvidence(normalizedEvidence)) {
        return 'DIRECT_PROBLEM';
      }
      return this.isBridalAlterationWorkflowSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isMunicipalWasteCollectionRequest(normalizedRequest)) {
      if (this.isMunicipalWasteCollectionEvidence(normalizedEvidence)) {
        return 'DIRECT_PROBLEM';
      }
      return this.isMunicipalWasteCollectionSupportingSignal(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    const fallbackArchetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: normalizedRequest,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (this.isRestorationConservationRequest(normalizedRequest, input.plannedQueries ?? [])) {
      return (
        this.isRestorationConservationSupportingEvidence(
          normalizedRequest,
          normalizedEvidence,
        ) ||
        this.isProfessionalRestorationWorkflowSupportingEvidence(
          normalizedRequest,
          normalizedEvidence,
        ) ||
        this.isAdjacentPhysicalWorkflowExactPainSupportingEvidence(
          normalizedRequest,
          normalizedEvidence,
        )
      )
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isEcommerceProfitabilityRequest(normalizedRequest)) {
      if (this.isEcommerceProfitabilityEvidence(normalizedEvidence)) {
        return 'DIRECT_PROBLEM';
      }
      return this.isEcommerceProfitabilitySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isPublicTransportationProfitabilityRequest(normalizedRequest)) {
      return this.isPublicTransportationProfitabilitySupportingEvidence(
        normalizedEvidence,
      )
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isMediaContentProfitabilityRequest(normalizedRequest)) {
      return this.isMediaContentProfitabilitySupportingSignal(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isInstrumentCaseSpecificationRequest(normalizedRequest)) {
      return this.isInstrumentCaseSpecificationSupportingSignal(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isManufacturingCostProfitabilityRequest(normalizedRequest)) {
      return this.isManufacturingCostProfitabilitySupportingEvidence(
        normalizedEvidence,
      )
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isTourismTransitSurgeCapacityRequest(normalizedRequest)) {
      return this.isTourismTransitSurgeCapacitySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isHealthcareSupplyCostEfficiencyRequest(normalizedRequest)) {
      return this.isHealthcareSupplyCostEfficiencySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isHospitalCostResourceEfficiencyRequest(normalizedRequest)) {
      return this.isHospitalCostResourceEfficiencySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isShoeDyeingServiceRequest(normalizedRequest)) {
      return this.isShoeDyeingSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isEvChargingInfrastructureRequest(normalizedRequest)) {
      return this.isEvChargingInfrastructureSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isProfessionalInterpretationAgencyRequest(normalizedRequest)) {
      return this.isProfessionalInterpretationAgencySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isAgriculturalExportProfitabilityRequest(normalizedRequest)) {
      return this.isAgriculturalExportProfitabilitySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isEyeglassFrameRepairRequest(normalizedRequest)) {
      return this.isEyeglassFrameRepairSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isRestaurantDeliveryFraudRequest(normalizedRequest)) {
      return this.isRestaurantDeliveryFraudSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isMunicipalCorridorCongestionRequest(normalizedRequest)) {
      return this.isMunicipalCorridorCongestionSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isBookEdgeGildingRequest(normalizedRequest)) {
      return this.isBookEdgeGildingSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isMusicalRepairRequest(normalizedRequest)) {
      return this.isMusicalRepairSupportingSignal(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isRestaurantEnergyRequest(normalizedRequest)) {
      return this.isRestaurantEnergySupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    if (this.isSneakerCleaningServiceRequest(normalizedRequest)) {
      return this.isSneakerCleaningSupportingEvidence(normalizedEvidence)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    const strict = this.classifyForRequest(input);
    if (strict === 'DIRECT_PROBLEM') {
      if (
        this.hasDeterministicProblemExpression(input.evidenceText) &&
        this.passesAiEvidenceAdmissionGuard(input)
      ) {
        return 'DIRECT_PROBLEM';
      }
      return this.passesDeterministicSupportingFallbackGuard(input)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }
    if (strict === 'SUPPORTING_SIGNAL') {
      const strictArchetype = RequestWorkflowArchetypeUtil.classify({
        requestDescription: normalizedRequest,
        plannedQueries: input.plannedQueries ?? [],
      });
      if (
        strictArchetype.archetype === 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS' &&
        this.isPropertyAssetPerformanceSupportingEvidence(normalizedEvidence)
      ) {
        return 'SUPPORTING_SIGNAL';
      }
      if (
        this.isMusicalRepairRequest(normalizedRequest) &&
        this.isMusicalRepairSupportingSignal(normalizedEvidence)
      ) {
        return 'SUPPORTING_SIGNAL';
      }
      return this.passesDeterministicSupportingFallbackGuard(input)
        ? 'SUPPORTING_SIGNAL'
        : 'UNRELATED';
    }

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: normalizedRequest,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (
      archetype.archetype === 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS' &&
      this.isPropertyAssetPerformanceSupportingEvidence(normalizedEvidence)
    ) {
      return 'SUPPORTING_SIGNAL';
    }

    return this.passesDeterministicSupportingFallbackGuard(input)
      ? 'SUPPORTING_SIGNAL'
      : 'UNRELATED';
  }

  /**
   * Preserves partial but meaningful property-operations evidence without
   * admitting broad investment-market content. Supporting evidence does not
   * need to restate the complete predictive-maintenance workflow, but it must
   * still identify a property-management/ownership actor and one concrete
   * operating-cost, repair, maintenance, tenant-risk, or budgeting dimension.
   */
  private static isPropertyAssetPerformanceSupportingEvidence(
    value: string,
  ): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const propertyActor =
      /\b(?:property management|property managers?|property management companies?|landlords?|rental property|rental properties|real estate investors?|property investors?|asset managers?|building owners?|apartment owners?|real estate portfolios?)\b/iu.test(
        evidence,
      );
    if (!propertyActor) return false;

    const operationalDimension =
      /\b(?:maintenance|repair|repairs|repair bills?|repair costs?|operating costs?|operating expenses?|unexpected costs?|expenses?|budget|budgeting|budget variance|contractor costs?|contractor expenses?|tenant complaints?|tenant risks?|vacancy|vacancies|renovation|renovations|deterioration|property performance|profitability|cash flow|net operating income|\bnoi\b)\w*\b/iu.test(
        evidence,
      );
    if (!operationalDimension) return false;

    const broadInvestmentDiscovery =
      /\b(?:best places? to invest|best cities? to invest|best neighborhoods? to invest|buy investment properties?|investment properties? under \$?\d|passive income ideas?|reit portfolio|reit dividend|dividend sustainability|mortgage rates? (?:are )?fueling|real estate outlook|markets? to watch|turnkey rentals?|college town rental|monthly income without owning|stock market|house price spikes?|property stocks?)\b/iu.test(
        evidence,
      );
    const operatingProblemSignal =
      /\b(?:unexpected|rising|higher|increase|declining|lower|challenge|challenges|risk|risks|cost|costs|expense|expenses|maintenance|repair|budget|budgeting|vacancy|vacancies|tenant complaint|tenant risk|deterioration|renovation|profitability|cash flow)\w*\b/iu.test(
        evidence,
      );
    if (broadInvestmentDiscovery && !operatingProblemSignal) return false;

    const taxOnly =
      /\b(?:1031 exchange|depreciation recapture|tax loophole|cost segregation|property tax|rental income tax|zak[aā]t)\b/iu.test(
        evidence,
      ) &&
      !/\b(?:maintenance|repair|operating cost|operating expense|budget|tenant complaint|vacancy|contractor)\w*\b/iu.test(
        evidence,
      );
    if (taxOnly) return false;

    return true;
  }

  private static hasDeterministicProblemExpression(value: string): boolean {
    const evidence = this.normalize(value);
    return /\b(?:struggl\w*|problem\w*|issue\w*|complain\w*|friction|bottleneck\w*|fail\w*|error\w*|wrong|incorrect|inaccurate|missing|lost|forgotten|unavailable|cannot|can t|unable|difficult|hard to|delay\w*|declin\w*|rising|increase\w*|decrease\w*|waste\w*|rework|repeat\w*|inconsistent|fragmented|scattered|siloed|underused|overcrowd\w*|cancelled|canceled|cancelling|canceling|churn|leave|leaving|request\w*|need\w*|wish|would like|please add|should support|not available)\b/iu.test(
      evidence,
    );
  }

  /**
   * Conservative guard used only when online semantic triage is unavailable.
   * AI may infer semantic relations from prose; the deterministic emergency
   * path may not. It therefore requires an actor/object identity match plus a
   * real workflow-axis overlap so generic words such as "restoration",
   * "material", or "customer" cannot manufacture supporting evidence.
   */
  private static passesDeterministicSupportingFallbackGuard(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    /*
     * Availability fallback must obey the same pain-aware admission contract
     * as a successful online AI classification. The broad pre-AI admission
     * guard is intentionally permissive for discovery and must never become
     * evidence admission when providers time out.
     */
    if (!this.passesPostAiPainAwareEvidenceGuard(input)) return false;

    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence) return false;

    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    const workflowOverlap = [...requestTokens]
      .filter((token) => this.isWorkflowAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const distinctiveOverlap = [...requestTokens]
      .filter((token) => this.isDistinctiveRequestAnchorToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const outcomeOverlap = [...requestTokens]
      .filter((token) => this.isOutcomeAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const actor = RequestDynamicQueryUtil.extractActor(request);
    const actorAligned = actor
      ? this.dynamicActorAligned(request, evidence)
      : false;

    if (actor) {
      const painAligned = this.isDomainAgnosticSupportingEvidence({
        requestDescription: request,
        evidenceText: evidence,
      });
      /*
       * Practitioner sources often use a professional synonym for the actor
       * (for example "clockmaker" instead of "antique clock restoration
       * specialist"). Require the same concrete pain/workflow evidence, but
       * allow a distinctive requester-object overlap to stand in for a literal
       * actor phrase match. Domain-only tutorials still fail `painAligned`.
       */
      return (
        painAligned &&
        (actorAligned || distinctiveOverlap >= 1) &&
        (workflowOverlap >= 1 || outcomeOverlap >= 1 || this.hasDeterministicProblemExpression(evidence))
      );
    }

    const sharedOverlap = [...requestTokens].filter((token) =>
      evidenceTokens.has(token),
    ).length;
    if (
      this.hasDeterministicProblemExpression(evidence) &&
      (distinctiveOverlap >= 1 || sharedOverlap >= 2)
    ) {
      return true;
    }
    if (
      actorAligned &&
      workflowOverlap >= 1 &&
      (distinctiveOverlap >= 1 || outcomeOverlap >= 1)
    ) {
      return true;
    }

    return (
      evidenceTokens.size >= 5 &&
      distinctiveOverlap >= 2 &&
      workflowOverlap >= 1
    );
  }

  static selectCompositeAlignedEvidence(input: {
    readonly requestDescription?: string | null;
    readonly evidenceTexts: readonly string[];
    readonly plannedQueries?: readonly string[];
    readonly maxSamples?: number;
  }): string[] {
    const request = this.normalize(input.requestDescription ?? '');
    if (!request) return [];

    const maxSamples = Math.max(1, Math.min(input.maxSamples ?? 5, 8));
    const evidenceTexts = [
      ...new Set(
        input.evidenceTexts
          .map((value) => value.replace(/\s+/gu, ' ').trim())
          .filter((value) => value.length >= 24),
      ),
    ];
    if (evidenceTexts.length === 0) return [];

    const individuallyAligned = evidenceTexts.filter((evidenceText) =>
      this.isAligned({
        requestDescription: request,
        evidenceText,
        plannedQueries: input.plannedQueries ?? [],
      }),
    );
    if (individuallyAligned.length > 0) {
      const individuallyAlignedSet = new Set(individuallyAligned);
      const complementarySignals = evidenceTexts.filter(
        (evidenceText) =>
          !individuallyAlignedSet.has(evidenceText) &&
          this.isRequestSupportingSignal(
            request,
            this.normalize(evidenceText),
          ),
      );
      return [...individuallyAligned, ...complementarySignals].slice(
        0,
        maxSamples,
      );
    }

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    const requestTokens = this.extractTokens(request);
    const requestSignalTokens = [...requestTokens].filter((token) =>
      this.isProblemOrWorkflowSignal(token),
    );

    const candidates = evidenceTexts
      .filter(
        (evidenceText) =>
          archetype.archetype === 'DEVELOPER_TECHNICAL' ||
          !this.isDeveloperOnlyEvidence(this.normalize(evidenceText)),
      )
      .map((evidenceText, index) => {
        const normalizedEvidence = this.normalize(evidenceText);
        const evidenceTokens = this.extractTokens(evidenceText);
        const sharedTokens = [...requestTokens].filter((token) =>
          evidenceTokens.has(token),
        );
        const sharedSignals = requestSignalTokens.filter((token) =>
          evidenceTokens.has(token),
        );
        const dynamicActorRelated = this.dynamicActorAligned(
          request,
          evidenceText,
        );
        const actorRelated =
          dynamicActorRelated ||
          sharedTokens.some((token) => token.length >= 7);
        const requestSupportingSignal = this.isRequestSupportingSignal(
          request,
          normalizedEvidence,
        );
        const score =
          sharedSignals.length * 4 +
          sharedTokens.length * 1.5 +
          (actorRelated ? 2 : 0) +
          (requestSupportingSignal ? 6 : 0);

        return {
          evidenceText,
          index,
          sharedTokens,
          sharedSignals,
          dynamicActorRelated,
          actorRelated,
          requestSupportingSignal,
          score,
        };
      })
      .filter(
        (entry) =>
          entry.requestSupportingSignal ||
          (entry.sharedSignals.length >= 1 &&
            (entry.dynamicActorRelated || entry.sharedTokens.length >= 2)),
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.index - right.index,
      )
      .slice(0, maxSamples);

    if (candidates.length < 2) return [];

    const distinctSignalCoverage = new Set(
      candidates.flatMap((entry) => entry.sharedSignals),
    );
    const distinctTokenCoverage = new Set(
      candidates.flatMap((entry) => entry.sharedTokens),
    );
    if (
      distinctSignalCoverage.size < 2 &&
      distinctTokenCoverage.size < 4
    ) {
      return [];
    }

    const compositeText = candidates
      .map((entry) => entry.evidenceText)
      .join(' ');
    if (
      !this.isAligned({
        requestDescription: request,
        evidenceText: compositeText,
        plannedQueries: input.plannedQueries ?? [],
      })
    ) {
      if (
        (archetype.archetype === 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS' ||
          archetype.archetype === 'RESTAURANT_DELIVERY_FRAUD_OPERATIONS' ||
          archetype.archetype === 'AGRICULTURAL_DISTRIBUTION_PROFITABILITY_OPERATIONS' ||
          archetype.archetype === 'AGRICULTURAL_EXPORT_PROFITABILITY_OPERATIONS' ||
          this.isMediaContentProfitabilityRequest(request) ||
          this.isInstrumentCaseSpecificationRequest(request) ||
          Boolean(RequestNicheCustomCraftUtil.resolve(request))) &&
        candidates.length >= 2 &&
        candidates.every((entry) => entry.requestSupportingSignal)
      ) {
        return candidates.map((entry) => entry.evidenceText);
      }
      return [];
    }

    return candidates.map((entry) => entry.evidenceText);
  }

  static isCompositeAligned(input: {
    readonly requestDescription?: string | null;
    readonly evidenceTexts: readonly string[];
    readonly plannedQueries?: readonly string[];
  }): boolean {
    return this.selectCompositeAlignedEvidence({
      ...input,
      maxSamples: 5,
    }).length > 0;
  }

  /**
   * A supporting signal is intentionally weaker than independently verified
   * problem evidence. It exists so Community AI can combine several
   * complementary, provenance-preserved observations about the same actor and
   * workflow instead of requiring one quote to restate the complete requester
   * problem. The final composite still has to pass the normal strict request
   * alignment gate, so same-domain but unrelated material cannot manufacture a
   * problem by aggregation.
   */
  private static isRequestSupportingSignal(
    request: string,
    evidence: string,
  ): boolean {
    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
    });
    if (archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS') {
      return this.isFoodStorageConditionSupportingEvidence(request, evidence);
    }

    if (this.isRestorationConservationRequest(request)) {
      return (
        this.isRestorationConservationSupportingEvidence(request, evidence) ||
        this.isAdjacentPhysicalWorkflowExactPainSupportingEvidence(request, evidence)
      );
    }

    if (this.isPublicTransportationProfitabilityRequest(request)) {
      return this.isPublicTransportationProfitabilitySupportingEvidence(evidence);
    }

    if (this.isMediaContentProfitabilityRequest(request)) {
      return this.isMediaContentProfitabilitySupportingSignal(evidence);
    }

    if (
      archetype.archetype === 'PROPERTY_ASSET_PERFORMANCE_OPERATIONS'
    ) {
      return this.isPropertyAssetPerformanceSupportingEvidence(evidence);
    }

    if (this.isAgriculturalExportProfitabilityRequest(request)) {
      return this.isAgriculturalExportProfitabilitySupportingEvidence(evidence);
    }

    if (this.isEyeglassFrameRepairRequest(request)) {
      return this.isEyeglassFrameRepairSupportingEvidence(evidence);
    }

    if (this.isMunicipalWasteCollectionRequest(request)) {
      return this.isMunicipalWasteCollectionSupportingSignal(evidence);
    }

    if (this.isBridalAlterationWorkflowRequest(request)) {
      return this.isBridalAlterationWorkflowSupportingEvidence(evidence);
    }

    if (this.isMusicalManuscriptRestorationRequest(request)) {
      return this.isMusicalManuscriptRestorationSupportingSignal(evidence);
    }

    if (this.isHospitalOperatingRoomCoordinationRequest(request)) {
      return this.isHospitalOperatingRoomCoordinationSupportingSignal(evidence);
    }

    if (this.isPublicTransitDisruptionCoordinationRequest(request)) {
      return this.isPublicTransitDisruptionCoordinationSupportingSignal(
        evidence,
      );
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isSupportingEvidence(request, evidence);
    }

    if (this.isInstrumentCaseSpecificationRequest(request)) {
      return this.isInstrumentCaseSpecificationSupportingSignal(evidence);
    }

    if (this.isMusicalRepairRequest(request)) {
      return this.isMusicalRepairSupportingSignal(evidence);
    }

    if (this.isTattooDesignApprovalRequest(request)) {
      return this.isTattooDesignApprovalSupportingSignal(evidence);
    }

    return this.isGenericRequestSupportingSignal(request, evidence);
  }

  /**
   * Detects requester-defined digital account/security workflows without
   * hard-coding one business vertical. This covers property-management,
   * education, healthcare, government, marketplace, and similar operational
   * systems when the request explicitly combines a digital account/access
   * workflow with a security/fraud failure.
   */
  private static isOperationalDigitalSecurityRequest(request: string): boolean {
    const normalized = this.normalize(request);
    if (!normalized) return false;

    /*
     * Transaction/account-abuse requests have their own evidence contract.
     * Do not let this broader digital-security matcher steal those requests
     * before municipal/payment/account-abuse supporting logic can run.
     */
    if (
      RequestWorkflowIntentProfileUtil.resolve(normalized).family ===
      'TRANSACTION_ACCOUNT_ABUSE'
    ) {
      return false;
    }

    const digitalWorkflow =
      /\b(?:digital platforms?|software platforms?|online platforms?|portals?|login activity|logins?|accounts?|rental payments?|payments?|transactions?|permission changes?|permissions?|access permissions?|access logs?|authentication|credentials?|security alerts?|building records?|tenant records?|resident records?)\b/iu.test(
        normalized,
      );
    const securityProblem =
      /\b(?:cybersecurity|security|compromis\w*|unauthori[sz]ed|fraud\w*|suspicious|anomal\w*|account takeover|identity theft|data breach|exposed|privacy|permission changes?|access abuse|false positive|unnecessary restrictions?)\b/iu.test(
        normalized,
      );

    return digitalWorkflow && securityProblem;
  }

  /**
   * Pain-aware supporting contract for generic digital security workflows.
   *
   * Same-domain security news is not enough. Evidence must retain requester
   * actor/object identity, describe a real digital/security incident, and
   * overlap at least one security facet from the request. This rejects generic
   * breaches and record/document stories while preserving a property-platform
   * breach, tenant-account takeover, payment fraud, permission abuse, or
   * exposed tenant-record incident when the vertical identity is actually in
   * the evidence.
   */
  private static isOperationalDigitalSecuritySupportingEvidence(
    request: string,
    evidence: string,
  ): boolean {
    const normalizedRequest = this.normalize(request);
    const normalizedEvidence = this.normalize(evidence);
    if (!normalizedRequest || !normalizedEvidence) return false;

    if (
      !this.passesRawCorpusLexicalHygieneGuard({
        requestDescription: normalizedRequest,
        evidenceText: normalizedEvidence,
      })
    ) {
      return false;
    }

    const evidenceTokens = this.extractTokens(normalizedEvidence);
    const identityTerms =
      RequestDynamicQueryUtil.extractEvidenceIdentityTerms(normalizedRequest);
    const genericSecurityIdentityTerms = new Set([
      'digital',
      'online',
      'platform',
      'platforms',
      'system',
      'systems',
      'account',
      'accounts',
      'payment',
      'payments',
      'transaction',
      'transactions',
      'access',
      'permission',
      'permissions',
      'security',
      'alert',
      'alerts',
      'data',
      'records',
      'information',
      'increasingly',
      'rely',
      'however',
    ]);
    const verticalIdentityOverlap = identityTerms
      .filter((term) => !genericSecurityIdentityTerms.has(term))
      .filter((term) => this.semanticTokenAligned(term, evidenceTokens)).length;
    const actorAligned = this.dynamicActorAligned(
      normalizedRequest,
      normalizedEvidence,
    );

    const identityGate = actorAligned || verticalIdentityOverlap >= 2;
    if (!identityGate) return false;

    const digitalSystemSignal =
      /\b(?:software|platforms?|portals?|systems?|applications?|apps?|databases?|online|digital|login|logins|accounts?|authentication|credentials?|permissions?|access controls?|access logs?|payments?|transactions?|security alerts?|tenant data|resident data|customer data|building records?)\b/iu.test(
        normalizedEvidence,
      );
    const concreteSecurityIncident =
      /\b(?:data breach|security incident|cyberattack|cyber attack|account takeover|compromis\w*|credential theft|stolen credentials?|unauthori[sz]ed access|fraud\w*|fraudulent transactions?|payment fraud|permission changes?|privilege changes?|access abuse|exposed (?:tenant|resident|customer|personal|sensitive)? ?(?:data|information|records?)|privacy breach|identity theft|suspicious activit\w*|security alerts?|anomal\w*)\b/iu.test(
        normalizedEvidence,
      );
    if (!digitalSystemSignal || !concreteSecurityIncident) return false;

    const sharedFacetGroups = [
      [
        /\b(?:login|account|authentication|credential|account takeover|compromis)\w*\b/iu,
        /\b(?:login|account|authentication|credential|account takeover|compromis)\w*\b/iu,
      ],
      [
        /\b(?:payment|transaction|fraud|fraudulent)\w*\b/iu,
        /\b(?:payment|transaction|fraud|fraudulent)\w*\b/iu,
      ],
      [
        /\b(?:permission|access|authorization|authorisation|privilege)\w*\b/iu,
        /\b(?:permission|access|authorization|authorisation|privilege)\w*\b/iu,
      ],
      [
        /\b(?:records?|data|information|privacy|exposed)\w*\b/iu,
        /\b(?:records?|data|information|privacy|exposed|breach)\w*\b/iu,
      ],
      [
        /\b(?:alert|anomaly|anomalies|suspicious|monitoring|detect)\w*\b/iu,
        /\b(?:alert|anomaly|anomalies|suspicious|monitoring|detect)\w*\b/iu,
      ],
    ] as const;

    const sharedSecurityFacet = sharedFacetGroups.some(
      ([requestPattern, evidencePattern]) =>
        requestPattern.test(normalizedRequest) &&
        evidencePattern.test(normalizedEvidence),
    );

    return sharedSecurityFacet;
  }

  /**
   * Domain-agnostic supporting-evidence contract. It derives identity,
   * workflow, and pain facets from the requester text itself. This is only a
   * SUPPORTING gate; DIRECT_PROBLEM still uses the stricter full-problem rules.
   */
  /**
   * Identifies request-aligned workflow/market context that is useful for
   * terminology expansion and recovery, but is NOT evidence of user pain.
   * This deliberately omits any problem-expression requirement.
   */
  static isRequestWorkflowContextEvidence(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence || evidence.length < 12) return false;
    if (this.isDeveloperOnlyEvidence(evidence) && !/\b(?:api|sdk|developer|software engineering|programming|source code)\b/iu.test(request)) {
      return false;
    }
    if (!this.passesRawCorpusLexicalHygieneGuard({ requestDescription: request, evidenceText: evidence })) {
      return false;
    }

    if (this.isRestorationConservationRequest(request, input.plannedQueries ?? [])) {
      if (this.isRestorationConservationTriageCandidate(request, evidence)) return true;
      // CONTEXT_ONLY may use adjacent professional conservation workflows even
      // when the exact object differs. This is intentionally broader than the
      // evidence gate because it cannot count as demand/problem evidence.
      const professionalConservation =
        /\b(?:conservation professionals?|conservators?|museum curators?|art collectors?|artworks?|historical artifacts?|artifact conservation|object conservation|condition reports?|treatment reports?)\b/iu.test(evidence);
      const documentationWorkflow =
        /\b(?:condition reports?|annotated (?:pictures|photos)|damage(?:s)? types?|materials?|treatment reports?|subsequent reports?|archive|archiving|documentation|records?|photos?|recommendations?)\b/iu.test(evidence);
      return professionalConservation && documentationWorkflow;
    }

    if (this.isTransactionAccountAbuseRequest(request)) {
      // Context for fraud/account-abuse must still describe the relevant
      // transaction/account workflow; generic finance or relationship content
      // is not useful recovery context.
      return this.isTransactionAccountAbuseTriageCandidate(request, evidence);
    }

    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    const identityTerms = RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request);
    const identityOverlap = identityTerms.filter((term) =>
      this.semanticTokenAligned(term, evidenceTokens),
    ).length;
    const workflowOverlap = RequestDynamicQueryUtil.extractWorkflowTerms(request)
      .filter((facet) => this.facetPhraseAligned(facet, evidenceTokens)).length;
    const distinctiveOverlap = [...requestTokens]
      .filter((token) => this.isDistinctiveRequestAnchorToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const actorAligned = this.dynamicActorAligned(request, evidence);

    return (actorAligned && (identityOverlap >= 1 || workflowOverlap >= 1)) ||
      (identityOverlap >= 1 && workflowOverlap >= 1) ||
      (distinctiveOverlap >= 2 && workflowOverlap >= 1);
  }

  static isDomainAgnosticSupportingEvidence(input: {
    readonly requestDescription?: string | null;
    readonly evidenceText: string;
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const evidence = this.normalize(input.evidenceText);
    if (!request || !evidence || evidence.length < 12) return false;
    if (this.isResearchContextOnlyEvidence(evidence)) return false;
    if (!this.hasProblemBearingClaim(evidence)) return false;

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
    });
    if (
      archetype.archetype !== 'DEVELOPER_TECHNICAL' &&
      this.isDeveloperOnlyEvidence(evidence)
    ) {
      return false;
    }

    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    if (requestTokens.size === 0 || evidenceTokens.size === 0) return false;

    /*
     * Restoration is collision-prone: "restoration", "damaged", and
     * "missing" also occur in image restoration, software/data recovery, and
     * unrelated engineering papers. Route this archetype through the
     * restoration-specific actor/object guard before the generic supporting
     * logic so object identity is mandatory while partial practitioner evidence
     * can still qualify.
     */
    if (this.isRestorationConservationRequest(request)) {
      return (
        this.isRestorationConservationSupportingEvidence(request, evidence) ||
        this.isAdjacentPhysicalWorkflowExactPainSupportingEvidence(request, evidence)
      );
    }

    const identityTerms = RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request);
    const identityOverlap = identityTerms.filter((token) =>
      this.semanticTokenAligned(token, evidenceTokens),
    ).length;
    const actorAligned = this.dynamicActorAligned(request, evidence);
    const workflowFacetOverlap = RequestDynamicQueryUtil.extractWorkflowTerms(request)
      .filter((facet) => this.facetPhraseAligned(facet, evidenceTokens)).length;
    const painFacetOverlap = RequestDynamicQueryUtil.extractPainTerms(request)
      .filter((facet) => this.facetPhraseAligned(facet, evidenceTokens)).length;
    const outcomeOverlap = [...requestTokens]
      .filter((token) => this.isOutcomeAxisToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const distinctiveOverlap = [...requestTokens]
      .filter((token) => this.isDistinctiveRequestAnchorToken(token))
      .filter((token) => evidenceTokens.has(token)).length;
    const problemExpression = this.hasDeterministicProblemExpression(evidence);

    const physicalOrSpecificationWorkflow =
      archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' ||
      archetype.archetype === 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS' ||
      archetype.archetype === 'PROFESSIONAL_EVIDENCE_RECORDS_OPERATIONS';
    const hasConcretePainOrOutcome = painFacetOverlap >= 1 || outcomeOverlap >= 1;
    const supportProblemGate = physicalOrSpecificationWorkflow
      ? hasConcretePainOrOutcome && problemExpression
      : hasConcretePainOrOutcome || (workflowFacetOverlap >= 1 && problemExpression);

    if (actorAligned && supportProblemGate) {
      return true;
    }

    if (identityOverlap >= 2 && supportProblemGate) {
      return true;
    }

    /*
     * Cross-domain corroboration may use a different actor label while still
     * proving the same causal mechanism (for example fulfillment inventory +
     * freight cost + cash impact supporting a manufacturing order-margin
     * workflow). Relax literal actor identity only for non-physical workflows
     * and only when several distinctive requester concepts, workflow facets,
     * and a real pain/outcome expression co-occur.
     */
    if (
      !physicalOrSpecificationWorkflow &&
      distinctiveOverlap >= 2 &&
      workflowFacetOverlap >= 2 &&
      hasConcretePainOrOutcome &&
      problemExpression
    ) {
      return true;
    }

    return (
      identityOverlap >= 1 &&
      workflowFacetOverlap >= 2 &&
      supportProblemGate
    );
  }

  private static semanticTokenAligned(
    token: string,
    evidenceTokens: ReadonlySet<string>,
  ): boolean {
    const normalized = this.normalize(token);
    if (!normalized) return false;
    if (evidenceTokens.has(normalized)) return true;

    /*
     * Allow safe compound/professional morphology such as clock -> clockmaker
     * or textile -> textiles while avoiding short-token substring collisions.
     * This is only used inside the SUPPORTING gate, which separately requires
     * a concrete workflow/pain signal.
     */
    if (normalized.length < 5) return false;
    return [...evidenceTokens].some((candidate) => {
      if (candidate.length < 5) return false;
      return (
        candidate.startsWith(normalized) ||
        normalized.startsWith(candidate)
      );
    });
  }

  private static facetPhraseAligned(
    facet: string,
    evidenceTokens: ReadonlySet<string>,
  ): boolean {
    const facetTokens = [...this.extractTokens(facet)];
    if (facetTokens.length === 0) return false;
    const overlap = facetTokens.filter((token) => evidenceTokens.has(token)).length;
    if (facetTokens.length === 1) return overlap === 1;
    return overlap >= Math.min(2, Math.ceil(facetTokens.length * 0.5));
  }

  private static facetPhraseStronglyAligned(
    facet: string,
    evidenceTokens: ReadonlySet<string>,
  ): boolean {
    const facetTokens = [...this.extractTokens(facet)];
    if (facetTokens.length === 0) return false;
    const overlap = facetTokens.filter((token) => evidenceTokens.has(token)).length;
    if (facetTokens.length === 1) return overlap === 1;
    if (facetTokens.length === 2) return overlap === 2;
    return overlap >= Math.max(2, Math.ceil(facetTokens.length * 0.6));
  }

  private static isGenericRequestSupportingSignal(
    request: string,
    evidence: string,
  ): boolean {
    if (
      this.isDomainAgnosticSupportingEvidence({
        requestDescription: request,
        evidenceText: evidence,
      })
    ) {
      return true;
    }

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
    });
    if (
      archetype.archetype !== 'DEVELOPER_TECHNICAL' &&
      this.isDeveloperOnlyEvidence(evidence)
    ) {
      return false;
    }


    /*
     * Generic physical/restoration evidence must contain an actual pain or
     * workflow failure. Object identity + a tutorial/process description is
     * contextual knowledge, not support for scattered records, wrong parts,
     * rework, or delayed projects.
     */
    if (
      archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      this.isRestorationConservationRequest(request) ||
      archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' ||
      archetype.archetype === 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS' ||
      archetype.archetype === 'PROFESSIONAL_EVIDENCE_RECORDS_OPERATIONS'
    ) {
      return this.isDomainAgnosticSupportingEvidence({
        requestDescription: request,
        evidenceText: evidence,
      });
    }
    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    if (requestTokens.size === 0 || evidenceTokens.size === 0) return false;

    const sharedTokens = [...requestTokens].filter((token) =>
      evidenceTokens.has(token),
    );
    const workflowTokens = [...requestTokens].filter((token) =>
      this.isWorkflowAxisToken(token),
    );
    const outcomeTokens = [...requestTokens].filter((token) =>
      this.isOutcomeAxisToken(token),
    );
    const workflowOverlap = workflowTokens.filter((token) =>
      evidenceTokens.has(token),
    ).length;
    const outcomeOverlap = outcomeTokens.filter((token) =>
      evidenceTokens.has(token),
    ).length;
    const actorRelated = this.dynamicActorAligned(request, evidence);
    const distinctiveRequestTokens = [...requestTokens].filter((token) =>
      this.isDistinctiveRequestAnchorToken(token),
    );
    const distinctiveOverlap = distinctiveRequestTokens.filter((token) =>
      evidenceTokens.has(token),
    ).length;

    /*
     * Broad workflow words such as maintenance, customer, equipment, cost,
     * service, and records are not enough to enter the composite lane. At
     * least one distinctive requester anchor (or a request-specific actor
     * match) must survive so unrelated software/client/maintenance material
     * cannot become supporting evidence merely through lexical overlap.
     */
    if (!actorRelated && distinctiveRequestTokens.length > 0 && distinctiveOverlap === 0) {
      return false;
    }

    /*
     * This is intentionally weaker than `isAligned`: one retained item may
     * carry the actor + workflow while another carries the failure/outcome.
     * It is only admitted to the composite lane; the concatenated group still
     * has to pass the normal strict request-alignment contract before it can
     * qualify as problem evidence.
     */
    return (
      (actorRelated && workflowOverlap >= 1) ||
      (actorRelated && outcomeOverlap >= 1) ||
      (workflowOverlap >= 2 && sharedTokens.length >= 3) ||
      (workflowOverlap >= 1 && outcomeOverlap >= 1 && sharedTokens.length >= 3)
    );
  }

  private static isMunicipalWasteCollectionRequest(value: string): boolean {
    return (
      /\b(?:cities|city governments?|municipalities|municipal governments?|city councils?|sanitation departments?|waste management departments?|public works departments?)\b/iu.test(value) &&
      /\b(?:waste collection|garbage collection|refuse collection|collection schedules?|pickup schedules?|vehicle locations?|collection vehicles?|container capacity|bin capacity|fill levels?|citizen complaints?|route performance|waste collection routes?|disposal patterns?|population densities?|neighborhood density)\b/iu.test(value)
    );
  }

  private static isMunicipalWasteCollectionEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const developerGarbageCollectionCollision =
      /\b(?:java|javascript|node\.js|runtime|heap|memory|gc pause|garbage collector|garbage collection algorithm|source code)\b/iu.test(value) &&
      !/\b(?:municipal|city|sanitation|waste collection|garbage truck|refuse collection)\b/iu.test(value);
    if (developerGarbageCollectionCollision) return false;

    const municipalContext =
      /\b(?:municipal|municipality|municipalities|city sanitation|sanitation department|public works|local authority|city government|urban solid waste|municipal solid waste|city waste|waste collection service)\b/iu.test(value);
    const collectionWorkflow =
      /\b(?:waste collection|garbage collection|refuse collection|solid waste collection|collection schedule|pickup schedule|collection frequency|waste collection route|garbage truck|collection vehicle|container|containers|bin|bins|dumpster|dumpsters)\b/iu.test(value);
    const coordinationSignal =
      /\b(?:schedule|scheduling|pickup|collection frequency|route|routing|vehicle location|gps|fill level|container capacity|bin capacity|citizen complaint|service complaint|traffic|population density|neighborhood|disposal pattern|resource allocation|fleet)\w*\b/iu.test(value);
    const frictionOrOutcome =
      /\b(?:overflow|overflowing|missed pickup|late pickup|static schedule|fixed schedule|unnecessary trip|extra trip|higher operating cost|fuel cost|inefficient|inefficiency|poor route|route delay|service gap|insufficient capacity|additional resources|earlier pickup|underutilized vehicle|wasted trip|complaint backlog)\w*\b/iu.test(value);

    return (
      municipalContext &&
      collectionWorkflow &&
      coordinationSignal &&
      frictionOrOutcome
    );
  }

  private static isMunicipalWasteCollectionSupportingSignal(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const developerGarbageCollectionCollision =
      /\b(?:java|javascript|node\.js|runtime|heap|memory|gc pause|garbage collector|garbage collection algorithm|source code)\b/iu.test(value) &&
      !/\b(?:municipal|city|sanitation|waste collection|garbage truck|refuse collection)\b/iu.test(value);
    if (developerGarbageCollectionCollision) return false;

    const municipalOrWasteContext =
      /\b(?:municipal|municipality|municipalities|city sanitation|sanitation department|public works|local authority|city government|urban solid waste|municipal solid waste|city waste|waste collection service|waste collection|garbage collection|refuse collection)\b/iu.test(value);
    const operationalAxis =
      /\b(?:collection schedule|pickup schedule|collection frequency|route|routing|collection vehicle|garbage truck|vehicle location|gps|container|bin|dumpster|fill level|capacity|citizen complaint|service complaint|traffic|population density|neighborhood|resource allocation|fleet)\w*\b/iu.test(value);
    const frictionAxis =
      /\b(?:overflow|overflowing|missed pickup|late pickup|static schedule|fixed schedule|unnecessary trip|extra trip|higher operating cost|fuel cost|inefficient|inefficiency|poor route|route delay|service gap|insufficient capacity|additional resources|earlier pickup|underutilized vehicle|wasted trip|complaint backlog)\w*\b/iu.test(value);

    return municipalOrWasteContext && (operationalAxis || frictionAxis);
  }

  private static isMusicalManuscriptRestorationRequest(value: string): boolean {
    return (
      /\b(?:musical score restoration specialists?|music score restoration specialists?|music manuscript conservators?|musical manuscript conservators?|paper conservators?|manuscript conservators?|document conservators?)\b/iu.test(value) &&
      /\b(?:damaged manuscripts?|musical scores?|music manuscripts?|missing pages?|missing leaves?|handwritten annotations?|marginalia|previous repairs?|repair history|paper types?|paper characteristics?|customer instructions?|client instructions?|approved treatment|treatment records?|restoration progress|conservation treatment|condition records?)\b/iu.test(value)
    );
  }

  private static isMusicalManuscriptRestorationEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const digitalMusicCollision =
      /\b(?:music streaming|audio restoration|audio mastering|sheet music app|notation software|midi|playlist|spotify|digital audio workstation|daw)\b/iu.test(value) &&
      !/\b(?:manuscript|paper conservation|document conservation|conservator|physical score)\b/iu.test(value);
    if (digitalMusicCollision) return false;

    const conservationContext =
      /\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conservation|manuscript conservators?|paper conservation|paper conservators?|document conservation|document conservators?|archive conservation|book and paper conservators?)\b/iu.test(value);
    const recordOrTreatmentWorkflow =
      /\b(?:condition report|condition record|condition documentation|damaged manuscript|missing page|missing leaf|handwritten annotation|annotation|marginalia|previous repair|repair history|paper type|paper characteristic|treatment record|treatment history|conservation treatment|restoration treatment|client instruction|customer instruction|approved treatment|treatment progress|restoration progress|photographic documentation)\w*\b/iu.test(value);
    const frictionOrOutcome =
      /\b(?:missing|lost|incomplete|scattered|fragmented|undocumented|incorrect treatment|wrong treatment|treatment error|duplicated work|duplicate work|rework|damaged material|further damage|delay|delayed|hard to track|difficult to track|lost annotation|record gap|documentation gap|unclear prior repair)\w*\b/iu.test(value);

    return (
      conservationContext &&
      recordOrTreatmentWorkflow &&
      frictionOrOutcome
    );
  }

  private static isMusicalManuscriptRestorationSupportingSignal(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const digitalMusicCollision =
      /\b(?:music streaming|audio restoration|audio mastering|sheet music app|notation software|midi|playlist|spotify|digital audio workstation|daw)\b/iu.test(value) &&
      !/\b(?:manuscript|paper conservation|document conservation|conservator|physical score)\b/iu.test(value);
    if (digitalMusicCollision) return false;

    const conservationContext =
      /\b(?:musical score|music score|music manuscript|musical manuscript|manuscript conservation|manuscript conservators?|paper conservation|paper conservators?|document conservation|document conservators?|archive conservation|book and paper conservators?)\b/iu.test(value);
    const recordOrTreatmentAxis =
      /\b(?:condition report|condition record|condition documentation|damaged manuscript|missing page|missing leaf|handwritten annotation|annotation|marginalia|previous repair|repair history|paper type|paper characteristic|treatment record|treatment history|conservation treatment|restoration treatment|client instruction|customer instruction|approved treatment|treatment progress|restoration progress|photographic documentation)\w*\b/iu.test(value);
    const frictionAxis =
      /\b(?:missing|lost|incomplete|scattered|fragmented|undocumented|incorrect treatment|wrong treatment|treatment error|duplicated work|duplicate work|rework|damaged material|further damage|delay|delayed|hard to track|difficult to track|lost annotation|record gap|documentation gap|unclear prior repair)\w*\b/iu.test(value);

    return conservationContext && (recordOrTreatmentAxis || frictionAxis);
  }

  private static isUrbanEnergyDemandRequest(value: string): boolean {
    const actor =
      /\b(?:cities|city governments?|municipalities|municipal governments?|smart cities|urban infrastructure operators?|city infrastructure teams?)\b/iu.test(
        value,
      );
    const assets =
      /\b(?:public buildings?|municipal buildings?|street lighting|streetlights?|charging stations?|ev charging|electric vehicle charging|urban infrastructure)\b/iu.test(
        value,
      );
    const demand =
      /\b(?:electricity demand|energy demand|energy consumption|power demand|peak demand|peak load|high usage|consumption patterns?|energy efficiency)\b/iu.test(
        value,
      );
    return actor && assets && demand;
  }

  private static isUrbanEnergyDemandEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const cityActor =
      /\b(?:city|cities|municipal|municipality|smart city|urban infrastructure|public infrastructure)\b/iu.test(
        value,
      );
    const assetAxis =
      /\b(?:public buildings?|municipal buildings?|street lighting|streetlights?|charging stations?|ev charging|electric vehicle charging|urban infrastructure|public facilities?)\b/iu.test(
        value,
      );
    const demandAxis =
      /\b(?:electricity demand|energy demand|energy consumption|power demand|peak demand|peak load|load growth|consumption pattern|energy efficiency|energy use)\b/iu.test(
        value,
      );
    const operationalAxis =
      /\b(?:equipment status|weather|service demand|forecast|forecasting|overload|overloaded|service interruption|energy cost|inefficient consumption|demand response|load management)\b/iu.test(
        value,
      );
    const consumerCollision =
      /\b(?:home electricity bill|residential bill|mobile app|login|subscription|consumer billing)\b/iu.test(
        value,
      ) &&
      !assetAxis;

    return cityActor && assetAxis && demandAxis && operationalAxis && !consumerCollision;
  }

  private static isUrbanMobilityCongestionEmissionsRequest(value: string): boolean {
    const actor =
      /\b(?:urban transportation agencies?|transportation agencies?|transit agencies?|city transport(?:ation)? departments?|municipal transport(?:ation)?|public transport(?:ation)? authorities?|urban mobility agencies?)\b/iu.test(value);
    const workflow =
      /\b(?:traffic flow|traffic congestion|public transit demand|transit demand|road incidents?|travel times?|route performance|route inefficien|peak hours?|time periods?|bottlenecks?)\w*\b/iu.test(value);
    const impact =
      /\b(?:vehicle emissions?|fuel consumption|air quality|environmental measurements?|longer journeys?|travel time reliability|transportation improvements?)\w*\b/iu.test(value);
    return actor && workflow && impact;
  }

  private static isUrbanMobilityCongestionEmissionsEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const mobilityActor =
      /\b(?:transportation agency|transport agency|transit agency|urban mobility|public transport|public transportation|city traffic|municipal transport|road network|transport authority)\w*\b/iu.test(value);
    const trafficWorkflow =
      /\b(?:traffic congestion|traffic flow|travel time|journey time|road incident|transit demand|public transit demand|route performance|route delay|peak hour|bottleneck|corridor performance)\w*\b/iu.test(value);
    const environmentalOrEfficiency =
      /\b(?:vehicle emissions?|carbon emissions?|air pollution|air quality|fuel consumption|fuel use|idling|unnecessary mileage|transport emissions?|travel time reliability|longer journeys?|delay|delays?)\w*\b/iu.test(value);
    const consumerAppOnly =
      /\b(?:can t register|cannot register|login|sign in|subscription|payment app|app crash|mobile app|account access)\b/iu.test(value) &&
      !trafficWorkflow;

    return (
      mobilityActor &&
      trafficWorkflow &&
      environmentalOrEfficiency &&
      !consumerAppOnly
    );
  }

  private static isTransitCyberIncidentRequest(value: string): boolean {
    return (
      /\b(?:public transportation|public transport|transit operators?|transit agencies?|bus operators?|rail operators?|metro operators?|connected vehicles?|vehicle telemetry|fleet telemetry)\b/iu.test(value) &&
      /\b(?:connected vehicles?|vehicle telemetry|fleet telemetry|onboard systems?|remote vehicle monitoring|vehicle sensors?|network disruption|service disruption|cyberattack|cyber attack|technical failure|malicious interference)\w*\b/iu.test(value)
    );
  }

  private static isAcademicPlatformSecurityRequest(value: string): boolean {
    const actor = /\b(?:public education systems?|education systems?|schools?|school districts?|education authorities?|universities|university|higher education|online learning systems?|learning platforms?|learning management systems?|lms|examination platforms?|online exams?|online assessments?|student information systems?|students?|instructors?|administrative accounts?)\b/iu.test(value);
    const workflow = /\b(?:login activity|login records?|sign[- ]?in activity|authentication logs?|exam sessions?|online exam sessions?|examination platforms?|account permissions?|access permissions?|administrative accounts?|device information|device data|device fingerprints?|security alerts?|account activity|student records?|record access|record changes?|academic integrity|exam integrity)\b/iu.test(value);
    const risk = /\b(?:compromised accounts?|account compromise|suspicious activity|suspicious logins?|unauthorized access|unauthorised access|security incidents?|cybersecurity|detect compromised|false positives?|unnecessary restrictions?|exposed student information|suspicious changes?|academic misuse|exam integrity)\b/iu.test(value);
    return actor && workflow && risk;
  }

  private static isAcademicPlatformSecuritySupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const academicActor = /\b(?:public education|education system|schools?|school districts?|education authorities?|universit(?:y|ies)|higher education|college|colleges|learning platform|learning management system|lms|canvas|moodle|blackboard|school portal|student portal|examination platform|online learning|online assessment|online exam|student information system|student accounts?|instructor accounts?|administrative accounts?)\b/iu.test(value);
    const workflow = /\b(?:login|sign[- ]?in|authentication|account activity|account permissions?|access permissions?|access control|administrative account|student record access|record access|record changes?|device information|device fingerprint|device behavior|device behaviour|exam session|assessment session|security alerts?|security events?|identity events?)\w*\b/iu.test(value);
    const securityRisk = /\b(?:compromised|account takeover|credential theft|suspicious|unauthorized|unauthorised|anomal|security incident|security alert|cyberattack|cyber attack|breach|data incident|misuse|permission abuse|privilege|false positive|legitimate user|unnecessary restriction|academic integrity|exam integrity)\w*\b/iu.test(value);
    const platformIncident =
      /\b(?:learning platform|learning management system|lms|canvas|examination platform|online assessment|online exam|student information system|school system|education system)\b.{0,120}\b(?:breach|cyberattack|cyber attack|security incident|compromised|account takeover|unauthorized access|unauthorised access|suspicious access)\b/iu.test(value) ||
      /\b(?:breach|cyberattack|cyber attack|security incident|compromised|account takeover|unauthorized access|unauthorised access|suspicious access)\b.{0,120}\b(?:learning platform|learning management system|lms|canvas|examination platform|online assessment|online exam|student information system|school system|education system)\b/iu.test(value);
    const staffingOnly = /\b(?:faculty workload|teaching workload|course staffing|course assignment|teaching assistant workload|department staffing|instructor scheduling)\b/iu.test(value) && !securityRisk;
    const recoveryOnly = /\b(?:forgot password|password reset|account recovery|recover account|2fa recovery|alternative sign[- ]?in)\b/iu.test(value) && !securityRisk;
    return academicActor && securityRisk && (workflow || platformIncident) && !staffingOnly && !recoveryOnly;
  }

  private static isAcademicPlatformSecurityEvidence(value: string): boolean {
    if (!this.isAcademicPlatformSecuritySupportingEvidence(value)) return false;
    const explicitNegation =
      /\b(?:no|without)\s+(?:sign|signs|evidence|indication|indications)\b.{0,100}\b(?:compromis\w*|unauthori[sz]ed access|account takeover|breach)\b/iu.test(
        value,
      ) ||
      /\b(?:accounts?|records?|systems?)\b.{0,40}\b(?:not|never)\s+(?:been\s+)?(?:compromis\w*|breached|accessed without authorization)\b/iu.test(
        value,
      );
    if (explicitNegation) return false;

    return /\b(?:incident|compromised|takeover|suspicious|unauthorized|unauthorised|anomal|false positive|blocked legitimate|unnecessary restriction|misuse|exposed|breach|attack|failure|problem|issue|investigat)\w*\b/iu.test(value);
  }

  private static isDecorativeFountainRestorationRequest(value: string): boolean {
    return /\b(?:decorative fountains?|ornamental fountains?|historic fountains?|fountain restoration specialists?|fountain restorers?|fountain maintenance contractors?|water features?)\b/iu.test(value) &&
      /\b(?:pump condition|fountain pumps?|water[- ]?flow|stone damage|metal damage|metal corrosion|replacement components?|replacement parts?|finish preferences?|previous repairs?|repair history|customer requests?|restoration history)\b/iu.test(value);
  }

  private static isDecorativeFountainRestorationSupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const fountainIdentity = /\b(?:decorative fountain|ornamental fountain|historic fountain|stone fountain|public fountain|fountain|water feature)\b/iu.test(value);
    const restorationContext = /\b(?:restor(?:e|ed|ation)|repair|conserv(?:e|ed|ation)|preservation|maintenance|refinish|refinishing|rehabilitation)\w*\b/iu.test(value);
    const workflow = /\b(?:pump condition|pump repair|water[- ]?flow|water circulation|circulation system|stone damage|stone deterioration|stone object|metal damage|metal corrosion|replacement parts?|replacement components?|finish|finishes|stain|sealer|material matching|previous repairs?|repairs? throughout history|repair history|restoration history|maintenance history|previous interventions?|intervention history|customer requests?|repair notes?|restoration notes?|prolonged contact with water|exposed concrete|surface deterioration)\w*\b/iu.test(value);
    const collision = /\b(?:fountain pen|software restoration|data restoration|ecosystem restoration|ram pump|water supply systems?|hot water circulation pump)\b/iu.test(value);
    return fountainIdentity && restorationContext && workflow && !collision;
  }

  private static isDecorativeFountainRestorationEvidence(value: string): boolean {
    if (!this.isDecorativeFountainRestorationSupportingEvidence(value)) return false;
    return /\b(?:wrong|incorrect|mismatch|missing|lost|scattered|repeated|delay|delayed|damage|damaged|corrosion|low flow|no flow|leak|failure|failed|problem|issue|worn|deteriorat|rework)\w*\b/iu.test(value);
  }

  private static isAcademicStaffingWorkloadRequest(value: string): boolean {
    return /\b(?:universities|university departments?|academic departments?|department chairs?|faculty planners?|academic planners?|higher education)\b/iu.test(value) &&
      /\b(?:instructors?|teaching assistants?|academic support staff|faculty workload|teaching workload|course staffing|course assignments?|student demand|course enrollment|staff availability|scheduling conflicts?|overloaded staff|expertise matching)\b/iu.test(value);
  }

  private static isAcademicStaffingWorkloadEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const academicActor =
      /\b(?:universities|university|higher education|academic department|faculty|instructors?|teaching assistants?|\bta\b|department chairs?|academic staff|teaching staff)\b/iu.test(value);
    const staffingWorkflow =
      /\b(?:faculty workload|teaching workload|teaching load|course staffing|course assignment|teaching assignment|staff allocation|workload allocation|instructor availability|staff availability|course enrollment|student demand|expertise|academic support|teaching assistant workload|faculty capacity)\b/iu.test(value);
    const staffingFriction =
      /\b(?:overload|overloaded|uneven|inequit|imbalance|scheduling conflict|conflicting schedule|understaffed|staff shortage|insufficient support|delayed student support|delayed assistance|manual allocation|fragmented records?|separate systems?|data silo|difficult to assign|hard to assign|workload concern|burnout)\w*\b/iu.test(value);
    const unrelatedEducationCollision =
      /\b(?:student login|account access|payment page|tuition payment|lms authentication|course content|homework app)\b/iu.test(value) &&
      !staffingWorkflow;

    return academicActor && staffingWorkflow && staffingFriction && !unrelatedEducationCollision;
  }

  private static isPetTrainerBehaviorTrackingRequest(value: string): boolean {
    return /\b(?:independent pet trainers?|pet trainers?|dog trainers?|animal trainers?|behavior trainers?|behaviour trainers?|pet behavior consultants?|pet behaviour consultants?)\b/iu.test(value) &&
      /\b(?:behavioral problems?|behavioural problems?|training exercises?|progress between sessions?|owner feedback|triggers?|recommended routines?|training sessions?|behavior history|behaviour history|home practice)\b/iu.test(value);
  }

  private static isPetTrainerBehaviorTrackingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const trainerActor =
      /\b(?:pet trainers?|dog trainers?|animal trainers?|behavior trainers?|behaviour trainers?|pet behavior consultants?|pet behaviour consultants?|dog behaviorists?|dog behaviourists?|canine trainers?)\b/iu.test(value);
    const trainingWorkflow =
      /\b(?:behavioral problems?|behavioural problems?|behavior triggers?|behaviour triggers?|training exercises?|training sessions?|session notes?|training history|behavior history|behaviour history|owner feedback|owner updates?|owner instructions?|home practice|recommended routines?|training plan|progress tracking|session progress)\b/iu.test(value);
    const trainingFriction =
      /\b(?:scattered|notebook|notebooks|messages?|videos?|verbal|missing|forgotten|lost|repeated exercises?|repeat exercises?|inconsistent instructions?|conflicting instructions?|hard to compare|difficult to compare|slower progress|slow progress|not tracked|tracking gap|record keeping|record-keeping|history missing|follow[- ]up problem)\w*\b/iu.test(value);
    const unrelatedPetCollision =
      /\b(?:pet boarding|kennel|feeding medication|veterinary billing|pet store|browser extension|highlight pdf|searchable library)\b/iu.test(value) &&
      !/\b(?:trainer|training|behavior|behaviour)\b/iu.test(value);

    return trainerActor && trainingWorkflow && trainingFriction && !unrelatedPetCollision;
  }

  private static isHealthcareBillingFraudSecurityRequest(value: string): boolean {
    const actor =
      /\b(?:private healthcare providers?|healthcare providers?|healthcare organizations?|health care organizations?|health systems?|medical practices?|clinics?|hospitals?|patient billing systems?|medical billing systems?|health insurance systems?)\b/iu.test(value);
    const workflow =
      /\b(?:patient billing|medical billing|insurance records?|insurance claims?|patient invoices?|login history|login activity|payment transactions?|payment activity|security alerts?|patient accounts?|patient portals?)\b/iu.test(value);
    const risk =
      /\b(?:fraudulent claims?|claim fraud|billing fraud|payment fraud|suspicious payment activity|unauthorized account access|unauthorised account access|compromised patient accounts?|account takeover|coordinated abuse|false positives?|unnecessary restrictions?|fraud investigations?|security investigations?)\b/iu.test(value);
    return actor && workflow && risk;
  }

  /**
   * Supporting evidence for healthcare billing fraud must match the atomic
   * fraud/account-security workflow, not merely healthcare finances or delayed
   * reimbursements. This prevents staffing/cash-flow stories from becoming
   * evidence for coordinated billing abuse through outcome-word overlap.
   */
  private static isHealthcareBillingFraudSecuritySupportingEvidence(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const healthcareIdentity =
      /\b(?:healthcare|medical|hospital|clinic|patient|patients|provider|providers|insurer|insurance|medical practice|health system)\b/iu.test(value);
    const billingOrAccountWorkflow =
      /\b(?:billing|invoice|invoices|claim|claims|insurance claim|reimbursement|payment|payments|transaction|transactions|patient account|patient portal|login|authentication|account access|security alert|security event)\w*\b/iu.test(value);
    const fraudOrAccessRisk =
      /\b(?:fraud|fraudulent|abuse|suspicious|unauthorized|unauthorised|account takeover|compromised account|compromised patient|false positive|legitimate user|improper claim|false claim|duplicate claim|identity theft|credential misuse|payment anomaly|billing anomaly)\w*\b/iu.test(value);
    const investigationOrControl =
      /\b(?:detect|detection|identify|monitor|review|investigat|triage|alert|restriction|block|freeze|verification|correlat|cross[- ]system|silo|separate systems|fragmented)\w*\b/iu.test(value);

    const staffingOrCapacityOnly =
      /\b(?:staffing shortage|staff shortages|workforce shortage|nurse shortage|physician shortage|longer wait times|appointment backlog|clinical capacity|staffing continuity)\b/iu.test(value) &&
      !fraudOrAccessRisk;
    const reimbursementOnly =
      /\b(?:delayed reimbursement|reimbursement delay|insurance delay|claim reimbursement delay)\w*\b/iu.test(value) &&
      !fraudOrAccessRisk;

    return (
      healthcareIdentity &&
      billingOrAccountWorkflow &&
      fraudOrAccessRisk &&
      investigationOrControl &&
      !staffingOrCapacityOnly &&
      !reimbursementOnly
    );
  }

  private static isHealthcareBillingFraudSecurityEvidence(value: string): boolean {
    if (!this.isHealthcareBillingFraudSecuritySupportingEvidence(value)) {
      return false;
    }
    return /\b(?:incident|case|complaint|reported|reporting|loss|losses|blocked legitimate|compromised|unauthorized|unauthorised|fraudulent claim|billing fraud|payment fraud|account takeover|false positive|investigation delay|delayed investigation|failure|problem|issue)\w*\b/iu.test(value);
  }

  private static isEnterpriseEmployeeAccessSecurityRequest(value: string): boolean {
    const enterpriseActor =
      /\b(?:large companies?|enterprises?|organizations?|organisations?|corporations?|businesses?|employers?)\b/iu.test(value);
    const employeeIdentity =
      /\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|employee accounts?|user accounts?|employee access)\b/iu.test(value);
    const accessWorkflow =
      /\b(?:login activity|login records?|sign[- ]?in activity|sign[- ]?in records?|authentication logs?|system permissions?|account permissions?|access permissions?|permissions?|access rights?|entitlements?|employee access|employee role changes?|role changes?|role transitions?|department changes?|move between departments?|transfers?|offboarding|deprovision(?:ing|ed)?|account removal|access removal|temporary project access|project access|identity lifecycle|account lifecycle|joiner mover leaver|internal system usage|access logs?)\b/iu.test(value);
    const securityRisk =
      /\b(?:unusual account behavior|unusual behavior|suspicious account activity|suspicious activity|compromised account|account compromise|unauthorized access|unauthorised access|internal information|outside (?:their )?responsibilit(?:y|ies)|excessive privileges?|stale access|orphaned accounts?|access drift|delayed account removal|delayed deprovisioning|security alerts?|security investigations?|security incidents?|unnecessary security investigations?|unnecessary account restrictions?)\b/iu.test(value);
    return enterpriseActor && employeeIdentity && accessWorkflow && securityRisk;
  }

  private static isEnterpriseEmployeeAccessSecurityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const humanIdentity =
      /\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|new employees?|privileged accounts?|user accounts?|employee accounts?|identity lifecycle|account lifecycle)\b/iu.test(value);
    const accessControl =
      /\b(?:access permissions?|permissions?|access rights?|entitlements?|least privilege|privilege creep|privileged access|role[- ]based access|role changes?|employee changes? roles?|change roles?|department changes?|responsibilit(?:y|ies)|authentication|mfa|multi[- ]factor authentication|access logs?|login records?)\b/iu.test(value);
    const driftOrThreat =
      /\b(?:permissions? (?:may )?accumulate|retain(?:ed|s|ing)? (?:temporary )?(?:access|privileges?)|access drift|stale access|excessive privileges?|unauthorized access|unauthorised access|compromised account|account takeover|suspicious activity|security alerts?|security incidents?|control drift|former employees? (?:retain|still have) access|dormant accounts?)\b/iu.test(value);
    const monitoringOrInvestigation =
      /\b(?:continuous(?:ly)? (?:validate|validation|monitor|monitoring)|monitor(?:ing)? identity|identity monitoring|detect|detection|identify|review|security teams?|incident|investigat|audit|evidence|compare actual permissions|expected access polic(?:y|ies))\w*\b/iu.test(value);
    const aiToolOnly =
      /\b(?:model context protocol|\bmcp\b|prompt injection|tool manifests?|ai agents?|agentic ai|context sharing|external tools?|tool permissions?)\b/iu.test(value) &&
      !/\b(?:employees?|staff|workforce|contractors?|employee accounts?|employee role changes?|privilege creep|identity lifecycle)\b/iu.test(value);
    const educationOnly =
      /\b(?:students?|learners?|classroom|course content|hacking tutorials?|student exposure)\b/iu.test(value) &&
      !humanIdentity;

    return humanIdentity && accessControl && driftOrThreat && monitoringOrInvestigation && !aiToolOnly && !educationOnly;
  }

  private static isEnterpriseEmployeeAccessSupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const humanIdentity =
      /\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|privileged accounts?|employee accounts?|identity lifecycle|account lifecycle|employee lifecycle|hr records?|human resources?|department transfers?|role transitions?|offboarding|leavers?)\b/iu.test(value);
    const accessControl =
      /\b(?:system permissions?|account permissions?|permissions?|access rights?|entitlements?|least privilege|privilege creep|privileged access|role changes?|role transitions?|change roles?|department changes?|department transfers?|authentication|mfa|access logs?|account access|active accounts?|account remain(?:ed|s)? active|account still active|active directory|user directory|directory permissions?|internal systems? access|access to internal systems?|account lifecycle|identity lifecycle|offboarding|deprovision(?:ing|ed)?|account removal|access removal|joiner mover leaver)\b/iu.test(value);
    const relevantRisk =
      /\b(?:access drift|stale access|excessive privileges?|privilege creep|unauthorized access|unauthorised access|security risk|security risks|security alerts?|control drift|temporary privileges?|orphaned accounts?|dormant accounts?|former employees? still have access|retained access|access not removed|account not disabled|account remain(?:ed|s)? active|account still active|active account after (?:termination|departure|offboarding)|delayed account removal|delayed deprovisioning)\b/iu.test(value);
    const aiToolOnly =
      /\b(?:model context protocol|\bmcp\b|prompt injection|tool manifests?|ai agents?|context sharing|external tools?)\b/iu.test(value) &&
      !/\b(?:employees?|staff|workforce|contractors?|employee role changes?|privilege creep|identity lifecycle)\b/iu.test(value);
    return humanIdentity && accessControl && relevantRisk && !aiToolOnly;
  }

  private static isGovernmentPaymentFraudRequest(value: string): boolean {
    const governmentPaymentActor =
      /\b(?:government payment systems?|public[- ]service payments?|government payments?|public payments?|tax payments?|permit payments?|benefit payments?|public service fees?|government fees?)\b/iu.test(value);
    const fraudAxis =
      /\b(?:fraud|fraudulent transactions?|suspicious transactions?|unusual payment activity|unauthorized account access|account takeover|payment integrity|transaction monitoring)\b/iu.test(value);
    const signalAxis =
      /\b(?:identity checks?|identity verification|security alerts?|citizen reports?|access signals?|account access|transaction records?)\b/iu.test(value);
    return governmentPaymentActor && fraudAxis && signalAxis;
  }

  private static isGovernmentPaymentFraudEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const governmentPaymentActor =
      /\b(?:government|public sector|public[- ]service|government agenc(?:y|ies)|tax|taxes|permit|permits|benefit|benefits)\b/iu.test(value) &&
      /\b(?:payment|payments|transaction|transactions|fees?|financial)\b/iu.test(value);
    const fraudTransactionAxis =
      /\b(?:fraud|fraudulent|suspicious transactions?|unusual transactions?|unusual payment activity|payment fraud|transaction fraud|coordinated fraud|fraud pattern|fraud patterns|transaction monitoring)\b/iu.test(value);
    const identityOrSecuritySignalAxis =
      /\b(?:identity checks?|identity verification|security alerts?|citizen fraud reports?|citizen reports?|unauthorized account access|unauthori[sz]ed access|account takeover|access signals?|identity signals?)\b/iu.test(value);
    const investigationOrOutcomeAxis =
      /\b(?:investigat|delayed investigation|fraud detection|detect fraud|early detection|false positive|blocked legitimate payments?|financial loss|financial losses|public trust|trust in digital government|separate systems?|siloed data|cross[- ]department|cross[- ]service|correlat)\w*\b/iu.test(value);
    const genericCyberOnly =
      /\b(?:ransomware|phishing|malware|endpoint security|backup strategy|patch management|zero trust)\b/iu.test(value) &&
      !fraudTransactionAxis;

    return governmentPaymentActor &&
      fraudTransactionAxis &&
      identityOrSecuritySignalAxis &&
      investigationOrOutcomeAxis &&
      !genericCyberOnly;
  }

  private static isGovernmentRecordAccessIntegrityRequest(value: string): boolean {
    const actor =
      /\b(?:government agencies?|government departments?|public sector agencies?|public authorities?|regulatory agencies?|licensing authorities?)\b/iu.test(value);
    const records =
      /\b(?:legal records?|licensing documents?|citizen applications?|regulatory files?|official records?|public records?|permit records?|case files?)\b/iu.test(value);
    const security =
      /\b(?:unauthorized access|unauthorised access|manipulation|tamper(?:ing|ed)?|access logs?|document histor(?:y|ies)|employee activity|security alerts?|suspicious changes?|who accessed|incident investigation|audit trail)\b/iu.test(value);
    return actor && records && security;
  }

  private static isGovernmentRecordAccessIntegrityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const publicSector =
      /\b(?:government agency|government agencies|government department|public agency|public agencies|public sector agency|public sector agencies|public sector|public authority|regulatory agency|licensing authority|public records office|government records?)\b/iu.test(value);
    const record =
      /\b(?:legal record|licensing document|citizen application|regulatory file|official record|public record|permit record|case file|document version|document history)\w*\b/iu.test(value);
    const accessOrIntegrity =
      /\b(?:unauthorized access|unauthorised access|access log|permission change|suspicious edit|suspicious change|tamper|manipulat|altered record|record integrity|document integrity|who accessed|employee activity|security alert|compromised credential|audit trail|incident investigation)\w*\b/iu.test(value);
    const incidentImpact =
      /\b(?:investigat|compliance|violation|compromised|breach|incident|forensic|audit|integrity|unauthorized|suspicious|manipulat|tamper)\w*\b/iu.test(value);
    const unrelatedPublicWorks =
      /\b(?:road repair|streetlight|public works maintenance|pothole|citizen complaint repair|infrastructure maintenance)\b/iu.test(value) &&
      !record;

    return publicSector && record && accessOrIntegrity && incidentImpact && !unrelatedPublicWorks;
  }

  private static isHomeRemoteMedicalDeviceTrustRequest(value: string): boolean {
    return /\b(?:home healthcare|home health care|remote patient monitoring|patients? outside hospitals?|home patient monitoring|patient monitoring at home|home monitoring)\b/iu.test(value) &&
      /\b(?:connected medical devices?|medical devices?|wearable devices?|patient readings?|device status|telemetry|access logs?|security alerts?|unauthorized access|device malfunction|sensor malfunction)\b/iu.test(value);
  }

  private static isHomeRemoteMedicalDeviceTrustEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const remoteCareAnchor = /\b(?:home health(?:care)?|home care|remote patient monitoring|remote monitoring|patient monitoring|patients? at home|outside hospital|telemonitoring|telehealth monitoring)\b/iu.test(value);
    const deviceAnchor = /\b(?:connected medical device|medical device|wearable device|sensor|patient monitor|device telemetry|telemetry|device status|device health|remote monitor)\w*\b/iu.test(value);
    const readingOrClinicalAnchor = /\b(?:patient readings?|vital signs?|vital readings?|physiological readings?|heart rate|blood pressure|oxygen saturation|glucose|abnormal readings?|unusual readings?|clinical deterioration|patient condition|false alarm|alarm)\w*\b/iu.test(value);
    const faultOrSecurityAnchor = /(?:\b(?:device malfunction|device fault|sensor error|sensor fault|connectivity failure|device failure|security alert|access log|cybersecurity|security incident|compromised device|tamper|data exposure|data breach|spoof|attack)\w*\b|\bunauthori[sz]ed\b[^.!?]{0,40}\baccess\b)/iu.test(value);
    const trustOrDecisionImpact = /\b(?:distinguish|differentiate|root cause|correlat|false positive|unnecessary intervention|delayed response|delayed care|trust|reliable|reliability|uncertain|ambigu|investigat|triage|alert fatigue|patient safety)\w*\b/iu.test(value);
    return remoteCareAnchor && deviceAnchor && readingOrClinicalAnchor && faultOrSecurityAnchor && trustOrDecisionImpact;
  }

  private static isBuildingEnvironmentalMonitoringRequest(value: string): boolean {
    return /\b(?:property managers?|property management(?: teams?)?|building managers?|facility managers?|maintenance teams?|residential complexes?|apartment complexes?|housing complexes?|multi[- ]family buildings?|residential buildings?|apartment buildings?)\b/iu.test(value) &&
      /\b(?:temperature|humidity|water usage|water consumption|air quality|indoor air quality|equipment readings?|sensor readings?|environmental performance|environmental monitoring|building conditions?|abnormal conditions?|water waste|iot|internet of things|telemetry|sensors?)\b/iu.test(value);
  }

  private static isBuildingEnvironmentalMonitoringEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const propertyActor = /\b(?:property managers?|property management(?: teams?)?|building managers?|facility managers?|maintenance teams?|residential complexes?|apartment complexes?|housing complexes?|multi[- ]family|residential buildings?|apartment buildings?|property operations?|building operations?)\b/iu.test(value);
    const measurementAxis = /\b(?:temperature|humidity|water usage|water consumption|air quality|indoor air quality|iaq|equipment readings?|sensor readings?|environmental monitoring|environmental performance|building conditions?|iot|internet of things|telemetry|sensors?)\b/iu.test(value);
    const anomalyOrMaintenanceAxis = /\b(?:abnormal conditions?|anomal|leak|water waste|poor air quality|uncomfortable|comfort issue|maintenance delay|delayed maintenance|equipment fault|equipment failure|late detection|higher operating costs?|environmental problem|not detected|missed condition|fragmented data|separate systems?)\w*\b/iu.test(value);
    const financeCollision = /\b(?:rental income|cash flow|mortgage interest|payment reconciliation|duplicate charges?|bank statements?|net operating income|\bnoi\b|rent payment|billing failure)\b/iu.test(value) && !measurementAxis;
    return propertyActor && measurementAxis && anomalyOrMaintenanceAxis && !financeCollision;
  }

  private static isDeliveryFuelEmissionsRequest(value: string): boolean {
    return (
      /\b(?:delivery companies?|delivery fleets?|delivery operators?|courier companies?|couriers?|last[- ]mile delivery|parcel delivery|shipping companies?|logistics fleets?)\b/iu.test(value) &&
      /\b(?:fuel consumption|fuel usage|fuel costs?|emissions?|carbon emissions?|environmental impact|pollution|unnecessary mileage|mileage|route efficiency|route inefficien|vehicle routes?|traffic conditions?|failed delivery attempts?)\w*\b/iu.test(value)
    );
  }

  private static isDeliveryFuelEmissionsEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const deliveryActor =
      /\b(?:delivery compan(?:y|ies)|delivery fleet|delivery operator|courier|courier compan(?:y|ies)|parcel delivery|last[- ]mile delivery|last mile|shipping|delivery service|delivery services|fleet operator|logistics fleet)\b/iu.test(value);
    const routeOrServiceWorkflow =
      /\b(?:route|routes|routing|route planning|route optimization|delivery trip|delivery trips|delivery volume|delivery volumes|traffic|traffic congestion|failed delivery|failed deliveries|delivery attempt|delivery attempts|last[- ]mile|last mile|vehicle miles?|mileage|fleet|dispatch|shipping speed|fast shipping)\w*\b/iu.test(value);
    const environmentalAxis =
      /\b(?:fuel|fuel consumption|fuel usage|diesel|gasoline|petrol|fuel efficiency|emission|emissions|carbon|co2|greenhouse gas|greenhouse gases|pollution|polluting|environmental impact|environmental footprint|carbon footprint)\w*\b/iu.test(value);
    const frictionOrOutcome =
      /\b(?:unnecessary mileage|extra miles?|higher fuel|high fuel|fuel cost|fuel costs|fuel waste|wasted fuel|inefficient route|inefficient routes|route inefficien|avoidable emissions?|higher emissions?|increased emissions?|polluting|pollution|environmental impact|delayed delivery|delayed deliveries|delay|failed delivery attempts?|congestion|excess mileage|greater mileage|service reliability|late delivery|late deliveries)\w*\b/iu.test(value);

    return deliveryActor && routeOrServiceWorkflow && environmentalAxis && frictionOrOutcome;
  }

  private static isCustomFootwearSpecificationRequest(value: string): boolean {
    const actor =
      /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/iu.test(
        value,
      );
    const workflow =
      /\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|approved specifications?|latest approved specifications?|completion deadlines?|sizing errors?|repeated fittings?|wasted materials?)\b/iu.test(
        value,
      );
    return actor && workflow;
  }

  private static isCustomFootwearSpecificationEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const actor =
      /\b(?:shoemaker|shoemakers|shoe maker|shoe makers|shoemaking|shoe making|bespoke shoemaker|bespoke footwear|custom footwear|custom shoe maker|custom shoe makers|made[- ]to[- ]measure shoes?|handmade shoes?|cordwainer|cordwainers|bootmaker|bootmakers)\b/iu.test(
        value,
      );
    const specificationWorkflow =
      /\b(?:foot measurements?|last measurements?|shoe last|leather selection|leather choice|sole type|sole specification|stitching preference|stitching specification|fitting notes?|fitting history|design revisions?|revision history|approved specifications?|approved version|custom shoe order|bespoke shoe order)\b/iu.test(
        value,
      );
    const versionOrRecordAxis =
      /\b(?:measurement|fitting|revision|approved version|specification|sketch|sketches|photos?|messages?|handwritten notes?|physical samples?|leather samples?|order notes?)\b/iu.test(
        value,
      );
    const frictionOrOutcome =
      /\b(?:sizing error|wrong size|size mismatch|incorrect material|wrong material|leather mismatch|wrong sole|wrong stitching|repeated fittings?|rework|wasted materials?|wasted leather|delayed order|delay|scattered|lost|missing|outdated|old version|wrong specification|hard to confirm|difficult to confirm)\b/iu.test(
        value,
      );
    const repairOnlyCollision =
      /\b(?:shoe repair|repair ticket|cobbler repair|heel repair|sole replacement repair|resole ticket)\b/iu.test(
        value,
      ) &&
      !/\b(?:custom shoe|bespoke shoe|shoemaking|made to measure|handmade shoe|cordwainer)\b/iu.test(
        value,
      );
    const wardrobeCollision =
      /\b(?:wardrobe|closet|outfit planner|shopping|sneaker release|shoe store|fashion app)\b/iu.test(
        value,
      ) &&
      !actor;

    return (
      actor &&
      specificationWorkflow &&
      versionOrRecordAxis &&
      frictionOrOutcome &&
      !repairOnlyCollision &&
      !wardrobeCollision
    );
  }

  private static isHeadwearSpecificationRequest(value: string): boolean {
    const actor =
      /\b(?:independent hat makers?|hat makers?|custom hat makers?|bespoke hat makers?|milliners?|millinery studios?|millinery workshops?|hat studios?|hat workshops?|custom headwear makers?)\b/iu.test(value);
    const workflow =
      /\b(?:head measurements?|head circumference|brim dimensions?|brim width|material choices?|felt|straw|fabric|color preferences?|colour preferences?|decorative details?|trim|ribbon|feather|fitting notes?|revision requests?|approved specifications?|approved version|final approved specifications?)\b/iu.test(value);
    return actor && workflow;
  }

  private static isHeadwearSpecificationEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const actor =
      /\b(?:hat maker|hat makers|custom hat maker|custom hat makers|bespoke hat maker|bespoke hat makers|milliner|milliners|millinery|hat studio|hat workshop|custom headwear maker|custom headwear makers)\b/iu.test(value);
    const specificationWorkflow =
      /\b(?:head measurements?|head circumference|hat size|sizing|brim dimensions?|brim width|material selection|material choices?|felt|straw|fabric|color preference|colour preference|color match|colour match|decorative details?|trim|ribbon|feather|fitting notes?|fitting history|revision requests?|revision history|approved specifications?|approved version|final specification|custom hat order)\w*\b/iu.test(value);
    const versionOrRecordAxis =
      /\b(?:approved version|revision|revision history|fitting|measurement|specification|sketches?|photos?|messages?|handwritten notes?|physical samples?|material samples?|order notes?)\w*\b/iu.test(value);
    const frictionOrOutcome =
      /\b(?:incorrect sizing|wrong size|size mismatch|mismatched materials?|wrong material|wrong color|wrong colour|repeated adjustments?|repeat adjustment|rework|wasted supplies?|wasted materials?|material waste|delayed delivery|delayed order|delay|scattered|lost|missing|missed|outdated|old version|wrong specification|conflicting specification|hard to confirm|difficult to confirm)\w*\b/iu.test(value);
    const wigCollision =
      /\b(?:wig|hairpiece|lace front|hair texture|cap construction)\b/iu.test(value) && !actor;

    return actor && specificationWorkflow && versionOrRecordAxis && frictionOrOutcome && !wigCollision;
  }

  private static isWigMakerSpecificationRequest(value: string): boolean {
    return (
      /\b(?:independent wig makers?|wig makers?|custom wig makers?|wig artisans?|wig studios?|hairpiece makers?)\b/iu.test(value) &&
      /\b(?:customer measurements?|hair texture preferences?|color choices?|colour choices?|cap specifications?|cap size|styling requests?|fitting notes?|revision history|approved specifications?|approved version)\b/iu.test(value)
    );
  }

  private static isWigMakerSpecificationEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const wigActor =
      /\b(?:wig maker|wig makers|wigmaking|wig making|custom wig|custom wigs|wig artisan|wig artisans|wig studio|wig studios|hairpiece maker|hairpiece makers)\b/iu.test(value);
    const specificationWorkflow =
      /\b(?:customer measurements?|head measurements?|measurement record|hair texture|texture preference|color choice|colour choice|color match|colour match|cap specification|cap size|cap construction|styling request|fitting note|fitting notes|fitting history|revision history|design revision|approved specification|approved version|client specification|client measurements?|custom order specifications?)\w*\b/iu.test(value);
    const versionOrRecordAxis =
      /\b(?:latest approved|approved version|revision|revision history|fitting|measurement|specification|photos?|chat messages?|messages?|handwritten|physical samples?|sample|client notes?|order notes?)\w*\b/iu.test(value);
    const frictionOrOutcome =
      /\b(?:incorrect sizing|wrong size|size mismatch|mismatched colors?|mismatched colours?|wrong color|wrong colour|repeated adjustments?|repeat adjustment|rework|wasted materials?|material waste|delayed orders?|delay|scattered|lost|missing|outdated|old version|wrong specification|conflicting specification|hard to confirm|difficult to confirm)\w*\b/iu.test(value);

    return wigActor && specificationWorkflow && versionOrRecordAxis && frictionOrOutcome;
  }

  private static isFoodStorageConditionTriageCandidate(
    request: string,
    evidence: string,
  ): boolean {
    if (!RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(request, evidence)) {
      return false;
    }
    const commercialActor = /\b(?:restaurant|restaurants|restaurant kitchen|restaurant kitchens|commercial kitchen|commercial kitchens|foodservice|food service|catering kitchen|commissary kitchen|walk[- ]?in cooler|walk[- ]?in freezer)\b/iu.test(evidence);
    const storageObject = /\b(?:refrigerat\w*|freezer\w*|cold storage|cold room|food storage|storage temperature|temperature excursion|ingredient expiration|expiry|expired ingredient|perishable inventory|food inventory|refrigeration equipment)\b/iu.test(evidence);
    const storageProblem = /\b(?:spoil\w*|food waste|wasted food|ingredient waste|inventory loss|temperature excursion|temperature breach|too warm|equipment failure|equipment breakdown|freezer failure|refrigeration failure|expired ingredients?|expiration tracking|maintenance backlog|poor storage condition|unsafe temperature|quality loss)\b/iu.test(evidence);
    const householdOnly = /\b(?:young adults?|household|home fridge|home refrigerator|consumer fridge|domestic refrigerator)\b/iu.test(evidence) && !commercialActor;
    const unrelatedEvent = /\b(?:warehouse fire|landfill|wildfire|stock market|energy stocks?)\b/iu.test(evidence) && !commercialActor;
    return !householdOnly && !unrelatedEvent && storageObject && storageProblem && commercialActor;
  }

  private static isFoodStorageConditionSupportingEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (!this.isFoodStorageConditionTriageCandidate(request, evidence)) return false;
    const workflow = /\b(?:monitor\w*|track\w*|record\w*|temperature|condition|expiration|expiry|maintenance|inspection|alert\w*|sensor\w*|inventory|storage)\b/iu.test(evidence);
    const failure = /\b(?:spoil\w*|food waste|ingredient waste|inventory loss|expired ingredients?|temperature excursion|equipment failure|freezer failure|refrigeration failure|unnecessary disposal|quality loss|delayed detection|missed alert)\b/iu.test(evidence);
    return workflow && failure;
  }

  private static isFoodStorageConditionEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (!this.isFoodStorageConditionSupportingEvidence(request, evidence)) return false;
    const causalMechanism = /\b(?:separate systems?|separately monitored|fragmented|siloed|manual logs?|missed alerts?|undetected|not detected|failed to detect|temperature monitoring|expiration tracking|maintenance records?|storage condition monitoring)\b/iu.test(evidence);
    const concreteImpact = /\b(?:spoiled food|food spoilage|ingredient spoilage|food waste|ingredient waste|inventory loss|equipment failure|unnecessary disposal|quality loss|unsafe food)\b/iu.test(evidence);
    return causalMechanism && concreteImpact;
  }

  private static isRestorationConservationRequest(
    request: string,
    plannedQueries: readonly string[] = [],
  ): boolean {
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    if (profile.restorationIntent) return true;
    return RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries,
    }).archetype === 'RESTORATION_CONSERVATION_OPERATIONS';
  }

  private static isRestorationConservationTriageCandidate(
    request: string,
    evidence: string,
  ): boolean {
    if (this.isFrameRestorationWorkflowRequest(request)) {
      if (!this.isExactPictureFrameRestorationEvidenceIdentity(evidence)) return false;
    }
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    const subject = this.normalize(profile.restorationSubject ?? '');
    const subjectTokens = subject ? [...this.extractTokens(subject)] : [];
    const evidenceTokens = this.extractTokens(evidence);
    const dynamicSubjectOverlap = subjectTokens.filter((token) =>
      this.semanticTokenAligned(token, evidenceTokens),
    ).length;
    const distinctiveSubjectTokens = this.normalize(subject)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => token.length >= 3)
      .filter(
        (token) =>
          !/^(?:antique|vintage|old|historic|historical|restoration|restore|repair|conservation|specialist|specialists)$/u.test(token),
      );
    const evidenceIdentityTokens = new Set(
      this.normalize(evidence)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .filter(Boolean),
    );
    const distinctiveSubjectOverlap = distinctiveSubjectTokens.filter((token) =>
      evidenceIdentityTokens.has(token) ||
      evidenceIdentityTokens.has(`${token}s`) ||
      (token.endsWith('s') && evidenceIdentityTokens.has(token.slice(0, -1))),
    ).length;
    const subjectFamilyAligned = this.isRestorationSubjectFamilyAligned(subject, evidence);
    const explicitObjectIdentity =
      subjectFamilyAligned || distinctiveSubjectOverlap >= 1;
    const requestCompatible =
      distinctiveSubjectTokens.length > 0
        ? explicitObjectIdentity
        : RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(request, evidence) ||
          subjectFamilyAligned ||
          dynamicSubjectOverlap >= 1;
    if (!requestCompatible) return false;
    const subjectOverlap = distinctiveSubjectTokens.length > 0
      ? distinctiveSubjectOverlap
      : dynamicSubjectOverlap;
    const restorationActor = /\b(?:restoration|restorer|restorers|conservation|conservator|conservators|repair specialist|repair specialists|restoration workshop|conservation workshop|repair shop|repair technician|jeweler|jeweller|goldsmith|bench jeweler|bench jeweller)\b/iu.test(evidence);
    const conditionObject = /\b(?:cracked|damaged|damage|broken|missing|condition|dented|chipped|ruined|stone|gemstone|diamond|emerald|clasp|shank|enamel|nib|filling mechanism|original design|original detail|historical detail|period[- ]correct|previous repair|prior repair|repair history|restoration history|treatment history|replacement material|replacement part|replacement stone|material match|color match|colour match|finish match|physical sample|condition report|condition record|customer preference|client preference|customer instruction|client instruction|writing preference|tuning preference|approved treatment|approved work|workshop note|repair note)\w*\b/iu.test(evidence);
    const pain = /\b(?:wrong|incorrect|mismatch\w*|lost|missing|overlook\w*|rework|repeated work|waste\w*|delay\w*|scattered|fragmented|poor documentation|incomplete record|no details?|unknown history|history unknown|uncertain history|repair history unknown|previous repair unknown|might have been repaired|looks like a repair|lost detail|material mismatch|ruined|chipped|dented|damaged|damage|broke|broken|failed|failure)\b/iu.test(evidence);
    const commissionOnly = /\b(?:new custom commission|custom order|made[- ]to[- ]order|wrong dimensions?|approved design revision|personalization)\b/iu.test(evidence) && !/\b(?:restoration|conservation|repair history|previous repair|condition|antique|vintage|repair)\b/iu.test(evidence);
    const identityAligned =
      subjectFamilyAligned ||
      subjectOverlap >= 1 ||
      (distinctiveSubjectTokens.length === 0 && restorationActor);
    return !commissionOnly && identityAligned && conditionObject && pain;
  }

  /**
   * Pre-AI only recall lane for exact-object restoration material that proves a
   * concrete condition/treatment/documentation facet but does not itself state a
   * business pain. It may reach Community AI and participate in a multi-source
   * composite, but it is never promoted to SUPPORTING by this helper alone.
   * Generic furniture/sculpture/piano restoration remains excluded when the
   * requester object is porcelain, ceramic, jewelry, camera, etc.
   */
  private static isExactObjectRestorationPartialTriageCandidate(
    request: string,
    evidence: string,
  ): boolean {
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    if (!profile.restorationIntent) return false;

    const subject = this.normalize(profile.restorationSubject ?? '');
    if (this.isFrameRestorationWorkflowRequest(request) &&
      !this.isExactPictureFrameRestorationEvidenceIdentity(evidence)) {
      return false;
    }
    if (!subject || !this.isRestorationSubjectFamilyAligned(subject, evidence)) {
      return false;
    }

    const restorationWorkflow =
      /\b(?:restor\w*|conserv\w*|repair\w*|treat\w*|condition report|condition record|condition documentation|treatment documentation|treatment record|repair history|restoration history|previous repairs?|prior repairs?|photograph\w*|document\w*|record\w*|glaze|crack\w*|chip\w*|missing fragments?|replacement material\w*|material match\w*|decorative detail\w*|original detail\w*)\b/iu.test(
        evidence,
      );
    const unrelatedObjectOnly =
      /\b(?:furniture|wood chairs?|rocking chairs?|piano|top hats?|binoculars?|ship models?|chronometers?|sculptures?)\b/iu.test(
        evidence,
      ) &&
      !this.isRestorationSubjectFamilyAligned(subject, evidence);

    return restorationWorkflow && !unrelatedObjectOnly;
  }

  private static isBookRestorationRequest(value: string): boolean {
    const normalized = this.normalize(value);
    return (
      /\b(?:book restoration specialists?|book restorers?|book conservators?|book conservation|book repair specialists?|bookbinders?|rare book restoration|manuscript conservation)\b/iu.test(normalized) &&
      /\b(?:bindings?|pages?|missing sections?|paper condition|previous repairs?|repair history|restoration history|treatment history|material choices?|preservation preferences?|condition records?|photographs?|handwritten notes?|physical samples?|customer messages?)\b/iu.test(normalized)
    );
  }

  private static isBookRestorationEvidenceIdentity(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const explicitBookRestorationIdentity =
      /\b(?:book conservation|book restoration|book repair|bookbinding restoration|rare book conservation|rare book restoration|manuscript conservation|manuscript restoration)\b/iu.test(evidence);
    const concreteBookObject =
      /\b(?:rare books?|old books?|antique books?|historic books?|manuscripts?|codices?|volumes?|bookbindings?|bindings?|book blocks?|text blocks?|pages?|leaves|folios?|paper)\b/iu.test(evidence);
    const conservationWorkflow =
      /\b(?:book conservation|book restoration|book repair|bookbinding|rebinding|conservator|conservation treatment|restoration treatment|binding repair|page repair|paper repair|paper conservation|manuscript conservation|condition assessment|condition report|treatment record|previous treatment|previous repair|repair history|restoration history)\b/iu.test(evidence);
    const physicalTreatmentFacet =
      /\b(?:torn pages?|missing pages?|missing leaves|missing sections?|damaged bindings?|broken sewing|loose signatures?|detached boards?|spine damage|paper tears?|paper loss|foxing|acidification|deacidification|hinge repair|mending tissue|japanese tissue|wheat starch paste|leather binding|cloth binding|binding material|paper condition)\b/iu.test(evidence);

    const fictionOrEditorialCollision =
      /\b(?:novel|story|chapter|spoilers?|fiction|movie|television|podcast|disclosure day|magic school|character|plot|review thread|book review|author interview)\b/iu.test(evidence) &&
      !conservationWorkflow &&
      !physicalTreatmentFacet;
    if (fictionOrEditorialCollision) return false;

    const unrelatedRepairCollision =
      /\b(?:hernia repair|pavement repair|road repair|building restoration|city restoration|software repair|vehicle repair)\b/iu.test(evidence) &&
      !conservationWorkflow;
    if (unrelatedRepairCollision) return false;

    return (
      (explicitBookRestorationIdentity || concreteBookObject) &&
      (conservationWorkflow || physicalTreatmentFacet)
    );
  }

  private static isBookRestorationSupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!this.isBookRestorationEvidenceIdentity(evidence)) return false;

    const documentationOrHistory =
      /\b(?:condition report|condition assessment|condition record|documentation|documented|record|records|treatment record|repair history|restoration history|previous repairs?|previous treatment|prior treatment|photographs?|photos?|notes?|material choices?|material selection|preservation preference|client preference|customer preference)\b/iu.test(evidence);
    const physicalProblem =
      /\b(?:damaged|damage|torn|tear|missing|loss|detached|broken|loose|deteriorat\w*|acidif\w*|foxing|stain\w*|insect damage|water damage|spine damage|binding damage|paper loss)\b/iu.test(evidence);
    const treatmentRisk =
      /\b(?:wrong|incorrect|unsuitable|incompatible|rework|repeat\w*|inconsistent|delay\w*|uncertain|unknown|previous repair|prior repair|material match|preserv\w* original)\b/iu.test(evidence);

    return documentationOrHistory || physicalProblem || treatmentRisk;
  }

  private static isLogisticsShipmentIntegrityRequest(value: string): boolean {
    const normalized = this.normalize(value);
    const logisticsActor =
      /\b(?:logistics companies?|logistics providers?|3pl|third[- ]party logistics|parcel carriers?|freight companies?|delivery operators?|warehouse operators?|supply chain operators?)\b/iu.test(normalized);
    const integrityWorkflow =
      /\b(?:suspicious shipment|shipment changes?|unauthorized access|delivery accounts?|unusual routing|redirected|rerout\w*|tracking records?|warehouse scans?|driver updates?|security alerts?|coordinated fraud|shipment compromised|packages? (?:lost|redirected)|stolen goods?|false claims?)\b/iu.test(normalized);
    return logisticsActor && integrityWorkflow;
  }

  private static isLogisticsShipmentIntegrityEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const shipmentIdentity =
      /\b(?:shipment|shipments|package|packages|parcel|parcels|cargo|freight|3pl|carrier|carriers|warehouse|warehouses|fulfillment|fulfilment|proof of delivery|proof of receipt|handoff|hand[- ]off)\b/iu.test(evidence);
    if (!shipmentIdentity) return false;

    const integrityOrIncident =
      /\b(?:missing|lost|stolen|theft|cargo fraud|shipment fraud|delivery fraud|diversion|diverted|redirected|rerouted|rerouting|unauthorized|account takeover|compromised account|destination change|address change|tracking discrepancy|tracking mismatch|scan discrepancy|missing scan|awaiting receipt|cannot locate|can't locate|couldn['’]?t locate|not delivered|handoff|proof of handoff|proof of receipt|signature mismatch|chain of custody|custody gap|liability gap|false claim|fraudulent claim|suspicious routing|route deviation|tampered tracking|altered tracking)\b/iu.test(evidence);
    const fragmentedInformation =
      /\b(?:conflicting records?|inconsistent records?|tracking records?|warehouse scans?|receiving report|carrier scans?|delivery confirmations?|driver updates?|security alerts?|information gathering|information processing|shipment information centre|shipment information center|audit trail)\b/iu.test(evidence);

    const genericOptimizationOnly =
      /\b(?:route optimization|routing optimization|shipment consolidation|capacity expansion|linear costs?|empty miles?|packaging|kidney shipment|train departure|mathematical programming)\b/iu.test(evidence) &&
      !integrityOrIncident;
    if (genericOptimizationOnly) return false;

    const unrelatedFraudOnly =
      /\b(?:public benefits fraud|credit card fraud|digital payment fraud|tax fraud|gst fraud|email scam)\b/iu.test(evidence) &&
      !/\b(?:shipment|package|parcel|cargo|freight|carrier|warehouse|delivery)\b/iu.test(evidence);
    if (unrelatedFraudOnly) return false;

    return integrityOrIncident || fragmentedInformation;
  }

  private static isRestorationSubjectFamilyAligned(
    subject: string,
    evidence: string,
  ): boolean {
    const normalizedSubject = this.normalize(subject);
    if (!normalizedSubject) return false;

    const families: ReadonlyArray<readonly [RegExp, RegExp]> = [
      [/\b(?:jewelry|jewellery)\b/iu, /\b(?:jewelry|jewellery|jeweler|jeweller|goldsmith|bench jeweler|bench jeweller|ring|pendant|bracelet|necklace|earring|brooch|gemstone|stone|diamond|emerald|sapphire|ruby|platinum|gold|silver)\b/iu],
      [/\b(?:fountain pen|pen)\b/iu, /\b(?:fountain pen|pen restorer|pen repair|nib|filling mechanism|ink[- ]flow|piston filler|lever filler)\b/iu],
      [/\b(?:camera|film camera|vintage camera)\b/iu, /\b(?:camera|film camera|lens|shutter|aperture|viewfinder|camera repair)\b/iu],
      [/\b(?:textile|fabric|garment)\b/iu, /\b(?:textile|fabric|garment|embroidery|dye|weave|fiber|fibre|stitching)\b/iu],
      [/\b(?:clock|watch)\b/iu, /\b(?:clock|watch|movement|escapement|mainspring|dial|horology|horological)\b/iu],
      [/\b(?:typewriter)\b/iu, /\b(?:typewriter|key lever|typebar|ribbon mechanism|platen)\b/iu],
      [/\b(?:frame|picture frame)\b/iu, /\b(?:picture frame|antique picture frame|antique frame|gilded frame|picture-frame restoration|picture frame restoration|frame conservator|frame conservation|gilding|gold leaf|gesso|molding|moulding)\b/iu],
      [/\b(?:doll)\b/iu, /\b(?:doll|porcelain doll|composition doll|doll repair|doll restoration)\b/iu],
      [/\b(?:porcelain|ceramic|china)\b/iu, /\b(?:porcelain|ceramic|ceramics|china repair|china restoration|earthenware|stoneware|glaze|ceramic conservation)\b/iu],
    ];

    if (families.some(
      ([subjectPattern, evidencePattern]) =>
        subjectPattern.test(normalizedSubject) && evidencePattern.test(evidence),
    )) {
      return true;
    }

    /* Generic future-proof fallback: the concrete restored object itself is
     * the identity boundary. This supports lamp, book, fountain, ceramic,
     * instrument, textile, furniture, or future niches without adding another
     * hard-coded branch, while still rejecting a different restored object. */
    const genericSubjectTokens = [...this.extractTokens(normalizedSubject)]
      .filter((token) => !/^(?:antique|vintage|old|historic|historical|restoration|restore|repair|conservation|specialist|specialists|piece|pieces|component|components|mechanism|mechanisms)$/u.test(token));
    const evidenceTokens = this.extractTokens(evidence);
    const alignedTokenCount = genericSubjectTokens.filter((token) =>
      this.semanticTokenAligned(token, evidenceTokens),
    ).length;

    /*
     * Multi-token restored objects are an identity phrase, not an OR-list.
     * Requiring two aligned distinctive tokens prevents a broad modifier such
     * as "musical" from turning a flute into a music-box signal, while
     * one-token objects such as mirror/toy/lamp still work normally.
     */
    const requiredObjectTokenCount = genericSubjectTokens.length >= 2 ? 2 : 1;
    return alignedTokenCount >= requiredObjectTokenCount;
  }

  private static isRestorationConservationSupportingEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (!this.isRestorationConservationTriageCandidate(request, evidence)) return false;
    const workflow = /\b(?:restor\w*|repair\w*|document\w*|record\w*|track\w*|condition|frame|glass|silvering|gilding|previous repairs?|prior repairs?|repair history|restoration history|treatment history|diagnos\w*|reshank\w*|reset\w*|filling mechanisms?|nib condition|ink[- ]flow|stone|gemstone|clasp|shank|enamel|engraving|period[- ]correct|period appropriate|material match|color match|colour match|finish match|replac\w*|original piece|vintage piece|original design|original detail|historical detail|physical samples?|photograph\w*|workshop notes?|repair notes?|service notes?|customer preferences?|client preferences?|customer instructions?|client instructions?|approved instructions?|confirmed instructions?|writing preferences?|tuning preferences?|approved treatments?|approved work|message\w*)\b/iu.test(evidence);
    const partialHistoryProblem = /\b(?:no details?|no info(?:rmation)?|unknown history|history unknown|uncertain history|repair history unknown|previous repair unknown|might have been repaired|looks like a repair|unclear previous repair|undocumented repair|not sure|unsure|don['’]t know|do not know|without ruining|avoid ruining|preserv\w* original|period appropriate)\b/iu.test(evidence);
    return workflow && (this.hasDeterministicProblemExpression(evidence) || partialHistoryProblem);
  }

  /**
   * Professional secondary evidence for the exact restored object.
   *
   * Conservation papers, condition reports, and restoration specifications are
   * often written as procedures rather than complaints. Requiring words such as
   * "wrong", "delay", or "problem" therefore created false negatives even
   * when the source directly established the requester's condition-assessment,
   * treatment-specification, previous-repair, or material-matching workflow.
   *
   * This helper is deliberately SUPPORTING-only. The caller still applies
   * source-provenance caps, canonical-family normalization, and Community-AI
   * classification before the item can enter the trusted ledger.
   */
  private static isProfessionalRestorationWorkflowSupportingEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(evidence)) return false;

    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    if (!profile.restorationIntent) return false;
    const subject = this.normalize(profile.restorationSubject ?? '');
    if (!subject || !this.isRestorationSubjectFamilyAligned(subject, evidence)) {
      return false;
    }

    const normalized = this.normalize(evidence);
    const meaningfulWordCount = normalized.split(/\s+/u).filter(Boolean).length;
    if (meaningfulWordCount < 18) return false;

    const restorationWorkflow =
      /\b(?:restor\w*|conserv\w*|repair\w*|treat\w*|reinstall\w*|remove\w*|rejoin\w*|stabiliz\w*|preserv\w*)\b/iu.test(normalized);
    const conditionAxis =
      /\b(?:condition (?:analysis|assessment|report|record)|deteriorat\w*|damage\w*|crack\w*|broken|missing|structural integrity|support\w*|frame\w*|came|lead deterioration|material condition)\b/iu.test(normalized);
    const documentationAxis =
      /\b(?:specification\w*|document\w*|record\w*|treatment histor\w*|repair histor\w*|restoration histor\w*|previous repairs?|prior repairs?|workshop notes?|photograph\w*|pattern\w*|approved treatment|approved restoration)\b/iu.test(normalized);
    const treatmentOrMaterialAxis =
      /\b(?:material\w*|procedure\w*|replacement\w*|matching|color match\w*|colour match\w*|paint consolidation|rejoining broken|removal|reinstallation|craftsmanship|original (?:detail|design|pattern|material)|protective material\w*)\b/iu.test(normalized);

    const axisCount = [conditionAxis, documentationAxis, treatmentOrMaterialAxis]
      .filter(Boolean).length;
    return restorationWorkflow && axisCount >= 2;
  }

  /**
   * Weak partial-support lane for craft/restoration evidence that proves the
   * exact requester pain but comes from an adjacent practitioner/object inside
   * the same material/craft family. This is intentionally SUPPORTING-only.
   * It is designed for evidence such as a leatherworker describing scattered
   * photos/notes and lost material/finish history when the requester is a
   * leather-bag restoration specialist. Generic tutorials and unrelated
   * restored objects remain excluded.
   */
  private static isAdjacentPhysicalWorkflowExactPainSupportingEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(evidence)) return false;

    const requestProfile = RequestWorkflowIntentProfileUtil.resolve(request);
    const subject = this.normalize(requestProfile.restorationSubject ?? '');
    const subjectTokens = [...this.extractTokens(subject)].filter(
      (token) =>
        token.length >= 4 &&
        !/^(?:antique|vintage|restoration|restore|repair|conservation|specialist|specialists|bag|bags|piece|pieces)$/u.test(token),
    );
    const evidenceTokens = this.extractTokens(evidence);
    const familyOverlap = subjectTokens.filter((token) =>
      this.semanticTokenAligned(token, evidenceTokens),
    ).length;

    const requestRecordsPain =
      /\b(?:scattered|photographs?|photos?|handwritten notes?|notes?|messages?|records?|history|previous repairs?|prior repairs?|material selections?|customer preferences?|client preferences?|forgotten|repeated work|inconsistent finishes?|lost)\b/iu.test(
        request,
      );
    if (!requestRecordsPain) return false;

    const sameCraftOrMaterial =
      familyOverlap >= 1 ||
      (/\b(?:leather|textile|fabric|wood|metal|ceramic|porcelain|glass|paper|book|instrument|jewelry|jewellery)\b/iu.test(subject) &&
        new RegExp(
          `\\b(?:${subjectTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\w*\\b`,
          'iu',
        ).test(evidence));
    if (!sameCraftOrMaterial) return false;

    const practitionerWorkflow =
      /\b(?:leatherwork|leathercraft|craft|crafter|maker|makers|artisan|artisans|workshop|project|projects|restor\w*|repair\w*|commission|commissions|client|customer|inventory|materials?|finishes?|hardware|thread|dye|paint)\b/iu.test(
        evidence,
      );
    const exactDocumentationPain =
      /\b(?:documentation (?:was|is) (?:a )?mess|scattered (?:photos?|photographs?|notes?|records?)|photos? in (?:one|a) folder|notes? app|no (?:real )?record|no record of|lost (?:notes?|records?|history)|missing (?:notes?|records?|history)|forgot(?:ten)? (?:details?|preferences?|materials?|finishes?)|cannot remember|can['’]?t remember|unable to reproduce|reproduc(?:e|ing) previous|which (?:leather|material|thread|finish|paint|dye|hardware) (?:i|we) used|history (?:was|is) missing|records? (?:were|are) scattered|fragmented documentation)\b/iu.test(
        evidence,
      );
    const materialHistoryAxis =
      /\b(?:photos?|photographs?|notes?|record|records|history|materials?|leather|hardware|thread|dyes?|finishes?|edge paint|previous work|prior work|project history|versioned|searchable)\b/iu.test(
        evidence,
      );

    return practitionerWorkflow && exactDocumentationPain && materialHistoryAxis;
  }

  private static isRestorationConservationEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (!this.isRestorationConservationSupportingEvidence(request, evidence)) return false;
    const requestMechanism = /\b(?:scattered|handwritten|photographs?|physical samples?|workshop records?|previous repairs?|restoration history|condition records?|replacement materials?|original design|original color|original colour)\b/iu.test(evidence);
    const impact = /\b(?:incorrect|wrong|mismatch\w*|lost original|loss of original|rework|repeated work|wasted materials?|delay\w*|overlooked damage)\b/iu.test(evidence);
    return requestMechanism && impact;
  }

  static requiresStrictWorkflowIdentity(input: {
    readonly requestDescription?: string | null;
    readonly plannedQueries?: readonly string[];
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    if (!request) return false;
    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: request,
      plannedQueries: input.plannedQueries ?? [],
    });
    return archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      this.isRestorationConservationRequest(request, input.plannedQueries ?? []) ||
      archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' ||
      this.isEnterpriseEmployeeAccessSecurityRequest(request) ||
      this.isGovernmentPaymentFraudRequest(request) ||
      this.isGovernmentRecordAccessIntegrityRequest(request) ||
      this.isHomeRemoteMedicalDeviceTrustRequest(request) ||
      this.isAcademicPlatformSecurityRequest(request) ||
      this.isDecorativeFountainRestorationRequest(request) ||
      this.isAcademicStaffingWorkloadRequest(request) ||
      this.isPetTrainerBehaviorTrackingRequest(request) ||
      this.isBuildingEnvironmentalMonitoringRequest(request) ||
      this.isDeliveryFuelEmissionsRequest(request) ||
      this.isUrbanEnergyDemandRequest(request) ||
      this.isCustomFootwearSpecificationRequest(request) ||
      this.isHeadwearSpecificationRequest(request) ||
      this.isWigMakerSpecificationRequest(request) ||
      this.isTattooDesignApprovalRequest(request) ||
      this.isHospitalOperatingRoomCoordinationRequest(request) ||
      this.isHospitalEquipmentTrackingRequest(request) ||
      this.isTransitCyberIncidentRequest(request) ||
      this.isPublicProgramCostAttributionRequest(request) ||
      this.isPublicFiscalOversightRequest(request) ||
      this.isEcommerceProfitabilityRequest(request) ||
      this.isClockRepairServiceHistoryRequest(request) ||
      this.isRestaurantProfitabilityRequest(request) ||
      this.isPetBoardingCareRequest(request) ||
      this.isMusicalRepairRequest(request) ||
      this.isMunicipalWasteCollectionRequest(request) ||
      this.isMusicalManuscriptRestorationRequest(request) ||
      this.hasGenericWorkflowContract(request);
  }

  private static isPromotionalProductListingEvidence(value: string): boolean {
    const text = this.normalize(value);
    if (!text) return false;
    const marketplaceListing =
      /\b(?:install(?:ing)?|download|launcher|built in game|launcher features|free and ad supported|ads keep|play anytime|quick setup|help center|app features|game features|available on google play|available on the app store)\b/iu.test(text);
    const gameOrMarketing =
      /\b(?:game|gaming|asmr|tap based|puzzle|home screen|ad supported|features|launcher)\b/iu.test(text);
    const realComplaint =
      /\b(?:review|complaint|problem|issue|failed|failure|lost|missing|wrong|incorrect|cannot|can'?t|difficult|frustrat|refund|charged|crash|bug|delay|rework|waste|missed)\w*\b/iu.test(text);
    return marketplaceListing && gameOrMarketing && !realComplaint;
  }

  private static isPublicProgramCostAttributionRequest(value: string): boolean {
    const publicActor = /\b(?:government agencies?|government departments?|public agencies?|public sector agencies?|ministr(?:y|ies)|municipalit(?:y|ies)|public authorities?)\b/iu.test(value);
    const programBudget = /\b(?:public programs?|government programs?|service programs?|program budgets?|departmental budgets?|operating budgets?|public services?)\b/iu.test(value);
    const costDrivers = /\b(?:staffing expenses?|staffing costs?|payroll|personnel costs?|procurement costs?|procurement spending|contractor payments?|contractor costs?|vendor payments?|service usage|service costs?|departmental spending|program expenditures?|operating expenses?|operating costs?)\b/iu.test(value);
    const pressure = /\b(?:exceed(?:s|ed|ing)? (?:their )?budgets?|budget overruns?|overspending|cost pressure|financial pressure|cost attribution|cost drivers?|budget variance|inaccurate budget planning|financial oversight|identify where overspending|greatest financial pressure)\b/iu.test(value);
    return publicActor && programBudget && costDrivers && pressure;
  }

  private static isPublicProgramCostAttributionSupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const publicContext = /\b(?:government|public sector|public agency|public agencies|government agency|government agencies|government department|government departments|public authority|public authorities|municipal|municipality|ministr(?:y|ies)|public administration|public program|government program)\b/iu.test(value);
    const costDriver = /\b(?:staffing|payroll|personnel cost|procurement|purchasing|contractor|vendor payment|supplier payment|service usage|service cost|departmental spending|program expenditure|operating expense|operating cost|public expenditure|government expenditure)\w*\b/iu.test(value);
    const pressureOrAnalysis = /\b(?:budget overrun|overspend|overspending|cost overrun|cost pressure|financial pressure|cost driver|cost attribution|budget variance|expenditure analysis|spending analysis|budget planning|financial oversight|inefficien|waste|value for money|cost growth|higher costs?|lower costs?|cost reduction)\w*\b/iu.test(value);
    const personalFinanceCollision = /\b(?:boyfriend|girlfriend|house down payment|personal savings?|personal finance|cheese wheel|stock portfolio|retirement account)\b/iu.test(value);
    const constructionAuctionOnly = /\b(?:auction format|combinatorial auction|public works auction|road resurfacing|construction project|reserve price)\b/iu.test(value) && !/\b(?:program budget|departmental budget|staffing|contractor payment|service usage|operating expense|cost attribution)\b/iu.test(value);
    return publicContext && costDriver && pressureOrAnalysis && !personalFinanceCollision && !constructionAuctionOnly;
  }

  private static isPublicProgramCostAttributionDirectEvidence(value: string): boolean {
    if (!this.isPublicProgramCostAttributionSupportingEvidence(value)) return false;
    const programIdentity = /\b(?:public program|government program|service program|program budget|departmental budget|government service|public service)\b/iu.test(value);
    const attributionWorkflow = /\b(?:cost attribution|cost drivers?|identify where|identify which|departmental spending|staffing costs?|procurement costs?|contractor payments?|service usage|analyzed separately|analysed separately|fragmented|siloed|budget variance|budget overruns?)\b/iu.test(value);
    const operationalImpact = /\b(?:budget overruns?|exceed(?:s|ed|ing)?\s+(?:(?:its|their|the)\s+)?budgets?|overspend|overspending|inaccurate budget(?:ing| planning)?|inefficient allocation|financial pressure|delay(?:ed|ing)? corrective(?: action)?|financial oversight|operating expenses?|operating costs?)\b/iu.test(value);
    return programIdentity && attributionWorkflow && operationalImpact;
  }

  private static isPublicFiscalOversightRequest(value: string): boolean {
    const explicitProcurementScope =
      /\b(?:public procurement|government procurement|public purchasing|government purchasing|procurement platforms?|procurement officers?|procurement auditors?)\b/iu.test(value);
    const publicActor =
      /\b(?:public institutions?|government|government agencies?|government departments?|public sector|public administration|ministr(?:y|ies)|municipal|municipality|public authorities?|public agencies?|county governments?|local governments?)\b/iu.test(value);
    const fiscalWorkflow =
      /\b(?:public budgets?|public funds?|government spending|public spending|procurement|procurement records?|purchase orders?|vendors?|suppliers?|contracts?|pricing data|invoices?|project expenses?|approval histor(?:y|ies)|duplicate payments?|duplicate invoices?|overspending|overpayments?|expenditure|financial management|budget planning|spending patterns?)\b/iu.test(value);
    return explicitProcurementScope || (publicActor && fiscalWorkflow);
  }

  private static isPublicFiscalOversightSupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const explicitProcurement =
      /\b(?:public procurement|government procurement|government purchasing|public purchasing|e-government procurement|procurement oversight|public tender|open tender|austender)\b/iu.test(value);
    const publicActor =
      /\b(?:government|public sector|public institutions?|public authorities?|public agencies?|county governments?|local governments?|ministr(?:y|ies)|municipal(?:ity|ities)?)\b/iu.test(value);
    const procurementAnchor =
      /\b(?:procurement|purchasing|tender|tenders|vendor|vendors|supplier|suppliers|purchase orders?|public contracts?|government contracts?)\b/iu.test(value);
    const publicProcurement =
      explicitProcurement || (publicActor && procurementAnchor) ||
      /\b(?:public spending|government spending|public expenditure|government expenditure)\b/iu.test(value);
    const procurementWorkflow =
      /\b(?:procurement|purchasing|vendor|vendors|supplier|suppliers|purchase orders?|contracts?|contract histories?|procurement records?|records management|pricing|prices?|tender|tenders|spend|spending|audit|auditing|oversight|monitoring|selection|market structure|supplier concentration|control indicators?)\w*\b/iu.test(value);
    const supportedFacet =
      /\b(?:suspicious|anomal(?:y|ies|ous)|fraud|fraudulent|corruption|collusion|mark[- ]?ups?|inflation|irregularit(?:y|ies)|inefficien(?:cy|t)|waste|wasted|overspend|duplicate|concentration|dominance|dependency risk|reactive|risk[- ]based|probity audit|weak oversight|limited oversight|record management|records management|transparency|value for money|supplier monitoring|supplier selection|preventive risk|control indicator|investigation|investigations|accountability|performance challenge)\w*\b/iu.test(value);
    const unrelatedFinance =
      /\b(?:dodd[- ]frank|financial officers?' negotiation|ifrs|stock market|private equity|personal finance)\b/iu.test(value) &&
      !publicProcurement;
    return publicProcurement && procurementWorkflow && supportedFacet && !unrelatedFinance;
  }

  private static isMunicipalInfrastructureMaintenanceRequest(value: string): boolean {
    return (
      /\b(?:municipal governments?|municipalities|city governments?|city councils?|public works|local authorities?)\b/iu.test(value) &&
      /\b(?:roads?|streetlights?|street lights?|public spaces?|city infrastructure|public infrastructure|maintenance requests?|citizen complaints?|inspection reports?|repair histories?|maintenance spending|repair prioritization|asset prioritization)\b/iu.test(value)
    );
  }

  private static isEcommerceProfitabilityRequest(value: string): boolean {
    return (
      /\b(?:online retailers?|online stores?|e-?commerce|ecommerce merchants?|online merchants?|shopify merchants?|digital retailers?)\b/iu.test(value) &&
      /\b(?:profit margins?|margin change|margin erosion|contribution margin|net profit|gross revenue|profitability|campaign profitability|profitable products?|profitable campaigns?)\b/iu.test(value) &&
      /\b(?:product discounts?|advertising costs?|ad spend|returns?|refunds?|payment fees?|gateway fees?|shipping expenses?|shipping costs?|fulfillment costs?|customer purchasing behavior|pricing decisions?)\b/iu.test(value)
    );
  }

  private static isEcommerceProfitabilityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const retailActor =
      /\b(?:online retailers?|online stores?|e-?commerce|ecommerce merchants?|online merchants?|shopify merchants?|digital retailers?|merchants?|sellers?)\b/iu.test(value);
    const marginOrProfit =
      /\b(?:profit margins?|margin compression|margin erosion|contribution margin|net profit|profitability|profitable products?|profitable campaigns?|campaign profitability|unit economics|gross margin)\b/iu.test(value);
    const costDriver =
      /\b(?:discounts?|advertising costs?|ad spend|marketing spend|returns?|refunds?|payment fees?|gateway fees?|shipping costs?|shipping expenses?|fulfillment costs?|customer acquisition cost|customer purchasing behavior|sales mix|cogs|cost of goods sold)\b/iu.test(value);
    const frictionOrDecision =
      /\b(?:declining|erosion|decrease|lower|overspend|overspending|unprofitable|loss|losses|misleading|difficult to determine|hard to determine|unable to determine|separate systems?|siloed|fragmented|attribution|pricing decision|promotion decision|margin change|margin variance|cost increase)\w*\b/iu.test(value);
    const receiptOnlyPraise =
      /\b(?:receipt|expense receipt|take a photo|scan receipt)\b/iu.test(value) &&
      !marginOrProfit &&
      !costDriver;

    return retailActor && marginOrProfit && costDriver && frictionOrDecision && !receiptOnlyPraise;
  }

  private static isEcommerceProfitabilitySupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const ecommerceOrFulfillmentContext =
      /\b(?:online retailers?|online stores?|e-?commerce|ecommerce merchants?|online merchants?|digital retailers?|merchants?|sellers?|fulfillment|fulfilment|3pl|warehouse|warehousing|carrier|carriers|last[- ]mile|parcel|delivery|deliveries|returns?|refunds?)\b/iu.test(value);
    const logisticsCostMechanism =
      /\b(?:shipping (?:costs?|charges?|delays?)|carrier charges?|freight costs?|fulfillment costs?|fulfilment costs?|warehouse costs?|storage costs?|return costs?|return rates?|refund costs?|damaged orders?|failed deliveries?|delivery failures?|inventory carrying costs?|landed cost|reverse logistics)\b/iu.test(value);
    const financialImpact =
      /\b(?:profitability|profit margins?|gross margins?|contribution margins?|unit economics|margin erosion|margin compression|unprofitable|financial impact|cost per order|product margin|product profitability|cash tied up|working capital|pricing decisions?|logistics spending|carrier selection)\b/iu.test(value);
    const concreteFriction =
      /\b(?:delay\w*|failure\w*|damag\w*|return\w*|refund\w*|cost\w*|expense\w*|overspend\w*|loss\w*|erosion|difficult|hard to|separate systems?|fragmented|siloed|inaccurate|poor selection|little real profit)\b/iu.test(value);

    return ecommerceOrFulfillmentContext && logisticsCostMechanism &&
      financialImpact && concreteFriction;
  }

  private static isMediaContentProfitabilityRequest(value: string): boolean {
    const actor =
      /\b(?:streaming and digital entertainment companies?|streaming companies?|streaming services?|streaming platforms?|digital entertainment companies?|digital entertainment platforms?|entertainment platforms?|media and entertainment companies?|media companies?|digital content platforms?|content platforms?|video platforms?|gaming platforms?|game platforms?)\b/iu.test(
        value,
      );
    const monetizationWorkflow =
      /\b(?:content profitability|sustainable revenue|subscription activity|subscription revenue|advertising income|ad revenue|production costs?|viewing behavior|viewer behavior|content engagement|browsing behavior|content discovery|discover content|purchases?|purchase abandonment|checkout abandonment|paid experiences?|conversion|conversion funnel|transaction history|cancellations?|churn|promotional campaigns?|offers?|customer feedback|content recommendations?|missed sales|marketing spend|content categories?|shows?|creators?|financial return|revenue forecasts?|content investment|investment decisions?)\b/iu.test(
        value,
      );
    return actor && monetizationWorkflow;
  }

  private static isMediaContentProfitabilityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const developerStreamingCollision =
      /\b(?:llm streaming|streaming llm|large language model|first token|time to first token|token streaming|next\.js|openai api|chat completion|server[- ]sent events?|sse)\b/iu.test(value);
    const genericNonEntertainmentCollision =
      /\b(?:digital teaching platforms?|education platforms?|classroom|mental health|body image|social media marketing strategy|b2b marketing|sales calls?|microsoft fabric|standard operating procedures?|sops?|travel blog|brompton|booking\.com)\b/iu.test(value) &&
      !/\b(?:digital entertainment|streaming|gaming platform|game platform|video platform|media and entertainment|paid content|subscription content)\b/iu.test(
        value,
      );
    if (developerStreamingCollision || genericNonEntertainmentCollision) return false;

    const mediaActor =
      /\b(?:streaming services?|streaming platforms?|video streaming|digital entertainment platforms?|digital entertainment|media and entertainment|media companies?|digital content platforms?|content platforms?|gaming platforms?|game platforms?|paid content platforms?|netflix|hulu|disney\+|prime video)\b/iu.test(
        value,
      );
    const monetization =
      /\b(?:purchases?|checkout|paid experiences?|paid content|subscription|subscription revenue|subscriber revenue|transactions?|transaction history|advertising revenue|ad revenue|content revenue|sales|revenue|profitability|financial return|return on investment|content roi)\b/iu.test(
        value,
      );
    const behaviorOrOffer =
      /\b(?:browsing behavior|content discovery|discover(?:ed|ing)? content|content engagement|viewing behavior|viewer behavior|watch time|audience engagement|subscriber retention|promotional campaigns?|promotion|offers?|recommendations?|customer feedback|purchase intent|conversion funnel)\b/iu.test(
        value,
      );
    const friction =
      /\b(?:abandon(?:ed|ment|ing)?|drop[- ]?off|conversion loss|low conversion|failed checkout|cancel(?:led|lation|ing)?|churn|lost interest|missed sales?|ineffective promotions?|poor recommendations?|marketing waste|overspend|overspending|difficult to identify|hard to identify|unable to identify|attribution|siloed|separate systems?|fragmented|underperforming)\b/iu.test(
        value,
      );

    return mediaActor && monetization && behaviorOrOffer && friction;
  }

  private static isMediaContentProfitabilitySupportingSignal(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const mediaActor =
      /\b(?:streaming services?|streaming platforms?|video streaming|digital entertainment platforms?|digital entertainment|media and entertainment|digital content platforms?|gaming platforms?|game platforms?|paid content platforms?|netflix|hulu|disney\+|prime video)\b/iu.test(
        value,
      );
    const monetization =
      /\b(?:purchase|purchases|checkout|paid experience|paid content|subscription|transaction|conversion|sales|revenue|profitability|ad revenue)\w*\b/iu.test(
        value,
      );
    const relevantFacet =
      /\b(?:abandon|drop[- ]?off|cancel|churn|conversion|content discovery|browsing|engagement|promotion|offer|recommendation|customer feedback|missed sales|marketing spend|transaction history|attribution|siloed|fragmented)\w*\b/iu.test(
        value,
      );
    const genericCollision =
      /\b(?:digital teaching platforms?|education platforms?|mental health|body image|b2b marketing|sales calls?|microsoft fabric|travel blog|brompton)\b/iu.test(
        value,
      ) && !mediaActor;
    return mediaActor && monetization && relevantFacet && !genericCollision;
  }

  private static isLogisticsProfitabilityRequest(value: string): boolean {
    return (
      /\b(?:logistics companies?|logistics providers?|logistics operators?|third[- ]party logistics|3pl providers?|freight companies?|freight operators?|delivery operators?|parcel carriers?|distribution operators?|supply chain operators?)\b/iu.test(value) &&
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|warehouse costs?|warehousing costs?|failed deliveries?|delivery failures?|vehicle maintenance|maintenance costs?|route performance|route profitability|customer penalties?|delivery penalties?|profit margins?|margin erosion|profitability|route planning|pricing decisions?|financial forecasts?|shipment volumes?|delivery volumes?|cost per shipment|cost per delivery)\b/iu.test(value) &&
      /\b(?:profit margins?|profitability|margin erosion|operating costs?|operating expenses?|financial forecasts?|pricing decisions?|cost increase|costs increase|become more expensive|reducing profit)\b/iu.test(value)
    );
  }

  private static isLogisticsProfitabilityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const logisticsActor =
      /\b(?:logistics compan(?:y|ies)|logistics providers?|logistics operators?|third[- ]party logistics|3pl providers?|freight companies?|freight operators?|delivery operators?|parcel carriers?|distribution operators?|supply chain operators?|warehouse operators?)\b/iu.test(value);
    const costOrMargin =
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|warehouse costs?|warehousing costs?|vehicle maintenance|maintenance costs?|customer penalties?|delivery penalties?|penalty costs?|profit margins?|operating margins?|margin erosion|profitability|cost per shipment|cost per delivery|financial forecasts?|pricing decisions?)\b/iu.test(value);
    const workflowDriver =
      /\b(?:failed deliveries?|delivery failures?|route performance|route profitability|route planning|shipment volumes?|delivery volumes?|vehicle utilization|fleet utilization|warehouse utilization|fuel consumption|maintenance frequency|vehicle downtime|customer penalties?|delivery penalties?)\b/iu.test(value);
    const frictionOrDecision =
      /\b(?:rising|increase|increasing|higher|more expensive|margin erosion|unprofitable|reducing profit|reducing profitability|difficult to identify|hard to identify|unable to identify|siloed|fragmented|separate systems?|analy[sz]ed separately|poor pricing|pricing decision|inaccurate financial forecast|forecast(?:ing)?|inefficient route planning|unnecessary transportation costs?|cost pressure|cost variance)\w*\b/iu.test(value);
    const custodyOnlyCollision =
      /\b(?:chain of custody|custody transfer|tampered tracking|record tampering|altered tracking|shipment provenance|ownership record|handover dispute)\b/iu.test(value) &&
      !costOrMargin;
    const consumerOrTechnicalCollision =
      /\b(?:app crash|login failure|authentication|server address|github issue|api integration|sdk|source code|mobile app ui|night mode)\b/iu.test(value) &&
      !costOrMargin;

    return (
      logisticsActor &&
      costOrMargin &&
      workflowDriver &&
      frictionOrDecision &&
      !custodyOnlyCollision &&
      !consumerOrTechnicalCollision
    );
  }

  private static isPublicTransportationProfitabilityRequest(
    value: string,
  ): boolean {
    return (
      /\b(?:public transportation|public transport|public transit|transit operators?|transit agencies?|transit authorities?|bus operators?|bus network|metro operators?|rail transit|municipal transit)\b/iu.test(value) &&
      /\b(?:operating costs?|fuel expenses?|fuel costs?|maintenance costs?|passenger demand|passenger volumes?|driver hours?|driver schedules?|ticket revenue|fare revenue|route profitability|route efficiency|financially inefficient|budget forecasts?|underused services?|schedule adjustments?)\b/iu.test(value)
    );
  }

  private static isPublicTransportationProfitabilitySupportingEvidence(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const publicTransitIdentity =
      /\b(?:public transportation|public transport|public transit|transit operators?|transit agencies?|transit authorities?|municipal transit|city transit|bus service|bus services|bus network|bus route|bus routes|bus operators?|metro|subway|rail transit|urban rail|mass transit)\b/iu.test(value);
    if (!publicTransitIdentity) return false;

    const aviationOrFreightOnly =
      /\b(?:airline|airlines|air canada|jetblue|lufthansa|qantas|flight|flights|airfare|airport|aviation|jet fuel|air cargo|shipping|container shipping|freight forwarding)\b/iu.test(value) &&
      !publicTransitIdentity;
    if (aviationOrFreightOnly) return false;

    const costOrRevenue =
      /\b(?:operating costs?|network operating costs?|fuel expenses?|fuel costs?|maintenance costs?|maintenance expenses?|ticket revenue|fare revenue|route revenue|route profitability|cost per route|cost efficiency|financial efficiency|budget forecast|budget forecasts|cost savings?|reduce costs?|reducing costs?|minimi[sz]e costs?|financially inefficient|unprofitable)\w*\b/iu.test(value);
    const routeScheduleDemand =
      /\b(?:route|routes|route performance|route profitability|route efficiency|schedule|schedules|schedule adjustments?|service adjustments?|passenger demand|passenger volumes?|ridership|driver hours?|driver schedules?|travel times?|bus travel times?|vehicle utilization|fleet utilization|underused services?|service frequency|network design)\w*\b/iu.test(value);
    const problemOrDecision =
      /\b(?:higher|rising|unnecessary|waste|wasted|inefficient|inefficiency|underused|unprofitable|poor scheduling|reduce|reduction|reducing|minimi[sz]e|optimi[sz]e|profitability|cost pressure|budget|forecast|decision|adjustment|performance)\w*\b/iu.test(value);

    return costOrRevenue && routeScheduleDemand && problemOrDecision;
  }

  private static isPublicTransportationProfitabilityEvidence(
    value: string,
  ): boolean {
    if (!this.isPublicTransportationProfitabilitySupportingEvidence(value)) {
      return false;
    }

    return /\b(?:separate systems?|analy[sz]ed separately|siloed|fragmented|difficult to identify|hard to identify|unable to identify|resource waste|wasted resources?|financially inefficient|poor scheduling decisions?|inaccurate budget forecasts?|underused services?)\b/iu.test(
      value,
    );
  }

  private static isTransportationProfitabilityRequest(value: string): boolean {
    return (
      /\b(?:transportation companies?|transport companies?|transport operators?|transportation operators?|fleet operators?|fleet managers?|transit operators?|passenger transport companies?|bus companies?|delivery fleets?|commercial fleets?)\b/iu.test(value) &&
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|maintenance costs?|maintenance expenses?|route performance|route profitability|driver schedules?|ticket revenue|fare revenue|delivery revenue|vehicle utilization|fleet utilization|pricing decisions?|financial forecasts?|profitability|margin erosion|cost variance)\b/iu.test(value)
    );
  }

  private static isTransportationProfitabilityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const transportActor =
      /\b(?:transportation compan(?:y|ies)|transport compan(?:y|ies)|transport operators?|transportation operators?|fleet operators?|fleet managers?|transit operators?|transit agencies?|passenger transport|bus operators?|delivery fleets?|commercial fleets?|fleet operations?)\b/iu.test(value);
    const costOrRevenue =
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|maintenance costs?|maintenance expenses?|ticket revenue|fare revenue|delivery revenue|route revenue|cost per route|cost per vehicle|profitability|route margin|operating margin|financial forecast|cost variance)\b/iu.test(value);
    const routeOrFleetDriver =
      /\b(?:route performance|route profitability|route margin|vehicle utilization|fleet utilization|driver schedules?|driver rosters?|passenger volume|delivery volume|load factor|mileage|fuel consumption|maintenance frequency|vehicle downtime|route efficiency)\b/iu.test(value);
    const frictionOrDecision =
      /\b(?:rising|increase|increasing|spike|variance|margin erosion|unprofitable|reducing profitability|hard to identify|difficult to identify|unable to identify|siloed|fragmented|separate systems?|analy[sz]ed separately|poor pricing|pricing decision|forecast(?:ing)?|inefficient scheduling|unnecessary operating expense|cost pressure)\w*\b/iu.test(value);
    const consumerTransitAppCollision =
      /\b(?:bus arrival|route planner|mobile app|app crash|server address|login|night mode|ui update|map screen|stop search)\b/iu.test(value) &&
      !costOrRevenue;

    return (
      transportActor &&
      costOrRevenue &&
      routeOrFleetDriver &&
      frictionOrDecision &&
      !consumerTransitAppCollision
    );
  }

  private static isMunicipalCorridorCongestionRequest(value: string): boolean {
    const actor =
      /\b(?:city transport(?:ation)? departments?|municipal transport(?:ation)? departments?|urban transportation agencies?|transportation agencies?|transit agencies?|public transport(?:ation)? authorities?|urban mobility agencies?)\b/iu.test(value);
    const workflow =
      /\b(?:intersections?|bus corridors?|traffic sensors?|vehicle locations?|signal timing|passenger volumes?|road incident reports?|traffic congestion|recurring delays?|travel times?|overcrowded routes?)\b/iu.test(value);
    const diagnosticNeed =
      /\b(?:real cause|root cause|recurring delays?|separate systems?|siloed|fragmented|inefficient signal adjustments?|overcrowded routes?|longer travel times?|poor use of transportation resources|bottlenecks?)\b/iu.test(value);
    return actor && workflow && diagnosticNeed;
  }

  private static isMunicipalCorridorCongestionSupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const mobilityIdentity =
      /\b(?:public transport|public transportation|public transit|transit|city traffic|urban traffic|traffic congestion|intersection|intersections|bus corridor|bus corridors|bus route|bus routes|road network|transport authority|municipal transport)\b/iu.test(value);
    const congestionFacet =
      /\b(?:congestion|congested|bottleneck|gridlock|delay|delays|travel time|journey time|overcrowd|overcrowded|crowding|passenger volume|traffic flow|signal timing|road incident|peak hour|capacity pressure)\w*\b/iu.test(value);
    const tourismOnly =
      /\b(?:tourism|tourist|tourists|visitor surge|visitor demand|attraction|destination management|overtourism|festival tourism|holiday tourism)\b/iu.test(value) &&
      !/\b(?:public transport|public transit|city traffic|urban traffic|intersection|bus corridor|road network|municipal transport)\b/iu.test(value);

    return mobilityIdentity && congestionFacet && !tourismOnly;
  }

  private static isMunicipalCorridorCongestionEvidence(value: string): boolean {
    if (!this.isMunicipalCorridorCongestionSupportingEvidence(value)) return false;

    const operationalSignals =
      /\b(?:traffic sensors?|vehicle locations?|signal timing|passenger volumes?|road incident reports?|incident logs?|traffic counts?|vehicle positions?|transit telemetry)\b/iu.test(value);
    const diagnosticFriction =
      /\b(?:separate systems?|siloed|fragmented|difficult to identify|hard to identify|root cause|real cause|recurring delays?|inefficient signal adjustments?|poor resource use|overcrowded routes?)\b/iu.test(value);
    return operationalSignals && diagnosticFriction;
  }

  private static isBookEdgeGildingRequest(value: string): boolean {
    const actor =
      /\b(?:book edge gilding specialists?|book edge gilders?|fore[- ]edge gilding specialists?|book gilding specialists?|bookbinders?|custom bookbinders?)\b/iu.test(value);
    const workflow =
      /\b(?:book dimensions?|foil selections?|gold[- ]leaf selections?|gold leaf selections?|decorative patterns?|surface preparation notes?|revision details?|finish specifications?|approved finish|completion deadlines?)\b/iu.test(value);
    const friction =
      /\b(?:inconsistent decoration|incorrect materials?|repeated work|rework|damaged books?|ruined books?|delayed orders?|scattered|handwritten|physical samples?|customer messages?|approval confusion)\b/iu.test(value);
    return actor && workflow && friction;
  }

  private static isBookEdgeGildingSupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const bookIdentity =
      /\b(?:book edge|book edges|fore[- ]edge|bookbinding|bookbinder|bookbinders|bound book|book restoration|book gilding|edge gilding|gold[- ]leaf book|gold leaf book)\b/iu.test(value);
    const gildingOrWorkflowFacet =
      /\b(?:gilding|gold[- ]leaf|gold leaf|foil|surface preparation|finish|finishing|decorative pattern|material selection|material mismatch|revision|approval|specification|rework|repeated work|damaged book|ruined book|deadline|delayed order)\w*\b/iu.test(value);
    const unrelatedCraft =
      /\b(?:leather bag|handbag|shoe repair|eyeglass|furniture refinishing|wall gilding|picture frame gilding)\b/iu.test(value) &&
      !bookIdentity;

    return bookIdentity && gildingOrWorkflowFacet && !unrelatedCraft;
  }

  private static isBookEdgeGildingEvidence(value: string): boolean {
    if (!this.isBookEdgeGildingSupportingEvidence(value)) return false;

    const concreteFailure =
      /\b(?:wrong|incorrect|mistake|error|lost|scattered|missing|outdated|rework|repeated work|inconsistent|damage|damaged|ruined|delay|delayed|approval confusion|wrong version|material mismatch|surface preparation problem)\w*\b/iu.test(value);
    const specificationFacet =
      /\b(?:gold[- ]leaf|gold leaf|foil|surface preparation|finish|decorative pattern|material|revision|approval|specification)\w*\b/iu.test(value);
    return concreteFailure && specificationFacet;
  }

  private static isBookCoverCommissionRequest(value: string): boolean {
    return (
      /\b(?:book cover craftsmen?|book cover makers?|bookbinders?|custom bookbinders?|bookbinding craftsmen?|bookbinding artisans?|binderies?|bindery workshops?|bookbinding workshops?|book edge gilding specialists?|book edge gilders?|fore[- ]edge gilding specialists?|book gilding specialists?)\b/iu.test(value) &&
      /\b(?:client artwork|book dimensions?|cover dimensions?|material selections?|material choices?|embossing details?|foil stamping|foil selections?|gold[- ]leaf selections?|gold leaf selections?|decorative patterns?|surface preparation notes?|finish specifications?|approved finish|color preferences?|colour preferences?|revision requests?|revision details?|approved specifications?|customer approvals?|completion deadlines?|incorrect materials?|damaged books?|incorrect dimensions?|wasted materials?|repeated work|delayed orders?)\b/iu.test(value)
    );
  }

  private static isBookCoverCommissionEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const tradeActor =
      /\b(?:book cover craftsmen?|book cover makers?|bookbinders?|custom bookbinders?|bookbinding craftsmen?|bookbinding artisans?|bindery|binderies|bookbinding workshops?|bespoke bookbinding|custom bookbinding|book edge gilders?|book edge gilding specialists?|fore[- ]edge gilding specialists?|book gilding specialists?)\b/iu.test(value);
    const specificationWorkflow =
      /\b(?:client artwork|artwork proof|book dimensions?|cover dimensions?|spine width|material selections?|material choices?|book cloth|leather|embossing|foil stamping|foil selections?|gold[- ]leaf|gold leaf|decorative patterns?|surface preparation|finish specifications?|approved finish|color preferences?|colour preferences?|revision requests?|revision details?|design revisions?|approved specifications?|final specifications?|customer approval|client approval|completion deadline|production sheet)\b/iu.test(value);
    const friction =
      /\b(?:wrong|incorrect|missed|missing|lost|scattered|handwritten|messages?|miscommunication|outdated|wrong version|rework|remake|repeated work|waste|wasted material|inconsistent decoration|damaged books?|ruined books?|delay|delayed|dimension error|material error|surface preparation error|approval confusion|specification error)\w*\b/iu.test(value);
    const consumerBookAppCollision =
      /\b(?:goodreads|star rating|reading dates?|followers?|wattpad|book cover maker app|template app|paywall|subscription popup|mobile app crash)\b/iu.test(value) &&
      !tradeActor;

    return (
      tradeActor &&
      specificationWorkflow &&
      friction &&
      !consumerBookAppCollision
    );
  }

  private static isBridalAlterationWorkflowRequest(value: string): boolean {
    return (
      /\b(?:alteration specialists?|bridal alterations? specialists?|clothing alteration specialists?|seamstress(?:es)?|bridal seamstress(?:es)?|dressmakers?|bridal dressmakers?|tailors?|tailoring|alteration shops?|wedding dress alterations?|bridal alterations?)\b/iu.test(value) &&
      /\b(?:dress measurements?|customer measurements?|fitting notes?|requested modifications?|requested changes?|alteration requests?|fabric details?|accessory requirements?|customer approvals?|approved alterations?|pickup deadlines?|fitting appointments?|incorrect adjustments?|repeated fittings?|forgotten requests?|fabric damage|delayed completion)\b/iu.test(value)
    );
  }

  private static isBridalAlterationWorkflowEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    /*
     * DIRECT requires an actual alterations provider/practitioner identity.
     * Merely saying "dress alterations" describes an activity, not evidence
     * that a bridal alteration specialist experienced the requester workflow.
     */
    const tradeActor =
      /\b(?:alteration specialists?|bridal alterations? specialists?|alteration shops?|bridal alteration shops?|seamstress(?:es)?|bridal seamstress(?:es)?|dressmakers?|bridal dressmakers?|tailors?|tailoring businesses?|tailoring shops?)\b/iu.test(
        value,
      );
    const workflow =
      /\b(?:measurements?|fitting notes?|fittings?|alteration requests?|requested changes?|requested modifications?|hemming|bustle|taking in|letting out|fabric details?|fabric samples?|beadwork|accessories|customer approval|client approval|approved alterations?|revision|pickup date|pickup deadline|completion date)\b/iu.test(value);
    const friction =
      /\b(?:wrong|incorrect|missed|forgotten|lost|scattered|handwritten|paper notes?|messages?|miscommunication|repeated fittings?|rework|fabric damage|damaged fabric|delay|delayed|late|wrong alteration|wrong measurement|measurement error|approval confusion|wrong version)\b/iu.test(value);
    const weddingPlanningOnly =
      /\b(?:wedding planner|wedding planning app|guest list|venue booking|vendor directory|rsvp|seating chart|bachelorette|airbnb|flights?|venmo|maid of honor|wedding party costs?)\b/iu.test(value) &&
      !/\b(?:alteration specialist|alteration shop|seamstress|dressmaker|tailor|fitting note|measurement|hemming|bustle)\b/iu.test(value);
    const apparelShoppingOnly =
      /\b(?:shopping cart|bridesmaid shopping|dress shopping|quick ship|checkout)\b/iu.test(value) &&
      !/\b(?:alteration specialist|alteration shop|seamstress|dressmaker|tailor|fitting)\b/iu.test(value);

    return tradeActor && workflow && friction && !weddingPlanningOnly && !apparelShoppingOnly;
  }

  /**
   * Partial bridal-alterations evidence may be SUPPORTING when it proves one
   * fitting/measurement/alteration failure on the same garment workflow, even
   * if the person doing the alteration is not a professional. It must never be
   * promoted to DIRECT unless the provider identity contract above is met.
   */
  private static isBridalAlterationWorkflowSupportingEvidence(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const weddingCostOrParticipationOnly =
      /\b(?:maid of honor|bachelorette|airbnb|flights?|venmo|split costs?|wedding party costs?|bridesmaid costs?|travel costs?|hotel costs?|spreadsheet)\b/iu.test(value) &&
      !/\b(?:alteration|alterations|seamstress|dressmaker|tailor|fitting|measurement|hemming|hemmed|bustle|taking in|letting out|beadwork)\b/iu.test(value);
    if (weddingCostOrParticipationOnly) return false;

    const sameGarmentOrAlterationWorkflow =
      /\b(?:bridal gown|wedding gown|wedding dress|bridal dress|bridesmaid dress|bridesmaid dresses|formal gown|dress alterations?|gown alterations?|bridal alterations?|alteration appointment|alteration appointments?|fitting appointment|fitting appointments?|first alteration|seamstress|dressmaker|tailor)\b/iu.test(value);
    const alterationAxis =
      /\b(?:alteration|alterations|measurement|measurements|fitting|fittings|hemming|hemmed|hem|bustle|taking in|letting out|resize|resizing|fit|fabric|beadwork|requested change|approved change|pickup|completion)\w*\b/iu.test(value);
    const painOrOutcome =
      /\b(?:wrong|incorrect|mismatch|different|doesn['’]?t fit|didn['’]?t fit|poor fit|too tight|too loose|missed|forgotten|lost|rework|redo|mishap|mistake|error|damage|damaged|delay|delayed|late|not ready|unfinished|last[- ]minute|uncertain|uncertainty|confusion)\w*\b/iu.test(value);

    return sameGarmentOrAlterationWorkflow && alterationAxis && painOrOutcome;
  }

  private static isClockRepairServiceHistoryRequest(value: string): boolean {
    return (
      /\b(?:clock repair specialists?|clock repairers?|clockmakers?|horologists?|horology|antique clock repair|timepiece repair)\b/iu.test(value) &&
      /\b(?:mechanical faults?|replacement parts?|previous repairs?|repair history|service history|restoration instructions?|cost approvals?|completion dates?|promised completion|repeated diagnostics?|incorrect replacement parts?|delayed repairs?)\b/iu.test(value)
    );
  }

  private static isClockRepairServiceHistoryEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const actor =
      /\b(?:clock repair(?: specialist| specialists|er|ers| shop| shops)?|clockmaker|clockmakers|horologist|horologists|horology|antique clock|mechanical clock|timepiece repair)\b/iu.test(value);
    const workflow =
      /\b(?:mechanical fault|mechanical faults|diagnostic|diagnostics|replacement part|replacement parts|repair history|previous repair|previous repairs|service history|restoration instruction|restoration instructions|cost approval|cost approvals|customer request|customer requests|completion date|completion dates|repair note|repair notes)\w*\b/iu.test(value);
    const friction =
      /\b(?:repeated diagnostic|repeated diagnostics|wrong part|incorrect part|incorrect replacement|forgotten request|lost note|missing history|scattered notes?|paper records?|handwritten notes?|unexpected cost|delayed repair|delay|rework|misdiagnos|hard to track|difficult to track)\w*\b/iu.test(value);
    const dollCollision =
      /\b(?:doll restoration|doll restorer|antique doll|toy restoration|fabric selection|paint matching)\b/iu.test(value) &&
      !/\b(?:clock|clockmaker|horolog|timepiece)\w*\b/iu.test(value);

    return actor && workflow && friction && !dollCollision;
  }

  private static isRestaurantProfitabilityRequest(value: string): boolean {
    return (
      /\b(?:restaurant chains?|multi[- ]unit restaurants?|restaurant groups?|restaurant franchises?|franchise locations?|restaurant locations?)\b/iu.test(value) &&
      /\b(?:profitability|profit margins?|margin erosion|financial performance|ingredient expenses?|ingredient costs?|food costs?|staffing costs?|labor costs?|daily sales|waste records?|supplier prices?|promotions?)\b/iu.test(value)
    );
  }

  private static isRestaurantProfitabilityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const restaurantActor =
      /\b(?:restaurant chains?|multi[- ]unit restaurants?|restaurant groups?|restaurant franchises?|restaurant operators?|restaurant locations?|food service operators?|franchise operators?|restaurants?)\b/iu.test(value);
    const marginOrProfit =
      /\b(?:profitability|profit margin|profit margins|margin compression|margin erosion|operating margin|restaurant margins?|food cost percentage|labor cost percentage|prime cost|cost pressure|cost pressures|store[- ]level profit|location profitability|financial performance|declining profit|lower profit|rising costs?)\b/iu.test(value);
    const operationalDriver =
      /\b(?:ingredient costs?|ingredient expenses?|food costs?|labor costs?|labour costs?|staffing costs?|payroll|daily sales|sales mix|waste|food waste|inventory waste|supplier prices?|vendor prices?|purchasing|procurement|promotions?|discounts?|menu pricing|inventory|cogs|cost of goods sold)\b/iu.test(value);
    const decisionOrVariance =
      /\b(?:variance|different locations?|store[- ]level|location[- ]level|compare locations?|rising|increase|increasing|declining|erosion|inefficient|overspend|unnecessary spend|waste|poorly timed|supplier increase|price increase|cost spike|cost spikes|unable to identify|difficult to identify|hard to identify|fragmented|siloed|separate data|separate systems?|delayed response|profit decline)\w*\b/iu.test(value);

    return restaurantActor && marginOrProfit && operationalDriver && decisionOrVariance;
  }

  private static isPetBoardingCareRequest(value: string): boolean {
    return (
      /\b(?:pet boarding facilities?|boarding kennels?|kennels?|pet hotels?|dog boarding|animal boarding)\b/iu.test(value) &&
      /\b(?:feeding instructions?|medication schedules?|behavioral notes?|behavioural notes?|owner requests?|room assignments?|pickup times?|care routines?|shift handoffs?)\b/iu.test(value)
    );
  }

  private static isPetBoardingCareEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const boardingActor =
      /\b(?:pet boarding facilities?|boarding kennels?|kennels?|pet hotels?|dog boarding|animal boarding|pet daycare|dog daycare|veterinary boarding|boarding facility|boarding staff|kennel staff)\b/iu.test(value);
    const careWorkflow =
      /\b(?:feeding|feedings|feeding instructions?|dietary instructions?|medication|medications|medication schedules?|medication instructions?|behavioral notes?|behavioural notes?|care notes?|care instructions?|owner instructions?|owner requests?|special routines?|room assignments?|kennel assignments?|pickup times?|pick[- ]up times?|shift handoff|shift handoffs|staff handoff|staff handoffs|boarding schedule|care task|care tasks|pet profile|pet records?)\b/iu.test(value);
    const careFriction =
      /\b(?:missed|missing|forgotten|wrong|incorrect|mistake|mistakes|mix[- ]up|mixed up|confusion|scheduling conflict|inconsistent care|not updated|failed handoff|handoff failure|scattered|paper forms?|paper notes?|verbal instructions?|miscommunication|delayed|late pickup|medication error|feeding error|feeding mistake|missed medication|missed feeding|room assignment error)\w*\b/iu.test(value);

    return boardingActor && careWorkflow && careFriction;
  }

  private static isEnergyIotSecurityRequest(value: string): boolean {
    return /\b(?:energy providers?|electric utilities?|power utilities?|utility companies?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid)\b/iu.test(value) &&
      /\b(?:connected meters?|smart meters?|remote monitoring devices?|automated control systems?|device failures?|meter failures?|unusual consumption|consumption anomalies?|network disruptions?|unauthorized access|malicious interference|telemetry|consumption data integrity|incident response)\b/iu.test(value);
  }

  private static isEnergyIotSecurityEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const energyActor = /\b(?:electric utilit(?:y|ies)|power utilit(?:y|ies)|utility compan(?:y|ies)|energy provider|grid operator|electricity distribution|power distribution|power grid|smart grid|advanced metering infrastructure|\bami\b)\b/iu.test(value);
    const assetSignal = /\b(?:smart meters?|connected meters?|advanced metering|meter telemetry|meter data|distribution automation|grid telemetry|iot devices?|remote monitoring|device health|network health|control systems?)\b/iu.test(value);
    const incidentSignal = /\b(?:device failure|meter failure|network disruption|connectivity failure|unusual consumption|consumption anomal|inaccurate reading|data integrity|unauthorized access|tamper|tampering|malicious interference|cyberattack|cyber attack|security incident|incident response|root cause|incident attribution|technical fault|equipment fault)\w*\b/iu.test(value);
    const consumerCollision = /\b(?:payment page|billing app|mobile app|login|subscription|play store|app store)\b/iu.test(value) && !assetSignal;
    return energyActor && assetSignal && incidentSignal && !consumerCollision;
  }

  private static isDollRestorationRequest(value: string): boolean {
    return /\b(?:independent doll restoration specialists?|doll restoration specialists?|doll restorers?|doll restoration studios?|doll restoration workshops?|antique doll restorers?|doll repair specialists?)\b/iu.test(value) &&
      /\b(?:damage photographs?|damage photos?|fabric selections?|replacement parts?|paint matching|restoration notes?|approved restoration|material samples?|physical samples?|completion dates?|incorrect replacements?|mismatched materials?|repeated work|lost details|delayed customer orders?)\b/iu.test(value);
  }

  private static isDollRestorationEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const gameCollision = /\b(?:game|gameplay|play button|level|levels|coins?|in[- ]app purchase|paywall|dress up|makeover|mobile app|android|iphone)\b/iu.test(value) &&
      !/\b(?:professional doll restoration|antique doll restoration|doll restorer|restoration specialist|restoration studio|restoration workshop)\b/iu.test(value);
    if (gameCollision) return false;
    const actor = /\b(?:professional doll restoration|antique doll restoration|doll restoration specialist|doll restorer|doll restoration studio|doll restoration workshop|doll repair specialist|doll conservator)\b/iu.test(value);
    const workflow = /\b(?:damage photo|damage photograph|condition photo|fabric|replacement part|paint matching|paint sample|restoration note|treatment note|repair scope|restoration scope|material sample|physical sample|customer approval|approved restoration|revision|completion date)\w*\b/iu.test(value);
    const friction = /\b(?:wrong|incorrect|mismatch|mismatched|missing|lost|scattered|outdated|rework|repeated work|wasted|delay|delayed|mistake|wrong version|unapproved)\w*\b/iu.test(value);
    return actor && workflow && friction;
  }

  private static isTourismTransitSurgeCapacityRequest(value: string): boolean {
    return (
      /\b(?:tourism operators?|tour operators?|tourism authorities?|tourism boards?|city transport services?|public transport services?|municipal transit|city transit|visitors?|tourists?)\b/iu.test(value) &&
      /\b(?:festival|festivals|holiday|holidays|large public events?|public events?|visitor demand|passenger volumes?|transport capacity|public transport capacity|congestion|overcrowd|waiting times?|vehicle allocation|attraction schedules?|booking activity|demand changes?|demand surge|visitor surge)\w*\b/iu.test(value)
    );
  }

  private static isTourismTransitSurgeCapacitySupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const identity =
      /\b(?:tourism|tourist|tourists|visitor|visitors|destination|destinations|attraction|attractions|public transport|public transportation|public transit|city transport|municipal transit|bus service|transit service)\w*\b/iu.test(value);
    const pressure =
      /\b(?:overtourism|tourism boom|visitor boom|visitor surge|tourist surge|passenger surge|demand surge|golden week|festival|holiday|public event|overcrowd|crowding|congestion|hotspot|hot spot|waiting time|queue|capacity|carrying capacity|demand-responsive|demand responsive|passenger volume|visitor flow|tourist flow|transport demand|service pressure|safety strain)\w*\b/iu.test(value);
    const operational =
      /\b(?:transport|transit|route|vehicle|bus|rail|metro|service|capacity|visitor management|destination management|hotspot|hot spot|waiting|queue|demand|flow|attraction|city)\w*\b/iu.test(value);
    const marketingOnly =
      /\b(?:luxury travel|travel deal|destination promotion|tourism marketing|booking agent|ai booking agent|travel package)\b/iu.test(value) && !pressure;
    return identity && pressure && operational && !marketingOnly;
  }

  private static isTourismCrowdingRequest(value: string): boolean {
    return (
      /\b(?:tourist destinations?|tourism destinations?|tourism authorities?|tourism boards?|visitors?|tourists?|attractions?|transportation hubs?|public spaces?)\b/iu.test(value) &&
      /\b(?:crowding|overcrowd|congestion|long waiting times?|visitor movement|event schedules?|transportation updates?|local service capacity|visitor experience|city resources?)\w*\b/iu.test(value)
    );
  }

  private static isTattooDesignApprovalRequest(value: string): boolean {
    return (
      /\b(?:independent tattoo artists?|tattoo artists?|tattoo studios?|tattoo shops?|tattooists?)\b/iu.test(value) &&
      /\b(?:design references?|reference images?|placement preferences?|size requirements?|dimensions?|color choices?|colour choices?|stencils?|revision requests?|design revisions?|approved design|approved version|final approved|appointment details?|aftercare notes?|client records?)\b/iu.test(value)
    );
  }

  private static isTattooDesignApprovalEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const tattooActor =
      /\b(?:tattoo|tattoo artist|tattoo artists|tattoo studio|tattoo studios|tattoo shop|tattoo shops|tattooist|tattooists|tattooing)\b/iu.test(value);
    const designAxis =
      /\b(?:design reference|reference image|placement preference|placement|size requirement|dimension|color choice|colour choice|stencil|revision request|design revision|approved design|approved version|final design|client approval|appointment|aftercare)\w*\b/iu.test(value);
    const recordAxis =
      /\b(?:social media message|instagram|dm|direct message|sketch|photograph|photo|handwritten note|client record|consultation record|version history|revision history|approval record)\w*\b/iu.test(value);
    const frictionAxis =
      /\b(?:wrong|incorrect|lost|missing|scattered|missed|forgotten|outdated|old version|unconfirmed|rework|repeat revision|repeated revision|scheduling confusion|scheduling conflict|miscommunication|inconsistent|hard to confirm|difficult to confirm)\w*\b/iu.test(value);
    const removalCollision =
      /\b(?:laser tattoo removal|tattoo removal clinic|tattoo removal treatment)\b/iu.test(value);
    return tattooActor && designAxis && recordAxis && frictionAxis && !removalCollision;
  }

  private static isPublicTransitDisruptionCoordinationRequest(
    value: string,
  ): boolean {
    return (
      /\b(?:public transportation|public transport|public transit|transit authorit|transit agenc|transit dispatcher|municipal transit|bus network|rail transit|urban rail)\w*\b/iu.test(
        value,
      ) &&
      /\b(?:road closure|accident|large event|special event|passenger demand|passenger surge|vehicle location|route schedule|incident report|rerout|overcrowd|service disruption|sudden failure)\w*\b/iu.test(
        value,
      )
    );
  }

  private static isPublicTransitDisruptionCoordinationEvidence(
    value: string,
  ): boolean {
    const transitIdentity =
      /\b(?:public transportation|public transport|public transit|transit agenc|transit operator|transit dispatcher|municipal transit|bus service|bus network|rail transit|urban rail|metro|subway|transit network)\w*\b/iu.test(
        value,
      );
    const disruption =
      /\b(?:road closure|accident|large event|special event|emergency|service disruption|sudden failure|incident|passenger surge|demand surge|unexpected demand)\w*\b/iu.test(
        value,
      );
    const coordination =
      /\b(?:route adjustment|adjustment of traffic organization|rerout|route priorit|vehicle location|route schedule|dispatch|passenger flow|evacuation|delay propagation|operational delay|service delay|overcrowd)\w*\b/iu.test(
        value,
      );
    const authorityOrDispatch =
      /\b(?:authorit|agency|operator|dispatcher|dispatch|control center|operations manager|route planner)\w*\b/iu.test(
        value,
      );

    return transitIdentity && disruption && coordination && authorityOrDispatch;
  }

  private static isPublicTransitDisruptionCoordinationSupportingSignal(
    value: string,
  ): boolean {
    const transitIdentity =
      /\b(?:public transportation|public transport|public transit|transit agenc|transit operator|municipal transit|bus service|bus network|rail transit|urban rail|metro|subway|transit network)\w*\b/iu.test(
        value,
      );
    const disruption =
      /\b(?:road closure|accident|large event|special event|emergency|service disruption|sudden failure|incident|passenger surge|demand surge|unexpected demand)\w*\b/iu.test(
        value,
      );
    const operations =
      /\b(?:route adjustment|traffic organization|rerout|route priorit|vehicle location|route schedule|dispatch|passenger flow|evacuation|delay propagation|operational delay|service delay|overcrowd|travel delay)\w*\b/iu.test(
        value,
      );
    const freightCollision =
      /\b(?:freight|shipment|warehouse|parcel|cargo|last mile|delivery fleet)\b/iu.test(
        value,
      ) && !transitIdentity;

    return transitIdentity && disruption && operations && !freightCollision;
  }

  private static isWatchStrapSpecificationRequest(value: string): boolean {
    return (
      /\b(?:watch strap makers?|watch band makers?|custom watch straps?|custom watch bands?|bespoke watch straps?|leather watch straps?|leather watch bands?|watch straps?|watch bands?)\b/iu.test(value) &&
      /\b(?:wrist measurements?|wrist sizes?|strap measurements?|strap lengths?|strap widths?|lug widths?|leather types?|material choices?|stitching styles?|buckle selections?|color preferences?|colour preferences?|design revisions?|revision requests?|customer approvals?|approved specifications?|wrong sizes?|sizing errors?|remakes?|rework|wasted leather|wasted supplies?|delayed orders?)\b/iu.test(value)
    );
  }

  private static hasWatchStrapIdentity(value: string): boolean {
    return /\b(?:watch straps?|watch bands?|wristwatch straps?|wristwatch bands?|leather watch straps?|leather watch bands?|custom watch straps?|bespoke watch straps?|watch strap makers?|watch band makers?)\b/iu.test(value);
  }

  private static isWatchStrapDirectEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value) || !this.hasWatchStrapIdentity(value)) {
      return false;
    }
    const workflow =
      /\b(?:wrist measurements?|wrist sizes?|strap measurements?|strap lengths?|strap widths?|lug widths?|leather types?|material selections?|material choices?|stitching styles?|thread colors?|buckles?|buckle selections?|color preferences?|colour preferences?|custom orders?|design revisions?|revision requests?|customer approvals?|approved specifications?|final approved|customer messages?)\b/iu.test(value);
    const pain =
      /\b(?:wrong sizes?|incorrect sizes?|sizing errors?|measurement errors?|measurement mistakes?|wrong measurements?|incorrect measurements?|wrong leather|incorrect leather|wrong materials?|incorrect materials?|material mismatch(?:es)?|changed designs?|changed mind|missed revisions?|lost revisions?|wrong versions?|outdated versions?|approval confusion|unapproved|remakes?|remade|rework|repeated adjustments?|wasted leather|wasted materials?|wasted supplies|delays?|delayed orders?|hard to confirm|difficult to confirm|scattered|lost notes?|missing instructions?)\b/iu.test(value);
    return workflow && pain;
  }

  private static isWatchStrapSupportingEvidence(value: string): boolean {
    if (this.isWatchStrapDirectEvidence(value)) return true;
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const adjacentLeathercraft =
      /\b(?:leathercraft|leather craft|leatherwork|leather worker|leatherworker|leather artisan|leather goods maker|custom leather|bespoke leather|leather workshop|leather shop)\b/iu.test(value);
    const workflowFacet =
      /\b(?:measurements?|sizing|dimensions?|leather types?|material selections?|material choices?|stitching|thread colors?|hardware|buckles?|custom orders?|client orders?|customer orders?|design revisions?|revision requests?|customer approvals?|client approvals?|approved specifications?|final approved|customer messages?|client messages?)\b/iu.test(value);
    const samePain =
      /\b(?:wrong sizes?|incorrect sizes?|sizing errors?|measurement errors?|measurement mistakes?|wrong measurements?|wrong leather|incorrect leather|wrong materials?|material mismatch(?:es)?|changed designs?|changed mind|missed revisions?|lost revisions?|wrong versions?|approval confusion|remakes?|remade|rework|repeated work|repeated adjustments?|wasted leather|wasted materials?|wasted supplies|delays?|delayed orders?|scattered notes?|lost notes?|missing instructions?)\b/iu.test(value);
    const genericFashionOnly =
      /\b(?:fashion trends?|style trends?|runway|celebrity fashion|wearable technology|smart textile)\b/iu.test(value) &&
      !/\b(?:custom order|measurement|sizing|revision|approval|remake|rework|material selection)\b/iu.test(value);
    return adjacentLeathercraft && workflowFacet && samePain && !genericFashionOnly;
  }

  private static isInstrumentCaseSpecificationRequest(value: string): boolean {
    return (
      /\b(?:instrument case makers?|musical instrument case makers?|custom instrument cases?|bespoke instrument cases?|instrument case workshops?)\b/iu.test(value) &&
      /\b(?:measurements?|instrument shapes?|padding|materials?|hardware|design revisions?|approved specifications?|final approved specifications?|dimensions?|completion deadlines?|customer messages?)\b/iu.test(value)
    );
  }

  private static hasInstrumentCaseIdentity(value: string): boolean {
    const explicitIdentity =
      /\b(?:instrument cases?|instrument case makers?|instrument case builders?|musical instrument cases?|musical instrument case makers?)\b/iu.test(value);
    if (explicitIdentity) return true;

    const caseMakerIdentity =
      /\b(?:case makers?|case builders?|custom cases?|bespoke cases?|case workshop|case workshops?)\b/iu.test(value);
    const musicalIdentity =
      /\b(?:instrument|musical instrument|violin|viola|cello|guitar|double bass|contrabass|brass instrument|woodwind|luthier)\b/iu.test(value);
    return caseMakerIdentity && musicalIdentity;
  }

  private static isInstrumentCaseSpecificationEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value) || !this.hasInstrumentCaseIdentity(value)) {
      return false;
    }

    const workflow =
      /\b(?:measurements?|dimensions?|shape|shapes|fitting|fit|padding|foam|lining|materials?|leather|fabric|wood|hardware|hinges?|latches?|handles?|design revisions?|specifications?|approval|approved|customer sign[- ]?off|completion deadline|delivery deadline|sketches?|photographs?|photos?|templates?)\w*\b/iu.test(value);
    const friction =
      /\b(?:wrong|incorrect|inaccurate|unsuitable|missing|lost|scattered|changed|revision|rework|adjustment|adjustments|waste|wasted|delay|delayed|misfit|poor fit|doesn'?t fit|does not fit|hard to confirm|difficult to confirm)\w*\b/iu.test(value);

    return workflow && friction;
  }

  private static isInstrumentCaseSpecificationSupportingSignal(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value) || !this.hasInstrumentCaseIdentity(value)) {
      return false;
    }

    return /\b(?:measurements?|dimensions?|shape|shapes|fitting|fit|padding|foam|lining|materials?|leather|fabric|wood|hardware|hinges?|latches?|handles?|design revisions?|specifications?|approval|approved|customer review|customer sign[- ]?off|completion deadline|delivery deadline|sketches?|photographs?|photos?|templates?|cutting|assembly)\w*\b/iu.test(value);
  }

  private static isTattooDesignApprovalSupportingSignal(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const tattooActor =
      /\b(?:tattoo|tattoo artist|tattoo artists|tattoo studio|tattoo studios|tattoo shop|tattoo shops|tattooist|tattooists|tattooing)\b/iu.test(value);
    if (!tattooActor) return false;
    const axes = [
      /\b(?:design reference|reference image|placement|size|dimension|color|colour|stencil|revision|approved design|approved version|client approval)\w*\b/iu.test(value),
      /\b(?:appointment|aftercare|client record|consultation|instagram|social media message|dm|direct message|sketch|photo|photograph|handwritten note|version history)\w*\b/iu.test(value),
      /\b(?:wrong|incorrect|lost|missing|scattered|missed|forgotten|outdated|unconfirmed|rework|repeat|confusion|conflict|miscommunication|inconsistent|hard to confirm|difficult to confirm)\w*\b/iu.test(value),
    ];
    return axes.filter(Boolean).length >= 1;
  }

  private static isCustomCraftOrderRequest(value: string): boolean {
    const actor =
      /\b(?:glass artists?|glass artisans?|stained glass artists?|glassblowers?|glass studios?|glass art|leather craft workshops?|leather workshops?|leatherworkers?|leather artisans?|embroidery businesses?|embroidery shops?|embroidery workshops?|embroiderers?|custom embroidery|screen printing shops?|woodworking shops?|woodworking workshops?|woodworkers?|candle makers?|candle artisans?|candle businesses?|soap makers?|soap artisans?|jewelry makers?|jewellery makers?|jewelry artisans?|craft workshops?|craft studios?|artisan workshops?|maker studios?)\b/iu.test(value) ||
      (/\b(?:independent|small|custom|local)?\s*[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3}\s+(?:craft\s+)?(?:workshops?|shops?|studios?|businesses?|makers?|artisans?|artists?)\b/iu.test(value) &&
        /\b(?:custom orders?|commissions?|artwork|materials?|design revisions?|approved specifications?|engraving|stitching|thread colors?|placement instructions?|hardware selections?|fragrance combinations?|wax types?|container sizes?|label designs?|color preferences?|quantities?|delivery deadlines?)\b/iu.test(value));
    const workflow =
      /\b(?:custom orders?|product dimensions?|glass colors?|glass patterns?|customer artwork|leather types?|thread colors?|garment sizes?|stitching styles?|hardware selections?|engraving details?|placement instructions?|design revisions?|approved specifications?|final approved|fragrance combinations?|wax types?|container sizes?|label designs?|color preferences?|quantities?|order quantities?|completion deadlines?|delivery deadlines?)\b/iu.test(value);
    return actor && workflow;
  }

  private static matchesCustomCraftActor(request: string, evidence: string): boolean {
    const knownActorGroups: readonly { readonly request: RegExp; readonly evidence: RegExp }[] = [
      {
        request: /\b(?:glass artists?|glass artisans?|stained glass artists?|glassblowers?|glass studios?|glass art)\b/iu,
        evidence: /\b(?:glass artists?|glass artisans?|stained glass|glassblower|glass blowing|glass studio|glass art|custom glass|glass commission)\b/iu,
      },
      {
        request: /\b(?:leather craft|leather workshop|leatherworker|leather artisan)\b/iu,
        evidence: /\b(?:leather craft|leatherwork|leather workshop|leatherworker|leather artisan|leather shop|leather goods)\b/iu,
      },
      {
        request: /\b(?:embroidery|embroiderer|custom embroidery)\b/iu,
        evidence: /\b(?:embroidery|embroiderer|embroidered|custom embroidery|embroidery shop|embroidery business)\b/iu,
      },
      {
        request: /\b(?:woodworking|woodworker)\b/iu,
        evidence: /\b(?:woodworking|woodworker|woodshop|wood shop|carpentry|carpenter)\b/iu,
      },
      {
        request: /\b(?:screen printing|print shop)\b/iu,
        evidence: /\b(?:screen printing|print shop|garment printing|custom printing)\b/iu,
      },
      {
        request: /\b(?:candle makers?|candle making|candle artisans?|candle businesses?)\b/iu,
        evidence: /\b(?:candle makers?|candle making|candle business|candle shop|candle studio|candle orders?|custom candles?|candlemaker|candlemaking)\b/iu,
      },
      {
        request: /\b(?:soap makers?|soap making|soap artisans?)\b/iu,
        evidence: /\b(?:soap makers?|soap making|soap business|soap shop|custom soap)\b/iu,
      },
      {
        request: /\b(?:jewelry makers?|jewellery makers?|jewelry artisans?|jewellery artisans?)\b/iu,
        evidence: /\b(?:jewelry makers?|jewellery makers?|jewelry business|jewellery business|custom jewelry|custom jewellery)\b/iu,
      },
    ];
    const matchedKnown = knownActorGroups.filter((group) => group.request.test(request));
    if (matchedKnown.length > 0) {
      return matchedKnown.some((group) => group.evidence.test(evidence));
    }

    const actor = RequestDynamicQueryUtil.extractActor(request);
    if (!actor) return false;
    const actorTokens = this.extractTokens(actor);
    const evidenceTokens = this.extractTokens(evidence);
    const usefulActorTokens = [...actorTokens].filter(
      (token) => !/^(?:independent|small|custom|local|business|workshop|shop|studio|craft|maker|makers|artisan|artisans)$/iu.test(token),
    );
    const overlap = usefulActorTokens.filter((token) => evidenceTokens.has(token));
    return overlap.length >= 1;
  }

  private static isDeveloperOnlyEvidence(value: string): boolean {
    const developerMarkers =
      /(?:\b(?:browser\.storage|storage\.local|globalthis|chrome extension|browser extension|javascript|typescript|node\.js|react|webpack|manifest v3|mv3|event listener|addeventlistener|api endpoint|api calls?|source code|code snippet|code review|repository|\brepo\b|github|pull request|unit test|integration test|runtime|stack trace|exception|sdk|polyfill|async calls?|promise returned|global variable|command[- ]line|\bcli\b|readme|ansi|fetchwithtimeout|bun runtime|third[- ]party api|json output flag|xml file|xml layer|package manager|npm package|css class|html element|ui component)\b|\b[\w.-]+\.xml\b|\blayer\.xml\b)/iu.test(value);
    const strongPhysicalIdentity =
      /\b(?:custom order|commission|leather|embroidery|garment|stitching|engraving|measurement|dimension|workshop|repair shop|artisan|craftsperson|maker|candle maker|fragrance maker|shoemaker|shoe cleaner|sneaker cleaner|sneaker cleaning|instrument case|case maker|luthier|fountain pen|nib technician|wig maker|frame shop|framer|tailor|seamstress|dressmaker|restorer|restoration studio|physical sample|pickup deadline)\b/iu.test(value);
    return developerMarkers && !strongPhysicalIdentity;
  }

  private static isCostumeRentalRequest(value: string): boolean {
    return (
      /\b(?:costume rental shops?|costume rentals?|costume shops?|costume hire|wardrobe rentals?)\b/iu.test(value) &&
      /\b(?:customer measurements?|reserved outfits?|accessories|alteration requests?|return dates?|garment condition|special event requirements?|double reservations?|delayed pickups?)\b/iu.test(value)
    );
  }

  private static isCommercialBuildingEnergyRequest(value: string): boolean {
    return /\b(?:commercial buildings?|office buildings?|office complexes?|facilities?|facility teams?|facility managers?|building operators?|building managers?)\b/iu.test(value) &&
      /\b(?:electricity|energy consumption|utility bills?|smart meters?|submeters?|heating|hvac|elevators?|lighting|office equipment|consumption spikes?|abnormal usage|energy waste|equipment downtime)\b/iu.test(value);
  }

  private static isCakeDecoratorRequest(value: string): boolean {
    return (
      /\b(?:cake decorators?|cake decorating|custom cake decorators?|home bakers?|independent bakers?|cake artists?|custom cake businesses?|bakery decorators?)\b/iu.test(value) &&
      /\b(?:custom orders?|design references?|flavors?|flavours?|allergy notes?|allergies|dietary requirements?|cake dimensions?|decoration details?|pickup times?|last[- ]minute revisions?|revision requests?)\b/iu.test(value)
    );
  }

  private static isCalligraphyCommissionRequest(value: string): boolean {
    return /\b(?:calligraphy artists?|calligraphers?|lettering artists?|custom stationery artists?)\b/iu.test(value) &&
      /\b(?:custom orders?|commissions?|wording|lettering styles?|paper selections?|ink preferences?|dimensions?|reference examples?|revision requests?|approved versions?|delivery deadlines?|social media messages?|handwritten notes?)\b/iu.test(value);
  }

  private static isConnectedAssetSecurityRequest(value: string): boolean {
    return /\b(?:farms?|farm operators?|agriculture|factories|industrial plants?|warehouses?|utilities|greenhouses?|irrigation systems?)\b/iu.test(value) &&
      /\b(?:connected devices?|iot|internet of things|sensors?|telemetry|remote monitoring|irrigation controllers?|automated feeding|connectivity failures?|network disruption|unauthorized access|security alerts?|equipment failures?|device behavior)\b/iu.test(value);
  }

  private static isProfessionalEvidenceRecordsRequest(value: string): boolean {
    return /\b(?:appraisers?|valuers?|genealogists?|genealogy researchers?|family historians?|archivists?|researchers?|conservators?|provenance researchers?|auction specialists?|artifact historians?)\b/iu.test(value) &&
      /\b(?:provenance|chain of custody|ownership history|authenticity|valuations?|restoration details?|historical certificates?|family records?|research notes?|source citations?|evidence trail|conflicting records?|scattered records?|auction catalogs?|duplicated research|inconsistent valuations?|missed relationships?)\b/iu.test(value);
  }

  private static isMusicalRepairRequest(value: string): boolean {
    return /\b(?:musical instrument|guitar|violin|piano|piano technician|piano technicians|piano tuner|piano tuners|instrument repair|repair shop|luthier)\b/iu.test(value) &&
      /\b(?:repair|technician|tuner|tuning|tuning history|service history|mechanical problems?|replacement parts?|replaced parts?|customer preferences?|room conditions?|follow[- ]up visits?|maintenance recommendations?|paper invoices?|handwritten notes?|service visits?)\b/iu.test(value);
  }

  private static isMusicalRepairSupportingSignal(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;

    const instrumentActor =
      /\b(?:guitar|guitars|guitar repair|guitar repairs|guitar technician|guitar technicians|luthier|luthiers|instrument repair|instrument repairs|musical instrument repair|repair shop|repair technician)\b/iu.test(
        value,
      );
    if (!instrumentActor) return false;

    /*
     * Merely mentioning a guitar-repair business, a shop opening, a profile,
     * a DIY class, or "how to repair a guitar" is domain context, not evidence
     * for the requester's record/history/workflow pain.
     */
    const promotionalOrExistenceOnly =
      /\b(?:opens?|opened|reopens?|reopened|beloved|anniversary|celebrates?|profile|meet\s+\w+|adds? diy|diy workshop|workshops?|how (?:do|to) (?:build|repair)|repair industry|at the top of (?:his|her|their) game|relaunches?|new business|offering repair services?|local guitar shops?)\b/iu.test(
        value,
      );

    const workflow =
      /\b(?:service history|repair history|previous repairs?|previous service|service records?|repair records?|work orders?|repair tickets?|intake records?|bench notes?|technician notes?|setup preferences?|customer preferences?|fret wear|neck adjustments?|neck relief|truss rod|electronic problems?|electronics?|replacement parts?|parts tracking|instrument condition|condition photos?|photographs?|photos?|receipts?|customer messages?|service status|repair status|measurements?)\w*\b/iu.test(
        value,
      );

    const pain =
      /\b(?:lost|missing|missed|forgotten|forget|scattered|fragmented|paper notes?|handwritten|paper receipts?|wrong|incorrect|mix(?:ed)? up|misplaced|repeated inspection|repeated inspections|repeat inspection|repeat work|rework|unnecessary repair|unnecessary repairs|inconsistent|difficult to track|hard to track|cannot track|can'?t track|tracking problem|not tracked|unclear|outdated|duplicate|duplicated|delay|delayed|miscommunication)\b/iu.test(
        value,
      );

    if (!workflow || !pain) return false;
    if (promotionalOrExistenceOnly && !pain) return false;
    return true;
  }

  private static isMunicipalDeviceSecurityRequest(value: string): boolean {
    return /\b(?:smart cit(?:y|ies)|municipal|city technology|public services?|traffic lights?|parking sensors?|public cameras?|environmental monitors?)\b/iu.test(value) &&
      /\b(?:security|unauthorized|outdated|compromised|device behavior|connected devices?|iot|firmware|security standards?)\b/iu.test(value);
  }

  private static isShoeRepairRequest(value: string): boolean {
    return /\b(?:shoe repair shop|shoe repair shops|shoe repair|cobbler|cobblers|cobbler shop|cobbler shops)\b/iu.test(value) &&
      /\b(?:repair|paper tickets?|customer items?|technician notes?|material choices?|payment status|collection dates?|pickup dates?|misplaced shoes?|incorrect repairs?)\b/iu.test(value);
  }

  private static isAcademicSecurityRequest(value: string): boolean {
    return /\b(?:school|schools|university|universities|learning platform|learning platforms|learning management system|lms|online assessment|online assessments|online exam|online exams)\b/iu.test(value) &&
      /\b(?:security|suspicious|login records?|account activity|account takeover|academic misuse|academic integrity|anomal|security alerts?|false positive)\w*\b/iu.test(value);
  }

  private static isManufacturingCostProfitabilityRequest(value: string): boolean {
    const request = this.normalize(value);
    const actor =
      /\b(?:manufacturing companies?|manufacturers?|manufacturing plants?|factories|factory|industrial plants?|production lines?|plant operations?)\b/iu.test(
        request,
      );
    const costDrivers =
      /\b(?:production costs?|raw material expenses?|raw material costs?|material costs?|machine downtime|downtime costs?|labor costs?|labour costs?|defect rates?|scrap rates?|maintenance spending|maintenance costs?|supplier prices?|supplier costs?|cost variance|cost forecasts?|profitability|production stage costs?)\w*\b/iu.test(
        request,
      );
    const decisionFriction =
      /\b(?:stable output|output remains stable|analy[sz](?:e|ed|ing)? separately|separate systems?|fragmented|siloed|production stages?|reducing profitability|unnecessary spending|inaccurate cost forecasts?|delayed decisions?|operational improvements?|cost drivers?)\w*\b/iu.test(
        request,
      );
    return actor && costDrivers && decisionFriction;
  }

  private static isManufacturingCostProfitabilitySupportingEvidence(
    value: string,
  ): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const manufacturingIdentity =
      /\b(?:manufacturing|manufacturer|manufacturers|factory|factories|industrial production|production line|production lines|shop floor|plant operations|just[- ]in[- ]time manufacturing|smart manufacturing)\b/iu.test(
        evidence,
      );
    const adjacentSupplyChainIdentity =
      /\b(?:supply chain|logistics|fulfillment|fulfilment|warehouse|warehousing|inventory|freight|shipping|shipment|shipments|distribution|3pl|third[- ]party logistics|procurement|supplier|suppliers|landed cost)\w*\b/iu.test(
        evidence,
      );
    const costOrLossDriver =
      /\b(?:production costs?|manufacturing costs?|cost per unit|cost variance|cost overrun|raw material variability|raw material costs?|material costs?|supplier prices?|supplier costs?|supplier delays?|inventory shortages?|inventory carrying costs?|inventory holding costs?|storage costs?|warehouse costs?|freight costs?|shipping costs?|transportation costs?|landed costs?|hidden fees?|cash tied up|working capital|delivery delays?|machine downtime|downtime|labor costs?|labour costs?|defect rates?|quality defects?|scrap rates?|scrap|rework|maintenance spending|maintenance costs?|bottleneck|bottlenecks|yield loss|productivity loss|margin|profitability)\w*\b/iu.test(
        evidence,
      );
    const financialImpact =
      /\b(?:cost|costs|expense|expenses|profit|profitability|margin|margins|cash|working capital|payback|roi|return on investment|landed cost|financial impact|financial loss|financial losses)\w*\b/iu.test(
        evidence,
      );
    const analysisOrPressure =
      /\b(?:bottleneck analysis|bottleneck management|reduction of bottleneck|cost analysis|cost driver|variance|variability|uncertain|increase|rising|higher|reduce|reduction|efficien|inefficien|optimization|optimisation|profit|margin|planning|sequencing|root cause|data[- ]driven|compare|comparison|trade[- ]off|cash cycle|delivery window|inventory days?|total cost)\w*\b/iu.test(
        evidence,
      );
    const unrelatedOnly =
      /\b(?:cybersecurity|security breach|malware|phishing|raw material test methods?|sustainable raw material alternatives?|bacterial cellulose|fashion sustainability)\b/iu.test(
        evidence,
      ) &&
      !/\b(?:cost|bottleneck|downtime|defect|scrap|supplier|profitability|variance)\w*\b/iu.test(
        evidence,
      );

    const directManufacturingSupport =
      manufacturingIdentity &&
      costOrLossDriver &&
      (analysisOrPressure || financialImpact);
    const crossDomainMechanismSupport =
      adjacentSupplyChainIdentity &&
      costOrLossDriver &&
      financialImpact &&
      (analysisOrPressure ||
        /\b(?:delay|shortage|storage|warehouse|freight|shipping|transport|inventory|supplier)\w*\b/iu.test(
          evidence,
        ));

    return (directManufacturingSupport || crossDomainMechanismSupport) && !unrelatedOnly;
  }

  private static isHealthcareSupplyCostEfficiencyRequest(value: string): boolean {
    const request = this.normalize(value);
    return /\b(?:healthcare networks?|health systems?|hospital networks?|hospital systems?|hospitals?|clinics?|medical centers?)\b/iu.test(request) &&
      /\b(?:procurement|emergency purchases?|emergency orders?|medical inventory|supply inventory|expired supplies?|inventory expiration|stock distribution|inventory imbalance|inter[- ]facility transfers?|transfer activity|supplier invoices?|usage data|transportation costs?|delivery costs?)\b/iu.test(request) &&
      /\b(?:operating expenses?|operating costs?|unnecessary costs?|excess inventory|avoidable emergency orders?|inefficient transfers?|budget|budgeting|cost attribution|financial expenses?)\b/iu.test(request);
  }

  private static isHealthcareSupplyCostEfficiencySupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;
    const healthcare = /\b(?:healthcare|health system|hospital|hospitals|clinic|clinics|medical center|hospital pharmacy|pharmacy department)\b/iu.test(evidence);
    const supply = /\b(?:procurement|purchasing|purchase order|emergency purchase|emergency order|medical suppl(?:y|ies)|inventory|stockout|stock[- ]out|overstock|excess stock|expired inventory|expired suppl(?:y|ies)|expiration|expiry|inter[- ]facility transfer|inventory transfer|stock redistribution|supplier invoice|transportation cost|delivery cost|logistics cost)\w*\b/iu.test(evidence);
    const impact = /\b(?:cost|expense|spend|budget|financial|waste|loss|avoidable|emergency|inefficien|overstock|excess inventory|expired|stockout)\w*\b/iu.test(evidence);
    const wrong = /\b(?:salary|career|resume|cv|job application|how much would i make|diagnostic accuracy|disease detection|treatment efficacy)\b/iu.test(evidence) && !/\b(?:inventory|procurement|supply|stock|cost)\w*\b/iu.test(evidence);
    return healthcare && supply && impact && !wrong;
  }

  private static isHealthcareSupplyCostEfficiencyDirectEvidence(value: string): boolean {
    if (!this.isHealthcareSupplyCostEfficiencySupportingEvidence(value)) return false;
    const evidence = this.normalize(value);
    return /\b(?:separate systems?|silo|fragmented|excess inventory|expired|stockout|emergency order|emergency purchase|unnecessary cost|avoidable cost|inefficient transfer|inventory imbalance|uneven stock|budget variance|waste|delay|shortage|overstock)\w*\b/iu.test(evidence);
  }

  private static isHospitalCostResourceEfficiencyRequest(value: string): boolean {
    const request = this.normalize(value);
    return /\b(?:private hospitals?|hospitals?|hospital systems?|medical centers?)\b/iu.test(request) &&
      /\b(?:staffing expenses?|staffing costs?|medical supply usage|supply costs?|patient volumes?|insurance reimbursements?|treatment costs?|department costs?|budget|profitability|financial inefficien|resource allocation|resource consumption|cost efficiency|cost-efficiency)\w*\b/iu.test(request);
  }

  private static isHospitalCostResourceEfficiencySupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;
    const hospital = /\b(?:hospital|hospitals|healthcare|medical center|operating room|operating rooms|surgical suite|surgical suites|surgery|surgical)\b/iu.test(evidence);
    const resourceOrCost = /\b(?:resource utilization|resource allocation|staffing|staffing cost|staffing expense|medical suppl(?:y|ies)|supply usage|supply cost|patient volume|treatment cost|service cost|department cost|insurance reimbursement|reimbursement|budget|cost variance|cost efficiency|cost-efficiency|financial efficiency|profitability|operating cost|operating expense|productivity|utilization)\w*\b/iu.test(evidence);
    const efficiencyOrPressure = /\b(?:efficien|inefficien|optimi[sz]|variance|higher cost|rising cost|resource consumption|utilization|overutili[sz]|underutili[sz]|productivity|allocation|budget|profit|margin|delay|bottleneck|waste|expense)\w*\b/iu.test(evidence);
    const unrelatedClinicalOnly = /\b(?:diagnosis|diagnostic accuracy|disease detection|clinical diagnosis|treatment efficacy)\b/iu.test(evidence) && !resourceOrCost;
    return hospital && resourceOrCost && efficiencyOrPressure && !unrelatedClinicalOnly;
  }

  private static isShoeDyeingServiceRequest(value: string): boolean {
    const request = this.normalize(value);
    return /\b(?:shoe dyeing|shoe dye service|shoe restoration|footwear restoration|leather recoloring|leather dyeing|shoe refinishing|sneaker restoration|cobbler)\b/iu.test(request) &&
      /\b(?:color|colour|shade|finish|treatment|material|damage|pickup|rework|customer)\w*\b/iu.test(request);
  }

  private static isShoeDyeingSupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;
    const service = /\b(?:shoe dye|shoe dyeing|shoe restoration|footwear restoration|leather recolor|leather recoloring|leather dye|leather dyeing|shoe refinishing|sneaker restoration|cobbler|shoe repair shop|leather repair shop)\w*\b/iu.test(evidence);
    const workflow = /\b(?:requested shade|color match|colour match|color sample|colour sample|finish preference|previous treatment|treatment history|material|leather|suede|damage note|customer instruction|customer preference|pickup|deadline|approved color|approved colour|color formula|dye formula)\w*\b/iu.test(evidence);
    const pain = /\b(?:mismatch|mismatched|wrong color|wrong colour|incorrect shade|wrong treatment|unsuitable treatment|damage|damaged|rework|repeat work|repeated work|lost note|missing note|forgotten|delay|delayed|hard to match|difficult to match|inconsistent)\w*\b/iu.test(evidence);
    const diyOnly = /\b(?:diy|how to dye|tutorial|at home|home method|step by step)\b/iu.test(evidence) && !/\b(?:customer|client|shop|specialist|service|repair shop|restoration shop)\b/iu.test(evidence);
    return service && workflow && pain && !diyOnly;
  }

  private static isHospitalOperatingRoomCoordinationRequest(
    value: string,
  ): boolean {
    return (
      /\b(?:hospital|hospitals|healthcare|medical center|medical centers)\b/iu.test(value) &&
      /\b(?:operating rooms?|operating theatres?|operating theaters?|surgical suites?|surgery schedules?|surgical schedules?|surgeries|procedures)\b/iu.test(value) &&
      /\b(?:medical staff|staffing|surgeons?|nurses?|equipment availability|urgent patients?|emergency cases?|resource allocation|room turnover|reschedul|idle operating rooms?|delayed procedures?|schedule conflicts?)\w*\b/iu.test(value)
    );
  }

  private static isHospitalOperatingRoomCoordinationEvidence(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const setting =
      /\b(?:hospital|hospitals|operating room|operating rooms|operating theatre|operating theater|surgical suite|surgical suites|surgery|surgeries|surgical|procedure|procedures)\b/iu.test(value);
    const coordinationAxis =
      /\b(?:surgery schedule|surgical schedule|operating room schedule|staff availability|medical staff|staffing|surgeon|nurse|equipment availability|emergency case|urgent patient|resource allocation|room turnover|reschedul|repriorit|schedule conflict|operating room utilization)\w*\b/iu.test(value);
    const frictionAxis =
      /\b(?:delay|delayed|postpone|postponed|cancel|cancelled|canceled|idle|underutilized|overworked|overload|shortage|unavailable|conflict|bottleneck|disruption|waiting|inefficient|resource constraint|capacity constraint)\w*\b/iu.test(value);
    const supplyOnlyCollision =
      /\b(?:pharmacy inventory|medical supplies?|blood products?|supplier delivery|supply chain)\b/iu.test(value) &&
      !/\b(?:operating room|surgery|surgical|procedure|staffing|staff availability|equipment availability)\b/iu.test(value);
    return setting && coordinationAxis && frictionAxis && !supplyOnlyCollision;
  }

  private static isHospitalOperatingRoomCoordinationSupportingSignal(
    value: string,
  ): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const orSpecificSetting =
      /\b(?:operating room|operating rooms|operating theatre|operating theater|surgical suite|surgical suites|surgery|surgeries|surgical)\b/iu.test(value);
    const hospitalSetting = /\b(?:hospital|hospitals|healthcare)\b/iu.test(value);
    const coordinationAxis =
      /\b(?:surgery schedule|surgical schedule|operating room schedule|staff availability|medical staff|staffing|surgeon|nurse|equipment availability|emergency case|urgent patient|resource allocation|room turnover|reschedul|repriorit|schedule conflict|operating room utilization)\w*\b/iu.test(value);
    const frictionAxis =
      /\b(?:delay|delayed|postpone|cancel|idle|underutilized|overworked|shortage|unavailable|conflict|bottleneck|disruption|waiting|inefficient|capacity constraint)\w*\b/iu.test(value);
    const supplyOnlyCollision =
      /\b(?:pharmacy inventory|medical supplies?|blood products?|supplier delivery|supply chain)\b/iu.test(value) &&
      !orSpecificSetting;
    if (supplyOnlyCollision) return false;
    return (
      (orSpecificSetting && (coordinationAxis || frictionAxis)) ||
      (hospitalSetting && coordinationAxis)
    );
  }

  private static isHospitalEquipmentTrackingRequest(value: string): boolean {
    const remoteMonitoring = this.isHomeRemoteMedicalDeviceTrustRequest(value);
    return !remoteMonitoring &&
      /\b(?:hospital|hospitals|biomedical engineering|clinical engineering)\b/iu.test(value) &&
      /\b(?:equipment tracking|device tracking|asset tracking|equipment location|maintenance status|equipment availability|device availability|utilization|departmental movement|storage rooms?|operating rooms?|searching for equipment|locating equipment)\b/iu.test(value);
  }

  private static isAthleteRecoveryRequest(value: string): boolean {
    return /\b(?:sports clubs?|rehabilitation centers?|rehab centers?|athletes?|sports medicine|physiotherapists?|physical therapists?)\b/iu.test(value) &&
      /\b(?:injury|injuries|recovery|rehabilitation|training loads?|pain reports?|mobility measurements?|performance data|return to play|return-to-play|reinjury|re-injury)\b/iu.test(value);
  }

  private static isExactPictureFrameRestorationEvidenceIdentity(value: string): boolean {
    const evidence = this.normalize(value);
    const explicitFrameObject =
      /\b(?:picture frame|picture-frame|antique picture frame|antique frame|gilded frame|ornate picture frame|art frame|painting frame|frame conservator|frame conservation|picture frame restoration|picture frame repair|frame restorer|picture frame restorer)\b/iu.test(evidence);
    const restorationWorkflow =
      /\b(?:restor\w*|conserv\w*|repair\w*|condition|treatment|gild\w*|finish\w*|overpaint\w*|decorative|molding|moulding|gesso|gold leaf|material|previous repair|repair history)\b/iu.test(evidence);
    const architecturalCollision =
      /\b(?:door|doors|doorway|entrance door|vestibule|transom|window frame|window|building entrance|architectural woodwork|door leaf|door leaves|door closer|electric bolt|espagnolette)\b/iu.test(evidence) &&
      !/\b(?:picture frame|antique frame|gilded frame|art frame|painting frame)\b/iu.test(evidence);
    const technicalCollision =
      /\b(?:in-plane shear|shear test|composite materials?|finite element|mechanical test|test specimen|digital photo frame|frame rate|iframe|css frame|video frame)\b/iu.test(evidence);
    return explicitFrameObject && restorationWorkflow && !architecturalCollision && !technicalCollision;
  }

  private static isPublicEducationResourceAllocationRequest(value: string): boolean {
    return /\b(?:public education authorities?|education authorities?|school districts?|education departments?|ministr(?:y|ies) of education|public school systems?|public schools?)\b/iu.test(value) &&
      /\b(?:teachers?|staffing|learning resources?|intervention programs?|enrollment|attendance|assessment results?|school reports?|resource distribution|resource allocation|overcrowded classrooms?|education spending)\b/iu.test(value);
  }

  private static isPublicEducationResourceAllocationSupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (this.isDeveloperOnlyEvidence(evidence)) return false;
    const educationIdentity = /\b(?:public schools?|school districts?|education authorities?|education department|education activity|secondary schools?|students?|school system|education management information system|emis)\b/iu.test(evidence);
    const allocationFacet = /\b(?:allocation of resources?|resource allocation|resource distribution|funding allocation|staffing levels?|staff shortage|teacher shortage|additional teachers?|learning resources?|students? needs?|overcrowded classrooms?)\b/iu.test(evidence);
    const dataFacet = /\b(?:education management information system|emis|student records?|school records?|enrollment|attendance|assessment|tracking of students? records?|school performance data|early warning)\b/iu.test(evidence);
    const problemSignal = /\b(?:need|needs|shortage|gap|uneven|inequit|overcrowd|delay|delayed|improved allocation|better meet|difficult|fragmented|separate systems?|tracking|understaff|insufficient|lack of resources?)\w*\b/iu.test(evidence);
    return educationIdentity && problemSignal && (allocationFacet || dataFacet);
  }

  private static isFrameRestorationWorkflowRequest(value: string): boolean {
    return /\b(?:independent )?(?:frame restoration specialists?|picture frame restoration specialists?|picture frame restorers?|frame restorers?|antique frame restorers?|gilded frame restorers?|frame conservation specialists?|picture frame restoration workshops?|frame restoration workshops?)\b/iu.test(value) &&
      /\b(?:damaged frames?|material selections?|decorative details?|repair notes?|finish preferences?|customer approvals?|approved restoration|completion dates?|promised completion dates?|photographs?|handwritten notes?|physical samples?|incorrect finishes?|repeated repairs?|lost design details?|wasted materials?|delayed customer orders?)\b/iu.test(value);
  }

  private static isArtRestorationWorkflowRequest(value: string): boolean {
    return /\b(?:art restoration workshops?|art restoration|art conservation|conservation workshops?|conservation studios?|art conservators?|painting restoration|artifact conservation)\b/iu.test(value) &&
      /\b(?:condition|previous repairs?|treatment history|materials used|client instructions?|restoration stages?|delivery deadlines?|photographs?|handwritten notes?|documentation|records?)\b/iu.test(value);
  }

  private static isEvChargingInfrastructureRequest(value: string): boolean {
    return /\b(?:cities|city governments?|municipalities|municipal governments?|smart cities|public infrastructure|urban infrastructure)\b/iu.test(value) &&
      /\b(?:electric vehicle charging|ev charging|charging stations?|charging infrastructure)\b/iu.test(value) &&
      /\b(?:financial sustainability|electricity costs?|station usage|utilization|maintenance expenses?|payment revenue|revenue|neighborhood demand|peak[- ]hour activity|future demand|underperforming locations?|capacity|investment decisions?|operating costs?)\b/iu.test(value);
  }

  private static isEvChargingInfrastructureSupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const evIdentity =
      /\b(?:electric vehicle charging|ev charging|charging station|charging stations|charging infrastructure|public chargers?|public charging)\b/iu.test(evidence);
    if (!evIdentity) return false;

    const demandCapacityPain =
      /\b(?:waiting times?|queue lengths?|overcrowd|congestion|peak periods?|peak[- ]hour|utilization|underutilized|underperforming|inefficient use|capacity shortage|capacity gap|additional capacity|demand forecasting|forecasting demand|future demand|charging demand|placement|siting|coverage gaps?|poorly placed|location planning)\w*\b/iu.test(evidence);
    const financialPain =
      /\b(?:electricity costs?|energy costs?|operating costs?|maintenance costs?|maintenance expenses?|payment revenue|revenue|income|profitability|financial sustainability|return on investment|\broi\b|margin|tariffs?|cost recovery|investment efficiency|economic criterion)\w*\b/iu.test(evidence);
    if (!demandCapacityPain && !financialPain) return false;

    const genericAnnouncement =
      /\b(?:partners? with|raises? [€$₹]?\d|funding round|investment announcement|expansion completed|charging revolution|launches?|introduces?|conductive charging system|technical standard|market size|cagr)\b/iu.test(evidence) &&
      !/\b(?:waiting|queue|utilization|underperform|capacity|demand|forecast|cost|maintenance|revenue|income|profit|financial|siting|placement|coverage gap)\w*\b/iu.test(evidence);
    return !genericAnnouncement;
  }

  private static isProfessionalInterpretationAgencyRequest(value: string): boolean {
    return /\b(?:sign language interpretation agenc(?:y|ies)|sign language interpreting agenc(?:y|ies)|asl interpretation agenc(?:y|ies)|asl interpreting agenc(?:y|ies)|interpretation agenc(?:y|ies)|interpreting agenc(?:y|ies)|language service providers?|interpreter agencies?)\b/iu.test(value) &&
      /\b(?:interpreter availability|assignment details?|assignment matching|client communication preferences?|specialized vocabulary|session notes?|last[- ]minute schedule changes?|scheduling conflicts?|missed preferences?|client requirements?)\b/iu.test(value);
  }

  private static isProfessionalInterpretationAgencySupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const interpretationIdentity =
      /\b(?:sign language interpreters?|asl interpreters?|interpreters?|interpreting services?|interpretation services?|interpreter agenc(?:y|ies)|interpreting agenc(?:y|ies)|language service providers?|court interpreters?)\b/iu.test(evidence);
    if (!interpretationIdentity) return false;

    const operationsPain =
      /\b(?:interpreter shortage|shortage of interpreters|availability|unavailable|scheduling conflict|double booking|double-book|missed assignment|assignment matching|assignment allocation|last[- ]minute change|last[- ]minute cancellation|schedule change|cancellation|client preference|communication preference|specialized vocabulary|subject matter|session notes?|assignment details?|dispatcher|coordination|coordination problem|staffing pressure)\w*\b/iu.test(evidence);
    if (!operationsPain) return false;

    const consumerAppCollision =
      /\b(?:translator app|learn asl|learning asl|camera translator|camera translation|mobile app|app crash|clock[- ]?in|time clock|password reset|login problem|jailbroken|trade board|shift app)\b/iu.test(evidence) &&
      !/\b(?:interpretation agenc|interpreting agenc|interpreter service|dispatcher|client assignment|assignment matching)\w*\b/iu.test(evidence);
    return !consumerAppCollision;
  }

  private static isRestaurantEnergySupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const restaurantActor =
      /\b(?:restaurants?|restaurant chains?|commercial kitchens?|restaurant kitchens?|food service kitchens?|restaurant operators?|restaurant managers?|foodservice operators?|hospitality restaurants?)\b/iu.test(evidence);
    if (!restaurantActor) return false;

    const equipmentOrUtility =
      /\b(?:energy|electricity|utility bills?|utility costs?|refrigeration|refrigerators?|freezers?|hvac|ventilation|cooking equipment|ovens?|grills?|kitchen equipment|equipment maintenance|equipment failures?|food spoilage|food waste|ingredient waste|power consumption|energy consumption)\b/iu.test(evidence);
    if (!equipmentOrUtility) return false;

    const costOrOperationalPressure =
      /\b(?:rising|higher|high|increase|increasing|cost|costs|expense|expenses|financial|profit|margin|efficien|inefficien|waste|wasted|spoilage|failure|failures|maintenance|breakdown|downtime|saving|savings|reduce|reducing|performance|operating)\w*\b/iu.test(evidence);
    if (!costOrOperationalPressure) return false;

    const broadEnergyNews =
      /\b(?:iran war|hormuz|national energy crisis|countrywide energy crisis|data centers?|university apartment buildings?|greenhouse gas emissions|christmas markets?|global market size|market research report|smart kitchens business analysis report|panasonic establishes|solar carport)\b/iu.test(evidence);
    if (broadEnergyNews && !/\b(?:restaurant|commercial kitchen|food service)\b/iu.test(evidence)) {
      return false;
    }

    const pureMarketing =
      /\b(?:redefines|industry[- ]first|launches?|introduces?|market size|cagr|business analysis report|available through|helps restaurants improve consistency)\b/iu.test(evidence) &&
      !/\b(?:rising costs?|utility costs?|financial lever|maintenance|failure|food waste|energy costs?|operating costs?)\b/iu.test(evidence);
    return !pureMarketing;
  }

  private static isSneakerCleaningServiceRequest(value: string): boolean {
    return /\b(?:sneaker(?: and shoe)? cleaning specialists?|shoe cleaning specialists?|sneaker cleaners?|shoe cleaners?|sneaker restoration|shoe restoration|sneaker cleaning shops?|shoe cleaning shops?)\b/iu.test(value) &&
      /\b(?:customer items?|material types?|stain conditions?|cleaning preferences?|previous treatments?|repair notes?|pickup deadlines?|service history|handwritten tags?|receipts?|customer messages?|misplaced items?|repeated treatments?|forgotten requests?)\b/iu.test(value);
  }

  private static isSneakerCleaningSupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const serviceActor =
      /\b(?:sneaker cleaning|shoe cleaning|sneaker cleaner|shoe cleaner|sneaker restoration|shoe restoration|footwear cleaning|footwear restoration|shoe care service|sneaker care service)\b/iu.test(evidence);
    if (!serviceActor) return false;

    const workflow =
      /\b(?:customer shoes?|customer items?|pairs?|material|suede|leather|stain|cleaning preference|treatment|treatment history|service history|repair notes?|paper tags?|handwritten tags?|receipts?|customer messages?|pickup|deadline|intake|order ticket|job ticket)\w*\b/iu.test(evidence);
    const friction =
      /\b(?:lost|misplaced|mixed up|forgotten|missing|scattered|paper|handwritten|wrong|incorrect|unsuitable|repeated|repeat treatment|delayed|late pickup|damage|damaged|hard to track|difficult to track|tracking problem)\w*\b/iu.test(evidence);
    if (!workflow || !friction) return false;

    const consumerCleaningContent =
      /\b(?:how to clean|clean at home|household ingredients|best cleaner|best polish|hands[- ]on review|product review|cleaner test|shoe store|sneaker release)\b/iu.test(evidence) &&
      !/\b(?:shop|business|service|specialist|cleaner|restoration)\b/iu.test(evidence);
    return !consumerCleaningContent;
  }

  private static isEyeglassFrameRepairRequest(value: string): boolean {
    return /\b(?:eyeglass(?: frame)? repair specialists?|eyewear repair specialists?|optical frame repair specialists?|spectacle frame repair specialists?|glasses repair specialists?|eyeglass repair shops?|optical repair shops?)\b/iu.test(value) &&
      /\b(?:frame damage|previous repairs?|repair history|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|customer fit|adjustment notes?|repeated adjustments?|pickup dates?|customer pickups?|promised pickup)\b/iu.test(value);
  }

  private static isEyeglassFrameRepairSupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const eyeglassIdentity =
      /\b(?:eyeglass(?:es)?|eyewear|optical frames?|spectacle frames?|glasses frames?|glasses repair|eyeglass repair|optical repair)\b/iu.test(evidence);
    if (!eyeglassIdentity) return false;

    const repairFacet =
      /\b(?:frame damage|damaged frame|repair history|previous repair|hinge|hinges|replacement part|replacement parts|temple|nose pad|bridge repair|screw|hardware|color matching|colour matching|finish matching|frame repair)\w*\b/iu.test(evidence);
    const fitFacet =
      /\b(?:fit preference|customer fit|fitting|adjustment|adjustment note|repeated adjustment|alignment|comfort|temple adjustment|nose pad adjustment)\w*\b/iu.test(evidence);
    const recordOrPickupFacet =
      /\b(?:repair record|service history|repair notes?|handwritten notes?|receipts?|customer messages?|scattered records?|lost notes?|pickup date|promised pickup|delayed pickup|repair status|job ticket|work order)\w*\b/iu.test(evidence);

    const leatherCollision =
      /\b(?:leather bag|leather goods|handbag repair|shoe repair|leather matching|leather stitching)\b/iu.test(evidence) &&
      !eyeglassIdentity;
    if (leatherCollision) return false;

    return repairFacet || fitFacet || recordOrPickupFacet;
  }

  private static isEyeglassFrameRepairEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!this.isEyeglassFrameRepairSupportingEvidence(evidence)) return false;

    const repairFacet =
      /\b(?:frame damage|damaged frame|repair history|previous repair|hinge|replacement part|color matching|colour matching|frame repair)\w*\b/iu.test(evidence);
    const workflowFacet =
      /\b(?:fit preference|customer fit|adjustment|repair record|service history|repair notes?|pickup date|promised pickup|customer pickup|work order|job ticket)\w*\b/iu.test(evidence);
    const friction =
      /\b(?:wrong|incorrect|mismatch|forgotten|missing|lost|scattered|repeated|repeat|delayed|late|inconsistent|hard to track|difficult to track|incomplete|overlooked|miscommunication)\w*\b/iu.test(evidence);

    return repairFacet && workflowFacet && friction;
  }

  private static isAgriculturalDistributionProfitabilityRequest(value: string): boolean {
    return /\b(?:agricultural distributors?|agriculture distributors?|produce distributors?|fresh produce distributors?|crop distributors?|farm produce distributors?|agricultural wholesalers?|produce wholesalers?)\b/iu.test(value) &&
      /\b(?:storage losses?|storage costs?|warehouse costs?|transportation delays?|transport delays?|delivery delays?|delivery costs?|transportation costs?|market prices?|price fluctuations?|price volatility|spoilage|harvest records?|warehouse inventory|shipment activity|financial expenses?|crop profitability|product profitability|profit margins?|route profitability|pricing decisions?)\b/iu.test(value);
  }

  private static isAgriculturalDistributionProfitabilitySupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const foreignFinanceCollision =
      /\b(?:stock market|equity market|asset pricing|business cycle|security prices?|financial market liquidity|vehicle pricing|rail market)\b/iu.test(evidence) &&
      !/\b(?:agricultur|crop|produce|farm|postharvest|food distribution)\w*\b/iu.test(evidence);
    const energyCollision =
      /\b(?:hydrogen distribution|energy storage|battery storage|electricity storage)\b/iu.test(evidence) &&
      !/\b(?:agricultur|crop|produce|farm|postharvest)\w*\b/iu.test(evidence);
    if (foreignFinanceCollision || energyCollision) return false;

    const agricultureContext =
      /\b(?:agricultural|agriculture|crop|crops|produce|fresh produce|farm produce|postharvest|post-harvest|agricultural market|produce market|palm oil|tomato|fruit|vegetable|grain|cereal)\b/iu.test(evidence);
    const distributionContext =
      /\b(?:distributor|distribution|wholesale|wholesaler|supply chain|farm-to-market|market chain|warehouse|storage|shipment|transport|transportation|delivery|route|logistics|postharvest)\w*\b/iu.test(evidence);
    const financialFacet =
      /\b(?:profitability|profit margins?|margin|revenue|financial loss|economic loss|costs?|expenses?|pricing|price volatility|market price|price fluctuation|route profitability|gross margin|net margin)\w*\b/iu.test(evidence);
    const lossOrDecisionFacet =
      /\b(?:spoilage|spoil|postharvest loss|storage loss|transport delay|delivery delay|higher cost|rising cost|losses?|poor pricing|pricing decision|inefficient route|waste|wasted|inventory loss|quality loss)\w*\b/iu.test(evidence);
    const adjacentLogisticsContext =
      /\b(?:3pl|third[- ]party logistics|fulfillment|warehouse|freight|carrier|shipping|shipment|transport|delivery|distribution|route|inventory storage|storage fees?|landed cost)\w*\b/iu.test(evidence);
    const explicitEconomicMechanism =
      /\b(?:profitability|profit margins?|gross margin|net margin|margin erosion|cost per order|all[- ]in cost|landed cost|storage fees?|warehouse costs?|freight costs?|carrier costs?|shipping costs?|delivery costs?|higher cost|rising cost|financial loss|economic loss)\w*\b/iu.test(evidence);

    const agricultureSupport =
      agricultureContext && distributionContext && financialFacet &&
      (lossOrDecisionFacet || /\b(?:profitability|margin|economic loss|financial loss)\b/iu.test(evidence));

    /*
     * Explicitly selected Logistics/Finance evidence may support one causal
     * facet without pretending to prove the agricultural actor itself.  Keep
     * this lane narrow: adjacent evidence must connect a real logistics
     * operation to an economic mechanism, not merely mention a delayed parcel.
     */
    const adjacentEconomicFriction =
      lossOrDecisionFacet ||
      /\b(?:above target|over budget|budget benchmark|make the math work|cannot afford|can't afford|too expensive|cost pressure|margin pressure|forcing (?:a )?(?:route|carrier|warehouse|fulfillment|pricing) change|forced (?:a )?(?:route|carrier|warehouse|fulfillment|pricing) change)\b/iu.test(evidence);
    const adjacentCrossDomainSupport =
      !agricultureContext && adjacentLogisticsContext && financialFacet &&
      explicitEconomicMechanism && adjacentEconomicFriction;

    return agricultureSupport || adjacentCrossDomainSupport;
  }

  private static isAgriculturalDistributionProfitabilityEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!this.isAgriculturalDistributionProfitabilitySupportingEvidence(evidence)) {
      return false;
    }
    const distributorIdentity =
      /\b(?:agricultural distributor|produce distributor|fresh produce distributor|crop distributor|farm produce distributor|agricultural wholesaler|produce wholesaler)\w*\b/iu.test(evidence);
    const operationalFacet =
      /\b(?:storage|warehouse|inventory|spoilage|transport|transportation|delivery|shipment|route|market price|price volatility|price fluctuation)\w*\b/iu.test(evidence);
    const profitabilityFacet =
      /\b(?:profitability|profit margin|margin|financial loss|economic loss|pricing decision|route profitability|crop profitability|product profitability)\w*\b/iu.test(evidence);
    const friction =
      /\b(?:delay|delayed|loss|losses|spoilage|waste|wasted|higher cost|rising cost|fragmented|siloed|separate systems?|reviewed separately|difficult|hard to determine|inaccurate|poor pricing|inefficient)\w*\b/iu.test(evidence);
    return distributorIdentity && operationalFacet && profitabilityFacet && friction;
  }

  private static isAgriculturalExportProfitabilityRequest(value: string): boolean {
    return /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export(?:ers?| companies?| businesses?))\b/iu.test(value) &&
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|changing market prices?|market prices?|product spoilage|produce spoilage|shipment profitability|profit margins?|profit estimates?|harvest records?|delivery schedules?|supplier payments?|sales revenues?|financial losses?|route profitability|distribution stages?)\b/iu.test(value);
  }

  private static isAgriculturalExportProfitabilitySupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!evidence || this.isDeveloperOnlyEvidence(evidence)) return false;

    const produceExportContext =
      /\b(?:agricultural exports?|agricultural exporters?|produce exports?|produce exporters?|fresh produce exports?|fresh produce exporters?|fruit exports?|fruit exporters?|vegetable exports?|vegetable exporters?|perishable produce|perishable goods|cold chain|produce shipments?|produce logistics|farm-to-market|postharvest|post-harvest)\b/iu.test(evidence);

    const logisticsFacet =
      /\b(?:transport(?:ation)? delays?|delivery delays?|storage|cold chain|warehouse|shipment|shipping|distribution|route|logistics|spoilage|spoiled|quality loss|temperature excursion|postharvest loss)\w*\b/iu.test(evidence);
    const financialFacet =
      /\b(?:storage costs?|warehouse expenses?|transport costs?|logistics costs?|market prices?|price volatility|supplier payments?|sales revenues?|profitability|profit margins?|profit estimates?|financial losses?|margin|revenue|cost attribution|route profitability)\w*\b/iu.test(evidence);
    const fragmentedDecisionFacet =
      /\b(?:separate systems?|reviewed separately|fragmented|siloed|visibility gap|hard to determine|difficult to determine|cost visibility|profit visibility|reconciliation|which routes?|which products?|distribution stages?)\w*\b/iu.test(evidence);
    const strongExporterWorkflowContext =
      /\bexporters?\b/iu.test(evidence) &&
      logisticsFacet && financialFacet && fragmentedDecisionFacet;

    const unrelatedSmartFarming =
      /\b(?:drone harvesting|agricultural drones?|precision agriculture|crop disease detection|irrigation controller|soil sensor|smart farming)\b/iu.test(evidence) &&
      !/\b(?:export|shipment|cold chain|storage|spoilage|logistics|profit|margin|market price|warehouse)\b/iu.test(evidence);
    if (unrelatedSmartFarming) return false;

    return (produceExportContext || strongExporterWorkflowContext) &&
      (logisticsFacet || financialFacet || fragmentedDecisionFacet);
  }

  private static isAgriculturalExportProfitabilityEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    if (!this.isAgriculturalExportProfitabilitySupportingEvidence(evidence)) {
      return false;
    }

    const produceExportContext =
      /\b(?:agricultural exports?|agricultural exporters?|produce exports?|produce exporters?|fresh produce exports?|fresh produce exporters?|fruit exports?|fruit exporters?|vegetable exports?|vegetable exporters?|perishable produce|perishable goods|cold chain|produce shipments?|produce logistics|farm-to-market|postharvest|post-harvest)\b/iu.test(evidence);
    const financialFacet =
      /\b(?:profitability|profit margins?|profit estimates?|financial losses?|sales revenues?|market prices?|storage costs?|warehouse expenses?|transport costs?|logistics costs?|supplier payments?|margin|revenue)\w*\b/iu.test(evidence);
    const logisticsFacet =
      /\b(?:transport(?:ation)? delays?|delivery delays?|storage|cold chain|warehouse|shipment|distribution|route|logistics|spoilage|spoiled|quality loss)\w*\b/iu.test(evidence);
    const decisionOrFriction =
      /\b(?:delay|delayed|spoilage|spoiled|loss|losses|higher cost|rising cost|uncertain|volatile|fragmented|siloed|separate systems?|reviewed separately|difficult|hard to determine|inaccurate|poor pricing|cost visibility|profit visibility|reconciliation)\w*\b/iu.test(evidence);

    return produceExportContext && logisticsFacet && financialFacet && decisionOrFriction;
  }

  private static isRestaurantDeliveryFraudRequest(value: string): boolean {
    return /\b(?:restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|online food ordering services?|meal delivery platforms?|restaurant courier platforms?)\b/iu.test(value) &&
      /\b(?:suspicious orders?|account takeovers?|account takeover|refund abuse|fraudulent refunds?|promotional abuse|promo(?:tional)? fraud|promo code abuse|payment behavior|device information|device signals?|customer complaints?|security alerts?|false positives?|blocked legitimate (?:users?|customers?)|coordinated abuse|fraud detection)\b/iu.test(value);
  }

  private static isRestaurantDeliveryFraudSupportingEvidence(value: string): boolean {
    const evidence = this.normalize(value);
    const actor = /\b(?:restaurant delivery|food delivery|online food ordering|meal delivery|delivery app|restaurant courier|doordash|uber eats|ubereats|grubhub|deliveroo|foodpanda|talabat|instacart)\b/iu.test(evidence);
    if (!actor) return false;

    const fraudAxis = /\b(?:fraud|fraudulent|suspicious orders?|account takeovers?|account takeover|account compromise|refund abuse|refund fraud|fraudulent refunds?|promotion abuse|promotional abuse|promo code abuse|promo fraud|payment fraud|payment behavior|device risk|device signals?|device fingerprint|multiple accounts?|coordinated abuse|security alerts?|false positives?|false positive|blocked legitimate|account blocked|account deactivated|customer complaints?|chargeback abuse|coupon abuse)\b/iu.test(evidence);
    if (!fraudAxis) return false;

    const shipmentOnly = /\b(?:carrier scan|proof of delivery|shipping address|warehouse handoff|warehouse update|parcel tracking|shipment chain of custody|freight cargo|lost merchandise)\b/iu.test(evidence) &&
      !/\b(?:food delivery|restaurant delivery|delivery app|refund abuse|account takeover|promo|device|false positive|blocked legitimate)\b/iu.test(evidence);
    const genericCyberOnly = /\b(?:vulnerability|cve|malware|ransomware|zero[- ]day|patch|exploit|source code)\b/iu.test(evidence) &&
      !/\b(?:order|refund|account|promotion|promo|payment|device|customer)\b/iu.test(evidence);
    return !shipmentOnly && !genericCyberOnly;
  }

  private static isRestaurantEnergyRequest(value: string): boolean {
    return /\b(?:restaurants?|commercial kitchens?|restaurant kitchens?|food service kitchens?|kitchen managers?|restaurant managers?)\b/iu.test(value) &&
      /\b(?:electricity|gas|energy consumption|utility bills?|utility costs?|refrigeration|cooking equipment|ventilation|lighting|heating|equipment usage|equipment runtime|energy waste|energy efficiency|carbon|emissions?|environmental impact|consumption spikes?|energy monitoring)\b/iu.test(value);
  }

  private static isResidentialCleaningRequest(value: string): boolean {
    return /\b(?:home[- ]cleaning businesses?|home cleaning businesses?|residential cleaning businesses?|residential cleaning services?|house cleaning businesses?|house cleaning services?|cleaning companies?|cleaning teams?)\b/iu.test(value) &&
      /\b(?:customer preferences?|recurring appointments?|recurring bookings?|room[- ]specific instructions?|room instructions?|employee assignments?|cleaner assignments?|cleaning supplies?|last[- ]minute schedule changes?|schedule changes?|missed tasks?|scheduling conflicts?|forgotten customer requests?|service quality|phone calls?|messaging apps?|handwritten notes?)\b/iu.test(value);
  }

  private static isAgricultureLogisticsRequest(value: string): boolean {
    return /\b(?:agricultural cooperatives?|farm cooperatives?|farms?|farmers?|agriculture|fresh produce|produce growers?|cold storage)\b/iu.test(value) &&
      /\b(?:harvest(?:ing)?|storage|cold chain|temperature|shipment|transportation|delivery|spoilage|storage capacity|transport costs?|logistics)\b/iu.test(value);
  }

  private static isPictureFramingRequest(value: string): boolean {
    return /\b(?:picture framing shops?|custom framing shops?|frame shops?|framers?)\b/iu.test(value) &&
      /\b(?:artwork measurements?|frame selections?|glass selections?|moulding|material availability|special handling|completion dates?|paper forms?|verbal communication|order changes?|wasted supplies?)\b/iu.test(value);
  }

  private static isManufacturingSupplyChainRequest(value: string): boolean {
    return /\b(?:manufacturing|manufacturer|manufacturers|factory|factories|production line|production lines|production planner|production planners|industrial plant|industrial plants)\b/iu.test(value) &&
      /\b(?:raw materials?|supplier deliveries?|supplier updates?|supply chain|inventory|warehouse|warehouses|shipment|shipments|production schedules?|demand changes?|demand forecast|bottlenecks?|order prioritization|stock)\b/iu.test(value);
  }

  private static isLocksmithDispatchRequest(value: string): boolean {
    return /\b(?:locksmith|locksmiths|lock service|lock services|field service|mobile service)\b/iu.test(value) &&
      /\b(?:dispatch|technician|technicians|service requests?|emergency calls?|locations?|tools?|replacement parts?|parts inventory|job assignment|availability|repeated trips?|payment status)\b/iu.test(value);
  }

  private static hasGenericWorkflowContract(request: string): boolean {
    const actor = RequestDynamicQueryUtil.extractActor(request);
    const actorTokens = this.extractTokens(actor);
    if (actorTokens.size === 0) return false;
    const requestTokens = this.extractTokens(request);
    const workflowTokens = [...requestTokens].filter((token) => this.isWorkflowAxisToken(token));
    const outcomeTokens = [...requestTokens].filter((token) => this.isOutcomeAxisToken(token));
    return workflowTokens.length >= 3 && outcomeTokens.length >= 1;
  }

  private static genericWorkflowContractAligned(request: string, evidence: string): boolean {
    if (!this.dynamicActorAligned(request, evidence)) return false;
    const requestTokens = this.extractTokens(request);
    const evidenceTokens = this.extractTokens(evidence);
    const workflowTokens = [...requestTokens].filter((token) => this.isWorkflowAxisToken(token));
    const outcomeTokens = [...requestTokens].filter((token) => this.isOutcomeAxisToken(token));
    const workflowOverlap = workflowTokens.filter((token) => evidenceTokens.has(token)).length;
    const outcomeOverlap = outcomeTokens.filter((token) => evidenceTokens.has(token)).length;
    const requiredWorkflowOverlap = workflowTokens.length >= 7 ? 3 : 2;
    return workflowOverlap >= Math.min(requiredWorkflowOverlap, workflowTokens.length) && outcomeOverlap >= 1;
  }

  private static isWorkflowAxisToken(token: string): boolean {
    return /^(?:air|approval|assignment|attendance|availability|behavior|booking|bottle|budget|cap|cash|cleaning|client|color|colour|complaint|concentration|condition|contractor|course|customer|deadline|delivery|design|device|dispatch|emission|environmental|equipment|expense|exercise|feedback|financing|fitting|followup|forecast|formula|fuel|humidity|income|ingredient|instruction|inventory|lace|maintenance|margin|market|material|measurement|membership|mileage|monitor|note|order|page|paper|part|payment|photo|photograph|pickup|preference|preservation|profitability|progress|reading|receipt|record|repair|replacement|restoration|return|revision|route|sample|schedule|sensor|specification|staff|status|styling|subscription|task|telemetry|tenant|temperature|traffic|training|treatment|usage|utilization|vacancy|vehicle|version|water|workload|manuscript|annotation|container|bin)$/iu.test(token);
  }

  private static isOutcomeAxisToken(token: string): boolean {
    return /^(?:abnormal|conflict|cost|declining|delay|delayed|difficult|emission|error|expense|fail|failure|forgotten|fragmented|higher|inaccurate|incorrect|inconsistent|lost|lower|mismatch|missing|overload|pollution|poor|repeat|repeated|scattered|siloed|slow|slower|unexpected|uncomfortable|uncertain|underperforming|unnecessary|waste|wasted|wrong)$/iu.test(token);
  }

  private static localServiceActorAligned(
    request: string,
    evidence: string,
  ): boolean {
    const actorPatterns: readonly RegExp[] = [
      /\bcalligraphy artists?\b/iu,
      /\bcalligraphers?\b/iu,
      /\blettering artists?\b/iu,
      /\bcustom stationery artists?\b/iu,
      /\bwatch repair(?: shop| shops)?\b/iu,
      /\bwatchmaker(?:s)?\b/iu,
      /\bclock repair(?: specialist| specialists|er|ers| shop| shops)?\b/iu,
      /\bclockmaker(?:s)?\b/iu,
      /\bhorologist(?:s)?\b/iu,
      /\bshoe repair(?: shop| shops)?\b/iu,
      /\bcobbler(?:s)?\b/iu,
      /\bjewelry repair(?: shop| shops)?\b/iu,
      /\bjewellery repair(?: shop| shops)?\b/iu,
      /\bjeweler(?:s)?\b/iu,
      /\bjeweller(?:s)?\b/iu,
      /\blocksmith(?:s)?\b/iu,
      /\bcar wash(?:es)?\b/iu,
      /\btailor(?:s|ing)?\b/iu,
      /\balteration shops?\b/iu,
      /\balteration specialists?\b/iu,
      /\bbridal alteration specialists?\b/iu,
      /\bseamstresses?\b/iu,
      /\bbridal seamstresses?\b/iu,
      /\bdressmakers?\b/iu,
      /\bbridal dressmakers?\b/iu,
      /\bwedding dress alterations?\b/iu,
      /\bphotography studios?\b/iu,
      /\btattoo studios?\b/iu,
      /\bdance studios?\b/iu,
      /\brestaurants?\b/iu,
      /\bcommercial kitchens?\b/iu,
      /\bindependent pet trainers?\b/iu,
      /\bpet trainers?\b/iu,
      /\bdog trainers?\b/iu,
      /\banimal trainers?\b/iu,
      /\bbehavior trainers?\b/iu,
      /\bbehaviour trainers?\b/iu,
      /\bpet behavior consultants?\b/iu,
      /\bpet behaviour consultants?\b/iu,
      /\bwig makers?\b/iu,
      /\bcustom wig makers?\b/iu,
      /\bwig artisans?\b/iu,
      /\bhairpiece makers?\b/iu,
      /\bpet boarding(?: facilities?)?\b/iu,
      /\bboarding kennels?\b/iu,
      /\bkennels?\b/iu,
      /\bpet hotels?\b/iu,
      /\bdog boarding\b/iu,
      /\banimal boarding\b/iu,
      /\bhome[- ]cleaning businesses?\b/iu,
      /\bresidential cleaning(?: businesses?| services?)?\b/iu,
      /\bhouse cleaning(?: businesses?| services?)?\b/iu,
      /\bcleaning companies?\b/iu,
      /\bcleaners?\b/iu,
      /\bsalons?\b/iu,
      /\bbarbers?\b/iu,
      /\brepair shops?\b/iu,
      /\bpicture framing shops?\b/iu,
      /\bcustom framing shops?\b/iu,
      /\bframe shops?\b/iu,
      /\bframers?\b/iu,
      /\bdoll restoration specialists?\b/iu,
      /\bdoll restorers?\b/iu,
      /\bdoll restoration studios?\b/iu,
      /\bdoll restoration workshops?\b/iu,
      /\bdoll repair specialists?\b/iu,
    ];

    const matched = actorPatterns.filter((pattern) => pattern.test(request));
    if (matched.length === 0) {
      return true;
    }

    return matched.some((pattern) => pattern.test(evidence));
  }

  private static dynamicActorAligned(request: string, evidence: string): boolean {
    const actor = RequestDynamicQueryUtil.extractActor(request);
    if (!actor) return true;

    const aliases = RequestDynamicQueryUtil.buildActorAliases(actor);
    const broadRoleTokens = new Set([
      'independent', 'specialist', 'specialists', 'company', 'companies',
      'business', 'businesses', 'operator', 'operators', 'provider', 'providers',
      'professional', 'professionals', 'service', 'services', 'local', 'small',
      'maintenance', 'repair', 'repairs', 'restoration', 'tracking',
      'team', 'teams', 'staff', 'worker', 'workers', 'owner', 'owners',
    ]);
    const actorIdentityTokens = (value: string): string[] =>
      this.normalize(value)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/gu)
        .filter(
          (token) =>
            token.length >= 3 &&
            !broadRoleTokens.has(token) &&
            !/^(?:app|api|web|the|and|for|with)$/u.test(token),
        );
    const evidenceIdentityTokens = new Set(actorIdentityTokens(evidence));

    const aliasTokenSets = [actor, ...aliases]
      .map((value) => actorIdentityTokens(value))
      .filter((tokens) => tokens.length > 0);
    if (aliasTokenSets.length === 0) return true;

    return aliasTokenSets.some((tokens) => {
      const overlap = tokens.filter((token) => evidenceIdentityTokens.has(token)).length;
      const distinctive = tokens.filter((token) => token.length >= 6);
      const distinctiveOverlap = distinctive.some((token) => evidenceIdentityTokens.has(token));
      const required = tokens.length === 1 ? 1 : 2;
      return overlap >= required && (distinctive.length === 0 || distinctiveOverlap);
    });
  }

  private static extractTokens(value: string): Set<string> {
    const stopWords = new Set([
      'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between',
      'could', 'from', 'have', 'into', 'many', 'more', 'most', 'often', 'only',
      'other', 'people', 'same', 'separate', 'several', 'should', 'their', 'them',
      'they', 'through', 'usually', 'what', 'when', 'where', 'which', 'while',
      'with', 'without', 'would', 'information', 'system', 'systems', 'platform',
      'application', 'applications', 'software', 'workflow', 'workflows', 'problem',
      'problems', 'struggle', 'struggles', 'difficult', 'difficulty', 'current',
      'different', 'everyday', 'frequently', 'increasingly', 'potentially',
    ]);
    const aliases: Readonly<Record<string, string>> = {
      devices: 'device', sensors: 'sensor', cameras: 'camera', monitors: 'monitor', managers: 'manager',
      readings: 'reading', formulas: 'formula', ingredients: 'ingredient', concentrations: 'concentration', bottles: 'bottle',
      humidities: 'humidity', routes: 'route', mileages: 'mileage', feedbacks: 'feedback',
      connections: 'connection', standards: 'standard', instruments: 'instrument',
      repairs: 'repair', technicians: 'technician', notes: 'note', parts: 'part',
      dates: 'date', orders: 'order', customers: 'customer', complaints: 'complaint',
      shoes: 'shoe', boots: 'boot', assessments: 'assessment', exams: 'exam', logins: 'login',
      requests: 'request', deliveries: 'delivery', suppliers: 'supplier', shipments: 'shipment', warehouses: 'warehouse', bottlenecks: 'bottleneck', shortages: 'shortage', tools: 'tool',
      substitutions: 'substitution', records: 'record', agencies: 'agency',
      buildings: 'building', neighborhoods: 'neighborhood', planners: 'planner',
      equipment: 'equipment', departments: 'department', hospitals: 'hospital',
      artists: 'artist', studios: 'studio', tattoos: 'tattoo', surgeries: 'surgery', rooms: 'room',
      materials: 'material', photographs: 'photo', photos: 'photo', treatments: 'treatment', manuscripts: 'manuscript', annotations: 'annotation', pages: 'page', leaves: 'leaf', pickups: 'pickup', vehicles: 'vehicle', containers: 'container', bins: 'bin', citizens: 'citizen',
      farms: 'farm', farmers: 'farmer', growers: 'grower', harvesting: 'harvest', temperatures: 'temperature', transports: 'transport', costs: 'cost', frames: 'frame', measurements: 'measurement', dimensions: 'dimension', mouldings: 'moulding', glasses: 'glass',
      restaurants: 'restaurant', kitchens: 'kitchen', utilities: 'utility', bills: 'bill', refrigerations: 'refrigeration', emissions: 'emission',
      cleaners: 'cleaner', appointments: 'appointment', preferences: 'preference', instructions: 'instruction', assignments: 'assignment', supplies: 'supply', schedules: 'schedule', tasks: 'task', athletes: 'athlete', injuries: 'injury', reports: 'report', scores: 'score', loads: 'load', visits: 'visit', filters: 'filter', replacements: 'replacement', observations: 'observation', aquariums: 'aquarium',
      marketplaces: 'marketplace', sellers: 'seller', listings: 'listing', reviews: 'review', purchases: 'purchase', purchasing: 'purchase', transactions: 'transaction', restrictions: 'restriction', restricted: 'restriction', fraudulent: 'fraud', scams: 'scam', ads: 'advertising', ad: 'advertising',
      designers: 'designer', clients: 'client', contractors: 'contractor', revisions: 'revision', deadlines: 'deadline', selections: 'selection', samples: 'sample', furniture: 'furniture', commissions: 'commission', calligraphers: 'calligrapher', wordings: 'wording', inks: 'ink', papers: 'paper', approvals: 'approval', versions: 'version', appraisers: 'appraiser', valuations: 'valuation', archives: 'archive', catalogs: 'catalog', certificates: 'certificate', citations: 'citation', provenance: 'provenance', ownership: 'ownership', authenticity: 'authenticity', telemetry: 'telemetry', irrigation: 'irrigation',
      workshops: 'workshop', artisans: 'artisan', embroiderers: 'embroiderer', embroideries: 'embroidery', leatherworkers: 'leatherworker', engravings: 'engraving', stitchings: 'stitching', hardwares: 'hardware', specifications: 'specification', artworks: 'artwork', quantities: 'quantity', tourists: 'tourist', visitors: 'visitor', specialists: 'specialist', seamstresses: 'seamstress', dressmakers: 'dressmaker', alterations: 'alteration', fittings: 'fitting', gowns: 'gown', attractions: 'attraction', destinations: 'destination', congestions: 'congestion',
    };

    return new Set(
      this.normalize(value)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .filter(Boolean)
        .map((token) => aliases[token] ?? token)
        .filter((token) => token.length >= 4 && !stopWords.has(token)),
    );
  }

  private static isDistinctiveRequestAnchorToken(token: string): boolean {
    const broad = new Set([
      'application', 'business', 'client', 'company', 'condition', 'cost',
      'customer', 'data', 'digital', 'energy', 'equipment', 'expense',
      'history', 'information', 'maintenance', 'management', 'material',
      'operation', 'platform', 'preservation', 'process', 'record', 'repair',
      'request', 'restoration', 'service', 'cleaning', 'color', 'colour',
      'software', 'system', 'tracking', 'workflow', 'artificial',
      'intelligence', 'internet', 'things', 'manufacturing', 'finance',
      'logistics', 'government', 'environment', 'healthcare',
    ]);
    return token.length >= 4 && !broad.has(token);
  }

  private static isProblemOrWorkflowSignal(token: string): boolean {
    return /^(?:access|alert|anomal|approval|availability|appointment|assignment|bill|bottleneck|breach|complaint|conflict|cost|delay|delivery|dispatch|dispute|electricity|emission|energy|error|expense|fail|fake|fraud|scam|seller|listing|review|purchase|transaction|restriction|trust|firmware|forgotten|gas|instruction|inventory|maintenance|missing|note|operating|order|outage|part|pickup|preference|priorit|record|refrigeration|repair|request|risk|schedule|security|shipment|shortage|status|supplier|supply|sync|task|technician|threat|tool|tracking|treatment|condition|utilization|utility|location|equipment|device|department|material|unauthorized|unmanaged|vacancy|ventilation|visibility|waste|spoilage|spoil|temperature|transport|harvest|storage|frame|glass|measurement|dimension|moulding|remake|miscommunication|rehabilitation|recovery|injury|reinjury|pain|mobility|performance|load|athlete|visit|feeding|filter|replacement|observation|aquarium|client|contractor|revision|deadline|selection|sample|designer|furniture|commission|calligraphy|calligrapher|wording|lettering|paper|ink|approval|version|provenance|valuation|authenticity|ownership|archive|citation|certificate|catalog|telemetry|sensor|irrigation|connectivity|network)$/iu.test(token);
  }

  private static isTransactionAccountAbuseTriageCandidate(
    request: string,
    evidence: string,
  ): boolean {
    if (!this.isTransactionAccountAbuseRequest(request)) return false;
    if (RequestOnlinePharmacyFraudUtil.isRequest(request)) {
      return RequestOnlinePharmacyFraudUtil.isPlausibleRetrievalCandidate(request, evidence);
    }
    if (this.isMunicipalPaymentAbuseRequest(request)) {
      return this.isMunicipalPaymentAbuseSupportingEvidence(evidence);
    }
    if (this.isClearlyForeignTransactionAbuseEvidence(request, evidence)) return false;

    const identityOverlap = this.transactionAbuseIdentityOverlap(request, evidence);
    const actorAligned = this.dynamicActorAligned(request, evidence);
    const mechanismOverlap = this.transactionAbuseMechanismOverlap(request, evidence);
    const fraudRisk = this.hasTransactionAbuseRisk(evidence);
    const axisCount = this.transactionAbuseAxisCount(evidence);

    /*
     * Pre-AI triage should be recall-oriented: two distinctive requester
     * identity anchors plus one abuse axis are enough to let Community AI
     * inspect the item. This admits evidence such as "federal student aid
     * fraud" for a university tuition/refund problem without admitting a
     * generic Amazon refund merely because the author happens to be a student.
     */
    return (
      fraudRisk &&
      axisCount >= 1 &&
      (identityOverlap >= 1 || mechanismOverlap >= 2 || (actorAligned && mechanismOverlap >= 1))
    );
  }

  private static isTransactionAccountAbuseSupportingEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (!this.isTransactionAccountAbuseRequest(request)) return false;
    if (RequestOnlinePharmacyFraudUtil.isRequest(request)) {
      return RequestOnlinePharmacyFraudUtil.isPlausibleRetrievalCandidate(request, evidence);
    }
    if (this.isMunicipalPaymentAbuseRequest(request)) {
      return this.isMunicipalPaymentAbuseSupportingEvidence(evidence);
    }
    if (this.isClearlyForeignTransactionAbuseEvidence(request, evidence)) return false;

    const identityOverlap = this.transactionAbuseIdentityOverlap(request, evidence);
    const actorAligned = this.dynamicActorAligned(request, evidence);
    const mechanismOverlap = this.transactionAbuseMechanismOverlap(request, evidence);
    const fraudRisk = this.hasTransactionAbuseRisk(evidence);
    const axisCount = this.transactionAbuseAxisCount(evidence);
    /*
     * SUPPORTING_SIGNAL intentionally proves only one real atomic part of the
     * requester problem. The combination of two distinctive requester identity
     * anchors + a concrete abuse mechanism is already enough; requiring an
     * additional complaint word here caused reports such as student-aid fraud
     * alerts and identity-theft cases to be falsely discarded.
     */
    return (
      fraudRisk &&
      axisCount >= 1 &&
      (identityOverlap >= 1 || mechanismOverlap >= 2 || (actorAligned && mechanismOverlap >= 1))
    );
  }

  private static isTransactionAccountAbuseDirectEvidence(
    request: string,
    evidence: string,
  ): boolean {
    if (!this.isTransactionAccountAbuseSupportingEvidence(request, evidence)) {
      return false;
    }

    if (RequestOnlinePharmacyFraudUtil.isRequest(request)) {
      return RequestOnlinePharmacyFraudUtil.isDirectEvidence(request, evidence);
    }

    if (this.isMunicipalPaymentAbuseRequest(request)) {
      const municipalIdentity =
        /\b(?:smart cit(?:y|ies)|city government|municipal|municipality|local authority|public service|public transit|transit agenc|parking authority|parking operator|public utility|utility provider)\w*\b/iu.test(evidence);
      const fragmentedDetectionProblem =
        /\b(?:reviewed separately|separate systems?|fragmented|siloed|disconnected|hard to detect|difficult to detect|hard to identify|difficult to identify|delayed detection|delayed investigation|cannot correlate|unable to correlate|lack of visibility|poor visibility|false positive)\b/iu.test(evidence);
      const concreteImpact =
        /\b(?:unauthorized payments?|account compromise|compromised (?:citizen|resident|customer|user|payer)?\s*accounts?|account takeover|fraud losses?|financial losses?|false positives?|unnecessary restrictions?|fraudulent refunds?)\b/iu.test(evidence);
      return municipalIdentity && fragmentedDetectionProblem && concreteImpact;
    }

    const identityOverlap = this.transactionAbuseIdentityOverlap(request, evidence);
    const axisCount = this.transactionAbuseAxisCount(evidence);
    const fragmentedDetectionProblem =
      /\b(?:reviewed separately|separate systems?|fragmented|siloed|disconnected|hard to detect|difficult to detect|hard to identify|difficult to identify|delayed detection|delayed investigation|cannot correlate|unable to correlate|lack of visibility|poor visibility)\b/iu.test(evidence);
    const concreteImpact =
      /\b(?:financial loss|fraudulent refund|identity theft|compromised account|account takeover|false positive|legitimate (?:student|passenger|customer|user)|unnecessary restriction|fraud loss|refund scam|stolen financial aid)\w*\b/iu.test(evidence);

    return identityOverlap >= 2 && axisCount >= 2 && fragmentedDetectionProblem && concreteImpact;
  }

  private static isMunicipalPaymentAbuseRequest(value: string): boolean {
    return (
      /\b(?:smart cit(?:y|ies)|cities|city governments?|municipalit(?:y|ies)|municipal governments?|local authorities?|public services?|public transit|parking services?|utility services?)\b/iu.test(value) &&
      /\b(?:payments?|transactions?|payment records?|parking payments?|parking fees?|transit payments?|fare payments?|utility payments?|utility bills?|municipal fees?|public service fees?)\b/iu.test(value) &&
      /\b(?:fraud|fraudulent|account compromise|compromised accounts?|unauthorized payments?|false positives?|suspicious activity|security alerts?|detect|detection|investigat)\w*\b/iu.test(value)
    );
  }

  private static isMunicipalPaymentAbuseSupportingEvidence(value: string): boolean {
    if (this.isDeveloperOnlyEvidence(value)) return false;
    const paymentSystem =
      /\b(?:payment systems?|electronic payments?|digital payments?|online payments?|payment transactions?|transaction monitoring|payment monitoring|payment fraud|transaction fraud|payment security|payments? platform)\b/iu.test(value);
    const paymentAxis =
      /\b(?:payments?|payment transactions?|transactions?|parking payments?|parking fees?|transit payments?|fare payments?|utility payments?|utility bills?|municipal fees?|public service fees?)\b/iu.test(value);
    const municipalIdentity =
      /\b(?:smart cit(?:y|ies)|city government|city of [\p{L}][\p{L}'-]*|city (?:officials?|email|account|systems?|network|funds?)|municipal|municipality|local authority|public service|public transit|transit agenc|parking authority|parking operator|public utility|utility provider)\w*\b/iu.test(value);
    const concreteAbuseFacet =
      /\b(?:fraud detection|detect(?:ing)? fraud|fraudulent payments?|payment fraud|transaction fraud|unauthorized payments?|account compromise|compromised accounts?|account takeover|identity theft|false positives?|fraud alerts?|security alerts?|suspicious payments?|suspicious transactions?|fraud investigation)\b/iu.test(value);
    const unrelatedFinanceCollision =
      /\b(?:tax deferred|retirement accounts?|pension accounts?|investment portfolio|stock market|securities trading|mortgage lending)\b/iu.test(value) &&
      !municipalIdentity;
    if (unrelatedFinanceCollision) return false;

    // Vertical support: payment + municipal/public-service identity + fraud facet.
    if (paymentAxis && municipalIdentity && concreteAbuseFacet) return true;

    /*
     * Atomic municipal cybersecurity/financial support: a documented city or
     * public-service account compromise/cyber incident with concrete financial
     * loss, missing public funds, unauthorized transaction/account impact, or
     * investigation impact proves one real facet of the requester problem even
     * when the source does not explicitly name a parking/transit/utility
     * payment rail. This is SUPPORTING only; DIRECT still requires the fuller
     * municipal-payment + fragmented-detection contract.
     */
    const municipalCyberIncident =
      municipalIdentity &&
      /\b(?:cyber ?attack|cyberattack|breach|phishing|account compromise|compromised account|account takeover|unauthori[sz]ed access|fraud|fraudulent|stolen credentials?|security incident)\w*\b/iu.test(value);
    const municipalFinancialOrInvestigationImpact =
      /\b(?:missing public funds?|lost funds?|financial loss|financial impact|money missing|stolen funds?|unauthori[sz]ed transactions?|fraud loss|reimbursement|investigation|delayed investigation|account restriction|service restriction)\w*\b/iu.test(value);
    const explicitMaterialFinancialLoss =
      /(?:[$£€]\s*\d+(?:[.,]\d+)?\s*(?:k|m|million|thousand)?\b|\b\d+(?:[.,]\d+)?\s*(?:k|m|million|thousand)\b)/iu.test(
        value,
      );
    if (
      municipalCyberIncident &&
      (municipalFinancialOrInvestigationImpact || explicitMaterialFinancialLoss)
    ) {
      return true;
    }

    // Adjacent support: a real payment-system fraud/detection failure can prove
    // one atomic mechanism without being misrepresented as direct smart-city proof.
    return paymentSystem && concreteAbuseFacet;
  }

  private static isTransactionAccountAbuseRequest(request: string): boolean {
    return RequestWorkflowIntentProfileUtil.resolve(request).family ===
      'TRANSACTION_ACCOUNT_ABUSE';
  }

  private static transactionAbuseIdentityOverlap(
    request: string,
    evidence: string,
  ): number {
    const evidenceTokens = this.extractTokens(evidence);
    const generic = new Set([
      'fraud', 'fraudulent', 'payment', 'payments', 'transaction', 'transactions',
      'account', 'accounts', 'refund', 'refunds', 'security', 'alert', 'alerts',
      'financial', 'activity', 'record', 'records', 'system', 'systems', 'review',
      'reviewed', 'separate', 'separately', 'suspicious', 'unauthorized',
    ]);
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    const identityTerms = [...new Set([
      ...profile.actorIdentityTerms,
      ...profile.objectIdentityTerms,
      ...RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request),
    ])]
      .map((term) => this.normalize(term))
      .filter((term) => term.length >= 4 && !generic.has(term));

    return identityTerms.filter((term) =>
      this.semanticTokenAligned(term, evidenceTokens),
    ).length;
  }

  private static transactionAbuseMechanismOverlap(
    request: string,
    evidence: string,
  ): number {
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    const evidenceTokens = this.extractTokens(evidence);
    const mechanismTerms = [...new Set([
      ...profile.workflowIdentityTerms,
      ...profile.failureIdentityTerms,
      ...profile.outcomeIdentityTerms,
    ])]
      .map((term) => this.normalize(term))
      .filter((term) => term.length >= 4);
    return mechanismTerms.filter((term) =>
      this.semanticTokenAligned(term, evidenceTokens),
    ).length;
  }

  private static hasTransactionAbuseRisk(value: string): boolean {
    return /\b(?:fraud|fraudulent|scam|abuse|identity theft|account takeover|compromised account|unauthorized account|unauthorized payment|suspicious booking|suspicious order|suspicious payment|coordinated abuse|false positive|illicit refund|stolen financial aid|student aid fraud|steal(?:ing)? financial aid|ghost students?)\w*\b/iu.test(value);
  }

  private static transactionAbuseAxisCount(value: string): number {
    return [
      /\b(?:payment|payments|transaction|transactions|tuition payment|student billing|billing record|fare payment|ticket payment|chargeback|financial aid|student aid|federal student aid|student loan|scholarship)\w*\b/iu,
      /\b(?:refund|refund request|refund scam|refund fraud|fraudulent refund|dispute|financial aid disbursement|scholarship disbursement)\w*\b/iu,
      /\b(?:student account|scholarship account|passenger account|customer account|user account|account takeover|account compromise|identity theft|unauthorized account|login|credential|access log|authentication)\w*\b/iu,
      /\b(?:booking|reservation|ticket booking|suspicious booking|order|purchase|suspicious order)\w*\b/iu,
      /\b(?:device|fingerprint|security alert|risk signal|behavior signal|behaviour signal|login signal)\w*\b/iu,
    ].filter((pattern) => pattern.test(value)).length;
  }

  private static isClearlyForeignTransactionAbuseEvidence(
    request: string,
    evidence: string,
  ): boolean {
    const identityOverlap = this.transactionAbuseIdentityOverlap(request, evidence);
    const mechanismOverlap = this.transactionAbuseMechanismOverlap(request, evidence);
    const axisCount = this.transactionAbuseAxisCount(evidence);
    if (identityOverlap >= 1 || mechanismOverlap >= 2) return false;

    /*
     * Cross-domain evidence may legitimately support one atomic failure mode
     * (for example account takeover research supporting a procurement portal
     * request). Reject it only when it has neither request identity nor a
     * meaningful combination of request-owned workflow/failure/outcome terms.
     */
    return axisCount === 0 || mechanismOverlap === 0;
  }

  private static maximumPlannedSemanticOverlap(
    plannedQueries: readonly string[],
    evidenceTokens: ReadonlySet<string>,
  ): number {
    let maximum = 0;
    for (const query of plannedQueries.slice(0, 24)) {
      const queryTokens = this.extractTokens(query);
      const overlap = [...queryTokens].filter((token) =>
        evidenceTokens.has(token),
      ).length;
      if (overlap > maximum) maximum = overlap;
    }
    return maximum;
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
