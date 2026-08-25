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
    negativePatterns: [
      /\b(?:funeral|memorial|burial|cemetery)\b/iu,
      /\b(?:bridal|wedding dress|gown)\b[^.!?]{0,140}\b(?:alteration|alterations|alteration specialist|alteration specialists|seamstress|seamstresses|dressmaker|dressmakers|tailor|tailors|tailoring|fitting notes?|dress measurements?|customer measurements?)\b/iu,
      /\b(?:alteration specialist|alteration specialists|seamstress|seamstresses|dressmaker|dressmakers|tailor|tailors|tailoring)\b[^.!?]{0,140}\b(?:bridal|wedding dress|gown|fitting|measurements?|fabric|approved alterations?)\b/iu,
    ],
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
    name: 'Embroidery & Garment Customization',
    primaryPatterns: [
      /\b(?:embroidery|embroider|embroidered|embroiderer|embroiderers|monogramming|monogram|applique|appliqu[ée]|custom stitching|stitch pattern|stitch patterns)\b/iu,
      /\b(?:thread colou?rs?|thread colou?r|design placement|placement instructions?|stitching error|stitching mistake|embroidery order|embroidery orders|embroidery design|embroidery designs|approved design version)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:thread colou?rs?|garment sizes?|design revisions?|order quantity|order quantities|wasted garments?|approved design|design version|artwork proof|artwork proofs|digitizing|digitized design|hoop|hooping)\b/iu,
    ],
    negativePatterns: [
      /\b(?:laundromat|dry cleaning|dry-cleaning|dry cleaner|wash and fold|stain treatment|stain details?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Laundry & Dry-Cleaning Operations',
    primaryPatterns: [
      /\b(?:laundry shop|laundry shops|laundromat|laundromats|dry cleaning|dry-cleaning|dry cleaner|dry cleaners|laundry service|laundry services|garment cleaning|wash and fold)\b/iu,
      /\b(?:garments?|clothes|clothing)\b[^.!?]{0,150}\b(?:stains?|cleaning instructions?|care instructions?|pickup|pick up|dry cleaning ticket|dry cleaning tickets|laundry tag|laundry tags|laundry ticket|laundry tickets)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:stain details?|special cleaning instructions?|care labels?|paper tags?|pickup deadlines?|additional treatment|lost garments?|incorrect cleaning|delayed orders?|customer disputes?|order status|garment tracking)\b/iu,
    ],
    negativePatterns: [
      /\b(?:employee burnout|employee turnover|workforce retention|recruitment|hiring|candidate screening|talent acquisition)\b/iu,
      /\b(?:tailor|tailoring|alteration shop|alteration shops|clothing alterations?|custom apparel|made[- ]to[- ]measure|bespoke|customer measurements?|body measurements?|fitting dates?|fitting appointments?|requested changes?)\b/iu,
      /\b(?:embroidery|embroider|embroidered|monogramming|monogram|applique|appliqu[ée]|custom stitching|thread colou?rs?|design placement|digitizing)\b/iu,
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
    name: 'Fountain Pen Repair & Service History',
    primaryPatterns: [
      /\b(?:fountain pen repair|fountain pen repairs|fountain pen repair specialist|fountain pen repair specialists|pen repair specialist|pen repair specialists|nib technician|nib technicians|nibmeister|nibmeisters)\b/iu,
      /\b(?:fountain pens?|pens?)\b[^.!?]{0,180}\b(?:nib adjustments?|ink[- ]?flow problems?|replacement parts?|previous repairs?|service history|writing preferences?|restoration requests?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:nib adjustments?|ink[- ]?flow problems?|replacement parts?|previous repairs?|customer writing preferences?|service history|repair history|restoration requests?|repeated diagnostics?|incorrect parts?|forgotten adjustments?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:doll restoration|bookbinding|bookbinders?|furniture refinishing|upholstery)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Custom Violin Bow Commission & Specification Management',
    primaryPatterns: [
      /\b(?:independent )?(?:violin bow makers?|bow makers?|archetiers?)\b/iu,
      /\bviolin bows?\b[^.!?]{0,220}\b(?:playing preferences?|bow measurements?|wood selections?|hair types?|balance requirements?|grip materials?|design adjustments?|approved specifications?|completion deadlines?|commissions?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:playing preferences?|bow measurements?|wood selections?|hair types?|balance requirements?|grip materials?|design adjustments?|approved specifications?|incorrect balance|unsuitable materials?|repeated adjustments?|wasted supplies?|delayed commissions?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:bow hunting|archery|crossbow|violin lesson|music streaming|concert ticket)\b/iu,
      /\b(?:repair history|service history|previous rehair|rehair dates?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Violin Bow Repair & Rehair Service History',
    primaryPatterns: [
      /\b(?:violin bow technicians?|bow technicians?|bow rehair(?:ing)? specialists?|bow repairers?)\b/iu,
      /\bviolin bows?\b[^.!?]{0,180}\b(?:repair|repairs|condition assessment|rehair(?:ing)? dates?|repair notes?|service history|previous rehair)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:bow condition|rehair(?:ing)? dates?|hair type preferences?|grip details?|winding details?|repair notes?|customer preferences?|service history)\b/iu,
    ],
    negativePatterns: [
      /\b(?:violin lesson|music streaming|concert ticket|orchestra schedule)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Clock Repair Practice & Service History Management',
    primaryPatterns: [
      /\b(?:clock repair specialist|clock repair specialists|clock repairer|clock repairers|clockmaker|clockmakers|horologist|horologists|horology|antique clock repair|timepiece repair)\b/iu,
      /\b(?:clocks?|timepieces?)\b[^.!?]{0,180}\b(?:mechanical faults?|replacement parts?|previous repairs?|repair history|service history|restoration instructions?|cost approvals?|completion dates?|diagnostics?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:customer items?|mechanical faults?|replacement parts?|previous repairs?|restoration instructions?|cost approvals?|paper receipts?|handwritten notes?|service history|repair history|repeated diagnostics?|incorrect replacement parts?|forgotten customer requests?|unexpected costs?|delayed repairs?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:doll restoration|doll restorers?|antique doll|toy restoration|fabric selections?|paint matching)\b/iu,
      /\b(?:watch app|clock app|alarm clock|time tracking software)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Independent Shoemakers Operations & Client Management',
    primaryPatterns: [
      /\b(?:shoemaker|shoemakers|shoe maker|shoe makers|shoemaking|shoe making|bespoke shoemaker|bespoke shoemakers|custom shoe maker|custom shoe makers|cordwainer|cordwainers|bespoke footwear|custom footwear|handmade shoes?|made[- ]to[- ]measure shoes?)\b/iu,
      /\b(?:handmade shoes?|custom shoes?|bespoke shoes?|custom footwear|bespoke footwear)\b[^.!?]{0,180}\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|approved specifications?|completion deadlines?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|latest approved specifications?|final approved specifications?|sizing errors?|incorrect material choices?|repeated fittings?|wasted materials?|delayed orders?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:shoe repair shop|shoe repair shops|repair tickets?|paper tickets?|requested repairs?|technician notes?|misplaced shoes?|repair status|resole ticket|heel repair)\b/iu,
      /\b(?:digital wardrobe|outfit planning|closet inventory|shoe shopping|sneaker release)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Shoe Repair Shop Operations & Ticket Management',
    primaryPatterns: [
      /\b(?:shoe repair shop|shoe repair shops|cobbler|cobblers|cobbler shop|cobbler shops|shoe repair service|shoe repair services)\b/iu,
      /\b(?:shoes?|boots?|footwear)\b[^.!?]{0,180}\b(?:repair tickets?|requested repairs?|technician notes?|material choices?|payment status|collection dates?|pickup dates?|misplaced|repair status)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:paper tickets?|repair tickets?|customer items?|repair instructions?|material choices?|technician notes?|payment status|promised collection|pickup date|misplaced shoes?|incorrect repairs?|delayed orders?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:digital wardrobe|outfit planning|closet inventory|virtual shoe app|shoe shopping)\b/iu,
      /\b(?:shoemaker|shoemakers|shoemaking|shoe making|bespoke shoemaker|bespoke footwear|custom footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainer|cordwainers|foot measurements?|stitching preferences?|design revisions?|latest approved specifications?)\b/iu,
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
      /\b(?:shoemaker|shoemakers|shoemaking|shoe making|bespoke footwear|custom footwear|handmade shoes?|cordwainer|foot measurements?|leather selections?|sole types?|stitching preferences?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Tailoring & Custom Apparel',
    primaryPatterns: [
      /\b(?:tailor|tailors|tailoring|tailoring shop|tailoring shops|alteration shop|alteration shops|alteration specialist|alteration specialists|bridal alteration specialist|bridal alteration specialists|seamstress|seamstresses|bridal seamstress|bridal seamstresses|dressmaker|dressmakers|bridal dressmaker|bridal dressmakers|clothing alteration specialist|clothing alteration specialists|clothing alteration shop|clothing alteration shops|independent clothing alterations?|custom clothing|custom apparel|made to measure|made-to-measure|bespoke clothing|bespoke tailoring|clothing alterations?|wedding dress alterations?|bridal alterations?)\b/iu,
      /\b(?:garment|garments|clothing)\b[^.!?]{0,180}\b(?:customer measurements?|body measurements?|requested changes?|alteration requests?|fitting dates?|fitting appointments?|fabric details?|payment status|collection times?|promised collection|paper receipts?)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:fabric selection|fabric details?|customer measurements?|body measurements?|alteration requests?|requested changes?|fitting dates?|fitting appointments?|design notes?|payment status|promised collection|collection times?|paper receipts?|lost garments?|incorrect alterations?|repeated fittings?|delayed orders?)\b/iu,
    ],
    negativePatterns: [
      /\b(?:laundromat|dry cleaning|dry-cleaning|dry cleaner|wash and fold|stain treatment|cleaning instructions?)\b/iu,
      /\b(?:embroidery|embroider|embroidered|monogramming|monogram|applique|appliqu[ée]|custom stitching|thread colou?rs?|digitizing)\b/iu,
      /\b(?:perfume|perfumer|perfumers|fragrance|scent formulation|ingredient concentration|formula revision)\b/iu,
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
      /\b(?:finance|financial management|financial operations|accounting|bookkeeping|payroll|reconciliation|cash flow|bank|banks|banking|payment provider|payment providers|digital payment|digital payments|transaction fraud|payment fraud)\b/iu,
      /\b(?:invoice|invoices|billing|budget|budgets?|expenses?|transactions?)\b[^.!?]{0,100}\b(?:reconciliation|cash flow|accounts payable|accounts receivable|payment|payments|financial reporting|fraud|audit|accounting)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:invoice|invoices|billing|transactions?|expenses?|budgeting|budgets?|false positives?|false decline|fraud detection|suspicious transactions?)\b/iu,
    ],
    minimumScore: 7,
  },
  {
    name: 'Academic Platform Security & Integrity Monitoring',
    primaryPatterns: [
      /\b(?:school|schools|university|universities|learning platform|learning platforms|learning management system|learning management systems|lms|online assessment|online assessments|online exam|online exams)\b[^.!?]{0,220}\b(?:suspicious account|account takeover|security alerts?|login records?|unusual behavior|academic misuse|academic integrity|security monitoring|anomaly detection)\b/iu,
    ],
    supportingPatterns: [
      /\b(?:student records?|assessment behavior|false positives?|login activity|learning activity|security events?|identity provider|exam integrity|administrative review)\b/iu,
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
