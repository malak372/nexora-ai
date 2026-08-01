/**
 * Contact-message API functions used by the public Nexora landing page.
 *
 * The public endpoint accepts guest messages without requiring authentication.
 * Keeping the request in a dedicated module prevents the presentation layer
 * from depending directly on Axios implementation details.
 *
 * @author Eman
 */

import { apiClient } from '../../../api/client';

/**
 * Submits one public Contact Us message.
 *
 * @param {{
 *   fullName: string,
 *   email: string,
 *   subject: string,
 *   message: string,
 * }} payload Normalized contact form values.
 * @returns {Promise<object>} The response returned by the Nexora API.
 */
export async function submitContactMessage(payload) {
    const response = await apiClient.post('/contact', payload);

    return response.data;
}