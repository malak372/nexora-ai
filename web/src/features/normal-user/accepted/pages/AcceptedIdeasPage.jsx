/** Library of publications accepted by the authenticated user. @author Malak */
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getAcceptedPublications } from '../api/acceptedPublicationsApi';
import '../styles/accepted.css';

const PAGE_SIZE = 8;

function formatDate(value) {
  if (!value) return 'Recently accepted';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export default function AcceptedIdeasPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await getAcceptedPublications({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        sortBy: 'acceptedAt',
        sortOrder: 'desc',
      });
      setItems(result.items ?? []);
      setPagination({
        total: result.pagination?.total ?? result.items?.length ?? 0,
        totalPages: result.pagination?.totalPages ?? 1,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="accepted-page reveal-page">
      <section className="accepted-hero">
        <div>
          <span><CheckCircle2 size={15} /> ACCEPTED OPPORTUNITIES</span>
          <h1>Your adopted idea library.</h1>
          <p>
            Reopen every opportunity you accepted, review its protected brief,
            and track whether advanced access has been unlocked.
          </p>
        </div>
        <div className="accepted-total">
          <strong>{pagination.total}</strong>
          <span>accepted ideas</span>
        </div>
      </section>

      <form
        className="accepted-search"
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
          placeholder="Search accepted ideas…"
        />
        <button type="submit">Search</button>
      </form>

      {loading ? (
        <div className="accepted-state"><RefreshCw className="accepted-spin" />Loading accepted ideas…</div>
      ) : error ? (
        <div className="accepted-state accepted-state--error">
          <RefreshCw />
          <h2>Accepted ideas unavailable</h2>
          <p>{error}</p>
          <button type="button" onClick={load}>Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="accepted-state">
          <LockKeyhole />
          <h2>No accepted ideas yet</h2>
          <p>Open Discover, review an opportunity, then choose Accept & continue.</p>
          <button type="button" onClick={() => navigate('/normal/discover')}>Open Discover</button>
        </div>
      ) : (
        <section className="accepted-grid">
          {items.map((item) => {
            const publication = item.publication ?? {};
            return (
              <article key={item.acceptanceId ?? item.id}>
                <div className="accepted-card__visual"><Sparkles size={30} /></div>
                <div className="accepted-card__body">
                  <div className="accepted-card__meta">
                    <span><Clock3 size={14} />{formatDate(item.acceptedAt)}</span>
                    <span className={item.hasAdvancedAccess ? 'is-advanced' : ''}>
                      {item.hasAdvancedAccess ? 'Advanced unlocked' : 'Basic accepted'}
                    </span>
                  </div>
                  <h2>{publication.publicTitle || 'Untitled opportunity'}</h2>
                  <p>{publication.publicAbstract || 'No public abstract was provided.'}</p>
                  <button
                    type="button"
                    onClick={() => navigate(`/normal/discover/${publication.id}`)}
                  >
                    Open accepted brief
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {!loading && !error && pagination.totalPages > 1 ? (
        <nav className="accepted-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            <ArrowLeft size={17} /> Previous
          </button>
          <span>Page <strong>{page}</strong> of {pagination.totalPages}</span>
          <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>
            Next <ArrowRight size={17} />
          </button>
        </nav>
      ) : null}
    </main>
  );
}