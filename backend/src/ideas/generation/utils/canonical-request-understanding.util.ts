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
      /\b(?:scattered|fragmented|disconnected|separate platforms?|separate systems?|managed through separate|monitored through separate|stored across|tracked across)\b/iu.test(sentence),
    ) ?? sentences.find((sentence) =>
      /\b(?:records?|logs?|telemetry|status|activity|alerts?|notes?|messages?|sketches?|samples?|reports?|capacity|availability|measurements?|specifications?|revisions?|approvals?|platforms?|systems?)\b/iu.test(sentence),
    ) ?? sentences[1] ?? coreProblem;
    const workflow = this.cleanPhrase(
      workflowSentence
        .replace(/\s*,?\s*(?:making|which makes|so)\s+it\s+difficult\b.*$/iu, '')
        .replace(/\s*,?\s*making\s+it\s+difficult\b.*$/iu, ''),
      240,
    );

    const friction = this.cleanPhrase(
      normalized.match(
        /\b(?:making\s+it\s+difficult\s+to|difficult\s+to|hard\s+to|unable\s+to|cannot\s+|can't\s+)([^.!?]{5,240})/iu,
      )?.[1] ?? coreProblem,
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

    const candidates = [
      this.compose(actors[0], objects[0], facets[0]),
      this.compose(actors[1] ?? actors[0], objects[1] ?? objects[0], consequences[0]),
      this.compose(actors[2] ?? actors[0], workflow, consequences[1] ?? consequences[0]),
      this.compose(actors[1] ?? actors[0], objects[2] ?? objects[0], consequences[2] ?? facets[0]),
      this.compose(actors[3] ?? actors[0], objects[3] ?? objects[0], facets[0]),
      this.compose(actors[0], objects[1] ?? objects[0], consequences[3] ?? consequences[0]),
      this.compose(actors[4] ?? actors[0], objects[2] ?? objects[0], consequences[4] ?? facets[0]),
      this.compose(actors[2] ?? actors[0], objects[3] ?? objects[0], consequences[0]),
    ];

    return this.unique(candidates)
      .map((query) => this.normalizeQuery(query))
      .filter((query) => query.split(/\s+/u).length >= 3)
      .slice(0, maxQueries);
  }


  static buildRecoveryQueries(
    profile: RequestCanonicalProblemProfile,
    previousQueries: readonly string[],
    maxQueries = 6,
  ): string[] {
    const previous = new Set(previousQueries.map((value) => this.normalize(value).toLocaleLowerCase()));
    const aliases = this.unique([
      ...(profile.actorAliases ?? []),
      profile.actor,
    ]).reverse();
    const objects = this.unique([
      ...(profile.objectAliases ?? []),
      profile.object,
    ]).reverse();
    const facets = this.unique([
      ...(profile.evidenceFacets ?? []),
      ...profile.failureModes,
      ...profile.consequences,
    ]).reverse();

    const candidates: string[] = [];
    for (let index = 0; index < Math.max(aliases.length, objects.length, facets.length); index += 1) {
      candidates.push(
        this.compose(
          aliases[index % Math.max(1, aliases.length)] ?? profile.actor,
          objects[index % Math.max(1, objects.length)] ?? profile.object,
          facets[index % Math.max(1, facets.length)] ?? profile.coreProblem,
        ),
      );
    }

    return this.unique(candidates)
      .map((query) => this.normalizeQuery(query))
      .filter((query) => !previous.has(query.toLocaleLowerCase()))
      .slice(0, maxQueries);
  }

  static recommendSourceKeys(
    description: string,
    activeSourceKeys: readonly string[],
    maxSources = 4,
  ): string[] {
    const text = this.normalize(description).toLocaleLowerCase();
    const available = new Set(activeSourceKeys.map((key) => key.toLocaleLowerCase()));
    const technical = /\b(?:api|sdk|repository|github|source code|software|server|database|webhook|endpoint|firmware|developer|runtime|authentication protocol)\b/u.test(text);
    const publicInstitutional = /\b(?:government|public sector|public authorit|public agenc|municipal|hospital|healthcare network|utility|utilities|energy authorit|transit authorit|regulator)\w*\b/u.test(text);
    const customService = /\b(?:custom|bespoke|customer requests?|client requests?|commission|makers?|artisans?|crafts?|workshop|bookbinder|tailor|seamstress|restoration specialist)\w*\b/u.test(text);

    const priority = technical
      ? ['github', 'stackoverflow', 'reddit', 'forum', 'hacker-news', 'news']
      : customService
        ? ['reddit', 'forum', 'blog', 'youtube', 'news', 'crossref']
        : publicInstitutional
          ? ['news', 'crossref', 'reddit', 'forum', 'blog', 'gdelt']
          : ['reddit', 'forum', 'news', 'crossref', 'blog', 'youtube'];

    return priority.filter((key) => available.has(key)).slice(0, maxSources);
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
      'user complaints recurring failures',
      'workflow bottlenecks delays rework',
      'operational cost waste shortages',
      'service disruption downtime recurring issues',
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

  private static resolveObject(firstSentence: string, full: string, actor: string): string {
    const matched = firstSentence.match(
      /\b(?:manage|protect|track|document|coordinate|monitor|control|optimise|optimize|reduce|balance|handle|verify|assess|inspect|diagnose|organize|organise|maintain|respond to)\w*\s+([^.!?]{5,220})/iu,
    )?.[1];
    let object = this.cleanPhrase(matched ?? '', 180)
      .replace(/\s+while\s+(?:maintaining|preserving|keeping|balancing)\b.*$/iu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (/\bcustomer requests? involving\b/iu.test(object) && /\bapproved specifications?\b/iu.test(full)) {
      object = 'customer requests and final approved specifications';
    }
    if (!object) {
      const workflowObject = full.match(
        /\b(?:records?|logs?|telemetry|status|activity|alerts?|notes?|messages?|sketches?|samples?|reports?|measurements?|specifications?)\b[^.!?]{0,150}/iu,
      )?.[0];
      object = this.cleanPhrase(workflowObject ?? actor, 180);
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
        if (match[1]) values.push(this.cleanPhrase(match[1], 180));
      }
    }
    return this.unique(values).slice(0, 5);
  }

  private static buildActorAliases(actor: string, object: string): string[] {
    const aliases = [actor];
    const stripped = actor
      .replace(/\b(?:independent|public|urban|local|small|private|specialist|professional)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (stripped && stripped.toLocaleLowerCase() !== actor.toLocaleLowerCase()) aliases.push(stripped);

    if (/\bmakers?\b/iu.test(actor)) {
      const subject = stripped.replace(/\bmakers?\b/iu, '').trim();
      if (subject) {
        aliases.push(
          `${subject} artisans`,
          `${subject} craftspeople`,
          `${subject} studio`,
          `custom ${subject} maker`,
        );
      }
      aliases.push('custom makers', 'independent artisans');
    }
    if (/\b(?:technology providers?|platform providers?|software providers?)\b/iu.test(actor)) {
      aliases.push('platform operators', 'software operators', 'system administrators');
    }
    if (/\b(?:agricultur|farm|agritech)\w*\b/iu.test(`${actor} ${object}`)) {
      aliases.push('agritech providers', 'farm management software providers', 'smart farming platform operators');
    }
    if (/\b(?:authorities|agencies|departments|regulators)\b/iu.test(actor)) {
      aliases.push('public operators', 'public infrastructure operators');
      if (/\b(?:energy|electric|power|utility)\b/iu.test(`${actor} ${object}`)) {
        aliases.push('electric utilities', 'power utility operators');
      }
    }
    if (/\bnetworks?\b/iu.test(actor)) aliases.push('service networks', 'service operators');

    return this.unique(aliases).slice(0, 6);
  }

  private static buildObjectAliases(object: string, description: string): string[] {
    const aliases = [object];
    if (/\bcustomer requests?|client requests?|approved specifications?|custom orders?\b/iu.test(`${object} ${description}`)) {
      aliases.push('custom orders', 'order specifications', 'customer specifications', 'revision approvals');
    }
    if (/\bdigital infrastructure|operational systems?|equipment status|security alerts?\b/iu.test(`${object} ${description}`)) {
      aliases.push('operational technology systems', 'equipment and access logs', 'security and equipment events');
      if (/\b(?:energy|electric|power|utility|grid)\w*\b/iu.test(description)) {
        aliases.push('utility operational telemetry');
      }
      if (/\b(?:agricultur|farm|agritech|crop)\w*\b/iu.test(description)) {
        aliases.push('farm management software', 'agricultural IoT telemetry', 'smart farming platform logs');
      }
    }
    if (/\b(?:customer requests?|client requests?|custom orders?|personalization|revision requests?|final approved design|approved specifications?)\b/iu.test(`${object} ${description}`)) {
      aliases.push('custom order specifications', 'design approval workflow', 'revision history', 'customer design requirements');
    }
    if (/\bcapacity|ambulance|patient demand|emergency departments?\b/iu.test(`${object} ${description}`)) {
      aliases.push('patient demand and facility capacity', 'emergency capacity coordination');
    }
    return this.unique(aliases).slice(0, 6);
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
    return this.normalize(value)
      .replace(/^[,;:\-\s]+|[,;:\-\s]+$/gu, '')
      .slice(0, maxLength)
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
