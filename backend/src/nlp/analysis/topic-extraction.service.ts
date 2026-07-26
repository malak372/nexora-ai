import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import type {
  WeightedKeyword,
  WeightedTopic,
} from '../pipeline/types/intelligent-analysis.types';
import type { TopicRule } from '../topic-rules/topic-rule.service';
import { TopicRuleService } from '../topic-rules/topic-rule.service';

const MAX_EXTRACTED_TOPICS = 12;
const MINIMUM_TOPIC_FREQUENCY = 1;

/** Stable high-level topics used by idea discovery and API responses. */
const CANONICAL_TOPIC_DEFINITIONS: ReadonlyArray<{
  readonly topic: string;
  readonly patterns: readonly RegExp[];
}> = [
  {
    topic: 'AI-Assisted Data Transformation',
    patterns: [
      /\b(?:ai-assisted algorithm discovery|transformation recipe generation|data transformation|algorithm discovery|cyberchef)\b/iu,
    ],
  },
  {
    topic: 'Privacy-Preserving AI',
    patterns: [
      /\b(?:local ai processing|data privacy and consent|on-device ai|privacy-preserving ai)\b/iu,
    ],
  },
  {
    topic: 'Multi-Agent Orchestration',
    patterns: [
      /\b(?:agent orchestration|multi-agent orchestration|agent auto-discovery|agent routing)\b/iu,
    ],
  },
  {
    topic: 'Explainable AI',
    patterns: [
      /\b(?:explainable ai recommendations|explainable ai|explainability|auditability|confidence score|uncertainty estimate)\b/iu,
    ],
  },
  {
    topic: 'Collaborative Transformation Workflows',
    patterns: [
      /\b(?:collaborative recipe repository|shared recipe repository|cyberchef integration|recipe sharing|recipe versioning)\b/iu,
    ],
  },
  {
    topic: 'Authentication',
    patterns: [
      /\b(?:authentication|login loop|account activation|email verification|session recovery|login|sign in|account access)\b/iu,
    ],
  },
  {
    topic: 'Data Synchronization',
    patterns: [
      /\b(?:data synchronization|data recovery|data loss|sync|backup|restore)\b/iu,
    ],
  },
  {
    topic: 'Academic Content Access',
    patterns: [
      /\b(?:document download|download pdf|document access|file download|syllabus)\b/iu,
    ],
  },
  {
    topic: 'Learning Resources',
    patterns: [
      /\b(?:course material|learning material|lecture material|reading material|assignment access|ebook|e-book)\b/iu,
    ],
  },
  {
    topic: 'Cross-Device Learning',
    patterns: [
      /\b(?:cross-device access|desktop access|laptop access|computer access|mobile and desktop)\b/iu,
    ],
  },
  {
    topic: 'Application Reliability',
    patterns: [
      /\b(?:application crash|application reliability|crash|freeze|unstable|error|slow|glitch)\b/iu,
    ],
  },
  {
    topic: 'Navigation and Usability',
    patterns: [
      /\b(?:navigation|user interface|back button|scrolling|tabs?|interface|ui)\b/iu,
    ],
  },
  {
    topic: 'Academic Progress and Grades',
    patterns: [
      /\b(?:grade analytics|grade tracker|academic analytics|progress analytics|grades?)\b/iu,
    ],
  },
  {
    topic: 'Offline Learning',
    patterns: [
      /\b(?:offline cache|offline access|without internet|low bandwidth)\b/iu,
    ],
  },
  {
    topic: 'Pricing and Access Restrictions',
    patterns: [
      /\b(?:paywall|subscription|paid feature|limited tasks|limited features)\b/iu,
    ],
  },
];

/** Topic labels that expose raw fragments rather than a stable concept. */
const REJECTED_TOPIC_LABEL_PATTERNS = [
  /^(?:data classes|plus data|transferring data|access edugate|access skill)$/iu,
  /^(?:back main|back start|computer downloading|liked sync)$/iu,
] as const;

