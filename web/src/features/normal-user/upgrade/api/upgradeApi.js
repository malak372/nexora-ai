/** Credit checkout API. */
import { extractApiData, getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';
export async function createCreditsCheckout(payload) { try { return extractApiData(await normalUserApi.post('/users/payments/credits/checkout', payload)); } catch (e) { throw new Error(getApiErrorMessage(e, 'Premium checkout could not be created.')); } }
