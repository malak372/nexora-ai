/**
 * Private idea library.
 *
 * Visual styling is provided by the Voxidence eucalyptus, pearl, and soft-rose theme.
 * Displays generated, unlocked, free, and accepted ideas in one unified
 * library. Search, date filtering, pagination, deletion, and accepted-item
 * normalization are handled inside this page.
 *
 * @author Malak
 */
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Grid2X2,
  Globe2,
  Heart,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { getAcceptedPublications } from '../../accepted/api/acceptedPublicationsApi';
import { getMyPublishedIdeas } from '../../published/api/publishedIdeasApi';
import {
  addIdeaToFavorites,
  deleteMyIdea,
  getMyFavoriteIdeas,
  getMyIdeas,
  removeIdeaFromFavorites,
} from '../api/userIdeasApi';
import IdeaLibraryCard from '../components/IdeaLibraryCard';
import '../styles/ideas.css';

const PAGE_SIZE = 9;

const ACTIVE_RUN_STATUSES = new Set([
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'PAUSED',
]);

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'core', label: 'Free' },
  { value: 'unlocked', label: 'Unlocked' },
  {
    value: 'published',
    label: 'Published',
    icon: Globe2,
  },
  {
    value: 'accepted',
    label: 'Accepted',
    icon: CheckCircle2,
  },
  {
    value: 'favorites',
    label: 'Favorite ideas',
    icon: Heart,
  },
];

/**
 * Returns today's date using the user's local timezone.
 *
 * @returns {string} Local date formatted as YYYY-MM-DD.
 */
function getTodayInputValue() {
  const now = new Date();
  const localTime =
    now.getTime() - now.getTimezoneOffset() * 60_000;

  return new Date(localTime)
    .toISOString()
    .slice(0, 10);
}

/**
 * Converts a backend date value into a valid local Date object.
 *
 * @param {string | Date | null | undefined} value
 * @returns {Date | null}
 */
function toLocalDateValue(value) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

/**
 * Checks whether an item date is inside the selected inclusive range.
 *
 * @param {object} item
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {boolean}
 */
function matchesDateRange(item, fromDate, toDate) {
  const itemDate = toLocalDateValue(
    item?.acceptedAt ??
    item?.createdAt ??
    item?.publication?.publishedAt ??
    item?.updatedAt,
  );

  if (!itemDate) return false;

  const from = fromDate
    ? new Date(`${fromDate}T00:00:00`)
    : null;

  const to = toDate
    ? new Date(`${toDate}T23:59:59.999`)
    : null;

  return (
    (!from || itemDate >= from) &&
    (!to || itemDate <= to)
  );
}

/**
 * Loads every page returned by a paginated backend loader.
 *
 * This is used when client-side date filtering is required.
 *
 * @param {Function} loader
 * @param {object} params
 * @returns {Promise<object[]>}
 */
async function loadEveryPage(loader, params) {
  const pageSize = 50;

  const first = await loader({
    ...params,
    page: 1,
    limit: pageSize,
  });

  const totalPages = Math.max(
    1,
    Number(first.pagination?.totalPages ?? 1),
  );

  const items = [...(first.items ?? [])];

  for (
    let nextPage = 2;
    nextPage <= totalPages;
    nextPage += 1
  ) {
    const next = await loader({
      ...params,
      page: nextPage,
      limit: pageSize,
    });

    items.push(...(next.items ?? []));
  }

  return items;
}

function normalizePublishedRecord(record) {
  const sourceIdea = record?.idea ?? {};

  return {
    ...sourceIdea,

    id:
      record?.ideaId ??
      sourceIdea?.id ??
      record?.id,

    title:
      record?.publicTitle ??
      sourceIdea?.title ??
      'Untitled published idea',

    limitedAbstract:
      sourceIdea?.limitedAbstract ??
      null,

    partialAbstract:
      sourceIdea?.partialAbstract ??
      record?.publicAbstract ??
      null,

    fullAbstract:
      sourceIdea?.fullAbstract ??
      null,

    problemStatement:
      sourceIdea?.problemStatement ??
      record?.publicProblem ??
      null,

    domain:
      sourceIdea?.domain ??
      record?.domain ??
      null,

    createdAt:
      sourceIdea?.createdAt ??
      record?.publishedAt ??
      record?.createdAt,

    isUnlocked: Boolean(sourceIdea?.isUnlocked),

    isFavorite: Boolean(sourceIdea?.isFavorite),

    publication: {
      ...record,
      status: String(record?.status ?? 'PUBLISHED').toUpperCase(),
    },

    publishedAt: record?.publishedAt,

    __libraryKind: 'published',
  };
}

