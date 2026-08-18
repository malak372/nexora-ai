import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Mail,
  MessageCircleMore,
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
import { useLocation, useNavigate } from 'react-router-dom';

import AdminSensitiveAccessGate from '../../shared/components/AdminSensitiveAccessGate';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-administrators.css';

/**
 * Sensitive-access scope used to protect the administrator
 * management workspace.
 *
 * @author Eman
 */
const ADMINISTRATORS_SCOPE = 'ADMINISTRATORS';

/**
 * Formats a date value for display in administrator tables.
 *
 * The resulting value contains:
 * - Month.
 * - Day.
 * - Year.
 * - Hour.
 * - Minute.
 *
 * Invalid or missing values are represented using an em dash.
 *
 * @param {string|Date|null|undefined} value The date value to format.
 * @returns {string} The formatted date or an em dash.
 *
 * @author Eman
 */
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

/**
 * Resolves a user-friendly error message for administrator
 * invitation requests.
 *
 * Provides specialized messages for network and timeout errors,
 * while falling back to the standard administrator API error resolver.
 *
 * @param {object} requestError The request error received from the API.
 * @returns {string} A user-facing invitation error message.
 *
 * @author Eman
 */
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

/**
 * Modal used to invite a new administrator.
 *
 * The modal:
 * - Collects the administrator's full name and email address.
 * - Prevents page scrolling while open.
 * - Supports closing with the Escape key.
 * - Prevents closing while an invitation request is in progress.
 * - Displays invitation-specific error feedback.
 * - Is rendered directly into the document body using a React portal.
 *
 * @param {object} props Component properties.
 * @param {boolean} props.open Whether the modal is visible.
 * @param {object} props.form Current invitation form values.
 * @param {boolean} props.busy Whether an invitation request is in progress.
 * @param {string} props.error Current invitation error message.
 * @param {Function} props.onChange Handler used to update form values.
 * @param {Function} props.onClose Handler used to close the modal.
 * @param {Function} props.onSubmit Handler used to submit the invitation.
 * @returns {JSX.Element|null} The invitation modal or null when closed.
 *
 * @author Eman
 */
