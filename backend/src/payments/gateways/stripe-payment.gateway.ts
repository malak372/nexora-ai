import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentProvider, PaymentPurpose, PaymentStatus } from '@prisma/client';

import Stripe from 'stripe';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import type { CreatePaymentSessionInput } from '../types/create-payment-session.type';
import type { PaymentConfirmation } from '../types/payment-confirmation.type';
import type { PaymentSessionResult } from '../types/payment-session-result.type';
import type { PaymentWebhookInput } from '../types/payment-webhook-input.type';

import type { PaymentGateway } from './payment-gateway.interface';

/**
 * Stripe payment-gateway implementation.
 *
 * Responsibilities:
 * - Create Stripe-hosted checkout sessions.
 * - Attach safe internal payment metadata.
 * - Verify Stripe webhook signatures using the raw request body.
 * - Normalize supported Stripe events into internal payment contracts.
 *
 * This gateway does not:
 * - Create internal Payment records.
 * - Mark payments as successful directly.
 * - Add credits.
 * - Unlock ideas.
 *
 * Internal payment fulfillment remains owned by
 * PaymentProcessingService.
 *
 * @author Eman
 */
@Injectable()
export class StripePaymentGateway implements PaymentGateway {
  readonly provider = PaymentProvider.STRIPE;

  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');

    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!secretKey?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'Stripe is not configured because STRIPE_SECRET_KEY is missing.',
        {
          details: {
            provider: PaymentProvider.STRIPE,
          },
        },
      );
    }

    if (!webhookSecret?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'Stripe is not configured because STRIPE_WEBHOOK_SECRET is missing.',
        {
          details: {
            provider: PaymentProvider.STRIPE,
          },
        },
      );
    }

    this.stripe = new Stripe(secretKey.trim());

    this.webhookSecret = webhookSecret.trim();
  }

  /**
   * Creates a Stripe-hosted checkout session.
   *
   * Creating the session does not prove that payment succeeded.
   * Payment fulfillment occurs only after a verified Stripe webhook.
   */
  async createPaymentSession(
    input: CreatePaymentSessionInput,
  ): Promise<PaymentSessionResult> {
    const amountInMinorUnits = this.toMinorCurrencyUnits(input.amount);

    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',

        client_reference_id: input.paymentId,

        success_url: input.successUrl,

        cancel_url: input.cancelUrl,

        line_items: [
          {
            quantity: 1,

            price_data: {
              currency: input.currency.toLowerCase(),

              unit_amount: amountInMinorUnits,

              product_data: {
                name: this.getProductName(input.paymentPurpose),

                description: this.getProductDescription(input),
              },
            },
          },
        ],

        metadata: {
          ...input.metadata,
        },

        payment_intent_data: {
          metadata: {
            ...input.metadata,
          },
        },
      });

      if (!session.id?.trim() || !session.url?.trim()) {
        throw new PaymentProcessingError(
          PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
          'Stripe returned an incomplete checkout-session response.',
          {
            details: {
              paymentId: input.paymentId,

              provider: PaymentProvider.STRIPE,
            },
          },
        );
      }

      return {
        provider: PaymentProvider.STRIPE,

        providerSessionId: session.id,

        checkoutUrl: session.url,

        expiresAt: session.expires_at
          ? new Date(session.expires_at * 1_000)
          : undefined,
      };
    } catch (error) {
      if (error instanceof PaymentProcessingError) {
        throw error;
      }

      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_SESSION_CREATION_FAILED,
        'Stripe could not create the checkout session.',
        {
          cause: error,

          details: {
            paymentId: input.paymentId,

            provider: PaymentProvider.STRIPE,
          },
        },
      );
    }
  }

  /**
   * Verifies and normalizes a Stripe webhook.
   *
   * Stripe signature verification requires:
   * - The exact raw request body.
   * - The Stripe-Signature header.
   * - The configured endpoint secret.
   */
  verifyWebhook(input: PaymentWebhookInput): Promise<PaymentConfirmation> {
    const rawBody = input.rawBody;

    if (!rawBody) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_WEBHOOK_VERIFICATION_FAILED,
        'The raw Stripe webhook body is missing.',
        {
          details: {
            provider: PaymentProvider.STRIPE,
          },
        },
      );
    }

    const signature = this.getHeaderValue(input.headers, 'stripe-signature');

    if (!signature) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_WEBHOOK_VERIFICATION_FAILED,
        'The Stripe webhook signature is missing.',
        {
          details: {
            provider: PaymentProvider.STRIPE,
          },
        },
      );
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (error) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_WEBHOOK_VERIFICATION_FAILED,
        'The Stripe webhook signature could not be verified.',
        {
          cause: error,
          details: {
            provider: PaymentProvider.STRIPE,
          },
        },
      );
    }

    return Promise.resolve(this.normalizeEvent(event));
  }

  /**
   * Converts a verified Stripe event into the internal
   * PaymentConfirmation contract.
   */
  private normalizeEvent(event: Stripe.Event): PaymentConfirmation {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return this.normalizeSuccessfulSession(event);

      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return this.normalizeFailedSession(event);

      default:
        throw new PaymentProcessingError(
          PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
          'The Stripe webhook event type is not supported by this payment workflow.',
          {
            details: {
              provider: PaymentProvider.STRIPE,

              eventType: event.type,

              providerEventId: event.id,
            },
          },
        );
    }
  }

  /**
   * Normalizes a successful Stripe Checkout Session event.
   */
  private normalizeSuccessfulSession(event: Stripe.Event): PaymentConfirmation {
    const session = event.data.object as Stripe.Checkout.Session;

    const paymentId = this.getInternalPaymentId(session);

    if (
      event.type === 'checkout.session.completed' &&
      session.payment_status !== 'paid' &&
      session.payment_status !== 'no_payment_required'
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
        'The completed Stripe checkout session is not marked as paid.',
        {
          details: {
            provider: PaymentProvider.STRIPE,

            providerEventId: event.id,

            providerSessionId: session.id,

            paymentStatus: session.payment_status,
          },
        },
      );
    }

    return {
      provider: PaymentProvider.STRIPE,

      paymentId,

      providerPaymentId: this.getProviderPaymentId(session),

      providerSessionId: session.id,

      status: PaymentStatus.SUCCESS,

      amount: this.getSessionAmount(session),

      currency: this.getSessionCurrency(session),

      providerEventId: event.id,

      occurredAt: new Date(event.created * 1_000),

      metadata: this.normalizeMetadata(session.metadata),
    };
  }

  /**
   * Normalizes a failed or expired Stripe Checkout Session event.
   */
  private normalizeFailedSession(event: Stripe.Event): PaymentConfirmation {
    const session = event.data.object as Stripe.Checkout.Session;

    return {
      provider: PaymentProvider.STRIPE,

      paymentId: this.getInternalPaymentId(session),

      providerPaymentId: this.getProviderPaymentId(session),

      providerSessionId: session.id,

      status: PaymentStatus.FAILED,

      amount: this.getSessionAmount(session),

      currency: this.getSessionCurrency(session),

      providerEventId: event.id,

      failureReason:
        event.type === 'checkout.session.expired'
          ? 'Stripe checkout session expired before payment completion.'
          : 'Stripe reported that the asynchronous payment failed.',

      occurredAt: new Date(event.created * 1_000),

      metadata: this.normalizeMetadata(session.metadata),
    };
  }

  /**
   * Extracts the internal Nexora AI payment ID from Stripe metadata.
   */
  private getInternalPaymentId(session: Stripe.Checkout.Session): string {
    const paymentId =
      session.metadata?.paymentId ?? session.client_reference_id;

    if (!paymentId?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_REFERENCE_MISSING,
        'The Stripe session does not contain the internal payment reference.',
        {
          details: {
            provider: PaymentProvider.STRIPE,

            providerSessionId: session.id,
          },
        },
      );
    }

    return paymentId.trim();
  }

  /**
   * Returns Stripe's PaymentIntent ID when available.
   *
   * Some failed or expired checkout sessions do not yet have
   * a PaymentIntent, so the unique Checkout Session ID is used
   * as the external payment reference in that case.
   */
  private getProviderPaymentId(session: Stripe.Checkout.Session): string {
    if (typeof session.payment_intent === 'string') {
      return session.payment_intent;
    }

    if (session.payment_intent && typeof session.payment_intent === 'object') {
      return session.payment_intent.id;
    }

    return session.id;
  }

  /**
   * Returns the normalized session amount in major currency units.
   */
  private getSessionAmount(session: Stripe.Checkout.Session): string {
    if (session.amount_total === null || session.amount_total === undefined) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
        'The Stripe checkout session does not contain a valid amount.',
        {
          details: {
            provider: PaymentProvider.STRIPE,

            providerSessionId: session.id,
          },
        },
      );
    }

    return (session.amount_total / 100).toFixed(2);
  }

  /**
   * Returns the normalized uppercase currency.
   */
  private getSessionCurrency(session: Stripe.Checkout.Session): string {
    if (!session.currency?.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
        'The Stripe checkout session does not contain a currency.',
        {
          details: {
            provider: PaymentProvider.STRIPE,

            providerSessionId: session.id,
          },
        },
      );
    }

    return session.currency.trim().toUpperCase();
  }

  /**
   * Converts provider metadata into a safe string record.
   */
  private normalizeMetadata(
    metadata: Stripe.Metadata | null,
  ): Readonly<Record<string, string>> {
    if (!metadata) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(metadata).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }

  /**
   * Converts a decimal major-unit amount into Stripe minor units.
   *
   * Example:
   * 10.00 USD -> 1000 cents.
   *
   * Nexora AI currently uses USD, which has two decimal places.
   */
  private toMinorCurrencyUnits(amount: string): number {
    const normalizedAmount = Number(amount);

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_AMOUNT,
        'The Stripe checkout amount must be greater than zero.',
        {
          details: {
            amount,
          },
        },
      );
    }

    const minorUnits = Math.round(normalizedAmount * 100);

    if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_AMOUNT,
        'The Stripe checkout amount could not be converted safely.',
        {
          details: {
            amount,
          },
        },
      );
    }

    return minorUnits;
  }

  /**
   * Returns the product title shown on Stripe Checkout.
   */
  private getProductName(purpose: PaymentPurpose): string {
    switch (purpose) {
      case PaymentPurpose.BUY_CREDITS:
        return 'Nexora AI Credits';

      case PaymentPurpose.DIRECT_UNLOCK:
        return 'Nexora AI Idea Unlock';

      default:
        throw new PaymentProcessingError(
          PaymentErrorCode.INVALID_PAYMENT_PURPOSE,
          'The Stripe payment purpose is not supported.',
          {
            details: {
              paymentPurpose: purpose,
            },
          },
        );
    }
  }

  /**
   * Returns a safe product description for Stripe Checkout.
   */
  private getProductDescription(input: CreatePaymentSessionInput): string {
    if (input.paymentPurpose === PaymentPurpose.BUY_CREDITS) {
      return `${input.creditsQuantity ?? 0} premium idea-generation credit(s).`;
    }

    return 'Unlock advanced features for one Nexora AI project idea.';
  }

  /**
   * Reads one HTTP header case-insensitively.
   */
  private getHeaderValue(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    name: string,
  ): string | undefined {
    const targetName = name.toLowerCase();

    const matchingEntry = Object.entries(headers).find(
      ([headerName]) => headerName.toLowerCase() === targetName,
    );

    const value = matchingEntry?.[1];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value;
  }
}
