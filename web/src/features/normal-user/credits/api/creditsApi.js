import {
    extractApiData,
    getApiErrorMessage,
    normalUserApi,
} from '../../shared/api/normalUserApi';

export async function createCreditsCheckout(payload) {
    try {
        return extractApiData(
            await normalUserApi.post('/users/payments/credits/checkout', payload),
        );
    } catch (error) {
        throw new Error(
            getApiErrorMessage(error, 'Credit checkout could not be created.'),
        );
    }
}
