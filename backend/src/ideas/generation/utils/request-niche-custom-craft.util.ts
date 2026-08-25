import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';

export type NicheCustomCraftKind =
  | 'WATCH_STRAP'
  | 'VIOLIN_BOW_COMMISSION'
  | 'BOOKBINDING_COMMISSION'
  | 'FOUNTAIN_PEN_COMMISSION'
  | 'GENERIC_CUSTOM_CRAFT';

export type NicheCustomCraftProfile = {
  readonly kind: NicheCustomCraftKind;
  readonly label: string;
  readonly directIdentityTerms: readonly string[];
  readonly adjacentIdentityTerms: readonly string[];
  readonly workflowTerms: readonly string[];
  readonly painTerms: readonly string[];
  readonly preferredForumDomains: readonly string[];
  readonly preferredSubreddits: readonly string[];
  readonly suggestedDomainName: string | null;
};

/**
 * Request-derived retrieval contract for sparse custom-craft / bespoke-work
 * niches.  The profile is deliberately about workflow structure rather than a
 * single profession so new craft requests can reuse the same Direct vs
 * Supporting evidence semantics without inventing demand.
 */
export class RequestNicheCustomCraftUtil {
  static resolve(requestDescription?: string | null): NicheCustomCraftProfile | null {
    const request = this.normalize(requestDescription ?? '');
    if (!request) return null;

    if (this.isWatchStrapRequest(request)) {
      return {
        kind: 'WATCH_STRAP',
        label: 'custom watch strap specification sizing and approval operations',
        directIdentityTerms: [
          'watch strap',
          'watch band',
          'leather watch strap',
          'leather watch band',
          'bespoke watch strap',
          'custom watch strap',
          'watch strap maker',
          'watch band maker',
        ],
        adjacentIdentityTerms: [
          'leathercraft',
          'leather worker',
          'leatherworker',
          'leather artisan',
          'custom leather',
          'bespoke leather',
          'leather goods maker',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: ['watchuseek.com', 'leatherworker.net'],
        preferredSubreddits: ['leathercraft', 'watches', 'watchmaking'],
        suggestedDomainName: 'Custom Watch Strap Commission & Specification Management',
      };
    }

    if (this.isFountainPenCommissionRequest(request)) {
      return {
        kind: 'FOUNTAIN_PEN_COMMISSION',
        label: 'custom fountain pen commission specification and approval operations',
        directIdentityTerms: [
          'fountain pen maker',
          'fountain pen makers',
          'custom fountain pen',
          'bespoke fountain pen',
          'pen maker',
          'pen makers',
          'penmaking',
        ],
        adjacentIdentityTerms: [
          'custom pen maker',
          'pen turner',
          'penturner',
          'writing instrument maker',
          'custom maker',
          'artisan',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: ['fountainpennetwork.com', 'fpgeeks.com'],
        preferredSubreddits: ['fountainpens', 'turning', 'crafts'],
        suggestedDomainName: 'Custom Fountain Pen Making',
      };
    }

    if (this.isViolinBowCommissionRequest(request)) {
      return {
        kind: 'VIOLIN_BOW_COMMISSION',
        label: 'custom violin bow commission specification and approval operations',
        directIdentityTerms: [
          'violin bow',
          'violin bow maker',
          'bow maker',
          'archetier',
          'bespoke bow',
          'custom bow',
          'bow making',
        ],
        adjacentIdentityTerms: [
          'luthier',
          'violin maker',
          'instrument maker',
          'custom instrument maker',
          'bespoke instrument',
          'musical instrument maker',
          'string instrument maker',
          'bow workshop',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: ['maestronet.com', 'violinist.com'],
        preferredSubreddits: ['violinist', 'luthier', 'violinmaking'],
        suggestedDomainName: 'Custom Violin Bow Commission & Specification Management',
      };
    }


    if (
      /\b(?:independent bookbinders?|custom bookbinders?|bookbinding artisans?|bookbinding studios?|book binders?)\b/u.test(request) &&
      /\b(?:customer specifications?|book dimensions?|paper types?|cover materials?|binding styles?|decorative details?|personalization requests?|custom orders?|commissions?|approved version|completion deadlines?|customer messages?|physical samples?|handwritten notes?)\b/u.test(request) &&
      !/\b(?:restoration|conservation|previous repairs?|torn pages?|missing sections?|treatment history|repair history)\b/u.test(request)
    ) {
      return {
        kind: 'BOOKBINDING_COMMISSION',
        label: 'custom bookbinding commission specification and approval operations',
        directIdentityTerms: [
          'bookbinder',
          'bookbinders',
          'custom bookbinder',
          'independent bookbinder',
          'bookbinding studio',
          'bookbinding artisan',
          'custom bookbinding',
        ],
        adjacentIdentityTerms: [
          'book artist',
          'paper artisan',
          'printmaker',
          'custom stationery maker',
          'artisan workshop',
          'custom maker',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: [],
        preferredSubreddits: ['bookbinding', 'crafts'],
        suggestedDomainName: 'Custom Bookbinding',
      };
    }

    const workflow = RequestWorkflowIntentProfileUtil.resolve(requestDescription);
    if (
      (workflow.family !== 'CUSTOM_COMMISSION' &&
        workflow.family !== 'SPECIFICATION_APPROVAL') ||
      workflow.failureAxisCount < 1 ||
      workflow.workflowAxisCount < 1
    ) {
      return null;
    }

    const directTerms = this.unique([
      ...this.extractCraftIdentityPhrases(request),
      ...workflow.actorIdentityTerms,
      ...workflow.objectIdentityTerms,
    ])
      .filter((value) => value.length >= 4)
      .filter((value) => !/^(?:information|data|records?|notes?|workflow|problem|often struggle|usually scattered|scattered across)\b/u.test(value))
      /*
       * Object/workflow nouns such as "artwork", "dimensions", or
       * "specification" are not profession identity. Keeping a single
       * generic object token here previously let artwork/revision material
       * masquerade as direct Neon evidence. Retain either an explicit maker/
       * studio identity phrase or at least two meaningful identity tokens.
       */
      .filter((value) =>
        /\b(?:makers?|artisans?|artists?|studios?|workshops?|specialists?|shops?)\b/u.test(value) ||
        this.semanticIdentityTokens(value).size >= 2,
      )
      .slice(0, 12);

    if (directTerms.length === 0) return null;

    const leatherCraft = /\b(?:leather|saddle|tack|harness|bridle|strap|belt|boot|shoe)\b/u.test(request);
    const dollCraft = /\b(?:doll makers?|doll artists?|custom dolls?|handmade dolls?|art dolls?|ooak dolls?|one of a kind dolls?|bjd|ball jointed dolls?)\b/u.test(request);
    const puppetCraft = /\b(?:puppet makers?|puppet builders?|puppetry artists?|custom puppets?|marionette makers?|marionettes?|character fabricators?|creature makers?|prop makers?)\b/u.test(request);
    const miniatureCraft = /\b(?:miniature makers?|miniature artists?|dollhouse makers?|doll house makers?|model makers?|custom figures?)\b/u.test(request);
    const textileCraft = /\b(?:embroidery|embroiderers?|textile artists?|seamstresses?|dressmakers?|soft sculpture|plush makers?|toy makers?)\b/u.test(request);
    const fabricationCraft = /\b(?:fabricat(?:e|ed|es|ing|ion)|installation|mounting|electrical specification|tubing|bending|welding|cutting|sign makers?|custom signs?|metalwork|glasswork|glass bending|lighting fabrication)\b/u.test(request);
    const dynamicAdjacentIdentities = this.unique([
      ...(leatherCraft
        ? ['leatherworker', 'leather worker', 'leathercraft', 'leather artisan', 'custom leather', 'tack maker']
        : []),
      ...(dollCraft
        ? [
            'ooak artist',
            'one of a kind doll artist',
            'art doll maker',
            'custom doll artist',
            'bjd customizer',
            'ball jointed doll artist',
            'custom toy maker',
            'bespoke toy maker',
            'custom figure maker',
            'figure artist',
            'soft sculpture artist',
            'commission artist',
          ]
        : []),
      ...(puppetCraft
        ? ['puppet builder', 'puppetry artist', 'marionette maker', 'character fabricator', 'creature maker', 'prop maker', 'custom toy maker', 'custom figure maker', 'commission artist']
        : []),
      ...(miniatureCraft
        ? ['miniature artist', 'miniature maker', 'model maker', 'custom figure maker', 'commission artist']
        : []),
      ...(textileCraft
        ? ['textile artist', 'soft sculpture artist', 'custom toy maker', 'commission artist']
        : []),
      ...(fabricationCraft
        ? ['custom fabricator', 'fabrication shop', 'custom sign maker', 'sign fabricator', 'glass fabricator', 'metal fabricator', 'commission fabricator']
        : []),
    ]);
    return {
      kind: 'GENERIC_CUSTOM_CRAFT',
      label: 'niche custom craft commission specification and approval operations',
      directIdentityTerms: directTerms,
      adjacentIdentityTerms: this.unique([
        ...dynamicAdjacentIdentities,
        'custom maker',
        'artisan',
        'craft workshop',
        'bespoke maker',
        'custom order',
        'commissioned work',
        'made to order',
        'small workshop',
        'commission artist',
      ]),
      workflowTerms: this.unique([
        ...workflow.workflowIdentityTerms,
        ...workflow.objectIdentityTerms,
        ...this.resolveWorkflowTerms(request),
      ]).slice(0, 16),
      painTerms: this.unique([
        ...workflow.failureIdentityTerms,
        ...workflow.outcomeIdentityTerms,
        ...this.resolvePainTerms(request),
      ]).slice(0, 14),
      preferredForumDomains: this.unique([
        ...(leatherCraft ? ['leatherworker.net'] : []),
        ...(dollCraft ? ['denofangels.com'] : []),
      ]),
      preferredSubreddits: this.unique([
        ...(leatherCraft ? ['leathercraft'] : []),
        ...(dollCraft ? ['dolls', 'bjd', 'crafts'] : []),
        ...(puppetCraft ? ['puppetry', 'crafts'] : []),
        ...(miniatureCraft ? ['miniatures', 'crafts'] : []),
        ...(textileCraft ? ['crafts'] : []),
        ...(fabricationCraft ? ['crafts', 'metalworking', 'glassblowing'] : []),
      ]),
      suggestedDomainName: null,
    };
  }

  static isDirectEvidence(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    const profile = this.resolve(requestDescription);
    if (!profile) return false;
    const evidence = this.normalize(evidenceText);
    if (!evidence || this.hasTechnicalCollision(evidence)) return false;

    const identity = this.hasDirectIdentity(profile, evidence);
    const workflow = this.hasWorkflowFacet(profile, evidence);
    const pain = this.hasPainFacet(profile, evidence);
    const specificationContract =
      profile.kind !== 'GENERIC_CUSTOM_CRAFT' ||
      this.hasCustomerSpecificationWorkflowContract(evidence);
    return identity && workflow && pain && specificationContract;
  }

  static isSupportingEvidence(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    const profile = this.resolve(requestDescription);
    if (!profile) return false;
    const evidence = this.normalize(evidenceText);
    if (!evidence || this.hasTechnicalCollision(evidence)) return false;
    if (this.isDirectEvidence(requestDescription, evidenceText)) return true;

    const adjacent = this.hasAdjacentCraftIdentity(profile, evidence);
    const workflow = this.hasWorkflowFacet(profile, evidence);
    const customerSpecificationWorkflow =
      this.hasCustomerSpecificationWorkflowContract(evidence);
    const pain = this.hasPainFacet(profile, evidence);
    /*
     * Supporting custom-craft evidence must still describe the commission /
     * customer-specification workflow. Material/design overlap plus a generic
     * waste complaint is not enough (for example a leather template discussion
     * cannot become evidence for customer waist-measurement management).
     */
    return adjacent && workflow && customerSpecificationWorkflow && pain;
  }

  static isPlausibleRetrievalCandidate(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    const profile = this.resolve(requestDescription);
    if (!profile) return false;
    const evidence = this.normalize(evidenceText);
    if (!evidence || evidence.length < 20 || this.hasTechnicalCollision(evidence)) return false;

    const direct = this.hasDirectIdentity(profile, evidence) && this.hasWorkflowFacet(profile, evidence);
    const supporting =
      this.hasAdjacentCraftIdentity(profile, evidence) &&
      this.hasWorkflowFacet(profile, evidence) &&
      this.hasCustomerSpecificationWorkflowContract(evidence) &&
      this.hasPainFacet(profile, evidence);
    return direct || supporting;
  }

  static isSafeExpandedRetrievalQuery(
    requestDescription: string | null | undefined,
    queryText: string,
  ): boolean {
    const profile = this.resolve(requestDescription);
    if (!profile || profile.kind !== 'GENERIC_CUSTOM_CRAFT') return false;
    const query = this.normalize(queryText);
    if (!query || this.hasTechnicalCollision(query)) return false;

    const directIdentity = this.hasDirectIdentity(profile, query);
    const adjacentIdentity = this.hasAdjacentCraftIdentity(profile, query);
    const workflow = this.hasWorkflowFacet(profile, query);
    const customerSpecificationWorkflow =
      this.hasCustomerSpecificationWorkflowContract(query);
    const pain = this.hasPainFacet(profile, query);

    // Direct niche queries need the workflow axis; adjacent-niche expansion is
    // Supporting-only and must retain an actual customer/commission/specification
    // contract plus pain. Generic craft/material waste queries are not enough.
    return (directIdentity && workflow) ||
      (adjacentIdentity && workflow && customerSpecificationWorkflow && pain);
  }

  static buildSourceQueries(
    requestDescription: string | null | undefined,
    sourceKey: string,
  ): string[] {
    const profile = this.resolve(requestDescription);
    if (!profile) return [];
    const source = this.normalize(sourceKey);

    if (profile.kind === 'WATCH_STRAP') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'custom watch strap wrong size wrist measurement remake',
          'watch band lug width strap length sizing mistake',
          'leather watch strap customer changed design revision',
          'watch strap wrong leather order customer approval',
          'bespoke strap measurement mistake repeated adjustment',
          'leathercraft custom order measurement material revision remake',
        ];
      }
      if (source === 'crossref') {
        return [
          'watch strap wrist measurement sizing custom leather',
          'watch band anthropometry fit sizing wrist measurement',
          'leather watch strap custom fit material selection',
          'watch strap design customization fit dimensions',
        ];
      }
      return [
        'custom watch strap sizing measurement leather remake',
        'bespoke watch strap material selection customer revision',
        'watch band custom order wrong size rework',
      ];
    }

    if (profile.kind === 'FOUNTAIN_PEN_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'custom fountain pen nib size order mistake',
          'fountain pen maker customer specification wrong components',
          'bespoke fountain pen engraving revision approval',
          'custom pen grip dimensions sizing problem',
          'fountain pen body material color customer revision',
          'custom fountain pen delayed commission material mistake',
          'fountain pen maker filling mechanism customer order',
          'custom pen commission scattered customer messages revisions',
        ];
      }
      if (source === 'crossref') {
        return [
          'fountain pen ergonomics grip dimensions nib size',
          'fountain pen filling mechanism design material',
          'custom writing instrument ergonomics dimensions materials',
          'fountain pen nib design writing performance ergonomics',
        ];
      }
      return [
        'custom fountain pen order specifications nib size',
        'fountain pen maker engraving revision customer approval',
        'bespoke pen body material color combination order',
        'custom fountain pen sizing mistakes delayed commission',
      ];
    }

