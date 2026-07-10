import { Injectable } from '@nestjs/common';
import { AccountStatus, Idea, IdeaGenerationType, User } from '@prisma/client';

/**
 * Service responsible for evaluating user permissions
 * across idea generation and advanced idea features.
 *
 * Centralizes Nexora AI access rules for:
 * - Free registered-user idea generation.
 * - Premium credit-based idea generation.
 * - Direct payment unlocks for free ideas.
 * - Advanced feature visibility.
 *
 * @author Eman
 */
@Injectable()
export class UserPermissionsService {
  /**
   * Determines whether a registered user can generate
   * another free project idea.
   *
   * Registered users have a limited number of free
   * idea generations after account creation.
   */
  canGenerateFreeIdea(
    user: Pick<User, 'freeGenerationLimit' | 'freeGenerationsUsed'>,
  ): boolean {
    return user.freeGenerationsUsed < user.freeGenerationLimit;
  }

  /**
   * Determines whether a user can generate a premium
   * project idea using credits.
   *
   * Premium generation requires:
   * - Premium account status.
   * - At least one available credit.
   *
   * Direct payment unlocks do not make the user premium.
   * Each successful premium generation consumes one credit.
   */
  canGeneratePremiumIdea(
    user: Pick<User, 'accountStatus' | 'creditBalance'>,
  ): boolean {
    return (
      user.accountStatus === AccountStatus.PREMIUM && user.creditBalance > 0
    );
  }

  /**
   * Determines whether advanced project features
   * are accessible for the specified idea.
   *
   * Advanced features are available when the idea is unlocked
   * through direct payment or generated using premium credits.
   */
  canViewAdvancedFeatures(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return (
      idea.isUnlocked ||
      idea.generationType === IdeaGenerationType.PREMIUM_CREDIT
    );
  }

  /**
   * Determines whether a free locked idea can be unlocked
   * through direct payment.
   *
   * Premium credit-generated ideas already include advanced
   * features and do not require direct unlock.
   */
  canUnlockIdea(idea: Pick<Idea, 'isUnlocked' | 'generationType'>): boolean {
    return (
      !this.canViewAdvancedFeatures(idea) &&
      idea.generationType !== IdeaGenerationType.PREMIUM_CREDIT
    );
  }

  /** Determines whether the full project abstract can be viewed. */
  canViewFullAbstract(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the AI-powered project assistant can be accessed. */
  canOpenAiChat(idea: Pick<Idea, 'isUnlocked' | 'generationType'>): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether NLP-based comment analysis can be viewed. */
  canViewCommentAnalysis(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the recommended system architecture can be viewed. */
  canViewArchitecture(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the preliminary database design can be viewed. */
  canViewDatabaseDesign(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the recommended technology stack can be viewed. */
  canViewTechnologies(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the preliminary business model can be viewed. */
  canViewBusinessModel(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the estimated project budget can be viewed. */
  canViewBudget(idea: Pick<Idea, 'isUnlocked' | 'generationType'>): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the estimated implementation timeline can be viewed. */
  canViewTimeline(idea: Pick<Idea, 'isUnlocked' | 'generationType'>): boolean {
    return this.canViewAdvancedFeatures(idea);
  }

  /** Determines whether the feasibility assessment can be viewed. */
  canViewFeasibility(
    idea: Pick<Idea, 'isUnlocked' | 'generationType'>,
  ): boolean {
    return this.canViewAdvancedFeatures(idea);
  }
}
