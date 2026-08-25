import { RequestDynamicQueryUtil } from './request-dynamic-query.util';

/**
 * Builds short product-discovery queries for App Store / Google Play.
 *
 * Store search is not a web search engine: pain-heavy sentences such as
 * "restaurant payment refund fraud monitoring" often find no useful apps.
 * This utility converts the requester workflow into app-category phrases, then
 * leaves the actual problem discovery to user reviews/comments downstream.
 */
export class RequestReviewStoreQueryUtil {
  static build(input: {
    readonly requestDescription?: string | null;
    readonly domainName?: string | null;
    readonly plannedQueries?: readonly string[];
    readonly maxQueries?: number;
  }): string[] {
    const request = this.normalize(input.requestDescription ?? '');
    const domain = this.normalize(input.domainName ?? '');
    const planned = (input.plannedQueries ?? [])
      .map((query) => this.normalize(query))
      .filter(Boolean);
    const maxQueries = Math.max(1, Math.min(5, input.maxQueries ?? 4));
    const corpus = `${request} ${domain} ${planned.join(' ')}`.trim();
    if (!corpus) return [];

    const actor = this.compactActor(
      RequestDynamicQueryUtil.extractActor(request) || domain,
    );
    const phrases: string[] = [];
    const add = (...values: string[]): void => {
      for (const value of values) {
        const compact = this.compact(value);
        if (compact) phrases.push(compact);
      }
    };

    // Domain/workflow category phrases. These are intentionally product nouns,
    // not problem claims. Reviews carry the pain/failure evidence later.
    // Municipal payment/security workflows need city-service product nouns;
    // generic `payment manager` / `account security app` queries drift into
    // wallets, authenticators, and unrelated personal-finance products.
    if (/\b(?:smart cit(?:y|ies)|municipal|municipality|city government|public transit|public transportation|parking|public utility|municipal utility|city services?)\b/u.test(corpus)) {
      if (/\b(?:payment|billing|transaction|fare|fees?|refund)\b/u.test(corpus)) {
        add(
          'parking payment app',
          'transit ticketing app',
          'utility billing app',
          'city services app',
        );
      }
    }

    if (/\b(?:restaurant|food service|foodservice|food ordering|meal delivery|food delivery|loyalty|rewards)\b/u.test(corpus)) {
      add(
        'restaurant ordering app',
        'food delivery app',
        'restaurant loyalty app',
        'restaurant rewards app',
      );
    }
    if (/\b(?:property management|building|facility|facilities|tenant|landlord|energy consumption|utility bill|hvac)\b/u.test(corpus)) {
      add(
        'property management app',
        'building energy monitor',
        'facility maintenance app',
        'energy monitoring app',
      );
    }
    if (/\b(?:streaming|digital entertainment|media and entertainment|video platform|music streaming|gaming platform|game platform|subscription platform)\b/u.test(corpus)) {
      add(
        'streaming subscription app',
        'video streaming app',
        'music streaming app',
        'gaming subscription app',
        'entertainment subscription app',
      );
    }
    if (/\b(?:travel compan(?:y|ies)|travel agenc(?:y|ies)|tour operators?|tour packages?|tourism|travel booking|itinerar(?:y|ies))\b/u.test(corpus)) {
      add(
        'tour operator booking app',
        'travel agency booking manager',
        'tour package manager',
        'tour operator crm',
        'travel itinerary manager',
      );
    }
    if (/\b(?:custom order|commission|artisan|craft|maker|engraving|tattoo|leather|tailor|bespoke|measurement|specification|revision|approval)\b/u.test(corpus)) {
      // Niche craft apps are usually marketed as maker/custom-product order
      // tools rather than by the exact craft noun. Prefer that analogue before
      // falling back to generic client/order applications.
      add(
        'craft order manager',
        'custom product order manager',
        'maker order tracker',
        'bespoke order tracker',
        'client approval app',
      );
    }
    if (/\b(?:booking|reservation|appointment|schedule|scheduling)\b/u.test(corpus)) {
      add('booking manager', 'appointment scheduler');
    }
    if (/\b(?:inventory|stock|warehouse|supplies|procurement)\b/u.test(corpus)) {
      add('inventory manager', 'stock tracking app');
    }
    if (/\b(?:restoration|conservation|conservator|restorer|treatment history|condition report|varnish|coating|museum collection|heritage object|luthier)\b/u.test(corpus)) {
      add(
        'conservation record app',
        'restoration documentation app',
        'condition report app',
        'collection conservation app',
      );
    }
    if (/\b(?:maintenance|repair|service history|work order)\b/u.test(corpus)) {
      add('maintenance manager', 'work order app');
    }
    if (/\b(?:fraud|account takeover|compromised account|unauthorized|security alert|suspicious activity)\b/u.test(corpus)) {
      add('account security app', 'fraud alert app');
    }
    if (/\b(?:payment|refund|billing|invoice|transaction)\b/u.test(corpus)) {
      add('payment manager', 'billing app');
    }
    if (/\b(?:delivery|route|courier|shipment|transport)\b/u.test(corpus)) {
      add('delivery tracking app', 'route manager');
    }

    if (actor) {
      add(`${actor} app`, `${actor} manager`);
    }

    // Planned AI seeds may contain useful product nouns. Strip pain/meta words
    // and keep only compact 2-4 word discovery phrases.
    for (const query of planned.slice(0, 6)) {
      add(this.discoveryFromSeed(query));
    }

    return this.unique(phrases).slice(0, maxQueries);
  }

  private static discoveryFromSeed(value: string): string {
    const blocked = new Set([
      'problem', 'problems', 'issue', 'issues', 'complaint', 'complaints',
      'fraudulent', 'fraud', 'suspicious', 'unauthorized', 'compromised',
      'blocked', 'wrong', 'incorrect', 'missing', 'lost', 'delayed', 'delay',
      'wasted', 'waste', 'rework', 'error', 'errors', 'failed', 'failure',
      'detect', 'detection', 'monitoring', 'prevention', 'separately',
      'legitimate', 'activity', 'early', 'customer', 'customers', 'client',
      'clients', 'the', 'and', 'for', 'with', 'from', 'into', 'across', 'of',
    ]);
    const tokens = this.normalize(value)
      .split(/\s+/u)
      .filter((token) => token.length >= 3 && !blocked.has(token));
    if (tokens.length === 0) return '';

    const productTokens = tokens.filter((token) =>
      /^(?:restaurant|food|delivery|ordering|loyalty|rewards|travel|tour|tourism|itinerary|agency|property|building|energy|facility|maintenance|order|booking|appointment|inventory|stock|payment|billing|measurement|approval|tattoo|engraving|leather|craft|maker|bespoke|security|account|route|workflow|manager|tracker|crm|streaming|video|music|gaming|subscription|entertainment|conservation|restoration|condition|collection)$/u.test(token),
    );
    const selected = (productTokens.length >= 2 ? productTokens : tokens)
      .slice(0, 3);
    return selected.join(' ');
  }

  private static compactActor(value: string): string {
    return this.normalize(value)
      .replace(/\b(?:independent|professional|professionals|companies|company|chains|chain|teams|team|staff|operators|operator|makers|maker|specialists|specialist)\b/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 3)
      .join(' ');
  }

  private static compact(value: string): string {
    return this.normalize(value)
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 4)
      .join(' ');
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
      .replace(/[^\p{L}\p{N}\s&+/_'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
