import { Injectable } from '@nestjs/common';

import {
    SentimentLabel,
    TextAnalysisResult,
} from './types/intelligent-analysis.types';

/**
 * Selects representative evidence samples from analyzed NLP texts.
 *
 * This service keeps evidence extraction separated from the main pipeline
 * orchestration. Evidence samples are used to make NLP results transparent
 * and to provide real community examples for premium outputs and prompts.
 *
 * Responsibilities:
 * - Select representative analyzed posts.
 * - Select representative analyzed comments.
 * - Rank samples by confidence.
 * - Return lightweight evidence objects suitable for output and persistence.
 *
 * This service does not persist results and does not call external AI services.
 *
 * @author Eman
 */
@Injectable()
export class AnalysisEvidenceService {
    private readonly maxSamples = 5;

    /**
     * Extracts representative analyzed posts.
     *
     * @param analyzedTexts Final analyzed text records.
     * @returns High-confidence post samples.
     */
    extractSamplePosts(analyzedTexts: TextAnalysisResult[]): {
        id: string;
        text: string;
        sentiment: SentimentLabel;
    }[] {
        return analyzedTexts
            .filter((text) => text.sourceType === 'POST')
            .sort((first, second) => second.confidence - first.confidence)
            .slice(0, this.maxSamples)
            .map((text) => ({
                id: text.id,
                text: text.originalText,
                sentiment: text.sentiment,
            }));
    }

    /**
     * Extracts representative analyzed comments.
     *
     * @param analyzedTexts Final analyzed text records.
     * @returns High-confidence comment samples.
     */
    extractSampleComments(analyzedTexts: TextAnalysisResult[]): {
        id: string;
        postId: string;
        text: string;
        sentiment: SentimentLabel;
    }[] {
        return analyzedTexts
            .filter((text) => text.sourceType === 'COMMENT' && text.postId)
            .sort((first, second) => second.confidence - first.confidence)
            .slice(0, this.maxSamples)
            .map((text) => ({
                id: text.id,
                postId: text.postId as string,
                text: text.originalText,
                sentiment: text.sentiment,
            }));
    }
}