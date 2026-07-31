import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getMyPublishedIdeas } from '../api/publishedIdeasApi';
import PublishedIdeaCard from '../components/PublishedIdeaCard';
import PublicationInsightsPanel from '../components/PublicationInsightsPanel';
import '../styles/published.css';

const PAGE_SIZE = 8;

export default function PublishedIdeasPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedPublication, setSelectedPublication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    sortBy: 'publishedAt',
    sortOrder: 'desc',
    ...(search ? { search } : {}),
  }), [page, search]);

  const loadPublished = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getMyPublishedIdeas(params);
      setItems(result.items);
      setPagination(result.pagination);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    loadPublished();
  }, [loadPublished]);

  return (
    <section className="published-page reveal-page">
      <header className="published-page__header">
        <div>
          <span><Send size={15} /> Creator publishing desk</span>
          <h1>Published ideas</h1>
          <p>See your live publications and understand how the community responds to each one.</p>
        </div>
        <div className="published-page__stat"><BarChart3 size={20} /><div><strong>{pagination.total ?? 0}</strong><span>live publications</span></div></div>
      </header>

      <form
        className="published-search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <Search size={18} />
        <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search your published ideas..." />
        <button type="submit">Search</button>
      </form>

      {loading ? (
        <div className="published-grid">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="published-skeleton" />)}</div>
      ) : error ? (
        <div className="published-state published-state--error"><RefreshCw size={28} /><h2>Published ideas unavailable</h2><p>{error}</p><button type="button" onClick={loadPublished}>Try again</button></div>
      ) : items.length === 0 ? (
        <div className="published-state"><Send size={30} /><h2>No published ideas yet</h2><p>Publish one of your completed ideas to start receiving ratings, votes, and feedback.</p><button type="button" onClick={() => navigate('/normal/ideas')}>Open My Ideas</button></div>
      ) : (
        <div className="published-grid">
          {items.map((publication) => (
            <PublishedIdeaCard
              key={publication.id}
              publication={publication}
              onOpen={() => navigate(`/normal/discover/${publication.id}`)}
              onInsights={() => setSelectedPublication(publication)}
            />
          ))}
        </div>
      )}

      {!loading && !error && pagination.totalPages > 1 && (
        <nav className="published-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ArrowLeft size={17} /> Previous</button>
          <span>Page <strong>{page}</strong> of {pagination.totalPages}</span>
          <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight size={17} /></button>
        </nav>
      )}

      {selectedPublication && (
        <PublicationInsightsPanel publication={selectedPublication} onClose={() => setSelectedPublication(null)} />
      )}
    </section>
  );
}