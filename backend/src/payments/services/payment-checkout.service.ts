import { Injectable } from '@nestjs/common';

import {
  IdeaGenerationType,
  PaymentMethod,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  DEFAULT_PAYMENT_CURRENCY,
  GLOBAL_SYSTEM_SETTINGS_KEY,
  PAYMENT_METADATA_KEYS,
} from '../constants/payment.constants';

import type { CreateDirectUnlockPaymentDto } from '../dto/create-direct-unlock-payment.dto';
import type { PurchaseCreditsDto } from '../dto/purchase-credits.dto';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import { PaymentGatewayFactory } from '../gateways/payment-gateway.factory';

import type { CreatePaymentSessionInput } from '../types/create-payment-session.type';
import type { PaymentSessionResult } from '../types/payment-session-result.type';

/**
 * Payment record required while creating an external checkout session.
 */
type PendingPayment = {
  readonly id: string;
  readonly userId: string;
  readonly ideaId: string | null;
  readonly amount: Prisma.Decimal;
  readonly currency: string;
  readonly paymentMethod: PaymentMethod;
  readonly provider: PaymentProvider;
  readonly paymentPurpose: PaymentPurpose;
  readonly creditsAmount: number;
  readonly bonusCreditsAmount: number;
};

/**
 * Result returned after creating a payment checkout session.
 *
 * Creating a checkout session does not mean that payment succeeded.
 * Final payment completion is established only through a verified
 * provider webhook.
 */
export type PaymentCheckoutResult = {
  readonly paymentId: string;
  readonly paymentPurpose: PaymentPurpose;
  readonly paymentMethod: PaymentMethod;
  readonly provider: PaymentProvider;
  readonly status: PaymentStatus;
  readonly amount: string;
  readonly currency: string;
  readonly checkoutUrl: string;
  readonly providerSessionId: string;
  readonly expiresAt?: Date;
};

/**
 * Creates internal payments and external provider checkout sessions.
 *
 * Responsibilities:
 * - Validate authenticated users.
 * - Load payment-related system settings.
 * - Calculate credit-purchase prices and bonus credits.
 * - Validate direct-unlock idea eligibility.
 * - Resolve the provider associated with a payment method.
 * - Create a PENDING internal payment before contacting the provider.
 * - Create an external checkout session.
 * - Store provider checkout identifiers.
 * - Mark checkout creation as failed when provider communication fails.
 *
 * This service does not:
 * - Treat client redirects as proof of payment.
 * - Mark payments as successful.
 * - Add purchased credits.
 * - Unlock ideas.
 *
 * Payment fulfillment occurs only after a verified webhook is processed
 * by PaymentProcessingService.
 *
 * @author Eman
 */
