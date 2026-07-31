import {
  ArrowLeft,
  ArrowRight,
  Grid2X2,
  ListFilter,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { deleteMyIdea, getMyIdeas } from '../api/userIdeasApi';
import IdeaLibraryCard from '../components/IdeaLibraryCard';
import '../styles/ideas.css';

const PAGE_SIZE = 9;
const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'RUNNING', 'RETRYING', 'PAUSED']);

const FILTERS = [
  { value: 'all', label: 'All ideas' },
  { value: 'generating', label: 'Generating' },
  { value: 'unlocked', label: 'Unlocked' },
  { value: 'core', label: 'Core' },
];

export default function MyIdeasPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: PAGE_SIZE,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };

    if (search) params.search = search;
    if (filter === 'unlocked') params.isUnlocked = true;
    if (filter === 'core') params.isUnlocked = false;

    return params;
  }, [filter, page, search]);

  const loadIdeas = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await getMyIdeas(queryParams);
      const visibleItems = filter === 'generating'
        ? result.items.filter((item) =>
            ACTIVE_RUN_STATUSES.has(
              String(item?.generationRun?.status ?? '').toUpperCase(),
            ),
          )
        : result.items;

      setItems(visibleItems);
      setPagination({
        page: result.pagination?.page ?? page,
        limit: result.pagination?.limit ?? PAGE_SIZE,
        total: result.pagination?.total ?? visibleItems.length,
        totalPages: result.pagination?.totalPages ?? 1,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [filter, page, queryParams]);

  useEffect(() => {
    loadIdeas();
  }, [loadIdeas]);

  function openIdea(idea) {
    const runStatus = String(idea?.generationRun?.status ?? '').toUpperCase();

    if (ACTIVE_RUN_STATUSES.has(runStatus) && idea?.generationRun?.id) {
      navigate(`/normal/generation/${idea.generationRun.id}`);
      return;
    }

    navigate(`/normal/ideas/${idea.id}`);
  }

  async function handleDelete(idea) {
    const confirmed = window.confirm(
      `Delete “${idea?.title || 'this idea'}”? It will be removed from your library.`,
    );

    if (!confirmed) return;

    try {
      await deleteMyIdea(idea.id);
      setItems((current) => current.filter((item) => item.id !== idea.id));
      setPagination((current) => ({
        ...current,
        total: Math.max(0, Number(current.total ?? 0) - 1),
      }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <section className="ideas-page reveal-page">
      <header className="ideas-page__header">
        <div>
          <span className="ideas-page__kicker">Private workspace</span>
          <h1>My ideas</h1>
          <p>Review, continue, and manage every idea you created.</p>
        </div>

        <div className="ideas-page__count">
          <Grid2X2 size={18} />
          <strong>{pagination.total ?? items.length}</strong>
          <span>ideas</span>
        </div>
      </header>

      <div className="ideas-page__toolbar">
        <form
          className="ideas-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <Search size={18} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by title, problem, or domain..."
          />
          <button type="submit">Search</button>
        </form>

        <div className="ideas-filters" aria-label="Idea filters">
          <ListFilter size={17} aria-hidden="true" />
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? 'is-active' : ''}
              onClick={() => {
                setFilter(option.value);
                setPage(1);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="ideas-grid" aria-label="Loading ideas">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="idea-skeleton" />
          ))}
        </div>
      ) : error ? (
        <div className="ideas-state ideas-state--error">
          <RefreshCw size={28} />
          <h2>We could not load your ideas</h2>
          <p>{error}</p>
          <button type="button" onClick={loadIdeas}>Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="ideas-state">
          <Grid2X2 size={30} />
          <h2>No ideas in this view</h2>
          <p>Change the active filter or create a new idea from the Generate page.</p>
          <button type="button" onClick={() => navigate('/normal/generate')}>
            Go to Generate
          </button>
        </div>
      ) : (
        <div className="ideas-grid">
          {items.map((idea) => (
            <IdeaLibraryCard
              key={idea.id}
              idea={idea}
              onOpen={() => openIdea(idea)}
              onDelete={() => handleDelete(idea)}
            />
          ))}
        </div>
      )}

      {!loading && !error && pagination.totalPages > 1 && (
        <nav className="ideas-pagination" aria-label="Ideas pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            <ArrowLeft size={17} /> Previous
          </button>
          <span>Page <strong>{page}</strong> of {pagination.totalPages}</span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next <ArrowRight size={17} />
          </button>
        </nav>
      )}
    </section>
  );
}