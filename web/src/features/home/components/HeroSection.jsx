import { motion, useReducedMotion } from 'framer-motion';
import {
    ArrowRight,
    BrainCircuit,
    CheckCircle2,
    DatabaseZap,
    Lightbulb,
    MessageCircleMore,
    Scale,
    Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import VoxidenceMark from '../../../components/brand/VoxidenceMark';
import { HERO_CONTENT } from '../constants/home.constants';

function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);

    if (!section) {
        return;
    }

    const top = section.getBoundingClientRect().top + window.scrollY - 105;

    window.scrollTo({
        top,
        behavior: 'smooth',
    });
}

const orbitSignals = [
    {
        id: 'voice',
        eyebrow: 'Listen',
        label: 'Community voices',
        icon: MessageCircleMore,
        className: 'vox-orbit-node vox-orbit-node-one',
    },
    {
        id: 'evidence',
        eyebrow: 'Verify',
        label: 'Evidence patterns',
        icon: DatabaseZap,
        className: 'vox-orbit-node vox-orbit-node-two',
    },
    {
        id: 'judge',
        eyebrow: 'Compare',
        label: 'AI directions',
        icon: Scale,
        className: 'vox-orbit-node vox-orbit-node-three',
    },
    {
        id: 'idea',
        eyebrow: 'Shape',
        label: 'Project opportunity',
        icon: Lightbulb,
        className: 'vox-orbit-node vox-orbit-node-four',
    },
];

export default function HeroSection() {
    const navigate = useNavigate();
    const shouldReduceMotion = useReducedMotion();

    return (
        <section
            id="home"
            className="vox-hero-stage"
            aria-labelledby="hero-heading"
        >
            <div className="vox-hero-ambient" aria-hidden="true">
                <span className="vox-ambient-glow vox-ambient-glow-one" />
                <span className="vox-ambient-glow vox-ambient-glow-two" />
                <span className="vox-ambient-glow vox-ambient-glow-three" />
                <span className="vox-ambient-grid" />
            </div>

            <div className="vox-hero-shell">
                <motion.div
                    initial={shouldReduceMotion ? undefined : { opacity: 0, y: 22 }}
                    animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
                    transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
                    className="vox-hero-copy"
                >
                    <div className="vox-hero-badge">
                        <span className="vox-hero-badge-dot" />
                        <Sparkles size={15} aria-hidden="true" />
                        {HERO_CONTENT.badge}
                    </div>

                    <h1 id="hero-heading" className="vox-hero-heading">
                        Real voices reveal
                        <span>the ideas worth building.</span>
                    </h1>

                    <p className="vox-hero-lead">
                        Voxidence listens to recurring community needs, connects them
                        with evidence, and turns them into focused software opportunities
                        with purpose, context, and local relevance.
                    </p>

                    <div className="vox-hero-actions">
                        <button
                            type="button"
                            onClick={() => navigate('/generate')}
                            className="vox-hero-button vox-hero-button-primary group"
                        >
                            <span className="vox-hero-button-mark" aria-hidden="true">
                                <VoxidenceMark size={20} />
                            </span>
                            Generate your free idea
                            <ArrowRight
                                size={18}
                                className="vox-hero-button-arrow"
                                aria-hidden="true"
                            />
                        </button>

                        <button
                            type="button"
                            onClick={() => scrollToSection('how-it-works')}
                            className="vox-hero-button vox-hero-button-secondary"
                        >
                            Explore how it works
                            <ArrowRight size={18} aria-hidden="true" />
                        </button>
                    </div>

                    <div className="vox-hero-trust">
                        {HERO_CONTENT.trustPoints.map((point) => (
                            <span key={point}>
                                <CheckCircle2 size={16} aria-hidden="true" />
                                {point}
                            </span>
                        ))}
                    </div>
                </motion.div>

                <motion.div
                    initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.96, x: 24 }}
                    animate={shouldReduceMotion ? undefined : { opacity: 1, scale: 1, x: 0 }}
                    transition={{ duration: 0.86, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                    className="vox-signal-universe"
                    aria-label="Animated Voxidence evidence-intelligence visualization"
                >
                    <div className="vox-universe-topline">
                        <div>
                            <span className="vox-universe-kicker">Live evidence flow</span>
                            <strong>From signal to selected direction</strong>
                        </div>
                        <span className="vox-universe-live">
                            <i />
                            Active
                        </span>
                    </div>

                    <div className="vox-universe-stage">
                        <div className="vox-universe-beam" aria-hidden="true" />
                        <div className="vox-universe-halo vox-universe-halo-one" aria-hidden="true" />
                        <div className="vox-universe-halo vox-universe-halo-two" aria-hidden="true" />
                        <div className="vox-universe-halo vox-universe-halo-three" aria-hidden="true" />
                        <div className="vox-universe-orbit vox-universe-orbit-one" aria-hidden="true" />
                        <div className="vox-universe-orbit vox-universe-orbit-two" aria-hidden="true" />
                        <div className="vox-universe-orbit vox-universe-orbit-three" aria-hidden="true" />

                        {orbitSignals.map((signal) => {
                            const Icon = signal.icon;

                            return (
                                <div key={signal.id} className={signal.className}>
                                    <span className="vox-orbit-node-icon">
                                        <Icon size={17} aria-hidden="true" />
                                    </span>
                                    <span className="vox-orbit-node-copy">
                                        <small>{signal.eyebrow}</small>
                                        <strong>{signal.label}</strong>
                                    </span>
                                </div>
                            );
                        })}

                        <div className="vox-universe-core">
                            <div className="vox-universe-core-glow" aria-hidden="true" />
                            <div className="vox-universe-core-mark">
                                <VoxidenceMark size={54} />
                            </div>

                            <div className="vox-universe-wave" aria-hidden="true">
                                <i /><i /><i /><i /><i /><i /><i />
                            </div>

                        </div>

                        <div className="vox-universe-card vox-universe-card-top">
                            <span className="vox-universe-card-icon">
                                <BrainCircuit size={16} aria-hidden="true" />
                            </span>
                            <span>
                                <small>Signal confidence</small>
                                <strong>92% recurring need</strong>
                            </span>
                        </div>

                        <div className="vox-universe-card vox-universe-card-bottom">
                            <span className="vox-universe-card-icon vox-universe-card-icon-rose">
                                <Lightbulb size={16} aria-hidden="true" />
                            </span>
                            <span>
                                <small>Selected outcome</small>
                                <strong>Evidence-backed idea</strong>
                            </span>
                        </div>
                    </div>

                    <div className="vox-universe-footer">
                        <span><i /> Public signals</span>
                        <span><i /> NLP evidence</span>
                        <span><i /> Comparative AI</span>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}