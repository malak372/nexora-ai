/**
 * Utility responsible for building complaint-focused search queries.
 *
 * The builder deliberately avoids broad domain-only searches such as
 * "smart city" because those mostly return marketing, tutorials, news, and
 * generic discussion. It combines a concrete workflow noun with a direct
 * failure/request expression so collectors search for real user problems.
 *
 * @author Malak
 */
export class CollectorQueryBuilderUtil {
  private static readonly DEFAULT_PROBLEM_WORDS = [
    'not working',
    'cannot',
    "can't",
    'unable',
    'missing',
    'inaccurate',
    'slow',
    'failed',
    'error',
    'bug',
    'difficult',
    'confusing',
    'need',
    'feature request',
  ] as const;

  private static readonly DOMAIN_PROBLEM_FAMILIES: Readonly<
    Record<string, readonly string[]>
  > = {
    'smart cities': [
      'smart parking availability',
      'parking gate access',
      'traffic signal timing',
      'municipal service request',
      'street lighting outage',
      'waste collection schedule',
      'public transport arrival',
      'citizen issue reporting',
      'city service accessibility',
      'urban mobility route',
    ],
    transportation: [
      'public transport delay',
      'route planning',
      'vehicle profile',
      'trip tracking',
      'fare payment',
      'arrival prediction',
      'accessibility routing',
      'parking availability',
    ],
    logistics: [
      'delivery tracking',
      'route assignment',
      'proof of delivery',
      'inventory handoff',
      'fleet dispatch',
      'warehouse picking',
      'shipment status',
      'driver workflow',
    ],
    'commercial building energy equipment operations': [
      'commercial building electricity spike utility bill',
      'building hvac energy consumption anomaly',
      'elevator lighting office equipment energy waste',
      'smart meter building equipment anomaly',
      'facility energy readings separate systems',
      'building equipment fault energy consumption',
    ],
    'commercial building energy & equipment operations': [
      'commercial building electricity spike utility bill',
      'building hvac energy consumption anomaly',
      'elevator lighting office equipment energy waste',
      'smart meter building equipment anomaly',
      'facility energy readings separate systems',
      'building equipment fault energy consumption',
    ],
    'costume rental wardrobe management': [
      'costume rental double booking wrong size',
      'costume shop missing accessories reservation',
      'formalwear rental measurement fitting problem',
      'costume return date garment damage tracking',
      'theatrical wardrobe inventory missing costume',
      'dress rental alteration pickup delay',
    ],
    'costume rental & wardrobe management': [
      'costume rental double booking wrong size',
      'costume shop missing accessories reservation',
      'formalwear rental measurement fitting problem',
      'costume return date garment damage tracking',
      'theatrical wardrobe inventory missing costume',
      'dress rental alteration pickup delay',
    ],
    'calligraphy commission design management': [
      'calligraphy commission wrong wording revision',
      'calligrapher approved design version tracking',
      'custom stationery client revision mistake',
      'commissioned artwork client instructions scattered messages',
      'paper ink waste wrong approved version',
      'art commission deadline rework client change',
    ],
    'calligraphy commission & design management': [
      'calligraphy commission wrong wording revision',
      'calligrapher approved design version tracking',
      'custom stationery client revision mistake',
      'commissioned artwork client instructions scattered messages',
      'paper ink waste wrong approved version',
      'art commission deadline rework client change',
    ],
    'artificial intelligence': [
      'model accuracy',
      'computer vision segmentation',
      'AI output correction',
      'model evaluation',
      'prompt reliability',
      'AI integration',
    ],
    agriculture: [
      'crop monitoring',
      'soil monitoring',
      'weather forecasting',
      'crop health imagery',
      'crop disease detection',
      'field prioritization',
      'irrigation scheduling',
      'harvest planning',
      'agricultural resource optimization',
      'farm inventory',
    ],
    'book club reading group management': [
      'book club reading schedule',
      'member reading progress tracking',
      'book club meeting coordination',
      'discussion topic history',
      'shared reading notes',
      'book suggestion voting',
      'missed meeting catch up',
      'reading group section completion',
    ],
    'book club & reading group management': [
      'book club reading schedule',
      'member reading progress tracking',
      'book club meeting coordination',
      'discussion topic history',
      'shared reading notes',
      'book suggestion voting',
      'missed meeting catch up',
      'reading group section completion',
    ],
    'recipe culinary knowledge management': [
      'saved recipe organization',
      'recipe ingredient substitutions',
      'personal recipe changes',
      'cooking result history',
      'family recipe preferences',
      'recipe search and retrieval',
      'recipe version history',
      'cooking notes consolidation',
    ],
    'recipe & culinary knowledge management': [
      'saved recipe organization',
      'recipe ingredient substitutions',
      'personal recipe changes',
      'cooking result history',
      'family recipe preferences',
      'recipe search and retrieval',
      'recipe version history',
      'cooking notes consolidation',
    ],
    'travel planning comparison': [
      'travel accommodation price comparison',
      'hotel activity transportation availability',
      'travel review comparison',
      'trip budget planning',
      'booking platform price changes',
      'traveler preference matching',
    ],
    'travel planning & comparison': [
      'travel accommodation price comparison',
      'hotel activity transportation availability',
      'travel review comparison',
      'trip budget planning',
      'booking platform price changes',
      'traveler preference matching',
    ],
    manufacturing: [
      'raw material delivery delay',
      'production schedule bottleneck',
      'supplier delay production disruption',
      'inventory mismatch factory planning',
      'warehouse stock production demand',
      'machine energy consumption',
      'idle equipment electricity waste',
      'production energy efficiency',
      'predictive maintenance energy signal',
    ],
    'locksmith service dispatch inventory management': [
      'locksmith emergency dispatch delay',
      'technician availability scheduling',
      'locksmith replacement parts inventory',
      'missing tools repeated service trip',
      'locksmith job details phone coordination',
      'field technician dispatch workflow',
    ],
    'locksmith service dispatch & inventory management': [
      'locksmith emergency dispatch delay',
      'technician availability scheduling',
      'locksmith replacement parts inventory',
      'missing tools repeated service trip',
      'locksmith job details phone coordination',
      'field technician dispatch workflow',
    ],

    'jewelry repair shop operations intake management': [
      'jewelry repair customer dispute',
      'jewelry repair lost item',
      'jeweler repair estimate approval',
      'jewelry repair item condition',
      'jewelry repair paper ticket',
      'jewelry repair wrong modification',
      'jewelry repair replacement material',
      'jewelry repair pickup status',
    ],
    'jewelry repair shop operations & intake management': [
      'jewelry repair customer dispute',
      'jewelry repair lost item',
      'jeweler repair estimate approval',
      'jewelry repair item condition',
      'jewelry repair paper ticket',
      'jewelry repair wrong modification',
      'jewelry repair replacement material',
      'jewelry repair pickup status',
    ],
    'property asset operating performance': [
      'property management maintenance costs',
      'rental property operating expenses',
      'property manager net operating income',
      'property vacancy maintenance costs',
      'tenant complaints maintenance spend',
      'building operating costs',
      'property performance maintenance',
      'rental income operating costs',
    ],
    'upholstery workshop project management': [
      'upholstery lost fabric sample customer note',
      'upholstery wrong furniture measurement rework',
      'upholstery fabric order mistake',
      'upholstery customer design change tracking',
      'upholstery material shortage delayed furniture',
      'upholstery paper work order lost request',
    ],
    'upholstery workshop & project management': [
      'upholstery lost fabric sample customer note',
      'upholstery wrong furniture measurement rework',
      'upholstery fabric order mistake',
      'upholstery customer design change tracking',
      'upholstery material shortage delayed furniture',
      'upholstery paper work order lost request',
    ],
    'watch repair shop operations client management': [
      'watch repair customer ticket management',
      'watchmaker repair order tracking',
      'customer watch intake record',
      'repair estimate customer approval',
      'watch repair parts order tracking',
      'technician repair notes',
      'watch pickup collection date',
      'paper repair ticket lost watch',
    ],
    'watch repair shop operations & client management': [
      'watch repair customer ticket management',
      'watchmaker repair order tracking',
      'customer watch intake record',
      'repair estimate customer approval',
      'watch repair parts order tracking',
      'technician repair notes',
      'watch pickup collection date',
      'paper repair ticket lost watch',
    ],
    'enterprise human resources policy compliance management': [
      'hr policy version control',
      'employee handbook outdated policy',
      'conflicting leave rules departments',
      'regulatory policy update tracking',
      'employment contract policy comparison',
      'repeated employee policy questions',
      'hr compliance document review',
      'internal procedure synchronization',
    ],
    'enterprise human resources policy & compliance management': [
      'hr policy version control',
      'employee handbook outdated policy',
      'conflicting leave rules departments',
      'regulatory policy update tracking',
      'employment contract policy comparison',
      'repeated employee policy questions',
      'hr compliance document review',
      'internal procedure synchronization',
    ],
    'internet of things': [
      'industrial equipment telemetry',
      'machine energy sensor monitoring',
      'connected equipment anomaly detection',
      'factory device telemetry',
      'sensor data predictive maintenance',
    ],
    'municipal iot device security asset management': [
      'municipal iot unauthorized device discovery',
      'smart city sensor security visibility',
      'traffic light firmware vulnerability',
      'public camera unauthorized connection',
      'city device anomaly detection',
      'municipal connected device inventory',
      'outdated smart city equipment security',
    ],
    'musical instrument repair tracking shop management': [
      'instrument repair intake tracking',
      'repair ticket status',
      'technician repair notes',
      'replacement parts tracking',
      'instrument pickup date',
      'repair shop paper tags',
      'misplaced instrument repair order',
      'customer repair status update',
    ],
    iot: [
      'industrial equipment telemetry',
      'machine energy sensor monitoring',
      'connected equipment anomaly detection',
      'factory device telemetry',
      'sensor data predictive maintenance',
    ],
    'photography studio operations': [
      'client booking management',
      'photo shoot scheduling',
      'shoot location details',
      'shot list management',
      'equipment preparation checklist',
      'editing request tracking',
      'image selection workflow',
      'photo delivery deadline tracking',
      'studio project coordination',
    ],
    'laundry dry cleaning operations': [
      'customer garment tracking',
      'special cleaning instruction tracking',
      'stain treatment records',
      'pickup deadline tracking',
      'lost garment prevention',
      'garment order status',
      'paper tag replacement',
      'customer dispute traceability',
      'dry cleaning quality issue tracking',
    ],
    'laundry & dry-cleaning operations': [
      'customer garment tracking',
      'special cleaning instruction tracking',
      'stain treatment records',
      'pickup deadline tracking',
      'lost garment prevention',
      'garment order status',
      'paper tag replacement',
      'customer dispute traceability',
      'dry cleaning quality issue tracking',
    ],
    'wardrobe personal fashion management': [
      'clothing inventory tracking',
      'closet organization',
      'outfit planning',
      'clothing fit tracking',
      'cleaning and repair tracking',
      'shoes and accessories inventory',
      'shopping receipt wardrobe import',
      'duplicate clothing purchase prevention',
      'seasonal wardrobe planning',
    ],
    'tailoring custom apparel': [
      'customer measurement records',
      'fabric selection tracking',
      'alteration request history',
      'fitting appointment scheduling',
      'custom clothing order tracking',
      'returning customer measurements',
      'garment design notes',
      'made to measure workflow',
    ],
    tailoring: [
      'customer measurement records',
      'fabric selection tracking',
      'alteration request history',
      'fitting appointment scheduling',
      'custom clothing order tracking',
      'returning customer measurements',
    ],
    'e commerce': [
      'checkout payment',
      'shopping cart',
      'order tracking',
      'seller marketplace',
      'product listing',
      'refund workflow',
    ],
    ecommerce: [
      'checkout payment',
      'shopping cart',
      'order tracking',
      'seller marketplace',
      'product listing',
      'refund workflow',
    ],
    'e-commerce': [
      'checkout payment',
      'shopping cart',
      'order tracking',
      'seller marketplace',
      'product listing',
      'refund workflow',
    ],
    energy: [
      'energy consumption',
      'solar monitoring',
      'electricity usage',
      'power outage reporting',
      'battery monitoring',
      'meter reading',
    ],
    environment: [
      'air quality monitoring',
      'air pollution measurement',
      'emissions tracking',
      'environmental sensor data',
      'pollution hotspot detection',
      'waste monitoring',
      'environmental incident reporting',
    ],
    education: [
      'student homework',
      'assignment submission',
      'teacher feedback',
      'coursework tracking',
      'grading workflow',
      'classroom learning',
    ],
    finance: [
      'invoice approval',
      'expense tracking',
      'budget workflow',
      'payroll processing',
      'reconciliation',
      'cash flow tracking',
    ],
    government: [
      'permit approval status',
      'license processing delay',
      'cross department record verification',
      'official record version conflict',
      'citizen document status',
      'public contract approval tracking',
    ],
    legaltech: [
      'contract verification',
      'ownership record conflict',
      'legal document status',
      'permit record verification',
      'cross department approval traceability',
      'official record dispute',
    ],
    blockchain: [
      'record provenance verification',
      'tamper evident audit trail',
      'document version integrity',
      'approval history verification',
      'distributed ledger record audit',
    ],
    healthcare: [
      'patient appointment',
      'clinical workflow',
      'medical record access',
      'medication tracking',
      'patient communication',
      'care coordination',
    ],
    'beauty salon management': [
      'salon appointment scheduling',
      'stylist availability',
      'client preference history',
      'service history sharing',
      'salon product inventory',
      'loyalty history',
      'double booking prevention',
      'special request tracking',
    ],
    'pet care management': [
      'pet vaccination tracking',
      'grooming appointment',
      'feeding routine',
      'pet care history',
      'veterinarian record sharing',
      'pet sitter instructions',
      'shared family pet care',
    ],
    'event planning management': [
      'wedding vendor coordination',
      'event booking conflict',
      'venue scheduling',
      'photographer scheduling',
      'catering preference tracking',
      'guest list coordination',
      'event budget tracking',
      'last minute event changes',
    ],
    'funeral memorial services': [
      'funeral service coordination',
      'memorial ceremony scheduling',
      'burial preference tracking',
      'funeral guest communication',
      'floral arrangement coordination',
      'funeral transportation coordination',
      'memorial document checklist',
      'funeral home family requests',
    ],
    'media entertainment': [
      'band rehearsal scheduling',
      'song version coordination',
      'set list synchronization',
      'recording version management',
      'music collaboration',
      'rehearsal equipment checklist',
      'practice note sharing',
    ],
    'media & entertainment': [
      'band rehearsal scheduling',
      'song version coordination',
      'set list synchronization',
      'recording version management',
      'music collaboration',
      'rehearsal equipment checklist',
      'practice note sharing',
    ],
    'moving home organization': [
      'packed belongings tracking',
      'room assignment coordination',
      'fragile item labeling',
      'moving task checklist',
      'moving service appointment',
      'unpacking item search',
      'household purchase checklist',
      'family moving coordination',
    ],
    'sports & fitness': [
      'training load monitoring',
      'athlete performance tracking',
      'overtraining detection',
      'athlete recovery monitoring',
      'injury risk monitoring',
      'wearable workout data integration',
      'fitness equipment telemetry',
      'coach performance dashboard',
    ],
  };