function InviteAdministratorModal({
  open,
  form,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
}) {
  /**
   * Locks body scrolling while the invitation modal is visible
   * and registers keyboard handling for the Escape key.
   */
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
          <span>
            <ShieldCheck size={12} /> STAFF ACCESS
          </span>

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
                onChange={(event) =>
                  onChange('fullName', event.target.value)
                }
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
                onChange={(event) =>
                  onChange('email', event.target.value)
                }
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
              <strong>
                {busy ? 'Sending invitation…' : 'Send invitation'}
              </strong>

              <small>
                {busy
                  ? 'Preparing the secure email'
                  : 'Email a one-time access code'}
              </small>
            </span>
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

/**
 * Administrator management workspace.
 *
 * Provides protected management tools for:
 * - Viewing administrator accounts.
 * - Viewing pending administrator invitations.
 * - Searching staff members and invitations.
 * - Sending administrator invitations.
 * - Resending pending invitations.
 * - Cancelling pending invitations.
 * - Opening direct administrator team-chat conversations.
 * - Displaying administrator and invitation summary information.
 *
 * Access to the workspace is protected by a sensitive-access
 * verification gate that requires the current administrator
 * to re-confirm their credentials.
 *
 * @returns {JSX.Element} The administrator management workspace.
 *
 * @author Eman
 */
export default function AdminAdministratorsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [accessToken, setAccessToken] = useState('');
  const [accessGateOpen, setAccessGateOpen] = useState(true);

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

  const [inviteForm, setInviteForm] = useState({
    fullName: '',
    email: '',
  });

  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [actionId, setActionId] = useState('');

  /**
   * Locks the sensitive administrator workspace.
   *
   * Removes the current access token, clears protected workspace data,
   * closes the invitation modal, and resets the workspace error state.
   */
  const lockWorkspace = useCallback(() => {
    setAccessToken('');
    setAccessGateOpen(true);

    setData({
      administrators: [],
      invitations: [],
      summary: {},
    });

    setInviteOpen(false);
    setError('');
  }, []);

  /**
   * Loads administrator workspace information.
   *
   * The request requires a valid sensitive-access token.
   * A quiet load is used for refresh operations so existing
   * workspace content remains visible.
   *
   * If the backend returns HTTP 403, the workspace is immediately locked.
   *
   * @param {object} options Loading configuration.
   * @param {boolean} options.quiet Whether to use the refresh state.
   * @param {string} options.token Sensitive-access token.
   * @returns {Promise<void>}
   */
  const load = useCallback(
    async ({ quiet = false, token = accessToken } = {}) => {
      if (!token) return;

      if (quiet) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

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
    },
    [accessToken, lockWorkspace],
  );

  /**
   * Automatically clears success notifications after 3.2 seconds.
   */
  useEffect(() => {
    if (!notice) return undefined;

    const timer = window.setTimeout(() => setNotice(''), 3200);

    return () => window.clearTimeout(timer);
  }, [notice]);

  /**
   * Resolves the current administrator from the loaded directory.
   */
  const currentAdmin = useMemo(
    () => data.administrators.find((item) => item.isCurrent),
    [data.administrators],
  );

  /**
   * Calculates the number of verified administrator identities.
   */
  const verifiedCount = useMemo(
    () =>
      data.administrators.filter((item) => item.isVerified).length,
    [data.administrators],
  );

  const currentAdminInitials = String(
    currentAdmin?.fullName || 'Administrator',
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  /**
   * Normalized search value used by both administrator
   * and invitation filters.
   */
  const normalizedSearch = search.trim().toLowerCase();

  /**
   * Filters administrators by full name or email address.
   */
  const filteredAdministrators = useMemo(() => {
    if (!normalizedSearch) return data.administrators;

    return data.administrators.filter((item) =>
      [item.fullName, item.email]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(normalizedSearch),
        ),
    );
  }, [data.administrators, normalizedSearch]);

  /**
   * Filters pending administrator invitations.
   *
   * Searchable fields include:
   * - Invitee full name.
   * - Invitee email.
   * - Inviting administrator name.
   * - Inviting administrator email.
   */
  const filteredInvitations = useMemo(() => {
    if (!normalizedSearch) return data.invitations;

    return data.invitations.filter((item) =>
      [
        item.fullName,
        item.email,
        item.invitedBy?.fullName,
        item.invitedBy?.email,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(normalizedSearch),
        ),
    );
  }, [data.invitations, normalizedSearch]);

  /**
   * Applies a backend workspace payload to the local
   * administrator directory state.
   *
   * @param {object} payload Administrator workspace response.
   */
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

  /**
   * Handles successful sensitive-access verification.
   *
   * If the verification response already includes workspace data,
   * it is used immediately. Otherwise, the workspace is loaded
   * using the newly issued access token.
   *
   * @param {string} token Sensitive-access token.
   * @param {object} verificationResult Verification response.
   * @returns {Promise<void>}
   */
  const onVerified = async (token, verificationResult) => {
    setError('');

    if (verificationResult?.workspace) {
      applyWorkspace(verificationResult.workspace);
      setAccessToken(token);
      setAccessGateOpen(false);
      setNotice('Administrator workspace unlocked.');
      return;
    }

    setLoading(true);

    try {
      const payload = await adminApi.administrators.workspace(token);

      applyWorkspace(payload);
      setAccessToken(token);
      setAccessGateOpen(false);
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

  /**
   * Opens the administrator invitation modal.
   */
  const openInvite = () => {
    setInviteError('');
    setInviteOpen(true);
  };

  /**
   * Closes the administrator invitation modal when
   * no invitation request is currently running.
   */
  const closeInvite = useCallback(() => {
    if (inviteBusy) return;

    setInviteOpen(false);
    setInviteError('');
  }, [inviteBusy]);

  /**
   * Submits a new administrator invitation.
   *
   * The administrator name is trimmed and the email address
   * is normalized to lowercase before being submitted.
   *
   * After a successful request, the modal is closed and
   * the workspace is refreshed.
   *
   * @param {React.FormEvent<HTMLFormElement>} event Form submission event.
   * @returns {Promise<void>}
   */
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

      setInviteForm({
        fullName: '',
        email: '',
      });

      setInviteOpen(false);
      setNotice('Administrator invitation sent successfully.');

      await load({
        quiet: true,
      });
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }

      setInviteError(
        getInvitationRequestError(requestError),
      );
    } finally {
      setInviteBusy(false);
    }
  };

  /**
   * Resends a pending administrator invitation.
   *
   * @param {string} id Invitation ID.
   * @returns {Promise<void>}
   */
  const resend = async (id) => {
    if (!accessToken || actionId) return;

    setActionId(id);
    setError('');

    try {
      await adminApi.administrators.resend(
        id,
        accessToken,
      );

      setNotice('A new invitation code was sent.');

      await load({
        quiet: true,
      });
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }

      setError(
        getApiErrorMessage(
          requestError,
          'Could not resend the invitation.',
        ),
      );
    } finally {
      setActionId('');
    }
  };

  /**
   * Cancels a pending administrator invitation.
   *
   * A browser confirmation dialog is displayed before
   * the cancellation request is submitted.
   *
   * @param {string} id Invitation ID.
   * @returns {Promise<void>}
   */
  const cancel = async (id) => {
    if (!accessToken || actionId) return;

    if (
      !window.confirm(
        'Cancel this administrator invitation?',
      )
    ) {
      return;
    }

    setActionId(id);
    setError('');

    try {
      await adminApi.administrators.cancel(
        id,
        accessToken,
      );

      setNotice('Administrator invitation cancelled.');

      await load({
        quiet: true,
      });
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }

      setError(
        getApiErrorMessage(
          requestError,
          'Could not cancel the invitation.',
        ),
      );
    } finally {
      setActionId('');
    }
  };

  /**
   * Indicates whether the administrator workspace is
   * currently protected by the sensitive-access gate.
   */
  const locked = !accessToken;
  const gateVisible = locked && accessGateOpen;

  const closeAccessGate = useCallback(() => {
    const currentPath = `${location.pathname}${location.search || ''}${location.hash || ''}`;
    const returnTo = location.state?.sensitiveReturnTo;

    if (returnTo && returnTo !== currentPath) {
      navigate(returnTo, { replace: true });
      return;
    }

    navigate('/admin/dashboard', { replace: true });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  const handleLockedPageClick = useCallback(
    (event) => {
      if (!locked || accessGateOpen) return;

      event.preventDefault();
      event.stopPropagation();
      setAccessGateOpen(true);
    },
    [locked, accessGateOpen],
  );

  return (
    <>
      <div
        className={`admin-page admin-administrators-page admin-sensitive-page-content ${gateVisible ? 'is-sensitive-locked' : ''
          }`}
        aria-hidden={gateVisible ? 'true' : undefined}
        onClickCapture={handleLockedPageClick}
      >
        <section className="admin-administrators-overview">
          <div className="admin-hero admin-administrators-hero">
            <div className="admin-administrators-hero__copy">
              <span className="admin-hero__eyebrow">
                <ShieldCheck size={15} /> Identity & access
              </span>

              <h2>Administrators</h2>

              <p>
                Manage trusted staff identities and private administrator
                invitations without mixing them with Normal or Premium users.
              </p>

              <div className="admin-administrators-hero__actions">
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() =>
                    load({
                      quiet: true,
                    })
                  }
                  disabled={refreshing || locked}
                >
                  <RefreshCw
                    size={15}
                    className={refreshing ? 'admin-spin' : ''}
                  />
                  Refresh
                </button>

                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={openInvite}
                  disabled={locked}
                >
                  <Send size={15} />
                  Invite administrator
                </button>
              </div>
            </div>

            <div
              className="admin-administrators-hero__visual"
              aria-hidden="true"
            >
              <span className="admin-administrators-hero__orb" />
              <span className="admin-administrators-hero__dots" />
              <span className="admin-administrators-hero__wave admin-administrators-hero__wave--one" />
              <span className="admin-administrators-hero__wave admin-administrators-hero__wave--two" />

              <div className="admin-administrators-hero__shield">
                <div className="admin-administrators-hero__shield-core">
                  <UsersRound size={36} strokeWidth={1.65} />
                </div>
              </div>
            </div>
          </div>

          <section className="admin-stat-grid admin-administrators-stats">
            <article className="admin-stat">
              <span className="admin-stat__icon">
                <UsersRound size={20} />
              </span>

              <strong>
                {data.summary.activeAdministrators ?? 0}
              </strong>

              <small>Active administrators</small>
              <i>Staff</i>
            </article>

            <article className="admin-stat">
              <span className="admin-stat__icon">
                <Mail size={20} />
              </span>

              <strong>
                {data.summary.pendingInvitations ?? 0}
              </strong>

              <small>Pending invitations</small>
              <i>24h expiry</i>
            </article>

            <article className="admin-stat">
              <span className="admin-stat__icon">
                <BadgeCheck size={20} />
              </span>

              <strong>{verifiedCount}</strong>
              <small>Verified staff identities</small>
              <i>Protected</i>
            </article>

            <article className="admin-stat admin-administrator-current-stat">
              <span className="admin-stat__avatar">
                {currentAdminInitials || 'A'}
              </span>

              <strong
                title={
                  currentAdmin?.fullName || 'Administrator'
                }
              >
                {currentAdmin?.fullName || 'Administrator'}
              </strong>

              <small>Your staff identity</small>
              <i>Current</i>
            </article>
          </section>
        </section>

        {error ? (
          <div className="admin-administrators-feedback is-error">
            <XCircle size={15} />
            <span>{error}</span>

            <button
              type="button"
              onClick={() => setError('')}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        {notice ? (
          <div className="admin-administrators-feedback is-success">
            <CheckCircle2 size={15} />
            <span>{notice}</span>

            <button
              type="button"
              onClick={() => setNotice('')}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        <section className="admin-panel admin-panel--administrators">
          <div className="admin-panel__head">
            <div>
              <h3>Administration directory</h3>

              <p>
                Staff accounts and outstanding invitation activity.
              </p>
            </div>

            <span className="admin-administrators-live-chip">
              <i /> Password-protected workspace
            </span>
          </div>

          <div
            className="admin-administrators-tabs"
            role="tablist"
            aria-label="Administration directory sections"
          >
            <button
              type="button"
              className={
                activeTab === 'administrators'
                  ? 'is-active'
                  : ''
              }
              onClick={() =>
                setActiveTab('administrators')
              }
              role="tab"
              aria-selected={
                activeTab === 'administrators'
              }
            >
              <UsersRound size={14} />
              Administrators
              <span>{data.administrators.length}</span>
            </button>

            <button
              type="button"
              className={
                activeTab === 'invitations'
                  ? 'is-active'
                  : ''
              }
              onClick={() =>
                setActiveTab('invitations')
              }
              role="tab"
              aria-selected={
                activeTab === 'invitations'
              }
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
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder={
                  activeTab === 'administrators'
                    ? 'Search administrators…'
                    : 'Search pending invitations…'
                }
              />
            </label>

            <button
              type="button"
              className="admin-btn"
              onClick={() =>
                load({
                  quiet: true,
                })
              }
              disabled={refreshing || locked}
            >
              <RefreshCw
                size={14}
                className={refreshing ? 'admin-spin' : ''}
              />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="admin-administrators-loading">
              <LoaderCircle
                className="admin-spin"
                size={22}
              />

              <strong>
                Loading administration directory…
              </strong>
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
                    <th className="is-actions">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredAdministrators.length ? (
                    filteredAdministrators.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <div className="admin-staff-identity">
                            <span>
                              {String(
                                admin.fullName || 'A',
                              )
                                .charAt(0)
                                .toUpperCase()}
                            </span>

                            <div>
                              <strong>
                                {admin.fullName ||
                                  'Administrator'}

                                {admin.isCurrent ? (
                                  <i>You</i>
                                ) : null}
                              </strong>

                              <small>{admin.email}</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="admin-status">
                            <ShieldCheck size={12} />
                            ADMIN
                          </span>
                        </td>

                        <td>
                          <span
                            className={`admin-status ${admin.isVerified
                              ? ''
                              : 'admin-status--neutral'
                              }`}
                          >
                            {admin.isVerified ? (
                              <BadgeCheck size={12} />
                            ) : (
                              <XCircle size={12} />
                            )}

                            {admin.isVerified
                              ? 'Verified'
                              : 'Unverified'}
                          </span>
                        </td>

                        <td>
                          <span className="admin-administrators-date">
                            <Clock3 size={12} />
                            {formatDate(admin.lastLoginAt)}
                          </span>
                        </td>

                        <td>
                          {formatDate(admin.createdAt)}
                        </td>

                        <td className="is-actions">
                          {admin.isCurrent ? (
                            <span className="admin-administrators-self-action">
                              Current admin
                            </span>
                          ) : admin.isActive &&
                            admin.isVerified ? (
                            <button
                              type="button"
                              className="admin-administrators-message-btn"
                              onClick={() =>
                                navigate(
                                  `/admin/team-chat?adminId=${admin.id}`,
                                  {
                                    state: {
                                      fromAdministrators: true,
                                    },
                                  },
                                )
                              }
                            >
                              <MessageCircleMore size={14} />
                              Message
                            </button>
                          ) : (
                            <span className="admin-administrators-self-action">
                              Unavailable
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6">
                        <div className="admin-administrators-empty">
                          <UsersRound size={23} />

                          <strong>
                            No administrators match this search.
                          </strong>

                          <span>
                            Try another name or email address.
                          </span>
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
                  {filteredInvitations.length ? (
                    filteredInvitations.map(
                      (invitation) => (
                        <tr key={invitation.id}>
                          <td>
                            <div className="admin-staff-identity">
                              <span>
                                {String(
                                  invitation.fullName ||
                                  'A',
                                )
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>

                              <div>
                                <strong>
                                  {invitation.fullName}
                                </strong>

                                <small>
                                  {invitation.email}
                                </small>
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="admin-administrators-inviter">
                              <strong>
                                {invitation.invitedBy
                                  ?.fullName ||
                                  'Administrator'}
                              </strong>

                              <small>
                                {invitation.invitedBy
                                  ?.email || '—'}
                              </small>
                            </div>
                          </td>

                          <td>
                            {formatDate(
                              invitation.createdAt,
                            )}
                          </td>

                          <td>
                            <span className="admin-administrators-date">
                              <CalendarClock size={12} />

                              {formatDate(
                                invitation.expiresAt,
                              )}
                            </span>
                          </td>

                          <td>
                            <div className="admin-table__actions admin-invite-actions">
                              <button
                                type="button"
                                className="admin-btn"
                                disabled={
                                  actionId ===
                                  invitation.id
                                }
                                onClick={() =>
                                  resend(
                                    invitation.id,
                                  )
                                }
                              >
                                {actionId ===
                                  invitation.id ? (
                                  <LoaderCircle
                                    className="admin-spin"
                                    size={13}
                                  />
                                ) : (
                                  <RefreshCw
                                    size={13}
                                  />
                                )}

                                Resend
                              </button>

                              <button
                                type="button"
                                className="admin-btn admin-btn--danger"
                                disabled={
                                  actionId ===
                                  invitation.id
                                }
                                onClick={() =>
                                  cancel(
                                    invitation.id,
                                  )
                                }
                              >
                                <XCircle size={13} />
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )
                  ) : (
                    <tr>
                      <td colSpan="5">
                        <div className="admin-administrators-empty">
                          <Sparkles size={23} />

                          <strong>
                            {search
                              ? 'No invitations match this search.'
                              : 'No pending invitations.'}
                          </strong>

                          <span>
                            {search
                              ? 'Try another name or email address.'
                              : 'The invitation queue is clear.'}
                          </span>
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

      {gateVisible ? (
        <AdminSensitiveAccessGate
          scope={ADMINISTRATORS_SCOPE}
          title="Unlock administrator management"
          description="Confirm your current administrator password before viewing staff identities or managing administrator invitations."
          onVerified={onVerified}
          onClose={closeAccessGate}
        />
      ) : null}

      <InviteAdministratorModal
        open={inviteOpen}
        form={inviteForm}
        busy={inviteBusy}
        error={inviteError}
        onChange={(key, value) =>
          setInviteForm((current) => ({
            ...current,
            [key]: value,
          }))
        }
        onClose={closeInvite}
        onSubmit={submitInvite}
      />
    </>
  );
}