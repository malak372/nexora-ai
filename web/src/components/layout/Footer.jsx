/**
 * Renders the main footer for Nexora public pages.
 *
 * The footer provides:
 * - Nexora branding.
 * - Public platform navigation.
 * - Contact information.
 * - Legal navigation.
 * - A dynamically generated copyright year.
 *
 * Contact information is read from the application environment variables
 * with a safe fallback value for local development.
 *
 * @component
 * @returns {JSX.Element} The public application footer.
 *
 * @author Eman
 */

import { Mail, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ROUTES } from '../../constants/routes.constants';

const currentYear = new Date().getFullYear();

const contactEmail =
  process.env.REACT_APP_CONTACT_EMAIL || 'ainexora0@gmail.com';

/**
 * Public application footer.
 *
 * @returns {JSX.Element}
 */
export default function Footer() {
    return (
        <footer className="border-t border-nexora-border bg-white">
            <div className="nexora-container py-12">
                <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
                    <div className="lg:col-span-2">
                        <Link
                            to={ROUTES.HOME}
                            className="inline-flex items-center gap-3"
                            aria-label="Go to Nexora home page"
                        >
                            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-nexora-primary text-white">
                                <Sparkles
                                    size={20}
                                    aria-hidden="true"
                                />
                            </span>

                            <span className="text-xl font-extrabold text-nexora-text">
                                Nexora AI
                            </span>
                        </Link>

                        <p className="mt-5 max-w-md leading-7 text-nexora-muted">
                            Nexora transforms real community feedback into meaningful and
                            locally relevant software project ideas.
                        </p>
                    </div>

                    <div>
                        <h2 className="font-bold text-nexora-text">
                            Platform
                        </h2>

                        <nav
                            className="mt-5 flex flex-col gap-3 text-sm text-nexora-muted"
                            aria-label="Footer platform navigation"
                        >
                            <Link
                                to={ROUTES.HOME}
                                className="transition hover:text-nexora-primary"
                            >
                                Home
                            </Link>

                            <Link
                                to={ROUTES.DISCOVER}
                                className="transition hover:text-nexora-primary"
                            >
                                Discover Ideas
                            </Link>

                            <Link
                                to={ROUTES.GENERATE}
                                className="transition hover:text-nexora-primary"
                            >
                                Generate Idea
                            </Link>

                            <Link
                                to={ROUTES.ABOUT}
                                className="transition hover:text-nexora-primary"
                            >
                                About
                            </Link>
                        </nav>
                    </div>

                    <div>
                        <h2 className="font-bold text-nexora-text">
                            Contact
                        </h2>

                        <a
                            href={`mailto:${contactEmail}`}
                            className="mt-5 flex items-center gap-2 text-sm text-nexora-muted transition hover:text-nexora-primary"
                        >
                            <Mail
                                size={17}
                                aria-hidden="true"
                            />

                            {contactEmail}
                        </a>

                        <Link
                            to={ROUTES.CONTACT}
                            className="mt-4 inline-flex text-sm font-semibold text-nexora-primary transition hover:text-nexora-primaryDark"
                        >
                            Contact us
                        </Link>
                    </div>
                </div>

                <div className="mt-10 flex flex-col gap-4 border-t border-nexora-border pt-6 text-sm text-nexora-muted sm:flex-row sm:items-center sm:justify-between">
                    <p>
                        © {currentYear} Nexora AI. All rights reserved.
                    </p>

                    <nav
                        className="flex gap-5"
                        aria-label="Legal navigation"
                    >
                        <Link
                            to={ROUTES.PRIVACY}
                            className="transition hover:text-nexora-primary"
                        >
                            Privacy
                        </Link>

                        <Link
                            to={ROUTES.TERMS}
                            className="transition hover:text-nexora-primary"
                        >
                            Terms
                        </Link>
                    </nav>
                </div>
            </div>
        </footer>
    );
}