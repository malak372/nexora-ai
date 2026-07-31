import {
  ArrowLeft,
  ArrowRight,
  Compass,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDiscoveries } from '../api/discoveriesApi';
import DiscoveryCard from '../components/DiscoveryCard';
import '../styles/discoveries.css';

const PAGE_SIZE = 9;
const SORT_OPTIONS = {
  newest: { sortBy: 'publishedAt', sortOrder: 'desc' },
  rated: { sortBy: 'averageRating', sortOrder: 'desc' },
  popular: { sortBy: 'upvotesCount', sortOrder: 'desc' },
  discussed: { sortBy: 'feedbackCount', sortOrder: 'desc' },
};

export default function DiscoveriesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...SORT_OPTIONS[sort],
  }), [page, search, sort]);

  const loadDiscoveries = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await getDiscoveries(params);
      setItems(result.items);
      setPagination(result.pagination);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    loadDiscoveries();
  }, [loadDiscoveries]);

  const featured = items[0] ?? null;
  const remaining = featured ? items.slice(1) : [];

  return (
    <section className="discover-page reveal-page">
      <header className="discover-head">
        <div className="discover-head__copy">
          <span><Compass size={15} /> Community intelligence</span>
          <h1>Discover ideas with real momentum.</h1>
          <p>Explore published ideas, vote on promising directions, and share feedback with their creators.</p>
        </div>

        <div className="discover-head__stat">
          <TrendingUp size={21} />
          <div><strong>{pagination.total ?? 0}</strong><span>published discoveries</span></div>
        </div>
      </header>

      <div className="discover-controls">
        <form
          className="discover-search"
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
            placeholder="Search published ideas..."
          />
          <button type="submit">Discover</button>
        </form>

        <label className="discover-sort">
          <SlidersHorizontal size={17} />
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
          >
            <option value="newest">Newest first</option>
            <option value="rated">Highest rated</option>
            <option value="popular">Most upvoted</option>
            <option value="discussed">Most discussed</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="discover-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="discover-skeleton" />
          ))}
        </div>
      ) : error ? (
        <div className="discover-state discover-state--error">
          <RefreshCw size={28} />
          <h2>Discovery feed unavailable</h2>
          <p>{error}</p>
          <button type="button" onClick={loadDiscoveries}>Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="discover-state">
          <Compass size={34} />
          <h2>No discoveries found</h2>
          <p>Try another search or come back after new ideas are published.</p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSearchInput('');
            }}
          >
            Clear search
          </button>
        </div>
      ) : (
        <>
          {featured && (
            <article className="discover-featured">
              <div className="discover-featured__visual" aria-hidden="true">
                <span className="discover-featured__orbit" />
                <span className="discover-featured__orbit discover-featured__orbit--two" />
                <span className="discover-featured__core"><Sparkles size={28} /></span>
              </div>

              <div className="discover-featured__content">
                <span>Featured discovery</span>
                <h2>{featured.publicTitle || 'Untitled discovery'}</h2>
                <p>{featured.publicAbstract || featured.publicProblem}</p>
                <div>
                  <strong>{Number(featured.averageRating ?? 0).toFixed(1)} rating</strong>
                  <strong>{featured.upvotesCount ?? 0} upvotes</strong>
                  <strong>{featured.feedbackCount ?? 0} feedback</strong>
                </div>
                <button type="button" onClick={() => navigate(`/normal/discover/${featured.id}`)}>
                  Open featured idea <ArrowRight size={16} />
                </button>
              </div>
            </article>
          )}

          <div className="discover-section-title">
            <div><Sparkles size={17} /><div><h2>More discoveries</h2><p>Fresh thinking from the community.</p></div></div>
            <small>{pagination.total ?? items.length} available</small>
          </div>

          <div className="discover-grid">
            {remaining.map((publication, index) => (
              <DiscoveryCard
                key={publication.id}
                publication={publication}
                index={index}
                onOpen={() => navigate(`/normal/discover/${publication.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {!loading && !error && pagination.totalPages > 1 && (
        <nav className="discover-pagination" aria-label="Discoveries pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            <ArrowLeft size={17} /> Previous
          </button>
          <span>Page <strong>{page}</strong> of {pagination.totalPages}</span>
          <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
            Next <ArrowRight size={17} />
          </button>
        </nav>
      )}
    </section>
  );
}