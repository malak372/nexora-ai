import {
  ArrowUpRight,
  MessageCircleMore,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserRound,
} from 'lucide-react';

function getInitials(value = 'Nexora') {
  return value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function DiscoveryCard({ publication, index = 0, onOpen }) {
  const publisherName = publication?.publisher?.fullName || 'Nexora creator';
  const abstract =
    publication?.publicAbstract ||
    publication?.publicProblem ||
    'A software opportunity shared with the Nexora community for discovery and collaboration.';

  return (
    <article className={`discovery-story discovery-story--${(index % 3) + 1}`}>
      <div className="discovery-story__art" aria-hidden="true">
        <span className="discovery-story__beam" />
        <span className="discovery-story__ring" />
        <span className="discovery-story__planet">
          {getInitials(publication?.publicTitle || 'NX')}
        </span>
      </div>

      <div className="discovery-story__content">
        <div className="discovery-story__author">
          <span>{getInitials(publisherName)}</span>
          <div>
            <strong>{publisherName}</strong>
            <small><UserRound size={12} /> Published in Nexora</small>
          </div>
        </div>

        <span className="discovery-story__label"><Sparkles size={13} /> Community discovery</span>
        <h2>{publication?.publicTitle || 'Untitled discovery'}</h2>
        <p>{abstract}</p>

        <div className="discovery-story__metrics">
          <span><Star size={15} /> {Number(publication?.averageRating ?? 0).toFixed(1)}</span>
          <span><ThumbsUp size={15} /> {publication?.upvotesCount ?? 0}</span>
          <span><ThumbsDown size={15} /> {publication?.downvotesCount ?? 0}</span>
          <span><MessageCircleMore size={15} /> {publication?.feedbackCount ?? 0}</span>
        </div>

        <button type="button" onClick={onOpen}>
          Explore the idea <ArrowUpRight size={16} />
        </button>
      </div>
    </article>
  );
}