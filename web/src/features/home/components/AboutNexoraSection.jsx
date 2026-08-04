/**
 * Displays Voxidence's story, mission, and core differentiators.
 *
 * The section keeps the same connected visual language used by the hero and
 * workflow sections while presenting the About content in a balanced,
 * compact editorial layout.
 *
 * @component
 * @returns {JSX.Element} The public About Voxidence section.
 *
 * @author Eman
 */

import {
    ArrowUpRight,
    BrainCircuit,
    DatabaseZap,
    Globe2,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';

import {
    ABOUT_NEXORA_CONTENT,
    ABOUT_NEXORA_FEATURES,
} from '../constants/home.constants';

const ABOUT_ICONS = {
    evidence: DatabaseZap,
    intelligence: BrainCircuit,
    relevance: Globe2,
    trust: ShieldCheck,
};

function AboutFeatureCard({ feature, index }) {
    const Icon = ABOUT_ICONS[feature.icon] || BrainCircuit;

    return (
        <article className="vox-about-feature group">
            <div className="vox-about-feature-head">
                <span className="vox-about-feature-icon">
                    <Icon size={20} aria-hidden="true" />
                </span>

                <span className="vox-about-feature-index">
                    {String(index + 1).padStart(2, '0')}
                </span>
            </div>

            <div className="vox-about-feature-copy">
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
            </div>

            <ArrowUpRight
                className="vox-about-feature-arrow"
                size={17}
                aria-hidden="true"
            />
        </article>
    );
}

export default function AboutNexoraSection() {
    return (
        <section
            id="about"
            className="vox-about-section scroll-mt-28"
            aria-labelledby="about-nexora-heading"
        >
            <div className="vox-about-container">
                <div className="vox-about-panel">
                    <div
                        className="vox-about-orb vox-about-orb-left"
                        aria-hidden="true"
                    />
                    <div
                        className="vox-about-orb vox-about-orb-right"
                        aria-hidden="true"
                    />

                    <header className="vox-about-refined__header">
                        <div className="vox-about-refined__heading">
                            <span className="vox-about-refined__eyebrow">
                                <Sparkles size={14} aria-hidden="true" />
                                Why Voxidence
                            </span>

                            <h2 id="about-nexora-heading">
                                Ideas should begin with{' '}
                                <span>real human needs.</span>
                            </h2>
                        </div>
                    </header>

                    <div className="vox-about-layout">
                        <article className="vox-about-story-card">
                            <span className="vox-about-story-kicker">
                                The Voxidence difference
                            </span>

                            <p className="vox-about-story-lead">
                                {ABOUT_NEXORA_CONTENT.secondaryDescription}
                            </p>

                            <div className="vox-about-story-points">
                                <div>
                                    <strong>Listen first</strong>
                                    <span>Start with real community signals.</span>
                                </div>

                                <div>
                                    <strong>Validate deeply</strong>
                                    <span>Turn repeated needs into reliable direction.</span>
                                </div>
                            </div>

                            <div className="vox-about-mission-strip">
                                <span>{ABOUT_NEXORA_CONTENT.missionLabel}</span>
                                <p>{ABOUT_NEXORA_CONTENT.mission}</p>
                            </div>
                        </article>

                        <div className="vox-about-feature-grid">
                            {ABOUT_NEXORA_FEATURES.map((feature, index) => (
                                <AboutFeatureCard
                                    key={feature.id}
                                    feature={feature}
                                    index={index}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}