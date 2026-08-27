/**
 * Administrator overview dashboard for the web application.
 *
 * The existing overview period selector supports day, week, month, year, and
 * all-time views while retaining the dashboard's current UI and data flow.
 *
 * @author Eman
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Lightbulb,
  RefreshCw,
  Sparkles,
  UsersRound,
  Gauge,
  TrendingUp,
  Zap,
} from 'lucide-react';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-dashboard.css';

const nf = new Intl.NumberFormat('en-US');
const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const money = (value) => moneyFormatter.format(Number(value || 0));
const fmt = (value) => nf.format(Number(value || 0));
const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
    : '—';


const DASHBOARD_SESSION_KEY = 'voxidence:admin-dashboard:snapshot';
const DASHBOARD_SESSION_TTL_MS = 120000;
const DEFAULT_OVERVIEW_PERIOD = 'week';
/** Available administrator overview periods displayed by the existing selector. */
const OVERVIEW_PERIOD_OPTIONS = [
  { value: 'day', label: 'This day' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

const dashboardSessionKey = (period) => `${DASHBOARD_SESSION_KEY}:${period}`;

function readDashboardSnapshot(period = DEFAULT_OVERVIEW_PERIOD) {
  try {
    const raw = window.sessionStorage.getItem(dashboardSessionKey(period));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDashboardSnapshot(data, period = DEFAULT_OVERVIEW_PERIOD) {
  try {
    window.sessionStorage.setItem(dashboardSessionKey(period), JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
  }
}

function Stat({ icon: Icon, label, value, meta, tone = 'mint', featured = false }) {
  return (
    <article className={`admin-stat admin-stat--${tone} ${featured ? 'admin-stat--featured' : ''}`}>
      <div className="admin-stat__topline">
        <span className="admin-stat__icon">
          <Icon size={18} />
        </span>
        <span className="admin-stat__meta">{meta}</span>
      </div>
      <div className="admin-stat__body">
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
      <span className="admin-stat__glow" aria-hidden="true" />
    </article>
  );
}

function StatSkeleton() {
  return (
    <article className="admin-stat admin-stat--skeleton" aria-hidden="true">
      <span className="admin-skeleton admin-skeleton--icon" />
      <span className="admin-skeleton admin-skeleton--value" />
      <span className="admin-skeleton admin-skeleton--label" />
    </article>
  );
}

function ActivityItem({ icon: Icon, title, meta, tone = 'mint' }) {
  return (
    <div className={`admin-activity__item admin-activity__item--${tone}`}>
      <span className="admin-activity__dot">
        <Icon size={15} />
      </span>
      <div>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
    </div>
  );
}

function OverviewHeader({ period, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const activeOption =
    OVERVIEW_PERIOD_OPTIONS.find((option) => option.value === period) ||
    OVERVIEW_PERIOD_OPTIONS[1];

  useEffect(() => {
    if (!open) return undefined;

    const handleClickOutside = (event) => {
      if (!dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleSelect = (value) => {
    setOpen(false);
    if (value !== period) {
      onChange(value);
    }
  };

  return (
    <section className="admin-overview-head">
      <div className="admin-overview-head__title">
        <span className="admin-overview-head__icon">
          <CalendarDays size={18} />
        </span>
        <div>
          <h3>Overview</h3>
          <p>Core platform numbers</p>
        </div>
      </div>

      <div
        ref={dropdownRef}
        className={`admin-overview-period ${loading ? 'is-loading' : ''} ${open ? 'is-open' : ''}`}
      >
        <button
          type="button"
          className="admin-overview-period__trigger"
          onClick={() => !loading && setOpen((current) => !current)}
          disabled={loading}
          aria-label="Change overview period"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{activeOption.label}</span>
          <ChevronDown size={17} aria-hidden="true" />
        </button>

        {open ? (
          <div className="admin-overview-period__menu" role="listbox">
            {OVERVIEW_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={period === option.value}
                className={`admin-overview-period__option ${period === option.value ? 'is-active' : ''
                  }`}
                onClick={() => handleSelect(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DashboardError({ message, onRetry, retrying }) {
  return (
    <section className="admin-dashboard-error" role="alert">
      <span className="admin-dashboard-error__icon">
        <AlertTriangle size={20} />
      </span>
      <div>
        <strong>Dashboard data could not be loaded</strong>
        <p>{message}</p>
        <small>The page will not replace missing server data with fake zero values.</small>
      </div>
      <button
        type="button"
        className="admin-btn admin-btn--primary"
        onClick={onRetry}
        disabled={retrying}
      >
        <RefreshCw size={14} className={retrying ? 'is-spinning' : ''} />
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </section>
  );
}

export default function AdminDashboardPage() {
  const initialSnapshot = useMemo(() => readDashboardSnapshot(DEFAULT_OVERVIEW_PERIOD), []);
  const requestIdRef = useRef(0);
  const overviewPeriodRef = useRef(DEFAULT_OVERVIEW_PERIOD);
  const [data, setData] = useState(initialSnapshot?.data || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialSnapshot?.data);
  const [overviewPeriod, setOverviewPeriod] = useState(DEFAULT_OVERVIEW_PERIOD);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(initialSnapshot?.savedAt ? new Date(initialSnapshot.savedAt) : null);

  const load = useCallback(async ({ background = false, period, fresh = false } = {}) => {
    const requestedPeriod = period || overviewPeriodRef.current;
    const requestId = ++requestIdRef.current;

    if (!background) setLoading(true);
    setError('');

    try {
      const dashboardLoader = fresh ? adminApi.getDashboardFresh : adminApi.getDashboard;
      const response = await dashboardLoader(requestedPeriod);
      if (requestId !== requestIdRef.current) return;
      setData(response);
      setLastUpdatedAt(new Date());
      writeDashboardSnapshot(response, requestedPeriod);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      const isTimeout =
        requestError?.code === 'ECONNABORTED' ||
        /timeout/i.test(requestError?.message || '');

      setError(
        isTimeout
          ? 'The dashboard request took too long. The backend now uses a lighter cached dashboard query; press Retry after restarting the backend with the updated service.'
          : getApiErrorMessage(requestError, 'Could not load the admin dashboard.'),
      );
    } finally {
      if (requestId === requestIdRef.current && !background) setLoading(false);
    }
  }, []);

  const changeOverviewPeriod = useCallback((period) => {
    if (period === overviewPeriodRef.current || loading) return;

    overviewPeriodRef.current = period;
    setOverviewPeriod(period);
    setError('');

    const snapshot = readDashboardSnapshot(period);
    if (snapshot?.data) {
      setData(snapshot.data);
      setLastUpdatedAt(snapshot.savedAt ? new Date(snapshot.savedAt) : null);
    }

    const snapshotAge = snapshot?.savedAt ? Date.now() - snapshot.savedAt : Infinity;
    load({
      background: Boolean(snapshot?.data) && snapshotAge < DASHBOARD_SESSION_TTL_MS,
      period,
    });
  }, [load, loading]);

  useEffect(() => {
    const snapshotAge = initialSnapshot?.savedAt ? Date.now() - initialSnapshot.savedAt : Infinity;
    load({
      background: Boolean(initialSnapshot?.data) && snapshotAge < DASHBOARD_SESSION_TTL_MS,
      period: DEFAULT_OVERVIEW_PERIOD,
    });
  }, [initialSnapshot, load]);

  const chart = useMemo(
    () => (Array.isArray(data?.usersGrowthChart) ? data.usersGrowthChart.slice(-12) : []),
    [data],
  );

  const maxChart = Math.max(1, ...chart.map((point) => Number(point.count || 0)));
  const hasData = Boolean(data);
  const aiSuccess = Number(data?.aiSuccessRate || 0);

  return (
    <div className="admin-page admin-dashboard-page">
      <section className="admin-command-hero">
        <div className="admin-command-hero__copy">
          <div className="admin-hero__eyebrow">
            <Sparkles size={14} /> System intelligence
          </div>
          <h2>Platform Overview</h2>
          <p>
            See the health of Voxidence at a glance — people, ideas, revenue, AI performance and live platform activity in one clear operational view.
          </p>

          <div className="admin-command-hero__chips">
            <span><span className="admin-live-dot" /> Live workspace</span>
            {hasData ? <span><Zap size={13} /> {fmt(data.todayStats?.ideas)} ideas today</span> : null}
            {hasData ? <span><TrendingUp size={13} /> {money(data.todayStats?.revenue)} today</span> : null}
          </div>
        </div>

        <div className="admin-command-hero__visual" aria-hidden={!hasData}>
          <div className="admin-overview-scene">
            <div className="admin-overview-scene__halo admin-overview-scene__halo--one" />
            <div className="admin-overview-scene__halo admin-overview-scene__halo--two" />

            <div className="admin-health-orbit">
              <div className="admin-health-orbit__ring" />
              <div className="admin-health-orbit__core">
                <span className="admin-health-orbit__icon"><BrainCircuit size={24} /></span>
                <strong>{hasData ? `${aiSuccess.toFixed(1)}%` : '—'}</strong>
                <small>AI success</small>
              </div>
              <span className="admin-orbit-node admin-orbit-node--one" />
              <span className="admin-orbit-node admin-orbit-node--two" />
              <span className="admin-orbit-node admin-orbit-node--three" />
            </div>

            <div className="admin-command-hero__mini admin-command-hero__mini--response">
              <Gauge size={16} />
              <div>
                <span>Response</span>
                <strong>{hasData ? `${Number(data.averageResponseTime || 0).toFixed(0)} ms` : '—'}</strong>
              </div>
            </div>

            <div className="admin-command-hero__mini admin-command-hero__mini--users">
              <UsersRound size={16} />
              <div>
                <span>People</span>
                <strong>{hasData ? fmt(data.users) : '—'}</strong>
              </div>
            </div>

            <div className="admin-command-hero__mini admin-command-hero__mini--ideas">
              <Lightbulb size={16} />
              <div>
                <span>Ideas</span>
                <strong>{hasData ? fmt(data.ideas) : '—'}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error && !hasData ? <DashboardError message={error} onRetry={() => load({ fresh: true })} retrying={loading} /> : null}

      {error && hasData ? (
        <div className="admin-error admin-error--inline-refresh">
          <span>{error}</span>
          <button type="button" className="admin-btn" onClick={() => load({ fresh: true })}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : null}

      <OverviewHeader
        period={overviewPeriod}
        onChange={changeOverviewPeriod}
        loading={loading}
      />

      {!hasData && loading ? (
        <section className="admin-stat-grid" aria-label="Loading dashboard">
          {Array.from({ length: 8 }).map((_, index) => <StatSkeleton key={index} />)}
        </section>
      ) : null}

      {hasData ? (
        <>
          <section className="admin-stat-grid admin-stat-grid--mosaic">
            <Stat featured tone="aqua" icon={UsersRound} label="Platform users" value={fmt(data.users)} meta={`${fmt(data.premiumUsers)} premium`} />
            <Stat tone="sage" icon={Lightbulb} label="Generated ideas" value={fmt(data.ideas)} meta={`${fmt(data.unlockedIdeas)} unlocked`} />
            <Stat featured tone="rose" icon={CircleDollarSign} label="Total revenue" value={money(data.revenueTotal)} meta={`${fmt(data.successfulPaymentsCount)} paid`} />
            <Stat tone="mint" icon={BrainCircuit} label="AI success rate" value={`${aiSuccess.toFixed(1)}%`} meta={`${fmt(data.aiRequests)} requests`} />
            <Stat tone="sage" icon={Coins} label="Credits sold" value={fmt(data.creditsSold)} meta={`${money(data.refundsTotal)} refunds`} />
            <Stat tone="aqua" icon={Activity} label="Avg AI response" value={`${Number(data.averageResponseTime || 0).toFixed(0)} ms`} meta={`${money(data.aiCost)} AI cost`} />
            <Stat tone="rose" icon={AlertTriangle} label="Open complaints" value={fmt(data.openComplaints)} meta={`${fmt(data.inProgressComplaints)} in progress`} />
            <Stat tone="mint" icon={Sparkles} label="Generated outputs" value={fmt(data.generatedOutputs)} meta={`${fmt(data.todayStats?.ideas)} today`} />
          </section>

          <section className="admin-dashboard-grid admin-dashboard-grid--insight">
            <article className="admin-panel admin-panel--growth">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">Growth signal</span>
                  <h3>User growth</h3>
                  <p>Recent account creation trend</p>
                </div>
                <div className="admin-dashboard-refresh-group">
                  {lastUpdatedAt ? (
                    <span className="admin-dashboard-updated">
                      Updated {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : null}
                  <button type="button" className="admin-btn admin-btn--soft" onClick={() => load({ fresh: true })} disabled={loading}>
                    <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </header>

              <div className="admin-chart">
                <div className="admin-chart__guide admin-chart__guide--one" />
                <div className="admin-chart__guide admin-chart__guide--two" />
                <div className="admin-chart__bars">
                  {chart.length ? chart.map((point) => {
                    const pointCount = Number(point.count || 0);
                    const isZero = pointCount <= 0;
                    const barHeight = isZero
                      ? '4px'
                      : `${Math.max(8, (pointCount / maxChart) * 100)}%`;

                    return (
                      <div className="admin-chart__column" key={point.date}>
                        <div
                          className={`admin-chart__bar ${isZero ? 'is-zero' : ''}`}
                          title={`${point.date}: ${point.count}`}
                          style={{ height: barHeight }}
                        >
                          <b>{fmt(point.count)}</b>
                        </div>
                        <span>{shortDate(point.date)}</span>
                      </div>
                    );
                  }) : <div className="admin-empty"><p>No chart data yet.</p></div>}
                </div>
              </div>
            </article>

            <article className="admin-panel admin-panel--pulse">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">Right now</span>
                  <h3>Current pulse</h3>
                  <p>Today compared with this month</p>
                </div>
                <span className="admin-pulse-badge"><span className="admin-live-dot" /> Live</span>
              </header>

              <div className="admin-summary-strip admin-summary-strip--cards">
                <article><small>Users today</small><strong>{fmt(data.todayStats?.users)}</strong><span>new accounts</span></article>
                <article><small>Ideas today</small><strong>{fmt(data.todayStats?.ideas)}</strong><span>generated</span></article>
                <article className="is-accent"><small>Revenue today</small><strong>{money(data.todayStats?.revenue)}</strong><span>captured</span></article>
                <article><small>Users this month</small><strong>{fmt(data.monthlyStats?.users)}</strong><span>accounts</span></article>
                <article><small>Ideas this month</small><strong>{fmt(data.monthlyStats?.ideas)}</strong><span>generated</span></article>
                <article className="is-accent"><small>Revenue this month</small><strong>{money(data.monthlyStats?.revenue)}</strong><span>total</span></article>
              </div>
            </article>
          </section>

          <section className="admin-dashboard-grid admin-dashboard-grid--activity">
            <article className="admin-panel admin-panel--activity-list">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">Community</span>
                  <h3>Recent users</h3>
                  <p>Newest registered accounts</p>
                </div>
                <UsersRound size={18} className="admin-panel__head-icon" />
              </header>
              <div className="admin-activity">
                {(data.recentActivity?.recentUsers || []).slice(0, 6).map((item, index) => (
                  <ActivityItem
                    key={item.id}
                    icon={UsersRound}
                    title={item.fullName || item.email}
                    meta={`${item.accountStatus} · ${shortDate(item.createdAt)}`}
                    tone={index === 0 ? 'aqua' : 'mint'}
                  />
                ))}
              </div>
            </article>

            <article className="admin-panel admin-panel--activity-list">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">Operations</span>
                  <h3>Recent system activity</h3>
                  <p>Ideas, payments and complaints</p>
                </div>
                <Activity size={18} className="admin-panel__head-icon" />
              </header>
              <div className="admin-activity admin-activity--timeline">
                {(data.recentActivity?.recentPayments || []).slice(0, 2).map((item) => (
                  <ActivityItem key={item.id} icon={CircleDollarSign} title={`${money(item.amount)} · ${item.paymentPurpose}`} meta={`${item.user?.fullName || item.user?.email || 'User'} · ${item.status}`} tone="aqua" />
                ))}
                {(data.recentActivity?.recentIdeas || []).slice(0, 2).map((item) => (
                  <ActivityItem key={item.id} icon={Lightbulb} title={item.title || 'Generated idea'} meta={`${item.domain?.name || 'No domain'} · ${shortDate(item.createdAt)}`} tone="mint" />
                ))}
                {(data.recentActivity?.recentComplaints || []).slice(0, 2).map((item) => (
                  <ActivityItem key={item.id} icon={AlertTriangle} title={item.subject || 'Complaint'} meta={`${item.priority} · ${item.status}`} tone="rose" />
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}