import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  IdeaGenerationType,
  LanguageCode,
} from '@prisma/client';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import {
  IDEA_GENERATION_ERROR_CODES,
} from '../../constants/idea-generation.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import type {
  IdeaGenerationContext,
  IdeaGenerationLocation,
} from '../../types/idea-generation-context.type';

import {
  normalizeGenerationId,
  normalizeGenerationKeywords,
  normalizeGenerationStringArray,
  normalizeNullableGenerationText,
  normalizeRequiredGenerationText,
} from '../../utils/idea-generation-normalizer.util';

import {
  IDEA_OWNER_TYPES,
} from '../../../shared/constants/ideas.constants';

/**
 * Validates and normalizes the initial context before any
 * entitlement, data-source, collection, NLP, prompt, or AI
 * operation is executed.
 *
 * Responsibilities:
 * - Validate the generation-run identifier.
 * - Validate the selected domain identifier.
 * - Validate the owner discriminator and owner identifier.
 * - Validate the requested generation type.
 * - Normalize geographic information.
 * - Normalize user-provided keywords.
 * - Normalize requested data-source keys.
 * - Return a complete safe context for following stages.
 *
 * This stage does not:
 * - Query the database.
 * - Validate domain availability.
 * - Validate user or guest entitlement.
 * - Resolve data sources.
 * - Consume credits or generation limits.
 *
 * @author Malak
 */
