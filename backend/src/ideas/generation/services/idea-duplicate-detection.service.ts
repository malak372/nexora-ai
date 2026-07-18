import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import type {
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import {
  DUPLICATE_DETECTION_CANDIDATE_LIMIT,
  IDEA_GENERATION_ERROR_CODES,
  IDEA_TITLE_SIMILARITY_THRESHOLD,
  MAX_DUPLICATE_TITLE_LENGTH,
} from '../constants/idea-generation.constants';

/**
 * Database client accepted by duplicate-detection operations.
 *
 * The service may run:
 * - Directly through PrismaService.
 * - Inside an existing interactive Prisma transaction.
 *
 * Supporting both clients allows the final duplicate check to
 * execute atomically with idea persistence.
 *
 * @author Malak
 */
export type IdeaDuplicateDetectionDatabaseClient =
  Prisma.TransactionClient;

/**
 * Lightweight idea record loaded for duplicate comparison.
 *
 * Only fields required by duplicate detection are selected to
 * avoid loading complete idea records and their relations.
 *
 * @author Malak
 */
export type DuplicateIdeaCandidate = {
  /**
   * Existing idea identifier.
   */
  readonly id: string;

  /**
   * Existing generated idea title.
   */
  readonly title: string;

  /**
   * Creation timestamp used for diagnostic responses.
   */
  readonly createdAt: Date;
};

/**
 * Result returned when checking a generated title for duplicates.
 *
 * @author Malak
 */
export type IdeaDuplicateCheckResult = {
  /**
   * Indicates whether a sufficiently similar idea was found.
   */
  readonly isDuplicate: boolean;

  /**
   * Highest similarity score found among inspected candidates.
   *
   * The value is between zero and one.
   */
  readonly highestSimilarity: number;

  /**
   * Existing idea that produced the highest similarity score.
   *
   * It remains null when no candidates exist.
   */
  readonly matchedIdea: DuplicateIdeaCandidate | null;
};

/**
 * Prevents users from storing highly similar generated ideas.
 *
 * Duplicate detection is scoped by:
 * - Idea owner.
 * - Software domain.
 *
 * Registered-user generation compares against ideas owned by the
 * same user.
 *
 * Guest generation compares against guest-owned ideas where
 * userId is null. Guest-session entitlement still prevents one
 * guest session from generating repeatedly.
 *
 * Detection uses two levels:
 * 1. Exact comparison after title normalization.
 * 2. Token-based Dice similarity for near-duplicate titles.
 *
 * The normalization process:
 * - Converts text to lowercase.
 * - Removes punctuation and special characters.
 * - Normalizes whitespace.
 * - Removes repeated words.
 * - Limits the compared title length.
 *
 * This service does not:
 * - Modify ideas.
 * - Deduct credits.
 * - Consume guest or free entitlement.
 * - Regenerate an AI response.
 * - Compare advanced generated outputs.
 *
 * The final assertion should execute inside the same transaction
 * that creates the idea to reduce race-condition risk.
 *
 * @author Malak
 */
@Injectable()
export class IdeaDuplicateDetectionService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Checks whether a title is a duplicate without throwing.
   *
   * This method is useful for the dedicated duplicate-detection
   * pipeline stage, where the caller may want to inspect the
   * similarity score before deciding how to proceed.
   *
   * @param userId Registered owner identifier. Undefined scopes
   * the check to guest-owned ideas.
   * @param domainId Selected software-domain identifier.
   * @param title Newly generated idea title.
   * @param database Optional active Prisma transaction.
   * @returns Duplicate status and the closest existing candidate.
   */
  async check(
    userId: string | undefined,
    domainId: string,
    title: string,
    database?: IdeaDuplicateDetectionDatabaseClient,
  ): Promise<IdeaDuplicateCheckResult> {
    const normalizedDomainId =
      domainId.trim();

    const normalizedTitle =
      this.normalizeTitle(title);

    if (!normalizedDomainId) {
      throw new ConflictException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .DUPLICATE_IDEA,

        message:
          'A domain is required to perform duplicate detection.',
      });
    }

    if (!normalizedTitle) {
      throw new ConflictException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .DUPLICATE_IDEA,

        message:
          'A valid idea title is required to perform duplicate detection.',
      });
    }

    const client =
      database ?? this.prisma;

    const candidates =
      await client.idea.findMany({
        where: {
          domainId:
            normalizedDomainId,

          userId:
            userId ?? null,
        },

        select: {
          id: true,
          title: true,
          createdAt: true,
        },

        orderBy: {
          createdAt: 'desc',
        },

        take:
          DUPLICATE_DETECTION_CANDIDATE_LIMIT,
      });

    if (candidates.length === 0) {
      return {
        isDuplicate: false,
        highestSimilarity: 0,
        matchedIdea: null,
      };
    }

    let matchedIdea:
      DuplicateIdeaCandidate | null = null;

    let highestSimilarity = 0;

    for (const candidate of candidates) {
      const normalizedCandidateTitle =
        this.normalizeTitle(
          candidate.title,
        );

      if (!normalizedCandidateTitle) {
        continue;
      }

      const similarity =
        this.calculateTitleSimilarity(
          normalizedTitle,
          normalizedCandidateTitle,
        );

      if (
        similarity >
        highestSimilarity
      ) {
        highestSimilarity =
          similarity;

        matchedIdea =
          candidate;
      }

      /*
       * Exact normalized equality is the strongest possible
       * duplicate signal, so no additional candidates need to be
       * inspected.
       */
      if (similarity === 1) {
        break;
      }
    }

    return {
      isDuplicate:
        highestSimilarity >=
        IDEA_TITLE_SIMILARITY_THRESHOLD,

      highestSimilarity:
        this.roundSimilarity(
          highestSimilarity,
        ),

      matchedIdea,
    };
  }

  /**
   * Ensures that a generated title is not a duplicate.
   *
   * The method throws ConflictException when an existing idea
   * owned by the same owner and assigned to the same domain has a
   * similarity score equal to or greater than the configured
   * threshold.
   *
   * This method is intended for idea persistence transactions.
   *
   * @param userId Registered owner identifier. Undefined scopes
   * the check to guest-owned ideas.
   * @param domainId Selected software-domain identifier.
   * @param title Newly generated idea title.
   * @param database Optional active Prisma transaction.
   *
   * @throws ConflictException When a duplicate or highly similar
   * idea already exists.
   */
  async assertNotDuplicate(
    userId: string | undefined,
    domainId: string,
    title: string,
    database?: IdeaDuplicateDetectionDatabaseClient,
  ): Promise<void> {
    const result =
      await this.check(
        userId,
        domainId,
        title,
        database,
      );

    if (!result.isDuplicate) {
      return;
    }

    throw new ConflictException({
      code:
        IDEA_GENERATION_ERROR_CODES
          .DUPLICATE_IDEA,

      message:
        'A highly similar idea already exists for this domain.',

      details: {
        matchedIdeaId:
          result.matchedIdea?.id ?? null,

        matchedTitle:
          result.matchedIdea?.title ?? null,

        similarity:
          result.highestSimilarity,

        threshold:
          IDEA_TITLE_SIMILARITY_THRESHOLD,
      },
    });
  }

  /**
   * Calculates title similarity using normalized token sets.
   *
   * Exact normalized equality returns one immediately.
   *
   * Non-identical titles are compared using the Sørensen-Dice
   * coefficient:
   *
   * similarity =
   * (2 × shared token count) /
   * (first token count + second token count)
   *
   * The coefficient is:
   * - Zero when no words are shared.
   * - One when both normalized token sets are identical.
   *
   * @param firstNormalizedTitle First normalized title.
   * @param secondNormalizedTitle Second normalized title.
   * @returns Similarity value between zero and one.
   */
  private calculateTitleSimilarity(
    firstNormalizedTitle: string,
    secondNormalizedTitle: string,
  ): number {
    if (
      firstNormalizedTitle ===
      secondNormalizedTitle
    ) {
      return 1;
    }

    const firstTokens =
      this.toTokenSet(
        firstNormalizedTitle,
      );

    const secondTokens =
      this.toTokenSet(
        secondNormalizedTitle,
      );

    if (
      firstTokens.size === 0 ||
      secondTokens.size === 0
    ) {
      return 0;
    }

    let sharedTokenCount = 0;

    for (const token of firstTokens) {
      if (
        secondTokens.has(token)
      ) {
        sharedTokenCount += 1;
      }
    }

    return (
      (2 * sharedTokenCount) /
      (
        firstTokens.size +
        secondTokens.size
      )
    );
  }

  /**
   * Normalizes a generated idea title before comparison.
   *
   * The function:
   * - Trims surrounding whitespace.
   * - Converts characters to lowercase.
   * - Uses Unicode normalization.
   * - Removes Arabic diacritics.
   * - Removes punctuation and symbols.
   * - Preserves letters and numbers from all languages.
   * - Collapses repeated whitespace.
   * - Restricts the normalized title length.
   *
   * @param title Raw generated title.
   * @returns Stable normalized title.
   */
  private normalizeTitle(
    title: string,
  ): string {
    if (
      typeof title !== 'string'
    ) {
      return '';
    }

    return title
      .normalize('NFKC')
      .toLowerCase()
      .replace(
        /[\u064B-\u065F\u0670\u06D6-\u06ED]/gu,
        '',
      )
      .replace(
        /[^\p{L}\p{N}\s]/gu,
        ' ',
      )
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(
        0,
        MAX_DUPLICATE_TITLE_LENGTH,
      );
  }

  /**
   * Converts one normalized title into a unique token set.
   *
   * Duplicate words are ignored because repeated occurrences in a
   * short title should not artificially increase similarity.
   *
   * @param normalizedTitle Normalized title.
   * @returns Unique title words.
   */
  private toTokenSet(
    normalizedTitle: string,
  ): Set<string> {
    return new Set(
      normalizedTitle
        .split(' ')
        .map(
          (token) =>
            token.trim(),
        )
        .filter(Boolean),
    );
  }

  /**
   * Rounds a similarity value for stable API output and logging.
   *
   * Internal threshold comparison occurs before rounding so the
   * configured threshold remains accurate.
   *
   * @param value Raw similarity value.
   * @returns Similarity rounded to four decimal places.
   */
  private roundSimilarity(
    value: number,
  ): number {
    return Math.round(
      value * 10_000,
    ) / 10_000;
  }
}