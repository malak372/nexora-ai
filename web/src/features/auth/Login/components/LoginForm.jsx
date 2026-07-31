/**
 * Controlled login form for Nexora AI.
 *
 * Provides:
 * - Client-side validation.
 * - Accessible field states.
 * - Password visibility control.
 * - Remember-me preference.
 * - Animated backend error feedback.
 *
 * @author Malak
 */

import {
    AlertTriangle,
    ArrowRight,
    Check,
    Eye,
    EyeOff,
    LoaderCircle,
    LockKeyhole,
    Mail,
    X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ROUTES } from '../../../../constants/routes.constants';

/**
 * Practical client-side email format validation.
 *
 * This intentionally validates the shape only. The backend remains the
 * source of truth for whether an account actually exists.
 */
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i;

function isValidEmail(email) {
    const normalizedEmail = email.trim();

    return (
        normalizedEmail.length <= 254 &&
        !normalizedEmail.includes('..') &&
        EMAIL_PATTERN.test(normalizedEmail)
    );
}

/**
 * Validates login form values.
 *
 * @param {{email: string, password: string}} values Form values.
 * @returns {{email?: string, password?: string}} Validation errors.
 */
function validate(values) {
    const errors = {};

    if (!values.email.trim()) {
        errors.email = 'Email address is required.';
    } else if (!isValidEmail(values.email)) {
        errors.email = 'Enter a valid email address, such as name@example.com.';
    }

    if (!values.password) {
        errors.password = 'Password is required.';
    } else if (values.password.length < 8) {
        errors.password = 'Password must contain at least 8 characters.';
    }

    return errors;
}

