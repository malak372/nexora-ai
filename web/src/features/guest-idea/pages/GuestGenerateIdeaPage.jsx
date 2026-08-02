/**
 * Guest idea generation page.
 *
 * Provides the complete guest idea generation experience, including:
 * - Creating or restoring the guest session.
 * - Loading the available software domains.
 * - Collecting the guest's problem signal and location.
 * - Starting the idea generation pipeline.
 * - Polling the backend for generation progress.
 * - Displaying the limited generated idea.
 * - Handling failed and cancelled generation runs.
 * - Redirecting the guest to registration or login to save the idea.
 *
 * A guest can generate only one free idea. After completing generation,
 * the guest is encouraged to create an account so the generated idea can
 * be attached automatically to their workspace.
 *
 * @module GuestGenerateIdeaPage
 * @author Eman
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    ArrowRight,
    Check,
    CircleAlert,
    Globe2,
    Lightbulb,
    LoaderCircle,
    LockKeyhole,
    LogIn,
    MapPin,
    RefreshCcw,
    Sparkles,
    UserPlus,
    WandSparkles,
} from 'lucide-react';

import { getAvailableDomains } from '../../domains/api/domains.api';
import { getAvailableLanguages } from '../api/publicMetadataApi';
import {
    ensureGuestSession,
    generateGuestIdea,
    getGuestActiveRunId,
    getGuestGenerationRun,
    getGuestIdeaError,
    isGuestGenerationAlreadyRunningError,
    isGuestGenerationLimitError,
} from '../api/guestIdeaApi';

import '../styles/guest-idea.css';

/**
 * Generation run statuses that indicate the pipeline has stopped.
 *
 * Polling stops when the run reaches one of these statuses.
 *
 * @type {Set<string>}
 */
const TERMINAL_STATUSES = new Set([
    'COMPLETED',
    'FAILED',
    'CANCELLED',
]);

/**
 * Minimum description length that allows Nexora to infer the domain.
 *
 * @type {number}
 */
const MIN_DESCRIPTION_WORDS = 4;

/**
 * Maximum description length accepted by the guest flow.
 *
 * @type {number}
 */
const MAX_DESCRIPTION_WORDS = 120;

/**
 * Counts whitespace-separated words inside a text value.
 *
 * @param {string} value - Text to inspect.
 * @returns {number} Number of meaningful words.
 */
function countWords(value) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
        return 0;
    }

    return normalizedValue.split(/\s+/u).filter(Boolean).length;
}

/**
 * Labels displayed inside the guest generation stepper.
 *
 * @type {string[]}
 */

/**
 * General guest-facing messages shown while Nexora creates the idea.
 *
 * These messages intentionally avoid exposing internal pipeline stages,
 * provider names, model decisions, or technical processing details.
 *
 * @type {string[]}
 */
const GUEST_PROGRESS_MESSAGES = [
    'Exploring real-world needs around your signal…',
    'Finding meaningful opportunities worth building…',
    'Shaping a focused software direction…',
    'Refining the concept for clarity and value…',
    'Preparing your discovery…',
];

const FORM_STEPS = [
    'Your signal',
    'Focus',
    'Location',
    'Review',
];

/**
 * Initial values of the guest idea generation form.
 *
 * @type {{
 *   description: string,
 *   domainId: string,
 *   country: string,
 *   city: string,
 *   region: string,
 *   language: string,
 *   forceRefresh: boolean
 * }}
 */
const INITIAL_DRAFT = {
    description: '',
    domainId: '',
    country: 'Palestine',
    city: '',
    region: '',
    language: 'ANY',
    forceRefresh: false,
};

/**
 * Guest idea generation page component.
 *
 * Manages the complete guest idea flow from form input through generation
 * completion and account conversion.
 *
 * @returns {JSX.Element} The guest idea generation interface.
 */
