/**
 * Voxidence normal-user creator publishing desk.
 *
 * Displays both live and archived publications. Owners keep access to audience
 * insights after stopping publication, can filter by lifecycle state, and can
 * re-publish an archived item without losing engagement history.
 *
 * @author Malak
 */

import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useNavigate } from 'react-router-dom';

import {
  getMyPublishedIdeas,
  repostPublication,
  stopPublication,
  updatePublicationAcceptanceSetting,
} from '../api/publishedIdeasApi';

import PublishedIdeaCard from '../components/PublishedIdeaCard';
import PublicationInsightsPanel from '../components/PublicationInsightsPanel';
import { preloadPublicationStudio } from '../../../../routes/routePreloaders';

import '../styles/published.css';

const PAGE_SIZE = 8;

const FILTERS = [
  {
    value: 'ALL',
    label: 'All publications',
  },
  {
    value: 'PUBLISHED',
    label: 'Still published',
  },
  {
    value: 'ARCHIVED',
    label: 'Stopped',
  },
];

export default function PublishedIdeasPage() {
  const navigate = useNavigate();

  const shouldReduceMotion = useReducedMotion();

  const [items, setItems] = useState([]);

  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 1,
  });

  const [searchInput, setSearchInput] = useState('');

  const [search, setSearch] = useState('');

  const [statusFilter, setStatusFilter] = useState('ALL');

  const [page, setPage] = useState(1);

  const [
    selectedPublication,
    setSelectedPublication,
  ] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');

  const [processingId, setProcessingId] = useState('');

  const params = useMemo(
    () => ({
      page,

      limit: PAGE_SIZE,

      sortBy: 'publishedAt',

      sortOrder: 'desc',

      ...(search
        ? {
          search,
        }
        : {}),

      ...(statusFilter !== 'ALL'
        ? {
          status: statusFilter,
        }
        : {}),
    }),

    [
      page,
      search,
      statusFilter,
    ],
  );

  const loadPublished = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);

      setError('');

      try {
        const result =
          await getMyPublishedIdeas(
            params,
            {
              forceRefresh,
            },
          );

        setItems(result.items);

        setPagination(
          result.pagination ?? {
            page,
            total: 0,
            totalPages: 1,
          },
        );
      } catch (requestError) {
        setError(
          requestError?.message ||
          'Your publications could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    },

    [
      params,
      page,
    ],
  );

  useEffect(() => {
    /*
     * Use the short-lived publication cache during normal navigation/filtering.
     * Writes already invalidate this namespace, so forcing every request only
     * made pagination and filters wait on the network unnecessarily.
     */
    void loadPublished(false);
  }, [loadPublished]);

  const updatePublicationStatus = (
    publicationId,
    nextStatus,
  ) => {
    setItems((current) =>
      current.map((item) =>
        item.id === publicationId
          ? {
            ...item,

            status: nextStatus,

            archivedAt:
              nextStatus === 'ARCHIVED'
                ? new Date().toISOString()
                : null,

            publishedAt:
              nextStatus === 'PUBLISHED'
                ? new Date().toISOString()
                : item.publishedAt,
          }
          : item,
      ),
    );

    setSelectedPublication((current) =>
      current?.id === publicationId
        ? {
          ...current,
          status: nextStatus,
        }
        : current,
    );
  };

  const handleStop = async (
    publication,
  ) => {
    const confirmed =
      window.confirm(
        `Stop publishing “${publication.publicTitle ||
        'this publication'
        }”? It will leave Discover, while accepted users and your owner ledger keep access.`,
      );

    if (!confirmed) {
      return;
    }

    try {
      setProcessingId(
        publication.id,
      );

      setError('');

      await stopPublication(
        publication.ideaId,
      );

      if (
        statusFilter ===
        'PUBLISHED'
      ) {
        setItems((current) =>
          current.filter(
            (item) =>
              item.id !==
              publication.id,
          ),
        );

        setPagination(
          (current) => ({
            ...current,

            total: Math.max(
              0,
              (current?.total ?? 0) -
              1,
            ),
          }),
        );
      } else {
        updatePublicationStatus(
          publication.id,
          'ARCHIVED',
        );
      }
    } catch (requestError) {
      setError(
        requestError?.message ||
        'The publication could not be stopped.',
      );
    } finally {
      setProcessingId('');
    }
  };

  const handleToggleAcceptance =
    async (publication) => {
      const nextValue =
        publication.allowAdoption ===
        false;

      const confirmed =
        window.confirm(
          `${nextValue
            ? 'Enable'
            : 'Disable'
          } new acceptances for “${publication.publicTitle ||
          'this publication'
          }”? Existing accepted users will keep their access.`,
        );

      if (!confirmed) {
        return;
      }

      try {
        setProcessingId(
          publication.id,
        );

        setError('');

        await updatePublicationAcceptanceSetting(
          publication.ideaId,
          nextValue,
        );

        setItems((current) =>
          current.map((item) =>
            item.id ===
              publication.id
              ? {
                ...item,

                allowAdoption:
                  nextValue,
              }
              : item,
          ),
        );

        setSelectedPublication(
          (current) =>
            current?.id ===
              publication.id
              ? {
                ...current,

                allowAdoption:
                  nextValue,
              }
              : current,
        );
      } catch (requestError) {
        setError(
          requestError?.message ||
          'The acceptance setting could not be updated.',
        );
      } finally {
        setProcessingId('');
      }
    };

  const handleRepost = async (
    publication,
  ) => {
    const confirmed =
      window.confirm(
        `Re-publish “${publication.publicTitle ||
        'this publication'
        }”? It will become discoverable again with the same comments, ratings, votes, and acceptances.`,
      );

    if (!confirmed) {
      return;
    }

    try {
      setProcessingId(
        publication.id,
      );

      setError('');

      await repostPublication(
        publication.ideaId,
      );

      if (
        statusFilter ===
        'ARCHIVED'
      ) {
        setItems((current) =>
          current.filter(
            (item) =>
              item.id !==
              publication.id,
          ),
        );

        setPagination(
          (current) => ({
            ...current,

            total: Math.max(
              0,
              (current?.total ?? 0) -
              1,
            ),
          }),
        );
      } else {
        updatePublicationStatus(
          publication.id,
          'PUBLISHED',
        );
      }
    } catch (requestError) {
      setError(
        requestError?.message ||
        'The publication could not be re-published.',
      );
    } finally {
      setProcessingId('');
    }
  };

  return (
    <motion.section
      className="published-page reveal-page"
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
      transition={{
        duration: 0.35,
      }}
    >
      <motion.header
        className="published-page__header"
        initial={
          shouldReduceMotion
            ? undefined
            : {
              opacity: 0,
              y: 24,
              scale: 0.985,
            }
        }
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.66,
          ease: [
            0.22,
            1,
            0.36,
            1,
          ],
        }}
      >
        <div className="published-page__orb published-page__orb--one" />

        <div className="published-page__orb published-page__orb--two" />

        <div className="published-page__grid" />

        <div>
          <span className="published-page__eyebrow">
            <Send size={15} />
            Creator publishing desk
          </span>

          <h1>
            Publication history,
            <em>
              community signals.
            </em>
          </h1>

          <p>
            Manage live and stopped
            publications without losing
            accepted-user access,
            ratings, votes, comments,
            or owner-only insights.
          </p>

          <div className="published-page__chips">
            <span>
              <TrendingUp
                size={14}
              />

              Persistent engagement
              history
            </span>

            <span>
              <Sparkles
                size={14}
              />

              Re-publish anytime
            </span>
          </div>
        </div>

        <div className="published-page__stat">
          <span>
            {statusFilter ===
              'ARCHIVED' ? (
              <Archive
                size={20}
              />
            ) : (
              <BarChart3
                size={20}
              />
            )}
          </span>

          <div>
            <small>
              {statusFilter ===
                'ALL'
                ? 'Matching publications'
                : statusFilter ===
                  'PUBLISHED'
                  ? 'Currently live'
                  : 'Stopped publications'}
            </small>

            {/* FIX:
                publishedTotal did not exist.
                The total returned by the API is
                already stored in pagination.total.
            */}
            <strong>
              {pagination?.total ?? 0}
            </strong>

            <em>
              publications
            </em>
          </div>
        </div>
      </motion.header>

      <section className="published-toolbar">
        <form
          className="published-search"
          onSubmit={(event) => {
            event.preventDefault();

            setPage(1);

            setSearch(
              searchInput.trim(),
            );
          }}
        >
          <Search size={18} />

          <input
            value={searchInput}
            onChange={(event) =>
              setSearchInput(
                event.target.value,
              )
            }
            placeholder="Search your publication history..."
          />

          <button type="submit">
            Search
          </button>
        </form>

        <div
          className="published-status-filter"
          aria-label="Publication status filter"
        >
          {FILTERS.map(
            (filter) => (
              <button
                type="button"
                key={
                  filter.value
                }
                className={
                  statusFilter ===
                    filter.value
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  setStatusFilter(
                    filter.value,
                  );

                  setPage(1);
                }}
              >
                {
                  filter.label
                }
              </button>
            ),
          )}
        </div>
      </section>

      {loading ? (
        <div className="published-grid">
          {Array.from({
            length: 4,
          }).map(
            (_, index) => (
              <div
                key={index}
                className="published-skeleton"
              />
            ),
          )}
        </div>
      ) : error ? (
        <div className="published-state published-state--error">
          <RefreshCw
            size={28}
          />

          <h2>
            Publication history
            unavailable
          </h2>

          <p>
            {error}
          </p>

          <button
            type="button"
            onClick={() =>
              loadPublished(true)
            }
          >
            Try again
          </button>
        </div>
      ) : items.length ===
        0 ? (
        <div className="published-state">
          {statusFilter ===
            'ARCHIVED' ? (
            <Archive
              size={30}
            />
          ) : (
            <Send
              size={30}
            />
          )}

          <h2>
            {statusFilter ===
              'ARCHIVED'
              ? 'No stopped publications'
              : statusFilter ===
                'PUBLISHED'
                ? 'No live publications'
                : 'No publications yet'}
          </h2>

          <p>
            {statusFilter ===
              'ARCHIVED'
              ? 'Stopped publications will remain here with their full engagement history.'
              : 'Publish one of your completed ideas to start receiving community activity.'}
          </p>

          <button
            type="button"
            onClick={() =>
              navigate(
                '/normal/ideas',
              )
            }
          >
            Open My Ideas
          </button>
        </div>
      ) : (
        <div className="published-grid">
          {items.map(
            (
              publication,
              index,
            ) => (
              <PublishedIdeaCard
                key={
                  publication.id
                }
                publication={
                  publication
                }
                index={index}
                onWarmEdit={() =>
                  publication.ideaId &&
                  preloadPublicationStudio(publication.ideaId)
                }
                onEdit={() =>
                  publication.ideaId &&
                  navigate(
                    `/normal/ideas/${publication.ideaId}/publish`,
                    {
                      state: {
                        returnTo: '/normal/published',
                        returnLabel: 'Published',
                        publicationOrigin: 'published',
                        publicationSeed: publication,
                      },
                    },
                  )
                }
                onInsights={() =>
                  setSelectedPublication(
                    publication,
                  )
                }
                onStop={() =>
                  handleStop(
                    publication,
                  )
                }
                onRepost={() =>
                  handleRepost(
                    publication,
                  )
                }
                onToggleAcceptance={() =>
                  handleToggleAcceptance(
                    publication,
                  )
                }
                processing={
                  processingId ===
                  publication.id
                }
              />
            ),
          )}
        </div>
      )}

      {!loading &&
        !error &&
        pagination.totalPages >
        1 ? (
        <nav className="published-pagination">
          <button
            type="button"
            disabled={
              page <= 1
            }
            onClick={() =>
              setPage(
                (current) =>
                  current - 1,
              )
            }
          >
            <ArrowLeft
              size={17}
            />

            Previous
          </button>

          <span>
            Page{' '}
            <strong>
              {page}
            </strong>{' '}
            of{' '}
            {
              pagination.totalPages
            }
          </span>

          <button
            type="button"
            disabled={
              page >=
              pagination.totalPages
            }
            onClick={() =>
              setPage(
                (current) =>
                  current + 1,
              )
            }
          >
            Next

            <ArrowRight
              size={17}
            />
          </button>
        </nav>
      ) : null}

      <AnimatePresence>
        {selectedPublication ? (
          <PublicationInsightsPanel
            publication={
              selectedPublication
            }
            onClose={() =>
              setSelectedPublication(
                null,
              )
            }
          />
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}