/**
 * Premium publication-owner card.
 *
 * The owner's Published page intentionally does not expose an Open action.
 * Opening the community discovery route can trigger consumer-only acceptance
 * actions, which must never be offered to the publication owner.
 *
 * @author Malak
 */

import {
  BarChart3,
  CalendarDays,
  Eye,
  MessageSquareText,
  PauseCircle,
  PencilLine,
  Star,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';

function formatDate(value) {
  if (!value) {
    return 'Published recently';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export default function PublishedIdeaCard({
  publication,
  onEdit,
  onInsights,
  onStop,
  stopping = false,
  index = 0,
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.article
      className={`published-card published-card--${
        (index % 4) + 1
      }`}
      initial={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 0,
              y: 24,
              scale: 0.985,
            }
      }
      whileInView={{
        opacity: 1,
        y: 0,
        scale: 1,
      }}
      viewport={{
        once: true,
        amount: 0.14,
      }}
      transition={{
        duration: 0.5,
        delay: shouldReduceMotion
          ? 0
          : (index % 2) * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={
        shouldReduceMotion
          ? undefined
          : {
              y: -8,
              scale: 1.006,
            }
      }
    >
      <div
        className="published-card__visual"
        aria-hidden="true"
      >
        <span className="published-card__mesh" />
        <span className="published-card__beam" />
        <span className="published-card__pulse" />
        <span className="published-card__signal" />
        <BarChart3 size={28} />

        <small>Live signal</small>
      </div>

      <div className="published-card__body">
        <div className="published-card__topline">
          <span>
            <Eye size={13} />
            {publication?.visibility || 'PUBLIC'}
          </span>

          <small>
            <CalendarDays size={13} />
            {formatDate(
              publication?.publishedAt,
            )}
          </small>
        </div>

        <h2>
          {publication?.publicTitle ||
            'Untitled publication'}
        </h2>

        <p>
          {publication?.publicAbstract ||
            publication?.publicProblem ||
            'Published idea snapshot.'}
        </p>

        <div className="published-card__metrics">
          <span className="is-rating">
            <Star size={15} />
            {Number(
              publication?.averageRating ?? 0,
            ).toFixed(1)}
            <small>
              {publication?.ratingsCount ?? 0}
            </small>
          </span>

          <span className="is-up">
            <ThumbsUp size={15} />
            {publication?.upvotesCount ?? 0}
          </span>

          <span className="is-down">
            <ThumbsDown size={15} />
            {publication?.downvotesCount ?? 0}
          </span>

          <span className="is-feedback">
            <MessageSquareText size={15} />
            {publication?.feedbackCount ?? 0}
          </span>
        </div>

        <div className="published-card__actions">
          <motion.button
            type="button"
            onClick={onInsights}
            whileHover={
              shouldReduceMotion
                ? undefined
                : {
                    y: -2,
                  }
            }
            whileTap={
              shouldReduceMotion
                ? undefined
                : {
                    scale: 0.98,
                  }
            }
          >
            Audience ledger
            <BarChart3 size={16} />
          </motion.button>

          <motion.button
            type="button"
            className="is-quiet"
            onClick={onEdit}
            whileHover={
              shouldReduceMotion
                ? undefined
                : {
                    y: -2,
                  }
            }
          >
            Edit publication
            <PencilLine size={16} />
          </motion.button>

          <motion.button
            type="button"
            className="is-danger-soft"
            onClick={onStop}
            disabled={stopping}
            whileHover={
              shouldReduceMotion || stopping
                ? undefined
                : {
                    y: -2,
                  }
            }
          >
            {stopping
              ? 'Stopping…'
              : 'Stop publishing'}
            <PauseCircle size={16} />
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}