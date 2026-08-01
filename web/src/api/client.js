/**
 * Configures the shared Axios client used by the Nexora web application.
 *
 * @author Eman
 */

import axios from 'axios';

const API_BASE_URL =
    process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 15000,
    withCredentials: true,
    headers: {
        Accept: 'application/json',
    },
});