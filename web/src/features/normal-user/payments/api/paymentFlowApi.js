import { extractApiData,getApiErrorMessage,normalUserApi } from '../../shared/api/normalUserApi';
const unwrap=(r)=>extractApiData(r);
export async function getPaymentPricing(creditsQuantity=1){try{return unwrap(await normalUserApi.get('/users/payments/pricing',{params:{creditsQuantity}}));}catch(e){throw new Error(getApiErrorMessage(e,'Pricing could not be loaded.'));}}
export async function getPaymentState(id){try{return unwrap(await normalUserApi.get(`/users/payments/${id}/status`));}catch(e){throw new Error(getApiErrorMessage(e,'Payment status could not be loaded.'));}}
export async function reconcilePayment(id){try{return unwrap(await normalUserApi.post(`/users/payments/${id}/reconcile`));}catch(e){throw new Error(getApiErrorMessage(e,'Payment confirmation could not be verified.'));}}
