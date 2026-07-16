import { AlertType } from '@prisma/client';

/**
 * Input required to create a single internal
 * in-app alert.
 *
 * This contract is shared by internal application
 * services such as:
 * - Authentication.
 * - Payments.
 * - Credits.
 * - Ideas.
 *
 * The alert is persisted through
 * SystemAlertsService.
 *
 * @author Malak
 */
export type CreateSystemAlertInput = Readonly<{
  /**
   * Recipient user identifier.
   */
  userId: string;

  /**
   * Alert title displayed to the user.
   */
  title: string;

  /**
   * Alert body displayed to the user.
   */
  message: string;

  /**
   * Alert category.
   */
  type: AlertType;
}>;
