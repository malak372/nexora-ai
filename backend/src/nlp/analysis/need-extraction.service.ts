import { Injectable } from '@nestjs/common';
import { NlpLexiconType } from '@prisma/client';

import {
    IntelligentAnalysisOutput,
    PriorityLevel,
} from '../pipeline/types/intelligent-analysis.types';
import { LexiconTextAnalysisResult } from '../lexicon/lexicon-analysis.service';

type ExtractedNeed = IntelligentAnalysisOutput['extractedNeeds'][number];

type NeedAccumulator = {
    priority: PriorityLevel;
    relatedProblem?: string;
    evidenceSamples: string[];
    frequency: number;
};

/**
 * Extracts user needs and unmet requirements from analyzed community texts.
 *
 * This service transforms explicit need signals and feature-request signals
 * into structured needs that help Nexora AI understand what users expect from
 * a potential software solution.
 *
 * Responsibilities:
 * - Detect explicit need-related lexicon matches.
 * - Detect feature-request signals from analyzed texts.
 * - Group repeated needs into stable need statements.
 * - Attach representative evidence samples for transparency.
 * - Produce structured needs for opportunity analysis and prompt building.
 *
 * This service does not persist results and does not call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class NeedExtractionService {
    private readonly maxEvidenceSamples = 3;

    /**
     * Extracts user needs from lexicon-enriched text analysis results.
     *
     * If a limit is provided, only the highest ranked needs are returned.
     * Without a limit, all extracted needs are returned for persistence and
     * admin analytics.
     *
     * @param analyzedTexts Lexicon-enriched analyzed texts.
     * @param limit Optional maximum number of needs to return.
     * @returns Extracted user needs sorted by frequency and priority.
     */
    extract(
        analyzedTexts: LexiconTextAnalysisResult[],
        limit?: number,
    ): ExtractedNeed[] {
        const needMap = new Map<string, NeedAccumulator>();

        for (const text of analyzedTexts) {
            const needTerms = this.extractNeedTerms(text);

            for (const term of new Set(needTerms)) {
                const need = this.normalizeNeed(term);

                if (!need) {
                    continue;
                }

                const current = needMap.get(need) ?? this.createAccumulator();

                current.frequency += 1;
                current.priority = this.calculatePriority(current.frequency, text);
                this.addEvidenceSample(current.evidenceSamples, text.originalText);

                needMap.set(need, current);
            }
        }

        const results = [...needMap.entries()]
            .map(([need, value]) => ({
                need,
                priority: value.priority,
                relatedProblem: value.relatedProblem,
                evidenceSamples: value.evidenceSamples,
            }))
            .sort((first, second) => {
                const priorityDifference =
                    this.priorityWeight(second.priority) - this.priorityWeight(first.priority);

                if (priorityDifference !== 0) {
                    return priorityDifference;
                }

                return first.need.localeCompare(second.need);
            });

        return typeof limit === 'number' ? results.slice(0, limit) : results;
    }

    /**
     * Extracts need-related terms from one analyzed text.
     *
     * @param text Lexicon-enriched text result.
     * @returns Normalized need-related terms.
     */
    private extractNeedTerms(text: LexiconTextAnalysisResult): string[] {
        return [
            ...(text.matchedLexicons[NlpLexiconType.NEED] ?? []),
            ...(text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? []),
        ]
            .map((term) => term.toLowerCase().trim())
            .filter(Boolean);
    }

    /**
     * Converts a raw need term into a readable need statement.
     *
     * @param term Need-related term.
     * @returns Human-readable need statement.
     */
    private normalizeNeed(term: string): string {
        const normalizedTerm = term.toLowerCase().trim().replace(/\s+/g, ' ');

        if (!normalizedTerm) {
            return '';
        }

        return normalizedTerm
            .split(' ')
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Calculates need priority from frequency and feature-request strength.
     *
     * @param frequency Number of supporting texts.
     * @param text Current analyzed text.
     * @returns Need priority level.
     */
    private calculatePriority(
        frequency: number,
        text: LexiconTextAnalysisResult,
    ): PriorityLevel {
        const hasFeatureRequest =
            (text.matchedLexicons[NlpLexiconType.FEATURE_REQUEST] ?? []).length > 0;

        if (frequency >= 5 || hasFeatureRequest) {
            return 'HIGH';
        }

        if (frequency >= 3) {
            return 'MEDIUM';
        }

        return 'LOW';
    }

    /**
     * Creates an empty accumulator for one extracted need.
     *
     * @returns Empty need accumulator.
     */
    private createAccumulator(): NeedAccumulator {
        return {
            frequency: 0,
            priority: 'LOW',
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

    /**
     * Converts priority into a sortable numeric weight.
     *
     * @param priority Priority level.
     * @returns Numeric priority weight.
     */
    private priorityWeight(priority: PriorityLevel): number {
        const weights: Record<PriorityLevel, number> = {
            LOW: 1,
            MEDIUM: 2,
            HIGH: 3,
        };

        return weights[priority];
    }
}