export default function GuestGenerateIdeaPage() {
    const navigate = useNavigate();

    /**
     * Current form step index.
     */
    const [step, setStep] = useState(0);

    /**
     * Current guest form values.
     */
    const [draft, setDraft] = useState(INITIAL_DRAFT);

    /**
     * Available software domains returned by the backend.
     */
    const [domains, setDomains] = useState([]);

    /**
     * Available language options read from the backend database enum.
     */
    const [languages, setLanguages] = useState([]);

    /**
     * Indicates whether the initial guest session and domains are loading.
     */
    const [loading, setLoading] = useState(true);

    /**
     * Indicates whether the generation request is being submitted.
     */
    const [submitting, setSubmitting] = useState(false);

    /**
     * Current guest generation run.
     */
    const [run, setRun] = useState(null);

    /**
     * User-friendly error message.
     */
    const [error, setError] = useState('');

    /**
     * Indicates whether the current guest already used the free generation.
     */
    const [guestUsed, setGuestUsed] = useState(false);

    /**
     * Index of the current guest-safe progress message.
     */
    const [progressMessageIndex, setProgressMessageIndex] = useState(0);

    /**
     * Initializes the guest page.
     *
     * Creates or restores the guest session and retrieves all active domains.
     */
    useEffect(() => {
        let isMounted = true;

        async function initializePage() {
            try {
                const [session, domainItems, languageItems] =
                    await Promise.all([
                        ensureGuestSession(),
                        getAvailableDomains(),
                        getAvailableLanguages(),
                    ]);

                if (!isMounted) {
                    return;
                }

                setGuestUsed(Boolean(session?.hasGenerated));
                setDomains(
                    Array.isArray(domainItems)
                        ? domainItems
                        : [],
                );
                setLanguages(
                    Array.isArray(languageItems)
                        ? languageItems
                        : [],
                );
            } catch (requestError) {
                if (isMounted) {
                    setError(getGuestIdeaError(requestError));
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }

        initializePage();

        return () => {
            isMounted = false;
        };
    }, []);

    /**
     * Rotates general guest-facing loading messages while generation is active.
     *
     * Internal backend stage labels are deliberately not displayed to guests.
     */
    useEffect(() => {
        if (!run?.id || TERMINAL_STATUSES.has(run.status)) {
            setProgressMessageIndex(0);
            return undefined;
        }

        const timer = window.setInterval(() => {
            setProgressMessageIndex((currentIndex) =>
                (currentIndex + 1) % GUEST_PROGRESS_MESSAGES.length,
            );
        }, 4200);

        return () => {
            window.clearInterval(timer);
        };
    }, [run?.id, run?.status]);

    /**
     * Polls the backend while the generation run remains active.
     *
     * Polling stops automatically when the run becomes completed, failed,
     * or cancelled.
     */
    useEffect(() => {
        if (
            !run?.id ||
            TERMINAL_STATUSES.has(run.status)
        ) {
            return undefined;
        }

        const timer = window.setInterval(async () => {
            try {
                const latestRun =
                    await getGuestGenerationRun(run.id);

                setRun(latestRun);
            } catch (requestError) {
                setError(getGuestIdeaError(requestError));
            }
        }, 1800);

        return () => {
            window.clearInterval(timer);
        };
    }, [run?.id, run?.status]);

    /**
     * Resolves the complete selected domain object from the current domain ID.
     */
    const selectedDomain = useMemo(
        () =>
            domains.find(
                (domain) =>
                    String(domain.id) ===
                    String(draft.domainId),
            ),
        [domains, draft.domainId],
    );

    /**
     * Current number of words in the written guest problem signal.
     */
    const descriptionWordCount = countWords(draft.description);

    /**
     * Indicates whether the description is detailed enough for automatic
     * domain inference and remains within the guest word limit.
     */
    const hasValidDescription =
        descriptionWordCount >= MIN_DESCRIPTION_WORDS &&
        descriptionWordCount <= MAX_DESCRIPTION_WORDS;

    /**
     * Indicates whether the guest exceeded the allowed description size.
     */
    const descriptionExceedsLimit =
        descriptionWordCount > MAX_DESCRIPTION_WORDS;

    /**
     * A domain is required whenever the written description does not satisfy
     * the minimum word requirement.
     */
    const domainIsRequired = !hasValidDescription;

    const canContinue = [
        !descriptionExceedsLimit,

        !domainIsRequired || Boolean(draft.domainId),

        Boolean(draft.country.trim()),

        true,
    ][step];

    /**
     * Indicates whether the generation pipeline completed successfully
     * and returned a guest-visible idea.
     */
    const generationCompleted =
        run?.status === 'COMPLETED' &&
        Boolean(run?.idea);

    /**
     * Indicates whether the generation pipeline stopped unsuccessfully.
     */
    const generationFailed =
        run?.status === 'FAILED' ||
        run?.status === 'CANCELLED';

    /**
     * Updates one or more values inside the guest draft.
     *
     * @param {Partial<typeof INITIAL_DRAFT>} values - Values to update.
     * @returns {void}
     */
    const updateDraft = (values) => {
        setDraft((currentDraft) => ({
            ...currentDraft,
            ...values,
        }));
    };

    /**
     * Moves the form to the previous step.
     *
     * The guest is returned to the home page when already on the first step.
     *
     * @returns {void}
     */
    const handlePrevious = () => {
        setError('');

        if (step === 0) {
            navigate('/');
            return;
        }

        setStep((currentStep) => currentStep - 1);
    };

    /**
     * Moves the form to the next step.
     *
     * @returns {void}
     */
    const handleContinue = () => {
        if (!canContinue) {
            if (descriptionExceedsLimit) {
                setError(
                    `Keep the description within ${MAX_DESCRIPTION_WORDS} words before continuing.`,
                );
            }

            return;
        }

        setError('');
        setStep((currentStep) => currentStep + 1);
    };

    /**
     * Restores the form after a failed or cancelled generation.
     *
     * The current draft is preserved so the guest can review or adjust
     * the previous input before submitting again.
     *
     * @returns {void}
     */
    const handleRetryGeneration = () => {
        setRun(null);
        setError('');
        setSubmitting(false);
        setStep(FORM_STEPS.length - 1);
    };

    /**
     * Submits the guest idea generation request.
     *
     * Optional values are omitted from the payload when they are empty.
     *
     * @returns {Promise<void>}
     */
    const submitGeneration = async () => {
        if (submitting) {
            return;
        }

        if (descriptionExceedsLimit) {
            setError(
                `Description must not exceed ${MAX_DESCRIPTION_WORDS} words.`,
            );
            setStep(0);
            return;
        }

        if (domainIsRequired && !draft.domainId) {
            setError(
                `Choose a domain or write at least ${MIN_DESCRIPTION_WORDS} words.`,
            );
            setStep(1);
            return;
        }

        setSubmitting(true);
        setError('');

        try {
            const queuedRun = await generateGuestIdea({
                ...(draft.description.trim()
                    ? {
                        description: draft.description.trim(),
                    }
                    : {}),

                ...(draft.domainId
                    ? {
                        domainId: draft.domainId,
                    }
                    : {}),

                country: draft.country.trim(),

                ...(draft.city.trim()
                    ? {
                        city: draft.city.trim(),
                    }
                    : {}),

                ...(draft.region.trim()
                    ? {
                        region: draft.region.trim(),
                    }
                    : {}),

                language: draft.language,
                forceRefresh: draft.forceRefresh,
            });

            setRun({
                id: queuedRun.runId,
                status: queuedRun.status,
                progressPercent:
                    queuedRun.progressPercent,
            });
        } catch (requestError) {
            if (isGuestGenerationAlreadyRunningError(requestError)) {
                const activeRunId = getGuestActiveRunId(requestError);

                if (activeRunId) {
                    try {
                        const activeRun =
                            await getGuestGenerationRun(activeRunId);

                        setRun(activeRun);
                        setError('');
                        return;
                    } catch {
                        setRun({
                            id: activeRunId,
                            status: 'PENDING',
                            progressPercent: 0,
                        });
                        setError('');
                        return;
                    }
                }

                setError(
                    'Your idea is already being generated. Please wait a moment, then try again.',
                );
                return;
            }

            if (isGuestGenerationLimitError(requestError)) {
                setGuestUsed(true);
                setRun(null);
                setError('');
                return;
            }

            setError(getGuestIdeaError(requestError));
        } finally {
            setSubmitting(false);
        }
    };

    /**
     * Displays the initial page loading state.
     */
    if (loading) {
        return (
            <div className="guest-idea-loading">
                <LoaderCircle className="guest-spin" />

                <b>Preparing your guest studio…</b>
            </div>
        );
    }

    /**
     * Displays the guest generation limit state.
     *
     * A guest who already used the free generation is directed to registration
     * or login instead of receiving another free generation.
     */
    if (guestUsed && !run) {
        return (
            <section className="guest-limit-page">
                <div className="guest-limit-card guest-limit-card--used">
                    <div className="guest-limit-glow" aria-hidden="true" />

                    <span className="guest-icon guest-limit-icon">
                        <LockKeyhole />
                    </span>

                    <p className="guest-eyebrow">
                        Free guest idea completed
                    </p>

                    <h1>
                        Your free discovery is complete.
                    </h1>

                    <p>
                        We’re sorry, your one-time guest generation has
                        already been used. Create a free Nexora account to
                        unlock more idea attempts, keep your discoveries, and
                        continue building from your personal workspace.
                    </p>

                    <div className="guest-limit-benefits" aria-label="Account benefits">
                        <span><Check /> More idea attempts</span>
                        <span><Check /> Saved discoveries</span>
                        <span><Check /> Your own workspace</span>
                    </div>

                    <div className="guest-result-actions guest-limit-actions">
                        <button
                            type="button"
                            className="guest-primary"
                            onClick={() => navigate('/register')}
                        >
                            <UserPlus />
                            Create free account
                            <ArrowRight />
                        </button>

                        <button
                            type="button"
                            className="guest-secondary"
                            onClick={() => navigate('/login')}
                        >
                            <LogIn />
                            Sign in
                        </button>
                    </div>

                    <button
                        type="button"
                        className="guest-limit-home"
                        onClick={() => navigate('/')}
                    >
                        <ArrowLeft />
                        Back to home
                    </button>
                </div>
            </section>
        );
    }

    /**
     * Displays the pipeline status, failure state, or completed idea result.
     */
    if (run) {
        return (
            <section className="guest-progress-page">
                <div className="guest-progress-card">
                    {generationFailed ? (
                        <>
                            <span className="guest-icon">
                                <CircleAlert />
                            </span>

                            <p className="guest-eyebrow">
                                Generation stopped
                            </p>

                            <h1>
                                We could not complete this idea.
                            </h1>

                            <p>
                                {run.errorMessage ||
                                    (run.status === 'CANCELLED'
                                        ? 'The generation request was cancelled before it could be completed.'
                                        : 'The generation pipeline encountered a problem. Your input is still available, so you can review it and try again.')}
                            </p>

                            <div className="guest-result-actions">
                                <button
                                    type="button"
                                    className="guest-primary"
                                    onClick={
                                        handleRetryGeneration
                                    }
                                >
                                    <RefreshCcw />

                                    Review and try again
                                </button>

                                <button
                                    type="button"
                                    className="guest-secondary"
                                    onClick={() =>
                                        navigate('/register', {
                                            state: {
                                                fromGuestIdea:
                                                    true,
                                            },
                                        })
                                    }
                                >
                                    <UserPlus />

                                    Create free account
                                </button>
                            </div>

                            <small className="guest-trust-note">
                                Your form information remains
                                available and does not need to be
                                entered again.
                            </small>
                        </>
                    ) : !generationCompleted ? (
                        <>
                            <div className="guest-progress-orb">
                                <LoaderCircle className="guest-spin" />
                            </div>

                            <p className="guest-eyebrow">
                                Nexora intelligence is working
                            </p>

                            <h1>
                                Turning your signal into a
                                validated software idea.
                            </h1>

                            <p
                                className="guest-progress-message"
                                aria-live="polite"
                            >
                                {
                                    GUEST_PROGRESS_MESSAGES[
                                    progressMessageIndex
                                    ]
                                }
                            </p>

                            <div
                                className="guest-progress-bar guest-progress-bar--indeterminate"
                                role="progressbar"
                                aria-label="Your idea generation is in progress"
                            >
                                <span />
                            </div>

                            <div className="guest-progress-note">
                                <Sparkles />

                                <span>
                                    Please keep this page open. This may take a
                                    few minutes.
                                </span>
                            </div>
                        </>
                    ) : (
                        <>
                            <span className="guest-success-icon">
                                <Check />
                            </span>

                            <p className="guest-eyebrow">
                                Your first Nexora idea is ready
                            </p>

                            <h1>{run.idea.title}</h1>

                            <p className="guest-result-abstract">
                                {run.idea.limitedAbstract ||
                                    run.idea.problemStatement}
                            </p>

                            <div className="guest-preview-lock">
                                <LockKeyhole />

                                <div>
                                    <b>
                                        Save the complete idea
                                    </b>

                                    <span>
                                        Register now and this
                                        guest idea will move
                                        automatically into your
                                        account.
                                    </span>
                                </div>
                            </div>

                            <div className="guest-result-actions">
                                <button
                                    type="button"
                                    className="guest-primary"
                                    onClick={() =>
                                        navigate('/register', {
                                            state: {
                                                fromGuestIdea:
                                                    true,
                                            },
                                        })
                                    }
                                >
                                    <UserPlus />

                                    Create account &amp; save
                                </button>

                                <button
                                    type="button"
                                    className="guest-secondary"
                                    onClick={() =>
                                        navigate('/login', {
                                            state: {
                                                fromGuestIdea:
                                                    true,
                                            },
                                        })
                                    }
                                >
                                    I already have an account
                                </button>
                            </div>

                            <small className="guest-trust-note">
                                No second generation is needed.
                                Registration attaches this result
                                to your workspace.
                            </small>
                        </>
                    )}

                    {error ? (
                        <div className="guest-error">
                            {error}
                        </div>
                    ) : null}
                </div>
            </section>
        );
    }

    /**
     * Displays the guest idea generation multi-step form.
     */
    return (
        <section className="guest-generator-page">
            <div className="guest-generator-shell">
                <header className="guest-generator-header">
                    <button
                        type="button"
                        className="guest-back-home"
                        onClick={() => navigate('/')}
                    >
                        <ArrowLeft />

                        Back home
                    </button>

                    <span className="guest-eyebrow">
                        <WandSparkles />

                        One free guest idea
                    </span>

                    <h1>
                        Describe the problem.
                        <br />

                        <span>
                            We’ll discover what is worth
                            building.
                        </span>
                    </h1>

                    <p>
                        No account is needed to begin. You only
                        register after your idea is generated,
                        so you can save and continue it.
                    </p>
                </header>

                <div className="guest-stepper">
                    {FORM_STEPS.map((label, index) => {
                        const isActive = index === step;
                        const isCompleted = index < step;

                        return (
                            <div
                                key={label}
                                className={[
                                    isActive
                                        ? 'active'
                                        : '',
                                    isCompleted
                                        ? 'done'
                                        : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                <span>
                                    {isCompleted ? (
                                        <Check />
                                    ) : (
                                        index + 1
                                    )}
                                </span>

                                <b>{label}</b>
                            </div>
                        );
                    })}
                </div>

                <div className="guest-form-card">
                    {step === 0 ? (
                        <div className="guest-panel">
                            <span className="guest-panel-icon">
                                <Sparkles />
                            </span>

                            <h2>
                                What problem have you noticed?
                            </h2>

                            <p>
                                Explain who faces it, what keeps
                                happening, and why current
                                solutions are not enough.
                            </p>

                            <textarea
                                value={draft.description}
                                maxLength={2000}
                                placeholder="Example: University students struggle to coordinate shared transportation when class schedules change…"
                                onChange={(event) =>
                                    updateDraft({
                                        description:
                                            event.target.value,
                                    })
                                }
                            />

                            <div
                                className={[
                                    'guest-field-meta',
                                    descriptionExceedsLimit
                                        ? 'limit-exceeded'
                                        : hasValidDescription
                                            ? 'ready'
                                            : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                <span>
                                    {descriptionExceedsLimit
                                        ? `Reduce the description to ${MAX_DESCRIPTION_WORDS} words.`
                                        : hasValidDescription
                                            ? 'Detailed enough — you can continue.'
                                            : `Write at least ${MIN_DESCRIPTION_WORDS} words, or choose a domain instead.`}
                                </span>

                                <b>
                                    {descriptionWordCount}/
                                    {MAX_DESCRIPTION_WORDS} words
                                </b>
                            </div>
                        </div>
                    ) : null}

                    {step === 1 ? (
                        <div className="guest-panel">
                            <span className="guest-panel-icon">
                                <Lightbulb />
                            </span>

                            <h2>
                                Choose the opportunity area.
                            </h2>

                            <p>
                                {hasValidDescription
                                    ? 'Choose a software domain to narrow the analysis, or skip this step and let Nexora infer it from your written signal.'
                                    : `Select the software domain that should guide generation. A domain is required because the written signal contains fewer than ${MIN_DESCRIPTION_WORDS} words.`}
                            </p>

                            {hasValidDescription ? (
                                <button
                                    type="button"
                                    className={[
                                        'guest-auto-domain',
                                        !draft.domainId
                                            ? 'selected'
                                            : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                    onClick={() =>
                                        updateDraft({
                                            domainId: '',
                                        })
                                    }
                                >
                                    <Sparkles />

                                    <span>
                                        <b>
                                            Let Nexora choose
                                        </b>

                                        <small>
                                            Optional — inferred from
                                            your written signal
                                        </small>
                                    </span>

                                    <Check />
                                </button>
                            ) : null}

                            <div className="guest-domain-grid">
                                {domains.map((domain) => {
                                    const isSelected =
                                        String(
                                            draft.domainId,
                                        ) ===
                                        String(domain.id);

                                    return (
                                        <button
                                            type="button"
                                            key={domain.id}
                                            className={
                                                isSelected
                                                    ? 'selected'
                                                    : ''
                                            }
                                            onClick={() =>
                                                updateDraft({
                                                    domainId:
                                                        domain.id,
                                                })
                                            }
                                        >
                                            <span>
                                                {domain.icon ||
                                                    '✦'}
                                            </span>

                                            <b>
                                                {domain.name ||
                                                    domain.displayName}
                                            </b>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    {step === 2 ? (
                        <div className="guest-panel">
                            <span className="guest-panel-icon">
                                <MapPin />
                            </span>

                            <h2>
                                Where should the idea create
                                impact?
                            </h2>

                            <p>
                                Location improves local
                                relevance, regulations, and
                                market assumptions.
                            </p>

                            <div className="guest-location-grid">
                                <label>
                                    <span>Country *</span>

                                    <input
                                        value={draft.country}
                                        onChange={(event) =>
                                            updateDraft({
                                                country:
                                                    event.target
                                                        .value,
                                            })
                                        }
                                    />
                                </label>

                                <label>
                                    <span>City</span>

                                    <input
                                        value={draft.city}
                                        placeholder="Nablus"
                                        onChange={(event) =>
                                            updateDraft({
                                                city: event
                                                    .target
                                                    .value,
                                            })
                                        }
                                    />
                                </label>

                                <label>
                                    <span>Region</span>

                                    <input
                                        value={draft.region}
                                        placeholder="West Bank"
                                        onChange={(event) =>
                                            updateDraft({
                                                region:
                                                    event.target
                                                        .value,
                                            })
                                        }
                                    />
                                </label>

                                <label>
                                    <span>Language</span>

                                    <select
                                        value={draft.language}
                                        onChange={(event) =>
                                            updateDraft({
                                                language:
                                                    event.target
                                                        .value,
                                            })
                                        }
                                    >
                                        {languages.map(
                                            (language) => (
                                                <option
                                                    key={
                                                        language.code
                                                    }
                                                    value={
                                                        language.code
                                                    }
                                                >
                                                    {language.name}
                                                </option>
                                            ),
                                        )}
                                    </select>
                                </label>
                            </div>
                        </div>
                    ) : null}

                    {step === 3 ? (
                        <div className="guest-panel">
                            <span className="guest-panel-icon">
                                <Globe2 />
                            </span>

                            <h2>Ready for discovery.</h2>

                            <p>
                                Review your signal before Nexora
                                starts the evidence and AI
                                pipeline.
                            </p>

                            <div className="guest-review">
                                <article>
                                    <small>
                                        Problem signal
                                    </small>

                                    <p>
                                        {draft.description ||
                                            'No written signal — generation will use the selected domain.'}
                                    </p>
                                </article>

                                <div>
                                    <span>
                                        <small>
                                            Domain
                                        </small>

                                        <b>
                                            {selectedDomain?.name ||
                                                selectedDomain?.displayName ||
                                                'Auto-detected'}
                                        </b>
                                    </span>

                                    <span>
                                        <small>
                                            Location
                                        </small>

                                        <b>
                                            {[
                                                draft.city,
                                                draft.region,
                                                draft.country,
                                            ]
                                                .filter(Boolean)
                                                .join(', ')}
                                        </b>
                                    </span>

                                    <span>
                                        <small>
                                            Access
                                        </small>

                                        <b>
                                            One guest idea
                                        </b>
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {error ? (
                        <div className="guest-error">
                            {error}
                        </div>
                    ) : null}

                    <footer className="guest-form-actions">
                        <button
                            type="button"
                            className="guest-secondary"
                            onClick={handlePrevious}
                        >
                            <ArrowLeft />

                            {step === 0
                                ? 'Cancel'
                                : 'Previous'}
                        </button>

                        {step <
                            FORM_STEPS.length - 1 ? (
                            <button
                                type="button"
                                className="guest-primary"
                                disabled={!canContinue}
                                onClick={handleContinue}
                            >
                                {step === 0
                                    ? hasValidDescription
                                        ? 'Continue'
                                        : 'Choose domain instead'
                                    : step === 1 &&
                                        hasValidDescription &&
                                        !draft.domainId
                                        ? 'Skip domain'
                                        : 'Continue'}

                                <ArrowRight />
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="guest-primary"
                                disabled={submitting}
                                onClick={submitGeneration}
                            >
                                {submitting ? (
                                    <LoaderCircle className="guest-spin" />
                                ) : (
                                    <Sparkles />
                                )}

                                Generate my free idea
                            </button>
                        )}
                    </footer>
                </div>
            </div>
        </section>
    );
}