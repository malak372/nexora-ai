export type RequestIntentCandidateText = {
  readonly title: string;
  readonly problemStatement: string;
  readonly objectives: readonly string[];
  readonly targetUsers: readonly string[];
  readonly limitedAbstract?: string;
  readonly partialAbstract?: string;
  readonly fullAbstract?: string;
};

export type RequestIntentAlignmentResult = {
  readonly matched: boolean;
  readonly score: number;
  readonly problemScore: number;
  readonly sharedTokenCount: number;
  readonly problemSharedTokenCount: number;
  readonly requiredSharedTokenCount: number;
  readonly supportingSectionCount: number;
  readonly requestTokens: readonly string[];
  readonly sharedTokens: readonly string[];
};

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'are', 'because', 'been',
  'before', 'being', 'between', 'both', 'but', 'can', 'could', 'different',
  'difficulty', 'difficult', 'does', 'during', 'each', 'employee', 'employees', 'every', 'from', 'have',
  'having', 'into', 'just', 'keep', 'keeping', 'large', 'many', 'may', 'more',
  'most', 'much', 'often', 'only', 'other', 'others', 'people', 'private',
  'providers', 'same', 'several', 'should', 'some', 'staff', 'still', 'struggle',
  'struggles', 'struggling', 'such', 'than', 'that', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'usually', 'very',
  'when', 'where', 'which', 'while', 'with', 'without', 'would',
  'application', 'applications', 'data', 'digital', 'information', 'management',
  'platform', 'platforms', 'problem', 'problems', 'product', 'products', 'service',
  'services', 'software', 'solution', 'solutions', 'system', 'systems', 'user',
  'users', 'workflow', 'workflows', 'pilot', 'requester', 'defined', 'validation',
  'current', 'initial', 'proposed', 'selected', 'domain', 'domains',
]);

const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  appointments: 'appointment',
  bookings: 'booking',
  budgets: 'budget',
  caregivers: 'caregiver',
  changes: 'change',
  clinicians: 'clinician',
  contracts: 'contract',
  decorators: 'decorator',
  departments: 'department',
  devices: 'device',
  emissions: 'emission',
  expenses: 'expense',
  fabrics: 'fabric',
  fittings: 'fitting',
  guests: 'guest',
  hospitals: 'hospital',
  interventions: 'intervention',
  licenses: 'license',
  measurements: 'measurement',
  patients: 'patient',
  permits: 'permit',
  photographers: 'photographer',
  records: 'record',
  requests: 'request',
  routines: 'routine',
  schedules: 'schedule',
  signs: 'sign',
  stations: 'station',
  vendors: 'vendor',
  venues: 'venue',
  veterinarians: 'veterinarian',
  vaccinations: 'vaccination',
  weddings: 'wedding',
};

function normalizeToken(token: string): string {
  const aliased = TOKEN_ALIASES[token] ?? token;

  if (aliased.length > 6 && aliased.endsWith('ies')) {
    return `${aliased.slice(0, -3)}y`;
  }

  if (aliased.length > 6 && aliased.endsWith('ing')) {
    return aliased.slice(0, -3);
  }

  if (aliased.length > 5 && aliased.endsWith('ed')) {
    return aliased.slice(0, -2);
  }

  if (aliased.length > 5 && aliased.endsWith('s')) {
    return aliased.slice(0, -1);
  }

  return aliased;
}

function toIntentTokens(value: string): Set<string> {
  const tokens = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\bpick\s+up\b/gu, 'pickup')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/u)
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length >= 4)
    .filter((token) => !STOP_WORDS.has(token));

  return new Set(tokens);
}

