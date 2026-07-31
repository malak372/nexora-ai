/**
 * Renders a preview of featured software ideas on the Nexora landing page.
 *
 * The section gives public visitors a clear example of the structured
 * opportunities Nexora can produce before they create an account.
 *
 * Idea content is loaded from the centralized home-page constants to keep
 * the component focused on presentation and easy to connect to the backend
 * in a later development step.
 *
 * @component
 * @returns {JSX.Element} The featured ideas preview section.
 *
 * @author Eman
 */

import { motion, useReducedMotion } from 'framer-motion';
import {
    ArrowUpRight,
    Building2,
    GraduationCap,
    HeartPulse,
    Lightbulb,
    MapPin,
    Sparkles,
    UsersRound,
} from 'lucide-react';

import { FEATURED_IDEAS } from '../constants/home.constants';

/**
 * Maps featured-idea icon identifiers to Lucide React components.
 *
 * @type {Object.<string, import('lucide-react').LucideIcon>}
 */
const IDEA_ICONS = {
    education: GraduationCap,
    health: HeartPulse,
    business: Building2,
    community: UsersRound,
};

/**
 * Maps featured-idea visual variants to reusable Tailwind classes.
 *
 * @type {Object.<string, {
 *     icon: string,
 *     badge: string,
 *     glow: string
 * }>}
 */
const IDEA_VARIANTS = {
    lavender: {
        icon: 'from-[#8b6bd8] to-[#a98be8]',
        badge: 'border-[#e3d8fa] bg-[#f5f0ff] text-[#7555c7]',
        glow: 'bg-[#d9c8ff]/45',
    },

    sky: {
        icon: 'from-[#5e9ed0] to-[#79b8df]',
        badge: 'border-[#d7ebf8] bg-[#eff9ff] text-[#4d8ebd]',
        glow: 'bg-[#ccecff]/45',
    },

    pink: {
        icon: 'from-[#c779aa] to-[#df9fc0]',
        badge: 'border-[#f2dbea] bg-[#fff3f9] text-[#a9618a]',
        glow: 'bg-[#ffd8eb]/45',
    },
};

/**
 * Displays a single featured software idea.
 *
 * @param {Object} props - Component properties.
 * @param {Object} props.idea - Featured-idea configuration.
 * @param {number} props.index - Card position used for animation delay.
 * @param {boolean} props.shouldReduceMotion - Reduced-motion preference.
 *
 * @returns {JSX.Element} A featured idea card.
 */
function FeaturedIdeaCard({
    idea,
    index,
    shouldReduceMotion,
}) {
    const Icon = IDEA_ICONS[idea.icon] || Lightbulb;
    const variant =
        IDEA_VARIANTS[idea.variant] || IDEA_VARIANTS.lavender;

    return (
        <motion.article
            initial={
                shouldReduceMotion
                    ? undefined
                    : {
                        opacity: 0,
                        y: 30,
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
                amount: 0.2,
            }}
            transition={{
                duration: 0.55,
                delay: index * 0.08,
            }}
            className="featured-idea-card group relative overflow-hidden rounded-[2rem] border border-white/90 bg-white/75 p-6 backdrop-blur-xl"
        >
            <div
                className={`absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl ${variant.glow}`}
                aria-hidden="true"
            />

            <div className="relative z-10">
                <div className="flex items-start justify-between gap-5">
                    <span
                        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_14px_30px_rgba(98,75,145,0.18)] ${variant.icon}`}
                    >
                        <Icon
                            size={25}
                            aria-hidden="true"
                        />
                    </span>

                    <span
                        className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${variant.badge}`}
                    >
                        {idea.domain}
                    </span>
                </div>

                <div className="mt-7 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#8b8297]">
                    <MapPin
                        size={14}
                        aria-hidden="true"
                    />

                    {idea.location}
                </div>

                <h3 className="mt-4 text-xl font-black leading-7 text-[#2b233d]">
                    {idea.title}
                </h3>

                <p className="mt-4 text-sm leading-7 text-[#756e83]">
                    {idea.problem}
                </p>

                <div className="mt-6 border-t border-[#eee8f5] pt-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#8464c8]">
                        Proposed direction
                    </p>

                    <p className="mt-2 text-sm font-semibold leading-6 text-[#40364f]">
                        {idea.solution}
                    </p>
                </div>

                <button
                    type="button"
                    className="mt-7 inline-flex items-center gap-2 text-sm font-extrabold text-[#7656c6] transition duration-300 group-hover:gap-3"
                    aria-label={`Preview the ${idea.title} idea`}
                >
                    Preview idea

                    <ArrowUpRight
                        size={17}
                        aria-hidden="true"
                    />
                </button>
            </div>
        </motion.article>
    );
}

/**
 * Displays selected software opportunities generated by Nexora.
 *
 * @returns {JSX.Element}
 */
export default function FeaturedIdeasSection() {
    const shouldReduceMotion = useReducedMotion();

    return (
        <section
            id="featured-ideas"
            className="featured-ideas-section relative scroll-mt-24 overflow-hidden py-24 sm:py-32"
            aria-labelledby="featured-ideas-heading"
        >
            <div
                className="featured-ideas-orb featured-ideas-orb-one"
                aria-hidden="true"
            />

            <div
                className="featured-ideas-orb featured-ideas-orb-two"
                aria-hidden="true"
            />

            <div className="nexora-container relative z-10">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <p className="nexora-eyebrow">
                            Featured opportunities
                        </p>

                        <h2
                            id="featured-ideas-heading"
                            className="nexora-section-title mt-5"
                        >
                            See what evidence-driven ideas look like.
                        </h2>

                        <p className="nexora-section-description mt-5">
                            Each Nexora idea begins with a real problem,
                            identifies its target users, and proposes a clear
                            software direction worth investigating.
                        </p>
                    </div>

                    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#e2d7f6] bg-white/75 px-4 py-2 text-sm font-bold text-[#7656c6] shadow-sm backdrop-blur-xl">
                        <Sparkles
                            size={16}
                            aria-hidden="true"
                        />

                        Generated from community evidence
                    </div>
                </div>

                <div className="mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {FEATURED_IDEAS.map((idea, index) => (
                        <FeaturedIdeaCard
                            key={idea.id}
                            idea={idea}
                            index={index}
                            shouldReduceMotion={shouldReduceMotion}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}