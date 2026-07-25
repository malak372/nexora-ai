import { BadRequestException, Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import {
  buildCommunityEvidenceExcerpt,
  hasDirectCommunityComplaint,
  isLikelyProductDescription,
} from '../common/utils/community-evidence.util';
import { toTitleCase } from '../common/utils/text-formatting.util';

import type { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import type {
  IntelligentAnalysisOutput,
  PriorityLevel,
} from '../pipeline/types/intelligent-analysis.types';

const MAX_NEED_EVIDENCE_SAMPLES = 3;
const MAX_EVIDENCE_SAMPLE_LENGTH = 650;
const MEDIUM_PRIORITY_FREQUENCY_THRESHOLD = 3;
const HIGH_PRIORITY_FREQUENCY_THRESHOLD = 5;

const PRIORITY_WEIGHTS: Readonly<Record<PriorityLevel, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const GENERIC_NEED_TERMS = new Set([
  'need',
  'needs',
  'needed',
  'require',
  'required',
  'want',
  'wanted',
  'حاجة',
  'احتاج',
  'نحتاج',
  'مطلوب',
]);

type ExtractedNeed = IntelligentAnalysisOutput['extractedNeeds'][number];

type NeedAccumulator = {
  readonly need: string;
  frequency: number;
  hasFeatureRequestSignal: boolean;
  readonly evidenceSamples: string[];
  relatedProblem?: string;
};

/**
 * Extracts concrete user needs from community evidence.
 *
 * Generic lexicon triggers such as "Need" are used only as indicators. They
 * are never emitted as final need labels. Concrete needs are derived from
 * feature-request phrases and direct workflow complaints, while promotional
 * product descriptions are excluded unless they contain direct user failures.
 *
 * @author Eman
 */
@Injectable()
export class NeedExtractionService {
  /** Extracts user needs sorted by priority and supporting frequency. */
  extract(
    analyzedTexts: readonly LexiconTextAnalysisResult[],
    limit?: number,
  ): ExtractedNeed[] {
    this.validateLimit(limit);

    const needMap = new Map<string, NeedAccumulator>();

    for (const text of analyzedTexts) {
      if (this.shouldSkipText(text)) {
        continue;
      }

      const uniqueNeedsForText = this.extractUniqueNeedTerms(text);
      const featureRequestKeys = this.extractFeatureRequestKeys(text);

      for (const [needKey, normalizedNeed] of uniqueNeedsForText) {
        const current =
          needMap.get(needKey) ?? this.createAccumulator(normalizedNeed);

        current.frequency += 1;
        current.hasFeatureRequestSignal =
          current.hasFeatureRequestSignal || featureRequestKeys.has(needKey);

        this.addEvidenceSample(
          current.evidenceSamples,
          this.buildEvidenceExcerpt(text.originalText, normalizedNeed),
        );

        needMap.set(needKey, current);
      }
    }

    const sortedNeeds = [...needMap.values()].sort((first, second) => {
      const firstPriority = this.calculatePriority(first);
      const secondPriority = this.calculatePriority(second);

      return (
        this.priorityWeight(secondPriority) -
          this.priorityWeight(firstPriority) ||
        second.frequency - first.frequency ||
        first.need.localeCompare(second.need)
      );
    });

    const selectedNeeds =
      limit === undefined ? sortedNeeds : sortedNeeds.slice(0, limit);

    return selectedNeeds.map((accumulator) => ({
      need: accumulator.need,
      priority: this.calculatePriority(accumulator),
      relatedProblem: accumulator.relatedProblem,
      evidenceSamples: [...accumulator.evidenceSamples],
    }));
  }

  /** Extracts normalized concrete needs from one text. */
  private extractUniqueNeedTerms(
    text: LexiconTextAnalysisResult,
  ): ReadonlyMap<string, string> {
    const uniqueNeeds = new Map<string, string>();
    const matchedTerms = [
      ...(text.matchedLexicons[NlpLexiconType.NEED] ?? []),
      ...(text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? []),
      ...this.inferConcreteNeeds(text.originalText),
    ];

    for (const term of matchedTerms) {
      const normalizedTerm = this.normalizeTerm(term);

      if (!normalizedTerm || GENERIC_NEED_TERMS.has(normalizedTerm)) {
        continue;
      }

      const needKey = this.createAggregationKey(normalizedTerm);

      if (!uniqueNeeds.has(needKey)) {
        uniqueNeeds.set(needKey, toTitleCase(normalizedTerm));
      }
    }

    return uniqueNeeds;
  }

  /** Derives actionable requirements from direct complaint language. */
  private inferConcreteNeeds(value: string): string[] {
    const text = value.normalize('NFKC').toLocaleLowerCase();
    const needs: string[] = [];

    if (this.hasCrossDeviceAccessFailure(text)) {
      needs.push('desktop and laptop access');
    }

    if (
      /(?:activation|verification|account).{0,80}(?:email|code|otp).{0,80}(?:never|not|fail)|(?:never|not).{0,40}(?:receive|get).{0,80}(?:email|code)/iu.test(
        text,
      )
    ) {
      needs.push('reliable account verification');
    }

    if (
      /(?:data|history|classes|progress).{0,80}(?:gone|lost|missing|deleted|sync)|(?:sync|synchronization).{0,40}(?:fail|broken|not work)/iu.test(
        text,
      )
    ) {
      needs.push('reliable data synchronization and recovery');
    }

    if (
      /(?:hard|difficult|confusing).{0,40}(?:navigate|interface|use)/iu.test(
        text,
      )
    ) {
      needs.push('clear and stable navigation');
    }

    if (
      /(?:download|document|syllabus|file|link).{0,80}(?:error|fail|broken|null|(?:can(?:not|['’]?t)|can\s+not)|won['’]?t|does(?:n['’]?t| not) open)|(?:error|null).{0,60}(?:download|document|file|syllabus)/iu.test(
        text,
      )
    ) {
      needs.push('reliable document access and downloads');
    }

    const hasOperationalReliabilityFailure =
      /(?:crash|freeze|bug|glitch)/iu.test(text);
    const hasGenericOperationalError =
      /(?:broken|error)/iu.test(text) &&
      !/(?:download|document|syllabus|file|link|login|log in|sign in|activation|verification|email|code|otp)/iu.test(
        text,
      );

    if (hasOperationalReliabilityFailure || hasGenericOperationalError) {
      needs.push('stable crash-resistant operation');
    }

    if (/(?:offline|no internet|without internet)/iu.test(text)) {
      needs.push('offline learning access');
    }

    if (
      /(?:لا يمكن|ما بقدر).{0,60}(?:كمبيوتر|لابتوب)|(?:الهاتف فقط)/iu.test(text)
    ) {
      needs.push('الوصول من الكمبيوتر واللابتوب');
    }

    if (
      /(?:رسالة|رمز).{0,40}(?:تفعيل|تحقق).{0,40}(?:لم يصل|ما وصل)/iu.test(text)
    ) {
      needs.push('تفعيل حساب موثوق');
    }

    if (/(?:بيانات|تقدم|سجل).{0,40}(?:اختفت|ضاعت|فقدت)/iu.test(text)) {
      needs.push('مزامنة واسترجاع البيانات');
    }

    return needs;
  }

  /** Detects device-access complaints even when written in passive form. */
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

  private extractFeatureRequestKeys(
    text: LexiconTextAnalysisResult,
  ): ReadonlySet<string> {
    const terms = text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? [];

    return new Set(
      terms
        .map((term) => this.normalizeTerm(term))
        .filter((term) => Boolean(term) && !GENERIC_NEED_TERMS.has(term))
        .map((term) => this.createAggregationKey(term)),
    );
  }

  private shouldSkipText(text: LexiconTextAnalysisResult): boolean {
    if (isLikelyProductDescription(text.originalText, text.sourceType)) {
      return true;
    }

    if (text.sourceType === 'COMMENT') {
      return false;
    }

    const hasFeatureRequest =
      (text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? []).length > 0;

    return (
      !hasFeatureRequest && !hasDirectCommunityComplaint(text.originalText)
    );
  }

  private normalizeTerm(term: string): string {
    return typeof term === 'string'
      ? term
          .toLocaleLowerCase()
          .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
          .replace(/\s+/gu, ' ')
          .trim()
      : '';
  }

  private createAggregationKey(normalizedTerm: string): string {
    return normalizedTerm.toLocaleLowerCase();
  }

  private calculatePriority(accumulator: NeedAccumulator): PriorityLevel {
    if (
      accumulator.hasFeatureRequestSignal ||
      accumulator.frequency >= HIGH_PRIORITY_FREQUENCY_THRESHOLD
    ) {
      return 'HIGH';
    }

    if (accumulator.frequency >= MEDIUM_PRIORITY_FREQUENCY_THRESHOLD) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private createAccumulator(need: string): NeedAccumulator {
    return {
      need,
      frequency: 0,
      hasFeatureRequestSignal: false,
      evidenceSamples: [],
      relatedProblem: this.inferRelatedProblem(need),
    };
  }

  /** Builds evidence that is relevant to the concrete need being stored. */
  private buildEvidenceExcerpt(value: string, need: string): string {
    return buildCommunityEvidenceExcerpt(
      value,
      MAX_EVIDENCE_SAMPLE_LENGTH,
      this.getNeedEvidencePatterns(need),
    );
  }

  private getNeedEvidencePatterns(need: string): readonly RegExp[] {
    const normalizedNeed = this.normalizeTerm(need);

    if (
      /desktop|laptop|computer|cross-platform|cross device/iu.test(
        normalizedNeed,
      )
    ) {
      return [/\b(?:desktop|laptop|computer|pc|mobile only)\b/iu];
    }

    if (/verification|activation|account/iu.test(normalizedNeed)) {
      return [/\b(?:verification|activation|email|code|otp|login|sign in)\b/iu];
    }

    if (/synchronization|recovery|data/iu.test(normalizedNeed)) {
      return [/\b(?:data|history|classes|progress|sync|lost|missing|gone)\b/iu];
    }

    if (/navigation|interface/iu.test(normalizedNeed)) {
      return [
        /\b(?:navigate|navigation|interface|back button|scroll|popup|tabs?)\b/iu,
      ];
    }

    if (/document|download|syllabus|file/iu.test(normalizedNeed)) {
      return [
        /\b(?:document|download|syllabus|file|link|null error|cannot open)\b/iu,
      ];
    }

    if (/crash|stable|reliable/iu.test(normalizedNeed)) {
      return [
        /\b(?:crash|freeze|error|bug|glitch|looping|doesn['’]?t work)\b/iu,
      ];
    }

    if (/offline|internet/iu.test(normalizedNeed)) {
      return [
        /\b(?:offline|without internet|no internet|download for offline)\b/iu,
      ];
    }

    return [];
  }

  private inferRelatedProblem(need: string): string | undefined {
    const normalizedNeed = this.normalizeTerm(need);

    if (
      /desktop|laptop|computer|cross-platform|cross device/iu.test(
        normalizedNeed,
      )
    ) {
      return 'Cross-Device Access Barriers';
    }

    if (/verification|activation|account/iu.test(normalizedNeed)) {
      return 'Account Activation and Login Failures';
    }

    if (/synchronization|recovery|data/iu.test(normalizedNeed)) {
      return 'Data Loss and Synchronization Failures';
    }

    if (/navigation|interface/iu.test(normalizedNeed)) {
      return 'Navigation and Interface Failures';
    }

    if (/document|download|syllabus|file/iu.test(normalizedNeed)) {
      return 'Document Access and Download Failures';
    }

    if (/crash|stable|reliable/iu.test(normalizedNeed)) {
      return 'Application Reliability and Crash Failures';
    }

    return undefined;
  }

  private addEvidenceSample(samples: string[], sample: string): void {
    const normalizedSample = sample.trim();

    if (!normalizedSample || samples.length >= MAX_NEED_EVIDENCE_SAMPLES) {
      return;
    }

    if (
      !samples.some(
        (existingSample) =>
          existingSample.toLocaleLowerCase() ===
          normalizedSample.toLocaleLowerCase(),
      )
    ) {
      samples.push(normalizedSample);
    }
  }

  private priorityWeight(priority: PriorityLevel): number {
    return PRIORITY_WEIGHTS[priority];
  }

  private validateLimit(limit?: number): void {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new BadRequestException(
        'Need extraction limit must be a positive integer.',
      );
    }
  }
}
