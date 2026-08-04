/**
 * Renders the Nexora account-registration form.
 *
 * The component validates all registration fields on the client,
 * submits only the properties accepted by the backend RegisterDto,
 * and redirects the user to the email-verification waiting page
 * after a successful registration.
 *
 * @component
 * @returns {JSX.Element} The complete registration form.
 *
 * @author Eman
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
    AlertTriangle,
    ArrowRight,
    BriefcaseBusiness,
    Building2,
    Check,
    CheckCircle2,
    Code2,
    Eye,
    EyeOff,
    GraduationCap,
    LoaderCircle,
    LockKeyhole,
    Mail,
    RefreshCw,
    SearchCode,
    UserRound,
} from 'lucide-react';

import {
    getRegisterErrorMessage,
    registerUser,
} from '../api/register.api';

import {
    resendVerificationEmail,
    verifyEmail,
} from '../EmailVerification/api/email-verification.api';

/**
 * Available user classifications supported by the backend UserType enum.
 *
 * The values must remain synchronized with Prisma's UserType enum.
 *
 * @type {Array<{
 *     value: string,
 *     label: string,
 *     description: string,
 *     icon: import('lucide-react').LucideIcon
 * }>}
 */
const USER_TYPE_OPTIONS = [
    {
        value: 'STUDENT',
        label: 'Student',
        description: 'Explore project opportunities for learning and graduation.',
        icon: GraduationCap,
    },
    {
        value: 'DEVELOPER',
        label: 'Developer',
        description: 'Discover evidence-driven products worth building.',
        icon: Code2,
    },
    {
        value: 'RESEARCHER',
        label: 'Researcher',
        description: 'Turn community signals into research directions.',
        icon: SearchCode,
    },
    {
        value: 'COMPANY',
        label: 'Company',
        description: 'Identify practical opportunities for real markets.',
        icon: Building2,
    },
    {
        value: 'OTHER',
        label: 'Other',
        description: 'Use Nexora for another discovery goal.',
        icon: BriefcaseBusiness,
    },
];

/**
 * Initial registration-form values.
 *
 * @type {{
 *     fullName: string,
 *     email: string,
 *     password: string,
 *     confirmPassword: string,
 *     userType: string,
 *     acceptedTerms: boolean
 * }}
 */
const INITIAL_FORM_VALUES = {
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    userType: 'STUDENT',
    acceptedTerms: false,
};

/**
 * Basic email validation expression.
 *
 * Backend validation remains the final source of truth.
 *
 * @type {RegExp}
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password requirements mirrored from the backend RegisterDto.
 *
 * The backend requires:
 * - At least six characters.
 * - At least one letter.
 * - At least one number.
 *
 * @param {string} password - Password to evaluate.
 * @returns {{
 *     minimumLength: boolean,
 *     containsLetter: boolean,
 *     containsNumber: boolean
 * }}
 */
function getPasswordChecks(password) {
    return {
        minimumLength: password.length >= 6,
        containsLetter: /[A-Za-z]/.test(password),
        containsNumber: /\d/.test(password),
    };
}

/**
 * Validates the registration form before submission.
 *
 * @param {typeof INITIAL_FORM_VALUES} values - Current form values.
 * @returns {Record<string, string>} Field-specific validation messages.
 */
function validateRegistrationForm(values) {
    const errors = {};
    const normalizedFullName = values.fullName.trim();
    const normalizedEmail = values.email.trim();
    const passwordChecks = getPasswordChecks(values.password);

    if (!normalizedFullName) {
        errors.fullName = 'Full name is required.';
    }

    if (!normalizedEmail) {
        errors.email = 'Email address is required.';
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
        errors.email = 'Enter a valid email address.';
    }

    if (!values.password) {
        errors.password = 'Password is required.';
    } else if (
        !passwordChecks.minimumLength ||
        !passwordChecks.containsLetter ||
        !passwordChecks.containsNumber
    ) {
        errors.password =
            'Use at least 6 characters with one letter and one number.';
    }

    if (!values.confirmPassword) {
        errors.confirmPassword = 'Confirm your password.';
    } else if (values.password !== values.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match.';
    }

    if (!USER_TYPE_OPTIONS.some(
        (option) => option.value === values.userType,
    )) {
        errors.userType = 'Select a valid account type.';
    }

    if (!values.acceptedTerms) {
        errors.acceptedTerms =
            'You must accept the Terms and Privacy Policy.';
    }

    return errors;
}

