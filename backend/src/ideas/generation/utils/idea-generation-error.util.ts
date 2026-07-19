import { HttpException } from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_GENERATION_ERROR_MESSAGE_LENGTH,
} from '../constants/idea-generation.constants';

/**
 * Safe error information suitable for persistence on an
 * IdeaGenerationRun record.
 *
 * Internal stack traces and arbitrary response payloads are
 * intentionally excluded.
 *
 * @author Malak
 */
export type NormalizedIdeaGenerationError = {
  /**
   * Stable machine-readable error code.
   */
  errorCode: string;

  /**
   * Safe human-readable error message.
   */
  errorMessage: string;
};

/**
 * Shape supported when extracting structured NestJS exception
 * responses.
 *
 * @author Malak
 */
type StructuredHttpExceptionResponse = {
  /**
   * Optional machine-readable error code.
   */
  code?: unknown;

  /**
   * Optional error message or validation-message list.
   */
  message?: unknown;
};

/**
 * Converts an unknown generation failure into safe persisted
 * error information.
 *
 * Supported inputs:
 * - NestJS HttpException instances.
 * - Standard Error instances.
 * - Strings.
 * - Unknown thrown values.
 *
 * Stack traces and arbitrary response objects are never returned
 * by this utility.
 *
 * @param error Unknown thrown value.
 * @param fallbackCode Optional fallback error code.
 * @returns Normalized safe error data.
 *
 * @author Malak
 */
export function normalizeIdeaGenerationError(
  error: unknown,
  fallbackCode: string =
    IDEA_GENERATION_ERROR_CODES.PIPELINE_FAILED,
): NormalizedIdeaGenerationError {
  const normalizedFallbackCode =
    normalizeGenerationErrorCode(
      fallbackCode,
      IDEA_GENERATION_ERROR_CODES.PIPELINE_FAILED,
    );

  if (error instanceof HttpException) {
    return normalizeHttpException(
      error,
      normalizedFallbackCode,
    );
  }

  if (error instanceof Error) {
    return {
      errorCode: normalizedFallbackCode,
      errorMessage:
        truncateGenerationErrorMessage(
          error.message ||
            'Idea-generation operation failed.',
        ),
    };
  }

  if (typeof error === 'string') {
    return {
      errorCode: normalizedFallbackCode,
      errorMessage:
        truncateGenerationErrorMessage(
          error ||
            'Idea-generation operation failed.',
        ),
    };
  }

  return {
    errorCode: normalizedFallbackCode,
    errorMessage:
      'Unknown idea-generation failure.',
  };
}

/**
 * Converts an unknown thrown value into a standard Error.
 *
 * This utility is useful when an external library throws strings
 * or arbitrary objects.
 *
 * @param error Unknown thrown value.
 * @param fallbackMessage Message used for unsupported values.
 * @returns Standard Error instance.
 *
 * @author Malak
 */
export function toIdeaGenerationError(
  error: unknown,
  fallbackMessage =
    'Unknown idea-generation failure.',
): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    const normalizedMessage = error.trim();

    return new Error(
      normalizedMessage || fallbackMessage,
    );
  }

  return new Error(fallbackMessage);
}

/**
 * Limits persisted generation-error text to the configured
 * maximum length.
 *
 * @param message Raw error message.
 * @returns Safe truncated message.
 *
 * @author Malak
 */
export function truncateGenerationErrorMessage(
  message: string,
): string {
  const normalizedMessage =
    typeof message === 'string'
      ? message.trim()
      : '';

  const safeMessage =
    normalizedMessage ||
    'Idea-generation operation failed.';

  if (
    safeMessage.length <=
    MAX_GENERATION_ERROR_MESSAGE_LENGTH
  ) {
    return safeMessage;
  }

  return safeMessage.slice(
    0,
    MAX_GENERATION_ERROR_MESSAGE_LENGTH,
  );
}

/**
 * Normalizes one NestJS HTTP exception into safe generation
 * failure information.
 *
 * @param exception HTTP exception.
 * @param fallbackCode Fallback machine-readable code.
 * @returns Normalized error data.
 */
function normalizeHttpException(
  exception: HttpException,
  fallbackCode: string,
): NormalizedIdeaGenerationError {
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return {
      errorCode: fallbackCode,
      errorMessage:
        truncateGenerationErrorMessage(
          response,
        ),
    };
  }

  if (
    !isStructuredHttpExceptionResponse(
      response,
    )
  ) {
    return {
      errorCode: fallbackCode,
      errorMessage:
        truncateGenerationErrorMessage(
          exception.message,
        ),
    };
  }

  const errorCode =
    normalizeGenerationErrorCode(
      response.code,
      fallbackCode,
    );

  const errorMessage =
    normalizeExceptionMessage(
      response.message,
      exception.message,
    );

  return {
    errorCode,
    errorMessage:
      truncateGenerationErrorMessage(
        errorMessage,
      ),
  };
}

/**
 * Resolves an exception message from a string or validation
 * message list.
 *
 * @param value Structured exception-message value.
 * @param fallbackMessage Fallback exception message.
 * @returns Normalized safe message.
 */
function normalizeExceptionMessage(
  value: unknown,
  fallbackMessage: string,
): string {
  if (typeof value === 'string') {
    return value.trim() || fallbackMessage;
  }

  if (Array.isArray(value)) {
    const messages = value
      .filter(
        (message): message is string =>
          typeof message === 'string',
      )
      .map((message) => message.trim())
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join('; ');
    }
  }

  return fallbackMessage;
}

/**
 * Normalizes a machine-readable generation-error code.
 *
 * @param value Raw code.
 * @param fallbackCode Fallback code.
 * @returns Safe error code.
 */
function normalizeGenerationErrorCode(
  value: unknown,
  fallbackCode: string,
): string {
  if (typeof value !== 'string') {
    return fallbackCode;
  }

  const normalizedCode = value.trim();

  return normalizedCode || fallbackCode;
}

/**
 * Checks whether one HTTP response has a supported structured
 * shape.
 *
 * @param value Unknown HTTP response.
 * @returns Whether the value is a supported object.
 */
function isStructuredHttpExceptionResponse(
  value: unknown,
): value is StructuredHttpExceptionResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}