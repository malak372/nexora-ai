/**
 * Premium intelligence dashboard for authenticated Nexora users.
 *
 * @author Eman
 */
import {
    ArrowRight,
    BadgeCheck,
    BarChart3,
    BellRing,
    BrainCircuit,
    CheckCircle2,
    Clock3,
    Coins,
    CreditCard,
    Crown,
    FileText,
    Gauge,
    Lightbulb,
    Radio,
    RefreshCw,
    Rocket,
    ShieldCheck,
    Sparkles,
    TrendingUp,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getActiveGenerationRun } from '../../../normal-user/idea-generation/api/ideaGenerationApi';
import {
    clearActiveGenerationRunId,
    saveActiveGenerationRunId,
} from '../../../normal-user/idea-generation/store/activeGenerationRun.storage';
import { getApiErrorMessage } from '../../../normal-user/shared/api/normalUserApi';
import { getNormalUserSummary } from '../../../normal-user/dashboard/api/dashboardApi';
import '../styles/premium-dashboard.css';

const PREMIUM_GENERATION_COST = 1;

const PREMIUM_OUTPUTS = [
    'Full abstract',
    'Technology stack',
    'System architecture',
    'Database design',
    'Business model',
    'Feasibility assessment',
];

function getFirstName(fullName) {
    return String(fullName ?? '').trim().split(/\s+/)[0] || 'there';
}

function clampProgress(value) {
    return Math.max(0, Math.min(100, Number(value ?? 0)));
}

function formatDate(value) {
    if (!value) return 'No activity yet';

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return 'Date unavailable';

    return new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    }).format(parsedDate);
}

function formatMoney(amount, currency = 'USD') {
    const numericAmount = Number(amount ?? 0);

    try {
        return new Intl.NumberFormat('en', {
            style: 'currency',
            currency: String(currency || 'USD').toUpperCase(),
            maximumFractionDigits: 2,
        }).format(numericAmount);
    } catch {
        return `${numericAmount.toFixed(2)} ${currency || 'USD'}`;
    }
}

function getPaymentStatusLabel(status) {
    return String(status ?? 'No payments').replaceAll('_', ' ').toLowerCase();
}

function PremiumMetricCard({ icon: Icon, label, value, helper, tone, onClick }) {
    const Element = onClick ? motion.button : motion.article;

    return (
        <Element
            className={`premium-metric-card premium-metric-card--${tone}`}
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            whileHover={{ y: -5 }}
            transition={{ duration: 0.2 }}
        >
            <span className="premium-metric-card__icon" aria-hidden="true">
                <Icon size={21} strokeWidth={1.8} />
            </span>

            <span className="premium-metric-card__copy">
                <small>{label}</small>
                <strong>{value}</strong>
                <span>{helper}</span>
            </span>

            {onClick ? <ArrowRight className="premium-metric-card__arrow" size={17} /> : null}
        </Element>
    );
}

