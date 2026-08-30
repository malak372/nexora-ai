/**
 * Premium community discovery gallery for authenticated Voxidence users.
 *
 * Loads published ideas, provides search and sorting, highlights one featured
 * publication, and reveals the remaining community ideas in an animated grid.
 *
 * @author Malak
 */

import { workspacePath } from '../../shared/utils/workspacePath';
import {
  ArrowRight,
  ChevronDown,
  Filter,
  Search,
  Sparkles,
  Star,
  ThumbsUp,
  UsersRound,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DiscoveryCard from '../components/DiscoveryCard';
import { getDiscoveries } from '../api/discoveriesApi';
import { preloadDiscoveryDetail } from '../../../../routes/routePreloaders';
import { useUserExperience } from '../../../../system/user-experience';
import NormalPageHero from '../../shared/components/NormalPageHero';
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
  const { t } = useUserExperience();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  const [publications, setPublications] = useState([]);
  const [searchValue, setSearchValue] = useState('');
  const [sortValue, setSortValue] = useState('newest');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    function handleOutsideClick(event) {
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(event.target)
      ) {
        setSortMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

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

    navigate(workspacePath(`/normal/discover/${publicationId}`), {
      state: {
        publicationSeed: publication,
      },
    });
  };

  const warmPublication = (publication) => {
    const publicationId =
      publication?.id ??
      publication?.publicationId;

    if (publicationId) {
      preloadDiscoveryDetail(publicationId);
    }
  };

  return (
    <main className="discover-page reveal-page">
      <NormalPageHero
        variant="discover"
        eyebrow={t('Community intelligence')}
        title={t('Discover ideas shaped by real community needs.')}
        description={t("Explore public opportunities created through Voxidence's evidence-driven generation workflow and shared by creators across the community.")}
        chips={[t('Evidence driven'), t('Community rated'), t('Open for feedback')]}
        stats={[{ label: t('Discoveries available'), value: publications.length }]}
        compact
      />

      <motion.section
        className="discover-controls"
        aria-label={t('Discovery filters')}
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
            placeholder={t('Search titles, problems, creators...')}
            aria-label={t('Search discoveries')}
          />

          {searchValue ? (
            <button
              type="button"
              onClick={() => setSearchValue('')}
            >
              {t('Clear')}
            </button>
          ) : (
            <span className="discover-search__hint">
              {t('Search')}
            </span>
          )}
        </label>

        <div className="discover-sort" ref={sortMenuRef}>
          <Filter size={17} />

          <div className="discover-sort__content">
            <small>{t('Sort discoveries')}</small>

            <button
              type="button"
              className="discover-sort__trigger"
              onClick={() =>
                setSortMenuOpen((current) => !current)
              }
              aria-haspopup="listbox"
              aria-expanded={sortMenuOpen}
              aria-label={t('Sort discoveries')}
            >
              <span>
                {t(sortValue === 'rating'
                  ? 'Highest rated'
                  : sortValue === 'upvotes'
                    ? 'Most upvoted'
                    : 'Newest')}
              </span>
              <ChevronDown
                size={15}
                className={
                  sortMenuOpen ? 'is-open' : ''
                }
              />
            </button>

            {sortMenuOpen ? (
              <div
                className="discover-sort__menu"
                role="listbox"
                aria-label={t('Sort discoveries')}
              >
                {[
                  ['newest', 'Newest'],
                  ['rating', 'Highest rated'],
                  ['upvotes', 'Most upvoted'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={sortValue === value}
                    className={
                      sortValue === value
                        ? 'is-selected'
                        : ''
                    }
                    onClick={() => {
                      setSortValue(value);
                      setSortMenuOpen(false);
                    }}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </motion.section>

      {isLoading ? (
        <section
          className="discover-grid"
          aria-label={t('Loading discoveries')}
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
          <h2>{t('We could not load Discover')}</h2>
          <p>{t(errorMessage)}</p>
        </section>
      ) : null}

      {!isLoading &&
        !errorMessage &&
        !featuredPublication ? (
        <section className="discover-state">
          <Sparkles size={28} />
          <h2>{t('No discoveries found')}</h2>
          <p>{t('Try another search or return after new ideas are published.')}</p>
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

              <small>{t('Featured opportunity')}</small>
            </div>

            <div className="discover-featured__content">
              <span>{t("Editor's community highlight")}</span>

              <h2 dir="auto">
                {featuredPublication?.publicTitle ||
                  t('Untitled discovery')}
              </h2>

              <p dir="auto">
                {featuredPublication?.publicAbstract ||
                  featuredPublication?.publicProblem ||
                  t('A public software opportunity shared with the Voxidence community.')}
              </p>

              <div className="discover-featured__metrics">
                <strong>
                  <Star size={14} />
                  {Number(
                    featuredPublication?.averageRating ??
                    0,
                  ).toFixed(1)}{' '}
                  {t('rating')}
                </strong>

                <strong>
                  <ThumbsUp size={14} />
                  {featuredPublication?.upvotesCount ??
                    0}{' '}
                  {t('upvotes')}
                </strong>

                <strong>
                  <UsersRound size={14} />
                  {featuredPublication?.acceptanceCount ?? 0}{' '}
                  {t('accepted')}
                </strong>
              </div>

              <button
                type="button"
                onMouseEnter={() => warmPublication(featuredPublication)}
                onFocus={() => warmPublication(featuredPublication)}
                onPointerDown={() => warmPublication(featuredPublication)}
                onClick={() =>
                  openPublication(featuredPublication)
                }
              >
                {t('Explore featured idea')}
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
                <small>{t('Community gallery')}</small>
                <h2>{t('More discoveries')}</h2>
                <p>{t('Explore ideas shared by Voxidence creators.')}</p>
              </div>
            </div>

            <strong>
              {remainingPublications.length} {t('results')}
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
                  onPrefetch={() =>
                    warmPublication(publication)
                  }
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
