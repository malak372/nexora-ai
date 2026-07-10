import { Injectable } from '@nestjs/common';
import { LanguageCode, NlpLexiconType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Provides centralized read access to NLP lexicon entries stored in the database.
 *
 * The lexicon is used by the Nexora AI NLP pipeline to identify semantic
 * signals in collected community posts and comments, including recurring
 * problems, user needs, complaints, urgency, cost concerns, time concerns,
 * accessibility issues, safety concerns, reliability issues, opportunities,
 * feature requests, and sentiment indicators.
 *
 * By encapsulating all lexicon queries in one service, higher-level analysis
 * components remain independent from Prisma and focus only on NLP logic.
 *
 * @author Eman
 */
@Injectable()
export class NlpLexiconService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns active lexicon words for a specific lexicon type and language.
   *
   * The lookup includes both language-specific terms and generic terms marked
   * as LanguageCode.ANY, allowing the NLP engine to support multilingual and
   * mixed-language community content.
   *
   * @param type Lexicon category to retrieve.
   * @param language Target language of the analyzed text.
   * @returns Unique normalized lexicon words.
   */
  async getWords(
    type: NlpLexiconType,
    language: LanguageCode,
  ): Promise<string[]> {
    const lexicons = await this.prisma.nlpLexicon.findMany({
      where: {
        type,
        isActive: true,
        language: {
          in: [language, LanguageCode.ANY],
        },
      },
      select: {
        word: true,
      },
      orderBy: {
        word: 'asc',
      },
    });

    return this.normalizeWords(lexicons.map((lexicon) => lexicon.word));
  }

  /**
   * Returns active lexicon words grouped by lexicon type for a specific language.
   *
   * This method is optimized for full-text analysis because it retrieves all
   * lexicon categories in one database query instead of querying each category
   * separately.
   *
   * @param language Target language of the analyzed text.
   * @returns Normalized lexicon words grouped by NlpLexiconType.
   */
  async getGroupedWords(
    language: LanguageCode,
  ): Promise<Record<NlpLexiconType, string[]>> {
    const groupedWords = this.buildEmptyGroupedWords();

    const lexicons = await this.prisma.nlpLexicon.findMany({
      where: {
        isActive: true,
        language: {
          in: [language, LanguageCode.ANY],
        },
      },
      select: {
        word: true,
        type: true,
      },
      orderBy: [
        {
          type: 'asc',
        },
        {
          word: 'asc',
        },
      ],
    });

    for (const lexicon of lexicons) {
      groupedWords[lexicon.type].push(lexicon.word);
    }

    for (const type of Object.values(NlpLexiconType)) {
      groupedWords[type] = this.normalizeWords(groupedWords[type]);
    }

    return groupedWords;
  }

  /**
   * Normalizes lexicon words and removes duplicates.
   *
   * @param words Raw lexicon words retrieved from the database.
   * @returns Unique lowercase lexicon words.
   */
  private normalizeWords(words: string[]): string[] {
    return [
      ...new Set(
        words.map((word) => word.toLowerCase().trim()).filter(Boolean),
      ),
    ];
  }

  /**
   * Builds an empty grouped lexicon object containing all supported lexicon types.
   *
   * @returns Empty grouped lexicon map.
   */
  private buildEmptyGroupedWords(): Record<NlpLexiconType, string[]> {
    return Object.values(NlpLexiconType).reduce(
      (accumulator, type) => ({
        ...accumulator,
        [type]: [],
      }),
      {} as Record<NlpLexiconType, string[]>,
    );
  }
}
