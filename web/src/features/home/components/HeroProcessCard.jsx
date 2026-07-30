/**
 * Renders the visual process card displayed in the home page hero.
 *
 * The card illustrates how Nexora transforms community feedback into
 * analyzed opportunities and finally into a meaningful project idea.
 *
 * @component
 * @returns {JSX.Element} The Nexora process visualization card.
 *
 * @author Eman
 */

import {
    BrainCircuit,
    Database,
    Lightbulb,
    Users,
} from 'lucide-react';

import { HERO_PROCESS_CONTENT } from '../constants/home.constants';

const PROCESS_ICONS = {
    users: Users,
    database: Database,
    lightbulb: Lightbulb,
};

const PROCESS_VARIANTS = {
    neutral: {
        container:
            'border border-nexora-border bg-nexora-background text-nexora-text',
        icon: 'text-nexora-secondary',
        description: 'text-nexora-muted',
    },

    primary: {
        container:
            'border border-nexora-primary/20 bg-nexora-primary/5 text-nexora-text',
        icon: 'text-nexora-primary',
        description: 'text-nexora-muted',
    },

    gradient: {
        container: 'bg-nexora-gradient text-white shadow-card',
        icon: 'text-white',
        description: 'text-white/80',
    },
};

/**
 * Renders one step inside the hero process card.
 *
 * @param {Object} props Component properties.
 * @param {Object} props.step Process step configuration.
 * @param {string} props.step.title Step title.
 * @param {string} props.step.description Step description.
 * @param {string} props.step.icon Icon identifier.
 * @param {string} props.step.variant Visual style identifier.
 *
 * @returns {JSX.Element}
 */
function ProcessStep({ step }) {
    const Icon = PROCESS_ICONS[step.icon];
    const variant = PROCESS_VARIANTS[step.variant];

    return (
        <article className={`rounded-2xl p-5 ${variant.container}`}>
            <div className="flex items-center gap-3">
                <Icon
                    className={variant.icon}
                    size={21}
                    aria-hidden="true"
                />

                <h3 className="font-bold">
                    {step.title}
                </h3>
            </div>

            <p className={`mt-2 text-sm leading-6 ${variant.description}`}>
                {step.description}
            </p>
        </article>
    );
}

/**
 * Nexora hero process visualization.
 *
 * @returns {JSX.Element}
 */
export default function HeroProcessCard() {
    const { eyebrow, title, steps } = HERO_PROCESS_CONTENT;

    return (
        <div className="nexora-card relative overflow-hidden p-7 sm:p-10">
            <div
                className="absolute right-0 top-0 h-44 w-44 rounded-full bg-nexora-primary/10 blur-3xl"
                aria-hidden="true"
            />

            <div className="relative">
                <div className="flex items-center justify-between gap-5">
                    <div>
                        <p className="text-sm font-semibold text-nexora-primary">
                            {eyebrow}
                        </p>

                        <h2 className="mt-2 text-2xl font-bold text-nexora-text">
                            {title}
                        </h2>
                    </div>

                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-nexora-gradient text-white shadow-card">
                        <BrainCircuit
                            size={27}
                            aria-hidden="true"
                        />
                    </span>
                </div>

                <div className="mt-10">
                    {steps.map((step, index) => (
                        <div key={step.id}>
                            <ProcessStep step={step} />

                            {index < steps.length - 1 && (
                                <div
                                    className="mx-auto h-8 w-px bg-nexora-border"
                                    aria-hidden="true"
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}