/**
 * Persists the latest checkout reference before leaving Nexora for an external
 * payment provider. Some providers, browser extensions, or previously-created
 * checkout sessions may return without the expected query parameters.
 *
 * The backend remains the source of truth. This storage contains only the
 * payment identifier needed to call the authenticated reconciliation endpoint.
 */

const PAYMENT_RETURN_STORAGE_KEY = 'nexora.pendingPaymentReturn';
const MAX_REFERENCE_AGE_MS = 24 * 60 * 60 * 1000;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function storePaymentReturnReference(reference) {
  const paymentId = normalizeString(reference?.paymentId);

  if (!paymentId || paymentId === 'already-unlocked') return;

  const payload = {
    paymentId,
    paymentPurpose: normalizeString(reference?.paymentPurpose),
    ideaId: normalizeString(reference?.ideaId),
    publicationId: normalizeString(reference?.publicationId),
    createdAt: Date.now(),
  };

  try {
    window.sessionStorage.setItem(
      PAYMENT_RETURN_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Payment remains safe even when browser storage is unavailable because
    // the backend still verifies the provider session and webhook.
  }
}

export function readPaymentReturnReference() {
  try {
    const raw = window.sessionStorage.getItem(PAYMENT_RETURN_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const paymentId = normalizeString(parsed?.paymentId);
    const createdAt = Number(parsed?.createdAt);

    if (
      !paymentId ||
      !Number.isFinite(createdAt) ||
      Date.now() - createdAt > MAX_REFERENCE_AGE_MS
    ) {
      clearPaymentReturnReference();
      return null;
    }

    return {
      paymentId,
      paymentPurpose: normalizeString(parsed?.paymentPurpose),
      ideaId: normalizeString(parsed?.ideaId),
      publicationId: normalizeString(parsed?.publicationId),
      createdAt,
    };
  } catch {
    clearPaymentReturnReference();
    return null;
  }
}

export function clearPaymentReturnReference() {
  try {
    window.sessionStorage.removeItem(PAYMENT_RETURN_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}
