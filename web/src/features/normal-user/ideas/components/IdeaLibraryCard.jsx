/**
 * Reusable premium card for owned and accepted ideas.
 *
 * Accepted cards keep the same dimensions as standard cards while receiving
 * semantic accents, richer motion, and contextual actions.
 *
 * @author Malak
 */

import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Globe2,
  LockKeyhole,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

const ACTIVE_RUN_STATUSES = new Set([
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'PAUSED',
]);

function formatDate(value) {
  if (!value) {
    return 'Recently created';
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Recently created';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsedDate);
}

function resolveStatus(idea) {
  const runStatus = String(
    idea?.generationRun?.status ?? '',
  ).toUpperCase();

  if (ACTIVE_RUN_STATUSES.has(runStatus)) {
    return {
      label: runStatus === 'PAUSED' ? 'Paused' : 'Generating',
      tone: 'processing',
      icon: Clock3,
    };
  }

  if (
    idea?.__libraryKind === 'accepted' ||
    idea?.acceptedAt ||
    idea?.acceptance
  ) {
    return {
      label: 'Accepted',
      tone: 'accepted',
      icon: CheckCircle2,
    };
  }

  if (
    String(
      idea?.publication?.status ?? '',
    ).toUpperCase() === 'PUBLISHED'
  ) {
    return {
      label: 'Published',
      tone: 'published',
      icon: Globe2,
    };
  }

  if (idea?.isUnlocked) {
    return {
      label: 'Unlocked',
      tone: 'unlocked',
      icon: CheckCircle2,
    };
  }

  return {
    label: 'Free idea',
    tone: 'core',
    icon: LockKeyhole,
  };
}

export default function IdeaLibraryCard({
  idea,
  onOpen,
  onDelete,
}) {
  const shouldReduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);

  const status = resolveStatus(idea);
  const StatusIcon = status.icon;
  const isAccepted = status.tone === 'accepted';

  const progress = Math.max(
    0,
    Math.min(
      100,
      Number(
        idea?.generationRun?.progressPercent ?? 0,
      ),
    ),
  );

  const abstract =
    idea?.limitedAbstract ||
    idea?.partialAbstract ||
    idea?.problemStatement ||
    'Open the workspace to review the generated concept and its direction.';

  const cardDate = isAccepted
    ? idea?.acceptedAt ?? idea?.createdAt
    : idea?.createdAt;

  const primaryActionLabel = isAccepted
    ? 'View accepted brief'
    : status.tone === 'processing'
      ? 'Track progress'
      : 'Open idea';

  return (
    <motion.article
      className={`idea-tile idea-tile--${status.tone}`}
      initial={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 0,
              y: 24,
              scale: 0.985,
            }
      }
      whileInView={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 1,
              y: 0,
              scale: 1,
            }
      }
      viewport={{
        once: true,
        amount: 0.18,
      }}
      transition={{
        duration: 0.52,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={
        shouldReduceMotion
          ? undefined
          : {
              y: -8,
              scale: 1.008,
            }
      }
      onMouseLeave={() => setMenuOpen(false)}
    >
      <div
        className="idea-tile__accent"
        aria-hidden="true"
      />

      <div
        className="idea-tile__shine"
        aria-hidden="true"
      />

      <div
        className="idea-tile__ambient"
        aria-hidden="true"
      />

      {isAccepted ? (
        <div
          className="idea-tile__accepted-glow"
          aria-hidden="true"
        />
      ) : null}

      <header className="idea-tile__topbar">
        <span
          className={`idea-tile__status idea-tile__status--${status.tone}`}
        >
          <StatusIcon size={13} />
          {status.label}
        </span>

        <div className="idea-tile__menu">
          <motion.button
            type="button"
            aria-label="Idea actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() =>
              setMenuOpen((current) => !current)
            }
            whileHover={
              shouldReduceMotion
                ? undefined
                : {
                    rotate: 7,
                    scale: 1.05,
                  }
            }
            whileTap={
              shouldReduceMotion
                ? undefined
                : {
                    scale: 0.94,
                  }
            }
          >
            <MoreHorizontal size={18} />
          </motion.button>

          <AnimatePresence>
            {menuOpen ? (
              <motion.div
                className="idea-tile__popover"
                role="menu"
                initial={
                  shouldReduceMotion
                    ? undefined
                    : {
                        opacity: 0,
                        y: -8,
                        scale: 0.96,
                      }
                }
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                }}
                exit={
                  shouldReduceMotion
                    ? undefined
                    : {
                        opacity: 0,
                        y: -6,
                        scale: 0.97,
                      }
                }
                transition={{
                  duration: 0.18,
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpen?.();
                  }}
                >
                  <ArrowUpRight size={15} />
                  {isAccepted
                    ? 'View accepted brief'
                    : 'Open workspace'}
                </button>

                {onDelete ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    <Trash2 size={15} />
                    Delete idea
                  </button>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </header>

      <div className="idea-tile__domain">
        <span>
          <Sparkles size={14} />
        </span>

        {idea?.domain?.name ||
          'General innovation'}
      </div>

      <h2>{idea?.title || 'Untitled idea'}</h2>

      <p>{abstract}</p>

      {status.tone === 'processing' ? (
        <div
          className="idea-tile__progress"
          aria-label={`Generation ${progress}% complete`}
        >
          <div>
            <span>Generation progress</span>
            <strong>{progress}%</strong>
          </div>

          <span className="idea-tile__track">
            <motion.i
              initial={
                shouldReduceMotion
                  ? undefined
                  : {
                      width: 0,
                    }
              }
              animate={{
                width: `${progress}%`,
              }}
              transition={{
                duration: 0.8,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          </span>
        </div>
      ) : null}

      {isAccepted ? (
        <div className="idea-tile__accepted-info">
          <span>
            <CheckCircle2 size={15} />
          </span>

          <div>
            <strong>
              {idea?.hasAdvancedAccess
                ? 'Advanced access unlocked'
                : 'Ready for the next step'}
            </strong>

            <small>
              {idea?.hasAdvancedAccess
                ? 'Review the complete accepted opportunity package.'
                : 'Continue when you are ready to unlock or publish.'}
            </small>
          </div>
        </div>
      ) : null}

      <footer>
        <span>
          <CalendarDays size={14} />
          {isAccepted ? 'Accepted ' : ''}
          {formatDate(cardDate)}
        </span>

        <motion.button
          type="button"
          onClick={onOpen}
          whileHover={
            shouldReduceMotion
              ? undefined
              : {
                  x: 3,
                }
          }
          whileTap={
            shouldReduceMotion
              ? undefined
              : {
                  scale: 0.97,
                }
          }
        >
          {primaryActionLabel}
          <ArrowUpRight size={16} />
        </motion.button>
      </footer>
    </motion.article>
  );
}