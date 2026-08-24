export type RequestWorkflowIntentFamily =
  | 'FOOD_STORAGE_CONDITION'
  | 'RESTORATION_CONSERVATION'
  | 'RENTAL_INVENTORY'
  | 'CUSTOM_COMMISSION'
  | 'SPECIFICATION_APPROVAL'
  | 'RESTAURANT_ENERGY'
  | 'TRANSACTION_ACCOUNT_ABUSE'
  | 'FACILITY_RESOURCE_MONITORING'
  | 'GENERAL';

export type RequestWorkflowIntentProfile = {
  readonly family: RequestWorkflowIntentFamily;
  readonly confidence: number;
  readonly actorMatched: boolean;
  readonly objectAxisCount: number;
  readonly workflowAxisCount: number;
  readonly failureAxisCount: number;
  readonly explicitEnergyIntent: boolean;
  readonly explicitFinancialIntent: boolean;
  readonly explicitCommissionIntent: boolean;
  readonly restorationIntent: boolean;
  readonly restorationSubject: string | null;
  readonly actorIdentityTerms: readonly string[];
  readonly objectIdentityTerms: readonly string[];
  readonly workflowIdentityTerms: readonly string[];
  readonly failureIdentityTerms: readonly string[];
  readonly outcomeIdentityTerms: readonly string[];
};

/**
 * Request-description-first semantic profile for collision-prone operational
 * workflows. The description is the source of truth; planner queries and
 * domain names are deliberately excluded so a later search hint cannot
 * reframe the user's workflow.
 */