    if (profile.kind === 'BOOKBINDING_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'bookbinder custom order incorrect materials sizing mistakes',
          'custom bookbinding customer specifications missed customization details',
          'bookbinding commission dimensions paper cover binding styles',
          'bookbinder customer approval final version revisions',
          'custom book order handwritten notes customer messages',
          'bookbinding wasted supplies sizing mistakes delayed commissions',
        ];
      }
      if (source === 'crossref') {
        return [
          'custom bookbinding specifications dimensions materials binding styles',
          'bookbinding paper types cover materials binding styles',
          'bookbinding personalization customization details sizing mistakes',
          'custom book customer specifications approved version',
        ];
      }
      return [
        'custom bookbinding customer specifications incorrect materials',
        'bookbinder customer requests approved version revisions',
        'bookbinding commission sizing mistakes delayed completion',
        'custom book dimensions materials personalization requests',
      ];
    }

    if (profile.kind === 'VIOLIN_BOW_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'violin bow maker wrong balance customer measurement custom commission',
          'custom violin bow wood selection customer revision remake',
          'archetier bow commission player preference balance adjustment',
          'bespoke violin bow hair grip material customer approval problem',
          'luthier custom instrument customer specification revision rework',
          'custom instrument maker material selection client approval remake',
          'bow maker commission scattered notes customer specification',
        ];
      }
      if (source === 'crossref') {
        return [
          'violin bow making balance player preference wood hair',
          'violin bow ergonomics balance weight player preference',
          'bow making material selection pernambuco hair balance',
          'custom musical instrument making client specification material selection',
        ];
      }
      if (source === 'youtube' || source === 'blog') {
        return [
          'violin bow maker custom commission balance wood hair customer specification',
          'archetier bow making customer preference balance adjustment',
          'custom violin bow material selection revision remake',
          'luthier custom instrument commission specification rework',
        ];
      }
      return [
        'custom violin bow commission material selection balance adjustment',
        'violin bow maker customer specification revision delayed commission',
        'bespoke bow wrong balance material rework customer approval',
      ];
    }

    const actor = profile.directIdentityTerms[0] ?? 'custom maker';
    const object = profile.directIdentityTerms.find((term) =>
      term !== actor && !/^(?:information|data|records?|notes?|workflow|problem|scattered)\b/iu.test(term),
    ) ?? actor;
    const adjacent = profile.adjacentIdentityTerms[0] ?? 'artisan';
    const adjacent2 = profile.adjacentIdentityTerms[1] ?? 'custom maker';
    const adjacent3 = profile.adjacentIdentityTerms[2] ?? 'commission artist';
    const workflow = profile.workflowTerms[0] ?? 'customer specification';
    const workflow2 = profile.workflowTerms[1] ?? 'material selection';
    const pain = profile.painTerms[0] ?? 'rework';
    const pain2 = profile.painTerms[1] ?? 'wrong specification';

    if (source === 'reddit' || source === 'forum') {
      return this.unique([
        // Exact-niche lane first. Every exact query retains the actor identity
        // so sparse trade searches do not collapse into generic artwork/revision noise.
        `${actor} ${pain}`,
        `${actor} customer revision approval rework`,
        `${actor} measurement material selection remake`,
        `${actor} final approval wrong version wasted material`,
        // Adjacent-workflow lane is Supporting-only and starts after exact queries.
        `${adjacent} custom order measurements material selection revisions approval rework`,
        `${adjacent2} customer reference dimensions revision approval remake`,
        `${adjacent3} custom commission material selection missed detail rework deadline`,
        `custom fabrication commission ${workflow2} customer revision ${pain2}`,
      ]);
    }

    return this.unique([
      `${actor} ${pain}`,
      `${actor} customer revision approval rework`,
      `${actor} custom commission specification mistake remake`,
      `${actor} final approval wrong version wasted material`,
      `${adjacent} customer specification material selection revision rework`,
      `${adjacent2} custom commission dimensions approval material rework`,
      `${adjacent3} design reference revision mistake remake`,
    ]);
  }

  static preferredForumDomains(requestDescription?: string | null): string[] {
    return [...(this.resolve(requestDescription)?.preferredForumDomains ?? [])];
  }

  static preferredSubreddits(requestDescription?: string | null): string[] {
    return [...(this.resolve(requestDescription)?.preferredSubreddits ?? [])];
  }

  static suggestedDomainName(requestDescription?: string | null): string | null {
    return this.resolve(requestDescription)?.suggestedDomainName ?? null;
  }

  static isViolinBowServiceRequest(requestDescription?: string | null): boolean {
    const request = this.normalize(requestDescription ?? '');
    if (!request) return false;
    const identity = /\b(?:violin bows?|bow technicians?|bow repairers?|archetiers?|bow rehair(?:ing)? specialists?)\b/u.test(request);
    const service = /\b(?:repair|repairs|repair notes?|repair history|service history|rehair|rehairing|rehair dates?|previous rehair|condition assessment|maintenance)\w*\b/u.test(request);
    const commissionDominant = this.isViolinBowCommissionRequest(request);
    return identity && service && !commissionDominant;
  }

  private static isFountainPenCommissionRequest(request: string): boolean {
    const actor = /\b(?:independent )?(?:fountain pen makers?|custom pen makers?|pen makers?|penmaking workshops?)\b/u.test(request);
    const specification = /\b(?:nib sizes?|nib widths?|filling mechanisms?|body materials?|barrel materials?|color combinations?|colour combinations?|engraving details?|grip dimensions?|design revisions?|approved specifications?|final approved specifications?|completion deadlines?|custom orders?|commissions?)\b/u.test(request);
    const commissionPain = /\b(?:incorrect components?|wrong components?|sizing problems?|sizing errors?|missed customization details?|wasted materials?|rework|remakes?|delayed commissions?|delayed completion)\b/u.test(request);
    const restorationDominant = /\b(?:restoration|restore|repair|previous repairs?|vintage pen|antique pen|nib repair)\b/u.test(request);
    return actor && specification && commissionPain && !restorationDominant;
  }

  private static isWatchStrapRequest(request: string): boolean {
    return (
      /\b(?:watch straps?|watch bands?|leather watch straps?|leather watch bands?|watch strap makers?|watch band makers?|bespoke straps?)\b/u.test(request) &&
      /\b(?:wrist measurements?|wrist sizes?|strap lengths?|strap widths?|lug widths?|leather types?|material choices?|stitching styles?|buckle selections?|design revisions?|customer approvals?|approved specifications?|wrong sizes?|sizing errors?|remakes?|rework|wasted leather|wasted supplies?|delayed orders?)\b/u.test(request)
    );
  }

  private static isViolinBowCommissionRequest(request: string): boolean {
    const actor = /\b(?:independent )?(?:violin bow makers?|bow makers?|archetiers?|bow making workshops?)\b/u.test(request);
    const specification = /\b(?:playing preferences?|player preferences?|bow measurements?|measurements?|wood selections?|wood choices?|hair types?|hair selection|balance requirements?|balance points?|grip materials?|grip details?|winding|design adjustments?|design revisions?|approved specifications?|final approved specifications?|completion deadlines?|commissions?)\b/u.test(request);
    const productionPain = /\b(?:incorrect balance|wrong balance|unsuitable materials?|incorrect materials?|repeated adjustments?|rework|remakes?|wasted supplies?|wasted materials?|delayed commissions?|delayed completion)\b/u.test(request);
    const explicitServiceOnly = /\b(?:repair history|service history|previous repairs?|previous rehair|rehair dates?)\b/u.test(request) &&
      !/\b(?:wood selections?|balance requirements?|design adjustments?|final approved specifications?|commissions?)\b/u.test(request);
    return actor && specification && productionPain && !explicitServiceOnly;
  }

  private static resolveWorkflowTerms(request: string): string[] {
    const dictionary = [
      'customer preference', 'player preference', 'measurement', 'wrist measurement',
      'bow measurement', 'rider measurement', 'horse measurement', 'horse dimension', 'dimension', 'sizing', 'fit', 'fitting', 'tree specification', 'tree size', 'padding preference', 'hardware choice', 'wood selection', 'leather selection',
      'material selection', 'hair type', 'balance requirement', 'balance point',
      'character sketch', 'design reference', 'paint reference', 'movement mechanism', 'mechanism', 'costume detail', 'costume',
      'grip material', 'stitching', 'buckle', 'color preference', 'design revision',
      'design adjustment', 'revision request', 'customer approval', 'client approval',
      'approved specification', 'final approved specification', 'completion deadline',
      'custom order', 'commission', 'customer message', 'workshop note',
    ];
    return dictionary.filter((term) => request.includes(term)).length > 0
      ? dictionary.filter((term) => request.includes(term))
      : ['measurement', 'material selection', 'design revision', 'customer approval'];
  }

  private static resolvePainTerms(request: string): string[] {
    const dictionary = [
      'wrong size', 'sizing error', 'measurement error', 'wrong measurement',
      'incorrect balance', 'wrong balance', 'poor fit', 'incorrect fit', 'fit problem', 'unsuitable material', 'incorrect material',
      'material mismatch', 'wrong version', 'outdated version', 'missed revision',
      'missed design change', 'incorrect proportion', 'unsuitable mechanism',
      'approval confusion', 'remake', 'rework', 'repeated adjustment', 'repeated work',
      'wasted leather', 'wasted material', 'wasted supplies', 'delayed order',
      'delayed commission', 'delayed completion', 'scattered', 'lost note',
      'missing instruction', 'hard to confirm', 'difficult to confirm',
    ];
    return dictionary.filter((term) => request.includes(term)).length > 0
      ? dictionary.filter((term) => request.includes(term))
      : ['rework', 'wrong specification', 'wasted material', 'delay'];
  }

  private static hasDirectIdentity(profile: NicheCustomCraftProfile, evidence: string): boolean {
    if (profile.directIdentityTerms.some((term) => evidence.includes(this.normalize(term)))) {
      return true;
    }
    if (profile.kind !== 'GENERIC_CUSTOM_CRAFT') return false;

    const requestIdentityTokens = this.semanticIdentityTokens(
      profile.directIdentityTerms.join(' '),
    );
    const evidenceTokens = this.semanticIdentityTokens(evidence);
    const overlap = [...requestIdentityTokens].filter((token) => evidenceTokens.has(token));
    return overlap.length >= Math.min(2, Math.max(1, requestIdentityTokens.size));
  }

  private static hasAdjacentCraftIdentity(profile: NicheCustomCraftProfile, evidence: string): boolean {
    if (profile.adjacentIdentityTerms.some((term) => evidence.includes(this.normalize(term)))) {
      return true;
    }
    return /\b(?:maker|makers|artisan|artisans|craft|craftsman|craftswoman|workshop|bespoke|custom order|commissioned work|made to order|luthier|leatherworker)\w*\b/u.test(evidence);
  }

  private static hasWorkflowFacet(profile: NicheCustomCraftProfile, evidence: string): boolean {
    const explicit = profile.workflowTerms.some((term) => evidence.includes(this.normalize(term)));
    return explicit || /\b(?:measurements?|dimensions?|sizing|fit|fitting|materials?|wood|leather|hair type|balance|grip|stitching|hardware|design|revision|approval|approved|specification|custom order|commission|customer preference|client preference)\w*\b/u.test(evidence);
  }

  private static hasCustomerSpecificationWorkflowContract(
    evidence: string,
  ): boolean {
    const requesterOrCommission =
      /\b(?:customer|client|custom order|made[- ]to[- ]order|commission(?:ed)?|bespoke order|personalization|personalisation|customization|customisation)\w*\b/u.test(evidence);
    const changeOrApproval =
      /\b(?:specification|specifications|revision|revisions|approval|approved|change request|final design|final version|wrong version|outdated version|missed revision|missed customization|missed customisation)\w*\b/u.test(evidence);
    const measurementFacet =
      /\b(?:measurements?|sizing|fit|fitting|dimensions?|wrong size|measurement error)\w*\b/u.test(evidence);

    /*
     * A production/template skill problem can mention dimensions, leather and
     * waste while having nothing to do with customer requirements. Therefore a
     * measurement/dimension alone never proves a specification-management
     * workflow. Require an explicit requester/commission context OR a real
     * version/specification/approval/change signal. Measurement can strengthen
     * either branch but cannot create evidence by itself.
     */
    return changeOrApproval || (requesterOrCommission && measurementFacet) ||
      (requesterOrCommission && /\b(?:material|leather|color|colour|layout|engraving|stitching|deadline|completion)\w*\b/u.test(evidence));
  }

  private static hasPainFacet(profile: NicheCustomCraftProfile, evidence: string): boolean {
    const explicit = profile.painTerms.some((term) => evidence.includes(this.normalize(term)));
    return explicit || /\b(?:wrong|incorrect|unsuitable|mismatch|mistake|error|changed mind|changed design|missed revision|lost|missing|scattered|outdated|unapproved|remake|rework|repeat(?:ed)? adjustment|repeated work|wast(?:e|ed)|delay(?:ed)?|hard to confirm|difficult to confirm|confusion)\w*\b/u.test(evidence);
  }

  private static hasTechnicalCollision(evidence: string): boolean {
    const technical = /\b(?:source code|github issue|api|sdk|android widget|software widget|workflow engine|visual studio workflow|rf connector|radio frequency connector|programming|runtime|compiler|database migration)\b/u.test(evidence);
    const physicalCraft = /\b(?:leather|wood|bow|violin|strap|band|stitching|material|workshop|artisan|maker|luthier|measurement|custom order|commission)\b/u.test(evidence);
    return technical && !physicalCraft;
  }

  private static extractCraftIdentityPhrases(request: string): string[] {
    const matches = request.match(/\b(?:independent\s+)?[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,4}\s+(?:makers?|artisans?|artists?|studios?|workshops?|specialists?|craft businesses?|shops?)\b/gu) ?? [];
    return matches.map((value) => this.normalize(value)).slice(0, 6);
  }

  private static semanticIdentityTokens(value: string): Set<string> {
    const stop = new Set([
      'independent', 'maker', 'makers', 'artisan', 'artisans', 'artist', 'artists',
      'studio', 'studios', 'workshop', 'workshops', 'specialist', 'specialists',
      'custom', 'bespoke', 'customer', 'client', 'order', 'orders', 'commission',
      'commissions', 'management', 'workflow', 'service', 'services', 'problem',
      'measurement', 'measurements', 'material', 'materials', 'revision', 'revisions',
      'approval', 'approved', 'specification', 'specifications',
    ]);
    return new Set(
      this.normalize(value)
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !stop.has(token)),
    );
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
      const normalized = value.replace(/\s+/gu, ' ').trim();
      const key = normalized.toLocaleLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }
    return output;
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[“”]/gu, '"')
      .replace(/[’]/gu, "'")
      .replace(/[^\p{L}\p{N}\s&+/_'-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
