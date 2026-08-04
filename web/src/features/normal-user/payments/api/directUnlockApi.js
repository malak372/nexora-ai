import {
    getApiErrorMessage,
    normalUserApi,
} from '../../shared/api/normalUserApi';

export async function createDirectUnlockCheckout(payload) {
    try {
        const response = await normalUserApi.post(
            '/users/payments/direct-unlock/checkout',
            payload,
        );

        return response?.data?.data ?? response?.data;
    } catch (error) {
        throw new Error(
            getApiErrorMessage(
                error,
                'Checkout could not be created.',
            ),
        );
    }
}

export async function unlockIdeaWithCredit(ideaId) {
    try {
        const response = await normalUserApi.post(
            `/users/ideas/${ideaId}/outputs/unlock-with-credit`,
        );

        return response?.data?.data ?? response?.data;
    } catch (error) {
        throw new Error(
            getApiErrorMessage(
                error,
                'The idea could not be unlocked with a credit.',
            ),
        );
    }
}