export class RequestWorkflowIntentProfileUtil {
  static resolve(requestDescription?: string | null): RequestWorkflowIntentProfile {
    const text = this.normalize(requestDescription ?? '');
    if (!text) return this.empty();

    const restaurantActor =
      /\b(?:restaurants?|restaurant kitchens?|commercial kitchens?|food service kitchens?|foodservice kitchens?|catering kitchens?|commissary kitchens?|kitchen managers?|restaurant managers?)\b/u.test(text);
    const foodStorageObjects = this.count([
      /\b(?:refrigerators?|refrigeration|walk[- ]?in coolers?|coolers?|freezers?|cold storage|cold room|storage rooms?)\b/u,
      /\b(?:ingredient expiration|expiration dates?|expiry dates?|expired ingredients?|perishable ingredients?|food inventory|ingredient inventory)\b/u,
      /\b(?:storage conditions?|storage temperature|temperature readings?|temperature excursions?|freezer performance|refrigerator performance|cold[- ]chain condition)\b/u,
      /\b(?:equipment maintenance|maintenance records?|equipment condition|equipment failures?|compressor|refrigeration equipment)\b/u,
    ], text);
    const foodStorageWorkflow = this.count([
      /\b(?:monitor(?:ed|ing)?|tracked?|reviewed?|recorded?|separate systems?|separately|fragmented|siloed|alerts?|thresholds?|condition monitoring)\b/u,
      /\b(?:food spoilage|spoiled food|ingredient spoilage|food waste|unnecessary disposal|inventory loss|ingredient loss)\b/u,
      /\b(?:food quality|quality inconsistency|inconsistent food quality|storage risk|ingredients? at risk|food safety)\b/u,
    ], text);
    const foodStorageFailures = this.count([
      /\b(?:spoil(?:ed|age)|food waste|unnecessary disposal|inventory loss|ingredient loss)\b/u,
      /\b(?:equipment failures?|equipment breakdowns?|refrigeration failures?|freezer failures?)\b/u,
      /\b(?:inconsistent food quality|poor food quality|higher operating costs?|storage risk)\b/u,
    ], text);

    const explicitEnergyIntent =
      /\b(?:energy consumption|electricity consumption|power consumption|gas consumption|electricity usage|energy usage|utility bills?|utility costs?|energy costs?|energy efficiency|energy waste|consumption spikes?|peak demand|peak load|carbon emissions?|energy monitoring)\b/u.test(text);
    const energyDecisionIntent =
      /\b(?:reduce|reducing|lower|lowering|optimi[sz](?:e|ing)|improve|improving|control|controlling|compare|prioriti[sz](?:e|ing)|forecast(?:ing)?|identify)\b[^.!?]{0,80}\b(?:energy|electricity|power|utility|emissions?|consumption|demand|efficiency)\b|\b(?:energy|electricity|power|utility|emissions?|consumption|demand|efficiency)\b[^.!?]{0,80}\b(?:reduce|reducing|lower|lowering|optimi[sz](?:e|ing)|improve|improving|control|controlling|compare|prioriti[sz](?:e|ing)|forecast(?:ing)?|waste|cost)\b/u.test(text);

    const explicitFinancialIntent =
      /\b(?:profitability|profit margins?|contribution margin|gross margin|net profit|revenue|financial performance|financial forecast|budget variance|pricing decisions?|cost allocation|return on investment|\broi\b)\b/u.test(text);

    const restorationActor =
      /\b(?:restoration specialists?|restorers?|conservation specialists?|conservators?|restoration workshops?|conservation workshops?|repair specialists?)\b/u.test(text);
    const restorationObjects = this.count([
      /\b(?:cracked|damaged|broken|missing|fractured|deteriorated|corroded|worn)\b[^.!?]{0,45}\b(?:piece|pieces|section|sections|joint|joints|part|parts|component|components|binding|bindings|panel|panels|glass|metal|wood|paper|fabric|stone|ceramic|paint|finish)\w*\b/u,
      /\b(?:original colors?|original colour|original patterns?|original design|original details?|historical design|decorative sections?|decorative details?|provenance|condition assessment|condition report)\b/u,
      /\b(?:previous repairs?|prior repairs?|repair history|restoration history|previous restoration|prior restoration|treatment history|conservation treatment)\b/u,
      /\b(?:replacement materials?|replacement parts?|material matching|color matching|colour matching|finish matching|physical samples?|material samples?)\b/u,
    ], text);
    const restorationWorkflow = this.count([
      /\b(?:document|documenting|record|recording|track|tracking|maintain|maintaining)\b[^.!?]{0,90}\b(?:condition|damage|repair|restoration|treatment|material|original|history|preference|sample)\w*\b/u,
      /\b(?:photographs?|handwritten notes?|workshop records?|physical samples?|material samples?|condition maps?|condition records?)\b/u,
      /\b(?:customer restoration preferences?|client restoration preferences?|preservation preferences?|customer requests?|client instructions?)\b/u,
    ], text);
    const restorationFailures = this.count([
      /\b(?:incorrect|wrong|mismatched?)\b[^.!?]{0,35}\b(?:material|glass|color|colour|finish|part|replacement|treatment)\w*\b/u,
      /\b(?:loss|lost|lose|losing)\b[^.!?]{0,45}\b(?:original|design|detail|history|information)\w*\b/u,
      /\b(?:repeated work|rework|wasted materials?|delayed restoration|delayed projects?|overlooked damage|repeated repairs?)\b/u,
    ], text);
    const restorationIntent =
      restorationActor && restorationObjects >= 2 && restorationWorkflow >= 1;

    const explicitCommissionIntent =
      /\b(?:custom commissions?|commissioned work|custom orders?|made[- ]to[- ]order|bespoke order|new design|design brief|client brief|customer brief)\b/u.test(text);
    const customActor =
      /\b(?:makers?|artisans?|artists?|studios?|workshops?|custom shops?|craft businesses?|craftsmen?|craftswomen?)\b/u.test(text);
    const customSpecificationAxes = this.count([
      /\b(?:dimensions?|measurements?|sizes?|placement instructions?|personalization|wording|engraving|design references?|reference images?)\b/u,
      /\b(?:design revisions?|revision requests?|approved design|approved version|final approved|customer approval|client approval|specification version)\b/u,
      /\b(?:material choices?|color choices?|colour choices?|finish choices?|decorative details?)\b/u,
    ], text);
    const customFailures = this.count([
      /\b(?:wrong|incorrect)\b[^.!?]{0,30}\b(?:dimension|size|placement|spelling|design|version|color|colour|material|cut|opening)\w*\b/u,
      /\b(?:missed design change|forgotten design change|wrong version|outdated version|rework|repeated work|wasted materials?|wasted supplies?|delayed orders?|delayed commissions?|incorrect cuts?|mismatched materials?)\b/u,
    ], text);
    const specificationApprovalIntent =
      /\b(?:revision requests?|design revisions?|final approved specifications?|approved specifications?|final approved|customer approval|client approval|confirm the final approved|specification version)\b/u.test(text) &&
      customSpecificationAxes >= 2 && customFailures >= 1;
    const specificationActor =
      /\b(?:specialists?|studios?|workshops?|shops?|makers?|artisans?|framers?|cutters?|fabricators?)\b/u.test(text);

    const rentalActor =
      /\b(?:rental|rentals|hire)\s+(?:shops?|stores?|businesses?|services?|companies?)\b|\b(?:shops?|stores?|businesses?|services?|companies?)\b[^.!?]{0,70}\b(?:rental|rentals|hire)\b/u.test(text);
    const rentalAxes = this.count([
      /\b(?:inventory|availability|available|stock)\b/u,
      /\b(?:condition|damage|inspection|servicing|maintenance history|service history)\b/u,
      /\b(?:rental periods?|return dates?|expected returns?|late returns?|overdue)\b/u,
      /\b(?:accessories|deposits?|charges?|booking|bookings|reservations?|double bookings?)\b/u,
    ], text);
    const rentalFailures = this.count([
      /\b(?:double bookings?|missing accessories|overlooked damage|incorrect charges?|delayed rentals?|availability conflict|booking conflict|late returns?|overdue servicing)\b/u,
    ], text);


    const transactionAbuseActor =
      /\b(?:transportation companies?|transport companies?|transport operators?|transportation operators?|transit operators?|mobility services?|mobility platforms?|ticketing services?|ticketing platforms?|rail companies?|train companies?|bus companies?|metro operators?|passenger transport services?)\b/u.test(text);
    const transactionAbuseAxes = this.count([
      /\b(?:payments?|payment records?|transactions?|fare payments?|ticket payments?|payment activity)\b/u,
      /\b(?:refund requests?|refunds?|fraudulent refunds?|chargebacks?|disputes?)\b/u,
      /\b(?:passenger accounts?|customer accounts?|account activity|login activity|account takeover|compromised accounts?|unauthorized account activity)\b/u,
      /\b(?:booking behavior|booking activity|bookings?|ticket bookings?|reservation activity|suspicious bookings?)\b/u,
      /\b(?:device information|device signals?|device fingerprints?|security alerts?|risk signals?)\b/u,
    ], text);
    const transactionAbuseFailures = this.count([
      /\b(?:fraudulent payments?|payment fraud|fraudulent refunds?|refund fraud|account takeover|compromised accounts?|unauthorized account activity|suspicious booking behavior|coordinated abuse)\b/u,
      /\b(?:financial losses?|fraud losses?|fraudulent refunds?|compromised customer accounts?)\b/u,
      /\b(?:false positives?|unnecessary restrictions?|legitimate passengers? restricted|blocked legitimate passengers?)\b/u,
      /\b(?:detect|identify|trace|investigat)\w*[^.!?]{0,70}\b(?:abuse|fraud|suspicious|unauthorized|account|refund|booking)\w*\b/u,
    ], text);
    const transactionAbuseScore =
      (transactionAbuseActor ? 2 : 0) + transactionAbuseAxes + transactionAbuseFailures;

    const facilityActor =
      /\b(?:hospitals?|healthcare facilities?|medical facilities?|universit(?:y|ies)|campuses?|hotels?|commercial buildings?|office buildings?|factories?|industrial plants?|warehouses?|distribution centers?|large facilities?|facility operators?)\b/u.test(text);
    const facilityResourceObject =
      /\b(?:water consumption|water usage|water meters?|meter readings?|utility consumption|utility usage|electricity consumption|energy consumption|gas consumption|steam consumption|compressed air|cooling water|cooling systems?|resource consumption)\b/u.test(text);
    const facilityResourceAxes = this.count([
      /\b(?:meter readings?|submeters?|meters?|telemetry|sensor readings?|consumption readings?|usage readings?)\b/u,
      /\b(?:equipment usage|equipment runtime|equipment performance|maintenance records?|maintenance history|work orders?)\b/u,
      /\b(?:facility activity|occupancy|operating hours?|department activity|zone activity|room activity)\b/u,
      /\b(?:patient rooms?|laboratories?|kitchens?|sterilization units?|cooling systems?|facility zones?|building zones?)\b/u,
    ], text);
    const facilityResourceFailures = this.count([
      /\b(?:leaks?|leakage|abnormal consumption|unusual consumption|consumption spikes?|excess consumption|inefficient processes?|inefficienc(?:y|ies))\b/u,
      /\b(?:wasted water|water waste|resource waste|higher utility costs?|utility cost increase|equipment damage|environmental impact)\b/u,
      /\b(?:monitored separately|reviewed separately|fragmented|siloed|separate systems?|separate records?)\b/u,
    ], text);
    const facilityResourceScore =
      (facilityActor ? 2 : 0) + (facilityResourceObject ? 2 : 0) + facilityResourceAxes + facilityResourceFailures;

    const foodStorageScore =
      (restaurantActor ? 2 : 0) + foodStorageObjects + foodStorageWorkflow + foodStorageFailures;
    const restorationScore =
      (restorationActor ? 2 : 0) + restorationObjects + restorationWorkflow + restorationFailures;
    const rentalScore = (rentalActor ? 2 : 0) + rentalAxes + rentalFailures;
    const commissionScore =
      (explicitCommissionIntent ? 2 : 0) + (customActor ? 1 : 0) + customSpecificationAxes + customFailures;
    const energyScore =
      (restaurantActor ? 2 : 0) + (explicitEnergyIntent ? 2 : 0) + (energyDecisionIntent ? 2 : 0);

    let family: RequestWorkflowIntentFamily = 'GENERAL';
    let confidence = 0.5;

    // Condition/spoilage is the dominant kitchen problem unless the requester
    // explicitly asks to optimize energy/utility performance.

    if (
      transactionAbuseActor &&
      transactionAbuseAxes >= 3 &&
      transactionAbuseFailures >= 1
    ) {
      family = 'TRANSACTION_ACCOUNT_ABUSE';
      confidence = Math.min(0.995, 0.91 + transactionAbuseScore * 0.012);
    } else if (
      facilityActor &&
      facilityResourceObject &&
      facilityResourceAxes >= 2 &&
      facilityResourceFailures >= 1
    ) {
      family = 'FACILITY_RESOURCE_MONITORING';
      confidence = Math.min(0.995, 0.9 + facilityResourceScore * 0.012);
    } else if (
      restaurantActor &&
      foodStorageObjects >= 2 &&
      foodStorageFailures >= 1 &&
      foodStorageScore >= energyScore &&
      !(explicitEnergyIntent && energyDecisionIntent && foodStorageFailures === 0)
    ) {
      family = 'FOOD_STORAGE_CONDITION';
      confidence = Math.min(0.995, 0.88 + foodStorageScore * 0.015);
    } else if (
      restorationIntent &&
      restorationFailures >= 1 &&
      (!explicitCommissionIntent || restorationScore >= commissionScore)
    ) {
      family = 'RESTORATION_CONSERVATION';
      confidence = Math.min(0.995, 0.9 + restorationScore * 0.012);
    } else if (rentalActor && rentalAxes >= 2 && rentalFailures >= 1) {
      family = 'RENTAL_INVENTORY';
      confidence = Math.min(0.995, 0.9 + rentalScore * 0.012);
    } else if (
      specificationApprovalIntent &&
      specificationActor &&
      !restorationIntent
    ) {
      family = explicitCommissionIntent ? 'CUSTOM_COMMISSION' : 'SPECIFICATION_APPROVAL';
      confidence = Math.min(0.99, 0.89 + commissionScore * 0.015);
    } else if (
      explicitCommissionIntent &&
      customActor &&
      customSpecificationAxes >= 1 &&
      customFailures >= 1
    ) {
      family = 'CUSTOM_COMMISSION';
      confidence = Math.min(0.99, 0.88 + commissionScore * 0.015);
    } else if (restaurantActor && explicitEnergyIntent && energyDecisionIntent) {
      family = 'RESTAURANT_ENERGY';
      confidence = Math.min(0.99, 0.9 + energyScore * 0.012);
    }

    return {
      family,
      confidence,
      actorMatched:
        transactionAbuseActor || restaurantActor || restorationActor || rentalActor || customActor,
      objectAxisCount:
        family === 'TRANSACTION_ACCOUNT_ABUSE'
          ? transactionAbuseAxes
          : family === 'FOOD_STORAGE_CONDITION'
          ? foodStorageObjects
          : family === 'RESTORATION_CONSERVATION'
            ? restorationObjects
            : family === 'RENTAL_INVENTORY'
              ? rentalAxes
              : customSpecificationAxes,
      workflowAxisCount:
        family === 'TRANSACTION_ACCOUNT_ABUSE'
          ? transactionAbuseAxes
          : family === 'FOOD_STORAGE_CONDITION'
          ? foodStorageWorkflow
          : family === 'RESTORATION_CONSERVATION'
            ? restorationWorkflow
            : family === 'RESTAURANT_ENERGY'
              ? Number(energyDecisionIntent)
              : customSpecificationAxes,
      failureAxisCount:
        family === 'TRANSACTION_ACCOUNT_ABUSE'
          ? transactionAbuseFailures
          : family === 'FOOD_STORAGE_CONDITION'
          ? foodStorageFailures
          : family === 'RESTORATION_CONSERVATION'
            ? restorationFailures
            : family === 'RENTAL_INVENTORY'
              ? rentalFailures
              : customFailures,
      explicitEnergyIntent,
      explicitFinancialIntent,
      explicitCommissionIntent,
      restorationIntent,
      restorationSubject: this.extractRestorationSubject(text),
      actorIdentityTerms: this.resolveActorIdentityTerms(text, family),
      objectIdentityTerms: this.resolveObjectIdentityTerms(text, family),
      workflowIdentityTerms: this.resolveWorkflowIdentityTerms(text, family),
      failureIdentityTerms: this.resolveFailureIdentityTerms(text, family),
      outcomeIdentityTerms: this.resolveOutcomeIdentityTerms(text, family),
    };
  }

