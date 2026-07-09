import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import {
    IntelligentAnalysisOutput,
} from '../pipeline/types/intelligent-analysis.types';
import { Sentiment } from '../common/enums/sentiment.enum';
import { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';
import { ProblemNormalizerService } from './problem-normalizer.service';
import { ProblemSeverityPolicyService } from './problem-severity-policy.service';

type RecurringProblem =
    IntelligentAnalysisOutput['recurringProblems'][number];

type ProblemAccumulator = {
    frequency: number;
    negativeSignals: number;
    urgencySignals: number;
    evidenceSamples: string[];
};

/**
 * Extracts recurring problem insights from lexicon-analyzed community texts.
 *
 * This service transforms low-level lexicon matches into structured recurring
 * problems that support evidence-based software project idea generation in
 * Nexora AI.
 *
 * Responsibilities:
 * - Detect problem-related signals from analyzed posts and comments.
 * - Group semantically similar problem terms using ProblemNormalizerService.
 * - Calculate frequency from supporting community texts.
 * - Estimate severity using ProblemSeverityPolicyService.
 * - Attach representative evidence samples for transparency.
 * - Return reusable recurring problem insights for prompt building.
 *
 * This service does not persist results and does not call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class ProblemInsightService {
    private readonly maxEvidenceSamples = 3;

    constructor(
        private readonly problemNormalizerService: ProblemNormalizerService,
        private readonly problemSeverityPolicyService: ProblemSeverityPolicyService,
    ) { }

    /**
     * Extracts recurring problems from lexicon-enriched text analysis results.
     *
     * If a limit is provided, only the highest ranked recurring problems are
     * returned. Without a limit, all detected recurring problems are returned,
     * which is useful for persistence and admin analytics.
     *
     * @param analyzedTexts Lexicon-enriched analyzed texts.
     * @param limit Optional maximum number of recurring problems to return.
     * @returns Recurring problem insights sorted by frequency and severity.
     */
    extract(
        analyzedTexts: LexiconTextAnalysisResult[],
        limit?: number,
    ): RecurringProblem[] {
        const problemMap = new Map<string, ProblemAccumulator>();

        for (const text of analyzedTexts) {
            if (!this.shouldAnalyzeText(text)) {
                continue;
            }

            const problemTerms = this.extractProblemTerms(text);

            for (const term of new Set(problemTerms)) {
                const title = this.problemNormalizerService.normalize(term);

                if (!title) {
                    continue;
                }

                const current = problemMap.get(title) ?? this.createAccumulator();

                current.frequency += 1;

                if (text.sentiment === Sentiment.NEGATIVE) {
                    current.negativeSignals += 1;
                }

                if (this.hasUrgencySignal(text)) {
                    current.urgencySignals += 1;
                }

                this.addEvidenceSample(current.evidenceSamples, text.originalText);

                problemMap.set(title, current);
            }
        }

        const results = [...problemMap.entries()]
            .map(([title, value]) => ({
                title,
                frequency: value.frequency,
                severity: this.problemSeverityPolicyService.calculate({
                    frequency: value.frequency,
                    negativeSignals: value.negativeSignals,
                    urgencySignals: value.urgencySignals,
                }),
                evidenceSamples: value.evidenceSamples,
            }))
            .sort((first, second) => {
                if (second.frequency !== first.frequency) {
                    return second.frequency - first.frequency;
                }

                return (
                    this.problemSeverityPolicyService.getWeight(second.severity) -
                    this.problemSeverityPolicyService.getWeight(first.severity)
                );
            });

        return typeof limit === 'number' ? results.slice(0, limit) : results;
    }

    /**
     * Determines whether a text should contribute to recurring problem extraction.
     *
     * Negative sentiment or explicit problem/complaint signals are required to
     * reduce false positives from neutral or positive mentions of cost, time,
     * accessibility, reliability, or safety.
     *
     * @param text Lexicon-enriched text result.
     * @returns True when the text contains problem-worthy signals.
     */
    private shouldAnalyzeText(text: LexiconTextAnalysisResult): boolean {
        return (
            text.sentiment === Sentiment.NEGATIVE ||
            (text.matchedLexicons[NlpLexiconType.PROBLEM] ?? []).length > 0 ||
            (text.matchedLexicons[NlpLexiconType.COMPLAINT] ?? []).length > 0
        );
    }

    /**
     * Extracts problem-related terms from one analyzed text.
     *
     * @param text Lexicon-enriched text result.
     * @returns Normalized problem-related terms.
     */
    private extractProblemTerms(text: LexiconTextAnalysisResult): string[] {
        return [
            ...(text.matchedLexicons[NlpLexiconType.PROBLEM] ?? []),
            ...(text.matchedLexicons[NlpLexiconType.COMPLAINT] ?? []),
            ...(text.matchedLexicons[NlpLexiconType.TIME] ?? []),
            ...(text.matchedLexicons[NlpLexiconType.COST] ?? []),
            ...(text.matchedLexicons[NlpLexiconType.ACCESSIBILITY] ?? []),
            ...(text.matchedLexicons[NlpLexiconType.SAFETY] ?? []),
            ...(text.matchedLexicons[NlpLexiconType.RELIABILITY] ?? []),
        ]
            .map((term) => term.toLowerCase().trim())
            .filter(Boolean);
    }

    /**
     * Checks whether an analyzed text contains urgency signals.
     *
     * @param text Lexicon-enriched text result.
     * @returns True when urgency terms were matched.
     */
    private hasUrgencySignal(text: LexiconTextAnalysisResult): boolean {
        return (text.matchedLexicons[NlpLexiconType.URGENCY] ?? []).length > 0;
    }

    /**
     * Creates an empty accumulator for one recurring problem group.
     *
     * @returns Empty problem accumulator.
     */
    private createAccumulator(): ProblemAccumulator {
        return {
            frequency: 0,
            negativeSignals: 0,
            urgencySignals: 0,
            evidenceSamples: [],
        };
    }

    /**
     * Adds a representative evidence sample without exceeding the configured
     * sample limit.
     *
     * @param samples Existing evidence samples.
     * @param sample New sample candidate.
     */
    private addEvidenceSample(samples: string[], sample: string): void {
        const normalizedSample = sample.trim();

        if (!normalizedSample) {
            return;
        }

        if (samples.length >= this.maxEvidenceSamples) {
            return;
        }

        if (samples.includes(normalizedSample)) {
            return;
        }

        samples.push(normalizedSample);
    }
}