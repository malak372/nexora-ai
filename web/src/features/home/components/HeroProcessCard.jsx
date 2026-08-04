/**
 * Renders the visual process card displayed in the Nexora landing-page hero.
 *
 * The component explains how Voxidence transforms public community signals into
 * structured software project opportunities through three connected stages.
 *
 * Process content is loaded from the centralized HERO_PROCESS_CONTENT
 * configuration to keep the UI reusable and easy to maintain.
 *
 * @component
 * @returns {JSX.Element} The AI discovery process card.
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

/**
 * Maps process icon identifiers from the configuration file to
 * Lucide React icon components.
 *
 * @type {Object.<string, import('lucide-react').LucideIcon>}
 */
const PROCESS_ICONS = {
    users: Users,
    database: Database,
    lightbulb: Lightbulb,
};

/**
 * Defines the visual appearance of each process-step variant.
 *
 * Each variant controls the card container, icon background, and
 * description text styles.
 *
 * @type {Object.<string, {
 *     container: string,
 *     iconContainer: string,
 *     description: string
 * }>}
 */
const PROCESS_VARIANTS = {
    neutral: {
        container:
            'border border-[#e9e1f7] bg-white/75 text-[#29213d]',
        iconContainer:
            'bg-[#f3edff] text-[#7b5bca]',
        description:
            'text-[#756d86]',
    },

    primary: {
        container:
            'border border-[#d9e9fa] bg-[#f1f8ff]/85 text-[#29213d]',
        iconContainer:
            'bg-[#dff1ff] text-[#4d92ca]',
        description:
            'text-[#756d86]',
    },

    gradient: {
        container:
            'border border-[#eadcf5] bg-gradient-to-br from-[#f8f2ff] via-white to-[#eef8ff] text-[#29213d] shadow-[0_15px_35px_rgba(100,75,150,0.09)]',
        iconContainer:
            'bg-gradient-to-br from-[#8766d4] to-[#69a6d5] text-white',
        description:
            'text-[#6e6680]',
    },
};

/**
 * Displays a single stage within the Nexora discovery process.
 *
 * @param {Object} props - Component properties.
 * @param {Object} props.step - Process-step configuration.
 * @param {string} props.step.title - Step title.
 * @param {string} props.step.description - Step description.
 * @param {string} props.step.icon - Icon identifier.
 * @param {string} props.step.variant - Visual variant identifier.
 *
 * @returns {JSX.Element} A styled process-step card.
 */
function ProcessStep({ step }) {
    const Icon = PROCESS_ICONS[step.icon];
    const variant = PROCESS_VARIANTS[step.variant];

    return (
        <article
            className={`rounded-2xl p-5 transition duration-300 hover:-translate-y-1 ${variant.container}`}
        >
            <div className="flex items-center gap-3">
                <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${variant.iconContainer}`}
                >
                    <Icon
                        size={20}
                        aria-hidden="true"
                    />
                </span>

                <h3 className="font-extrabold">
                    {step.title}
                </h3>
            </div>

            <p
                className={`mt-3 text-sm leading-6 ${variant.description}`}
            >
                {step.description}
            </p>
        </article>
    );
}

/**
 * Displays the complete Voxidence transformation workflow.
 *
 * The card contains:
 * - A section heading.
 * - A branded AI icon.
 * - Dynamically rendered process stages.
 * - Visual connectors between consecutive stages.
 *
 * @returns {JSX.Element}
 */
export default function HeroProcessCard() {
    const {
        eyebrow,
        title,
        steps,
    } = HERO_PROCESS_CONTENT;

    return (
        <div
            className="hero-process-card relative overflow-hidden rounded-[2.2rem] border border-white/90 bg-white/70 p-7 backdrop-blur-2xl sm:p-10"
            aria-labelledby="hero-process-title"
        >
            {/* Decorative background gradients */}
            <div
                className="absolute -right-14 -top-14 h-48 w-48 rounded-full bg-[#d8c8ff]/50 blur-3xl"
                aria-hidden="true"
            />

            <div
                className="absolute -bottom-20 -left-16 h-52 w-52 rounded-full bg-[#cdeeff]/50 blur-3xl"
                aria-hidden="true"
            />

            <div className="relative">
                {/* Card heading */}
                <div className="flex items-center justify-between gap-5">
                    <div>
                        <p className="text-sm font-bold text-[#7758c6]">
                            {eyebrow}
                        </p>

                        <h2
                            id="hero-process-title"
                            className="mt-2 text-2xl font-black text-[#29213d]"
                        >
                            {title}
                        </h2>
                    </div>

                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8060ce] to-[#64a6d8] text-white shadow-[0_14px_32px_rgba(107,82,178,0.24)]">
                        <BrainCircuit
                            size={27}
                            aria-hidden="true"
                        />
                    </span>
                </div>

                {/* Process stages */}
                <div className="mt-10">
                    {steps.map((step, index) => (
                        <div key={step.id}>
                            <ProcessStep step={step} />

                            {index < steps.length - 1 && (
                                <div
                                    className="mx-auto h-8 w-px bg-gradient-to-b from-[#d6c7ef] to-[#cfe8f7]"
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