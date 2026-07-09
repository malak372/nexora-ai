import { ContactMessageStatus } from '@prisma/client';

/**
 * Determines whether a contact message should be considered replied.
 *
 * Rules:
 * - A contact message is considered replied if its status is REPLIED.
 * - A contact message is also considered replied if an admin reply exists.
 *
 * This helper is useful for summary statistics, admin dashboards,
 * and business rules related to contact message handling.
 *
 * @author Malak
 */
export function isContactMessageReplied(
  status?: ContactMessageStatus,
  adminReply?: string | null,
): boolean {
  return (
    status === ContactMessageStatus.REPLIED ||
    Boolean(adminReply?.trim())
  );
}

/**
 * Resolves the final contact message status during an admin update.
 *
 * Rules:
 * - If the admin explicitly sends a status, that status is used.
 * - If the admin adds an admin reply without sending a status,
 *   the status becomes REPLIED automatically.
 * - Otherwise, the current status is preserved.
 *
 * @author Malak
 */
export function buildContactMessageStatus(
  currentStatus: ContactMessageStatus,
  newStatus?: ContactMessageStatus,
  adminReply?: string,
): ContactMessageStatus {
  if (newStatus) {
    return newStatus;
  }

  if (adminReply?.trim()) {
    return ContactMessageStatus.REPLIED;
  }

  return currentStatus;
}