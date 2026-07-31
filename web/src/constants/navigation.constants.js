/**
 * Centralized public navigation configuration for the Nexora web application.
 *
 * The configuration defines:
 * - Public application routes.
 * - Landing-page section links.
 * - Authentication navigation actions.
 *
 * Keeping navigation metadata in one file prevents duplicated labels,
 * paths, and section identifiers across desktop and mobile navigation.
 *
 * @author Eman
 */

import { ROUTES } from './routes.constants';

/**
 * Public navigation items displayed in the main Navbar.
 *
 * Route items navigate to standalone pages.
 * Section items navigate to sections inside the public home page.
 *
 * @type {Array<{
 *     id: string,
 *     label: string,
 *     path: string,
 *     type: 'route' | 'section',
 *     sectionId?: string
 * }>}
 */
export const PUBLIC_NAVIGATION_ITEMS = [
    {
        id: 'home',
        label: 'Home',
        path: ROUTES.HOME,
        type: 'route',
    },
    {
        id: 'discover',
        label: 'Discover',
        path: ROUTES.DISCOVER,
        type: 'route',
    },
    {
        id: 'how-it-works',
        label: 'How It Works',
        path: ROUTES.HOME,
        sectionId: 'how-it-works',
        type: 'section',
    },
    {
        id: 'about',
        label: 'About',
        path: ROUTES.HOME,
        sectionId: 'about',
        type: 'section',
    },
    {
        id: 'domains',
        label: 'Domains',
        path: ROUTES.HOME,
        sectionId: 'domains',
        type: 'section',
    },
    {
        id: 'contact',
        label: 'Contact',
        path: ROUTES.HOME,
        sectionId: 'contact',
        type: 'section',
    },
];

/**
 * Authentication navigation actions.
 *
 * Authentication pages and logic remain separate from the public
 * landing-page implementation.
 *
 * @type {{
 *     LOGIN: {
 *         id: string,
 *         label: string,
 *         path: string
 *     },
 *     REGISTER: {
 *         id: string,
 *         label: string,
 *         path: string
 *     }
 * }}
 */
export const AUTH_NAVIGATION_ITEMS = {
    LOGIN: {
        id: 'login',
        label: 'Sign In',
        path: ROUTES.LOGIN,
    },

    REGISTER: {
        id: 'register',
        label: 'Get Started',
        path: ROUTES.REGISTER,
    },
};