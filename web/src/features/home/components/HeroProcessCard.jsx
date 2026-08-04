import {
    BrainCircuit,
    Database,
    Lightbulb,
    Radio,
    Scale,
    Sparkles,
    Users,
    Waves,
} from 'lucide-react';

import { HERO_PROCESS_CONTENT } from '../constants/home.constants';

const PROCESS_ICONS = {
    users: Users,
    database: Database,
    judge: Scale,
    lightbulb: Lightbulb,
};

export default function HeroProcessCard() {
    const { eyebrow, title, steps } = HERO_PROCESS_CONTENT;

    return (
        <div className="vox-evidence-canvas" aria-labelledby="hero-process-title">
            <div className="vox-canvas-glow" aria-hidden="true" />
            <div className="vox-canvas-line vox-canvas-line-one" aria-hidden="true" />
            <div className="vox-canvas-line vox-canvas-line-two" aria-hidden="true" />

            <div className="vox-canvas-topbar">
                <div>
                    <p className="vox-card-kicker">{eyebrow}</p>
                    <h2 id="hero-process-title">{title}</h2>
                </div>
                <span className="vox-live-indicator">
                    <span className="vox-live-dot" />
                    Live analysis
                </span>
            </div>

            <div className="vox-canvas-body">
                <div className="vox-canvas-signal-card vox-canvas-signal-card-a">
                    <span><Users size={17} /></span>
                    <div>
                        <small>Community signal</small>
                        <strong>Repeated access gaps</strong>
                    </div>
                    <b>+36%</b>
                </div>

                <div className="vox-canvas-signal-card vox-canvas-signal-card-b">
                    <span><Radio size={17} /></span>
                    <div>
                        <small>Emerging pattern</small>
                        <strong>Local coordination need</strong>
                    </div>
                </div>

                <div className="vox-canvas-core">
                    <div className="vox-canvas-core-ring" aria-hidden="true" />
                    <div className="vox-canvas-core-icon">
                        <BrainCircuit size={33} />
                    </div>
                    <small>Voxidence intelligence</small>
                    <strong>Evidence connected</strong>
                    <div className="vox-canvas-wave" aria-hidden="true">
                        <i /><i /><i /><i /><i /><i /><i />
                    </div>
                </div>

                <div className="vox-canvas-score-card">
                    <div className="vox-score-card-head">
                        <span><Sparkles size={16} /></span>
                        <small>Opportunity confidence</small>
                        <strong>92%</strong>
                    </div>
                    <div className="vox-score-track"><span /></div>
                    <div className="vox-score-details">
                        <span><Database size={14} /> Evidence 94%</span>
                        <span><Scale size={14} /> Judge 89%</span>
                    </div>
                </div>

                <div className="vox-canvas-output-card">
                    <span><Lightbulb size={18} /></span>
                    <div>
                        <small>Selected direction</small>
                        <strong>Build-ready opportunity</strong>
                    </div>
                    <Waves size={19} />
                </div>
            </div>

            <div className="vox-canvas-pipeline">
                {steps.map((step, index) => {
                    const Icon = PROCESS_ICONS[step.icon] || BrainCircuit;
                    return (
                        <article key={step.id} className="vox-canvas-step">
                            <span className="vox-canvas-step-index">0{index + 1}</span>
                            <span className="vox-canvas-step-icon"><Icon size={17} /></span>
                            <div>
                                <h3>{step.title}</h3>
                                <p>{step.description}</p>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}