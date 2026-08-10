/**
 * Payment flow API helpers.
 *
 * Pricing is read frequently by Generate, Upgrade, checkout and result pages,
 * but it changes rarely. Reusing the session cache removes repeated database
 * reads during normal navigation while keeping explicit invalidation possible.
 */
import {
  extractApiData,
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';
import {
  cachedRequest,
  createRequestCacheKey,
  invalidateRequestCache,
} from '../../shared/cache/requestCache';

const PRICING_TTL_MS = 10 * 60 * 1000;
const unwrap = (response) => extractApiData(response);

export async function getPaymentPricing(creditsQuantity = 1, { force = false } = {}) {
  const normalizedQuantity = Math.max(1, Number(creditsQuantity) || 1);
  const cacheKey = createRequestCacheKey('payment-pricing', {
    creditsQuantity: normalizedQuantity,
  });

  try {
    return await cachedRequest(
      cacheKey,
      async () => unwrap(
        await normalUserApi.get('/users/payments/pricing', {
          params: { creditsQuantity: normalizedQuantity },
        }),
      ),
      {
        ttlMs: PRICING_TTL_MS,
        force,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Pricing could not be loaded.'),
    );
  }
}

export function invalidatePaymentPricingCache() {
  invalidateRequestCache('payment-pricing:');
}

export async function getPaymentState(id, { force = false } = {}) {
  const cacheKey = createRequestCacheKey('payment-status', { id });

  try {
    return await cachedRequest(
      cacheKey,
      async () => unwrap(
        await normalUserApi.get(`/users/payments/${id}/status`),
      ),
      {
        // Only deduplicate overlapping status reads. This TTL is shorter than
        // the polling interval, so the next poll always sees fresh state.
        ttlMs: 100,
        force,
        persist: false,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Payment status could not be loaded.'),
    );
  }
}

export async function reconcilePayment(id) {
  try {
    const result = unwrap(
      await normalUserApi.post(`/users/payments/${id}/reconcile`),
    );

    // A successful reconciliation may change account status, credit balance,
    // activation-fee applicability and therefore pricing.
    invalidatePaymentPricingCache();
    return result;
  } catch (error) {
    throw new Error(
      getApiErrorMessage(
        error,
        'Payment confirmation could not be verified.',
      ),
    );
  }
}
