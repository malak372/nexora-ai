/**
 * Publication-owner card.
 *
 * Live and archived records share the same engagement history. Archived cards
 * remain visible to their owner and expose a re-publish action instead of a
 * consumer-facing open action.
 *
 * @author Malak
 */
import {
  Archive,
  BarChart3,
  CalendarDays,
  Eye,
  MessageSquareText,
  PauseCircle,
  PencilLine,
  RefreshCw,
  Star,
  ThumbsDown,
  ThumbsUp,
  UsersRound,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

function formatDate(value, fallback) {
  if (!value) return fallback;

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export default function PublishedIdeaCard({
  publication,
  onEdit,
  onWarmEdit,
  onInsights,
  onStop,
  onRepost,
  processing = false,
  index = 0,
}) {
  const shouldReduceMotion = useReducedMotion();
  const isArchived = publication?.status === 'ARCHIVED';

  return (
    <motion.article
      className={`published-card published-card--${(index % 4) + 1} ${isArchived ? 'published-card--archived' : ''
        }`}
      initial={
        shouldReduceMotion
          ? undefined
          : { opacity: 0, y: 24, scale: 0.985 }
      }
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.14 }}
      transition={{
        duration: 0.5,
        delay: shouldReduceMotion ? 0 : (index % 2) * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={
        shouldReduceMotion
          ? undefined
          : { y: -8, scale: 1.008 }
      }
    >
      <div className="published-card__visual" aria-hidden="true">
        <span className="published-card__mesh" />
        <span className="published-card__beam" />
        <span className="published-card__pulse" />
        <span className="published-card__signal" />

        {isArchived ? <Archive size={28} /> : <BarChart3 size={28} />}

        <small>{isArchived ? 'Stopped publication' : 'Live signal'}</small>
      </div>

      <div className="published-card__body">
        <div className="published-card__topline">
          <span>
            <Eye size={13} />
            {publication?.visibility || 'PUBLIC'}
          </span>

          <small>
            <CalendarDays size={13} />
            {isArchived
              ? formatDate(publication?.archivedAt, 'Stopped recently')
              : formatDate(publication?.publishedAt, 'Published recently')}
          </small>
        </div>

        <div className={`published-card__status ${isArchived ? 'is-archived' : 'is-live'
          }`}>
          {isArchived ? <Archive size={13} /> : <BarChart3 size={13} />}
          {isArchived ? 'Stopped' : 'Published'}
        </div>

        <h2>{publication?.publicTitle || 'Untitled publication'}</h2>

        <p>
          {publication?.publicAbstract ||
            publication?.publicProblem ||
            'Published idea snapshot.'}
        </p>

        <div className="published-card__metrics">
          <span className="is-rating">
            <Star size={15} />
            {Number(publication?.averageRating ?? 0).toFixed(1)}
            <small>{publication?.ratingsCount ?? 0}</small>
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

          <span className="is-accepted">
            <UsersRound size={15} />
            {publication?.acceptanceCount ?? publication?.acceptedCount ?? 0}
            <small>accepted</small>
          </span>

        </div>

        <div className="published-card__actions">
          <motion.button
            type="button"
            onClick={onInsights}
            whileHover={shouldReduceMotion ? undefined : { y: -2 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
          >
            Audience ledger
            <BarChart3 size={16} />
          </motion.button>


          {!isArchived ? (
            <motion.button
              type="button"
              className="is-quiet"
              onMouseEnter={onWarmEdit}
              onFocus={onWarmEdit}
              onPointerDown={onWarmEdit}
              onClick={onEdit}
              whileHover={shouldReduceMotion ? undefined : { y: -2 }}
            >
              Edit publication
              <PencilLine size={16} />
            </motion.button>
          ) : null}

          {isArchived ? (
            <motion.button
              type="button"
              className="is-repost"
              onClick={onRepost}
              disabled={processing}
              whileHover={
                shouldReduceMotion || processing ? undefined : { y: -2 }
              }
            >
              {processing ? 'Re-publishing…' : 'Re-publish'}
              <RefreshCw size={16} />
            </motion.button>
          ) : (
            <motion.button
              type="button"
              className="is-danger-soft"
              onClick={onStop}
              disabled={processing}
              whileHover={
                shouldReduceMotion || processing ? undefined : { y: -2 }
              }
            >
              {processing ? 'Stopping…' : 'Stop publishing'}
              <PauseCircle size={16} />
            </motion.button>
          )}
        </div>
      </div>
    </motion.article>
  );
}