function intersection(
  source: ReadonlySet<string>,
  target: ReadonlySet<string>,
): string[] {
  return [...source].filter((token) => target.has(token));
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function detectDominantScript(value: string): 'ARABIC' | 'LATIN' | 'OTHER' {
  const arabicCount = (value.match(/[؀-ۿ]/gu) ?? []).length;
  const latinCount = (value.match(/[A-Za-z]/gu) ?? []).length;

  if (arabicCount >= 3 && arabicCount > latinCount) {
    return 'ARABIC';
  }

  if (latinCount >= 3 && latinCount >= arabicCount) {
    return 'LATIN';
  }

  return 'OTHER';
}

/**
 * Measures whether a generated core idea still solves the requester-described
 * workflow. The premium full abstract is authoritative when present; the short
 * partial abstract is intentionally excluded in that case so copying the
 * requester description into a disclaimer cannot hide a contradictory product.
 */
export function evaluateRequestIntentAlignment(
  requestDescription: string,
  candidate: RequestIntentCandidateText,
): RequestIntentAlignmentResult {
  const requestTokens = toIntentTokens(requestDescription);
  const problemTokens = toIntentTokens(candidate.problemStatement);
  const titleTokens = toIntentTokens(candidate.title);
  const objectiveAndUserTokens = toIntentTokens(
    [...candidate.objectives, ...candidate.targetUsers].join(' '),
  );
  const authoritativeAbstract =
    candidate.fullAbstract?.trim() ||
    candidate.partialAbstract?.trim() ||
    candidate.limitedAbstract?.trim() ||
    '';
  const abstractTokens = toIntentTokens(authoritativeAbstract);
  const narrativeTokens = toIntentTokens(
    [
      candidate.title,
      candidate.problemStatement,
      ...candidate.objectives,
      ...candidate.targetUsers,
      authoritativeAbstract,
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (requestTokens.size === 0) {
    return {
      matched: true,
      score: 1,
      problemScore: 1,
      sharedTokenCount: 0,
      problemSharedTokenCount: 0,
      requiredSharedTokenCount: 0,
      supportingSectionCount: 0,
      requestTokens: [],
      sharedTokens: [],
    };
  }

  const sharedTokens = intersection(requestTokens, narrativeTokens);
  const problemSharedTokens = intersection(requestTokens, problemTokens);
  const titleSharedTokenCount = intersection(requestTokens, titleTokens).length;
  const objectiveAndUserSharedTokenCount = intersection(
    requestTokens,
    objectiveAndUserTokens,
  ).length;
  const abstractSharedTokenCount = intersection(
    requestTokens,
    abstractTokens,
  ).length;
  const score = sharedTokens.length / requestTokens.size;
  const problemScore = problemSharedTokens.length / requestTokens.size;
  const requiredSharedTokenCount =
    requestTokens.size >= 14 ? 4 : requestTokens.size >= 8 ? 3 : 2;
  const supportingSectionCount = [
    titleSharedTokenCount >= 1,
    objectiveAndUserSharedTokenCount >= 2,
    abstractSharedTokenCount >= 2,
  ].filter(Boolean).length;
  const requestScript = detectDominantScript(requestDescription);
  const problemScript = detectDominantScript(candidate.problemStatement);
  const secondaryScript = detectDominantScript(
    [
      candidate.title,
      ...candidate.objectives,
      ...candidate.targetUsers,
      authoritativeAbstract,
    ].join(' '),
  );
  const comparableProblemLanguage =
    requestScript === 'OTHER' ||
    problemScript === 'OTHER' ||
    requestScript === problemScript;
  const comparableSecondaryLanguage =
    requestScript === 'OTHER' ||
    secondaryScript === 'OTHER' ||
    requestScript === secondaryScript;
  const actorMatch = requestDescription.match(
    /^(.{3,90}?)\s+(?:often|frequently|regularly|commonly|sometimes)\s+(?:struggle|struggles|have difficulty|find it difficult)\b/iu,
  );
  const actorTokens = actorMatch?.[1]
    ? [...toIntentTokens(actorMatch[1])].filter(
        (token) =>
          !/^(?:independent|small|local|professional|provider|providers|business|businesses|company|companies|team|teams)$/iu.test(token),
      )
    : [];
  const actorSharedTokens = actorTokens.filter((token) => narrativeTokens.has(token));
  const actorIdentitySatisfied =
    actorTokens.length === 0 ||
    actorSharedTokens.length >= Math.min(2, actorTokens.length);

  const matched =
    !comparableProblemLanguage ||
    (sharedTokens.length >= requiredSharedTokenCount &&
      score >= 0.2 &&
      (problemSharedTokens.length >= 1 || problemScore >= 0.08) &&
      (!comparableSecondaryLanguage || supportingSectionCount >= 1) &&
      actorIdentitySatisfied);

  return {
    matched,
    score: roundScore(score),
    problemScore: roundScore(problemScore),
    sharedTokenCount: sharedTokens.length,
    problemSharedTokenCount: problemSharedTokens.length,
    requiredSharedTokenCount,
    supportingSectionCount,
    requestTokens: [...requestTokens].slice(0, 24),
    sharedTokens: sharedTokens.slice(0, 16),
  };
}

/**
 * Accepts a candidate when the aggregate `matched` flag is false only because
 * one conservative section/actor heuristic missed, while the actual requester
 * problem and solution-side overlap are both materially strong.
 *
 * This intentionally requires much stronger numeric overlap than the ordinary
 * matcher. It is therefore a continuity guard for explicit-problem generation,
 * not a relaxation that allows a same-domain but different workflow to pass.
 */
export function isStrongExplicitProblemAlignment(
  alignment: RequestIntentAlignmentResult,
  solutionAlignment: RequestIntentAlignmentResult,
): boolean {
  return (
    alignment.sharedTokenCount >= alignment.requiredSharedTokenCount &&
    alignment.score >= 0.58 &&
    alignment.problemScore >= 0.5 &&
    solutionAlignment.sharedTokenCount >=
      solutionAlignment.requiredSharedTokenCount &&
    solutionAlignment.score >= 0.28 &&
    solutionAlignment.problemScore >= 0.16 &&
    solutionAlignment.supportingSectionCount >= 1
  );
}