/**
 * Displays the registration form and manages its submission state.
 *
 * @returns {JSX.Element}
 */
export default function RegisterForm() {
    const [formValues, setFormValues] = useState(INITIAL_FORM_VALUES);
    const [fieldErrors, setFieldErrors] = useState({});
    const [submitError, setSubmitError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const [verificationModal, setVerificationModal] = useState({
        isOpen: false,
        email: '',
        emailDeliveryFailed: false,
        message: '',
    });

    const [isResendingVerification, setIsResendingVerification] =
        useState(false);
    const [resendMessage, setResendMessage] = useState('');
    const [resendError, setResendError] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [verificationError, setVerificationError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [legalModal, setLegalModal] = useState(null);

    const passwordChecks = useMemo(
        () => getPasswordChecks(formValues.password),
        [formValues.password],
    );

    /**
     * Updates one form value and clears its existing validation message.
     *
     * @param {React.ChangeEvent<
     *     HTMLInputElement | HTMLSelectElement
     * >} event - Field change event.
     * @returns {void}
     */
    function handleFieldChange(event) {
        const {
            name,
            type,
            checked,
            value,
        } = event.target;

        setFormValues((currentValues) => ({
            ...currentValues,
            [name]: type === 'checkbox' ? checked : value,
        }));

        setFieldErrors((currentErrors) => {
            if (!currentErrors[name]) {
                return currentErrors;
            }

            const nextErrors = {
                ...currentErrors,
            };

            delete nextErrors[name];

            return nextErrors;
        });

        if (submitError) {
            setSubmitError('');
        }
    }

    /**
     * Selects one account type.
     *
     * @param {string} userType - Backend UserType enum value.
     * @returns {void}
     */
    function handleUserTypeChange(userType) {
        setFormValues((currentValues) => ({
            ...currentValues,
            userType,
        }));

        setFieldErrors((currentErrors) => {
            if (!currentErrors.userType) {
                return currentErrors;
            }

            const nextErrors = {
                ...currentErrors,
            };

            delete nextErrors.userType;

            return nextErrors;
        });
    }

    function handleCloseVerificationModal() {
        setVerificationModal((currentModal) => ({
            ...currentModal,
            isOpen: false,
        }));
        setResendMessage('');
        setResendError('');
        setVerificationCode('');
        setVerificationError('');
        setIsVerified(false);
    }


    function handleVerificationCodeChange(event) {
        setVerificationCode(
            event.target.value.replace(/\D/g, '').slice(0, 6),
        );
        setVerificationError('');
    }

    async function handleVerifyEmail(event) {
        event.preventDefault();

        if (verificationCode.length !== 6 || isVerifying) {
            return;
        }

        setIsVerifying(true);
        setVerificationError('');
        setResendMessage('');

        try {
            const result = await verifyEmail({
                email: verificationModal.email,
                code: verificationCode,
            });

            setIsVerified(true);
            setVerificationModal((currentModal) => ({
                ...currentModal,
                message:
                    result?.message ||
                    'Your email was verified successfully. Your Voxidence workspace is ready.',
            }));
        } catch (error) {
            setVerificationError(
                error?.message ||
                'The verification code is invalid or has expired.',
            );
        } finally {
            setIsVerifying(false);
        }
    }

    async function handleResendVerification() {
        if (!verificationModal.email || isResendingVerification) {
            return;
        }

        setIsResendingVerification(true);
        setResendMessage('');
        setResendError('');

        try {
            const result = await resendVerificationEmail(
                verificationModal.email,
            );

            const successMessage =
                result?.message ||
                'A new verification code was sent successfully.';

            setVerificationModal((currentModal) => ({
                ...currentModal,
                emailDeliveryFailed: false,
                message: successMessage,
            }));
            setVerificationCode('');
            setVerificationError('');
            setResendMessage(successMessage);
        } catch (error) {
            setResendError(
                error?.message ||
                'The verification code could not be sent. Please try again.',
            );
        } finally {
            setIsResendingVerification(false);
        }
    }

    /**
     * Validates and submits the registration form.
     *
     * Confirm-password and terms fields remain frontend-only and are
     * intentionally not sent to the backend.
     *
     * @param {React.FormEvent<HTMLFormElement>} event - Submit event.
     * @returns {Promise<void>}
     */
    async function handleSubmit(event) {
        event.preventDefault();

        if (isSubmitting) {
            return;
        }

        const validationErrors =
            validateRegistrationForm(formValues);

        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            setSubmitError('');
            return;
        }

        setIsSubmitting(true);
        setSubmitError('');

        try {
            const result = await registerUser({
                fullName: formValues.fullName,
                email: formValues.email,
                password: formValues.password,
                userType: formValues.userType,
            });

            setVerificationModal({
                isOpen: true,
                email: formValues.email.trim().toLowerCase(),
                emailDeliveryFailed: false,
                message:
                    result?.message ||
                    'Your account was created. Check your inbox for the six-digit verification code.',
            });
        } catch (error) {
            const errorMessage = getRegisterErrorMessage(error);
            const normalizedErrorMessage =
                errorMessage.toLowerCase();

            const accountWasCreated =
                normalizedErrorMessage.includes(
                    'account was created',
                ) &&
                normalizedErrorMessage.includes(
                    'verification email',
                );

            if (accountWasCreated) {
                setVerificationModal({
                    isOpen: true,
                    email: formValues.email
                        .trim()
                        .toLowerCase(),
                    emailDeliveryFailed: true,
                    message: errorMessage,
                });

                return;
            }

            setSubmitError(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <>
            <form
                className="register-form"
                onSubmit={handleSubmit}
                noValidate
            >
                {/* Full-name field */}
                <div className="register-field">
                    <label
                        className="register-label"
                        htmlFor="register-full-name"
                    >
                        Full name
                    </label>

                    <div
                        className={`register-input-shell ${fieldErrors.fullName
                            ? 'register-input-shell-error'
                            : ''
                            }`}
                    >
                        <UserRound
                            size={19}
                            aria-hidden="true"
                        />

                        <input
                            id="register-full-name"
                            name="fullName"
                            type="text"
                            value={formValues.fullName}
                            onChange={handleFieldChange}
                            placeholder="Your full name"
                            autoComplete="name"
                            maxLength={120}
                            aria-invalid={Boolean(fieldErrors.fullName)}
                            aria-describedby={
                                fieldErrors.fullName
                                    ? 'register-full-name-error'
                                    : undefined
                            }
                        />
                    </div>

                    {fieldErrors.fullName && (
                        <p
                            id="register-full-name-error"
                            className="register-field-error"
                            role="alert"
                        >
                            {fieldErrors.fullName}
                        </p>
                    )}
                </div>

                {/* Email field */}
                <div className="register-field">
                    <label
                        className="register-label"
                        htmlFor="register-email"
                    >
                        Email address
                    </label>

                    <div
                        className={`register-input-shell ${fieldErrors.email
                            ? 'register-input-shell-error'
                            : ''
                            }`}
                    >
                        <Mail
                            size={19}
                            aria-hidden="true"
                        />

                        <input
                            id="register-email"
                            name="email"
                            type="email"
                            value={formValues.email}
                            onChange={handleFieldChange}
                            placeholder="name@example.com"
                            autoComplete="email"
                            inputMode="email"
                            spellCheck="false"
                            aria-invalid={Boolean(fieldErrors.email)}
                            aria-describedby={
                                fieldErrors.email
                                    ? 'register-email-error'
                                    : undefined
                            }
                        />
                    </div>

                    {fieldErrors.email && (
                        <p
                            id="register-email-error"
                            className="register-field-error"
                            role="alert"
                        >
                            {fieldErrors.email}
                        </p>
                    )}
                </div>

                {/* Account-type selection */}
                <fieldset className="register-user-type-fieldset">
                    <legend className="register-label">
                        I am joining as
                    </legend>

                    <div className="register-user-type-grid">
                        {USER_TYPE_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const isSelected =
                                formValues.userType === option.value;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    className={`register-user-type-card ${isSelected
                                        ? 'register-user-type-card-selected'
                                        : ''
                                        }`}
                                    onClick={() =>
                                        handleUserTypeChange(option.value)
                                    }
                                    aria-pressed={isSelected}
                                >
                                    <span className="register-user-type-icon">
                                        <Icon
                                            size={18}
                                            aria-hidden="true"
                                        />
                                    </span>

                                    <span className="register-user-type-copy">
                                        <strong>{option.label}</strong>
                                        <small>{option.description}</small>
                                    </span>

                                    {isSelected && (
                                        <span
                                            className="register-user-type-check"
                                            aria-hidden="true"
                                        >
                                            <Check size={14} />
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {fieldErrors.userType && (
                        <p
                            className="register-field-error"
                            role="alert"
                        >
                            {fieldErrors.userType}
                        </p>
                    )}
                </fieldset>

                {/* Password fields */}
                <div className="register-password-grid">
                    <div className="register-field">
                        <label
                            className="register-label"
                            htmlFor="register-password"
                        >
                            Password
                        </label>

                        <div
                            className={`register-input-shell ${fieldErrors.password
                                ? 'register-input-shell-error'
                                : ''
                                }`}
                        >
                            <LockKeyhole
                                size={19}
                                aria-hidden="true"
                            />

                            <input
                                id="register-password"
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                value={formValues.password}
                                onChange={handleFieldChange}
                                placeholder="Create a password"
                                autoComplete="new-password"
                                aria-invalid={Boolean(fieldErrors.password)}
                                aria-describedby={
                                    fieldErrors.password
                                        ? 'register-password-error'
                                        : 'register-password-help'
                                }
                            />

                            <button
                                type="button"
                                className="register-password-toggle"
                                onClick={() =>
                                    setShowPassword((current) => !current)
                                }
                                aria-label={
                                    showPassword
                                        ? 'Hide password'
                                        : 'Show password'
                                }
                            >
                                {showPassword ? (
                                    <EyeOff
                                        size={18}
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <Eye
                                        size={18}
                                        aria-hidden="true"
                                    />
                                )}
                            </button>
                        </div>

                        {fieldErrors.password ? (
                            <p
                                id="register-password-error"
                                className="register-field-error"
                                role="alert"
                            >
                                {fieldErrors.password}
                            </p>
                        ) : (
                            <div
                                id="register-password-help"
                                className="register-password-checks"
                            >
                                <PasswordRequirement
                                    isValid={passwordChecks.minimumLength}
                                    label="6+ characters"
                                />

                                <PasswordRequirement
                                    isValid={passwordChecks.containsLetter}
                                    label="One letter"
                                />

                                <PasswordRequirement
                                    isValid={passwordChecks.containsNumber}
                                    label="One number"
                                />
                            </div>
                        )}
                    </div>

                    <div className="register-field">
                        <label
                            className="register-label"
                            htmlFor="register-confirm-password"
                        >
                            Confirm password
                        </label>

                        <div
                            className={`register-input-shell ${fieldErrors.confirmPassword
                                ? 'register-input-shell-error'
                                : ''
                                }`}
                        >
                            <LockKeyhole
                                size={19}
                                aria-hidden="true"
                            />

                            <input
                                id="register-confirm-password"
                                name="confirmPassword"
                                type={
                                    showConfirmPassword
                                        ? 'text'
                                        : 'password'
                                }
                                value={formValues.confirmPassword}
                                onChange={handleFieldChange}
                                placeholder="Confirm password"
                                autoComplete="new-password"
                                aria-invalid={Boolean(
                                    fieldErrors.confirmPassword,
                                )}
                                aria-describedby={
                                    fieldErrors.confirmPassword
                                        ? 'register-confirm-password-error'
                                        : undefined
                                }
                            />

                            <button
                                type="button"
                                className="register-password-toggle"
                                onClick={() =>
                                    setShowConfirmPassword(
                                        (current) => !current,
                                    )
                                }
                                aria-label={
                                    showConfirmPassword
                                        ? 'Hide confirmed password'
                                        : 'Show confirmed password'
                                }
                            >
                                {showConfirmPassword ? (
                                    <EyeOff
                                        size={18}
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <Eye
                                        size={18}
                                        aria-hidden="true"
                                    />
                                )}
                            </button>
                        </div>

                        {fieldErrors.confirmPassword && (
                            <p
                                id="register-confirm-password-error"
                                className="register-field-error"
                                role="alert"
                            >
                                {fieldErrors.confirmPassword}
                            </p>
                        )}
                    </div>
                </div>

                {/* Terms acceptance */}
                <div className="register-terms-row">
                    <label className="register-checkbox-label">
                        <input
                            name="acceptedTerms"
                            type="checkbox"
                            checked={formValues.acceptedTerms}
                            onChange={handleFieldChange}
                        />

                        <span
                            className="register-custom-checkbox"
                            aria-hidden="true"
                        >
                            {formValues.acceptedTerms && (
                                <Check size={14} />
                            )}
                        </span>

                        <span>
                            I agree to the{' '}
                            <button
                                type="button"
                                className="register-legal-link"
                                onClick={() => setLegalModal('terms')}
                            >
                                Terms of Service
                            </button>{' '}
                            and{' '}
                            <button
                                type="button"
                                className="register-legal-link"
                                onClick={() => setLegalModal('privacy')}
                            >
                                Privacy Policy
                            </button>
                            .
                        </span>
                    </label>

                    {fieldErrors.acceptedTerms && (
                        <p
                            className="register-field-error"
                            role="alert"
                        >
                            {fieldErrors.acceptedTerms}
                        </p>
                    )}
                </div>

                {/* API error */}
                {submitError && (
                    <div
                        className="register-submit-error"
                        role="alert"
                    >
                        {submitError}
                    </div>
                )}

                {/* Submit action */}
                <button
                    type="submit"
                    className="register-submit-button group"
                    disabled={isSubmitting}
                >
                    <span>
                        {isSubmitting
                            ? 'Creating your workspace...'
                            : 'Create my workspace'}
                    </span>

                    {!isSubmitting && (
                        <ArrowRight
                            size={20}
                            className="transition-transform duration-300 group-hover:translate-x-1"
                            aria-hidden="true"
                        />
                    )}

                    {isSubmitting && (
                        <span
                            className="register-submit-spinner"
                            aria-hidden="true"
                        />
                    )}
                </button>

                <p className="register-login-link">
                    Already have an account?{' '}
                    <Link to="/login">
                        Sign in
                    </Link>
                </p>
            </form>

            {legalModal && (
                <div className="register-legal-modal">
                    <button
                        type="button"
                        className="register-legal-modal__backdrop"
                        onClick={() => setLegalModal(null)}
                        aria-label="Close legal information"
                    />

                    <section
                        className="register-legal-modal__card"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="register-legal-title"
                    >
                        <div className="register-legal-modal__header">
                            <div>
                                <p>Voxidence</p>
                                <h2 id="register-legal-title">
                                    {legalModal === 'terms'
                                        ? 'Terms of Service'
                                        : 'Privacy Policy'}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setLegalModal(null)}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="register-legal-modal__content">
                            {legalModal === 'terms' ? (
                                <>
                                    <h3>Using Nexora responsibly</h3>
                                    <p>
                                        Voxidence helps users discover, generate, evaluate, and manage software project ideas. You must provide accurate account information and use the platform only for lawful, academic, research, or business purposes.
                                    </p>
                                    <h3>Your account and generated content</h3>
                                    <p>
                                        You are responsible for protecting your login credentials and for reviewing AI-generated output before relying on it. Generated ideas may contain incomplete or inaccurate information and do not replace legal, financial, technical, or professional advice.
                                    </p>
                                    <h3>Acceptable use</h3>
                                    <p>
                                        You may not misuse the service, attempt unauthorized access, disrupt platform operation, scrape protected data, violate intellectual-property rights, or use Nexora to create harmful or illegal content.
                                    </p>
                                    <h3>Availability and changes</h3>
                                    <p>
                                        Features, limits, pricing, and supported AI providers may change as the graduation project evolves. We may suspend access when necessary to protect users, data, or platform security.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h3>Information we process</h3>
                                    <p>
                                        Nexora may process your name, email address, account type, authentication data, generated ideas, publication activity, feedback, voting, ratings, payment records, and technical usage information needed to operate the platform.
                                    </p>
                                    <h3>Why we use it</h3>
                                    <p>
                                        We use this information to create and secure your account, deliver idea-generation features, save your workspace, support publications and interactions, process payments, improve reliability, and prevent abuse.
                                    </p>
                                    <h3>AI and service providers</h3>
                                    <p>
                                        Content submitted for generation may be sent to configured AI or infrastructure providers solely to perform the requested service. Payment details are handled by the selected payment provider and are not stored as raw card data by Nexora.
                                    </p>
                                    <h3>Your choices</h3>
                                    <p>
                                        You may review or update your profile information and request account deletion through supported settings. Some records may be retained when required for security, audit, payment, or legal obligations.
                                    </p>
                                </>
                            )}
                        </div>

                        <button
                            type="button"
                            className="register-legal-modal__accept"
                            onClick={() => setLegalModal(null)}
                        >
                            I understand
                        </button>
                    </section>
                </div>
            )}

            {verificationModal.isOpen && (
                <div className="register-verification-modal">
                    <div className="register-verification-modal__backdrop" />

                    <section
                        className={`register-verification-modal__card ${verificationModal.emailDeliveryFailed
                                ? 'register-verification-modal__card--error'
                                : 'register-verification-modal__card--success'
                            }`}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="register-verification-title"
                    >
                        <span className="register-verification-modal__icon">
                            {isVerified ? (
                                <CheckCircle2 size={30} aria-hidden="true" />
                            ) : verificationModal.emailDeliveryFailed ? (
                                <AlertTriangle size={30} aria-hidden="true" />
                            ) : (
                                <Mail size={30} aria-hidden="true" />
                            )}
                        </span>

                        <p className="register-verification-modal__eyebrow">
                            {isVerified ? 'Email verified' : 'Secure verification'}
                        </p>

                        <h2 id="register-verification-title">
                            {isVerified ? 'Your workspace is ready.' : 'Enter your verification code.'}
                        </h2>

                        <p className="register-verification-modal__message">
                            {verificationModal.message}
                        </p>

                        <div className="register-verification-modal__email">
                            <Mail size={17} aria-hidden="true" />
                            <span>{verificationModal.email}</span>
                        </div>

                        {!isVerified ? (
                            <form
                                className="register-verification-modal__form"
                                onSubmit={handleVerifyEmail}
                            >
                                <label htmlFor="register-verification-code">
                                    Six-digit code
                                </label>
                                <input
                                    id="register-verification-code"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    value={verificationCode}
                                    onChange={handleVerificationCodeChange}
                                    placeholder="000000"
                                    disabled={isVerifying}
                                    autoFocus
                                />

                                <button
                                    type="submit"
                                    className="register-verification-modal__primary"
                                    disabled={isVerifying || verificationCode.length !== 6}
                                >
                                    {isVerifying ? (
                                        <>
                                            <LoaderCircle
                                                className="register-verification-modal__spinner"
                                                size={18}
                                            />
                                            Verifying...
                                        </>
                                    ) : (
                                        <>
                                            Verify email
                                            <ArrowRight size={18} aria-hidden="true" />
                                        </>
                                    )}
                                </button>
                            </form>
                        ) : (
                            <Link
                                className="register-verification-modal__primary"
                                to="/login"
                            >
                                Continue to sign in
                                <ArrowRight size={18} aria-hidden="true" />
                            </Link>
                        )}

                        {!isVerified && (
                            <>
                                <button
                                    type="button"
                                    className="register-verification-modal__secondary"
                                    onClick={handleResendVerification}
                                    disabled={isResendingVerification}
                                >
                                    {isResendingVerification ? (
                                        <>
                                            <LoaderCircle
                                                className="register-verification-modal__spinner"
                                                size={18}
                                            />
                                            Sending code...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw size={18} aria-hidden="true" />
                                            Resend verification code
                                        </>
                                    )}
                                </button>

                                <button
                                    type="button"
                                    className="register-verification-modal__edit"
                                    onClick={handleCloseVerificationModal}
                                >
                                    Edit registration details
                                </button>
                            </>
                        )}

                        {verificationError && (
                            <p className="register-verification-modal__feedback register-verification-modal__feedback--error" role="alert">
                                {verificationError}
                            </p>
                        )}

                        {resendMessage && (
                            <p className="register-verification-modal__feedback" role="status">
                                {resendMessage}
                            </p>
                        )}

                        {resendError && (
                            <p className="register-verification-modal__feedback register-verification-modal__feedback--error" role="alert">
                                {resendError}
                            </p>
                        )}
                    </section>
                </div>
            )}
        </>
    );
}

/**
 * Displays one password requirement.
 *
 * @param {Object} props - Component properties.
 * @param {boolean} props.isValid - Whether the requirement is met.
 * @param {string} props.label - Requirement label.
 * @returns {JSX.Element}
 */
function PasswordRequirement({
    isValid,
    label,
}) {
    return (
        <span
            className={
                isValid
                    ? 'register-password-check register-password-check-valid'
                    : 'register-password-check'
            }
        >
            <span
                className="register-password-check-icon"
                aria-hidden="true"
            >
                {isValid && <Check size={11} />}
            </span>

            {label}
        </span>
    );
}