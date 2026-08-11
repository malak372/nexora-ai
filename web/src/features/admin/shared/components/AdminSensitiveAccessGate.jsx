import {
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../api/adminApi';
import '../styles/admin-sensitive-access.css';

export default function AdminSensitiveAccessGate({
  scope,
  title,
  description,
  onVerified,
}) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!password || busy) return;

    setBusy(true);
    setError('');

    try {
      const result = await adminApi.sensitiveAccess.verify(scope, password);
      if (!result?.accessToken) {
        throw new Error('Sensitive access could not be verified.');
      }
      setPassword('');
      await onVerified(result.accessToken, result);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          'The password could not be verified.',
        ),
      );
      inputRef.current?.focus();
      inputRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-sensitive-access-layer" aria-live="polite">
      <div className="admin-sensitive-access-ambient" />

      <form
        className="admin-sensitive-access-card"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-sensitive-access-title"
      >
        <div className="admin-sensitive-access-card__topline" />

        <header className="admin-sensitive-access-card__header">
          <span className="admin-sensitive-access-card__mark">
            <LockKeyhole size={24} />
          </span>
          <span className="admin-sensitive-access-card__badge">
            <ShieldCheck size={12} /> Protected admin workspace
          </span>
        </header>

        <div className="admin-sensitive-access-card__copy">
          <small>IDENTITY CONFIRMATION</small>
          <h2 id="admin-sensitive-access-title">{title}</h2>
          <p>{description}</p>
        </div>

        <label className={`admin-sensitive-access-field ${error ? 'is-error' : ''}`}>
          <span>Administrator password</span>
          <div>
            <KeyRound size={17} />
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError('');
              }}
              placeholder="Enter your account password"
              disabled={busy}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              disabled={busy}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        {error ? (
          <div className="admin-sensitive-access-error">{error}</div>
        ) : (
          <div className="admin-sensitive-access-hint">
            This verification unlocks only this page. Other admin sections remain available from the sidebar.
          </div>
        )}

        <button
          type="submit"
          className="admin-sensitive-access-submit"
          disabled={busy || !password}
        >
          {busy ? <LoaderCircle className="admin-sensitive-access-spin" size={17} /> : <ShieldCheck size={17} />}
          {busy ? 'Verifying…' : 'Unlock workspace'}
        </button>
      </form>
    </div>,
    document.body,
  );
}