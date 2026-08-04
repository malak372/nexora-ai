/**
 * Renders the main footer for Nexora public pages.
 *
 * The footer provides:
 * - Nexora branding and platform description.
 * - Smooth navigation to public landing-page sections.
 * - Direct contact information.
 * - A dynamically generated copyright year.
 *
 * Landing-page navigation uses URL hashes so users can navigate to
 * sections from both the home page and other future public routes.
 *
 * @component
 * @returns {JSX.Element} The public application footer.
 *
 * @author Eman
 */

import {
    Mail,
    } from 'lucide-react';
import {
    Link,
    useLocation,
    useNavigate,
} from 'react-router-dom';

import { ROUTES } from '../../constants/routes.constants';
import VoxidenceMark from '../brand/VoxidenceMark';

/**
 * Current year displayed in the copyright notice.
 *
 * @type {number}
 */
const CURRENT_YEAR = new Date().getFullYear();

/**
 * Public contact email.
 *
 * The value can be configured using REACT_APP_CONTACT_EMAIL.
 *
 * @type {string}
 */
const CONTACT_EMAIL =
    process.env.REACT_APP_CONTACT_EMAIL || 'ainexora0@gmail.com';

/**
 * Footer links that navigate to sections inside the public home page.
 *
 * @type {Array<{
 *     id: string,
 *     label: string,
 *     sectionId: string
 * }>}
 */
const FOOTER_SECTION_LINKS = [
    {
        id: 'how-it-works',
        label: 'How It Works',
        sectionId: 'how-it-works',
    },
    {
        id: 'about',
        label: 'About Voxidence',
        sectionId: 'about',
    },
    {
        id: 'domains',
        label: 'Explore Domains',
        sectionId: 'domains',
    },
    {
        id: 'contact',
        label: 'Contact',
        sectionId: 'contact',
    },
];

/**
 * Public application footer.
 *
 * @returns {JSX.Element}
 */
export default function Footer() {
    const location = useLocation();
    const navigate = useNavigate();

    /**
     * Navigates to a section inside the public home page.
     *
     * When the user is already on the home page, the section is scrolled
     * into view directly. Otherwise, navigation returns to the home page
     * with the appropriate URL hash.
     *
     * @param {string} sectionId - Destination section identifier.
     * @returns {void}
     */
    const navigateToSection = (sectionId) => {
        const destination = {
            pathname: ROUTES.HOME,
            hash: `#${sectionId}`,
        };

        if (location.pathname !== ROUTES.HOME) {
            navigate(destination);
            return;
        }

        navigate(destination);

        document.getElementById(sectionId)?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    };

    return (
        <footer className="border-t border-nexora-border bg-white">
            <div className="nexora-container py-12">
                <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
                    {/* Nexora brand */}
                    <div className="lg:col-span-2">
                        <Link
                            to={ROUTES.HOME}
                            className="group inline-flex items-center gap-3"
                            aria-label="Go to Voxidence home page"
                        >
                            <span className="voxidence-brand-mark flex h-11 w-11 items-center justify-center rounded-2xl bg-[#5cbdb9] text-white shadow-soft transition duration-300 group-hover:-rotate-3 group-hover:scale-105">
                                <VoxidenceMark size={24} />
                            </span>

                            <span className="text-xl font-extrabold text-nexora-text">
                                Voxidence
                            </span>
                        </Link>

                        <p className="mt-5 max-w-md leading-7 text-nexora-muted">
                            Voxidence transforms real community feedback into
                            meaningful, evidence-driven, and locally relevant
                            software project ideas.
                        </p>
                    </div>

                    {/* Landing-page navigation */}
                    <div>
                        <h2 className="font-bold text-nexora-text">
                            Platform
                        </h2>

                        <nav
                            className="mt-5 flex flex-col items-start gap-3 text-sm text-nexora-muted"
                            aria-label="Footer platform navigation"
                        >
                            <Link
                                to={ROUTES.HOME}
                                className="transition hover:text-nexora-primary"
                            >
                                Home
                            </Link>

                            {FOOTER_SECTION_LINKS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() =>
                                        navigateToSection(item.sectionId)
                                    }
                                    className="text-left transition hover:text-nexora-primary"
                                >
                                    {item.label}
                                </button>
                            ))}
                        </nav>
                    </div>

                    {/* Contact information */}
                    <div>
                        <h2 className="font-bold text-nexora-text">
                            Contact
                        </h2>

                        <a
                            href={`mailto:${CONTACT_EMAIL}`}
                            className="mt-5 flex items-start gap-2 break-all text-sm leading-6 text-nexora-muted transition hover:text-nexora-primary"
                            aria-label={`Email Nexora at ${CONTACT_EMAIL}`}
                        >
                            <Mail
                                className="mt-0.5 shrink-0"
                                size={17}
                                aria-hidden="true"
                            />

                            <span>{CONTACT_EMAIL}</span>
                        </a>

                        <button
                            type="button"
                            onClick={() => navigateToSection('contact')}
                            className="mt-4 inline-flex text-sm font-semibold text-nexora-primary transition hover:text-nexora-primaryDark"
                        >
                            Contact the Nexora team
                        </button>
                    </div>
                </div>

                {/* Footer bottom */}
                <div className="mt-10 flex flex-col gap-3 border-t border-nexora-border pt-6 text-sm text-nexora-muted sm:flex-row sm:items-center sm:justify-between">
                    <p>
                        © {CURRENT_YEAR} Voxidence. All rights reserved.
                    </p>

                    <p>
                        Ideas built from real needs.
                    </p>
                </div>
            </div>
        </footer>
    );
}