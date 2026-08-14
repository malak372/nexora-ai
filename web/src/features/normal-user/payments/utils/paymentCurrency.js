import { getMyPreferences } from '../../preferences/api/preferencesApi';

export const PAYMENT_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
];

const STORAGE_KEY = 'voxidence_payment_currency';
const CODES = new Set(PAYMENT_CURRENCIES.map((currency) => currency.code));

export function normalizePaymentCurrency(currency, fallback = 'USD') {
  const normalized = String(currency || '').trim().toUpperCase();
  const fallbackNormalized = String(fallback || 'USD').trim().toUpperCase();

  if (CODES.has(normalized)) return normalized;
  return CODES.has(fallbackNormalized) ? fallbackNormalized : 'USD';
}

export function getStoredPaymentCurrency() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)?.trim().toUpperCase();
    return value && CODES.has(value) ? value : 'USD';
  } catch {
    return 'USD';
  }
}

export function storePaymentCurrency(currency) {
  const value = normalizePaymentCurrency(currency);

  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    return value;
  }

  return value;
}

export function getPaymentCurrencyOptions(pricing) {
  const fromServer = Array.isArray(pricing?.supportedCurrencies)
    ? pricing.supportedCurrencies
    : [];

  return fromServer.length ? fromServer : PAYMENT_CURRENCIES;
}


export async function loadPreferredPaymentCurrency({ force = false } = {}) {
  try {
    const preferences = await getMyPreferences({ force });
    return storePaymentCurrency(
      normalizePaymentCurrency(
        preferences?.paymentCurrency,
        getStoredPaymentCurrency(),
      ),
    );
  } catch {
    return getStoredPaymentCurrency();
  }
}

export function syncPaymentCurrencyFromPreferences(preferences) {
  return storePaymentCurrency(
    normalizePaymentCurrency(
      preferences?.paymentCurrency,
      getStoredPaymentCurrency(),
    ),
  );
}
