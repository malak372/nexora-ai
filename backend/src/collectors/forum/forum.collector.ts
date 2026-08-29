import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Parser from 'rss-parser';

import { BaseCollector } from '../base/base.collector';
import {
  type CollectorRequestSupportInput,
  SocialCollector,
} from '../base/collector.interface';

import { CollectorInput, CollectorPost } from '../base/collector.types';

import { RelevanceScoreUtil } from '../base/relevance-score.util';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';
import { CollectorAbortContextUtil } from '../base/collector-abort-context.util';
import { RequestWorkflowIntentProfileUtil } from '../../ideas/generation/utils/request-workflow-intent-profile.util';
import { RequestNicheCustomCraftUtil } from '../../ideas/generation/utils/request-niche-custom-craft.util';
import { RequestOnlinePharmacyFraudUtil } from '../../ideas/generation/utils/request-online-pharmacy-fraud.util';
import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';
import { RequestEvidenceAlignmentUtil } from '../../ideas/generation/utils/request-evidence-alignment.util';

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


type ForumSearchRssItem = {
  readonly title?: string;
  readonly link?: string;
  readonly content?: string;
  readonly contentSnippet?: string;
  readonly pubDate?: string;
  readonly isoDate?: string;
  readonly creator?: string;
  readonly author?: string;
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

  private readonly rssParser = new Parser();

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
    if (this.resolveDirectForumDomains(input).length > 0) return true;
    if (this.shouldDiscoverSpecialistForums(input)) return true;
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
      const directForumDomains = isBoundedGeneration
        ? this.resolveDirectForumDomains(input).slice(0, isTargetedRecovery ? 2 : 3)
        : [];

      const specialistDiscoveryEnabled =
        isBoundedGeneration &&
        !technicalRequest &&
        this.shouldDiscoverSpecialistForums(input);
      this.logger.debug(
        `Forum source plan | collectionMode=${input.collectionMode ?? 'STANDARD'} | bounded=${isBoundedGeneration} | discourse=${sources.map((source) => source.url).join(',') || 'none'} | stackExchange=${stackExchangeSites.join(',') || 'none'} | webForums=${directForumDomains.join(',') || 'none'} | specialistDiscovery=${specialistDiscoveryEnabled}`,
      );

      const [results, stackExchangePosts, directForumPosts, specialistDiscoveryPosts] = await Promise.all([
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
        isBoundedGeneration
          ? this.collectFromDirectForumDomains(input, directForumDomains)
          : Promise.resolve<CollectorPost[]>([]),
        specialistDiscoveryEnabled
          ? this.collectFromSpecialistForumDiscovery(input)
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
        [...specialistDiscoveryPosts, ...directForumPosts, ...stackExchangePosts, ...discoursePosts],
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
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    })
      .map((query) =>
        input.authoritativePlannedQueries
          ? query.trim()
          : query.split(/\s+/u).slice(0, 7).join(' '),
      )
      .filter(Boolean)
      .slice(0, input.collectionMode === 'TARGETED_RECOVERY' ? 2 : 3);

    if (queries.length === 0) return [];

    /*
     * Preserve every authoritative source-plan query. The previous multi-site
     * branch executed only queries[0], so a PRIMARY plan carrying three AI
     * queries could silently lose queries[1]/queries[2] before any HTTP call.
     * Distribute the bounded query set across resolved sites instead of taking
     * the Cartesian product; this keeps all planner intent while retaining the
     * same small request budget.
     */
    const requests = queries.map((query, index) =>
      this.searchStackExchange(sites[index % sites.length], query, input),
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
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    })
      .map((query) => query.split(/\s+/u).slice(0, 5).join(' '))
      .filter(Boolean)
      .filter((query) => !attempted.has(query.toLocaleLowerCase()))
      .slice(0, 2);

    if (fallbackQueries.length === 0) return firstPass;
    const fallbackRequests = sites.flatMap((site) =>
      fallbackQueries.slice(0, 1).map((query) =>
        this.searchStackExchange(site, query, input),
      ),
    );
    const fallbackSettled = await Promise.allSettled(fallbackRequests);
    return [
      ...firstPass,
      ...fallbackSettled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      ),
    ];
  }

  /**
   * Converts executable forum routing hints into concrete public domains.
   * Label-only hints are supported for a small set of well-known specialist
   * communities; URL/domain hints work generically without a code change.
   */
  private resolveDirectForumDomains(input: CollectorRequestSupportInput): string[] {
    const domains: string[] = [];
    const add = (value: string) => {
      const normalized = value
        .trim()
        .toLocaleLowerCase()
        .replace(/^https?:\/\//u, '')
        .replace(/^www\./u, '')
        .split('/')[0]
        ?.replace(/[^a-z0-9.-]/gu, '');
      if (!normalized || !normalized.includes('.')) return;
      if (!domains.includes(normalized)) domains.push(normalized);
    };

    const aiOwnedGenerationPlan = (input.plannedQueries ?? []).some((query) => query.trim().length > 0);
    if (aiOwnedGenerationPlan) {
      for (const hint of input.sourceHints ?? []) {
        const urlMatch = hint.match(/https?:\/\/([^/\s]+)/iu);
        const domainMatch = hint.match(/\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/iu);
        if (urlMatch?.[1]) add(urlMatch[1]);
        else if (domainMatch?.[1]) add(domainMatch[1]);
      }
      return domains.slice(0, 4);
    }

    const knownLabels: ReadonlyArray<readonly [RegExp, string]> = [
      [/\bfountain pen network\b/iu, 'fountainpennetwork.com'],
      [/\bfpgeeks?\b/iu, 'fpgeeks.com'],
      [/\bphoto\.net\b/iu, 'photo.net'],
      [/\bwatchuseek\b/iu, 'watchuseek.com'],
      [/\bthe fedora lounge\b/iu, 'thefedoralounge.com'],
      [/\b(?:ganoksin orchid|orchid jewelry forum|orchid forum|ganoksin)\b/iu, 'orchid.ganoksin.com'],
      [/\b(?:leatherworker\.net|leatherworker forum|leather worker forum)\b/iu, 'leatherworker.net'],
      [/\b(?:new ag talk|newagtalk|ag talk)\b/iu, 'talk.newagtalk.com'],
      [/\b(?:den of angels|denofangels)\b/iu, 'denofangels.com'],
    ];

    for (const hint of input.sourceHints ?? []) {
      const urlMatch = hint.match(/https?:\/\/([^/\s]+)/iu);
      const domainMatch = hint.match(/\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/iu);
      if (urlMatch?.[1]) add(urlMatch[1]);
      else if (domainMatch?.[1]) add(domainMatch[1]);
      for (const [pattern, domain] of knownLabels) {
        if (pattern.test(hint)) add(domain);
      }
    }

    const request = this.cleanNormalizedText(input.requestDescription ?? '');
    if (/\b(?:fountain pen|fountain pens|nib repair|pen restoration|pen repair)\b/u.test(request)) {
      add('fountainpennetwork.com');
    }
    if (
      /\b(?:antique|vintage|historic|heirloom)\s+(?:jewelry|jewellery|ring|rings|pendant|bracelet|necklace|brooch)|\b(?:jewelry|jewellery)\s+(?:restoration|repair)|\bbench jeweler\b/u.test(
        request,
      )
    ) {
      add('orchid.ganoksin.com');
    }
    if (
      /\b(?:shoe restoration|shoe repair|shoe repairer|shoe repairers|cobbler|cobblers|footwear repair|boot repair|sneaker restoration|leather shoe repair|resoling|re-?soling)\b/u.test(
        request,
      )
    ) {
      add('leatherworker.net');
    }
    if (
      /\b(?:eyeglass frame repair|eyeglass repair|eyewear repair|optical frame repair|spectacle frame repair|glasses repair)\b/u.test(request)
    ) {
      add('optiboard.com');
    }
    if (
      /\b(?:agricultural distributors?|produce distributors?|fresh produce distributors?|crop distributors?|agricultural wholesalers?|produce wholesalers?)\b/u.test(request) &&
      /\b(?:storage|warehouse|transport|delivery|spoilage|market price|profitability|margin|route)\w*\b/u.test(request)
    ) {
      add('talk.newagtalk.com');
    }
    for (const domain of RequestNicheCustomCraftUtil.preferredForumDomains(
      input.requestDescription,
    )) {
      add(domain);
    }

    return domains.slice(0, 4);
  }

  private shouldDiscoverSpecialistForums(
    input: CollectorRequestSupportInput,
  ): boolean {
    const request = this.cleanNormalizedText(input.requestDescription ?? '');
    if (!request || this.isTechnicalRequest(input)) return false;

    // In AI-owned generation, selecting the forum collector means the planner
    // believes practitioner/community discussion is useful. Discover a
    // specialist forum generically from the planned queries instead of
    // requiring another hard-coded vertical/archetype match. Final admission
    // still goes through the canonical evidence verifier.
    if ((input.plannedQueries ?? []).some((query) => query.trim().length > 0)) {
      return true;
    }

    const workflowProfile = RequestWorkflowIntentProfileUtil.resolve(
      input.requestDescription,
    );
    if (workflowProfile.restorationIntent) return true;
    if (RequestNicheCustomCraftUtil.resolve(input.requestDescription)) return true;
    if (RequestOnlinePharmacyFraudUtil.isRequest(input.requestDescription)) return true;
    if (
      /\b(?:agricultural distributors?|produce distributors?|fresh produce distributors?|crop distributors?|agricultural wholesalers?|produce wholesalers?)\b/u.test(request) &&
      /\b(?:storage|warehouse|transport|delivery|spoilage|market price|profitability|margin|route|crop|produce)\w*\b/u.test(request)
    ) {
      return true;
    }
    if (
      /\b(?:travel compan(?:y|ies)|travel agenc(?:y|ies)|tour operators?|tour compan(?:y|ies)|tour packages?)\b/u.test(request) &&
      /\b(?:profitability|margin|pricing|supplier fees?|partner invoices?|cancellations?|refunds?|booking changes?|seasonal demand|transportation costs?)\w*\b/u.test(request)
    ) {
      return true;
    }
    if (
      /\b(?:sports rehabilitation centers?|rehabilitation centers?|rehab centers?|sports medicine|physical therapists?|physiotherapists?|athletic trainers?)\b/u.test(
        request,
      ) &&
      /\b(?:athletes?|recovery|rehabilitation|wearable|pain reports?|mobility|remote monitoring|return to play|reinjury)\b/u.test(
        request,
      )
    ) {
      return true;
    }

    if (
      /\b(?:urban healthcare networks?|healthcare networks?|hospital networks?|emergency departments?|ambulance services?|clinics?)\b/u.test(request) &&
      /\b(?:patient demand|hospital capacity|ambulance availability|overcrowd(?:ed|ing)?|response times?|resource allocation|delayed patient care|care gaps?)\b/u.test(request)
    ) {
      return true;
    }

    const text = this.cleanNormalizedText([
      input.domainName ?? '',
      ...(input.sourceHints ?? []),
    ].join(' '));
    return /\b(?:specialist|specialists|restoration|conservation|repair|collector community|professional forum|industry forum|practitioner forum)\b/u.test(text);
  }

  private buildSpecialistForumDiscoveryQueries(
    input: CollectorInput,
  ): string[] {
    const workflowProfile = RequestWorkflowIntentProfileUtil.resolve(
      input.requestDescription,
    );
    const queries: string[] = [];
    const add = (value: string) => {
      const cleaned = value.replace(/\s+/gu, ' ').trim();
      if (!cleaned) return;
      const key = cleaned.toLocaleLowerCase();
      if (!queries.some((item) => item.toLocaleLowerCase() === key)) {
        queries.push(cleaned);
      }
    };

    if ((input.plannedQueries ?? []).some((query) => query.trim().length > 0)) {
      for (const hint of input.sourceHints ?? []) {
        if (/https?:\/\//iu.test(hint) || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/iu.test(hint)) continue;
        add(`${hint.split(/\s+/u).slice(0, 8).join(' ')} forum discussion`);
      }
      for (const query of input.plannedQueries ?? []) {
        const compact = query.split(/\s+/u).filter(Boolean).slice(0, 9).join(' ');
        add(`${compact} forum discussion`);
        add(`${compact} practitioner community`);
        if (queries.length >= 5) break;
      }
      return queries.slice(0, 5);
    }

    if (workflowProfile.restorationIntent && workflowProfile.restorationSubject) {
      const subject = workflowProfile.restorationSubject;
      add(`${subject} restoration forum discussion repair`);
      add(`${subject} conservation community restoration`);
      add(`${subject} restoration condition treatment documentation repair history`);
      add(`${subject} restoration condition assessment specifications forum`);
      add(`${subject} conservation previous intervention replacement material discussion`);
      if (/\b(?:porcelain|ceramic|china)\b/iu.test(subject)) {
        add('porcelain restoration ceramic conservation forum glaze crack repair history');
        add('china repair ceramics conservation community treatment documentation');
        add('museum ceramics conservation porcelain condition restoration records');
      }
      if (/\b(?:shoe|footwear|boot|sneaker|leather shoe)\b/iu.test(subject)) {
        add('cobbler shoe repair forum material matching color restoration records');
        add('shoe repair workshop restoration history customer notes leather sole stitching');
        add('footwear restoration rework wrong materials color matching customer request');
      }
    }

    const request = this.cleanNormalizedText(input.requestDescription ?? '');
    if (
      /\b(?:eyeglass frame repair|eyeglass repair|eyewear repair|optical frame repair|spectacle frame repair|glasses repair)\b/u.test(request)
    ) {
      add('eyeglass frame repair forum hinge replacement repeated adjustment repair history');
      add('optician optical frame repair workshop replacement parts customer fit notes');
      add('spectacle frame repair technician repair history wrong parts color matching');
      add('eyewear repair shop customer adjustment records delayed repair');
    }
    if (
      /\b(?:agricultural distributors?|produce distributors?|fresh produce distributors?|crop distributors?|agricultural wholesalers?|produce wholesalers?)\b/u.test(request) &&
      /\b(?:storage|warehouse|transport|delivery|spoilage|market price|profitability|margin|route|crop|produce)\w*\b/u.test(request)
    ) {
      add('agricultural distributor crop profitability storage transport cost forum discussion');
      add('produce distributor spoilage warehouse delivery cost margin forum discussion');
      add('fresh produce distribution market price route profitability forum discussion');
      add('agriculture supply chain storage loss transport pricing distributor forum');
    }
    if (
      /\b(?:travel compan(?:y|ies)|travel agenc(?:y|ies)|tour operators?|tour compan(?:y|ies)|tour packages?)\b/u.test(request) &&
      /\b(?:profitability|margin|pricing|supplier fees?|partner invoices?|cancellations?|refunds?|booking changes?|seasonal demand|transportation costs?)\w*\b/u.test(request)
    ) {
      add('tour operator forum package profitability supplier fees cancellations');
      add('travel agency forum tour pricing booking changes margins');
      add('tour operator community transportation supplier cost package profit');
      add('travel business forum refunds seasonal demand package profitability');
    }
    for (const query of RequestOnlinePharmacyFraudUtil.buildSourceQueries('forum')) {
      if (RequestOnlinePharmacyFraudUtil.isRequest(input.requestDescription)) {
        add(`${query} forum discussion`);
      }
    }
    for (const query of RequestNicheCustomCraftUtil.buildSourceQueries(
      input.requestDescription,
      'forum',
    )) {
      add(`${query} forum discussion`);
    }
    if (
      /\b(?:sports rehabilitation centers?|rehabilitation centers?|rehab centers?|sports medicine|physical therapists?|physiotherapists?|athletic trainers?)\b/u.test(
        request,
      )
    ) {
      add('sports medicine rehabilitation forum athlete recovery monitoring');
      add('physical therapy forum remote rehabilitation athlete pain mobility');
      add('athletic trainer forum return to play rehabilitation monitoring');
      add('sports injury rehabilitation practitioner forum wearable sensor recovery');
      add('physiotherapy community outpatient athlete recovery tracking');
    }

    for (const hint of input.sourceHints ?? []) {
      if (/https?:\/\//iu.test(hint) || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/iu.test(hint)) continue;
      add(`${hint.split(/\s+/u).slice(0, 7).join(' ')} forum discussion`);
      if (queries.length >= 5) break;
    }

    for (const query of input.plannedQueries ?? []) {
      add(`${query.split(/\s+/u).slice(0, 7).join(' ')} forum discussion`);
      if (queries.length >= 5) break;
    }

    return queries.slice(0, 5);
  }

  private async collectFromSpecialistForumDiscovery(
    input: CollectorInput,
  ): Promise<CollectorPost[]> {
    const queries = this.buildSpecialistForumDiscoveryQueries(input);
    if (queries.length === 0) return [];

    const blockedHosts = new Set([
      'reddit.com', 'facebook.com', 'instagram.com', 'linkedin.com',
      'youtube.com', 'pinterest.com', 'quora.com', 'stackoverflow.com',
      'stackexchange.com', 'medium.com',
    ]);
    const settled = await Promise.allSettled(
      queries.map(async (query, queryIndex) => {
        const response = await axios.get<string>('https://www.bing.com/search', {
          params: { q: query, format: 'rss', count: 10 },
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'Voxidence-Evidence-Collector/1.0',
          },
          responseType: 'text',
          timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_600 : 3_000,
          signal: CollectorAbortContextUtil.getSignal(),
        });
        const feed = await this.rssParser.parseString(response.data);
        return (feed.items ?? [])
          .map((raw, itemIndex): CollectorPost | null => {
            const item = raw as ForumSearchRssItem;
            const link = item.link?.trim() ?? '';
            if (!link) return null;
            let url: URL;
            try {
              url = new URL(link);
            } catch {
              return null;
            }
            const host = url.hostname.replace(/^www\./u, '').toLocaleLowerCase();
            if ([...blockedHosts].some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
              return null;
            }
            const title = this.cleanPlainText(item.title);
            const content = this.cleanPlainText(item.contentSnippet ?? item.content) || title;
            const candidateText = `${title} ${content}`;
            if (!this.passesSpecialistDiscoveryIdentityGate(input, candidateText, host)) {
              return null;
            }
            const discussionSignal = this.cleanNormalizedText(
              `${host} ${url.pathname} ${title} ${content.slice(0, 240)}`,
            );
            if (!/\b(?:forum|forums|community|discussion|discussions|thread|threads|topic|topics|message board|bulletin board|members?)\b/u.test(discussionSignal)) {
              return null;
            }
            if (!title || content.length < 24) return null;
            const externalKey = Buffer.from(link).toString('base64url').slice(0, 120);
            return {
              externalId: `specialist-discovery:${queryIndex}:${itemIndex}:${externalKey}`,
              title,
              content,
              author: this.cleanPlainText(item.creator ?? item.author) || host,
              url: link,
              country: input.country, city: input.city, region: input.region,
              languageCode: this.resolveStoredLanguageCode(input.language),
              likesCount: 0, repliesCount: 0,
              publishedAt: this.parseDate(item.isoDate ?? item.pubDate),
              tags: [host, 'specialist-forum-discovery'],
              comments: [],
            };
          })
          .filter((post): post is CollectorPost => Boolean(post));
      }),
    );

    return settled
      .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .slice(0, this.maxFetchedPosts);
  }

  private async collectFromDirectForumDomains(
    input: CollectorInput,
    domains: readonly string[],
  ): Promise<CollectorPost[]> {
    if (domains.length === 0) return [];

    const queries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    })
      .map((query) =>
        input.authoritativePlannedQueries
          ? query.trim()
          : query.split(/\s+/u).slice(0, 8).join(' '),
      )
      .filter(Boolean)
      .slice(0, 2);
    if (queries.length === 0) return [];

    const requests = domains.flatMap((domain, domainIndex) =>
      queries
        .slice(0, domains.length > 1 ? 1 : 2)
        .map((query) => this.searchDirectForumDomain(domain, query, input, domainIndex)),
    );
    const settled = await Promise.allSettled(requests);
    return settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
  }

  private async searchDirectForumDomain(
    domain: string,
    query: string,
    input: CollectorInput,
    domainIndex: number,
  ): Promise<CollectorPost[]> {
    const search = `site:${domain} ${query}`;
    try {
      const response = await axios.get<string>('https://www.bing.com/search', {
        params: { q: search, format: 'rss', count: Math.min(this.maxFetchedPosts, 8) },
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'Voxidence-Evidence-Collector/1.0',
        },
        responseType: 'text',
        timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_200 : 2_600,
        signal: CollectorAbortContextUtil.getSignal(),
      });
      const feed = await this.rssParser.parseString(response.data);
      return (feed.items ?? [])
        .map((raw, index): CollectorPost | null => {
          const item = raw as ForumSearchRssItem;
          const link = item.link?.trim() ?? '';
          if (!link) return null;
          let host = '';
          try {
            host = new URL(link).hostname.replace(/^www\./u, '').toLocaleLowerCase();
          } catch {
            return null;
          }
          if (host !== domain && !host.endsWith(`.${domain}`)) return null;
          const title = this.cleanPlainText(item.title);
          const content = this.cleanPlainText(item.contentSnippet ?? item.content) || title;
          if (!title || content.length < 20) return null;
          if (!this.passesSpecialistDiscoveryIdentityGate(input, `${title} ${content}`, host)) {
            return null;
          }
          const externalKey = Buffer.from(link).toString('base64url').slice(0, 120);
          return {
            externalId: `webforum:${domainIndex}:${index}:${externalKey}`,
            title,
            content,
            author: this.cleanPlainText(item.creator ?? item.author) || domain,
            url: link,
            country: input.country,
            city: input.city,
            region: input.region,
            languageCode: this.resolveStoredLanguageCode(input.language),
            likesCount: 0,
            repliesCount: 0,
            publishedAt: this.parseDate(item.isoDate ?? item.pubDate),
            tags: [domain, 'specialist-forum'],
            comments: [],
          };
        })
        .filter((post): post is CollectorPost => Boolean(post))
        .slice(0, this.maxFetchedPosts);
    } catch (error: unknown) {
      this.logger.debug(
        `Direct forum web search skipped | domain=${domain} | query=${query} | error=${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private passesSpecialistDiscoveryIdentityGate(
    input: CollectorRequestSupportInput,
    candidateText: string,
    host: string,
  ): boolean {
    const request = input.requestDescription ?? '';
    const evidence = this.cleanNormalizedText(candidateText);
    if (!evidence) return false;

    if (RequestOnlinePharmacyFraudUtil.isRequest(request)) {
      return RequestOnlinePharmacyFraudUtil.isPlausibleRetrievalCandidate(
        request,
        evidence,
      );
    }

    if (RequestNicheCustomCraftUtil.resolve(request)) {
      return RequestNicheCustomCraftUtil.isPlausibleRetrievalCandidate(
        request,
        evidence,
      );
    }

    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: request,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries ?? [],
    });
    if (constraint.strict) {
      const classification = RequestEvidenceAlignmentUtil.classifyForRequestFallback({
        requestDescription: request,
        evidenceText: evidence,
        plannedQueries: input.plannedQueries ?? [],
      });
      if (classification !== 'UNRELATED') return true;
      return (
        RequestVerticalConstraintUtil.matchesVertical(evidence, constraint) &&
        RequestVerticalConstraintUtil.matchesWorkflow(evidence, constraint)
      );
    }

    return true;
  }

  private isWatchStrapCraftRequest(value: string): boolean {
    const request = this.cleanNormalizedText(value);
    return (
      /\b(?:watch straps?|watch bands?|leather watch straps?|leather watch bands?|watch strap makers?|watch band makers?|bespoke straps?)\b/u.test(request) &&
      /\b(?:wrist measurements?|wrist sizes?|strap lengths?|strap widths?|lug widths?|leather|materials?|stitching|buckles?|design revisions?|customer approvals?|approved specifications?|wrong sizes?|sizing errors?|remakes?|rework|wasted leather|delayed orders?)\b/u.test(request)
    );
  }

  private resolveStackExchangeSites(input: CollectorRequestSupportInput): string[] {
    const requestText = this.cleanNormalizedText(input.requestDescription ?? '');
    const routingIdentityText = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
    ].join(' '));
    const text = this.cleanNormalizedText([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.domainKeywords ?? []),
      ...(input.keywords ?? []),
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ].join(' '));

    const nicheCustomCraft = RequestNicheCustomCraftUtil.resolve(input.requestDescription);
    const requestWorkflowProfile = RequestWorkflowIntentProfileUtil.resolve(
      input.requestDescription,
    );

    const sites: string[] = [];
    const add = (site: string) => {
      if (!sites.includes(site)) sites.push(site);
    };

    if ((input.plannedQueries ?? []).some((query) => query.trim().length > 0)) {
      for (const hint of input.sourceHints ?? []) {
        const normalized = hint
          .trim()
          .toLocaleLowerCase()
          .replace(/^https?:\/\//u, '')
          .replace(/^www\./u, '')
          .split('/')[0] ?? '';
        if (/^(?:[a-z0-9-]+\.)?stackexchange\.com$/u.test(normalized)) add(normalized);
        else if (['stackoverflow.com', 'serverfault.com', 'superuser.com', 'askubuntu.com'].includes(normalized)) add(normalized);
      }
      return sites.slice(0, 2);
    }

    if (nicheCustomCraft && !this.isTechnicalRequest(input)) {
      add('crafts.stackexchange.com');
    }

    if (RequestOnlinePharmacyFraudUtil.isRequest(input.requestDescription)) {
      for (const site of RequestOnlinePharmacyFraudUtil.preferredStackExchangeSites()) {
        add(site);
      }
    }

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
      // Platform fraud is a security/operations workflow. Money.SE is aimed at
      // personal finance and creates bank/consumer noise for professional
      // restaurant/delivery fraud investigations.
      add('security.stackexchange.com');
    }
    if (
      /\b(?:sports rehabilitation centers?|rehabilitation centers?|rehab centers?|sports medicine|physical therapists?|physiotherapists?|athletic trainers?)\b/u.test(requestText) &&
      /\b(?:athletes?|recovery|rehabilitation|wearable|pain reports?|mobility|remote monitoring|return to play|reinjury|training load)\b/u.test(requestText)
    ) {
      add('fitness.stackexchange.com');
      add('medicalsciences.stackexchange.com');
    }

    if (
      /\b(?:government agencies?|government departments?|public sector agencies?|public authorities?|regulatory agencies?|licensing authorities?)\b/u.test(requestText) &&
      /\b(?:licenses?|licences?|certificates?|permits?|official records?|official documents?|approval records?|security logs?)\b/u.test(requestText) &&
      /\b(?:altered|tamper(?:ed|ing)?|unauthorized access|unauthorised access|fraud(?:ulent)?|forged|verification|integrity|audit trail|access logs?)\b/u.test(requestText)
    ) {
      add('security.stackexchange.com');
      add('law.stackexchange.com');
    }

    if (
      /\b(?:urban healthcare networks?|healthcare networks?|hospital networks?|emergency departments?|ambulance services?|clinics?)\b/u.test(requestText) &&
      /\b(?:patient demand|hospital capacity|ambulance availability|overcrowd(?:ed|ing)?|response times?|resource allocation|delayed patient care|care gaps?)\b/u.test(requestText)
    ) {
      add('medicalsciences.stackexchange.com');
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
      /\b(?:agricultural cooperatives?|farm cooperatives?|farmers?|farms?|farm operators?|farm managers?|agricultural enterprises?|crop producers?)\b/u.test(requestText) &&
      /\b(?:water consumption|water use|irrigation|fertilizer|fertiliser|crop losses?|yield losses?|resource use|resource usage|environmental conditions?|weather impacts?|market prices?|input costs?|expenses?|profitability|profit margins?)\b/u.test(requestText)
    ) {
      add('economics.stackexchange.com');
      add('sustainability.stackexchange.com');
    }

    if (
      /\b(?:music box makers?|musical box makers?|custom music box makers?|music box artisans?|mechanical music box makers?)\b/u.test(requestText) &&
      /\b(?:melody|tune|mechanism|wood|engraving|decorative details?|dimensions?|design revisions?|approved specifications?|completion deadlines?|commissions?)\b/u.test(requestText) &&
      !this.isTechnicalRequest(input)
    ) {
      add('crafts.stackexchange.com');
      add('woodworking.stackexchange.com');
    }
    if (
      /\b(?:violin bow restoration|violin restoration|violin varnish|luthier|string instrument restoration)\b/u.test(requestText) &&
      /\b(?:restoration|conservation|repair|varnish|coating|surface condition|condition assessment|treatment history|restoration history|previous repairs?|replacement materials?|warped sticks?|worn hair|damaged frogs?|loose fittings?|preservation|documentation|records?|notes?)\b/u.test(requestText)
    ) {
      // Route by the requester workflow before the musical object. Restoration
      // and conservation records belong to craft/physical-treatment forums;
      // Music.SE is appropriate only when the requester is actually asking
      // about performance, setup, playing technique, or musical practice.
      add('crafts.stackexchange.com');
      add('diy.stackexchange.com');
      if (
        !requestWorkflowProfile.restorationIntent &&
        /\b(?:playing technique|performance|setup|tone|intonation|bow hold|bowing|repertoire|music theory)\b/u.test(requestText)
      ) {
        add('music.stackexchange.com');
      }
    }

    if (
      /\b(?:violin case restoration specialists?|violin case restorers?|instrument case restoration specialists?|instrument case restorers?|violin case restoration)\b/u.test(requestText) &&
      /\b(?:damaged hinges?|interior padding|fabric condition|handle repairs?|replacement hardware|previous restoration|restoration history|repeated repairs?|incorrect materials?|overlooked damage)\b/u.test(requestText)
    ) {
      add('crafts.stackexchange.com');
      add('diy.stackexchange.com');
    }

    if (
      /\b(?:vintage camera restoration specialists?|antique camera restoration specialists?|camera restoration specialists?|vintage camera repair specialists?|camera repair technicians?|film camera repair technicians?)\b/u.test(requestText) &&
      /\b(?:mechanical faults?|lens condition|previous repairs?|missing components?|replacement parts?|cosmetic damage|restoration history|repair history|repeated diagnostics?|customer restoration preferences?)\b/u.test(requestText)
    ) {
      add('photo.stackexchange.com');
      add('diy.stackexchange.com');
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

    const explicitPersonalOrInvestmentFinance =
      /\b(?:personal finance|credit cards?|mortgages?|loans?|bank accounts?|consumer banking|salary|income tax|tax return|retirement|debt|investment portfolio|stock investing|property investment|real estate investment|rental property cash flow|landlord mortgage)\b/u.test(requestText);
    if (explicitPersonalOrInvestmentFinance) {
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
    if (
      !requestWorkflowProfile.restorationIntent &&
      /\b(?:guitar repair|guitar technician|guitar technicians|luthier|luthiers|instrument repair|instrument repairs|musical instrument repair|fret wear|neck adjustment|neck adjustments|setup preferences?|repair history|service history)\b/u.test(text)
    ) {
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
    // Generic forum routing is identity-bound. Query/keyword text may mention
    // legal, education, or finance terms incidentally; those retrieval hints
    // must not reroute an AI/Cybersecurity discovery lane to Law.SE.
    if (/\b(?:artificial intelligence|machine learning|\bai\b|large language model|\bllm\b)\b/u.test(routingIdentityText)) {
      add('ai.stackexchange.com');
      add('datascience.stackexchange.com');
    }
    if (/\b(?:cybersecurity|information security|security operations|soc)\b/u.test(routingIdentityText)) {
      add('security.stackexchange.com');
    }
    if (/\b(?:legal|law|contract|compliance)\b/u.test(routingIdentityText)) {
      add('law.stackexchange.com');
    }
    if (/\b(?:education|academic|university|student|research)\b/u.test(routingIdentityText)) {
      add('academia.stackexchange.com');
    }
    if (/\b(?:workplace|human resources|hr policy|employee|employment|faculty workload|teaching workload|course staffing)\b/u.test(routingIdentityText)) {
      add('workplace.stackexchange.com');
    }
    if (/\b(?:sign language interpretation agenc(?:y|ies)|sign language interpreting agenc(?:y|ies)|asl interpreting agenc(?:y|ies)|interpreter agenc(?:y|ies)|language service providers?|interpreter availability|assignment matching|interpreter scheduling)\b/u.test(text)) {
      add('workplace.stackexchange.com');
    }
    if (/\b(?:pet trainer|dog trainer|animal trainer|pet behavior|pet behaviour|dog training|animal behavior|animal behaviour|training exercises?|behavioral triggers?|behavioural triggers?)\b/u.test(text)) {
      add('pets.stackexchange.com');
    }
    if (
      !requestWorkflowProfile.restorationIntent &&
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
      const businessOperationalFinance =
        /\b(?:companies?|businesses?|operators?|agencies|cooperatives?|farms?|farmers?|growers?|agricultural enterprises?|tour packages?|routes?|services?|facilities|departments|suppliers?|bookings?|reservations?)\b/u.test(requestText) &&
        /\b(?:profitability|margin|pricing|budget|operating costs?|supplier fees?|cost drivers?|cost attribution|forecast)\w*\b/u.test(requestText);
      const personalOrTransactionFinance =
        /\b(?:personal finance|credit card|mortgage|loan|bank account|investment|salary|tax|consumer payment|refund dispute|chargeback|payment fraud)\w*\b/u.test(requestText);
      const professionalPlatformAbuse =
        /\b(?:platforms?|streaming|gaming|digital entertainment|restaurant|food delivery|university|healthcare|government|businesses?|companies?)\b/u.test(requestText) &&
        /\b(?:account takeover|account theft|fraudulent subscriptions?|refund abuse|unauthorized refunds?|payment abuse|security alerts?|coordinated fraud|fraud detection)\b/u.test(requestText);
      if (
        /\b(?:cost|revenue|profit|margin|pricing|payment|budget|financial|finance|investment)\w*\b/u.test(requestText) &&
        (!businessOperationalFinance || personalOrTransactionFinance) &&
        !professionalPlatformAbuse
      ) {
        add('money.stackexchange.com');
      }
      const workflowProfile = RequestWorkflowIntentProfileUtil.resolve(
        input.requestDescription,
      );
      const explicitCraftWorkflow =
        /\b(?:restoration|restore|conservation|conservator|repair specialist|repair shop|craft|artisan|workshop|gilding|woodworking|upholstery|custom framing|frame restoration|shoe repair|cobbler)\w*\b/u.test(
          requestText,
        );
      if (workflowProfile.restorationIntent && explicitCraftWorkflow) {
        /*
         * Restoration requests previously skipped the generic craft fallback,
         * which left valid specialist discovery with no StackExchange lane.
         * Crafts carries treatment/material discussions; DIY is a secondary
         * physical-repair lane. Final evidence still passes request identity
         * and Community semantic verification.
         */
        add('crafts.stackexchange.com');
        add('diy.stackexchange.com');
      } else if (explicitCraftWorkflow) {
        add('crafts.stackexchange.com');
        add('diy.stackexchange.com');
      }
      const environmentalSustainabilityWorkflow =
        /\b(?:energy|environment|environmental|sustainability|agriculture|farm|emissions?|resource efficiency|waste management|industrial waste|food waste|municipal waste|material waste reduction)\b/iu.test(
          requestText,
        );
      if (!nicheCustomCraft && environmentalSustainabilityWorkflow) {
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

    return sites
      .filter((site) => this.isStackExchangeSiteCompatible(site, routingIdentityText))
      .slice(0, 2);
  }

  private isStackExchangeSiteCompatible(site: string, requestText: string): boolean {
    const normalizedSite = site.toLocaleLowerCase();

    if (/^money\./u.test(normalizedSite)) {
      const professionalPlatformAbuse =
        /\b(?:platforms?|streaming|gaming|digital entertainment|subscription services?|restaurant|food delivery|marketplace|universit(?:y|ies)|healthcare|government|businesses?|companies?|organizations?)\b/u.test(requestText) &&
        /\b(?:account takeover|account theft|fraudulent subscriptions?|refund abuse|unauthorized refunds?|unauthorised refunds?|payment abuse|security alerts?|coordinated fraud|fraud detection|suspicious activity)\b/u.test(requestText);
      const businessOperationalFinance =
        /\b(?:companies?|businesses?|operators?|agencies|cooperatives?|farms?|farmers?|growers?|agricultural enterprises?|platforms?|services?|packages?|routes?|suppliers?|bookings?|reservations?)\b/u.test(requestText) &&
        /\b(?:profitability|margin|pricing|budget|operating costs?|supplier fees?|cost drivers?|cost attribution|financial forecasts?|revenue leakage)\b/u.test(requestText);
      const explicitPersonalFinance =
        /\b(?:personal finance|credit cards?|mortgages?|loans?|bank accounts?|consumer banking|salary|income tax|tax return|retirement|debt|investment portfolio|stock investing|property investment|real estate investment|rental property cash flow|landlord mortgage)\b/u.test(requestText);
      if ((professionalPlatformAbuse || businessOperationalFinance) && !explicitPersonalFinance) {
        return false;
      }
    }
    if (/^music\./u.test(normalizedSite)) {
      const restorationArtifactRequest = /\b(?:restor\w*|conserv\w*|repair history|previous repairs?|replacement materials?|missing components?|damaged mechanisms?)\b/u.test(requestText);
      const mechanicalMusicBoxRequest = /\b(?:music box|musical box|cylinder music box|disc music box|tune[- ]?cylinder|comb mechanism|governor mechanism|spring mechanism)\b/u.test(requestText);
      const musicBoxCommissionRequest =
        mechanicalMusicBoxRequest &&
        /\b(?:makers?|artisan|custom|commission|melody|mechanism|wood|engraving|dimensions?|design revisions?|customer|client|approved specifications?)\b/u.test(requestText);
      const explicitInstrumentRepairRequest = /\b(?:guitar|violin|piano|flute|woodwind|brass instrument|musical instrument repair|instrument repair|luthier)\b/u.test(requestText);
      if (
        mechanicalMusicBoxRequest &&
        !explicitInstrumentRepairRequest &&
        (restorationArtifactRequest || musicBoxCommissionRequest)
      ) {
        return false;
      }
    }
    const requirements: ReadonlyArray<readonly [RegExp, RegExp]> = [
      [/^music\./u, /\b(?:music|musical|instrument|guitar|violin|piano|orchestra|band|luthier|score|sheet music)\w*\b/u],
      [/^photo\./u, /\b(?:photo|photograph|camera|lens|shutter|image capture)\w*\b/u],
      [/^academia\./u, /\b(?:academic|university|college|research|student|faculty|course|exam)\w*\b/u],
      [/^money\./u, /\b(?:money|finance|financial|payment|transaction|refund|budget|profit|revenue|investment|fraud)\w*\b/u],
      [/^security\./u, /\b(?:security|cyber|fraud|unauthorized|authentication|account takeover|breach|attack|threat|compromise)\w*\b/u],
      [/^cooking\./u, /\b(?:food|cooking|kitchen|restaurant|ingredient|recipe|allergy|refrigeration)\w*\b/u],
      [/^workplace\./u, /\b(?:workplace|employee|staff|workload|assignment|human resources|hr|scheduling)\w*\b/u],
      [/^sustainability\./u, /\b(?:sustainability|environment|energy|water|waste|emission|resource|agriculture|farm)\w*\b/u],
    ];
    for (const [sitePattern, requestPattern] of requirements) {
      if (sitePattern.test(normalizedSite)) return requestPattern.test(requestText);
    }
    return true;
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

  private normalizeStackExchangeApiSite(site: string): string {
    const normalized = site
      .trim()
      .toLocaleLowerCase()
      .replace(/^https?:\/\//u, '')
      .replace(/^www\./u, '')
      .replace(/\/$/u, '');

    const stackExchange = normalized.match(/^([a-z0-9-]+)\.stackexchange\.com$/u);
    if (stackExchange?.[1]) return stackExchange[1];
    if (normalized === 'stackoverflow.com') return 'stackoverflow';
    if (normalized === 'serverfault.com') return 'serverfault';
    if (normalized === 'superuser.com') return 'superuser';
    if (normalized === 'askubuntu.com') return 'askubuntu';
    if (normalized === 'mathoverflow.net') return 'mathoverflow';
    return normalized;
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
      const apiSite = this.normalizeStackExchangeApiSite(site);
      const response = await axios.get<StackExchangeSearchResponse>(
        'https://api.stackexchange.com/2.3/search/advanced',
        {
          params: {
            site: apiSite,
            q: query,
            sort: 'relevance',
            order: 'desc',
            pagesize: Math.min(this.maxFetchedPosts, 10),
            filter: 'withbody',
          },
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Voxidence-Evidence-Collector/1.0',
          },
          timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 2_600 : 3_300,
          signal: CollectorAbortContextUtil.getSignal(),
        },
      );

      const backoffSeconds = Number(response.data?.backoff ?? 0);
      if (Number.isFinite(backoffSeconds) && backoffSeconds > 0) {
        ForumCollector.stackExchangeCircuitOpenUntil = Math.max(
          ForumCollector.stackExchangeCircuitOpenUntil,
          Date.now() + backoffSeconds * 1_000,
        );
      }
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

  /** Parses an optional external publication date without throwing. */
  private parseDate(value?: string): Date | undefined {
    if (!value?.trim()) return undefined;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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