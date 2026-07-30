/**
 * Input required to send a push notification to one user.
 */
export interface SendPushNotificationInput {
  userId: string;
  title: string;
  body: string;
  data?: Readonly<Record<string, string>>;
  imageUrl?: string;
}
