import type { RequestCanonicalProblemProfile } from '../types/request-collection-plan.type';

/**
 * Adapts request-grounded search seeds to the retrieval semantics of each
 * source. The adaptation is generic (academic/community/editorial), never a
 * named business vertical.
 */
export class SourceSpecificEvidenceQueryUtil {
  private static readonly forbiddenInternalLabels = [
    /selected[- ]domain/iu,
    /evidence discovery/iu,
    /requester[- ]defined/iu,
    /validation lane/iu,
    /canonical problem/iu,
    /validation hypothesis/iu,
  ];

  static compile(input: {
    readonly sourceKey: string;
    readonly baseQueries: readonly string[];
    /** AI-generated dynamic problem-relation probes. Retrieval-only. */
    readonly causalQueries?: readonly string[];
    readonly requestDescription?: string | null;
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
    readonly discoveryDomainName?: string | null;
    readonly maxQueries?: number;
    readonly preserveBaseQueries?: boolean;
    /** Initial discovery keeps AI-planned facet diversity ahead of problem-axis rewrites. */
    readonly discoveryIntent?: boolean;
  }): string[] {
    const maxQueries = Math.max(1, Math.min(6, input.maxQueries ?? 3));
    const causal = this.unique(input.causalQueries ?? [])
      .map((query) => this.sanitize(query))
      .filter((query) => this.isSafe(query));
    const base = this.unique([...causal, ...input.baseQueries])
      .map((query) => this.sanitize(query))
      .filter((query) => this.isSafe(query));
    const sourceKey = input.sourceKey.trim().toLocaleLowerCase();
    const sourceNativeCausal = this.adaptCausalQueries(sourceKey, causal);

    const laneCandidates = sourceKey === 'crossref'
      ? this.buildAcademicQueries(input, base)
      : sourceKey === 'news' || sourceKey === 'gdelt' || sourceKey === 'blog'
        ? this.buildReportQueries(input, base)
        : sourceKey === 'reddit' || sourceKey === 'forum' || sourceKey === 'youtube' || sourceKey === 'hacker-news'
          ? this.buildCommunityPainQueries(input, base)
          : sourceKey === 'app-store' || sourceKey === 'google-play'
            ? this.buildReviewQueries(input, base)
            : sourceKey === 'github' || sourceKey === 'stackoverflow' || sourceKey === 'dev-to'
              ? this.buildTechnicalPainQueries(input, base)
              : base;
    /*
     * When an explicit canonical problem profile exists, start each tiny source
     * budget with a stable actor/object/workflow problem-axis formulation, then
     * interleave AI causal probes. AI probes remain in the plan, but malformed
     * relation fragments such as "... accurately because operational incident"
     * no longer consume the first/only source query.
     */
    const candidates = this.unique(
      input.problemProfile
        ? [...laneCandidates, ...sourceNativeCausal]
        : [...sourceNativeCausal, ...laneCandidates],
    );

    const preferProblemNativeProbe = Boolean(input.problemProfile) &&
      !input.discoveryIntent &&
      ['crossref', 'news', 'gdelt', 'blog', 'reddit', 'forum', 'youtube', 'hacker-news', 'app-store', 'google-play'].includes(sourceKey);
    const prioritizedCandidates = input.preserveBaseQueries
      ? this.interleavePreservingBase(
          candidates,
          base,
          input.discoveryIntent
            ? false
            : sourceNativeCausal.length > 0
              ? true
              : preferProblemNativeProbe,
        )
      : candidates;

    return this.unique(prioritizedCandidates)
      .map((query) => this.sanitize(query))
      .filter((query) => this.isSafe(query))
      .filter((query) => query.length >= 8 && query.length <= 180)
      .slice(0, maxQueries);
  }

  static isSafe(query: string): boolean {
    const normalized = this.sanitize(query);
    if (!normalized || normalized.length > 180) return false;
    if (this.forbiddenInternalLabels.some((pattern) => pattern.test(normalized))) {
      return false;
    }
    const tail = normalized.toLocaleLowerCase().split(/\s+/u).at(-1) ?? '';
    return !['and', 'or', 'about', 'with', 'for', 'to', 'of', 'in', 'on', 'by'].includes(tail);
  }

