/**
 * Displays the Nexora email-verification experience.
 *
 * The page supports two verification states:
 * - Waiting for the user to open the email verification link.
 * - Automatically verifying the email and token received in the URL.
 *
 * The verification link is expected to contain:
 * /verify-email?email=user@example.com&token=verification-token
 *
 * @component
 * @returns {JSX.Element} The email-verification page.
 *
 * @author Eman
 */

import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    LoaderCircle,
    MailCheck,
    RefreshCw,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    useEffect,
    useRef,
    useState,
} from 'react';
import {
    Link,
    useLocation,
    useSearchParams,
} from 'react-router-dom';

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

const STATUS_CONFIG = {
    [VERIFICATION_STATUS.WAITING]: {
        icon: MailCheck,
        eyebrow: 'Verification email sent',
        title: 'Check your inbox.',
    },
    [VERIFICATION_STATUS.VERIFYING]: {
        icon: LoaderCircle,
        eyebrow: 'Secure verification',
        title: 'Verifying your email...',
    },
    [VERIFICATION_STATUS.SUCCESS]: {
        icon: CheckCircle2,
        eyebrow: 'Workspace activated',
        title: 'Email verified.',
    },
    [VERIFICATION_STATUS.ERROR]: {
        icon: AlertTriangle,
        eyebrow: 'Link needs attention',
        title: 'Verification incomplete.',
    },
};

function normalizeEmail(value) {
    return typeof value === 'string'
        ? value.trim().toLowerCase()
        : '';
}

