/**
 * Minimal device information required for push delivery.
 */
export interface ActivePushDevice {
    id: string;
    fcmToken: string;
}