  private static adaptCausalQueries(
    sourceKey: string,
    causalQueries: readonly string[],
  ): string[] {
    if (causalQueries.length === 0) return [];

    return causalQueries.flatMap((query, index) => {
      const seed = this.compact(this.trimDanglingRelation(query), 12);
      if (!seed) return [];
      if (sourceKey === 'crossref') {
        return [
          this.join(seed, index % 2 === 0 ? 'study evidence' : 'operational research'),
        ];
      }
      if (['news', 'gdelt', 'blog'].includes(sourceKey)) {
        return [
          this.join(seed, index % 2 === 0 ? 'reported incident' : 'case report'),
        ];
      }
      if (['reddit', 'forum', 'youtube', 'hacker-news'].includes(sourceKey)) {
        return [
          this.join(seed, index % 2 === 0 ? 'operator experience' : 'practitioner complaint'),
        ];
      }
      if (['app-store', 'google-play'].includes(sourceKey)) {
        return [this.join(seed, 'user review')];
      }
      return [seed];
    });
  }

  private static buildAcademicQueries(
    input: {
      readonly problemProfile?: RequestCanonicalProblemProfile | null;
      readonly discoveryDomainName?: string | null;
      readonly preserveBaseQueries?: boolean;
    },
    baseQueries: readonly string[],
  ): string[] {
    const profile = input.problemProfile;
    if (!profile) {
      const domain = this.compact(input.discoveryDomainName ?? '', 3);
      const adaptedBase = baseQueries.map((query, index) => {
        const seed = this.compact(query, 12);
        if (index % 3 === 0) return this.join(seed, 'study research');
        if (index % 3 === 1) return this.join(seed, 'failure risk analysis');
        return this.join(seed, 'operational challenges evidence');
      });
      return domain
        ? [
            ...adaptedBase,
            this.join(domain, 'operational failures barriers study'),
            this.join(domain, 'risk delays breakdown research'),
            ...baseQueries,
          ]
        : [...adaptedBase, ...baseQueries];
    }

    const identity = this.join(
      this.compact(profile.actor, 3),
      this.compact(profile.object, 3),
    );
    const alternateIdentity = this.join(
      this.compact(profile.actorAliases?.[0] ?? profile.actor, 3),
      this.compact(profile.objectAliases?.[0] ?? profile.object, 3),
    );
    const workflow = this.compact(profile.workflow, 4);
    const failures = [
      profile.friction ?? '',
      ...profile.failureModes,
      ...profile.consequences,
    ]
      .map((value) => this.compact(value, 4))
      .filter(Boolean);
    const compactObject = this.compact(profile.object, 4);
    const compactFailure = failures[0] ?? this.compact(profile.coreProblem, 4);
    const profileQueries = [
      ...this.buildProblemAxisProbes(profile, 'ACADEMIC'),
      this.join(compactObject, workflow, 'study'),
      this.join(compactObject, compactFailure, 'operational bottleneck research'),
      this.join(this.compact(profile.actor, 3), compactFailure, 'workflow challenge'),
      this.join(alternateIdentity, failures[1] ?? compactFailure, 'study'),
      this.join(compactObject, this.compact(profile.consequences[0] ?? '', 3), 'service delay'),
      this.join(identity, workflow, 'challenges'),
    ];

    // Crossref lexical search is especially sensitive to ambiguous isolated
    // words such as "runtime" and "soap". Prefixing every retained AI query
    // with request-native identity terms keeps those words in the correct
    // sense without a domain-specific dictionary.
    const groundedBase = baseQueries.map((query) =>
      this.join(identity, this.compact(query, 6)),
    );

    return input.preserveBaseQueries
      ? [...profileQueries, ...groundedBase, ...baseQueries]
      : [...profileQueries, ...groundedBase];
  }

