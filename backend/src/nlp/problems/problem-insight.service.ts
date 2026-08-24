import { Injectable } from '@nestjs/common';
import { LanguageCode, NlpLexiconType } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import {
  buildCommunityEvidenceExcerpt,
  classifyDirectCommunityEvidence,
  isLikelyProductDescription,
  isWeakCommunityEvidence,
  scoreCommunityEvidenceQuality,
  segmentCommunityEvidenceIssues,
} from '../common/utils/community-evidence.util';
import { hasDocumentAccessOrDownloadFailure } from '../common/utils/document-access-evidence.util';
import { resolvePrimaryProblemFamily } from '../common/utils/problem-family-matching.util';
import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type { IntelligentAnalysisOutput } from '../pipeline/types/intelligent-analysis.types';

import { ProblemNormalizerService } from './problem-normalizer.service';
import { ProblemSeverityPolicyService } from './problem-severity-policy.service';

const MAX_PROBLEM_EVIDENCE_SAMPLES = 3;
const MAX_EVIDENCE_SAMPLE_LENGTH = 650;

type RecurringProblem = IntelligentAnalysisOutput['recurringProblems'][number];

type ScoredEvidenceSample = {
  readonly text: string;
  readonly quality: number;
};

type ProblemAccumulator = {
  frequency: number;
  negativeSignals: number;
  urgencySignals: number;
  blockingSignals: number;
  criticalOperationalSignals: number;
  evidenceQualityTotal: number;
  evidenceQualityCount: number;
  evidenceSamples: ScoredEvidenceSample[];
};

/**
 * Extracts evidence-backed recurring problems from lexicon-analyzed texts.
 *
 * The service distinguishes direct community complaints from promotional
 * product descriptions, derives concrete workflow categories from complaint
 * phrases, rejects generic labels, and stores short representative evidence
 * excerpts instead of complete multi-thousand-character app descriptions.
 *
 * @author Eman
 */
@Injectable()
export class ProblemInsightService {
  constructor(
    private readonly problemNormalizerService: ProblemNormalizerService,
    private readonly problemSeverityPolicyService: ProblemSeverityPolicyService,
  ) {}

  /** Extracts recurring problems sorted by frequency and severity. */
  extract(
    analyzedTexts: ReadonlyArray<LexiconTextAnalysisResult>,
    limit?: number,
  ): RecurringProblem[] {
    const problemMap = new Map<string, ProblemAccumulator>();

    for (const text of analyzedTexts) {
      if (!this.shouldAnalyzeText(text)) {
        continue;
      }

      const issueTexts = segmentCommunityEvidenceIssues(text.originalText);

      for (const issueText of issueTexts) {
        const problemTerms = [
          ...this.inferConcreteProblemTerms(issueText, text.language),
        ];

        if (issueTexts.length === 1) {
          problemTerms.push(...this.extractSpecificLexiconTerms(text));
        }

        const normalizedProblems = new Set(
          problemTerms
            .map((term) =>
              this.problemNormalizerService.normalize(term, text.language),
            )
            .filter(Boolean)
            .filter((title) =>
              this.isEvidenceAlignedWithProblemTitle(issueText, title),
            ),
        );

        for (const title of normalizedProblems) {
          const current = problemMap.get(title) ?? this.createAccumulator();
          const evidenceQuality = scoreCommunityEvidenceQuality(issueText);

          current.frequency += 1;
          current.evidenceQualityTotal += evidenceQuality;
          current.evidenceQualityCount += 1;

          if (text.sentiment === Sentiment.NEGATIVE && evidenceQuality >= 0.45) {
            current.negativeSignals += 1;
          }

          if (this.hasUrgencySignal(text) && evidenceQuality >= 0.45) {
            current.urgencySignals += 1;
          }

          if (this.hasBlockingFailureSignal(issueText)) {
            current.blockingSignals += 1;
          }

          if (this.hasCriticalOperationalSignal(issueText)) {
            current.criticalOperationalSignals += 1;
          }

          this.addEvidenceSample(
            current.evidenceSamples,
            this.buildEvidenceExcerpt(issueText, title),
            evidenceQuality,
          );

          problemMap.set(title, current);
        }
      }
    }

    const results: RecurringProblem[] = [...problemMap.entries()]
      .map(([title, accumulator]) => ({
        title,
        frequency: accumulator.frequency,
        severity: this.problemSeverityPolicyService.calculate({
          frequency: accumulator.frequency,
          negativeSignals: accumulator.negativeSignals,
          urgencySignals: accumulator.urgencySignals,
          blockingSignals: accumulator.blockingSignals,
          criticalOperationalSignals: accumulator.criticalOperationalSignals,
          averageEvidenceQuality:
            accumulator.evidenceQualityCount > 0
              ? accumulator.evidenceQualityTotal /
                accumulator.evidenceQualityCount
              : 0,
        }),
        evidenceSamples: accumulator.evidenceSamples.map(
          (sample) => sample.text,
        ),
      }))
      .sort((first, second) => {
        if (second.frequency !== first.frequency) {
          return second.frequency - first.frequency;
        }

        const severityDifference =
          this.problemSeverityPolicyService.getWeight(second.severity) -
          this.problemSeverityPolicyService.getWeight(first.severity);

        return severityDifference !== 0
          ? severityDifference
          : first.title.localeCompare(second.title);
      });

    const normalizedLimit = this.normalizeLimit(limit);
    return normalizedLimit === undefined
      ? results
      : results.slice(0, normalizedLimit);
  }

