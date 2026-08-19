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

    if (this.isMusicalRepairRequest(request)) {
      const instrumentAnchor = /\b(?:musical instrument|instrument|guitar|violin|viola|cello|piano|brass|woodwind|saxophone|clarinet|trumpet|luthier)\b/iu.test(evidence);
      const repairWorkflowAnchor = /\b(?:repair|repairs|repairing|repair shop|luthier|technician|work order|service ticket|parts?|pickup|pick up|intake|bench notes?|repair status|customer status|instrument tracking|instrument left)\b/iu.test(evidence);
      if (!instrumentAnchor || !repairWorkflowAnchor) return false;
      if (/\bvirtual musical instruments?\b/iu.test(evidence) && !repairWorkflowAnchor) return false;
    }

    if (this.isMunicipalDeviceSecurityRequest(request)) {
      const infrastructureAnchor = /\b(?:smart cit(?:y|ies)|municipal|city network|public infrastructure|traffic lights?|traffic signals?|parking sensors?|public cameras?|environmental monitors?|connected devices?|iot devices?|sensors?|municipal devices?)\b/iu.test(evidence);
      const securityAnchor = /\b(?:security|cyber|unauthorized|unmanaged|outdated|firmware|compromised|vulnerab|anomal|unusual behavior|device behavior|intrusion|breach|attack|hack|visibility|inventory|unknown connection|rogue device)\w*\b/iu.test(evidence);
      if (!infrastructureAnchor || !securityAnchor) return false;
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

  private static isMusicalRepairRequest(value: string): boolean {
    return /\b(?:musical instrument|guitar|violin|piano|instrument repair|repair shop|luthier)\b/iu.test(value) &&
      /\b(?:repair|technician|replacement parts?|pickup|paper tags?|repair progress|repair status|intake|notes?)\b/iu.test(value);
  }

  private static isMunicipalDeviceSecurityRequest(value: string): boolean {
    return /\b(?:smart cit(?:y|ies)|municipal|city technology|public services?|traffic lights?|parking sensors?|public cameras?|environmental monitors?)\b/iu.test(value) &&
      /\b(?:security|unauthorized|outdated|compromised|device behavior|connected devices?|iot|firmware|security standards?)\b/iu.test(value);
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
      devices: 'device', sensors: 'sensor', cameras: 'camera', monitors: 'monitor',
      connections: 'connection', standards: 'standard', instruments: 'instrument',
      repairs: 'repair', technicians: 'technician', notes: 'note', parts: 'part',
      dates: 'date', orders: 'order', customers: 'customer', complaints: 'complaint',
      requests: 'request', deliveries: 'delivery', suppliers: 'supplier',
      substitutions: 'substitution', records: 'record', agencies: 'agency',
      buildings: 'building', neighborhoods: 'neighborhood', planners: 'planner',
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

  private static isProblemOrWorkflowSignal(token: string): boolean {
    return /^(?:access|alert|anomal|approval|availability|breach|complaint|conflict|cost|delay|delivery|dispute|error|fail|firmware|forgotten|inventory|missing|note|order|outage|part|pickup|record|repair|request|risk|security|status|supplier|sync|technician|threat|tracking|unauthorized|unmanaged|visibility|waste)$/iu.test(token);
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
