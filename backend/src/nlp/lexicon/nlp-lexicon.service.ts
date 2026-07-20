import { Injectable } from '@nestjs/common';
import { LanguageCode, NlpLexiconType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lexicon words grouped by their semantic NLP category.
 *
 */
export type GroupedNlpLexiconWords = Record<
  NlpLexiconType,
  readonly string[]
>;

/**
 * Provides centralized, read-only access to active NLP lexicon entries.
 *
 * This service isolates Prisma queries and lexicon normalization from the
 * higher-level NLP analysis services.
 *
 * Responsibilities:
 * - Retrieve active lexicon entries by language and semantic category.
 * - Merge language-specific entries with language-neutral ANY entries.
 * - Normalize Unicode text consistently.
 * - Remove empty values and duplicate terms.
 * - Return lexicons in stable alphabetical order.
 *
 * This service does not modify or persist lexicon entries.
 *
 * @author Eman
 */
@Injectable()
export class NlpLexiconService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Returns active lexicon terms for one category and target language.
   *
   * Language-neutral entries marked as LanguageCode.ANY are included
   * automatically. When the requested language is ANY, the query includes
   * only ANY entries and avoids a duplicated language filter value.
   *
   * @param type Lexicon category to retrieve.
   * @param language Target language of the analyzed text.
   * @returns Unique normalized lexicon terms.
   */
  async getWords(
    type: NlpLexiconType,
    language: LanguageCode,
  ): Promise<string[]> {
    const lexicons = await this.prisma.nlpLexicon.findMany({
      where: {
        type,
        isActive: true,
        language: this.buildLanguageFilter(language),
      },
      select: {
        word: true,
      },
      orderBy: {
        word: Prisma.SortOrder.asc,
      },
    });

    return this.normalizeWords(
      lexicons.map((lexicon) => lexicon.word),
    );
  }

  /**
   * Returns all active lexicon terms grouped by category for one language.
   *
   * All categories are loaded in one database query to avoid issuing one query
   * for every NlpLexiconType during a full NLP analysis run.
   *
   * @param language Target language of the analyzed text.
   * @returns Normalized lexicon terms grouped by category.
   */
  async getGroupedWords(
    language: LanguageCode,
  ): Promise<Record<NlpLexiconType, string[]>> {
    const lexicons = await this.prisma.nlpLexicon.findMany({
      where: {
        isActive: true,
        language: this.buildLanguageFilter(language),
      },
      select: {
        word: true,
        type: true,
      },
      orderBy: [
        {
          type: Prisma.SortOrder.asc,
        },
        {
          word: Prisma.SortOrder.asc,
        },
      ],
    });

    const groupedWords = this.buildEmptyGroupedWords();

    for (const lexicon of lexicons) {
      groupedWords[lexicon.type].push(lexicon.word);
    }

    for (const type of this.getLexiconTypes()) {
      groupedWords[type] = this.normalizeWords(groupedWords[type]);
    }

    return groupedWords;
  }

  /**
   * Builds the Prisma language filter used by lexicon queries.
   *
   * @param language Requested text language.
   * @returns Prisma enum filter for language-specific and generic entries.
   */
  private buildLanguageFilter(
    language: LanguageCode,
  ): Prisma.EnumLanguageCodeFilter<'NlpLexicon'> {
    if (language === LanguageCode.ANY) {
      return {
        equals: LanguageCode.ANY,
      };
    }

    return {
      in: [language, LanguageCode.ANY],
    };
  }

  /**
   * Normalizes lexicon terms and removes duplicates.
   *
   * Normalization includes:
   * - Unicode NFKC normalization.
   * - Zero-width character removal.
   * - Locale-aware lowercase conversion.
   * - Leading and trailing whitespace removal.
   * - Internal whitespace collapsing.
   *
   * @param words Raw lexicon terms retrieved from the database.
   * @returns Unique normalized lexicon terms in stable order.
   */
  private normalizeWords(words: readonly string[]): string[] {
    const normalizedWords = new Set<string>();

    for (const word of words) {
      const normalizedWord = this.normalizeWord(word);

      if (normalizedWord) {
        normalizedWords.add(normalizedWord);
      }
    }

    return [...normalizedWords].sort((first, second) =>
      first.localeCompare(second),
    );
  }

  /**
   * Normalizes one lexicon term.
   *
   * @param word Raw lexicon term.
   * @returns Normalized term, or an empty string for invalid input.
   */
  private normalizeWord(word: string): string {
    if (typeof word !== 'string') {
      return '';
    }

    return word
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/gu, '')
      .toLocaleLowerCase()
      .trim()
      .replace(/\s+/gu, ' ');
  }

  /**
   * Builds an empty grouped lexicon object containing every Prisma enum value.
   *
   * @returns Empty lexicon arrays indexed by NlpLexiconType.
   */
  private buildEmptyGroupedWords(): Record<NlpLexiconType, string[]> {
    const groupedWords = {} as Record<NlpLexiconType, string[]>;

    for (const type of this.getLexiconTypes()) {
      groupedWords[type] = [];
    }

    return groupedWords;
  }

  /**
   * Returns all available Prisma NLP lexicon categories.
   *
   * @returns Supported lexicon types.
   */
  private getLexiconTypes(): NlpLexiconType[] {
    return Object.values(NlpLexiconType);
  }
}