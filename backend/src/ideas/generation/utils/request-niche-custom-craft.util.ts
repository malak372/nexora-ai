import { RequestWorkflowIntentProfileUtil } from './request-workflow-intent-profile.util';

export type NicheCustomCraftKind =
  | 'WATCH_STRAP'
  | 'VIOLIN_BOW_COMMISSION'
  | 'BOOKBINDING_COMMISSION'
  | 'BOOK_EDGE_GILDING_COMMISSION'
  | 'LEATHER_BOOK_COVER_COMMISSION'
  | 'CALLIGRAPHY_STATIONERY_COMMISSION'
  | 'WEDDING_VEIL_COMMISSION'
  | 'WEDDING_SHOE_COMMISSION'
  | 'FLORAL_PRESERVATION_COMMISSION'
  | 'FLORAL_DESIGN_COMMISSION'
  | 'FOUNTAIN_PEN_COMMISSION'
  | 'GLASS_ENGRAVING_COMMISSION'
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

    if (
      /\b(?:independent )?(?:calligraphers?|calligraphy artists?|lettering artists?|custom stationery artists?|wedding invitation calligraphers?)\b/u.test(request) &&
      /\b(?:wedding invitations?|guest names?|spelling variations?|paper sizes?|ink colors?|ink colours?|lettering styles?|layout approvals?|envelope details?|delivery deadlines?|approved specifications?|misspelled names?|inconsistent designs?|wasted stationery|repeated work|delayed orders?)\b/u.test(request)
    ) {
      return {
        kind: 'CALLIGRAPHY_STATIONERY_COMMISSION',
        label: 'custom calligraphy and wedding stationery specification approval operations',
        directIdentityTerms: [
          'calligrapher',
          'calligraphy artist',
          'wedding invitation calligrapher',
          'custom stationery artist',
          'wedding stationery designer',
          'lettering artist',
          'envelope calligrapher',
        ],
        adjacentIdentityTerms: [
          'stationery designer',
          'invitation designer',
          'wedding stationery',
          'custom invitations',
          'letterpress studio',
          'print studio',
          'graphic designer',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: [],
        preferredSubreddits: ['calligraphy', 'weddingplanning', 'stationery'],
        suggestedDomainName: 'Custom Calligraphy & Wedding Stationery',
      };
    }

    if (
      /\b(?:floral preservation specialists?|flower preservation specialists?|bouquet preservation specialists?|bouquet preservation artists?|floral preservation studios?|flower preservation artists?)\b/u.test(request) &&
      /\b(?:bouquet condition|flower varieties?|drying methods?|resin|framing|color changes?|colour changes?|layout preferences?|personalization details?|delivery deadlines?|incorrect layouts?|unsuitable preservation methods?|missed customization|repeated work|delayed orders?)\b/u.test(request)
    ) {
      return {
        kind: 'FLORAL_PRESERVATION_COMMISSION',
        label: 'custom bouquet preservation method design and approval operations',
        directIdentityTerms: [
          'floral preservation specialist',
          'flower preservation specialist',
          'bouquet preservation specialist',
          'bouquet preservation artist',
          'floral preservation studio',
          'flower preservation artist',
          'resin bouquet preservation',
          'wedding bouquet preservation',
        ],
        adjacentIdentityTerms: [
          'resin artist',
          'floral designer',
          'wedding florist',
          'pressed flower artist',
          'flower drying',
          'resin casting',
          'custom frame maker',
          'wedding keepsake artist',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: [],
        preferredSubreddits: ['resincasting', 'flowers', 'weddingplanning', 'crafts'],
        suggestedDomainName: 'Floral Preservation Order & Design Management',
      };
    }

    if (
      /\b(?:independent )?(?:floral designers?|florists?|flower designers?|wedding florists?|event florists?|floral studios?)\b/u.test(request) &&
      /\b(?:color preferences?|colour preferences?|flower varieties?|arrangement sizes?|reference photos?|event themes?|substitution approvals?|delivery instructions?|last[- ]minute design changes?|incorrect flower combinations?|missed design requests?|wasted materials?|repeated work|delayed deliveries?)\b/u.test(request)
    ) {
      return {
        kind: 'FLORAL_DESIGN_COMMISSION',
        label: 'custom floral arrangement specification substitution and approval operations',
        directIdentityTerms: [
          'floral designer',
          'independent florist',
          'wedding florist',
          'event florist',
          'flower designer',
          'floral studio',
          'custom flower arrangement',
        ],
        adjacentIdentityTerms: [
          'flower shop',
          'wedding vendor',
          'event designer',
          'event decorator',
          'bouquet designer',
          'floral business',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: [],
        preferredSubreddits: ['florists', 'floraldesign', 'weddingplanning', 'smallbusiness'],
        suggestedDomainName: 'Floral Design & Custom Order Management',
      };
    }

    if (
      /\b(?:independent )?(?:wedding shoe makers?|bridal shoe makers?|custom wedding shoe makers?|bespoke wedding shoe makers?|bespoke shoemakers?|custom footwear makers?)\b/u.test(request) &&
      /\b(?:foot measurements?|heel preferences?|heel heights?|material selections?|leather types?|color matching|colour matching|decorative details?|personalization|personalisation|fitting adjustments?|completion deadlines?|sizing errors?|incorrect materials?|missed customization|repeated fittings?|delayed orders?)\b/u.test(request)
    ) {
      return {
        kind: 'WEDDING_SHOE_COMMISSION',
        label: 'custom wedding shoe commission measurement fitting specification and approval operations',
        directIdentityTerms: [
          'wedding shoe maker',
          'bridal shoe maker',
          'custom wedding shoes',
          'bespoke wedding shoes',
          'bespoke bridal shoes',
          'custom bridal footwear',
          'bespoke shoemaker',
          'cordwainer',
        ],
        adjacentIdentityTerms: [
          'bespoke shoemaker',
          'custom shoemaker',
          'cordwainer',
          'shoemaking',
          'custom footwear',
          'leatherworker',
          'bridal accessories',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: ['leatherworker.net'],
        preferredSubreddits: ['cordwaining', 'shoemaking', 'leathercraft', 'weddingplanning'],
        suggestedDomainName: 'Wedding Shoe Maker Custom Order & Fitting Management',
      };
    }

    if (
      /\b(?:wedding veil makers?|veil makers?|bridal veil makers?|custom veil makers?|bridal designers?)\b/u.test(request) &&
      /\b(?:bride measurements?|veil lengths?|fabric selections?|lace patterns?|embroidery details?|comb styles?|design revisions?|completion deadlines?|sizing errors?|incorrect materials?|missed design changes?|repeated adjustments?|delayed orders?)\b/u.test(request)
    ) {
      return {
        kind: 'WEDDING_VEIL_COMMISSION',
        label: 'custom wedding veil commission measurement specification and approval operations',
        directIdentityTerms: [
          'wedding veil maker',
          'veil maker',
          'bridal veil maker',
          'custom wedding veil',
          'custom veil',
          'bespoke veil',
          'bridal veil designer',
        ],
        adjacentIdentityTerms: [
          'bridal alterations',
          'bridal seamstress',
          'wedding dress alterations',
          'bridal designer',
          'custom bridal accessories',
          'seamstress',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: [],
        preferredSubreddits: ['weddingplanning', 'sewing', 'weddingdress'],
        suggestedDomainName: 'Wedding Veil Maker Custom Order & Specification Management',
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
      /\b(?:independent )?(?:book[- ]edge gilding specialists?|book edge gilders?|fore[- ]edge gilders?|fore[- ]edge gilding specialists?|book gilding specialists?)\b/u.test(request) &&
      /\b(?:gold|metallic|gilding|edge preparation|decorative patterns?|color choices?|colour choices?|book dimensions?|material compatibility|revision requests?|completion deadlines?|incorrect finishes?|damaged pages?|repeated work|wasted materials?|delayed commissions?)\b/u.test(request)
    ) {
      return {
        kind: 'BOOK_EDGE_GILDING_COMMISSION',
        label: 'book-edge gilding commission specification preparation and approval operations',
        directIdentityTerms: [
          'book edge gilding specialist',
          'book-edge gilding specialist',
          'book edge gilder',
          'fore-edge gilder',
          'fore-edge gilding specialist',
          'book gilding specialist',
          'gilded book edges',
        ],
        adjacentIdentityTerms: [
          'bookbinder',
          'bookbinding artisan',
          'custom bookbinder',
          'book conservator',
          'book finisher',
          'gold leaf artisan',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: [],
        preferredSubreddits: ['bookbinding', 'bookrepair', 'crafts'],
        suggestedDomainName: 'Book-Edge Gilding Commission & Specification Management',
      };
    }


    if (
      /\b(?:independent )?(?:leather book[- ]cover makers?|leather book cover artisans?|custom leather book[- ]cover makers?|leather bookbinding artisans?)\b/u.test(request) &&
      /\b(?:book dimensions?|leather selections?|decorative patterns?|embossing requests?|closure styles?|color preferences?|colour preferences?|approved specifications?|final approved specifications?|completion deadlines?|customer messages?|handwritten measurements?|sizing errors?|incorrect materials?|missed personalization|wasted supplies?|delayed orders?)\b/u.test(request)
    ) {
      return {
        kind: 'LEATHER_BOOK_COVER_COMMISSION',
        label: 'custom leather book-cover commission specification and approval operations',
        directIdentityTerms: [
          'leather book cover maker',
          'leather book-cover maker',
          'custom leather book cover',
          'custom leather book-cover',
          'leather bookbinding artisan',
          'bespoke leather book cover',
        ],
        adjacentIdentityTerms: [
          'leatherworker',
          'leather worker',
          'leathercraft',
          'bookbinder',
          'bookbinding artisan',
          'custom leather artisan',
        ],
        workflowTerms: this.resolveWorkflowTerms(request),
        painTerms: this.resolvePainTerms(request),
        preferredForumDomains: ['leatherworker.net'],
        preferredSubreddits: ['leathercraft', 'bookbinding'],
        suggestedDomainName: 'Custom Leather Book Cover Making',
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

    if (
      /\b(?:independent )?(?:glass engravers?|glass engraving studios?|custom glass engravers?|glass etchers?|glass etching studios?|engraving studios?|custom engraving shops?|trophy engravers?)\b/u.test(request) &&
      /\b(?:customer artwork|reference artwork|artwork revisions?|engraving text|text changes?|spelling|fonts?|font styles?|dimensions?|sizes?|engraving depth|etching depth|placement|design proofs?|proof approvals?|revisions?|customer approvals?|approved versions?|wrong text|misspell(?:ed|ing)|wrong font|wrong dimensions?|wrong placement|wrong depth|missed revisions?|remakes?|rework|wasted (?:glass|materials?)|delayed orders?)\b/u.test(request)
    ) {
      return {
        kind: 'GLASS_ENGRAVING_COMMISSION',
        label: 'custom glass engraving artwork specification proof and approval operations',
        directIdentityTerms: [
          'glass engraver',
          'glass engraving studio',
          'custom glass engraver',
          'glass etcher',
          'glass etching studio',
          'personalized glassware engraver',
          'custom engraving shop',
          'trophy engraver',
        ],
        adjacentIdentityTerms: [
          'glass etching',
          'sandblasting glass',
          'sandcarving glass',
          'laser engraving',
          'personalized glassware',
          'custom engraving',
          'award engraving',
          'sign engraver',
          'glass decorator',
          'custom glass studio',
        ],
        workflowTerms: this.unique([
          ...this.resolveWorkflowTerms(request),
          'customer artwork',
          'reference artwork',
          'engraving text',
          'spelling',
          'font',
          'font style',
          'dimension',
          'engraving depth',
          'etching depth',
          'placement',
          'design proof',
          'proof approval',
          'revision',
          'customer approval',
          'approved version',
          'custom order',
          'commission',
        ]).slice(0, 20),
        painTerms: this.unique([
          ...this.resolvePainTerms(request),
          'wrong text',
          'misspelling',
          'wrong spelling',
          'wrong font',
          'wrong dimension',
          'wrong placement',
          'wrong depth',
          'missed revision',
          'wrong version',
          'remake',
          'rework',
          'wasted glass',
          'wasted material',
          'delayed order',
        ]).slice(0, 18),
        preferredForumDomains: [],
        preferredSubreddits: [
          'engraving',
          'laserengraving',
          'glassblowing',
          'crafts',
          'smallbusiness',
        ],
        suggestedDomainName: 'Glass Engraving Studio & Client Specification Management',
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
    const mechanicalDecorativeCraft =
      /\b(?:music boxes?|musical boxes?|mechanical music boxes?|automata|mechanical keepsake boxes?|custom wooden boxes?)\b/u.test(request) &&
      /\b(?:mechanisms?|melod(?:y|ies)|tunes?|wood|engraving|decorative details?|dimensions?|design revisions?|commission|customer|client)\b/u.test(request);
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
      ...(mechanicalDecorativeCraft
        ? ['music box maker', 'mechanical craft maker', 'custom box maker', 'woodworker', 'woodworking artisan', 'commission maker']
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
        ...(mechanicalDecorativeCraft ? ['crafts', 'woodworking'] : []),
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

    if (profile.kind === 'GLASS_ENGRAVING_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'glass engraver wrong text spelling customer order remake',
          'glass engraving customer artwork revision wrong version rework',
          'glass etching wrong font size placement customer proof',
          'personalized glassware engraving customer proof revision mistake',
          'custom engraving shop wrong dimensions artwork version remake',
          'sandblasted glass customer design approval placement mistake',
          'trophy engraver missed customer note spelling remake',
          'glass engraving final proof wrong version delayed order',
          'laser engraving glass customer artwork revision rework',
          'glass etcher engraving depth placement customer complaint',
        ];
      }
      if (source === 'crossref') {
        return [
          'glass engraving process depth surface quality etching',
          'laser engraving glass process parameters surface quality',
          'sandblasting glass etching process quality control',
          'glass marking engraving dimensional accuracy quality',
          'customized glass engraving design manufacturing quality',
        ];
      }
      if (source === 'news' || source === 'blog' || source === 'youtube') {
        return [
          'custom glass engraving wrong text spelling remake',
          'glass etching customer artwork proof revision mistakes',
          'personalized glassware engraving wrong font placement',
          'engraving shop customer approval wrong version rework',
          'laser engraving glass artwork setup mistakes customer order',
          'sandblasted glass design revision placement problem',
        ];
      }
      return [
        'glass engraver customer artwork revision mistake remake',
        'glass etching wrong text font placement customer order',
        'personalized glassware engraving customer proof approval rework',
        'custom engraving shop wrong dimensions artwork version',
        'glass engraving missed revision delayed custom order',
      ];
    }

    if (profile.kind === 'CALLIGRAPHY_STATIONERY_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'wedding calligrapher misspelled guest name invitation remake',
          'custom wedding invitation calligraphy client proof approval revision',
          'envelope calligraphy wrong guest name spelling redo',
          'wedding stationery paper size ink color client changes rework',
          'custom invitation lettering style layout approval mistake',
          'calligraphy commission guest list changes deadline rework',
          'wedding invitation personalization error wasted stationery',
          'calligrapher customer messages final approved invitation specification',
        ];
      }
      if (source === 'crossref') {
        return [
          'wedding invitation personalization typography proofing errors',
          'custom invitation design client approval revision',
          'stationery personalization name spelling quality control',
          'wedding stationery layout typography customization errors',
        ];
      }
      return [
        'wedding invitation calligrapher client proof approval',
        'custom calligraphy guest name spelling correction',
        'wedding stationery personalization reprint error',
        'envelope calligraphy guest list revision deadline',
        'custom invitation paper ink lettering customer approval',
      ];
    }

    if (profile.kind === 'FLORAL_PRESERVATION_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'bouquet preservation came out wrong redo',
          'resin bouquet flowers changed color problem',
          'wedding bouquet preservation wrong layout remake',
          'bouquet preservation client changed frame design',
          'flower preservation resin bubbles discoloration redo',
          'pressed bouquet wrong flower placement rework',
          'wedding bouquet preservation commission delayed',
          'bouquet preservation customer customization missed',
          'resin flower preservation wrong drying method',
          'bouquet frame layout customer revision remake',
        ];
      }
      if (source === 'crossref') {
        return [
          'flower drying method color retention preservation',
          'resin encapsulation flowers color change preservation',
          'pressed flower preservation color stability drying',
          'floral material preservation drying discoloration study',
          'flower preservation resin moisture discoloration',
        ];
      }
      return [
        'bouquet preservation wrong layout remake',
        'resin bouquet flower color changed problem',
        'wedding bouquet preservation client revision',
        'flower preservation wrong drying method rework',
        'bouquet preservation missed customization detail',
        'floral preservation commission delayed order',
      ];
    }

    if (profile.kind === 'FLORAL_DESIGN_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'florist customer changed flowers after approval',
          'wedding florist substitution approval customer complaint',
          'flower arrangement wrong color remake florist',
          'floral designer missed customer reference photo request',
          'florist last minute design change order rework',
          'custom flower arrangement wrong size customer order',
          'florist delivery instruction missed event order',
          'flower shop custom order notes customer changes',
          'floral designer substitution customer approval problem',
          'wedding flowers wrong combination customer request remake',
        ];
      }
      if (source === 'crossref') {
        return [
          'floral design customer preference flower substitution event',
          'cut flower supply substitution event floristry quality',
          'floral arrangement color preference customer satisfaction',
          'flower supply variability florist substitution wedding event',
          'floristry order customization customer preference quality',
        ];
      }
      if (source === 'news' || source === 'blog') {
        return [
          'florist substitution approval wedding flowers customer change',
          'flower shop custom order mistake wrong flowers',
          'wedding florist last minute changes rework',
          'floral designer customer order specification mistake',
          'florist delivery instruction mistake event flowers',
        ];
      }
      return [
        'florist customer order change approval flowers',
        'floral designer wrong color arrangement remake',
        'wedding florist substitution approval problem',
        'flower arrangement customer specification rework',
        'florist delayed custom order design changes',
      ];
    }

    if (profile.kind === 'WEDDING_SHOE_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'custom wedding shoes wrong size remake',
          'bespoke bridal shoes fitting problem heel adjustment',
          'custom shoemaker foot measurement mistake rework',
          'bridal shoes wrong leather color remake',
          'bespoke shoes client changed design after fitting',
          'custom wedding shoe fitting repeated adjustment',
          'wedding shoes personalization detail missed',
          'bespoke shoemaker delayed commission fitting',
          'cordwainer custom shoes wrong measurements client revision',
          'custom bridal footwear material mismatch fitting remake',
        ];
      }
      if (source === 'crossref') {
        return [
          'bespoke footwear fit anthropometry foot measurement',
          'custom footwear last design fit adjustment',
          'shoe fitting foot measurement comfort customization',
          'bespoke footwear material selection fit customization',
          'custom footwear heel height fit biomechanics',
        ];
      }
      if (source === 'youtube' || source === 'blog') {
        return [
          'bespoke shoemaking fitting mistakes custom last',
          'custom shoemaker foot measurement fitting adjustment',
          'bridal shoes fit adjustment custom commission',
          'bespoke shoe material selection fitting rework',
          'cordwainer custom shoe fitting client revision',
        ];
      }
      return [
        'custom wedding shoe foot measurement fitting problem',
        'bespoke bridal shoes wrong size repeated fitting',
        'custom shoemaker material color client revision',
        'wedding shoes personalization mistake remake',
        'bespoke wedding shoe commission delayed fitting',
      ];
    }

    if (profile.kind === 'WEDDING_VEIL_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'custom wedding veil wrong length measurement remake',
          'bridal veil alteration wrong measurements sizing mistake',
          'veil maker client changed design after approval',
          'custom veil wrong fabric lace material remake',
          'wedding veil lace applique placement mistake rework',
          'bridal veil commission delayed order revision',
          'custom veil comb style changed customer revision',
          'veil maker customer messages measurements design changes',
        ];
      }
      if (source === 'crossref') {
        return [
          'bridal veil anthropometry fit length measurement customization',
          'custom bridal garment client fitting measurement alteration errors',
          'bridal accessory customization material selection fit',
          'made to measure bridal garment fitting revision rework',
        ];
      }
      return [
        'custom wedding veil wrong measurement remake',
        'bridal veil wrong length alteration mistake',
        'veil maker customer changed design revision',
        'custom veil wrong fabric lace rework',
        'bridal veil delayed commission adjustment',
      ];
    }

    if (profile.kind === 'LEATHER_BOOK_COVER_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'custom leather book cover wrong dimensions remake customer order',
          'leather book cover customer specification embossing closure revision',
          'leatherworker book cover commission wrong leather material rework',
          'custom book cover customer approval final design sizing mistake',
          'leather book cover personalization embossing missed detail remake',
          'book cover maker handwritten measurements customer messages revision',
          'leather bookbinding custom order wasted leather sizing error delay',
          'bespoke leather book cover customer changed specification rework',
        ];
      }
      if (source === 'crossref') {
        return [
          'custom leather bookbinding dimensions materials personalization',
          'leather book cover design dimensions closure material selection',
          'bookbinding custom specifications cover materials decorative tooling',
          'bespoke bookbinding customer specification dimensions materials',
        ];
      }
      return [
        'custom leather book cover customer specifications dimensions materials',
        'leather book cover embossing closure customer approval revision',
        'book cover maker sizing error wrong leather remake',
        'bespoke leather book cover personalization delayed order rework',
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

    if (profile.kind === 'BOOK_EDGE_GILDING_COMMISSION') {
      if (source === 'reddit' || source === 'forum') {
        return [
          'fore edge gilding damaged pages mistake repair',
          'book edge gilding gold leaf finish went wrong',
          'bookbinder gilded edges customer commission mistake',
          'custom bookbinding client revision rework gilded edges',
          'book edge gilding material compatibility paper problem',
          'gilded book edge preparation failure sanding bole gold leaf',
          'bookbinder customer specification error remake custom binding',
          'fore edge gilding customer approval revision delay',
        ];
      }
      if (source === 'crossref') {
        return [
          'book edge gilding gold leaf paper conservation',
          'fore edge gilding book conservation material compatibility',
          'gilded book edges gold leaf preparation conservation',
          'bookbinding edge decoration gilding paper damage',
        ];
      }
      if (source === 'youtube' || source === 'blog') {
        return [
          'fore edge gilding common mistakes gold leaf bookbinding',
          'book edge gilding preparation failure damaged pages',
          'bookbinder gilded edges commission revision rework',
          'gold leaf book edge material compatibility problem',
        ];
      }
      return [
        'book edge gilding wrong finish damaged pages',
        'fore edge gilding gold leaf material problem',
        'bookbinding customer revision gilded edge rework',
        'custom book gilding specification mistake delayed commission',
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
    const compactActor = actor
      .replace(/\bindependent\b/giu, ' ')
      .replace(/\bmakers\b/giu, 'maker')
      .replace(/\bartisans\b/giu, 'artisan')
      .replace(/\s+/gu, ' ')
      .trim() || actor;
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
        `${compactActor} ${pain}`,
        `${compactActor} customer revision approval rework`,
        `${compactActor} customer measurement sizing error remake`,
        `${compactActor} material hardware personalization mistake rework`,
        `${compactActor} final approved specification missed revision delayed order`,
        `${compactActor} measurement material selection remake`,
        `${compactActor} final approval wrong version wasted material`,
        // Adjacent-workflow lane is Supporting-only and starts after exact queries.
        `${adjacent} custom order measurements material selection revisions approval rework`,
        `${adjacent2} customer reference dimensions revision approval remake`,
        `${adjacent3} custom commission material selection missed detail rework deadline`,
        `custom fabrication commission ${workflow2} customer revision ${pain2}`,
      ]);
    }

    return this.unique([
      `${compactActor} ${pain}`,
      `${compactActor} customer revision approval rework`,
      `${compactActor} customer measurement sizing error remake`,
      `${compactActor} material personalization specification mistake`,
      `${compactActor} custom commission specification mistake remake`,
      `${compactActor} final approval wrong version wasted material`,
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
    const identity = /\b(?:violin bows?|violin bow restoration specialists?|violin bow restorers?|bow restoration specialists?|bow restorers?|bow conservators?|violin bow conservators?|bow technicians?|bow repairers?|archetiers?|bow rehair(?:ing)? specialists?)\b/u.test(request);
    const service = /\b(?:restoration|restore|restoring|conservation|repair|repairs|repair notes?|previous repairs?|repair history|restoration history|service history|rehair|rehairing|rehair dates?|previous rehair|condition assessment|condition documentation|treatment history|replacement parts?|replacement materials?|warped sticks?|worn hair|damaged frogs?|loose fittings?|maintenance)\w*\b/u.test(request);
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
    const explicitServiceOnly = /\b(?:restoration|conservation|restorers?|restoration specialists?|repair history|service history|previous repairs?|previous rehair|rehair dates?|warped sticks?|worn hair|damaged frogs?|loose fittings?|condition assessment|condition documentation|restoration history|treatment history)\b/u.test(request) &&
      !/\b(?:new commissions?|custom commissions?|bow measurements?|balance requirements?|design adjustments?|final approved specifications?)\b/u.test(request);
    return actor && specification && productionPain && !explicitServiceOnly;
  }

  private static resolveWorkflowTerms(request: string): string[] {
    const dictionary = [
      'customer preference', 'player preference', 'measurement', 'wrist measurement',
      'bow measurement', 'rider measurement', 'horse measurement', 'horse dimension', 'dimension', 'sizing', 'fit', 'fitting', 'tree specification', 'tree size', 'padding preference', 'hardware choice', 'wood selection', 'leather selection',
      'material selection', 'hair type', 'balance requirement', 'balance point',
      'character sketch', 'design reference', 'paint reference', 'movement mechanism', 'mechanism', 'mechanism type', 'mechanism choice',
      'melody selection', 'tune selection', 'box dimension', 'wood choice', 'wood selection', 'engraving request', 'decorative detail',
      'costume detail', 'costume',
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
      /\b(?:specification|specifications|revision|revisions|approval|approved|change request|final design|final version|final specification|final specifications|wrong version|outdated version|missed revision|missed customization|missed customisation|melody selection|tune selection|mechanism type|mechanism choice|engraving request)\w*\b/u.test(evidence);
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
      (requesterOrCommission && /\b(?:material|leather|wood|color|colour|layout|engraving|melody|tune|mechanism|decorative|stitching|deadline|completion)\w*\b/u.test(evidence));
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
