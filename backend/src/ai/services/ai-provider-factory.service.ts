import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { AiProviderType } from '@prisma/client';

import { AiProvider } from '../providers/ai-provider.interface';
import { GoogleProvider } from '../providers/google.provider';
import { GroqProvider } from '../providers/groq.provider';
import { OpenRouterProvider } from '../providers/openrouter.provider';

/**
 * Resolves the provider adapter associated with an AI model.
 *
 * @author Malak
 */
@Injectable()
export class AiProviderFactoryService {
  constructor(
    private readonly googleProvider: GoogleProvider,
    private readonly groqProvider: GroqProvider,
    private readonly openRouterProvider: OpenRouterProvider,
  ) {}

  getProvider(provider: AiProviderType): AiProvider {
    switch (provider) {
      case AiProviderType.GOOGLE:
        return this.googleProvider;

      case AiProviderType.GROQ:
        return this.groqProvider;

      case AiProviderType.OPENROUTER:
        return this.openRouterProvider;

      default:
        return this.assertNever(provider);
    }
  }

  private assertNever(value: never): never {
    throw new InternalServerErrorException(
      `Unsupported AI provider: ${String(value)}.`,
    );
  }
}
