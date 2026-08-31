
export type DynamicRequestQueryInput = {
  readonly requestDescription?: string | null;
  readonly intentConcepts?: readonly string[];
  readonly evidenceTargets?: readonly string[];
  readonly plannedQueries?: readonly string[];
  readonly maxQueries?: number;
};

export type IntentDiscoveryQueryInput = DynamicRequestQueryInput & {
  readonly domainNames?: readonly string[];
  readonly preferenceTerms?: readonly string[];
  readonly explicitProblem?: string | null;
  readonly desiredOutcome?: string | null;
  readonly actor?: string | null;
  readonly object?: string | null;
  readonly workflow?: string | null;
};

export class RequestDynamicQueryUtil {
  static build(input: DynamicRequestQueryInput): string[] {
    const rawDescription = (input.requestDescription ?? '')
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    const description = this.cleanText(rawDescription);
    if (!description) return [];

    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
    const evidenceFacetQueries = this.buildEvidenceFacetQueries({
      ...input,
      maxQueries,
    });
    if (evidenceFacetQueries.length >= maxQueries) {
      return evidenceFacetQueries.slice(0, maxQueries);
    }

    const actor = this.extractActor(description);
    const actorAliases = this.buildActorAliases(actor || description);
    const concepts = this.unique([
      ...(input.intentConcepts ?? []).map((value) => this.compactPhrase(value, 6)),
      ...this.extractWorkflowPhrases(rawDescription),
    ]).filter(Boolean).slice(0, 8);
    const failures = this.unique([
      ...this.extractFailurePhrases(rawDescription),
      ...(input.evidenceTargets ?? []).flatMap((value) =>
        this.extractFailurePhrases(value),
      ),
    ]).filter(Boolean).slice(0, 8);
    const identityPhrases = this.buildIdentityPhrases(
      this.extractEvidenceIdentityTerms(rawDescription).slice(0, 10),
    );

    const actorTerm =
      actorAliases[0] || actor || this.extractFallbackSubject(description);
    const compactActor = actorAliases[1] || actorTerm;
    const queries: string[] = [...evidenceFacetQueries];
    const add = (...parts: string[]) => {
      const query = this.compose(...parts);
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    const breadth = Math.max(concepts.length, failures.length, identityPhrases.length, 1);
    for (let index = 0; index < breadth && queries.length < maxQueries * 2; index += 1) {
      add(
        actorAliases[index % Math.max(1, actorAliases.length)] || compactActor,
        identityPhrases[index % Math.max(1, identityPhrases.length)] ?? '',
        concepts[index % Math.max(1, concepts.length)] ?? '',
        failures[index % Math.max(1, failures.length)] ?? '',
      );
    }

    if (queries.length < Math.min(4, maxQueries)) {
      const tokens = this.semanticTokens(description).slice(0, 10);
      for (let index = 0; index < tokens.length && queries.length < maxQueries; index += 3) {
        add(compactActor, tokens.slice(index, index + 4).join(' '));
      }
    }

    return this.deduplicate(queries)
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, maxQueries);
  }

