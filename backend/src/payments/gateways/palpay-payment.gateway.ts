import { Injectable } from '@nestjs/common';

import { PaymentProvider } from '@prisma/client';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import type { CreatePaymentSessionInput } from '../types/create-payment-session.type';
import type { PaymentConfirmation } from '../types/payment-confirmation.type';
import type { PaymentSessionResult } from '../types/payment-session-result.type';
import type { PaymentWebhookInput } from '../types/payment-webhook-input.type';

import type { PaymentGateway } from './payment-gateway.interface';

/**
 * PalPay payment-gateway placeholder.
 *
 * PalPay requires merchant-specific integration documentation
 * and credentials before a secure production implementation
 * can be completed.
 *
 * This placeholder:
 * - Preserves the PaymentGateway abstraction.
 * - Prevents insecure or fabricated provider requests.
 * - Fails explicitly when PalPay is selected.
 * - Can be replaced without changing payment business services.
 *
 * It must not be registered as an enabled gateway until the
 * official merchant API contract is available.
 *
 * @author Eman
 */
@Injectable()
export class PalPayPaymentGateway implements PaymentGateway {
    readonly provider = PaymentProvider.PALPAY;

    /**
     * PalPay checkout creation remains unavailable until
     * official merchant API documentation is supplied.
     */
    createPaymentSession(
        _input: CreatePaymentSessionInput,
    ): Promise<PaymentSessionResult> {
        return Promise.reject(
            this.createUnavailableError(),
        );
    }

    /**
     * PalPay webhook verification remains unavailable until
     * the official signature-verification contract is supplied.
     */
    verifyWebhook(
        _input: PaymentWebhookInput,
    ): Promise<PaymentConfirmation> {
        return Promise.reject(
            this.createUnavailableError(),
        );
    }

    /**
     * Creates a stable domain error for the unavailable
     * PalPay integration.
     */
    private createUnavailableError():
        PaymentProcessingError {
        return new PaymentProcessingError(
            PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
            'PalPay payment integration is not configured.',
            {
                details: {
                    provider: PaymentProvider.PALPAY,
                    reason:
                        'Official merchant API documentation and credentials are required.',
                },
            },
        );
    }
}