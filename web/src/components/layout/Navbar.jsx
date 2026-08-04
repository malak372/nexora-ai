import { Menu, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
    AUTH_NAVIGATION_ITEMS,
    PUBLIC_NAVIGATION_ITEMS,
} from '../../constants/navigation.constants';
import { ROUTES } from '../../constants/routes.constants';
import VoxidenceMark from '../brand/VoxidenceMark';

const HEADER_OFFSET = 110;

function getSectionItems(items) {
    return items.filter(
        (item) => item.type === 'section' && item.sectionId,
    );
}

export default function Navbar() {
    const location = useLocation();
    const navigate = useNavigate();

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [activeSectionId, setActiveSectionId] = useState('');
    const [isScrolled, setIsScrolled] = useState(false);

    const sectionItems = useMemo(
        () => getSectionItems(PUBLIC_NAVIGATION_ITEMS),
        [],
    );

    const closeMenu = useCallback(() => {
        setIsMenuOpen(false);
    }, []);

    const scrollToSection = useCallback((sectionId) => {
        const element = document.getElementById(sectionId);

        if (!element) {
            return;
        }

        const top =
            element.getBoundingClientRect().top +
            window.scrollY -
            HEADER_OFFSET;

        window.scrollTo({
            top,
            behavior: 'smooth',
        });

        setActiveSectionId(sectionId);
    }, []);

    const handleSectionNavigation = useCallback(
        (item) => {
            closeMenu();

            if (location.pathname === ROUTES.HOME) {
                navigate(
                    {
                        pathname: ROUTES.HOME,
                        hash: `#${item.sectionId}`,
                    },
                    { replace: false },
                );

                window.setTimeout(() => {
                    scrollToSection(item.sectionId);
                }, 40);

                return;
            }

            navigate({
                pathname: ROUTES.HOME,
                hash: `#${item.sectionId}`,
            });
        },
        [closeMenu, location.pathname, navigate, scrollToSection],
    );

    useEffect(() => {
        closeMenu();
    }, [closeMenu, location.pathname, location.hash]);

    useEffect(() => {
        if (location.pathname !== ROUTES.HOME || !location.hash) {
            return;
        }

        const sectionId = location.hash.slice(1);

        const timeoutId = window.setTimeout(() => {
            scrollToSection(sectionId);
        }, 120);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [location.hash, location.pathname, scrollToSection]);

    useEffect(() => {
        if (location.pathname !== ROUTES.HOME) {
            setActiveSectionId('');
            return;
        }

        const updateActiveSection = () => {
            let currentSectionId = '';

            sectionItems.forEach((item) => {
                const element = document.getElementById(item.sectionId);

                if (!element) {
                    return;
                }

                const top = element.getBoundingClientRect().top;

                if (top <= HEADER_OFFSET + 20) {
                    currentSectionId = item.sectionId;
                }
            });

            setActiveSectionId(currentSectionId);
            setIsScrolled(window.scrollY > 24);
        };

        updateActiveSection();
        window.addEventListener('scroll', updateActiveSection, {
            passive: true,
        });

        return () => {
            window.removeEventListener('scroll', updateActiveSection);
        };
    }, [location.pathname, sectionItems]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                closeMenu();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeMenu]);

    return (
        <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
            <div
                className={`mx-auto flex w-full max-w-7xl items-center justify-between rounded-[1.4rem] border px-4 py-3 transition-all duration-300 sm:px-5 ${
                    isScrolled
                        ? 'border-[#dfeeea] bg-white/88 shadow-[0_20px_60px_rgba(42,77,67,0.12)] backdrop-blur-xl'
                        : 'border-white/70 bg-white/70 shadow-[0_12px_40px_rgba(42,77,67,0.08)] backdrop-blur-lg'
                }`}
            >
                <Link
                    to={ROUTES.HOME}
                    className="vox-navbar-brand group flex items-center gap-3"
                    aria-label="Go to Voxidence home page"
                >
                    <span className="vox-navbar-logo flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#69b7b1] via-[#5cbdb9] to-[#4fa9a4] text-white shadow-[0_12px_28px_rgba(47,119,116,0.24)]">
                        <VoxidenceMark size={25} />
                    </span>

                    <div className="min-w-0">
                        <p className="text-[1.02rem] font-black tracking-[-0.03em] text-[#223532]">
                            Voxidence
                        </p>
                        <p className="hidden text-[0.72rem] font-semibold text-[#6d817d] md:block">
                            Turning Community Voices into Evidence-Based Ideas.
                        </p>
                    </div>
                </Link>

                <nav className="hidden items-center gap-2 lg:flex">
                    {PUBLIC_NAVIGATION_ITEMS.map((item) => {
                        const isSection = item.type === 'section';
                        const isActive = isSection
                            ? activeSectionId === item.sectionId &&
                              location.pathname === ROUTES.HOME
                            : location.pathname === item.path &&
                              !location.hash;

                        if (isSection) {
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleSectionNavigation(item)}
                                    className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                                        isActive
                                            ? 'bg-[#edf8f6] text-[#2e746f]'
                                            : 'text-[#5e7470] hover:bg-[#f4faf8] hover:text-[#2e746f]'
                                    }`}
                                >
                                    {item.label}
                                </button>
                            );
                        }

                        return (
                            <Link
                                key={item.id}
                                to={item.path}
                                className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                                    isActive
                                        ? 'bg-[#edf8f6] text-[#2e746f]'
                                        : 'text-[#5e7470] hover:bg-[#f4faf8] hover:text-[#2e746f]'
                                }`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="hidden items-center gap-3 lg:flex">
                    <Link
                        to={AUTH_NAVIGATION_ITEMS.LOGIN.path}
                        className="rounded-full px-4 py-2 text-sm font-bold text-[#45635f] transition hover:bg-[#f4faf8] hover:text-[#2e746f]"
                    >
                        {AUTH_NAVIGATION_ITEMS.LOGIN.label}
                    </Link>

                    <Link
                        to={AUTH_NAVIGATION_ITEMS.REGISTER.path}
                        className="vox-navbar-cta group inline-flex items-center justify-center gap-2 rounded-full border border-[#5cbdb9]/35 bg-gradient-to-r from-[#69b7b1] via-[#5cbdb9] to-[#4fa9a4] px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_16px_35px_rgba(47,119,116,0.22)] transition hover:-translate-y-0.5"
                    >
                        <span className="vox-navbar-cta-logo"><VoxidenceMark size={17} /></span>
                        {AUTH_NAVIGATION_ITEMS.REGISTER.label}
                    </Link>
                </div>

                <button
                    type="button"
                    onClick={() => setIsMenuOpen((value) => !value)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#dcece8] bg-white/85 text-[#34504b] shadow-sm lg:hidden"
                    aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                    aria-expanded={isMenuOpen}
                >
                    {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
            </div>

            {isMenuOpen && (
                <div className="mx-auto mt-3 w-full max-w-7xl rounded-[1.5rem] border border-[#deece8] bg-white/95 p-4 shadow-[0_18px_45px_rgba(42,77,67,0.12)] backdrop-blur-xl lg:hidden">
                    <nav className="flex flex-col gap-2">
                        {PUBLIC_NAVIGATION_ITEMS.map((item) => {
                            if (item.type === 'section') {
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => handleSectionNavigation(item)}
                                        className="rounded-2xl px-4 py-3 text-left text-sm font-bold text-[#48635f] transition hover:bg-[#f4faf8] hover:text-[#2e746f]"
                                    >
                                        {item.label}
                                    </button>
                                );
                            }

                            return (
                                <Link
                                    key={item.id}
                                    to={item.path}
                                    onClick={closeMenu}
                                    className="rounded-2xl px-4 py-3 text-sm font-bold text-[#48635f] transition hover:bg-[#f4faf8] hover:text-[#2e746f]"
                                >
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-4 grid gap-2 border-t border-[#edf4f2] pt-4">
                        <Link
                            to={AUTH_NAVIGATION_ITEMS.LOGIN.path}
                            onClick={closeMenu}
                            className="rounded-2xl border border-[#e3efec] px-4 py-3 text-center text-sm font-bold text-[#3d5c57]"
                        >
                            {AUTH_NAVIGATION_ITEMS.LOGIN.label}
                        </Link>

                        <Link
                            to={AUTH_NAVIGATION_ITEMS.REGISTER.path}
                            onClick={closeMenu}
                            className="rounded-2xl bg-gradient-to-r from-[#69b7b1] via-[#5cbdb9] to-[#4fa9a4] px-4 py-3 text-center text-sm font-extrabold text-white"
                        >
                            {AUTH_NAVIGATION_ITEMS.REGISTER.label}
                        </Link>
                    </div>
                </div>
            )}
        </header>
    );
}