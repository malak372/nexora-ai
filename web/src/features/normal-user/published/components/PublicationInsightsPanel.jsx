import {
  ArrowLeft,
  ArrowRight,
  MessageSquareText,
  RefreshCw,
  Star,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { getReceivedFeedback } from '../api/publishedIdeasApi';

const PAGE_SIZE = 8;

function initials(name = 'Nexora user') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export default function PublicationInsightsPanel({ publication, onClose }) {
  const [summary, setSummary] = useState(publication);
  const [feedback, setFeedback] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getReceivedFeedback(publication.id, {
        page,
        limit: PAGE_SIZE,
      });
      setSummary((current) => ({ ...current, ...result.publication }));
      setFeedback(result.feedback);
      setPagination(result.pagination);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [page, publication.id]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  return (
    <div className="insights-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="insights-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Publication audience insights"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="insights-panel__header">
          <div>
            <span>Audience response</span>
            <h2>{publication?.publicTitle || 'Publication insights'}</h2>
          </div>
          <button type="button" aria-label="Close insights" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="insights-summary">
          <article><Star size={18} /><div><strong>{Number(summary?.averageRating ?? 0).toFixed(1)}</strong><span>{summary?.ratingsCount ?? 0} ratings</span></div></article>
          <article><ThumbsUp size={18} /><div><strong>{summary?.upvotesCount ?? 0}</strong><span>upvotes</span></div></article>
          <article><ThumbsDown size={18} /><div><strong>{summary?.downvotesCount ?? 0}</strong><span>downvotes</span></div></article>
          <article><MessageSquareText size={18} /><div><strong>{summary?.feedbackCount ?? 0}</strong><span>feedback</span></div></article>
        </div>

        <div className="insights-panel__section-title">
          <div><MessageSquareText size={17} /><div><h3>Written feedback</h3><p>Private responses visible only to the publication owner.</p></div></div>
          <small>{pagination.total ?? 0} responses</small>
        </div>

        {loading ? (
          <div className="insights-loading">
            {Array.from({ length: 3 }).map((_, index) => <div key={index} />)}
          </div>
        ) : error ? (
          <div className="insights-empty insights-empty--error">
            <RefreshCw size={25} />
            <h3>Feedback unavailable</h3>
            <p>{error}</p>
            <button type="button" onClick={loadFeedback}>Try again</button>
          </div>
        ) : feedback.length === 0 ? (
          <div className="insights-empty">
            <MessageSquareText size={28} />
            <h3>No written feedback yet</h3>
            <p>Your rating and voting counters will still update above.</p>
          </div>
        ) : (
          <div className="feedback-list">
            {feedback.map((item) => (
              <article key={item.id} className="feedback-item">
                <span className="feedback-item__avatar">{initials(item?.user?.fullName)}</span>
                <div>
                  <header><strong>{item?.user?.fullName || 'Nexora user'}</strong><time>{formatDate(item?.createdAt)}</time></header>
                  <p>{item.comment}</p>
                </div>
              </article>
            ))}
          </div>
        )}

        {!loading && !error && pagination.totalPages > 1 && (
          <nav className="insights-pagination">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ArrowLeft size={16} /></button>
            <span>{page} / {pagination.totalPages}</span>
            <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}><ArrowRight size={16} /></button>
          </nav>
        )}
      </aside>
    </div>
  );
}