@Injectable()
export class PaymentCheckoutService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly paymentGatewayFactory: PaymentGatewayFactory,
  ) {}

  /**
   * Creates a checkout session for purchasing generation credits.
   */
  async createCreditPurchaseCheckout(
    userId: string,
    dto: PurchaseCreditsDto,
  ): Promise<PaymentCheckoutResult> {
    await this.ensureEligibleUser(userId);

    const settings = await this.getSystemSettings();

    this.validateCreditPrice(settings.creditPrice);

    this.validateBonusConfiguration(
      settings.bonusThreshold,
      settings.bonusCredits,
    );

    const provider = this.resolveProvider(dto.paymentMethod);

    const purchasedCredits = dto.creditsQuantity;

    const bonusCredits = this.calculateBonusCredits(
      purchasedCredits,
      settings.bonusThreshold,
      settings.bonusCredits,
    );

    const amount = settings.creditPrice.mul(purchasedCredits);

    if (amount.lte(0)) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_AMOUNT,
        'The calculated credit-purchase amount must be greater than zero.',
        {
          details: {
            creditsQuantity: purchasedCredits,
          },
        },
      );
    }

    const payment = await this.createPendingPayment({
      userId,
      ideaId: null,

      amount,
      currency: DEFAULT_PAYMENT_CURRENCY,

      paymentMethod: dto.paymentMethod,

      provider,

      paymentPurpose: PaymentPurpose.BUY_CREDITS,

      creditsAmount: purchasedCredits,

      bonusCreditsAmount: bonusCredits,

      creditPriceAtPurchase: settings.creditPrice,
    });

    return this.createExternalCheckout(payment, {
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      creditsQuantity: purchasedCredits,
    });
  }

  /**
   * Creates a checkout session for unlocking advanced features
   * of one existing NORMAL_FREE idea.
   */
  async createDirectUnlockCheckout(
    userId: string,
    dto: CreateDirectUnlockPaymentDto,
  ): Promise<PaymentCheckoutResult> {
    await this.ensureEligibleUser(userId);

    const [settings, idea, existingPendingPayment] = await Promise.all([
      this.getSystemSettings(),

      this.prisma.idea.findUnique({
        where: {
          id: dto.ideaId,
        },

        select: {
          id: true,
          userId: true,
          generationType: true,
          isUnlocked: true,
        },
      }),

      this.prisma.payment.findFirst({
        where: {
          userId,
          ideaId: dto.ideaId,

          paymentPurpose: PaymentPurpose.DIRECT_UNLOCK,

          status: PaymentStatus.PENDING,
        },

        select: {
          id: true,
        },
      }),
    ]);

    this.validateDirectUnlockPrice(settings.directUnlockPrice);

    if (!idea) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_FOUND,
        'The selected idea does not exist.',
        {
          details: {
            ideaId: dto.ideaId,
          },
        },
      );
    }

    if (idea.userId !== userId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ACCESS_DENIED,
        'The authenticated user does not own the selected idea.',
        {
          details: {
            ideaId: idea.id,
            userId,
          },
        },
      );
    }

    if (idea.isUnlocked) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ALREADY_UNLOCKED,
        'The selected idea has already been unlocked.',
        {
          details: {
            ideaId: idea.id,
          },
        },
      );
    }

    if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_ELIGIBLE_FOR_DIRECT_UNLOCK,
        'Only a registered user free idea can be unlocked through direct payment.',
        {
          details: {
            ideaId: idea.id,
            generationType: idea.generationType,
          },
        },
      );
    }

    /*
     * Prevent creating multiple active direct-unlock checkout
     * sessions for the same user and idea.
     */
    if (existingPendingPayment) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_SESSION_CREATION_FAILED,
        'A pending direct-unlock payment already exists for the selected idea.',
        {
          details: {
            ideaId: idea.id,
            paymentId: existingPendingPayment.id,
          },
        },
      );
    }

    const provider = this.resolveProvider(dto.paymentMethod);

    const payment = await this.createPendingPayment({
      userId,
      ideaId: idea.id,

      amount: settings.directUnlockPrice,

      currency: DEFAULT_PAYMENT_CURRENCY,

      paymentMethod: dto.paymentMethod,

      provider,

      paymentPurpose: PaymentPurpose.DIRECT_UNLOCK,

      creditsAmount: 0,
      bonusCreditsAmount: 0,

      creditPriceAtPurchase: null,
    });

    return this.createExternalCheckout(payment, {
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      ideaId: idea.id,
    });
  }

  /**
   * Creates the internal PENDING payment record.
   *
   * The internal payment must exist before communicating with
   * the external provider so the payment ID can be included in
   * provider metadata and later recovered from the webhook.
   */
  private createPendingPayment(input: {
    readonly userId: string;
    readonly ideaId: string | null;
    readonly amount: Prisma.Decimal;
    readonly currency: string;
    readonly paymentMethod: PaymentMethod;
    readonly provider: PaymentProvider;
    readonly paymentPurpose: PaymentPurpose;
    readonly creditsAmount: number;
    readonly bonusCreditsAmount: number;
    readonly creditPriceAtPurchase: Prisma.Decimal | null;
  }): Promise<PendingPayment> {
    return this.prisma.payment.create({
      data: {
        userId: input.userId,
        ideaId: input.ideaId,

        amount: input.amount,
        currency: input.currency,

        paymentMethod: input.paymentMethod,

        provider: input.provider,

        paymentPurpose: input.paymentPurpose,

        status: PaymentStatus.PENDING,

        creditsAmount: input.creditsAmount,

        bonusCreditsAmount: input.bonusCreditsAmount,

        creditPriceAtPurchase: input.creditPriceAtPurchase,
      },

      select: {
        id: true,
        userId: true,
        ideaId: true,
        amount: true,
        currency: true,
        paymentMethod: true,
        provider: true,
        paymentPurpose: true,
        creditsAmount: true,
        bonusCreditsAmount: true,
      },
    });
  }

  /**
   * Requests an external checkout session and stores its identifiers.
   */
  private async createExternalCheckout(
    payment: PendingPayment,
    options: {
      readonly successUrl: string;
      readonly cancelUrl: string;
      readonly ideaId?: string;
      readonly creditsQuantity?: number;
    },
  ): Promise<PaymentCheckoutResult> {
    const gateway = this.paymentGatewayFactory.getGateway(payment.provider);

    const sessionInput = this.buildPaymentSessionInput(payment, options);

    try {
      const session = await gateway.createPaymentSession(sessionInput);

      this.validateSessionResult(payment, session);

      await this.storeCheckoutSession(payment.id, session);

      return {
        paymentId: payment.id,

        paymentPurpose: payment.paymentPurpose,

        paymentMethod: payment.paymentMethod,

        provider: session.provider,

        status: PaymentStatus.PENDING,

        amount: payment.amount.toFixed(2),

        currency: payment.currency,

        checkoutUrl: session.checkoutUrl,

        providerSessionId: session.providerSessionId,

        ...(session.expiresAt
          ? {
              expiresAt: session.expiresAt,
            }
          : {}),
      };
    } catch (error) {
      await this.markCheckoutCreationFailed(payment.id);

      if (error instanceof PaymentProcessingError) {
        throw error;
      }

      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_SESSION_CREATION_FAILED,
        'The external payment provider could not create a checkout session.',
        {
          cause: error,

          details: {
            paymentId: payment.id,
            provider: payment.provider,
          },
        },
      );
    }
  }

  /**
   * Builds provider-independent checkout-session input.
   */
  private buildPaymentSessionInput(
    payment: PendingPayment,
    options: {
      readonly successUrl: string;
      readonly cancelUrl: string;
      readonly ideaId?: string;
      readonly creditsQuantity?: number;
    },
  ): CreatePaymentSessionInput {
    const metadata: Record<string, string> = {
      [PAYMENT_METADATA_KEYS.PAYMENT_ID]: payment.id,

      [PAYMENT_METADATA_KEYS.USER_ID]: payment.userId,

      [PAYMENT_METADATA_KEYS.PAYMENT_PURPOSE]: payment.paymentPurpose,
    };

    if (options.ideaId) {
      metadata[PAYMENT_METADATA_KEYS.IDEA_ID] = options.ideaId;
    }

    return {
      paymentId: payment.id,
      userId: payment.userId,

      paymentMethod: payment.paymentMethod,

      paymentPurpose: payment.paymentPurpose,

      amount: payment.amount.toFixed(2),

      currency: payment.currency,

      successUrl: options.successUrl,

      cancelUrl: options.cancelUrl,

      ...(options.ideaId
        ? {
            ideaId: options.ideaId,
          }
        : {}),

      ...(options.creditsQuantity !== undefined
        ? {
            creditsQuantity: options.creditsQuantity,
          }
        : {}),

      metadata,
    };
  }

  /**
   * Validates the normalized checkout-session response.
   */
  private validateSessionResult(
    payment: PendingPayment,
    session: PaymentSessionResult,
  ): void {
    if (session.provider !== payment.provider) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROVIDER_MISMATCH,
        'The checkout-session provider does not match the internal payment provider.',
        {
          details: {
            paymentId: payment.id,

            expectedProvider: payment.provider,

            returnedProvider: session.provider,
          },
        },
      );
    }

    if (!session.providerSessionId.trim() || !session.checkoutUrl.trim()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'The payment provider returned an incomplete checkout-session response.',
        {
          details: {
            paymentId: payment.id,
            provider: payment.provider,
          },
        },
      );
    }

    let checkoutUrl: URL;

    try {
      checkoutUrl = new URL(session.checkoutUrl);
    } catch (error) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'The payment provider returned an invalid checkout URL.',
        {
          cause: error,

          details: {
            paymentId: payment.id,
            provider: payment.provider,
          },
        },
      );
    }

    if (checkoutUrl.protocol !== 'https:' && checkoutUrl.protocol !== 'http:') {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'The payment provider returned an unsupported checkout URL.',
        {
          details: {
            paymentId: payment.id,
            provider: payment.provider,
          },
        },
      );
    }

    if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE,
        'The payment provider returned an expired checkout session.',
        {
          details: {
            paymentId: payment.id,
            provider: payment.provider,
          },
        },
      );
    }
  }

  /**
   * Stores external checkout-session identifiers.
   */
  private async storeCheckoutSession(
    paymentId: string,
    session: PaymentSessionResult,
  ): Promise<void> {
    try {
      const updateResult = await this.prisma.payment.updateMany({
        where: {
          id: paymentId,
          status: PaymentStatus.PENDING,

          providerSessionId: null,
        },

        data: {
          providerSessionId: session.providerSessionId,

          providerPaymentId: session.providerPaymentId ?? undefined,
        },
      });

      if (updateResult.count !== 1) {
        throw new PaymentProcessingError(
          PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
          'The checkout session could not be attached to the pending payment.',
          {
            details: {
              paymentId,
            },
          },
        );
      }
    } catch (error) {
      if (error instanceof PaymentProcessingError) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new PaymentProcessingError(
          PaymentErrorCode.DUPLICATE_PROVIDER_SESSION,
          'The external checkout-session identifier is already associated with another payment.',
          {
            cause: error,

            details: {
              paymentId,
            },
          },
        );
      }

      throw error;
    }
  }

  /**
   * Marks an internal payment as failed when external checkout
   * creation or persistence fails.
   *
   * This state does not indicate that the user attempted and failed
   * provider authorization; it indicates that checkout initialization
   * could not be completed.
   */
  private async markCheckoutCreationFailed(paymentId: string): Promise<void> {
    try {
      await this.prisma.payment.updateMany({
        where: {
          id: paymentId,
          status: PaymentStatus.PENDING,
        },

        data: {
          status: PaymentStatus.FAILED,

          failureReason: 'Payment checkout session creation failed.',

          failedAt: new Date(),
        },
      });
    } catch {
      /*
       * Preserve the original checkout error.
       *
       * Failure to update the diagnostic payment state must
       * not hide the original provider or session error.
       */
    }
  }

  /**
   * Ensures the authenticated account can initiate payments.
   */
  private async ensureEligibleUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        role: true,
        isActive: true,
        isVerified: true,
      },
    });

    if (!user) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'The authenticated user does not exist.',
        {
          details: {
            userId,
          },
        },
      );
    }

    if (user.role !== UserRole.USER) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'Only registered user accounts can initiate payments.',
        {
          details: {
            userId,
          },
        },
      );
    }

    if (!user.isActive) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'Inactive user accounts cannot initiate payments.',
        {
          details: {
            userId,
          },
        },
      );
    }

    if (!user.isVerified) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'The user must verify the account before initiating payments.',
        {
          details: {
            userId,
          },
        },
      );
    }
  }

  /**
   * Retrieves the single global system-settings row.
   */
  private async getSystemSettings() {
    const settings = await this.prisma.systemSetting.findUnique({
      where: {
        key: GLOBAL_SYSTEM_SETTINGS_KEY,
      },

      select: {
        creditPrice: true,
        directUnlockPrice: true,
        bonusThreshold: true,
        bonusCredits: true,
      },
    });

    if (!settings) {
      throw new PaymentProcessingError(
        PaymentErrorCode.SYSTEM_SETTINGS_NOT_FOUND,
        'The global payment settings could not be found.',
      );
    }

    return settings;
  }

  /**
   * Maps the user-facing payment method to its external provider.
   */
  private resolveProvider(method: PaymentMethod): PaymentProvider {
    switch (method) {
      case PaymentMethod.CARD:
        return PaymentProvider.STRIPE;

      case PaymentMethod.PAYPAL:
        return PaymentProvider.PAYPAL;

      default:
        throw new PaymentProcessingError(
          PaymentErrorCode.UNSUPPORTED_PAYMENT_METHOD,
          'The selected payment method is not supported.',
          {
            details: {
              paymentMethod: method,
            },
          },
        );
    }
  }

  /**
   * Calculates configured bonus credits.
   */
  private calculateBonusCredits(
    purchasedCredits: number,
    threshold: number,
    bonusCredits: number,
  ): number {
    if (threshold <= 0 || bonusCredits <= 0) {
      return 0;
    }

    return purchasedCredits >= threshold ? bonusCredits : 0;
  }

  /**
   * Validates the configured credit price.
   */
  private validateCreditPrice(creditPrice: Prisma.Decimal): void {
    if (creditPrice.lte(0)) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_CREDIT_PRICE,
        'The configured credit price must be greater than zero.',
      );
    }
  }

  /**
   * Validates the configured direct-unlock price.
   */
  private validateDirectUnlockPrice(directUnlockPrice: Prisma.Decimal): void {
    if (directUnlockPrice.lte(0)) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_DIRECT_UNLOCK_PRICE,
        'The configured direct-unlock price must be greater than zero.',
      );
    }
  }

  /**
   * Validates the configured bonus rule.
   */
  private validateBonusConfiguration(
    threshold: number,
    bonusCredits: number,
  ): void {
    if (
      !Number.isInteger(threshold) ||
      !Number.isInteger(bonusCredits) ||
      threshold < 0 ||
      bonusCredits < 0 ||
      (threshold === 0 && bonusCredits > 0)
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_BONUS_CONFIGURATION,
        'The configured bonus-credit rule is invalid.',
        {
          details: {
            bonusThreshold: threshold,

            bonusCredits,
          },
        },
      );
    }
  }
}