  static isTemplateQueryCompatible(
    requestDescription: string | null | undefined,
    query: string,
  ): boolean {
    const profile = this.resolve(requestDescription);
    const normalized = this.normalize(query);
    if (!normalized) return false;

    if (profile.family === 'TRANSACTION_ACCOUNT_ABUSE') {
      if (
        /\b(?:smart agriculture|smart farm|crop|irrigation|insurance claim|insurance reimbursement|manufacturing|factory|hotel booking|accommodation|custom commission|shipment chain of custody)\b/u.test(normalized)
      ) {
        return false;
      }
      const identity =
        /\b(?:transportation|transport|transit|mobility|ticketing|ticket|fare|passenger|rail|train|bus|metro)\b/u.test(normalized);
      const abuseWorkflow =
        /\b(?:payment|transaction|refund|chargeback|account|login|booking|reservation|device|security alert|fraud|scam|abuse|suspicious|unauthorized|false positive|restriction|investigation)\w*\b/u.test(normalized);
      if (!identity && !abuseWorkflow) return false;
    }

    if (profile.family === 'FOOD_STORAGE_CONDITION') {
      if (
        /\b(?:household|home fridge|young adults?|warehouse fire|landfill|stock market|energy stocks?|profitability|profit margin|revenue forecast|pricing decision)\b/u.test(
          normalized,
        )
      ) {
        return false;
      }
      if (
        /\b(?:energy consumption|electricity consumption|utility bills?|energy efficiency|energy costs?|rising energy costs?|carbon emissions?|power consumption)\b/u.test(normalized) &&
        !/\b(?:temperature excursion|temperature failure|freezer failure|refrigeration failure|cold storage failure|food spoilage|spoiled food|ingredient spoilage|ingredient expiration|expired ingredient|food waste|inventory loss|storage risk)\b/u.test(normalized)
      ) {
        return false;
      }
    }

    if (profile.family === 'RESTORATION_CONSERVATION') {
      if (
        !profile.explicitCommissionIntent &&
        /\b(?:custom commission|custom order|new design|wrong dimensions?|approved design|production mistake|personalization|made to order)\b/u.test(normalized)
      ) {
        return false;
      }
      if (
        /\b(?:often struggle|struggle problem|document problem|history for each problem)\b/u.test(normalized)
      ) {
        return false;
      }
    }

    if (profile.family === 'FACILITY_RESOURCE_MONITORING') {
      if (
        /\b(?:surgical scheduling|surgery scheduling|operating room coordinator|operating room schedule|procedure scheduling|clinical scheduling|appointment scheduling|patient scheduling|medication|diagnosis|billing claim|petroleum drilling|wellbore|drilling fluid|rolling stock|railway applications|inconel|ultrasonic cutting|metal machining|seismic damage|software maintenance)\b/u.test(normalized)
      ) {
        return false;
      }
      if (
        !/\b(?:water|utility|meter|consumption|usage|leak|maintenance|facility|cooling|resource|equipment|environmental|waste|anomaly|abnormal)\w*\b/u.test(normalized)
      ) {
        return false;
      }
    }

    if ((profile.family === 'CUSTOM_COMMISSION' || profile.family === 'SPECIFICATION_APPROVAL') && profile.restorationIntent) {
      return false;
    }

    return true;
  }

