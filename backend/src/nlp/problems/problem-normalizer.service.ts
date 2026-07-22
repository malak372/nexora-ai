import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

type ProblemGroup = {
  readonly title: string;
  readonly terms: ReadonlyArray<string>;
};

/**
 * Normalizes problem-related terms into stable recurring problem titles.
 *
 * The service supports language-specific grouping while preserving a safe
 * fallback for languages that do not yet have configured problem groups.
 *
 * Responsibilities:
 * - Normalize raw problem terms.
 * - Group related terms into stable language-aware categories.
 * - Prevent partial-word false matches.
 * - Return readable fallback titles for unmatched terms.
 *
 * This service does not calculate severity, extract evidence, persist data,
 * or call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class ProblemNormalizerService {
  private readonly problemGroups: Partial<
    Record<LanguageCode, ReadonlyArray<ProblemGroup>>
  > = {
    [LanguageCode.EN]: [
      {
        title: 'Waiting Time',
        terms: ['waiting', 'wait', 'queue', 'delay', 'delayed', 'slow'],
      },
      {
        title: 'Appointment Difficulty',
        terms: [
          'appointment',
          'booking',
          'reservation',
          'schedule',
          'scheduling',
        ],
      },
      {
        title: 'High Cost',
        terms: ['cost', 'price', 'expensive', 'fee', 'payment'],
      },
      {
        title: 'Limited Accessibility',
        terms: [
          'access',
          'accessible',
          'availability',
          'unavailable',
          'disabled',
        ],
      },
      {
        title: 'Reliability Issues',
        terms: [
          'reliable',
          'reliability',
          'crash',
          'error',
          'bug',
          'broken',
          'failure',
        ],
      },
      {
        title: 'Safety Concerns',
        terms: [
          'safe',
          'safety',
          'risk',
          'danger',
          'privacy',
          'secure',
          'security',
        ],
      },
      {
        title: 'Poor Communication',
        terms: [
          'message',
          'notification',
          'call',
          'contact',
          'reply',
          'response',
          'update',
        ],
      },
    ],

    [LanguageCode.AR]: [
      {
        title: 'وقت انتظار طويل',
        terms: ['انتظار', 'طابور', 'تأخير', 'متأخر', 'بطيء', 'بطء'],
      },
      {
        title: 'صعوبة حجز المواعيد',
        terms: ['موعد', 'مواعيد', 'حجز', 'جدولة'],
      },
      {
        title: 'تكلفة مرتفعة',
        terms: ['تكلفة', 'سعر', 'أسعار', 'غالي', 'مرتفعة', 'رسوم', 'دفع'],
      },
      {
        title: 'محدودية الوصول',
        terms: ['وصول', 'إتاحة', 'متاح', 'غير متاح', 'ذوي الإعاقة'],
      },
      {
        title: 'مشكلات الموثوقية',
        terms: [
          'موثوقية',
          'عطل',
          'أعطال',
          'خطأ',
          'أخطاء',
          'مشكلة',
          'تعطل',
          'فشل',
        ],
      },
      {
        title: 'مخاوف السلامة',
        terms: ['سلامة', 'أمان', 'خطر', 'مخاطر', 'خصوصية', 'حماية'],
      },
      {
        title: 'ضعف التواصل',
        terms: ['رسالة', 'إشعار', 'اتصال', 'تواصل', 'رد', 'تحديث'],
      },
    ],
  };

  /**
   * Converts a raw term into a stable language-aware problem title.
   *
   * @param term Raw problem-related lexicon term.
   * @param language Resolved language of the supporting text.
   * @returns Stable recurring problem title.
   */
  normalize(term: string, language: LanguageCode): string {
    const normalizedTerm = this.normalizeTerm(term);

    if (normalizedTerm.length === 0) {
      return '';
    }

    const groups = this.problemGroups[language] ?? [];

    const matchedGroup = groups.find((group) =>
      group.terms.some((groupTerm) =>
        this.isRelatedTerm(normalizedTerm, groupTerm),
      ),
    );

    if (matchedGroup) {
      return matchedGroup.title;
    }

    return language === LanguageCode.EN
      ? this.toEnglishTitleCase(normalizedTerm)
      : normalizedTerm;
  }

  /**
   * Checks whether a term matches a configured group term.
   *
   * Matching is performed using complete normalized words or phrases instead
   * of unrestricted substring matching, which reduces false positives.
   *
   * @param term Normalized extracted term.
   * @param groupTerm Configured group term.
   * @returns True when the terms are related.
   */
  private isRelatedTerm(term: string, groupTerm: string): boolean {
    const normalizedGroupTerm = this.normalizeTerm(groupTerm);

    if (term === normalizedGroupTerm) {
      return true;
    }

    const paddedTerm = ` ${term} `;
    const paddedGroupTerm = ` ${normalizedGroupTerm} `;

    return (
      paddedTerm.includes(paddedGroupTerm) ||
      paddedGroupTerm.includes(paddedTerm)
    );
  }

  /**
   * Normalizes a term before matching.
   *
   * Unicode letters and numbers are preserved so Arabic and other supported
   * languages remain intact.
   *
   * @param term Raw problem term.
   * @returns Normalized lowercase term.
   */
  private normalizeTerm(term: string): string {
    return term
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Converts an unmatched English term into a readable title.
   *
   * @param value Normalized English term.
   * @returns Title-cased value.
   */
  private toEnglishTitleCase(value: string): string {
    const minorWords = new Set([
      'a',
      'an',
      'and',
      'as',
      'at',
      'but',
      'by',
      'for',
      'from',
      'in',
      'of',
      'on',
      'or',
      'the',
      'to',
      'with',
    ]);

    return value
      .split(' ')
      .filter((word) => word.length > 0)
      .map((word, index) => {
        if (index > 0 && minorWords.has(word)) {
          return word;
        }

        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }
}