  /**
   * Builds domain-aware discovery/validation queries after PREPARING has
   * resolved the actual request scope. Free text is treated as intent first:
   * an explicit problem is searched as a validation target, while discovery
   * intent searches for real pains inside the actor/object/workflow/domain
   * scope. Saved preference terms are used only as search context and never as
   * evidence or as a manufactured problem statement.
   */
  static buildIntentDiscoveryQueries(input: IntentDiscoveryQueryInput): string[] {
    const description = this.cleanText(input.requestDescription ?? '');
    const explicitProblem = this.cleanText(input.explicitProblem ?? '');
    const desiredOutcome = this.cleanText(input.desiredOutcome ?? '');
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 10, 16));
    const domainNames = this.unique(
      (input.domainNames ?? [])
        .map((value) => this.cleanText(value))
        .filter(Boolean),
    ).slice(0, 4);
    const preferenceTerms = this.unique(
      (input.preferenceTerms ?? [])
        .map((value) => this.compactPhrase(value, 5))
        .filter(Boolean),
    ).slice(0, 6);
    const structuredActor = this.compactPhrase(input.actor ?? '', 5);
    const structuredObject = this.compactPhrase(input.object ?? '', 5);
    const structuredWorkflow = this.compactPhrase(input.workflow ?? '', 6);
    const inferredActor = description ? this.extractActor(description) : '';
    const actor = structuredActor || this.stripRequesterLeadIn(inferredActor);
    const actorAliases = actor ? this.buildActorAliases(actor) : [];
    const actorTerm = actorAliases[0] || actorAliases[1] || actor;
    const workflows = this.unique([
      structuredWorkflow,
      structuredObject,
      ...(input.intentConcepts ?? []).map((value) => this.compactPhrase(value, 5)),
      ...(description ? this.extractWorkflowPhrases(description) : []),
    ]).filter(Boolean).slice(0, 8);
    const pains = this.unique([
      ...(explicitProblem ? this.extractFailurePhrases(explicitProblem) : []),
      ...(input.evidenceTargets ?? []).flatMap((value) =>
        this.extractFailurePhrases(value),
      ),
      ...(explicitProblem && description
        ? this.extractFailurePhrases(description)
        : []),
    ]).filter(Boolean).slice(0, 8);
    const identityTerms = description
      ? this.extractEvidenceIdentityTerms(description).slice(0, 8)
      : [];
    const identity = identityTerms.slice(0, 3).join(' ');
    const outcome = desiredOutcome
      ? this.compactPhrase(desiredOutcome, 5)
      : '';
    const queries: string[] = [];
    const add = (...parts: string[]) => {
      const query = this.compose(...parts)
        .replace(/\b(?:software|platform|application|app|dashboard|tool)\b/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/\s+/u)
        .slice(0, 9)
        .join(' ');
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    const domains = domainNames.length > 0 ? domainNames : [''];
    if (explicitProblem) {
      for (let index = 0; index < domains.length && queries.length < maxQueries; index += 1) {
        const domain = domains[index] ?? '';
        add(domain, actorTerm || identity, workflows[index % Math.max(1, workflows.length)] ?? '', pains[index % Math.max(1, pains.length)] ?? explicitProblem);
        add(domain, identity || actorTerm, pains[(index + 1) % Math.max(1, pains.length)] ?? explicitProblem);
      }
    } else {
      const discoverySignals = [
        'workflow failures delays rework',
        'user complaints unmet needs',
        'operational barriers cost pressure',
        'recurring problems service friction',
      ];
      for (let index = 0; index < domains.length && queries.length < maxQueries; index += 1) {
        const domain = domains[index] ?? '';
        const workflow = workflows[index % Math.max(1, workflows.length)] ?? '';
        const preference = preferenceTerms[index % Math.max(1, preferenceTerms.length)] ?? '';
        add(domain, actorTerm || identity || preference, workflow, discoverySignals[index % discoverySignals.length]);
        if (outcome) add(domain, actorTerm || identity, outcome, 'barriers unmet needs');
        if (preference) add(domain, preference, 'workflow problems complaints');
      }
    }

    for (let index = 0; index < workflows.length && queries.length < maxQueries; index += 1) {
      add(
        domainNames[index % Math.max(1, domainNames.length)] ?? '',
        actorTerm || identity,
        workflows[index],
        explicitProblem
          ? pains[index % Math.max(1, pains.length)] ?? ''
          : 'failures delays unmet needs',
      );
    }

    for (let index = 0; index < preferenceTerms.length && queries.length < maxQueries; index += 1) {
      add(
        domainNames[index % Math.max(1, domainNames.length)] ?? '',
        preferenceTerms[index],
        explicitProblem ? 'reported problems' : 'user pain workflow challenges',
      );
    }

    return this.deduplicate(queries)
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, maxQueries);
  }

  /**
   * Builds request-derived evidence queries without knowing or hard-coding a
   * domain. The request itself is decomposed into actor/object identity,
   * workflow facets, and pain/outcome facets so separate real observations can
   * later be combined into one composite evidence set.
   */
  static buildEvidenceFacetQueries(input: DynamicRequestQueryInput): string[] {
    const rawDescription = (input.requestDescription ?? '')
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    const problemDescription = this.extractProblemBearingText(rawDescription);
    const description = this.cleanText(problemDescription);
    if (!description) return [];

    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 10, 14));
    const actor = this.extractActor(description);
    const actors = this.buildActorAliases(actor || description);
    const workflows = this.unique([
      ...(input.intentConcepts ?? []).map((value) => this.compactPhrase(value, 5)),
      ...this.extractWorkflowPhrases(problemDescription).map((value) =>
        this.compactPhrase(value, 5),
      ),
    ]).filter(Boolean).slice(0, 10);
    const explicitEvidenceTargets = this.unique(
      (input.evidenceTargets ?? [])
        .map((value) => this.compactPhrase(value, 6))
        .filter(Boolean),
    ).slice(0, 10);
    const pains = this.unique([
      ...explicitEvidenceTargets,
      ...this.extractFailurePhrases(problemDescription).map((value) =>
        this.compactPhrase(value, 5),
      ),
      ...(input.evidenceTargets ?? []).flatMap((value) =>
        this.extractFailurePhrases(value).map((failure) =>
          this.compactPhrase(failure, 5),
        ),
      ),
    ]).filter(Boolean).slice(0, 12);
    const identityPhrases = this.buildIdentityPhrases(
      this.extractEvidenceIdentityTerms(problemDescription).slice(0, 14),
    )
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 10);
    const actorTerms = actors.length > 0
      ? actors.map((value) => this.compactPhrase(value, 4)).filter(Boolean)
      : [actor || this.extractFallbackSubject(description)].filter(Boolean);
    const queries: string[] = [];

    const add = (...parts: string[]) => {
      const query = this.compose(...parts)
        .replace(/\b(?:software|platform|application|app|dashboard|tool)\b/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!query) return;

      /*
       * Search engines handle short concrete phrases such as "booking
       * conflicts", "configuration drift", or "missed medication" better than
       * synthetic suffixes like "reported problem". Keep genuine two-concept
       * atomic probes intact; source-specific adapters can add incident/study
       * language when that source actually benefits from it.
       */
      if (query.split(/\s+/u).length >= 2) queries.push(query);
    };

    /*
     * Atomic probes come first. A documentary row is allowed to establish one
     * concrete requester facet, so retrieval should not require the whole
     * actor+object+workflow+failure sentence to appear in one source. These
     * pairwise probes are especially important for Text Only and Text + Domains
     * where scheduling, workload, task failures, data gaps, and decision
     * barriers are often documented by different communities or publications.
     */
    const painBreadth = Math.max(pains.length, 1);
    for (let index = 0; index < painBreadth && queries.length < maxQueries * 3; index += 1) {
      const pain = pains[index % Math.max(1, pains.length)] ?? '';
      const identity = identityPhrases[index % Math.max(1, identityPhrases.length)] ?? '';
      const actorTerm = actorTerms[index % Math.max(1, actorTerms.length)] ?? '';
      const workflow = workflows[index % Math.max(1, workflows.length)] ?? '';

      if (pain) {
        add(pain);
        add(actorTerm || identity, pain);
        add(identity || actorTerm, pain);
        add(workflow || identity || actorTerm, pain);
      }
    }

    for (let index = 0; index < workflows.length && queries.length < maxQueries * 3; index += 1) {
      const workflow = workflows[index];
      const identity = identityPhrases[index % Math.max(1, identityPhrases.length)] ?? '';
      const actorTerm = actorTerms[index % Math.max(1, actorTerms.length)] ?? '';
      add(identity || actorTerm, workflow);
      add(actorTerm || identity, workflow);
    }

    for (let index = 0; index < identityPhrases.length && queries.length < maxQueries * 3; index += 1) {
      const facet =
        pains[index % Math.max(1, pains.length)] ??
        workflows[index % Math.max(1, workflows.length)] ??
        '';
      if (facet) add(identityPhrases[index], facet);
    }

    /*
     * Keep a few composed probes at the tail for sources that index richer
     * phrases well, but never let those full-chain queries crowd out the atomic
     * evidence lanes above.
     */
    const breadth = Math.max(workflows.length, pains.length, identityPhrases.length, 1);
    for (let index = 0; index < breadth && queries.length < maxQueries * 3; index += 1) {
      add(
        actorTerms[index % Math.max(1, actorTerms.length)] ?? '',
        identityPhrases[index % Math.max(1, identityPhrases.length)] ?? '',
        workflows[index % Math.max(1, workflows.length)] ?? '',
        pains[index % Math.max(1, pains.length)] ?? '',
      );
    }

    return this.deduplicate(queries)
      .map((query) => query.split(/\s+/u).slice(0, 7).join(' '))
      .filter((query) => query.split(/\s+/u).length >= 2)
      .slice(0, maxQueries);
  }

  /**
   * Builds short profession-native discovery terms for evidence sources. These
   * intentionally describe how practitioners/researchers name the work, record,
   * condition, cost, failure, or decision problem rather than naming a proposed
   * software solution. This lane is especially important for sparse professional
   * domains where papers and forums rarely contain words such as "software",
   * "platform", or "tracker" even though the requester ultimately wants software.
   */
  static buildProfessionalTerminologyQueries(
    input: DynamicRequestQueryInput,
  ): string[] {
    const problemDescription = this.extractProblemBearingText(
      input.requestDescription ?? '',
    );
    const description = this.cleanText(problemDescription);
    if (!description) return [];

    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 5, 8));
    const actor = this.extractActor(description);
    const aliases = this.buildActorAliases(actor || description);
    const actorTerm =
      aliases[0] || aliases[1] || actor || this.extractFallbackSubject(description);
    const identityTerms = this.extractEvidenceIdentityTerms(description);
    const identityPhrases = this.buildIdentityPhrases(identityTerms.slice(0, 10));
    const workflows = this.extractWorkflowPhrases(description)
      .map((value) => this.compactPhrase(value, 5))
      .filter(Boolean)
      .slice(0, 6);
    const pains = this.extractFailurePhrases(description)
      .map((value) => this.compactPhrase(value, 5))
      .filter(Boolean)
      .slice(0, 6);
    const queries: string[] = [];
    const add = (...parts: string[]) => {
      const query = this.compose(...parts)
        .replace(/\b(?:software|platform|application|app|tracker|dashboard|tool)\b/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    const breadth = Math.max(workflows.length, pains.length, identityPhrases.length, 1);
    for (let index = 0; index < breadth && queries.length < maxQueries * 2; index += 1) {
      const identity = identityPhrases[index % Math.max(1, identityPhrases.length)] ?? '';
      const workflow = workflows[index % Math.max(1, workflows.length)] ?? '';
      const pain = pains[index % Math.max(1, pains.length)] ?? '';
      add(actorTerm, identity, workflow, pain);
      add(identity || actorTerm, pain, 'reported operational problem');
      add(actorTerm, workflow, 'workflow failure delay');
    }

    if (queries.length === 0) {
      add(actorTerm, identityTerms.slice(0, 4).join(' '), 'operational problems');
    }

    return this.deduplicate(queries)
      .map((query) => query.split(/\s+/u).slice(0, 9).join(' '))
      .slice(0, maxQueries);
  }

  /**
   * Builds a second retrieval wave from the AI-planned queries without knowing
   * the domain. Exact first-pass queries can be too narrow for sparse or niche
   * communities, so this method removes meta-search wording, keeps stable
   * profession/object/workflow terms, and creates shorter lexical variants.
   *
   * These queries are retrieval-only. They never count as evidence and they do
   * not weaken downstream evidence verification.
   */
  static buildRelaxedRetrievalQueries(
    input: DynamicRequestQueryInput,
  ): string[] {
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 6, 10));
    const planned = this.unique(
      (input.plannedQueries ?? [])
        .map((value) => this.cleanText(value))
        .filter(Boolean),
    );
    const description = this.cleanText(input.requestDescription ?? '');
    if (planned.length === 0 && !description) return [];

    const retrievalStopWords = new Set([
      ...this.stopWords,
      'about',
      'complaint',
      'complaints',
      'discussion',
      'discussions',
      'example',
      'examples',
      'operator',
      'operators',
      'report',
      'reports',
      'reported',
      'problem',
      'problems',
      'issue',
      'issues',
      'difficult',
      'difficulty',
      'protect',
      'protecting',
      'allow',
      'allowing',
      'maintain',
      'maintaining',
      'lead',
      'leads',
      'leading',
    ]);

    const queryTokens = planned.map((query) =>
      this.semanticTokens(
        query
          .replace(
            /^(?:complaints? about|discussions? (?:about|on)|operator reports? (?:about|of)|reports? of|examples? of)\s+/iu,
            '',
          )
          .replace(/\b(?:problem|problems|workflow issue|user problem)\b/giu, ' '),
      ).filter((token) => !retrievalStopWords.has(token)),
    );

    const frequency = new Map<string, number>();
    for (const tokens of queryTokens) {
      for (const token of new Set(tokens)) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
      }
    }

    const stableTerms = [...frequency.entries()]
      .filter(([token, count]) => token.length >= 4 && count >= 2)
      .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
      .map(([token]) => token)
      .slice(0, 8);

    const actor = this.extractActor(description);
    const actorAliases = this.buildActorAliases(actor || description);
    const actorTerm = actorAliases[0] || actorAliases[1] || actor;
    const workflowTerms = this.extractWorkflowPhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 6);
    const painTerms = this.extractFailurePhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 4);

    const actorTokenSet = new Set(this.semanticTokens(actorTerm));
    const queries: string[] = [];

    for (const tokens of queryTokens.slice(0, 6)) {
      if (tokens.length < 2) continue;
      const distinctive = this.unique([
        ...tokens.filter((token) => actorTokenSet.has(token)).slice(0, 3),
        ...tokens.filter((token) => stableTerms.includes(token)),
        ...tokens,
      ]).slice(0, 7);
      if (distinctive.length >= 2) {
        queries.push(distinctive.join(' '));
      }
    }

    for (let index = 0; index < workflowTerms.length && queries.length < maxQueries; index += 1) {
      queries.push(
        this.compose(
          actorTerm,
          workflowTerms[index],
          painTerms[index % Math.max(1, painTerms.length)] ?? '',
        ),
      );
    }

    if (stableTerms.length >= 3 && queries.length < maxQueries) {
      queries.push(stableTerms.slice(0, 5).join(' '));
    }

    const identityTerms = this.extractEvidenceIdentityTerms(description);
    if (identityTerms.length >= 2 && queries.length < maxQueries) {
      queries.push(
        this.compose(
          identityTerms.slice(0, 3).join(' '),
          workflowTerms[0] ?? '',
        ),
      );
    }

    return this.deduplicate(queries)
      .map((query) => query.split(/\s+/u).slice(0, 7).join(' '))
      .filter((query) => query.split(/\s+/u).length >= 2)
      .slice(0, maxQueries);
  }

  /**
   * Converts AI evidence targets and professional planner vocabulary into
   * search-engine-shaped recovery queries. Evidence targets are often the most
   * precise description of what a real external source should say, but older
   * recovery code reduced them to short generic fragments. This method keeps
   * the actor/object identity plus the professional failure terms while
   * removing meta phrases such as "reports of" and "case studies on".
   *
   * The output is retrieval-only and never counts as evidence.
   */
  static buildProfessionalEvidenceQueries(
    input: DynamicRequestQueryInput,
  ): string[] {
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
    const description = this.cleanText(input.requestDescription ?? '');
    if (!description) return [];

    const meta = /\b(?:reports?|reported|reporting|discussions?|discussing|case studies?|case study|examples?|accounts? of|complaints?|practitioner|practitioners|operator|operators|highlighting|regarding|describing|detailing|showing|instances? of)\b/giu;
    const searchStopWords = new Set([
      ...this.stopWords,
      'would', 'could', 'should', 'need', 'needs', 'mention', 'mentions',
      'support', 'supports', 'supporting', 'evidence', 'real', 'external',
    ]);

    const cleanTarget = (value: string): string => {
      const tokens = this.semanticTokens(
        this.cleanText(value).replace(meta, ' '),
      ).filter((token) => !searchStopWords.has(token));
      return tokens.slice(0, 9).join(' ');
    };

    const targetQueries = (input.evidenceTargets ?? [])
      .map(cleanTarget)
      .filter((query) => query.split(/\s+/u).length >= 3);

    const plannedQueries = (input.plannedQueries ?? [])
      .map((value) => this.cleanText(value))
      .filter(Boolean)
      .map((value) => value.split(/\s+/u).slice(0, 9).join(' '));

    const actor = this.extractActor(description);
    const actorAliases = this.buildActorAliases(actor || description);
    const actorTerm = actorAliases[0] || actorAliases[1] || actor;
    const identity = this.extractEvidenceIdentityTerms(description).slice(0, 4).join(' ');
    const workflows = this.extractWorkflowPhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 4);
    const pains = this.extractFailurePhrases(description)
      .map((value) => this.compactPhrase(value, 4))
      .filter(Boolean)
      .slice(0, 4);

    const derived: string[] = [];
    for (let index = 0; index < Math.max(workflows.length, pains.length); index += 1) {
      derived.push(
        this.compose(
          actorTerm || identity,
          workflows[index % Math.max(1, workflows.length)] ?? '',
          pains[index % Math.max(1, pains.length)] ?? '',
        ),
      );
    }

    const professionalTerminologyQueries =
      this.buildProfessionalTerminologyQueries({
        ...input,
        maxQueries: Math.min(8, maxQueries),
      });

    return this.deduplicate([
      ...professionalTerminologyQueries,
      ...targetQueries,
      ...plannedQueries,
      ...derived,
      ...this.buildRelaxedRetrievalQueries({
        ...input,
        maxQueries: Math.min(4, maxQueries),
      }),
    ])
      .map((query) => query.split(/\s+/u).slice(0, 9).join(' '))
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, maxQueries);
  }

  /**
   * Distinctive identity tokens derived from the request itself. This keeps
   * unseen nouns available to retrieval/alignment without adding a domain rule.
   */
  static extractEvidenceIdentityTerms(value: string): string[] {
    const cleaned = this.cleanText(value).toLocaleLowerCase();
    if (!cleaned) return [];

    const actor = this.extractActor(cleaned);
    const broad = new Set([
      'independent', 'specialist', 'specialists', 'business', 'businesses',
      'company', 'companies', 'department', 'departments', 'team', 'teams',
      'operator', 'operators', 'provider', 'providers', 'service', 'services',
      'customer', 'customers', 'client', 'clients', 'management', 'operations',
      'workflow', 'workflows', 'record', 'records', 'tracking', 'track',
      'information', 'data', 'system', 'systems', 'platform', 'platforms',
      'software', 'application', 'applications', 'problem', 'problems',
      'history', 'notes',
      'often', 'struggle', 'struggles', 'document', 'manage', 'review',
      'analyze', 'analyzed', 'analysed', 'separate', 'separately', 'difficult',
      'precise', 'approved', 'progress', 'project', 'projects', 'delayed',
      'lead', 'leads', 'leading', 'making', 'maintain', 'activity',
      'protect', 'protecting', 'allow', 'allowing', 'exchange', 'exchanging',
      'detect', 'detecting', 'trace', 'tracing', 'quickly', 'necessary', 'can',
    ]);

    return this.unique(
      this.semanticTokens(`${actor} ${cleaned}`)
        .filter((token) => !broad.has(token))
        .filter((token) => token.length >= 4),
    ).slice(0, 14);
  }

  private static buildIdentityPhrases(identityTerms: readonly string[]): string[] {
    const phrases: string[] = [];
    for (let index = 0; index < identityTerms.length; index += 1) {
      const current = identityTerms[index];
      const next = identityTerms[index + 1];
      if (current && next) phrases.push(`${current} ${next}`);
      if (current) phrases.push(current);
    }
    return this.unique(phrases).slice(0, 8);
  }

  static extractActor(value: string): string {
    const normalized = this.cleanText(value);
    const explicit = normalized.match(
      /^(.{3,100}?)\s+(?:often|frequently|regularly|commonly|sometimes)\s+(?:struggle|struggles|have difficulty|has difficulty|find it difficult|finds it difficult)\b/iu,
    )?.[1];

    if (explicit) {
      return this.compactActor(explicit);
    }

    const firstClause = normalized.split(/[.!?;,]/u)[0] ?? '';
    const beforeVerb = firstClause.match(
      /^(.{3,100}?)\s+(?:(?:increasingly|often|frequently|regularly|commonly)\s+)?(?:struggle|struggles|need|needs|manage|manages|track|tracks|coordinate|coordinates|record|records|review|reviews|depend|depends|rely|relies|operate|operates|use|uses)\b/iu,
    )?.[1];

    return beforeVerb ? this.compactActor(beforeVerb) : '';
  }


  static extractWorkflowTerms(value: string): string[] {
    return this.extractWorkflowPhrases(value);
  }

  static extractPainTerms(value: string): string[] {
    return this.extractFailurePhrases(value);
  }

  static buildActorAliases(value: string): string[] {
    const actor = this.extractActor(value) || this.cleanText(value).split(/[.!?;,]/u)[0] || '';
    const normalized = this.cleanText(actor)
      .replace(/^\b(?:many|some|most|small|independent|local)\b\s*/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!normalized) return [];

    const aliases = [normalized];
    const organizationalMatch = normalized.match(
      /^(.*?)(?:\s+)(clinics?|practices?|hospitals?|facilities|centers?|centres?|workshops?|studios?)$/iu,
    );
    if (organizationalMatch) {
      const root = (organizationalMatch[1] ?? '').replace(/\s+/gu, ' ').trim();
      const suffix = (organizationalMatch[2] ?? '').toLocaleLowerCase();
      if (root) {
        if (/^clinics?$/u.test(suffix)) {
          aliases.push(`${root} practice`, `${root} hospital`);
        } else if (/^practices?$/u.test(suffix)) {
          aliases.push(`${root} clinic`, `${root} hospital`);
        } else if (/^hospitals?$/u.test(suffix)) {
          aliases.push(`${root} clinic`, `${root} practice`);
        } else if (/^(?:centers?|centres?|facilities)$/u.test(suffix)) {
          aliases.push(`${root} center`, `${root} facility`);
        } else if (/^workshops?$/u.test(suffix)) {
          aliases.push(`${root} studio`);
        } else if (/^studios?$/u.test(suffix)) {
          aliases.push(`${root} workshop`);
        }
      }
    }
    const withoutOrgSuffix = normalized
      .replace(/\b(?:companies?|businesses?|organizations?|organisations?|providers?|operators?|teams?|departments?|agencies|authorities|networks?|facilities|clinics?|practices?|hospitals?|workshops?|shops?|studios?)\b$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (withoutOrgSuffix) aliases.push(withoutOrgSuffix);

    const singularized = withoutOrgSuffix
      .split(/\s+/u)
      .map((token) => {
        if (/ies$/iu.test(token) && token.length > 5) return `${token.slice(0, -3)}y`;
        if (/s$/iu.test(token) && !/ss$/iu.test(token) && token.length > 4) {
          return token.slice(0, -1);
        }
        return token;
      })
      .join(' ')
      .trim();
    if (singularized) aliases.push(singularized);

    return this.unique(aliases)
      .map((item) => item.split(/\s+/u).slice(0, 6).join(' '))
      .filter(Boolean)
      .slice(0, 4);
  }

  private static extractFallbackSubject(description: string): string {
    const firstClause = description.split(/[.!?;,]/u)[0] ?? description;
    const tokens = firstClause
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => !this.stopWords.has(token.toLocaleLowerCase()));
    return tokens.slice(0, 5).join(' ');
  }

  private static extractProblemBearingText(value: string): string {
    const normalized = (value ?? '')
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!normalized) return '';

    const sentences = normalized
      .split(/(?<=[.!?؟])\s+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const solutionLanguage =
      /\b(?:a\s+smarter|smarter\s+(?:system|platform|tool)|could\s+(?:combine|track|detect|estimate|help|flag|organize|prioritize|provide|enable|allow|recommend|automate|predict)|would\s+(?:combine|track|detect|estimate|help|flag|organize|prioritize|provide|enable|allow|recommend|automate|predict))\b/iu;
    const problemLanguage =
      /\b(?:struggl\w*|difficult\w*|unable|cannot|can't|fragment\w*|separat\w*|delay\w*|miss\w*|fail\w*|error\w*|backlog\w*|conflict\w*|bottleneck\w*|shortage\w*|overtrain\w*|fatigue\w*|risk\w*|overload\w*|rework\w*|downtime|outage|slow\w*)\b/iu;
    const arabicProblemLanguage =
      /(?:يعان|صعوب|تأخير|فشل|خطأ|مشكل|ضغط|ازدحام|نقص|منفصل|إصابة|خطر|إرهاق|إجهاد)/u;

    const problemSentences = sentences.filter(
      (sentence) =>
        !solutionLanguage.test(sentence) &&
        (problemLanguage.test(sentence) || arabicProblemLanguage.test(sentence)),
    );

    if (problemSentences.length > 0) {
      return problemSentences.slice(0, 2).join(' ');
    }

    const nonSolution = sentences.filter((sentence) => !solutionLanguage.test(sentence));
    return (nonSolution[0] ?? sentences[0] ?? normalized).trim();
  }

  private static extractWorkflowPhrases(description: string): string[] {
    const sentences = description
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/(?<=[.!?])\s+/u)
      .map((value) => value.replace(/[.!?]+$/u, '').trim())
      .filter(Boolean)
      .slice(0, 4);
    const outputs: string[] = [];

    for (const sentence of sentences) {
      const normalized = sentence.toLocaleLowerCase();
      const actionList = normalized.match(
        /\b(?:struggle|struggles|need|needs|try|tries|have|has)\s+(?:to\s+)?(?:organize|organise|track|coordinate|identify|manage|monitor|record|review|maintain|handle|follow|understand|schedule|prioritize|prioritise|allocate|reconcile|verify|inspect|process|plan|predict|detect)\s+(.+)$/iu,
      )?.[1];
      if (actionList) outputs.push(...this.splitWorkflowList(actionList));

      const capabilityList = normalized.match(
        /\b(?:combine|uses?|using|track|tracks|monitor|monitors|manage|manages|coordinate|coordinates|record|records|review|reviews|analyze|analyse|detect|predict|prioritize|prioritise|reorganize|reorganise)\s+([^.!?]{4,220})/iu,
      )?.[1];
      if (capabilityList) outputs.push(...this.splitWorkflowList(capabilityList));
    }

    if (outputs.length < 4) {
      const clauses = description
        .toLocaleLowerCase()
        .split(/[.!?;]|,|\band\b|\bor\b/gu)
        .map((value) => value.trim())
        .filter((value) => value.length >= 8);
      for (const clause of clauses) {
        if (/\b(?:struggle|problem|issue|failure|delay|risk|difficult|unable|cannot|can't|lead to|result in|cause)\w*\b/iu.test(clause)) {
          continue;
        }
        const compact = this.compactWorkflowPhrase(clause);
        if (compact) outputs.push(compact);
      }
    }

    return this.unique(outputs).slice(0, 10);
  }

  private static splitWorkflowList(value: string): string[] {
    const bounded = value
      .replace(
        /\b(?:before|after|while|when|because|since|making|which|so that|in order to|information\s+(?:is|are)|this\s+(?:can|may|makes?|leads?|results?))\b[\s\S]*$/iu,
        ' ',
      )
      .replace(/\s+/gu, ' ')
      .trim();

    return bounded
      .split(/,|\band\b|\bor\b/gu)
      .map((part) => this.compactWorkflowPhrase(part))
      .filter(Boolean);
  }

  private static compactWorkflowPhrase(value: string): string {
    const compact = this.compactPhrase(
      value
        .replace(
          /^(?:information|details?|records?|activity|data)\s+(?:about|for|on)\s+/iu,
          '',
        )
        .replace(
          /\b(?:while|when|because|making|which|so that|in order to)\b[\s\S]*$/iu,
          ' ',
        )
        .replace(
          /\b(?:are|is|was|were|usually|frequently|often|commonly|typically|separately|different)\b/giu,
          ' ',
        ),
      6,
    );
    if (!compact) return '';

    const normalized = compact.toLocaleLowerCase();
    if (
      /^(?:often|frequently|usually)?\s*(?:struggle|struggles|problem|problems|issue|issues|failure|failures|delay|delays|risk|risks)\b/iu.test(normalized)
    ) {
      return '';
    }
    return compact.split(/\s+/u).length >= 2 ? compact : '';
  }

  private static extractFailurePhrases(description: string): string[] {
    const lower = description.toLocaleLowerCase();
    const outputs: string[] = [];
    const painPatterns = [
      /\b(?:missed|missing|forgotten|lost|incorrect|wrong|inconsistent|delayed|slow|unexpected|unauthorized|unauthorised|unapproved|abnormal|unusual|unnecessary|inefficient|excessive|fragmented|scattered|unavailable|overdue|overloaded|underused|overused|duplicated|repeated)\s+[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,4}\b/gu,
      /\b(?:failure|failures|failed|fault|faults|error|errors|risk|risks|conflict|conflicts|delay|delays|shortage|shortages|bottleneck|bottlenecks|outage|outages|downtime|defect|defects|breakdown|breakdowns|loss|losses|damage|waste|spoilage|anomaly|anomalies|inefficiency|inefficiencies|fraud|fraudulent|suspicious|rework|backlog|backlogs|overrun|overruns|overtraining|fatigue|workload)\w*\b/gu,
      /\b(?:risk|risks)\s+(?:of|for)\s+[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,4}\b/gu,
      /\b(?:injury|safety|health|medical|performance|operational|financial|security)\s+risks?\b/gu,
      /\b(?:pickup|delivery|completion|service)\s+deadlines?\b/gu,
      /\b(?:increase|increases|increasing|raise|raises|raising)\s+[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3}\s+costs?\b/gu,
      /\b(?:unable to|cannot|can't|difficult to|difficulty)\s+[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,6}\b/gu,
      /\b(?:struggle|struggles|struggling)\s+to\s+[^.!?]{5,180}/gu,
      /\b[^.!?]{0,80}(?:reviewed|analyzed|analysed|managed|stored|tracked)\s+separately\b/gu,
    ];

    for (const pattern of painPatterns) {
      for (const match of lower.matchAll(pattern)) {
        const compact = this.compactPhrase(match[0], 7).trim();
        if (compact && this.isUsefulFailurePhrase(compact)) outputs.push(compact);
      }
    }

    const problemClauses = lower
      .split(/[.!?;]/gu)
      .map((value) => value.trim())
      .filter((value) => value.length >= 6)
      .filter((value) => this.isUsefulFailurePhrase(value));
    for (const clause of problemClauses) {
      const bounded = clause
        .replace(/^.*?\b(?:struggle|struggles|problem|problems|issue|issues|because|when)\b/iu, ' ')
        .replace(/\b(?:a smarter|a better|the proposed|the system|the platform)\b[\s\S]*$/iu, ' ')
        .trim();
      const compact = this.compactPhrase(bounded || clause, 7);
      if (compact && this.isUsefulFailurePhrase(compact)) outputs.push(compact);
    }

    const consequenceMatches = lower.matchAll(
      /\b(?:lead to|leads to|result in|results in|causes?|causing|can cause|can lead to|making it difficult to|difficult to)\s+([^.!?]{5,220})/gu,
    );
    for (const match of consequenceMatches) {
      const consequence = match[1] ?? '';
      for (const part of consequence.split(/,|\band\b|\bor\b/gu)) {
        const compact = this.compactPhrase(part, 7);
        if (compact && this.isUsefulFailurePhrase(compact)) outputs.push(compact);
      }
    }

    return this.unique(outputs)
      .sort((left, right) => {
        const leftWords = left.split(/\s+/u).length;
        const rightWords = right.split(/\s+/u).length;
        const leftDistance = Math.abs(leftWords - 4);
        const rightDistance = Math.abs(rightWords - 4);
        return leftDistance - rightDistance || leftWords - rightWords;
      })
      .slice(0, 10);
  }

  private static isUsefulFailurePhrase(value: string): boolean {
    const normalized = value.toLocaleLowerCase();
    return /\b(?:fraud|fake|suspicious|misleading|restrict|unauthorized|unauthorised|unapproved|overdue|false positive|miss|forgot|repeat|failure|fail|fault|error|risk|conflict|delay|deadline|slow|unsafe|unhealthy|incorrect|wrong|inconsistent|abnormal|unusual|unnecessary|inefficient|inefficiency|anomal|lost|missing|shortage|bottleneck|backlog|waste|spoil|breakdown|overload|outage|downtime|defect|unable|cannot|can't|problem|issue|difficult|poor|fragmented|scattered|separate|separately|coordination|coordinate|workload|overtraining|fatigue|loss|damage|cost|overrun|rework)\w*\b/iu.test(
      normalized,
    );
  }

  private static compactActor(value: string): string {
    return this.cleanText(value)
      .replace(/^(?:many|some|most|small)\s+/iu, (match) =>
        /small/i.test(match) ? 'small ' : '',
      )
      .split(/\s+/u)
      .slice(0, 7)
      .join(' ');
  }

  private static compactPhrase(value: string, maxWords: number): string {
    return this.cleanText(value)
      .replace(/^(?:reports?|discussions?|complaints?|examples?)\s+(?:of|about|regarding)?\s*/iu, '')
      .replace(/\b(?:often|usually|frequently|commonly|typically|really|very)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .filter((token) => !this.stopWords.has(token.toLocaleLowerCase()))
      .slice(0, maxWords)
      .join(' ');
  }

  private static compose(...parts: string[]): string {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const part of parts) {
      for (const token of this.cleanText(part).split(/\s+/u)) {
        if (!token) continue;
        const normalized = token.toLocaleLowerCase();
        const identity = this.queryTokenIdentity(normalized);
        if (seen.has(identity)) continue;
        seen.add(identity);
        output.push(token);
      }
    }
    return this.sanitizeGeneratedQuery(output.join(' ')).slice(0, 140);
  }

  private static deduplicate(values: readonly string[]): string[] {
    const output: string[] = [];
    const signatures: Array<Set<string>> = [];
    for (const raw of values) {
      const value = this.sanitizeGeneratedQuery(this.cleanText(raw));
      if (!value) continue;
      const tokens = new Set(this.semanticTokens(value));
      const duplicate = signatures.some((existing) => {
        const shared = [...tokens].filter((token) => existing.has(token)).length;
        return shared / Math.max(1, Math.min(tokens.size, existing.size)) >= 0.82;
      });
      if (duplicate) continue;
      output.push(value);
      signatures.push(tokens);
    }
    return output;
  }

  private static sanitizeGeneratedQuery(value: string): string {
    const tokens = this.cleanText(value)
      .replace(
        /^(?:can\s+)?(?:lead|leads|leading)(?:\s+to)?\s+|^(?:can cause|cause|causes|causing|result in|results in|making it difficult to|difficult to)\s+/iu,
        '',
      )
      .replace(
        /\s+(?:and|or|but|while|with|without|to|for|of|from|by|because)$/iu,
        '',
      )
      .split(/\s+/u)
      .filter(Boolean);

    const output: string[] = [];
    let previousIdentity = '';
    for (const token of tokens) {
      const identity = this.queryTokenIdentity(token.toLocaleLowerCase());
      if (identity && identity === previousIdentity) continue;
      output.push(token);
      previousIdentity = identity;
    }

    return output
      .join(' ')
      .replace(/\b(?:often struggle|struggles? problem)\b/giu, ' ')
      .replace(/\b(?:document|documenting)\s+problem\b/giu, 'documentation')
      .replace(/\b(?:an accurate )?history for each problem\b/giu, 'history')
      .replace(/\s+(?:problem|problems)$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static queryTokenIdentity(token: string): string {
    const normalized = token
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (normalized.length <= 4) return normalized;

    if (/ies$/u.test(normalized) && normalized.length > 5) {
      return `${normalized.slice(0, -3)}y`;
    }
    if (/(?:sses|shes|ches|xes|zes)$/u.test(normalized) && normalized.length > 6) {
      return normalized.slice(0, -2);
    }
    if (/s$/u.test(normalized) && !/ss$/u.test(normalized) && normalized.length > 5) {
      return normalized.slice(0, -1);
    }
    return normalized;
  }

  private static semanticTokens(value: string): string[] {
    return this.cleanText(value)
      .toLocaleLowerCase()
      .split(/\s+/u)
      .filter((token) => token.length >= 3)
      .filter((token) => !this.stopWords.has(token));
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of values) {
      const value = this.cleanText(raw);
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }

  private static stripRequesterLeadIn(value: string): string {
    return value
      .replace(/^(?:i|we)\s+(?:want|need|would like|am looking for|are looking for|hope)\s+(?:to\s+)?/iu, '')
      .replace(/^(?:something|anything|a solution|an idea|a workflow|a product)\s+(?:useful\s+)?(?:for|to)\s+/iu, '')
      .replace(/^(?:useful|helpful)\s+(?:for|to)\s+/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static cleanText(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/([\p{L}\p{N}])(?:['’]s)\b/giu, '$1')
      .replace(/(?:^|\s)['’]s\b/giu, ' ')
      .replace(/[^\p{L}\p{N}\s&/'’:-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static readonly stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'from', 'with', 'without',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'more', 'than', 'expected',
    'in', 'on', 'at', 'by', 'through', 'between', 'into', 'across', 'each', 'every',
    'this', 'that', 'these', 'those', 'which', 'what', 'when', 'where', 'who', 'how',
    'can', 'could', 'may', 'might', 'would', 'should', 'often', 'usually', 'frequently',
    'commonly', 'typically', 'different', 'separate', 'separately', 'difficult', 'difficulty',
    'makes', 'making', 'make', 'understand', 'identify', 'recognize', 'decide', 'recorded',
    'reviewed', 'shared', 'information', 'data', 'it', 'its', 'before', 'after', 'affected',
    'struggle', 'struggles', 'organize', 'organise', 'track', 'manage', 'keep', 'performed',
    'previous', 'during', 'physical', 'businesses', 'they', 'them', 'their', 'theirs',
  ]);
}
