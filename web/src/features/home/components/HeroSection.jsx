/**
 * Renders the main hero section for the Nexora landing page.
 *
 * The hero introduces the platform, presents the primary calls to action,
 * highlights Nexora's core value, and includes a visual explanation of the
 * idea discovery process.
 *
 * Motion preferences are respected by disabling entrance animations when
 * the user has enabled reduced motion at the operating system level.
 *
 * @component
 * @returns {JSX.Element} The landing page hero section.
 *
 * @author Eman
 */

import { motion, useReducedMotion } from 'framer-motion';
import {
    ArrowRight,
    Search,
    Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { ROUTES } from '../../../constants/routes.constants';
import {
    HERO_CONTENT,
    HERO_HIGHLIGHTS,
} from '../constants/home.constants';
import HeroProcessCard from './HeroProcessCard';

/**
 * Main landing page hero section.
 *
 * @returns {JSX.Element}
 */
export default function HeroSection() {
    const shouldReduceMotion = useReducedMotion();

    const contentAnimation = shouldReduceMotion
        ? {}
        : {
            initial: {
                opacity: 0,
                y: 30,
            },
            animate: {
                opacity: 1,
                y: 0,
            },
            transition: {
                duration: 0.7,
            },
        };

    const cardAnimation = shouldReduceMotion
        ? {}
        : {
            initial: {
                opacity: 0,
                scale: 0.94,
            },
            animate: {
                opacity: 1,
                scale: 1,
            },
            transition: {
                duration: 0.8,
                delay: 0.15,
            },
        };

    return (
        <section className="relative overflow-hidden">
            <div
                className="absolute inset-0 -z-10"
                aria-hidden="true"
            >
                <div className="absolute -left-24 top-24 h-80 w-80 rounded-full bg-nexora-primary/10 blur-3xl" />

                <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-nexora-accent/10 blur-3xl" />
            </div>

            <div className="nexora-container grid min-h-[calc(100vh-80px)] items-center gap-14 py-20 lg:grid-cols-2">
                <motion.div {...contentAnimation}>
                    <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-nexora-border bg-white px-4 py-2 text-sm font-semibold text-nexora-primary shadow-soft">
                        <Sparkles
                            size={17}
                            aria-hidden="true"
                        />

                        {HERO_CONTENT.badge}
                    </div>

                    <h1 className="max-w-3xl text-5xl font-extrabold leading-[1.08] tracking-tight text-nexora-text sm:text-6xl lg:text-7xl">
                        {HERO_CONTENT.titlePrefix}{' '}

                        <span className="text-nexora-primary">
                            {HERO_CONTENT.highlightedTitle}
                        </span>
                    </h1>

                    <p className="mt-7 max-w-2xl text-lg leading-8 text-nexora-muted">
                        {HERO_CONTENT.description}
                    </p>

                    <div className="mt-10 flex flex-wrap gap-4">
                        <Link
                            to={ROUTES.GENERATE}
                            className="nexora-button-primary gap-2"
                        >
                            {HERO_CONTENT.primaryActionLabel}

                            <ArrowRight
                                size={19}
                                aria-hidden="true"
                            />
                        </Link>

                        <Link
                            to={ROUTES.DISCOVER}
                            className="nexora-button-secondary gap-2"
                        >
                            <Search
                                size={19}
                                aria-hidden="true"
                            />

                            {HERO_CONTENT.secondaryActionLabel}
                        </Link>
                    </div>

                    <div className="mt-12 flex flex-wrap items-center gap-8">
                        {HERO_HIGHLIGHTS.map((highlight, index) => (
                            <div
                                key={highlight.id}
                                className="contents"
                            >
                                <div>
                                    <p className="text-3xl font-extrabold text-nexora-text">
                                        {highlight.title}
                                    </p>

                                    <p className="mt-1 text-sm text-nexora-muted">
                                        {highlight.description}
                                    </p>
                                </div>

                                {index < HERO_HIGHLIGHTS.length - 1 && (
                                    <div
                                        className="hidden h-14 w-px bg-nexora-border sm:block"
                                        aria-hidden="true"
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </motion.div>

                <motion.div {...cardAnimation}>
                    <HeroProcessCard />
                </motion.div>
            </div>
        </section>
    );
}