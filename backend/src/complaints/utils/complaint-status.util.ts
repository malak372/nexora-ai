import { ComplaintStatus } from '@prisma/client';

/**
 * Resolves the complaint resolvedAt value during a status update.
 *
 * Rules:
 * - Preserves the current value when no new status is supplied.
 * - Sets the current date when the complaint changes to RESOLVED.
 * - Preserves the existing date when it remains RESOLVED.
 * - Clears the date when a resolved complaint is reopened.
 *
 * @param newStatus Optional new complaint status.
 * @param previousStatus Current persisted complaint status.
 * @param currentResolvedAt Current resolution timestamp.
 * @returns The resolution timestamp that should be persisted.
 *
 * @author Malak
 */
export function resolveComplaintResolvedAt(
  newStatus: ComplaintStatus | undefined,
  previousStatus: ComplaintStatus,
  currentResolvedAt: Date | null,
): Date | null {
  if (newStatus === undefined) {
    return currentResolvedAt;
  }

  if (
    newStatus === ComplaintStatus.RESOLVED &&
    previousStatus !== ComplaintStatus.RESOLVED
  ) {
    return new Date();
  }

  if (
    previousStatus === ComplaintStatus.RESOLVED &&
    newStatus !== ComplaintStatus.RESOLVED
  ) {
    return null;
  }

  return currentResolvedAt;
}
