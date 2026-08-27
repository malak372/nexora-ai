/**
 * @file ResetPasswordPage.jsx
 * @description
 * Renders the Voxidence reset-password page.
 *
 * The page allows users to:
 * - Read the password-reset token from the URL query parameters.
 * - Enter and confirm a new account password.
 * - Validate the password against the required security rules.
 * - Show or hide the entered passwords.
 * - Submit the new password to the password-recovery API.
 * - Display a success state after the password is updated.
 *
 * @author Eman
 */

import {
    ArrowLeft,
    ArrowRight,
    Check,
    CheckCircle2,
    Eye,
    EyeOff,
    KeyRound,
    Lightbulb,
    LockKeyhole,
    LogIn,
    ShieldCheck,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import VoxidenceMark from '../../../../components/brand/VoxidenceMark';
import { ROUTES } from '../../../../constants/routes.constants';
import { resetPassword } from '../api/password-recovery.api';

import '../styles/password-recovery.css';

/**
 * Validates whether a password satisfies the minimum security requirements.
 *
 * @param {string} password Password value to validate.
 * @returns {{length: boolean, letter: boolean, number: boolean}}
 * Password rule results.
 *
 * @author Eman
 */
function validatePassword(password) {
    return {
        length: password.length >= 8,
        letter: /[A-Za-z]/.test(password),
        number: /\d/.test(password),
    };
}

/**
 * Displays the final password-recovery step.
 *
 * @component
 * @returns {JSX.Element} The rendered reset-password page.
 *
 * @author Eman
 */
export default function ResetPasswordPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') || '';

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isComplete, setIsComplete] = useState(false);

    const passwordRules = useMemo(
        () => validatePassword(password),
        [password],
    );

    const isPasswordValid = Object.values(passwordRules).every(Boolean);

    /**
     * Validates and submits the new password.
     *
     * @param {React.FormEvent<HTMLFormElement>} event Form submit event.
     * @returns {Promise<void>}
     */
    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');

        if (!token) {
            setError(
                'This reset link is missing or invalid. Request a new one.',
            );
            return;
        }

        if (!isPasswordValid) {
            setError('Your password must meet all requirements.');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setIsSubmitting(true);

        try {
            await resetPassword(token, password);
            setIsComplete(true);
        } catch (requestError) {
            setError(
                requestError?.message ||
                'Unable to reset your password. Request a new link.',
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <main className="vx-recovery vx-recovery--reset">
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
                <span className="vx-recovery__brand-mark vx-recovery__brand-mark--reset">
                    <VoxidenceMark size={46} />
                </span>

                <span>
                    <strong dir="ltr" data-no-auto-translate="true">Voxidence</strong>
                    <small>Ideas built from real needs</small>
                </span>
            </Link>

            <section className="vx-recovery__layout">
                <motion.aside
                    className="vx-recovery__story vx-recovery__story--reset"
                    initial={{ opacity: 0, x: -24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.55 }}
                >
                    <span className="vx-recovery__eyebrow">
                        <ShieldCheck size={15} />
                        Secure password reset
                    </span>

                    <h1>
                        A fresh key for
                        <span>your workspace.</span>
                    </h1>

                    <p>
                        Set a new password and return to your ideas with a fresh,
                        protected sign-in. Your saved work and account data stay
                        exactly where they are.
                    </p>

                    <div className="vx-recovery__reset-details">
                        <article>
                            <span className="vx-recovery__reset-detail-icon">
                                <KeyRound size={18} />
                            </span>

                            <div>
                                <strong>One secure update</strong>
                                <span>
                                    Your new password replaces the old one immediately.
                                </span>
                            </div>
                        </article>

                        <article>
                            <span className="vx-recovery__reset-detail-icon">
                                <LogIn size={18} />
                            </span>

                            <div>
                                <strong>Fresh sign-in</strong>
                                <span>
                                    Existing sessions are closed after the reset.
                                </span>
                            </div>
                        </article>

                        <article>
                            <span className="vx-recovery__reset-detail-icon">
                                <Lightbulb size={18} />
                            </span>

                            <div>
                                <strong>Your ideas stay safe</strong>
                                <span>
                                    Projects, saved ideas, and workspace data are unchanged.
                                </span>
                            </div>
                        </article>
                    </div>

                    <div className="vx-recovery__reset-note">
                        <ShieldCheck size={18} />
                        <span>
                            For better security, use a password you do not use on another account.
                        </span>
                    </div>
                </motion.aside>

                <motion.section
                    className="vx-recovery__card vx-recovery__card--reset"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.06 }}
                >
                    {!isComplete ? (
                        <>
                            <div className="vx-recovery__reset-card-head">
                                <div className="vx-recovery__reset-mark">
                                    <VoxidenceMark size={44} />
                                </div>

                                <span className="vx-recovery__step">
                                    Final recovery step
                                </span>
                            </div>

                            <h2>Choose a new password</h2>

                            <p className="vx-recovery__card-copy">
                                Make it memorable for you and difficult for anyone else to guess.
                            </p>

                            <form
                                onSubmit={handleSubmit}
                                noValidate
                            >
                                <label htmlFor="reset-password">
                                    New password
                                </label>

                                <div className="vx-recovery__field">
                                    <LockKeyhole size={18} />

                                    <input
                                        id="reset-password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(event) => {
                                            setPassword(event.target.value);
                                            setError('');
                                        }}
                                        placeholder="Enter a new password"
                                        autoComplete="new-password"
                                        disabled={isSubmitting}
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowPassword(
                                                (current) => !current,
                                            )
                                        }
                                        aria-label={
                                            showPassword
                                                ? 'Hide password'
                                                : 'Show password'
                                        }
                                    >
                                        {showPassword ? (
                                            <EyeOff size={18} />
                                        ) : (
                                            <Eye size={18} />
                                        )}
                                    </button>
                                </div>

                                <div className="vx-recovery__rules vx-recovery__rules--reset">
                                    <span
                                        className={
                                            passwordRules.length
                                                ? 'is-valid'
                                                : ''
                                        }
                                    >
                                        <Check size={12} />
                                        At least 8 characters
                                    </span>

                                    <span
                                        className={
                                            passwordRules.letter
                                                ? 'is-valid'
                                                : ''
                                        }
                                    >
                                        <Check size={12} />
                                        Contains a letter
                                    </span>

                                    <span
                                        className={
                                            passwordRules.number
                                                ? 'is-valid'
                                                : ''
                                        }
                                    >
                                        <Check size={12} />
                                        Contains a number
                                    </span>
                                </div>

                                <label htmlFor="confirm-password">
                                    Confirm password
                                </label>

                                <div className="vx-recovery__field">
                                    <LockKeyhole size={18} />

                                    <input
                                        id="confirm-password"
                                        type={
                                            showConfirmPassword
                                                ? 'text'
                                                : 'password'
                                        }
                                        value={confirmPassword}
                                        onChange={(event) => {
                                            setConfirmPassword(
                                                event.target.value,
                                            );
                                            setError('');
                                        }}
                                        placeholder="Repeat your new password"
                                        autoComplete="new-password"
                                        disabled={isSubmitting}
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowConfirmPassword(
                                                (current) => !current,
                                            )
                                        }
                                        aria-label={
                                            showConfirmPassword
                                                ? 'Hide password'
                                                : 'Show password'
                                        }
                                    >
                                        {showConfirmPassword ? (
                                            <EyeOff size={18} />
                                        ) : (
                                            <Eye size={18} />
                                        )}
                                    </button>
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
                                            Update password
                                            <ArrowRight size={18} />
                                        </>
                                    )}
                                </button>
                            </form>
                        </>
                    ) : (
                        <div className="vx-recovery__success">
                            <div className="vx-recovery__success-mark">
                                <CheckCircle2 size={32} />
                            </div>

                            <span className="vx-recovery__step">
                                Password updated
                            </span>

                            <h2>You are all set</h2>

                            <p>
                                Your password has been updated. Sign in again
                                to continue to your Voxidence workspace.
                            </p>

                            <Link
                                className="vx-recovery__submit"
                                to={ROUTES.LOGIN}
                            >
                                Go to sign in
                                <ArrowRight size={18} />
                            </Link>
                        </div>
                    )}

                    {!isComplete && (
                        <Link
                            className="vx-recovery__back"
                            to={ROUTES.LOGIN}
                        >
                            <ArrowLeft size={17} />
                            Back to sign in
                        </Link>
                    )}
                </motion.section>
            </section>
        </main>
    );
}