export default function PremiumDashboardPage() {
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();
    const [summary, setSummary] = useState(null);
    const [activeRun, setActiveRun] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const loadDashboard = useCallback(async ({ force = false } = {}) => {
        setIsLoading(true);
        setError('');

        try {
            const [summaryResult, activeRunResult] = await Promise.all([
                getNormalUserSummary({ force }),
                getActiveGenerationRun({ force }).catch(() => null),
            ]);

            setSummary(summaryResult);
            setActiveRun(activeRunResult);

            if (activeRunResult?.id) {
                saveActiveGenerationRunId(activeRunResult.id);
            } else {
                clearActiveGenerationRunId();
            }
        } catch (requestError) {
            setError(
                getApiErrorMessage(
                    requestError,
                    'We could not load your premium workspace.',
                ),
            );
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDashboard();
    }, [loadDashboard]);

    const creditBalance = Math.max(0, Number(summary?.creditBalance ?? 0));
    const premiumIdeasCount = Number(summary?.premiumIdeasCount ?? 0);
    const purchasedCredits = Number(summary?.totalCreditsPurchased ?? 0);
    const successfulPayments = Number(summary?.successfulPayments ?? 0);
    const unreadNotifications = Number(summary?.unreadNotificationsCount ?? 0);
    const progressPercent = clampProgress(activeRun?.progressPercent);
    const canGenerate = creditBalance >= PREMIUM_GENERATION_COST;

    const creditMessage = useMemo(() => {
        if (creditBalance > 3) {
            return `${creditBalance} premium generations are ready.`;
        }

        if (creditBalance > 1) {
            return `${creditBalance} premium generations remain.`;
        }

        if (creditBalance === 1) {
            return 'One premium generation remains.';
        }

        return 'Add credits to create another premium idea.';
    }, [creditBalance]);

    const reveal = reduceMotion
        ? {}
        : {
            initial: { opacity: 0, y: 24 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
        };

    if (isLoading) {
        return (
            <section className="premium-dashboard-state" role="status" aria-live="polite">
                <span className="premium-dashboard-loader" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                </span>
                <strong>Preparing your premium command center</strong>
                <p>Synchronizing ideas, credits, and intelligence activity...</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className="premium-dashboard-state premium-dashboard-state--error">
                <span className="premium-dashboard-state__icon">
                    <ShieldCheck size={28} />
                </span>
                <h1>Premium workspace unavailable</h1>
                <p>{error}</p>
                <button type="button" onClick={() => loadDashboard({ force: true })}>
                    <RefreshCw size={17} />
                    Try again
                </button>
            </section>
        );
    }

    return (
        <div className="premium-dashboard-page">
            <motion.section className="premium-dashboard-hero" {...reveal}>
                <div className="premium-dashboard-hero__content">
                    <div className="premium-dashboard-hero__eyebrow">
                        <Crown size={15} />
                        Premium intelligence workspace
                        <span><BadgeCheck size={14} /> Active</span>
                    </div>

                    <h1>
                        Good to see you, <span>{getFirstName(summary?.fullName)}.</span>
                    </h1>

                    <p>
                        Turn verified community signals into implementation-ready software
                        opportunities with multi-model reasoning and complete premium outputs.
                    </p>

                    <div className="premium-dashboard-hero__actions">
                        <motion.button
                            className="premium-dashboard-button premium-dashboard-button--primary"
                            type="button"
                            onClick={() => navigate(canGenerate ? '/premium/generate' : '/premium/credits')}
                            whileHover={{ y: -3 }}
                            whileTap={{ scale: 0.98 }}
                        >
                            {canGenerate ? <Rocket size={18} /> : <Coins size={18} />}
                            {canGenerate ? 'Generate premium idea' : 'Add credits'}
                        </motion.button>

                        <button
                            className="premium-dashboard-button premium-dashboard-button--secondary"
                            type="button"
                            onClick={() => navigate('/premium/ideas')}
                        >
                            Open idea portfolio
                            <ArrowRight size={17} />
                        </button>
                    </div>

                    <div className="premium-dashboard-hero__assurance">
                        <ShieldCheck size={17} />
                        <span>
                            <strong>One credit creates one complete premium idea.</strong>
                            Advanced outputs remain available in your workspace after generation.
                        </span>
                    </div>
                </div>

                <div className="premium-credit-command">
                    <div className="premium-credit-command__halo" aria-hidden="true" />

                    <div className="premium-credit-command__topline">
                        <span><Coins size={18} /> Credit balance</span>
                        <button type="button" onClick={() => navigate('/premium/credits')}>
                            Manage
                            <ArrowRight size={14} />
                        </button>
                    </div>

                    <div className="premium-credit-command__balance">
                        <strong>{creditBalance}</strong>
                        <span>credits</span>
                    </div>

                    <p>{creditMessage}</p>

                    <div className="premium-credit-command__stats">
                        <span>
                            <small>Purchased</small>
                            <strong>{purchasedCredits}</strong>
                        </span>
                        <span>
                            <small>Premium ideas</small>
                            <strong>{premiumIdeasCount}</strong>
                        </span>
                        <span>
                            <small>Successful payments</small>
                            <strong>{successfulPayments}</strong>
                        </span>
                    </div>
                </div>
            </motion.section>

            {activeRun?.id ? (
                <motion.button
                    className="premium-active-generation"
                    type="button"
                    onClick={() => navigate(`/premium/generation/${activeRun.id}`)}
                    {...reveal}
                >
                    <span className="premium-active-generation__status">
                        <Radio size={20} />
                    </span>

                    <span className="premium-active-generation__copy">
                        <small>Premium generation running</small>
                        <strong>
                            {activeRun.currentStageLabel ||
                                activeRun.currentStageKey ||
                                'Preparing your intelligence pipeline'}
                        </strong>
                        <em><Clock3 size={14} /> Live progress is safely preserved</em>
                    </span>

                    <span className="premium-active-generation__meter">
                        <strong>{Math.round(progressPercent)}%</strong>
                        <i><span style={{ width: `${progressPercent}%` }} /></i>
                    </span>

                    <span className="premium-active-generation__action">
                        Continue tracking
                        <ArrowRight size={17} />
                    </span>
                </motion.button>
            ) : null}

            <motion.section className="premium-dashboard-metrics" {...reveal}>
                <PremiumMetricCard
                    icon={BrainCircuit}
                    label="Premium ideas"
                    value={premiumIdeasCount}
                    helper="Complete intelligence workspaces"
                    tone="violet"
                    onClick={() => navigate('/premium/ideas?generationType=PREMIUM_CREDIT')}
                />
                <PremiumMetricCard
                    icon={Lightbulb}
                    label="All ideas"
                    value={Number(summary?.ideasCount ?? 0)}
                    helper="Your complete idea portfolio"
                    tone="blue"
                    onClick={() => navigate('/premium/ideas')}
                />
                <PremiumMetricCard
                    icon={FileText}
                    label="Published"
                    value={Number(summary?.publishedIdeasCount ?? 0)}
                    helper="Ideas shared with the community"
                    tone="gold"
                    onClick={() => navigate('/premium/published')}
                />
                <PremiumMetricCard
                    icon={BellRing}
                    label="Unread alerts"
                    value={unreadNotifications}
                    helper="Updates that need your attention"
                    tone="mint"
                    onClick={() => navigate('/premium/notifications')}
                />
            </motion.section>

            <div className="premium-dashboard-grid">
                <motion.section className="premium-intelligence-card" {...reveal}>
                    <div className="premium-section-heading">
                        <div>
                            <span><Sparkles size={14} /> Premium output suite</span>
                            <h2>From evidence to execution</h2>
                        </div>
                        <span className="premium-section-heading__badge">Included</span>
                    </div>

                    <p className="premium-intelligence-card__intro">
                        Every premium generation delivers a complete project foundation,
                        ready for technical planning, evaluation, and presentation.
                    </p>

                    <div className="premium-output-list">
                        {PREMIUM_OUTPUTS.map((output) => (
                            <span key={output}>
                                <CheckCircle2 size={16} />
                                {output}
                            </span>
                        ))}
                    </div>

                    <button type="button" onClick={() => navigate('/premium/generate')}>
                        Start a complete analysis
                        <ArrowRight size={16} />
                    </button>
                </motion.section>

                <motion.section className="premium-performance-card" {...reveal}>
                    <div className="premium-section-heading">
                        <div>
                            <span><Gauge size={14} /> Workspace intelligence</span>
                            <h2>Your premium activity</h2>
                        </div>
                    </div>

                    <div className="premium-performance-card__rows">
                        <div>
                            <span className="premium-performance-card__icon"><BrainCircuit size={19} /></span>
                            <span><small>Reasoning mode</small><strong>Multi-model comparison</strong></span>
                            <BadgeCheck size={18} />
                        </div>
                        <div>
                            <span className="premium-performance-card__icon"><ShieldCheck size={19} /></span>
                            <span><small>Validation</small><strong>Quality-gated outputs</strong></span>
                            <BadgeCheck size={18} />
                        </div>
                        <div>
                            <span className="premium-performance-card__icon"><TrendingUp size={19} /></span>
                            <span><small>Credits acquired</small><strong>{purchasedCredits} total credits</strong></span>
                            <ArrowRight size={17} />
                        </div>
                    </div>

                    <button type="button" onClick={() => navigate('/premium/analytics')}>
                        <BarChart3 size={17} />
                        Open premium analytics
                    </button>
                </motion.section>
            </div>

            <motion.section className="premium-dashboard-activity" {...reveal}>
                <div className="premium-section-heading">
                    <div>
                        <span><Clock3 size={14} /> Recent workspace activity</span>
                        <h2>Continue where you left off</h2>
                    </div>
                    <button type="button" onClick={() => navigate('/premium/ideas')}>
                        View all ideas
                        <ArrowRight size={16} />
                    </button>
                </div>

                <div className="premium-dashboard-activity__content">
                    <article className="premium-latest-idea">
                        <span className="premium-latest-idea__icon"><Lightbulb size={24} /></span>
                        <div>
                            <small>Latest idea</small>
                            <h3>{summary?.latestIdea?.title || 'Your next premium idea starts here'}</h3>
                            <p>
                                {summary?.latestIdea
                                    ? `Created ${formatDate(summary.latestIdea.createdAt)} · ${String(summary.latestIdea.generationType || 'idea').replaceAll('_', ' ').toLowerCase()}`
                                    : 'Generate an evidence-backed project to create your first premium workspace.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate(
                                summary?.latestIdea?.id
                                    ? `/premium/ideas/${summary.latestIdea.id}`
                                    : '/premium/generate',
                            )}
                        >
                            {summary?.latestIdea ? 'Open workspace' : 'Generate now'}
                            <ArrowRight size={16} />
                        </button>
                    </article>

                    <article className="premium-latest-payment">
                        <span className="premium-latest-payment__icon"><CreditCard size={22} /></span>
                        <div>
                            <small>Latest payment</small>
                            <strong>
                                {summary?.latestPayment
                                    ? formatMoney(
                                        summary.latestPayment.amount,
                                        summary.latestPayment.currency,
                                    )
                                    : 'No payment history'}
                            </strong>
                            <span className={`premium-payment-status premium-payment-status--${String(summary?.latestPayment?.status || 'none').toLowerCase()}`}>
                                {getPaymentStatusLabel(summary?.latestPayment?.status)}
                            </span>
                        </div>
                        <p>
                            {summary?.latestPayment
                                ? `${formatDate(summary.latestPayment.createdAt)} · ${String(summary.latestPayment.providerKey || summary.latestPayment.paymentMethodKey || 'payment').replaceAll('_', ' ')}`
                                : 'Your verified purchases will appear here.'}
                        </p>
                        <button type="button" onClick={() => navigate('/premium/billing')}>
                            Billing details
                            <ArrowRight size={15} />
                        </button>
                    </article>
                </div>
            </motion.section>
        </div>
    );
}