  private static buildReportQueries(
    input: {
      readonly problemProfile?: RequestCanonicalProblemProfile | null;
      readonly discoveryDomainName?: string | null;
    },
    baseQueries: readonly string[],
  ): string[] {
    const profile = input.problemProfile;
    if (!profile) {
      const domain = this.compact(input.discoveryDomainName ?? '', 3);
      const adaptedBase = baseQueries.map((query, index) => {
        const seed = this.compact(query, 12);
        if (index % 3 === 0) return this.join(seed, 'reported incident');
        if (index % 3 === 1) return this.join(seed, 'affected users case');
        return this.join(seed, 'failure disruption report');
      });
      return domain
        ? [
            ...adaptedBase,
            this.join(domain, 'operational failure affected users'),
            this.join(domain, 'recurring disruption incident report'),
            ...baseQueries,
          ]
        : [...adaptedBase, ...baseQueries];
    }
    const identity = this.join(
      this.compact(profile.actor, 3),
      this.compact(profile.object, 3),
      this.compact(input.discoveryDomainName ?? '', 2),
    );
    const failure = this.compact(
      profile.friction ?? profile.failureModes[0] ?? profile.coreProblem,
      4,
    );
    const consequence = this.compact(profile.consequences[0] ?? '', 4);
    const object = this.compact(profile.object, 4);
    const shortWorkflow = this.compact(profile.workflow, 4);
    return [
      ...this.buildProblemAxisProbes(profile, 'REPORT'),
      this.join(object, failure, 'reported problem'),
      this.join(shortWorkflow, failure, 'delay bottleneck'),
      this.join(object, consequence, 'service delay'),
      this.join(this.compact(profile.actor, 3), failure, 'case report'),
      this.join(identity, failure, 'reported incident'),
      this.join(object, shortWorkflow, 'operational challenge'),
      ...baseQueries.map((query) => this.join(object, this.compact(query, 6))),
      ...baseQueries,
    ];
  }

  /**
   * Community sources are strongest when the query resembles the language an
   * affected person would actually use.  These probes remain fully derived
   * from the requester-owned actor/object/workflow/failure axes; the added
   * terms only express pain/experience and never introduce a new domain or
   * solution.  This improves direct-evidence recall without weakening later
   * deterministic verification.
   */
  private static buildCommunityPainQueries(
    input: {
      readonly problemProfile?: RequestCanonicalProblemProfile | null;
      readonly discoveryDomainName?: string | null;
    },
    baseQueries: readonly string[],
  ): string[] {
    const profile = input.problemProfile;
    if (!profile) {
      const domain = this.compact(input.discoveryDomainName ?? '', 3);
      const adaptedBase = baseQueries.map((query, index) => {
        const seed = this.compact(query, 12);
        if (index % 4 === 0) return this.join(seed, 'user complaint');
        if (index % 4 === 1) return this.join(seed, 'struggling frustrating');
        if (index % 4 === 2) return this.join(seed, 'operator failure issue');
        return this.join(seed, 'real experience problem');
      });
      return domain
        ? [
            ...adaptedBase,
            this.join(domain, 'real user complaint operational failure'),
            ...baseQueries,
          ]
        : [...adaptedBase, ...baseQueries];
    }

    const actor = this.compact(profile.actor, 3);
    const alternateActor = this.compact(
      profile.actorAliases?.[0] ?? profile.actor,
      3,
    );
    const object = this.compact(
      [profile.object, ...(profile.objectAliases ?? []).slice(0, 1)].join(' '),
      4,
    );
    const workflow = this.compact(profile.workflow, 4);
    const failures = [
      profile.friction ?? '',
      ...profile.failureModes,
      ...profile.consequences,
    ].map((value) => this.compact(value, 4)).filter(Boolean);

    const primaryFailure = failures[0] ?? this.compact(profile.coreProblem, 4);
    const secondaryFailure = failures[1] ?? primaryFailure;
    const consequence = this.compact(profile.consequences[0] ?? '', 3);
    return [
      ...this.buildProblemAxisProbes(profile, 'COMMUNITY'),
      this.join(object, primaryFailure, 'problem'),
      this.join(actor, primaryFailure, 'complaint'),
      this.join(workflow, secondaryFailure, 'frustrating delay'),
      this.join(object, consequence, 'real experience'),
      this.join(alternateActor, secondaryFailure, 'workflow issue'),
      this.join(actor, object, primaryFailure, 'struggle'),
      ...baseQueries,
    ];
  }

