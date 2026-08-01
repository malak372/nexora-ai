/** Personalization preference API helpers. */
import { extractApiData, getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';
export async function getPreferenceCatalog(){try{return extractApiData(await normalUserApi.get('/preferences/options'))??[];}catch(e){throw new Error(getApiErrorMessage(e,'Preference options could not be loaded.'));}}
export async function getMyPreferences(){try{return extractApiData(await normalUserApi.get('/users/preferences'));}catch(e){throw new Error(getApiErrorMessage(e,'Preferences could not be loaded.'));}}
export async function savePreferences(payload){try{return extractApiData(await normalUserApi.put('/users/preferences',payload));}catch(e){throw new Error(getApiErrorMessage(e,'Preferences could not be saved.'));}}
