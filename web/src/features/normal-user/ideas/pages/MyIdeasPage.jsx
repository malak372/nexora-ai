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
import { workspacePath } from '../../shared/utils/workspacePath';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Grid2X2,
  Globe2,
  Heart,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { warmIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';
import {
  preloadDiscoveryDetail,
  preloadIdeaWorkspace,
} from '../../../../routes/routePreloaders';
import { useUserExperience } from '../../../../system/user-experience';
import NormalPageHero from '../../shared/components/NormalPageHero';
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
 * Converts a date-input value into the exact inclusive boundaries expected by
 * the backend date filters. Keeping the conversion local preserves the user's
 * timezone while still sending an unambiguous ISO timestamp.
 */
function toStartOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function toEndOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T23:59:59.999`).toISOString();
}

/**
 * Returns at most five consecutive page numbers around the active page.
 * Examples: 1..5, 3..7, 8..12. This keeps the control stable while the user
 * moves through a long library.
 */
function getPaginationWindow(currentPage, totalPages, windowSize = 5) {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const safeCurrent = Math.min(
    safeTotal,
    Math.max(1, Number(currentPage) || 1),
  );
  const size = Math.min(windowSize, safeTotal);
  const half = Math.floor(size / 2);

  let start = safeCurrent - half;
  start = Math.max(1, Math.min(start, safeTotal - size + 1));

  return Array.from({ length: size }, (_, index) => start + index);
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
 * Opens the browser date picker from the full field, while allowing a custom
 * calendar icon to stay visible in both light and dark mode.
 *
 * @param {React.MouseEvent<HTMLInputElement>} event
 */
function openDatePicker(event) {
  const input = event.currentTarget;

  if (typeof input?.showPicker !== 'function') return;

  try {
    input.showPicker();
  } catch {
    // Safari/Firefox may rely on their native click behaviour instead.
  }
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
  const { language, t } = useUserExperience();
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
  const [isRefreshing, setIsRefreshing] =
    useState(false);

  const hasRenderedDataRef = useRef(false);

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

    if (fromDate) {
      params.fromDate = toStartOfDayIso(fromDate);
    }

    if (toDate) {
      params.toDate = toEndOfDayIso(toDate);
    }

    return params;
  }, [filter, fromDate, page, search, toDate]);

  /**
   * Loads ideas for the selected filter, date range, and page.
   */
  const loadIdeas = useCallback(async ({ force = false } = {}) => {
    // Keep existing cards visible while switching filters. Only the first visit
    // blocks on the full skeleton.
    if (hasRenderedDataRef.current) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const hasDateRange = Boolean(fromDate || toDate);

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

        hasRenderedDataRef.current = true;
        return;
      }

      if (filter === 'published') {
        const publishedParams = {
          search: search || undefined,
          status: 'PUBLISHED',
          sortBy: 'publishedAt',
          sortOrder: 'desc',
          fromDate: toStartOfDayIso(fromDate),
          toDate: toEndOfDayIso(toDate),
        };

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

        hasRenderedDataRef.current = true;
        return;
      }

      if (filter === 'accepted') {
        const acceptedParams = {
          search: search || undefined,
          sortBy: 'acceptedAt',
          sortOrder: 'desc',
          fromDate: toStartOfDayIso(fromDate),
          toDate: toEndOfDayIso(toDate),
        };

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

        hasRenderedDataRef.current = true;
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
      hasRenderedDataRef.current = true;
    } catch (requestError) {
      setError(
        requestError.message ||
        'Unable to load ideas.',
      );
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [
    filter,
    fromDate,
    page,
    queryParams,
    search,
    toDate,
  ]);

  /**
   * Prefetches the filter the user is about to open. Matching requests are
   * deduplicated by requestCache, so the click reuses this exact promise.
   */
  const warmFilter = useCallback((nextFilter) => {
    if (!FILTERS.some((item) => item.value === nextFilter)) return;

    const base = {
      page: 1,
      limit: PAGE_SIZE,
      search: search || undefined,
      fromDate: toStartOfDayIso(fromDate),
      toDate: toEndOfDayIso(toDate),
    };

    if (nextFilter === 'favorites') {
      void getMyFavoriteIdeas().catch(() => undefined);
      return;
    }

    if (nextFilter === 'published') {
      void getMyPublishedIdeas({
        ...base,
        status: 'PUBLISHED',
        sortBy: 'publishedAt',
        sortOrder: 'desc',
      }).catch(() => undefined);
      return;
    }

    if (nextFilter === 'accepted') {
      void getAcceptedPublications({
        ...base,
        sortBy: 'acceptedAt',
        sortOrder: 'desc',
      }).catch(() => undefined);
      return;
    }

    const params = {
      ...base,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };

    if (nextFilter === 'unlocked') params.isUnlocked = true;
    if (nextFilter === 'core') params.isUnlocked = false;

    void getMyIdeas(params).catch(() => undefined);
  }, [fromDate, search, toDate]);

  /**
   * Warm only the cheap Free/Unlocked variants after the first My Ideas data
   * arrives. Published/Accepted/Favorites stay intent-driven to avoid a burst
   * of unrelated API calls.
   */
  useEffect(() => {
    if (!hasRenderedDataRef.current) return undefined;

    let cancelled = false;
    const timers = [];

    const warmCommonFilters = () => {
      ['core', 'unlocked'].forEach((value, index) => {
        const timer = window.setTimeout(() => {
          if (!cancelled && filter !== value) warmFilter(value);
        }, index * 250);
        timers.push(timer);
      });
    };

    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(warmCommonFilters, {
        timeout: 1500,
      });

      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleId);
        timers.forEach((timer) => window.clearTimeout(timer));
      };
    }

    const timer = window.setTimeout(warmCommonFilters, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      timers.forEach((entry) => window.clearTimeout(entry));
    };
  }, [filter, loading, warmFilter]);

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


  function warmIdea(idea) {
    if (idea?.__libraryKind === 'accepted') {
      const publicationId = idea?.publication?.id;
      if (publicationId) preloadDiscoveryDetail(publicationId);
      return;
    }

    const runStatus = String(idea?.generationRun?.status ?? '').toUpperCase();
    if (ACTIVE_RUN_STATUSES.has(runStatus)) return;

    const ideaId = idea?.publication?.ideaId ?? idea?.id;
    if (ideaId) {
      warmIdeaWorkspace(ideaId);
      preloadIdeaWorkspace(ideaId);
    }
  }

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
            ? workspacePath(`/normal/accepted/${publicationId}/workspace`)
            : workspacePath(`/normal/discover/${publicationId}`),
          {
            state: {
              publicationSeed: idea?.publication ?? null,
              acceptanceSeed: idea?.acceptance ?? null,
            },
          },
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
          workspacePath(`/normal/ideas/${ideaId}`),
          {
            state: {
              returnTo: workspacePath('/normal/ideas'),
              returnLabel: 'My ideas',
              ideaSeed: {
                ...idea,
                id: ideaId,
              },
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
        workspacePath(`/normal/generation/${idea.generationRun.id}`),
      );

      return;
    }

    navigate(
      workspacePath(`/normal/ideas/${idea.id}`),
      {
        state: {
          returnTo: workspacePath('/normal/ideas'),
          returnLabel: 'My ideas',
          ideaSeed: idea,
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

    const ideaTitle = idea?.title || t('this idea');
    const confirmed = window.confirm(
      language === 'ar'
        ? `${t('Delete idea')} “${ideaTitle}”؟ ${t('It will be removed from your library.')}`
        : `Delete “${ideaTitle}”? It will be removed from your library.`,
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

  const visiblePageNumbers = useMemo(
    () => getPaginationWindow(page, pagination.totalPages, 5),
    [page, pagination.totalPages],
  );

  useEffect(() => {
    const safeTotalPages = Math.max(1, Number(pagination.totalPages) || 1);
    if (page > safeTotalPages) setPage(safeTotalPages);
  }, [page, pagination.totalPages]);

  return (
    <section className="ideas-page reveal-page" aria-busy={loading || isRefreshing}>
      <NormalPageHero
        variant="ideas"
        eyebrow={t('Private idea library')}
        title={t('My ideas, organized around your next move.')}
        description={t('Return to every generated direction, keep favorites close, continue accepted work, and manage publication progress from one private workspace.')}
        chips={[t('Created by you'), t('Favorites in one place'), t('Publication-ready workspace')]}
        stats={[{
          label: t(isAcceptedView ? 'Accepted' : isPublishedView ? 'Published' : isFavoritesView ? 'Favorites' : 'Ideas'),
          value: pagination.total ?? items.length,
        }]}
        compact
      />

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
            placeholder={t('Search by title, problem, or domain...')}
          />

          <button type="submit">
            {t('Search')}
          </button>
        </form>

        <div
          className={`ideas-date-filter${fromDate || toDate
            ? ' has-value'
            : ''
            }`}
          aria-label={t('Creation date range')}
        >
          <div className="ideas-date-filter__heading">
            <span>{t('Date range')}</span>

            {fromDate || toDate ? (
              <button
                className="ideas-date-filter__clear"
                type="button"
                aria-label={t('Clear selected dates')}
                title={t('Clear selected dates')}
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
              <span>{t('From')}</span>

              <div className="ideas-date-filter__input-wrap">
                <input
                  type="date"
                  lang={language === 'ar' ? 'ar' : 'en'}
                  dir={language === 'ar' ? 'rtl' : 'ltr'}
                  value={fromDate}
                  max={toDate || today}
                  onClick={openDatePicker}
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
                <CalendarDays
                  className="ideas-date-filter__calendar-icon"
                  size={14}
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
              </div>
            </label>

            <label>
              <span>{t('To')}</span>

              <div className="ideas-date-filter__input-wrap">
                <input
                  type="date"
                  lang={language === 'ar' ? 'ar' : 'en'}
                  dir={language === 'ar' ? 'rtl' : 'ltr'}
                  value={toDate}
                  min={
                    fromDate ||
                    undefined
                  }
                  max={today}
                  onClick={openDatePicker}
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
                <CalendarDays
                  className="ideas-date-filter__calendar-icon"
                  size={14}
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
              </div>
            </label>
          </div>
        </div>

        <div
          className="ideas-filters"
          aria-label={t('Idea filters')}
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
                onPointerEnter={() => warmFilter(option.value)}
                onFocus={() => warmFilter(option.value)}
                onPointerDown={() => warmFilter(option.value)}
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

                {t(option.label)}
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
            <strong>{t('Accepted idea library')}</strong>

            <p>{t('These ideas were adopted from Discover and are ready for their next publication or access step.')}</p>
          </div>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div
          className="ideas-grid"
          aria-label={t('Loading ideas')}
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
      ) : error && items.length === 0 ? (
        <div className="ideas-state ideas-state--error">
          <RefreshCw size={28} />

          <h2>{t('We could not load your ideas')}</h2>

          <p>{t(error)}</p>

          <button
            type="button"
            onClick={() => loadIdeas({ force: true })}
          >
            {t('Try again')}
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
            {t(isAcceptedView
              ? 'No accepted ideas yet'
              : isPublishedView
                ? 'No published ideas yet'
                : 'No ideas in this view')}
          </h2>

          <p>
            {t(isAcceptedView
              ? 'Open Discover, review an opportunity, then choose Accept & continue.'
              : isPublishedView
                ? 'Publish one of your completed ideas and it will appear here.'
                : 'Change the active filter or create a new idea from the Generate page.')}
          </p>

          <button
            type="button"
            onClick={() =>
              navigate(
                isAcceptedView
                  ? workspacePath('/normal/discover')
                  : isPublishedView
                    ? workspacePath('/normal/ideas')
                    : workspacePath('/normal/generate'),
              )
            }
          >
            {t(isAcceptedView
              ? 'Open Discover'
              : isPublishedView
                ? 'View all ideas'
                : 'Go to Generate')}
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
              onWarm={() =>
                warmIdea(idea)
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
            aria-label={t('Ideas pagination')}
          >
            <button
              type="button"
              className="ideas-pagination__nav ideas-pagination__nav--previous"
              disabled={page <= 1}
              onClick={() =>
                setPage(
                  (current) =>
                    Math.max(1, current - 1),
                )
              }
            >
              <ArrowLeft size={17} />
              {t('Previous')}
            </button>

            <div className="ideas-pagination__pages" aria-label={t('Page numbers')}>
              {visiblePageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={`ideas-pagination__page${pageNumber === page ? ' is-active' : ''}`}
                  aria-current={pageNumber === page ? 'page' : undefined}
                  aria-label={`${t('Page')} ${pageNumber}`}
                  onClick={() => setPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="ideas-pagination__nav ideas-pagination__nav--next"
              disabled={
                page >=
                pagination.totalPages
              }
              onClick={() =>
                setPage(
                  (current) =>
                    Math.min(pagination.totalPages, current + 1),
                )
              }
            >
              {t('Next')}
              <ArrowRight size={17} />
            </button>
          </nav>
        )}
    </section>
  );
}