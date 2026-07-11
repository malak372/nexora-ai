import { BadGatewayException, Injectable } from '@nestjs/common';

import { MAX_AI_RESPONSE_LENGTH } from '../constants';

/**
 * Parses textual AI-provider output into JSON.
 *
 * AI providers may occasionally:
 * - Wrap JSON inside Markdown code fences.
 * - Add short explanatory text before the JSON object.
 * - Add explanatory text after the JSON object.
 *
 * This service:
 * - Rejects empty provider responses.
 * - Rejects unexpectedly large responses.
 * - Removes surrounding Markdown code fences.
 * - Attempts direct JSON parsing.
 * - Extracts the first balanced JSON object when surrounding text
 *   exists.
 * - Rejects invalid or incomplete JSON.
 *
 * This service does not validate the business structure of the parsed
 * value. Structural and schema validation remain the responsibility of
 * AiStructuredOutputService.
 *
 * @author Malak
 */
@Injectable()
export class AiResponseParserService {
  /**
   * Parses one textual AI-provider response as JSON.
   *
   * @param rawText Raw provider response.
   * @returns Parsed JSON-compatible value.
   *
   * @throws BadGatewayException When the response is empty, too large,
   * non-textual, or contains invalid JSON.
   */
  parseJson(rawText: string): unknown {
    if (typeof rawText !== 'string') {
      throw new BadGatewayException(
        'The AI provider returned a non-textual response.',
      );
    }

    const trimmed = rawText.trim();

    if (!trimmed) {
      throw new BadGatewayException(
        'The AI provider returned an empty response.',
      );
    }

    if (trimmed.length > MAX_AI_RESPONSE_LENGTH) {
      throw new BadGatewayException(
        'The AI provider returned an unexpectedly large response.',
      );
    }

    const normalized = this.removeCodeFences(trimmed);

    try {
      return JSON.parse(normalized);
    } catch {
      const extracted = this.extractBalancedJsonObject(normalized);

      if (!extracted) {
        throw new BadGatewayException(
          'The AI provider returned an invalid JSON response.',
        );
      }

      try {
        return JSON.parse(extracted);
      } catch {
        throw new BadGatewayException(
          'The AI provider returned malformed structured output.',
        );
      }
    }
  }

  /**
   * Removes one surrounding Markdown code fence.
   *
   * Supported examples:
   *
   * ```json
   * {"title":"Example"}
   * ```
   *
   * and:
   *
   * ```
   * {"title":"Example"}
   * ```
   *
   * @param value Provider response.
   * @returns Response without surrounding Markdown code fences.
   */
  private removeCodeFences(value: string): string {
    return value
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  /**
   * Extracts the first balanced JSON object from surrounding text.
   *
   * Unlike slicing between the first and last braces, this algorithm
   * correctly handles:
   * - Nested JSON objects.
   * - Braces inside string values.
   * - Escaped quotation marks.
   *
   * @param value Normalized provider response.
   * @returns Extracted JSON object, or null when none is balanced.
   */
  private extractBalancedJsonObject(value: string): string | null {
    let startIndex = -1;
    let depth = 0;
    let isInsideString = false;
    let isEscaped = false;

    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];

      if (isInsideString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }

        if (character === '\\') {
          isEscaped = true;
          continue;
        }

        if (character === '"') {
          isInsideString = false;
        }

        continue;
      }

      if (character === '"') {
        isInsideString = true;
        continue;
      }

      if (character === '{') {
        if (depth === 0) {
          startIndex = index;
        }

        depth += 1;
        continue;
      }

      if (character === '}') {
        if (depth === 0) {
          continue;
        }

        depth -= 1;

        if (depth === 0 && startIndex !== -1) {
          return value.slice(startIndex, index + 1);
        }
      }
    }

    return null;
  }
}
