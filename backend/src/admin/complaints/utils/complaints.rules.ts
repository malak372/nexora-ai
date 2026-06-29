import { ComplaintStatus } from '@prisma/client';

/**
 * Determines the resolvedAt timestamp for a complaint update.
 *
 * Rules:
 * - If the complaint changes to RESOLVED for the first time,
 *   resolvedAt is set to the current date.
 * - If the complaint is already resolved, the existing resolvedAt is preserved.
 * - If the status changes to a non-resolved status, the existing value is preserved.
 *
 * @author Malak
 */
export function buildResolvedAt(
  newStatus?: ComplaintStatus,
  oldStatus?: ComplaintStatus,
  currentValue?: Date | null,
): Date | null | undefined {
  if (
    newStatus === ComplaintStatus.RESOLVED &&
    oldStatus !== ComplaintStatus.RESOLVED
  ) {
    return new Date();
  }

  return currentValue;
}