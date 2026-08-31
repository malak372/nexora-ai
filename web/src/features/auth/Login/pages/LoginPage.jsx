/**
 * Voxidence creative login page.
 *
 * Renders an animated authentication experience, authenticates the user,
 * persists the session, and redirects them to the proper workspace.
 *
 * NORMAL and PREMIUM accounts both use the normal user workspace because
 * PREMIUM is an account status rather than an application role.
 *
 * @author Malak
 */

import {
    ArrowLeft,
    ArrowUpRight,
    BrainCircuit,
    CheckCircle2,
    Layers3,
    Radar,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ROUTES } from '../../../../constants/routes.constants';
import { preloadRoute } from '../../../../routes/routePreloaders';
import { preloadAdminRoute } from '../../../../routes/adminRoutePreloaders';
import { saveAuthSession } from '../../shared/auth.storage';
import { markPremiumWelcomePending } from '../../../normal-user/shared/components/PremiumWelcomeCelebration';
import { login } from '../api/login.api';
import LoginForm from '../components/LoginForm';
import VoxidenceMark from '../../../../components/brand/VoxidenceMark';
import { useUserExperience } from '../../../../system/user-experience';

import '../styles/login-page.css';

const storyItems = [
    {
        icon: Radar,
        title: 'Hear what others miss',
        text: 'Reveal recurring needs hidden in real conversations.',
    },
    {
        icon: BrainCircuit,
        title: 'Turn noise into direction',
        text: 'Turn raw signals into focused, validated opportunities.',
    },
    {
        icon: Layers3,
        title: 'Build with confidence',
        text: 'Move from discovery to confident planning in one workspace.',
    },
];

const particles = Array.from({ length: 16 }, (_, index) => index);

function getDestinationByUser(user) {
    const role = String(user?.role || '')
        .trim()
        .toUpperCase();
    const accountStatus = String(user?.accountStatus || '')
        .trim()
        .toUpperCase();

    if (role === 'ADMIN') {
        return '/admin/dashboard';
    }

    return accountStatus === 'PREMIUM'
        ? '/premium/dashboard'
        : '/normal/dashboard';
}

