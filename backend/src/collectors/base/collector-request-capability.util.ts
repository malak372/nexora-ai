import type { CollectorRequestSupportInput } from './collector.interface';

export type CollectorRequestCapability = {
  readonly supported: boolean;
  readonly score: number;
  readonly reason: string;
};

export type CollectorEvidenceArchetype =
  | 'COMMUNITY'
  | 'DOCUMENTARY'
  | 'RESEARCH'
  | 'TECHNICAL'
  | 'PRODUCT_REVIEW'
  | 'OTHER';

/**
 * Generic request-to-source capability scoring used by bounded generation.
 *
 * The scorer intentionally separates the semantic request/problem anchor from
 * retrieval vocabulary. AI-generated search queries are useful for ranking a
 * source, but they are not allowed to transform a physical/service workflow
 * into a developer workflow merely because one query contains words such as
 * "software" or "platform". This keeps source routing generic while avoiding
 * the two failure modes that matter most for evidence recovery:
 *
 * - operational/service requests being routed into developer-only corpora;
 * - research/governance problems being routed into mobile-app review stores.
 *
 * This utility models source *capabilities*, never semantic evidence truth.
 * Community AI remains the authority that decides whether returned material is
 * DIRECT/SUPPORTING/CONTEXT/UNRELATED.
 */
export class CollectorRequestCapabilityUtil {
  private static readonly boundedModes = new Set([
    'FAST_GENERATION',
    'TARGETED_RECOVERY',
  ]);

  static sourceArchetype(sourceKey: string): CollectorEvidenceArchetype {
    switch (sourceKey.trim().toLocaleLowerCase()) {
      case 'reddit':
      case 'forum':
        return 'COMMUNITY';
      case 'news':
      case 'gdelt':
      case 'blog':
      case 'youtube':
        return 'DOCUMENTARY';
      case 'crossref':
        return 'RESEARCH';
      case 'github':
      case 'stackoverflow':
      case 'dev-to':
      case 'hacker-news':
        return 'TECHNICAL';
      case 'app-store':
      case 'google-play':
      case 'product-hunt':
        return 'PRODUCT_REVIEW';
      default:
        return 'OTHER';
    }
  }

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

    const requestDescription = this.normalize(input.requestDescription ?? '');
    const semanticAnchor = this.normalize([
      requestDescription,
      input.domainName ?? '',
      ...(input.domainKeywords ?? []),
      // When there is no request/family description, keywords are part of the
      // best available semantic anchor. With explicit text they stay retrieval
      // hints only so generated vocabulary cannot redefine the workflow type.
      ...(requestDescription ? [] : input.keywords ?? []),
    ].join(' '));
    const retrievalCorpus = this.normalize([
      semanticAnchor,
      ...(input.keywords ?? []),
      ...(input.plannedQueries ?? []),
      ...(input.sourceHints ?? []),
    ].join(' '));

    const hasAnchor = semanticAnchor.length > 0;
    const hasCorpus = retrievalCorpus.length > 0;

