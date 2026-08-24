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
  /\b(?:can(?:not|['’]?t)|can\s+not)\s+(?:access|use|open|start|login|log in|connect|sync|find|download|install|save|submit|approve|pay|send|receive|complete|finish|proceed|manage|process)\b/iu,
  /\bcould(?:n['’]?t| not)\b/iu,
  /\bunable to\b/iu,
  /\bnever (?:receive|received|get|got|arrive|arrived)\b/iu,
  /\b(?:lost|missing|deleted|gone)\b/iu,
  /\b(?:crash|crashes|crashed|crashing|freeze|freezes|frozen|broken|bug|error|failure|failed|failing|looping|glitch|glitches|glitchy|stuck|unresponsive|disconnect|disconnects|disconnected|disconnecting)\b/iu,
  /\b(?:hallucination(?:s)?|hallucinated|fabricated citation(?:s)?|fabricated claim(?:s)?|unsupported claim(?:s)?|wrong facts?|incorrect facts?|unreliable (?:output|outputs|answer|answers|response|responses))\b/iu,
  /\b(?:never|hardly ever)\s+(?:work|works|worked|working|connect|connects|connected)\b/iu,
  /\b(?:trouble|problem|problems|issue|issues)\s+(?:with|connecting|using|opening|syncing)\b/iu,
  /\b(?:does(?:n['’]?t| not)|did(?:n['’]?t| not))\s+(?:connect|sync|open|start|respond|water|execute)\b/iu,
  /\b(?:hard|difficult|confusing) to (?:use|navigate|access|find|download|install|login|log in)\b/iu,
  /\b(?:disappointing|disappointed|frustrating|frustrated|dysfunctional|janky)\b/iu,
  /\b(?:app|application|platform|service|software|product|tool)\b[^.!?]{0,90}\b(?:terrible|horrible)\b|\b(?:terrible|horrible)\b[^.!?]{0,90}\b(?:app|application|platform|service|software|product|tool)\b/iu,
  /\b(?:too expensive|paywall|have to pay|gotta pay|limited unless paid)\b/iu,
  /\b(?:i|we)\b[^.!?]{0,80}\b(?:can(?:not|['’]?t)|unable to)\b[^.!?]{0,100}\b(?:afford|take|schedule|access)\b[^.!?]{0,100}\b(?:time off|mental health|therapy|treatment|care|break|recovery)\b/iu,
  /\b(?:i|we)\b[^.!?]{0,80}\b(?:can(?:not|['’]?t) afford|struggle to afford|cannot take|can['’]?t take)\b[^.!?]{0,100}\b(?:mental health|time off|therapy|treatment|care|break|recovery)\b/iu,
  /\b(?:i|we|my|our)\b[^.!?]{0,180}\b(?:paid|submitted|requested|applied|ordered|booked|completed)\b[^.!?]{0,180}\b(?:but|yet|and)\b[^.!?]{0,120}\b(?:hasn['’]?t|haven['’]?t|has not|have not|still hasn['’]?t|still haven['’]?t|still has not|still have not)\b[^.!?]{0,120}\b(?:given|provided|sent|delivered|issued|returned|approved|processed|received|completed)\b/iu,
  /\b(?:hasn['’]?t|haven['’]?t|has not|have not)\s+(?:given|provided|sent|delivered|issued|returned|approved|processed|completed)\b/iu,
  /\b(?:i|we|my|our)\b[^.!?]{0,160}\b(?:urgently|desperately)\s+need\b/iu,
  /\b(?:invoice|expense|payroll|procurement|reconciliation|bookkeeping|accounting|cash flow|approval workflow|administrative workflow|back office|manual entry|manual data entry)\b[^.!?]{0,120}\b(?:wrong|incorrect|missing|duplicate|delayed|blocked|failed|failing|error|problem|issue|takes too long|manual|confusing|difficult)\b/iu,
  /\b(?:wrong|incorrect|missing|duplicate|delayed|blocked|failed|failing|error|problem|issue|takes too long|confusing|difficult)\b[^.!?]{0,120}\b(?:invoice|expense|payroll|procurement|reconciliation|bookkeeping|accounting|cash flow|approval|administrative process|back office)\b/iu,
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


export type DirectCommunityEvidenceKind =
  | 'USER_COMPLAINT'
  | 'USER_QUESTION'
  | 'GENERAL_COMMENTARY'
  | 'FEATURE_REQUEST'
  | 'OBSERVED_UNMET_NEED'
  | 'NONE';


/**
 * Community comments may describe a concrete shared/systemic problem without
 * using first-person wording. These patterns capture explicit negative impact,
 * bottlenecks, unreliability, congestion, delays, access failures, and similar
 * operational pain while remaining narrower than generic topic commentary.
 *
 * They are applied to COMMENT evidence only, so publisher/video/news narration
 * cannot become direct community evidence from these phrases alone.
 */
const SYSTEMIC_COMMUNITY_PROBLEM_PATTERNS: readonly RegExp[] = [
  /\b(?:stuck in|caus(?:e|es|ed|ing))\s+(?:so much\s+)?(?:traffic|congestion|delay|delays|backlog|downtime|confusion|waste)\b/iu,
  /\b(?:major|serious|significant|constant|chronic)\s+(?:bottleneck|delay|congestion|problem|issue|failure)\b/iu,
  /\b(?:unreliable|unreliability|inconsistent|inconsistency)\b[^.!?]{0,100}\b(?:worse|delay|fail|problem|issue|service|connection|arrival|route|data)\b/iu,
  /\b(?:takes?|taking)\s+(?:too long|forever|hours?)\b/iu,
  /\b(?:manual|spreadsheet[- ]based)\s+(?:invoice|expense|payroll|reconciliation|approval|procurement|administrative|finance|accounting)\b[^.!?]{0,120}\b(?:slow|delay|error|mistake|duplicate|bottleneck|work|workload|process)\b/iu,
  /\b(?:invoice|expense|payroll|reconciliation|approval|procurement|administrative|finance|accounting)\b[^.!?]{0,120}\b(?:bottleneck|backlog|delay|delays|mismatch|duplicate|manual work|rework|error|errors)\b/iu,
  /\b(?:no|poor|insufficient|limited)\s+(?:access|coverage|service|connectivity|availability|reliability)\b/iu,
  /\b(?:lack of|missing|no)\s+(?:customer service|support|compliance|accessibility info(?:rmation)?|lease[- ]term controls?|filtering controls?)\b/iu,
  /\b(?:keeps?|constantly|repeatedly)\s+(?:failing|breaking|disconnecting|delaying|cancelling|canceling|changing)\b/iu,
  /\b(?:for no good reason|makes? (?:it|things?|the situation) (?:even )?worse)\b/iu,
  /(?:ازدحام شديد|عالق(?:ون)? في الازدحام|تأخير مستمر|خدمة غير موثوقة|انقطاع متكرر|مشكلة متكررة)/iu,
];

const FEATURE_REQUEST_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:feature request|please(?: also)? add|please(?: also)? support|should(?: also)? add|you should add|would like|would love to|requesting support for)\b/iu,
  /\bis there any\b[^.!?]{0,140}\b(?:that can|which can|with (?:a )?(?:feature|option|capability)|supporting)\b/iu,
  /\bi wish\s+(?:(?:the\s+)?(?:app|application|platform|service|tool|software|it|they)\b[^.!?]{0,90}\b(?:had|would|could|supported|included|allowed|enabled|offered|provided|added)|(?:there\s+(?:was|were)|i|we)\b[^.!?]{0,90}\b(?:could|were able to|had an? (?:feature|option|setting|way)))\b/iu,
  /\bi hope\b[^.!?]{0,100}\b(?:add|include|support|allow|enable|provide|offer)\b/iu,
  /\b(?:i['’]?m|i am) looking(?: primarily)? for\b[^.!?]{0,120}\b(?:app|application|tool|service|platform|feature|option|capability)\b[^.!?]{0,140}\b(?:that|which|with|shows?|provides?|supports?|lets?|allows?)\b/iu,
  /\b(?:i need|we need)\b[^.!?]{0,80}\b(?:an? )?(?:app|application|tool|service|platform|feature|option|capability)\b[^.!?]{0,140}\b(?:that|which|with|shows?|provides?|supports?|lets?|allows?)\b/iu,
  /\bdo you (?:happen to )?know\b[^.!?]{0,80}\b(?:an? )?(?:app|application|tool|service|platform|alternative)\b[^.!?]{0,140}\b(?:that|which|with|shows?|provides?|supports?)\b/iu,
  /(?:أرجو إضافة|يرجى إضافة|نحتاج ميزة|أتمنى إضافة|اقتراح ميزة|طلب ميزة)/iu,
];

/**
 * Returns true when "would like" expresses an intent to complain/report a
 * problem rather than a request for product capability. This must be checked
 * before the generic feature-request patterns because those intentionally
 * contain the phrase "would like".
 */
function isExplicitComplaintIntent(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  return (
    /\b(?:i|we)\s+(?:would like|want|need|wish)\s+to\s+(?:complain\b|(?:file|submit|make|raise|lodge)\s+(?:a\s+)?complaint\b)/iu.test(
      normalized,
    ) ||
    /\b(?:i|we)\s+(?:would like|want|need|wish)\s+to\s+report\b[^.!?]{0,100}\b(?:problem|issue|incident|misconduct|misbehaviou?r|harassment|abuse|failure|bug|error)\b/iu.test(
      normalized,
    )
  );
}

/**
 * Returns true when a developer is volunteering to work on an existing issue.
 * Contribution intent is not product demand and must never be upgraded to a
 * feature request merely because it contains phrases such as "would like".
 */
export function isDeveloperContributionIntent(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const contributionAction =
    /\b(?:i|we)\b[^.!?]{0,80}\b(?:would like|want|wants|can|could|am happy|are happy|volunteer|offer)\b[^.!?]{0,80}\b(?:take on|work on|pick up|handle|implement|fix|solve|contribute to|help with|help on|help build|join|collaborate on)\b[^.!?]{0,100}\b(?:this|the|an?)?\s*(?:issue|ticket|bug|task|pr|pull request|project|repo|repository|codebase|implementation)\b/iu.test(normalized) ||
    /\b(?:i|we)\b[^.!?]{0,80}\b(?:would like|want|can|could|am happy|are happy|volunteer|offer)\s+to\s+(?:help|contribute|collaborate|join)\b[^.!?]{0,120}\b(?:project|repo|repository|codebase|issue|implementation|team)\b/iu.test(normalized) ||
    /\b(?:i have|i['’]?ve got|we have)\b[^.!?]{0,120}\b(?:experience|worked|skills?|expertise)\b[^.!?]{0,120}\b(?:react|angular|vue|javascript|typescript|flutter|dart|python|java|node(?:\.js)?|frontend|backend|mobile|web)\b[^.!?]{0,120}\b(?:can|could|would like to|happy to)?\s*(?:help|contribute|work on|join)\b/iu.test(normalized) ||
    /\b(?:please )?assign\b[^.!?]{0,80}\b(?:this|the|an?)?\s*(?:issue|ticket|bug|task)\b[^.!?]{0,80}\b(?:to me|to us)\b/iu.test(normalized) ||
    /\b(?:can|could|may) i\b[^.!?]{0,80}\b(?:work on|take on|pick up|handle|implement|fix|help with|contribute to)\b[^.!?]{0,100}\b(?:this|the|an?)?\s*(?:issue|ticket|bug|task|project|repo|repository|codebase)\b/iu.test(normalized);

  return contributionAction;
}

/**
 * Detects a structured issue that explicitly relays a user's report from an
 * external support/community channel. It is useful evidence, but it is not a
 * first-person complaint authored by the affected user in this record.
 */
export function isRelayedCommunityIssueReport(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  return (
    /\brequested by\b[^.!?]{0,120}\b(?:from|via|on)\b[^.!?]{0,80}\b(?:slack|discord|support|support chat|community|forum|email|e-mail)\b/iu.test(normalized) ||
    /\b(?:reported|requested)\b[^.!?]{0,100}\b(?:in|via|from)\b[^.!?]{0,80}\b(?:slack|discord|support|support chat)\b/iu.test(normalized)
  );
}

export function isExplicitTechnicalFeatureRequestEvidence(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'POST') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;
  if (isDeveloperContributionIntent(normalized)) return false;

  const currentCapabilityGap =
    /\b(?:currently|still|at present|today)\b[^.!?]{0,200}\b(?:not handled|not supported|unsupported|missing functionality|not implemented|unavailable|does not support|doesn['’]?t support)\b/iu.test(
      normalized,
    ) ||
    /\b(?:functionality|capability|support|integration|authentication|verification)\b[^.!?]{0,180}\b(?:is missing|is absent|is unavailable|is not handled|is not supported|has not been implemented)\b/iu.test(
      normalized,
    );

  const explicitDemandSignal =
    /\b(?:feature request|requesting support for|please add|please support|we need|i need|would like|should support|must support|needs? to support)\b/iu.test(
      normalized,
    ) ||
    /\b(?:users?|customers?|operators?|public authorities?|downstream services?|potential users?)\b[^.!?]{0,180}\b(?:expect|expects|require|requires|need|needs|depend|depends)\b/iu.test(
      normalized,
    ) ||
    /\b(?:general expectation|out[- ]of[- ]the[- ]box|must not be delayed|cannot be delayed|should not be delayed)\b/iu.test(
      normalized,
    );

  const concreteRequestedCapability =
    /\b(?:support|provide|include|implement|enable|allow|handle|authenticate|verify|verification|integration|functionality|capability)\b/iu.test(
      normalized,
    );

  return currentCapabilityGap && explicitDemandSignal && concreteRequestedCapability;
}

function isComparativeBusinessOutcomeCommentary(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'COMMENT') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const opinionFraming =
    /\b(?:i|we)\s+(?:(?:do not|don['’]?t|dont)\s+)?(?:think|believe|feel|guess)|\b(?:in my opinion|in our opinion|personally)\b/iu.test(
      normalized,
    );
  if (!opinionFraming) return false;

  const generalizedBusinessSubject =
    /\b(?:restaurants?|food trucks?|businesses?|startups?|companies?|shops?|stores?|hotels?|clinics?|hospitals?|agencies?|platforms?|apps?|applications?)\b/iu.test(
      normalized,
    );
  const comparativeOutcome =
    /\b(?:fail|fails|failed|failing|failure|succeed|succeeds|succeeded|success|survive|survives|survived|better|worse|stronger|weaker)\b/iu.test(
      normalized,
    );
  if (!generalizedBusinessSubject || !comparativeOutcome) return false;

  const ownedOrOperatedContext =
    /\b(?:my|our)\s+(?:restaurant|food truck|business|startup|company|shop|store|hotel|clinic|hospital|agency|platform|app|application)\b/iu.test(
      normalized,
    ) ||
    /\b(?:i|we)\s+(?:own|owned|run|ran|operate|operated|manage|managed|work|worked)\b[^.!?]{0,100}\b(?:restaurant|food truck|business|startup|company|shop|store|hotel|clinic|hospital|agency|platform|app|application)\b/iu.test(
      normalized,
    );

  const concreteExperiencedPain =
    /\b(?:i|we|my|our)\b[^.!?]{0,140}\b(?:cannot|can['’]?t|unable|lost|missing|blocked|delayed|charged|refund|crash(?:ed|ing)?|error|bug|stuck|not working|doesn['’]?t work|didn['’]?t work|struggle|struggled)\b/iu.test(
      normalized,
    );

  return !ownedOrOperatedContext && !concreteExperiencedPain;
}

function isBusinessIntentWithoutCapabilityRequest(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const businessIntent =
    /\b(?:i|we)\s+(?:would like|want|plan|hope|intend|am planning|are planning|might|may|could)\s+to\s+(?:start|open|launch|run|operate|sell|serve|build|create)\b[^.!?]{0,180}\b(?:business|shop|store|restaurant|food cart|food truck|cart|bakery|studio|service|company|brand|stall|booth)\b/iu.test(normalized) ||
    /\b(?:i|we)\s+(?:would like|want|plan|hope|intend)\b[^.!?]{0,80}\b(?:food cart|food truck|restaurant|shop|store|business|bakery|studio|service)\b/iu.test(normalized);

  if (!businessIntent) return false;

  const softwareCapabilityRequest =
    /\b(?:app|application|software|platform|tool|dashboard|system|feature|option|capability|integration|automation|tracker|planner|workspace|portal)\b/iu.test(normalized) &&
    /\b(?:need|want|would like|wish|please|add|support|allow|enable|provide|offer|looking for|help me|helps? us|lets? me|lets? us)\b/iu.test(normalized);

  return !softwareCapabilityRequest;
}

function isRetrospectiveWishWithoutCapabilityRequest(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const retrospectiveWish =
    /\bi wish i had (?:this|the|an?)\s+(?:app|application|service|platform|tool)\b[^.!?]{0,100}\b(?:when|back then|earlier|before|years? ago|months? ago|weeks? ago)\b/iu.test(normalized) ||
    /\bi wish i (?:knew|had known|found|discovered|heard)\b[^.!?]{0,100}\b(?:earlier|before|sooner|back then)\b/iu.test(normalized) ||
    /\bi wish (?:this|it) (?:existed|was around|had existed)\b[^.!?]{0,100}\b(?:when|earlier|before|back then)\b/iu.test(normalized);

  if (!retrospectiveWish) return false;

  return !/(?:please(?: also)? add|please(?: also)? support|should(?: also)? add|you should add|i hope[^.!?]{0,80}(?:add|include|support|allow|enable)|i wish\s+(?:(?:the\s+)?(?:app|application|platform|service|tool|software|it|they)\b[^.!?]{0,90}\b(?:had|would|could|supported|included|allowed|enabled|offered|provided|added)|(?:there\s+(?:was|were)|i|we)\b[^.!?]{0,90}\b(?:could|were able to|had an? (?:feature|option|setting|way))))/iu.test(normalized);
}

const THIRD_PARTY_SCENARIO_QUESTION_PATTERNS: readonly RegExp[] = [
  /^\s*(?:what about|what if|how about)\b/iu,
  /^\s*(?:does|do|can|could|should|would|is|are)\s+(?:anyone|someone|people|users|managers|employees|workers|customers|drivers|tenants|students|patients)\b/iu,
  /\bwhat about\s+(?:managers|employees|workers|people|users|customers|drivers|tenants|students|patients)\b/iu,
];

export function isNonActionableCommunityBanter(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'COMMENT') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const humorOrBanter =
    /(?:\b(?:lol|lmao|rofl|haha|hehe|xd)\b|[😂🤣😆😅])/iu.test(normalized) ||
    /\b(?:keep it real|or she['’]?ll|or he['’]?ll|no access to atms?|take all of it)\b/iu.test(normalized);
  if (!humorOrBanter) return false;

  const firstPersonFailure =
    /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b[^.!?]{0,120}\b(?:cannot|can['’]?t|unable|failed|broken|error|bug|glitch(?:y|es)?|crash(?:ed|ing)?|freeze|stuck|lost|missing|charged|blocked|access)\b/iu.test(
      normalized,
    );
  const explicitProductRequest =
    /\b(?:please add|please support|feature request|i need|we need|would like (?:the|an?|to have)|i wish (?:the )?(?:app|platform|service))\b/iu.test(
      normalized,
    );

  return !firstPersonFailure && !explicitProductRequest;
}

export function isEducationalContentFeedback(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'COMMENT') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const contentFeedback =
    /\bone thing i would like to see\s+(?:stressed|emphasized|explained|covered|mentioned)\b/iu.test(normalized) ||
    /\b(?:the video|this video|the course|this course|the lesson|this lesson|the explanation|this explanation)\b[^.!?]{0,140}\b(?:should|could|would|needs? to|missing|cover|explain|stress|emphasize|mention)\b/iu.test(
      normalized,
    );
  if (!contentFeedback) return false;

  const productCapabilityRequest =
    /\b(?:app|application|platform|software|system|service|tool|portal|dashboard)\b[^.!?]{0,140}\b(?:add|support|allow|enable|feature|option|capability)\b/iu.test(
      normalized,
    );

  return !productCapabilityRequest;
}

const GENERAL_COMMENTARY_PATTERNS: readonly RegExp[] = [
  /\b(?:failure rate|success rate) of (?:startups?|businesses?|companies?)\b/iu,
  /\bmajority (?:of )?(?:people|users|startups?|companies|businesses)?\s*(?:want|wants|think|thinks|try|tries|fail|fails)\b/iu,
  /\b(?:in general|generally|overall|industry[- ]wide|across the industry|most startups?|many startups?)\b/iu,
  /\b(?:this is why|that is why|there['’]?s a reason|there is a reason)\b[^.!?]{0,120}\b(?:startups?|businesses?|companies|industry|market)\b/iu,
  /\b(?:startup|business|company)\s+(?:ideas?|failure|success|growth)\b[^.!?]{0,120}\b(?:traction|limits?|market|born|grow|growth)\b/iu,
  /\b(?:many|most|some|a lot of|lots of)\s+(?:people|individuals|workers|employees|professionals|patients|students|users|families|parents|customers)\b[^.!?]{0,180}\b(?:cannot|can['’]?t|struggle|lack|need|have to|are unable|is a luxury|is difficult|is hard|cannot afford|can['’]?t afford)\b/iu,
  /\b(?:people|individuals|workers|employees|professionals|patients|students|users|families|customers)\s+(?:generally|typically|often|commonly)?\s*(?:cannot|can['’]?t|struggle|lack|are unable|cannot afford|can['’]?t afford)\b/iu,
  /\b(?:society|our society|the public|the workforce|the industry)\b[^.!?]{0,180}\b(?:cannot|can['’]?t|struggle|lack|problem|issue|barrier|luxury|afford)\b/iu,
];

export function isTechnicalTroubleshootingReply(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'COMMENT') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const explicitFirstPersonFailure =
    /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b[^.!?]{0,160}\b(?:cannot|can['’]?t|unable|failed|fails?|error|bug|crash(?:ed|ing)?|freeze|stuck|lost|missing|charged|blocked|insufficient funds|not working|doesn['’]?t work)\b/iu.test(
      normalized,
    );
  if (explicitFirstPersonFailure) return false;

  const diagnosticQuestion =
    /\b(?:is this your case|does this happen to you|what is the value of|what(?:'s| is) the value of|have you (?:tried|checked|verified|confirmed)|did you (?:try|check|verify|confirm)|can you (?:share|provide|check|confirm)|could you (?:share|provide|check|confirm))\b/iu.test(
      normalized,
    );
  const troubleshootingInstruction =
    /^(?:please\s+)?(?:try|check|verify|confirm|share|provide|post|run|inspect|look at|make sure)\b/iu.test(
      normalized,
    );
  const thirdPartyReference =
    /\baccording to\b[^.!?]{0,100}\b(?:comment|github|issue|docs?|documentation|answer|thread)\b/iu.test(
      normalized,
    ) ||
    /\bone of the cases? that (?:return|returns|cause|causes|produce|produces) this error\b/iu.test(
      normalized,
    );

  return diagnosticQuestion || troubleshootingInstruction || thirdPartyReference;
}

function isGeneralCommentaryWithoutUserProblem(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'COMMENT') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const commentarySignal = GENERAL_COMMENTARY_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  if (!commentarySignal) return false;

  const firstPersonExperience =
    /\b(?:i|i['’]?m|i['’]?ve|i had|i paid|i used|i tried|my|me|we|we['’]?ve|our)\b/iu.test(
      normalized,
    ) &&
    /\b(?:cannot|can['’]?t|unable|failed|broken|error|bug|charged|lost|missing|delayed|stuck|refund|payment|delivery|login|account|app|service|afford|time off|mental health|access|treatment)\b/iu.test(
      normalized,
    );

  return !firstPersonExperience;
}

function isThirdPartyScenarioQuestion(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'COMMENT') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  if (/\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b/iu.test(normalized)) {
    return false;
  }

  return THIRD_PARTY_SCENARIO_QUESTION_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}


/**
 * Detects a real pre-existing user need embedded inside an otherwise positive
 * testimonial. The negative wording describes the user's own prior limitation
 * or memory/organization need, not a failure of the product being reviewed.
 *
 * This keeps reviews such as "I have a terrible memory, wanted a way to remember
 * places, found this app, and love it" as OBSERVED_UNMET_NEED instead of a
 * USER_COMPLAINT merely because the word "terrible" appears.
 */
export function isPositiveTestimonialWithPreExistingNeed(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const priorNeed =
    /\b(?:i|we|my|our)\b[^.!?]{0,180}\b(?:wanted|needed|was looking for|were looking for|looked for|wished for|wish i had|have a (?:terrible|bad|poor) memory|had a (?:terrible|bad|poor) memory|forget|forgot|hard time remembering|difficulty remembering|struggle to remember|struggled to remember|couldn['’]?t remember|cannot remember|can['’]?t remember)\b[^.!?]{0,200}\b(?:way|app|application|tool|service|place|history|diary|journal|record|tracker|track|remember|recall|organize|record|save|find|notes?|visits?|meals?|restaurants?|places?)\b/iu.test(normalized) ||
    /\b(?:remember|recall|track|record|organize|save|find)\b[^.!?]{0,140}\b(?:past|previous|where|what|places?|visits?|meals?|restaurants?|orders?|items?|notes?|history)\b[^.!?]{0,160}\b(?:wanted|needed|looking for|wish|hard|difficult|forget|forgot|memory)\b/iu.test(normalized) ||
    /\b(?:i|we)\s+(?:wish|wished)\s+(?:there\s+(?:was|were)|for)\b[^.!?]{0,140}\b(?:way|app|application|tool|service|place|history|diary|journal|record|tracker|option|feature)\b/iu.test(normalized);

  if (!priorNeed) return false;

  const successfulDiscoveryOrPraise =
    /\b(?:found|discovered|came across|started using|use|using|love|like|liked|great|excellent|awesome|helpful|exactly what i wanted|exactly what i needed|works well|works great|makes it easy|lets? me|allows? me)\b/iu.test(normalized);

  const currentProductFailure =
    /\b(?:app|application|platform|service|software|product|tool)\b[^.!?]{0,120}\b(?:doesn['’]?t work|didn['’]?t work|failed|fails|failure|error|bug|crash|broken|stuck|missing|lost|wrong|incorrect|unusable|unresponsive)\b|\b(?:doesn['’]?t work|didn['’]?t work|failed|fails|failure|error|bug|crash|broken|stuck|missing|lost|wrong|incorrect|unusable|unresponsive)\b[^.!?]{0,120}\b(?:app|application|platform|service|software|product|tool)\b/iu.test(normalized);

  return successfulDiscoveryOrPraise && !currentProductFailure;
}

export function isObservedUnmetNeedEvidence(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const firstPersonNeed =
    /\b(?:i|we|my|our)\b[^.!?]{0,180}\b(?:need(?:ed)?|want(?:ed)?|wish(?:ed)?|look(?:ed|ing) for|lack(?:ed|ing)?|did not have|didn['’]?t have|have not always had|haven['’]?t always had|not always had|struggl(?:e|ed|ing) to find|hard to find|difficult to find)\b[^.!?]{0,180}\b(?:support|help|guidance|someone|person|people|ear|listener|space|place|way|option|tool|service|access|care|feedback|information|workflow|capability|memory|history|diary|journal|record|tracker|tracking|organization|organisation)\b/iu.test(
      normalized,
    );
  const inverseNeed =
    /\b(?:support|help|guidance|someone|person|people|ear|listener|space|place|way|option|tool|service|access|care|feedback|information|workflow|capability|memory|history|diary|journal|record|tracker|tracking|organization|organisation)\b[^.!?]{0,150}\b(?:i|we)\b[^.!?]{0,100}\b(?:need(?:ed)?|lack(?:ed)?|did not have|didn['’]?t have|have not always had|not always had)\b/iu.test(
      normalized,
    );

  if (!firstPersonNeed && !inverseNeed) return false;

  return !hasDirectCommunityComplaint(normalized);
}

export function isPositiveFeedbackWithoutProblem(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const positiveSignal =
    /\b(?:thank you|thanks|thank u|helped me|has helped|very helpful|so helpful|helpful tool|responses? (?:are|were) on point|on point and|exactly what i needed|piece i was missing|love this|love it|works great|working great|great explanation|great video|excellent|awesome|amazing|lifesaver|life saver|simple and elegant|simple\.? elegant|easy to use|refreshing|feel(?:s)? so much calmer|feel(?:s)? calmer|look forward to continuing|you can rely on|that['’]?s what i need|thats what i need|best part(?: for me)?|robust (?:app|application|tool)|step above (?:many )?competitors|makes all the difference)\b/iu.test(
      normalized,
    );
  if (!positiveSignal) return false;

  const praiseNeedPhrase =
    /\b(?:what i need|what we need|exactly what i need|exactly what we need)\b/iu.test(
      normalized,
    );
  const explicitRequest = FEATURE_REQUEST_EVIDENCE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  ) && !isDeveloperContributionIntent(normalized);
  if (explicitRequest && !praiseNeedPhrase) return false;

  /*
   * Remove explicitly negated self-description before looking for failure
   * vocabulary. "I am not broken" is praise/reassurance, not a broken-app
   * report. Likewise, inability to find another person to open up to describes
   * social-access context and must not be confused with UI search failure.
   */
  const failureText = normalized
    .replace(/\b(?:i am|i['’]?m|you are|you['’]?re|we are|we['’]?re|not|isn['’]?t|wasn['’]?t)\s+(?:actually\s+)?broken\b/giu, ' ')
    .replace(/\b(?:i|we)\s+can['’]?t\s+find\s+(?:anyone|someone|people|a person|anybody|somebody)\b[^.!?]{0,100}\b(?:open up|talk to|speak to|listen)\b/giu, ' ')
    .replace(/\b(?:you(?:['’]?re| are)|we(?:['’]?re| are)|i(?:['’]?m| am)|it(?:['’]?s| is)|they(?:['’]?re| are))\s+not\s+stuck\b[^.!?]{0,100}/giu, ' ')
    .replace(/\b(?:not|never)\s+(?:limited|restricted|confined)\s+to\b[^.!?]{0,100}/giu, ' ')
    .replace(/\b(?:no|never had|haven['’]?t had|have not had|didn['’]?t have|did not have)\s+(?:any\s+)?(?:problem|problems|issue|issues|difficulty|difficulties)\b/giu, ' ')
    .replace(/\b(?:works? without (?:a |any )?(?:problem|issue)|no performance issues?)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  const explicitFailure =
    /\b(?:doesn['’]?t work|didn['’]?t work|not working|failed to|fails to|failure|error|bug|glitch(?:y|es)?|crash(?:es|ed|ing)?|freeze|frozen|unresponsive|stuck|blocked|paywall|too expensive|wrong|incorrect|frustrating|frustrated)\b/iu.test(
      failureText,
    );
  const operationalInability =
    /\b(?:cannot|can['’]?t|unable to|couldn['’]?t)\s+(?:access|use|open|start|login|log in|connect|sync|download|install|save|submit|approve|pay|send|receive|complete|finish|proceed|manage|process|load|record|transcribe|upload)\b/iu.test(
      failureText,
    ) ||
    /\b(?:cannot|can['’]?t|unable to)\s+(?:easily\s+)?find\b[^.!?]{0,90}\b(?:services?|pages?|options?|settings?|information|features?|controls?)\b/iu.test(
      failureText,
    );
  const missingObjectProblem =
    /\b(?:data|history|file|files|record|records|progress|draft|drafts|saved item|saved items|favorite|favorites|note|notes|profile|profiles|state|memory|voice|voices|asset|assets|conversation|conversations)\b[^.!?]{0,45}\b(?:missing|gone|deleted|lost|disappeared)\b/iu.test(
      failureText,
    ) ||
    /\b(?:missing|gone|deleted|lost|disappeared)\b[^.!?]{0,45}\b(?:data|history|file|files|record|records|progress|draft|drafts|saved item|saved items|favorite|favorites|note|notes|profile|profiles|state|memory|voice|voices|asset|assets|conversation|conversations)\b/iu.test(
      failureText,
    );

  return !explicitFailure && !operationalInability && !missingObjectProblem;
}

/**
 * Detects proposals to deliberately cause a failure, disruption, overload,
 * confusion, resource drain, or similar harmful behavior. These statements
 * are ideas/actions, not reports that the author experienced a product pain.
 * The rule is deliberately domain-agnostic.
 */
export function isProposedAdversarialAction(value: string): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const proposal =
    /\b(?:we should|should we|let['’]?s|lets|you should|they should|can we|could we|why don['’]?t we|fight back (?:by|with)|how about we)\b[^.!?]{0,180}\b(?:break|crash|confus(?:e|ing)|overload|flood|spam|attack|bomb|waste|drain|loop|jam|disable|disrupt|take down|knock offline|exhaust)\b/iu.test(normalized) ||
    /\b(?:make|force|cause)\s+(?:it|them|the\s+(?:app|system|service|model|server|platform))\b[^.!?]{0,100}\b(?:loop|crash|fail|freeze|confus(?:e|ed|ing)|waste|drain|overload|hang|break)\b/iu.test(normalized);

  if (!proposal) return false;

  const explicitExperiencedFailure =
    /\b(?:i|we|my|our)\b[^.!?]{0,100}\b(?:cannot|can['’]?t|unable|doesn['’]?t work|didn['’]?t work|failed|crashed|froze|broken|stuck|unresponsive|lost|missing|charged|blocked)\b/iu.test(normalized);

  return !explicitExperiencedFailure;
}

/**
 * One canonical evidence classifier used by collection, domain-evidence
 * projection, and recurrence verification.
 */
function hasActionableCommunityComplaintIntent(
  value: string,
  sourceType: TextSourceType,
): boolean {
  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;
  if (sourceType !== 'COMMENT') return hasDirectCommunityComplaint(normalized);

  const firstPersonOperationalPain =
    /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b[^.!?]{0,180}\b(?:cannot|can['’]?t|couldn['’]?t|unable|failed|fails?|error|bug|crash(?:ed|ing)?|freeze|frozen|stuck|unresponsive|broken|blocked|missing|lost|delayed|late|wrong|incorrect|charged|refund|hallucination(?:s)?|hallucinated|fabricated|unsupported claim(?:s)?|wrong facts?|incorrect facts?|unreliable (?:output|outputs|answer|answers|response|responses)|not working|doesn['’]?t work|didn['’]?t work|couldn['’]?t return|can['’]?t return|won['’]?t open|won['’]?t load|won['’]?t sync)\b/iu.test(normalized) ||
    /\b(?:cannot|can['’]?t|couldn['’]?t|unable|failed|error|bug|glitch(?:y|es)?|crash(?:ed|ing)?|freeze|frozen|stuck|unresponsive|broken|blocked|missing|lost|delayed|wrong|incorrect|charged|refund|hallucination(?:s)?|hallucinated|fabricated|unsupported claim(?:s)?|wrong facts?|incorrect facts?|unreliable (?:output|outputs|answer|answers|response|responses)|not working|doesn['’]?t work|didn['’]?t work)\b[^.!?]{0,180}\b(?:i|me|my|we|us|our)\b/iu.test(normalized);

  const explicitWorkflowFailure =
    /\b(?:app|application|account|login|sign[- ]?in|session|payment|checkout|order|delivery|deliveries|shipment|shipments|package|packages|parcel|parcels|tracking|booking|reservation|appointment|file|files|data|record|records|dashboard|website|server|service|device|connection|sync|notification|notifications|response|answer|upload|download)\b[^.!?]{0,150}\b(?:cannot|can['’]?t|unable|failed|fails?|failure|error|bug|crash(?:es|ed|ing)?|freeze|frozen|stuck|unresponsive|broken|blocked|missing|lost|delayed|late|wrong|incorrect|not working|doesn['’]?t work|didn['’]?t work|won['’]?t open|won['’]?t load|won['’]?t sync|not updating|never arrived|never received)\b/iu.test(normalized) ||
    /\b(?:cannot|can['’]?t|unable|failed|fails?|failure|error|bug|crash(?:es|ed|ing)?|freeze|frozen|stuck|unresponsive|broken|blocked|missing|lost|delayed|late|wrong|incorrect|not working|doesn['’]?t work|didn['’]?t work|not updating|never arrived|never received)\b[^.!?]{0,150}\b(?:app|application|account|login|session|payment|checkout|order|delivery|deliveries|shipment|shipments|package|packages|parcel|parcels|tracking|booking|reservation|appointment|file|files|data|record|records|dashboard|website|server|service|device|connection|sync|notification|notifications|response|answer|upload|download)\b/iu.test(normalized);

  const concreteOperationalImpact =
    /\b(?:missed deliver(?:y|ies)|missing deliver(?:y|ies)|lost package|lost shipment|late delivery|delivery delay|shipment delay|duplicate charge|charged twice|locked out|unable to enter|unable to open|unable to use|unable to access|server response error|no response|still not working|keeps? (?:failing|crashing|disconnecting|logging me out)|repeated sign[- ]?in attempts?)\b/iu.test(normalized);
  const unresolvedExpectedOutcome =
    /\b(?:i|we|my|our)\b[^.!?]{0,180}\b(?:paid|submitted|requested|applied|ordered|booked|completed)\b[^.!?]{0,180}\b(?:hasn['’]?t|haven['’]?t|has not|have not|still hasn['’]?t|still haven['’]?t|still has not|still have not)\b[^.!?]{0,120}\b(?:given|provided|sent|delivered|issued|returned|approved|processed|received|completed)\b/iu.test(normalized) ||
    /\b(?:hasn['’]?t|haven['’]?t|has not|have not)\s+(?:given|provided|sent|delivered|issued|returned|approved|processed|completed)\b/iu.test(normalized);

  return (
    firstPersonOperationalPain ||
    explicitWorkflowFailure ||
    concreteOperationalImpact ||
    unresolvedExpectedOutcome ||
    SYSTEMIC_COMMUNITY_PROBLEM_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    )
  );
}


export function isSpeculativeWorkflowDiscussionWithoutExperiencedFailure(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'COMMENT') return false;

  const normalized = normalizeCommunityText(value);
  if (!normalized) return false;

  const hypotheticalQuestions = normalized.match(
    /\b(?:how would|how could|what would|what if|could (?:the|this|that|it)|would (?:the|this|that|it)|if i|if we|if (?:a|the) user|how is|how are|what happens if)\b[^?]{0,180}\?/giu,
  ) ?? [];
  const workflowSpeculation =
    hypotheticalQuestions.length >= 2 ||
    (
      /\b(?:how would i actually use this|what are you trying to achieve|actual implementation|how would offering|could the chain deny my transaction|would it send me a message)\b/iu.test(
        normalized,
      ) &&
      /\b(?:blockchain|transaction|merchant|payment|shop|discount|implementation)\b/iu.test(
        normalized,
      )
    );

  if (!workflowSpeculation) return false;

  const targetSystemExperience =
    /\b(?:i|we|my|our)\b[^.!?]{0,120}\b(?:used|tried|paid with|checked out with|connected|linked|sent|submitted)\b[^.!?]{0,120}\b(?:blockchain|wallet|payment|checkout|transaction|merchant|card|bank)\b[^.!?]{0,120}\b(?:failed|error|declined|rejected|blocked|stuck|missing|wrong|incorrect|charged|refund|not working|doesn['’]?t work|unable|cannot|can['’]?t)\b/iu.test(
      normalized,
    ) ||
    /\b(?:blockchain|wallet|payment|checkout|transaction|merchant|card|bank)\b[^.!?]{0,120}\b(?:failed|error|declined|rejected|blocked|stuck|missing|wrong|incorrect|charged|refund|not working|doesn['’]?t work)\b[^.!?]{0,120}\b(?:i|we|my|our)\b/iu.test(
      normalized,
    );

  return !targetSystemExperience;
}

export function classifyDirectCommunityEvidence(
  value: string,
  sourceType: TextSourceType,
): DirectCommunityEvidenceKind {
  const rawNormalized = normalizeCommunityText(value);
  const normalized =
    sourceType === 'COMMENT'
      ? rawNormalized.replace(/^.*?\bcommunity comment:\s*/iu, '').trim()
      : rawNormalized;
  if (!normalized || normalized.length < 8) return 'NONE';
  const semanticNormalized = normalized
    .replace(/\bcrash[- ]course\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const explicitTechnicalFeatureRequest =
    isExplicitTechnicalFeatureRequestEvidence(semanticNormalized, sourceType);
  const explicitComplaintIntent = isExplicitComplaintIntent(semanticNormalized);

  if (
    isProposedAdversarialAction(semanticNormalized) ||
    (!explicitTechnicalFeatureRequest &&
      (isLikelyPromotionalEvidence(semanticNormalized) ||
        (isLikelyProductDescription(semanticNormalized, sourceType) &&
          !isPositiveTestimonialWithPreExistingNeed(semanticNormalized)))) ||
    isLikelyGamingEvidence(semanticNormalized) ||
    isNonActionableCommunityBanter(normalized, sourceType)
  ) {
    return 'NONE';
  }

  if (explicitComplaintIntent) {
    return 'USER_COMPLAINT';
  }

  if (isRetrospectiveWishWithoutCapabilityRequest(semanticNormalized)) {
    return 'NONE';
  }

  if (isBusinessIntentWithoutCapabilityRequest(semanticNormalized)) {
    return 'GENERAL_COMMENTARY';
  }

  if (isComparativeBusinessOutcomeCommentary(semanticNormalized, sourceType)) {
    return 'GENERAL_COMMENTARY';
  }

  if (
    isSpeculativeWorkflowDiscussionWithoutExperiencedFailure(
      semanticNormalized,
      sourceType,
    )
  ) {
    return 'GENERAL_COMMENTARY';
  }

  if (isDeveloperContributionIntent(semanticNormalized)) {
    return 'GENERAL_COMMENTARY';
  }

  if (isRelayedCommunityIssueReport(semanticNormalized)) {
    return 'OBSERVED_UNMET_NEED';
  }

  if (isPositiveTestimonialWithPreExistingNeed(semanticNormalized)) {
    return 'OBSERVED_UNMET_NEED';
  }

  if (explicitTechnicalFeatureRequest) {
    return 'FEATURE_REQUEST';
  }

  if (isObservedUnmetNeedEvidence(semanticNormalized)) {
    return 'OBSERVED_UNMET_NEED';
  }

  if (isPositiveFeedbackWithoutProblem(semanticNormalized)) {
    return 'NONE';
  }

  if (
    isThirdPartyScenarioQuestion(semanticNormalized, sourceType) ||
    isTechnicalTroubleshootingReply(semanticNormalized, sourceType)
  ) {
    return 'USER_QUESTION';
  }

  if (isGeneralCommentaryWithoutUserProblem(semanticNormalized, sourceType)) {
    return 'GENERAL_COMMENTARY';
  }

  if (isEducationalContentFeedback(semanticNormalized, sourceType)) {
    return 'GENERAL_COMMENTARY';
  }

  const negatedProblemOnly =
    /\b(?:i|we)\s+(?:do not|don['’]?t|dont|did not|didn['’]?t|didnt)\s+(?:have|see|find|experience)\s+(?:a\s+)?(?:problem|issue|difficulty)\b/iu.test(semanticNormalized) &&
    !/\b(?:but|however|except|although)\b[^.!?]{0,120}\b(?:cannot|can['’]?t|unable|failed|failure|error|bug|wrong|incorrect|missing|issue|problem|difficulty|struggle|need|request)\b/iu.test(semanticNormalized);
  if (negatedProblemOnly) return 'NONE';

  if (FEATURE_REQUEST_EVIDENCE_PATTERNS.some((pattern) => pattern.test(semanticNormalized))) {
    return 'FEATURE_REQUEST';
  }

  const contextualUserNeed =
    /\b(?:i|we|my|our|user|users|customer|customers|operator|operators|learner|learners|student|students|developer|developers|farmer|farmers|seller|sellers|buyer|buyers)\b[^.!?]{0,80}\b(?:need|needs)\b/iu.test(semanticNormalized);

  const systemicCommunityProblem =
    sourceType === 'COMMENT' &&
    SYSTEMIC_COMMUNITY_PROBLEM_PATTERNS.some((pattern) =>
      pattern.test(semanticNormalized),
    );

  if (
    contextualUserNeed &&
    !hasDirectCommunityComplaint(semanticNormalized) &&
    !systemicCommunityProblem
  ) {
    return 'OBSERVED_UNMET_NEED';
  }

  const directComplaint = hasDirectCommunityComplaint(semanticNormalized);
  return (directComplaint || systemicCommunityProblem) &&
    hasActionableCommunityComplaintIntent(semanticNormalized, sourceType)
    ? 'USER_COMPLAINT'
    : 'NONE';
}

/**
 * Detects a structured problem/JTBD record that describes an operational pain
 * with enough context to be useful evidence even when it is not written in
 * first person. These records are intentionally NOT upgraded to direct-user
 * complaints; provenance verification may still classify them as a secondary
 * report. The purpose of this detector is only to prevent a rich retained
 * problem record from being discarded in favour of a generic headline.
 */
export function isStructuredOperationalProblemEvidence(
  value: string,
  sourceType: TextSourceType,
): boolean {
  if (sourceType !== 'POST') return false;

  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return false;
  if (
    isLikelyPromotionalEvidence(raw) ||
    isLikelyProductDescription(raw, sourceType) ||
    isRepositoryOperationalRecord(raw) ||
    isLikelyGamingEvidence(raw)
  ) {
    return false;
  }

  const sectionText = raw.replace(/[*_]+/gu, ' ');

  const labelledSections = [
    /(?:^|\s)(?:#{1,6}\s*)?(?:problem|user problem|pain point|unmet need)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:jtbd|job to be done)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:context\s*(?:&|and)\s*frequency|frequency|recurrence)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:pain\s*(?:\/|&|and)\s*stakes|impact|consequences?)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:current workaround|workaround)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:trigger\s*(?:\/|&|and)\s*failure moment|failure moment)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:persona|domain|theme|subtheme)\s*:/iu,
  ].filter((pattern) => pattern.test(sectionText)).length;

  const normalized = normalizeCommunityText(raw);
  const explicitOperationalPain =
    /\b(?:missed|missing|doubled|duplicate|wrong|incorrect|skipped|forgotten|overdue|delayed|delay|blocked|unable|cannot|can['’]?t|failure|failed|failing|error|risk|unsafe|shortage|waste|backlog|bottleneck|manual|paper|spreadsheet|rework|lost|unavailable)\b/iu.test(
      normalized,
    );
  const affectedWorkflow =
    /\b(?:patients?|caregivers?|famil(?:y|ies)|medications?|doses?|prescriptions?|screenings?|checkups?|appointments?|healthcare|medical|hospitals?|clinics?|employees?|candidates?|applicants?|recruitment|manufacturing|factor(?:y|ies)|production|maintenance|tourism|bookings?|hotels?|travel|legal|contracts?|compliance|propert(?:y|ies)|tenants?|restaurants?|inventory|deliver(?:y|ies)|shipments?|energy|grid)\b/iu.test(
      normalized,
    );

  return labelledSections >= 2 && explicitOperationalPain && affectedWorkflow;
}

/**
 * Scores evidence by how useful it is for choosing a concrete software
 * opportunity. The score deliberately rewards explicit problem statements,
 * affected-user context, recurrence, consequences, workarounds, and failure
 * moments. A generic publisher headline therefore cannot outrank a detailed
 * structured JTBD/problem record merely because both are in the same domain.
 */
export function scoreProblemEvidenceActionability(
  value: string,
  sourceType: TextSourceType,
): number {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 0;
  if (
    isLikelyPromotionalEvidence(raw) ||
    isLikelyProductDescription(raw, sourceType) ||
    isRepositoryOperationalRecord(raw) ||
    isLikelyGamingEvidence(raw)
  ) {
    return 0;
  }

  const normalized = normalizeCommunityText(raw);
  const kind = classifyDirectCommunityEvidence(raw, sourceType);
  const structured = isStructuredOperationalProblemEvidence(raw, sourceType);
  const sectionText = raw.replace(/[*_]+/gu, ' ');

  let score = 0.08;
  if (kind === 'USER_COMPLAINT') score = 0.78;
  else if (kind === 'FEATURE_REQUEST') score = 0.72;
  else if (kind === 'OBSERVED_UNMET_NEED') score = 0.68;
  else if (kind === 'USER_QUESTION') score = 0.34;
  else if (kind === 'GENERAL_COMMENTARY') score = 0.18;
  if (structured) score = Math.max(score, 0.7);

  const sectionBonuses = [
    /(?:^|\s)(?:#{1,6}\s*)?(?:problem|user problem|pain point|unmet need)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:jtbd|job to be done)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:context\s*(?:&|and)\s*frequency|frequency|recurrence)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:pain\s*(?:\/|&|and)\s*stakes|impact|consequences?)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:current workaround|workaround)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:trigger\s*(?:\/|&|and)\s*failure moment|failure moment)\s*:/iu,
    /(?:^|\s)(?:#{1,6}\s*)?(?:persona|affected users?)\s*:/iu,
  ].filter((pattern) => pattern.test(sectionText)).length;
  score += Math.min(0.18, sectionBonuses * 0.03);

  if (
    /\b(?:daily|weekly|monthly|often|frequently|repeated|repeatedly|recurring|every day|each day|every week|rotation|rotate|multiple times)\b/iu.test(
      normalized,
    )
  ) {
    score += 0.06;
  }
  if (
    /\b(?:risk|unsafe|safety|missed|doubled|late detection|financial loss|waste|rework|delay|delayed|abandon|blocked|cost|expensive|treatment effectiveness|health setback)\b/iu.test(
      normalized,
    )
  ) {
    score += 0.07;
  }
  if (
    /\b(?:workaround|paper|notes?|spreadsheet|calendar|alarm|manual|phone|receipt|message|whiteboard|pill organizer)\b/iu.test(
      normalized,
    )
  ) {
    score += 0.05;
  }
  if (
    /\b(?:patient|caregiver|parent|family|employee|candidate|applicant|operator|manager|owner|customer|tenant|driver|clinician|staff|user|users)\b/iu.test(
      normalized,
    )
  ) {
    score += 0.04;
  }

  const headlineLike =
    sourceType === 'POST' &&
    raw.length < 260 &&
    !structured &&
    /(?:\s[-–—]\s[\p{L}\p{N}][^.!?]{1,80}$|\|\s*[\p{L}\p{N}][^.!?]{1,80}$|\b(?:news|magazine|journal)\b)/iu.test(
      raw,
    );
  if (headlineLike) score = Math.min(0.42, score - 0.25);

  return Math.min(1, Math.max(0, Number(score.toFixed(3))));
}


export function segmentCommunityEvidenceIssues(value: string): string[] {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];

  const commentMatch = normalized.match(/^(.*?\bCommunity comment:\s*)(.+)$/iu);
  const prefix = commentMatch?.[1]?.trimEnd() ?? '';
  const body = commentMatch?.[2]?.trim() ?? normalized;
  const chunks = body
    .split(/(?<=[.!?؟])\s+|\s+(?=(?:Worse|Most egregious|Additionally|Another issue|On top of that)\b)/u)
    .map((chunk) => chunk.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);

  if (chunks.length < 2) return [normalized];

  const issues = chunks.filter((chunk) => {
    if (
      /^(?:this|the)\s+(?:app|application|service|platform)\s+(?:has\s+)?(?:gotten\s+)?(?:so\s+)?(?:terrible|awful|horrible|bad)[.!…]*$/iu.test(
        chunk,
      )
    ) {
      return false;
    }

    const kind = classifyDirectCommunityEvidence(chunk, 'COMMENT');
    if (kind === 'FEATURE_REQUEST') return true;

    const concreteIssueSignal =
      /\b(?:old notes?|old data|re-appear|reappear|cannot access|can['’]?t access|customer service|support|ada|accessibility|mobility|stairs?|saved|submission|missing|lost|charged|refund|payment|login|logged out|logout|favorites?|favourites?|filters?|multiport|tags?|vanished|disappeared|crash|error|failed)\b/iu.test(
        chunk,
      );
    const explicitOperationalIssue =
      /\b(?:keep getting logged out|keeps? logging (?:me|us) out|no way to (?:really )?filter|no way to multiport|cannot filter|can['’]?t filter|unable to filter|tags? (?:vanished|disappeared|are gone|went missing)|favorites? via location)\b/iu.test(
        chunk,
      );

    if (kind !== 'USER_COMPLAINT' && !explicitOperationalIssue) return false;
    if (isWeakCommunityEvidence(chunk) && !concreteIssueSignal) return false;

    const wordCount = chunk.split(/\s+/u).filter(Boolean).length;
    return explicitOperationalIssue ? wordCount >= 4 : wordCount >= 6;
  });

  if (issues.length < 2) return [normalized];

  return issues.map((issue) =>
    prefix ? `${prefix} ${issue}`.replace(/\s+/gu, ' ').trim() : issue,
  );
}

/**
 * Returns true when the supplied value contains an explicit user complaint.
 */
export function hasDirectCommunityComplaint(value: string): boolean {
  const normalized = normalizeCommunityText(value)
    .replace(/\bcannot help but\b/giu, ' ')
    .replace(/\bcan['’]?t help but\b/giu, ' ')
    .replace(/\bcouldn['’]?t help but\b/giu, ' ')
    .replace(/\b(?:i am|i['’]?m|you are|you['’]?re|we are|we['’]?re|isn['’]?t|wasn['’]?t|not)\s+(?:actually\s+)?broken\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

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
  const strongPositiveTestimonialPattern =
    /\b(?:game[- ]changer|blew my mind|significantly improved|greatly improved|love that|awesome|highly recommend|works great|working great|has been amazing|excellent tool|improved my campaigns?)\b/iu;
  const productPitchSignals = [
    /\b(?:drop[- ]in|plug[- ]and[- ]play)\s+(?:infrastructure|platform|solution|layer|service)\b/iu,
    /\bbuilt for (?:production|teams?|developers?|businesses?|enterprises?)\b/iu,
    /\b(?:memory|security|data|automation|workflow)\s+layer\b[^.!?]{0,100}\b(?:missing|need|needs)\b/iu,
    /\b(?:stores?|retrieves?|syncs?|automates?)\b[^.!?]{0,100}\b(?:milliseconds|across sessions|across apps|at scale|production teams?)\b/iu,
    /\b(?:your|the)\s+(?:agents?|teams?|business|workflow)\b[^.!?]{0,120}\b(?:need|needs|missing|ship|ships)\b/iu,
  ];
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
  const productPitchSignalCount = productPitchSignals.filter((pattern) =>
    pattern.test(normalized),
  ).length;
  const seoEditorialSignals = [
    /\bwhy choose\b/iu,
    /\bour services include\b/iu,
    /\bfrequently asked questions?\b|\bfaqs?\b/iu,
    /\bfinal thoughts\b/iu,
    /\bbook(?:ing)? (?:early|in advance|online|today)\b/iu,
    /\bcontact number\b/iu,
    /\bbest time for\b/iu,
    /\bdocuments required\b/iu,
    /\btips to (?:increase|improve|avoid|choose|book)\b/iu,
    /\bcommon mistakes to avoid\b/iu,
    /\bat [^.!?]{2,80},? we (?:help|provide|offer|simplify|assist|focus|are committed)\b/iu,
  ].filter((pattern) => pattern.test(normalized)).length;
  const firstPersonComplaintSentences = complaintSentences.filter(
    (sentence) =>
      /\b(?:i|i['’]?m|i['’]?ve|my|me|we|we['’]?ve|our)\b/iu.test(sentence) &&
      !/\b(?:we offer|we provide|we help|we simplify|we are committed|our services|our team)\b/iu.test(
        sentence,
      ),
  );
  const longFormSeoPromotion =
    normalized.length >= 1_200 &&
    seoEditorialSignals >= 3 &&
    firstPersonComplaintSentences.length === 0;

  /*
   * Mixed reviews sometimes quote release-note or marketing text before
   * describing a real failure. A direct first-person complaint wins so valid
   * community evidence is not discarded with the promotional fragment. Long
   * SEO/catalog pages are stricter because generic phrases such as "avoid
   * disappointment" or "common mistakes" are instructions, not complaints.
   */
  const containsIndependentComplaint = complaintSentences.length > 0;

  return (
    longFormSeoPromotion ||
    ((strongReleaseNotePattern.test(normalized) ||
      strongPositiveTestimonialPattern.test(normalized)) &&
      !containsIndependentComplaint) ||
    (marketingSignalCount >= 2 &&
      !hasFirstPersonComplaint &&
      !containsIndependentComplaint) ||
    (productPitchSignalCount >= 2 &&
      !hasFirstPersonComplaint)
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
  const kind = classifyDirectCommunityEvidence(value, sourceType);
  return kind === 'USER_COMPLAINT' ||
    kind === 'FEATURE_REQUEST' ||
    kind === 'OBSERVED_UNMET_NEED';
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