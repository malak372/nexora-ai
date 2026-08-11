import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import AdminSensitiveAccessGate from '../../shared/components/AdminSensitiveAccessGate';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-administrators.css';

const ADMINISTRATORS_SCOPE = 'ADMINISTRATORS';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInvitationRequestError(requestError) {
  if (requestError?.code === 'ERR_NETWORK') {
    return 'The secure invitation service could not be reached. Please make sure the backend is running, then try again.';
  }

  if (requestError?.code === 'ECONNABORTED') {
    return 'Email delivery is taking longer than expected. Please try again in a moment.';
  }

  return getApiErrorMessage(
    requestError,
    'Could not send the administrator invitation.',
  );
}

function InviteAdministratorModal({
  open,
  form,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
}) {
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-admin-invite-layer" role="presentation">
      <div
        className="admin-admin-invite-backdrop"
        onMouseDown={busy ? undefined : onClose}
      />

      <form
        className="admin-admin-invite-modal"
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-invite-title"
      >
        <div className="admin-admin-invite-modal__accent" />

        <header className="admin-admin-invite-modal__header">
          <div className="admin-admin-invite-modal__mark">
            <UserRoundCog size={23} />
          </div>
          <button
            type="button"
            className="admin-admin-invite-modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close invitation dialog"
          >
            <X size={17} />
          </button>
        </header>

        <div className="admin-admin-invite-modal__copy">
          <span><ShieldCheck size={12} /> STAFF ACCESS</span>
          <h2 id="admin-invite-title">Invite a new administrator</h2>
          <p>
            Send a private one-time invitation to a trusted staff member. The
            recipient creates their own password after verifying the invitation.
          </p>
        </div>

        <div className="admin-admin-invite-modal__fields">
          <label>
            <span>Full name</span>
            <div>
              <UserRoundCog size={16} />
              <input
                value={form.fullName}
                onChange={(event) => onChange('fullName', event.target.value)}
                placeholder="Administrator name"
                autoComplete="name"
                disabled={busy}
                required
              />
            </div>
          </label>

          <label>
            <span>Email address</span>
            <div>
              <Mail size={16} />
              <input
                type="email"
                value={form.email}
                onChange={(event) => onChange('email', event.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                disabled={busy}
                required
              />
            </div>
          </label>
        </div>

        <div className="admin-admin-invite-modal__security-note">
          <ShieldCheck size={17} />
          <span>
            <strong>Administrator-only identity</strong>
            <small>
              The new account receives the ADMIN role with no customer plan,
              credits, or free-generation entitlement.
            </small>
          </span>
        </div>

        {error ? (
          <div className="admin-admin-invite-modal__error">
            <XCircle size={15} />
            <span>{error}</span>
          </div>
        ) : null}

        <footer className="admin-admin-invite-modal__footer">
          <button
            type="button"
            className="admin-admin-invite-modal__cancel"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="admin-admin-invite-modal__submit"
            disabled={busy || !form.fullName.trim() || !form.email.trim()}
          >
            <span className="admin-admin-invite-modal__submit-icon">
              {busy ? (
                <LoaderCircle className="admin-spin" size={17} />
              ) : (
                <Send size={17} />
              )}
            </span>
            <span className="admin-admin-invite-modal__submit-copy">
              <strong>{busy ? 'Sending invitation…' : 'Send invitation'}</strong>
              <small>{busy ? 'Preparing the secure email' : 'Email a one-time access code'}</small>
            </span>
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

export default function AdminAdministratorsPage() {
  const [accessToken, setAccessToken] = useState('');
  const [data, setData] = useState({
    administrators: [],
    invitations: [],
    summary: {},
  });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState('administrators');
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ fullName: '', email: '' });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [actionId, setActionId] = useState('');

  const lockWorkspace = useCallback(() => {
    setAccessToken('');
    setData({ administrators: [], invitations: [], summary: {} });
    setInviteOpen(false);
    setError('');
  }, []);

  const load = useCallback(async ({ quiet = false, token = accessToken } = {}) => {
    if (!token) return;

    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const payload = await adminApi.administrators.workspace(token);
      setData({
        administrators: Array.isArray(payload?.administrators)
          ? payload.administrators
          : [],
        invitations: Array.isArray(payload?.invitations)
          ? payload.invitations
          : [],
        summary: payload?.summary || {},
      });
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }
      setError(
        getApiErrorMessage(
          requestError,
          'Could not load the administration team.',
        ),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, lockWorkspace]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const currentAdmin = useMemo(
    () => data.administrators.find((item) => item.isCurrent),
    [data.administrators],
  );

  const verifiedCount = useMemo(
    () => data.administrators.filter((item) => item.isVerified).length,
    [data.administrators],
  );

  const normalizedSearch = search.trim().toLowerCase();

  const filteredAdministrators = useMemo(() => {
    if (!normalizedSearch) return data.administrators;
    return data.administrators.filter((item) =>
      [item.fullName, item.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
    );
  }, [data.administrators, normalizedSearch]);

  const filteredInvitations = useMemo(() => {
    if (!normalizedSearch) return data.invitations;
    return data.invitations.filter((item) =>
      [item.fullName, item.email, item.invitedBy?.fullName, item.invitedBy?.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
    );
  }, [data.invitations, normalizedSearch]);

  const applyWorkspace = useCallback((payload) => {
    setData({
      administrators: Array.isArray(payload?.administrators)
        ? payload.administrators
        : [],
      invitations: Array.isArray(payload?.invitations)
        ? payload.invitations
        : [],
      summary: payload?.summary || {},
    });
  }, []);

  const onVerified = async (token, verificationResult) => {
    setError('');

    if (verificationResult?.workspace) {
      applyWorkspace(verificationResult.workspace);
      setAccessToken(token);
      setNotice('Administrator workspace unlocked.');
      return;
    }

    setLoading(true);
    try {
      const payload = await adminApi.administrators.workspace(token);
      applyWorkspace(payload);
      setAccessToken(token);
      setNotice('Administrator workspace unlocked.');
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          'Could not load the administration team.',
        ),
      );
      throw requestError;
    } finally {
      setLoading(false);
    }
  };

  const openInvite = () => {
    setInviteError('');
    setInviteOpen(true);
  };

  const closeInvite = useCallback(() => {
    if (inviteBusy) return;
    setInviteOpen(false);
    setInviteError('');
  }, [inviteBusy]);

  const submitInvite = async (event) => {
    event.preventDefault();
    if (!accessToken || inviteBusy) return;

    setInviteBusy(true);
    setInviteError('');

    try {
      await adminApi.administrators.invite(
        {
          fullName: inviteForm.fullName.trim(),
          email: inviteForm.email.trim().toLowerCase(),
        },
        accessToken,
      );
      setInviteForm({ fullName: '', email: '' });
      setInviteOpen(false);
      setNotice('Administrator invitation sent successfully.');
      await load({ quiet: true });
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }
      setInviteError(getInvitationRequestError(requestError));
    } finally {
      setInviteBusy(false);
    }
  };

  const resend = async (id) => {
    if (!accessToken || actionId) return;
    setActionId(id);
    setError('');

    try {
      await adminApi.administrators.resend(id, accessToken);
      setNotice('A new invitation code was sent.');
      await load({ quiet: true });
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }
      setError(getApiErrorMessage(requestError, 'Could not resend the invitation.'));
    } finally {
      setActionId('');
    }
  };

  const cancel = async (id) => {
    if (!accessToken || actionId) return;
    if (!window.confirm('Cancel this administrator invitation?')) return;

    setActionId(id);
    setError('');

    try {
      await adminApi.administrators.cancel(id, accessToken);
      setNotice('Administrator invitation cancelled.');
      await load({ quiet: true });
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }
      setError(getApiErrorMessage(requestError, 'Could not cancel the invitation.'));
    } finally {
      setActionId('');
    }
  };

  const locked = !accessToken;

  return (
    <>
      <div
        className={`admin-page admin-administrators-page admin-sensitive-page-content ${locked ? 'is-sensitive-locked' : ''}`}
        aria-hidden={locked ? 'true' : undefined}
      >
        <section className="admin-hero admin-administrators-hero">
          <div>
            <span className="admin-hero__eyebrow">
              <ShieldCheck size={15} /> Identity & access
            </span>
            <h2>Administrators</h2>
            <p>
              Manage trusted staff identities and private administrator invitations
              without mixing them with Normal or Premium users.
            </p>
          </div>

          <div className="admin-administrators-hero__actions">
            <button
              type="button"
              className="admin-btn"
              onClick={() => load({ quiet: true })}
              disabled={refreshing || locked}
            >
              <RefreshCw size={15} className={refreshing ? 'admin-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={openInvite}
              disabled={locked}
            >
              <Send size={15} /> Invite administrator
            </button>
          </div>
        </section>

        <section className="admin-stat-grid admin-administrators-stats">
          <article className="admin-stat">
            <span className="admin-stat__icon"><UsersRound size={18} /></span>
            <strong>{data.summary.activeAdministrators ?? 0}</strong>
            <small>Active administrators</small>
            <i>Staff</i>
          </article>
          <article className="admin-stat">
            <span className="admin-stat__icon"><Mail size={18} /></span>
            <strong>{data.summary.pendingInvitations ?? 0}</strong>
            <small>Pending invitations</small>
            <i>24h expiry</i>
          </article>
          <article className="admin-stat">
            <span className="admin-stat__icon"><BadgeCheck size={18} /></span>
            <strong>{verifiedCount}</strong>
            <small>Verified staff identities</small>
            <i>Protected</i>
          </article>
          <article className="admin-stat admin-administrator-current-stat">
            <span className="admin-stat__icon"><UserRoundCog size={18} /></span>
            <strong title={currentAdmin?.fullName || 'Administrator'}>
              {currentAdmin?.fullName || 'Administrator'}
            </strong>
            <small>Your staff identity</small>
            <i>Current</i>
          </article>
        </section>

        {error ? (
          <div className="admin-administrators-feedback is-error">
            <XCircle size={15} />
            <span>{error}</span>
            <button type="button" onClick={() => setError('')}><X size={14} /></button>
          </div>
        ) : null}

        {notice ? (
          <div className="admin-administrators-feedback is-success">
            <CheckCircle2 size={15} />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')}><X size={14} /></button>
          </div>
        ) : null}

        <section className="admin-panel admin-panel--administrators">
          <div className="admin-panel__head">
            <div>
              <h3>Administration directory</h3>
              <p>Staff accounts and outstanding invitation activity.</p>
            </div>
            <span className="admin-administrators-live-chip">
              <i /> Password-protected workspace
            </span>
          </div>

          <div className="admin-administrators-tabs" role="tablist" aria-label="Administration directory sections">
            <button
              type="button"
              className={activeTab === 'administrators' ? 'is-active' : ''}
              onClick={() => setActiveTab('administrators')}
              role="tab"
              aria-selected={activeTab === 'administrators'}
            >
              <UsersRound size={14} />
              Administrators
              <span>{data.administrators.length}</span>
            </button>
            <button
              type="button"
              className={activeTab === 'invitations' ? 'is-active' : ''}
              onClick={() => setActiveTab('invitations')}
              role="tab"
              aria-selected={activeTab === 'invitations'}
            >
              <Mail size={14} />
              Pending invitations
              <span>{data.invitations.length}</span>
            </button>
          </div>

          <div className="admin-filterbar admin-administrators-filterbar">
            <label className="admin-searchbox">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeTab === 'administrators' ? 'Search administrators…' : 'Search pending invitations…'}
              />
            </label>

            <button
              type="button"
              className="admin-btn"
              onClick={() => load({ quiet: true })}
              disabled={refreshing || locked}
            >
              <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="admin-administrators-loading">
              <LoaderCircle className="admin-spin" size={22} />
              <strong>Loading administration directory…</strong>
            </div>
          ) : activeTab === 'administrators' ? (
            <div className="admin-table-wrap admin-administrators-table-wrap">
              <table className="admin-table admin-administrators-table">
                <thead>
                  <tr>
                    <th>Administrator</th>
                    <th>Access</th>
                    <th>Verification</th>
                    <th>Last login</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdministrators.length ? filteredAdministrators.map((admin) => (
                    <tr key={admin.id}>
                      <td>
                        <div className="admin-staff-identity">
                          <span>{String(admin.fullName || 'A').charAt(0).toUpperCase()}</span>
                          <div>
                            <strong>
                              {admin.fullName || 'Administrator'}
                              {admin.isCurrent ? <i>You</i> : null}
                            </strong>
                            <small>{admin.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="admin-status">
                          <ShieldCheck size={12} /> ADMIN
                        </span>
                      </td>
                      <td>
                        <span className={`admin-status ${admin.isVerified ? '' : 'admin-status--neutral'}`}>
                          {admin.isVerified ? <BadgeCheck size={12} /> : <XCircle size={12} />}
                          {admin.isVerified ? 'Verified' : 'Unverified'}
                        </span>
                      </td>
                      <td>
                        <span className="admin-administrators-date"><Clock3 size={12} /> {formatDate(admin.lastLoginAt)}</span>
                      </td>
                      <td>{formatDate(admin.createdAt)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="5">
                        <div className="admin-administrators-empty">
                          <UsersRound size={23} />
                          <strong>No administrators match this search.</strong>
                          <span>Try another name or email address.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-table-wrap admin-administrators-table-wrap">
              <table className="admin-table admin-administrators-table">
                <thead>
                  <tr>
                    <th>Invited administrator</th>
                    <th>Invited by</th>
                    <th>Sent</th>
                    <th>Expires</th>
                    <th className="is-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvitations.length ? filteredInvitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>
                        <div className="admin-staff-identity">
                          <span>{String(invitation.fullName || 'A').charAt(0).toUpperCase()}</span>
                          <div>
                            <strong>{invitation.fullName}</strong>
                            <small>{invitation.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-administrators-inviter">
                          <strong>{invitation.invitedBy?.fullName || 'Administrator'}</strong>
                          <small>{invitation.invitedBy?.email || '—'}</small>
                        </div>
                      </td>
                      <td>{formatDate(invitation.createdAt)}</td>
                      <td>
                        <span className="admin-administrators-date">
                          <CalendarClock size={12} /> {formatDate(invitation.expiresAt)}
                        </span>
                      </td>
                      <td>
                        <div className="admin-table__actions admin-invite-actions">
                          <button
                            type="button"
                            className="admin-btn"
                            disabled={actionId === invitation.id}
                            onClick={() => resend(invitation.id)}
                          >
                            {actionId === invitation.id ? <LoaderCircle className="admin-spin" size={13} /> : <RefreshCw size={13} />}
                            Resend
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--danger"
                            disabled={actionId === invitation.id}
                            onClick={() => cancel(invitation.id)}
                          >
                            <XCircle size={13} /> Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="5">
                        <div className="admin-administrators-empty">
                          <Sparkles size={23} />
                          <strong>{search ? 'No invitations match this search.' : 'No pending invitations.'}</strong>
                          <span>{search ? 'Try another name or email address.' : 'The invitation queue is clear.'}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {locked ? (
        <AdminSensitiveAccessGate
          scope={ADMINISTRATORS_SCOPE}
          title="Unlock administrator management"
          description="Confirm your current administrator password before viewing staff identities or managing administrator invitations."
          onVerified={onVerified}
        />
      ) : null}

      <InviteAdministratorModal
        open={inviteOpen}
        form={inviteForm}
        busy={inviteBusy}
        error={inviteError}
        onChange={(key, value) => setInviteForm((current) => ({ ...current, [key]: value }))}
        onClose={closeInvite}
        onSubmit={submitInvite}
      />
    </>
  );
}