    const developerAnchor = this.matches(
      semanticAnchor,
      /\b(?:software developers?|engineers?|programmers?|programming|source code|codebase|coding|api|sdk|library|framework|repository|github|git|database|frontend|backend|devops|cloud infrastructure|kubernetes|docker|javascript|typescript|python|java|react|flutter|nestjs|node(?:\.js)?|build error|compile error|deployment failure|server error|runtime error|integration bug)\b/iu,
    );
    const developerRetrieval = this.matches(
      retrievalCorpus,
      /\b(?:software|developer|development|programming|code|coding|api|sdk|library|framework|repository|github|git|database|frontend|backend|devops|cloud|kubernetes|docker|javascript|typescript|python|java|react|flutter|nestjs|node(?:\.js)?|build error|compile|deployment|server|infrastructure)\b/iu,
    );
    const digitalProductAnchor = this.matches(
      semanticAnchor,
      /\b(?:mobile app|android app|ios app|app store|google play|website|web app|saas|software product|browser extension|digital marketplace|online marketplace)\b/iu,
    );
    const digitalProductRetrieval = this.matches(
      retrievalCorpus,
      /\b(?:mobile app|android|ios|app store|google play|website|web app|saas|software product|browser extension|marketplace app)\b/iu,
    );
    const researchTechnicalAnchor = this.matches(
      semanticAnchor,
      /\b(?:generative ai|genai|large language model|\bllm\b|machine learning|model training|training data|dataset|data provenance|provenance traceability|data lineage|data governance|consent metadata|compliance audit|policy validation|algorithmic|cybersecurity|security controls?|threat detection|telemetry|sensor data|predictive analysis|anomaly detection)\b/iu,
    );
    const researchableOperationalWorkflow = this.matches(
      retrievalCorpus,
      /\b(?:energy|agricultur\w*|farm\w*|irrigation|greenhouse|refrigeration|manufactur\w*|health\w*|cyber\w*|security|environment\w*|sustainab\w*|operations?|maintenance|efficien\w*|costs?|profit\w*|fraud|government|public sector|education|tourism|transport\w*|logistics|warehouse|supply chain|packaging|waste|quality|reliability|downtime|resource use|iot|internet of things|training data|data provenance|data lineage|governance|compliance|audit|model training|occupancy|hvac|building management)\b/iu,
    );
    const publicReportWorkflow = this.matches(
      retrievalCorpus,
      /\b(?:government|public sector|policy|regulation|regulatory|compliance|fraud|cyber|security incident|breach|outage|energy|market|industry|supply chain|agricultur\w*|environment\w*|sustainab\w*|health\w*|transport\w*|tourism|consumer protection|data breach|privacy incident)\b/iu,
    );
    const practitionerPain = this.matches(
      retrievalCorpus,
      /\b(?:struggl\w*|problem\w*|issue\w*|complaint\w*|fail\w*|difficult\w*|unable|cannot|delay\w*|rework|waste|incorrect|wrong|mismatch\w*|inefficien\w*|downtime|costly|expensive|fraud|attack\w*|error\w*|friction|bottleneck\w*|shortage\w*|missed|lost|unnecessary|conflict\w*|overrun\w*)\b/iu,
    );
    const physicalOrServiceAnchor = this.matches(
      semanticAnchor,
      /\b(?:handmade|craft\w*|artisan\w*|tailor\w*|garment|floral|flower|bouquet|repair|restoration|packaging|label\w*|wrapping|workshop|studio|school|academy|lesson|instructor|practice room|farm\w*|irrigation|greenhouse|equipment|refrigeration|restaurant|clinic|warehouse|factory|manufactur\w*|delivery|field service|maintenance|custom order|booking\w*|scheduling|schedule|dispatch|vehicle|fleet|crew|contractor\w*|supplier\w*|inventory|permit\w*|inspection\w*|municipal|municipality|public service|capacity planning|appointment\w*|pickup|dropoff|fragile item|building|facility|hvac|lighting|occupancy)\b/iu,
    );
    const mediaOrHowToWorkflow = this.matches(
      retrievalCorpus,
      /\b(?:tutorial|walkthrough|video|demonstrat\w*|how to|repair|restoration|equipment|maintenance|workflow|review|lesson|practice)\b/iu,
    );

    let score = 0.5;
    let reason = 'General evidence source.';

