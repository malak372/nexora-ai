import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  GeneratedOutputStatus,
  IdeaGenerationType,
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
import type { CreatePublicationAcceptanceDto } from '../../ideas/publication/dto/create-publication-acceptance.dto';
import type { CreatePublicationAdvancedUnlockDto } from '../../ideas/publication/dto/create-publication-advanced-unlock.dto';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import { PaymentGatewayFactory } from '../gateways/payment-gateway.factory';

import type { CreatePaymentSessionInput } from '../types/create-payment-session.type';
import type { PaymentSessionResult } from '../types/payment-session-result.type';
import { PaymentProcessingService } from './payment-processing.service';

/**
 * Supported user-facing payment-method keys.
 *
 * These values match the string keys persisted in Prisma.
 */
const PAYMENT_METHOD_KEY = {
  CARD: 'card',
} as const;

/**
 * Supported backend payment-gateway keys.
 *
 * These values must match each gateway's `providerKey`.
 */
const PAYMENT_PROVIDER_KEY = {
  STRIPE: 'stripe',
} as const;

/**
 * Payment record required while creating an external checkout session.
 */
type PendingPayment = {
  readonly id: string;
  readonly userId: string;
  readonly ideaId: string | null;
  readonly publicationId: string | null;
  readonly amount: Prisma.Decimal;
  readonly currency: string;
  readonly paymentMethodKey: string;
  readonly providerKey: string;
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
  readonly paymentMethodKey: string;
  readonly providerKey: string;
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
 * - Resolve the provider associated with a payment-method key.
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
    private readonly paymentProcessingService: PaymentProcessingService,
  ) {}

  /** Returns database-backed prices for the authenticated account. */
  async getPaymentPricing(userId: string, creditsQuantity = 1) {
    const [user, settings] = await Promise.all([this.ensureEligibleUser(userId), this.getSystemSettings()]);
    const activationFee = user.accountStatus === AccountStatus.NORMAL ? settings.premiumActivationFee : new Prisma.Decimal(0);
    const total = settings.creditPrice.mul(creditsQuantity).add(activationFee);
    const acceptance = user.accountStatus === AccountStatus.PREMIUM ? settings.premiumAcceptancePrice : settings.normalAcceptancePrice;
    return {
      currency: DEFAULT_PAYMENT_CURRENCY,
      accountStatus: user.accountStatus,
      creditsQuantity,
      creditPrice: settings.creditPrice.toFixed(2),
      premiumActivationFee: settings.premiumActivationFee.toFixed(2),
      activationFeeApplied: activationFee.toFixed(2),
      creditPurchaseTotal: total.toFixed(2),
      directUnlockPrice: settings.directUnlockPrice.toFixed(2),
      normalAcceptancePrice: settings.normalAcceptancePrice.toFixed(2),
      premiumAcceptancePrice: settings.premiumAcceptancePrice.toFixed(2),
      publicationAcceptancePrice: acceptance.toFixed(2),
      normalPublicationAdvancedPrice:
        settings.normalPublicationAdvancedPrice.toFixed(2),
      publicationAdvancedCreditCost:
        settings.publicationAdvancedCreditCost,
    };
  }

  /**
   * Creates a checkout session for purchasing generation credits.
   */
  async createCreditPurchaseCheckout(
    userId: string,
    dto: PurchaseCreditsDto,
  ): Promise<PaymentCheckoutResult> {
    const purchasingUser = await this.ensureEligibleUser(userId);

    const settings = await this.getSystemSettings();

    this.validateCreditPrice(settings.creditPrice);
    this.validateBonusConfiguration(
      settings.bonusThreshold,
      settings.bonusCredits,
    );

    const paymentMethodKey = this.normalizePaymentMethodKey(
      dto.paymentMethodKey,
    );
    const providerKey = this.resolveProviderKey(paymentMethodKey);

    const purchasedCredits = dto.creditsQuantity;
    const bonusCredits = this.calculateBonusCredits(
      purchasedCredits,
      settings.bonusThreshold,
      settings.bonusCredits,
    );

    const activatesPremium =
      purchasingUser.accountStatus === AccountStatus.NORMAL;
    const activationFee = activatesPremium
      ? settings.premiumActivationFee
      : new Prisma.Decimal(0);
    const amount = settings.creditPrice
      .mul(purchasedCredits)
      .add(activationFee);

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
      paymentMethodKey,
      providerKey,
      paymentPurpose: PaymentPurpose.BUY_CREDITS,
      creditsAmount: purchasedCredits,
      bonusCreditsAmount: bonusCredits,
      creditPriceAtPurchase: settings.creditPrice,
      premiumActivationFeeAtPurchase: activatesPremium ? activationFee : null,
      activatesPremium,
      publicationId: null,
      acceptanceCountry: null,
      acceptanceCity: null,
      acceptanceRegion: null,
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

    const paymentMethodKey = this.normalizePaymentMethodKey(
      dto.paymentMethodKey,
    );
    const providerKey = this.resolveProviderKey(paymentMethodKey);

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
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          amount: true,
          currency: true,
          paymentMethodKey: true,
          providerKey: true,
          paymentPurpose: true,
          providerSessionId: true,
          createdAt: true,
        },
      }),
    ]);

    this.validateDirectUnlockPrice(settings.directUnlockPrice);

    if (!idea) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_FOUND,
        'The selected idea does not exist.',
        { details: { ideaId: dto.ideaId } },
      );
    }

    if (idea.userId !== userId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ACCESS_DENIED,
        'The authenticated user does not own the selected idea.',
        { details: { ideaId: idea.id, userId } },
      );
    }

    if (idea.isUnlocked) {
      return this.buildCompletedDirectUnlockResult({
        paymentId: existingPendingPayment?.id ?? 'already-unlocked',
        paymentMethodKey,
        providerKey,
        amount: settings.directUnlockPrice,
        successUrl: dto.successUrl,
        ideaId: idea.id,
      });
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

    if (existingPendingPayment) {
      const recovered = await this.reconcilePendingDirectUnlockPayment(
        existingPendingPayment,
        {
          ideaId: idea.id,
          paymentMethodKey,
          providerKey,
          successUrl: dto.successUrl,
        },
      );

      if (recovered) {
        return recovered;
      }
    }

    const payment = await this.createPendingPayment({
      userId,
      ideaId: idea.id,
      amount: settings.directUnlockPrice,
      currency: DEFAULT_PAYMENT_CURRENCY,
      paymentMethodKey,
      providerKey,
      paymentPurpose: PaymentPurpose.DIRECT_UNLOCK,
      creditsAmount: 0,
      bonusCreditsAmount: 0,
      creditPriceAtPurchase: null,
      premiumActivationFeeAtPurchase: null,
      activatesPremium: false,
      publicationId: null,
      acceptanceCountry: null,
      acceptanceCity: null,
      acceptanceRegion: null,
    });

    return this.createExternalCheckout(payment, {
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      ideaId: idea.id,
    });
  }

  /**
   * Reconciles a pending direct-unlock payment directly with its provider.
   *
   * This fixes the case where Stripe received the money but the local webhook
   * was unavailable or delayed. Successful provider state is sent through the
   * normal PaymentProcessingService, which performs the same idempotent
   * fulfillment used by verified webhooks.
   */
  private async reconcilePendingDirectUnlockPayment(
    payment: {
      readonly id: string;
      readonly amount: Prisma.Decimal;
      readonly currency: string;
      readonly paymentMethodKey: string;
      readonly providerKey: string;
      readonly paymentPurpose: PaymentPurpose;
      readonly providerSessionId: string | null;
      readonly createdAt: Date;
    },
    input: {
      readonly ideaId: string;
      readonly paymentMethodKey: string;
      readonly providerKey: string;
      readonly successUrl: string;
    },
  ): Promise<PaymentCheckoutResult | null> {
    if (!payment.providerSessionId?.trim()) {
      await this.markPendingCheckoutAsFailed(
        payment.id,
        'The previous checkout did not contain a provider session identifier.',
      );
      return null;
    }

    if (
      payment.paymentMethodKey !== input.paymentMethodKey ||
      payment.providerKey !== input.providerKey
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_SESSION_CREATION_FAILED,
        'A checkout is already active with another payment method.',
        {
          details: {
            ideaId: input.ideaId,
            paymentId: payment.id,
            activePaymentMethodKey: payment.paymentMethodKey,
          },
        },
      );
    }

    const gateway = this.paymentGatewayFactory.getGateway(payment.providerKey);

    if (!gateway.inspectPaymentSession) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_SESSION_CREATION_FAILED,
        'The active payment provider cannot reconcile the existing checkout session.',
        {
          details: {
            ideaId: input.ideaId,
            paymentId: payment.id,
            providerKey: payment.providerKey,
          },
        },
      );
    }

    const inspection = await gateway.inspectPaymentSession(
      payment.providerSessionId,
    );

    if (inspection.state === 'OPEN') {
      return {
        paymentId: payment.id,
        paymentPurpose: payment.paymentPurpose,
        paymentMethodKey: payment.paymentMethodKey,
        providerKey: payment.providerKey,
        status: PaymentStatus.PENDING,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        checkoutUrl: inspection.checkoutUrl,
        providerSessionId: payment.providerSessionId,
        ...(inspection.expiresAt
          ? { expiresAt: inspection.expiresAt }
          : {}),
      };
    }

    const processingResult =
      await this.paymentProcessingService.processConfirmation(
        inspection.confirmation,
      );

    if (inspection.state === 'SUCCEEDED') {
      return this.buildCompletedDirectUnlockResult({
        paymentId: payment.id,
        paymentMethodKey: payment.paymentMethodKey,
        providerKey: payment.providerKey,
        amount: payment.amount,
        successUrl: input.successUrl,
        ideaId: input.ideaId,
        providerSessionId: payment.providerSessionId,
      });
    }

    if (processingResult.status === PaymentStatus.FAILED) {
      return null;
    }

    return null;
  }

  /**
   * Returns a completed checkout response that works with the existing
   * frontend redirect behavior. The success URL is returned only after the
   * provider session was retrieved server-to-server and fulfillment completed.
   */
  private buildCompletedDirectUnlockResult(input: {
    readonly paymentId: string;
    readonly paymentMethodKey: string;
    readonly providerKey: string;
    readonly amount: Prisma.Decimal;
    readonly successUrl: string;
    readonly ideaId: string;
    readonly providerSessionId?: string;
  }): PaymentCheckoutResult {
    return {
      paymentId: input.paymentId,
      paymentPurpose: PaymentPurpose.DIRECT_UNLOCK,
      paymentMethodKey: input.paymentMethodKey,
      providerKey: input.providerKey,
      status: PaymentStatus.SUCCEEDED,
      amount: input.amount.toFixed(2),
      currency: DEFAULT_PAYMENT_CURRENCY,
      checkoutUrl: this.appendCompletedDirectUnlockReturnParameters(
        input.successUrl,
        input.paymentId,
        input.ideaId,
      ),
      providerSessionId:
        input.providerSessionId ?? `completed:${input.paymentId}`,
    };
  }


  /**
   * Appends the payment reference to an already-completed direct-unlock
   * redirect. This is required when an earlier provider session was reconciled
   * server-to-server or when the idea was already unlocked before a new
   * checkout was requested.
   */
  private appendCompletedDirectUnlockReturnParameters(
    successUrl: string,
    paymentId: string,
    ideaId: string,
  ): string {
    const url = new URL(successUrl);

    if (paymentId !== 'already-unlocked') {
      url.searchParams.set('paymentId', paymentId);
    }

    url.searchParams.set('purpose', PaymentPurpose.DIRECT_UNLOCK);
    url.searchParams.set('ideaId', ideaId);

    if (paymentId === 'already-unlocked') {
      url.searchParams.set('alreadyUnlocked', '1');
    }

    return url.toString();
  }

  /**
   * Marks an unusable pending checkout as failed so a clean provider session
   * may be created. The conditional update avoids overwriting a webhook result
   * that completed concurrently.
   */
  private async markPendingCheckoutAsFailed(
    paymentId: string,
    failureReason: string,
  ): Promise<void> {
    await this.prisma.payment.updateMany({
      where: {
        id: paymentId,
        status: PaymentStatus.PENDING,
      },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        failureReason,
      },
    });
  }

  /** Creates a fixed-price publication acceptance checkout for a NORMAL user. */
  async createPublicationAcceptanceCheckout(
    userId: string,
    publicationId: string,
    dto: CreatePublicationAcceptanceDto,
  ): Promise<PaymentCheckoutResult> {
    const user = await this.ensureEligibleUser(userId);

    const [settings, publication, existing] = await Promise.all([
      this.getSystemSettings(),
      this.prisma.ideaPublication.findFirst({
        where: { id: publicationId, status: 'PUBLISHED', isHidden: false },
        select: { id: true, publisherId: true },
      }),
      this.prisma.ideaPublicationAcceptance.findUnique({
        where: { publicationId_userId: { publicationId, userId } },
        select: { id: true },
      }),
    ]);

    if (!publication) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_FOUND,
        'The publication does not exist or is unavailable.',
      );
    }
    if (publication.publisherId === userId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ACCESS_DENIED,
        'You cannot accept your own publication.',
      );
    }
    if (existing) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ALREADY_UNLOCKED,
        'This publication has already been accepted.',
      );
    }

    const paymentMethodKey = this.normalizePaymentMethodKey(
      dto.paymentMethodKey,
    );
    const providerKey = this.resolveProviderKey(paymentMethodKey);
    const payment = await this.createPendingPayment({
      userId,
      ideaId: null,
      publicationId,
      amount: user.accountStatus === AccountStatus.PREMIUM ? settings.premiumAcceptancePrice : settings.normalAcceptancePrice,
      currency: DEFAULT_PAYMENT_CURRENCY,
      paymentMethodKey,
      providerKey,
      paymentPurpose: PaymentPurpose.ACCEPT_PUBLICATION,
      creditsAmount: 0,
      bonusCreditsAmount: 0,
      creditPriceAtPurchase: null,
      premiumActivationFeeAtPurchase: null,
      activatesPremium: false,
      acceptanceCountry: dto.country?.trim() || null,
      acceptanceCity: dto.city?.trim() || null,
      acceptanceRegion: dto.region?.trim() || null,
      idempotencyKey: dto.clientRequestId,
    });

    return this.createExternalCheckout(payment, {
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      publicationId,
    });
  }

  /**
   * Creates a checkout for a NORMAL user who already accepted the publication
   * and now wants the protected advanced outputs.
   */
  async createPublicationAdvancedUnlockCheckout(
    userId: string,
    publicationId: string,
    dto: CreatePublicationAdvancedUnlockDto,
  ): Promise<PaymentCheckoutResult> {
    const user = await this.ensureEligibleUser(userId);

    if (user.accountStatus !== AccountStatus.NORMAL) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_PURPOSE,
        'Premium users unlock advanced publication outputs with credits.',
      );
    }

    const [settings, acceptance] = await Promise.all([
      this.getSystemSettings(),
      this.prisma.ideaPublicationAcceptance.findUnique({
        where: {
          publicationId_userId: {
            publicationId,
            userId,
          },
        },
        select: {
          id: true,
          advancedUnlockedAt: true,
          publication: {
            select: {
              ideaId: true,
            },
          },
        },
      }),
    ]);

    if (!acceptance) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ACCESS_DENIED,
        'Accept the publication before purchasing advanced outputs.',
      );
    }

    if (acceptance.advancedUnlockedAt) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_ALREADY_UNLOCKED,
        'Advanced publication outputs are already unlocked.',
      );
    }

    const availableAdvancedOutputs =
      await this.prisma.generatedOutput.count({
        where: {
          ideaId: acceptance.publication.ideaId,
          status: 'COMPLETED',
        },
      });

    if (availableAdvancedOutputs <= 0) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_PURPOSE,
        'This publication does not contain purchasable advanced outputs.',
      );
    }

    if (settings.normalPublicationAdvancedPrice.lte(0)) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_AMOUNT,
        'The configured advanced publication price must be greater than zero.',
      );
    }

    const paymentMethodKey = this.normalizePaymentMethodKey(
      dto.paymentMethodKey,
    );
    const providerKey = this.resolveProviderKey(paymentMethodKey);

    const payment = await this.createPendingPayment({
      userId,
      ideaId: null,
      publicationId,
      amount: settings.normalPublicationAdvancedPrice,
      currency: DEFAULT_PAYMENT_CURRENCY,
      paymentMethodKey,
      providerKey,
      paymentPurpose: PaymentPurpose.UNLOCK_PUBLICATION_ADVANCED,
      creditsAmount: 0,
      bonusCreditsAmount: 0,
      creditPriceAtPurchase: null,
      premiumActivationFeeAtPurchase: null,
      activatesPremium: false,
      acceptanceCountry: null,
      acceptanceCity: null,
      acceptanceRegion: null,
      idempotencyKey: dto.clientRequestId,
    });

    return this.createExternalCheckout(payment, {
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      publicationId,
    });
  }

  /**
   * Creates the internal PENDING payment record.
   */
  /**
   * Validates purpose-specific payment fields before Prisma reaches the
   * database constraint. This provides a readable application error for
   * future regressions while PostgreSQL remains the final integrity guard.
   */
  private validatePendingPaymentPurpose(input: {
    readonly ideaId: string | null;
    readonly publicationId: string | null;
    readonly paymentPurpose: PaymentPurpose;
    readonly creditsAmount: number;
    readonly bonusCreditsAmount: number;
    readonly activatesPremium: boolean;
  }): void {
    const isCreditPurchase =
      input.paymentPurpose === PaymentPurpose.BUY_CREDITS &&
      input.ideaId === null &&
      input.publicationId === null &&
      input.creditsAmount > 0;

    const isDirectUnlock =
      input.paymentPurpose === PaymentPurpose.DIRECT_UNLOCK &&
      input.ideaId !== null &&
      input.publicationId === null &&
      input.creditsAmount === 0 &&
      input.bonusCreditsAmount === 0;

    const isPublicationAcceptance =
      input.paymentPurpose === PaymentPurpose.ACCEPT_PUBLICATION &&
      input.ideaId === null &&
      input.publicationId !== null &&
      input.creditsAmount === 0 &&
      input.bonusCreditsAmount === 0 &&
      input.activatesPremium === false;

    const isPublicationAdvancedUnlock =
      input.paymentPurpose === PaymentPurpose.UNLOCK_PUBLICATION_ADVANCED &&
      input.ideaId === null &&
      input.publicationId !== null &&
      input.creditsAmount === 0 &&
      input.bonusCreditsAmount === 0 &&
      input.activatesPremium === false;

    if (
      !isCreditPurchase &&
      !isDirectUnlock &&
      !isPublicationAcceptance &&
      !isPublicationAdvancedUnlock
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_PURPOSE,
        'Payment fields are inconsistent with the selected payment purpose.',
      );
    }
  }

  private createPendingPayment(input: {
    readonly userId: string;
    readonly ideaId: string | null;
    readonly amount: Prisma.Decimal;
    readonly currency: string;
    readonly paymentMethodKey: string;
    readonly providerKey: string;
    readonly paymentPurpose: PaymentPurpose;
    readonly creditsAmount: number;
    readonly bonusCreditsAmount: number;
    readonly creditPriceAtPurchase: Prisma.Decimal | null;
    readonly premiumActivationFeeAtPurchase: Prisma.Decimal | null;
    readonly activatesPremium: boolean;
    readonly publicationId: string | null;
    readonly acceptanceCountry: string | null;
    readonly acceptanceCity: string | null;
    readonly acceptanceRegion: string | null;
    readonly idempotencyKey?: string;
  }): Promise<PendingPayment> {
    this.validatePendingPaymentPurpose(input);

    return this.prisma.payment.create({
      data: {
        userId: input.userId,
        ideaId: input.ideaId,
        publicationId: input.publicationId,
        amount: input.amount,
        currency: input.currency,
        paymentMethodKey: input.paymentMethodKey,
        providerKey: input.providerKey,
        paymentPurpose: input.paymentPurpose,
        status: PaymentStatus.PENDING,
        creditsAmount: input.creditsAmount,
        bonusCreditsAmount: input.bonusCreditsAmount,
        creditPriceAtPurchase: input.creditPriceAtPurchase,
        premiumActivationFeeAtPurchase: input.premiumActivationFeeAtPurchase,
        activatesPremium: input.activatesPremium,
        acceptanceCountry: input.acceptanceCountry,
        acceptanceCity: input.acceptanceCity,
        acceptanceRegion: input.acceptanceRegion,
        idempotencyKey: input.idempotencyKey,
      },
      select: {
        id: true,
        userId: true,
        ideaId: true,
        publicationId: true,
        amount: true,
        currency: true,
        paymentMethodKey: true,
        providerKey: true,
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
      readonly publicationId?: string;
      readonly creditsQuantity?: number;
    },
  ): Promise<PaymentCheckoutResult> {
    const sessionInput = this.buildPaymentSessionInput(payment, options);

    try {
      const session = await this.paymentGatewayFactory
        .getGateway(payment.providerKey)
        .createPaymentSession(sessionInput);

      this.validateSessionResult(payment, session);
      await this.storeCheckoutSession(payment.id, session);

      return {
        paymentId: payment.id,
        paymentPurpose: payment.paymentPurpose,
        paymentMethodKey: payment.paymentMethodKey,
        providerKey: session.providerKey,
        status: PaymentStatus.PENDING,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        checkoutUrl: session.checkoutUrl,
        providerSessionId: session.providerSessionId,
        ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
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
            providerKey: payment.providerKey,
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
      readonly publicationId?: string;
      readonly creditsQuantity?: number;
    },
  ): CreatePaymentSessionInput {
    const metadata: Record<string, string> = {
      [PAYMENT_METADATA_KEYS.PAYMENT_ID]: payment.id,
      [PAYMENT_METADATA_KEYS.USER_ID]: payment.userId,
      [PAYMENT_METADATA_KEYS.PAYMENT_PURPOSE]: payment.paymentPurpose,
    };

    if (options.publicationId) {
      metadata.publicationId = options.publicationId;
    }

    if (options.ideaId) {
      metadata[PAYMENT_METADATA_KEYS.IDEA_ID] = options.ideaId;
    }

    return {
      paymentId: payment.id,
      userId: payment.userId,
      paymentMethodKey: payment.paymentMethodKey,
      paymentPurpose: payment.paymentPurpose,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      successUrl: this.appendPaymentReturnParameters(options.successUrl, payment, options),
      cancelUrl: options.cancelUrl,
      ...(options.ideaId ? { ideaId: options.ideaId } : {}),
      ...(options.creditsQuantity !== undefined
        ? { creditsQuantity: options.creditsQuantity }
        : {}),
      metadata,
    };
  }

  /** Returns a trusted payment state owned by the authenticated user. */
  async getPaymentState(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        userId,
      },
      select: {
        id: true,
        status: true,
        paymentPurpose: true,
        amount: true,
        currency: true,
        ideaId: true,
        publicationId: true,
        activatesPremium: true,
        failureReason: true,
        paidAt: true,
        providerKey: true,
        providerSessionId: true,
        user: {
          select: {
            accountStatus: true,
            creditBalance: true,
          },
        },
        idea: {
          select: {
            isUnlocked: true,
            unlockMethod: true,
            generatedOutputs: {
              where: {
                outputKey: 'full-abstract',
                status: GeneratedOutputStatus.PENDING,
              },
              take: 1,
              select: { id: true },
            },
          },
        },
        publicationAcceptance: {
          select: {
            id: true,
            acceptedAt: true,
            advancedUnlockedAt: true,
          },
        },
        publicationAdvancedUnlock: {
          select: {
            id: true,
            acceptedAt: true,
            advancedUnlockedAt: true,
          },
        },
      },
    });

    if (!payment) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_NOT_FOUND,
        'The requested payment was not found.',
        {
          details: {
            paymentId,
            userId,
          },
        },
      );
    }

    return {
      paymentId: payment.id,
      status: payment.status,
      paymentPurpose: payment.paymentPurpose,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      paidAt: payment.paidAt,
      failureReason: payment.failureReason,
      accountStatus: payment.user.accountStatus,
      creditsBalance: payment.user.creditBalance,
      premiumActivated:
        payment.activatesPremium &&
        payment.status === PaymentStatus.SUCCEEDED &&
        payment.user.accountStatus === AccountStatus.PREMIUM,
      ideaId: payment.ideaId,
      ideaUnlocked: payment.idea?.isUnlocked ?? false,
      unlockInProgress:
        payment.paymentPurpose === PaymentPurpose.DIRECT_UNLOCK &&
        payment.status === PaymentStatus.SUCCEEDED &&
        !payment.idea?.isUnlocked &&
        Boolean(payment.idea?.generatedOutputs.length),
      unlockMethod: payment.idea?.unlockMethod ?? null,
      publicationId: payment.publicationId,
      publicationAccepted: Boolean(
        payment.publicationAcceptance ?? payment.publicationAdvancedUnlock,
      ),
      acceptanceId:
        payment.publicationAcceptance?.id ??
        payment.publicationAdvancedUnlock?.id ??
        null,
      advancedPublicationAccess: Boolean(
        payment.publicationAcceptance?.advancedUnlockedAt ??
          payment.publicationAdvancedUnlock?.advancedUnlockedAt,
      ),
    };
  }

  /** Verifies the stored provider session server-to-server and fulfills it idempotently. */
  async reconcilePayment(userId:string,paymentId:string){
    const payment=await this.prisma.payment.findFirst({where:{id:paymentId,userId},select:{id:true,status:true,providerKey:true,providerSessionId:true}});
    if(!payment) throw new PaymentProcessingError(PaymentErrorCode.PAYMENT_NOT_FOUND,'The requested payment was not found.',{details:{paymentId,userId}});
    if(payment.status===PaymentStatus.PENDING && payment.providerSessionId){ const gateway=this.paymentGatewayFactory.getGateway(payment.providerKey); if(gateway.inspectPaymentSession){ const inspection=await gateway.inspectPaymentSession(payment.providerSessionId); if(inspection.state!=='OPEN') await this.paymentProcessingService.processConfirmation(inspection.confirmation); } }
    return this.getPaymentState(userId,paymentId);
  }

  private appendPaymentReturnParameters(successUrl:string,payment:PendingPayment,options:{ideaId?:string;publicationId?:string}){ const url=new URL(successUrl); url.searchParams.set('paymentId',payment.id); url.searchParams.set('purpose',payment.paymentPurpose); if(options.ideaId) url.searchParams.set('ideaId',options.ideaId); if(options.publicationId) url.searchParams.set('publicationId',options.publicationId); return url.toString(); }

  /**
   * Validates the normalized checkout-session response.
   */
  private validateSessionResult(
    payment: PendingPayment,
    session: PaymentSessionResult,
  ): void {
    if (session.providerKey !== payment.providerKey) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROVIDER_MISMATCH,
        'The checkout-session provider does not match the internal payment provider.',
        {
          details: {
            paymentId: payment.id,
            expectedProviderKey: payment.providerKey,
            returnedProviderKey: session.providerKey,
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
            providerKey: payment.providerKey,
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
            providerKey: payment.providerKey,
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
            providerKey: payment.providerKey,
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
            providerKey: payment.providerKey,
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
          { details: { paymentId } },
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
            details: { paymentId },
          },
        );
      }

      throw error;
    }
  }

  /**
   * Marks an internal payment as failed when external checkout
   * creation or persistence fails.
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
      /* Preserve the original checkout error. */
    }
  }

  /**
   * Ensures the authenticated account can initiate payments.
   */
  private async ensureEligibleUser(userId: string): Promise<{
    id: string;
    accountStatus: AccountStatus;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        accountStatus: true,
        isVerified: true,
      },
    });

    if (!user) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'The authenticated user does not exist.',
        { details: { userId } },
      );
    }

    if (user.role !== UserRole.USER) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'Only registered user accounts can initiate payments.',
        { details: { userId } },
      );
    }

    if (!user.isActive) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'Inactive user accounts cannot initiate payments.',
        { details: { userId } },
      );
    }

    if (!user.isVerified) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
        'The user must verify the account before initiating payments.',
        { details: { userId } },
      );
    }

    return {
      id: user.id,
      accountStatus: user.accountStatus,
    };
  }

  /**
   * Retrieves the single global system-settings row.
   */
  private async getSystemSettings() {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { key: GLOBAL_SYSTEM_SETTINGS_KEY },
      select: {
        creditPrice: true,
        directUnlockPrice: true,
        premiumActivationFee: true,
        publishedIdeaPrice: true,
        normalAcceptancePrice: true,
        premiumAcceptancePrice: true,
        normalPublicationAdvancedPrice: true,
        publicationAdvancedCreditCost: true,
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
   * Normalizes a user-facing payment-method key.
   */
  private normalizePaymentMethodKey(paymentMethodKey: string): string {
    return paymentMethodKey.trim().toLowerCase();
  }

  /**
   * Maps the supported card payment method to Stripe Checkout.
   */
  private resolveProviderKey(paymentMethodKey: string): string {
    switch (paymentMethodKey) {
      case PAYMENT_METHOD_KEY.CARD:
        return PAYMENT_PROVIDER_KEY.STRIPE;


      default:
        throw new PaymentProcessingError(
          PaymentErrorCode.UNSUPPORTED_PAYMENT_METHOD,
          'The selected payment method is not supported.',
          { details: { paymentMethodKey } },
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