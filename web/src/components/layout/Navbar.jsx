/**
 * Renders the primary navigation bar for Nexora public pages.
 *
 * The navigation bar provides:
 * - Nexora branding and home navigation.
 * - Public route navigation.
 * - Smooth navigation to sections on the home page.
 * - Authentication actions for login and registration.
 * - A responsive mobile navigation menu.
 * - Accessible labels and expanded-state attributes.
 *
 * Navigation items are sourced from centralized constants to prevent
 * duplicated route definitions across the application.
 *
 * @component
 * @returns {JSX.Element} The responsive public navigation bar.
 *
 * @author Eman
 */

import { Menu, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    Link,
    NavLink,
    useLocation,
    useNavigate,
} from 'react-router-dom';

import {
    AUTH_NAVIGATION_ITEMS,
    PUBLIC_NAVIGATION_ITEMS,
} from '../../constants/navigation.constants';
import { ROUTES } from '../../constants/routes.constants';

/**
 * Public application navigation bar.
 *
 * @returns {JSX.Element}
 */
export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const location = useLocation();
    const navigate = useNavigate();

    /**
     * Closes the mobile navigation menu.
     *
     * @returns {void}
     */
    const closeMenu = () => {
        setIsMenuOpen(false);
    };

    /**
     * Toggles the mobile navigation menu.
     *
     * @returns {void}
     */
    const toggleMenu = () => {
        setIsMenuOpen((currentValue) => !currentValue);
    };

    /**
     * Closes the mobile menu whenever the active location changes.
     */
    useEffect(() => {
        setIsMenuOpen(false);
    }, [location.pathname, location.hash]);

    /**
     * Scrolls to the section referenced by the current URL hash.
     */
    useEffect(() => {
        if (!location.hash) {
            return;
        }

        const sectionId = location.hash.replace('#', '');

        const sectionElement = document.getElementById(sectionId);

        if (!sectionElement) {
            return;
        }

        sectionElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    }, [location.pathname, location.hash]);

    /**
     * Navigates to a section on the home page.
     *
     * When the user is already on the home page, the URL hash is updated.
     * When the user is on another page, navigation returns to the home page
     * before scrolling to the requested section.
     *
     * @param {Object} item Navigation item configuration.
     * @param {string} item.sectionId Target section element identifier.
     * @returns {void}
     */
    const handleSectionNavigation = (item) => {
        closeMenu();

        navigate({
            pathname: ROUTES.HOME,
            hash: `#${item.sectionId}`,
        });
    };

    /**
     * Renders a public navigation item.
     *
     * Route items use React Router NavLink, while section items use buttons
     * that navigate to a specific section on the home page.
     *
     * @param {Object} item Navigation item configuration.
     * @param {string} item.id Unique navigation item identifier.
     * @param {string} item.label Displayed navigation label.
     * @param {string} item.path Destination route.
     * @param {'route'|'section'} item.type Navigation item type.
     * @param {string} [item.sectionId] Target section identifier.
     * @param {boolean} [isMobile=false] Whether the item is rendered in
     * the mobile navigation menu.
     *
     * @returns {JSX.Element}
     */
    const renderNavigationItem = (item, isMobile = false) => {
        const baseClasses = isMobile
            ? [
                'w-full rounded-xl px-4 py-3 text-left',
                'font-semibold transition',
                'hover:bg-white hover:text-nexora-primary',
            ].join(' ')
            : 'text-sm font-semibold transition-colors';

        if (item.type === 'section') {
            return (
                <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSectionNavigation(item)}
                    className={`${baseClasses} text-nexora-muted`}
                >
                    {item.label}
                </button>
            );
        }

        return (
            <NavLink
                key={item.id}
                to={item.path}
                end={item.path === ROUTES.HOME}
                onClick={closeMenu}
                className={({ isActive }) =>
                    [
                        baseClasses,
                        isActive
                            ? 'text-nexora-primary'
                            : 'text-nexora-muted hover:text-nexora-primary',
                    ].join(' ')
                }
            >
                {item.label}
            </NavLink>
        );
    };

    return (
        <header className="sticky top-0 z-50 border-b border-nexora-border/80 bg-nexora-background/95 backdrop-blur-xl">
            <div className="nexora-container">
                <div className="flex h-20 items-center justify-between">
                    <Link
                        to={ROUTES.HOME}
                        onClick={closeMenu}
                        className="flex items-center gap-3"
                        aria-label="Go to Nexora home page"
                    >
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-nexora-primary text-white shadow-soft">
                            <Sparkles
                                size={22}
                                aria-hidden="true"
                            />
                        </span>

                        <div>
                            <p className="text-xl font-extrabold tracking-tight text-nexora-text">
                                Nexora AI
                            </p>

                            <p className="text-xs font-medium text-nexora-muted">
                                Ideas built from real needs
                            </p>
                        </div>
                    </Link>

                    <nav
                        className="hidden items-center gap-7 lg:flex"
                        aria-label="Primary navigation"
                    >
                        {PUBLIC_NAVIGATION_ITEMS.map((item) =>
                            renderNavigationItem(item),
                        )}
                    </nav>

                    <div className="hidden items-center gap-3 lg:flex">
                        <Link
                            to={AUTH_NAVIGATION_ITEMS.LOGIN.path}
                            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-nexora-text transition hover:bg-nexora-cream"
                        >
                            {AUTH_NAVIGATION_ITEMS.LOGIN.label}
                        </Link>

                        <Link
                            to={AUTH_NAVIGATION_ITEMS.REGISTER.path}
                            className="nexora-button-primary py-2.5 text-sm"
                        >
                            {AUTH_NAVIGATION_ITEMS.REGISTER.label}
                        </Link>
                    </div>

                    <button
                        type="button"
                        onClick={toggleMenu}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-nexora-border bg-white text-nexora-text transition hover:bg-nexora-cream lg:hidden"
                        aria-label={
                            isMenuOpen
                                ? 'Close navigation menu'
                                : 'Open navigation menu'
                        }
                        aria-expanded={isMenuOpen}
                        aria-controls="mobile-navigation"
                    >
                        {isMenuOpen ? (
                            <X
                                size={22}
                                aria-hidden="true"
                            />
                        ) : (
                            <Menu
                                size={22}
                                aria-hidden="true"
                            />
                        )}
                    </button>
                </div>

                {isMenuOpen && (
                    <div
                        id="mobile-navigation"
                        className="border-t border-nexora-border py-5 lg:hidden"
                    >
                        <nav
                            className="flex flex-col gap-2"
                            aria-label="Mobile navigation"
                        >
                            {PUBLIC_NAVIGATION_ITEMS.map((item) =>
                                renderNavigationItem(item, true),
                            )}
                        </nav>

                        <div className="mt-5 grid grid-cols-2 gap-3">
                            <Link
                                to={AUTH_NAVIGATION_ITEMS.LOGIN.path}
                                onClick={closeMenu}
                                className="nexora-button-secondary"
                            >
                                {AUTH_NAVIGATION_ITEMS.LOGIN.label}
                            </Link>

                            <Link
                                to={AUTH_NAVIGATION_ITEMS.REGISTER.path}
                                onClick={closeMenu}
                                className="nexora-button-primary"
                            >
                                {AUTH_NAVIGATION_ITEMS.REGISTER.label}
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
}