    switch (key) {
      case 'reddit':
        score =
          0.78 +
          (practitionerPain ? 0.12 : 0) +
          (physicalOrServiceAnchor ? 0.05 : 0) +
          (researchTechnicalAnchor ? 0.03 : 0);
        reason = 'Broad community/practitioner discussion source.';
        break;
      case 'forum':
        score =
          0.68 +
          (practitionerPain ? 0.13 : 0) +
          (developerAnchor ? 0.06 : 0) +
          (physicalOrServiceAnchor ? 0.08 : 0) +
          (researchTechnicalAnchor ? 0.04 : 0);
        reason = 'Practitioner/specialist forum source.';
        break;
      case 'blog':
        score =
          0.66 +
          (practitionerPain ? 0.07 : 0) +
          (researchableOperationalWorkflow ? 0.08 : 0) +
          (researchTechnicalAnchor ? 0.07 : 0);
        reason = 'Broad web/editorial practitioner source.';
        break;
      case 'news':
        score =
          0.46 +
          (publicReportWorkflow ? 0.30 : 0) +
          (researchableOperationalWorkflow ? 0.08 : 0);
        reason = 'Public incident, industry, and operational reporting source.';
        break;
      case 'gdelt':
        score =
          0.28 +
          (publicReportWorkflow ? 0.31 : 0) +
          (researchableOperationalWorkflow ? 0.06 : 0);
        reason = 'Large public-news/event corpus for reportable operational or industry problems.';
        break;
      case 'crossref':
        score =
          0.34 +
          (researchableOperationalWorkflow ? 0.34 : 0) +
          (researchTechnicalAnchor ? 0.20 : 0) +
          (developerAnchor ? 0.03 : 0);
        reason = 'Academic/technical supporting-evidence source.';
        break;
      case 'youtube':
        score =
          0.44 +
          (mediaOrHowToWorkflow ? 0.18 : 0) +
          (physicalOrServiceAnchor ? 0.09 : 0) +
          (practitionerPain ? 0.05 : 0);
        reason = 'Video practitioner/how-to source.';
        break;
      case 'hacker-news':
        score =
          0.20 +
          (developerAnchor ? 0.48 : 0) +
          (researchTechnicalAnchor ? 0.24 : 0) +
          (digitalProductAnchor ? 0.08 : 0);
        if (physicalOrServiceAnchor && !developerAnchor && !researchTechnicalAnchor) {
          score = Math.min(score, 0.34);
        }
        reason = 'Technology/startup discussion source.';
        break;
      case 'dev-to':
        score =
          0.10 +
          (developerAnchor ? 0.70 : 0) +
          (researchTechnicalAnchor ? 0.20 : 0) +
          (!hasAnchor && developerRetrieval ? 0.12 : 0);
        if (physicalOrServiceAnchor && !developerAnchor) {
          score = Math.min(score, 0.25);
        }
        reason = 'Developer-focused article/discussion source.';
        break;
      case 'github':
        score =
          0.06 +
          (developerAnchor ? 0.82 : 0) +
          (!hasAnchor && developerRetrieval ? 0.18 : 0) +
          (researchTechnicalAnchor && developerAnchor ? 0.05 : 0);
        if (physicalOrServiceAnchor && !developerAnchor) {
          score = Math.min(score, 0.12);
        }
        reason = 'Developer repository/issue source; requires a genuine software-engineering workflow.';
        break;
      case 'stackoverflow':
        score =
          0.05 +
          (developerAnchor ? 0.87 : 0) +
          (!hasAnchor && developerRetrieval ? 0.16 : 0);
        if (physicalOrServiceAnchor && !developerAnchor) {
          score = Math.min(score, 0.10);
        }
        reason = 'Programming Q&A source; requires a genuine programming/runtime workflow.';
        break;
      case 'product-hunt':
        score =
          0.10 +
          (digitalProductAnchor ? 0.58 : 0) +
          (developerAnchor ? 0.08 : 0) +
          (researchTechnicalAnchor ? 0.05 : 0);
        if (hasAnchor && !digitalProductAnchor) score = Math.min(score, 0.28);
        reason = 'Digital-product launch/discovery source.';
        break;
      case 'app-store':
      case 'google-play':
        score =
          0.06 +
          (digitalProductAnchor ? 0.74 : 0) +
          (!hasAnchor && digitalProductRetrieval ? 0.48 : 0) +
          (physicalOrServiceAnchor && practitionerPain ? 0.28 : 0);
        if (researchTechnicalAnchor && !digitalProductAnchor) {
          score = Math.min(score, 0.12);
        } else if (hasAnchor && !digitalProductAnchor) {
          // Operational app reviews can still be useful in the broad first pass,
          // but they should not win a targeted recovery slot solely because the
          // proposed solution was described as a "platform".
          score = Math.min(score, 0.38);
        }
        reason = 'Mobile-app review source; best when the problem is concretely app-centric.';
        break;
      default:
        score = hasCorpus ? 0.42 : 0.35;
        reason = 'Unknown source uses conservative generic capability.';
        break;
    }

    if (!hasCorpus) {
      if (
        ['reddit', 'forum', 'blog', 'news', 'crossref', 'youtube', 'gdelt'].includes(
          key,
        )
      ) {
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
