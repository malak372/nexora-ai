import { BadGatewayException, Injectable } from '@nestjs/common';

import { MAX_AI_RESPONSE_LENGTH } from '../constants';

/**
 * Opening JSON container characters supported by the parser.
 */
type JsonOpeningCharacter = '{' | '[';

/**
 * Closing JSON container characters supported by the parser.
 */
type JsonClosingCharacter = '}' | ']';

/**
 * Represents one active nested JSON container.
 */
type JsonContainer = {
  /**
   * Character that opened the container.
   */
  readonly openingCharacter: JsonOpeningCharacter;

  /**
   * Character expected to close the container.
   */
  readonly closingCharacter: JsonClosingCharacter;
};

/**
 * Parses textual AI-provider output into JSON-compatible values.
 *
 * AI providers may occasionally:
 * - Wrap JSON inside Markdown code fences.
 * - Add short explanatory text before the JSON value.
 * - Add explanatory text after the JSON value.
 *
 * This service:
 * - Rejects non-textual provider responses.
 * - Rejects empty provider responses.
 * - Rejects unexpectedly large responses.
 * - Removes one surrounding Markdown code fence.
 * - Attempts direct JSON parsing first.
 * - Extracts the first balanced JSON object or array when surrounding
 *   text exists.
 * - Correctly handles nested containers, string values, and escaped
 *   quotation marks.
 * - Rejects invalid, malformed, or incomplete JSON.
 *
 * This service does not:
 * - Validate the business structure of the parsed value.
 * - Validate the value against a JSON Schema.
 * - Repair incomplete or invalid provider output.
 *
 * Structural and schema validation remain the responsibility of
 * AiStructuredOutputService. Repair requests remain the responsibility
 * of the AI response-repair flow.
 *
 * @author Malak
 */
@Injectable()
export class AiResponseParserService {
  /**
   * Parses one textual AI-provider response as JSON.
   *
   * Direct parsing is attempted first because provider output is
   * normally expected to contain only the requested JSON value.
   *
   * When direct parsing fails, the parser attempts to extract the first
   * complete balanced JSON object or array from surrounding provider
   * commentary.
   *
   * @param rawText Raw textual provider response.
   * @returns Parsed JSON-compatible value.
   *
   * @throws BadGatewayException when the response is non-textual, empty,
   * too large, malformed, or does not contain a complete JSON value.
   */
  parseJson(rawText: string): unknown {
    const normalized = this.normalizeResponse(rawText);

    const directResult = this.tryParseJson(normalized);

    if (directResult.success) {
      return directResult.value;
    }

    const extractedJson = this.extractBalancedJsonValue(normalized);

    if (!extractedJson) {
      throw new BadGatewayException(
        'The AI provider returned an invalid JSON response.',
      );
    }

    const extractedResult = this.tryParseJson(extractedJson);

    if (!extractedResult.success) {
      throw new BadGatewayException(
        'The AI provider returned malformed structured output.',
      );
    }

    return extractedResult.value;
  }

  /**
   * Validates and normalizes one raw provider response.
   *
   * @param rawText Raw provider response.
   * @returns Trimmed response without one surrounding Markdown code
   * fence.
   */
  private normalizeResponse(rawText: string): string {
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

    return this.removeCodeFences(trimmed);
  }

  /**
   * Attempts to parse one string as JSON without throwing.
   *
   * @param value Candidate JSON string.
   * @returns A discriminated result containing either the parsed value
   * or a failure marker.
   */
  private tryParseJson(value: string):
    | {
        readonly success: true;
        readonly value: unknown;
      }
    | {
        readonly success: false;
      } {
    try {
      return {
        success: true,
        value: JSON.parse(value) as unknown,
      };
    } catch {
      return {
        success: false,
      };
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
   * ```JSON
   * [{"title":"Example"}]
   * ```
   *
   * ```
   * {"title":"Example"}
   * ```
   *
   * The method removes fences only when they surround the normalized
   * response. Markdown appearing inside a JSON string is preserved.
   *
   * @param value Trimmed provider response.
   * @returns Response without surrounding Markdown code fences.
   */
  private removeCodeFences(value: string): string {
    return value
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  /**
   * Extracts the first complete balanced JSON object or array from a
   * string containing optional surrounding text.
   *
   * Unlike slicing between the first and last braces, this scanner
   * correctly handles:
   * - Nested objects.
   * - Nested arrays.
   * - Objects inside arrays.
   * - Arrays inside objects.
   * - Braces and brackets inside string values.
   * - Escaped quotation marks.
   * - Escaped backslashes.
   *
   * The first encountered opening object or array starts the extraction
   * candidate. The method returns only after every nested container has
   * been closed in the correct order.
   *
   * @param value Normalized provider response.
   * @returns Extracted JSON object or array, or null when no complete
   * balanced JSON value exists.
   */
  private extractBalancedJsonValue(value: string): string | null {
    let startIndex = -1;

    let isInsideString = false;
    let isEscaped = false;

    const containerStack: JsonContainer[] = [];

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
        if (startIndex !== -1) {
          isInsideString = true;
        }

        continue;
      }

      if (character === '{' || character === '[') {
        if (containerStack.length === 0) {
          startIndex = index;
        }

        containerStack.push(this.createJsonContainer(character));

        continue;
      }

      if (character !== '}' && character !== ']') {
        continue;
      }

      if (containerStack.length === 0) {
        continue;
      }

      const activeContainer = containerStack[containerStack.length - 1];

      if (character !== activeContainer.closingCharacter) {
        /**
         * A mismatched closing character means the current candidate
         * cannot be valid JSON.
         *
         * Reset the scanner so a later independent JSON value can still
         * be considered.
         */
        startIndex = -1;
        containerStack.length = 0;
        isInsideString = false;
        isEscaped = false;

        continue;
      }

      containerStack.pop();

      if (containerStack.length === 0 && startIndex !== -1) {
        return value.slice(startIndex, index + 1);
      }
    }

    return null;
  }

  /**
   * Creates stack metadata for one opening JSON container character.
   *
   * @param openingCharacter Object or array opening character.
   * @returns Matching container metadata.
   */
  private createJsonContainer(
    openingCharacter: JsonOpeningCharacter,
  ): JsonContainer {
    return {
      openingCharacter,

      closingCharacter: openingCharacter === '{' ? '}' : ']',
    };
  }
}