  /**
   * Produces orthogonal request-native probes from the canonical actor/object/
   * workflow/failure/consequence axes. Search recall was previously dominated
   * by multiple lexical rewrites of the same AI seed. These probes deliberately
   * spend the small source budget on different problem facets instead. They are
   * retrieval-only and cannot promote a row into trusted evidence; Community AI
   * plus deterministic verification still own that decision.
   */
  private static buildProblemAxisProbes(
    profile: RequestCanonicalProblemProfile,
    lane: 'ACADEMIC' | 'REPORT' | 'COMMUNITY',
  ): string[] {
    const actor = this.compact(profile.actor, 3);
    const alternateActor = this.compact(
      profile.actorAliases?.[0] ?? profile.actor,
      3,
    );
    const object = this.compact(profile.object, 4);
    const alternateObject = this.compact(
      profile.objectAliases?.[0] ?? profile.object,
      4,
    );
    const workflow = this.compact(profile.workflow, 4);
    const primaryFailure = this.compact(
      profile.friction ?? profile.failureModes[0] ?? profile.coreProblem,
      4,
    );
    const secondaryFailure = this.compact(
      profile.failureModes[1] ?? profile.failureModes[0] ?? profile.coreProblem,
      4,
    );
    const consequence = this.compact(profile.consequences[0] ?? '', 3);

    /*
     * Tiny source budgets should test separate observable axes rather than one
     * synthetic actor+object+workflow+failure sentence. The source suffix is
     * intentionally short and documentary; it never changes the problem.
     */
    if (lane === 'ACADEMIC') {
      return [
        this.join(object, primaryFailure, 'study'),
        this.join(workflow, secondaryFailure, 'research'),
        this.join(actor || alternateActor, primaryFailure, 'study'),
        this.join(alternateObject || object, consequence, 'analysis'),
      ];
    }

    if (lane === 'REPORT') {
      return [
        this.join(object, primaryFailure, 'incident'),
        this.join(workflow, secondaryFailure, 'case'),
        this.join(actor || alternateActor, primaryFailure, 'report'),
        this.join(alternateObject || object, consequence, 'incident'),
      ];
    }

    return [
      this.join(actor || alternateActor, primaryFailure),
      this.join(object, primaryFailure),
      this.join(workflow, secondaryFailure),
      this.join(alternateObject || object, consequence || secondaryFailure),
    ];
  }

  /** App-store search benefits from product/workflow nouns plus failure terms. */
  private static buildReviewQueries(
    input: {
      readonly problemProfile?: RequestCanonicalProblemProfile | null;
      readonly discoveryDomainName?: string | null;
    },
    baseQueries: readonly string[],
  ): string[] {
    const profile = input.problemProfile;
    if (!profile) {
      const domain = this.compact(input.discoveryDomainName ?? '', 3);
      const adaptedBase = baseQueries.map((query, index) =>
        this.join(this.compact(query, 11), index % 2 === 0 ? 'review complaint' : 'users report problem'),
      );
      return domain
        ? [...adaptedBase, this.join(domain, 'app review complaint failure'), ...baseQueries]
        : [...adaptedBase, ...baseQueries];
    }
    const object = this.compact(profile.object, 4);
    const workflow = this.compact(profile.workflow, 4);
    const failure = this.compact(
      profile.friction ?? profile.failureModes[0] ?? profile.coreProblem,
      4,
    );
    return [
      this.join(object, workflow),
      this.join(object, failure),
      this.join(profile.actor, workflow, failure),
      ...baseQueries,
    ];
  }

  /** Developer sources should receive implementation-failure wording only when
   * the requester problem itself contains a technical workflow. */
  private static buildTechnicalPainQueries(
    input: {
      readonly requestDescription?: string | null;
      readonly problemProfile?: RequestCanonicalProblemProfile | null;
    },
    baseQueries: readonly string[],
  ): string[] {
    const description = this.sanitize(input.requestDescription ?? '').toLocaleLowerCase();
    const technical = /\b(?:api|sdk|database|runtime|deployment|endpoint|integration|webhook|code|developer|software|server|client|authentication|network|model|inference)\b/u.test(description);
    if (!technical || !input.problemProfile) return [...baseQueries];
    const profile = input.problemProfile;
    const failure = this.compact(
      profile.friction ?? profile.failureModes[0] ?? profile.coreProblem,
      5,
    );
    return [
      this.join(profile.object, profile.workflow, failure),
      this.join(profile.workflow, failure, 'error'),
      ...baseQueries,
    ];
  }