  static buildProblemQueries(
    domainKeywords: string[],
    problemWords: string[] = [],
  ): string[] {
    const selectedProblemWords = problemWords.length
      ? problemWords
      : [...this.DEFAULT_PROBLEM_WORDS];

    return this.unique(
      domainKeywords.flatMap((keyword) =>
        selectedProblemWords.map((problemWord) => `${keyword} ${problemWord}`),
      ),
    );
  }

  /**
   * Builds a small set of high-intent searches for the selected domain.
   *
   * The result is bounded so FAST_GENERATION remains fast. Generic keyword
   * expansions such as "platform", "dashboard", and "analytics" are ignored
   * because they produce publisher copy instead of community pain.
   */
  static buildDomainPainQueries(input: {
    readonly domainName?: string | null;
    readonly domainKeywords?: readonly string[];
    readonly userKeywords?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const requestedMax = Math.max(1, input.maxQueries ?? 4);
    const userTerms = this.cleanTerms(input.userKeywords ?? []).filter(
      (term) => !this.isGenericProductExpansion(term),
    );
    const domainTerms = this.cleanTerms(input.domainKeywords ?? []).filter(
      (term) => !this.isGenericProductExpansion(term),
    );
    const knownFamilies =
      this.DOMAIN_PROBLEM_FAMILIES[domainName] ??
      this.findClosestKnownFamilies(domainName);
    const userIntent = this.normalize([domainName, ...(input.userKeywords ?? []), ...userTerms].join(' '));
    const paymentFraudIntent =
      /\b(?:fraud|fraudulent|suspicious transaction|transaction risk|false positive|false-positive|legitimate (?:customer|user|transaction)|payment fraud|card fraud|account behavior|security alert triage)\b/iu.test(
        userIntent,
      );
    const sportsPerformanceIntent =
      /\b(?:gym|gyms|sports training|athlete|athletes|coach|coaches|workout data|training load|overtraining|recovery|injury risk|performance tracking|wearable devices?|fitness equipment|training intensity)\b/iu.test(
        userIntent,
      );
    const funeralIntent =
      /\b(?:funeral|funerals|memorial service|memorial services|burial|burial preference|funeral home|bereaved|ceremony schedule|floral arrangement)\b/iu.test(
        userIntent,
      );
    const remotePatientIntent =
      /\b(?:remote patient monitoring|post[- ]discharge|after discharge|home[- ]care|home care|vital signs|patient deterioration|readmission|recovery monitoring)\b/iu.test(
        userIntent,
      );
    const musicCollaborationIntent =
      /\b(?:band|bands|musician|musicians|rehearsal|rehearsals|song versions?|song charts?|recordings?|set lists?|setlists?|practice notes?|music collaboration)\b/iu.test(
        userIntent,
      );
    const agricultureFieldIntent =
      /\b(?:agriculture|agricultural|farm|farming|crop|crops|soil|weather|harvest|irrigation|disease|field|fields)\b/iu.test(
        userIntent,
      );
    const urbanMobilityEnvironmentIntent =
      /\b(?:traffic|congestion|public transport|public transportation|transit|bus|train|road incidents?|urban mobility)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:air pollution|air quality|emissions?|environmental|pollution)\b/iu.test(
        userIntent,
      );
    const householdMovingIntent =
      /\b(?:moving home|moving to a new home|new home|house move|packed belongings|packing|unpacking|room assignments?|fragile items?|moving tasks?)\b/iu.test(
        userIntent,
      );
    const wardrobeIntent =
      /\b(?:wardrobe|closet|clothes|clothing|shoes|footwear|accessories|outfit|outfits)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:inventory|remember|fit|fits|sizing|cleaning|laundry|repair|maintenance|photos?|receipts?|duplicate purchases?|unused items?|occasion|weather|outfit|coordinate|coordination)\b/iu.test(
        userIntent,
      );
    const bookClubIntent =
      /\b(?:book club|book clubs|reading group|reading groups|reading circle|reading circles)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:reading schedules?|meeting dates?|member progress|discussion topics?|book suggestions?|shared notes?|finished each section|missed meetings?|falling behind)\b/iu.test(
        userIntent,
      );
    const recipeKnowledgeIntent =
      /\b(?:recipe|recipes|cooking|home cook|ingredient substitutions?|personal changes?|family preferences?|cooking results?)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:save|saved|social media|websites?|handwritten notes?|messages?|substitutions?|changes?|results?|preferences?|search|recreate|wasted ingredients?)\b/iu.test(
        userIntent,
      );
    const travelComparisonIntent =
      /\b(?:travelers?|travel|trip planning|accommodations?|hotels?|activities|transportation|local experiences?|booking websites?)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:compare|comparison|prices?|availability|reviews?|preferences?|budget|different platforms?|booking platforms?|missed opportunities?|expenses?)\b/iu.test(
        userIntent,
      );
    const manufacturingSupplyChainIntent =
      /\b(?:manufacturing|manufacturer|manufacturers|factory|factories|production line|production lines|production planner|production planners|industrial plant|industrial plants)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:raw materials?|supplier deliveries?|supplier updates?|supply chain|inventory|warehouse|warehouses|shipment|shipments|production schedules?|demand changes?|demand forecast|bottlenecks?|order prioritization|stock)\b/iu.test(
        userIntent,
      );
    const locksmithDispatchIntent =
      /\b(?:locksmith|locksmiths|lock service|lock services|field service|mobile service)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:dispatch|technician|technicians|service requests?|emergency calls?|locations?|tools?|replacement parts?|parts inventory|job assignment|availability|repeated trips?|payment status)\b/iu.test(
        userIntent,
      );
    const industrialEnergyIntent =
      /\b(?:manufacturing plants?|factories|factory|production lines?|machines?|industrial equipment)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:energy costs?|energy consumption|electricity|power consumption|idle consumption|cooling systems?|production demand|waste energy|energy waste|unusual consumption|predictive maintenance|equipment problems?|telemetry|connected equipment)\b/iu.test(
        userIntent,
      );
    const municipalDeviceSecurityIntent =
      /\b(?:smart cit(?:y|ies)|municipal|city technology|traffic lights?|parking sensors?|public cameras?|environmental monitors?|connected city devices?|iot devices?)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:security|unauthorized|outdated|firmware|compromised|device behavior|anomal|vulnerab|unmanaged|rogue device|security standards?)\w*\b/iu.test(
        userIntent,
      );
    const musicalInstrumentRepairIntent =
      /\b(?:musical instruments?|instrument repair|repair shop|luthier|guitar repair|violin repair|piano repair)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:repair|technician|replacement parts?|pickup|paper tags?|repair progress|repair status|notes?|intake)\b/iu.test(
        userIntent,
      );

    const photographyStudioIntent =
      /\b(?:photography studio|photography studios|photo studio|photo studios|professional photographer|professional photographers|commercial photographer|portrait studio|photography|photo shoot|photoshoot)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:client bookings?|shot lists?|editing requests?|equipment preparation|camera gear|image selections?|photo selections?|delivery deadlines?|location details?|shoot schedule|session schedule)\b/iu.test(
        userIntent,
      );
    const crossBorderAgreementIntent =
      /\b(?:cross[- ]border|international payments?|business agreements?|contract terms?|contractual conditions?|settlements?)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:payments?|settlements?|contracts?|agreements?|approvals?|verification documents?|reconciliation|disputes?|transaction records?)\b/iu.test(
        userIntent,
      );
    const laundryOperationsIntent =
      /\b(?:laundry shop|laundry shops|laundromat|laundromats|dry cleaning|dry-cleaning|dry cleaner|dry cleaners|laundry service|garment cleaning|wash and fold)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:garments?|clothes|stains?|cleaning instructions?|pickup|pick up|deadlines?|treatment|paper tags?|lost|missing|delayed|customer disputes?|order status)\b/iu.test(
        userIntent,
      );
    const legalDocumentComplianceIntent =
      /\b(?:legal|regulations?|contracts?|applications?|case[- ]related documents?|legal documents?|rules?|requirements?|compliance)\b/iu.test(
        userIntent,
      ) &&
      /\b(?:search|compare|check|missing|inconsisten|delay|stored across|multiple systems|correct rules)\w*\b/iu.test(
        userIntent,
      );

    const naturalTemplates =
      urbanMobilityEnvironmentIntent &&
      /(?:smart cit|transport|environment)/u.test(domainName)
        ? [
            'traffic congestion public transport air pollution',
            'traffic incidents transit delays air quality',
            'urban mobility emissions peak hours',
            'traffic transit environmental data fragmented',
            'public transport reliability congestion pollution',
            'city traffic decisions emissions impact',
          ]
        : householdMovingIntent &&
            /(?:moving|home organization|household)/u.test(domainName)
          ? [
              'moving home packed belongings room assignment',
              'fragile items labels lost during move',
              'moving tasks service appointments forgotten',
              'family moving checklist not synchronized',
              'unpacking essential items hard to find',
              'duplicate purchases after moving home',
            ]
        : bookClubIntent &&
            /(?:book club|reading group|reading community)/u.test(domainName)
          ? [
              'book club reading schedule member progress problem',
              'reading group meeting date coordination missed meeting',
              'book club discussion topics shared notes repeated conversation',
              'reading group members falling behind progress tracking',
              'book suggestions voting discussion history book club',
              'reading apps group chat notes scattered book club',
            ]
        : recipeKnowledgeIntent &&
            /(?:recipe|culinary|cooking)/u.test(domainName)
          ? [
              'saved recipes scattered across apps hard to find',
              'recipe ingredient substitutions personal changes forgotten',
              'family recipe preferences notes not stored together',
              'cooking results recipe adjustments hard to recreate',
              'recipe collection search organization problem home cook',
              'wasted ingredients forgotten recipe changes complaint',
            ]
        : travelComparisonIntent &&
            /(?:tourism|travel|e commerce|e-commerce|artificial intelligence)/u.test(domainName)
          ? [
              'travel accommodation price comparison across booking platforms',
              'hotel activity transportation availability comparison problem',
              'travel price changes budget planning reviews scattered',
              'multi platform trip planning traveler preferences difficult',
              'travel booking missed deals price availability complaint',
              'trip planning reviews activities transport budget comparison',
            ]
        : manufacturingSupplyChainIntent &&
            /(?:manufactur|logistics|supply chain|industrial)/u.test(domainName)
          ? [
              'manufacturing raw material delay production shutdown',
              'factory inventory mismatch production schedule supplier delay',
              'production bottleneck raw material shortage manufacturing',
              'warehouse stock inaccurate production planning problem',
              'manufacturing demand change excess inventory order priority',
              'supplier delivery delay interrupts production line',
            ]
        : locksmithDispatchIntent &&
            /(?:locksmith|field service|service dispatch|inventory management)/u.test(domainName)
          ? [
              'locksmith delayed dispatch technician availability',
              'locksmith repeated trip missing tools parts',
              'locksmith emergency call dispatch coordination problem',
              'locksmith wrong replacement part service call',
              'locksmith van inventory job scheduling problem',
              'locksmith phone messaging dispatch missed request',
            ]
        : industrialEnergyIntent &&
            /(?:manufactur|energy|internet of things|\biot\b)/u.test(domainName)
          ? [
              'factory machine idle energy consumption waste',
              'manufacturing electricity use low production demand',
              'industrial equipment abnormal power consumption maintenance',
              'machine energy monitoring predictive maintenance anomaly',
              'factory cooling system electricity waste production',
              'connected equipment telemetry energy efficiency manufacturing',
            ]
        : municipalDeviceSecurityIntent &&
            /(?:smart cit|internet of things|iot|cybersecurity|municipal)/u.test(domainName)
          ? [
              'municipal iot unauthorized device security visibility',
              'smart city sensor outdated firmware vulnerability',
              'traffic light public camera unauthorized connection',
              'city connected device unusual behavior detection',
              'municipal device inventory unmanaged iot security',
              'smart city infrastructure compromised device incident',
            ]
        : musicalInstrumentRepairIntent &&
            /(?:musical instrument|repair tracking|shop management|luthier)/u.test(domainName)
          ? [
              'instrument repair shop lost repair ticket',
              'musical instrument repair paper tags tracking problem',
              'guitar repair technician notes parts status',
              'repair shop instrument pickup date delay',
              'instrument repair replacement parts ordered wrong',
              'customer waiting repair status instrument shop',
            ]
        : photographyStudioIntent &&
            /(?:photography|photo studio|studio operations)/u.test(domainName)
          ? [
              'photography studio booking details scattered messages',
              'photo shoot shot list missed client request',
              'photographer forgot equipment before client shoot',
              'editing requests image selections hard to track',
              'photo delivery deadline missed studio workflow',
              'shoot location details calendar notes disconnected',
            ]
        : crossBorderAgreementIntent &&
            /(?:blockchain|finance|legaltech|legal tech)/u.test(domainName)
          ? [
              'cross border payment settlement verification dispute',
              'contract conditions approval payment reconciliation',
              'business agreement records stored across systems',
              'payment contract verification documents mismatch',
              'international settlement delays contract dispute',
              'transaction records approvals agreement reconciliation',
            ]
        : laundryOperationsIntent &&
            /(?:laundry|dry cleaning|dry-cleaning)/u.test(domainName)
          ? [
              'laundry lost garment tracking problem',
              'dry cleaning special instructions missed',
              'laundry stain treatment details not shared',
              'laundry pickup deadline delayed order',
              'paper garment tags lost dry cleaner',
              'dry cleaning order status customer dispute',
            ]
        : wardrobeIntent &&
            /(?:wardrobe|fashion|closet|clothing)/u.test(domainName)
          ? [
              'clothing inventory hard to remember what I own',
              'wardrobe duplicate purchases forgotten clothes',
              'closet cleaning repair status hard to track',
              'outfit planning weather occasion difficult',
              'shoes accessories inventory scattered photos receipts',
              'wardrobe items unused because hard to coordinate outfits',
            ]
        : legalDocumentComplianceIntent &&
            /(?:government|legaltech|legal tech|artificial intelligence)/u.test(domainName)
          ? [
              'legal document compliance missing requirements review',
              'regulation contract application requirements hard to compare',
              'case documents inconsistencies discovered late',
              'legal documents stored across systems compliance',
              'application documents missing requirements delayed approval',
              'legal office document review rules comparison problem',
            ]
        : funeralIntent || domainName.includes('funeral') || domainName.includes('memorial')
        ? [
            'funeral family coordination missed requests',
            'memorial ceremony scheduling conflict',
            'funeral home guest communication problem',
            'burial preference not shared family',
            'funeral floral transportation coordination',
            'memorial service provider duplicated arrangements',
          ]
        : musicCollaborationIntent &&
            /(?:media|entertainment|music)/u.test(domainName)
          ? [
              'band rehearsal song version mismatch',
              'set list update not shared band members',
              'rehearsal recording version confusion',
              'band equipment checklist item missing',
              'practice notes not synchronized musicians',
              'rehearsal schedule change missed band',
            ]
        : agricultureFieldIntent && domainName.includes('agriculture')
          ? [
              'soil weather crop health data fragmented',
              'crop disease detection delayed field',
              'weather forecast irrigation decision problem',
              'field prioritization crop risk difficult',
              'crop health imagery not synchronized',
              'farm resource usage difficult to optimize',
            ]
        : sportsPerformanceIntent &&
            /(?:sports|fitness|internet of things|artificial intelligence)/u.test(domainName)
          ? [
              'athlete training load monitoring overtraining',
              'wearable workout data coach integration problem',
              'athlete recovery data missed injury risk',
              'fitness equipment wearable data synchronization',
              'coach performance monitoring training intensity',
              'sports injury risk early warning wearable data',
            ]
        : remotePatientIntent && domainName.includes('healthcare')
          ? [
              'remote patient monitoring after discharge missed deterioration',
              'home care vital signs not reviewed in time',
              'patient monitoring devices data not synchronized',
              'remote patient alert prioritization problem',
              'post discharge monitoring delayed intervention',
            ]
        : paymentFraudIntent &&
            /(?:finance|cybersecurity|artificial intelligence|e commerce|e-commerce|ecommerce)/u.test(domainName)
          ? [
              'payment fraud detection false positive',
              'suspicious transaction legitimate customer blocked',
              'transaction fraud alert triage',
              'account behavior transaction risk scoring',
              'fraud detection false decline customer',
              'payment security alerts analyzed separately',
            ]
        : domainName.includes('beauty') || domainName.includes('salon')
          ? [
              'salon double booking appointment problem',
              'stylist availability scheduling conflict',
              'salon client preferences lost between employees',
              'salon product inventory wasted service',
              'beauty salon loyalty history missing',
              'salon special requests not shared',
            ]
        : domainName.includes('event planning') || domainName.includes('wedding')
        ? [
            'wedding vendor booking conflict',
            'venue photographer schedule conflict',
            'catering preference change not shared',
            'guest list update missed by vendor',
            'event budget unexpected vendor expense',
            'last minute event change coordination problem',
          ]
        : domainName.includes('pet care')
          ? [
              'pet vaccination appointment missed',
              'grooming appointment forgotten',
              'feeding routine inconsistent between family members',
              'pet care history hard to share with veterinarian',
              'pet sitter missing care instructions',
            ]
          : domainName.includes('healthcare')
            ? [
                'remote patient monitoring after discharge missed deterioration',
                'home care vital signs not reviewed in time',
                'patient monitoring devices data not synchronized',
                'remote patient alert prioritization problem',
                'post discharge monitoring delayed intervention',
              ]
            : domainName.includes('smart cit')
        ? [
            'parking status is wrong',
            'bus arrival data not updating',
            'street light outage not showing',
            'cannot submit municipal complaint',
            'public service request stuck',
            'traffic data is inaccurate',
          ]
        : domainName.includes('transport')
          ? [
              'bus arrival time is wrong',
              'route planner gives wrong route',
              'trip tracking not updating',
              'fare payment failed',
              'public transport app not working',
            ]
          : domainName.includes('logistic')
            ? [
                'delivery status not updating',
                'driver cannot complete delivery',
                'route assignment is wrong',
                'proof of delivery missing',
                'shipment tracking inaccurate',
              ]
            : [];

    const workflowTerms = this.unique([
      ...userTerms,
      ...knownFamilies,
      ...domainTerms,
    ]).slice(0, 4);

    /*
     * Round-robin the first query wave across workflow/domain terms. Earlier
     * flatMap()+slice() generated every variant for the first term before the
     * second selected domain was ever queried.
     */
    const fallbackQueries = this.unique([
      ...workflowTerms.map((workflow) => `${workflow} not working`),
      ...workflowTerms.map((workflow) => `${workflow} data is wrong`),
      ...workflowTerms.map((workflow) => `cannot use ${workflow}`),
    ]);

    return this.unique([...naturalTemplates, ...fallbackQueries]).slice(
      0,
      requestedMax,
    );
  }


  /**
   * Stack Overflow needs implementation-language queries rather than
   * end-user complaint sentences. These phrases target APIs, sensors, feeds,
   * stale data, synchronization, and submission failures.
   */
  static buildStackOverflowTechnicalQueries(input: {
    readonly domainName?: string | null;
    readonly userKeywords?: readonly string[];
    readonly plannedQueries?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);
    const plannedTerms = this.cleanTerms(input.plannedQueries ?? [])
      .map((term) => this.compactPlannedSourceQuery(term, 7))
      .filter(Boolean);

    if (plannedTerms.length > 0) {
      return this.unique(plannedTerms).slice(0, maxQueries);
    }

    const balancedTerms = this.cleanTerms(input.userKeywords ?? [])
      .map((term) => this.expandKnownDomainAnchor(term))
      .filter((term) => !this.isGenericProductExpansion(term))
      .filter((term) => !/(?:user complaint problem|not working difficult confusing|review missing feature)$/iu.test(term))
      .filter((term) => !/^(?:coherent cross-domain workflow|cross-domain workflow)/iu.test(term))
      .slice(0, maxQueries);

    if (balancedTerms.length > 0) {
      return this.unique(
        balancedTerms.map((term, index) =>
          index % 3 === 0
            ? `${term} api workflow fails`
            : index % 3 === 1
              ? `${term} integration error`
              : `${term} data submission not working`,
        ),
      ).slice(0, maxQueries);
    }

    const queries =
      domainName.includes('smart cit')
        ? [
            'parking availability api stale data',
            'gtfs realtime feed not updating',
            'street light sensor status incorrect',
            'municipal service api submission fails',
            'traffic data api returns wrong value',
            'smart parking occupancy synchronization error',
          ]
        : domainName.includes('transport')
          ? [
              'gtfs realtime feed not updating',
              'bus arrival prediction inaccurate api',
              'route planning api wrong route',
              'trip tracking websocket not updating',
              'fare payment api failed transaction',
            ]
          : domainName.includes('logistic')
            ? [
                'shipment tracking status not updating',
                'delivery route assignment incorrect',
                'proof of delivery upload fails',
                'warehouse inventory synchronization error',
                'driver app location not updating',
              ]
            : [
                `${domainName} api not updating`,
                `${domainName} data incorrect`,
                `${domainName} integration fails`,
              ];

    return this.unique(queries).slice(0, maxQueries);
  }

  /**
   * GitHub search performs better with unquoted keyword groups. Each query
   * combines one workflow object with one or two failure words while allowing
   * GitHub to match natural wording variations.
   */
  static buildGitHubFlexibleQueries(input: {
    readonly domainName?: string | null;
    readonly userKeywords?: readonly string[];
    readonly plannedQueries?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);
    const plannedTerms = this.cleanTerms(input.plannedQueries ?? [])
      .map((term) => this.compactPlannedSourceQuery(term, 7))
      .filter(Boolean);

    if (plannedTerms.length > 0) {
      return this.unique(plannedTerms).slice(0, maxQueries);
    }

    const balancedTerms = this.cleanTerms(input.userKeywords ?? [])
      .map((term) => this.expandKnownDomainAnchor(term))
      .filter((term) => !this.isGenericProductExpansion(term))
      .filter((term) => !/(?:user complaint problem|not working difficult confusing|review missing feature)$/iu.test(term))
      .filter((term) => !/^(?:coherent cross-domain workflow|cross-domain workflow)/iu.test(term))
      .slice(0, maxQueries);

    if (balancedTerms.length > 0) {
      return this.unique(
        balancedTerms.map((term, index) =>
          index % 3 === 0
            ? `${term} bug failure`
            : index % 3 === 1
              ? `${term} not working issue`
              : `${term} incorrect missing`,
        ),
      ).slice(0, maxQueries);
    }

    const queries =
      domainName.includes('smart cit')
        ? [
            'parking availability stale incorrect',
            'gtfs realtime arrival update',
            'street light outage status',
            'municipal service request submit',
            'traffic sensor data wrong',
          ]
        : domainName.includes('transport')
          ? [
              'bus arrival realtime stale',
              'route planner incorrect route',
              'trip tracking not updating',
              'fare payment failed',
              'vehicle location stale',
            ]
          : domainName.includes('logistic')
            ? [
                'shipment status stale update',
                'delivery route assignment wrong',
                'proof delivery upload fail',
                'inventory sync incorrect',
                'driver tracking not updating',
              ]
            : [
                `${domainName} stale data`,
                `${domainName} incorrect result`,
                `${domainName} request failed`,
              ];

    return this.unique(queries).slice(0, maxQueries);
  }

  private static compactPlannedSourceQuery(
    value: string,
    maxWords: number,
  ): string {
    const sourceNoise = new Set([
      'forum',
      'forums',
      'discussion',
      'discussions',
      'review',
      'reviews',
      'complaint',
      'complaints',
      'report',
      'reports',
      'regarding',
      'about',
    ]);
    const words = this.normalize(value)
      .split(/\s+/u)
      .filter(Boolean)
      .filter((word) => !sourceNoise.has(word));

    return words.slice(0, Math.max(3, maxWords)).join(' ').trim();
  }

  /**
   * YouTube queries always retain a domain anchor and a review/problem intent.
   * This prevents broad words such as arrival, delivery, or app from returning
   * unrelated entertainment and news videos.
   */
  static buildYouTubeAnchoredQueries(input: {
    readonly domainName?: string | null;
    readonly userKeywords?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const domainName = this.normalize(input.domainName ?? '');
    const maxQueries = Math.max(1, input.maxQueries ?? 3);
    const balancedDomainTerms = this.cleanTerms(input.userKeywords ?? [])
      .filter((term) => !/^(?:coherent cross-domain workflow|cross-domain workflow)/iu.test(term))
      .map((term) => this.expandKnownDomainAnchor(term))
      .filter((term) => !this.isGenericProductExpansion(term))
      .filter((term) => !/(?:user complaint problem|not working difficult confusing|review missing feature)$/iu.test(term))
      .slice(0, maxQueries);

    if (balancedDomainTerms.length > 0) {
      return this.unique(
        balancedDomainTerms.map((term, index) =>
          index % 3 === 0
            ? `${term} app problems review`
            : index % 3 === 1
              ? `${term} user complaint`
              : `${term} software issue review`,
        ),
      ).slice(0, maxQueries);
    }

    const queries =
      domainName.includes('smart cit')
        ? [
            'smart city parking app problems review',
            'public transport arrival app complaint',
            'municipal service app user review',
            'street lighting app issue',
            'smart city citizen app not working',
          ]
        : domainName.includes('transport')
          ? [
              'public transport app problems review',
              'bus arrival app complaint',
              'route planner app not working',
              'fare payment app issue',
            ]
          : domainName.includes('logistic')
            ? [
              'delivery tracking app problems review',
              'driver app complaint logistics',
              'shipment tracking app not working',
              'warehouse app user issue',
            ]
          : [
              `${domainName} app problems review`,
              `${domainName} user complaint`,
              `${domainName} software issue`,
            ];

    return this.unique(queries).slice(0, maxQueries);
  }

  /**
   * Returns compact GitHub-ready clauses that target bug reports and feature
   * requests instead of repositories that merely mention the domain.
   */
  static buildGitHubProblemClauses(input: {
    readonly domainName?: string | null;
    readonly domainKeywords?: readonly string[];
    readonly userKeywords?: readonly string[];
    readonly maxClauses?: number;
  }): string[] {
    const queries = this.buildDomainPainQueries({
      ...input,
      maxQueries: input.maxClauses ?? 3,
    });

    return queries;
  }

  private static findClosestKnownFamilies(
    domainName: string,
  ): readonly string[] {
    for (const [key, values] of Object.entries(
      this.DOMAIN_PROBLEM_FAMILIES,
    )) {
      if (domainName.includes(key) || key.includes(domainName)) {
        return values;
      }
    }

    return [];
  }

  /**
   * Converts a bare selected-domain label into one concrete search anchor.
   * This is the zero-keyword safety net for newly added or incompletely seeded
   * domains and guarantees useful first-run expansion without another DB read.
   */
  private static expandKnownDomainAnchor(value: string): string {
    const normalized = this.normalize(value);
    const anchors: Readonly<Record<string, string>> = {
      agriculture: 'farming soil weather crop health',
      'e commerce': 'checkout marketplace order',
      'e-commerce': 'checkout marketplace order',
      ecommerce: 'checkout marketplace order',
      energy: 'energy monitoring electricity',
      environment: 'air quality pollution emissions environmental sensor',
      education: 'student homework assignment',
      finance: 'invoice expense reconciliation',
      healthcare: 'patient clinical workflow',
      'funeral memorial services': 'funeral memorial burial ceremony family',
      'beauty salon management': 'salon appointment stylist client preference',
      'pet care management': 'pet vaccination grooming veterinarian',
      'event planning management': 'wedding venue vendor schedule',
      'sports & fitness': 'athlete training load recovery wearable',
      'internet of things': 'connected device sensor telemetry protocol',
      transportation: 'public transport route',
      logistics: 'shipment delivery tracking',
      'artificial intelligence': 'AI model reliability',
      'business operations': 'administrative approval workflow',
      'media entertainment': 'band music rehearsal song set list',
      'media & entertainment': 'band music rehearsal song set list',
      'moving home organization': 'moving home packed belongings room assignment',
      'wardrobe personal fashion management': 'wardrobe clothing inventory outfit cleaning repair',
    };

    return anchors[normalized] ?? value;
  }

  private static cleanTerms(values: readonly string[]): string[] {
    return this.unique(
      values
        .map((value) => this.normalize(value))
        .filter((value) => value.length >= 3)
        .filter((value) => value.split(/\s+/u).length <= 7),
    );
  }

  private static isGenericProductExpansion(value: string): boolean {
    return /\b(?:platform|system|application|software|dashboard|analytics|monitoring|automation|management|optimization|prediction|recommendation|integration|smart)\b/iu.test(
      value,
    );
  }

  private static normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static unique(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
  }
}