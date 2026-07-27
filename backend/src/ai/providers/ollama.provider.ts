import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../constants/ai-provider.constants';
import { AiProviderErrorCode } from '../errors/ai-provider-error-code.enum';
import { AiProviderError } from '../errors/ai-provider.error';
import {
  AiFinishReason,
  AiResponseFormat,
  type AiProviderGenerateInput,
  type AiProviderGenerateResult,
} from '../types/ai-provider.type';
import type { AiProvider } from './ai-provider.interface';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const OLLAMA_CHAT_PATH = '/api/chat';
const MAX_OLLAMA_ERROR_MESSAGE_LENGTH = 500;
const OLLAMA_JSON_INSTRUCTION =
  'Return exactly one valid JSON object. Do not include Markdown, code fences, explanations, or text outside the JSON object.';

type OllamaChatResponse = {
  readonly model?: unknown;
  readonly created_at?: unknown;
  readonly message?: {
    readonly role?: unknown;
    readonly content?: unknown;
  };
  readonly done?: unknown;
  readonly done_reason?: unknown;
  readonly prompt_eval_count?: unknown;
  readonly eval_count?: unknown;
};

@Injectable()
export class OllamaProvider implements AiProvider {
  readonly providerKey: AiProviderKey = AI_PROVIDER_KEYS.OLLAMA;

  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl = this.normalizeBaseUrl(
      configService.get<string>('OLLAMA_BASE_URL') ?? DEFAULT_OLLAMA_BASE_URL,
    );
  }

  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    this.validateInput(input);

    const apiModelId = input.apiModelId.trim();
    const startedAt = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}${OLLAMA_CHAT_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: apiModelId,
          messages: this.buildMessages(input),
          stream: false,
          ...(input.responseFormat === AiResponseFormat.JSON
            ? { format: 'json' }
            : {}),
          options: {
            num_predict: input.maxOutputTokens,
            ...(input.temperature !== undefined
              ? { temperature: input.temperature }
              : {}),
          },
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw this.createHttpError(response.status, responseText);
      }

      const payload = (await response.json()) as OllamaChatResponse;
      const text = this.normalizeRequiredText(payload.message?.content);

      return {
        providerKey: this.providerKey,
        apiModelId,
        text,
        inputTokens: this.normalizeTokenCount(payload.prompt_eval_count),
        outputTokens: this.normalizeTokenCount(payload.eval_count),
        finishReason: this.mapFinishReason(payload.done, payload.done_reason),
        providerLatencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      throw this.normalizeError(error);
    }
  }

  private buildMessages(
    input: AiProviderGenerateInput,
  ): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
    const systemParts = [
      input.systemInstruction?.trim(),
      input.responseFormat === AiResponseFormat.JSON
        ? OLLAMA_JSON_INSTRUCTION
        : undefined,
    ].filter((value): value is string => Boolean(value));

    return [
      ...(systemParts.length > 0
        ? [{ role: 'system' as const, content: systemParts.join('\n\n') }]
        : []),
      { role: 'user' as const, content: input.userPrompt.trim() },
    ];
  }

  private validateInput(input: AiProviderGenerateInput): void {
    if (!input.apiModelId?.trim()) {
      throw new BadRequestException('Ollama model ID is required.');
    }

    if (!input.userPrompt?.trim()) {
      throw new BadRequestException('AI user prompt is required.');
    }

    if (
      !Number.isInteger(input.maxOutputTokens) ||
      input.maxOutputTokens <= 0
    ) {
      throw new BadRequestException(
        'AI maximum output tokens must be a positive integer.',
      );
    }
  }

  private createHttpError(
    statusCode: number,
    responseText: string,
  ): AiProviderError {
    const message = this.truncateMessage(responseText);

    switch (statusCode) {
      case 400:
        return new AiProviderError(
          message || 'Ollama rejected the generation request.',
          AiProviderErrorCode.INVALID_MODEL_CONFIGURATION,
          false,
          statusCode,
        );
      case 404:
        return new AiProviderError(
          message || 'The configured Ollama model was not found.',
          AiProviderErrorCode.MODEL_NOT_FOUND,
          false,
          statusCode,
        );
      case 429:
        return new AiProviderError(
          message || 'Ollama is temporarily busy.',
          AiProviderErrorCode.RATE_LIMIT,
          true,
          statusCode,
        );
      default:
        return new AiProviderError(
          message || 'Ollama is unavailable.',
          AiProviderErrorCode.PROVIDER_UNAVAILABLE,
          statusCode >= 500,
          statusCode,
        );
    }
  }

  private normalizeError(error: unknown): AiProviderError {
    if (this.isAbortError(error)) {
      return new AiProviderError(
        'The Ollama request was cancelled or timed out.',
        AiProviderErrorCode.TIMEOUT,
        true,
        undefined,
        undefined,
        error,
      );
    }

    if (error instanceof TypeError) {
      return new AiProviderError(
        'Could not connect to the local Ollama service.',
        AiProviderErrorCode.NETWORK,
        true,
        undefined,
        undefined,
        error,
      );
    }

    return new AiProviderError(
      'Ollama failed with an unexpected error.',
      AiProviderErrorCode.UNKNOWN,
      true,
      undefined,
      undefined,
      error,
    );
  }

  private mapFinishReason(done: unknown, doneReason: unknown): AiFinishReason {
    if (done !== true) {
      return AiFinishReason.UNKNOWN;
    }

    if (doneReason === 'length') {
      return AiFinishReason.MAX_TOKENS;
    }

    return AiFinishReason.STOP;
  }

  private normalizeRequiredText(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AiProviderError(
        'Ollama returned an empty textual response.',
        AiProviderErrorCode.EMPTY_RESPONSE,
        true,
        502,
      );
    }

    return value.trim();
  }

  private normalizeTokenCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  }

  private normalizeBaseUrl(value: string): string {
    const normalized = value.trim().replace(/\/+$/, '');

    if (!/^https?:\/\//i.test(normalized)) {
      throw new Error('OLLAMA_BASE_URL must use http:// or https://.');
    }

    return normalized;
  }

  private truncateMessage(value: string): string {
    return value.trim().slice(0, MAX_OLLAMA_ERROR_MESSAGE_LENGTH);
  }

  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    );
  }
}
