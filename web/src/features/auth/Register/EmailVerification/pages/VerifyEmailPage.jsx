/**
 * Displays the Nexora email-verification-code experience.
 *
 * The user enters the six-digit code sent to their email address. The email
 * is received from registration navigation state or from the optional email
 * query parameter used when the page is reopened manually.
 *
 * @author Eman
 */
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    KeyRound,
    LoaderCircle,
    MailCheck,
    RefreshCw,
    ShieldCheck,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

import {
    resendVerificationEmail,
    verifyEmail,
} from '../api/email-verification.api';

import '../../../Login/styles/login-page.css';
import '../styles/verify-email-page.css';

const VERIFICATION_STATUS = {
    WAITING: 'waiting',
    VERIFYING: 'verifying',
    SUCCESS: 'success',
    ERROR: 'error',
};

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export default function VerifyEmailPage() {
    const pageRef = useRef(null);
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const initialEmail = normalizeEmail(
        location.state?.email || searchParams.get('email'),
    );

    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState('');
    const [status, setStatus] = useState(VERIFICATION_STATUS.WAITING);
    const [message, setMessage] = useState(
        location.state?.registrationMessage ||
        'Enter the six-digit code sent to your email address.',
    );
    const [isResending, setIsResending] = useState(false);
    const [resendMessage, setResendMessage] = useState('');
    const [resendError, setResendError] = useState('');

    const isVerifying = status === VERIFICATION_STATUS.VERIFYING;
    const isSuccess = status === VERIFICATION_STATUS.SUCCESS;

    function handlePointerMove(event) {
        const page = pageRef.current;
        if (!page || event.pointerType === 'touch') return;

        const bounds = page.getBoundingClientRect();
        page.style.setProperty('--nx-pointer-x', `${event.clientX - bounds.left}px`);
        page.style.setProperty('--nx-pointer-y', `${event.clientY - bounds.top}px`);
        page.style.setProperty('--nx-pointer-visible', '1');
    }

    function handlePointerLeave() {
        pageRef.current?.style.setProperty('--nx-pointer-visible', '0');
    }

    function handleCodeChange(event) {
        setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
        setResendError('');
        if (status === VERIFICATION_STATUS.ERROR) {
            setStatus(VERIFICATION_STATUS.WAITING);
            setMessage('Enter the six-digit code sent to your email address.');
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();

        if (isVerifying || !email || code.length !== 6) {
            setStatus(VERIFICATION_STATUS.ERROR);
            setMessage(
                !email
                    ? 'Enter the email address used during registration.'
                    : 'Enter the complete six-digit verification code.',
            );
            return;
        }

        setStatus(VERIFICATION_STATUS.VERIFYING);
        setMessage('Please wait while we activate your workspace.');
        setResendMessage('');
        setResendError('');

        try {
            const result = await verifyEmail({ email, code });
            setStatus(VERIFICATION_STATUS.SUCCESS);
            setMessage(
                result?.message ||
                'Your email was verified successfully. You can now sign in.',
            );
        } catch (error) {
            setStatus(VERIFICATION_STATUS.ERROR);
            setMessage(
                error?.message ||
                'The verification code is invalid or has expired.',
            );
        }
    }

    async function handleResend() {
        if (!email || isResending) {
            setResendError('Enter your email address before requesting a new code.');
            return;
        }

        setIsResending(true);
        setResendMessage('');
        setResendError('');

        try {
            const result = await resendVerificationEmail(email);
            setCode('');
            setStatus(VERIFICATION_STATUS.WAITING);
            setMessage('A new six-digit code was requested. Check your inbox.');
            setResendMessage(
                result?.message || 'A new verification code was requested.',
            );
        } catch (error) {
            setResendError(
                error?.message || 'The verification code could not be sent.',
            );
        } finally {
            setIsResending(false);
        }
    }

    const StatusIcon = isSuccess
        ? CheckCircle2
        : status === VERIFICATION_STATUS.ERROR
            ? AlertTriangle
            : isVerifying
                ? LoaderCircle
                : KeyRound;

    return (
        <main
            ref={pageRef}
            className="nx-login nx-verify-page"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
        >
            <div className="nx-login__ambient" aria-hidden="true" />
            <div className="nx-login__pointer-field" aria-hidden="true" />

            <motion.section
                className="nx-verify-card"
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
                aria-live="polite"
            >
                <div className="nx-verify-card__glow" aria-hidden="true" />

                <span className="nx-verify-card__icon">
                    <StatusIcon
                        className={isVerifying ? 'nx-form__spinner' : ''}
                        size={32}
                        aria-hidden="true"
                    />
                </span>

                <p className="nx-verify-card__eyebrow">
                    <ShieldCheck size={15} aria-hidden="true" />
                    Secure email verification
                </p>

                <h1>{isSuccess ? 'Email verified.' : 'Enter your code.'}</h1>
                <p className="nx-verify-card__message">{message}</p>

                {!isSuccess ? (
                    <form className="nx-verify-code-form" onSubmit={handleSubmit}>
                        <label htmlFor="verification-email">Email address</label>
                        <div className="nx-verify-code-form__email-shell">
                            <MailCheck size={18} aria-hidden="true" />
                            <input
                                id="verification-email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(normalizeEmail(event.target.value))}
                                placeholder="you@example.com"
                                autoComplete="email"
                                disabled={isVerifying}
                            />
                        </div>

                        <label htmlFor="verification-code">Verification code</label>
                        <input
                            id="verification-code"
                            className="nx-verify-code-form__code"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            value={code}
                            onChange={handleCodeChange}
                            placeholder="000000"
                            autoComplete="one-time-code"
                            disabled={isVerifying}
                            autoFocus
                        />

                        <button
                            type="submit"
                            className="nx-verify-card__primary"
                            disabled={isVerifying || code.length !== 6 || !email}
                        >
                            {isVerifying ? (
                                <>
                                    <LoaderCircle className="nx-form__spinner" size={18} />
                                    Verifying code...
                                </>
                            ) : (
                                <>
                                    Verify email
                                    <ArrowRight size={19} aria-hidden="true" />
                                </>
                            )}
                        </button>
                    </form>
                ) : (
                    <Link className="nx-verify-card__primary" to="/login">
                        Continue to sign in
                        <ArrowRight size={19} aria-hidden="true" />
                    </Link>
                )}

                {!isSuccess && (
                    <button
                        type="button"
                        className="nx-verify-card__secondary nx-verify-card__resend"
                        onClick={handleResend}
                        disabled={isResending}
                    >
                        {isResending ? (
                            <>
                                <LoaderCircle className="nx-form__spinner" size={17} />
                                Requesting code...
                            </>
                        ) : (
                            <>
                                <RefreshCw size={17} aria-hidden="true" />
                                Resend verification code
                            </>
                        )}
                    </button>
                )}

                {!isSuccess && (
                    <Link className="nx-verify-card__secondary" to="/login">
                        Back to sign in
                    </Link>
                )}

                {resendMessage && (
                    <p className="nx-verify-card__resend-message" role="status">
                        {resendMessage}
                    </p>
                )}

                {resendError && (
                    <p
                        className="nx-verify-card__resend-message nx-verify-card__resend-message--error"
                        role="alert"
                    >
                        {resendError}
                    </p>
                )}
            </motion.section>
        </main>
    );
}