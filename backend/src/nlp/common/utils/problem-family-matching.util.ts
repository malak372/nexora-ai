export type ProblemFamilyMatch = {
  readonly matched: boolean;
  readonly score: number;
  readonly sharedConcepts: readonly string[];
  readonly sharedTokens: readonly string[];
};

export type EvidenceProblemFamilyCluster = {
  readonly key: string;
  readonly label: string;
  readonly evidenceSamples: readonly string[];
};

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','by','can','could','did','do','does','for','from','had','has','have','he','her','here','hers','him','his','how','i','if','in','into','is','it','its','may','might','more','most','not','of','on','or','our','ours','she','should','so','some','than','that','the','their','theirs','them','there','these','they','this','those','to','too','us','user','users','using','very','was','we','were','what','when','where','which','while','who','will','with','would','you','your',
  'ai','artificial','intelligence','application','app','apps','platform','software','system','systems','digital','tool','tools','workflow','workflows','service','services','product','products','community','comment','reported','report','reports','problem','problems','issue','issues','need','needs','experience','experiencing','encounter','encountered','support','supports',
]);

const FAMILIES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { key: 'invoice-expense-operations', label: 'Invoice and Expense Processing Friction', pattern: /\b(?:invoice processing|invoice approval|invoice mismatch|expense report|expense claim|expense management|reimbursement|accounts payable|accounts receivable)\b/iu },
  { key: 'financial-reconciliation', label: 'Financial Reconciliation and Accounting Friction', pattern: /\b(?:accounting|bookkeeping|reconciliation|ledger|month[- ]end close|financial close|cash flow)\b/iu },
  { key: 'payroll-procurement', label: 'Payroll and Procurement Workflow Friction', pattern: /\b(?:payroll|procurement|purchase order|vendor approval|supplier approval)\b/iu },
  { key: 'administrative-back-office', label: 'Administrative Back-Office Workflow Friction', pattern: /\b(?:approval workflow|administrative workflow|administrative process|back office|manual data entry|manual entry)\b/iu },
  { key: 'billing-payment', label: 'Billing and Payment Failures', pattern: /\b(?:payment|checkout|card|charged|charge|billing|bill|invoice|transaction|refund|price|cost|paywall|subscription)\b/iu },
  { key: 'outage-reliability', label: 'Service Outage and Reliability Failures', pattern: /\b(?:outage|power cut|service down|downtime|offline|unavailable|blackout|disconnect(?:ed|ion)?|interruption)\b/iu },
  { key: 'authentication', label: 'Login and Account Access Failures', pattern: /\b(?:login|log in|authentication|activation|verification|sign in|password|session expired|token|otp|account access)\b/iu },
  { key: 'monitoring-data', label: 'Monitoring and Data Visibility Gaps', pattern: /\b(?:monitor(?:ing)?|dashboard|status|tracking|telemetry|live data|real[- ]time|history|usage view|consumption view)\b/iu },
  { key: 'inaccurate-readings', label: 'Inaccurate Readings and Data Quality', pattern: /\b(?:inaccurate|incorrect|wrong reading|wrong data|reading(?:s)? wrong|measurement|meter reading|precision|not accurate|data is wrong)\b/iu },
  { key: 'energy-consumption', label: 'Energy Consumption Insight Gaps', pattern: /\b(?:energy consumption|electricity usage|power usage|energy usage|consumption|kilowatt|kwh|meter usage|utility usage)\b/iu },
  { key: 'device-sync', label: 'Device Synchronization and Connectivity Failures', pattern: /\b(?:sync|synchroni[sz]|device|bluetooth|wifi|wi-fi|connect|connection|pairing|gateway|sensor|smart meter|firmware)\b/iu },
  { key: 'data-loss', label: 'Data Loss and Persistence Failures', pattern: /\b(?:data loss|lost data|missing data|deleted|disappear(?:ed)?|history missing|not saved|save failed|persistence)\b/iu },
  { key: 'notification', label: 'Notification and Alert Failures', pattern: /\b(?:notification|alert|warning|reminder|push message|didn['’]?t notify|no alert)\b/iu },
  { key: 'navigation-ui', label: 'Navigation and Interface Friction', pattern: /\b(?:navigation|interface|ui|button|menu|layout|screen|hard to use|confusing|cannot find|can['’]?t find)\b/iu },
  { key: 'performance', label: 'Performance and Responsiveness Failures', pattern: /\b(?:slow|lag|latency|freeze|frozen|stuck|unresponsive|takes too long|loading forever)\b/iu },
  { key: 'crash-runtime', label: 'Application Crash and Runtime Failures', pattern: /\b(?:crash|crashes|crashed|bug|error|failure|broken|runtime)\b/iu },
  { key: 'public-transport', label: 'Public Transport Reliability Friction', pattern: /\b(?:public transport|transit|bus|train|rail|metro|route planner|arrival time)\b/iu },
  { key: 'traffic-congestion', label: 'Traffic Congestion and Routing Friction', pattern: /\b(?:traffic|congestion|bottleneck|gridlock|stuck in traffic|route)\b/iu },
  { key: 'delivery-tracking', label: 'Delivery and Shipment Tracking Failures', pattern: /\b(?:delivery|shipment|tracking|driver|courier|proof of delivery)\b/iu },
  { key: 'education-learning', label: 'Learning Workflow Friction', pattern: /\b(?:student|learner|lesson|course|curriculum|education|learning)\b/iu },
  { key: 'agriculture-irrigation', label: 'Agriculture and Irrigation Workflow Failures', pattern: /\b(?:irrigation|crop|farm|farmer|soil|greenhouse|harvest)\b/iu },
  { key: 'mental-health-care', label: 'Mental Health Access Friction', pattern: /\b(?:psychotherap(?:y|ist)|therap(?:y|ist)|counsel(?:ing|ling|or)|mental health|psychological support|behavioral health)\b/iu },
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/community comment:\s*/giu, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stemToken(token: string): string {
  return token
    .replace(/(?:ing|edly|ed|ies|s)$/u, '')
    .replace(/(?:tion|ment)$/u, '')
    .trim();
}

function contentTokens(value: string): Set<string> {
  const normalized = normalize(value);
  const result = new Set<string>();

  for (const rawToken of normalized.split(' ')) {
    const token = stemToken(rawToken);
    if (token.length < 4 || STOP_WORDS.has(rawToken) || STOP_WORDS.has(token)) {
      continue;
    }
    result.add(token);
  }

  return result;
}

function familyKeys(value: string): string[] {
  const normalized = normalize(value);
  return FAMILIES.filter((entry) => entry.pattern.test(normalized)).map(
    (entry) => entry.key,
  );
}

function lexicalFamilyKey(value: string): string {
  const tokens = [...contentTokens(value)].slice(0, 3);
  return tokens.length > 0 ? `lexical:${tokens.join('-')}` : 'generic-friction';
}

function familyLabel(key: string): string {
  const recognized = FAMILIES.find((entry) => entry.key === key)?.label;
  if (recognized) return recognized;

  if (key.startsWith('lexical:')) {
    const words = key
      .slice('lexical:'.length)
      .split('-')
      .filter(Boolean)
      .slice(0, 3)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    if (words.length > 0) return `${words.join(' ')} Workflow Failure`;
  }

  return 'User Workflow Friction';
}

/**
 * Returns concrete problem-family keys discovered directly from evidence text.
 * Recognized families are preferred; a bounded lexical fallback prevents every
 * unknown complaint from collapsing into one fake recurrence bucket.
 */
export function resolveProblemFamilyKeys(value: string): readonly string[] {
  const recognized = familyKeys(value);
  return recognized.length > 0 ? recognized : [lexicalFamilyKey(value)];
}

/** Builds evidence-first problem clusters before any AI wording is considered. */
export function clusterEvidenceByProblemFamily(
  evidenceSamples: readonly string[],
): EvidenceProblemFamilyCluster[] {
  const clusters = new Map<string, string[]>();

  for (const rawSample of evidenceSamples) {
    const sample = rawSample.replace(/\s+/gu, ' ').trim();
    if (!sample) continue;

    const keys = resolveProblemFamilyKeys(sample);
    const primaryKey = keys[0] ?? 'generic-friction';
    const current = clusters.get(primaryKey) ?? [];
    if (!current.some((entry) => normalize(entry) === normalize(sample))) {
      current.push(sample);
      clusters.set(primaryKey, current);
    }
  }

  return [...clusters.entries()]
    .map(([key, samples]) => ({
      key,
      label: familyLabel(key),
      evidenceSamples: samples,
    }))
    .sort(
      (first, second) =>
        second.evidenceSamples.length - first.evidenceSamples.length ||
        first.label.localeCompare(second.label),
    );
}

export function matchEvidenceToProblemFamily(
  problemDescriptor: string,
  evidenceText: string,
): ProblemFamilyMatch {
  const problem = normalize(problemDescriptor);
  const evidence = normalize(evidenceText);

  if (!problem || !evidence) {
    return { matched: false, score: 0, sharedConcepts: [], sharedTokens: [] };
  }

  const problemFamilies = familyKeys(problem);
  const evidenceFamilies = familyKeys(evidence);
  const sharedConcepts = problemFamilies.filter((key) =>
    evidenceFamilies.includes(key),
  );

  const problemTokens = contentTokens(problem);
  const evidenceTokens = contentTokens(evidence);
  const sharedTokens = [...problemTokens].filter((token) =>
    evidenceTokens.has(token),
  );

  const tokenCoverage =
    problemTokens.size === 0 ? 0 : sharedTokens.length / problemTokens.size;
  const evidenceCoverage =
    evidenceTokens.size === 0 ? 0 : sharedTokens.length / evidenceTokens.size;

  /*
   * Evidence-first rule: one concrete shared family is sufficient. We no longer
   * require the Community-AI wording to repeat several lexical tokens from the
   * complaint. This fixes cases where "billing visibility" and "wrong bill"
   * describe the same family using different wording.
   */
  if (sharedConcepts.length > 0) {
    return {
      matched: true,
      score: Number(Math.min(1, 0.72 + Math.min(tokenCoverage, 0.28)).toFixed(4)),
      sharedConcepts,
      sharedTokens,
    };
  }

  /*
   * When both sides contain recognized but disjoint families, do not merge
   * them just because generic words overlap. This preserves the anti-overmerge
   * behavior from the previous fix.
   */
  if (problemFamilies.length > 0 && evidenceFamilies.length > 0) {
    return {
      matched: false,
      score: Number((Math.min(tokenCoverage, evidenceCoverage) * 0.2).toFixed(4)),
      sharedConcepts,
      sharedTokens,
    };
  }

  const strongLexicalMatch =
    sharedTokens.length >= 2 &&
    (tokenCoverage >= 0.2 || evidenceCoverage >= 0.28);
  const score = Number(
    Math.min(1, Math.max(tokenCoverage, evidenceCoverage) * 0.75).toFixed(4),
  );

  return {
    matched: strongLexicalMatch,
    score,
    sharedConcepts,
    sharedTokens,
  };
}

export function filterEvidenceByProblemFamily(
  problemDescriptor: string,
  evidenceSamples: readonly string[],
): string[] {
  return evidenceSamples.filter(
    (sample) => matchEvidenceToProblemFamily(problemDescriptor, sample).matched,
  );
}