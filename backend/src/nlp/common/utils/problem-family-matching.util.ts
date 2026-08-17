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

type ProblemFamilyDefinition = {
  readonly key: string;
  readonly label: string;
  readonly pattern: RegExp;
  readonly strongPatterns?: readonly RegExp[];
  readonly supportingPatterns?: readonly RegExp[];
  readonly negativePatterns?: readonly RegExp[];
  readonly priority?: number;
};

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','by','can','could','did','do','does','for','from','had','has','have','he','her','here','hers','him','his','how','i','if','in','into','is','it','its','may','might','more','most','not','of','on','or','our','ours','she','should','so','some','than','that','the','their','theirs','them','there','these','they','this','those','to','too','us','user','users','using','very','was','we','were','what','when','where','which','while','who','will','with','would','you','your',
  'ai','artificial','intelligence','application','app','apps','platform','software','system','systems','digital','tool','tools','workflow','workflows','service','services','product','products','community','comment','reported','report','reports','problem','problems','issue','issues','need','needs','experience','experiencing','encounter','encountered','support','supports','cool','information','informa','latest','way','waaaay','thing','things',
]);

const FAMILIES: readonly ProblemFamilyDefinition[] = [
  {
    key: 'ai-model-containment',
    label: 'AI Model Containment and Sandbox Escape Failures',
    pattern: /\b(?:model containment|containment breach|containment failure|sandbox escape|sandbox breach|escape onto the open internet|escaped? (?:onto|to) the (?:open )?internet|security confinement|security boundary enforcement)\b/iu,
    strongPatterns: [
      /\b(?:ai model|language model|open[- ]weight model|model)\b[^.!?]{0,160}\b(?:containment|sandbox|security boundary|open internet|internet access)\b/iu,
      /\b(?:containment|sandbox|security boundary)\b[^.!?]{0,160}\b(?:escape|breach|violation|unauthorized|internet)\b/iu,
      /\bsecurity testing\b[^.!?]{0,180}\b(?:escape|containment|internet)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:evaluation|testing|security testing|open[- ]weight|model safety|network access|outbound network)\b/iu,
    ],
    priority: 24,
  },
  {
    key: 'energy-monitor-installation',
    label: 'Energy Monitor Sensor Installation and Setup Friction',
    pattern: /\b(?:install|installation|setup|configure|configuration|wire|wiring|calibrat(?:e|ion)|map|mapping|manual effort|too much work|complex|difficult)\b[^.!?]{0,180}\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?|sensors?)\b|\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?|sensors?)\b[^.!?]{0,180}\b(?:install|installation|setup|configure|configuration|wire|wiring|calibrat(?:e|ion)|map|mapping|manual effort|too much work|complex|difficult)\b/iu,
    strongPatterns: [
      /\b(?:install|installation|setup|configure|configuration|wire|wiring|calibrat(?:e|ion)|map|mapping)\b[^.!?]{0,160}\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?|sensors?)\b/iu,
      /\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?|sensors?)\b[^.!?]{0,160}\b(?:too much work|manual effort|difficult|complex|install|setup|configure|wire|calibrat)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:solar|electricity|power|energy consumption|emoncms|iotawatt|sense system|telemetry)\b/iu,
    ],
    priority: 23,
  },
  { key: 'invoice-expense-operations', label: 'Invoice and Expense Processing Friction', pattern: /\b(?:invoice processing|invoice approval|invoice mismatch|expense report|expense claim|expense management|reimbursement|accounts payable|accounts receivable)\b/iu },
  { key: 'financial-reconciliation', label: 'Financial Reconciliation and Accounting Friction', pattern: /\b(?:accounting|bookkeeping|reconciliation|ledger|month[- ]end close|financial close|cash flow)\b/iu },
  { key: 'payroll-procurement', label: 'Payroll and Procurement Workflow Friction', pattern: /\b(?:payroll|procurement|purchase order|vendor approval|supplier approval)\b/iu },
  { key: 'government-record-updates', label: 'Cross-Agency Administrative Update Friction', pattern: /\b(?:cross[- ]agency|administrative update|central government departments?|government departments?|government agencies?|public agencies?|legal name change|name change|surname change|record update|records? updated|passport office|land registry|hmrc|dvla|dwp|notify multiple agencies|inform multiple agencies|inform every relevant|inform all (?:of )?them at once|agency notification)\b/iu, strongPatterns: [/\b(?:legal name change|name change|surname change)\b/iu, /\b(?:central government departments?|government departments?|government agencies?|public agencies?)\b/iu, /\b(?:hmrc|dvla|dwp|passport office|land registry)\b/iu, /\b(?:inform every relevant|inform all (?:of )?them at once|notify multiple agencies|agency notification)\b/iu], supportingPatterns: [/\b(?:married|marriage|life event|record|records|department|departments|agency|agencies|passport|registry)\b/iu], priority: 12 },
  { key: 'government-service-fragmentation', label: 'Government Service Integration Friction', pattern: /\b(?:government services?|public services?|citizen portal|public administration|government forms?|government app|government application|government portal|nhs|general practitioner|\bgps?\b|municipal services?|public sector workflow|inter[- ]departmental|agency systems?|department systems?)\b/iu, strongPatterns: [/\b(?:government services?|public services?|citizen portal|public administration|public sector workflow)\b/iu, /\b(?:inter[- ]departmental|agency systems?|department systems?|each .* own it system|separate it systems?)\b/iu, /\b(?:nhs|general practitioner|\bgps?\b)\b/iu], priority: 10 },
  { key: 'administrative-back-office', label: 'Administrative Back-Office Workflow Friction', pattern: /\b(?:approval workflow|administrative workflow|administrative process|back office|manual data entry|manual entry)\b/iu },
  { key: 'hr-candidate-pooling', label: 'Candidate Profile Pooling and Reuse for Recurring Hiring', pattern: /(?:(?:candidate|applicant) profiles?|\bprofiles?\b).{0,140}(?:sav(?:e|ing)?|sort|portal|pool|reuse|regular basis|recurring hiring|hire store workers)|(?:sav(?:e|ing)?|sort|portal|pool|reuse).{0,140}(?:(?:candidate|applicant) profiles?|\bprofiles?\b)/iu, strongPatterns: [/(?:sav(?:e|ing)?|sort|portal|pool|reuse).{0,100}(?:(?:candidate|applicant) profiles?|\bprofiles?\b)/iu, /(?:(?:candidate|applicant) profiles?|\bprofiles?\b).{0,120}(?:regular basis|recurring hiring|hire store workers)/iu], supportingPatterns: [/\b(?:applicant tracking|\bats\b|recruitment|recruiter|hiring|talent acquisition)\b/iu], priority: 20 },
  { key: 'hr-client-outreach', label: 'Client Contact Mass Outreach Gaps in Applicant Tracking Systems', pattern: /(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign).{0,120}(?:client contacts?|clients?)|(?:client contacts?|clients?).{0,120}(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign)/iu, strongPatterns: [/(?:mass email(?:ing)?|bulk email(?:ing)?).{0,100}(?:client contacts?|clients?)/iu, /(?:client contacts?|clients?).{0,100}(?:mass email(?:ing)?|bulk email(?:ing)?)/iu], supportingPatterns: [/\b(?:applicant tracking|\bats\b|recruitment|recruiter|staffing)\b/iu], priority: 20 },
  { key: 'hr-recruitment', label: 'Recruitment and Applicant Tracking Friction', pattern: /\b(?:recruitment|recruiter|hiring|applicant tracking|\bats\b|candidate screening|candidate profiles?|interview scheduling|employee onboarding|talent acquisition|job application)\b/iu, strongPatterns: [/\b(?:applicant tracking|\bats\b|candidate screening|candidate profiles?)\b/iu, /\b(?:recruitment|recruiter|hiring|talent acquisition)\b/iu], priority: 8 },
  { key: 'legal-research-access', label: 'Legal Research Documentation Cost and AI Reliability Barriers', pattern: /\b(?:legal researcher|legal research|legal tools?|law databases?|case documentation|evidence documentation|attorney research)\b/iu, strongPatterns: [/\b(?:legal researcher|legal research|law databases?)\b/iu, /\b(?:afford|expensive|price|pricing|licensing fee|1500|documentation burden|documenting)\b/iu, /\b(?:ai|guardrail|factual|facts|looping)\b/iu], priority: 13 },
  { key: 'rental-lease-filtering', label: 'Rental Lease-Term Filtering Limitations', pattern: /\b(?:rental length|lease term|lease duration|short[- ]term rentals?|long[- ]term rentals?|vacation home|vacation rental)\b/iu, strongPatterns: [/\b(?:filter|exclude|include|search)\b[^.!?]{0,100}\b(?:rental length|lease term|lease duration|short[- ]term|long[- ]term)\b/iu, /\b(?:short[- ]term rentals?|vacation home|vacation rental)\b[^.!?]{0,100}\b(?:filter|exclude|long[- ]term|somewhere to live)\b/iu], supportingPatterns: [/\b(?:rent|rental|housing|listing|listings|lease|home)\b/iu], priority: 18 },
  { key: 'real-estate-session-persistence', label: 'Repeated Session Logout Failures', pattern: /\b(?:keep getting logged out|keeps? logging (?:me|us) out|repeated(?:ly)? logged out|session (?:expires?|drops?|ends?)|unexpected logout)\b/iu, strongPatterns: [/\b(?:keep getting logged out|repeated(?:ly)? logged out|unexpected logout)\b/iu], supportingPatterns: [/\b(?:zillow|real estate|property|listing|favorites?|saved homes?)\b/iu], priority: 17 },
  { key: 'real-estate-favorites-filtering', label: 'Favorites Location Filtering Gaps', pattern: /\b(?:favorites?|favourites?|saved homes?|saved listings?)\b[^.!?]{0,120}\b(?:location|area|region)\b[^.!?]{0,80}\b(?:filter|search)|\b(?:filter|search)\b[^.!?]{0,120}\b(?:favorites?|favourites?|saved homes?|saved listings?)\b[^.!?]{0,80}\b(?:location|area|region)\b/iu, strongPatterns: [/\bno way to (?:really )?filter (?:my )?(?:favorites?|favourites?) via location\b/iu], supportingPatterns: [/\b(?:zillow|real estate|property|listing|home)\b/iu], priority: 17 },
  { key: 'real-estate-multi-criteria-filtering', label: 'Multi-Criteria Property Filtering Limitations', pattern: /\b(?:multiport|multiple filters?|two filters?|2 filters?|multiple criteria|house size and lot size)\b[^.!?]{0,120}\b(?:simultaneously|at once|together|filter)|\b(?:apply|combine|use)\b[^.!?]{0,80}\b(?:multiple|two|2)\b[^.!?]{0,40}\bfilters?\b/iu, strongPatterns: [/\b(?:house size and lot size|multiple filters?|two filters?|2 filters?)\b[^.!?]{0,100}\b(?:simultaneously|at once|together)\b/iu], supportingPatterns: [/\b(?:zillow|real estate|property|listing|search)\b/iu], priority: 17 },
  { key: 'real-estate-tag-persistence', label: 'User-Defined Property Tag Persistence Failures', pattern: /\b(?:tags?|user[- ]defined tags?|custom tags?)\b[^.!?]{0,120}\b(?:vanish(?:ed)?|disappear(?:ed)?|gone|removed|deleted|missing)|\b(?:vanish(?:ed)?|disappear(?:ed)?|gone|removed|deleted|missing)\b[^.!?]{0,120}\b(?:tags?|user[- ]defined tags?|custom tags?)\b/iu, strongPatterns: [/\b(?:tags?|custom tags?)\b[^.!?]{0,100}\b(?:vanish(?:ed)?|disappear(?:ed)?|gone|missing)\b/iu], supportingPatterns: [/\b(?:property|properties|listing|listings|zillow|notes?)\b/iu], priority: 17 },
  { key: 'feature-change-notification', label: 'Feature Removal and Change Notification Gaps', pattern: /\b(?:announce|notify|notification|communicat)\b[^.!?]{0,140}\b(?:feature|functionality|change|remove|removed|vanish|disappear|alternative)|\b(?:feature|functionality)\b[^.!?]{0,120}\b(?:remove|removed|vanish|disappear)\b[^.!?]{0,120}\b(?:announce|notify|communication|alternative)\b/iu, strongPatterns: [/\b(?:wish|should|need)\b[^.!?]{0,100}\b(?:announce|notify|provide an? alternative)\b/iu], priority: 13 },
  { key: 'rental-application-data-integrity', label: 'Rental Application Data Persistence Failures', pattern: /\b(?:rental application|application data|saved application|old notes?|updated info|saved info|submission)\b/iu, strongPatterns: [/\b(?:old notes?|old data|previous notes?|stale data)\b[^.!?]{0,100}\b(?:re-appear|reappear|return|come back|persist)\b/iu, /\b(?:updated|updating|saved|saving)\b[^.!?]{0,100}\b(?:old notes?|old data|re-appear|reappear|not retained|missing out on rentals?)\b/iu], supportingPatterns: [/\b(?:application|rental|submission|notes?|saved|updated)\b/iu], priority: 17 },
  { key: 'housing-accessibility-metadata', label: 'Rental Accessibility Information Gaps', pattern: /\b(?:ada|accessibility|mobility|wheelchair|stairs?|accessible unit|accessibility info|accessibility information)\b/iu, strongPatterns: [/\b(?:ada|accessibility)\b[^.!?]{0,140}\b(?:listing|rental|property|information|metadata|stairs?|appliances?|mobility)\b/iu, /\b(?:stairs?|mobility|wheelchair|accessible unit)\b[^.!?]{0,120}\b(?:listing|rental|property|information)\b/iu], supportingPatterns: [/\b(?:housing|rental|listing|property|unit|apartment)\b/iu], priority: 17 },
  { key: 'application-access-support', label: 'Application Access and Support Failures', pattern: /\b(?:cannot access|can['’]?t access|unable to access|no customer service|no support|customer service support)\b/iu, strongPatterns: [/\b(?:cannot access|can['’]?t access|unable to access)\b/iu, /\b(?:no customer service|no support|customer service support)\b/iu], priority: 9 },
  { key: 'mental-health-time-access', label: 'Workday Mental Health Time-Access Constraints', pattern: /\b(?:taking time for mental health|time for mental health|mental health time|mental-health time|time off for mental health|mental health break|mental health breaks|self[- ]care time|recovery time)\b/iu, strongPatterns: [/\b(?:taking time for mental health|time off for mental health|mental health time|mental health break|recovery time)\b/iu, /\b(?:luxury|cannot afford|can['’]?t afford|unable to take|difficult to take|hard to take|no time|less than a day)\b/iu], supportingPatterns: [/\b(?:workplace|workday|professional|employee|worker|schedule|self[- ]care|wellness)\b/iu], priority: 21 },
  { key: 'healthcare-treatment-access', label: 'Cross-Border Treatment Availability and Access Gaps', pattern: /\b(?:treatment|therapy|medicine|medication|care)\b[^.!?]{0,180}\b(?:unavailable|not available|unable to access|cannot access|can['’]?t access|another country|one country|different country|cross[- ]border)\b|\b(?:unavailable|not available|unable to access|cannot access|can['’]?t access)\b[^.!?]{0,180}\b(?:treatment|therapy|medicine|medication|care)\b/iu, strongPatterns: [/\b(?:known|successful|effective)\s+treatment\b[^.!?]{0,160}\b(?:unavailable|not available|another country|one country)\b/iu, /\b(?:treatment|care)\b[^.!?]{0,160}\b(?:country|region|cross[- ]border)\b/iu], supportingPatterns: [/\b(?:patient|physician|clinician|healthcare|health care|medical)\b/iu], priority: 20 },
  { key: 'clinical-sparse-measurements', label: 'Sparse Clinical Measurement and Missing-by-Design Data Gaps', pattern: /\b(?:missing values?|null values?|sparse features?|sparse data|imput(?:e|ing|ation)|forward[- ]fill|mean|median|test results?|measurements?)\b/iu, strongPatterns: [/\b(?:95\+?%|98%|most|many)\s+(?:of\s+the\s+)?(?:data|values?)\s+(?:is|are)\s+missing\b/iu, /\b(?:tests?|measurements?)\s+(?:are|were)?\s*(?:taken|ordered|measured)\s+(?:infrequently|only when|when ordered)\b/iu, /\b(?:imput(?:e|ing|ation)|forward[- ]fill|mean|median)\b/iu], supportingPatterns: [/\b(?:patient|clinical|medical|physionet|sepsis|test results?)\b/iu], negativePatterns: [/\b(?:records?|files?|history|saved data)\b[^.!?]{0,80}\b(?:disappeared|gone|deleted|lost)\b/iu], priority: 22 },
  { key: 'blockchain-wallet-state-sync', label: 'Wallet Transaction Visibility and State Synchronization Failures', pattern: /\b(?:wallet|account balance|wallet balance|transactions?|confirmations?|blockchain confirmation|transaction history)\b/iu, strongPatterns: [/\b(?:wallet|account balance|wallet balance)\b[^.!?]{0,180}\b(?:transaction|confirmation|blockchain)\b/iu, /\b(?:confirmed|confirmations?|blockchain)\b[^.!?]{0,180}\b(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|balance)\b/iu, /\b(?:transactions?|balance)\b[^.!?]{0,180}\b(?:missing|not showing|incorrect|wrong|0|zero)\b/iu], supportingPatterns: [/\b(?:mobile|desktop|client|green mobile app|wallet app)\b/iu, /\b(?:sync|synchroni[sz]|state|visibility|confirmation count)\b/iu], priority: 20 },
  { key: 'duplicate-payment-reconciliation', label: 'Duplicate Payment and Payment Reconciliation Failures', pattern: /\b(?:already paid|paid\b[^.!?]{0,90}\bcash|cash\b[^.!?]{0,90}\bpaid|charged\b[^.!?]{0,90}\bagain|double charg(?:e|ed|ing)?|duplicate charg(?:e|ed|ing)?|payment reconciliation|proof of payment\b[^.!?]{0,120}\b(?:additional|another|again|insist|payment))\b/iu, strongPatterns: [/\b(?:already paid|charged\b[^.!?]{0,90}\bagain|double charg(?:e|ed|ing)?|duplicate charg(?:e|ed|ing)?|payment reconciliation)\b/iu], supportingPatterns: [/\b(?:refund|cash|driver|rider|proof of payment|support team|billing|payment)\b/iu], priority: 18 },
  { key: 'shipment-transit-metrics', label: 'Shipment Transit-Time Visibility Gaps', pattern: /\b(?:(?:average|estimated|typical)\s+(?:shipment\s+|delivery\s+)?transit\s+time|(?:shipment|delivery)\s+transit\s+(?:time|duration)|transit\s+time\s+(?:metric|metrics|average|analytics|visibility))\b/iu, strongPatterns: [/\b(?:average|estimated|typical)\s+(?:shipment\s+|delivery\s+)?transit\s+time\b/iu], supportingPatterns: [/\b(?:shipment|delivery|tracking|aftership|courier|logistics)\b/iu], priority: 17 },
  { key: 'billing-payment', label: 'Billing and Payment Failures', pattern: /\b(?:payment|checkout|card|charged|charge|billing|bill|invoice|transaction|refund|price|cost|expensive|afford|affordable|paywall|subscription)\b/iu },
  { key: 'outage-reliability', label: 'Service Outage and Reliability Failures', pattern: /\b(?:outage|power cut|service down|downtime|offline|unavailable|blackout|disconnect(?:ed|ion)?|interruption)\b/iu },
  { key: 'authentication', label: 'Login and Account Access Failures', pattern: /\b(?:login|log in|authentication|activation|verification|sign in|password|session|session expired|token|otp|account access|identity provider|oidc|oauth|keycloak|cookie not found|cookie_not_found|access (?:my|the|an?) account)\b/iu, strongPatterns: [/\b(?:identity provider login error|identity_provider_login_error|cookie not found|cookie_not_found|oidc|oauth|keycloak|authentication session|login_required|login required)\b/iu, /\b(?:login|log in|authentication|sign in|account access)\b[^.!?]{0,80}\b(?:fail|failed|failure|error|blocked|unable|cannot|can['’]?t)\b/iu, /\b(?:cannot|can['’]?t|unable to)\s+(?:log in|login|sign in|access)\s+(?:(?:to\s+)?(?:my|the|this|an?)\s+)?account\b/iu, /\blocked out of (?:my|the|this) account\b/iu], supportingPatterns: [/\b(?:redirect|callback|cookie|session|sso|external idp|okta|azure|ping|account)\b/iu], priority: 20 },
  {
    key: 'streaming-data-integrity',
    label: 'Streaming Data Integrity and Staleness Failures',
    pattern: /\b(?:streaming|stream|data)\s+(?:pipeline|pipelines|feed|feeds)|\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?)\s+data\b/iu,
    strongPatterns: [
      /\b(?:streaming|stream)\s+pipelines?\b[^.!?]{0,180}\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?|silently|quietly)\b/iu,
      /\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?)\s+data\b/iu,
      /\b(?:not crashing|not throwing errors?|without crashing|no crash(?:es)?)\b[^.!?]{0,180}\b(?:stale|skewed|incorrect|wrong|data)\b/iu,
    ],
    supportingPatterns: [/\b(?:downstream|payload|schema|validation|integrity|observability|pipeline)\b/iu],
    priority: 25,
  },
  {
    key: 'accessibility-focus-navigation',
    label: 'Accessibility Focus and Keyboard Navigation Failures',
    pattern: /\b(?:keyboard (?:appears? )?(?:frozen|freeze)|focus (?:remains|stays|trapped|stuck)|focus trap|keystrokes? (?:are )?captured|type[- ]ahead|accessible panel|screen reader|no visible candidate)\b/iu,
    strongPatterns: [
      /\bkeyboard (?:appears? )?(?:frozen|freeze)\b/iu,
      /\bfocus (?:remains|stays|trapped|stuck)\b[^.!?]{0,140}\b(?:list|control|panel|action)\b/iu,
      /\b(?:keystrokes?|keyboard input)\b[^.!?]{0,120}\b(?:captured|consumed|ignored|dead)\b/iu,
      /\b(?:accessible panel|screen reader|no visible candidate|type[- ]ahead)\b/iu,
    ],
    supportingPatterns: [/\b(?:tab|arrows?|escape|navigation|focus|accessibility|nvda|keyboard|dialog|screen)\b/iu],
    priority: 24,
  },
  { key: 'monitoring-data', label: 'Monitoring and Data Visibility Gaps', pattern: /\b(?:monitor(?:ing)?|dashboard|status|tracking|telemetry|live data|real[- ]time|history|usage view|consumption view)\b/iu },
  { key: 'inaccurate-readings', label: 'Inaccurate Readings and Data Quality', pattern: /\b(?:inaccurate|incorrect|wrong reading|wrong data|reading(?:s)? wrong|measurement|meter reading|precision|not accurate|data is wrong)\b/iu },
  { key: 'energy-consumption', label: 'Energy Consumption Insight Gaps', pattern: /\b(?:energy consumption|electricity usage|power usage|energy usage|consumption|kilowatt|kwh|meter usage|utility usage)\b/iu },
  { key: 'device-sync', label: 'Device Synchronization and Connectivity Failures', pattern: /\b(?:sync|synchroni[sz]|device|bluetooth|wifi|wi-fi|connect|connection|pairing|gateway|sensor|smart meter|firmware)\b/iu },
  { key: 'data-loss', label: 'Data Loss and Persistence Failures', pattern: /(?:\b(?:data|history|conversation|conversations|chat|chats|records?|files?|progress|drafts?|saved items?|favorites?|notes?|profiles?|state|memory|voice|voices|assets?)\b.{0,55}\b(?:lost|missing|deleted|gone|disappear(?:ed)?|not saved|save failed|reset|wiped)\b)|(?:\b(?:lost|missing|deleted|gone|disappear(?:ed)?|reset|wiped)\b.{0,55}\b(?:data|history|conversation|conversations|chat|chats|records?|files?|progress|drafts?|saved items?|favorites?|notes?|profiles?|state|memory|voice|voices|assets?)\b)|\b(?:data loss|lost data|missing data|history missing|persistence failure|persistence failures)\b/iu, strongPatterns: [/(?:\b(?:data|history|conversation|conversations|chat|chats|records?|files?|progress|drafts?|saved items?|favorites?|notes?|profiles?|state|memory|voice|voices|assets?)\b.{0,35}\b(?:lost|missing|deleted|gone|disappear(?:ed)?|reset|wiped)\b)|\b(?:data loss|lost data|missing data|history missing)\b/iu], negativePatterns: [/\b(?:deleted|removed)\s+(?:the\s+)?app\b|\bapp\s+(?:deleted|removed)\b|\bdeleted,?\s+and\s+will\s+never\s+use\s+again\b|\bdeleted\s+it\s+and\s+will\s+never\s+use\s+again\b/iu, /\b(?:missing|null) values?\b|\b(?:imput(?:e|ing|ation)|forward[- ]fill|mean|median)\b|\btests? (?:are|were )?(?:taken|ordered) infrequently\b/iu], priority: 6 },

  {
    key: 'script-execution-policy',
    label: 'Script Execution Policy and Local Tool Permission Failures',
    pattern: /\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|script execution (?:is )?disabled|unauthorizedaccess|cannot be loaded because running scripts is disabled)\b/iu,
    strongPatterns: [
      /\b(?:running scripts is disabled|execution polic(?:y|ies)|pssecurityexception)\b/iu,
      /\b\.ps1\b[^.!?]{0,120}\b(?:cannot be loaded|disabled|unauthorizedaccess|securityerror)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:powershell|truffle|npm|script|local tool|visual studio)\b/iu,
    ],
    priority: 24,
  },
  {
    key: 'blockchain-transaction-balance',
    label: 'Blockchain Transaction Balance Validation Failures',
    pattern: /\b(?:insufficient funds|insufficient balance|not enough funds|balance (?:check|validation|mismatch|error))\b/iu,
    strongPatterns: [
      /\b(?:insufficient funds|insufficient balance|not enough funds)\b[^.!?]{0,140}\b(?:transaction|swap|transfer|wallet|fee|gas|rent|sol|token|bitcoin|crypto)\b/iu,
      /\b(?:transaction|swap|transfer|wallet|fee|gas|rent|sol|token|bitcoin|crypto)\b[^.!?]{0,140}\b(?:insufficient funds|insufficient balance|not enough funds)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:blockchain|solana|jupiter|web3|wallet|transaction|swap|transfer|fee|balance)\b/iu,
    ],
    priority: 23,
  },
  { key: 'notification', label: 'Notification and Alert Failures', pattern: /\b(?:notification|alert|warning|reminder|push message|didn['’]?t notify|no alert)\b/iu },
  { key: 'navigation-ui', label: 'Navigation and Interface Friction', pattern: /\b(?:navigation|interface|ui|button|menu|layout|screen|hard to use|confusing|cannot find|can['’]?t find)\b/iu },
  { key: 'performance', label: 'Performance and Responsiveness Failures', pattern: /\b(?:slow|lag|latency|freeze|frozen|stuck|unresponsive|takes too long|loading forever)\b/iu },
  { key: 'healthcare-ai-service', label: 'Healthcare AI Service Complaint and Validation Gaps', pattern: /\b(?:ai[- ]assisted customer[- ]service|ai[- ]driven customer[- ]service|ai customer service|ai phone assistant|automated ai customer service|automated healthcare interaction|healthcare ai support)\b/iu, strongPatterns: [/\b(?:healthcare|health care|pharmacy|patient|clinical)\b/iu, /\b(?:complaints?|failure|failed|pulled|withdrew|service termination|friction|dissatisfaction)\b/iu], supportingPatterns: [/\b(?:phone assistant|customer service|human review|feedback|triage)\b/iu], priority: 9 },
  { key: 'navigation-routing', label: 'Navigation and Routing Endpoint Failures', pattern: /\b(?:404|not found|missing url|incorrect url|broken route|broken link|routing|route|redirect|deep[- ]link|destination page|endpoint)\b/iu, strongPatterns: [/\b404\b/iu, /\b(?:missing|incorrect) url\b/iu, /\b(?:broken route|broken link|routing|deep[- ]link|destination page)\b/iu], supportingPatterns: [/\b(?:button|page|feedback|rating|rate us|navigation|redirect)\b/iu], negativePatterns: [/\b(?:identity provider login error|identity_provider_login_error|cookie not found|cookie_not_found|oidc|oauth|keycloak|authentication|login_required|login required|sso session|external idp)\b/iu], priority: 14 },
  { key: 'crash-runtime', label: 'Application Crash and Runtime Failures', pattern: /\b(?:crash|crashes|crashed|crashing|runtime error|runtime failure|exception|app closes|application closes|freeze|frozen|unresponsive)\b/iu, negativePatterns: [/\b(?:404|missing url|incorrect url|broken route|broken link|redirect|deep[- ]link)\b/iu, /\b(?:crash[- ]course|course crash)\b/iu, /\b(?:not|never|without|no)\s+(?:actually\s+)?crash(?:es|ed|ing)?\b/iu, /\b(?:keyboard (?:appears? )?(?:frozen|freeze)|focus (?:remains|stays|trapped|stuck)|focus trap|keystrokes? (?:are )?captured|type[- ]ahead|screen reader)\b/iu], priority: 5 },
  { key: 'public-transport', label: 'Public Transport Reliability Friction', pattern: /\b(?:public transport|transit|bus|train|rail|metro|route planner|arrival time)\b/iu },
  { key: 'traffic-congestion', label: 'Traffic Congestion and Routing Friction', pattern: /\b(?:traffic|congestion|bottleneck|gridlock|stuck in traffic|route)\b/iu },
  { key: 'delivery-tracking', label: 'Delivery and Shipment Tracking Failures', pattern: /\b(?:delivery|shipment|tracking|driver|courier|proof of delivery)\b/iu },
  { key: 'education-learning', label: 'Learning Workflow Friction', pattern: /\b(?:student(?!\s+loans?\b)|learner|lesson|course|curriculum|education|learning|homework|assignment|classroom|teacher|school)\b/iu, strongPatterns: [/\b(?:homework|assignment|lesson|course|curriculum|classroom|education|learning)\b/iu, /\b(?:student(?!\s+loans?\b)|learner|teacher|school)\b/iu], negativePatterns: [/\bstudent loans?\b/iu], priority: 4 },
  { key: 'agriculture-irrigation', label: 'Agriculture and Irrigation Workflow Failures', pattern: /\b(?:irrigation|crop|farm|farmer|soil|greenhouse|harvest)\b/iu },
  {
    key: 'therapeutic-continuity',
    label: 'Therapeutic Persona and Voice Continuity Failures',
    pattern: /\b(?:voice|voices|persona|personality|tone|warmth|counselor|counsellor|therapist|therapeutic persona|interaction style|memory of conversations?)\b/iu,
    strongPatterns: [
      /\b(?:voice|voices|persona|personality|tone|warmth|counselor|counsellor|therapist)\b/iu,
      /\b(?:gone|removed|deleted|changed|different|stranger|not the same|bring back|latest update|after (?:an? )?update|update)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:mental health|therapy|therapeutic|self[- ]care|support tool|ai for mental health)\b/iu,
      /\b(?:life[- ]changer|life[- ]saver|comforting|familiar|trusted|meaningful conversations?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:lawsuit|investor|fraud|funding|taking time for mental health|cannot afford time|workplace mental health)\b/iu,
    ],
    priority: 16,
  },
  {
    key: 'regional-crypto-access',
    label: 'Regional Crypto Platform Access and Alternative Wallet Gaps',
    pattern: /\b(?:binance|crypto|cryptocurrency|wallet|trading|trade|pexcoin|exchange)\b/iu,
    strongPatterns: [
      /\b(?:can(?:not|'?t) use|unavailable|not available|blocked|restricted)\b.{0,80}\b(?:country|region|nigeria|location)\b/iu,
      /\b(?:what other app|alternative app|alternative wallet|other exchange)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:nigeria|country|region|wallet|exchange|trade|trading)\b/iu,
    ],
    priority: 11,
  },
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

function evidenceBody(value: string): string {
  const match = value.match(/\bCommunity comment:\s*(.+)$/iu);
  return (match?.[1] ?? value).replace(/\s+/gu, ' ').trim();
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

function familyScore(value: string, family: ProblemFamilyDefinition): number {
  const normalized = normalize(value);
  if (!normalized || !family.pattern.test(normalized)) {
    return 0;
  }

  let score = 1 + (family.priority ?? 0) / 100;

  for (const pattern of family.strongPatterns ?? []) {
    if (pattern.test(normalized)) {
      score += 1.25;
    }
  }

  for (const pattern of family.supportingPatterns ?? []) {
    if (pattern.test(normalized)) {
      score += 0.45;
    }
  }

  for (const pattern of family.negativePatterns ?? []) {
    if (pattern.test(normalized)) {
      score -= 1.5;
    }
  }

  return Math.max(0, score);
}

function rankedFamilies(value: string): Array<{
  readonly key: string;
  readonly score: number;
}> {
  return FAMILIES.map((family) => ({
    key: family.key,
    score: familyScore(value, family),
  }))
    .filter((entry) => entry.score > 0)
    .sort(
      (first, second) =>
        second.score - first.score || first.key.localeCompare(second.key),
    );
}

function familyKeys(value: string): string[] {
  return rankedFamilies(value).map((entry) => entry.key);
}

function lexicalFamilyKey(value: string): string {
  const tokens = [...contentTokens(value)].slice(0, 3);
  return tokens.length > 0 ? `lexical:${tokens.join('-')}` : 'generic-friction';
}

function familyLabel(key: string): string {
  const recognized = FAMILIES.find((entry) => entry.key === key)?.label;
  if (recognized) return recognized;

  if (key.startsWith('lexical:')) {
    return 'Specific User Workflow Friction';
  }

  return 'User Workflow Friction';
}

export function resolveProblemFamilyKeys(value: string): readonly string[] {
  const body = evidenceBody(value);
  const recognized = familyKeys(body);
  return recognized.length > 0 ? recognized : [lexicalFamilyKey(body)];
}

const ATOMIC_PROBLEM_CUES: readonly { readonly key: string; readonly pattern: RegExp }[] = [
  { key: 'ai-model-containment', pattern: /\b(?:model containment|containment breach|sandbox escape|security boundary|escape onto the open internet|security testing)\b/iu },
  { key: 'energy-monitor-installation', pattern: /\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?)\b[^.!?]{0,160}\b(?:install|setup|configure|wiring|calibration|too much work|manual effort|complex|difficult)\b|\b(?:install|setup|configure|wiring|calibration|too much work|manual effort|complex|difficult)\b[^.!?]{0,160}\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?)\b/iu },
  { key: 'persisted-record-loss', pattern: /\b(?:records?|files?|history|saved data|saved records?|database records?)\b[^.!?]{0,90}\b(?:lost|missing|gone|deleted|disappeared|not saved|wiped)\b|\b(?:lost|missing|gone|deleted|disappeared)\b[^.!?]{0,90}\b(?:records?|files?|history|saved data|database)\b/iu },
  { key: 'sparse-measurements', pattern: /\b(?:missing|null) values?\b|\b(?:imput(?:e|ing|ation)|forward[- ]fill|mean|median|sparse features?|sparse data)\b|\btests?\b[^.!?]{0,90}\b(?:infrequently|only when|when ordered)\b/iu },
  { key: 'duplicate-charge', pattern: /\b(?:already paid|paid .*cash|cash .*paid|charged .*again|double charg|duplicate charg|payment reconciliation)\b/iu },
  { key: 'authentication', pattern: /\b(?:oauth|oidc|login|log in|authentication|identity provider|session|cookie|token|sign in|account access|access (?:my|the|this) account|locked out of (?:my|the|this) account)\b/iu },
  { key: 'routing', pattern: /\b(?:404|missing url|incorrect url|broken route|broken link|deep[- ]link|destination page)\b/iu },
  { key: 'streaming-data-integrity', pattern: /\b(?:streaming|stream)\s+pipelines?\b[^.!?]{0,180}\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?|silently|quietly)\b|\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?)\s+data\b/iu },
  { key: 'focus-navigation', pattern: /\b(?:keyboard (?:appears? )?(?:frozen|freeze)|focus (?:remains|stays|trapped|stuck)|focus trap|keystrokes? (?:are )?captured|type[- ]ahead|accessible panel|screen reader|no visible candidate)\b/iu },
  { key: 'runtime-crash', pattern: /\b(?:(?:app|application|software|process|service|server|client|browser|firefox|chrome|tab)\s+crash(?:es|ed|ing)?|crash(?:es|ed|ing)?\s+(?:app|application|software|process|service|server|client|browser|firefox|chrome|tab)|your tab just crashed|freeze|frozen|unresponsive|runtime error|runtime failure|exception|segfault|terminated unexpectedly)\b/iu },
  { key: 'script-execution-policy', pattern: /\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|script execution disabled|unauthorizedaccess)\b/iu },
  { key: 'transaction-balance', pattern: /\b(?:insufficient funds|insufficient balance|not enough funds)\b[^.!?]{0,120}\b(?:transaction|swap|transfer|wallet|fee|gas|balance|sol|token)|\b(?:transaction|swap|transfer|wallet|fee|gas|balance|sol|token)\b[^.!?]{0,120}\b(?:insufficient funds|insufficient balance|not enough funds)\b/iu },
  { key: 'notification', pattern: /\b(?:notification|alert|push message|reminder)\b[^.!?]{0,100}\b(?:missing|not received|didn['’]?t receive|failed|late|delayed|wrong)\b/iu },
  { key: 'service-outage', pattern: /\b(?:outage|downtime|service down|offline|blackout|disconnect(?:ed|ion)?)\b/iu },
  { key: 'delivery-tracking', pattern: /\b(?:delivery|shipment|courier|driver|tracking)\b[^.!?]{0,120}\b(?:missing|delayed|stuck|wrong|not delivered|failed)\b/iu },
  { key: 'refund', pattern: /\b(?:refund|reversal|chargeback)\b[^.!?]{0,120}\b(?:missing|delayed|not received|failed|pending)\b/iu },
  { key: 'persona-continuity', pattern: /\b(?:voice|persona|personality|tone|warmth|therapist|counselor)\b[^.!?]{0,120}\b(?:changed|different|gone|removed|deleted|update|not the same)\b/iu },
  { key: 'time-access', pattern: /\b(?:taking time for mental health|time off for mental health|mental health time|mental health break|recovery time)\b/iu },
  { key: 'treatment-access', pattern: /\b(?:treatment|care|medicine|therapy)\b[^.!?]{0,150}\b(?:unavailable|not available|another country|one country|cannot access|can['’]?t access)\b/iu },
  { key: 'candidate-pooling', pattern: /\b(?:candidate|applicant) profiles?\b[^.!?]{0,130}\b(?:save|sort|pool|reuse|portal|recurring hiring)\b/iu },
  { key: 'client-outreach', pattern: /\b(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign)\b[^.!?]{0,130}\b(?:client contacts?|clients?)\b/iu },
  { key: 'lease-filtering', pattern: /\b(?:lease term|lease duration|rental length|short[- ]term rentals?|long[- ]term rentals?)\b/iu },
  { key: 'session-logout', pattern: /\b(?:keep getting logged out|repeated(?:ly)? logged out|unexpected logout|session (?:expires?|drops?|ends?))\b/iu },
  { key: 'favorites-location-filtering', pattern: /\b(?:favorites?|favourites?|saved homes?|saved listings?)\b[^.!?]{0,100}\b(?:location|area|region)\b[^.!?]{0,70}\b(?:filter|search)|\b(?:filter|search)\b[^.!?]{0,100}\b(?:favorites?|favourites?)\b/iu },
  { key: 'multi-criteria-filtering', pattern: /\b(?:multiport|multiple filters?|two filters?|2 filters?|multiple criteria|house size and lot size)\b/iu },
  { key: 'property-tag-persistence', pattern: /\b(?:tags?|custom tags?|user[- ]defined tags?)\b[^.!?]{0,100}\b(?:vanish(?:ed)?|disappear(?:ed)?|gone|missing|removed|deleted)\b/iu },
  { key: 'feature-change-notification', pattern: /\b(?:announce|notify|notification|communicat)\b[^.!?]{0,120}\b(?:feature|functionality|change|remove|alternative)\b/iu },
];

function atomicCueKeys(value: string): string[] {
  const body = evidenceBody(value);
  const runtimeSafeBody = body
    .replace(/\b(?:not|never|without|no)\s+(?:actually\s+)?crash(?:es|ed|ing)?\b/giu, ' ')
    .replace(/\bkeyboard (?:appears? )?(?:frozen|freeze)\b/giu, ' ')
    .replace(/\b(?:focus|keystrokes?|keyboard input)\b[^.!?]{0,90}\b(?:captured|consumed|trapped|stuck|frozen|type[- ]ahead)\b/giu, ' ');

  return ATOMIC_PROBLEM_CUES.filter((cue) =>
    cue.pattern.test(cue.key === 'runtime-crash' ? runtimeSafeBody : body),
  ).map((cue) => cue.key);
}

export function matchEvidenceToAtomicProblem(
  firstEvidence: string,
  secondEvidence: string,
): ProblemFamilyMatch {
  const first = normalize(evidenceBody(firstEvidence));
  const second = normalize(evidenceBody(secondEvidence));
  if (!first || !second) {
    return { matched: false, score: 0, sharedConcepts: [], sharedTokens: [] };
  }

  const firstFamilies = familyKeys(first);
  const secondFamilies = familyKeys(second);
  const firstPrimary = firstFamilies[0] ?? null;
  const secondPrimary = secondFamilies[0] ?? null;
  if (firstPrimary && secondPrimary && firstPrimary !== secondPrimary) {
    return { matched: false, score: 0, sharedConcepts: [], sharedTokens: [] };
  }

  const firstCues = atomicCueKeys(first);
  const secondCues = atomicCueKeys(second);
  const sharedCues = firstCues.filter((cue) => secondCues.includes(cue));
  if (firstCues.length > 0 && secondCues.length > 0 && sharedCues.length === 0) {
    return { matched: false, score: 0, sharedConcepts: [], sharedTokens: [] };
  }

  const firstTokens = contentTokens(first);
  const secondTokens = contentTokens(second);
  const sharedTokens = [...firstTokens].filter((token) => secondTokens.has(token));
  const minSize = Math.max(1, Math.min(firstTokens.size, secondTokens.size));
  const unionSize = Math.max(1, new Set([...firstTokens, ...secondTokens]).size);
  const containment = sharedTokens.length / minSize;
  const jaccard = sharedTokens.length / unionSize;
  const specificFamily = firstPrimary && firstPrimary === secondPrimary && !firstPrimary.startsWith('lexical:') && firstPrimary !== 'generic-friction';
  const matched = sharedCues.length > 0 || (specificFamily ? containment >= 0.22 && sharedTokens.length >= 2 : containment >= 0.34 && sharedTokens.length >= 3);
  const score = Math.min(1, sharedCues.length * 0.45 + containment * 0.35 + jaccard * 0.2);

  return {
    matched,
    score: Number(score.toFixed(4)),
    sharedConcepts: sharedCues.length > 0 ? sharedCues : firstPrimary && firstPrimary === secondPrimary ? [firstPrimary] : [],
    sharedTokens,
  };
}

export function clusterEvidenceByProblemFamily(
  evidenceSamples: readonly string[],
): EvidenceProblemFamilyCluster[] {
  const clusters: Array<{ key: string; samples: string[] }> = [];

  for (const rawSample of evidenceSamples) {
    const sample = rawSample.replace(/\s+/gu, ' ').trim();
    if (!sample) continue;

    const keys = resolveProblemFamilyKeys(sample);
    const primaryKey = keys[0] ?? 'generic-friction';
    const existing = clusters.find((cluster) =>
      cluster.key === primaryKey &&
      cluster.samples.some((entry) => matchEvidenceToAtomicProblem(entry, sample).matched),
    );

    if (existing) {
      if (!existing.samples.some((entry) => normalize(entry) === normalize(sample))) {
        existing.samples.push(sample);
      }
      continue;
    }

    clusters.push({ key: primaryKey, samples: [sample] });
  }

  return clusters
    .map((cluster) => ({
      key: cluster.key,
      label: familyLabel(cluster.key),
      evidenceSamples: cluster.samples,
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
  const evidence = normalize(evidenceBody(evidenceText));

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

  if (sharedConcepts.length > 0) {
    const primaryProblemFamily = problemFamilies[0] ?? null;
    const primaryEvidenceFamily = evidenceFamilies[0] ?? null;
    const primaryAgreement =
      primaryProblemFamily !== null &&
      primaryEvidenceFamily !== null &&
      primaryProblemFamily === primaryEvidenceFamily;
    const conceptBase = primaryAgreement ? 0.82 : 0.7;

    return {
      matched: true,
      score: Number(
        Math.min(1, conceptBase + Math.min(tokenCoverage, 0.18)).toFixed(4),
      ),
      sharedConcepts,
      sharedTokens,
    };
  }

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
