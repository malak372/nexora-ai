import { PromptType } from '@prisma/client';

/**
 * Parameters required to persist a rendered AI prompt.
 */
export type SavePromptParams = {
  readonly collectionJobId?: string | null;
  readonly ideaId?: string | null;
  readonly promptType: PromptType;
  readonly promptText: string;
  readonly templateHash?: string | null;
  readonly estimatedInputTokens?: number | null;
};