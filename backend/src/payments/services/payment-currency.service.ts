import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  DEFAULT_PAYMENT_CURRENCY,
  PAYMENT_CURRENCIES,
  PAYMENT_CURRENCY_CODES,
  type SupportedPaymentCurrency,
} from '../constants/payment.constants';
import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

type CurrencyRateEntry = {
  readonly rate: Prisma.Decimal;
  readonly rateDate: string;
  readonly fetchedAt: number;
};

export type PaymentCurrencyQuote = {
  readonly baseCurrency: SupportedPaymentCurrency;
  readonly currency: SupportedPaymentCurrency;
  readonly rate: Prisma.Decimal;
  readonly rateDate: string;
};

@Injectable()
export class PaymentCurrencyService {
  private readonly cache = new Map<string, CurrencyRateEntry>();
  private readonly inFlight = new Map<string, Promise<CurrencyRateEntry>>();
  private readonly cacheTtlMs = 6 * 60 * 60 * 1000;
  private readonly requestTimeoutMs = 10000;
  private readonly retryDelayMs = 300;

  normalizeCurrency(
    value?: string,
    fallback: SupportedPaymentCurrency = DEFAULT_PAYMENT_CURRENCY,
  ): SupportedPaymentCurrency {
    const normalized = (value || fallback).trim().toUpperCase();

    if (!PAYMENT_CURRENCY_CODES.includes(normalized as SupportedPaymentCurrency)) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_CURRENCY,
        'The selected payment currency is not supported.',
        {
          details: {
            currency: normalized,
            supportedCurrencies: [...PAYMENT_CURRENCY_CODES],
          },
        },
      );
    }

    return normalized as SupportedPaymentCurrency;
  }

  async getQuote(
    targetValue?: string,
    baseValue?: string,
  ): Promise<PaymentCurrencyQuote> {
    const baseCurrency = this.normalizeCurrency(baseValue);
    const currency = this.normalizeCurrency(targetValue, baseCurrency);

    if (currency === baseCurrency) {
      return {
        baseCurrency,
        currency,
        rate: new Prisma.Decimal(1),
        rateDate: new Date().toISOString().slice(0, 10),
      };
    }

    const entry = await this.getRate(baseCurrency, currency);

    return {
      baseCurrency,
      currency,
      rate: entry.rate,
      rateDate: entry.rateDate,
    };
  }

  convert(amount: Prisma.Decimal, quote: PaymentCurrencyQuote): Prisma.Decimal {
    if (quote.currency === quote.baseCurrency) {
      return new Prisma.Decimal(amount.toFixed(2));
    }

    return new Prisma.Decimal(amount.mul(quote.rate).toFixed(2));
  }

  formatAmount(amount: Prisma.Decimal): string {
    return amount.toFixed(2);
  }

  getSupportedCurrencies() {
    return PAYMENT_CURRENCIES.map((currency) => ({ ...currency }));
  }

  private rateKey(
    baseCurrency: SupportedPaymentCurrency,
    currency: SupportedPaymentCurrency,
  ): string {
    return `${baseCurrency}:${currency}`;
  }

  private async getRate(
    baseCurrency: SupportedPaymentCurrency,
    currency: SupportedPaymentCurrency,
  ): Promise<CurrencyRateEntry> {
    const key = this.rateKey(baseCurrency, currency);
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && now - cached.fetchedAt < this.cacheTtlMs) {
      return cached;
    }

    const existing = this.inFlight.get(key);

    if (existing) {
      return existing;
    }

    const request = this.fetchRate(baseCurrency, currency)
      .then((entry) => {
        this.cache.set(key, entry);
        return entry;
      })
      .catch((error: unknown) => {
        if (cached) {
          return cached;
        }

        if (error instanceof PaymentProcessingError) {
          throw error;
        }

        throw new PaymentProcessingError(
          PaymentErrorCode.CURRENCY_RATE_UNAVAILABLE,
          `The ${currency} exchange rate is temporarily unavailable. Please try again in a moment or choose another currency.`,
          {
            cause: error,
            details: {
              baseCurrency,
              currency,
            },
          },
        );
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);

    return request;
  }

  private async fetchRate(
    baseCurrency: SupportedPaymentCurrency,
    currency: SupportedPaymentCurrency,
  ): Promise<CurrencyRateEntry> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.firstSuccessful([
          this.fetchFrankfurterV2(baseCurrency, currency),
          this.fetchFrankfurterV1(baseCurrency, currency),
        ]);
      } catch (error) {
        lastError = error;

        if (attempt === 0) {
          await this.delay(this.retryDelayMs);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('The currency provider did not return an exchange rate.');
  }

  private fetchFrankfurterV2(
    baseCurrency: SupportedPaymentCurrency,
    currency: SupportedPaymentCurrency,
  ): Promise<CurrencyRateEntry> {
    return this.requestJson(
      `https://api.frankfurter.dev/v2/rate/${baseCurrency}/${currency}`,
    ).then((raw) => {
      const payload = raw as {
        date?: unknown;
        base?: unknown;
        quote?: unknown;
        rate?: unknown;
      };

      const rate = Number(payload.rate);
      const returnedBase = String(payload.base || '').trim().toUpperCase();
      const returnedQuote = String(payload.quote || '').trim().toUpperCase();

      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Frankfurter v2 returned an invalid exchange rate.');
      }

      if (returnedBase !== baseCurrency || returnedQuote !== currency) {
        throw new Error('Frankfurter v2 returned an unexpected currency pair.');
      }

      return {
        rate: new Prisma.Decimal(String(rate)),
        rateDate: this.normalizeRateDate(payload.date),
        fetchedAt: Date.now(),
      };
    });
  }

  private fetchFrankfurterV1(
    baseCurrency: SupportedPaymentCurrency,
    currency: SupportedPaymentCurrency,
  ): Promise<CurrencyRateEntry> {
    const query = new URLSearchParams({
      base: baseCurrency,
      symbols: currency,
    });

    return this.requestJson(
      `https://api.frankfurter.dev/v1/latest?${query.toString()}`,
    ).then((raw) => {
      const payload = raw as {
        date?: unknown;
        base?: unknown;
        rates?: Record<string, unknown>;
      };

      const returnedBase = String(payload.base || '').trim().toUpperCase();
      const rate = Number(payload.rates?.[currency]);

      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Frankfurter v1 returned an invalid exchange rate.');
      }

      if (returnedBase !== baseCurrency) {
        throw new Error('Frankfurter v1 returned an unexpected base currency.');
      }

      return {
        rate: new Prisma.Decimal(String(rate)),
        rateDate: this.normalizeRateDate(payload.date),
        fetchedAt: Date.now(),
      };
    });
  }

  private async requestJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Currency provider returned HTTP ${response.status}.`,
        );
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private firstSuccessful<T>(requests: readonly Promise<T>[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (requests.length === 0) {
        reject(new Error('No currency-rate provider request was configured.'));
        return;
      }

      let rejectedCount = 0;
      let lastError: unknown;

      for (const request of requests) {
        request.then(resolve).catch((error: unknown) => {
          lastError = error;
          rejectedCount += 1;

          if (rejectedCount === requests.length) {
            reject(
              lastError instanceof Error
                ? lastError
                : new Error('Every currency-rate request failed.'),
            );
          }
        });
      }
    });
  }

  private normalizeRateDate(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    return new Date().toISOString().slice(0, 10);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}