/**
 * Converts WebSocket, HTTP, validation, and unexpected errors into one stable
 * AI chat error event.
 *
 * @author Eman
 */

import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

import {
  AI_CHAT_ERROR_CODES,
  AI_CHAT_SERVER_EVENTS,
  type AiChatErrorCode,
} from '../constants/ai-chat.constants';
import type { AuthenticatedSocket } from '../types/authenticated-socket.type';
import type { AiChatSocketError } from '../types/chat-socket-events.type';

/**
 * Gateway-scoped exception filter for AI chat events.
 */
@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  /**
   * Emits a normalized error payload to the requesting client.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<AuthenticatedSocket>();
    const payload = this.normalizeException(exception);

    if (payload.code === AI_CHAT_ERROR_CODES.INTERNAL_ERROR) {
      this.logger.error(
        payload.message,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    client.emit(AI_CHAT_SERVER_EVENTS.ERROR, payload);
    this.acknowledgeFailure(host, payload);
  }

  /**
   * Completes an optional Socket.IO acknowledgement with the same error.
   */
  private acknowledgeFailure(
    host: ArgumentsHost,
    error: AiChatSocketError,
  ): void {
    const acknowledgement: unknown = host.getArgByIndex(2);

    if (typeof acknowledgement === 'function') {
      const acknowledge = acknowledgement as (
        payload: Readonly<{
          success: false;
          error: AiChatSocketError;
        }>,
      ) => void;

      acknowledge({
        success: false,
        error,
      });
    }
  }

  /**
   * Converts a supported exception into a public socket error payload.
   */
  private normalizeException(exception: unknown): AiChatSocketError {
    if (exception instanceof WsException) {
      return this.normalizeErrorValue(exception.getError());
    }

    if (exception instanceof HttpException) {
      return this.normalizeHttpException(exception);
    }

    return {
      code: AI_CHAT_ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected AI Chat error occurred.',
    };
  }

  /**
   * Converts an HTTP or validation exception raised inside a gateway.
   */
  private normalizeHttpException(exception: HttpException): AiChatSocketError {
    const response = exception.getResponse();
    const status = exception.getStatus();
    const message = this.extractMessage(response, exception.message);

    return {
      code: this.resolveHttpErrorCode(status, message),
      message,
    };
  }

  /**
   * Maps HTTP-style service exceptions to stable AI chat error codes.
   */
  private resolveHttpErrorCode(
    status: number,
    message: string,
  ): AiChatErrorCode {
    const normalizedMessage = message.toLowerCase();

    if (status === 400) {
      return AI_CHAT_ERROR_CODES.INVALID_PAYLOAD;
    }

    if (status === 401) {
      return AI_CHAT_ERROR_CODES.INVALID_ACCESS_TOKEN;
    }

    if (status === 403) {
      return normalizedMessage.includes('unlock')
        ? AI_CHAT_ERROR_CODES.IDEA_NOT_UNLOCKED
        : AI_CHAT_ERROR_CODES.USER_NOT_ALLOWED;
    }

    if (status === 404) {
      if (normalizedMessage.includes('message')) {
        return AI_CHAT_ERROR_CODES.MESSAGE_NOT_FOUND;
      }

      if (normalizedMessage.includes('idea')) {
        return AI_CHAT_ERROR_CODES.IDEA_NOT_FOUND;
      }

      return AI_CHAT_ERROR_CODES.SESSION_NOT_FOUND;
    }

    if (status === 409) {
      if (normalizedMessage.includes('completed')) {
        return AI_CHAT_ERROR_CODES.MESSAGE_ALREADY_COMPLETED;
      }

      if (normalizedMessage.includes('cancelled')) {
        return AI_CHAT_ERROR_CODES.MESSAGE_ALREADY_CANCELLED;
      }

      return AI_CHAT_ERROR_CODES.MESSAGE_ALREADY_PROCESSING;
    }

    return AI_CHAT_ERROR_CODES.INTERNAL_ERROR;
  }

  /**
   * Converts a WsException payload into the stable public shape.
   */
  private normalizeErrorValue(value: unknown): AiChatSocketError {
    if (typeof value === 'string') {
      return {
        code: AI_CHAT_ERROR_CODES.INVALID_PAYLOAD,
        message: value,
      };
    }

    if (this.isRecord(value)) {
      const code = this.isAiChatErrorCode(value.code)
        ? value.code
        : AI_CHAT_ERROR_CODES.INVALID_PAYLOAD;

      const message = this.extractMessage(
        value.message,
        'The AI Chat request could not be processed.',
      );

      return {
        code,
        message,
      };
    }

    return {
      code: AI_CHAT_ERROR_CODES.INVALID_PAYLOAD,
      message: 'The AI Chat request could not be processed.',
    };
  }

  /**
   * Extracts a readable message from Nest validation and exception payloads.
   */
  private extractMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (Array.isArray(value)) {
      const messages = value.filter(
        (item): item is string => typeof item === 'string' && !!item.trim(),
      );

      if (messages.length > 0) {
        return messages.join(' ');
      }
    }

    if (this.isRecord(value)) {
      return this.extractMessage(value.message, fallback);
    }

    return fallback;
  }

  /**
   * Narrows an unknown value to a plain record.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Verifies a stable AI chat error-code value.
   */
  private isAiChatErrorCode(value: unknown): value is AiChatErrorCode {
    return (
      typeof value === 'string' &&
      Object.values(AI_CHAT_ERROR_CODES).some((code) => code === value)
    );
  }
}
