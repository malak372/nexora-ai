import { useEffect, useMemo, useState } from 'react';
import { Activity, BrainCircuit, Coins, RefreshCw, Sparkles, Timer, TriangleAlert } from 'lucide-react';
import { adminApi, getApiErrorMessage } from '../api/adminApi';
import '../styles/admin-pages.css';

const number = (value) => new Intl.NumberFormat('en-US').format(Number(value || 0));
const money = (value) => `$${Number(value || 0).toFixed(6)}`;

function Metric({ icon: Icon, label, value, note }) {
  return (
    <article className="admin-stat">
      <span className="admin-stat__icon"><Icon size={18} /></span>
      <strong>{value}</strong>
      <small>{label}</small>
      <i>{note}</i>
    </article>
  );
}

export default function AdminAiAnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', providerKey: '' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      setData(await adminApi.aiAnalytics.summary(params));
    } catch (e) {
      setError(getApiErrorMessage(e, 'Could not load AI usage analytics.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const models = useMemo(() => Array.isArray(data?.models) ? data.models : [], [data]);

  return (
    <div className="admin-page">
      <section className="admin-hero">
        <div className="admin-hero__eyebrow"><Sparkles size={14} /> AI economics</div>
        <h2>AI usage analytics</h2>
        <p>Provider attempts, token consumption, fallback behavior, latency, reliability and estimated model cost from the protected AI analytics endpoint.</p>
      </section>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-panel">
        <header className="admin-panel__head">
          <div><h3>Analytics filters</h3><p>Filter the backend aggregation before loading results.</p></div>
          <button className="admin-btn admin-btn--primary" onClick={load} disabled={loading}><RefreshCw size={13} /> {loading ? 'Loading…' : 'Apply'}</button>
        </header>
        <div className="admin-filter-grid">
          <div className="admin-field"><label>From date</label><input type="date" value={filters.fromDate} onChange={(e) => setFilters((old) => ({ ...old, fromDate: e.target.value }))} /></div>
          <div className="admin-field"><label>To date</label><input type="date" value={filters.toDate} onChange={(e) => setFilters((old) => ({ ...old, toDate: e.target.value }))} /></div>
          <div className="admin-field"><label>Provider</label><select value={filters.providerKey} onChange={(e) => setFilters((old) => ({ ...old, providerKey: e.target.value }))}><option value="">All providers</option><option value="google">Google</option><option value="openrouter">OpenRouter</option></select></div>
        </div>
      </section>

      {loading ? <div className="admin-loading"><div className="admin-spinner" /></div> : <>
        <section className="admin-stat-grid">
          <Metric icon={BrainCircuit} label="AI requests" value={number(data?.totalRequests)} note={`${number(data?.successfulRequests)} successful`} />
          <Metric icon={Activity} label="Success rate" value={`${Number(data?.successRate || 0).toFixed(2)}%`} note={`${number(data?.failedRequests)} failed`} />
          <Metric icon={Timer} label="Average latency" value={`${number(data?.averageResponseTimeMs)} ms`} note="Provider response time" />
          <Metric icon={TriangleAlert} label="Fallback attempts" value={number(data?.fallbackAttempts)} note="Fallback model executions" />
          <Metric icon={Coins} label="Input tokens" value={number(data?.totalInputTokens)} note="Across matching attempts" />
          <Metric icon={Coins} label="Output tokens" value={number(data?.totalOutputTokens)} note="Across matching attempts" />
          <Metric icon={Sparkles} label="Estimated AI cost" value={money(data?.totalCost)} note="Backend-calculated cost" />
        </section>

        <section className="admin-panel">
          <header className="admin-panel__head"><div><h3>Model usage</h3><p>Per-model performance and spend.</p></div></header>
          {models.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Model</th><th>Provider</th><th>Requests</th><th>Success</th><th>Failed</th><th>Latency</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>{models.map((item, index) => <tr key={item.aiModelId || index}><td><strong>{item.model?.modelName || item.model?.apiModelId || 'Unmapped model'}</strong></td><td>{item.model?.providerKey || '—'}</td><td>{number(item.requests)}</td><td>{number(item.successfulRequests)}</td><td>{number(item.failedRequests)}</td><td>{number(item.averageResponseTimeMs)} ms</td><td>{number(Number(item.inputTokens || 0) + Number(item.outputTokens || 0))}</td><td>{money(item.cost)}</td></tr>)}</tbody></table></div> : <div className="admin-empty"><p>No model usage is available for this filter.</p></div>}
        </section>
      </>}
    </div>
  );
}