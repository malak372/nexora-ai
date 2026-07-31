/**
 * Renders the Nexora workflow section on the public landing page.
 *
 * The section explains the four major stages of the Nexora discovery
 * pipeline, from collecting community signals to shaping a structured
 * software project direction.
 *
 * Framer Motion is used to animate each workflow card when it enters
 * the viewport. The animation is automatically disabled when the user
 * has enabled the reduced-motion accessibility preference.
 *
 * @component
 * @returns {JSX.Element} The complete "How Nexora Works" section.
 *
 * @author Eman
 */

import { motion, useReducedMotion } from 'framer-motion';
import {
    BrainCircuit,
    Radar,
    Rocket,
    ScanSearch,
} from 'lucide-react';

import { HOW_IT_WORKS_STEPS } from '../constants/home.constants';

/**
 * Maps workflow icon identifiers from the configuration file to
 * their corresponding Lucide React icon components.
 *
 * Keeping the map outside the component prevents unnecessary
 * recreation during every render.
 *
 * @type {Object.<string, import('lucide-react').LucideIcon>}
 */
const ICONS = {
    radar: Radar,
    scan: ScanSearch,
    brain: BrainCircuit,
    rocket: Rocket,
};

/**
 * Displays the Nexora discovery workflow in a responsive card layout.
 *
 * The section includes:
 * - A heading and short pipeline description.
 * - Four dynamically rendered workflow stages.
 * - Scroll-triggered entrance animations.
 * - A decorative connector line on large screens.
 *
 * @returns {JSX.Element}
 */
export default function HowItWorksSection() {
    /**
     * Determines whether animations should be reduced or disabled
     * according to the user's operating-system accessibility settings.
     */
    const shouldReduceMotion = useReducedMotion();

    return (
        <section
            id="how-it-works"
            className="how-it-works-section relative scroll-mt-24 py-24 sm:py-32"
            aria-labelledby="how-it-works-heading"
        >
            <div className="nexora-container">
                {/* Section introduction */}
                <div className="mx-auto max-w-3xl text-center">
                    <p className="nexora-eyebrow">
                        How Nexora works
                    </p>

                    <h2
                        id="how-it-works-heading"
                        className="nexora-section-title mt-4"
                    >
                        Not another random idea generator.
                    </h2>

                    <p className="nexora-section-description mx-auto mt-5">
                        Nexora follows a complete discovery pipeline, starting
                        with evidence and ending with a project direction worth
                        exploring.
                    </p>
                </div>

                {/* Workflow cards */}
                <div className="relative mt-16 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
                    {/* Decorative connector shown on large screens */}
                    <div
                        className="absolute left-[10%] right-[10%] top-10 hidden h-px bg-gradient-to-r from-transparent via-[#9e7bd6]/35 to-transparent xl:block"
                        aria-hidden="true"
                    />

                    {HOW_IT_WORKS_STEPS.map((step, index) => {
                        const Icon = ICONS[step.icon];

                        return (
                            <motion.article
                                key={step.number}
                                initial={
                                    shouldReduceMotion
                                        ? undefined
                                        : {
                                            opacity: 0,
                                            y: 28,
                                        }
                                }
                                whileInView={
                                    shouldReduceMotion
                                        ? undefined
                                        : {
                                            opacity: 1,
                                            y: 0,
                                        }
                                }
                                viewport={{
                                    once: true,
                                    amount: 0.25,
                                }}
                                transition={{
                                    duration: 0.55,
                                    delay: index * 0.08,
                                }}
                                className="how-step-card group relative rounded-[2rem] border border-white/90 bg-white/70 p-7 backdrop-blur-xl"
                            >
                                {/* Step icon and number */}
                                <div className="flex items-center justify-between">
                                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#eee6ff] to-[#e1f3ff] text-[#7656c6] transition duration-300 group-hover:scale-110 group-hover:from-[#8564d1] group-hover:to-[#67a6d5] group-hover:text-white">
                                        <Icon
                                            size={25}
                                            aria-hidden="true"
                                        />
                                    </span>

                                    <span className="text-sm font-black tracking-[0.18em] text-[#9074c7]/55">
                                        {step.number}
                                    </span>
                                </div>

                                {/* Step content */}
                                <h3 className="mt-8 text-xl font-extrabold text-[#2a223d]">
                                    {step.title}
                                </h3>

                                <p className="mt-3 text-sm leading-7 text-[#756e83]">
                                    {step.description}
                                </p>
                            </motion.article>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}