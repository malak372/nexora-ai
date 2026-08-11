import {
  ArrowRight,
  BadgeCheck,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import VoxidenceMark from '../../../../components/brand/VoxidenceMark';
import {
  adminInvitationApi,
} from '../api/admin-invitation.api';
import '../styles/admin-invitation.css';

function readApiMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

export default function AdminAcceptInvitationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialEmail = useMemo(
    () => searchParams.get('email') || '',
    [searchParams],
  );

  const [form, setForm] = useState({
    email: initialEmail,
    code: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  const passwordValid =
    form.password.length >= 8 &&
    /[A-Za-z]/.test(form.password) &&
    /\d/.test(form.password);

  const canSubmit =
    form.email.trim() &&
    /^\d{8}$/.test(form.code.trim()) &&
    passwordValid &&
    form.password === form.confirmPassword &&
    !busy;

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (error) setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError('');

    try {
      await adminInvitationApi.accept({
        email: form.email.trim().toLowerCase(),
        code: form.code.trim(),
        password: form.password,
      });
      setComplete(true);
    } catch (requestError) {
      setError(
        readApiMessage(
          requestError,
          'Could not activate administrator access.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  if (complete) {
    return (
      <main className="admin-invite-auth">
        <section className="admin-invite-auth__success">
          <span><BadgeCheck size={25} /></span>
          <VoxidenceMark size={46} />
          <small>ADMIN ACCESS READY</small>
          <h1>Your administrator account is active.</h1>
          <p>
            Your email has been verified from the invitation code. You can
            now sign in with the password you just created.
          </p>
          <button type="button" onClick={() => navigate('/login', { replace: true })}>
            Continue to sign in <ArrowRight size={16} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-invite-auth">
      <section className="admin-invite-auth__shell">
        <aside className="admin-invite-auth__intro">
          <VoxidenceMark size={52} />
          <span className="admin-invite-auth__eyebrow">
            <ShieldCheck size={14} /> PRIVATE STAFF ACCESS
          </span>
          <h1>Join the Voxidence admin team.</h1>
          <p>
            Administrator access is invitation-only. The code sent to your
            email confirms that this invitation belongs to you.
          </p>

          <div className="admin-invite-auth__rules">
            <article>
              <Sparkles size={16} />
              <div>
                <strong>Staff identity</strong>
                <span>No Normal/Premium customer plan.</span>
              </div>
            </article>
            <article>
              <KeyRound size={16} />
              <div>
                <strong>No generation entitlement</strong>
                <span>No free generations and no credit balance.</span>
              </div>
            </article>
            <article>
              <LockKeyhole size={16} />
              <div>
                <strong>Verified through invitation</strong>
                <span>Only the invited mailbox receives the one-time code.</span>
              </div>
            </article>
          </div>
        </aside>

        <form className="admin-invite-auth__form" onSubmit={submit}>
          <span className="admin-invite-auth__eyebrow">
            <ShieldCheck size={14} /> ADMINISTRATOR INVITATION
          </span>
          <h2>Create your admin access.</h2>
          <p>Enter the invited email, eight-digit code, and your new password.</p>

          <label>
            <span>Email address</span>
            <div>
              <Mail size={16} />
              <input
                type="email"
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
          </label>

          <label>
            <span>Invitation code</span>
            <div>
              <KeyRound size={16} />
              <input
                inputMode="numeric"
                pattern="\d{8}"
                maxLength={8}
                value={form.code}
                onChange={(event) =>
                  update(
                    'code',
                    event.target.value.replace(/\D/g, '').slice(0, 8),
                  )
                }
                placeholder="8-digit code"
                autoComplete="one-time-code"
                required
              />
            </div>
          </label>

          <div className="admin-invite-auth__password-grid">
            <label>
              <span>Create password</span>
              <div>
                <LockKeyhole size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(event) => update('password', event.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>

            <label>
              <span>Confirm password</span>
              <div>
                <LockKeyhole size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={(event) =>
                    update('confirmPassword', event.target.value)
                  }
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  required
                />
              </div>
            </label>
          </div>

          <div className="admin-invite-auth__checks">
            <span className={form.password.length >= 8 ? 'is-valid' : ''}>
              8+ characters
            </span>
            <span className={/[A-Za-z]/.test(form.password) ? 'is-valid' : ''}>
              One letter
            </span>
            <span className={/\d/.test(form.password) ? 'is-valid' : ''}>
              One number
            </span>
            <span
              className={
                form.confirmPassword &&
                form.password === form.confirmPassword
                  ? 'is-valid'
                  : ''
              }
            >
              Passwords match
            </span>
          </div>

          {error ? <div className="admin-invite-auth__error">{error}</div> : null}

          <button
            type="submit"
            className="admin-invite-auth__submit"
            disabled={!canSubmit}
          >
            {busy ? 'Activating…' : 'Activate administrator account'}
            {!busy ? <ArrowRight size={16} /> : null}
          </button>

          <small className="admin-invite-auth__footnote">
            This invitation creates an ADMIN staff identity only. It does not
            create a customer subscription.
          </small>
        </form>
      </section>
    </main>
  );
}