  private static resolveActorIdentityTerms(
    text: string,
    family: RequestWorkflowIntentFamily,
  ): string[] {
    const terms: string[] = [];
    const add = (...values: string[]) => values.forEach((value) => {
      if (text.includes(value) && !terms.includes(value)) terms.push(value);
    });
    add('hospital', 'healthcare facility', 'medical facility', 'university', 'campus', 'hotel', 'commercial building', 'factory', 'warehouse', 'transportation', 'transit', 'mobility', 'restaurant', 'commercial kitchen', 'restoration specialist', 'rental shop', 'picture mat', 'framing');
    if (family === 'FACILITY_RESOURCE_MONITORING' && terms.length === 0) terms.push('facility');
    return terms.slice(0, 8);
  }

  private static resolveObjectIdentityTerms(
    text: string,
    family: RequestWorkflowIntentFamily,
  ): string[] {
    const terms: string[] = [];
    const candidates = [
      'water', 'water consumption', 'water meter', 'meter reading', 'utility consumption',
      'electricity', 'energy consumption', 'gas consumption', 'cooling system',
      'payment', 'refund', 'passenger account', 'booking', 'ticket',
      'refrigerator', 'freezer', 'cold storage', 'ingredient',
      'picture mat', 'mat cutting', 'mat board', 'artwork', 'border width', 'opening shape',
      'glass art', 'stained glass', 'rug', 'furniture', 'violin case', 'typewriter',
      'rental inventory', 'accessory', 'deposit',
    ];
    for (const candidate of candidates) {
      if (text.includes(candidate) && !terms.includes(candidate)) terms.push(candidate);
    }
    if (family === 'FACILITY_RESOURCE_MONITORING' && terms.length === 0) terms.push('resource consumption');
    return terms.slice(0, 12);
  }

