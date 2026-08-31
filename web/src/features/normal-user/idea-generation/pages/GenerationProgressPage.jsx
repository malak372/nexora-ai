import { workspacePath } from '../../shared/utils/workspacePath';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
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

function ProgressGlobe() {
  return (
    <div className="vx-progress-globe" aria-hidden="true">
      <span className="vx-progress-globe__orbit vx-progress-globe__orbit--1" />
      <span className="vx-progress-globe__orbit vx-progress-globe__orbit--2" />
      <span className="vx-progress-globe__dot vx-progress-globe__dot--1" />
      <span className="vx-progress-globe__dot vx-progress-globe__dot--2" />
      <span className="vx-progress-globe__dot vx-progress-globe__dot--3" />
      <motion.span
        className="vx-progress-globe__sphere"
        animate={{ y: [0, -4, 0], rotate: [0, 2, -2, 0] }}
        transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <i className="vx-progress-globe__land vx-progress-globe__land--1" />
        <i className="vx-progress-globe__land vx-progress-globe__land--2" />
      </motion.span>
    </div>
  );
}

function relativeStartedAt(value, t) {
  if (!value) return t('Just now');
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return t('Just now');
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t('Just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t(`${minutes}m ago`);
  return t(`${Math.floor(minutes / 60)}h ago`);
}

export default function GenerationProgressPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialRun = location.state?.initialRun ?? null;
  const { run, connectionState, error, errorStatus } = useIdeaGenerationSocket(runId, initialRun);
  const { t } = useUserExperience();
  const resetDraft = useGenerationDraftStore((state) => state.resetDraft);
  const syncedPremiumRunRef = useRef(null);
  const cancelInitiatedHereRef = useRef(false);

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [showCancellationSuccess, setShowCancellationSuccess] = useState(false);

  const pipeline = useMemo(
    () => getVisualPipeline(run?.stages ?? [], run?.currentStageKey ?? null, run?.status ?? 'QUEUED'),
    [run?.currentStageKey, run?.stages, run?.status],
  );

  const displayedProgress = Math.max(0, Math.min(100, Number(run?.progressPercent ?? 0)));
  const activeStage = pipeline.find((stage) => stage.status === 'active') ?? pipeline.find((stage) => stage.status === 'waiting') ?? pipeline[pipeline.length - 1];
  const ideaId = run?.ideaId ?? run?.idea?.id ?? run?.idea?.ideaId ?? null;
  const isComplete = COMPLETED_RUN_STATUSES.has(run?.status) && Boolean(ideaId);
  const isTerminal = TERMINAL_RUN_STATUSES.has(run?.status);
  const hasRunFailed = String(run?.status ?? '').toUpperCase() === 'FAILED' || Boolean(run?.errorMessage);
  const canCancel = Boolean(runId) && !isTerminal;

  useEffect(() => {
    if (run?.cancelRequestedAt) setCancelRequested(true);
    if (TERMINAL_RUN_STATUSES.has(run?.status)) clearActiveGenerationRunId();
    if (run?.status === 'CANCELLED' && cancelInitiatedHereRef.current) setShowCancellationSuccess(true);
  }, [run?.cancelRequestedAt, run?.status]);

  useEffect(() => {
    if (!isComplete || run?.generationType !== 'PREMIUM_CREDIT' || syncedPremiumRunRef.current === runId) return;
    syncedPremiumRunRef.current = runId;
    invalidatePaymentPricingCache();
    window.dispatchEvent(new CustomEvent('nexora:credits-updated'));
  }, [isComplete, run?.generationType, runId]);

  useEffect(() => {
    if (isComplete) resetDraft();
  }, [isComplete, resetDraft]);

  const handleCancel = async () => {
    if (isCancelling || cancelRequested || isTerminal || !canCancel) return;
    const confirmed = window.confirm(t('Cancel this generation now? Active AI and collection work will be interrupted where supported.'));
    if (!confirmed) return;

    cancelInitiatedHereRef.current = true;
    setIsCancelling(true);
    setCancelRequested(true);
    setCancelError('');
    try {
      await cancelGenerationRun(runId, t('Cancelled from the generation progress screen.'));
    } catch {
      const backendAlreadyAccepted = Boolean(run?.cancelRequestedAt);
      setCancelRequested(backendAlreadyAccepted);
      if (!backendAlreadyAccepted) cancelInitiatedHereRef.current = false;
      setCancelError(t('Could not request cancellation. Please try again.'));
    } finally {
      setIsCancelling(false);
    }
  };



  if (!run && error && (errorStatus === 404 || errorStatus === 403)) {
    return (
      <div className="vx-progress-loading is-error">
        <AlertCircle size={34} />
        <strong>{t(errorStatus === 404 ? 'Generation run not found' : 'Access denied')}</strong>
        <p>{t('We could not load this generation right now. Please try again.')}</p>
        <button type="button" onClick={() => navigate(workspacePath('/normal/generate'))}>{t('Back to Generate Idea')}</button>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="vx-progress-loading">
        <RefreshCw className="nx-spin" />
        <strong>{t('Connecting to your generation run...')}</strong>
      </div>
    );
  }

  return (
    <main className="vx-progress-page">
      <section className="vx-progress-hero">
        <div className="vx-progress-hero__copy">
          <h1>{t('Building your validated idea')}</h1>
          <p>{t("We're gathering signals, understanding your community and shaping one coherent, evidence-backed opportunity.")}</p>
          <div className="vx-progress-meta">
            <span>{t('Started')}</span>
            <Clock3 size={13} />
            <b>{relativeStartedAt(run?.startedAt ?? run?.createdAt, t)}</b>
          </div>
        </div>

        <div className="vx-progress-ring-wrap">
          <div className="vx-progress-ring" style={{ '--progress': `${displayedProgress * 3.6}deg` }}>
            <div>
              <strong>{Math.round(displayedProgress)}%</strong>
              <span>{t('Progress')}</span>
            </div>
          </div>
        </div>

        <div className="vx-progress-current">
          <small>{t('Now working on')}</small>
          <article>
            <span className="vx-progress-current__icon"><Sparkles size={19} /></span>
            <div>
              <strong>{t(cancelRequested && !isTerminal ? 'Cancelling generation...' : activeStage?.title ?? 'Preparing')}</strong>
              <p>{t(activeStage?.description ?? 'We are preparing the right discovery path for your request.')}</p>
            </div>
            <i className="vx-progress-current__pulse" />
          </article>
          <span className={`vx-progress-current__status ${connectionState === 'connected' ? 'is-live' : ''}`}>
            {connectionState === 'connected' ? t('In progress') : t('Reconnecting')}
          </span>
        </div>
      </section>

      <section className="vx-progress-pipeline-card">
        <div className="vx-progress-pipeline-card__head">
          <div>
            <span>{t('Live pipeline')}</span>
            <small>{t('The pipeline updates automatically as each backend stage completes.')}</small>
          </div>
          <ProgressGlobe />
        </div>

        <div className="vx-progress-pipeline" role="list">
          {pipeline.map((stage, index) => (
            <PipelineStage key={stage.key} stage={stage} index={index} />
          ))}
        </div>

        {!isTerminal ? (
          <div className="vx-progress-actions">
            <span>{t('You can leave this page while generation continues. The backend keeps the run durable.')}</span>
            <button type="button" onClick={handleCancel} disabled={isCancelling || cancelRequested || !canCancel}>
              {isCancelling || cancelRequested ? <RefreshCw className="nx-spin" size={15} /> : <X size={15} />}
              {t(isCancelling || cancelRequested ? 'Cancelling generation...' : 'Cancel generation')}
            </button>
          </div>
        ) : null}

        {cancelError ? <div className="vx-progress-error"><AlertCircle size={16} />{cancelError}</div> : null}
      </section>

      {hasRunFailed ? (
        <section className="vx-progress-failed" role="alert">
          <AlertCircle size={22} />
          <div>
            <strong>{t("We couldn't generate your idea this time. Please try again.")}</strong>
            <p>{t('Your previous inputs are still saved, so you can retry without entering them again.')}</p>
          </div>
          <button type="button" onClick={() => navigate(workspacePath('/normal/generate'), { replace: true })}>{t('Try Again')}</button>
        </section>
      ) : null}

      {isComplete ? (
        <CompletionCelebration
          ideaId={ideaId}
          ideaTitle={run.idea?.title}
          isPremium={run?.generationType === 'PREMIUM_CREDIT'}
          onOpenIdea={(id) => navigate(workspacePath(`/normal/ideas/${id}`), { replace: true })}
        />
      ) : null}

      {showCancellationSuccess && typeof document !== 'undefined'
        ? createPortal(
          <div className="vx-generate-modal-backdrop">
            <section className="vx-generate-modal" role="dialog" aria-modal="true">
              <span className="vx-generate-modal__icon"><CheckCircle2 size={26} /></span>
              <small>{t('Generation stopped safely')}</small>
              <h2>{t('Cancellation completed')}</h2>
              <p>{t('The active generation run has been cancelled and no further idea-generation stages will continue.')}</p>
              <button type="button" onClick={() => { setShowCancellationSuccess(false); navigate(workspacePath('/normal/generate'), { replace: true }); }}>{t('Back to Generate Idea')}</button>
            </section>
          </div>,
          document.body,
        )
        : null}
    </main>
  );
}
