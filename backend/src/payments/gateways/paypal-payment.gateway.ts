import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentProvider, PaymentStatus } from '@prisma/client';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import type { CapturePaymentInput } from '../types/capture-payment-input.type';
import type { CreatePaymentSessionInput } from '../types/create-payment-session.type';
import type { PaymentConfirmation } from '../types/payment-confirmation.type';
import type { PaymentSessionResult } from '../types/payment-session-result.type';
import type { PaymentWebhookInput } from '../types/payment-webhook-input.type';

import type { PaymentCaptureGateway } from './payment-capture-gateway.interface';
import type { PaymentGateway } from './payment-gateway.interface';

type PayPalEnvironment = 'sandbox' | 'live';

type PayPalAccessTokenResponse = {
  readonly access_token: string;
  readonly expires_in: number;
  readonly token_type: string;
};

type PayPalLink = {
  readonly href: string;
  readonly rel: string;
  readonly method?: string;
};

type PayPalAmount = {
  readonly currency_code: string;
  readonly value: string;
};

type PayPalCapture = {
  readonly id: string;
  readonly status: string;
  readonly amount: PayPalAmount;
  readonly custom_id?: string;
  readonly invoice_id?: string;
  readonly create_time?: string;
  readonly update_time?: string;
  readonly supplementary_data?: {
    readonly related_ids?: {
      readonly order_id?: string;
    };
  };
};

type PayPalPurchaseUnit = {
  readonly custom_id?: string;
  readonly invoice_id?: string;
  readonly amount?: PayPalAmount;
  readonly payments?: {
    readonly captures?: readonly PayPalCapture[];
  };
};

type PayPalOrderResponse = {
  readonly id: string;
  readonly status: string;
  readonly links?: readonly PayPalLink[];
  readonly purchase_units?: readonly PayPalPurchaseUnit[];
  readonly create_time?: string;
  readonly update_time?: string;
};

type PayPalWebhookEvent = {
  readonly id: string;
  readonly event_type: string;
  readonly create_time?: string;
  readonly resource: unknown;
};

type PayPalWebhookVerificationResponse = {
  readonly verification_status: string;
};

/**
 * PayPal payment-gateway implementation.
 *
 * Responsibilities:
 * - Obtain and cache PayPal OAuth access tokens.
 * - Create PayPal Orders.
 * - Return the buyer approval URL.
 * - Capture buyer-approved PayPal Orders.
 * - Verify PayPal webhook signatures through PayPal's API.
 * - Normalize PayPal responses into internal payment contracts.
 *
 * This gateway never:
 * - Adds credits.
 * - Unlocks ideas.
 * - Updates internal Payment records directly.
 *
 * Payment fulfillment remains owned by PaymentProcessingService.
 *
 * @author Eman
 */
