import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  IdeaGenerationType,
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
} from '../../types/idea-generation-context.type';

import type {
  IdeaGenerationPolicyInput,
} from '../../types/idea-generation-policy.type';

import {
  IdeaGenerationPolicyService,
} from '../../services/idea-generation-policy.service';

import {
  PrismaService,
} from '../../../../prisma/prisma.service';

import {
  IDEA_OWNER_TYPES,
} from '../../../shared/constants/ideas.constants';

/**
 * Resolves and validates the entitlement associated with one
 * generation owner.
 *
 * Responsibilities:
 * - Load the current registered-user entitlement state.
 * - Load the current guest-session state.
 * - Delegate entitlement rules to IdeaGenerationPolicyService.
 * - Store the authorized policy in the pipeline context.
 * - Replace the requested generation type with the final
 *   policy-authorized generation type.
 *
 * This stage does not:
 * - Deduct credits.
 * - Increment free-generation usage.
 * - Mark guest sessions as consumed.
 * - Persist generated ideas.
 *
 * Entitlements are consumed atomically only after successful AI
 * generation and validation inside IdeaPersistenceService.
 *
 * @author Malak
 */
@Injectable()
export class EntitlementCheckStage
  implements IdeaGenerationStage
{
  /**
   * Stable pipeline-stage key.
   */
  readonly key =
    IDEA_GENERATION_STAGE_KEYS.ENTITLEMENT_CHECK;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition =
    this.resolveDefinition();

  constructor(
    private readonly prisma: PrismaService,

    private readonly policyService:
      IdeaGenerationPolicyService,
  ) {}

  /**
   * Evaluates generation entitlement for the current owner.
   *
   * @param context Current generation context.
   * @returns Context containing the authorized policy.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    const policyInput =
      await this.buildPolicyInput(context);

    const policy =
      this.policyService.evaluate(
        policyInput,
      );

    const updatedContext: IdeaGenerationContext = {
      ...context,

      generationType:
        policy.generationType,

      policy,
    };

    return {
      context: updatedContext,

      resultPreview:
        this.createResultPreview(
          policy.generationType,
        ),

      metadata: {
        generationType:
          policy.generationType,

        includePremiumOutputs:
          policy.includePremiumOutputs,

        consumesFreeGeneration:
          policy.consumesFreeGeneration,

        consumesGuestGeneration:
          policy.consumesGuestGeneration,

        creditsToConsume:
          policy.creditsToConsume,

        remainingFreeGenerations:
          policy.remainingFreeGenerations,

        expectedCreditBalance:
          policy.expectedCreditBalance,
      },
    };
  }

  /**
   * Builds a policy-service input from the current owner.
   *
   * @param context Current generation context.
   * @returns Registered-user or guest policy input.
   */
  private async buildPolicyInput(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationPolicyInput> {
    if (
      context.owner.type ===
      IDEA_OWNER_TYPES.USER
    ) {
      return this.buildUserPolicyInput(
        context,
      );
    }

    return this.buildGuestPolicyInput(
      context,
    );
  }

  /**
   * Loads the registered user and builds the policy input.
   *
   * @param context Current generation context.
   * @returns Registered-user policy input.
   */
  private async buildUserPolicyInput(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationPolicyInput> {
    const user =
      await this.prisma.user.findFirst({
        where: {
          id: context.owner.userId,
          deletedAt: null,
        },

        select: {
          id: true,
          role: true,
          userType: true,
          accountStatus: true,
          isActive: true,
          isVerified: true,
          creditBalance: true,
          freeGenerationLimit: true,
          freeGenerationsUsed: true,
        },
      });

    if (!user) {
      throw new NotFoundException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'The registered generation owner was not found.',
      });
    }

    if (
      context.generationType ===
      IdeaGenerationType.GUEST_FREE
    ) {
      throw new NotFoundException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Registered users cannot use guest-free generation.',
      });
    }

    return {
      ownerType: IDEA_OWNER_TYPES.USER,

      requestedGenerationType:
        context.generationType,

      user,
    };
  }

  /**
   * Loads the guest session and builds the policy input.
   *
   * @param context Current generation context.
   * @returns Guest-session policy input.
   */
  private async buildGuestPolicyInput(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationPolicyInput> {
    const guestSession =
      await this.prisma.guestSession.findUnique({
        where: {
          id:
            context.owner.guestSessionId,
        },

        select: {
          id: true,
          hasGenerated: true,
          expiresAt: true,
        },
      });

    if (!guestSession) {
      throw new NotFoundException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'The guest generation session was not found.',
      });
    }

    return {
      ownerType: IDEA_OWNER_TYPES.GUEST,

      requestedGenerationType:
        IdeaGenerationType.GUEST_FREE,

      guestSession,
    };
  }

  /**
   * Creates a concise stage result preview.
   *
   * @param generationType Authorized generation type.
   * @returns Result preview.
   */
  private createResultPreview(
    generationType: IdeaGenerationType,
  ): string {
    switch (generationType) {
      case IdeaGenerationType.GUEST_FREE:
        return 'Guest-free generation entitlement approved.';

      case IdeaGenerationType.NORMAL_FREE:
        return 'Registered free-generation entitlement approved.';

      case IdeaGenerationType.PREMIUM_CREDIT:
        return 'Premium-credit generation entitlement approved.';

      default:
        return 'Idea-generation entitlement approved.';
    }
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Entitlement-check stage definition.
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