/**
 * Extracts only canonical or administrator-curated high-level topics.
 *
 * Raw keyword title-casing is intentionally prohibited. This prevents phrases
 * such as "Data Classes", "Plus Data", and "Access Edugate" from leaking
 * into the public NLP result merely because they appeared repeatedly beside an
 * actionable token.
 *
 * @author Eman
 */
@Injectable()
export class TopicExtractionService {
  constructor(private readonly topicRuleService: TopicRuleService) {}

  async extract(
    keywords: readonly WeightedKeyword[],
    language: LanguageCode,
  ): Promise<WeightedTopic[]> {
    if (keywords.length === 0) {
      return [];
    }

    const topicRules = await this.topicRuleService.getRules(language);
    const topicFrequencyMap = new Map<string, number>();

    for (const keyword of keywords) {
      const normalizedKeyword = this.normalizeTerm(keyword.keyword);

      if (!normalizedKeyword || keyword.frequency < MINIMUM_TOPIC_FREQUENCY) {
        continue;
      }

      const topic =
        this.findCanonicalTopic(normalizedKeyword) ??
        this.findAdministratorTopic(normalizedKeyword, topicRules);

      if (!topic || !this.isSafeTopicLabel(topic)) {
        continue;
      }

      topicFrequencyMap.set(
        topic,
        (topicFrequencyMap.get(topic) ?? 0) + keyword.frequency,
      );
    }

    return Array.from(topicFrequencyMap, ([topic, frequency]) => ({
      topic,
      frequency,
    }))
      .sort(
        (first, second) =>
          second.frequency - first.frequency ||
          first.topic.localeCompare(second.topic),
      )
      .slice(0, MAX_EXTRACTED_TOPICS);
  }

  private findCanonicalTopic(keyword: string): string | null {
    return (
      CANONICAL_TOPIC_DEFINITIONS.find((definition) =>
        definition.patterns.some((pattern) => pattern.test(keyword)),
      )?.topic ?? null
    );
  }

  private findAdministratorTopic(
    keyword: string,
    topicRules: readonly TopicRule[],
  ): string | null {
    const matchedRule = topicRules.find((rule) =>
      rule.terms.some((term) =>
        this.isRelatedTerm(keyword, this.normalizeTerm(term)),
      ),
    );

    const topic = matchedRule?.topic.trim() ?? '';

    return topic && this.isSafeTopicLabel(topic) ? topic : null;
  }

  private isSafeTopicLabel(value: string): boolean {
    const normalized = this.normalizeTerm(value);
    const words = normalized.split(' ').filter(Boolean);

    if (words.length === 0 || words.length > 6) {
      return false;
    }

    if (
      REJECTED_TOPIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      return false;
    }

    return words.every(
      (word) => word.length >= 3 || ['ai', 'ui'].includes(word),
    );
  }

  private isRelatedTerm(keyword: string, term: string): boolean {
    if (!keyword || !term) {
      return false;
    }

    if (keyword === term) {
      return true;
    }

    const keywordWords = keyword.split(' ');
    const termWords = term.split(' ');

    return (
      this.containsConsecutiveWords(keywordWords, termWords) ||
      this.containsConsecutiveWords(termWords, keywordWords)
    );
  }

  private containsConsecutiveWords(
    sourceWords: readonly string[],
    candidateWords: readonly string[],
  ): boolean {
    if (
      candidateWords.length === 0 ||
      candidateWords.length > sourceWords.length
    ) {
      return false;
    }

    const finalStartIndex = sourceWords.length - candidateWords.length;

    for (let startIndex = 0; startIndex <= finalStartIndex; startIndex += 1) {
      const matches = candidateWords.every(
        (candidateWord, offset) =>
          sourceWords[startIndex + offset] === candidateWord,
      );

      if (matches) {
        return true;
      }
    }

    return false;
  }

  private normalizeTerm(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
