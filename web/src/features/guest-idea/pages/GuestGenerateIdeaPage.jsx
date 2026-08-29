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
    Bookmark,
    Check,
    CircleAlert,
    Folder,
    Globe2,
    Lightbulb,
    LoaderCircle,
    LockKeyhole,
    Infinity,
    LogIn,
    MapPin,
    RefreshCcw,
    Sparkles,
    UserPlus,
    UserRound,
    WandSparkles,
} from 'lucide-react';

import { useUserExperience } from '../../../system/user-experience';
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
 * Minimum description length that allows Voxidence to infer the domain.
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
 * General guest-facing messages shown while Voxidence creates the idea.
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

const GUEST_CANVAS_TEXT = {
    en: {
        steps: ['Your signal', 'Focus', 'Location', 'Review'],
        step: 'Step',
        titles: [
            'Start with the problem, not the solution.',
            'Give the signal a direction.',
            'Anchor the idea in a real place.',
            'Your discovery brief is ready.',
        ],
        descriptions: [
            'Tell us what keeps going wrong, who feels it, and why it matters.',
            'Choose a software space, or let Voxidence infer the best fit from your signal.',
            'Local context helps shape relevance, regulations, and realistic market assumptions.',
            'Check the essentials once, then let Voxidence turn them into an evidence-backed software idea.',
        ],
        visualTags: ['Community signal', 'Opportunity focus', 'Local context', 'Discovery brief'],
        flow: ['Listen', 'Focus', 'Ground', 'Build'],
        evidenceTitle: 'Evidence before ideas.',
        evidenceText: 'We use your context to search for a meaningful opportunity, not a random concept.',
        describeSignal: 'Describe the signal',
        fourWords: 'Four words are enough to begin.',
        example: 'Example: Students struggle to coordinate shared transportation when class schedules change at short notice…',
        goodSignal: 'Good signal — there is enough context to continue.',
        chooseSpace: 'Choose the opportunity space',
        optionalDomain: 'Optional — Voxidence can infer it for you.',
        requiredDomain: 'Required because the signal is very short.',
        letDecide: 'Let Voxidence decide',
        inferDomain: 'Infer the strongest domain from the problem signal.',
        addLocal: 'Add local context',
        countryOnly: 'Only country is required.',
        country: 'Country *',
        city: 'City',
        region: 'Region',
        language: 'Language',
        finalBrief: 'Final discovery brief',
        everything: 'Everything Voxidence will start from.',
        problemSignal: 'Problem signal',
        noSignal: 'No written signal — generation will use the selected domain.',
        domain: 'Domain',
        location: 'Location',
        autoDetected: 'Auto-detected',
        ready: 'Ready to discover',
        readyText: 'Your free guest idea will start from this brief.',
        cancel: 'Cancel',
        previous: 'Previous',
        continue: 'Continue',
        chooseDomainInstead: 'Choose domain instead',
        skipDomain: 'Skip domain',
        generate: 'Generate my free idea',
        of: 'of',
    },
    ar: {
        steps: ['إشارتك', 'التركيز', 'الموقع', 'المراجعة'],
        step: 'الخطوة',
        titles: [
            'ابدأ بالمشكلة، لا بالحل.',
            'امنح الإشارة اتجاهًا واضحًا.',
            'اربط الفكرة بمكان حقيقي.',
            'ملخص الاستكشاف جاهز.',
        ],
        descriptions: [
            'أخبرنا ما الذي يتكرر بشكل خاطئ، ومن يتأثر به، ولماذا يهم.',
            'اختر مجالًا برمجيًا، أو دع فوكسيدنس يستنتج الأنسب من إشارتك.',
            'يساعد السياق المحلي على تحسين الملاءمة واللوائح والافتراضات الواقعية للسوق.',
            'راجع الأساسيات مرة واحدة، ثم دع فوكسيدنس يحولها إلى فكرة برمجية مدعومة بالأدلة.',
        ],
        visualTags: ['إشارة المجتمع', 'تركيز الفرصة', 'السياق المحلي', 'ملخص الاستكشاف'],
        flow: ['استمع', 'ركّز', 'ثبّت السياق', 'ابنِ'],
        evidenceTitle: 'الأدلة قبل الأفكار.',
        evidenceText: 'نستخدم سياقك للبحث عن فرصة ذات معنى، لا عن فكرة عشوائية.',
        describeSignal: 'صف الإشارة',
        fourWords: 'أربع كلمات تكفي للبدء.',
        example: 'مثال: يواجه الطلاب صعوبة في تنسيق النقل المشترك عندما تتغير جداول المحاضرات بإشعار قصير…',
        goodSignal: 'إشارة جيدة — يوجد سياق كافٍ للمتابعة.',
        chooseSpace: 'اختر مساحة الفرصة',
        optionalDomain: 'اختياري — يمكن لفوكسيدنس استنتاجه نيابةً عنك.',
        requiredDomain: 'مطلوب لأن الإشارة قصيرة جدًا.',
        letDecide: 'دع فوكسيدنس يحدد',
        inferDomain: 'استنتج أقوى مجال من إشارة المشكلة.',
        addLocal: 'أضف السياق المحلي',
        countryOnly: 'الدولة فقط مطلوبة.',
        country: 'الدولة *',
        city: 'المدينة',
        region: 'المنطقة',
        language: 'اللغة',
        finalBrief: 'ملخص الاستكشاف النهائي',
        everything: 'كل ما سيبدأ منه فوكسيدنس.',
        problemSignal: 'إشارة المشكلة',
        noSignal: 'لا توجد إشارة مكتوبة — سيعتمد التوليد على المجال المحدد.',
        domain: 'المجال',
        location: 'الموقع',
        autoDetected: 'يُكتشف تلقائيًا',
        ready: 'جاهز للاستكشاف',
        readyText: 'ستبدأ فكرتك المجانية كضيف من هذا الملخص.',
        cancel: 'إلغاء',
        previous: 'السابق',
        continue: 'متابعة',
        chooseDomainInstead: 'اختر مجالًا بدلًا من ذلك',
        skipDomain: 'تخطي المجال',
        generate: 'ولّد فكرتي المجانية',
        of: 'من',
    },
};

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
    const { language: uiLanguage, t } = useUserExperience();
    const isArabicUi = uiLanguage === 'ar';
    const canvasText = GUEST_CANVAS_TEXT[isArabicUi ? 'ar' : 'en'];

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
                outputLanguage: draft.description.trim() ? 'ANY' : (uiLanguage === 'ar' ? 'AR' : 'EN'),
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
            <section className="guest-bootstrap-page">
                <div className="guest-bootstrap-mark" aria-hidden="true">
                    <span className="guest-bootstrap-ring guest-bootstrap-ring--one" />
                    <span className="guest-bootstrap-ring guest-bootstrap-ring--two" />
                    <span className="guest-bootstrap-core">
                        <Lightbulb />
                    </span>
                    <i className="guest-bootstrap-node guest-bootstrap-node--one" />
                    <i className="guest-bootstrap-node guest-bootstrap-node--two" />
                    <i className="guest-bootstrap-node guest-bootstrap-node--three" />
                </div>

                <div className="guest-bootstrap-copy">
                    <span>Voxidence guest studio</span>
                    <b>Preparing your discovery space</b>
                    <small>Loading the domains and context you can build from.</small>
                </div>

                <div className="guest-bootstrap-line" aria-hidden="true">
                    <span />
                </div>
            </section>
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
            <section className="guest-limit-page guest-limit-page--showcase">
                <div className="guest-limit-showcase">
                    <div className="guest-limit-content">
                        <div className="guest-limit-badge">
                            <span className="guest-limit-badge-icon">
                                <LockKeyhole />
                            </span>
                            <span>Free guest idea completed</span>
                        </div>

                        <h1 className="guest-limit-title">
                            <span className="guest-limit-title-accent">Your</span> free discovery
                            <span className="guest-limit-title-ending"> is complete.</span>
                        </h1>

                        <p className="guest-limit-description">
                            Your guest idea has already been used. Create a free Voxidence
                            account to generate more ideas and save your discoveries.
                        </p>

                        <div className="guest-limit-feature-list" aria-label="Account benefits">
                            <div className="guest-limit-feature">
                                <span className="guest-limit-feature-icon">
                                    <Sparkles />
                                </span>
                                <span className="guest-limit-feature-copy">
                                    <strong>More idea attempts</strong>
                                </span>
                                <ArrowRight className="guest-limit-feature-arrow" />
                            </div>

                            <div className="guest-limit-feature">
                                <span className="guest-limit-feature-icon">
                                    <Bookmark />
                                </span>
                                <span className="guest-limit-feature-copy">
                                    <strong>Saved discoveries</strong>
                                </span>
                                <ArrowRight className="guest-limit-feature-arrow" />
                            </div>

                            <div className="guest-limit-feature">
                                <span className="guest-limit-feature-icon">
                                    <Folder />
                                </span>
                                <span className="guest-limit-feature-copy">
                                    <strong>Your own workspace</strong>
                                </span>
                                <ArrowRight className="guest-limit-feature-arrow" />
                            </div>
                        </div>

                        <div className="guest-limit-showcase-actions">
                            <button
                                type="button"
                                className="guest-limit-create"
                                onClick={() => navigate('/register')}
                            >
                                <span className="guest-limit-action-icon">
                                    <UserPlus />
                                </span>
                                <span>Create free account</span>
                                <ArrowRight className="guest-limit-action-arrow" />
                            </button>

                            <button
                                type="button"
                                className="guest-limit-signin"
                                onClick={() => navigate('/login')}
                            >
                                <LogIn />
                                <span>Sign in</span>
                            </button>
                        </div>

                        <button
                            type="button"
                            className="guest-limit-showcase-home"
                            onClick={() => navigate('/')}
                        >
                            <ArrowLeft />
                            <span>Back to home</span>
                        </button>
                    </div>

                    <div className="guest-limit-visual" aria-hidden="true">
                        <div className="guest-limit-visual-glow guest-limit-visual-glow--one" />
                        <div className="guest-limit-visual-glow guest-limit-visual-glow--two" />
                        <div className="guest-limit-path guest-limit-path--one" />
                        <div className="guest-limit-path guest-limit-path--two" />

                        <span className="guest-limit-spark guest-limit-spark--one">✦</span>
                        <span className="guest-limit-spark guest-limit-spark--two">+</span>
                        <span className="guest-limit-spark guest-limit-spark--three">✦</span>

                        <div className="guest-visual-card guest-visual-card--ideas">
                            <div className="guest-visual-card-head">
                                <span><Sparkles /></span>
                                <strong>More ideas</strong>
                                <span className="guest-visual-bubble guest-visual-bubble--infinity">
                                    <Infinity />
                                </span>
                            </div>
                            <div className="guest-visual-lines">
                                <i /><b />
                                <i /><b />
                                <i /><b />
                            </div>
                        </div>

                        <div className="guest-visual-card guest-visual-card--saved">
                            <div className="guest-visual-card-head">
                                <span><Bookmark /></span>
                                <strong>Saved discoveries</strong>
                                <span className="guest-visual-bubble guest-visual-bubble--check">
                                    <Check />
                                </span>
                            </div>
                            <div className="guest-visual-lines guest-visual-lines--saved">
                                <i /><b />
                                <i /><b />
                                <i /><b />
                            </div>
                        </div>

                        <div className="guest-visual-card guest-visual-card--workspace">
                            <div className="guest-visual-card-head">
                                <span><Folder /></span>
                                <strong>My workspace</strong>
                                <span className="guest-visual-bubble guest-visual-bubble--user">
                                    <UserRound />
                                </span>
                            </div>
                            <div className="guest-workspace-preview">
                                <div className="guest-workspace-list">
                                    <span /><span /><span /><span />
                                </div>
                                <div className="guest-workspace-chart">
                                    <svg viewBox="0 0 190 110" preserveAspectRatio="none">
                                        <path d="M8 91 L52 50 L96 72 L140 24 L182 46" />
                                        <circle cx="8" cy="91" r="4" />
                                        <circle cx="52" cy="50" r="4" />
                                        <circle cx="96" cy="72" r="4" />
                                        <circle cx="140" cy="24" r="4" />
                                        <circle cx="182" cy="46" r="4" />
                                    </svg>
                                    <div className="guest-workspace-chart-blocks">
                                        <span /><span /><span />
                                    </div>
                                </div>
                            </div>
                        </div>
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
                <div
                    className={[
                        'guest-progress-card',
                        !generationFailed && !generationCompleted
                            ? 'guest-progress-card--creating'
                            : '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                >
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
                        <div className="guest-creation-stage">
                            <div className="guest-creation-visual" aria-hidden="true">
                                <div className="guest-creation-field">
                                    <span className="guest-creation-halo guest-creation-halo--one" />
                                    <span className="guest-creation-halo guest-creation-halo--two" />

                                    <div className="guest-creation-core">
                                        <Lightbulb />
                                    </div>

                                    <div className="guest-creation-chip guest-creation-chip--voices">
                                        <span className="guest-creation-chip-icon">
                                            <Sparkles />
                                        </span>
                                        <div>
                                            <small>01</small>
                                            <b>Signal</b>
                                        </div>
                                    </div>

                                    <div className="guest-creation-chip guest-creation-chip--evidence">
                                        <span className="guest-creation-chip-icon">
                                            <Check />
                                        </span>
                                        <div>
                                            <small>02</small>
                                            <b>Evidence</b>
                                        </div>
                                    </div>

                                    <div className="guest-creation-chip guest-creation-chip--idea">
                                        <span className="guest-creation-chip-icon">
                                            <WandSparkles />
                                        </span>
                                        <div>
                                            <small>03</small>
                                            <b>Idea</b>
                                        </div>
                                    </div>

                                    <span className="guest-creation-pulse guest-creation-pulse--one" />
                                    <span className="guest-creation-pulse guest-creation-pulse--two" />
                                    <span className="guest-creation-pulse guest-creation-pulse--three" />
                                </div>
                            </div>

                            <div className="guest-creation-copy">
                                <span className="guest-creation-kicker">
                                    <span className="guest-creation-live-dot" />
                                    Voxidence is discovering
                                </span>

                                <h1>
                                    Your signal is becoming
                                    <span> a buildable idea.</span>
                                </h1>

                                <p
                                    className="guest-creation-message"
                                    aria-live="polite"
                                >
                                    {
                                        GUEST_PROGRESS_MESSAGES[
                                            progressMessageIndex
                                        ]
                                    }
                                </p>

                                <div className="guest-creation-track" aria-hidden="true">
                                    <span />
                                </div>

                                <div className="guest-creation-foot">
                                    <div>
                                        <Sparkles />
                                        <span>
                                            Looking for a meaningful direction,
                                            not just generating random text.
                                        </span>
                                    </div>

                                    <small>Please keep this page open.</small>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <span className="guest-success-icon">
                                <Check />
                            </span>

                            <p className="guest-eyebrow">
                                Your first Voxidence idea is ready
                            </p>

                            <h1 dir="auto" data-idea-content="true">{run.idea.title}</h1>

                            <p className="guest-result-abstract" dir="auto" data-idea-content="true">
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
            <div className="guest-generator-shell guest-canvas-shell">
                <div className="guest-canvas-topbar">
                    <button
                        type="button"
                        className="guest-back-home guest-canvas-back"
                        onClick={() => navigate('/')}
                    >
                        <ArrowLeft />
                        {isArabicUi ? 'العودة للرئيسية' : 'Back home'}
                    </button>

                    <div className="guest-canvas-brand">
                        <span className="guest-canvas-brand-mark">
                            <Lightbulb />
                        </span>

                        <span>
                            <b>Voxidence</b>
                            <small>
                                {isArabicUi
                                    ? 'اكتشاف أفكار قائم على الأدلة'
                                    : 'Evidence-led idea discovery'}
                            </small>
                        </span>
                    </div>

                    <div className="guest-canvas-pass">
                        <Sparkles />
                        <span>
                            {isArabicUi
                                ? 'فكرة ضيف مجانية واحدة'
                                : '1 free guest idea'}
                        </span>
                    </div>
                </div>

                <div className="guest-canvas">
                    <header className="guest-canvas-head">
                        <div className="guest-canvas-head-copy">
                            <span className="guest-canvas-overline">
                                {canvasText.step} {String(step + 1).padStart(2, '0')}
                                <i />
                                {canvasText.steps[step]}
                            </span>

                            <h1>{canvasText.titles[step]}</h1>

                            <p>{canvasText.descriptions[step]}</p>
                        </div>

                        <div
                            className="guest-canvas-progress"
                            aria-label={isArabicUi
                                ? `الخطوة ${step + 1} من ${FORM_STEPS.length}`
                                : `Step ${step + 1} of ${FORM_STEPS.length}`}
                        >
                            {canvasText.steps.map((label, index) => {
                                const isActive = index === step;
                                const isCompleted = index < step;

                                return (
                                    <div
                                        key={label}
                                        className={[
                                            'guest-canvas-progress-step',
                                            isActive ? 'active' : '',
                                            isCompleted ? 'done' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <span>
                                            {isCompleted ? <Check /> : index + 1}
                                        </span>
                                        <b>{label}</b>
                                    </div>
                                );
                            })}
                        </div>
                    </header>

                    <div className="guest-canvas-body">
                        <aside className="guest-canvas-visual">
                            <div className="guest-canvas-visual-top">
                                <span className="guest-canvas-visual-tag">
                                    {canvasText.visualTags[step]}
                                </span>

                                <div className="guest-canvas-visual-icon">
                                    {step === 0 ? (
                                        <Sparkles />
                                    ) : step === 1 ? (
                                        <Lightbulb />
                                    ) : step === 2 ? (
                                        <MapPin />
                                    ) : (
                                        <Check />
                                    )}
                                </div>
                            </div>

                            <div className="guest-canvas-signal" aria-hidden="true">
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                            </div>

                            <div className="guest-canvas-visual-flow">
                                <div className={step >= 0 ? 'active' : ''}>
                                    <span>01</span>
                                    <b>{canvasText.flow[0]}</b>
                                </div>

                                <i />

                                <div className={step >= 1 ? 'active' : ''}>
                                    <span>02</span>
                                    <b>{canvasText.flow[1]}</b>
                                </div>

                                <i />

                                <div className={step >= 2 ? 'active' : ''}>
                                    <span>03</span>
                                    <b>{canvasText.flow[2]}</b>
                                </div>

                                <i />

                                <div className={step >= 3 ? 'active' : ''}>
                                    <span>04</span>
                                    <b>{canvasText.flow[3]}</b>
                                </div>
                            </div>

                            <div className="guest-canvas-visual-note">
                                <WandSparkles />
                                <span>
                                    <b>{canvasText.evidenceTitle}</b>
                                    <small>{canvasText.evidenceText}</small>
                                </span>
                            </div>
                        </aside>

                        <main className="guest-form-card guest-canvas-form">
                            {step === 0 ? (
                                <div className="guest-panel guest-canvas-panel">
                                    <div className="guest-canvas-section-title">
                                        <span>01</span>
                                        <div>
                                            <b>{canvasText.describeSignal}</b>
                                            <small>{canvasText.fourWords}</small>
                                        </div>
                                    </div>

                                    <div className="guest-canvas-textarea">
                                        <textarea
                                            dir={draft.description.trim()
                                                ? 'auto'
                                                : (isArabicUi ? 'rtl' : 'ltr')}
                                            value={draft.description}
                                            maxLength={2000}
                                            placeholder={canvasText.example}
                                            onChange={(event) =>
                                                updateDraft({
                                                    description: event.target.value,
                                                })
                                            }
                                        />

                                        <span className="guest-canvas-textarea-mark">
                                            <Sparkles />
                                        </span>
                                    </div>

                                    <div
                                        className={[
                                            'guest-field-meta',
                                            'guest-canvas-meta',
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
                                                ? isArabicUi
                                                    ? `اختصر الوصف إلى ${MAX_DESCRIPTION_WORDS} كلمة.`
                                                    : `Reduce the description to ${MAX_DESCRIPTION_WORDS} words.`
                                                : hasValidDescription
                                                    ? canvasText.goodSignal
                                                    : isArabicUi
                                                        ? `اكتب ${MIN_DESCRIPTION_WORDS} كلمات على الأقل، أو اختر مجالًا في الخطوة التالية.`
                                                        : `Write at least ${MIN_DESCRIPTION_WORDS} words, or choose a domain in the next step.`}
                                        </span>

                                        <b>
                                            {descriptionWordCount}/{MAX_DESCRIPTION_WORDS}
                                        </b>
                                    </div>
                                </div>
                            ) : null}

                            {step === 1 ? (
                                <div className="guest-panel guest-canvas-panel">
                                    <div className="guest-canvas-section-title">
                                        <span>02</span>
                                        <div>
                                            <b>{canvasText.chooseSpace}</b>
                                            <small>
                                                {hasValidDescription
                                                    ? canvasText.optionalDomain
                                                    : canvasText.requiredDomain}
                                            </small>
                                        </div>
                                    </div>

                                    {hasValidDescription ? (
                                        <button
                                            type="button"
                                            className={[
                                                'guest-auto-domain',
                                                'guest-canvas-auto-domain',
                                                !draft.domainId ? 'selected' : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                            onClick={() =>
                                                updateDraft({ domainId: '' })
                                            }
                                        >
                                            <span className="guest-canvas-auto-orb">
                                                <WandSparkles />
                                            </span>

                                            <span>
                                                <b>{canvasText.letDecide}</b>
                                                <small>{canvasText.inferDomain}</small>
                                            </span>

                                            <span className="guest-canvas-auto-check">
                                                <Check />
                                            </span>
                                        </button>
                                    ) : null}

                                    <div className="guest-domain-grid guest-canvas-domain-grid">
                                        {domains.map((domain) => {
                                            const isSelected =
                                                String(draft.domainId) === String(domain.id);

                                            return (
                                                <button
                                                    type="button"
                                                    key={domain.id}
                                                    className={isSelected ? 'selected' : ''}
                                                    onClick={() =>
                                                        updateDraft({ domainId: domain.id })
                                                    }
                                                >
                                                    <span className="guest-canvas-domain-icon">
                                                        {domain.icon || '✦'}
                                                    </span>

                                                    <b>
                                                        {isArabicUi
                                                            ? t(domain.name || domain.displayName)
                                                            : (domain.name || domain.displayName)}
                                                    </b>

                                                    <span className="guest-canvas-domain-selected">
                                                        <Check />
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}

                            {step === 2 ? (
                                <div className="guest-panel guest-canvas-panel">
                                    <div className="guest-canvas-section-title">
                                        <span>03</span>
                                        <div>
                                            <b>{canvasText.addLocal}</b>
                                            <small>{canvasText.countryOnly}</small>
                                        </div>
                                    </div>

                                    <div className="guest-location-grid guest-canvas-location-grid">
                                        <label>
                                            <span>{canvasText.country}</span>
                                            <div className="guest-canvas-field">
                                                <Globe2 />
                                                <input
                                                    dir="auto"
                                                    value={draft.country}
                                                    onChange={(event) =>
                                                        updateDraft({
                                                            country: event.target.value,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </label>

                                        <label>
                                            <span>{canvasText.city}</span>
                                            <div className="guest-canvas-field">
                                                <MapPin />
                                                <input
                                                    dir="auto"
                                                    value={draft.city}
                                                    placeholder={isArabicUi ? 'نابلس' : 'Nablus'}
                                                    onChange={(event) =>
                                                        updateDraft({
                                                            city: event.target.value,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </label>

                                        <label>
                                            <span>{canvasText.region}</span>
                                            <div className="guest-canvas-field">
                                                <MapPin />
                                                <input
                                                    dir="auto"
                                                    value={draft.region}
                                                    placeholder={isArabicUi ? 'الضفة الغربية' : 'West Bank'}
                                                    onChange={(event) =>
                                                        updateDraft({
                                                            region: event.target.value,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </label>

                                        <label>
                                            <span>{canvasText.language}</span>
                                            <div className="guest-canvas-field">
                                                <Globe2 />
                                                <select
                                                    value={draft.language}
                                                    onChange={(event) =>
                                                        updateDraft({
                                                            language: event.target.value,
                                                        })
                                                    }
                                                >
                                                    {languages.map((language) => (
                                                        <option
                                                            key={language.code}
                                                            value={language.code}
                                                        >
                                                            {isArabicUi ? t(language.name) : language.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            ) : null}

                            {step === 3 ? (
                                <div className="guest-panel guest-canvas-panel">
                                    <div className="guest-canvas-section-title">
                                        <span>04</span>
                                        <div>
                                            <b>{canvasText.finalBrief}</b>
                                            <small>{canvasText.everything}</small>
                                        </div>
                                    </div>

                                    <div className="guest-review guest-canvas-review">
                                        <article className="guest-canvas-review-signal">
                                            <span>{canvasText.problemSignal}</span>
                                            {draft.description ? (
                                                <p dir="auto" data-no-auto-translate="true">
                                                    {draft.description}
                                                </p>
                                            ) : (
                                                <p>{canvasText.noSignal}</p>
                                            )}
                                        </article>

                                        <div className="guest-canvas-review-grid">
                                            <article>
                                                <small>{canvasText.domain}</small>
                                                <b>
                                                    {selectedDomain
                                                        ? (isArabicUi
                                                            ? t(
                                                                selectedDomain.name ||
                                                                selectedDomain.displayName,
                                                            )
                                                            : (selectedDomain.name ||
                                                                selectedDomain.displayName))
                                                        : canvasText.autoDetected}
                                                </b>
                                            </article>

                                            <article>
                                                <small>{canvasText.location}</small>
                                                <b dir="auto" data-no-auto-translate="true">
                                                    {[draft.city, draft.region, draft.country]
                                                        .filter(Boolean)
                                                        .join(', ')}
                                                </b>
                                            </article>

                                            <article>
                                                <small>{canvasText.language}</small>
                                                <b>
                                                    {(() => {
                                                        const selectedLanguage = languages.find(
                                                            (language) => language.code === draft.language,
                                                        )?.name;

                                                        if (!selectedLanguage) return draft.language;

                                                        return isArabicUi
                                                            ? t(selectedLanguage)
                                                            : selectedLanguage;
                                                    })()}
                                                </b>
                                            </article>
                                        </div>
                                    </div>

                                    <div className="guest-canvas-ready">
                                        <span>
                                            <Check />
                                        </span>

                                        <div>
                                            <b>{canvasText.ready}</b>
                                            <small>{canvasText.readyText}</small>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            {error ? (
                                <div className="guest-error guest-canvas-error">
                                    {isArabicUi ? t(error) : error}
                                </div>
                            ) : null}

                            <footer className="guest-form-actions guest-canvas-actions">
                                <button
                                    type="button"
                                    className="guest-secondary"
                                    onClick={handlePrevious}
                                >
                                    <ArrowLeft />
                                    {step === 0 ? canvasText.cancel : canvasText.previous}
                                </button>

                                <span className="guest-canvas-actions-note">
                                    {step + 1} {canvasText.of} {FORM_STEPS.length}
                                </span>

                                {step < FORM_STEPS.length - 1 ? (
                                    <button
                                        type="button"
                                        className="guest-primary"
                                        disabled={!canContinue}
                                        onClick={handleContinue}
                                    >
                                        {step === 0
                                            ? hasValidDescription
                                                ? canvasText.continue
                                                : canvasText.chooseDomainInstead
                                            : step === 1 &&
                                                hasValidDescription &&
                                                !draft.domainId
                                                ? canvasText.skipDomain
                                                : canvasText.continue}

                                        <ArrowRight />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="guest-primary guest-canvas-generate"
                                        disabled={submitting}
                                        onClick={submitGeneration}
                                    >
                                        {submitting ? (
                                            <LoaderCircle className="guest-spin" />
                                        ) : (
                                            <WandSparkles />
                                        )}

                                        {canvasText.generate}
                                    </button>
                                )}
                            </footer>
                        </main>
                    </div>
                </div>
            </div>
        </section>
    );
}