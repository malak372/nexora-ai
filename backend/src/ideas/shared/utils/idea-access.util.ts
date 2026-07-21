import type { IdeaAccess, IdeaAccessSource } from '../types/idea-access.type';

/**
 * Calculates the capabilities available for an idea.
 *
 * All sensitive idea endpoints should rely on backend access
 * checks rather than trusting access values sent by the frontend.
 */
export function buildIdeaAccess(source: IdeaAccessSource): IdeaAccess {
  const isAvailable = source.isOwner && !source.isDeleted;

  const hasAdvancedAccess = isAvailable && source.isUnlocked;

  const canDirectUnlock =
    isAvailable && !source.isUnlocked && (source.supportsDirectUnlock ?? true);

  return {
    canViewAdvancedOutputs: hasAdvancedAccess,
    canViewFullAbstract: hasAdvancedAccess,
    canViewNlpAnalysis: hasAdvancedAccess,
    canViewCommunityData: hasAdvancedAccess,
    canUseAiChat: hasAdvancedAccess,

    /**
     * Both locked and unlocked owned ideas may be published.
     * Publication services must still expose only a safe snapshot.
     */
    canPublish: isAvailable,

    canDirectUnlock,

    requiresUnlock: isAvailable && !source.isUnlocked,
  };
}

/**
 * Determines whether advanced idea content may be returned.
 */
export function canViewAdvancedIdeaContent(source: IdeaAccessSource): boolean {
  return buildIdeaAccess(source).canViewAdvancedOutputs;
}

/**
 * Determines whether an owner may publish an idea.
 */
export function canPublishIdea(source: IdeaAccessSource): boolean {
  return buildIdeaAccess(source).canPublish;
}