/**
 * Converts an accepted publication into the shape required by the shared
 * IdeaLibraryCard component.
 *
 * @param {object} record
 * @returns {object}
 */
function normalizeAcceptedRecord(record) {
  const publication = record?.publication ?? {};
  const sourceIdea =
    publication?.idea ??
    record?.idea ??
    {};

  return {
    ...sourceIdea,

    id:
      record?.acceptanceId ??
      record?.id ??
      publication?.id,

    title:
      publication?.publicTitle ??
      sourceIdea?.title ??
      'Untitled accepted idea',

    limitedAbstract:
      publication?.publicAbstract ??
      sourceIdea?.limitedAbstract ??
      sourceIdea?.partialAbstract ??
      sourceIdea?.problemStatement,

    domain:
      sourceIdea?.domain ??
      publication?.domain ??
      null,

    createdAt:
      record?.acceptedAt ??
      publication?.publishedAt ??
      publication?.createdAt ??
      sourceIdea?.createdAt,

    isUnlocked: Boolean(
      record?.hasAdvancedAccess ??
      sourceIdea?.isUnlocked,
    ),

    publication,
    acceptance: record,
    acceptedAt: record?.acceptedAt,

    hasAdvancedAccess: Boolean(
      record?.hasAdvancedAccess,
    ),

    __libraryKind: 'accepted',
  };
}

/**
 * Displays and manages the authenticated user's private idea library.
 *
 * @returns {JSX.Element}
 */
