export type SelectedDomainEvidenceDescriptor = {
  readonly name: string;
  readonly keywords?: readonly string[];
  readonly effectiveSearchKeywords?: readonly string[];
};

export class SelectedDomainEvidenceAlignmentUtil {
  static matchDomainNames(
    evidenceText: string,
    domains: readonly SelectedDomainEvidenceDescriptor[],
  ): string[] {
    const evidence = this.normalize(evidenceText);
    if (!evidence || domains.length === 0) return [];

    return domains
      .filter((domain) => this.matchesDomain(evidence, domain))
      .map((domain) => domain.name);
  }

  static isAligned(
    evidenceText: string,
    domains: readonly SelectedDomainEvidenceDescriptor[],
  ): boolean {
    return this.matchDomainNames(evidenceText, domains).length > 0;
  }

  static matchStrictDomainNames(
    evidenceText: string,
    domains: readonly SelectedDomainEvidenceDescriptor[],
  ): string[] {
    const evidence = this.normalize(evidenceText);
    if (!evidence || domains.length === 0) return [];

    return domains
      .filter((domain) => this.matchesDomainStrictly(evidence, domain))
      .map((domain) => domain.name);
  }

  static isStrictlyAlignedForRecovery(
    evidenceText: string,
    domains: readonly SelectedDomainEvidenceDescriptor[],
  ): boolean {
    return this.matchStrictDomainNames(evidenceText, domains).length > 0;
  }

