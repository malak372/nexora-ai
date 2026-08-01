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
    MapPin,
    RefreshCcw,
    Sparkles,
    UserPlus,
    WandSparkles,
} from 'lucide-react';

import { getAvailableDomains } from '../../domains/api/domains.api';
import {
    ensureGuestSession,
    generateGuestIdea,
    getGuestGenerationRun,
    getGuestIdeaError,
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
 * Labels displayed inside the guest generation stepper.
 *
 * @type {string[]}
 */
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
 *   radiusKm: number,
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
    radiusKm: 25,
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
     * Initializes the guest page.
     *
     * Creates or restores the guest session and retrieves all active domains.
     */
    useEffect(() => {
        let isMounted = true;

        async function initializePage() {
            try {
                const [session, domainItems] = await Promise.all([
                    ensureGuestSession(),
                    getAvailableDomains(),
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
     * Determines whether the guest can continue from the current form step.
     */
    const canContinue = [
        draft.description.trim().length >= 20,

        Boolean(draft.domainId) ||
        draft.description.trim().length >= 20,

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

        setSubmitting(true);
        setError('');

        try {
            const queuedRun = await generateGuestIdea({
                description: draft.description.trim(),

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

                radiusKm: Number(draft.radiusKm),
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
                <div className="guest-limit-card">
                    <span className="guest-icon">
                        <LockKeyhole />
                    </span>

                    <p className="guest-eyebrow">
                        Your guest idea is already used
                    </p>

                    <h1>
                        Keep building without losing your
                        progress.
                    </h1>

                    <p>
                        Create a free account to save the idea
                        you generated and continue with your
                        personal workspace.
                    </p>

                    <div className="guest-result-actions">
                        <button
                            type="button"
                            className="guest-primary"
                            onClick={() =>
                                navigate('/register')
                            }
                        >
                            <UserPlus />

                            Create free account
                        </button>

                        <button
                            type="button"
                            className="guest-secondary"
                            onClick={() =>
                                navigate('/login')
                            }
                        >
                            Sign in
                        </button>
                    </div>
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

                            <p>
                                {run.currentStageLabel ||
                                    'Analyzing evidence, comparing AI candidates, and shaping the strongest direction.'}
                            </p>

                            <div className="guest-progress-bar">
                                <span
                                    style={{
                                        width: `${Math.min(
                                            100,
                                            Math.max(
                                                4,
                                                Number(
                                                    run.progressPercent ||
                                                    0,
                                                ),
                                            ),
                                        )}%`,
                                    }}
                                />
                            </div>

                            <b className="guest-progress-number">
                                {Math.min(
                                    100,
                                    Math.max(
                                        0,
                                        Math.round(
                                            Number(
                                                run.progressPercent ||
                                                0,
                                            ),
                                        ),
                                    ),
                                )}
                                % complete
                            </b>
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

                            <div className="guest-field-meta">
                                <span>
                                    Use a real problem, not a
                                    solution
                                </span>

                                <b>
                                    {
                                        draft.description
                                            .length
                                    }
                                    /2000
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
                                Keep automatic discovery
                                selected, or narrow the analysis
                                to one software domain.
                            </p>

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
                                        Recommended from your
                                        written signal
                                    </small>
                                </span>

                                <Check />
                            </button>

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
                                        <option value="ANY">
                                            Auto detect
                                        </option>

                                        <option value="AR">
                                            Arabic
                                        </option>

                                        <option value="EN">
                                            English
                                        </option>
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
                                        {draft.description}
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
                                Continue

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