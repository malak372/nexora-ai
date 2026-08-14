/**
 * Highlights the most recent generated idea.
 *
 * Preserves the existing navigation, workspace warm-up, unlock-state messaging,
 * responsive structure, and Framer Motion behavior. Visual styling is provided
 * by the documented Voxidence eucalyptus-and-rose rules in normal-dashboard.css.
 *
 * The free preview is presented first. Direct Unlock remains an optional
 * one-time action inside the idea workspace, never a prerequisite for reviewing
 * the generated result.
 */
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  LockKeyhole,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { warmIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';

export default function LatestIdeaCard({ idea }) {
  const navigate = useNavigate();

  if (!idea) {
    return (
      <motion.article className="normal-work-card normal-work-card--empty" whileHover={{ y: -4 }}>
        <IdeaVisual />
        <div className="normal-work-card__body">
          <span className="normal-eyebrow">Your next workspace</span>
          <h3>Your first validated idea starts here.</h3>
          <p>Describe one meaningful problem and let Voxidence transform it into a structured software opportunity.</p>
          <button className="normal-work-card__open" type="button" onClick={() => navigate('/normal/generate')}>
            Generate an idea <ArrowUpRight size={17} />
          </button>
        </div>
      </motion.article>
    );
  }

  const formattedDate = new Date(idea.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <motion.article
      className="normal-work-card normal-work-card--polished"
      whileHover={{ y: -5 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
    >
      <IdeaVisual />

      <div className="normal-work-card__body">
        <div className="normal-work-card__meta">
          <span className="normal-eyebrow">Latest validated idea</span>
          <span className={idea.isUnlocked ? 'status-pill status-pill--unlocked' : 'status-pill'}>
            {idea.isUnlocked ? <CheckCircle2 size={14} /> : <LockKeyhole size={13} />}
            {idea.isUnlocked ? 'Full workspace' : 'Free preview'}
          </span>
        </div>

        <h3>{idea.title}</h3>

        <span className="normal-muted-row normal-work-card__date">
          <CalendarDays size={15} />
          Created {formattedDate}
        </span>

        {!idea.isUnlocked ? (
          <div className="normal-direct-unlock-hint">
            <span className="normal-direct-unlock-hint__icon"><WandSparkles size={19} /></span>
            <div>
              <b>Turn this preview into a complete build workspace</b>
              <small>Review the idea first, then use a secure one-time Direct Unlock only when it is worth developing.</small>
            </div>
          </div>
        ) : (
          <div className="normal-direct-unlock-hint normal-direct-unlock-hint--unlocked">
            <span className="normal-direct-unlock-hint__icon"><CheckCircle2 size={19} /></span>
            <div><b>Your advanced workspace is ready</b><small>All unlocked outputs remain available for this idea.</small></div>
          </div>
        )}

        <div className="normal-work-card__footer">
          <span className="normal-work-card__availability">
            {!idea.isUnlocked ? <LockKeyhole size={15} /> : <CheckCircle2 size={15} />}
            {!idea.isUnlocked ? 'Advanced outputs available inside' : 'Advanced outputs unlocked'}
          </span>

          <motion.button
            type="button"
            className="normal-work-card__open"
            onMouseEnter={() => warmIdeaWorkspace(idea.id)}
            onFocus={() => warmIdeaWorkspace(idea.id)}
            onPointerDown={() => warmIdeaWorkspace(idea.id)}
            onClick={() =>
              navigate(`/normal/ideas/${idea.id}`, {
                state: {
                  returnTo: '/normal/dashboard',
                  returnLabel: 'Home',
                  ideaSeed: idea,
                },
              })
            }
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.98 }}
          >
            Open workspace <ArrowUpRight size={17} />
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}

function IdeaVisual() {
  return (
    <div className="normal-work-card__visual" aria-hidden="true">
      <span className="normal-work-card__visual-grid" />
      <span className="normal-work-card__visual-glow normal-work-card__visual-glow--one" />
      <span className="normal-work-card__visual-glow normal-work-card__visual-glow--two" />

      <motion.span
        className="normal-work-card__visual-orbit normal-work-card__visual-orbit--outer"
        animate={{ rotate: 360 }}
        transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
      />
      <motion.span
        className="normal-work-card__visual-orbit normal-work-card__visual-orbit--middle"
        animate={{ rotate: -360 }}
        transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
      />
      <motion.span
        className="normal-work-card__visual-orbit normal-work-card__visual-orbit--inner"
        animate={{ rotate: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
      />

      <motion.span
        className="normal-work-card__visual-pulse"
        animate={{ scale: [0.82, 1.22, 0.82], opacity: [0.28, 0.78, 0.28] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.span
        className="normal-work-card__icon"
        animate={{ y: [-5, 5, -5], rotate: [-3, 3, -3], scale: [1, 1.04, 1] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Sparkles size={27} />
      </motion.span>
    </div>
  );
}