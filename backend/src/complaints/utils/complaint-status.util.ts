import { ComplaintStatus } from '@prisma/client';

/**
 * Resolves the complaint resolvedAt value during an update.
 *
 * Rules:
 * - Sets the current date when a complaint changes to RESOLVED
 *   for the first time.
 * - Preserves the existing value when already resolved.
 * - Preserves the existing value for non-resolved status changes.
 *
 * @author Malak
 */
export function resolveComplaintResolvedAt(
  newStatus: ComplaintStatus | undefined,
  previousStatus: ComplaintStatus,
  currentResolvedAt: Date | null,
): Date | null {
  if (
    newStatus === ComplaintStatus.RESOLVED &&
    previousStatus !== ComplaintStatus.RESOLVED
  ) {
    return new Date();
  }

  return currentResolvedAt;
}
