import { Injectable } from '@nestjs/common';

/**
 * Represents a cleaned text ready for NLP processing.
 */
export type CleanTextResult = {
  /**
   * Original text collected from the source platform.
   */
  originalText: string;

  /**
   * Normalized text after preprocessing.
   */
  cleanedText: string;

  /**
   * Indicates whether the cleaned text contains meaningful content.
   */
  isEmpty: boolean;
};

/**
 * Service responsible for preparing raw social posts and comments
 * before they enter the NLP analysis pipeline.
 *
 * Responsibilities:
 * - Normalize text casing.
 * - Remove URLs.
 * - Remove user mentions.
 * - Preserve hashtag words without the '#' symbol.
 * - Remove unsupported characters.
 * - Collapse repeated whitespace.
 * - Filter duplicate and empty texts.
 *
 * This service only performs text preprocessing and does not interact
 * with the database or execute NLP analysis algorithms.
 *
 * @author Eman
 */
@Injectable()
export class TextCleaningService {
  /**
   * Cleans and normalizes a single text.
   *
   * @param text Raw text collected from a social platform.
   * @returns A cleaned text object.
   */
  clean(text: string): CleanTextResult {
    const originalText = text ?? '';

    const cleanedText = originalText
      .toLocaleLowerCase()
      .replace(/https?:\/\/\S+/gu, ' ')
      .replace(/www\.\S+/gu, ' ')
      .replace(/@\w+/gu, ' ')
      .replace(/#([\p{L}\p{N}_]+)/gu, '$1')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    return {
      originalText,
      cleanedText,
      isEmpty: cleanedText.length === 0,
    };
  }

  /**
   * Cleans multiple texts.
   *
   * @param texts Collection of raw texts.
   * @returns Cleaned text results.
   */
  cleanMany(
    texts: readonly string[],
  ): CleanTextResult[] {
    return texts.map((text) => this.clean(text));
  }

  /**
   * Removes duplicate and empty texts after normalization.
   *
   * @param texts Cleaned text results.
   * @returns Unique cleaned texts.
   */
  removeDuplicates(
    texts: readonly CleanTextResult[],
  ): CleanTextResult[] {
    const seen = new Set<string>();

    return texts.filter((text) => {
      if (text.isEmpty) {
        return false;
      }

      if (seen.has(text.cleanedText)) {
        return false;
      }

      seen.add(text.cleanedText);
      return true;
    });
  }
}