export default function VerifyEmailPage() {
    const pageRef = useRef(null);
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const queryEmail = normalizeEmail(searchParams.get('email'));
    const registrationEmail = normalizeEmail(location.state?.email);
    const email = queryEmail || registrationEmail;

    const emailDeliveryFailed =
        location.state?.emailDeliveryFailed === true;

    const token = searchParams.get('token')?.trim() || '';

    const hasVerificationCredentials = Boolean(queryEmail && token);

    const [status, setStatus] = useState(
        hasVerificationCredentials
            ? VERIFICATION_STATUS.VERIFYING
            : VERIFICATION_STATUS.WAITING,
    );

    const [message, setMessage] = useState(
        location.state?.registrationMessage ||
        (
            emailDeliveryFailed
                ? 'Your account was created, but the verification email could not be sent. Request a new email below.'
                : 'Open the verification link sent to your email address.'
        ),
    );

    const [isResending, setIsResending] = useState(false);
    const [resendMessage, setResendMessage] = useState('');
    const [resendError, setResendError] = useState('');

    useEffect(() => {
        if (!hasVerificationCredentials) {
            return undefined;
        }

        let isMounted = true;

        async function runVerification() {
            setStatus(VERIFICATION_STATUS.VERIFYING);
            setMessage(
                'Please wait while we activate your workspace.',
            );

            try {
                const result = await verifyEmail({
                    email: queryEmail,
                    token,
                });

                if (!isMounted) {
                    return;
                }

                setStatus(VERIFICATION_STATUS.SUCCESS);
                setMessage(
                    result?.message ||
                    'Your email was verified successfully. You can now sign in.',
                );
            } catch (error) {
                if (!isMounted) {
                    return;
                }

                setStatus(VERIFICATION_STATUS.ERROR);
                setMessage(
                    error?.message ||
                    'The verification link is invalid or has expired.',
                );
            }
        }

        /*
         * This delay prevents React StrictMode's temporary
         * development effect from consuming the verification request.
         */
        const verificationTimer = window.setTimeout(() => {
            void runVerification();
        }, 0);

        return () => {
            isMounted = false;
            window.clearTimeout(verificationTimer);
        };
    }, [
        hasVerificationCredentials,
        queryEmail,
        token,
    ]);

    function handlePointerMove(event) {
        const page = pageRef.current;

        if (!page || event.pointerType === 'touch') {
            return;
        }

        const bounds = page.getBoundingClientRect();

        page.style.setProperty(
            '--nx-pointer-x',
            `${event.clientX - bounds.left}px`,
        );

        page.style.setProperty(
            '--nx-pointer-y',
            `${event.clientY - bounds.top}px`,
        );

        page.style.setProperty(
            '--nx-pointer-visible',
            '1',
        );
    }

    function handlePointerLeave() {
        pageRef.current?.style.setProperty(
            '--nx-pointer-visible',
            '0',
        );
    }

    async function handleResend() {
        if (!email || isResending) {
            return;
        }

        setIsResending(true);
        setResendMessage('');
        setResendError('');

        try {
            const result = await resendVerificationEmail(email);

            setResendMessage(
                result?.message ||
                'A new verification email has been requested. Please check your inbox.',
            );
        } catch (error) {
            setResendError(
                error?.message ||
                'The verification email could not be resent. Please try again.',
            );
        } finally {
            setIsResending(false);
        }
    }

    const statusConfig =
        emailDeliveryFailed &&
            status === VERIFICATION_STATUS.WAITING
            ? {
                icon: AlertTriangle,
                eyebrow: 'Email delivery failed',
                title: 'Request a new verification email.',
            }
            : (
                STATUS_CONFIG[status] ||
                STATUS_CONFIG[VERIFICATION_STATUS.WAITING]
            );

    const StatusIcon = statusConfig.icon;

    const attachedGuestIdeasCount =
        Number(location.state?.attachedGuestIdeasCount) || 0;

    return (
        <main
            ref={pageRef}
            className="nx-login nx-verify"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
        >
            <div
                className="nx-login__cursor-pixels"
                aria-hidden="true"
            />

            <div
                className="nx-login__gradient-flow"
                aria-hidden="true"
            />

            <div
                className="nx-login__mesh"
                aria-hidden="true"
            />

            <div
                className="nx-login__grain"
                aria-hidden="true"
            />

            <div
                className="nx-login__beam"
                aria-hidden="true"
            />

            <section className="nx-verify__shell">
                <motion.header
                    className="nx-brand nx-verify__brand"
                    initial={{
                        opacity: 0,
                        y: -14,
                    }}
                    animate={{
                        opacity: 1,
                        y: 0,
                    }}
                    transition={{
                        duration: 0.45,
                    }}
                >
                    <Link
                        className="nx-brand__link"
                        to="/"
                        aria-label="Go to Nexora home page"
                    >
                        <span className="nx-brand__symbol">
                            <Sparkles
                                size={22}
                                aria-hidden="true"
                            />
                        </span>

                        <span className="nx-brand__copy">
                            <strong>Nexora AI</strong>

                            <small>
                                Ideas built from real needs
                            </small>
                        </span>
                    </Link>

                    <span className="nx-brand__status">
                        <span aria-hidden="true" />

                        Secure verification
                    </span>
                </motion.header>

                <motion.section
                    className={
                        `nx-verify-card ` +
                        `nx-verify-card--${status}`
                    }
                    initial={{
                        opacity: 0,
                        y: 24,
                        scale: 0.98,
                    }}
                    animate={{
                        opacity: 1,
                        y: 0,
                        scale: 1,
                    }}
                    transition={{
                        duration: 0.62,
                        ease: [
                            0.22,
                            1,
                            0.36,
                            1,
                        ],
                    }}
                    aria-live="polite"
                >
                    <div
                        className="nx-verify-card__glow"
                        aria-hidden="true"
                    />

                    <span className="nx-verify-card__icon">
                        <StatusIcon
                            className={
                                status ===
                                    VERIFICATION_STATUS.VERIFYING
                                    ? 'nx-form__spinner'
                                    : ''
                            }
                            size={32}
                            aria-hidden="true"
                        />
                    </span>

                    <p className="nx-verify-card__eyebrow">
                        <ShieldCheck
                            size={15}
                            aria-hidden="true"
                        />

                        {statusConfig.eyebrow}
                    </p>

                    <h1>
                        {statusConfig.title}
                    </h1>

                    <p className="nx-verify-card__message">
                        {message}
                    </p>

                    {email && (
                        <div className="nx-verify-card__email">
                            <MailCheck
                                size={18}
                                aria-hidden="true"
                            />

                            <span>
                                {email}
                            </span>
                        </div>
                    )}

                    {attachedGuestIdeasCount > 0 && (
                        <p className="nx-verify-card__guest-note">
                            <CheckCircle2
                                size={16}
                                aria-hidden="true"
                            />

                            {attachedGuestIdeasCount}{' '}
                            {attachedGuestIdeasCount === 1
                                ? 'guest idea was'
                                : 'guest ideas were'}{' '}
                            safely attached to your new workspace.
                        </p>
                    )}

                    {status === VERIFICATION_STATUS.SUCCESS ? (
                        <Link
                            className="nx-verify-card__primary"
                            to="/login"
                        >
                            Continue to sign in

                            <ArrowRight
                                size={19}
                                aria-hidden="true"
                            />
                        </Link>
                    ) : (
                        <>
                            {email &&
                                status !==
                                VERIFICATION_STATUS.VERIFYING && (
                                    <button
                                        type="button"
                                        className="nx-verify-card__primary"
                                        onClick={handleResend}
                                        disabled={isResending}
                                    >
                                        {isResending ? (
                                            <>
                                                <LoaderCircle
                                                    className="nx-form__spinner"
                                                    size={18}
                                                    aria-hidden="true"
                                                />

                                                Requesting email...
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw
                                                    size={18}
                                                    aria-hidden="true"
                                                />

                                                Resend verification email
                                            </>
                                        )}
                                    </button>
                                )}

                            <Link
                                className="nx-verify-card__secondary"
                                to="/login"
                            >
                                Back to sign in
                            </Link>
                        </>
                    )}

                    {resendMessage && (
                        <p
                            className="nx-verify-card__resend-message"
                            role="status"
                        >
                            {resendMessage}
                        </p>
                    )}

                    {resendError && (
                        <p
                            className="
                                nx-verify-card__resend-message
                                nx-verify-card__resend-message--error
                            "
                            role="alert"
                        >
                            {resendError}
                        </p>
                    )}

                    <div
                        className="nx-verify-card__steps"
                        aria-hidden="true"
                    >
                        <span className="is-complete">
                            1
                        </span>

                        <i className="is-complete" />

                        <span
                            className={
                                status ===
                                    VERIFICATION_STATUS.SUCCESS
                                    ? 'is-complete'
                                    : 'is-current'
                            }
                        >
                            2
                        </span>

                        <i
                            className={
                                status ===
                                    VERIFICATION_STATUS.SUCCESS
                                    ? 'is-complete'
                                    : ''
                            }
                        />

                        <span
                            className={
                                status ===
                                    VERIFICATION_STATUS.SUCCESS
                                    ? 'is-current'
                                    : ''
                            }
                        >
                            3
                        </span>
                    </div>

                    <p className="nx-verify-card__step-labels">
                        <span>
                            Account
                        </span>

                        <span>
                            Verify
                        </span>

                        <span>
                            Discover
                        </span>
                    </p>
                </motion.section>
            </section>
        </main>
    );
}