  /** Determines whether one text is reliable problem evidence. */
  private shouldAnalyzeText(text: LexiconTextAnalysisResult): boolean {
    if (
      isLikelyProductDescription(text.originalText, text.sourceType) ||
      isWeakCommunityEvidence(text.originalText)
    ) {
      return false;
    }

    const evidenceKind = classifyDirectCommunityEvidence(
      text.originalText,
      text.sourceType,
    );
    const hasActionableDirectEvidence =
      evidenceKind === 'USER_COMPLAINT' ||
      evidenceKind === 'FEATURE_REQUEST' ||
      evidenceKind === 'OBSERVED_UNMET_NEED';
    const hasComplaintLexicon =
      this.hasLexiconMatches(text, NlpLexiconType.COMPLAINT) ||
      this.hasLexiconMatches(text, NlpLexiconType.PROBLEM);

    if (text.sourceType === 'COMMENT') {
      return (
        hasActionableDirectEvidence ||
        (evidenceKind !== 'NONE' &&
          text.sentiment === Sentiment.NEGATIVE &&
          hasComplaintLexicon)
      );
    }

    return hasActionableDirectEvidence;
  }

  /** Extracts only category-specific lexicon terms, not generic triggers. */
  private extractSpecificLexiconTerms(
    text: LexiconTextAnalysisResult,
  ): string[] {
    const relevantTypes: ReadonlyArray<NlpLexiconType> = [
      NlpLexiconType.TIME,
      NlpLexiconType.COST,
      NlpLexiconType.ACCESSIBILITY,
      NlpLexiconType.SAFETY,
      NlpLexiconType.RELIABILITY,
    ];

    return relevantTypes
      .flatMap((type) =>
        (text.matchedLexicons[type] ?? []).map((term) => ({ type, term })),
      )
      .filter(({ type, term }) =>
        this.isLexiconProblemSupported(type, term, text.originalText),
      )
      .map(({ term }) => term.trim())
      .filter(Boolean);
  }