  private static resolveWorkflowIdentityTerms(
    text: string,
    family: RequestWorkflowIntentFamily,
  ): string[] {
    const terms: string[] = [];
    const candidates = [
      'monitoring', 'meter readings', 'maintenance records', 'facility activity', 'anomaly detection',
      'fraud detection', 'refund investigation', 'account activity', 'booking behavior',
      'storage conditions', 'expiration dates', 'restoration history', 'previous repairs',
      'final approved specifications', 'revision requests', 'customer preferences', 'material selections',
      'rental periods', 'return dates', 'availability',
    ];
    for (const candidate of candidates) {
      if (text.includes(candidate) && !terms.includes(candidate)) terms.push(candidate);
    }
    if (family === 'FACILITY_RESOURCE_MONITORING') {
      for (const value of ['resource monitoring', 'consumption monitoring', 'maintenance correlation']) {
        if (!terms.includes(value)) terms.push(value);
      }
    }
    return terms.slice(0, 12);
  }

  private static resolveFailureIdentityTerms(
    text: string,
    family: RequestWorkflowIntentFamily,
  ): string[] {
    const terms: string[] = [];
    const candidates = [
      'leak', 'abnormal consumption', 'inefficient processes', 'fragmented', 'separately',
      'fraudulent payment', 'fraudulent refund', 'account takeover', 'suspicious booking',
      'spoilage', 'equipment failure', 'incorrect cuts', 'mismatched materials', 'repeated work',
      'double booking', 'missing accessories', 'overlooked damage',
    ];
    for (const candidate of candidates) {
      if (text.includes(candidate) && !terms.includes(candidate)) terms.push(candidate);
    }
    if (family === 'FACILITY_RESOURCE_MONITORING' && terms.length === 0) terms.push('abnormal resource use');
    return terms.slice(0, 10);
  }

