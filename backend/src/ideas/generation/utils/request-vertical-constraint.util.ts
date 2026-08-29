import { CanonicalRequestUnderstandingUtil } from './canonical-request-understanding.util';

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

/**
 * Request-derived retrieval constraint.
 *
 * This utility intentionally contains no named business vertical routing. The
 * old implementation encoded dozens of actor/workflow scenarios and then used
 * those labels to change query wording, source budgets and admission behavior.
 * That made unseen niches brittle and could starve the correct evidence source.
 *
 * The current contract derives identity + workflow anchors from the canonical
 * requester profile only. `kind` remains `GENERAL` for backward compatibility;
 * callers that still contain legacy specialization branches therefore fall
 * through to their generic behavior instead of silently re-routing a request.
 */
export class RequestVerticalConstraintUtil {
  static resolve(input: {
    readonly requestDescription?: string | null;
    readonly domainName?: string | null;
    readonly selectedDomainNames?: readonly string[];
    readonly plannedQueries?: readonly string[];
  }): RequestVerticalConstraint {
    const description = this.normalize(input.requestDescription ?? '');
    if (!description) {
      return {
        kind: 'GENERAL',
        label: this.buildFallbackLabel(input),
        strict: false,
        requiredAnchors: [],
        workflowAnchors: [],
        excludedAnchors: [],
      };
    }

    const profile = CanonicalRequestUnderstandingUtil.resolve(description);
    const identityAnchors = this.unique([
      profile.actor,
      profile.object,
      ...(profile.actorAliases ?? []),
      ...(profile.objectAliases ?? []),
    ])
      .map((value) => this.compactAnchor(value, 8))
      .filter((value) => this.semanticTokens(value).length > 0)
      .slice(0, 8);
    const plannedQueryAnchors = this.unique(input.plannedQueries ?? [])
      .map((value) => this.compactAnchor(value, 5))
      .filter((value) => this.semanticTokens(value).length >= 2)
      .slice(0, 6);
    const workflowAnchors = this.unique([
      profile.workflow,
      profile.friction ?? '',
      ...profile.failureModes,
      ...profile.consequences,
      ...(profile.evidenceFacets ?? []),
      ...plannedQueryAnchors,
    ])
      .map((value) => this.compactAnchor(value, 10))
      .filter((value) => this.semanticTokens(value).length > 0)
      .slice(0, 16);
    const retrievalIdentityAnchors = this.unique([
      ...identityAnchors,
      ...plannedQueryAnchors,
    ]).slice(0, 14);

    return {
      kind: 'GENERAL',
      label: this.buildDynamicLabel(profile.actor, profile.object, profile.workflow),
      strict: retrievalIdentityAnchors.length > 0 && workflowAnchors.length > 0,
      /*
       * AI-planned queries are allowed to broaden retrieval vocabulary (for
       * example a profession's native term for the same delay/failure). They
       * are only candidate-retrieval anchors; they do not become evidence or a
       * canonical problem. Community AI + canonical verification still decide
       * whether a returned item is trustworthy and semantically relevant.
       */
      requiredAnchors: retrievalIdentityAnchors,
      workflowAnchors,
      // Generic retrieval must not manufacture negative-domain vocabulary.
      // Foreign-workflow rejection belongs to semantic evidence alignment.
      excludedAnchors: [],
    };
  }

  static matchesVertical(
    value: string,
    constraint: RequestVerticalConstraint,
  ): boolean {
    if (!constraint.strict || constraint.requiredAnchors.length === 0) return true;
    const evidenceTokens = new Set(this.semanticTokens(value));
    if (evidenceTokens.size === 0) return false;

    // Identity must be visible in the evidence. One strong short identity
    // anchor (e.g. "soap packaging" or "irrigation pump") is sufficient; a
    // long actor/object phrase needs at least two content-token hits.
    return constraint.requiredAnchors.some((anchor) => {
      const tokens = this.semanticTokens(anchor);
      if (tokens.length === 0) return false;
      const overlap = tokens.filter((token) => evidenceTokens.has(token)).length;
      const required = tokens.length <= 2 ? 1 : 2;
      return overlap >= required && overlap / tokens.length >= 0.34;
    });
  }

  static matchesWorkflow(
    value: string,
    constraint: RequestVerticalConstraint,
  ): boolean {
    if (!constraint.strict || constraint.workflowAnchors.length === 0) return true;
    const evidenceTokens = new Set(this.semanticTokens(value));
    if (evidenceTokens.size === 0) return false;

    return constraint.workflowAnchors.some((anchor) => {
      const tokens = this.semanticTokens(anchor);
      if (tokens.length === 0) return false;
      const overlap = tokens.filter((token) => evidenceTokens.has(token)).length;
      const required = tokens.length <= 2 ? 1 : 2;
      return overlap >= required && overlap / tokens.length >= 0.28;
    });
  }

  private static buildFallbackLabel(input: {
    readonly domainName?: string | null;
    readonly selectedDomainNames?: readonly string[];
  }): string {
    const domains = this.unique([
      input.domainName ?? '',
      ...(input.selectedDomainNames ?? []),
    ]).slice(0, 3);
    return domains.length > 0 ? domains.join(' + ') : 'general request-derived workflow';
  }

  private static buildDynamicLabel(
    actor: string,
    object: string,
    workflow: string,
  ): string {
    return this.unique([actor, object, workflow])
      .join(' / ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 220) || 'request-derived workflow';
  }

  private static compactAnchor(value: string, maxWords: number): string {
    return this.normalize(value)
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, maxWords)
      .join(' ');
  }

  private static semanticTokens(value: string): string[] {
    const stop = new Set([
      'a','an','the','and','or','of','to','in','on','for','with','from','by','at','as','is','are','was','were','be','been','being',
      'this','that','these','those','their','they','them','it','its','often','frequently','usually','commonly','more','most','very',
      'can','could','may','might','should','would','do','does','did','have','has','had','into','across','between','during','through',
      'business','businesses','company','companies','organization','organizations','operator','operators','user','users',
    ]);
    return this.normalize(value)
      .split(/\s+/u)
      .map((token) => this.stemToken(token))
      .filter((token) => token.length >= 3 && !stop.has(token));
  }

  private static stemToken(value: string): string {
    if (value.length > 5 && value.endsWith('ies')) return `${value.slice(0, -3)}y`;
    if (value.length > 5 && value.endsWith('ing')) return value.slice(0, -3);
    if (value.length > 5 && value.endsWith('ed')) return value.slice(0, -2);
    if (value.length > 4 && value.endsWith('es')) return value.slice(0, -2);
    if (value.length > 4 && value.endsWith('s')) return value.slice(0, -1);
    return value;
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
      const normalized = this.normalize(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
    return output;
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}+#./_-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