export default function LoginForm({
    isSubmitting = false,
    onDismissError,
    onSubmit,
    serverError = '',
}) {
    const [values, setValues] = useState({
        email: '',
        password: '',
        rememberMe: false,
    });
    const [errors, setErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [touched, setTouched] = useState({});

    const isEmailFormatValid = useMemo(
        () =>
            Boolean(touched.email) &&
            isValidEmail(values.email) &&
            !errors.email,
        [errors.email, touched.email, values.email],
    );

    /**
     * Updates one form field and revalidates touched fields.
     *
     * @param {React.ChangeEvent<HTMLInputElement>} event Input event.
     */
    const handleChange = (event) => {
        const { checked, name, type, value } = event.target;

        setValues((current) => ({
            ...current,
            [name]: type === 'checkbox' ? checked : value,
        }));

        // Once a field has been touched, validate it while the user edits.
        // This prevents a stale green "Valid" state from remaining visible.
        if (touched[name]) {
            const nextValues = {
                ...values,
                [name]: type === 'checkbox' ? checked : value,
            };
            const nextErrors = validate(nextValues);

            setErrors((current) => ({
                ...current,
                [name]: nextErrors[name] || '',
            }));
        }

        onDismissError?.();
    };

    /**
     * Validates one field after the user leaves it.
     *
     * @param {React.FocusEvent<HTMLInputElement>} event Blur event.
     */
    const handleBlur = (event) => {
        const { name } = event.target;

        setTouched((current) => ({
            ...current,
            [name]: true,
        }));

        const nextErrors = validate(values);

        setErrors((current) => ({
            ...current,
            [name]: nextErrors[name] || '',
        }));
    };

    /**
     * Validates and submits the login form.
     *
     * @param {React.FormEvent<HTMLFormElement>} event Submit event.
     */
    const handleSubmit = async (event) => {
        event.preventDefault();

        const nextErrors = validate(values);
        setErrors(nextErrors);
        setTouched({
            email: true,
            password: true,
        });

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        await onSubmit({
            email: values.email.trim().toLowerCase(),
            password: values.password,
            rememberMe: values.rememberMe,
        });
    };

    return (
        <form className="nx-form" onSubmit={handleSubmit} noValidate>
            <AnimatePresence initial={false}>
                {serverError && (
                    <motion.div
                        className="nx-form__alert"
                        initial={{ opacity: 0, y: -8, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: 'auto' }}
                        exit={{ opacity: 0, y: -8, height: 0 }}
                        role="alert"
                    >
                        <span className="nx-form__alert-icon">
                            <AlertTriangle size={18} aria-hidden="true" />
                        </span>

                        <span className="nx-form__alert-copy">
                            <strong>Sign in failed</strong>
                            <small>{serverError}</small>
                        </span>

                        <button
                            type="button"
                            aria-label="Dismiss error"
                            onClick={onDismissError}
                        >
                            <X size={17} aria-hidden="true" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="nx-field">
                <div className="nx-field__label-row">
                    <label htmlFor="login-email">Email address</label>

                    {isEmailFormatValid && (
                        <span className="nx-field__verified">
                            <Check size={13} aria-hidden="true" />
                            Valid format
                        </span>
                    )}
                </div>

                <div
                    className={[
                        'nx-field__control',
                        errors.email && touched.email
                            ? 'nx-field__control--error'
                            : '',
                        isEmailFormatValid ? 'nx-field__control--valid' : '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                >
                    <Mail size={19} aria-hidden="true" />

                    <input
                        id="login-email"
                        name="email"
                        type="email"
                        value={values.email}
                        onBlur={handleBlur}
                        onChange={handleChange}
                        placeholder="name@example.com"
                        autoComplete="username"
                        disabled={isSubmitting}
                        aria-invalid={Boolean(errors.email && touched.email)}
                        aria-describedby={
                            errors.email ? 'login-email-error' : undefined
                        }
                    />

                    {isEmailFormatValid && (
                        <Check
                            className="nx-field__status-icon"
                            size={18}
                            aria-hidden="true"
                        />
                    )}
                </div>

                <AnimatePresence initial={false}>
                    {errors.email && touched.email && (
                        <motion.span
                            id="login-email-error"
                            className="nx-field__error"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                        >
                            {errors.email}
                        </motion.span>
                    )}
                </AnimatePresence>
            </div>

            <div className="nx-field">
                <div className="nx-field__label-row">
                    <label htmlFor="login-password">Password</label>

                    <Link to={ROUTES.FORGOT_PASSWORD}>
                        Forgot password?
                    </Link>
                </div>

                <div
                    className={[
                        'nx-field__control',
                        errors.password && touched.password
                            ? 'nx-field__control--error'
                            : '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                >
                    <LockKeyhole size={19} aria-hidden="true" />

                    <input
                        id="login-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={values.password}
                        onBlur={handleBlur}
                        onChange={handleChange}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        disabled={isSubmitting}
                        aria-invalid={Boolean(errors.password && touched.password)}
                        aria-describedby={
                            errors.password
                                ? 'login-password-error'
                                : undefined
                        }
                    />

                    <button
                        className="nx-field__action"
                        type="button"
                        onClick={() =>
                            setShowPassword((current) => !current)
                        }
                        aria-label={
                            showPassword
                                ? 'Hide password'
                                : 'Show password'
                        }
                        disabled={isSubmitting}
                    >
                        {showPassword ? (
                            <EyeOff size={19} aria-hidden="true" />
                        ) : (
                            <Eye size={19} aria-hidden="true" />
                        )}
                    </button>
                </div>

                <AnimatePresence initial={false}>
                    {errors.password && touched.password && (
                        <motion.span
                            id="login-password-error"
                            className="nx-field__error"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                        >
                            {errors.password}
                        </motion.span>
                    )}
                </AnimatePresence>
            </div>

            <div className="nx-form__options">
                <label className="nx-check">
                    <input
                        name="rememberMe"
                        type="checkbox"
                        checked={values.rememberMe}
                        onChange={handleChange}
                        disabled={isSubmitting}
                    />

                    <span className="nx-check__box" aria-hidden="true">
                        <Check size={13} />
                    </span>

                    <span>Keep me signed in</span>
                </label>

                <span className="nx-form__secure-note">
                    <ShieldDot />
                    Secure session
                </span>
            </div>

            <motion.button
                className="nx-form__submit"
                type="submit"
                disabled={isSubmitting}
                whileHover={isSubmitting ? undefined : { y: -2 }}
                whileTap={isSubmitting ? undefined : { scale: 0.985 }}
            >
                <span className="nx-form__submit-shine" aria-hidden="true" />

                {isSubmitting ? (
                    <>
                        <LoaderCircle
                            className="nx-form__spinner"
                            size={20}
                            aria-hidden="true"
                        />
                        Signing in...
                    </>
                ) : (
                    <>
                        Continue the discovery
                        <ArrowRight size={20} aria-hidden="true" />
                    </>
                )}
            </motion.button>

            <p className="nx-form__register">
                Ready to uncover your first signal?
                <Link to={ROUTES.REGISTER}>Start discovering</Link>
            </p>
        </form>
    );
}

/**
 * Small decorative status icon used beside the session note.
 */
function ShieldDot() {
    return (
        <span className="nx-secure-dot" aria-hidden="true">
            <span />
        </span>
    );
}