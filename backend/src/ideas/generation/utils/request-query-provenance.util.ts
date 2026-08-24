import { RequestDynamicQueryUtil } from './request-dynamic-query.util';
import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';

export class RequestQueryProvenanceUtil {
  static isQueryGrounded(input: {
    readonly requestDescription?: string | null;
    readonly query: string;
  }): boolean {
    const request = this.normalize(input.requestDescription ?? '');
    const query = this.normalize(input.query);
    if (!request || !query) return Boolean(query);

    if (this.hasForeignTopicDrift(request, query)) return false;
    if (!this.passesRoleLevelGrounding(request, query)) return false;

    const allowed = this.buildAllowedTokenSet(request);
    const queryTokens = this.semanticTokens(query);
    if (queryTokens.length === 0) return false;

    const grounded = queryTokens.filter((token) => this.matchesAllowedToken(token, allowed));
    const ratio = grounded.length / queryTokens.length;

    const actorTokens = new Set(this.semanticTokens(RequestDynamicQueryUtil.extractActor(request)));
    const workflowTokens = new Set(
      this.semanticTokens(RequestDynamicQueryUtil.extractWorkflowTerms(request).join(' ')),
    );
    const painTokens = new Set(
      this.semanticTokens(RequestDynamicQueryUtil.extractPainTerms(request).join(' ')),
    );
    const identityTokens = new Set(
      this.semanticTokens(RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request).join(' ')),
    );

    const overlap = (set: ReadonlySet<string>): number =>
      queryTokens.filter((token) => set.has(token)).length;
    const axisCount = [
      overlap(actorTokens) > 0 || overlap(identityTokens) > 0,
      overlap(workflowTokens) > 0,
      overlap(painTokens) > 0,
    ].filter(Boolean).length;

