import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
    ArrowRight,
    CheckCircle2,
    Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import SoftBulbMark from '../../../components/brand/SoftBulbMark';
import { useUserExperience } from '../../../system/user-experience';
import { HERO_CONTENT } from '../constants/home.constants';

const HERO_STAGES = [
    {
        id: 'collect',
        label: '01 · Collect',
        title: 'Collect real community signals',
        description: 'Public conversations, reviews, developer communities, and recurring needs flow into one evidence source.',
        image: '/images/hero-stages/01-collect-signals(1).svg',
    },
    {
        id: 'process',
        label: '02 · Process',
        title: 'Turn signals into structured evidence',
        description: 'The pipeline cleans the data, runs NLP analysis, detects patterns, and prepares grounded context.',
        image: '/images/hero-stages/02-evidence-pipeline(1).svg',
    },
    {
        id: 'compare',
        label: '03 · Compare',
        title: 'Compare AI directions with evidence',
        description: 'Multiple candidate directions are scored against signal strength, community demand, and potential impact.',
        image: '/images/hero-stages/03-compare-directions(1).svg',
    },
    {
        id: 'select',
        label: '04 · Select',
        title: 'Shape the strongest project opportunity',
        description: 'The selected direction becomes a focused, evidence-backed project brief that is ready to build.',
        image: '/images/hero-stages/04-selected-opportunity(1).svg',
    },
];

const STAGE_DURATION_MS = 4800;

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

export default function HeroSection() {
    const navigate = useNavigate();
    const shouldReduceMotion = useReducedMotion();
    const { t, isArabic } = useUserExperience();
    const [activeStageIndex, setActiveStageIndex] = useState(0);

    useEffect(() => {
        HERO_STAGES.forEach(({ image }) => {
            const preloadImage = new Image();
            preloadImage.src = image;
            preloadImage.decode?.().catch(() => undefined);
        });
    }, []);

    useEffect(() => {
        const resetToFirstStage = () => setActiveStageIndex(0);

        resetToFirstStage();
        window.addEventListener('pageshow', resetToFirstStage);

        return () => window.removeEventListener('pageshow', resetToFirstStage);
    }, []);

    useEffect(() => {
        if (shouldReduceMotion) {
            return undefined;
        }

        const intervalId = window.setInterval(() => {
            setActiveStageIndex((currentIndex) => (
                currentIndex + 1
            ) % HERO_STAGES.length);
        }, STAGE_DURATION_MS);

        return () => window.clearInterval(intervalId);
    }, [shouldReduceMotion]);

    const activeStage = HERO_STAGES[activeStageIndex];

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
                        {t(HERO_CONTENT.badge)}
                    </div>

                    <h1 id="hero-heading" className="vox-hero-heading">
                        {t('Real voices reveal')}
                        <span>{t('the ideas worth building.')}</span>
                    </h1>

                    <p className="vox-hero-lead">
                        {isArabic ? (
                            <>
                                يستمع <bdi className="vox-hero-brand-name" dir="ltr" data-no-auto-translate="true">Voxidence</bdi> إلى احتياجات المجتمع المتكررة، ويربطها بالأدلة، ويحوّلها إلى فرص برمجية مركزة ذات هدف وسياق وملاءمة محلية.
                            </>
                        ) : (
                            <>
                                <bdi className="vox-hero-brand-name" dir="ltr" data-no-auto-translate="true">Voxidence</bdi>{' '}
                                listens to recurring community needs, connects them with evidence, and turns them into focused software opportunities with purpose, context, and local relevance.
                            </>
                        )}
                    </p>

                    <div className="vox-hero-actions">
                        <button
                            type="button"
                            onClick={() => navigate('/generate')}
                            className="vox-hero-button vox-hero-button-primary group"
                        >
                            <span className="vox-hero-button-mark" aria-hidden="true">
                                <SoftBulbMark size={21} />
                            </span>
                            {t('Generate your free idea')}
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
                            {t('Explore how it works')}
                            <ArrowRight size={18} aria-hidden="true" />
                        </button>
                    </div>

                    <div className="vox-hero-trust">
                        {HERO_CONTENT.trustPoints.map((point) => (
                            <span key={point}>
                                <CheckCircle2 size={16} aria-hidden="true" />
                                {t(point)}
                            </span>
                        ))}
                    </div>
                </motion.div>

                <motion.div
                    initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.97, x: 24 }}
                    animate={shouldReduceMotion ? undefined : { opacity: 1, scale: 1, x: 0 }}
                    transition={{ duration: 0.86, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                    className="vox-stage-showcase"
                    aria-label={t('Voxidence project stages slideshow')}
                >
                    <span className="vox-stage-backdrop vox-stage-backdrop-one" aria-hidden="true" />
                    <span className="vox-stage-backdrop vox-stage-backdrop-two" aria-hidden="true" />

                    <div className="vox-stage-showcase-frame">
                        <div className="vox-stage-window-rail" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                        </div>

                        <AnimatePresence mode="sync" initial={false}>
                            <motion.img
                                key={activeStage.id}
                                src={activeStage.image}
                                alt={t(activeStage.title)}
                                className="vox-stage-showcase-image"
                                loading="eager"
                                decoding="async"
                                fetchPriority={activeStageIndex === 0 ? 'high' : 'auto'}
                                initial={shouldReduceMotion ? false : { opacity: 0, scale: 1.025 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.99 }}
                                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                            />
                        </AnimatePresence>

                        <span className="vox-stage-showcase-glass" aria-hidden="true" />
                        <span className="vox-stage-corner-accent" aria-hidden="true" />
                    </div>
                </motion.div>
            </div>
        </section>
    );
}