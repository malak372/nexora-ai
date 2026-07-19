import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import {
  IdeaGenerationType,
  UnlockMethod,
} from '@prisma/client';

import {
  GUEST_GENERATION_LIMIT,
  IDEA_GENERATION_ERROR_CODES,
  PREMIUM_IDEA_CREDIT_COST,
} from '../constants/idea-generation.constants';

import type {
  GuestIdeaGenerationPolicyInput,
  IdeaGenerationPolicy,
  IdeaGenerationPolicyInput,
  RegisteredIdeaGenerationPolicyInput,
} from '../types/idea-generation-policy.type';

/**
 * Evaluates whether an owner is permitted to start an
 * idea-generation run.
 *
 * This service contains entitlement rules only.
 *
 * It does not:
 * - Deduct credits.
 * - Increment free-generation usage.
 * - Mark guest sessions as used.
 * - Create generation runs.
 * - Persist ideas.
 *
 * The policy result represents an initial authorization decision.
 * Any entitlement consumed by successful generation must be
 * validated again and updated atomically by the persistence layer.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationPolicyService {
  /**
   * Evaluates generation entitlement for either a registered user
   * or a guest session.
   *
   * @param input Owner and requested generation information.
   * @returns Resolved generation policy.
   */
  evaluate(
    input: IdeaGenerationPolicyInput,
  ): IdeaGenerationPolicy {
    if (input.ownerType === 'GUEST') {
      return this.evaluateGuestPolicy(input);
    }

    return this.evaluateRegisteredUserPolicy(input);
  }

  /**
   * Evaluates generation entitlement for a registered user.
   *
   * @param input Registered-user policy input.
   * @returns Authorized generation policy.
   */
  private evaluateRegisteredUserPolicy(
    input: RegisteredIdeaGenerationPolicyInput,
  ): IdeaGenerationPolicy {
    const { user, requestedGenerationType } = input;

    this.validateRegisteredUser(user);

    switch (requestedGenerationType) {
      case IdeaGenerationType.NORMAL_FREE:
        return this.buildNormalFreePolicy(input);

      case IdeaGenerationType.PREMIUM_CREDIT:
        return this.buildPremiumCreditPolicy(input);

      default:
        throw new BadRequestException({
          code:
            IDEA_GENERATION_ERROR_CODES
              .INVALID_REQUEST,
          message:
            'The requested generation type is not available for registered users.',
        });
    }
  }

  /**
   * Evaluates the single free generation available to a guest
   * session.
   *
   * A null expiration timestamp is accepted because the current
   * Prisma schema allows GuestSession.expiresAt to be nullable.
   *
   * @param input Guest-session policy input.
   * @returns Authorized guest-generation policy.
   */
  private evaluateGuestPolicy(
    input: GuestIdeaGenerationPolicyInput,
  ): IdeaGenerationPolicy {
    const {
      guestSession,
      requestedGenerationType,
    } = input;

    if (
      requestedGenerationType !==
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

    if (
      guestSession.expiresAt !== null &&
      guestSession.expiresAt.getTime() <=
        Date.now()
    ) {
      throw new ForbiddenException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,
        message: 'The guest session has expired.',
      });
    }

    if (
      GUEST_GENERATION_LIMIT <= 0 ||
      guestSession.hasGenerated
    ) {
      throw new ForbiddenException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .GUEST_LIMIT_REACHED,
        message:
          'The guest generation limit has been reached.',
      });
    }

    return {
      generationType:
        IdeaGenerationType.GUEST_FREE,

      includePremiumOutputs: false,
      unlockOnGeneration: false,
      unlockMethod: null,

      creditsToConsume: 0,
      consumesFreeGeneration: false,
      consumesGuestGeneration: true,

      canViewAdvancedOutputs: false,
      canViewCommunityData: false,
      canUseAiChat: false,

      remainingFreeGenerations: null,
      expectedCreditBalance: null,
    };
  }

  /**
   * Builds the entitlement policy for a registered free
   * generation.
   *
   * @param input Registered-user policy input.
   * @returns Normal-free generation policy.
   */
  private buildNormalFreePolicy(
    input: RegisteredIdeaGenerationPolicyInput,
  ): IdeaGenerationPolicy {
    const { user } = input;

    const freeGenerationLimit = Math.max(
      0,
      user.freeGenerationLimit,
    );

    const freeGenerationsUsed = Math.max(
      0,
      user.freeGenerationsUsed,
    );

    const remainingBeforeGeneration = Math.max(
      0,
      freeGenerationLimit - freeGenerationsUsed,
    );

    if (remainingBeforeGeneration <= 0) {
      throw new ForbiddenException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .FREE_LIMIT_REACHED,
        message:
          'The free idea-generation limit has been reached.',
      });
    }

    return {
      generationType:
        IdeaGenerationType.NORMAL_FREE,

      includePremiumOutputs: false,
      unlockOnGeneration: false,
      unlockMethod: null,

      creditsToConsume: 0,
      consumesFreeGeneration: true,
      consumesGuestGeneration: false,

      canViewAdvancedOutputs: false,
      canViewCommunityData: false,
      canUseAiChat: false,

      remainingFreeGenerations:
        remainingBeforeGeneration - 1,

      expectedCreditBalance: null,
    };
  }

  /**
   * Builds the entitlement policy for premium-credit generation.
   *
   * The returned expected credit balance is informational.
   * The persistence layer must validate and deduct the current
   * balance atomically before committing the generated idea.
   *
   * @param input Registered-user policy input.
   * @returns Premium-credit generation policy.
   */
  private buildPremiumCreditPolicy(
    input: RegisteredIdeaGenerationPolicyInput,
  ): IdeaGenerationPolicy {
    const { user } = input;

    const currentCreditBalance = Math.max(
      0,
      user.creditBalance,
    );

    if (
      currentCreditBalance <
      PREMIUM_IDEA_CREDIT_COST
    ) {
      throw new ForbiddenException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INSUFFICIENT_CREDITS,
        message:
          'The user does not have enough credits to generate a premium idea.',
        requiredCredits:
          PREMIUM_IDEA_CREDIT_COST,
        availableCredits:
          currentCreditBalance,
      });
    }

    return {
      generationType:
        IdeaGenerationType.PREMIUM_CREDIT,

      includePremiumOutputs: true,
      unlockOnGeneration: true,
      unlockMethod:
        UnlockMethod.CREDIT_GENERATION,

      creditsToConsume:
        PREMIUM_IDEA_CREDIT_COST,

      consumesFreeGeneration: false,
      consumesGuestGeneration: false,

      canViewAdvancedOutputs: true,
      canViewCommunityData: true,
      canUseAiChat: true,

      remainingFreeGenerations: null,

      expectedCreditBalance:
        currentCreditBalance -
        PREMIUM_IDEA_CREDIT_COST,
    };
  }

  /**
   * Validates general account requirements applied to every
   * registered-user generation request.
   *
   * @param user Minimal registered-user policy data.
   */
  private validateRegisteredUser(
    user: RegisteredIdeaGenerationPolicyInput['user'],
  ): void {
    if (!user.isActive) {
      throw new ForbiddenException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .ACCOUNT_INACTIVE,
        message:
          'The user account is inactive.',
      });
    }

    if (!user.isVerified) {
      throw new ForbiddenException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .ACCOUNT_NOT_VERIFIED,
        message:
          'The user account must be verified before generating ideas.',
      });
    }
  }
}