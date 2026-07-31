import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Eye,
  MessageSquareText,
  Star,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';

function formatDate(value) {
  if (!value) return 'Published recently';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export default function PublishedIdeaCard({ publication, onOpen, onInsights }) {
  return (
    <article className="published-card">
      <div className="published-card__visual" aria-hidden="true">
        <span className="published-card__pulse" />
        <span className="published-card__signal" />
        <BarChart3 size={28} />
      </div>

      <div className="published-card__body">
        <div className="published-card__topline">
          <span><Eye size={13} /> {publication?.visibility || 'PUBLIC'}</span>
          <small><CalendarDays size={13} /> {formatDate(publication?.publishedAt)}</small>
        </div>

        <h2>{publication?.publicTitle || 'Untitled publication'}</h2>
        <p>{publication?.publicAbstract || publication?.publicProblem || 'Published idea snapshot.'}</p>

        <div className="published-card__metrics">
          <span><Star size={15} /> {Number(publication?.averageRating ?? 0).toFixed(1)} <small>{publication?.ratingsCount ?? 0}</small></span>
          <span><ThumbsUp size={15} /> {publication?.upvotesCount ?? 0}</span>
          <span><ThumbsDown size={15} /> {publication?.downvotesCount ?? 0}</span>
          <span><MessageSquareText size={15} /> {publication?.feedbackCount ?? 0}</span>
        </div>

        <div className="published-card__actions">
          <button type="button" onClick={onInsights}>
            Audience insights <BarChart3 size={16} />
          </button>
          <button type="button" className="is-quiet" onClick={onOpen}>
            Open publication <ArrowUpRight size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}