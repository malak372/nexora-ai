/**
 * Premium publication insights panel.
 *
 * Displays a publication owner's audience ledger with one combined response
 * per member, including rating, vote, written feedback, and last activity.
 *
 * @author Malak
 */

import {
  ArrowLeft,
  ArrowRight,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';

import { getReceivedFeedback } from '../api/publishedIdeasApi';

const PAGE_SIZE = 8;

function initials(name = 'Nexora user') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function voteLabel(value) {
  if (value === 'UP') {
    return 'Upvoted';
  }

  if (value === 'DOWN') {
    return 'Downvoted';
  }

  return 'No vote';
}

export default function PublicationInsightsPanel({
  publication,
  onClose,
}) {
  const shouldReduceMotion = useReducedMotion();

  const [summary, setSummary] = useState(publication);
  const [responses, setResponses] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadResponses = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await getReceivedFeedback(
        publication.id,
        {
          page,
          limit: PAGE_SIZE,
        },
      );

      setSummary((current) => ({
        ...current,
        ...(result.publication ?? {}),
      }));

      setResponses(result.responses ?? []);
      setPagination(result.pagination);
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Audience responses could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [page, publication.id]);

  useEffect(() => {
    void loadResponses();
  }, [loadResponses]);

  return (
    <motion.div
      className="insights-backdrop"
      role="presentation"
      onMouseDown={onClose}
      initial={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 0,
            }
      }
      animate={{
        opacity: 1,
      }}
      exit={{
        opacity: 0,
      }}
    >
      <motion.aside
        className="insights-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Publication audience insights"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
        initial={
          shouldReduceMotion
            ? undefined
            : {
                opacity: 0,
                x: 44,
              }
        }
        animate={{
          opacity: 1,
          x: 0,
        }}
        exit={{
          opacity: 0,
          x: 44,
        }}
        transition={{
          duration: 0.28,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="insights-panel__orb insights-panel__orb--one" />
        <div className="insights-panel__orb insights-panel__orb--two" />

        <header className="insights-panel__header">
          <div>
            <span>
              <Sparkles size={14} />
              Audience response ledger
            </span>

            <h2>
              {publication?.publicTitle ||
                'Publication insights'}
            </h2>

            <p>
              Every person appears once with their rating, vote,
              feedback, and latest interaction.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close insights"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <section className="insights-summary">
          {[
            {
              icon: Star,
              value: Number(
                summary?.averageRating ?? 0,
              ).toFixed(1),
              label: `${summary?.ratingsCount ?? 0} ratings`,
              tone: 'rating',
            },
            {
              icon: ThumbsUp,
              value: summary?.upvotesCount ?? 0,
              label: 'upvotes',
              tone: 'up',
            },
            {
              icon: ThumbsDown,
              value: summary?.downvotesCount ?? 0,
              label: 'downvotes',
              tone: 'down',
            },
            {
              icon: MessageSquareText,
              value: summary?.feedbackCount ?? 0,
              label: 'written reviews',
              tone: 'feedback',
            },
          ].map((metric) => {
            const Icon = metric.icon;

            return (
              <motion.article
                key={metric.label}
                className={`insights-summary__${metric.tone}`}
                whileHover={
                  shouldReduceMotion
                    ? undefined
                    : {
                        y: -4,
                      }
                }
              >
                <span>
                  <Icon size={18} />
                </span>

                <div>
                  <strong>{metric.value}</strong>
                  <small>{metric.label}</small>
                </div>
              </motion.article>
            );
          })}
        </section>

        <div className="insights-panel__section-title">
          <div>
            <span>
              <UserRound size={17} />
            </span>

            <div>
              <h3>Individual community signals</h3>
              <p>
                Visible only to the publication owner.
              </p>
            </div>
          </div>

          <small>
            {pagination.total ?? 0} people
          </small>
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              className="insights-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {Array.from({ length: 3 }).map(
                (_, index) => (
                  <div key={index} />
                ),
              )}
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              className="insights-empty insights-empty--error"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <RefreshCw size={25} />
              <h3>Audience responses unavailable</h3>
              <p>{error}</p>
              <button
                type="button"
                onClick={loadResponses}
              >
                Try again
              </button>
            </motion.div>
          ) : responses.length === 0 ? (
            <motion.div
              key="empty"
              className="insights-empty"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <MessageSquareText size={28} />
              <h3>No audience activity yet</h3>
              <p>
                Ratings, votes, and written feedback will
                appear here per person.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={`responses-${page}`}
              className="audience-response-list"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {responses.map((item, index) => (
                <motion.article
                  key={item.user.id}
                  className="audience-response-item"
                  initial={
                    shouldReduceMotion
                      ? undefined
                      : {
                          opacity: 0,
                          y: 16,
                        }
                  }
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.35,
                    delay: shouldReduceMotion
                      ? 0
                      : index * 0.045,
                  }}
                >
                  <span className="feedback-item__avatar">
                    {initials(item.user.fullName)}
                  </span>

                  <div className="audience-response-item__body">
                    <header>
                      <div>
                        <strong>
                          {item.user.fullName ||
                            'Nexora user'}
                        </strong>

                        <small>
                          {item.user.userType ||
                            'MEMBER'}
                        </small>
                      </div>

                      <time>
                        {formatDate(item.lastActivityAt)}
                      </time>
                    </header>

                    <div className="audience-response-item__signals">
                      <span
                        className={
                          item.rating
                            ? 'has-value'
                            : ''
                        }
                      >
                        <Star size={15} />
                        {item.rating
                          ? `${item.rating}/5`
                          : 'No rating'}
                      </span>

                      <span
                        className={
                          item.vote === 'UP'
                            ? 'is-up'
                            : item.vote === 'DOWN'
                              ? 'is-down'
                              : ''
                        }
                      >
                        {item.vote === 'DOWN' ? (
                          <ThumbsDown size={15} />
                        ) : (
                          <ThumbsUp size={15} />
                        )}

                        {voteLabel(item.vote)}
                      </span>
                    </div>

                    {item.feedback?.comment ? (
                      <blockquote>
                        {item.feedback.comment}
                      </blockquote>
                    ) : (
                      <p className="audience-response-item__empty">
                        No written feedback from this person.
                      </p>
                    )}
                  </div>
                </motion.article>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {!loading &&
        !error &&
        pagination.totalPages > 1 ? (
          <nav className="insights-pagination">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() =>
                setPage(
                  (current) => current - 1,
                )
              }
            >
              <ArrowLeft size={16} />
            </button>

            <span>
              {page} / {pagination.totalPages}
            </span>

            <button
              type="button"
              disabled={
                page >= pagination.totalPages
              }
              onClick={() =>
                setPage(
                  (current) => current + 1,
                )
              }
            >
              <ArrowRight size={16} />
            </button>
          </nav>
        ) : null}
      </motion.aside>
    </motion.div>
  );
}