  /**
   * Prevents a broad lexicon match from creating an unsupported problem label.
   * In particular, ACCESS must not be interpreted as COST, and a generic
   * reliability word must not become a crash problem without a failure signal.
   */
  private isLexiconProblemSupported(
    type: NlpLexiconType,
    term: string,
    evidence: string,
  ): boolean {
    const normalizedEvidence = this.normalizeText(evidence);
    const normalizedTerm = this.normalizeText(term);

    if (type === NlpLexiconType.COST) {
      return /(?:paywall|subscription|price|pricing|cost|expensive|paid feature|requires? payment|have to pay|gotta pay|limited tasks?|limited features?)/iu.test(
        normalizedEvidence,
      );
    }

    if (type === NlpLexiconType.RELIABILITY) {
      if (
        /\b(?:case\s*law|caselaw|legal|law)\s+(?:database|databases|repository|repositories|source|sources)\b[^.!?]{0,120}\b(?:access|available|availability)\b|\b(?:doesn['’]?t|does not|cannot|can['’]?t|unable to)\s+have\s+access\s+to\s+(?:case\s*law|caselaw|legal|law)\s+(?:database|databases|repository|repositories|source|sources)\b/iu.test(
          normalizedEvidence,
        )
      ) {
        return false;
      }

      if (
        ['ai-feedback-correction-inflexibility', 'ai-hallucination-output-reliability'].includes(
          resolvePrimaryProblemFamily(normalizedEvidence)?.key ?? '',
        )
      ) {
        return true;
      }

      if (this.isScientificOrAlgorithmicErrorContext(normalizedEvidence)) {
        return false;
      }

      const hasExplicitCrashOrFreeze =
        this.hasActualSoftwareRuntimeFailure(normalizedEvidence);
      const hasStrongRuntimeFailure =
        /(?:bug|glitch|unstable|unreliable|doesn['’]?t work|not working|fails? to submit|submission failed)/iu.test(
          normalizedEvidence,
        ) &&
        !/(?:login|log in|sign in|activation|verification|account|server|network|website|connection|document|download|syllabus|file|link)/iu.test(
          normalizedEvidence,
        );
      const hasGenericFailureTerm =
        /(?:broken|error)/iu.test(normalizedEvidence) &&
        this.hasSoftwareProductFailureContext(normalizedEvidence) &&
        !/(?:login|log in|sign in|authentication|activation|verification|account|phone|otp|server|network|website|connection|document|download|syllabus|file|link)/iu.test(
          normalizedEvidence,
        );

      return (
        hasExplicitCrashOrFreeze ||
        hasStrongRuntimeFailure ||
        hasGenericFailureTerm
      );
    }

    if (type === NlpLexiconType.ACCESSIBILITY) {
      return /(?:cannot access|can['’]?t access|unable to access|not accessible|screen reader|keyboard navigation|contrast|caption|desktop|laptop|computer|mobile[- ]only)/iu.test(
        normalizedEvidence,
      );
    }

    return Boolean(normalizedTerm);
  }

  /** Derives concrete software-problem categories from direct complaint text. */
  private inferConcreteProblemTerms(
    value: string,
    language: LanguageCode,
  ): string[] {
    const text = this.normalizeText(value);
    const terms: string[] = [];
    const primaryProblemFamily = resolvePrimaryProblemFamily(text);

    if (primaryProblemFamily?.key === 'ai-feedback-correction-inflexibility') {
      terms.push('ai feedback correction');
    }
    if (primaryProblemFamily?.key === 'ai-hallucination-output-reliability') {
      terms.push('ai hallucination');
    }

    if (language === LanguageCode.AR) {
      if (
        /(?:كمبيوتر|لابتوب|حاسوب).*(?:لا يمكن|ما بقدر|غير متاح)|(?:الهاتف فقط)/iu.test(
          text,
        )
      ) {
        terms.push('الوصول من الكمبيوتر');
      }

      if (
        /(?:رسالة|رمز).*(?:تفعيل|تحقق).*(?:لم يصل|ما وصل|لا يصل)/iu.test(text)
      ) {
        terms.push('رسالة التفعيل');
      }

      if (/(?:بيانات|تقدم|سجل|صفوف).*(?:اختفت|ضاعت|فقدت|حذفت)/iu.test(text)) {
        terms.push('فقدان البيانات');
      }

      if (/(?:واجهة مربكة|صعب التنقل|صعوبة التنقل)/iu.test(text)) {
        terms.push('واجهة مربكة');
      }

      if (/(?:تعطل|يتعطل|تجمّد|خطأ|أخطاء)/iu.test(text)) {
        terms.push('تعطل');
      }

      return terms;
    }

    if (this.hasCrossDeviceAccessFailure(text)) {
      terms.push('cross device access');
    }

    if (
      /(?:activation|verification|confirm|account).{0,80}(?:email|code|otp).{0,80}(?:never|not|didn['’]?t|doesn['’]?t).{0,40}(?:receive|get|arrive)|(?:never|not|didn['’]?t|doesn['’]?t).{0,40}(?:receive|get).{0,80}(?:activation|verification|email|code)/iu.test(
        text,
      )
    ) {
      terms.push('activation email');
    }

    const hasScriptExecutionPolicyFailure =
      /\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|script execution (?:is )?disabled|unauthorizedaccess)\b/iu.test(
        text,
      ) &&
      /\b(?:disabled|blocked|cannot be loaded|can['’]?t be loaded|unauthorized|securityerror|pssecurityexception)\b/iu.test(
        text,
      );

    if (hasScriptExecutionPolicyFailure) {
      terms.push('script execution policy failure');
    }

    if (
      /\b(?:insufficient funds|insufficient balance|not enough funds)\b/iu.test(text) &&
      /\b(?:transaction|swap|transfer|wallet|fee|gas|rent|sol|token|bitcoin|blockchain|jupiter)\b/iu.test(
        text,
      )
    ) {
      terms.push('blockchain transaction insufficient funds');
    }

    if (
      !hasScriptExecutionPolicyFailure &&
      hasDocumentAccessOrDownloadFailure(text)
    ) {
      terms.push('document download failure');
    }

    if (
      /(?:data|history|classes|progress|assignments?|files?).{0,60}(?:gone|lost|missing|deleted|not sync|failed to sync)|(?:sync|synchronization).{0,40}(?:fail|broken|not work)/iu.test(
        text,
      )
    ) {
      terms.push('data loss');
    }

    if (
      /(?:rental length|lease term|lease duration|short[- ]term rentals?|long[- ]term rentals?).{0,120}(?:filter|exclude|include)|(?:filter|exclude|include).{0,120}(?:rental length|lease term|lease duration|short[- ]term rentals?|long[- ]term rentals?)/iu.test(
        text,
      )
    ) {
      terms.push('rental lease term filtering');
    }

    if (
      /(?:old notes?|old data|previous notes?).{0,100}(?:re-appear|reappear|return|come back)|(?:updated|updating|saved|saving).{0,100}(?:old notes?|old data|re-appear|reappear|not retained)/iu.test(
        text,
      )
    ) {
      terms.push('rental application data persistence');
    }

    if (
      /(?:keep getting logged out|keeps? logging (?:me|us) out|repeated(?:ly)? logged out|unexpected logout|session (?:expires?|drops?))/iu.test(
        text,
      )
    ) {
      terms.push('repeated session logout');
    }

    if (
      /(?:favorites?|favourites?|saved homes?|saved listings?).{0,120}(?:location|area|region).{0,80}(?:filter|search)|(?:filter|search).{0,120}(?:favorites?|favourites?).{0,80}(?:location|area|region)/iu.test(
        text,
      )
    ) {
      terms.push('favorites location filtering');
    }

    if (
      /(?:multiport|multiple filters?|two filters?|2 filters?|multiple criteria|house size and lot size).{0,120}(?:simultaneously|at once|together|filter)/iu.test(
        text,
      )
    ) {
      terms.push('multi criteria property filtering');
    }

    if (
      /(?:tags?|custom tags?|user[- ]defined tags?).{0,120}(?:vanish(?:ed)?|disappear(?:ed)?|gone|missing|removed|deleted)/iu.test(
        text,
      )
    ) {
      terms.push('property tag persistence');
    }

    if (
      /(?:announce|notify|notification|communicat).{0,140}(?:feature|functionality|change|remove|removed|vanish|disappear|alternative)|(?:feature|functionality).{0,120}(?:remove|removed|vanish|disappear).{0,120}(?:announce|notify|communication|alternative)/iu.test(
        text,
      )
    ) {
      terms.push('feature change notification');
    }

    if (
      /(?:ada|accessibility|mobility|wheelchair|stairs?).{0,140}(?:listing|rental|property|information|included|metadata)|(?:listing|rental|property).{0,140}(?:ada|accessibility|mobility|wheelchair|stairs?)/iu.test(
        text,
      )
    ) {
      terms.push('rental accessibility information');
    }

    if (
      /(?:cannot access|can['’]?t access|unable to access).{0,100}(?:customer service|support)|(?:no customer service|no support).{0,100}(?:access|application|app)/iu.test(
        text,
      )
    ) {
      terms.push('application access support');
    }

    if (
      /(?:hard|difficult|confusing).{0,30}(?:navigate|interface|use)|(?:new update|interface).{0,40}(?:confusing|hard|terrible)|(?:back button|popup|scroll|tab).{0,60}(?:break|broken|missing|block|lock|(?:can(?:not|['’]?t)|can\s+not))/iu.test(
        text,
      )
    ) {
      terms.push('confusing interface');
    }

    if (
      /(?:login|log in|sign in|authentication|session).{0,80}(?:loop|fail|error|back to|unable|(?:can(?:not|['’]?t)|can\s+not))|(?:unable|(?:can(?:not|['’]?t)|can\s+not)).{0,40}(?:login|log in|sign in)/iu.test(
        text,
      )
    ) {
      terms.push('login failure');
    }

    const legalResearchAccessLimitation =
      /\b(?:case\s*law|caselaw|legal|law)\s+(?:database|databases|repository|repositories|source|sources)\b[^.!?]{0,120}\b(?:access|available|availability)\b|\b(?:doesn['’]?t|does not|cannot|can['’]?t|unable to)\s+have\s+access\s+to\s+(?:case\s*law|caselaw|legal|law)\s+(?:database|databases|repository|repositories|source|sources)\b/iu.test(
        text,
      );
    const hasExplicitCrashOrFreeze = this.hasActualSoftwareRuntimeFailure(text);
    const hasOperationalReliabilityFailure =
      /(?:bug|glitch)/iu.test(text) &&
      /(?:app|application|software|screen|submission|upload|save|work)/iu.test(
        text,
      ) &&
      !/(?:login|log in|sign in|activation|verification|account|server|network|website|connection|document|download|syllabus|file|link)/iu.test(
        text,
      );
    const hasGenericError =
      /(?:broken|error|looping)/iu.test(text) &&
      this.hasSoftwareProductFailureContext(text) &&
      !this.isScientificOrAlgorithmicErrorContext(text) &&
      !/(?:download|document|syllabus|file|link|login|log in|sign in|activation|verification|email|code|otp|server|network|website|connection)/iu.test(
        text,
      );

    if (
      !legalResearchAccessLimitation &&
      (hasExplicitCrashOrFreeze ||
        hasOperationalReliabilityFailure ||
        hasGenericError)
    ) {
      terms.push('crash');
    }

    if (
      /(?:too expensive|paywall|have to pay|gotta pay|tasks? (?:are )?limited)/iu.test(
        text,
      )
    ) {
      terms.push('paywall');
    }

    return terms;
  }

  /**
   * Keeps a normalized problem only when the source text describes the same
   * user workflow. This final category gate applies equally to lexicon-derived
   * and rule-inferred terms, preventing broad words such as "error" or
   * "computer" from attaching authentication evidence to crash, document, or
   * cross-device categories.
   */
  private isEvidenceAlignedWithProblemTitle(
    evidence: string,
    title: string,
  ): boolean {
    const text = this.normalizeText(evidence);
    const normalizedTitle = this.normalizeText(title);
    const hasAuthenticationContext =
      /(?:login|log in|sign in|authentication|activation|verification|account|phone number|otp|verification code)/iu.test(
        text,
      );

    if (/feedback incorporation|correction failure|model correction/iu.test(normalizedTitle)) {
      return (
        resolvePrimaryProblemFamily(text)?.key ===
        'ai-feedback-correction-inflexibility'
      );
    }

    if (/hallucination|output reliability|factuality/iu.test(normalizedTitle)) {
      return (
        resolvePrimaryProblemFamily(text)?.key ===
        'ai-hallucination-output-reliability'
      );
    }

    if (/script execution|execution policy|local tool permission|powershell/iu.test(normalizedTitle)) {
      return (
        /\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|unauthorizedaccess)\b/iu.test(
          text,
        ) &&
        /\b(?:disabled|blocked|cannot be loaded|can['’]?t be loaded|unauthorized|securityerror|pssecurityexception)\b/iu.test(
          text,
        )
      );
    }

    if (/transaction balance|insufficient funds|wallet balance/iu.test(normalizedTitle)) {
      return (
        /\b(?:insufficient funds|insufficient balance|not enough funds)\b/iu.test(
          text,
        ) &&
        /\b(?:transaction|swap|transfer|wallet|fee|gas|rent|sol|token|bitcoin|blockchain|jupiter)\b/iu.test(
          text,
        )
      );
    }

    if (/document|download|syllabus|file/iu.test(normalizedTitle)) {
      return (
        hasDocumentAccessOrDownloadFailure(text) &&
        !hasAuthenticationContext &&
        !/\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|unauthorizedaccess)\b/iu.test(text)
      );
    }

    if (/cross-device|desktop|laptop|computer/iu.test(normalizedTitle)) {
      return (
        this.hasCrossDeviceAccessFailure(text) && !hasAuthenticationContext
      );
    }

    if (/activation|login|account|authentication/iu.test(normalizedTitle)) {
      return hasAuthenticationContext;
    }

    if (/reliability|crash|تعطل/iu.test(normalizedTitle)) {
      if (
        /\b(?:case\s*law|caselaw|legal|law)\s+(?:database|databases|repository|repositories|source|sources)\b[^.!?]{0,120}\b(?:access|available|availability)\b|\b(?:doesn['’]?t|does not|cannot|can['’]?t|unable to)\s+have\s+access\s+to\s+(?:case\s*law|caselaw|legal|law)\s+(?:database|databases|repository|repositories|source|sources)\b/iu.test(
          text,
        )
      ) {
        return false;
      }
      const hasExplicitRuntimeFailure = this.hasActualSoftwareRuntimeFailure(text);
      const hasNonAuthOperationalFailure =
        /(?:bug|glitch|submission failed|fails? to submit|upload failed|doesn['’]?t work|not working)/iu.test(
          text,
        ) &&
        !/(?:login|log in|sign in|authentication|activation|verification|account|server|network|website|connection|document|download|syllabus|file|link)/iu.test(
          text,
        );

      return hasExplicitRuntimeFailure || hasNonAuthOperationalFailure;
    }

    return true;
  }

  private hasActualSoftwareRuntimeFailure(value: string): boolean {
    const normalized = this.normalizeText(value).replace(
      /\bcrash[- ]course\b/giu,
      ' ',
    );

    return (
      /\b(?:app|application|platform|software|website|system|process|service|server|client)\b[^.!?\n]{0,100}\b(?:crash(?:es|ed|ing)?|freeze|freezes|frozen|unresponsive|exception|segfault|terminated unexpectedly|white screen)\b/iu.test(
        normalized,
      ) ||
      /\b(?:crash(?:es|ed|ing)?|freeze|freezes|frozen|unresponsive|exception|segfault|terminated unexpectedly|white screen)\b[^.!?\n]{0,100}\b(?:app|application|platform|software|website|system|process|service|server|client)\b/iu.test(
        normalized,
      ) ||
      /\b(?:the app|this app|my app|the application|this application)\b[^.!?\n]{0,140}\b(?:loading and loading|not responding|closes unexpectedly|keeps closing)\b/iu.test(
        normalized,
      )
    );
  }

  /** Builds category-specific evidence for one normalized problem title. */
  private buildEvidenceExcerpt(value: string, title: string): string {
    return buildCommunityEvidenceExcerpt(
      value,
      MAX_EVIDENCE_SAMPLE_LENGTH,
      this.getProblemEvidencePatterns(title),
    );
  }

  private getProblemEvidencePatterns(title: string): readonly RegExp[] {
    const normalizedTitle = title.toLocaleLowerCase();

    // Match concrete workflows before the generic word "failure".
    if (/hallucination|output reliability|factuality/iu.test(normalizedTitle)) {
      return [
        /\b(?:hallucinat(?:e|es|ed|ing|ion|ions)|fabricated? (?:facts?|answers?|citations?|sources?)|made[- ]up (?:facts?|answers?|citations?|sources?)|false citations?|wrong facts?|incorrect facts?|unsupported claims?|factuality|grounding)\b/iu,
      ];
    }

    if (/script execution|execution policy|local tool permission|powershell/iu.test(normalizedTitle)) {
      return [
        /\b(?:powershell|execution polic(?:y|ies)|pssecurityexception|\.ps1|running scripts is disabled|unauthorizedaccess)\b/iu,
        /\b(?:disabled|blocked|cannot be loaded|can['’]?t be loaded|securityerror|pssecurityexception)\b/iu,
      ];
    }

    if (/transaction balance|insufficient funds|wallet balance/iu.test(normalizedTitle)) {
      return [
        /\b(?:insufficient funds|insufficient balance|not enough funds)\b/iu,
        /\b(?:transaction|swap|transfer|wallet|fee|gas|rent|sol|token|bitcoin|blockchain|jupiter)\b/iu,
      ];
    }

    if (/document|download|file|syllabus|تنزيل|ملفات/iu.test(normalizedTitle)) {
      return [
        /\b(?:download|document|syllabus|file|broken link|null error|cannot open)\b/iu,
      ];
    }

    if (/data loss|synchronization|مزامنة|بيانات/iu.test(normalizedTitle)) {
      return [
        /\b(?:data|history|classes|progress|sync|lost|missing|gone|deleted)\b/iu,
      ];
    }

    if (
      /cross-device|desktop|laptop|computer|الأجهزة/iu.test(normalizedTitle)
    ) {
      return [/\b(?:desktop|laptop|computer|pc|mobile only|ios|android)\b/iu];
    }

    if (/activation|login|account|تفعيل/iu.test(normalizedTitle)) {
      return [
        /\b(?:activation|verification|email|code|otp|login|sign in|account)\b/iu,
      ];
    }

    if (/navigation|interface|واجهة|تنقل/iu.test(normalizedTitle)) {
      return [
        /\b(?:navigate|navigation|interface|back button|scroll|popup|tabs?)\b/iu,
      ];
    }

    if (/cost|paywall|تكلفة|مدفوعة/iu.test(normalizedTitle)) {
      return [
        /\b(?:cost|price|paywall|paid|pay|subscription|limited tasks|limited features)\b/iu,
      ];
    }

    if (/reliability|crash|تعطل/iu.test(normalizedTitle)) {
      return [
        /\b(?:crash|freeze|error|bug|glitch|looping|doesn['’]?t work)\b/iu,
      ];
    }

    return [];
  }

  private hasUrgencySignal(text: LexiconTextAnalysisResult): boolean {
    return this.hasLexiconMatches(text, NlpLexiconType.URGENCY);
  }

  private hasLexiconMatches(
    text: LexiconTextAnalysisResult,
    type: NlpLexiconType,
  ): boolean {
    return (text.matchedLexicons[type] ?? []).length > 0;
  }

  private createAccumulator(): ProblemAccumulator {
    return {
      frequency: 0,
      negativeSignals: 0,
      urgencySignals: 0,
      blockingSignals: 0,
      criticalOperationalSignals: 0,
      evidenceQualityTotal: 0,
      evidenceQualityCount: 0,
      evidenceSamples: [],
    };
  }

  private addEvidenceSample(
    samples: ScoredEvidenceSample[],
    sample: string,
    quality: number,
  ): void {
    const normalizedSample = sample.trim();

    if (!normalizedSample || quality < 0.45) {
      return;
    }

    const existingIndex = samples.findIndex(
      (current) => current.text === normalizedSample,
    );

    if (existingIndex >= 0) {
      if (quality > samples[existingIndex].quality) {
        samples[existingIndex] = { text: normalizedSample, quality };
      }
      return;
    }

    samples.push({ text: normalizedSample, quality });
    samples.sort((first, second) => second.quality - first.quality);

    if (samples.length > MAX_PROBLEM_EVIDENCE_SAMPLES) {
      samples.length = MAX_PROBLEM_EVIDENCE_SAMPLES;
    }
  }

  /** Rejects scientific uses of "error" that do not describe product failure. */
  private isScientificOrAlgorithmicErrorContext(value: string): boolean {
    return /(?:quantum error correction|error[- ]correcting code|error correction algorithm|statistical error|measurement error|prediction error|training error|encoding error rate)/iu.test(
      value,
    );
  }

  /** Requires a concrete software surface when only a generic failure word matched. */
  private hasSoftwareProductFailureContext(value: string): boolean {
    return /(?:app|application|software|website|platform|system|screen|page|feature|button|submission|session|account|mobile|ios|android|server|network|interface|workflow|process)/iu.test(
      value,
    );
  }

  /** Detects a failure that prevents the user from completing a core action. */
  private hasBlockingFailureSignal(value: string): boolean {
    const normalized = this.normalizeText(value);

    return /(?:can(?:not|['’]?t)|unable to|won['’]?t|failed to|does(?:n['’]?t| not)).{0,50}(?:do anything|login|log in|connect|sync|open|delete|save|start|stop|turn|control|access|pay|send|receive)|(?:crash|crashes|crashed|crashing|unresponsive|disconnects? without warning)/iu.test(
      normalized,
    );
  }

  /** Detects operational impact that can interrupt physical or time-critical work. */
  private hasCriticalOperationalSignal(value: string): boolean {
    const normalized = this.normalizeText(value);
    const hasOperationalAsset =
      /(?:irrigation|water|controller|device|equipment|bluetooth|schedule|field|pump|ري|مضخة|جهاز|متحكم)/iu.test(
        normalized,
      );
    const hasControlFailure =
      /(?:can(?:not|['’]?t)|unable to|won['’]?t|failed to|unresponsive|disconnect(?:s|ed|ing)?|crash(?:es|ed|ing)?).{0,80}(?:turn|switch|shut|control|connect|stop|start|off|on)|(?:turn|switch|shut|control|stop|start).{0,80}(?:can(?:not|['’]?t)|unable|failed|unresponsive|disconnect)/iu.test(
        normalized,
      );

    return hasOperationalAsset && hasControlFailure;
  }

  private normalizeLimit(limit?: number): number | undefined {
    if (limit === undefined) {
      return undefined;
    }

    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  }

  /** Detects cross-device access failures regardless of phrase order. */
  private hasCrossDeviceAccessFailure(value: string): boolean {
    const hasTargetDevice = /\b(?:computer|desktop|laptop|pc)\b/iu.test(value);
    const hasAccessAction =
      /\b(?:download(?:ed|ing)?|install(?:ed|ing)?|access(?:ed|ing)?|use|using|run|open)\b/iu.test(
        value,
      );
    const hasFailureSignal =
      /\b(?:(?:can(?:not|['’]?t)|can\s+not)|cannot|could(?:n['’]?t| not)|unable to|not available|does(?:n['’]?t| not) work|won['’]?t work|fails? to)\b/iu.test(
        value,
      );

    return (
      /\bmobile[- ]only\b/iu.test(value) ||
      (hasTargetDevice && hasAccessAction && hasFailureSignal)
    );
  }

  private normalizeText(value: string): string {
    return typeof value === 'string'
      ? value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
      : '';
  }
}
