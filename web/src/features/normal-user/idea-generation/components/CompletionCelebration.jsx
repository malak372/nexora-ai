import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const PARTICLE_COUNT = 42;

export default function CompletionCelebration({ ideaId, ideaTitle, onOpenIdea }) {
  const [countdown, setCountdown] = useState(3);
  const [showResult, setShowResult] = useState(false);

  const particles = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
      id: index,
      left: `${(index * 37) % 100}%`,
      delay: (index % 9) * 0.06,
      rotate: (index * 47) % 360,
      duration: 1.7 + (index % 5) * 0.18,
    })),
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
    }, 850);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="nx-celebration" role="dialog" aria-modal="true">
      <AnimatePresence mode="wait">
        {!showResult ? (
          <motion.div
            key={countdown}
            className="nx-celebration__count"
            initial={{ opacity: 0, scale: 0.6, rotate: -7 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 1.35 }}
          >
            {countdown}
          </motion.div>
        ) : (
          <motion.div
            key="result"
            className="nx-celebration__result"
            initial={{ opacity: 0, scale: 0.86, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 150, damping: 18 }}
          >
            {particles.map((particle) => (
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
            ))}

            <motion.span
              className="nx-celebration__icon"
              animate={{ rotate: [0, 6, -6, 0], scale: [1, 1.08, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 0.8 }}
            >
              <Sparkles size={28} />
            </motion.span>

            <p>Your validated normal idea is ready</p>
            <h2>{ideaTitle || 'A new Nexora workspace'}</h2>
            <span className="nx-celebration__unlock-note">
              <LockKeyhole size={16} />
              Open the idea first. Direct Unlock will appear inside its workspace whenever you need advanced outputs.
            </span>

            <button type="button" onClick={() => onOpenIdea(ideaId)}>
              Open idea workspace
              <ArrowRight size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}