/**
 * Renders the About Voxidence section on the public landing page.
 *
 * The section introduces Nexora's mission and explains how the platform
 * differs from traditional idea-generation tools by starting from public
 * evidence, community needs, and comparative AI evaluation.
 *
 * @component
 * @returns {JSX.Element} The public About Voxidence section.
 *
 * @author Eman
 */

import {
    BrainCircuit,
    DatabaseZap,
    Globe2,
    ShieldCheck,
} from 'lucide-react';

import {
    ABOUT_NEXORA_CONTENT,
    ABOUT_NEXORA_FEATURES,
} from '../constants/home.constants';

/**
 * Maps About-section icon identifiers to Lucide React components.
 *
 * @type {Object.<string, import('lucide-react').LucideIcon>}
 */
const ABOUT_ICONS = {
    evidence: DatabaseZap,
    intelligence: BrainCircuit,
    relevance: Globe2,
    trust: ShieldCheck,
};

/**
 * Displays a single Nexora differentiator card.
 *
 * @param {Object} props - Component properties.
 * @param {Object} props.feature - Feature configuration.
 * @param {string} props.feature.id - Stable feature identifier.
 * @param {string} props.feature.title - Feature title.
 * @param {string} props.feature.description - Feature description.
 * @param {string} props.feature.icon - Icon identifier.
 * @param {boolean} [props.feature.offset=false] - Applies a vertical offset.
 *
 * @returns {JSX.Element} A Nexora feature card.
 */
function AboutFeatureCard({ feature }) {
    const Icon = ABOUT_ICONS[feature.icon] || BrainCircuit;

    return (
        <article
            className={`about-feature-card group rounded-[2rem] border border-white/90 bg-white/70 p-7 backdrop-blur-xl ${feature.offset ? 'sm:translate-y-8' : ''
                }`}
        >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#eee6ff] to-[#dff3ff] text-[#7656c6] transition duration-300 group-hover:scale-110 group-hover:from-[#8564d1] group-hover:to-[#67a6d5] group-hover:text-white">
                <Icon
                    size={25}
                    aria-hidden="true"
                />
            </span>

            <h3 className="mt-6 text-xl font-extrabold text-[#2d243f]">
                {feature.title}
            </h3>

            <p className="mt-3 text-sm leading-7 text-[#756e83]">
                {feature.description}
            </p>
        </article>
    );
}

/**
 * Displays Nexora's mission, platform approach, and key differentiators.
 *
 * @returns {JSX.Element}
 */
export default function AboutNexoraSection() {
    return (
        <section
            id="about"
            className="about-nexora-section relative scroll-mt-24 overflow-hidden py-24 sm:py-32"
            aria-labelledby="about-nexora-heading"
        >
            {/* Decorative background elements */}
            <div
                className="about-nexora-orb about-nexora-orb-one"
                aria-hidden="true"
            />

            <div
                className="about-nexora-orb about-nexora-orb-two"
                aria-hidden="true"
            />

            <div className="nexora-container relative z-10">
                <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
                    {/* Section introduction */}
                    <div>
                        <p className="nexora-eyebrow">
                            {ABOUT_NEXORA_CONTENT.eyebrow}
                        </p>

                        <h2
                            id="about-nexora-heading"
                            className="nexora-section-title mt-5"
                        >
                            {ABOUT_NEXORA_CONTENT.titlePrefix}{' '}

                            <span className="nexora-gradient-text">
                                {ABOUT_NEXORA_CONTENT.highlightedTitle}
                            </span>
                        </h2>

                        <p className="mt-6 max-w-xl text-lg leading-8 text-[#716a81]">
                            {ABOUT_NEXORA_CONTENT.description}
                        </p>

                        <p className="mt-5 max-w-xl leading-8 text-[#7a7288]">
                            {ABOUT_NEXORA_CONTENT.secondaryDescription}
                        </p>

                        <div className="about-mission-card mt-9 rounded-[2rem] border border-white/90 bg-white/70 p-6 backdrop-blur-xl">
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8264c8]">
                                {ABOUT_NEXORA_CONTENT.missionLabel}
                            </p>

                            <p className="mt-3 text-lg font-bold leading-8 text-[#302642]">
                                {ABOUT_NEXORA_CONTENT.mission}
                            </p>
                        </div>
                    </div>

                    {/* Nexora differentiators */}
                    <div className="grid gap-5 sm:grid-cols-2">
                        {ABOUT_NEXORA_FEATURES.map((feature) => (
                            <AboutFeatureCard
                                key={feature.id}
                                feature={feature}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}