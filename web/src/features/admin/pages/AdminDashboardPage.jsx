import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CircleDollarSign,
  Coins,
  Lightbulb,
  RefreshCw,
  Sparkles,
  UsersRound,
} from 'lucide-react';

import { adminApi, getApiErrorMessage } from '../api/adminApi';
import '../styles/admin-pages.css';

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

function Stat({ icon: Icon, label, value, meta }) {
  return (
    <article className="admin-stat">
      <span className="admin-stat__icon">
        <Icon size={18} />
      </span>
      <strong>{value}</strong>
      <small>{label}</small>
      <i>{meta}</i>
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

function ActivityItem({ icon: Icon, title, meta }) {
  return (
    <div className="admin-activity__item">
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

function DashboardError({ message, onRetry, retrying }) {
  return (
    <section className="admin-dashboard-error" role="alert">
      <span className="admin-dashboard-error__icon">
        <AlertTriangle size={20} />
      </span>
      <div>
        <strong>Dashboard data could not be loaded</strong>
        <p>{message}</p>
        <small>
          The page will not replace missing server data with fake zero values.
        </small>
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
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminApi.getDashboard();
      setData(response);
      setLastUpdatedAt(new Date());
    } catch (requestError) {
      const isTimeout =
        requestError?.code === 'ECONNABORTED' ||
        /timeout/i.test(requestError?.message || '');

      setError(
        isTimeout
          ? 'The dashboard request took too long. The backend now uses a lighter cached dashboard query; press Retry after restarting the backend with the updated service.'
          : getApiErrorMessage(
              requestError,
              'Could not load the admin dashboard.',
            ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chart = useMemo(
    () =>
      Array.isArray(data?.usersGrowthChart)
        ? data.usersGrowthChart.slice(-12)
        : [],
    [data],
  );
  const maxChart = Math.max(
    1,
    ...chart.map((point) => Number(point.count || 0)),
  );

  const hasData = Boolean(data);

  return (
    <div className="admin-page">
      <section className="admin-hero">
        <div className="admin-hero__eyebrow">
          <Sparkles size={14} /> System intelligence
        </div>
        <h2>Everything important, in one view.</h2>
        <p>
          Live operational health across users, ideas, payments, community
          signals, AI requests and support workload.
        </p>
      </section>

      {error && !hasData ? (
        <DashboardError
          message={error}
          onRetry={load}
          retrying={loading}
        />
      ) : null}

      {error && hasData ? (
        <div className="admin-error admin-error--inline-refresh">
          <span>{error}</span>
          <button type="button" className="admin-btn" onClick={load}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : null}

      {!hasData && loading ? (
        <section className="admin-stat-grid" aria-label="Loading dashboard">
          {Array.from({ length: 8 }).map((_, index) => (
            <StatSkeleton key={index} />
          ))}
        </section>
      ) : null}

      {hasData ? (
        <>
          <section className="admin-stat-grid">
            <Stat
              icon={UsersRound}
              label="Platform users"
              value={fmt(data.users)}
              meta={`${fmt(data.premiumUsers)} premium`}
            />
            <Stat
              icon={Lightbulb}
              label="Generated ideas"
              value={fmt(data.ideas)}
              meta={`${fmt(data.unlockedIdeas)} unlocked`}
            />
            <Stat
              icon={CircleDollarSign}
              label="Total revenue"
              value={money(data.revenueTotal)}
              meta={`${fmt(data.successfulPaymentsCount)} paid`}
            />
            <Stat
              icon={BrainCircuit}
              label="AI success rate"
              value={`${Number(data.aiSuccessRate || 0).toFixed(1)}%`}
              meta={`${fmt(data.aiRequests)} requests`}
            />
            <Stat
              icon={Coins}
              label="Credits sold"
              value={fmt(data.creditsSold)}
              meta={`${money(data.refundsTotal)} refunds`}
            />
            <Stat
              icon={Activity}
              label="Avg AI response"
              value={`${Number(data.averageResponseTime || 0).toFixed(0)} ms`}
              meta={`${money(data.aiCost)} AI cost`}
            />
            <Stat
              icon={AlertTriangle}
              label="Open complaints"
              value={fmt(data.openComplaints)}
              meta={`${fmt(data.inProgressComplaints)} in progress`}
            />
            <Stat
              icon={Sparkles}
              label="Generated outputs"
              value={fmt(data.generatedOutputs)}
              meta={`${fmt(data.todayStats?.ideas)} today`}
            />
          </section>

          <section className="admin-dashboard-grid">
            <article className="admin-panel">
              <header className="admin-panel__head">
                <div>
                  <h3>User growth</h3>
                  <p>Recent account creation trend</p>
                </div>
                <div className="admin-dashboard-refresh-group">
                  {lastUpdatedAt ? (
                    <span className="admin-dashboard-updated">
                      Updated{' '}
                      {lastUpdatedAt.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={load}
                    disabled={loading}
                  >
                    <RefreshCw
                      size={14}
                      className={loading ? 'is-spinning' : ''}
                    />
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </header>

              <div className="admin-chart">
                <div className="admin-chart__bars">
                  {chart.length ? (
                    chart.map((point) => (
                      <div
                        key={point.date}
                        className="admin-chart__bar"
                        title={`${point.date}: ${point.count}`}
                        style={{
                          height: `${Math.max(
                            8,
                            (Number(point.count || 0) / maxChart) * 100,
                          )}%`,
                        }}
                      >
                        <span>{shortDate(point.date)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="admin-empty">
                      <p>No chart data yet.</p>
                    </div>
                  )}
                </div>
              </div>
            </article>

            <article className="admin-panel">
              <header className="admin-panel__head">
                <div>
                  <h3>Current pulse</h3>
                  <p>Today compared with this month</p>
                </div>
              </header>
              <div className="admin-summary-strip">
                <article>
                  <small>Users today</small>
                  <strong>{fmt(data.todayStats?.users)}</strong>
                </article>
                <article>
                  <small>Ideas today</small>
                  <strong>{fmt(data.todayStats?.ideas)}</strong>
                </article>
                <article>
                  <small>Revenue today</small>
                  <strong>{money(data.todayStats?.revenue)}</strong>
                </article>
                <article>
                  <small>Users this month</small>
                  <strong>{fmt(data.monthlyStats?.users)}</strong>
                </article>
                <article>
                  <small>Ideas this month</small>
                  <strong>{fmt(data.monthlyStats?.ideas)}</strong>
                </article>
                <article>
                  <small>Revenue this month</small>
                  <strong>{money(data.monthlyStats?.revenue)}</strong>
                </article>
              </div>
            </article>
          </section>

          <section className="admin-dashboard-grid">
            <article className="admin-panel">
              <header className="admin-panel__head">
                <div>
                  <h3>Recent users</h3>
                  <p>Newest registered accounts</p>
                </div>
              </header>
              <div className="admin-activity">
                {(data.recentActivity?.recentUsers || [])
                  .slice(0, 6)
                  .map((item) => (
                    <ActivityItem
                      key={item.id}
                      icon={UsersRound}
                      title={item.fullName || item.email}
                      meta={`${item.accountStatus} · ${shortDate(
                        item.createdAt,
                      )}`}
                    />
                  ))}
              </div>
            </article>

            <article className="admin-panel">
              <header className="admin-panel__head">
                <div>
                  <h3>Recent system activity</h3>
                  <p>Ideas, payments and complaints</p>
                </div>
              </header>
              <div className="admin-activity">
                {(data.recentActivity?.recentPayments || [])
                  .slice(0, 2)
                  .map((item) => (
                    <ActivityItem
                      key={item.id}
                      icon={CircleDollarSign}
                      title={`${money(item.amount)} · ${item.paymentPurpose}`}
                      meta={`${
                        item.user?.fullName || item.user?.email || 'User'
                      } · ${item.status}`}
                    />
                  ))}
                {(data.recentActivity?.recentIdeas || [])
                  .slice(0, 2)
                  .map((item) => (
                    <ActivityItem
                      key={item.id}
                      icon={Lightbulb}
                      title={item.title || 'Generated idea'}
                      meta={`${item.domain?.name || 'No domain'} · ${shortDate(
                        item.createdAt,
                      )}`}
                    />
                  ))}
                {(data.recentActivity?.recentComplaints || [])
                  .slice(0, 2)
                  .map((item) => (
                    <ActivityItem
                      key={item.id}
                      icon={AlertTriangle}
                      title={item.subject || 'Complaint'}
                      meta={`${item.priority} · ${item.status}`}
                    />
                  ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}