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
  UsersRound,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useUserExperience } from '../../../../system/user-experience';

function getInitials(value = 'Voxidence') {
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
  onPrefetch,
}) {
  const shouldReduceMotion = useReducedMotion();
  const { t } = useUserExperience();

  const publisherName =
    publication?.publisher?.fullName ||
    'Voxidence creator';

  const isAccepted = Boolean(
    publication?.isAccepted ||
    publication?.acceptanceId ||
    publication?.acceptance?.id,
  );

  const abstract =
    publication?.publicAbstract ||
    publication?.publicProblem ||
    'A software opportunity shared with the Voxidence community for discovery and collaboration.';

  return (
    <motion.article
      className={`discovery-story discovery-story--${
        (index % 4) + 1
      }`}
      onMouseEnter={onPrefetch}
      initial={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 0,
              y: 18,
              scale: 0.995,
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
              y: -2,
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
          {getInitials(publication?.publicTitle || 'VX')}
        </span>

        <small>
          #{String(index + 1).padStart(2, '0')}
        </small>
      </div>

      <div className="discovery-story__content">
        <div className="discovery-story__author">
          <span>{getInitials(publisherName)}</span>

          <div>
            <strong dir="auto" data-no-auto-translate="true">{publisherName}</strong>
            <small>
              <UserRound size={12} />
              {t('Published in Voxidence')}
            </small>
          </div>
        </div>

        <span className={`discovery-story__label ${isAccepted ? 'is-accepted' : ''}`}>
          {isAccepted ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
          {t(isAccepted ? 'Accepted opportunity' : 'Community discovery')}
        </span>

        <h2>
          <span dir="auto" data-idea-content="true">{publication?.publicTitle || t('Untitled discovery')}</span>
        </h2>

        <p dir="auto" data-idea-content="true">{abstract}</p>

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

          <span className="is-accepted-count">
            <UsersRound size={15} />
            {publication?.acceptanceCount ?? 0}
            <small>{t('accepted')}</small>
          </span>
        </div>

        <motion.button
          type="button"
          onMouseEnter={onPrefetch}
          onFocus={onPrefetch}
          onPointerDown={onPrefetch}
          onClick={onOpen}
          whileHover={
            shouldReduceMotion
              ? undefined
              : {
                  x: 2,
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
          {t('Explore the idea')}
          <ArrowUpRight size={16} />
        </motion.button>
      </div>
    </motion.article>
  );
}
