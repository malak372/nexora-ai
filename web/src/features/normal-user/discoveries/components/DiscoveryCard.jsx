/**
 * Animated discovery gallery card.
 *
 * @author Malak
 */

import {
  ArrowUpRight,
  CheckCircle2,
  MessageCircleMore,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserRound,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';

function getInitials(value = 'Nexora') {
  return value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function DiscoveryCard({
  publication,
  index = 0,
  onOpen,
}) {
  const shouldReduceMotion = useReducedMotion();

  const publisherName =
    publication?.publisher?.fullName ||
    'Nexora creator';

  const isAccepted = Boolean(
    publication?.isAccepted ||
    publication?.acceptanceId ||
    publication?.acceptance?.id,
  );

  const abstract =
    publication?.publicAbstract ||
    publication?.publicProblem ||
    'A software opportunity shared with the Nexora community for discovery and collaboration.';

  return (
    <motion.article
      className={`discovery-story discovery-story--${
        (index % 4) + 1
      }`}
      initial={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 0,
              y: 26,
              scale: 0.985,
            }
      }
      whileInView={{
        opacity: 1,
        y: 0,
        scale: 1,
      }}
      viewport={{
        once: true,
        amount: 0.16,
      }}
      transition={{
        duration: 0.52,
        delay: shouldReduceMotion
          ? 0
          : (index % 3) * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={
        shouldReduceMotion
          ? undefined
          : {
              y: -8,
              scale: 1.008,
            }
      }
    >
      <div
        className="discovery-story__art"
        aria-hidden="true"
      >
        <span className="discovery-story__mesh" />
        <span className="discovery-story__beam" />
        <span className="discovery-story__ring" />
        <span className="discovery-story__ring discovery-story__ring--two" />

        <span className="discovery-story__planet">
          {getInitials(
            publication?.publicTitle || 'NX',
          )}
        </span>

        <small>
          #{String(index + 1).padStart(2, '0')}
        </small>
      </div>

      <div className="discovery-story__content">
        <div className="discovery-story__author">
          <span>{getInitials(publisherName)}</span>

          <div>
            <strong>{publisherName}</strong>
            <small>
              <UserRound size={12} />
              Published in Nexora
            </small>
          </div>
        </div>

        <span className={`discovery-story__label ${isAccepted ? 'is-accepted' : ''}`}>
          {isAccepted ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
          {isAccepted ? 'Accepted opportunity' : 'Community discovery'}
        </span>

        <h2>
          {publication?.publicTitle ||
            'Untitled discovery'}
        </h2>

        <p>{abstract}</p>

        <div className="discovery-story__metrics">
          <span>
            <Star size={15} />
            {Number(
              publication?.averageRating ?? 0,
            ).toFixed(1)}
          </span>

          <span>
            <ThumbsUp size={15} />
            {publication?.upvotesCount ?? 0}
          </span>

          <span>
            <ThumbsDown size={15} />
            {publication?.downvotesCount ?? 0}
          </span>

          <span>
            <MessageCircleMore size={15} />
            {publication?.feedbackCount ?? 0}
          </span>
        </div>

        <motion.button
          type="button"
          onClick={onOpen}
          whileHover={
            shouldReduceMotion
              ? undefined
              : {
                  x: 3,
                }
          }
          whileTap={
            shouldReduceMotion
              ? undefined
              : {
                  scale: 0.98,
                }
          }
        >
          Explore the idea
          <ArrowUpRight size={16} />
        </motion.button>
      </div>
    </motion.article>
  );
}