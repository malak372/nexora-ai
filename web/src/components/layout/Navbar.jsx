/**
 * Renders the primary navigation bar for Nexora public pages.
 *
 * The navigation bar provides:
 * - Nexora branding and home navigation.
 * - Public route and landing-page section navigation.
 * - Active-section tracking while scrolling.
 * - Authentication links without modifying authentication logic.
 * - A responsive and accessible mobile navigation menu.
 *
 * Navigation items are sourced from centralized constants to prevent
 * duplicated route definitions across the application.
 *
 * @component
 * @returns {JSX.Element} The responsive public navigation bar.
 *
 * @author Eman
 */

import { Menu, X } from 'lucide-react';
import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
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
import VoxidenceMark from '../brand/VoxidenceMark';

/**
 * Scroll offset used when detecting the currently visible section.
 *
 * The value accounts for the sticky navigation-bar height.
 *
 * @type {number}
 */
const SECTION_SCROLL_OFFSET = 130;

/**
 * Extracts section-based navigation items.
 *
 * @param {Array<Object>} navigationItems - Public navigation configuration.
 * @returns {Array<Object>} Section navigation items only.
 */
function getSectionItems(navigationItems) {
    return navigationItems.filter(
        (item) => item.type === 'section' && item.sectionId,
    );
}

/**
 * Public application navigation bar.
 *
 * @returns {JSX.Element}
 */
