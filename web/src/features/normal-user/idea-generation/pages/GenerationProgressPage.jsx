/**
 * Live idea-generation progress page.
 *
 * The backend remains authoritative for run status and percentage. Visual
 * interpolation only smooths abrupt server updates. Cancellation is available
 * as soon as a run exists; after the request succeeds the page briefly polls
 * the authoritative run state so CANCELLED is reflected without UI lag. Visual styling uses
 * the Voxidence eucalyptus-and-rose identity without changing pipeline data.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, LayoutDashboard, Radio, RefreshCw, Sparkles, X } from 'lucide-react';
import { motion } from 'framer-motion';

import { cancelGenerationRun } from '../api/ideaGenerationApi';
import CompletionCelebration from '../components/CompletionCelebration';
import PipelineStage from '../components/PipelineStage';
import { COMPLETED_RUN_STATUSES, TERMINAL_RUN_STATUSES } from '../constants/generation.constants';
import { useIdeaGenerationSocket } from '../hooks/useIdeaGenerationSocket';
import { clearActiveGenerationRunId } from '../store/activeGenerationRun.storage';
import { useGenerationDraftStore } from '../store/generationDraft.store';
import { getVisualPipeline } from '../utils/pipeline.utils';
import { invalidatePaymentPricingCache } from '../../payments/api/paymentFlowApi';
import { useUserExperience } from '../../../../system/user-experience';
import '../styles/generation.css';


export default function GenerationProgressPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialRun = location.state?.initialRun ?? null;
  const { run, connectionState, error, errorStatus, refresh } = useIdeaGenerationSocket(runId, initialRun);
  const syncedPremiumRunRef = useRef(null);
  const { isArabic, t } = useUserExperience();
  const resetDraft = useGenerationDraftStore((state) => state.resetDraft);
  const cancelInitiatedHereRef = useRef(false);
  const displayedProgress = Math.max(
    0,
    Math.min(100, Number(run?.progressPercent ?? 0)),
  );
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [showCancellationSuccess, setShowCancellationSuccess] = useState(false);

  const backendPipeline = useMemo(
    () => getVisualPipeline(
      run?.stages ?? [],
      run?.currentStageKey ?? null,
      run?.status ?? 'QUEUED',
    ),
    [run?.currentStageKey, run?.stages, run?.status],
  );

  const pipeline = backendPipeline;

  const ideaId = run?.ideaId ?? run?.idea?.id ?? run?.idea?.ideaId ?? null;
  const isComplete = COMPLETED_RUN_STATUSES.has(run?.status) && Boolean(ideaId);
  const isTerminal = TERMINAL_RUN_STATUSES.has(run?.status);
  const hasRunFailed = String(run?.status ?? '').toUpperCase() === 'FAILED' || Boolean(run?.errorMessage);
  const activeStage = pipeline.find((stage) => stage.status === 'active') ?? null;
  const canCancel = Boolean(runId) && !isTerminal;


  useEffect(() => {
    if (run?.cancelRequestedAt) setCancelRequested(true);
    if (TERMINAL_RUN_STATUSES.has(run?.status)) {
      clearActiveGenerationRunId();
    }
    if (run?.status === 'CANCELLED' && cancelInitiatedHereRef.current) {
      setShowCancellationSuccess(true);
    }
  }, [run?.cancelRequestedAt, run?.status]);

  useEffect(() => {
    if (
      !isComplete ||
      run?.generationType !== 'PREMIUM_CREDIT' ||
      syncedPremiumRunRef.current === runId
    ) {
      return;
    }

    syncedPremiumRunRef.current = runId;
    invalidatePaymentPricingCache();
    window.dispatchEvent(new CustomEvent('nexora:credits-updated'));
  }, [isComplete, run?.generationType, runId]);

  useEffect(() => {
    if (!isComplete) return;
    resetDraft();
  }, [isComplete, resetDraft]);

  const handleCancel = async () => {
    if (isCancelling || cancelRequested || isTerminal || !canCancel) return;

    const confirmed = window.confirm(
      t('Cancel this generation now? Active AI and collection work will be interrupted where supported.'),
    );
    if (!confirmed) return;

    cancelInitiatedHereRef.current = true;
    setIsCancelling(true);
    setCancelRequested(true);
    setCancelError('');

    try {
      /*
       * The cancellation request itself is persisted and broadcast by the
       * backend. Do not hammer the status endpoint here; run.updated/snapshot
       * events drive the UI and the socket hook keeps REST as a safety fallback.
       */
      await cancelGenerationRun(
        runId,
        t('Cancelled from the generation progress screen.'),
      );
    } catch (requestError) {
      const backendAlreadyAccepted = Boolean(run?.cancelRequestedAt);
      setCancelRequested(backendAlreadyAccepted);
      if (!backendAlreadyAccepted) cancelInitiatedHereRef.current = false;
      // Do not expose backend transport/error text directly.
      setCancelError(t('Could not request cancellation. Please try again.'));
    } finally {
      setIsCancelling(false);
    }
  };


  if (!run && error && (errorStatus === 404 || errorStatus === 403)) {
    const isMissing = errorStatus === 404;
    const isForbidden = errorStatus === 403;

    return (
      <div className="nx-generation-loading nx-generation-loading--error">
        <AlertCircle size={34} />
        <strong>{isMissing ? t('Generation run not found') : isForbidden ? t('Access denied') : t('Could not load this generation run')}</strong>
        <p>{t('We could not load this generation right now. Please try again.')}</p>
        <div className="nx-generation-error-actions">
          <button type="button" onClick={() => navigate('/normal/dashboard')}><ArrowLeft className={isArabic ? 'is-rtl' : ''} size={16} /><span>{t('Back to dashboard')}</span></button>
          {!isMissing && !isForbidden ? <button type="button" onClick={refresh}><RefreshCw size={16} /><span>{t('Try Again')}</span></button> : null}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="nx-generation-loading">
        <RefreshCw className="nx-spin" />
        <strong>{t('Connecting to your generation run...')}</strong>
      </div>
    );
  }

  return (
    <main className="nx-generation-progress nx-generation-progress--horizontal">
      <div className="nx-generation-progress__toolbar">
        <button type="button" className="nx-dashboard-return" onClick={() => navigate('/normal/dashboard')}>
          <ArrowLeft className={isArabic ? 'is-rtl' : ''} size={17} />
          <LayoutDashboard size={17} />
          <span>{t('Back to dashboard')}</span>
        </button>
        <span className="nx-run-reference">{t('Run')} <b>{String(runId).slice(0, 8)}</b></span>
      </div>

      <section className="nx-generation-progress__hero nx-generation-progress__hero--compact">
        <div className="nx-progress-compact-main">
          <div className="nx-progress-compact-kicker">
            <Sparkles size={14} />
            <span>{t('Evidence-led generation')}</span>
          </div>

          <h1>{t('Building your idea.')}</h1>
          <p>{t('Voxidence is moving through the evidence pipeline automatically. You can leave this page and come back anytime.')}</p>
        </div>

        <div className="nx-progress-compact-status" aria-label={t('Current generation status')}>
          <span className="nx-progress-compact-spinner" aria-hidden="true">
            <RefreshCw className="nx-spin" size={22} />
          </span>

          <div className="nx-progress-compact-stage">
            <small>{t('Now working on')}</small>
            <strong>{cancelRequested && !isTerminal ? t('Cancelling generation...') : (activeStage?.title ?? t('Waiting for backend start'))}</strong>
          </div>

          <span className={`nx-progress-compact-live ${connectionState === 'connected' ? 'is-live' : 'is-reconnecting'}`}>
            <i />
            {connectionState === 'connected' ? t('Live') : t('Reconnecting')}
          </span>
        </div>
      </section>

      <section className="nx-horizontal-pipeline-card">
        <div className="nx-horizontal-pipeline-card__head">
          <div>
            <span>{t('Live pipeline')}</span>
            <h2>{t('Generation progress')}</h2>
          </div>


        </div>

        <div
          className="nx-horizontal-pipeline"
          role="list"
          dir={isArabic ? 'rtl' : 'ltr'}
          aria-label={t('Idea-generation milestones')}
        >
          {pipeline.map((stage, index) => (
            <PipelineStage key={stage.key} stage={stage} index={index} isLast={index === pipeline.length - 1} />
          ))}
        </div>

        <div className="nx-progress-track" aria-label={`${t('Generation')} ${Math.round(displayedProgress)} ${t('percent complete')}`}>
          <motion.span animate={{ width: `${displayedProgress}%` }} transition={{ duration: 0.28, ease: 'easeOut' }} />
        </div>

        <div className="nx-pipeline-meta">
          <p><Radio size={17} />{t('You can leave this page while generation continues. The backend keeps the run durable.')}</p>
          {!isTerminal ? (
            <button
              className={`nx-cancel-run ${cancelRequested ? 'is-requested' : ''}`}
              type="button"
              onClick={handleCancel}
              disabled={isCancelling || cancelRequested || isTerminal || !canCancel}
            >
              {isCancelling || cancelRequested ? <RefreshCw className="nx-spin" size={16} /> : <X size={16} />}
              {isCancelling || cancelRequested ? t('Cancelling generation...') : t('Cancel generation')}
            </button>
          ) : null}
        </div>

        {cancelError ? <div className="nx-cancel-error"><AlertCircle size={17} /><span>{cancelError}</span></div> : null}
      </section>

      {hasRunFailed ? (
        <div className="nx-run-error nx-run-error--friendly" role="alert">
          <AlertCircle size={22} />
          <div className="nx-run-error__copy">
            <strong>{t("We couldn't generate your idea this time. Please try again.")}</strong>
            <p>{t('Your previous inputs are still saved. Try again to return to Generate without entering them again.')}</p>
          </div>
          <div className="nx-run-error__actions">
            <button type="button" className="nx-run-error__retry" onClick={() => navigate('/normal/generate', { replace: true })}>
              <RefreshCw size={16} />
              <span>{t('Try Again')}</span>
            </button>
            <button type="button" className="nx-run-error__dashboard" onClick={() => navigate('/normal/dashboard')}>
              <LayoutDashboard size={16} />
              <span>{t('Back to dashboard')}</span>
            </button>
          </div>
        </div>
      ) : null}

      {isComplete ? (
        <CompletionCelebration
          ideaId={ideaId}
          ideaTitle={run.idea?.title}
          isPremium={run?.generationType === 'PREMIUM_CREDIT'}
          onOpenIdea={(ideaId) => navigate(`/normal/ideas/${ideaId}`, { replace: true })}
        />
      ) : null}

      {showCancellationSuccess && typeof document !== 'undefined'
        ? createPortal(
            <div className="nx-cancel-success" role="presentation">
              <div
                className="nx-cancel-success__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="nx-cancel-success-title"
              >
                <span className="nx-cancel-success__icon" aria-hidden="true">
                  <CheckCircle2 size={30} />
                </span>
                <span className="nx-cancel-success__eyebrow">{t('Generation stopped safely')}</span>
                <h2 id="nx-cancel-success-title">{t('Cancellation completed')}</h2>
                <p>{t('The active generation run has been cancelled and no further idea-generation stages will continue.')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowCancellationSuccess(false);
                    navigate('/normal/generate', { replace: true });
                  }}
                >
                  <Sparkles size={17} />
                  {t('Back to Generate Idea')}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}