@Injectable()
export class RequestValidationStage
  implements IdeaGenerationStage
{
  /**
   * Stable pipeline-stage key.
   */
  readonly key =
    IDEA_GENERATION_STAGE_KEYS.REQUEST_VALIDATION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition =
    this.resolveDefinition();

  /**
   * Validates and normalizes the initial generation context.
   *
   * @param context Current generation context.
   * @returns Normalized generation context.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const normalizedContext: IdeaGenerationContext = {
      ...context,

      runId: normalizeGenerationId(
        context.runId,
        'Generation-run ID',
      ),

      domainId: normalizeGenerationId(
        context.domainId,
        'Domain ID',
      ),

      generationType:
        this.validateGenerationType(
          context.generationType,
        ),

      owner: this.normalizeOwner(context),

      keywords: normalizeGenerationKeywords(
        context.keywords,
        20,
        100,
      ),

      requestedDataSourceKeys:
        normalizeGenerationStringArray(
          context.requestedDataSourceKeys,
          {
            lowercase: true,
            maxItems: 20,
            maxItemLength: 50,
          },
        ),

      location: this.normalizeLocation(
        context.location,
      ),

      cancellationRequested:
        Boolean(
          context.cancellationRequested,
        ),

      createdAt:
        context.createdAt instanceof Date &&
        !Number.isNaN(
          context.createdAt.getTime(),
        )
          ? context.createdAt
          : new Date(),
    };

    this.validateOwnerGenerationType(
      normalizedContext,
    );

    return {
      context: normalizedContext,

      resultPreview:
        'Generation request validated successfully.',

      metadata: {
        ownerType:
          normalizedContext.owner.type,

        generationType:
          normalizedContext.generationType,

        requestedDataSourcesCount:
          normalizedContext
            .requestedDataSourceKeys.length,

        customKeywordsCount:
          normalizedContext.keywords.length,
      },
    };
  }

  /**
   * Validates the presence of the initial context.
   *
   * @param context Generation context.
   */
  private validateContext(
    context: IdeaGenerationContext,
  ): void {
    if (!context) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Idea-generation context is required.',
      });
    }

    if (!context.owner) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Idea-generation owner is required.',
      });
    }

    if (!context.location) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Idea-generation location is required.',
      });
    }
  }

  /**
   * Normalizes and validates the generation owner.
   *
   * @param context Generation context.
   * @returns Normalized owner.
   */
  private normalizeOwner(
    context: IdeaGenerationContext,
  ): IdeaGenerationContext['owner'] {
    const { owner } = context;

    if (
      owner.type === IDEA_OWNER_TYPES.USER
    ) {
      return {
        type: IDEA_OWNER_TYPES.USER,

        userId: normalizeGenerationId(
          owner.userId,
          'User ID',
        ),
      };
    }

    if (
      owner.type === IDEA_OWNER_TYPES.GUEST
    ) {
      return {
        type: IDEA_OWNER_TYPES.GUEST,

        guestSessionId:
          normalizeGenerationId(
            owner.guestSessionId,
            'Guest-session ID',
          ),
      };
    }

    throw new BadRequestException({
      code:
        IDEA_GENERATION_ERROR_CODES
          .INVALID_REQUEST,

      message:
        'Unsupported idea-generation owner type.',
    });
  }

  /**
   * Normalizes collection location and language metadata.
   *
   * @param location Raw generation location.
   * @returns Normalized location.
   */
  private normalizeLocation(
    location: IdeaGenerationLocation,
  ): IdeaGenerationLocation {
    const country =
      normalizeRequiredGenerationText(
        location.country,
        'Country',
      );

    if (country.length > 100) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Country must not exceed 100 characters.',
      });
    }

    const city =
      normalizeNullableGenerationText(
        location.city,
      );

    const region =
      normalizeNullableGenerationText(
        location.region,
      );

    if (city && city.length > 100) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'City must not exceed 100 characters.',
      });
    }

    if (region && region.length > 100) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Region must not exceed 100 characters.',
      });
    }

    const radiusKm =
      this.normalizeRadius(location.radiusKm);

    const language =
      this.validateLanguage(location.language);

    return {
      country,
      city,
      region,
      radiusKm,
      language,
    };
  }

  /**
   * Validates an optional geographic radius.
   *
   * @param radiusKm Raw radius.
   * @returns Valid radius or null.
   */
  private normalizeRadius(
    radiusKm: number | null,
  ): number | null {
    if (
      radiusKm === null ||
      radiusKm === undefined
    ) {
      return null;
    }

    if (
      !Number.isInteger(radiusKm) ||
      radiusKm < 1 ||
      radiusKm > 500
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Collection radius must be an integer between 1 and 500 kilometres.',
      });
    }

    return radiusKm;
  }

  /**
   * Validates the selected generation language.
   *
   * @param language Raw language.
   * @returns Valid language.
   */
  private validateLanguage(
    language: LanguageCode,
  ): LanguageCode {
    const supportedLanguages =
      Object.values(LanguageCode);

    if (
      !supportedLanguages.includes(language)
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Unsupported generation language.',
      });
    }

    return language;
  }

  /**
   * Validates the selected generation type.
   *
   * @param generationType Raw generation type.
   * @returns Valid generation type.
   */
  private validateGenerationType(
    generationType: IdeaGenerationType,
  ): IdeaGenerationType {
    const supportedTypes =
      Object.values(IdeaGenerationType);

    if (
      !supportedTypes.includes(generationType)
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Unsupported idea-generation type.',
      });
    }

    return generationType;
  }

  /**
   * Ensures the requested generation type matches the owner
   * category.
   *
   * Guests may only request GUEST_FREE. Registered users may
   * request NORMAL_FREE or PREMIUM_CREDIT.
   *
   * @param context Normalized generation context.
   */
  private validateOwnerGenerationType(
    context: IdeaGenerationContext,
  ): void {
    if (
      context.owner.type ===
      IDEA_OWNER_TYPES.GUEST
    ) {
      if (
        context.generationType !==
        IdeaGenerationType.GUEST_FREE
      ) {
        throw new BadRequestException({
          code:
            IDEA_GENERATION_ERROR_CODES
              .INVALID_REQUEST,

          message:
            'Guest sessions may only request guest-free generation.',
        });
      }

      return;
    }

    if (
      context.generationType ===
      IdeaGenerationType.GUEST_FREE
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Registered users cannot request guest-free generation.',
      });
    }
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Request-validation stage definition.
   */
  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition =
      findIdeaGenerationStageDefinition(
        this.key,
      );

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}