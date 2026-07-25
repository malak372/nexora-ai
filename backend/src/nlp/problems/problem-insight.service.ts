import { Injectable } from '@nestjs/common';
import { LanguageCode, NlpLexiconType } from '@prisma/client';

import { Sentiment } from '../common/enums/sentiment.enum';
import {
  buildCommunityEvidenceExcerpt,
  hasDirectCommunityComplaint,
  isLikelyProductDescription,
} from '../common/utils/community-evidence.util';
import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type { IntelligentAnalysisOutput } from '../pipeline/types/intelligent-analysis.types';

import { ProblemNormalizerService } from './problem-normalizer.service';
import { ProblemSeverityPolicyService } from './problem-severity-policy.service';

const MAX_PROBLEM_EVIDENCE_SAMPLES = 3;
const MAX_EVIDENCE_SAMPLE_LENGTH = 650;

type RecurringProblem = IntelligentAnalysisOutput['recurringProblems'][number];

type ProblemAccumulator = {
  frequency: number;
  negativeSignals: number;
  urgencySignals: number;
  evidenceSamples: string[];
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

      const problemTerms = [
        ...this.extractSpecificLexiconTerms(text),
        ...this.inferConcreteProblemTerms(text.originalText, text.language),
      ];

      const normalizedProblems = new Set(
        problemTerms
          .map((term) =>
            this.problemNormalizerService.normalize(term, text.language),
          )
          .filter(Boolean),
      );

      for (const title of normalizedProblems) {
        const current = problemMap.get(title) ?? this.createAccumulator();

        current.frequency += 1;

        if (text.sentiment === Sentiment.NEGATIVE) {
          current.negativeSignals += 1;
        }

        if (this.hasUrgencySignal(text)) {
          current.urgencySignals += 1;
        }

        this.addEvidenceSample(
          current.evidenceSamples,
          this.buildEvidenceExcerpt(text.originalText, title),
        );

        problemMap.set(title, current);
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
        }),
        evidenceSamples: accumulator.evidenceSamples,
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
    if (isLikelyProductDescription(text.originalText, text.sourceType)) {
      return false;
    }

    const hasDirectComplaint = hasDirectCommunityComplaint(text.originalText);
    const hasComplaintLexicon =
      this.hasLexiconMatches(text, NlpLexiconType.COMPLAINT) ||
      this.hasLexiconMatches(text, NlpLexiconType.PROBLEM);

    if (text.sourceType === 'COMMENT') {
      return (
        hasDirectComplaint ||
        (text.sentiment === Sentiment.NEGATIVE && hasComplaintLexicon)
      );
    }

    return hasDirectComplaint;
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
      .flatMap((type) => text.matchedLexicons[type] ?? [])
      .map((term) => term.trim())
      .filter(Boolean);
  }

  /** Derives concrete software-problem categories from direct complaint text. */
  private inferConcreteProblemTerms(
    value: string,
    language: LanguageCode,
  ): string[] {
    const text = this.normalizeText(value);
    const terms: string[] = [];

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

    if (
      /(?:download|document|syllabus|file|link).{0,80}(?:error|fail|broken|null|(?:can(?:not|['’]?t)|can\s+not)|won['’]?t|does(?:n['’]?t| not) open)|(?:error|null).{0,60}(?:download|document|file|syllabus)/iu.test(
        text,
      )
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

    const hasOperationalReliabilityFailure =
      /(?:crash|crashes|crashed|crashing|freeze|freezes|frozen|bug|glitch)/iu.test(
        text,
      );
    const hasGenericError =
      /(?:broken|error|looping)/iu.test(text) &&
      !/(?:download|document|syllabus|file|link|login|log in|sign in|activation|verification|email|code|otp)/iu.test(
        text,
      );

    if (hasOperationalReliabilityFailure || hasGenericError) {
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
      evidenceSamples: [],
    };
  }

  private addEvidenceSample(samples: string[], sample: string): void {
    const normalizedSample = sample.trim();

    if (
      !normalizedSample ||
      samples.length >= MAX_PROBLEM_EVIDENCE_SAMPLES ||
      samples.includes(normalizedSample)
    ) {
      return;
    }

    samples.push(normalizedSample);
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
