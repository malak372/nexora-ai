/**
 * Premium-only welcome celebration shown after a successful premium sign-in.
 *
 * Elegant modal matched to the premium dashboard palette with a soft blurred
 * backdrop, a taller editorial card, celebratory sparkles, and a bottom-to-top
 * staggered letter reveal for "Welcome Back".
 *
 * @author Eman
 */
import { Crown, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

import { getStoredUser } from '../../../auth/shared/auth.storage';
import './premium-welcome-celebration.css';

const PREMIUM_WELCOME_KEY = 'voxidence:premium-welcome-pending';
const WELCOME_TEXT = 'Welcome Back';
const OUTER_CONFETTI_COUNT = 42;

const confettiItems = [
    { id: 1, top: '14%', left: '12%', size: 'lg', tone: 'teal', delay: 1.0 },
    { id: 2, top: '19%', left: '20%', size: 'sm', tone: 'sage', delay: 1.14 },
    { id: 3, top: '22%', left: '26%', size: 'xs', tone: 'pink', delay: 1.08 },
    { id: 4, top: '30%', left: '8%', size: 'sm', tone: 'teal', delay: 1.22 },
    { id: 5, top: '43%', left: '12%', size: 'md', tone: 'pink', delay: 1.18 },
    { id: 6, top: '57%', left: '18%', size: 'sm', tone: 'teal', delay: 1.28 },
    { id: 7, top: '72%', left: '14%', size: 'lg', tone: 'sage', delay: 1.34 },
    { id: 8, top: '78%', left: '23%', size: 'xs', tone: 'pink', delay: 1.26 },

    { id: 9, top: '14%', right: '18%', size: 'sm', tone: 'sage', delay: 1.12 },
    { id: 10, top: '18%', right: '10%', size: 'lg', tone: 'teal', delay: 1.24 },
    { id: 11, top: '24%', right: '20%', size: 'xs', tone: 'pink', delay: 1.1 },
    { id: 12, top: '28%', right: '13%', size: 'md', tone: 'teal', delay: 1.2 },
    { id: 13, top: '40%', right: '7%', size: 'sm', tone: 'sage', delay: 1.3 },
    { id: 14, top: '50%', right: '18%', size: 'sm', tone: 'pink', delay: 1.22 },
    { id: 15, top: '58%', right: '11%', size: 'md', tone: 'teal', delay: 1.32 },
    { id: 16, top: '74%', right: '16%', size: 'lg', tone: 'sage', delay: 1.42 },
];

function getDisplayName(user) {
    const fullName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();

    return fullName || user?.name || user?.fullName || '';
}

export function markPremiumWelcomePending(user) {
    const accountStatus = String(user?.accountStatus || '').toUpperCase();

    if (accountStatus === 'PREMIUM') {
        sessionStorage.setItem(PREMIUM_WELCOME_KEY, 'true');
    } else {
        sessionStorage.removeItem(PREMIUM_WELCOME_KEY);
    }
}

export default function PremiumWelcomeCelebration() {
    const shouldReduceMotion = useReducedMotion();
    const [isVisible, setIsVisible] = useState(false);
    const user = useMemo(() => getStoredUser() || {}, []);
    const displayName = useMemo(() => getDisplayName(user), [user]);

    const outerConfetti = useMemo(
        () =>
            Array.from({ length: OUTER_CONFETTI_COUNT }, (_, index) => {
                const palette = ['teal', 'pink', 'sage', 'ivory'];
                const shapes = ['rectangle', 'circle', 'ribbon'];

                return {
                    id: index,
                    left: `${(index * 17 + 4) % 100}%`,
                    delay: 0.72 + (index % 10) * 0.075,
                    duration: 2.35 + (index % 6) * 0.18,
                    rotation: (index * 53) % 360,
                    drift: `${((index % 9) - 4) * 22}px`,
                    sway: `${((index % 7) - 3) * 16}px`,
                    size: `${6 + (index % 5) * 2}px`,
                    color: palette[index % palette.length],
                    shape: shapes[index % shapes.length],
                };
            }),
        [],
    );

    useEffect(() => {
        /*
         * The welcome must not wait for /users/credits or dashboard data.
         * Login has already returned the authoritative account snapshot and
         * saveAuthSession persisted it before navigation. Reading that local
         * snapshot lets the celebration mount on the very first workspace
         * frame while the dashboard route/data continue loading underneath.
         */
        const isPending =
            sessionStorage.getItem(PREMIUM_WELCOME_KEY) === 'true';

        if (!isPending) {
            return;
        }

        sessionStorage.removeItem(PREMIUM_WELCOME_KEY);

        const accountStatus = String(user?.accountStatus || '').toUpperCase();

        if (accountStatus === 'PREMIUM') {
            setIsVisible(true);
        }
    }, [user]);

    useEffect(() => {
        if (!isVisible) {
            return undefined;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const timer = window.setTimeout(() => {
            setIsVisible(false);
        }, 4000);

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setIsVisible(false);
            }
        };

        window.addEventListener('keydown', handleEscape);

        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = previousOverflow;
        };
    }, [isVisible]);

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    className="premium-welcome"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28 }}
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Welcome back${displayName ? `, ${displayName}` : ''}`}
                    onClick={() => setIsVisible(false)}
                >
                    <div className="premium-welcome__backdrop" />

                    {!shouldReduceMotion && (
                        <div className="premium-welcome__outer-confetti" aria-hidden="true">
                            {outerConfetti.map((piece) => (
                                <span
                                    key={piece.id}
                                    className={`premium-welcome__outer-piece premium-welcome__outer-piece--${piece.color} premium-welcome__outer-piece--${piece.shape}`}
                                    style={{
                                        left: piece.left,
                                        '--piece-size': piece.size,
                                        '--piece-drift': piece.drift,
                                        '--piece-sway': piece.sway,
                                        '--piece-start-rotation': `${piece.rotation}deg`,
                                        animationDelay: `${piece.delay}s`,
                                        animationDuration: `${piece.duration}s`,
                                    }}
                                />
                            ))}
                        </div>
                    )}

                    <motion.section
                        className="premium-welcome__card"
                        onClick={(event) => event.stopPropagation()}
                        initial={{ opacity: 0, y: 28, scale: 0.975 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 18, scale: 0.985 }}
                        transition={{ duration: 0.56, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <button
                            type="button"
                            className="premium-welcome__close"
                            onClick={() => setIsVisible(false)}
                            aria-label="Close welcome"
                        >
                            <X size={20} strokeWidth={2.15} />
                        </button>

                        <div className="premium-welcome__glow premium-welcome__glow--left" aria-hidden="true" />
                        <div className="premium-welcome__glow premium-welcome__glow--right" aria-hidden="true" />
                        <div className="premium-welcome__mist premium-welcome__mist--left" aria-hidden="true" />
                        <div className="premium-welcome__mist premium-welcome__mist--right" aria-hidden="true" />

                        <motion.div
                            className="premium-welcome__eyebrow"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.35, delay: 0.15 }}
                        >
                            <Crown size={15} strokeWidth={1.9} />
                            <span>Premium workspace</span>
                            <Sparkles size={14} strokeWidth={1.9} />
                        </motion.div>

                        <div className="premium-welcome__confetti" aria-hidden="true">
                            {confettiItems.map((item) => (
                                <motion.span
                                    key={item.id}
                                    className={`premium-welcome__spark premium-welcome__spark--${item.size} premium-welcome__spark--${item.tone}`}
                                    style={{
                                        top: item.top,
                                        left: item.left,
                                        right: item.right,
                                    }}
                                    initial={{ opacity: 0, scale: 0.4, y: 10 }}
                                    animate={{ opacity: [0, 1, 0.8], scale: [0.4, 1, 0.92], y: [10, 0, -2] }}
                                    transition={{
                                        duration: 0.8,
                                        delay: item.delay,
                                        ease: [0.16, 1, 0.3, 1],
                                    }}
                                />
                            ))}
                        </div>

                        <h2 className="premium-welcome__title" aria-label={WELCOME_TEXT}>
                            {Array.from(WELCOME_TEXT).map((character, index) => (
                                <span
                                    key={`${character}-${index}`}
                                    className={`premium-welcome__character-window${character === ' ' ? ' premium-welcome__space' : ''}`}
                                    aria-hidden="true"
                                >
                                    <motion.span
                                        className="premium-welcome__character"
                                        initial={{ opacity: 0, y: '125%' }}
                                        animate={{ opacity: 1, y: '0%' }}
                                        transition={{
                                            duration: 0.58,
                                            delay: 0.28 + index * 0.06,
                                            ease: [0.16, 1, 0.3, 1],
                                        }}
                                    >
                                        {character === ' ' ? '\u00A0' : character}
                                    </motion.span>
                                </span>
                            ))}
                        </h2>

                        <motion.div
                            className="premium-welcome__divider"
                            initial={{ opacity: 0, scaleX: 0.25 }}
                            animate={{ opacity: 1, scaleX: 1 }}
                            transition={{ duration: 0.6, delay: 1.02, ease: [0.16, 1, 0.3, 1] }}
                        >
                            <span className="premium-welcome__divider-star" />
                        </motion.div>

                        <motion.p
                            className="premium-welcome__message"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.42, delay: 1.1 }}
                        >
                            Your premium workspace is ready.
                        </motion.p>

                        {displayName && (
                            <motion.p
                                className="premium-welcome__name"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.42, delay: 1.22 }}
                            >
                                <span className="premium-welcome__name-deco">✦</span>
                                {displayName}
                                <span className="premium-welcome__name-deco">✦</span>
                            </motion.p>
                        )}
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>
    );
}