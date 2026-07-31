/**
 * Renders the final call-to-action and contact section of the
 * Nexora public landing page.
 *
 * The section communicates the main value of the platform, presents
 * evidence-driven benefits, and provides a direct email action for
 * contacting the Nexora team.
 *
 * The contact email is read from the application environment variables.
 * A default email address is used when no custom value is configured.
 *
 * @component
 * @returns {JSX.Element} The Nexora contact and call-to-action section.
 *
 * @author Eman
 */

import {
    ArrowUpRight,
    CheckCircle2,
    Mail,
    Sparkles,
} from 'lucide-react';

import { VALUE_POINTS } from '../constants/home.constants';

/**
 * Public contact email used by the Nexora landing page.
 *
 * The value can be configured through the following environment variable:
 *
 * REACT_APP_CONTACT_EMAIL
 *
 * @type {string}
 */
const contactEmail =
    process.env.REACT_APP_CONTACT_EMAIL || 'ainexora0@gmail.com';

/**
 * Displays the main landing-page call-to-action and contact information.
 *
 * The section includes:
 * - A short platform value statement.
 * - A list of Nexora benefits.
 * - A contact card with a direct email action.
 *
 * @returns {JSX.Element}
 */
export default function HomeCtaSection() {
    return (
        <section
            id="contact"
            className="scroll-mt-24 py-24 sm:py-32"
            aria-labelledby="contact-heading"
        >
            <div className="nexora-container">
                <div className="contact-panel relative overflow-hidden rounded-[2.5rem] border border-white/90 px-6 py-12 shadow-[0_28px_70px_rgba(96,73,134,0.12)] sm:px-10 lg:px-16 lg:py-16">
                    {/* Decorative background element */}
                    <div
                        className="contact-orb"
                        aria-hidden="true"
                    />

                    <div className="relative z-10 grid gap-12 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
                        {/* Main value proposition */}
                        <div>
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/70 px-4 py-2 text-sm font-bold text-[#7656c6] backdrop-blur-xl">
                                <Sparkles
                                    size={16}
                                    aria-hidden="true"
                                />

                                Built for meaningful innovation
                            </span>

                            <h2
                                id="contact-heading"
                                className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-[#29213d] sm:text-5xl"
                            >
                                Better project ideas begin with better evidence.
                            </h2>

                            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#716a81]">
                                Nexora helps students, builders, and innovators
                                move beyond guesswork and discover software
                                opportunities grounded in what people actually
                                need.
                            </p>

                            {/* Platform value points */}
                            <div className="mt-8 space-y-3">
                                {VALUE_POINTS.map((point) => (
                                    <div
                                        key={point}
                                        className="flex items-center gap-3 text-sm font-semibold text-[#352b47] sm:text-base"
                                    >
                                        <CheckCircle2
                                            className="shrink-0 text-[#5da68b]"
                                            size={19}
                                            aria-hidden="true"
                                        />

                                        <span>{point}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Contact card */}
                        <div className="contact-card rounded-[2rem] border border-white/95 bg-white/70 p-7 backdrop-blur-2xl sm:p-9">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8060ce] to-[#64a6d8] text-white shadow-[0_14px_30px_rgba(106,82,176,0.22)]">
                                <Mail
                                    size={24}
                                    aria-hidden="true"
                                />
                            </div>

                            <p className="mt-7 text-sm font-bold uppercase tracking-[0.16em] text-[#80778c]">
                                Start a conversation
                            </p>

                            <h3 className="mt-3 text-2xl font-extrabold text-[#2a223d]">
                                Have a question about Nexora?
                            </h3>

                            <p className="mt-3 leading-7 text-[#756e83]">
                                Reach the team directly and we will be happy to
                                hear from you.
                            </p>

                            <a
                                href={`mailto:${contactEmail}`}
                                className="nexora-button-primary group mt-7 w-full gap-3"
                                aria-label={`Email the Nexora team at ${contactEmail}`}
                            >
                                Email the Nexora team

                                <ArrowUpRight
                                    className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1"
                                    size={19}
                                    aria-hidden="true"
                                />
                            </a>

                            <p className="mt-4 break-all text-center text-sm font-semibold text-[#7656c6]">
                                {contactEmail}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}