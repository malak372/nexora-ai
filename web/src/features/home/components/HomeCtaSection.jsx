/**
 * Renders the final value proposition and backend-connected Contact Us section
 * on the Voxidence public landing page.
 *
 * Guest messages are submitted to the public POST /contact endpoint. The
 * component provides client-side validation that mirrors the backend DTO,
 * prevents duplicate submissions while a request is active, and displays
 * accessible success and error feedback.
 *
 * @component
 * @returns {JSX.Element} The Voxidence contact section.
 *
 * @author Eman
 */

import { useState } from 'react';
import {
    ArrowUpRight,
    CheckCircle2,
    CircleAlert,
    LoaderCircle,
    Mail,
    MessageSquareText,
    Send,
    Sparkles,
} from 'lucide-react';

import { useUserExperience } from '../../../system/user-experience';
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
 * Displays Voxidence's main landing-page call-to-action and contact form.
 *
 * @returns {JSX.Element}
 */
export default function HomeCtaSection() {
    const { t } = useUserExperience();
    const [formValues, setFormValues] = useState(INITIAL_FORM);

    const [fieldErrors, setFieldErrors] = useState({});

    const [submitState, setSubmitState] = useState({
        status: 'idle',
        message: '',
        referenceId: '',
        replyEmail: '',
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
                replyEmail: '',
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
                replyEmail: '',
            });

            return;
        }

        setSubmitState({
            status: 'loading',
            message: '',
            referenceId: '',
            replyEmail: '',
        });

        const submittedEmail = formValues.email.trim().toLowerCase();

        try {
            const response = await submitContactMessage({
                fullName: formValues.fullName.trim(),
                email: submittedEmail,
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
                replyEmail: submittedEmail,
            });
        } catch (error) {
            setSubmitState({
                status: 'error',
                message: resolveSubmitError(error),
                referenceId: '',
                replyEmail: '',
            });
        }
    }

    return (
        <section
            id="contact"
            className="vox-contact-section scroll-mt-24"
            aria-labelledby="contact-heading"
        >
            <div className="vox-contact-container">
                <div className="vox-contact-header">
                    <span className="vox-contact-eyebrow">
                        <Sparkles size={16} aria-hidden="true" />
                        {t('Start a meaningful conversation')}
                    </span>

                    <h2 id="contact-heading">
                        {t("Let's turn your question into") }
                        <span> {t('a clearer next step.')}</span>
                    </h2>

                    <p>
                        {t('Share your question, feedback, or collaboration idea. The Voxidence team will review the context and reply to the email you provide.')}
                    </p>
                </div>

                <div className="vox-contact-layout">
                    <div className="vox-contact-copy">
                        <div className="vox-contact-copy__top">
                            <span className="vox-contact-copy__icon">
                                <MessageSquareText size={22} aria-hidden="true" />
                            </span>

                            <div>
                                <p className="vox-contact-copy__label">{t('Why contact us')}</p>
                                <h3>{t('Bring us the context. We will help clarify the direction.')}</h3>
                            </div>
                        </div>

                        <p className="vox-contact-copy__description">
                            {t('Ask about the platform, share feedback, or tell us about a collaboration you are exploring. A clear message helps us respond with a useful next step.')}
                        </p>

                        <div className="vox-contact-values">
                            {VALUE_POINTS.slice(0, 3).map((point) => (
                                <div key={point}>
                                    <CheckCircle2 size={18} aria-hidden="true" />
                                    <span>{t(point)}</span>
                                </div>
                            ))}
                        </div>

                        <div className="vox-contact-note">
                            <Mail size={18} aria-hidden="true" />
                            <div>
                                <strong>{t('Your message stays connected')}</strong>
                                <span>
                                    {t('We keep your inquiry linked to the reply email you provide, so the conversation stays easy to follow.')}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="contact-card vox-contact-form-card">
                        <div className="vox-contact-form-card__header">
                            <div>
                                <p>{t('Contact Voxidence')}</p>
                                <h3>{t('Tell us how we can help.')}</h3>
                            </div>

                            <span>
                                <Send size={21} aria-hidden="true" />
                            </span>
                        </div>

                        <form
                            className="vox-contact-form"
                            onSubmit={handleSubmit}
                            noValidate
                        >
                            <div className="vox-contact-form__row">
                                <ContactField
                                    id="contact-full-name"
                                    label={t('Full name')}
                                    name="fullName"
                                    value={formValues.fullName}
                                    error={fieldErrors.fullName ? t(fieldErrors.fullName) : ''}
                                    placeholder={t('Your full name')}
                                    autoComplete="name"
                                    minLength={2}
                                    maxLength={100}
                                    onChange={handleFieldChange}
                                    disabled={isSubmitting}
                                />

                                <ContactField
                                    id="contact-email"
                                    label={t('Email address')}
                                    name="email"
                                    type="email"
                                    value={formValues.email}
                                    error={fieldErrors.email ? t(fieldErrors.email) : ''}
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    maxLength={150}
                                    onChange={handleFieldChange}
                                    disabled={isSubmitting}
                                />
                            </div>

                            <ContactField
                                id="contact-subject"
                                label={t('Subject')}
                                name="subject"
                                value={formValues.subject}
                                error={fieldErrors.subject ? t(fieldErrors.subject) : ''}
                                placeholder={t('What would you like to discuss?')}
                                minLength={3}
                                maxLength={150}
                                onChange={handleFieldChange}
                                disabled={isSubmitting}
                            />

                            <div className="vox-contact-field">
                                <div className="vox-contact-field__label-row">
                                    <label htmlFor="contact-message">{t('Message')}</label>
                                    <span>{messageLength}/2000</span>
                                </div>

                                <textarea
                                    id="contact-message"
                                    name="message"
                                    rows={4}
                                    value={formValues.message}
                                    onChange={handleFieldChange}
                                    placeholder={t('Share the details of your question, feedback, or request...')}
                                    minLength={10}
                                    maxLength={2000}
                                    disabled={isSubmitting}
                                    aria-invalid={Boolean(fieldErrors.message)}
                                    aria-describedby={
                                        fieldErrors.message
                                            ? 'contact-message-error'
                                            : undefined
                                    }
                                    className={`contact-form-control ${
                                        fieldErrors.message
                                            ? 'contact-form-control-error'
                                            : ''
                                    }`}
                                />

                                {fieldErrors.message && (
                                    <p
                                        id="contact-message-error"
                                        className="contact-field-error"
                                    >
                                        {t(fieldErrors.message)}
                                    </p>
                                )}
                            </div>

                            {(formValues.email.trim() || submitState.replyEmail) && (
                                <small className="vox-contact-reply-note">
                                    <Mail size={14} aria-hidden="true" />
                                    {t('Reply will be sent to')}{' '}
                                    <span>
                                        {formValues.email.trim() || submitState.replyEmail}
                                    </span>
                                </small>
                            )}

                            {submitState.status === 'success' && (
                                <div
                                    className="contact-feedback contact-feedback-success"
                                    role="status"
                                    aria-live="polite"
                                >
                                    <CheckCircle2 size={20} aria-hidden="true" />
                                    <div>
                                        <p>{t(submitState.message)}</p>
                                        {submitState.referenceId && (
                                            <p className="vox-contact-reference">
                                                {t('Reference')}: {submitState.referenceId}
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
                                    <CircleAlert size={20} aria-hidden="true" />
                                    <p>{t(submitState.message)}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="vox-contact-submit"
                            >
                                {isSubmitting ? (
                                    <>
                                        <LoaderCircle
                                            className="animate-spin"
                                            size={18}
                                            aria-hidden="true"
                                        />
                                        {t('Sending message...')}
                                    </>
                                ) : (
                                    <>
                                        {t('Send message')}
                                        <ArrowUpRight size={18} aria-hidden="true" />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </section>
    );
}

function ContactField({ id, label, error, ...inputProps }) {
    const errorId = `${id}-error`;

    return (
        <div className="vox-contact-field">
            <label htmlFor={id}>{label}</label>

            <input
                id={id}
                {...inputProps}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className={`contact-form-control ${
                    error ? 'contact-form-control-error' : ''
                }`}
            />

            {error && (
                <p id={errorId} className="contact-field-error">
                    {error}
                </p>
            )}
        </div>
    );
}