  private static resolveOutcomeIdentityTerms(
    text: string,
    family: RequestWorkflowIntentFamily,
  ): string[] {
    const terms: string[] = [];
    const candidates = [
      'utility costs', 'wasted water', 'equipment damage', 'environmental impact',
      'financial losses', 'unnecessary restrictions', 'food waste', 'wasted supplies',
      'delayed orders', 'delayed projects', 'loss of original details',
    ];
    for (const candidate of candidates) {
      if (text.includes(candidate) && !terms.includes(candidate)) terms.push(candidate);
    }
    if (family === 'FACILITY_RESOURCE_MONITORING' && terms.length === 0) terms.push('resource waste');
    return terms.slice(0, 8);
  }

  private static extractRestorationSubject(text: string): string | null {
    const matches = [
      text.match(
        /\b(?:independent\s+)?([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3})\s+restoration\s+(?:specialists?|studios?|workshops?|services?)\b/u,
      ),
      text.match(
        /\b([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3})\s+(?:restorers?|conservators?)\b/u,
      ),
    ];
    for (const match of matches) {
      const candidate = match?.[1]?.trim();
      if (!candidate) continue;
      return candidate
        .replace(/^(?:independent|small|local)\s+/u, '')
        .split(/\s+/u)
        .slice(0, 4)
        .join(' ');
    }
    return null;
  }

  private static count(patterns: readonly RegExp[], text: string): number {
    return patterns.filter((pattern) => pattern.test(text)).length;
  }

  private static empty(): RequestWorkflowIntentProfile {
    return {
      family: 'GENERAL',
      confidence: 0,
      actorMatched: false,
      objectAxisCount: 0,
      workflowAxisCount: 0,
      failureAxisCount: 0,
      explicitEnergyIntent: false,
      explicitFinancialIntent: false,
      explicitCommissionIntent: false,
      restorationIntent: false,
      restorationSubject: null,
      actorIdentityTerms: [],
      objectIdentityTerms: [],
      workflowIdentityTerms: [],
      failureIdentityTerms: [],
      outcomeIdentityTerms: [],
    };
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/([\p{L}\p{N}])(?:['’]s)\b/giu, '$1')
      .replace(/[^\p{L}\p{N}\s&/'’:-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
