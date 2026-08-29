import type { CollectorRequestSupportInput } from './collector.interface';

export type CollectorRequestCapability = {
  readonly supported: boolean;
  readonly score: number;
  readonly reason: string;
};

/**
 * Generic request-to-source capability scoring used by bounded generation.
 *
 * This deliberately models source *capabilities* rather than named business
 * verticals. It prevents a collector that forgot to implement supportsRequest()
 * from becoming universally eligible while still allowing new request domains
 * to work without adding another hard-coded vertical branch.
 */
export class CollectorRequestCapabilityUtil {
  private static readonly boundedModes = new Set([
    'FAST_GENERATION',
    'TARGETED_RECOVERY',
  ]);

  static evaluate(
    sourceKey: string,
    input: CollectorRequestSupportInput,
  ): CollectorRequestCapability {
    const key = sourceKey.trim().toLocaleLowerCase();
    const bounded = this.boundedModes.has(input.collectionMode ?? '');
    if (!bounded) {
      return {
        supported: true,
        score: 1,
        reason: 'Unbounded collection mode keeps every runtime collector eligible.',
      };
    }

    const corpus = this.normalize([
      input.requestDescription ?? '',
      input.domainName ?? '',
      ...(input.domainKeywords ?? []),
      ...(input.keywords ?? []),
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ].join(' '));

    const hasCorpus = corpus.length > 0;
    const developerWorkflow = this.matches(corpus,
      /\b(?:software|developer|development|programming|code|coding|api|sdk|library|framework|repository|github|git|database|frontend|backend|devops|cloud|kubernetes|docker|javascript|typescript|python|java|react|flutter|nestjs|node(?:\.js)?|build error|compile|deployment|server|infrastructure)\b/iu,
    );
    const digitalProductWorkflow = this.matches(corpus,
      /\b(?:app|application|mobile app|website|web app|web platform|digital platform|online platform|online service|saas|software product|browser extension|marketplace app)\b/iu,
    );
    const researchableOperationalWorkflow = this.matches(corpus,
      /\b(?:energy|agricultur\w*|farm\w*|irrigation|greenhouse|refrigeration|manufactur\w*|health\w*|cyber\w*|security|environment\w*|sustainab\w*|operations?|maintenance|efficien\w*|costs?|profit\w*|fraud|government|public sector|education|tourism|transport\w*|logistics|warehouse|supply chain|packaging|waste|quality|reliability|downtime|resource use|iot|internet of things)\b/iu,
    );
    const publicReportWorkflow = this.matches(corpus,
      /\b(?:government|public sector|policy|regulation|regulatory|fraud|cyber|security incident|breach|outage|energy|market|industry|supply chain|agricultur\w*|environment\w*|sustainab\w*|health\w*|transport\w*|tourism|consumer protection)\b/iu,
    );
    const practitionerPain = this.matches(corpus,
      /\b(?:struggl\w*|problem\w*|issue\w*|complaint\w*|fail\w*|difficult\w*|unable|cannot|delay\w*|rework|waste|incorrect|wrong|mismatch\w*|inefficien\w*|downtime|costly|expensive|fraud|attack\w*|error\w*|friction|bottleneck\w*|shortage\w*|missed|lost|unnecessary)\b/iu,
    );
    const physicalOrServiceWorkflow = this.matches(corpus,
      /\b(?:handmade|craft\w*|artisan\w*|soap|floral|flower|bouquet|repair|restoration|packaging|label\w*|wrapping|box(?:es)?|workshop|studio|farm\w*|irrigation|greenhouse|equipment|refrigeration|restaurant|clinic|warehouse|factory|manufactur\w*|delivery|field service|maintenance|custom order|physical sample)\b/iu,
    );
    const mediaOrHowToWorkflow = this.matches(corpus,
      /\b(?:tutorial|walkthrough|video|demonstrat\w*|how to|repair|restoration|equipment|maintenance|workflow|review)\b/iu,
    );

    let score = 0.5;
    let reason = 'General evidence source.';

    switch (key) {
      case 'reddit':
        score = 0.78 + (practitionerPain ? 0.12 : 0) + (physicalOrServiceWorkflow ? 0.04 : 0);
        reason = 'Broad community/practitioner discussion source.';
        break;
      case 'forum':
        score = 0.68 + (practitionerPain ? 0.12 : 0) + (developerWorkflow ? 0.08 : 0) + (physicalOrServiceWorkflow ? 0.06 : 0);
        reason = 'Practitioner/specialist forum source.';
        break;
      case 'blog':
        score = 0.70 + (practitionerPain ? 0.08 : 0) + (researchableOperationalWorkflow ? 0.06 : 0);
        reason = 'Broad web/editorial practitioner source.';
        break;
      case 'news':
        score = 0.48 + (publicReportWorkflow ? 0.28 : 0) + (researchableOperationalWorkflow ? 0.08 : 0);
        reason = 'Public incident, industry, and operational reporting source.';
        break;
      case 'gdelt':
        score = 0.30 + (publicReportWorkflow ? 0.30 : 0) + (researchableOperationalWorkflow ? 0.05 : 0);
        reason = 'Large public-news/event corpus; useful only when the request has a reportable public/industry surface.';
        break;
      case 'crossref':
        score = 0.36 + (researchableOperationalWorkflow ? 0.38 : 0) + (developerWorkflow ? 0.04 : 0);
        reason = 'Academic/technical supporting-evidence source.';
        break;
      case 'youtube':
        score = 0.46 + (mediaOrHowToWorkflow ? 0.18 : 0) + (physicalOrServiceWorkflow ? 0.08 : 0) + (practitionerPain ? 0.05 : 0);
        reason = 'Video practitioner/how-to source.';
        break;
      case 'hacker-news':
        score = 0.24 + (developerWorkflow ? 0.48 : 0) + (digitalProductWorkflow ? 0.12 : 0);
        reason = 'Technology/startup discussion source.';
        break;
      case 'dev-to':
        score = 0.12 + (developerWorkflow ? 0.72 : 0) + (digitalProductWorkflow ? 0.06 : 0);
        reason = 'Developer-focused article/discussion source.';
        break;
      case 'github':
        score = 0.10 + (developerWorkflow ? 0.76 : 0) + (digitalProductWorkflow ? 0.04 : 0);
        reason = 'Developer repository/issue source.';
        break;
      case 'stackoverflow':
        score = 0.08 + (developerWorkflow ? 0.82 : 0);
        reason = 'Programming Q&A source.';
        break;
      case 'product-hunt':
        score = 0.12 + (digitalProductWorkflow ? 0.58 : 0) + (developerWorkflow ? 0.10 : 0);
        reason = 'Digital-product launch/discovery source.';
        break;
      case 'app-store':
      case 'google-play':
        score = 0.08 + (digitalProductWorkflow ? 0.80 : 0);
        reason = 'Mobile-app review source.';
        break;
      default:
        score = hasCorpus ? 0.42 : 0.35;
        reason = 'Unknown source uses conservative generic capability.';
        break;
    }

    if (!hasCorpus) {
      // Discovery without requester text needs breadth, but specialist digital
      // sources still should not dominate merely because they are healthy.
      if (['reddit', 'forum', 'blog', 'news', 'crossref', 'youtube', 'gdelt'].includes(key)) {
        score = Math.max(score, 0.52);
      } else {
        score = Math.min(score, 0.44);
      }
    }

    const normalizedScore = Math.max(0, Math.min(1, score));
    return {
      supported: normalizedScore >= 0.42,
      score: normalizedScore,
      reason,
    };
  }

  static score(
    sourceKey: string,
    input: CollectorRequestSupportInput,
  ): number {
    return this.evaluate(sourceKey, input).score;
  }

  private static matches(value: string, pattern: RegExp): boolean {
    return Boolean(value) && pattern.test(value);
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}+.#/_-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
