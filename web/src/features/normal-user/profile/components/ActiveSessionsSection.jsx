/**
 * Displays active account sessions grouped by device, browser, and IP.
 *
 * @author Malak
 */
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Laptop2,
  Layers3,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getMySessions,
  revokeAllMySessions,
  revokeMySession,
} from '../api/sessionsApi';

const GROUPS_PER_PAGE = 4;

function describeUserAgent(userAgent = '') {
  const normalized = String(userAgent);
  const platform = /iPhone/i.test(normalized) ? 'iPhone' : /iPad/i.test(normalized) ? 'iPad' : /Android/i.test(normalized) ? 'Android' : /Windows/i.test(normalized) ? 'Windows' : /Macintosh|Mac OS X/i.test(normalized) ? 'macOS' : /Linux/i.test(normalized) ? 'Linux' : 'Unknown device';
  const browser = /Edg\//i.test(normalized) ? 'Microsoft Edge' : /OPR\//i.test(normalized) ? 'Opera' : /Chrome\//i.test(normalized) ? 'Google Chrome' : /Firefox\//i.test(normalized) ? 'Mozilla Firefox' : /Safari\//i.test(normalized) ? 'Safari' : 'Web browser';
  const kind = /iPad|Tablet/i.test(normalized) ? 'tablet' : /Mobile|iPhone|Android/i.test(normalized) ? 'mobile' : 'desktop';
  return { platform, browser, kind, label: `${browser} on ${platform}` };
}

function activityTime(session) {
  return new Date(session.lastActiveAt || session.lastUsedAt || session.createdAt || 0).getTime();
}

function groupSessions(sessions) {
  const groups = new Map();
  sessions.forEach((session) => {
    const device = describeUserAgent(session.userAgent);
    const key = [device.label, session.ipAddress || 'unknown-ip'].join('::');
    const existing = groups.get(key) || { key, device, ipAddress: session.ipAddress, sessions: [] };
    existing.sessions.push(session);
    groups.set(key, existing);
  });

  return [...groups.values()].map((group) => {
    group.sessions.sort((a, b) => activityTime(b) - activityTime(a));
    return { ...group, latest: group.sessions[0], count: group.sessions.length };
  }).sort((a, b) => activityTime(b.latest) - activityTime(a.latest));
}

function formatActivity(value) {
  if (!value) return 'Activity unavailable';
  const date = new Date(value);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return 'Active just now';
  if (minutes < 60) return `Active ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours} hr ago`;
  return `Active ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }).format(date)}`;
}

function DeviceIcon({ kind }) {
  if (kind === 'mobile') return <Smartphone size={22} />;
  if (kind === 'tablet') return <Tablet size={22} />;
  return <Laptop2 size={22} />;
}

export default function ActiveSessionsSection({ onSignedOutEverywhere }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await getMySessions();
      setSessions(result?.items ?? result ?? []);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Unable to load active sessions.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const groupedSessions = useMemo(() => groupSessions(sessions), [sessions]);
  const totalPages = Math.max(1, Math.ceil(groupedSessions.length / GROUPS_PER_PAGE));
  const visibleGroups = useMemo(() => groupedSessions.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE), [groupedSessions, page]);

  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  async function revokeGroup(group) {
    const confirmed = window.confirm(`Sign out ${group.device.label}? ${group.count > 1 ? `This revokes ${group.count} active sessions from the same device and location.` : 'Its refresh token will be revoked immediately.'}`);
    if (!confirmed) return;
    setBusyId(group.key); setError(''); setNotice('');
    try {
      await Promise.all(group.sessions.map((session) => revokeMySession(session.id)));
      const revokedIds = new Set(group.sessions.map((session) => session.id));
      setSessions((current) => current.filter((session) => !revokedIds.has(session.id)));
      setNotice(`${group.device.label} was signed out successfully.`);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Unable to revoke this device.');
      await load();
    } finally { setBusyId(''); }
  }

  async function revokeAll() {
    if (!window.confirm('Sign out from every device? You will need to log in again.')) return;
    setBusyId('all'); setError(''); setNotice('');
    try {
      await revokeAllMySessions(); setSessions([]); setNotice('All active sessions were revoked.'); onSignedOutEverywhere?.();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Unable to revoke all sessions.');
    } finally { setBusyId(''); }
  }

  return (
    <section className="profile-sessions">
      <header className="profile-sessions__header">
        <div className="profile-sessions__icon"><MonitorSmartphone size={24} /></div>
        <div><span>ACCOUNT SECURITY</span><h2>Active sessions & devices</h2><p>Repeated sessions from the same browser and location are grouped together, with the latest active session shown first.</p></div>
        <div className="profile-sessions__summary"><small>ACTIVE</small><strong>{sessions.length}</strong><span>{groupedSessions.length} devices</span></div>
      </header>

      <div className="profile-sessions__trust">
        <span><ShieldCheck size={16} /> Refresh-token protected</span>
        <span><Layers3 size={16} /> Duplicate sessions grouped</span>
        <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'profile-settings__spin' : ''} size={16} />Refresh</button>
      </div>

      {loading ? <div className="profile-sessions__state"><LoaderCircle className="profile-settings__spin" /><strong>Loading active sessions</strong></div>
      : error ? <div className="profile-sessions__state profile-sessions__state--error"><ShieldCheck /><strong>Sessions unavailable</strong><p>{error}</p></div>
      : groupedSessions.length === 0 ? <div className="profile-sessions__state"><CheckCircle2 /><strong>No active refresh sessions</strong><p>New sessions will appear after the next successful login.</p></div>
      : <div className="profile-sessions__list">
          {visibleGroups.map((group, index) => {
            const session = group.latest;
            return <article key={group.key} className="profile-session-card">
              <div className="profile-session-card__device"><DeviceIcon kind={group.device.kind} /><span className="profile-session-card__pulse" /></div>
              <div className="profile-session-card__copy">
                <div><strong>{group.device.label}</strong>{page === 1 && index === 0 ? <b>Most recent</b> : null}{group.count > 1 ? <b className="profile-session-card__count">{group.count} sessions</b> : null}</div>
                <p><Globe2 size={14} />{group.ipAddress || 'IP unavailable'}</p>
                <span>{formatActivity(session.lastActiveAt || session.lastUsedAt || session.createdAt)} {' · '} Expires {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(session.expiresAt))}</span>
              </div>
              <button type="button" disabled={busyId === group.key || busyId === 'all'} onClick={() => revokeGroup(group)}>{busyId === group.key ? <LoaderCircle className="profile-settings__spin" size={16} /> : <LogOut size={16} />}Sign out</button>
            </article>;
          })}
        </div>}

      {notice ? <p className="profile-sessions__notice"><CheckCircle2 size={16} />{notice}</p> : null}

      {groupedSessions.length > GROUPS_PER_PAGE ? <nav className="profile-sessions__pagination" aria-label="Sessions pagination">
        <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} />Previous</button>
        <span>Page <strong>{page}</strong> of {totalPages}</span>
        <button type="button" disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight size={16} /></button>
      </nav> : null}

      {sessions.length > 0 ? <footer className="profile-sessions__footer">
        <div><Trash2 size={18} /><span><strong>Sign out everywhere</strong><small>Revokes every active refresh token on the account.</small></span></div>
        <button type="button" disabled={busyId === 'all'} onClick={revokeAll}>{busyId === 'all' ? <LoaderCircle className="profile-settings__spin" size={16} /> : <LogOut size={16} />}Revoke all sessions</button>
      </footer> : null}
    </section>
  );
}