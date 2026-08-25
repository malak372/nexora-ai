import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'node:crypto';

import { BaseCollector } from '../base/base.collector';
import type { SocialCollector } from '../base/collector.interface';
import type { CollectorInput, CollectorPost } from '../base/collector.types';
import { ProblemFirstCollectorQueryUtil } from '../base/problem-first-collector-query.util';
import { CollectorAbortContextUtil } from '../base/collector-abort-context.util';
import { RequestVerticalConstraintUtil } from '../../ideas/generation/utils/request-vertical-constraint.util';
import { RequestNicheCustomCraftUtil } from '../../ideas/generation/utils/request-niche-custom-craft.util';
import { RequestOnlinePharmacyFraudUtil } from '../../ideas/generation/utils/request-online-pharmacy-fraud.util';
import { RequestOperationalCostAttributionUtil } from '../../ideas/generation/utils/request-operational-cost-attribution.util';

type CrossrefWork = {
  DOI?: string;
  URL?: string;
  title?: readonly string[];
  abstract?: string;
  publisher?: string;
  type?: string;
  published?: { 'date-parts'?: readonly (readonly number[])[] };
};

type CrossrefResponse = {
  message?: {
    items?: readonly CrossrefWork[];
  };
};

/**
 * Bounded no-auth scholarly metadata collector.
 *
 * Crossref is a complementary secondary-evidence lane for professional,
 * institutional, industrial, and research-heavy workflows where app-store
 * reviews are unlikely to contain the requested operational problem.
 */
@Injectable()
export class CrossrefCollector extends BaseCollector implements SocialCollector {
  readonly sourceKey = 'crossref';

  private readonly apiUrl = 'https://api.crossref.org/works';
  private static rateLimitCircuitOpenUntil = 0;
  private static readonly RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000;

  constructor(configService: ConfigService) {
    super(configService, CrossrefCollector.name);
  }

  isRuntimeAvailable(): boolean {
    return CrossrefCollector.rateLimitCircuitOpenUntil <= Date.now();
  }

  getRuntimeUnavailableReason(): string | null {
    return this.isRuntimeAvailable()
      ? null
      : 'Crossref temporary rate-limit circuit is currently open.';
  }

  async collect(input: CollectorInput): Promise<CollectorPost[]> {
    if (!this.isRuntimeAvailable()) {
      this.logger.debug(
        'Crossref collection skipped because the temporary rate-limit circuit is open.',
      );
      return [];
    }

    const queryBudget = input.collectionMode === 'TARGETED_RECOVERY' ? 1 : 4;
    const queries = ProblemFirstCollectorQueryUtil.build({
      sourceKey: this.sourceKey,
      domainName: input.domainName,
      requestDescription: input.requestDescription,
      plannedQueries: input.plannedQueries,
      keywords: input.keywords,
      authoritativePlannedQueries: input.authoritativePlannedQueries,
    }).slice(0, queryBudget);

    if (queries.length === 0) return [];

    /*
     * Crossref starts with the two highest-signal AI facets concurrently.
     * Four simultaneous calls were triggering 429s and paradoxically reducing
     * both recall and speed. If the first pair already fills the saved-evidence
     * budget, return immediately; otherwise launch the remaining pair in one
     * second bounded wave. This is adaptive concurrency, not reduced coverage.
     */
    const firstWave = await Promise.allSettled(
      queries.slice(0, 2).map((query) =>
        this.isRuntimeAvailable()
          ? this.search(query, input)
          : Promise.resolve<CrossrefWork[]>([]),
      ),
    );
    const firstWorks = firstWave.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    const distinctFirstWorks = new Set(
      firstWorks
        .map((work) => (work.DOI ?? work.URL ?? this.titleOf(work)).trim())
        .filter(Boolean),
    );

    let works = firstWorks;
    if (
      distinctFirstWorks.size < this.resolveMaxSavedPosts(input) &&
      queries.length > 2 &&
      this.isRuntimeAvailable()
    ) {
      const secondWave = await Promise.allSettled(
        queries.slice(2).map((query) =>
          this.isRuntimeAvailable()
            ? this.search(query, input)
            : Promise.resolve<CrossrefWork[]>([]),
        ),
      );
      works = [
        ...works,
        ...secondWave.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : [],
        ),
      ];
    }

    const seen = new Set<string>();
    return works
      .filter((work) => Boolean(this.titleOf(work)))
      .filter((work) => this.passesRequestIdentityGate(work, input))
      .filter((work) => {
        const key = (work.DOI ?? work.URL ?? this.titleOf(work)).trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.resolveMaxSavedPosts(input))
      .map((work) => this.mapWork(work, input));
  }

