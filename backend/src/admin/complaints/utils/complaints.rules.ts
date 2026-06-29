import { ComplaintStatus } from '@prisma/client';

/**
 * Returns resolvedAt value if status is RESOLVED.
 *
 * Used to keep business logic consistent across services.
 *
 * @param status Complaint status
 * @param currentValue existing resolvedAt value
 */
export function buildResolvedAt(
  newStatus?: ComplaintStatus,
  oldStatus?: ComplaintStatus,
  currentValue?: Date | null,
) {
  if (
    newStatus === ComplaintStatus.RESOLVED &&
    oldStatus !== ComplaintStatus.RESOLVED
  ) {
    return new Date();
  }

  return currentValue;
}