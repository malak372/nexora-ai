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
  readonly hardNegativePatterns?: readonly RegExp[];
  readonly priority?: number;
};

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','by','can','could','did','do','does','for','from','had','has','have','he','her','here','hers','him','his','how','i','if','in','into','is','it','its','may','might','more','most','not','of','on','or','our','ours','she','should','so','some','than','that','the','their','theirs','them','there','these','they','this','those','to','too','us','user','users','using','very','was','we','were','what','when','where','which','while','who','will','with','would','you','your',
  'ai','artificial','intelligence','application','app','apps','platform','software','system','systems','digital','tool','tools','workflow','workflows','service','services','product','products','community','comment','reported','report','reports','problem','problems','issue','issues','need','needs','experience','experiencing','encounter','encountered','support','supports','cool','information','informa','latest','way','waaaay','thing','things',
]);

const FAMILIES: readonly ProblemFamilyDefinition[] = [
  {
    key: 'marketplace-trust-safety',
    label: 'Marketplace Fraud, Seller Integrity, and Trust-Safety Failures',
    pattern: /\b(?:online marketplaces?|marketplaces?|e[- ]?commerce|seller accounts?|fake sellers?|suspicious listings?|fraudulent reviews?|fake reviews?|review manipulation|coordinated fraud|seller restrictions?|legitimate sellers?|vendor integrity|marketplace fraud|trust and safety)\b/iu,
    strongPatterns: [
      /\b(?:fake sellers?|seller accounts?|suspicious listings?|fraudulent reviews?|fake reviews?|coordinated fraud|marketplace fraud)\b/iu,
      /\b(?:legitimate sellers?|seller restrictions?|false positives?|vendor integrity|trust and safety)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:transaction history|purchasing behavior|seller activity|customer trust|fraud detection|security signals?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:crypto wallet|blockchain wallet|wallet balance|blockchain confirmation)\b/iu,
    ],
    priority: 25,
  },
  {
    key: 'ai-feedback-correction-inflexibility',
    label: 'AI Feedback Incorporation and Correction Failures',
    pattern: /\b(?:model inflexib(?:ility|le)|ai inflexib(?:ility|le)|inflexibility of (?:the )?(?:ai )?models?|ai feedback incorporation|ai feedback correction|(?:ai|model|llm) correction (?:loop|workflow)|model rigidity|rigid model|cannot (?:take|incorporate|apply) constructive feedback|can['’]?t (?:take|incorporate|apply) constructive feedback|fails? to (?:take|incorporate|apply) constructive feedback|doesn['’]?t (?:take|incorporate|apply) constructive feedback|cannot correct (?:obvious )?mistakes?|can['’]?t correct (?:obvious )?mistakes?|fails? to correct (?:obvious )?mistakes?|ignores? corrections?|doesn['’]?t respond to corrections?|fails? to revise after feedback)\b/iu,
    strongPatterns: [
      /\b(?:ai|artificial intelligence|llm|large language model|model|chatbot|assistant|generative ai)\b[^.!?]{0,220}\b(?:inflexib(?:ility|le)|inflexibility of (?:the )?(?:ai )?models?|rigid(?:ity)?|constructive feedback|correct (?:obvious )?mistakes?|incorporate feedback|apply feedback|respond to corrections?|revise after feedback)\b/iu,
      /\b(?:constructive feedback|correction|corrections|follow[- ]up feedback)\b[^.!?]{0,180}\b(?:model|ai|llm|assistant)\b[^.!?]{0,140}\b(?:inflexib(?:ility|le)|rigid|fails?|cannot|can['’]?t|doesn['’]?t|ignores?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:ai|artificial intelligence|llm|large language model|model|chatbot|assistant|prompt|response|output|feedback|correction|revision|retry|replay|mistake|follow[- ]up)\b/iu,
    ],
    priority: 34,
  },
  {
    key: 'ai-hallucination-output-reliability',
    label: 'AI Hallucination and Output Reliability Failures',
    pattern: /\b(?:hallucinat(?:e|es|ed|ing|ion|ions)|fabricat(?:e|es|ed|ing|ion|ions)|made[- ]?up (?:facts?|citations?|sources?|answers?)|invented (?:facts?|citations?|sources?)|false (?:facts?|citations?)|factual(?:ly)? (?:wrong|incorrect)|incorrect facts?|wrong facts?|unsupported claims?|unreliable (?:answers?|outputs?|responses?))\b/iu,
    strongPatterns: [
      /\b(?:hallucinat(?:e|es|ed|ing|ion|ions)|made[- ]?up (?:facts?|citations?|sources?)|invented (?:facts?|citations?|sources?)|false citations?)\b/iu,
      /\b(?:ai|artificial intelligence|llm|large language model|model|chatbot|assistant|generative ai)\b[^.!?]{0,180}\b(?:wrong facts?|incorrect facts?|unsupported claims?|unreliable answers?|fabricat(?:e|es|ed|ing|ion))\b/iu,
    ],
    supportingPatterns: [
      /\b(?:ai|artificial intelligence|llm|large language model|model|chatbot|assistant|generative ai|prompt|response|output|citation|factuality|grounding)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:human hallucination|visual hallucination|auditory hallucination|medical hallucination|clinical hallucination)\b/iu,
    ],
    priority: 30,
  },
  {
    key: 'llm-streaming-latency',
    label: 'LLM Streaming Latency and Response Delivery Failures',
    pattern: /\b(?:streaming llm responses?|llm streaming|streaming responses?|time[- ]to[- ]first[- ]token|time to first token|first token|ttft|response chunks?|chunk delivery)\b[^.!?]{0,180}\b(?:latency|slow|delay|delayed|takes? too long|seconds?|bottleneck|friction|not showing|not surfaced|error tracker)\b|\b(?:latency|slow|delay|delayed|bottleneck|friction)\b[^.!?]{0,180}\b(?:streaming llm responses?|llm streaming|time[- ]to[- ]first[- ]token|time to first token|first token|ttft|response chunks?|chunk delivery)\b/iu,
    strongPatterns: [
      /\b(?:streaming llm responses?|llm streaming|time[- ]to[- ]first[- ]token|time to first token|ttft)\b/iu,
      /\b(?:next\.?js|nextjs|large language model|llm|ai)\b[^.!?]{0,180}\b(?:first token|ttft|response chunks?|chunk delivery|streaming response|latency)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:next\.?js|nextjs|api routes?|server[- ]side rendering|serialization|telemetry|sdk|request lifecycle|response delivery|error tracker)\b/iu,
    ],
    priority: 28,
  },
  {
    key: 'legal-compliance-risk',
    label: 'Legal, Compliance, and Rights Risk Gaps',
    pattern: /\b(?:legal risks?|legal exposure|legal liability|compliance risks?|regulatory risks?|copyright risks?|copyright infringement|licensing risks?|license risks?|privacy risks?|consent risks?|disclosure risks?|intellectual property risks?|ip risks?|rights risks?|usage rights?|image rights?|publicity rights?)\b/iu,
    strongPatterns: [
      /\b(?:legal|regulatory|compliance|copyright|licensing|privacy|consent|intellectual property|usage rights?|image rights?|publicity rights?)\b[^.!?]{0,120}\b(?:risk|risks|liability|exposure|violation|infringement|missing|unclear|uncertainty)\b/iu,
      /\b(?:risk|risks|liability|exposure|violation|infringement)\b[^.!?]{0,120}\b(?:legal|regulatory|compliance|copyright|licensing|privacy|consent|intellectual property|usage rights?|image rights?|publicity rights?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:ai[- ]generated|generated media|photography|image|images|content|real estate|marketing|disclosure|policy|governance|review)\b/iu,
    ],
    priority: 26,
  },
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
  {
    key: 'energy-grid-stability-inverter-trip',
    label: 'Energy Grid Instability and Inverter Trip Resilience Gaps',
    pattern: /\b(?:power grid|electric grid|grid|electricity network|power network)\b[^.!?]{0,180}\b(?:unstable|instability|frequency deviation|voltage deviation|blackout|outage|trip|trips|tripped|disconnect|disconnects|collapse|failure)\b|\b(?:inverter|inverters|solar panels?|solar generation|distributed generation)\b[^.!?]{0,180}\b(?:trip|trips|tripped|shut off|shutting off|disconnect|disconnects|blackout|unstable grid|grid instability)\b/iu,
    strongPatterns: [
      /\b(?:grid becomes?|grid is|grid gets?)\b[^.!?]{0,100}\b(?:unstable|instability)\b[^.!?]{0,120}\b(?:inverters?|generation)\b[^.!?]{0,80}\b(?:trip|trips|tripped|disconnect)\b/iu,
      /\b(?:inverters?|solar panels?|distributed generation)\b[^.!?]{0,140}\b(?:trip|trips|tripped|shut off|disconnect)\b[^.!?]{0,120}\b(?:grid|blackout|outage|instability)\b/iu,
      /\bblackout\b[^.!?]{0,160}\b(?:solar panels?|inverters?|distributed generation|grid)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:solar|photovoltaic|pv|inverter|grid|electricity|power generation|distributed energy|frequency|voltage|utility)\b/iu,
    ],
    priority: 27,
  },
  {
    key: 'healthcare-preventive-care-reminders',
    label: 'Preventive Care Follow-Up and Screening Reminder Gaps',
    pattern: /\b(?:preventive|preventative|routine)\b[^.!?]{0,160}\b(?:health checkups?|health checks?|checkups?|screenings?|dental exams?|eye exams?|blood pressure checks?|cancer screenings?|appointments?)\b[^.!?]{0,180}\b(?:skip|skipped|miss|missed|forgot|forgotten|overdue|late|delay|delayed|without reminders?|no reminders?)\b|\b(?:skip|skipped|miss|missed|forgot|forgotten|overdue|late|delay|delayed)\b[^.!?]{0,180}\b(?:preventive|preventative|routine)\b[^.!?]{0,160}\b(?:checkups?|screenings?|appointments?|care)\b/iu,
    strongPatterns: [
      /\b(?:routine|preventive|preventative)\b[^.!?]{0,120}\b(?:checkups?|screenings?|appointments?)\b[^.!?]{0,120}\b(?:skipped|missed|forgotten|overdue)\b/iu,
      /\b(?:dental|eye|blood pressure|cancer|screening)\b[^.!?]{0,140}\b(?:reminder|appointment|checkup|follow[- ]?up)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:patient|healthcare|health care|medical|clinic|doctor|dentist|screening|prevention|early detection|reminder|follow[- ]?up)\b/iu,
    ],
    priority: 26,
  },
  {
    key: 'medication-adherence-coordination',
    label: 'Medication Adherence and Caregiver Coordination Gaps',
    pattern: /\b(?:medication|medications|medicine|medicines|dose|doses|pill|pills|prescription)\b[^.!?]{0,180}\b(?:miss|missed|missing|forget|forgot|forgotten|double|doubled|duplicate|wrong|late|schedule|reminder|caregiver|family member|coordination|handoff)\b|\b(?:miss|missed|forgot|forgotten|double|doubled|duplicate|wrong)\b[^.!?]{0,160}\b(?:dose|doses|medication|medicine|prescription)\b/iu,
    strongPatterns: [
      /\b(?:missed|forgotten|doubled|double|duplicate|wrong)\b[^.!?]{0,100}\b(?:dose|doses|medication|medicine)\b/iu,
      /\b(?:caregiver|family member|carer)\b[^.!?]{0,140}\b(?:medication|dose|schedule|coordination|handoff)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:patient|caregiver|carer|family|adherence|schedule|reminder|medication log|dose history|prescription)\b/iu,
    ],
    priority: 25,
  },
  { key: 'invoice-expense-operations', label: 'Invoice and Expense Processing Friction', pattern: /\b(?:invoice processing|invoice approval|invoice mismatch|expense report|expense claim|expense management|reimbursement|accounts payable|accounts receivable)\b/iu },
  { key: 'financial-reconciliation', label: 'Financial Reconciliation and Accounting Friction', pattern: /\b(?:accounting|bookkeeping|reconciliation|ledger|month[- ]end close|financial close|cash flow)\b/iu },
  { key: 'payroll-procurement', label: 'Payroll and Procurement Workflow Friction', pattern: /\b(?:payroll|procurement|purchase order|vendor approval|supplier approval)\b/iu },
  { key: 'government-record-updates', label: 'Cross-Agency Administrative Update Friction', pattern: /\b(?:cross[- ]agency|administrative update|central government departments?|government departments?|government agencies?|public agencies?|legal name change|name change|surname change|record update|records? updated|passport office|land registry|hmrc|dvla|dwp|notify multiple agencies|inform multiple agencies|inform every relevant|inform all (?:of )?them at once|agency notification)\b/iu, strongPatterns: [/\b(?:legal name change|name change|surname change)\b/iu, /\b(?:central government departments?|government departments?|government agencies?|public agencies?)\b/iu, /\b(?:hmrc|dvla|dwp|passport office|land registry)\b/iu, /\b(?:inform every relevant|inform all (?:of )?them at once|notify multiple agencies|agency notification)\b/iu], supportingPatterns: [/\b(?:married|marriage|life event|record|records|department|departments|agency|agencies|passport|registry)\b/iu], priority: 12 },
  { key: 'government-service-fragmentation', label: 'Government Service Integration Friction', pattern: /\b(?:government services?|public services?|citizen portal|public administration|government forms?|government app|government application|government portal|nhs|general practitioner|\bgps?\b|municipal services?|public sector workflow|inter[- ]departmental|agency systems?|department systems?)\b/iu, strongPatterns: [/\b(?:government services?|public services?|citizen portal|public administration|public sector workflow)\b/iu, /\b(?:inter[- ]departmental|agency systems?|department systems?|each .* own it system|separate it systems?)\b/iu, /\b(?:nhs|general practitioner|\bgps?\b)\b/iu], priority: 10 },
  {
    key: 'knowledge-resource-indexing',
    label: 'Knowledge Resource Indexing, Search, and Review Gaps',
    pattern: /\b(?:marketing library|knowledge library|resource library|research packs?|industry documents?|repository documents?|repository files?|resource inventory|document indexing|searchable (?:resource|document|knowledge) (?:library|repository)|review and citation workflow|citation workflow|document-only resources?|unindexed (?:documents?|files?|resources?|assets?))\b|\b(?:documents?|files?|research assets?|reference materials?|resources?)\b[^.!?]{0,180}\b(?:unindexed|not indexed|not registered|not searchable|not reviewable|trapped|document-only|missing metadata|duplicate|contradictory)\b|\b(?:unindexed|not indexed|not registered|not searchable|not reviewable|trapped|document-only|missing metadata|duplicate|contradictory)\b[^.!?]{0,180}\b(?:documents?|files?|research assets?|reference materials?|resources?|repository|library)\b/iu,
    strongPatterns: [
      /\b(?:marketing library|knowledge library|resource library|resource inventory|document indexing|review and citation workflow|citation workflow)\b/iu,
      /\b(?:research packs?|industry documents?|repository documents?|repository files?|research assets?)\b[^.!?]{0,200}\b(?:registered|searchable|reviewable|usable|indexed|inventory|classify|metadata|citation)\b/iu,
      /\b(?:trapped|sitting)\b[^.!?]{0,120}\b(?:documents?|files?|repository|sql|docs?)\b[^.!?]{0,180}\b(?:registered|searchable|reviewable|usable|indexed)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:metadata|source manifests?|rights state|review state|citation metadata|knowledge layer|source type|duplicate sources?|contradictory sources?|ingestion plans?|sql seeds?)\b/iu,
    ],
    priority: 24,
  },
  {
    key: 'manufacturing-cost-profitability',
    label: 'Manufacturing Cost Variance, Bottlenecks, and Profitability Pressure',
    pattern:
      /\b(?:manufacturing|manufacturer|manufacturers|factory|factories|industrial production|production lines?|shop floor)\b[^.!?]{0,240}\b(?:production costs?|manufacturing costs?|raw material costs?|raw material variability|machine downtime|labor costs?|labour costs?|defect rates?|scrap rates?|maintenance costs?|supplier prices?|supplier costs?|cost variance|cost forecasts?|bottlenecks?|profitability|margin erosion)\w*\b|\b(?:production costs?|manufacturing costs?|raw material costs?|raw material variability|machine downtime|labor costs?|labour costs?|defect rates?|scrap rates?|maintenance costs?|supplier prices?|supplier costs?|cost variance|cost forecasts?|bottlenecks?|profitability|margin erosion)\w*\b[^.!?]{0,240}\b(?:manufacturing|manufacturer|manufacturers|factory|factories|industrial production|production lines?|shop floor)\b/iu,
    strongPatterns: [
      /\b(?:manufacturing|factory|production line|industrial production)\b/iu,
      /\b(?:production cost|manufacturing cost|cost variance|raw material variability|machine downtime|defect rate|scrap rate|supplier cost|supplier price|bottleneck|profitability|margin)\w*\b/iu,
    ],
    supportingPatterns: [
      /\b(?:just[- ]in[- ]time|smart manufacturing|bottleneck analysis|bottleneck management|strategic sequencing|cost per unit|yield loss|maintenance spending|production planning|cost forecasting)\w*\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:manufacturing cybersecurity|supply chain cybersecurity|raw material test methods?|bacterial cellulose|sustainable raw material alternatives?)\b/iu,
    ],
    priority: 35,
  },
  {
    key: 'restaurant-equipment-cost-efficiency',
    label: 'Restaurant Equipment, Energy Cost, and Operating Efficiency Pressure',
    pattern:
      /\b(?:restaurants?|restaurant chains?|commercial kitchens?|food service kitchens?|restaurant operations?)\b[^.!?]{0,220}\b(?:energy costs?|energy efficiency|energy consumption|utility costs?|electricity bills?|refrigeration|hvac|cooking equipment|kitchen equipment|equipment failures?|maintenance costs?|food waste|ingredient waste|operating costs?|profit margins?)\b|\b(?:energy costs?|energy efficiency|energy consumption|utility costs?|refrigeration|hvac|cooking equipment|kitchen equipment|equipment failures?|maintenance costs?|food waste|ingredient waste|operating costs?)\b[^.!?]{0,220}\b(?:restaurants?|restaurant chains?|commercial kitchens?|food service kitchens?|restaurant operations?)\b/iu,
    strongPatterns: [
      /\b(?:restaurants?|commercial kitchens?)\b/iu,
      /\b(?:rising energy costs?|utility costs?|refrigeration|hvac|cooking equipment|equipment failure|maintenance|food waste|operating costs?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:energy efficiency|equipment intelligence|smart kitchen|food spoilage|ingredient usage|daily sales|utility expenses?|profit margins?|financial lever)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:national energy crisis|iran war|hormuz|data centers?|university apartments?|christmas markets?|global market size|cagr)\b/iu,
    ],
    priority: 31,
  },
  {
    key: 'ev-charging-capacity-financial-sustainability',
    label: 'EV Charging Utilization, Capacity, and Financial Sustainability',
    pattern:
      /\b(?:electric vehicle charging|ev charging|charging stations?|charging infrastructure|public charging)\b[^.!?]{0,240}\b(?:waiting times?|queue lengths?|utilization|underutilized|underperforming|capacity|demand forecast|forecasting demand|future demand|placement|siting|coverage gaps?|electricity costs?|energy costs?|maintenance costs?|maintenance expenses?|payment revenue|revenue|income|profitability|financial sustainability|tariffs?|investment efficiency)\w*\b|\b(?:waiting times?|queue lengths?|utilization|underutilized|underperforming|capacity|demand forecast|forecasting demand|future demand|placement|siting|coverage gaps?|electricity costs?|energy costs?|maintenance costs?|maintenance expenses?|payment revenue|revenue|income|profitability|financial sustainability|tariffs?|investment efficiency)\w*\b[^.!?]{0,240}\b(?:electric vehicle charging|ev charging|charging stations?|charging infrastructure|public charging)\b/iu,
    strongPatterns: [
      /\b(?:electric vehicle charging|ev charging|charging stations?|charging infrastructure)\b/iu,
      /\b(?:waiting|queue|utilization|underperform|capacity|demand forecast|future demand|placement|siting|coverage gap|costs?|maintenance|revenue|income|profitability|financial sustainability|tariffs?)\w*\b/iu,
    ],
    supportingPatterns: [
      /\b(?:peak periods?|peak[- ]hour|traffic load|station usage|public benefits?|economic criterion|investment return|power consumption prediction)\w*\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:conductive charging system|technical standard|funding round|raises? [€$₹]?\d|charging revolution|robotaxi push)\b/iu,
    ],
    priority: 34,
  },
  {
    key: 'interpretation-agency-assignment-coordination',
    label: 'Interpreter Availability, Assignment Matching, and Schedule Coordination Friction',
    pattern:
      /\b(?:sign language interpreters?|asl interpreters?|interpreters?|interpretation agenc(?:y|ies)|interpreting agenc(?:y|ies)|interpreter agenc(?:y|ies)|language service providers?|court interpreters?)\b[^.!?]{0,240}\b(?:shortage|availability|unavailable|scheduling conflicts?|double booking|missed assignments?|assignment matching|assignment allocation|last[- ]minute changes?|cancellations?|client preferences?|communication preferences?|specialized vocabulary|session notes?|dispatcher|coordination)\w*\b|\b(?:shortage|availability|unavailable|scheduling conflicts?|double booking|missed assignments?|assignment matching|assignment allocation|last[- ]minute changes?|cancellations?|client preferences?|specialized vocabulary|session notes?|dispatcher|coordination)\w*\b[^.!?]{0,240}\b(?:sign language interpreters?|asl interpreters?|interpreters?|interpretation agenc(?:y|ies)|interpreting agenc(?:y|ies)|interpreter agenc(?:y|ies)|language service providers?|court interpreters?)\b/iu,
    strongPatterns: [
      /\b(?:sign language interpreters?|asl interpreters?|interpretation agenc(?:y|ies)|interpreting agenc(?:y|ies)|interpreter agenc(?:y|ies)|court interpreters?)\b/iu,
      /\b(?:shortage|availability|scheduling conflicts?|double booking|missed assignments?|assignment matching|last[- ]minute changes?|cancellations?|client preferences?|specialized vocabulary|session notes?|coordination)\w*\b/iu,
    ],
    supportingPatterns: [
      /\b(?:assignment details?|client requirements?|subject matter|dispatcher|staffing pressure|service access)\w*\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:translator app|learn asl|camera translator|time clock|clock[- ]?in|password reset|jailbroken|trade board|shift app)\b/iu,
    ],
    priority: 34,
  },
  {
    key: 'sneaker-cleaning-service-history',
    label: 'Sneaker Cleaning Item Tracking, Treatment History, and Pickup Friction',
    pattern:
      /\b(?:sneaker cleaning|shoe cleaning|sneaker restoration|shoe restoration|footwear cleaning|footwear restoration)\b[^.!?]{0,220}\b(?:lost|misplaced|forgotten|scattered|handwritten tags?|paper tags?|service history|treatment history|wrong treatment|unsuitable cleaning|repeated treatment|pickup delay|delayed pickup|customer request|material type|stain condition)\w*\b|\b(?:lost|misplaced|forgotten|scattered|handwritten tags?|paper tags?|wrong treatment|repeated treatment|pickup delay|delayed pickup)\w*\b[^.!?]{0,220}\b(?:sneaker cleaning|shoe cleaning|sneaker restoration|shoe restoration)\b/iu,
    strongPatterns: [
      /\b(?:sneaker cleaning|shoe cleaning|sneaker restoration|shoe restoration)\b/iu,
      /\b(?:lost|misplaced|forgotten|wrong treatment|unsuitable|repeated treatment|delayed pickup|paper tags?|handwritten tags?)\w*\b/iu,
    ],
    supportingPatterns: [
      /\b(?:material type|stain condition|cleaning preference|previous treatment|service history|repair note|pickup deadline|customer item)\w*\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:meta ads|facebook ads|oil rigs?|drilling|gem catalogue|product upload|oem authorization|shoe store|sneaker release)\b/iu,
    ],
    priority: 32,
  },
  {
    key: 'property-maintenance-cost-performance',
    label: 'Property Maintenance Cost, Deterioration, and Budget Performance',
    pattern:
      /\b(?:property management|property managers?|landlords?|real estate investors?|property investors?|rental properties?|buildings?|apartments?|real estate portfolios?)\b[^.!?]{0,220}\b(?:maintenance costs?|maintenance expenses?|repair costs?|repair expenses?|unexpected costs?|operating expenses?|property budgets?|budget variance|deterioration|deferred maintenance|capital expenditures?|\bcapex\b|vacancies|tenant complaints?|profitability|returns?|cash flow)\b|\b(?:maintenance costs?|maintenance expenses?|repair costs?|repair expenses?|unexpected costs?|operating expenses?|property budgets?|budget variance|deterioration|deferred maintenance|capital expenditures?|\bcapex\b|tenant complaints?)\b[^.!?]{0,220}\b(?:property management|property managers?|landlords?|real estate investors?|property investors?|rental properties?|buildings?|apartments?|real estate portfolios?)\b/iu,
    strongPatterns: [
      /\b(?:property management|property managers?|landlords?|rental properties?|buildings?|real estate portfolios?)\b/iu,
      /\b(?:maintenance costs?|repair costs?|unexpected costs?|operating expenses?|property budgets?|budget variance|deterioration|deferred maintenance|capital expenditures?|\bcapex\b)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:vacancies|tenant complaints?|profitability|returns?|cash flow|contractor expenses?|building age|maintenance history|repair history)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:job vacancies|open positions?|hiring|staff shortages?|employee shortages?|layoffs?|headcount)\b/iu,
      /\b(?:best places? to invest|best cities? to invest|mortgage rates?|reit dividends?|passive income)\b/iu,
    ],
    priority: 28,
  },
  {
    key: 'workforce-capacity',
    label: 'Workforce Capacity and Staffing Continuity Constraints',
    pattern: /\b(?:workforce|staffing|staff shortages?|employee shortages?|worker shortages?|personnel shortages?|headcount|workforce reductions?|staff cuts?|employee cuts?|turnover|vacancies|hiring freeze|layoffs?|understaffed)\b|\b(?:people|employees?|staff|workers?|personnel)\b[^.!?]{0,100}\b(?:government|agency|company|organization|organisation|department|business|institution)\b[^.!?]{0,100}\b(?:lose|losing|loss|cuts?|reduction|shortage|capacity)\b|\b(?:government|agency|company|organization|organisation|department|business|institution)\b[^.!?]{0,100}\b(?:lose|losing|loss|cuts?|reduction|shortage)\b[^.!?]{0,100}\b(?:people|employees?|staff|workers?|personnel)\b/iu,
    strongPatterns: [
      /\b(?:workforce reductions?|staff cuts?|employee cuts?|staff shortages?|employee shortages?|understaffed|hiring freeze|layoffs?|turnover|vacancies)\b/iu,
      /\b(?:people|employees?|staff|workers?|personnel)\b[^.!?]{0,100}\b(?:government|agency|company|organization|organisation|department|business|institution)\b[^.!?]{0,100}\b(?:lose|losing|loss|cuts?|reduction|shortage|capacity)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:service continuity|capacity|workload|overload|hiring|retention|staffing|operations?|public service|delivery capacity)\b/iu,
    ],
    priority: 22,
  },
  { key: 'administrative-back-office', label: 'Administrative Back-Office Workflow Friction', pattern: /\b(?:approval workflow|administrative workflow|administrative process|back office|manual data entry|manual entry)\b/iu },
  { key: 'hr-candidate-pooling', label: 'Candidate Profile Pooling and Reuse for Recurring Hiring', pattern: /(?:(?:candidate|applicant) profiles?|\bprofiles?\b).{0,140}(?:sav(?:e|ing)?|sort|portal|pool|reuse|regular basis|recurring hiring|hire store workers)|(?:sav(?:e|ing)?|sort|portal|pool|reuse).{0,140}(?:(?:candidate|applicant) profiles?|\bprofiles?\b)/iu, strongPatterns: [/(?:sav(?:e|ing)?|sort|portal|pool|reuse).{0,100}(?:(?:candidate|applicant) profiles?|\bprofiles?\b)/iu, /(?:(?:candidate|applicant) profiles?|\bprofiles?\b).{0,120}(?:regular basis|recurring hiring|hire store workers)/iu], supportingPatterns: [/\b(?:applicant tracking|\bats\b|recruitment|recruiter|hiring|talent acquisition)\b/iu], priority: 20 },
  { key: 'hr-client-outreach', label: 'Client Contact Mass Outreach Gaps in Applicant Tracking Systems', pattern: /(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign).{0,120}(?:client contacts?|clients?)|(?:client contacts?|clients?).{0,120}(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign)/iu, strongPatterns: [/(?:mass email(?:ing)?|bulk email(?:ing)?).{0,100}(?:client contacts?|clients?)/iu, /(?:client contacts?|clients?).{0,100}(?:mass email(?:ing)?|bulk email(?:ing)?)/iu], supportingPatterns: [/\b(?:applicant tracking|\bats\b|recruitment|recruiter|staffing)\b/iu], priority: 20 },
  { key: 'hr-recruitment', label: 'Recruitment and Applicant Tracking Friction', pattern: /\b(?:recruitment|recruiter|hiring|applicant tracking|\bats\b|candidate screening|candidate profiles?|interview scheduling|employee onboarding|talent acquisition|job application)\b/iu, strongPatterns: [/\b(?:applicant tracking|\bats\b|candidate screening|candidate profiles?)\b/iu, /\b(?:recruitment|recruiter|hiring|talent acquisition)\b/iu], priority: 8 },
  { key: 'legal-research-access', label: 'Legal Research Documentation Cost and AI Reliability Barriers', pattern: /\b(?:legal researcher|legal research|legal tools?|law databases?|case documentation|evidence documentation|attorney research)\b/iu, strongPatterns: [/\b(?:legal researcher|legal research|law databases?)\b/iu, /\b(?:afford|expensive|price|pricing|licensing fee|1500|documentation burden|documenting)\b/iu, /\b(?:ai|guardrail|factual|facts|looping)\b/iu], priority: 13 },
  { key: 'mobile-license-verification', label: 'Mobile App License Verification and Test Response Failures', pattern: /\b(?:license test response|licensing server|licensechecker|servermanagedpolicy|strictpolicy|not[_ -]?licensed|lvl licensing|google play licensing)\b/iu, strongPatterns: [/\b(?:license test response|licensing server|licensechecker|servermanagedpolicy|strictpolicy|not[_ -]?licensed|lvl licensing)\b/iu, /\b(?:android|google play|mobile app|testing device|test account)\b/iu], supportingPatterns: [/\b(?:public key|cache|debug|distribution key|developer account|test response)\b/iu], priority: 22 },
  { key: 'rental-lease-filtering', label: 'Rental Lease-Term Filtering Limitations', pattern: /\b(?:rental length|lease term|lease duration|short[- ]term rentals?|long[- ]term rentals?|vacation home|vacation rental)\b/iu, strongPatterns: [/\b(?:filter|exclude|include|search)\b[^.!?]{0,100}\b(?:rental length|lease term|lease duration|short[- ]term|long[- ]term)\b/iu, /\b(?:short[- ]term rentals?|vacation home|vacation rental)\b[^.!?]{0,100}\b(?:filter|exclude|long[- ]term|somewhere to live)\b/iu], supportingPatterns: [/\b(?:rent|rental|housing|listing|listings|lease|home)\b/iu], priority: 18 },
  { key: 'real-estate-session-persistence', label: 'Repeated Session Logout Failures', pattern: /\b(?:keep getting logged out|keeps? logging (?:me|us) out|repeated(?:ly)? logged out|session (?:expires?|drops?)|unexpected logout)\b/iu, strongPatterns: [/\b(?:keep getting logged out|repeated(?:ly)? logged out|unexpected logout)\b/iu], supportingPatterns: [/\b(?:zillow|real estate|property|listing|favorites?|saved homes?)\b/iu], priority: 17 },
  { key: 'real-estate-favorites-filtering', label: 'Favorites Location Filtering Gaps', pattern: /\b(?:favorites?|favourites?|saved homes?|saved listings?)\b[^.!?]{0,120}\b(?:location|area|region)\b[^.!?]{0,80}\b(?:filter|search)|\b(?:filter|search)\b[^.!?]{0,120}\b(?:favorites?|favourites?|saved homes?|saved listings?)\b[^.!?]{0,80}\b(?:location|area|region)\b/iu, strongPatterns: [/\bno way to (?:really )?filter (?:my )?(?:favorites?|favourites?) via location\b/iu], supportingPatterns: [/\b(?:zillow|real estate|property|listing|home)\b/iu], priority: 17 },
  { key: 'real-estate-multi-criteria-filtering', label: 'Multi-Criteria Property Filtering Limitations', pattern: /\b(?:multiport|multiple filters?|two filters?|2 filters?|multiple criteria|house size and lot size)\b[^.!?]{0,120}\b(?:simultaneously|at once|together|filter)|\b(?:apply|combine|use)\b[^.!?]{0,80}\b(?:multiple|two|2)\b[^.!?]{0,40}\bfilters?\b/iu, strongPatterns: [/\b(?:house size and lot size|multiple filters?|two filters?|2 filters?)\b[^.!?]{0,100}\b(?:simultaneously|at once|together)\b/iu], supportingPatterns: [/\b(?:zillow|real estate|property|listing|search)\b/iu], priority: 17 },
  { key: 'real-estate-tag-persistence', label: 'User-Defined Property Tag Persistence Failures', pattern: /\b(?:tags?|user[- ]defined tags?|custom tags?)\b[^.!?]{0,120}\b(?:vanish(?:ed)?|disappear(?:ed)?|gone|removed|deleted|missing)|\b(?:vanish(?:ed)?|disappear(?:ed)?|gone|removed|deleted|missing)\b[^.!?]{0,120}\b(?:tags?|user[- ]defined tags?|custom tags?)\b/iu, strongPatterns: [/\b(?:tags?|custom tags?)\b[^.!?]{0,100}\b(?:vanish(?:ed)?|disappear(?:ed)?|gone|missing)\b/iu], supportingPatterns: [/\b(?:property|properties|listing|listings|zillow|notes?)\b/iu], priority: 17 },
  { key: 'feature-change-notification', label: 'Feature Removal and Change Notification Gaps', pattern: /\b(?:announce|notify|notification|communicat)\b[^.!?]{0,140}\b(?:feature|functionality|change|remove|removed|vanish|disappear|alternative)|\b(?:feature|functionality)\b[^.!?]{0,120}\b(?:remove|removed|vanish|disappear)\b[^.!?]{0,120}\b(?:announce|notify|communication|alternative)\b/iu, strongPatterns: [/\b(?:wish|should|need)\b[^.!?]{0,100}\b(?:announce|notify|provide an? alternative)\b/iu], priority: 13 },
  { key: 'rental-application-data-integrity', label: 'Rental Application Data Persistence Failures', pattern: /\b(?:rental application|application data|saved application|old notes?|updated info|saved info|submission)\b/iu, strongPatterns: [/\b(?:old notes?|old data|previous notes?|stale data)\b[^.!?]{0,100}\b(?:re-appear|reappear|return|come back|persist)\b/iu, /\b(?:updated|updating|saved|saving)\b[^.!?]{0,100}\b(?:old notes?|old data|re-appear|reappear|not retained|missing out on rentals?)\b/iu], supportingPatterns: [/\b(?:application|rental|submission|notes?|saved|updated)\b/iu], priority: 17 },
  { key: 'housing-accessibility-metadata', label: 'Rental Accessibility Information Gaps', pattern: /\b(?:ada|accessibility|mobility|wheelchair|stairs?|accessible unit|accessibility info|accessibility information)\b/iu, strongPatterns: [/\b(?:ada|accessibility)\b[^.!?]{0,140}\b(?:listing|rental|property|information|metadata|stairs?|appliances?|mobility)\b/iu, /\b(?:stairs?|mobility|wheelchair|accessible unit)\b[^.!?]{0,120}\b(?:listing|rental|property|information)\b/iu], supportingPatterns: [/\b(?:housing|rental|listing|property|unit|apartment)\b/iu], priority: 17 },
  { key: 'application-access-support', label: 'Application Access and Support Failures', pattern: /\b(?:cannot access|can['’]?t access|unable to access|no customer service|no support|customer service support)\b/iu, strongPatterns: [/\b(?:cannot access|can['’]?t access|unable to access)\b/iu, /\b(?:no customer service|no support|customer service support)\b/iu], priority: 9 },
  { key: 'mental-health-time-access', label: 'Workday Mental Health Time-Access Constraints', pattern: /\b(?:taking time for mental health|time for mental health|mental health time|mental-health time|time off for mental health|mental health break|mental health breaks|self[- ]care time|recovery time)\b/iu, strongPatterns: [/\b(?:taking time for mental health|time off for mental health|mental health time|mental health break|recovery time)\b/iu, /\b(?:luxury|cannot afford|can['’]?t afford|unable to take|difficult to take|hard to take|no time|less than a day)\b/iu], supportingPatterns: [/\b(?:workplace|workday|professional|employee|worker|schedule|self[- ]care|wellness)\b/iu], priority: 21 },
  { key: 'healthcare-treatment-access', label: 'Cross-Border Treatment Availability and Access Gaps', pattern: /\b(?:treatment|therapy|medicine|medication|care)\b[^.!?]{0,180}\b(?:unavailable|not available|unable to access|cannot access|can['’]?t access|another country|one country|different country|cross[- ]border)\b|\b(?:unavailable|not available|unable to access|cannot access|can['’]?t access)\b[^.!?]{0,180}\b(?:treatment|therapy|medicine|medication|care)\b/iu, strongPatterns: [/\b(?:known|successful|effective)\s+treatment\b[^.!?]{0,160}\b(?:unavailable|not available|another country|one country)\b/iu, /\b(?:treatment|care)\b[^.!?]{0,160}\b(?:country|region|cross[- ]border)\b/iu], supportingPatterns: [/\b(?:patient|physician|clinician|healthcare|health care|medical)\b/iu], priority: 20 },
  { key: 'clinical-sparse-measurements', label: 'Sparse Clinical Measurement and Missing-by-Design Data Gaps', pattern: /\b(?:missing values?|null values?|sparse features?|sparse data|imput(?:e|ing|ation)|forward[- ]fill|test results?)\b|\b(?:patient|clinical|medical|physionet|sepsis)\b[^.!?]{0,120}\bmeasurements?\b|\bmeasurements?\b[^.!?]{0,120}\b(?:patient|clinical|medical|physionet|sepsis)\b/iu, strongPatterns: [/\b(?:95\+?%|98%|most|many)\s+(?:of\s+the\s+)?(?:data|values?)\s+(?:is|are)\s+missing\b/iu, /\b(?:tests?|measurements?)\s+(?:are|were)?\s*(?:taken|ordered|measured)\s+(?:infrequently|only when|when ordered)\b/iu, /\b(?:imput(?:e|ing|ation)|forward[- ]fill|mean|median)\b/iu], supportingPatterns: [/\b(?:patient|clinical|medical|physionet|sepsis|test results?)\b/iu], negativePatterns: [/\b(?:records?|files?|history|saved data)\b[^.!?]{0,80}\b(?:disappeared|gone|deleted|lost)\b/iu, /\b(?:metric|imperial) measurement system\b/iu], priority: 22 },
  {
    key: 'identity-wallet-authentication-integration',
    label: 'Digital Identity Wallet Authentication Integration Gaps',
    pattern: /\b(?:oid4vp|oid4vci|eudi[- ]?wallet|eudi wallet|verifiable presentations?|verifiable credentials?|wallet credentials?|identity credentials?|digital identity wallet|credential wallet|pid|electronic attestations?|eaa|keycloak verifier|verifier functionality|verifier[- ]side)\b/iu,
    strongPatterns: [
      /\b(?:oid4vp|eudi[- ]?wallet|eudi wallet)\b/iu,
      /\b(?:keycloak|identity provider|authentication)\b[^.!?]{0,220}\b(?:verifier|oid4vp|wallet credentials?|identity credentials?|pid|electronic attestations?)\b/iu,
      /\b(?:verifier functionality|verifier[- ]side|wallet credentials?|identity credentials?)\b[^.!?]{0,180}\b(?:authenticate|authentication|government online services?|public sector|keycloak)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:authentication|identity|credential|credentials|public authorities|government online services?|eidas|openid|oauth|digital wallet|secure wallet)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:cryptocurrency|crypto wallet|bitcoin|ethereum|solana|token balance|wallet balance|on[- ]chain|blockchain confirmation|transaction confirmation)\b/iu,
    ],
    priority: 31,
  },
  {
    key: 'blockchain-wallet-state-sync',
    label: 'Wallet Transaction Visibility and State Synchronization Failures',
    pattern: /\b(?:wallet|account balance|wallet balance|transactions?|confirmations?|blockchain confirmation|transaction history|deposit history|history entry|ledger entry|on-chain deposit)\b/iu,
    strongPatterns: [
      /\b(?:wallet|account balance|wallet balance)\b[^.!?]{0,180}\b(?:transaction|confirmation|blockchain)\b/iu,
      /\b(?:confirmed|confirmations?|blockchain|on-chain)\b[^.!?]{0,220}\b(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|balance|show(?:s|ed)? nothing|no visible indication|no (?:transaction|history|ledger) entry)\b/iu,
      /\b(?:transactions?|balance|deposit|transfer)\b[^.!?]{0,200}\b(?:missing|not showing|incorrect|wrong|0|zero|show(?:s|ed)? nothing|no visible indication|no (?:transaction|history|ledger) entry)\b/iu,
      /\b(?:deposit|transfer)\b[^.!?]{0,180}\b(?:consumed|swallowed)\b[^.!?]{0,100}\b(?:fee|fees)\b[^.!?]{0,180}\b(?:no (?:transaction|history|ledger) entry|no visible indication|show(?:s|ed)? nothing|missing from (?:history|the app))\b/iu,
      /\b(?:no transaction\/?history entry|no transaction entry|no history entry|no ledger entry|no visible indication)\b[^.!?]{0,180}\b(?:deposit|transaction|confirmed|confirmation|blockchain|fee)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:mobile|desktop|client|green mobile app|wallet app|blink-mobile)\b/iu,
      /\b(?:sync|synchroni[sz]|state|visibility|confirmation count|deposit fee|transaction history|explainer|explanatory state)\b/iu,
    ],
    negativePatterns: [
      /\b(?:menu navigation|lost between pages|cannot find services|can['’]?t find services|hard to navigate)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:oid4vp|oid4vci|eudi[- ]?wallet|eudi wallet|verifiable presentations?|verifiable credentials?|wallet credentials?|identity credentials?|digital identity wallet|credential wallet|keycloak verifier|verifier functionality|verifier[- ]side|electronic attestations?)\b/iu,
    ],
    priority: 24,
  },
  {
    key: 'device-protocol-compatibility',
    label: 'Device Protocol Compatibility and Connectivity Limitations',
    pattern: /(?:\bant\b[^.!?]{0,120}\b(?:support|unsupported|cycling|fitness|wearable|gear|device|equipment|protocol|connect|compatib)|\b(?:wireless protocol|protocol support|protocol compatibility|device compatibility|hardware compatibility|unsupported protocol|unsupported device|cycling gear|fitness gear)\b)/iu,
    strongPatterns: [
      /\bant\b[^.!?]{0,140}\b(?:support|unsupported|cannot|can['’]?t|unable|gear|device|equipment|connect|compatib)/iu,
      /\b(?:protocol|device|hardware) compatibility\b/iu,
      /\b(?:cannot|can['’]?t|unable to)\b[^.!?]{0,120}\b(?:use|connect|pair)\b[^.!?]{0,120}\b(?:gear|device|equipment|sensor|wearable)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:wearable|watch|cycling|fitness|sensor|equipment|bluetooth|pairing|connectivity|firmware)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:login|log in|sign in|password|account access|oauth|oidc|two[- ]factor authentication|2fa|verification code)\b/iu,
    ],
    priority: 26,
  },
  {
    key: 'route-planning-capability',
    label: 'Route Planning Stop Reference and Import Limitations',
    pattern: /\b(?:routing app|route planning|route planner|route planning software|unlimited stops?|stop numbers?|driver references?|import stops?|upload stops?|stop list)\b/iu,
    strongPatterns: [
      /\b(?:routing app|route planner|route planning software)\b[^.!?]{0,160}\b(?:upload|import|stop numbers?|driver references?|unlimited stops?|stop list)\b/iu,
      /\b(?:upload|import)\b[^.!?]{0,120}\b(?:stop numbers?|driver references?|stops?|route list)\b/iu,
    ],
    supportingPatterns: [/\b(?:drivers?|dispatch|delivery|stops?|route|routing|planner)\b/iu],
    hardNegativePatterns: [/\b(?:404|not found|missing url|incorrect url|broken link|broken route|redirect|deep[- ]link|endpoint)\b/iu],
    priority: 25,
  },
  {
    key: 'application-update-loop',
    label: 'Application Update Loop and Version Verification Failures',
    pattern: /\b(?:update loop|version mismatch|latest version|already updated|already installed|prompted to update|keeps? asking to update|app store update)\b/iu,
    strongPatterns: [
      /\b(?:prompted|asked|keeps? asking)\b[^.!?]{0,100}\bupdate\b[^.!?]{0,160}\b(?:latest version|already installed|already updated|app store|play store)\b/iu,
      /\b(?:latest version|already installed|already updated)\b[^.!?]{0,140}\b(?:update|app store|play store)\b/iu,
    ],
    supportingPatterns: [/\b(?:version|store|launch|open|enter|access)\b/iu],
    priority: 25,
  },
  { key: 'duplicate-payment-reconciliation', label: 'Duplicate Payment and Payment Reconciliation Failures', pattern: /\b(?:already paid|paid\b[^.!?]{0,90}\bcash|cash\b[^.!?]{0,90}\bpaid|charged\b[^.!?]{0,90}\bagain|double charg(?:e|ed|ing)?|duplicate charg(?:e|ed|ing)?|payment reconciliation|proof of payment\b[^.!?]{0,120}\b(?:additional|another|again|insist|payment))\b/iu, strongPatterns: [/\b(?:already paid|charged\b[^.!?]{0,90}\bagain|double charg(?:e|ed|ing)?|duplicate charg(?:e|ed|ing)?|payment reconciliation)\b/iu], supportingPatterns: [/\b(?:refund|cash|driver|rider|proof of payment|support team|billing|payment)\b/iu], priority: 18 },
  { key: 'shipment-transit-metrics', label: 'Shipment Transit-Time Visibility Gaps', pattern: /\b(?:(?:average|estimated|typical)\s+(?:shipment\s+|delivery\s+)?transit\s+time|(?:shipment|delivery)\s+transit\s+(?:time|duration)|transit\s+time\s+(?:metric|metrics|average|analytics|visibility))\b/iu, strongPatterns: [/\b(?:average|estimated|typical)\s+(?:shipment\s+|delivery\s+)?transit\s+time\b/iu], supportingPatterns: [/\b(?:shipment|delivery|tracking|aftership|courier|logistics)\b/iu], priority: 17 },
  {
    key: 'restaurant-location-discovery',
    label: 'Restaurant Location Search and Nearby Discovery Failures',
    pattern: /\b(?:restaurant|restaurants|dining|eatery|eateries)\b[^.!?]{0,180}\b(?:nearby|near me|other states?|wrong state|wrong city|wrong location|don['’]?t populate|doesn['’]?t populate|not populate|not showing|not listed|can['’]?t find|cannot find|unable to find|search(?:es|ing)? elsewhere|location search)\b|\b(?:nearby|near me|other states?|wrong state|wrong city|wrong location|don['’]?t populate|doesn['’]?t populate|not populate|not showing|not listed|can['’]?t find|cannot find|unable to find)\b[^.!?]{0,180}\b(?:restaurant|restaurants|dining|eatery|eateries)\b/iu,
    strongPatterns: [
      /\b(?:restaurant|restaurants)\b[^.!?]{0,150}\b(?:other states?|wrong state|wrong city|don['’]?t populate|doesn['’]?t populate|not populate|nearby|near me)\b/iu,
      /\b(?:nearby|near me|other states?|wrong state|wrong city)\b[^.!?]{0,150}\b(?:restaurant|restaurants)\b/iu,
    ],
    supportingPatterns: [/\b(?:search|discover|location|geo|map|nearby|restaurant|restaurants|dining)\b/iu],
    priority: 27,
  },
  {
    key: 'dining-history-memory',
    label: 'Dining History and Meal Memory Organization Gaps',
    pattern: /\b(?:restaurant|restaurants|dining|meals?|dishes?|food|places?)\b[^.!?]{0,220}\b(?:remember|remembering|recall|memory|history|diary|journal|notes?|track|tracking|record|recording|past visits?|previous visits?|family sharing|share with family)\b|\b(?:remember|remembering|recall|memory|history|diary|journal|notes?|track|tracking|record|recording|past visits?|previous visits?|family sharing|share with family)\b[^.!?]{0,220}\b(?:restaurant|restaurants|dining|meals?|dishes?|food|places?)\b/iu,
    strongPatterns: [
      /\b(?:terrible|bad|poor) memory\b[^.!?]{0,180}\b(?:restaurant|restaurants|meals?|dishes?|places?|where we ate|what we ate)\b/iu,
      /\b(?:restaurant|restaurants|meals?|dishes?)\b[^.!?]{0,180}\b(?:history|diary|journal|remember|recall|track|record|notes?|family sharing)\b/iu,
    ],
    supportingPatterns: [/\b(?:geo|photo metadata|notes?|family sharing|history|diary|journal|visits?|meals?|dishes?)\b/iu],
    priority: 28,
  },
  {
    key: 'billing-payment',
    label: 'Billing and Payment Failures',
    pattern: /\b(?:payment|checkout|card|charged|charge|billing|bill|invoice|transaction|refund|price|cost|expensive|afford|affordable|paywall|subscription)\b/iu,
    negativePatterns: [
      /\bin charge of\b/iu,
    ],
  },
  { key: 'outage-reliability', label: 'Service Outage and Reliability Failures', pattern: /\b(?:outage|power cut|service down|downtime|offline|unavailable|blackout|disconnect(?:ed|ion)?|interruption)\b/iu },
  {
    key: 'employee-identity-access-drift',
    label: 'Employee Identity, Access Drift, and Suspicious Account Activity',
    pattern: /\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|employee accounts?|privileged accounts?|identity lifecycle|account lifecycle)\b[^.!?]{0,260}\b(?:permissions?|access rights?|entitlements?|least privilege|privilege creep|privileged access|role changes?|change roles?|authentication|mfa|access drift|unauthorized access|unauthorised access|suspicious activity|security alerts?)\b|\b(?:permissions?|access rights?|entitlements?|least privilege|privilege creep|privileged access|role changes?|change roles?|authentication|mfa|access drift|unauthorized access|unauthorised access|suspicious activity|security alerts?)\b[^.!?]{0,260}\b(?:employees?|staff|workforce|personnel|contractors?|former employees?|employee accounts?|privileged accounts?|identity lifecycle|account lifecycle)\b/iu,
    strongPatterns: [
      /\b(?:employees?|staff|contractors?|former employees?)\b[^.!?]{0,180}\b(?:change roles?|role changes?|retain(?:ed)? (?:temporary )?(?:access|privileges?)|permissions? accumulate|privilege creep|excessive privileges?|access drift)\b/iu,
      /\b(?:identity lifecycle|account lifecycle|least privilege|privilege creep|privileged access)\b[^.!?]{0,180}\b(?:employees?|staff|contractors?|roles?|permissions?|entitlements?)\b/iu,
      /\b(?:suspicious employee account activity|compromised employee account|employee account compromise|unauthorized employee access|unauthorised employee access)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:access logs?|login records?|authentication|mfa|security alerts?|continuous validation|identity monitoring|incident investigation|control drift|expected access polic(?:y|ies))\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:model context protocol|\bmcp\b|prompt injection|tool manifests?|ai agents?|student exposure|hacking tutorials?|crypto wallet|cryptocurrency|binance)\b/iu,
    ],
    priority: 36,
  },
  { key: 'authentication', label: 'Login and Account Access Failures', pattern: /\b(?:login|log in|authentication|sign in|password|session expired|account access|identity provider|oidc|oauth|keycloak|cookie not found|cookie_not_found|two[- ]factor authentication|2fa|multi[- ]factor authentication|verification code|access (?:my|the|an?) account)\b/iu, strongPatterns: [/\b(?:identity provider login error|identity_provider_login_error|cookie not found|cookie_not_found|oidc|oauth|keycloak|authentication session|login_required|login required|two[- ]factor authentication|2fa|multi[- ]factor authentication)\b/iu, /\b(?:login|log in|authentication|sign in|account access)\b[^.!?]{0,80}\b(?:fail|failed|failure|error|blocked|unable|cannot|can['’]?t)\b/iu, /\b(?:cannot|can['’]?t|unable to)\s+(?:log in|login|sign in|access)\s+(?:(?:to\s+)?(?:my|the|this|an?)\s+)?account\b/iu, /\blocked out of (?:my|the|this) account\b/iu], supportingPatterns: [/\b(?:redirect|callback|cookie|session|sso|external idp|okta|azure|ping|account|otp)\b/iu], hardNegativePatterns: [/\b(?:ant\+|wireless protocol|protocol compatibility|cycling gear|fitness gear)\b/iu], priority: 20 },
  { key: 'regional-feature-access', label: 'Regional Feature Access Restrictions', pattern: /\b(?:cannot|can['’]?t|can\s+t|unable to|unavailable|not available|blocked|restricted)\b[^.!?]{0,140}\b(?:area|country|region|location)\b|\b(?:area|country|region|location)\b[^.!?]{0,140}\b(?:cannot|can['’]?t|can\s+t|unable to|unavailable|not available|blocked|restricted)\b/iu, strongPatterns: [/\b(?:cannot|can['’]?t|unable to)\b[^.!?]{0,100}\b(?:chat|post|feature|service|app|application|access|use)\b[^.!?]{0,100}\b(?:area|country|region|location)\b/iu, /\b(?:chat|post|feature|service|app|application)\b[^.!?]{0,100}\b(?:unavailable|not available|blocked|restricted)\b[^.!?]{0,100}\b(?:area|country|region|location)\b/iu], supportingPatterns: [/\b(?:chat|post|feature|service|app|application|access|regional|local availability)\b/iu], priority: 23 },
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
  {
    key: 'calendar-event-visibility',
    label: 'Calendar Event Inclusion, Recurrence, and Visibility Gaps',
    pattern: /\b(?:ics|calendar|calendars|public holidays?|statutory holidays?|recurring events?|generic events?|holiday feed|calendar feed)\b/iu,
    strongPatterns: [
      /\b(?:ics|calendar|calendars|calendar feed|holiday feed)\b[^.!?]{0,180}\b(?:omit|omits|omitted|missing|exclude|excluded|recur|recurs|recurring|visibility|clutter)\b/iu,
      /\b(?:omit|omits|omitted|missing|exclude|excluded|recur|recurs|recurring|visibility|clutter)\b[^.!?]{0,180}\b(?:ics|calendar|calendars|public holidays?|statutory holidays?|generic events?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:sunday|sundays|observance|observances|regional holidays?|event inclusion|event exclusion|feed parser|yaml)\b/iu,
    ],
    priority: 26,
  },
  { key: 'monitoring-data', label: 'Monitoring and Data Visibility Gaps', pattern: /\b(?:monitor(?:ing)?|dashboard|status|tracking|telemetry|live data|real[- ]time|history|usage view|consumption view)\b/iu },
  { key: 'inaccurate-readings', label: 'Inaccurate Readings and Data Quality', pattern: /\b(?:inaccurate|incorrect|wrong reading|wrong data|reading(?:s)? wrong|measurement|meter reading|precision|not accurate|data is wrong)\b/iu },
  { key: 'energy-consumption', label: 'Energy Consumption Insight Gaps', pattern: /\b(?:energy consumption|electricity usage|power usage|energy usage|consumption|kilowatt|kwh|meter usage|utility usage)\b/iu },
  {
    key: 'device-sync',
    label: 'Device Synchronization and Connectivity Failures',
    pattern:
      /\b(?:sync|synchroni[sz](?:e|ed|ing|ation)?|pairing|paired|unpaired|disconnect(?:ed|ion)?|connection (?:drop|drops|failure|failures|issue|issues|lost)|connectivity (?:failure|failures|issue|issues|loss)|cannot connect|can['’]?t connect|unable to connect|failed to connect|gateway (?:offline|unreachable|disconnect(?:ed|ion)?)|device (?:offline|unreachable|not syncing|won['’]?t sync|fails? to sync)|sensor (?:offline|unreachable|disconnect(?:ed|ion)?|not syncing)|smart meter (?:offline|unreachable|not syncing))\b/iu,
    strongPatterns: [
      /\b(?:sync|synchroni[sz](?:e|ed|ing|ation)?)\b[^.!?]{0,120}\b(?:fail|failed|failure|stale|missing|wrong|incorrect|retry|offline|unreachable)\b/iu,
      /\b(?:device|sensor|gateway|smart meter)\b[^.!?]{0,120}\b(?:offline|unreachable|disconnect(?:ed|ion)?|not syncing|won['’]?t sync|fails? to sync|connection (?:drop|failure|issue))\b/iu,
      /\b(?:cannot|can['’]?t|unable to|failed to)\s+connect\b/iu,
    ],
    supportingPatterns: [
      /\b(?:bluetooth|wifi|wi-fi|gateway|device|sensor|smart meter|firmware|remote state|local state|freshness)\b/iu,
    ],
    priority: 18,
  },
  { key: 'data-visualization-reactive', label: 'Data Visualization Shape and Reactive Plotting Errors', pattern: /\b(?:ggplot2?|shiny|renderplot|plotoutput|geom_line|aesthetics must be either length|reactive|observe)\b/iu, strongPatterns: [/\b(?:aesthetics must be either length|ggplot2?|shiny|renderplot|plotoutput|geom_line)\b/iu], supportingPatterns: [/\b(?:plot|graph|chart|multiple lines|x[- ]axis|y[- ]axis|reactive|observe|data frame|dataframe)\b/iu], priority: 18 },
  { key: 'data-fragmentation', label: 'Fragmented Data Integration and Coordination', pattern: /\b(?:fragmented data|fragmented information|data fragmentation|information fragmentation|disconnected (?:data|systems?|sources?)|siloed (?:data|systems?|records?)|multiple disconnected systems?|separate data sources?|missing data layer|foundational data layer|unified data layer|data integration gap|data integration friction)\b/iu, strongPatterns: [/\b(?:fragmented|disconnected|siloed)\b[^.!?]{0,120}\b(?:data|information|systems?|sources?|records?)\b/iu, /\b(?:missing|foundational|unified) data layer\b/iu], supportingPatterns: [/\b(?:integration|normalization|standardization|accessibility|coordination|schema|property records?|asset data)\b/iu], priority: 19 },
  { key: 'data-loss', label: 'Data Loss and Persistence Failures', pattern: /(?:\b(?:data|information|history|conversation|conversations|chat|chats|records?|files?|progress|drafts?|saved items?|favorites?|notes?|profiles?|state|memory|voice|voices|assets?)\b.{0,55}\b(?:lost|missing|deleted|gone|disappear(?:ed)?|not saved|save failed|reset|wiped)\b)|(?:\b(?:lost|missing|deleted|gone|disappear(?:ed)?|reset|wiped)\b.{0,55}\b(?:data|information|history|conversation|conversations|chat|chats|records?|files?|progress|drafts?|saved items?|favorites?|notes?|profiles?|state|memory|voice|voices|assets?)\b)|\b(?:data loss|lost data|missing data|history missing|persistence failure|persistence failures)\b/iu, strongPatterns: [/(?:\b(?:data|information|history|conversation|conversations|chat|chats|records?|files?|progress|drafts?|saved items?|favorites?|notes?|profiles?|state|memory|voice|voices|assets?)\b.{0,35}\b(?:lost|missing|deleted|gone|disappear(?:ed)?|reset|wiped)\b)|\b(?:data loss|lost data|missing data|history missing)\b/iu], negativePatterns: [/\b(?:deleted|removed)\s+(?:the\s+)?app\b|\bapp\s+(?:deleted|removed)\b|\bdeleted,?\s+and\s+will\s+never\s+use\s+again\b|\bdeleted\s+it\s+and\s+will\s+never\s+use\s+again\b/iu, /\b(?:missing|null) values?\b|\b(?:imput(?:e|ing|ation)|forward[- ]fill|mean|median)\b|\btests? (?:are|were )?(?:taken|ordered) infrequently\b/iu, /\b(?:missing (?:note|notes|documentation|field|fields)|coding mistake)\b[^.!?]{0,140}\b(?:billing|claim|claims|reimbursement|payer|authorization|coding|revenue cycle)\b|\b(?:billing|claim|claims|reimbursement|payer|authorization|coding|revenue cycle)\b[^.!?]{0,140}\b(?:missing (?:note|notes|documentation|field|fields)|coding mistake)\b/iu], hardNegativePatterns: [/\b(?:missing|foundational|unified) data layer\b|\b(?:fragmented|disconnected|siloed)\b[^.!?]{0,120}\b(?:data|information|systems?|sources?|records?)\b/iu, /\b(?:ggplot2?|shiny|renderplot|plotoutput|geom_line|aesthetics must be either length|reactive|observe)\b/iu], priority: 6 },

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
    key: 'blockchain-transaction-execution',
    label: 'Blockchain Transaction Execution and Smart Contract Revert Failures',
    pattern: /\b(?:blockchain transaction execution(?: and smart contract revert)? failures?|smart contract revert failures?|transaction reverted|transaction revert|execution reverted|execution revert|reverted without (?:a )?reason(?: string)?|revert reason|providererror|provider error|failed transaction|transaction failed|transaction status (?:is |was )?failed|status (?:is |was )?always failed|smart contract (?:call|transaction|execution) (?:failed|fails|reverted)|contract (?:call|transaction|execution) (?:failed|fails|reverted)|gas estimation failed|estimate gas failed|cannot estimate gas|cannot estimate transaction|evm revert|vm exception while processing transaction)\b/iu,
    strongPatterns: [
      /\b(?:transaction reverted|execution reverted|reverted without (?:a )?reason(?: string)?|providererror|provider error)\b/iu,
      /\b(?:smart contract|contract|web3|hardhat|alchemy|goerli|ethereum|evm|solidity)\b[^.!?]{0,180}\b(?:revert(?:ed|ing)?|transaction (?:failed|fails)|execution (?:failed|fails)|status (?:is |was )?failed)\b/iu,
      /\b(?:revert(?:ed|ing)?|transaction (?:failed|fails)|execution (?:failed|fails)|status (?:is |was )?failed)\b[^.!?]{0,180}\b(?:smart contract|contract|web3|hardhat|alchemy|goerli|ethereum|evm|solidity)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:blockchain|smart contract|contract|web3|hardhat|alchemy|goerli|ethereum|evm|solidity|transaction hash|receipt|event logs?|console\.sol|require\(|gas|provider)\b/iu,
    ],
    negativePatterns: [
      /\b(?:card transaction|payment transaction|bank transaction|purchase transaction|refund transaction|invoice transaction)\b/iu,
    ],
    priority: 29,
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
  {
    key: 'navigation-ui',
    label: 'Navigation and Interface Friction',
    pattern: /\b(?:navigation|interface|ui|button|menu|layout|screen|hard to use|difficult to use|not intuitive|confusing|cannot\s+(?:easily\s+)?find|can['’]?t\s+(?:easily\s+)?find|lost between (?:too many )?(?:texts?|pages?))\b/iu,
    strongPatterns: [
      /\b(?:cannot\s+(?:easily\s+)?find|can['’]?t\s+(?:easily\s+)?find)\b[^.!?]{0,100}\b(?:services?|pages?|options?|settings?|information)\b/iu,
      /\b(?:complex|difficult|confusing|not intuitive)\b[^.!?]{0,100}\b(?:use|navigate|find|pages?|services?|interface)\b/iu,
    ],
    priority: 8,
  },
  { key: 'performance', label: 'Performance and Responsiveness Failures', pattern: /\b(?:slow|lag|latency|freeze|frozen|stuck|unresponsive|takes too long|loading forever)\b/iu },
  { key: 'healthcare-ai-service', label: 'Healthcare AI Service Complaint and Validation Gaps', pattern: /\b(?:ai[- ]assisted customer[- ]service|ai[- ]driven customer[- ]service|ai customer service|ai phone assistant|automated ai customer service|automated healthcare interaction|healthcare ai support)\b/iu, strongPatterns: [/\b(?:healthcare|health care|pharmacy|patient|clinical)\b/iu, /\b(?:complaints?|failure|failed|pulled|withdrew|service termination|friction|dissatisfaction)\b/iu], supportingPatterns: [/\b(?:phone assistant|customer service|human review|feedback|triage)\b/iu], priority: 9 },
  { key: 'navigation-routing', label: 'Navigation and Routing Endpoint Failures', pattern: /\b(?:404|not found|missing url|incorrect url|broken route|broken link|redirect|deep[- ]link|destination page|missing endpoint|incorrect endpoint|endpoint failure)\b/iu, strongPatterns: [/\b404\b/iu, /\b(?:missing|incorrect) url\b/iu, /\b(?:broken route|broken link|deep[- ]link|destination page|missing endpoint|incorrect endpoint)\b/iu], supportingPatterns: [/\b(?:button|page|feedback|rating|rate us|navigation|redirect|endpoint)\b/iu], hardNegativePatterns: [/\b(?:routing app|route planner|route planning software|stop numbers?|driver references?|unlimited stops?|upload stops?|import stops?)\b/iu], negativePatterns: [/\b(?:identity provider login error|identity_provider_login_error|cookie not found|cookie_not_found|oidc|oauth|keycloak|authentication|login_required|login required|sso session|external idp)\b/iu], priority: 14 },
  { key: 'crash-runtime', label: 'Application Crash and Runtime Failures', pattern: /\b(?:crash|crashes|crashed|crashing|runtime error|runtime failure|exception|app closes|application closes|freeze|frozen|unresponsive)\b/iu, negativePatterns: [/\b(?:404|missing url|incorrect url|broken route|broken link|redirect|deep[- ]link)\b/iu, /\b(?:crash[- ]course|course crash)\b/iu, /\b(?:not|never|without|no)\s+(?:actually\s+)?crash(?:es|ed|ing)?\b/iu, /\b(?:keyboard (?:appears? )?(?:frozen|freeze)|focus (?:remains|stays|trapped|stuck)|focus trap|keystrokes? (?:are )?captured|type[- ]ahead|screen reader)\b/iu], priority: 5 },
  {
    key: 'tourism-environmental-pressure',
    label: 'Tourism Carrying Capacity and Environmental Pressure',
    pattern: /\b(?:overtourism|tourism pressure|tourist pressure|visitor pressure|tourist traffic|visitor traffic|tourism flows?|tourist flows?|visitor flows?|tourism carrying capacity|tourist carrying capacity|visitor carrying capacity|tourist concentration|visitor concentration|tourism overcrowding|tourist overcrowding|visitor overcrowding)\b/iu,
    strongPatterns: [
      /\b(?:overtourism|tourism carrying capacity|tourist carrying capacity|visitor carrying capacity)\b/iu,
      /\b(?:tourism|tourist|tourists|visitor|visitors)\b[^.!?]{0,220}\b(?:overcrowd|carrying capacity|water consumption|water usage|waste|litter|pollution|environmental degradation|resource exploitation|resource pressure|sensitive areas?)\w*\b/iu,
    ],
    supportingPatterns: [
      /\b(?:water consumption|water usage|waste|litter|pollution|environmental degradation|resource exploitation|resource pressure|carrying capacity|overcrowd|resident sentiment|visitor management|sensitive areas?)\w*\b/iu,
    ],
    priority: 31,
  },
  {
    key: 'urban-corridor-congestion-root-cause',
    label: 'Urban Corridor Congestion, Transit Delay, and Root-Cause Visibility Gaps',
    pattern: /\b(?:intersection congestion|traffic congestion|bus corridor|bus corridors|recurring delays?|signal timing|passenger volumes?|traffic sensors?|vehicle locations?|road incident reports?|corridor congestion)\b/iu,
    strongPatterns: [
      /\b(?:city transport(?:ation)? departments?|municipal transport(?:ation)?|transportation agencies?|transit agencies?|public transport(?:ation)? authorities?)\b[^.!?]{0,240}\b(?:intersection congestion|bus corridors?|traffic congestion|signal timing|passenger volumes?|recurring delays?|road incidents?)\b/iu,
      /\b(?:traffic sensors?|vehicle locations?|signal timing|passenger volumes?|road incident reports?)\b[^.!?]{0,240}\b(?:separate systems?|siloed|fragmented|root cause|real cause|recurring delays?|congestion|bottlenecks?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:public transport|public transportation|transit|traffic congestion|bus corridors?|passenger volumes?|signal timing|traffic sensors?|road incidents?|travel times?|overcrowded routes?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:tourism|tourist|tourists|visitor surge|visitor demand|festival|holiday|attraction|destination management|overtourism)\b/iu,
    ],
    priority: 36,
  },
  {
    key: 'tourism-transit-surge-capacity',
    label: 'Tourism Transit Surge, Congestion, and Capacity Pressure',
    pattern: /\b(?:overtourism|tourism boom|visitor surge|tourist surge|passenger surge|festival|holiday|public event|overcrowd|congestion|visitor hotspot|visitor hot spot|transport capacity|transit capacity|waiting time|demand-responsive transport)\w*\b/iu,
    strongPatterns: [
      /\b(?:tourism|tourist|visitors?)\b[^.!?]{0,180}\b(?:public transport|transit|congestion|overcrowd|capacity|waiting|hotspot|hot spot|visitor surge|demand surge)\w*\b/iu,
      /\b(?:public transport|transit|city transport)\b[^.!?]{0,180}\b(?:festival|holiday|visitor|tourist|event|passenger surge|capacity|overcrowd|congestion)\w*\b/iu,
    ],
    supportingPatterns: [
      /\b(?:visitor flow|tourist flow|passenger volume|transport demand|capacity pressure|visitor management|demand responsive|demand-responsive|waiting time|overcrowd|congestion)\w*\b/iu,
    ],
    negativePatterns: [
      /\b(?:city transport(?:ation)? departments?|municipal transport(?:ation)? departments?|traffic sensors?|signal timing|road incident reports?|intersection congestion|bus corridors?)\b/iu,
    ],
    priority: 34,
  },
  {
    key: 'umbrella-repair-service-history',
    label: 'Umbrella Repair Parts, History, and Pickup Coordination Friction',
    pattern: /\b(?:umbrella repair|umbrella restoration|parasol repair|broken ribs?|damaged ribs?|replacement parts?|repair history|previous repairs?|pickup dates?|delayed pickup)\w*\b/iu,
    strongPatterns: [
      /\b(?:umbrella|parasol)\b[^.!?]{0,180}\b(?:wrong|incorrect|missing|lost|repeated|delay|delayed|replacement part|repair history|pickup)\w*\b/iu,
    ],
    supportingPatterns: [
      /\b(?:ribs?|canopy|fabric condition|handle|replacement parts?|previous repairs?|customer preferences?|pickup dates?|repair notes?)\w*\b/iu,
    ],
    priority: 33,
  },
  { key: 'public-transport', label: 'Public Transport Reliability Friction', pattern: /\b(?:public transport|public transportation|public transit|mass transit|bus service|bus route|train service|rail service|metro|route planner|arrival time)\b/iu },
  { key: 'traffic-congestion', label: 'Traffic Congestion and Routing Friction', pattern: /\b(?:traffic|congestion|bottleneck|gridlock|stuck in traffic|route)\b/iu },
  {
    key: 'delivery-tracking',
    label: 'Shipment Loss, Delay, and Delivery Tracking Failures',
    pattern: /\b(?:delivery|deliveries|shipment|shipments|shipping|tracking|driver|courier|carrier|package|packages|parcel|parcels|proof of delivery|in transit)\b/iu,
    strongPatterns: [
      /\b(?:lost|missing|stuck|stalled|delayed|not delivered|unable to leave|sitting in .*facility)\b[^.!?]{0,140}\b(?:shipment|shipping|package|parcel|delivery|transit|carrier|facility)\b/iu,
      /\b(?:shipment|shipping|package|parcel|delivery|transit|carrier|facility)\b[^.!?]{0,140}\b(?:lost|missing|stuck|stalled|delayed|not delivered|unable to leave|sitting)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:tracking|carrier|warehouse|facility|investigation|customer support|international shipping)\b/iu,
    ],
    priority: 16,
  },
  {
    key: 'cybersecurity-learning-content-safety',
    label: 'Cybersecurity Learning Content Safety and Student Exposure Risks',
    pattern: /\b(?:cybersecurity|cyber security|security course|security training|hacking tutorial|hacking tutorials|student exposure|unsafe content|malicious tutorial)\b/iu,
    strongPatterns: [
      /\b(?:students?|learners?|course|classroom|teaching|training)\b[^.!?]{0,160}\b(?:hacking tutorials?|unsafe content|malicious instructions?|student exposure|security risk)\b/iu,
      /\b(?:hacking tutorials?|unsafe content|malicious instructions?|student exposure)\b[^.!?]{0,160}\b(?:students?|learners?|course|classroom|teaching|training)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:cybersecurity course|youtube videos?|threat awareness|teaching|learning platform|content review)\b/iu,
    ],
    priority: 19,
  },
  {
    key: 'musical-instrument-repair-service-history',
    label: 'Musical Instrument Repair Service History and Setup Record Friction',
    pattern:
      /\b(?:guitar|guitars|luthier|luthiers|musical instrument|instrument repair|guitar repair|repair technician)\b[^.!?]{0,220}\b(?:service history|repair history|service records?|repair records?|bench notes?|setup preferences?|customer preferences?|fret wear|neck adjustments?|replacement parts?|parts tracking|instrument condition|customer messages?|receipts?|work orders?)\b[^.!?]{0,180}\b(?:lost|missing|forgotten|scattered|fragmented|handwritten|paper|wrong|incorrect|misplaced|repeated|repeat work|rework|unnecessary|inconsistent|difficult|hard to track|not tracked|miscommunication|delay|delayed)\w*\b|\b(?:lost|missing|forgotten|scattered|fragmented|handwritten|paper|wrong|incorrect|misplaced|repeated|repeat work|rework|unnecessary|inconsistent|difficult|hard to track|not tracked|miscommunication|delay|delayed)\w*\b[^.!?]{0,180}\b(?:service history|repair history|service records?|repair records?|bench notes?|setup preferences?|customer preferences?|fret wear|neck adjustments?|replacement parts?|parts tracking|instrument condition|customer messages?|receipts?|work orders?)\b[^.!?]{0,220}\b(?:guitar|guitars|luthier|luthiers|musical instrument|instrument repair|guitar repair|repair technician)\b/iu,
    strongPatterns: [
      /\b(?:guitar|guitars|luthier|luthiers|musical instrument|instrument repair|guitar repair)\b/iu,
      /\b(?:lost|missing|forgotten|scattered|fragmented|wrong|incorrect|misplaced|repeated|rework|unnecessary|inconsistent|hard to track|not tracked|miscommunication)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:service history|repair history|service records?|repair records?|bench notes?|setup preferences?|customer preferences?|fret wear|neck adjustments?|replacement parts?|parts tracking|instrument condition|customer messages?|receipts?|work orders?)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:diy workshop|shop opens?|shop reopened|shop reopens?|beloved by|anniversary|guitar shops? in|repair industry profile|how to build or repair)\b/iu,
      /\b(?:crypto|cryptocurrency|wallet|binance|exchange platform)\b/iu,
    ],
    priority: 26,
  },
  { key: 'energy-equipment-failure', label: 'Energy Equipment Reliability and Failure Diagnostics', pattern: /\b(?:inverter|solar inverter|power inverter|transformerless inverter|mosfet|igbt|capacitor|battery inverter)\b[^.!?]{0,180}\b(?:fail|failed|failure|fault|broken|blown|short circuit|overheat|damaged|diagnos|troubleshoot|repair)\w*\b|\b(?:fail|failed|failure|fault|broken|blown|short circuit|overheat|damaged|diagnos|troubleshoot|repair)\w*\b[^.!?]{0,180}\b(?:inverter|solar inverter|power inverter|transformerless inverter|mosfet|igbt|capacitor|battery inverter)\b/iu, strongPatterns: [/\b(?:inverter|solar inverter|power inverter|transformerless inverter)\b/iu, /\b(?:fail|failed|failure|fault|broken|blown|short circuit|overheat|damaged)\w*\b/iu], supportingPatterns: [/\b(?:mosfet|igbt|capacitor|fuse|voltage|battery|component|hardware|diagnos|troubleshoot|repair)\w*\b/iu], priority: 18 },
  { key: 'education-learning', label: 'Learning Workflow Friction', pattern: /\b(?:student(?!\s+loans?\b)|learner|lesson|course|curriculum|education|learning|homework|assignment|classroom|teacher|school)\b/iu, strongPatterns: [/\b(?:homework|assignment|lesson|course|curriculum|classroom|education|learning)\b/iu, /\b(?:student(?!\s+loans?\b)|learner|teacher|school)\b/iu], negativePatterns: [/\bstudent loans?\b/iu, /\b(?:cybersecurity|cyber security|security course|security training)\b[^.!?]{0,220}\b(?:hacking tutorials?|unsafe content|malicious instructions?|student exposure|threat awareness)\b/iu], priority: 4 },
  { key: 'agriculture-irrigation', label: 'Agriculture and Irrigation Workflow Failures', pattern: /\b(?:irrigation|crop|farm|farmer|soil|greenhouse|harvest)\b/iu },
  {
    key: 'therapeutic-continuity',
    label: 'Therapeutic Persona and Voice Continuity Failures',
    pattern: /\b(?:voice|voices|persona|personality|tone|warmth|counselor|counsellor|therapist|therapeutic persona|interaction style|memory of conversations?)\b[^.!?]{0,180}\b(?:gone|removed|deleted|changed|different|stranger|not the same|bring back|latest update|after (?:an? )?update|lost|stopped remembering|no longer remembers?)\b|\b(?:gone|removed|deleted|changed|different|stranger|not the same|bring back|latest update|after (?:an? )?update|lost|stopped remembering|no longer remembers?)\b[^.!?]{0,180}\b(?:voice|voices|persona|personality|tone|warmth|counselor|counsellor|therapist|therapeutic persona|interaction style|memory of conversations?)\b/iu,
    strongPatterns: [
      /\b(?:voice|voices|persona|personality|tone|warmth|counselor|counsellor|therapist)\b/iu,
      /\b(?:gone|removed|deleted|changed|different|stranger|not the same|bring back|latest update|after (?:an? )?update|lost|stopped remembering|no longer remembers?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:mental health|therapy|therapeutic|self[- ]care|support tool|ai for mental health)\b/iu,
      /\b(?:comforting|familiar|trusted|meaningful conversations?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:lawsuit|investor|fraud|funding|taking time for mental health|cannot afford time|workplace mental health)\b/iu,
      /\bi wish i had (?:this|the|an?)\s+(?:app|application|service|platform|tool)\b[^.!?]{0,100}\b(?:when|earlier|before|back then)\b/iu,
    ],
    priority: 16,
  },
  {
    key: 'ai-tool-integration-security',
    label: 'AI Tool Integration and Context Access Security',
    pattern: /\b(?:model context protocol|\bmcp\b|prompt injection|tool manifests?|tool permissions?|unauthorized tool access|context sharing|over[- ]privileged integrations?|ai agents?)\b/iu,
    strongPatterns: [
      /\b(?:model context protocol|\bmcp\b)\b/iu,
      /\b(?:prompt injection|unauthorized tool access|tool permissions?|context sharing|over[- ]privileged integrations?|data leakage)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:external tools?|apis?|databases?|agent behavior|ai integrations?|least privilege|access controls?)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:employee role changes?|privilege creep|employee account activity|staff account|workforce access drift)\b/iu,
      /\b(?:crypto|cryptocurrency|binance|wallet|exchange)\b/iu,
    ],
    priority: 27,
  },
  {
    key: 'regional-crypto-access',
    label: 'Regional Crypto Platform Access and Alternative Wallet Gaps',
    pattern: /\b(?:binance|crypto|cryptocurrency|crypto wallet|wallet|trading|trade|pexcoin|crypto exchange|cryptocurrency exchange|digital asset exchange)\b/iu,
    strongPatterns: [
      /\b(?:can(?:not|'?t) use|unavailable|not available|blocked|restricted)\b.{0,80}\b(?:country|region|nigeria|location)\b/iu,
      /\b(?:what other (?:crypto )?(?:app|wallet|exchange)|alternative (?:crypto )?(?:app|wallet|exchange)|other (?:crypto )?exchange)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:nigeria|country|region|wallet|exchange|trade|trading)\b/iu,
    ],
    hardNegativePatterns: [
      /\b(?:model context protocol|\bmcp\b|prompt injection|tool access|tool permissions?|context sharing|employee role changes?|privilege creep|identity lifecycle)\b/iu,
    ],
    priority: 32,
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

function passesAmbiguousFamilyContextGuard(
  value: string,
  familyKey: string,
): boolean {
  if (familyKey === 'cybersecurity-learning-content-safety') {
    const learningContext =
      /\b(?:students?|learners?|course|courses|classroom|teaching|training|learning content|learning platform|security course|cybersecurity training)\b/iu.test(value);
    const unsafeContentContext =
      /\b(?:hacking tutorials?|unsafe content|malicious instructions?|student exposure|content safety|unsafe tutorials?|harmful content)\b/iu.test(value);

    // The word "cybersecurity" by itself is far too broad. This family is
    // eligible only when the evidence actually concerns learners/training AND
    // unsafe or malicious instructional content.
    if (!learningContext || !unsafeContentContext) {
      return false;
    }
  }

  if (familyKey === 'regional-crypto-access') {
    const explicitCryptoIdentity =
      /\b(?:crypto|cryptocurrency|binance|pexcoin|bitcoin|ethereum|blockchain|digital assets?|crypto wallet|cryptocurrency wallet|crypto exchange|cryptocurrency exchange)\b/iu.test(
        value,
      );
    const tradingPlatformContext =
      /\b(?:wallet|trading|trade|token|coin|deposit|withdrawal|buy|sell)\b.{0,80}\b(?:exchange|platform|app)\b|\b(?:exchange|platform|app)\b.{0,80}\b(?:wallet|trading|trade|token|coin|deposit|withdrawal|buy|sell)\b/iu.test(
        value,
      );

    if (!explicitCryptoIdentity && !tradingPlatformContext) {
      return false;
    }
  }

  if (
    familyKey === 'regional-feature-access' &&
    /\b(?:crypto|cryptocurrency|binance|wallet|exchange|trading|trade)\b/iu.test(value)
  ) {
    return false;
  }
  if (familyKey === 'ai-hallucination-output-reliability') {
    const explicitlyPrioritizesCorrectionFailure =
      /\b(?:main gripe|main issue|primary issue|real issue|problem)\b[^.!?]{0,100}\b(?:is not|isn['’]?t|was not|wasn['’]?t|not)\s+(?:the\s+)?hallucinations?\b[^.!?]{0,220}\b(?:inflexib(?:ility|le)|inflexibility of (?:the )?(?:ai )?models?|rigid(?:ity)?|constructive feedback|correct (?:obvious )?mistakes?|incorporate feedback|apply feedback|respond to corrections?)\b/iu.test(
        value,
      );
    if (explicitlyPrioritizesCorrectionFailure) {
      return false;
    }

    const withoutExplicitNegation = value
      .replace(
        /\b(?:not|no|never)\s+(?:actually\s+)?(?:(?:a|an)\s+)?hallucination(?:s)?\b/giu,
        ' ',
      )
      .replace(
        /\b(?:isn(?:['’]|\s)t|is not|wasn(?:['’]|\s)t|was not|aren(?:['’]|\s)t|are not|weren(?:['’]|\s)t|were not)\s+(?:actually\s+)?(?:(?:a|an)\s+)?hallucination(?:s)?\b/giu,
        ' ',
      )
      .replace(
        /\b(?:didn(?:['’]|\s)t|did not|doesn(?:['’]|\s)t|does not)\s+hallucinate\b/giu,
        ' ',
      )
      .replace(/\bnot\s+hallucinating\b/giu, ' ');

    return /\b(?:hallucinat(?:e|es|ed|ing|ion|ions)|fabricat(?:e|es|ed|ing|ion|ions)|made[- ]?up (?:facts?|citations?|sources?|answers?)|invented (?:facts?|citations?|sources?)|false (?:facts?|citations?)|factual(?:ly)? (?:wrong|incorrect)|incorrect facts?|wrong facts?|unsupported claims?|unreliable (?:answers?|outputs?|responses?))\b/iu.test(
      withoutExplicitNegation,
    );
  }

  if (familyKey === 'crash-runtime') {
    const explicitRuntime = /\b(?:runtime error|runtime failure|exception|segfault|terminated unexpectedly|app closes|application closes)\b/iu.test(value);
    const technicalCrash = /\b(?:app|application|software|program|process|service|server|client|browser|firefox|chrome|tab|mobile app|web app|desktop app|operating system)\b[^.!?]{0,90}\b(?:crash(?:es|ed|ing)?|freeze|frozen|unresponsive)\b|\b(?:crash(?:es|ed|ing)?|freeze|frozen|unresponsive)\b[^.!?]{0,90}\b(?:app|application|software|program|process|service|server|client|browser|firefox|chrome|tab|mobile app|web app|desktop app|operating system)\b/iu.test(value);
    if (explicitRuntime || technicalCrash) return true;
    return false;
  }

  if (familyKey === 'performance') {
    const performanceText = value
      .replace(/\b(?:you(?:['’]?re| are)|we(?:['’]?re| are)|i(?:['’]?m| am)|it(?:['’]?s| is)|they(?:['’]?re| are))\s+not\s+stuck\b[^.!?]{0,100}/giu, ' ')
      .replace(/\b(?:not|never)\s+(?:slow|lagging|frozen|unresponsive|stuck)\b/giu, ' ')
      .replace(/\b(?:never|doesn['’]?t|does not|didn['’]?t|did not)\s+(?:freeze|lag|hang)\b/giu, ' ')
      .replace(/\bno\s+(?:performance|responsiveness)\s+(?:problem|problems|issue|issues)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const ambiguousFreeze = /\b(?:freeze|frozen|stuck)\b/iu.test(performanceText);
    if (!ambiguousFreeze) {
      return /\b(?:slow|lag|latency|unresponsive|takes too long|loading forever)\b/iu.test(performanceText);
    }
    if (/\b(?:hiring freeze|wage freeze|price freeze|asset freeze|account freeze|frozen funds?|frozen assets?)\b/iu.test(performanceText)) {
      return false;
    }
    return /\b(?:app|application|software|screen|page|browser|device|system|loading|response|interface|ui|website|mobile|desktop|server|client)\b/iu.test(performanceText);
  }

  if (familyKey === 'education-learning') {
    const explicitLearningWorkflow =
      /\b(?:students?|learners?|teachers?|instructors?|professors?|coursework|assignments?|grading|classrooms?|lessons?|curriculum|homework|learning platform|learning management(?: system)?|education workflow|course materials?|course enrollment|student enrollment|academic advising|teaching workload|teaching staff|student services?)\b/iu.test(
        value,
      );
    const institutionWithLearningWorkflow =
      /\b(?:school|schools|university|universities|college|colleges|campus|higher education|education institute|educational institution)\b[^.!?]{0,140}\b(?:students?|learners?|teachers?|instructors?|professors?|courses?|coursework|assignments?|grading|classrooms?|lessons?|curriculum|homework|enrollment|admissions?|teaching|learning|academic advising|student services?)\b/iu.test(
        value,
      ) ||
      /\b(?:students?|learners?|teachers?|instructors?|professors?|courses?|coursework|assignments?|grading|classrooms?|lessons?|curriculum|homework|enrollment|admissions?|teaching|learning|academic advising|student services?)\b[^.!?]{0,140}\b(?:school|schools|university|universities|college|colleges|campus|higher education|education institute|educational institution)\b/iu.test(
        value,
      );

    return explicitLearningWorkflow || institutionWithLearningWorkflow;
  }

  if (familyKey === 'workforce-capacity') {
    const explicitCapacityFailure =
      /\b(?:workforce reductions?|staff cuts?|employee cuts?|staff shortages?|employee shortages?|worker shortages?|personnel shortages?|understaffed|hiring freeze|layoffs?|turnover|headcount reduction|headcount cuts?)\b/iu.test(
        value,
      );
    if (explicitCapacityFailure) return true;

    const workforceContext =
      /\b(?:workforce|staffing|staff|employees?|workers?|personnel|headcount)\b/iu.test(
        value,
      );
    const capacityFriction =
      /\b(?:shortage|shortages|capacity constraint|capacity constraints|capacity gap|capacity gaps|coverage gap|coverage gaps|critical[- ]role coverage|workload redistribution|overload|service continuity|continuity risk|staffing gap|staffing gaps|vacancy|vacancies|retention risk|retention risks)\b/iu.test(
        value,
      );

    return workforceContext && capacityFriction;
  }

  if (familyKey === 'application-access-support') {
    const customerSupport = /\b(?:no customer service|customer service support|customer support|support team|help desk|live chat|human support)\b/iu.test(value);
    if (customerSupport) return true;
    const accessFailure = /\b(?:cannot access|can['’]?t access|unable to access)\b/iu.test(value);
    if (!accessFailure) return true;
    return /\b(?:account|app|application|portal|platform|dashboard|profile|login|sign[- ]?in|subscription|workspace|website|site|service)\b/iu.test(value);
  }

  if (familyKey === 'blockchain-wallet-state-sync') {
    const identityWalletContext = /\b(?:oid4vp|oid4vci|eudi[- ]?wallet|eudi wallet|verifiable presentations?|verifiable credentials?|wallet credentials?|identity credentials?|digital identity wallet|credential wallet|keycloak verifier|verifier functionality|verifier[- ]side|electronic attestations?)\b/iu.test(value);
    const explicitCryptoContext = /\b(?:blockchain|on[- ]chain|crypto(?:currency)?|bitcoin|ethereum|solana|web3|token balance|wallet balance|transaction confirmations?|blockchain confirmations?|deposit history|ledger entry|on-chain deposit)\b/iu.test(value);
    if (identityWalletContext && !explicitCryptoContext) return false;

    const blockchainOrWalletContext = explicitCryptoContext || /\b(?:account balance|confirmed|confirmation|transaction history|history entry|blink-mobile)\b/iu.test(value);
    const visibilityOrSyncFailure = /\b(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|synchroni[sz]|sync|balance mismatch|confirmation count|zero|0|show(?:s|ed)? nothing|no visible indication|no (?:transaction|history|ledger) entry|consumed by (?:the )?(?:deposit )?fee|swallowed silently)\b/iu.test(value);
    return blockchainOrWalletContext && visibilityOrSyncFailure;
  }

  if (familyKey === 'data-visualization-reactive') {
    const explicitVisualizationTool =
      /\b(?:ggplot2?|shiny|renderplot|plotoutput|geom_[a-z_]+|aes\s*\(|aesthetics must be either length)\b/iu.test(value);
    if (explicitVisualizationTool) return true;

    const visualizationObject =
      /\b(?:plot|plotting|graph|chart|visuali[sz]ation|aesthetic mapping|data shape|series|x[- ]axis|y[- ]axis)\b/iu.test(value);
    const reactiveFailure =
      /\b(?:reactive|reactivity|observe|render|mapping|shape|length mismatch|dimension mismatch|multiple lines|selected columns?)\b/iu.test(value);

    return visualizationObject && reactiveFailure;
  }

  if (familyKey === 'billing-payment') {
    const blockchainExecutionFailure =
      /\b(?:blockchain|smart contract|web3|hardhat|alchemy|goerli|ethereum|evm|solidity)\b/iu.test(value) &&
      /\b(?:transaction reverted|execution reverted|reverted without (?:a )?reason(?: string)?|providererror|provider error|transaction (?:failed|fails)|status (?:is |was )?failed|gas estimation failed|cannot estimate gas)\b/iu.test(value);
    const explicitFinancialFailure =
      /\b(?:payment|checkout|card|billing|bill|invoice|refund|purchase|payment method|bank)\b[^.!?]{0,130}\b(?:fail(?:s|ed|ure|ing)?|error|declin(?:e|ed)|reject(?:ed|ion)?|blocked|unavailable|not available|cannot|can['’]?t|unable|wrong|incorrect|duplicate|missing|pending|stuck|not received|not processed|not accepted|not working|doesn['’]?t work)\b/iu.test(value) ||
      /\b(?:fail(?:s|ed|ure|ing)?|error|declin(?:e|ed)|reject(?:ed|ion)?|blocked|unavailable|not available|cannot|can['’]?t|unable|wrong|incorrect|duplicate|missing|pending|stuck|not received|not processed|not accepted|not working|doesn['’]?t work)\b[^.!?]{0,130}\b(?:payment|checkout|card|billing|bill|invoice|refund|purchase|payment method|bank)\b/iu.test(value);
    const explicitChargeOrRefundProblem =
      /\b(?:charged twice|double charg(?:e|ed|ing)?|duplicate charg(?:e|ed|ing)?|wrong charge|incorrect charge|unauthorized charge|refund (?:missing|delayed|pending|failed|not received)|money (?:deducted|taken).{0,80}(?:but|without|and no).{0,80}(?:order|payment|confirmation|refund))\b/iu.test(value);
    const explicitPaymentRestriction =
      /\b(?:paywall|have to pay|gotta pay|requires? payment|payment required|subscription required|subscription only|cash on delivery.{0,80}(?:unavailable|disabled|removed|not available)|(?:cannot|can['’]?t|unable to)\s+pay\b|(?:cannot|can['’]?t|unable to).{0,80}(?:link|add|use)\s+(?:my\s+)?(?:card|payment method|bank account))\b/iu.test(value);
    const affordabilityProblem =
      /\b(?:too expensive|cannot afford|can['’]?t afford|unaffordable|pricing too high|costs? too much)\b/iu.test(value);
    const financialPaymentContext =
      /\b(?:payment|checkout|card|charged|billing|bill|invoice|refund|paywall|subscription|purchase|payment method|bank)\b/iu.test(value);

    if (blockchainExecutionFailure && !financialPaymentContext) {
      return false;
    }

    if (
      explicitFinancialFailure ||
      explicitChargeOrRefundProblem ||
      explicitPaymentRestriction ||
      affordabilityProblem
    ) {
      return true;
    }

    return false;
  }

  if (familyKey === 'real-estate-session-persistence') {
    const realEstateContext =
      /\b(?:zillow|real estate|property|properties|listing|listings|saved homes?|favorites?|favourites?|rental|rentals|home search)\b/iu.test(
        value,
      );
    const explicitLogoutFailure =
      /\b(?:keep getting logged out|keeps? logging (?:me|us) out|repeated(?:ly)? logged out|unexpected logout|session (?:expires?|drops?))\b/iu.test(
        value,
      );
    return realEstateContext && explicitLogoutFailure;
  }

  if (familyKey === 'delivery-tracking') {
    const logisticsContext = /\b(?:delivery|deliveries|shipment|shipments|shipping|tracking|courier|carrier|driver|package|packages|parcel|parcels|proof of delivery|in transit|warehouse|drop off|pickup|pick up)\b/iu.test(value);
    const friction =
      /\b(?:lost|missing|stuck|stalled|delayed|late|unable to leave|sitting|wrong|incorrect|failed|failure|not updating|inaccurate|dispute)\b/iu.test(value) ||
      /\bnot\b[^.!?]{0,35}\bdelivered\b/iu.test(value) ||
      /\b(?:takes?|took)\s+(?:several\s+)?hours?\b[^.!?]{0,90}\b(?:pick up|pickup|deliver|delivery|drop off)\b/iu.test(value) ||
      /\bhours?\s+to\s+(?:pick up|pickup|deliver|drop off)\b/iu.test(value) ||
      /\b(?:cannot|can\s+t|couldn\s+t|unable to|failed to)\s+find\b[^.!?]{0,70}\b(?:address|location|recipient|destination)\b/iu.test(value) ||
      /\b(?:marked|says?|said)\b[^.!?]{0,55}\bdelivered\b[^.!?]{0,75}\b(?:not|never|missing|no entry|no proof)\b/iu.test(value);
    return logisticsContext && friction;
  }

  if (familyKey === 'traffic-congestion') {
    const tourismVolumeContext =
      /\b(?:overtourism|tourism pressure|tourist pressure|visitor pressure|tourist traffic|visitor traffic|tourism flows?|tourist flows?|visitor flows?|tourism carrying capacity|tourist carrying capacity|visitor carrying capacity|tourist concentration|visitor concentration)\b/iu.test(
        value,
      );
    const explicitRoadTrafficContext =
      /\b(?:traffic congestion|road traffic|traffic jam|traffic jams|gridlock|stuck in traffic|road congestion|vehicle congestion|road bottleneck|route delay|route delays|routing friction|vehicles?|cars?|road|roads|roadway|highway|intersection|intersections|road network|street network)\b/iu.test(
        value,
      );

    if (tourismVolumeContext && !explicitRoadTrafficContext) {
      return false;
    }

    return explicitRoadTrafficContext;
  }

  if (familyKey === 'outage-reliability') {
    if (/\b(?:outage|power cut|service down|downtime|blackout|disconnect(?:ed|ion)?|interruption)\b/iu.test(value)) {
      return true;
    }
    return /\b(?:offline|unavailable)\b/iu.test(value) &&
      /\b(?:service|network|system|platform|website|server|power|electricity|grid|app|application)\b/iu.test(value);
  }

  return true;
}

function familyScore(value: string, family: ProblemFamilyDefinition): number {
  const normalized = normalize(value);
  if (!normalized || !family.pattern.test(normalized)) {
    return 0;
  }

  if (!passesAmbiguousFamilyContextGuard(normalized, family.key)) {
    return 0;
  }

  for (const pattern of family.hardNegativePatterns ?? []) {
    if (pattern.test(normalized)) {
      return 0;
    }
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

export function resolvePrimaryProblemFamily(
  value: string,
): { readonly key: string; readonly label: string } | null {
  const body = evidenceBody(value);
  const primary = rankedFamilies(body)[0];
  if (!primary) return null;
  return { key: primary.key, label: familyLabel(primary.key) };
}

const ATOMIC_PROBLEM_CUES: readonly { readonly key: string; readonly pattern: RegExp }[] = [
  { key: 'ai-feedback-correction-inflexibility', pattern: /\b(?:model inflexib(?:ility|le)|ai inflexib(?:ility|le)|inflexibility of (?:the )?(?:ai )?models?|ai feedback incorporation|ai feedback correction|(?:ai|model|llm) correction (?:loop|workflow)|model rigidity|rigid model|(?:ai|model|llm|assistant)\b[^.!?]{0,140}\b(?:constructive feedback|incorporate feedback|apply feedback|correct (?:obvious )?mistakes?|respond to corrections?|revise after feedback)|(?:constructive feedback|incorporate feedback|apply feedback|correct (?:obvious )?mistakes?|respond to corrections?|revise after feedback)\b[^.!?]{0,140}\b(?:ai|model|llm|assistant))\b/iu },
  { key: 'ai-hallucination-output-reliability', pattern: /\b(?:hallucinat(?:e|es|ed|ing|ion|ions)|made[- ]?up (?:facts?|citations?|sources?)|invented (?:facts?|citations?|sources?)|false citations?|wrong facts?|incorrect facts?|unsupported claims?)\b/iu },
  { key: 'legal-compliance-risk', pattern: /\b(?:legal risks?|legal exposure|legal liability|compliance risks?|regulatory risks?|copyright risks?|copyright infringement|licensing risks?|privacy risks?|consent risks?|intellectual property risks?|usage rights?|image rights?|publicity rights?)\b/iu },
  { key: 'ai-model-containment', pattern: /\b(?:model containment|containment breach|sandbox escape|security boundary|escape onto the open internet|security testing)\b/iu },
  { key: 'energy-monitor-installation', pattern: /\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?)\b[^.!?]{0,160}\b(?:install|setup|configure|wiring|calibration|too much work|manual effort|complex|difficult)\b|\b(?:install|setup|configure|wiring|calibration|too much work|manual effort|complex|difficult)\b[^.!?]{0,160}\b(?:current transformers?|\bcts?\b|energy monitor(?:ing)?|power monitor(?:ing)?)\b/iu },
  { key: 'data-fragmentation', pattern: /\b(?:fragmented|disconnected|siloed)\b[^.!?]{0,120}\b(?:data|information|systems?|sources?|records?)\b|\b(?:missing|foundational|unified) data layer\b/iu },
  { key: 'persisted-record-loss', pattern: /\b(?:records?|files?|history|information|saved data|saved records?|database records?)\b[^.!?]{0,90}\b(?:lost|missing|gone|deleted|disappeared|not saved|wiped)\b|\b(?:lost|missing|gone|deleted|disappeared)\b[^.!?]{0,90}\b(?:records?|files?|history|information|saved data|database)\b/iu },
  { key: 'sparse-measurements', pattern: /\b(?:missing|null) values?\b|\b(?:imput(?:e|ing|ation)|forward[- ]fill|mean|median|sparse features?|sparse data)\b|\btests?\b[^.!?]{0,90}\b(?:infrequently|only when|when ordered)\b/iu },
  { key: 'duplicate-charge', pattern: /\b(?:already paid|paid .*cash|cash .*paid|charged .*again|double charg|duplicate charg|payment reconciliation)\b/iu },
  { key: 'device-protocol-compatibility', pattern: /(?:\bant\b[^.!?]{0,120}\b(?:support|unsupported|cycling|fitness|wearable|gear|device|equipment|protocol|connect|compatib)|\b(?:wireless protocol|protocol compatibility|unsupported protocol|cycling gear|fitness gear)\b)/iu },
  { key: 'route-planning-capability', pattern: /\b(?:routing app|route planner|route planning software)\b[^.!?]{0,160}\b(?:upload|import|stop numbers?|driver references?|unlimited stops?)\b|\b(?:upload|import)\b[^.!?]{0,100}\b(?:stop numbers?|driver references?|stops?)\b/iu },
  { key: 'application-update-loop', pattern: /\b(?:update loop|version mismatch|prompted to update|latest version|already installed|already updated)\b/iu },
  { key: 'authentication', pattern: /\b(?:oauth|oidc|login|log in|authentication|identity provider|session|cookie|token|sign in|account access|access (?:my|the|this) account|locked out of (?:my|the|this) account)\b/iu },
  { key: 'regional-feature-access', pattern: /\b(?:cannot|can['’]?t|can\s+t|unable to|unavailable|not available|blocked|restricted)\b[^.!?]{0,120}\b(?:area|country|region|location)\b|\b(?:area|country|region|location)\b[^.!?]{0,120}\b(?:cannot|can['’]?t|can\s+t|unable to|unavailable|not available|blocked|restricted)\b/iu },
  { key: 'mobile-license-verification', pattern: /\b(?:license test response|licensing server|licensechecker|servermanagedpolicy|strictpolicy|not[_ -]?licensed|lvl licensing|google play licensing)\b/iu },
  { key: 'routing', pattern: /\b(?:404|missing url|incorrect url|broken route|broken link|deep[- ]link|destination page)\b/iu },
  { key: 'streaming-data-integrity', pattern: /\b(?:streaming|stream)\s+pipelines?\b[^.!?]{0,180}\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?|silently|quietly)\b|\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?)\s+data\b/iu },
  { key: 'focus-navigation', pattern: /\b(?:keyboard (?:appears? )?(?:frozen|freeze)|focus (?:remains|stays|trapped|stuck)|focus trap|keystrokes? (?:are )?captured|type[- ]ahead|accessible panel|screen reader|no visible candidate)\b/iu },
  { key: 'runtime-crash', pattern: /\b(?:(?:app|application|software|process|service|server|client|browser|firefox|chrome|tab)\s+crash(?:es|ed|ing)?|crash(?:es|ed|ing)?\s+(?:app|application|software|process|service|server|client|browser|firefox|chrome|tab)|your tab just crashed|freeze|frozen|unresponsive|runtime error|runtime failure|exception|segfault|terminated unexpectedly)\b/iu },
  { key: 'script-execution-policy', pattern: /\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|script execution disabled|unauthorizedaccess)\b/iu },
  { key: 'blockchain-transaction-execution', pattern: /\b(?:blockchain transaction execution(?: and smart contract revert)? failures?|smart contract revert failures?|transaction reverted|execution reverted|reverted without (?:a )?reason(?: string)?|providererror|provider error|transaction (?:failed|fails)|status (?:is |was )?failed|smart contract (?:call|transaction|execution) (?:failed|fails|reverted)|gas estimation failed|cannot estimate gas|evm revert|vm exception while processing transaction)\b/iu },
  { key: 'transaction-balance', pattern: /\b(?:insufficient funds|insufficient balance|not enough funds)\b[^.!?]{0,120}\b(?:transaction|swap|transfer|wallet|fee|gas|balance|sol|token)|\b(?:transaction|swap|transfer|wallet|fee|gas|balance|sol|token)\b[^.!?]{0,120}\b(?:insufficient funds|insufficient balance|not enough funds)\b/iu },
  { key: 'energy-grid-stability-inverter-trip', pattern: /\b(?:grid|power grid|electric grid)\b[^.!?]{0,160}\b(?:unstable|instability|blackout|outage|trip|tripped|disconnect)\b|\b(?:inverters?|solar panels?|distributed generation)\b[^.!?]{0,160}\b(?:trip|tripped|shut off|disconnect)\b/iu },
  { key: 'healthcare-preventive-care-reminders', pattern: /\b(?:preventive|preventative|routine)\b[^.!?]{0,130}\b(?:checkups?|screenings?|appointments?)\b[^.!?]{0,130}\b(?:skipped|missed|forgotten|overdue|reminders?)\b/iu },
  { key: 'medication-adherence-coordination', pattern: /\b(?:missed|forgotten|doubled|double|duplicate|wrong)\b[^.!?]{0,110}\b(?:dose|doses|medication|medicine)\b|\b(?:medication|dose)\b[^.!?]{0,130}\b(?:caregiver|coordination|handoff|reminder|schedule)\b/iu },
  { key: 'notification', pattern: /\b(?:notification|alert|push message|reminder)\b[^.!?]{0,100}\b(?:missing|not received|didn['’]?t receive|failed|late|delayed|wrong)\b/iu },
  { key: 'service-outage', pattern: /\b(?:outage|downtime|service down|offline|blackout|disconnect(?:ed|ion)?)\b/iu },
  { key: 'delivery-tracking', pattern: /\b(?:delivery|shipment|shipping|courier|carrier|driver|tracking|package|parcel|transit)\b[^.!?]{0,140}\b(?:lost|missing|delayed|stuck|stalled|wrong|not delivered|failed|unable to leave|sitting)\b|\b(?:lost|missing|delayed|stuck|stalled|not delivered)\b[^.!?]{0,140}\b(?:delivery|shipment|shipping|package|parcel|transit|carrier)\b/iu },
  { key: 'refund', pattern: /\b(?:refund|reversal|chargeback)\b[^.!?]{0,120}\b(?:missing|delayed|not received|failed|pending)\b/iu },
  { key: 'persona-continuity', pattern: /\b(?:voice|persona|personality|tone|warmth|therapist|counselor)\b[^.!?]{0,120}\b(?:changed|different|gone|removed|deleted|update|not the same)\b/iu },
  { key: 'time-access', pattern: /\b(?:taking time for mental health|time off for mental health|mental health time|mental health break|recovery time)\b/iu },
  { key: 'treatment-access', pattern: /\b(?:treatment|care|medicine|therapy)\b[^.!?]{0,150}\b(?:unavailable|not available|another country|one country|cannot access|can['’]?t access)\b/iu },
  { key: 'candidate-pooling', pattern: /\b(?:candidate|applicant) profiles?\b[^.!?]{0,130}\b(?:save|sort|pool|reuse|portal|recurring hiring)\b/iu },
  { key: 'client-outreach', pattern: /\b(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign)\b[^.!?]{0,130}\b(?:client contacts?|clients?)\b/iu },
  { key: 'lease-filtering', pattern: /\b(?:lease term|lease duration|rental length|short[- ]term rentals?|long[- ]term rentals?)\b/iu },
  { key: 'session-logout', pattern: /\b(?:keep getting logged out|repeated(?:ly)? logged out|unexpected logout|session (?:expires?|drops?))\b/iu },
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
  const hallucinationSafeBody = body
    .replace(
      /\b(?:not|no|never)\s+(?:actually\s+)?(?:(?:a|an)\s+)?hallucination(?:s)?\b/giu,
      ' ',
    )
    .replace(
      /\b(?:isn(?:['’]|\s)t|is not|wasn(?:['’]|\s)t|was not|aren(?:['’]|\s)t|are not|weren(?:['’]|\s)t|were not)\s+(?:actually\s+)?(?:(?:a|an)\s+)?hallucination(?:s)?\b/giu,
      ' ',
    )
    .replace(
      /\b(?:didn(?:['’]|\s)t|did not|doesn(?:['’]|\s)t|does not)\s+hallucinate\b/giu,
      ' ',
    )
    .replace(/\bnot\s+hallucinating\b/giu, ' ');

  return ATOMIC_PROBLEM_CUES.filter((cue) => {
    const cueBody =
      cue.key === 'runtime-crash'
        ? runtimeSafeBody
        : cue.key === 'ai-hallucination-output-reliability'
          ? hallucinationSafeBody
          : body;
    return cue.pattern.test(cueBody);
  }).map((cue) => cue.key);
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
