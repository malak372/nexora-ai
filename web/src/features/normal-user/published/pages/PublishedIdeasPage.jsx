/**
 * Premium creator publishing desk.
 *
 * Displays live publications, provides search and pagination, and opens a
 * private audience-insights ledger for each publication.
 *
 * @author Malak
 */

import {
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
  stopPublication,
} from '../api/publishedIdeasApi';
import PublishedIdeaCard from '../components/PublishedIdeaCard';
import PublicationInsightsPanel from '../components/PublicationInsightsPanel';
import '../styles/published.css';

const PAGE_SIZE = 8;

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
  const [page, setPage] = useState(1);
  const [
    selectedPublication,
    setSelectedPublication,
  ] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stoppingId, setStoppingId] = useState('');

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
      ...(search ? { search } : {}),
    }),
    [page, search],
  );

  const loadPublished = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result =
        await getMyPublishedIdeas(params);

      setItems(result.items);
      setPagination(result.pagination);
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Published ideas could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void loadPublished();
  }, [loadPublished]);

  const handleStop = async (publication) => {
    const confirmed = window.confirm(
      `Stop publishing “${
        publication.publicTitle ||
        'this publication'
      }”? It will disappear from Discover but remain archived in the backend.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setStoppingId(publication.id);
      setError('');

      await stopPublication(
        publication.ideaId,
      );

      setItems((current) =>
        current.filter(
          (item) =>
            item.id !== publication.id,
        ),
      );

      setPagination((current) => ({
        ...current,
        total: Math.max(
          0,
          Number(current.total ?? 0) - 1,
        ),
      }));

      setSelectedPublication((current) =>
        current?.id === publication.id
          ? null
          : current,
      );
    } catch (requestError) {
      setError(
        requestError?.message ||
          'The publication could not be stopped.',
      );
    } finally {
      setStoppingId('');
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
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="published-page__orb published-page__orb--one" />
        <div className="published-page__orb published-page__orb--two" />
        <div className="published-page__grid" />

        <div>
          <span>
            <Send size={15} />
            Creator publishing desk
          </span>

          <h1>
            Published ideas,
            <em>community signals.</em>
          </h1>

          <p>
            Manage every live publication and understand how the community
            responds through ratings, votes, and written feedback.
          </p>

          <div className="published-page__chips">
            <span>
              <TrendingUp size={14} />
              Live performance
            </span>

            <span>
              <Sparkles size={14} />
              Owner-only insights
            </span>
          </div>
        </div>

        <div className="published-page__stat">
          <span>
            <BarChart3 size={20} />
          </span>

          <div>
            <small>Currently live</small>
            <strong>
              {pagination.total ?? 0}
            </strong>
            <em>publications</em>
          </div>
        </div>
      </motion.header>

      <motion.form
        className="published-search"
        initial={
          shouldReduceMotion
            ? undefined
            : {
                opacity: 0,
                y: 18,
              }
        }
        whileInView={{
          opacity: 1,
          y: 0,
        }}
        viewport={{
          once: true,
          amount: 0.25,
        }}
        transition={{
          duration: 0.48,
        }}
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <Search size={18} />

        <input
          value={searchInput}
          onChange={(event) =>
            setSearchInput(event.target.value)
          }
          placeholder="Search your published ideas..."
        />

        <button type="submit">
          Search
        </button>
      </motion.form>

      {loading ? (
        <div className="published-grid">
          {Array.from({ length: 4 }).map(
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
          <RefreshCw size={28} />
          <h2>Published ideas unavailable</h2>
          <p>{error}</p>

          <button
            type="button"
            onClick={loadPublished}
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="published-state">
          <Send size={30} />
          <h2>No published ideas yet</h2>

          <p>
            Publish one of your completed ideas to start receiving
            ratings, votes, and feedback.
          </p>

          <button
            type="button"
            onClick={() =>
              navigate('/normal/ideas')
            }
          >
            Open My Ideas
          </button>
        </div>
      ) : (
        <div className="published-grid">
          {items.map(
            (publication, index) => (
              <PublishedIdeaCard
                key={publication.id}
                publication={publication}
                index={index}
                onEdit={() =>
                  publication.ideaId &&
                  navigate(
                    `/normal/ideas/${publication.ideaId}/publish`,
                  )
                }
                onInsights={() =>
                  setSelectedPublication(
                    publication,
                  )
                }
                onStop={() =>
                  handleStop(publication)
                }
                stopping={
                  stoppingId === publication.id
                }
              />
            ),
          )}
        </div>
      )}

      {!loading &&
      !error &&
      pagination.totalPages > 1 ? (
        <nav className="published-pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() =>
              setPage(
                (current) => current - 1,
              )
            }
          >
            <ArrowLeft size={17} />
            Previous
          </button>

          <span>
            Page <strong>{page}</strong> of{' '}
            {pagination.totalPages}
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
            Next
            <ArrowRight size={17} />
          </button>
        </nav>
      ) : null}

      <AnimatePresence>
        {selectedPublication ? (
          <PublicationInsightsPanel
            publication={selectedPublication}
            onClose={() =>
              setSelectedPublication(null)
            }
          />
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}