    if (ratio >= 0.72) return true;
    if (ratio >= 0.58 && axisCount >= 2) return true;
    return grounded.length >= 3 && axisCount >= 2 && queryTokens.length <= 8;
  }

  static isDerivedConceptGrounded(
    requestDescription: string | null | undefined,
    value: string,
  ): boolean {
    const request = this.normalize(requestDescription ?? '');
    const candidate = this.normalize(value);
    if (!request || !candidate) return Boolean(candidate);
    if (this.hasForeignTopicDrift(request, candidate)) return false;
    if (!this.passesRoleLevelGrounding(request, candidate, true)) return false;

    const allowed = this.buildAllowedTokenSet(request);
    const tokens = this.semanticTokens(candidate);
    if (tokens.length === 0) return false;
    const grounded = tokens.filter((token) => this.matchesAllowedToken(token, allowed));
    return grounded.length >= 1 && grounded.length / tokens.length >= 0.45;
  }

  static filterQueries(
    requestDescription: string | null | undefined,
    queries: readonly string[],
  ): string[] {
    return queries.filter((query) =>
      this.isQueryGrounded({ requestDescription, query }),
    );
  }

  private static buildAllowedTokenSet(request: string): Set<string> {
    const allowed = new Set(this.semanticTokens(request));
    for (const token of this.semanticTokens(RequestDynamicQueryUtil.extractActor(request))) {
      allowed.add(token);
    }
    for (const token of this.semanticTokens(
      RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request).join(' '),
    )) {
      allowed.add(token);
    }
    for (const token of this.semanticTokens(
      RequestDynamicQueryUtil.extractWorkflowTerms(request).join(' '),
    )) {
      allowed.add(token);
    }
    for (const token of this.semanticTokens(
      RequestDynamicQueryUtil.extractPainTerms(request).join(' '),
    )) {
      allowed.add(token);
    }

    const add = (...values: string[]) => values.forEach((value) => allowed.add(this.stem(value)));
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);

    if (/\b(?:transportation|transport|transit|mobility|ticketing|passenger|rail|train|bus|metro|fare)\b/u.test(request)) {
      add('transportation', 'transport', 'transit', 'mobility', 'ticket', 'ticketing', 'fare', 'passenger', 'rail', 'train', 'bus', 'metro', 'booking', 'reservation');
    }
    if (/\b(?:fraud|fraudulent|suspicious|unauthorized|coordinated abuse|account takeover|scam)\b/u.test(request)) {
      add('fraud', 'fraudulent', 'scam', 'abuse', 'suspicious', 'unauthorized', 'fake', 'anomaly', 'risk', 'investigation', 'detect', 'detection', 'coordinated');
    }
    if (/\b(?:account|login|authentication|credential|compromised)\b/u.test(request)) {
      add('account', 'login', 'authentication', 'credential', 'takeover', 'compromise', 'compromised', 'identity', 'access');
    }
    if (/\b(?:payment|payments|refund|refunds|financial loss|chargeback|transaction)\b/u.test(request)) {
      add('payment', 'transaction', 'refund', 'chargeback', 'dispute', 'financial', 'loss');
    }
    if (/\b(?:profit|profitability|production costs?|advertising revenue|subscription activity|audience engagement|cancellation|budget|forecast|content investments?|production spending)\b/u.test(request)) {
      add(
        'media',
        'content',
        'show',
        'video',
        'subscription',
        'subscriber',
        'churn',
        'cancellation',
        'advertising',
        'ad',
        'revenue',
        'cost',
        'expense',
        'spending',
        'budget',
        'forecast',
        'profit',
        'profitability',
        'margin',
        'roi',
        'engagement',
        'audience',
        'performance',
        'investment',
        'attribution',
      );
    }
    if (/\b(?:device|security alert|security alerts|behavior|behaviour)\b/u.test(request)) {
      add('device', 'fingerprint', 'behavior', 'behaviour', 'signal', 'security', 'alert', 'incident');
    }
    if (profile.family === 'RESTORATION_CONSERVATION') {
      add('restoration', 'conservation', 'treatment', 'condition', 'repair', 'history', 'material', 'matching', 'damage', 'original', 'rework');
    }
    if (profile.family === 'FOOD_STORAGE_CONDITION') {
      add('restaurant', 'kitchen', 'refrigerator', 'refrigeration', 'freezer', 'storage', 'temperature', 'ingredient', 'expiration', 'spoilage', 'waste', 'maintenance');
    }
    if (profile.family === 'RENTAL_INVENTORY') {
      add('rental', 'inventory', 'availability', 'booking', 'return', 'deposit', 'accessory', 'condition', 'maintenance', 'damage');
    }
    if (profile.family === 'TRANSACTION_ACCOUNT_ABUSE') {
      add('payment', 'transaction', 'refund', 'booking', 'ticket', 'fare', 'account', 'takeover', 'device', 'security', 'fraud', 'abuse', 'false', 'positive', 'restriction', 'investigation');
    }
    if (profile.family === 'FACILITY_RESOURCE_MONITORING') {
      add('facility', 'building', 'water', 'utility', 'meter', 'submeter', 'consumption', 'usage', 'telemetry', 'leak', 'leakage', 'plumbing', 'maintenance', 'equipment', 'cooling', 'anomaly', 'abnormal', 'inefficient', 'waste', 'sustainability', 'resource', 'zone', 'network', 'failure', 'forecast', 'predict', 'condition');
    }
    if (profile.family === 'SPECIFICATION_APPROVAL') {
      add('measurement', 'dimension', 'material', 'color', 'colour', 'border', 'opening', 'shape', 'specification', 'revision', 'approval', 'approved', 'version', 'customer', 'preference', 'cut', 'rework', 'waste', 'delay');
    }

    return allowed;
  }

  static extractObjectIdentityTokens(value: string): string[] {
    const normalized = this.normalize(value);
    if (!normalized) return [];
    const tokens: string[] = [];
    const add = (token: string) => { if (!tokens.includes(token)) tokens.push(token); };
    const groups: readonly [RegExp, readonly string[]][] = [
      [/\b(?:picture mat|mat cutting|mat board|matting|picture framing|frame shop|framing shop|artwork dimensions?|border widths?|opening shapes?)\b/u, ['picture-mat', 'framing']],
      [/\b(?:glass art|glassblowing|glass artist|custom glass|glass commission)\b/u, ['glass-art']],
      [/\b(?:stained glass restoration|stained glass)\b/u, ['stained-glass']],
      [/\b(?:water consumption|water usage|water meter|water meters|meter readings?|plumbing|leak detection|water leak|wasted water)\b/u, ['water-resource']],
      [/\b(?:electricity consumption|energy consumption|power consumption|electricity meter|energy meter)\b/u, ['energy-resource']],
      [/\b(?:hospital|healthcare facility|medical facility)\b/u, ['healthcare-facility']],
      [/\b(?:transportation|transit|mobility|ticketing|passenger|train company|rail company)\b/u, ['transport-mobility']],
      [/\b(?:rug restoration|antique rug|rug conserv)\w*\b/u, ['rug']],
      [/\b(?:typewriter restoration|typewriter repair|typewriter)\b/u, ['typewriter']],
      [/\b(?:violin case|instrument case)\b/u, ['instrument-case']],
      [/\b(?:restaurant|commercial kitchen|restaurant kitchen)\b/u, ['restaurant-kitchen']],
      [/\b(?:refrigerator|refrigeration|freezer|cold storage|ingredient expiration)\b/u, ['cold-storage']],
      [/\b(?:rental shop|rental store|rental inventory|equipment rental|instrument rental)\b/u, ['rental-inventory']],
    ];
    for (const [pattern, labels] of groups) {
      if (pattern.test(normalized)) labels.forEach(add);
    }
    return tokens;
  }

  static hasObjectIdentityOverlap(
    requestDescription: string | null | undefined,
    candidate: string,
  ): boolean {
    const request = this.normalize(requestDescription ?? '');
    const value = this.normalize(candidate);
    if (!request || !value) return false;
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    const requestObjects = new Set([
      ...this.extractObjectIdentityTokens(request),
      ...profile.objectIdentityTerms.map((item) => this.stem(item.replace(/\s+/gu, '-'))),
    ]);
    const candidateObjects = new Set(this.extractObjectIdentityTokens(value));
    if (requestObjects.size > 0 && candidateObjects.size > 0) {
      for (const token of requestObjects) if (candidateObjects.has(token)) return true;
    }
    const objectTerms = profile.objectIdentityTerms.filter((term) => term.length >= 4);
    return objectTerms.some((term) => value.includes(this.normalize(term)));
  }

  private static passesRoleLevelGrounding(
    request: string,
    query: string,
    derivedConcept = false,
  ): boolean {
    const profile = RequestWorkflowIntentProfileUtil.resolve(request);
    if (profile.family === 'GENERAL') return true;

    if (profile.family === 'FACILITY_RESOURCE_MONITORING') {
      if (/\b(?:surgical scheduling|operating room coordinator|procedure scheduling|clinical scheduling|appointment scheduling|medication|diagnosis|billing claim)\b/u.test(query)) return false;
      const object = /\b(?:water|utility|meter|consumption|usage|leak|plumbing|resource|cooling|equipment)\w*\b/u.test(query);
      const workflow = /\b(?:monitor|anomaly|abnormal|maintenance|fragment|silo|waste|inefficien|detect|reading|telemetry|facility|zone)\w*\b/u.test(query);
      return object && (workflow || derivedConcept);
    }

    if (profile.family === 'CUSTOM_COMMISSION' || profile.family === 'SPECIFICATION_APPROVAL') {
      const requestObjects = this.extractObjectIdentityTokens(request);
      if (requestObjects.length > 0) {
        const candidateObjects = this.extractObjectIdentityTokens(query);
        if (candidateObjects.length > 0 && !candidateObjects.some((item) => requestObjects.includes(item))) return false;
      }
    }

    if (profile.family === 'TRANSACTION_ACCOUNT_ABUSE') {
      const transport = /\b(?:transport|transit|mobility|ticket|fare|passenger|rail|train|bus|metro)\w*\b/u.test(query);
      const abuse = /\b(?:payment|transaction|refund|account|booking|device|security|fraud|scam|abuse|unauthorized|suspicious|restriction)\w*\b/u.test(query);
      return abuse && (transport || derivedConcept || /\b(?:account takeover|payment fraud|refund fraud)\b/u.test(query));
    }

    return true;
  }

  private static hasForeignTopicDrift(request: string, query: string): boolean {
    const groups: readonly (readonly string[])[] = [
      ['agriculture', 'farm', 'farming', 'crop', 'irrigation', 'harvest', 'livestock'],
      ['healthcare', 'medical', 'patient', 'hospital', 'clinic'],
      ['insurance', 'reimbursement'],
      ['manufacturing', 'factory', 'industrial', 'production'],
      ['hotel', 'accommodation', 'tourism', 'tourist'],
      ['restaurant', 'kitchen', 'ingredient', 'foodservice'],
      ['marketplace', 'seller', 'listing', 'ecommerce', 'checkout'],
      ['shipment', 'warehouse', 'cargo', 'freight', 'carrier'],
      ['university', 'academic', 'student', 'school', 'lms', 'examination'],
      ['energy', 'electricity', 'power', 'utility', 'grid'],
      ['property', 'landlord', 'tenant', 'mortgage'],
      ['restoration', 'conservation', 'artisan'],
      ['github', 'kubernetes', 'codebase', 'sdk'],
    ];

    const containsTerm = (value: string, term: string): boolean => {
      const normalizedTerm = this.normalize(term);
      if (!normalizedTerm) return false;
      return ` ${value} `.includes(` ${normalizedTerm} `);
    };

    for (const group of groups) {
      const requestHas = group.some((term) => containsTerm(request, term));
      if (requestHas) continue;
      if (group.some((term) => containsTerm(query, term))) return true;
    }
    return false;
  }

  private static matchesAllowedToken(token: string, allowed: ReadonlySet<string>): boolean {
    if (allowed.has(token)) return true;
    const stemmed = this.stem(token);
    if (allowed.has(stemmed)) return true;
    for (const value of allowed) {
      if (value.length >= 5 && stemmed.length >= 5 && (value.startsWith(stemmed) || stemmed.startsWith(value))) {
        return true;
      }
    }
    return false;
  }

  private static semanticTokens(value: string): string[] {
    const stop = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'without', 'from', 'in', 'on', 'at',
      'by', 'across', 'between', 'into', 'through', 'while', 'when', 'where', 'which', 'that', 'this',
      'these', 'those', 'often', 'struggle', 'struggles', 'difficult', 'making', 'lead', 'leads', 'leading',
      'companies', 'company', 'services', 'service', 'systems', 'system', 'platform', 'platforms', 'operations',
      'workflow', 'problem', 'problems', 'issue', 'issues', 'reviewed', 'review', 'records', 'record', 'information',
      'data', 'early', 'unnecessary', 'legitimate', 'requests', 'request', 'activity', 'activities', 'behavior', 'behaviour',
    ]);
    return this.normalize(value)
      .split(/\s+/u)
      .map((token) => this.stem(token))
      .filter((token) => token.length >= 3 && !stop.has(token));
  }

  private static stem(token: string): string {
    let value = token.toLocaleLowerCase();
    if (/ies$/u.test(value) && value.length > 5) value = `${value.slice(0, -3)}y`;
    else if (/ing$/u.test(value) && value.length > 6) value = value.slice(0, -3);
    else if (/ed$/u.test(value) && value.length > 5) value = value.slice(0, -2);
    else if (/s$/u.test(value) && !/ss$/u.test(value) && value.length > 5) value = value.slice(0, -1);
    return value;
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
