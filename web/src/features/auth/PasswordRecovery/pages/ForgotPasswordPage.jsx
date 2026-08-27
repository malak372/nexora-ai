/**
 * @file ForgotPasswordPage.jsx
 * @description
 * Renders the Voxidence forgot-password page.
 *
 * The page allows users to:
 * - Enter the email address connected to their account.
 * - Request a secure password-reset email.
 * - View validation and backend error messages.
 * - View a confirmation message after the request succeeds.
 *
 * The component is connected to the password-recovery API and follows
 * the existing Voxidence visual identity and authentication flow.
 *
 * @author Eman
 */

import {
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    Clock3,
    Mail,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import VoxidenceMark from '../../../../components/brand/VoxidenceMark';
import { ROUTES } from '../../../../constants/routes.constants';
import { requestPasswordReset } from '../api/password-recovery.api';

import '../styles/password-recovery.css';

/**
 * Regular expression used to perform basic email-address validation.
 *
 * @constant
 * @type {RegExp}
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Displays the forgot-password page and handles password-reset requests.
 *
 * The component validates the entered email address before sending it
 * to the backend. After a successful request, it displays a generic
 * confirmation response to avoid revealing whether the email belongs
 * to an existing account.
 *
 * @component
 * @returns {JSX.Element} The rendered forgot-password page.
 *
 * @author Eman
 */
export default function ForgotPasswordPage() {
    const location = useLocation();

    /**
     * Stores the email address entered by the user.
     *
     * @type {[string, Function]}
     */
    const [email, setEmail] = useState(
        String(location.state?.email || '').trim().toLowerCase(),
    );

    /**
     * Stores the current validation or request error message.
     *
     * @type {[string, Function]}
     */
    const [error, setError] = useState('');

    /**
     * Indicates whether the reset request is currently being submitted.
     *
     * @type {[boolean, Function]}
     */
    const [isSubmitting, setIsSubmitting] = useState(false);

    /**
     * Indicates whether the password-reset request was submitted successfully.
     *
     * @type {[boolean, Function]}
     */
    const [isSent, setIsSent] = useState(false);

    /**
     * Validates the entered email address and requests a password-reset link.
     *
     * The email address is normalized by trimming surrounding whitespace
     * and converting it to lowercase before it is sent to the backend.
     *
     * @async
     * @param {React.FormEvent<HTMLFormElement>} event
     * The form submission event.
     *
     * @returns {Promise<void>} Resolves after the request is completed.
     */
    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');

        const normalizedEmail = email.trim().toLowerCase();

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            setError('Enter a valid email address.');
            return;
        }

        setIsSubmitting(true);

        try {
            await requestPasswordReset(normalizedEmail);
            setIsSent(true);
        } catch (requestError) {
            setError(
                requestError?.message ||
                'Unable to send the reset link. Please try again.',
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <main className="vx-recovery">
            <div
                className="vx-recovery__mesh"
                aria-hidden="true"
            />

            <div
                className="vx-recovery__glow vx-recovery__glow--one"
                aria-hidden="true"
            />

            <div
                className="vx-recovery__glow vx-recovery__glow--two"
                aria-hidden="true"
            />

            <Link
                className="vx-recovery__brand"
                to={ROUTES.HOME}
            >
                <span className="vx-recovery__brand-mark">
                    <VoxidenceMark size={24} />
                </span>

                <span>
                    <strong dir="ltr" data-no-auto-translate="true">Voxidence</strong>
                    <small>Ideas built from real needs</small>
                </span>
            </Link>

            <section className="vx-recovery__layout">
                <motion.aside
                    className="vx-recovery__story"
                    initial={{ opacity: 0, x: -28 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.65 }}
                >
                    <span className="vx-recovery__eyebrow">
                        <Sparkles size={15} />
                        Secure account recovery
                    </span>

                    <h1>
                        A simple path back to
                        <span>your ideas.</span>
                    </h1>

                    <p>
                        Enter the email connected to your account. We will send
                        a secure, time-limited link so you can choose a new
                        password without exposing your account details.
                    </p>

                    <div className="vx-recovery__benefits">
                        <article>
                            <ShieldCheck size={20} />

                            <div>
                                <strong>Protected by design</strong>
                                <span>
                                    Your reset token is stored securely.
                                </span>
                            </div>
                        </article>

                        <article>
                            <Clock3 size={20} />

                            <div>
                                <strong>15-minute link</strong>
                                <span>
                                    The link expires automatically.
                                </span>
                            </div>
                        </article>

                        <article>
                            <Mail size={20} />

                            <div>
                                <strong>Private response</strong>
                                <span>
                                    We never reveal whether an account exists.
                                </span>
                            </div>
                        </article>
                    </div>
                </motion.aside>

                <motion.section
                    className="vx-recovery__card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.08 }}
                >
                    {!isSent ? (
                        <>
                            <div className="vx-recovery__icon">
                                <Mail size={25} />
                            </div>

                            <span className="vx-recovery__step">
                                Account recovery
                            </span>

                            <h2>Forgot your password?</h2>

                            <p className="vx-recovery__card-copy">
                                No worries. Enter your email and we will send you
                                a reset link.
                            </p>

                            <form
                                onSubmit={handleSubmit}
                                noValidate
                            >
                                <label htmlFor="forgot-email">
                                    Email address
                                </label>

                                <div
                                    className={`vx-recovery__field ${error
                                        ? 'vx-recovery__field--error'
                                        : ''
                                        }`}
                                >
                                    <Mail size={19} />

                                    <input
                                        id="forgot-email"
                                        type="email"
                                        value={email}
                                        onChange={(event) => {
                                            setEmail(event.target.value);
                                            setError('');
                                        }}
                                        placeholder="name@example.com"
                                        autoComplete="email"
                                        disabled={isSubmitting}
                                    />
                                </div>

                                {error && (
                                    <span className="vx-recovery__error">
                                        {error}
                                    </span>
                                )}

                                <button
                                    className="vx-recovery__submit"
                                    type="submit"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <span className="vx-recovery__loader" />
                                    ) : (
                                        <>
                                            Send reset link
                                            <ArrowRight size={18} />
                                        </>
                                    )}
                                </button>
                            </form>
                        </>
                    ) : (
                        <div className="vx-recovery__success">
                            <div className="vx-recovery__icon vx-recovery__icon--success">
                                <CheckCircle2 size={27} />
                            </div>

                            <span className="vx-recovery__step">
                                Email sent
                            </span>

                            <h2>Check your inbox</h2>

                            <p>
                                If an active Voxidence account is connected to
                                <strong>
                                    {' '}
                                    {email.trim().toLowerCase()}
                                </strong>
                                , a password reset link has been sent.
                            </p>

                            <div className="vx-recovery__notice">
                                The link is valid for 15 minutes. Check your spam
                                folder if it does not appear shortly.
                            </div>

                            <button
                                className="vx-recovery__secondary"
                                type="button"
                                onClick={() => setIsSent(false)}
                            >
                                Use another email
                            </button>
                        </div>
                    )}

                    <Link
                        className="vx-recovery__back"
                        to={ROUTES.LOGIN}
                    >
                        <ArrowLeft size={17} />
                        Back to sign in
                    </Link>
                </motion.section>
            </section>
        </main>
    );
}
