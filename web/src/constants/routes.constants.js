/**
 * Application route constants and dynamic route builders.
 *
 * @author Eman
 */

export const ROUTES = {
    // Public routes
    HOME: '/',
    DISCOVER: '/discover',
    GENERATE: '/generate',
    PUBLICATION_DETAILS: '/publications/:publicationId',
    ABOUT: '/about',
    CONTACT: '/contact',
    PRIVACY: '/privacy',
    TERMS: '/terms',

    // Authentication routes
    LOGIN: '/login',
    REGISTER: '/register',
    VERIFY_EMAIL: '/verify-email',
    FORGOT_PASSWORD: '/forgot-password',
    RESET_PASSWORD: '/reset-password',
};

export const buildRoute = {
    publicationDetails: (publicationId) =>
        `/publications/${publicationId}`,
};