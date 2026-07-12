import { AlertType } from '@prisma/client';

/**
 * Input required to create one internal in-app alert.
 *
 * Used by business modules such as:
 * - Ideas.
 * - Payments.
 * - Credits.
 * - Authentication.
 *
 * @author Malak
 */
export type CreateSystemAlertInput = {
  /**
   * User who receives the alert.
   */
  readonly userId: string;

  /**
   * Alert title.
   */
  readonly title: string;

  /**
   * Alert message.
   */
  readonly message: string;

  /**
   * Alert category.
   */
  readonly type: AlertType;
};
