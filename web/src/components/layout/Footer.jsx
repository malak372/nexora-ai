import {
    ArrowUpRight,
    Mail,
    Sparkles,
} from 'lucide-react';
import {
    Link,
    useLocation,
    useNavigate,
} from 'react-router-dom';

import { ROUTES } from '../../constants/routes.constants';
import VoxidenceMark from '../brand/VoxidenceMark';

const CURRENT_YEAR = new Date().getFullYear();

const CONTACT_EMAIL =
    process.env.REACT_APP_CONTACT_EMAIL || 'voxidence@gmail.com';

const FOOTER_SECTION_LINKS = [
    {
        id: 'how-it-works',
        label: 'How it works',
        sectionId: 'how-it-works',
    },
    {
        id: 'about',
        label: 'Why Voxidence',
        sectionId: 'about',
    },
    {
        id: 'domains',
        label: 'Opportunity domains',
        sectionId: 'domains',
    },
    {
        id: 'featured-ideas',
        label: 'Community ideas',
        sectionId: 'featured-ideas',
    },
];

export default function Footer() {
    const location = useLocation();
    const navigate = useNavigate();

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

        window.setTimeout(() => {
            const element = document.getElementById(sectionId);

            if (!element) {
                return;
            }

            const top =
                element.getBoundingClientRect().top +
                window.scrollY -
                100;

            window.scrollTo({
                top,
                behavior: 'smooth',
            });
        }, 40);
    };

    return (
        <footer className="vox-footer">
            <div className="nexora-container">
                <div className="vox-footer__surface">
                    <div className="vox-footer__brand-column">
                        <Link
                            to={ROUTES.HOME}
                            className="vox-footer__brand"
                            aria-label="Go to Voxidence home page"
                        >
                            <VoxidenceMark
                                size={54}
                                className="vox-footer__brand-mark"
                            />

                            <span className="vox-footer__brand-copy">
                                <strong>Voxidence</strong>

                                <small>
                                    Community voices. Verified direction.
                                </small>
                            </span>
                        </Link>

                        <p className="vox-footer__statement">
                            We listen before we generate — turning recurring
                            public needs into software ideas worth building.
                        </p>
                    </div>

                    <nav
                        className="vox-footer__navigation"
                        aria-label="Footer navigation"
                    >
                        <p className="vox-footer__label">
                            <Sparkles size={14} aria-hidden="true" />
                            Explore Voxidence
                        </p>

                        <div className="vox-footer__links">
                            {FOOTER_SECTION_LINKS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() =>
                                        navigateToSection(item.sectionId)
                                    }
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </nav>

                    <div className="vox-footer__contact">
                        <p className="vox-footer__label">
                            Start a conversation
                        </p>

                        <p className="vox-footer__contact-copy">
                            Have a question, feedback, or collaboration in mind?
                        </p>

                        <a
                            href={`mailto:${CONTACT_EMAIL}`}
                            className="vox-footer__email"
                        >
                            <span>
                                <Mail size={17} aria-hidden="true" />
                            </span>

                            {CONTACT_EMAIL}
                        </a>

                        <button
                            type="button"
                            onClick={() => navigateToSection('contact')}
                            className="vox-footer__contact-action"
                        >
                            Contact our team
                            <ArrowUpRight size={17} aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <div className="vox-footer__bottom">
                    <p>© {CURRENT_YEAR} <span className="vox-footer__copyright-brand">Voxidence</span>. All rights reserved.</p>

                    <p>
                        From community signal to evidence-backed direction.
                    </p>
                </div>
            </div>
        </footer>
    );
}