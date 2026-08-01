/**
 * Direct-unlock payment return page.
 *
 * The provider redirect confirms that checkout was completed, while Nexora
 * waits for the verified webhook before granting access.
 *
 * @author Malak
 */

import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';

import '../styles/direct-unlock.css';

export default function DirectUnlockSuccessPage() {
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  return (
    <main className="unlock-result-page">
      <motion.section
        className="unlock-result"
        initial={
          shouldReduceMotion
            ? undefined
            : {
                opacity: 0,
                y: 24,
                scale: 0.98,
              }
        }
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.62,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="unlock-result__orb unlock-result__orb--one" />
        <div className="unlock-result__orb unlock-result__orb--two" />

        <div className="unlock-result__icon">
          <CheckCircle2 size={38} />
          <span />
          <span />
        </div>

        <span className="unlock-result__eyebrow">
          <Sparkles size={14} />
          Payment return received
        </span>

        <h1>Payment received for verification.</h1>

        <p>
          Your payment provider redirected you successfully. Nexora will unlock
          the idea after the verified payment webhook is processed.
        </p>

        <div className="unlock-result__steps">
          <article className="is-complete">
            <CheckCircle2 size={18} />
            <div>
              <strong>Provider checkout completed</strong>
              <small>Your checkout return was received.</small>
            </div>
          </article>

          <article className="is-processing">
            <Clock3 size={18} />
            <div>
              <strong>Webhook verification</strong>
              <small>Nexora is confirming the payment securely.</small>
            </div>
          </article>

          <article>
            <ShieldCheck size={18} />
            <div>
              <strong>Workspace unlock</strong>
              <small>Advanced access appears after confirmation.</small>
            </div>
          </article>
        </div>

        <button
          type="button"
          onClick={() =>
            navigate(`/normal/ideas/${ideaId}`)
          }
        >
          Return to idea workspace
          <ArrowRight size={17} />
        </button>
      </motion.section>
    </main>
  );
}