export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [activeSectionId, setActiveSectionId] = useState('');

    const location = useLocation();
    const navigate = useNavigate();

    /**
     * Memoized section items used by the scroll-spy behavior.
     */
    const sectionItems = useMemo(
        () => getSectionItems(PUBLIC_NAVIGATION_ITEMS),
        [],
    );

    /**
     * Closes the mobile navigation menu.
     *
     * @returns {void}
     */
    const closeMenu = useCallback(() => {
        setIsMenuOpen(false);
    }, []);

    /**
     * Toggles the mobile navigation menu.
     *
     * @returns {void}
     */
    const toggleMenu = useCallback(() => {
        setIsMenuOpen((currentValue) => !currentValue);
    }, []);

    /**
     * Scrolls to a landing-page section.
     *
     * @param {string} sectionId - Target section identifier.
     * @returns {void}
     */
    const scrollToSection = useCallback((sectionId) => {
        const sectionElement = document.getElementById(sectionId);

        if (!sectionElement) {
            return;
        }

        sectionElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });

        setActiveSectionId(sectionId);
    }, []);

    /**
     * Navigates to a section on the home page.
     *
     * When the user is already on the home page, the section is scrolled
     * into view immediately. Otherwise, navigation returns to the home page
     * before the hash-based scrolling behavior runs.
     *
     * @param {Object} item - Navigation item configuration.
     * @param {string} item.sectionId - Target section identifier.
     * @returns {void}
     */
    const handleSectionNavigation = useCallback(
        (item) => {
            closeMenu();

            if (location.pathname === ROUTES.HOME) {
                navigate(
                    {
                        pathname: ROUTES.HOME,
                        hash: `#${item.sectionId}`,
                    },
                    {
                        replace: false,
                    },
                );

                scrollToSection(item.sectionId);
                return;
            }

            navigate({
                pathname: ROUTES.HOME,
                hash: `#${item.sectionId}`,
            });
        },
        [
            closeMenu,
            location.pathname,
            navigate,
            scrollToSection,
        ],
    );

    /**
     * Closes the mobile menu whenever the active route changes.
     */
    useEffect(() => {
        closeMenu();
    }, [
        closeMenu,
        location.pathname,
        location.hash,
    ]);

    /**
     * Scrolls to the section referenced by the current URL hash.
     *
     * A short animation frame delay ensures the destination page has
     * completed rendering before the section is queried.
     */
    useEffect(() => {
        if (
            location.pathname !== ROUTES.HOME ||
            !location.hash
        ) {
            return undefined;
        }

        const sectionId = location.hash.slice(1);

        const animationFrameId = window.requestAnimationFrame(() => {
            scrollToSection(sectionId);
        });

        return () => {
            window.cancelAnimationFrame(animationFrameId);
        };
    }, [
        location.hash,
        location.pathname,
        scrollToSection,
    ]);

    /**
     * Tracks the currently visible landing-page section.
     */
    useEffect(() => {
        if (location.pathname !== ROUTES.HOME) {
            setActiveSectionId('');
            return undefined;
        }

        const updateActiveSection = () => {
            let currentSectionId = '';

            sectionItems.forEach((item) => {
                const sectionElement = document.getElementById(
                    item.sectionId,
                );

                if (!sectionElement) {
                    return;
                }

                const sectionTop =
                    sectionElement.getBoundingClientRect().top;

                if (sectionTop <= SECTION_SCROLL_OFFSET) {
                    currentSectionId = item.sectionId;
                }
            });

            setActiveSectionId(currentSectionId);
        };

        updateActiveSection();

        window.addEventListener('scroll', updateActiveSection, {
            passive: true,
        });

        return () => {
            window.removeEventListener(
                'scroll',
                updateActiveSection,
            );
        };
    }, [
        location.pathname,
        sectionItems,
    ]);

    /**
     * Closes the mobile menu when the Escape key is pressed.
     */
    useEffect(() => {
        if (!isMenuOpen) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                closeMenu();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener(
                'keydown',
                handleKeyDown,
            );
        };
    }, [
        closeMenu,
        isMenuOpen,
    ]);

    /**
     * Prevents the page behind the mobile menu from scrolling.
     */
    useEffect(() => {
        if (!isMenuOpen) {
            return undefined;
        }

        const previousOverflow = document.body.style.overflow;

        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isMenuOpen]);

    /**
     * Renders a public navigation item.
     *
     * Route items use React Router NavLink, while section items use buttons
     * that navigate to a specific section on the public home page.
     *
     * @param {Object} item - Navigation item configuration.
     * @param {string} item.id - Unique navigation item identifier.
     * @param {string} item.label - Displayed navigation label.
     * @param {string} [item.path] - Destination route.
     * @param {'route'|'section'} item.type - Navigation item type.
     * @param {string} [item.sectionId] - Target section identifier.
     * @param {boolean} [isMobile=false] - Mobile rendering mode.
     *
     * @returns {JSX.Element}
     */
    const renderNavigationItem = (
        item,
        isMobile = false,
    ) => {
        const baseClasses = isMobile
            ? [
                'w-full rounded-xl px-4 py-3 text-left',
                'font-semibold transition duration-200',
                'hover:bg-white hover:text-nexora-primary',
            ].join(' ')
            : [
                'relative text-sm font-semibold',
                'transition-colors duration-200',
            ].join(' ');

        if (item.type === 'section') {
            const isActive =
                location.pathname === ROUTES.HOME &&
                activeSectionId === item.sectionId;

            return (
                <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                        handleSectionNavigation(item)
                    }
                    className={[
                        baseClasses,
                        isActive
                            ? 'text-nexora-primary'
                            : 'text-nexora-muted hover:text-nexora-primary',
                        !isMobile && isActive
                            ? 'after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-nexora-primary'
                            : '',
                    ].join(' ')}
                    aria-current={
                        isActive ? 'location' : undefined
                    }
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
                        !isMobile && isActive
                            ? 'after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-nexora-primary'
                            : '',
                    ].join(' ')
                }
            >
                {item.label}
            </NavLink>
        );
    };

    return (
        <header className="sticky top-0 z-50 border-b border-nexora-border/80 bg-nexora-background/90 shadow-[0_8px_30px_rgba(47, 119, 116,0.05)] backdrop-blur-xl">
            <div className="nexora-container">
                <div className="flex h-20 items-center justify-between">
                    {/* Nexora brand */}
                    <Link
                        to={ROUTES.HOME}
                        onClick={closeMenu}
                        className="group flex items-center gap-3"
                        aria-label="Go to Voxidence home page"
                    >
                        <span className="voxidence-brand-mark flex h-11 w-11 items-center justify-center rounded-2xl bg-[#5cbdb9] text-white shadow-soft transition duration-300 group-hover:-rotate-3 group-hover:scale-105">
                            <VoxidenceMark size={25} />
                        </span>

                        <div>
                            <p className="text-xl font-extrabold tracking-tight text-nexora-text">
                                Voxidence
                            </p>

                            <p className="text-xs font-medium text-nexora-muted">
                                Ideas built from real needs
                            </p>
                        </div>
                    </Link>

                    {/* Desktop public navigation */}
                    <nav
                        className="hidden items-center gap-7 lg:flex"
                        aria-label="Primary navigation"
                    >
                        {PUBLIC_NAVIGATION_ITEMS.map((item) =>
                            renderNavigationItem(item),
                        )}
                    </nav>

                    {/* Existing authentication actions */}
                    <div className="hidden items-center gap-3 lg:flex">
                        <Link
                            to={AUTH_NAVIGATION_ITEMS.LOGIN.path}
                            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-nexora-text transition duration-200 hover:bg-white/80 hover:text-nexora-primary"
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

                    {/* Mobile menu control */}
                    <button
                        type="button"
                        onClick={toggleMenu}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-nexora-border bg-white/85 text-nexora-text shadow-sm transition hover:border-nexora-primary/30 hover:text-nexora-primary lg:hidden"
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

                {/* Mobile navigation */}
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