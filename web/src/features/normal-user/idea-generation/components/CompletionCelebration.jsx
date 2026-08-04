/**
 * Completion celebration shown after a persisted idea is confirmed.
 *
 * The dialog remains intentionally concise. It celebrates the result, displays
 * the saved idea title, and offers one clear action without repeating pipeline
 * explanations already shown during generation.
 *
 * @author Malak
 */
import {
  ArrowRight,
  CheckCircle2,
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

export default function CompletionCelebration({
  ideaId,
  ideaTitle,
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
    }, 760);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="nx-celebration"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generation-complete-title"
    >
      <AnimatePresence mode="wait">
        {!showResult ? (
          <motion.div
            key={countdown}
            className="nx-celebration__count"
            initial={
              shouldReduceMotion
                ? undefined
                : {
                    opacity: 0,
                    scale: 0.68,
                  }
            }
            animate={{
              opacity: 1,
              scale: 1,
            }}
            exit={
              shouldReduceMotion
                ? undefined
                : {
                    opacity: 0,
                    scale: 1.24,
                  }
            }
          >
            {countdown}
          </motion.div>
        ) : (
          <motion.div
            key="result"
            className="nx-celebration__result"
            initial={
              shouldReduceMotion
                ? undefined
                : {
                    opacity: 0,
                    scale: 0.9,
                    y: 24,
                  }
            }
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
            }}
            transition={{
              type: 'spring',
              stiffness: 155,
              damping: 19,
            }}
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

            <motion.span
              className="nx-celebration__icon"
              animate={
                shouldReduceMotion
                  ? undefined
                  : {
                      rotate: [0, 4, -4, 0],
                      scale: [1, 1.06, 1],
                    }
              }
              transition={{
                duration: 2.5,
                repeat: Infinity,
                repeatDelay: 0.9,
              }}
            >
              <VoxidenceMark size={38} />
            </motion.span>

            <span className="nx-celebration__eyebrow">
              <CheckCircle2 size={15} />
              Generation complete
            </span>

            <h2 id="generation-complete-title">
              {ideaTitle || 'Your new Voxidence idea'}
            </h2>

            <p>
              Your validated idea has been saved and its workspace is ready.
            </p>

            <button
              type="button"
              onClick={() => onOpenIdea(ideaId)}
            >
              Open idea workspace
              <ArrowRight size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}