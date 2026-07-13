import { ContactMessageStatus } from '@prisma/client';

/**
 * Determines whether a contact message is considered replied.
 *
 * A message is considered replied when:
 * - Its status is REPLIED.
 * - Or a non-empty administrator reply exists.
 *
 * @author Malak
 */
export function isContactMessageReplied(
  status: ContactMessageStatus,
  adminReply: string | null,
): boolean {
  return status === ContactMessageStatus.REPLIED || Boolean(adminReply?.trim());
}

/**
 * Resolves the final status during an administrator update.
 *
 * Rules:
 * - An explicitly supplied status has the highest priority.
 * - Adding an administrator reply without a status changes
 *   the message status to REPLIED.
 * - Otherwise, the existing status remains unchanged.
 *
 * @author Malak
 */
export function resolveContactMessageStatus(
  currentStatus: ContactMessageStatus,
  newStatus?: ContactMessageStatus,
  adminReply?: string,
): ContactMessageStatus {
  if (newStatus !== undefined) {
    return newStatus;
  }

  if (adminReply?.trim()) {
    return ContactMessageStatus.REPLIED;
  }

  return currentStatus;
}
