import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { BaseCollector } from '../base/base.collector';
import {
  type CollectorRequestSupportInput,
  SocialCollector,
} from '../base/collector.interface';

import { CollectorInput, CollectorPost } from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';

import { ForumAdapter } from './adapters/forum-adapter.interface';
import { DiscourseForumAdapter } from './adapters/discourse-forum.adapter';

type ForumSource = {
  url: string;
  adapter: ForumAdapter;
};

type StackExchangeOwner = {
  readonly display_name?: string;
};

type StackExchangeQuestion = {
  readonly question_id?: number;
  readonly title?: string;
  readonly body?: string;
  readonly link?: string;
  readonly owner?: StackExchangeOwner;
  readonly score?: number;
  readonly answer_count?: number;
  readonly creation_date?: number;
  readonly tags?: readonly string[];
};

type StackExchangeSearchResponse = {
  readonly items?: readonly StackExchangeQuestion[];
  readonly backoff?: number;
  readonly quota_remaining?: number;
};

/**
 * Generic forum collector.
 *
 * The collector currently supports Discourse forums.
 *
 * @author Malak
 */
@Injectable()
export class ForumCollector extends BaseCollector implements SocialCollector {
  /**
   * Must match DataSource.key.
   */
  readonly sourceKey = 'forum';

  private static stackExchangeCircuitOpenUntil = 0;

  private readonly forumSources: ForumSource[];

  constructor(
    configService: ConfigService,

    private readonly discourseForumAdapter: DiscourseForumAdapter,
  ) {
    super(configService, ForumCollector.name);

    this.forumSources = [
      {
        url: 'https://meta.discourse.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://forum.freecodecamp.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discourse.mozilla.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discourse.ubuntu.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discussion.fedoraproject.org',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discuss.kubernetes.io',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://community.grafana.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://forums.docker.com',
        adapter: this.discourseForumAdapter,
      },
      {
        url: 'https://discuss.elastic.co',
        adapter: this.discourseForumAdapter,
      },
    ];
  }

  supportsRequest(input: CollectorRequestSupportInput): boolean {
    const bounded =
      input.collectionMode === 'FAST_GENERATION' ||
      input.collectionMode === 'TARGETED_RECOVERY';
    if (!bounded) return true;

    if (this.isTechnicalRequest(input)) return true;
    if (ForumCollector.stackExchangeCircuitOpenUntil > Date.now()) return false;

    return this.resolveStackExchangeSites(input).length > 0;
  }

