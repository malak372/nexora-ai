/**
 * Displays the Voxidence registration experience.
 *
 * Reuses the animated identity of the sign-in page while presenting
 * a compact account-creation flow for new users.
 *
 * @component
 * @returns {JSX.Element} The registration page.
 *
 * @author Eman
 */

import {
    ArrowLeft,
    CheckCircle2,
    Layers3,
    Search,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';

import RegisterForm from '../components/RegisterForm';
import VoxidenceMark from '../../../../components/brand/VoxidenceMark';

import '../../Login/styles/login-page.css';
import '../styles/register-page.css';

const REGISTER_BENEFITS = [
    {
        title: 'Hear what others miss',
        description:
            'Reveal repeating needs hidden inside real community signals.',
        icon: Search,
    },
    {
        title: 'Turn noise into direction',
        description:
            'Transform scattered feedback into focused project direction.',
        icon: Layers3,
    },
    {
        title: 'Build with confidence',
        description:
            'Keep ideas, evidence, and discovery progress in one workspace.',
        icon: ShieldCheck,
    },
];

const BACKGROUND_PARTICLES = Array.from(
    {
        length: 16,
    },
    (_, index) => index,
);

export default function RegisterPage() {
    const pageRef = useRef(null);

    function handlePointerMove(event) {
        const page = pageRef.current;

        if (!page || event.pointerType === 'touch') {
            return;
        }

        const bounds = page.getBoundingClientRect();

        page.style.setProperty(
            '--nx-pointer-x',
            `${event.clientX - bounds.left}px`,
        );

        page.style.setProperty(
            '--nx-pointer-y',
            `${event.clientY - bounds.top}px`,
        );

        page.style.setProperty(
            '--nx-pointer-visible',
            '1',
        );
    }

    function handlePointerLeave() {
        pageRef.current?.style.setProperty(
            '--nx-pointer-visible',
            '0',
        );
    }

    return (
        <main
            ref={pageRef}
            className="nx-login nx-register"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
        >
            <div
                className="nx-login__cursor-pixels"
                aria-hidden="true"
            />

            <div
                className="nx-login__gradient-flow"
                aria-hidden="true"
            />

            <div
                className="nx-login__mesh"
                aria-hidden="true"
            />

            <div
                className="nx-login__grain"
                aria-hidden="true"
            />

            <div
                className="nx-login__beam"
                aria-hidden="true"
            />

            <div
                className="nx-login__particles"
                aria-hidden="true"
            >
                {BACKGROUND_PARTICLES.map((particle) => (
                    <span key={particle} />
                ))}
            </div>

            <motion.div
                className="nx-login__aurora nx-login__aurora--one"
                aria-hidden="true"
                animate={{
                    x: [0, 95, 20, 0],
                    y: [0, -45, 50, 0],
                    scale: [1, 1.14, 0.95, 1],
                }}
                transition={{
                    duration: 18,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />

            <motion.div
                className="nx-login__aurora nx-login__aurora--two"
                aria-hidden="true"
                animate={{
                    x: [0, -80, -20, 0],
                    y: [0, 55, -30, 0],
                    scale: [1, 0.94, 1.17, 1],
                }}
                transition={{
                    duration: 21,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />

            <motion.div
                className="nx-login__aurora nx-login__aurora--three"
                aria-hidden="true"
                animate={{
                    x: [0, 45, -35, 0],
                    y: [0, -60, -12, 0],
                    scale: [1, 1.12, 0.93, 1],
                }}
                transition={{
                    duration: 16,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />

            <section className="nx-register__layout">
                <motion.aside
                    className="nx-register__story"
                    initial={{
                        opacity: 0,
                        x: -38,
                    }}
                    animate={{
                        opacity: 1,
                        x: 0,
                    }}
                    transition={{
                        duration: 0.78,
                        ease: [0.22, 1, 0.36, 1],
                    }}
                >
                    <header className="nx-register__brand-row">
                        <Link
                            to="/"
                            className="nx-register__brand"
                            aria-label="Go to Voxidence home page"
                        >
                            <motion.span
                                className="nx-register__brand-mark"
                                whileHover={{
                                    rotate: 10,
                                    scale: 1.08,
                                }}
                                whileTap={{
                                    scale: 0.96,
                                }}
                            >
                                <VoxidenceMark size={46} />
                            </motion.span>

                            <span className="nx-register__brand-copy">
                                <strong>Voxidence</strong>

                                <small>
                                    Ideas built from real needs
                                </small>
                            </span>
                        </Link>
                    </header>

                    <div
                        className="nx-register__signal-map"
                        aria-hidden="true"
                    >
                        <span className="nx-register__signal-orbit" />

                        <span className="nx-register__signal-orbit nx-register__signal-orbit--inner" />

                        <span className="nx-register__signal-node nx-register__signal-node--one" />

                        <span className="nx-register__signal-node nx-register__signal-node--two" />

                        <span className="nx-register__signal-node nx-register__signal-node--three" />
                    </div>

                    <div className="nx-register__story-content">
                        <motion.div
                            className="nx-register__eyebrow"
                            initial={{
                                opacity: 0,
                                y: 14,
                            }}
                            animate={{
                                opacity: 1,
                                y: 0,
                            }}
                            transition={{
                                delay: 0.14,
                            }}
                        >
                            <Sparkles
                                size={15}
                                aria-hidden="true"
                            />

                            Discover what is worth building
                        </motion.div>

                        <motion.h1
                            initial={{
                                opacity: 0,
                                y: 22,
                            }}
                            animate={{
                                opacity: 1,
                                y: 0,
                            }}
                            transition={{
                                delay: 0.21,
                            }}
                        >
                            Every great project

                            <span>
                                begins as a hidden signal.
                            </span>
                        </motion.h1>

                        <motion.p
                            className="nx-register__description"
                            initial={{
                                opacity: 0,
                                y: 18,
                            }}
                            animate={{
                                opacity: 1,
                                y: 0,
                            }}
                            transition={{
                                delay: 0.29,
                            }}
                        >
                            Voxidence listens to real community needs, discovers
                            the patterns others overlook, and transforms them
                            into software ideas backed by evidence—not
                            guesswork.
                        </motion.p>

                        <motion.div
                            className="nx-register__benefits"
                            initial="hidden"
                            animate="visible"
                            variants={{
                                hidden: {},
                                visible: {
                                    transition: {
                                        staggerChildren: 0.1,
                                        delayChildren: 0.37,
                                    },
                                },
                            }}
                        >
                            {REGISTER_BENEFITS.map((benefit) => {
                                const Icon = benefit.icon;

                                return (
                                    <motion.article
                                        key={benefit.title}
                                        className="nx-register__benefit"
                                        variants={{
                                            hidden: {
                                                opacity: 0,
                                                y: 16,
                                            },
                                            visible: {
                                                opacity: 1,
                                                y: 0,
                                            },
                                        }}
                                        whileHover={{
                                            y: -6,
                                        }}
                                    >
                                        <span className="nx-register__benefit-glow" />

                                        <span className="nx-register__benefit-icon">
                                            <Icon
                                                size={18}
                                                aria-hidden="true"
                                            />
                                        </span>

                                        <div>
                                            <h2>
                                                {benefit.title}
                                            </h2>

                                            <p>
                                                {benefit.description}
                                            </p>
                                        </div>
                                    </motion.article>
                                );
                            })}
                        </motion.div>
                    </div>

                    <footer className="nx-register__story-footer">
                        <div
                            className="nx-register__mini-avatars"
                            aria-hidden="true"
                        >
                            <span>VX</span>
                            <span>AI</span>
                            <span>+</span>
                        </div>

                        <div>
                            <strong>
                                From scattered signals to clear direction.
                            </strong>

                            <p>
                                <CheckCircle2
                                    size={14}
                                    aria-hidden="true"
                                />

                                Your private workspace is ready when you are.
                            </p>
                        </div>
                    </footer>
                </motion.aside>

                <motion.section
                    className="nx-register__form-panel"
                    initial={{
                        opacity: 0,
                        x: 38,
                    }}
                    animate={{
                        opacity: 1,
                        x: 0,
                    }}
                    transition={{
                        duration: 0.78,
                        delay: 0.08,
                        ease: [0.22, 1, 0.36, 1],
                    }}
                >
                    <div className="nx-register__form-card">
                        <span
                            className="nx-register__card-spotlight"
                            aria-hidden="true"
                        />

                        <header className="nx-register__form-heading">
                            <div className="nx-register__form-topline">
                                <span className="nx-register__form-kicker">
                                    <ShieldCheck
                                        size={15}
                                        aria-hidden="true"
                                    />

                                    Your workspace awaits
                                </span>

                                <Link
                                    to="/"
                                    className="nx-register__back-home"
                                    aria-label="Back to Nexora home page"
                                >
                                    <ArrowLeft size={14} aria-hidden="true" />
                                    Back to home
                                </Link>
                            </div>

                            <h2>
                                Create your account.
                            </h2>

                            <p>
                                Add your details, choose your role, then verify
                                your email to activate your workspace.
                            </p>
                        </header>

                        <RegisterForm />

                        <footer className="nx-register__security-note">
                            <ShieldCheck
                                size={15}
                                aria-hidden="true"
                            />

                            Protected account. Verified email. Private ideas.
                        </footer>
                    </div>
                </motion.section>
            </section>
        </main>
    );
}