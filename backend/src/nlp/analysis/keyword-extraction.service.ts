import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import { STOP_WORDS } from '../common/constants/stop-words.constant';
import {
  hasDirectCommunityComplaint,
  isLikelyProductDescription,
} from '../common/utils/community-evidence.util';
import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type { WeightedKeyword } from '../pipeline/types/intelligent-analysis.types';

const MAX_EXTRACTED_KEYWORDS = 30;
const POST_TERM_WEIGHT = 1;
const COMMENT_TERM_WEIGHT = 2;
const MINIMUM_KEYWORD_FREQUENCY = 1;

/**
 * Canonical workflow and failure-mode keywords exposed by the NLP API.
 *
 * Raw adjacent-token bigrams are intentionally not returned. They previously
 * produced fragments such as "back main", "plus data", and
 * "computer downloading" that were frequent but not useful product signals.
 */
const CANONICAL_KEYWORD_DEFINITIONS: ReadonlyArray<{
  readonly keyword: string;
  readonly patterns: readonly RegExp[];
}> = [
  {
    keyword: 'ai-assisted algorithm discovery',
    patterns: [
      /\b(?:algorithm discovery|algorithm guessing|identify (?:the )?(?:correct )?(?:algorithm|operation)|infer (?:the )?(?:algorithm|operation)|magic feature|cyberchef magic)\b/iu,
    ],
  },
  {
    keyword: 'transformation recipe generation',
    patterns: [
      /\b(?:recipe generation|transformation recipes?|operation(?:al)? order|sequence of algorithms?|algorithm chains?|data transformation)\b/iu,
    ],
  },
  {
    keyword: 'local ai processing',
    patterns: [
      /\b(?:local-first ai|local ai|locally running ai|on-device ai|without external servers?|never be sent to external servers?)\b/iu,
    ],
  },
  {
    keyword: 'data privacy and consent',
    patterns: [
      /\b(?:explicit user consent|data privacy|sensitive data|external servers?|privacy-preserving)\b/iu,
    ],
  },
  {
    keyword: 'agent orchestration',
    patterns: [
      /\b(?:agent orchestration|agent registration|agent auto[- ]?discovery|routing requests to different agents|multi-agent orchestration)\b/iu,
    ],
  },
  {
    keyword: 'explainable ai recommendations',
    patterns: [
      /\b(?:explainable ai|human-readable explanations?|plain-language explanations?|explainability|auditability|why (?:the )?(?:algorithm|operation|step) (?:was|is) chosen|confidence scores?|uncertainty estimates?)\b/iu,
    ],
  },
  {
    keyword: 'cyberchef integration',
    patterns: [
      /\b(?:cyberchef-compatible|cyberchef integration|export(?:able)? recipes?[^.!?\n]{0,40}cyberchef|use in (?:platforms? such as )?cyberchef)\b/iu,
    ],
  },
  {
    keyword: 'collaborative recipe repository',
    patterns: [
      /\b(?:collaborative recipe repository|shared recipe repository|share[^.!?\n]{0,40}(?:algorithm|transformation) recipes?|version[^.!?\n]{0,30}recipes?|review[^.!?\n]{0,30}recipes?)\b/iu,
    ],
  },
  {
    keyword: 'login loop',
    patterns: [
      /\b(?:login|log in|sign in)\b[^.!?\n]{0,60}\b(?:loop|loops|looping|back to (?:the )?(?:main|start) screen|returns? to (?:the )?(?:main|start) screen)\b/iu,
      /\b(?:loop|loops|looping)\b[^.!?\n]{0,50}\b(?:login|log in|sign in)\b/iu,
    ],
  },
  {
    keyword: 'account activation',
    patterns: [
      /\b(?:account activation|activate (?:my |the )?account|activation code|create an account|account creation)\b/iu,
    ],
  },
  {
    keyword: 'email verification',
    patterns: [
      /\b(?:verification email|activation email|email verification|receive (?:an? )?email|never (?:get|receive)(?:s|d)? (?:an? )?email)\b/iu,
    ],
  },
  {
    keyword: 'authentication',
    patterns: [
      /\b(?:authentication|authenticate|login|log in|sign in|account access|identity verification)\b/iu,
    ],
  },
  {
    keyword: 'session recovery',
    patterns: [
      /\b(?:session recovery|stale token|invalid token|token reset|stay logged in|logged out|session expires?|session reset)\b/iu,
    ],
  },
  {
    keyword: 'data loss',
    patterns: [
      /\b(?:data loss|lost data|data (?:is|was|are|were) gone|all (?:of )?my data[^.!?\n]{0,90}gone|missing historical data|history disappeared|data[^.!?\n]{0,90}(?:is|are|was|were)?\s*(?:all )?gone)\b/iu,
    ],
  },
  {
    keyword: 'data recovery',
    patterns: [
      /\b(?:data recovery|recover (?:lost |missing )?data|restore (?:lost |missing )?data|restore history|backup recovery)\b/iu,
      /\b(?:data loss|lost data|data (?:is|was|are|were) gone|missing history|data[^.!?\n]{0,90}(?:is|are|was|were)?\s*(?:all )?gone)\b/iu,
    ],
  },
  {
    keyword: 'data synchronization',
    patterns: [
      /\b(?:data synchronization|synchronization|sync data|data sync|syncing|transferr?ing data|cross-device sync)\b/iu,
    ],
  },
  {
    keyword: 'offline cache',
    patterns: [
      /\b(?:offline cache|local cache|cached offline|offline access|access offline|without internet|no internet)\b/iu,
    ],
  },
  {
    keyword: 'download pdf',
    patterns: [
      /\b(?:download (?:a |the )?pdf|pdf download|download pdf book|print (?:a |the )?pdf)\b/iu,
    ],
  },
  {
    keyword: 'document download',
    patterns: [
      /\b(?:download (?:a |the )?(?:document|file|syllabus|material)|document download|file download|download error|null error[^.!?\n]{0,30}download)\b/iu,
    ],
  },
  {
    keyword: 'course material',
    patterns: [
      /\b(?:course material|course materials|learning material|learning materials|lecture material|lecture materials|syllabus|ebook|e-book|reading material|reading materials)\b/iu,
    ],
  },
  {
    keyword: 'assignment access',
    patterns: [
      /\b(?:assignment access|access (?:an? )?assignment|open (?:an? )?assignment|submit (?:an? )?assignment|complete (?:an? )?assignment)\b/iu,
    ],
  },
  {
    keyword: 'cross-device access',
    patterns: [
      /\b(?:cross-device|cross device|mobile and desktop|phone and computer|android and (?:desktop|laptop|computer)|ios and (?:desktop|laptop|computer))\b/iu,
    ],
  },
  {
    keyword: 'desktop access',
    patterns: [
      /\b(?:desktop access|laptop access|computer access|download(?:ed)? (?:from|on|to) (?:a |the )?(?:computer|desktop|laptop)|works? on (?:a |the )?(?:computer|desktop|laptop))\b/iu,
    ],
  },
  {
    keyword: 'application crash',
    patterns: [
      /\b(?:app|application|platform)\b[^.!?\n]{0,40}\b(?:crash|crashes|crashed|crashing|freeze|freezes|frozen)\b/iu,
      /\b(?:crash|crashes|crashed|crashing|freeze|freezes|frozen)\b/iu,
    ],
  },
  {
    keyword: 'application reliability',
    patterns: [
      /\b(?:reliability|unstable|dysfunctional|rarely works|doesn'?t work|does not work|not working|slow|glitch|glitches|error every time)\b/iu,
    ],
  },
  {
    keyword: 'navigation',
    patterns: [
      /\b(?:navigation|navigate|back button|tabs?|breadcrumb|scrolling|popup|course selection page)\b/iu,
    ],
  },
  {
    keyword: 'user interface',
    patterns: [
      /\b(?:user interface|interface|ui|layout|confusing update|hard to navigate)\b/iu,
    ],
  },
  {
    keyword: 'paywall',
    patterns: [
      /\b(?:paywall|subscription|paid feature|limited tasks|limited features|pay money|requires? payment)\b/iu,
    ],
  },
  {
    keyword: 'grade analytics',
    patterns: [
      /\b(?:grade analytics|grade percentages?|grade tracker|track grades?|academic analytics|progress analytics)\b/iu,
    ],
  },
];

/**
 * Curated standalone aliases accepted from administrator-managed lexicons.
 * Values are normalized to the same canonical vocabulary used above.
 */
const LEXICON_TERM_ALIASES = new Map<string, string>([
  ['algorithm discovery', 'ai-assisted algorithm discovery'],
  ['data transformation', 'transformation recipe generation'],
  ['local ai', 'local ai processing'],
  ['privacy', 'data privacy and consent'],
  ['orchestration', 'agent orchestration'],
  ['explainability', 'explainable ai recommendations'],
  ['auditability', 'explainable ai recommendations'],
  ['confidence score', 'explainable ai recommendations'],
  ['cyberchef', 'cyberchef integration'],
  ['recipe repository', 'collaborative recipe repository'],
  ['activation', 'account activation'],
  ['account activation', 'account activation'],
  ['authentication', 'authentication'],
  ['login', 'authentication'],
  ['sign in', 'authentication'],
  ['session', 'session recovery'],
  ['sync', 'data synchronization'],
  ['synchronization', 'data synchronization'],
  ['data loss', 'data loss'],
  ['recovery', 'data recovery'],
  ['offline', 'offline cache'],
  ['download', 'document download'],
  ['document', 'document download'],
  ['syllabus', 'course material'],
  ['crash', 'application crash'],
  ['crashes', 'application crash'],
  ['freeze', 'application crash'],
  ['reliability', 'application reliability'],
  ['navigation', 'navigation'],
  ['interface', 'user interface'],
  ['paywall', 'paywall'],
  ['grades', 'grade analytics'],
]);

/** High-value lexicon categories. Generic PROBLEM and NEED are omitted. */
const PRIORITY_LEXICON_TYPES = [
  NlpLexiconType.COMPLAINT,
  NlpLexiconType.URGENCY,
  NlpLexiconType.COST,
  NlpLexiconType.TIME,
  NlpLexiconType.ACCESSIBILITY,
  NlpLexiconType.SAFETY,
  NlpLexiconType.RELIABILITY,
  NlpLexiconType.OPPORTUNITY,
  NlpLexiconType.FEATURE_REQUEST,
] as const satisfies readonly NlpLexiconType[];

/**
 * Extracts canonical, evidence-backed keywords.
 *
 * Comments receive greater weight because they are normally direct user
 * feedback. Product descriptions and long non-complaint posts are excluded.
 * Every exposed keyword belongs to a stable workflow vocabulary, preventing
 * accidental adjacent-word fragments from becoming API keywords or topics.
 *
 * @author Eman
 */
@Injectable()
export class KeywordExtractionService {
  extract(
    analyzedTexts: readonly LexiconTextAnalysisResult[],
  ): WeightedKeyword[] {
    const weightedFrequencyMap = new Map<string, number>();

    for (const text of analyzedTexts) {
      if (this.shouldSkipText(text)) {
        continue;
      }

      const normalizedText = this.normalizeText(
        `${text.originalText} ${text.cleanedText}`,
      );
      const canonicalTerms = this.extractCanonicalTerms(normalizedText);
      const lexiconTerms = this.extractPriorityLexiconTerms(text);
      const baseWeight =
        text.sourceType === 'COMMENT' ? COMMENT_TERM_WEIGHT : POST_TERM_WEIGHT;

      this.addUniqueTerms(
        weightedFrequencyMap,
        [...canonicalTerms, ...lexiconTerms],
        baseWeight,
      );
    }

    return [...weightedFrequencyMap.entries()]
      .filter(([, frequency]) => frequency >= MINIMUM_KEYWORD_FREQUENCY)
      .map(([keyword, frequency]) => ({ keyword, frequency }))
      .sort(
        (first, second) =>
          second.frequency - first.frequency ||
          first.keyword.localeCompare(second.keyword),
      )
      .slice(0, MAX_EXTRACTED_KEYWORDS);
  }

  private extractCanonicalTerms(value: string): string[] {
    return CANONICAL_KEYWORD_DEFINITIONS.filter((definition) =>
      definition.patterns.some((pattern) => pattern.test(value)),
    ).map((definition) => definition.keyword);
  }

  private extractPriorityLexiconTerms(
    text: LexiconTextAnalysisResult,
  ): string[] {
    const stopWords = new Set(
      (STOP_WORDS[text.language] ?? []).map((word) => this.normalizeTerm(word)),
    );

    return PRIORITY_LEXICON_TYPES.flatMap(
      (type) => text.matchedLexicons[type] ?? [],
    )
      .map((term) => this.normalizeTerm(term))
      .filter((term) => Boolean(term) && !stopWords.has(term))
      .map((term) => LEXICON_TERM_ALIASES.get(term) ?? null)
      .filter((term): term is string => term !== null);
  }

  private addUniqueTerms(
    frequencyMap: Map<string, number>,
    terms: readonly string[],
    weight: number,
  ): void {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error('Keyword weight must be a finite positive number.');
    }

    for (const term of new Set(
      terms.map((value) => value.trim()).filter(Boolean),
    )) {
      frequencyMap.set(term, (frequencyMap.get(term) ?? 0) + weight);
    }
  }

  private shouldSkipText(text: LexiconTextAnalysisResult): boolean {
    if (isLikelyProductDescription(text.originalText, text.sourceType)) {
      return true;
    }

    return (
      text.sourceType === 'POST' &&
      text.originalText.length >= 1_200 &&
      !hasDirectCommunityComplaint(text.originalText)
    );
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[’‘`]/gu, "'")
      .replace(/[^\p{L}\p{N}\s'-.!?]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private normalizeTerm(value: string): string {
    return typeof value === 'string'
      ? value
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim()
      : '';
  }
}
