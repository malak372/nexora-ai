/**
 * Completion celebration shown after a persisted idea is confirmed.
 *
 * Normal users keep the concise completion dialog. Premium users receive a
 * separate cinematic reveal with a countdown, advanced-output indicators, and
 * a gold workspace treatment.
 *
 * @author Malak
 * @author Eman
 */
import {
  ArrowRight,
  CheckCircle2,
  Crown,
  Layers3,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import VoxidenceMark from '../../../../components/brand/VoxidenceMark';

const PARTICLE_COUNT = 32;
const PREMIUM_ORBIT_COUNT = 3;

export default function CompletionCelebration({
  ideaId,
  ideaTitle,
  isPremium = false,
  onOpenIdea,
}) {
  const shouldReduceMotion = useReducedMotion();
  const [countdown, setCountdown] = useState(3);
  const [showResult, setShowResult] = useState(false);

  const particles = useMemo(
    () =>
      Array.from(
        { length: PARTICLE_COUNT },
        (_, index) => ({
          id: index,
          left: `${(index * 37) % 100}%`,
          delay: (index % 8) * 0.06,
          rotate: (index * 47) % 360,
          duration: 1.6 + (index % 5) * 0.16,
        }),
      ),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          setShowResult(true);
          return 0;
        }

        return current - 1;
      });
    }, isPremium ? 920 : 760);

    return () => window.clearInterval(timer);
  }, [isPremium]);

  return (
    <div
      className={`nx-celebration ${isPremium ? 'nx-celebration--premium' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="generation-complete-title"
    >
      <AnimatePresence mode="wait">
        {!showResult ? (
          <motion.div
            key={countdown}
            className={`nx-celebration__count ${isPremium ? 'nx-celebration__count--premium' : ''}`}
            initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.68 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 1.24 }}
          >
            {isPremium ? (
              <>
                <motion.span
                  className="nx-premium-countdown__crown"
                  animate={shouldReduceMotion ? undefined : { y: [0, -7, 0], rotate: [0, 4, -4, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                >
                  <Crown size={27} />
                </motion.span>
                <strong>{countdown}</strong>
                <small>Preparing your complete premium workspace</small>
                <span className="nx-premium-countdown__track"><i /></span>
              </>
            ) : countdown}
          </motion.div>
        ) : (
          <motion.div
            key="result"
            className={`nx-celebration__result ${isPremium ? 'nx-celebration__result--premium' : ''}`}
            initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 155, damping: 19 }}
          >
            {!shouldReduceMotion
              ? particles.map((particle) => (
                <i
                  key={particle.id}
                  className="nx-celebration__particle"
                  style={{
                    left: particle.left,
                    animationDelay: `${particle.delay}s`,
                    animationDuration: `${particle.duration}s`,
                    transform: `rotate(${particle.rotate}deg)`,
                  }}
                />
              ))
              : null}

            {isPremium && !shouldReduceMotion
              ? Array.from({ length: PREMIUM_ORBIT_COUNT }, (_, index) => (
                <i key={index} className={`nx-premium-orbit nx-premium-orbit--${index + 1}`} />
              ))
              : null}

            <motion.span
              className="nx-celebration__icon"
              animate={shouldReduceMotion ? undefined : { rotate: [0, 4, -4, 0], scale: [1, 1.06, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 0.9 }}
            >
              {isPremium ? <Crown size={30} /> : <VoxidenceMark size={38} />}
            </motion.span>

            <span className="nx-celebration__eyebrow">
              {isPremium ? <Sparkles size={15} /> : <CheckCircle2 size={15} />}
              {isPremium ? 'Premium intelligence complete' : 'Generation complete'}
            </span>

            <h2 id="generation-complete-title">
              {ideaTitle || 'Your new Voxidence idea'}
            </h2>

            <p>
              {isPremium
                ? 'Your evidence-backed idea is ready with its complete advanced workspace, strategic outputs, and premium intelligence layers.'
                : 'Your validated idea has been saved and its workspace is ready.'}
            </p>

            {isPremium ? (
              <div className="nx-premium-ready-grid" aria-label="Premium workspace features ready">
                <span><WandSparkles size={17} /><b>Advanced outputs</b><small>Ready now</small></span>
                <span><Layers3 size={17} /><b>Complete workspace</b><small>Fully unlocked</small></span>
                <span><CheckCircle2 size={17} /><b>Evidence validated</b><small>Saved securely</small></span>
              </div>
            ) : null}

            <button type="button" onClick={() => onOpenIdea(ideaId)}>
              {isPremium ? 'Enter premium workspace' : 'Open idea workspace'}
              <ArrowRight size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}