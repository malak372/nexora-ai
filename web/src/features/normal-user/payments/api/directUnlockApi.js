import { getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';
export async function createDirectUnlockCheckout(payload){try{const r=await normalUserApi.post('/users/payments/direct-unlock/checkout',payload);return r?.data?.data??r?.data;}catch(e){throw new Error(getApiErrorMessage(e,'Checkout could not be created.'));}}
