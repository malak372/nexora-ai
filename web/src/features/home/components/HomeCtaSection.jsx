/**
 * Renders the final value proposition and backend-connected Contact Us section
 * on the Nexora public landing page.
 *
 * Guest messages are submitted to the public POST /contact endpoint. The
 * component provides client-side validation that mirrors the backend DTO,
 * prevents duplicate submissions while a request is active, and displays
 * accessible success and error feedback.
 *
 * @component
 * @returns {JSX.Element} The Nexora contact section.
 *
 * @author Eman
 */

import { useState } from 'react';
import {
    ArrowUpRight,
    CheckCircle2,
    CircleAlert,
    LoaderCircle,
    MessageSquareText,
    Send,
    Sparkles,
} from 'lucide-react';

import { submitContactMessage } from '../api/contact.api';
import { VALUE_POINTS } from '../constants/home.constants';

const INITIAL_FORM = {
    fullName: '',
    email: '',
    subject: '',
    message: '',
};

/**
 * Validates the contact form using the same limits defined by the backend DTO.
 *
 * @param {typeof INITIAL_FORM} values Current form values.
 * @returns {Record<string, string>} Field-level validation messages.
 */
function validateContactForm(values) {
    const errors = {};

    const fullName = values.fullName.trim();
    const email = values.email.trim();
    const subject = values.subject.trim();
    const message = values.message.trim();

    if (fullName.length < 2) {
        errors.fullName = 'Please enter at least 2 characters.';
    } else if (fullName.length > 100) {
        errors.fullName = 'Name must not exceed 100 characters.';
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
        errors.email = 'Please enter a valid email address.';
    } else if (email.length > 150) {
        errors.email = 'Email must not exceed 150 characters.';
    }

    if (subject.length < 3) {
        errors.subject = 'Please enter at least 3 characters.';
    } else if (subject.length > 150) {
        errors.subject = 'Subject must not exceed 150 characters.';
    }

    if (message.length < 10) {
        errors.message = 'Please enter at least 10 characters.';
    } else if (message.length > 2000) {
        errors.message = 'Message must not exceed 2,000 characters.';
    }

    return errors;
}

/**
 * Resolves a readable error from an Axios or backend validation response.
 *
 * @param {unknown} error Request failure.
 * @returns {string} User-facing message.
 */
function resolveSubmitError(error) {
    const serverMessage = error?.response?.data?.message;

    if (Array.isArray(serverMessage) && serverMessage.length > 0) {
        return serverMessage[0];
    }

    if (typeof serverMessage === 'string' && serverMessage.trim()) {
        return serverMessage;
    }

    if (error?.code === 'ECONNABORTED') {
        return 'The request took too long. Please try again.';
    }

    if (!error?.response) {
        return 'The server is currently unavailable. Please check your connection.';
    }

    return 'We could not send your message right now. Please try again.';
}

/**
 * Displays Nexora's main landing-page call-to-action and contact form.
 *
 * @returns {JSX.Element}
 */
