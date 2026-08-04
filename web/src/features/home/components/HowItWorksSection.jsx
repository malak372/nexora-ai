/**
 * Displays Voxidence's connected evidence-to-idea workflow.
 *
 * The section shares the landing-page canvas without an outer panel. Its
 * compact process rail keeps the content visually connected to the hero.
 *
 * @component
 * @returns {JSX.Element} The public Voxidence workflow section.
 *
 * @author Eman
 */

import {
    ArrowRight,
    BrainCircuit,
    Radar,
    Rocket,
    ScanSearch,
    Sparkles,
} from 'lucide-react';

import { HOW_IT_WORKS_STEPS } from '../constants/home.constants';

const STEP_ICONS = {
    radar: Radar,
    scan: ScanSearch,
    brain: BrainCircuit,
    rocket: Rocket,
};

export default function HowItWorksSection() {
    return (
        <section
            id="how-it-works"
            className="vox-how-section scroll-mt-28"
            aria-labelledby="how-it-works-heading"
        >
            <div className="vox-how-container">
                <div className="vox-how-panel">
                    <div
                        className="vox-how-glow vox-how-glow-left"
                        aria-hidden="true"
                    />
                    <div
                        className="vox-how-glow vox-how-glow-right"
                        aria-hidden="true"
                    />

                    <header className="vox-how-header">
                        <span className="vox-how-eyebrow">
                            <Sparkles size={14} aria-hidden="true" />
                            How Voxidence works
                        </span>

                        <h2 id="how-it-works-heading">
                            One connected flow from community signal to
                            evidence-backed direction.
                        </h2>

                        <p>
                            Voxidence listens to recurring needs, verifies the
                            supporting evidence, compares multiple AI directions,
                            and shapes the strongest result into a clear software
                            opportunity.
                        </p>
                    </header>

                    <div className="vox-how-flow" role="list">
                        {HOW_IT_WORKS_STEPS.map((step, index) => {
                            const Icon = STEP_ICONS[step.icon] || BrainCircuit;
                            const isLastStep =
                                index === HOW_IT_WORKS_STEPS.length - 1;

                            return (
                                <div
                                    key={step.number}
                                    className="vox-how-step-wrap"
                                    role="listitem"
                                >
                                    <article className="vox-how-card group">
                                        <div className="vox-how-card-top">
                                            <span className="vox-how-icon">
                                                <Icon size={20} aria-hidden="true" />
                                            </span>

                                            <span className="vox-how-number">
                                                {step.number}
                                            </span>
                                        </div>

                                        <div className="vox-how-card-copy">
                                            <h3>{step.title}</h3>
                                            <p>{step.description}</p>
                                        </div>
                                    </article>

                                    {!isLastStep && (
                                        <span
                                            className="vox-how-connector"
                                            aria-hidden="true"
                                        >
                                            <ArrowRight size={15} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div
                        className="vox-how-summary"
                        aria-label="Voxidence workflow summary"
                    >
                        <span>Community signals</span>
                        <i aria-hidden="true" />
                        <span>Verified evidence</span>
                        <i aria-hidden="true" />
                        <span>Comparative intelligence</span>
                        <i aria-hidden="true" />
                        <strong>Selected direction</strong>
                    </div>
                </div>
            </div>
        </section>
    );
}