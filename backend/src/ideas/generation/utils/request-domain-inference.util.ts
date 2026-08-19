export type RequestDomainTopicCandidate = {
  readonly name: string;
  readonly score: number;
  readonly primaryMatches: number;
  readonly supportingMatches: number;
};

type RequestDomainTopicDefinition = {
  readonly name: string;
  readonly primaryPatterns: readonly RegExp[];
  readonly supportingPatterns?: readonly RegExp[];
  readonly negativePatterns?: readonly RegExp[];
  readonly minimumScore?: number;
};

const REQUEST_DOMAIN_TOPIC_DEFINITIONS: readonly RequestDomainTopicDefinition[] = [
  {
    name: 'Funeral & Memorial Services',
    primaryPatterns: [
      /\b(?:funeral|funerals|memorial service|memorial services|burial|burial preference|burial preferences|funeral home|funeral homes|cremation|cemetery|bereaved|bereavement)\b/iu,
      /\b(?:ceremony|ceremonies)\b[^.!?]{0,100}\b(?:burial|memorial|funeral|family|flowers?|floral|guests?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:floral arrangements?|guest communication|family requests?|service providers?|ceremony schedules?|memorial planning|documents?)\b/iu,
    ],
    negativePatterns: [/\b(?:wedding|weddings|bride|groom)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Tattoo Studio Operations & Client Management',
    primaryPatterns: [
      /\b(?:tattoo studio|tattoo studios|tattoo artist|tattoo artists|tattoo shop|tattoo shops|tattoo appointment|tattoo appointments)\b/iu,
      /\b(?:tattoo|tattooing)\b[^.!?]{0,180}\b(?:artist schedules?|design revisions?|client preferences?|appointment deposits?|consent forms?|aftercare instructions?|session history|booking conflicts?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:artist schedules?|design revisions?|client preferences?|appointment deposits?|consent forms?|aftercare instructions?|client sessions?|booking conflicts?|design feedback|requested changes?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:tattoo removal medical treatment|laser tattoo removal)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Beauty & Salon Management',
    primaryPatterns: [
      /\b(?:beauty salon|beauty salons|hair salon|hair salons|barbershop|barbershops|nail salon|nail salons|spa appointments?|stylist|stylists|hairdresser|hairdressers|barber|barbers|esthetician|estheticians)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:appointment scheduling|client preferences?|service history|loyalty history|product usage|double bookings?|special requests?)\b/iu,
    ],
    negativePatterns: [/\b(?:recruitment|hiring|applicant|candidate|talent acquisition)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Event Planning & Management',
    primaryPatterns: [
      /\b(?:wedding|weddings|wedding planning|private event|private events|event planning|event coordination|event planner|event planners)\b/iu,
      /\b(?:venue|venues)\b[^.!?]{0,100}\b(?:photographer|decorator|catering|guest list|vendor|booking|event)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:photographers?|decorators?|catering|guest lists?|vendor coordination|event vendors?|booking conflicts?|last[- ]minute changes?|event schedules?)\b/iu,
    ],
    negativePatterns: [/\b(?:funeral|memorial|burial|cemetery)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Pet Care Management',
    primaryPatterns: [
      /\b(?:pet care|pet owners?|pet sitter|pet sitters|veterinarian|veterinarians|veterinary|animal care|pet health)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:vaccination|vaccinations|grooming|feeding routines?|care instructions?|pet appointments?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Recipe & Culinary Knowledge Management',
    primaryPatterns: [
      /\b(?:recipe|recipes|recipe collection|recipe collections|personal recipe|personal recipes|family recipe|family recipes|home cooking|home cook|home cooks|cooking notes?)\b/iu,
      /\b(?:cook|cooking|recipes?)\b[^.!?]{0,180}\b(?:ingredient substitutions?|personal changes?|cooking results?|family preferences?|handwritten notes?|social media|saved recipes?|recreate meals?|forgotten adjustments?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:ingredient substitutions?|recipe modifications?|personal changes?|cooking results?|family preferences?|recipe history|recipe notes?|saved recipes?|recipe search|repeated searching|wasted ingredients?|recreate meals?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:restaurant reservations?|restaurant booking|commercial kitchen inventory|food delivery courier)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Book Club & Reading Group Management',
    primaryPatterns: [
      /\b(?:book club|book clubs|reading group|reading groups|reading circle|reading circles|book discussion group|book discussion groups)\b/iu,
      /\b(?:reading|book)\b[^.!?]{0,150}\b(?:schedule|schedules|meeting dates?|member progress|discussion topics?|book suggestions?|shared notes?|finished each section|falling behind)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:reading schedules?|meeting dates?|member progress|discussion topics?|book suggestions?|shared notes?|reading apps?|group chats?|finished each section|missed meetings?|repetitive conversations?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:bookkeeping|accounting books?|booking engine|hotel booking|travel booking)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Laundry & Dry-Cleaning Operations',
    primaryPatterns: [
      /\b(?:laundry shop|laundry shops|laundromat|laundromats|dry cleaning|dry-cleaning|dry cleaner|dry cleaners|laundry service|laundry services|garment cleaning|wash and fold)\b/iu,
      /\b(?:garments?|clothes|clothing)\b[^.!?]{0,150}\b(?:stains?|cleaning instructions?|care instructions?|pickup|pick up|deadlines?|treatment|lost|missing|delayed|tag|tags|ticket|tickets)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:stain details?|special cleaning instructions?|care labels?|paper tags?|pickup deadlines?|additional treatment|lost garments?|incorrect cleaning|delayed orders?|customer disputes?|order status|garment tracking)\b/iu,
    ],
    negativePatterns: [
      /\b(?:employee burnout|employee turnover|workforce retention|recruitment|hiring|candidate screening|talent acquisition)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Photography Studio Operations',
    primaryPatterns: [
      /\b(?:photography studio|photography studios|photo studio|photo studios|professional photographer|professional photographers|commercial photographer|commercial photographers|portrait studio|portrait studios)\b/iu,
      /\b(?:photography|photo shoot|photoshoot|photo shoots|photoshoots)\b[^.!?]{0,150}\b(?:bookings?|shot lists?|editing requests?|equipment|gear|image selections?|delivery deadlines?|client projects?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:client bookings?|location details?|shot lists?|editing requests?|equipment preparation|camera gear|image selections?|photo selections?|gallery selections?|delivery deadlines?|client delivery|shoot schedule|session schedule)\b/iu,
    ],
    negativePatterns: [
      /\b(?:wedding planning|event planner|venue coordination|funeral|memorial)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Wardrobe & Personal Fashion Management',
    primaryPatterns: [
      /\b(?:wardrobe|digital wardrobe|closet|clothing inventory|clothes inventory|personal wardrobe|fashion wardrobe|outfit planning|outfit planner|outfit coordination)\b/iu,
      /\b(?:clothes|clothing|shoes|accessories)\b[^.!?]{0,140}\b(?:fit|fits|cleaning|repair|outfit|occasion|weather|duplicate purchases?|unused items?|inventory|receipts?|photos?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:fit well|size|sizing|cleaning|laundry|repair|maintenance|outfit|occasion|weather|shopping receipts?|duplicate purchases?|unused items?|item utilization|seasonal)\b/iu,
    ],
    negativePatterns: [
      /\b(?:tailor shop|custom clothing order|made[- ]to[- ]measure|bespoke order|alteration request|fitting appointment)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Tailoring & Custom Apparel',
    primaryPatterns: [
      /\b(?:tailor|tailoring|tailoring shop|custom clothing|custom apparel|made to measure|made-to-measure|bespoke|garment|clothing alterations?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:fabric selection|customer measurements?|body measurements?|alteration requests?|fitting appointments?|design notes?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Sports & Fitness',
    primaryPatterns: [
      /\b(?:sports training|training center|training centers|gym|gyms|athlete|athletes|coach|coaches|fitness center|fitness centers|workout|workouts|strength training|conditioning)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:performance tracking|training load|overtraining|recovery|injury risk|exercise|fitness equipment|wearable fitness|heart rate|vo2|max|training intensity)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Healthcare',
    primaryPatterns: [
      /\b(?:healthcare|health care|medical|patient|patients|clinic|clinics|hospital|hospitals|doctor|doctors|nurse|nurses|pharmacy|pharmacies|home care|home-care|post discharge|post-discharge|remote patient monitoring|vital signs|dental|dentist|dentists)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:care provider|care providers|recovery monitoring|clinical|medication|diagnosis|treatment|readmission|intervention)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Finance',
    primaryPatterns: [
      /\b(?:finance|financial|accounting|bookkeeping|invoice|invoices|payroll|reconciliation|cash flow|bank|banks|banking|payment provider|payment providers|digital payment|digital payments|transaction fraud|payment fraud)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:transactions?|expenses?|budgeting|budgets?|false positives?|false decline|fraud detection|suspicious transactions?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Cybersecurity',
    primaryPatterns: [
      /\b(?:cybersecurity|cyber security|information security|data breach|security breach|ransomware|malware|phishing|unauthorized access|threat detection|incident response)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:security alerts?|suspicious activity|access control|authentication security|vulnerability|credential theft|fraud prevention)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Internet of Things',
    primaryPatterns: [
      /\b(?:internet of things|\biot\b|connected devices?|smart sensors?|sensor network|sensor networks|telemetry devices?|edge devices?|wearable devices?|connected equipment)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:sensor monitoring|device telemetry|device management|gateway|bluetooth|ant\+|smart meter|fitness equipment)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Artificial Intelligence',
    primaryPatterns: [
      /\b(?:artificial intelligence|machine learning|generative ai|large language model|large language models|\bllm\b|\bllms\b|ai model|ai models|model inference)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:anomaly detection|prediction model|predictive model|risk scoring|automated classification|intelligent monitoring)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'HR & Recruitment',
    primaryPatterns: [
      /\b(?:human resources|recruitment|recruiting|hiring|applicant tracking|candidate screening|talent acquisition|employee onboarding|job applicants?|job candidates?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:workforce|employees?|turnover|retention|interview scheduling|applicants?|candidates?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:beauty salon|salon|stylist|hairdresser|barber|funeral|memorial)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Transportation',
    primaryPatterns: [
      /\b(?:public transport|public transportation|transit|bus network|bus route|train service|rail service|metro|commute|urban mobility|route planning|fleet transportation|ride hailing|ride-hailing)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:fare|vehicle|vehicles|trip tracking|arrival prediction|traffic route|mobility)\b/iu,
    ],
    negativePatterns: [
      /\b(?:funeral|memorial|burial|wedding|event planning)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Logistics',
    primaryPatterns: [
      /\b(?:logistics|shipment|shipments|warehouse|warehouses|fleet dispatch|proof of delivery|delivery tracking|courier operations?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:delivery|deliveries|inventory handoff|driver workflow|route assignment|dispatch)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Moving & Home Organization',
    primaryPatterns: [
      /\b(?:moving to a new home|moving home|move to a new home|house move|home move|moving house|packing for a move|packed belongings|moving checklist|moving tasks?)\b/iu,
      /\b(?:belongings?|boxes?|packed items?)\b[^.!?]{0,120}\b(?:rooms?|fragile|moving|unpacking|labels?|inventory)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:room assignments?|fragile items?|service appointments?|moving services?|items? to purchase|purchase checklist|family coordination|unpacking|box labels?|household inventory)\b/iu,
    ],
    negativePatterns: [
      /\b(?:android studio|software migration|server migration|database migration|moving average|file transfer)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Real Estate',
    primaryPatterns: [
      /\b(?:real estate|property management|property listings?|rental listings?|housing platform|housing platforms|lease management|tenant|tenants|landlord|landlords)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:property records?|asset data|lease terms?|rentals?|housing search)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Tourism',
    primaryPatterns: [
      /\b(?:tourism|tourist|tourists|travel planning|travel booking|destination management|visitor experience|hotel booking|hotels?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:traveler|travellers?|travelers?|trip itinerary|destination|sightseeing)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Media & Entertainment',
    primaryPatterns: [
      /\b(?:media and entertainment|media & entertainment|streaming platform|streaming platforms|content creation|digital publishing|audience engagement|creator platform|creator platforms)\b/iu,
      /\b(?:band|bands|musician|musicians|music group|music groups|music ensemble|music ensembles|orchestra|orchestras|rehearsal|rehearsals|band rehearsal|band rehearsals|music rehearsal|music rehearsals|set list|set lists|setlist|setlists|song chart|song charts)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:streaming|creator|creators|publishing|audience|media workflow|content workflow)\b/iu,
      /\b(?:song|songs|recording|recordings|practice notes?|equipment checklists?|song versions?|music collaboration|rehearsal scheduling|set list coordination)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Dance Studio Operations & Performance Management',
    primaryPatterns: [
      /\b(?:dance studio|dance studios|dance school|dance schools|dance academy|dance academies|dance instructor|dance instructors)\b/iu,
      /\b(?:dance|dancers?)\b[^.!?]{0,180}\b(?:class schedules?|instructor availability|student attendance|choreography progress|costume requirements?|rehearsals?|performance preparation|recitals?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:class schedules?|instructor availability|student attendance|choreography progress|costume requirements?|missed rehearsals?|performance readiness|recitals?|group chats?|attendance sheets?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:dance music streaming|dance video game|dance competition results?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Education',
    primaryPatterns: [
      /\b(?:student|students|homework|assignment|school|teacher|teachers|classroom|coursework|university|learning platform|learning platforms|grading)\b/iu,
    ],
    supportingPatterns: [/\b(?:course|courses|education|educational|learning)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Agriculture',
    primaryPatterns: [
      /\b(?:agriculture|agricultural|farm|farms|farming|farmer|farmers|crop|crops|irrigation|harvest|soil monitoring)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'E-commerce',
    primaryPatterns: [
      /\b(?:e commerce|ecommerce|online store|online stores|online shop|online shops|shopping cart|checkout|marketplace seller|marketplace sellers|merchant|merchants)\b/iu,
    ],
    supportingPatterns: [/\b(?:product listing|order tracking|refund workflow|seller marketplace)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Energy',
    primaryPatterns: [
      /\b(?:energy|electricity|solar|power grid|smart meter|smart meters|energy meter|energy meters|battery storage|utility billing|energy consumption)\b/iu,
    ],
    supportingPatterns: [/\b(?:kilowatt|metering|power monitoring|electricity usage)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Government',
    primaryPatterns: [
      /\b(?:government|government agency|government agencies|government department|government departments|public sector|public administration|citizen portal|citizen portals|permit application|official records?|public records?)\b/iu,
    ],
    supportingPatterns: [/\b(?:passport office|land registry|municipal|agency portal|public service)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'LegalTech',
    primaryPatterns: [
      /\b(?:legaltech|legal tech|legal technology|legal research|legal document|legal documents|case law|law database|law databases|attorney workflow|lawyer workflow)\b/iu,
    ],
    supportingPatterns: [/\b(?:contract verification|case management|legal workflow|legal evidence)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Blockchain',
    primaryPatterns: [
      /\b(?:blockchain|distributed ledger|smart contract|smart contracts|web3|on chain|on-chain|crypto wallet|crypto wallets)\b/iu,
    ],
    supportingPatterns: [/\b(?:immutable ledger|record provenance|wallet transaction)\b/iu],
    minimumScore: 7,
  },
  {
    name: 'Business Operations',
    primaryPatterns: [
      /\b(?:back office|back-office|office administration|business operations|administrative workflow|approval workflow|manual administration|internal operations)\b/iu,
    ],
    supportingPatterns: [/\b(?:administration|administrative|paperwork|workflow bottleneck)\b/iu],
    minimumScore: 7,
  },
];

function normalizeRequestText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+&'-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function countMatches(value: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + Number(pattern.test(value)), 0);
}

function earliestMatchIndex(value: string, patterns: readonly RegExp[]): number | null {
  let earliest: number | null = null;
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.index === undefined) continue;
    earliest = earliest === null ? match.index : Math.min(earliest, match.index);
  }
  return earliest;
}

function topicPositionBonus(index: number | null): number {
  if (index === null) return 0;
  if (index < 50) return 4;
  if (index < 120) return 3;
  if (index < 220) return 2;
  return 1;
}

export function rankRequestDomainTopics(
  requestText: string,
): readonly RequestDomainTopicCandidate[] {
  const normalized = normalizeRequestText(requestText);
  if (!normalized) return [];


  return REQUEST_DOMAIN_TOPIC_DEFINITIONS.map((definition) => {
    const primaryMatches = countMatches(normalized, definition.primaryPatterns);
    const supportingMatches = countMatches(
      normalized,
      definition.supportingPatterns ?? [],
    );
    const primaryMatchIndex = earliestMatchIndex(
      normalized,
      definition.primaryPatterns,
    );
    const negativeMatches = countMatches(
      normalized,
      definition.negativePatterns ?? [],
    );

    const score =
      primaryMatches * 7 +
      supportingMatches * 2 +
      topicPositionBonus(primaryMatchIndex) -
      negativeMatches * 6;

    return {
      name: definition.name,
      score,
      primaryMatches,
      supportingMatches,
      minimumScore: definition.minimumScore ?? 7,
    };
  })
    .filter(
      (candidate) =>
        candidate.primaryMatches > 0 && candidate.score >= candidate.minimumScore,
    )
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.primaryMatches - first.primaryMatches ||
        second.supportingMatches - first.supportingMatches ||
        first.name.localeCompare(second.name),
    )
    .map(({ minimumScore: _minimumScore, ...candidate }) => candidate);
}

export function inferDominantRequestDomainName(
  requestText: string,
): string | null {
  const ranked = rankRequestDomainTopics(requestText);
  const best = ranked[0];
  if (!best) return null;

  const runnerUp = ranked[1];
  if (!runnerUp) return best.name;

  if (
    best.score === runnerUp.score &&
    best.primaryMatches === runnerUp.primaryMatches &&
    best.supportingMatches === runnerUp.supportingMatches
  ) {
    return null;
  }

  return best.name;
}
