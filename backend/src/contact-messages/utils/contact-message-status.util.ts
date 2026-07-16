import { ContactMessageStatus } from '@prisma/client';

/**
 * Determines whether a Contact Us message is considered replied.
 *
 * A message is considered replied when:
 * - Its persisted status is REPLIED.
 * - Or it contains a non-empty administrator reply.
 *
 * @param status Current message status.
 * @param adminReply Current administrator reply.
 */
export function isContactMessageReplied(
  status: ContactMessageStatus,
  adminReply: string | null,
): boolean {
  return (
    status === ContactMessageStatus.REPLIED ||
    Boolean(adminReply?.trim())
  );
}

/**
 * Resolves the final status during an administrator update.
 *
 * Rules:
 * - An explicitly supplied status has the highest priority.
 * - A new administrator reply without an explicit status changes
 *   the status to REPLIED.
 * - Otherwise, the existing status remains unchanged.
 *
 * @param currentStatus Current persisted status.
 * @param newStatus Optional explicitly requested status.
 * @param adminReply Optional normalized administrator reply.
 * @returns Status that should be persisted.
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