  private isTechnicalRequest(input: CollectorRequestSupportInput): boolean {
    const text = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ].join(' '));
    return /\b(?:api|sdk|source code|codebase|stack trace|exception|docker|kubernetes|container|database schema|webhook|endpoint|repository|github|programming|developer|software engineering|frontend|backend|javascript|typescript|python|java|linux|ubuntu|fedora|grafana|elastic)\b/u.test(text) ||
      /\b(?:software|application|app|server|container|node|javascript|typescript|python|java)\s+runtime\b|\bruntime\s+(?:error|exception|environment|version|dependency|crash)\b/u.test(text);
  }

  /**
   * Collects posts from configured forum sources.
   */
  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    try {
      const searchQuery = this.buildSearchQuery(input);

      if (!searchQuery) {
        this.logger.warn(
          'Forum collection skipped because no search keywords exist.',
        );

        return [];
      }

      const isFastGeneration = input.collectionMode === 'FAST_GENERATION';
      const isTargetedRecovery = input.collectionMode === 'TARGETED_RECOVERY';
      const isBoundedGeneration = isFastGeneration || isTargetedRecovery;
      const boundedSourceLimit = isTargetedRecovery ? 2 : 1;
      const technicalRequest = this.isTechnicalRequest(input);
      const sources = isBoundedGeneration
        ? technicalRequest
          ? this.forumSources
              .filter((source) => source.url !== 'https://meta.discourse.org')
              .slice(0, boundedSourceLimit)
          : []
        : this.forumSources;
      const stackExchangeSites = isBoundedGeneration
        ? this.resolveStackExchangeSites(input)
        : [];

      this.logger.debug(
        `Forum source plan | collectionMode=${input.collectionMode ?? 'STANDARD'} | bounded=${isBoundedGeneration} | discourse=${sources.map((source) => source.url).join(',') || 'none'} | stackExchange=${stackExchangeSites.join(',') || 'none'}`,
      );

      const [results, stackExchangePosts] = await Promise.all([
        isBoundedGeneration
          ? Promise.allSettled(
              sources.map((source) =>
                source.adapter.collect(source.url, searchQuery, input),
              ),
            )
          : this.collectSequentially(sources, searchQuery, input),
        isBoundedGeneration
          ? this.collectFromStackExchange(input, stackExchangeSites)
          : Promise.resolve<CollectorPost[]>([]),
      ]);

      const discoursePosts = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }

        this.logger.debug(
          `Forum source skipped | url=${sources[index]?.url ?? 'unknown'} | error=${this.getErrorMessage(result.reason)}`,
        );
        return [];
      });

      const rankedPosts = this.rankAndDeduplicatePosts(
        [...stackExchangePosts, ...discoursePosts],
        input,
      );

      this.logger.log(
        `Forum collection completed. Posts: ${rankedPosts.length}`,
      );

      return rankedPosts;
    } catch (error: unknown) {
      this.logger.warn('Forum collection failed', this.getErrorMessage(error));

      return [];
    }
  }

  private async collectFromStackExchange(
    input: CollectorInput,
    resolvedSites?: readonly string[],
  ): Promise<CollectorPost[]> {
    if (ForumCollector.stackExchangeCircuitOpenUntil > Date.now()) {
      return [];
    }

    const sites = resolvedSites ? [...resolvedSites] : this.resolveStackExchangeSites(input);
    if (sites.length === 0) return [];

    const queries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
    })
      .map((query) => query.split(/\s+/u).slice(0, 7).join(' '))
      .filter(Boolean)
      .slice(0, input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 3);

    if (queries.length === 0) return [];

    const requests = sites.flatMap((site) =>
      queries.slice(0, sites.length > 1 ? 2 : 3).map((query) =>
        this.searchStackExchange(site, query, input),
      ),
    );
    const settled = await Promise.allSettled(requests);
    const firstPass = settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    if (
      firstPass.length >= 2 ||
      !input.requestDescription?.trim() ||
      ForumCollector.stackExchangeCircuitOpenUntil > Date.now()
    ) {
      return firstPass;
    }

    const attempted = new Set(queries.map((query) => query.toLocaleLowerCase()));
    const fallbackQueries = ProblemFirstCollectorQueryUtil.buildProgressiveFallback({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
    })
      .map((query) => query.split(/\s+/u).slice(0, 5).join(' '))
      .filter(Boolean)
      .filter((query) => !attempted.has(query.toLocaleLowerCase()))
      .slice(0, 2);

    if (fallbackQueries.length === 0) return firstPass;
    const fallbackRequests = sites.flatMap((site) =>
      fallbackQueries.map((query) => this.searchStackExchange(site, query, input)),
    );
    const fallbackSettled = await Promise.allSettled(fallbackRequests);
    return [
      ...firstPass,
      ...fallbackSettled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      ),
    ];
  }

  private resolveStackExchangeSites(input: CollectorRequestSupportInput): string[] {
    const requestText = this.cleanNormalizedText(input.requestDescription ?? '');
    const text = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.domainKeywords ?? []),
      ...(input.keywords ?? []),
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ].join(' '));

    const sites: string[] = [];
    const add = (site: string) => {
      if (!sites.includes(site)) sites.push(site);
    };

    if (
      /\b(?:universities|university|higher education|online learning systems?|learning platforms?|learning management systems?|lms|online exams?|online assessments?)\b/u.test(requestText) &&
      /\b(?:login activity|login records?|authentication|account permissions?|device information|device fingerprints?|security alerts?|compromised accounts?|suspicious activity|unauthorized access|cybersecurity|academic integrity|exam integrity)\b/u.test(requestText)
    ) {
      add('security.stackexchange.com');
      add('academia.stackexchange.com');
    }
    if (
      /\b(?:restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|online food ordering services?|meal delivery platforms?|restaurant courier platforms?)\b/u.test(requestText) &&
      /\b(?:suspicious orders?|account takeovers?|account takeover|refund abuse|fraudulent refunds?|promotional abuse|promo(?:tional)? fraud|promo code abuse|payment behavior|device information|device signals?|customer complaints?|security alerts?|false positives?|blocked legitimate (?:users?|customers?)|coordinated abuse)\b/u.test(requestText)
    ) {
      add('security.stackexchange.com');
      add('money.stackexchange.com');
    }
    if (
      /\b(?:frame gilding specialists?|frame gilders?|gilders?|gilding workshops?|frame restoration specialists?|frame restorers?)\b/u.test(requestText) &&
      /\b(?:gold[- ]leaf|gold leaf|damaged decorative|surface preparation|finish preferences?|approved treatment|previous restoration|restoration work|color matching|colour matching|repeated work|wasted materials?)\b/u.test(requestText)
    ) {
      add('crafts.stackexchange.com');
      add('diy.stackexchange.com');
    }

    if (
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export(?:ers?| companies?| businesses?))\b/u.test(requestText) &&
      /\b(?:transportation delays?|storage costs?|warehouse expenses?|market prices?|product spoilage|shipment profitability|profit margins?|profit estimates?|supplier payments?|sales revenues?|financial losses?)\b/u.test(requestText)
    ) {
      add('economics.stackexchange.com');
      add('sustainability.stackexchange.com');
    }
    if (
      /\b(?:eyeglass frame repair specialists?|eyeglass repair specialists?|eyewear repair specialists?|optical frame repair specialists?|spectacle frame repair specialists?|glasses repair specialists?)\b/u.test(requestText) &&
      /\b(?:frame damage|previous repairs?|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|adjustment notes?|pickup dates?|repair history)\b/u.test(requestText)
    ) {
      add('crafts.stackexchange.com');
      add('diy.stackexchange.com');
    }

    if (
      /\b(?:large farms?|farms?|farm operators?|farm managers?|agricultural enterprises?|agriculture)\b/u.test(requestText) &&
      /\b(?:electricity|energy consumption|energy usage|irrigation pumps?|cold[- ]storage|greenhouses?|processing equipment|energy waste|energy efficiency|operating costs?)\b/u.test(requestText)
    ) {
      add('sustainability.stackexchange.com');
      add('engineering.stackexchange.com');
    }
    if (
      /\b(?:violin case restoration specialists?|violin case restorers?|instrument case restoration specialists?|instrument case restorers?|violin case restoration)\b/u.test(requestText) &&
      /\b(?:damaged hinges?|interior padding|fabric condition|handle repairs?|replacement hardware|previous restoration|restoration history|repeated repairs?|incorrect materials?|overlooked damage)\b/u.test(requestText)
    ) {
      add('music.stackexchange.com');
      add('crafts.stackexchange.com');
    }

    if (
      /\b(?:typewriter restoration specialists?|typewriter restorers?|typewriter repair specialists?|typewriter repairers?|typewriter restoration workshops?|typewriter repair shops?)\b/u.test(requestText) &&
      /\b(?:mechanical condition|missing keys?|ribbon mechanism|damaged components?|previous repairs?|repair history|replacement parts?|spare parts?|repeated diagnostics?|overlooked defects?)\b/u.test(requestText)
    ) {
      add('retrocomputing.stackexchange.com');
      add('crafts.stackexchange.com');
    }
    if (
      /\b(?:public grant programs?|government grant programs?|public funding programs?|grant-making agencies?|grantmaking agencies?|public agencies?)\b/u.test(requestText) &&
      /\b(?:grant applications?|eligibility checks?|previous funding|funding history|project outcomes?|financial records?|duplicate(?:d)? requests?|unrealistic budgets?|underperformance risk|funding allocation|program impact)\b/u.test(requestText)
    ) {
      add('civicrm.stackexchange.com');
      add('opendata.stackexchange.com');
    }

    if (
      /\b(?:decorative fountains?|ornamental fountains?|historic fountains?|fountain restoration specialists?|fountain restorers?|fountain maintenance contractors?|water features?)\b/u.test(requestText) &&
      /\b(?:pump condition|fountain pumps?|water[- ]?flow|stone damage|metal damage|metal corrosion|replacement components?|replacement parts?|finish preferences?|previous repairs?|repair history|customer requests?|restoration history)\b/u.test(requestText)
    ) {
      add('diy.stackexchange.com');
      add('crafts.stackexchange.com');
    }

    if (/\b(?:real estate|property investment|property investor|landlord|rental property|finance|cash flow|mortgage|vacancy|noi|profitability)\b/u.test(text)) {
      add('money.stackexchange.com');
    }
    if (/\b(?:cake decorator|custom cake|home baker|cake artist|bakery|food|restaurant|cooking|allergy|ingredient)\b/u.test(text)) {
      add('cooking.stackexchange.com');
    }
    if (/\b(?:calligraphy|lettering|craft|handmade|custom stationery|art commission|frame restoration|picture frame restoration|frame restorer|gilded frame|frame conservation|picture framer|custom framing)\b/u.test(text)) {
      add('crafts.stackexchange.com');
    }
    if (/\b(?:musical score restoration|music score restoration|music manuscript|musical manuscript|manuscript conservation|paper conservation|manuscript conservator|paper conservator|document conservator)\b/u.test(text)) {
      /*
       * "paper conservation" is broader than music. Do not let an AI routing
       * hint send antique maps, books, documents, or prints to Music.SE unless
       * the requester itself is actually about music/manuscripts/scores.
       */
      if (
        /\b(?:music|musical|score|sheet music|music manuscript|musical manuscript|instrument)\w*\b/u.test(
          requestText,
        )
      ) {
        add('music.stackexchange.com');
      }
      add('crafts.stackexchange.com');
    }
    if (/\b(?:guitar repair|guitar technician|guitar technicians|luthier|luthiers|instrument repair|instrument repairs|musical instrument repair|fret wear|neck adjustment|neck adjustments|setup preferences?|repair history|service history)\b/u.test(text)) {
      add('music.stackexchange.com');
    }
    if (/\b(?:sneaker cleaning|shoe cleaning|sneaker cleaner|shoe cleaner|sneaker restoration|shoe restoration|footwear cleaning|footwear restoration)\b/u.test(text)) {
      add('lifehacks.stackexchange.com');
      add('crafts.stackexchange.com');
    }
    if (/\b(?:restaurant chains?|restaurant managers?|restaurant operators?|commercial kitchens?|restaurant refrigeration|commercial kitchen equipment|restaurant energy|utility costs?)\b/u.test(text)) {
      add('cooking.stackexchange.com');
      add('diy.stackexchange.com');
    }
    if (/\b(?:upholstery|furniture repair|woodworking|home repair|home improvement|frame restoration|picture frame restoration|frame restorer|gilded frame restoration)\b/u.test(text)) {
      add('diy.stackexchange.com');
    }
    if (/\b(?:legal|law|contract|compliance)\b/u.test(text)) {
      add('law.stackexchange.com');
    }
    if (/\b(?:education|academic|university|student|research)\b/u.test(text)) {
      add('academia.stackexchange.com');
    }
    if (/\b(?:workplace|human resources|hr policy|employee|employment|faculty workload|teaching workload|course staffing)\b/u.test(text)) {
      add('workplace.stackexchange.com');
    }
    if (/\b(?:sign language interpretation agenc(?:y|ies)|sign language interpreting agenc(?:y|ies)|asl interpreting agenc(?:y|ies)|interpreter agenc(?:y|ies)|language service providers?|interpreter availability|assignment matching|interpreter scheduling)\b/u.test(text)) {
      add('workplace.stackexchange.com');
    }
    if (/\b(?:pet trainer|dog trainer|animal trainer|pet behavior|pet behaviour|dog training|animal behavior|animal behaviour|training exercises?|behavioral triggers?|behavioural triggers?)\b/u.test(text)) {
      add('pets.stackexchange.com');
    }
    if (
      /\b(?:music|musical|musician|orchestra|band|guitar|violin|piano|instrument)\w*\b/u.test(requestText) &&
      /\b(?:rental|rentals|hire|booking|availability|return dates?|deposit|accessories|maintenance|condition|damage)\w*\b/u.test(requestText) &&
      !this.isTechnicalRequest(input)
    ) {
      add('music.stackexchange.com');
    }

    const rentalInventoryRequest =
      /\b(?:rental|rentals|hire)\w*\b/u.test(requestText) &&
      /\b(?:availability|booking|bookings|reservation|reservations|return dates?|expected returns?|deposits?|charges?|accessories|condition|damage|maintenance|servicing)\w*\b/u.test(requestText);
    if (rentalInventoryRequest && !this.isTechnicalRequest(input)) {
      if (/\b(?:deposit|deposits|charge|charges|refund|payment|fee|fees)\w*\b/u.test(requestText)) {
        add('money.stackexchange.com');
      }
      if (/\b(?:condition|damage|maintenance|servicing|inspection|repair)\w*\b/u.test(requestText)) {
        add('diy.stackexchange.com');
      }
    }

    const energyAssetOperationsRequest =
      /\b(?:energy|electricity|power|grid|utility|utilities)\w*\b/u.test(requestText) &&
      /\b(?:infrastructure|assets?|equipment|maintenance|outages?|reliability|condition|repair|investment|upgrades?|operational risk)\w*\b/u.test(requestText);
    if (energyAssetOperationsRequest && !this.isTechnicalRequest(input)) {
      add('sustainability.stackexchange.com');
      add('engineering.stackexchange.com');
    }

    /*
     * Generic fallback routing for previously unseen request domains. The
     * decision is based on workflow/pain vocabulary instead of a domain name,
     * so new requests still reach a relevant community without another
     * hard-coded vertical.
     */
    if (sites.length === 0 && requestText) {
      if (/\b(?:security|fraud|scam|unauthorized|account|authentication|breach|threat|attack|compromise|suspicious)\w*\b/u.test(requestText)) {
        add('security.stackexchange.com');
      }
      if (/\b(?:cost|revenue|profit|margin|pricing|payment|budget|financial|finance|investment)\w*\b/u.test(requestText)) {
        add('money.stackexchange.com');
      }
      if (/\b(?:restoration|restore|conservation|conservator|repair|material|surface|finish|treatment|craft|artisan|workshop|damage|mounting|paper|ink)\w*\b/u.test(requestText)) {
        add('crafts.stackexchange.com');
        add('diy.stackexchange.com');
      }
      if (/\b(?:energy|environment|waste|sustainability|agriculture|farm|emission|resource efficiency)\w*\b/u.test(requestText)) {
        add('sustainability.stackexchange.com');
      }
      if (/\b(?:staff|employee|workload|assignment|scheduling|workplace|team coordination|availability)\w*\b/u.test(requestText)) {
        add('workplace.stackexchange.com');
      }
      if (
        /\b(?:rental|rentals|hire)\w*\b/u.test(requestText) &&
        /\b(?:deposit|charge|charges|charging|refund|payment|fee|fees)\w*\b/u.test(requestText)
      ) {
        add('money.stackexchange.com');
      }
      if (this.isTechnicalRequest(input)) {
        add('softwareengineering.stackexchange.com');
      }
    }

    return sites.slice(0, 2);
  }

  private isProfessionalProblemRequest(input: CollectorInput): boolean {
    const text = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ].join(' '));

    if (!text) return false;

    const professionalActor = /\b(?:restoration specialists?|restorers?|conservators?|manuscript conservators?|paper conservators?|document conservators?|craftsmen?|artisans?|bookbinders?|seamstresses?|dressmakers?|tailors?|shoemakers?|cobblers?|sneaker cleaners?|shoe cleaners?|sneaker cleaning specialists?|shoe cleaning specialists?|sneaker restoration specialists?|shoe restoration specialists?|frame gilding specialists?|frame gilders?|gilders?|gilding workshops?|restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|restaurant managers?|restaurant operators?|restaurant chains?|commercial kitchens?|framers?|picture framing|custom framing|workshops?|logistics companies?|logistics providers?|freight operators?|3pl providers?|transportation companies?|fleet operators?|sign language interpretation agenc(?:y|ies)|sign language interpreting agenc(?:y|ies)|asl interpreting agenc(?:y|ies)|interpreter agenc(?:y|ies)|language service providers?)\b/u.test(text);
    const operationalWorkflow = /\b(?:customer approvals?|approved specifications?|repair notes?|restoration notes?|material selections?|material types?|gold[- ]leaf|gold leaf|surface preparation|damaged decorative|color matching|colour matching|stain conditions?|cleaning preferences?|previous treatments?|service history|handwritten tags?|paper tags?|pickup deadlines?|misplaced items?|forgotten requests?|repeated treatments?|repeated work|finish preferences?|measurements?|revision requests?|completion dates?|damaged manuscripts?|missing pages?|handwritten annotations?|marginalia|previous repairs?|paper types?|condition reports?|treatment records?|approved treatment|client instructions?|customer instructions?|restoration progress|conservation treatment|suspicious orders?|account takeover|refund abuse|promotional abuse|promo code abuse|device signals?|payment behavior|security alerts?|false positives?|operating costs?|energy costs?|utility costs?|utility bills?|refrigeration|cooking equipment|kitchen equipment|equipment failures?|maintenance records?|food waste|ingredient waste|fuel expenses?|warehouse costs?|failed deliveries?|vehicle maintenance|route performance|profit margins?|pricing decisions?|financial forecasts?|interpreter availability|interpreter scheduling|assignment details?|assignment matching|client communication preferences?|specialized vocabulary|session notes?|last[- ]minute schedule changes?|scheduling conflicts?|missed assignments?|client requirements?)\b/u.test(text);
    const genericPhysicalServiceActor =
      /\b(?:repair|restoration|conservation|refinishing|alteration|custom fabrication|leatherwork|woodwork|metalwork|craft|artisan|workshop|specialists?|technicians?)\w*\b/u.test(text);
    const genericPhysicalServiceWorkflow =
      /\b(?:condition|damage|stitching|fitting|adjustment|replacement|hardware|parts?|materials?|finish|previous repairs?|repair history|service history|customer preferences?|client preferences?|customer requests?|client requests?|notes?|photographs?|photos?|samples?|completion dates?|pickup dates?|delayed pickups?|rework|repeated adjustments?)\w*\b/u.test(text);
    const rentalInventoryActor =
      /\b(?:rental|rentals|hire)\s+(?:shops?|stores?|businesses?|services?|companies?)\b|\b(?:shops?|stores?|businesses?|services?|companies?)\b[^.!?]{0,60}\b(?:rental|rentals|hire)\b/u.test(text);
    const rentalInventoryWorkflow =
      /\b(?:rental periods?|availability|available|return dates?|expected returns?|deposits?|accessories|condition|damage|maintenance history|servicing|service history|double bookings?|reservation|reservations|booking|bookings|incorrect charges?|late returns?)\w*\b/u.test(text);

    return (
      (professionalActor && operationalWorkflow) ||
      (genericPhysicalServiceActor && genericPhysicalServiceWorkflow) ||
      (rentalInventoryActor && rentalInventoryWorkflow)
    );
  }

  private async searchStackExchange(
    site: string,
    query: string,
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    if (ForumCollector.stackExchangeCircuitOpenUntil > Date.now()) {
      return [];
    }

    try {
      const response = await axios.get<StackExchangeSearchResponse>(
        'https://api.stackexchange.com/2.3/search/advanced',
        {
          params: {
            site,
            q: query,
            sort: 'relevance',
            order: 'desc',
            pagesize: Math.min(this.maxFetchedPosts, 10),
            filter: 'withbody',
          },
          headers: {
            Accept: 'application/json',
            'User-Agent': 'NexoraAI-Graduation-Project',
          },
          timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_600 : 3_300,
        },
      );

      const questions = Array.isArray(response.data?.items)
        ? [...response.data.items]
        : [];
      return questions
        .filter((question) => Boolean(question.question_id && question.title))
        .slice(0, this.maxFetchedPosts)
        .map((question): CollectorPost => {
          const title = this.cleanPlainText(question.title);
          const body = this.cleanPlainText(question.body);
          return {
            externalId: `stackexchange:${site}:${question.question_id}`,
            title,
            content: body || title,
            author: this.cleanPlainText(question.owner?.display_name) || site,
            url: question.link,
            country: input.country,
            city: input.city,
            region: input.region,
            languageCode: this.resolveStoredLanguageCode(input.language),
            likesCount: Math.max(0, question.score ?? 0),
            repliesCount: Math.max(0, question.answer_count ?? 0),
            publishedAt: question.creation_date
              ? new Date(question.creation_date * 1000)
              : undefined,
            tags: [...(question.tags ?? []), site],
            comments: [],
          };
        });
    } catch (error: unknown) {
      const errorMessage = this.getErrorMessage(error);
      if (/\b429\b|rate limit|too many requests/iu.test(errorMessage)) {
        ForumCollector.stackExchangeCircuitOpenUntil = Math.max(
          ForumCollector.stackExchangeCircuitOpenUntil,
          Date.now() + 60_000,
        );
      }
      this.logger.debug(
        `Stack Exchange forum query skipped | site=${site} | query=${query} | error=${errorMessage}`,
      );
      return [];
    }
  }

  private async collectSequentially(
    sources: readonly ForumSource[],
    searchQuery: string,
    input: CollectorInput,
  ): Promise<PromiseSettledResult<CollectorPost[]>[]> {
    const results: PromiseSettledResult<CollectorPost[]>[] = [];

    for (const source of sources) {
      try {
        const posts = await source.adapter.collect(
          source.url,
          searchQuery,
          input,
        );
        results.push({ status: 'fulfilled', value: posts });
      } catch (reason: unknown) {
        results.push({ status: 'rejected', reason });
      }
    }

    return results;
  }

  /**
   * Removes duplicate forum posts and ranks them.
   */
  private rankAndDeduplicatePosts(
    posts: CollectorPost[],
    input: CollectorInput,
  ): CollectorPost[] {
    const seenPostIds = new Set<string>();

    return posts
      .filter((post) => {
        const key = `${post.url ?? ''}-${post.externalId}`;

        if (seenPostIds.has(key)) {
          return false;
        }

        seenPostIds.add(key);

        return true;
      })
      .map((post) => ({
        post,
        score: this.calculatePostRelevanceScore(post, input),
      }))
      .filter((item) => item.score >= 3)
      .sort((first, second) => second.score - first.score)
      .slice(0, this.maxSavedPosts)
      .map((item) => item.post);
  }

  /**
   * Builds the forum search query.
   */
  private buildSearchQuery(input: CollectorInput): string {
    const plannedQuery = (input.plannedQueries ?? [])
      .map((query) => this.cleanNormalizedText(query))
      .find(Boolean);
    if (plannedQuery) {
      return plannedQuery.split(/\s+/u).slice(0, 10).join(' ');
    }

    const domainKeywords = this.getDomainKeywords(input);

    const fallbackDomain = input.domainName
      ? [this.cleanNormalizedText(input.domainName)]
      : [];

    const userKeywords = (input.keywords ?? [])
      .map((keyword) => this.cleanNormalizedText(keyword))
      .filter(Boolean);

    return this.unique([...userKeywords, ...domainKeywords, ...fallbackDomain])
      .slice(0, 4)
      .join(' ');
  }

  /**
   * Calculates forum-post relevance.
   */
  private calculatePostRelevanceScore(
    post: CollectorPost,
    input: CollectorInput,
  ): number {
    return RelevanceScoreUtil.scoreText({
      title: post.title,
      body: post.content,
      domainTerms: this.getDomainKeywords(input),
      problemTerms: this.getProblemWords(),
      likes: post.likesCount ?? 0,
      replies: post.repliesCount ?? 0,
      publishedAt: post.publishedAt,
    });
  }

  /**
   * Reads forum-specific blocked words.
   */
  protected getBlockedWords(): string[] {
    return super.getBlockedWords('FORUM_BLOCKED_WORDS');
  }

  /**
   * Extracts a safe error message.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown Forum collector error.';
  }
}