  /**
   * Discovery evidence must bind the actual failure/workflow to the domain.
   * Merely mentioning a persona, employer, school, country, or incidental
   * domain noun elsewhere in the document is not enough to turn an unrelated
   * problem into trusted evidence for that domain.
   *
   * This is intentionally generic: it looks for problem-bearing clauses and
   * checks their local semantic neighborhood against the same strict domain
   * matcher used elsewhere. It does not contain test/domain-specific allow or
   * deny lists.
   */
  static isProblemBoundToDomain(
    evidenceText: string,
    domain: SelectedDomainEvidenceDescriptor,
  ): boolean {
    const normalized = this.normalize(evidenceText);
    if (!normalized) return false;

    const clauses = evidenceText
      .split(/(?<=[.!?;])\s+|\s+[—–-]\s+/u)
      .map((value) => this.normalize(value))
      .map((value) => value.trim())
      .filter((value) => value.length >= 8);
    const problemBearing = /\b(?:problem|issue|error|bug|fail(?:ed|ure|ing|s)?|cannot|can['’]?t|unable|missing|lack(?:ed|ing|s)?|insufficient|wrong|delay(?:ed|s)?|slow|blocked|unavailable|outage|downtime|risk|breach|unsafe|friction|difficult|struggle|overload|backlog|shortage|inefficien\w*|loss|rework|conflict|disruption|bottleneck|breakdown)\b/iu;

    for (const clause of clauses) {
      if (!problemBearing.test(clause)) continue;
      if (this.matchesDomainStrictly(clause, domain)) {
        return true;
      }
    }

    /*
     * For a one-clause title/snippet the complete text is necessarily the
     * local problem context. For multi-sentence documents, never use a remote
     * persona/domain mention to validate a different failure later in the text.
     */
    return (
      clauses.length <= 1 &&
      problemBearing.test(normalized) &&
      this.matchesDomainStrictly(normalized, domain)
    );
  }

  private static matchesDomainStrictly(
    normalizedEvidence: string,
    domain: SelectedDomainEvidenceDescriptor,
  ): boolean {
    const normalizedName = this.normalize(domain.name);
    if (
      !this.passesAmbiguousDomainContextGuard(
        normalizedEvidence,
        normalizedName,
        [
          ...(domain.effectiveSearchKeywords ?? []),
          ...(domain.keywords ?? []),
        ],
      )
    ) {
      return false;
    }
    const nameTokens = this.tokens(normalizedName).filter((token) => token !== '&');

    if (nameTokens.length >= 2) {
      const compactName = nameTokens.join(' ');
      if (normalizedEvidence.includes(compactName)) return true;
    } else if (nameTokens.length === 1) {
      const token = nameTokens[0];
      if (this.isRecoveryDistinctiveToken(token) && this.hasToken(normalizedEvidence, token)) {
        return true;
      }
    }

    const configuredPhrases = [
      ...(domain.effectiveSearchKeywords ?? []),
      ...(domain.keywords ?? []),
    ]
      .map((value) => this.normalize(value))
      .filter(Boolean);
    const strictAliases = this.strictDomainAliases(normalizedName);
    const phrases = this.unique([...configuredPhrases, ...strictAliases]);

    for (const phrase of phrases) {
      const tokens = this.tokens(phrase).filter((token) => token !== '&');
      if (tokens.length >= 2 && normalizedEvidence.includes(tokens.join(' '))) {
        return true;
      }
      if (
        tokens.length === 1 &&
        this.isRecoveryDistinctiveToken(tokens[0]) &&
        this.hasToken(normalizedEvidence, tokens[0])
      ) {
        return true;
      }
    }

    const strictAnchorTokens = new Set(
      phrases
        .flatMap((phrase) => this.tokens(phrase))
        .filter((token) => token !== '&')
        .filter((token) => this.isRecoveryDistinctiveToken(token)),
    );
    const matchedStrictAnchors = [...strictAnchorTokens].filter((token) =>
      this.hasToken(normalizedEvidence, token),
    );

    return matchedStrictAnchors.length >= 2;
  }

  private static matchesDomain(
    normalizedEvidence: string,
    domain: SelectedDomainEvidenceDescriptor,
  ): boolean {
    const name = this.normalize(domain.name);
    if (
      !this.passesAmbiguousDomainContextGuard(
        normalizedEvidence,
        name,
        [
          ...(domain.effectiveSearchKeywords ?? []),
          ...(domain.keywords ?? []),
        ],
      )
    ) {
      return false;
    }
    const keywordValues = [
      ...(domain.effectiveSearchKeywords ?? []),
      ...(domain.keywords ?? []),
    ];
    const phrases = this.unique([
      name,
      ...keywordValues.map((value) => this.normalize(value)),
      ...this.domainAliases(name),
    ]).filter((value) => value.length >= 2);

    const strongPhraseHit = phrases.some((phrase) => {
      const tokens = this.tokens(phrase);
      if (tokens.length >= 2) {
        return normalizedEvidence.includes(phrase);
      }
      const token = tokens[0];
      return Boolean(token && this.isDistinctiveToken(token) && this.hasToken(normalizedEvidence, token));
    });
    if (strongPhraseHit) return true;

    const anchorTokens = new Set(
      phrases.flatMap((phrase) => this.tokens(phrase)).filter((token) =>
        this.isMeaningfulDomainToken(token),
      ),
    );
    if (anchorTokens.size === 0) return false;

    const matchedTokens = [...anchorTokens].filter((token) =>
      this.hasToken(normalizedEvidence, token),
    );
    if (matchedTokens.length >= 2) return true;

    const only = matchedTokens[0];
    return Boolean(only && this.isDistinctiveToken(only));
  }

  static passesContextualDomainGuard(
    evidenceText: string,
    domainName: string,
    domainKeywords: readonly string[] = [],
  ): boolean {
    const normalizedEvidence = this.normalize(evidenceText);
    const normalizedDomainName = this.normalize(domainName);
    if (!normalizedEvidence || !normalizedDomainName) return false;

    return this.passesAmbiguousDomainContextGuard(
      normalizedEvidence,
      normalizedDomainName,
      domainKeywords,
    );
  }

  private static passesAmbiguousDomainContextGuard(
    normalizedEvidence: string,
    normalizedDomainName: string,
    domainKeywords: readonly string[] = [],
  ): boolean {
    if (
      !this.passesGenericIncidentalDomainGuard(
        normalizedEvidence,
        normalizedDomainName,
        domainKeywords,
      )
    ) {
      return false;
    }

    if (/\breal estate\b|^property$/u.test(normalizedDomainName)) {
      const explicitRealEstateWorkflow =
        /\b(?:homebuyers?|home buyers?|property owners?|property managers?|tenants?|landlords?|realtors?|real estate agents?|real estate brokers?|real estate developers?|subdivision company|title transfers?|property titles?|ownership titles?|deeds?|mortgages?|home loans?|housing loans?|lease agreements?|leasing|rental applications?|rent payments?|property listings?|listing approvals?|property inspections?|maintenance requests?|closing process|escrow|developer complaints?|property disputes?|housing market|real estate market|home prices?|property prices?)\b/u.test(
          normalizedEvidence,
        );
      const realEstateActorWithProblem =
        /\b(?:homebuyers?|home buyers?|property owners?|property managers?|tenants?|landlords?|realtors?|real estate agents?|real estate brokers?)\b[^.!?]{0,160}\b(?:cannot|can['’]?t|unable|fail|fails|failed|missing|delay|delayed|wrong|blocked|problem|issue|need|needs|struggle|complaint|dispute|waiting|not received|hasn['’]?t received|haven['’]?t received)\b/u.test(
          normalizedEvidence,
        ) ||
        /\b(?:cannot|can['’]?t|unable|fail|fails|failed|missing|delay|delayed|wrong|blocked|problem|issue|need|needs|struggle|complaint|dispute|waiting|not received|hasn['’]?t received|haven['’]?t received)\b[^.!?]{0,160}\b(?:title transfers?|property titles?|deeds?|mortgages?|home loans?|lease agreements?|rent payments?|property listings?|property inspections?|maintenance requests?|developer complaints?)\b/u.test(
          normalizedEvidence,
        );

      return explicitRealEstateWorkflow || realEstateActorWithProblem;
    }
    if (/\bgovernment\b|\bpublic sector\b/u.test(normalizedDomainName)) {
      return /\b(?:government (?:service|services|agency|agencies|department|departments|ministry|ministries|portal|app|application|website|system|systems|platform|record|records|payment|payments|benefit|benefits|tax|taxes|permit|permits|licensing|administration|it|digital)|public sector|public administration|public authority|public authorities|citizen portal|citizen service|citizen services|municipal|municipality|municipalities|ministry|ministries|permit application|public benefits|government forms?)\b/u.test(
        normalizedEvidence,
      );
    }

    if (/\btourism\b/u.test(normalizedDomainName)) {
      const explicitTourismWorkflow =
        /\b(?:travel(?:er|ers|ling|ing)?|trip|trips|tour operator|tour operators|travel agency|travel agencies|travel booking|hotel booking|hotel|hotels|hospitality|itinerary|itineraries|destination management|visitor experience|tourist services?|tourism businesses?|tourism operators?|tourism industry|safari booking|safari|vacation|vacations)\b/u.test(
          normalizedEvidence,
        );
      const tourismActorWithProblem =
        /\b(?:tourists?|travelers?|visitors?|tour operators?|travel agents?|hospitality staff)\b[^.!?]{0,120}\b(?:cannot|can['’]?t|unable|fail|fails|failed|missing|omit|omits|omitted|delay|delayed|confus|difficult|problem|issue|need|needs|struggle|book|booking|plan|planning)\b/u.test(
          normalizedEvidence,
        );
      const incidentalReferenceOnly =
        /\b(?:official tourism website|tourism website|visit [a-z]+)\b/u.test(
          normalizedEvidence,
        ) &&
        !explicitTourismWorkflow &&
        !tourismActorWithProblem;

      if (incidentalReferenceOnly) return false;
      return explicitTourismWorkflow || tourismActorWithProblem;
    }

    if (/\beducation\b|\blearning\b|\bedtech\b/u.test(normalizedDomainName)) {
      const explicitEducationWorkflow =
        /\b(?:students?|learners?|teachers?|instructors?|professors?|coursework|assignments?|grading|classrooms?|lessons?|curriculum|homework|learning platform|learning management(?: system)?|education workflow|course materials?|course enrollment|student enrollment|academic advising|teaching workload|teaching staff|student services?)\b/u.test(
          normalizedEvidence,
        );
      const institutionWithEducationWorkflow =
        /\b(?:school|schools|university|universities|college|colleges|campus|higher education|education institute|educational institution)\b[^.!?]{0,140}\b(?:students?|learners?|teachers?|instructors?|professors?|courses?|coursework|assignments?|grading|classrooms?|lessons?|curriculum|homework|enrollment|admissions?|teaching|learning|academic advising|student services?)\b/u.test(
          normalizedEvidence,
        ) ||
        /\b(?:students?|learners?|teachers?|instructors?|professors?|courses?|coursework|assignments?|grading|classrooms?|lessons?|curriculum|homework|enrollment|admissions?|teaching|learning|academic advising|student services?)\b[^.!?]{0,140}\b(?:school|schools|university|universities|college|colleges|campus|higher education|education institute|educational institution)\b/u.test(
          normalizedEvidence,
        );

      return explicitEducationWorkflow || institutionWithEducationWorkflow;
    }

    if (/\bfood\b|\brestaurant/u.test(normalizedDomainName)) {
      const explicitFoodOperations =
        /\b(?:restaurant operations?|restaurant staff|restaurant managers?|kitchen workflow|kitchen staff|commercial kitchen|table reservations?|table booking|menu management|menu availability|ingredient inventory|food inventory|stock shortages?|food waste|order preparation|order fulfillment|customer orders?|meal orders?|pickup orders?|delivery orders?|delivery dispatch|delivery drivers?|couriers?|restaurant delivery|point of sale|\bpos\b|supplier deliveries?|food procurement|restaurant scheduling|shift scheduling)\b/u.test(
          normalizedEvidence,
        );
      const userFacingFoodFailure =
        /\b(?:customers?|diners?|restaurant users?|food delivery users?|delivery customers?)\b[^.!?]{0,140}\b(?:cannot|can['’]?t|unable|fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn['’]?t work|does not work|duplicate|incorrect)\b/u.test(
          normalizedEvidence,
        ) ||
        /\b(?:cannot|can['’]?t|unable|fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn['’]?t work|does not work|duplicate|incorrect)\b[^.!?]{0,140}\b(?:customer orders?|food orders?|meal orders?|restaurant reservations?|table reservations?|menu items?|food delivery|delivery orders?|pickup orders?)\b/u.test(
          normalizedEvidence,
        );
      const developerImplementationContext =
        /\b(?:angular|react|next js|nextjs|vue|flutter|kotlin|kmm|flow|suspend|firestore|firebase|server side|client side|single page application|\bspa\b|routing|route|routes|url|restful|rest api|api endpoint|http|database|remote db|local db|framework|code|developer|developers?|software architecture|application architecture|data sync|synchronization|background execution)\b/u.test(
          normalizedEvidence,
        );
      const foodAppAsExampleOnly =
        /\b(?:food delivery(?: [a-z0-9]+){0,3} (?:app|application)|food ordering(?: [a-z0-9]+){0,3} (?:app|application)|restaurant(?: [a-z0-9]+){0,3} (?:app|application)|clone of (?:a )?(?:food ordering|food delivery)|zomato clone|restaurant clone)\b/u.test(
          normalizedEvidence,
        );

      const directFoodWorkflowFailure =
        /\b(?:customers?|diners?|food delivery users?|delivery customers?)\b[^.!?]{0,120}\b(?:cannot|can['’]?t|unable|fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn['’]?t work|does not work|duplicate|incorrect)\b[^.!?]{0,120}\b(?:place|track|receive|cancel|change|find|filter|order|orders|food order|meal order|delivery order|restaurant reservation|table reservation|menu item|food delivery)\b/u.test(
          normalizedEvidence,
        ) ||
        /\b(?:customer orders?|food orders?|meal orders?|delivery orders?|restaurant reservations?|table reservations?|menu items?|restaurant delivery)\b[^.!?]{0,120}\b(?:fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn['’]?t work|does not work|duplicate|incorrect)\b/u.test(
          normalizedEvidence,
        );

      if (developerImplementationContext && foodAppAsExampleOnly) {
        return explicitFoodOperations || directFoodWorkflowFailure;
      }

      return explicitFoodOperations || userFacingFoodFailure || !developerImplementationContext;
    }

    if (/\bmedia\b|\bentertainment\b/u.test(normalizedDomainName)) {
      const explicitMediaWorkflow =
        /\b(?:media & entertainment|media and entertainment|video streaming|audio streaming|music streaming|streaming service|streaming platform|film|films|movie|movies|television|tv content|broadcast|broadcasting|podcast|podcasts|music|song|songs|album|albums|recording|recordings|band rehearsal|content creation|content creator|content creators|audience engagement|digital publishing|media workflow|media production|video production|audio production)\b/u.test(
          normalizedEvidence,
        );
      const developerStreamingContext =
        /\b(?:next js|nextjs|node js|nestjs|react|large language model|llm|time to first token|first token|ttft|response chunks?|streaming responses?|http streaming|server side rendering|serialization|api route|api routes|telemetry sdk|latency|request lifecycle|chunk delivery)\b/u.test(
          normalizedEvidence,
        );

      if (developerStreamingContext && !explicitMediaWorkflow) return false;
      return explicitMediaWorkflow;
    }

    return true;
  }

  private static passesGenericIncidentalDomainGuard(
    normalizedEvidence: string,
    normalizedDomainName: string,
    domainKeywords: readonly string[],
  ): boolean {
    const syntheticProgrammingMarkers = [
      /\bsample input\b/u,
      /\bsample output\b/u,
      /\binput format\b/u,
      /\boutput format\b/u,
      /\bconstraints?\b/u,
      /\bthe first line contains\b/u,
      /\bgiven\s+[a-z](?:\s*,\s*[a-z]){1,4}\b/u,
      /\byour task is\b/u,
      /\bcompetitive programming\b/u,
      /\bcoding challenge\b/u,
      /\bprogramming problem\b/u,
      /\bgraph theory\b/u,
      /\btime complexity\b/u,
    ].filter((pattern) => pattern.test(normalizedEvidence)).length;
    const syntheticProgrammingScenario =
      syntheticProgrammingMarkers >= 3 ||
      (syntheticProgrammingMarkers >= 2 &&
        /\b(?:algorithm|logic|solve|solution|problem statement|test cases?|sample cases?|minimum cost|maximum flow|shortest path|dynamic programming|graph theory)\b/u.test(
          normalizedEvidence,
        ));
    const realOperationalSelfReport =
      /\b(?:in production|production environment|live environment|deployed system|deployed service|our company|our business|our organization|our organisation|our facility|our hospital|our clinic|our warehouse|our fleet|our utility|our grid|our customers|our patients|our users|we operate|we deployed|we use this in|real[- ]world deployment|field deployment)\b/u.test(
        normalizedEvidence,
      );

    if (syntheticProgrammingScenario && !realOperationalSelfReport) {
      return false;
    }

    const technologyNativeDomain =
      /^(?:artificial intelligence|ai|cybersecurity|cyber security|information security|software development|software engineering|information technology|it|blockchain|web3|internet of things|iot|cloud computing|developer tools)$/u.test(
        normalizedDomainName,
      );
    if (technologyNativeDomain) return true;

    if (
      /\b(?:screen|page|display|window|pixel|ui|layout|print|printing|margin|visual) real estate\b/u.test(
        normalizedEvidence,
      ) ||
      /\bmaximi[sz](?:e|ing) (?:the )?(?:screen |page |display |layout |print )?real estate\b/u.test(
        normalizedEvidence,
      )
    ) {
      return false;
    }

    const developerImplementationContext =
      /\b(?:tutorial|example|demo|sample project|sample app|clone|source code|code snippet|programming|programming problem|coding challenge|competitive programming|algorithm|graph theory|sample input|sample output|input format|output format|constraints?|test cases?|problem statement|framework|library|package|repository|github|stackoverflow|stack overflow|angular|react|next js|nextjs|vue|flutter|kotlin|kmm|java|javascript|typescript|python|ruby|rails|django|nestjs|express|odoo|tkinter|ipywidgets|firestore|firebase|mongodb|postgresql|mysql|orm|api|rest api|api endpoint|server side|client side|frontend|backend|routing|route|routes|url|http|deployment|deploy|production build|development mode|build error|runtime error|stack trace|exception|attribute error|compiler|xml|html|css|database query|serialization|cookie|cookies)\b/u.test(
        normalizedEvidence,
      );
    if (!developerImplementationContext) return true;

    const normalizedKeywords = domainKeywords
      .map((keyword) => this.normalize(keyword))
      .filter(Boolean);
    const candidateDomainPhrases = this.unique([
      normalizedDomainName,
      ...this.strictDomainAliases(normalizedDomainName),
      ...normalizedKeywords,
    ]).filter((phrase) => {
      if (!phrase) return false;
      return !/\b(?:app|application|software|system|platform|dashboard|website|tool|technology)\b/u.test(
        phrase,
      );
    });

    const hasDomainMention = candidateDomainPhrases.some((phrase) => {
      const phraseTokens = this.tokens(phrase);
      if (phraseTokens.length >= 2) {
        return normalizedEvidence.includes(phrase);
      }
      const token = phraseTokens[0];
      return Boolean(
        token &&
          this.isRecoveryDistinctiveToken(token) &&
          this.hasToken(normalizedEvidence, token),
      );
    });
    if (!hasDomainMention) return true;

    const genericOperationalActorFailure =
      /\b(?:customers?|clients?|patients?|students?|teachers?|employees?|applicants?|candidates?|recruiters?|tenants?|landlords?|homebuyers?|home buyers?|property owners?|residents?|citizens?|drivers?|couriers?|farmers?|managers?|operators?|staff|technicians?|sellers?|buyers?|merchants?|suppliers?|travelers?|travellers?|tourists?|diners?|guests?)\b[^.!?]{0,180}\b(?:cannot|can['’]?t|unable|fail|fails|failed|missing|wrong|delay|delayed|blocked|unavailable|not working|does not work|doesn['’]?t work|need|needs|struggle|complaint|request|waiting|lost|duplicate|incorrect)\b/u.test(
        normalizedEvidence,
      ) ||
      /\b(?:cannot|can['’]?t|unable|fail|fails|failed|missing|wrong|delay|delayed|blocked|unavailable|not working|does not work|doesn['’]?t work|need|needs|struggle|complaint|request|waiting|lost|duplicate|incorrect)\b[^.!?]{0,180}\b(?:customers?|clients?|patients?|students?|teachers?|employees?|applicants?|candidates?|recruiters?|tenants?|landlords?|homebuyers?|home buyers?|property owners?|residents?|citizens?|drivers?|couriers?|farmers?|managers?|operators?|staff|technicians?|sellers?|buyers?|merchants?|suppliers?|travelers?|travellers?|tourists?|diners?|guests?)\b/u.test(
        normalizedEvidence,
      ) ||
      /\b(?:orders?|shipments?|deliveries?|bookings?|reservations?|appointments?|applications?|invoices?|payments?|claims?|permits?|licenses?|records?|inventory|stock|titles?|deeds?|leases?|rent payments?|tickets?|schedules?|credentials?|benefits?|refunds?)\b[^.!?]{0,140}\b(?:cannot|can['’]?t|unable|fail|fails|failed|missing|wrong|delay|delayed|blocked|unavailable|not working|does not work|doesn['’]?t work|lost|duplicate|incorrect|stuck|pending)\b/u.test(
        normalizedEvidence,
      ) ||
      /\b(?:cannot|can['’]?t|unable|fail|fails|failed|missing|wrong|delay|delayed|blocked|unavailable|not working|does not work|doesn['’]?t work|lost|duplicate|incorrect|stuck|pending)\b[^.!?]{0,140}\b(?:orders?|shipments?|deliveries?|bookings?|reservations?|appointments?|applications?|invoices?|payments?|claims?|permits?|licenses?|records?|inventory|stock|titles?|deeds?|leases?|rent payments?|tickets?|schedules?|credentials?|benefits?|refunds?)\b/u.test(
        normalizedEvidence,
      );

    const operationalPhrases = this.unique([
      ...this.strictDomainAliases(normalizedDomainName),
      ...normalizedKeywords,
    ]).filter((phrase) => {
      const phraseTokens = this.tokens(phrase);
      if (phraseTokens.length === 0) return false;
      if (
        /\b(?:app|application|software|system|platform|dashboard|website|tool|technology|data|analytics|service|services|workflow|workflows|management)\b/u.test(
          phrase,
        )
      ) {
        return false;
      }
      if (phrase === normalizedDomainName) return false;
      return phraseTokens.length >= 2;
    });
    const hasOperationalDomainAnchor = operationalPhrases.some((phrase) => {
      const phraseTokens = this.tokens(phrase);
      if (phraseTokens.length >= 2) return normalizedEvidence.includes(phrase);
      return this.hasToken(normalizedEvidence, phraseTokens[0]);
    });

    return genericOperationalActorFailure || hasOperationalDomainAnchor;
  }

  private static domainAliases(normalizedName: string): string[] {
    const aliases: string[] = [];

    if (/\bartificial intelligence\b|^ai$/u.test(normalizedName)) {
      aliases.push('ai', 'machine learning', 'large language model', 'llm', 'generative ai');
    }
    if (/\bcybersecurity\b|\bcyber security\b/u.test(normalizedName)) {
      aliases.push('cybersecurity', 'cyber attack', 'cyberattack', 'security breach', 'data breach', 'security vulnerability', 'security flaw', 'ransomware', 'malware', 'phishing', 'threat detection', 'incident response', 'unauthorized access', 'authentication', 'access control');
    }
    if (/\btransportation\b|\bpublic transport\b|\btransit\b/u.test(normalizedName)) {
      aliases.push('transportation', 'public transport', 'public transportation', 'transit', 'transit agency', 'transit operator', 'bus', 'rail', 'metro', 'ticketing', 'fare payment', 'passenger app', 'vehicle telemetry');
    }
    if (/\bglass art\b|\bglass commission\b|\bstained glass\b|\bglass artist\b/u.test(normalizedName)) {
      aliases.push('glass art', 'glass artist', 'glass artisan', 'stained glass', 'glassblower', 'glass studio', 'custom glass', 'glass commission', 'art commission', 'custom artwork', 'design revision', 'approved version');
    }
    if (/\bmanufactur(?:ing|er|ers)\b|\bfactor(?:y|ies)\b/u.test(normalizedName)) {
      aliases.push('manufacturing', 'manufacturer', 'factory', 'production line', 'industrial plant', 'plant floor', 'production downtime', 'industrial equipment');
    }
    if (/\bcandle\b/u.test(normalizedName)) {
      aliases.push('candle', 'candle maker', 'candle making', 'candlemaker');
    }
    if (/\bleather\b/u.test(normalizedName)) {
      aliases.push('leather', 'leatherworker', 'leather craft', 'leathercraft');
    }
    if (/\bembroidery\b/u.test(normalizedName)) {
      aliases.push('embroidery', 'embroiderer', 'custom embroidery');
    }
    if (/\btourism\b/u.test(normalizedName)) {
      aliases.push('tourism', 'tourist', 'visitor', 'destination', 'attraction');
    }
    if (/\bsmart cit(?:y|ies)\b/u.test(normalizedName)) {
      aliases.push('smart city', 'urban infrastructure', 'city infrastructure', 'municipal infrastructure');
    }
    if (/\bhealthcare\b|\bhealth care\b/u.test(normalizedName)) {
      aliases.push('healthcare', 'hospital', 'clinical', 'patient', 'medical');
    }
    if (/\blogistics\b/u.test(normalizedName)) {
      aliases.push('logistics', 'shipment', 'delivery', 'warehouse', 'freight');
    }
    if (/\bfood\b|\brestaurant/u.test(normalizedName)) {
      aliases.push('restaurant', 'food service', 'kitchen', 'food delivery');
    }
    if (/\bgovernment\b|\bpublic sector\b/u.test(normalizedName)) {
      aliases.push('government', 'municipal', 'public sector', 'public works', 'citizen service');
    }

    if (/\bmental health\b/u.test(normalizedName)) {
      aliases.push('mental health', 'therapy', 'therapist', 'counseling', 'counselling', 'emotional support', 'wellbeing', 'wellness');
    }
    if (/\blegaltech\b|\blegal technology\b/u.test(normalizedName)) {
      aliases.push('legaltech', 'legal technology', 'legal document', 'contract management', 'case management', 'legal research', 'compliance workflow');
    }
    if (/\bfinance\b|\bfintech\b|\bfinancial\b/u.test(normalizedName)) {
      aliases.push('finance', 'financial', 'fintech', 'banking', 'payment', 'transaction', 'cash flow');
    }
    if (/\breal estate\b|\bproperty\b/u.test(normalizedName)) {
      aliases.push('real estate', 'property', 'landlord', 'rental', 'tenant', 'building');
    }
    if (/\benergy\b/u.test(normalizedName)) {
      aliases.push('energy', 'electricity', 'power grid', 'utility bill', 'energy consumption');
    }
    if (/\binternet of things\b|\biot\b/u.test(normalizedName)) {
      aliases.push('iot', 'internet of things', 'sensor', 'telemetry', 'connected device');
    }
    if (/\bagriculture\b|\bfarming\b/u.test(normalizedName)) {
      aliases.push('agriculture', 'agricultural', 'farm', 'farmer', 'harvest', 'produce');
    }
    if (/\be-?commerce\b|\bonline marketplace\b/u.test(normalizedName)) {
      aliases.push('ecommerce', 'e commerce', 'online marketplace', 'seller', 'checkout', 'online store');
    }
    if (/\beducation\b|\blearning\b/u.test(normalizedName)) {
      aliases.push('education', 'student', 'school', 'university', 'learning', 'course');
    }

    return aliases;
  }

  private static strictDomainAliases(normalizedName: string): string[] {
    if (/\breal estate\b|\bproperty\b/u.test(normalizedName)) {
      return [
        'real estate',
        'property management',
        'property manager',
        'rental property',
        'rental properties',
        'tenant',
        'landlord',
        'realtor',
        'realty',
        'leasing',
        'lease agreement',
        'property inspection',
        'real estate listing',
      ];
    }
    if (/\bhr\b|\brecruit/u.test(normalizedName)) {
      return [
        'recruitment',
        'recruiter',
        'hiring',
        'applicant tracking',
        'candidate screening',
        'interview scheduling',
        'employee onboarding',
        'talent acquisition',
        'employee turnover',
        'workforce retention',
      ];
    }
    if (/\btourism\b/u.test(normalizedName)) {
      return [
        'tourism',
        'tourist',
        'tour operator',
        'travel agency',
        'travel booking',
        'destination management',
        'visitor experience',
        'hotel booking',
      ];
    }
    if (/\bartificial intelligence\b|^ai$/u.test(normalizedName)) {
      return ['ai', 'machine learning', 'large language model', 'llm', 'generative ai'];
    }
    if (/\bcybersecurity\b|\bcyber security\b/u.test(normalizedName)) {
      return [
        'cybersecurity',
        'cyberattack',
        'cyber attack',
        'ransomware',
        'malware',
        'phishing',
        'data breach',
        'security breach',
        'unauthorized access',
        'threat detection',
        'incident response',
      ];
    }
    if (/\bhealthcare\b|\bhealth care\b/u.test(normalizedName)) {
      return ['healthcare', 'hospital', 'clinical', 'patient care', 'medical'];
    }
    if (/\blogistics\b/u.test(normalizedName)) {
      return ['logistics', 'shipment', 'freight', 'warehouse', 'last mile delivery'];
    }
    if (/\bfood\b|\brestaurant/u.test(normalizedName)) {
      return ['restaurant', 'food truck', 'food trucks', 'food service', 'commercial kitchen', 'food delivery'];
    }
    if (/\bgovernment\b|\bpublic sector\b/u.test(normalizedName)) {
      return ['government', 'government online service', 'public authority', 'public authorities', 'public sector', 'municipal', 'citizen service', 'public administration'];
    }
    if (/\bmanufactur(?:ing|er|ers)\b|\bfactor(?:y|ies)\b/u.test(normalizedName)) {
      return ['manufacturing', 'manufacturer', 'factory', 'production line', 'industrial plant'];
    }
    if (/\bmental health\b/u.test(normalizedName)) {
      return ['mental health', 'therapy', 'therapist', 'counseling', 'counselling'];
    }
    if (/\blegaltech\b|\blegal technology\b/u.test(normalizedName)) {
      return ['legaltech', 'legal technology', 'legal document', 'legal research'];
    }
    if (/\bfinance\b|\bfintech\b|\bfinancial\b/u.test(normalizedName)) {
      return ['finance', 'financial', 'fintech', 'banking', 'cash flow'];
    }
    if (/\benergy\b/u.test(normalizedName)) {
      return ['energy', 'electricity', 'power grid', 'energy consumption'];
    }
    if (/\binternet of things\b|\biot\b/u.test(normalizedName)) {
      return ['iot', 'internet of things', 'connected device', 'sensor telemetry'];
    }
    if (/\bagriculture\b|\bfarming\b/u.test(normalizedName)) {
      return ['agriculture', 'agricultural', 'farm', 'farmer', 'harvest'];
    }
    if (/\be-?commerce\b|\bonline marketplace\b/u.test(normalizedName)) {
      return ['ecommerce', 'e commerce', 'online marketplace', 'marketplace buyer', 'marketplace seller', 'shopping app', 'online shopping', 'online store', 'product listing', 'checkout'];
    }
    if (/\beducation\b|\blearning\b/u.test(normalizedName)) {
      return ['education', 'student', 'school', 'university', 'course enrollment'];
    }
    if (/\btransportation\b|\bpublic transport\b|\btransit\b/u.test(normalizedName)) {
      return ['transportation', 'public transport', 'public transportation', 'transit', 'fare payment'];
    }

    return [];
  }

  private static isRecoveryDistinctiveToken(token: string): boolean {
    return new Set([
      'ai', 'llm', 'cybersecurity', 'cyberattack', 'ransomware', 'malware', 'phishing',
      'tenant', 'landlord', 'realtor', 'realty', 'leasing', 'recruitment', 'recruiter',
      'hiring', 'tourism', 'tourist', 'healthcare', 'hospital', 'clinical', 'medical',
      'logistics', 'shipment', 'freight', 'restaurant', 'government', 'municipal',
      'manufacturing', 'manufacturer', 'factory', 'industrial', 'finance', 'financial',
      'fintech', 'banking', 'legaltech', 'energy', 'electricity', 'iot', 'agriculture',
      'agricultural', 'farmer', 'ecommerce', 'education', 'university', 'transportation',
      'transit', 'ransomware', 'blockchain', 'therapy', 'therapist',
    ]).has(token);
  }

  private static isMeaningfulDomainToken(token: string): boolean {
    if (token.length < 3 && token !== 'ai') return false;
    return !new Set([
      'and', 'the', 'for', 'with', 'from', 'into', 'studio', 'custom', 'production',
      'order', 'orders', 'management', 'operations', 'operational', 'system',
      'systems', 'platform', 'workflow', 'workflows', 'service', 'services',
      'business', 'businesses', 'solution', 'solutions', 'technology', 'digital',
      'data', 'application', 'applications', 'software', 'user', 'users',
    ]).has(token);
  }

  private static isDistinctiveToken(token: string): boolean {
    return new Set([
      'ai', 'cybersecurity', 'cyberattack', 'ransomware', 'manufacturing',
      'manufacturer', 'factory', 'industrial', 'candle', 'candlemaker', 'leather',
      'leatherworker', 'embroidery', 'embroiderer', 'tourism', 'tourist',
      'healthcare', 'hospital', 'clinical', 'logistics', 'restaurant', 'government',
      'municipal', 'agriculture', 'agricultural', 'blockchain', 'fintech', 'legaltech', 'finance', 'financial', 'energy', 'iot', 'ecommerce', 'education', 'therapy',
      'transportation', 'transit', 'ticketing', 'glass', 'glassblower',
    ]).has(token);
  }

  private static hasToken(text: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'u').test(text);
  }

  private static tokens(value: string): string[] {
    return value.split(/\s+/u).map((token) => token.trim()).filter(Boolean);
  }

  private static unique(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s&/'’-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