export default function HomeCtaSection() {
    const [formValues, setFormValues] = useState(INITIAL_FORM);

    const [fieldErrors, setFieldErrors] = useState({});

    const [submitState, setSubmitState] = useState({
        status: 'idle',
        message: '',
        referenceId: '',
    });

    const isSubmitting = submitState.status === 'loading';
    const messageLength = formValues.message.length;

    /**
     * Updates form values and clears the error of the edited field.
     *
     * @param {React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>} event
     */
    function handleFieldChange(event) {
        const { name, value } = event.target;

        setFormValues((currentValues) => ({
            ...currentValues,
            [name]: value,
        }));

        if (fieldErrors[name]) {
            setFieldErrors((currentErrors) => ({
                ...currentErrors,
                [name]: '',
            }));
        }

        if (submitState.status !== 'idle') {
            setSubmitState({
                status: 'idle',
                message: '',
                referenceId: '',
            });
        }
    }

    /**
     * Validates and submits the contact form to the backend.
     *
     * @param {React.FormEvent<HTMLFormElement>} event
     */
    async function handleSubmit(event) {
        event.preventDefault();

        if (isSubmitting) {
            return;
        }

        const validationErrors = validateContactForm(formValues);

        setFieldErrors(validationErrors);

        if (Object.keys(validationErrors).length > 0) {
            setSubmitState({
                status: 'error',
                message: 'Please review the highlighted fields.',
                referenceId: '',
            });

            return;
        }

        setSubmitState({
            status: 'loading',
            message: '',
            referenceId: '',
        });

        try {
            const response = await submitContactMessage({
                fullName: formValues.fullName.trim(),
                email: formValues.email.trim().toLowerCase(),
                subject: formValues.subject.trim(),
                message: formValues.message.trim(),
            });

            setFormValues(INITIAL_FORM);
            setFieldErrors({});

            setSubmitState({
                status: 'success',
                message:
                    response?.message ||
                    'Your message was sent successfully. Our team will review it soon.',
                referenceId:
                    response?.contactMessage?.id ||
                    response?.data?.id ||
                    response?.id ||
                    '',
            });
        } catch (error) {
            setSubmitState({
                status: 'error',
                message: resolveSubmitError(error),
                referenceId: '',
            });
        }
    }

    return (
        <section
            id="contact"
            className="scroll-mt-24 py-24 sm:py-32"
            aria-labelledby="contact-heading"
        >
            <div className="nexora-container">
                <div className="contact-panel relative overflow-hidden rounded-[2.5rem] border border-white/90 px-6 py-12 shadow-[0_28px_70px_rgba(96,73,134,0.12)] sm:px-10 lg:px-14 lg:py-14">
                    <div
                        className="contact-orb"
                        aria-hidden="true"
                    />

                    <div
                        className="contact-orb contact-orb-secondary"
                        aria-hidden="true"
                    />

                    <div className="relative z-10 grid gap-12 lg:grid-cols-[.88fr_1.12fr] lg:items-start">
                        <div className="lg:sticky lg:top-28">
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/70 px-4 py-2 text-sm font-bold text-[#7656c6] backdrop-blur-xl">
                                <Sparkles
                                    size={16}
                                    aria-hidden="true"
                                />

                                Built for meaningful innovation
                            </span>

                            <h2
                                id="contact-heading"
                                className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-[#29213d] sm:text-5xl"
                            >
                                Better project ideas begin with better evidence.
                            </h2>

                            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#716a81]">
                                Nexora helps students, builders, and innovators
                                move beyond guesswork and discover software
                                opportunities grounded in real community needs.
                            </p>

                            <div className="mt-8 space-y-3">
                                {VALUE_POINTS.map((point) => (
                                    <div
                                        key={point}
                                        className="flex items-center gap-3 text-sm font-semibold text-[#352b47] sm:text-base"
                                    >
                                        <CheckCircle2
                                            className="shrink-0 text-[#5da68b]"
                                            size={19}
                                            aria-hidden="true"
                                        />

                                        <span>{point}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-9 flex items-start gap-4 rounded-[1.5rem] border border-white/80 bg-white/55 p-5 backdrop-blur-xl">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#eee8fb] text-[#7656c6]">
                                    <MessageSquareText
                                        size={21}
                                        aria-hidden="true"
                                    />
                                </div>

                                <div>
                                    <p className="font-extrabold text-[#342947]">
                                        Your message stays organized
                                    </p>

                                    <p className="mt-1 text-sm leading-6 text-[#7a7287]">
                                        Every inquiry is securely submitted to
                                        Nexora and managed through our backend.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="contact-card rounded-[2rem] border border-white/95 bg-white/76 p-6 backdrop-blur-2xl sm:p-9">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#80778c]">
                                        Contact us
                                    </p>

                                    <h3 className="mt-2 text-2xl font-extrabold text-[#2a223d] sm:text-3xl">
                                        Tell us how we can help.
                                    </h3>
                                </div>

                                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8060ce] to-[#64a6d8] text-white shadow-[0_14px_30px_rgba(106,82,176,0.22)]">
                                    <Send
                                        size={23}
                                        aria-hidden="true"
                                    />
                                </div>
                            </div>

                            <form
                                className="mt-8 space-y-5"
                                onSubmit={handleSubmit}
                                noValidate
                            >
                                <div className="grid gap-5 sm:grid-cols-2">
                                    <ContactField
                                        id="contact-full-name"
                                        label="Full name"
                                        name="fullName"
                                        value={formValues.fullName}
                                        error={fieldErrors.fullName}
                                        placeholder="Your full name"
                                        autoComplete="name"
                                        minLength={2}
                                        maxLength={100}
                                        onChange={handleFieldChange}
                                        disabled={isSubmitting}
                                    />

                                    <ContactField
                                        id="contact-email"
                                        label="Email address"
                                        name="email"
                                        type="email"
                                        value={formValues.email}
                                        error={fieldErrors.email}
                                        placeholder="you@example.com"
                                        autoComplete="email"
                                        maxLength={150}
                                        onChange={handleFieldChange}
                                        disabled={isSubmitting}
                                    />
                                </div>

                                <ContactField
                                    id="contact-subject"
                                    label="Subject"
                                    name="subject"
                                    value={formValues.subject}
                                    error={fieldErrors.subject}
                                    placeholder="What would you like to discuss?"
                                    minLength={3}
                                    maxLength={150}
                                    onChange={handleFieldChange}
                                    disabled={isSubmitting}
                                />

                                <div>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <label
                                            htmlFor="contact-message"
                                            className="text-sm font-extrabold text-[#403451]"
                                        >
                                            Message
                                        </label>

                                        <span className="text-xs font-semibold text-[#91889d]">
                                            {messageLength}/2000
                                        </span>
                                    </div>

                                    <textarea
                                        id="contact-message"
                                        name="message"
                                        rows={6}
                                        value={formValues.message}
                                        onChange={handleFieldChange}
                                        placeholder="Share the details of your question, feedback, or request..."
                                        minLength={10}
                                        maxLength={2000}
                                        disabled={isSubmitting}
                                        aria-invalid={Boolean(
                                            fieldErrors.message
                                        )}
                                        aria-describedby={
                                            fieldErrors.message
                                                ? 'contact-message-error'
                                                : undefined
                                        }
                                        className={`contact-form-control min-h-[10rem] resize-y ${fieldErrors.message
                                                ? 'contact-form-control-error'
                                                : ''
                                            }`}
                                    />

                                    {fieldErrors.message && (
                                        <p
                                            id="contact-message-error"
                                            className="contact-field-error"
                                        >
                                            {fieldErrors.message}
                                        </p>
                                    )}
                                </div>

                                {submitState.status === 'success' && (
                                    <div
                                        className="contact-feedback contact-feedback-success"
                                        role="status"
                                        aria-live="polite"
                                    >
                                        <CheckCircle2
                                            size={20}
                                            aria-hidden="true"
                                        />

                                        <div>
                                            <p>{submitState.message}</p>

                                            {submitState.referenceId && (
                                                <p className="mt-1 break-all text-xs font-semibold opacity-75">
                                                    Reference:{' '}
                                                    {submitState.referenceId}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {submitState.status === 'error' && (
                                    <div
                                        className="contact-feedback contact-feedback-error"
                                        role="alert"
                                        aria-live="assertive"
                                    >
                                        <CircleAlert
                                            size={20}
                                            aria-hidden="true"
                                        />

                                        <p>{submitState.message}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="nexora-button-primary group w-full gap-3"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <LoaderCircle
                                                className="animate-spin"
                                                size={19}
                                                aria-hidden="true"
                                            />

                                            Sending message...
                                        </>
                                    ) : (
                                        <>
                                            Send message

                                            <ArrowUpRight
                                                className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1"
                                                size={19}
                                                aria-hidden="true"
                                            />
                                        </>
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

/**
 * Reusable labelled input used by the contact form.
 *
 * @param {{
 *   id: string,
 *   label: string,
 *   error?: string,
 * }} props Field properties.
 * @returns {JSX.Element}
 */
function ContactField({ id, label, error, ...inputProps }) {
    const errorId = `${id}-error`;

    return (
        <div>
            <label
                htmlFor={id}
                className="mb-2 block text-sm font-extrabold text-[#403451]"
            >
                {label}
            </label>

            <input
                id={id}
                {...inputProps}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className={`contact-form-control ${error ? 'contact-form-control-error' : ''
                    }`}
            />

            {error && (
                <p
                    id={errorId}
                    className="contact-field-error"
                >
                    {error}
                </p>
            )}
        </div>
    );
}