export default function LoginPage() {
    const { t } = useUserExperience();
    const navigate = useNavigate();
    const pageRef = useRef(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [serverError, setServerError] = useState(null);

    /**
     * Updates the decorative background pixels using CSS variables.
     *
     * Direct DOM style updates are used instead of React state so pointer
     * movement stays smooth and does not re-render the login page.
     */
    const handlePointerMove = (event) => {
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

        page.style.setProperty('--nx-pointer-visible', '1');
    };

    /**
     * Hides the decorative pixels after the pointer leaves the page.
     */
    const handlePointerLeave = () => {
        pageRef.current?.style.setProperty(
            '--nx-pointer-visible',
            '0',
        );
    };

    const handleLogin = async (values) => {
        setServerError(null);
        setIsSubmitting(true);

        try {
            // Download the most common post-login route chunk while the backend
            // authenticates. This does not call protected APIs before a token
            // exists, but removes the cold React-chunk wait after success.
            const dashboardChunkPromise = import(
                '../../../normal-user/dashboard/pages/NormalDashboardPage'
            ).catch(() => null);

            const session = await login({
                email: values.email,
                password: values.password,
            });

            saveAuthSession(session, values.rememberMe);
            markPremiumWelcomePending(session.user);

            const destination = getDestinationByUser(session.user);

            if (destination === '/normal/dashboard' || destination === '/premium/dashboard') {
                // Now that the token is stored, start the first dashboard data
                // request before navigation. cachedRequest deduplicates it with
                // the page request if both happen at nearly the same time.
                void dashboardChunkPromise;
                preloadRoute(destination);
            } else if (destination === '/admin/dashboard') {
                // Admin users get the same route-and-data warming before the
                // workspace transition, removing the cold admin dashboard wait.
                preloadAdminRoute('/admin/dashboard');
            }

            navigate(destination, { replace: true });
        } catch (error) {
            setServerError({
                type: error?.type || 'error',
                title: error?.title || 'Sign in failed',
                message:
                    error?.message ||
                    'Invalid email or password.',
                code: error?.code,
                attemptsRemaining:
                    error?.attemptsRemaining,
                remainingSeconds:
                    error?.remainingSeconds,
                remainingMinutes:
                    error?.remainingMinutes,
                justLocked: Boolean(error?.justLocked),
                lockDurationMinutes:
                    error?.lockDurationMinutes,
                lockedAt: error?.lockedAt,
                lockedUntil: error?.lockedUntil,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <main
            ref={pageRef}
            className="nx-login"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
        >
            <div
                className="nx-login__cursor-pixels"
                aria-hidden="true"
            />
            <div className="nx-login__gradient-flow" aria-hidden="true" />
            <div className="nx-login__mesh" aria-hidden="true" />
            <div className="nx-login__grain" aria-hidden="true" />
            <div className="nx-login__beam" aria-hidden="true" />
            <div className="nx-login__silk nx-login__silk--one" aria-hidden="true" />
            <div className="nx-login__silk nx-login__silk--two" aria-hidden="true" />
            <div className="nx-login__prism" aria-hidden="true" />
            <div className="nx-login__light-ring" aria-hidden="true" />

            <div className="nx-login__particles" aria-hidden="true">
                {particles.map((particle) => (
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

            <section className="nx-login__experience">
                <motion.section
                    className="nx-login__story"
                    initial={{ opacity: 0, x: -38 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                        duration: 0.78,
                        ease: [0.22, 1, 0.36, 1],
                    }}
                >
                    <header className="nx-brand">
                        <Link className="nx-brand__link" to={ROUTES.HOME}>
                            <motion.span
                                className="nx-brand__symbol"
                                whileHover={{ rotate: 10, scale: 1.08 }}
                                whileTap={{ scale: 0.96 }}
                            >
                                <VoxidenceMark size={46} />
                            </motion.span>

                            <span className="nx-brand__copy">
                                <strong dir="ltr" data-no-auto-translate="true">Voxidence</strong>
                                <small>{t('Ideas built from real needs')}</small>
                            </span>
                        </Link>

                    </header>

                    <div className="nx-signal-map" aria-hidden="true">
                        <span className="nx-signal-map__orbit nx-signal-map__orbit--one" />
                        <span className="nx-signal-map__orbit nx-signal-map__orbit--two" />
                        <span className="nx-signal-map__node nx-signal-map__node--one" />
                        <span className="nx-signal-map__node nx-signal-map__node--two" />
                        <span className="nx-signal-map__node nx-signal-map__node--three" />
                    </div>

                    <div className="nx-login__story-content">
                        <motion.div
                            className="nx-kicker"
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.14 }}
                        >
                            <Sparkles size={15} aria-hidden="true" />
                            {t('Discover what is worth building')}
                        </motion.div>

                        <motion.h1
                            initial={{ opacity: 0, y: 22 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.21 }}
                        >
                            {t('Every great project')}
                            <span>{t('begins as a hidden signal.')}</span>
                        </motion.h1>

                        <motion.p
                            className="nx-login__lead"
                            initial={{ opacity: 0, y: 18 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.29 }}
                        >
                            {t('Voxidence listens to real community needs, discovers the patterns others overlook, and transforms them into software ideas backed by evidence—not guesswork.')}
                        </motion.p>

                        <motion.div
                            className="nx-login__story-items"
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
                            {storyItems.map(({ icon: Icon, title, text }) => (
                                <motion.article
                                    className="nx-story-item"
                                    key={title}
                                    variants={{
                                        hidden: { opacity: 0, y: 16 },
                                        visible: { opacity: 1, y: 0 },
                                    }}
                                    whileHover={{ y: -6 }}
                                >
                                    <span className="nx-story-item__glow" />

                                    <span className="nx-story-item__icon">
                                        <Icon size={18} aria-hidden="true" />
                                    </span>

                                    <span>
                                        <strong>{t(title)}</strong>
                                        <small>{t(text)}</small>
                                    </span>

                                    <ArrowUpRight
                                        className="nx-story-item__arrow"
                                        size={17}
                                        aria-hidden="true"
                                    />
                                </motion.article>
                            ))}
                        </motion.div>
                    </div>

                    <footer className="nx-login__story-footer">
                        <div className="nx-login__mini-orbit" aria-hidden="true">
                            <span>VX</span>
                            <span>AI</span>
                            <span>+</span>
                        </div>

                        <div>
                            <strong>{t('From scattered signals to clear direction.')}</strong>
                            <span>
                                <CheckCircle2 size={14} aria-hidden="true" />
                                {t('Your private workspace is ready when you are.')}
                            </span>
                        </div>
                    </footer>
                </motion.section>

                <motion.section
                    className="nx-login__auth"
                    initial={{ opacity: 0, x: 38 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                        duration: 0.78,
                        delay: 0.08,
                        ease: [0.22, 1, 0.36, 1],
                    }}
                    aria-labelledby="login-heading"
                >
                    <div className="nx-login__mobile-brand">
                        <Link className="nx-brand__link" to={ROUTES.HOME}>
                            <span className="nx-brand__symbol">
                                <VoxidenceMark size={21} />
                            </span>

                            <span className="nx-brand__copy">
                                <strong dir="ltr" data-no-auto-translate="true">Voxidence</strong>
                                <small>{t('Ideas built from real needs')}</small>
                            </span>
                        </Link>
                    </div>

                    <motion.div
                        className="nx-auth-card"
                        initial={{ opacity: 0, y: 20, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{
                            duration: 0.62,
                            delay: 0.2,
                            ease: [0.22, 1, 0.36, 1],
                        }}
                    >
                        <div className="nx-auth-card__spotlight" aria-hidden="true" />

                        <div className="nx-auth-card__topline">
                            <span>
                                <ShieldCheck size={15} aria-hidden="true" />
                                {t('Your workspace awaits')}
                            </span>

                            <Link
                                to={ROUTES.HOME}
                                className="nx-auth-card__back-home"
                                aria-label="Back to Voxidence home page"
                            >
                                <ArrowLeft size={14} aria-hidden="true" />
                                {t('Back to home')}
                            </Link>
                        </div>

                        <div className="nx-auth-card__heading">
                            <h2 id="login-heading">
                                {t('Step back into the signal.')}
                            </h2>
                            <p>
                                {t('Continue discovering, validating, and shaping ideas designed to solve real problems.')}
                            </p>
                        </div>

                        <LoginForm
                            isSubmitting={isSubmitting}
                            onDismissError={() => setServerError(null)}
                            onSubmit={handleLogin}
                            serverError={serverError}
                        />

                        <div className="nx-auth-card__trust">
                            <ShieldCheck size={15} aria-hidden="true" />
                            <span>
                                {t('Protected credentials. Private ideas. Secure workspace.')}
                            </span>
                        </div>
                    </motion.div>
                </motion.section>
            </section>
        </main>
    );
}