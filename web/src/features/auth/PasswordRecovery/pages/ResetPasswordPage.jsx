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
 * This component is part of the Voxidence password-recovery flow and
 * follows the existing authentication design and visual identity.
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
    LockKeyhole,
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
 * A valid password must:
 * - Contain at least eight characters.
 * - Contain at least one alphabetical character.
 * - Contain at least one numeric character.
 *
 * @param {string} password
 * The password value that should be validated.
 *
 * @returns {{
 *     length: boolean,
 *     letter: boolean,
 *     number: boolean
 * }}
 * An object containing the validation result for every password rule.
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
 * The component extracts the reset token from the current URL, validates
 * the new password, confirms that both password fields match, and sends
 * the reset request to the backend.
 *
 * After a successful reset, the user is shown a confirmation message and
 * a link that returns them to the sign-in page.
 *
 * @component
 * @returns {JSX.Element} The rendered reset-password page.
 *
 * @author Eman
 */
export default function ResetPasswordPage() {
    /**
     * Provides access to the current URL query parameters.
     *
     * @type {URLSearchParams}
     */
    const [searchParams] = useSearchParams();

    /**
     * Password-reset token extracted from the URL.
     *
     * Expected URL format:
     * /reset-password?token=RESET_TOKEN
     *
     * @type {string}
     */
    const token = searchParams.get('token') || '';

    /**
     * Stores the new password entered by the user.
     *
     * @type {[string, Function]}
     */
    const [password, setPassword] = useState('');

    /**
     * Stores the password-confirmation value.
     *
     * @type {[string, Function]}
     */
    const [confirmPassword, setConfirmPassword] = useState('');

    /**
     * Controls the visibility of the new-password field.
     *
     * @type {[boolean, Function]}
     */
    const [showPassword, setShowPassword] = useState(false);

    /**
     * Controls the visibility of the confirmation-password field.
     *
     * @type {[boolean, Function]}
     */
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    /**
     * Stores the current validation or backend error message.
     *
     * @type {[string, Function]}
     */
    const [error, setError] = useState('');

    /**
     * Indicates whether the reset request is currently being processed.
     *
     * @type {[boolean, Function]}
     */
    const [isSubmitting, setIsSubmitting] = useState(false);

    /**
     * Indicates whether the password reset completed successfully.
     *
     * @type {[boolean, Function]}
     */
    const [isComplete, setIsComplete] = useState(false);

    /**
     * Calculates the current password validation state.
     *
     * The result is recalculated only when the password value changes.
     *
     * @type {{
     *     length: boolean,
     *     letter: boolean,
     *     number: boolean
     * }}
     */
    const passwordRules = useMemo(
        () => validatePassword(password),
        [password],
    );

    /**
     * Indicates whether every required password rule is satisfied.
     *
     * @type {boolean}
     */
    const isPasswordValid = Object.values(passwordRules).every(Boolean);

    /**
     * Validates the reset form and submits the new password to the backend.
     *
     * The submission is prevented when:
     * - The reset token is missing.
     * - The password does not meet the required rules.
     * - The password and confirmation values do not match.
     *
     * @async
     * @param {React.FormEvent<HTMLFormElement>} event
     * The form submission event.
     *
     * @returns {Promise<void>}
     * Resolves after the password-reset request finishes.
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
                    <strong>Voxidence</strong>
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
                        <ShieldCheck size={15} />
                        Secure password update
                    </span>

                    <h1>
                        Create a stronger key for
                        <span>your workspace.</span>
                    </h1>

                    <p>
                        Choose a fresh password for your Voxidence account. Once
                        it is changed, all active refresh sessions are revoked to
                        keep your workspace protected.
                    </p>

                    <div className="vx-recovery__security-panel">
                        <KeyRound size={25} />

                        <div>
                            <strong>
                                Your new password should be unique
                            </strong>

                            <span>
                                Avoid reusing a password from another website or
                                application.
                            </span>
                        </div>
                    </div>
                </motion.aside>

                <motion.section
                    className="vx-recovery__card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.08 }}
                >
                    {!isComplete ? (
                        <>
                            <div className="vx-recovery__icon">
                                <LockKeyhole size={25} />
                            </div>

                            <span className="vx-recovery__step">
                                Final recovery step
                            </span>

                            <h2>Set a new password</h2>

                            <p className="vx-recovery__card-copy">
                                Make it secure, memorable, and different from
                                your current password.
                            </p>

                            <form
                                onSubmit={handleSubmit}
                                noValidate
                            >
                                <label htmlFor="reset-password">
                                    New password
                                </label>

                                <div className="vx-recovery__field">
                                    <LockKeyhole size={19} />

                                    <input
                                        id="reset-password"
                                        type={
                                            showPassword
                                                ? 'text'
                                                : 'password'
                                        }
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

                                <div className="vx-recovery__rules">
                                    <span
                                        className={
                                            passwordRules.length
                                                ? 'is-valid'
                                                : ''
                                        }
                                    >
                                        <Check size={13} />
                                        At least 8 characters
                                    </span>

                                    <span
                                        className={
                                            passwordRules.letter
                                                ? 'is-valid'
                                                : ''
                                        }
                                    >
                                        <Check size={13} />
                                        Contains a letter
                                    </span>

                                    <span
                                        className={
                                            passwordRules.number
                                                ? 'is-valid'
                                                : ''
                                        }
                                    >
                                        <Check size={13} />
                                        Contains a number
                                    </span>
                                </div>

                                <label htmlFor="confirm-password">
                                    Confirm password
                                </label>

                                <div className="vx-recovery__field">
                                    <LockKeyhole size={19} />

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
                            <div className="vx-recovery__icon vx-recovery__icon--success">
                                <CheckCircle2 size={27} />
                            </div>

                            <span className="vx-recovery__step">
                                Password updated
                            </span>

                            <h2>You are ready to return</h2>

                            <p>
                                Your password has been reset successfully. Sign
                                in again using your new password.
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
