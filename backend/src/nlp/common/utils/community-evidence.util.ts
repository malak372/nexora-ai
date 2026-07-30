import type { TextSourceType } from '../../pipeline/types/intelligent-analysis.types';

/**
 * Canonical complaint indicators used by every evidence-producing NLP stage.
 *
 * Keeping these patterns in one utility prevents keyword, problem, need, and
 * opportunity extraction from disagreeing about whether a text is genuine user
 * feedback or only a product description.
 *
 * @author Eman
 */
export const DIRECT_COMMUNITY_COMPLAINT_PATTERNS: readonly RegExp[] = [
  /\bnot useful\b/iu,
  /\bnot helpful\b/iu,
  /\bdoes(?:n['’]?t| not) work\b/iu,
  /\bdid(?:n['’]?t| not) work\b/iu,
  /\b(?:can(?:not|['’]?t)|can\s+not)\b/iu,
  /\bcould(?:n['’]?t| not)\b/iu,
  /\bunable to\b/iu,
  /\bnever (?:receive|received|get|got|arrive|arrived)\b/iu,
  /\b(?:lost|missing|deleted|gone)\b/iu,
  /\b(?:crash|crashes|crashed|crashing|freeze|freezes|frozen|broken|bug|error|failure|failed|failing|looping|glitch|glitches|stuck|unresponsive|disconnect|disconnects|disconnected|disconnecting)\b/iu,
  /\b(?:never|hardly ever)\s+(?:work|works|worked|working|connect|connects|connected)\b/iu,
  /\b(?:trouble|problem|problems|issue|issues)\s+(?:with|connecting|using|opening|syncing)\b/iu,
  /\b(?:does(?:n['’]?t| not)|did(?:n['’]?t| not))\s+(?:connect|sync|open|start|respond|water|execute)\b/iu,
  /\b(?:hard|difficult|confusing) to (?:use|navigate|access|find|download|install|login|log in)\b/iu,
  /\b(?:terrible|disappointing|disappointed|frustrating|frustrated|dysfunctional|janky|horrible)\b/iu,
  /\b(?:too expensive|paywall|have to pay|gotta pay|limited unless paid)\b/iu,
  /(?:غير مفيد|لا يعمل|ما بشتغل|مش شغال|لا أستطيع|لا يمكن|لم يصل|ما وصل|فقدت|اختفت|تعطل|يتعطل|خطأ|مشكلة كبيرة|صعب التنقل|واجهة مربكة)/iu,
];

/** Product-listing and marketing indicators found in app-store descriptions. */
export const PRODUCT_DESCRIPTION_PATTERNS: readonly RegExp[] = [
  /\b(?:why choose|join millions|trusted by|privacy policy|membership details|download .* today|proven results|full curriculum)\b/iu,
  /\b(?:detailed features|app features|key features|features include|official app|available everywhere|available anytime)\b/iu,
  /\b(?:the app has multiple features|this app comprises|with .* you can|designed to|designed for student success)\b/iu,
  /\b(?:state standards alignment|subject coverage|create virtual classrooms|full subject coverage|structured lesson plans)\b/iu,
  /\b(?:for more information|terms of service|kidsafe|coppa-compliant|subscription details)\b/iu,
  /\b(?:your go-to|start your .* today|explore a variety|learn from expert|track your progress|boost your focus)\b/iu,
  /\b(?:ultimate digital platform|tailored for all ages|learn at your own pace|make education simple and accessible)\b/iu,
  /\b(?:our app|our platform|we believe|our goal|perfect for|ideal for|empowering)\b/iu,
];

/**
 * Entertainment and gameplay indicators that must not support opportunities
 * outside gaming-related domains.
 */
export const GAMING_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:video\s+game|mobile\s+game|farming\s+game|simulation\s+game|gameplay|gamer|multiplayer|level|levels|quest|quests|character|characters|save\s+game|save\s+games|restart\s+game|walking\s+controls?|loader\s+controls?|tractor\s+driving|farm\s+valley|bug\s+village)\b/iu,
  /\b(?:play|played|playing)\s+(?:this|the)\s+game\b/iu,
  /\b(?:fun\s+for\s+hours|hours\s+of\s+fun|in[- ]game|game\s+progress)\b/iu,
  /(?:لعبة|ألعاب|اللعب|مراحل\s+اللعبة|حفظ\s+اللعبة|إعادة\s+اللعبة)/iu,
];

/** Returns true when text describes gameplay rather than a software workflow. */
export function isLikelyGamingEvidence(value: string): boolean {
  const normalized = normalizeCommunityText(value);

  return GAMING_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** First-person signals that make a text more likely to be direct feedback. */
const FIRST_PERSON_FEEDBACK_PATTERNS: readonly RegExp[] = [
  /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b/iu,
  /(?:أنا|عندي|معي|نحن|لدينا|ما بقدر)/iu,
];

/**
 * Returns a normalized representation suitable for deterministic matching.
 */
export function normalizeCommunityText(value: string): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
    : '';
}

/**
 * Returns true when the supplied value contains an explicit user complaint.
 */
export function hasDirectCommunityComplaint(value: string): boolean {
  const normalized = normalizeCommunityText(value);

  return DIRECT_COMMUNITY_COMPLAINT_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

/**
 * Detects promotional or release-note text that must never be treated as a
 * community complaint, even when it contains words such as "bug fixes".
 */
export function isLikelyPromotionalEvidence(value: string): boolean {
  const normalized = normalizeCommunityText(value);

  if (!normalized) {
    return false;
  }

  const strongReleaseNotePattern =
    /\b(?:continuous updates?(?:\s*&\s*support)?|we(?:'re| are) constantly improving|new features?,? bug fixes?|enhanced analytics|download .* today|free to start|perfect for)\b/iu;
  const complaintSentences = normalized
    .split(/(?<=[.!?؟])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => hasDirectCommunityComplaint(sentence))
    .filter((sentence) => !strongReleaseNotePattern.test(sentence));
  const marketingSignalCount = PRODUCT_DESCRIPTION_PATTERNS.filter((pattern) =>
    pattern.test(normalized),
  ).length;
  const hasFirstPersonComplaint =
    FIRST_PERSON_FEEDBACK_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    ) && hasDirectCommunityComplaint(normalized);

  /*
   * Mixed reviews sometimes quote release-note or marketing text before
   * describing a real failure. A direct complaint always wins so valid
   * community evidence is not discarded with the promotional fragment.
   */
  const containsIndependentComplaint = complaintSentences.length > 0;

  return (
    (strongReleaseNotePattern.test(normalized) &&
      !containsIndependentComplaint) ||
    (marketingSignalCount >= 2 &&
      !hasFirstPersonComplaint &&
      !containsIndependentComplaint)
  );
}

/**
 * Detects long app-store or product-marketing descriptions.
 *
 * A direct first-person complaint prevents classification as a pure product
 * description. This allows genuine reviews that quote a feature name while
 * still excluding catalog text from problem and need extraction.
 */
export function isLikelyProductDescription(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'POST') {
    return false;
  }

  const normalized = normalizeCommunityText(value);

  if (isLikelyPromotionalEvidence(normalized)) {
    return true;
  }

  const promotionalSignals = PRODUCT_DESCRIPTION_PATTERNS.filter((pattern) =>
    pattern.test(normalized),
  ).length;
  const hasFeatureList =
    /(?:^|\s)(?:features?|benefits?|curriculum|subjects?|tools?)(?::|\s+-)/iu.test(
      value,
    ) ||
    /\b(?:features include|app features|with .* you can)\b/iu.test(value) ||
    (value.match(/(?:^|\n)\s*[-*•]/gu)?.length ?? 0) >= 3;
  const hasFirstPersonFeedback = FIRST_PERSON_FEEDBACK_PATTERNS.some(
    (pattern) => pattern.test(normalized),
  );

  const isLongCatalogDescription =
    normalized.length >= 600 && (promotionalSignals >= 1 || hasFeatureList);
  const isShortMarketingDescription =
    normalized.length >= 120 && promotionalSignals >= 2;

  return (
    (isLongCatalogDescription || isShortMarketingDescription) &&
    !(hasFirstPersonFeedback && hasDirectCommunityComplaint(normalized))
  );
}

/**
 * Detects repository status records, contribution trackers, changelogs, and
 * implementation-governance text that can contain words such as sync,
 * recovery, data, issue, or failed without describing an end-user problem.
 *
 * These records are useful engineering artifacts, but they are not independent
 * community-demand evidence and must not create needs or opportunities.
 */
export function isRepositoryOperationalRecord(value: string): boolean {
  const normalized = normalizeCommunityText(value);

  if (!normalized) {
    return false;
  }

  const strongTrackerSignals = [
    /\bupstream contribution tracker\b/iu,
    /\bupstream contribution status\b/iu,
    /\bstill open\b[\s\S]{0,160}\bmerged\b/iu,
    /\bmerged\b[\s\S]{0,160}\bpull requests?\b/iu,
    /\b(?:pull request|merge request)s?\s*#?\d+\b/iu,
    /\b(?:changelog|release notes?|implementation status|project status)\b/iu,
  ];

  if (strongTrackerSignals.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const repositoryStructureSignals = [
    /github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues?)\/\d+/iu,
    /\b(?:feat|fix|docs|test|chore|refactor)\([^)]*\):/iu,
    /\b(?:rfc|pr|issue)\s*#\d+\b/iu,
    /\b(?:config\.ya?ml|package\.json|schema|fixture|contract)\b/iu,
    /\b(?:repository|maintainer|contribution|commit|branch)\b/iu,
  ];
  const statusSignals = [
    /\b(?:open|merged|closed|approved|pending)\b/iu,
    /(?:✅|⏳|📡|#\s*upstream)/u,
  ];

  const structureCount = repositoryStructureSignals.filter((pattern) =>
    pattern.test(normalized),
  ).length;
  const statusCount = statusSignals.filter((pattern) =>
    pattern.test(normalized),
  ).length;

  return structureCount >= 2 && statusCount >= 1;
}

/**
 * Strong operational-failure signals that make an evidence sentence more
 * useful than a vague mention of a minor bug or glitch.
 */
const STRONG_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:can(?:not|['’]?t)|unable to|won['’]?t|failed to)\s+(?:open|login|log in|connect|disconnect|sync|delete|save|start|stop|turn|control|access|use|pay|send|receive)\b/iu,
  /\b(?:crash(?:es|ed|ing)?|freez(?:e|es|ing)|unresponsive|disconnect(?:s|ed|ing)?|data loss|lost data|missing data)\b/iu,
  /\b(?:can(?:not|['’]?t)|unable to)\s+do anything\b/iu,
  /\b(?:turn|switch|shut)\s+(?:the\s+)?(?:irrigation|water|controller|device)\s+(?:on|off)\b/iu,
  /(?:لا أستطيع|لا يمكن|ما بقدر).*(?:فتح|دخول|اتصال|حذف|حفظ|تشغيل|إيقاف|تحكم)/iu,
  /(?:يتعطل|تعطل|يتجمد|لا يستجيب|ينقطع الاتصال|فقدان البيانات)/iu,
];

/** Positive framing that often makes a complaint too weak to represent a problem. */
const WEAK_POSITIVE_FRAMING_PATTERNS: readonly RegExp[] = [
  /\b(?:working great|works great|great app|love (?:this|the) app|overall good|mostly good)\b/iu,
  /\b(?:minor|small|little|one)\s+(?:bug|glitch|issue)\b/iu,
  /(?:يعمل بشكل رائع|تطبيق رائع|مشكلة بسيطة|خلل بسيط)/iu,
];

/** Ambiguous fragments that should be retained only when a clear failure also exists. */
const AMBIGUOUS_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /\bthere (?:is|are) (?:few|some) [a-z]+\b/iu,
  /\b(?:thing|things|stuff|something|anything)\s+(?:is|are|was|were)?\s*(?:bad|wrong|broken)\b/iu,
  /\b(?:not good|doesn['’]?t feel right|weird)\b/iu,
  /(?:في أشياء|شيء ما|مش منيح|غريب)/iu,
];

/**
 * Scores direct community evidence from 0 to 1.
 *
 * The score is intentionally conservative: explicit workflow failures and
 * blocking operational impact rank above generic mentions such as “a glitch”.
 */
export function scoreCommunityEvidenceQuality(value: string): number {
  const normalized = normalizeCommunityText(value);

  if (!normalized || !hasDirectCommunityComplaint(normalized)) {
    return 0;
  }

  let score = 0.45;

  if (STRONG_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    score += 0.3;
  }

  if (
    FIRST_PERSON_FEEDBACK_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    score += 0.1;
  }

  if (
    /\b(?:app|application|account|controller|device|bluetooth|irrigation|payment|data|file|document|schedule|plan)\b/iu.test(
      normalized,
    )
  ) {
    score += 0.1;
  }

  if (
    WEAK_POSITIVE_FRAMING_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    score -= 0.25;
  }

  if (AMBIGUOUS_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    score -= 0.15;
  }

  const wordCount = normalized.split(/\s+/u).filter(Boolean).length;
  if (wordCount < 5) {
    score -= 0.15;
  }

  return Math.min(1, Math.max(0, Number(score.toFixed(3))));
}

/** Returns true when evidence is too vague to support a recurring problem. */
export function isWeakCommunityEvidence(value: string): boolean {
  return scoreCommunityEvidenceQuality(value) < 0.45;
}

/**
 * Returns true when a text can be used as direct problem or need evidence.
 */
export function isDirectCommunityEvidence(
  value: string,
  sourceType: TextSourceType,
): boolean {
  return (
    !isLikelyPromotionalEvidence(value) &&
    !isLikelyProductDescription(value, sourceType) &&
    !isLikelyGamingEvidence(value) &&
    hasDirectCommunityComplaint(value)
  );
}

/**
 * Builds a short evidence excerpt centered on the sentence that contains the
 * strongest complaint signal.
 */
export function buildCommunityEvidenceExcerpt(
  value: string,
  maxLength: number,
  preferredPatterns: readonly RegExp[] = [],
): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();

  if (!normalized || maxLength <= 0) {
    return '';
  }

  const sentences = normalized
    .split(/(?<=[.!?؟])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const nonPromotionalSentences = sentences.filter(
    (sentence) =>
      !isLikelyPromotionalEvidence(sentence) &&
      !isLikelyGamingEvidence(sentence),
  );
  const preferredSentence = nonPromotionalSentences.find((sentence) =>
    preferredPatterns.some((pattern) => pattern.test(sentence)),
  );
  const complaintSentence = nonPromotionalSentences.find((sentence) =>
    hasDirectCommunityComplaint(sentence),
  );
  const selected = preferredSentence ?? complaintSentence ?? normalized;

  return selected.length <= maxLength
    ? selected
    : `${selected.slice(0, maxLength - 1).trimEnd()}…`;
}
