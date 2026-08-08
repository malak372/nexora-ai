/**
 * Completion celebration shown after a persisted idea is confirmed.
 * A short 3 → 2 → 1 reveal is shared by normal and premium runs.
 * Premium keeps the richer finish, while normal uses a lighter celebration.
 */
import {
  ArrowRight,
  CheckCircle2,
  Crown,
  Lightbulb,
  Sparkles,
  Star,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';


const NORMAL_CONFETTI_COUNT = 18;
const PREMIUM_CONFETTI_COUNT = 34;

export default function CompletionCelebration({
  ideaId,
  ideaTitle,
  isPremium = false,
  onOpenIdea,
}) {
  const shouldReduceMotion = useReducedMotion();
  const [countdown, setCountdown] = useState(3);
  const celebrationReady = countdown === 0;

  const confetti = useMemo(() => {
    const count = isPremium ? PREMIUM_CONFETTI_COUNT : NORMAL_CONFETTI_COUNT;

    return Array.from({ length: count }, (_, index) => ({
      id: index,
      left: `${5 + ((index * 37) % 90)}%`,
      delay: (index % 10) * 0.052,
      drift: `${-42 + ((index * 53) % 84)}px`,
      rotate: `${(index * 47) % 180}deg`,
      duration: (isPremium ? 1.95 : 1.65) + (index % 5) * 0.16,
    }));
  }, [isPremium]);

  useEffect(() => {
    if (countdown <= 0) return undefined;

    const timer = window.setTimeout(() => {
      setCountdown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  const celebration = (
    <div
      className={`nx-celebration ${isPremium ? 'nx-celebration--premium' : 'nx-celebration--normal'} ${celebrationReady ? 'is-revealed' : 'is-counting'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={celebrationReady ? 'generation-complete-title' : 'generation-countdown-title'}
    >
      {!celebrationReady ? (
        <motion.div
          className={`nx-celebration-countdown ${isPremium ? 'nx-celebration-countdown--premium' : 'nx-celebration-countdown--normal'}`}
          initial={shouldReduceMotion ? undefined : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          <div className="nx-celebration-countdown__ambient" aria-hidden="true">
            <i className="nx-celebration-countdown__glow nx-celebration-countdown__glow--one" />
            <i className="nx-celebration-countdown__glow nx-celebration-countdown__glow--two" />
            <i className="nx-celebration-countdown__spark nx-celebration-countdown__spark--one" />
            <i className="nx-celebration-countdown__spark nx-celebration-countdown__spark--two" />
            <i className="nx-celebration-countdown__spark nx-celebration-countdown__spark--three" />
          </div>

          <span className="nx-celebration-countdown__eyebrow" id="generation-countdown-title">
            {isPremium ? <Crown size={16} /> : <Sparkles size={16} />}
            {isPremium ? 'Premium workspace prepared' : 'Your idea is ready'}
          </span>

          <div className="nx-celebration-countdown__number-stage">
            <i className="nx-celebration-countdown__ring nx-celebration-countdown__ring--outer" aria-hidden="true" />
            <i className="nx-celebration-countdown__ring nx-celebration-countdown__ring--middle" aria-hidden="true" />
            <i className="nx-celebration-countdown__ring nx-celebration-countdown__ring--inner" aria-hidden="true" />

            <motion.strong
              key={countdown}
              className="nx-celebration-countdown__number"
              initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.34, rotate: -5 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 1.35 }}
              transition={{ type: 'spring', stiffness: 210, damping: 16 }}
            >
              {countdown}
            </motion.strong>
          </div>

          <motion.strong
            key={`message-${countdown}`}
            className="nx-celebration-countdown__message"
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
          >
            {countdown === 3 ? 'Evidence locked in.' : countdown === 2 ? 'Workspace coming together.' : 'Get ready to reveal it.'}
          </motion.strong>

          <div className="nx-celebration-countdown__track" aria-hidden="true">
            <i className={countdown <= 3 ? 'is-active' : ''} />
            <i className={countdown <= 2 ? 'is-active' : ''} />
            <i className={countdown <= 1 ? 'is-active' : ''} />
          </div>

          <small>{isPremium ? 'Your complete premium workspace is about to open.' : 'Your validated idea is about to appear.'}</small>
        </motion.div>
      ) : (
        <>
          {!shouldReduceMotion ? (
            <div className="nx-celebration-burst" aria-hidden="true">
              <i className="nx-celebration-burst__ring nx-celebration-burst__ring--one" />
              {isPremium ? <i className="nx-celebration-burst__ring nx-celebration-burst__ring--two" /> : null}
              <i className="nx-celebration-burst__shine" />
              {confetti.map((piece) => (
                <i
                  key={piece.id}
                  className="nx-celebration-confetti"
                  style={{
                    '--left': piece.left,
                    '--delay': `${piece.delay}s`,
                    '--drift': piece.drift,
                    '--rotate': piece.rotate,
                    '--duration': `${piece.duration}s`,
                  }}
                />
              ))}
            </div>
          ) : null}

          <motion.div
            className={`nx-celebration__result ${isPremium ? 'nx-celebration__result--premium' : ''}`}
            initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.88, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 185, damping: 19, delay: 0.06 }}
          >
            <motion.div
              className="nx-celebration__spark-row"
              aria-hidden="true"
              initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.35 }}
            >
              <Sparkles size={isPremium ? 19 : 16} />
              <Star size={isPremium ? 14 : 11} />
              <Sparkles size={isPremium ? 15 : 13} />
            </motion.div>

            <motion.span
              className="nx-celebration__icon"
              initial={shouldReduceMotion ? undefined : { rotate: -10, scale: 0.75 }}
              animate={shouldReduceMotion ? undefined : { rotate: 0, scale: [1, 1.08, 1] }}
              transition={{ duration: 0.75, delay: 0.1, ease: 'easeOut' }}
            >
              {isPremium ? <Crown size={30} /> : <Lightbulb size={34} strokeWidth={1.9} />}
            </motion.span>

            <motion.span
              className="nx-celebration__eyebrow"
              initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.3 }}
            >
              {isPremium ? <Sparkles size={15} /> : <CheckCircle2 size={15} />}
              {isPremium ? 'Premium workspace ready' : 'Generation complete'}
            </motion.span>

            <motion.h2
              id="generation-complete-title"
              initial={shouldReduceMotion ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24, duration: 0.35 }}
            >
              {ideaTitle || 'Your new Voxidence idea'}
            </motion.h2>

            <motion.p
              initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.29, duration: 0.35 }}
            >
              {isPremium
                ? 'Your evidence-backed idea is ready, validated, saved, and unlocked with its advanced workspace.'
                : 'Your validated idea has been saved and its workspace is ready.'}
            </motion.p>

            {isPremium ? (
              <motion.div
                className="nx-premium-ready-line"
                aria-label="Premium workspace ready"
                initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.34, duration: 0.35 }}
              >
                <span><CheckCircle2 size={16} />Advanced outputs</span>
                <span><CheckCircle2 size={16} />Workspace unlocked</span>
                <span><CheckCircle2 size={16} />Evidence saved</span>
              </motion.div>
            ) : null}

            <motion.button
              type="button"
              onClick={() => onOpenIdea(ideaId)}
              initial={shouldReduceMotion ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.34 }}
              whileHover={shouldReduceMotion ? undefined : { y: -2, scale: 1.01 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
            >
              {isPremium ? 'Open premium workspace' : 'Open idea workspace'}
              <ArrowRight size={18} />
            </motion.button>
          </motion.div>
        </>
      )}
    </div>
  );

  return createPortal(celebration, document.body);
}