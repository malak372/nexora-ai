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
  /\b(?:crash|crashes|crashed|crashing|freeze|freezes|frozen|broken|bug|error|failure|failed|failing|looping)\b/iu,
  /\b(?:hard|difficult|confusing) to (?:use|navigate|access|find|download|install|login|log in)\b/iu,
  /\b(?:terrible|disappointing|disappointed|frustrating|frustrated|dysfunctional|janky|horrible)\b/iu,
  /\b(?:too expensive|paywall|have to pay|gotta pay|limited unless paid)\b/iu,
  /(?:غير مفيد|لا يعمل|ما بشتغل|مش شغال|لا أستطيع|لا يمكن|لم يصل|ما وصل|فقدت|اختفت|تعطل|يتعطل|خطأ|مشكلة كبيرة|صعب التنقل|واجهة مربكة)/iu,
];

/** Product-listing and marketing indicators found in app-store descriptions. */
const PRODUCT_DESCRIPTION_PATTERNS: readonly RegExp[] = [
  /\b(?:why choose|join millions|trusted by|privacy policy|membership details|download .* today|proven results|full curriculum)\b/iu,
  /\b(?:detailed features|app features|key features|features include|official app|available everywhere|available anytime)\b/iu,
  /\b(?:the app has multiple features|this app comprises|with .* you can|designed to|designed for student success)\b/iu,
  /\b(?:state standards alignment|subject coverage|create virtual classrooms|full subject coverage|structured lesson plans)\b/iu,
  /\b(?:for more information|terms of service|kidsafe|coppa-compliant|subscription details)\b/iu,
  /\b(?:your go-to|start your .* today|explore a variety|learn from expert|track your progress|boost your focus)\b/iu,
  /\b(?:ultimate digital platform|tailored for all ages|learn at your own pace|make education simple and accessible)\b/iu,
  /\b(?:our app|our platform|we believe|our goal|perfect for|ideal for|empowering)\b/iu,
];

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
 * Returns true when a text can be used as direct problem or need evidence.
 */
export function isDirectCommunityEvidence(
  value: string,
  sourceType: TextSourceType,
): boolean {
  return (
    !isLikelyProductDescription(value, sourceType) &&
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

  const preferredSentence = sentences.find((sentence) =>
    preferredPatterns.some((pattern) => pattern.test(sentence)),
  );
  const complaintSentence = sentences.find((sentence) =>
    hasDirectCommunityComplaint(sentence),
  );
  const selected = preferredSentence ?? complaintSentence ?? normalized;

  return selected.length <= maxLength
    ? selected
    : `${selected.slice(0, maxLength - 1).trimEnd()}…`;
}