export default function MyIdeasPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const today = useMemo(
    () => getTodayInputValue(),
    [],
  );

  const [items, setItems] = useState([]);

  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 1,
  });

  const [searchInput, setSearchInput] =
    useState('');

  const [search, setSearch] =
    useState('');

  const [filter, setFilter] = useState(() => {
    const requestedView = searchParams.get('view');
    return FILTERS.some((item) => item.value === requestedView)
      ? requestedView
      : 'all';
  });

  const [fromDate, setFromDate] =
    useState('');

  const [toDate, setToDate] =
    useState('');

  const [page, setPage] =
    useState(1);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [favoriteProcessingId, setFavoriteProcessingId] =
    useState('');

  /**
   * Builds backend query parameters for standard idea filters.
   */
  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: PAGE_SIZE,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };

    if (search) {
      params.search = search;
    }

    if (filter === 'unlocked') {
      params.isUnlocked = true;
    }

    if (filter === 'core') {
      params.isUnlocked = false;
    }

    return params;
  }, [filter, page, search]);

  /**
   * Loads ideas for the selected filter, date range, and page.
   */
  const loadIdeas = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError('');

    try {
      const hasDateRange = Boolean(
        fromDate || toDate,
      );

      if (filter === 'favorites') {
        const favoriteItems = await getMyFavoriteIdeas({ force });

        const filtered = favoriteItems.filter((item) => {
          const query = search.trim().toLowerCase();
          const matchesSearch =
            !query ||
            String(item?.title ?? '').toLowerCase().includes(query) ||
            String(item?.problemStatement ?? '').toLowerCase().includes(query) ||
            String(item?.domain?.name ?? '').toLowerCase().includes(query);

          return (
            matchesSearch &&
            (!hasDateRange ||
              matchesDateRange(item, fromDate, toDate))
          );
        });

        const start = (page - 1) * PAGE_SIZE;

        setItems(filtered.slice(start, start + PAGE_SIZE));
        setPagination({
          page,
          limit: PAGE_SIZE,
          total: filtered.length,
          totalPages: Math.max(
            1,
            Math.ceil(filtered.length / PAGE_SIZE),
          ),
        });

        return;
      }

      if (filter === 'published') {
        const publishedParams = {
          search: search || undefined,
          status: 'PUBLISHED',
          sortBy: 'publishedAt',
          sortOrder: 'desc',
        };

        if (hasDateRange) {
          const allPublished = await loadEveryPage(
            async (params) => {
              const result = await getMyPublishedIdeas(
                params,
                { forceRefresh: force },
              );

              return {
                items: (result.items ?? []).map(
                  normalizePublishedRecord,
                ),
                pagination: result.pagination,
              };
            },
            publishedParams,
          );

          const filtered = allPublished.filter(
            (item) =>
              matchesDateRange(
                item,
                fromDate,
                toDate,
              ),
          );

          const start =
            (page - 1) * PAGE_SIZE;

          setItems(
            filtered.slice(
              start,
              start + PAGE_SIZE,
            ),
          );

          setPagination({
            page,
            limit: PAGE_SIZE,
            total: filtered.length,
            totalPages: Math.max(
              1,
              Math.ceil(
                filtered.length /
                PAGE_SIZE,
              ),
            ),
          });

          return;
        }

        const publishedResult =
          await getMyPublishedIdeas(
            {
              ...publishedParams,
              page,
              limit: PAGE_SIZE,
            },
            { forceRefresh: force },
          );

        const publishedItems =
          (publishedResult.items ?? []).map(
            normalizePublishedRecord,
          );

        setItems(publishedItems);

        setPagination({
          page:
            publishedResult.pagination?.page ??
            page,

          limit:
            publishedResult.pagination?.limit ??
            PAGE_SIZE,

          total:
            publishedResult.pagination?.total ??
            publishedItems.length,

          totalPages:
            publishedResult.pagination?.totalPages ??
            1,
        });

        return;
      }

      if (filter === 'accepted') {
        const acceptedParams = {
          search: search || undefined,
          sortBy: 'acceptedAt',
          sortOrder: 'desc',
        };

        if (hasDateRange) {
          const allAccepted = await loadEveryPage(
            async (params) => {
              const result =
                await getAcceptedPublications(params, { force });

              return {
                items: (result.items ?? []).map(
                  normalizeAcceptedRecord,
                ),
                pagination: result.pagination,
              };
            },
            acceptedParams,
          );

          const filtered = allAccepted.filter(
            (item) =>
              matchesDateRange(
                item,
                fromDate,
                toDate,
              ),
          );

          const start =
            (page - 1) * PAGE_SIZE;

          const pageItems =
            filtered.slice(
              start,
              start + PAGE_SIZE,
            );

          setItems(pageItems);

          setPagination({
            page,
            limit: PAGE_SIZE,
            total: filtered.length,
            totalPages: Math.max(
              1,
              Math.ceil(
                filtered.length /
                PAGE_SIZE,
              ),
            ),
          });

          return;
        }

        const acceptedResult =
          await getAcceptedPublications(
            {
              ...acceptedParams,
              page,
              limit: PAGE_SIZE,
            },
            { force },
          );

        const acceptedItems =
          (acceptedResult.items ?? []).map(
            normalizeAcceptedRecord,
          );

        setItems(acceptedItems);

        setPagination({
          page:
            acceptedResult.pagination?.page ??
            page,

          limit:
            acceptedResult.pagination?.limit ??
            PAGE_SIZE,

          total:
            acceptedResult.pagination?.total ??
            acceptedItems.length,

          totalPages:
            acceptedResult.pagination
              ?.totalPages ?? 1,
        });

        return;
      }

      if (hasDateRange) {
        const baseParams = {
          ...queryParams,
          page: undefined,
          limit: undefined,
        };

        const allIdeas =
          await loadEveryPage(
            (params) => getMyIdeas(params, { force }),
            baseParams,
          );

        const statusFiltered =
          filter === 'generating'
            ? allIdeas.filter((item) =>
              ACTIVE_RUN_STATUSES.has(
                String(
                  item?.generationRun
                    ?.status ?? '',
                ).toUpperCase(),
              ),
            )
            : allIdeas;

        const dateFiltered =
          statusFiltered.filter((item) =>
            matchesDateRange(
              item,
              fromDate,
              toDate,
            ),
          );

        const start =
          (page - 1) * PAGE_SIZE;

        setItems(
          dateFiltered.slice(
            start,
            start + PAGE_SIZE,
          ),
        );

        setPagination({
          page,
          limit: PAGE_SIZE,
          total: dateFiltered.length,
          totalPages: Math.max(
            1,
            Math.ceil(
              dateFiltered.length /
              PAGE_SIZE,
            ),
          ),
        });

        return;
      }

      const result =
        await getMyIdeas(queryParams, { force });

      const visibleItems =
        filter === 'generating'
          ? result.items.filter((item) =>
            ACTIVE_RUN_STATUSES.has(
              String(
                item?.generationRun
                  ?.status ?? '',
              ).toUpperCase(),
            ),
          )
          : result.items;

      setItems(visibleItems);

      setPagination({
        page:
          result.pagination?.page ??
          page,

        limit:
          result.pagination?.limit ??
          PAGE_SIZE,

        total:
          filter === 'generating'
            ? visibleItems.length
            : result.pagination?.total ??
            visibleItems.length,

        totalPages:
          filter === 'generating'
            ? 1
            : result.pagination
              ?.totalPages ?? 1,
      });
    } catch (requestError) {
      setError(
        requestError.message ||
        'Unable to load ideas.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    filter,
    fromDate,
    page,
    queryParams,
    search,
    toDate,
  ]);

  const requestedView = searchParams.get('view');

  /**
   * Synchronizes the filter only when the URL query value changes.
   *
   * The previous implementation depended on `filter` itself. Clicking a
   * filter changed the state, immediately reran the effect, and restored the
   * old URL value (usually `all`). That made the filter appear frozen.
   */
  useEffect(() => {
    const nextFilter = FILTERS.some(
      (item) => item.value === requestedView,
    )
      ? requestedView
      : 'all';

    setFilter((current) =>
      current === nextFilter ? current : nextFilter,
    );
    setPage(1);
  }, [requestedView]);

  /**
   * Applies a filter and keeps the browser URL in sync with the selected tab.
   *
   * @param {string} nextFilter
   */
  function handleFilterChange(nextFilter) {
    if (!FILTERS.some((item) => item.value === nextFilter)) return;

    setFilter(nextFilter);
    setPage(1);

    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams);

        if (nextFilter === 'all') {
          nextParams.delete('view');
        } else {
          nextParams.set('view', nextFilter);
        }

        return nextParams;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    void loadIdeas();
  }, [loadIdeas]);

  /**
   * Opens the correct destination based on the library item type and state.
   *
   * @param {object} idea
   */
  function openIdea(idea) {
    if (
      idea?.__libraryKind ===
      'accepted'
    ) {
      const publicationId =
        idea?.publication?.id;

      if (publicationId) {
        navigate(
          idea?.hasAdvancedAccess
            ? `/normal/accepted/${publicationId}/workspace`
            : `/normal/discover/${publicationId}`,
        );
      }

      return;
    }

    if (
      idea?.__libraryKind ===
      'published' ||
      String(
        idea?.publication?.status ?? '',
      ).toUpperCase() === 'PUBLISHED'
    ) {
      const ideaId =
        idea?.publication?.ideaId ??
        idea?.id;

      if (ideaId) {
        navigate(
          `/normal/ideas/${ideaId}`,
          {
            state: {
              returnTo: '/normal/ideas',
              returnLabel: 'My ideas',
            },
          },
        );
      }

      return;
    }

    const runStatus = String(
      idea?.generationRun?.status ??
      '',
    ).toUpperCase();

    if (
      ACTIVE_RUN_STATUSES.has(
        runStatus,
      ) &&
      idea?.generationRun?.id
    ) {
      navigate(
        `/normal/generation/${idea.generationRun.id}`,
      );

      return;
    }

    navigate(
      `/normal/ideas/${idea.id}`,
      {
        state: {
          returnTo: '/normal/ideas',
          returnLabel: 'My ideas',
        },
      },
    );
  }

  /**
   * Deletes a standard idea after user confirmation.
   *
   * Accepted records cannot be deleted from this page.
   *
   * @param {object} idea
   */
  async function handleDelete(idea) {
    if (
      idea?.__libraryKind ===
      'accepted' ||
      idea?.__libraryKind ===
      'published'
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Delete “${idea?.title ||
        'this idea'
        }”? It will be removed from your library.`,
      );

    if (!confirmed) return;

    try {
      await deleteMyIdea(idea.id);

      setItems((current) =>
        current.filter(
          (item) =>
            item.id !== idea.id,
        ),
      );

      setPagination((current) => ({
        ...current,
        total: Math.max(
          0,
          Number(
            current.total ?? 0,
          ) - 1,
        ),
      }));
    } catch (requestError) {
      setError(
        requestError.message ||
        'Unable to delete the idea.',
      );
    }
  }

  /**
   * Adds or removes an owned/accepted idea from the private favorites list.
   *
   * @param {object} idea
   */
  async function handleToggleFavorite(idea) {
    const sourceIdeaId =
      idea?.publication?.ideaId ??
      idea?.id;

    if (!sourceIdeaId) {
      setError('This idea cannot be added to favorites yet.');
      return;
    }

    try {
      setFavoriteProcessingId(sourceIdeaId);
      setError('');

      if (idea?.isFavorite) {
        await removeIdeaFromFavorites(sourceIdeaId);
      } else {
        await addIdeaToFavorites(sourceIdeaId);
      }

      if (filter === 'favorites' && idea?.isFavorite) {
        setItems((current) =>
          current.filter((item) => item !== idea),
        );

        setPagination((current) => ({
          ...current,
          total: Math.max(
            0,
            Number(current.total ?? 0) - 1,
          ),
        }));

        return;
      }

      setItems((current) =>
        current.map((item) =>
          item === idea
            ? {
              ...item,
              isFavorite: !idea?.isFavorite,
            }
            : item,
        ),
      );
    } catch (requestError) {
      setError(
        requestError.message ||
        'The favorite status could not be updated.',
      );
    } finally {
      setFavoriteProcessingId('');
    }
  }

  const isAcceptedView =
    filter === 'accepted';

  const isPublishedView =
    filter === 'published';

  const isFavoritesView =
    filter === 'favorites';

  return (
    <section className="ideas-page reveal-page">
      <header className="ideas-page__header">
        <div>
          <span className="ideas-page__kicker">
            Private workspace
          </span>

          <h1>My ideas</h1>

          <p>
            Review, continue, and
            manage every idea you
            created.
          </p>
        </div>

        <div
          className={`ideas-page__count${isAcceptedView
              ? ' ideas-page__count--accepted'
              : isPublishedView
                ? ' ideas-page__count--published'
                : isFavoritesView
                ? ' ideas-page__count--favorites'
                : ''
            }`}
        >
          {isAcceptedView ? (
            <CheckCircle2 size={18} />
          ) : isPublishedView ? (
            <Globe2 size={18} />
          ) : isFavoritesView ? (
            <Heart size={18} fill="currentColor" />
          ) : (
            <Grid2X2 size={18} />
          )}

          <strong>
            {pagination.total ??
              items.length}
          </strong>

          <span>
            {isAcceptedView
              ? 'accepted'
              : isPublishedView
                ? 'published'
                : isFavoritesView
                ? 'favorites'
                : 'ideas'}
          </span>
        </div>
      </header>

      <div className="ideas-page__toolbar">
        <form
          className="ideas-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);

            setSearch(
              searchInput.trim(),
            );
          }}
        >
          <Search size={18} />

          <input
            value={searchInput}
            onChange={(event) =>
              setSearchInput(
                event.target.value,
              )
            }
            placeholder="Search by title, problem, or domain..."
          />

          <button type="submit">
            Search
          </button>
        </form>

        <div
          className={`ideas-date-filter${fromDate || toDate
              ? ' has-value'
              : ''
            }`}
          aria-label="Creation date range"
        >
          <div className="ideas-date-filter__heading">
            <span>Date range</span>

            {fromDate || toDate ? (
              <button
                className="ideas-date-filter__clear"
                type="button"
                aria-label="Clear selected dates"
                title="Clear selected dates"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setPage(1);
                }}
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="ideas-date-filter__fields">
            <label>
              <span>From</span>

              <input
                type="date"
                value={fromDate}
                max={toDate || today}
                onChange={(event) => {
                  const nextFrom =
                    event.target.value;

                  setFromDate(nextFrom);

                  if (
                    toDate &&
                    nextFrom &&
                    nextFrom > toDate
                  ) {
                    setToDate(nextFrom);
                  }

                  setPage(1);
                }}
              />
            </label>

            <label>
              <span>To</span>

              <input
                type="date"
                value={toDate}
                min={
                  fromDate ||
                  undefined
                }
                max={today}
                onChange={(event) => {
                  const nextTo =
                    event.target.value;

                  setToDate(nextTo);

                  if (
                    fromDate &&
                    nextTo &&
                    nextTo < fromDate
                  ) {
                    setFromDate(nextTo);
                  }

                  setPage(1);
                }}
              />
            </label>
          </div>
        </div>

        <div
          className="ideas-filters"
          aria-label="Idea filters"
        >
          {FILTERS.map((option) => {
            const FilterIcon =
              option.icon;

            return (
              <button
                key={option.value}
                type="button"
                className={`${filter ===
                    option.value
                    ? 'is-active'
                    : ''
                  }${option.value ===
                    'accepted'
                    ? ' is-accepted-filter'
                    : option.value === 'published'
                      ? ' is-published-filter'
                      : option.value === 'favorites'
                      ? ' is-favorites-filter'
                      : ''
                  }`}
                onClick={() =>
                  handleFilterChange(option.value)
                }
              >
                {FilterIcon ? (
                  <FilterIcon
                    size={14}
                    aria-hidden="true"
                  />
                ) : null}

                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {isAcceptedView &&
        !loading &&
        !error ? (
        <div className="ideas-accepted-note">
          <span>
            <CheckCircle2
              size={17}
            />
          </span>

          <div>
            <strong>
              Accepted idea library
            </strong>

            <p>
              These ideas were adopted
              from Discover and are
              ready for their next
              publication or access
              step.
            </p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div
          className="ideas-grid"
          aria-label="Loading ideas"
        >
          {Array.from({
            length: 6,
          }).map((_, index) => (
            <div
              key={index}
              className="idea-skeleton"
            />
          ))}
        </div>
      ) : error ? (
        <div className="ideas-state ideas-state--error">
          <RefreshCw size={28} />

          <h2>
            We could not load your
            ideas
          </h2>

          <p>{error}</p>

          <button
            type="button"
            onClick={() => loadIdeas({ force: true })}
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div
          className={`ideas-state${isAcceptedView
              ? ' ideas-state--accepted'
              : isPublishedView
                ? ' ideas-state--published'
                : ''
            }`}
        >
          {isAcceptedView ? (
            <CheckCircle2 size={30} />
          ) : isPublishedView ? (
            <Globe2 size={30} />
          ) : (
            <Grid2X2 size={30} />
          )}

          <h2>
            {isAcceptedView
              ? 'No accepted ideas yet'
              : isPublishedView
                ? 'No published ideas yet'
                : 'No ideas in this view'}
          </h2>

          <p>
            {isAcceptedView
              ? 'Open Discover, review an opportunity, then choose Accept & continue.'
              : isPublishedView
                ? 'Publish one of your completed ideas and it will appear here.'
                : 'Change the active filter or create a new idea from the Generate page.'}
          </p>

          <button
            type="button"
            onClick={() =>
              navigate(
                isAcceptedView
                  ? '/normal/discover'
                  : isPublishedView
                    ? '/normal/ideas'
                    : '/normal/generate',
              )
            }
          >
            {isAcceptedView
              ? 'Open Discover'
              : isPublishedView
                ? 'View all ideas'
                : 'Go to Generate'}
          </button>
        </div>
      ) : (
        <div className="ideas-grid">
          {items.map((idea) => (
            <IdeaLibraryCard
              key={`${idea.__libraryKind ??
                'idea'
                }-${idea.id}`}
              idea={idea}
              onOpen={() =>
                openIdea(idea)
              }
              onDelete={
                idea.__libraryKind ===
                  'accepted' ||
                idea.__libraryKind ===
                  'published'
                  ? undefined
                  : () =>
                    handleDelete(
                      idea,
                    )
              }
              onToggleFavorite={() =>
                handleToggleFavorite(idea)
              }
              favoriteProcessing={
                favoriteProcessingId ===
                (idea?.publication?.ideaId ?? idea?.id)
              }
            />
          ))}
        </div>
      )}

      {!loading &&
        !error &&
        pagination.totalPages >
        1 && (
          <nav
            className="ideas-pagination"
            aria-label="Ideas pagination"
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() =>
                setPage(
                  (current) =>
                    current - 1,
                )
              }
            >
              <ArrowLeft size={17} />
              Previous
            </button>

            <span>
              Page{' '}
              <strong>{page}</strong>{' '}
              of{' '}
              {pagination.totalPages}
            </span>

            <button
              type="button"
              disabled={
                page >=
                pagination.totalPages
              }
              onClick={() =>
                setPage(
                  (current) =>
                    current + 1,
                )
              }
            >
              Next
              <ArrowRight size={17} />
            </button>
          </nav>
        )}
    </section>
  );
}