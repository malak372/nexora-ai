import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

type ProblemGroup = {
  readonly title: string;
  readonly terms: ReadonlyArray<string>;
};

/**
 * Generic labels that may indicate the presence of a complaint but do not
 * describe an actionable software problem by themselves.
 */
const GENERIC_PROBLEM_TERMS: Partial<
  Record<LanguageCode, ReadonlySet<string>>
> = {
  [LanguageCode.EN]: new Set([
    'app',
    'application',
    'bad',
    'challenge',
    'challenging',
    'complaint',
    'difficulty',
    'issue',
    'issues',
    'need',
    'needs',
    'poor',
    'problem',
    'problems',
    'service',
    'system',
  ]),
  [LanguageCode.AR]: new Set([
    'تحدي',
    'تحديات',
    'حاجة',
    'سيئ',
    'صعب',
    'صعوبة',
    'مشكلة',
    'مشاكل',
    'نظام',
    'تطبيق',
  ]),
};

/**
 * Normalizes problem-related terms into stable recurring problem titles.
 *
 * Generic trigger words are rejected so values such as "Problem",
 * "Difficulty", or "Need" cannot become top-ranked opportunities. Concrete
 * workflow and failure categories are grouped into actionable titles instead.
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
        title: 'Cross-Device Access Barriers',
        terms: [
          'cross device access',
          'desktop access',
          'laptop access',
          'computer access',
          'mobile only',
          'cannot install on desktop',
          'cannot download on computer',
        ],
      },
      {
        title: 'Account Activation and Login Failures',
        terms: [
          'activation email',
          'verification email',
          'verification code',
          'account activation',
          'registration failure',
          'login failure',
          'authentication failure',
          'login loop',
          'sign in failure',
        ],
      },
      {
        title: 'Document Access and Download Failures',
        terms: [
          'document download failure',
          'download failure',
          'file download error',
          'syllabus link failure',
          'broken document link',
          'cannot open document',
          'cannot download document',
        ],
      },
      {
        title: 'Data Loss and Synchronization Failures',
        terms: [
          'data loss',
          'lost progress',
          'missing history',
          'sync failure',
          'synchronization failure',
          'deleted classes',
        ],
      },
      {
        title: 'Navigation and Interface Failures',
        terms: [
          'hard to navigate',
          'difficult to navigate',
          'confusing interface',
          'navigation problem',
          'usability problem',
          'poor user interface',
          'broken navigation',
          'back button failure',
        ],
      },
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
        title: 'High Cost or Paywall Restrictions',
        terms: [
          'cost',
          'price',
          'expensive',
          'fee',
          'payment',
          'paywall',
          'limited unless paid',
        ],
      },
      {
        title: 'Limited Accessibility',
        terms: [
          'access',
          'accessible',
          'accessibility',
          'availability',
          'unavailable',
          'disabled',
        ],
      },
      {
        title: 'Application Reliability and Crash Failures',
        terms: [
          'reliable',
          'reliability',
          'crash',
          'freeze',
          'error',
          'bug',
          'broken',
          'failure',
          'application instability',
          'reliability issue',
          'crash issue',
          'crash failure',
        ],
      },
      {
        title: 'Safety and Privacy Concerns',
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
        title: 'Poor Communication and Notifications',
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
        title: 'محدودية الوصول بين الأجهزة',
        terms: [
          'الوصول من الكمبيوتر',
          'الوصول من اللابتوب',
          'الهاتف فقط',
          'لا يمكن التنزيل على الكمبيوتر',
        ],
      },
      {
        title: 'فشل تفعيل الحساب',
        terms: [
          'رسالة التفعيل',
          'رمز التحقق',
          'تفعيل الحساب',
          'فشل التسجيل',
          'فشل تسجيل الدخول',
        ],
      },
      {
        title: 'فشل الوصول إلى الملفات وتنزيلها',
        terms: [
          'فشل تنزيل الملف',
          'خطأ تنزيل المستند',
          'رابط ملف معطل',
          'لا يمكن فتح الملف',
        ],
      },
      {
        title: 'فقدان البيانات وفشل المزامنة',
        terms: [
          'فقدان البيانات',
          'ضياع التقدم',
          'اختفاء السجل',
          'فشل المزامنة',
        ],
      },
      {
        title: 'صعوبة التنقل وواجهة الاستخدام',
        terms: ['صعب التنقل', 'واجهة مربكة', 'مشكلة التنقل'],
      },
      {
        title: 'وقت انتظار طويل',
        terms: ['انتظار', 'طابور', 'تأخير', 'متأخر', 'بطيء', 'بطء'],
      },
      {
        title: 'صعوبة حجز المواعيد',
        terms: ['موعد', 'مواعيد', 'حجز', 'جدولة'],
      },
      {
        title: 'تكلفة مرتفعة أو قيود مدفوعة',
        terms: ['تكلفة', 'سعر', 'أسعار', 'غالي', 'رسوم', 'دفع', 'مدفوع'],
      },
      {
        title: 'محدودية الوصول',
        terms: ['وصول', 'إتاحة', 'متاح', 'غير متاح', 'ذوي الإعاقة'],
      },
      {
        title: 'مشكلات الموثوقية والتعطل',
        terms: ['موثوقية', 'عطل', 'أعطال', 'خطأ', 'أخطاء', 'تعطل', 'فشل'],
      },
      {
        title: 'مخاوف السلامة والخصوصية',
        terms: ['سلامة', 'أمان', 'خطر', 'مخاطر', 'خصوصية', 'حماية'],
      },
      {
        title: 'ضعف التواصل والإشعارات',
        terms: ['رسالة', 'إشعار', 'اتصال', 'تواصل', 'رد', 'تحديث'],
      },
    ],
  };

  /** Converts a raw term into a stable language-aware problem title. */
  normalize(term: string, language: LanguageCode): string {
    const normalizedTerm = this.normalizeTerm(term);

    if (
      normalizedTerm.length === 0 ||
      this.isGenericProblemTerm(normalizedTerm, language)
    ) {
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

  /** Returns true when a term is only a generic complaint trigger. */
  private isGenericProblemTerm(term: string, language: LanguageCode): boolean {
    return GENERIC_PROBLEM_TERMS[language]?.has(term) ?? false;
  }

  /** Checks whether a term matches a configured problem group. */
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

  /** Normalizes a term before grouping. */
  private normalizeTerm(term: string): string {
    return typeof term === 'string'
      ? term
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim()
      : '';
  }

  /** Converts an unmatched English term into a readable title. */
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
      .filter(Boolean)
      .map((word, index) =>
        index > 0 && minorWords.has(word)
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(' ');
  }
}
