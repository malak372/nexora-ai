/**
 * Renders the primary hero section of the Nexora public landing page.
 *
 * The section introduces the platform, presents the main call-to-action
 * buttons, displays key platform highlights, and includes the visual
 * AI process card.
 *
 * Framer Motion is used to provide subtle entrance animations while
 * respecting the user's reduced-motion accessibility preference.
 *
 * @component
 * @returns {JSX.Element} The main landing-page hero section.
 *
 * @author Eman
 */

import { motion, useReducedMotion } from 'framer-motion';
import {
    ArrowDownRight,
    Mail,
    Sparkles,
} from 'lucide-react';

import {
    HERO_CONTENT,
    HERO_HIGHLIGHTS,
} from '../constants/home.constants';
import HeroProcessCard from './HeroProcessCard';

/**
 * Smoothly scrolls the page to a specific section.
 *
 * The optional chaining operator prevents runtime errors when the
 * requested section does not exist in the current document.
 *
 * @param {string} sectionId - The ID of the destination section.
 * @returns {void}
 */
function scrollToSection(sectionId) {
    document.getElementById(sectionId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
    });
}

/**
 * Displays the introductory content of the Nexora landing page.
 *
 * The hero includes:
 * - An AI-powered platform badge.
 * - The main Nexora heading and description.
 * - Navigation buttons for the process and contact sections.
 * - Key platform highlights.
 * - A visual representation of the AI discovery workflow.
 *
 * @returns {JSX.Element}
 */
export default function HeroSection() {
    /**
     * Detects whether the user prefers reduced animation.
     *
     * When enabled, entrance animations are disabled to improve
     * accessibility and user comfort.
     */
    const shouldReduceMotion = useReducedMotion();

    /**
     * Shared animation configuration for the hero textual content.
     *
     * An empty configuration is used when reduced motion is enabled.
     */
    const reveal = shouldReduceMotion
        ? {}
        : {
            initial: {
                opacity: 0,
                y: 28,
            },
            animate: {
                opacity: 1,
                y: 0,
            },
            transition: {
                duration: 0.75,
            },
        };

    return (
        <section
            id="home"
            className="hero-grid relative isolate overflow-hidden"
            aria-labelledby="hero-heading"
        >
            {/* Decorative animated background elements */}
            <div
                className="hero-orb hero-orb-one"
                aria-hidden="true"
            />

            <div
                className="hero-orb hero-orb-two"
                aria-hidden="true"
            />

            <div
                className="hero-orb hero-orb-three"
                aria-hidden="true"
            />

            <div
                className="hero-noise"
                aria-hidden="true"
            />

            <div className="nexora-container grid min-h-[calc(100vh-80px)] items-center gap-16 py-20 lg:grid-cols-[1.05fr_.95fr] lg:py-24">
                {/* Hero textual content */}
                <motion.div
                    {...reveal}
                    className="relative z-10"
                >
                    {/* Platform badge */}
                    <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#ded1ff] bg-white/80 px-4 py-2 text-sm font-bold text-[#7555c7] shadow-[0_12px_35px_rgba(126,87,194,0.12)] backdrop-blur-xl">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#eee6ff] to-[#dff3ff]">
                            <Sparkles
                                size={15}
                                className="text-[#7c5bd4]"
                                aria-hidden="true"
                            />
                        </span>

                        {HERO_CONTENT.badge}
                    </div>

                    {/* Main hero heading */}
                    <h1
                        id="hero-heading"
                        className="max-w-4xl text-5xl font-black leading-[1.02] tracking-[-0.045em] text-[#211b33] sm:text-6xl lg:text-[4.7rem]"
                    >
                        {HERO_CONTENT.titlePrefix}{' '}

                        <span className="nexora-gradient-text">
                            {HERO_CONTENT.highlightedTitle}
                        </span>
                    </h1>

                    {/* Hero description */}
                    <p className="mt-7 max-w-2xl text-lg leading-8 text-[#6f6881] sm:text-xl">
                        {HERO_CONTENT.description}
                    </p>

                    {/* Hero actions */}
                    <div className="mt-10 flex flex-wrap gap-4">
                        <button
                            type="button"
                            onClick={() => scrollToSection('how-it-works')}
                            className="nexora-button-primary group gap-3 px-6 py-3.5"
                            aria-label={HERO_CONTENT.primaryActionLabel}
                        >
                            {HERO_CONTENT.primaryActionLabel}

                            <ArrowDownRight
                                className="transition-transform duration-300 group-hover:translate-x-1 group-hover:translate-y-1"
                                size={19}
                                aria-hidden="true"
                            />
                        </button>

                        <button
                            type="button"
                            onClick={() => scrollToSection('contact')}
                            className="nexora-button-secondary gap-3 px-6 py-3.5"
                            aria-label={HERO_CONTENT.secondaryActionLabel}
                        >
                            <Mail
                                size={18}
                                aria-hidden="true"
                            />

                            {HERO_CONTENT.secondaryActionLabel}
                        </button>
                    </div>

                    {/* Platform highlights */}
                    <div className="mt-12 grid max-w-2xl grid-cols-3 gap-3 sm:gap-5">
                        {HERO_HIGHLIGHTS.map((highlight) => (
                            <article
                                key={highlight.id}
                                className="hero-highlight-card rounded-2xl border border-white/90 bg-white/65 p-4 backdrop-blur-xl"
                            >
                                <p className="text-lg font-extrabold text-[#2a223d] sm:text-2xl">
                                    {highlight.title}
                                </p>

                                <p className="mt-1 text-xs leading-5 text-[#746d84] sm:text-sm">
                                    {highlight.description}
                                </p>
                            </article>
                        ))}
                    </div>
                </motion.div>

                {/* Nexora process visualization */}
                <motion.div
                    initial={
                        shouldReduceMotion
                            ? undefined
                            : {
                                opacity: 0,
                                scale: 0.94,
                                rotate: 1.5,
                            }
                    }
                    animate={
                        shouldReduceMotion
                            ? undefined
                            : {
                                opacity: 1,
                                scale: 1,
                                rotate: 0,
                            }
                    }
                    transition={{
                        duration: 0.85,
                        delay: 0.12,
                    }}
                    className="relative z-10"
                >
                    <HeroProcessCard />
                </motion.div>
            </div>
        </section>
    );
}