  private async search(
    rawQuery: string,
    input: CollectorInput,
  ): Promise<CrossrefWork[]> {
    const query = rawQuery
      .replace(/\s+(?:OR|AND|NOT)\s+/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 8)
      .join(' ');
    if (!query) return [];

    try {
      const mailto = this.configService.get<string>('CROSSREF_MAILTO')?.trim();
      const response = await axios.get<CrossrefResponse>(this.apiUrl, {
        params: {
          'query.bibliographic': query,
          rows: Math.min(this.resolveMaxFetchedPosts(input), 12),
          select: 'DOI,title,abstract,published,URL,publisher,type',
          ...(mailto ? { mailto } : {}),
        },
        headers: {
          Accept: 'application/json',
          'User-Agent': mailto
            ? `NexoraAI-Graduation-Project (mailto:${mailto})`
            : 'NexoraAI-Graduation-Project',
        },
        timeout: input.collectionMode === 'TARGETED_RECOVERY' ? 3_600 : 4_200,
        signal: CollectorAbortContextUtil.getSignal(),
      });

      return Array.isArray(response.data?.message?.items)
        ? [...response.data.message.items]
        : [];
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        CrossrefCollector.rateLimitCircuitOpenUntil = Math.max(
          CrossrefCollector.rateLimitCircuitOpenUntil,
          Date.now() + CrossrefCollector.RATE_LIMIT_COOLDOWN_MS,
        );
      }
      this.logger.debug(
        `Crossref query failed non-fatally. query="${query}" error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private passesRequestIdentityGate(
    work: CrossrefWork,
    input: CollectorInput,
  ): boolean {
    const request = this.cleanPlainText(input.requestDescription).toLocaleLowerCase();
    if (!request) return true;

    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: input.requestDescription,
      domainName: input.domainName,
      plannedQueries: input.plannedQueries,
    });
    const evidence = this.cleanPlainText(
      `${this.titleOf(work)} ${work.abstract ?? ''}`,
    ).toLocaleLowerCase();
    if (!evidence) return false;

    if (constraint.kind === 'ONLINE_PHARMACY_FRAUD') {
      return RequestOnlinePharmacyFraudUtil.isPlausibleRetrievalCandidate(
        input.requestDescription,
        evidence,
      );
    }

    if (constraint.kind === 'HEALTHCARE_SUPPLY_COST_EFFICIENCY') {
      const healthcare = /\b(?:healthcare|health system|hospital|hospitals|clinic|medical center|hospital pharmacy)\b/iu.test(evidence);
      const supply = /\b(?:procurement|purchasing|emergency purchase|emergency order|medical suppl(?:y|ies)|inventory|stockout|overstock|expired|expiration|expiry|inter[- ]facility transfer|stock redistribution|supplier invoice|transportation cost|delivery cost|logistics cost)\w*\b/iu.test(evidence);
      const impact = /\b(?:cost|expense|spend|budget|financial|waste|loss|avoidable|inefficien|overstock|expired|stockout|emergency)\w*\b/iu.test(evidence);
      const collision = /\b(?:stock market|asset pricing|securities|portfolio return|hydrogen|energy storage|vehicle pricing|rail market)\b/iu.test(evidence) && !healthcare;
      return healthcare && supply && impact && !collision;
    }

    if (constraint.kind === 'OPERATIONAL_COST_ATTRIBUTION') {
      return RequestOperationalCostAttributionUtil.isPlausibleRetrievalCandidate(
        input.requestDescription ?? '',
        evidence,
      );
    }

    if (constraint.kind === 'PUBLIC_PROGRAM_COST_ATTRIBUTION') {
      const publicContext = /\b(?:government|public sector|public agency|government agency|government department|public program|government program|public administration)\b/iu.test(evidence);
      const costDriver = /\b(?:staffing|payroll|procurement|purchasing|contractor|vendor payment|service usage|departmental spending|program expenditure|operating expense|operating cost|public expenditure)\w*\b/iu.test(evidence);
      const budgetPressure = /\b(?:budget overrun|overspend|cost overrun|cost pressure|cost driver|cost attribution|budget variance|spending analysis|expenditure analysis|financial oversight|inefficien|waste|cost growth|cost reduction)\w*\b/iu.test(evidence);
      const collision = /\b(?:personal finance|stock market|investment portfolio|auction format|combinatorial auction|road resurfacing)\b/iu.test(evidence) && !/\b(?:program budget|departmental budget|staffing|contractor payment|service usage|cost attribution)\b/iu.test(evidence);
      return publicContext && costDriver && budgetPressure && !collision;
    }

    const nicheCraftProfile = RequestNicheCustomCraftUtil.resolve(
      input.requestDescription,
    );
    if (constraint.kind === 'CUSTOM_SPECIFICATION_SERVICE' && nicheCraftProfile) {
      return RequestNicheCustomCraftUtil.isPlausibleRetrievalCandidate(
        input.requestDescription,
        evidence,
      );
    }

    if (
      constraint.kind === 'CUSTOM_SPECIFICATION_SERVICE' &&
      constraint.label === 'custom watch strap specification sizing and approval operations'
    ) {
      const objectIdentity =
        /\b(?:watch straps?|watch bands?|wristwatch straps?|wristwatch bands?|leather watch straps?|leather watch bands?|bespoke watch straps?|custom watch straps?)\b/iu.test(evidence);
      const workflow =
        /\b(?:wrist measurements?|wrist sizes?|anthropometr|sizing|fit|fitting|strap lengths?|strap widths?|lug widths?|leather|materials?|stitching|buckles?|customization|customisation|design|dimensions?)\w*\b/iu.test(evidence);
      const collision =
        /\b(?:custom workflow forms?|workflow engine|workflow designer|android widgets?|custom widgets?|visual studio workflow|rf connectors?|radio frequency connectors?|software|source code)\b/iu.test(evidence) &&
        !objectIdentity;
      return objectIdentity && workflow && !collision;
    }

    if (
      constraint.kind === 'TRANSACTION_ACCOUNT_ABUSE' &&
      /\b(?:smart cit(?:y|ies)|cities|city governments?|municipalit(?:y|ies)|municipal governments?|local authorities?|public services?|parking services?|utility services?)\b/iu.test(request)
    ) {
      const paymentAxis =
        /\b(?:payments?|payment transactions?|transactions?|parking payments?|parking fees?|transit payments?|fare payments?|utility payments?|utility bills?|municipal fees?)\b/iu.test(evidence);
      const municipalIdentity =
        /\b(?:smart cit(?:y|ies)|city government|municipal|municipality|local authority|public service|public transit|parking|public utility|utility provider)\w*\b/iu.test(evidence);
      const genericPaymentSystem =
        /\b(?:payment systems?|electronic payments?|digital payments?|online payments?|payment fraud|transaction fraud|payment security|fraud detection)\b/iu.test(evidence);
      const abuseFacet =
        /\b(?:fraud|fraudulent|unauthorized|account compromise|compromised account|account takeover|false positive|suspicious payment|security alert|fraud detection|fraud investigation)\w*\b/iu.test(evidence);
      const financeCollision =
        /\b(?:tax deferred|retirement accounts?|pension accounts?|investment portfolio|securities trading|stock market)\b/iu.test(evidence) &&
        !municipalIdentity;
      return !financeCollision && abuseFacet && (paymentAxis && municipalIdentity || genericPaymentSystem);
    }

    return true;
  }

  private mapWork(work: CrossrefWork, input: CollectorInput): CollectorPost {
    const title = this.titleOf(work);
    const abstract = this.cleanPlainText(work.abstract);
    const content = this.boundEvidenceText([title, abstract].filter(Boolean).join('. '), 3_600);
    const doi = work.DOI?.trim();
    const url = work.URL?.trim() || (doi ? `https://doi.org/${doi}` : undefined);

    return {
      externalId: this.stableId(doi || url || title),
      title,
      content: content || title,
      author: this.cleanPlainText(work.publisher) || undefined,
      url,
      country: input.country,
      city: input.city,
      region: input.region,
      languageCode: this.resolveStoredLanguageCode(input.language),
      publishedAt: this.publishedAt(work),
      tags: [this.cleanPlainText(work.type), this.cleanPlainText(work.publisher)].filter(Boolean),
      comments: [],
    };
  }

  private boundEvidenceText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    const window = normalized.slice(0, maxLength);
    const floor = Math.floor(maxLength * 0.68);
    const boundaries = [...window.matchAll(/[.!?](?:\s|$)/gu)]
      .map((match) => (match.index ?? 0) + 1)
      .filter((index) => index >= floor);
    const boundary = boundaries.at(-1);
    return (boundary ? window.slice(0, boundary) : window).trim();
  }

  private titleOf(work: CrossrefWork): string {
    return this.cleanPlainText(Array.isArray(work.title) ? work.title[0] : '');
  }

  private publishedAt(work: CrossrefWork): Date | undefined {
    const dateParts = work.published?.['date-parts']?.[0];
    if (!dateParts?.length) return undefined;
    const [year, month = 1, day = 1] = dateParts;
    if (!year) return undefined;
    const value = new Date(Date.UTC(year, Math.max(0, month - 1), day));
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  private stableId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
  }
}
