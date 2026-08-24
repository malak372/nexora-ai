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
        title: 'Login and Account Access Failures',
        terms: [
          'cannot access my account',
          'cant access my account',
          'can t access my account',
          'unable to access my account',
          'cannot access account',
          'unable to access account',
          'locked out of my account',
          'locked out of account',
          'cannot log in',
          'cant log in',
          'can t log in',
          'unable to log in',
          'cannot sign in',
          'unable to sign in',
          'account access failure',
        ],
      },
      {
        title: 'Script Execution Policy and Local Tool Permission Failures',
        terms: [
          'script execution policy failure',
          'powershell script execution restriction',
          'local tool permission failure',
          'script execution disabled',
          'pssecurityexception',
        ],
      },
      {
        title: 'Blockchain Transaction Balance Validation Failures',
        terms: [
          'blockchain transaction insufficient funds',
          'transaction balance validation failure',
          'unexpected insufficient funds',
          'swap insufficient funds',
          'wallet balance validation failure',
        ],
      },
      {
        title: 'Blockchain Transaction Execution and Smart Contract Revert Failures',
        terms: [
          'transaction reverted',
          'transaction revert',
          'execution reverted',
          'reverted without reason string',
          'provider error transaction',
          'providererror transaction',
          'smart contract transaction failed',
          'smart contract execution failed',
          'failed blockchain transaction',
          'gas estimation failed',
          'cannot estimate gas',
          'evm revert',
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
        title: 'Rental Lease-Term Filtering Limitations',
        terms: [
          'rental lease term filtering',
          'rental duration filtering',
          'short term rental exclusion',
          'lease duration filter',
        ],
      },
      {
        title: 'Rental Application Data Persistence Failures',
        terms: [
          'rental application data persistence',
          'stale rental application data',
          'old rental application notes',
        ],
      },
      {
        title: 'Repeated Session Logout Failures',
        terms: [
          'repeated session logout',
          'unexpected logout',
          'session persistence failure',
        ],
      },
      {
        title: 'Favorites Location Filtering Gaps',
        terms: [
          'favorites location filtering',
          'saved homes location filtering',
          'favorites filter gap',
        ],
      },
      {
        title: 'Multi-Criteria Property Filtering Limitations',
        terms: [
          'multi criteria property filtering',
          'multiple property filters',
          'simultaneous property filters',
        ],
      },
      {
        title: 'User-Defined Property Tag Persistence Failures',
        terms: [
          'property tag persistence',
          'custom tag persistence',
          'user defined tag persistence',
        ],
      },
      {
        title: 'Feature Removal and Change Notification Gaps',
        terms: [
          'feature change notification',
          'feature removal notification',
          'functionality change notification',
        ],
      },
      {
        title: 'Rental Accessibility Information Gaps',
        terms: [
          'rental accessibility information',
          'housing accessibility metadata',
          'rental ada information',
        ],
      },
      {
        title: 'Application Access and Support Failures',
        terms: [
          'application access support',
          'cannot access application and no support',
          'customer support access failure',
        ],
      },
      {
        title: 'Streaming Data Integrity and Staleness Failures',
        terms: [
          'streaming data integrity',
          'streaming pipeline integrity',
          'streaming pipeline stale data',
          'stale streaming data',
          'skewed streaming data',
          'incorrect streaming data',
          'silent data corruption',
          'silent data quality failure',
        ],
      },
      {
        title: 'Accessibility Focus and Keyboard Navigation Failures',
        terms: [
          'keyboard appears frozen',
          'keyboard freeze',
          'focus trap',
          'focus remains on stale',
          'focus remains',
          'keyboard input captured',
          'keystrokes captured',
          'type ahead search',
          'accessible panel missing',
          'screen reader navigation failure',
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
        title: 'AI Hallucination and Output Reliability Failures',
        terms: [
          'ai hallucination',
          'model hallucination',
          'hallucination',
          'hallucinations',
          'fabricated facts',
          'fabricated citations',
          'made-up facts',
          'false citations',
          'wrong facts',
          'incorrect facts',
          'unsupported claims',
          'output reliability',
          'factuality failure',
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

    if (/\bcrash[- ]course\b/iu.test(normalizedTerm)) {
      return '';
    }

    if (
      /\b(?:streaming|stream)\s+pipelines?\b/iu.test(normalizedTerm) &&
      /\b(?:stale|skewed|incorrect|wrong|corrupt(?:ed|ion)?|silent)\b/iu.test(
        normalizedTerm,
      )
    ) {
      return 'Streaming Data Integrity and Staleness Failures';
    }

    if (
      /\b(?:keyboard (?:appears? )?(?:frozen|freeze)|focus (?:remains|stays|trapped|stuck)|focus trap|keyboard input captured|keystrokes captured|type ahead|screen reader)\b/iu.test(
        normalizedTerm,
      )
    ) {
      return 'Accessibility Focus and Keyboard Navigation Failures';
    }

    if (
      /\b(?:cannot|can t|cant|unable to)\s+(?:log in|login|sign in|access)\s+(?:(?:to\s+)?(?:my|the|this|an?)\s+)?account\b/iu.test(
        normalizedTerm,
      ) ||
      /\blocked out of (?:my|the|this)?\s*account\b/iu.test(normalizedTerm)
    ) {
      return 'Login and Account Access Failures';
    }

    if (
      normalizedTerm.length === 0 ||
      this.isGenericProblemTerm(normalizedTerm, language)
    ) {
      return '';
    }

    const groups = this.problemGroups[language] ?? [];
    const matchedGroup = groups.find((group) => {
      if (
        group.title === 'Application Reliability and Crash Failures' &&
        !this.hasSoftwareRuntimeContext(normalizedTerm)
      ) {
        return false;
      }
      return group.terms.some((groupTerm) =>
        this.isRelatedTerm(normalizedTerm, groupTerm),
      );
    });

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

  private hasSoftwareRuntimeContext(value: string): boolean {
    const explicitRuntime =
      /\b(?:runtime error|runtime failure|exception|segfault|application crash|app crash|software crash|browser crash|server crash)\b/iu.test(value);
    const softwareContext =
      /\b(?:app|application|software|program|process|server|browser|website|web app|mobile app|desktop app|operating system|api|code|runtime)\b/iu.test(value);
    const runtimeFailure =
      /\b(?:crash(?:es|ed|ing)?|freeze|frozen|unresponsive|runtime error|exception|segfault)\b/iu.test(value);
    return explicitRuntime || (softwareContext && runtimeFailure);
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
