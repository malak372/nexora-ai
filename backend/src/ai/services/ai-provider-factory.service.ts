import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AiProviderType } from '@prisma/client';

import { AiProvider } from '../providers/ai-provider.interface';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { GoogleProvider } from '../providers/google.provider';
import { GroqProvider } from '../providers/groq.provider';
import { OpenAiProvider } from '../providers/openai.provider';

/**
 * Resolves the AI provider adapter associated with an AiModel.
 *
 * This factory centralizes provider selection so that higher-level
 * services such as AiExecutionService do not depend directly on
 * concrete OpenAI, Anthropic, Google, or Groq implementations.
 *
 * All provider adapters are registered simultaneously in the NestJS
 * dependency-injection container, while this factory selects the
 * appropriate adapter at runtime using AiProviderType.
 *
 * @author Malak
 */
@Injectable()
export class AiProviderFactoryService {
  constructor(
    private readonly openAiProvider: OpenAiProvider,

    private readonly anthropicProvider: AnthropicProvider,

    private readonly googleProvider: GoogleProvider,

    private readonly groqProvider: GroqProvider,
  ) {}

  /**
   * Returns the provider adapter matching the requested provider type.
   *
   * @param provider Provider type stored on the selected AiModel.
   * @returns Provider-independent AI adapter implementation.
   *
   * @throws InternalServerErrorException When an unsupported provider
   * value reaches the factory.
   */
  getProvider(provider: AiProviderType): AiProvider {
    switch (provider) {
      case AiProviderType.OPENAI:
        return this.openAiProvider;

      case AiProviderType.ANTHROPIC:
        return this.anthropicProvider;

      case AiProviderType.GOOGLE:
        return this.googleProvider;

      case AiProviderType.GROQ:
        return this.groqProvider;

      default:
        return this.assertNever(provider);
    }
  }

  /**
   * Enforces exhaustive handling of AiProviderType values.
   *
   * @param value Provider value that should have been impossible.
   * @throws InternalServerErrorException Always.
   */
  private assertNever(value: never): never {
    throw new InternalServerErrorException(
      `Unsupported AI provider: ${String(value)}.`,
    );
  }
}
