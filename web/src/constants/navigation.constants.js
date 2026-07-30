/**
 * Public navigation configuration.
 *
 * @author Eman
 */

import { ROUTES } from './routes.constants';

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
        path: ROUTES.ABOUT,
        type: 'route',
    },
    {
        id: 'contact',
        label: 'Contact',
        path: ROUTES.CONTACT,
        type: 'route',
    },
];

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