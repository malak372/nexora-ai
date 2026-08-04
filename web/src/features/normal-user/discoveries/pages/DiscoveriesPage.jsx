/**
 * Premium community discovery gallery for authenticated Voxidence users.
 *
 * Loads published ideas, provides search and sorting, highlights one featured
 * publication, and reveals the remaining community ideas in an animated grid.
 *
 * @author Malak
 */

import {
  ArrowRight,
  Filter,
  Search,
  Sparkles,
  Star,
  ThumbsUp,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DiscoveryCard from '../components/DiscoveryCard';
import { getDiscoveries } from '../api/discoveriesApi';
import '../styles/discoveries.css';

const PAGE_SIZE = 12;

function getSearchableText(publication) {
  return [
    publication?.publicTitle,
    publication?.publicAbstract,
    publication?.publicProblem,
    publication?.publisher?.fullName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function sortPublications(publications, sortValue) {
  const result = [...publications];

  if (sortValue === 'rating') {
    return result.sort(
      (left, right) =>
        Number(right?.averageRating ?? 0) -
        Number(left?.averageRating ?? 0),
    );
  }

  if (sortValue === 'upvotes') {
    return result.sort(
      (left, right) =>
        Number(right?.upvotesCount ?? 0) -
        Number(left?.upvotesCount ?? 0),
    );
  }

  return result.sort(
    (left, right) =>
      new Date(
        right?.publishedAt ??
          right?.updatedAt ??
          0,
      ).getTime() -
      new Date(
        left?.publishedAt ??
          left?.updatedAt ??
          0,
      ).getTime(),
  );
}

export default function DiscoveriesPage() {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  const [publications, setPublications] = useState([]);
  const [searchValue, setSearchValue] = useState('');
  const [sortValue, setSortValue] = useState('newest');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isActive = true;

    async function loadDiscoveries() {
      try {
        setIsLoading(true);
        setErrorMessage('');

        const result = await getDiscoveries({
          page: 1,
          limit: PAGE_SIZE,
        });

        if (isActive) {
          setPublications(
            Array.isArray(result?.items)
              ? result.items
              : [],
          );
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(
            error?.message ||
              'Discoveries could not be loaded.',
          );
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadDiscoveries();

    return () => {
      isActive = false;
    };
  }, []);

  const visiblePublications = useMemo(() => {
    const normalizedSearch =
      searchValue.trim().toLowerCase();

    const filtered = normalizedSearch
      ? publications.filter((publication) =>
          getSearchableText(publication).includes(
            normalizedSearch,
          ),
        )
      : publications;

    return sortPublications(filtered, sortValue);
  }, [publications, searchValue, sortValue]);

  const featuredPublication =
    visiblePublications[0] ?? null;

  const remainingPublications =
    featuredPublication
      ? visiblePublications.slice(1)
      : [];

  const openPublication = (publication) => {
    const publicationId =
      publication?.id ??
      publication?.publicationId;

    if (!publicationId) {
      setErrorMessage(
        'This publication does not have a valid identifier.',
      );
      return;
    }

    navigate(`/normal/discover/${publicationId}`);
  };

  return (
    <main className="discover-page reveal-page">
      <motion.section
        className="discover-head"
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
          duration: 0.68,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="discover-head__orb discover-head__orb--one" />
        <div className="discover-head__orb discover-head__orb--two" />
        <div className="discover-head__grid" />

        <div className="discover-head__copy">
          <span>
            <Sparkles size={15} />
            Community intelligence
          </span>

          <h1>
            Discover ideas shaped by
            <em>real community needs.</em>
          </h1>

          <p>
            Explore public opportunities created through Voxidence's
            evidence-driven generation workflow and shared by creators
            across the community.
          </p>

          <div className="discover-head__chips">
            <span>
              <TrendingUp size={14} />
              Evidence driven
            </span>
            <span>
              <Star size={14} />
              Community rated
            </span>
            <span>
              <ThumbsUp size={14} />
              Open for feedback
            </span>
          </div>
        </div>

        <div className="discover-head__stat">
          <div className="discover-head__stat-icon">
            <Sparkles size={22} />
          </div>

          <div>
            <small>Available now</small>
            <strong>{publications.length}</strong>
            <span>discoveries loaded</span>
          </div>

          <i aria-hidden="true" />
        </div>
      </motion.section>

      <motion.section
        className="discover-controls"
        aria-label="Discovery filters"
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
          amount: 0.3,
        }}
        transition={{
          duration: 0.5,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <label className="discover-search">
          <Search size={19} />

          <input
            type="search"
            value={searchValue}
            onChange={(event) =>
              setSearchValue(event.target.value)
            }
            placeholder="Search titles, problems, creators..."
            aria-label="Search discoveries"
          />

          {searchValue ? (
            <button
              type="button"
              onClick={() => setSearchValue('')}
            >
              Clear
            </button>
          ) : (
            <span className="discover-search__hint">
              Search
            </span>
          )}
        </label>

        <label className="discover-sort">
          <Filter size={17} />

          <div>
            <small>Sort discoveries</small>
            <select
              value={sortValue}
              onChange={(event) =>
                setSortValue(event.target.value)
              }
              aria-label="Sort discoveries"
            >
              <option value="newest">Newest</option>
              <option value="rating">
                Highest rated
              </option>
              <option value="upvotes">
                Most upvoted
              </option>
            </select>
          </div>
        </label>
      </motion.section>

      {isLoading ? (
        <section
          className="discover-grid"
          aria-label="Loading discoveries"
        >
          {Array.from({ length: 6 }).map(
            (_, index) => (
              <div
                key={index}
                className="discover-skeleton"
              />
            ),
          )}
        </section>
      ) : null}

      {!isLoading && errorMessage ? (
        <section className="discover-state discover-state--error">
          <Sparkles size={28} />
          <h2>We could not load Discover</h2>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {!isLoading &&
      !errorMessage &&
      !featuredPublication ? (
        <section className="discover-state">
          <Sparkles size={28} />
          <h2>No discoveries found</h2>
          <p>
            Try another search or return after new
            ideas are published.
          </p>
        </section>
      ) : null}

      {!isLoading &&
      !errorMessage &&
      featuredPublication ? (
        <>
          <motion.section
            className="discover-featured"
            initial={
              shouldReduceMotion
                ? undefined
                : {
                    opacity: 0,
                    y: 28,
                  }
            }
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            viewport={{
              once: true,
              amount: 0.18,
            }}
            transition={{
              duration: 0.62,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div
              className="discover-featured__visual"
              aria-hidden="true"
            >
              <span className="discover-featured__mesh" />
              <span className="discover-featured__orbit" />
              <span className="discover-featured__orbit discover-featured__orbit--two" />

              <span className="discover-featured__core">
                <Sparkles size={34} />
              </span>

              <small>Featured opportunity</small>
            </div>

            <div className="discover-featured__content">
              <span>Editor's community highlight</span>

              <h2>
                {featuredPublication?.publicTitle ||
                  'Untitled discovery'}
              </h2>

              <p>
                {featuredPublication?.publicAbstract ||
                  featuredPublication?.publicProblem ||
                  'A public software opportunity shared with the Voxidence community.'}
              </p>

              <div className="discover-featured__metrics">
                <strong>
                  <Star size={14} />
                  {Number(
                    featuredPublication?.averageRating ??
                      0,
                  ).toFixed(1)}{' '}
                  rating
                </strong>

                <strong>
                  <ThumbsUp size={14} />
                  {featuredPublication?.upvotesCount ??
                    0}{' '}
                  upvotes
                </strong>

                <strong>
                  <UsersRound size={14} />
                  {featuredPublication?.acceptanceCount ?? 0}{' '}
                  accepted
                </strong>
              </div>

              <button
                type="button"
                onClick={() =>
                  openPublication(featuredPublication)
                }
              >
                Explore featured idea
                <ArrowRight size={17} />
              </button>
            </div>
          </motion.section>

          <section className="discover-section-title">
            <div>
              <span>
                <Sparkles size={19} />
              </span>

              <div>
                <small>Community gallery</small>
                <h2>More discoveries</h2>
                <p>
                  Explore ideas shared by Voxidence creators.
                </p>
              </div>
            </div>

            <strong>
              {remainingPublications.length} results
            </strong>
          </section>

          <section className="discover-grid">
            {remainingPublications.map(
              (publication, index) => (
                <DiscoveryCard
                  key={
                    publication?.id ??
                    publication?.publicationId ??
                    index
                  }
                  publication={publication}
                  index={index}
                  onOpen={() =>
                    openPublication(publication)
                  }
                />
              ),
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}