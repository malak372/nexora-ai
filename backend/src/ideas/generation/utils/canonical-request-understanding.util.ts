import type { RequestCanonicalProblemProfile } from '../types/request-collection-plan.type';

/**
 * Deterministic semantic fallback used only when the online PREPARING planner
 * is unavailable or returns unusable JSON. It deliberately models one canonical
 * request profile and derives all fallback/recovery queries from that profile so
 * later stages do not re-tokenize the requester text independently.
 */
export class CanonicalRequestUnderstandingUtil {
  static resolve(description: string): RequestCanonicalProblemProfile {
    const normalized = this.normalize(description);
    const sentences = normalized.split(/(?<=[.!?])\s+/u).filter(Boolean);
    const first = sentences[0] ?? normalized;

    const actor = this.cleanPhrase(
      first.match(
        /^(.*?)(?:\s+(?:often|frequently|usually|commonly|increasingly))?\s+(?:struggle|struggles|struggling|have difficulty|has difficulty|find it difficult|finds it difficult|need to|must)\b/iu,
      )?.[1] ?? first.split(/\s+/u).slice(0, 6).join(' '),
      160,
    );

    const coreProblem = this.cleanPhrase(
      sentences.find((sentence) =>
        /\b(?:struggl|difficult|unable|cannot|can't|fragment|separate|silo|fail|delay|incorrect|wrong|miss|waste|unauthori[sz]ed|attack|overcrowd|shortage|conflict|rework)\w*\b/iu.test(sentence),
      ) ?? first,
      280,
    );

    const workflowSentence = sentences.find((sentence) =>
      /\b(?:scattered|fragmented|disconnected|separate platforms?|separate systems?|managed through separate|monitored through separate|stored across|tracked across|analy[sz]ed separately|reviewed separately)\b/iu.test(sentence),
    ) ?? sentences.find((sentence) =>
      /\b(?:records?|logs?|telemetry|status|activity|alerts?|notes?|messages?|sketches?|samples?|reports?|capacity|availability|measurements?|specifications?|revisions?|approvals?|platforms?|systems?)\b/iu.test(sentence),
    ) ?? sentences[1] ?? coreProblem;
    const workflow = this.cleanPhrase(
      workflowSentence
        .replace(/\s*,?\s*(?:making|which makes|so)\s+it\s+difficult\b.*$/iu, '')
        .replace(/\s*,?\s*making\s+it\s+difficult\b.*$/iu, ''),
      240,
    );

    const frictionMatch = normalized.match(
      /\b(?:making\s+it\s+difficult\s+to|difficult\s+to|hard\s+to|unable\s+to|cannot\s+|can't\s+)([^.!?]{5,240})/iu,
    )?.[1];
    const friction = this.cleanPhrase(
      frictionMatch ? this.describeDifficulty(frictionMatch) : coreProblem,
      220,
    );

    const object = this.resolveObject(first, normalized, actor);
    const consequences = this.extractConsequences(normalized);
    const failureModes = this.unique([
      friction,
      ...this.extractFailurePhrases(normalized).filter(
        (value) => !this.sameMeaning(value, coreProblem),
      ),
    ]).filter((value) => !consequences.some((item) => this.sameMeaning(item, value))).slice(0, 6);

    const actorAliases = this.buildActorAliases(actor, object);
    const objectAliases = this.buildObjectAliases(object, normalized);
    const evidenceFacets = this.unique([
      friction,
      ...failureModes,
      ...consequences,
    ]).slice(0, 10);

    return {
      actor,
      object,
      coreProblem,
      workflow,
      friction,
      failureModes: failureModes.length > 0 ? failureModes : [coreProblem],
      consequences: consequences.length > 0 ? consequences : [],
      actorAliases,
      objectAliases,
      evidenceFacets,
    };
  }

  static buildSearchQueries(
    profile: RequestCanonicalProblemProfile,
    maxQueries = 6,
  ): string[] {
    const actors = this.unique([profile.actor, ...(profile.actorAliases ?? [])])
      .map((value) => this.compact(value, 4));
    const objects = this.unique([profile.object, ...(profile.objectAliases ?? [])])
      .map((value) => this.compact(value, 4));
    const facets = this.unique([
      profile.friction ?? '',
      ...profile.failureModes,
      ...profile.consequences,
      ...(profile.evidenceFacets ?? []),
    ]).filter(Boolean).map((value) => this.compact(value, 4));
    const consequences = (profile.consequences.length > 0
      ? profile.consequences
      : facets).map((value) => this.compact(value, 3));
    const workflow = this.compact(profile.workflow, 4);

    /*
     * The normal compact actor/object/failure combinations are intentionally
     * kept because they work well for short requests.  Long operational
     * descriptions, however, often contain several independent concrete
     * facets (for example roads, streetlights, water leaks, citizen reports,
     * sensor feeds, fitting appointments, fabric shortages, and delivery
     * deadlines).  When the online PREPARING planner is unavailable we must
     * not collapse all of those facets into only one or two broad queries.
     *
     * Build additional request-owned facet packets directly from the canonical
     * profile.  No new domain/problem claim is introduced here: every packet is
     * text already present in the requester-derived actor/object/workflow/
     * failure axes.  This makes the deterministic fallback recall-complete
     * enough to be a real safety net rather than a token-stitched placeholder.
     */
    const facetSegments = this.queryFacetSegments(profile);

    const candidates = [
      this.compose(actors[0], objects[0], facets[0]),
      this.compose(actors[1] ?? actors[0], objects[1] ?? objects[0], consequences[0]),
      this.compose(actors[2] ?? actors[0], workflow, consequences[1] ?? consequences[0]),
      this.compose(actors[1] ?? actors[0], objects[2] ?? objects[0], consequences[2] ?? facets[0]),
      this.compose(actors[3] ?? actors[0], objects[3] ?? objects[0], facets[0]),
      this.compose(actors[0], objects[1] ?? objects[0], consequences[3] ?? consequences[0]),
      this.compose(actors[4] ?? actors[0], objects[2] ?? objects[0], consequences[4] ?? facets[0]),
      this.compose(actors[2] ?? actors[0], objects[3] ?? objects[0], consequences[0]),
      ...facetSegments.flatMap((segment, index) => [
        this.compose(
          actors[index % Math.max(actors.length, 1)] ?? actors[0],
          segment,
          index % 2 === 0 ? workflow : objects[index % Math.max(objects.length, 1)] ?? objects[0],
        ),
        this.compose(
          objects[index % Math.max(objects.length, 1)] ?? objects[0],
          segment,
          facets[index % Math.max(facets.length, 1)] ?? facets[0],
        ),
      ]),
    ];

    return this.unique(
      candidates.map((query) => this.normalizeQuery(query)),
    )
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, maxQueries);
  }


  static buildRecoveryQueries(
    profile: RequestCanonicalProblemProfile,
    previousQueries: readonly string[],
    maxQueries = 6,
  ): string[] {
    const previous = new Set(
      previousQueries.map((value) => this.normalizeQuery(value).toLocaleLowerCase()),
    );
    const actors = this.unique([
      profile.actor,
      ...(profile.actorAliases ?? []),
    ]).map((value) => this.compact(value, 4));
    const objects = this.unique([
      profile.object,
      ...(profile.objectAliases ?? []),
    ]).map((value) => this.compact(value, 4));
    const workflow = this.compact(profile.workflow, 5);
    const failures = this.unique([
      profile.friction ?? '',
      ...profile.failureModes,
      ...(profile.evidenceFacets ?? []),
    ]).filter(Boolean).map((value) => this.compact(value, 5));
    const consequences = this.unique(profile.consequences)
      .map((value) => this.compact(value, 4));
    const operationalSegments = this.unique(
      [
        profile.object,
        profile.workflow,
        profile.friction ?? '',
        ...profile.failureModes,
      ].flatMap((value) =>
        value
          .split(/\s*(?:,|;|\band\b|\bwhen\b|\bwhile\b|\bwith\b)\s*/iu)
          .map((segment) =>
            segment
              .replace(
                /\b(?:often|frequently|usually|commonly)?\s*(?:struggle|struggles|struggling|have difficulty|has difficulty|find it difficult|finds it difficult)\s+(?:to\s+)?/giu,
                '',
              )
              .replace(/^\s*(?:manage|managing|coordinate|coordinating)\s+/iu, '')
              .trim(),
          )
          .filter((segment) => segment.split(/\s+/u).length >= 2),
      ),
    )
      .map((value) => this.compact(value, 5))
      .filter(Boolean)
      .slice(0, 8);

    /*
     * Recovery broadens one semantic axis at a time while preserving the
     * requester-owned workflow/failure. This gives niche text requests a real
     * recall path without inventing a new vertical or weakening evidence
     * verification. Actor aliases drop modifiers such as "independent"; object
     * aliases drop storage words such as "records/data"; workflow/failure terms
     * stay anchored to the original request.
     */
    const facetSegments = this.queryFacetSegments(profile);
    const candidates = [
      this.compose(operationalSegments[0], operationalSegments[1], 'operational challenges'),
      this.compose(operationalSegments[1], operationalSegments[2], 'workflow bottlenecks'),
      this.compose(operationalSegments[2], operationalSegments[3], 'coordination friction'),
      this.compose(operationalSegments[0], operationalSegments[2], 'process constraints'),
      this.compose(operationalSegments[3], operationalSegments[0], 'reported problems'),
      this.compose(operationalSegments[1], operationalSegments[3], 'operational delays'),
      this.compose(actors[1] ?? actors[0], workflow, failures[0]),
      this.compose(actors[1] ?? actors[0], objects[1] ?? objects[0], failures[1] ?? failures[0]),
      this.compose(objects[1] ?? objects[0], workflow, failures[0]),
      this.compose(workflow, failures[0], consequences[0]),
      this.compose(actors[2] ?? actors[1] ?? actors[0], failures[0], consequences[0]),
      this.compose(objects[2] ?? objects[1] ?? objects[0], failures[1] ?? failures[0], consequences[1] ?? consequences[0]),
      this.compose(workflow, failures[1] ?? failures[0], consequences[2] ?? consequences[0]),
      this.compose(actors[1] ?? actors[0], objects[1] ?? objects[0], consequences[0]),
      ...facetSegments.flatMap((segment, index) => [
        this.compose(
          actors[index % Math.max(actors.length, 1)] ?? actors[0],
          segment,
          failures[index % Math.max(failures.length, 1)] ?? failures[0],
        ),
        this.compose(
          objects[index % Math.max(objects.length, 1)] ?? objects[0],
          segment,
          consequences[index % Math.max(consequences.length, 1)] ?? workflow,
        ),
      ]),
      ...this.buildSearchQueries(profile, Math.max(maxQueries, 8)),
    ];

    return this.unique(
      candidates.map((query) => this.normalizeQuery(query)),
    )
      .filter((query) => query.split(/\s+/u).length >= 3)
      .filter((query) => !previous.has(query.toLocaleLowerCase()))
      .slice(0, maxQueries);
  }

  static recommendSourceKeys(
    description: string,
    activeSourceKeys: readonly string[],
    maxSources = 4,
  ): string[] {
    const available = new Set(
      activeSourceKeys.map((key) => key.trim().toLocaleLowerCase()).filter(Boolean),
    );
    const normalized = description
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    const technical =
      /\b(?:software|developer|development|api|sdk|database|server|cloud|network|cybersecurity|security|model serving|inference|iot|internet of things|integration|deployment|runtime|authentication|blockchain|webhook|endpoint|repository|codebase)\b/u.test(normalized);
    const appOrConsumerWorkflow =
      /\b(?:app|application|mobile|consumer|customer|shopping|booking|reservation|delivery|restaurant|food|travel|fitness|education|student|personal|jewelry|jewellery|repair|order|orders|fleet|logistics|transportation|dispatch|courier|shipment|shipments|event|events|wedding|weddings|vendor|vendors|venue|venues|catering|photographer|photographers|decorator|decorators|schedule|schedules|scheduling|appointment|appointments|service coordination|e[ -]?commerce|commerce|real estate|property|properties|tenant|tenants|rental|rentals)\b/u.test(normalized);
    const institutionalOrResearch =
      /\b(?:government|public|municipal|healthcare|hospital|clinical|research|study|manufactur\w*|industrial|energy|agriculture|environment|policy|regulation|risk|maintenance)\b/u.test(normalized);
    const professionalOperationalWorkflow =
      /\b(?:manufactur\w*|factor(?:y|ies)|production|materials?|inventory|procurement|supply chain|warehouse|warehousing|fulfillment|fulfilment|capacity|operations?|operational|workshop|job shop|make to order|made to order|custom orders?|resource planning|erp|maintenance planning|quality control|lead times?|tailor\w*|seamstress|garments?|apparel|atelier|fabric|fitting|alteration|bespoke|made to measure|made-to-measure|custom craft|artisan\w*)\b/u.test(
        normalized,
      );
    const explicitlyDigitalProductWorkflow =
      /\b(?:existing|current|legacy)\s+(?:app|application|software|platform|system)\b|\b(?:app|application|software|saas)\b[^.!?]{0,100}\b(?:fail\w*|problem|issue|broken|slow|missing|limited|unreliable|difficult)\b/u.test(
        normalized,
      );

    const capabilityPriority = this.unique(
      professionalOperationalWorkflow
        ? [
            // Operational/B2B problems are often documented in studies,
            // industry reporting, and practitioner forums rather than consumer
            // complaint feeds. Keep one community lane, but do not let Reddit
            // dominate the first pass merely because the request contains the
            // word "order" or "schedule".
            'forum',
            'crossref',
            'news',
            ...(institutionalOrResearch ? ['gdelt'] : []),
            'reddit',
            'youtube',
            'blog',
            ...(explicitlyDigitalProductWorkflow
              ? ['app-store', 'google-play', 'product-hunt']
              : []),
            ...(technical
              ? ['hacker-news', 'stackoverflow', 'github', 'dev-to']
              : []),
          ]
        : [
            'reddit',
            'forum',
            ...(technical
              ? ['hacker-news', 'stackoverflow', 'github', 'dev-to']
              : []),
            'news',
            'crossref',
            ...(institutionalOrResearch ? ['gdelt'] : []),
            ...(appOrConsumerWorkflow ? ['app-store'] : []),
            'youtube',
            ...(appOrConsumerWorkflow ? ['google-play', 'product-hunt'] : []),
            'gdelt',
            'blog',
            'hacker-news',
            'dev-to',
            'github',
            'stackoverflow',
            'product-hunt',
            'app-store',
            'google-play',
          ],
    );

    return capabilityPriority
      .filter((key) => available.has(key))
      .slice(0, maxSources);
  }

  /**
   * Returns a small request-to-source affinity adjustment for recovery ranking.
   * This is a generic workflow/source rule, not a vertical lookup table: the
   * score is derived from whether the request describes professional operations,
   * a consumer/service workflow, or a technical implementation problem.
   */
  static sourceAffinityScore(description: string, sourceKey: string): number {
    const normalized = this.normalize(description);
    const key = sourceKey.trim().toLocaleLowerCase();
    if (!normalized || !key) return 0;

    const technical =
      /\b(?:api|sdk|database|server|cloud|network|cybersecurity|security|model serving|inference|integration|deployment|runtime|authentication|blockchain|webhook|endpoint|repository|codebase|software engineering)\b/u.test(
        normalized,
      );
    const professionalOperationalWorkflow =
      /\b(?:manufactur\w*|factor(?:y|ies)|production|materials?|inventory|procurement|supply chain|warehouse|warehousing|fulfillment|fulfilment|capacity|operations?|operational|workshop|job shop|make to order|made to order|custom orders?|resource planning|erp|maintenance planning|quality control|lead times?|tailor\w*|seamstress|garments?|apparel|atelier|fabric|fitting|alteration|bespoke|made to measure|made-to-measure|custom craft|artisan\w*)\b/u.test(
        normalized,
      );
    const serviceOrConsumerWorkflow =
      /\b(?:booking|reservation|restaurant|travel|fitness|student|education|delivery|logistics|dispatch|event|wedding|vendor|venue|appointment|shopping|commerce|tenant|rental|repair|consumer|customer)\b/u.test(
        normalized,
      );

    if (professionalOperationalWorkflow) {
      if (key === 'crossref') return 0.34;
      if (key === 'news' || key === 'gdelt') return 0.26;
      if (key === 'forum') return 0.24;
      if (key === 'blog' || key === 'youtube') return 0.08;
      if (key === 'reddit') return 0.02;
      if (
        !technical &&
        ['github', 'stackoverflow', 'dev-to', 'hacker-news'].includes(key)
      ) {
        return -0.28;
      }
      if (['app-store', 'google-play', 'product-hunt'].includes(key)) {
        return -0.12;
      }
    }

    if (serviceOrConsumerWorkflow) {
      if (key === 'reddit' || key === 'forum') return 0.2;
      if (key === 'app-store' || key === 'google-play') return 0.18;
      if (key === 'youtube') return 0.08;
    }

    if (technical) {
      if (['github', 'stackoverflow', 'dev-to', 'hacker-news'].includes(key)) {
        return 0.2;
      }
    }

    return 0;
  }

  static buildDomainDiscoveryQueries(domainNames: readonly string[], maxQueries = 6): string[] {
    const cleanDomains = this.unique(
      domainNames.map((name) => this.cleanPhrase(name, 80)),
    ).filter(Boolean);
    const queries: string[] = [];

    /*
     * Deterministic discovery is the provider-timeout safety net. Keep it
     * problem-first instead of issuing only generic "domain problems"
     * searches: each domain receives independent user/operator, workflow, and
     * cost/reliability pain angles. Community AI still decides whether any
     * returned item represents a real problem; these strings are retrieval
     * seeds only.
     */
    const painAngles = [
      'access approval processing delays backlog',
      'manual handoff duplicate entry rework errors',
      'capacity scheduling queue missed deadlines',
      'data quality reporting reconciliation failures',
      'customer onboarding service access barriers',
    ];
    for (const pain of painAngles) {
      for (const domain of cleanDomains) {
        queries.push(`${domain} ${pain}`);
        if (queries.length >= maxQueries) break;
      }
      if (queries.length >= maxQueries) break;
    }

    return this.unique(queries)
      .map((query) => this.normalizeQuery(query))
      .slice(0, maxQueries);
  }

  /**
   * Extracts bounded, requester-owned operational facets for deterministic
   * planning/recovery.  The helper deliberately avoids a domain lookup table:
   * it decomposes the canonical request axes themselves and therefore works for
   * municipal infrastructure, tailoring, healthcare, logistics, bakeries, and
   * other unseen workflows without fabricating terminology.
   */
  private static queryFacetSegments(
    profile: RequestCanonicalProblemProfile,
  ): string[] {
    const raw = this.unique([
      /* Problem/failure facets come first so a bounded 10-12 query fallback
       * cannot spend its whole budget on broad object/workflow paraphrases
       * before concrete pain facets such as roads, streetlights, water leaks,
       * fabric shortages, fitting appointments, or delivery deadlines appear. */
      profile.friction ?? '',
      profile.coreProblem,
      ...profile.failureModes,
      ...(profile.evidenceFacets ?? []),
      profile.object,
      profile.workflow,
      ...profile.consequences,
    ]).filter(Boolean);

    const segments = raw.flatMap((value) =>
      value
        .replace(/\b(?:such as|including|for example)\b/giu, ', ')
        .split(/\s*(?:,|;|\band\b|\bor\b|\bwhile\b|\bwhen\b|\bbefore\b|\bafter\b)\s*/iu)
        .map((segment) =>
          this.cleanPhrase(
            segment
              .replace(
                /^(?:a smarter (?:system|platform|tool) could|the system could|the platform could)\s+/iu,
                '',
              )
              .replace(
                /^(?:often|frequently|usually|commonly)?\s*(?:struggle|struggles|struggling|have difficulty|has difficulty|find it difficult|finds it difficult)\s+(?:to\s+)?/iu,
                '',
              )
              .replace(/^(?:difficulty\s+)?(?:with\s+)?/iu, '')
              .trim(),
            120,
          ),
        )
        .filter((segment) => {
          const tokenCount = this.semanticSegmentTokenCount(segment);
          return tokenCount >= 2 && tokenCount <= 10;
        }),
    );

    return this.unique(segments)
      .map((segment) => this.compact(segment, 7))
      .filter(Boolean)
      .slice(0, 12);
  }

  private static semanticSegmentTokenCount(value: string): number {
    const stop = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'from', 'in',
      'on', 'at', 'by', 'often', 'usually', 'frequently', 'could', 'would',
      'should', 'may', 'might', 'can', 'their', 'they', 'them', 'this', 'that',
      'these', 'those', 'such', 'as', 'across', 'many',
    ]);
    return this.normalize(value)
      .split(/\s+/u)
      .filter((token) => token.length >= 3 && !stop.has(token)).length;
  }

  private static resolveObject(firstSentence: string, full: string, actor: string): string {
    const whySubject = firstSentence.match(
      /\b(?:understand|determine|identify|explain)\s+why\s+([^.!?]{5,180}?)(?=\s+(?:consume|consumes|use|uses|fail|fails|are|is|become|becomes|cause|causes)\b)/iu,
    )?.[1];
    const actionObject = firstSentence.match(
      /\b(?:manage|protect|track|document|coordinate|monitor|control|optimise|optimize|reduce|balance|handle|verify|assess|inspect|diagnose|organize|organise|maintain|respond to)\w*\s+([^.!?]{5,220})/iu,
    )?.[1];
    let object = this.cleanPhrase(whySubject ?? actionObject ?? '', 180)
      .replace(/\s+while\s+(?:maintaining|preserving|keeping|balancing)\b.*$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (/\bcustomer requests? involving\b/iu.test(object) && /\bapproved specifications?\b/iu.test(full)) {
      object = 'customer requests and final approved specifications';
    }
    if (!object) {
      const workflowObject = full.match(
        /\b(?:records?|logs?|telemetry|status|activity|alerts?|notes?|messages?|sketches?|samples?|reports?|measurements?|specifications?)\b[^.!?]{0,220}/iu,
      )?.[0];
      object = this.cleanPhrase(workflowObject ?? actor, 180)
        .replace(
          /\s+(?:are|is|were|was)\s+(?:frequently|usually|often|commonly)?\s*(?:analy[sz]ed|reviewed|stored|tracked|managed|maintained)\b.*$/iu,
          '',
        )
        .trim();
    }
    return object;
  }

  private static extractConsequences(description: string): string[] {
    const match = description.match(
      /\b(?:can\s+lead\s+to|lead\s+to|leads\s+to|leading\s+to|can\s+result\s+in|results?\s+in|resulting\s+in|(?:the\s+)?result\s+can\s+be|(?:the\s+)?results?\s+(?:can|may)\s+(?:include|be)|caus(?:e|es|ing))\s+([^.!?]{5,360})/iu,
    );
    if (!match?.[1]) return [];
    return this.unique(
      match[1]
        .split(/,|;|\band\b/iu)
        .map((value) => this.cleanPhrase(value, 120))
        .filter((value) => value.length >= 4),
    ).slice(0, 6);
  }

  private static extractFailurePhrases(description: string): string[] {
    const values: string[] = [];
    const patterns = [
      /\b(?:making\s+it\s+difficult\s+to|difficult\s+to|hard\s+to|unable\s+to)\s+([^.!?]{5,220})/giu,
      /\b(?:struggle|struggles|struggling)\s+to\s+([^.!?]{5,220})/giu,
    ];
    for (const pattern of patterns) {
      for (const match of description.matchAll(pattern)) {
        if (match[1]) {
          values.push(this.cleanPhrase(this.describeDifficulty(match[1]), 180));
        }
      }
    }
    return this.unique(values).slice(0, 5);
  }

  /** Preserves the semantic role of a failed action without producing fragments such as "difficulty with confirm". */
  private static describeDifficulty(value: string): string {
    const phrase = this.normalize(value).replace(/^[,;:\-\s]+/gu, '').trim();
    if (!phrase) return 'operational difficulty';

    const [first = '', ...rest] = phrase.split(/\s+/u);
    const lower = first.toLocaleLowerCase();
    let gerund = first;
    if (/ing$/u.test(lower)) {
      gerund = first;
    } else if (/ie$/u.test(lower)) {
      gerund = `${first.slice(0, -2)}ying`;
    } else if (/e$/u.test(lower) && !/(?:ee|ye|oe)$/u.test(lower)) {
      gerund = `${first.slice(0, -1)}ing`;
    } else {
      gerund = `${first}ing`;
    }

    return `difficulty ${[gerund, ...rest].join(' ')}`;
  }

  private static buildActorAliases(actor: string, object: string): string[] {
    void object;
    const normalized = this.cleanPhrase(actor, 160);
    const stripped = normalized
      .replace(
        /\b(?:independent|public|urban|local|small|private|specialist|professional|regional|national)\b/giu,
        ' ',
      )
      .replace(/\s+/gu, ' ')
      .trim();
    const withoutGenericOrgWords = stripped
      .replace(/\b(?:teams?|departments?|organizations?|organisations?)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    return this.unique([normalized, stripped, withoutGenericOrgWords])
      .filter(Boolean)
      .slice(0, 4);
  }

  private static buildObjectAliases(
    object: string,
    description: string,
  ): string[] {
    void description;
    const normalized = this.cleanPhrase(object, 180);
    const compact = normalized
      .replace(
        /\b(?:records?|information|data|details?|status|history|final|approved)\b/giu,
        ' ',
      )
      .replace(/\s+/gu, ' ')
      .trim();
    const nounPhrase = compact
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 6)
      .join(' ');

    return this.unique([normalized, compact, nounPhrase])
      .filter(Boolean)
      .slice(0, 4);
  }

  private static compose(...parts: Array<string | undefined>): string {
    return parts.filter(Boolean).join(' ');
  }

  private static compact(value: string, maxWords: number): string {
    const stop = new Set([
      'often','frequently','usually','commonly','increasingly','the','a','an','of','to','for','with','and','or','are','is','be','been','being','through','across','separate','separately','making','it','difficult','can','lead','this','that','their','used','involving','manage','protect','detect','whether','unusual','behavior','behaviour','caused','confirm','final','approved','each','struggle','struggles','information','usually','frequently','monitored','by','in','from','into','on','at',
    ]);
    return this.normalize(value)
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length >= 2 && !stop.has(word))
      .slice(0, maxWords)
      .join(' ');
  }

  private static normalizeQuery(value: string): string {
    return this.compact(value, 9).replace(/\s+/gu, ' ').trim();
  }

  private static sameMeaning(left: string, right: string): boolean {
    const l = this.normalize(left).toLocaleLowerCase();
    const r = this.normalize(right).toLocaleLowerCase();
    return l === r || l.includes(r) || r.includes(l);
  }

  private static cleanPhrase(value: string, maxLength: number): string {
    const normalized = this.normalize(value)
      .replace(/^[,;:\-\s]+|[,;:\-\s]+$/gu, '')
      .trim();
    if (normalized.length <= maxLength) return normalized;

    const bounded = normalized.slice(0, maxLength + 1);
    const boundary = Math.max(
      bounded.lastIndexOf('. '),
      bounded.lastIndexOf('; '),
      bounded.lastIndexOf(', '),
      bounded.lastIndexOf(' '),
    );
    return (boundary >= Math.floor(maxLength * 0.58)
      ? bounded.slice(0, boundary)
      : bounded.slice(0, maxLength))
      .replace(/[,;:\-\s]+$/gu, '')
      .trim();
  }

  private static normalize(value: string): string {
    return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  private static unique(values: readonly string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
      const value = this.normalize(raw);
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }
}
