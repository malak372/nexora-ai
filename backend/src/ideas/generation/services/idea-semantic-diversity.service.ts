import { Injectable } from '@nestjs/common';

import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';

/** Semantic-diversity assessment for one generated candidate. */
export type IdeaSemanticDiversityScore = {
  readonly candidateId: string;
  readonly diversityScore: number;
  readonly maxSimilarity: number;
  readonly mostSimilarCandidateId: string | null;
  readonly duplicateRisk: 'LOW' | 'MEDIUM' | 'HIGH';
};

type DiversityCandidate = {
  readonly candidateId: string;
  readonly parsedOutput: ParsedIdeaAiOutput;
  readonly opportunityTitle: string;
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'with',
  'using',
  'system',
  'platform',
  'application',
  'app',
  'solution',
  'software',
]);

/**
 * Measures conceptual overlap between generated candidates without depending
 * on model names or provider metadata.
 *
 * The service creates normalized semantic fingerprints from the title,
 * problem, objectives, target users, and ranked opportunity. It combines token
 * Jaccard similarity with bigram overlap so near-duplicate wording and closely
 * related concepts receive an explicit diversity penalty before winner
 * selection.
 *
 * This deterministic implementation is safe when an embedding provider is
 * unavailable. It can later be replaced by vector cosine similarity without
 * changing the public result contract.
 *
 * @author Malak
 */
@Injectable()
export class IdeaSemanticDiversityService {
  evaluate(
    candidates: readonly DiversityCandidate[],
  ): ReadonlyMap<string, IdeaSemanticDiversityScore> {
    const fingerprints = new Map(
      candidates.map((candidate) => [
        candidate.candidateId,
        this.buildFingerprint(candidate),
      ]),
    );
    const results = new Map<string, IdeaSemanticDiversityScore>();

    for (const candidate of candidates) {
      let maxSimilarity = 0;
      let mostSimilarCandidateId: string | null = null;
      const ownFingerprint = fingerprints.get(candidate.candidateId);

      if (!ownFingerprint) {
        continue;
      }

      for (const other of candidates) {
        if (other.candidateId === candidate.candidateId) {
          continue;
        }

        const otherFingerprint = fingerprints.get(other.candidateId);
        if (!otherFingerprint) {
          continue;
        }

        const similarity = this.calculateSimilarity(
          ownFingerprint,
          otherFingerprint,
        );

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          mostSimilarCandidateId = other.candidateId;
        }
      }

      const diversityScore = this.round((1 - maxSimilarity) * 100);
      results.set(candidate.candidateId, {
        candidateId: candidate.candidateId,
        diversityScore,
        maxSimilarity: this.round(maxSimilarity * 100),
        mostSimilarCandidateId,
        duplicateRisk:
          maxSimilarity >= 0.72
            ? 'HIGH'
            : maxSimilarity >= 0.52
              ? 'MEDIUM'
              : 'LOW',
      });
    }

    return results;
  }

  private buildFingerprint(candidate: DiversityCandidate): {
    tokens: ReadonlySet<string>;
    bigrams: ReadonlySet<string>;
  } {
    const core = candidate.parsedOutput.coreIdea;
    const text = [
      candidate.opportunityTitle,
      core.title,
      core.problemStatement,
      ...core.objectives,
      ...core.targetUsers,
      core.partialAbstract ?? '',
      core.fullAbstract ?? '',
      core.limitedAbstract ?? '',
    ].join(' ');
    const tokens = this.tokenize(text);
    const bigrams = new Set<string>();

    for (let index = 0; index < tokens.length - 1; index += 1) {
      bigrams.add(`${tokens[index]} ${tokens[index + 1]}`);
    }

    return { tokens: new Set(tokens), bigrams };
  }

  private tokenize(value: string): string[] {
    return value
      .toLocaleLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  }

  private calculateSimilarity(
    first: { tokens: ReadonlySet<string>; bigrams: ReadonlySet<string> },
    second: { tokens: ReadonlySet<string>; bigrams: ReadonlySet<string> },
  ): number {
    const tokenSimilarity = this.jaccard(first.tokens, second.tokens);
    const bigramSimilarity = this.jaccard(first.bigrams, second.bigrams);

    return Math.min(1, tokenSimilarity * 0.65 + bigramSimilarity * 0.35);
  }

  private jaccard(
    first: ReadonlySet<string>,
    second: ReadonlySet<string>,
  ): number {
    if (first.size === 0 && second.size === 0) {
      return 1;
    }

    let intersection = 0;
    for (const value of first) {
      if (second.has(value)) {
        intersection += 1;
      }
    }

    const union = first.size + second.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