@Injectable()
export class PayPalPaymentGateway
  implements PaymentGateway, PaymentCaptureGateway
{
  readonly provider = PaymentProvider.PAYPAL;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookId: string;
  private readonly baseUrl: string;

  private cachedAccessToken?: {
    readonly value: string;
    readonly expiresAt: number;
  };

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.getRequiredConfiguration('PAYPAL_CLIENT_ID');

    this.clientSecret = this.getRequiredConfiguration('PAYPAL_CLIENT_SECRET');

    this.webhookId = this.getRequiredConfiguration('PAYPAL_WEBHOOK_ID');

    const environment =
      this.configService
        .get<string>('PAYPAL_ENVIRONMENT')
        ?.trim()
        .toLowerCase() ?? 'sandbox';

    if (environment !== 'sandbox' && environment !== 'live') {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'PAYPAL_ENVIRONMENT must be either sandbox or live.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    this.baseUrl = this.resolveBaseUrl(environment);
  }

  /**
   * Creates a PayPal Order and returns its approval URL.
   */
  async createPaymentSession(
    input: CreatePaymentSessionInput,
  ): Promise<PaymentSessionResult> {
    const accessToken = await this.getAccessToken();

    const response = await this.paypalRequest(
      '/v2/checkout/orders',
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${accessToken}`,

          'Content-Type': 'application/json',

          'PayPal-Request-Id': input.paymentId,
        },

        body: JSON.stringify({
          intent: 'CAPTURE',

          purchase_units: [
            {
              reference_id: input.paymentId,

              custom_id: input.paymentId,

              invoice_id: input.paymentId,

              description: this.buildDescription(input),

              amount: {
                currency_code: input.currency.trim().toUpperCase(),

                value: input.amount,
              },
            },
          ],

          payment_source: {
            paypal: {
              experience_context: {
                user_action: 'PAY_NOW',

                return_url: input.successUrl,

                cancel_url: input.cancelUrl,
              },
            },
          },
        }),
      },
      PaymentErrorCode.PAYMENT_SESSION_CREATION_FAILED,
      'PayPal could not create the payment order.',
    );

    const order = this.parsePayPalOrder(response);

    const approvalUrl = order.links?.find(
      (link) => link.rel === 'payer-action' || link.rel === 'approve',
    )?.href;

    if (!order.id.trim() || !approvalUrl?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'PayPal returned an incomplete order response.',
        {
          details: {
            paymentId: input.paymentId,

            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    this.validateHttpUrl(approvalUrl, input.paymentId);

    return {
      provider: PaymentProvider.PAYPAL,

      providerSessionId: order.id,

      checkoutUrl: approvalUrl,
    };
  }

  /**
   * Captures one buyer-approved PayPal Order.
   */
  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<PaymentConfirmation> {
    const accessToken = await this.getAccessToken();

    const response = await this.paypalRequest(
      `/v2/checkout/orders/${encodeURIComponent(
        input.providerSessionId,
      )}/capture`,
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${accessToken}`,

          'Content-Type': 'application/json',

          'PayPal-Request-Id': `capture-${input.paymentId}`,
        },

        body: '{}',
      },
      PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
      'PayPal could not capture the approved order.',
    );

    const order = this.parsePayPalOrder(response);

    const capture = this.getFirstCapture(order);

    const paymentId = this.getPaymentReference(
      capture.custom_id,
      capture.invoice_id,
      order.purchase_units?.[0]?.custom_id,
      order.purchase_units?.[0]?.invoice_id,
    );

    if (paymentId !== input.paymentId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_REFERENCE_MISSING,
        'The captured PayPal order does not match the internal payment.',
        {
          details: {
            expectedPaymentId: input.paymentId,

            confirmedPaymentId: paymentId,

            providerSessionId: input.providerSessionId,
          },
        },
      );
    }

    return this.buildConfirmation({
      paymentId,

      capture,

      providerSessionId: order.id,

      providerEventId: undefined,

      occurredAt: this.parseDate(
        capture.update_time ?? order.update_time ?? order.create_time,
      ),

      metadata: {
        paymentId,
      },
    });
  }

  /**
   * Verifies and normalizes one PayPal webhook event.
   */
  async verifyWebhook(
    input: PaymentWebhookInput,
  ): Promise<PaymentConfirmation> {
    const event = this.parseWebhookEvent(input.payload);

    const transmissionId = this.requireHeader(
      input.headers,
      'paypal-transmission-id',
    );

    const transmissionTime = this.requireHeader(
      input.headers,
      'paypal-transmission-time',
    );

    const transmissionSignature = this.requireHeader(
      input.headers,
      'paypal-transmission-sig',
    );

    const certificateUrl = this.requireHeader(input.headers, 'paypal-cert-url');

    const authenticationAlgorithm = this.requireHeader(
      input.headers,
      'paypal-auth-algo',
    );

    const accessToken = await this.getAccessToken();

    const verificationResponse = await this.paypalRequest(
      '/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${accessToken}`,

          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          transmission_id: transmissionId,

          transmission_time: transmissionTime,

          cert_url: certificateUrl,

          auth_algo: authenticationAlgorithm,

          transmission_sig: transmissionSignature,

          webhook_id: this.webhookId,

          webhook_event: event,
        }),
      },
      PaymentErrorCode.PAYMENT_WEBHOOK_VERIFICATION_FAILED,
      'The PayPal webhook signature could not be verified.',
    );

    const verification =
      this.parseWebhookVerificationResponse(verificationResponse);

    if (verification.verification_status !== 'SUCCESS') {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_WEBHOOK_VERIFICATION_FAILED,
        'PayPal rejected the webhook signature.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,

            providerEventId: event.id,
          },
        },
      );
    }

    return this.normalizeWebhookEvent(event);
  }

  /**
   * Converts supported PayPal webhook events into
   * the internal PaymentConfirmation contract.
   */
  private normalizeWebhookEvent(
    event: PayPalWebhookEvent,
  ): PaymentConfirmation {
    const capture = this.parsePayPalCapture(event.resource);

    const paymentId = this.getPaymentReference(
      capture.custom_id,
      capture.invoice_id,
    );

    const providerSessionId = capture.supplementary_data?.related_ids?.order_id;

    if (!providerSessionId?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
        'The PayPal webhook does not contain the related Order ID.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,

            providerEventId: event.id,
          },
        },
      );
    }

    const supportedEvents = [
      'PAYMENT.CAPTURE.COMPLETED',
      'PAYMENT.CAPTURE.DENIED',
      'PAYMENT.CAPTURE.DECLINED',
    ] as const;

    if (
      !supportedEvents.includes(
        event.event_type as (typeof supportedEvents)[number],
      )
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
        'The PayPal webhook event type is not supported.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,

            providerEventId: event.id,

            eventType: event.event_type,
          },
        },
      );
    }

    const status =
      event.event_type === 'PAYMENT.CAPTURE.COMPLETED'
        ? PaymentStatus.SUCCESS
        : PaymentStatus.FAILED;

    return {
      provider: PaymentProvider.PAYPAL,

      paymentId,

      providerPaymentId: capture.id,

      providerSessionId: providerSessionId.trim(),

      status,

      amount: capture.amount.value,

      currency: capture.amount.currency_code.trim().toUpperCase(),

      providerEventId: event.id,

      ...(status === PaymentStatus.FAILED
        ? {
            failureReason: 'PayPal reported that the payment capture failed.',
          }
        : {}),

      occurredAt: this.parseDate(
        event.create_time ?? capture.update_time ?? capture.create_time,
      ),

      metadata: {
        paymentId,
      },
    };
  }

  /**
   * Builds a normalized confirmation from a capture response.
   */
  private buildConfirmation(input: {
    readonly paymentId: string;
    readonly capture: PayPalCapture;
    readonly providerSessionId: string;
    readonly providerEventId?: string;
    readonly occurredAt: Date;
    readonly metadata: Readonly<Record<string, string>>;
  }): PaymentConfirmation {
    const status = this.mapCaptureStatus(input.capture.status);

    return {
      provider: PaymentProvider.PAYPAL,

      paymentId: input.paymentId,

      providerPaymentId: input.capture.id,

      providerSessionId: input.providerSessionId,

      status,

      amount: input.capture.amount.value,

      currency: input.capture.amount.currency_code.trim().toUpperCase(),

      ...(input.providerEventId
        ? {
            providerEventId: input.providerEventId,
          }
        : {}),

      ...(status === PaymentStatus.FAILED
        ? {
            failureReason: 'PayPal payment capture failed.',
          }
        : {}),

      occurredAt: input.occurredAt,

      metadata: input.metadata,
    };
  }

  /**
   * Gets a valid OAuth access token.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (
      this.cachedAccessToken &&
      this.cachedAccessToken.expiresAt > now + 60_000
    ) {
      return this.cachedAccessToken.value;
    }

    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');

    const response = await this.paypalRequest(
      '/v1/oauth2/token',
      {
        method: 'POST',

        headers: {
          Authorization: `Basic ${credentials}`,

          'Content-Type': 'application/x-www-form-urlencoded',
        },

        body: 'grant_type=client_credentials',
      },
      PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
      'PayPal authentication failed.',
    );

    const tokenResponse = this.parseAccessTokenResponse(response);

    this.cachedAccessToken = {
      value: tokenResponse.access_token,

      expiresAt: now + tokenResponse.expires_in * 1_000,
    };

    return tokenResponse.access_token;
  }

  /**
   * Executes one PayPal REST request.
   */
  private async paypalRequest(
    path: string,
    init: RequestInit,
    errorCode: PaymentErrorCode,
    message: string,
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new PaymentProcessingError(errorCode, message, {
        cause: error,

        details: {
          provider: PaymentProvider.PAYPAL,
        },
      });
    }

    const payload = await this.parseJsonResponse(response);

    if (!response.ok) {
      throw new PaymentProcessingError(errorCode, message, {
        details: {
          provider: PaymentProvider.PAYPAL,

          statusCode: response.status,

          providerError: this.getSafeProviderError(payload),
        },
      });
    }

    return payload;
  }

  /**
   * Maps PayPal capture status to the internal status.
   */
  private mapCaptureStatus(status: string): PaymentStatus {
    switch (status.trim().toUpperCase()) {
      case 'COMPLETED':
        return PaymentStatus.SUCCESS;

      case 'DECLINED':
      case 'DENIED':
      case 'FAILED':
        return PaymentStatus.FAILED;

      case 'PENDING':
        return PaymentStatus.PENDING;

      default:
        throw new PaymentProcessingError(
          PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
          'PayPal returned an unsupported capture status.',
          {
            details: {
              provider: PaymentProvider.PAYPAL,

              captureStatus: status,
            },
          },
        );
    }
  }

  /**
   * Returns the first capture from a PayPal Order.
   */
  private getFirstCapture(order: PayPalOrderResponse): PayPalCapture {
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];

    if (!capture) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'The PayPal capture response does not contain a capture.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,

            providerSessionId: order.id,
          },
        },
      );
    }

    return capture;
  }

  /**
   * Extracts the internal payment ID.
   */
  private getPaymentReference(
    ...references: readonly (string | undefined)[]
  ): string {
    const reference = references.find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );

    if (!reference) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_REFERENCE_MISSING,
        'PayPal did not return the internal payment reference.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return reference.trim();
  }

  /**
   * Reads one required webhook header.
   */
  private requireHeader(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    name: string,
  ): string {
    const entry = Object.entries(headers).find(
      ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
    );

    const rawValue = entry?.[1];

    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

    if (!value?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_WEBHOOK_VERIFICATION_FAILED,
        `The required PayPal webhook header ${name} is missing.`,
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return value.trim();
  }

  /**
   * Returns a required configuration value.
   */
  private getRequiredConfiguration(name: string): string {
    const value = this.configService.get<string>(name);

    if (!value?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        `PayPal is not configured because ${name} is missing.`,
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return value.trim();
  }

  /**
   * Resolves the official PayPal API URL.
   */
  private resolveBaseUrl(environment: PayPalEnvironment): string {
    return environment === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  /**
   * Builds the checkout description.
   */
  private buildDescription(input: CreatePaymentSessionInput): string {
    return input.creditsQuantity
      ? `${input.creditsQuantity} Nexora AI generation credit(s).`
      : 'Unlock advanced features for one Nexora AI idea.';
  }

  /**
   * Validates one HTTP redirect URL.
   */
  private validateHttpUrl(value: string, paymentId: string): void {
    let url: URL;

    try {
      url = new URL(value);
    } catch (error) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'PayPal returned an invalid approval URL.',
        {
          cause: error,

          details: {
            paymentId,

            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'PayPal returned an unsupported approval URL.',
        {
          details: {
            paymentId,

            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private parseAccessTokenResponse(value: unknown): PayPalAccessTokenResponse {
    if (
      !this.isRecord(value) ||
      typeof value.access_token !== 'string' ||
      typeof value.expires_in !== 'number' ||
      typeof value.token_type !== 'string'
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'PayPal returned an invalid OAuth token response.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return {
      access_token: value.access_token,

      expires_in: value.expires_in,

      token_type: value.token_type,
    };
  }

  private parsePayPalOrder(value: unknown): PayPalOrderResponse {
    if (
      !this.isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.status !== 'string'
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'PayPal returned an invalid order response.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return value as PayPalOrderResponse;
  }

  private parsePayPalCapture(value: unknown): PayPalCapture {
    if (
      !this.isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.status !== 'string' ||
      !this.isRecord(value.amount) ||
      typeof value.amount.value !== 'string' ||
      typeof value.amount.currency_code !== 'string'
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
        'PayPal returned an invalid capture resource.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return value as PayPalCapture;
  }

  private parseWebhookEvent(value: unknown): PayPalWebhookEvent {
    if (
      !this.isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.event_type !== 'string' ||
      !('resource' in value)
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
        'The PayPal webhook payload is invalid.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return value as PayPalWebhookEvent;
  }

  private parseWebhookVerificationResponse(
    value: unknown,
  ): PayPalWebhookVerificationResponse {
    if (
      !this.isRecord(value) ||
      typeof value.verification_status !== 'string'
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_WEBHOOK_VERIFICATION_FAILED,
        'PayPal returned an invalid webhook-verification response.',
        {
          details: {
            provider: PaymentProvider.PAYPAL,
          },
        },
      );
    }

    return {
      verification_status: value.verification_status,
    };
  }

  private parseDate(value?: string): Date {
    const date = value ? new Date(value) : new Date();

    if (Number.isNaN(date.getTime())) {
      return new Date();
    }

    return date;
  }

  private getSafeProviderError(
    value: unknown,
  ): Readonly<Record<string, unknown>> | null {
    if (!this.isRecord(value)) {
      return null;
    }

    return {
      ...(typeof value.name === 'string'
        ? {
            name: value.name,
          }
        : {}),

      ...(typeof value.message === 'string'
        ? {
            message: value.message,
          }
        : {}),

      ...(typeof value.debug_id === 'string'
        ? {
            debugId: value.debug_id,
          }
        : {}),
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