  private static interleavePreservingBase(
    candidates: readonly string[],
    baseQueries: readonly string[],
    preferAdaptedFirst = false,
  ): string[] {
    const safeBase = this.unique(baseQueries);
    const adapted = this.unique(candidates).filter(
      (candidate) =>
        !safeBase.some(
          (base) =>
            this.sanitize(base).toLocaleLowerCase() ===
            this.sanitize(candidate).toLocaleLowerCase(),
        ),
    );

    /*
     * The planner's base queries carry the highest-fidelity semantic intent.
     * A small source query budget must therefore never be consumed entirely by
     * source-native rewrites. Interleave from the original seed first so a
     * maxQueries=2/3 plan still preserves atomic problem tokens, then add one
     * source-native formulation for recall. This is generic across domains and
     * avoids the old regression where good AI queries were replaced by broad
     * phrases such as "users struggle problem".
     */
    const interleaved: string[] = [];
    if (preferAdaptedFirst) {
      /*
       * Explicit-problem source plans have only 2-5 query slots. Spend two of
       * every three slots on source-native problem-axis formulations and one on
       * the original AI seed. This preserves AI intent while preventing a
       * truncated/telegraphic AI phrase from occupying half of a tiny source
       * budget before the stable requester-derived probes are tried.
       */
      let adaptedIndex = 0;
      let baseIndex = 0;
      while (adaptedIndex < adapted.length || baseIndex < safeBase.length) {
        if (adapted[adaptedIndex]) interleaved.push(adapted[adaptedIndex++]!);
        if (adapted[adaptedIndex]) interleaved.push(adapted[adaptedIndex++]!);
        if (safeBase[baseIndex]) interleaved.push(safeBase[baseIndex++]!);
      }
      return interleaved;
    }

    const width = Math.max(safeBase.length, adapted.length);
    for (let index = 0; index < width; index += 1) {
      if (safeBase[index]) interleaved.push(safeBase[index]!);
      if (adapted[index]) interleaved.push(adapted[index]!);
    }
    return interleaved;
  }

  private static trimDanglingRelation(value: string): string {
    return this.sanitize(value)
      .replace(
        /\b(?:because(?: of)?|due(?: to)?|caused by|resulting from|leading to)\s*$/iu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static compact(value: string, maxWords: number): string {
    const stop = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'from',
      'often', 'frequently', 'usually', 'commonly', 'making', 'difficult',
      'difficulty',
      'smarter', 'smart', 'platform', 'system', 'solution', 'could',
      'because', 'due',
    ]);
    return this.sanitize(value)
      .replace(/[,:;()\[\]{}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length >= 2 && !stop.has(word.toLocaleLowerCase()))
      .slice(0, maxWords)
      .join(' ');
  }

  private static join(...values: Array<string | null | undefined>): string {
    const combined = this.sanitize(values.filter(Boolean).join(' '));
    if (!combined) return '';

    /*
     * AI/profile fragments often repeat the same domain or actor token at the
     * boundary between components ("delivery ... Delivery ...", "jewelry ...
     * Jewelry ..."). Search engines treat those repeats as wasted query budget.
     * Collapse exact repeated tokens while preserving the original order and all
     * distinct atomic workflow terms.
     */
    const seen = new Set<string>();
    return combined
      .split(/\s+/u)
      .filter((token) => {
        const key = token.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(' ');
  }

  private static sanitize(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[\r\n\t]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .replace(/^[\s|,:;.-]+|[\s|,:;.-]+$/gu, '')
      .replace(/(?:\s+\b(?:and|or|about|with|for|to|of|in|on|by|because|due)\b\s*)+$/iu, '')
      .trim();
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const raw of values) {
      const value = this.sanitize(raw);
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }
    return output;
  }
}
